'use strict';
/**
 * test-cap-base-provenance.js — S1: the cap base gets a provenance, and the
 * weakest TRUE one rather than a convenient one.
 *
 *   node test-cap-base-provenance.js
 *
 * WHAT S1 CHANGED, AND WHY THE FLOOR MOVED
 * ----------------------------------------
 * `cap_base_amount` was absent from CANONICAL_FIELDS, so FieldProvenance never
 * resolved it and PropertyRecord never carried it. A CAM ceiling is
 * capBaseAmount x (1 + cap%), so half of every enforced cap rested on a number
 * no surface could describe at all.
 *
 * Admitting it to the list is most of S1. But the resolver's floor is
 * `ai_extracted` — "a model read a document and nothing points at the passage"
 * — and no extraction path in MainStreet has ever produced a cap base. Left
 * alone, S1 would have taken hand-typed numbers and credited a machine for
 * them: a false claim about origin, created where previously there was none,
 * on the one field this workstream exists to make honest. NEVER_EXTRACTED
 * moves that floor to `manually_entered`, which is the weakest claim that is
 * also true.
 *
 * THE TWO AXES, WHICH THIS SUITE KEEPS APART
 * ------------------------------------------
 * PROVENANCE OF THE BASE answers "where did $26,000 come from" and lives in
 * FieldProvenance. THE MATHEMATICAL BASIS answers "what arithmetic produced
 * $27,300" and lives in expected_cam_basis. They are independent: a correct
 * cap_ceiling calculation can rest on a manually entered base, and saying so
 * is more useful than discarding the arithmetic. Group F asserts that
 * independence directly, because collapsing the two is the tempting mistake.
 */

const assert = require('assert');
const path   = require('path');
const R      = __dirname;

const FP = require(path.join(R, 'field-provenance.js'));
const LI_SRC = require('fs').readFileSync(path.join(R, 'lease-intelligence.js'), 'utf8');

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };
const is  = (actual, expected, m) => {
  try { assert.deepStrictEqual(actual, expected); ok(m); }
  catch (_) { bad(m, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); }
};
const truthy = (v, m) => v ? ok(m) : bad(m, 'expected truthy, got ' + JSON.stringify(v));

/**
 * A tenant as Pilot actually persists one: typed base, no snapshot, no override.
 *
 * `fileName` is set deliberately. Every Pilot tenant carrying a cap base also
 * carries the lease it was uploaded from, and the floor branch is one `||` away
 * from attributing that document to a hand-typed number. Without a filename on
 * the fixture, `sourceFile: null` passes whether the code forces null or reads
 * t.fileName — the assertion would hold for the wrong reason.
 */
const typedBase = (v) => ({
  id: 't-typed', tenant_name: 'Maple Coffee Co', cap: 5, capBaseAmount: v,
  fileName: 'maple_plaza_messy_lease.pdf',
  fieldEvidence: {}, reviewOverrides: {},
});
/** Resolve the cap base the way PropertyRecord does — through opts.value. */
const resolve = (t) => FP.fieldProvenance('cap_base_amount', t, { value: t.capBaseAmount });

// ── A. The field is canonical ───────────────────────────────────────────────
console.log('\n── A. cap_base_amount is a canonical lease field ──');
{
  // Read from source with comments stripped: a mention in prose must not satisfy
  // an assertion about the array's contents.
  const bare = LI_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const m = bare.match(/CANONICAL_FIELDS\s*=\s*\[([\s\S]*?)\]/);
  truthy(m, 'CANONICAL_FIELDS is declared as an array literal');
  const keys = m ? m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : [];
  truthy(keys.includes('cap_base_amount'), 'cap_base_amount is in CANONICAL_FIELDS');
  truthy(keys.includes('cap'), 'cap is still there — the percentage was not displaced');
  is(keys.length, 13, 'exactly one field was added (12 → 13)');
}

// ── B. A typed base is manually_entered, never AI-credited ──────────────────
console.log('\n── B. A typed base names a person, not a machine ──');
{
  const r = resolve(typedBase('26000'));
  is(r.state, 'manually_entered', 'a stored base with no snapshot resolves to manually_entered');
  is(r.state === 'ai_extracted', false, 'it is NOT ai_extracted — no extractor can supply a cap base');
  is(r.cited, false, 'nothing cites it');
  is(r.quote, null, 'it carries no clause');
  is(r.page, null, 'it carries no page');
  is(r.sourceFile, null, 'a typed value has no source document');
  is(r.stated, true, 'a value IS on file — absence and assertion are different claims');
  is(r.label, 'Manually entered', 'the label says a person entered it');
  is(r.method, 'Manually Entered', 'the method agrees with the label');
  truthy(!/lease document/i.test(r.label), 'the label never says "lease document"');
  truthy(!/AI|extract/i.test(r.label), 'the label never credits an extraction');
  is(r.uiStatus, 'manual', 'the UI projection is manual, not estimated');
  is(r.dbStatus, 'estimated', 'the storage projection stays inside verified|estimated|missing');
  truthy(r.dbStatus !== 'verified', 'an uncited typed base can never reach verified');
}
{
  const r = resolve(typedBase(26000));   // number, not string
  is(r.state, 'manually_entered', 'a NUMERIC base resolves the same way — type is not provenance');
}

