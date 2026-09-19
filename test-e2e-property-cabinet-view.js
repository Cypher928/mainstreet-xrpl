// test-e2e-property-cabinet-view.js
// ============================================================================
// PROPERTY WORKSPACE V2, PHASE 1 — the filing cabinet as a surface.
//
// What this proves, in a real browser against the real modules:
//   · the landing page answers "what is this property, what needs my
//     attention, where is everything" from the canonical index — every tile
//     count is held to PropertyCabinet.buildIndex(), never to markup;
//   · the attention mount shows the SAME items PropertyWorkspace ranks, and
//     the insurance item lands on the Insurance drawer;
//   · every record renders in exactly ONE drawer, History lists every one,
//     and a Space's record is in no drawer at all;
//   · Invoices is paged and filtered and never renders more than a page;
//   · Important Dates derives from the record and points at its sources;
//   · #property/<drawer>/<year>/<id> and #spaces/<id> open what they name;
//   · empty states are truthful; the legacy PropertyOS entry points still work;
//   · a record added from inside a drawer appears there without a reload.
//
// Fixture amounts, years and counts are chosen so that right and wrong differ:
// each drawer holds a different number of records, invoices span three years
// and three vendors, and one record lives under a suite.
//
// Run: node test-e2e-property-cabinet-view.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8963;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const same = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());

const MOCK = `window.supabase={createClient:function(){return {auth:{
    getUser:function(){return Promise.resolve({data:{user:{id:'u1',email:'dana@example.com'}},error:null});},
    getSession:function(){return Promise.resolve({data:{session:{user:{id:'u1',email:'dana@example.com'}}},error:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return Promise.resolve({error:null});}},
    rpc:function(){return Promise.resolve({data:null,error:null});},
    from:function(){var q={select:function(){return q;},eq:function(){return q;},neq:function(){return q;},
      is:function(){return q;},not:function(){return q;},order:function(){return q;},limit:function(){return q;},
      ilike:function(){return q;},in:function(){return Promise.resolve({data:[],error:null});},
      single:function(){return Promise.resolve({data:null,error:null});},
      insert:function(){var p=Promise.resolve({data:[],error:null});p.select=function(){return Promise.resolve({data:[],error:null});};return p;},
      upsert:function(){var p=Promise.resolve({data:[],error:null});p.select=function(){return Promise.resolve({data:[],error:null});};return p;},
      update:function(){return {eq:function(){return Promise.resolve({data:null,error:null});}};},
      delete:function(){return {eq:function(){return Promise.resolve({error:null});}};},
      then:function(f){return Promise.resolve({data:[],error:null}).then(f);}};return q;},
    storage:{from:function(){return {upload:function(){return Promise.resolve({data:{path:'x'},error:null});},
      getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`;

