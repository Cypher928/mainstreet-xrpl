// test-e2e-demo-showroom.js
// ============================================================================
// THE SHOWROOM — Cascade Commons with its filing cabinet populated.
//
// The seeded demo property is the first thing most people see, and after
// Phase 1 it opened onto a cabinet of mostly empty drawers. v8 of the seed
// fills them with the building's own records. This suite walks the populated
// property through the real load path (ensureDemoProperty → Supabase stand-in
// → selectProperty) and checks what the user asked to be checked:
//
//   · every demo record lands in the drawer it was written for, and only there;
//   · records are not duplicated across drawers; ids are unique;
//   · dates are coherent — no record from the future, no key date before its
//     record, the policy record agrees with Property information;
//   · vendors on agreement records match the vendors on the invoices they link;
//   · system records reach the correct invoices (the HVAC story is ComfortFirst's
//     three bills; the parking story is the PavePro bill FitZone disputed);
//   · Important Dates are DERIVED from persisted record data — after a real
//     reload the dates still come from the stored row, and a key date written
//     through appendPropertyTimelineEvent survives save → reload;
//   · every attached document opens through the app's one document path
//     (docLinkHtml) and is a real, labelled, text-layer PDF;
//   · the property image is unmistakably a demonstration illustration;
//   · the reference samples remain samples: in their own box, never counted.
//
// Run: node test-e2e-demo-showroom.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8966;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const yes = (c, label, d) => c ? ok(label) : bad(label, d);

