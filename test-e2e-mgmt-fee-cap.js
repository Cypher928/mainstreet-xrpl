'use strict';
/**
 * test-e2e-mgmt-fee-cap.js — D2-1. The fee-cap check, on the panel a manager reads.
 *
 *   node test-e2e-mgmt-fee-cap.js
 *
 * test-mgmt-fee-cap.js pins _tier1LeaseChecks against hand-built arguments.
 * That is exactly how the defect survived: the suite fed `category:
 * 'management fee'` and a `totalExpenses` that happened to equal the sum of its
 * own line items, so neither the category the product writes nor the
 * denominator the product passes was ever exercised.
 *
 * This drives the real thing — runAllocation, then the real
 * _startLeaseValidation → _runLeaseValidation → _tier1LeaseChecks →
 * _renderValidationPanel — and reads the verdict out of the rendered DOM.
 *
 * THE TWO NUMBERS IT EXISTS TO SEPARATE.
 *
 *   CAM pool         $100,000   management $20,000 = 20.0%   ← the truth
 *   gross invoiced   $200,000   management $20,000 = 10.0%   ← what it reported
 *
 * The difference is one $100,000 roof the manager marked NOT CAM-eligible. The
 * lease caps the admin fee at 15%, so those two denominators are not a rounding
 * question: one is a five-point breach and the other is a clean bill of health.
 * The fixture carries that invoice for no other reason.
 *
 * AND WHAT MUST NOT CHANGE. D2-1 makes a validator truthful; it does not
 * enforce anything. Allocations, the audit summary and the billing gate are
 * asserted identical whether the cap is breached or not — a management-fee
 * breach reaching the billing gate is D2-2 and is a product decision nobody has
 * taken.
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
      console.error('\n\x1b[31mtest-e2e-mgmt-fee-cap: playwright is not installed.\x1b[0m');
      console.error('This suite reads a rendered validation panel out of a real DOM and cannot');
      console.error('verify anything without one. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-mgmt-fee-cap SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Whether the fee-cap check divides by the CAM pool was NOT verified.\n');
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
const R   = (l, v) => console.log('  ' + String(l).padEnd(44) + ':', typeof v === 'string' ? v : JSON.stringify(v));
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

const PROP_ID = 'mf-prop-000000000001';
const CAM_YEAR = 2025, TOTAL_SQFT = 40000;

// admin_fee_pct is stored as the STRING "15" — the exact form all three real
// pilot leases that carry one are stored in.
const CAPPED   = 'Alder Bakery';    // admin_fee_pct 15
const UNCAPPED = 'Birch Optical';   // no cap clause — the control
const TENANTS = [
  { id: 'mf-t-alder', tenant_name: CAPPED,   unitNumber: '210', leased_sqft: 12000, admin_fee_pct: '15' },
  { id: 'mf-t-birch', tenant_name: UNCAPPED, unitNumber: '214', leased_sqft: 10000, admin_fee_pct: null },
  { id: 'mf-t-cedar', tenant_name: 'Cedar Fitness', unitNumber: '320', leased_sqft: 8000, admin_fee_pct: null },
  { id: 'mf-t-dogwd', tenant_name: 'Dogwood Deli',  unitNumber: '415', leased_sqft: 6000, admin_fee_pct: null },
].map(t => ({ ...t, lease_type: 'Triple Net (NNN)', start_date: '2018-01-01', end_date: '2033-12-31',
  cap: '', capBaseAmount: '', excluded_categories: '', audit_rights: true, status: 'complete' }));

const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
// Category 'management' — the canonical string, not the 'management fee' the
// unit suite used to feed. All 12 management invoices in the pilot dataset
// carry exactly this.
const MGMT = { id: 'mf-i-1', vendorName: 'Cascade Property Management', amount: '20000',
               category: 'management', invoiceDate: '2025-03-31', camEligible: true, ...doc('mgmt') };
// Spread deliberately: no single invoice may exceed 40% of the pool, or the
// concentration detector blocks every tenant on the property and the
// "billing is unchanged" assertions below would pass because everything is
// blocked in both runs — which proves nothing about the fee cap.
const BASE = [
  { id: 'mf-i-2', vendorName: 'CleanSpace Commercial', amount: '30000', category: 'janitorial',
    invoiceDate: '2025-06-30', camEligible: true, ...doc('jan') },
  { id: 'mf-i-3', vendorName: 'Austin Energy', amount: '30000', category: 'utilities',
    invoiceDate: '2025-09-30', camEligible: true, ...doc('util') },
  { id: 'mf-i-5', vendorName: 'Green Valley Landscape', amount: '20000', category: 'landscaping',
    invoiceDate: '2025-05-01', camEligible: true, ...doc('land') },
  // THE INVOICE THAT SEPARATES THE TWO DENOMINATORS. Not CAM-eligible, so it is
  // not in the pool and not in anybody's allocation — but it IS in lastTotal.
  { id: 'mf-i-4', vendorName: 'Summit Roofing', amount: '100000', category: 'repairs',
    invoiceDate: '2025-07-01', camEligible: false, ...doc('roof') },
];
// Breach: 20,000 / 100,000 = 20.0% against a 15% cap.
const INVOICES_BREACH = [MGMT, ...BASE];
// Within cap: 10,000 / 90,000 = 11.1%. Same shape, same non-eligible roof.
const INVOICES_WITHIN = [{ ...MGMT, amount: '10000' }, ...BASE];

const mockFor = (invoices) => `
(function () {
  var USER_ID='mf-user', _user={id:USER_ID,email:'mf@e2e-test.local'}, _session=null, KEY='__mf_store';
  try { localStorage.removeItem(KEY); } catch (e) {}
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Cascade Commons',sqft:${TOTAL_SQFT},
    data:{invoices:${JSON.stringify(invoices)},disputes:[],camYear:${CAM_YEAR},results:null,camReconciliation:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(TENANTS)}}}],tenants:[]};
  function load(){try{var r=localStorage.getItem(KEY);if(r)return JSON.parse(r);}catch(e){}return JSON.parse(JSON.stringify(seed));}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(_store));}catch(e){}}
  var _store=load(); window.__store=function(){return _store;};
  function res(d){return Promise.resolve({data:d,error:null});} var _seq=0;
  function table(name){var rows=_store[name]||(_store[name]=[]);var last=null;var filters=[];var api={
    sel:function(){return rows.filter(function(r){return filters.every(function(f){return String(r[f[0]])===String(f[1]);});});},
    select:function(){last=null;return api;},eq:function(c,v){filters.push([c,v]);return api;},not:function(){return api;},
    is:function(){return api;},in:function(){return api;},order:function(){return api;},limit:function(){return api;},
    maybeSingle:function(){return res(last||api.sel()[0]||null);},single:function(){return res(last||api.sel()[0]||null);},
    insert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);rows.push(row);return row;});last=a[0];persist();return api;},
    upsert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);var i=rows.findIndex(function(x){return x.id===row.id;});if(i>=0){rows[i]=Object.assign({},rows[i],row);persist();return rows[i];}rows.push(row);return row;});last=a[0];persist();return api;},
    update:function(v){api.sel().forEach(function(r){Object.assign(r,JSON.parse(JSON.stringify(v)));});last=api.sel()[0];persist();return api;},
    delete:function(){return api;},
    then:function(f){return Promise.resolve({data:last?[last]:api.sel(),error:null}).then(f);}};return api;}
  window.supabase = { createClient: function () { return {
    auth: { getSession:function(){return Promise.resolve({data:{session:_session},error:null});},
      getUser:function(){return Promise.resolve({data:{user:_session?_user:null},error:null});},
      signInWithPassword:function(){_session={access_token:'mock',user:_user};return Promise.resolve({data:{session:_session,user:_user},error:null});},
      signUp:function(){return Promise.resolve({data:{user:_user},error:null});},
      signOut:function(){_session=null;return Promise.resolve({error:null});},
      onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};} },
    from: table,
    storage:{from:function(){return {upload:function(){return res({path:'m'});},createSignedUrl:function(){return res({signedUrl:'https://mock.local/x'});}};}},
  }; } };
})();
`;

// THE REAL COORDINATOR, into a real panel element, read back off the DOM.
// _runLeaseValidation is what the "Validate Against Lease" button reaches
// through _startLeaseValidation; with no linked lease document it renders the
// Tier 1 findings and returns, which is exactly the deterministic surface D2-1
// changes. Nothing here rebuilds its arguments — that is the part under test.
const PANEL = async (tenantName) => {
  const tenant = tenantData.filter(Boolean).find(t => t.tenant_name === tenantName);
  const recon  = (lastResults || []).find(r => r.name === tenantName);
  if (!tenant || !recon) return { missing: true };
  let el = document.getElementById('__mfPanel');
  if (!el) { el = document.createElement('div'); el.id = '__mfPanel'; document.body.appendChild(el); }
  el.innerHTML = '';
  await _runLeaseValidation(el, tenant, recon, lastTotal);
  const node = Array.from(el.querySelectorAll('.lv-finding'))
    .find(n => /admin fee|management fee cap/i.test(n.textContent || ''));
  const T = n => (n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : '');
  return {
    panelText: (el.innerText || '').replace(/\s+/g, ' ').trim(),
    findingText: T(node),
    severityClass: node ? (node.className.match(/lv-finding--\w+/) || [null])[0] : null,
    badge: node ? T(node.querySelector('.lv-sev-badge')) : null,
  };
};

// THE SAME-BASIS GUARANTEE, MADE LOAD-BEARING.
//
// _runLeaseValidation filters includedInvoices through CamPool.isEligible before
// striking the pool from them. Today that filter is redundant — the engine
// already hands it an eligible-only list (script.js:10421) — so nothing the
// product can currently produce would notice if it were deleted. This hands it
// a record that DOES: one non-CAM-eligible invoice inside the tenant's own
// included list. With the guard the pool stays $100,000 and the breach stands;
// without it the pool doubles and the same reconciliation reads as within cap.
// The invariant is that the numerator can never contain a dollar the
// denominator lacks, and it should not depend on an upstream filter staying put.
const POISONED = async (tenantName) => {
  const tenant = tenantData.filter(Boolean).find(t => t.tenant_name === tenantName);
  const base   = (lastResults || []).find(r => r.name === tenantName);
  if (!tenant || !base) return { missing: true };
  const recon = JSON.parse(JSON.stringify(base));
  recon.includedInvoices = (recon.includedInvoices || []).concat([{
    vendorName: 'Summit Roofing', category: 'repairs', amount: 100000, camEligible: false,
  }]);
  let el = document.getElementById('__mfPoison');
  if (!el) { el = document.createElement('div'); el.id = '__mfPoison'; document.body.appendChild(el); }
  el.innerHTML = '';
  await _runLeaseValidation(el, tenant, recon, lastTotal);
  const node = Array.from(el.querySelectorAll('.lv-finding'))
    .find(n => /admin fee|management fee cap/i.test(n.textContent || ''));
  return { findingText: node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : '' };
};

const STATE = () => {
  const summary = buildAuditSummary();
  const expo = window.AuditExposure.deriveExposure(summary, lastTotal || 0);
  return {
    lastTotal, lastCamPool,
    allocations: Object.fromEntries((lastResults || []).map(r => [r.name, r.totalAllocated])),
    capApplied: (lastResults || []).map(r => !!r.capApplied),
    findingTitles: [...(summary.red||[]), ...(summary.yellow||[]), ...(summary.green||[])].map(f => f.title),
    billable: Object.fromEntries((lastResults || []).map(r =>
      [r.name, window.AuditExposure.billingReadiness(expo, r.name).canBill])),
  };
};

async function run(browser, invoices, label) {
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
  await ctx.addInitScript(mockFor(invoices));
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: 45000 });
  await page.fill('#loginEmail', 'mf@e2e-test.local');
  await page.fill('#loginPassword', 'TestPass123!');
  const appUp = () => page.waitForFunction(() => { const a = document.getElementById('appContent');
    return a && a.style.display !== 'none' && a.style.display !== ''; }, null, { timeout: 15000 });
  await page.click('#loginBtn');
  try { await appUp(); }
  catch (_) { await page.click('#loginBtn').catch(() => {}); await appUp(); }
  await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
  await page.evaluate(id => selectProperty(id), PROP_ID);
  await page.waitForFunction(n => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === n,
                             TENANTS.length, { timeout: 45000 });
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction(n => typeof lastResults !== 'undefined' && lastResults.length === n,
                             TENANTS.length, { timeout: 60000 });
  await page.waitForSelector('.result-card', { state: 'attached', timeout: 20000 });
  const state   = await page.evaluate(STATE);
  const capped  = await page.evaluate(PANEL, CAPPED);
  const control = await page.evaluate(PANEL, UNCAPPED);
  const poisoned = await page.evaluate(POISONED, CAPPED);
  await ctx.close();
  console.log(`  (${label}: pool $${state.lastCamPool.toLocaleString()}, gross $${state.lastTotal.toLocaleString()})`);
  return { state, capped, control, poisoned, errors };
}

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  console.log('\n══ D2-1 — the management-fee cap on the panel ══\n');
  try {
    const B = await run(browser, INVOICES_BREACH, 'breach');
    const W = await run(browser, INVOICES_WITHIN, 'within cap');

    H('The two denominators are genuinely different');
    R('CAM pool', B.state.lastCamPool);
    R('gross invoiced', B.state.lastTotal);
    yes('the fixture actually separates pool from gross',
        B.state.lastCamPool === 100000 && B.state.lastTotal === 200000,
        `pool ${B.state.lastCamPool}, gross ${B.state.lastTotal}`);

    H('A real breach, on the canonical category, reaches the panel');
    R('finding', B.capped.findingText);
    R('severity class', B.capped.severityClass);
    R('badge', B.capped.badge);
    yes('the panel reports the breach',
        /exceeds the 15% lease cap/i.test(B.capped.findingText), B.capped.findingText);
    yes('    struck from the CAM POOL — 20.0%, not the 10.0% gross gives',
        /\(20\.0%\)/.test(B.capped.findingText) && !/\(10\.0%\)/.test(B.capped.findingText),
        B.capped.findingText);
    yes('    by the right margin (5.0 percentage points)',
        /by 5\.0 percentage points/i.test(B.capped.findingText), B.capped.findingText);
    yes('    and it names the pool it divided by',
        /\$100,000 CAM pool this reconciliation billed from/i.test(B.capped.findingText),
        B.capped.findingText);
    yes('    the gross figure is nowhere in the sentence',
        !/\$200,000/.test(B.capped.findingText), B.capped.findingText);
    yes('    rendered at warning severity',
        B.capped.severityClass === 'lv-finding--warning', String(B.capped.severityClass));
    // THE CATEGORY ASSERTION. Before D2-1 this exact run produced the
    // "could not be tested" text, because 'management' matched no keyword.
    yes('    the canonical "management" category was recognised at all',
        !/could not be tested/i.test(B.capped.findingText), B.capped.findingText);

    H('A genuine within-cap run still reads as within cap');
    R('finding', W.capped.findingText);
    yes('the panel reports within cap',
        /is within the 15% lease cap/i.test(W.capped.findingText), W.capped.findingText);
    yes('    at 11.1% of the $90,000 pool',
        /\(11\.1%\)/.test(W.capped.findingText), W.capped.findingText);
    yes('    rendered at info severity, not warning',
        W.capped.severityClass === 'lv-finding--info', String(W.capped.severityClass));

    H('Absence is still absence');
    R('control tenant finding', B.control.findingText);
    yes('a tenant with no cap clause is UNCONFIRMED, never a pass',
        /No management fee cap was extracted/i.test(B.control.findingText)
          && B.control.severityClass === 'lv-finding--unconfirmed',
        `${B.control.severityClass}: ${B.control.findingText}`);

    H('The numerator can never contain a dollar the denominator lacks');
    R('finding with a non-eligible line injected', B.poisoned.findingText);
    yes('a non-CAM-eligible invoice inside includedInvoices does not enter the pool',
        /\(20\.0%\)/.test(B.poisoned.findingText)
          && /exceeds the 15% lease cap/i.test(B.poisoned.findingText)
          && /\$100,000 CAM pool/.test(B.poisoned.findingText),
        B.poisoned.findingText);

    H('D2-1 changed no money and no gate — D2-2 is not implemented');
    R('allocations (breach run)', B.state.allocations);
    R('allocations (within-cap run)', W.state.allocations);
    R('billable (breach run)', B.state.billable);
    // Same tenants, same sqft; the ONLY difference between the runs is the size
    // of the management invoice, so the allocations must differ by exactly that
    // and nothing about the cap may show up in either.
    yes('the breached run allocates the full management fee anyway',
        B.state.allocations[CAPPED] === 30000, JSON.stringify(B.state.allocations));
    yes('    no lease cap was applied to any tenant',
        B.state.capApplied.every(c => c === false), JSON.stringify(B.state.capApplied));
    yes('no audit finding mentions the fee cap',
        !B.state.findingTitles.some(t => /admin fee|management fee cap|fee cap/i.test(t)),
        JSON.stringify(B.state.findingTitles));
    yes('the audit finding set is identical either side of the breach',
        JSON.stringify(B.state.findingTitles.filter(t => !/\$/.test(t)))
          === JSON.stringify(W.state.findingTitles.filter(t => !/\$/.test(t))),
        'breach: ' + JSON.stringify(B.state.findingTitles) +
        '\n      → within: ' + JSON.stringify(W.state.findingTitles));
    yes('the billing verdict is the same whether or not the cap is breached',
        JSON.stringify(B.state.billable) === JSON.stringify(W.state.billable),
        'breach: ' + JSON.stringify(B.state.billable) +
        '\n      → within: ' + JSON.stringify(W.state.billable));

    H('Page errors');
    R('breach run', B.errors.length ? B.errors : '(none)');
    R('within-cap run', W.errors.length ? W.errors : '(none)');
    yes('no uncaught page errors on either run',
        B.errors.length === 0 && W.errors.length === 0,
        [...B.errors, ...W.errors].join(' | '));

  } catch (e) {
    bad('suite crashed', e && e.stack ? e.stack : String(e));
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