// ── C. Absence stays absence ────────────────────────────────────────────────
console.log('\n── C. No base is unknown, not "manually entered nothing" ──');
{
  for (const v of [null, undefined, '', '   ']) {
    const r = resolve(typedBase(v));
    is(r.state, 'unknown', 'base ' + JSON.stringify(v) + ' resolves to unknown');
    is(r.stated, false, '  …and claims nothing was stated');
  }
  const r = resolve(typedBase(null));
  is(r.label, 'Not found', 'the label for an absent base is "Not found"');
}

// ── D. The states above the floor are untouched ─────────────────────────────
console.log('\n── D. A cap base can still earn every higher state ──');
{
  const withSnap = (snap) => ({
    id: 't2', cap: 5, capBaseAmount: '26000',
    fieldEvidence: { cap_base_amount: { snapshots: [snap] } }, reviewOverrides: {},
  });

  const cited = resolve(withSnap({
    fieldKey: 'cap_base_amount', value: '26000', quote: 'the 2023 base year CAM was $26,000',
    page: 4, sourceFile: 'lease.pdf', extractedAt: '2026-01-01T00:00:00Z',
  }));
  is(cited.state, 'lease_confirmed', 'a quote-bearing snapshot still reaches lease_confirmed');
  is(cited.cited, true, '  …and is cited');
  is(cited.page, 4, '  …and keeps its page');
  is(cited.sourceFile, 'lease.pdf', '  …and names its document');

  const confirmed = resolve(withSnap({
    fieldKey: 'cap_base_amount', value: '26000', approved: true, manuallyEdited: false,
    reviewerEmail: 'r@example.com', reviewedAt: '2026-02-01T00:00:00Z',
  }));
  is(confirmed.state, 'manually_confirmed', 'an approved snapshot with a named reviewer reaches manually_confirmed');
  is(confirmed.by, 'r@example.com', '  …and names the reviewer');

  const edited = resolve(withSnap({
    fieldKey: 'cap_base_amount', value: '26000', approved: true, manuallyEdited: true,
    reviewerEmail: 'r@example.com', reviewedAt: '2026-02-01T00:00:00Z',
  }));
  is(edited.state, 'manually_entered', 'a manual edit stays manually_entered even when approved');

  // The floor must not swallow a page-only citation.
  const pageOnly = resolve(withSnap({
    fieldKey: 'cap_base_amount', value: '26000', quote: null, page: 7,
    sourceFile: 'lease.pdf', extractedAt: '2026-01-01T00:00:00Z',
  }));
  is(pageOnly.state, 'lease_confirmed', 'a page with no quote still reaches lease_confirmed');
}

// ── E. The floor change is scoped to this one field ─────────────────────────
console.log('\n── E. No other field\'s floor moved ──');
{
  const t = { id: 't3', cap: 5, leased_sqft: 3000, admin_fee_pct: 4,
              fieldEvidence: {}, reviewOverrides: {} };
  for (const k of ['cap', 'leased_sqft', 'admin_fee_pct']) {
    is(FP.fieldProvenance(k, t).state, 'ai_extracted',
       k + ' still floors at ai_extracted — extraction really does supply it');
  }
  is(FP.STATES.length, 5, 'no sixth provenance state was invented');
  is(FP.STATES.includes('manually_entered'), true, 'the floor reuses an existing state');
}

