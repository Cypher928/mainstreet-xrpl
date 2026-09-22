// test-acquisition-report-q1q2.js
// ============================================================================
// Acquisition Review P1-7 / R-3 — questions 1 and 2, drawn.
//
//   1. What am I buying?
//   2. What income am I actually buying?
//
// Same rule as R-2: the view DECIDES NOTHING. Every state, origin, derived
// flag and note comes from acquisition-report.js (R-1, frozen). So the first
// assertion is correspondence — one row per model fact, carrying the model's
// state — and then the ways these two questions in particular could lie:
//
//   · a review NAME presented as though a document established the property
//   · a building with no property-level facts read as established
//   · a document in no leasehold silently missing from "what am I buying"
//   · leased area summed across leaseholds of different states into one figure
//   · an AI-read rent presented as confirmed, or a correction as a confirmation
//   · the contractual column read as the whole income picture, because the
//     rent roll and the GL columns were left out instead of shown as not on file
//   · a derived rent presented as stated
//
// And R-2 is frozen: the Q3 and Q4 markup is byte-compared with the committed
// view, rendered from the same model.
//
// Run: node test-acquisition-report-q1q2.js
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
const sig  = (f) => [f.key, f.state, f.origin || '', f.derived ? 'D' : ''].join(':');
const rowSig = (r) => [r.attrs.key, r.attrs.state, r.attrs.origin || '', r.attrs.derived === 'true' ? 'D' : ''].join(':');

