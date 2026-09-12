// test-e2e-stale-results-persistence.js
// ============================================================================
// A RELOAD MUST NOT TURN A SUPERSEDED RECONCILIATION BACK INTO A CURRENT ONE.
//
// exportReconciliationCSV and generateTenantStatement both refuse while
// `_resultsStale` is set. It is a module-level `let` initialised false, written
// by the edit paths and reset by a run — and restored by nothing. So the flag
// survived exactly as long as the tab did.
//
// Measured before the fix: reconcile 2025, correct Cedar Park Dental from 4,200
// to 5,200 sqft through the Spaces field, save, reload, export. In-session both
// actions refused with "Results may be stale — lease or invoice data changed
// since last run." After the reload, no banner, no message, and out came
//
//     cam-reconciliation-Fernhill Court-2025.csv
//     "Cedar Park Dental","","4200","16.15","No","","19021.16",...
//
// — the superseded area, share and dollar amount, in a file, silently.
//
// WHAT IS PERSISTED IS NOT THE FLAG. Persisting a boolean records that someone
// edited something, not whether the edit still matters: a manager who typed a
// wrong number and typed it back would stay blocked for ever. The snapshot
// stores a fingerprint of the INPUTS the allocation consumed, and the restore
// recomputes it from the data as it stands and compares. One function, both
// sides — see camInputsFingerprint.
//
// So this file asserts the INVARIANT, not the flag: after a reload, is the saved
// reconciliation still about the current data? Five states are covered —
// stale before reload, stale after reload, valid after reload, stale → rerun →
// valid, and stale → correction reverted → valid — for both a lease-field edit
// and an invoice change.
//
// The export assertions capture _downloadFile rather than watching for a toast.
// "No warning appeared" would pass just as well against a product that exported
// silently; what matters is whether a file is produced and what is in it.
//
// Run: node test-e2e-stale-results-persistence.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8951;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');

const DB = `
(function(){
  var U={id:'stale-tester',email:'pm@example.com'};
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

const PROP_ID = 'fernhill-court-stale';

// Both protected actions, plus whatever file would have reached the manager.
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
  await new Promise(r => setTimeout(r, 1400));
  const csv = toasts(); clear();
  try { generateTenantStatement('Bright Leaf Grocers'); } catch (_) {}
  await new Promise(r => setTimeout(r, 1800));
  const stmt = toasts(); clear();
  window._downloadFile = orig;
  const banner = document.getElementById('staleResultsBanner');
  return {
    resultsStale:  (typeof _resultsStale !== 'undefined' ? _resultsStale : null),
    bannerVisible: !!(banner && banner.offsetParent !== null),
    bannerText:    T(banner),
    csvToasts: csv, statementToasts: stmt, files,
  };
})()`;

