// test-acquisition-term-safeguards.js
// ============================================================================
// Manual lease-term entry and the rules that resolve a term (Step C). Pure:
// the resolver, the payload builder, the projection, the matrix and the
// report model are run directly; the screen's code is read as source.
//
//   1  an invalid correction or entry is refused before anything is saved,
//      and a stored one is never shown as Verified with no value      (gap 1)
//   2  a rejected AI reading is kept — value, clause, document — and labelled
//      "Rejected by a person", but it is no term's value: not the matrix's,
//      the rent roll's, the analysis's, conversion's, the CSVs' or the
//      report's                                                       (gap 2)
//   3  a value a person entered stays theirs when a document later speaks
//      to the term: still entered, still the value, with what the document
//      now says beside it and a warning until the person decides     (gap 3)
//   4  a correction does not present the replaced reading's clause as the
//      support for the new value; the replaced reading is kept and named
//      as such                                                        (gap 4)
//   5  the inline editor's validation, the optional reason, "keep my value",
//      the decision history, the sources CSV's new columns
//   6  the screen: no prompt() or confirm(), the editor, the labels, the
//      freeze, every act through the one decision writer
//
// Run: node test-acquisition-term-safeguards.js
// ============================================================================
'use strict';
const fs = require('fs'), path = require('path');
global.window = global;
require('./decision-standing.js');
const AT = require('./acquisition-terms.js');
const AL = require('./acquisition-leasehold.js');
const LM = require('./acquisition-lease-matrix.js');
const AR = require('./acquisition-report.js');
const S = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

let pass = 0, fail = 0; const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { fail++; failures.push(name + ' — ' + e.message); console.log('  \x1b[31m✗\x1b[0m ' + name + '\n      ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m || 'expected true'); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }
function fnBody(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src); if (!m) return '';
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return src.slice(m.index, j + 1);
}

// ── fixtures: one confirmed lease that reads three terms ────────────────────
const LEASE = () => ({ id: 'd1', family_id: 'f1', file_name: 'Lease.pdf', doc_type: 'original_lease', doc_type_status: 'confirmed',
  abstraction_status: 'success', abstracted_fields: { fields: {
    end_date:  { value: '2030-12-31', quote: 'The term expires December 31, 2030.', page: 2, confidence: 0.9 },
    base_rent: { value: 1202500, quote: 'Annual base rent of $1,202,500.', page: 3, confidence: 0.9 },
    leased_sqft: { value: 65000, quote: 'The Premises contain 65,000 rentable square feet.', page: 1, confidence: 0.9 },
  } } });
const REASONER = { end_date: { currentValue: '2030-12-31', contradictions: [] },
                   base_rent: { currentValue: 1202500, contradictions: [] },
                   leased_sqft: { currentValue: 65000, contradictions: [] } };
let n = 0;
const dec = (field, action, extra) => Object.assign({ id: 'x' + (++n), family_id: 'f1', field_key: field, action,
  decided_by: 'u1', decided_at: '2026-10-02T00:00:' + String(10 + n).padStart(2, '0') + 'Z' }, extra || {});
const resolve = (decisions, docs, reasoner) => AT.resolveTerms(reasoner || REASONER, docs || [LEASE()], decisions || []);
const rowOf = (terms) => AL.tenantRowFor({ id: 'f1', label: 'Tenant' }, { ok: true, terms });

// ════════════════════════════════════════════════════════════════════════════
sec('1 · an invalid correction or entry is never saved, never Verified-and-empty');

t('a correction to a date the field cannot hold is refused by the payload builder', () => {
  const term = resolve().end_date;
  const p = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'end_date', action: 'correct', newValue: '12/31/2031' }, term);
  ok(p && p.ok === false, 'a malformed date correction was accepted: ' + JSON.stringify(p && p.payload));
});
t('a correction to money the field cannot hold is refused', () => {
  const term = resolve().base_rent;
  const p = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'base_rent', action: 'correct', newValue: '1.2 million' }, term);
  ok(p && p.ok === false, 'a malformed money correction was accepted');
});
t('an entry the field cannot hold is refused', () => {
  const docs = [LEASE()]; delete docs[0].abstracted_fields.fields.leased_sqft;
  const term = resolve([], docs).leased_sqft;
  eq(term.state, 'missing');
  const p = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'leased_sqft', action: 'correct', newValue: 'about 60k', entered: true }, term);
  ok(p && p.ok === false, 'a malformed entry was accepted');
});
t('a valid correction is accepted and stored in the field\'s own form', () => {
  const term = resolve().base_rent;
  const p = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'base_rent', action: 'correct', newValue: '$1,250,000' }, term);
  ok(p.ok, p.error); eq(p.payload.new_value, '1250000');
});
t('a stored correction the type cannot hold is never shown as Verified with no value', () => {
  const term = resolve([dec('end_date', 'correct', { new_value: '12/31/2031', source_document_id: 'd1' })]).end_date;
  ok(!(term.state === 'verified' && (term.value === null || term.value === undefined)),
     'Verified and empty: ' + JSON.stringify({ state: term.state, value: term.value }));
  eq(term.value, '2030-12-31', 'the document\'s reading should stand when the correction cannot be read');
  ok(term.decisionUnreadable === true, 'the unreadable correction is not flagged');
});

