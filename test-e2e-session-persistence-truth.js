// test-e2e-session-persistence-truth.js
// ============================================================================
// A 401 IS EVIDENCE, NOT PROOF — AND HISTORY MEANS THE SERVER HAS IT.
//
// Both defects were found by walking the Pilot in a real browser, and neither
// was visible to the suites: one is a race, the other is two surfaces reading
// two different facts about one save.
//
// 1 · "YOUR SESSION EXPIRED", WITH THE SESSION STILL ALIVE.
//     _authHeaders refreshes when the token is inside 60 seconds of expiry. It
//     returned {} when that refresh came back empty — so the request went out
//     with NO Authorization header, the server answered 401 exactly as it
//     should, and _fetchWithTimeout read the client's own omission as proof the
//     session had gone. Supabase ROTATES refresh tokens and a CAM run fires
//     savePropertyData, syncPortfolioEntry and saveCamResults within
//     milliseconds, so concurrent refreshes race and the losers get nothing.
//     Fixed in two places: refreshes are single-flight, and a failed refresh
//     falls back to the token still in hand rather than to no token at all.
//     _onAuthLost now asks the auth authority before telling anyone their
//     session expired.
//
// 2 · A RUN THAT WAS NEVER SAVED, LISTED AS SAVED HISTORY.
//     camRuns.unshift() records the run hundreds of lines before saveCamResults
//     is called, and renderPreviousRuns reads that array and nothing else. So a
//     refused save produced "These CAM results weren't saved to the server" and,
//     below it, the same run under Previous Runs badged Latest — measured with
//     0 rows actually on the server. Runs now carry `persisted`, stamped false
//     at creation and set only by a confirmed save, and Previous Runs shows
//     only runs the server actually holds.
//
// THE FIXTURES DISTINGUISH THE TWO FAILURES THAT LOOK ALIKE. A dead session and
// a transient 401 both surface as HTTP 401; what separates them is what the auth
// authority says afterwards, so every auth fixture asserts BOTH the banner and
// the live session state. And the persistence fixtures assert what reached the
// server, never what the screen says.
//
// Run: node test-e2e-session-persistence-truth.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8957;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label, extra) => (got === want)
  ? ok(label)
  : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}${extra ? ' · ' + extra : ''}`);

// A Supabase mock whose session validity, refresh behaviour and delete calls
// are all observable — the three things these defects turn on.
const DB = `
(function(){
  var U={id:'sp-user',email:'pm@example.com'};
  var SESSION={ user:U, access_token:'good-token', expires_at: Math.floor(Date.now()/1000)+30 };
  window.__t={ refreshFail:false, refreshCalls:0, sessionValid:true, camDeletes:0, refreshDelayMs:0 };
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
      match:function(){return P({data:[],error:null});},
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
      delete:function(){ if(name==='cam_reconciliations') window.__t.camDeletes++;
        return {eq:function(){return P({error:null});},match:function(){return P({error:null});}};},
      then:function(f){return run().then(f);}};
    function run(){var rows=tbl(name).filter(function(r){return filters.every(function(f){return r[f[0]]===f[1];});});
      if(single)return P(rows.length?{data:rows[0],error:null}:{data:null,error:{message:'no rows'}});
      return P({data:rows,error:null});}
    return api;}
  window.supabase={createClient:function(){return {auth:{
    getUser:function(){return P({data:{user: window.__t.sessionValid ? U : null},error:null});},
    getSession:function(){return P({data:{session: window.__t.sessionValid ? SESSION : null},error:null});},
    refreshSession:function(){ window.__t.refreshCalls++;
      var fail=window.__t.refreshFail, d=window.__t.refreshDelayMs||0;
      return new Promise(function(res){ setTimeout(function(){
        res(fail ? {data:{session:null},error:{message:'rate limited'}} : {data:{session:SESSION},error:null});
      }, d); });},
    onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:U});},40);return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return P({error:null});}
  },rpc:function(){return P({data:null,error:null});},
    from:function(n){return q(n);},
    storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;

