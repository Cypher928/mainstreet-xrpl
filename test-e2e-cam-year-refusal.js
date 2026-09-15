// test-e2e-cam-year-refusal.js
// ============================================================================
// THE JOURNEY THE BLOCKER WAS FOUND ON, DRIVEN END TO END IN A REAL BROWSER.
//
// A manager reconciles last year's invoices while the CAM-year selector sits on
// this year — which is the ordinary case, because CAM reconciliation happens
// months after the period it covers and the selector defaults to the current
// year. The engine refuses, correctly. Everything this file asserts is about
// what the APPLICATION did next.
//
// Measured before the fix, on exactly this fixture: a `cam_reconciled` timeline
// event at severity `success` reading "0 tenants · $117,750.00 in expenses", a
// run-history entry, a ✓ on the Calculate step, a "✓ CAM Reconciliation
// Complete" toast, a results area reading "TOTAL EXPENSES $117,750.00 ·
// TENANTS 0", and $117,750 advertised on the portfolio as CAM under management.
// The only true statement was a toast that lasted fourteen seconds.
//
// THE FIXTURE MATTERS. Cascade Commons cannot expose any of this: its invoice
// dates match its CAM year, so the refusal never fires and a correct product and
// a broken one look identical. The invoices here are dated 2025 against a 2026
// CAM year, and the suite ends by switching the year to 2025 and re-running — so
// a "fix" that simply blocks allocation fails just as loudly as the original
// defect did.
//
// The mock Supabase is backed by localStorage, so the reload at the end is a
// real reload against persisted state, not a re-render.
//
// Run: node test-e2e-cam-year-refusal.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8948;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');

// Stateful Supabase stand-in, persisted in localStorage so a reload sees what
// the run wrote.
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

// A toast is a bare fixed div with no class — find it by shape, the way the
// screen does.
const TOASTS = `[...document.body.children]
  .filter(e => e.tagName === 'DIV' && e.style && e.style.zIndex === '99999')
  .map(e => (e.innerText || '').replace(/\\s+/g, ' ').trim())`;