// ════════════════════════════════════════════════════════════════════════════
sec('2 · a rejected reading is kept, labelled, and used nowhere');

const rejected = () => resolve([dec('base_rent', 'reject', { previous_value: '1202500' })]).base_rent;
t('the rejected term has no value', () => { eq(rejected().value, null); });
t('the rejected reading is kept whole: its value, clause, page and document', () => {
  const r = rejected().rejectedReading;
  ok(r, 'no rejected reading kept');
  eq([r.value, r.quote, r.page, r.documentId, r.documentName], [1202500, 'Annual base rent of $1,202,500.', 3, 'd1', 'Lease.pdf']);
});
t('it is labelled "Rejected by a person"', () => { ok(/Rejected by a person/.test(rejected().note || ''), rejected().note); });
t('the projection the rent roll, analysis and conversion read gives it no value', () => {
  const row = rowOf(resolve([dec('base_rent', 'reject')]));
  eq(row.base_rent, null, 'the rejected value reaches the canonical row');
  eq(AL.canonicalValue(rejected()), null);
  ok(!(row.quotes || {}).base_rent, 'the rejected clause is still cited for the row');
});
t('the matrix cell says "Rejected by a person", not the value', () => {
  const c = LM.cellFor(rowOf(resolve([dec('base_rent', 'reject')])), 'base_rent');
  eq([c.value, c.text], [null, 'Rejected by a person']);
});
t('the matrix CSV writes "Rejected by a person", never the rejected figure', () => {
  const terms = resolve([dec('base_rent', 'reject')]);
  const m = LM.buildMatrix13([Object.assign(rowOf(terms), { _source: 'leasehold', _leaseholdId: 'f1' })], { f1: terms });
  const csv = LM.matrix13Csv(m);
  ok(/Rejected by a person/.test(csv) && !/1,202,500/.test(csv.split('\r\n')[1]), csv.split('\r\n')[1]);
});
t('the report has no value for it, and says why', () => {
  const f = AR.projectTerm(rejected());
  eq(f.value, null); ok(/Rejected by a person/.test(f.note || ''), f.note);
});
t('reopening a rejection brings the reading back, unchanged', () => {
  const t2 = resolve([dec('base_rent', 'reject'), dec('base_rent', 'reopen')]).base_rent;
  eq([t2.value, t2.quote, t2.state, !!t2.rejected], [1202500, 'Annual base rent of $1,202,500.', 'ai_extracted', false]);
});
t('correcting after a rejection records the rejected reading as what it replaced', () => {
  const term = rejected();
  const p = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'base_rent', action: 'correct', newValue: '1300000' }, term);
  ok(p.ok, p.error); eq(p.payload.previous_value, '1202500');
});

// ════════════════════════════════════════════════════════════════════════════
sec('3 · an entered value is never silently overwritten by a later reading');

