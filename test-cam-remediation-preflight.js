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

// ── I. The manifest, counted from the text a database would act on ─────────
// Groups A and F count the `ids` METADATA the generator attaches to each
// statement. That answers "what does the plan say?" and not "what does the SQL
// say?", and the two can disagree: a statement emitted twice, or an
// illustrative UPDATE pasted into a body, changes the text while leaving the
// metadata untouched. This group counts UUID occurrences in the executable
// string itself, and then proves the check has teeth by tampering with the
// statements and requiring assertSafe to object.
sec('I. Exactly one executable UPDATE per approved row, counted in the SQL');
{
  const m = pf.manifest;
  eq(m.updateStatements, 11, 'I1 eleven UPDATE statements — one for Class N, ten for Class M');
  eq(m.totalIds, 24,         'I2 addressing twenty-four ids in total');
  eq(m.uniqueIds, 24,        'I3 all of them distinct');
  eq(m.duplicateIds.length, 0, 'I4 with no id written twice');
  eq(m.classNIds.length, 14, 'I5 fourteen Class N ids');
  eq(m.classMIds.length, 10, 'I6 ten Class M ids');
  eq(m.heldIds.length, 4,    'I7 four held ids');

  // The manifest must not be able to drift from the statements it describes.
  const fromStmts = pf.statements.filter(s => s.kind === 'update').flatMap(s => s.ids);
  is(m.totalIds === fromStmts.length && m.uniqueIds === new Set(fromStmts).size,
     'I8 and the manifest is derived from those statements, not asserted beside them');
  is(m.classNIds.every(i => !m.classMIds.includes(i))
     && m.classNIds.every(i => !m.heldIds.includes(i))
     && m.classMIds.every(i => !m.heldIds.includes(i)),
     'I9 the three sets are disjoint');
  eq(m.classNIds.length + m.classMIds.length + m.heldIds.length, 28,
     'I10 and together they are all 28 rows');

  // Now the text. Comments are stripped: this is what the database receives.
  const text = P.executableOnly(pf);
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const seen = (text.match(UUID) || []).reduce((a, i) => (a[i] = (a[i] || 0) + 1, a), {});
  eq(Object.keys(seen).length, 24, 'I11 the executable SQL names twenty-four distinct uuids');
  eq((text.match(UUID) || []).length, 24, 'I12 in twenty-four occurrences — none repeated');
  is(Object.entries(seen).every(([, n]) => n === 1),
     'I13 every uuid appears exactly once');
  is([...m.classNIds, ...m.classMIds].every(i => seen[i] === 1),
     'I14 and the twenty-four are exactly the approved rows');

  // The four held rows, named, occurring zero times.
  for (const h of [MAPLE, ...CLASS_O]) {
    eq(seen[h] || 0, 0, 'I15 held uuid absent from executable SQL — ' + h.slice(0, 8));
  }

  // IMPCO specifically: the row an earlier write-up appeared to update twice.
  const IMPCO = m.classMIds.find(i => i.startsWith('360b8a20'));
  is(!!IMPCO, 'I16 IMPCO is in the Class M set');
  eq(seen[IMPCO], 1, 'I17 and occurs exactly once in the executable SQL');
  eq((sql.match(new RegExp(IMPCO, 'g')) || []).length, 1,
     'I18 and once in the full statement text, comments included — no example copy');

  // executableSql is the whole batch, in order, and nothing else.
  is(P.executableSql(pf) === sql,
     'I19 executableSql is the statements and only the statements',
     P.executableSql(pf).length + ' chars, ' + pf.statements.length + ' statements');

  // ── The check has teeth: tamper, and require an objection ────────────────
  const clone = (extra) => ({ ...pf, statements: pf.statements.concat(extra) });
  const impcoStmt = pf.statements.find(s => (s.ids || [])[0] === IMPCO);

  // Matched against the SPECIFIC message. Two of assertSafe's checks can both
  // say "appears 2 times"; a loose match would let either stand in for the
  // other, and a mutation of the repeat check would go unnoticed.
  const dupd = P.assertSafe(clone([{ ...impcoStmt, id: impcoStmt.id + '-COPY' }]));
  is(dupd.some(x => x === 'UUID appears 2 times in executable SQL: ' + IMPCO),
     'I20 a duplicated statement is caught — the exact shape reported in review');

  const held = P.assertSafe(clone([{
    id: 'X-maple', kind: 'update', rowsAffected: 1, ids: [],
    sql: `UPDATE cam_reconciliations SET expected_cam = 1 WHERE id = '${MAPLE}'::uuid;`,
  }]));
  is(held.some(x => /HELD UUID PRESENT/.test(x)),
     'I21 a held row smuggled in without metadata is caught by the text check');

  // The case the metadata check CANNOT see: an illustrative UPDATE pasted into
  // an existing statement's body. ids is untouched, so every count in group F
  // still passes; only the text check notices.
  const pasted = { ...pf, statements: pf.statements.map(s => s.id === 'S1-class-N'
    ? { ...s, sql: s.sql + `\n-- example only:\nUPDATE cam_reconciliations SET expected_cam = 107000 WHERE id = '${IMPCO}'::uuid;` }
    : s) };
  const pastedIds = pasted.statements.filter(s => s.kind === 'update').flatMap(s => s.ids);
  eq(new Set(pastedIds).size, 24, 'I22 pasted example leaves the id metadata clean…');
  is(P.assertSafe(pasted).some(x => x === 'UUID appears 2 times in executable SQL: ' + IMPCO),
     'I23 …and is still caught, because the text is counted separately');
}

