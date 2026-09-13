'use strict';
/**
 * test-e2e-match-warnings.js — F-14 on the screen a manager actually reads.
 *
 *   node test-e2e-match-warnings.js
 *
 * test-invoice-match-confidence.js pins the matcher and the source. This drives
 * the real reconciliation in a browser and asserts the three behaviours as they
 * render:
 *
 *   ordinary shared invoice  →  no warning, billed normally
 *   genuine ambiguous match  →  named candidates, statements refused
 *   near-match signal        →  advisory finding, allocation unchanged
 *
 * THE NUMBER THIS EXISTS TO HOLD DOWN: before P7, 16 of the 17 charge rows on
 * the Kettle Row fixture carried "⚠ Low confidence invoice match" — every shared
 * line of every tenant, because the flag's condition was the definition of a
 * shared invoice. The assertion below counts them.
 *
 * AND THE ONE IT EXISTS TO RAISE: an invoice naming two units is billed in full
 * to whichever lease was read first. Reversing the tenant order bills the other
 * tenant. This suite runs the SAME fixture in both orders and requires the
 * finding — the candidate set, the block, the wording — to be identical.
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
      console.error('\n\x1b[31mtest-e2e-match-warnings: playwright is not installed.\x1b[0m');
      console.error('This suite reads rendered warnings out of a real DOM and cannot verify');
      console.error('anything without one. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-match-warnings SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Whether a shared invoice still carries a false warning was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7987', 10);
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

// ── The fixture ─────────────────────────────────────────────────────────────
//
// 40,000 sqft, CAM 2025, four tenants, all full-period and all billable on their
// own terms, so nothing unrelated competes for the billing gate.
//
//   Alder Bakery   Unit 210   ← half of the tie
//   Birch Optical  Unit 214   ← the other half
//   Cedar Fitness  Unit 5     ← too short to match on: the near-miss tenant
//   Dogwood Deli   Unit 320   ← the CONTROL. Involved in nothing.
//
// Four ordinary shared invoices, one deliberately ambiguous, one near-miss.
const PROP_ID    = 'mw-prop-000000000001';
const CAM_YEAR   = 2025;
const TOTAL_SQFT = 40000;

const TENANT_A = { id: 'mw-t-alder', tenant_name: 'Alder Bakery', unitNumber: '210',
  leased_sqft: 12000, lease_type: 'Triple Net (NNN)',
  start_date: '2018-01-01', end_date: '2033-12-31',
  cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' };
const TENANT_B = { id: 'mw-t-birch', tenant_name: 'Birch Optical', unitNumber: '214',
  leased_sqft: 10000, lease_type: 'Triple Net (NNN)',
  start_date: '2018-01-01', end_date: '2033-12-31',
  cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' };
const TENANT_C = { id: 'mw-t-cedar', tenant_name: 'Cedar Fitness', unitNumber: '5',
  leased_sqft: 8000, lease_type: 'Triple Net (NNN)',
  start_date: '2018-01-01', end_date: '2033-12-31',
  cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' };
const TENANT_D = { id: 'mw-t-dogwd', tenant_name: 'Dogwood Deli', unitNumber: '320',
  leased_sqft: 6000, lease_type: 'Triple Net (NNN)',
  start_date: '2018-01-01', end_date: '2033-12-31',
  cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' };

const FORWARD  = [TENANT_A, TENANT_B, TENANT_C, TENANT_D];
const REVERSED = [TENANT_D, TENANT_C, TENANT_B, TENANT_A];

const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
const INVOICES = [
  // Four ordinary shared expenses. Nothing about them should ever be flagged.
  { id: 'mw-i-1', vendorName: 'Halloway Janitorial', amount: '12000', category: 'janitorial',
    invoiceDate: '2025-03-05', camEligible: true, ...doc('hal') },
  { id: 'mw-i-2', vendorName: 'Prosper Insurance',   amount:  '9000', category: 'insurance',
    invoiceDate: '2025-06-01', camEligible: true, ...doc('pro') },
  { id: 'mw-i-3', vendorName: 'Meriden Utilities',   amount:  '6000', category: 'utilities',
    invoiceDate: '2025-10-20', camEligible: true, ...doc('mer') },
  { id: 'mw-i-4', vendorName: 'Ashgrove Security',   amount:  '4000', category: 'security',
    invoiceDate: '2025-11-02', camEligible: true, ...doc('ash') },
  // THE TIE. Names Unit 210 and Unit 214 equally. Whoever is read first takes
  // the whole $5,000.
  { id: 'mw-i-5', vendorName: 'Fairlane Glazing units 210 and 214', amount: '5000',
    category: 'repairs', invoiceDate: '2025-07-14', camEligible: true, ...doc('fai') },
  // THE NEAR MISS. Cedar Fitness is in Unit 5; "5" is below MIN_UNIT_LEN, so the
  // CAM-4 guard refuses to assign on it and the invoice stays shared. Correct —
  // and previously indistinguishable from the four above.
  { id: 'mw-i-6', vendorName: 'Cutler Submeter read for Unit 5', amount: '2000',
    category: 'utilities', invoiceDate: '2025-08-09', camEligible: true, ...doc('cut') },
];

const mockFor = (tenants) => `
(function () {
  var USER_ID='mw-user', _user={id:USER_ID,email:'mw@e2e-test.local'}, _session=null, KEY='__mw_store';
  try { localStorage.removeItem(KEY); } catch (e) {}
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Marlow Court',sqft:${TOTAL_SQFT},
    data:{invoices:${JSON.stringify(INVOICES)},disputes:[],camYear:${CAM_YEAR},results:null,camReconciliation:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(tenants)}}}],tenants:[]};
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

// Everything the assertions need, read off one run.
const READ = () => {
  const T = (el) => el ? (el.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : '';
  const summary = (typeof buildAuditSummary === 'function') ? buildAuditSummary() : { red: [], yellow: [], green: [] };
  // deriveExposure takes the BUCKETED summary, not a flat list — a flat array
  // yields empty buckets and every tenant reads as billable, which is a green
  // assertion about nothing.
  const expo = window.AuditExposure.deriveExposure(summary, lastTotal || 0);
  const findings = [...(summary.red || []), ...(summary.yellow || [])].map(f => ({
    title: f.title, severity: f.severity, blocksBilling: f.blocksBilling,
    conditions: f.conditions || [], detail: f.detail || '',
  }));
  return {
    // Every per-invoice warning marker currently on screen.
    flagMarkers: Array.from(document.querySelectorAll('.recon-inv-flag')).map(T),
    chargeRows:  document.querySelectorAll('.ts-inv-card').length,
    resultCards: document.querySelectorAll('.result-card').length,
    findings,
    blockingByTenant: Object.fromEntries(Object.entries((expo.blocking || {}).byTenant || {})
      .map(([k, v]) => [k, v.map(b => b.title)])),
    blockingProperty: ((expo.blocking || {}).property || []).map(b => b.title),
    billable: Object.fromEntries((lastResults || []).map(r => [r.name,
      window.AuditExposure.billingReadiness(expo, r.name).canBill])),
    allocations: Object.fromEntries((lastResults || []).map(r => [r.name, r.totalAllocated])),
    routedTo: (_lastEngineInvoices || []).map(i => ({
      vendor: i.vendorName, to: i.matchedTenant, conf: i.matchConfidence,
      ambiguous: !!i.matchAmbiguous,
      tied: (i.matchTied || []).map(c => c.tenantName).sort(),
      near: (i.matchNearMisses || []).map(n => `${n.signal}:${n.token}:${n.tenantName}`).sort(),
    })),
    // D16 — no confidence percentage anywhere on the reconciliation screen.
    bodyText: (document.getElementById('resultsBody') || document.body).innerText.replace(/\s+/g, ' '),
  };
};

async function runOrder(browser, tenants, label) {
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    return route.abort();
  });
  await ctx.addInitScript(mockFor(tenants));
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await _e2eSignIn(page, { email: "mw@e2e-test.local", errors: errors });
  await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction((n) => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === n,
                             tenants.length, { timeout: 45000 });
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                             tenants.length, { timeout: 60000 });
  // THE CARDS MUST BE ON SCREEN BEFORE ANY "no warning is present" ASSERTION.
  // A negative read against an empty DOM passes for the worst possible reason.
  await page.waitForSelector('.result-card', { state: 'attached', timeout: 20000 });
  const out = await page.evaluate(READ);
  out.errors = errors;
  await ctx.close();
  console.log(`  (${label}: ${out.resultCards} result cards, ${out.chargeRows} charge rows, ${out.findings.length} findings)`);
  return out;
}

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  console.log('\n══ F-14 on screen ══\n');
  const fwd = await runOrder(browser, FORWARD,  'tenants in order');
  const rev = await runOrder(browser, REVERSED, 'tenants reversed');

  const amb = f => /Confirm whether .* belongs to/.test(f.title);
  const near = f => /mention.? a tenant too briefly/.test(f.title);

  // ── 1 · ordinary shared invoice → no warning ──────────────────────────────
  console.log('\n── 1 · An ordinary shared invoice carries no warning ──');
  R('per-invoice markers on screen', fwd.flagMarkers);
  R('charge rows', fwd.chargeRows);
  // Before P7 this was 16 of 17 — every shared line of every tenant. The only
  // marker that may remain is the tie, and it is on the ONE invoice that has one.
  yes('no marker says "Low confidence invoice match" anywhere',
      !fwd.flagMarkers.some(m => /Low confidence/i.test(m)), JSON.stringify(fwd.flagMarkers));
  yes('    the ordinary shared invoices carry no marker at all',
      !fwd.flagMarkers.some(m => /Halloway|Prosper|Meriden|Ashgrove/i.test(m)),
      JSON.stringify(fwd.flagMarkers));
  yes('    and the markers that remain are only about the tie',
      fwd.flagMarkers.every(m => /Names 2 tenants/.test(m)), JSON.stringify(fwd.flagMarkers));
  yes('the four ordinary invoices routed to the shared pool, unmatched and unremarked',
      ['Halloway Janitorial', 'Prosper Insurance', 'Meriden Utilities', 'Ashgrove Security']
        .every(v => { const r = fwd.routedTo.find(x => x.vendor === v);
                      return r && r.to === null && r.conf === 0 && !r.ambiguous && r.near.length === 0; }),
      JSON.stringify(fwd.routedTo.filter(r => /Halloway|Prosper|Meriden|Ashgrove/.test(r.vendor))));

  // ── 2 · ambiguous match → named candidates, blocks billing ────────────────
  console.log('\n── 2 · A genuine tie names its candidates and refuses the statement ──');
  const fAmb = fwd.findings.filter(amb);
  R('ambiguity findings', fAmb.map(f => f.title));
  R('blocked tenants', fwd.blockingByTenant);
  R('billable', fwd.billable);

  yes('the tie raises a finding', fAmb.length > 0, JSON.stringify(fwd.findings.map(f => f.title)));
  yes('    it names the invoice and the amount',
      fAmb.every(f => f.conditions.some(c => /Fairlane Glazing/.test(c) && /\$5,000\.00/.test(c))),
      JSON.stringify(fAmb[0] && fAmb[0].conditions));
  yes('    it names BOTH tied candidates with the signal each matched on',
      fAmb.every(f => f.conditions.some(c => /Matched: Alder Bakery on "Unit 210" at 90%/.test(c))
                   && f.conditions.some(c => /Matched: Birch Optical on "Unit 214" at 90%/.test(c))),
      JSON.stringify(fAmb[0] && fAmb[0].conditions));
  yes('    it says the billed tenant was chosen by read order, not by the document',
      fAmb.every(f => /read first, not because the document says so/.test(f.detail)));
  yes('    it blocks billing', fAmb.every(f => f.blocksBilling === true));
  yes('BOTH tied candidates are refused a statement',
      fwd.billable['Alder Bakery'] === false && fwd.billable['Birch Optical'] === false,
      JSON.stringify(fwd.billable));
  yes('    and the uninvolved tenants are NOT — an unrelated lease is not held',
      fwd.billable['Dogwood Deli'] === true, JSON.stringify(fwd.billable));
  // SCOPED, NOT PROPERTY-WIDE. A finding with no `Tenant:` marker falls back to
  // property level and would refuse every statement on the property — heavier
  // than the facts support, and the exact over-blocking I-4 was written to end.
  yes('    the block is recorded against the two candidates and nobody else',
      Object.keys(fwd.blockingByTenant).sort().join('|') === 'Alder Bakery|Birch Optical',
      JSON.stringify(fwd.blockingByTenant));
  yes('    and nothing about this tie blocks the property as a whole',
      !fwd.blockingProperty.some(t => /Confirm whether .* belongs to/.test(t)),
      JSON.stringify(fwd.blockingProperty));

  // ── 3 · ORDER-INDEPENDENCE ────────────────────────────────────────────────
  console.log('\n── 3 · Reversing the tenant array changes nothing a manager sees ──');
  const tieFwd = fwd.routedTo.find(r => /Fairlane/.test(r.vendor));
  const tieRev = rev.routedTo.find(r => /Fairlane/.test(r.vendor));
  R('billed to (forward / reversed)', [tieFwd.to, tieRev.to]);
  R('candidates (forward / reversed)', [tieFwd.tied, tieRev.tied]);

  yes('the candidate set is identical in both orders',
      JSON.stringify(tieFwd.tied) === JSON.stringify(tieRev.tied),
      JSON.stringify({ fwd: tieFwd.tied, rev: tieRev.tied }));
  yes('the ambiguity findings are identical in both orders',
      JSON.stringify(fwd.findings.filter(amb).map(f => f.conditions.filter(c => /^Matched:/.test(c))).sort())
        === JSON.stringify(rev.findings.filter(amb).map(f => f.conditions.filter(c => /^Matched:/.test(c))).sort()),
      JSON.stringify([fwd.findings.filter(amb).map(f => f.title), rev.findings.filter(amb).map(f => f.title)]));
  yes('both candidates are blocked in BOTH orders — nobody is silently chosen',
      rev.billable['Alder Bakery'] === false && rev.billable['Birch Optical'] === false,
      JSON.stringify(rev.billable));
  // The billed tenant still flips. That is the defect being REPORTED, not fixed:
  // picking a winner would be inventing the answer the finding asks a person for.
  yes('    the underlying order dependence is still real — which is why it blocks',
      tieFwd.to !== tieRev.to, `${tieFwd.to} vs ${tieRev.to} — the fixture stopped reproducing it`);

  // ── 4 · near miss → advisory, allocation unchanged ────────────────────────
  console.log('\n── 4 · A near miss advises, and changes nothing ──');
  const fNear = fwd.findings.filter(near);
  const cut   = fwd.routedTo.find(r => /Cutler/.test(r.vendor));
  R('near-miss findings', fNear.map(f => f.title));
  R('Cutler routing', cut);

  yes('the near miss raises a finding', fNear.length === 1, JSON.stringify(fwd.findings.map(f => f.title)));
  // Guarded: a mutation that removes the finding must FAIL these, not crash the
  // runner — a crash reports nothing about the assertions after it.
  yes('    naming the invoice, the token and the tenant it resembles',
      !!fNear[0] && fNear[0].conditions.some(c => /Cutler Submeter/.test(c) && /unit "5"/.test(c) && /Cedar Fitness/.test(c)),
      JSON.stringify(fNear[0] && fNear[0].conditions));
  yes('    it does NOT block billing',
      !!fNear[0] && fNear[0].blocksBilling === false, JSON.stringify(fNear[0] && fNear[0].blocksBilling));
  yes('    Cedar Fitness can still be billed',
      fwd.billable['Cedar Fitness'] === true, JSON.stringify(fwd.billable));
  yes('    and the invoice is STILL allocated pro-rata — the guard is untouched',
      cut && cut.to === null && cut.conf === 0, JSON.stringify(cut));

  // ── 5 · no money moved ────────────────────────────────────────────────────
  console.log('\n── 5 · No allocation changed ──');
  R('allocations', fwd.allocations);
  // 12,000+9,000+6,000+4,000+2,000 = $33,000 shared; $5,000 direct to the tie
  // winner. Shares: 30% / 25% / 20% / 15% of the shared pool.
  const EXPECT = { 'Alder Bakery': 9900 + 5000, 'Birch Optical': 8250,
                   'Cedar Fitness': 6600, 'Dogwood Deli': 4950 };
  Object.entries(EXPECT).forEach(([n, v]) =>
    yes(`${n} is billed ${v.toFixed(2)}`, Math.abs(fwd.allocations[n] - v) < 0.005,
        String(fwd.allocations[n])));
  yes('the reversed run bills the same TOTAL — only the tie winner moves',
      Math.abs(Object.values(fwd.allocations).reduce((s, v) => s + v, 0)
             - Object.values(rev.allocations).reduce((s, v) => s + v, 0)) < 0.005,
      JSON.stringify([fwd.allocations, rev.allocations]));

  // ── 6 · D16 · no misleading confidence statistic on screen ────────────────
  console.log('\n── 6 · D16 · no confidence percentage is displayed ──');
  yes('the reconciliation screen prints no "N% confidence" badge',
      !/\d+% confidence/i.test(fwd.bodyText),
      (fwd.bodyText.match(/.{0,60}% confidence.{0,40}/i) || [''])[0]);
  yes('    and no per-tenant "Confidence" stat',
      !/Confidence\s*\d+%/i.test(fwd.bodyText),
      (fwd.bodyText.match(/.{0,40}Confidence\s*\d+%.{0,20}/i) || [''])[0]);
  yes('    an ordinary all-shared tenant produces no confidence figure at all',
      !new RegExp('Dogwood Deli[\\s\\S]{0,400}?Confidence').test(fwd.bodyText));

  console.log('\n── No page errors ──');
  yes('neither run raised a page error',
      fwd.errors.length === 0 && rev.errors.length === 0,
      JSON.stringify([fwd.errors.slice(0, 2), rev.errors.slice(0, 2)]));

  console.log('\n' + '─'.repeat(58));
  console.log(fail === 0
    ? `\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`
    : `\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await browser.close();
  server.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Runner error:', e && e.stack ? e.stack : e); process.exit(1); });
