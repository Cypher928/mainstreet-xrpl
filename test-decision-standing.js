'use strict';
/**
 * test-decision-standing.js — P5-3: which term decision STANDS, one rule, two
 * entry points.
 *
 * acquisition_term_decisions is a history. The rule that turns it into "the
 * decision in force for a field" lived in AcquisitionTerms.latestDecision and
 * was moved, verbatim, into decision-standing.js so the Property Workspace can
 * apply it without loading the acquisition resolver. This suite holds both
 * entry points to the same fixtures — Maple plaza's 27 live rows (Pilot,
 * 2026-09-28) reproduced verbatim — so the two cannot drift.
 *
 *   A  the rule on Maple's rows (standing per field, per family)
 *   B  ordering, ties, unknown actions, reopen, reject, garbage
 *   C  PARITY: DecisionStanding.standing ≡ AcquisitionTerms.latestDecision
 *   D  structure: acquisition-terms.js DELEGATES and holds no second copy
 *   E  FIELD_LABELS in property-leaseholds.js ≡ AcquisitionTerms.FIELD_META
 *
 *   node test-decision-standing.js
 *
 * Also exported: MAPLE_DECISIONS (the 27 rows), for the P5-2/P5-3 suites.
 */
const fs = require('fs'), path = require('path');

const P   = '3dc8a7b8-170c-4a51-b90d-dde831c56ca9';
const RV  = '59af3e99-82dc-4a97-813b-21e4f956aca8';
const OWN = '011df998-bad2-464e-bbcb-28e2d0fee821';
const SHOP = '8b175124-98c2-46be-a44c-34d622378e44', LUXE = 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17';
const AMEND = 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf', LEASE = '3fc9463f-230e-424c-8bba-7dfacafd6a98';
const Q_CAP  = "the Tenant's controllable Common Area Maintenance expense increases shall not exceed   3% per year . Uncontrollable expenses remain outside this cap.";
const Q_AUD  = 'Tenant may, upon reasonable written notice, inspect the records supporting Common Area Maintenance charges for the preceding two calendar years. The inspection shall occur during normal business hours.';
const Q_RENT = 'the annual base rent for the Premises shall be   $19.25 per rentable square foot , payable in equal monthly installments. For purposes of this amendment, the Premises contain 65,000 rentable square feet.';
const Q_SQFT = 'For purposes of this amendment, the Premises contain 65,000 rentable square feet.';
const ENTERED = 'Entered by a person. No document on file supports it.';

// A row exactly as the Supabase client returns it (timestamptz as ISO).
const row = (id, fam, field, action, prev, next, src, quote, page, at, note, created) => ({
  id, review_id: RV, property_id: P, family_id: fam, field_key: field, action,
  previous_value: prev, new_value: next, source_document_id: src, source_quote: quote, source_page: page,
  decided_by: OWN, decided_at: at, note: note || null, created_at: created || at,
});

