// test-e2e-allocation-disclosure.js
// ============================================================================
// THREE PLACES THE PRODUCT NAMED A NUMBER, OR A TAB, THAT WAS NOT THERE.
//
// Found by walking the pilot journey as a first-time manager, not by a bug hunt.
//
//   1  SPACES EMPTY STATE — "Add tenants under Documents → Add One Tenant".
//      There is no Documents tab; the six are Overview, Property, Spaces, CAM,
//      Reserves and Reports. It is the first instruction she follows when
//      adding her first tenant, and the control it names is on the same screen.
//
//   2  CONFIRM MODAL — "You are about to allocate $114,500.00 across 2 tenants"
//      on a property where one $26,100 invoice was marked not CAM-eligible. The
//      engine allocates from $88,400. The modal never mentioned the exclusion.
//      It is the last thing she reads before committing.
//
//   3  EXPOSURE PANEL — "Total CAM pool $114,500" beside an allocation that ran
//      on $88,400 and a line reading "Marked not CAM-eligible $26,100". Traced
//      first: audit-exposure.js measures an EXPENSE-side axis and every caller
//      passes the gross invoiced total, so the value is right and the name was
//      wrong. The figure is unchanged; only the label moved.
//
// THE FIXTURE RUNS BOTH WAYS. With every invoice eligible the recoverable pool
// and the invoiced total are the same number, and a modal reading either one
// would pass — so the ineligible case is what carries the assertion, and the
// all-eligible case proves the disclosure does not appear when there is nothing
// to disclose.
//
// THE BINDING ASSERTION is that the figure the modal shows equals the pool the
// engine goes on to use — read from `lastCamPool` after the run, not restated.
//
// Run: node test-e2e-allocation-disclosure.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8953;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');

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

// Open the modal, read it, confirm, then read the pool the engine used.
const RUN = `(async () => {
  const T = e => e ? (e.innerText||'').replace(/\\s+/g,' ').trim() : null;
  const vis = e => { if (!e) return false; const r = e.getBoundingClientRect();
    return getComputedStyle(e).display !== 'none' && r.height > 2; };
  window.switchWorkspaceTab('cam');
  await new Promise(r => setTimeout(r, 1200));
  const btn = [...document.querySelectorAll('button')].filter(vis)
    .find(b => /calculate cam charges/i.test(b.innerText || ''));
  if (!btn) return { error: 'no Calculate button' };
  btn.click();
  await new Promise(r => setTimeout(r, 1700));
  const m = [...document.querySelectorAll('.modal-backdrop,[id$=Modal]')].filter(vis)[0];
  const modalText = T(m) || '';
  const confirm = m ? [...m.querySelectorAll('button')].filter(vis)
    .find(b => /confirm/i.test(b.innerText || '')) : null;
  if (confirm) confirm.click();
  await new Promise(r => setTimeout(r, 3800));
  const moneyIn = (re) => { const x = modalText.match(re); return x ? x[1] : null; };
  return {
    modalText,
    headline:      (modalText.match(/You are about to allocate [^.]*\\./) || [])[0] || null,
    allocatingFrom: moneyIn(/Allocating from \\$([\\d,]+\\.\\d\\d)/),
    invoicedTotal:  moneyIn(/Invoiced total \\$([\\d,]+\\.\\d\\d)/),
    notEligible:    moneyIn(/Not CAM-eligible −?\\$([\\d,]+\\.\\d\\d)/),
    mentionsNotEligible: /not CAM-eligible/i.test(modalText),
    // The category rows must add up to the basis stated above them — a
    // breakdown struck off the gross under an \"Allocating from $88,400\"
    // headline is a table that contradicts its own total.
    categoryRows: (() => {
      const tbl = m ? m.querySelector('.modal-summary-table') : null;
      if (!tbl) return null;
      const skip = /^(Total Invoices|Invoiced total|Not CAM-eligible|Allocating from|Tenants)$/i;
      return [...tbl.querySelectorAll('tr')].map(tr => {
        const td = tr.querySelectorAll('td');
        return td.length === 2 ? { label: T(td[0]), value: T(td[1]) } : null;
      }).filter(r => r && !skip.test(r.label));
    })(),
    // what the engine went on to use
    enginePool:    lastCamPool,
    engineGross:   lastTotal,
    cards:         document.querySelectorAll('#resultsBody .result-card').length,
  };
})()`;

