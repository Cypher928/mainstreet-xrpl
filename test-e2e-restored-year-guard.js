// test-e2e-restored-year-guard.js
// ============================================================================
// DO THE YEAR GUARDS SURVIVE A RELOAD?
//
// exportReconciliationCSV and generateTenantStatement both refuse when the
// results on screen are from a different CAM year than the one selected:
//
//     if (lastResultsYear && getCamYear() !== lastResultsYear) { ...refuse }
//
// `lastResultsYear` was written by runAllocation and by nothing else.
// restoreResultsDisplay restores every other `last*` global — results, propName,
// total, invoices, invoicesFull, tenants, the engine invoice records — and left
// this one null, so after a reload both guards read a falsy value and passed.
//
// Measured before the fix, same fixture as below. A 2025 reconciliation, saved,
// reloaded, year switched to 2024:
//
//     in-session   "⚠️ Results are from 2025 — re-run reconciliation for 2024
//                   before exporting."            ← refused, correctly
//     post-reload  (no message at all)            ← and the export ran:
//                  cam-reconciliation-Fernhill Court-2024.csv
//                  "Cedar Park Dental",...,"19021.16",...   ← 2025 rows
//
// A file named for one year containing another year's numbers, with no year
// written inside it, is the artefact that leaves the product and reaches an
// accountant or a tenant. That is what this file exists to prevent.
//
// WHY THE ASSERTIONS LOOK THE WAY THEY DO. The refusal is a toast that removes
// itself, and the export is a download the sandbox swallows, so both are
// captured directly: toasts by their shape (a fixed div at z-index 99999, they
// carry no class), and the download by standing in for _downloadFile so the
// FILENAME AND ROWS can be inspected. Asserting "no toast appeared" would pass
// just as well against a product that exported silently — the point is that no
// file is produced, not that a message is shown.
//
// Run: node test-e2e-restored-year-guard.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8949;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');

