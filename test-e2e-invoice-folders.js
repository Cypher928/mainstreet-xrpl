// test-e2e-invoice-folders.js
// ============================================================================
// INVOICES AS A FILING SYSTEM — Property → Invoices → Vendor → Year → Month →
// Invoice, as VIEWS over the one register.
//
//   · the drawer opens on folders, never on a dump: no invoice row renders
//     until a vendor's year is opened;
//   · vendor folders are alphabetical and their counts sum to the register;
//   · a year opens by month, in calendar order, each month chronological;
//   · the leaf row IS the register's row — PropertyOS.invoiceRowHtml, with its
//     identity, its relations and its file chip through docLinkHtml — and a
//     relation edited there is written to the register, not to a copy;
//   · #property/invoices/<vendor>/<year>/<id> opens and highlights the bill;
//     openInvoice(id) files it where it belongs; a Space's invoice stays there;
//   · Search & filter keeps the flat, paged list one click away;
//   · the Building & Systems reference samples are unmistakably not records.
//
// Run: node test-e2e-invoice-folders.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8965;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);

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

// ── The fixture: amounts all distinct, so a wrong grouping shows in a total ──
const GV = 'Green Valley Landscape';
function buildProperty() {
  const invoices = [];
  for (let m = 1; m <= 12; m++) {
    invoices.push({ id: 'gv-25-' + m, vendorName: GV, category: 'landscaping', amount: 100 * m + 1,
      invoiceDate: `2025-${String(m).padStart(2, '0')}-10`,
      fileUrl: m === 3 ? 'invoices/u1/gv-2025-03.pdf' : (m === 4 ? 'https://files.example.com/gv-2025-04.pdf' : null),
      fileName: m === 3 ? 'gv-2025-03.pdf' : (m === 4 ? 'gv-2025-04.pdf' : null) });
  }
  invoices.push({ id: 'gv-25-3b', vendorName: GV, category: 'landscaping', amount: 77, invoiceDate: '2025-03-02' }); // earlier in March
  invoices.push({ id: 'gv-24-1', vendorName: GV, category: 'landscaping', amount: 501, invoiceDate: '2024-05-10' });
  invoices.push({ id: 'gv-24-2', vendorName: GV, category: 'repairs',     amount: 902, invoiceDate: '2024-11-10' });
  invoices.push({ id: 'gv-und',  vendorName: 'green valley landscape', category: 'landscaping', amount: 33 });      // undated, other casing
  invoices.push({ id: 'ae-1', vendorName: 'Austin Energy', category: 'utilities', amount: 1001, invoiceDate: '2025-01-31' });
  invoices.push({ id: 'ae-2', vendorName: 'Austin Energy', category: 'utilities', amount: 1002, invoiceDate: '2025-04-30' });
  invoices.push({ id: 'ae-3', vendorName: 'Austin Energy', category: 'utilities', amount: 1003, invoiceDate: '2025-07-31' });
  invoices.push({ id: 'ae-4', vendorName: 'Austin Energy', category: 'utilities', amount: 1004, invoiceDate: '2025-10-31' });
  invoices.push({ id: 'bc-1', vendorName: 'BrightClean Janitorial', category: 'janitorial', amount: 201, invoiceDate: '2024-02-01' });
  invoices.push({ id: 'bc-2', vendorName: 'BrightClean Janitorial', category: 'janitorial', amount: 202, invoiceDate: '2024-06-01' });
  invoices.push({ id: 'bc-3', vendorName: 'BrightClean Janitorial', category: 'janitorial', amount: 203, invoiceDate: '2024-10-01' });
  invoices.push({ id: 'td-1', vendorName: 'Tenant Direct Co', category: 'repairs', amount: 900, invoiceDate: '2025-06-01', spaceId: 't1' });
  invoices.push({ id: 'td-2', vendorName: 'Tenant Direct Co', category: 'repairs', amount: 950, invoiceDate: '2025-06-02', spaceId: 't1' });
  invoices.push({ id: 'nv-1', vendorName: '', category: 'other', amount: 10, invoiceDate: '2025-05-05' });
  return {
    id: 'prop-inv', name: 'Maple Plaza', totalSqft: 42500, status: 'in-progress',
    tenants: [{ id: 't1', tenant_name: 'Alder Dental', suite: '100', leased_sqft: 4000, flags: [], confidence: {} }],
    timeline: [], invoices, disputes: [], activityLog: [],
  };
}
const SUM = (arr) => Math.round(arr.reduce((s, i) => s + i.amount, 0) * 100) / 100;

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
  const MOUNT = `
    _props = [prop]; activePropId = prop.id;
    window.currentProperty = function () { return _props[0]; };
    window.currentCamYear = function () { return 2025; };
    PropertyOS.init();
    document.getElementById('wsPane-property').style.display = 'block';
    const ws = document.getElementById('mainWorkflow'); if (ws) ws.style.display = 'block';
    const pd = document.getElementById('portfolioDashboard'); if (pd) pd.style.display = 'none';
    document.getElementById('propertyName').value = prop.name;
    document.getElementById('totalSqft').value = String(prop.totalSqft || '');
    PropertyOS.renderPropertyPage(_props[0]);`;
  const { ctx, page, errs } = await boot();
  const PROP = buildProperty();
  const gvAll = PROP.invoices.filter(i => /green valley/i.test(i.vendorName));
  const gv25 = gvAll.filter(i => (i.invoiceDate || '').startsWith('2025'));

  // ══ A · the cabinet opens on folders ══════════════════════════════════════
  sec('A · Invoices opens on vendor folders, never on a dump');
  const A = await page.evaluate(({ prop, mount }) => {
    eval(mount);
    PropertyCabinetView.openDrawer('invoices');
    const b = document.getElementById('propertyOsBody');
    return {
      mode: (b.querySelector('[data-mode]') || {}).dataset.mode,
      folders: Array.from(b.querySelectorAll('.pcv-folder')).map(f => ({ v: f.dataset.vendor, t: f.querySelector('.pcv-folder-t').textContent, m: f.querySelector('.pcv-folder-m').textContent, n: Number(f.querySelector('.pcv-count').textContent) })),
      rows: b.querySelectorAll('.pos-inv').length,
      summary: (b.querySelector('.pcv-summary') || {}).textContent,
      hash: location.hash,
      idxTotal: PropertyCabinet.buildIndex(_props[0]).invoices.total,
    };
  }, { prop: PROP, mount: MOUNT });
  is(A.mode, 'folders', 'the default view is the filing cabinet');
  is(A.rows, 0, 'no invoice row is rendered at the top level — nothing is dumped');
  is(A.folders.map(f => f.t), ['Austin Energy', 'BrightClean Janitorial', GV, 'Unknown vendor'], 'one folder per vendor, alphabetical (a tenant-direct vendor is its Space’s)');
  const gvF = A.folders.find(f => f.v === GV);
  is(gvF.m, `landscaping · 16 invoices · 2025 · 2024 · undated · ${'$' + SUM(gvAll).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'a folder says its category, count, years and total');
  is(A.folders.reduce((s, f) => s + f.n, 0), A.idxTotal, `the folder counts sum to the index’s property total (${A.idxTotal})`);
  is(A.summary, '4 vendors · 24 invoices · 2 tenant-direct invoices filed under Spaces', 'the summary counts vendors, invoices and what is filed elsewhere');
  is(A.hash, '#property/invoices', 'the address is the drawer');

  // ══ B · a vendor: its years ════════════════════════════════════════════════
  sec('B · a vendor folder opens on its years');
  const B = await page.evaluate((GV) => {
    document.querySelector('.pcv-folder[data-vendor="' + GV + '"]').click();
    const b = document.getElementById('propertyOsBody');
    return {
      title: (b.querySelector('.pcv-folder-title') || {}).textContent, sub: (b.querySelector('.pcv-folder-sub') || {}).textContent,
      years: Array.from(b.querySelectorAll('.pcv-folder')).map(f => ({ y: f.dataset.year, t: f.querySelector('.pcv-folder-t').textContent, n: Number(f.querySelector('.pcv-count').textContent), m: f.querySelector('.pcv-folder-m').textContent })),
      rows: b.querySelectorAll('.pos-inv').length, hash: location.hash,
      crumb: Array.from(b.querySelectorAll('.pcv-crumb .pcv-crumb-up, .pcv-crumb .pcv-crumb-cur')).map(e => e.textContent),
    };
  }, GV);
  is(B.title, GV, 'the vendor heads the folder');
  is(/landscaping · repairs · 16 invoices · \$/.test(B.sub), true, 'with its categories, count and total');
  is(B.years.map(y => [y.t, y.n]), [['2025', 13], ['2024', 2], ['Undated', 1]], 'years newest first, Undated last, each counted');
  is(B.years[0].m, `13 invoices · ${'$' + SUM(gv25).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'and totalled');
  is(B.rows, 0, 'still no invoice rows — a year has not been opened');
  is(B.hash, '#property/invoices/Green%20Valley%20Landscape', 'the address names the vendor');
  is(B.crumb, ['Invoices', GV], 'the trail reads Invoices › vendor');

  // ══ C · a year: months, chronological ══════════════════════════════════════
  sec('C · a year opens by month, in calendar order, each month chronological');
  const C = await page.evaluate(() => {
    document.querySelector('.pcv-folder[data-year="2025"]').click();
    const b = document.getElementById('propertyOsBody');
    const months = Array.from(b.querySelectorAll('.pcv-month')).map(m => ({
      key: m.dataset.month, t: m.querySelector('.pcv-month-t').textContent, meta: m.querySelector('.pcv-month-m').textContent,
      ids: Array.from(m.querySelectorAll('.pos-inv')).map(r => r.dataset.invId) }));
    return { months, rows: b.querySelectorAll('.pos-inv').length, sub: (b.querySelector('.pcv-folder-sub') || {}).textContent, hash: location.hash,
             crumb: Array.from(b.querySelectorAll('.pcv-crumb .pcv-crumb-up, .pcv-crumb .pcv-crumb-cur')).map(e => e.textContent) };
  });
  is(C.months.map(m => m.t), ['January','February','March','April','May','June','July','August','September','October','November','December'], 'twelve months, January to December');
  is(C.months[2].ids, ['gv-25-3b', 'gv-25-3'], 'March lists the 2nd before the 10th');
  is(C.months[2].meta, '2 invoices · $378.00', 'and totals the month');
  is(C.rows, 13, 'thirteen bills — the year’s, and only the year’s');
  is(/^2025 · 13 invoices · \$/.test(C.sub), true, 'the folder head says the year, the count, the total');
  is(C.hash, '#property/invoices/Green%20Valley%20Landscape/2025', 'the address names vendor and year');
  is(C.crumb, ['Invoices', GV, '2025'], 'the trail reads Invoices › vendor › year');

  // ══ D · the leaf is the register’s own record ══════════════════════════════
  sec('D · an invoice at the leaf is the canonical row, with its file and its relations');
  const D = await page.evaluate(() => {
    const b = document.getElementById('propertyOsBody');
    const stored = b.querySelector('.pos-inv[data-inv-id="gv-25-3"]');
    const external = b.querySelector('.pos-inv[data-inv-id="gv-25-4"]');
    const plain = b.querySelector('.pos-inv[data-inv-id="gv-25-5"]');
    const chipS = stored.querySelector('.pos-doc'), chipE = external.querySelector('.pos-doc');
    const before = PropertyCabinetView.state();
    PropertyOS.setInvoiceRelation('gv-25-6', 'system', 'roof');
    const after = PropertyCabinetView.state();
    const sel = document.querySelector('#propertyOsBody .pos-inv[data-inv-id="gv-25-6"] select[onchange*="system"]');
    const reg = _props[0].invoices.find(i => i.id === 'gv-25-6');
    const regSys = reg.system;                       // read BEFORE the reset below
    PropertyOS.setInvoiceRelation('gv-25-6', 'system', '');
    return {
      storedChip: chipS ? { tag: chipS.tagName, ref: chipS.getAttribute('data-doc-url') } : null,
      externalChip: chipE ? { tag: chipE.tagName, href: chipE.getAttribute('href'), target: chipE.getAttribute('target') } : null,
      plainHasChip: !!plain.querySelector('.pos-doc'),
      controls: stored.querySelectorAll('select[data-inv-id], input[data-inv-id]').length,
      amount: stored.querySelector('.pos-inv-amt').textContent,
      kept: before.drawer === after.drawer && before.fVendor === after.fVendor && before.fYear === after.fYear && after.mode === 'folders',
      shown: sel ? sel.value : null, registerSystem: regSys, sameObjectCount: _props[0].invoices.filter(i => i.id === 'gv-25-6').length,
    };
  });
  is(D.storedChip, { tag: 'BUTTON', ref: 'invoices/u1/gv-2025-03.pdf' }, 'a stored file is a docLinkHtml button carrying its reference (signed on open — SEC-1)');
  is(D.externalChip, { tag: 'A', href: 'https://files.example.com/gv-2025-04.pdf', target: '_blank' }, 'an external file is a plain link, opened in a new tab');
  is(D.plainHasChip, false, 'a bill with no file offers no chip');
  is(D.controls, 3, 'the row carries its Space · System · CAM-eligible relations');
  is(D.amount, '$301.00', 'and its own amount');
  is(D.kept, true, 'editing a relation from the leaf keeps the folder open at the same level');
  is(D.shown, 'roof', 'the row shows the relation it just wrote');
  is(D.registerSystem, 'roof', 'and it is written to the register’s own row');
  is(D.sameObjectCount, 1, 'of which there is exactly one — no copy, no second store');

  // ══ E · addressing ═════════════════════════════════════════════════════════
  sec('E · deep links open the bill where it is filed');
  const E = await page.evaluate(async (GV) => {
    PropertyCabinetView.closeDrawer();
    PropertyCabinetView.applyAddress('#property/invoices/' + encodeURIComponent(GV) + '/2025/gv-25-9');
    const s1 = PropertyCabinetView.state();
    const f1 = (document.querySelector('#propertyOsBody .pos-inv--focus') || {}).dataset || {};
    const r2 = PropertyCabinetView.openInvoice('ae-2');
    const s2 = PropertyCabinetView.state();
    const f2 = (document.querySelector('#propertyOsBody .pos-inv--focus') || {}).dataset || {};
    const months2 = Array.from(document.querySelectorAll('#propertyOsBody .pcv-month-t')).map(e => e.textContent);
    const r3 = PropertyCabinetView.openInvoice('td-1');
    const s3 = PropertyCabinetView.state();
    const r4 = PropertyCabinetView.openInvoice('gv-und');
    const s4 = PropertyCabinetView.state();
    const und = Array.from(document.querySelectorAll('#propertyOsBody .pcv-month')).map(m => m.dataset.month);
    location.hash = '#property/invoices/Austin%20Energy';
    await new Promise(r => setTimeout(r, 150));
    const s5 = PropertyCabinetView.state();
    history.replaceState(null, '', location.pathname);
    return { s1: [s1.drawer, s1.fVendor, s1.fYear, s1.recordId], f1: f1.invId, r2, s2: [s2.fVendor, s2.fYear], f2: f2.invId, months2,
             r3, s3: [s3.fVendor, s3.fYear], r4, s4: [s4.fVendor, s4.fYear], und, s5: [s5.drawer, s5.fVendor, s5.fYear] };
  }, GV);
  is(E.s1, ['invoices', GV, '2025', 'gv-25-9'], '#property/invoices/<vendor>/<year>/<id> opens the vendor’s year');
  is(E.f1, 'gv-25-9', 'and highlights that bill');
  is(E.r2 === true && E.s2[0] === 'Austin Energy' && E.s2[1] === '2025' && E.f2 === 'ae-2', true, 'openInvoice(id) files the bill in its vendor’s year and highlights it');
  is(E.months2, ['January', 'April', 'July', 'October'], 'Austin Energy 2025: the four quarterly bills, by month');
  is(E.r3 === false && E.s3[0] === 'Austin Energy', true, 'a tenant-direct invoice is filed under its Space — openInvoice declines, and nothing moves');
  is(E.r4 === true && E.s4[0] === GV && E.s4[1] === 'undated' && E.und[0] === 'undated', true, 'an undated bill opens the vendor’s Undated folder');
  is(E.s5, ['invoices', 'Austin Energy', null], 'a hash change opens the vendor folder it names');

  // ══ F · the trail walks back up ════════════════════════════════════════════
  sec('F · the breadcrumb walks back up the cabinet');
  const F = await page.evaluate((GV) => {
    PropertyCabinetView.openInvoiceFolder(GV, '2024');
    const ups = () => Array.from(document.querySelectorAll('#propertyOsBody .pcv-crumb .pcv-crumb-up')).map(e => e.textContent);
    const u1 = ups();
    document.querySelector('#propertyOsBody .pcv-crumb .pcv-crumb-up[data-vendor]').click();
    const s1 = PropertyCabinetView.state();
    const y = Array.from(document.querySelectorAll('#propertyOsBody .pcv-folder')).map(f => f.dataset.year);
    document.querySelector('#propertyOsBody .pcv-crumb .pcv-crumb-up').click();
    const s2 = PropertyCabinetView.state();
    return { u1, s1: [s1.fVendor, s1.fYear], y, s2: [s2.drawer, s2.fVendor, s2.fYear], hash: location.hash,
             folders: document.querySelectorAll('#propertyOsBody .pcv-folder[data-vendor]').length };
  }, GV);
  is(F.u1, ['Invoices', GV], 'at a year, Invoices and the vendor are steps up');
  is(F.s1, [GV, null], 'the vendor step returns to its years');
  is(F.y, ['2025', '2024', 'undated'], '…all three of them');
  is(F.s2, ['invoices', null, null], 'the Invoices step returns to the cabinet');
  is(F.hash === '#property/invoices' && F.folders === 4, true, 'address and folders back at the top');

  // ══ G · Search & filter is still there ═════════════════════════════════════
  sec('G · Search & filter — the flat, paged list is one click away');
  const G = await page.evaluate(async () => {
    const b = document.getElementById('propertyOsBody');
    document.querySelector('#propertyOsBody .pcv-link').click();          // Search & filter
    const mode = (b.querySelector('[data-mode]') || {}).dataset.mode;
    const rows = b.querySelectorAll('.pos-inv').length;
    const summary = (document.getElementById('pcvInvSummary') || {}).textContent;
    const selects = b.querySelectorAll('.pcv-toolbar select').length;
    PropertyCabinetView.setInvoiceMode('folders');
    const back = (b.querySelector('[data-mode]') || {}).dataset.mode;
    PropertyCabinetView.setQuery('bright');
    await new Promise(r => setTimeout(r, 300));
    const typed = { mode: (b.querySelector('[data-mode]') || {}).dataset.mode, rows: b.querySelectorAll('.pos-inv').length, q: (document.getElementById('pcvInvSearch') || {}).value };
    PropertyCabinetView.setInvoiceMode('folders');
    return { mode, rows, summary, selects, back, typed, foldersAgain: b.querySelectorAll('.pcv-folder[data-vendor]').length };
  });
  is(G.mode, 'search', 'Search & filter switches to the flat list');
  is(G.rows === 24 && G.summary === 'Showing 1–24 of 24 invoices', true, 'which pages the property’s invoices as before');
  is(G.selects, 4, 'with the year · vendor · category · scope filters');
  is(G.back, 'folders', 'Browse by vendor returns to the cabinet');
  is(G.typed, { mode: 'search', rows: 3, q: 'bright' }, 'typing at the top of the cabinet searches everything');
  is(G.foldersAgain, 4, 'and the cabinet is a click away again');

  // ══ H · nothing filed twice ════════════════════════════════════════════════
  sec('H · every property invoice is in exactly one leaf');
  const H = await page.evaluate(() => {
    const p = _props[0];
    const seen = {};
    PropertyCabinet.invoiceFolders(p).forEach(f => f.years.forEach(y => {
      PropertyCabinet.invoiceFolder(p, f.vendor, y.year).months.forEach(m => m.items.forEach(i => { seen[i.id] = (seen[i.id] || 0) + 1; }));
    }));
    const dup = Object.keys(seen).filter(k => seen[k] !== 1);
    const propertyIds = p.invoices.filter(i => !i.spaceId).map(i => i.id).sort();
    return { dup, covered: Object.keys(seen).sort(), propertyIds };
  });
  is(H.dup, [], 'no invoice appears in two leaves');
  is(H.covered, H.propertyIds, 'and every property invoice appears in one');

  // ══ I · empty states ═══════════════════════════════════════════════════════
  sec('I · empty states are truthful');
  const I = await page.evaluate(() => {
    const bare = { id: 'prop-bare', name: 'Bare', totalSqft: 1000, tenants: [], timeline: [], invoices: [], disputes: [], activityLog: [] };
    _props = [bare]; activePropId = bare.id; PropertyOS.renderPropertyPage(bare);
    PropertyCabinetView.openDrawer('invoices');
    const none = (document.querySelector('#propertyOsBody .pcv-empty') || {}).textContent || '';
    const onlyTd = { id: 'prop-td', name: 'TD', totalSqft: 1000, tenants: [{ id: 't1', tenant_name: 'A', suite: '1' }], timeline: [],
      invoices: [{ id: 'x', vendorName: 'V', amount: 1, invoiceDate: '2025-01-01', spaceId: 't1' }], disputes: [], activityLog: [] };
    _props = [onlyTd]; activePropId = onlyTd.id; PropertyOS.renderPropertyPage(onlyTd);
    PropertyCabinetView.openDrawer('invoices');
    const td = (document.querySelector('#propertyOsBody .pcv-empty') || {}).textContent || '';
    return { none, td, folders: document.querySelectorAll('#propertyOsBody .pcv-folder').length };
  });
  is(/No invoices on this property yet/.test(I.none) && /each vendor becomes a folder/.test(I.none), true, 'no invoices: says so, and says what will appear');
  is(/No property invoices yet/.test(I.td) && /1 tenant-direct invoice/.test(I.td) && /under their Space/.test(I.td), true, 'only tenant-direct invoices: says where they are filed');
  is(I.folders, 0, 'and offers no folder for them');

  // ══ J · reference samples are unmistakably not records ═════════════════════
  sec('J · Building & Systems: reference samples are not records');
  const J = await page.evaluate(() => {
    const demo = { id: 'prop-demo', _demoVersion: 1, name: 'Demo Plaza', totalSqft: 26000, tenants: [], timeline: [], invoices: [], disputes: [], activityLog: [] };
    _props = [demo]; activePropId = demo.id; PropertyOS.renderPropertyPage(demo);
    PropertyCabinetView.openDrawer('building');
    const b = document.getElementById('propertyOsBody');
    const recTitle = Array.from(b.querySelectorAll('.pcv-sec-title')).find(e => /^Records/.test(e.textContent.trim()));
    const box = b.querySelector('.pcv-samples');
    const out = {
      recordsCount: recTitle ? recTitle.querySelector('.pcv-count').textContent : null,
      recordCards: b.querySelectorAll('.pos-rec').length,
      box: !!box, closed: box ? !box.open : null,
      summary: box ? box.querySelector('summary').textContent.replace(/\s+/g, ' ').trim() : '',
      sampleRows: box ? box.querySelectorAll('.pos-doc--ref').length : 0,
      tagged: box ? box.querySelectorAll('.pos-doc--ref .pos-doc-sample').length : 0,
      afterRecords: box && recTitle ? !!(recTitle.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
      emptyCopy: (b.querySelector('.pcv-empty') || {}).textContent || '',
    };
    const real = { id: 'prop-real', name: 'Real', totalSqft: 1000, tenants: [], timeline: [], invoices: [], disputes: [], activityLog: [] };
    _props = [real]; activePropId = real.id; PropertyOS.renderPropertyPage(real);
    PropertyCabinetView.openDrawer('building');
    out.realHasBox = !!document.querySelector('#propertyOsBody .pcv-samples');
    return out;
  });
  is(J.recordsCount === '0' && J.recordCards === 0, true, 'a demo property with nothing recorded says Records 0 and shows no record card');
  is(/Nothing recorded on the building yet/.test(J.emptyCopy), true, 'and the empty state says so');
  is(J.box && J.closed, true, 'the reference samples sit in their own box, closed by default');
  is(/Reference samples/.test(J.summary) && /not records on this property/i.test(J.summary) && /demo only/i.test(J.summary), true, 'whose heading says they are not records on this property (demo only)');
  is(J.sampleRows > 0 && J.tagged === J.sampleRows, true, `every sample row is tagged “sample” (${J.sampleRows})`);
  is(J.afterRecords, true, 'and the box comes after the records, never among them');
  is(J.realHasBox, false, 'a real property has no reference samples at all');

  // ══ K · phone width ════════════════════════════════════════════════════════
  sec('K · the cabinet fits a phone');
  const m = await boot({ width: 390, height: 900 });
  const K = await m.page.evaluate(({ prop, mount }) => {
    eval(mount);
    const wide = () => document.documentElement.scrollWidth > window.innerWidth + 2;
    PropertyCabinetView.openDrawer('invoices');
    const l0 = wide();
    PropertyCabinetView.openInvoiceFolder('Green Valley Landscape', '2025');
    const l2 = wide();
    return { l0, l2, months: document.querySelectorAll('.pcv-month').length };
  }, { prop: PROP, mount: MOUNT });
  is(K.l0, false, 'the folders do not scroll sideways at 390px');
  is(K.l2 === false && K.months === 12, true, 'nor a year of bills');
  await m.ctx.close();

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await ctx.close(); await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
