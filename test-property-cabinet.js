'use strict';
/**
 * test-property-cabinet.js — Property Workspace V2, Phase 0: the cabinet as data.
 *
 * Every assertion here is about what PropertyCabinet ANSWERS, never about how
 * it is written. The drawer map is checked against the REAL category registry
 * in property-timeline.js — loaded under a stubbed window/document, not grepped
 * — so a category added there without a drawer here is caught.
 *
 * FIXTURES ARE BUILT SO RIGHT AND WRONG DIFFER. A record with BOTH a category
 * and a system subject (category must win); an invoice with a spaceId beside
 * one without; a vacant row whose flag is the STRING 'true'; a date exactly one
 * day past the horizon; two findings whose only difference is the thing under
 * test.
 *
 * Run: node test-property-cabinet.js
 */
const path = require('path');

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);

const PC = require('./property-cabinet.js');
const TN = require('./tenant-normalize.js');

// ── The real registry, loaded as a module, not read as text ─────────────────
// property-timeline.js assigns to window and injects a <style> at load, so it
// gets a window and a document that accept that and do nothing.
function loadPropertyTimeline() {
  const doc = {
    readyState: 'complete',
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    head: { appendChild() {} }, body: { appendChild() {} },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {},
  };
  const hadW = Object.prototype.hasOwnProperty.call(global, 'window');
  const hadD = Object.prototype.hasOwnProperty.call(global, 'document');
  const pw = global.window, pd = global.document;
  try {
    global.window = {}; global.document = doc;
    delete require.cache[require.resolve('./property-timeline.js')];
    require('./property-timeline.js');
    return global.window.PropertyTimeline;
  } finally {
    if (hadW) global.window = pw; else delete global.window;
    if (hadD) global.document = pd; else delete global.document;
  }
}
const PT = loadPropertyTimeline();

// ── Fixture builders ────────────────────────────────────────────────────────
const ev = (o) => Object.assign({ id: 'tl-' + Math.random().toString(36).slice(2, 8),
  timestamp: '2025-06-01T12:00:00.000Z', type: 'manual_other', manual: true,
  subject: { type: 'property', id: 'p1', label: null }, attachments: [] }, o);
const rec = (category, extra) => ev(Object.assign({ category, type: 'manual_' + category }, extra || {}));
const auto = (type, extra) => ev(Object.assign({ type, manual: false, category: null }, extra || {}));
const inv = (o) => Object.assign({ id: 'inv-' + Math.random().toString(36).slice(2, 8),
  vendorName: 'Vendor', category: 'other', amount: 100, invoiceDate: '2025-03-01' }, o);

// ═══ A · every real category has a home ════════════════════════════════════
sec('A · every category the timeline registers resolves to a drawer');
const catKeys = (PT.categories || []).map(c => c.key);
(catKeys.length >= 15) ? ok(`the real registry loaded (${catKeys.length} categories)`)
                       : bad('registry did not load', JSON.stringify(catKeys));
const uncovered = PC.uncoveredCategories(catKeys);
is(uncovered.sort(), ['other', 'tenant'],
   'exactly two categories fall back to History by design: other, tenant');
let allResolve = true;
catKeys.forEach(k => {
  const r = PC.drawerOfRecord(rec(k));
  if (!r || !PC.drawer(r.drawer)) { allResolve = false; bad(`category ${k} did not resolve`, JSON.stringify(r)); }
});
if (allResolve) ok('every category resolves to a drawer that exists');
const nonFallback = catKeys.filter(k => PC.drawerOfRecord(rec(k)).reason === 'category');
is(nonFallback.length, catKeys.length - uncovered.length,
   'and every covered category is filed by category, not by fallback');

// ═══ B · one home, and the order of precedence ═════════════════════════════
sec('B · one home per record');
is(PC.drawerOfRecord(rec('real_estate_taxes')), { drawer: 'taxes', reason: 'category' }, 'a tax bill files under Taxes');
is(PC.drawerOfRecord(rec('insurance', { subject: { type: 'system', id: 'roof' } })),
   { drawer: 'insurance', reason: 'category' },
   'a category WINS over a system subject — a roof insurance claim is Insurance, not Building');
is(PC.drawerOfRecord(rec('other', { subject: { type: 'system', id: 'hvac' } })),
   { drawer: 'building', reason: 'system' },
   "category 'other' names no drawer, so the system subject the user attached it to files it — by subject, not by guess");
is(PC.drawerOfRecord(rec('other', { subject: { type: 'property', id: 'p1' } })),
   { drawer: 'history', reason: 'fallback' },
   "category 'other' on the property itself falls back to History");
