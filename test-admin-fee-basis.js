'use strict';
/**
 * test-admin-fee-basis.js — a management-fee cap's BASE, and who said so.
 *
 *   node test-admin-fee-basis.js
 *
 * WHY THIS EXISTS
 *
 * D2-1 made the fee-cap check able to fire and made it divide by the CAM pool.
 * That is a sound computational basis and it is NOT a claim about any lease.
 * "Administrative fee shall not exceed 15%" is not a testable statement until
 * you know 15% of WHAT: the same $20,000 against a $100,000 pool is 20.0%, and
 * 25.0% against a base that excludes the fee from itself. Three lease
 * formulations, three answers, one set of dollars.
 *
 * So the base is captured as its own field with its own provenance, exactly as
 * partial_period_basis is, and this suite pins the distinction that makes a
 * future billing gate safe: `stated` is true only when a lease or a person said
 * so. A product assumption can never reach it.
 *
 * WHAT IT DOES NOT DO. It asserts nothing about billing. D2-2 — a cap breach
 * holding a tenant statement — is deliberately not implemented, and
 * test-e2e-mgmt-fee-cap.js still asserts that a breach changes no allocation,
 * no audit finding and no billing verdict.
 */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const LP     = require('./lease-period.js');
const { fnSource } = require('./test-support/fn-source');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(42) + ':', typeof v === 'string' ? v : JSON.stringify(v));
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
// Comments quote removed code and removed fields all the time in this codebase;
// a source assertion that matches a comment is a green test about nothing.
const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

console.log('\n══ A management-fee cap has a base, and the base has a source ══');

// ── 1. The vocabulary ───────────────────────────────────────────────────────
H('The vocabulary is the one the contract promises');
R('FEE_BASES', LP.FEE_BASES);
yes('four values, in the agreed vocabulary',
    JSON.stringify(LP.FEE_BASES) === JSON.stringify(
      ['operating_expenses', 'controllable_expenses', 'excluding_management_fee', 'unstated']),
    JSON.stringify(LP.FEE_BASES));
yes('the default is "unstated" — never a real base',
    LP.DEFAULT_FEE_BASIS === 'unstated', String(LP.DEFAULT_FEE_BASIS));

// ── 2. lease / manual / default / unrecognised ──────────────────────────────
H('Where the answer came from is part of the answer');
const B = (t) => LP.adminFeeBasis(t);
const manual = (v) => ({ fieldEvidence: { admin_fee_basis: { snapshots: [
  { value: v, manuallyEdited: false }, { value: v, manuallyEdited: true },
] } } });

let r = B({ admin_fee_basis: 'controllable_expenses' });
R('lease-stated', r);
yes('a lease value reads source "lease" and stated true',
    r.source === 'lease' && r.stated === true && r.value === 'controllable_expenses', JSON.stringify(r));

r = B({ admin_fee_basis: 'operating_expenses', ...manual('operating_expenses') });
R('manually confirmed', r);
yes('a manual confirmation reads source "manual", never "lease"',
    r.source === 'manual' && r.stated === true, JSON.stringify(r));

r = B({});
R('no basis captured', r);
yes('an absent basis is source "default" and NOT stated',
    r.source === 'default' && r.stated === false && r.value === 'unstated', JSON.stringify(r));

r = B({ admin_fee_basis: 'per_square_foot' });
R('outside the vocabulary', r);
yes('an unrecognised basis says so — it is a data problem, not a default',
    r.source === 'unrecognised' && r.stated === false, JSON.stringify(r));

// ── 3. 'unstated' is a real extracted answer, distinct from absence ─────────
H('"the clause is silent" and "nobody looked" are different facts');
const silent  = B({ admin_fee_basis: 'unstated' });
const nobody  = B({});
R('lease read, clause silent', silent);
R('never extracted', nobody);
yes('both are NOT stated — neither can support a billing gate',
    silent.stated === false && nobody.stated === false, JSON.stringify([silent, nobody]));
yes('    but their sources differ: "lease" vs "default"',
    silent.source === 'lease' && nobody.source === 'default',
    JSON.stringify([silent.source, nobody.source]));

// ── 4. The evidence row is the record that survives ─────────────────────────
H('The field can be lost; the manual snapshot cannot');
// savePropertyData strips fieldEvidence from the blob and the field rides the
// blob, so the two come apart. partialPeriodBasis learned this the hard way —
// the value came back null while the manual snapshot came back intact, and the
// tenant was held for a confirmation already given.
r = B(manual('excluding_management_fee'));
R('field empty, manual snapshot intact', r);
yes('the answer is read back off the evidence',
    r.value === 'excluding_management_fee' && r.source === 'manual' && r.stated === true,
    JSON.stringify(r));
yes('    and it never becomes a lease citation',
    r.source !== 'lease', r.source);

// ── 5. Latest snapshot wins ────────────────────────────────────────────────
H('Re-extraction and correction: the latest manual answer wins');
r = B({ fieldEvidence: { admin_fee_basis: { snapshots: [
  { value: 'operating_expenses',       manuallyEdited: true },
  { value: 'controllable_expenses',    manuallyEdited: true },
] } } });
R('two manual snapshots', r);
yes('the most recent one is used, not the first',
    r.value === 'controllable_expenses', JSON.stringify(r));