/** Maple plaza's 27 decisions, in decided_at order. */
const MAPLE_DECISIONS = [
  row('b96090a0-84f5-4df0-99ca-0459b13aff6a', SHOP, 'cap',              'confirm', '3',       null,     AMEND, Q_CAP,  1,    '2026-09-22T15:18:26.132+00:00', null, '2026-09-22T15:18:26.437354+00:00'),
  row('7c38a344-5ad8-453b-b055-645b0fef5b05', SHOP, 'cap',              'confirm', '3',       null,     AMEND, Q_CAP,  1,    '2026-09-22T15:24:59.675+00:00', null, '2026-09-22T15:24:59.908599+00:00'),
  row('c33e1a4c-a174-4377-a87a-613b4cc53e36', SHOP, 'audit_rights',     'confirm', 'true',    null,     AMEND, Q_AUD,  1,    '2026-09-22T15:25:14.317+00:00', null, '2026-09-22T15:25:14.496901+00:00'),
  row('02cf28c9-45a7-48f4-aa87-320da8d9abd7', SHOP, 'audit_rights',     'reopen',  'true',    null,     null,  null,   null, '2026-09-22T15:26:00.512+00:00', null, '2026-09-22T15:26:00.898821+00:00'),
  row('fd40c42d-1596-4833-becc-8985be1157b4', SHOP, 'audit_rights',     'reject',  'true',    null,     null,  null,   null, '2026-09-22T15:26:41.991+00:00', null, '2026-09-22T15:26:42.23947+00:00'),
  row('49b94472-a9db-45a6-85c3-cc0bf6eca1ac', SHOP, 'suite',            'correct', 'Anchor Unit A-1', 'Anchor Unit A-3', LEASE, null, null, '2026-09-22T16:35:59.898+00:00', null, '2026-09-22T16:36:00.357927+00:00'),
  row('2ea3fbbd-d523-4783-8f79-e189779d0d31', SHOP, 'suite',            'reopen',  'Anchor Unit A-3', null, null, null, null, '2026-09-22T20:13:13.954+00:00', null, '2026-09-22T20:13:14.059268+00:00'),
  row('a035de3e-ab40-47cf-8cb0-1e0955d55283', SHOP, 'suite',            'confirm', 'Anchor Unit A-1', null, LEASE, 'Premises:   Maple Plaza, Anchor Unit A-1', 1, '2026-09-22T20:13:17.79+00:00', null, '2026-09-22T20:13:17.843699+00:00'),
  row('e0e3f2fa-97e4-47aa-8c6d-ad7ec2af8fb0', SHOP, 'base_rent',        'confirm', '1251250', null,     AMEND, Q_RENT, 1,    '2026-09-23T03:51:16.713+00:00', null, '2026-09-23T03:51:16.891408+00:00'),
  row('8da2182e-383d-4db7-a4d7-eb4cc28c1acf', SHOP, 'leased_sqft',      'correct', '65000',   '67000',  AMEND, null,   null, '2026-09-23T03:53:25.327+00:00', null, '2026-09-23T03:53:25.502837+00:00'),
  row('c82cb927-d751-4e4a-8487-7bb593b5fc95', SHOP, 'leased_sqft',      'confirm', '67000',   null,     AMEND, Q_SQFT, null, '2026-09-23T03:53:28.212+00:00', null, '2026-09-23T03:53:28.381558+00:00'),
  row('ec929724-7c05-4696-9efe-4629fe1c77f9', SHOP, 'leased_sqft',      'correct', '65000',   '67000',  AMEND, null,   null, '2026-09-23T03:53:39.229+00:00', null, '2026-09-23T03:53:39.348122+00:00'),
  row('ea0e474b-dc9c-4618-a8cb-b1cef7704acc', SHOP, 'leased_sqft',      'confirm', '67000',   null,     AMEND, Q_SQFT, null, '2026-09-24T01:08:24.193+00:00', null, '2026-09-24T01:08:27.350723+00:00'),
  row('ac238fde-49f7-4f26-a255-6b65339161ca', SHOP, 'leased_sqft',      'confirm', '65000',   null,     AMEND, Q_SQFT, 1,    '2026-09-24T01:08:34.013+00:00', null, '2026-09-24T01:08:37.087484+00:00'),
  row('52276b37-1d58-4a19-a8b5-36b9e5d0dc44', SHOP, 'leased_sqft',      'correct', '65000',   '67000',  AMEND, null,   null, '2026-09-24T01:55:34.691+00:00', null, '2026-09-24T01:55:34.784086+00:00'),
  row('25454485-4a58-4da9-b8f2-95c24a3f3ddf', SHOP, 'leased_sqft',      'confirm', '67000',   null,     AMEND, Q_SQFT, null, '2026-09-24T01:55:37.821+00:00', null, '2026-09-24T01:55:37.851944+00:00'),
  row('e4330712-239d-4948-8f3b-14da47aebce2', SHOP, 'leased_sqft',      'correct', '65000',   '67,000', AMEND, null,   null, '2026-09-24T02:16:21.119+00:00', null, '2026-09-24T02:16:21.21683+00:00'),
  row('167a2389-82ab-4641-ac78-ec4b6c161aa6', SHOP, 'leased_sqft',      'confirm', '67000',   null,     AMEND, Q_SQFT, null, '2026-09-24T02:16:35.047+00:00', null, '2026-09-24T02:16:35.163332+00:00'),
  row('7e67ae1b-fc28-4763-93b9-2b731520898c', SHOP, 'leased_sqft',      'correct', '65000',   '67000',  AMEND, null,   null, '2026-09-24T02:16:47.705+00:00', null, '2026-09-24T02:16:47.677116+00:00'),
  row('20634614-a1dd-48fb-8dd7-6ca947ba6116', SHOP, 'security_deposit', 'correct', null,      '50,000', null,  null,   null, '2026-09-24T12:42:35.855+00:00', ENTERED, '2026-09-24T12:42:36.004639+00:00'),
  row('9eff8b5a-c2e7-4a2d-a3d0-314507dc0de7', SHOP, 'security_deposit', 'reopen',  '50000',   null,     null,  null,   null, '2026-09-24T12:44:12.391+00:00', null, '2026-09-24T12:44:12.54699+00:00'),
  row('6f0672ba-e92a-4915-a537-6fd63bd76318', SHOP, 'leased_sqft',      'correct', '67000',   '65000',  AMEND, null,   null, '2026-09-25T23:15:46.737+00:00', null, '2026-09-25T23:15:46.836488+00:00'),
  row('5cfb3c00-fa6e-49ad-9d54-f1d793bbd654', SHOP, 'admin_fee_pct',    'correct', null,      '10',     null,  null,   null, '2026-09-25T23:19:59.325+00:00', ENTERED, '2026-09-25T23:19:59.399064+00:00'),
  row('402488ee-bc96-4742-aa6d-eb1ee03fce9a', LUXE, 'end_date',         'correct', null,      '2030-07-07', null, null, null, '2026-09-25T23:24:46.049+00:00', ENTERED, '2026-09-25T23:24:46.221525+00:00'),
  row('5ef4e01e-02ff-498a-b354-515b9891f4ca', LUXE, 'end_date',         'reopen',  '2030-07-07', null,  null,  null,   null, '2026-09-25T23:28:42.313+00:00', null, '2026-09-25T23:28:42.394087+00:00'),
  row('d045e5e7-58a2-4561-9bce-26aaa6fd54ed', LUXE, 'end_date',         'correct', null,      '2031-07-07', null, null, null, '2026-09-25T23:29:00.42+00:00',  ENTERED, '2026-09-25T23:29:00.475039+00:00'),
  row('ac6c910d-0cd8-40b4-9587-955cb4f215ec', SHOP, 'leased_sqft',      'correct', '65000',   '67000',  AMEND, null,   null, '2026-09-26T16:51:27.322+00:00', null, '2026-09-26T16:51:29.555112+00:00'),
];
const SHOP_ROWS = MAPLE_DECISIONS.filter(r => r.family_id === SHOP);
const LUXE_ROWS = MAPLE_DECISIONS.filter(r => r.family_id === LUXE);

