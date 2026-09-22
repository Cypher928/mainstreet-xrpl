// test-acquisition-report.js
// ============================================================================
// Acquisition Review P1-7 / R-1 — the buyer's five questions, as a model.
//
// Almost every rule here is a rule about NOT HIDING something, so almost every
// assertion is that an absence is still on the page with words attached. The
// three that matter most:
//
//   MISSING IS NOT NONE      every field appears every time; a term nothing
//                            establishes says so and is never zero or blank,
//                            and the rent roll and GL columns are PRESENT and
//                            missing rather than quietly left out.
//   ORIGIN IS NOT COLLAPSED  an AI-read clause and a hand-typed figure are
//                            both `assumption` and are never the same claim.
//   DERIVED IS NOT STATED    a calculated figure is never presented as
//                            document-stated, and is never an issue for
//                            being calculated.
//
// Run: node test-acquisition-report.js
// ============================================================================
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = __dirname;
const AR = require('./acquisition-report.js');
const AT = require('./acquisition-terms.js');

// The module finds AcquisitionTerms on `window` in the browser; under Node
// there is no window, so it is injected — the same seam acquisition-terms.js
// uses for LeaseIntelligence, and the same reason: the real thing is executed
// rather than described. lease-intelligence.js is run from disk in a sandbox
// so the contradiction path under test is the reasoner's own.
function loadLI() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lease-intelligence.js'), 'utf8'), sb,
                  { filename: 'lease-intelligence.js' });
  if (!sb.window.LeaseIntelligence) throw new Error('lease-intelligence.js did not expose window.LeaseIntelligence');
  return sb.window.LeaseIntelligence;
}
const LI   = loadLI();
const WIRE = { terms: AT, reasoner: LI };

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
  else    { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
}
function section(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length))); }

console.log('\n══ P1-7 R-1 — the buyer\'s report, as a model ══');

// ── 1 · the vocabulary ─────────────────────────────────────────────────────
section('1 · four states, and two things that ride alongside them');
check('the report has exactly the four states §7 names',
  JSON.stringify(AR.REPORT_STATES) === JSON.stringify(['verified', 'assumption', 'issue', 'missing']));
check('and no fifth one was invented for derived',
  AR.REPORT_STATES.indexOf('derived') < 0 && AR.REPORT_STATES.length === 4);
check('an assumption has an origin, and there are two',
  JSON.stringify(AR.ASSUMPTION_ORIGINS) === JSON.stringify(['ai_read', 'entered']));
check('`missing` is outside the strength scale — an absence is not a weak value',
  AR.STATE_RANK.missing === undefined && AR.STATE_RANK.verified === 3);
check('there are five questions, in §7\'s order',
  AR.QUESTIONS.length === 5 && AR.QUESTIONS.map(q => q.n).join('') === '12345',
  AR.QUESTIONS.map(q => q.title).join(' · '));

// ── 2 · the field partition ────────────────────────────────────────────────
section('2 · every one of the 27 fields answers exactly one question');
{
  const assigned = [].concat(AR.QUESTION_FIELDS.what_am_i_buying,
                             AR.QUESTION_FIELDS.what_income,
                             AR.QUESTION_FIELDS.what_obligations);
  check('the partition is TOTAL — no field silently left the report',
    AT.FIELDS.every(f => assigned.indexOf(f) >= 0),
    AT.FIELDS.filter(f => assigned.indexOf(f) < 0).join(',') || 'all 27 placed');
  check('the partition is DISJOINT — no figure is read twice and reconciled by hand',
    new Set(assigned).size === assigned.length,
    `${assigned.length} placements, ${new Set(assigned).size} unique`);
  check('and it covers nothing the module does not know',
    assigned.every(f => AT.FIELDS.indexOf(f) >= 0));
  check('the nine acquisition fields are all obligations — the section P1-4 serves best',
    AT.FIELD_GROUPS.acquisition.every(f => AR.QUESTION_FIELDS.what_obligations.indexOf(f) >= 0));
  check('base_rent is income, leased_sqft is what you are buying',
    AR.QUESTION_FIELDS.what_income.indexOf('base_rent') >= 0
    && AR.QUESTION_FIELDS.what_am_i_buying.indexOf('leased_sqft') >= 0);
}

