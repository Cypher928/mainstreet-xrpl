'use strict';
/**
 * test-cam-year-authority.js — WHOSE CAM YEAR IS IT?
 *
 *   node test-cam-year-authority.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * `_camYear` is one module-level global, hydrated from a per-USER localStorage
 * key and defaulting to the current calendar year. Selecting a property did not
 * touch it, so the year in force was whatever the last property — or the last
 * session, or simply the calendar — happened to leave there.
 *
 * Measured on a fresh property carrying twelve 2025 invoices and two undated
 * ones, opened with the preference sitting on 2026:
 *
 *     CAM year in force   2026
 *     dated invoices kept 0 of 12
 *     undated kept        2
 *     result              $8,280.00 allocated from a $217,900.00 pool
 *
 * Every figure on that screen was internally consistent. Nothing said the year
 * was wrong. A manager would have read it as a light CAM year.
 *
 * THE MODEL THIS ASSERTS
 *
 *   The CAM year belongs to the PROPERTY. properties.data.camYear already had a
 *   reader in loadPropertyData and a slot in saveProperty and no assignment
 *   anywhere in the codebase — the only `.camYear =` in the file was on the
 *   throwaway engine Property — so it round-tripped as null forever. A run now
 *   stamps it and selecting the property adopts it.
 *
 *   The localStorage preference keeps its old job for a property that has never
 *   been reconciled. That is the honest role for a UI default: a starting point,
 *   not an authority.
 *
 * DETERMINISM
 * Fixed timezone, fixed fixture, own port and localStorage key, no egress.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';
let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-cam-year-authority: playwright is not installed.\x1b[0m');
      console.error('This suite drives a real property selection in a browser and cannot');
      console.error('verify anything without one. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-cam-year-authority SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Which CAM year a reconciliation runs for was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7993', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(38) + ':', typeof v === 'string' ? v : JSON.stringify(v));

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

// The property states its own CAM year. The user's stored preference will be set
// to a different one before the page is opened, so whichever wins is visible.
const PROP_ID   = 'cy-prop-000000000001';
const PROP_YEAR = 2025;
const PREF_YEAR = 2028;   // not a year any invoice is dated in, and not "now"

const TENANTS = [
  { id: 'cy-t-1', tenant_name: 'Marlowe Books', leased_sqft: 5000, lease_type: 'Triple Net (NNN)',
    start_date: '2018-01-01', end_date: '2032-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
];
const INVOICES = [
  { id: 'cy-i-1', vendorName: 'Ashcombe Janitorial', amount: '20000', category: 'janitorial',
    invoiceDate: '2025-03-11', camEligible: true, fileName: 'a.pdf', fileUrl: 'https://mock.local/a.pdf' },
  { id: 'cy-i-2', vendorName: 'Verity Insurance',    amount: '10000', category: 'insurance',
    invoiceDate: '2025-07-22', camEligible: true, fileName: 'b.pdf', fileUrl: 'https://mock.local/b.pdf' },
];

// A SECOND PROPERTY THAT HAS NEVER BEEN RECONCILED. Its camYear is null, so
// there is nothing for selectProperty to adopt and the preference legitimately
// stands — which is the only fixture that can prove runAllocation STAMPS the
// year rather than merely echoing one that was already in the blob.
const PROP2_ID = 'cy-prop-000000000002';
const TENANTS2 = [
  { id: 'cy2-t-1', tenant_name: 'Ferris Hardware', leased_sqft: 4000, lease_type: 'Triple Net (NNN)',
    start_date: '2017-01-01', end_date: '2033-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
];
const INVOICES2 = [
  { id: 'cy2-i-1', vendorName: 'Dunmore Security', amount: '8000', category: 'security',
    invoiceDate: `${PREF_YEAR}-05-06`, camEligible: true, fileName: 'c.pdf', fileUrl: 'https://mock.local/c.pdf' },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID='cy-user', _user={id:USER_ID,email:'cy@e2e-test.local'}, _session=null, KEY='__cy_store';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Calder Yard',sqft:10000,
    data:{invoices:${JSON.stringify(INVOICES)},disputes:[],camYear:${PROP_YEAR},results:null,camReconciliation:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(TENANTS)}}},
    {id:${JSON.stringify(PROP2_ID)},user_id:USER_ID,name:'Ferris Row',sqft:8000,
    data:{invoices:${JSON.stringify(INVOICES2)},disputes:[],camYear:null,results:null,camReconciliation:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(TENANTS2)}}}],tenants:[]};
  function load(){try{var r=localStorage.getItem(KEY);if(r)return JSON.parse(r);}catch(e){}return JSON.parse(JSON.stringify(seed));}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(_store));}catch(e){}}
  var _store=load(); window.__store=function(){return _store;};
  function res(d){return Promise.resolve({data:d,error:null});} var _seq=0;
  // THIS MOCK HONOURS eq(). The shared one in the other suites does not, and a
  // second property is exactly where that stops being harmless: loadPropertyData
  // for property 2 came back holding property 1's blob, so the suite waited out
  // its timeout for tenants that were never going to arrive.
  function table(name){var rows=_store[name]||(_store[name]=[]);var last=null;var filters=[];var api={
    sel:function(){return rows.filter(function(r){return filters.every(function(f){
      return String(r[f[0]])===String(f[1]);});});},
    select:function(){last=null;return api;},
    eq:function(c,v){filters.push([c,v]);return api;},not:function(){return api;},
    is:function(){return api;},in:function(){return api;},order:function(){return api;},limit:function(){return api;},
    maybeSingle:function(){return res(last||api.sel()[0]||null);},single:function(){return res(last||api.sel()[0]||null);},
    insert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);rows.push(row);return row;});last=a[0];persist();return api;},
    upsert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);var i=rows.findIndex(function(x){return x.id===row.id;});if(i>=0){rows[i]=Object.assign({},rows[i],row);persist();return rows[i];}rows.push(row);return row;});last=a[0];persist();return api;},
    update:function(v){rows.forEach(function(r){Object.assign(r,JSON.parse(JSON.stringify(v)));});last=rows[0];persist();return api;},
    delete:function(){return api;},
    then:function(f){return Promise.resolve({data:last?[last]:api.sel(),error:null}).then(f);}};return api;}
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
  // THE PREFERENCE, SET AHEAD OF THE APP. Both the scoped and unscoped keys, so
  // whichever the hydration reaches finds the wrong year sitting there.
  try {
    localStorage.setItem('ms_camYear_' + USER_ID, String(${PREF_YEAR}));
    localStorage.setItem('camYear', String(${PREF_YEAR}));
  } catch (e) {}
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

  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: 45000 });
  await page.fill('#loginEmail', 'cy@e2e-test.local');
  await page.fill('#loginPassword', 'TestPass123!');
  const appUp = () => page.waitForFunction(() => { const a = document.getElementById('appContent');
    return a && a.style.display !== 'none' && a.style.display !== ''; }, null, { timeout: 15000 });
  await page.click('#loginBtn');
  try { await appUp(); }
  catch (_) { await page.click('#loginBtn').catch(() => {}); await appUp(); }
  await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });

  console.log('\n══ Whose CAM year is it? ══');
  console.log('\n── Before the property is opened, the preference is in force ──');

  const before = await page.evaluate(() => getCamYear());
  R('CAM year from the user preference', before);
  yes(`the stored preference (${PREF_YEAR}) is what the app starts on`,
      before === PREF_YEAR, String(before));

  console.log('\n── Opening the property adopts ITS year ──');
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction((n) => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === n,
                             TENANTS.length, { timeout: 45000 });
  // selectProperty's data load is deferred, so wait for the year rather than
  // sleeping past it — the adoption happens inside that load.
  const adopted = await page.waitForFunction((y) => getCamYear() === y, PROP_YEAR, { timeout: 20000 })
    .then(() => true).catch(() => false);
  const now = await page.evaluate(() => getCamYear());
  R('CAM year after selecting the property', now);
  yes(`the property's own year (${PROP_YEAR}) wins over the preference`,
      adopted && now === PROP_YEAR, String(now));

  const badge = await page.evaluate(() => (document.getElementById('camYearBadge') || {}).textContent || '');
  yes('    and the breadcrumb badge says so, so the year is visible before the run',
      new RegExp(String(PROP_YEAR)).test(badge), JSON.stringify(badge));

  console.log('\n── The run therefore scopes to the property\'s year ──');
  await page.evaluate(async () => { await runAllocation(); });
  // NOT FATAL. If the year is wrong the engine refuses and lastResults stays
  // empty, which is exactly the state a broken adoption produces — the suite has
  // to report that, not die on a timeout with no verdict.
  const ranOk = await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 1,
                                           null, { timeout: 25000 }).then(() => true).catch(() => false);
  yes('the reconciliation produced a result at all', ranOk,
      'the engine refused — the year in force does not match the invoice register');
  const run = await page.evaluate(() => ({
    year:      lastResultsYear,
    allocated: (lastResults[0] || {}).totalAllocated,
    pool:      lastTotal,
    title:     (document.getElementById('resultsTitle') || {}).textContent || '',
  }));
  R('run year / allocated / pool', run);
  // 50% of a $30,000 pool: both invoices are 2025 and both are in scope.
  yes(`the reconciliation ran for ${PROP_YEAR} and allocated both invoices`,
      run.year === PROP_YEAR && Math.round(run.allocated) === 15000, JSON.stringify(run));
  yes('    and the results title names the year that was actually run',
      new RegExp(String(PROP_YEAR)).test(run.title), run.title);

  console.log('\n── And the property remembers it ──');
  const stamped = await page.evaluate(() => (currentProperty() || {}).camYear);
  R('property.camYear after the run', stamped);
  yes('runAllocation stamps the year on the property record, not only on the engine copy',
      stamped === PROP_YEAR, String(stamped));

  const persisted = await page.evaluate(async () => {
    try { await savePropertyData(); } catch (_) {}
    try { await savePropertyNow(); } catch (_) {}
    const s = window.__store();
    const p = (s.properties || []).find(x => x.id === 'cy-prop-000000000001');
    return p && p.data ? p.data.camYear : null;
  });
  R('properties.data.camYear after save', persisted);
  yes('    and it survives the save, so the next session opens on the same year',
      persisted === PROP_YEAR, String(persisted));

  console.log('\n── A property with no year of its own still uses the preference ──');
  await page.evaluate((id) => selectProperty(id), PROP2_ID);
  await page.waitForFunction(() => typeof tenantData !== 'undefined'
    && tenantData.filter(Boolean).length === 1
    && tenantData.some(t => t && t.tenant_name === 'Ferris Hardware'), null, { timeout: 45000 });
  await page.waitForTimeout(1200);   // let the deferred load land; there is nothing to wait FOR
  const onSecond = await page.evaluate(() => ({ year: getCamYear(), stored: (currentProperty() || {}).camYear }));
  R('CAM year on the never-reconciled property', onSecond);
  yes(`a null camYear does not overwrite the year in force — the preference (${PREF_YEAR}) stands`,
      onSecond.year === PREF_YEAR, JSON.stringify(onSecond));

  console.log('\n── …and the first run is what gives that property its year ──');
  await page.evaluate(async () => { await runAllocation(); });
  const ran2 = await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 1,
                                          null, { timeout: 25000 }).then(() => true).catch(() => false);
  yes('the run completes against the preference year', ran2);
  const stamped2 = await page.evaluate(async () => {
    const inMem = (currentProperty() || {}).camYear;
    try { await savePropertyData(); } catch (_) {}
    try { await savePropertyNow(); } catch (_) {}
    const s = window.__store();
    const p2 = (s.properties || []).find(x => x.id === 'cy-prop-000000000002');
    return { inMem, persisted: p2 && p2.data ? p2.data.camYear : null };
  });
  R('property 2 camYear after its first run', stamped2);
  // THE ASSERTION THE FIRST PROPERTY CANNOT MAKE. Its blob already carried 2025,
  // so `camYear` being 2025 afterwards proves nothing about the stamp — deleting
  // the stamp entirely left that section green. Here the blob carried null, so
  // any year at all can only have come from runAllocation.
  yes('runAllocation STAMPS the year onto a property that had none',
      stamped2.inMem === PREF_YEAR, JSON.stringify(stamped2));
  yes('    and it is persisted, so the property now owns its year',
      stamped2.persisted === PREF_YEAR, JSON.stringify(stamped2));

  console.log('\n── No page errors ──');
  yes('the page raised no errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + '─'.repeat(58));
  console.log(fail === 0
    ? `\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`
    : `\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await browser.close();
  server.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Runner error:', e && e.stack ? e.stack : e); process.exit(1); });
