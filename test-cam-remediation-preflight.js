'use strict';
/**
 * test-cam-remediation-preflight.js — S5.1: the statements are safe before anyone runs them.
 *
 *   node test-cam-remediation-preflight.js
 *
 * The preflight generates SQL; this suite is what makes generating it worth
 * more than typing it. Every constraint the remediation was approved under is
 * asserted against the emitted text: which rows are written, which are held,
 * which columns may move, and — above all — that no statement can reach a
 * column a tenant is billed from.
 *
 * Nothing here connects to a database. The preflight has no client, and this
 * file has none either; both operate on the frozen snapshot.
 *
 * WHY THE TWO HOLDS ARE TESTED SEPARATELY
 * ---------------------------------------
 * Class O is held STRUCTURALLY — the classifier proposes no write for a row
 * whose tenant cannot be found, so those three can never appear whatever the
 * preflight does. Maple Coffee is held by JUDGEMENT — the classifier does
 * propose a write, the arithmetic being reproducible, and a person excluded it
 * anyway because the base is absent from the lease, exceeds the property's
 * whole CAM pool, and sits four times above an identically sized neighbour.
 * Collapsing the two into one "skipped" count would hide the only case in the
 * set that demonstrates reproducible is not trustworthy.
 */

const P = require('./tools/cam-remediation-preflight.js');
const C = require('./tools/cam-row-classifier.js');
const SNAP = require('./evidence/2026-09-05-cam-28-row-snapshot.json');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const pf   = P.preflight(SNAP.rows);
const sql  = pf.statements.map(s => s.sql).join('\n\n');
/** SQL comments name the columns and predicates this suite forbids. */
const bare = sql.replace(/^\s*--.*$/gm, '');
const MAPLE = '275d2435-3ac8-4cb5-b4a3-f30bea48e5e9';
const CLASS_O = ['0669ad47-e616-4999-af9f-0b25c9520126',
                 '7b5c9e2c-68b5-4010-974f-0fdeca78fa5e',
                 '455c4ab5-d770-4313-8297-f6b1200dfc9f'];

// ── A. The plan matches the approval ───────────────────────────────────────
sec('A. The plan is 14 + 10, with 4 held');
{
  eq(pf.plan.totalConsidered, 28, 'A1 all 28 affected rows were considered');
  eq(pf.plan.classN, 14, 'A2 fourteen Class N rows null out');
  eq(pf.plan.classM, 10, 'A3 ten Class M rows recompute — eleven minus Maple Coffee');
  eq(pf.plan.held, 4,    'A4 four rows are held');
  eq(pf.plan.heldByKind.class_O_identity, 3, 'A5 three by identity');
  eq(pf.plan.heldByKind.human_review, 1,     'A6 one by human review');
  eq(pf.plan.rowsWritten, 24, 'A7 twenty-four rows would be written');
  eq(pf.plan.classN + pf.plan.classM + pf.plan.held, 28, 'A8 and 24 + 4 accounts for all 28');
  eq(P.assertSafe(pf).length, 0, 'A9 the generator raises no safety violation');
}

// ── B. Maple Coffee is excluded, and for the stated reason ─────────────────
sec('B. Maple Coffee Co is held by judgement, not by arithmetic');
{
  const decided = SNAP.rows.map(C.classify).find(d => d.recon_id === MAPLE);
  eq(decided.class, 'M', 'B1 the classifier still calls it Class M');
  eq(decided.reproducible, true, 'B2 and still finds it reproducible');
  eq(decided.ceiling, 27300, 'B3 with a ceiling of 27,300 — the arithmetic is not in question');
  eq(decided.disposition, 'recompute_disclosed',
     'B4 so the RULE would recompute it; the exclusion is an operator decision on top');

  const held = pf.held.find(h => h.recon_id === MAPLE);
  is(held, 'B5 it appears in the held list');
  eq(held.holdKind, 'human_review', 'B6 marked as human review, not as an identity problem');
  is(/absent from maple_plaza_messy_lease\.pdf/.test(held.holdReason),
     'B7 the reason cites the lease it is absent from');
  is(/exceeds the property CAM pool/.test(held.holdReason), 'B8 and the pool it exceeds');
  is(/4x the base on an identically sized neighbour/.test(held.holdReason),
     'B9 and the neighbour it is four times above');

  is(!sql.includes(MAPLE), 'B10 ITS UUID APPEARS IN NO STATEMENT AT ALL');
  is(!pf.classM.some(d => d.recon_id === MAPLE), 'B11 and it is not in the Class M write set');
  is(!bare.includes('27300') && !bare.includes('27,300'),
     'B12 nor does its ceiling appear as a literal anywhere');
}

