'use strict';
/**
 * test-payment-state-machine.js — Phase 1a: the payment lifecycle, behaviourally.
 *
 *   node test-payment-state-machine.js
 *
 * No database, no network, no mutation. This suite exercises the pure module;
 * test-payment-schema-contract.js pins the SQL that must agree with it. Both
 * exist because a model that only agrees with itself proves nothing.
 *
 * The approved decisions each get at least one assertion that would FAIL if the
 * decision were quietly reversed — which is the only kind of assertion worth
 * writing about a rule someone might later find inconvenient.
 */

const M = require('./tools/payment-state-machine.js');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const S = (amount, quality, extra) => Object.assign(
  { id: 's' + Math.random().toString(36).slice(2), amount, evidence_quality: quality || 'attested' },
  extra || {});

// ── A. The state set, and what is deliberately absent ──────────────────────
sec('A. Six states, and `disputed` is not one of them');
{
  eq(M.STATES.length, 6, 'A1 six states');
  is(M.STATES.indexOf('disputed') === -1,
     'A2 `disputed` is NOT a state — it is an attribute, so it can compose with any of them');
  eq(M.STATE_ACTIONS.length, 6, 'A3 six state-changing actions');
  eq(M.DISPUTE_ACTIONS.length, 2, 'A4 two dispute actions, modelled apart');
  is(M.STATE_ACTIONS.every(a => M.DISPUTE_ACTIONS.indexOf(a) === -1),
     'A5 and the two sets are disjoint');
}

// ── B. Transitions ─────────────────────────────────────────────────────────
sec('B. Only the approved transitions are legal');
{
  is(M.canTransition('draft', 'authorize'),      'B1 draft → authorize');
  is(M.canTransition('authorized', 'issue'),     'B2 authorized → issue');
  is(M.canTransition('instructed', 'record_settlement'), 'B3 instructed → record_settlement');
  is(!M.canTransition('draft', 'issue'),         'B4 draft cannot skip authorization');
  is(!M.canTransition('draft', 'record_settlement'),
     'B5 and cannot skip straight to a settlement');
  is(!M.canTransition('authorized', 'record_settlement'),
     'B6 an authorized-but-unissued payment cannot be settled');
  is(!M.canTransition('cancelled', 'authorize') && !M.canTransition('cancelled', 'record_settlement'),
     'B7 cancelled is terminal — it is replaced by a new payment, never revived');
  eq(M.TRANSITIONS.cancelled.length, 0, 'B8 with no outgoing transitions at all');

  // The invariant the whole product rests on.
  const fromNothing = M.STATES.filter(s => M.canTransition(s, 'authorize'));
  eq(fromNothing.length, 1, 'B9 exactly one state can be authorized from');
  eq(fromNothing[0], 'draft', 'B10 and it is draft — no calculation can reach `authorized`');
}

// ── C. Required fields ─────────────────────────────────────────────────────
sec('C. A transition without its fields is refused');
{
  const p = { state: 'authorized', authorized_amount: 100, settlements: [] };
  let r = M.applyTransition(p, 'issue', { request_id: 'r1' });
  is(!r.ok && r.errors.some(e => /method/.test(e)), 'C1 issue without a method is refused');
  is(!r.ok && r.errors.some(e => /destination_label/.test(e)), 'C2 and without a destination');
  r = M.applyTransition(p, 'issue', { request_id: 'r1', method: 'ach', destination_label: 'Operating ••4821' });
  is(r.ok && r.state === 'instructed', 'C3 with both, it issues');

  r = M.applyTransition(p, 'issue', { request_id: 'r1', method: 'venmo', destination_label: 'x' });
  is(!r.ok && r.errors.some(e => /unknown method/.test(e)), 'C4 an unknown method is refused');
  r = M.applyTransition(p, 'issue', { request_id: 'r1', method: 'ach', destination_label: 'x'.repeat(61) });
  is(!r.ok && r.errors.some(e => /60 characters/.test(e)),
     'C5 destination_label is length-bounded — it is a display hint, not an instrument');

  r = M.applyTransition({ state: 'instructed', authorized_amount: 100, settlements: [] },
                        'cancel', { request_id: 'r1' });
  is(!r.ok && r.errors.some(e => /reason/.test(e)), 'C6 cancellation requires a reason');
}

// ── D. The amount hash binds the figure a human saw ────────────────────────
sec('D. Authorization is bound to the figure that was proposed');
{
  const p = { state: 'draft', authorized_amount: 42318.72, authorized_amount_hash: 'H1', settlements: [] };
  let r = M.applyTransition(p, 'authorize', { request_id: 'r1', amount_hash: 'H1' });
  is(r.ok && r.state === 'authorized', 'D1 a matching hash authorizes');
  r = M.applyTransition(p, 'authorize', { request_id: 'r1', amount_hash: 'H2' });
  is(!r.ok && r.errors.some(e => /hash mismatch/.test(e)),
     'D2 a changed figure is refused, not silently followed');
}

