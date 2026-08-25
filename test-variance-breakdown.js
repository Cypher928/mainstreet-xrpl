'use strict';
/**
 * test-variance-breakdown.js — where the pool-vs-billed difference went.
 *
 *   node test-variance-breakdown.js
 *
 * TWO DEFECTS THIS COVERS
 *
 * 1. The variance banner was a dead end. It stated a five-figure gap and closed
 *    with "Re-check invoice amounts or re-run allocation" — advice that is wrong
 *    in the ordinary case, because most of these gaps are the product doing what
 *    it was told: invoices marked not CAM-eligible, categories a lease excludes,
 *    caps, and the share of the building no loaded lease covers. Clicking the
 *    banner did nothing.
 *
 * 2. The blocked-statement table printed "NAMES THIS TENANT — —" against a
 *    property-level concentration finding, and its substring predicate matched a
 *    tenant whose NAME happened to appear as an invoice VENDOR.
 *
 * WHAT THIS FILE GUARANTEES
 *
 * The breakdown is a re-add of numbers the reconciliation already produced, so
 * the load-bearing property is an IDENTITY, not a plausible-looking total:
 *
 *     pool − billed = notEligible + uncovered + claim + caps + residual
 *
 * If that stops holding, the panel is inventing arithmetic and the residual line
 * is the only thing standing between a manager and a made-up number. Several
 * tests below therefore assert the identity directly on adversarial fixtures —
 * exclusions, caps, direct matches, an unreadable pool — rather than asserting
 * that a particular bucket has a particular value.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const VB = require('./variance-breakdown.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${b}, got ${a}`);
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.02, m || `expected ~${b}, got ${a}`);

const scriptCode = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

// ── Fixture builders ────────────────────────────────────────────────────────
// These mimic what runFullReconciliation emits: results carrying includedInvoices
// with a per-invoice `share`, and a capAdjustment already subtracted from
// totalAllocated. Nothing here re-implements the allocation — the fixtures state
// the outputs, exactly as the module will find them at runtime.

function inv(id, amount, opts) {
  return Object.assign({ id, vendorName: 'V' + id, category: 'grounds',
                         amount, camEligible: true, matchConfidence: 0 }, opts || {});
}

/** Build results by declaring, per lease, which invoices it took and at what share. */
function lease(name, pct, taken, cap) {
  const included = taken.map(([i, share]) => Object.assign({}, i, {
    allocation: (Number(i.matchConfidence) || 0) >= 75 ? 'direct' : 'shared',
    share: Math.round(share * 100) / 100,
  }));
  const raw = included.reduce((s, x) => s + x.share, 0);
  return {
    name, proRataPercent: pct, includedInvoices: included,
    capApplied: !!cap, capAdjustment: cap || null,
    totalAllocated: Math.round((raw - (cap || 0)) * 100) / 100,
  };
}

const poolOf   = invs => Math.round(invs.reduce((s, i) => s + i.amount, 0) * 100) / 100;
const billedOf = res  => Math.round(res.reduce((s, r) => s + r.totalAllocated, 0) * 100) / 100;
const run = (results, invoices) =>
  VB.derive({ results, invoices, pool: poolOf(invoices), billed: billedOf(results) });

const bucket = (bk, key) => {
  const l = (bk.lines || []).find(x => x.key === key);
  return l ? l.amount : 0;
};

console.log('\n══ Variance breakdown ══');
console.log('\n── The identity: every dollar of the gap lands in a named bucket ──');

// The reported Pilot case, reconstructed: a fully-leased property whose pool is
// mostly invoices the manager marked not CAM-eligible. Coverage is 100%, so the
// old banner reached its "Reconciliation variance detected" branch and told the
// reader to re-check invoice amounts — on a run where every amount was correct.
function reportedCase() {
  const invoices = [];
  for (let i = 1; i <= 5;  i++) invoices.push(inv('e' + i, 1651.86));
  for (let i = 1; i <= 8;  i++) invoices.push(inv('x' + i, 7961.34, { camEligible: false, category: 'capital' }));
  const eligible = invoices.filter(i => i.camEligible);
  const results = [0.5, 0.3, 0.2].map((p, n) =>
    lease('T' + n, p * 100, eligible.map(i => [i, i.amount * p])));
  return { invoices, results };
}

