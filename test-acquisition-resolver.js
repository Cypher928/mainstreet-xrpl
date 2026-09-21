'use strict';
/**
 * test-acquisition-resolver.js — Acquisition Review Phase 1, P1-4, increment P4-2.
 *
 *   node test-acquisition-resolver.js
 *
 * P4-1 recorded what each document SAYS. P4-2 turns a family of those into ONE
 * set of terms, each with the document and clause behind it and each saying how
 * settled it is. The precedence decision is NOT made here — it is made by
 * LeaseIntelligence.reasonMultiDocumentLease, which already existed. What this
 * suite defends is everything that reasoner has no opinion about, and the two
 * observations the live P4-1 run handed forward:
 *
 *   · `base_rent` came back as 1,202,500 from a clause stating $18.50/SF for
 *     65,000 SF. The value is kept, the arithmetic is not undone, and the term
 *     does NOT present it as something the clause literally states.
 *   · `renewal_options` came back at confidence 0.4 with a term sentence rather
 *     than an option schedule. The confidence survives to the term, which is
 *     the whole point of carrying confidence at all.
 *
 * And the rules that were approved before a line of it was written: missing is
 * not none, contradictions are never auto-resolved, a term is never more
 * settled than the classification of the document it comes from, and AI never
 * writes verified truth.
 *
 * It drives acquisition-terms.js for real and executes lease-intelligence.js
 * from disk in a sandbox, so the seam is exercised rather than described.
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
function loadLI() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lease-intelligence.js'), 'utf8'), sb, { filename: 'lease-intelligence.js' });
  if (!sb.window.LeaseIntelligence) throw new Error('lease-intelligence.js did not expose window.LeaseIntelligence');
  return sb.window.LeaseIntelligence;
}
const LI = loadLI();

// ── fixtures ────────────────────────────────────────────────────────────────
let _seq = 0;
const E = (value, quote, page, confidence) => ({
  value: value === undefined ? null : value,
  quote: quote || null,
  page: page == null ? null : page,
  confidence: confidence == null ? null : confidence,
});
function doc(over) {
  return Object.assign({
    id: 'doc-' + (++_seq),
    file_name: 'lease.pdf',
    doc_type: 'original_lease',
    doc_type_status: 'confirmed',
    doc_date: '2023-03-01',
    superseded_by_document_id: null,
    abstraction_status: 'success',
    abstracted_fields: { schemaVersion: 1, model: 'm', at: 'x', fields: {} },
  }, over);
}
const withFields = (over, fields) => doc(Object.assign({}, over, {
  abstracted_fields: { schemaVersion: 1, model: 'm', at: 'x', fields: fields },
}));
const resolve = (docs, decisions) => T.resolveFamilyTerms(docs, decisions || [], { reasoner: LI });

console.log('\n══ Acquisition term resolver — P1-4 / P4-2 ══');

// ── the seam into the existing reasoner ─────────────────────────────────────
sec('the reasoner is reused, and its owner-operator path is untouched');

t('reasonMultiDocumentLease takes an OPTIONAL second argument', () => {
  eq(LI.reasonMultiDocumentLease.length, 2, 'arity');
  const li = code('lease-intelligence.js');
  ok(/function reasonMultiDocumentLease\(documents, options\) \{/.test(li));
});

t('called with one argument it still reasons over CANONICAL_FIELDS, exactly as before', () => {
  const docs = [{ docType: 'original_lease', docDate: '2023-03-01', fileName: 'l.pdf',
                  extractedFields: { cap: 4, tenant_name: 'X', co_tenancy: 'yes' }, quotes: { cap: 'q' } }];
  const one = LI.reasonMultiDocumentLease(docs);
  deq(Object.keys(one), ['cap', 'tenant_name']);
  ok(!('co_tenancy' in one), 'an acquisition-only field leaked into the default path');
  deq(one, LI.reasonMultiDocumentLease(docs, { fields: LI.CANONICAL_FIELDS }));
});

t('a malformed options argument is ignored rather than obeyed', () => {
  const docs = [{ docType: 'original_lease', fileName: 'l.pdf', extractedFields: { cap: 4 }, quotes: {} }];
  const base = LI.reasonMultiDocumentLease(docs);
  for (const bad of [null, undefined, {}, { fields: [] }, { fields: 'cap' }, { fields: 7 }]) {
    deq(LI.reasonMultiDocumentLease(docs, bad), base, JSON.stringify(bad));
  }
});

t('the owner-operator multi-document result is unchanged', () => {
  const docs = [
    { docType: 'original_lease', docDate: '2023-03-01', fileName: 'lease.pdf',
      extractedFields: { cap: 4, tenant_name: 'Coastal', leased_sqft: 2600 }, quotes: { cap: 'not more than 4%' } },
    { docType: 'amendment', docDate: '2024-05-01', fileName: 'amd.pdf',
      extractedFields: { cap: 5 }, quotes: { cap: 'capped at 5%' } },
  ];
  const r = LI.reasonMultiDocumentLease(docs);
  eq(r.cap.currentValue, 5);
  eq(r.cap.governingDocument, 'amendment');
  eq(r.cap.supersededValues.length, 1);
  eq(r.tenant_name.currentValue, 'Coastal');
});

t('lease-intelligence.js gained the field list and NOTHING else', () => {
  const li = code('lease-intelligence.js');
  ok(!/AcquisitionTerms|acquisition-terms|abstracted_fields|resolveTerms/.test(li),
     'lease-intelligence.js reaches into the acquisition module');
  // The tier table is the one P1-3 matched itself to; widening it would change
  // every existing owner-operator lease.
  const m = li.match(/DOC_TYPE_TIER\s*=\s*\{([^}]*)\}/);
  ok(m, 'DOC_TYPE_TIER not found');
  const real = {};
  m[1].split(',').forEach(p => { const [k, v] = p.split(':').map(s => s.trim()); if (k) real[k] = Number(v); });
  deq(real, { side_letter: 4, estoppel: 3, amendment: 2, original_lease: 1 });
});

t('the resolver’s private copy of the tier table matches the real one', () => {
  const m = code('lease-intelligence.js').match(/DOC_TYPE_TIER\s*=\s*\{([^}]*)\}/);
  const real = {};
  m[1].split(',').forEach(p => { const [k, v] = p.split(':').map(s => s.trim()); if (k) real[k] = Number(v); });
  deq(T.REASONER_TIER, real, 'the copy in acquisition-terms.js has drifted');
});

t('every lease-family type maps onto a reasoner type of ITS OWN tier', () => {
  const m = code('lease-intelligence.js').match(/DOC_TYPE_TIER\s*=\s*\{([^}]*)\}/);
  const real = {};
  m[1].split(',').forEach(p => { const [k, v] = p.split(':').map(s => s.trim()); if (k) real[k] = Number(v); });
  const family = AD.DOC_TYPE_NAMES.filter(AD.isFamilyType);
  eq(Object.keys(T.REASONER_DOC_TYPE).length, family.length, 'the map and the family types disagree in size');
  for (const type of family) {
    const mapped = T.REASONER_DOC_TYPE[type];
    ok(mapped, type + ' has no reasoner type');
    eq(real[mapped], AD.docTypeTier(type), type + ' maps to ' + mapped + ', a different tier');
  }
});

t('the reasoner is what answers for the acquisition-only fields too', () => {
  // The whole point of the optional field list. If it were accepted and then
  // ignored, the 14 fields outside CANONICAL_FIELDS would never reach the
  // reasoner, and the resolver would be answering for them on its own — a
  // second reasoner by accident, which the plan forbids.
  const d = withFields({}, {
    co_tenancy:     E('Rent abates if the anchor goes dark', 'If the anchor tenant ceases operations, rent shall abate.'),
    guarantor_name: E('Parent Holdings LLC', 'guaranteed by Parent Holdings LLC'),
    base_rent:      E(250000, 'annual base rent of $250,000'),
  });
  const r = resolve([d]);
  ok('co_tenancy' in r.reasonerResult, 'the reasoner was never asked about the acquisition fields');
  ok('guarantor_name' in r.reasonerResult, 'the reasoner was never asked about the acquisition fields');
  ok('base_rent' in r.reasonerResult, 'the reasoner was never asked about the extracted-only fields');
  eq(r.terms.co_tenancy.state, 'ai_extracted');
  eq(r.terms.co_tenancy.lineageMismatch, false, 'the term answered without the reasoner');
  eq(r.terms.guarantor_name.lineageMismatch, false);
  eq(r.terms.base_rent.lineageMismatch, false);
});

t('a renewal therefore outranks the lease it renews', () => {
  const lease = withFields({ doc_type: 'original_lease', doc_date: '2023-03-01', file_name: 'lease.pdf' },
    { cap: E(4, 'capped at 4%') });
  const renewal = withFields({ doc_type: 'renewal', doc_date: '2024-05-01', file_name: 'renewal.pdf' },
    { cap: E(6, 'capped at 6%') });
  const r = resolve([lease, renewal]);
  eq(r.terms.cap.value, 6);
  eq(r.terms.cap.governingDocType, 'renewal');
  eq(r.terms.cap.supersededValues.length, 1);
  eq(r.terms.cap.supersededValues[0].value, 4);
});

// ── which documents are allowed to speak ────────────────────────────────────
sec('buildReasonerInput — only current, lease-family, actually-read documents');

t('a superseded document is not consulted (D-14)', () => {
  const older = withFields({ id: 'old', superseded_by_document_id: 'new' }, { cap: E(9, 'capped at 9%') });
  const newer = withFields({ id: 'new', file_name: 'lease.pdf' }, { cap: E(4, 'capped at 4%') });
  const input = T.buildReasonerInput([older, newer]);
  eq(input.length, 1);
  eq(input[0]._docId, 'new');
  eq(resolve([older, newer]).terms.cap.value, 4);
});

t('a review-level document is not consulted — a rent roll does not set lease terms', () => {
  const rr = withFields({ doc_type: 'rent_roll' }, { cap: E(9, 'capped at 9%') });
  eq(T.buildReasonerInput([rr]).length, 0);
  eq(resolve([rr]).terms.cap.state, 'missing');
});

t('an unclassified document is not consulted either', () => {
  eq(T.buildReasonerInput([withFields({ doc_type: null }, { cap: E(9, 'q') })]).length, 0);
  eq(T.buildReasonerInput([withFields({ doc_type: 'unknown' }, { cap: E(9, 'q') })]).length, 0);
});

t('a document that was never read, failed, or was skipped has nothing to say', () => {
  for (const st of ['pending', 'failed', 'skipped']) {
    eq(T.buildReasonerInput([withFields({ abstraction_status: st }, { cap: E(4, 'q') })]).length, 0, st);
  }
  eq(T.buildReasonerInput([doc({ abstraction_status: 'success', abstracted_fields: {} })]).length, 0, 'no fields object');
});

t('success and partial both count — partial is a real reading', () => {
  eq(T.buildReasonerInput([withFields({ abstraction_status: 'partial' }, { cap: E(4, 'q') })]).length, 1);
});

t('the input carries the mapped type, the date, the name and the document id', () => {
  const d = withFields({ id: 'x1', doc_type: 'side_letter', doc_date: '2025-01-02', file_name: 'sl.pdf' },
    { cap: E(3, 'capped at 3%'), co_tenancy: E('anchor clause', 'if the anchor goes dark') });
  const [inp] = T.buildReasonerInput([d]);
  eq(inp.docType, 'side_letter');
  eq(inp.docDate, '2025-01-02');
  eq(inp.fileName, 'sl.pdf');
  eq(inp._docId, 'x1');
  deq(inp.extractedFields, { cap: 3, co_tenancy: 'anchor clause' });
  deq(inp.quotes, { cap: 'capped at 3%', co_tenancy: 'if the anchor goes dark' });
});

t('a null value is not offered to the reasoner, but its quote still is', () => {
  const d = withFields({}, { cap: E(null, 'there is language here nobody could read') });
  const [inp] = T.buildReasonerInput([d]);
  deq(inp.extractedFields, {});
  deq(inp.quotes, { cap: 'there is language here nobody could read' });
});

// ── does the quote say the value? ───────────────────────────────────────────
sec('evidence support — stated, derived, or nothing');

t('a number the clause contains is STATED, commas and symbols notwithstanding', () => {
  eq(T.evidenceSupport('cap', E(4, 'CAM increases are capped at 4% annually.')), 'stated');
  eq(T.evidenceSupport('leased_sqft', E(65000, 'Leased Area: 65,000 rentable square feet')), 'stated');
  eq(T.evidenceSupport('base_rent', E(18.5, 'base rent of $18.50 per square foot')), 'stated');
  eq(T.evidenceSupport('expense_stop', E(-500, 'a credit of (500) per square foot')), 'stated');
});

t('THE base_rent CASE — a number the clause does not contain is DERIVED', () => {
  eq(T.evidenceSupport('base_rent',
     E(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.')), 'derived');
});

t('an explicit negative is STATED, though the numeral 0 appears nowhere', () => {
  eq(T.evidenceSupport('cap', E(0, 'There shall be no cap on Operating Expenses.')), 'stated');
  eq(T.evidenceSupport('guaranty_limit', E(0, 'Tenant shall provide no guaranty.')), 'stated');
  eq(T.evidenceSupport('admin_fee_pct', E(0, 'Landlord waives any administrative fee.')), 'stated');
  // and a zero with no negative language and no numeral is still derived
  eq(T.evidenceSupport('cap', E(0, 'The parties agree as set forth in Exhibit B.')), 'derived');
});

t('a non-numeric field is taken at its word, because containment cannot judge it', () => {
  eq(T.evidenceSupport('start_date', E('2024-03-01', 'shall commence on March 1, 2024')), 'stated');
  eq(T.evidenceSupport('lease_type', E('NNN', 'This is a Triple Net (NNN) lease.')), 'stated');
  eq(T.evidenceSupport('audit_rights', E(false, 'Tenant waives any right to audit.')), 'stated');
  eq(T.evidenceSupport('landlord_work', E('white box', 'delivered in white-box condition')), 'stated');
});

t('no quote, or no value, is no support', () => {
  eq(T.evidenceSupport('cap', E(4, null)), 'none');
  eq(T.evidenceSupport('cap', E(null, 'a clause')), 'none');
  eq(T.evidenceSupport('cap', E(null, null)), 'none');
  eq(T.evidenceSupport('not_a_field', E(4, 'q')), 'none');
  eq(T.evidenceSupport('cap', null), 'none');
});

// ── the five states ─────────────────────────────────────────────────────────
sec('the five states');

t('the vocabulary is exactly the five that were approved', () => {
  deq(T.TERM_STATES, ['verified', 'ai_extracted', 'conflicting', 'unclear', 'missing']);
});

t('a value with a clause, nobody having confirmed it, is ai_extracted', () => {
  const r = resolve([withFields({}, { cap: E(4, 'capped at 4%') })]);
  eq(r.terms.cap.state, 'ai_extracted');
  eq(r.terms.cap.value, 4);
  eq(r.terms.cap.support, 'stated');
});

t('a value with NO clause is unclear', () => {
  const r = resolve([withFields({}, { cap: E(4, null) })]);
  eq(r.terms.cap.state, 'unclear');
  eq(r.terms.cap.value, 4, 'the value is kept — it is what the document said');
  eq(r.terms.cap.note, 'A value with no supporting clause.');
});

t('a clause with no readable value is unclear too, and is NOT missing', () => {
  const r = resolve([withFields({}, { cap: E(null, 'Operating Expenses shall be subject to the cap set out in Exhibit C.') })]);
  eq(r.terms.cap.state, 'unclear');
  eq(r.terms.cap.value, null);
  ok(/language here/.test(r.terms.cap.note), r.terms.cap.note);
  eq(r.terms.cap.quote, 'Operating Expenses shall be subject to the cap set out in Exhibit C.');
  ok(r.terms.cap.governingDocumentId, 'the document with the language is not named');
});

t('a term no current document establishes is missing, and says so in words', () => {
  const r = resolve([withFields({}, { cap: E(4, 'capped at 4%') })]);
  const m = r.terms.co_tenancy;
  eq(m.state, 'missing');
  eq(m.value, null);
  eq(m.quote, null);
  eq(m.note, 'No current document on file establishes this term.');
});

t('every one of the 27 fields comes back, whatever happened to it', () => {
  const r = resolve([withFields({}, { cap: E(4, 'capped at 4%') })]);
  deq(Object.keys(r.terms), T.FIELDS);
  eq(Object.keys(r.terms).length, 27);
});

t('a family with no readable document at all is 27 missing terms, not an error', () => {
  const r = resolve([]);
  eq(r.ok, true);
  eq(Object.keys(r.terms).length, 27);
  ok(T.FIELDS.every(f => r.terms[f].state === 'missing'));
  eq(r.summary.missing, 27);
});

// ── missing is not none ─────────────────────────────────────────────────────
sec('MISSING IS NOT NONE — the rule the whole increment exists for');

t('an explicit negative is a VALUE with its clause, never a missing term', () => {
  const r = resolve([withFields({}, {
    cap: E(0, 'There shall be no cap on Operating Expenses.', 4, 0.9),
    renewal_options: E('Tenant shall have no option to renew', 'Tenant shall have no option to renew.', 7, 0.95),
    audit_rights: E(false, 'Tenant waives any right to audit.', 9, 0.88),
  })]);
  eq(r.terms.cap.state, 'ai_extracted');
  eq(r.terms.cap.value, 0, 'an explicit zero became something else');
  eq(r.terms.cap.support, 'stated');
  eq(r.terms.renewal_options.state, 'ai_extracted');
  eq(r.terms.audit_rights.value, false);
  eq(r.terms.audit_rights.state, 'ai_extracted');
});

t('and a missing term never becomes a zero, a false or an empty string', () => {
  const r = resolve([withFields({}, { cap: E(4, 'capped at 4%') })]);
  for (const f of ['guaranty_limit', 'audit_rights', 'expense_stop', 'co_tenancy', 'tenant_improvement_allowance']) {
    eq(r.terms[f].value, null, f);
    eq(r.terms[f].state, 'missing', f);
  }
});

t('a zero and a silence are distinguishable in the result', () => {
  const r = resolve([withFields({}, { cap: E(0, 'no cap shall apply') })]);
  eq(r.terms.cap.value, 0);
  eq(r.terms.cap.state, 'ai_extracted');
  eq(r.terms.expense_stop.value, null);
  eq(r.terms.expense_stop.state, 'missing');
  ok(r.terms.cap.value !== r.terms.expense_stop.value, 'zero and missing collapsed together');
});

// ── the derived figure, carried forward from the live P4-1 run ──────────────
sec('a derived figure is kept, and is not passed off as stated');

const DERIVED = withFields({ id: 'shoprite', file_name: 'ShopRite_Anchor_Tenant_Lease.pdf', doc_type: 'renewal' }, {
  base_rent:   E(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.', 3, 0.95),
  leased_sqft: E(65000, 'Leased Area: 65,000 rentable square feet', 1, 0.99),
  cap:         E(4, 'CAM increases are capped at 4% annually, excluding uncontrollable expenses.', 4, 0.95),
});

t('the value is NOT discarded and NOT silently changed to the rate', () => {
  const term = resolve([DERIVED]).terms.base_rent;
  eq(term.value, 1202500, 'the calculation was undone');
  ok(term.value !== 18.5, 'the total was replaced by the rate');
});

t('the clause is kept with it', () => {
  const term = resolve([DERIVED]).terms.base_rent;
  eq(term.quote, 'Tenant agrees to pay base rent of $18.50 per square foot annually.');
  eq(term.page, 3);
});

t('but the term does NOT read as evidenced — it is unclear, and flagged derived', () => {
  const term = resolve([DERIVED]).terms.base_rent;
  eq(term.state, 'unclear');
  eq(term.support, 'derived');
  eq(term.derived, true);
  ok(/not stated in the clause/.test(term.note), term.note);
});

t('a figure the clause DOES state, in the same document, still reads as evidenced', () => {
  const r = resolve([DERIVED]);
  eq(r.terms.leased_sqft.state, 'ai_extracted');
  eq(r.terms.leased_sqft.support, 'stated');
  eq(r.terms.cap.state, 'ai_extracted');
  eq(r.terms.cap.derived, false);
});

t('the summary counts derived figures so nobody has to hunt for them', () => {
  eq(resolve([DERIVED]).summary.derived, 1);
});

t('a derived figure can never be confirmed into `verified` by the ceiling alone', () => {
  const term = resolve([DERIVED]).terms.base_rent;
  ok(term.state !== 'verified');
});

// ── confidence survives, carried forward from the live P4-1 run ─────────────
sec('a weak reading stays weak — the renewal_options case');

t('the document’s own per-field confidence reaches the term', () => {
  const r = resolve([withFields({}, {
    renewal_options: E('The initial term shall be fifteen (15) years',
                       'The initial term shall be fifteen (15) years, subject to renewal options as set forth herein.', 2, 0.4),
    cap: E(4, 'capped at 4%', 4, 0.95),
  })]);
  eq(r.terms.renewal_options.confidence, 0.4, 'the low confidence was lost on the way to the term');
  eq(r.terms.cap.confidence, 0.95);
  ok(r.terms.renewal_options.confidence < r.terms.cap.confidence,
     'a weak reading is indistinguishable from a strong one');
});

t('and the reasoner’s own confidence is carried separately, not conflated', () => {
  const r = resolve([withFields({}, { renewal_options: E('x', 'a clause', 2, 0.4) })]);
  ok(r.terms.renewal_options.reasonerConfidence !== null);
  ok(r.terms.renewal_options.reasonerConfidence !== r.terms.renewal_options.confidence,
     'the document confidence and the precedence confidence became one number');
});

t('a confident reading and a weak one both stay ai_extracted — confidence is not a state', () => {
  const r = resolve([withFields({}, { cap: E(4, 'capped at 4%', 1, 0.05) })]);
  eq(r.terms.cap.state, 'ai_extracted');
  eq(r.terms.cap.confidence, 0.05);
});

// ── supersession and lineage ────────────────────────────────────────────────
sec('provenance and governing-document lineage');

const LEASE = withFields({ id: 'L', file_name: 'lease.pdf', doc_type: 'original_lease', doc_date: '2023-03-01' },
  { cap: E(4, 'capped at 4%', 10, 0.9), tenant_name: E('Coastal Outfitters', 'Tenant: Coastal Outfitters', 1, 0.99) });
const AMD = withFields({ id: 'A', file_name: 'amendment.pdf', doc_type: 'amendment', doc_date: '2024-05-01' },
  { cap: E(5, 'the cap is hereby amended to 5%', 2, 0.93) });

t('the governing document is named by id, file name, type and classification', () => {
  const term = resolve([LEASE, AMD]).terms.cap;
  eq(term.value, 5);
  eq(term.governingDocumentId, 'A');
  eq(term.governingDocumentName, 'amendment.pdf');
  eq(term.governingDocType, 'amendment');
  eq(term.governingDocStatus, 'confirmed');
});

t('the value it replaced is kept, with the document that said it', () => {
  const term = resolve([LEASE, AMD]).terms.cap;
  eq(term.supersededValues.length, 1);
  eq(term.supersededValues[0].value, 4);
  eq(term.supersededValues[0].documentId, 'L');
  eq(term.supersededValues[0].fileName, 'lease.pdf');
  eq(term.supersededValues[0].quote, 'capped at 4%');
});

t('a term only the lease establishes still comes from the lease', () => {
  const term = resolve([LEASE, AMD]).terms.tenant_name;
  eq(term.value, 'Coastal Outfitters');
  eq(term.governingDocumentId, 'L');
  eq(term.supersededValues.length, 0);
});

t('every document that spoke is listed, strongest first', () => {
  const term = resolve([LEASE, AMD]).terms.cap;
  eq(term.history.length, 2);
  eq(term.history[0].documentId, 'A');
  eq(term.history[1].documentId, 'L');
  ok(term.history.every(h => h.fileName && h.docType && 'support' in h));
});

t('the reasoner’s own sentence is carried, not rewritten', () => {
  const term = resolve([LEASE, AMD]).terms.cap;
  ok(typeof term.reasoning === 'string' && term.reasoning.length > 0);
  ok(/cap/.test(term.reasoning));
});

t('lineage agrees with the reasoner, and says so when it would not', () => {
  const r = resolve([LEASE, AMD]);
  ok(T.FIELDS.every(f => r.terms[f].lineageMismatch === false), 'a term disagreed with the reasoner');
  // A reasoner answer that contradicts the documents is a defect, and the term
  // surfaces it rather than quietly preferring one of the two.
  const rigged = T.resolveTerms({ cap: { currentValue: 99, contradictions: [], reasoning: 'r', confidence: 80, supersededValues: [] } },
                                [LEASE, AMD], []);
  eq(rigged.cap.lineageMismatch, true);
});

// ── contradictions ──────────────────────────────────────────────────────────
sec('contradictions are preserved, never auto-resolved');

const AMD_A = withFields({ id: 'A1', file_name: 'amd-a.pdf', doc_type: 'amendment', doc_date: '2024-05-01' },
  { cap: E(5, 'the cap is 5%') });
const AMD_B = withFields({ id: 'A2', file_name: 'amd-b.pdf', doc_type: 'amendment', doc_date: '2024-05-01' },
  { cap: E(7, 'the cap is 7%') });

t('two documents of one rank disagreeing makes the term conflicting', () => {
  const term = resolve([AMD_A, AMD_B]).terms.cap;
  eq(term.state, 'conflicting');
});

t('BOTH values are still on the term, with the documents that assert them', () => {
  const term = resolve([AMD_A, AMD_B]).terms.cap;
  ok(term.contradictions.length > 0, 'the contradiction was dropped');
  const values = term.contradictions[0].values.map(String).sort();
  deq(values, ['5', '7']);
  deq(term.contradictions[0].documents.slice().sort(), ['amd-a.pdf', 'amd-b.pdf']);
  eq(term.history.length, 2, 'both documents are in the lineage');
});

t('nothing picked a winner — the value shown is the governing one, and the conflict stands', () => {
  const term = resolve([AMD_A, AMD_B]).terms.cap;
  ok(term.value === 5 || term.value === 7);
  eq(term.state, 'conflicting', 'a contradiction was resolved without a person');
});

t('a contradiction outranks the ceiling — an unclassified conflict is still a conflict', () => {
  const a = withFields({ id: 'c1', file_name: 'a.pdf', doc_type: 'amendment', doc_type_status: 'proposed', doc_date: '2024-05-01' }, { cap: E(5, 'the cap is 5%') });
  const b = withFields({ id: 'c2', file_name: 'b.pdf', doc_type: 'amendment', doc_type_status: 'proposed', doc_date: '2024-05-01' }, { cap: E(7, 'the cap is 7%') });
  eq(resolve([a, b]).terms.cap.state, 'conflicting');
});

t('documents of DIFFERENT rank disagreeing is supersession, not a contradiction', () => {
  const term = resolve([LEASE, AMD]).terms.cap;
  eq(term.state, 'ai_extracted');
  deq(term.contradictions, []);
  eq(term.supersededValues.length, 1);
});

// ── the ceiling ─────────────────────────────────────────────────────────────
sec('the classification ceiling — a term is never more settled than its document');

t('an unclassified or proposed governing document caps the term at ai_extracted', () => {
  for (const st of ['unclassified', 'proposed']) {
    const r = resolve([withFields({ doc_type_status: st }, { cap: E(4, 'capped at 4%') })]);
    eq(r.terms.cap.ceiling, 'ai_extracted', st);
    eq(r.terms.cap.state, 'ai_extracted', st);
  }
});

t('and Confirm is blocked, with the reason in words', () => {
  const r = resolve([withFields({ doc_type_status: 'proposed' }, { cap: E(4, 'capped at 4%') })]);
  eq(r.terms.cap.canConfirm, false);
  ok(/proposal/.test(r.terms.cap.blockedReason), r.terms.cap.blockedReason);
  ok(/Confirm or correct the document type first/.test(r.terms.cap.blockedReason));
});

t('a confirmed or corrected document with a clause allows verified', () => {
  for (const st of ['confirmed', 'corrected']) {
    const r = resolve([withFields({ doc_type_status: st }, { cap: E(4, 'capped at 4%') })]);
    eq(r.terms.cap.ceiling, 'verified', st);
    eq(r.terms.cap.canConfirm, true, st);
    eq(r.terms.cap.state, 'ai_extracted', st + ' — still nobody has confirmed the TERM');
  }
});

t('a confirmed document with NO clause for the term caps it at unclear', () => {
  const r = resolve([withFields({ doc_type_status: 'confirmed' }, { cap: E(4, null) })]);
  eq(r.terms.cap.ceiling, 'unclear');
  eq(r.terms.cap.state, 'unclear');
  ok(/no supporting clause/.test(r.terms.cap.ceilingReason), r.terms.cap.ceilingReason);
});

t('the ceiling follows the GOVERNING document, not the best document in the family', () => {
  const confirmedLease = withFields({ id: 'L2', doc_type: 'original_lease', doc_type_status: 'confirmed', doc_date: '2023-01-01' },
    { cap: E(4, 'capped at 4%') });
  const proposedAmd = withFields({ id: 'A3', doc_type: 'amendment', doc_type_status: 'proposed', doc_date: '2024-01-01' },
    { cap: E(6, 'capped at 6%') });
  const term = resolve([confirmedLease, proposedAmd]).terms.cap;
  eq(term.governingDocumentId, 'A3');
  eq(term.ceiling, 'ai_extracted', 'the confirmed lease lent its standing to the proposed amendment');
  eq(term.canConfirm, false);
});

t('a missing term is not confirmable and carries no ceiling', () => {
  const r = resolve([withFields({}, { cap: E(4, 'q') })]);
  eq(r.terms.co_tenancy.canConfirm, false);
  eq(r.terms.co_tenancy.ceiling, null);
});

t('the summary counts what a person is blocked from acting on', () => {
  const r = resolve([withFields({ doc_type_status: 'proposed' }, { cap: E(4, 'capped at 4%'), lease_type: E('NNN', 'a NNN lease') })]);
  eq(r.summary.blocked, 2);
});

// ── human decisions ─────────────────────────────────────────────────────────
sec('the human decision overlay');

const decision = (over) => Object.assign({
  field_key: 'cap', action: 'confirm', previous_value: null, new_value: null,
  source_document_id: null, source_quote: null, source_page: null,
  decided_by: 'u1', decided_at: '2026-09-22T10:00:00Z', note: null,
}, over);
const CONFIRMABLE = withFields({ id: 'C', doc_type_status: 'confirmed' }, { cap: E(4, 'capped at 4%', 3, 0.9) });

t('with no decisions nothing is verified — AI never writes verified truth', () => {
  const r = resolve([CONFIRMABLE], []);
  ok(T.FIELDS.every(f => r.terms[f].state !== 'verified'));
  eq(r.summary.verified, 0);
});

t('a confirmation on a confirmable term makes it verified, and names who', () => {
  const r = resolve([CONFIRMABLE], [decision({})]);
  eq(r.terms.cap.state, 'verified');
  eq(r.terms.cap.decision.action, 'confirm');
  eq(r.terms.cap.decision.decidedBy, 'u1');
  eq(r.terms.cap.value, 4, 'confirming changed the value');
});

t('a confirmation CANNOT outrank the ceiling', () => {
  const proposed = withFields({ doc_type_status: 'proposed' }, { cap: E(4, 'capped at 4%') });
  const r = resolve([proposed], [decision({})]);
  eq(r.terms.cap.state, 'ai_extracted', 'a confirmation beat the classification ceiling');
  ok(/cannot read as verified yet/.test(r.terms.cap.note), r.terms.cap.note);
  ok(/proposal/.test(r.terms.cap.note));
});

t('a correction replaces the value and records the person', () => {
  const r = resolve([CONFIRMABLE], [decision({ action: 'correct', new_value: '6', source_quote: 'the cap is 6%', source_page: 12 })]);
  eq(r.terms.cap.state, 'verified');
  eq(r.terms.cap.value, 6);
  eq(r.terms.cap.quote, 'the cap is 6%');
  eq(r.terms.cap.page, 12);
  eq(r.terms.cap.support, 'stated');
  eq(r.terms.cap.note, 'Corrected by a person.');
});

t('a correction of a DERIVED figure clears the derived flag — a person vouched for it', () => {
  const r = resolve([DERIVED], [decision({ field_key: 'base_rent', action: 'correct', new_value: '1202500', source_quote: 'annual base rent of $1,202,500' })]);
  eq(r.terms.base_rent.derived, false);
  eq(r.terms.base_rent.value, 1202500);
  eq(r.terms.base_rent.state, 'verified');
});

t('a rejection keeps what the document said and stops presenting it as an answer', () => {
  const r = resolve([CONFIRMABLE], [decision({ action: 'reject' })]);
  eq(r.terms.cap.state, 'unclear');
  eq(r.terms.cap.value, 4, 'a rejection deleted the document’s reading');
  ok(/rejected this reading/.test(r.terms.cap.note), r.terms.cap.note);
});

t('the LATEST decision is the one in force', () => {
  const r = resolve([CONFIRMABLE], [
    decision({ action: 'confirm', decided_at: '2026-09-22T10:00:00Z' }),
    decision({ action: 'correct', new_value: '9', source_quote: 'the cap is 9%', decided_at: '2026-09-23T10:00:00Z' }),
  ]);
  eq(r.terms.cap.value, 9);
  eq(r.terms.cap.decision.action, 'correct');
});

t('and order in the array does not decide it — the timestamp does', () => {
  const r = resolve([CONFIRMABLE], [
    decision({ action: 'correct', new_value: '9', source_quote: 'the cap is 9%', decided_at: '2026-09-23T10:00:00Z' }),
    decision({ action: 'confirm', decided_at: '2026-09-22T10:00:00Z' }),
  ]);
  eq(r.terms.cap.value, 9);
  eq(r.terms.cap.decision.action, 'correct');
});

t('reopening puts the term back to what the documents say', () => {
  const r = resolve([CONFIRMABLE], [
    decision({ action: 'correct', new_value: '9', source_quote: 'the cap is 9%', decided_at: '2026-09-22T10:00:00Z' }),
    decision({ action: 'reopen', decided_at: '2026-09-23T10:00:00Z' }),
  ]);
  eq(r.terms.cap.state, 'ai_extracted');
  eq(r.terms.cap.value, 4);
  eq(r.terms.cap.decision, null);
});

t('a decision on one field says nothing about another — confirmation is per field', () => {
  const two = withFields({ doc_type_status: 'confirmed' }, { cap: E(4, 'capped at 4%'), lease_type: E('NNN', 'a NNN lease') });
  const r = resolve([two], [decision({ field_key: 'cap' })]);
  eq(r.terms.cap.state, 'verified');
  eq(r.terms.lease_type.state, 'ai_extracted');
  eq(r.terms.lease_type.decision, null);
});

t('a decision resolves the state but never erases the contradiction', () => {
  const a = withFields({ id: 'k1', file_name: 'a.pdf', doc_type: 'amendment', doc_date: '2024-05-01' }, { cap: E(5, 'the cap is 5%') });
  const b = withFields({ id: 'k2', file_name: 'b.pdf', doc_type: 'amendment', doc_date: '2024-05-01' }, { cap: E(7, 'the cap is 7%') });
  const r = resolve([a, b], [decision({ action: 'correct', new_value: '5', source_quote: 'the cap is 5%' })]);
  eq(r.terms.cap.state, 'verified');
  ok(r.terms.cap.contradictions.length > 0, 'the contradiction was erased by a decision');
});

t('an unknown action is not a decision', () => {
  eq(T.latestDecision([decision({ action: 'delete' })], 'cap'), null);
  eq(T.latestDecision([], 'cap'), null);
  eq(T.latestDecision(null, 'cap'), null);
  eq(T.latestDecision([decision({ field_key: 'other' })], 'cap'), null);
});

// ── the shape of the answer ─────────────────────────────────────────────────
sec('the answer, and what it refuses to do');

t('resolveFamilyTerms reports honestly when the reasoner is not there', () => {
  const r = T.resolveFamilyTerms([CONFIRMABLE], [], { reasoner: null });
  eq(r.ok, false);
  eq(r.terms, null);
  ok(/reasonMultiDocumentLease/.test(r.error));
});

t('the summary adds up to 27, always', () => {
  const r = resolve([LEASE, AMD, DERIVED], [decision({ field_key: 'cap' })]);
  const s = r.summary;
  eq(s.verified + s.ai_extracted + s.conflicting + s.unclear + s.missing, 27, JSON.stringify(s));
  eq(s.total, 27);
});

t('summarizeTerms never throws on nonsense', () => {
  eq(T.summarizeTerms(null).missing, 27);
  eq(T.summarizeTerms({}).missing, 27);
  eq(T.summarizeTerms({ cap: { state: 'nonsense' } }).missing, 27);
});

t('the documents handed in are not modified by being resolved', () => {
  const docs = [LEASE, AMD];
  const before = JSON.stringify(docs);
  resolve(docs, [decision({ action: 'correct', new_value: '9', source_quote: 'q' })]);
  eq(JSON.stringify(docs), before);
});

t('P4-2 writes nothing — the module has no network, no DOM and no storage', () => {
  const src = code('acquisition-terms.js');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'document.', 'localStorage', 'supabase', 'claudeFetch', '_acqSaveDocument']) {
    ok(src.indexOf(bad) === -1, 'acquisition-terms.js reaches ' + bad);
  }
});

t('and the decisions table is not written here — that is P4-3', () => {
  const src = code('acquisition-terms.js');
  ok(!/acquisition_term_decisions/.test(src), 'P4-2 names the P4-3 table');
  ok(!fs.existsSync(path.join(ROOT, 'migrations/026_acquisition_term_decisions.sql')),
     'migration 026 exists — that is P4-3');
});

t('no Lease Terms UI was added — that is P4-3', () => {
  const s = code('script.js');
  ok(!/resolveFamilyTerms|resolveTerms|acq-term-row|_renderAcqTerms/.test(s),
     'script.js already calls the resolver — P4-3 has begun');
  ok(!/acq-term/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')),
     'index.html already carries Lease Terms markup');
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
