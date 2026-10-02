'use strict';
/**
 * test-acquisition-matrix13.js — the acquisition matrix (the buyer's thirteen
 * columns), its CSVs, and the guard rails around the five new fields.
 *
 *   node test-acquisition-matrix13.js
 *
 *   1  the columns: exactly the buyer's thirteen, in the buyer's order, one
 *      field each, every field a term the resolver knows
 *   2  a cell: the summary matrix's own state; how it is written (dates, the
 *      monthly figure, "None (stated)" and only when the document says so)
 *   3  where it came from: the governing document and the readings it
 *      replaced (F3), and, contested, what each document says
 *   4  the CSVs: the thirteen headers, never a blank cell, a BOM, formulas
 *      written as text; the sources file, one row per leasehold × column
 *   5  the guard rails: the five are acquisition-only (no workspace home); the
 *      re-read is merge-only and never rewrites the reading's status; a
 *      closed acquisition is never read again; the renderers escape
 *
 * Pure: drives acquisition-lease-matrix.js and acquisition-terms.js for real
 * over the Maple Plaza fixture; reads script.js as text for its structure.
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const ROOT = __dirname;
const LM = require('./acquisition-lease-matrix.js');
const AT = require('./acquisition-terms.js');
const AL = require('./acquisition-leasehold.js');
const PL = require('./property-leaseholds.js');
const TN = require('./tenant-normalize.js');
const F  = require('./fixtures/maple-plaza-acquisition.js');

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
const S = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j + 2);
}
function loadLI() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lease-intelligence.js'), 'utf8'), sb);
  return sb.window.LeaseIntelligence;
}
const LI = loadLI();
const OPTS = { terms: AT };
const HEADERS = ['Tenant', 'Lease Exp.', 'Sq. Ft.', 'Base Rent', 'Rent Inc.', 'CAM', 'Taxes', 'Ins.', '% Rent',
                 'Options', 'Exclusive', 'Co-Ten', 'Termination Right'];

// Maple Plaza's ShopRite, resolved for real, as the page resolves it.
const SHOP_DOCS = F.documents.filter(d => d.family_id === F.FAM.shoprite);
const SHOP_RES  = AT.resolveFamilyTerms(SHOP_DOCS, F.decisions.filter(d => d.family_id === F.FAM.shoprite), { reasoner: LI });
const SHOP_ROW  = AL.tenantRowFor(F.families.find(f => f.id === F.FAM.shoprite), SHOP_RES);
const M = LM.buildMatrix13([SHOP_ROW, { _source: 'unfiled', tenant_name: 'Raw' }], { [F.FAM.shoprite]: SHOP_RES.terms }, OPTS);
const cellOf = (m, key) => m.leaseholds[0].cells.find(c => c.column === key);
const ROW = (states, values, extra) => Object.assign({ _source: 'leasehold', _leaseholdId: 'f', tenant_name: 'T',
  _states: states, _origins: (extra && extra.origins) || {}, quotes: (extra && extra.quotes) || {} }, values);

console.log('\n══ the acquisition matrix (13 columns) ══');

// ── 1 · the columns ──────────────────────────────────────────────────────────
sec('1 · the buyer\'s thirteen, in the buyer\'s order');
t('exactly the thirteen headers, in order', () => deq(LM.MATRIX13.map(c => c.header), HEADERS));
t('one field per column, each a term the resolver knows, none twice', () => {
  const f = LM.MATRIX13.map(c => c.field);
  deq(f, ['tenant_name', 'end_date', 'leased_sqft', 'base_rent', 'rent_escalations', 'cam_recovery', 'tax_recovery',
          'insurance_recovery', 'percentage_rent', 'renewal_options', 'exclusive_use', 'co_tenancy', 'termination_rights']);
  ok(f.every(x => AT.FIELDS.indexOf(x) >= 0)); eq(new Set(f).size, 13);
});
t('Options is free text (v1) — no structure is imposed on it', () => eq(AT.FIELD_META.renewal_options.type, 'text'));
t('the model lists each leasehold once, with thirteen cells; an unfiled row is counted, never shown', () => {
  eq(M.leaseholds.length, 1); eq(M.leaseholds[0].cells.length, 13); eq(M.unfiled, 1);
  deq(M.columns.map(c => c.header), HEADERS);
});

// ── 2 · a cell ──────────────────────────────────────────────────────────────
sec('2 · a cell: the summary matrix\'s state, written the buyer\'s way');
t('every cell has exactly the state the summary matrix gives the same field', () => {
  M.leaseholds[0].cells.slice(1).forEach(c => eq(c.state, LM.cellFor(SHOP_ROW, c.field, OPTS).state, c.field));
});
t('dates are written M/D/YYYY', () => {
  eq(cellOf(M, 'lease_exp').text, '2/28/2039');
  eq(LM.usDate('2031-07-07'), '7/7/2031'); eq(LM.usDate(null), null); eq(LM.usDate('soon'), 'soon');
});
t('Base Rent is the annual figure, with the monthly one beside it and labelled calculated', () => {
  eq(cellOf(M, 'base_rent').text, '$1,251,250'); eq(cellOf(M, 'base_rent').sub, '$104,270.83/mo (calc.)');
  eq(LM.matrix13Cell(ROW({ base_rent: 'ai_extracted' }, { base_rent: 102000 }), LM.MATRIX13[3], null, OPTS).sub, '$8,500/mo (calc.)');
});
t('a contested Options says Contested and carries no value', () => {
  const c = cellOf(M, 'options'); eq(c.state, 'contested'); eq(c.text, 'Contested'); eq(c.value, null);
});
t('a field no document establishes is null text and missing — the CSV and the renderers write it out', () => {
  const c = cellOf(M, 'pct_rent'); eq(c.state, 'missing'); eq(c.text, null); eq(LM.csvText(c), 'Not established');
});
t('F1: an unclear field with no value says Unclear', () => {
  const c = LM.matrix13Cell(ROW({ exclusive_use: 'unclear' }, {}), LM.MATRIX13[10], null, OPTS);
  eq(c.state, 'unclear'); eq(c.text, 'Unclear'); eq(LM.csvText(c), 'Unclear');
});
t('an unclear value is written with its value AND marked unclear in the CSV', () => {
  eq(LM.csvText(LM.matrix13Cell(ROW({ co_tenancy: 'unclear' }, { co_tenancy: 'Anchor open' }), LM.MATRIX13[11], null, OPTS)), 'Anchor open (unclear)');
});

const NONE_Q = 'Tenant shall not pay percentage rent.';
const PCT = LM.MATRIX13[8];
t('"None (stated)": the value None, its denying clause in hand, read from a document', () => {
  const c = LM.matrix13Cell(ROW({ percentage_rent: 'ai_extracted' }, { percentage_rent: 'None' }, { quotes: { percentage_rent: NONE_Q } }), PCT, null, OPTS);
  eq(c.text, 'None (stated)'); ok(c.noneStated); eq(LM.csvText(c), 'None (stated)');
});
t('and when a person confirmed that reading', () => {
  ok(LM.matrix13Cell(ROW({ percentage_rent: 'verified' }, { percentage_rent: 'None' }, { quotes: { percentage_rent: NONE_Q } }), PCT, null, OPTS).noneStated);
});
t('never for a silent document — that is Not established', () => {
  const c = LM.matrix13Cell(ROW({ percentage_rent: 'missing' }, { percentage_rent: null }), PCT, null, OPTS);
  ok(!c.noneStated); eq(LM.csvText(c), 'Not established');
});
t('never with no clause behind it', () => {
  ok(!LM.matrix13Cell(ROW({ percentage_rent: 'ai_extracted' }, { percentage_rent: 'None' }), PCT, null, OPTS).noneStated);
});
t('never for an unclear reading (a "None" whose clause does not deny it resolves unclear)', () => {
  const r = AT.resolveFamilyTerms([Object.assign({}, SHOP_DOCS[0], { id: 'x1', doc_type: 'original_lease', doc_type_status: 'confirmed',
    abstracted_fields: { schemaVersion: 1, model: 'm', at: 'x', fields: { percentage_rent: { value: 'None', quote: 'Tenant shall pay percentage rent per Exhibit C.' } } } })], [], { reasoner: LI });
  eq(r.terms.percentage_rent.state, 'unclear');
  const row = AL.tenantRowFor({ id: 'f' }, r);
  const c = LM.matrix13Cell(row, PCT, r.terms.percentage_rent, OPTS);
  ok(!c.noneStated); eq(c.state, 'unclear'); eq(LM.csvText(c), 'None (unclear)');
});
t('never for a value a person typed with no document (entered) — it reads "None", marked entered', () => {
  const c = LM.matrix13Cell(ROW({ percentage_rent: 'verified' }, { percentage_rent: 'None' }, { origins: { percentage_rent: 'entered' } }), PCT, null, OPTS);
  ok(!c.noneStated); eq(c.state, 'entered'); eq(c.text, 'None');
});

// ── 3 · where it came from ──────────────────────────────────────────────────
sec('3 · the governing document and the readings it replaced (F3)');
t('Base Rent names its governing document, its type, its date and its clause', () => {
  const s = cellOf(M, 'base_rent').source;
  eq(s.fileName, 'Maple_Plaza_Test_Lease_Amendment.pdf'); eq(s.docType, 'amendment'); eq(s.docDate, '2027-01-01');
  ok(/\$19\.25 per rentable square foot/.test(s.quote)); eq(s.page, 1);
});
t('the reading it replaced is kept — the undated renewal\'s 1,202,500, with its clause', () => {
  const p = cellOf(M, 'base_rent').source.prior;
  eq(p.length, 1); eq(p[0].value, 1202500); eq(p[0].fileName, 'ShopRite_Anchor_Tenant_Lease.pdf'); eq(p[0].docDate, null);
  ok(/\$18\.50 per square foot/.test(p[0].quote));
});
t('a contested cell carries what each document says', () => {
  const r = cellOf(M, 'options').source.readings;
  eq(r.length, 2); deq(r.map(x => x.fileName).sort(), ['Maple_Plaza_Test_Lease_Amendment.pdf', 'ShopRite_Anchor_Tenant_Lease.pdf']);
});
t('a decision on the term travels with it', () => ok(cellOf(M, 'sqft').source.decision && cellOf(M, 'sqft').source.decision.action));
t('a term no document establishes has no governing document', () => eq(cellOf(M, 'pct_rent').source.fileName, null));

// ── 4 · the CSVs ────────────────────────────────────────────────────────────
sec('4 · the CSVs');
const CSV = LM.matrix13Csv(M);
const lines = CSV.replace(/^\uFEFF/, '').split('\r\n');
t('UTF-8 with a BOM, CRLF lines, the thirteen headers in order', () => {
  eq(CSV.charCodeAt(0), 0xFEFF); eq(lines[0], HEADERS.join(','));
});
t('no data cell is blank — every state has words', () => {
  ok(!/(^|,)(,|$)/.test(lines[1]), lines[1]);
});
t('Contested and Not established are written as words', () => ok(/Contested/.test(lines[1]) && /Not established/.test(lines[1])));
t('the unmatched entries are left out, and the file says so', () => ok(/^"?Not included: 1 extracted entry not matched to a tenant/m.test(CSV.replace(/^\uFEFF/, ''))));
t('with none unmatched, there is no note', () => ok(!/Not included/.test(LM.matrix13Csv(LM.buildMatrix13([SHOP_ROW], {}, OPTS)))));
t('a cell a spreadsheet would run as a formula is written as text', () => {
  eq(LM.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"'); eq(LM.csvCell('+1'), "'+1"); eq(LM.csvCell('-1'), "'-1");
  eq(LM.csvCell('@SUM(A1)'), "'@SUM(A1)"); eq(LM.csvCell('\tx'), "'\tx");
  eq(LM.csvCell('a, b'), '"a, b"'); eq(LM.csvCell('say "hi"'), '"say ""hi"""'); eq(LM.csvCell(null), '');
});
t('the sources CSV: its headers, then one row per leasehold × column', () => {
  const p = LM.matrix13ProvenanceCsv(M).replace(/^\uFEFF/, '').trim().split('\r\n');
  eq(p[0], LM.PROVENANCE_HEADERS.join(',')); eq(p.length, 1 + 13);
});
t('it names an undated governing document "Undated", never a blank date', () => {
  const p = LM.matrix13ProvenanceCsv(M).replace(/^\uFEFF/, '');
  ok(/Lease Exp\.,2\/28\/2039,[^\r\n]*,ShopRite_Anchor_Tenant_Lease\.pdf,renewal,Undated,/.test(p), 'the undated renewal governs Lease Exp.');
  ok(/Maple_Plaza_Test_Lease_Amendment\.pdf,amendment,1\/1\/2027,/.test(p));
});
t('and lists every earlier reading of a term, written in its field\'s type', () => ok(/ShopRite_Anchor_Tenant_Lease\.pdf \(undated\): \$1,202,500/.test(LM.matrix13ProvenanceCsv(M))));

// ── 5 · guard rails ─────────────────────────────────────────────────────────
sec('5 · guard rails');
const FIVE = ['rent_escalations', 'cam_recovery', 'tax_recovery', 'insurance_recovery', 'percentage_rent'];
t('the five are acquisition-only: the workspace tenant has no key for them', () => {
  FIVE.forEach(f => ok(!(f in (PL.TENANT_KEY || {})), f + ' reached TENANT_KEY'));
  const src = fs.readFileSync(path.join(ROOT, 'property-leaseholds.js'), 'utf8');
  const tk = src.slice(src.indexOf('var TENANT_KEY = {'), src.indexOf('};', src.indexOf('var TENANT_KEY = {')));
  FIVE.forEach(f => ok(tk.indexOf(f) < 0, f + ' is in TENANT_KEY'));
});
t('and the property tenant record does not keep them — normalizeTenant drops them', () => {
  const n = TN.normalizeTenant(Object.assign({ tenant_name: 'X' }, Object.fromEntries(FIVE.map(f => [f, 'v']))));
  FIVE.forEach(f => ok(!(f in n), f + ' survived normalizeTenant'));
});
t('the labels the property side shows agree with the resolver\'s', () => FIVE.forEach(f => eq(PL.fieldLabel(f), AT.FIELD_META[f].label, f)));
t('the re-read is merge-only: it saves the merged reading, and never a status, model or time', () => {
  const B = fnBody(S, 'acqReadNewTerms');
  ok(/AT\.mergeUnreadFields\(existing, reading/.test(B));
  const save = B.slice(B.indexOf('_acqSaveDocument({'), B.indexOf('})', B.indexOf('_acqSaveDocument({')));
  ok(/abstractedFields: m\.abstraction/.test(save));
  ok(!/abstractionStatus|abstractionModel|abstractedAt|abstractionError/.test(save), 'the re-read writes ' + save);
});
t('it merges onto the reading the database holds NOW, not the page\'s cache', () => {
  const B = fnBody(S, 'acqReadNewTerms');
  ok(B.indexOf('_acqLoadOneEvidence(docId)') >= 0 && B.indexOf('_acqLoadOneEvidence(docId)') < B.indexOf('claudeFetch('));
});
t('it asks for the unread keys only', () => ok(/Report ONLY these keys: \$\{want\.join\(', '\)\}/.test(fnBody(S, 'acqReadNewTerms'))));
t('a failure writes nothing — no `failed` status is recorded', () => {
  const B = fnBody(S, 'acqReadNewTerms');
  const fail = B.slice(B.indexOf('if (!m || !m.ok)'), B.indexOf('const saved'));
  ok(/return;/.test(fail) && !/_acqSaveDocument/.test(fail));
});
t('a closed acquisition is never read again, and a superseded or unread document is not offered', () => {
  const G = fnBody(S, '_acqCanReadNewTerms');
  ok(/_acqFrozen\(reviewId\)/.test(G) && /superseded_by_document_id/.test(G) && /abstraction_status !== 'success' && r\.abstraction_status !== 'partial'/.test(G));
  ok(/_acqCanReadNewTerms\(reviewId, row\)/.test(fnBody(S, 'acqReadNewTerms')));
});
t('the summary stays the default view; the choice is kept per viewer, in try/catch', () => {
  ok(/localStorage\.getItem\('acqMatrixView'\) === 'acquisition' \? 'acquisition' : 'summary'/.test(S));
  ok(/catch \(_\) \{ return 'summary'; \}/.test(S));
});
t('no clause, value, file name or label reaches the sources panel unescaped', () => {
  const B = fnBody(S, '_acqM13DetailHtml');
  const raw = B.match(/\$\{(?!esc\()[^{}]*\b(quote|value|fileName|text|note|tenant|header|docType|label)\b[^{}]*\}/g) || [];
  deq(raw.filter(x => !/^\$\{(s\.quote \?|p\.quote \?|r\.quote \?|s\.note &&)/.test(x)), [], 'raw interpolation');
});
t('every value the thirteen-column view prints into HTML is escaped', () => {
  for (const name of ['_acqLeaseMatrix13Html', '_acqM13DetailHtml', '_acqM13CellHtml', '_acqMatrixViewSwitchHtml']) {
    const B = fnBody(S, name);
    const raw = (B.match(/\$\{(?!esc\()[^}]*\}/g) || [])
      .filter(s => !/^\$\{(_acqMatrixViewSwitchHtml\(\)|_acqLmCellHtml\(c\)|_acqM13CellHtml\(c\)|_acqUnfiledListHtml|sub\}|none\}|head\}|body\}|n\}|n ===|m\.unfiled\}|dueText \?|open \?|i === 0 \?|l\.cells\.slice|m\.leaseholds\.map|m\.columns\.map|gov\}|decided\}|readings\}|priorHtml\}|s\.note &&|s\.quote \?|s\.docStatus|s\.readings\.map|prior\.length\}|prior\.length\s|prior\.map|p\.quote \?|r\.quote \?|_acqMatrixView === v|v\}|label\}|tab\(|c\.state === 'contested' \? 'Ranked first|c\.state === 'entered' \? 'None — entered|s\.decision\.decidedAt \? ' on ' \+ esc\()/.test(s));
    deq(raw, [], name + ' interpolates without esc()');
  }
});

// ── 6 · readings are written in their field's type (fix: raw 1202500) ─────
sec('6 · earlier and competing readings are written in their field\'s type');
t('readingText: money as dollars, percent with %, a count with separators, a date M/D/YYYY', () => {
  eq(LM.readingText(1202500, 'money'), '$1,202,500');
  eq(LM.readingText(1251250.5, 'money'), '$1,251,250.5');
  eq(LM.readingText(4, 'percent'), '4%');
  eq(LM.readingText(65000, 'number'), '65,000');
  eq(LM.readingText('2024-03-01', 'date'), '3/1/2024');
  eq(LM.readingText(true, 'boolean'), 'Yes');
});
t('readingText never makes text, a count or a date into currency', () => {
  eq(LM.readingText("120 days' prior written notice", 'text'), "120 days' prior written notice");
  eq(LM.readingText('1202500', 'text'), '1202500');
  ok(!/\$/.test(LM.readingText(65000, 'number')), 'a square footage became money');
  ok(!/\$/.test(LM.readingText(4, 'percent')), 'a percentage became money');
  ok(!/\$/.test(LM.readingText('2034-02-28', 'date')), 'a date became money');
});
t('a reading with no value says — rather than blank or "null"', () => {
  eq(LM.readingText(null, 'money'), '—'); eq(LM.readingText(undefined, 'text'), '—'); eq(LM.readingText('', 'text'), '—');
});
t('Base Rent\'s earlier reading is written $1,202,500 — and its stored value is still the number', () => {
  const p = cellOf(M, 'base_rent').source.prior[0];
  eq(p.text, '$1,202,500'); eq(p.value, 1202500);
});
t('a square footage reading is written 65,000, never as money', () => {
  const sq = cellOf(M, 'sqft').source.prior;
  ok(sq.length >= 1, 'no earlier sq-ft reading in the fixture');
  sq.forEach(p => { eq(p.text, '65,000'); ok(!/\$/.test(p.text)); });
});
t('competing readings of a money term are each written as dollars', () => {
  const at = (id, date, v) => Object.assign({}, SHOP_DOCS[0], { id, file_name: id + '.pdf', doc_type: 'amendment', doc_type_status: 'confirmed', doc_date: date,
    abstracted_fields: { schemaVersion: 1, model: 'm', at: 'x', fields: { base_rent: { value: v, quote: 'base rent of $' + v.toLocaleString('en-US') } } } });
  const r = AT.resolveFamilyTerms([at('a1', '2025-01-01', 1202500), at('a2', '2025-01-01', 1251250)], [], { reasoner: LI });
  eq(r.terms.base_rent.state, 'conflicting');
  const row = AL.tenantRowFor({ id: 'f' }, r);
  const c = LM.matrix13Cell(row, LM.MATRIX13[3], r.terms.base_rent, OPTS);
  deq(c.source.readings.map(x => x.text).sort(), ['$1,202,500', '$1,251,250']);
  deq(c.source.readings.map(x => x.value).sort(), [1202500, 1251250], 'the stored values were changed');
});
t('a competing text reading is written exactly as read', () => {
  const r = cellOf(M, 'options').source.readings;
  ok(r.some(x => /fifteen \(15\) years/.test(x.text)) && r.every(x => x.text === x.value || x.text === '—'));
});
t('the provenance CSV writes a square footage reading as a count, not money', () => {
  ok(/\(undated\): 65,000/.test(LM.matrix13ProvenanceCsv(M)) && !/\$65,000/.test(LM.matrix13ProvenanceCsv(M)));
});
t('building the matrix leaves the documents\' stored evidence untouched', () => {
  const before = JSON.stringify(SHOP_DOCS.map(d => d.abstracted_fields));
  LM.matrix13ProvenanceCsv(LM.buildMatrix13([SHOP_ROW], { [F.FAM.shoprite]: SHOP_RES.terms }, OPTS));
  eq(JSON.stringify(SHOP_DOCS.map(d => d.abstracted_fields)), before);
});
t('the sources panel draws the written reading, never the raw value', () => {
  const B = fnBody(S, '_acqM13DetailHtml');
  ok(/esc\(r\.text \|\| '—'\)/.test(B) && /esc\(p\.text \|\| '—'\)/.test(B), 'the panel draws a raw value');
  ok(!/String\(r\.value\)|String\(p\.value\)/.test(B));
});
t('the record\'s own "Replaced" and contested values are written in the term\'s type', () => {
  const B = fnBody(S, '_renderAcqTerms');
  ok(/Replaced \$\{esc\(_acqTermValue\(\{ value: term\.supersededValues\[0\]\.value, type: term\.type \}\)/.test(B), 'Replaced is raw');
  ok(/\(c\.values \|\| \[\]\)\.map\(v => _acqTermValue\(\{ value: v, type: term\.type \}\)/.test(B), 'contested values are raw');
});

// ── 7 · the Tenant row header keeps a long name inside its sticky cell ─────
sec('7 · a long tenant name stays inside the Tenant column');
const H = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
t('the tenant ROW header wraps and clips inside its own cell — it does not inherit the column headers\' nowrap', () => {
  ok(/\.acq-m13-table tbody \.acq-m13-tenant \{[^}]*white-space: normal;[^}]*overflow: hidden;[^}]*\}/.test(H));
  ok(/\.acq-m13-table tbody \.acq-m13-tenant \{[^}]*max-width: 170px;/.test(H));
});
t('the column headers keep nowrap — the fix is scoped to the row header', () => {
  ok(/\.acq-m13-table th \{[^}]*white-space: nowrap;[^}]*\}/.test(H));
});
t('a long name is clamped to two lines with an ellipsis, breaking long words', () => {
  ok(/\.acq-m13-name \{[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;[^}]*overflow-wrap: anywhere;/.test(H));
});
t('the Tenant column is still sticky', () => ok(/\.acq-m13-table \.acq-m13-tenant \{ position: sticky; left: 0;/.test(H)));
t('the full name stays available: the button\'s title names it, and its text is the whole name', () => {
  const B = fnBody(S, '_acqLeaseMatrix13Html');
  ok(/title="\$\{esc\('Open the lease record: ' \+ l\.tenant\)\}"><span class="acq-m13-name">\$\{esc\(l\.tenant\)\}<\/span>/.test(B));
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
