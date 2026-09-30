'use strict';
/**
 * test-leasehold-status.js — Step A-1: ONE answer to "is this leasehold current?"
 *
 *   node test-leasehold-status.js
 *
 * Offline and read-only. Migration 037 gave every leasehold a lifecycle
 * (leasehold_status active | ended, ended_at, ended_reason). No leasehold is
 * ended yet — ending is 038 / Step B — so A-1 is plumbing, and this suite proves
 * the plumbing does what it will need to do the day a leasehold IS ended, while
 * tools/leasehold-inert-golden.js proves an all-active roster computes exactly
 * what it did before.
 *
 *   A  the predicate itself (leasehold-status.js)
 *   B  tenant-normalize's allow-list carries the triple by the SAME rule
 *   C  every page loads leasehold-status.js before anything that asks it
 *   D  LeasePeriod: once ended, the confirmed ended_at governs; active unchanged
 *   E  the consumers, fed an ENDED leasehold, treat it as history
 *   F  one rule: nobody else compares leasehold_status, and nobody falls back
 *   G  fail loudly: a consumer without the module throws, it does not guess
 */
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(m, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const LS = require('./leasehold-status.js');
const TN = require('./tenant-normalize.js');
const LP = require('./lease-period.js');

// The ended fixture every section below reuses.
const ENDED_BEFORE = { id: 'e1', tenant_name: 'Gone Before Co', suite: '201', leased_sqft: 2000, lease_type: 'NNN',
  start_date: '2018-01-01', end_date: '2027-12-31', base_rent: 60000,
  leasehold_status: 'ended', ended_at: '2024-06-30', ended_reason: 'terminated_early' };
const ENDED_WITHIN = { id: 'e2', tenant_name: 'Left Midyear LLC', suite: '202', leased_sqft: 1000, lease_type: 'NNN',
  start_date: '2019-01-01', end_date: '2028-12-31', base_rent: 30000,
  leasehold_status: 'ended', ended_at: '2025-06-30', ended_reason: 'surrendered' };
const HOLDOVER_ENDED = { id: 'e3', tenant_name: 'Held Over Inc', suite: '203', leased_sqft: 900,
  start_date: '2015-01-01', end_date: '2024-12-31',
  leasehold_status: 'ended', ended_at: '2025-03-31', ended_reason: 'lease_expired' };
const ACTIVE = { id: 'a1', tenant_name: 'Still Here Ltd', suite: '101', leased_sqft: 3000, lease_type: 'NNN',
  start_date: '2020-01-01', end_date: '2030-12-31', base_rent: 90000, cap: 5 };
const ACTIVE_PAST_END = { id: 'a2', tenant_name: 'Past End But Active', suite: '102', leased_sqft: 500,
  start_date: '2010-01-01', end_date: '2020-12-31' };

// ── A ──────────────────────────────────────────────────────────────────────
sec('A. leasehold-status.js — the rule');
{
  eq(LS.STATUSES, ['active', 'ended'], 'A1 two statuses');
  eq(LS.REASONS, ['lease_expired', 'terminated_early', 'surrendered', 'evicted', 'other'], 'A2 the five approved reasons (no "assigned")');
  is(LS.isEnded(ENDED_BEFORE) && !LS.isCurrent(ENDED_BEFORE), 'A3 leasehold_status "ended" is ended');
  is(LS.isCurrent(ACTIVE) && !LS.isEnded(ACTIVE), 'A4 no lifecycle field (a pre-037 blob row) is current');
  is(LS.isCurrent({ leasehold_status: 'active' }), 'A5 "active" is current');
  is(LS.isCurrent({ leasehold_status: 'ENDED' }) && LS.isCurrent({ leasehold_status: 'closed' }) && LS.isCurrent({ leasehold_status: null }),
     'A6 only exactly "ended" ends a leasehold — case variants and garbage are current');
  is(LS.isCurrent(ACTIVE_PAST_END), 'A7 D9: a past contractual end_date does NOT end a leasehold');
  is(LS.isCurrent({ status: 'ended' }), 'A8 N1: the extraction `status` field is not the lifecycle');
  is(!LS.isCurrentLease({ vacant: true }) && LS.isCurrent({ vacant: true }), 'A9 a vacancy is current but not a lease');
  is(!LS.isCurrentLease(null) && !LS.isEnded(null) && !LS.inPeriodRoster(null, null), 'A10 null is nothing');
  eq(LS.endedAt(ENDED_BEFORE), '2024-06-30', 'A11 endedAt is the confirmed end');
  eq(LS.endedAt(Object.assign({}, ACTIVE, { ended_at: '2024-01-01' })), null, 'A12 an active row has no endedAt even if a stray ended_at is present');
  eq(LS.endedAt({ leasehold_status: 'ended', ended_at: '2024-06-30T00:00:00Z' }), '2024-06-30', 'A13 a timestamp reads as its date');
  const P25 = { start: '2025-01-01', end: '2025-12-31' };
  is(!LS.inPeriodRoster(ENDED_BEFORE, P25), 'A14 ended before the period began: out of the period roster');
  is(LS.inPeriodRoster(ENDED_WITHIN, P25), 'A15 ended inside the period: in the roster (it owes the part it occupied)');
  is(LS.inPeriodRoster(Object.assign({}, ENDED_BEFORE, { ended_at: '2025-01-01' }), P25), 'A16 ended ON the first day: in the roster');
  is(LS.inPeriodRoster({ leasehold_status: 'ended' }, P25), 'A17 ended with no ended_at: kept, so LeasePeriod can say the end is unknown');
  is(LS.inPeriodRoster(ENDED_BEFORE, null), 'A18 no period known: an ended row is kept for the caller to reason about');
  is(LS.inPeriodRoster(ACTIVE, P25) && LS.inPeriodRoster(ACTIVE_PAST_END, P25), 'A19 an active leasehold is always in the roster');
  eq(LS.lifecycleFrom({ leasehold_status: 'ended', ended_at: '2024-06-30', ended_reason: 'evicted' }),
     { leasehold_status: 'ended', ended_at: '2024-06-30', ended_reason: 'evicted' }, 'A20 lifecycleFrom keeps a valid ended triple');
  eq(LS.lifecycleFrom({ leasehold_status: 'active', ended_at: '2024-06-30', ended_reason: 'evicted' }),
     { leasehold_status: 'active', ended_at: null, ended_reason: null }, 'A21 an active leasehold carries no end fields');
  eq(LS.lifecycleFrom({ leasehold_status: 'ended', ended_at: 'soon', ended_reason: 'assigned' }),
     { leasehold_status: 'ended', ended_at: null, ended_reason: null }, 'A22 invalid date and unknown reason are dropped, not guessed');
  eq(LS.lifecycleFrom(null), { leasehold_status: 'active', ended_at: null, ended_reason: null }, 'A23 nothing reads active');
  const src = read('leasehold-status.js');
  is(!/end_date/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'A24 the module never reads end_date');
}

// ── B ──────────────────────────────────────────────────────────────────────
sec('B. normalizeTenant carries the triple, by the same rule');
{
  const inputs = [
    {}, { leasehold_status: 'active' }, { leasehold_status: 'ended' },
    { leasehold_status: 'ended', ended_at: '2024-06-30', ended_reason: 'other' },
    { leasehold_status: 'ended', ended_at: '2024-06-30T12:00:00Z', ended_reason: 'surrendered' },
    { leasehold_status: 'ended', ended_at: 'bad', ended_reason: 'assigned' },
    { leasehold_status: 'active', ended_at: '2024-06-30', ended_reason: 'evicted' },
    { leasehold_status: 'Ended', ended_at: '2024-06-30' }, { status: 'ended' },
  ];
  let same = true, detail = '';
  for (const i of inputs) {
    const n = TN.normalizeTenant(Object.assign({ tenant_name: 'X' }, i));
    const got = { leasehold_status: n.leasehold_status, ended_at: n.ended_at, ended_reason: n.ended_reason };
    if (JSON.stringify(got) !== JSON.stringify(LS.lifecycleFrom(i))) { same = false; detail = JSON.stringify(i); }
  }
  is(same, 'B1 normalizeTenant and LeaseholdStatus.lifecycleFrom agree on every input', detail);
  const twice = TN.normalizeTenant(TN.normalizeTenant(ENDED_BEFORE));
  eq([twice.leasehold_status, twice.ended_at, twice.ended_reason], ['ended', '2024-06-30', 'terminated_early'],
     'B2 the triple survives a second pass (the reload path) — the allow-list keeps it');
  const n = TN.normalizeTenant({ tenant_name: 'X', status: 'success' });
  is(!('status' in n), 'B3 N1: the extraction `status` field is not added to the allow-list');
}

// ── C ──────────────────────────────────────────────────────────────────────
sec('C. leasehold-status.js loads before everything that asks it');
{
  const html = read('index.html');
  const at = (f) => html.indexOf('<script src="' + f + '"></script>');
  const ls = at('leasehold-status.js');
  is(ls > 0, 'C1 index.html loads leasehold-status.js');
  const consumers = ['lease-period.js', 'tenant-normalize.js', 'reconciliation-engine.js', 'selectors.js', 'lease-review-packets.js',
    'acquisition-engine.js', 'command-center.js', 'ai-workspace.js', 'script.js', 'property-cabinet.js', 'property-reference.js',
    'property-os.js', 'tenant-space.js', 'property-area.js', 'property-record.js'];
  const late = consumers.filter(f => at(f) >= 0 && at(f) < ls);
  eq(late, [], 'C2 every consumer on the page loads after it');
  const qa = read('qa.html');
  is(qa.indexOf('leasehold-status.js') > 0 && qa.indexOf('leasehold-status.js') < qa.indexOf('selectors.js'),
     'C3 qa.html loads it before selectors.js too');
  const deps = read('api/_server-deps.js');
  is(/'\.\.\/leasehold-status\.js':\s*\(\)\s*=>\s*require\('\.\.\/leasehold-status\.js'\)/.test(deps) && /_shim\.LeaseholdStatus = deps\.LeaseholdStatus/.test(deps),
     'C4 the server shim carries it by a string-literal require, placed on the sealed window');
}

// ── D ──────────────────────────────────────────────────────────────────────
sec('D. LeasePeriod — the confirmed end governs once ended; active is unchanged');
{
  const P25 = LP.periodForYear(2025);
  const cb = LP.classify(ENDED_BEFORE, P25);
  eq([cb.case, cb.overlapsPeriod, cb.needsOccupancyConfirmation], ['ended_confirmed_before', false, false],
     'D1 ended before the period: its own case, no overlap, nothing to confirm');
  const ob = LP.occupancy(ENDED_BEFORE, P25);
  eq([ob.excluded, ob.unresolved, ob.applied], [true, false, false], 'D2 occupancy: excluded — not unresolved, not a factor applied to money');
  const cw = LP.classify(ENDED_WITHIN, P25);
  eq([cw.case, cw.leaseEnd, cw.endConfirmed, cw.contractEnd, cw.needsOccupancyConfirmation],
     ['expires_within', '2025-06-30', true, '2028-12-31', false],
     'D3 ended inside the period: the term ends at ended_at (not end_date), confirmed, so no question');
  const ow = LP.occupancy(ENDED_WITHIN, P25);
  eq([ow.applied, ow.numerator, ow.denominator, ow.overlapEnd], [true, 181, 365, '2025-06-30'], 'D4 and is apportioned to 1 Jan – 30 Jun');
  const ch = LP.classify(HOLDOVER_ENDED, P25);
  eq([ch.leaseEnd, ch.case, ch.needsOccupancyConfirmation], ['2025-03-31', 'expires_within', false],
     'D5 a holdover that later ended: ended_at after end_date governs (no "ended before" question)');
  const cu = LP.classify({ tenant_name: 'X', start_date: '2020-01-01', end_date: '2030-01-01', leasehold_status: 'ended' }, P25);
  eq([cu.case, cu.needsOccupancyConfirmation], ['ended_unknown_end', true], 'D6 ended with no ended_at: unknown, and it fails closed');
  eq(LP.occupancy({ tenant_name: 'X', start_date: '2020-01-01', leasehold_status: 'ended' }, P25).unresolved, true, 'D7 whose occupancy is unresolved');
  const late = LP.classify(Object.assign({}, ENDED_WITHIN, { start_date: '2025-03-01' }), P25);
  eq([late.case, late.needsOccupancyConfirmation], ['within_period', true], 'D8 a late start still asks, even with a confirmed end');
  const act = LP.classify(ACTIVE_PAST_END, P25);
  eq([act.case, act.needsOccupancyConfirmation, 'lifecycle' in act, 'endConfirmed' in act], ['ended_before', true, false, false],
     'D9 an ACTIVE leasehold past its end_date is exactly as before: ended_before, asks, no lifecycle keys');
  const at = LP.obligationTerm(ACTIVE);
  is(!('lifecycle' in at) && !('endSource' in at) && at.end === '2030-12-31', 'D10 an active term carries no new keys');
  const src = read('lease-period.js');
  is(/lateStart \|\| \(earlyEnd && !endConfirmed\) \|\| out\.assumedStart/.test(src), 'D11 the confirmation formula is the approved one');
}

// ── E ──────────────────────────────────────────────────────────────────────
sec('E. The consumers, fed an ENDED leasehold, treat it as history');
{
  // Browser-first modules, loaded the way the page loads them.
  const W = {};
  W.SourceValues = global.SourceValues = require('./source-values.js');
  W.LeaseholdStatus = global.LeaseholdStatus = LS;
  ['lease-intelligence.js', 'review-engine.js', 'selectors.js', 'lease-review-packets.js'].forEach(f => {
    new Function('window', read(f)).call({ window: W }, W);
    Object.keys(W).forEach(k => { if (global[k] === undefined) global[k] = W[k]; });
  });
  const AE = require('./acquisition-engine.js');
  const PC = require('./property-cabinet.js');
  const PA = require('./property-area.js');
  const PR = require('./property-record.js');
  const DEPS = require('./api/_server-deps.js');

  const mk = (tenants) => ({ id: 'p1', name: 'Lifecycle Plaza', totalSqft: 10000, tenants: tenants.map(TN.normalizeTenant),
    invoices: [], disputes: [], timeline: [], camReconciliation: null, results: null });
  const withEnded = mk([ACTIVE, ENDED_BEFORE]);
  const allActive = mk([ACTIVE, Object.assign({}, ENDED_BEFORE, { leasehold_status: undefined, ended_at: undefined, ended_reason: undefined })]);
  const onlyActive = mk([ACTIVE]);

  eq(PC.activeTenants(withEnded).map(t => t.id), ['a1'], 'E1 PropertyCabinet.activeTenants: the ended leasehold is not active');
  const sp = PC.spaces(withEnded);
  eq(sp.map(s => [s.id, s.status]), [['a1', 'occupied'], ['e1', 'ended']], 'E2 PropertyCabinet.spaces: the row is kept, as ended, not occupied');
  eq(sp[1].endedAt, '2024-06-30', 'E3 and says when it ended');
  is(!('ended' in PC.spaces(onlyActive)[0]), 'E4 an active space carries no lifecycle keys');
  const dates = PC.importantDates(withEnded, { now: '2026-09-30', horizonDays: null, includePast: true });
  is(!dates.some(d => d.source && d.source.id === 'e1'), 'E5 importantDates: no "lease ends" date for an ended leasehold');

  eq(PA.leasedSqft(withEnded).value, 3000, 'E6 PropertyArea: an ended leasehold leases nothing — 3,000 not 5,000');
  eq(PA.leasedSqft(allActive).value, 5000, 'E7 while both are active, both count (unchanged)');

  const sel = W.Selectors;
  eq(sel.derivePropertyReadiness(withEnded).expiredCount, sel.derivePropertyReadiness(onlyActive).expiredCount,
     'E8 Selectors readiness: the ended leasehold is not an expiry');
  eq(sel.getReviewQueueItems([withEnded]).filter(i => i.tenantId === 'e1').length, 0, 'E9 Selectors review queue: not a lease to review');
  eq(sel.portfolioKPIs([withEnded]).occupancyPct, 30, 'E10 Selectors KPIs: occupancy 30%, not 50%');

  const REF = new Date('2026-09-30T12:00:00Z');
  const pipe = AE.computeRenewalPipeline([mk([ACTIVE, Object.assign({}, ENDED_BEFORE, { end_date: '2026-12-31' })])], REF);
  is(!pipe.items.some(i => i.tenantName === 'Gone Before Co'), 'E11 AcquisitionEngine renewal pipeline: no renewal for an ended leasehold');
  const fc = AE.computeRevenueForecast([withEnded], REF);
  eq(fc.currentAnnualRent, 90000, 'E12 AcquisitionEngine forecast: ended rent is not current rent');
  eq(AE.computePortfolioIntelligence([withEnded], REF).occupancyRate, 30, 'E13 AcquisitionEngine intelligence: occupancy 30%');

  const deps = DEPS.load();
  const rec = DEPS.withWindow(() => PR.assemble(withEnded, deps));
  eq(rec.spaces.map(s => s.tenantId), ['a1'], 'E14 PropertyRecord.spaces is the current roster');
  eq(rec.endedLeaseholds, [{ tenantId: 'e1', tenantName: 'Gone Before Co', endedAt: '2024-06-30', endedReason: 'terminated_early' }],
     'E15 and names the ended leasehold, so history is not lost');
  is(rec.fields && 'e1' in rec.fields, 'E16 its field provenance stays in `fields`, under its permanent id');
  is(rec.timeline && rec.timeline.byTenant && 'e1' in rec.timeline.byTenant, 'E17 its events stay its own, not the property\'s');
  eq(rec.identity.leasedSqft, 3000, 'E18 identity.leasedSqft excludes it');
  is(!('endedLeaseholds' in DEPS.withWindow(() => PR.assemble(onlyActive, deps))), 'E19 an all-active record has no endedLeaseholds key');

  const TS = deps.TenantSpace;
  const rows = DEPS.withWindow(() => TS.listRows(withEnded, { q: '', sort: 'suite', dir: 1 }));
  eq(rows.map(r => [r.id, r.status]), [['a1', 'occupied'], ['e1', 'ended']], 'E20 TenantSpace list: the ended row is listed, as ended');
  eq(DEPS.withWindow(() => TS.uncoveredArea(withEnded)).covered, 3000, 'E21 TenantSpace.uncoveredArea: an ended leasehold covers no space');

  const html = W.LeaseReviewPackets.generateLenderSummaryHtml(withEnded, {});
  is(/30%/.test(html) && !/Gone Before Co/.test(html), 'E22 lender summary: occupancy and rent roll are the current roster');

  // The reconciliation detector, loaded as test-audit-consistency loads it.
  const box = { window: { LeasePeriod: LP }, console, module: {}, Date, Math, Number, String, Array, JSON, isFinite, parseFloat };
  require('vm').createContext(box);
  require('vm').runInContext(read('reconciliation-engine.js'), box);
  const RE = box.window.ReconciliationEngine;
  // Lease-term findings only; the property-level coverage finding is not about the lifecycle.
  const flagsFor = (t) => RE.detectReconciliationIssues([{ tenantId: t.id, name: t.tenant_name, totalAllocated: 1000 }], { tenants: [TN.normalizeTenant(t)] }, '2025-12-31')
    .filter(f => !/^Property CAM coverage/.test(f.title));
  const f1 = flagsFor(ENDED_BEFORE);
  is(f1.length === 1 && f1[0].severity === 'red' && f1[0].blocksBilling === true && /leasehold ended 2024-06-30/.test(f1[0].title),
     'E23 reconciliation: money allocated to a leasehold ended before the period is a red, billing-blocking finding', JSON.stringify(f1.map(f => f.title)));
  const f2 = flagsFor({ id: 'x', tenant_name: 'No End On File', start_date: '2019-01-01', end_date: '2030-12-31', leasehold_status: 'ended' });
  is(f2.length === 1 && f2[0].blocksBilling === true && /marked ended with no end date/.test(f2[0].title),
     'E24 ended with no ended_at: billing waits for the date', JSON.stringify(f2.map(f => f.title)));
  eq(flagsFor(ENDED_WITHIN).length, 0, 'E25 a CONFIRMED end inside the period (known start) raises no occupancy question');
  eq(flagsFor(ACTIVE_PAST_END).map(f => f.severity), ['red'], 'E26 an ACTIVE lease past its end_date still raises the holdover question, as before');

  // Command Center, loaded against the same window.
  new Function('window', read('command-center.js')).call({ window: W }, W);
  W.AcquisitionEngine = AE;
  const cm = W.CommandCenter.buildModel({ props: [withEnded], deps: { Selectors: sel, AcquisitionEngine: AE, now: REF } });
  eq(cm.briefing.totals.leases, 1, 'E27 Command Center: one lease in the briefing, not two');
  eq(cm.health[0].occupancyPct, 30, 'E28 Command Center: occupancy 30%');
  is(!cm.recommendations.some(r => /Gone Before Co/.test(JSON.stringify(r))), 'E29 Command Center: no recommendation about the ended leasehold');

  const PRef = require('./property-reference.js');
  eq(PRef.occupancyPct(withEnded), 30, 'E30 PropertyReference.occupancyPct: 30%');
}

// ── F ──────────────────────────────────────────────────────────────────────
sec('F. One rule — nobody else decides, nobody falls back');
{
  const strip = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && !/^test-/.test(f))
    .concat(fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js')).map(f => 'api/' + f));
  const deciders = files.filter(f => /leasehold_status\s*===?\s*['"]ended['"]/.test(strip(read(f))));
  eq(deciders.sort(), ['leasehold-status.js', 'tenant-normalize.js'], 'F1 only the predicate and the normaliser (pinned equal in B1) compare leasehold_status');
  const users = ['lease-period.js', 'selectors.js', 'acquisition-engine.js', 'property-cabinet.js', 'property-area.js', 'property-record.js',
    'tenant-space.js', 'ai-workspace.js', 'lease-review-packets.js', 'command-center.js', 'property-reference.js', 'property-os.js',
    'script.js', 'api/_property-record-hydrator.js'];
  const missing = users.filter(f => !/LeaseholdStatus/.test(strip(read(f))));
  eq(missing, [], 'F2 every switched consumer asks LeaseholdStatus');
  const fallbacks = users.filter(f => /LeaseholdStatus\s*\|\|\s*\{|isCurrent\s*:\s*function\s*\(\)\s*\{\s*return true/.test(strip(read(f))));
  eq(fallbacks, [], 'F3 no consumer carries a "treat as current" fallback');
  const SCRIPT = read('script.js');
  is(!/function syncTenantsToTable\s*\(/.test(SCRIPT), 'F4 the dead deleter syncTenantsToTable is gone');

  // The script.js and browser-only switches, pinned by the function that holds them.
  const { fnSource } = require('./test-support/fn-source.js');
  const pins = [
    ['renderPropertyKpiHeader',   /LeaseholdStatus\.isCurrent\(t\)/],
    ['derivePropertyMetrics',     /LeaseholdStatus\.isCurrent\(t\)/],
    ['renderPortfolio',           /_cur\s*=\s*Array\.isArray\(p\.tenants\) \? p\.tenants\.filter\(t => !t \|\| window\.LeaseholdStatus\.isCurrent\(t\)\)[\s\S]*const occSqft = \(_cur \|\| \[\]\)[\s\S]*typeof t === 'object' && window\.LeaseholdStatus\.isCurrent\(t\)/],
    ['refreshBulkSummary',        /!window\.LeaseholdStatus\.isCurrent\(t\)\) return;[\s\S]*window\.LeaseholdStatus\.isCurrent\(d\)/],
    ['_renderExtractionNextStep', /window\.LeaseholdStatus\.isCurrentLease\(t\)/],
    ['recordVacantSpace',         /t\.tenant_name &&\s*window\.LeaseholdStatus\.isCurrent\(t\)/],
    ['_camPrepState',             /window\.LeaseholdStatus\.inPeriodRoster\(t, _prepPeriod\)/],
    ['runAllocation',             /window\.LeaseholdStatus\.inPeriodRoster\(t, _rosterPeriod\)/],
    ['deriveTenantReviewState',   /if \(!window\.LeaseholdStatus\.inPeriodRoster\(t, _p\)\) \{\s*rv\.camBlocking\.push/],
    ['camInputsFingerprint',      /window\.LeaseholdStatus\.isEnded\(x\) \? '\|ended:'/],
  ];
  const missingPins = pins.filter(([fn, re]) => !re.test(fnSource(SCRIPT, fn))).map(([fn]) => fn);
  eq(missingPins, [], 'F5 every script.js current-state / period consumer asks the predicate');
  is(/tens = \(p\.tenants \|\| \[\]\)\.filter\(t => t && !t\.extractionFailed && window\.LeaseholdStatus\.isCurrent\(t\)\)/.test(SCRIPT),
     'F6 the portfolio report counts current leaseholds');
  is(/property\.tenants\.filter\(function \(t\) \{ return t && window\.LeaseholdStatus\.isCurrent\(t\); \}\)/.test(read('property-os.js')),
     'F7 property-os lease summary counts current leaseholds');
  is(/tenants\.filter\(function \(t\) \{ return _LS\(\)\.isCurrent\(t\); \}\)/.test(read('ai-workspace.js')) &&
     /filter\(t => !t \|\| _LS\(\)\.isCurrent\(t\)\)\.length/.test(read('ai-workspace.js')),
     'F8 ai-workspace legacy roster and tenant count are current leaseholds');
  is(/data\.endedLeaseholds = rec\.endedLeaseholds\.map/.test(read('api/_mcp-capabilities.js')) &&
     /'tenants\.lifecycle_read_failed':\s*\['spaces'\]/.test(read('api/_mcp-capabilities.js')),
     'F9 MCP get_property carries endedLeaseholds and maps the lifecycle degradation to spaces');
}

// ── G ──────────────────────────────────────────────────────────────────────
sec('G. Fail loudly: without the module, a consumer throws rather than guesses');
{
  const Wn = { SourceValues: require('./source-values.js') };
  const saved = global.LeaseholdStatus; delete global.LeaseholdStatus;
  try {
    new Function('window', read('selectors.js')).call({ window: Wn }, Wn);
    const e = throws(() => Wn.Selectors.getReviewQueueItems([{ id: 'p', tenants: [ACTIVE] }]));
    is(e && /LeaseholdStatus is not loaded/.test(e.message), 'G1 Selectors throws "LeaseholdStatus is not loaded"', e && e.message);
  } finally { global.LeaseholdStatus = saved; }
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
