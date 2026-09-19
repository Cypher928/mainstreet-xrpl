// test-e2e-legacy-snapshot-integrity.js
// ============================================================================
// THREE GENERATIONS OF SAVED RECONCILIATION, ONE QUESTION EACH:
// is this still about the data the property holds now?
//
// c4842db made a run record the inputs it consumed, so a reload could tell a
// still-valid reconciliation from one edited underneath. It only helped runs
// made AFTER it shipped. Measured on a snapshot with that fingerprint removed —
// which is every reconciliation in the pilot on the day it deploys — a lease
// corrected from 4,200 to 5,200 sqft, saved, reloaded, exported:
//
//     cam-reconciliation-Fernhill Court-2025.csv
//     "Cedar Park Dental","","4200","16.15","No","","19021.16",...
//
// superseded area, share and amount, silently, in a file.
//
//   A  CURRENT         the run stamped its own fingerprint.
//   B  RECONSTRUCTIBLE no fingerprint, but the snapshot still carries the
//                      inputs it consumed (`tenants` + `engineInvoices`), so one
//                      is rebuilt from those and compared.
//   C  UNRECONSTRUCTIBLE neither. It cannot account for itself, so it is not
//                      presented as current — unknown is not valid.
//
// And the seeded demo, which was generation C until it was stamped: it is a real
// reconciliation of the tenants and invoices seeded beside it, so it can say
// what it was based on, and it must pass the same check rather than be exempt.
//
// THE FIXTURE SEPARATES THE GROSS INVOICE TOTAL FROM THE RECOVERABLE POOL.
// One invoice is marked not CAM-eligible, so 114,500 invoiced is an 88,400 pool.
// A mutant reading the wrong one of those survived an earlier suite where every
// invoice was eligible and the two numbers coincided.
//
// Export assertions capture _downloadFile: the question is whether a file is
// produced, not whether a message appeared.
//
// Run: node test-e2e-legacy-snapshot-integrity.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8952;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');

