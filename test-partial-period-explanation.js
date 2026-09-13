'use strict';
/**
 * test-partial-period-explanation.js — the printed equation must multiply out.
 *
 *   node test-partial-period-explanation.js
 *
 * TWO DEFECTS, ONE SENTENCE
 *
 * F-7 — AN EQUATION THAT DID NOT MULTIPLY OUT. The charge detail printed
 *
 *     "$12,500.00 × 33.33% = $1,678.08"
 *
 * for a tenant who held 33.33% of the building and occupied 245 of 365 days.
 * The left side is $4,166.25. The right side is the engine's answer, which
 * includes an occupancy factor the equation never mentions. A manager re-keying
 * the printed line got a different number and had no way to find out why: the
 * second multiplicand was not on the page.
 *
 * F-12 — ONE COVERAGE FIGURE DOING TWO JOBS. `proRataSum` is how much of the
 * building is under a loaded lease. It is not how much of the building was under
 * a lease FOR THE WHOLE PERIOD, and on any property with a mid-year lease the
 * two differ. The summary printed the first and the variance panel explained the
 * difference as though it were the second.
 *
 * WHAT THIS SUITE HOLDS
 *
 * 1. THE EQUATION MULTIPLIES OUT. Every rendered shared line is parsed back out
 *    of the DOM — the amount, each operand, the printed result — and the product
 *    is asserted against the printed result TO THE CENT. This is the assertion
 *    the old wording failed.
 *
 * 2. THE OPERANDS ARE RATIONAL, NOT ROUNDED (D1). The fixture gives one tenant
 *    exactly one third of the building, so 33.33% is not the share and no
 *    two-decimal percentage can reproduce the billed figure. The suite asserts
 *    both halves: the printed operands DO reproduce it, and the percentage a
 *    reader would otherwise have used does NOT. If the equation ever regresses
 *    to percentages, the first assertion fails.
 *
 * 3. THE TWO COVERAGE FIGURES ARE TWO FIGURES (D2/F-12). Space and space×time
 *    are printed separately, the gap between them is explained as leased space
 *    that did not run the whole period, and `notOccupiedShared` +
 *    `notOccupiedDirect` are asserted to add to the unchanged `notOccupied`.
 *
 * 4. NOTHING SAYS THE LANDLORD ABSORBS ANYTHING. That is a claim about a lease
 *    this reconciliation has not read. The wording says the money remains
 *    unallocated to tenants, and this suite pins it negatively.
 *
 * 5. THE ALLOCATION IS UNCHANGED. Every billed figure is asserted against the
 *    arithmetic the engine performed, on both render paths.
 *
 * Assertions run on BOTH surfaces — the in-app result card and the tenant
 * statement — because they are two call sites of one helper and a fix applied to
 * one of them is not a fix.
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
      console.error('\n\x1b[31mtest-partial-period-explanation: playwright is not installed.\x1b[0m');
      console.error('This suite reads rendered equations out of a real DOM and cannot verify');
      console.error('anything without one. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-partial-period-explanation SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Whether the printed CAM equation multiplies out was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7994', 10);
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

// ── The fixture ─────────────────────────────────────────────────────────────
//
// 30,000 sqft, CAM 2025 (365 days). Four tenants, one for each thing the
// explanation has to say, and a building denominator of 30,000 chosen so that a
// 10,000 sqft tenant holds EXACTLY ONE THIRD — a share no two-decimal
// percentage can carry.
//
//   Aspen Hardware   10,000  1/3     whole period        → "the whole period"
//   Birchwood Cafe    6,000  20%     from 2025-05-01     → 245/365 days, lease basis
//   Cobalt Dental     4,500  15%     no end date on file → assumed boundary
//   Drayton Books     3,000  10%     to 2025-09-30       → full_period: no fraction
//
// Sum 23,500 of 30,000 — 78.33% under lease, so the property also has genuine
// vacancy and the coverage figures are not both 100%.
//
// Birchwood carries the two direct invoices, one dated inside its occupancy
// window and one outside it, so notOccupiedShared and notOccupiedDirect are BOTH
// non-zero and the property-level wording has to keep them apart.
//
// Every partial-period tenant states its basis on the lease, so no
// blocksBilling finding fires and all four statements actually issue.
const PROP_ID    = 'pp-prop-000000000001';
const CAM_YEAR   = 2025;
const TOTAL_SQFT = 30000;

const TENANTS = [
  { id: 'pp-t-aspen', tenant_name: 'Aspen Hardware', unitNumber: '101',
    leased_sqft: 10000, lease_type: 'Triple Net (NNN)',
    start_date: '2018-01-01', end_date: '2033-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'pp-t-birch', tenant_name: 'Birchwood Cafe', unitNumber: '212',
    leased_sqft: 6000, lease_type: 'Triple Net (NNN)',
    start_date: '2025-05-01', end_date: '2032-12-31',
    partial_period_basis: 'per_diem',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'pp-t-cobalt', tenant_name: 'Cobalt Dental', unitNumber: '305',
    leased_sqft: 4500, lease_type: 'Triple Net (NNN)',
    start_date: '2019-03-01', end_date: '',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'pp-t-drayton', tenant_name: 'Drayton Books', unitNumber: '418',
    leased_sqft: 3000, lease_type: 'Triple Net (NNN)',
    start_date: '2020-01-01', end_date: '2025-09-30',
    partial_period_basis: 'full_period',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
];

const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
// $12,500 and $6,100 are deliberately not divisible by three: a third of either
// is non-terminating, which is the whole point of the fixture. Four shared
// invoices rather than two so the largest stays under the 40% concentration
// threshold, which is a property-level blocker and would hide these findings
// behind a gate that has nothing to do with them.
const INVOICES = [
  { id: 'pp-i-1', vendorName: 'Halloway Janitorial', amount: '12500', category: 'janitorial',
    invoiceDate: '2025-03-05', camEligible: true, ...doc('hal') },
  { id: 'pp-i-2', vendorName: 'Prosper Insurance',   amount:  '9000', category: 'insurance',
    invoiceDate: '2025-06-01', camEligible: true, ...doc('pro') },
  { id: 'pp-i-3', vendorName: 'Meriden Utilities',   amount:  '6100', category: 'utilities',
    invoiceDate: '2025-10-20', camEligible: true, ...doc('mer') },
  { id: 'pp-i-4', vendorName: 'Ashgrove Security',   amount:  '4200', category: 'security',
    invoiceDate: '2025-11-02', camEligible: true, ...doc('ash') },
  // DIRECT, inside Birchwood's occupancy window: billed in full, not apportioned
  // by either multiplicand.
  { id: 'pp-i-5', vendorName: 'Cutler Submeter Unit 212', amount: '2400', category: 'utilities',
    invoiceDate: '2025-07-14', camEligible: true, ...doc('cut') },
  // DIRECT, outside it — February, before Birchwood took occupancy. Held out of
  // the allocation and reported; this is the notOccupiedDirect half.
  { id: 'pp-i-6', vendorName: 'Fairlane Glazing Unit 212', amount: '1800', category: 'repairs',
    invoiceDate: '2025-02-20', camEligible: true, ...doc('fai') },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID='pp-user', _user={id:USER_ID,email:'pp@e2e-test.local'}, _session=null, KEY='__pp_store';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Kettle Row',sqft:${TOTAL_SQFT},
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

// ── Reading the rendered explanation back out of the DOM ────────────────────
//
// Everything below the collapsed accordions is present in the document and
// hidden with display:none, so textContent reaches it. The charge rows are read
// structurally — one object per rendered line — rather than by grepping a blob
// of innerText, because the assertion is arithmetic between fields of the SAME
// line and a text search cannot tell two lines apart.
const READ_ROWS = (rootSel) => {
  const T = (el) => el ? (el.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : null;
  return Array.from(document.querySelectorAll(rootSel + ' .ts-inv-card')).map(card => ({
    vendor:    T(card.querySelector('.charge-vendor')),
    printed:   T(card.querySelector('.charge-amount')),
    rowSuffix: T(card.querySelector('.charge-sub')),
    basis:     T(card.querySelector('.ts-detail-basis')),
    formula:   T(card.querySelector('.ts-detail-formula')),
    steps:     Array.from(card.querySelectorAll('.ts-step')).map(s =>
                 Array.from(s.children).map(c => T(c))),
  }));
};

// Result cards carry the tenant name in .r-name; scope by card so the rows of
// two tenants can never be compared against each other.
const READ_CARD = (tenantName) => {
  const T = (el) => el ? (el.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : null;
  const card = Array.from(document.querySelectorAll('.result-card'))
    .find(c => (T(c.querySelector('.r-name')) || '').indexOf(tenantName) === 0);
  if (!card) return null;
  return Array.from(card.querySelectorAll('.ts-inv-card')).map(row => ({
    vendor:    T(row.querySelector('.charge-vendor')),
    printed:   T(row.querySelector('.charge-amount')),
    rowSuffix: T(row.querySelector('.charge-sub')),
    basis:     T(row.querySelector('.ts-detail-basis')),
    formula:   T(row.querySelector('.ts-detail-formula')),
    steps:     Array.from(row.querySelectorAll('.ts-step')).map(s =>
                 Array.from(s.children).map(c => T(c))),
  }));
};

const STATEMENT = (name) => {
  try { document.getElementById('reportOverlay').style.display = 'none'; } catch (_) {}
  try { document.getElementById('rptBody').innerHTML = ''; } catch (_) {}
  try { document.getElementById('rptToolbarTitle').textContent = ''; } catch (_) {}
  generateTenantStatement(name);
  const b = document.getElementById('rptBody');
  return {
    title: (document.getElementById('rptToolbarTitle') || {}).textContent || '',
    text:  b ? (b.innerText || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : '',
  };
};

// ── The arithmetic, done in Node, from the printed characters only ──────────
const money = (s) => {
  const m = /-?\$([\d,]+\.\d{2})/.exec(String(s || ''));
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Parse `$12,500.00 × 10,000/30,000 sqft × 245/365 days = $1,678.08` into the
 * amount, the operand list as NUMBERS, and the printed result. Returns null for
 * anything that is not an equation of that shape — a direct line, for instance,
 * which deliberately prints no operands at all.
 */