const PROP_ID = 'cedar-park-commons-refusal';

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
  // Past the landing hero into the app.
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);

  // ── The property: real leases, real invoices, all dated the year before ────
  sec('setup · a property whose invoices are all dated 2025, billed as 2026');
  await p.evaluate(async (propId) => {
    const prop = {
      id: propId, name: 'Cedar Park Commons', totalSqft: 26000,
      status: 'in-progress', tenantCount: 0, invoiceCount: 0, totalCAM: 0,
      openDisputes: 0, createdAt: new Date().toISOString(),
      tenants: [
        { tenant_name: 'Cedar Park Dental',   leased_sqft: 4200, start_date: '2022-03-01',
          end_date: '2027-02-28', lease_type: 'NNN', cap: null, id: 'tn-1', flags: [], confidence: {} },
        { tenant_name: 'Bright Leaf Grocers', leased_sqft: 9100, start_date: '2021-06-01',
          end_date: '2028-05-31', lease_type: 'NNN', cap: null, id: 'tn-2', flags: [], confidence: {} },
      ],
      invoices: [
        { id: 'iv-1', vendorName: 'Northside Landscaping', category: 'landscaping', amount: 18400, invoiceDate: '2025-04-12' },
        { id: 'iv-2', vendorName: 'Talon Security',        category: 'security',    amount: 26100, invoiceDate: '2025-05-03' },
        { id: 'iv-3', vendorName: 'Pacific Facilities',    category: 'janitorial',  amount: 31250, invoiceDate: '2025-06-21' },
        { id: 'iv-4', vendorName: 'Cascade Insurance',     category: 'insurance',   amount: 42000, invoiceDate: '2025-02-01' },
      ],
      disputes: [], activityLog: [], timeline: [],
    };
    _props.push(prop);
    await saveProperty(prop);
    await selectProperty(propId);
  }, PROP_ID);
  await p.waitForTimeout(3000);
  await p.evaluate(() => { setCamYear('2026'); window.switchWorkspaceTab('cam'); });
  await p.waitForTimeout(2000);

  const before = await p.evaluate((propId) => {
    const pr = _props.find(x => x.id === propId) || {};
    return {
      camYear: getCamYear(),
      invoices: (typeof invoiceData !== 'undefined' ? invoiceData : []).length,
      tenants: (pr.tenants || []).length,
      timeline: (pr.timeline || []).length,
      camRuns: (typeof camRuns !== 'undefined' ? camRuns : []).length,
      hasSnapshot: !!pr.camReconciliation,
      totalCAM: pr.totalCAM,
    };
  }, PROP_ID);
  (before.camYear === 2026 || before.camYear === '2026')
    ? ok('the CAM year is set to 2026') : bad('CAM year not 2026', String(before.camYear));
  (before.invoices === 4) ? ok('4 invoices are loaded, all dated 2025')
    : bad('invoices did not load', String(before.invoices));
  (before.tenants === 2) ? ok('2 tenants are on the property')
    : bad('tenants did not load', String(before.tenants));

  // ── The click the manager makes ───────────────────────────────────────────
  sec('the manager clicks Calculate CAM Charges and confirms');
  const clicked = await p.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && r.height > 2; };
    const btn = [...document.querySelectorAll('button')].filter(vis)
      .find(x => /calculate cam charges/i.test(x.innerText || ''));
    if (!btn) return null;
    btn.click(); return (btn.innerText || '').trim();
  });
  clicked ? ok(`clicked "${clicked}" by its visible label`)
          : bad('the Calculate button was not on screen', 'nothing to click');
  await p.waitForTimeout(1800);
  const confirmed = await p.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && r.height > 2; };
    const btn = [...document.querySelectorAll('button')].filter(vis)
      .find(x => /confirm & run|confirm and run/i.test(x.innerText || ''));
    if (!btn) return null;
    btn.click(); return (btn.innerText || '').trim();
  });
  confirmed ? ok(`clicked "${confirmed}" in the confirmation modal`)
            : bad('the confirmation modal offered no way to run', 'no confirm button');
  // Caught while the toasts are still up — a completion toast that appears and
  // fades would otherwise pass unnoticed.
  await p.waitForTimeout(2500);
  const during = await p.evaluate(new Function('return ' + TOASTS));

  await p.waitForTimeout(3500);

  // ── 1-7: what the refused run did, and did not do ─────────────────────────
  sec('1 · the engine refused and the application agrees');
  const after = await p.evaluate((propId) => {
    const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : null;
    const pr = _props.find(x => x.id === propId) || {};
    const section = document.getElementById('results');
    const body    = document.getElementById('resultsBody');
    const doneStep = id => { const el = document.getElementById('step-' + id);
      return el ? { done: el.classList.contains('done'), active: el.classList.contains('active') } : null; };
    return {
      refusal:        pr.camRefusal || null,
      timelineTypes:  (pr.timeline || []).map(e => e.type),
      timelineTitles: (pr.timeline || []).map(e => e.title),
      camRuns:        (typeof camRuns !== 'undefined' ? camRuns : []).length,
      snapshot:       pr.camReconciliation || null,
      totalCAM:       pr.totalCAM,
      lastResults:    (typeof lastResults !== 'undefined' ? lastResults : []).length,
      stepCalculate:  doneStep('calculate'),
      stepReview:     doneStep('review'),
      resultsTitle:   T(document.getElementById('resultsTitle')),
      refusalPanel:   T(section && section.querySelector('.cam-refusal')),
      resultCards:    body ? body.querySelectorAll('.result-card').length : null,
      summaryBars:    body ? body.querySelectorAll('.summary-bar').length : null,
      capWarnings:    section ? section.querySelectorAll('.cam-cap-incomplete-warning').length : null,
      sectionText:    (T(section) || ''),
    };
  }, PROP_ID);

  (after.refusal && after.refusal.refused === true && String(after.refusal.year) === '2026')
    ? ok('the refusal is recorded on the property, scoped to 2026')
    : bad('the refusal was not recorded', JSON.stringify(after.refusal));

  // Requirement 6 rests on this: nothing survives a reload that was never
  // written down. Asserted against the stored row rather than the live object.
  const persisted = await p.evaluate((propId) => {
    let row = null;
    try {
      const db = JSON.parse(localStorage.getItem('__mockdb') || '{}');
      row = (db.properties || []).find(r => r.id === propId) || null;
    } catch (_) {}
    return { hasRow: !!row, rowRefusal: row && row.data ? (row.data.camRefusal || null) : null };
  }, PROP_ID);
  (persisted.rowRefusal && persisted.rowRefusal.refused === true)
    ? ok('the refusal is written to the stored property row')
    : bad('the refusal never reached storage', JSON.stringify(persisted));

  sec('2 · no successful timeline event');
  !after.timelineTypes.includes('cam_reconciled')
    ? ok('no cam_reconciled event was written')
    : bad('a cam_reconciled event was written for a refused run', after.timelineTitles.join(' | '));
  !after.timelineTitles.some(t => /CAM reconciled/i.test(t || ''))
    ? ok('nothing in the property history says CAM was reconciled')
    : bad('the property history claims a reconciliation', after.timelineTitles.join(' | '));

  sec('3 · no successful run-history record');
  (after.camRuns === before.camRuns)
    ? ok(`run history is unchanged (${after.camRuns})`)
    : bad('the refused run was added to run history', `${before.camRuns} → ${after.camRuns}`);
  (after.snapshot === null)
    ? ok('no reconciliation snapshot was saved')
    : bad('a reconciliation snapshot was saved for a refused run',
          JSON.stringify({ total: after.snapshot.total, results: (after.snapshot.results || []).length }));

  sec('4 · no completion toast');
  !during.some(t => /CAM Reconciliation Complete/i.test(t))
    ? ok('"✓ CAM Reconciliation Complete" was never shown')
    : bad('a completion toast claimed success', during.join(' // '));
  during.some(t => /Nothing to reconcile for 2026/i.test(t))
    ? ok('the refusal was announced at the moment of the click')
    : bad('nothing told the manager the run was refused', during.join(' // ') || '(no toasts)');

  sec('5 · Calculate did not become successfully completed');
  (after.stepCalculate && after.stepCalculate.done === false)
    ? ok('the Calculate step is not marked done')
    : bad('Calculate was ticked after a refused run', JSON.stringify(after.stepCalculate));
  (after.stepReview && after.stepReview.done === false && after.stepReview.active === false)
    ? ok('the manager was not advanced to Review')
    : bad('the step bar advanced past Calculate', JSON.stringify(after.stepReview));

  sec('6 · the results area does not present the invoice pool as allocated CAM');
  (after.resultCards === 0) ? ok('no tenant result cards are on screen')
    : bad('result cards rendered for a refused run', String(after.resultCards));
  (after.summaryBars === 0) ? ok('no reconciliation summary bar is on screen')
    : bad('a summary bar rendered for a refused run', String(after.summaryBars));
  !/TOTAL EXPENSES/i.test(after.sectionText)
    ? ok('"TOTAL EXPENSES" is not shown beside a tenant count of zero')
    : bad('the invoice pool is still presented as reconciliation totals', after.sectionText.slice(0, 200));
  !/117,750/.test(after.sectionText)
    ? ok('the $117,750 pool is not presented as a reconciled figure')
    : bad('the pool total is on the results screen', after.sectionText.slice(0, 200));
  (after.capWarnings === 0)
    ? ok('no cap warning is left claiming charges were calculated')
    : bad('a cap warning survived, describing charges that do not exist', String(after.capWarnings));
  /No CAM was reconciled for 2026/.test(after.refusalPanel || '')
    ? ok('a durable refusal panel fills the results area')
    : bad('the results area carries no refusal', String(after.refusalPanel));
  /none of the 4 invoices loaded is dated in 2026/i.test(after.refusalPanel || '')
    ? ok('the panel gives the reason, with the counts')
    : bad('the panel does not explain why', String(after.refusalPanel));
  /not reconciled/i.test(after.resultsTitle || '')
    ? ok('the section heading says the year was not reconciled')
    : bad('the heading still reads like a completed run', String(after.resultsTitle));

  sec('7 · the portfolio does not count the refused run as CAM managed');
  const portfolio = await p.evaluate(async () => {
    const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : null;
    try { window.backToPortfolio && window.backToPortfolio(); } catch (_) {}
    await new Promise(r => setTimeout(r, 2500));
    const card = [...document.querySelectorAll('.property-card,.ptf-card,[class*="prop-card"]')]
      .find(c => /Cedar Park Commons/.test(c.innerText || ''));
    const dash = T(document.getElementById('portfolioDashboard')) || '';
    return {
      cardCam: (T(card) || '').match(/\$[\d,]+ CAM/) ? (T(card).match(/\$[\d,]+ CAM/) || [])[0] : null,
      dashCam: (dash.match(/\$[\d,]+ TOTAL CAM MANAGED/) || [])[0] || null,
      cardText: (T(card) || '').slice(0, 200),
    };
  });
  (portfolio.cardCam === null || !/117,750/.test(portfolio.cardCam))
    ? ok('the property card does not advertise the pool as CAM')
    : bad('the portfolio card counts the refused run', String(portfolio.cardCam));
  (portfolio.dashCam === null || !/117,750/.test(portfolio.dashCam))
    ? ok('the dashboard does not count it as CAM under management')
    : bad('the dashboard counts the refused run', String(portfolio.dashCam));
  (after.totalCAM === 0 || after.totalCAM == null)
    ? ok('the property carries no CAM total from the refused run')
    : bad('totalCAM was set by a refused run', String(after.totalCAM));

  // ── 8: a real reload ──────────────────────────────────────────────────────
  sec('8 · after a real browser reload, the refusal is still explained');
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);
  const reloaded = await p.evaluate(async (propId) => {
    const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : null;
    await selectProperty(propId);
    await new Promise(r => setTimeout(r, 2500));
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1500));
    const section = document.getElementById('results');
    const pr = _props.find(x => x.id === propId) || {};
    return {
      panel:       T(section && section.querySelector('.cam-refusal')),
      title:       T(document.getElementById('resultsTitle')),
      sectionText: (T(section) || ''),
      cards:       section ? section.querySelectorAll('.result-card').length : null,
      // Carried so a failure here says WHICH half broke: the round-trip or the
      // year guard that decides whether the stored refusal still applies.
      stored:      pr.camRefusal || null,
      propCamYear: pr.camYear,
      activeYear:  getCamYear(),
    };
  }, PROP_ID);
  const why = ` [stored=${JSON.stringify(reloaded.stored)} propYear=${reloaded.propCamYear} activeYear=${reloaded.activeYear}]`;
  /No CAM was reconciled for 2026/.test(reloaded.panel || '')
    ? ok('the refusal panel survives the reload')
    : bad('the refusal was lost on reload', String(reloaded.panel) + why);
  /none of the 4 invoices loaded is dated in 2026/i.test(reloaded.panel || '')
    ? ok('the reason survives with it')
    : bad('the reason was lost on reload', String(reloaded.panel) + why);
  !/No CAM allocation has been run yet/i.test(reloaded.sectionText)
    ? ok('it does not fall back to "no allocation has been run yet"')
    : bad('the reload hides the refusal behind a never-run empty state', reloaded.sectionText.slice(0, 200) + why);
  !/fields were edited since the last run/i.test(reloaded.sectionText)
    ? ok('it does not fall back to a stale-results banner')
    : bad('the reload hides the refusal behind a stale-results banner', reloaded.sectionText.slice(0, 200));
  (reloaded.cards === 0) ? ok('no tenant results are restored')
    : bad('results were restored for a refused run', String(reloaded.cards));

  // ── 8b: the refusal speaks for its own year and no other ──────────────────
  // Run here, before any successful run exists, because this is the only state
  // in which the guard is reachable: once a snapshot is stored the restore path
  // puts those results back and never consults the refusal at all.
  sec('8b · with no reconciliation stored, the refusal is still scoped to its year');
  const scoped = await p.evaluate(async (propId) => {
    const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : null;
    const pr = _props.find(x => x.id === propId) || {};
    const read = () => {
      const s = document.getElementById('results');
      return { panel: T(s && s.querySelector('.cam-refusal')), text: (T(s) || '') };
    };
    const hasSnapshot = !!(pr.camReconciliation && (pr.camReconciliation.results || []).length);
    setCamYear('2024');
    await new Promise(r => setTimeout(r, 800));
    renderProperty(pr);
    await new Promise(r => setTimeout(r, 2000));
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1200));
    const at2024 = read();
    // and back again — the refusal must return, not be spent by the detour
    setCamYear('2026');
    await new Promise(r => setTimeout(r, 800));
    renderProperty(pr);
    await new Promise(r => setTimeout(r, 2000));
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1200));
    return { hasSnapshot, at2024, at2026: read(), stored: pr.camRefusal ? String(pr.camRefusal.year) : null };
  }, PROP_ID);
  (scoped.hasSnapshot === false)
    ? ok('no reconciliation is stored, so the refusal is what the screen has to go on')
    : bad('a snapshot exists, so this case does not exercise the year scope',
          'the restore path would show results instead');
  (scoped.at2024.panel === null)
    ? ok('set to 2024, the 2026 refusal is not shown')
    : bad('a 2026 refusal is explaining a 2024 screen', String(scoped.at2024.panel));
  /No CAM allocation has been run yet/i.test(scoped.at2024.text)
    ? ok('2024 gets the ordinary never-run empty state instead')
    : bad('2024 shows neither the refusal nor an empty state', scoped.at2024.text.slice(0, 200));
  /No CAM was reconciled for 2026/.test(scoped.at2026.panel || '')
    ? ok('set back to 2026, the refusal returns')
    : bad('the refusal did not come back when the year did', String(scoped.at2026.panel));
  (scoped.stored === '2026')
    ? ok('the stored refusal was never rewritten by the detour')
    : bad('switching years altered the stored refusal', String(scoped.stored));

  // ── 9: the positive control — fix the year and the run must work ──────────
  sec('9 · switching to the matching year reconciles, and clears the refusal');
  const fixed = await p.evaluate(async (propId) => {
    const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : null;
    setCamYear('2025');
    await new Promise(r => setTimeout(r, 1200));
    await window.runAllocation();
    await new Promise(r => setTimeout(r, 3500));
    const pr = _props.find(x => x.id === propId) || {};
    const section = document.getElementById('results');
    const body    = document.getElementById('resultsBody');
    const step    = id => { const el = document.getElementById('step-' + id);
      return el ? el.classList.contains('done') : null; };
    return {
      cards:        body ? body.querySelectorAll('.result-card').length : null,
      summaryBars:  body ? body.querySelectorAll('.summary-bar').length : null,
      refusalPanel: !!(section && section.querySelector('.cam-refusal')),
      refusalStored: pr.camRefusal || null,
      timelineTypes: (pr.timeline || []).map(e => e.type),
      snapshotTotal: (pr.camReconciliation || {}).total,
      snapshotCount: ((pr.camReconciliation || {}).results || []).length,
      title:         T(document.getElementById('resultsTitle')),
      perTenant:     (typeof lastResults !== 'undefined' ? lastResults : [])
                       .map(r => ({ name: r.tenantName || r.name,
                                    allocated: Math.round((Number(r.totalAllocated) || 0) * 100) / 100 })),
    };
  }, PROP_ID);
  (fixed.cards === 2) ? ok('both tenants are now allocated and on screen')
    : bad('the corrected run produced no tenant cards', String(fixed.cards));
  (fixed.summaryBars === 1) ? ok('the reconciliation summary bar is back')
    : bad('no summary bar on a successful run', String(fixed.summaryBars));
  !fixed.refusalPanel ? ok('the refusal panel is gone')
    : bad('the refusal panel survived a successful run', 'panel still present');
  (fixed.refusalStored == null) ? ok('the stored refusal is cleared')
    : bad('a stale refusal is still on the property', JSON.stringify(fixed.refusalStored));
  fixed.timelineTypes.includes('cam_reconciled')
    ? ok('NOW a cam_reconciled event is written')
    : bad('a successful run wrote no timeline event', fixed.timelineTypes.join(', '));
  (fixed.snapshotCount === 2 && Math.round(fixed.snapshotTotal) === 117750)
    ? ok('the snapshot records 2 tenants against the $117,750 pool')
    : bad('the successful run saved the wrong snapshot',
          JSON.stringify({ count: fixed.snapshotCount, total: fixed.snapshotTotal }));
  // Pro-rata, computed here from the lease areas rather than read back from the
  // engine: 4,200 and 9,100 of 26,000 sqft against a $117,750 pool. The other
  // 12,700 sqft is vacant and its share is not recoverable from anybody, so the
  // full pool reaching the tenants would be the wrong answer, not the right one.
  {
    const expect = { 'Cedar Park Dental': Math.round(117750 * 4200 / 26000 * 100) / 100,
                     'Bright Leaf Grocers': Math.round(117750 * 9100 / 26000 * 100) / 100 };
    const got = Object.fromEntries(fixed.perTenant.map(t => [t.name, t.allocated]));
    const near = (a, b) => Math.abs((a || 0) - b) < 0.02;
    (near(got['Cedar Park Dental'], expect['Cedar Park Dental']) &&
     near(got['Bright Leaf Grocers'], expect['Bright Leaf Grocers']))
      ? ok(`each tenant gets its pro-rata share (${expect['Cedar Park Dental']} / ${expect['Bright Leaf Grocers']})`)
      : bad('the corrected run allocated the wrong amounts',
            `expected ${JSON.stringify(expect)}, got ${JSON.stringify(got)}`);
  }
  /2025 CAM/.test(fixed.title || '') ? ok('the heading reads as a 2025 reconciliation')
    : bad('the heading is wrong after the corrected run', String(fixed.title));

  // ── 10: a refusal AFTER a success must undo the success it follows ────────
  // The manager has just reconciled 2025. They switch to 2026 and run again,
  // too early. Everything the successful run left on screen and on the step bar
  // now describes a run that did not happen — and "Calculate is not ticked" is
  // only evidence if something had ticked it.
  sec('10 · a refused run after a successful one takes the success back off screen');
  const second = await p.evaluate(async (propId) => {
    const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : null;
    const stepDone = id => { const el = document.getElementById('step-' + id);
      return el ? el.classList.contains('done') : null; };
    const wasDone = stepDone('calculate');
    setCamYear('2026');
    await new Promise(r => setTimeout(r, 1200));
    await window.runAllocation();
    await new Promise(r => setTimeout(r, 3500));
    const pr = _props.find(x => x.id === propId) || {};
    const section = document.getElementById('results');
    const body    = document.getElementById('resultsBody');
    return {
      calculateWasDoneBefore: wasDone,
      calculateDoneAfter:     stepDone('calculate'),
      reviewDoneAfter:        stepDone('review'),
      cards:        body ? body.querySelectorAll('.result-card').length : null,
      summaryBars:  body ? body.querySelectorAll('.summary-bar').length : null,
      panel:        T(section && section.querySelector('.cam-refusal')),
      storedYear:   pr.camRefusal ? String(pr.camRefusal.year) : null,
      // The 2025 reconciliation itself is a real thing that happened — the
      // refusal must not erase the record of it.
      timelineHas2025: (pr.timeline || []).some(e => e.type === 'cam_reconciled'),
    };
  }, PROP_ID);
  (second.calculateWasDoneBefore === true)
    ? ok('the successful 2025 run had marked Calculate done')
    : bad('the fixture never ticked Calculate, so the next check proves nothing',
          String(second.calculateWasDoneBefore));
  (second.calculateDoneAfter === false)
    ? ok('the refused 2026 run takes the tick back off Calculate')
    : bad('Calculate stayed ticked after a refused run', String(second.calculateDoneAfter));
  (second.reviewDoneAfter === false)
    ? ok('Review is no longer marked done either')
    : bad('the step bar still shows Review complete', String(second.reviewDoneAfter));
  (second.cards === 0 && second.summaryBars === 0)
    ? ok('the 2025 tenant cards and summary bar are cleared from the screen')
    : bad('a previous run’s results are still on screen under a refusal',
          JSON.stringify({ cards: second.cards, bars: second.summaryBars }));
  /No CAM was reconciled for 2026/.test(second.panel || '')
    ? ok('the refusal panel is what fills the area instead')
    : bad('no refusal panel after the second run', String(second.panel));
  (second.storedYear === '2026')
    ? ok('the stored refusal now describes 2026')
    : bad('the stored refusal has the wrong year', String(second.storedYear));
  second.timelineHas2025
    ? ok('the 2025 reconciliation is still in the property history')
    : bad('the refusal erased a reconciliation that really happened', 'no cam_reconciled event left');

  // ── 11: the stored refusal must not explain a year it is not about ────────
  sec('11 · switching to another year stops the refusal speaking for it');
  const otherYear = await p.evaluate(async (propId) => {
    const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : null;
    const pr = _props.find(x => x.id === propId) || {};
    setCamYear('2024');
    await new Promise(r => setTimeout(r, 800));
    renderProperty(pr);
    await new Promise(r => setTimeout(r, 2000));
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1200));
    const section = document.getElementById('results');
    return {
      stillStored: pr.camRefusal ? String(pr.camRefusal.year) : null,
      panel:       T(section && section.querySelector('.cam-refusal')),
      sectionText: (T(section) || ''),
    };
  }, PROP_ID);
  (otherYear.stillStored === '2026')
    ? ok('the 2026 refusal is still on record')
    : bad('the stored refusal was lost by switching years', String(otherYear.stillStored));
  (otherYear.panel === null)
    ? ok('it is not shown while the screen is set to 2024')
    : bad('a 2026 refusal is explaining a 2024 screen', String(otherYear.panel));
  // What 2024 shows INSTEAD is not this slice's business: the restore path
  // brings back the stored 2025 snapshot, because it selects on having results
  // rather than on the year, and it did that before this change. What matters
  // here is only that no part of the 2026 refusal leaks onto that screen.
  !/No CAM was reconciled|dated in 2026|not reconciled/i.test(otherYear.sectionText)
    ? ok('no wording from the 2026 refusal appears anywhere on the 2024 screen')
    : bad('refusal wording leaked onto a screen it does not describe',
          otherYear.sectionText.slice(0, 220));

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