t('the reported shape reproduces: 100% leased, 11.5% of the pool billed', () => {
  const { invoices, results } = reportedCase();
  const bk = run(results, invoices);
  eq(bk.proRataSum, 100, 'coverage should be complete — this is not a coverage gap');
  near(bk.billedPct, 11.48, `billed share of pool: ${bk.billedPct}`);
  near(bk.difference, 63690.72, `difference: ${bk.difference}`);
});

t('and the whole difference is attributed to the CAM-eligible flag', () => {
  const { invoices, results } = reportedCase();
  const bk = run(results, invoices);
  near(bucket(bk, 'not_eligible'), bk.difference, 'the not-eligible bucket should carry it all');
  eq(bk.residual, 0, 'nothing should be left unattributed');
  eq(bk.explained, true, 'this gap is fully explained — it is not a defect');
});

t('it says how many invoices reached no tenant at all', () => {
  const { invoices, results } = reportedCase();
  const bk = run(results, invoices);
  eq(bk.invoiceCount, 13);
  eq(bk.unbilledCount, 8, 'the panel must be able to say "8 of the 13"');
  near(bk.unbilledTotal, 63690.72);
});

t('a lease exclusion lands in the claim bucket, not in coverage', () => {
  // Two leases at 50% each — full coverage. One invoice is excluded by lease B,
  // so only A's half of it is billed. Nothing about coverage is wrong here.
  const a = inv('a', 1000), b = inv('b', 500);
  const results = [
    lease('A', 50, [[a, 500], [b, 250]]),
    lease('B', 50, [[a, 500]]),          // B excludes b's category
  ];
  const bk = run(results, [a, b]);
  eq(bk.proRataSum, 100);
  near(bucket(bk, 'claim'), 250, 'the excluded half belongs to the claim bucket');
  eq(bucket(bk, 'uncovered'), 0, 'full coverage must not produce an uncovered bucket');
  eq(bk.residual, 0);
});

t('partial coverage lands in the uncovered bucket', () => {
  const a = inv('a', 1000);
  const results = [lease('A', 40, [[a, 400]])];
  const bk = run(results, [a]);
  near(bucket(bk, 'uncovered'), 600, 'the 60% of the building with no lease');
  eq(bucket(bk, 'claim'), 0);
  eq(bk.residual, 0);
});

t('a cap is its own bucket and does not distort the others', () => {
  const a = inv('a', 1000);
  // One lease at 100%, billed 1000 then capped down by 250.
  const results = [lease('A', 100, [[a, 1000]], 250)];
  const bk = run(results, [a]);
  eq(billedOf(results), 750);
  near(bucket(bk, 'caps'), 250);
  eq(bucket(bk, 'uncovered'), 0, 'a cap is not a coverage problem');
  eq(bucket(bk, 'claim'), 0, 'a cap is not an exclusion');
  eq(bk.residual, 0);
});

t('a directly-matched invoice is never treated as uncovered', () => {
  // A direct match bills the WHOLE invoice to one tenant regardless of its
  // pro-rata share, so charging it a coverage shortfall would invent a gap.
  const d = inv('d', 900, { matchConfidence: 92 });
  const s = inv('s', 100);
  const results = [lease('A', 40, [[d, 900], [s, 40]])];
  const bk = run(results, [d, s]);
  near(bucket(bk, 'uncovered'), 60, 'only the shared invoice has a coverage shortfall');
  eq(bk.residual, 0);
});

t('a direct invoice that no lease billed shows up, and is not called coverage', () => {
  const d = inv('d', 900, { matchConfidence: 92 });
  const results = [lease('A', 100, [])];   // matched, then excluded by the lease
  const bk = run(results, [d]);
  near(bucket(bk, 'claim'), 900);
  eq(bucket(bk, 'uncovered'), 0);
  eq(bk.invoices[0].reason, 'unclaimed_direct');
});