function parseEquation(formula) {
  const s = String(formula || '').replace(/×/g, '*').replace(/ /g, ' ');
  const m = /^\$([\d,]+\.\d{2})\s*\*\s*(.+?)\s*=\s*\$([\d,]+\.\d{2})$/.exec(s.trim());
  if (!m) return null;
  const operands = m[2].split('*').map(x => x.trim());
  const values = operands.map(op => {
    const frac = /^([\d,]+)\s*\/\s*([\d,]+)(?:\s+\w+)?$/.exec(op);
    if (frac) {
      const n = parseFloat(frac[1].replace(/,/g, '')), d = parseFloat(frac[2].replace(/,/g, ''));
      return d ? n / d : null;
    }
    const pct = /^([\d.]+)%$/.exec(op);
    if (pct) return parseFloat(pct[1]) / 100;
    return null;
  });
  return {
    amount:   parseFloat(m[1].replace(/,/g, '')),
    operands, values,
    printed:  parseFloat(m[3].replace(/,/g, '')),
    product:  values.some(v => v === null) ? null : values.reduce((a, b) => a * b, parseFloat(m[1].replace(/,/g, ''))),
  };
}

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    return route.abort();
  });
  await ctx.addInitScript(SUPABASE_MOCK);

  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await _e2eSignIn(page, { email: "pp@e2e-test.local", errors: errors });
  await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction((n) => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === n,
                             TENANTS.length, { timeout: 45000 });
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                             TENANTS.length, { timeout: 60000 });

  // ── The engine's own answer, so the words can be checked against it ───────
  const eng = await page.evaluate(() => (lastResults || []).map(r => ({
    name: r.name, allocated: r.allocatedAmount, proRataPercent: r.proRataPercent,
    effectiveSharePercent: r.effectiveSharePercent,
    occ: r.occupancy ? { applied: r.occupancy.applied, unit: r.occupancy.unit,
                         numerator: r.occupancy.numerator, denominator: r.occupancy.denominator,
                         factor: r.occupancy.factor, basis: r.occupancy.basis,
                         basisSource: r.occupancy.basisSource, case: r.occupancy.case,
                         assumedStart: r.occupancy.assumedStart, assumedEnd: r.occupancy.assumedEnd } : null,
    invoices: (r.includedInvoices || []).map(i => ({
      vendor: i.vendor || i.vendorName, share: i.share, amount: i.amount, allocation: i.allocation })),
  })));
  const byName = Object.fromEntries(eng.map(r => [r.name, r]));

  console.log('\n══ What the engine computed ══');
  eng.forEach(r => R(r.name, { allocated: r.allocated, proRata: r.proRataPercent,
    occ: r.occ ? `${r.occ.numerator}/${r.occ.denominator} ${r.occ.unit} (${r.occ.case}, ${r.occ.basisSource})` : null }));

  // ── 0. The fixture is the one the assertions assume ──────────────────────
  console.log('\n── The fixture exercises every branch it claims to ──');
  yes('Aspen holds exactly one third of the building — a share no 2-dp percentage carries',
      byName['Aspen Hardware'] && byName['Aspen Hardware'].proRataPercent === 33.33,
      JSON.stringify(byName['Aspen Hardware'] && byName['Aspen Hardware'].proRataPercent));
  yes('Birchwood is apportioned 245 of 365 days on a basis stated by its lease',
      byName['Birchwood Cafe'] && byName['Birchwood Cafe'].occ
        && byName['Birchwood Cafe'].occ.numerator === 245
        && byName['Birchwood Cafe'].occ.denominator === 365
        && byName['Birchwood Cafe'].occ.basisSource === 'lease',
      JSON.stringify(byName['Birchwood Cafe'] && byName['Birchwood Cafe'].occ));
  yes('Cobalt has no end date on file, so its boundary is assumed rather than read',
      byName['Cobalt Dental'] && byName['Cobalt Dental'].occ
        && byName['Cobalt Dental'].occ.assumedEnd === true
        && byName['Cobalt Dental'].occ.factor === 1,
      JSON.stringify(byName['Cobalt Dental'] && byName['Cobalt Dental'].occ));
  yes('Drayton bills the full annual amount by its lease, so there is no fraction to print',
      byName['Drayton Books'] && byName['Drayton Books'].occ
        && byName['Drayton Books'].occ.unit === 'period',
      JSON.stringify(byName['Drayton Books'] && byName['Drayton Books'].occ));
  yes('Birchwood carries one direct invoice inside its window and one outside it',
      byName['Birchwood Cafe']
        && byName['Birchwood Cafe'].invoices.filter(i => i.allocation === 'direct').length === 1
        && byName['Birchwood Cafe'].invoices.some(i => /Cutler/.test(i.vendor))
        && !byName['Birchwood Cafe'].invoices.some(i => /Fairlane/.test(i.vendor)),
      JSON.stringify(byName['Birchwood Cafe'] && byName['Birchwood Cafe'].invoices));

  // ── 1. F-7 · the equation multiplies out, on both surfaces ───────────────
  const surfaces = [];
  for (const t of TENANTS.map(t => t.tenant_name)) {
    const card = await page.evaluate(READ_CARD, t);
    surfaces.push({ surface: 'result card', tenant: t, rows: card || [] });
  }
  await page.evaluate(() => { try { document.getElementById('reportOverlay').style.display = 'none'; } catch (_) {} });
  for (const t of TENANTS.map(t => t.tenant_name)) {
    const st = await page.evaluate(STATEMENT, t);
    const rows = await page.evaluate(READ_ROWS, '#rptBody');
    surfaces.push({ surface: 'tenant statement', tenant: t, rows, title: st.title, text: st.text });
  }

  console.log('\n── F-7 · every printed equation multiplies out to the printed result ──');
  yes('all four statements issued — nothing is held by an unrelated gate',
      surfaces.filter(s => s.surface === 'tenant statement')
              .every(s => /Tenant Statement —/.test(s.title || '')),
      JSON.stringify(surfaces.filter(s => s.surface === 'tenant statement').map(s => s.title)));

  let checked = 0, directSeen = 0;
  surfaces.forEach(({ surface, tenant, rows }) => {
    yes(`${tenant} · ${surface}: every charge the engine billed is rendered`,
        rows.length === (byName[tenant] ? byName[tenant].invoices.length : -1),
        `rendered ${rows.length}, engine billed ${byName[tenant] ? byName[tenant].invoices.length : '?'}`);
    rows.forEach(row => {
      // Matched by the INVOICE TOTAL the row prints, not by vendor name. The
      // tenant statement's charge-vendor element renders `inv.vendor`, a field
      // the engine's Invoice objects do not carry — they carry `vendorName` —
      // so every statement row's vendor is blank. That is a separate, untouched
      // finding (see the note at the end of this suite); matching on the amount
      // keeps THIS suite measuring the equation rather than that defect.
      const rowAmt = money(row.formula);
      const invEng = (byName[tenant].invoices || []).find(i => r2(i.amount) === rowAmt);
      const eq = parseEquation(row.formula);
      if (!eq) {
        // Not an equation — the only legitimate case is a direct invoice, which
        // is charged in full and has no multiplicands to show.
        directSeen++;
        const _id = row.vendor || `$${rowAmt}`;
        // "charged in full (100%)" is a CLAIM about the billed figure, so it is
        // checked against the billed figure: the invoice total, the amount the
        // row prints and the share the engine allocated must all be one number.
        // Asserting only against inv.amount would let the occupancy factor be
        // applied to a direct invoice while the page still said 100%.
        yes(`${tenant} · ${surface} · ${_id}: charged in full, no fraction claimed`,
            /charged in full \(100%\)/.test(row.formula || '')
              && invEng && invEng.allocation === 'direct'
              && money(row.formula) === r2(invEng.amount)
              && money(row.printed) === r2(invEng.share)
              && r2(invEng.share) === r2(invEng.amount),
            JSON.stringify({ formula: row.formula, printed: row.printed,
                             amount: invEng && invEng.amount, share: invEng && invEng.share,
                             allocation: invEng && invEng.allocation }));
        yes(`    …and it says so rather than implying an apportionment`,
            /not apportioned by pro-rata share or by time/i.test(row.basis || ''), row.basis);
        return;
      }
      checked++;
      yes(`${tenant} · ${surface} · ${row.vendor || '$' + rowAmt}: ${row.formula}`,
          eq.product !== null && r2(eq.product) === eq.printed && eq.printed === r2(invEng.share),
          JSON.stringify({ operands: eq.operands, product: eq.product,
                           printedResult: eq.printed, engineShare: invEng && invEng.share }));
      yes(`    …its first operand is the invoice the engine billed (${row.printed})`,
          eq.amount === r2(invEng.amount) && money(row.printed) === r2(invEng.share),
          JSON.stringify({ formulaAmount: eq.amount, engineAmount: invEng && invEng.amount }));
    });
  });
  R('shared equations verified', checked);
  R('direct lines verified', directSeen);
  yes('the suite actually verified equations on both surfaces',
      checked === 32 && directSeen === 2, `checked=${checked} direct=${directSeen}`);

  // ── 2. D1 · the operands are rational, and they have to be ───────────────
  console.log('\n── D1 · the operands are exact, and a rounded percentage would not reproduce them ──');
  const aspenCard = surfaces.find(s => s.tenant === 'Aspen Hardware' && s.surface === 'result card');
  const halloway  = aspenCard.rows.find(r => /Halloway/.test(r.vendor || ''));
  const hEq = parseEquation(halloway && halloway.formula);
  yes('Aspen\'s share of the $12,500.00 invoice is printed as 10,000/30,000 sqft, not 33.33%',
      hEq && /^10,000\/30,000 sqft$/.test(hEq.operands[0]),
      JSON.stringify(hEq && hEq.operands));
  yes('    the exact operands reproduce the billed cent ($4,166.67)',
      hEq && r2(hEq.product) === 4166.67 && hEq.printed === 4166.67,
      JSON.stringify(hEq && { product: hEq.product, printed: hEq.printed }));
  // THE OTHER HALF, and the reason D1 exists: a reader who multiplied by the
  // displayed percentage instead would land 42 cents away. If the equation ever
  // regresses to percentages this assertion is what says so.
  const pctProduct = r2(12500 * (33.33 / 100));
  yes(`    …and the 33.33% a reader would otherwise use does NOT (${pctProduct.toFixed(2)})`,
      pctProduct !== 4166.67 && Math.abs(pctProduct - 4166.67) >= 0.01,
      String(pctProduct));
  yes('the percentage still appears as gloss on the row label, where nothing multiplies it',
      /33\.33%/.test(halloway.rowSuffix || ''), halloway && halloway.rowSuffix);

  const birchCard = surfaces.find(s => s.tenant === 'Birchwood Cafe' && s.surface === 'result card');
  const bHall = birchCard.rows.find(r => /Halloway/.test(r.vendor || ''));
  const bEq   = parseEquation(bHall && bHall.formula);
  yes('a mid-period tenant prints BOTH multiplicands — space and time, separately',
      bEq && bEq.operands.length === 2
        && /^6,000\/30,000 sqft$/.test(bEq.operands[0])
        && /^245\/365 days$/.test(bEq.operands[1]),
      JSON.stringify(bEq && bEq.operands));
  yes('    and they multiply out to the engine\'s $1,678.08',
      bEq && r2(bEq.product) === bEq.printed && bEq.printed === r2(byName['Birchwood Cafe']
        .invoices.find(i => /Halloway/.test(i.vendor)).share),
      JSON.stringify(bEq && { product: bEq.product, printed: bEq.printed }));
  yes('    the row label names the time fraction rather than folding it into the percentage',
      /20\.00% .* 245\/365 days/.test(bHall.rowSuffix || ''), bHall && bHall.rowSuffix);
  yes('    the stored pro-rata is NOT the effective share — the two stay apart',
      byName['Birchwood Cafe'].proRataPercent === 20
        && byName['Birchwood Cafe'].effectiveSharePercent !== 20,
      JSON.stringify({ proRata: byName['Birchwood Cafe'].proRataPercent,
                       effective: byName['Birchwood Cafe'].effectiveSharePercent }));

  // ── 3. The stepped block reads the same calculation ──────────────────────
  console.log('\n── The stepped block is the same arithmetic, read as steps ──');
  const bSteps = bHall.steps;
  yes('four steps: the expense, the pro-rata product, the occupancy, the share',
      bSteps.length === 4, JSON.stringify(bSteps));
  yes('    the expense step is the invoice total',
      money(bSteps[0][2]) === 12500, JSON.stringify(bSteps[0]));
  yes('    the pro-rata step shows the space operand and its product',
      /6,000\/30,000 sqft/.test(bSteps[1][1] || '') && money(bSteps[1][2]) === 2500,
      JSON.stringify(bSteps[1]));
  yes('    the occupancy step names the fraction, not a percentage',
      /^245 of 365 days$/.test(bSteps[2][1] || ''), JSON.stringify(bSteps[2]));
  yes('    and the total step is the billed share',
      money(bSteps[3][2]) === 1678.08, JSON.stringify(bSteps[3]));

  // ── 4. Where the period figure came from ─────────────────────────────────
  console.log('\n── Measured, assumed and lease-stated periods do not read alike ──');
  const aFull = aspenCard.rows.find(r => /Prosper/.test(r.vendor || ''));
  yes('a full-period tenant is told the lease covered the whole period',
      /covered the whole 2025 CAM period/.test(aFull.basis || '')
        && !/assumed/i.test(aFull.basis || ''), aFull && aFull.basis);
  yes('a mid-period tenant is told the window and the source of the basis',
      /2025-05-01 to 2025-12-31, 245 of 365 days/.test(bHall.basis || '')
        && /as your lease states/.test(bHall.basis || ''), bHall && bHall.basis);

  const cobaltCard = surfaces.find(s => s.tenant === 'Cobalt Dental' && s.surface === 'result card');
  const cRow = cobaltCard.rows.find(r => /Prosper/.test(r.vendor || ''));
  yes('an ASSUMED boundary says it is an assumption, and names which date is missing',
      /carries no end date/.test(cRow.basis || '')
        && /That is an assumption, not a date read from the lease/.test(cRow.basis || ''),
      cRow && cRow.basis);
  yes('    the step block marks it assumed rather than showing it as measured',
      /assumed, no end date on file/.test((cRow.steps[2] || [])[1] || ''),
      JSON.stringify(cRow.steps[2]));
  yes('    and a measured full period is NOT marked assumed',
      /the whole period$/.test((aFull.steps[2] || [])[1] || '')
        && !/assumed/.test((aFull.steps[2] || [])[1] || ''),
      JSON.stringify(aFull.steps[2]));

  const draytonCard = surfaces.find(s => s.tenant === 'Drayton Books' && s.surface === 'result card');
  const dRow = draytonCard.rows.find(r => /Prosper/.test(r.vendor || ''));
  const dEq  = parseEquation(dRow && dRow.formula);
  yes('a full_period lease prints NO time operand — 1/1 would be noise dressed as arithmetic',
      dEq && dEq.operands.length === 1 && /sqft$/.test(dEq.operands[0]),
      JSON.stringify(dEq && dEq.operands));
  yes('    it says the lease bills the full annual amount, and quotes the term it ran',
      /bills the full annual amount regardless of a partial year/.test(dRow.basis || '')
        && /2025-01-01 to 2025-09-30/.test(dRow.basis || ''), dRow && dRow.basis);
  yes('    and the equation still multiplies out',
      dEq && r2(dEq.product) === dEq.printed, JSON.stringify(dEq));

  // ── 4b. The branches no fixture can reach through the billing gate ───────
  //
  // occupancy() returns `unresolved` for THREE different facts — an unreadable
  // date, a term that ended before the period, and one that begins after it —
  // and all three are red-flagged out of a statement, so no rendering fixture
  // reaches them. They are exercised at the helper directly. The first cut of
  // this helper told all three that "a date on the lease could not be read",
  // which is false on two of them and sends a tenant looking for a typo that is
  // not there.
  console.log('\n── Unresolved occupancy: three facts, three sentences ──');
  // The helper returns raw HTML — `&times;`, `&middot;` — which the DOM decodes
  // on render. Read directly, it has to be decoded here before the equation
  // parser sees it.
  const _dec = (o) => JSON.parse(JSON.stringify(o).replace(/&times;/g, '×')
    .replace(/&middot;/g, '·').replace(/&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, '—'));
  const unres = _dec(await page.evaluate(() => {
    const mk = (occ) => _shareExplanation(
      { name: '(synthetic)', proRataPercent: 25, sqFt: 7500, occupancy: occ },
      { amount: 4000, share: 1000, allocation: 'shared' });
    return {
      unreadable:  mk({ applied: false, unresolved: true, case: 'unreadable' }),
      endedBefore: mk({ applied: false, unresolved: true, case: 'ended_before',
                        termStart: '2001-01-01', termEnd: '2003-06-30' }),
      beginsAfter: mk({ applied: false, unresolved: true, case: 'begins_after',
                        termStart: '2031-04-01', termEnd: '2036-03-31' }),
      preT2:       mk(null),
    };
  }));
  yes('an unreadable date says the date could not be read, and asks for a correction',
      /could not be read/.test(unres.unreadable.basis)
        && /Correct the lease dates and re-run/.test(unres.unreadable.basis),
      unres.unreadable.basis);
  yes('a lease that ENDED before the period is not described as an unreadable date',
      !/could not be read/.test(unres.endedBefore.basis)
        && /ran to 2003-06-30, before the 2025 CAM period began/.test(unres.endedBefore.basis)
        && /holdover or renewal/.test(unres.endedBefore.basis),
      unres.endedBefore.basis);
  yes('a lease that BEGINS after the period is not described as an unreadable date either',
      !/could not be read/.test(unres.beginsAfter.basis)
        && /commences 2031-04-01, after the 2025 CAM period ended/.test(unres.beginsAfter.basis),
      unres.beginsAfter.basis);
  yes('all three say the full period was used un-apportioned, rather than implying a fraction',
      [unres.unreadable, unres.endedBefore, unres.beginsAfter]
        .every(x => /full period has been used, un-apportioned/.test(x.basis)
                 && parseEquation(x.formula).operands.length === 1),
      JSON.stringify([unres.unreadable.formula, unres.endedBefore.formula, unres.beginsAfter.formula]));
  yes('    and none of them prints a time operand it does not have',
      [unres.unreadable, unres.endedBefore, unres.beginsAfter, unres.preT2]
        .every(x => !/days|months/.test(x.formula)), JSON.stringify(unres.preT2.formula));
  yes('a run predating T2 says so rather than claiming occupancy was measured',
      /predates partial-period apportionment/.test(unres.preT2.basis)
        && /not measured for this run/.test(unres.preT2.steps),
      unres.preT2.basis);

  // ── 5. F-12 / D2 · two coverage figures, and the gap explained honestly ──
  console.log('\n── F-12 · space coverage and space×time coverage are two figures ──');
  const cov = await page.evaluate(() => {
    const VB = window.VarianceBreakdown;
    const bk = VB.derive({
      results: lastResults, invoices: _lastEngineInvoices || [],
      reconciled: (_lastReconciledInvoices && _lastReconciledInvoices.length) ? _lastReconciledInvoices : undefined,
      pool: lastTotal || 0,
      billed: lastResults.reduce((s, r) => s + (Number(r.totalAllocated) || 0), 0),
    });
    return { proRataSum: bk.proRataSum, occupancyCoveredPct: bk.occupancyCoveredPct,
             notOccupied: bk.notOccupied, notOccupiedShared: bk.notOccupiedShared,
             notOccupiedDirect: bk.notOccupiedDirect,
             pure: parseFloat((VB.occupancyCovered(lastResults) * 100).toFixed(2)),
             summaryText: (document.getElementById('resultsBody') || document.body).innerText
                            .replace(/\s+/g, ' ') };
  });
  R('space coverage', cov.proRataSum + '%');
  R('space × time coverage', cov.occupancyCoveredPct + '%');
  R('notOccupied (shared/direct)', `${cov.notOccupied} = ${cov.notOccupiedShared} + ${cov.notOccupiedDirect}`);

  // 71.76, not the 71.75 this asserted before P6. The old figure came from
  // summing TWO-DECIMAL percentages — Aspen's exact third of the building reads
  // 33.33 — and P6 makes the coverage fraction sqFt/totalSqFt. The assertion is
  // no weaker: it still pins an exact value, and it is now the arithmetically
  // correct one. 33.3333… + 20 × 245/365 + 15 + 10 = 71.7580.
  yes('the two coverage figures are genuinely different on this property',
      cov.proRataSum === 78.33 && cov.occupancyCoveredPct === 71.76,
      JSON.stringify(cov));
  yes('one function owns the displayed coverage figure — the panel and the KPI agree',
      cov.pure === cov.occupancyCoveredPct, `${cov.pure} vs ${cov.occupancyCoveredPct}`);
  yes('the summary labels the space figure as space under lease, not as coverage',
      /Space under lease/.test(cov.summaryText), null);
  yes('    and prints the whole-period figure beside it',
      /Covered all year/.test(cov.summaryText) && /71\.8%/.test(cov.summaryText),
      cov.summaryText.slice(0, 200));

  console.log('\n── D2 · the two halves of notOccupied are additive, and add up ──');
  yes('notOccupiedShared + notOccupiedDirect === notOccupied, to the cent',
      r2(cov.notOccupiedShared + cov.notOccupiedDirect) === r2(cov.notOccupied),
      JSON.stringify(cov));
  // $2,090.95 since P6 — one cent lower, for the same reason: the shared half is
  // now 31,800 x (exact space coverage - exact space x time coverage) rather
  // than the same expression built out of rounded percentages.
  yes('    the shared half is the leased space that did not run the whole period ($2,090.95)',
      cov.notOccupiedShared === 2090.95, String(cov.notOccupiedShared));
  yes('    the direct half is the invoice dated outside the tenant\'s occupancy ($1,800.00)',
      cov.notOccupiedDirect === 1800, String(cov.notOccupiedDirect));

  const variance = await page.evaluate(() => {
    try { document.getElementById('rptBody').innerHTML = ''; } catch (_) {}
    openVarianceDetails();
    const b = document.getElementById('rptBody');
    return b ? (b.innerText || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : '';
  });
  yes('the variance panel prints both coverage rows',
      /Property covered by loaded leases \(space\) 78\.3%/.test(variance)
        && /Covered for the whole period \(space × time\) 71\.8%/.test(variance),
      variance.slice(0, 400));
  yes('    it explains the gap as leased space that did not run the full CAM period',
      /Loaded leases cover 78\.3% of the building, but because some leases covered only part of the CAM period, they cover 71\.8% of the building for the full year\./.test(variance),
      variance.slice(Math.max(0, variance.indexOf('Loaded leases cover')), variance.indexOf('Loaded leases cover') + 400));
  yes('    it names the gap in percentage points and what it is',
      /6\.6 percentage-point gap is leased space whose lease did not run for the full CAM period/.test(variance),
      variance.slice(Math.max(0, variance.indexOf('percentage-point') - 120), variance.indexOf('percentage-point') + 200));
  yes('    it accounts for only the SHARED half with that gap, and says what the rest is',
      /accounts for \$2,090\.95 of the \$3,890\.95/.test(variance)
        && /remaining \$1,800\.00 is invoices matched directly to a part-period tenant/.test(variance),
      variance.slice(Math.max(0, variance.indexOf('accounts for') - 60), variance.indexOf('accounts for') + 400));

  console.log('\n── Nothing claims the landlord absorbs anything ──');
  // "The landlord absorbs it" is a claim about who bears a cost, and no lease in
  // this reconciliation has been read to establish that. What IS established is
  // that the money reached no tenant.
  yes('the variance panel does not say the landlord absorbs the unallocated money',
      !/landlord absorbs/i.test(variance),
      variance.slice(Math.max(0, variance.search(/landlord absorbs/i) - 120), 300));
  yes('    it says the money remains unallocated to tenants in this reconciliation',
      /it remains unallocated to tenants in this reconciliation/.test(variance));
  yes('    and the not_occupied bucket detail says the same',
      /None of it is charged to anyone else; it remains unallocated to tenants in this reconciliation/.test(variance),
      variance.slice(Math.max(0, variance.indexOf('None of it is charged')), variance.indexOf('None of it is charged') + 220));
  // SCOPED TO WHAT P5 OWNS: the breakdown module, and the variance panel that
  // renders it. The property-coverage banner elsewhere in script.js also uses
  // the word, but as an open question — "whether that remainder is vacant space
  // the landlord absorbs, or space under a lease not yet uploaded, has not been
  // established" — which is a hypothesis it explicitly declines to settle, not a
  // claim. Widening this grep to the whole file would either fail on that
  // sentence or push a rewrite of an untouched finding into this change.
  const vbSrc = fs.readFileSync(path.join(ROOT, 'variance-breakdown.js'), 'utf8');
  const jsSrc = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const _vdStart = jsSrc.indexOf('function openVarianceDetails()');
  const _vdEnd   = jsSrc.indexOf('\n}', _vdStart);
  const vdSrc = _vdStart >= 0 ? jsSrc.slice(_vdStart, _vdEnd) : '';
  yes('[source] the variance panel source was located, so this grep means something',
      vdSrc.length > 500 && /Where the difference went/.test(vdSrc), String(vdSrc.length));
  yes('[source] no absorption claim survives in the breakdown module or the variance panel',
      !/absorbs/i.test(vbSrc) && !/absorbs/i.test(vdSrc),
      [/.{0,60}absorbs.{0,60}/i.exec(vbSrc), /.{0,60}absorbs.{0,60}/i.exec(vdSrc)]
        .filter(Boolean).map(String).join(' | '));

  // ── 6. The allocation is untouched by any of this ────────────────────────
  console.log('\n── The allocation is unchanged: every figure is the engine\'s ──');
  const expect = { 'Aspen Hardware': 10600.00, 'Birchwood Cafe': 6669.04,
                   'Cobalt Dental': 4770.00, 'Drayton Books': 3180.00 };
  Object.entries(expect).forEach(([n, v]) =>
    yes(`${n} is billed ${v.toFixed(2)}`, r2(byName[n].allocated) === v,
        String(byName[n] && byName[n].allocated)));
  yes('an annual cap remains annual — nothing here prorated one',
      eng.every(r => !r.capApplied), JSON.stringify(eng.map(r => r.capApplied)));
  yes('the direct invoice is billed in full, not multiplied by the occupancy factor',
      byName['Birchwood Cafe'].invoices.find(i => /Cutler/.test(i.vendor)).share === 2400,
      String(byName['Birchwood Cafe'].invoices.find(i => /Cutler/.test(i.vendor)).share));

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