// ── C. All three Class O rows are excluded ─────────────────────────────────
sec('C. The three unresolved tenants are excluded structurally');
{
  for (const id of CLASS_O) {
    is(!sql.includes(id), 'C1 ' + id.slice(0, 8) + ' appears in no statement');
    const h = pf.held.find(x => x.recon_id === id);
    is(h && h.holdKind === 'class_O_identity', 'C2   …and is held as an identity problem');
  }
  // Structural, not a list: the classifier proposes nothing for them.
  const decided = SNAP.rows.map(C.classify).filter(d => CLASS_O.includes(d.recon_id));
  eq(decided.length, 3, 'C3 all three classify');
  is(decided.every(d => d.proposed === null),
     'C4 and the CLASSIFIER proposes no write — the exclusion cannot be forgotten');
  is(decided.every(d => d.disposition === 'hold_identity_unresolved'), 'C5 all held');
}

// ── D. No statement can touch a billing amount ─────────────────────────────
sec('D. Billing is unreachable from these statements');
{
  const updates = pf.statements.filter(s => s.kind === 'update');
  eq(updates.length, 11, 'D1 eleven UPDATE statements — one for Class N, ten for Class M');

  for (const s of updates) {
    const body = s.sql.replace(/^\s*--.*$/gm, '');
    const set = (body.match(/SET([\s\S]*?)WHERE/i) || [, ''])[1];
    const cols = [...set.matchAll(/([a-z_]+)\s*=/g)].map(m => m[1]);
    is(cols.every(c => P.WRITABLE.includes(c)),
       'D2 ' + s.id + ' sets only ' + P.WRITABLE.join('/'), cols.join(','));
    for (const b of P.BILLING_COLUMNS) {
      is(!new RegExp('\\b' + b + '\\b').test(set),
         'D3 ' + s.id + ' never sets ' + b);
    }
  }
  // The columns a tenant is billed from, absent from every SET in the batch.
  const allSets = updates.map(s => (s.sql.replace(/^\s*--.*$/gm, '')
    .match(/SET([\s\S]*?)WHERE/i) || [, ''])[1]).join(' ');
  for (const b of P.BILLING_COLUMNS) {
    is(!new RegExp('\\b' + b + '\\b').test(allSets), 'D4 no SET clause anywhere names ' + b);
  }
  is(!/\btenant_id\b\s*=|\bproperty_id\b\s*=|\byear\b\s*=|\breconciled_at\b\s*=/.test(allSets),
     'D5 nor reassigns tenant, property, year or reconciliation time');
}

