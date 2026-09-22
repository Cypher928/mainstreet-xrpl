// test-acquisition-report-view.js
// ============================================================================
// Acquisition Review P1-7 / R-2 — questions 3 and 4, drawn.
//
// The view's one rule is that it DECIDES NOTHING: every state, origin, derived
// flag, competing value and note comes from acquisition-report.js (R-1). So
// the load-bearing assertion here is correspondence — for every fact in the
// model there is exactly one row on the page, carrying exactly the model's
// state — and then the specific ways a page could still lie while matching:
//
//   · a missing term shown blank, zero or "none"
//   · an AI-read reading and an entered figure under one label
//   · a derived figure's clause labelled as its "Source"
//   · a side picked in a contradiction
//   · a report that looks complete while three of five questions are not drawn
//
// Run: node test-acquisition-report-view.js
// ============================================================================
'use strict';
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const AR = require('./acquisition-report.js');
const AT = require('./acquisition-terms.js');
const AV = require('./acquisition-report-view.js');

function loadLI() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lease-intelligence.js'), 'utf8'), sb,
                  { filename: 'lease-intelligence.js' });
  return sb.window.LeaseIntelligence;
}
const WIRE = { terms: AT, reasoner: loadLI() };

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
  else    { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
}
function section(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length))); }

// ── a DOM-free reader for the rendered HTML ────────────────────────────────
// Rows are found by their data attributes; nothing here parses HTML fully,
// which is deliberate — the assertions are about what the markup SAYS.
function rows(html, cls) {
  const re = new RegExp('<tr class="' + cls + '"([^>]*)>([\\s\\S]*?)</tr>', 'g');
  const out = []; let m;
  while ((m = re.exec(html))) {
    const attrs = {}; let a; const ar = /data-([a-z-]+)="([^"]*)"/g;
    while ((a = ar.exec(m[1]))) attrs[a[1]] = a[2];
    out.push({ attrs, inner: m[2] });
  }
  return out;
}
function between(html, startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  if (i < 0) return '';
  const j = html.indexOf(endMarker, i + startMarker.length);
  return html.slice(i, j < 0 ? undefined : j);
}
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ── the Pilot's actual leasehold, as the fixture ───────────────────────────
const ev = (fields) => ({ schemaVersion: 1, model: 'claude-sonnet-4-6', at: '2026-09-22T15:09:11Z', fields });
const F  = (value, quote, page, confidence) => ({ value, quote, page: page ?? null, confidence: confidence ?? null });
const LEASE = {
  id: 'doc-shoprite', family_id: 'fam-1', family_status: 'proposed',
  file_name: 'ShopRite_Anchor_Tenant_Lease.pdf', doc_type: 'renewal', doc_type_status: 'corrected',
  doc_date: '2024-03-01', storage_path: 'leases/u/acq_x-ShopRite.pdf', abstraction_status: 'success',
  abstracted_fields: ev({
    tenant_name: F('ShopRite Supermarkets, Inc.', 'Tenant:   ShopRite Supermarkets, Inc.', 1, 0.99),
    renewal_options: F("The initial term shall be fifteen (15) years, subject to Tenant's renewal options as set forth herein.",
                       "The initial term shall be fifteen (15) years, subject to Tenant's renewal options as set forth herein.", 2, 0.4),
    cap:        F(4, 'CAM increases are capped at 4% annually.', 4, 0.95),
    base_rent:  F(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.', 3, 0.95),
    // An explicit denial is a VALUE — it must render, never as "not established".
    termination_rights: F('Tenant shall have no right to terminate this Lease early.',
                          'Tenant shall have no right to terminate this Lease early.', 9, 0.97),
    // A clause with a <script> in it must be drawn as text.
    exclusive_use: F('Grocery <script>alert(1)</script> exclusive',
                     'Landlord shall not lease to another <script>alert(1)</script> grocer.', 11, 0.9),
  }),
};
const AMENDMENT = {
  id: 'doc-amd', family_id: 'fam-1', family_status: 'confirmed',
  file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf', doc_type: 'amendment', doc_type_status: 'proposed',
  doc_date: '2027-01-01', storage_path: 'leases/u/acq_x-Amendment.pdf', abstraction_status: 'success',
  abstracted_fields: ev({
    tenant_name: F('ShopRite Supermarkets, Inc.', 'Tenant   ShopRite Supermarkets, Inc.', 1, 0.99),
    renewal_options: F('one additional five-year renewal option following expiration of the then-current term',
                       'The Tenant shall have   one additional five-year renewal option', 1, 0.99),
    audit_rights: F(true, 'Tenant may, upon reasonable written notice, inspect the records', 1, 0.99),
    cap:        F(3, 'controllable Common Area Maintenance expense increases shall not exceed   3% per year', 1, 0.99),
    base_rent:  F(1251250, 'the annual base rent for the Premises shall be   $19.25 per rentable square foot', 1, 0.97),
  }),
};
const SCAN = {
  id: 'doc-scan', family_id: null, family_status: 'unfiled', file_name: 'Estoppel_scan.pdf',
  doc_type: 'estoppel', doc_type_status: 'proposed', storage_path: null,
  abstraction_status: 'failed', abstraction_error: 'no_text',
};
const OLD = {
  id: 'doc-old', family_id: 'fam-1', family_status: 'proposed', file_name: 'ShopRite_Anchor_Tenant_Lease.pdf',
  doc_type: 'renewal', doc_type_status: 'confirmed', storage_path: 'leases/u/acq_old.pdf',
  abstraction_status: 'success', superseded_by_document_id: 'doc-shoprite', abstracted_fields: ev({}),
};
const FAMILIES = [{ id: 'fam-1', label: 'ShopRite Supermarkets, Inc.', tenant_hint: 'ShopRite Supermarkets, Inc.' }];
const REVIEW = { name: 'Maple Plaza', data: { assumptions: [
  { key: 'guaranty_limit', label: 'Underwritten guaranty limit', value: 500000 },
] } };

const MODEL = AR.buildReport(REVIEW, FAMILIES, [LEASE, AMENDMENT, SCAN, OLD], [], WIRE);
const linkCalls = [];
const OPTS = {
  linkFor: (p, name) => { linkCalls.push(p); return `<button data-doc-url="${AV.esc(p)}">${AV.esc(name)}</button>`; },
  typeLabel: (t) => ({ renewal: 'Renewal', amendment: 'Amendment', estoppel: 'Estoppel' }[t] || t),
};
const HTML = AV.renderReport(MODEL, OPTS);
const Q3 = between(HTML, 'data-q="what_obligations"', '</section>');
const Q4 = between(HTML, 'data-q="what_evidence"', '</section>');

console.log('\n══ P1-7 R-2 — questions 3 and 4, drawn ══');

// ── 1 · correspondence ─────────────────────────────────────────────────────
section('1 · one row per fact, carrying exactly the model\'s state');
{
  check('the model built', MODEL.ok === true, MODEL.error || '');
  const q3 = MODEL.questions.find(q => q.id === 'what_obligations');
  const modelFacts = q3.sections.reduce((a, s) => a.concat(s.facts), []);
  const pageRows = rows(Q3.split('data-entered=')[0], 'acqr-fact');
  check('every obligation in the model has a row — none omitted',
    pageRows.length === modelFacts.length, `${pageRows.length} rows / ${modelFacts.length} facts`);
  check('and all 11 obligations are there for the leasehold', modelFacts.length === 11);
  const mismatched = modelFacts.filter((f, i) =>
    !pageRows[i] || pageRows[i].attrs.key !== f.key || pageRows[i].attrs.state !== f.state
    || (pageRows[i].attrs.origin || null) !== (f.origin || null)
    || (pageRows[i].attrs.derived === 'true') !== !!f.derived);
  check('each row carries the model\'s key, state, origin and derived flag — no re-projection',
    mismatched.length === 0, mismatched.map(f => f.key).join(',') || 'all match');
  check('the page uses only the four states',
    pageRows.every(r => ['verified', 'assumption', 'issue', 'missing'].includes(r.attrs.state)));
}

// ── 2 · missing is not none ────────────────────────────────────────────────
section('2 · a missing term reads as missing, in words');
{
  const missing = rows(Q3, 'acqr-fact').filter(r => r.attrs.state === 'missing');
  check('there ARE missing obligations on this lease', missing.length > 0, `${missing.length}`);
  check('each says "Not established"', missing.every(r => /Not established/.test(r.inner)));
  check('and carries a sentence saying why', missing.every(r => /acqr-note/.test(r.inner)));
  check('none of them shows a zero, a dollar sign or "none"',
    missing.every(r => !/acqr-value/.test(r.inner) && !/>\s*(\$?0|0%|none|None)\s*</.test(r.inner)));
  check('an explicit denial is NOT missing — it is drawn as the value the lease states',
    rows(Q3, 'acqr-fact').some(r => r.attrs.key === 'termination_rights' && r.attrs.state !== 'missing'
      && /no right to terminate/.test(r.inner)));
  check('formatValue never turns nothing into something',
    AV.formatValue(null, 'money') === null && AV.formatValue(undefined, 'percent') === null
    && AV.formatValue('', 'number') === null);
  check('while a real zero is a value', AV.formatValue(0, 'percent') === '0%' && AV.formatValue(0, 'money') === '$0');
  check('a state the view does not know is drawn Missing, never Verified',
    /data-state="missing"/.test(AV.stateChip({ state: 'bogus' })) && !/Verified/.test(AV.stateChip({ state: 'bogus' })));
  const ev = (docStatus) => ({ documentName: 'x.pdf', quote: 'q', page: 1, confidence: 0.9, docStatus });
  const aiRow = (docStatus) => AV.factRow({ key: 'k', label: 'K', state: 'assumption', origin: 'ai_read',
                                            value: 'v', type: 'text', evidence: ev(docStatus) }, {});
  check('a clause from a document whose type is only proposed says so',
    /classification is not confirmed/.test(aiRow('proposed')));
  check('a clause from a confirmed or corrected document carries no such caveat',
    !/classification is not confirmed/.test(aiRow('confirmed')) && !/classification is not confirmed/.test(aiRow('corrected')));
}

// ── 3 · two kinds of assumption ────────────────────────────────────────────
section('3 · an AI-read reading and an entered figure are never one label');
{
  const ai = rows(Q3, 'acqr-fact').filter(r => r.attrs.origin === 'ai_read');
  check('AI-read assumptions are marked ai_read', ai.length > 0, `${ai.length}`);
  check('and say they are not confirmed', ai.every(r => /AI-read · not confirmed/.test(r.inner)));
  const entered = rows(between(HTML, 'data-entered=', '</section>'), 'acqr-fact');
  check('the entered figure is drawn in its own "Entered by a person" table',
    /Entered by a person/.test(Q3) && entered.length === 1, `${entered.length}`);
  check('and says it has no document', entered.every(r => r.attrs.origin === 'entered'
    && /Entered · no document/.test(r.inner) && !/acqr-evidence/.test(r.inner)));
  check('no row carries both labels',
    rows(Q3, 'acqr-fact').every(r => !(/AI-read/.test(r.inner) && /Entered · no document/.test(r.inner))));
  check('the counts keep the two apart',
    /data-count="assumption_ai_read"/.test(Q3) && /data-count="assumption_entered"/.test(Q3));
  check('a bare "Assumption" chip never appears without its origin',
    rows(Q3, 'acqr-fact').filter(r => r.attrs.state === 'assumption').every(r => /acqr-origin/.test(r.inner)));
}

// ── 4 · derived is not stated ──────────────────────────────────────────────
section('4 · a calculated figure is never drawn as document-stated');
{
  const d = AV.factRow({ key: 'base_rent', label: 'Base rent', type: 'money', state: 'assumption', origin: 'ai_read',
    derived: true, value: 1202500,
    evidence: { documentName: 'ShopRite.pdf', page: 3, quote: '$18.50 per square foot annually', confidence: 0.95 } }, OPTS);
  check('a derived figure is labelled Derived — calculated from lease terms',
    /Derived — calculated from lease terms/.test(d));
  check('its clause is introduced as "Calculated from", never "Source"',
    /Calculated from:/.test(d) && !/>Source:</.test(d));
  check('and the clause is still shown — the rate it was worked out from', /\$18\.50 per square foot/.test(d));
  const s = AV.factRow({ key: 'cap', label: 'CAM cap', type: 'percent', state: 'assumption', origin: 'ai_read',
    derived: false, value: 4, evidence: { documentName: 'Lease.pdf', quote: 'capped at 4%' } }, OPTS);
  check('a STATED figure\'s clause is its Source', /Source:/.test(s) && !/Calculated from/.test(s));
}

// ── 5 · contradictions ─────────────────────────────────────────────────────
section('5 · a contradiction shows both sides and picks neither');
{
  // cap (4 vs 3) and base_rent (1,202,500 vs 1,251,250) are Q2 facts; Q3's
  // live contradiction is renewal_options. Draw a Q2 fact through the same
  // row function so the rule is tested on the real case.
  const q2 = MODEL.questions.find(q => q.id === 'what_income');
  const capFact = q2.sections[0].facts.find(f => f.key === 'cap');
  const capRow = AV.factRow(capFact, OPTS);
  check('the live 4% vs 3% cap is an issue in the model', capFact.state === 'issue');
  check('the row says Contested, not a value', /Contested/.test(capRow) && !/acqr-value/.test(capRow));
  check('both figures are drawn', /4%/.test(capRow) && /3%/.test(capRow));
  check('each with the document that asserts it',
    /ShopRite_Anchor_Tenant_Lease\.pdf/.test(capRow) && /Maple_Plaza_Test_Lease_Amendment\.pdf/.test(capRow));
  check('and the page says neither has been selected', /Neither value has been selected\./.test(capRow));
  check('no single Source is named for a contradiction — that would read as a choice',
    !/acqr-evidence/.test(capRow) && !/Source:/.test(capRow), capFact.evidence ? 'model carries evidence; view withholds it' : '');
  check('each side still carries its own quote',
    (capRow.match(/acqr-competing-item/g) || []).length === 2 && (capRow.match(/acqr-quote/g) || []).length === 2);

  const rentFact = q2.sections[0].facts.find(f => f.key === 'base_rent');
  const rentRow = AV.factRow(rentFact, OPTS);
  check('two calculations that disagree are drawn as a contradiction',
    rentFact.state === 'issue' && /Contested/.test(rentRow));
  check('with each side still marked derived',
    (rentRow.match(/Derived — calculated from lease terms/g) || []).length >= 2);
}

// ── 6 · question 4 ─────────────────────────────────────────────────────────
section('6 · every document, and whether it can be trusted yet');
{
  const docs = rows(Q4, 'acqr-doc');
  check('every document the model lists has a row', docs.length === 4, `${docs.length}`);
  check('an original on file is opened through the injected opener',
    linkCalls.includes('leases/u/acq_x-ShopRite.pdf') && linkCalls.includes('leases/u/acq_x-Amendment.pdf'));
  check('a document with no original says so rather than offering a dead link',
    /Estoppel_scan\.pdf/.test(Q4) && /Original not on file/.test(Q4) && !linkCalls.includes(null));
  check('an unconfirmed classification says it is a proposal',
    docs.some(r => r.attrs.settled === 'false' && /Proposed by AI — not confirmed/.test(r.inner)));
  check('a confirmed one says so', docs.some(r => r.attrs.settled === 'true' && /Confirmed by a person/.test(r.inner)));
  check('a failed reading says WHY — the A4 reason reaches the buyer',
    /data-reason="no_text"/.test(Q4) && /no usable text on file/.test(Q4));
  check('a document in no leasehold says so', /Not in a leasehold/.test(Q4));
  check('a proposed filing is not presented as settled', /Filing proposed — not confirmed/.test(Q4));
  check('a confirmed filing says so', /Filing confirmed\./.test(Q4));
  check('a replaced upload is still listed and marked', docs.some(r => r.attrs.superseded === 'true')
    && /Replaced by a newer upload — kept on record/.test(Q4));
  check('with no opener injected, a file name is plain text — never a broken link',
    !/data-doc-url/.test(AV.renderEvidence(MODEL.questions[3], {})));
}

// ── 7 · honesty about coverage ─────────────────────────────────────────────
section('7 · the report does not pretend to be complete');
{
  check('the five questions appear in §7\'s order',
    ['what_am_i_buying', 'what_income', 'what_obligations', 'what_evidence', 'what_needs_attention']
      .map(id => HTML.indexOf('data-q="' + id + '"')).every((p, i, a) => p >= 0 && (i === 0 || p > a[i - 1])));
  const pending = (HTML.match(/data-pending="true"/g) || []).length;
  // R-3 draws questions 1 and 2; question 5 is still drawn in place.
  check('question 5 is drawn IN PLACE as not yet included',
    pending === 1 && /data-q="what_needs_attention" data-pending="true"/.test(HTML), `${pending}`);
  check('and says nothing there is an answer',
    (HTML.match(/Nothing here should be read as an answer to this question\./g) || []).length === 1);
  check('the report opens by saying it answers 4 of 5 questions',
    /data-drawn="4" data-of="5"/.test(HTML) && /This report currently answers 4 of 5 questions\./.test(HTML));
  check('and that it is not a complete acquisition report', /It is not a complete acquisition report\./.test(HTML));
  check('there is a legend for every chip on the page',
    ['Verified', 'Assumption', 'Issue', 'Missing'].every(w => new RegExp('acqr-chip[^>]*>' + w + '<').test(between(HTML, 'acqr-legend', '</div>'))));
  check('nowhere does it claim the review is clean',
    !/no issues|all clear|looks good|no risks|nothing to report/i.test(text(HTML)));
  // On a phone each <td> becomes a two-column grid; a cell with several
  // children has them dealt into the heading gutter. One wrapper per cell.
  const tds = HTML.match(/<td[^>]*>/g) || [];
  const wrapped = HTML.match(/<td[^>]*><div class="acqr-cell">/g) || [];
  check('every table cell holds its content in ONE wrapper (phone card layout)',
    tds.length > 0 && wrapped.length === tds.length, `${wrapped.length} of ${tds.length}`);
  check('an unbuildable model is reported, not drawn as an empty report',
    /could not be built: AcquisitionTerms is not available/.test(AV.renderReport({ ok: false, error: 'AcquisitionTerms is not available' })));
}

// ── 8 · escaping ───────────────────────────────────────────────────────────
section('8 · a clause is drawn as text, never as markup');
{
  check('a <script> in a quote is escaped', !/<script>alert/.test(HTML) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(HTML));
  check('esc covers the five characters that matter',
    AV.esc(`<>&"'`) === '&lt;&gt;&amp;&quot;&#39;');
  check('null and undefined escape to nothing, not "null"', AV.esc(null) === '' && AV.esc(undefined) === '');
}

// ── 9 · the view decides nothing ───────────────────────────────────────────
section('9 · the view is a view — it computes no state of its own');
{
  const V = fs.readFileSync(path.join(ROOT, 'acquisition-report-view.js'), 'utf8');
  const code = V.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('it never reads P1-4\'s term states', !/'ai_extracted'|'conflicting'|'unclear'/.test(code));
  check('it never calls the resolver or the projection',
    !/resolveFamilyTerms|projectTerm|buildReport|reasonMultiDocumentLease/.test(code));
  check('it is pure — no DOM, no network, no storage',
    !/document\.|fetch\(|localStorage|supabase|XMLHttpRequest/.test(code));
  check('it writes nothing', !/upsert|insert\(|\.save|_acqSave/.test(code));
}

// ── 10 · what R-2 must not have touched ────────────────────────────────────
section('10 · R-1 frozen; v1, the CAM engine and P1-4 untouched');
{
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  check('acquisition-report.js (R-1) is byte-for-byte what R-1 shipped',
    sha('acquisition-report.js') === 'c9d2fc8a8b96cfa7d6f0900e102e6fab73b5942e43c82bd9c526af0cc96bfbe6',
    sha('acquisition-report.js').slice(0, 12));
  const S = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const v1Now = (S.match(/^function generateAcquisitionReport\(\) \{[\s\S]*?^\}/m) || [''])[0];
  let v1Head = '';
  // The mutation harness runs this from a copy with no .git; it names the
  // real checkout here so the pin is still enforced there, not skipped.
  const gitRoot = process.env.ACQ_REPORT_GIT_ROOT || ROOT;
  try {
    v1Head = (execFileSync('git', ['show', 'HEAD:script.js'], { cwd: gitRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .match(/^function generateAcquisitionReport\(\) \{[\s\S]*?^\}/m) || [''])[0];
  } catch (_) { v1Head = null; }
  check('the v1 Decision Report function is unchanged from HEAD',
    v1Head === null ? true : (v1Now.length > 1000 && v1Now === v1Head),
    v1Head === null ? 'no git available — skipped, not passed' : `${v1Now.length} chars, identical`);
  check('the v1 button still lives only after the CAM analysis',
    /onclick="generateAcquisitionReport\(\)">&#x1F4CB; Decision Report<\/button>/.test(S));
  const eng = fs.readFileSync(path.join(ROOT, 'acquisition-engine.js'), 'utf8');
  check('the CAM engine still requires invoices for ITS report', /if \(!tenants\.length \|\| !invoices\.length\)/.test(eng));
  const v2 = (S.match(/^async function generateAcquisitionReportV2\(\) \{[\s\S]*?^\}/m) || [''])[0];
  check('v2 builds from R-1 and renders with the view — nothing else',
    /AR\.buildReport\(/.test(v2) && /AV\.renderReport\(/.test(v2)
    && !/AcquisitionEngine|buildAcquisitionReport|data\.analysis/.test(v2));
  check('v2 needs no analysis run and no invoices', !/_acqInvoices|analysis/.test(v2));
  check('v2 writes nothing — no save, no activity record',
    !/_saveAcqReview|_acqSaveDocument|_acqRecord|upsert|insert\(/.test(v2));
  check('v2 re-reads evidence and decisions rather than trusting a stale cache',
    /await _acqLoadEvidence\(review\.id\)/.test(v2) && /await _acqLoadDecisions\(review\.id\)/.test(v2));
  const H = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('its control is on the Lease Terms card, which exists without any analysis',
    /id="acqTermsCard"[\s\S]{0,900}id="acqReportV2Btn"/.test(H));
  check('the report scripts load after acquisition-terms.js and before script.js',
    (() => { const a = H.indexOf('src="acquisition-terms.js"'), b = H.indexOf('src="acquisition-report.js"'),
                     c = H.indexOf('src="acquisition-report-view.js"'), d = H.indexOf('src="script.js"');
             return a > 0 && a < b && b < c && c < d; })());
  const apiFiles = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  check('no new serverless function — api/ still holds twelve', apiFiles.length === 12, String(apiFiles.length));
  check('no new migration', !fs.readdirSync(path.join(ROOT, 'migrations')).some(f => /^028_/.test(f)));
  check('P1-4\'s term states and fields are unchanged',
    AT.TERM_STATES.join() === 'verified,ai_extracted,conflicting,unclear,missing' && AT.FIELDS.length === 27);
}

console.log('\n' + '─'.repeat(66));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