const DB = `
(function(){
  var U={id:'year-guard-tester',email:'pm@example.com'};
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

const PROP_ID = 'fernhill-court-year-guard';

// Try both protected actions at whatever year is currently selected, capturing
// the refusal toasts AND any file that would have reached the manager's disk.
const ATTEMPT = `(async (tenant) => {
  const T = e => e ? (e.innerText||'').replace(/\\s+/g,' ').trim() : null;
  const clearToasts = () => document.querySelectorAll('div[style*="99999"]').forEach(e => e.remove());
  const toasts = () => [...document.body.children]
    .filter(e => e.tagName === 'DIV' && e.style && e.style.zIndex === '99999')
    .map(e => (e.innerText||'').replace(/\\s+/g,' ').trim());

  const files = [];
  const origDownload = window._downloadFile;
  window._downloadFile = function (content, filename, mime) {
    files.push({ filename, mime, rows: String(content).split('\\n').slice(1, 3) });
  };

  clearToasts();
  let stmtToasts = [];
  try { generateTenantStatement(tenant); } catch (_) {}
  await new Promise(r => setTimeout(r, 1800));
  stmtToasts = toasts();

  clearToasts();
  let csvToasts = [];
  try { exportReconciliationCSV(); } catch (_) {}
  await new Promise(r => setTimeout(r, 1500));
  csvToasts = toasts();
  clearToasts();

  window._downloadFile = origDownload;
  return {
    camYearInForce:  getCamYear(),
    lastResultsYear: (typeof lastResultsYear !== 'undefined' ? lastResultsYear : null),
    resultsHeading:  T(document.getElementById('resultsTitle')),
    cards:           document.querySelectorAll('#resultsBody .result-card').length,
    statementToasts: stmtToasts,
    csvToasts:       csvToasts,
    filesProduced:   files,
  };
})`;

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

  const enterApp = async () => {
    await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
    await p.waitForTimeout(1500);
  };
  const reloadAndOpen = async () => {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await enterApp();
    await p.evaluate(async (id) => {
      await selectProperty(id);
      await new Promise(r => setTimeout(r, 2800));
      window.switchWorkspaceTab('cam');
      await new Promise(r => setTimeout(r, 1500));
    }, PROP_ID);
  };

  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  await enterApp();

  // ── 1-2: a real 2025 reconciliation, saved ────────────────────────────────
  sec('1-2 · a successful 2025 reconciliation, saved');
  await p.evaluate(async (propId) => {
    const prop = {
      id: propId, name: 'Fernhill Court', totalSqft: 26000,
      status: 'in-progress', tenantCount: 0, invoiceCount: 0, totalCAM: 0,
      openDisputes: 0, createdAt: new Date().toISOString(),
      tenants: [
        { tenant_name: 'Cedar Park Dental',   leased_sqft: 4200, start_date: '2020-03-01',
          end_date: '2030-02-28', lease_type: 'NNN', cap: null, id: 'tn-1', flags: [], confidence: {} },
        { tenant_name: 'Bright Leaf Grocers', leased_sqft: 9100, start_date: '2020-06-01',
          end_date: '2030-05-31', lease_type: 'NNN', cap: null, id: 'tn-2', flags: [], confidence: {} },
      ],
      invoices: [
        { id: 'a1', vendorName: 'Northside Landscaping', category: 'landscaping', amount: 18400, invoiceDate: '2025-04-12' },
        { id: 'a2', vendorName: 'Talon Security',        category: 'security',    amount: 26100, invoiceDate: '2025-05-03' },
        { id: 'a3', vendorName: 'Pacific Facilities',    category: 'janitorial',  amount: 31250, invoiceDate: '2025-06-21' },
        { id: 'a4', vendorName: 'Cascade Insurance',     category: 'insurance',   amount: 42000, invoiceDate: '2025-02-01' },
      ],
      disputes: [], activityLog: [], timeline: [],
    };
    _props.push(prop);
    await saveProperty(prop);
    await selectProperty(propId);
  }, PROP_ID);
  await p.waitForTimeout(3000);
  const ran = await p.evaluate(async (propId) => {
    setCamYear('2025');
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1200));
    await window.runAllocation();
    await new Promise(r => setTimeout(r, 3500));
    const pr = _props.find(x => x.id === propId) || {};
    return { cards: document.querySelectorAll('#resultsBody .result-card').length,
             lastResultsYear, snapshotYear: (pr.camReconciliation || {}).camYear,
             allocated: lastResults.reduce((s, r) => s + (Number(r.totalAllocated) || 0), 0) };
  }, PROP_ID);
  (ran.cards === 2) ? ok('2025 reconciles — two tenants on screen')
    : bad('the 2025 run did not produce results', String(ran.cards));
  (ran.lastResultsYear === 2025) ? ok('the run records lastResultsYear = 2025')
    : bad('the run did not stamp the year', String(ran.lastResultsYear));
  (ran.snapshotYear === 2025) ? ok('the saved snapshot carries camYear = 2025')
    : bad('the snapshot has the wrong year', String(ran.snapshotYear));

  // ── 3-5: reload, and the restored snapshot keeps its year ─────────────────
  sec('3-5 · after a real browser reload, the restored results know their year');
  await reloadAndOpen();
  const restored = await p.evaluate((propId) => {
    const pr = _props.find(x => x.id === propId) || {};
    return { snapshotYear: (pr.camReconciliation || {}).camYear,
             lastResultsYear: (typeof lastResultsYear !== 'undefined' ? lastResultsYear : null),
             camYearInForce: getCamYear(),
             cards: document.querySelectorAll('#resultsBody .result-card').length };
  }, PROP_ID);
  (restored.snapshotYear === 2025) ? ok('the restored snapshot still has camYear = 2025')
    : bad('the snapshot lost its year across the reload', String(restored.snapshotYear));
  (restored.lastResultsYear === 2025) ? ok('lastResultsYear is restored as 2025 — THE FIX')
    : bad('lastResultsYear was not restored; both guards are disarmed',
          String(restored.lastResultsYear));
  (restored.camYearInForce === 2025) ? ok('the year in force follows the snapshot')
    : bad('the year in force does not match the snapshot', String(restored.camYearInForce));
  (restored.cards === 2) ? ok('the 2025 results are on screen')
    : bad('the reconciliation did not restore', String(restored.cards));

  // ── 6-9: the wrong year, immediately after that reload ────────────────────
  sec('6-9 · select 2024 on restored 2025 results — both actions must refuse');
  const wrong = await p.evaluate(async (args) => {
    setCamYear('2024');
    await new Promise(r => setTimeout(r, 1000));
    return await eval(args.fn)(args.tenant);
  }, { fn: ATTEMPT, tenant: 'Cedar Park Dental' });
  (wrong.lastResultsYear === 2025 && wrong.camYearInForce === 2024)
    ? ok('the mismatch is real: results from 2025, year selected 2024')
    : bad('the fixture is not in the mismatched state', JSON.stringify(wrong));
  wrong.statementToasts.some(t => /Results are from 2025 — re-run the reconciliation for 2024/.test(t))
    ? ok('the tenant statement refuses with the existing wrong-year message')
    : bad('the statement did not refuse', JSON.stringify(wrong.statementToasts));
  wrong.csvToasts.some(t => /Results are from 2025 — re-run reconciliation for 2024/.test(t))
    ? ok('the CSV export refuses with the existing wrong-year message')
    : bad('the export did not refuse', JSON.stringify(wrong.csvToasts));
  // The one that matters: not "was a warning shown" but "did a file get made".
  (wrong.filesProduced.length === 0)
    ? ok('NO file is produced — the mis-named 2024 export cannot happen')
    : bad('a file was produced from wrong-year results',
          JSON.stringify(wrong.filesProduced));
  !wrong.filesProduced.some(f => /-2024\.csv$/.test(f.filename))
    ? ok('specifically, no cam-reconciliation-…-2024.csv carrying 2025 rows')
    : bad('the exact defect artefact was produced',
          JSON.stringify(wrong.filesProduced.map(f => f.filename)));

  // ── 10-11: back to the snapshot's year — both must be allowed ─────────────
  sec('10-11 · back to 2025 — both actions are allowed, on the 2025 results');
  const right = await p.evaluate(async (args) => {
    setCamYear('2025');
    await new Promise(r => setTimeout(r, 1000));
    return await eval(args.fn)(args.tenant);
  }, { fn: ATTEMPT, tenant: 'Cedar Park Dental' });
  !right.csvToasts.some(t => /Results are from/.test(t))
    ? ok('the export is no longer refused on the year')
    : bad('the correct year is still being refused', JSON.stringify(right.csvToasts));
  (right.filesProduced.length === 1 && /-2025\.csv$/.test(right.filesProduced[0].filename))
    ? ok(`a 2025 file is produced (${right.filesProduced[0].filename})`)
    : bad('the correct-year export did not produce a 2025 file',
          JSON.stringify(right.filesProduced.map(f => f.filename)));
  // and it carries the restored 2025 figures, not something recomputed
  (right.filesProduced[0] && /19021\.16/.test(right.filesProduced[0].rows.join('|')) &&
   /41212\.50/.test(right.filesProduced[0].rows.join('|')))
    ? ok('the exported rows are the restored 2025 allocations')
    : bad('the export does not carry the restored figures',
          JSON.stringify(right.filesProduced[0] && right.filesProduced[0].rows));
  !right.statementToasts.some(t => /Results are from/.test(t))
    ? ok('the tenant statement is no longer refused on the year')
    : bad('the statement is still refused at the matching year', JSON.stringify(right.statementToasts));

  // ── 12: prove it survives persistence, not just this session ──────────────
  sec('12 · a second real reload — the guard is still armed');
  await reloadAndOpen();
  const again = await p.evaluate(async (args) => {
    const before = (typeof lastResultsYear !== 'undefined' ? lastResultsYear : null);
    setCamYear('2024');
    await new Promise(r => setTimeout(r, 1000));
    const r = await eval(args.fn)(args.tenant);
    r.lastResultsYearOnLoad = before;
    return r;
  }, { fn: ATTEMPT, tenant: 'Cedar Park Dental' });
  (again.lastResultsYearOnLoad === 2025)
    ? ok('lastResultsYear is 2025 again on the second load')
    : bad('the year did not survive a second reload', String(again.lastResultsYearOnLoad));
  again.csvToasts.some(t => /Results are from 2025/.test(t))
    ? ok('the export still refuses at the wrong year')
    : bad('the guard lapsed on the second reload', JSON.stringify(again.csvToasts));
  (again.filesProduced.length === 0)
    ? ok('still no file produced')
    : bad('a wrong-year file was produced after the second reload',
          JSON.stringify(again.filesProduced));

  // ── a genuine 2024 run still works ────────────────────────────────────────
  // The existing architecture stores ONE snapshot per property, so running 2024
  // replaces the 2025 one. That is not changed here. What must hold is that a
  // real 2024 run is not blocked by anything this fix introduced, and that the
  // guard then tracks the NEW year rather than the old one.
  sec('a genuine 2024 reconciliation still runs, and the guard follows it');
  const run2024 = await p.evaluate(async (propId) => {
    const pr = _props.find(x => x.id === propId);
    const inv = [
      { id: 'b1', vendorName: 'Northside Landscaping', category: 'landscaping', amount: 10000, invoiceDate: '2024-04-12' },
      { id: 'b2', vendorName: 'Talon Security',        category: 'security',    amount: 15000, invoiceDate: '2024-05-03' },
    ];
    invoiceData.splice(0, invoiceData.length, ...inv);
    pr.invoices = inv;
    if (typeof renderInvResults === 'function') renderInvResults();
    await saveProperty(pr);
    setCamYear('2024');
    await new Promise(r => setTimeout(r, 1200));
    await window.runAllocation();
    await new Promise(r => setTimeout(r, 3500));
    return { cards: document.querySelectorAll('#resultsBody .result-card').length,
             lastResultsYear,
             allocated: Math.round(lastResults.reduce((s, r) => s + (Number(r.totalAllocated) || 0), 0) * 100) / 100,
             heading: (document.getElementById('resultsTitle') || {}).textContent };
  }, PROP_ID);
  (run2024.cards === 2) ? ok('the 2024 run reconciles both tenants')
    : bad('a genuine 2024 run was blocked', String(run2024.cards));
  (run2024.lastResultsYear === 2024) ? ok('lastResultsYear now tracks 2024')
    : bad('the guard is still pinned to the old year', String(run2024.lastResultsYear));
  // 13,300 of 26,000 sqft against a $25,000 pool — computed here, not read back.
  (Math.abs(run2024.allocated - Math.round(25000 * 13300 / 26000 * 100) / 100) < 0.02)
    ? ok(`the 2024 pool is allocated pro-rata (${run2024.allocated})`)
    : bad('the 2024 run allocated the wrong amount', String(run2024.allocated));
  const after2024 = await p.evaluate(async (args) => {
    setCamYear('2025');
    await new Promise(r => setTimeout(r, 1000));
    return await eval(args.fn)(args.tenant);
  }, { fn: ATTEMPT, tenant: 'Cedar Park Dental' });
  after2024.csvToasts.some(t => /Results are from 2024 — re-run reconciliation for 2025/.test(t))
    ? ok('selecting 2025 against the new 2024 results is now the refused direction')
    : bad('the guard did not follow the new run', JSON.stringify(after2024.csvToasts));
  (after2024.filesProduced.length === 0) ? ok('and no file is produced')
    : bad('a file was produced against the new mismatch', JSON.stringify(after2024.filesProduced));

  // ── a snapshot that cannot say what year it is from ───────────────────────
  // camYear round-tripped as null until it was stamped, so reconciliations saved
  // before that exist and carry no year. Restoring one must not leave the year
  // of the last property reconciled this session standing as a claim about
  // these results — it reports unknown, and the guards stay inert as they were.
  sec('a legacy snapshot with no stored year reports unknown, not the last one');
  const legacy = await p.evaluate(() => {
    const before = lastResultsYear;           // 2024, from the run just above
    restoreResultsDisplay({
      results:  [{ name: 'Cedar Park Dental', allocatedAmount: 500, proRata: 0.5,
                   eligibleCount: 1, capApplied: false }],
      propName: 'Fernhill Court', total: 1000, invoices: [],
      invoicesFull: [{ vendorName: 'ACME', amount: 500, category: 'utilities' }],
      tenants:  [{ name: 'Cedar Park Dental', excludedCategories: [] }],
      // no camYear — this is the shape of a pre-stamp snapshot
    });
    return { before, after: lastResultsYear };
  });
  (legacy.before === 2024)
    ? ok('the session was carrying 2024 from the previous run')
    : bad('the fixture is not carrying a prior year, so this proves nothing', String(legacy.before));
  (legacy.after === null)
    ? ok('restoring a year-less snapshot reports unknown rather than inheriting 2024')
    : bad('a stale year survived onto results that cannot claim it', String(legacy.after));

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
