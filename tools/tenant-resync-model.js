'use strict';
/**
 * tools/tenant-resync-model.js — an executable model of resync_property_tenants.
 *
 * NOT LOADED BY THE APPLICATION. It exists so the safety properties of
 * migrations/021_safe_tenant_resync.sql can be TESTED rather than read. The
 * procedure runs in Postgres and the test suite does not have a Postgres; a
 * model that mirrors its decision structure is the next best thing, and a
 * model that drifts from the SQL is worse than none — so the suite also pins
 * the SQL text that each rule here corresponds to.
 *
 * What it deliberately models:
 *   • an empty or all-unusable roster is a NO-OP, never a delete
 *   • a row with no id is REFUSED, never given one
 *   • present rows are UPSERTED, so an existing id keeps its row
 *   • an absent tenant is deleted ONLY IF nothing references it
 *
 * What it does not model: authorization, transactions, types. Those are the
 * database's job and asserting them here would be theatre.
 */

/**
 * @param {object} db     { tenants: [{id, property_id, name, ...}],
 *                          camRefs: [tenantId], evidenceRefs: [tenantId] }
 * @param {string} propertyId
 * @param {Array}  rows   incoming roster: [{ id, name, ... }]
 * @returns {{db: object, result: object}} a NEW db — the input is never mutated,
 *          so a test can compare before against after.
 */
function resync(db, propertyId, rows) {
  const tenants = (db.tenants || []).map(t => ({ ...t }));
  const camRefs = new Set((db.camRefs || []).map(String));
  const evRefs  = new Set((db.evidenceRefs || []).map(String));
  const next = { ...db, tenants };

  const usable = (rows || []).filter(r =>
    r && typeof r.name === 'string' && r.name.trim() !== '' && r.id);
  const skipped = (rows || []).length - usable.length;

  // ── An empty roster asserts nothing ──────────────────────────────────────
  if (!usable.length) {
    return { db: next, result: {
      ok: true, upserted: 0, skipped, deleted: 0, retained_referenced: 0,
      noop_reason: (rows || []).length === 0 ? 'empty_roster' : 'no_usable_rows',
    } };
  }

  // ── Upsert ───────────────────────────────────────────────────────────────
  const incoming = new Set(usable.map(r => String(r.id)));
  for (const r of usable) {
    const i = tenants.findIndex(t => String(t.id) === String(r.id));
    const row = { id: r.id, property_id: propertyId, name: r.name.trim(),
                  sqft: r.sqft ?? null, cap: r.cap ?? null,
                  start_date: r.start_date ?? null, end_date: r.end_date ?? null,
                  lease_url: r.lease_url ?? null, lease_type: r.lease_type ?? null };
    // An upsert preserves the row's existence and therefore its created_at;
    // a delete-then-insert would not, which is why the old procedure reset
    // created_at for every tenant of a property on every save.
    if (i >= 0) tenants[i] = { ...tenants[i], ...row };
    else        tenants.push({ ...row, created_at: 'NEW' });
  }

  // ── Prune only what nothing references ───────────────────────────────────
  const absent = tenants.filter(t =>
    t.property_id === propertyId && !incoming.has(String(t.id)));
  const referenced = absent.filter(t => camRefs.has(String(t.id)) || evRefs.has(String(t.id)));
  const removable  = absent.filter(t => !camRefs.has(String(t.id)) && !evRefs.has(String(t.id)));

  next.tenants = tenants.filter(t => !removable.some(r => String(r.id) === String(t.id)));

  return { db: next, result: {
    ok: true, upserted: usable.length, skipped,
    deleted: removable.length, retained_referenced: referenced.length,
  } };
}

/** Would any reference be left dangling by this database state? */
function danglingRefs(db) {
  const ids = new Set((db.tenants || []).map(t => String(t.id)));
  return [
    ...(db.camRefs      || []).map(String).filter(r => !ids.has(r)).map(r => ({ src: 'cam', tenant_id: r })),
    ...(db.evidenceRefs || []).map(String).filter(r => !ids.has(r)).map(r => ({ src: 'evidence', tenant_id: r })),
  ];
}

module.exports = { resync, danglingRefs };