t('an out-of-year invoice is named as out-of-year, not as one nobody claimed', () => {
  // The CAM-year filter narrows a LOCAL inside runFullReconciliation, so without
  // being told what survived it, the panel would report a 2025 invoice sitting in
  // a 2026 pool as a shared expense that mysteriously reached no tenant — true,
  // useless, and pointing the reader at the wrong control.
  const inYear  = inv('a', 1000);
  const lastYr  = inv('b', 4000);
  const results = [lease('A', 100, [[inYear, 1000]])];
  const bk = VB.derive({ results, invoices: [inYear, lastYr], reconciled: [inYear],
                         pool: 5000, billed: 1000 });
  near(bucket(bk, 'out_of_year'), 4000);
  eq(bucket(bk, 'claim'), 0, 'an out-of-year invoice is not an exclusion');
  eq(bk.residual, 0);
  eq(bk.invoices.find(r => r.vendor === 'Vb').reason, 'out_of_year');
  eq(VB.nextStep(bk).key, 'out_of_year');
});

t('omitting the reconciled list treats every invoice as considered', () => {
  // Back-compat: callers that cannot supply it must not have every invoice
  // silently reclassified as out-of-year.
  const a = inv('a', 1000);
  const bk = run([lease('A', 100, [[a, 1000]])], [a]);
  eq(bucket(bk, 'out_of_year'), 0);
  eq(bk.difference, 0);
});

t('the identity holds on a fixture that mixes all four causes', () => {
  const shared   = inv('s', 2000);
  const excluded = inv('x', 800);
  const direct   = inv('d', 1200, { matchConfidence: 88 });
  const noCam    = inv('n', 5000, { camEligible: false });
  const results = [
    lease('A', 60, [[shared, 1200], [excluded, 480], [direct, 1200]], 300),
    lease('B', 30, [[shared, 600]]),                      // B excludes x's category
  ];
  const invoices = [shared, excluded, direct, noCam];
  const bk = run(results, invoices);
  const sum = bucket(bk, 'not_eligible') + bucket(bk, 'uncovered')
            + bucket(bk, 'claim') + bucket(bk, 'caps') + bk.residual;
  near(sum, bk.difference, `buckets ${sum} must close the gap ${bk.difference}`);
  eq(bk.residual, 0, 'no residual on a well-formed run');
  ok(bucket(bk, 'not_eligible') > 0 && bucket(bk, 'uncovered') > 0
     && bucket(bk, 'claim') > 0 && bucket(bk, 'caps') > 0,
     'the fixture must actually exercise all four buckets, or this proves nothing');
});

console.log('\n── The residual is the honesty valve, not a rounding sink ──');

t('a pool the engine never saw surfaces as an unattributed residual', () => {
  // The banner strikes totalPool from a DIFFERENT invoice list than the engine
  // ran on (script.js parses one with parseFloat and the other with parseMoney).
  // If those ever disagree, the difference must be named, not absorbed.
  const a = inv('a', 1000);
  const results = [lease('A', 100, [[a, 1000]])];
  const bk = VB.derive({ results, invoices: [a], pool: 1500, billed: 1000 });
  near(bk.residual, 500, 'the 500 the engine never saw must be called out');
  eq(bk.explained, false, 'a run with an unattributed remainder is not "explained"');
  ok(bk.lines.some(l => l.key === 'residual'), 'the residual needs its own visible line');
});

t('and that is the one case where re-checking the invoices is the advice', () => {
  const a = inv('a', 1000);
  const results = [lease('A', 100, [[a, 1000]])];
  const bk = VB.derive({ results, invoices: [a], pool: 1500, billed: 1000 });
  eq(VB.nextStep(bk).key, 'residual');
  ok(/invoice register/i.test(VB.nextStep(bk).cta), VB.nextStep(bk).cta);
});

t('a clean run offers no residual line at all', () => {
  const a = inv('a', 1000);
  const bk = run([lease('A', 100, [[a, 1000]])], [a]);
  eq(bk.difference, 0);
  eq(bk.lines.length, 0, 'nothing to explain, so nothing is listed');
  eq(VB.nextStep(bk), null, 'and no next step is manufactured');
});