// ── The fixture ─────────────────────────────────────────────────────────────
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const YEAR = new Date().getFullYear();
function buildProperty() {
  const T = (id, name, suite, sqft, end, extra) => Object.assign(
    { id, tenant_name: name, suite, leased_sqft: sqft, start_date: '2021-01-01', end_date: end, lease_type: 'NNN', cap: 5, flags: [], confidence: {} }, extra || {});
  const tenants = [
    T('t1', 'Alder Dental',      '100', 4000, day(400)),
    T('t2', 'Birch Books',       '101', 2500, day(-20)),            // expired → attention
    T('t3', 'Cedar Cafe',        '102', 3000, day(120)),            // expiring within 12 months
    T('t4', 'Dogwood Fitness',   '103', 9000, day(200), { cap: null }), // NNN without a cap → attention
    T('t5', 'Elm Optical',       '104', 1800, day(900)),
    T('t6', 'Fir Pharmacy',      '105', 6200, day(1200)),
    T('t7', 'Ginkgo Tax',        '106', 3500, day(3000)),
    { id: 't8', tenant_name: 'Vacant', suite: '107', leased_sqft: 1500, vacant: true, flags: [], confidence: {} },
  ];
  let n = 0;
  const ev = (category, title, ts, subject, extra) => Object.assign({
    id: 'ev-' + (++n), manual: true, type: 'manual_' + category, category, title, timestamp: ts,
    subject: subject || { type: 'property', id: 'prop-maple', label: null },
    actor: 'dana@example.com', metadata: { recordedBy: 'dana@example.com' }, attachments: [],
  }, extra || {});
  const auto = (type, title, ts, extra) => Object.assign({ id: 'ev-' + (++n), manual: false, type, title, timestamp: ts,
    subject: { type: 'property', id: 'prop-maple', label: null }, actor: 'System', attachments: [] }, extra || {});
  const SYS = (id) => ({ type: 'system', id, label: id });
  const timeline = [
    ev('real_estate_taxes', `${YEAR - 2} tax bill`,        `${YEAR - 2}-03-01T12:00:00Z`, null, { attachments: [{ name: 'bill-2024.pdf', url: 'https://x/b24.pdf', kind: 'document' }] }),
    ev('real_estate_taxes', `${YEAR - 1} assessment`,      `${YEAR - 1}-02-10T12:00:00Z`),
    ev('real_estate_taxes', `${YEAR} appeal filed`,        `${YEAR}-01-20T12:00:00Z`),
    ev('insurance',         'Liability renewal',           `${YEAR - 1}-06-01T12:00:00Z`, null, { attachments: [{ name: 'policy.pdf', url: 'https://x/p.pdf', kind: 'document' }] }),
    ev('insurance',         'Certificate — Alder Dental',  `${YEAR}-02-01T12:00:00Z`,     null, { attachments: [{ name: 'coi.pdf', url: 'https://x/coi.pdf', kind: 'document' }] }),
    ev('mortgage_financing','Loan amendment #2',           `${YEAR}-03-15T12:00:00Z`),
    ev('payment',           'Owner distribution Q1',       `${YEAR}-04-01T12:00:00Z`),
    auto('cam_reconciled',  'CAM reconciliation run',      `${YEAR}-04-02T12:00:00Z`),
    ev('vendor',            'Snow removal contract',       `${YEAR - 1}-11-01T12:00:00Z`),
    ev('vendor',            'Landscaping agreement',       `${YEAR}-03-01T12:00:00Z`),
    ev('warranty',          'Roof membrane warranty',      `${YEAR}-05-01T12:00:00Z`, SYS('roof')),
    ev('capital_improvement','Roof replaced',              `${YEAR - 1}-09-01T12:00:00Z`, SYS('roof')),
    ev('inspection',        'HVAC inspection',             `${YEAR}-05-10T12:00:00Z`, SYS('hvac')),
    ev('building_photo',    'Facade photos',               `${YEAR}-05-12T12:00:00Z`),
    ev('other',             'Misc note on the building',   `${YEAR}-05-20T12:00:00Z`),          // fallback → History
    auto('sync_restored',   'Property state restored from sync', `${YEAR}-05-21T12:00:00Z`), // fallback → History
    // A SUITE's records — the Space file's, never the cabinet's.
    ev('maintenance',       'Suite 100 — HVAC filter',     `${YEAR}-05-22T12:00:00Z`, { type: 'suite', id: 't1', label: 'Alder Dental' }),
    ev('note',              'Suite 101 — walkthrough',     `${YEAR}-05-23T12:00:00Z`, { type: 'suite', id: 't2', label: 'Birch Books' }),
  ];
  const invoices = [];
  const vendors = ['Austin Energy', 'BrightClean Janitorial', 'Cascade Repairs'];
  const cats = ['utilities', 'janitorial', 'repairs'];
  for (let i = 0; i < 60; i++) {
    const y = YEAR - (i % 3);
    invoices.push({ id: 'inv-' + (i + 1), vendorName: vendors[i % 3], category: cats[i % 3], amount: 100 + i,
      invoiceDate: `${y}-${String((i % 12) + 1).padStart(2, '0')}-15`, fileName: 'inv-' + (i + 1) + '.pdf' });
  }
  invoices.push({ id: 'inv-s1', vendorName: 'Tenant Direct Co', category: 'repairs', amount: 900, invoiceDate: `${YEAR}-06-01`, spaceId: 't1' });
  invoices.push({ id: 'inv-s2', vendorName: 'Tenant Direct Co', category: 'repairs', amount: 950, invoiceDate: `${YEAR}-06-02`, spaceId: 't1' });
  invoices.push({ id: 'inv-s3', vendorName: 'Tenant Direct Co', category: 'repairs', amount: 990, invoiceDate: `${YEAR}-06-03`, spaceId: 't2' });
  invoices.push({ id: 'inv-u1', vendorName: 'Austin Energy', category: 'utilities', amount: 5 });   // undated
  invoices.push({ id: 'inv-u2', vendorName: 'Austin Energy', category: 'utilities', amount: 6 });   // undated
  return {
    id: 'prop-maple', name: 'Maple Plaza', totalSqft: 42500, status: 'in-progress',
    info: { address: '123 Main Street · Tuckerton, NJ 08087', yearBuilt: '1998',
            insuranceCarrier: 'Hartford', insurancePolicyNo: 'HF-4471', insuranceExpires: day(30) },
    tenants, timeline, invoices, disputes: [], activityLog: [],
    escrowReserves: [{ id: 'r1', reserveType: 'roof', reserveTypeLabel: 'Roof reserve',
      deadlines: { reserveExpirationDate: day(60) },
      sourceDocuments: [{ fileName: 'loan-agreement.pdf', fileUrl: 'https://x/loan.pdf', uploadedAt: `${YEAR}-01-05` }] }],
    drawRequests: [],
  };
}

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });

  const boot = async (viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.addInitScript(MOCK);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    return { ctx, page, errs };
  };

  const { ctx, page, errs } = await boot();
  const PROP = buildProperty();

  // ══ A · the landing page ═══════════════════════════════════════════════════
  sec('A · the landing page: what is this property, where is everything');
  const A = await page.evaluate((prop) => {
    if (!window.PropertyCabinetView || !window.PropertyCabinet) return { missing: true };
    _props = [prop]; activePropId = prop.id;
    window.currentProperty = function () { return _props[0]; };
    window.currentCamYear = function () { return new Date().getFullYear(); };
    PropertyOS.init();
    document.getElementById('wsPane-property').style.display = 'block';
    const ws = document.getElementById('mainWorkflow'); if (ws) ws.style.display = 'block';
    const pd = document.getElementById('portfolioDashboard'); if (pd) pd.style.display = 'none';
    document.getElementById('propertyName').value = prop.name;
    document.getElementById('totalSqft').value = String(prop.totalSqft);
    PropertyOS.renderPropertyPage(_props[0]);
    const body = document.getElementById('propertyOsBody');
    const snap = Array.from(body.querySelectorAll('.pcv-snap-cell')).map(c => ({
      v: c.querySelector('.pcv-snap-v').textContent.replace(/\s+/g, ' ').trim(), l: c.querySelector('.pcv-snap-l').textContent.trim() }));
    const idx = PropertyCabinet.buildIndex(_props[0]);
    const occ = PropertyCabinet.activeTenants(_props[0]).reduce((s, t) => s + Number(t.leased_sqft), 0);
    return {
      name: (body.querySelector('.pcv-name') || {}).textContent,
      addr: (body.querySelector('.pcv-addr') || {}).textContent,
      snap, idxSpaces: idx.spaces, occPct: Math.round(occ / _props[0].totalSqft * 100),
      drawerState: PropertyCabinetView.state().drawer,
      setupHidden: getComputedStyle(document.getElementById('cardSetup')).display === 'none',
      setupInSlot: !!document.querySelector('#pcvSetupSlot #cardSetup'),
      legacySections: body.querySelectorAll('.pos-sec').length,
      summaryBarHidden: !document.getElementById('posSetupSummary') || getComputedStyle(document.getElementById('posSetupSummary')).display === 'none',
    };
  }, PROP);
  if (A.missing) { bad('PropertyCabinetView is loaded on the page'); }
  else {
    ok('PropertyCabinetView is loaded on the page');
    is(A.drawerState, null, 'the Property tab opens on the landing page, not a drawer');
    is(A.name, 'Maple Plaza', 'the header names the property');
    is(A.addr, '123 Main Street · Tuckerton, NJ 08087', 'and shows the address from property.info');
    is(A.snap, [{ v: '42,500 SF', l: 'Total size' }, { v: '8', l: 'Spaces' }, { v: '7', l: 'Occupied' }, { v: '1', l: 'Vacant' }, { v: A.occPct + '%', l: 'Occupancy' }],
       'the snapshot reads Total size · Spaces · Occupied · Vacant · Occupancy from the index');
    is(A.idxSpaces, { total: 8, occupied: 7, vacant: 1 }, '…and those are the index’s own numbers');
    is(A.setupHidden && A.setupInSlot, true, 'the setup card is seated under the header, collapsed on a configured property');
    is(A.summaryBarHidden, true, 'the old one-line setup summary is not shown twice');
    is(A.legacySections, 0, 'the flat legacy page is gone from the Property tab');
  }

  const edit = await page.evaluate(() => {
    const btn = document.getElementById('pcvEditBtn');
    const before = btn.textContent.trim();
    btn.click();
    const shown = getComputedStyle(document.getElementById('cardSetup')).display !== 'none';
    const after = document.getElementById('pcvEditBtn').textContent.trim();
    document.getElementById('pcvEditBtn').click();
    const hiddenAgain = getComputedStyle(document.getElementById('cardSetup')).display === 'none';
    return { before, shown, after, hiddenAgain, nameField: !!document.getElementById('propertyName') };
  });
  is(edit.before, 'Edit property', 'the header offers Edit property, quietly');
  is(edit.shown && edit.nameField, true, 'clicking it opens the existing setup card (name, sqft, CAM year)');
  is(edit.after, 'Close editor', 'and the button says how to put it away');
  is(edit.hiddenAgain, true, 'which it does');

  // ══ B · attention: the same items, mounted here ════════════════════════════
  sec('B · What needs your attention — one authority, mounted twice');
  const B = await page.evaluate(() => {
    const items = PropertyWorkspace.collectAttention(_props[0], null);
    const cards = Array.from(document.querySelectorAll('#pcvAttention .pcv-attn-card')).map(c => c.querySelector('.pcv-attn-t').textContent);
    const overview = Array.from(document.querySelectorAll('#propertyAttentionSlot .pw-item-title')).map(e => e.textContent);
    const badge = (document.getElementById('pcvAttentionCount') || {}).textContent;
    const insIdx = items.findIndex(i => /Insurance renewal/.test(i.title));
    return { n: items.length, titles: items.map(i => i.title), cards, overview, badge, insIdx,
             viewAll: !!document.querySelector('#pcvAttention .pcv-attn-all') };
  });
  is(B.n >= 4, true, `the fixture produces at least four attention items (${B.n})`);
  is(B.cards, B.titles.slice(0, 3), 'the landing page shows the top three, in the authority’s order');
  is(B.badge, String(B.n), 'and the badge counts all of them');
  is(B.viewAll, true, 'with View all for the rest');
  is(B.cards.length <= B.n, true, 'no item is invented to fill the design');
  is(B.overview.slice(0, 3), B.cards, 'the Overview widget lists the same items in the same order');
  const Bact = await page.evaluate((i) => {
    PropertyWorkspace.act(i);
    return { drawer: PropertyCabinetView.state().drawer, hash: location.hash,
             title: (document.querySelector('#propertyOsBody .pcv-dtitle') || {}).textContent,
             facts: (document.querySelector('#propertyOsBody .pcv-facts') || {}).textContent || '' };
  }, B.insIdx);
  is(Bact.drawer, 'insurance', 'the insurance item opens the Insurance DRAWER, not the generic tab');
  is(Bact.hash, '#property/insurance', 'and the address bar says so');
  is(/Hartford/.test(Bact.facts) && /HF-4471/.test(Bact.facts), true, 'the drawer shows the policy on file — carrier and number from property.info');
  const Bexp = await page.evaluate(() => {
    PropertyCabinetView.closeDrawer();
    PropertyWorkspace.toggleAll();
    const n = document.querySelectorAll('#pcvAttention .pcv-attn-card').length;
    PropertyWorkspace.toggleAll();
    return { n, back: document.querySelectorAll('#pcvAttention .pcv-attn-card').length, drawer: PropertyCabinetView.state().drawer };
  });
  is(Bexp.n, B.n, 'View all expands to every item in place');
  is(Bexp.back, 3, 'and collapses back to three');
  is(Bexp.drawer, null, 'Property (breadcrumb) returns to the landing page');

  // ══ C · tiles: counts from the canonical index ═════════════════════════════
  sec('C · nine tiles, every count from PropertyCabinet.buildIndex()');
  const C = await page.evaluate(() => {
    const idx = PropertyCabinet.buildIndex(_props[0]);
    const tiles = Array.from(document.querySelectorAll('.pcv-tile')).map(t => ({
      key: t.dataset.drawer, title: t.querySelector('.pcv-tile-t').textContent,
      m: t.querySelector('.pcv-tile-m').textContent, s: (t.querySelector('.pcv-tile-s') || {}).textContent || '',
      empty: t.classList.contains('pcv-tile--empty') }));
    const counts = {}; Object.keys(idx.drawers).forEach(k => counts[k] = idx.drawers[k].count);
    const dates = PropertyCabinet.importantDates(_props[0]).length;
    return { tiles, counts, records: idx.records.length, inv: idx.invoices, dates };
  });
  is(C.tiles.map(t => t.key), ['taxes','insurance','invoices','financing','financials','agreements','building','dates','history'], 'the nine drawers, in the approved order');
  is(C.tiles.map(t => t.title), ['Real Estate Taxes','Insurance','Invoices','Mortgage & Financing','Property Financials','Agreements','Building & Systems','Important Dates','History'], 'with their approved names');
  const tile = k => C.tiles.find(t => t.key === k);
  is(C.counts.taxes, 3, 'the index files 3 tax records');
  is(tile('taxes').m, '3 years · 3 records · 1 document', 'Taxes: years · records · documents, from the index');
  is(tile('taxes').s, `${YEAR} · ${YEAR - 1} · ${YEAR - 2}`, 'and lists its years, newest first');
  is(tile('insurance').m, '2 records · 2 documents', 'Insurance: records and documents');
  is(/^Renews /.test(tile('insurance').s), true, 'Insurance: the renewal date from property.info');
  is(tile('invoices').m, '62 invoices · 3 tenant-direct', 'Invoices: property invoices (60 dated + 2 undated), tenant-direct counted apart');
  is(/2 undated/.test(tile('invoices').s), true, 'and says how many are undated');
  is(tile('financing').m, '2 records · 1 reserve', 'Financing: the loan record plus the reserve document pointer, and the reserve');
  is(tile('financials').m, '2 records', 'Financials: the payment and the reconciliation event');
  is(tile('agreements').m, '2 years · 2 records', 'Agreements: the two vendor contracts');
  is(tile('building').m, '2 systems · 4 records · info on file', 'Building & Systems: systems with records, records, and the facts');
  is(tile('dates').m, `${C.dates} upcoming`, 'Important Dates: the count PropertyCabinet.importantDates() gives');
  is(tile('history').m, `${C.records} events`, 'History: every property record');
  is(C.tiles.filter(t => t.empty).length, 0, 'nothing is marked empty on a property with records everywhere');
  is(C.records, 16, 'the suite records are not property records (18 events, 16 in the cabinet)');

  // ══ D · one home per record ════════════════════════════════════════════════
  sec('D · every record in exactly one drawer; History lists all; a suite’s in none');
  const D = await page.evaluate(() => {
    const p = _props[0];
    const expect = {};
    p.timeline.forEach(e => { const f = PropertyCabinet.drawerOfRecord(e); if (f) (expect[f.drawer] = expect[f.drawer] || []).push(e.id); });
    const got = {}, rows = {};
    ['taxes','insurance','financing','financials','agreements','building','history'].forEach(k => {
      PropertyCabinetView.openDrawer(k);
      got[k] = Array.from(document.querySelectorAll('#propertyOsBody .pos-rec')).map(r => r.dataset.recId);
      rows[k] = Array.from(document.querySelectorAll('#propertyOsBody .pcv-arow')).map(r => r.dataset.recId);
    });
    const suiteIds = p.timeline.filter(e => e.subject && e.subject.type === 'suite').map(e => e.id);
    const allCards = [].concat(...Object.values(got));
    return { expect, got, historyRows: rows.history, suiteIds, allCards,
             dup: allCards.filter((id, i) => allCards.indexOf(id) !== i) };
  });
  for (const k of ['taxes','insurance','financing','financials','agreements','building']) {
    is(same(D.got[k], D.expect[k] || []), true, `${k}: the drawer shows exactly the records PropertyCabinet files there (${(D.expect[k] || []).length})`);
  }
  is(same(D.got.history, D.expect.history || []), true, 'History is HOME only to the fallbacks (category other, sync_restored)');
  is(D.historyRows.length, 16, 'but its activity list carries every property record');
  is(D.dup, [], 'no record is rendered as a card in two drawers');
  is(D.suiteIds.every(id => !D.allCards.includes(id) && !D.historyRows.includes(id)), true, 'a suite’s records appear in no drawer and not in History');

  const Dfilt = await page.evaluate((Y) => {
    PropertyCabinetView.openDrawer('taxes');
    PropertyCabinetView.setYear(String(Y - 1));
    const y = Array.from(document.querySelectorAll('#propertyOsBody .pos-rec')).map(r => r.querySelector('.pos-rec-t').textContent);
    const chipOn = (document.querySelector('#propertyOsBody .pcv-chip--on') || {}).textContent || '';
    const hash = location.hash;
    PropertyCabinetView.setYear(null);
    const all = document.querySelectorAll('#propertyOsBody .pos-rec').length;
    PropertyCabinetView.openDrawer('building');
    PropertyCabinetView.setCategory('warranty');
    const w = Array.from(document.querySelectorAll('#propertyOsBody .pos-rec')).map(r => r.querySelector('.pos-rec-t').textContent);
    PropertyOS.setRecordFilter('all', 'roof');
    const roof = Array.from(document.querySelectorAll('#propertyOsBody .pos-rec')).map(r => r.querySelector('.pos-rec-t').textContent);
    const note = (document.querySelector('#propertyOsBody .pos-filter-note') || {}).textContent || '';
    const sysCells = document.querySelectorAll('#propertyOsBody .pos-sys-cell').length;
    const infoRows = document.querySelectorAll('#propertyOsBody .pos-info-row').length;
    PropertyOS.setRecordFilter('all', null);
    const cleared = document.querySelectorAll('#propertyOsBody .pos-rec').length;
    return { y, chipOn, hash, all, w, roof, note, sysCells, infoRows, cleared, drawer: PropertyCabinetView.state().drawer };
  }, YEAR);
  is(Dfilt.y, [`${YEAR - 1} assessment`], 'a year chip narrows the drawer to that year');
  is(/^\d{4}/.test(Dfilt.chipOn) && Dfilt.hash === `#property/taxes/${YEAR - 1}`, true, 'the chip is marked and the year is in the address');
  is(Dfilt.all, 3, 'All years restores the drawer');
  is(Dfilt.w, ['Roof membrane warranty'], 'a category chip inside Building & Systems narrows to it');
  is(same(Dfilt.roof, ['Roof membrane warranty', 'Roof replaced']), true, 'a Building System shows its own story (PropertyOS.setRecordFilter still works)');
  is(/Roof/.test(Dfilt.note) && /2 records/.test(Dfilt.note), true, 'and says which system, and how many');
  is(Dfilt.sysCells, 8, 'the systems grid is in the Building & Systems drawer');
  is(Dfilt.infoRows > 10, true, 'as is Property information');
  is(Dfilt.cleared === 4 && Dfilt.drawer === 'building', true, 'Clear keeps the drawer open and shows all four building records');

  // ══ E · Invoices: paged and filtered, never dumped ═════════════════════════
  sec('E · Invoices — Search & filter is still a page at a time');
  const E = await page.evaluate(() => {
    PropertyCabinetView.openDrawer('invoices');
    PropertyCabinetView.setInvoiceMode('search');   // the flat list lives behind Search & filter now
    const read = () => ({
      rows: document.querySelectorAll('#propertyOsBody .pos-inv').length,
      ids: Array.from(document.querySelectorAll('#propertyOsBody .pos-inv')).map(r => r.dataset.invId),
      summary: (document.getElementById('pcvInvSummary') || {}).textContent,
      pager: (document.querySelector('#propertyOsBody .pcv-pager-at') || {}).textContent || '',
    });
    const p1 = read();
    PropertyCabinetView.setPage(2); const p2 = read();
    PropertyCabinetView.setPage(3); const p3 = read();
    PropertyCabinetView.setPage(1);
    const q = PropertyCabinet.invoiceQuery(_props[0], { page: 2, pageSize: 25 }).items.map(i => i.id);
    PropertyCabinetView.setInvoiceFilter('vendor', 'Austin Energy'); const vend = read();
    PropertyCabinetView.setInvoiceFilter('vendor', '');
    PropertyCabinetView.setInvoiceFilter('year', String(new Date().getFullYear())); const yr = read();
    PropertyCabinetView.setInvoiceFilter('year', 'undated'); const und = read();
    PropertyCabinetView.setInvoiceFilter('year', '');
    PropertyCabinetView.setInvoiceFilter('category', 'janitorial'); const cat = read();
    PropertyCabinetView.setInvoiceFilter('category', '');
    PropertyCabinetView.setInvoiceFilter('spaceId', 't1'); const sp = read();
    PropertyCabinetView.setInvoiceFilter('spaceId', '');
    const idx = PropertyCabinet.buildIndex(_props[0]).invoices;
    return { p1, p2, p3, q, vend, yr, und, cat, sp, idx, max: Math.max(p1.rows, p2.rows, p3.rows, vend.rows, yr.rows) };
  });
  is(E.p1.rows, 25, 'page 1 renders 25 rows');
  is(E.p1.summary, 'Showing 1–25 of 62 invoices', 'and says so');
  is(E.p1.pager, 'Page 1 of 3', 'three pages for sixty-two');
  is(E.p2.ids, E.q, 'page 2 is exactly PropertyCabinet.invoiceQuery’s page 2');
  is(E.p3.rows, 12, 'page 3 holds the last twelve');
  is(E.max <= 25, true, 'no view ever rendered more than a page');
  is(E.vend.rows, E.idx.byVendor['Austin Energy'], `a vendor filter shows that vendor’s invoices (${E.vend.rows})`);
  is(/filtered/.test(E.vend.summary), true, 'and the summary says the list is filtered');
  is(E.yr.rows, E.idx.byYear[String(YEAR)], 'a year filter matches the index’s count for that year');
  is(E.und.rows, 2, 'Undated shows the two undated invoices');
  is(E.cat.rows, E.idx.byCategory.janitorial, 'a category filter matches the index');
  is(E.sp.rows, 2, 'the Space filter shows that space’s tenant-direct invoices');
  is(/tenant-direct/.test(E.sp.summary), true, 'and says they are filed under the Space');
  is(E.p1.ids.includes('inv-s1'), false, 'tenant-direct invoices are not in the property list by default');

  const Esearch = await page.evaluate(async () => {
    PropertyCabinetView.setQuery('jan');
    await new Promise(r => setTimeout(r, 300));
    const n = document.querySelectorAll('#propertyOsBody .pos-inv').length;
    const val = (document.getElementById('pcvInvSearch') || {}).value;
    PropertyCabinetView.setQuery('');
    await new Promise(r => setTimeout(r, 300));
    // A relation edit on a row keeps the drawer and the page.
    PropertyCabinetView.setPage(2);
    const before = document.querySelectorAll('#propertyOsBody .pos-inv')[0].dataset.invId;
    PropertyOS.setInvoiceRelation(before, 'system', 'roof');
    const st = PropertyCabinetView.state();
    const sysSel = document.querySelector('#propertyOsBody .pos-inv[data-inv-id="' + before + '"] select[onchange*="system"]');
    PropertyOS.setInvoiceRelation(before, 'system', '');
    PropertyCabinetView.setPage(1);
    return { n, val, drawer: st.drawer, page: st.page, sysVal: sysSel ? sysSel.value : null };
  });
  is(Esearch.n, 20, 'search "jan" finds the twenty janitorial invoices');
  is(Esearch.val, 'jan', 'the search box keeps what was typed across the re-render');
  is(Esearch.drawer === 'invoices' && Esearch.page === 2, true, 'relating an invoice to a system keeps the drawer on the same page');
  is(Esearch.sysVal, 'roof', 'and the row shows the relation it just wrote');

  // ══ F · Important Dates ════════════════════════════════════════════════════
  sec('F · Important Dates — derived, each with its source');
  const F = await page.evaluate(() => {
    PropertyCabinetView.openDrawer('dates');
    const all = PropertyCabinet.importantDates(_props[0], { horizonDays: null });
    const rows = Array.from(document.querySelectorAll('#propertyOsBody .pcv-date')).map(r => ({
      kind: r.dataset.kind, t: r.querySelector('.pcv-date-t').textContent, link: (r.querySelector('.pcv-link') || {}).textContent || '' }));
    const soon = document.querySelectorAll('#propertyOsBody .pcv-sec-title')[0].textContent;
    const ins = rows.find(r => r.kind === 'insurance_renewal');
    const insBtn = Array.from(document.querySelectorAll('#propertyOsBody .pcv-date')).find(r => r.dataset.kind === 'insurance_renewal').querySelector('.pcv-link');
    insBtn.click();
    const after = PropertyCabinetView.state().drawer;
    return { n: rows.length, expected: all.length, kinds: rows.map(r => r.kind), soon,
             leaseRows: rows.filter(r => r.kind === 'lease_expiration').length,
             vacantListed: rows.some(r => /Vacant/.test(r.t)),
             ins, after, within90: all.filter(x => x.daysOut <= 90).length };
  });
  is(F.n, F.expected, `every date PropertyCabinet derives is listed (${F.n})`);
  is(F.leaseRows, 6, 'six lease end dates — the seven occupied rows minus the one already expired');
  is(F.vacantListed, false, 'the vacant space contributes no lease date');
  is(/Next 90 days/.test(F.soon) && new RegExp(String(F.within90)).test(F.soon), true, 'the next-90-days group counts what falls in it');
  is(!!F.ins && /Property information/.test(F.ins.link), true, 'the insurance date names its source');
  is(F.after, 'building', 'and opens it');

  // ══ G · addressing ═════════════════════════════════════════════════════════
  sec('G · deep links open what they name');
  const G = await page.evaluate(async (Y) => {
    const p = _props[0];
    const tax = p.timeline.find(e => e.title === `${Y - 1} assessment`);
    PropertyCabinetView.applyAddress(`#property/taxes/${Y - 1}/${tax.id}`);
    const focused = (document.querySelector('#propertyOsBody .pos-rec--focus') || {}).dataset || {};
    const st = PropertyCabinetView.state();
    location.hash = '#property/insurance';
    await new Promise(r => setTimeout(r, 120));
    const viaHash = PropertyCabinetView.state().drawer;
    location.hash = '#property/nope';
    await new Promise(r => setTimeout(r, 120));
    const unknown = PropertyCabinetView.state().drawer;
    location.hash = '#spaces/t1';
    await new Promise(r => setTimeout(r, 250));
    const ov = document.getElementById('tsOverlay');
    const spaceName = ov ? ov.querySelector('.ts-space-name').textContent : null;
    const spacesTab = getComputedStyle(document.getElementById('wsPane-spaces')).display !== 'none';
    if (window.TenantSpace) TenantSpace.closeSpace();
    switchWorkspaceTab('property');
    history.replaceState(null, '', location.pathname);
    return { focused: focused.recId, drawer: st.drawer, year: st.year, viaHash, unknown, spaceName, spacesTab, taxId: tax.id };
  }, YEAR);
  is(G.drawer === 'taxes' && G.year === String(YEAR - 1), true, '#property/taxes/<year>/<id> opens Taxes on that year');
  is(G.focused, G.taxId, 'and highlights that record');
  is(G.viaHash, 'insurance', 'changing the hash (back button, pasted link) opens the drawer it names');
  is(G.unknown, null, 'an unknown drawer degrades to the landing page, not a guess');
  is(/Alder Dental/.test(G.spaceName || '') && G.spacesTab, true, '#spaces/<id> switches to Spaces and opens that Space file');

  const H = await page.evaluate(() => {
    const p = _props[0];
    const suiteRec = p.timeline.find(e => e.subject && e.subject.type === 'suite' && e.subject.id === 't2');
    const r = PropertyCabinetView.openRecord(suiteRec.id);
    const ov = document.getElementById('tsOverlay');
    const name = ov ? ov.querySelector('.ts-space-name').textContent : null;
    const drawer = PropertyCabinetView.state().drawer;
    if (ov) TenantSpace.closeSpace();
    const ins = p.timeline.find(e => e.category === 'insurance');
    PropertyOS.openRecord(ins.id);
    const st = PropertyCabinetView.state();
    const focused = (document.querySelector('#propertyOsBody .pos-rec--focus') || {}).dataset || {};
    return { r, name, drawer, insDrawer: st.drawer, focused: focused.recId, insId: ins.id };
  });
  is(H.r === true && /Birch Books/.test(H.name || ''), true, 'opening a suite’s record opens that Space file');
  is(H.drawer, null, '…and no property drawer');
  is(H.insDrawer === 'insurance' && H.focused === H.insId, true, 'PropertyOS.openRecord (the Documents “on:” control) still lands on the record, now in its drawer');

  // ══ I · recent activity ════════════════════════════════════════════════════
  sec('I · Recent activity — five pointers into History');
  const I = await page.evaluate(() => {
    PropertyCabinetView.closeDrawer();
    const idx = PropertyCabinet.buildIndex(_props[0]);
    const top = idx.records.slice().sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, 5).map(r => r.id);
    const rows = Array.from(document.querySelectorAll('#pcvRecent .pcv-arow'));
    const ids = rows.map(r => r.dataset.recId);
    const note = (document.querySelector('#pcvRecent .pcv-more-note') || {}).textContent || '';
    rows[0].click();
    const st = PropertyCabinetView.state();
    const focused = (document.querySelector('#propertyOsBody .pos-rec--focus') || {}).dataset || {};
    PropertyCabinetView.closeDrawer();
    document.querySelector('#pcvRecent .pcv-link').click();
    const hist = PropertyCabinetView.state().drawer;
    PropertyCabinetView.closeDrawer();
    return { ids, top, note, drawer: st.drawer, focused: focused.recId, hist, expectDrawer: PropertyCabinet.drawerOfRecord(_props[0].timeline.find(e => e.id === top[0])).drawer };
  });
  is(I.ids, I.top, 'the five most recent property records, newest first');
  is(/11 earlier/.test(I.note), true, 'and how many earlier ones History holds');
  is(I.drawer === I.expectDrawer && I.focused === I.top[0], true, 'clicking a row opens that record in its home drawer');
  is(I.hist, 'history', 'View all activity opens History');

  // ══ J · adding a record from inside a drawer ═══════════════════════════════
  sec('J · Add Record from a drawer files it there, without a reload');
  const J = await page.evaluate(async () => {
    PropertyCabinetView.openDrawer('taxes');
    const before = document.querySelectorAll('#propertyOsBody .pos-rec').length;
    document.querySelector('#propertyOsBody .pos-add').click();
    await new Promise(r => setTimeout(r, 300));
    if (!document.getElementById('ptlOverlay')) return { noModal: true };
    document.getElementById('ptlTitle').value = 'Tax bill paid';
    document.getElementById('ptlTitle').dispatchEvent(new Event('input'));
    document.getElementById('ptlCat').value = 'real_estate_taxes';
    document.getElementById('ptlSave').click();
    await new Promise(r => setTimeout(r, 800));
    const st = PropertyCabinetView.state();
    const titles = Array.from(document.querySelectorAll('#propertyOsBody .pos-rec .pos-rec-t')).map(e => e.textContent);
    const tileM = (function () { PropertyCabinetView.closeDrawer(); return document.querySelector('.pcv-tile[data-drawer="taxes"] .pcv-tile-m').textContent; })();
    return { before, after: titles.length, has: titles.includes('Tax bill paid'), drawer: st.drawer, tileM, timelineLen: _props[0].timeline.length };
  });
  if (J.noModal) bad('Add Record opens the existing timeline modal');
  else {
    ok('Add Record opens the existing timeline modal');
    is(J.drawer, 'taxes', 'saving keeps the Taxes drawer open');
    is(J.after === J.before + 1 && J.has, true, 'and the new record is in it, without re-rendering by hand');
    is(J.tileM, '3 years · 4 records · 1 document', 'the tile count moved with it');
    is(J.timelineLen, 19, 'as one more timeline event — no second store');
  }

  // ══ K · an empty property tells the truth ══════════════════════════════════
  sec('K · empty states are truthful');
  const K = await page.evaluate(() => {
    const bare = { id: 'prop-bare', name: 'Bare Lot', totalSqft: 0, tenants: [], invoices: [], timeline: [], disputes: [], activityLog: [] };
    _props = [bare]; activePropId = bare.id;
    document.getElementById('propertyName').value = 'Bare Lot';
    document.getElementById('totalSqft').value = '';
    PropertyOS.renderPropertyPage(bare);
    const tiles = Array.from(document.querySelectorAll('.pcv-tile')).map(t => ({ k: t.dataset.drawer, empty: t.classList.contains('pcv-tile--empty'), m: t.querySelector('.pcv-tile-m').textContent }));
    const snap = Array.from(document.querySelectorAll('.pcv-snap-v')).map(e => e.textContent.trim());
    const recent = (document.querySelector('#pcvRecent .pcv-empty') || {}).textContent || '';
    const setupShown = getComputedStyle(document.getElementById('cardSetup')).display !== 'none';
    PropertyCabinetView.openDrawer('taxes');
    const taxEmpty = (document.querySelector('#propertyOsBody .pcv-empty') || {}).textContent || '';
    PropertyCabinetView.openDrawer('invoices');
    const invEmpty = (document.querySelector('#propertyOsBody .pcv-empty') || {}).textContent || '';
    PropertyCabinetView.openDrawer('dates');
    const dateEmpty = (document.querySelector('#propertyOsBody .pcv-empty') || {}).textContent || '';
    PropertyCabinetView.closeDrawer();
    return { tiles, snap, recent, setupShown, taxEmpty, invEmpty, dateEmpty, addr: !!document.querySelector('.pcv-addr') };
  });
  is(K.tiles.every(t => t.empty), true, 'every tile is marked empty');
  is(K.tiles.map(t => t.m), ['No records yet','No records yet','No invoices yet','No records yet','No records yet','No records yet','No records yet','Nothing in the next 90 days','No activity yet'], 'and says so in words, not zeros');
  is(K.snap, ['—', '0', '0', '0', '—'], 'no total size → no occupancy figure is invented');
  is(K.addr, false, 'no address on file → no address line (never the demo’s)');
  is(/Nothing recorded yet/.test(K.recent), true, 'Recent activity says nothing has happened');
  is(K.setupShown, true, 'an unconfigured property shows the setup card — it is the job');
  is(/No tax records yet/.test(K.taxEmpty), true, 'an empty drawer says what belongs in it');
  is(/No invoices on this property yet/.test(K.invEmpty), true, 'so does Invoices');
  is(/No upcoming dates on record/.test(K.dateEmpty), true, 'and Important Dates');

  // ══ L · narrow viewport ════════════════════════════════════════════════════
  sec('L · the cabinet fits a phone');
  const m = await boot({ width: 390, height: 900 });
  const L = await m.page.evaluate((prop) => {
    _props = [prop]; activePropId = prop.id;
    window.currentProperty = function () { return _props[0]; };
    PropertyOS.init();
    document.getElementById('wsPane-property').style.display = 'block';
    const ws = document.getElementById('mainWorkflow'); if (ws) ws.style.display = 'block';
    const pd = document.getElementById('portfolioDashboard'); if (pd) pd.style.display = 'none';
    document.getElementById('propertyName').value = prop.name;
    document.getElementById('totalSqft').value = String(prop.totalSqft);
    PropertyOS.renderPropertyPage(_props[0]);
    const wide = () => document.documentElement.scrollWidth > window.innerWidth + 2;
    const landing = wide();
    PropertyCabinetView.openDrawer('invoices');
    const invoices = wide();
    PropertyCabinetView.openDrawer('building');
    const building = wide();
    return { landing, invoices, building, tiles: document.querySelectorAll('.pcv-tile').length };
  }, PROP);
  is(L.landing, false, 'the landing page does not scroll sideways at 390px');
  is(L.invoices, false, 'nor the Invoices drawer');
  is(L.building, false, 'nor Building & Systems');
  await m.ctx.close();

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await ctx.close(); await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