// ── 3 · projecting one term ────────────────────────────────────────────────
section('3 · the five term states become four report states');
{
  const t = (o) => Object.assign({ field: 'cap', label: 'CAM cap' }, o);

  const miss = AR.projectTerm(t({ state: 'missing', value: null }));
  check('missing → missing, with a sentence, and NEVER zero',
    miss.state === 'missing' && miss.value === null && /No current document/.test(miss.note));

  const ai = AR.projectTerm(t({ state: 'ai_extracted', value: 4, quote: 'capped at 4%',
                                governingDocumentName: 'Lease.pdf', support: 'stated' }));
  check('ai_extracted → assumption, origin ai_read', ai.state === 'assumption' && ai.origin === 'ai_read');
  check('and it keeps the document and the clause behind it',
    ai.evidence && ai.evidence.documentName === 'Lease.pdf' && /capped at 4%/.test(ai.evidence.quote));

  const ver = AR.projectTerm(t({ state: 'verified', value: 4, quote: 'capped at 4%', support: 'stated' }));
  check('verified → verified, with no origin — it is not an assumption',
    ver.state === 'verified' && ver.origin === null);

  const noQuote = AR.projectTerm(t({ state: 'unclear', value: 4, support: 'none' }));
  check('unclear with NO clause behind it → issue',
    noQuote.state === 'issue' && /no supporting clause/.test(noQuote.note));

  const conflict = AR.projectTerm(t({ state: 'conflicting', value: 4,
    governingDocumentName: 'Lease.pdf', quote: 'capped at 4% annually',
    supersededValues: [{ value: 3, fileName: 'Amendment.pdf', quote: 'shall not exceed 3% per year' }] }));
  check('conflicting → issue', conflict.state === 'issue');
  check('and BOTH values travel, each with the document that asserts it',
    conflict.competing.length === 2
    && conflict.competing.some(c => c.value === 4 && /Lease/.test(c.documentName))
    && conflict.competing.some(c => c.value === 3 && /Amendment/.test(c.documentName)),
    JSON.stringify(conflict.competing.map(c => `${c.value}@${c.documentName}`)));
  check('nothing was chosen for the reader', !/chosen/.test(String(conflict.value)) && /nothing has been chosen/i.test(conflict.note));
}

// ── 4 · derived ────────────────────────────────────────────────────────────
section('4 · a calculated figure is not an issue, and is never "stated"');
{
  // The live case: 1,202,500 from "$18.50 per square foot" × 65,000 sf.
  const live = { field: 'base_rent', label: 'Base rent', state: 'unclear', value: 1202500,
                 support: 'derived', derived: true,
                 quote: 'Tenant agrees to pay base rent of $18.50 per square foot annually.',
                 governingDocumentName: 'ShopRite_Anchor_Tenant_Lease.pdf', page: 3 };
  const f = AR.projectTerm(live);
  check('a derived figure is an ASSUMPTION, not an issue', f.state === 'assumption', f.state);
  check('its origin is ai_read — a model read the rate and did the arithmetic', f.origin === 'ai_read');
  check('it is flagged derived', f.derived === true);
  check('and the note says the clause gives a rate rather than this figure',
    /rate rather than this figure/.test(f.note), f.note);
  check('the clause it was calculated from travels with it',
    /\$18\.50 per square foot/.test(f.evidence.quote) && f.evidence.page === 3);
  check('the figure itself is kept, not discarded', f.value === 1202500);

  const confirmed = AR.projectTerm(Object.assign({}, live, { state: 'verified' }));
  check('a CONFIRMED derived figure still says it is calculated',
    confirmed.state === 'verified' && confirmed.derived === true
    && /calculated from the clause, not stated in it/.test(confirmed.note), confirmed.note);

  // The live contradiction: 1,202,500 vs 1,251,250, both calculated.
  const bothDerived = AR.projectTerm({ field: 'base_rent', state: 'conflicting',
    value: 1202500, support: 'derived', derived: true,
    governingDocumentName: 'ShopRite.pdf', quote: '$18.50 per square foot',
    supersededValues: [{ value: 1251250, fileName: 'Amendment.pdf',
                         quote: '$19.25 per rentable square foot', support: 'derived' }] });
  check('two calculations that DISAGREE are still a disagreement — contradiction outranks derived',
    bothDerived.state === 'issue', bothDerived.state);
  check('and each side is still marked derived',
    bothDerived.competing.length === 2 && bothDerived.competing.every(c => c.derived === true));
  check('the note says both figures are calculated',
    /calculated rather than stated/.test(bothDerived.note), bothDerived.note);
}

