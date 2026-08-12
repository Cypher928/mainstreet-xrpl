'use strict';
/**
 * test-smoke-fixes.js — the three presentation/guard defects found during the
 * www.mainstreet-review.com pilot smoke test.
 *
 *   node test-smoke-fixes.js
 *
 * 1. A same-year re-run was labelled "Year-over-year comparison against 2026".
 * 2. Tenant Statement had no _resultsStale / CAM-year guard, while the internal
 *    CSV export had both — the protection was backwards.
 * 3. "Lease Validation: PASSED" sat beside "Critical Audit Risk" with nothing
 *    saying the two judge different things.
 *
 * Neither engine's determination is under test here and none was changed. These
 * assert labelling and guards only.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function ok(c, m) { if (!c) throw new Error(m || 'expected truthy'); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const src = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function pick(re, label) {
  const m = src.match(re);
  if (!m) throw new Error(`${label} not found in script.js`);
  return m[0];
}

// ── 1. Same-year runs must never be called year-over-year ──────────────────
console.log('\n── 1. Run-over-run is not year-over-year ──');

// Reproduces the exact pilot case: two runAllocation() runs for one property in
// one session. camRuns.unshift() puts both at the head, same propName, same
// camYear — which is what drove the old fallback to report 2026 vs 2026.
function trendsFor(camRuns) {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    parseFloat, isNaN, Number, Math, Date, JSON, Set, Array, Object, String,
    camRuns,
    fmt: n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  };
  vm.createContext(sb);
  vm.runInContext(pick(/\nfunction buildHistoricalTrends\(\) \{[\s\S]*?\n\}\n/, 'buildHistoricalTrends') +
    '\nthis.__t = buildHistoricalTrends();', sb);
  return sb.__t;
}
const run = (year, total, inv) => ({
  propName: 'O', camYear: year, timestamp: new Date(), totalExpenses: total,
  tenantCount: 1, invoiceCount: inv, sqft: 80000,
  results: [{ name: 'Olenox Corp', proRata: 0.2357, proRataPercent: 23.57, allocatedAmount: total * 0.2357 }],
});

t('two same-year runs are classified run-over-run', () => {
  const tr = trendsFor([run(2026, 110000, 2), run(2026, 55000, 1)]);
  ok(tr, 'no trends returned');
  eq(String(tr.currYear), '2026');
  eq(String(tr.priorYear), '2026');
  eq(tr.comparisonKind, 'run-over-run', 'same-year comparison must not be year-over-year —');
});

t('genuinely different years are still year-over-year', () => {
  const tr = trendsFor([run(2026, 110000, 2), run(2025, 90000, 2)]);
  ok(tr, 'no trends returned');
  eq(tr.comparisonKind, 'year-over-year');
  eq(String(tr.priorYear), '2025');
});

t('a different-year run is preferred over a same-year one', () => {
  // Same-year run is nearer the head; the real prior YEAR must still win.
  const tr = trendsFor([run(2026, 110000, 2), run(2026, 55000, 1), run(2025, 90000, 2)]);
  eq(tr.comparisonKind, 'year-over-year', 'a real prior year must outrank a same-year re-run —');
  eq(String(tr.priorYear), '2025');
});

t('[source] the narrative only says "Year-over-year" when the years differ', () => {
  ok(/comparisonKind === 'year-over-year'\s*\n?\s*\?\s*`Year-over-year comparison against/.test(src),
     'the narrative no longer gates the year-over-year wording on comparisonKind');
  // The run-over-run sentence is assembled from concatenated template strings,
  // so assert on its fragments rather than one contiguous match.
  ok(/This is a run-over-run/.test(src),
     'the run-over-run branch does not name itself a run-over-run comparison');
  ok(/comparison within \$\{trends\.currYear\}, not a year-over-year trend/.test(src),
     'the run-over-run branch does not disclaim the year-over-year reading');
});

t('[source] the trends panel and activity log label the fallback honestly', () => {
  ok(/Run Comparison &mdash; previous \$\{esc\(String\(priorYear\)\)\} run/.test(src),
     'the trends panel still titles a same-year comparison as Historical Trends');
  ok(/Run comparison — previous \$\{trendsData\.priorYear\} run vs current run/.test(src),
     'the activity log entry still calls a same-year comparison historical');
});

t('[source] the distinct-year YoY audit finding is untouched', () => {
  // buildAuditSummary dedupes by year and needs two DISTINCT years, so it was
  // never affected. Guard it so a future edit does not "fix" it into the bug.
  ok(/camRuns\.forEach\(r => \{ if \(r\.camYear && !byYear\[r\.camYear\]\) byYear\[r\.camYear\] = r; \}\);/.test(src),
     'the YoY audit finding no longer dedupes camRuns by distinct year');
});

// ── 2. Tenant Statement staleness guards ───────────────────────────────────
console.log('\n── 2. Tenant Statement refuses stale results ──');

const stmt = pick(/\nfunction generateTenantStatement\(tenantName\) \{[\s\S]*?\n\}\n/, 'generateTenantStatement');
const csv  = pick(/\nfunction exportReconciliationCSV\(\) \{[\s\S]*?\n\}\n/, 'exportReconciliationCSV');

t('the statement refuses when _resultsStale is set', () => {
  ok(/if \(_resultsStale\) \{/.test(stmt), 'generateTenantStatement has no _resultsStale guard');
  ok(/_resultsStale[\s\S]{0,400}?return;/.test(stmt), 'the _resultsStale guard does not return');
});

t('the statement refuses when the CAM year moved since the run', () => {
  ok(/lastResultsYear && getCamYear\(\) !== lastResultsYear/.test(stmt),
     'generateTenantStatement has no CAM-year guard');
});

t('the statement is guarded at least as strictly as the CSV export', () => {
  const guards = ['_resultsStale', 'lastResultsYear', 'lastResults.length'];
  for (const g of guards) {
    ok(csv.includes(g),  `precondition: CSV export lost its ${g} guard`);
    ok(stmt.includes(g), `the tenant statement is missing the ${g} guard the CSV export has`);
  }
});

t('the F-02 exclusion block still runs on the statement path', () => {
  ok(/_exclusionBlockReason\(tenantName\)/.test(stmt), 'F-02 guard removed from the statement path');
  ok(/_renderExclusionBlock\(_block\)/.test(stmt), 'F-02 block rendering removed');
});

t('[source] rerun / restore / property switch still overwrite results wholesale', () => {
  // The paths that make a statement follow the CURRENT reconciliation.
  ok(/lastResults\s*=\s*fullResults;/.test(src),              'runAllocation no longer sets lastResults');
  ok(/lastResults\s*=\s*snapshot\.results\s*\|\|\s*\[\];/.test(src), 'restoreResultsDisplay no longer sets lastResults');
  ok(/resetWorkflow\(\);/.test(src),                          'selectProperty no longer resets workflow state');
  ok(/data\.results\?\.propId === id/.test(src),              'the propId guard on restored results was removed');
  ok(/data\.camReconciliation\?\.propId === id/.test(src),    'the propId guard on the restored snapshot was removed');
});

t('the statement calculation itself is unchanged', () => {
  ok(/const r = lastResults\.find\(x => x\.name === tenantName\);/.test(stmt), 'result lookup changed');
  ok(/const t = lastTenants\.find\(x => x\.name === tenantName\);/.test(stmt), 'tenant lookup changed');
  ok(/if \(!r \|\| !t\) \{/.test(stmt), 'the fail-closed lookup guard was removed');
});

// ── 3. Scope labelling ─────────────────────────────────────────────────────
console.log('\n── 3. Lease Validation vs AI Audit scopes are distinguishable ──');

t('the Lease Validation panel states its scope', () => {
  ok(/class="lv-scope"/.test(src), 'no scope line on the lease validation panel');
  ok(/Scope: this tenant's lease clauses/.test(src), 'the lease scope line does not name lease clauses');
  ok(/AI Audit Summary/.test(src.match(/class="lv-scope"[^<]*<\/div>|lv-scope">[^<]*/)?.[0] || ''),
     'the lease scope line does not point at where property findings live');
});