const seedProp = (id, name, excludeOne) => `(async () => {
  const prop = {
    id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, totalSqft: 26000,
    status: 'in-progress', tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
    createdAt: new Date().toISOString(),
    tenants: [
      { tenant_name: 'Cedar Park Dental', leased_sqft: 4200, start_date: '2020-01-01',
        end_date: '2030-12-31', lease_type: 'NNN', cap: null, id: ${JSON.stringify(id + '-t1')}, flags: [], confidence: {} },
      { tenant_name: 'Bright Leaf Grocers', leased_sqft: 9100, start_date: '2020-01-01',
        end_date: '2030-12-31', lease_type: 'NNN', cap: null, id: ${JSON.stringify(id + '-t2')}, flags: [], confidence: {} },
    ],
    invoices: [
      { id: 'd1', vendorName: 'Northside Landscaping', category: 'landscaping', amount: 70000, invoiceDate: '2025-04-12' },
      { id: 'd2', vendorName: 'Talon Security',        category: 'security',    amount: 18400, invoiceDate: '2025-05-03' },
      { id: 'd3', vendorName: 'Pacific Facilities',    category: 'janitorial',  amount: 26100, invoiceDate: '2025-06-21'${excludeOne ? ', camEligible: false' : ''} },
    ],
    disputes: [], activityLog: [], timeline: [],
  };
  _props.push(prop);
  await saveProperty(prop);
  await selectProperty(prop.id);
  await new Promise(r => setTimeout(r, 2700));
  setCamYear('2025');
  await new Promise(r => setTimeout(r, 800));
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
  await p.route('**/api/**',    r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);

  // ══ 1 · THE SPACES EMPTY STATE ═══════════════════════════════════════════
  sec('1 · the Spaces empty state on a property with no tenants');
  const empty = await p.evaluate(async () => {
    const T = e => e ? (e.innerText||'').replace(/\s+/g,' ').trim() : null;
    const vis = e => { if (!e) return false; const r = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && r.height > 2; };
    const prop = { id: 'blank-prop', name: 'Blank Court', totalSqft: 10000,
      status: 'in-progress', tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
      createdAt: new Date().toISOString(), tenants: [], invoices: [],
      disputes: [], activityLog: [], timeline: [] };
    _props.push(prop);
    await saveProperty(prop);
    await selectProperty('blank-prop');
    await new Promise(r => setTimeout(r, 2700));
    window.switchWorkspaceTab('spaces');
    await new Promise(r => setTimeout(r, 1500));
    const pane = document.getElementById('wsPane-spaces');
    const msg = T(document.querySelector('#spacesList .ts-empty'));
    // every tab a manager can actually reach from here
    const tabs = [...document.querySelectorAll('[id^="wsTabBtn-"]')]
      .filter(vis).map(e => (T(e) || '').replace(/[^\w ]/g, '').trim());
    // and the controls the message could be pointing at
    const controls = [...(pane ? pane.querySelectorAll('button') : [])]
      .filter(vis).map(e => T(e)).filter(Boolean);
    return { msg, tabs, controls,
             documentsTabExists: !!document.getElementById('wsPane-documents') };
  });
  console.log('  MESSAGE: ' + empty.msg);
  console.log('  TABS   : ' + empty.tabs.join(' | '));
  (empty.documentsTabExists === false && !empty.tabs.some(t => /document/i.test(t)))
    ? ok('there is no Documents tab to send anyone to')
    : bad('the fixture is wrong — a Documents tab exists', JSON.stringify(empty.tabs));
  !/Documents/i.test(empty.msg || '')
    ? ok('the empty state no longer names a Documents tab')
    : bad('THE OBSOLETE INSTRUCTION IS BACK', String(empty.msg));
  // it must point at something the manager can actually see and press
  const named = (empty.controls || []).filter(c => (empty.msg || '').includes(c.replace(/^[^\w]+\s*/, '')));
  (named.length > 0)
    ? ok(`it names a control that is on this screen: ${named.map(n => '"' + n + '"').join(', ')}`)
    : bad('the message names no control present on the Spaces screen',
          JSON.stringify({ msg: empty.msg, controls: empty.controls }));
  /Add One Tenant/i.test(empty.msg || '')
    ? ok('and it names Add One Tenant specifically')
    : bad('Add One Tenant is not named', String(empty.msg));

  // ══ 2 · THE CONFIRM MODAL ════════════════════════════════════════════════
  sec('2a · every invoice CAM-eligible — nothing to disclose');
  await p.evaluate(seedProp('all-eligible', 'Allbright Court', false));
  await p.waitForTimeout(1200);
  const all = await p.evaluate(RUN);
  console.log('  HEADLINE: ' + all.headline);
  (all.cards === 2) ? ok('the run completes') : bad('the run did not complete', JSON.stringify(all));
  (all.enginePool === 114500 && all.engineGross === 114500)
    ? ok('with nothing excluded, pool and invoiced total are the same ($114,500)')
    : bad('fixture wrong', JSON.stringify({ pool: all.enginePool, gross: all.engineGross }));
  (all.allocatingFrom === '114,500.00')
    ? ok('the modal states "Allocating from $114,500.00"')
    : bad('the modal did not state the pool', String(all.allocatingFrom));
  !all.mentionsNotEligible
    ? ok('no exclusion line appears when there is nothing excluded')
    : bad('an exclusion was disclosed where there is none', all.modalText.slice(0, 200));
  {
    const sum = (all.categoryRows || []).reduce(
      (s, r) => s + (parseFloat(String(r.value).replace(/[$,]/g, '')) || 0), 0);
    (Math.abs(sum - all.enginePool) < 0.01)
      ? ok(`the category rows add up to the stated basis (${sum})`)
      : bad('the category breakdown does not add up to what the modal says it is allocating',
            `rows ${sum} vs stated ${all.enginePool} — ` + JSON.stringify(all.categoryRows));
  }

  sec('2b · one invoice NOT CAM-eligible — the case that exposed this');
  await p.evaluate(seedProp('some-excluded', 'Fernhill Court', true));
  await p.waitForTimeout(1200);
  const some = await p.evaluate(RUN);
  console.log('  HEADLINE: ' + some.headline);
  (some.cards === 2) ? ok('the run completes') : bad('the run did not complete', JSON.stringify(some));
  (some.enginePool === 88400 && some.engineGross === 114500)
    ? ok('the engine allocates from $88,400 of $114,500 invoiced')
    : bad('fixture wrong', JSON.stringify({ pool: some.enginePool, gross: some.engineGross }));
  // THE BINDING ASSERTION
  (some.allocatingFrom === '88,400.00')
    ? ok('the modal states the RECOVERABLE pool, $88,400.00')
    : bad('the modal states the wrong basis', String(some.allocatingFrom));
  {
    const shown = parseFloat(String(some.allocatingFrom || '0').replace(/,/g, ''));
    (Math.abs(shown - some.enginePool) < 0.01)
      ? ok('the figure the manager confirmed equals the pool the engine used')
      : bad('the confirmed figure and the engine pool differ',
            `modal ${shown} vs engine ${some.enginePool}`);
  }
  !/about to allocate \$114,500/.test(some.headline || '')
    ? ok('it no longer claims the gross invoiced total is being allocated')
    : bad('THE ORIGINAL WORDING IS BACK', String(some.headline));
  (some.notEligible === '26,100.00')
    ? ok('the excluded $26,100.00 is disclosed on its own line')
    : bad('the exclusion is not disclosed', String(some.notEligible));
  (some.invoicedTotal === '114,500.00')
    ? ok('the invoiced total is still shown, so the arithmetic reconciles')
    : bad('the invoiced total is missing', String(some.invoicedTotal));
  /not CAM-eligible and will not be allocated/i.test(some.modalText)
    ? ok('and the headline says plainly it will not be allocated')
    : bad('the headline does not say the excluded money is not allocated',
          some.modalText.slice(0, 240));
  {
    const sum = (some.categoryRows || []).reduce(
      (s, r) => s + (parseFloat(String(r.value).replace(/[$,]/g, '')) || 0), 0);
    (Math.abs(sum - some.enginePool) < 0.01)
      ? ok(`the category rows add up to $88,400 — the basis, not the gross (${sum})`)
      : bad('the category breakdown contradicts the stated basis',
            `rows ${sum} vs stated ${some.enginePool} — ` + JSON.stringify(some.categoryRows));
    !(some.categoryRows || []).some(r => /janitorial/i.test(r.label))
      ? ok('the excluded janitorial invoice is not among the categories being allocated')
      : bad('an excluded category is listed as being allocated',
            JSON.stringify(some.categoryRows));
  }

  // ══ 3 · THE EXPOSURE PANEL LABEL ═════════════════════════════════════════
  // Traced before changing: audit-exposure.js measures an expense-side axis and
  // every caller passes lastTotal, so the VALUE is the gross invoiced total and
  // correct. Only the name was wrong.
  sec('3 · the exposure panel names the gross figure for what it is');
  const panel = await p.evaluate(() => {
    const T = e => e ? (e.innerText||'').replace(/\s+/g,' ').trim() : null;
    const txt = T(document.getElementById('results')) || '';
    const ex = window.AuditExposure
      ? window.AuditExposure.deriveExposure(buildAuditSummary(), lastTotal || 0) : null;
    return {
      saysInvoiced: /Total invoiced expenses/i.test(txt),
      stillSaysCamPoolForGross: /Total CAM pool \$114,500/.test(txt),
      describe: window.AuditExposure && ex ? window.AuditExposure.describeExposure(ex) : null,
      totalPoolValue: ex ? ex.totalPool : null,
      engineGross: lastTotal, enginePool: lastCamPool,
      // the concentration finding legitimately measures against the RECOVERABLE
      // pool and keeps its name — this must not have been relabelled with it
      concentrationBasis: (txt.match(/of total CAM expenses \(\$[\d,.]+ of (\$[\d,.]+)\)/) || [])[1] || null,
    };
  });
  console.log('  DESCRIBE: ' + String(panel.describe).slice(0, 160));
  (panel.totalPoolValue === panel.engineGross)
    ? ok(`the panel's figure is the gross invoiced total (${panel.engineGross}) — value unchanged`)
    : bad('the panel value changed', JSON.stringify(panel));
  panel.saysInvoiced
    ? ok('it is labelled "Total invoiced expenses"')
    : bad('the new label is not on screen', JSON.stringify(panel));
  !panel.stillSaysCamPoolForGross
    ? ok('it no longer calls the gross figure the CAM pool')
    : bad('"Total CAM pool $114,500" is still on screen', JSON.stringify(panel));
  /total invoiced expenses/i.test(panel.describe || '')
    ? ok('the one-line summary uses the same words')
    : bad('describeExposure still says CAM pool', String(panel.describe));
  (panel.concentrationBasis === '$88,400.00')
    ? ok('the concentration finding still measures against the recoverable $88,400 and keeps its own name')
    : bad('the concentration basis changed', String(panel.concentrationBasis));

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
