'use strict';
/**
 * test-e2e-test3.js — the Test 3 walkthrough, replayed end to end.
 *
 *   node test-e2e-test3.js
 *   SHOTS=1 node test-e2e-test3.js      # screenshots to ./screenshots-t3
 *   HEADLESS=0 node test-e2e-test3.js   # watch it
 *
 * WHY THIS SUITE EXISTS
 *
 * Test 3 was a manual walkthrough that found five defects the unit suites did
 * not. Every one of them lived in the gap between "the function returns the
 * right value" and "the screen says the right thing":
 *
 *   1. A $110,000 exposure figure on a $67,300 pool — two findings describing
 *      the same $55,000 invoice with dedup keys one character apart.
 *   2. That invoice, which HAS a source document, described as weakly
 *      evidenced. It is a concentration, not an evidence gap.
 *   3. A lease shown as Ready while the same card read Missing Sq Ft.
 *   4. A bare "high" beside a severity badge, reading as a second severity.
 *      It is the AI's confidence in its clause reading.
 *   5. A coverage gap reported as a deficiency with no way to act on it.
 *
 * Replaying it once by hand also found a sixth: the fix for (3) over-blocked,
 * telling the reader two leases "cannot be reconciled" on the run that
 * reconciled them. That one is pinned here and in test-lease-readiness.js.
 *
 * SO THIS SUITE ASSERTS AGAINST THE RENDERED PRODUCT, NOT AGAINST BUILDERS.
 * It signs in to the real app against a mocked Supabase, seeds the same three
 * leases and five invoices Test 3 used, calls the real runAllocation(), and
 * then reads what the real renderers actually put on screen: the bulk
 * readiness list, all five reports, the Lease Review panel, the billing gate
 * and a tenant statement. A builder returning the right object while the
 * screen shows something else must fail here.
 *
 * DETERMINISM
 * Fixed timezone, fixed seed data, fixed port, its own localStorage key, no
 * network egress (every non-local request is aborted). No wall-clock date is
 * asserted on. Same input, same output, every run.
 *
 * A NOTE ON VACUOUS PASSES
 * This file has already produced two. Measuring a hidden #appContent gave every
 * layout assertion 0x0 rects to pass on; asserting the confidence chip against
 * the Audit Exception Summary passed on zero chips, because that chip is
 * rendered by the Lease Review panel. Both are guarded below — where an
 * assertion depends on something having rendered, that it rendered is asserted
 * first. Keep that habit when adding to this file.
 */
process.env.TZ = 'America/New_York';

// Registered in test-regression.js, so it must not take the whole suite down on
// a machine with no browser — but it must not quietly pass there either, which
// is the same vacuous-pass failure this file exists to prevent. Skipping is
// therefore explicit and loud, never inferred.
const SKIP = process.env.SKIP_BROWSER_TESTS === '1';

