'use strict';
/**
 * test-invoice-match-confidence.js — a warning must name something that could be
 * wrong, not the normal state of the thing it decorates.
 *
 *   node test-invoice-match-confidence.js
 *
 * F-14 — ONE IDEA, IMPLEMENTED TWICE, ALWAYS TRUE AND NEVER TRUE
 *
 * `matchInvoiceToTenant` assigns a ROUTING SIGNAL with exactly three reachable
 * values: 0 (no tenant matched), 75 (tenant name hit), 90 (unit number hit).
 * Two consumers were written as though it were a continuous score with a
 * meaningful band beneath the direct-charge threshold. There is no such band.
 *
 *   the per-invoice flag tested  matchConfidence < 75
 *       which is identical to `=== 0`, which is the DEFINITION of a shared
 *       invoice — `sharedInvoices` is built by filtering on that exact
 *       predicate. Measured on the Kettle Row fixture: 16 of 17 charge rows
 *       carried "Low confidence invoice match", including janitorial and
 *       insurance invoices that were never expected to match anyone.
 *
 *   the audit detector tested    matchConfidence > 0 && matchConfidence < 75
 *       an empty band. It could not be raised by any input, and its own detail
 *       text described a state the matcher cannot produce.
 *
 * WHAT THE UNCERTAINTY ACTUALLY IS
 *
 * Not the number — what the matcher throws away:
 *
 *   A TIE. `conf > bestConf` is strict, so when two tenants hit equally the
 *   FIRST IN THE ARRAY takes the whole invoice. Reverse the tenant order and a
 *   different tenant is billed the full amount. Nothing reported it.
 *
 *   A NEAR MISS. A tenant's own unit number or name appears in the invoice text
 *   but is too short for the CAM-4 guard to trust — "Unit 5", a tenant called
 *   "BP". The guard is correct and stays; its silence was the defect, because
 *   the result was indistinguishable from an ordinary shared invoice.
 *
 * D16 — AND THE SAME DEFECT'S THIRD HEAD. `averageConfidence` was a
 * share-weighted mean of that routing signal, displayed as "Confidence 32%".
 *
 * THE THREE BEHAVIOURS THIS PINS
 *
 *   ordinary shared invoice  →  no warning, billed normally
 *   genuine ambiguous match  →  named candidates, blocks billing
 *   near-match signal        →  advisory finding, allocation unchanged
 *
 * Positive and negative for each, and no money moves anywhere.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(36) + ':', typeof v === 'string' ? v : JSON.stringify(v));

const scriptSrc  = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const scriptCode = scriptSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── The real matcher, lifted out of script.js ───────────────────────────────
function loadMatcher() {
  const i = scriptSrc.indexOf('function matchInvoiceToTenant');
  const src = scriptSrc.slice(i, scriptSrc.indexOf('\n}\n', i) + 3);
  const sb = { console: { log() {} }, RegExp, String, Number, Array, Object, Math, JSON };
  vm.createContext(sb);
  vm.runInContext(src + '\nthis.__m = matchInvoiceToTenant;', sb);
  return sb.__m;
}
const match = loadMatcher();

const T = (name, unit, id) => ({ tenant_name: name, unitNumber: unit, id });
const INV = (vendorName, category) => ({ vendorName, category: category || 'repairs' });

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 1 · The band beneath the threshold is empty ══');
//
// The assertion that would have caught BOTH halves of F-14 on the day they were
// written: a consumer may not reason about a range the producer cannot emit.

const CORPUS_TENANTS = [T('Alder Bakery', '210', 't1'), T('Birch Optical', '214', 't2'),
                        T('Cedar Fitness', '5', 't3'), T('BP', '', 't4')];
const CORPUS = [
  INV('Halloway Janitorial', 'janitorial'), INV('Prosper Insurance', 'insurance'),
  INV('Meriden Utilities', 'utilities'),    INV('Ashgrove Security', 'security'),
  INV('Glazing repair unit 210'),           INV('Alder Bakery grease trap'),
  INV('Repair to Unit 5'),                  INV('BP fuel surcharge', 'utilities'),
  INV('Glazing repair units 210 and 214'),  INV('Roofing works'),
];
const seen = new Set();
CORPUS.forEach(inv => {
  const d = match(inv, CORPUS_TENANTS);
  seen.add(d.match ? d.match.confidence : 0);
  (d.candidates || []).forEach(c => seen.add(c.confidence));
});
R('confidence values reachable', [...seen].sort((a, b) => a - b));
yes('every confidence the matcher can emit is 0, 75 or 90 — nothing in between',
    [...seen].every(v => v === 0 || v === 75 || v === 90), JSON.stringify([...seen]));
yes('    so a filter on `> 0 && < 75` selects nothing, whatever the input',
    CORPUS.every(inv => {
      const d = match(inv, CORPUS_TENANTS);
      const c = d.match ? d.match.confidence : 0;
      return !(c > 0 && c < 75);
    }));
yes('[source] no consumer reasons about a confidence strictly between 0 and 75',
    !/matchConfidence\s*>\s*0\s*&&\s*[\w.]*matchConfidence\s*<\s*75/.test(scriptCode),
    'a consumer is still filtering on the empty band');
// CODE, NOT PROSE. The removal is documented in a comment that quotes the
// string it removed — as it should be — so this reads the comment-stripped
// source. The same trap caught the T2 day-count assertion in P6.
yes('[source] the blanket "Low confidence invoice match" flag is gone',
    !/Low confidence invoice match/.test(scriptCode),
    'the warning that fired on every shared invoice is still attached');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 2 · NEGATIVE — an ordinary shared invoice says nothing ══');

const ORDINARY = [INV('Halloway Janitorial', 'janitorial'), INV('Prosper Insurance', 'insurance'),
                  INV('Meriden Utilities', 'utilities'),    INV('Ashgrove Security', 'security')];
const ordinary = ORDINARY.map(inv => match(inv, [T('Alder Bakery', '210', 't1'),
                                                 T('Birch Optical', '214', 't2')]));
R('ordinary results', ordinary.map(d => ({ m: d.match, amb: d.ambiguous, nm: d.nearMisses.length })));
yes('nothing matches, and nothing is reported',
    ordinary.every(d => d.match === null && d.ambiguous === false && d.nearMisses.length === 0));
yes('    no candidates are invented for an invoice that matched no one',
    ordinary.every(d => d.candidates.length === 0));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 3 · POSITIVE — a tie, and it is order-independent ══');
//
// THE DEFECT, MEASURED: the same invoice billed a different tenant depending on
// which lease was read first. The selection still does that — changing it would
// be inventing an answer — but the TIE is now on the record, and the audit layer
// refuses to bill either candidate until a person resolves it.

const TIE_INV = INV('Glazing repair units 210 and 214');
const fwd = match(TIE_INV, [T('Alder Bakery', '210', 't1'), T('Birch Optical', '214', 't2')]);
const rev = match(TIE_INV, [T('Birch Optical', '214', 't2'), T('Alder Bakery', '210', 't1')]);

R('forward → billed', fwd.match.tenantName);
R('reversed → billed', rev.match.tenantName);
R('forward candidates', fwd.tied.map(c => c.tenantName));
R('reversed candidates', rev.tied.map(c => c.tenantName));

yes('the tie is detected',
    fwd.ambiguous === true && rev.ambiguous === true);
yes('    and it names BOTH tenants, with the signal each matched on',
    fwd.tied.length === 2
      && fwd.tied.map(c => c.tenantName).sort().join('|') === 'Alder Bakery|Birch Optical'
      && fwd.tied.every(c => /Unit 21[04]/.test(c.reason)),
    JSON.stringify(fwd.tied));
// THE ORDER-INDEPENDENCE ASSERTION. The billed tenant still flips — that is the
// defect being reported, not fixed — but the FINDING must be identical, or a
// manager's screen would depend on lease upload order.
yes('ORDER-INDEPENDENT: reversing the tenant array yields an identical candidate set',
    JSON.stringify(fwd.tied.map(c => c.tenantName).sort())
      === JSON.stringify(rev.tied.map(c => c.tenantName).sort()),
    JSON.stringify({ fwd: fwd.tied, rev: rev.tied }));
yes('    and identical confidences and reasons',
    JSON.stringify([...fwd.tied].sort((a, b) => a.tenantName < b.tenantName ? -1 : 1))
      === JSON.stringify([...rev.tied].sort((a, b) => a.tenantName < b.tenantName ? -1 : 1)));
yes('    the run still reveals that the BILLED tenant depends on order — which is why it blocks',
    fwd.match.tenantName !== rev.match.tenantName,
    'the fixture no longer reproduces the order dependence it exists to report');
yes('a single-tenant match is NOT reported as a tie',
    match(INV('Glazing repair unit 210'),
          [T('Alder Bakery', '210', 't1'), T('Birch Optical', '214', 't2')]).ambiguous === false);
yes('    nor is a name hit that beats nothing',
    match(INV('Alder Bakery grease trap'),
          [T('Alder Bakery', '210', 't1'), T('Birch Optical', '214', 't2')]).ambiguous === false);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 4 · POSITIVE — a near miss, reported without changing anything ══');

const short = match(INV('Repair to Unit 5'), [T('Cedar Fitness', '5', 't3')]);
const bp    = match(INV('BP fuel surcharge', 'utilities'), [T('BP', '', 't4')]);
R('unit "5"', { match: short.match, nearMisses: short.nearMisses });
R('tenant "BP"', { match: bp.match, nearMisses: bp.nearMisses });

yes('a single-character unit that appears in the text is reported as a near miss',
    short.nearMisses.length === 1 && short.nearMisses[0].signal === 'unit'
      && short.nearMisses[0].token === '5' && short.nearMisses[0].tenantName === 'Cedar Fitness',
    JSON.stringify(short.nearMisses));
yes('    and it is STILL not matched — the CAM-4 guard is untouched',
    short.match === null, JSON.stringify(short.match));
yes('a too-short tenant name that appears in the text is reported as a near miss',
    bp.nearMisses.length === 1 && bp.nearMisses[0].signal === 'name' && bp.nearMisses[0].token === 'BP',
    JSON.stringify(bp.nearMisses));
yes('    and it is STILL not matched',
    bp.match === null);
yes('NEGATIVE: a short unit that does NOT appear in the text raises nothing',
    match(INV('Halloway Janitorial', 'janitorial'), [T('Cedar Fitness', '5', 't3')]).nearMisses.length === 0);
yes('NEGATIVE: a long unit that matches properly is a match, not a near miss',
    (() => { const d = match(INV('Glazing repair unit 210'), [T('Alder Bakery', '210', 't1')]);
             return d.match && d.match.confidence === 90 && d.nearMisses.length === 0; })());
yes('NEGATIVE: the word-boundary rule still refuses a substring, and does not call it a near miss',
    (() => { const d = match(INV('Roofing works'), [T('Roof', '', 't9')]);
             return d.match === null && d.nearMisses.length === 0; })(),
    'fuzzy vendor/tenant overlap has leaked back in');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 5 · The selection is unchanged — no money moves ══');
//
// F-14 is a reporting change. Every invoice must route exactly as it did before:
// the same tenant, the same confidence, the same direct/shared split.

const ROUTING = [
  [INV('Halloway Janitorial', 'janitorial'), null, 0],
  [INV('Glazing repair unit 210'), 'Alder Bakery', 90],
  [INV('Alder Bakery grease trap'), 'Alder Bakery', 75],
  [INV('Repair to Unit 5'), null, 0],
  [INV('BP fuel surcharge', 'utilities'), null, 0],
  [INV('Roofing works'), null, 0],
];
const ALL_T = [T('Alder Bakery', '210', 't1'), T('Birch Optical', '214', 't2'),
               T('Cedar Fitness', '5', 't3'), T('BP', '', 't4')];
ROUTING.forEach(([inv, who, conf]) => {
  const d = match(inv, ALL_T);
  const gotWho  = d.match ? d.match.tenantName : null;
  const gotConf = d.match ? d.match.confidence : 0;
  yes(`"${inv.vendorName}" routes to ${who === null ? 'the shared pool' : who} at ${conf}`,
      gotWho === who && gotConf === conf, JSON.stringify({ gotWho, gotConf }));
});
yes('[source] the tie-break is still strictly greater — the winner did not change',
    /if \(conf > bestConf\) \{/.test(scriptCode),
    'the selection rule moved; a tie would now pick a different tenant');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 6 · The findings the detectors will raise ══');

yes('[source] the ambiguity finding blocks billing',
    /AMBIGUOUS|Confirm which tenant \$\{inv\.vendorName\} belongs to/.test(scriptSrc)
      && /blocksBilling: true,\n          title:  `Confirm which tenant/.test(scriptSrc),
    'the tie no longer blocks a statement');
yes('[source] it is scoped to each tied candidate, so every one of them is held',
    /`Tenant: \$\{cand\.tenantName\}`/.test(scriptSrc),
    'the finding names no tenant, so it would block the whole property instead');
yes('[source] it names the invoice, the amount and every tied candidate',
    /Matched: \$\{c\.tenantName\} on "\$\{c\.reason\}" at \$\{c\.confidence\}%/.test(scriptSrc)
      && /Invoice: "\$\{inv\.vendorName\}" \$\{fmt\(amt\)\}/.test(scriptSrc));
yes('[source] and says the billed tenant was chosen by read order, not by the document',
    /because that lease was read first, not because the document says so/.test(scriptSrc));
yes('[source] the near-miss finding is advisory — it does NOT block billing',
    /blocksBilling: false,\n        title:  `\$\{nearMiss\.length\} invoice/.test(scriptSrc),
    'an advisory finding is holding statements');
yes('[source] and it says the allocation is unchanged by it',
    /which is the safe treatment and is unchanged by this finding/.test(scriptSrc));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══ 7 · D16 — no misleading confidence statistic survives ══');

yes('[source] ReconciliationResult no longer computes an averageConfidence',
    !/this\.averageConfidence\s*=/.test(scriptCode),
    'the share-weighted mean of a routing signal is still being computed');
yes('[source] the per-tenant "Confidence N%" stat is gone',
    !/stat\('Confidence'/.test(scriptCode), 'the per-tenant confidence stat still renders');
yes('[source] the summary badge no longer prints a confidence percentage',
    !/% confidence/.test(scriptCode), 'a confidence percentage still reaches the summary');
yes('    and the badge keeps the count that did mean something',
    /item\$\{reviewFieldCount !== 1 \? 's' : ''\} need review/.test(scriptSrc),
    'the "N items need review" count was lost with the percentage');
yes('[source] the CSV export no longer falls back to invoice-match confidence',
    !/r\.averageConfidence > 0 \? r\.averageConfidence/.test(scriptCode));
// The honest replacement is nothing. Extraction confidence — how well the lease
// was READ — is a different and defensible measure, and it is untouched.
yes('[source] lease-extraction confidence is untouched, being a real measure',
    /_confidence === 'low'/.test(fs.readFileSync(path.join(__dirname, 'selectors.js'), 'utf8')),
    'the extraction-confidence metric was removed along with the fake one');

console.log('\n' + '─'.repeat(58));
console.log(fail === 0
  ? `\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`
  : `\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail > 0 ? 1 : 0);
