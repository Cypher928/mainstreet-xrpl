'use strict';
/**
 * test-cam-row-classification.js — S5: the disposition rule, pinned.
 *
 *   node test-cam-row-classification.js
 *
 * WHAT THIS IS FOR
 * ----------------
 * The 28 legacy cam_reconciliations rows need a decision, and the decision has
 * to be the same one every time it is asked for. tools/cam-row-classifier.js is
 * that rule as a pure function; this file pins its behaviour against the frozen
 * pilot snapshot in evidence/2026-09-05-cam-28-row-snapshot.json and against
 * synthetic rows for the branches pilot does not currently contain.
 *
 * Nothing here touches a database. The classifier reads a row and returns a
 * record; no disposition is executed by this suite or by that module.
 *
 * THE PROPERTY THIS SUITE DEFENDS ABOVE ALL OTHERS
 * -----------------------------------------------
 * REPRODUCIBLE IS NOT TRUSTWORTHY. All eleven cap bases in pilot reproduce
 * their ceiling exactly, and not one is supported by a lease clause. A
 * classifier that let `reproducible` imply `lease_confirmed`, or let an
 * unverified base suppress a correct calculation, would have collapsed the two
 * axes the whole cap-base workstream exists to keep apart. Group D is that
 * assertion, stated directly rather than left to follow from the others.
 */

const fs = require('fs'), path = require('path');
const C = require('./tools/cam-row-classifier.js');
const SNAP = require('./evidence/2026-09-05-cam-28-row-snapshot.json');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const rows = SNAP.rows;
const all  = rows.map(C.classify);
const by   = Object.fromEntries(all.map(d => [d.recon_id, d]));

// ── A. The snapshot is the 28 rows, and it is intact ───────────────────────
sec('A. The frozen snapshot');
{
  eq(rows.length, 28, 'A1 the snapshot holds all 28 affected rows');
  eq(new Set(rows.map(r => r.recon_id)).size, 28, 'A2 with 28 distinct reconciliation ids');
  is(rows.every(r => r.expected_cam !== null && r.expected_cam !== undefined),
     'A3 every row has a non-null expected_cam — that is what made it affected');
  is(rows.every(r => r.expected_cam_basis === null),
     'A4 and none carries a basis: migration 020 added the column and wrote nothing');
  is(rows.every(r => Math.abs((r.actual_cam - r.expected_cam) - r.variance) < 0.005),
     'A5 every stored variance is actual − expected, the percent-in-dollars signature');
  eq(SNAP.table_md5_at_capture, 'c3482653f1a1f61266f8a6b066d4e87a',
     'A6 the snapshot records the table fingerprint it was taken at');
}

// ── B. The three classes partition the set ─────────────────────────────────
sec('B. Classification is total, deterministic and disjoint');
{
  const s = C.summarise(rows);
  eq(s.total, 28, 'B1 every row is classified');
  eq(s.byClass.M + s.byClass.N + s.byClass.O, 28, 'B2 the classes partition the set');
  eq(s.byClass.M, 11, 'B3 Class M — a cap base is stored');
  eq(s.byClass.N, 14, 'B4 Class N — no cap base');
  eq(s.byClass.O, 3,  'B5 Class O — the tenant does not resolve');
  is(all.every(d => C.CLASSES.includes(d.class)), 'B6 no row lands outside the three classes');
  is(all.every(d => C.DISPOSITIONS.includes(d.disposition)),
     'B7 and every disposition is one of the four declared');

  // Determinism: the same row twice, and a mutated copy, must not interfere.
  const a = JSON.stringify(rows.map(C.classify));
  const b = JSON.stringify(rows.map(C.classify));
  eq(a === b, true, 'B8 classifying twice yields identical records');
  // A PRISTINE copy: `all` above already ran the classifier over `rows`, so
  // comparing rows to a snapshot taken now would compare a mutated object with
  // itself and could never fail.
  const pristine = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'evidence', '2026-09-05-cam-28-row-snapshot.json'), 'utf8')).rows;
  const before = JSON.stringify(pristine);
  pristine.map(C.classify);
  eq(JSON.stringify(pristine), before, 'B9 and the classifier does not mutate its input');
  is(!pristine.some(r => Object.keys(r).some(k => k.startsWith('_'))),
     'B9b nor decorates it with bookkeeping fields');
}