const DB = `
(function(){
  var U={id:'legacy-tester',email:'pm@example.com'};
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

const PROP_ID = 'fernhill-legacy';
const POOL = 88400, GROSS = 114500;

const TRY = `(async () => {
  const T = e => e ? (e.innerText||'').replace(/\\s+/g,' ').trim() : null;
  const clear = () => document.querySelectorAll('div[style*="99999"]').forEach(e => e.remove());
  const toasts = () => [...document.body.children]
    .filter(e => e.tagName === 'DIV' && e.style && e.style.zIndex === '99999')
    .map(e => (e.innerText||'').replace(/\\s+/g,' ').trim());
  const files = [];
  const orig = window._downloadFile;
  window._downloadFile = (c, f) => files.push({ filename: f, rows: String(c).split('\\n').slice(1, 3) });
  clear();
  try { exportReconciliationCSV(); } catch (_) {}
  await new Promise(r => setTimeout(r, 1300));
  const csv = toasts(); clear();
  try { generateTenantStatement('Bright Leaf Grocers'); } catch (_) {}
  await new Promise(r => setTimeout(r, 1700));
  const stmt = toasts(); clear();
  window._downloadFile = orig;
  const banner = document.getElementById('staleResultsBanner');
  return {
    stale: _resultsStale,
    unverified: (typeof _resultsUnverified !== 'undefined' ? _resultsUnverified : null),
    bannerVisible: !!(banner && banner.offsetParent !== null),
    bannerText: T(banner),
    csvToasts: csv, statementToasts: stmt, files,
  };
})()`;

const STALE_RE = /stale|changed since last run|cannot be checked|re-?run/i;

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

  const enter = async () => {
    await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
    await p.waitForTimeout(1500);
  };
  const reopen = async (id) => {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await enter();
    await p.evaluate(async (pid) => {
      await selectProperty(pid);
      await new Promise(r => setTimeout(r, 2800));
      window.switchWorkspaceTab('cam');
      await new Promise(r => setTimeout(r, 1500));
    }, id);
  };
  const run = async () => await p.evaluate(async () => {
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1000));
    await window.runAllocation();
    await new Promise(r => setTimeout(r, 3400));
    return { cards: document.querySelectorAll('#resultsBody .result-card').length, pool: lastCamPool };
  });
  const save = async () => { await p.evaluate(async () => {
    await savePropertyData(); await saveProperty(currentProperty());
    await new Promise(r => setTimeout(r, 1000)); }); };
  // Rewrite the stored snapshot to look like an older generation.
  const age = async (id, mode) => await p.evaluate(async (a) => {
    const pr = _props.find(x => x.id === a.id);
    delete pr.camReconciliation.inputsFingerprint;
    if (a.mode === 'unreconstructible') delete pr.camReconciliation.engineInvoices;
    await saveProperty(pr);
    await new Promise(r => setTimeout(r, 1000));
    let row = null;
    try {
      const db = JSON.parse(localStorage.getItem('__mockdb') || '{}');
      row = (db.properties || []).find(r => r.id === a.id);
    } catch (_) {}
    const rec = row && row.data ? row.data.camReconciliation : null;
    return { storedFingerprint: !!(rec && rec.inputsFingerprint),
             storedTenants: rec && rec.tenants ? rec.tenants.length : 0,
             storedEngineInvoices: rec && rec.engineInvoices ? rec.engineInvoices.length : 0 };
  }, { id, mode });

  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  await enter();

  sec('setup · a property whose recoverable pool differs from its invoiced total');
  await p.evaluate(async (propId) => {
    const prop = {
      id: propId, name: 'Fernhill Court', totalSqft: 26000, status: 'in-progress',
      tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
      createdAt: new Date().toISOString(),
      tenants: [
        { tenant_name: 'Cedar Park Dental',   leased_sqft: 4200, start_date: '2020-01-01',
          end_date: '2030-12-31', lease_type: 'NNN', cap: null, id: 'l-t1', flags: [], confidence: {} },
        { tenant_name: 'Bright Leaf Grocers', leased_sqft: 9100, start_date: '2020-01-01',
          end_date: '2030-12-31', lease_type: 'NNN', cap: null, id: 'l-t2', flags: [], confidence: {} },
      ],
      invoices: [
        { id: 'g1', vendorName: 'Northside Landscaping', category: 'landscaping', amount: 70000, invoiceDate: '2025-04-12' },
        { id: 'g2', vendorName: 'Talon Security',        category: 'security',    amount: 18400, invoiceDate: '2025-05-03' },
        // not recoverable: keeps the pool (88,400) apart from the gross (114,500)
        { id: 'g3', vendorName: 'Pacific Facilities',    category: 'janitorial',  amount: 26100, invoiceDate: '2025-06-21', camEligible: false },
      ],
      disputes: [], activityLog: [], timeline: [],
    };
    _props.push(prop);
    await saveProperty(prop);
    await selectProperty(propId);
    await new Promise(r => setTimeout(r, 2600));
    setCamYear('2025');
  }, PROP_ID);
  await p.waitForTimeout(1500);
  const first = await run();
  (first.cards === 2) ? ok('two tenants reconciled') : bad('setup failed', JSON.stringify(first));
  (first.pool === POOL)
    ? ok(`the recoverable pool is ${POOL}, apart from the ${GROSS} invoiced`)
    : bad('the fixture cannot tell the pool from the gross total', String(first.pool));
  await save();

  // ══ A · CURRENT ══════════════════════════════════════════════════════════
  sec('A · a snapshot that stamped its own fingerprint');
  await reopen(PROP_ID);
  let s = await p.evaluate(TRY);
  (s.stale === false && s.unverified === false && s.files.length === 1)
    ? ok('A: valid after reload, and exportable')
    : bad('A: a current snapshot was not treated as valid', JSON.stringify(s));
  await p.evaluate(async () => {
    window.switchWorkspaceTab('spaces');
    await new Promise(r => setTimeout(r, 1100));
    const i = tenantData.findIndex(x => x && x.tenant_name === 'Cedar Park Dental');
    handleFieldBlur(i, 'leased_sqft', '5200');
    await new Promise(r => setTimeout(r, 1100));
  });
  await save(); await reopen(PROP_ID);
  s = await p.evaluate(TRY);
  (s.stale === true && s.files.length === 0)
    ? ok('A: an input change makes it stale after reload, and the export is blocked')
    : bad('A: the input change was not caught', JSON.stringify(s));
  await run(); await save();
  s = await p.evaluate(TRY);
  (s.stale === false && s.files.length === 1)
    ? ok('A: re-running makes it valid and exportable again')
    : bad('A: the re-run did not restore validity', JSON.stringify(s));

  // ══ B · LEGACY BUT RECONSTRUCTIBLE ═══════════════════════════════════════
  sec('B · no fingerprint, but the snapshot still carries its inputs');
  let aged = await age(PROP_ID, 'reconstructible');
  (aged.storedFingerprint === false && aged.storedTenants === 2 && aged.storedEngineInvoices === 3)
    ? ok(`B: the stored snapshot has no fingerprint but keeps ${aged.storedTenants} tenants and ${aged.storedEngineInvoices} engine invoices`)
    : bad('B: the fixture is not the generation it claims', JSON.stringify(aged));
  await reopen(PROP_ID);
  s = await p.evaluate(TRY);
  (s.stale === false && s.unverified === false && s.files.length === 1)
    ? ok('B: with inputs unchanged it reconstructs as VALID, and exports')
    : bad('B: a reconstructible snapshot was not judged valid', JSON.stringify(s));

  const legacyChange = async (label, mutate, expectPool) => {
    await p.evaluate(mutate);
    await save();
    await age(PROP_ID, 'reconstructible');   // the edit re-saved; age it again
    await reopen(PROP_ID);
    const r = await p.evaluate(TRY);
    (r.stale === true && r.files.length === 0)
      ? ok(`B: ${label} → stale, export blocked`)
      : bad(`B: ${label} was not detected`, JSON.stringify(r));
    r.statementToasts.some(t => STALE_RE.test(t))
      ? ok(`B: ${label} → the tenant statement refuses too`)
      : bad(`B: ${label} did not block the statement`, JSON.stringify(r.statementToasts));
    // put it back and re-run so the next case starts clean
    await run(); await save();
    if (expectPool != null) {
      const pool = await p.evaluate(() => lastCamPool);
      (pool === expectPool) ? ok(`B: after re-running, the pool is ${expectPool}`)
        : bad(`B: pool wrong after re-run`, String(pool));
    }
  };

  await legacyChange('a leased-sqft change', async () => {
    window.switchWorkspaceTab('spaces');
    await new Promise(r => setTimeout(r, 1100));
    const i = tenantData.findIndex(x => x && x.tenant_name === 'Bright Leaf Grocers');
    handleFieldBlur(i, 'leased_sqft', '9500');
    await new Promise(r => setTimeout(r, 1100));
  }, 88400);

  await legacyChange('an invoice amount change', async () => {
    const inv = invoiceData.find(i => i && i.vendorName === 'Talon Security');
    inv.amount = 9000;
    (currentProperty().invoices.find(i => i.vendorName === 'Talon Security') || {}).amount = 9000;
    if (typeof renderInvResults === 'function') renderInvResults();
    await new Promise(r => setTimeout(r, 900));
  }, 79000);

  await legacyChange('an invoice category change', async () => {
    const inv = invoiceData.find(i => i && i.vendorName === 'Talon Security');
    inv.category = 'utilities';
    (currentProperty().invoices.find(i => i.vendorName === 'Talon Security') || {}).category = 'utilities';
    if (typeof renderInvResults === 'function') renderInvResults();
    await new Promise(r => setTimeout(r, 900));
  }, 79000);

  await legacyChange('an invoice CAM-eligibility change', async () => {
    const inv = invoiceData.find(i => i && i.vendorName === 'Pacific Facilities');
    inv.camEligible = true;      // was excluded from the recoverable pool
    (currentProperty().invoices.find(i => i.vendorName === 'Pacific Facilities') || {}).camEligible = true;
    if (typeof renderInvResults === 'function') renderInvResults();
    await new Promise(r => setTimeout(r, 900));
  }, 105100);

  // ══ C · LEGACY AND UNRECONSTRUCTIBLE ═════════════════════════════════════
  sec('C · no fingerprint and no inputs — it cannot account for itself');
  aged = await age(PROP_ID, 'unreconstructible');
  (aged.storedFingerprint === false && aged.storedEngineInvoices === 0)
    ? ok('C: the stored snapshot has neither a fingerprint nor engine invoices')
    : bad('C: the fixture is not the generation it claims', JSON.stringify(aged));
  await reopen(PROP_ID);
  s = await p.evaluate(TRY);
  (s.stale === true)
    ? ok('C: it is NOT treated as valid')
    : bad('C: an unverifiable snapshot was presented as current', JSON.stringify(s));
  (s.unverified === true)
    ? ok('C: and it is marked unverifiable rather than edited')
    : bad('C: the unknown case was conflated with an edit', JSON.stringify(s));
  s.bannerVisible && /cannot be checked/i.test(s.bannerText || '')
    ? ok(`C: the banner says why — "${(s.bannerText || '').slice(0, 80)}…"`)
    : bad('C: the banner does not state the real reason', JSON.stringify(s.bannerText));
  (s.files.length === 0)
    ? ok('C: CSV export is blocked — no file')
    : bad('C: an unverifiable snapshot exported', JSON.stringify(s.files));
  s.statementToasts.some(t => STALE_RE.test(t))
    ? ok('C: tenant statement generation is blocked')
    : bad('C: the statement was allowed', JSON.stringify(s.statementToasts));
  const cRun = await run(); await save();
  s = await p.evaluate(TRY);
  (cRun.cards === 2 && s.stale === false && s.unverified === false && s.files.length === 1)
    ? ok('C: a fresh reconciliation is what makes it exportable again')
    : bad('C: re-running did not clear the unverifiable state',
          JSON.stringify({ cRun, stale: s.stale, files: s.files.length }));

  // ══ THE SEEDED DEMO ══════════════════════════════════════════════════════
  sec('DEMO · seeded data must pass the same check, not be exempt from it');
  const demo = await p.evaluate(async () => {
    try { await loadDemo(); } catch (e) { return { error: String(e && e.message) }; }
    await new Promise(r => setTimeout(r, 7000));
    const d = (_props || []).find(x => /Cascade/i.test(x.name || ''));
    if (!d) return { error: 'demo property not found' };
    await selectProperty(d.id);
    await new Promise(r => setTimeout(r, 2800));
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1600));
    return { id: d.id, name: d.name,
             hasFingerprint: !!(d.camReconciliation && d.camReconciliation.inputsFingerprint),
             cards: document.querySelectorAll('#resultsBody .result-card').length };
  });
  (!demo.error) ? ok(`the demo opens (${demo.name})`) : bad('the demo did not open', String(demo.error));
  demo.hasFingerprint
    ? ok('the seeded reconciliation carries a fingerprint of its own inputs')
    : bad('the demo seed was not stamped', JSON.stringify(demo));
  (demo.cards > 0) ? ok(`its reconciliation is on screen (${demo.cards} tenants)`)
                   : bad('the demo reconciliation did not render', JSON.stringify(demo));
  s = await p.evaluate(TRY);
  (s.stale === false && s.unverified === false)
    ? ok('the demo is NOT marked stale merely for being seeded')
    : bad('the demo opens with an unnecessary stale warning', JSON.stringify(s));
  (s.files.length === 1)
    ? ok('and its reconciliation remains usable — the export works')
    : bad('the demo could not export', JSON.stringify({ toasts: s.csvToasts }));
  const demoEdited = await p.evaluate(async () => {
    window.switchWorkspaceTab('spaces');
    await new Promise(r => setTimeout(r, 1300));
    const i = tenantData.findIndex(x => x && x.tenant_name);
    const who = tenantData[i] && tenantData[i].tenant_name;
    const was = tenantData[i] && tenantData[i].leased_sqft;
    handleFieldBlur(i, 'leased_sqft', String((parseFloat(was) || 1000) + 350));
    await new Promise(r => setTimeout(r, 1200));
    return { who, was };
  });
  s = await p.evaluate(TRY);
  (s.stale === true && s.files.length === 0)
    ? ok(`changing ${demoEdited.who}'s area makes the demo stale and blocks its export`)
    : bad('the demo did not react to an input change', JSON.stringify(s));
  const demoRerun = await run();
  s = await p.evaluate(TRY);
  (demoRerun.cards > 0 && s.stale === false && s.files.length === 1)
    ? ok('re-running the demo restores a valid, exportable reconciliation')
    : bad('the demo could not be restored by a re-run', JSON.stringify({ demoRerun, s }));

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
