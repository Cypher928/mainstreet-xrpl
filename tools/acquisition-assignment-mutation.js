'use strict';
/**
 * tools/acquisition-assignment-mutation.js — would the rule matrix notice if the
 * proposer stopped stopping to ask?
 *
 *   node tools/acquisition-assignment-mutation.js
 *
 * Each mutant is a single, plausible edit to a rule I-3a introduced in
 * acquisition-assignment.js — a strength, a threshold, a block, the one hop, the
 * validator, the words. A SURVIVOR means the matrix would not have noticed the
 * regression and is either a real gap or an equivalent mutant that must be
 * argued for.
 *
 *     A01  a generic-only name is matched as a name
 *     A02  a tenant two prospects share counts as medium (the chain is ignored)
 *     A03  a similar tenant counts as known
 *     A04  two known tenants make a roster
 *     A05  a suite alone scores
 *     A06  a lease that names two properties becomes several
 *     A07  unbalanced portfolio mentions become several
 *     A08  an unset type is trusted to be multi-property
 *     A09  a medium clue elsewhere no longer blocks a proposal
 *     A10  two AI-only medium clues carry a proposal
 *     A11  an unknown address no longer blocks a proposal
 *     A12  a single medium clue proposes
 *     A13  "other" is portfolio-capable
 *     A14  the balance ratio is loosened to one tenth
 *     A15  the sibling clue chains (a sibling's own lent clue is passed on)
 *     A16  a shared tenant lends a sibling clue
 *     A17  the sibling clue is strong
 *     A18  near-duplicates ignore the tenant
 *     A19  assign accepts several where the decision did not allow it
 *     A20  assign accepts a prospect that is not open
 *     A21  assign forgets what was proposed
 *     A22  recompute writes the proposal into the assignment
 *     A23  a left-out file is still decided
 *     A24  a unit number is read as an unknown address
 *     A25  the address reason drops its snippet
 *     A26  a question is headlined as several
 *     A27  a single open prospect is implicitly its own
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const A = 'acquisition-assignment.js';

const MUTANTS = [
  { id: 'A01', file: A, why: 'a generic-only name is matched as a name',
    from: "    if (!profile.genericName && profile.nameWords.length && !profile.addressShapedName) {",
    to:   "    if (profile.nameWords.length && !profile.addressShapedName) {" },
  { id: 'A02', file: A, why: 'a tenant two prospects share counts as medium (the chain is ignored)',
    from: "        clues.push(clue(KIND.TENANT_KNOWN, shared ? STRENGTH.WEAK : STRENGTH.MEDIUM,",
    to:   "        clues.push(clue(KIND.TENANT_KNOWN, STRENGTH.MEDIUM," },
  { id: 'A03', file: A, why: 'a similar tenant counts as known',
    from: "      var known = profile.tenants.filter(function (t) { return _sameTenant(tn, t, deps); });",
    to:   "      var known = profile.tenants.filter(function (t) { return _sameTenant(tn, t, deps) || !!_similarTenant(tn, t, deps); });" },
  { id: 'A04', file: A, why: 'two known tenants make a roster',
    from: "    if (named.length >= ROSTER_MIN) {", to: "    if (named.length >= 2) {" },
  { id: 'A05', file: A, why: 'a suite alone scores',
    from: "      if (c.kind === KIND.SUITE && clues.length === 1) return;   // a suite alone is nothing\n", to: "" },
  { id: 'A06', file: A, why: 'a lease that names two properties becomes several',
    from: "      if (portfolio && min / max >= BALANCE_RATIO) {", to: "      if (min / max >= BALANCE_RATIO) {" },
  { id: 'A07', file: A, why: 'unbalanced portfolio mentions become several',
    from: "      if (portfolio && min / max >= BALANCE_RATIO) {", to: "      if (portfolio) {" },
  { id: 'A08', file: A, why: 'an unset type is trusted to be multi-property',
    from: "      var portfolio = !!PORTFOLIO_TYPES[c.type];", to: "      var portfolio = !c.type || !!PORTFOLIO_TYPES[c.type];" },
  { id: 'A09', file: A, why: 'a medium clue elsewhere no longer blocks a proposal',
    from: "      if (mediums.length) {\n        out.state = STATE.CANDIDATES; out.candidates = [top].concat(mediums); out.basis = 'competition';",
    to:   "      if (false) {\n        out.state = STATE.CANDIDATES; out.candidates = [top].concat(mediums); out.basis = 'competition';" },
  { id: 'A10', file: A, why: 'two AI-only medium clues carry a proposal',
    from: "      if (textMedium && !unknown.length) {", to: "      if (!unknown.length) {" },
  { id: 'A11', file: A, why: 'an unknown address no longer blocks a proposal',
    from: "      if (textMedium && !unknown.length) {", to: "      if (textMedium) {" },
  { id: 'A12', file: A, why: 'a single medium clue proposes',
    from: "    if (mediumsAll.length === 1 && mediumsAll[0].medium >= 2) {", to: "    if (mediumsAll.length === 1 && mediumsAll[0].medium >= 1) {" },
  { id: 'A13', file: A, why: '"other" is portfolio-capable',
    from: "  var PORTFOLIO_TYPES = { rent_roll: 1, psa: 1, financial_statement: 1 };", to: "  var PORTFOLIO_TYPES = { rent_roll: 1, psa: 1, financial_statement: 1, other: 1 };" },
  { id: 'A14', file: A, why: 'the balance ratio is loosened to one tenth',
    from: "  var BALANCE_RATIO = 1 / 3;", to: "  var BALANCE_RATIO = 1 / 10;" },
  { id: 'A15', file: A, why: "the sibling clue chains (a sibling's own lent clue is passed on)",
    from: "            var strong = (firstPass[sib.itemId][p.reviewId] || []).some(function (cl) { return cl.strength === STRENGTH.STRONG && TEXT_BASED[cl.kind]; });",
    to:   "            var strong = (firstPass[sib.itemId][p.reviewId] || []).some(function (cl) { return cl.strength !== STRENGTH.WEAK; });" },
  { id: 'A16', file: A, why: 'a shared tenant lends a sibling clue',
    from: "      if (!tn || prospectsKnowing(profs, tn, deps).length >= 2) return;", to: "      if (!tn) return;" },
  { id: 'A17', file: A, why: 'the sibling clue is strong',
    from: "          entry[rid].push(clue(KIND.BATCH_SIBLING, STRENGTH.MEDIUM, { matched: stn, aiDerived: true,",
    to:   "          entry[rid].push(clue(KIND.BATCH_SIBLING, STRENGTH.STRONG, { matched: stn, aiDerived: true," },
  { id: 'A18', file: A, why: 'near-duplicates ignore the tenant',
    from: "        if (!na || !nb || !_sameTenant(na, nb, deps)) continue;\n", to: "" },
  { id: 'A19', file: A, why: 'assign accepts several where the decision did not allow it',
    from: "      if (!decision || !decision.multiAllowed) return { ok: false, error: 'This document can be filed to one property. Only a portfolio document that names several properties in balance can go to more than one.' };",
    to:   "      if (false) return { ok: false, error: 'This document can be filed to one property. Only a portfolio document that names several properties in balance can go to more than one.' };" },
  { id: 'A20', file: A, why: 'assign accepts a prospect that is not open',
    from: "    if (missing.length) return { ok: false, error: 'That prospect is not open.' };", to: "    if (false) return { ok: false, error: 'That prospect is not open.' };" },
  { id: 'A21', file: A, why: 'assign forgets what was proposed',
    from: "fromProposal: ids.length === 1 && proposedReviewId === ids[0], proposedReviewId: proposedReviewId } };",
    to:   "fromProposal: false, proposedReviewId: null } };" },
  { id: 'A22', file: A, why: 'recompute writes the proposal into the assignment',
    from: "      decisions[it.itemId] = d;\n",
    to:   "      decisions[it.itemId] = d;\n      if (d.proposal && !it.assignment) it.assignment = { reviewIds: [d.proposal.reviewId], by: 'ai', at: 'now' };\n" },
  { id: 'A23', file: A, why: 'a left-out file is still decided',
    from: "    var live = _arr(items).filter(function (it) { return it && !it.removed && it.state !== 'left_out'; });\n    var firstPass = {};",
    to:   "    var live = _arr(items).filter(function (it) { return it && !it.removed; });\n    var firstPass = {};" },
  { id: 'A24', file: A, why: 'a unit number is read as an unknown address',
    from: "      if (i > 0 && UNIT_WORDS[_norm(tokens[i - 1].w)]) continue;\n", to: "" },
  { id: 'A25', file: A, why: 'the address reason drops its snippet',
    from: "      case KIND.ADDRESS:        return 'Its address “' + c.matched + '” appears' + times + ' (' + c.snippet + ') — the address you gave.';",
    to:   "      case KIND.ADDRESS:        return 'Its address “' + c.matched + '” appears' + times + ' — the address you gave.';" },
  { id: 'A26', file: A, why: 'a question is headlined as several',
    from: "    else if (d.state === STATE.CANDIDATES) headline = 'Could belong to ' + names.join(' or ') + ' — which is it?';",
    to:   "    else if (d.state === STATE.CANDIDATES) headline = 'Names several properties — and may cover them';" },
  { id: 'A27', file: A, why: 'a single open prospect is implicitly its own',
    from: "    out.state = STATE.NONE; out.basis = unknown.length ? 'unknown_address' : 'no_clue';",
    to:   "    if (c.prospectsCount === 1 && ranked.length) { out.state = STATE.PROPOSED; out.proposal = ranked[0]; out.candidates = [ranked[0]]; out.basis = 'only'; addUnknown(); return out; }\n    out.state = STATE.NONE; out.basis = unknown.length ? 'unknown_address' : 'no_clue';" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-assign-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = fs.readFileSync(path.join(ROOT, A), 'utf8');
const SUITES = ['test-acquisition-assignment.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 300000 }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 300000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const i = ORIGINAL.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (ORIGINAL.indexOf(m.from, i + 1) !== -1) console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE — mutating only the first`);
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, A), ORIGINAL.slice(0, i) + m.to + ORIGINAL.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, A), ORIGINAL);
  if (passedM) { survived.push(`${m.id}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                        console.log(`  kill ${m.id}  ${m.why}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  - ' + s));
  process.exit(1);
}