// ── C. Class O outranks everything ─────────────────────────────────────────
sec('C. An unresolved tenant is decided before its numbers are read');
{
  const o = all.filter(d => d.class === 'O');
  eq(o.length, 3, 'C1 three rows point at a tenant that no longer exists');
  is(o.every(d => d.disposition === 'hold_identity_unresolved'),
     'C2 all three are held, not repaired');
  is(o.every(d => d.proposed === null),
     'C3 and no replacement value is proposed for any of them');
  is(o.every(d => d.sourceState === 'unresolved'),
     'C4 their cap-base provenance is "unresolved", not "unknown" — a different absence');
  is(o.every(d => d.effects.reversible === false),
     'C5 a hold is not a reversible action because it is not an action');

  // Identity beats a present base: even a row WITH a usable base must hold.
  const synth = C.classify({ recon_id: 'x', tenant_resolves: false, cap_pct: '5',
                             cap_base: '26000', actual_cam: 1000, expected_cam: 5 });
  eq(synth.class, 'O', 'C6 an unresolved tenant with a stored base is still Class O');
  eq(synth.disposition, 'hold_identity_unresolved', 'C7 and is still held');
  eq(synth.reproducible, false, 'C8 nothing is called reproducible for a subject that is missing');
}

// ── D. Reproducible ≠ trustworthy ──────────────────────────────────────────
sec('D. The two axes never collapse');
{
  const m = all.filter(d => d.class === 'M');
  eq(m.length, 11, 'D1 eleven rows carry a cap base');
  is(m.every(d => d.reproducible === true), 'D2 ALL of them reproduce their ceiling exactly');
  is(m.every(d => d.leaseEvidence === false), 'D3 and NONE of them is supported by a clause');
  is(m.every(d => d.sourceState === 'manually_entered'),
     'D4 every one resolves manually_entered — the S1 floor, and the truth');
  is(m.every(d => d.mKind === 'historical'),
     'D5 so all eleven are historical manual input, not lease-supported values');
  eq(all.filter(d => d.mKind === 'supported').length, 0,
     'D6 pilot contains no lease-supported cap base today');

  // The assertion the whole workstream turns on.
  is(m.every(d => d.reproducible === true && d.sourceState !== 'lease_confirmed'),
     'D7 REPRODUCIBLE DOES NOT IMPLY LEASE-CONFIRMED');
  is(m.every(d => d.proposed && d.proposed.expected_cam_basis === 'cap_ceiling'),
     'D8 and an unverified base does not void a correct calculation — the basis is still stamped');
  is(m.every(d => d.disposition === 'recompute_disclosed'),
     'D9 which is why the disposition is recompute-and-DISCLOSE, not recompute-and-assert');
}

// ── E. Class M sub-kinds, on synthetic rows pilot does not have ────────────
sec('E. The three M sub-questions are answered separately');
{
  const base = { recon_id: 'm', tenant_resolves: true, cap_pct: '5', cap_base: '26000',
                 actual_cam: 27300, expected_cam: 5, variance: 27295 };

  const usable = C.classify(base);
  eq(usable.mKind, 'historical', 'E1 usable + unsupported ⇒ historical');
  eq(usable.ceiling, 27300,      'E2 with the ceiling computed');
  eq(usable.proposed.variance, 0, 'E3 and the true variance derived from it');

  const supported = C.classify({ ...base, capbase_evid_quoted: 1 });
  eq(supported.mKind, 'supported',             'E4 a quoted clause makes it supported');
  eq(supported.sourceState, 'lease_confirmed', 'E5 and lease_confirmed');
  eq(supported.disposition, 'recompute_and_stamp',
     'E6 which upgrades the disposition from disclosed to stamped');
  eq(supported.replacementAvailable, true, 'E7 a lease-supported replacement exists');

  const confirmed = C.classify({ ...base, capbase_evid_approved: 1 });
  eq(confirmed.sourceState, 'manually_confirmed', 'E8 an approved snapshot is manually_confirmed');
  eq(confirmed.leaseEvidence, false, 'E9 but a confirmation is still not lease evidence');
  eq(confirmed.disposition, 'recompute_disclosed', 'E10 so it is disclosed, not asserted');

  // Unusable bases fall out of M's usable branch.
  for (const [label, v] of [['zero', '0'], ['negative', '-5'], ['non-numeric', 'twenty-six k']]) {
    const r = C.classify({ ...base, cap_base: v });
    eq(r.class, 'N', 'E11 a ' + label + ' base is not a base — Class N');
    eq(r.disposition, 'null_out', 'E12   …and nulls out');
  }
  // _ceiling has its own non-positive guard. hasBase screens those values out
  // first, so the guard is a second line of defence that no row reaches — and an
  // untested guard is a guard that can be deleted silently.
  eq(C._ceiling(0, 5), null,      'E10a _ceiling refuses a zero base directly');
  eq(C._ceiling(-100, 5), null,   'E10b and a negative one');
  eq(C._ceiling(26000, 5), 27300, 'E10c while a positive base still computes');
  eq(C._ceiling(null, 5), null,   'E10d a missing base yields no ceiling');
  eq(C._ceiling(26000, null), null, 'E10e and a missing percentage yields none either');

  const noPct = C.classify({ ...base, cap_pct: null });
  eq(noPct.reproducible, false, 'E13 a base with no percentage cannot produce a ceiling');
  eq(noPct.disposition, 'null_out', 'E14 so it nulls out rather than proposing a number');
}