r = B({ admin_fee_basis: 'operating_expenses', fieldEvidence: { admin_fee_basis: { snapshots: [
  { value: 'controllable_expenses', manuallyEdited: false },
] } } });
yes('an extracted-only snapshot does not make a value "manual"',
    r.source === 'lease', JSON.stringify(r));

// ── 6. The contracts ask for it ────────────────────────────────────────────
H('Both extraction contracts request the basis and its clause');
const TASKS = fs.readFileSync(path.join(__dirname, 'api', '_claude-tasks.js'), 'utf8');
yes('the client contract declares admin_fee_basis with the vocabulary',
    /"admin_fee_basis":\s*"operating_expenses"\s*\|\s*"controllable_expenses"\s*\|\s*"excluding_management_fee"\s*\|\s*"unstated"\s*\|\s*null/.test(CODE),
    'not found in script.js');
yes('the server contract declares it too',
    /"admin_fee_basis":\s*"operating_expenses"/.test(TASKS), 'not found in api/_claude-tasks.js');
yes('both ask for the verbatim clause behind it',
    /"admin_fee_basis":\s*string\s*\|\s*null/.test(TASKS) &&
    /"admin_fee_basis":\s*string\|null/.test(CODE),
    'quotes channel missing');
yes('the instruction refuses to guess a base',
    /A percentage with no stated base is "unstated", NOT a guess at one/.test(SCRIPT) &&
    /Never guess a base/.test(TASKS),
    'the "do not guess" instruction is missing');

// ── 7. The normalizer routes both the field and the quote ──────────────────
H('normalizeTenant carries the field, and the quote map carries the clause');
// TWO normalisers, and the field has to be in both. callClaudeForLease
// normalises what extraction returned; normalizeTenant is an explicit
// ALLOW-LIST applied on load, and a field it does not name is dropped on the
// next load — which would make a lease-stated basis come back reading
// source:'default', the exact failure this field exists to prevent. The first
// draft of this change missed the second one and this assertion caught it.
const EXTRACT = fnSource(SCRIPT, 'callClaudeForLease');
// M1a: the load-path normaliser moved to tenant-normalize.js. Same allow-list,
// same reason for checking it — a field it does not name is dropped on reload.
const LOADED  = require('fs').readFileSync(
  require('path').join(__dirname, 'tenant-normalize.js'), 'utf8');
yes('the extraction normaliser carries admin_fee_basis',
    /admin_fee_basis:\s*\(\(\)\s*=>/.test(EXTRACT), 'field not normalised at extraction');
yes('THE LOAD-PATH ALLOW-LIST carries it too — or it is dropped on reload',
    /admin_fee_basis:\s*\(\(\)\s*=>/.test(LOADED), 'normalizeTenant would drop the field');
yes('    both lower-case and trim, empty becoming null',
    /raw\.admin_fee_basis\s*\?\?\s*raw\.adminFeeBasis/.test(EXTRACT)
      && /d\.admin_fee_basis\s*\?\?\s*d\.adminFeeBasis/.test(LOADED),
    'normalisation shape changed');
// Scoped to the normalising expression, not the whole function:
// callClaudeForLease also contains the extraction PROMPT, which names the
// vocabulary for the model and must. What matters is that the code storing the
// value does not judge it — an unknown string is stored as written so the
// resolver can report `unrecognised` instead of a normaliser silently picking.
const _basisExpr = (src) => {
  const i = src.indexOf('admin_fee_basis:');
  return i < 0 ? '' : src.slice(i, i + 260);
};
yes('    and neither coerces an unknown value into the vocabulary',
    !/operating_expenses/.test(_basisExpr(EXTRACT)) && !/operating_expenses/.test(_basisExpr(LOADED)),
    'a normaliser is interpreting the value — that belongs to the resolver');
yes('_quoteMap routes admin_fee_basis to an evidence snapshot',
    /admin_fee_basis:\s*'admin_fee_basis'/.test(EXTRACT), '_quoteMap entry missing');
yes('_stripBlobs spreads the tenant, so the field survives the save boundary',
    /tenants:\s*property\.tenants\.map\(t\s*=>\s*t\s*\?\s*\{\s*\n?\s*\.\.\.t/.test(fnSource(SCRIPT, '_stripBlobs')),
    '_stripBlobs no longer spreads — admin_fee_basis must be added explicitly');

// ── 8. Manual confirmation is reachable through the existing editor ────────
H('The basis is editable through the path that already writes evidence');
yes('admin_fee_basis is in the confirmable field set',
    (CODE.match(/'admin_fee_pct',\s*'admin_fee_basis'/g) || []).length >= 2,
    'not added to both field lists');
yes('it has a label, so the editor can render it',
    /admin_fee_basis:\s*'Admin Fee Basis'/.test(CODE), 'FIELD_LABELS entry missing');

// ── 9. Nothing reinterprets the percentage ────────────────────────────────
H('admin_fee_pct is untouched');
yes('the percentage is still parsed exactly as before',
    /admin_fee_pct:\s*_pf\(raw\.admin_fee_pct\)/.test(CODE),
    'admin_fee_pct parsing changed — it must not');
yes('no basis is inferred from the percentage anywhere',
    !/admin_fee_pct[\s\S]{0,200}?admin_fee_basis\s*=/.test(CODE),
    'something derives a basis from the percentage');

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
