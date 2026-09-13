'use strict';
/**
 * test-cap-workflow.js — the first-year CAM cap workflow, smallest safe slice.
 *
 *   node test-cap-workflow.js
 *
 * What this slice claims, and what each section proves:
 *
 *   A. The cap's unit is READ from the stored clause, never guessed from the
 *      number. Undeclared is the default, so silence cannot read as a percent.
 *   B. deriveCapState names one of five states, and only the state a base
 *      actually fixes is marked actionable.
 *   C. Zero is not a base. This is the destructive case: the old condition let
 *      it through and the engine capped the whole bill to $0.
 *   D. The explainability surface and the banner cannot name different causes,
 *      because both read the same derivation.
 *   E. The banner's action reaches the EXISTING provenanced field.
 *   F. A manager-entered base stays manually_entered and can never render as
 *      lease-extracted.
 *   G. Enforced caps are untouched — the arithmetic for a valid base is exactly
 *      what it was.
 *   H. The six MCP CAM exposure paths remain behind the M8d trust gate.
 *
 * Two styles, deliberately, following test-phase0-remediation.js: the
 * lease-intelligence.js assertions EXECUTE the real module from disk, and the
 * script.js assertions read comment-stripped SOURCE because that file is a
 * 28k-line browser-bound script with no seam to call. Source assertions are
 * weaker, are marked as such, and are mutation-proven in tools/ so they cannot
 * pass vacuously.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let pass = 0, fail = 0;
const failures = [];

function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }
function sec(s) { console.log(`\n── ${s} ──`); }

// Strip comments so no assertion can be satisfied by the fix's own prose. The
// same helper test-phase0-remediation.js uses, and it is self-tested below.
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ── Load the real module ─────────────────────────────────────────────────────
const liSrc = fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(liSrc, sandbox, { filename: 'lease-intelligence.js' });
const LI = sandbox.window.LeaseIntelligence;

const scriptSrc = code(fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8'));

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A cap whose clause states a PERCENTAGE, the way a real lease writes it.
const quoted = (q) => ({ fieldEvidence: { cam_cap: { snapshots: [{ quote: q, page: 12 }] } } });

// generateLeaseExplainability short-circuits to "Lease incomplete" unless every
// RECONCILIATION_CRITICAL_FIELD is present, and section D asserts on the cap
// phrase that only the COMPLETE branch produces. So the fixtures carry a whole
// lease; a cap fixture missing its dates tests the incompleteness message
// instead of anything about caps.
const COMPLETE = { leased_sqft: 9200, start_date: '2020-01-01', end_date: '2030-12-31',
                   lease_type: 'Triple Net (NNN)', pro_rata_method: 'rentable',
                   audit_rights: true, amendments: [] };

const PCT_NO_BASE  = { id: 'p1', tenant_name: 'Maple Coffee Co', cap: 5, capBaseAmount: null, ...COMPLETE,
                       ...quoted('CAM increases shall not exceed five percent (5%) per annum over the prior year') };
const PCT_BASE     = { ...PCT_NO_BASE, id: 'p2', capBaseAmount: 26000 };
const PCT_ZERO     = { ...PCT_NO_BASE, id: 'p3', capBaseAmount: 0 };
const DOLLAR_CAP   = { id: 'd1', tenant_name: 'Harbor Books', cap: 50000, capBaseAmount: null, ...COMPLETE,
                       ...quoted('Tenant shall not pay more than $50,000 in CAM in any calendar year') };
const UNDECLARED   = { id: 'u1', tenant_name: 'Canvas On Demand', cap: 5.25, capBaseAmount: null,
                       ...COMPLETE, fieldEvidence: {} };
const NO_CAP       = { id: 'n1', tenant_name: 'Wink Davis', cap: null, capBaseAmount: null,
                       ...COMPLETE, fieldEvidence: {} };

// ── A. The unit is read, never guessed ───────────────────────────────────────
sec('A. Cap unit comes from the clause, not the number');
{
  t('A1 a clause saying "five percent (5%)" declares percent', () => {
    eq(LI.capUnit(PCT_NO_BASE), 'percent');
  });
  t('A2 a clause saying "$50,000" declares dollars', () => {
    eq(LI.capUnit(DOLLAR_CAP), 'dollar');
  });
  t('A3 no evidence at all leaves the unit UNDECLARED — silence is not a percent', () => {
    eq(LI.capUnit(UNDECLARED), 'undeclared');
    eq(LI.capUnit({}), 'undeclared');
    eq(LI.capUnit(null), 'undeclared');
  });
  t('A4 a clause carrying BOTH marks settles nothing', () => {
    eq(LI.capUnit(quoted('capped at 5% but in no event more than $50,000')), 'undeclared',
       'a compound term is not a majority vote');
  });
  t('A5 two clauses that disagree settle nothing either', () => {
    const split = { fieldEvidence: { cam_cap: { snapshots: [
      { quote: 'increases limited to 5% annually' }, { quote: 'not to exceed $50,000' } ] } } };
    eq(LI.capUnit(split), 'undeclared');
  });
  t('A6 a quote with no unit word at all is undeclared, not defaulted', () => {
    eq(LI.capUnit(quoted('the cap referenced in Exhibit C shall apply')), 'undeclared');
  });
  t('A7 THE NUMBER IS NEVER CONSULTED — identical clauses, wildly different values', () => {
    // If magnitude leaked into the decision, one of these would differ. 0.05,
    // 5 and 50000 all carry the same percent clause and must all read percent.
    for (const v of [0.05, 5, 120, 50000]) {
      eq(LI.capUnit({ cap: v, ...quoted('shall not exceed five percent (5%)') }), 'percent',
         `cap value ${v} changed the unit`);
    }
    for (const v of [0.05, 5, 120, 50000]) {
      eq(LI.capUnit({ cap: v, ...quoted('shall not exceed $5.00 per square foot') }), 'dollar',
         `cap value ${v} changed the unit`);
    }
  });
  t('A8 the canonical key and the extraction key are both read', () => {
    eq(LI.capUnit({ fieldEvidence: { cap: { snapshots: [{ quote: '5 percent' }] } } }), 'percent');
    eq(LI.capUnit({ fieldEvidence: { cam_cap: { snapshots: [{ quote: '5 percent' }] } } }), 'percent');
  });
  // MUTATION NOTE (M11, survivor, EQUIVALENT — proved, not waved through):
  // deleting `.trim()` from the quote filter cannot change any answer. A
  // whitespace-only quote carries neither a percent mark nor a dollar mark, so
  // whether it enters the list or not, capUnit returns UNDECLARED — via the
  // empty-list early return in one case and via the fall-through return in the
  // other. The guard is kept because _capQuotes is a general helper and "a
  // blank string is not a clause" is the property it should hold, but no test
  // can distinguish its presence, and pretending otherwise would be inventing a
  // kill. This assertion pins the OUTCOME, which is the part that matters.
  t('A9 a blank or whitespace quote does not declare a unit', () => {
    eq(LI.capUnit(quoted('   ')), 'undeclared');
    eq(LI.capUnit(quoted('')), 'undeclared');
    // And it does not mask a real clause sitting beside it.
    eq(LI.capUnit({ fieldEvidence: { cap: { snapshots: [
      { quote: '   ' }, { quote: 'not to exceed 5%' } ] } } }), 'percent');
  });
}

// ── B. Five states, one actionable ───────────────────────────────────────────
sec('B. deriveCapState names the cause');
{
  t('B1 percentage cap + missing base → missing_base, actionable', () => {
    const s = LI.deriveCapState(PCT_NO_BASE);
    eq(s.state, 'missing_base');
    eq(s.actionable, true, 'a manager typing one number fixes this');
    eq(s.enforceable, false);
    eq(s.field, 'cap_base_amount', 'and it names the field that fixes it');
    ok(/5%/.test(s.why), `why should quote the cap: ${s.why}`);
    ok(/no base amount on file/i.test(s.why), `why should name the gap: ${s.why}`);
  });
  t('B2 percentage cap + valid base → enforceable, no warning, NOT actionable', () => {
    const s = LI.deriveCapState(PCT_BASE);
    eq(s.state, 'enforced');
    eq(s.enforceable, true);
    eq(s.actionable, false);
    eq(s.why, null, 'an enforced cap has nothing to explain');
  });
  t('B3 no cap → no_cap, and nothing is asked for', () => {
    const s = LI.deriveCapState(NO_CAP);
    eq(s.state, 'no_cap');
    eq(s.actionable, false);
    eq(s.field, null);
    eq(s.unit, null, 'a cap that does not exist has no unit');
  });
  t('B4 dollar cap → NO base is requested', () => {
    const s = LI.deriveCapState(DOLLAR_CAP);
    eq(s.state, 'dollar_cap');
    eq(s.actionable, false, 'asking for a prior-year base here would be a lie about what would help');
    eq(s.field, null);
    eq(s.needed, null);
    // The message may MENTION a base in order to rule it out ("a prior-year base
    // would not change that"); what it must never do is ASK for one. The first
    // version of this assertion banned the word and so failed on a sentence
    // whose whole purpose was to stop the manager going to look.
    ok(!/\b(enter|add|provide|supply)\b/i.test(s.why), `must not request a base: ${s.why}`);
    ok(/would not change that|not being applied/i.test(s.why),
       `must say plainly that no base is wanted: ${s.why}`);
  });
  t('B4b a dollar cap the engine still calculated from does not claim nothing happened', () => {
    // $50,000 is out of percentage range, so the engine builds a ceiling of
    // base x 501 from it. "Not being applied" would be the comfortable answer
    // and the imprecise one — something WAS computed, and it is nonsense.
    const s = LI.deriveCapState({ cap: 50000, capBaseAmount: 26000,
                                  ...quoted('Tenant shall not pay more than $50,000 in CAM in any year') });
    eq(s.state, 'dollar_cap');
    eq(s.engineWillCap, true);
    ok(/does not reflect the lease/i.test(s.why), `why was: ${s.why}`);
    ok(!/not being applied/i.test(s.why), `claimed nothing happened: ${s.why}`);
  });
  // ── KNOWN LIMITATION, PINNED SO IT CANNOT BE FORGOTTEN ─────────────────────
  //
  // A dollar cap whose NUMBER happens to fall in 0–100 — "$50.00 per month" —
  // with a usable base is enforced by the engine as 50%, and this slice raises
  // no warning about it, because `enforceable` mirrors the engine and the engine
  // is unit-blind by design (see deriveCapState).
  //
  // Closing it means either teaching the engine about units or adding the
  // discriminator to extraction, and BOTH are explicitly out of scope here. This
  // test does not endorse the behaviour; it records it exactly, so that a future
  // phase that fixes it will fail this assertion and have to update it
  // deliberately rather than discovering the gap again from scratch.
  t('B4c KNOWN GAP: an in-range dollar cap with a base is enforced as a percentage, silently', () => {
    const s = LI.deriveCapState({ cap: 50, capBaseAmount: 26000,
                                  ...quoted('Tenant shall not pay more than $50.00 per month in CAM') });
    eq(s.unit, 'dollar', 'the unit IS known — that is what makes this a gap and not an unknown');
    eq(s.state, 'enforced', 'if this changed to dollar_cap, the gap was closed — update this test');
    eq(s.enforceable, true);
  });
  t('B5 undeclared unit → honest weaker state, and it does NOT pretend percent', () => {
    const s = LI.deriveCapState(UNDECLARED);
    eq(s.state, 'unit_unconfirmed');
    eq(s.actionable, false);
    eq(s.field, null);
    ok(/needs confirmation/i.test(s.title), `title was: ${s.title}`);
    ok(/percentage or a dollar amount/i.test(s.why), `why was: ${s.why}`);
    ok(!/5\.25%/.test(s.why), `must not print a % sign on an undeclared cap: ${s.why}`);
  });
  t('B6 an out-of-range percentage is not silently enforced', () => {
    const s = LI.deriveCapState({ cap: 150, capBaseAmount: 10000, ...quoted('one hundred fifty percent') });
    eq(s.state, 'cap_out_of_range');
    eq(s.enforceable, false);
    eq(s.actionable, false, 'a base will not fix a 150% cap');
  });
  t('B6b and it does NOT claim no limit was applied — the live engine computes one', () => {
    // capIsEnforceable range-checks; runFullReconciliation does not. With a
    // usable base the engine still builds a ceiling from 150, so saying "no cap
    // limit was applied" would be false reassurance.
    const s = LI.deriveCapState({ cap: 150, capBaseAmount: 10000, ...quoted('one hundred fifty percent') });
    eq(s.engineWillCap, true, 'the engine gate is a finite cap and a usable base, nothing more');
    ok(/may not reflect/i.test(s.why), `why must not promise no limit: ${s.why}`);
    // Without a base, nothing is computed and the plain statement is true again.
    const nb = LI.deriveCapState({ cap: 150, capBaseAmount: null, ...quoted('one hundred fifty percent') });
    eq(nb.engineWillCap, false);
    ok(!/may not reflect/i.test(nb.why), `why over-warns with no base: ${nb.why}`);
  });
  t('B6c every state reports engineWillCap, and it matches the engine gate', () => {
    // The gate is: finite cap AND base > 0. Nothing else.
    eq(LI.deriveCapState(PCT_BASE).engineWillCap, true);
    eq(LI.deriveCapState(PCT_NO_BASE).engineWillCap, false);
    eq(LI.deriveCapState(PCT_ZERO).engineWillCap, false, 'a zero base no longer reaches the engine');
    eq(LI.deriveCapState(NO_CAP).engineWillCap, false);
    eq(LI.deriveCapState(UNDECLARED).engineWillCap, false);
  });
  t('B7 no state ever claims the cap was applied', () => {
    for (const f of [PCT_NO_BASE, PCT_ZERO, DOLLAR_CAP, UNDECLARED]) {
      const s = LI.deriveCapState(f);
      eq(s.enforceable, false, `${s.state} must not report enforceable`);
      ok(!/\bapplied\b(?!\.)|compliant|verified/i.test(String(s.title)),
         `${s.state} title implies compliance: ${s.title}`);
    }
  });
  t('B8 nothing is stored — the derivation does not mutate its input', () => {
    const before = JSON.stringify(PCT_NO_BASE);
    LI.deriveCapState(PCT_NO_BASE);
    eq(JSON.stringify(PCT_NO_BASE), before, 'deriveCapState wrote to the tenant');
  });
}

// ── C. Zero is not a base ────────────────────────────────────────────────────
sec('C. A zero base cannot silently become a valid base');
{
  t('C1 capBaseIsUsable rejects 0 and accepts a real amount', () => {
    eq(LI.capBaseIsUsable(PCT_ZERO), false, '0 is not a base');
    eq(LI.capBaseIsUsable(PCT_BASE), true);
    eq(LI.capBaseIsUsable({ capBaseAmount: -100 }), false, 'negative is not a base');
    eq(LI.capBaseIsUsable({ capBaseAmount: null }), false);
    eq(LI.capBaseIsUsable({ capBaseAmount: '26000' }), true, 'a numeric string is a base');
  });
  t('C2 a zero base lands in missing_base — the SAME state a blank does', () => {
    eq(LI.deriveCapState(PCT_ZERO).state, 'missing_base');
    eq(LI.deriveCapState(PCT_ZERO).actionable, true);
  });
  t('C3 capIsEnforceable no longer accepts a zero base', () => {
    eq(LI.capIsEnforceable(PCT_ZERO), false, 'this returned TRUE before the fix');
    eq(LI.capIsEnforceable(PCT_BASE), true);
  });
  t('C4 the engine refuses to build a ceiling from a zero base (source)', () => {
    const fn = /function _camCeilingCents[\s\S]*?\n}/.exec(scriptSrc);
    ok(fn, '_camCeilingCents not found');
    ok(/if\s*\(!\(base\s*>\s*0\)\)\s*return null;/.test(fn[0]),
       `no positive-base guard in:\n${fn[0]}`);
  });
  t('C5 null is still null — the guard did not introduce a zero substitute', () => {
    const fn = /function _camCeilingCents[\s\S]*?\n}/.exec(scriptSrc)[0];
    ok(!/return\s+0\s*;/.test(fn), 'a zero is being returned where null belongs');
    eq((fn.match(/return null;/g) || []).length, 3, 'three refusal paths, all null');
  });
}

// ── D. One derivation, so the surfaces cannot disagree ───────────────────────
sec('D. Explainability reads the same derivation as the banner');
{
  t('D1 a percentage cap with no base still says NOT ENFORCED and names the base', () => {
    const r = LI.generateLeaseExplainability(PCT_NO_BASE);
    ok(/NOT ENFORCED/.test(r.fieldSummaries.cap), r.fieldSummaries.cap);
    ok(r.reviewNotes.some(n => /NOT being enforced/.test(n) && /base amount/.test(n)),
       JSON.stringify(r.reviewNotes));
  });
  t('D2 a DOLLAR cap is not told to go and find a prior-year base', () => {
    const r = LI.generateLeaseExplainability(DOLLAR_CAP);
    ok(/NOT ENFORCED/.test(r.fieldSummaries.cap), r.fieldSummaries.cap);
    ok(!/prior-year CAM base amount/i.test(r.reviewNotes.join(' ')),
       `sent a dollar-cap manager after a base: ${JSON.stringify(r.reviewNotes)}`);
    ok(/dollar/i.test(r.fieldSummaries.cap), r.fieldSummaries.cap);
  });
  t('D3 an undeclared cap is reported unenforced, and by its real cause', () => {
    const r = LI.generateLeaseExplainability(UNDECLARED);
    ok(/not enforced/.test(r.overallSummary), r.overallSummary);
    ok(/cap type needs confirmation/i.test(r.overallSummary),
       `named the wrong cause: ${r.overallSummary}`);
    ok(!/no base amount/.test(r.overallSummary),
       `asserted a missing base on an undeclared unit: ${r.overallSummary}`);
  });
  t('D3b the "%" is withheld only from a cap the lease states in DOLLARS', () => {
    // Under the system-wide convention (UNITS: lease.cap is a percent) an
    // undeclared cap still prints "%", because the engine, the tenant card and
    // the CAM tile all apply that convention and a summary that dropped it alone
    // would simply disagree with them. A declared dollar cap is the one case
    // where the convention is known to be wrong, so there the mark comes off.
    ok(/CAM Cap: 5\.25%/.test(LI.generateLeaseExplainability(UNDECLARED).overallSummary),
       'the convention was abandoned for undeclared caps');
    const d = LI.generateLeaseExplainability(DOLLAR_CAP).overallSummary;
    ok(!/50000%/.test(d), `printed a percent sign on a dollar cap: ${d}`);
  });
  t('D4 an enforced cap says nothing about being unenforced', () => {
    const r = LI.generateLeaseExplainability(PCT_BASE);
    ok(!/NOT ENFORCED/.test(r.fieldSummaries.cap), r.fieldSummaries.cap);
    ok(/CAM Cap: 5%\./.test(r.overallSummary), r.overallSummary);
  });
}

// ── E. The action reaches the existing field ─────────────────────────────────
sec('E. The action navigates to the existing provenanced editor');
{
  t('E1 the banner derives its state rather than filtering on capPct', () => {
    ok(/_LI\.deriveCapState/.test(scriptSrc), 'banner does not call the derivation');
    ok(!/tenantsWithIncompleteCapData/.test(scriptSrc),
       'the old unit-blind filter is still present');
  });
  t('E2 the action calls openReviewItemFix with the canonical field key', () => {
    ok(/openReviewItemFix\('\$\{esc\(String\(x\.t\.id\)\)[\s\S]{0,40}?'cap_base_amount'\)/.test(scriptSrc),
       'no cap_base_amount navigation from the banner');
  });
  t('E3 openReviewItemFix can resolve that key to the real label', () => {
    const map = /const _REVIEW_FIELD_LABEL = \{[\s\S]*?\};/.exec(scriptSrc);
    ok(map, '_REVIEW_FIELD_LABEL not found');
    ok(/cap_base_amount:\s*\/\^Prior-Year CAM Base\/i/.test(map[0]),
       `no cap_base_amount entry in:\n${map[0]}`);
  });
  t('E4 and that regex matches the label actually rendered', () => {
    const label = /<label[^>]*>Prior-Year CAM Base \(\$\)[^<]*<\/label>/.exec(scriptSrc);
    ok(label, 'the Prior-Year CAM Base label is not rendered as expected');
    const text = label[0].replace(/<[^>]+>/g, '').trim();
    ok(/^Prior-Year CAM Base/i.test(text), `regex would not match "${text}"`);
  });
  t('E5 the button is offered ONLY where a base is the remedy', () => {
    ok(/x\.s\.actionable && x\.t\.id/.test(scriptSrc),
       'the action is not gated on actionable');
  });
  // E7–E9 exist because mutation testing found them missing: M19, M23 and M24
  // each broke the banner in a way every other assertion here slept through.
  t('E7b the "no cap limit" claim is made only of tenants it is true of', () => {
    ok(/const _noLimit = _capStates\.filter\(x => !x\.s\.engineWillCap\)\.length;/.test(scriptSrc),
       'the headline no longer counts which tenants actually went uncapped');
    ok(!/CAM cap unresolved<\/strong> for \$\{_capStates\.length\} tenant\$\{[^}]*\}\. These charges were/.test(scriptSrc),
       'the headline asserts no-limit unconditionally again');
  });
  t('E7 the banner shows only caps the engine is NOT enforcing', () => {
    ok(/\.filter\(x => !x\.s\.enforceable && x\.s\.state !== 'no_cap'\)/.test(scriptSrc),
       'an enforced cap would now raise a warning saying it is not enforced');
  });
  t('E7c the render order covers EVERY state the filter can admit', () => {
    // Found by mutation (M31): a state missing from _order is still counted in
    // the headline and then never listed, so the banner says "4 tenants" and
    // shows three. The list is checked against the states deriveCapState can
    // actually produce, not against a hand-copied literal.
    const m = /const _order = \[([^\]]*)\];/.exec(scriptSrc);
    ok(m, '_order was not found');
    const rendered = m[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
    const produced = new Set();
    [PCT_NO_BASE, PCT_ZERO, DOLLAR_CAP, UNDECLARED, NO_CAP, PCT_BASE,
     { cap: 150, capBaseAmount: 10000, ...quoted('one hundred fifty percent') },
     { cap: -5,  capBaseAmount: 10000, ...quoted('negative five percent') },
    ].forEach(f => {
      const s = LI.deriveCapState(f);
      if (!s.enforceable && s.state !== 'no_cap') produced.add(s.state);
    });
    produced.forEach(st => ok(rendered.indexOf(st) !== -1,
      `state "${st}" is counted by the banner but never rendered by it`));
  });
  {
    // Both of these live in the tenants projection, so scope the search to it
    // rather than trusting a bare `id:` to mean this one out of 28k lines.
    const proj = /const tenants = validTenants\.map\(t => \(\{[\s\S]*?\}\)\);/.exec(scriptSrc);
    t('E8 the projection carries the evidence the unit is derived from', () => {
      ok(proj, 'the tenants projection was not found');
      ok(/fieldEvidence:\s*t\.fieldEvidence \|\| null/.test(proj[0]),
         'without it every cap reads undeclared and nothing is ever actionable');
    });
    t('E9 the projection carries the id the action navigates by', () => {
      ok(proj, 'the tenants projection was not found');
      ok(/id:\s*t\.id \?\? null/.test(proj[0]),
         'without it the button is never rendered, whatever the state says');
    });
  }
  t('E6 no second editor for the base was created', () => {
    const editors = scriptSrc.match(/onblur="handle\w*FieldBlur\(\$\{i\},'capBaseAmount'/g) || [];
    eq(editors.length, 1, 'there must be exactly one capBaseAmount editor');
    ok(/handleProvenancedFieldBlur\(\$\{i\},'capBaseAmount'/.test(scriptSrc),
       'the one editor is no longer the provenanced one');
  });
}

// ── F. Provenance is untouched ───────────────────────────────────────────────
sec('F. A manager-entered base stays manager-entered');
{
  const fpSrc = fs.readFileSync(path.join(__dirname, 'field-provenance.js'), 'utf8');
  const fpBox = { window: {}, module: { exports: {} }, console };
  vm.createContext(fpBox);
  vm.runInContext(fpSrc, fpBox, { filename: 'field-provenance.js' });
  const FP = fpBox.window.FieldProvenance || fpBox.module.exports;

  t('F1 cap_base_amount is still NEVER_EXTRACTED', () => {
    ok(FP.NEVER_EXTRACTED && FP.NEVER_EXTRACTED.cap_base_amount === true,
       'the guarantee that a typed base cannot claim the lease is gone');
  });
  t('F2 a manager-entered base resolves manually_entered, not ai_extracted', () => {
    const p = FP.fieldProvenance('cap_base_amount', PCT_BASE, { value: PCT_BASE.capBaseAmount });
    eq(p.state, 'manually_entered');
    eq(p.cited, false, 'nothing cites it, because nothing does');
    eq(p.sourceFile, null, 'no document is attributed to a typed number');
  });
  // What NEVER_EXTRACTED actually guarantees, read from field-provenance.js
  // rather than assumed: it blocks crediting the MODEL for a value no extractor
  // can produce, and its own comment is explicit that "the three states above
  // the floor are unaffected — a cap base that later arrives with a clause still
  // reaches lease_confirmed by exactly the same rule as every other field."
  //
  // So the guarantee to pin is not "cap_base_amount can never be lease_confirmed"
  // — a lease that really does state its base year should say so. It is that a
  // number a MANAGER TYPED cannot be laundered into lease evidence, which is the
  // rule this slice must not weaken.
  t('F3 a hand-typed base cannot be laundered into lease evidence by an attached quote', () => {
    const typedButQuoted = { ...PCT_BASE, fieldEvidence: { cap_base_amount: { snapshots: [
      { fieldKey: 'cap_base_amount', value: '26000', quote: 'the 2023 base year CAM was $26,000',
        page: 7, approved: true, manuallyEdited: true } ] } } };
    const p = FP.fieldProvenance('cap_base_amount', typedButQuoted, { value: '26000' });
    eq(p.state, 'manually_entered', 'a manually-edited snapshot must stay manually entered');
    eq(FP.isLeaseConfirmed('cap_base_amount', typedButQuoted, { value: '26000' }), false,
       'a manager-supplied operating amount became lease-extracted evidence');
  });
  t('F3b and a base with no evidence at all can never be ai_extracted', () => {
    const p = FP.fieldProvenance('cap_base_amount', { ...PCT_BASE, fieldEvidence: {} },
                                 { value: '26000' });
    eq(p.state, 'manually_entered');
    ok(p.state !== 'ai_extracted', 'the model was credited for a number it cannot produce');
  });
  t('F3c the discriminating case: a real approved citation still reaches lease_confirmed', () => {
    // Proves F3 is not passing because the topic is absent. This is the one
    // legitimate route, and it requires an approved, un-edited citation.
    const cited = { ...PCT_BASE, fieldEvidence: { cap_base_amount: { snapshots: [
      { fieldKey: 'cap_base_amount', value: '26000', quote: 'the 2023 base year CAM was $26,000',
        page: 7, approved: false, manuallyEdited: false } ] } } };
    eq(FP.isLeaseConfirmed('cap_base_amount', cited, { value: '26000' }), true,
       'the citation route is gone, so F3 proves nothing');
  });
  t('F4 the five provenance states are still exactly five', () => {
    const states = new Set(Object.values(FP.STATES || {}));
    const expected = ['lease_confirmed', 'manually_confirmed', 'manually_entered', 'ai_extracted', 'unknown'];
    eq(states.size, 5, `states were ${JSON.stringify([...states])}`);
    expected.forEach(s => ok(states.has(s), `missing state ${s}`));
  });
  t('F5 this slice added no provenance state anywhere', () => {
    ok(!/manually_sourced|operator_supplied|prior_year_supplied|cap_base_confirmed/.test(liSrc + scriptSrc),
       'a new provenance-shaped state name appeared');
  });
}

// ── G. Enforced caps are arithmetically untouched ────────────────────────────
sec('G. A valid base still produces exactly the ceiling it did');
{
  // Re-implement the guarded formula and check it against the source, so a
  // change to the arithmetic (not just the guard) fails here.
  t('G1 the formula is still base x (1 + pct/100), in cents', () => {
    const fn = /function _camCeilingCents[\s\S]*?\n}/.exec(scriptSrc)[0];
    ok(/_MC\.toCents\(base \* \(1 \+ pct \/ 100\)\)/.test(fn), `formula changed:\n${fn}`);
  });
  t('G2 the enforcement gate is unchanged', () => {
    ok(/if \(lease\.capPercentage !== null && lease\.capBaseAmount !== null\)/.test(scriptSrc),
       'the cap enforcement gate moved or changed shape');
    ok(/if \(capCents !== null && rawCents > capCents\)/.test(scriptSrc),
       'the cap comparison changed');
  });
  t('G3 expectation still stamps cap_ceiling only when a ceiling exists', () => {
    const fn = /function _camExpectation[\s\S]*?\n}/.exec(scriptSrc)[0];
    ok(/if \(cents === null \|\| !_MC\) return \{ expectedCam: null, variance: null, expectedCamBasis: null \}/.test(fn),
       `the null-basis fallback changed:\n${fn}`);
    ok(/expectedCamBasis: 'cap_ceiling'/.test(fn), 'the stamp is gone');
  });
  t('G4 a zero base now yields a null expectation, not a $0 one', () => {
    // The engine is browser-bound, so this asserts the composition: a null
    // ceiling is the only input _camExpectation needs to return a null basis,
    // and C4 proved a zero base produces a null ceiling.
    const fn = /function _camExpectation[\s\S]*?\n}/.exec(scriptSrc)[0];
    ok(/const cents = _camCeilingCents\(capBaseAmount, capPercentage\)/.test(fn),
       'the expectation no longer reads the guarded ceiling');
  });
}

// ── H. The MCP trust gate is intact ──────────────────────────────────────────
sec('H. All six CAM exposure paths remain behind the M8d gate');
{
  const mcpSrc = code(fs.readFileSync(path.join(__dirname, 'api/_mcp-capabilities.js'), 'utf8'));
  t('H1 the three gate helpers still exist', () => {
    ['_gatedCamResult', '_gatedSpaces', '_gatedCam'].forEach(f =>
      ok(new RegExp(`function ${f}\\(`).test(mcpSrc), `${f} is gone`));
  });
  t('H2 all six CAM exposure paths still route through _camRow', () => {
    // M8d's invariant: no raw CAM row is spread into a response. Two of the six
    // pass _camRow as a MAP REFERENCE rather than calling it, so counting
    // `_camRow(` alone undercounts — the first version of this assertion did
    // exactly that and failed on correct code.
    const sites = [
      /return row \? _camRow\(row\) : null;/,                       // 1 _gatedCamResult
      /results: Array\.isArray\(cam\.results\).*\.map\(_camRow\)/,   // 2 cam.results
      /capped:\s*Array\.isArray\(cam\.capped\).*\.map\(_camRow\)/,   // 3 cam.capped
      /const results = rows\.map\(_camRow\);/,                       // 4 get_cam_status
      /camResult: _gatedCamResult\(s\.camResult\)/,                  // 5 spaces
      /_gatedCam\(/,                                                 // 6 property cam
    ];
    sites.forEach((re, i) => ok(re.test(mcpSrc), `exposure path ${i + 1} is no longer gated`));
  });
  t('H3 this slice did not touch the MCP surface at all', () => {
    ok(!/deriveCapState|capBaseIsUsable|cap_unit_unconfirmed/.test(mcpSrc),
       'the cap workflow leaked into the external boundary');
  });
  t('H4 the arithmetic-is-not-verification caveat still stands', () => {
    ok(/basis_is_arithmetic_not_verification/.test(mcpSrc), 'the M6 caveat is gone');
    ok(/cap_unit_ambiguous/.test(mcpSrc), 'the M7 caveat is gone');
  });
}

// ── Self-test: the source assertions are not vacuous ──────────────────────────
sec('Z. The source-reading helper actually strips comments');
{
  t('Z1 code() removes a line comment', () => {
    ok(!/NOT A REAL MATCH/.test(code('// NOT A REAL MATCH')), 'code() left a comment behind');
  });
  t('Z2 code() removes a block comment', () => {
    ok(!/NOT A REAL MATCH/.test(code('/* NOT A REAL MATCH */')), 'code() left a block comment behind');
  });
  t('Z3 the script source actually loaded', () => {
    ok(scriptSrc.length > 500000, `script.js read as ${scriptSrc.length} chars`);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
