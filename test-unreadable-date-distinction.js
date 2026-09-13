'use strict';
/**
 * test-unreadable-date-distinction.js — three states, all the way to the money.
 *
 *   node test-unreadable-date-distinction.js
 *
 * THE DISTINCTION THIS EXISTS FOR
 *
 * A lease can be in exactly three states about its end date, and they are three
 * different conversations with the tenant:
 *
 *   VALID       "2026-12-31"  — reconcile it.
 *   MISSING     nothing on file — the approved assumed-end behaviour applies;
 *               the term is treated as covering the period and the tenant is
 *               billed, because a lease with no end date on file is an ordinary
 *               and answerable gap: "send us your dates".
 *   UNREADABLE  "TBD", "unknown", "upon substantial completion of the Landlord
 *               Work" — the lease is NOT silent. Something is written there and
 *               it does not name a day. This fails closed.
 *
 * Collapsing the third into the second is what D-1 fixed, and the danger is
 * specific: unreadable → missing → assumed full period → BILLED. A tenant whose
 * term dates from an event that has not happened yet gets a CAM bill computed as
 * though their lease ran the whole year.
 *
 * WHERE THE DISTINCTION LIVES. normalizeTenant keeps start_date/end_date/
 * cam_commencement_date strictly ISO-or-empty — so `end_date` really is '' for
 * BOTH missing and unreadable, and every existing reader of that field is
 * unchanged — and puts the text it could not read beside it in
 * `unreadableDates`. lease-period.js `_readField` pairs the two back together.
 * There is no second date interpretation anywhere: CAM asks LeasePeriod.
 *
 * WHAT THIS SUITE ADDS OVER THE EXISTING COVERAGE
 *
 * test-lease-period.js pins the stored shape and the finding (severity,
 * blocksBilling, the quoted clause). test-e2e-lease-extraction.js pins the real
 * extraction → normalise → save → reload round trip. Neither connects the state
 * to its ALLOCATION consequence, and that is the claim that matters: an
 * unreadable lease must not receive the missing-date assumption. Measured
 * through the real modules:
 *
 *   MISSING     occupancy.applied true,  factor 1     ← assumed end, billable
 *   UNREADABLE  occupancy.applied false, factor null  ← fails closed
 *
 * THE REAL PATH, NOT A MIRROR. TenantNormalize and LeasePeriod are required
 * directly and ReconciliationEngine is evaluated the way the page loads it. No
 * date parsing is reimplemented here; if it were, this suite would pass while
 * production collapsed the states, which is the failure mode it exists to
 * prevent.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const TN = require('./tenant-normalize.js');
const LP = require('./lease-period.js');

// The engine the way the page loads it, with the real module in scope.
function loadEngine() {
  const box = { window: { LeasePeriod: LP }, console, module: {},
                Date, Math, Number, String, Array, JSON, isFinite, parseFloat };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'reconciliation-engine.js'), 'utf8'), box,
                  { filename: 'reconciliation-engine.js' });
  return box.window.ReconciliationEngine;
}
const RE = loadEngine();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const R  = (l, v) => console.log('  ' + String(l).padEnd(30) + ':', typeof v === 'string' ? v : JSON.stringify(v));

const PERIOD = LP.periodForYear(2026);

// One lease, through the REAL normaliser. `raw` is what extraction handed over.
function stored(endRaw, over) {
  return TN.normalizeTenant(Object.assign({
    id: 't1', tenant_name: 'Probe Tenant', leased_sqft: '1000',
    start_date: '2026-01-01', end_date: endRaw, status: 'complete',
  }, over || {}));
}
function detect(tenant, allocated) {
  return RE.detectReconciliationIssues(
    [{ tenantId: tenant.id, name: tenant.tenant_name, totalAllocated: allocated === undefined ? 10000 : allocated,
       proRataPercent: 10, includedInvoices: [] }],
    { tenants: [tenant] }, '2026-12-31');
}
const dateFinding = flags =>
  flags.find(f => /cannot be read|lease dates|lease that ended|does not begin until/.test(f.title || ''));

const VALID      = stored('2026-12-31');
const MISSING    = stored(undefined);
const UNREADABLE = stored('TBD');

console.log('\n══ Unreadable is not missing, all the way to the allocation ══');

// ── A · the three states survive the real normaliser ──────────────────────
console.log('\n── A. Normalisation keeps three states, not two ──');

t('a valid date normalises to its ISO value, with nothing held back', () => {
  eq(VALID.end_date, '2026-12-31');
  eq(VALID.unreadableDates, null);
});

t('a genuinely absent date normalises to empty, with nothing held back', () => {
  eq(MISSING.end_date, '');
  eq(MISSING.unreadableDates, null, 'an absent date must not invent an unreadable record');
});

t('AN UNREADABLE DATE ALSO NORMALISES TO EMPTY — the field is ISO-or-empty', () => {
  // This is deliberate and is why the distinction cannot live in `end_date`:
  // every existing reader of that field keeps behaving exactly as before.
  eq(UNREADABLE.end_date, '');
});

t('    but the text it could not read travels beside it', () => {
  R('unreadableDates', UNREADABLE.unreadableDates);
  ok(UNREADABLE.unreadableDates && UNREADABLE.unreadableDates.end_date === 'TBD',
     'the raw value was dropped, so unreadable is now indistinguishable from missing');
});

t('    so MISSING and UNREADABLE are NOT the same stored record', () => {
  ok(JSON.stringify(MISSING) !== JSON.stringify(UNREADABLE),
     'the two states normalise to identical records — the distinction is gone');
});

t('every unreadable shape is kept, not just "TBD"', () => {
  for (const raw of ['TBD', 'unknown', 'upon substantial completion of the Landlord Work',
                     'N/A', 'to be determined', '31/08/2026']) {
    const s = stored(raw);
    eq(s.end_date, '', `"${raw}" should still normalise the field to empty`);
    ok(s.unreadableDates && s.unreadableDates.end_date === raw,
       `"${raw}" lost its raw text and now looks absent`);
  }
});

t('and a re-normalise does not lose it — the record survives a second pass', () => {
  const twice = TN.normalizeTenant(UNREADABLE);
  eq(twice.end_date, '');
  ok(twice.unreadableDates && twice.unreadableDates.end_date === 'TBD',
     'the second normalise dropped the unreadable record, so a reload would lose it');
});

t('a corrected date clears the unreadable record rather than shadowing it', () => {
  const fixed = TN.normalizeTenant(Object.assign({}, UNREADABLE, { end_date: '2026-12-31' }));
  eq(fixed.end_date, '2026-12-31');
  ok(!(fixed.unreadableDates && fixed.unreadableDates.end_date),
     'the stale unreadable record outlived the correction, so a fixed lease still reads unreadable');
});

// ── B · the resolver pairs them back together ─────────────────────────────
console.log('\n── B. The resolver reads one state per lease ──');

t('valid resolves ok, with the date', () => {
  const term = LP.obligationTerm(VALID);
  eq(term.endStatus, 'ok');
  eq(term.end, '2026-12-31');
});

t('missing resolves ABSENT, with no raw to quote', () => {
  const term = LP.obligationTerm(MISSING);
  eq(term.endStatus, 'absent');
  eq(term.end, null);
  eq(term.endRaw, null);
});

t('UNREADABLE resolves UNREADABLE, and carries the text to quote', () => {
  const term = LP.obligationTerm(UNREADABLE);
  R('obligationTerm', { endStatus: term.endStatus, end: term.end, endRaw: term.endRaw });
  eq(term.endStatus, 'unreadable', 'an unreadable end date resolved as something else');
  eq(term.end, null);
  eq(term.endRaw, 'TBD', 'the reader cannot quote what the lease says');
});

t('    and the three statuses are genuinely three', () => {
  const s = [VALID, MISSING, UNREADABLE].map(x => LP.obligationTerm(x).endStatus);
  R('statuses', s);
  eq(new Set(s).size, 3, 'two of the three states resolve identically');
});

// ── C · classification ────────────────────────────────────────────────────
console.log('\n── C. Classification keeps them apart ──');

t('valid classifies as covering the period', () => {
  eq(LP.classify(VALID, PERIOD).case, 'covers_period');
});
t('missing classifies as unknown_end — the approved assumed-end case', () => {
  eq(LP.classify(MISSING, PERIOD).case, 'unknown_end');
});
t('UNREADABLE classifies as unreadable, NOT as unknown_end', () => {
  eq(LP.classify(UNREADABLE, PERIOD).case, 'unreadable',
     'an unreadable lease is being classified as one with no end date on file');
});

// ── D · THE ALLOCATION CONSEQUENCE — the reason any of this matters ───────
console.log('\n── D. What each state does to the money ──');

t('MISSING is apportioned over the whole period — the assumed end, unchanged', () => {
  const occ = LP.occupancy(MISSING, PERIOD);
  R('missing occupancy', { applied: occ.applied, factor: occ.factor, case: occ.case });
  eq(occ.applied, true, 'the approved assumed-end behaviour was turned into a blocker');
  eq(occ.factor, 1, 'a lease with no end date on file should still bill the full period');
});

t('UNREADABLE IS NOT APPORTIONED AT ALL — it fails closed', () => {
  const occ = LP.occupancy(UNREADABLE, PERIOD);
  R('unreadable occupancy', { applied: occ.applied, factor: occ.factor, case: occ.case });
  eq(occ.applied, false, 'an unreadable lease is being apportioned as though its dates were known');
  eq(occ.factor, null, 'an unreadable lease received a usable apportionment factor');
});

t('    which is exactly the assumption it must NOT inherit', () => {
  const m = LP.occupancy(MISSING, PERIOD);
  const u = LP.occupancy(UNREADABLE, PERIOD);
  ok(!(u.applied === m.applied && u.factor === m.factor),
     'unreadable and missing produce the same apportionment — the collapse this suite exists to catch');
});

t('valid is apportioned on its own dates', () => {
  const occ = LP.occupancy(VALID, PERIOD);
  eq(occ.applied, true);
  eq(occ.factor, 1);
});

// ── E · the hold, and what the manager is told ───────────────────────────
console.log('\n── E. The hold, and the explanation ──');

t('UNREADABLE raises a finding that blocks billing', () => {
  const f = dateFinding(detect(UNREADABLE));
  ok(f, 'an unreadable end date raised no finding at all — it would be billed silently');
  eq(f.severity, 'yellow');
  eq(f.blocksBilling, true, 'an unreadable lease is billable');
  ok(/cannot be read/.test(f.title), f.title);
});

t('    and QUOTES the lease rather than the empty field', () => {
  const f = dateFinding(detect(UNREADABLE));
  ok(/TBD/.test(f.detail || ''),
     'the finding does not say what is written on the lease: ' + (f.detail || '').slice(0, 120));
  ok(!/\(end: ""\)/.test(f.detail || ''),
     'the finding quotes the empty field, which is empty BECAUSE it could not be read');
});

t('MISSING does not raise the unreadable finding', () => {
  const f = dateFinding(detect(MISSING));
  ok(!f || !/cannot be read/.test(f.title || ''),
     'a lease with no end date on file is being reported as unreadable: ' + (f && f.title));
});

t('    and a VALID lease raises neither', () => {
  const f = dateFinding(detect(VALID));
  ok(!f, 'a complete lease raised a date finding: ' + (f && f.title));
});

t('the provenance surface reports unreadable as its own source', () => {
  // script.js:6092 reads unreadableDates for the field confidence. Checked here
  // through the stored record so the three states stay distinguishable to it.
  eq(UNREADABLE.unreadableDates.end_date, 'TBD');
  eq(MISSING.unreadableDates, null);
  eq(VALID.unreadableDates, null);
});

console.log('\n' + '─'.repeat(58));
console.log(fail === 0
  ? `\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`
  : `\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