const MAPLE = `(async () => {
  const prop = { id: 'maple-plaza', name: 'Maple Plaza', totalSqft: 20000,
    status: 'in-progress', tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
    createdAt: new Date().toISOString(),
    tenants: [
      { tenant_name: 'Tenant A', leased_sqft: 8000, start_date: '2020-01-01', end_date: '2030-12-31',
        lease_type: 'NNN', cap: null, id: 'mp-t1', flags: [], confidence: {} },
      { tenant_name: 'Tenant B', leased_sqft: 6000, start_date: '2020-01-01', end_date: '2030-12-31',
        lease_type: 'NNN', cap: null, id: 'mp-t2', flags: [], confidence: {} },
    ],
    invoices: [
      { id: 'mp-1', vendorName: 'Acme Landscaping', category: 'landscaping', amount: 40000, invoiceDate: '2026-04-12' },
      { id: 'mp-2', vendorName: 'Talon Security',   category: 'security',    amount: 20000, invoiceDate: '2026-05-03' },
    ],
    disputes: [], activityLog: [], timeline: [] };
  _props.push(prop);
  await saveProperty(prop);
  await selectProperty(prop.id);
  await new Promise(r => setTimeout(r, 2700));
  setCamYear('2026');
  await new Promise(r => setTimeout(r, 800));
  window.switchWorkspaceTab && window.switchWorkspaceTab('cam');
  await new Promise(r => setTimeout(r, 1500));
})()`;

