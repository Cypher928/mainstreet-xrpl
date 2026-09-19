// test-e2e-billing-refusal-truth.js
// ============================================================================
// "WHY IT CAN'T BILL" TELLS THE TRUTH IN BOTH STATES.
//
// The tenant card's button reads "Why it can't bill". With a register whose
// invoices carry no source documents, every tenant is blocked by ONE
// property-level finding — 26 of 26 invoices missing source document — and the
// reconciliation is current. The answer to the button must be that blocker,
// from the billing gate that decides it.
//
// That state is set up here rather than inherited from the demo seed. Seed v9
// gives Cascade's register its source documents, so the seeded property is no
// longer blocked; this suite strips them in the page and re-runs, reaching the
// same state through the same code. See undocumentTheRegister below.
//
// Results that are NOT current are a different state and keep their refusal:
// a statement is never produced from them. But that refusal has two reasons —
// the inputs changed after the run, or the saved run carries nothing it can be
// checked against — and it must say which. It used to say "data changed" for
// both.
//
//   A · current + blocked   → the block screen names the property-level blocker;
//                             no stale warning anywhere
//   B · unverifiable        → refused: "cannot be checked …", not "data changed"
//   C · re-run → current    → the block screen is back
//   D · edited after run    → refused: "lease or invoice data changed …"
//
// Run: node test-e2e-billing-refusal-truth.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8971;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const yes = (c, label, d) => c ? ok(label) : bad(label, d);

