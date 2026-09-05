'use strict';
/**
 * tools/cam-remediation-preflight.js — the statements, generated and not run.
 *
 * NOT LOADED BY THE APPLICATION and it executes nothing. It reads the frozen
 * snapshot, applies the S5 classifier and the approved hold list, and RETURNS
 * SQL as text. There is no database client in this file, no connection string,
 * and no code path that could reach one. Producing the statements and running
 * them are deliberately different acts performed by different things.
 *
 * ── WHY THE SQL IS GENERATED RATHER THAN WRITTEN ────────────────────────────
 *
 * Twenty-four UPDATE statements typed by hand are twenty-four chances to
 * transpose a UUID, drop a row, or paste a ceiling onto the wrong tenant. These
 * come from the same classifier the S5 report was built from, so the statements
 * and the table in that report cannot disagree — and `assertSafe` below refuses
 * to emit anything that violates the constraints the remediation was approved
 * under.
 *
 * ── THE HOLD LIST ───────────────────────────────────────────────────────────
 *
 * Two kinds of row are excluded, for different reasons, and the difference is
 * kept visible rather than merged into one "skip" list:
 *
 *   Class O (3)   The tenant does not resolve. Structural: the classifier
 *                 itself refuses to propose a write, so these can never appear
 *                 in the output whatever this file does.
 *
 *   HELD_FOR_REVIEW (1)  Maple Coffee Co. The classifier DOES propose a write
 *                 — the arithmetic is reproducible — and it is excluded anyway,
 *                 by human judgement, because the $26,000 base is absent from
 *                 its lease, exceeds the property's entire CAM pool, and sits
 *                 four times above an identically-sized neighbour. This is the
 *                 case that proves reproducible is not trustworthy, so the
 *                 exclusion is data here rather than a special case in the
 *                 classifier: the classification stays honest and the operator
 *                 decision stays visible.
 */

const C = require('./cam-row-classifier.js');

/** Excluded by human review despite a reproducible calculation. See header. */
const HELD_FOR_REVIEW = {
  '275d2435-3ac8-4cb5-b4a3-f30bea48e5e9':
    'Maple Coffee Co — $26,000 base is absent from maple_plaza_messy_lease.pdf, '
  + 'exceeds the property CAM pool ($13,700) by 1.9x, and is 4x the base on an '
  + 'identically sized neighbour (Luxe Nails, 3,000 sqft, $6,500). Mathematically '
  + 'usable, not trustworthy. Awaiting human review.',
};

/** Columns any statement is permitted to SET. Nothing else may appear. */
const WRITABLE = ['expected_cam', 'variance', 'expected_cam_basis'];

/** Columns that carry money a tenant is billed. A SET touching one is a bug. */
const BILLING_COLUMNS = ['actual_cam', 'allocated_amount', 'pro_rata_percent', 'total_expenses'];

const _n = (v) => (v === null || v === undefined) ? 'NULL' : String(v);
const _q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/**
 * Build the full preflight: the plan, the statements, and the verification.
 * @param {Array} rows the frozen snapshot rows
 */