// A Supabase stand-in whose rows OUTLIVE A RELOAD (mirrored into localStorage),
// so "is it still there after a reload" is a real question.
const DB = `
(function(){
  var U={id:'showroom-user-0001-4000-a000-000000000001',email:'pm@example.com'};
  function P(v){return Promise.resolve(v);}
  function store(){try{return JSON.parse(localStorage.getItem('__mockdb')||'{}');}catch(e){return {};}}
  function put(s){localStorage.setItem('__mockdb',JSON.stringify(s));}
  function tbl(n){var s=store();s[n]=s[n]||[];return s[n];}
  function save(n,r){var s=store();s[n]=r;put(s);}
  function uuid(){return 'p'+Math.random().toString(16).slice(2,10)+'-1111-4000-a000-'+Date.now().toString(16);}
  function q(name){var filters=[],single=false;
    var api={select:function(){return api;},eq:function(k,v){filters.push([k,v]);return api;},
      neq:function(){return api;},is:function(){return api;},not:function(){return api;},
      order:function(){return api;},limit:function(){return api;},ilike:function(){return api;},
      gte:function(){return api;},lte:function(){return api;},
      in:function(){return P({data:[],error:null});},
      single:function(){single=true;return run();},
      maybeSingle:function(){single=true;return run();},
      insert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        var made=arr.map(function(x){var c=Object.assign({},x);if(!c.id)c.id=uuid();rows.push(c);return c;});
        save(name,rows);var p=P({data:made,error:null});
        p.select=function(){var q2=P({data:made,error:null});q2.single=function(){return P({data:made[0],error:null});};return q2;};return p;},
      upsert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        arr.forEach(function(x){var i=rows.findIndex(function(y){return y.id===x.id;});if(i>=0)rows[i]=Object.assign({},rows[i],x);else rows.push(Object.assign({},x));});
        save(name,rows);var p=P({data:arr,error:null});
        p.select=function(){var q2=P({data:arr,error:null});q2.single=function(){return P({data:arr[0],error:null});};return q2;};return p;},
      update:function(){var p=P({data:null,error:null});p.eq=function(){return P({data:null,error:null});};p.select=function(){return P({data:null,error:null});};return p;},
      delete:function(){return {eq:function(k,v){var rows=tbl(name).filter(function(r){return r[k]!==v;});save(name,rows);return P({error:null});}};},
      then:function(f){return run().then(f);}};
    function run(){var rows=tbl(name).filter(function(r){return filters.every(function(f){return r[f[0]]===f[1];});});
      if(single)return P(rows.length?{data:rows[0],error:null}:{data:null,error:{message:'no rows'}});
      return P({data:rows,error:null});}
    return api;}
  window.supabase={createClient:function(){return {auth:{
    getUser:function(){return P({data:{user:U},error:null});},
    getSession:function(){return P({data:{session:{user:U}},error:null});},
    onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:U});},40);return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return P({error:null});}
  },rpc:function(){return P({data:null,error:null});},
    from:function(n){return q(n);},
    storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;

// ── What the seed intends: record id → drawer. Written here independently of
// PropertyCabinet.drawerOfRecord so the test asserts intent, not the map's echo.
const EXPECTED = {
  taxes:      ['tax-2023-notice', 'tax-2023-bill', 'tax-2024-notice', 'tax-2024-protest', 'tax-2024-bill', 'tax-2024-paid',
               'tax-2025-notice', 'tax-2025-bill', 'tax-2026-notice'],
  insurance:  ['ins-2024-renewal', 'ins-2024-hail-claim', 'ins-2025-renewal', 'ins-2025-lender-coi'],
  financing:  ['loan-2019-note', 'loan-2022-amendment', 'loan-2025-escrow', 'loan-2026-reporting'],
  financials: ['fin-2024-cam-close', 'fin-2025-budget', 'fin-2026-q1-distribution', 'fin-2026-q2-distribution', 'fin-2026-budget-draft'],
  agreements: ['agr-management', 'agr-landscaping', 'agr-hvac-pm', 'agr-security', 'agr-janitorial'],
  building:   ['roof-2019-replacement', 'roof-2019-warranty', 'roof-2024-hail-inspection', 'roof-2025-repair',
               'hvac-2024-rtu-replacement', 'hvac-2025-spring-pm', 'hvac-2025-fall-pm', 'hvac-2025-emergency',
               'parking-2019-restripe', 'parking-2025-sealcoat', 'fire-2025-inspection', 'land-2025-irrigation',
               'elec-2024-led-retrofit', 'elec-2025-signage-service', 'plumb-2026-backflow',
               'photo-2025-north', 'photo-2025-parking'],
  history:    ['hist-2003-built', 'hist-2019-acquisition', 'hist-2019-renovation', 'hist-2021-whm-opening', 'hist-2024-harbor-opening'],
};
const ALL_IDS = Object.values(EXPECTED).flat().map(s => 'demo-rec-' + s);
const KEY_DATES = [ // record → the date the building has to meet, and its kind
  ['demo-rec-roof-2019-warranty', '2039-08-30', 'expiry'],
  ['demo-rec-loan-2019-note',     '2029-11-01', 'maturity'],
  ['demo-rec-fire-2025-inspection', '2026-10-20', 'inspection'],
  ['demo-rec-agr-management',     '2026-12-31', 'renewal'],
  ['demo-rec-agr-hvac-pm',        '2027-03-31', 'renewal'],
  ['demo-rec-plumb-2026-backflow', '2027-02-15', 'inspection'],
  ['demo-rec-tax-2026-notice',    '2027-01-31', 'deadline'],
];
const sorted = a => a.slice().sort();

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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(DB);

  // Boot, hide the landing, load the demo through the real path, open the Property tab.
  const boot = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    await page.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
    await page.waitForTimeout(600);
    await page.evaluate(() => loadDemo());
    await page.waitForFunction(() => {
      const el = document.getElementById('mainWorkflow');
      return el && el.style.display !== 'none' && (currentProperty() || {}).timeline && currentProperty().timeline.length > 20;
    }, null, { timeout: 30000 });
    await page.evaluate(() => switchWorkspaceTab('property'));
    await page.waitForTimeout(700);
  };
  // Every record shown in the open drawer (paging through "Show more").
  const DRAWER_IDS = `(function(){
    var ids = function(){ return Array.from(document.querySelectorAll('#propertyOsBody .pos-recs .pos-rec')).map(function(r){ return r.dataset.recId; }); };
    for (var i = 0; i < 20; i++) { var m = document.querySelector('#propertyOsBody .pcv-more'); if (!m) break; m.click(); }
    return ids();
  })()`;

  await boot();

  // ══ 0 · the seed itself ════════════════════════════════════════════════════
  sec('0 · Cascade Commons v8 is seeded through the real path and persisted');
  const seed = await page.evaluate(() => {
    const p = currentProperty();
    const row = (JSON.parse(localStorage.getItem('__mockdb') || '{}').properties || []).find(r => r.id === DEMO_PROPERTY_ID);
    const recs = (p.timeline || []).filter(e => /^demo-rec-/.test(String(e.id)));
    return {
      id: p.id, isDemo: PropertyReference.isDemo(p), demoV: row && row.data && row.data._demoV,
      recCount: recs.length, timelineLen: p.timeline.length,
      rowRecCount: row ? (row.data.timeline || []).filter(e => /^demo-rec-/.test(String(e.id))).length : -1,
      uniqueIds: new Set(p.timeline.map(e => String(e.id))).size === p.timeline.length,
      allManual: recs.every(e => e.manual === true && typeof e.category === 'string' && e.category),
      invoiceIds: (p.invoices || []).map(i => i.id),
      registerN: (p.invoices || []).length,
    };
  });
  yes(seed.isDemo, 'the loaded property is the demo property');
  is(seed.demoV, 8, 'the stored row is seed version 8');
  is(seed.recCount, ALL_IDS.length, `the timeline carries all ${ALL_IDS.length} demo cabinet records`);
  is(seed.rowRecCount, ALL_IDS.length, '…and the STORED row carries them too (they are persisted, not rendered)');
  yes(seed.uniqueIds, 'every timeline event id is unique — no record exists twice');
  yes(seed.allManual, 'every demo record is an ordinary manual record with a category (no new record type)');
  is(seed.invoiceIds, Array.from({ length: 26 }, (_, i) => 'inv-' + i), 'the 26 invoices on the register carry the stable ids the summary and disputes already use');

  // ══ 1 · every record lands in its drawer, and only there ═══════════════════
  sec('1 · each demo record is filed in the intended drawer, and in no other');
  const filed = await page.evaluate((DRAWER_IDS) => {
    const out = {}, counts = {}, tiles = {};
    const idx = PropertyCabinet.buildIndex(currentProperty());
    ['taxes', 'insurance', 'financing', 'financials', 'agreements', 'building', 'history'].forEach(k => {
      PropertyCabinetView.openDrawer(k, { year: null, cat: 'all', system: null, recordId: null });
      out[k] = eval(DRAWER_IDS).filter(id => /^demo-rec-/.test(id));
      counts[k] = idx.drawers[k].count;
    });
    PropertyCabinetView.closeDrawer();
    document.querySelectorAll('#propertyOsBody .pcv-tile').forEach(t => {
      tiles[t.dataset.drawer] = (t.querySelector('.pcv-tile-m') || {}).textContent || '';
    });
    return { out, counts, tiles };
  }, DRAWER_IDS);
  Object.keys(EXPECTED).forEach(k => {
    is(sorted(filed.out[k]), sorted(EXPECTED[k].map(s => 'demo-rec-' + s)), `${k}: exactly the intended records are shown (${EXPECTED[k].length})`);
  });
  const seen = {};
  Object.keys(filed.out).forEach(k => filed.out[k].forEach(id => { seen[id] = (seen[id] || 0) + 1; }));
  yes(ALL_IDS.every(id => seen[id] === 1), 'no demo record appears in two drawers, and none is missing', JSON.stringify(seen));
  yes(/17 record/.test(filed.tiles.building), 'the Building & Systems tile counts the 17 records — not the reference samples', filed.tiles.building);
  yes(/9 record/.test(filed.tiles.taxes) && /4 record/.test(filed.tiles.insurance) && /5 record/.test(filed.tiles.agreements),
      'the Taxes, Insurance and Agreements tiles count their records', JSON.stringify(filed.tiles));

  // ══ 2 · dates are coherent ═════════════════════════════════════════════════
  sec('2 · dates are coherent with each other and with Property information');
  const dates = await page.evaluate(() => {
    const p = currentProperty();
    const info = PropertyReference.infoFor(p);
    const recs = p.timeline.filter(e => /^demo-rec-/.test(String(e.id)));
    const now = Date.now();
    const future = recs.filter(e => new Date(e.timestamp).getTime() > now).map(e => e.id);
    const badKey = recs.filter(e => e.keyDate && new Date(e.keyDate) < new Date(e.timestamp)).map(e => e.id);
    const badKind = recs.filter(e => e.keyDate && !PropertyCabinet.KEY_DATE_KINDS.includes(e.keyDateKind)).map(e => e.id);
    const keyed = recs.filter(e => e.keyDate).map(e => [e.id, e.keyDate, e.keyDateKind]);
    const policy = recs.find(e => e.id === 'demo-rec-ins-2025-renewal');
    const leaseRefs = recs.filter(e => /whm-opening|harbor-opening/.test(e.id)).map(e => e.description);
    const whm = p.tenants.find(t => /Whole Health/.test(t.tenant_name)), harbor = p.tenants.find(t => /Harbor Nail/.test(t.tenant_name));
    return {
      future, badKey, badKind, keyed,
      policyAgrees: !!policy && policy.title.includes(info.insurancePolicyNo) && policy.description.includes('September 30, 2026') && info.insuranceExpires === '2026-09-30',
      whmEnd: whm && whm.end_date, harborEnd: harbor && harbor.end_date, leaseRefs,
      years: Object.keys(PropertyCabinet.buildIndex(p).drawers.taxes.years).filter(y => y !== 'undated').sort(),
    };
  });
  is(dates.future, [], 'no demo record is dated in the future');
  is(dates.badKey, [], 'no key date falls before the record that carries it');
  is(dates.badKind, [], 'every key date carries one of the cabinet’s known kinds');
  is(sorted(dates.keyed.map(k => k.join('|'))), sorted(KEY_DATES.map(k => k.join('|'))), 'exactly the intended records carry key dates, with the intended dates and kinds');
  yes(dates.policyAgrees, 'the 2025–26 policy record names the same policy number and expiry as Property information');
  yes(dates.whmEnd === '2028-12-31' && /December 31, 2028/.test(dates.leaseRefs[0]), 'the Whole Health Market opening record agrees with the tenant’s lease end');
  yes(dates.harborEnd === '2027-01-31' && /January 31, 2027/.test(dates.leaseRefs[1]), 'the Harbor Nail opening record agrees with the tenant’s lease end');
  is(dates.years, ['2023', '2024', '2025', '2026'], 'Real Estate Taxes spans 2023–2026 by year');

  // ══ 3 · vendors and invoice links resolve on the register ══════════════════
  sec('3 · vendors match the register; every invoice link resolves');
  const vend = await page.evaluate(() => {
    const p = currentProperty();
    const reg = PropertyOS.invoices(p);
    const byId = {}; reg.forEach(i => { byId[i.id] = i; });
    const recs = p.timeline.filter(e => /^demo-rec-/.test(String(e.id)));
    const missing = [];
    recs.forEach(e => { const g = PropertyOS.relatedGroup(p, e.id); if (g.missingInvoices.length) missing.push([e.id, g.missingInvoices]); });
    const agreements = recs.filter(e => e.category === 'vendor').map(e => ({
      id: e.id, title: e.title,
      vendors: Array.from(new Set((e.relatedTo || []).filter(r => r.kind === 'invoice').map(r => (byId[r.id] || {}).vendorName))),
    }));
    const disputes = p.disputes.map(d => ({ id: d.invoiceId, vendor: d.vendor, onRegister: (byId[d.invoiceId] || {}).vendorName }));
    return { missing, agreements, disputes, vendorsOnRegister: Array.from(new Set(reg.map(i => i.vendorName))).sort() };
  });
  is(vend.missing, [], 'no record links to an invoice that is not on the register');
  vend.agreements.forEach(a => {
    yes(a.vendors.length === 1 && a.title.includes(a.vendors[0]), `${a.id} links only invoices from the vendor it names (${a.vendors[0]})`, JSON.stringify(a));
  });
  yes(vend.disputes.every(d => d.onRegister === d.vendor), 'each dispute’s invoiceId now resolves to the register row with that vendor', JSON.stringify(vend.disputes));

  // ══ 4 · system records reach the right invoices ════════════════════════════
  sec('4 · a building system’s story reaches its own invoices');
  const sys = await page.evaluate(() => {
    const p = currentProperty();
    const story = k => { const s = PropertyOS.systemStory(p, k); return { events: s.events.map(e => e.id).sort(), invoices: s.invoices.map(i => i.id + ':' + i.vendorName + ':' + i.amount).sort() }; };
    PropertyCabinetView.openDrawer('building', { system: 'hvac', cat: 'all', year: null, recordId: null });
    const note = (document.querySelector('#propertyOsBody .pos-filter-note') || {}).textContent || '';
    const shown = Array.from(document.querySelectorAll('#propertyOsBody .pos-recs .pos-rec')).map(r => r.dataset.recId).sort();
    const emergency = document.querySelector('#propertyOsBody .pos-rec[data-rec-id="demo-rec-hvac-2025-emergency"]');
    const related = emergency ? Array.from(emergency.querySelectorAll('.pos-ri-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()) : null;
    PropertyCabinetView.openDrawer('building', { system: 'parking', cat: 'all', year: null, recordId: null });
    const parkNote = (document.querySelector('#propertyOsBody .pos-filter-note') || {}).textContent || '';
    return { hvac: story('hvac'), parking: story('parking'), roof: story('roof'), note, shown, related, parkNote };
  });
  is(sys.hvac.invoices, ['inv-18:ComfortFirst HVAC:3200', 'inv-25:ComfortFirst HVAC:2900', 'inv-6:ComfortFirst HVAC:3400'],
     'the HVAC story is ComfortFirst’s three 2025 bills — spring PM, fall PM, emergency — and nothing else');
  is(sys.hvac.events.filter(e => /^demo-rec-/.test(e)).length, 5, 'and its records include the four HVAC records plus the maintenance agreement they link');
  is(sys.parking.invoices, ['inv-7:PavePro Inc:5700'], 'the Parking Lot story reaches the PavePro seal-coat bill FitZone disputed');
  yes(sys.roof.invoices.length === 1 && /Cascade Handyman/.test(sys.roof.invoices[0]), 'the Roof story reaches the October repair work-order bill');
  yes(/HVAC/.test(sys.note) && /3 invoices/.test(sys.note) && /\$9,500/.test(sys.note), 'the Building drawer says so: "Showing HVAC — … 3 invoices ($9,500)"', sys.note);
  is(sys.shown, ['demo-rec-hvac-2024-rtu-replacement', 'demo-rec-hvac-2025-emergency', 'demo-rec-hvac-2025-fall-pm', 'demo-rec-hvac-2025-spring-pm'],
     'the HVAC filter shows the four HVAC records');
  yes(sys.related && sys.related.some(r => /ComfortFirst HVAC/.test(r) && /\$2,900/.test(r)), 'the emergency-repair card lists the $2,900 ComfortFirst bill as a related item', JSON.stringify(sys.related));
  yes(/2 records, 1 invoice \(\$5,700(\.00)?\)/.test(sys.parkNote), 'and Parking Lot: "2 records, 1 invoice ($5,700)"', sys.parkNote);

  // ══ 5 · Important Dates are derived from persisted record data ═════════════
  sec('5 · Important Dates come from the records — and from the STORED records after a reload');
  const readDates = `(function(){
    PropertyCabinetView.openDrawer('dates');
    return Array.from(document.querySelectorAll('#propertyOsBody .pcv-date')).map(function (r) {
      return { kind: r.dataset.kind, d: r.querySelector('.pcv-date-d').textContent, t: r.querySelector('.pcv-date-t').textContent,
               where: (r.querySelector('.pcv-link') || {}).textContent || '' };
    });
  })()`;
  const d1 = await page.evaluate((src) => {
    const rows = eval(src);
    const pure = PropertyCabinet.importantDates(PropertyReference.infoFor(currentProperty()) ? Object.assign({}, currentProperty(), { info: PropertyReference.infoFor(currentProperty()) }) : currentProperty(), { horizonDays: null });
    return { rows, pure: pure.map(x => [x.date, x.kind, x.source.type, x.source.id]) };
  }, readDates);
  const recordDates = d1.pure.filter(x => x[2] === 'record');
  is(sorted(recordDates.map(x => x[3] + '|' + x[0] + '|' + x[1])), sorted(KEY_DATES.map(k => k.join('|'))),
     'the seven key dates are derived, each pointing at its record');
  is(d1.pure.filter(x => x[1] === 'insurance_renewal').length, 1, 'the insurance expiry appears once (from Property information) — the policy record does not duplicate it');
  yes(d1.rows.some(r => r.kind === 'expiry' && /2039/.test(r.d) && /Roof warranty/.test(r.t) && /Building/.test(r.where)),
      'the drawer shows "Roof warranty — 20-year…" in 2039 as an Expiry, pointing into Building & Systems', JSON.stringify(d1.rows.slice(0, 3)));
  yes(d1.rows.some(r => r.kind === 'maturity' && /2029/.test(r.d) && /Financing/.test(r.where)), 'the loan maturity in 2029 points into Mortgage & Financing');
  const jump = await page.evaluate(() => {
    PropertyCabinetView.openDrawer('dates');
    const row = Array.from(document.querySelectorAll('#propertyOsBody .pcv-date')).find(r => r.dataset.kind === 'maturity');
    row.querySelector('.pcv-link').click();
    const st = PropertyCabinetView.state();
    return { drawer: st.drawer, focus: !!document.querySelector('#propertyOsBody .pos-rec--focus[data-rec-id="demo-rec-loan-2019-note"]') };
  });
  is(jump, { drawer: 'financing', focus: true }, 'clicking the maturity date opens the Financing drawer on the loan record');

  // A key date written through the app's own writer, saved, then reloaded — on
  // a property the demo seeder has never heard of, so what comes back is what
  // was stored, not what a reseed would have written.
  const REAL = 'p-showroom-real-1';
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const wrote = await page.evaluate(async ({ id, soon }) => {
    const prop = { id, name: 'Elm Street Center', totalSqft: 12000, status: 'in-progress', createdAt: new Date().toISOString(),
      info: { address: '77 Elm Street, Portland, OR 97204' },
      tenants: [{ id: id + '-t1', tenant_name: 'Alder Dental', suite: '100', leased_sqft: 4000, start_date: '2021-01-01', end_date: '2027-01-31',
                  lease_type: 'NNN', cap: null, flags: [], confidence: {} }],
      invoices: [], disputes: [], activityLog: [], timeline: [] };
    _props.push(prop);
    const good = appendPropertyTimelineEvent(prop, { manual: true, category: 'inspection', type: 'manual_inspection', title: 'Elevator permit renewal',
      description: 'Written through appendPropertyTimelineEvent', keyDate: soon, keyDateKind: 'permit', subject: { type: 'property', id }, actor: 'Test' });
    const vague = appendPropertyTimelineEvent(prop, { manual: true, category: 'inspection', type: 'manual_inspection', title: 'Vague date',
      keyDate: 'sometime soon', keyDateKind: 'bogus', subject: { type: 'property', id }, actor: 'Test' });
    const sloppy = appendPropertyTimelineEvent(prop, { manual: true, category: 'inspection', type: 'manual_inspection', title: 'Timestamped date',
      keyDate: '2027-03-05 10:00', keyDateKind: 'deadline', subject: { type: 'property', id }, actor: 'Test' });
    prop.timeline = prop.timeline.filter(e => e.id !== sloppy.id);   // shape checked; keep the property's dates to the two above
    await saveProperty(prop);
    await new Promise(r => setTimeout(r, 800));
    const row = (JSON.parse(localStorage.getItem('__mockdb') || '{}').properties || []).find(r => r.id === id);
    const stored = row && (row.data.timeline || []).find(e => e.id === good.id);
    return { goodKey: good.keyDate, goodKind: good.keyDateKind, vagueKey: vague.keyDate, vagueKind: vague.keyDateKind,
             sloppyKey: sloppy.keyDate, storedKey: stored && stored.keyDate, storedKind: stored && stored.keyDateKind, goodId: good.id };
  }, { id: REAL, soon });
  is([wrote.goodKey, wrote.goodKind], [soon, 'permit'], 'appendPropertyTimelineEvent keeps a readable keyDate and a known kind');
  is([wrote.vagueKey, wrote.vagueKind], [null, null], '…and refuses an unreadable date and an unknown kind rather than guessing');
  is(wrote.sloppyKey, '2027-03-05', '…and keeps only the day of a date that arrives with a time on it');
  is([wrote.storedKey, wrote.storedKind], [soon, 'permit'], 'the saved row carries the key date');

  await boot();   // a REAL reload: the store is what is left
  const d2 = await page.evaluate((args) => {
    const rows = eval(args.src);
    const p = currentProperty();
    const row = (JSON.parse(localStorage.getItem('__mockdb') || '{}').properties || []).find(r => r.id === DEMO_PROPERTY_ID);
    const fromRow = (row.data.timeline || []).filter(e => e.keyDate).map(e => e.id + '|' + e.keyDate).sort();
    const inMem = p.timeline.filter(e => e.keyDate).map(e => e.id + '|' + e.keyDate).sort();
    return { rows, fromRow, inMem, demoV: row.data._demoV, recCount: p.timeline.filter(e => /^demo-rec-/.test(String(e.id))).length };
  }, { src: readDates });
  is(d2.recCount, ALL_IDS.length, 'after the reload the demo records are all there');
  is(d2.inMem, d2.fromRow, 'and the key dates in memory are exactly the key dates in the stored row — read from the row, not invented at render');
  yes(d2.rows.filter(r => r.kind === 'expiry' && /2039/.test(r.d)).length === 1, 'the roof warranty date is still derived after the reload, exactly once');
  const d3 = await page.evaluate(async ({ id, src }) => {
    await selectProperty(id);
    await new Promise(r => setTimeout(r, 600));
    switchWorkspaceTab('property');
    const rows = eval(src);
    const p = currentProperty();
    return { name: p.name, rows, keyed: p.timeline.filter(e => e.keyDate).map(e => [e.title, e.keyDate, e.keyDateKind]),
             permit: rows.find(r => r.kind === 'permit') || null };
  }, { id: REAL, src: readDates });
  is(d3.name, 'Elm Street Center', 'the real property reopens after the reload');
  is(d3.keyed, [['Elevator permit renewal', soon, 'permit']], 'its timeline carries the one key date the writer kept — the unreadable one stayed null');
  yes(d3.permit && /Elevator permit renewal/.test(d3.permit.t) && /Building/.test(d3.permit.where), 'and the Dates drawer derives it: a Permit pointing into Building & Systems', JSON.stringify(d3.permit));
  yes(d3.rows.some(r => r.kind === 'lease_expiration' && /Alder Dental/.test(r.t)), 'beside the lease end derived from the tenant row');

  // ══ 6 · documents open through the existing document path ══════════════════
  sec('6 · attached documents open through docLinkHtml, as labelled text-layer PDFs');
  const docs = await page.evaluate(async () => {
    await selectProperty(DEMO_PROPERTY_ID);
    await new Promise(r => setTimeout(r, 600));
    switchWorkspaceTab('property');
    const p = currentProperty();
    const recs = p.timeline.filter(e => /^demo-rec-/.test(String(e.id)));
    const atts = [];
    recs.forEach(e => (e.attachments || []).forEach(a => atts.push({ rec: e.id, name: a.name, url: a.url, kind: a.kind, stored: isStoredDocumentRef(a.url) })));
    PropertyCabinetView.openRecord('demo-rec-tax-2025-bill');
    const card = document.querySelector('#propertyOsBody .pos-rec[data-rec-id="demo-rec-tax-2025-bill"]');
    const chip = card && card.querySelector('.pos-rec-att .pos-doc');
    return { atts, chip: chip ? { tag: chip.tagName, href: chip.getAttribute('href'), target: chip.getAttribute('target'), text: chip.textContent.trim(), viaButton: chip.hasAttribute('data-doc-url') } : null };
  });
  is(docs.atts.length, 14, 'fourteen attachments across the records (12 PDFs, 2 illustrations)');
  yes(docs.atts.every(a => !a.stored), 'none is a storage reference — they are static demonstration files, not a parallel document store');
  yes(docs.chip && docs.chip.tag === 'A' && docs.chip.href === 'assets/demo/records/tax-bill-2025.pdf' && docs.chip.target === '_blank' && !docs.chip.viaButton,
      'the record card renders the file through docLinkHtml as a plain link (the same chip every record uses)', JSON.stringify(docs.chip));
  yes(docs.atts.every(a => /demonstration|illustration/i.test(a.name)), 'every attachment’s NAME says demonstration/illustration');
  let pdfjs = null;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); } catch (_) {}
  for (const a of docs.atts) {
    const res = await page.request.get(`http://127.0.0.1:${PORT}/${a.url}`);
    const ct = res.headers()['content-type'] || '';
    const expectCt = a.url.endsWith('.pdf') ? 'application/pdf' : 'image/svg+xml';
    if (res.status() !== 200 || ct !== expectCt) { bad(`${a.url} is served as ${expectCt}`, `${res.status()} ${ct}`); continue; }
    if (a.url.endsWith('.pdf')) {
      const buf = fs.readFileSync(path.join(ROOT, a.url));
      let text = '';
      if (pdfjs) {
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
        for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map(x => x.str).join(' ') + ' ';
      }
      const labelled = /Cascade Commons — Demonstration Document — Fictional/.test(text.replace(/\s+/g, ' '));
      yes(/ToUnicode/.test(buf.toString('latin1')) && labelled, `${path.basename(a.url)} — text-layer PDF headed "Cascade Commons — Demonstration Document — Fictional"`,
          pdfjs ? `text: ${text.slice(0, 120)}` : 'pdfjs-dist missing');
    } else {
      const svg = fs.readFileSync(path.join(ROOT, a.url), 'utf8');
      yes(/not a photograph/i.test(svg) && /Demonstration/i.test(svg), `${path.basename(a.url)} — the illustration says on its face it is a demonstration, not a photograph`);
    }
  }

  // ══ 7 · the property image is a demonstration illustration ═════════════════
  sec('7 · the header image is unmistakably a demo illustration');
  await page.evaluate(() => { PropertyCabinetView.closeDrawer(); const f = document.querySelector('#propertyOsBody .pcv-hero'); if (f) f.scrollIntoView(); });
  const imgLoaded = await page.waitForFunction(() => { const i = document.querySelector('#propertyOsBody .pcv-hero img'); return !!(i && i.complete && i.naturalWidth > 0); }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  const img = await page.evaluate((loaded) => {
    const fig = document.querySelector('#propertyOsBody .pcv-hero');
    const i = fig && fig.querySelector('img');
    return fig ? { src: i.getAttribute('src'), alt: i.getAttribute('alt'), caption: (fig.querySelector('figcaption') || {}).textContent || '',
                   w: i.naturalWidth, loaded } : null;
  }, imgLoaded);
  yes(img && img.src === 'assets/demo/cascade-commons-rendering.svg', 'the demo header shows the Cascade Commons rendering from property.info', JSON.stringify(img));
  yes(img && /not a photograph/i.test(img.caption) && /demonstration/i.test(img.caption) && /fictional/i.test(img.caption), 'its caption says: demonstration illustration of a fictional property, not a photograph', img && img.caption);
  yes(img && img.loaded, 'and the image actually loads');
  const svg = fs.readFileSync(path.join(ROOT, 'assets/demo/cascade-commons-rendering.svg'), 'utf8');
  yes(/not a photograph/i.test(svg) && /fictional/i.test(svg), 'the rendering itself carries the "fictional property, not a photograph" label');
  const realImg = await page.evaluate(() => {
    const real = { id: 'p-real-showroom', name: 'Real Plaza', totalSqft: 9000, tenants: [], invoices: [], timeline: [], disputes: [], activityLog: [],
                   info: { address: '1 Real Street' } };
    _props.push(real); const prev = activePropId; activePropId = real.id;
    PropertyOS.renderPropertyPage(real);
    const has = !!document.querySelector('#propertyOsBody .pcv-hero');
    const name = (document.querySelector('#propertyOsBody .pcv-name') || {}).textContent;
    const info = PropertyReference.infoFor(real);
    _props.pop(); activePropId = prev; PropertyOS.renderPropertyPage(currentProperty());
    return { has, name, imageUrl: info && info.imageUrl };
  });
  is(realImg, { has: false, name: 'Real Plaza', imageUrl: undefined }, 'a real property’s landing page gets no image invented for it');

  // ══ 8 · reference samples remain samples ═══════════════════════════════════
  sec('8 · the reference samples are still samples — boxed, tagged, uncounted');
  const samples = await page.evaluate(() => {
    PropertyCabinetView.openDrawer('building', { year: null, cat: 'all', system: null, recordId: null });
    const body = document.getElementById('propertyOsBody');
    const box = body.querySelector('details.pcv-samples');
    const sampleRows = box ? box.querySelectorAll('.pos-doc-sample').length : 0;
    const sampleNames = box ? Array.from(box.querySelectorAll('.pos-doc-n')).map(e => e.textContent.trim()) : [];
    const recTitles = Array.from(body.querySelectorAll('.pos-recs .pos-rec .pos-rec-t')).map(e => e.textContent.trim());
    const recCount = (Array.from(body.querySelectorAll('.pcv-sec-title')).find(e => /^Records/.test(e.textContent)) || {}).textContent || '';
    const idx = PropertyCabinet.buildIndex(currentProperty());
    return { hasBox: !!box, open: box && box.open, summary: box && box.querySelector('summary').textContent.replace(/\s+/g, ' ').trim(),
             sampleRows, overlap: sampleNames.filter(n => recTitles.includes(n)), recCount: recCount.replace(/\s+/g, ' ').trim(),
             indexBuilding: idx.drawers.building.count, samplesInRecords: body.querySelectorAll('.pos-recs .pos-doc-sample').length,
             boxAfterRecords: box && box.compareDocumentPosition(body.querySelector('.pos-recs')) & Node.DOCUMENT_POSITION_PRECEDING };
  });
  yes(samples.hasBox && !samples.open, 'the samples box is present and closed');
  yes(/Reference samples/.test(samples.summary) && /not records on this property/.test(samples.summary), 'headed "Reference samples … not records on this property"', samples.summary);
  is(samples.sampleRows, 10, 'the ten samples are all tagged as samples');
  is(samples.overlap, [], 'no sample name is also a record title — nothing was converted');
  is(samples.recCount, 'Records 17', 'the Records count is the 17 filed records');
  is(samples.indexBuilding, 17, '…which is the index’s own count; samples are not in it');
  is(samples.samplesInRecords, 0, 'no sample row sits inside the records list');
  yes(!!samples.boxAfterRecords, 'the box comes after the records');

  // ══ 9 · quiet page ═════════════════════════════════════════════════════════
  sec('9 · no page errors');
  is(errs, [], 'no uncaught errors while walking the showroom');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
