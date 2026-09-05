'use strict';
/**
 * test-orphan-identity-lifecycle.js — S6: how a tenant_id comes to point at nothing.
 *
 *   node test-orphan-identity-lifecycle.js
 *
 * READ-ONLY in every sense. No database client, no network, no mutation. The
 * pilot facts come from a frozen snapshot; the code facts come from reading
 * script.js as text. Nothing here repairs anything, and nothing here proposes
 * a repair that the analyzer has not refused.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * The investigation produced four claims that a later phase will act on, and a
 * claim nobody can re-check is a claim that quietly rots. Each is asserted here
 * against evidence rather than restated in prose:
 *
 *   ROOT CAUSE   identity is minted per-object, not per-tenant
 *   REPAIR       resemblance cannot authorise a remap in THIS dataset
 *   PREVENTION   the paths that can still orphan a row are still open
 *   FK           the table cannot take the constraint in its current state
 */

const fs = require('fs');
const A    = require('./tools/orphan-identity-analyzer.js');
const SNAP = require('./evidence/2026-09-05-orphan-identity-snapshot.json');
const SRC  = fs.readFileSync(require.resolve('./script.js'), 'utf8');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

/** Source assertions must never match a comment — the comments here discuss the bug. */
const CODE = SRC.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ── A. The scope is larger than S5 reported ────────────────────────────────
// S5 examined the 28 rows with a non-null expected_cam and found 3 orphans.
// That was the correct answer to the question S5 asked. It is not the size of
// the problem: three further rows dangle and were never in scope because their
// expected_cam was always NULL.
sec('A. Six dangling rows, of which S5 could only ever have seen three');
{
  const d = SNAP.dangling_cam_rows;
  eq(d.length, 6, 'A1 six cam_reconciliations rows have a tenant_id that resolves to nothing');
  eq(d.filter(r => r.in_s5_class_O).length, 3, 'A2 three of them are the S5 Class O set');
  eq(d.filter(r => !r.in_s5_class_O).length, 3, 'A3 and three were invisible to S5');
  is(d.filter(r => !r.in_s5_class_O).every(r => r.expected_cam === null),
     'A4 because every one of those three already had a NULL expected_cam');
  eq(SNAP.cross_table_id_resolution.cam_reconciliations.dangling, 6, 'A5 the count agrees with the table sweep');
  eq(SNAP.cross_table_id_resolution.cam_reconciliations.null_tenant_id, 0,
     'A6 and no row has a NULL tenant_id — every reference is present, six are wrong');
  eq(SNAP.cross_table_id_resolution.tenant_field_evidence.dangling, 15,
     'A7 fifteen evidence rows dangle too');
  eq(SNAP.cross_table_id_resolution.tenant_field_evidence_distinct_ids.dangling, 2,
     'A8 across two tenant ids');
}

// ── B. ROOT CAUSE — the id is per-object, not per-tenant ───────────────────
sec('B. Root cause: one tenant, three identities');
{
  const L = SNAP.cross_table_id_resolution.lease_documents;
  eq(L.resolves, 0, 'B1 lease_documents.tenant_id resolves to a tenants row ZERO times');
  eq(L.total, 73,   'B2 out of seventy-three rows');
  is(L.resolves === 0 && L.total > 0,
     'B3 a column that never matches is not a broken reference — it is a separate id space');
  eq(SNAP.cross_table_id_resolution.lease_documents_ids_seen_in_evidence, 0,
     'B4 those ids appear in no evidence row');
  eq(SNAP.cross_table_id_resolution.lease_documents_ids_seen_in_cam, 0,
     'B5 in no reconciliation');
  eq(SNAP.cross_table_id_resolution.lease_documents_ids_seen_in_property_blob, 0,
     'B6 and in no property blob — they are minted per document and never reused');

  const t = SNAP.one_tenant_three_ids;
  eq(t.distinct_ids, 3, 'B7 one tenant carries three different uuids across the tables');
  is(t.lease_documents_tenant_id !== t.tenants_id
     && t.tenant_field_evidence_tenant_id !== t.tenants_id
     && t.lease_documents_tenant_id !== t.tenant_field_evidence_tenant_id,
     'B8 all three differ — ' + t.tenant);
  is(t.cam_reconciliations_tenant_id === t.tenant_field_evidence_tenant_id,
     'B9 the CAM row and the evidence agree with each other, and with nothing else');
}

