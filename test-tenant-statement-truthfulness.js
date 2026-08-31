'use strict';
/**
 * test-tenant-statement-truthfulness.js — what the statement TELLS a tenant
 * must be true of what it BILLED them.
 *
 *   node test-tenant-statement-truthfulness.js
 *
 * TWO DEFECTS, ONE DOCUMENT
 *
 * F-8 — A LEASE CAP CALLED A ROUNDING ADJUSTMENT. The per-category line items
 * are the UNCAPPED shares; the billed total is what remains after the cap. The
 * statement described that entire gap as rounding:
 *
 *     "Line items above total $12,550.00; rounding adjustment −$3,100.00
 *      brings your billed total to $9,450.00."
 *
 * and then, two paragraphs later, "Cap applied — your allocation was reduced by
 * $3,100.00 to meet the lease cap." The document contradicted itself and the
 * wrong sentence came first. $3,100 of a negotiated contractual ceiling was
 * presented to the tenant as an arithmetic artefact.
 *
 * F-15 — AN UNDATED CHARGE PRESENTED AS AN ORDINARY ONE. The reconciliation
 * KEEPS an undated invoice rather than dropping it, deliberately, so a real
 * expense is never silently lost. The statement's charge detail then listed
 * vendor, category, invoice total and share — and no date at all — so nothing
 * distinguished a charge dated inside the CAM year from one whose year nobody
 * can establish. On the fresh-property run a $9,000 undated invoice was billed
 * across six tenants with no mention on any statement.
 *
 * WHAT THIS SUITE HOLDS, AND WHAT IT DOES NOT
 *
 * It drives generateTenantStatement — the production path, the same function the
 * "Tenant Statement" button calls — and reads the rendered document. Both
 * findings are checked POSITIVELY on a tenant they apply to and NEGATIVELY on a
 * tenant they do not, because a disclosure that fires on every statement is as
 * useless as one that never fires.
 *
 * The allocation is NOT changed by either fix and this suite pins that: every
 * billed figure is asserted against the arithmetic the engine performed.
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
      console.error('\n\x1b[31mtest-tenant-statement-truthfulness: playwright is not installed.\x1b[0m');
      console.error('This suite renders real tenant statements in a browser and cannot verify');
      console.error('anything without one. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-tenant-statement-truthfulness SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  What the tenant statement says about caps and undated charges was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7997', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(30) + ':', typeof v === 'string' ? v : JSON.stringify(v));

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

// ── The fixture ─────────────────────────────────────────────────────────────
//
// Three tenants, chosen so each finding has both a subject and a control:
//
//              cap?   undated charge?
//   Alpha       no          yes          → negative cap, positive undated
//   Beta       YES          yes          → positive cap, positive undated
//   Gamma       no           no          → negative both (it excludes repairs,
//                                          which is the undated invoice's
//                                          category, so the charge never
//                                          reaches its statement)
//
// Every lease runs the whole period and every date is readable, so nothing here
// is held by the billing gate and all three statements actually issue.
const PROP_ID    = 'ts-prop-000000000001';
const CAM_YEAR   = 2025;
const TOTAL_SQFT = 50000;

const TENANTS = [
  { id: 'ts-t-alpha', tenant_name: 'Alpha Grocers', unitNumber: '100',
    leased_sqft: 25000, lease_type: 'Triple Net (NNN)',
    start_date: '2018-01-01', end_date: '2033-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'ts-t-beta', tenant_name: 'Beta Provisions', unitNumber: '120',
    leased_sqft: 15000, lease_type: 'Triple Net (NNN)',
    start_date: '2019-01-01', end_date: '2032-12-31',
    // 5% over a $2,000 prior-year base — a $2,100 ceiling against a $13,500
    // share, so the cap bites hard and the reduction is unmistakable.
    cap: '5', capBaseAmount: '2000', excluded_categories: '', status: 'complete' },
  { id: 'ts-t-gamma', tenant_name: 'Gamma Clinic', unitNumber: '210',
    leased_sqft: 10000, lease_type: 'Triple Net (NNN)',
    start_date: '2020-01-01', end_date: '2030-12-31',
    cap: '', capBaseAmount: '', excluded_categories: 'repairs', status: 'complete' },
];

const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
// Spread deliberately: at two invoices the larger became a concentration red at
// PROPERTY level, which blocks every statement and would have hidden both
// findings behind a gate that has nothing to do with them.
const INVOICES = [
  { id: 'ts-i-1', vendorName: 'Halloway Janitorial', amount: '12000', category: 'janitorial',
    invoiceDate: '2025-02-10', camEligible: true, ...doc('hal') },
  { id: 'ts-i-2', vendorName: 'Prosper Insurance',   amount: '10000', category: 'insurance',
    invoiceDate: '2025-06-01', camEligible: true, ...doc('pro') },
  // THE UNDATED ONE. Shared, so it reaches Alpha and Beta; Gamma's lease
  // excludes repairs, so it never reaches Gamma's statement.
  { id: 'ts-i-3', vendorName: 'Lockridge Repairs',   amount:  '9000', category: 'repairs',
    invoiceDate: '', camEligible: true, ...doc('loc') },
  { id: 'ts-i-4', vendorName: 'Meriden Utilities',   amount:  '8000', category: 'utilities',
    invoiceDate: '2025-09-15', camEligible: true, ...doc('mer') },
  { id: 'ts-i-5', vendorName: 'Ashgrove Security',   amount:  '6000', category: 'security',
    invoiceDate: '2025-11-02', camEligible: true, ...doc('ash') },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID='ts-user', _user={id:USER_ID,email:'ts@e2e-test.local'}, _session=null, KEY='__ts_store';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Wexford Park',sqft:${TOTAL_SQFT},
    data:{invoices:${JSON.stringify(INVOICES)},disputes:[],camYear:${CAM_YEAR},results:null,camReconciliation:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(TENANTS)}}}],tenants:[]};
  function load(){try{var r=localStorage.getItem(KEY);if(r)return JSON.parse(r);}catch(e){}return JSON.parse(JSON.stringify(seed));}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(_store));}catch(e){}}
  var _store=load(); window.__store=function(){return _store;};
  function res(d){return Promise.resolve({data:d,error:null});} var _seq=0;
  function table(name){var rows=_store[name]||(_store[name]=[]);var last=null;var filters=[];var api={
    sel:function(){return rows.filter(function(r){return filters.every(function(f){
      return String(r[f[0]])===String(f[1]);});});},
    select:function(){last=null;return api;},
    eq:function(c,v){filters.push([c,v]);return api;},not:function(){return api;},
    is:function(){return api;},in:function(){return api;},order:function(){return api;},limit:function(){return api;},
    maybeSingle:function(){return res(last||api.sel()[0]||null);},single:function(){return res(last||api.sel()[0]||null);},
    insert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);rows.push(row);return row;});last=a[0];persist();return api;},
    upsert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);var i=rows.findIndex(function(x){return x.id===row.id;});if(i>=0){rows[i]=Object.assign({},rows[i],row);persist();return rows[i];}rows.push(row);return row;});last=a[0];persist();return api;},
    update:function(v){api.sel().forEach(function(r){Object.assign(r,JSON.parse(JSON.stringify(v)));});last=api.sel()[0];persist();return api;},
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
})();
`;

// Render one statement through the production path and hand back what it says.
const STATEMENT = (name) => {
  try { document.getElementById('reportOverlay').style.display = 'none'; } catch (_) {}
  try { document.getElementById('rptBody').innerHTML = ''; } catch (_) {}
  try { document.getElementById('rptToolbarTitle').textContent = ''; } catch (_) {}
  generateTenantStatement(name);
  const b = document.getElementById('rptBody');
  const r = (typeof lastResults !== 'undefined' ? lastResults : []).find(x => x && x.name === name) || {};
  return {
    title:     (document.getElementById('rptToolbarTitle') || {}).textContent || '',
    text:      b ? b.innerText.replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : '',
    // The category accordions and charge details render COLLAPSED, so innerText
    // cannot see inside them. The footnote is the always-visible disclosure; the
    // row marker and the Invoice Date row are what a tenant finds on expanding
    // the charge, exactly as every other per-charge fact does — so they are
    // asserted against the DOM rather than the visible text.
    html:      b ? b.innerHTML.replace(/\s+/g, ' ') : '',
    // The engine's own figures, so the words can be checked against them rather
    // than against a number the test made up.
    allocated:     r.allocatedAmount,
    capApplied:    !!r.capApplied,
    capAdjustment: r.capAdjustment,
    included:      (r.includedInvoices || []).map(i => i.vendor || i.vendorName),
  };
};

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
  await page.fill('#loginEmail', 'ts@e2e-test.local');
  await page.fill('#loginPassword', 'TestPass123!');
  const appUp = () => page.waitForFunction(() => { const a = document.getElementById('appContent');
    return a && a.style.display !== 'none' && a.style.display !== ''; }, null, { timeout: 15000 });
  await page.click('#loginBtn');
  try { await appUp(); }
  catch (_) { await page.click('#loginBtn').catch(() => {}); await appUp(); }
  await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction((n) => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === n,
                             TENANTS.length, { timeout: 45000 });
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                             TENANTS.length, { timeout: 60000 });

  console.log('\n══ What the statement tells a tenant ══');

  const alpha = await page.evaluate(STATEMENT, 'Alpha Grocers');
  const beta  = await page.evaluate(STATEMENT, 'Beta Provisions');
  const gamma = await page.evaluate(STATEMENT, 'Gamma Clinic');

  console.log('\n── The three statements issued ──');
  [['Alpha', alpha], ['Beta', beta], ['Gamma', gamma]].forEach(([n, s]) =>
    R(n, { title: s.title, allocated: s.allocated, capApplied: s.capApplied, capAdj: s.capAdjustment }));

  yes('all three statements were produced — nothing is blocked by an unrelated gate',
      [alpha, beta, gamma].every(s => /Tenant Statement —/.test(s.title)),
      JSON.stringify([alpha.title, beta.title, gamma.title]));

  // ── The arithmetic these words describe ───────────────────────────────────
  console.log('\n── The allocation is untouched by either disclosure ──');
  // Pool $45,000. Alpha 50% = $22,500. Beta 30% = $13,500 capped to $2,100.
  // Gamma 20% of $36,000 (repairs excluded) = $7,200.
  yes('Alpha is billed its uncapped 50% share of the whole pool ($22,500.00)',
      Math.round(alpha.allocated) === 22500, String(alpha.allocated));
  yes('Beta is billed its $2,100.00 ceiling, not its $13,500.00 share',
      Math.round(beta.allocated) === 2100 && beta.capApplied
        && Math.round(beta.capAdjustment) === 11400,
      JSON.stringify({ allocated: beta.allocated, capAdjustment: beta.capAdjustment }));
  yes('Gamma is billed 20% of the pool less the repairs it excludes ($7,200.00)',
      Math.round(gamma.allocated) === 7200, String(gamma.allocated));
  yes('    and the undated repairs invoice never reaches Gamma\'s statement',
      !gamma.included.some(v => /Lockridge/.test(String(v))), JSON.stringify(gamma.included));

  // ── F-8 · a cap is a cap ──────────────────────────────────────────────────
  console.log('\n── F-8 · POSITIVE: the capped tenant is told it was a cap ──');
  yes('the statement does NOT call the reduction a rounding adjustment',
      !/rounding adjustment/i.test(beta.text),
      beta.text.slice(Math.max(0, beta.text.search(/rounding adjustment/i) - 120), 260));
  yes('    it says the amount was not billed', /\$11,400\.00 was not billed to you/i.test(beta.text),
      beta.text.slice(0, 400));
  yes('    it names the contractual cap', /caps recoverable CAM at 5% above a prior-year base of \$2,000\.00/i.test(beta.text));
  yes('    and states the ceiling that follows from those terms',
      /ceiling of \$2,100\.00/i.test(beta.text));
  yes('    the line items are still shown at their uncapped total ($13,500.00)',
      /Line items above total \$13,500\.00/i.test(beta.text));
  yes('    and the billed total it lands on is the ceiling',
      /billed total is \$2,100\.00/i.test(beta.text));
  yes('    the older cap paragraph agrees with it rather than contradicting it',
      /reduced by \$11,400\.00 to meet the lease cap of \$2,100\.00/i.test(beta.text),
      beta.text.slice(0, 600));

  console.log('\n── F-8 · NEGATIVE: an uncapped tenant is told nothing about caps ──');
  [['Alpha', alpha], ['Gamma', gamma]].forEach(([n, s]) => {
    yes(`${n} has no cap language at all`,
        !/caps recoverable CAM|was not billed to you|Cap applied/i.test(s.text),
        s.text.slice(0, 300));
  });

  // ── F-15 · an undated charge says so ──────────────────────────────────────
  console.log('\n── F-15 · POSITIVE: the undated charge is disclosed ──');
  [['Alpha', alpha], ['Beta', beta]].forEach(([n, s]) => {
    yes(`${n}'s statement says a charge carries no invoice date`,
        /1 charge on this statement carries no invoice date/i.test(s.text), s.text.slice(0, 300));
    yes(`    …and names it by vendor and amount`,
        /Lockridge Repairs \(\$9,000\.00, no date on the invoice\)/i.test(s.text));
    yes(`    …says it was included anyway and in which year`,
        /included in this 2025 reconciliation and your share above/i.test(s.text));
    yes(`    …is honest that the year is not established`,
        /does not establish that it falls inside the 2025 CAM year/i.test(s.text));
    yes(`    …and gives the tenant a next action`,
        /Ask your landlord for the dated invoice before paying this line/i.test(s.text)
          && /open a dispute on the charge above/i.test(s.text));
    yes(`    …with the charge row itself marked, not only the footnote`,
        /ts-charge-undated/.test(s.html) && /No invoice date on file/i.test(s.html),
        'the collapsed charge row carries no marker');
    yes(`    …and the detail panel showing "Not on file" where a date would be`,
        /<span>Invoice Date<\/span><span class="ts-detail-val"[^>]*>Not on file</.test(s.html),
        'no Invoice Date row in the charge detail');
  });

  console.log('\n── F-15 · NEGATIVE: a statement with no undated charge says nothing ──');
  yes('Gamma is told nothing about missing dates',
      !/no invoice date|Ask your landlord for the dated invoice/i.test(gamma.text),
      gamma.text.slice(0, 300));
  yes('    and its dated charges show the real date rather than a warning',
      /<span>Invoice Date<\/span><span class="ts-detail-val">2025-02-10<\/span>/.test(gamma.html)
        && !/ts-charge-undated/.test(gamma.html),
      'expected a plain Invoice Date row carrying the real date');

  // ── The disclosure must not have swallowed the rounding line ──────────────
  console.log('\n── The rounding line still exists, and is driven by the rounding gap ──');
  const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  yes('[source] the rounding sentence is fed by _roundingGap, not the raw breakdown gap',
      /rounding adjustment \$\{_roundingGap >= 0/.test(src),
      'the rounding note must not read the un-decomposed gap again');
  yes('[source] the cap component is removed from the gap before it is called rounding',
      /_roundingGap\s*=\s*parseFloat\(\(_breakdownGap \+ _capReduction\)/.test(src));
  // Behavioural half: on this fixture every share divides exactly, so there is
  // no rounding gap to report — and the capped tenant must therefore show the
  // cap sentence and no rounding sentence at all. That pairing is the thing that
  // was broken: one gap, two meanings, and only the wrong one printed.
  yes('no tenant is shown a rounding sentence on a fixture with no rounding gap',
      ![alpha, beta, gamma].some(s => /rounding adjustment/i.test(s.text)));

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