console.log('\n── The next step names the largest cause, not a generic one ──');

t('the CTA follows whichever bucket is actually biggest', () => {
  const big = inv('big', 9000, { camEligible: false });
  const sm  = inv('sm', 1000);
  const eligibleOnly = [lease('A', 90, [[sm, 900]])];
  eq(VB.nextStep(run(eligibleOnly, [big, sm])).key, 'not_eligible');

  // Same shape, eligibility flipped: now coverage dominates and the advice moves.
  const big2 = inv('big', 9000);
  const results2 = [lease('A', 10, [[big2, 900], [sm, 100]])];
  eq(VB.nextStep(run(results2, [big2, sm])).key, 'uncovered');
});

t('every next-step key has a destination wired in script.js', () => {
  const i = scriptCode.indexOf('const _VARIANCE_FIX_TARGET');
  ok(i !== -1, 'the navigation table is gone');
  const table = scriptCode.slice(i, i + 500);
  ['not_eligible', 'residual', 'uncovered', 'claim', 'caps'].forEach(k => {
    ok(new RegExp(k + ':').test(table), `no destination for the "${k}" next step`);
  });
});

console.log('\n── The banner leads somewhere ──');

t('[source] both branches of the banner are clickable', () => {
  const i = scriptCode.indexOf('const variance = Math.abs(totalBilled - totalPool)');
  ok(i !== -1, 'variance banner not found');
  const slice = scriptCode.slice(i, i + 4200);
  const opens = slice.split('openVarianceDetails()').length - 1;
  ok(opens >= 2, `the banner still has a branch that opens nothing (${opens} handlers)`);
  ok(/rcs-variance-banner/.test(slice), 'the banner is not styled as pressable');
  ok(/onkeydown=/.test(slice), 'the banner is mouse-only — no keyboard path');
});

t('[source] the diagnostic branch no longer ends at a full stop', () => {
  // It used to close with "Re-check invoice amounts or re-run allocation.", which
  // is right only for the residual case and wrong for the other three. What
  // replaces it must still be a diagnostic — this branch means coverage is NOT
  // the explanation — and it must offer a way forward.
  const i = scriptCode.indexOf('Reconciliation variance detected');
  const branch = scriptCode.slice(i, i + 1200);
  ok(/this is not a coverage gap/.test(branch),
     'the branch no longer distinguishes itself from the partial-coverage case');
  ok(/_vbCta/.test(branch), 'the diagnostic branch offers no next step');
  ok(/_varianceCauseSentence/.test(branch),
     'the branch states a gap without saying what it is made of');
});

t('[source] no CTA is rendered when there is nothing to explain', () => {
  const i = scriptCode.indexOf('const _vbCta');
  const slice = scriptCode.slice(i, i + 400);
  ok(/_lastVarianceBreakdown && _vbStep/.test(slice),
     'the CTA renders unconditionally — a button that opens an empty panel is the dead end this fixes');
});

t('[source] the variance arithmetic is still untouched', () => {
  ok(/const totalPool   = invoices\.reduce\(\(s, inv\) => s \+ \(parseFloat\(inv\.amount\) \|\| 0\), 0\);/.test(scriptCode),
     'totalPool changed');
  ok(/const totalBilled = results\.reduce\(\(s, r\) => s \+ r\.totalAllocated, 0\);/.test(scriptCode),
     'totalBilled changed');
  ok(/const variance = Math\.abs\(totalBilled - totalPool\);/.test(scriptCode), 'variance changed');
  ok(/const _coverageIncomplete = proRataSum < 98;/.test(scriptCode), 'the coverage branch threshold changed');
});

t('[source] openVarianceDetails changes nothing', () => {
  const i = scriptCode.indexOf('function openVarianceDetails');
  const body = scriptCode.slice(i, scriptCode.indexOf('\nfunction ', i + 10));
  ok(!/savePropertyData|saveProperties|\bupsert\b|camEligible\s*=/.test(body),
     'the explanation panel writes state');
  ok(!/runAllocation|runFullReconciliation/.test(body),
     'the explanation panel re-runs the reconciliation');
});