module.exports = { MAPLE_DECISIONS, SHOP, LUXE, AMEND, LEASE, OWN, P, RV, ENTERED };
if (require.main !== module) return;

const DS = require('./decision-standing.js');
const AT = require('./acquisition-terms.js');
const PL = require('./property-leaseholds.js');

let pass = 0, fail = 0; const failures = [];
function t(name, cond, detail) { if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); } else { fail++; failures.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); } }
function eq(a, b, name) { const ok = JSON.stringify(a) === JSON.stringify(b); t(name, ok, ok ? '' : `expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }
function sec(s) { console.log(`\n── ${s} ──`); }
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); Object.keys(o).forEach(k => deepFreeze(o[k])); } return o; };
deepFreeze(MAPLE_DECISIONS);
// A deterministic shuffle (so a failure reproduces).
function shuffled(arr) { const a = arr.slice(); let s = 2027; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ── A  the rule on Maple's rows ─────────────────────────────────────────────
sec('A  Maple\'s 27 decisions: what stands per field');
eq([MAPLE_DECISIONS.length, SHOP_ROWS.length, LUXE_ROWS.length], [27, 24, 3], 'A1 27 rows: 24 ShopRite, 3 Luxe (the live split)');
eq(MAPLE_DECISIONS.reduce((m, r) => (m[r.action] = (m[r.action] || 0) + 1, m), {}), { confirm: 10, reopen: 4, reject: 1, correct: 12 }, 'A2 actions: 12 correct, 10 confirm, 4 reopen, 1 reject');
const std = (rows, f) => DS.standing(rows, f);
eq(std(SHOP_ROWS, 'leased_sqft').id, 'ac6c910d-0cd8-40b4-9587-955cb4f215ec', 'A3 ShopRite leased_sqft: the 09-26 correction 65000 → 67000 stands (twelve rows, the last one wins)');
eq([std(SHOP_ROWS, 'cap').id, std(SHOP_ROWS, 'cap').previous_value, std(SHOP_ROWS, 'cap').source_page], ['7c38a344-5ad8-453b-b055-645b0fef5b05', '3', 1], 'A4 cap: the second confirm of "3" stands, the amendment p.1 cited');
eq(std(SHOP_ROWS, 'audit_rights').action, 'reject', 'A5 audit_rights: confirm → reopen → REJECT — the rejection stands (it is a decision, not an absence)');
eq([std(SHOP_ROWS, 'suite').action, std(SHOP_ROWS, 'suite').previous_value], ['confirm', 'Anchor Unit A-1'], 'A6 suite: correct → reopen → confirm "Anchor Unit A-1" stands');
eq(std(SHOP_ROWS, 'base_rent').previous_value, '1251250', 'A7 base_rent: one confirm, 1251250');
eq(std(SHOP_ROWS, 'security_deposit'), null, 'A8 security_deposit: correct → REOPEN — nothing stands (null), even though a value was once entered');
eq([std(SHOP_ROWS, 'admin_fee_pct').action, std(SHOP_ROWS, 'admin_fee_pct').new_value, std(SHOP_ROWS, 'admin_fee_pct').source_document_id], ['correct', '10', null], 'A9 admin_fee_pct: an entered correction (no source document) stands');
eq(std(LUXE_ROWS, 'end_date').new_value, '2031-07-07', 'A10 Luxe end_date: correct → reopen → correct 2031-07-07 stands');
eq(std(SHOP_ROWS, 'end_date'), null, 'A11 a field nobody decided (ShopRite end_date) → null');
eq(std(SHOP_ROWS, 'leased_sqft').new_value, '67000', 'A12 the standing value is the row\'s, untouched: "67000" (the 09-24 row that said "67,000" is history)');
const byShop = DS.standingByField(SHOP_ROWS);
eq(Object.keys(byShop), ['cap', 'audit_rights', 'suite', 'base_rent', 'leased_sqft', 'security_deposit', 'admin_fee_pct'], 'A13 standingByField: the seven fields ShopRite decided about, in order of first appearance');
eq(Object.keys(byShop).map(k => byShop[k] && byShop[k].action), ['confirm', 'reject', 'confirm', 'confirm', 'correct', null, 'correct'], 'A14 …and what stands for each: confirm, reject, confirm, confirm, correct, OPEN (null), correct');
eq(Object.keys(DS.standingByField(LUXE_ROWS)), ['end_date'], 'A15 Luxe: one field');
eq(Object.keys(DS.standingByField(MAPLE_DECISIONS)).length, 8, 'A16 handed BOTH families at once the rule keys by field only (ShopRite\'s seven + Luxe\'s end_date = 8) — which is why property-leaseholds.js groups by leasehold FIRST and passes one family\'s rows');

// ── B  ordering, ties, unknown actions ──────────────────────────────────────
sec('B  ordering, ties, unknown actions, reopen, reject, garbage');
eq(std(shuffled(SHOP_ROWS), 'leased_sqft').id, 'ac6c910d-0cd8-40b4-9587-955cb4f215ec', 'B1 shuffled input, same answer: order is by decided_at, not arrival');
eq(DS.standingByField(shuffled(MAPLE_DECISIONS)).leased_sqft.id, 'ac6c910d-0cd8-40b4-9587-955cb4f215ec', 'B2 standingByField over shuffled input, same answer');
const laterReopen = SHOP_ROWS.concat([row('x-reopen', SHOP, 'leased_sqft', 'reopen', '67000', null, null, null, null, '2026-09-27T00:00:00.000+00:00')]);
eq(std(laterReopen, 'leased_sqft'), null, 'B3 a LATER reopen empties the field: nothing stands');
eq(DS.standingByField(laterReopen).leased_sqft, null, 'B3b …and standingByField lists the field with null (decided about, nothing standing)');
const laterReject = SHOP_ROWS.concat([row('x-reject', SHOP, 'leased_sqft', 'reject', '67000', null, null, null, null, '2026-09-27T00:00:00.000+00:00')]);
eq(std(laterReject, 'leased_sqft').action, 'reject', 'B4 a later reject stands as a rejection (not null, not verified)');
const unknown = SHOP_ROWS.concat([row('x-unknown', SHOP, 'leased_sqft', 'approve', '1', '1', null, null, null, '2026-09-27T00:00:00.000+00:00')]);
eq(std(unknown, 'leased_sqft').id, 'ac6c910d-0cd8-40b4-9587-955cb4f215ec', 'B5 an unknown action ("approve") is ignored, even when it is the latest');
t('B6 …and standingByField does not list a field that only an unknown action touched', !('bogus' in DS.standingByField(SHOP_ROWS.concat([row('x-u2', SHOP, 'bogus', 'approve', null, null, null, null, null, '2026-09-27T00:00:00.000+00:00')]))));
const tieA = row('tie-a', SHOP, 'cap', 'confirm', '3', null, null, null, null, '2026-09-30T00:00:00.000+00:00');
const tieB = row('tie-b', SHOP, 'cap', 'correct', '3', '4', null, null, null, '2026-09-30T00:00:00.000+00:00');
eq([std([tieA, tieB], 'cap').id, std([tieB, tieA], 'cap').id], ['tie-b', 'tie-a'], 'B7 an exact decided_at tie keeps arrival order (stable sort): the later-arriving row wins');
eq([std(null, 'cap'), std(undefined, 'cap'), std('rows', 'cap'), std([null, undefined, 7, {}], 'cap'), std([], 'cap')], [null, null, null, null, null], 'B8 garbage in → null, no throw');
t('B9 the input is never mutated (a sort happens on a copy)', MAPLE_DECISIONS[0].id === 'b96090a0-84f5-4df0-99ca-0459b13aff6a' && Object.isFrozen(MAPLE_DECISIONS[0]) && (() => { const a = shuffled(SHOP_ROWS); const before = a.map(r => r.id).join(); DS.standing(a, 'leased_sqft'); return a.map(r => r.id).join() === before; })());
eq(std([row('m1', SHOP, 'cap', 'confirm', '3', null, null, null, null, null), row('m2', SHOP, 'cap', 'correct', '3', '5', null, null, null, '2026-01-01T00:00:00Z')], 'cap').id, 'm2', 'B10 a row with no decided_at sorts first (as the empty string), as before');
eq(DS.DECISION_ACTIONS, ['confirm', 'correct', 'reject', 'reopen'], 'B11 the four known actions, in the order the app has always listed them');
// decided_at is the person's moment; created_at is the row's. They can disagree
// (a slow insert, a clock), and on Maple they never do — so this case is made.
const lateInsert = [
  row('li-1', SHOP, 'cap', 'correct', '3', '4', null, null, null, '2026-10-01T10:00:00.000+00:00', null, '2026-10-01T10:00:05.000+00:00'),
  row('li-2', SHOP, 'cap', 'confirm', '3', null, null, null, null, '2026-10-01T09:59:00.000+00:00', null, '2026-10-01T10:00:09.000+00:00'),
];
eq([std(lateInsert, 'cap').id, std(lateInsert.slice().reverse(), 'cap').id], ['li-1', 'li-1'], 'B13 the order is decided_at, NOT created_at: the later-decided row stands even though it was inserted first');
t('B12 DECISION_ACTIONS is the SAME array the resolver exports (one vocabulary, not a copy)', AT.DECISION_ACTIONS === DS.DECISION_ACTIONS);

// ── C  PARITY with AcquisitionTerms.latestDecision ──────────────────────────
sec('C  parity: DecisionStanding.standing ≡ AcquisitionTerms.latestDecision');
const FIELDS = Object.keys(AT.FIELD_META);
let parityChecks = 0, parityBad = [];
function parity(rows, label) {
  for (const f of FIELDS) {
    const a = DS.standing(rows, f), b = AT.latestDecision(rows, f);
    parityChecks++;
    if (JSON.stringify(a) !== JSON.stringify(b) || (a === null) !== (b === null)) parityBad.push(label + '/' + f);
  }
}
[['ShopRite', SHOP_ROWS], ['Luxe', LUXE_ROWS], ['both', MAPLE_DECISIONS], ['shuffled ShopRite', shuffled(SHOP_ROWS)], ['shuffled both', shuffled(MAPLE_DECISIONS)],
 ['later reopen', laterReopen], ['later reject', laterReject], ['unknown action', unknown], ['tie a,b', [tieA, tieB]], ['tie b,a', [tieB, tieA]], ['late insert', lateInsert], ['empty', []], ['garbage', [null, {}, 7]]]
  .forEach(([label, rows]) => parity(rows, label));
eq(parityBad, [], `C1 every field × every fixture agrees (${parityChecks} comparisons, all 27 FIELD_META keys)`);
t('C2 the comparison was not vacuous: standing decisions were found on both sides', FIELDS.some(f => DS.standing(SHOP_ROWS, f) !== null) && FIELDS.some(f => AT.latestDecision(SHOP_ROWS, f) !== null));
t('C3 the two return the SAME object (delegation, not a re-computation that happens to agree)', AT.latestDecision(SHOP_ROWS, 'leased_sqft') === DS.standing(SHOP_ROWS, 'leased_sqft') && AT.latestDecision(SHOP_ROWS, 'leased_sqft') === SHOP_ROWS[SHOP_ROWS.length - 1]);

// ── D  structure ────────────────────────────────────────────────────────────
sec('D  structure: acquisition-terms.js delegates; decision-standing.js is pure and alone');
const ATS = fs.readFileSync(path.join(__dirname, 'acquisition-terms.js'), 'utf8');
const DSS = fs.readFileSync(path.join(__dirname, 'decision-standing.js'), 'utf8');
const PLS = fs.readFileSync(path.join(__dirname, 'property-leaseholds.js'), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
t('D1 latestDecision is a one-line delegation to _DS.standing', /function latestDecision\(decisions, field\) \{\n    return _DS\.standing\(decisions, field\);\n  \}/.test(ATS));
t('D2 acquisition-terms.js holds NO second copy of the rule (no decided_at sort, no reopen ⇒ null)', !/rows\.sort\(function \(a, b\)/.test(strip(ATS)) && !/'reopen' \? null/.test(strip(ATS)));
t('D3 DECISION_ACTIONS in acquisition-terms.js comes from the shared module, not a literal', /var DECISION_ACTIONS = _DS\.DECISION_ACTIONS;/.test(ATS) && !/var DECISION_ACTIONS = \['confirm'/.test(ATS));
t('D4 acquisition-terms.js dual-resolves it (window first, require on a server) and refuses to run without it', /root\.DecisionStanding\)\s*\|\|\s*\(typeof require === 'function' \? require\('\.\/decision-standing\.js'\)/.test(ATS) && /needs decision-standing\.js loaded first/.test(ATS));
t('D5 the moved body is verbatim: filter on field_key + known action, sort by String(decided_at), last row, reopen ⇒ null',
  /return r && r\.field_key === field && DECISION_ACTIONS\.indexOf\(r\.action\) >= 0;/.test(DSS)
  && /var x = String\(a\.decided_at \|\| ''\), y = String\(b\.decided_at \|\| ''\);/.test(DSS)
  && /return x < y \? -1 : x > y \? 1 : 0;/.test(DSS)
  && /var last = rows\[rows\.length - 1\];/.test(DSS)
  && /return last\.action === 'reopen' \? null : last;/.test(DSS));
t('D6 decision-standing.js is dependency-free: no require, no window read, no storage, no DOM, no network', !/require\(|window\.|localStorage|sessionStorage|document\.|fetch\(|supabase/i.test(strip(DSS).replace(/typeof window !== 'undefined' \? window : null/, '')));
eq(Object.keys(DS).sort(), ['DECISION_ACTIONS', 'standing', 'standingByField'], 'D7 the module exports exactly the three names');
t('D8 property-leaseholds.js uses the shared rule (standingByField) and does NOT require acquisition-terms.js or lease-intelligence.js', /_DS\.standingByField\(/.test(PLS) && /require\('\.\/decision-standing\.js'\)/.test(PLS) && !/acquisition-terms|lease-intelligence|AcquisitionTerms/.test(strip(PLS)));
t('D9 index.html loads decision-standing.js before acquisition-terms.js and before property-leaseholds.js', (() => { const H = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); const d = H.indexOf('<script src="decision-standing.js">'), a = H.indexOf('<script src="acquisition-terms.js">'), p = H.indexOf('<script src="property-leaseholds.js">'); return d > 0 && d < a && d < p; })());
t('D10 the public API is intact: AcquisitionTerms still exports latestDecision and DECISION_ACTIONS', typeof AT.latestDecision === 'function' && Array.isArray(AT.DECISION_ACTIONS) && AT.DECISION_ACTIONS.length === 4);

// ── E  FIELD_LABELS parity ─────────────────────────────────────────────────
sec('E  FIELD_LABELS (property-leaseholds.js) ≡ FIELD_META labels (acquisition-terms.js)');
const metaLabels = {}; FIELDS.forEach(f => { metaLabels[f] = AT.FIELD_META[f].label; });
eq(PL.FIELD_LABELS, metaLabels, 'E1 the 27 labels are identical, key for key');
eq(Object.keys(PL.FIELD_LABELS).length, 32, 'E2 thirty-two');
const metaNumeric = FIELDS.filter(f => /^(number|money|percent)$/.test(AT.FIELD_META[f].type)).sort();
eq(Object.keys(PL.NUMERIC_FIELDS).sort(), metaNumeric, 'E3 the fields compared as quantities are exactly FIELD_META\'s number/money/percent fields');
eq([PL.fieldLabel('leased_sqft'), PL.fieldLabel('nope'), PL.fieldLabel(null)], ['Leased sq ft', 'nope', ''], 'E4 fieldLabel: the label, else the key, else ""');

console.log(`\n${'─'.repeat(58)}\nRESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
