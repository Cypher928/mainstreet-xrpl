// test-e2e-cam-scope-disclosure.js
// ============================================================================
// SAY THE POOL THE RUN WILL ACTUALLY ALLOCATE, AND COUNT THE INVOICES IT USED.
//
// Two disclosure defects found on Maple Plaza during the Pilot smoke test.
// Neither touches the arithmetic; both are the product describing a run in
// terms that do not match what the run did.
//
// 1 · THE CONFIRMATION MODAL NAMED THE GROSS INVOICED TOTAL AS THE POOL.
//     "You are about to allocate $13,700.00 of CAM-recoverable expenses" and
//     "Allocating from $13,700.00" — on a run where $9,200 of that was dated
//     outside the CAM year and the engine never saw it. The modal read CamPool,
//     which answers "may a tenant be billed for this?" and knows nothing about
//     the year. The engine scopes its inputs to the reconciliation year in
//     runFullReconciliation; the modal now asks the same predicate
//     (camYearScopeOf) rather than a second one, so it cannot drift.
//
// 2 · THE EXPLANATION COUNTED EVERY INVOICE LOADED.
//     "5 invoices distributed pro-rata", while every tenant card read "3 of 5"
//     and the reconciliation reported 2 invoices unmatched. The count came from
//     paidInvData — the register — instead of from the allocation. It now comes
//     from r.eligibleCount, which IS includedInvoices.length on the engine's own
//     result object.
//
// THE FIXTURE IS BUILT SO RIGHT AND WRONG DIFFER. Out-of-year invoices carry
// DIFFERENT amounts from the in-year ones, and there are more loaded invoices
// than distributed ones, so a build that reports the gross figure or the loaded
// count cannot pass by coincidence. $13,700 gross against $4,500 scoped, and
// 5 loaded against 3 distributed.
//
// The negative assertion is explicit: the exact stale wording
// "5 invoices distributed pro-rata" must not appear anywhere on the screen
// when only 3 of 5 invoices entered the allocation.
//
// Run: node test-e2e-cam-scope-disclosure.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8958;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label, extra) => (got === want) ? ok(label)
  : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}${extra ? ' · ' + extra : ''}`);
const DB = `
(function(){
  var U={id:'disclosure-tester',email:'pm@example.com'};
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
// MAPLE PLAZA, as walked in the Pilot. Five invoices, $13,700 invoiced:
// three dated in 2026 ($4,500) and two dated 2025 ($9,200). The two amounts
// are deliberately unequal, and 5 !== 3, so a build that reports the gross
// figure or the loaded count fails rather than coinciding.
const MAPLE = `(async () => {
  const prop = { id: 'maple-scope', name: 'Maple Plaza', totalSqft: 40000,
    status: 'in-progress', tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
    createdAt: new Date().toISOString(),
    tenants: [
      { tenant_name: 'Alder Dental',  leased_sqft: 1000, start_date: '2020-01-01', end_date: '2030-12-31',
        lease_type: 'NNN', cap: null, id: 'mz-t1', flags: [], confidence: {} },
      { tenant_name: 'Birch Bakery',  leased_sqft: 1000, start_date: '2020-01-01', end_date: '2030-12-31',
        lease_type: 'NNN', cap: null, id: 'mz-t2', flags: [], confidence: {} },
      { tenant_name: 'Cedar Cleaners',leased_sqft: 1000, start_date: '2020-01-01', end_date: '2030-12-31',
        lease_type: 'NNN', cap: null, id: 'mz-t3', flags: [], confidence: {} },
      // EXCLUDES A CATEGORY, so its includedInvoices is SMALLER than the
      // others'. Without one such tenant every eligibleCount is identical and
      // a claim built from the minimum reads the same as one built from the
      // maximum — right and wrong would coincide.
      { tenant_name: 'Dogwood Optics',leased_sqft: 1000, start_date: '2020-01-01', end_date: '2030-12-31',
        lease_type: 'NNN', cap: null, id: 'mz-t4', flags: [], confidence: {},
        excluded_categories: 'security' },
    ],
    invoices: [
      { id: 'mz-1', vendorName: 'Northwind Landscaping', category: 'landscaping', amount: 1500, invoiceDate: '2026-03-10' },
      { id: 'mz-2', vendorName: 'Quill Janitorial',      category: 'janitorial',  amount: 1800, invoiceDate: '2026-06-14' },
      { id: 'mz-3', vendorName: 'Harbor Security',       category: 'security',    amount: 1200, invoiceDate: '2026-09-02' },
      { id: 'mz-4', vendorName: 'Old Year Roofing',      category: 'repairs',     amount: 6000, invoiceDate: '2025-04-18' },
      { id: 'mz-5', vendorName: 'Old Year Paving',       category: 'repairs',     amount: 3200, invoiceDate: '2025-08-22' },
    ],
    disputes: [], activityLog: [], timeline: [] };
  _props.push(prop);
  await saveProperty(prop);
  await selectProperty(prop.id);
  await new Promise(r => setTimeout(r, 2700));
  setCamYear('2026');
  await new Promise(r => setTimeout(r, 900));
  window.switchWorkspaceTab && window.switchWorkspaceTab('cam');
  await new Promise(r => setTimeout(r, 1400));
})()`;

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
  await p.route('**/api/**',    r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[{"id":1}]}' }));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);
  await p.evaluate(MAPLE);

  // ══ 0 · THE YEAR PREDICATE IS ONE FUNCTION ══════════════════════════════
  sec('0 · the engine and the modal ask the same question');
  const pred = await p.evaluate(() => ({
    inYear:  camYearScopeOf({ invoiceDate: '2026-03-10' }, '2026'),
    outYear: camYearScopeOf({ invoiceDate: '2025-04-18' }, '2026'),
    undated: camYearScopeOf({ invoiceDate: '' }, '2026'),
    junk:    camYearScopeOf({ invoiceDate: 'not-a-date' }, '2026'),
    keepsIn:      camYearIncludes({ invoiceDate: '2026-03-10' }, '2026'),
    dropsOut:     camYearIncludes({ invoiceDate: '2025-04-18' }, '2026'),
    keepsUndated: camYearIncludes({ invoiceDate: '' }, '2026'),
  }));
  is(pred.inYear,  'in',      'a date inside the year is "in"');
  is(pred.outYear, 'out',     'a date outside it is "out"');
  is(pred.undated, 'undated', 'a missing date is "undated", not "out"');
  is(pred.junk,    'undated', 'and an unreadable date is undated too');
  is(pred.keepsIn, true,      'the engine keeps an in-year invoice');
  is(pred.dropsOut, false,    'drops an out-of-year one');
  is(pred.keepsUndated, true, 'and KEEPS an undated one — dropping it would lose a real expense');

  // ══ 1 · THE CONFIRMATION MODAL ══════════════════════════════════════════
  sec('1 · the modal states the pool the run will allocate from');
  const modal = await p.evaluate(async () => {
    const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : '';
    const vis = e => { if (!e) return false; const r = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && r.height > 2; };
    const btn = [...document.querySelectorAll('button')].filter(vis)
      .find(b => /calculate cam charges/i.test(b.innerText || ''));
    if (!btn) return { error: 'no Calculate button' };
    btn.click();
    await new Promise(r => setTimeout(r, 1800));
    const m = [...document.querySelectorAll('.modal-backdrop,[id$=Modal]')].filter(vis)[0];
    const txt = T(m);
    const money = re => { const x = txt.match(re); return x ? x[1] : null; };
    return {
      text: txt,
      headline:       (txt.match(/You are about to allocate .*?tenants?\./) || [])[0] || null,
      allocatingFrom: money(/Allocating from \$([\d,]+\.\d\d)/),
      invoicedTotal:  money(/Invoiced total \$([\d,]+\.\d\d)/),
      outOfYearRow:   money(/Dated outside 2026 −?\$([\d,]+\.\d\d)/),
      mentionsOutOfYear: /dated outside 2026/i.test(txt),
      categoryRows: (() => {
        const tbl = m ? m.querySelector('.modal-summary-table') : null;
        if (!tbl) return null;
        const skip = /^(Total Invoices|Invoiced total|Not CAM-eligible|Dated outside \d{4}|Allocating from|Tenants)$/i;
        return [...tbl.querySelectorAll('tr')].map(tr => {
          const td = tr.querySelectorAll('td');
          return td.length === 2 ? { label: T(td[0]), value: T(td[1]) } : null;
        }).filter(r => r && !skip.test(r.label));
      })(),
    };
  });
  if (modal.error) { bad('modal fixture', modal.error); }
  else {
    console.log('  headline: ' + modal.headline);
    is(modal.invoicedTotal, '13,700.00', 'the gross invoiced total is still shown, separately');
    is(modal.allocatingFrom, '4,500.00', 'Allocating from is the SCOPED pool',
       'the gross 13,700.00 was the reported defect');
    (modal.allocatingFrom !== '13,700.00')
      ? ok('the gross figure is NOT presented as the allocation pool')
      : bad('the modal still promises the gross total', modal.headline);
    /\$4,500\.00 of CAM-recoverable/.test(modal.headline || '')
      ? ok('and the headline names the same scoped figure')
      : bad('the headline and the table disagree', String(modal.headline));
    is(modal.outOfYearRow, '9,200.00', 'the out-of-year amount is disclosed on its own line');
    is(modal.mentionsOutOfYear, true, 'and named as out-of-year rather than silently dropped');
    // A breakdown struck off the gross under a scoped headline is a table that
    // contradicts its own total — the same defect shape as the exclusion rows.
    console.log('  category rows: ' + JSON.stringify(modal.categoryRows));
    const catSum = (modal.categoryRows || [])
      .reduce((s2, r) => s2 + Number(String(r.value).replace(/[$,]/g, '')), 0);
    (Math.abs(catSum - 4500) < 0.005)
      ? ok(`the category rows add up to the scoped pool ($${catSum.toFixed(2)})`)
      : bad('the category breakdown contradicts the headline',
            `rows sum to ${catSum} against an Allocating from of ${modal.allocatingFrom}`);
    !(modal.categoryRows || []).some(r => /repairs/i.test(r.label))
      ? ok('and the out-of-year repairs category is absent from the breakdown')
      : bad('an out-of-year category is still itemised', JSON.stringify(modal.categoryRows));
  }

  // ══ 2 · THE POST-RUN EXPLANATION ════════════════════════════════════════
  sec('2 · the explanation counts the invoices the run distributed');
  const run = await p.evaluate(async () => {
    const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : '';
    const vis = e => { if (!e) return false; const r = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && r.height > 2; };
    const m = [...document.querySelectorAll('.modal-backdrop,[id$=Modal]')].filter(vis)[0];
    const confirm = m ? [...m.querySelectorAll('button')].filter(vis).find(b => /confirm/i.test(b.innerText || '')) : null;
    if (confirm) confirm.click();
    await new Promise(r => setTimeout(r, 5200));
    const summary = buildAuditSummary(lastResults || [], invoiceData || [], lastTotal || 0);
    const all = (summary.red || []).concat(summary.yellow || [], summary.green || []);
    const prorata = all.find(f => /allocated as shared CAM expense/i.test(f.title || ''));
    return {
      loadedInvoices: (invoiceData || []).length,
      eligibleCounts: (lastResults || []).map(r => r.eligibleCount),
      proRataTitle: prorata ? prorata.title : null,
      proRataConditions: prorata ? prorata.conditions : null,
      proRataDetail: prorata ? prorata.detail : null,
      // everything rendered on the CAM screen, for the negative assertion
      screen: T(document.getElementById('results')) + ' ' + T(document.getElementById('auditPanel')),
    };
  });
  is(run.loadedInvoices, 5, 'five invoices are loaded');
  // Three tenants see all three in-year invoices; Dogwood excludes security and
  // sees two. The distributed set is the union — three — so a claim built from
  // the MINIMUM would say two and understate what the run actually allocated.
  (run.eligibleCounts.filter(c => c === 3).length === 3 &&
   run.eligibleCounts.filter(c => c === 2).length === 1)
    ? ok('the engine included 3 for most tenants and 2 for the one with an exclusion')
    : bad('fixture drifted — eligibleCounts are not 3,3,3,2', JSON.stringify(run.eligibleCounts));
  (Math.min(...run.eligibleCounts) !== Math.max(...run.eligibleCounts))
    ? ok('so the minimum and maximum differ and the claim cannot pass by coincidence')
    : bad('every tenant has the same count — the fixture proves nothing', JSON.stringify(run.eligibleCounts));
  console.log('  title: ' + run.proRataTitle);
  /\b3 of 5 invoices allocated as shared CAM expenses \(pro-rata\)/.test(run.proRataTitle || '')
    ? ok('the finding title says 3 of 5')
    : bad('the title does not report the distributed count', String(run.proRataTitle));
  (run.proRataConditions || []).some(c => /^3 invoices distributed pro-rata/.test(c))
    ? ok('and the condition says 3 invoices distributed pro-rata')
    : bad('the condition count is wrong', JSON.stringify(run.proRataConditions));
  (run.proRataConditions || []).some(c => /2 of the 5 loaded invoices did not enter this allocation/.test(c))
    ? ok('the 2 that did not enter the allocation are named')
    : bad('the excluded invoices are not disclosed', JSON.stringify(run.proRataConditions));

  // ══ 3 · THE NEGATIVE ASSERTION ══════════════════════════════════════════
  sec('3 · the stale wording cannot appear');
  const stale = /5 invoices distributed pro-rata/;
  !stale.test(run.proRataTitle || '') && !(run.proRataConditions || []).some(c => stale.test(c)) &&
  !stale.test(run.proRataDetail || '')
    ? ok('"5 invoices distributed pro-rata" is absent from the finding')
    : bad('THE STALE WORDING IS BACK', JSON.stringify({ t: run.proRataTitle, c: run.proRataConditions }));
  !stale.test(run.screen)
    ? ok('and absent from everything rendered on the CAM screen')
    : bad('the stale wording is on screen', run.screen.slice(0, 300));
  // "5 invoices allocated..." also occurs inside the CORRECT "3 of 5 invoices
  // allocated...", so the stale claim is the one with no "N of" before it.
  !/(?<!\d of )\b5 invoices allocated as shared CAM expenses/.test(run.screen)
    ? ok('the screen never claims all 5 were allocated, only "3 of 5"')
    : bad('the screen claims all 5 were allocated', run.screen.slice(0, 300));
  /3 of 5 invoices allocated as shared CAM expenses/.test(run.screen)
    ? ok('and the scoped claim IS on screen')
    : bad('the scoped claim never reached the screen', run.screen.slice(0, 300));

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