console.log('\n── Exception scope: property-wide is an answer, not a blank ──');

// The scope derivation MOVED to audit-exposure.js (I-4), beside billingReadiness
// which needs it; script.js keeps a one-line delegate. Exercise the real
// implementation rather than eval'ing the delegate, which has no window here.
const _findingScope = require('./audit-exposure.js').findingScope;

t('a finding carrying "Tenant: X" is scoped to X', () => {
  const s = _findingScope({ title: 'anything', conditions: ['Tenant: SHONAC CORPORATION', 'Lease end date: 2016-02-28'] });
  eq(s.level, 'tenant');
  eq(s.tenant, 'SHONAC CORPORATION');
});

t('impact.scope and conflict.tenant are honoured too', () => {
  eq(_findingScope({ impact: { scope: 'tenant:Tollgrade' } }).tenant, 'Tollgrade');
  eq(_findingScope({ conflict: { tenant: 'IMPCO' } }).tenant, 'IMPCO');
});

t('a pool-level finding is property-wide, with no tenant', () => {
  const s = _findingScope({
    title: 'Unusually large invoice — Acme Roofing: $38,000 (52.8% of total CAM)',
    conditions: ['Vendor: "Acme Roofing"', 'Invoice amount: $38,000', 'Concentration: 52.8%'],
  });
  eq(s.level, 'property');
  eq(s.tenant, null);
});

t('THE OVER-MATCH: a tenant name appearing as a VENDOR is not that tenant\'s exception', () => {
  // This is the reported confusion. The old predicate searched the title for the
  // tenant's name, so a $38,000 invoice from a vendor called "SHONAC
  // CORPORATION" was highlighted as SHONAC's own blocking exception — on a row
  // whose money is measured on the expense side and says nothing about SHONAC's
  // allocation.
  const concentration = {
    title: 'Unusually large invoice — SHONAC CORPORATION: $38,000 (52.8% of total CAM)',
    conditions: ['Vendor: "SHONAC CORPORATION"', 'Invoice amount: $38,000'],
    impact: { amount: 38000, kind: 'concentration' },
  };
  eq(_findingScope(concentration).level, 'property',
     'a vendor name that matches a tenant must not make the finding tenant-scoped');
});

t('an empty or malformed finding fails to property, never to a guess', () => {
  eq(_findingScope(null).level, 'property');
  eq(_findingScope({}).level, 'property');
  eq(_findingScope({ conditions: ['Tenant:'] }).level, 'property', 'an empty tenant name is not a tenant');
});

t('[source] the statement table renders scope, not an em dash', () => {
  ok(/<th>Scope<\/th>/.test(scriptCode), 'the column header still says "Names this tenant"');
  ok(!/<th>Names this tenant<\/th>/.test(scriptCode), 'the old header survives');
  const i = scriptCode.indexOf('const scopeCell');
  ok(i !== -1, 'the scope cell is gone');
  const cell = scriptCode.slice(i, i + 320);
  ok(/This tenant/.test(cell),        'no "This tenant" state');
  ok(/esc\(sc\.tenant\)/.test(cell),  'another tenant\'s exception is not named');
  ok(/Property-wide/.test(cell),      'no "Property-wide" state');
});

t('[source] the row highlight and mine[] read the same derivation', () => {
  // These disagreed before: `mine` used a substring search while the table drew
  // its own conclusion. One derivation, consulted twice. Since I-4 the set being
  // filtered is the tenant's BLOCKING set rather than every red finding, but the
  // predicate that decides "is this row about this tenant" is still the one
  // shared derivation — which is what this assertion exists to hold.
  const i = scriptCode.indexOf('function _statementReadinessBlock');
  const body = scriptCode.slice(i, scriptCode.indexOf('\n}', i));
  ok(/_findingScope\(f\)\.tenant === tenantName/.test(body),
     'mine[] no longer reads _findingScope — the count and the column can disagree again');
  ok(!/indexOf\(tenantName\) >= 0/.test(body), 'the substring predicate is back');
});

console.log('\n' + '─'.repeat(56));
if (fail) {
  console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(1);
} else {
  console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
}
