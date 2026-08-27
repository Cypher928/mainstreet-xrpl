'use strict';
/**
 * test-e2e-restored-surface.js — reopening a saved reconciliation must show the
 * reconciliation, not an older idea of one.
 *
 *   node test-e2e-restored-surface.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * Two renderers write to #resultsBody. runAllocation draws the current screen:
 * the Reconciliation Summary panel, the KPI row, the variance banner and the
 * way into its breakdown, the audit findings, the per-tenant table with a
 * BILLING CHIP on every row, and the roster line that answers "who can I bill?"
 * in words. restoreResultsDisplay — what a landlord gets when they OPEN a saved
 * reconciliation — drew a summary line and three stats per tenant.
 *
 * Same numbers, two generations apart, and everything missing was the part that
 * says whether the money on screen may be sent. A manager who reopened last
 * week's run saw dollars with nothing qualifying them.
 *
 * WHAT IS AND IS NOT ALLOWED TO CHANGE
 *
 * The panel is a pure builder over the stored rows, so THE SAVED RECORD IS NOT
 * RECOMPUTED — this suite asserts every tenant's dollars are identical, to the
 * cent, across the reload. What the restore gains is the reporting around them.
 *
 * HOW IT IS MEASURED
 *
 * By comparing the fresh screen with the reopened one, rather than by listing
 * selectors this test happens to know about today. A surface the fresh run
 * gains and the restore does not is the defect, and a fixed list of names would
 * not notice it.
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
      console.error('\n\x1b[31mtest-e2e-restored-surface: playwright is not installed.\x1b[0m');
      console.error('This suite compares two rendered screens and cannot verify anything');
      console.error('without a browser. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-restored-surface SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The restored reconciliation screen was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7978', 10);
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

const PROP_ID = 'rs-prop-000000000001';
// Cedar takes occupancy on 1 July and its lease SAYS how a partial year is
// apportioned, so it bills — as a part-period tenant. That distinction lives
// entirely in the surface this suite is about: the chip reads "Billable · part
// period" rather than "Billable", and on the old restored screen there was no
// chip at all, so a reopened run could not tell the two apart.
const TENANTS = [
  { id: 'rs-t-alder', tenant_name: 'Alder Hardware', leased_sqft: 20000,
    lease_type: 'Triple Net (NNN)', start_date: '2019-01-01', end_date: '2030-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'rs-t-briar', tenant_name: 'Briar Optical',  leased_sqft: 10000,
    lease_type: 'Triple Net (NNN)', start_date: '2020-01-01', end_date: '2029-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'rs-t-cedar', tenant_name: 'Cedar Stationers', leased_sqft: 6000,
    lease_type: 'Triple Net (NNN)', start_date: '2026-07-01', end_date: '2031-06-30',
    partial_period_basis: 'per_diem',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  // Dunmore commences in September and its lease says NOTHING about how a
  // partial year is apportioned, so the reconciliation holds it for one
  // confirmation. Two things ride on it: a HELD chip beside three billable ones,
  // and a real audit finding, so "the findings were captured on restore" is an
  // assertion about a number rather than about zero equalling zero.
  { id: 'rs-t-dunmore', tenant_name: 'Dunmore Cycles', leased_sqft: 4000,
    lease_type: 'Triple Net (NNN)', start_date: '2026-09-01', end_date: '2031-08-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
];
const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
const INVOICES = [
  { id: 'rs-i-01', vendorName: 'Halden Janitorial',  amount: '12000', category: 'janitorial',  invoiceDate: '2026-02-01', camEligible: true, ...doc('hal') },
  { id: 'rs-i-02', vendorName: 'Ivory Insurance',    amount: '10000', category: 'insurance',   invoiceDate: '2026-01-10', camEligible: true, ...doc('ivo') },
  { id: 'rs-i-03', vendorName: 'Marlow Landscaping', amount:  '8000', category: 'landscaping', invoiceDate: '2026-05-04', camEligible: true, ...doc('mar') },
  { id: 'rs-i-04', vendorName: 'Prentice Security',  amount:  '6000', category: 'security',    invoiceDate: '2026-08-12', camEligible: true, ...doc('pre') },
  { id: 'rs-i-05', vendorName: 'Voss Utilities',     amount:  '4000', category: 'utilities',   invoiceDate: '2026-11-02', camEligible: true, ...doc('vos') },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID='rs-user', _user={id:USER_ID,email:'rs@e2e-test.local'}, _session=null, KEY='__rs_store';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Sableford Row',sqft:40000,
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

  // Options as the THIRD argument — waitForFunction is (fn, arg, options), and
  // passing {timeout} second hands it to the page function as data.
  const signIn = async () => {
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
    // The button paints with the HTML; submitAuth() arrives with script.js. The
    // form is wired as onsubmit="submitAuth(event)", an inline attribute, so a
    // click in the gap between those two moments fires a ReferenceError and is
    // LOST — after which the suite waits out its full timeout for an app that was
    // never told to sign in. Three suites failed this way intermittently, only
    // ever inside the full regression, where a dozen browsers have already run.
    // Waiting for the handler states the real precondition.
    await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: 45000 });
    await page.fill('#loginEmail', 'rs@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginBtn');
    await page.waitForFunction(() => { const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== ''; }, null, { timeout: 45000 });
    await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
    await page.evaluate((id) => selectProperty(id), PROP_ID);
    await page.waitForFunction(() => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === 4,
                               null, { timeout: 45000 });
  };

  // Everything the reconciliation screen is expected to say, read off the DOM.
  const surface = () => page.evaluate(() => {
    const body = document.getElementById('resultsBody');
    const q    = (sel) => [...(body ? body.querySelectorAll(sel) : [])];
    const txt  = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      panel:     q('.rcs-panel').length,
      kpis:      q('.rcs-kpi').length > 0,
      rows:      q('.rcs-row').length,
      chips:     q('.rcs-bill').map(txt).sort(),
      roster:    q('.rcs-bill-roster').map(txt)[0] || null,
      readiness: q('.rcs-readiness-badge').map(txt)[0] || null,
      coverage:  q('.rcs-coverage-badge').map(txt)[0] || null,
      calcState: q('.rc-calc-state').map(txt).sort(),
      cards:     q('.result-card').length,
      // The money, per tenant, from the rows the panel was built from.
      allocated: (typeof lastResults !== 'undefined' ? lastResults : [])
        .map(r => ({ name: r.name, amount: Number((r.totalAllocated || 0).toFixed(2)) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  console.log('\n══ A saved reconciliation, reopened ══');

  await signIn();
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 4,
                             null, { timeout: 45000 });
  await page.evaluate(async () => { await savePropertyData(); await savePropertyNow(); });

  const fresh = await surface();
  const freshWired = await page.evaluate(() => ({
    issues:   Array.isArray(_lastReconIssues) ? _lastReconIssues.length : null,
    variance: _lastVarianceBreakdown ? Object.keys(_lastVarianceBreakdown).length > 0 : false,
  }));
  console.log('\n── The screen the run produces ──');
  R('summary panels',  fresh.panel);
  R('table rows',      fresh.rows);
  R('billing chips',   fresh.chips);
  R('roster',          fresh.roster);
  R('allocated',       fresh.allocated);
  yes('the fresh run draws the current surface',
      fresh.panel === 1 && fresh.kpis && fresh.rows === 4 && fresh.chips.length === 4
        && !!fresh.roster && !!fresh.readiness,
      JSON.stringify(fresh));
  // The part-period tenant, which is the whole reason the chip is worth carrying
  // across a reload: "Billable" and "Billable · part period" are different
  // claims about the same dollars.
  yes('    including the part-period tenant, named as such',
      fresh.chips.some(c => /part period/i.test(c)), JSON.stringify(fresh.chips));
  yes('    and the held tenant, distinguished from the billable ones',
      fresh.chips.some(c => /confirmation/i.test(c)), JSON.stringify(fresh.chips));

  console.log('\n── A REAL RELOAD — the saved reconciliation is reopened ──');
  await signIn();
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 4,
                             null, { timeout: 45000 });
  const restored = await surface();
  R('summary panels',  restored.panel);
  R('table rows',      restored.rows);
  R('billing chips',   restored.chips);
  R('roster',          restored.roster);
  R('allocated',       restored.allocated);

  yes('THE MONEY IS THE SAVED RECORD, UNCHANGED TO THE CENT',
      JSON.stringify(restored.allocated) === JSON.stringify(fresh.allocated),
      JSON.stringify({ fresh: fresh.allocated, restored: restored.allocated }));
  yes('the Reconciliation Summary panel is there',
      restored.panel === 1, JSON.stringify(restored.panel));
  yes('    with the KPI row',    restored.kpis, JSON.stringify(restored.kpis));
  yes('    and every tenant row', restored.rows === fresh.rows,
      JSON.stringify({ fresh: fresh.rows, restored: restored.rows }));
  yes('EVERY TENANT STILL CARRIES ITS BILLING CHIP',
      JSON.stringify(restored.chips) === JSON.stringify(fresh.chips),
      JSON.stringify({ fresh: fresh.chips, restored: restored.chips }));
  yes('    the part-period tenant is still named as one',
      restored.chips.some(c => /part period/i.test(c)), JSON.stringify(restored.chips));
  yes('    and the held tenant is still held, not quietly billable',
      restored.chips.some(c => /confirmation/i.test(c)), JSON.stringify(restored.chips));
  yes('    the roster still answers "who can I bill?"',
      restored.roster === fresh.roster,
      JSON.stringify({ fresh: fresh.roster, restored: restored.roster }));
  yes('    the property verdict is the same one',
      restored.readiness === fresh.readiness,
      JSON.stringify({ fresh: fresh.readiness, restored: restored.readiness }));
  yes('    coverage reads the same',
      restored.coverage === fresh.coverage,
      JSON.stringify({ fresh: fresh.coverage, restored: restored.coverage }));
  yes('    and the calculation state per row is unchanged',
      JSON.stringify(restored.calcState) === JSON.stringify(fresh.calcState),
      JSON.stringify({ fresh: fresh.calcState, restored: restored.calcState }));
  yes('the per-tenant cards are still there too',
      restored.cards === fresh.cards,
      JSON.stringify({ fresh: fresh.cards, restored: restored.cards }));

  // The panel is what populates these, which is why "Open Dispute" and the
  // variance panel were inert on the restore path.
  console.log('\n── And the panels it feeds are live, not stale ──');
  const wired = await page.evaluate(() => ({
    issues:   Array.isArray(_lastReconIssues) ? _lastReconIssues.length : null,
    variance: _lastVarianceBreakdown ? Object.keys(_lastVarianceBreakdown).length > 0 : false,
  }));
  R('findings captured', wired.issues);
  yes('the audit findings behind "Open Dispute" were captured on restore',
      wired.issues === freshWired.issues && wired.issues > 0,
      JSON.stringify({ fresh: freshWired.issues, restored: wired.issues }));
  yes('    and the variance breakdown was derived',
      wired.variance === true, JSON.stringify(wired));

  console.log('\n── Console ──');
  yes('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + '─'.repeat(58));
  if (fail) console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  else      console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n\x1b[31mtest-e2e-restored-surface crashed:\x1b[0m', e && e.stack || e);
  process.exit(1);
});