// ── E. Settled means recorded, and nothing more ────────────────────────────
sec('E. `settled` is a claim about MainStreet\'s records');
{
  eq(M.deriveState(100, []), 'instructed', 'E1 nothing recorded → instructed');
  eq(M.deriveState(100, [S(40)]), 'partially_settled', 'E2 part recorded → partially_settled');
  eq(M.deriveState(100, [S(40), S(60)]), 'settled', 'E3 the full amount → settled');
  eq(M.deriveState(100, [S(120)]), 'settled', 'E4 an overpayment is still settled');
  eq(M.balanceRemaining(100, [S(120)]), -20,
     'E5 and the balance goes negative — a record that cannot show an overpayment cannot describe what happened');

  // THE assertion this whole design exists for.
  const attested = [S(40, 'attested'), S(30, 'attested'), S(30, 'attested')];
  eq(M.deriveState(100, attested), 'settled', 'E6 three attested rows reach `settled`…');
  eq(M.verificationFloor(attested), 'attested',
     'E7 …and the verification floor is STILL `attested` — settled is not verified');

  is(M.EVIDENCE_QUALITY.indexOf('verified') === -1,
     'E8 there is no evidence quality called `verified`, because MainStreet verifies nothing');
  eq(M.EVIDENCE_QUALITY[M.EVIDENCE_QUALITY.length - 1], 'externally_verifiable',
     'E9 the strongest value says a third party COULD check it, not that anyone did');

  // The floor is the minimum, never the best row.
  eq(M.verificationFloor([S(50, 'externally_verifiable'), S(50, 'attested')]), 'attested',
     'E10 one weak row drags the floor down — a payment is only as verified as its weakest evidence');
  eq(M.verificationFloor([]), null, 'E11 nothing recorded → no floor at all');
}

// ── F. Partial payments and voiding ────────────────────────────────────────
sec('F. Partial settlements, and corrections that keep their history');
{
  const rows = [S(40, 'attested', { id: 'a' }), S(60, 'attested', { id: 'b' })];
  eq(M.amountSettled(rows), 100, 'F1 live rows sum');
  const voided = [rows[0], Object.assign({}, rows[1], { voided_at: '2026-09-05T00:00:00Z' })];
  eq(M.amountSettled(voided), 40, 'F2 a voided row stops counting…');
  eq(M.liveSettlements(voided).length, 1, 'F3 …but is still there — history is never deleted');
  eq(M.deriveState(100, voided), 'partially_settled',
     'F4 and the state recomputes DOWNWARD from what remains');

  const p = { state: 'settled', authorized_amount: 100, settlements: rows };
  const r = M.applyTransition(p, 'void_settlement',
    { request_id: 'r1', settlement_id: 'b', reason: 'duplicate bank reference' });
  is(r.ok && r.state === 'partially_settled', 'F5 voiding through the transition walks it back');
  const r2 = M.applyTransition(p, 'void_settlement', { request_id: 'r1', settlement_id: 'b' });
  is(!r2.ok && r2.errors.some(e => /reason/.test(e)), 'F6 voiding requires a reason');

  const r3 = M.applyTransition({ state: 'instructed', authorized_amount: 100, settlements: [] },
    'record_settlement', { request_id: 'r1', amount: 0, settled_at: 'now',
                           evidence_kind: 'bank_reference', evidence_quality: 'attested' });
  is(!r3.ok && r3.errors.some(e => /positive/.test(e)), 'F7 a zero-amount settlement is refused');
}

// ── G. Cancellation ────────────────────────────────────────────────────────
sec('G. A payment with money against it cannot be cancelled');
{
  const p = { state: 'instructed', authorized_amount: 100, settlements: [S(10)] };
  const r = M.applyTransition(p, 'cancel', { request_id: 'r1', reason: 'duplicate' });
  is(!r.ok && r.errors.some(e => /void them first/.test(e)),
     'G1 cancelling over a recorded settlement is refused');
  const clean = { state: 'instructed', authorized_amount: 100, settlements: [] };
  const r2 = M.applyTransition(clean, 'cancel', { request_id: 'r1', reason: 'issued in error' });
  is(r2.ok && r2.state === 'cancelled', 'G2 with nothing recorded, it cancels');
}