// ── E. Only UPDATE and SELECT, and only this table ─────────────────────────
sec('E. No row is created or destroyed');
{
  for (const verb of ['INSERT', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE']) {
    is(!new RegExp('\\b' + verb + '\\b', 'i').test(bare), 'E1 no ' + verb);
  }
  const tables = [...bare.matchAll(/\b(?:UPDATE|FROM|JOIN)\s+([a-z_.]+)/gi)].map(m => m[1]);
  is(tables.every(t => t === 'cam_reconciliations'),
     'E2 every statement targets cam_reconciliations only', [...new Set(tables)].join(','));
  is(!/tenant_field_evidence|properties|tenants|lease_documents|tenant_review_audit/.test(bare),
     'E3 and no other table is named — provenance and leases are untouched');
}

// ── F. Rows are addressed by id, never by value ────────────────────────────
sec('F. Addressed by id, so no unseen row can be caught');
{
  const updates = pf.statements.filter(s => s.kind === 'update');
  for (const s of updates) {
    const body = s.sql.replace(/^\s*--.*$/gm, '');
    is(/WHERE\s+id\s*(=|IN)/i.test(body), 'F1 ' + s.id + ' addresses rows by id');
    is(!/WHERE[\s\S]*\b(expected_cam|variance|actual_cam)\b\s*[<>]/i.test(body),
       'F2 ' + s.id + ' has no value predicate');
  }
  // Every id in the batch is one of the 28, and each appears exactly once.
  const ids = updates.flatMap(s => s.ids);
  eq(ids.length, 24, 'F3 twenty-four ids across all statements');
  eq(new Set(ids).size, 24, 'F4 with no duplicates');
  const known = new Set(SNAP.rows.map(r => r.recon_id));
  is(ids.every(i => known.has(i)), 'F5 and every id is one of the 28 audited rows');
}

// ── G. The proposed values are the classifier's, unaltered ─────────────────
sec('G. Values in the SQL match the audited plan');
{
  const byId = Object.fromEntries(SNAP.rows.map(C.classify).map(d => [d.recon_id, d]));
  let wrong = [];
  for (const s of pf.statements.filter(s => s.kind === 'update' && s.ids.length === 1)) {
    const d = byId[s.ids[0]];
    const body = s.sql.replace(/^\s*--.*$/gm, '');
    const m = body.match(/expected_cam\s*=\s*([\d.-]+),\s*\n\s*variance\s*=\s*([\d.-]+)/);
    if (!m) { wrong.push(s.id + ' unparsable'); continue; }
    if (Number(m[1]) !== d.proposed.expected_cam) wrong.push(s.id + ' expected_cam');
    if (Number(m[2]) !== d.proposed.variance)     wrong.push(s.id + ' variance');
    if (!/expected_cam_basis = 'cap_ceiling'/.test(body)) wrong.push(s.id + ' basis');
  }
  eq(wrong.length, 0, 'G1 every Class M statement carries the audited ceiling and variance'
     + (wrong.length ? ' — ' + wrong.join('; ') : ''));

  // Spot-checks anchored to the S5 report, so the two cannot drift apart.
  is(sql.includes("expected_cam       = 24960"), 'G2 FitZone ceiling 24,960 appears');
  is(sql.includes("expected_cam       = 107000"), 'G3 IMPCO ceiling 107,000 appears');
  is(sql.includes("variance           = -104853.8"), 'G4 with its negative variance');
  const nulls = pf.statements.find(s => s.id === 'S1-class-N');
  is(/expected_cam\s*=\s*NULL/.test(nulls.sql) && /variance\s*=\s*NULL/.test(nulls.sql)
     && /expected_cam_basis\s*=\s*NULL/.test(nulls.sql),
     'G5 the Class N statement nulls all three columns');
}

// ── H. The batch is reversible and self-verifying ──────────────────────────
sec('H. A pre-image is captured first and a verification follows');
{
  const first = pf.statements[0], last = pf.statements[pf.statements.length - 1];
  eq(first.kind, 'capture', 'H1 the FIRST statement captures the pre-image');
  is(/SELECT id, expected_cam, variance, expected_cam_basis/.test(first.sql),
     'H2 of exactly the three columns that will move, keyed by id');
  is(!/WHERE/.test(first.sql),
     'H3 across ALL 46 rows — a mistake outside the target set is detectable too');
  eq(last.kind, 'verify', 'H4 the LAST statement verifies the result');
  is(/stamped|null_expected/.test(last.sql), 'H5 counting what the plan predicted');
  is(/sum_actual_cam|sum_allocated/.test(last.sql),
     'H6 and re-summing the billing columns so an accidental write would show');
  is(/predicted: total_rows 46 \| stamped 10 \| null_expected 32/.test(last.sql),
     'H7 with the predictions stated inline: 10 stamped, 32 null (18 already + 14)');
  is(/unstamped_with_value 4/.test(last.sql),
     'H8 and 4 rows left with a value and no basis — exactly the held set');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
