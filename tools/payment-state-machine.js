'use strict';
/**
 * tools/payment-state-machine.js — the payment lifecycle as a pure function.
 *
 * NOT LOADED BY THE APPLICATION. index.html does not reference it and nothing in
 * the product imports it. It exists so the rules migration 022 enforces in SQL
 * are also expressible, testable, and mutation-checkable in isolation — and so a
 * future Phase 1b write path has one definition of the lifecycle to agree with
 * rather than a second one to drift from.
 *
 * It reads values; it writes nothing, anywhere, and it moves no money. There is
 * no database client in this file and no code path that could reach one.
 *
 * ── THE TWO AXES THIS FILE REFUSES TO MERGE ─────────────────────────────────
 *
 * `settled` means: the non-voided settlements recorded against a payment sum to
 * at least the authorized amount. It is a statement about MAINSTREET'S RECORDS.
 *
 * `evidence_quality` says how well that record is supported. There is
 * deliberately no value called 'verified', because MainStreet verifies nothing.
 * The strongest value, `externally_verifiable`, says a third party COULD check
 * the reference — which is true — not that anyone DID.
 *
 * So a payment can be `settled` on three `attested` rows, and `verificationFloor`
 * still returns `attested`. A caller that renders the state without the floor is
 * reintroducing the conflation these two concepts exist to prevent. That is the
 * same discipline as expected_cam_basis, which describes arithmetic and asserts
 * nothing about whether its input was ever verified.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * It never derives a state from anything a caller asserts. `deriveState` reads
 * the settlement rows and the authorized amount, and nothing else. There is no
 * parameter through which a caller can claim a payment is settled.
 */

/** Every state a payment can hold. Deliberately few, and `disputed` is not one. */
const STATES = ['draft', 'authorized', 'instructed', 'partially_settled', 'settled', 'cancelled'];

/** The six that change state, then the two that do not. Kept apart on purpose. */
const STATE_ACTIONS   = ['create', 'authorize', 'issue', 'record_settlement', 'void_settlement', 'cancel'];
const DISPUTE_ACTIONS = ['dispute_open', 'dispute_resolve'];
const ACTIONS = STATE_ACTIONS.concat(DISPUTE_ACTIONS);

/**
 * Ordered weakest to strongest. `verified` is absent by design — see the header.
 * The order is the point: a payment is only as verified as its WEAKEST evidence.
 */
const EVIDENCE_QUALITY = ['attested', 'document_backed', 'externally_verifiable'];
const EVIDENCE_KINDS   = ['landlord_attestation', 'bank_reference', 'remittance_doc', 'onchain_tx'];
const METHODS          = ['ach', 'wire', 'check', 'external_rlusd', 'other'];

/** from-state → allowed actions. Mirrors the CHECK/RAISE rules in migration 022. */
const TRANSITIONS = {
  draft:             ['authorize', 'cancel'],
  authorized:        ['issue', 'cancel'],
  instructed:        ['record_settlement', 'cancel'],
  partially_settled: ['record_settlement', 'void_settlement'],
  settled:           ['record_settlement', 'void_settlement'],
  cancelled:         [],
};

/** Fields a transition cannot proceed without. */
const REQUIRED_FIELDS = {
  create:            ['property_id', 'tenant_id', 'cam_year', 'source_statement_id',
                      'authorized_amount', 'authorized_amount_hash', 'request_id'],
  authorize:         ['request_id', 'amount_hash'],
  issue:             ['request_id', 'method', 'destination_label'],
  record_settlement: ['request_id', 'amount', 'settled_at', 'evidence_kind', 'evidence_quality'],
  void_settlement:   ['request_id', 'settlement_id', 'reason'],
  cancel:            ['request_id', 'reason'],
  dispute_open:      ['request_id', 'reason'],
  dispute_resolve:   ['request_id'],
};

const _num = (v) => (v === null || v === undefined || v === '') ? null : Number(v);

/** Can `action` be applied from `from`? Dispute actions are legal from any live state. */
function canTransition(from, action) {
  if (DISPUTE_ACTIONS.indexOf(action) !== -1) return from !== 'cancelled' && STATES.indexOf(from) !== -1;
  return (TRANSITIONS[from] || []).indexOf(action) !== -1;
}

function requiredFields(action) {
  return (REQUIRED_FIELDS[action] || []).slice();
}

/** Non-voided settlements only. A voided row is history, not money. */
function liveSettlements(settlements) {
  return (settlements || []).filter(s => s && !s.voided_at);
}

function amountSettled(settlements) {
  return liveSettlements(settlements)
    .reduce((sum, s) => sum + (_num(s.amount) || 0), 0);
}

function balanceRemaining(authorizedAmount, settlements) {
  const a = _num(authorizedAmount);
  if (a === null) return null;
  // Deliberately allowed to go negative: tenants overpay, and a record that
  // cannot represent an overpayment cannot describe what happened.
  return Math.round((a - amountSettled(settlements)) * 100) / 100;
}

/**
 * The ONLY definition of settlement-derived state. Reads the rows and the
 * authorized amount; there is no parameter through which a caller can assert a
 * result. Mirrors _payment_derive_state() in migration 022.
 */
function deriveState(authorizedAmount, settlements) {
  const a = _num(authorizedAmount);
  const total = amountSettled(settlements);
  if (!(a > 0)) return null;
  if (total <= 0)  return 'instructed';
  if (total < a)   return 'partially_settled';
  return 'settled';                       // >= authorized, including overpayment
}