// ── 5 · entered assumptions ────────────────────────────────────────────────
section('5 · an entered assumption is not an AI reading');
{
  const e = AR.projectAssumption({ key: 'stabilized_noi', label: 'Stabilized NOI',
                                   value: 1450000, at: '2026-09-22T10:00:00Z', by: 'pm@example.com' });
  check('it is an assumption with origin `entered`', e.state === 'assumption' && e.origin === 'entered');
  check('it carries NO evidence, because there is none', e.evidence === null);
  check('and it says so in words', /No document on file supports it/.test(e.note), e.note);
  check('who entered it and when are kept', e.by === 'pm@example.com' && !!e.at);
  check('the two origins are distinguishable — the whole point of decision C-3',
    e.origin !== AR.projectTerm({ field: 'cap', state: 'ai_extracted', value: 4 }).origin);
  check('an entry with no label is skipped rather than rendered untraceable',
    AR.projectAssumption({ value: 5 }) === null);
  check('and so is anything that is not an object',
    AR.projectAssumption(null) === null && AR.projectAssumption('x') === null
    && AR.projectAssumption([1]) === null);
}

// ── 6 · the whole report, on the live Pilot shape ──────────────────────────
section('6 · the report, built from the Pilot\'s actual leasehold');
{
  const ev = (fields) => ({ schemaVersion: 1, model: 'claude-sonnet-4-6',
                            at: '2026-09-22T15:09:11.892Z', fields });
  const F = (value, quote, page, confidence) => ({ value, quote, page: page ?? null, confidence: confidence ?? null });

  const lease = {
    id: 'doc-shoprite', family_id: 'fam-1', file_name: 'ShopRite_Anchor_Tenant_Lease.pdf',
    doc_type: 'renewal', doc_type_status: 'corrected', doc_date: '2024-03-01',
    storage_path: 'leases/u/acq_x-ShopRite.pdf', abstraction_status: 'success',
    abstracted_fields: ev({
      tenant_name: F('ShopRite Supermarkets, Inc.', 'Tenant:   ShopRite Supermarkets, Inc.', 1, 0.99),
      leased_sqft: F(65000, 'Leased Area:   65,000 rentable square feet', 1, 0.99),
      cap:         F(4, 'CAM increases are capped at 4% annually.', 4, 0.95),
      base_rent:   F(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.', 3, 0.95),
    }),
  };
  const amendment = {
    id: 'doc-amd', family_id: 'fam-1', file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf',
    doc_type: 'amendment', doc_type_status: 'proposed', doc_date: '2027-01-01',
    storage_path: 'leases/u/acq_x-Amendment.pdf', abstraction_status: 'success',
    abstracted_fields: ev({
      tenant_name: F('ShopRite Supermarkets, Inc.', 'Tenant   ShopRite Supermarkets, Inc.', 1, 0.99),
      leased_sqft: F(65000, 'the Premises contain 65,000 rentable square feet', 1, 0.99),
      cap:         F(3, "controllable Common Area Maintenance expense increases shall not exceed   3% per year", 1, 0.99),
      base_rent:   F(1251250, 'the annual base rent for the Premises shall be   $19.25 per rentable square foot', 1, 0.97),
    }),
  };
  const families = [{ id: 'fam-1', label: 'ShopRite Supermarkets, Inc.', tenant_hint: 'ShopRite Supermarkets, Inc.' }];
  const review = { name: 'Maple Plaza', data: { assumptions: [
    { key: 'exit_cap_rate', label: 'Exit cap rate', value: 6.25 },
  ] } };

  const rpt = AR.buildReport(review, families, [lease, amendment], [], WIRE);
  check('the report builds', rpt.ok === true, rpt.error || '');
  check('it names the review and stamps itself', rpt.reviewName === 'Maple Plaza' && !!rpt.generatedAt);
  check('all five questions are present, in order',
    rpt.questions.length === 5 && rpt.questions.map(q => q.n).join('') === '12345');
  check('the leasehold is named', rpt.leaseholds.length === 1 && /ShopRite/.test(rpt.leaseholds[0].label));

  const q1 = rpt.questions[0], q2 = rpt.questions[1], q3 = rpt.questions[2];
  check('Q1 reports every one of its fields for the leasehold — nothing omitted',
    q1.sections[0].facts.length === AR.QUESTION_FIELDS.what_am_i_buying.length,
    `${q1.sections[0].facts.length} facts`);
  check('Q3 likewise', q3.sections[0].facts.length === AR.QUESTION_FIELDS.what_obligations.length);
  const allFacts = rpt.questions.slice(0, 3)
    .reduce((a, q) => a.concat(q.sections[0].facts), []);
  check('and the three term questions together report all 27',
    allFacts.length === 27, `${allFacts.length}`);
  check('every fact has a state from the four',
    allFacts.every(f => AR.REPORT_STATES.indexOf(f.state) >= 0));
  check('every missing fact carries a sentence — none is blank',
    allFacts.filter(f => f.state === 'missing').every(f => !!f.note && f.note.length > 10),
    `${allFacts.filter(f => f.state === 'missing').length} missing`);
  check('and no missing fact was quietly given a value',
    allFacts.filter(f => f.state === 'missing').every(f => f.value === null));

  // The live contradiction must surface as an issue with both values.
  const capFact = q2.sections[0].facts.find(f => f.key === 'cap');
  check('the 4% vs 3% CAM cap is an ISSUE', capFact.state === 'issue', capFact.state);
  check('with both figures and both documents shown',
    capFact.competing.length >= 2
    && capFact.competing.some(c => String(c.value) === '4')
    && capFact.competing.some(c => String(c.value) === '3'),
    JSON.stringify(capFact.competing.map(c => c.value)));

  const rentFact = q2.sections[0].facts.find(f => f.key === 'base_rent');
  check('base rent is flagged derived', rentFact.derived === true, `state=${rentFact.state}`);
  check('and is NOT presented as document-stated',
    rentFact.state !== 'verified' && /calculated/i.test(rentFact.note || ''), rentFact.note);

  check('the entered assumption is carried, separately from AI readings',
    rpt.summary.assumption_entered >= 1 && rpt.summary.assumption_ai_read >= 1,
    JSON.stringify({ entered: rpt.summary.assumption_entered, ai: rpt.summary.assumption_ai_read }));
  check('and the two never merge into one count',
    rpt.summary.assumption >= rpt.summary.assumption_entered + 0);

  // An underwriting figure is never one of the 27 lease fields, so it has no
  // field to attach to — and must still appear. Dropping it is the same
  // failure as dropping a term nothing establishes.
  const q1entered = rpt.questions[0].entered.map(a => a.key);
  check('an entered assumption that names NO lease field still reaches the report',
    q1entered.indexOf('exit_cap_rate') >= 0, JSON.stringify(q1entered));
  check('and it is not silently re-labelled as an AI reading',
    rpt.questions[0].entered.every(a => a.origin === 'entered'));

  const wide = AR.buildReport({ name: 'X', data: { assumptions: [
    { key: 'stabilized_noi', label: 'Stabilized NOI', value: 1450000 },
    { key: 'exit_cap_rate',  label: 'Exit cap rate',  value: 6.25 },
    { label: 'Hold period (no key at all)', value: '7 years' },
    { key: 'cap', label: 'Underwritten CAM cap', value: 3.5 },
  ] } }, [], [], [], WIRE);
  const seen = []
    .concat(...wide.questions.filter(q => q.entered).map(q => q.entered.map(a => a.label)));
  check('EVERY entered assumption survives, keyed, unkeyed or lease-keyed',
    seen.length === 4, `${seen.length} of 4 — ${JSON.stringify(seen)}`);
  check('and the one that DOES name a lease field travels with that question',
    (wide.questions[1].entered || []).some(a => a.key === 'cap'),
    JSON.stringify((wide.questions[1].entered || []).map(a => a.key)));
  check('a review with only entered assumptions does not read as empty',
    wide.questions[0].empty === false && /entered by a person/.test(wide.questions[0].emptyNote || ''),
    wide.questions[0].emptyNote);
}

// ── 6b · the seam ──────────────────────────────────────────────────────────
section('6b · with no AcquisitionTerms it declines rather than throws');
{
  const bare = AR.buildReport({ name: 'R' }, [], [], [], {});
  check('it returns ok:false with the reason in words',
    bare.ok === false && /AcquisitionTerms is not available/.test(bare.error), bare.error);
  check('and still returns the shape a caller expects, empty',
    Array.isArray(bare.questions) && Array.isArray(bare.leaseholds));
}

// ── 7 · the income columns ─────────────────────────────────────────────────
section('7 · three income sources, never merged, never hidden');
{
  const rpt = AR.buildReport({ name: 'R' }, [{ id: 'f', label: 'T' }], [], [], WIRE);
  const q2 = rpt.questions[1];
  check('all three sources are present even with P1-5 unbuilt',
    q2.sources.length === 3 && q2.sources.map(s => s.id).join(',') === 'contractual,rent_roll,gl');
  const rr = q2.sources.find(s => s.id === 'rent_roll');
  const gl = q2.sources.find(s => s.id === 'gl');
  check('the rent roll is MISSING, not absent from the report', rr.state === 'missing' && rr.available === false);
  check('and says it is unevidenced rather than zero',
    /not zero — it is unevidenced/.test(rr.note), rr.note);
  check('the GL says the same', /not zero — it is unevidenced/.test(gl.note));
  check('each names the increment that will fill it',
    rr.pendingIncrement === 'P1-5' && gl.pendingIncrement === 'P1-5');
  check('the contractual column is the only one available today',
    q2.sources.filter(s => s.available).map(s => s.id).join(',') === 'contractual');
}

// ── 8 · an empty review says so, question by question ──────────────────────
section('8 · nothing on file is reported as nothing on file');
{
  const rpt = AR.buildReport({ name: 'Empty' }, [], [], [], WIRE);
  check('the report still builds', rpt.ok === true);
  check('Q1 says no leasehold has been identified, and why',
    rpt.questions[0].empty === true && /No leasehold has been identified/.test(rpt.questions[0].emptyNote));
  check('Q4 says nothing can be evidenced',
    rpt.questions[3].empty === true && /Nothing in this report can be evidenced/.test(rpt.questions[3].emptyNote));
  check('Q5 says nothing can be said about what needs attention',
    rpt.questions[4].empty === true);
  check('and NOTHING reads as a clean bill of health',
    !JSON.stringify(rpt).match(/no issues|all clear|looks good|complete/i));
  check('the summary is zeroes, not a pass', rpt.summary.verified === 0 && rpt.summary.total === 0);
}

// ── 9 · Q4 and Q5 ──────────────────────────────────────────────────────────
section('9 · evidence, and what needs attention');
{
  const docs = [
    { id: 'a', file_name: 'Lease.pdf', doc_type: 'original_lease', doc_type_status: 'confirmed',
      family_id: 'f', storage_path: 'p/a', abstraction_status: 'success' },
    { id: 'b', file_name: 'Scan.pdf', doc_type: 'amendment', doc_type_status: 'proposed',
      family_id: null, storage_path: null, abstraction_status: 'failed', abstraction_error: 'no_text' },
  ];
  const rpt = AR.buildReport({ name: 'R' }, [{ id: 'f', label: 'T' }], docs, [], WIRE);
  const q4 = rpt.questions[3], q5 = rpt.questions[4];
  check('every document is listed', q4.documents.length === 2);
  check('one has its original on file and one says it does not',
    q4.counts.withOriginal === 1 && q4.documents.find(d => d.fileName === 'Scan.pdf').originalOnFile === false);
  check('an unconfirmed classification is marked unsettled',
    q4.documents.find(d => d.fileName === 'Scan.pdf').classificationSettled === false);
  check('a failed reading carries WHY — A4\'s reason reaches the report',
    q4.documents.find(d => d.fileName === 'Scan.pdf').readFailedBecause === 'no_text');
  check('Q5 lists the unreadable document', q5.documentsUnreadable.length === 1);
  check('and the unconfirmed one', q5.documentsUnconfirmed.length === 1);
  check('Q5 does NOT claim to be ranked — that is P1-6',
    q5.ranked === false && /P1-6/.test(q5.rankingNote));
  check('missing terms reach Q5 rather than being swallowed', q5.counts.missing > 0, String(q5.counts.missing));
}

// ── 10 · what this increment must not have touched ─────────────────────────
section('10 · P1-7 R-1 changes nothing it was told not to');
{
  const S = fs.readFileSync(path.join(ROOT, 'acquisition-report.js'), 'utf8');
  check('the module is pure — no DOM, no network, no storage',
    !/document\.|window\.[a-z]|fetch\(|localStorage|supabase/i.test(
      S.replace(/typeof window !== 'undefined' \? window : null/g, '')),
    'pure');
  check('it does not require a serverless function', !/\/api\//.test(S));
  check('it does not reimplement the resolver — it calls P1-4\'s',
    /resolveFamilyTerms/.test(S) && !/reasonMultiDocumentLease/.test(S));
  check('it never writes: no save, no upsert, no mutation of its input',
    !/upsert|insert|update\(|\.save/i.test(S));
  const eng = fs.readFileSync(path.join(ROOT, 'acquisition-engine.js'), 'utf8');
  check('AcquisitionEngine.buildAcquisitionReport still requires invoices — untouched (C-1)',
    /if \(!tenants\.length \|\| !invoices\.length\)/.test(eng));
  check('and the existing Decision Report is still there (C-1, decision 5)',
    /function generateAcquisitionReport\(\)/.test(fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8')));
  check('P1-4\'s five term states are unchanged',
    JSON.stringify(AT.TERM_STATES) === JSON.stringify(['verified', 'ai_extracted', 'conflicting', 'unclear', 'missing']));
  check('and its 27 fields are unchanged', AT.FIELDS.length === 27);
}

console.log('\n' + '─'.repeat(66));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