// A row whose category and type disagree (category edited by a build that did
// not rewrite type). The timeline describes it by category; so must the cabinet.
const disagree = ev({ manual: true, category: 'insurance', type: 'manual_other' });
is(PC.drawerOfRecord(disagree), { drawer: 'insurance', reason: 'category' },
   'when category and type disagree on a manual record, category is the authority');
is(PT.describe(disagree).label, PT.describe(rec('insurance')).label,
   '…exactly as PropertyTimeline.describe() reads the same row');
const autoWithCat = auto('cam_reconciled', { category: 'insurance' });
is(PC.drawerOfRecord(autoWithCat), { drawer: 'financials', reason: 'type' },
   'a category on an AUTO event is not consulted — the type describes it, as the timeline does');
is(PC.drawerOfRecord(ev({ manual: true, category: null, type: 'manual_real_estate_taxes' })),
   { drawer: 'taxes', reason: 'category' },
   'a manual row written before category existed is read from its manual_<category> type');
is(PC.drawerOfRecord(auto('inspection_note', { subject: { type: 'system', id: 'hvac' } })),
   { drawer: 'building', reason: 'system' },
   'an unfiled record on a building system goes to Building & Systems by its subject');
is(PC.drawerOfRecord(auto('reserve_updated')), { drawer: 'financing', reason: 'type' }, 'reserve_updated files under Financing');
is(PC.drawerOfRecord(auto('cam_reconciled')), { drawer: 'financials', reason: 'type' }, 'cam_reconciled files under Financials');
is(PC.drawerOfRecord(auto('sync_restored')), { drawer: 'history', reason: 'fallback' }, 'a system-noise event falls back to History');
is(PC.drawerOfRecord(ev({ manual: true, category: null, type: 'manual_real_estate_taxes' })),
   { drawer: 'taxes', reason: 'category' },
   'a manual record whose type carries the category (manual_<category>) still files correctly');
is(PC.drawerOfRecord(ev({ manual: true, category: null, type: 'manual_reserve_updated' })),
   { drawer: 'history', reason: 'fallback' },
   'but a manual record is never read as an AUTO type');
is(PC.drawerOfRecord(rec('lease')), { drawer: 'agreements', reason: 'category' },
   'a property-scoped lease record is an agreement about the building');
is(PC.drawerOfRecord(rec('vendor')), { drawer: 'agreements', reason: 'category' }, 'a vendor contract is an agreement');
is(PC.drawerOfRecord(rec('warranty')), { drawer: 'building', reason: 'category' }, 'a warranty is Building & Systems');

// ═══ C · scope: whose record is this ═══════════════════════════════════════
sec('C · a Space’s record is not the property’s');
is(PC.drawerOfRecord(rec('insurance', { subject: { type: 'suite', id: 't1', label: 'Suite 100' } })), null,
   'a suite-scoped record returns no drawer — it belongs to the Space');
is(PC.drawerOfRecord(rec('insurance', { subject: undefined, tenantId: 't1' })), null,
   'a bare tenantId is a Space record too');
is(PC.drawerOfRecord(rec('insurance', { subject: undefined, tenantId: null })).drawer, 'insurance',
   'no subject and no tenantId is the property’s');
is(PC.scopeOf(rec('x', { subject: { type: 'building', id: 'b' } })), 'space',
   'an unknown subject type is not assumed to be the property’s');

// ═══ D · invoices ═══════════════════════════════════════════════════════════
sec('D · an invoice related to a space files under the space');
is(PC.drawerOfInvoice(inv({})), 'invoices', 'an unrelated invoice is a property record');
is(PC.drawerOfInvoice(inv({ spaceId: 't1' })), null, 'an invoice with a spaceId is the Space’s');
is(PC.drawerOfInvoice(null), null, 'and nothing is not an invoice');