const NO_SQFT = () => { const d = LEASE(); delete d.abstracted_fields.fields.leased_sqft; return d; };
const ENTERED = () => dec('leased_sqft', 'correct', { new_value: '60000', note: AT.ENTERED_NOTE });
t('entered on a term no document establishes: verified, entered, the value', () => {
  const term = resolve([ENTERED()], [NO_SQFT()]).leased_sqft;
  eq([term.state, term.support, term.value], ['verified', 'entered', 60000]);
});
t('after a re-read gives the term a different value, the entered value stands, still marked entered', () => {
  const term = resolve([ENTERED()]).leased_sqft;   // the lease now reads 65,000
  eq([term.value, term.support, term.state], [60000, 'entered', 'verified'], 'the entered value or its origin was lost');
});
t('what the document now says is kept beside it, with a warning', () => {
  const term = resolve([ENTERED()]).leased_sqft;
  ok(term.documentReading && term.documentReading.value === 65000 && term.documentReading.documentName === 'Lease.pdf',
     'the document\'s new reading is not kept: ' + JSON.stringify(term.documentReading));
  ok(term.enteredConflict === true, 'no warning');
});
t('the projection keeps the entered value and origin, and flags the conflict', () => {
  const row = rowOf(resolve([ENTERED()]));
  eq([row.leased_sqft, row._origins.leased_sqft, (row._flags || {}).leased_sqft], [60000, 'entered', 'entered_conflict']);
});
t('the record\'s workload lists it, until the person decides', () => {
  const row = rowOf(resolve([ENTERED()]));
  const groups = LM.attentionSummary(row);
  ok(groups.some(g => g.kind === 'entered_conflict' && g.terms.some(x => x.field === 'leased_sqft')), JSON.stringify(groups));
});
t('a document that agrees raises no warning', () => {
  const term = resolve([dec('leased_sqft', 'correct', { new_value: '65000', note: AT.ENTERED_NOTE })]).leased_sqft;
  eq([term.support, term.enteredConflict], ['entered', false]);
});
t('"Keep my value" over that reading clears the warning, and is itself a decision', () => {
  const term = resolve([ENTERED()]).leased_sqft;
  const p = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'leased_sqft', action: 'correct',
    newValue: '60000', entered: true, keep: true, reason: 'Measured by our surveyor' }, term);
  ok(p.ok, p.error);
  eq([p.payload.source_document_id, p.payload.previous_value], [null, '65000']);
  ok(/Measured by our surveyor/.test(p.payload.note) && p.payload.note.indexOf(AT.ENTERED_NOTE) === 0, p.payload.note);
  const kept = resolve([ENTERED(), Object.assign(dec('leased_sqft', 'correct'), p.payload)]).leased_sqft;
  eq([kept.value, kept.support, kept.enteredConflict, kept.enteredKept], [60000, 'entered', false, true]);
});
t('a later reading that differs again raises the warning again', () => {
  const docs = [LEASE()]; docs[0].abstracted_fields.fields.leased_sqft.value = 70000;
  const keep = dec('leased_sqft', 'correct', { new_value: '60000', previous_value: '65000', note: AT.ENTERED_NOTE });
  const term = AT.resolveTerms({ leased_sqft: { currentValue: 70000, contradictions: [] } }, docs, [ENTERED(), keep]).leased_sqft;
  eq([term.value, term.enteredConflict], [60000, true]);
});
t('reopening hands the term to the document\'s reading', () => {
  const term = resolve([ENTERED(), dec('leased_sqft', 'reopen')]).leased_sqft;
  eq([term.value, term.support, term.state], [65000, 'stated', 'ai_extracted']);
});

// ════════════════════════════════════════════════════════════════════════════
sec('4 · a correction names the reading it replaced, and does not cite it');

const corrected = () => resolve([dec('base_rent', 'correct', { new_value: '1250000', previous_value: '1202500', source_document_id: 'd1' })]).base_rent;
t('the corrected value carries no clause that states a different figure', () => {
  const term = corrected();
  eq(term.value, 1250000);
  ok(term.quote !== 'Annual base rent of $1,202,500.', 'the replaced reading\'s clause is shown as the new value\'s support');
});
t('the replaced reading is kept and named: its value, clause, page and document', () => {
  const r = corrected().replacedReading;
  ok(r, 'no replaced reading');
  eq([r.value, r.quote, r.page, r.documentName], [1202500, 'Annual base rent of $1,202,500.', 3, 'Lease.pdf']);
});
t('the projection does not cite the replaced clause for the corrected figure', () => {
  const row = rowOf(resolve([dec('base_rent', 'correct', { new_value: '1250000', source_document_id: 'd1' })]));
  eq(row.base_rent, 1250000);
  ok(!(row.quotes || {}).base_rent, 'the replaced clause is cited: ' + (row.quotes || {}).base_rent);
});
t('the record labels the old clause as the replaced reading', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/Replaced reading/.test(R) && /replacedReading/.test(R), 'the record does not label the replaced reading');
});

// ════════════════════════════════════════════════════════════════════════════
sec('5 · the editor\'s checks, the reason, the history, the sources CSV');