// ── F. Class N has no available source ─────────────────────────────────────
sec('F. Nothing in pilot can supply a missing base');
{
  const n = all.filter(d => d.class === 'N');
  eq(n.length, 14, 'F1 fourteen rows have no cap base');
  is(n.every(d => d.sourceState === 'unknown'),
     'F2 their provenance is unknown — absence, not assertion');
  is(n.every(d => d.replacementAvailable === false),
     'F3 and no lease-supported replacement exists for any of them');
  is(n.every(d => d.disposition === 'null_out'), 'F4 all fourteen null out');
  is(n.every(d => d.proposed.expected_cam === null && d.proposed.variance === null
                  && d.proposed.expected_cam_basis === null),
     'F5 to NULL/NULL/NULL — what saveCamResults writes for these tenants today');

  // The corpus-level fact: no lease document ties a baseline phrase to a figure.
  eq(rows.filter(r => r.docs_with_base_figure > 0).length, 0,
     'F6 no lease document in pilot states a prior-year/base-year dollar figure');
  is(rows.some(r => r.docs_by_name > 0),
     'F7 even though lease text EXISTS for most of them — text is not a source');
}

// ── G. The classifier refuses to derive ────────────────────────────────────
sec('G. No base is ever inferred');
{
  // Feed every tempting signal at once, with no base. The answer must not move.
  const tempting = C.classify({
    recon_id: 'g', tenant_resolves: true, cap_pct: '5', cap_base: null,
    actual_cam: 26000, expected_cam: 5, variance: 25995,
    // signals a careless implementation might reach for:
    base_rent: 84000, leased_sqft: 3000, total_expenses: 13700,
    prior_year_cam: 26000, sibling_cap_base: '26000', allocated_amount: 26000,
  });
  eq(tempting.class, 'N', 'G1 a row rich in signals but poor in bases is still Class N');
  eq(tempting.hasBase, false, 'G2 no base is manufactured');
  eq(tempting.ceiling, null,  'G3 no ceiling is produced');
  eq(tempting.disposition, 'null_out', 'G4 and it nulls out');

  const src = fs.readFileSync(path.join(__dirname, 'tools', 'cam-row-classifier.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  for (const forbidden of ['base_rent', 'leased_sqft', 'total_expenses', 'prior_year_cam',
                           'sibling', 'allocated_amount']) {
    is(!new RegExp('\\b' + forbidden + '\\b').test(src),
       'G5 the classifier never reads ' + forbidden);
  }
  is(!/actual_cam\s*\/|\/\s*\(1\s*\+/.test(src),
     'G6 and never back-computes a base from the charge');
}

// ── H. Every record states its consequences ────────────────────────────────
sec('H. The effects of each disposition are declared, not inferred');
{
  is(all.every(d => d.effects && typeof d.effects.billingCouldChange === 'boolean'),
     'H1 every record declares whether billing could change');
  is(all.every(d => d.effects.billingCouldChange === false),
     'H2 and none can: expected_cam and variance feed no statement or invoice path');
  is(all.filter(d => d.disposition !== 'hold_identity_unresolved')
        .every(d => d.effects.varianceCouldChange === true),
     'H3 every acting disposition changes the displayed variance');
  is(all.every(d => d.effects.provenanceCouldChange === false),
     'H4 no disposition writes evidence, so no provenance state moves');
  is(all.filter(d => d.disposition !== 'hold_identity_unresolved')
        .every(d => d.effects.reversible === true),
     'H5 and every acting disposition is reversible from a pre-image snapshot');
  is(all.every(d => typeof d.reason === 'string' && d.reason.length > 80),
     'H6 and carries a stated reason, not just a label');
}

// ── I. The row-by-row dispositions, pinned by id ───────────────────────────
sec('I. The 28 dispositions are pinned individually');
{
  const EXPECT = {
    // Class O — held
    '0669ad47-e616-4999-af9f-0b25c9520126': 'hold_identity_unresolved',
    '7b5c9e2c-68b5-4010-974f-0fdeca78fa5e': 'hold_identity_unresolved',
    '455c4ab5-d770-4313-8297-f6b1200dfc9f': 'hold_identity_unresolved',
    // Class M — recompute, disclosed
    'c03ef6f7-fb96-49ad-b1c8-947b2f25251e': 'recompute_disclosed',
    'd797dd73-ba1a-4fe4-80dc-ec5e2ea8dcef': 'recompute_disclosed',
    'c448d099-2d72-4388-bc35-f7f9a2739dde': 'recompute_disclosed',
    '49fbe80f-fc1d-453d-bf45-27408e53bb68': 'recompute_disclosed',
    'ba3f4b4b-a00e-4e5e-8d77-c91fa41b9064': 'recompute_disclosed',
    '275d2435-3ac8-4cb5-b4a3-f30bea48e5e9': 'recompute_disclosed',
    'fbab58b4-046e-42e6-9962-36ad4ea81f2a': 'recompute_disclosed',
    'f38394a5-cd3b-4728-be67-4f9e254d5fba': 'recompute_disclosed',
    '360b8a20-7e67-461f-a702-b42a0e8a405d': 'recompute_disclosed',
    '6e4f6a7b-d877-43fa-aab7-19300e3730b1': 'recompute_disclosed',
    'b6c1de76-9451-42ca-84b3-46d6454047f6': 'recompute_disclosed',
  };
  let wrong = [];
  for (const [id, want] of Object.entries(EXPECT)) {
    if (!by[id]) { wrong.push(id + ' MISSING'); continue; }
    if (by[id].disposition !== want) wrong.push(id + ' → ' + by[id].disposition);
  }
  eq(wrong.length, 0, 'I1 every pinned disposition matches' + (wrong.length ? ' — ' + wrong.join('; ') : ''));
  eq(all.filter(d => d.disposition === 'null_out').length, 14, 'I2 the remaining fourteen null out');

  // The four Cascade ceilings land exactly on the charge, so the true variance is zero.
  for (const [id, ceil] of [['c03ef6f7-fb96-49ad-b1c8-947b2f25251e', 24960],
                            ['d797dd73-ba1a-4fe4-80dc-ec5e2ea8dcef', 13780],
                            ['c448d099-2d72-4388-bc35-f7f9a2739dde', 6696],
                            ['49fbe80f-fc1d-453d-bf45-27408e53bb68', 34650]]) {
    eq(by[id].ceiling, ceil, 'I3 ' + id.slice(0, 8) + ' ceiling');
    eq(by[id].proposed.variance, 0, 'I3b   …and a true variance of zero — billed exactly at cap');
  }
  // Test 2's ceilings sit far above the charge, so the variance is negative.
  eq(by['360b8a20-7e67-461f-a702-b42a0e8a405d'].ceiling, 107000, 'I4 IMPCO ceiling');
  eq(by['360b8a20-7e67-461f-a702-b42a0e8a405d'].proposed.variance, -104853.8,
     'I4b with a large NEGATIVE variance — under-billed, currently shown as overage');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