// ═══ E · the index ══════════════════════════════════════════════════════════
sec('E · buildIndex counts each record once, in its home');
const P = {
  id: 'p1',
  timeline: [
    rec('real_estate_taxes', { id: 'tax-24', timestamp: '2024-04-10T00:00:00Z' }),
    rec('real_estate_taxes', { id: 'tax-25', timestamp: '2025-04-10T00:00:00Z' }),
    rec('insurance',         { id: 'ins-25', timestamp: '2025-09-01T00:00:00Z' }),
    rec('other',             { id: 'misc',   timestamp: '2025-01-01T00:00:00Z' }),
    rec('insurance',         { id: 'space-ins', subject: { type: 'suite', id: 't1' } }),
    auto('sync_restored',    { id: 'sync', timestamp: 'not-a-date' }),
  ],
  invoices: [
    inv({ id: 'i1', vendorName: 'Austin Energy', category: 'utilities', invoiceDate: '2025-03-31' }),
    inv({ id: 'i2', vendorName: 'Austin Energy', category: 'utilities', invoiceDate: '2025-06-30' }),
    inv({ id: 'i3', vendorName: 'PavePro',       category: 'repairs',   invoiceDate: '2024-11-02' }),
    inv({ id: 'i4', vendorName: 'Undated Co',    category: 'other',     invoiceDate: '' }),
    inv({ id: 'i5', vendorName: 'Tenant Vendor', category: 'repairs',   invoiceDate: '2025-02-02', spaceId: 't1' }),
  ],
  escrowReserves: [
    { id: 'r1', reserveType: 'roof', reserveTypeLabel: 'Roof Reserve',
      sourceDocuments: [{ fileName: 'loan.pdf', fileUrl: 'u', uploadedAt: '2025-05-05T00:00:00Z' }] },
  ],
  tenants: [
    { id: 't1', tenant_name: 'Alder Dental', suite: '100', leased_sqft: '1,250', end_date: '2027-01-31' },
    { id: 't2', tenant_name: 'Vacant',       suite: '110', leased_sqft: 900,     vacant: true },
  ],
};
const X = PC.buildIndex(P);
is(X.drawers.taxes.count, 2, 'two tax records');
is(X.drawers.taxes.years, { '2024': 1, '2025': 1 }, 'grouped by year from timestamp');
is(X.drawers.insurance.count, 1, 'one property insurance record');
is(X.drawers.insurance.records, ['ins-25'], 'and the suite-scoped insurance record is NOT in it');
is(X.records.some(r => r.id === 'space-ins'), false, 'the suite-scoped record is not in the cabinet at all');
is(X.drawers.history.count, 2, 'History COUNTS only the records it is home to (other + sync_restored)');
is(X.drawers.history.records.length, 5, 'but LISTS every property record — the view, not a second count');
is(X.drawers.history.years, { '2025': 1, 'undated': 1 }, 'an unreadable timestamp is filed as undated, not dropped');
is(X.drawers.invoices.count, 4, 'four property invoices (the space-scoped one is excluded)');
is(X.invoices.total, 4, 'the register total agrees');
is(X.invoices.byYear, { '2025': 2, '2024': 1 }, 'invoices by year');
is(X.invoices.undated, 1, 'the undated invoice is counted as undated');
is(X.invoices.byVendor['Austin Energy'], 2, 'two Austin Energy invoices are two, not one');
is(X.invoices.byCategory, { utilities: 2, repairs: 1, other: 1 }, 'by category');
is(X.invoices.bySpace, { t1: 1 }, 'the space-scoped invoice is counted against its space');
is(X.drawers.financing.count, 1, 'a reserve document counts under Financing');
is(X.drawers.financing.sources[0].kind, 'reserve', 'as a POINTER to the reserve');
is(X.drawers.financing.sources[0].reserveId, 'r1', 'naming which reserve holds it');
is(X.spaces, { total: 2, occupied: 1, vacant: 1 }, 'one occupied space, one vacant');
const sumHomes = PC.drawerKeys().filter(k => k !== 'history').reduce((s, k) => s + X.drawers[k].count, 0)
               + X.drawers.history.count;
is(sumHomes, X.records.length + X.invoices.total + 1, 'every record, invoice and reserve doc is counted exactly once across the tiles');

