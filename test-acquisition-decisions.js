'use strict';
/**
 * test-acquisition-decisions.js — Acquisition Review Phase 1, P1-4, P4-3.
 *
 *   node test-acquisition-decisions.js
 *
 * P4-1 recorded what each document says. P4-2 resolved a family of those into
 * terms with a state each. P4-3 is the human half: the append-only decision
 * history, the four acts, and the screen they happen on.
 *
 * Almost everything here is a rule about NOT destroying something. A decision
 * lays over the AI reading; it never replaces it. A rejection keeps what the
 * document said. A correction records what it replaced. Reopening removes a
 * conclusion without removing the history of having reached it. Each of those
 * fails silently if it breaks — the screen still works, it has just quietly
 * lost the evidence — so each gets its own assertion.
 *
 * The eight points the increment was asked to prove are called out by name
 * below, in the order they were given.
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const ROOT = __dirname;
const T    = require('./acquisition-terms.js');
const AD   = require('./acquisition-documents.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok  = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq  = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const deq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m || ''} expected ${y}, got ${x}`); };
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }
function code(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join('\n');
}
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function ' + name + ' not found');
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j === -1 ? undefined : j + 2);
}
function loadLI() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lease-intelligence.js'), 'utf8'), sb, { filename: 'lease-intelligence.js' });
  return sb.window.LeaseIntelligence;
}
const LI = loadLI();
const S  = code('script.js');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const M026 = code('migrations/026_acquisition_term_decisions.sql');

let _seq = 0;
const E = (value, quote, page, confidence) => ({
  value: value === undefined ? null : value,
  quote: quote || null, page: page == null ? null : page,
  confidence: confidence == null ? null : confidence,
});
function doc(over, fields) {
  return Object.assign({
    id: 'doc-' + (++_seq), file_name: 'lease.pdf', doc_type: 'original_lease',
    doc_type_status: 'confirmed', doc_date: '2023-03-01', superseded_by_document_id: null,
    abstraction_status: 'success',
  }, over, { abstracted_fields: { schemaVersion: 1, model: 'm', at: 'x', fields: fields || {} } });
}
const resolve = (docs, decisions) => T.resolveFamilyTerms(docs, decisions || [], { reasoner: LI });
const decision = (over) => Object.assign({
  id: 'dec-' + (++_seq), review_id: 'rev', family_id: 'fam', field_key: 'cap', action: 'confirm',
  previous_value: null, new_value: null, source_document_id: null, source_quote: null, source_page: null,
  decided_by: 'u1', decided_at: '2026-09-22T10:00:00Z', note: null, created_at: '2026-09-22T10:00:00Z',
}, over);

console.log('\n══ Acquisition term decisions — P1-4 / P4-3 ══');

// ── the migration, as text ──────────────────────────────────────────────────
sec('migration 026 (executed by tools/verify-migration-026.js)');

t('the table carries exactly the columns the approved plan named', () => {
  for (const c of ['review_id', 'user_id', 'family_id', 'field_key', 'action', 'previous_value',
                   'new_value', 'source_document_id', 'source_quote', 'source_page',
                   'decided_by', 'decided_at', 'note', 'created_at']) {
    ok(new RegExp('^\\s+' + c + '\\s', 'm').test(M026), c + ' is not in the table');
  }
});

t('the four actions are the only four', () => {
  ok(/action in \('confirm', 'correct', 'reject', 'reopen'\)/.test(M026));
  deq(T.DECISION_ACTIONS, ['confirm', 'correct', 'reject', 'reopen']);
});

t('append-only is a trigger, not a convention', () => {
  ok(/before update on public\.acquisition_term_decisions/.test(M026));
  ok(/before delete on public\.acquisition_term_decisions/.test(M026));
  ok(/append-only: UPDATE is refused/.test(M026));
  ok(/append-only: DELETE is refused/.test(M026));
});

t('and it is narrow enough that the database’s own cascades still work', () => {
  // The first version refused every UPDATE and DELETE, which made a family or
  // a review undeletable once one decision existed. Executing it is what found
  // that; this pins the fix.
  ok(/new\.decided_by\s*=\s*old\.decided_by/.test(M026), 'the actor is not pinned across an update');
  ok(/new\.action\s*=\s*old\.action/.test(M026), 'the action is not pinned across an update');
  ok(/exists \(select 1 from public\.acquisition_reviews where id = old\.review_id\)/.test(M026),
     'a delete is not discriminated by whether the review survives');
});

t('a decision cannot name somebody else as its author', () => {
  ok(/decided_by is distinct from new\.user_id/.test(M026));
  ok(/decided_by\s+uuid\s+not null/.test(M026));
  ok(/decided_at\s+timestamptz not null default now\(\)/.test(M026));
});

t('every key is composite on the owner, and RLS is owner-only with no anon policy', () => {
  for (const fk of ['review_id, user_id', 'family_id, user_id', 'source_document_id, user_id']) {
    ok(M026.indexOf('foreign key (' + fk + ')') >= 0, fk);
  }
  ok(/enable row level security/.test(M026));
  ok(/acq_term_decisions_owner_all/.test(M026) && /user_id = auth\.uid\(\)/.test(M026));
  ok(!/to anon/.test(M026), 'a policy names anon');
});

t('D-17 widens the relationship check rather than replacing its meaning', () => {
  ok(/relationship_status in \('proposed', 'confirmed', 'needs_review'\)/.test(M026));
  deq(AD.RELATIONSHIPS.length > 0 && AD.CONFIRMED_STATUSES, ['confirmed', 'corrected']);
});

t('the rollback says what it destroys and refuses to narrow D-17 under live rows', () => {
  const R = code('migrations/026_acquisition_term_decisions_rollback.sql');
  ok(/WHAT THIS DESTROYS/.test(fs.readFileSync(path.join(ROOT, 'migrations/026_acquisition_term_decisions_rollback.sql'), 'utf8')));
  ok(/drop table if exists public\.acquisition_term_decisions/.test(R));
  ok(/needs_review/.test(R) && /D-17 NOT reverted/.test(R));
  ok(!/abstracted_fields/.test(R), 'the rollback touches the AI evidence');
});

// ── 1 · the classification gate ─────────────────────────────────────────────
sec('1 · Confirm is blocked until the document is confirmed or corrected');

const gated = (status) => doc({ doc_type_status: status }, { cap: E(4, 'capped at 4%', 3, 0.9) });
const payload = (fields, term) => T.buildDecisionPayload('rev', 'u1', fields, term);

t('a term from an unclassified or proposed document cannot be confirmed', () => {
  for (const st of ['unclassified', 'proposed']) {
    const term = resolve([gated(st)]).terms.cap;
    eq(term.canConfirm, false, st);
    const r = payload({ fieldKey: 'cap', action: 'confirm' }, term);
    ok(!r.ok, st + ': a confirmation was accepted');
    ok(/Confirm or correct the document type first/.test(r.error), r.error);
  }
});

t('nor corrected', () => {
  const term = resolve([gated('proposed')]).terms.cap;
  const r = payload({ fieldKey: 'cap', action: 'correct', newValue: '5' }, term);
  ok(!r.ok, 'a correction was accepted');
});

t('but it CAN be rejected or reopened — those need no agreement about the document', () => {
  const term = resolve([gated('proposed')]).terms.cap;
  ok(payload({ fieldKey: 'cap', action: 'reject' }, term).ok);
  ok(payload({ fieldKey: 'cap', action: 'reopen' }, term).ok);
});

t('once the document is confirmed or corrected, Confirm is allowed', () => {
  for (const st of ['confirmed', 'corrected']) {
    const term = resolve([gated(st)]).terms.cap;
    eq(term.canConfirm, true, st);
    ok(payload({ fieldKey: 'cap', action: 'confirm' }, term).ok, st);
  }
});

t('the gate is enforced in the module, not only by a disabled button', () => {
  const src = code('acquisition-terms.js');
  ok(/if \(!term\.canConfirm\)/.test(src), 'buildDecisionPayload does not check the ceiling');
  const B = fnBody(src, 'buildDecisionPayload');
  ok(/action === 'confirm' \|\| payload\.action === 'correct'/.test(B));
});

t('and the button is disabled with the reason on it', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/const gate = term\.canConfirm \? '' : ' disabled';/.test(R), 'the controls are never disabled');
  ok(/gateTitle/.test(R) && /blockedReason/.test(R), 'the reason is not shown');
  ok(/acq-term-blocked/.test(R), 'the blocked reason has no row of its own');
  const Bind = fnBody(S, '_acqBindTermControls');
  ok(/if \(!btn \|\| btn\.disabled\) return;/.test(Bind), 'a disabled control still fires its handler');
});

// ── 2 · a correction preserves what it replaced ─────────────────────────────
sec('2 · Correct preserves the previous AI value and its evidence');

const CONFIRMABLE = doc({ id: 'C1', doc_type_status: 'confirmed' }, { cap: E(4, 'capped at 4%', 3, 0.9) });

t('the payload records previous_value automatically when the caller omits it', () => {
  const term = resolve([CONFIRMABLE]).terms.cap;
  const r = payload({ fieldKey: 'cap', action: 'correct', newValue: '5' }, term);
  ok(r.ok, r.error);
  eq(r.payload.previous_value, '4', 'the value being replaced was not recorded');
  eq(r.payload.new_value, '5');
});

t('a correction never writes to the document — the AI reading is left alone', () => {
  const docs = [CONFIRMABLE];
  const before = JSON.stringify(docs);
  const r = resolve(docs, [decision({ action: 'correct', new_value: '5', source_quote: 'the cap is 5%' })]);
  eq(r.terms.cap.value, 5);
  eq(JSON.stringify(docs), before, 'resolving with a correction mutated the documents');
  eq(docs[0].abstracted_fields.fields.cap.value, 4, 'the document no longer says what it said');
  eq(docs[0].abstracted_fields.fields.cap.quote, 'capped at 4%');
});

t('the term still names the decision and the person behind it', () => {
  const r = resolve([CONFIRMABLE], [decision({ action: 'correct', new_value: '5', source_quote: 'the cap is 5%' })]);
  eq(r.terms.cap.decision.action, 'correct');
  eq(r.terms.cap.decision.decidedBy, 'u1');
  eq(r.terms.cap.state, 'verified');
});

t('the data layer records the previous value explicitly too', () => {
  const C = fnBody(S, 'acqCorrectTerm');
  ok(/previousValue: term\.value == null \? undefined : String\(term\.value\)/.test(C),
     'the correction does not carry the value it replaces');
  ok(/action: 'correct'/.test(C));
});

// ── 3 · a rejection keeps the evidence ──────────────────────────────────────
sec('3 · Reject does not erase the source evidence');

t('the reading and its clause survive a rejection', () => {
  const r = resolve([CONFIRMABLE], [decision({ action: 'reject' })]);
  eq(r.terms.cap.value, 4, 'the reading was deleted');
  eq(r.terms.cap.quote, 'capped at 4%', 'the clause was deleted');
  eq(r.terms.cap.governingDocumentId, 'C1', 'the provenance was deleted');
});

t('but it stops reading as an answer', () => {
  const r = resolve([CONFIRMABLE], [decision({ action: 'reject' })]);
  eq(r.terms.cap.state, 'unclear');
  ok(/rejected this reading/.test(r.terms.cap.note), r.terms.cap.note);
});

t('and the document is untouched', () => {
  const docs = [CONFIRMABLE];
  const before = JSON.stringify(docs);
  resolve(docs, [decision({ action: 'reject' })]);
  eq(JSON.stringify(docs), before);
});

t('the data layer never writes abstraction columns when recording a decision', () => {
  const D = fnBody(S, '_acqSaveDecision');
  for (const bad of ['abstractedFields', 'abstraction_status', '_acqSaveDocument', 'abstractionStatus']) {
    ok(D.indexOf(bad) === -1, '_acqSaveDecision reaches ' + bad);
  }
  ok(/\.insert\(built\.payload\)/.test(D), 'a decision is not an INSERT');
  ok(!/upsert|update\(/.test(D), 'a decision is written with an update');
});

// ── 4 · reopening ───────────────────────────────────────────────────────────
sec('4 · Reopen returns the term to unresolved without deleting history');

const HISTORY = [
  decision({ action: 'confirm', decided_at: '2026-09-22T10:00:00Z' }),
  decision({ action: 'correct', new_value: '9', source_quote: 'the cap is 9%', previous_value: '4', decided_at: '2026-09-22T11:00:00Z' }),
  decision({ action: 'reopen',  decided_at: '2026-09-22T12:00:00Z' }),
];

t('after a reopen the term reads as the documents say, not as the correction said', () => {
  const r = resolve([CONFIRMABLE], HISTORY);
  eq(r.terms.cap.state, 'ai_extracted');
  eq(r.terms.cap.value, 4);
  eq(r.terms.cap.decision, null, 'a reopened term still reports a decision in force');
});

t('the history is still all there — reopening adds a row, it does not remove any', () => {
  eq(HISTORY.length, 3);
  eq(T.latestDecision(HISTORY, 'cap'), null, 'the reopen is not the decision in force');
  eq(HISTORY.filter(d => d.action === 'correct').length, 1, 'the correction was removed from history');
  eq(HISTORY.filter(d => d.action === 'confirm').length, 1);
});

t('a decision made AFTER a reopen takes effect again', () => {
  const r = resolve([CONFIRMABLE], HISTORY.concat([
    decision({ action: 'confirm', decided_at: '2026-09-22T13:00:00Z' })]));
  eq(r.terms.cap.state, 'verified');
});

t('reopen is recorded as an act, with its own actor and time', () => {
  const r = payload({ fieldKey: 'cap', action: 'reopen' }, resolve([CONFIRMABLE]).terms.cap);
  ok(r.ok);
  eq(r.payload.action, 'reopen');
  eq(r.payload.decided_by, 'u1');
  ok(/^\d{4}-\d{2}-\d{2}T/.test(r.payload.decided_at));
});

// ── 5 · contradictions ──────────────────────────────────────────────────────
sec('5 · a contradiction shows the competing values and documents');

const A1 = doc({ id: 'A1', file_name: 'amd-a.pdf', doc_type: 'amendment', doc_date: '2024-05-01' }, { cap: E(5, 'the cap is 5%') });
const A2 = doc({ id: 'A2', file_name: 'amd-b.pdf', doc_type: 'amendment', doc_date: '2024-05-01' }, { cap: E(7, 'the cap is 7%') });

t('the term carries both values and both file names', () => {
  const term = resolve([A1, A2]).terms.cap;
  eq(term.state, 'conflicting');
  deq(term.contradictions[0].values.map(String).sort(), ['5', '7']);
  deq(term.contradictions[0].documents.slice().sort(), ['amd-a.pdf', 'amd-b.pdf']);
});

t('the screen renders both, and says nothing was chosen', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/acq-term-conflict/.test(R));
  ok(/Documents disagree/.test(R), 'the conflict is not named on screen');
  ok(/Nothing has been chosen for you/.test(R), 'the screen does not say it declined to choose');
  ok(/c\.values/.test(R) && /c\.documents/.test(R), 'the competing values and documents are not rendered');
});

t('a decision settles the state but the contradiction stays on the record', () => {
  const r = resolve([A1, A2], [decision({ action: 'correct', new_value: '5', source_quote: 'the cap is 5%' })]);
  eq(r.terms.cap.state, 'verified');
  ok(r.terms.cap.contradictions.length > 0, 'the contradiction was erased by a decision');
});

// ── 6 · missing stays missing ───────────────────────────────────────────────
sec('6 · Missing remains explicitly missing');

t('a term no document establishes is listed, not hidden, and reads as a sentence', () => {
  const r = resolve([CONFIRMABLE]);
  eq(r.terms.co_tenancy.state, 'missing');
  eq(r.terms.co_tenancy.value, null);
  const R = fnBody(S, '_renderAcqTerms');
  ok(/No document on file establishes this/.test(R), 'the missing row has no words');
  ok(/acq-term-missing/.test(R));
});

t('a missing term offers no Confirm and no Correct — there is nothing to confirm', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/const actionable = term\.state !== 'missing';/.test(R));
  const r = payload({ fieldKey: 'co_tenancy', action: 'confirm' }, resolve([CONFIRMABLE]).terms.co_tenancy);
  ok(!r.ok && /nothing to confirm/.test(r.error), JSON.stringify(r));
});

t('the renderer never turns a null into 0, false or a blank', () => {
  const V = fnBody(S, '_acqTermValue');
  ok(/if \(v === null \|\| v === undefined\) return null;/.test(V), 'null is not short-circuited first');
  ok(V.indexOf('|| 0') === -1 && V.indexOf("|| ''") === -1, 'a falsy value is coerced');
});

t('an explicit negative is still a value, and reads as one', () => {
  const r = resolve([doc({ doc_type_status: 'confirmed' },
    { cap: E(0, 'There shall be no cap on Operating Expenses.', 4, 0.9),
      audit_rights: E(false, 'Tenant waives any right to audit.', 9, 0.9) })]);
  eq(r.terms.cap.state, 'ai_extracted');
  eq(r.terms.cap.value, 0);
  eq(r.terms.audit_rights.value, false);
  ok(r.terms.cap.state !== 'missing' && r.terms.audit_rights.state !== 'missing');
});

// ── 7 · the derived figure ──────────────────────────────────────────────────
sec('7 · a calculated figure is never shown as though the clause stated it');

const DERIVED = doc({ id: 'SR', file_name: 'ShopRite.pdf', doc_type: 'renewal', doc_type_status: 'corrected' }, {
  base_rent: E(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.', 3, 0.95),
});

t('the term is unclear and flagged derived, with the clause kept', () => {
  const term = resolve([DERIVED]).terms.base_rent;
  eq(term.state, 'unclear');
  eq(term.derived, true);
  eq(term.value, 1202500);
  eq(term.quote, 'Tenant agrees to pay base rent of $18.50 per square foot annually.');
});

t('the screen says so in words, beside the value', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/acq-term-derived/.test(R));
  ok(/Calculated, not quoted/.test(R), 'the derived warning has no words');
  ok(/term\.derived/.test(R), 'the renderer never reads the derived flag');
  ok(/data-derived/.test(R), 'a test cannot see the derived state from the DOM');
});

t('it is still confirmable, because a person may vouch for the arithmetic', () => {
  const term = resolve([DERIVED]).terms.base_rent;
  eq(term.canConfirm, true);
  ok(payload({ fieldKey: 'base_rent', action: 'confirm' }, term).ok);
});

t('and a correction clears the flag, because then a person stands behind it', () => {
  const r = resolve([DERIVED], [decision({ field_key: 'base_rent', action: 'correct',
    new_value: '1202500', source_quote: 'annual base rent of $1,202,500' })]);
  eq(r.terms.base_rent.derived, false);
  eq(r.terms.base_rent.state, 'verified');
});

// ── 8 · an auditable actor and timestamp ────────────────────────────────────
sec('8 · every decision has an actor and a time');

t('the payload always names the signed-in user, whatever the caller asked for', () => {
  const term = resolve([CONFIRMABLE]).terms.cap;
  const r = payload({ fieldKey: 'cap', action: 'confirm', decidedBy: 'somebody-else' }, term);
  eq(r.payload.decided_by, 'u1', 'a caller set the actor');
  eq(r.payload.user_id, 'u1');
});

t('and always carries a timestamp', () => {
  const r = payload({ fieldKey: 'cap', action: 'confirm' }, resolve([CONFIRMABLE]).terms.cap);
  ok(/^\d{4}-\d{2}-\d{2}T/.test(r.payload.decided_at));
});

t('the database refuses a row that names anybody else', () => {
  ok(/decided_by is distinct from new\.user_id/.test(M026));
});

t('the data layer takes the actor from the session, never from the form', () => {
  const D = fnBody(S, '_acqSaveDecision');
  ok(/const \{ data: \{ user \} \} = await db\.auth\.getUser\(\)/.test(D));
  ok(/buildDecisionPayload\(reviewId, user\.id, fields, term\)/.test(D));
  // The review is captured before sign-in is awaited — a person who opens
  // another review meanwhile must not have the decision filed against it.
  ok(D.indexOf('const reviewId = _activeAcqId;') >= 0
     && D.indexOf('const reviewId = _activeAcqId;') < D.indexOf('await db.auth.getUser()'));
});

t('the resolver surfaces the actor and time on the term', () => {
  const r = resolve([CONFIRMABLE], [decision({ action: 'confirm', decided_at: '2026-09-22T10:00:00Z' })]);
  eq(r.terms.cap.decision.decidedBy, 'u1');
  eq(r.terms.cap.decision.decidedAt, '2026-09-22T10:00:00Z');
});

// ── the write contract ──────────────────────────────────────────────────────
sec('the decision write contract');

t('user_id comes from the session and an unknown key is dropped', () => {
  const term = resolve([CONFIRMABLE]).terms.cap;
  const r = payload({ fieldKey: 'cap', action: 'confirm', userId: 'evil', reviewId: 'other', id: 'x', evil: 1 }, term);
  eq(r.payload.user_id, 'u1');
  eq(r.payload.review_id, 'rev');
  ok(!('id' in r.payload) && !('evil' in r.payload));
});

t('a decision with no field or no action is refused', () => {
  const term = resolve([CONFIRMABLE]).terms.cap;
  ok(!payload({ action: 'confirm' }, term).ok);
  ok(!payload({ fieldKey: 'cap' }, term).ok);
  ok(!payload({ fieldKey: 'cap', action: 'delete' }, term).ok);
  ok(!T.buildDecisionPayload(null, 'u1', { fieldKey: 'cap', action: 'reject' }).ok);
  ok(!T.buildDecisionPayload('rev', null, { fieldKey: 'cap', action: 'reject' }).ok);
});

t('a correction with no value is refused, in the module and in the database', () => {
  const term = resolve([CONFIRMABLE]).terms.cap;
  ok(!payload({ fieldKey: 'cap', action: 'correct' }, term).ok);
  ok(!payload({ fieldKey: 'cap', action: 'correct', newValue: '   ' }, term).ok);
  ok(/action <> 'correct' or \(new_value is not null/.test(M026));
});

t('the quote is bounded to the same 600 characters P4-1 uses', () => {
  const term = resolve([CONFIRMABLE]).terms.cap;
  const r = payload({ fieldKey: 'cap', action: 'confirm', sourceQuote: 'x'.repeat(900) }, term);
  eq(r.payload.source_quote.length, 600);
  eq(T.QUOTE_MAX, 600);
});

t('a page is a positive integer or nothing', () => {
  const term = resolve([CONFIRMABLE]).terms.cap;
  eq(payload({ fieldKey: 'cap', action: 'confirm', sourcePage: 0 }, term).payload.source_page, null);
  eq(payload({ fieldKey: 'cap', action: 'confirm', sourcePage: 4 }, term).payload.source_page, 4);
});

t('the list asks for every column the table stores', () => {
  eq(T.DECISION_COLUMNS.length, 14);
  for (const c of ['action', 'previous_value', 'new_value', 'decided_by', 'decided_at', 'source_quote']) {
    ok(T.DECISION_COLUMNS.indexOf(c) >= 0, c);
  }
  eq(T.DECISION_SELECT, T.DECISION_COLUMNS.join(', '));
});

// ── the panel ───────────────────────────────────────────────────────────────
sec('the Lease Terms panel');

t('index.html carries the panel, after Documents', () => {
  const docsAt = HTML.indexOf('id="acqDocsList"');
  const termsAt = HTML.indexOf('id="acqTermsList"');
  ok(docsAt > 0 && termsAt > docsAt, `documents@${docsAt} terms@${termsAt}`);
  ok(/id="acqTermsCount"/.test(HTML));
});

t('a state chip exists for all five states', () => {
  for (const s of T.TERM_STATES) {
    ok(new RegExp(s + ':\\s*\\{ label').test(S), s + ' has no chip');
  }
  for (const cls of ['verified', 'ai', 'conflict', 'unclear', 'missing']) {
    ok(new RegExp('\\.acq-term-state\\.' + cls).test(HTML), cls + ' has no style');
  }
});

t('the panel is rendered whenever the documents are', () => {
  const R = fnBody(S, '_renderAcqDocuments');
  ok(/_renderAcqTerms\(\);/.test(R), 'the terms panel is never refreshed with the documents');
});

t('the decisions are loaded when a review is opened', () => {
  ok(/_acqLoadDecisions\(id\)/.test(S), 'decisions are never loaded');
  const L = fnBody(S, '_acqLoadDecisions');
  ok(/\.eq\('user_id', user\.id\)/.test(L), 'the read is not scoped to the owner');
  ok(/\.order\('decided_at', \{ ascending: true \}\)/.test(L), 'the history is not read in order');
});

t('the evidence column is fetched for the panel, and NOT added to the list select', () => {
  // The list deliberately leaves abstracted_fields behind (P4-1): 27 quoted
  // entries per row is the problem extracted_text already taught. The terms
  // panel is the one screen that needs it, so it asks for that column alone.
  ok(AD.LIST_COLUMNS.indexOf('abstracted_fields') === -1,
     'the evidence was pushed into every document list to make the panel work');
  const L = fnBody(S, '_acqLoadEvidence');
  ok(/select\('id, abstracted_fields'\)/.test(L), 'the evidence is not fetched by itself');
  ok(/\.eq\('user_id', user\.id\)/.test(L), 'the evidence read is not scoped to the owner');
  ok(!/upsert|insert|update\(/.test(L), 'the evidence read writes');
  ok(/_acqLoadEvidence\(id\)/.test(S), 'the evidence is never loaded when a review opens');
});

t('the resolver is handed the evidence without it being written into the cached row', () => {
  const F = fnBody(S, '_acqFamilyTerms');
  ok(/_acqEvidence\.has\(d\.id\)/.test(F), 'the evidence cache is never consulted');
  ok(/Object\.assign\(\{\}, d, \{ abstracted_fields: _acqEvidence\.get\(d\.id\) \}\)/.test(F),
     'the cached document row is mutated to carry the evidence');
});

t('a fresh abstraction updates the cache, so the panel does not need a reload', () => {
  const A = fnBody(S, '_acqAbstractDocument');
  ok(/_acqEvidence\.set\(saved\.id, built\.abstraction\)/.test(A),
     'a new reading is invisible to the terms panel until the next full load');
});

t('a missing migration 026 is reported rather than hidden', () => {
  ok(/026_acquisition_term_decisions\.sql/.test(S), 'the panel never names the migration');
  const L = fnBody(S, '_acqLoadDecisions');
  ok(/schemaGap\(error\)/.test(L));
});

t('the term row exposes its state and field for a test to read', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/data-field="\$\{esc\(field\)\}" data-state="\$\{esc\(term\.state\)\}"/.test(R));
});

t('every value the panel prints into HTML is escaped', () => {
  const R = fnBody(S, '_renderAcqTerms');
  // The counts go through textContent, which does not interpret markup at all,
  // so they are excluded by name rather than by hoping the regex misses them.
  const TEXT_CONTENT_ONLY = ['${totalVerified}', '${totalTerms}'];
  const interpolations = (R.match(/\$\{(?!esc\()[^}]*\}/g) || [])
    .filter(s => TEXT_CONTENT_ONLY.indexOf(s) === -1);
  const suspicious = interpolations.filter(s => !/^\$\{(field|fam\.id|st\.cls|term\.|s\.|rows|sub|sections|warn|valueHtml|src|quote|derived|conflict|superseded|decided|blocked|actions|gate|gateTitle|actionable)/.test(s));
  deq(suspicious, [], 'unescaped interpolation');
  ok(/countEl\.textContent = /.test(R), 'the counts are no longer set through textContent');
});

t('the phone layout gives the term its own line and the controls theirs', () => {
  ok(/@media \(max-width: 680px\)/.test(HTML));
  ok(/\.acq-term-actions \{ order: 4/.test(HTML), 'the controls do not wrap below on a phone');
  ok(/\.acq-term-main\s+\{ flex: 1 1 100%; \}/.test(HTML), 'the term does not take the full width on a phone');
  ok(/\.acq-term-row \{ display: flex; flex-wrap: wrap;/.test(HTML), 'the row cannot wrap');
});

// ── D-17 ────────────────────────────────────────────────────────────────────
sec('D-17 — a reclassified document keeps the relationship it had');

t('needs_review is in the document model’s vocabulary', () => {
  deq(AD.REL_STATUSES || [], ['proposed', 'confirmed', 'needs_review']);
  eq(AD.WRITABLE.relationship_status('needs_review'), 'needs_review');
  eq(AD.WRITABLE.relationship_status('maybe'), null);
});

t('correcting a document out of a lease family preserves its parent and relationship', () => {
  const Set = fnBody(S, 'acqSetDocType');
  ok(/relationshipStatus = 'needs_review'/.test(Set), 'the relationship is not flagged');
  ok(/fields\.parentDocumentId\s+= row\.parent_document_id;/.test(Set), 'the parent is not preserved');
  ok(!/fields\.parentDocumentId = null; fields\.relationship = null/.test(Set),
     'the relationship is still discarded');
});

t('and the change is recorded in the audit trail', () => {
  const Set = fnBody(S, 'acqSetDocType');
  ok(/action: 'needs_review', field: 'relationship'/.test(Set), 'nothing is appended to the history');
  ok(/actor: _acqActor\(\)/.test(Set));
});

t('the history entry keeps the action it was given — needs_review is not rewritten', () => {
  // classificationEntry normalises an unknown action to `proposed`. Until
  // `needs_review` was added to that list the trail recorded the OPPOSITE of
  // what happened, which the P1-3 walk is what caught.
  const e = AD.classificationEntry({ action: 'needs_review', field: 'relationship',
                                     from: 'proposed', to: 'needs_review', source: 'human' });
  eq(e.action, 'needs_review', 'the audit trail rewrote the act');
  eq(e.field, 'relationship');
  eq(AD.classificationEntry({ action: 'invented' }).action, 'proposed',
     'an unknown action is no longer normalised');
});

// ── boundaries ──────────────────────────────────────────────────────────────
sec('what P4-3 does not do');

t('the resolver is still pure — no network, no DOM, no storage', () => {
  const src = code('acquisition-terms.js');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'document.', 'localStorage', 'supabase', 'claudeFetch']) {
    ok(src.indexOf(bad) === -1, 'acquisition-terms.js reaches ' + bad);
  }
});

t('no new serverless function', () => {
  const handlers = fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f) && !/^_/.test(f));
  ok(handlers.length <= 12, handlers.length + ' handlers');
});

t('the lease extraction contract is untouched', () => {
  const tasks = require('./api/_claude-tasks.js').CLAUDE_TASKS;
  ok(!/cap_base_amount/.test(tasks.lease_extraction.system), 'lease_extraction changed');
  deq(Object.keys(tasks).sort(), ['acquisition_abstraction', 'category_classification', 'document_classification',
                                  'escrow_extraction', 'invoice_extraction', 'lease_extraction']);
});

t('the owner-operator reasoner is still reached the same way', () => {
  const li = code('lease-intelligence.js');
  ok(/function reasonMultiDocumentLease\(documents, options\) \{/.test(li));
  ok(!/acquisition_term_decisions|AcquisitionTerms/.test(li));
  const docs = [{ docType: 'original_lease', fileName: 'l.pdf', extractedFields: { cap: 4 }, quotes: { cap: 'q' } }];
  eq(LI.reasonMultiDocumentLease(docs).cap.currentValue, 4);
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