// ── F. Provenance and arithmetic are independent axes ───────────────────────
console.log('\n── F. cap_ceiling describes the MATH, not the trust ──');
{
  // The calculation, run exactly as script.js runs it.
  const MC = require(path.join(R, 'money-cents.js'));
  const ceiling = (base, pct) => MC.fromCents(MC.toCents(parseFloat(base) * (1 + parseFloat(pct) / 100)));

  const t = typedBase('26000');
  const prov = resolve(t);
  const calc = ceiling(t.capBaseAmount, t.cap);

  is(calc, 27300, 'the ceiling computes to $27,300 from a 5% cap on a $26,000 base');
  is(prov.state, 'manually_entered', 'while the base it rests on is manually_entered');
  truthy(prov.state !== 'lease_confirmed', 'the base is NOT lease-confirmed');
  truthy(calc > 0, 'the arithmetic is still produced — an unverified input does not void the math');

  // The point of the whole design: both facts coexist and neither overrides
  // the other. A reader needing trust reads provenance; a reader needing the
  // number reads the calculation; nobody has to infer one from the other.
  const statement = {
    calculation: calc, basis: 'cap_ceiling',
    base: t.capBaseAmount, baseProvenance: prov.state, baseCited: prov.cited,
  };
  is(statement.basis, 'cap_ceiling', 'the basis names the arithmetic');
  is(statement.baseProvenance, 'manually_entered', 'the provenance names the input');
  truthy(statement.basis === 'cap_ceiling' && statement.baseProvenance !== 'lease_confirmed',
         'a correct cap_ceiling coexists with an unverified base — the axes do not collapse');
}

// ── G. isLeaseConfirmed / isHumanBacked agree ───────────────────────────────
console.log('\n── G. The helper predicates agree with the state ──');
{
  const t = typedBase('26000');
  is(FP.isLeaseConfirmed('cap_base_amount', t, { value: t.capBaseAmount }), false,
     'isLeaseConfirmed is false for a typed base');
  is(FP.isHumanBacked('cap_base_amount', t, { value: t.capBaseAmount }), true,
     'isHumanBacked is true — a person is the authority');
  const none = typedBase(null);
  is(FP.isHumanBacked('cap_base_amount', none, { value: none.capBaseAmount }), false,
     'isHumanBacked is false when there is no value at all');
}

// ── H. The assembler actually wires it up ───────────────────────────────────
// Groups A-G exercise the resolver directly. That leaves the wiring in
// PropertyRecord._fields untested — and it is the part that has to know the
// tenant stores `capBaseAmount` while the canonical key is `cap_base_amount`.
// Drop the opts.value route and the resolver reads an absent t.cap_base_amount,
// silently reporting `unknown` for every populated base. Only a test that goes
// through assemble() can see that.
console.log('\n── H. PropertyRecord carries the field, through opts.value ──');
{
  const vm = require('vm'), fs = require('fs');
  const doc = new Proxy(function () {}, { get: () => doc, set: () => true, apply: () => doc });
  const sb = { document: doc, console: { log() {}, warn() {}, error() {} }, Math, Date, JSON,
    Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseFloat, parseInt,
    Set, Map, Promise, setTimeout, module: { exports: {} }, require };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['money-cents.js', 'source-values.js', 'review-engine.js', 'property-reference.js',
                   'field-provenance.js', 'cam-pool.js', 'variance-breakdown.js', 'timeline-merge.js',
                   'selectors.js', 'lease-intelligence.js', 'property-workspace.js',
                   'tenant-space.js', 'property-record.js']) {
    sb.module = { exports: {} };
    vm.runInContext(fs.readFileSync(path.join(R, f), 'utf8'), sb, { filename: f });
  }

  const prop = {
    id: 'p1', name: 'Maple Plaza', camYear: 2026, totalSqft: 18000,
    tenants: [{ id: 'mc1', tenant_name: 'Maple Coffee Co', leased_sqft: 3000,
                cap: '5', capBaseAmount: '26000', fileName: 'maple_plaza_messy_lease.pdf',
                start_date: '2024-03-01', end_date: '2029-02-28', lease_type: 'NNN' }],
    invoices: [], camResults: [], timeline: [], disputes: [], documents: [],
  };
  const rec = sb.window.PropertyRecord.assemble(prop, sb.window);
  const f = rec.fields && rec.fields.mc1;

  truthy(f, 'assemble() produced a fields entry for the tenant');
  truthy(f && 'cap_base_amount' in f, 'record.fields carries cap_base_amount');
  is(f && f.cap_base_amount.state, 'manually_entered',
     'and resolves the STORED capBaseAmount — proving the opts.value route is wired');
  is(f && f.cap_base_amount.cited, false, 'the record reports it as uncited');
  is(f && f.cap_base_amount.sourceFile, null, 'the record attributes no document to it');
  is(f && f.cap.state, 'ai_extracted', 'the cap beside it is unaffected');
  truthy(f && Object.keys(f).length === 13, 'all 13 canonical fields resolve');
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
            `RESULT: ${pass} passed, ${fail} failed` + '\x1b[0m');
process.exit(fail === 0 ? 0 : 1);