// ── the Pilot's leasehold, as it stands after P4-V ─────────────────────────
// The renewal (type corrected by a person) and the amendment (type confirmed)
// disagree on base rent — both figures calculated from a $/sf clause — and on
// the CAM cap. A person corrected the suite (A-1 → A-3, as on the Pilot) and
// confirmed the deposit. Commencement, expiration and lease type are read by
// nothing. One scan is in no leasehold; one upload was replaced.
const ev = (fields) => ({ schemaVersion: 1, model: 'claude-sonnet-4-6', at: '2026-09-22T15:09:11Z', fields });
const F  = (value, quote, page, confidence) => ({ value, quote, page: page ?? null, confidence: confidence ?? null });
const LEASE = {
  id: 'doc-shoprite', family_id: 'fam-1', family_status: 'proposed',
  file_name: 'ShopRite_Anchor_Tenant_Lease.pdf', doc_type: 'renewal', doc_type_status: 'corrected',
  doc_date: '2024-03-01', storage_path: 'leases/u/acq_x-ShopRite.pdf', abstraction_status: 'success',
  abstracted_fields: ev({
    tenant_name: F('ShopRite Supermarkets, Inc.', 'Tenant:   ShopRite Supermarkets, Inc.', 1, 0.99),
    suite:       F('Anchor Unit A-1', 'Premises: Anchor Unit A-1', 1, 0.9),
    leased_sqft: F(65000, 'approximately 65,000 rentable square feet', 1, 0.95),
    cap:         F(4, 'CAM increases are capped at 4% annually.', 4, 0.95),
    base_rent:   F(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.', 3, 0.95),
    admin_fee_pct: F(10, 'an administrative fee of ten percent (10%)', 5, 0.9),
  }),
};
const AMENDMENT = {
  id: 'doc-amd', family_id: 'fam-1', family_status: 'confirmed',
  file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf', doc_type: 'amendment', doc_type_status: 'confirmed',
  doc_date: '2027-01-01', storage_path: 'leases/u/acq_x-Amendment.pdf', abstraction_status: 'success',
  abstracted_fields: ev({
    tenant_name: F('ShopRite Supermarkets, Inc.', 'Tenant   ShopRite Supermarkets, Inc.', 1, 0.99),
    suite:       F('Anchor Unit A-1', 'Suite: Anchor Unit A-1', 1, 0.9),
    cap:         F(3, 'controllable Common Area Maintenance expense increases shall not exceed   3% per year', 1, 0.99),
    base_rent:   F(1251250, 'the annual base rent for the Premises shall be   $19.25 per rentable square foot', 1, 0.97),
    security_deposit: F(100000, 'Tenant shall deposit $100,000 as security', 2, 0.97),
  }),
};
const SCAN = {
  id: 'doc-scan', family_id: null, family_status: 'unfiled', file_name: 'Estoppel_scan.pdf',
  doc_type: 'estoppel', doc_type_status: 'proposed', storage_path: null,
  abstraction_status: 'failed', abstraction_error: 'no_text',
};
const REPLACED = {
  id: 'doc-old', family_id: null, family_status: 'unfiled', file_name: 'Rent_roll_draft.pdf',
  doc_type: null, doc_type_status: 'unclassified', storage_path: 'leases/u/acq_old.pdf',
  abstraction_status: 'skipped', superseded_by_document_id: 'doc-scan',
};
const DEC = (field, action, extra) => Object.assign({ id: 'dec-' + field, family_id: 'fam-1', field_key: field,
  action, decided_by: 'u1', decided_at: '2026-09-22T15:30:00Z', created_at: '2026-09-22T15:30:00Z' }, extra || {});
const DECISIONS = [
  DEC('suite', 'correct', { previous_value: 'Anchor Unit A-1', new_value: 'Anchor Unit A-3',
      source_document_id: 'doc-amd', source_quote: 'Suite: Anchor Unit A-1', source_page: 1 }),
  DEC('security_deposit', 'confirm', { previous_value: 100000, source_document_id: 'doc-amd' }),
];
const FAMILIES = [{ id: 'fam-1', label: 'ShopRite Supermarkets, Inc.', tenant_hint: 'ShopRite Supermarkets, Inc.' }];
const REVIEW = { name: 'Maple Plaza', data: { assumptions: [
  { key: 'exit_cap_rate', label: 'Underwritten exit cap rate', value: '7.25%' },
  { key: 'base_rent', label: 'Underwritten base rent', value: 1200000 },
] } };

const MODEL = AR.buildReport(REVIEW, FAMILIES, [LEASE, AMENDMENT, SCAN, REPLACED], DECISIONS, WIRE);
const OPTS = {
  linkFor: (p, name) => `<button data-doc-url="${AV.esc(p)}">${AV.esc(name)}</button>`,
  typeLabel: (t) => t,
};
const HTML = AV.renderReport(MODEL, OPTS);
const Q  = (id) => MODEL.questions.find(q => q && q.id === id);
const Q1 = between(HTML, 'data-q="what_am_i_buying"', '</section>');
const Q2 = between(HTML, 'data-q="what_income"', '</section>');
const facts = (q) => q.sections.reduce((a, s) => a.concat(s.facts), []);
const rowOf = (html, key) => rows(html, 'acqr-fact').find(r => r.attrs.key === key);

console.log('\n══ P1-7 R-3 — questions 1 and 2, drawn ══');

// ── 1 · correspondence ─────────────────────────────────────────────────────
section('1 · one row per fact, carrying exactly the model\'s state');
{
  check('the model built', MODEL.ok === true, MODEL.error || '');
  const q1 = facts(Q('what_am_i_buying')), q2 = facts(Q('what_income'));
  const r1 = rows(between(Q1, 'acqr-leasehold', 'acqr-entered'), 'acqr-fact');
  const r2 = rows(between(Q2, 'class="acqr-leasehold"', 'acqr-entered'), 'acqr-fact');
  check('Q1: every model fact is a row, in order, with its state, origin and derived flag',
    JSON.stringify(r1.map(rowSig)) === JSON.stringify(q1.map(sig)), r1.map(rowSig).join(' '));
  check('Q1 lists all six identity facts', r1.length === 6 && q1.length === 6, String(r1.length));
  check('Q2: every model fact is a row, in order, with its state, origin and derived flag',
    JSON.stringify(r2.map(rowSig)) === JSON.stringify(q2.map(sig)), r2.map(rowSig).join(' '));
  check('Q2 lists all ten income terms', r2.length === 10 && q2.length === 10, String(r2.length));
  const states = new Set(q1.concat(q2).map(f => f.state));
  check('the fixture exercises all four states across Q1 and Q2 (non-vacuous)',
    ['verified', 'assumption', 'issue', 'missing'].every(s => states.has(s)), [...states].join(','));
  check('the report now answers 4 of 5 questions, and says it is not complete',
    /data-drawn="4" data-of="5"/.test(HTML) && /It is not a complete acquisition report\./.test(HTML));
  check('only question 5 is still drawn in place',
    (HTML.match(/data-pending="true"/g) || []).length === 1 && /data-q="what_needs_attention" data-pending="true"/.test(HTML));
  check('questions appear in §7 order',
    ['what_am_i_buying', 'what_income', 'what_obligations', 'what_evidence', 'what_needs_attention']
      .map(id => HTML.indexOf('data-q="' + id + '"')).every((i, k, a) => i >= 0 && (k === 0 || i > a[k - 1])));
}

// ── 2 · Q1: the property ───────────────────────────────────────────────────
section('2 · Q1 — the property is a name, not an established fact');
{
  check('the property is named as the review is named', /data-property="true"/.test(Q1) && Q1.indexOf('Maple Plaza') >= 0);
  check('and the page says the name is a label, not a document fact',
    /It is a label, not a fact any document establishes\./.test(Q1));
  check('property-level facts are drawn as Missing, not left out',
    /acqr-property-facts" data-state="missing"/.test(Q1)
    && /Property-level facts — address, site, building area, title — are not established\./.test(Q1));
  check('nothing claims a building area — no leased area is summed across leaseholds',
    !/total/i.test(text(Q1)) && (Q1.match(/<span class="acqr-value">[^<]*<\/span>/g) || [])
      .filter(v => /65,000/.test(v)).length === 1);
}

// ── 3 · Q1: what the workspace holds ───────────────────────────────────────
section('3 · Q1 — every leasehold, and every document in none');
{
  const ls = MODEL.leaseholds;
  check('the roster is the model\'s leaseholds, with their document counts',
    ls.length === 1 && /data-count="leaseholds">Leaseholds 1</.test(Q1)
    && new RegExp('data-leasehold="fam-1">ShopRite Supermarkets, Inc\\. <span class="acqr-roster-docs">— '
                  + ls[0].documentCount + ' documents').test(Q1), `${ls[0].documentCount} documents`);
  const q4 = Q('what_evidence').documents.filter(d => !d.leasehold && !d.superseded);
  check('documents in no leasehold are counted from the model', q4.length === 1
    && /data-count="unfiled">Documents in no leasehold 1</.test(Q1), String(q4.length));
  check('and named, with what that means',
    /data-unfiled="1"/.test(Q1) && /1 document is not filed into any leasehold, so nothing it says is reported under one: Estoppel_scan\.pdf\./.test(text(Q1)));
  check('a replaced upload is not counted as an unfiled document', Q1.indexOf('Rent_roll_draft.pdf') < 0);
}

// ── 4 · Q1: identity facts, honestly ───────────────────────────────────────
section('4 · Q1 — tenant, suite, area, dates and type, each in its own state');
{
  const suite = rowOf(Q1, 'suite'), sqft = rowOf(Q1, 'leased_sqft'), tenant = rowOf(Q1, 'tenant_name');
  check('a corrected suite is Verified, shows the corrected value, and says a person corrected it',
    suite && suite.attrs.state === 'verified' && /Anchor Unit A-3/.test(suite.inner)
    && /Corrected by a person\./.test(suite.inner) && !/Anchor Unit A-1<\/span>/.test(suite.inner), suite && text(suite.inner));
  check('an AI-read area is an Assumption marked AI-read, with its clause as Source',
    sqft && sqft.attrs.state === 'assumption' && sqft.attrs.origin === 'ai_read'
    && /AI-read · not confirmed/.test(sqft.inner) && /Source:/.test(sqft.inner) && /65,000/.test(sqft.inner));
  check('the tenant\'s identity carries its own state from the model',
    tenant && tenant.attrs.state === facts(Q('what_am_i_buying')).find(f => f.key === 'tenant_name').state, tenant && tenant.attrs.state);
  ['start_date', 'end_date', 'lease_type'].forEach(k => {
    const r = rowOf(Q1, k);
    check(`${k} with nothing behind it reads Not established — never blank`,
      r && r.attrs.state === 'missing' && /Not established/.test(r.inner) && !/Source:/.test(r.inner));
  });
}

// ── 5 · Q1: entered figures ────────────────────────────────────────────────
section('5 · Q1 — an entered figure with no lease field is kept, and labelled');
{
  const ent = between(Q1, 'acqr-entered', '</table>');
  check('the deal-level entry is drawn in its own table', /data-entered="1"/.test(Q1) && /Underwritten exit cap rate/.test(ent));
  check('labelled Entered · no document', /Entered · no document/.test(ent) && /data-origin="entered"/.test(ent));
  check('a Q2-keyed entry travels with Q2, not Q1', !/Underwritten base rent/.test(Q1) && /Underwritten base rent/.test(Q2));
}

// ── 6 · Q2: the three sources ──────────────────────────────────────────────
section('6 · Q2 — contractual, rent roll and GL, side by side and not merged');
{
  const src = Q('what_income').sources;
  const SRC = between(Q2, 'acqr-sources', 'acqr-counts');
  check('all three sources from the model head the table',
    src.length === 3 && src.every(s => SRC.indexOf('<th>' + AV.esc(s.label) + '</th>') >= 0), src.map(s => s.id).join(','));
  const inc = rows(SRC, 'acqr-income');
  check('one row per leasehold the model gives the contractual source',
    inc.length === src[0].leaseholds.length && inc.length === 1, String(inc.length));
  const m = /data-source="contractual" data-state="([a-z]+)"/.exec(SRC);
  const baseRow = rowOf(Q2, 'base_rent');
  check('the contractual cell carries the model\'s base-rent state, and the table row agrees',
    m && m[1] === src[0].leaseholds[0].baseRent.state && baseRow && baseRow.attrs.state === m[1], m && m[1]);
  ['rent_roll', 'gl'].forEach(id => {
    const cellHtml = between(SRC, 'data-source="' + id + '"', '</td>');
    check(`${id}: shown as Missing / Not on file, with no figure in it`,
      /data-state="missing"/.test(cellHtml) && /Not on file/.test(cellHtml) && !/\d/.test(text(cellHtml)), text(cellHtml));
    const s = src.find(x => x.id === id);
    check(`${id}: the model's own note is shown — not zero, unevidenced`,
      Q2.indexOf('data-absent-source="' + id + '">' + AV.esc(s.note)) >= 0 && /not zero/.test(s.note));
  });
  check('and the page says financial intake is not yet part of the review',
    /data-financial-intake="not-included"/.test(Q2)
    && /Financial intake — the rent roll and the general ledger — is not yet part of Acquisition Review\./.test(Q2));
  check('nothing adds the sources, or anything else, into one figure', !/total/i.test(text(Q2)));
  check('the contractual cell carries its state chip, not just a word',
    /data-source="contractual" data-state="issue"[^>]*><span class="acqr-chip acqr-issue"/.test(SRC));

  // A leasehold whose leases establish no base rent: the contractual cell
  // must say so, never show a blank or a zero.
  const MN = AR.buildReport({ name: 'Plaza', data: {} },
    [{ id: 'fam-9', label: 'Vacant Pad Tenant' }], [], [], WIRE);
  const SN = between(AV.renderReport(MN, OPTS), 'acqr-sources', '</table>');
  check('a leasehold with no base rent reads Not established in the contractual column',
    MN.questions[1].sources[0].leaseholds[0].baseRent.state === 'missing'
    && /data-source="contractual" data-state="missing"[^>]*><span class="acqr-chip acqr-missing"[^>]*>Missing<\/span> <span class="acqr-missing-value">Not established<\/span>/.test(SN),
    text(SN).slice(0, 120));
}

// ── 7 · Q2: which figures are established, and how ─────────────────────────
section('7 · Q2 — confirmed, corrected, AI-read, derived, contested, missing');
{
  const dep = rowOf(Q2, 'security_deposit'), admin = rowOf(Q2, 'admin_fee_pct'),
        rent = rowOf(Q2, 'base_rent'), cap = rowOf(Q2, 'cap'), stop = rowOf(Q2, 'expense_stop');
  check('a deposit a person confirmed is Verified, and says a person confirmed it',
    dep && dep.attrs.state === 'verified' && /Confirmed by a person\./.test(dep.inner) && /\$100,000/.test(dep.inner),
    dep && text(dep.inner).slice(0, 120));
  check('an AI-read fee is an Assumption labelled AI-read, not verified',
    admin && admin.attrs.state === 'assumption' && admin.attrs.origin === 'ai_read' && /AI-read · not confirmed/.test(admin.inner));
  check('two calculated rents that disagree are one Issue, Contested',
    rent && rent.attrs.state === 'issue' && /Contested/.test(rent.inner) && /Neither value has been selected\./.test(rent.inner));
  check('each side is shown with its own document, and each is marked derived',
    rent && (rent.inner.match(/acqr-competing-item/g) || []).length === 2
    && (rent.inner.match(/Derived — calculated from lease terms/g) || []).length >= 2
    && /ShopRite_Anchor_Tenant_Lease\.pdf/.test(rent.inner) && /Maple_Plaza_Test_Lease_Amendment\.pdf/.test(rent.inner));
  check('no single Source is named for the contested rent', rent && !/Source:/.test(rent.inner));
  check('in the sources table the contested rent reads Contested, not either figure',
    /data-source="contractual" data-state="issue"[^>]*>[\s\S]*?Contested/.test(Q2)
    && !/\$1,202,500|\$1,251,250/.test(between(Q2, 'acqr-sources', '</table>')));
  check('the CAM cap contradiction is drawn here, with both figures',
    cap && cap.attrs.state === 'issue' && /4%/.test(cap.inner) && /3%/.test(cap.inner));
  check('an income term nothing establishes reads Not established', stop && stop.attrs.state === 'missing' && /Not established/.test(stop.inner));
}

// ── 8 · an empty review ────────────────────────────────────────────────────
section('8 · a review with nothing in it says so, question by question');
{
  const M0 = AR.buildReport({ name: 'Empty Site', data: {} }, [], [], [], WIRE);
  const H0 = AV.renderReport(M0, OPTS);
  const e1 = between(H0, 'data-q="what_am_i_buying"', '</section>');
  const e2 = between(H0, 'data-q="what_income"', '</section>');
  check('Q1 still names the property and says property facts are not established',
    /Empty Site/.test(e1) && /are not established\./.test(e1));
  check('Q1 counts zero leaseholds and says why nothing follows',
    /Leaseholds 0/.test(e1) && e1.indexOf(AV.esc(M0.questions[0].emptyNote)) >= 0);
  check('Q2 still shows all three sources, none with a figure',
    /data-sources="3"/.test(e2) && e2.indexOf(AV.esc(M0.questions[1].sources[0].note)) >= 0
    && /data-absent-source="rent_roll"/.test(e2) && /data-absent-source="gl"/.test(e2));
  check('and says contractual income cannot be stated yet',
    /no contractual income can be stated/.test(e2));
}

// ── 9 · escaping ───────────────────────────────────────────────────────────
section('9 · every string from a person or a document is drawn as text');
{
  const MX = AR.buildReport({ name: 'Plaza <img src=x onerror=alert(1)>', data: {} },
    [{ id: 'f<x', label: 'Tenant <b>bold</b>' }],
    [{ id: 'd-x', family_id: null, file_name: 'a<script>.pdf', doc_type_status: 'proposed' }], [], WIRE);
  const HX = AV.renderReport(MX, OPTS);
  check('no raw tag from the review name, a leasehold label or a file name survives',
    !/<img src=x/.test(HX) && !/<b>bold<\/b>/.test(HX) && !/a<script>\.pdf/.test(HX));
  check('they are shown escaped', /Plaza &lt;img/.test(HX) && /Tenant &lt;b&gt;bold/.test(HX) && /a&lt;script&gt;\.pdf/.test(HX));
}

// ── 10 · a phone ───────────────────────────────────────────────────────────
section('10 · every new table cell holds its content in one block');
{
  const q12 = Q1 + Q2;
  const tds = q12.match(/<td[^>]*>/g) || [];
  const wrapped = q12.match(/<td[^>]*><div class="acqr-cell">/g) || [];
  check('every Q1 and Q2 cell is wrapped (phone card layout)', tds.length > 0 && wrapped.length === tds.length,
    `${wrapped.length} of ${tds.length}`);
}

// ── 11 · what R-3 must not have touched ────────────────────────────────────
section('11 · R-1 and R-2 frozen; v1, the glue and P1-4 untouched');
{
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  check('acquisition-report.js (R-1) is byte-for-byte what R-1 shipped',
    sha('acquisition-report.js') === 'c9d2fc8a8b96cfa7d6f0900e102e6fab73b5942e43c82bd9c526af0cc96bfbe6');

  // R-2's drawing of Q3 and Q4, from the committed view, against this one.
  const gitRoot = process.env.ACQ_REPORT_GIT_ROOT || ROOT;
  let headSrc = null;
  try { headSrc = execFileSync('git', ['show', 'edcf259:acquisition-report-view.js'], { cwd: gitRoot, encoding: 'utf8' }); }
  catch (_) { headSrc = null; }
  if (headSrc === null) {
    check('R-2 comparison needs git — skipped, NOT passed', false, 'no git available');
  } else {
    const sb = { module: { exports: {} } }; sb.exports = sb.module.exports;
    vm.createContext(sb); vm.runInContext(headSrc, sb);
    const R2 = sb.module.exports;
    const q3 = Q('what_obligations'), q4 = Q('what_evidence');
    check('Q3 markup is byte-identical to R-2\'s', R2.renderObligations(q3, OPTS) === AV.renderObligations(q3, OPTS));
    check('Q4 markup is byte-identical to R-2\'s', R2.renderEvidence(q4, OPTS) === AV.renderEvidence(q4, OPTS));
    check('the row, chip and pending renderers are byte-identical to R-2\'s',
      facts(Q('what_income')).concat(facts(q3)).every(f => R2.factRow(f, OPTS) === AV.factRow(f, OPTS)
                                                      && R2.stateChip(f) === AV.stateChip(f))
      && R2.renderPending(Q('what_needs_attention')) === AV.renderPending(Q('what_needs_attention')));
    check('R-2\'s question list only GAINED questions 1 and 2',
      JSON.stringify(AV.RENDERED) === JSON.stringify(['what_am_i_buying', 'what_income'].concat(R2.RENDERED)),
      AV.RENDERED.join(','));
    let scriptHead = null;
    try { scriptHead = execFileSync('git', ['show', 'edcf259:script.js'], { cwd: gitRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch (_) { scriptHead = null; }
    check('script.js is unchanged — the glue already hands over the whole model',
      scriptHead !== null && scriptHead === fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8'));
  }
  const apiFiles = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  check('no new serverless function — api/ still holds twelve', apiFiles.length === 12, String(apiFiles.length));
  check('no new migration', !fs.readdirSync(path.join(ROOT, 'migrations')).some(f => /^028_/.test(f)));
}

console.log('\n' + '─'.repeat(66));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