// ── H. Disputes are orthogonal ─────────────────────────────────────────────
sec('H. A dispute never moves a payment');
{
  for (const st of ['authorized', 'instructed', 'partially_settled', 'settled']) {
    const p = { state: st, authorized_amount: 100, settlements: [S(50)] };
    const r = M.applyTransition(p, 'dispute_open', { request_id: 'r1', reason: 'disputes $4,000 of CAM' });
    is(r.ok && r.state === st, 'H1 dispute_open from ' + st + ' leaves the state at ' + st);
  }
  const p = { state: 'partially_settled', authorized_amount: 100, settlements: [S(50)] };
  const r = M.applyTransition(p, 'dispute_resolve', { request_id: 'r1' });
  is(r.ok && r.state === 'partially_settled',
     'H2 resolving returns to nowhere — the payment never left its state');
  is(!M.canTransition('cancelled', 'dispute_open'),
     'H3 a cancelled payment cannot be disputed');
}

// ── I. Attention flags report; they never reconcile ────────────────────────
sec('I. Supersession and mismatch are surfaced, never auto-reconciled');
{
  const payment = { source_statement_id: 'ST-v1', authorized_amount: 100, settlements: [],
                    current_amount_hash: 'H2' };
  const source  = { authorized_amount_hash: 'H1' };
  const superseded = { id: 'ST-v1', status: 'superseded' };

  const flags = M.attentionFlags(payment, source, superseded);
  is(flags.indexOf('source_superseded') !== -1, 'I1 a superseded statement raises a flag');
  is(flags.indexOf('amount_hash_mismatch') !== -1, 'I2 a changed figure raises a flag');
  eq(payment.source_statement_id, 'ST-v1',
     'I3 and the payment is STILL bound to the version a human authorized');
  eq(payment.authorized_amount, 100, 'I4 with its amount untouched');

  const clean = M.attentionFlags({ source_statement_id: 'ST-v1', authorized_amount: 100,
                                   settlements: [], current_amount_hash: 'H1' },
                                 { authorized_amount_hash: 'H1' },
                                 { id: 'ST-v1', status: 'published' });
  eq(clean.length, 0, 'I5 a current, matching payment raises nothing');

  const over = M.attentionFlags({ authorized_amount: 100, settlements: [S(150)] }, {}, {});
  is(over.indexOf('overpaid') !== -1, 'I6 an overpayment is flagged for a human, not corrected');

  const disputed = M.attentionFlags({ authorized_amount: 100, settlements: [],
                                      disputed_at: 'x' }, {}, {});
  is(disputed.indexOf('in_dispute') !== -1, 'I7 an open dispute is flagged');
}

// ── J. The projection must equal the fold ──────────────────────────────────
sec('J. payments.state is a projection of the event log');
{
  const events = [
    { server_ts: '2026-09-01T00:00:00Z', state_after: 'draft' },
    { server_ts: '2026-09-02T00:00:00Z', state_after: 'authorized' },
    { server_ts: '2026-09-03T00:00:00Z', state_after: 'instructed' },
    { server_ts: '2026-09-04T00:00:00Z', state_after: 'partially_settled' },
  ];
  eq(M.foldEvents(events), 'partially_settled', 'J1 folding the log yields the current state');
  eq(M.foldEvents(events.slice().reverse()), 'partially_settled',
     'J2 and order of arrival does not matter — the fold sorts by server_ts');
  eq(M.foldEvents([]), null, 'J3 no events, no state');
  // Dispute events carry state_after === state_before, so they cannot move the fold.
  const withDispute = events.concat([
    { server_ts: '2026-09-05T00:00:00Z', state_after: 'partially_settled' }]);
  eq(M.foldEvents(withDispute), 'partially_settled',
     'J4 a dispute event leaves the folded state exactly where it was');
}

// ── K. No caller can assert a state ────────────────────────────────────────
sec('K. A state cannot be supplied, only derived');
{
  const p = { state: 'instructed', authorized_amount: 100, settlements: [] };
  const r = M.applyTransition(p, 'record_settlement', {
    request_id: 'r1', amount: 1, settled_at: 'now',
    evidence_kind: 'bank_reference', evidence_quality: 'attested',
    state: 'settled', state_after: 'settled',      // hostile payload
  });
  eq(r.state, 'partially_settled',
     'K1 a payload claiming `settled` is ignored — $1 of $100 is partially settled');
  is(M.requiredFields('record_settlement').indexOf('state') === -1,
     'K2 no transition accepts a state as an input field');
  const r2 = M.applyTransition(p, 'record_settlement', {
    request_id: 'r1', amount: 1, settled_at: 'now',
    evidence_kind: 'bank_reference', evidence_quality: 'verified' });
  is(!r2.ok && r2.errors.some(e => /unknown evidence_quality/.test(e)),
     'K3 and a payload claiming evidence quality `verified` is refused outright');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