const RUN_CAM = `(async () => {
  const vis = e => { if (!e) return false; const r = e.getBoundingClientRect();
    return getComputedStyle(e).display !== 'none' && r.height > 2; };
  const btn = [...document.querySelectorAll('button')].filter(vis)
    .find(b => /calculate cam charges/i.test(b.innerText || ''));
  if (!btn) return { error: 'no Calculate button' };
  btn.click();
  await new Promise(r => setTimeout(r, 1700));
  const m = [...document.querySelectorAll('.modal-backdrop,[id$=Modal]')].filter(vis)[0];
  const confirm = m ? [...m.querySelectorAll('button')].filter(vis).find(b => /confirm/i.test(b.innerText || '')) : null;
  if (confirm) confirm.click();
  await new Promise(r => setTimeout(r, 5200));
  const warn = document.getElementById('camSaveWarningBanner');
  const prevSec = document.getElementById('previousRunsSection');
  const prevList = document.getElementById('previousRunsList');
  return {
    camRuns: camRuns.length,
    persistedFlags: camRuns.map(r => r.persisted),
    warnVisible: !!(warn && warn.style.display !== 'none' && (warn.textContent || '').trim()),
    prevVisible: !!(prevSec && prevSec.style.display !== 'none'),
    prevText: prevList ? (prevList.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : '',
    serverRows: (JSON.parse(localStorage.getItem('__mockdb') || '{}')['cam_reconciliations'] || []).length,
    resultsOnScreen: document.querySelectorAll('#resultsBody .result-card').length,
  };
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

  // An honest server: no bearer token -> 401; a token -> it writes the rows.
  // camWrites lets a fixture force a refusal or an empty write.
  let camMode = 'ok';
  let camRowsWritten = 0;   // what the SERVER actually stored, counted here
  let camDelayMs = 0;       // hold the response open so the in-flight state is observable
  await p.route('**/api/**', (route) => {
    const url  = route.request().url();
    const auth = route.request().headers()['authorization'];
    if (!auth) return route.fulfill({ status: 401, contentType: 'application/json',
                                      body: JSON.stringify({ error: 'Authentication required' }) });
    if (/cam-reconciliations/.test(url)) {
      if (camDelayMs) { const d = camDelayMs; camDelayMs = 0;
        return new Promise(res => setTimeout(res, d)).then(() => route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 1 }] }) })); }
      if (camMode === '401') return route.fulfill({ status: 401, contentType: 'application/json',
                                     body: JSON.stringify({ error: 'Invalid or expired token' }) });
      if (camMode === 'empty') return route.fulfill({ status: 200, contentType: 'application/json',
                                     body: JSON.stringify({ data: [] }) });
      let rows = [];
      try { rows = JSON.parse(route.request().postData() || '{}').rows || []; } catch (_) {}
      camRowsWritten += rows.length;
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify({ data: rows.map((r, i) => ({ ...r, id: i + 1 })) }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);

  // ══ A · A TRANSIENT REFRESH FAILURE IS NOT AN EXPIRED SESSION ═══════════
  sec('A · a refresh that fails while the session is alive');
  const A = await p.evaluate(async () => {
    window.__t.refreshFail = true;                 // token is 30s out, so refresh runs
    const hdrs = await _authHeaders();
    const resp = await _fetchWithTimeout('/api/cam-reconciliations', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...hdrs }, body: '{}' });
    await new Promise(r => setTimeout(r, 500));
    const sess = await db.auth.getSession();
    return { sentAuth: !!hdrs.Authorization, status: resp.status,
             banner: !!document.getElementById('msAuthLostBanner'),
             sessionAlive: !!(sess.data && sess.data.session) };
  });
  is(A.sentAuth, true,  'the request still carries an Authorization header');
  is(A.status,   200,   'so the server accepts it instead of refusing it');
  is(A.banner,   false, 'and no "session expired" banner is raised', 'THE REPORTED DEFECT');
  is(A.sessionAlive, true, 'the session was alive throughout');

  // ══ B · REFRESHES ARE SINGLE-FLIGHT ════════════════════════════════════
  sec('B · concurrent callers share one refresh');
  const B = await p.evaluate(async () => {
    window.__t.refreshFail = false;
    window.__t.refreshDelayMs = 60;                // widen the race window
    window.__t.refreshCalls = 0;
    await Promise.all([_authHeaders(), _authHeaders(), _authHeaders(),
                       _authHeaders(), _authHeaders(), _authHeaders()]);
    window.__t.refreshDelayMs = 0;
    return { calls: window.__t.refreshCalls };
  });
  is(B.calls, 1, 'six concurrent callers cause exactly one refreshSession call',
     'unserialised refreshes race, and Supabase rotates the refresh token');

  // ══ C · A 401 WITH A LIVE SESSION RESCUES WORK WITHOUT CLAIMING EXPIRY ══
  sec('C · a 401 the client caused for itself');
  const C = await p.evaluate(async () => {
    _lsUserId = 'sp-user';
    _props.push({ id: 'rescue-1', name: 'Rescue Court', totalSqft: 1000, invoices: [], tenants: [] });
    localStorage.removeItem('_ms_props_v2_sp-user');
    await window._onAuthLost('transient-test');
    const stored = JSON.parse(localStorage.getItem('_ms_props_v2_sp-user') || '{}');
    return { banner: !!document.getElementById('msAuthLostBanner'),
             rescued: Object.keys(stored).includes('rescue-1'),
             propsKept: _props.length > 0 };
  });
  is(C.banner,  false, 'no expiry is announced while the session is live');
  is(C.rescued, true,  'the work is still written to disk');
  is(C.propsKept, true, 'and in-memory work is untouched');

  // ══ D · A GENUINELY DEAD SESSION STILL REPORTS EXPIRY ══════════════════
  sec('D · a session that really is gone');
  const D = await p.evaluate(async () => {
    window.__t.sessionValid = false;
    window._authLostHandled = false;
    await window._onAuthLost('dead-test');
    const bn = document.getElementById('msAuthLostBanner');
    window.__t.sessionValid = true;
    return { banner: !!bn, text: bn ? (bn.innerText || '').replace(/\s+/g, ' ') : '' };
  });
  is(D.banner, true, 'the expired-session banner IS raised when the session is gone');
  /session expired/i.test(D.text) ? ok('and it says the session expired')
                                  : bad('wording changed', D.text);
  /saved on this device/i.test(D.text) ? ok('and that the work is saved on this device')
                                       : bad('rescue wording changed', D.text);
  await p.evaluate(() => { const b = document.getElementById('msAuthLostBanner');
                           if (b) b.remove(); window._authLostHandled = false; });

  // ══ E · A REFUSED CAM SAVE IS NOT HISTORY ══════════════════════════════
  sec('E · a CAM save the server refuses');
  await p.evaluate(MAPLE);
  camMode = '401';
  const E1 = await p.evaluate(RUN_CAM);
  const E2 = await p.evaluate(RUN_CAM);      // Previous Runs needs a second run
  is(camRowsWritten, 0, 'nothing reached the server');
  is(E2.warnVisible, true, 'the unsaved warning is shown');
  is(E2.prevVisible, false, 'and Previous Runs does NOT list the run', 'THE REPORTED CONTRADICTION');
  is(E2.persistedFlags.every(x => x === false), true, 'every run is marked not-persisted',
     JSON.stringify(E2.persistedFlags));
  (E2.resultsOnScreen > 0) ? ok('the results are still on screen — local work is not destroyed')
                           : bad('the run vanished from the screen', JSON.stringify(E2));
  (E2.camRuns >= 2) ? ok('and still held in memory, recoverable')
                    : bad('camRuns lost the run', String(E2.camRuns));

  // ══ F · A SAVE THAT LANDS IS HISTORY, AND CLEARS THE WARNING ═══════════
  sec('F · the same run, saved');
  camMode = 'ok';
  const Fa = await p.evaluate(RUN_CAM);
  (camRowsWritten > 0) ? ok(`the rows reached the server (${camRowsWritten})`)
                       : bad('nothing persisted on the happy path', JSON.stringify(Fa));
  is(Fa.warnVisible, false, 'the stale "weren\'t saved" warning is cleared', 'it used to outlive the failure');
  is(Fa.persistedFlags[0], true, 'the run is marked persisted');
  // A persisted run is history only once a later run sits above it — camRuns[0]
  // is always the run on screen, never its own history.
  const Fb = await p.evaluate(RUN_CAM);
  is(Fb.prevVisible, true, 'a second successful run puts the first under Previous Runs');
  /Maple Plaza/.test(Fb.prevText) ? ok('and it is the run that actually saved: ' + Fb.prevText.slice(0, 60))
                                  : bad('Previous Runs shows the wrong run', Fb.prevText);

  // ══ J · THE FLAG EXISTS BEFORE THE SAVE DOES ═══════════════════════════
  // The flag is re-stamped from the save result, which hides its starting
  // value from every fixture that only looks afterwards. If the run were
  // recorded with no flag at all, an absent flag reads as persisted — and any
  // path that aborts between recording the run and stamping it (a throw in the
  // property save, a closed tab) would leave a never-saved run looking like
  // history. Hold the response open and look while the save is still in flight.
  sec('J · a run is marked not-persisted the moment it is recorded');
  camMode = 'ok';
  camDelayMs = 3500;
  const J = await p.evaluate(async () => {
    const vis = e => { if (!e) return false; const r = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && r.height > 2; };
    const btn = [...document.querySelectorAll('button')].filter(vis)
      .find(b => /calculate cam charges/i.test(b.innerText || ''));
    if (!btn) return { error: 'no Calculate button' };
    btn.click();
    await new Promise(r => setTimeout(r, 1700));
    const m = [...document.querySelectorAll('.modal-backdrop,[id$=Modal]')].filter(vis)[0];
    const confirm = m ? [...m.querySelectorAll('button')].filter(vis).find(b => /confirm/i.test(b.innerText || '')) : null;
    if (confirm) confirm.click();
    // sample while the save is still open
    await new Promise(r => setTimeout(r, 2200));
    const midFlight = camRuns.length ? camRuns[0].persisted : 'no-run';
    await new Promise(r => setTimeout(r, 5000));   // let it settle
    return { midFlight, after: camRuns.length ? camRuns[0].persisted : 'no-run' };
  });
  if (J.error) bad('in-flight fixture', J.error);
  else {
    is(J.midFlight, false, 'while the save is in flight the run is explicitly NOT persisted',
       'an absent flag would read as persisted');
    is(J.after, true, 'and it becomes persisted once the save confirms');
  }

  // ══ K · A LEGACY RUN WITH NO FLAG IS STILL HISTORY ═════════════════════
  // Every property already in Pilot has camRuns saved before this field
  // existed. Those runs came back from the server, so absent must read as
  // persisted — a predicate demanding `=== true` would erase real history from
  // every existing property at once.
  sec('K · runs saved before the flag existed are not erased');
  const K = await p.evaluate(async () => {
    const legacy = (n, yr) => ({ propName: 'Old Mill', camYear: yr,
      timestamp: new Date(Date.now() - n * 86400000).toISOString(),
      totalExpenses: 1000 * n, tenantCount: 1, invoiceCount: 2,
      results: [{ name: 'T1', allocatedAmount: 500, proRata: 0.5, eligibleCount: 2 }],
      sqft: 1000, categories: {}, vendors: {} });   // NOTE: no `persisted` field
    const prop = { id: 'old-mill', name: 'Old Mill', totalSqft: 1000,
      status: 'complete', tenantCount: 1, invoiceCount: 2, totalCAM: 0, openDisputes: 0,
      createdAt: new Date().toISOString(),
      tenants: [{ tenant_name: 'T1', leased_sqft: 500, start_date: '2020-01-01',
                  end_date: '2030-12-31', lease_type: 'NNN', cap: null, id: 'om-t1', flags: [], confidence: {} }],
      invoices: [{ id: 'om-1', vendorName: 'V', category: 'other', amount: 1000, invoiceDate: '2025-01-01' }],
      disputes: [], activityLog: [], timeline: [],
      camReconciliation: { propId: 'old-mill', propName: 'Old Mill', camYear: '2025',
        savedAt: new Date().toISOString(), total: 1000,
        // restoreResultsDisplay needs a real run to restore before it reaches
        // camRuns, so the snapshot carries one.
        results: [{ tenantId: 'om-t1', tenantName: 'T1', name: 'T1', allocatedAmount: 1000,
                    totalAllocated: 1000, actualCam: 1000, proRata: 1, proRataPercent: 100,
                    eligibleCount: 1, sqFt: 500, totalSqFt: 1000, status: 'calculated' }],
        invoices: [{ id: 'om-1', vendor: 'V', vendorName: 'V', category: 'other', amount: 1000 }],
        engineInvoices: [{ id: 'om-1', vendorName: 'V', category: 'other', amount: 1000, invoiceDate: '2025-01-01' }],
        tenants: [{ name: 'T1', leasedSqft: 500, totalSqft: 1000 }],
        camRuns: [legacy(1, '2025'), legacy(2, '2024')] } };
    _props.push(prop);
    await saveProperty(prop);
    await selectProperty('old-mill');
    await new Promise(r => setTimeout(r, 3200));
    window.switchWorkspaceTab && window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1500));
    const sec2 = document.getElementById('previousRunsSection');
    const list = document.getElementById('previousRunsList');
    return {
      runs: camRuns.length,
      flags: camRuns.map(r => r.persisted),
      prevVisible: !!(sec2 && sec2.style.display !== 'none'),
      prevText: list ? (list.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '',
    };
  });
  (K.runs >= 2) ? ok(`the legacy runs restored (${K.runs})`)
                : bad('legacy camRuns did not restore', JSON.stringify(K));
  (K.flags.every(x => x === undefined)) ? ok('and they carry no persisted field, as saved before it existed')
                                        : bad('fixture drifted — a flag appeared', JSON.stringify(K.flags));
  is(K.prevVisible, true, 'Previous Runs still shows them', 'absent must read as persisted');
  /Old Mill/.test(K.prevText) ? ok('and names the right property: ' + K.prevText.slice(0, 50))
                              : bad('legacy history is missing from the panel', K.prevText);

  // ══ I · RELOAD SHOWS WHAT THE SERVER HAS ═══════════════════════════════
  // The persisted flag travels in the property snapshot, so a reload must agree
  // with the save that actually happened rather than re-deciding from scratch.
  sec('I · after a reload, Previous Runs still agrees with the server');
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);
  const I = await p.evaluate(async () => {
    const d = (_props || []).find(x => /Maple Plaza/i.test(x.name || ''));
    if (!d) return { error: 'property gone after reload' };
    await selectProperty(d.id);
    await new Promise(r => setTimeout(r, 3000));
    window.switchWorkspaceTab && window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1500));
    const prevSec = document.getElementById('previousRunsSection');
    const prevList = document.getElementById('previousRunsList');
    const warn = document.getElementById('camSaveWarningBanner');
    return {
      restoredRuns: (typeof camRuns !== 'undefined' ? camRuns : []).length,
      persistedFlags: (typeof camRuns !== 'undefined' ? camRuns : []).map(r => r.persisted),
      prevVisible: !!(prevSec && prevSec.style.display !== 'none'),
      prevText: prevList ? (prevList.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '',
      warnVisible: !!(warn && warn.style.display !== 'none' && (warn.textContent || '').trim()),
    };
  });
  if (I.error) { bad('reload fixture', I.error); }
  else {
    (I.restoredRuns > 0) ? ok(`the run history survived the reload (${I.restoredRuns} runs)`)
                         : bad('camRuns did not restore', JSON.stringify(I));
    // The runs that failed to save are still flagged false after the round-trip,
    // and the ones that saved are still true — the flag is not re-guessed.
    (I.persistedFlags.some(x => x === true)) ? ok('the saved runs are still marked persisted')
                                             : bad('a persisted run lost its flag on reload', JSON.stringify(I.persistedFlags));
    (I.persistedFlags.some(x => x === false)) ? ok('and the refused runs are still marked not-persisted')
                                              : bad('a refused run was silently promoted to persisted', JSON.stringify(I.persistedFlags));
    is(I.warnVisible, false, 'no stale unsaved warning is restored');
  }

  // ══ G · A 200 THAT STORED NOTHING IS NOT A SAVE ════════════════════════
  sec('G · the server answers 200 and stores nothing');
  camMode = 'empty';
  const G = await p.evaluate(RUN_CAM);
  is(G.persistedFlags[0], false, 'a zero-row write is not counted as persisted');
  is(G.warnVisible, true, 'and the user is told it did not save');

  // ══ H · THE CLIENT NEVER PRE-DELETES ═══════════════════════════════════
  sec('H · a failed save must not destroy the previous run');
  const H = await p.evaluate(() => ({ deletes: window.__t.camDeletes }));
  is(H.deletes, 0, 'saveCamResults issues no client-side delete of cam_reconciliations',
     'the API route already does DELETE-then-INSERT under one authorization');

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
