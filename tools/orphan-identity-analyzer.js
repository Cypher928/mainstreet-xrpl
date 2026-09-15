'use strict';
/**
 * tools/orphan-identity-analyzer.js — what can and cannot be said about a row
 * whose tenant_id resolves to nothing.
 *
 * NOT LOADED BY THE APPLICATION. It reads a frozen snapshot; it writes nothing.
 *
 * ── WHY A ROW WITH NO TENANT IS NOT A ROW THAT LOST ITS TENANT ──────────────
 *
 * The obvious reading of a dangling tenant_id is "the tenant was deleted".
 * The pilot data does not support that reading. `lease_documents.tenant_id`
 * resolves to a tenants row ZERO times out of 73 — not once — and those ids
 * appear in no other table and in no property blob. A column that never
 * matches anything, ever, is not a broken reference: it is a different id
 * space. The same logical tenant carries three different uuids across
 * lease_documents, tenant_field_evidence/cam_reconciliations, and tenants.
 *
 * So the defect is not deletion. It is that a tenant's identity is MINTED
 * INDEPENDENTLY at several points in its life (normalizeTenant assigns
 * `crypto.randomUUID()` to any record arriving without an id) and each writer
 * captures whichever id its own copy of the record happened to be holding.
 * A dangling id was, in the general case, never a primary key in `tenants` at
 * all — it was never attached, rather than detached.
 *
 * ── WHY THIS FILE REFUSES TO PROPOSE A REMAP ────────────────────────────────
 *
 * It computes candidates and it grades them, but `safeToRemap` is false for
 * every disposition it can currently return, and that is deliberate. The
 * pilot contains a case that defeats the strongest signal available: an LV
 * reconciliation for "Whole Health Market, Inc" has NO candidate on its own
 * property and an EXACT match on name, sqft, cap and both dates against a
 * tenant of a different property — because the same PDF was uploaded twice.
 * A matcher good enough to resolve the easy orphan is good enough to attach a
 * reconciliation to the wrong landlord's tenant. Identity is restored from a
 * durable key or it is not restored.
 */

/** The dispositions an orphan can receive. None of them is an automatic repair. */
const DISPOSITIONS = [
  'no_candidate',                 // nothing on the property resembles it
  'single_candidate_unverified',  // exactly one plausible match, no durable key backing it
  'ambiguous_candidates',         // more than one plausible match on the property
  'cross_property_lookalike',     // no local candidate, but an exact match on ANOTHER property
];

const ATTRS = ['leased_sqft', 'cap', 'start_date', 'end_date'];

/** Normalise for comparison without pretending near-misses are matches. */
function _norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Names differing only in punctuation/case/legal suffix are SIMILAR, never equal. */
function nameSimilarity(a, b) {
  const A = _norm(a), B = _norm(b);
  if (A === null || B === null) return 'unknown';
  if (A === B) return 'exact';
  const strip = (s) => s.toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|incorporated)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return strip(A) === strip(B) ? 'equivalent_after_suffix_strip' : 'different';
}

/**
 * @param {object} orphan   one dangling row: { tenant_id, tenant_name, property_id, attributes? }
 * @param {Array}  tenants  every tenants row visible, each { id, property_id, name, ...ATTRS }
 * @returns {object} an assessment. Pure.
 */
function assess(orphan, tenants) {
  const o = orphan || {};
  const all = tenants || [];
  const attrs = o.attributes || {};

  const onProperty = all.filter(t => t.property_id === o.property_id);

  const grade = (t) => {
    const sim = nameSimilarity(o.tenant_name || attrs.tenant_name, t.name);
    const matched = ATTRS.filter(k => _norm(attrs[k]) !== null && _norm(attrs[k]) === _norm(t[k]));
    const known   = ATTRS.filter(k => _norm(attrs[k]) !== null);
    return {
      tenant_id: t.id, property_id: t.property_id, name: t.name,
      nameSimilarity: sim,
      attributesMatched: matched.length, attributesKnown: known.length,
      // "exact" means every attribute we know was checked and every one agreed.
      attributesAllMatch: known.length > 0 && matched.length === known.length,
    };
  };

  const local   = onProperty.map(grade).filter(c => c.nameSimilarity !== 'different');
  const foreign = all.filter(t => t.property_id !== o.property_id).map(grade)
                     .filter(c => c.nameSimilarity !== 'different' && c.attributesAllMatch);

  let disposition;
  if (local.length === 0 && foreign.length > 0) disposition = 'cross_property_lookalike';
  else if (local.length === 0)                  disposition = 'no_candidate';
  else if (local.length === 1)                  disposition = 'single_candidate_unverified';
  else                                          disposition = 'ambiguous_candidates';

  // ── The durable-key question, asked separately from the resemblance question ──
  // A remap is only ever safe if some IMMUTABLE identifier ties the orphan to a
  // tenant. Resemblance is not an identifier. These are the signals the schema
  // could in principle offer, and the state of each today.
  const durableSignals = {
    // The orphan id itself appearing as a tenants primary key — the only true key.
    idIsATenantKey: all.some(t => String(t.id) === String(o.tenant_id)),
    // The property blob's tenant roster naming this id.
    idInPropertyRoster: o.idInPropertyRoster === true,
    // A lease_documents row tying this id to a tenant. Impossible today: that
    // column is a separate id space that matches nothing.
    leaseDocumentLink: o.leaseDocumentLink === true,
  };
  const hasDurableKey = Object.values(durableSignals).some(Boolean);

  return {
    tenant_id: o.tenant_id, recon_id: o.recon_id ?? null,
    property_id: o.property_id, property: o.property ?? null,
    tenant_name: o.tenant_name ?? attrs.tenant_name ?? null,
    disposition,
    localCandidates: local, crossPropertyExactMatches: foreign,
    durableSignals, hasDurableKey,
    // The point of the whole file: resemblance never authorises a write.
    safeToRemap: hasDurableKey,
    reason: hasDurableKey
      ? 'A durable identifier ties this row to a tenant; a remap would restore a known fact.'
      : 'No durable identifier ties this row to any tenant. Every remaining signal is '
      + 'resemblance, and resemblance in this dataset produces cross-property false '
      + 'positives. Identity is restored from a key or it is not restored.',
  };
}

function summarise(orphans, tenants) {
  const out = { total: 0, byDisposition: {}, safeToRemap: 0, withDurableKey: 0 };
  for (const a of (orphans || []).map(o => assess(o, tenants))) {
    out.total++;
    out.byDisposition[a.disposition] = (out.byDisposition[a.disposition] || 0) + 1;
    if (a.safeToRemap) out.safeToRemap++;
    if (a.hasDurableKey) out.withDurableKey++;
  }
  return out;
}

module.exports = { assess, summarise, nameSimilarity, DISPOSITIONS, ATTRS };
