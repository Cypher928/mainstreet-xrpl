// test-e2e-property-foundations.js
// ============================================================================
// PROPERTY WORKSPACE V2, PHASE 0 — the two persistence facts, proven in a browser.
//
//   1  property.info SURVIVES A SAVE AND A RELOAD. PropertyReference.infoFor()
//      has always read `property.info`; nothing ever wrote it to storage, so
//      Property Information was demo-only by omission. Now it travels through
//      the same four sites camRefusal does: the save payload, the load
//      projection, the merge, and the selectProperty assignment. Any one of
//      the four missing and the facts vanish on reload — so this asserts the
//      PERSISTED ROW as well as the reloaded object, and asserts a real
//      property never shows the demo's values in their place.
//
//   2  A VACANT SPACE STAYS VACANT. `vacant: true` on a tenants[] row is read
//      back through normalizeTenant's allow-list on every load. Without the
//      allow-list entry the flag is written and then dropped, and the vacancy
//      silently becomes a tenant called whatever the row was named.
//
// The mock Supabase is backed by localStorage, so the reload is a real reload
// against persisted state, not a re-render.
//
// Run: node test-e2e-property-foundations.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8960;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);

const DB = `
(function(){
  var U={id:'refusal-tester',email:'pm@example.com'};
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
      in:function(){return P({data:[],error:null});},
      single:function(){single=true;return run();},
      insert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        var made=arr.map(function(x){var c=Object.assign({},x);if(!c.id)c.id=uuid();rows.push(c);return c;});
        save(name,rows);var p=P({data:made,error:null});
        p.select=function(){var q2=P({data:made,error:null});q2.single=function(){return P({data:made[0],error:null});};return q2;};return p;},
      upsert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        arr.forEach(function(x){var i=rows.findIndex(function(y){return y.id===x.id;});if(i>=0)rows[i]=Object.assign({},rows[i],x);else rows.push(Object.assign({},x));});
        save(name,rows);var p=P({data:arr,error:null});
        p.select=function(){var q2=P({data:arr,error:null});q2.single=function(){return P({data:arr[0],error:null});};return q2;};return p;},
      update:function(){return P({data:null,error:null});},
      delete:function(){return {eq:function(){return P({error:null});}};},
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
const PROP_ID = 'p-foundations-1';
const INFO = {
  address: '77 Elm Street, Portland, OR 97204',
  yearBuilt: '1998',
  insuranceCarrier: 'Liberty Mutual',
  insurancePolicyNo: 'LM-4471',
  insuranceExpires: '2026-11-30',
  roofAge: 'TPO, installed 2016',
};

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  await p.addInitScript('window.__TEST_AUTHED=true;');
  await p.addInitScript(DB);
  await p.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.route('**/api/**',    r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);

  // ══ 0 · the module is on the page ═══════════════════════════════════════
  sec('0 · property-cabinet.js is loaded in the app');
  const loaded = await p.evaluate(() => ({
    present: typeof window.PropertyCabinet === 'object' && !!window.PropertyCabinet,
    drawers: window.PropertyCabinet ? window.PropertyCabinet.drawerKeys() : null,
  }));
  is(loaded.present, true, 'window.PropertyCabinet exists');
  is(loaded.drawers, ['taxes','insurance','invoices','financing','financials','agreements','building','dates','history'],
     'with the nine approved drawers, in order');

  // ══ 1 · a real property with facts and a vacancy, saved ═══════════════════
  sec('1 · save a real property carrying info and a vacant space');
  const saved = await p.evaluate(async ({ id, info }) => {
    const prop = { id, name: 'Elm Street Center', totalSqft: 12000,
      status: 'in-progress', tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
      createdAt: new Date().toISOString(),
      info,
      tenants: [
        { id: id + '-t1', tenant_name: 'Alder Dental', suite: '100', leased_sqft: 4000,
          start_date: '2021-01-01', end_date: '2027-01-31', lease_type: 'NNN', cap: null, flags: [], confidence: {} },
        { id: id + '-t2', tenant_name: 'Vacant', suite: '110', leased_sqft: 2500, vacant: true,
          flags: [], confidence: {} },
      ],
      invoices: [], disputes: [], activityLog: [], timeline: [] };
    _props.push(prop);
    await saveProperty(prop);
    await new Promise(r => setTimeout(r, 600));
    let row = null;
    try { row = (JSON.parse(localStorage.getItem('__mockdb') || '{}').properties || []).find(r => r.id === id) || null; } catch (_) {}
    return {
      hasRow: !!row,
      rowInfo: row && row.data ? (row.data.info || null) : null,
      rowVacantFlags: row && row.data && row.data.tenants ? row.data.tenants.map(t => t.vacant) : null,
      rowSuites: row && row.data && row.data.tenants ? row.data.tenants.map(t => t.suite) : null,
    };
  }, { id: PROP_ID, info: INFO });
  is(saved.hasRow, true, 'the property row was written');
  is(saved.rowInfo, INFO, 'the PERSISTED ROW carries info — the save payload includes it');
  is(saved.rowVacantFlags, [undefined, true], 'the persisted tenants carry vacant: true on the vacant row only');
  is(saved.rowSuites, ['100', '110'], 'and both suites');

  // ══ 2 · a real reload, then open the property ═════════════════════════════
  sec('2 · after a real browser reload, the facts and the vacancy are back');
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);
  const back = await p.evaluate(async (id) => {
    await selectProperty(id);
    await new Promise(r => setTimeout(r, 3000));
    const prop = currentProperty();
    const PR = window.PropertyReference, PC = window.PropertyCabinet;
    const shown = PR ? PR.infoFor(prop) : null;
    return {
      sameId: prop && prop.id === id,
      info: prop ? (prop.info || null) : null,
      infoForAddress: shown ? shown.address : null,
      isDemo: PR ? PR.isDemo(prop) : null,
      vacantFlags: (prop.tenants || []).map(t => t.vacant),
      suites: (prop.tenants || []).map(t => t.suite),
      spaces: PC ? PC.spaces(prop).map(s => s.status) : null,
      index: PC ? PC.buildIndex(prop).spaces : null,
      dates: PC ? PC.importantDates(prop, { now: '2026-10-01', horizonDays: 90 }).map(d => d.source.type + ':' + d.source.id) : null,
    };
  }, PROP_ID);
  is(back.sameId, true, 'the property opened');
  is(back.info, INFO, 'property.info is restored on the object');
  is(back.infoForAddress, INFO.address, 'and PropertyReference.infoFor() returns the REAL facts');
  is(back.isDemo, false, 'this is not the demo property');
  is(back.vacantFlags, [false, true], 'vacant: true survived the reload through normalizeTenant (false, not undefined, on the occupied row)');
  is(back.suites, ['100', '110'], 'suites survived beside it');
  is(back.spaces, ['occupied', 'vacant'], 'PropertyCabinet.spaces() reads one occupied and one vacant space');
  is(back.index, { total: 2, occupied: 1, vacant: 1 }, 'and the index counts them');
  is(back.dates, ['info:insuranceExpires'], 'Important Dates finds the insurance renewal from the persisted facts (the vacant row contributes nothing)');

  // ══ 3 · a property with no facts shows none, never the demo's ═════════════
  sec('3 · absence stays absent');
  const none = await p.evaluate(async () => {
    const prop = { id: 'p-foundations-2', name: 'Bare Lot', totalSqft: 5000,
      status: 'in-progress', tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
      createdAt: new Date().toISOString(), tenants: [], invoices: [], disputes: [], activityLog: [], timeline: [] };
    _props.push(prop);
    await saveProperty(prop);
    await new Promise(r => setTimeout(r, 500));
    await selectProperty('p-foundations-2');
    await new Promise(r => setTimeout(r, 2500));
    const cur = currentProperty();
    const PR = window.PropertyReference;
    const shown = PR ? PR.infoFor(cur) : undefined;
    let row = null;
    try { row = (JSON.parse(localStorage.getItem('__mockdb') || '{}').properties || []).find(r => r.id === 'p-foundations-2') || null; } catch (_) {}
    return { shown: shown === null ? 'null' : shown, rowInfo: row && row.data ? row.data.info : 'no-row' };
  });
  is(none.shown, 'null', 'a real property with no facts shows null — not the demo\'s Austin address');
  is(none.rowInfo, null, 'and its persisted row carries info: null, not a demo object');

  // ══ 4 · the merge, with localStorage as the base ══════════════════════════
  // loadPropertyData picks whichever side has MORE tenants as the merge base.
  // Sections 1–3 only ever exercise the branch where Supabase is that base, on
  // which `...base` already carries info and the explicit merge rule is never
  // consulted. Here a local snapshot wins the tenant count (an unsynced upload)
  // so the rule itself decides: Supabase's facts beat a stale local copy, and a
  // local-only copy survives when the server has none.
  sec('4 · the merge rule decides when localStorage is the base');
  const snapshotFor = (id, info, extraTenant) => ({
    id, name: 'Elm Street Center', totalSqft: 12000, status: 'in-progress',
    tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
    createdAt: '2026-01-01T00:00:00.000Z', info,
    tenants: [
      { id: id + '-t1', tenant_name: 'Alder Dental', suite: '100', leased_sqft: 4000,
        start_date: '2021-01-01', end_date: '2027-01-31', lease_type: 'NNN', cap: null, flags: [], confidence: {} },
      { id: id + '-t2', tenant_name: 'Vacant', suite: '110', leased_sqft: 2500, vacant: true, flags: [], confidence: {} },
      extraTenant,
    ],
    invoices: [], disputes: [], activityLog: [], timeline: [],
  });
  const UNSYNCED = { id: PROP_ID + '-t3', tenant_name: 'Unsynced Upload', suite: '120', leased_sqft: 800, flags: [], confidence: {} };

  // Each case is a real reload so the load path — not an in-session re-render
  // that keeps the live tenant array — is what populates the property.
  const reloadApp = async () => {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);
    await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
    await p.waitForTimeout(1500);
  };
  const openAndRead = (id) => p.evaluate(async (id) => {
    await selectProperty(id);
    await new Promise(r => setTimeout(r, 3000));
    const prop = currentProperty();
    return { tenants: (prop.tenants || []).map(t => t.suite), address: prop.info ? prop.info.address : null };
  }, id);

  // 4a · the server has facts; the local snapshot has stale ones and one more tenant.
  await p.evaluate((snapshot) => { _lsSave(snapshot); }, snapshotFor(PROP_ID, { address: 'STALE — 1 Old Road' }, UNSYNCED));
  await reloadApp();
  const stale = await openAndRead(PROP_ID);
  is(stale.tenants, ['100', '110', '120'], 'localStorage was the merge base — its unsynced tenant is present');
  is(stale.address, INFO.address, 'and Supabase’s facts still won: the stale local copy did not overwrite an edit made elsewhere');

  // 4b · the server has NO facts; the local snapshot is the only copy.
  await p.evaluate((snapshot) => {
    const s = JSON.parse(localStorage.getItem('__mockdb') || '{}');
    const row = (s.properties || []).find(r => r.id === snapshot.id);
    row.data.info = null;                               // the server never received the facts
    row.data.tenants = (row.data.tenants || []).filter(t => t.suite !== '120');
    localStorage.setItem('__mockdb', JSON.stringify(s));
    _lsSave(snapshot);
  }, snapshotFor(PROP_ID, { address: 'LOCAL ONLY — 9 New Way' }, UNSYNCED));
  await reloadApp();
  const local = await openAndRead(PROP_ID);
  is(local.tenants, ['100', '110', '120'], 'localStorage was the merge base again');
  is(local.address, 'LOCAL ONLY — 9 New Way', 'and the local-only facts survived — the server having none is not a reason to lose them');

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