t('validateTermInput takes each type in its own form, and says what it needs otherwise', () => {
  const v = (f, x) => AT.validateTermInput(f, x);
  eq([v('base_rent', '$1,250,000').ok, v('base_rent', '$1,250,000').value, v('base_rent', '$1,250,000').stored], [true, 1250000, '1250000']);
  eq([v('end_date', '2031-12-31').ok, v('end_date', '2031-12-31').value], [true, '2031-12-31']);
  eq([v('cap', '5%').ok, v('cap', '5%').value], [true, 5]);
  eq(v('lease_type', 'nnn').value, 'NNN');
  ok(!v('end_date', '12/31/2031').ok && /not a date/.test(v('end_date', '12/31/2031').error));
  ok(!v('base_rent', '1.2 million').ok && /dollar amount/.test(v('base_rent', '1.2 million').error));
  ok(!v('lease_type', 'triple-ish').ok && /one of/.test(v('lease_type', 'triple-ish').error));
  const blank = v('base_rent', '   ');
  ok(!blank.ok && blank.empty === true, 'a blank value is not "empty"');
  ok(/enter 0/i.test(v('security_deposit', 'none').error), 'a "none" typed for a figure does not say how to record zero');
});
t('every stored form reads back as the same value', () => {
  [['base_rent', '$1,250,000'], ['end_date', '2031-12-31'], ['cap', '5%'], ['lease_type', 'gross'], ['leased_sqft', '12,500']].forEach(([f, x]) => {
    const r = AT.validateTermInput(f, x);
    eq(AT.normalizeFieldValue(f, r.stored, false), r.value, f);
  });
});
t('a reason is the decision\'s note; for an entry it follows the entered note', () => {
  const p1 = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'base_rent', action: 'correct', newValue: '1300000', reason: 'Per the estoppel' }, resolve().base_rent);
  eq(p1.payload.note, 'Per the estoppel');
  const docs = [LEASE()]; delete docs[0].abstracted_fields.fields.leased_sqft;
  const p2 = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'leased_sqft', action: 'correct', newValue: '60000', entered: true, reason: 'Site plan' }, resolve([], docs).leased_sqft);
  eq(p2.payload.note, AT.ENTERED_NOTE + ' Reason: Site plan');
  eq(AT.decisionReason(p2.payload.note), 'Site plan');
  eq(AT.decisionReason(AT.ENTERED_NOTE), null);
});
t('keep is refused where there is no document reading to keep a value over', () => {
  const docs = [LEASE()]; delete docs[0].abstracted_fields.fields.leased_sqft;
  const term = resolve([ENTERED()], docs).leased_sqft;
  const p = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'leased_sqft', action: 'correct', newValue: '60000', entered: true, keep: true }, term);
  ok(!p.ok, 'a keep with nothing to keep over was accepted');
});
t('the history lists every decision on the field, oldest first, the standing one marked', () => {
  const decs = [dec('base_rent', 'confirm', { previous_value: '1202500', source_document_id: 'd1' }),
                dec('base_rent', 'reject', { previous_value: '1202500' }),
                dec('base_rent', 'correct', { new_value: '1250000', previous_value: '1202500', source_document_id: 'd1', note: 'Per the estoppel' }),
                dec('end_date', 'reject')];
  const h = AT.decisionHistory(decs, 'base_rent');
  eq(h.map(x => x.kind), ['confirmed', 'rejected', 'corrected']);
  eq(h.map(x => x.standing), [false, false, true]);
  eq([h[2].newValue, h[2].previousValue, h[2].reason], [1250000, 1202500, 'Per the estoppel']);
  const k = AT.decisionHistory([ENTERED(), dec('leased_sqft', 'correct', { new_value: '60000', previous_value: '65000', note: AT.ENTERED_NOTE + ' Reason: x' })], 'leased_sqft');
  eq(k.map(x => x.kind), ['entered', 'kept']);
});
t('the sources CSV names the previous value, the origin and the reason', () => {
  eq(LM.PROVENANCE_HEADERS.slice(-3), ['Previous value', 'Origin', 'Reason']);
  const terms = resolve([dec('base_rent', 'correct', { new_value: '1250000', previous_value: '1202500', source_document_id: 'd1', note: 'Per the estoppel' }),
                         dec('end_date', 'reject')]);
  const m = LM.buildMatrix13([Object.assign(rowOf(terms), { _source: 'leasehold', _leaseholdId: 'f1' })], { f1: terms });
  const csv = LM.matrix13ProvenanceCsv(m);
  const rent = csv.split('\r\n').find(l => /,Base Rent,/.test(l)) || '';
  ok(/"?\$1,202,500 \(Lease\.pdf, p\. 3\)"?/.test(rent) && /Corrected by a person/.test(rent) && /Per the estoppel/.test(rent), rent);
  const exp = csv.split('\r\n').find(l => /,Lease Exp\.,/.test(l)) || '';
  ok(/Rejected by a person/.test(exp) && /12\/31\/2030/.test(exp), exp);
  const ent = rowOf(resolve([ENTERED()]));
  const m2 = LM.buildMatrix13([Object.assign(ent, { _source: 'leasehold', _leaseholdId: 'f1' })], { f1: resolve([ENTERED()]) });
  const sq = LM.matrix13ProvenanceCsv(m2).split('\r\n').find(l => /,Sq\. Ft\.,/.test(l)) || '';
  ok(/Entered by a person — a document now reads 65,000/.test(sq), sq);
});
t('the summary counts what was rejected and what conflicts', () => {
  const sm = AT.summarizeTerms(resolve([dec('base_rent', 'reject'), ENTERED()]));
  eq([sm.rejected, sm.enteredConflict], [1, 1]);
});

