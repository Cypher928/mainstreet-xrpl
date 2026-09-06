/**
 * property-record.js — the canonical, property-scoped read model.
 *
 * PropertyRecord.assemble(property) returns one deterministic, document-grounded
 * view of a property by COMPOSING the modules that already own each answer. It
 * is a read model, not an engine: every number in it is produced by the code
 * that already ships as the authority for that number, and nothing here
 * re-derives, re-interprets or invents one.
 *
 * WHY A READ MODEL AND NOT A NEW SELECTOR
 * ---------------------------------------
 * The Phase G audit found that MainStreet holds far more than any single
 * surface reads: a merged Timeline, a five-state field provenance, cent-exact
 * CAM results, real dispute records, a ranked attention list. What was missing
 * was not the data — it was one place that could hand all of it over at once,
 * consistently scoped to a property. Every consumer had been reaching into the
 * blob for itself, which is how four modules ended up with three definitions of
 * "leased square footage" (see LIMITS below).
 *
 * THE ONE RULE
 * ------------
 * If a value has an owner, call the owner. If it has no owner, return null and
 * say so — never a plausible substitute. A read model that guesses is worse than
 * one that admits a gap, because a guess is indistinguishable from a fact once
 * it has been serialised.
 *
 * AUTHORITATIVE SOURCES (each verified before this file was written)
 * -----------------------------------------------------------------
 *   identity.name        property.name
 *   identity.camYear     camReconciliation.camYear ?? property.camYear.
 *                        NOT getCamYear() — that is session state backed by
 *                        localStorage, so it answers "what is this browser
 *                        looking at", not "what year is this property's
 *                        reconciliation".
 *   identity.totalSqft   property.totalSqft ?? property.totalSqFt — entered in
 *                        Property Setup (script.js: prop.totalSqft = Number(val))
 *                        and persisted. Both spellings exist in the codebase and
 *                        both are read here, exactly as script.js does.
 *   identity.leasedSqft  NO AUTHORITATIVE SOURCE — see LIMITS. Always null.
 *   identity.occupancy   PropertyReference.occupancyPct(property) — the single
 *                        named occupancy rule, which already returns null when
 *                        the property has no total area.
 *   spaces               TenantSpace.assemble(property, tenantId), once per
 *                        tenant. All space scoping (the S1 "no identity, no
 *                        record" guard and the S2 duplicate-name guard) belongs
 *                        to that function and is not repeated here.
 *   fields               FieldProvenance.fieldProvenance(key, tenant) over
 *                        LeaseIntelligence.CANONICAL_FIELDS. The legacy
 *                        `t._confidence` string is never consulted.
 *   cam.pool             CamPool.total(property.invoices) — the one definition
 *                        of what is in the pool.
 *   cam.results          (camReconciliation ?? results).results — the same
 *                        resolution ai-workspace, command-center, guided-tour
 *                        and selectors all use.
 *   cam.unallocated      VarianceBreakdown.derive(...).difference
 *   cam.capped           results where capApplied === true — read, not recomputed
 *   timeline.byTenant    the events TenantSpace scoped to each space
 *   timeline.property    every event no space claimed, by TimelineMerge.eventKey
 *                        identity — set arithmetic over TenantSpace's own output
 *                        rather than a second scoping rule
 *   disputes             property.disputes — real records only
 *   attention            PropertyWorkspace.collectAttention(property), unsliced
 *                        (MAX_SHOWN is a render limit, not part of the answer)
 *   documents            the document attachments TenantSpace already returns
 *                        per space, plus the lease documents it identifies
 *
 * LIMITS — READ THESE BEFORE TRUSTING A FIELD
 * -------------------------------------------
 * · identity.leasedSqft is ALWAYS null. Three modules compute a property-level
 *   leased total and they do not agree: acquisition-engine sums
 *   parseFloat(leased_sqft) while skipping extractionFailed tenants,
 *   lease-review-packets sums over "active" tenants only, and
 *   PropertyReference.occupancyPct sums (leased_sqft || sqft) over every tenant.
 *   Those are three different questions. Picking one here would silently make it
 *   canonical, so this returns null until the meaning is settled.
 *
 * · documents covers tenant-scoped attachments. Attachments on PROPERTY-level
 *   timeline events are not included: TenantSpace's _attach is not exported, and
 *   re-implementing it here would be a second copy of the rule. The lease_documents
 *   table is likewise absent — it is a network read, and assemble() is pure.
 *
 * · attention is time-dependent by nature (lease expiry, warranty expiry). Two
 *   calls on the same day agree; the same property read a year later will not.
 *   That is the existing rule, composed, not a defect introduced here.
 *
 * PURITY
 * ------
 * assemble() reads. It performs no network call, writes nothing to Supabase or
 * localStorage, appends no timeline event, and does not mutate the property it
 * is given. Every array it returns is a fresh array.
 *
 * Dependencies arrive through `deps` (or `window` in the browser) so this file
 * stays Node-requirable with no browser global of its own. A dependency that is
 * absent yields null for its section and a name in meta.unavailable — which is
 * NOT the same answer as an empty list, and must never be read as one.
 */