// ═══ F · invoiceQuery ═══════════════════════════════════════════════════════
sec('F · invoices are answered a page at a time');
const many = { invoices: [] };
for (let i = 0; i < 120; i++) {
  many.invoices.push(inv({ id: 'm' + i, vendorName: i % 3 === 0 ? 'Acme' : 'Beta',
    category: i % 2 === 0 ? 'utilities' : 'repairs',
    invoiceDate: '2025-01-' + String(1 + (i % 28)).padStart(2, '0') }));
}
many.invoices.push(inv({ id: 'sp', vendorName: 'Acme', spaceId: 't9' }));
let q = PC.invoiceQuery(many, { pageSize: 50 });
is([q.total, q.pages, q.page, q.items.length], [120, 3, 1, 50], '120 property invoices → 3 pages of 50');
q = PC.invoiceQuery(many, { pageSize: 50, page: 3 });
is(q.items.length, 20, 'the last page holds the remainder');
q = PC.invoiceQuery(many, { pageSize: 50, page: 99 });
is(q.page, 3, 'a page past the end clamps to the last page');
is(PC.invoiceQuery(many, {}).items.some(i => i.id === 'sp'), false, 'the space-scoped invoice is excluded by default');
is(PC.invoiceQuery(many, { spaceId: 't9' }).items.map(i => i.id), ['sp'], 'and returned only when its space is asked for');
is(PC.invoiceQuery(many, { vendor: 'Acme', category: 'utilities' }).total, 20, 'filters are ANDed (Acme ∧ utilities = 20)');
is(PC.invoiceQuery(many, { q: 'acm' }).total, 40, 'free text matches the vendor, case-insensitively');
is(PC.invoiceQuery(many, { q: 'repair' }).total, 60, 'and the category');
const withUndated = { invoices: [inv({ id: 'a', invoiceDate: '2025-01-05' }), inv({ id: 'b', invoiceDate: '' }), inv({ id: 'c', invoiceDate: '2025-02-05' })] };
is(PC.invoiceQuery(withUndated, {}).items.map(i => i.id), ['c', 'a', 'b'], 'newest first, and an undated invoice never floats to the top');
is(PC.invoiceQuery(withUndated, { year: 'undated' }).items.map(i => i.id), ['b'], "year: 'undated' selects exactly the undated ones");
is(PC.invoiceQuery(withUndated, { year: 2025 }).total, 2, 'a numeric year works');

// ═══ G · Important Dates ════════════════════════════════════════════════════
sec('G · every important date has a source, and the horizon is exact');
const NOW = '2026-01-01T00:00:00Z';
const DP = {
  tenants: [
    { id: 't1', tenant_name: 'Alder Dental', end_date: '2026-03-01' },          // 59 days
    { id: 't2', tenant_name: 'Vacant',       end_date: '2026-02-01', vacant: true },
    { id: 't3', tenant_name: 'Late Corp',    end_date: '2026-04-02' },          // 91 days
    { id: 't4', tenant_name: 'Gone Inc',     end_date: '2025-12-01' },          // past
    { id: 't5', tenant_name: 'No Date' },
  ],
  info: { insuranceExpires: '2026-01-20', insuranceCarrier: 'Travelers', insurancePolicyNo: 'TRV-1' },
  escrowReserves: [
    { id: 'r1', reserveTypeLabel: 'Roof Reserve', deadlines: { reserveExpirationDate: '2026-02-15' } },
    { id: 'r2', reserveTypeLabel: 'No Deadline',  deadlines: {} },
  ],
  timeline: [
    rec('real_estate_taxes', { id: 'tax', title: 'Q1 tax bill', keyDate: '2026-01-31', keyDateKind: 'deadline' }),
    rec('insurance',         { id: 'badkind', title: 'Odd', keyDate: '2026-02-10', keyDateKind: 'whatever' }),
    rec('insurance',         { id: 'spacedate', title: 'Suite date', keyDate: '2026-01-10', subject: { type: 'suite', id: 't1' } }),
    rec('insurance',         { id: 'baddate', title: 'Junk', keyDate: 'soon' }),
  ],
};
const D = PC.importantDates(DP, { now: NOW });
const ids = D.map(d => d.source.type + ':' + d.source.id);
is(D.every(d => d.source && d.source.type && d.date), true, 'every entry carries a date and a typed source');
is(ids.includes('tenant:t1'), true, 'an occupied lease ending in 59 days is listed');
is(ids.includes('tenant:t2'), false, 'a VACANT row’s date is not a lease expiration');
is(ids.includes('tenant:t3'), false, 'a date 91 days out is outside a 90-day horizon');
is(ids.includes('tenant:t4'), false, 'a past date is excluded by default');
is(ids.includes('tenant:t5'), false, 'no date, no entry');
is(ids.includes('info:insuranceExpires'), true, 'insurance renewal comes from info');
is(D.find(d => d.source.id === 'insuranceExpires').drawer, 'insurance', 'and points at the Insurance drawer');
is(ids.includes('reserve:r1'), true, 'a reserve expiration comes from its deadlines');
is(D.find(d => d.source.id === 'r1').drawer, 'financing', 'and points at Financing');
is(ids.includes('reserve:r2'), false, 'a reserve with no deadline contributes nothing');
is(ids.includes('record:tax'), true, 'a record keyDate is listed');
is(D.find(d => d.source.id === 'tax').drawer, 'taxes', 'and points at the record’s own drawer');
is(D.find(d => d.source.id === 'badkind').kind, 'deadline', 'an unknown keyDateKind reads as a deadline, never as the raw string');
is(ids.includes('record:spacedate'), false, 'a Space’s keyDate is the Space’s');
is(ids.includes('record:baddate'), false, 'an unreadable keyDate is not invented into a date');
is(D.map(d => d.daysOut), D.map(d => d.daysOut).slice().sort((a, b) => a - b), 'sorted soonest first');
is(PC.importantDates(DP, { now: NOW, horizonDays: null }).some(d => d.source.id === 't3'), true, 'no horizon includes the 91-day date');
is(PC.importantDates(DP, { now: NOW, includePast: true }).some(d => d.source.id === 't4'), true, 'includePast includes the past one');
is(PC.importantDates(DP, { now: NOW, horizonDays: 90 }).some(d => d.source.id === 't3'), false, 'the horizon is inclusive at 90 and exclusive at 91');

