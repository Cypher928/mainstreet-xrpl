'use strict';
/**
 * test-restore-completeness.js — a saved reconciliation must come back MEANING
 * the same thing, not merely showing the same dollars.
 *
 *   node test-restore-completeness.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * Measured on a fresh property, save → real reload → restore:
 *
 *   Needs Review rollup     3 tenants · 4 issues   →   absent entirely
 *   CAM Pool KPI            $191,900 of $217,900   →   $217,900
 *   variance residual       -$0.01, explained      →   -$140,967.13, unexplained
 *   variance next step      "Review which invoices  →   "Re-check the invoice
 *                            are CAM-eligible"          register"
 *
 * Every allocation figure survived. What did not survive was everything that
 * says what the figures MEAN: which tenants carry unresolved allocation flags,
 * how much of the pool a tenant can actually be billed from, where the
 * difference between pool and billed went, and what to do next. The restored
 * screen told the manager the numbers may be wrong about a run that had
 * reconciled to one cent.
 *
 * WHAT THIS SUITE HOLDS
 *
 * The restored surface derives from the SAVED RECORD, never from a fresh run —
 * runFullReconciliation is instrumented on the reloaded page and must not be
 * called. And the stored allocation dollars are compared tenant by tenant, so a
 * "fix" that recomputes its way to completeness fails here rather than passing.
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
      console.error('\n\x1b[31mtest-restore-completeness: playwright is not installed.\x1b[0m');
      console.error('This suite drives a real save and reload in a browser and cannot verify');
      console.error('anything without one. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-restore-completeness SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Whether a saved reconciliation restores its full meaning was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7995', 10);
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
// Small, and deliberately shaped so every one of the four restored facts has
// something to be wrong about: allocation flags on two tenants, an invoice the
// manager removed from CAM, an out-of-year invoice, a part-period tenant, a cap,
// and 20% of the building vacant.
const PROP_ID  = 'rc-prop-000000000001';
const CAM_YEAR = 2025;
const TOTAL_SQFT = 60000;

const TENANTS = [
  { id: 'rc-t-alpha', tenant_name: 'Alpha Grocers', unitNumber: '100',
    leased_sqft: 30000, lease_type: 'Triple Net (NNN)',
    start_date: '2018-01-01', end_date: '2033-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'rc-t-beta', tenant_name: 'Beta Provisions', unitNumber: '120',
    leased_sqft: 12000, lease_type: 'Triple Net (NNN)',
    start_date: '2025-04-01', end_date: '2031-03-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'rc-t-gamma', tenant_name: 'Gamma Clinic', unitNumber: '210',
    leased_sqft: 6000, lease_type: 'Triple Net (NNN)',
    start_date: '2020-01-01', end_date: '2030-12-31',
    cap: '5', capBaseAmount: '2000', excluded_categories: '', status: 'complete' },
];

const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
const INVOICES = [
  { id: 'rc-i-1', vendorName: 'Halloway Janitorial', amount: '20000', category: 'janitorial',
    invoiceDate: '2025-02-10', camEligible: true, ...doc('hal') },
  { id: 'rc-i-2', vendorName: 'Prosper Insurance',  amount: '10000', category: 'insurance',
    invoiceDate: '2025-06-01', camEligible: true, ...doc('pro') },
  // Removed from CAM by the manager — the CAM Pool KPI exists to report this.
  { id: 'rc-i-3', vendorName: 'Kingsley Roof Works', amount: '15000', category: 'other',
    invoiceDate: '2025-08-01', camEligible: false, ...doc('kin') },
  // Out of the CAM year.
  { id: 'rc-i-4', vendorName: 'Denton Paving',       amount:  '8000', category: 'repairs',
    invoiceDate: '2024-05-05', camEligible: true, ...doc('den') },
  // Direct, inside the window — DIRECT_ASSIGNMENT on Alpha.
  { id: 'rc-i-5', vendorName: 'Alpha Grocers submeter', amount: '4000', category: 'utilities',
    invoiceDate: '2025-05-01', camEligible: true, ...doc('alp') },
  // Direct, BEFORE Beta took occupancy — DIRECT_OUTSIDE_OCCUPANCY on Beta.
  { id: 'rc-i-6', vendorName: 'Beta Provisions signage', amount: '3000', category: 'repairs',
    invoiceDate: '2025-02-01', camEligible: true, ...doc('bet') },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID='rc-user', _user={id:USER_ID,email:'rc@e2e-test.local'}, _session=null, KEY='__rc_store';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Rowan Court',sqft:${TOTAL_SQFT},
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

// ── What "the same meaning" is made of ──────────────────────────────────────
// Read off the live page, identically on both passes. Nothing here recomputes an
// allocation: every figure is taken from the globals the screen itself renders.
const SURFACE = () => {
  const txt = (el) => (el ? el.innerText.replace(/\s+/g, ' ').trim() : null);

  // 1. Needs Review — the tenants carrying unresolved allocation flags.
  const rollupEl = document.querySelector('#resultsBody .needs-review-rollup');
  const rollup = {
    present: !!rollupEl,
    badge:   txt(rollupEl && rollupEl.querySelector('.nrr-count-badge')),
    items:   Array.from(document.querySelectorAll('#resultsBody .needs-review-rollup .nrr-item'))
               .map(n => txt(n)),
  };
  // The same facts at their source, so a rollup that renders from stale state
  // cannot pass by looking right.
  const flags = (typeof lastResults !== 'undefined' ? lastResults : []).map(r => ({
    name: r.name, codes: (r.ambiguityFlags || []).map(f => f.code).sort(),
  })).filter(x => x.codes.length);

  // 2. The CAM Pool KPI.
  const kpi = Array.from(document.querySelectorAll('#resultsBody .rcs-kpi, #resultsBody [class*="kpi"]'))
    .map(n => txt(n)).filter(Boolean).find(t => /CAM Pool/i.test(t)) || null;

  // 3. Variance attribution, derived the way the panel derives it.
  const eng   = (typeof _lastEngineInvoices     !== 'undefined' ? _lastEngineInvoices     : []) || [];
  const recon = (typeof _lastReconciledInvoices !== 'undefined' ? _lastReconciledInvoices : []) || [];
  let variance = null;
  try {
    const VB = window.VarianceBreakdown;
    const pool   = eng.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const billed = (lastResults || []).reduce((s, r) => s + (r.totalAllocated || 0), 0);
    const bk = VB.derive({ results: lastResults, invoices: eng,
                           reconciled: recon.length ? recon : undefined, pool, billed });
    variance = {
      pool: bk.pool, billed: bk.billed, difference: bk.difference,
      outOfYear: bk.outOfYear, notEligible: bk.notEligible, uncovered: bk.uncovered,
      notOccupied: bk.notOccupied, claimShortfall: bk.claimShortfall,
      capTotal: bk.capTotal, residual: bk.residual, explained: bk.explained,
      nextStep: (VB.nextStep(bk) || {}).key || null,
    };
  } catch (e) { variance = { error: e.message }; }

  // 3b. THE BREAKDOWN THE PANEL ACTUALLY OPENS. openVarianceDetails prefers the
  // cached _lastVarianceBreakdown and only re-derives when it is absent, so the
  // cache is what a manager sees. Derived above from the same globals, this is
  // built inside _buildReconciliationSummaryHtml from whatever THAT was handed —
  // which is a different question, and one a check on the globals alone cannot
  // ask.
  const _c = (typeof _lastVarianceBreakdown !== 'undefined' && _lastVarianceBreakdown) || null;
  const cached = _c ? {
    pool: _c.pool, billed: _c.billed, difference: _c.difference,
    outOfYear: _c.outOfYear, notEligible: _c.notEligible, uncovered: _c.uncovered,
    notOccupied: _c.notOccupied, claimShortfall: _c.claimShortfall,
    capTotal: _c.capTotal, residual: _c.residual, explained: _c.explained,
    directCount: (_c.invoices || []).filter(r => r.isDirect).length,
  } : null;

  // 4. The CTA the banner actually renders.
  const ctaEl = document.querySelector('#resultsBody .rcs-variance-cta');
  const cta = txt(ctaEl);

  return JSON.parse(JSON.stringify({
    rollup, flags, kpi, variance, cached, cta,
    engineInvoiceCount:     eng.length,
    reconciledInvoiceCount: recon.length,
    // The dollars. Compared to prove nothing was recomputed on the way back.
    allocations: (typeof lastResults !== 'undefined' ? lastResults : [])
      .map(r => [r.name, Math.round((r.totalAllocated || 0) * 100) / 100])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    total: typeof lastTotal !== 'undefined' ? lastTotal : null,
  }));
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
  // COUNT EVERY CAM RUN. The restored view must be built from the saved record;
  // if the restore path quietly re-runs the engine it would produce a complete
  // screen for the wrong reason, and every assertion below would pass.
  await ctx.addInitScript(`
    window.__reconCalls = 0;
    Object.defineProperty(window, '__armReconCounter', { value: function () {
      if (typeof window.runFullReconciliation !== 'function') return false;
      var orig = window.runFullReconciliation;
      window.runFullReconciliation = function () { window.__reconCalls++; return orig.apply(this, arguments); };
      return true;
    }});
  `);

  const signIn = async () => {
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: 45000 });
    await page.fill('#loginEmail', 'rc@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    const appUp = () => page.waitForFunction(() => { const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== ''; }, null, { timeout: 15000 });
    await page.click('#loginBtn');
    try { await appUp(); }
    catch (_) { await page.click('#loginBtn').catch(() => {}); await appUp(); }
    await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
  };

  // ── Pass 1: the run ───────────────────────────────────────────────────────
  console.log('\n══ A saved reconciliation must come back meaning the same thing ══');
  await signIn();
  await page.evaluate((id) => selectProperty(id), PROP_ID);
  await page.waitForFunction((n) => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === n,
                             TENANTS.length, { timeout: 45000 });
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                             TENANTS.length, { timeout: 60000 });

  const fresh = await page.evaluate(SURFACE);
  console.log('\n── The fresh run ──');
  R('Needs Review badge',   fresh.rollup.badge);
  R('flagged tenants',      fresh.flags);
  R('CAM Pool KPI',         fresh.kpi);
  R('variance residual',    fresh.variance.residual);
  R('variance next step',   fresh.variance.nextStep);
  R('engine / reconciled',  [fresh.engineInvoiceCount, fresh.reconciledInvoiceCount]);
  R('allocations',          fresh.allocations);

  yes('the fresh run raises allocation flags on more than one tenant',
      fresh.flags.length >= 2, JSON.stringify(fresh.flags));
  yes('the fresh run shows the Needs Review rollup',
      fresh.rollup.present, JSON.stringify(fresh.rollup));
  yes('the fresh run distinguishes the CAM pool from everything invoiced',
      !!fresh.kpi && /of\b/.test(fresh.kpi), JSON.stringify(fresh.kpi));
  yes('the fresh run attributes the whole difference (residual under a cent)',
      fresh.variance.explained === true && Math.abs(fresh.variance.residual) < 0.05,
      JSON.stringify(fresh.variance));

  // ── Save, then a REAL reload ──────────────────────────────────────────────
  await page.evaluate(async () => {
    try { await savePropertyData(); } catch (_) {}
    try { await savePropertyNow(); } catch (_) {}
  });
  await page.waitForTimeout(1500);

  console.log('\n── …save, a real page load, and restore ──');
  await signIn();                       // a genuine fresh document
  const armed = await page.evaluate(() => window.__armReconCounter());
  yes('the CAM engine is instrumented before the property is opened', armed);

  await page.evaluate((id) => selectProperty(id), PROP_ID);
  const restoredOk = await page.waitForFunction((n) =>
    typeof lastResults !== 'undefined' && lastResults.length === n, TENANTS.length, { timeout: 30000 })
    .then(() => true).catch(() => false);
  yes('the saved reconciliation comes back without being re-run', restoredOk);
  // Give the deferred property load and its re-render time to land.
  await page.waitForTimeout(2500);

  const reran = await page.evaluate(() => window.__reconCalls);
  R('runFullReconciliation calls', reran);
  yes('THE RESTORED VIEW IS NOT A FRESH CAM RUN — the engine was never called',
      reran === 0, 'runFullReconciliation ran ' + reran + ' time(s) during restore');

  const restored = await page.evaluate(SURFACE);
  console.log('\n── The restored view ──');
  R('Needs Review badge',   restored.rollup.badge);
  R('flagged tenants',      restored.flags);
  R('CAM Pool KPI',         restored.kpi);
  R('variance residual',    restored.variance.residual);
  R('variance next step',   restored.variance.nextStep);
  R('engine / reconciled',  [restored.engineInvoiceCount, restored.reconciledInvoiceCount]);
  R('allocations',          restored.allocations);

  // ── The comparison ────────────────────────────────────────────────────────
  console.log('\n── Nothing was recalculated ──');
  yes('every tenant allocation is identical to the stored one',
      JSON.stringify(restored.allocations) === JSON.stringify(fresh.allocations),
      JSON.stringify({ fresh: fresh.allocations, restored: restored.allocations }));
  yes('    and so is the expense total',
      restored.total === fresh.total, JSON.stringify([fresh.total, restored.total]));

  console.log('\n── F-3 · Needs Review survives ──');
  yes('the rollup is present after restore', restored.rollup.present,
      'the rollup is built only by runAllocation — a restored run shows none of it');
  yes('    with the same tenant/issue count', restored.rollup.badge === fresh.rollup.badge,
      JSON.stringify([fresh.rollup.badge, restored.rollup.badge]));
  yes('    and the same items', JSON.stringify(restored.rollup.items) === JSON.stringify(fresh.rollup.items),
      JSON.stringify({ fresh: fresh.rollup.items, restored: restored.rollup.items }));
  yes('    because the flags themselves came back on the results',
      JSON.stringify(restored.flags) === JSON.stringify(fresh.flags),
      JSON.stringify({ fresh: fresh.flags, restored: restored.flags }));

  console.log('\n── F-4 · CAM Pool eligibility survives ──');
  yes('the KPI reports the same pool as the fresh run', restored.kpi === fresh.kpi,
      JSON.stringify({ fresh: fresh.kpi, restored: restored.kpi }));

  console.log('\n── F-5 · variance attribution survives ──');
  const vKeys = ['pool','billed','difference','outOfYear','notEligible','uncovered',
                 'notOccupied','claimShortfall','capTotal'];
  vKeys.forEach(k => {
    yes(`    ${k} is unchanged`, Math.abs((restored.variance[k] || 0) - (fresh.variance[k] || 0)) < 0.005,
        JSON.stringify([fresh.variance[k], restored.variance[k]]));
  });
  yes('the restored breakdown still explains the difference',
      restored.variance.explained === true && Math.abs(restored.variance.residual) < 0.05,
      JSON.stringify(restored.variance));
  yes('    and it has the engine invoice records to attribute against',
      restored.engineInvoiceCount === fresh.engineInvoiceCount
        && restored.reconciledInvoiceCount === fresh.reconciledInvoiceCount,
      JSON.stringify({ fresh: [fresh.engineInvoiceCount, fresh.reconciledInvoiceCount],
                       restored: [restored.engineInvoiceCount, restored.reconciledInvoiceCount] }));

  // THE CACHED BREAKDOWN, which is the one the panel opens. Passing the invoice
  // register here instead of the saved engine records leaves the globals correct
  // and the panel wrong: the register carries no matchConfidence, so every
  // direct invoice reads as shared and the coverage and occupancy buckets move.
  yes('the breakdown the panel opens is the same one the fresh run cached',
      !!restored.cached && !!fresh.cached
        && vKeys.every(k => Math.abs((restored.cached[k] || 0) - (fresh.cached[k] || 0)) < 0.005),
      JSON.stringify({ fresh: fresh.cached, restored: restored.cached }));
  yes('    including which invoices it counts as direct',
      !!restored.cached && restored.cached.directCount === fresh.cached.directCount,
      JSON.stringify([fresh.cached && fresh.cached.directCount,
                      restored.cached && restored.cached.directCount]));

  console.log('\n── F-6 · the CTA still points somewhere true ──');
  yes('the next step is the same one the fresh run offered',
      restored.variance.nextStep === fresh.variance.nextStep,
      JSON.stringify([fresh.variance.nextStep, restored.variance.nextStep]));
  yes('    and it is not the residual CTA — the run reconciled to a cent',
      restored.variance.nextStep !== 'residual', String(restored.variance.nextStep));
  if (fresh.cta) {
    yes('    the rendered banner button says the same thing', restored.cta === fresh.cta,
        JSON.stringify({ fresh: fresh.cta, restored: restored.cta }));
  }

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