// A Supabase stand-in whose rows outlive a reload (mirrored into localStorage).
const DB = `
(function(){
  var U={id:'refusal-truth-0001-4000-a000-000000000001',email:'pm@example.com'};
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

const TENANT = 'FitZone Athletics';
const BLOCKER = '26 of 26 invoices missing source document';
// The seed's own version, so a bump is not reported here as a broken fixture.
const SEED_DEMO_VERSION = Number(
  (/const DEMO_VERSION = (\d+);/.exec(fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8')) || [])[1]
);

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
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(DB);

  const boot = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    await page.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
    await page.waitForTimeout(600);
    await page.evaluate(() => loadDemo());
    await page.waitForFunction(() => {
      const el = document.getElementById('mainWorkflow');
      return el && el.style.display !== 'none' && typeof lastResults !== 'undefined' && lastResults.length > 0;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(2000);   // the background load, its merge and the snapshot restore
    await page.evaluate(() => switchWorkspaceTab('cam'));
    await page.waitForTimeout(600);
  };

  // THE SUITE MAKES ITS OWN BLOCKED STATE.
  //
  // This used to lean on the demo seed happening to be blocked: Cascade's 26
  // invoices carried no source documents, so every tenant was held by one
  // property-level finding and the block screen had something to name. Seed v9
  // attaches those documents (assets/demo/invoices), the finding is answered,
  // and the demo is no longer blocked — which is the point of that change and
  // not a regression here.
  //
  // What this suite is about is unchanged: when billing IS refused, the screen
  // must name the reason. So it now creates the condition it tests instead of
  // inheriting it — the documents are stripped from the register in the page
  // and the reconciliation re-run, which is the same state the seed used to
  // ship in, reached through the same code. Nothing about the gate is stubbed:
  // buildAuditSummary raises the finding because the invoices really have no
  // documents, exactly as it did before.
  //
  // Done ONCE, before section A, and deliberately not inside boot(): the
  // stripped register is saved, so it survives the reloads the later sections
  // do, and re-running the allocation on every boot would re-strike the
  // fingerprint that section B goes out of its way to remove.
  const undocumentTheRegister = async () => {
    await page.evaluate(async () => {
      const p = currentProperty();
      (p.invoices || []).forEach(i => { delete i.fileUrl; delete i.fileName; });
      if (typeof invoiceData !== 'undefined') {
        invoiceData.splice(0, invoiceData.length, ...p.invoices);
      }
      await runAllocation();
      // The run is now the current one for this data, so the fingerprint the
      // staleness check compares against is re-struck here rather than left
      // describing the documented register.
      await saveProperty(p);
    });
    await page.waitForTimeout(1500);
  };

  // Press the tenant's card button — the real onclick — and report what happened.
  const PRESS = `(async function (tenant) {
    const seen = [];
    const orig = window.showToast;
    window.showToast = function (m, o) { seen.push(String(m)); return orig ? orig(m, o) : undefined; };
    const btn = Array.from(document.querySelectorAll('.tenant-stmt-card-btn')).find(b => (b.getAttribute('onclick') || '').includes("'" + tenant + "'"));
    const label = btn ? btn.textContent.trim() : null;
    const before = (document.body.innerText.match(/View non-billable draft/g) || []).length;
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 900));
    window.showToast = orig;
    const text = document.body.innerText;
    const banner = document.getElementById('staleResultsBanner');
    return { label, toasts: seen,
             blockScreen: (text.match(/View non-billable draft/g) || []).length > before,
             namesBlocker: text.includes(${JSON.stringify(BLOCKER)}),
             bannerShown: !!banner && getComputedStyle(banner).display !== 'none', bannerText: banner ? banner.textContent.trim() : '',
             stale: _resultsStale, unverified: _resultsUnverified };
  })`;
  const press = () => page.evaluate(`${PRESS}(${JSON.stringify(TENANT)})`);

  // ══ A · current and blocked ════════════════════════════════════════════════
  sec('A · results current, tenant blocked by the property-level gate: the button answers with the blocker');
  await boot();
  await undocumentTheRegister();
  const state = await page.evaluate((t) => {
    const bs = window.tenantBillingState(t);
    return { stale: _resultsStale, unverified: _resultsUnverified, year: lastResultsYear, cam: getCamYear(),
             verdict: bs && { state: bs.state, label: bs.label, propertyLevel: bs.propertyLevel, cta: bs.cta,
                              blockers: (bs.readiness.blockers || []).map(b => b.scope + ': ' + b.title) } };
  }, TENANT);
  is([state.stale, state.unverified], [false, false], 'the seeded reconciliation is current — its fingerprint matches the data on the property');
  is(state.year, state.cam, 'and it is for the year in force');
  is(state.verdict && state.verdict.state, 'blocked', `${TENANT} is blocked`);
  is(state.verdict && state.verdict.blockers, ['property: ' + BLOCKER], '…by exactly one property-level blocker, from the billing gate');
  const A = await press();
  is(A.label, '⛔ Why it can’t bill', 'the card button reads "Why it can’t bill"');
  is(A.toasts, [], 'pressing it raises NO toast — nothing about stale results');
  yes(A.blockScreen && A.namesBlocker, `the block screen opens and names the blocker: "${BLOCKER}"`, JSON.stringify(A));
  yes(!A.bannerShown, 'the stale banner is not shown', A.bannerText);

  // ══ B · a saved run that cannot be checked ═════════════════════════════════
  sec('B · a saved reconciliation with nothing to check it against is refused — and says so, not "data changed"');
  const aged = await page.evaluate(async () => {
    const pr = currentProperty();
    delete pr.camReconciliation.inputsFingerprint;
    delete pr.camReconciliation.engineInvoices;
    await saveProperty(pr);
    await new Promise(r => setTimeout(r, 800));
    const row = (JSON.parse(localStorage.getItem('__mockdb') || '{}').properties || []).find(r => r.id === DEMO_PROPERTY_ID);
    return { fp: !!(row.data.camReconciliation && row.data.camReconciliation.inputsFingerprint), v: row.data._demoV };
  });
  // READ FROM THE SEED, NOT WRITTEN DOWN HERE. This asserted `v: 8` and so
  // failed the first time the seed was bumped, reporting a version change as a
  // fingerprint failure. What the fixture needs is that the row was NOT
  // re-seeded — that its version is still whatever the seed currently is.
  is(aged, { fp: false, v: SEED_DEMO_VERSION }, 'fixture: the stored run carries no fingerprint (and the demo is not re-seeded over it)');
  await boot();
  const Bs = await page.evaluate(() => ({ stale: _resultsStale, unverified: _resultsUnverified }));
  is(Bs, { stale: true, unverified: true }, 'restored: the run is not treated as current, because it cannot be checked');
  const B = await press();
  is(B.label, '⛔ Why it can’t bill', 'the button still reads "Why it can’t bill" (billing state is read off the run)');
  is(B.toasts.length, 1, 'pressing it is refused with one toast');
  yes(/cannot be checked against the current lease and invoice data/.test(B.toasts[0] || ''), 'which says the run cannot be checked', B.toasts[0]);
  yes(!/data changed since the last run/.test(B.toasts[0] || ''), '…and does NOT claim that data changed', B.toasts[0]);
  yes(/Re-run the reconciliation/.test(B.toasts[0] || ''), '…and says a re-run is what issues a statement', B.toasts[0]);
  yes(!B.blockScreen, 'no block screen is opened from stale results — the refusal stands', JSON.stringify(B));
  yes(B.bannerShown && /cannot be checked/.test(B.bannerText), 'the banner says the same thing', B.bannerText);

  // ══ C · re-run: current again, and the blocker is back ═════════════════════
  sec('C · a re-run makes the results current, and the button answers with the blocker again');
  const rerun = await page.evaluate(async () => {
    await window.runAllocation();
    await new Promise(r => setTimeout(r, 3400));
    return { stale: _resultsStale, unverified: _resultsUnverified, cards: document.querySelectorAll('#resultsBody .result-card').length };
  });
  is([rerun.stale, rerun.unverified], [false, false], 'after the run the results are current');
  const C = await press();
  is(C.toasts, [], 'no stale toast');
  yes(C.blockScreen && C.namesBlocker, 'the block screen names the property-level blocker', JSON.stringify(C));

  // ══ D · an edit after the run ══════════════════════════════════════════════
  sec('D · an input edited after the run: refused, and it says the data changed');
  const edited = await page.evaluate(() => {
    const i = tenantData.findIndex(t => t && t.tenant_name === 'FitZone Athletics');
    handleFieldBlur(i, 'leased_sqft', '6900', null);      // the real edit path
    return { stale: _resultsStale, unverified: _resultsUnverified };
  });
  is(edited, { stale: true, unverified: false }, 'the edit marks the results stale (not unverifiable)');
  const D = await press();
  is(D.toasts.length, 1, 'pressing the button is refused with one toast');
  yes(/lease or invoice data changed since the last run/.test(D.toasts[0] || ''), 'which says the data changed since the run', D.toasts[0]);
  yes(!/cannot be checked/.test(D.toasts[0] || ''), '…and does not claim the run is unverifiable', D.toasts[0]);
  yes(!D.blockScreen, 'no block screen from stale results', JSON.stringify(D));
  yes(D.bannerShown && /edited since the last run/.test(D.bannerText), 'the banner agrees', D.bannerText);

  sec('E · quiet page');
  is(errs, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
