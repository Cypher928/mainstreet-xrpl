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
 *   identity.leasedSqft  PropertyArea.leasedSqft — Σ leased_sqft over EVERY
 *                        tenant, and only when every tenant has one. Null with
 *                        a reason otherwise. (M7. Was always null; see LIMITS.)
 *   identity.occupancy   PropertyArea.occupancyPct — leasedSqft / totalSqft from
 *                        the SAME numerator, so the pair cannot contradict each
 *                        other, and NOT clamped: leased > total returns null
 *                        with reason 'exceeds_total' rather than a confident
 *                        100. (M7. Was PropertyReference.occupancyPct, which is
 *                        one of the three disagreeing leased-area rules.)
 *   identity.areaBasis   why the two above are what they are — the rule applied,
 *                        the reason for a null, and how many tenants lack an area
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
 * · identity.leasedSqft was ALWAYS null until M7, because three modules compute
 *   a property-level leased total and do not agree: acquisition-engine sums
 *   parseFloat(leased_sqft) while skipping extractionFailed tenants,
 *   lease-review-packets sums over "active" tenants only, and
 *   PropertyReference.occupancyPct sums (leased_sqft || sqft) over every tenant.
 *   M7 settled it — see property-area.js for why all three are wrong in the
 *   same way, and what replaced them. It is still null whenever ANY tenant
 *   lacks an area, which is the honest answer far more often than not; what
 *   changed is that a property whose roster is complete now gets a number, and
 *   occupancy is derived from that same number rather than from a fourth rule.
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

  /**
   * M7 — leased area and occupancy now come from ONE definition, or from
   * neither.
   *
   * This used to return `leasedSqft: null` (three modules disagree, so refuse)
   * while publishing `occupancy` from PropertyReference.occupancyPct — which is
   * one of those three disagreeing rules. The record declined to state the
   * numerator and published a ratio computed from it, so a consumer could
   * recover the refused number by multiplying occupancy by totalSqft.
   *
   * PropertyArea settles it: leased area is the sum of leased_sqft over every
   * tenant, and only when every tenant has one — no `|| 0`, no `|| sqft`, no
   * "active" filter, because each of those substitutes a guess for a tenant
   * whose area is unknown. Occupancy is derived from that same numerator, so
   * the two can no longer contradict each other, and both are null together.
   *
   * `areaBasis` travels with them so a reader never has to infer why a null is
   * null — and, when a value IS present, what it was computed from.
   */
  function _area(property, deps) {
    const PA = _dep(deps, 'PropertyArea');
    if (!PA || typeof PA.occupancyPct !== 'function') {
      return { leasedSqft: null, occupancy: null,
               basis: { available: false, reason: 'property_area_module_absent',
                        tenantsMissingArea: null } };
    }
    const occ = PA.occupancyPct(property);
    return {
      leasedSqft: occ.leasedSqft,
      occupancy:  occ.value,
      basis: {
        available: true,
        // 'Σ leased_sqft over every tenant, only when every tenant has one.'
        rule: 'sum_leased_sqft_all_tenants_complete',
        reason: occ.reason,
        tenantsMissingArea: occ.tenantsMissingArea,
        // Stated rather than implied: this ratio is NOT clamped. A property
        // whose tenant areas exceed its own total returns null with reason
        // 'exceeds_total', because that contradiction is the data telling you
        // something is wrong and a clamp to 100 would erase it.
        clamped: false,
      },
    };
  }

  function _identity(property, deps) {
    const snap = _camSnapshot(property);
    const area = _area(property, deps);
    return {
      name:     (property && property.name) != null ? property.name : null,
      // The property's own year. A string '2025' and a number 2025 both occur in
      // stored data; the record normalises to a number so a consumer can compare.
      camYear:  _num((snap && snap.camYear) != null ? snap.camYear
                    : (property ? property.camYear : null)),
      totalSqft: _num(property && (property.totalSqft != null ? property.totalSqft : property.totalSqFt)),
      leasedSqft: area.leasedSqft,
      occupancy:  area.occupancy,
      areaBasis:  area.basis,
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
   * The canonical key whose value is not stored under its own name.
   * `cap_base_amount` lives on the tenant as camelCase `capBaseAmount`; renaming
   * the stored property would be a data migration for a naming mismatch.
   */
  const FIELD_STORAGE_KEY = { cap_base_amount: 'capBaseAmount' };

  /** The value the resolver will judge, read the same way the resolver reads it. */
  function _fieldValue(tenant, key) {
    const stored = FIELD_STORAGE_KEY[key] || key;
    const v = tenant ? tenant[stored] : undefined;
    return v === undefined ? null : v;
  }

  /**
   * WHAT KIND OF FACT A FIELD IS — a separate axis from what evidence backs it.
   *
   * M8b exists for one field. `cap_base_amount` sits in CANONICAL_FIELDS beside
   * twelve lease terms, and it is not one: it is LAST YEAR'S ACTUAL CAM CHARGE
   * for this tenant. The application's own label says so —
   *
   *     "Prior-Year CAM Base ($) — last year's total CAM charge for this
   *      tenant. Required to calculate the cap ceiling."      script.js:8605
   *
   * — no lease states it, the extraction schema never requests it
   * (api/_claude-tasks.js has no cap_base_amount key), and script.js:2134 will
   * not accept one without a quote that extraction cannot produce. It reaches a
   * record only when a person types it into that input.
   *
   * That matters because it is the dollar operand of every cap ceiling. A
   * reader that saw it in a list of lease fields and inferred "the lease says
   * the base is $100,000" would be wrong in the direction this codebase spends
   * its time preventing — so the record states the kind of fact, every time,
   * whatever evidence happens to be attached.
   *
   * `extractable` is DERIVED from FieldProvenance.NEVER_EXTRACTED rather than
   * restated here: that module already owns the fact and already floors such a
   * field to `manually_entered`. Two lists would be one too many.
   */
  const OPERATING_ACTUAL = {
    cap_base_amount:
      'Last year\'s actual CAM charge for this tenant, typed by a person. NOT a ' +
      'lease term: no lease states it, no extractor produces it, and it is the ' +
      'dollar operand of the cap ceiling. Never describe it as lease-supported.',
  };

  function _fieldOrigin(key, FP) {
    const never = !!(FP && FP.NEVER_EXTRACTED && FP.NEVER_EXTRACTED[key] === true);
    const note  = OPERATING_ACTUAL[key] || null;
    return {
      // 'lease_term'       a clause in the lease document
      // 'operating_actual' a figure from operations, entered by a person
      kind: note ? 'operating_actual' : 'lease_term',
      // Can any extractor produce this at all? Derived, not restated.
      extractable: !never,
      note: note,
    };
  }

  /**
   * Provenance AND VALUE for every canonical lease field, per tenant, from the
   * one resolver. `_confidence` — the pre-Phase-D string — is deliberately not
   * read: it is the superseded notion of "verified" that the provenance model
   * replaced.
   *
   * M8a — WHY THE VALUE IS HERE NOW.
   *
   * FieldProvenance answers "what stands behind this field?" and returns
   * thirteen keys, none of them the value. That is coherent for a provenance
   * resolver and it was the only route seven canonical fields had to any
   * reader — so an agent could learn that a named reviewer entered the cap base
   * and could not learn what it is. The values were never lost: they survive
   * ingest, normalizeTenant and _stripBlobs, and most are stored a second time
   * in tenant_field_evidence.value. They were simply never picked up.
   *
   * The value projected is THE SAME `raw` the resolver judged, read through the
   * same storage-key rule. Projecting a different one would let value and state
   * describe different things — the field would report `manually_confirmed`
   * beside a number nobody confirmed.
   *
   * `valuePresent` is derived from `state === 'unknown'`, which is exactly the
   * resolver's own emptiness test (`_isEmpty(raw) ⇒ return out`, and every other
   * path sets a different state). Re-implementing that test here would be a
   * second definition of empty; test-m8 pins the equivalence across '', '   ',
   * null, undefined and 0 so the two cannot drift.
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
        const raw = _fieldValue(t, k);
        // The cap base travels through opts.value because it is not stored
        // under its canonical name; every other key is on the tenant already.
        const prov = (FIELD_STORAGE_KEY[k])
          ? FP.fieldProvenance(k, t, { value: raw })
          : FP.fieldProvenance(k, t);
        const present = prov.state !== 'unknown';
        byField[k] = Object.assign({}, prov, {
          // Null when the resolver found nothing. A caller reading `value: null`
          // alongside `state: 'unknown'` is being told the field is genuinely
          // absent from the record — not that it could not be read. A section
          // that could not be read is null at the SECTION level (meta.unavailable
          // / evidence.read_failed), which is a different answer entirely.
          value: present ? raw : null,
          valuePresent: present,
          origin: _fieldOrigin(k, FP),
        });
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
