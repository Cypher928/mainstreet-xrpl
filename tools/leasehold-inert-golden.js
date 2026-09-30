'use strict';
/**
 * tools/leasehold-inert-golden.js — Step A-1's promise, measured: with every
 * leasehold active (which is all of them until 038 + Step B exist), the
 * lifecycle work changes NOTHING a consumer computes.
 *
 *   node tools/leasehold-inert-golden.js            compare with the recorded golden
 *   node tools/leasehold-inert-golden.js --record   (re)record it — ONLY from pre-A-1 code
 *
 * The golden (evidence/2026-09-30-leasehold-inert-golden.json) was recorded from
 * pilot@86bf359, before A-1 changed a line. It holds the outputs of every pure
 * consumer A-1 touches, over the demo snapshot's two properties, the table-shaped
 * demo tenants and a synthetic property carrying every term shape (past, inside
 * the period, future, missing and unreadable dates; a vacancy; a failed
 * extraction; a pending job; an extraction `status`):
 *
 *   TenantNormalize.normalizeTenant   — every key it had before, per tenant (the
 *                                       three lifecycle keys A-1 adds are checked
 *                                       separately: active / null / null)
 *   LeasePeriod.classify / occupancy  — per tenant × four CAM years
 *   Selectors                         — derivePropertyReadiness, computePortfolioIntel,
 *                                       portfolioKPIs, getReviewQueueItems
 *   AcquisitionEngine                 — computeRevenueAtRisk, computePortfolioIntelligence,
 *                                       computeRevenueForecast, computeRenewalPipeline,
 *                                       computePortfolioActions
 *   PropertyCabinet                   — activeTenants, spaces, importantDates
 *   PropertyRecord.assemble           — the whole record (spaces, fields, cam, attention…)
 *   LeaseReviewPackets                — generateLenderSummaryHtml (md5)
 *
 * The clock is frozen at 2026-09-30T12:00:00Z so "expired" means the same thing
 * on every run.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const GOLDEN = path.join(ROOT, 'evidence', '2026-09-30-leasehold-inert-golden.json');
const RECORD = process.argv.includes('--record');
const LIFECYCLE_KEYS = ['leasehold_status', 'ended_at', 'ended_reason'];

// ── frozen clock ────────────────────────────────────────────────────────────
const FIXED = Date.parse('2026-09-30T12:00:00Z');
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
  static now() { return FIXED; }
}
global.Date = FrozenDate;

// ── modules ─────────────────────────────────────────────────────────────────
const TN = require(path.join(ROOT, 'tenant-normalize.js'));
const LP = require(path.join(ROOT, 'lease-period.js'));
const AE = require(path.join(ROOT, 'acquisition-engine.js'));
const PC = require(path.join(ROOT, 'property-cabinet.js'));
const PR = require(path.join(ROOT, 'property-record.js'));
const DEPS = require(path.join(ROOT, 'api', '_server-deps.js'));
// Browser-first IIFEs, loaded the way test-cross-report-fixture.js loads them:
// each against a window object, free names resolved on the global.
const W = {};
// ReviewEngine reads SourceValues (the one reader of a lease's area) from the global.
W.SourceValues = global.SourceValues = require(path.join(ROOT, 'source-values.js'));
// Step A-1: the lifecycle predicate every consumer asks, loaded as the page loads it.
W.LeaseholdStatus = global.LeaseholdStatus = require(path.join(ROOT, 'leasehold-status.js'));
['lease-intelligence.js', 'review-engine.js', 'selectors.js', 'lease-review-packets.js'].forEach(f => {
  new Function('window', fs.readFileSync(path.join(ROOT, f), 'utf8')).call({ window: W }, W);
  Object.keys(W).forEach(k => { if (global[k] === undefined) global[k] = W[k]; });
});
const SEL = W.Selectors;
const LRP = W.LeaseReviewPackets;

// ── fixtures ────────────────────────────────────────────────────────────────
const snapWin = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'demo-snapshot.js'), 'utf8'))(snapWin);
const SNAP = snapWin.__MS_DEMO_SNAPSHOT;
const clone = (o) => JSON.parse(JSON.stringify(o));
function propFrom(row) {
  const d = row.data || {};
  return {
    id: row.id, name: row.name, totalSqft: row.sqft || d.totalSqft || 0,
    tenants: (d.tenants || []).map(TN.normalizeTenant),
    invoices: d.invoices || [], disputes: d.disputes || [], timeline: d.timeline || [],
    camYear: d.camYear ?? null, camReconciliation: d.camReconciliation ?? null, results: d.results ?? null,
    info: d.info || null, settlement: d.settlement ?? null, activityLog: [],
  };
}
const MIXED = {
  id: 'fixture-mixed', name: 'Mixed Terms Plaza', totalSqft: 20000,
  invoices: [], disputes: [], timeline: [], camYear: 2025, camReconciliation: null, results: null, info: null,
  tenants: [
    { id: 'm1', tenant_name: 'Past End Co', suite: '101', leased_sqft: 2000, start_date: '2015-01-01', end_date: '2020-12-31', lease_type: 'NNN', cap: 5 },
    { id: 'm2', tenant_name: 'Ends In Year LLC', suite: '102', leased_sqft: 1500, start_date: '2019-06-01', end_date: '2025-06-30', lease_type: 'NNN' },
    { id: 'm3', tenant_name: 'Future Fitness', suite: '103', leased_sqft: 3000, start_date: '2022-03-01', end_date: '2031-02-28', lease_type: 'Gross', cap: 4 },
    { id: 'm4', tenant_name: 'No End Date Inc', suite: '104', leased_sqft: 1200, start_date: '2021-01-01', end_date: '' },
    { id: 'm5', tenant_name: 'No Start Date', suite: '105', leased_sqft: 900, start_date: '', end_date: '2027-01-31' },
    { id: 'm6', tenant_name: 'Unreadable Term', suite: '106', leased_sqft: 800, start_date: 'TBD', end_date: 'see exhibit B' },
    { id: 'm7', tenant_name: '', suite: '107', leased_sqft: 1100, vacant: true },
    { id: 'm8', tenant_name: 'Failed Extraction', suite: '108', leased_sqft: 700, extractionFailed: true },
    { id: 'm9', tenant_name: 'Pending Job', suite: '109', leased_sqft: 600, _pendingJobReview: true },
    { id: 'm10', tenant_name: 'Extraction Status Success', suite: '110', leased_sqft: 1000, start_date: '2020-01-01', end_date: '2026-12-31', status: 'success' },
    { id: 'm11', tenant_name: 'Commences In Year', suite: '111', leased_sqft: 1000, start_date: '2025-04-01', end_date: '2030-03-31', lease_type: 'NNN' },
  ].map(TN.normalizeTenant),
};
const TABLE_ROWS = (SNAP.tenants || []).map(t => TN.normalizeTenant({
  id: t.id, tenant_name: t.name, leased_sqft: t.sqft, cap: t.cap, start_date: t.start_date,
  end_date: t.end_date, lease_url: t.lease_url, lease_type: t.lease_type,
}));
const PROPS = [...SNAP.properties.map(propFrom), MIXED];

// ── stable serialisation ────────────────────────────────────────────────────
function stable(v, seen = new WeakSet()) {
  if (v === undefined) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  if (typeof v === 'function') return '[fn]';
  if (v instanceof RealDate) return v.toISOString();
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return '[circular]';
  seen.add(v);
  if (Array.isArray(v)) return v.map(x => stable(x, seen));
  const o = {};
  Object.keys(v).sort().forEach(k => { o[k] = stable(v[k], seen); });
  return o;
}
const withoutLifecycle = (t) => { const c = Object.assign({}, t); LIFECYCLE_KEYS.forEach(k => delete c[k]); return c; };
const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');
const safe = (fn) => { try { return fn(); } catch (e) { return { threw: String(e && e.message || e) }; } };

// ── the measurement ─────────────────────────────────────────────────────────
function measure() {
  const out = {};
  const REF = new FrozenDate();
  const periods = [2019, 2024, 2025, 2026];
  const allTenants = [...PROPS.flatMap(p => p.tenants), ...TABLE_ROWS];

  out.normalize = allTenants.map(t => withoutLifecycle(TN.normalizeTenant(clone(t))));
  out.leasePeriod = allTenants.map(t => periods.map(y => ({
    y, classify: safe(() => LP.classify(t, LP.periodForYear(y))), occupancy: safe(() => LP.occupancy(t, LP.periodForYear(y))),
  })));
  out.selectors = {
    readiness: PROPS.map(p => safe(() => SEL.derivePropertyReadiness(clone(p)))),
    intel:     safe(() => SEL.computePortfolioIntel(clone(PROPS))),
    kpis:      safe(() => SEL.portfolioKPIs(clone(PROPS))),
    queue:     safe(() => SEL.getReviewQueueItems(clone(PROPS))),
  };
  out.acquisitionEngine = {
    rar:       safe(() => AE.computeRevenueAtRisk(clone(PROPS), REF)),
    intel:     safe(() => AE.computePortfolioIntelligence(clone(PROPS), REF)),
    forecast:  safe(() => AE.computeRevenueForecast(clone(PROPS), REF)),
    pipeline:  safe(() => AE.computeRenewalPipeline(clone(PROPS), REF)),
    actions:   safe(() => AE.computePortfolioActions(clone(PROPS), [], REF)),
  };
  out.cabinet = PROPS.map(p => ({
    active: safe(() => PC.activeTenants(clone(p)).map(t => t.id)),
    spaces: safe(() => PC.spaces(clone(p))),
    dates:  safe(() => PC.importantDates(clone(p), { today: '2026-09-30' })),
  }));
  const deps = DEPS.load();
  out.record = PROPS.map(p => safe(() => {
    const r = DEPS.withWindow(() => PR.assemble(clone(p), deps));
    return { spaces: r.spaces, fields: r.fields, cam: r.cam, attention: r.attention, identity: r.identity, meta: r.meta };
  }));
  out.lenderSummary = PROPS.map(p => safe(() => md5(LRP.generateLenderSummaryHtml(clone(p), {}))));
  return stable(out);
}

const now = measure();
// The lifecycle keys A-1 adds must read active / null / null on every tenant.
const lc = [...PROPS.flatMap(p => p.tenants), ...TABLE_ROWS].map(t => TN.normalizeTenant(clone(t)));
const lifecycleOk = lc.every(t => !('leasehold_status' in t) ||
  (t.leasehold_status === 'active' && t.ended_at === null && t.ended_reason === null));

if (RECORD) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify({
    recordedFrom: 'pilot@86bf359 (before Step A-1)', frozenClock: '2026-09-30T12:00:00Z', outputs: now,
  }, null, 1));
  console.log('recorded', GOLDEN, md5(JSON.stringify(now)));
  process.exit(0);
}

const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).outputs;
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')); } };
console.log('\n══ Step A-1 inert golden — all-active outputs unchanged ══');
for (const k of Object.keys(golden)) {
  const a = JSON.stringify(golden[k]), b = JSON.stringify(now[k]);
  let where = '';
  if (a !== b) { let i = 0; while (i < a.length && a[i] === b[i]) i++; where = `first difference at char ${i}: …${a.slice(Math.max(0, i - 80), i + 80)}… vs …${b.slice(Math.max(0, i - 80), i + 80)}…`; }
  check(`${k}: identical to the pre-A-1 golden`, a === b, where);
}
check('every tenant\'s lifecycle reads active / null / null', lifecycleOk);
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
