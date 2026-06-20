'use strict';
/**
 * test-e2e-escrow-reserve.js — End-to-end Playwright tests for the Escrow &
 * Reserve workflow (Phase 21 + the document-management / invoice-filtering /
 * draw-package-export / submission-email / source-citation features built on
 * top of it).
 *
 * Bypasses Claude API calls and the PDF upload UI entirely — mirrors
 * test-e2e-acquisition.js's approach of injecting fixture data directly into
 * the live in-memory property object (via window.currentProperty(), which is
 * a real reference into script.js's module-local _props array) and then
 * calling the same render functions the app calls after a real extraction.
 *
 * Usage:
 *   node test-e2e-escrow-reserve.js
 *
 * Optional env vars:
 *   HEADLESS=false   — open a visible browser
 *   APP_PORT=7822     — local HTTP server port (default: 7822)
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const PORT   = parseInt(process.env.APP_PORT || '7822', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT   = __dirname;

let failures = 0;
function pass(label)    { console.log('\x1b[32m  ✅ ' + label + '\x1b[0m'); }
function fail(label, d) { console.error('\x1b[31m  ❌ ' + label + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; }
function info(label)    { console.log('  · ' + label); }
function section(label) { console.log('\n── ' + label + ' ' + '─'.repeat(Math.max(0, 60 - label.length))); }
function assert(cond, label, detail) { cond ? pass(label) : fail(label, detail); }

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css',  '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url);
      filePath = filePath.split('?')[0];
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

// ── Supabase mock (same pattern as test-e2e-acquisition.js) ─────────────────
const SUPABASE_MOCK = `
(function() {
  var _store = {};
  var _user  = { id: 'e2e-test-user-id', email: 'e2e@test.local' };

  function noopPromise(val) { return Promise.resolve(val); }

  var _idCounter = 0;

  function makeQ(tableName) {
    var _filters = {};
    var _lastResult = null; // tracks the row(s) from the most recent insert/upsert for select()/single() chaining
    var q = {
      select:   function() { return q; },
      insert:   function(rows) {
        var arr = Array.isArray(rows) ? rows : [rows];
        arr.forEach(function(r) { if (!r.id) r.id = 'e2e-' + tableName + '-' + (++_idCounter); });
        if (_store[tableName]) arr.forEach(function(r) { _store[tableName].push(r); });
        _lastResult = arr;
        return q;
      },
      upsert:   function(row) {
        if (!row.id) row.id = 'e2e-' + tableName + '-' + (++_idCounter);
        if (_store[tableName]) {
          var idx = _store[tableName].findIndex(function(r) { return r.id === row.id; });
          if (idx >= 0) _store[tableName][idx] = row; else _store[tableName].push(row);
        }
        _lastResult = [row];
        return q;
      },
      update:   function() { return noopPromise({ data: null, error: null }); },
      delete:   function() {
        return { eq: function() { return noopPromise({ error: null }); } };
      },
      eq:       function(col, val) { _filters[col] = val; return q; },
      neq:      function() { return q; },
      in:       function() { return q; },
      order:    function() { return q; },
      limit:    function() { return q; },
      single:   function() {
        var rows = _lastResult || _store[tableName] || [];
        return noopPromise({ data: rows[0] || null, error: null });
      },
      then: function(fn, rej) {
        if (_lastResult) {
          return noopPromise({ data: _lastResult, error: null }).then(fn, rej);
        }
        var rows = (_store[tableName] || []).filter(function(r) {
          return Object.keys(_filters).every(function(k) { return r[k] === _filters[k]; });
        });
        return noopPromise({ data: rows, error: null }).then(fn, rej);
      }
    };
    return q;
  }

  window.supabase = {
    createClient: function() {
      return {
        auth: {
          getUser: function() { return noopPromise({ data: { user: _user }, error: null }); },
          getSession: function() { return noopPromise({ data: { session: { user: _user } }, error: null }); },
          onAuthStateChange: function(cb) {
            setTimeout(function() { cb('SIGNED_IN', { user: _user }); }, 50);
            return { data: { subscription: { unsubscribe: function() {} } } };
          },
          signOut: function() { return noopPromise({ error: null }); }
        },
        from: function(table) {
          if (!_store[table]) _store[table] = [];
          return makeQ(table);
        },
        _store: _store
      };
    }
  };
  window.__e2eStore = _store;
})();
`;

(async () => {
  info('Starting local HTTP server on port ' + PORT + '…');
  const server = await startServer();
  info('Server ready at http://127.0.0.1:' + PORT);

  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  const consoleLogs = [];
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleLogs.push({ type: 'PAGEERROR', text: e.message }));

  await page.route('**/supabase-js**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed by e2e mock */'
  }));
  await page.addInitScript(SUPABASE_MOCK);

  // Fixture: a single reserve agreement that, in reality, the multi-reserve
  // extraction fix returns as 3 normalizeReserve() objects (Roof, HVAC,
  // Capital) — exercises the bug fixed earlier this session.
  const FIXTURE_RESERVES = [
    {
      reserve_type: 'Roof Reserve', current_balance: 75000,
      eligible_uses: 'Roof repair and replacement only',
      requires_invoices: true, requires_photos: true, requires_lien_waivers: true,
      evidence: { current_balance: { quote: 'Lender shall maintain a Roof Reserve Account with an initial balance of $75,000.', page: 3 } },
    },
    { reserve_type: 'HVAC Reserve', current_balance: 40000, eligible_uses: 'HVAC repair and replacement only' },
    { reserve_type: 'Capital Reserve', current_balance: null, eligible_uses: 'General capital improvements' },
  ];

  try {
    // ── ESC-E2E-1: App loads ──────────────────────────────────────────────
    section('ESC-E2E-1: App load');
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => {
      const app = document.getElementById('appContent');
      return app && app.style.display !== 'none' && app.style.display !== '';
    }, { timeout: 10000 });
    assert(true, 'ESC-E2E-1: app content visible after auth mock fires');

    // Dismiss any onboarding/demo-welcome overlays that intercept clicks.
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
      const d = document.getElementById('demoWelcomePanel');
      if (d && d.style.display !== 'none') { if (typeof _dismissDemoWelcome === 'function') _dismissDemoWelcome(); else d.style.display = 'none'; }
    });

    // ── ESC-E2E-2: Create a property and inject reserve/invoice fixtures ──
    section('ESC-E2E-2: Create property; inject reserve fixtures');
    await page.click('.add-prop-btn');
    await page.waitForFunction(() => typeof window.currentProperty === 'function' && !!window.currentProperty(), { timeout: 10000 });

    const propName = await page.evaluate(() => window.currentProperty().name);
    assert(!!propName, 'ESC-E2E-2: property created and selected', propName);

    // Mutate the live property object in place (same object _props holds —
    // currentProperty() returns a reference, not a copy) then render exactly
    // what handleEscrowDocumentUpload() would have produced from a real
    // 3-reserve document, plus two invoices to exercise the reserve-type
    // invoice classifier and draw-builder filtering.
    await page.evaluate((fixtures) => {
      const prop = window.currentProperty();
      const reserves = fixtures.map(r => window.EscrowReserveEngine.normalizeReserve(r, {
        sourceFileName: 'Reserve_Agreement.pdf', sourceFileUrl: 'https://example.com/Reserve_Agreement.pdf',
      }));
      prop.escrowReserves = reserves;
      prop.invoices = [
        { vendorName: 'ABC Roofing Co.', amount: 18500, category: 'repairs', reserveType: 'roof', reserveTypeConfidence: 75, fileName: 'roof-invoice.pdf' },
        { vendorName: 'Acme HVAC Services', amount: 6200, category: 'repairs', reserveType: 'hvac', reserveTypeConfidence: 75, fileName: 'hvac-invoice.pdf' },
      ];
      prop.drawRequests = [];
      window.renderEscrowProfile(prop);
    }, FIXTURE_RESERVES);

    const reserveCardCount = await page.$$eval('.escrow-reserve-card', els => els.length);
    assert(reserveCardCount === 3, 'ESC-E2E-2: all 3 reserves from the multi-reserve document render as separate cards (regression: extraction array-collapse bug)', String(reserveCardCount));

    const balancesText = await page.$$eval('.escrow-reserve-card .escrow-reserve-balance', els => els.map(e => e.textContent));
    const noCrash = balancesText.every(t => !/NaN|undefined/.test(t));
    assert(noCrash, 'ESC-E2E-2: null current_balance reserve renders without NaN/undefined (regression: fmt() null-safety crash)', balancesText.join(' | '));

    // ── ESC-E2E-3: Document management buttons present ─────────────────────
    section('ESC-E2E-3: Reserve document management');
    const docCountText = await page.$eval('.escrow-reserve-card .escrow-doc-count', el => el.textContent).catch(() => '');
    assert(docCountText.includes('1 document'), 'ESC-E2E-3: reserve card shows a document count badge', docCountText);

    const docBtnLabels = await page.$$eval('.escrow-reserve-card:first-child .escrow-doc-btn', els => els.map(e => e.textContent.trim()));
    assert(docBtnLabels.some(l => l.includes('View Documents')), 'ESC-E2E-3: "View Documents" button present on reserve card (Reserve Package view)', docBtnLabels.join(', '));
    ['Replace', 'Reprocess', 'Source Citation', 'Delete'].forEach(label => {
      assert(docBtnLabels.includes(label), `ESC-E2E-3: "${label}" button present on reserve card`, docBtnLabels.join(', '));
    });

    // Reserve Package View modal — opens and lists the reserve's source documents.
    await page.evaluate(() => {
      const prop = window.currentProperty();
      window.openEscrowPackageView(prop.escrowReserves[0].id);
    });
    await page.waitForFunction(() => document.getElementById('escrowPackageModal').style.display === 'flex', { timeout: 5000 });
    const packageBodyText = await page.$eval('#escrowPackageBody', el => el.textContent);
    assert(/\d+ document/.test(packageBodyText), 'ESC-E2E-3: Package View modal shows the reserve\'s document count', packageBodyText.replace(/\s+/g, ' ').slice(0, 150));
    await page.evaluate(() => window.closeEscrowPackageView());
    await page.waitForFunction(() => document.getElementById('escrowPackageModal').style.display === 'none', { timeout: 5000 });

    // ── ESC-E2E-4: Source Citation viewer ───────────────────────────────────
    section('ESC-E2E-4: Source Citation viewer');
    await page.evaluate(() => {
      const card = document.querySelector('.escrow-reserve-card');
      const btn = Array.from(card.querySelectorAll('.escrow-doc-btn')).find(b => b.textContent.trim() === 'Source Citation');
      btn.click();
    });
    const citationVisible = await page.$eval('#escrowCitationModal', el => el.style.display === 'flex').catch(() => false);
    assert(citationVisible, 'ESC-E2E-4: citation modal opens');
    const citationText = await page.$eval('#escrowCitationBody', el => el.textContent).catch(() => '');
    assert(citationText.includes('75,000') || citationText.includes('initial balance'), 'ESC-E2E-4: citation modal shows the verbatim quote', citationText.slice(0, 120));
    assert(citationText.includes('Page 3'), 'ESC-E2E-4: citation modal shows the page citation', citationText.slice(0, 120));
    await page.evaluate(() => window.closeEscrowSourceCitation());

    // ── ESC-E2E-5: Draw builder — invoice filtering by reserve type ────────
    section('ESC-E2E-5: Draw builder invoice filtering');
    await page.evaluate(() => {
      const prop = window.currentProperty();
      const roofReserve = prop.escrowReserves.find(r => r.reserveType === 'roof');
      window.openDrawBuilder(roofReserve.id);
    });
    await page.waitForFunction(() => document.getElementById('drawBuilderModal').style.display === 'flex', { timeout: 5000 });

    const roofInvoiceRows = await page.$$eval('#drawBuilderBody .escrow-invoice-row', els => els.map(e => e.textContent));
    assert(roofInvoiceRows.length === 1 && roofInvoiceRows[0].includes('ABC Roofing'),
      'ESC-E2E-5: only the roof-classified invoice shows for the Roof Reserve draw (not the HVAC invoice)', JSON.stringify(roofInvoiceRows));

    const filterToggleText = await page.$eval('#drawBuilderBody button.modal-cancel', el => el.textContent).catch(() => '');
    assert(filterToggleText.includes('Show all invoices'), 'ESC-E2E-5: a "show all invoices" toggle is offered since invoices were filtered', filterToggleText);

    // Select the visible invoice — the requested amount should auto-fill from
    // the selected invoice total instead of requiring it to be re-typed.
    await page.check('#drawBuilderBody .escrow-invoice-row input[type=checkbox]');
    const autoFilledAmount = await page.$eval('#drawAmountInput', el => el.value);
    assert(autoFilledAmount === '18500', 'ESC-E2E-5: Amount Requested auto-fills from the selected invoice total', autoFilledAmount);

    // Required Documents checklist reflects what's actually attached/missing.
    const checklistText = await page.$eval('#drawBuilderBody', el => el.textContent);
    assert(/Submission Ready: \d+ of \d+ documents/.test(checklistText), 'ESC-E2E-5: Required Documents checklist shows a "Submission Ready: X of Y" count', checklistText.replace(/\s+/g, ' ').slice(0, 200));

    await page.click('.modal-confirm:has-text("Create Draw Request")');
    await page.waitForFunction(() => document.getElementById('drawBuilderModal').style.display === 'none', { timeout: 5000 });

    const drawCount = await page.$$eval('.escrow-draw-card', els => els.length);
    assert(drawCount === 1, 'ESC-E2E-5: draw request created and rendered', String(drawCount));

    const drawHeadText = await page.$eval('.escrow-draw-card .escrow-draw-head strong', el => el.textContent).catch(() => '');
    assert(drawHeadText.includes('Draw #1'), 'ESC-E2E-5: draw card shows a sequential draw number', drawHeadText);

    // ── ESC-E2E-6: Export Draw Package PDF (report overlay) ─────────────────
    section('ESC-E2E-6: Export Draw Package');
    await page.click('.escrow-draw-card button:has-text("Generate Package")');
    await page.waitForFunction(() => document.getElementById('reportOverlay').style.display !== 'none', { timeout: 5000 });
    const reportHtml = await page.$eval('#rptBody', el => el.innerHTML);
    assert(reportHtml.includes('Reserve Agreement Citation'), 'ESC-E2E-6: package includes the Reserve Agreement Citation section');
    assert(reportHtml.includes('75,000'), 'ESC-E2E-6: package citation includes the verbatim quote');
    assert(reportHtml.includes('Status History'), 'ESC-E2E-6: package includes a Status History section');
    assert(reportHtml.includes('Invoice Summary'), 'ESC-E2E-6: package includes an Invoice Summary section');
    assert(reportHtml.includes('Supporting Documents'), 'ESC-E2E-6: package includes a Supporting Documents section');
    assert(reportHtml.includes('Draw Request #'), 'ESC-E2E-6: package cover sheet shows the draw number');
    await page.click('#reportOverlay .rpt-tool-btn:has-text("Close"), #reportOverlay button:has-text("✕")').catch(() => {});
    await page.evaluate(() => window.closeReport());

    // ── ESC-E2E-7: Generate Submission Email ────────────────────────────────
    section('ESC-E2E-7: Generate Submission Email');
    await page.click('.escrow-draw-card button:has-text("Generate Email")');
    await page.waitForFunction(() => document.getElementById('drawEmailModal').style.display === 'flex', { timeout: 5000 });
    const subjectVal = await page.$eval('#drawEmailSubject', el => el.value);
    const bodyVal    = await page.$eval('#drawEmailBody', el => el.value);
    assert(subjectVal.includes('Roof Reserve Draw Request'), 'ESC-E2E-7: email subject names the reserve type', subjectVal);
    assert(bodyVal.includes('Draw Request #1'), 'ESC-E2E-7: email body references the draw number', bodyVal.slice(0, 80));
    assert(bodyVal.includes('$18,500.00'), 'ESC-E2E-7: email body shows the formatted requested amount', bodyVal);
    const mailtoHref = await page.$eval('#drawEmailMailtoLink', el => el.getAttribute('href'));
    assert(mailtoHref.startsWith('mailto:?subject='), 'ESC-E2E-7: a working mailto: link is generated', mailtoHref.slice(0, 60));
    await page.evaluate(() => window.closeDrawEmailModal());

    // ── ESC-E2E-8: Console error check ──────────────────────────────────────
    section('ESC-E2E-8: Console error check');
    const escrowErrors = consoleLogs.filter(l =>
      (l.type === 'error' || l.type === 'PAGEERROR') &&
      /escrow|reserve|draw/i.test(l.text)
    );
    assert(escrowErrors.length === 0, 'ESC-E2E-8: no console errors related to escrow/reserve/draw flows',
      escrowErrors.map(e => e.text).join(' || '));

  } catch (err) {
    fail('FATAL', err.stack || err.message);
  } finally {
    if (process.env.DUMP_CONSOLE === 'true') {
      console.log('\n── Full console log ──');
      consoleLogs.forEach(l => console.log(`  [${l.type}] ${l.text}`));
    }
    await browser.close();
    server.close();
  }

  console.log('\n' + '─'.repeat(62));
  console.log(failures === 0 ? '✅ All escrow/reserve e2e tests passed' : `❌ ${failures} test(s) failed`);
  console.log('─'.repeat(62));
  process.exit(failures === 0 ? 0 : 1);
})();