// ── B2. The minting site, read from the source ─────────────────────────────
sec('B′. normalizeTenant mints an identity for any record that lacks one');
{
  is(/id:\s*d\.id\s*\?\?\s*crypto\.randomUUID\(\)/.test(CODE),
     'B10 normalizeTenant assigns crypto.randomUUID() when d.id is absent',
     'if this stops being true the root-cause analysis needs redoing');
  // The same function runs over ALREADY-normalized records on every load, which
  // is safe only because the id survives the round trip.
  is(/normalizeTenant\(\{[\s\S]{0,200}?id:\s*t\.id/.test(CODE),
     'B11 the tenants-table load path passes the stored id back in',
     'that path is the one that does NOT re-mint');
  is(/tenantId:\s*normalized\.id\s*\|\|\s*null/.test(CODE)
     || /tenantId:\s*norm\?\.id\s*\|\|\s*null/.test(CODE),
     'B12 the lease-document writer sends the extraction object id, whatever it is');
}

// ── C. PREVENTION — the paths are still open ───────────────────────────────
sec('C. The current application can still produce this');
{
  const calls = (CODE.match(/\bawait resyncTenantsToTable\(/g) || []).length;
  const guarded = (CODE.match(/_tenantsBelongTo\([^)]*\)\s*\)\s*await resyncTenantsToTable\(/g) || []).length;
  is(calls >= 5, 'C1 resyncTenantsToTable has five call sites', calls + ' found');
  is(guarded === 2, 'C2 exactly two of them pass through the _tenantsBelongTo guard', guarded + ' guarded');
  is(calls - guarded >= 3, 'C3 so at least three write the tenants table unguarded',
     (calls - guarded) + ' unguarded — the guard exists and does not cover its own function');

  // Every call site filters the roster before handing it over. Anything filtered
  // out is deleted by the resync and never reinserted, while its CAM and
  // evidence rows keep pointing at it.
  is(/filter\(t\s*=>\s*t\s*&&\s*t\.tenant_name\s*&&\s*!t\._pendingJobReview\)/.test(CODE),
     'C4 _doResyncTenantsToTable drops rows with no name or a pending review');
  is(/tenantData\.filter\(t\s*=>\s*t\?\.tenant_name\s*&&\s*\(!t\?\.extractionFailed/.test(CODE),
     'C5 and callers drop failed extractions too');
  ok('C6 a dropped tenant is DELETED by the resync and not reinserted — the orphan is created there,'
     + ' not by any explicit delete');
}

// ── C2. The empty-roster wipe ──────────────────────────────────────────────
// The stored procedure deletes unconditionally and inserts only when the array
// is non-empty. An empty roster therefore erases every tenant for the property
// and orphans every row that referenced any of them at once.
sec('C″. An empty roster deletes everything and inserts nothing');
{
  const proc = fs.readFileSync('./migrations/009_atomic_tenant_resync.sql', 'utf8');
  is(/delete from public\.tenants\s*\n\s*where property_id = p_property_id;/.test(proc),
     'C7 the procedure deletes unconditionally, before any insert');
  is(/if p_rows is not null and jsonb_array_length\(p_rows\) > 0 then/.test(proc),
     'C8 but only inserts when the array is non-empty');
  ok('C9 so resyncTenantsToTable(id, []) is a full wipe of that property\'s tenants');
  // One call site guards against it; the others do not.
  is(/qualifiedTenants\.length\)\s*\{?\s*\n?\s*await resyncTenantsToTable/.test(CODE),
     'C10 one call site checks the list is non-empty first');
}

// ── D. REPAIR — resemblance is not identity, demonstrated ──────────────────
sec('D. The strongest available signal produces a cross-property false positive');
{
  const trap = SNAP.the_cross_property_trap;
  eq(trap.candidates_on_its_own_property, 0,
     'D1 the LV orphan has no candidate at all on its own property');
  const m = trap.exact_attribute_match_elsewhere;
  is(m.sqft === trap.orphan.sqft && m.cap === trap.orphan.cap
     && m.start === trap.orphan.start && m.end === trap.orphan.end,
     'D2 yet sqft, cap and both dates match a tenant on a DIFFERENT property exactly');
  is(m.property !== trap.orphan.property,
     'D3 ' + trap.orphan.property + ' orphan vs ' + m.property + ' tenant');
  eq(A.nameSimilarity(trap.orphan.name, m.name), 'equivalent_after_suffix_strip',
     'D4 and the names differ only by a legal suffix');
  ok('D5 a matcher strong enough to fix the easy orphan would attach this one to the wrong property');
}

// ── D2. The analyzer refuses every one of them ─────────────────────────────
sec('D′. No orphan is safe to remap automatically');
{
  // Build the tenants view the analyzer needs from the frozen rosters, plus the
  // two tenants named explicitly in the trap and candidate detail.
  const tenants = [
    { id: 'dec00000-0000-4000-a002-97d242509394', property_id: 'dec00000-0000-4000-a000-97d242509394',
      name: 'Whole Health Market', leased_sqft: '9200', cap: '5', start_date: '2021-01-01', end_date: '2028-12-31' },
    { id: '1373a5ba-e4ba-4f49-87cf-0ba6c4e54b25', property_id: '514763a6-bb65-4098-a1dc-ae9ca33b1ce2',
      name: 'Prime Wellness Spa', leased_sqft: '4500', cap: '5', start_date: '2024-03-01', end_date: '2029-02-28' },
    { id: 'ac4e2bf0-6144-4590-b650-00af58891b66', property_id: 'dec00000-0000-4000-a000-97d242509394',
      name: 'Prime Wellness Spa', leased_sqft: '4500', cap: '5', start_date: '2024-03-01', end_date: '2029-02-28' },
    // Two tenants that must NOT be picked up, and are here so the filters that
    // exclude them are exercised rather than merely present:
    //   a differently-named neighbour on the orphan's own property …
    { id: '2bc33efc-558e-447e-9226-22ed556a2269', property_id: '514763a6-bb65-4098-a1dc-ae9ca33b1ce2',
      name: 'ShopRite Supermarkets, LLC', leased_sqft: '45000', cap: '5', start_date: '2024-03-01', end_date: '2034-02-28' },
    { id: 'fa3f1285-daa5-4ba3-b226-974e30aa5576', property_id: '514763a6-bb65-4098-a1dc-ae9ca33b1ce2',
      name: 'Luxe Nails', leased_sqft: '3000', cap: '5', start_date: '2021-06-02', end_date: '2028-10-02' },
    //   … and a same-named tenant on another property whose ATTRIBUTES differ,
    //   which must not be reported as a cross-property exact match.
    { id: 'aaaa1111-0000-4000-8000-000000000001', property_id: '99999999-9999-4999-8999-999999999999',
      name: 'Whole Health Market, Inc', leased_sqft: '1234', cap: '9', start_date: '2001-01-01', end_date: '2002-01-01' },
  ];

  const orphans = SNAP.dangling_evidence_groups.map(g => ({
    tenant_id: g.tenant_id, property_id: g.property_id, property: g.property,
    tenant_name: g.attributes.tenant_name, attributes: g.attributes,
    idInPropertyRoster: false, leaseDocumentLink: false,
  }));

  const lv    = A.assess(orphans.find(o => o.property === 'LV'), tenants);
  const maple = A.assess(orphans.find(o => o.property === 'Maple Plaza'), tenants);

  eq(lv.disposition, 'cross_property_lookalike', 'D6 the LV orphan is graded a cross-property lookalike');
  eq(lv.localCandidates.length, 0, 'D7 with no local candidate');
  is(lv.crossPropertyExactMatches.length === 1
     && lv.crossPropertyExactMatches[0].attributesAllMatch,
     'D8 and exactly ONE exact attribute match on another property');
  // A same-named tenant elsewhere whose attributes disagree is not a match, and
  // must not pad the count — otherwise "one exact match" means nothing.
  is(!lv.crossPropertyExactMatches.some(c => c.tenant_id.startsWith('aaaa1111')),
     'D8b the same-named-but-different-attributes tenant is excluded');
  eq(lv.crossPropertyExactMatches[0].property_id, 'dec00000-0000-4000-a000-97d242509394',
     'D8c and the one that survives is the Cascade Commons tenant');

  eq(maple.disposition, 'single_candidate_unverified', 'D9 the Maple orphan has exactly one local candidate');
  eq(maple.localCandidates.length, 1,
     'D9b out of three tenants on that property — the other two are differently named');
  is(maple.localCandidates[0].tenant_id === '1373a5ba-e4ba-4f49-87cf-0ba6c4e54b25',
     'D9c and it is the one whose name actually matches');
  is(maple.localCandidates[0].attributesAllMatch,
     'D10 whose sqft, cap and dates all match — the strongest case in the set');
  eq(maple.hasDurableKey, false, 'D11 and still no durable identifier behind it');
  eq(maple.safeToRemap, false, 'D12 so even the strongest case is refused');

  // An orphan we know NOTHING about beyond a name — four of the six dangling
  // CAM rows have no evidence at all, so this is the common case, not a corner.
  // Vacuous agreement ("no attribute disagreed") must not read as a match.
  const bare = A.assess({
    tenant_id: 'dddddddd-0000-4000-8000-000000000009',
    property_id: '015e8dda-b807-4e41-afd0-f23e8cb983c5', property: 'LV',
    tenant_name: 'Whole Health Market, Inc', attributes: {},
  }, tenants);
  eq(bare.crossPropertyExactMatches.length, 0,
     'D12b an orphan with no known attributes matches nothing — zero is not "all"');
  eq(bare.disposition, 'no_candidate', 'D12c it is a no-candidate, not a lookalike');
  eq(bare.safeToRemap, false, 'D12d and certainly not remappable');

  const s = A.summarise(orphans, tenants);
  eq(s.safeToRemap, 0, 'D13 nothing in the set is safe to remap automatically');
  eq(s.withDurableKey, 0, 'D14 because nothing in the set has a durable key');

  // And the analyzer is not merely returning false unconditionally.
  const keyed = A.assess({ ...orphans[1], tenant_id: '1373a5ba-e4ba-4f49-87cf-0ba6c4e54b25' }, tenants);
  eq(keyed.safeToRemap, true, 'D15 an orphan whose id IS a tenants key would be safe — the refusal is earned');
  eq(keyed.durableSignals.idIsATenantKey, true, 'D16 by the only signal that is actually an identifier');
}

// ── E. FK ENFORCEMENT — the constraint cannot be added yet ─────────────────
sec('E. What the foreign key would reject today');
{
  const d = SNAP.dangling_cam_rows;
  eq(d.length, 6, 'E1 a NOT VALID..VALIDATE on cam_reconciliations would fail on six rows');
  eq(SNAP.cross_table_id_resolution.tenant_field_evidence_distinct_ids.dangling, 2,
     'E2 and on tenant_field_evidence, two ids across fifteen rows');
  // The evidence column cannot take an FK at all in its current type.
  ok('E3 tenant_field_evidence.tenant_id is TEXT, not uuid — an FK to tenants(id) needs a type change first');
  // And lease_documents must never get one.
  eq(SNAP.cross_table_id_resolution.lease_documents.resolves, 0,
     'E4 lease_documents.tenant_id would reject ALL 73 rows — it must not get an FK, it needs renaming');
  ok('E5 ON DELETE: a resync deletes tenants routinely, so CASCADE would delete reconciliations — '
     + 'the FK has to be RESTRICT or the resync has to stop deleting');
}

// ── F. The timeline is consistent with "never attached", not "detached" ────
sec('F. Every roster was written after the reconciliation that dangles');
{
  const t = SNAP.timeline_evidence;
  const keys = Object.keys(t).filter(k => !k.startsWith('_'));
  eq(keys.length, 6, 'F1 all six rows are dated');
  is(keys.every(k => t[k].roster_is_later),
     'F2 and in every case the surviving roster was written AFTER the reconciliation');
  is(SNAP.property_tenant_rosters['015e8dda-b807-4e41-afd0-f23e8cb983c5'].names.length === 7,
     'F3 the LV roster holds seven rows');
  const lv = SNAP.property_tenant_rosters['015e8dda-b807-4e41-afd0-f23e8cb983c5'].names;
  is(new Set(lv).size < lv.length,
     'F4 with duplicate names among them — the same tenant extracted twice under two ids',
     lv.length + ' rows, ' + new Set(lv).size + ' distinct names');
  const lvCam = SNAP.dangling_cam_rows.filter(r => r.property === 'LV').map(r => r.tenant_name);
  is(lvCam.every(n => !lv.includes(n)),
     'F5 and not one of the dangling LV tenant names appears in that roster at all',
     lvCam.join(', '));
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
