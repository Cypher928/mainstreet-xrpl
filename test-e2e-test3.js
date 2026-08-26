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
  }, null, { timeout: 45000 });
  await page.waitForFunction(() => typeof _props !== 'undefined' && Array.isArray(_props) && _props.length > 0, null,
                             { timeout: 45000 });
  await page.evaluate(() => selectProperty(window.__PROP_ID));
  await page.waitForFunction(() => typeof tenantData !== 'undefined'
    && tenantData.filter(Boolean).length === 3, null, { timeout: 45000 });

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
      .find(t => /confirm .* extraction/i.test(t));
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

  yes('the control names what it confirms — CAM-ready extractions, not leases',
      !!bulk.approveBtn && /CAM-ready extraction/i.test(bulk.approveBtn)
        && !/^approve/i.test(bulk.approveBtn),
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
        && /Confirming validates the extraction, not the lease terms/i.test(bulk.reviewText)
        && !/cannot be reconciled/i.test(bulk.reviewText),
      `review block reads: ${JSON.stringify((bulk.reviewText || '').slice(0, 240))}`);

  // Does the button approve exactly what it advertises?
  const approveMatch = await page.evaluate(() => {
    const el  = document.getElementById('bulkResults');
    const btn = [...el.querySelectorAll('button')].find(b => /confirm .* extraction/i.test(b.textContent));
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

  // ══ THE INVARIANT ══════════════════════════════════════════════════════════
  //
  // Every lease the UI says "will reconcile" must actually be eligible for
  // runAllocation(), and every lease the engine excludes for a blocking
  // condition must read as blocked on the readiness screen. The screen and the
  // engine have now disagreed twice — once over square footage, once over an
  // unconfirmed property mismatch — and both times a matching COUNT hid the
  // disagreement. So this compares the two SETS by name, not their sizes.
  //
  // getValidTenants() is the engine's own filter, called here directly.
  // _approvable is a strict subset of it by design: it additionally excludes
  // leases a human has already confirmed (_userConfirmed), which reconcile
  // perfectly well but need no further confirming.
  console.log('\n── Invariant: the readiness screen and the engine must agree ──');
  const agree = await page.evaluate(() => {
    const camBlockers  = (d) => { try { return deriveTenantReviewState(d).camBlocking || []; } catch (_) { return []; } };
    const extractionOk = (d) => !d._needsReview && !d.extractionFailed && d.status !== 'pending'
                                 && d.tenant_name && !d._userConfirmed;
    const ts = tenantData.filter(Boolean);
    const advertised = ts.filter(d => extractionOk(d) && camBlockers(d).length === 0).map(d => d.tenant_name);
    const blockedUI  = ts.filter(d => extractionOk(d) && camBlockers(d).length >  0).map(d => d.tenant_name);
    const engineOk   = getValidTenants().map(t => t.tenant_name);
    return {
      advertised, blockedUI, engineOk,
      advertisedNotEligible: advertised.filter(n => !engineOk.includes(n)),
      engineExcludedNotShownBlocked: ts
        .filter(d => extractionOk(d) && !engineOk.includes(d.tenant_name) && camBlockers(d).length === 0)
        .map(d => d.tenant_name),
    };
  });
  console.log('  UI says will reconcile :', JSON.stringify(agree.advertised));
  console.log('  UI says blocked        :', JSON.stringify(agree.blockedUI));
  console.log('  engine will accept     :', JSON.stringify(agree.engineOk));
  yes('every lease the UI advertises as CAM-ready IS eligible for runAllocation',
      agree.advertisedNotEligible.length === 0,
      `advertised but the engine drops: ${JSON.stringify(agree.advertisedNotEligible)}`);
  yes('every lease the engine drops reads as blocked on the readiness screen',
      agree.engineExcludedNotShownBlocked.length === 0,
      `engine drops but the UI calls CAM-ready: ${JSON.stringify(agree.engineExcludedNotShownBlocked)}`);

  // ══ The Dover scenario, end to end ═════════════════════════════════════════
  //
  // The Pilot finding: a lease whose document names a different property was
  // advertised as one of "2 leases will reconcile" while runAllocation dropped
  // it, silently moving $5,514.56 from the tenant to the landlord.
  console.log('\n── The Pilot scenario: an unconfirmed property mismatch ──');
  const mismatch = await page.evaluate(async () => {
    const prop  = currentProperty();
    const dover = tenantData.filter(Boolean).find(t => /^Dover/.test(t.tenant_name));
    const before = { name: dover.tenant_name, property_name: dover.property_name,
                     edges: dover._edgeCases, confirm: dover._propertyConfirm };
    // Make the lease name a different building, then run the REAL detector.
    dover.property_name = 'Northgate Commons';
    dover.fileName = dover.fileName || 'dover-lease.pdf';
    dover._edgeCases = window.LeaseIntelligence.detectLeaseEdgeCases(
      dover, { currentPropertyName: prop.name });
    prop.tenants = tenantData.filter(Boolean);

    const camBlockers  = (d) => { try { return deriveTenantReviewState(d).camBlocking || []; } catch (_) { return []; } };
    const extractionOk = (d) => !d._needsReview && !d.extractionFailed && d.status !== 'pending'
                                 && d.tenant_name && !d._userConfirmed;

    renderBulkResults();
    const el = document.getElementById('bulkResults');
    const g  = (sel) => { const n = el.querySelector(sel); return n ? n.textContent.replace(/\s+/g,' ').trim() : null; };
    const btn = [...el.querySelectorAll('button')].map(b => b.textContent.replace(/\s+/g,' ').trim())
      .find(t => /confirm .* extraction/i.test(t));

    await runAllocation();
    const reconciled = lastResults.map(r => r.name);

    // bulkApproveReady must refuse the same lease the count refuses.
    const wouldApprove = tenantData.filter(Boolean)
      .filter(d => extractionOk(d) && camBlockers(d).length === 0).map(d => d.tenant_name);

    const out = {
      detected: (dover._edgeCases.edgeCases || []).map(e => e.type),
      confirmed: window.LeaseIntelligence.isPropertyMismatchConfirmed(dover),
      blockReason: !!_propertyMismatchBlockReason(dover),
      camBlocking: camBlockers(dover),
      button: btn || null,
      blocked: g('.bulk-cam-blocked'),
      review:  g('.bulk-cam-review'),
      engineOk: getValidTenants().map(t => t.tenant_name),
      reconciled, wouldApprove,
      billed: +lastResults.reduce((s, r) => s + (Number(r.totalAllocated) || 0), 0).toFixed(2),
      banner: (() => { const n = document.querySelector('.cam-skip-warning');
        return n ? n.textContent.replace(/\s+/g,' ').trim() : null; })(),
    };
    window.__doverRestore = before;
    return out;
  });
  console.log('  detected      :', JSON.stringify(mismatch.detected));
  console.log('  confirmed     :', mismatch.confirmed, ' blocking:', mismatch.blockReason);
  console.log('  camBlocking   :', JSON.stringify(mismatch.camBlocking));
  console.log('  button        :', JSON.stringify(mismatch.button));
  console.log('  blocked block :', mismatch.blocked);
  console.log('  review block  :', mismatch.review);
  console.log('  engine accepts:', JSON.stringify(mismatch.engineOk));
  console.log('  reconciled    :', JSON.stringify(mismatch.reconciled), ' billed $' + mismatch.billed);

  yes('the mismatch is detected and unconfirmed (not a vacuous scenario)',
      mismatch.detected.includes('PROPERTY_NAME_MISMATCH') && mismatch.confirmed === false
        && mismatch.blockReason === true,
      JSON.stringify(mismatch));
  yes('the readiness model now sees it as a CAM blocker',
      mismatch.camBlocking.some(b => /different property/i.test(b)),
      JSON.stringify(mismatch.camBlocking));
  yes('the count drops to the one lease that can actually reconcile',
      !!mismatch.button && /\b1\b/.test(mismatch.button), `button reads ${JSON.stringify(mismatch.button)}`);
  yes('Dover is named as blocked, with the reason',
      !!mismatch.blocked && /^.*Dover/i.test(mismatch.blocked)
        && /different property/i.test(mismatch.blocked),
      `blocked block: ${JSON.stringify(mismatch.blocked)}`);
  yes('Dover is NOT advertised as a lease that will reconcile',
      !mismatch.review || !/Dover/i.test(mismatch.review),
      `review block still names Dover: ${JSON.stringify(mismatch.review)}`);
  yes('bulk confirmation cannot confirm Dover',
      !mismatch.wouldApprove.some(n => /^Dover/.test(n)),
      `would confirm: ${JSON.stringify(mismatch.wouldApprove)}`);
  yes('the engine excludes Dover',
      !mismatch.engineOk.some(n => /^Dover/.test(n)), JSON.stringify(mismatch.engineOk));
  yes('the allocation excludes Dover',
      !mismatch.reconciled.some(n => /^Dover/.test(n)), JSON.stringify(mismatch.reconciled));
  yes('the blocking reason is visible after the run too',
      !!mismatch.banner && /different property/i.test(mismatch.banner),
      `banner: ${JSON.stringify(mismatch.banner)}`);
  yes('screen and engine now agree on the same lease',
      (!mismatch.review || !/Dover/i.test(mismatch.review))
        && !mismatch.reconciled.some(n => /^Dover/.test(n)),
      'the UI and the engine still disagree about Dover');

  // ══ The same lease, confirmed by the landlord ══════════════════════════════
  console.log('\n── The same mismatch, explicitly confirmed ──');
  const confirmedRun = await page.evaluate(async () => {
    const dover = tenantData.filter(Boolean).find(t => /^Dover/.test(t.tenant_name));
    dover._propertyConfirm = {
      extractedName: dover.property_name,
      documentKey:   window.LeaseIntelligence.propertyDocumentKey(dover),
      propertyId:    activePropId,
      confirmedAt:   '2026-08-23T00:00:00.000Z',
    };
    currentProperty().tenants = tenantData.filter(Boolean);
    const camBlockers = (d) => { try { return deriveTenantReviewState(d).camBlocking || []; } catch (_) { return []; } };
    renderBulkResults();
    const el = document.getElementById('bulkResults');
    const g  = (sel) => { const n = el.querySelector(sel); return n ? n.textContent.replace(/\s+/g,' ').trim() : null; };
    const btn = [...el.querySelectorAll('button')].map(b => b.textContent.replace(/\s+/g,' ').trim())
      .find(t => /confirm .* extraction/i.test(t));
    await runAllocation();
    return {
      confirmed:   window.LeaseIntelligence.isPropertyMismatchConfirmed(dover),
      blockReason: !!_propertyMismatchBlockReason(dover),
      camBlocking: camBlockers(dover),
      button:  btn || null,
      blocked: g('.bulk-cam-blocked'),
      engineOk: getValidTenants().map(t => t.tenant_name),
      rows: lastResults.map(r => ({ name: r.name, allocated: +Number(r.totalAllocated).toFixed(2) })),
      billed: +lastResults.reduce((s, r) => s + (Number(r.totalAllocated) || 0), 0).toFixed(2),
      okBanner: (() => { const n = document.querySelector('.cam-confirmed-note');
        return n ? n.textContent.replace(/\s+/g,' ').trim() : null; })(),
    };
  });
  console.log('  confirmed     :', confirmedRun.confirmed, ' still blocking:', confirmedRun.blockReason);
  console.log('  camBlocking   :', JSON.stringify(confirmedRun.camBlocking));
  console.log('  button        :', JSON.stringify(confirmedRun.button));
  console.log('  reconciled    :', JSON.stringify(confirmedRun.rows), ' billed $' + confirmedRun.billed);
  console.log('  confirmed note:', confirmedRun.okBanner);

  yes('confirmation clears the block',
      confirmedRun.confirmed === true && confirmedRun.blockReason === false
        && confirmedRun.camBlocking.length === 0,
      JSON.stringify(confirmedRun));
  yes('Dover is no longer listed as blocked',
      !confirmedRun.blocked || !/Dover/i.test(confirmedRun.blocked),
      `blocked block: ${JSON.stringify(confirmedRun.blocked)}`);
  yes('the engine accepts Dover again',
      confirmedRun.engineOk.some(n => /^Dover/.test(n)), JSON.stringify(confirmedRun.engineOk));
  yes('Dover reconciles at its original $5,514.56',
      confirmedRun.rows.some(r => /^Dover/.test(r.name) && Math.abs(r.allocated - 5514.56) < 0.01),
      JSON.stringify(confirmedRun.rows));
  yes('the confirmation is reported, not silent — an auditor must see it',
      !!confirmedRun.okBanner && /confirmed by the property owner/i.test(confirmedRun.okBanner),
      `note: ${JSON.stringify(confirmedRun.okBanner)}`);

  // ── The decision, and the finding it resolved, must survive a load ────────
  //
  // normalizeTenant() is an allow-list and the property blob is re-read through
  // it on every property LOAD. _edgeCases and _propertyConfirm were written to
  // storage and dropped on the way back in, so on the next load the mismatch was
  // gone, the blocker lifted, and the lease reconciled again with nothing on
  // screen — a safety gate evaporating in the permissive direction.
  //
  // THIS MUST BE A REAL PAGE RELOAD. The first version of this check called
  // selectProperty(null) then selectProperty(id), which re-reads objects already
  // normalized and held in _props — normalizeTenant never runs, and dropping the
  // fields from its allow-list left the check green. Verified by mutation: that
  // version caught neither MUT A nor MUT B.
  console.log('\n── Both states survive a real page reload ──');

  const READ_DOVER = () => {
    const d = tenantData.filter(Boolean).find(t => /^Dover/.test(t.tenant_name));
    if (!d) return { missing: true };
    return {
      edges:     !!d._edgeCases,
      confirm:   !!d._propertyConfirm,
      mismatch:  _hasPropertyMismatch(d),
      blocked:   !!_propertyMismatchBlockReason(d),
      confirmed: window.LeaseIntelligence.isPropertyMismatchConfirmed(d),
      by:        (d._propertyConfirm || {}).by || null,
      at:        (d._propertyConfirm || {}).at || null,
      camBlocking: (deriveTenantReviewState(d).camBlocking || []),
      engine:    getValidTenants().map(t => t.tenant_name),
    };
  };

  // Write the state straight into the stored blob and reload. Going through
  // savePropertyData() here proved unreliable inside the suite — an earlier
  // block's state won — and it is not what is under test anyway: the question is
  // strictly what survives being READ BACK through normalizeTenant().
  async function seedAndReload(withConfirmation) {
    await page.evaluate((confirmed) => {
      const store = window.__store();
      const t = store.properties[0].data.tenants.find(x => /^Dover/.test(x.tenant_name));
      t.property_name = 'Northgate Commons';
      t.fileName = 'dover-lease-v1.pdf';
      t._edgeCases = { edgeCases: [{ type: 'PROPERTY_NAME_MISMATCH', severity: 'high',
        description: 'names a different property', confidenceAdjustment: -20 }],
        totalConfidenceAdjustment: -20 };
      if (confirmed) {
        t._propertyConfirm = { extractedName: 'Northgate Commons',
          documentKey: 'dover-lease-v1.pdf', propertyId: window.__PROP_ID,
          propertyName: 'Test 3 Property', at: '2026-08-20T10:00:00.000Z',
          by: 'owner@e2e-test.local' };
      } else { delete t._propertyConfirm; }
      localStorage.setItem('__t3_store', JSON.stringify(store));
    }, withConfirmation);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 }).catch(() => {});
    if (await page.evaluate(() => { const b = document.getElementById('loginBtn');
                                    return !!(b && b.offsetParent !== null); })) {
      await page.fill('#loginEmail', 't3@e2e-test.local');
      await page.fill('#loginPassword', 'TestPass123!');
      await page.click('#loginBtn');
    }
    await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== '';
    }, null, { timeout: 45000 });
    await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
    await page.evaluate(() => selectProperty(window.__PROP_ID));
    await page.waitForFunction(() => typeof tenantData !== 'undefined'
      && tenantData.filter(Boolean).length === 3, null, { timeout: 45000 });
    // Guard against a vacuous run: the blob must really carry the state we are
    // asking the load path to preserve.
    const inBlob = await page.evaluate(() => {
      const t = window.__store().properties[0].data.tenants.find(x => /^Dover/.test(x.tenant_name));
      return { edges: !!t._edgeCases, confirm: !!t._propertyConfirm };
    });
    return { loaded: await page.evaluate(READ_DOVER), inBlob };
  }

  const c = await seedAndReload(true);
  const u = await seedAndReload(false);
  const afterConfirmed = c.loaded, afterUnconfirmed = u.loaded;
  console.log('  stored (confirmed / unconfirmed):', JSON.stringify(c.inBlob), JSON.stringify(u.inBlob));
  console.log('  confirmed,   after real reload:', JSON.stringify(afterConfirmed));
  console.log('  unconfirmed, after real reload:', JSON.stringify(afterUnconfirmed));

  yes('the two scenarios really were stored differently (not a vacuous check)',
      c.inBlob.edges && c.inBlob.confirm && u.inBlob.edges && !u.inBlob.confirm,
      `stored: ${JSON.stringify(c.inBlob)} vs ${JSON.stringify(u.inBlob)}`);

  yes('the detected mismatch survives a real page reload',
      afterConfirmed.edges && afterConfirmed.mismatch,
      'the mismatch is gone after reload — the CAM blocker evaporates on its own');
  yes('the landlord confirmation survives a real page reload',
      afterConfirmed.confirm && afterConfirmed.confirmed,
      'the recorded human decision is lost on reload');
  yes('who confirmed it and when survive too',
      afterConfirmed.by === 'owner@e2e-test.local'
        && afterConfirmed.at === '2026-08-20T10:00:00.000Z',
      JSON.stringify({ by: afterConfirmed.by, at: afterConfirmed.at }));
  yes('a CONFIRMED lease stays unblocked after reload',
      !afterConfirmed.blocked && afterConfirmed.camBlocking.length === 0
        && afterConfirmed.engine.some(n => /^Dover/.test(n)),
      JSON.stringify(afterConfirmed));
  yes('an UNCONFIRMED lease is STILL blocked after reload',
      afterUnconfirmed.mismatch && afterUnconfirmed.blocked
        && afterUnconfirmed.camBlocking.length === 1
        && !afterUnconfirmed.engine.some(n => /^Dover/.test(n)),
      JSON.stringify(afterUnconfirmed));
  yes('reloading the page never clears a CAM blocker by itself',
      afterUnconfirmed.blocked === true,
      'a reload lifted the blocker with no human decision behind it');

  // Restore the untouched Test 3 state for the rest of the suite.
  await page.evaluate(async () => {
    const dover = tenantData.filter(Boolean).find(t => /^Dover/.test(t.tenant_name));
    // A real page reload cleared window.__doverRestore, so restore to the known
    // Test 3 baseline explicitly rather than to a captured snapshot.
    dover.property_name = null;
    delete dover._edgeCases;
    delete dover._propertyConfirm;
    currentProperty().tenants = tenantData.filter(Boolean);
    await runAllocation();
  });
  const restored = await page.evaluate(() => lastResults.map(r => r.name));
  yes('the Test 3 baseline is restored for the remaining checks',
      restored.length === 2 && restored.some(n => /^Dover/.test(n)),
      JSON.stringify(restored));

  // ══ Run the reconciliation the way the button does ═════════════════════════
  console.log('\n── Running the reconciliation (real runAllocation) ──');
  await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('cam'); });
  await page.evaluate(() => runAllocation());
  await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length > 0, null,
                             { timeout: 45000 });

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

  // ── C2/C3/C4: the reconciliation screen must not overstate its own state ──
  //
  // "Total Billed $25,090.78" sat at the top of a run on which every statement
  // is refused; "0 Flagged" sat beside 3 critical exceptions; and the row chip
  // read "Verified" next to a tenant whose lease expired in 2016. Each was
  // separately defensible and together they read as "this is done and fine".
  console.log('\n── The reconciliation screen states its own billing state ──');
  const screen = await page.evaluate(() => {
    const b = document.getElementById('resultsBody') || document.body;
    return {
      kpis:  [...b.querySelectorAll('.rcs-kpi')].map(k => k.textContent.replace(/\s+/g,' ').trim()),
      badge: (()=>{const n=b.querySelector('.rcs-readiness-badge');return n?n.textContent.trim():null;})(),
      chips: [...b.querySelectorAll('.rc-calc-state')].map(x => x.textContent.trim()),
      colHdr: [...b.querySelectorAll('.rcs-th')].map(x => x.textContent.trim()),
    };
  });
  console.log('  KPIs   :', JSON.stringify(screen.kpis));
  console.log('  badge  :', JSON.stringify(screen.badge));
  console.log('  chips  :', JSON.stringify(screen.chips));
  console.log('  columns:', JSON.stringify(screen.colHdr));
  yes('C2 the KPI does NOT claim money was billed on a blocked run',
      !screen.kpis.some(k => /Total Billed/.test(k))
        && screen.kpis.some(k => /Calculated Tenant Allocation/.test(k)),
      JSON.stringify(screen.kpis));
  yes('the canonical readiness state is on the screen that produces the run',
      !!screen.badge && /Not ready to bill/i.test(screen.badge), String(screen.badge));
  yes('C4 the flags KPI names its narrow scope rather than reading as "no problems"',
      screen.kpis.some(k => /Allocation Flags/.test(k)) && !screen.kpis.some(k => /\bFlagged\b/.test(k)),
      JSON.stringify(screen.kpis));
  yes('C3 the row chip says what was verified — the calculation, not the tenant',
      screen.chips.length > 0 && !screen.chips.includes('Verified')
        && screen.chips.every(c => /^(Calc |Inputs )/.test(c)),
      JSON.stringify(screen.chips));
  yes('C3 the column is headed for the calculation, not the billing method',
      screen.colHdr.includes('CAM calculation') && !screen.colHdr.includes('Billing Method'),
      JSON.stringify(screen.colHdr));

  // ── C3 at the OTHER call sites ────────────────────────────────────────────
  //
  // The first C3 fix corrected the results table and left four other renders of
  // the same chip alone, so the Dispute Packet and the Risk & Disputes roster
  // showed "Billing Method: Calc verified" — a heading and a value that do not
  // match — and the CSV exported the old column name into whatever a lender or
  // an auditor opened it in. Rendered here, not inferred from source.
  console.log('\n── The calc-state chip reads the same on every surface ──');
  const surfaces = await page.evaluate(async () => {
    const out = {};
    const body = () => (document.getElementById('rptBody')?.textContent || '').replace(/\s+/g, ' ').trim();

    // Risk & Disputes roster.
    const b0 = document.getElementById('rptBody'); if (b0) b0.innerHTML = '';
    await generateLandlordExport();
    out.riskDisputes = body();

    // Dispute Packet needs a dispute to exist; raise one on a real result.
    const r = lastResults[0];
    disputes.push({
      id: disputes.length, tenantName: r.name, status: 'open', severity: 'medium',
      disputeType: 'allocation_mismatch', vendor: 'Alpha Landscaping', category: 'landscaping',
      tenantShare: 100, amount: 100, reason: 'e2e fixture', createdAt: new Date().toISOString(),
      history: [], messages: [],
    });
    const b1 = document.getElementById('rptBody'); if (b1) b1.innerHTML = '';
    generateDisputePacket(disputes[disputes.length - 1].id);
    out.disputePacket = body();
    disputes.pop();

    // The chip labels the engine actually produced on this run.
    out.chipLabels = [...new Set(lastResults.map(x =>
      _deriveCalcState(x, tenantData.find(t => t && t.id === x.tenantId)).label))];
    return out;
  });
  console.log('  chip labels in play :', JSON.stringify(surfaces.chipLabels));
  console.log('  Risk & Disputes hdr :', (surfaces.riskDisputes.match(/Pro-Rata\s+\S+[^|]{0,40}/) || [''])[0].slice(0, 70));
  console.log('  Dispute Packet row  :', (surfaces.disputePacket.match(/CAM calculation[^A-Z]{0,40}|Billing Method[^A-Z]{0,40}/) || ['(neither)'])[0]);

  yes('the chip actually rendered on both surfaces (not a vacuous check)',
      surfaces.chipLabels.length > 0
        && surfaces.chipLabels.some(l => surfaces.riskDisputes.includes(l))
        && surfaces.chipLabels.some(l => surfaces.disputePacket.includes(l)),
      `labels ${JSON.stringify(surfaces.chipLabels)} not found on both surfaces`);
  yes('C3 the Risk & Disputes roster heads the column "CAM calculation"',
      /CAM calculation/i.test(surfaces.riskDisputes) && !/Billing Method/i.test(surfaces.riskDisputes),
      surfaces.riskDisputes.slice(0, 300));
  yes('C3 the Dispute Packet labels the row "CAM calculation"',
      /CAM calculation/i.test(surfaces.disputePacket) && !/Billing Method/i.test(surfaces.disputePacket),
      surfaces.disputePacket.slice(0, 300));
  yes('C4 the roster names its flags column by scope too',
      /Allocation flags/i.test(surfaces.riskDisputes), surfaces.riskDisputes.slice(0, 300));
  yes('and neither surface reverts to a bare "Verified"',
      !/\bVerified\b/.test(surfaces.riskDisputes) && !/\bVerified\b/.test(surfaces.disputePacket),
      'a bare Verified is back on one of these surfaces');

  // ── I11: the one required next action, on a BLOCKED run ──────────────────
  //
  // recommendations[] lists advisory items with equal weight, so a manager could
  // not tell which one stood between them and a statement. nextAction is derived
  // from billingReadiness — the model that gates statements — so it cannot
  // disagree with them.
  console.log('\n── The next required action ──');
  const na = await page.evaluate(() => {
    const n = buildAuditNarrative();
    return { nextAction: n.nextAction, readiness: n.readiness, recs: (n.recommendations||[]).length };
  });
  console.log('  nextAction:', JSON.stringify(na.nextAction, null, 1).replace(/\n/g, '\n    '));
  yes('it exists and names the blocked state', !!na.nextAction && na.nextAction.state === 'blocked',
      JSON.stringify(na.nextAction));
  yes('it agrees with the canonical readiness — no second source of truth',
      na.nextAction.label === na.readiness.label
        && (na.nextAction.state === 'ready') === (na.readiness.canBill === true),
      JSON.stringify({ na: na.nextAction.label, rd: na.readiness.label }));
  yes('it lists the blocking findings, each with an action read off the finding',
      Array.isArray(na.nextAction.steps) && na.nextAction.steps.length === 3
        && na.nextAction.steps.every(x => /→/.test(x)),
      JSON.stringify(na.nextAction.steps));
  yes('it tells the reader what happens after they resolve them',
      /re-run the reconciliation/i.test(na.nextAction.detail || ''), String(na.nextAction.detail));
  yes('and the advisory list still exists alongside it', na.recs > 0, `recommendations: ${na.recs}`);

  // ── C5: the blocked screen must define the term it actually showed ────────
  console.log('\n── The blocked screen names the treatment it displayed ──');
  const axis = await page.evaluate(async () => {
    const b = document.getElementById('rptBody'); if (b) b.innerHTML = '';
    await generateTenantStatement('Dover');
    const t = (document.getElementById('rptBody')?.textContent || '').replace(/\s+/g, ' ');
    return { text: t,
      treatments: [...new Set((t.match(/Material Concentration|Weakly Evidenced|Requiring Lease Verification/gi) || []))] };
  });
  console.log('  treatments named:', JSON.stringify(axis.treatments));
  yes('the explainer names a treatment that is actually in the table',
      /Material Concentration/i.test(axis.text) && !/Weakly evidenced/i.test(axis.text),
      `the note defines a term the reader never saw: ${JSON.stringify(axis.treatments)}`);
  yes('and still warns the two measures must not be added',
      /must not be added together/i.test(axis.text), 'the two-axis warning is gone');

  // ── The unallocated remainder must not be claimed as settled ─────────────
  //
  // $42,209.22 of a $67,300 pool is unbilled because only 37.28% of the
  // property is covered by loaded leases. The system has NOT established what
  // the other 62.72% is — the coverage finding says so and asks the reader to
  // upload the remaining leases and re-run. The reconciliation banner used to
  // call the same figure "Expected" and close with "no action needed", which
  // contradicts that finding on the same screen and quietly assigns the whole
  // variance to the landlord.
  console.log('\n── The unallocated remainder is unresolved, not absorbed ──');
  const banner = await page.evaluate(() => {
    const el = document.getElementById('resultsBody') || document.body;
    const m = el.textContent.replace(/\s+/g, ' ')
      .match(/Partial property coverage[^]{0,700}?own share\./);
    return m ? m[0].trim() : null;
  });
  console.log('  banner:', banner ? banner.slice(0, 420) : '(not found)');
  yes('the coverage banner rendered (not a vacuous check)', !!banner,
      'the partial-coverage banner is not on screen');
  if (banner) {
    yes('it names the unallocated amount',
        /\$42,209\.22/.test(banner), banner.slice(0, 200));
    yes('it calls the amount unallocated, not absorbed or expected',
        /currently unallocated/i.test(banner) && !/\bExpected\b/.test(banner),
        banner.slice(0, 200));
    yes('it does NOT tell the reader no action is needed',
        !/no action needed/i.test(banner),
        'the banner still closes with "no action needed" on an unresolved 62.7% gap');
    yes('it states that the cause has not been established',
        /has not been established/i.test(banner), banner.slice(0, 300));
    yes('it offers both causes without asserting either',
        /vacant space/i.test(banner) && /not yet uploaded/i.test(banner),
        banner.slice(0, 300));
    yes('it names the resolution, matching the coverage finding',
        /upload any remaining leases and re-run/i.test(banner), banner.slice(0, 300));
    yes('and it still reassures that tenant charges are unaffected',
        /billed only its own share/i.test(banner), banner.slice(0, 300));
  }
  // The calculation itself is untouched.
  yes('the arithmetic behind the banner is unchanged',
      Math.abs((recon.pool - recon.billed) - 42209.22) < 0.01,
      `pool ${recon.pool} - billed ${recon.billed}`);

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
  yes('the Coverage Gap report separates the three scopes',
      /Input completeness/i.test(cg) && /Reconciliation status/i.test(cg)
        && /Property coverage/i.test(cg),
      'the scope split is missing from the rendered report');
  // B1: the report is named after property coverage and used to answer a
  // different question with a green tick, telling a manager coverage was
  // Complete on a run whose CAM screen said 62.7% was unresolved.
  yes('it reports the real property coverage figure',
      /37\.3% documented/.test(cg) && /62\.7% unresolved/.test(cg), cg.slice(0, 400));
  yes('it never claims every lease has been uploaded',
      !/all leases are uploaded/i.test(cg),
      'the report asserts a completeness it cannot establish');
  yes('it says what MainStreet needs from the reader next',
      /What MainStreet needs from you/i.test(cg) && /upload any remaining leases/i.test(cg),
      cg.slice(0, 400));

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

  // ══ A billing-blocked statement must not read as a bill ════════════════════
  //
  // The Pilot showed "Total Billed $5,514.56" on a document whose own header
  // read NON-BILLABLE DRAFT, beside an audit verdict of Not ready to bill. The
  // canonical billing-status component (_statementReadinessBlock -> _draftState)
  // already governed the report title, the Status field, the banner and the hero
  // total; one row in the Year-End Reconciliation table was never wired to it.
  console.log('\n── A blocked statement cannot be mistaken for a final bill ──');
  if (!draft.err) {
    const claimsBilled = /Total Billed/i.test(draft.text);
    console.log('  says "Total Billed"      :', claimsBilled);
    console.log('  marked NON-BILLABLE DRAFT:', /NON-BILLABLE DRAFT/i.test(draft.text));
    yes('the draft never uses the word "billed" as a completed fact',
        !claimsBilled,
        'the draft still carries a "Total Billed" row while billing is blocked');
    yes('the figure is labelled as a calculation, not a charge',
        /Calculated CAM charge — not billed/i.test(draft.text)
          || /Provisional CAM allocation — not billable/i.test(draft.text),
        'no label states that the figure is not a bill');
    yes('the draft is unmistakably marked, in the title and on the page',
        /NON-BILLABLE DRAFT/i.test(draft.text) && /DO NOT SEND TO TENANT/i.test(draft.text),
        'the draft marking is not unmistakable');
    // WORDING MOVED, INTENT UNCHANGED (I-4). The reason used to read "N critical
    // exceptions must be resolved before statements are issued" — a property-wide
    // claim. It is now scoped to the tenant whose draft this is: "1 exception on
    // this tenant must be resolved before this statement is issued." Pinning the
    // old phrase would pin the global gate this change removed, so the assertion
    // holds the requirement instead: the draft must say a reason AND name what is
    // actually holding it.
    yes('the draft states why billing is blocked',
        /must be (resolved|confirmed)/i.test(draft.text)
          && /lease that ended|exception/i.test(draft.text),
        'the draft does not say what is blocking it');
    yes('and the figure itself is still shown — the draft remains reviewable',
        /5,514\.56/.test(draft.text), 'the draft no longer shows the computed figure');
  }

  // ══ PASSED vs NOT CONFIRMED ════════════════════════════════════════════════
  //
  // "The lease is silent on structural exclusions" rendered as a green tick
  // reading PASSED, beside a $55,000 unitemised category. Silence establishes
  // nothing. The four-verdict panel has always been able to say NOT CONFIRMED;
  // the AI tier could not produce that severity, and both fallbacks in the
  // renderer landed on the affirmative pass.
  console.log('\n── PASSED means evidence supports it; silence does not ──');
  const verdicts = await page.evaluate(() => {
    const mk = (sev, conf, finding) => ({
      check: 'STRUCT_EXCLUSIONS', severity: sev, confidence: conf, finding,
      source: 'ai', section: null, quote: null,
    });
    const render = (f) => {
      const host = document.createElement('div');
      host.innerHTML = _renderValidationPanel([f], {});
      const badge = host.querySelector('.lv-sev-badge');
      const chip  = host.querySelector('.lv-conf');
      const mean  = host.querySelector('.lv-meaning');
      return {
        badge: badge ? badge.textContent.trim() : null,
        icon:  (host.querySelector('.lv-finding-icon') || {}).textContent || null,
        chip:  chip ? chip.textContent.trim() : null,
        chipTitle: chip ? chip.getAttribute('title') : null,
        meaning: mean ? mean.textContent.trim() : null,
      };
    };
    return {
      supported:   render(mk('info', 'high', 'The lease expressly excludes capital expenditures from CAM.')),
      silent:      render(mk('unconfirmed', 'high', 'The lease does not address structural exclusions.')),
      conflicting: render(mk('critical', 'high', 'The reconciliation includes a charge the lease excludes.')),
      unknownSev:  render(mk('not-a-real-severity', 'high', 'Something the model invented.')),
    };
  });
  console.log('  evidence supports it :', JSON.stringify(verdicts.supported.badge), verdicts.supported.icon);
  console.log('  lease is silent      :', JSON.stringify(verdicts.silent.badge), verdicts.silent.icon);
  console.log('  evidence conflicts   :', JSON.stringify(verdicts.conflicting.badge), verdicts.conflicting.icon);
  console.log('  unknown severity     :', JSON.stringify(verdicts.unknownSev.badge), verdicts.unknownSev.icon);
  console.log('  silent card meaning  :', JSON.stringify(verdicts.silent.meaning));

  yes('the three verdicts render as three different things',
      new Set([verdicts.supported.badge, verdicts.silent.badge, verdicts.conflicting.badge]).size === 3,
      JSON.stringify([verdicts.supported.badge, verdicts.silent.badge, verdicts.conflicting.badge]));
  yes('PASSED is reserved for evidence that affirmatively supports the condition',
      verdicts.supported.badge === 'PASSED', `got ${JSON.stringify(verdicts.supported.badge)}`);
  yes('lease silence reads NOT CONFIRMED, never PASSED',
      verdicts.silent.badge === 'NOT CONFIRMED' && verdicts.silent.badge !== 'PASSED',
      `got ${JSON.stringify(verdicts.silent.badge)}`);
  yes('a conflict still reads EXCEPTION',
      verdicts.conflicting.badge === 'EXCEPTION', `got ${JSON.stringify(verdicts.conflicting.badge)}`);
  yes('an unrecognised verdict fails SAFE, not to a green pass',
      verdicts.unknownSev.badge === 'NOT CONFIRMED' && verdicts.unknownSev.badge !== 'PASSED',
      `got ${JSON.stringify(verdicts.unknownSev.badge)} — an unknown verdict must not read as compliance`);
  yes('the NOT CONFIRMED card says what it means for billing',
      /not a failure/i.test(verdicts.silent.meaning || '')
        && /not a pass/i.test(verdicts.silent.meaning || ''),
      JSON.stringify(verdicts.silent.meaning));

  // ── AI confidence on a NOT CONFIRMED card ────────────────────────────────
  //
  // "NOT CONFIRMED" beside a bare "AI confidence: high" reads as "the AI is
  // highly confident the condition does not hold". What is high is confidence in
  // the READING — that the lease is clearly silent here — which is exactly why
  // the check could not be confirmed.
  console.log('\n── Confidence on a NOT CONFIRMED card names its object ──');
  console.log('  unconfirmed chip :', JSON.stringify(verdicts.silent.chip));
  console.log('  supported   chip :', JSON.stringify(verdicts.supported.chip));
  yes('the chip on a NOT CONFIRMED card describes the evidence, not the verdict',
      /evidence read with high confidence/i.test(verdicts.silent.chip || ''),
      `chip reads ${JSON.stringify(verdicts.silent.chip)}`);
  yes('its tooltip says high means the lease is clearly silent, not confirmed',
      /clearly silent or ambiguous/i.test(verdicts.silent.chipTitle || ''),
      `title: ${JSON.stringify(verdicts.silent.chipTitle)}`);
  yes('other cards keep the existing AI confidence wording, unchanged',
      /^AI confidence: high$/i.test(verdicts.supported.chip || ''),
      `chip reads ${JSON.stringify(verdicts.supported.chip)}`);

  console.log('\n── Page errors ──');
  yes('no uncaught page errors during the whole replay', errors.length === 0,
      errors.slice(0, 5).join(' | '));

  await browser.close();
  server.close();
  // The count guard. Test 3's defects were all things that rendered wrongly
  // rather than computed wrongly, so an assertion silently disappearing from
  // this file is the exact way its coverage would erode. Change this number
  // deliberately, in the same commit as the assertions.
  const TOTAL_EXPECTED = 119;
  yes(`suite runs all ${TOTAL_EXPECTED} checks`, pass + fail + 1 === TOTAL_EXPECTED,
      `assertion count changed — update TOTAL_EXPECTED deliberately (saw ${pass + fail + 1})`);

  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