t('the AI Auditor Narrative states its scope', () => {
  ok(/class="an-scope"/.test(src), 'no scope line on the auditor narrative');
  ok(/Scope: reconciliation and invoice evidence for this property/.test(src),
     'the narrative scope line does not name reconciliation/invoice evidence');
  ok(/Validate Against Lease/.test(src), 'the narrative scope line does not point at the lease workflow');
});

t('the AI Audit Summary header carries its scope', () => {
  ok(/class="ap-scope"/.test(src), 'no scope qualifier on the AI Audit Summary header');
  ok(/reconciliation &amp; invoice evidence/.test(src), 'the audit summary scope text is missing');
});

t('all three scope elements are styled', () => {
  for (const cls of ['.lv-scope', '.an-scope', '.ap-scope']) {
    ok(new RegExp(`\\${cls}\\s*\\{`).test(html), `${cls} has no CSS rule in index.html`);
  }
});

t('neither engine determination was altered', () => {
  // Risk thresholds and the lease severity mapping must be byte-identical.
  ok(/if \(red\.length >= 3 \|\| \(red\.length >= 1 && openDisputes\.length >= 1\)\) \{/.test(src),
     'the Critical risk threshold changed');
  ok(/riskLevel = 'Critical';/.test(src), 'the Critical risk level was renamed or removed');
  ok(/SEV_LABEL = \{ critical: 'CRITICAL', warning: 'REVIEW', info: 'PASSED' \}/.test(src),
     'the lease validation severity labels changed');
});

const TOTAL_EXPECTED = 18;
t(`suite runs all ${TOTAL_EXPECTED} checks`, () => {
  eq(pass + fail + 1, TOTAL_EXPECTED, 'test count changed — update TOTAL_EXPECTED deliberately');
});

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log(`  · ${f}`)); process.exit(1); }
