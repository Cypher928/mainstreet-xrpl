'use strict';
/**
 * test-cam-pool.js — one definition of what is in the CAM pool.
 *
 *   node test-cam-pool.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * A manager marked a $70,000 roof invoice not CAM-eligible — the right call for
 * a capital item. The allocation dropped it. The concentration detector did not:
 *
 *     roofEligible                 : false
 *     roofInAllocation             : false      <- the engine obeyed
 *     redFindings                  : ["Unusually large invoice — Summit Roofing:
 *                                     $70,000.00 (43.6% of total CAM)"]
 *     propertyBlockers             : [same]
 *     -> 0 of 4 tenants billable
 *
 * The detector's own sentence says "% of total CAM" and it divided by the GROSS
 * expense total. Since I-4 made concentration a property-level blocker, every
 * tenant stayed unbillable and the manager's correct remediation cleared
 * nothing. A blocker that a correct action cannot clear is worse than one that
 * is merely wrong.
 *
 * WHAT IS ASSERTED
 *
 * The two quantities stay distinct and each surface uses the one its own words
 * claim. Not "one number everywhere" — the gross expense pool is a real figure
 * the variance panel exists to explain. What must not exist is a surface saying
 * CAM and computing gross.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const CP = require('./cam-pool.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const scriptSrc  = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const scriptCode = scriptSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Brookfield with the roof: $90,500 of ordinary operating expense plus a
// $70,000 roof. Gross $160,500; CAM pool $90,500 once the roof is held out.
const OPERATING = [
  { vendorName: 'PureSpace Janitorial', amount: 18200 },
  { vendorName: 'Hartwell Insurance',   amount: 14500 },
  { vendorName: 'ClimateCore',          amount: 12400 },
  { vendorName: 'Regional Power',       amount: 11200 },
  { vendorName: 'Riverside Mgmt',       amount: 11000 },
  { vendorName: 'Otis Elevator',        amount: 9600  },
  { vendorName: 'Northgate Snow',       amount: 5000  },
  { vendorName: 'Greenline Grounds',    amount: 4000  },
  { vendorName: 'Citywide Waste',       amount: 1740  },
  { vendorName: 'City Water',           amount: 2860  },
];
const roof = (eligible) => ({ vendorName: 'Summit Roofing Systems', amount: 70000, camEligible: eligible });

console.log('\n══ CAM pool ══');
console.log('\n── The definition ──');

t('absent means recoverable — only an explicit untick removes an invoice', () => {
  eq(CP.isEligible({ vendorName: 'X', amount: 1 }), true, 'a legacy invoice with no flag left the pool');
  eq(CP.isEligible({ camEligible: true }), true);
  eq(CP.isEligible({ camEligible: false }), false);
  eq(CP.isEligible({ camEligible: undefined }), true);
  eq(CP.isEligible({ camEligible: null }), true, 'null is not an explicit untick');
  eq(CP.isEligible(null), false);
});

t('the two totals are different numbers and both are computable', () => {
  const all = OPERATING.concat([roof(false)]);
  eq(CP.grossTotal(all), 160500, 'the gross expense total');
  eq(CP.total(all),       90500, 'the CAM pool');
  eq(CP.excludedTotal(all), 70000, 'what the landlord absorbs');
});

t('with nothing held out they agree', () => {
  const all = OPERATING.concat([roof(true)]);
  eq(CP.total(all), CP.grossTotal(all));
  eq(CP.excludedTotal(all), 0);
});

t('formatted and unreadable amounts do not corrupt the totals', () => {
  eq(CP.total([{ amount: '1,250.00' }]), 1250, 'a comma must not truncate to $1');
  eq(CP.total([{ amount: 'TBD' }]), 0, 'an unreadable amount must not become NaN');
  eq(CP.total([{ amount: 100 }, { amount: null }]), 100);
});

console.log('\n── The concentration threshold moves with the CAM pool ──');

// The detector's rule: an invoice over 40% of the CAM pool is material.
const share = (list, amt) => (amt / CP.total(list)) * 100;

t('a $70,000 roof IS material while it is CAM-eligible', () => {
  const all = OPERATING.concat([roof(true)]);
  const pct = share(all, 70000);
  ok(pct > 40, `expected over the 40% threshold, got ${pct.toFixed(1)}%`);
  eq(Math.round(pct * 10) / 10, 43.6);
});

t('and is NOT in the pool at all once it is held out', () => {
  const all = OPERATING.concat([roof(false)]);
  eq(CP.eligible(all).some(i => /Summit/.test(i.vendorName)), false,
     'an invoice removed from CAM is still a candidate for a "% of total CAM" claim');
  eq(CP.total(all), 90500, 'the denominator still counts an invoice that is not in CAM');
});

t('THE BUG, stated as arithmetic', () => {
  // Dividing by the gross total is what produced "43.6% of total CAM" for an
  // invoice contributing nothing to CAM.
  const all = OPERATING.concat([roof(false)]);
  const wrong = (70000 / CP.grossTotal(all)) * 100;
  ok(wrong > 40, `the gross denominator still clears the threshold (${wrong.toFixed(1)}%) — that is the defect`);
  eq(CP.eligible(all).filter(i => (i.amount / CP.total(all)) > 0.4).length, 0,
     'no CAM-eligible invoice is material once the roof is out');
});

console.log('\n── Ownership: one predicate, not five ──');

t('[source] the engine filter reads the shared definition', () => {
  ok(/const recoverable    = window\.CamPool\.eligible\(invoices\)/.test(scriptCode),
     'runFullReconciliation re-implements the eligibility rule');
  ok(/const notRecoverable = window\.CamPool\.excluded\(invoices\)/.test(scriptCode));
});

t('[source] the Invoice constructor reads it too', () => {
  ok(/this\.camEligible     = window\.CamPool\.isEligible\(rel\)/.test(scriptCode),
     'the Invoice constructor keeps its own copy of the rule');
});

t('[source] no bare `camEligible !== false` survives in script.js', () => {
  const copies = (scriptCode.match(/camEligible\s*!==\s*false/g) || []).length;
  eq(copies, 0, `${copies} transcription(s) of the rule remain — each is a chance to write === true`);
});

t('[source] lastInvoicesFull carries eligibility at all', () => {
  // It was stripped to {vendor, category, amount}, which is why buildAuditSummary
  // could not tell an excluded invoice from a billable one.
  ok(/camEligible: window\.CamPool\.isEligible\(inv\)/.test(scriptCode),
     'the audit summary still cannot see which invoices are in CAM');
});

console.log('\n── The right denominator reaches the right surface ──');

t('[source] the concentration detector divides by the CAM pool', () => {
  const i = scriptCode.indexOf('const camInvs  = window.CamPool.eligible(invs);');
  ok(i > 0, 'the detector does not narrow to CAM-eligible invoices');
  // Bounded by CONTENT, not by a byte count. A fixed window silently shrinks as
  // the code inside it grows, and an assertion whose text has slid off the end
  // of the slice passes for the wrong reason — that is exactly how a vacuous
  // test survived in test-allocation-consistency.js.
  const end = scriptCode.indexOf('const byYear = {};', i);
  ok(end > i, 'could not find the end of the concentration block (the YoY detector that follows it)');
  const body = scriptCode.slice(i, end);
  ok(/const thresh = camPool \* 0\.4;/.test(body), 'the threshold is still struck off the gross total');
  ok(/\(\(amt \/ camPool\) \* 100\)/.test(body), 'the reported percentage still divides by the gross total');
  ok(/camInvs\.forEach/.test(body), 'the detector still scans invoices that are not in CAM');
  ok(/Total CAM pool: \$\{fmt\(camPool\)\}/.test(body), 'the stated basis is still the gross total');
  // Now that the denominator is the CAM pool, no sentence in this finding may
  // still call it the expense pool. The reader checks the claim against the
  // KPI row; two names for one number is how the defect read as plausible.
  eq(/total expense pool/i.test(body), false,
     'the detail sentence still describes the denominator as the expense pool');
});

t('[source] it falls back to the gross total on a pre-existing snapshot', () => {
  ok(/lastCamPool \|\| window\.CamPool\.total\(invs\) \|\| \(lastTotal \|\| 0\)/.test(scriptCode),
     'a snapshot written before lastCamPool existed would divide by zero and raise nothing');
});

t('[source] the KPI labelled "CAM Pool" shows the CAM pool', () => {
  ok(/const camPoolTotal = window\.CamPool\.total\(invoices\)/.test(scriptCode));
  ok(/\$\{fmt\(camPoolTotal\)\}<\/div><div class="rcs-kpi-lbl">CAM Pool/.test(scriptCode),
     'the KPI still shows the gross expense total under a CAM label');
});

t('[source] the variance panel KEEPS the gross pool — its own words say so', () => {
  // Not every consumer should switch. The banner and the panel are labelled
  // "expense pool" and exist to explain gross -> billed, with "Marked not
  // CAM-eligible" as one of their named buckets. Changing their basis would
  // delete the explanation the manager needs.
  ok(/const totalPool   = invoices\.reduce\(\(s, inv\) => s \+ \(parseFloat\(inv\.amount\) \|\| 0\), 0\);/.test(scriptCode),
     'the variance basis changed — the not-eligible bucket has nothing left to explain');
  ok(/const variance = Math\.abs\(totalBilled - totalPool\);/.test(scriptCode),
     'the variance is no longer struck against the gross pool');
});

t('[source] lastTotal is untouched — 30 consumers, including saved hashes', () => {
  ok(/lastTotal           = totalCost;/.test(scriptCode),
     'lastTotal was redefined; every report KPI and every snapshot signature reads it');
  ok(/lastCamPool         = camPool;/.test(scriptCode), 'the CAM pool is not captured beside it');
});

console.log('\n' + '─'.repeat(56));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