// ═══ H · addressing ═════════════════════════════════════════════════════════
sec('H · one address format, round-tripped');
const A1 = { tab: 'property', drawer: 'taxes', year: '2025', recordId: 'tl-abc' };
is(PC.address(A1), '#property/taxes/2025/tl-abc', 'drawer + year + record');
is(PC.parseAddress(PC.address(A1)), A1, 'round-trips');
const A2 = { tab: 'property', drawer: 'insurance', recordId: 'x/y' };
is(PC.parseAddress(PC.address(A2)), { tab: 'property', drawer: 'insurance', recordId: 'x/y' },
   'a record with no year and a slash in its id round-trips');
is(PC.parseAddress('#property/taxes/2025'), { tab: 'property', drawer: 'taxes', year: '2025' }, 'drawer + year only');
is(PC.parseAddress('#property/nope/2025'), { tab: 'property' }, 'an unknown drawer degrades to the tab, not to a guess');
is(PC.parseAddress(PC.address({ tab: 'spaces', spaceId: 'mp t1' })), { tab: 'spaces', spaceId: 'mp t1' }, 'a space address round-trips with encoding');
is(PC.parseAddress(''), null, 'an empty hash is no address');
is(PC.address({}), '', 'no tab, no address');

// ═══ I · vacancy ════════════════════════════════════════════════════════════
sec('I · a vacant space is a space, not a tenant');
is(PC.isVacant({ vacant: true }), true, 'vacant: true is vacant');
is(PC.isVacant({ vacant: 'true' }), false, "the STRING 'true' is not — the flag is strictly boolean");
is(PC.isVacant({ vacant: 1 }), false, 'nor is 1');
is(PC.isVacant({}), false, 'absent is occupied');
const VP = { tenants: [
  { id: 'a', tenant_name: 'Alder', suite: '100', leased_sqft: '1,250', end_date: '2027-01-31' },
  { id: 'b', tenant_name: 'Vacant', suite: '110', leased_sqft: 900, vacant: true, end_date: '2020-01-01' },
  { id: 'c', tenant_name: '', unitNumber: '120', leased_sqft: 0 },
  null,
]};
is(PC.activeTenants(VP).map(t => t.id), ['a', 'c'], 'activeTenants excludes the vacant row and nulls');
const rows = PC.spaces(VP);
is(rows.length, 3, 'spaces() lists every physical space, vacant included');
is(rows[1], { id: 'b', suite: '110', tenant: null, sqft: 900, leaseEnd: null, vacant: true, status: 'vacant' },
   'a vacant row keeps its suite and area, has no tenant and no lease end');
is(rows[0].sqft, 1250, "area is parsed from '1,250'");
is(rows[2].suite, '120', 'unitNumber serves as the suite when suite is absent');

// ═══ J · the allow-list keeps the flag ══════════════════════════════════════
sec('J · normalizeTenant preserves vacancy across a load');
is(TN.normalizeTenant({ tenant_name: 'Vacant', suite: '110', leased_sqft: 900, vacant: true }).vacant, true,
   'vacant: true survives normalizeTenant');
is(TN.normalizeTenant({ tenant_name: 'X', vacant: 'yes' }).vacant, false, "a non-boolean 'yes' normalises to not vacant");
is(TN.normalizeTenant({ tenant_name: 'X' }).vacant, false, 'absent normalises to false, not undefined');
is(TN.normalizeTenant({ tenant_name: 'X', suite: '110', vacant: true }).suite, '110', 'and the suite survives beside it');
const twice = TN.normalizeTenant(TN.normalizeTenant({ tenant_name: 'V', vacant: true }));
is(twice.vacant, true, 'a second pass (every load re-normalises) keeps it');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