// ── J. The manifest and the text check hold on dirty input too ─────────────
// Group I proves the numbers are right on the real snapshot, where nothing is
// duplicated. That is not enough: a manifest that always reports "0 duplicates"
// would pass every assertion in group I and be worthless, because the one time
// it matters is the time something IS duplicated. So this group feeds the
// generator input that does duplicate, and requires the manifest to say so.
sec('J. The counts are counts, not constants');
{
  const IMPCO = pf.manifest.classMIds.find(i => i.startsWith('360b8a20'));
  const impcoRow = SNAP.rows.find(r => r.recon_id === IMPCO);

  // The reported shape, reproduced from the generator's own input: one Class M
  // row appearing twice yields twelve statements and twenty-five ids.
  const dirty = P.preflight(SNAP.rows.concat([impcoRow]));
  eq(dirty.manifest.updateStatements, 12, 'J1 a duplicated row produces a twelfth statement');
  eq(dirty.manifest.totalIds, 25,         'J2 and a twenty-fifth id…');
  eq(dirty.manifest.uniqueIds, 24,        'J3 …over twenty-four distinct rows');
  eq(dirty.manifest.duplicateIds.length, 1, 'J4 which the manifest names as a duplicate');
  is(dirty.manifest.duplicateIds[0] && dirty.manifest.duplicateIds[0].id === IMPCO
     && dirty.manifest.duplicateIds[0].count === 2,
     'J5 by id and by count — ' + IMPCO.slice(0, 8) + ' ×2');
  is(P.assertSafe(dirty).some(x => x === 'UUID appears 2 times in executable SQL: ' + IMPCO),
     'J6 and assertSafe refuses the batch');

  // executableOnly is the write set. The reads carry no uuids today, so
  // including them would be harmless by luck rather than by construction.
  const text = P.executableOnly(pf);
  is(!/\bSELECT\b/i.test(text), 'J7 executableOnly contains no SELECT — it is the writes only');
  is(!/PRE-IMAGE|VERIFY/.test(text), 'J8 and neither the pre-image nor the verification');
  is(/UPDATE cam_reconciliations/.test(text), 'J9 while still containing the UPDATEs');

  // Comments are stripped because a comment is not executed. A note that names
  // a held row is documentation, not a write, and must not raise a violation —
  // otherwise the check would punish the very annotation that keeps the batch
  // readable.
  const annotated = { ...pf, statements: pf.statements.map(s => s.id === 'S1-class-N'
    ? { ...s, sql: '-- excluded from this batch: ' + MAPLE + ' (Maple Coffee, human review)\n' + s.sql }
    : s) };
  eq(P.assertSafe(annotated).length, 0,
     'J10 a comment naming a held uuid raises nothing — comments are not executed');
  is(!P.executableOnly(annotated).includes(MAPLE),
     'J11 because executableOnly removed it before counting');

  // A uuid from outside the audited 28, pasted in. It is not held, it is not
  // approved, and it appears once — so only the distinct-count tally can see it.
  const FOREIGN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const foreign = { ...pf, statements: pf.statements.concat([{
    id: 'X-foreign', kind: 'update', rowsAffected: 1, ids: [],
    sql: `UPDATE cam_reconciliations SET expected_cam = 1 WHERE id = '${FOREIGN}'::uuid;`,
  }]) };
  is(P.assertSafe(foreign).some(x => /names 25 uuids, approved 24/.test(x)),
     'J12 a uuid from outside the 28 is caught by the distinct-count tally');

  // And the mirror case: an approved row whose statement forgets to name it.
  // Only the approved-presence loop can see this one.
  const dropped = { ...pf, statements: pf.statements.map(s => (s.ids || [])[0] === IMPCO
    ? { ...s, sql: s.sql.split(IMPCO).join('00000000-0000-4000-8000-000000000000') }
    : s) };
  is(P.assertSafe(dropped).some(x => x === 'approved UUID appears 0 times in text: ' + IMPCO),
     'J13 an approved row missing from its own SQL is caught');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