// ════════════════════════════════════════════════════════════════════════════
sec('6 · the screen: the editor, no browser dialogs, the freeze, one writer');

t('Correct, Enter and Keep ask in the inline editor — no prompt() or confirm()', () => {
  ['acqCorrectTerm', 'acqEnterTerm', 'acqKeepEnteredTerm', 'acqSubmitTermEditor', 'acqOpenTermEditor'].forEach(n => {
    const B = fnBody(S, n);
    ok(B, n + ' missing');
    ok(!/\bprompt\(|\bwindow\.confirm\(|[^.\w]confirm\(/.test(B.replace(/\/\/.*$/gm, '')), n + ' uses a browser dialog');
  });
  ok(/acqOpenTermEditor\(familyId, field, 'correct'\)/.test(fnBody(S, 'acqCorrectTerm')));
  ok(/acqOpenTermEditor\(familyId, field, 'keep'\)/.test(fnBody(S, 'acqKeepEnteredTerm')));
});
t('each act checks the value before writing, and writes through the one decision writer', () => {
  ['acqCorrectTerm', 'acqEnterTerm'].forEach(n => {
    const B = fnBody(S, n);
    const check = B.indexOf('validateTermInput('), write = B.indexOf('_acqSaveDecision(');
    ok(check > 0 && write > check, n + ': the value is not checked before the write');
  });
  ok(fnBody(S, 'acqKeepEnteredTerm').includes('_acqSaveDecision('));
  ok(!/\.update\(|\.delete\(|\.upsert\(/.test(fnBody(S, '_acqSaveDecision')), 'the decision writer does more than insert');
});
t('every act that asks for a value refuses a converted review before asking', () => {
  ['acqCorrectTerm', 'acqEnterTerm', 'acqKeepEnteredTerm', 'acqOpenTermEditor'].forEach(n => {
    const B = fnBody(S, n).replace(/\/\/.*$/gm, '');
    // (Past the function's own signature, which names acqOpenTermEditor too.)
    const g = B.indexOf('_acqRefuseFrozen('), o = B.indexOf('acqOpenTermEditor(familyId', B.indexOf('{')), a = B.indexOf('await ');
    ok(g !== -1 && (o === -1 || g < o) && (a === -1 || g < a), n + ': no freeze guard before asking or writing');
  });
});
t('the editor: a control for the type, a hint, an optional reason, a live preview, Save disabled until valid', () => {
  const H = fnBody(S, '_acqTermEditorHtml'), I = fnBody(S, '_acqTermInputHtml'), U = fnBody(S, '_acqTermEditorUpdate');
  ok(/type="date"/.test(I) && /<select/.test(I) && /inputmode="decimal"/.test(I) && /<textarea/.test(I), 'a type has no control');
  ok(/acq-te-hint/.test(H) && /Reason <span class="acq-te-opt">\(optional\)<\/span>/.test(H) && /acq-te-preview/.test(H) && /role="alert"/.test(H));
  ok(/save\.disabled = !v\.ok;/.test(U), 'Save is not tied to validity');
});
t('Escape closes the editor and focus returns to the control that opened it', () => {
  const B = fnBody(S, '_acqBindTermControls'), C = fnBody(S, 'acqCancelTermEditor');
  ok(/ev\.key !== 'Escape'/.test(B) && /acqCancelTermEditor\(\)/.test(B));
  ok(/\.acq-term-enter/.test(C) && /\.acq-term-keep/.test(C) && /\.acq-term-correct/.test(C) && /b\.focus\(\)/.test(C));
});
t('the record labels each set-aside reading and offers Keep only on a conflict', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/'Rejected reading'/.test(R) && /'Replaced reading'/.test(R) && /The document now reads/.test(R));
  ok(/const keep = term\.enteredConflict/.test(R));
  ok(/term\.rejected \? '' : `<button class="acq-term-reject"/.test(R), 'a rejected term can be rejected again');
});
t('the matrix\'s sources panel names the reading a person set aside', () => {
  const D = fnBody(S, '_acqM13DetailHtml');
  ok(/Replaced reading — corrected by a person/.test(D) && /Rejected reading — set aside by a person, not used/.test(D) && /A document now reads this differently/.test(D));
});

// ════════════════════════════════════════════════════════════════════════════
sec('7 · the Acquisition Report names the replaced reading, apart from the evidence');

const vm = require('vm');
const AV = require('./acquisition-report-view.js');
function loadLI() {
  const sb = { window: {}, console }; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8'), sb, { filename: 'lease-intelligence.js' });
  return sb.window.LeaseIntelligence;
}
const WIRE = { terms: AT, reasoner: loadLI() };
const REPORT_DOC = () => Object.assign(LEASE(), { family_status: 'confirmed', doc_date: '2024-03-01', storage_path: 'leases/u/x.pdf' });
const reportFor = (decisions) => {
  const model = AR.buildReport({ name: 'Test', data: {} }, [{ id: 'f1', label: 'Tenant' }], [REPORT_DOC()], decisions, WIRE);
  return { model, html: AV.renderReport(model, { linkFor: (p, n) => AV.esc(n), typeLabel: (t) => t }) };
};
const rowsByKey = (html, key) => (html.match(new RegExp('<tr class="acqr-fact" data-key="' + key + '"[\\s\\S]*?</tr>', 'g')) || []);
const CORR = () => [dec('base_rent', 'correct', { new_value: '1250000', previous_value: '1202500', source_document_id: 'd1', note: 'Per the estoppel' })];

t('the report\'s fact for a corrected term carries the replaced reading — value, document, page, clause', () => {
  const f = AR.projectTerm(corrected());
  ok(f.replaced, 'no replaced reading on the fact');
  eq([f.value, f.replaced.value, f.replaced.documentName, f.replaced.page, f.replaced.quote],
     [1250000, 1202500, 'Lease.pdf', 3, 'Annual base rent of $1,202,500.']);
});
t('and its evidence is not the replaced clause — the document\'s reading is not the support for the corrected value', () => {
  const f = AR.projectTerm(corrected());
  ok(!f.evidence || !f.evidence.quote, 'the replaced clause is still the evidence: ' + JSON.stringify(f.evidence));
});
t('the report as drawn: the corrected value, and the replaced reading labelled as such', () => {
  const rows = rowsByKey(reportFor(CORR()).html, 'base_rent');
  ok(rows.length >= 1, 'no base rent row');
  rows.forEach(r => {
    ok(/<span class="acqr-value">\$1,250,000<\/span>/.test(r), 'the corrected value is not the value: ' + r.slice(0, 200));
    ok(/class="acqr-replaced"/.test(r) && /Replaced reading/.test(r) && /\$1,202,500/.test(r) && /Annual base rent of \$1,202,500\./.test(r), 'the replaced reading is not drawn');
  });
});
t('the replaced reading is drawn apart from the evidence, and is never introduced as the "Source"', () => {
  rowsByKey(reportFor(CORR()).html, 'base_rent').forEach(r => {
    const ev = (r.match(/<div class="acqr-evidence"[\s\S]*?<\/div>/) || [''])[0];
    ok(!/1,202,500/.test(ev), 'the replaced reading sits inside the evidence block: ' + ev);
    ok(/not the support for this value/.test(r), 'the replaced reading does not say it is not the support');
  });
});
t('a rejected reading is drawn as rejected, not as a value', () => {
  const rows = rowsByKey(reportFor([dec('base_rent', 'reject', { previous_value: '1202500' })]).html, 'base_rent');
  rows.forEach(r => {
    ok(!/<span class="acqr-value">/.test(r), 'the rejected reading is drawn as the value');
    ok(/class="acqr-rejected"/.test(r) && /Rejected reading/.test(r) && /\$1,202,500/.test(r), 'the rejected reading is not drawn');
  });
});
t('a correction that quotes the very clause it replaces is not supported by it: no clause, no page, no Source in the report', () => {
  const same = [dec('base_rent', 'correct', { new_value: '1250000', previous_value: '1202500', source_document_id: 'd1',
                                              source_quote: 'Annual base rent of $1,202,500.', source_page: 3 })];
  const term = resolve(same).base_rent;
  eq([term.value, term.quote, term.page, term.replacedReading && term.replacedReading.quote],
     [1250000, null, null, 'Annual base rent of $1,202,500.']);
  ok(!(rowOf(resolve(same)).quotes || {}).base_rent, 'the projection cites the replaced clause');
  const rows = rowsByKey(reportFor(same).html, 'base_rent');
  ok(rows.length >= 1, 'no base rent row');
  rows.forEach(r => {
    ok(!/class="acqr-evidence"/.test(r), 'a Source block supports $1,250,000 with the $1,202,500 clause: ' + r.slice(0, 300));
    ok(/class="acqr-replaced"/.test(r) && /\$1,202,500/.test(r), 'the replaced reading is not drawn');
  });
});
t('a correction that quotes its OWN clause keeps it as the Source, and the replaced reading stays apart', () => {
  const own = [dec('base_rent', 'correct', { new_value: '1250000', previous_value: '1202500', source_document_id: 'd1',
                                             source_quote: 'Base rent is amended to $1,250,000.', source_page: 4 })];
  const term = resolve(own).base_rent;
  eq([term.value, term.quote, term.page], [1250000, 'Base rent is amended to $1,250,000.', 4]);
  rowsByKey(reportFor(own).html, 'base_rent').forEach(r => {
    const ev = (r.match(/<div class="acqr-evidence"[\s\S]*?<\/div>/) || [''])[0];
    ok(/Source:/.test(ev) && /amended to \$1,250,000/.test(ev), 'the correction\'s own clause is not the Source: ' + ev);
    ok(!/1,202,500/.test(ev), 'the replaced reading is inside the evidence');
    ok(/class="acqr-replaced"/.test(r) && /Annual base rent of \$1,202,500\./.test(r), 'the replaced reading is not drawn');
  });
});
t('a term nobody corrected draws no replaced reading', () => {
  rowsByKey(reportFor([]).html, 'base_rent').forEach(r => ok(!/acqr-replaced|acqr-rejected/.test(r)));
});

// ════════════════════════════════════════════════════════════════════════════
sec('8 · zero and "none", by field type');

const V = (f, x) => AT.validateTermInput(f, x);
t('money: a typed zero is a value — "$0", never missing', () => {
  ['0', '$0', '0.00', '$0.00'].forEach(x => { const r = V('security_deposit', x); ok(r.ok && r.value === 0 && r.stored === '0', x + ' → ' + JSON.stringify(r)); });
});
t('percent: a typed zero is a value — "0%"', () => {
  ['0', '0%'].forEach(x => { const r = V('cap', x); ok(r.ok && r.value === 0, x + ' → ' + JSON.stringify(r)); });
});
t('a count that cannot be zero: a leased area of 0 is refused, and says why', () => {
  const r = V('leased_sqft', '0'); ok(!r.ok && /greater than zero/.test(r.error), JSON.stringify(r));
});
t('no figure may be negative', () => {
  ['security_deposit', 'cap', 'leased_sqft', 'base_rent'].forEach(f => ok(!V(f, '-5').ok && !V(f, '(5)').ok, f));
});
t('a figure cannot be "none": the person is told to enter 0', () => {
  ['none', 'None', 'no', 'n/a', 'nil', 'zero'].forEach(x => { const r = V('security_deposit', x); ok(!r.ok && /enter 0/i.test(r.error), x + ' → ' + JSON.stringify(r)); });
});
t('a term that can be "None (stated)": a bare "None" asserts a clause, so a person cannot record it', () => {
  ['None', 'none', 'no', 'N/A'].forEach(x => { const r = V('percentage_rent', x); ok(!r.ok && /clause/.test(r.error), x + ' → ' + JSON.stringify(r)); });
});
t('…but may describe what they know, which is recorded as their text', () => {
  const r = V('percentage_rent', 'No percentage rent (per seller)'); ok(r.ok && r.value === 'No percentage rent (per seller)', JSON.stringify(r));
});
t('a yes/no term\'s "No" is still a value', () => { const r = V('audit_rights', 'no'); ok(r.ok && r.value === false, JSON.stringify(r)); });
const NO_DEP = () => { const d = LEASE(); return d; };   // the lease says nothing about a deposit
t('an entered zero resolves to a verified, entered $0 — not missing, not unreadable', () => {
  const term = resolve([dec('security_deposit', 'correct', { new_value: '0', note: AT.ENTERED_NOTE })], [NO_DEP()]).security_deposit;
  eq([term.state, term.support, term.value, !!term.decisionUnreadable], ['verified', 'entered', 0, false]);
});
t('a corrected zero resolves to 0, verified', () => {
  const term = resolve([dec('base_rent', 'correct', { new_value: '0', previous_value: '1202500', source_document_id: 'd1' })]).base_rent;
  eq([term.state, term.value], ['verified', 0]);
});
t('the payload builder takes the same zero, and refuses the same words', () => {
  const missing = resolve([], [NO_DEP()]).security_deposit;
  const p0 = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'security_deposit', action: 'correct', newValue: '$0', entered: true }, missing);
  ok(p0.ok && p0.payload.new_value === '0', JSON.stringify(p0));
  const pn = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'security_deposit', action: 'correct', newValue: 'none', entered: true }, missing);
  ok(!pn.ok, 'a "none" figure was accepted');
  const missingPct = AT.resolveTerms({}, [NO_DEP()], []).percentage_rent;
  const pp = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'percentage_rent', action: 'correct', newValue: 'None', entered: true }, missingPct);
  ok(!pp.ok, 'a bare "None" was entered with no clause');
});
t('a correction without a clause is a person\'s value: 0 is taken, "none" is refused with the way to record zero', () => {
  const term = resolve().base_rent;
  const p0 = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'base_rent', action: 'correct', newValue: '0', sourceDocumentId: 'd1' }, term);
  ok(p0.ok && p0.payload.new_value === '0', JSON.stringify(p0));
  const pn = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'base_rent', action: 'correct', newValue: 'none', sourceDocumentId: 'd1' }, term);
  ok(!pn.ok && /enter 0/i.test(pn.error), JSON.stringify(pn));
});
t('a correction that cites a clause is still checked against the field\'s type', () => {
  const term = resolve().end_date;
  const p = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'end_date', action: 'correct', newValue: 'the end of 2031',
                                                 sourceDocumentId: 'd1', sourceQuote: 'The term expires at the end of 2031.' }, term);
  ok(p && p.ok === false && /not a date/.test(p.error), 'a malformed quoted correction was accepted: ' + JSON.stringify(p));
  const good = AT.buildDecisionPayload('r1', 'u1', { familyId: 'f1', fieldKey: 'end_date', action: 'correct', newValue: '2031-12-31',
                                                    sourceDocumentId: 'd1', sourceQuote: 'The term expires December 31, 2031.' }, term);
  ok(good.ok && good.payload.new_value === '2031-12-31', JSON.stringify(good));
});
t('a zero is shown as $0 in the matrix, its CSV and the report — never as missing', () => {
  const terms = resolve([dec('base_rent', 'correct', { new_value: '0', previous_value: '1202500', source_document_id: 'd1' })]);
  const row = Object.assign(rowOf(terms), { _source: 'leasehold', _leaseholdId: 'f1' });
  eq(AL.canonicalValue(terms.base_rent), 0);
  eq(row.base_rent, 0);
  const c = LM.cellFor(row, 'base_rent'); eq([c.state, c.text], ['verified', '$0']);
  const csv = LM.matrix13Csv(LM.buildMatrix13([row], { f1: terms })).split('\r\n')[1];
  ok(/\$0/.test(csv) && !/Not established/.test(csv.split(',')[3] || ''), csv);
  const f = AR.projectTerm(terms.base_rent); eq([f.state, f.value], ['verified', 0]);
});
t('an entered description is never drawn as "None (stated)"', () => {
  const docs = [LEASE()];
  const terms = AT.resolveTerms(REASONER, docs, [dec('percentage_rent', 'correct', { new_value: 'No percentage rent (per seller)', note: AT.ENTERED_NOTE })]);
  const row = Object.assign(rowOf(terms), { _source: 'leasehold', _leaseholdId: 'f1' });
  const m = LM.buildMatrix13([row], { f1: terms });
  const cell = m.leaseholds[0].cells.find(x => x.field === 'percentage_rent');
  eq([cell.noneStated, cell.state], [false, 'entered']);
});

console.log('\n' + '─'.repeat(66));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