const STALE_RE = /stale|changed since last run|re-?run/i;

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
  const reloadAndOpen = async () => {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await enter();
    await p.evaluate(async (id) => {
      await selectProperty(id);
      await new Promise(r => setTimeout(r, 2800));
      window.switchWorkspaceTab('cam');
      await new Promise(r => setTimeout(r, 1500));
    }, PROP_ID);
  };
  const run = async () => await p.evaluate(async () => {
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1000));
    await window.runAllocation();
    await new Promise(r => setTimeout(r, 3500));
    return { cards: document.querySelectorAll('#resultsBody .result-card').length };
  });
  const save = async () => { await p.evaluate(async () => {
    await savePropertyData(); await saveProperty(currentProperty());
    await new Promise(r => setTimeout(r, 1000)); }); };

  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  await enter();

  sec('setup · a 2025 reconciliation on real data');
  await p.evaluate(async (propId) => {
    const prop = {
      id: propId, name: 'Fernhill Court', totalSqft: 26000, status: 'in-progress',
      tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
      createdAt: new Date().toISOString(),
      tenants: [
        { tenant_name: 'Cedar Park Dental',   leased_sqft: 4200, start_date: '2020-01-01',
          end_date: '2030-12-31', lease_type: 'NNN', cap: null, id: 's-t1', flags: [], confidence: {} },
        { tenant_name: 'Bright Leaf Grocers', leased_sqft: 9100, start_date: '2020-01-01',
          end_date: '2030-12-31', lease_type: 'NNN', cap: null, id: 's-t2', flags: [], confidence: {} },
      ],
      invoices: [
        { id: 'v1', vendorName: 'Northside Landscaping', category: 'landscaping', amount: 18400, invoiceDate: '2025-04-12' },
        { id: 'v2', vendorName: 'Talon Security',        category: 'security',    amount: 26100, invoiceDate: '2025-05-03' },
        { id: 'v3', vendorName: 'Pacific Facilities',    category: 'janitorial',  amount: 31250, invoiceDate: '2025-06-21' },
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
  (first.cards === 2) ? ok('two tenants reconciled for 2025')
                      : bad('setup did not reconcile', JSON.stringify(first));
  await save();

  // ── valid after reload ────────────────────────────────────────────────────
  sec('VALID AFTER RELOAD · nothing was edited, so the results still stand');
  await reloadAndOpen();
  const validAfter = await p.evaluate(TRY);
  (validAfter.resultsStale === false)
    ? ok('the restored reconciliation is judged current')
    : bad('an untouched reconciliation was judged stale', JSON.stringify(validAfter));
  !validAfter.bannerVisible ? ok('no stale banner is shown')
    : bad('a stale banner appeared on valid results', String(validAfter.bannerText));
  (validAfter.files.length === 1)
    ? ok(`the export is allowed (${validAfter.files[0].filename})`)
    : bad('a valid reconciliation could not be exported', JSON.stringify(validAfter));
  !validAfter.statementToasts.some(t => STALE_RE.test(t))
    ? ok('the tenant statement is not refused for staleness')
    : bad('a valid reconciliation was refused', JSON.stringify(validAfter.statementToasts));

  // ── a lease-field edit ────────────────────────────────────────────────────
  sec('STALE BEFORE RELOAD · correct a tenant’s sqft through the Spaces field');
  const edited = await p.evaluate(async () => {
    window.switchWorkspaceTab('spaces');
    await new Promise(r => setTimeout(r, 1200));
    const idx = tenantData.findIndex(x => x && x.tenant_name === 'Cedar Park Dental');
    handleFieldBlur(idx, 'leased_sqft', '5200');   // the real onblur, script.js:3717
    await new Promise(r => setTimeout(r, 1200));
    return { stale: _resultsStale,
             stored: (currentProperty().tenants.find(t => t.tenant_name === 'Cedar Park Dental')||{}).leased_sqft };
  });
  (edited.stale === true && String(edited.stored) === '5200')
    ? ok('the edit is stored and the results are marked stale in-session')
    : bad('the in-session edit path did not behave as expected', JSON.stringify(edited));
  const staleBefore = await p.evaluate(TRY);
  (staleBefore.files.length === 0)
    ? ok('in-session: no file is produced')
    : bad('in-session: superseded figures exported', JSON.stringify(staleBefore.files));
  staleBefore.csvToasts.some(t => STALE_RE.test(t))
    ? ok('in-session: the export says why')
    : bad('in-session: the export gave no reason', JSON.stringify(staleBefore.csvToasts));

  sec('STALE AFTER RELOAD · the same state, reloaded');
  await save();
  await reloadAndOpen();
  const staleAfter = await p.evaluate(TRY);
  (staleAfter.resultsStale === true)
    ? ok('the restored reconciliation is judged stale against the edited data — THE FIX')
    : bad('after the reload the superseded run was judged current',
          JSON.stringify({ stale: staleAfter.resultsStale, files: staleAfter.files }));
  staleAfter.bannerVisible
    ? ok(`the stale banner is visible: "${staleAfter.bannerText}"`)
    : bad('no stale banner after the reload', JSON.stringify(staleAfter));
  (staleAfter.files.length === 0)
    ? ok('NO file is produced — the superseded CSV cannot escape')
    : bad('after the reload the superseded figures exported',
          JSON.stringify(staleAfter.files) + ' toasts=' + JSON.stringify(staleAfter.csvToasts));
  staleAfter.csvToasts.some(t => STALE_RE.test(t))
    ? ok('the export refuses with the existing wrong-data message')
    : bad('the export refused without saying why', JSON.stringify(staleAfter.csvToasts));
  staleAfter.statementToasts.some(t => STALE_RE.test(t))
    ? ok('the tenant statement refuses too')
    : bad('the statement did not refuse after the reload', JSON.stringify(staleAfter.statementToasts));

  // ── stale → rerun → valid ─────────────────────────────────────────────────
  sec('STALE → RERUN → VALID · reconciling the corrected data clears it');
  const rerun = await run();
  (rerun.cards === 2) ? ok('the re-run reconciles the corrected data')
                      : bad('the re-run produced no results', JSON.stringify(rerun));
  const afterRerun = await p.evaluate(TRY);
  (afterRerun.resultsStale === false && !afterRerun.bannerVisible)
    ? ok('the results are current again and the banner is gone')
    : bad('the re-run did not clear the stale state', JSON.stringify(afterRerun));
  (afterRerun.files.length === 1 && /5200/.test(afterRerun.files[0].rows.join('|')))
    ? ok('the export is allowed and carries the corrected 5,200')
    : bad('the export after a re-run is wrong',
          JSON.stringify({ files: afterRerun.files, toasts: afterRerun.csvToasts }));
  await save();
  await reloadAndOpen();
  const rerunReloaded = await p.evaluate(TRY);
  (rerunReloaded.resultsStale === false && rerunReloaded.files.length === 1)
    ? ok('and it survives a reload as valid')
    : bad('the re-run result was judged stale after a reload', JSON.stringify(rerunReloaded));

  // ── stale → correction reverted → valid, without re-running ───────────────
  sec('STALE → EDIT REVERTED → VALID · putting the number back is not a change');
  const reverted = await p.evaluate(async () => {
    window.switchWorkspaceTab('spaces');
    await new Promise(r => setTimeout(r, 1200));
    const idx = tenantData.findIndex(x => x && x.tenant_name === 'Cedar Park Dental');
    handleFieldBlur(idx, 'leased_sqft', '9999');          // wrong number
    await new Promise(r => setTimeout(r, 900));
    const midway = _resultsStale;
    handleFieldBlur(idx, 'leased_sqft', '5200');          // typed back
    await new Promise(r => setTimeout(r, 900));
    return { midway, afterRevert: _resultsStale };
  });
  (reverted.midway === true) ? ok('the wrong number marks the results stale in-session')
    : bad('the mistyped value did not mark results stale', JSON.stringify(reverted));
  await save();
  await reloadAndOpen();
  const revertedReloaded = await p.evaluate(TRY);
  (revertedReloaded.resultsStale === false && revertedReloaded.files.length === 1)
    ? ok('after the reload the reverted data matches the run again — not blocked for ever')
    : bad('a reverted edit left the reconciliation permanently stale',
          JSON.stringify({ stale: revertedReloaded.resultsStale, files: revertedReloaded.files }));

  // ── an invoice change, not a lease change ─────────────────────────────────
  sec('INVOICE CHANGE · the same invariant holds for the expense side');
  await p.evaluate(async () => {
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1200));
    const inv = invoiceData.find(i => i && i.vendorName === 'Talon Security');
    inv.amount = 9999;
    const pr = currentProperty();
    (pr.invoices.find(i => i.vendorName === 'Talon Security') || {}).amount = 9999;
    if (typeof renderInvResults === 'function') renderInvResults();
    await saveProperty(pr);
    await new Promise(r => setTimeout(r, 1200));
  });
  await reloadAndOpen();
  const invoiceStale = await p.evaluate(TRY);
  (invoiceStale.resultsStale === true)
    ? ok('a changed invoice amount makes the saved run stale after a reload')
    : bad('an invoice change did not invalidate the saved run', JSON.stringify(invoiceStale));
  (invoiceStale.files.length === 0)
    ? ok('no file is produced from the pre-change pool')
    : bad('the pre-change figures exported', JSON.stringify(invoiceStale.files));
  const invoiceRerun = await run();
  const afterInvoiceRerun = await p.evaluate(TRY);
  (invoiceRerun.cards === 2 && afterInvoiceRerun.resultsStale === false &&
   afterInvoiceRerun.files.length === 1)
    ? ok('re-running against the new invoice restores a valid, exportable result')
    : bad('the invoice re-run did not clear the stale state',
          JSON.stringify({ invoiceRerun, afterInvoiceRerun }));

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