/**
 * The weakest evidence behind a payment, or null when nothing is recorded.
 * The minimum, never the best row — see the header.
 */
function verificationFloor(settlements) {
  const live = liveSettlements(settlements);
  if (!live.length) return null;
  let worst = null, worstRank = Infinity;
  for (const s of live) {
    const rank = EVIDENCE_QUALITY.indexOf(s.evidence_quality);
    if (rank === -1) continue;            // unknown quality is not evidence
    if (rank < worstRank) { worstRank = rank; worst = s.evidence_quality; }
  }
  return worst;
}

/**
 * Conditions a human should look at. This REPORTS divergence; it never
 * reconciles it. A superseded statement does not move, cancel or rewrite the
 * payment bound to the version a human actually authorized.
 */
function attentionFlags(payment, source, statement) {
  const flags = [];
  const p = payment || {}, src = source || {}, st = statement || {};

  if (st.status === 'superseded') flags.push('source_superseded');
  if (st.id && p.source_statement_id && String(st.id) !== String(p.source_statement_id)) {
    flags.push('source_statement_mismatch');
  }
  if (src.authorized_amount_hash && p.current_amount_hash
      && src.authorized_amount_hash !== p.current_amount_hash) {
    flags.push('amount_hash_mismatch');
  }
  if (p.disputed_at && !p.dispute_resolved_at) flags.push('in_dispute');

  const bal = balanceRemaining(p.authorized_amount, p.settlements);
  if (bal !== null && bal < 0) flags.push('overpaid');

  return flags;
}

/**
 * Validate a proposed transition. Returns { ok, state, errors }.
 * `state` is the state that WOULD result — derived, never taken from payload.
 */
function applyTransition(payment, action, payload) {
  const p = payment || {}, d = payload || {};
  const errors = [];
  const from = p.state;

  if (ACTIONS.indexOf(action) === -1) {
    return { ok: false, state: from, errors: ['unknown action: ' + action] };
  }
  if (!canTransition(from, action)) {
    errors.push('cannot ' + action + ' from state ' + from);
  }
  for (const f of requiredFields(action)) {
    if (d[f] === undefined || d[f] === null || d[f] === '') errors.push('missing required field: ' + f);
  }

  if (action === 'authorize'
      && d.amount_hash && p.authorized_amount_hash
      && d.amount_hash !== p.authorized_amount_hash) {
    errors.push('authorized amount hash mismatch');
  }
  if (action === 'record_settlement' && d.amount !== undefined && !(_num(d.amount) > 0)) {
    errors.push('settlement amount must be positive');
  }
  if (action === 'record_settlement' && d.evidence_quality
      && EVIDENCE_QUALITY.indexOf(d.evidence_quality) === -1) {
    errors.push('unknown evidence_quality: ' + d.evidence_quality);
  }
  if (action === 'issue' && d.method && METHODS.indexOf(d.method) === -1) {
    errors.push('unknown method: ' + d.method);
  }
  if (action === 'issue' && d.destination_label && String(d.destination_label).length > 60) {
    errors.push('destination_label exceeds 60 characters');
  }
  if (action === 'cancel' && amountSettled(p.settlements) > 0) {
    errors.push('cannot cancel a payment with recorded settlements — void them first');
  }

  if (errors.length) return { ok: false, state: from, errors };

  // ── The resulting state ──────────────────────────────────────────────────
  // Dispute actions return the state UNCHANGED. That is the whole reason they
  // are modelled apart from the six: a dispute is an attribute of a payment,
  // not a place in its lifecycle.
  if (DISPUTE_ACTIONS.indexOf(action) !== -1) return { ok: true, state: from, errors: [] };

  let next;
  switch (action) {
    case 'create':    next = 'draft'; break;
    case 'authorize': next = 'authorized'; break;
    case 'issue':     next = 'instructed'; break;
    case 'cancel':    next = 'cancelled'; break;
    case 'record_settlement': {
      const rows = liveSettlements(p.settlements).concat([{ amount: d.amount }]);
      next = deriveState(p.authorized_amount, rows);
      break;
    }
    case 'void_settlement': {
      const rows = liveSettlements(p.settlements)
        .filter(s => String(s.id) !== String(d.settlement_id));
      next = deriveState(p.authorized_amount, rows);
      break;
    }
    // Not 'next = from'. A silent no-op would make the dispute guard above
    // redundant, and a redundant guard is one a later edit can delete without
    // anything noticing. An action that reaches here is unhandled, which is a
    // bug in this file rather than a state to fall back to.
    default: throw new Error('unhandled state action: ' + action);
  }
  return { ok: true, state: next, errors: [] };
}

/** Fold an event log to a state, so a projection can be checked against it. */
function foldEvents(events) {
  const ordered = (events || []).slice().sort((a, b) =>
    String(a.server_ts || '').localeCompare(String(b.server_ts || '')));
  let state = null;
  for (const e of ordered) if (e && e.state_after) state = e.state_after;
  return state;
}

module.exports = {
  STATES, ACTIONS, STATE_ACTIONS, DISPUTE_ACTIONS,
  EVIDENCE_QUALITY, EVIDENCE_KINDS, METHODS, TRANSITIONS, REQUIRED_FIELDS,
  canTransition, requiredFields, liveSettlements, amountSettled, balanceRemaining,
  deriveState, verificationFloor, attentionFlags, applyTransition, foldEvents,
};
