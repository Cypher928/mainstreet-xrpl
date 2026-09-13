'use strict';
/**
 * test-e2e-ambiguity-persistence.js — N5. A billing block must survive a reload.
 *
 *   node test-e2e-ambiguity-persistence.js
 *
 * THE DEFECT THIS EXISTS TO HOLD DOWN.
 *
 * An invoice reading "Fairlane Glazing units 210 and 214" names two tenants
 * equally well. matchInvoiceToTenant records the tie, the audit layer raises a
 * blocksBilling finding for each tied candidate, and the tenant statement is
 * refused. That is P7 and test-e2e-match-warnings.js pins it on a fresh run.
 *
 * It did not survive being saved. Measured on this fixture before the fix:
 *
 *   fresh     1 ambiguous invoice, 2 blocking findings, Alder NOT billable
 *   reloaded  0 ambiguous invoices, 0 blocking findings, Alder BILLABLE
 *
 * Same reconciliation, same money, same tenants — and a statement that would
 * now issue for a $5,000 charge nobody has established is theirs. The gate did
 * not fail; it was never asked, because the tie was not on the record it reads.
 *
 * WHERE THE RECORD LIVES, which is what this suite actually tests.
 *
 *   matchInvoiceToTenant   decides the tie          (the only authority on it)
 *   runAllocation          writes it onto invoiceData — the invoice register
 *   buildAuditSummary      reads invoiceData        (paidInvData) and raises
 *   _statementReadinessBlock  refuses on the finding
 *   saveProperty           prop.invoices = Array.from(invoiceData)
 *   _stripBlobs            REBUILDS EACH INVOICE FROM AN ALLOW-LIST  ← the cut
 *   renderProperty         invoiceData ← property.invoices
 *
 * So the assertions below are not "is there a warning on screen". They walk
 * that chain: the register, the persisted BYTES, the register again after a
 * real reload, the audit summary, the exposure gate, and finally the statement
 * generator itself — on BOTH the fresh and the restored path.
 *
 * WHAT IT MUST NOT DO, and each has an assertion of its own:
 *   • fabricate ambiguity on reload (the four ordinary shared invoices stay
 *     ordinary — not ambiguous, no candidates, no finding),
 *   • promote the near-miss advisory into a blocker,
 *   • move a single cent of anyone's allocation.
 *
 * AND THE SECOND HALF OF THE SAME HOLE. N5 left `matchConfidence` out of the
 * allow-list, reasoning that runFullReconciliation recomputes it — true of a
 * re-run, and irrelevant to a RESTORE, which never re-runs the engine. On the
 * restored path `_lastEngineInvoices` falls back to the register
 * (script.js:26253; `snapshot.engineInvoices` is read at 26247 and written
 * nowhere, so the fallback is the only branch) and VarianceBreakdown decides
 * direct-vs-shared with `(Number(inv.matchConfidence) || 0) >= 75`
 * (variance-breakdown.js:285). Absent, that reads 0.
 *
 *   fresh     "1 invoice directly matched to tenant, 5 shared pro-rata"
 *   reloaded  "6 invoices allocated as shared CAM expenses (pro-rata)"
 *
 * Same money, two different accounts of who owes it and why — an invoice billed
 * in full to one tenant, reported on reopening as a pro-rata share of everyone's.
 * The block below that was a printed diagnostic while that was known and
 * unfixed is assertions now.
 *
 * DETERMINISM
 * Fixed timezone, fixed fixture, own port and localStorage key, no egress. The
 * mock store is seeded ONCE and then persists across the reload — clearing it
 * on every navigation is how a reload test quietly becomes a fresh-boot test.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';
let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-ambiguity-persistence: playwright is not installed.\x1b[0m');
      console.error('This suite reloads a real page and re-reads the billing gate out of a real');
      console.error('DOM. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-ambiguity-persistence SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Whether a billing block survives save/reload was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7991', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(40) + ':', typeof v === 'string' ? v : JSON.stringify(v));
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

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
// Deliberately the same shape as test-e2e-match-warnings.js: 40,000 sqft, CAM
// 2025, four full-period NNN tenants with no caps and no exclusions, so nothing
// unrelated competes for the billing gate and any block that appears is the one
// under test.
//
//   Alder Bakery   Unit 210   ← half of the tie
//   Birch Optical  Unit 214   ← the other half
//   Cedar Fitness  Unit 5     ← the near-miss tenant ("5" is below MIN_UNIT_LEN)
//   Dogwood Deli   Unit 320   ← the CONTROL. Involved in nothing, ever.
const PROP_ID    = 'ap-prop-000000000001';
const CAM_YEAR   = 2025;
const TOTAL_SQFT = 40000;

const TENANTS = [
  { id: 'ap-t-alder', tenant_name: 'Alder Bakery',  unitNumber: '210', leased_sqft: 12000 },
  { id: 'ap-t-birch', tenant_name: 'Birch Optical', unitNumber: '214', leased_sqft: 10000 },
  { id: 'ap-t-cedar', tenant_name: 'Cedar Fitness', unitNumber: '5',   leased_sqft:  8000 },
  { id: 'ap-t-dogwd', tenant_name: 'Dogwood Deli',  unitNumber: '320', leased_sqft:  6000 },
].map(t => ({ ...t, lease_type: 'Triple Net (NNN)',
  start_date: '2018-01-01', end_date: '2033-12-31',
  cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' }));

const AMBIG_VENDOR = 'Fairlane Glazing units 210 and 214';
const TIED_NAMES   = ['Alder Bakery', 'Birch Optical'];
const CONTROL      = 'Dogwood Deli';

const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
const INVOICES = [
  // Four ordinary shared expenses. None of them names anybody. After the fix
  // they must restore as exactly what they were — the "do not fabricate
  // ambiguity on reload" assertion is struck against these four.
  { id: 'ap-i-1', vendorName: 'Halloway Janitorial', amount: '12000', category: 'janitorial',
    invoiceDate: '2025-03-05', camEligible: true, ...doc('hal') },
  { id: 'ap-i-2', vendorName: 'Prosper Insurance',   amount:  '9000', category: 'insurance',
    invoiceDate: '2025-06-01', camEligible: true, ...doc('pro') },
  { id: 'ap-i-3', vendorName: 'Meriden Utilities',   amount:  '6000', category: 'utilities',
    invoiceDate: '2025-10-20', camEligible: true, ...doc('mer') },
  { id: 'ap-i-4', vendorName: 'Ashgrove Security',   amount:  '4000', category: 'security',
    invoiceDate: '2025-11-02', camEligible: true, ...doc('ash') },
  // THE TIE. Units 210 and 214 hit equally at confidence 90; `conf > bestConf`
  // is strict, so the whole $5,000 goes to whichever lease was read first.
  { id: 'ap-i-5', vendorName: AMBIG_VENDOR, amount: '5000',
    category: 'repairs', invoiceDate: '2025-07-14', camEligible: true, ...doc('fai') },
  // THE NEAR MISS. Advisory, never blocking — asserted as such on both paths.
  { id: 'ap-i-6', vendorName: 'Cutler Submeter read for Unit 5', amount: '2000',
    category: 'utilities', invoiceDate: '2025-08-09', camEligible: true, ...doc('cut') },
];

// SEEDED ONCE, THEN LEFT ALONE. addInitScript re-runs on every navigation, so a
// `removeItem` here would wipe the store the reload is supposed to read back —
// the suite would still pass every fresh assertion and silently test nothing.
const MOCK = `
(function () {
  var USER_ID='ap-user', _user={id:USER_ID,email:'ap@e2e-test.local'}, _session=null;
  var KEY='__ap_store', BOOT='__ap_booted';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Marlow Court',sqft:${TOTAL_SQFT},
    data:{invoices:${JSON.stringify(INVOICES)},disputes:[],camYear:${CAM_YEAR},results:null,camReconciliation:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(TENANTS)}}}],tenants:[]};
  try {
    if (!localStorage.getItem(BOOT)) {
      localStorage.removeItem(KEY);
      localStorage.setItem(BOOT, '1');
    }
  } catch (e) {}
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

// ── One read, taken identically on the fresh and the restored page ──────────
//
// Everything here is struck from the LIVE objects the product itself consults,
// not from anything the test kept in hand: the register, a freshly built audit
// summary, and the exposure derived from it.
const READ = () => {
  const summary = (typeof buildAuditSummary === 'function')
    ? buildAuditSummary() : { red: [], yellow: [], green: [] };
  // deriveExposure takes the BUCKETED summary. A flat array yields empty
  // buckets and every tenant reads as billable — a green assertion about
  // nothing, which is exactly the failure mode this suite is about.
  const expo = window.AuditExposure.deriveExposure(summary, lastTotal || 0);
  const flat = [...(summary.red || []), ...(summary.yellow || [])];
  return {
    // THE REGISTER — the input the ambiguity detector actually filters.
    register: (invoiceData || []).map(i => ({
      vendor:    i && i.vendorName,
      ambiguous: !!(i && i.matchAmbiguous),
      // THE DIRECT/SHARED DECISION. Read as a raw value, not coerced — the
      // defect this closes was `undefined` reading as 0 downstream, and a
      // `|| 0` here would reproduce the coercion inside the assertion and hide
      // exactly what it is meant to catch.
      confidence: i ? i.matchConfidence : undefined,
      billedTo:  i ? i.matchedTenant : undefined,
      tied:      ((i && i.matchTied) || []).map(c => c.tenantName).sort(),
      near:      ((i && i.matchNearMisses) || [])
                   .map(n => `${n.signal}:${n.token}:${n.tenantName}`).sort(),
    })),
    // THE CLASSIFICATION VarianceBreakdown ACTUALLY MAKES, struck the way it
    // strikes it (variance-breakdown.js:285) from the list it actually reads on
    // this path — `_lastEngineInvoices`, which on a restore is the register.
    varianceClass: (typeof _lastEngineInvoices !== 'undefined' ? (_lastEngineInvoices || []) : [])
      .map(i => [i && i.vendorName, ((Number(i && i.matchConfidence) || 0) >= 75) ? 'direct' : 'shared']),
    // THE BREAKDOWN THE PANEL ACTUALLY RENDERS, not one this suite re-derives.
    // _buildReconciliationSummaryHtml caches it (script.js:12854) and passes
    // `pool` and `billed` explicitly — a derive() call that omits them reads
    // `Number(a.pool) || 0` as zero (variance-breakdown.js:126) and returns a
    // breakdown of nothing, which would make the equality below pass by
    // comparing two empty objects. Populated on both paths: runAllocation on the
    // fresh one, restoreResultsDisplay on the restored one.
    varianceBuckets: (() => {
      try {
        const d = (typeof _lastVarianceBreakdown !== 'undefined') ? _lastVarianceBreakdown : null;
        if (!d) return { error: 'no cached breakdown' };
        // Round to the cent so a float tail cannot fail an equality that is
        // about attribution rather than about IEEE-754.
        const r = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
        return {
          pool: r(d.pool), billed: r(d.billed), difference: r(d.difference),
          outOfYear: r(d.outOfYear), notEligible: r(d.notEligible),
          uncovered: r(d.uncovered), notOccupied: r(d.notOccupied),
          claimShortfall: r(d.claimShortfall), excludedByLease: r(d.excludedByLease),
          unclaimed: r(d.unclaimed), roundingResidue: r(d.roundingResidue),
          capTotal: r(d.capTotal), residual: r(d.residual), explained: d.explained,
          precision: d.precision,
          // The per-invoice reason codes are where a direct/shared misread
          // actually lands: an invoice billed in full to one tenant and one
          // split pro-rata are attributed to different buckets.
          reasons: (d.invoices || []).map(x => [x.vendorName || x.vendor, x.reason]),
        };
      } catch (e) { return { error: e && e.message }; }
    })(),
    findings: flat.map(f => ({
      title: f.title, severity: f.severity, blocksBilling: !!f.blocksBilling,
      conditions: f.conditions || [], detail: f.detail || '',
    })),
    blockingByTenant: Object.fromEntries(Object.entries((expo.blocking || {}).byTenant || {})
      .map(([k, v]) => [k, v.map(b => b.title).sort()])),
    blockingProperty: ((expo.blocking || {}).property || []).map(b => b.title).sort(),
    // Green findings never block, so they carry no assertion — but the
    // direct-vs-shared count lives here, and it is the one surface where the
    // unpersisted matchConfidence shows. Collected so the divergence is
    // reported rather than assumed absent.
    greenTitles: (summary.green || []).map(f => f.title),
    billable: Object.fromEntries((lastResults || []).map(r => [r.name,
      window.AuditExposure.billingReadiness(expo, r.name).canBill])),
    allocations: Object.fromEntries((lastResults || []).map(r => [r.name, r.totalAllocated])),
    resultCards: document.querySelectorAll('.result-card').length,
  };
};

// THE REAL STATEMENT GENERATOR, not a proxy for it. generateTenantStatement
// either renders the refusal report or renders a statement carrying a figure;
// this reports which, off the DOM it left behind.
const STATEMENT = (tenantName) => {
  const ov = document.getElementById('reportOverlay');
  if (ov) ov.style.display = 'none';
  const body = document.getElementById('rptBody');
  if (body) body.innerHTML = '';
  let threw = null;
  try { generateTenantStatement(tenantName); } catch (e) { threw = e.message; }
  const title = (document.getElementById('rptToolbarTitle') || {}).textContent || '';
  const b     = document.getElementById('rptBody');
  const text  = b ? (b.innerText || '').replace(/\s+/g, ' ').trim() : '';
  return {
    threw, title,
    blockedShell: !!(b && b.querySelector('.rpt-readiness--blocked')),
    saysNotIssued: /has not been issued/i.test(text),
    // The number a statement leads with. Its ABSENCE is the point: a blocked
    // tenant must never be handed a "Total CAM Billed to You" figure.
    // CASE-INSENSITIVE ON PURPOSE — the heading is upper-cased in CSS, so
    // innerText returns "TOTAL CAM BILLED TO YOU". A case-sensitive read finds
    // nothing on a statement that HAS the figure, which makes "no figure was
    // handed over" pass for the one reason that would make it worthless.
    billedFigure: (text.match(/Total CAM Billed to You \$[\d,]+\.\d\d/i) || [null])[0],
    head: text.slice(0, 160),
  };
};

// THE SECOND SIGN-IN — the one after the reload — is where this suite's own
// copy of the login block failed a full regression run, on the same appUp wait
// that took three other suites. submitAuth disables the button before it
// awaits, so the retry above was clicking a dead control; the shared helper
// re-enables first, which is what makes a retry work at all.
async function signIn(page, errors) {
  await _e2eSignIn(page, { email: 'ap@e2e-test.local', errors });
  await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
}

async function openProperty(page) {
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction((n) => typeof tenantData !== 'undefined'
    && tenantData.filter(Boolean).length === n, TENANTS.length, { timeout: 45000 });
}

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  console.log('\n══ N5 — a billing block survives save and reload ══');

  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  // Same sink, same semantics — thrown exceptions only, so the "no uncaught
  // page errors" assertion at the end of the run is unchanged.
  const errors = attachDiagnostics(page);
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    return route.abort();
  });
  await ctx.addInitScript(MOCK);

  try {
    // ── 1–3. An ambiguous invoice, reconciled, blocking billing ────────────
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await signIn(page, errors);
    await openProperty(page);
    await page.evaluate(async () => { await runAllocation(); });
    await page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                               TENANTS.length, { timeout: 60000 });
    await page.waitForSelector('.result-card', { state: 'attached', timeout: 20000 });
    const fresh = await page.evaluate(READ);

    H('Fresh: the tie is recorded, and it blocks');
    const fAmb = fresh.register.filter(r => r.ambiguous);
    R('ambiguous invoices', fAmb.map(r => r.vendor));
    R('tied candidates', fAmb.map(r => r.tied));
    R('blocking findings', fresh.findings.filter(f => f.blocksBilling).map(f => f.title));
    R('billable', fresh.billable);
    R('allocations', fresh.allocations);

    yes('the register carries exactly one ambiguous invoice',
        fAmb.length === 1 && fAmb[0].vendor === AMBIG_VENDOR,
        JSON.stringify(fAmb));
    yes('and it names both tied tenants',
        JSON.stringify(fAmb[0] && fAmb[0].tied) === JSON.stringify(TIED_NAMES),
        JSON.stringify(fAmb[0] && fAmb[0].tied));

    const fBlockTitles = fresh.findings.filter(f => f.blocksBilling).map(f => f.title).sort();
    const fAmbFindings = fresh.findings.filter(f => f.title.includes(AMBIG_VENDOR));
    yes('one blocking finding per tied candidate', fAmbFindings.length === 2,
        `saw ${fAmbFindings.length}: ${JSON.stringify(fAmbFindings.map(f => f.title))}`);
    yes('and each names the tenant it holds',
        TIED_NAMES.every(n => fAmbFindings.some(f => f.title.includes(n))),
        JSON.stringify(fAmbFindings.map(f => f.title)));
    yes('every ambiguity finding blocks billing',
        fAmbFindings.every(f => f.blocksBilling === true));
    yes('and each is scoped to its own tenant',
        TIED_NAMES.every(n => (fresh.blockingByTenant[n] || []).length > 0),
        JSON.stringify(fresh.blockingByTenant));
    yes('both tied tenants are NOT billable',
        TIED_NAMES.every(n => fresh.billable[n] === false),
        JSON.stringify(fresh.billable));
    yes('and the uninvolved control tenant still is',
        fresh.billable[CONTROL] === true, JSON.stringify(fresh.billable));

    H('Fresh: the statement generator itself refuses');
    const fStmt = await page.evaluate(STATEMENT, TIED_NAMES[0]);
    R('title', fStmt.title);
    R('billed figure', fStmt.billedFigure);
    yes('generateTenantStatement renders the block, not a statement',
        fStmt.blockedShell && fStmt.saysNotIssued && !fStmt.billedFigure,
        JSON.stringify(fStmt));

    // ── 4. Save ────────────────────────────────────────────────────────────
    H('Saved — and what actually reached storage');
    await page.evaluate(async () => {
      const p = currentProperty();
      savePropertyData();
      await saveProperty(p);           // bypass the 800ms debounce, await the write
    });
    const stored = await page.evaluate((PROP_ID) => {
      // The bytes, not the objects. Read back out of the app's own localStorage
      // record and out of the mock database row — both written through
      // _stripBlobs, which is the single boundary under test.
      const out = { ls: null, db: null };
      try {
        const all = JSON.parse(localStorage.getItem(_lsUserKey()) || '{}');
        const p = all[PROP_ID];
        out.ls = (p && p.invoices || []).map(i => ({
          vendor: i.vendorName, ambiguous: i.matchAmbiguous, billedTo: i.matchedTenant,
          confidence: i.matchConfidence,
          tied: (i.matchTied || []).map(c => c.tenantName).sort(),
          near: (i.matchNearMisses || []).map(n => `${n.signal}:${n.token}:${n.tenantName}`).sort(),
          keys: Object.keys(i).sort(),
        }));
      } catch (e) { out.ls = 'ERR ' + e.message; }
      try {
        const row = (window.__store().properties || []).find(r => r.id === PROP_ID);
        out.db = ((row && row.data && row.data.invoices) || []).map(i => ({
          vendor: i.vendorName, ambiguous: i.matchAmbiguous,
          tied: (i.matchTied || []).map(c => c.tenantName).sort(),
        }));
      } catch (e) { out.db = 'ERR ' + e.message; }
      return out;
    }, PROP_ID);
    const lsAmb = (stored.ls || []).filter(i => i.ambiguous === true);
    const dbAmb = (stored.db || []).filter(i => i.ambiguous === true);
    R('persisted ambiguous (localStorage)', lsAmb.map(i => i.vendor));
    R('persisted tied (localStorage)', lsAmb.map(i => i.tied));
    R('persisted ambiguous (db row)', dbAmb.map(i => i.vendor));

    yes('THE TIE REACHED STORAGE — localStorage carries matchAmbiguous',
        lsAmb.length === 1 && lsAmb[0].vendor === AMBIG_VENDOR,
        JSON.stringify(stored.ls));
    yes('    and the tied candidates with it',
        JSON.stringify(lsAmb[0] && lsAmb[0].tied) === JSON.stringify(TIED_NAMES),
        JSON.stringify(lsAmb[0] && lsAmb[0].tied));
    yes('    and the tenant the run actually billed it to',
        !!(lsAmb[0] && TIED_NAMES.includes(lsAmb[0].billedTo)),
        JSON.stringify(lsAmb[0] && lsAmb[0].billedTo));
    yes('    and the direct/shared confidence that classifies it',
        (stored.ls || []).some(i => i.vendor === AMBIG_VENDOR && i.confidence === 90)
          && (stored.ls || []).every(i => typeof i.confidence === 'number'),
        JSON.stringify((stored.ls || []).map(i => [i.vendor, i.confidence])));
    yes('    and the near-miss signal too',
        (stored.ls || []).some(i => i.near.length === 1 && /^unit:5:Cedar Fitness$/.test(i.near[0])),
        JSON.stringify((stored.ls || []).map(i => i.near)));
    yes('    and the Supabase payload agrees with the local one',
        dbAmb.length === 1 && dbAmb[0].vendor === AMBIG_VENDOR
          && JSON.stringify(dbAmb[0].tied) === JSON.stringify(TIED_NAMES),
        JSON.stringify(stored.db));
    yes('the four ordinary shared invoices persist as not ambiguous',
        (stored.ls || []).filter(i => i.vendor !== AMBIG_VENDOR).every(i => !i.ambiguous),
        JSON.stringify((stored.ls || []).map(i => [i.vendor, i.ambiguous])));

    // ── 5. A REAL RELOAD ───────────────────────────────────────────────────
    H('A REAL RELOAD — new page, register rebuilt from stored bytes');
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await signIn(page, errors);
    await openProperty(page);
    await page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                               TENANTS.length, { timeout: 60000 });
    await page.waitForSelector('.result-card', { state: 'attached', timeout: 20000 });
    const back = await page.evaluate(READ);

    // The reload is only meaningful if the reconciliation was RESTORED rather
    // than re-run. runAllocation is never called on this page.
    yes('the saved reconciliation restored (no re-run)',
        back.resultCards === TENANTS.length && Object.keys(back.allocations).length === TENANTS.length,
        `cards ${back.resultCards}, results ${Object.keys(back.allocations).length}`);

    // ── 6. The same ambiguity, from the restored record ────────────────────
    H('Restored: the same tie, still on the record');
    const bAmb = back.register.filter(r => r.ambiguous);
    R('ambiguous invoices', bAmb.map(r => r.vendor));
    R('tied candidates', bAmb.map(r => r.tied));
    R('billable', back.billable);

    yes('the restored register carries the SAME one ambiguous invoice',
        bAmb.length === 1 && bAmb[0].vendor === AMBIG_VENDOR, JSON.stringify(bAmb));
    yes('with the SAME tied candidates, so the finding can still say who',
        JSON.stringify(bAmb[0] && bAmb[0].tied) === JSON.stringify(TIED_NAMES),
        JSON.stringify(bAmb[0] && bAmb[0].tied));
    yes('the register is identical to the fresh one, invoice for invoice',
        JSON.stringify(back.register) === JSON.stringify(fresh.register),
        'fresh: ' + JSON.stringify(fresh.register) + '\n      → back:  ' + JSON.stringify(back.register));

    const bAmbFindings = back.findings.filter(f => f.title.includes(AMBIG_VENDOR));
    yes('the two blocking findings come back',
        bAmbFindings.length === 2 && bAmbFindings.every(f => f.blocksBilling === true),
        JSON.stringify(bAmbFindings));
    yes('    word for word — title, conditions and detail alike',
        JSON.stringify(bAmbFindings) === JSON.stringify(fresh.findings.filter(f => f.title.includes(AMBIG_VENDOR))),
        JSON.stringify(bAmbFindings));

    // THE FINDING MUST STILL BE ABLE TO EXPLAIN ITSELF. Both the detail and the
    // conditions say which tenant this run actually billed — "billed in this
    // run to X because that lease was read first" is the whole reason the hold
    // exists. Restoring the flag without the name put the literal word
    // `undefined` in that sentence, which is a block a manager cannot act on.
    const billedLine = bAmbFindings.flatMap(f =>
      f.conditions.filter(c => /^Billed in this run to:/.test(c)));
    R('"billed in this run to" (restored)', billedLine);
    yes('the restored finding still names who was billed',
        billedLine.length === 2 && billedLine.every(c => TIED_NAMES.includes(c.replace(/^Billed in this run to:\s*/, ''))),
        JSON.stringify(billedLine));
    yes('    and the word "undefined" appears nowhere in it',
        !bAmbFindings.some(f => /undefined/.test(f.detail) || f.conditions.some(c => /undefined/.test(c))),
        JSON.stringify(bAmbFindings.map(f => f.detail)));

    // ── 7. canBill remains false ───────────────────────────────────────────
    H('Restored: the gate still holds');
    yes('BOTH TIED TENANTS REMAIN NOT BILLABLE',
        TIED_NAMES.every(n => back.billable[n] === false), JSON.stringify(back.billable));
    yes('    scoped to themselves, exactly as before',
        JSON.stringify(back.blockingByTenant) === JSON.stringify(fresh.blockingByTenant),
        'fresh: ' + JSON.stringify(fresh.blockingByTenant) + '\n      → back:  ' + JSON.stringify(back.blockingByTenant));
    yes('    and the control tenant is not swept up in it',
        back.billable[CONTROL] === true, JSON.stringify(back.billable));
    yes('the billing verdict is unchanged for every tenant',
        JSON.stringify(back.billable) === JSON.stringify(fresh.billable),
        'fresh: ' + JSON.stringify(fresh.billable) + '\n      → back:  ' + JSON.stringify(back.billable));
    yes('nothing became a PROPERTY-level block',
        JSON.stringify(back.blockingProperty) === JSON.stringify(fresh.blockingProperty),
        JSON.stringify(back.blockingProperty));

    // ── 8. The statement is still refused, through the real generator ──────
    H('Restored: the statement generator still refuses');
    const bStmt = await page.evaluate(STATEMENT, TIED_NAMES[0]);
    R('title', bStmt.title);
    R('billed figure', bStmt.billedFigure);
    R('head', bStmt.head);
    yes('generateTenantStatement STILL renders the block after a reload',
        bStmt.blockedShell && bStmt.saysNotIssued, JSON.stringify(bStmt));
    yes('    and hands the tenant no billed figure',
        !bStmt.billedFigure, String(bStmt.billedFigure));
    yes('    and it did not throw', !bStmt.threw, String(bStmt.threw));
    const bStmt2 = await page.evaluate(STATEMENT, TIED_NAMES[1]);
    yes('the other tied tenant is refused too',
        bStmt2.blockedShell && !bStmt2.billedFigure, JSON.stringify(bStmt2));
    // The control tenant PROVES the refusal is about the tie and not a blanket
    // post-reload refusal — a suite that only asserts "blocked" passes just as
    // well when everything is blocked, which would be a different defect.
    const cStmt = await page.evaluate(STATEMENT, CONTROL);
    R('control statement', cStmt.billedFigure);
    yes('while the uninvolved tenant STILL RECEIVES a statement',
        !cStmt.blockedShell && !!cStmt.billedFigure, JSON.stringify(cStmt));

    // ── 9. Ordinary shared and near-miss fixtures unchanged ────────────────
    H('Ordinary shared invoices stay ordinary');
    const ordinary = back.register.filter(r =>
      r.vendor !== AMBIG_VENDOR && !r.near.length);
    R('ordinary invoices', ordinary.map(r => r.vendor));
    yes('all four ordinary shared invoices restored', ordinary.length === 4,
        JSON.stringify(ordinary.map(r => r.vendor)));
    yes('NO AMBIGUITY WAS FABRICATED ON RELOAD',
        ordinary.every(r => r.ambiguous === false && r.tied.length === 0),
        JSON.stringify(ordinary));
    yes('and no finding names one of them',
        ordinary.every(r => !back.findings.some(f => f.title.includes(r.vendor))),
        JSON.stringify(back.findings.map(f => f.title)));

    H('The near miss is still advisory, not a blocker');
    const bNear = back.register.filter(r => r.near.length);
    R('near-miss invoices', bNear.map(r => [r.vendor, r.near]));
    const nmTitle = f => /mentions? a tenant too briefly to match on/.test(f.title);
    const fNM = fresh.findings.filter(nmTitle);
    const bNM = back.findings.filter(nmTitle);
    yes('the near-miss signal survived the reload',
        bNear.length === 1 && bNear[0].near[0] === 'unit:5:Cedar Fitness',
        JSON.stringify(bNear));
    yes('    and it is NOT ambiguous — a near miss is not a tie',
        bNear.every(r => r.ambiguous === false), JSON.stringify(bNear));
    yes('the near-miss finding is raised on both paths',
        fNM.length === 1 && bNM.length === 1,
        `fresh ${fNM.length}, back ${bNM.length}`);
    yes('    identical wording on both',
        JSON.stringify(bNM) === JSON.stringify(fNM),
        'fresh: ' + JSON.stringify(fNM) + '\n      → back:  ' + JSON.stringify(bNM));
    yes('    ADVISORY, NOT BLOCKING, on both paths',
        fNM.every(f => f.blocksBilling === false) && bNM.every(f => f.blocksBilling === false),
        JSON.stringify(bNM.map(f => f.blocksBilling)));
    yes('and Cedar Fitness — the near-miss tenant — is still billable',
        back.billable['Cedar Fitness'] === true, JSON.stringify(back.billable));

    H('No money moved');
    R('fresh allocations', fresh.allocations);
    R('restored allocations', back.allocations);
    yes('EVERY TENANT ALLOCATION IS IDENTICAL ACROSS THE RELOAD',
        JSON.stringify(back.allocations) === JSON.stringify(fresh.allocations),
        'fresh: ' + JSON.stringify(fresh.allocations) + '\n      → back:  ' + JSON.stringify(back.allocations));

    // ── The direct/shared decision, which used to be the residual ──────────
    //
    // This block was a printed diagnostic while `matchConfidence` was left out
    // of _stripBlobs on purpose. It is assertions now.
    //
    // The reasoning that left it out was that runFullReconciliation recomputes
    // the confidence before anything consults it — true of a re-run, and
    // irrelevant here, because a RESTORE never re-runs the engine.
    // `_lastEngineInvoices` falls back to the register (script.js:26253) and
    // VarianceBreakdown reads `(Number(inv.matchConfidence) || 0) >= 75`
    // (variance-breakdown.js:285). Absent, that is 0: every invoice on a
    // reopened reconciliation was classified shared pro-rata, including one
    // billed in full to a single tenant.
    H('The direct/shared decision survives the reload');
    R('fresh confidences', fresh.register.map(r => [r.vendor, r.confidence]));
    R('restored confidences', back.register.map(r => [r.vendor, r.confidence]));
    yes('the fixture actually contains a DIRECT match to classify',
        fresh.register.some(r => (r.confidence || 0) >= 75),
        JSON.stringify(fresh.register.map(r => r.confidence)));
    yes('every confidence survives the reload unchanged',
        JSON.stringify(back.register.map(r => r.confidence))
          === JSON.stringify(fresh.register.map(r => r.confidence)),
        'fresh: ' + JSON.stringify(fresh.register.map(r => r.confidence)) +
        '\n      → back:  ' + JSON.stringify(back.register.map(r => r.confidence)));
    yes('    and none of them restores as undefined',
        back.register.every(r => typeof r.confidence === 'number'),
        JSON.stringify(back.register.map(r => [r.vendor, typeof r.confidence])));

    H('VarianceBreakdown classifies the same way on both paths');
    R('fresh classification', fresh.varianceClass);
    R('restored classification', back.varianceClass);
    yes('the direct/shared split is identical, invoice for invoice',
        JSON.stringify(back.varianceClass) === JSON.stringify(fresh.varianceClass),
        'fresh: ' + JSON.stringify(fresh.varianceClass) +
        '\n      → back:  ' + JSON.stringify(back.varianceClass));
    yes('    and it still calls the tied invoice DIRECT after the reload',
        (back.varianceClass.find(([v]) => v === AMBIG_VENDOR) || [])[1] === 'direct',
        JSON.stringify(back.varianceClass));
    // READ OFF THE MODULE, NOT RECOMPUTED HERE. `varianceClass` above applies
    // the >= 75 rule in this file, which means it agrees with a mutated module
    // rather than testing it — the two would move together and the equality
    // would still hold. The reason code is VarianceBreakdown's own verdict: an
    // invoice billed in full to one tenant is `fully_allocated`, a pro-rata one
    // is not, so this fails if the module's threshold moves under it.
    const _reasonFor = (b, v) => ((b.varianceBuckets && b.varianceBuckets.reasons) || [])
      .filter(([n]) => n === v).map(([, r]) => r);
    R('tied invoice reason (fresh)', _reasonFor(fresh, AMBIG_VENDOR));
    R('tied invoice reason (restored)', _reasonFor(back, AMBIG_VENDOR));
    yes('    and VarianceBreakdown itself still attributes it as fully allocated',
        JSON.stringify(_reasonFor(back, AMBIG_VENDOR)) === JSON.stringify(['fully_allocated']),
        JSON.stringify(_reasonFor(back, AMBIG_VENDOR)));
    yes('    while a genuinely shared invoice is not attributed that way',
        !_reasonFor(back, 'Halloway Janitorial').includes('fully_allocated'),
        JSON.stringify(_reasonFor(back, 'Halloway Janitorial')));
    R('fresh buckets', fresh.varianceBuckets);
    R('restored buckets', back.varianceBuckets);
    yes('the fixture produced a NON-EMPTY breakdown — the equality has teeth',
        !!(fresh.varianceBuckets && fresh.varianceBuckets.pool > 0
           && fresh.varianceBuckets.billed > 0),
        JSON.stringify(fresh.varianceBuckets));
    yes('the panel cached a breakdown on both paths',
        !!(fresh.varianceBuckets && !fresh.varianceBuckets.error)
          && !!(back.varianceBuckets && !back.varianceBuckets.error),
        JSON.stringify([fresh.varianceBuckets && fresh.varianceBuckets.error,
                        back.varianceBuckets && back.varianceBuckets.error]));
    yes('EVERY VARIANCE BUCKET IS IDENTICAL ACROSS THE RELOAD',
        JSON.stringify(back.varianceBuckets) === JSON.stringify(fresh.varianceBuckets),
        'fresh: ' + JSON.stringify(fresh.varianceBuckets) +
        '\n      → back:  ' + JSON.stringify(back.varianceBuckets));

    H('The audit says the same thing about the same run');
    const fT = fresh.findings.map(f => f.title).concat(fresh.greenTitles);
    const bT = back.findings.map(f => f.title).concat(back.greenTitles);
    R('fresh only', fT.filter(t => !bT.includes(t)));
    R('restored only', bT.filter(t => !fT.includes(t)));
    const _direct = f => /directly matched to tenant/.test(f);
    R('direct/shared finding (fresh)', fresh.greenTitles.filter(_direct));
    R('direct/shared finding (restored)', back.greenTitles.filter(_direct));
    yes('the direct/shared finding is present and identical on both paths',
        fresh.greenTitles.filter(_direct).length === 1
          && JSON.stringify(back.greenTitles.filter(_direct))
             === JSON.stringify(fresh.greenTitles.filter(_direct)),
        'fresh: ' + JSON.stringify(fresh.greenTitles.filter(_direct)) +
        '\n      → back:  ' + JSON.stringify(back.greenTitles.filter(_direct)));
    yes('NO FINDING APPEARS ON ONE PATH AND NOT THE OTHER',
        JSON.stringify(fT.slice().sort()) === JSON.stringify(bT.slice().sort()),
        'fresh only: ' + JSON.stringify(fT.filter(t => !bT.includes(t))) +
        '\n      → restored only: ' + JSON.stringify(bT.filter(t => !fT.includes(t))));

    H('Page errors');
    R('errors', errors.length ? errors : '(none)');
    yes('no uncaught page errors on either path', errors.length === 0, errors.join(' | '));

  } catch (e) {
    bad('suite crashed', e && e.stack ? e.stack : String(e));
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
  }

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