function preflight(rows) {
  const decided = (rows || []).map(C.classify);

  const held = [];
  const classN = [], classM = [];

  for (const d of decided) {
    if (d.disposition === 'hold_identity_unresolved') {
      held.push({ ...d, holdKind: 'class_O_identity',
                  holdReason: 'Tenant identity does not resolve; the classifier proposes no write.' });
      continue;
    }
    if (HELD_FOR_REVIEW[d.recon_id]) {
      held.push({ ...d, holdKind: 'human_review',
                  holdReason: HELD_FOR_REVIEW[d.recon_id] });
      continue;
    }
    if (d.disposition === 'null_out')            classN.push(d);
    else if (d.disposition === 'recompute_disclosed'
          || d.disposition === 'recompute_and_stamp') classM.push(d);
  }

  const stmts = [];

  // 0 — the pre-image. Reversibility rests on this and nothing else, so it is
  //     the first statement and it covers ALL 46 rows, not only the 24 written.
  stmts.push({
    id: 'S0-preimage', kind: 'capture', rowsAffected: 0,
    sql:
`-- S0. PRE-IMAGE. Run FIRST and keep the output. Every proposed write is
-- reversible from this and from nothing else. Covers all 46 rows, not just the
-- 24 being changed, so a mistake outside the target set is also detectable.
SELECT id, expected_cam, variance, expected_cam_basis
FROM cam_reconciliations
ORDER BY id;`,
  });

  // 1 — Class N. One statement, explicit id list.
  if (classN.length) {
    stmts.push({
      id: 'S1-class-N', kind: 'update', rowsAffected: classN.length,
      ids: classN.map(d => d.recon_id),
      sql:
`-- S1. CLASS N — ${classN.length} rows with no cap base on file.
-- expected_cam holds a cap PERCENTAGE and variance holds dollars-minus-percent.
-- No base means no ceiling, so there is no number to put here. NULL is exactly
-- what saveCamResults writes for these tenants today; this brings the rows into
-- agreement with the code rather than giving them a new value.
-- Addressed by explicit id: a predicate such as "expected_cam < 100" would also
-- catch any future legitimate small ceiling.
UPDATE cam_reconciliations
SET expected_cam       = NULL,
    variance           = NULL,
    expected_cam_basis = NULL
WHERE id IN (
${classN.map(d => '  ' + _q(d.recon_id) + '::uuid').join(',\n')}
);
-- expected: UPDATE ${classN.length}`,
    });
  }

  // 2 — Class M. One statement per row: each carries its own ceiling, and a
  //     CASE expression over 10 rows is harder to read than 10 statements.
  for (const d of classM) {
    stmts.push({
      id: 'S2-class-M-' + d.recon_id.slice(0, 8), kind: 'update', rowsAffected: 1,
      ids: [d.recon_id],
      sql:
`-- S2. CLASS M — ${d.tenant_name} @ ${d.property} (${d.cam_year})
--   cap ${d.capPct}% on a base of ${d.capBase} => ceiling ${d.ceiling}
--   expected_cam ${_n(d.current.expected_cam)} -> ${_n(d.proposed.expected_cam)}
--   variance     ${_n(d.current.variance)} -> ${_n(d.proposed.variance)}
--   basis        NULL -> cap_ceiling
--   The BASIS describes the arithmetic. The base beneath it remains
--   manually_entered and uncited; FieldProvenance reports that separately and
--   the surfaces must keep disclosing it.
UPDATE cam_reconciliations
SET expected_cam       = ${_n(d.proposed.expected_cam)},
    variance           = ${_n(d.proposed.variance)},
    expected_cam_basis = 'cap_ceiling'
WHERE id = ${_q(d.recon_id)}::uuid;
-- expected: UPDATE 1`,
    });
  }

  // 3 — verification, to be run after and compared against the plan.
  stmts.push({
    id: 'S3-verify', kind: 'verify', rowsAffected: 0,
    sql:
`-- S3. VERIFY. Run AFTER. Every number here is predicted by the preflight plan.
SELECT
  count(*)                                                    AS total_rows,
  count(*) FILTER (WHERE expected_cam_basis = 'cap_ceiling')  AS stamped,
  count(*) FILTER (WHERE expected_cam IS NULL)                AS null_expected,
  count(*) FILTER (WHERE expected_cam IS NOT NULL
                     AND expected_cam_basis IS NULL)          AS unstamped_with_value,
  sum(actual_cam)                                             AS sum_actual_cam,
  sum(allocated_amount)                                       AS sum_allocated,
  sum(total_expenses)                                         AS sum_total_expenses
FROM cam_reconciliations;
-- predicted: total_rows 46 | stamped ${classM.length} | null_expected ${18 + classN.length}
--            unstamped_with_value ${held.length}
--            sum_actual_cam, sum_allocated, sum_total_expenses ALL UNCHANGED`,
  });

  return {
    plan: {
      totalConsidered: decided.length,
      classN: classN.length,
      classM: classM.length,
      held: held.length,
      heldByKind: held.reduce((a, h) => (a[h.holdKind] = (a[h.holdKind] || 0) + 1, a), {}),
      rowsWritten: classN.length + classM.length,
      billingColumnsTouched: 0,
    },
    classN, classM, held, statements: stmts,
  };
}

/**
 * Refuse to hand over statements that break the terms the remediation was
 * approved under. Returns a list of violations; empty means safe to review.
 */
function assertSafe(pf) {
  const v = [];
  const updates = pf.statements.filter(s => s.kind === 'update');
  const allSql  = pf.statements.map(s => s.sql).join('\n');

  // Only UPDATE, SELECT and comments. No row may be created or destroyed.
  for (const verb of ['INSERT', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE']) {
    const bare = allSql.replace(/^\s*--.*$/gm, '');
    if (new RegExp('\\b' + verb + '\\b', 'i').test(bare)) v.push('forbidden verb: ' + verb);
  }

  for (const s of updates) {
    // Extract the SET clause only — comments name columns this must not match.
    const body = s.sql.replace(/^\s*--.*$/gm, '');
    const set = (body.match(/SET([\s\S]*?)WHERE/i) || [, ''])[1];
    const cols = [...set.matchAll(/([a-z_]+)\s*=/g)].map(m => m[1]);
    for (const c of cols) if (!WRITABLE.includes(c)) v.push(s.id + ': sets non-writable column ' + c);
    for (const c of BILLING_COLUMNS) {
      if (new RegExp('\\b' + c + '\\b').test(set)) v.push(s.id + ': SET clause names billing column ' + c);
    }
    // Addressed by id, never by value.
    if (!/WHERE\s+id\s*(=|IN)/i.test(body)) v.push(s.id + ': not addressed by id');
    if (/WHERE[\s\S]*\b(expected_cam|variance|actual_cam)\b\s*[<>=]/i.test(body)) {
      v.push(s.id + ': WHERE clause filters on a value rather than an id');
    }
    if (!/cam_reconciliations/.test(body)) v.push(s.id + ': does not target cam_reconciliations');
    if (/\bUPDATE\b(?![\s\S]*cam_reconciliations)/i.test(body)) v.push(s.id + ': updates another table');
  }

  // Every held row must be absent from every statement.
  const written = new Set(updates.flatMap(s => s.ids || []));
  for (const h of pf.held) {
    if (written.has(h.recon_id)) v.push('HELD ROW APPEARS IN A WRITE: ' + h.recon_id);
  }
  // And every approved row must be present exactly once.
  const approved = [...pf.classN, ...pf.classM].map(d => d.recon_id);
  for (const id of approved) if (!written.has(id)) v.push('approved row missing from statements: ' + id);
  if (written.size !== approved.length) v.push('write set size ' + written.size + ' != approved ' + approved.length);

  return v;
}

module.exports = { preflight, assertSafe, HELD_FOR_REVIEW, WRITABLE, BILLING_COLUMNS };
