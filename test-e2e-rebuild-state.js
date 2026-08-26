'use strict';
/**
 * test-e2e-rebuild-state.js — the recovery button has to recover something.
 *
 *   node test-e2e-rebuild-state.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * "↺ Rebuild Reconciliation State" is the action offered when the Data
 * Integrity panel finds a problem. Clicking it did nothing at all on any
 * property that actually had results to rebuild:
 *
 *     renderProperty(prop);
 *     if (snapshot exists) restoreResults(prop);   <- no such function
 *
 * renderProperty IS the restore path — it reads the snapshot, re-hydrates the
 * invoicesFull that the save boundary strips, and calls restoreResultsDisplay.
 * The line after it was a second name for that same job, and a ReferenceError
 * every time the guard was true. The modal closed, so it LOOKED like something
 * had happened; the confirmation banner never ran, because the throw came
 * first. A recovery action that silently does nothing is worse than none: it
 * spends the one thing a person has left when they think their data is wrong.
 *
 * WHY THIS TEST CLICKS
 *
 * The function is reachable only through an onclick attribute on a button that
 * renders only when checkIntegrity finds an issue. Every layer between a unit
 * test and the user — does the panel render, does the button appear, does the
 * handler resolve — is a layer this defect lived in.
 *
 * AND IT CHECKS THE DOLLARS. A rebuild that wipes the results would pass a test
 * that only looked for the banner.
 *
 * DETERMINISM
 * Fixed timezone, fixed fixture, own port and localStorage key, no network egress.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';
let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-rebuild-state: playwright is not installed.\x1b[0m');
      console.error('This suite clicks a real button in a real browser and cannot verify');
      console.error('anything without one. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-rebuild-state SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The recovery action was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7977', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(34) + ':', typeof v === 'string' ? v : JSON.stringify(v));

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const p = path.join(ROOT, req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]);
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

const PROP_ID = 'rb-prop-000000000001';
const TENANTS = [
  { id: 'rb-t-alder', tenant_name: 'Alder Hardware', leased_sqft: 24000,
    lease_type: 'Triple Net (NNN)', start_date: '2019-01-01', end_date: '2030-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'rb-t-briar', tenant_name: 'Briar Optical',  leased_sqft: 10000,
    lease_type: 'Triple Net (NNN)', start_date: '2020-01-01', end_date: '2029-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'rb-t-cedar', tenant_name: 'Cedar Stationers', leased_sqft: 6000,
    lease_type: 'Triple Net (NNN)', start_date: '2021-01-01', end_date: '2028-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
];
const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
// The last invoice carries no category, which is integrity issue #3
// (orphaned_invoices) — the panel needs at least one finding for the button to
// render at all, and this is the mildest one that does it.
const INVOICES = [
  { id: 'rb-i-01', vendorName: 'Halden Janitorial',  amount: '15000', category: 'janitorial',  invoiceDate: '2026-02-01', camEligible: true, ...doc('hal') },
  { id: 'rb-i-02', vendorName: 'Ivory Insurance',    amount: '12000', category: 'insurance',   invoiceDate: '2026-01-10', camEligible: true, ...doc('ivo') },
  { id: 'rb-i-03', vendorName: 'Marlow Landscaping', amount: '10000', category: 'landscaping', invoiceDate: '2026-05-04', camEligible: true, ...doc('mar') },
  { id: 'rb-i-04', vendorName: 'Voss Utilities',     amount:  '3000', category: '',            invoiceDate: '2026-11-02', camEligible: true, ...doc('vos') },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID='rb-user', _user={id:USER_ID,email:'rb@e2e-test.local'}, _session=null, KEY='__rb_store';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Rushmere Green',sqft:40000,
    data:{invoices:${JSON.stringify(INVOICES)},disputes:[],camYear:2026,results:null,camReconciliation:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(TENANTS)}}}],tenants:[]};
  function load(){try{var r=localStorage.getItem(KEY);if(r)return JSON.parse(r);}catch(e){}return JSON.parse(JSON.stringify(seed));}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(_store));}catch(e){}}
  var _store=load(); window.__store=function(){return _store;};
  function res(d){return Promise.resolve({data:d,error:null});} var _seq=0;
  function table(name){var rows=_store[name]||(_store[name]=[]);var last=null;var api={
    select:function(){last=null;return api;},eq:function(){return api;},not:function(){return api;},
    is:function(){return api;},in:function(){return api;},order:function(){return api;},limit:function(){return api;},
    maybeSingle:function(){return res(last||rows[0]||null);},single:function(){return res(last||rows[0]||null);},
    insert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);rows.push(row);return row;});last=a[0];persist();return api;},
    upsert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);var i=rows.findIndex(function(x){return x.id===row.id;});if(i>=0){rows[i]=Object.assign({},rows[i],row);persist();return rows[i];}rows.push(row);return row;});last=a[0];persist();return api;},
    update:function(v){rows.forEach(function(r){Object.assign(r,JSON.parse(JSON.stringify(v)));});last=rows[0];persist();return api;},
    delete:function(){return api;},
    then:function(f){return Promise.resolve({data:last?[last]:rows,error:null}).then(f);}};return api;}
  window.supabase = { createClient: function () { return {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: _session }, error: null }); },
      getUser:    function () { return Promise.resolve({ data: { user: _session ? _user : null }, error: null }); },
      signInWithPassword: function () { _session={access_token:'mock',user:_user};
        return Promise.resolve({ data: { session:_session, user:_user }, error: null }); },
      signUp:  function () { return Promise.resolve({ data: { user: _user }, error: null }); },
      signOut: function () { _session=null; return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    },
    from: table,
    storage: { from: function () { return { upload: function(){return res({path:'m'});},
      createSignedUrl: function(){return res({signedUrl:'https://mock.local/x'});} }; } },
  }; } };
})();
`;

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    return route.abort();
  });
  await ctx.addInitScript(SUPABASE_MOCK);

  console.log('\n══ The recovery action rebuilds, and says so ══');

  // Options as the THIRD argument — waitForFunction is (fn, arg, options), and
  // passing {timeout} second hands it to the page function as data.
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
  await page.fill('#loginEmail', 'rb@e2e-test.local');
  await page.fill('#loginPassword', 'TestPass123!');
  await page.click('#loginBtn');
  await page.waitForFunction(() => { const a = document.getElementById('appContent');
    return a && a.style.display !== 'none' && a.style.display !== ''; }, null, { timeout: 45000 });
  await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction(() => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === 3,
                             null, { timeout: 45000 });
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 3,
                             null, { timeout: 45000 });
  await page.evaluate(async () => { await savePropertyData(); await savePropertyNow(); });

  // WHAT IS ON SCREEN, read without assuming WHICH renderer drew it. The fresh
  // run and the restored view do not produce the same markup — the fresh one
  // builds table rows, the restore builds cards — and that difference is its own
  // finding. What this suite is entitled to insist on is that after a rebuild
  // every tenant is still named and still carries the same figure.
  const onScreen = () => page.evaluate(() => {
    const body = document.getElementById('resultsBody');
    const text = (body ? body.textContent : '').replace(/\s+/g, ' ');
    const per  = (typeof lastResults !== 'undefined' ? lastResults : [])
      .map(r => ({ name: r.name, amount: r.totalAllocated }));
    return { text, per, total: per.reduce((s, r) => s + (r.amount || 0), 0),
             empty: /No CAM allocation has been run yet/.test(text) };
  });
  const money = n => '$' + Number(n).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const showsEveryTenant = st => st.per.length > 0
    && st.per.every(r => st.text.includes(r.name) && st.text.includes(money(r.amount)));

  const before = await onScreen();
  R('tenants',   before.per.map(r => r.name));
  R('allocated', before.per.map(r => money(r.amount)));
  yes('the reconciliation is on screen to begin with',
      before.per.length === 3 && showsEveryTenant(before) && !before.empty,
      JSON.stringify({ per: before.per, empty: before.empty }));

  console.log('\n── The Data Integrity panel offers the action ──');
  const panel = await page.evaluate(() => {
    openRecoveryModal();
    const modal = document.getElementById('recoveryModal');
    const btns  = [...(modal ? modal.querySelectorAll('button') : [])].map(b => b.textContent.trim());
    return {
      open:    !!modal && modal.style.display !== 'none',
      issues:   checkIntegrity(_props.find(p => p.id === activePropId)).map(i => i.type),
      messages: checkIntegrity(_props.find(p => p.id === activePropId)).map(i => i.message),
      // The invariant that replaced it: allocating MORE than came in is a real
      // integrity error, and must still be caught.
      overAllocated: (() => {
        const prop = _props.find(p => p.id === activePropId);
        const rec  = prop.camReconciliation ?? prop.results;
        const fake = { ...prop, camReconciliation: { ...rec, total: 100 } };
        return checkIntegrity(fake).map(i => i.type);
      })(),
      buttons: btns,
    };
  });
  R('integrity issues', panel.issues);
  yes('the panel opened', panel.open, JSON.stringify(panel.open));
  yes('it found something to report — otherwise the button never renders',
      panel.issues.length > 0, JSON.stringify(panel.issues));
  // The finding it must NOT report. checkIntegrity summed `tenantShare`, a field
  // no reconciliation row carries, and compared it for EQUALITY against the
  // gross expense pool — which allocations fall short of whenever a suite is
  // vacant or an invoice is not CAM-eligible. Every reconciled property
  // therefore carried a permanent integrity ERROR reading "Allocated total
  // ($0.00) differs from declared total". The panel cried wolf, and the only
  // recovery action on it sat underneath.
  yes('    and it does NOT invent an allocation mismatch on a clean run',
      !panel.issues.includes('allocation_mismatch'),
      JSON.stringify(panel.messages));
  yes('and the rebuild button is on screen',
      panel.buttons.some(b => /Rebuild Reconciliation State/.test(b)), JSON.stringify(panel.buttons));

  yes('    but an allocation LARGER than the pool is still an error',
      panel.overAllocated.includes('allocation_mismatch'),
      JSON.stringify(panel.overAllocated));

  // BREAK THE SCREEN FIRST. Until this was here the suite proved only that the
  // click did no harm: the results were already rendered from the fresh run, so
  // removing renderProperty(prop) from the handler altogether still passed. The
  // situation the button exists for is a view that has diverged from the stored
  // record, so put the page in that state and make the click be the thing that
  // fixes it.
  console.log('\n── The screen is wiped, the saved record is not ──');
  await page.evaluate(() => {
    document.getElementById('resultsBody').innerHTML = '<div>WIPED</div>';
    lastResults = [];
  });
  const wiped = await onScreen();
  yes('the reconciliation is off the screen',
      /WIPED/.test(wiped.text) && wiped.per.length === 0, JSON.stringify(wiped.per));

  console.log('\n── The click ──');
  const errorsBefore = errors.length;
  // THE ACTUAL BUTTON. The handler is an onclick attribute; calling the
  // function from the console would skip the two layers the defect lived in.
  await page.click('#recoveryModal button:has-text("Rebuild Reconciliation State")');
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => {
    const banner = [...document.querySelectorAll('div')]
      .map(d => d.textContent || '')
      .filter(t => t.length < 120 && /Reconciliation state rebuilt/.test(t));
    return {
      modalOpen: (() => { const m = document.getElementById('recoveryModal');
                          return !!m && m.style.display !== 'none'; })(),
      banner:    banner.length > 0,
    };
  });
  const newErrors = errors.slice(errorsBefore);
  R('page errors raised by the click', newErrors);
  R('confirmation banner',             after.banner);

  yes('THE HANDLER RAN TO THE END — no ReferenceError',
      newErrors.length === 0, newErrors.join(' | '));
  yes('    and it confirmed what it did',
      after.banner === true,
      'the modal closed and nothing told the reader whether anything happened');
  yes('    the modal is closed',
      after.modalOpen === false, JSON.stringify(after.modalOpen));

  console.log('\n── And the reconciliation is still there, unchanged ──');
  const rebuilt = await onScreen();
  R('tenants',   rebuilt.per.map(r => r.name));
  R('allocated', rebuilt.per.map(r => money(r.amount)));
  yes('THE CLICK PUT IT BACK — from the saved record, not from a re-run',
      !/WIPED/.test(rebuilt.text) && !rebuilt.empty
        && rebuilt.per.length === before.per.length,
      JSON.stringify({ wiped: /WIPED/.test(rebuilt.text), rows: rebuilt.per.length }));
  yes('    every tenant is still named on screen, with its figure',
      showsEveryTenant(rebuilt), JSON.stringify(rebuilt.per));
  yes('    and the dollars are identical — a rebuild is not a re-run',
      Math.abs(rebuilt.total - before.total) < 0.005
        && JSON.stringify(rebuilt.per) === JSON.stringify(before.per),
      JSON.stringify({ before: before.per, after: rebuilt.per }));

  console.log('\n── Console ──');
  yes('no uncaught page errors anywhere in the flow',
      errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + '─'.repeat(58));
  if (fail) console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  else      console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n\x1b[31mtest-e2e-rebuild-state crashed:\x1b[0m', e && e.stack || e);
  process.exit(1);
});