(function (root) {
  'use strict';

  const CAM_SNAPSHOT_KEYS = ['camReconciliation', 'results'];

  function _dep(deps, name) {
    if (deps && deps[name]) return deps[name];
    if (root && root[name]) return root[name];
    return null;
  }

  function _arr(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }

  function _num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * The reconciliation snapshot, resolved the way every other consumer resolves
   * it. `camReconciliation` is the saved run; `results` is the older key that
   * still carries one on properties reconciled before the rename.
   */
  function _camSnapshot(property) {
    for (const k of CAM_SNAPSHOT_KEYS) {
      const snap = property && property[k];
      if (snap && typeof snap === 'object') return snap;
    }
    return null;
  }

  function _identity(property, deps) {
    const snap = _camSnapshot(property);
    const PR   = _dep(deps, 'PropertyReference');
    return {
      name:     (property && property.name) != null ? property.name : null,
      // The property's own year. A string '2025' and a number 2025 both occur in
      // stored data; the record normalises to a number so a consumer can compare.
      camYear:  _num((snap && snap.camYear) != null ? snap.camYear
                    : (property ? property.camYear : null)),
      totalSqft: _num(property && (property.totalSqft != null ? property.totalSqft : property.totalSqFt)),
      // Not derivable without choosing between three disagreeing rules. See LIMITS.
      leasedSqft: null,
      occupancy: (PR && typeof PR.occupancyPct === 'function') ? PR.occupancyPct(property) : null,
    };
  }

  function _spaces(property, deps) {
    const TS = _dep(deps, 'TenantSpace');
    if (!TS || typeof TS.assemble !== 'function') return null;
    return _arr(property && property.tenants).map(function (t) {
      const rec = TS.assemble(property, t && t.id);
      return {
        tenantId:   (t && t.id) != null ? t.id : null,
        tenantName: (t && t.tenant_name) != null ? t.tenant_name : null,
        // TenantSpace decides what a space is called and whether it has an
        // identity at all; both are reported, neither is second-guessed.
        space:      rec && rec.space ? rec.space : null,
        noIdentity: !!(rec && rec.noIdentity),
        lease:      rec && rec.lease ? rec.lease : null,
        summary:    rec && rec.summary != null ? rec.summary : null,
        counts: {
          events:     rec ? _arr(rec.events).length     : 0,
          documents:  rec ? _arr(rec.documents).length  : 0,
          invoices:   rec ? _arr(rec.invoices).length   : 0,
          photos:     rec ? _arr(rec.photos).length     : 0,
          warranties: rec ? _arr(rec.warranties).length : 0,
          notes:      rec ? _arr(rec.notes).length      : 0,
          disputes:   rec ? _arr(rec.disputes).length   : 0,
        },
        // The reconciliation row TenantSpace matched to this space, as it found
        // it. expectedCam and variance are whatever the authoritative CAM path
        // stored; this record does not compute either.
        camResult:  rec && rec.camResult ? rec.camResult : null,
      };
    });
  }

  /**
   * Provenance for every canonical lease field, per tenant, from the one
   * resolver. `_confidence` — the pre-Phase-D string — is deliberately not read:
   * it is the superseded notion of "verified" that the provenance model replaced.
   */
  function _fields(property, deps) {
    const FP = _dep(deps, 'FieldProvenance');
    const LI = _dep(deps, 'LeaseIntelligence');
    const out = {};
    if (!FP || typeof FP.fieldProvenance !== 'function') return out;
    const keys = (LI && Array.isArray(LI.CANONICAL_FIELDS)) ? LI.CANONICAL_FIELDS : null;
    if (!keys) return out;
    for (const t of _arr(property && property.tenants)) {
      if (!t || t.id == null) continue;
      const byField = {};
      for (const k of keys) {
        // fieldProvenance reads t[fieldKey]. Every canonical key matches its
        // tenant property except the cap base, which is stored as camelCase
        // `capBaseAmount` — so it travels through the opts.value override the
        // resolver already provides for values that are not on the tenant under
        // their canonical name. Renaming the stored property instead would be a
        // data migration for a naming mismatch.
        byField[k] = (k === 'cap_base_amount')
          ? FP.fieldProvenance(k, t, { value: t.capBaseAmount })
          : FP.fieldProvenance(k, t);
      }
      out[t.id] = byField;
    }
    return out;
  }

  function _cam(property, deps) {
    const snap = _camSnapshot(property);
    const CP   = _dep(deps, 'CamPool');
    const VB   = _dep(deps, 'VarianceBreakdown');
    const invoices = _arr(property && property.invoices);
    const results  = snap ? _arr(snap.results) : [];

    const pool = (CP && typeof CP.total === 'function') ? CP.total(invoices) : null;
    const billed = results.reduce(function (s, r) {
      const v = _num(r.allocatedAmount != null ? r.allocatedAmount : r.totalAllocated);
      return s + (v || 0);
    }, 0);

    let unallocated = null;
    if (VB && typeof VB.derive === 'function' && pool != null) {
      const bk = VB.derive({ results: results, invoices: invoices, pool: pool, billed: billed });
      unallocated = (bk && bk.difference != null) ? bk.difference : null;
    }

    return {
      pool: pool,
      // The stored rows, untouched. A consumer reading expectedCam or variance
      // here is reading what the reconciliation wrote, including nulls where no
      // capBaseAmount was on file.
      results: results.slice(),
      unallocated: unallocated,
      capped: results.filter(function (r) { return r && r.capApplied === true; }),
    };
  }

  /**
   * Property-level events are the ones NO space claimed.
   *
   * Rather than asking a second time "is this event a tenant's?" — which is the
   * question TenantSpace._scopedEvents already answers, with two hard-won guards
   * behind it — the tenant sets are taken from TenantSpace's own output and
   * subtracted. Identity comes from TimelineMerge.eventKey, the same key the
   * merge uses to decide whether two events are the same event.
   */
  function _timeline(property, spaces, deps) {
    const TM  = _dep(deps, 'TimelineMerge');
    const all = _arr(property && property.timeline);
    const byTenant = {};
    const claimed = new Set();

    if (spaces && TM && typeof TM.eventKey === 'function') {
      const TS = _dep(deps, 'TenantSpace');
      for (const s of spaces) {
        if (!s || s.tenantId == null) continue;
        const rec = (TS && typeof TS.assemble === 'function') ? TS.assemble(property, s.tenantId) : null;
        const evs = rec ? _arr(rec.events) : [];
        byTenant[s.tenantId] = evs.slice();
        for (const e of evs) { const k = TM.eventKey(e); if (k) claimed.add(k); }
      }
    }

    const propertyEvents = (TM && typeof TM.eventKey === 'function')
      ? all.filter(function (e) { const k = TM.eventKey(e); return k ? !claimed.has(k) : true; })
      : all.slice();

    return { property: propertyEvents, byTenant: byTenant };
  }

  /**
   * Documents as the system already records them: attachments filed against a
   * space, plus the lease document TenantSpace identifies for it. Each keeps the
   * identity it was stored with; nothing is synthesised from an evidence row, a
   * page number or a bare filename.
   */
  function _documents(property, deps) {
    const TS = _dep(deps, 'TenantSpace');
    if (!TS || typeof TS.assemble !== 'function') return null;
    const out = [];
    for (const t of _arr(property && property.tenants)) {
      if (!t || t.id == null) continue;
      const rec = TS.assemble(property, t.id);
      if (!rec) continue;
      for (const d of _arr(rec.documents)) {
        out.push({ tenantId: t.id, kind: d.kind || null, name: d.name || null,
                   url: d.url || null, when: d.when || null, from: d.from || null });
      }
      for (const d of _arr(rec.leaseDocs)) {
        out.push({ tenantId: t.id, kind: d.kind || null, name: d.name || null,
                   url: d.url || null, when: null, from: 'lease on file' });
      }
    }
    return out;
  }

  function assemble(property, deps) {
    const p = property || null;
    const spaces    = _spaces(p, deps);
    const documents = _documents(p, deps);
    const PW        = _dep(deps, 'PropertyWorkspace');
    const attention = (PW && typeof PW.collectAttention === 'function')
      ? PW.collectAttention(p) : null;

    const unavailable = [];
    if (spaces === null)    unavailable.push('spaces');
    if (documents === null) unavailable.push('documents');
    if (attention === null) unavailable.push('attention');
    if (!_dep(deps, 'FieldProvenance') || !_dep(deps, 'LeaseIntelligence')) unavailable.push('fields');
    if (!_dep(deps, 'CamPool'))          unavailable.push('cam.pool');
    if (!_dep(deps, 'VarianceBreakdown')) unavailable.push('cam.unallocated');
    if (!_dep(deps, 'TimelineMerge'))     unavailable.push('timeline.scoping');

    return {
      identity:  _identity(p, deps),
      spaces:    spaces,
      fields:    _fields(p, deps),
      cam:       _cam(p, deps),
      timeline:  _timeline(p, spaces, deps),
      disputes:  _arr(p && p.disputes).slice(),
      attention: attention,
      documents: documents,
      // Absence with a reason. `spaces: null` means "could not be composed", and
      // a reader must not collapse that into "this property has no spaces".
      meta: { unavailable: unavailable },
    };
  }

  const api = { assemble: assemble };
  if (root) root.PropertyRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