let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-test3: playwright is not installed.\x1b[0m');
      console.error('This suite replays the Test 3 workflow in a real browser and cannot');
      console.error('verify anything without one. Install playwright, or set');
      console.error('SKIP_BROWSER_TESTS=1 to deliberately skip it.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-test3 SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The Test 3 workflow was NOT verified on this run.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7893', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const SHOTS    = process.env.SHOTS === '1';
const SHOT_DIR = path.join(__dirname, 'screenshots-t3');
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

// ── The Test 3 dataset, exactly as the walkthrough used it ────────────────────
// Property: 100,000 sqft, CAM year 2026.
// Three leases: two expired with sqft, one live with NO sqft.
// Five invoices totalling $67,300, one of them $55,000 (81.7% of the pool).
const PROP_ID = 't3-prop-000000000001';
const T = {
  dover: 't3-tenant-dover-000001',
  para:  't3-tenant-para-0000001',
  gsb:   't3-tenant-gsb-00000001',
};
const TENANTS = [
  { id: T.dover, tenant_name: 'Dover', leased_sqft: 8194,
    lease_type: 'Triple Net (NNN)', start_date: '2011-07-01', end_date: '2016-07-01',
    cap: null, capBaseAmount: null, excluded_categories: '', status: 'complete' },
  { id: T.para, tenant_name: 'Paradigm', leased_sqft: 29088,
    lease_type: 'Triple Net (NNN)', start_date: '1998-03-01', end_date: '2003-02-28',
    cap: null, capBaseAmount: null, excluded_categories: '', status: 'complete' },
  // The lease that produced the contradictory readiness state: complete +
  // confirmed, but no square footage, so it cannot be reconciled.
  { id: T.gsb, tenant_name: 'Guaranty State Bank', leased_sqft: null,
    lease_type: 'Triple Net (NNN)', start_date: '2020-01-01', end_date: '2030-01-01',
    cap: null, capBaseAmount: null, excluded_categories: '', status: 'complete' },
];
const INVOICES = [
  { id: 't3-inv-1', vendorName: 'MainStreet CAM Validation', amount: '55000', category: 'validation',
    invoiceDate: '2026-02-10', fileName: 'validation.pdf', fileUrl: 'https://mock.local/validation.pdf',
    confidence: { amount: 95, vendor: 95, category: 90 } },
  { id: 't3-inv-2', vendorName: 'Alpha Landscaping', amount: '4200', category: 'landscaping',
    invoiceDate: '2026-03-01', fileName: 'alpha.pdf', fileUrl: 'https://mock.local/alpha.pdf',
    confidence: { amount: 92, vendor: 92, category: 90 } },
  { id: 't3-inv-3', vendorName: 'Beta Janitorial', amount: '3100', category: 'janitorial',
    invoiceDate: '2026-04-01', fileName: 'beta.pdf', fileUrl: 'https://mock.local/beta.pdf',
    confidence: { amount: 92, vendor: 92, category: 90 } },
  { id: 't3-inv-4', vendorName: 'Gamma Snow', amount: '2800', category: 'snow',
    invoiceDate: '2026-01-15', fileName: 'gamma.pdf', fileUrl: 'https://mock.local/gamma.pdf',
    confidence: { amount: 92, vendor: 92, category: 90 } },
  { id: 't3-inv-5', vendorName: 'Delta Utilities', amount: '2200', category: 'utilities',
    invoiceDate: '2026-05-01', fileName: 'delta.pdf', fileUrl: 'https://mock.local/delta.pdf',
    confidence: { amount: 92, vendor: 92, category: 90 } },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID = 't3-user';
  var _user = { id: USER_ID, email: 't3@e2e-test.local' };
  var _session = null;
  var KEY = '__t3_store';
  var seed = {
    properties: [{
      id: ${JSON.stringify(PROP_ID)}, user_id: USER_ID, name: 'Test 3 Property', sqft: 100000,
      data: {
        invoices: ${JSON.stringify(INVOICES)},
        disputes: [], camYear: 2026, results: null, camReconciliation: null,
        activityLog: [], timeline: [], escrowReserves: [], drawRequests: [],
        tenants: ${JSON.stringify(TENANTS)},
      },
    }],
    tenants: [],
  };
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return JSON.parse(JSON.stringify(seed));
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(_store)); } catch (e) {} }
  var _store = load();
  window.__store = function () { return _store; };
  function res(data) { return Promise.resolve({ data: data, error: null }); }
  var _seq = 0;
  function table(name) {
    var rows = _store[name] || (_store[name] = []);
    var last = null;
    var api = {
      select: function () { return api; }, eq: function () { return api; },
      not: function () { return api; }, is: function () { return api; },
      in: function () { return api; }, order: function () { return api; },
      limit: function () { return api; },
      maybeSingle: function () { return res(last || rows[0] || null); },
      single: function () { return res(last || rows[0] || null); },
      insert: function (v) {
        var a = [].concat(v).map(function (r) {
          var row = JSON.parse(JSON.stringify(r));
          if (!row.id) row.id = 'mock-' + name + '-' + (++_seq);
          rows.push(row); return row;
        });
        last = a[0]; persist(); return api;
      },
      upsert: function (v) {
        var a = [].concat(v).map(function (r) {
          var row = JSON.parse(JSON.stringify(r));
          if (!row.id) row.id = 'mock-' + name + '-' + (++_seq);
          var i = rows.findIndex(function (x) { return x.id === row.id; });
          if (i >= 0) { rows[i] = Object.assign({}, rows[i], row); persist(); return rows[i]; }
          rows.push(row); return row;
        });
        last = a[0]; persist(); return api;
      },
      update: function (v) {
        rows.forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(v))); });
        last = rows[0]; persist(); return api;
      },
      delete: function () { return api; },
      then: function (r2) { return Promise.resolve({ data: last ? [last] : rows, error: null }).then(r2); },
    };
    return api;
  }
  window.supabase = { createClient: function () { return {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: _session }, error: null }); },
      getUser:    function () { return Promise.resolve({ data: { user: _session ? _user : null }, error: null }); },
      signInWithPassword: function () { _session = { access_token: 'mock', user: _user };
        return Promise.resolve({ data: { session: _session, user: _user }, error: null }); },
      signUp:  function () { return Promise.resolve({ data: { user: _user }, error: null }); },
      signOut: function () { _session = null; return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    },
    from: table,
    storage: { from: function () { return {
      upload: function () { return res({ path: 'mock' }); },
      createSignedUrl: function () { return res({ signedUrl: 'https://mock.local/x' }); } }; } },
  }; } };
})();
`;

(async () => {
  if (SHOTS && !fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server  = await startServer();
  const browser = await chromium.launch({
    headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    }
    return route.abort();
  });
  await page.addInitScript(SUPABASE_MOCK);
  await page.addInitScript(() => { window.__PROP_ID = 't3-prop-000000000001'; });

  console.log('\n══ Test 3 — full workflow replay through the real UI ══');

  // ── sign in ────────────────────────────────────────────────────────────────
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
  await page.fill('#loginEmail', 't3@e2e-test.local');
  await page.fill('#loginPassword', 'TestPass123!');
  await page.click('#loginBtn');
  await page.waitForFunction(() => {
    const app = document.getElementById('appContent');
    return app && app.style.display !== 'none' && app.style.display !== '';
  }, { timeout: 20000 });
  await page.waitForFunction(() => typeof _props !== 'undefined' && Array.isArray(_props) && _props.length > 0,
                             { timeout: 20000 });
  await page.evaluate(() => selectProperty(window.__PROP_ID));
  await page.waitForFunction(() => typeof tenantData !== 'undefined'
    && tenantData.filter(Boolean).length === 3, { timeout: 20000 });

  const seeded = await page.evaluate(() => ({
    prop:     currentProperty()?.name,
    sqft:     document.getElementById('totalSqft')?.value,
    camYear:  typeof getCamYear === 'function' ? getCamYear() : null,
    tenants:  tenantData.filter(Boolean).map(t => `${t.tenant_name}/${t.leased_sqft ?? 'no sqft'}`),
    invoices: invoiceData.filter(Boolean).map(i => `${i.vendorName} ${i.amount}`),
    invTotal: invoiceData.filter(Boolean).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0),
  }));
  console.log('\n── Loaded state ──');
  console.log('  property :', seeded.prop, '·', seeded.sqft, 'sqft · CAM year', seeded.camYear);
  console.log('  leases   :', seeded.tenants.join(' | '));
  console.log('  invoices :', seeded.invoices.join(' | '));
  console.log('  pool     : $' + seeded.invTotal.toLocaleString());

  yes('the three Test 3 leases loaded', seeded.tenants.length === 3, JSON.stringify(seeded.tenants));
  yes('the five Test 3 invoices loaded and total $67,300',
      seeded.invoices.length === 5 && seeded.invTotal === 67300, `got ${seeded.invoices.length} / $${seeded.invTotal}`);

  // ══ ISSUE 3 — readiness states, BEFORE reconciling ═════════════════════════
  console.log('\n── Issue 3: lease readiness on the bulk screen ──');
  await page.evaluate(() => {
    if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('spaces');
    if (typeof switchLeaseTab === 'function') switchLeaseTab('bulk');
    renderBulkResults();
  });
  await page.waitForSelector('#bulkResults', { state: 'attached', timeout: 15000 });

  const bulk = await page.evaluate(() => {
    const el = document.getElementById('bulkResults');
    const cards = [...el.querySelectorAll('.bulk-tenant-row, [id^="btr-"]')].map(r => {
      const name = (r.querySelector('.btr-name, .bulk-tenant-name, strong')?.textContent || '').trim();
      return { name, text: r.textContent.replace(/\s+/g, ' ').trim() };
    });
    const btn = [...el.querySelectorAll('button')]
      .map(b => b.textContent.replace(/\s+/g, ' ').trim())
      .find(t => /approve/i.test(t));
    const blocked = el.querySelector('.bulk-cam-blocked');
    return {
      full: el.textContent.replace(/\s+/g, ' ').trim(),
      cards, approveBtn: btn || null,
      blockedText: blocked ? blocked.textContent.replace(/\s+/g, ' ').trim() : null,
      reviewText: (() => { const r = el.querySelector('.bulk-cam-review');
        return r ? r.textContent.replace(/\s+/g, ' ').trim() : null; })(),
    };
  });
  if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, '1-readiness.png'), fullPage: true });

  console.log('  approve button :', JSON.stringify(bulk.approveBtn));
  console.log('  blocked block  :', bulk.blockedText ? bulk.blockedText.slice(0, 240) : '(none)');
  console.log('  review block   :', bulk.reviewText ? bulk.reviewText.slice(0, 240) : '(none)');
  bulk.cards.forEach(c => console.log('  card:', c.text.slice(0, 150)));

  yes('the approve control names the CAM-ready count, not a bare "ready"',
      !!bulk.approveBtn && /ready for CAM/i.test(bulk.approveBtn),
      `button reads ${JSON.stringify(bulk.approveBtn)}`);
  // getValidTenants() excludes a lease only for a missing name, sqft <= 0, a
  // failed extraction or a property mismatch. Dover and Paradigm have square
  // footage and DO reconcile, so both must be offered; Guaranty State Bank has
  // none and must not be.
  yes('the count is the 2 leases the engine can actually reconcile',
      !!bulk.approveBtn && /\b2\b/.test(bulk.approveBtn),
      `button reads ${JSON.stringify(bulk.approveBtn)}`);
  yes('only the lease with no square footage is called unreconcilable',
      !!bulk.blockedText && /Guaranty State Bank/i.test(bulk.blockedText)
        && /sq\s*ft/i.test(bulk.blockedText)
        && !/Dover|Paradigm/i.test(bulk.blockedText),
      `blocked block reads: ${JSON.stringify((bulk.blockedText || '').slice(0, 240))}`);
  yes('no lease is called Ready while it is also blocked',
      !(/Guaranty State Bank[^|]{0,120}?\bReady\b/i.test(bulk.full)),
      'a lease still reads Ready alongside a blocker');
  // The two reconcilable leases still carry open review items. They must be
  // said out loud, and must not be worded as though they stop the calculation.
  yes('open review items on reconcilable leases are surfaced separately',
      !!bulk.reviewText && /Dover/i.test(bulk.reviewText) && /Paradigm/i.test(bulk.reviewText),
      `review block reads: ${JSON.stringify((bulk.reviewText || '').slice(0, 240))}`);
  yes('the review note does not claim those leases cannot be reconciled',
      !!bulk.reviewText && /do not stop the CAM calculation/i.test(bulk.reviewText)
        && !/cannot be reconciled/i.test(bulk.reviewText),
      `review block reads: ${JSON.stringify((bulk.reviewText || '').slice(0, 240))}`);

  // Does the button approve exactly what it advertises?
  const approveMatch = await page.evaluate(() => {
    const el  = document.getElementById('bulkResults');
    const btn = [...el.querySelectorAll('button')].find(b => /approve/i.test(b.textContent));
    const advertised = parseInt((btn?.textContent || '').replace(/[^0-9]/g, ''), 10);
    // count what the same predicate would approve
    const blockers = (d) => {
      try { return (deriveTenantReviewState(d).camBlocking || []); } catch (_) { return []; }
    };
    const extractionOk = (d) =>
      !d._needsReview && !d.extractionFailed && d.status !== 'pending' && d.tenant_name && !d._userConfirmed;
    const ts = tenantData.filter(Boolean);
    const wouldApprove = ts.filter(d => extractionOk(d) && blockers(d).length === 0).length;
    const perLease = ts.map(d => ({ name: d.tenant_name, blockers: blockers(d), extractionOk: extractionOk(d) }));
    return { advertised, wouldApprove, perLease };
  });
  // window.bulkApproveReady is the async-guard WRAPPER at runtime, so its source
  // says nothing about the predicate. Read the shipped function instead.
  const approveSrc = (() => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const i = src.indexOf('async function bulkApproveReady');
    return src.slice(i, i + 900);
  })();
  const sharesPredicate = /deriveTenantReviewState\(d\)\.camBlocking/.test(approveSrc);
  console.log('  advertised:', approveMatch.advertised, ' would approve:', approveMatch.wouldApprove,
              ' bulkApproveReady uses the same predicate:', sharesPredicate);
  approveMatch.perLease.forEach(p => console.log(`    ${String(p.name).padEnd(22)} extractionOk=${p.extractionOk} blockers=${JSON.stringify(p.blockers)}`));
  yes('the button approves exactly the number it advertises',
      approveMatch.advertised === approveMatch.wouldApprove && sharesPredicate,
      `advertises ${approveMatch.advertised}, would approve ${approveMatch.wouldApprove}`);

  // ══ Run the reconciliation the way the button does ═════════════════════════
  console.log('\n── Running the reconciliation (real runAllocation) ──');
  await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('cam'); });
  await page.evaluate(() => runAllocation());
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length > 0,
                             { timeout: 30000 });

  const recon = await page.evaluate(() => ({
    pool:  lastTotal,
    year:  lastResultsYear,
    rows:  lastResults.map(r => ({
      name: r.name, sqFt: r.sqFt,
      pct:  r.proRataPercent != null ? +Number(r.proRataPercent).toFixed(4) : null,
      allocated: +Number(r.totalAllocated).toFixed(2),
    })),
    billed: +lastResults.reduce((s, r) => s + (Number(r.totalAllocated) || 0), 0).toFixed(2),
  }));
  console.log('  CAM pool        : $' + recon.pool.toLocaleString());
  console.log('  CAM year        :', recon.year);
  recon.rows.forEach(r => console.log(`  ${r.name.padEnd(22)} ${String(r.sqFt).padStart(7)} sqft  ${String(r.pct).padStart(8)}%  $${r.allocated.toLocaleString()}`));
  console.log('  billed to tenants: $' + recon.billed.toLocaleString());
  console.log('  landlord absorbs : $' + (recon.pool - recon.billed).toFixed(2));

  yes('the pool is the sum of the five invoices', recon.pool === 67300, `pool is ${recon.pool}`);
  yes('only the two leases with square footage were reconciled',
      recon.rows.length === 2, `${recon.rows.length} rows`);
  yes('pro-rata is share of the BUILDING, and the allocations follow it',
      recon.rows.every(r => Math.abs(r.allocated - (67300 * r.sqFt / 100000)) < 0.02),
      JSON.stringify(recon.rows));
  yes('tenants are billed less than the pool (the gap is not billed to anyone)',
      recon.billed < recon.pool, `billed ${recon.billed} vs pool ${recon.pool}`);

  // ══ ISSUES 1, 2, 4 — the audit findings as the app derives them ════════════
  console.log('\n── Issues 1/2/4: audit findings and exposure ──');
  const audit = await page.evaluate(() => {
    const s = buildAuditSummary();
    const n = buildAuditNarrative();
    const AX = window.AuditExposure;
    const all = [].concat(
      s.red.map(f => ['red', f]), s.yellow.map(f => ['yellow', f]), s.green.map(f => ['green', f]));
    return {
      counts: { red: s.red.length, yellow: s.yellow.length, green: s.green.length },
      money: all.map(([b, f]) => {
        const i = AX.normalizeImpact(f.impact);
        return i.amount == null ? null : {
          bucket: b, amount: i.amount, kind: i.kind,
          items: (i.items || []).map(x => x.id),
          title: f.title,
        };
      }).filter(Boolean),
      exposure: {
        pool: n.exposure.totalPool,
        atRisk: +Number(n.exposure.confirmedAtRisk).toFixed(2),
        review: +Number(n.exposure.requiringReview).toFixed(2),
        unsub: n.exposure.poolUnsubstantiated,
        conc:  n.exposure.poolConcentration,
        flagged: n.exposure.poolFlagged,
        exceedsPool: n.exposure.exceedsPool,
        unquantified: n.exposure.unquantified,
      },
      financialImpact: n.financialImpact,
      // Issue 4 — the confidence chip beside the severity badge
      findings: all.map(([b, f]) => ({ bucket: b, sev: f.severity, title: f.title, conf: f.confidence })),
    };
  });
  console.log('  findings:', JSON.stringify(audit.counts));
  audit.money.forEach(m => console.log(`  $${String(m.amount).padStart(9)}  ${m.kind.padEnd(15)} [${m.bucket}] items=${JSON.stringify(m.items)}\n              ${m.title.slice(0, 100)}`));
  console.log('  exposure:', JSON.stringify(audit.exposure));
  console.log('  narrative:', audit.financialImpact);

  yes('ISSUE 1 — the flagged pool figure cannot exceed the pool',
      audit.exposure.flagged <= audit.exposure.pool,
      `flagged $${audit.exposure.flagged} against a $${audit.exposure.pool} pool`);
  yes('ISSUE 1 — the $55,000 invoice is counted once, not twice',
      audit.exposure.flagged === 55000,
      `flagged reads $${audit.exposure.flagged}; the Test 3 defect printed $110,000`);
  yes('ISSUE 1 — no impossible figure reaches the narrative',
      !/110,?000/.test(audit.financialImpact) && audit.exposure.exceedsPool === false,
      audit.financialImpact);
  yes('ISSUE 2 — the $55,000 invoice is concentration, not "weakly evidenced"',
      audit.money.some(m => m.amount === 55000 && m.kind === 'concentration'),
      JSON.stringify(audit.money.map(m => `${m.amount}/${m.kind}`)));
  yes('ISSUE 2 — nothing with a source document is called unsubstantiated',
      audit.exposure.unsub === 0,
      `poolUnsubstantiated is $${audit.exposure.unsub}`);
  yes('ISSUE 2 — the narrative separates concentration from the allocation axis',
      /concentration/i.test(audit.financialImpact) && /separate measure/i.test(audit.financialImpact),
      audit.financialImpact);

  // ══ ISSUE 1, the arithmetic — the overlap that actually collides ═══════════
  //
  // Read this before trusting the three ISSUE 1 assertions above.
  //
  // Test 3's $110,000 needed TWO findings to describe the SAME invoice. In the
  // scenario above only one does: section 1 raises the concentration, and
  // sections 4/5/6 all decline — every invoice has a document, a date, and a
  // match confidence of 0 (section 6 wants > 0, a partial match). So the
  // assertions above confirm the figure is right, but they would confirm that
  // on code with the bug still in it. On their own they are close to vacuous,
  // and this file has shipped two vacuous passes already.
  //
  // Here is the state that genuinely collides: the same $55,000 invoice is both
  // the concentration AND undocumented, so section 1 and section 4 both carry
  // it. Before the fix their dedup keys differed by one character —
  // `invoice:MainStreet CAM Validation` against
  // `invoices:MainStreet CAM Validation` — and the model summed them to
  // $110,000 on a $67,300 pool. Nothing about the amounts changed; only whether
  // two descriptions of one invoice could be recognised as one invoice.
  console.log('\n── Issue 1: the overlap that produced $110,000 ──');
  const collide = await page.evaluate(() => {
    // Remove the document from the big invoice — section 4 tests
    // (!fileUrl && !fileName) — and rebuild from the same live state.
    const big = invoiceData.find(i => i && /MainStreet CAM Validation/.test(i.vendorName));
    const restore = { fileUrl: big.fileUrl, fileName: big.fileName };
    big.fileUrl = null; big.fileName = null;
    const s = buildAuditSummary();
    const n = buildAuditNarrative();
    const AX = window.AuditExposure;
    const all = [].concat(s.red, s.yellow, s.green)
      .map(f => ({ title: f.title, imp: AX.normalizeImpact(f.impact) }))
      .filter(x => x.imp.amount != null);
    const out = {
      carrying55k: all.filter(x => x.imp.amount === 55000)
        .map(x => ({ kind: x.imp.kind, items: (x.imp.items || []).map(i => i.id), title: x.title })),
      flagged: n.exposure.poolFlagged,
      unsub:   n.exposure.poolUnsubstantiated,
      conc:    n.exposure.poolConcentration,
      exceedsPool: n.exposure.exceedsPool,
      financialImpact: n.financialImpact,
    };
    big.fileUrl = restore.fileUrl; big.fileName = restore.fileName;
    return out;
  });
  console.log('  findings carrying the $55,000 invoice:');
  collide.carrying55k.forEach(f => console.log(`    ${f.kind.padEnd(16)} items=${JSON.stringify(f.items)}\n      ${f.title.slice(0, 96)}`));
  console.log('  poolUnsubstantiated:', collide.unsub, ' poolConcentration:', collide.conc);
  console.log('  poolFlagged (union):', collide.flagged, ' exceedsPool:', collide.exceedsPool);
  console.log('  narrative:', collide.financialImpact);

  // The guard against a vacuous run: if only one finding carries the invoice,
  // there is no overlap and the assertions below prove nothing.
  yes('the overlap really exists — two findings describe the same invoice',
      collide.carrying55k.length >= 2,
      `only ${collide.carrying55k.length} finding carries it; the collision is not being exercised`);
  yes('both findings identify it by the SAME atomic item id',
      collide.carrying55k.length >= 2 &&
      new Set(collide.carrying55k.flatMap(f => f.items)).size === 1,
      JSON.stringify(collide.carrying55k.map(f => f.items))
        + ' — differing ids are what produced $110,000');
  yes('the union counts the invoice once, not twice',
      collide.flagged === 55000,
      `poolFlagged is $${collide.flagged}; double-counted it would be $110,000`);
  yes('the union never exceeds the pool',
      collide.flagged <= 67300 && collide.exceedsPool === false,
      `flagged $${collide.flagged} against a $67,300 pool`);
  yes('and no impossible figure reaches the narrative',
      !/110,?000/.test(collide.financialImpact), collide.financialImpact);

  // ══ Reports, rendered by the real generators ═══════════════════════════════
  console.log('\n── Rendering the reports ──');
  const REPORTS = [
    ['CAM Reconciliation Summary', 'generateReconciliationSummary'],
    ['Audit Exception Summary',    'generateExceptionReport'],
    ['Coverage Gap Report',        'generateHolesReport'],
    ['Risk & Disputes Report',     'generateLandlordExport'],
    ['Lender Summary',             'generateLenderSummaryReport'],
  ];
  const rendered = {};
  for (const [label, fnName] of REPORTS) {
    const body = await page.evaluate(async ([fn, lbl]) => {
      const b0 = document.getElementById('rptBody');
      if (b0) b0.innerHTML = '';
      try { await window[fn](); } catch (e) { return { err: String(e && e.message || e) }; }
      const o = document.getElementById('rptBody');
      return {
        title: (document.getElementById('rptToolbarTitle')?.textContent || '').trim(),
        text:  (o?.textContent || '').replace(/\s+/g, ' ').trim(),
        html:  (o?.innerHTML || ''),
      };
    }, [fnName, label]);
    rendered[label] = body;
    if (body.err) { bad(`${label} rendered`, body.err); continue; }
    ok(`${label} rendered (${body.text.length} chars on screen)`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, `rpt-${label.replace(/\W+/g, '-')}.png`), fullPage: true });
  }

  const money = (s) => (s.match(/\$[\d,]+(?:\.\d\d)?/g) || []);
  const allText = Object.values(rendered).map(r => r.text || '').join(' \n ');

  console.log('\n── Issue 1 in the rendered reports ──');
  yes('no report prints $110,000 anywhere', !/\$110,000/.test(allText),
      'the impossible figure is still on screen');
  const overPool = money(allText)
    .map(s => parseFloat(s.replace(/[$,]/g, '')))
    .filter(v => v > 67300 && v < 1e7);
  console.log('  dollar figures above the pool:', overPool.length ? overPool.join(', ') : '(none)');
  yes('no rendered figure exceeds the $67,300 pool', overPool.length === 0,
      `found ${JSON.stringify(overPool)}`);

  console.log('\n── Issue 2 in the rendered reports ──');
  const weakNear55 = /weakly evidenced[^.]{0,160}55,000|55,000[^.]{0,160}weakly evidenced/i.test(allText);
  yes('the $55,000 invoice is not described as weakly evidenced', !weakNear55,
      'a report still calls a documented invoice weakly evidenced');
  yes('a report names the concentration explicitly',
      /concentration/i.test(allText), 'no report mentions concentration');

  // ── Issue 4: the confidence chip ─────────────────────────────────────────
  // The chip Test 3 showed ("Tax Allocation ... EXCEPTION  high") is rendered by
  // _renderValidationPanel in the Lease Review panel, NOT by the Audit Exception
  // Summary. Asserting against the exception report would pass on zero chips,
  // which proves nothing — so the real renderer is driven here with the same
  // Tax Allocation finding, at the same severity and confidence.
  console.log('\n── Issue 4: the confidence chip in the Lease Review panel ──');
  const conf = await page.evaluate(() => {
    // The exact Test 3 finding: TAX_ALLOCATION, critical (renders "EXCEPTION"),
    // AI confidence high. _renderValidationPanel RETURNS html, it does not
    // insert, so it is mounted here the way its caller mounts it.
    const findings = [{
      check: 'TAX_ALLOCATION', severity: 'critical', confidence: 'high',
      finding: 'Real estate taxes are allocated on a basis the lease does not define.',
      source: 'ai', section: 'Article 5.2',
    }];
    const host = document.createElement('div');
    host.id = '__t3ValidationPanel';
    host.innerHTML = _renderValidationPanel(findings, {});
    document.body.appendChild(host);
    const panel = host.querySelector('.lv-finding');
    const hdr   = host.querySelector('.lv-finding-hdr');
    return {
      html: panel ? panel.innerHTML : null,
      hdrText: hdr ? hdr.textContent.replace(/\s+/g, ' ').trim() : null,
      chip: (() => { const c = host.querySelector('.lv-conf');
        return c ? { text: c.textContent.trim(), title: c.getAttribute('title') } : null; })(),
      sevBadge: (() => { const b = host.querySelector('.lv-sev-badge');
        return b ? b.textContent.trim() : null; })(),
    };
  });
  console.log('  header  :', JSON.stringify(conf.hdrText));
  console.log('  severity:', JSON.stringify(conf.sevBadge));
  console.log('  chip    :', JSON.stringify(conf.chip));
  yes('the Tax Allocation finding actually rendered (not a vacuous check)',
      !!conf.chip && !!conf.sevBadge, JSON.stringify(conf));
  yes('the confidence value is labelled, not a bare word beside the severity',
      !!conf.chip && /^AI confidence:\s*high$/i.test(conf.chip.text),
      `chip reads ${JSON.stringify(conf.chip && conf.chip.text)}`);
  yes('the chip explains it is not a severity level',
      !!conf.chip && /not a severity level/i.test(conf.chip.title || ''),
      `title is ${JSON.stringify(conf.chip && conf.chip.title)}`);
  yes('the header no longer reads as two stacked severities',
      !!conf.hdrText && !/\b(EXCEPTION|WARNING|CRITICAL)\b\s+(high|medium|low)\b/i.test(conf.hdrText),
      `header reads ${JSON.stringify(conf.hdrText)}`);

  console.log('\n── Issue 5: the Coverage Gap report ──');
  const cg = rendered['Coverage Gap Report']?.text || '';
  const cgFinding = await page.evaluate(() => {
    const flags = _detectReconciliationIssues(lastResults, currentProperty(), `${getCamYear()}-12-31`);
    const f = flags.find(x => /Property CAM coverage/i.test(x.title));
    return f ? { title: f.title, severity: f.severity, kind: f.kind, disputable: f.disputable,
                 actions: f.actions || null, conditions: f.conditions } : null;
  });
  console.log('  finding:', cgFinding ? cgFinding.title : '(none)');
  if (cgFinding) {
    console.log('  severity/kind/disputable:', cgFinding.severity, '/', cgFinding.kind, '/', cgFinding.disputable);
    console.log('  actions:', JSON.stringify(cgFinding.actions));
    cgFinding.conditions.forEach(c => console.log('    ·', c));
  }
  yes('the coverage finding reports the measured state', !!cgFinding && /62\.7/.test(cgFinding.title),
      cgFinding ? cgFinding.title : 'no coverage finding raised');
  yes('it offers actions a reader can act on',
      !!cgFinding && Array.isArray(cgFinding.actions) && cgFinding.actions.length >= 2,
      JSON.stringify(cgFinding && cgFinding.actions));
  yes('it names the re-run as the step that settles the cause',
      !!cgFinding && cgFinding.conditions.some(c => /re-run/i.test(c)),
      JSON.stringify(cgFinding && cgFinding.conditions));
  yes('it never asserts the gap is vacant',
      !!cgFinding && !/untenanted/i.test(JSON.stringify(cgFinding)),
      'the finding asserts vacancy as fact');
  yes('the Coverage Gap report shows the input/reconciliation split',
      /Input coverage/i.test(cg) && /Reconciliation status/i.test(cg),
      'the scope split is missing from the rendered report');

  // ══ The billing gate and the tenant statement ══════════════════════════════
  console.log('\n── Billing gate and tenant statement ──');
  const gate = await page.evaluate(() => {
    const out = {};
    ['Dover', 'Paradigm', 'Guaranty State Bank'].forEach(n => {
      try {
        // A non-null block IS the refusal — there is no `blocked` field.
        const b = _statementReadinessBlock(n);
        out[n] = b ? {
          gated: true,
          canBill: b.readiness.canBill,
          blockingExceptions: b.red.length,
          namesThisTenant: b.mine.length,
          reason: b.readiness.reason || b.readiness.summary || null,
        } : { gated: false };
      } catch (e) { out[n] = { err: String(e && e.message || e) }; }
    });
    return out;
  });
  console.log('  gate:', JSON.stringify(gate));
  yes('every tenant statement on this reconciliation is gated',
      ['Dover', 'Paradigm', 'Guaranty State Bank'].every(n => gate[n] && gate[n].gated === true),
      JSON.stringify(gate));
  yes('the gate names how many blocking exceptions concern each tenant',
      gate['Dover'] && gate['Dover'].namesThisTenant >= 1,
      JSON.stringify(gate['Dover']));

  const stmt = await page.evaluate(async () => {
    const b0 = document.getElementById('rptBody');
    if (b0) b0.innerHTML = '';
    try { await generateTenantStatement('Dover'); } catch (e) { return { err: String(e && e.message || e) }; }
    const o = document.getElementById('rptBody');
    return { text: (o?.textContent || '').replace(/\s+/g, ' ').trim(), html: o?.innerHTML || '' };
  });
  if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, 'statement-dover.png'), fullPage: true });
  if (stmt.err) bad('the Dover statement rendered', stmt.err);
  else {
    console.log('  Dover statement (first 700 chars):');
    console.log('  ' + stmt.text.slice(0, 700));
    yes('the statement for the expired lease is gated, not silently billed',
        /cannot be (issued|billed)|not ready to bill|blocked|resolve .* before billing|Needs resolution/i.test(stmt.text),
        'the statement rendered a billable total with an unresolved audit finding');
    yes('the gate names the expired lease as the reason',
        /expired|ended 2016|lease that ended/i.test(stmt.text),
        'no reason given for the block');
    yes('the statement makes no present-tense on-chain claim',
        !/(settled|recorded|paid) on( the)? XRP( Ledger)?\b/i.test(stmt.text)
        && !/transaction (was )?confirmed/i.test(stmt.text),
        'the statement claims an on-chain settlement that has not happened');
  }

  const draft = await page.evaluate(async () => {
    const b0 = document.getElementById('rptBody');
    if (b0) b0.innerHTML = '';
    try { await generateTenantStatement('Dover', { draft: true }); }
    catch (e) { return { err: String(e && e.message || e) }; }
    const o = document.getElementById('rptBody');
    return { text: (o?.textContent || '').replace(/\s+/g, ' ').trim() };
  });
  if (!draft.err) {
    yes('a draft statement is explicitly marked as a draft',
        /draft/i.test(draft.text), 'the draft carries no draft marking');
    yes('the draft omits the settlement section',
        !/RLUSD|XRP Ledger/i.test(draft.text),
        'a draft still offers settlement');
  }

  console.log('\n── Page errors ──');
  yes('no uncaught page errors during the whole replay', errors.length === 0,
      errors.slice(0, 5).join(' | '));

  await browser.close();
  server.close();
  // The count guard. Test 3's defects were all things that rendered wrongly
  // rather than computed wrongly, so an assertion silently disappearing from
  // this file is the exact way its coverage would erode. Change this number
  // deliberately, in the same commit as the assertions.
  const TOTAL_EXPECTED = 51;
  yes(`suite runs all ${TOTAL_EXPECTED} checks`, pass + fail + 1 === TOTAL_EXPECTED,
      `assertion count changed — update TOTAL_EXPECTED deliberately (saw ${pass + fail + 1})`);

  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
