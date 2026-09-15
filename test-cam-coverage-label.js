'use strict';
/**
 * test-cam-coverage-label.js — the CAM summary badge must name what it measures.
 *
 *   node test-cam-coverage-label.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * The Reconciliation Summary panel head read:
 *
 *     📊 RECONCILIATION SUMMARY    47.1% coverage    0 of 5 tenants billable
 *
 * and a few lines below, in its own KPI row:
 *
 *     90.0% Space under lease      90.0% Covered all year
 *
 * Two numbers called coverage on one card, 43 points apart. A manager reading
 * them sees the product contradicting itself about how much of the building is
 * covered — and the badge is the one that is wrong, because 47.1% is not a
 * coverage figure at all.
 *
 * WHAT THE 47.1% ACTUALLY IS, proven from the producer at script.js:
 *
 *     (totalBilled / totalPool * 100).toFixed(1)
 *
 *     totalBilled = results.reduce((s, r) => s + r.totalAllocated, 0)
 *                   — each tenant's POST-CAP allocation, summed
 *     totalPool   = invoices.reduce((s, inv) => s + amount, 0)
 *                   — the gross invoice total
 *
 * On Cascade Commons: $88,776.77 ÷ $188,300.00 = 47.1%. The file's own comment
 * above `variance` lists FOUR reductions standing between those two figures —
 * coverage below 100%, non-CAM-eligible invoices, per-tenant category
 * exclusions, and cap adjustments. Coverage is one of the four. Naming the
 * whole ratio after it mislabels the other three.
 *
 * WHY "allocated" AND NOT THE OBVIOUS ALTERNATIVES — both are already taken:
 *
 *   "recovery"  "Recovered Revenue" is a DIFFERENT figure in this product:
 *               cap savings + disputes + exclusions, money protected rather
 *               than money charged, defined in its own methodology block.
 *   "billed"    the KPI directly below deliberately switches "Total Billed" to
 *               "Calculated Tenant Allocation" when a run cannot be billed,
 *               because calling it billed would be a claim that money moved.
 *               Nothing has been billed on this run.
 *
 * "Allocated" is the panel's own word for this number — the KPI below it and
 * the ALLOCATED column in the table both use it — and it is true whether or not
 * the reconciliation is billable.
 *
 * THE VALUE IS NOT TOUCHED. Section A pins the arithmetic; section C pins that
 * the two real coverage figures still read 90.0%.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const PORT = parseInt(process.env.CCL_PORT || '8975', 10);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let passed = 0, failed = 0;
const failures = [];
function is(cond, label, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; failures.push(label); console.log('  ✗ ' + label + (detail != null ? '\n      ' + detail : '')); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  is(a === e, label, a === e ? null : 'expected ' + e + '\n      actual   ' + a);
}
function S(t) { console.log('\n\x1b[35m' + t + '\x1b[0m'); }

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
               '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
               '.pdf': 'application/pdf', '.woff2': 'font/woff2' };

const SUPABASE_MOCK = `
(function() {
  var _store = { properties: [], tenants: [] };
  var _user = { id: 'ccl-user', email: 'ccl@e2e-test.local' }, _session = null;
  function P(v) { return Promise.resolve(v); }
  function makeQ(t) {
    var f = {};
    function rows() { return (_store[t]||[]).filter(function(r){
      return Object.keys(f).every(function(k){ return r[k] === f[k]; }); }); }
    var q = {
      select: function(){ return q; }, eq: function(c,v){ f[c]=v; return q; },
      neq: function(){ return q; }, not: function(){ return q; }, is: function(){ return q; },
      in: function(){ return q; }, order: function(){ return q; }, limit: function(){ return q; },
      insert: function(rs){ var a = Array.isArray(rs)?rs:[rs];
        a.forEach(function(r){ if(!r.id) r.id='row-'+Math.random().toString(36).slice(2);
          if(_store[t]) _store[t].push(r); });
        var p = P({data:a,error:null});
        p.select = function(){ return { single: function(){ return P({data:a[0],error:null}); },
          then: function(fn){ return P({data:a,error:null}).then(fn); } }; };
        return p; },
      upsert: function(rs){ var a = Array.isArray(rs)?rs:[rs];
        a.forEach(function(r){ if(!r.id) r.id='row-'+Math.random().toString(36).slice(2);
          if(!_store[t]) _store[t]=[];
          var i=_store[t].findIndex(function(x){return x.id===r.id;});
          if(i>=0) _store[t][i]=r; else _store[t].push(r); });
        var p = P({data:a,error:null}); p.select=function(){ return P({data:a,error:null}); }; return p; },
      update: function(v){ rows().forEach(function(r){ Object.assign(r,v); });
        var p = P({data:null,error:null}); p.select=function(){return P({data:null,error:null});};
        p.eq=function(){return P({data:null,error:null});}; return p; },
      delete: function(){ return { eq:function(){return P({error:null});},
        in:function(){return P({error:null});}, neq:function(){return P({error:null});} }; },
      single: function(){ return P({data: rows()[0]||null, error:null}); },
      maybeSingle: function(){ return P({data: rows()[0]||null, error:null}); },
      then: function(fn){ return P({data: rows(), error:null}).then(fn); }
    };
    return q;
  }
  function sess(){ return { user:_user, access_token:'mock', expires_at:(Date.now()/1000)+3600 }; }
  window.supabase = { createClient: function(){ return {
    auth: {
      getUser: function(){ return P({data:{user:_session?_user:null},error:null}); },
      getSession: function(){ return P({data:{session:_session},error:null}); },
      refreshSession: function(){ return P({data:{session:_session},error:null}); },
      signUp: function(){ _session=sess(); return P({data:{session:_session,user:_user},error:null}); },
      signInWithPassword: function(){ _session=sess(); return P({data:{session:_session,user:_user},error:null}); },
      onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; },
      signOut: function(){ _session=null; return P({error:null}); }
    },
    from: function(t){ if(!_store[t]) _store[t]=[]; return makeQ(t); },
    rpc: function(){ return P({data:null,error:null}); },
    storage: { from: function(){ return {
      upload: function(){ return P({data:{path:'mock'},error:null}); },
      createSignedUrl: function(){ return P({data:{signedUrl:'https://mock.local/x'},error:null}); },
      getPublicUrl: function(){ return {data:{publicUrl:''}}; } }; } }
  }; } };
})();`;

(async () => {
  const server = http.createServer((req, res) => {
    let r = decodeURIComponent(req.url.split('?')[0]);
    if (r === '/') r = '/index.html';
    fs.readFile(path.join(ROOT, r), (e, d) => {
      if (e) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  await new Promise((rs, rj) => { server.listen(PORT, '127.0.0.1', rs); server.on('error', rj); });

  const launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (fs.existsSync(CHROME)) launch.executablePath = CHROME;
  const browser = await pw.chromium.launch(launch);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String((e && e.message) || e).split('\n')[0]));

  try {
    await page.route('**/*', route => route.request().url().includes('127.0.0.1')
      ? route.continue()
      : route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* blocked */' }));
    await page.addInitScript(SUPABASE_MOCK);
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 60000 });

    // Enter through the landing hero so MainStreetLanding.hide() actually runs.
    await page.waitForTimeout(1200);
    const heroUp = await page.evaluate(() => {
      const r = document.getElementById('msLanding');
      return !!(r && r.classList.contains('msl-on'));
    });
    if (heroUp) {
      await page.locator('#msLanding button, #msLanding a').filter({ hasText: /^Sign In$/ })
        .first().click({ timeout: 12000 });
      await page.waitForTimeout(800);
    }
    await page.waitForSelector('#loginEmail', { state: 'visible', timeout: 25000 });
    await page.fill('#loginEmail', 'ccl@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.locator('#loginBtn').click({ timeout: 12000 });
    await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== '';
    }, null, { timeout: 45000 });

    await page.waitForSelector('.ptf-demo-card', { timeout: 20000 });
    await page.locator('.ptf-demo-card').filter({ hasText: 'Cascade Commons' })
      .first().locator('.ptf-card-open-btn').first().click({ timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Cascade Commons';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.switchWorkspaceTab && window.switchWorkspaceTab('cam'));
    await page.waitForTimeout(3000);

    const seen = await page.evaluate(() => {
      const badge = document.querySelector('.rcs-coverage-badge');
      const kpis = {};
      document.querySelectorAll('.rcs-kpi').forEach(e => {
        const v = e.querySelector('.rcs-kpi-val'), l = e.querySelector('.rcs-kpi-lbl');
        if (v && l) kpis[l.textContent.trim()] = v.textContent.trim();
      });
      const inv = (typeof lastInvoicesFull !== 'undefined' ? lastInvoicesFull : []);
      const pool = inv.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      const billed = (typeof lastResults !== 'undefined' ? lastResults : [])
        .reduce((s, r) => s + r.totalAllocated, 0);
      return {
        badgeText: badge ? badge.textContent.trim() : null,
        badgeTitle: badge ? (badge.getAttribute('title') || '') : null,
        panelHead: (document.querySelector('.rcs-panel-head') || {}).innerText || '',
        kpis,
        totalBilled: Number(billed.toFixed(2)),
        totalPool: Number(pool.toFixed(2)),
        camResults: (typeof lastResults !== 'undefined' ? lastResults : [])
          .map(r => ({ name: r.name, totalAllocated: r.totalAllocated })),
        tenants: (window.currentProperty().tenants || []).map(t => ({
          tenant_name: t.tenant_name, leased_sqft: t.leased_sqft, lease_type: t.lease_type,
          cap: t.cap, start_date: t.start_date, end_date: t.end_date }))
      };
    });

    S('A. The VALUE is untouched');
    eq(seen.totalBilled, 88776.77, 'the numerator is still the summed post-cap allocation');
    eq(seen.totalPool, 188300, 'the denominator is still the gross invoice pool');
    eq((seen.totalBilled / seen.totalPool * 100).toFixed(1), '47.1',
      'the ratio is still 47.1%');
    is(/\b47\.1%/.test(seen.badgeText), 'and 47.1% is what the badge still shows',
      JSON.stringify(seen.badgeText));
    eq(seen.kpis['Calculated Tenant Allocation'], '$88,776.77',
      'the allocation KPI beside it is unchanged');
    eq(seen.kpis['CAM Pool'], '$188,300.00', 'the CAM Pool KPI is unchanged');

    // WHICH POOL IS THE DENOMINATOR. On Cascade Commons every invoice is
    // CAM-eligible, so the gross pool and the CAM-eligible pool are the same
    // $188,300 and a badge dividing by either reads 47.1%. That is not proof —
    // it is a coincidence of this data, and a mutant swapping one for the other
    // survived until this case existed. _buildReconciliationSummaryHtml takes
    // its invoices as an argument, so the two can be told apart by calling it
    // with a list where they differ. Nothing in the app is mutated.
    const denom = await page.evaluate(() => {
      const inv = (lastInvoicesFull || []).map(i => Object.assign({}, i));
      const biggest = inv.slice().sort((a, b) =>
        (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))[0];
      const excluded = parseFloat(biggest.amount) || 0;
      inv.find(i => i === biggest || i.id === biggest.id).camEligible = false;
      const gross = inv.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      const camPool = window.CamPool.total(inv);
      const html = _buildReconciliationSummaryHtml(lastResults, inv, 'Cascade Commons', inv, inv);
      const m = html.match(/class="rcs-coverage-badge"[\s\S]*?>([\d.]+)% of pool allocated</);
      const billed = lastResults.reduce((s, r) => s + r.totalAllocated, 0);
      return {
        excluded, gross, camPool,
        poolsNowDiffer: gross !== camPool,
        rendered: m ? m[1] : null,
        ifGross: (billed / gross * 100).toFixed(1),
        ifCamEligible: camPool > 0 ? (billed / camPool * 100).toFixed(1) : null
      };
    });
    is(denom.poolsNowDiffer,
      'the fixture really does make the gross and CAM-eligible pools differ',
      JSON.stringify(denom));
    is(denom.ifGross !== denom.ifCamEligible,
      'and the two candidate denominators give different percentages',
      `${denom.ifGross}% vs ${denom.ifCamEligible}%`);
    eq(denom.rendered, denom.ifGross,
      'the badge divides by the GROSS expense pool, as its wording says');
    is(denom.rendered !== denom.ifCamEligible,
      'and not by the CAM-eligible pool, which is a different figure',
      `rendered ${denom.rendered}% · camEligible would be ${denom.ifCamEligible}%`);

    // A ZERO POOL IS NOT A ZERO RATIO. Cascade Commons always has $188,300 of
    // invoices, so the divide-by-zero guard is never reached on this demo and
    // a mutant removing it survived. An empty pool makes the ratio undefined,
    // and the badge must say so rather than print 0.0% or NaN.
    const zero = await page.evaluate(() => {
      const html = _buildReconciliationSummaryHtml(lastResults, [], 'Cascade Commons', [], []);
      const m = html.match(/class="rcs-coverage-badge"[\s\S]*?>([^<]*)</);
      return m ? m[1].trim() : null;
    });
    is(zero != null && !/\bNaN\b/i.test(zero),
      'an empty expense pool does not render NaN', JSON.stringify(zero));
    is(!/^0(\.0)?%/.test(zero || ''),
      'and does not claim 0% was allocated — the ratio is undefined, not zero',
      JSON.stringify(zero));
    is(/—/.test(zero || ''),
      'it declines to divide, and shows an em dash', JSON.stringify(zero));

    S('B. The LABEL now names what the ratio measures');
    is(/allocated/i.test(seen.badgeText),
      'the badge says the pool was ALLOCATED — the panel\'s own word for this number',
      JSON.stringify(seen.badgeText));
    eq(seen.badgeText, '47.1% of pool allocated', 'the badge reads exactly that');
    is(/pool/i.test(seen.badgeText), 'and names the pool it is a share of');
    is(/88,776\.77/.test(seen.badgeTitle) && /188,300/.test(seen.badgeTitle),
      'its tooltip states both figures the ratio is built from', JSON.stringify(seen.badgeTitle));

    S('C. NEGATIVE — the misleading wording is gone');
    is(!/coverage/i.test(seen.badgeText),
      'the badge no longer calls this ratio coverage', JSON.stringify(seen.badgeText));
    is(!/47\.1%\s*coverage/i.test(seen.panelHead),
      'the exact old string "47.1% coverage" is not rendered anywhere in the panel head',
      JSON.stringify(seen.panelHead));
    is(!/\d+(\.\d+)?%\s*coverage/i.test(seen.panelHead),
      'and no percentage in the panel head is labelled coverage at all',
      JSON.stringify(seen.panelHead));
    // The word may still appear in the tooltip, but only to DISCLAIM it.
    is(/not a coverage figure/i.test(seen.badgeTitle),
      'the tooltip explicitly says this is not a coverage figure',
      JSON.stringify(seen.badgeTitle));

    S('D. The real coverage figures are untouched');
    eq(seen.kpis['Space under lease'], '90.0%', 'Space under lease still reads 90.0%');
    eq(seen.kpis['Covered all year'], '90.0%', 'Covered all year still reads 90.0%');
    is(seen.kpis['Space under lease'] !== seen.badgeText.match(/[\d.]+%/)[0],
      'and the coverage figure is visibly a different number from the allocation ratio',
      `${seen.kpis['Space under lease']} vs ${seen.badgeText}`);
    eq(seen.kpis['Caps Applied'], '4 (−$75,548.60)', 'Caps Applied is unchanged');
    eq(seen.kpis['Allocation Flags'], '0', 'Allocation Flags is unchanged');

    S('E. One card, no two numbers sharing a name');
    const pctLabels = await page.evaluate(() => {
      const head = document.querySelector('.rcs-panel-head');
      const kpiRow = document.querySelector('.rcs-kpis');
      const txt = (head ? head.innerText : '') + '\n' + (kpiRow ? kpiRow.innerText : '');
      // every "<n>% <word(s)>" pairing rendered on the card
      return txt.split('\n').map(s => s.trim()).filter(s => /\d%/.test(s));
    });
    const coverageClaims = pctLabels.filter(s => /coverage|covered|under lease/i.test(s));
    is(coverageClaims.every(s => /90\.0%/.test(s)),
      'every percentage on the card that claims coverage reads 90.0%',
      JSON.stringify(coverageClaims));
    is(pctLabels.some(s => /47\.1%/.test(s) && !/coverage|covered/i.test(s)),
      'the 47.1% figure is present and is not among them', JSON.stringify(pctLabels));

    S('F. The five demo tenants and the CAM results are unchanged');
    eq(seen.camResults, [
      { name: 'Whole Health Market', totalAllocated: 34650 },
      { name: 'Summit Coffee & Provisions', totalAllocated: 6696 },
      { name: 'ProActive Physical Therapy', totalAllocated: 13780 },
      { name: 'FitZone Athletics', totalAllocated: 24960 },
      { name: 'Harbor Nail & Beauty Studio', totalAllocated: 8690.77 }
    ], 'every tenant allocation is exactly as it was');
    eq(seen.tenants, [
      { tenant_name: 'Whole Health Market', leased_sqft: 9200, lease_type: 'NNN', cap: '5', start_date: '2021-01-01', end_date: '2028-12-31' },
      { tenant_name: 'Summit Coffee & Provisions', leased_sqft: 1800, lease_type: 'NNN', cap: '8', start_date: '2023-03-01', end_date: '2026-02-28' },
      { tenant_name: 'ProActive Physical Therapy', leased_sqft: 4400, lease_type: 'Modified Gross', cap: '6', start_date: '2022-07-01', end_date: '2027-06-30' },
      { tenant_name: 'FitZone Athletics', leased_sqft: 6800, lease_type: 'NNN', cap: '4', start_date: '2022-01-01', end_date: '2026-12-31' },
      { tenant_name: 'Harbor Nail & Beauty Studio', leased_sqft: 1200, lease_type: 'NNN', cap: null, start_date: '2024-02-01', end_date: '2027-01-31' }
    ], 'and the five leases are untouched');

    S('G. The page loaded clean');
    is(pageErrors.length === 0, 'no uncaught page errors', pageErrors.slice(0, 5).join(' | '));
  } catch (e) {
    failed++; failures.push('harness: ' + (e && e.message));
    console.log('\n  ✗ HARNESS ERROR: ' + (e && e.stack));
  } finally {
    try { await browser.close(); } catch (_) {}
    try { server.close(); } catch (_) {}
  }

  console.log('\n' + '─'.repeat(72));
  console.log(failed === 0
    ? `\x1b[32m✓ ALL ${passed} ASSERTIONS PASSED\x1b[0m`
    : `\x1b[31m✗ ${failed} FAILED\x1b[0m (${passed} passed)\n  ` + failures.join('\n  '));
  process.exit(failed === 0 ? 0 : 1);
})();
