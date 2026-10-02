// test-e2e-acquisition-controls.js
// ============================================================================
// The acquisition workflow's controls, walked in the page with Maple Plaza as
// the Pilot holds it (fixtures/maple-plaza-acquisition.js).
//
//   1  one button vocabulary: every acquisition button is at least 36px tall
//      (44px on a phone), the same font size and corner, at desktop, tablet
//      and phone widths — and none of them pushes the page sideways or, on a
//      phone, makes the browser lay the page out wider than the screen
//   2  the labels: Summary / Acquisition Matrix (13 columns beneath),
//      ⬇ Matrix CSV, ⬇ Sources CSV, 📘 Acquisition Report, ⬇ Rent Roll CSV
//   3  both CSVs are offered in the Summary and in the Acquisition Matrix,
//      and each is the same file from either view
//   4  the controls still do what they did: the views switch, the report
//      opens, the lease record opens and closes, the Summary is the default
//   5  a converted (closed) acquisition: the downloads and the report stay,
//      the uploads and Delete stay hidden
//
// The stand-in database is test-e2e-acquisition-lease-matrix.js's, read from
// that file so the two cannot drift. Nothing leaves the page.
//
// Run: node test-e2e-acquisition-controls.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const F = require('./fixtures/maple-plaza-acquisition.js');
const ROOT = __dirname, PORT = 8957;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = F.UID, MAPLE = F.REVIEW;
const SHOP = F.FAM.shoprite;
const SRC = fs.readFileSync(path.join(ROOT, 'test-e2e-acquisition-lease-matrix.js'), 'utf8');
const DB = SRC.slice(SRC.indexOf('const DB = `') + 'const DB = `'.length, SRC.indexOf('})();`;') + '})();'.length)
  .replace('${UID}', UID);

// Every button of the acquisition workflow, as the page draws it.
const BUTTONS = [
  '#acqDetailPanel .acq-detail-header .acq-back-btn',
  '#acqReportV2Btn',
  '#acqTermsList .acq-lm-view',
  '#acqTermsList .acq-m13-csv',
  '#acqTermsList .acq-m13-prov',
  '#acqTermsList .acq-lh-back',
  '#acqDetailPanel .acq-upload-btn',
  '#acqAnalyzeBtn',
  '#acqConvertAction .acq-convert-btn',
  '#acqReportContainer .acq-export-btn',
];

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];

  async function open(viewport, mobile, opts) {
    const o = opts || {};
    const ctx = await browser.newContext({ viewport, isMobile: !!mobile, hasTouch: !!mobile, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    for (const g of ['**cdnjs**', '**jsdelivr**']) await page.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.addInitScript(DB);
    await page.addInitScript(() => { try { localStorage.removeItem('acqMatrixView'); } catch (_) {} });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
      // The developer role switcher exists on localhost only, and floats over
      // the page; it is not part of the product.
      const dev = document.getElementById('_devRoleSwitcher'); if (dev) dev.remove();
    });
    await page.evaluate(async ({ maple, fx, status }) => {
      fx = JSON.parse(JSON.stringify(fx));
      __store.acquisition_reviews.push({ id: maple, user_id: 'u1', name: 'Maple Plaza', status: status,
        created_at: '2026-09-17T19:14:41Z', updated_at: 'rev-0',
        converted_at: status === 'converted' ? '2026-09-30T12:00:00Z' : null,
        data: { tenants: fx.tenants, invoices: [], totalSqFt: 0, documents: [], analysis: null } });
      fx.families.forEach(f => __store.acquisition_document_families.push(f));
      fx.documents.forEach(d => __store.acquisition_documents.push(Object.assign(d,
        { extracted_text: 'LEASE. ' + 'The full stored text of this document. '.repeat(4) })));
      fx.decisions.forEach(d => __store.acquisition_term_decisions.push(d));
      await _loadAcqReviewsAndRender();
      selectAcquisitionReview(maple);
    }, { maple: MAPLE, fx: F, status: o.status || 'complete' });
    await page.waitForSelector(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`, { timeout: 15000 });
    return { ctx, page };
  }

  // Every visible acquisition button's box and type.
  const measure = (page) => page.evaluate((sels) => {
    const out = [];
    sels.forEach(sel => document.querySelectorAll(sel).forEach(b => {
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(b).display === 'none' || getComputedStyle(b).visibility === 'hidden') return;
      const cs = getComputedStyle(b);
      out.push({ sel, text: b.textContent.replace(/\s+/g, ' ').trim(), h: Math.round(r.height * 10) / 10,
        left: r.left, right: r.right, font: parseFloat(cs.fontSize), radius: cs.borderTopLeftRadius,
        analyze: b.id === 'acqAnalyzeBtn', view: b.classList.contains('acq-lm-view') });
    }));
    return { buttons: out, vw: window.innerWidth, scrollW: document.documentElement.scrollWidth, sw: screen.width };
  }, BUTTONS);

  function judgeSizes(label, m, minH) {
    const small = m.buttons.filter(b => b.h < minH);
    check(`${label}: every acquisition button is at least ${minH}px tall (${m.buttons.length} measured)`,
          m.buttons.length >= 8 && !small.length, small.map(b => `${b.text} ${b.h}px`).join('; ') || '');
    const fonts = new Set(m.buttons.filter(b => !b.analyze).map(b => b.font));
    check(`${label}: one font size across them`, fonts.size === 1 && [...fonts][0] >= 13.5, [...fonts].join(', '));
    const corners = new Set(m.buttons.filter(b => !b.view).map(b => b.radius));
    check(`${label}: one corner radius across them`, corners.size === 1, [...corners].join(', '));
    const off = m.buttons.filter(b => b.left < -0.5 || b.right > m.vw + 0.5);
    check(`${label}: no button runs off the screen, and the page does not scroll sideways`,
          !off.length && m.scrollW <= m.vw, off.map(b => b.text).join('; ') + ` scrollW=${m.scrollW} vw=${m.vw}`);
    // On a phone, a page wider than the screen is laid out wide and shrunk to
    // fit — everything smaller than it should be. The layout must be the
    // device's own width.
    check(`${label}: the page is laid out at the device's width, not shrunk to fit`, m.vw === m.sw, `layout ${m.vw}px, device ${m.sw}px`);
  }

  console.log('\nAcquisition controls — one button vocabulary, the CSVs in both views\n' + '='.repeat(64));

  // ── 2 · the labels, and the Summary as the default ───────────────────────
  const { ctx, page } = await open({ width: 1366, height: 900 }, false);
  const labels = await page.evaluate(() => ({
    summaryTable: !!document.querySelector('#acqTermsList .acq-lm-table'),
    views: [].map.call(document.querySelectorAll('#acqTermsList .acq-lm-view'), b => b.textContent.replace(/\s+/g, ' ').trim() + (b.classList.contains('active') ? '*' : '')),
    sub: (document.querySelector('#acqTermsList .acq-lm-view[data-view="acquisition"] .acq-lm-view-sub') || {}).textContent || null,
    csv: (document.querySelector('#acqTermsList .acq-m13-csv') || {}).textContent || null,
    prov: (document.querySelector('#acqTermsList .acq-m13-prov') || {}).textContent || null,
    csvTitle: (document.querySelector('#acqTermsList .acq-m13-csv') || { title: '' }).title,
    provTitle: (document.querySelector('#acqTermsList .acq-m13-prov') || { title: '' }).title,
    report: document.getElementById('acqReportV2Btn').textContent.trim(),
    reportTitle: document.getElementById('acqReportV2Btn').title,
  }));
  check('the review opens on the Summary — the six-column table, the Summary tab selected',
        labels.summaryTable && labels.views[0] === 'Summary*', labels.views.join(' | '));
  check('the second view is named "Acquisition Matrix", with "13 columns" beneath it',
        labels.views[1] === 'Acquisition Matrix 13 columns' && labels.sub === '13 columns', labels.views[1]);
  check('the Summary offers both downloads: "⬇ Matrix CSV" and "⬇ Sources CSV"',
        labels.csv === '⬇ Matrix CSV' && labels.prov === '⬇ Sources CSV', `${labels.csv} | ${labels.prov}`);
  check('each download says what it holds, on hover', /13 columns/.test(labels.csvTitle) && /document, clause and page/.test(labels.provTitle));
  check('the report is "📘 Acquisition Report" — no "v2" — and still says what it is on hover',
        labels.report === '📘 Acquisition Report' && /buyer's report/.test(labels.reportTitle), labels.report);

  // ── 3 · the same files from either view ──────────────────────────────────
  const grab = async (sel) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
    return { name: dl.suggestedFilename(), body: fs.readFileSync(await dl.path(), 'utf8') };
  };
  const sCsv = await grab('#acqTermsList .acq-m13-csv');
  const sProv = await grab('#acqTermsList .acq-m13-prov');
  check('from the Summary: the matrix CSV, named for the review, with the thirteen headers',
        sCsv.name === 'Maple_Plaza-lease-matrix.csv' && /^﻿Tenant,Lease Exp\.,Sq\. Ft\.,Base Rent/.test(sCsv.body), sCsv.name);
  check('from the Summary: the sources CSV, named for the review',
        sProv.name === 'Maple_Plaza-lease-matrix-provenance.csv' && /Governing document/.test(sProv.body), sProv.name);
  check('the download leaves the Summary open', await page.evaluate(() => !!document.querySelector('#acqTermsList .acq-lm-table')));
  await page.click('#acqTermsList .acq-lm-view[data-view="acquisition"]');
  await page.waitForSelector('#acqTermsList .acq-m13-table');
  const mCsv = await grab('#acqTermsList .acq-m13-csv');
  const mProv = await grab('#acqTermsList .acq-m13-prov');
  check('the Acquisition Matrix offers the same two downloads, labelled the same',
        await page.evaluate(() => (document.querySelector('#acqTermsList .acq-m13-csv') || {}).textContent === '⬇ Matrix CSV'
          && (document.querySelector('#acqTermsList .acq-m13-prov') || {}).textContent === '⬇ Sources CSV'));
  check('the matrix CSV is the same file from either view', mCsv.name === sCsv.name && mCsv.body === sCsv.body);
  check('the sources CSV is the same file from either view', mProv.name === sProv.name && mProv.body === sProv.body);
  check('one toolbar holds the views and the downloads, in either view',
        await page.evaluate(() => { const t = document.querySelector('#acqTermsList .acq-lm-toolbar');
          return !!(t && t.querySelector('.acq-lm-views') && t.querySelector('.acq-m13-csv') && t.querySelector('.acq-m13-prov'))
            && document.querySelectorAll('#acqTermsList .acq-m13-csv').length === 1; }));

  // ── 4 · the controls still work ──────────────────────────────────────────
  await page.click(`#acqTermsList .acq-m13-open[data-leasehold="${SHOP}"]`);
  await page.waitForSelector('#acqTermsList .acq-lh');
  const lhH = await page.evaluate(() => document.querySelector('#acqTermsList .acq-lh-back').getBoundingClientRect().height);
  check('the lease record\'s Back takes the shared shape', lhH >= 36, lhH + 'px');
  await page.click('#acqTermsList .acq-lh-back');
  check('and still returns to the Acquisition Matrix', await page.evaluate(() => !!document.querySelector('#acqTermsList .acq-m13-table')));
  await page.click('#acqTermsList .acq-lm-view[data-view="summary"]');
  check('the Summary tab returns to the six-column table',
        await page.evaluate(() => !!document.querySelector('#acqTermsList .acq-lm-table') && !document.querySelector('#acqTermsList .acq-m13-table')));
  await page.click('#acqReportV2Btn');
  await page.waitForSelector('#reportOverlay', { state: 'visible', timeout: 15000 });
  check('the Acquisition Report still opens', await page.evaluate(() => /Maple Plaza/.test(document.getElementById('reportOverlay').textContent)));
  await page.evaluate(() => closeReport());

  // A lease-only analysis draws the Rent Roll download.
  await page.evaluate(async () => {
    const i = document.getElementById('acqTotalSqft'); i.value = '120000'; acqSaveSqft('120000');
    await runAcquisitionAnalysis();
  });
  await page.waitForSelector('#acqReportContainer .acq-export-btn', { timeout: 15000 }).catch(() => {});
  const rr = await page.evaluate(() => [].map.call(document.querySelectorAll('#acqReportContainer .acq-export-btn'), b => b.textContent.trim()));
  check('the analysis offers "⬇ Rent Roll CSV" — never "Export CSV" or the chart icon',
        rr.length >= 1 && rr.every(t => t === '⬇ Rent Roll CSV' || /Print|Decision Report/.test(t)), rr.join(' | '));
  const [rdl] = await Promise.all([page.waitForEvent('download'), page.click('#acqReportContainer .acq-export-btn')]);
  const rrBody = fs.readFileSync(await rdl.path(), 'utf8');
  check('and it still downloads the rent roll, named for the review as before',
        rdl.suggestedFilename() === 'Maple_Plaza.csv' && /ShopRite/.test(rrBody), rdl.suggestedFilename());

  // ── 1 · the vocabulary, at three widths ──────────────────────────────────
  judgeSizes('desktop 1366', await measure(page), 36);
  await page.click(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`);
  await page.waitForSelector('#acqTermsList .acq-lh');
  judgeSizes('desktop 1366, lease record open', await measure(page), 36);
  await ctx.close();

  for (const [label, vp, mobile, minH] of [['tablet 768', { width: 768, height: 1024 }, true, 36],
                                          ['phone 375', { width: 375, height: 812 }, true, 44]]) {
    const { ctx: c, page: p } = await open(vp, mobile);
    judgeSizes(label + ', Summary', await measure(p), minH);
    await p.click('#acqTermsList .acq-lm-view[data-view="acquisition"]');
    await p.waitForSelector('#acqTermsList .acq-m13-table');
    judgeSizes(label + ', Acquisition Matrix', await measure(p), minH);
    await c.close();
  }

  // ── 5 · a converted acquisition ──────────────────────────────────────────
  {
    const { ctx: c, page: p } = await open({ width: 1366, height: 900 }, false, { status: 'converted' });
    const fz = await p.evaluate(() => {
      const vis = el => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
      return {
        frozen: document.getElementById('acqDetailPanel').classList.contains('acq-frozen'),
        csv: vis(document.querySelector('#acqTermsList .acq-m13-csv')), prov: vis(document.querySelector('#acqTermsList .acq-m13-prov')),
        report: vis(document.getElementById('acqReportV2Btn')),
        uploads: [].filter.call(document.querySelectorAll('#acqDetailPanel .acq-upload-btn'), vis).length,
        del: vis(document.getElementById('acqDeleteBtn')),
      };
    });
    check('a converted acquisition keeps both downloads and the report — reading is not changing',
          fz.frozen && fz.csv && fz.prov && fz.report, JSON.stringify(fz));
    check('and still hides the uploads and Delete', fz.uploads === 0 && !fz.del, JSON.stringify(fz));
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('#acqTermsList .acq-m13-csv')]);
    check('its matrix CSV downloads', d.suggestedFilename() === 'Maple_Plaza-lease-matrix.csv');
    await c.close();
  }

  // ── the source, for what a walk cannot reach ─────────────────────────────
  const S = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const H = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('no acquisition button is still labelled "Export CSV", "Download matrix", "Download sources" or "Acquisition Report v2"',
        !/acqExportRentRollCsv\(\)">[^<]*Export CSV/.test(S) && !/Download matrix \(CSV\)|Download sources \(CSV\)/.test(S)
        && !/&#x1F4D8; Acquisition Report v2/.test(H));
  check('every Rent Roll download carries the download arrow', (S.match(/acqExportRentRollCsv\(\)">&#x2B07; Rent Roll CSV</g) || []).length === 3);
  check('the Delete button takes its colour from the stylesheet, not an inline style',
        /id="acqDeleteBtn"[^>]*style="margin-left:auto;"/.test(H) && /\.acq-back-btn\.acq-delete-btn \{\s*background: transparent; border-color: rgba\(239, 68, 68, 0\.45\); color: var\(--c-f87171\);/.test(H));
  check('the phone size is 44px', /@media \(max-width: 640px\) \{\s*\.acq-btn, \.acq-new-btn, \.acq-back-btn, \.acq-lh-back, \.acq-export-btn, \.acq-upload-btn,\s*\.acq-convert-btn, \.acq-m13-actions button, \.acq-lm-view \{ min-height: 44px; \}/.test(H));
  check('the 240f954 Tenant-column rules are intact',
        /\.acq-m13-table tbody \.acq-m13-tenant \{ width: 170px; max-width: 170px; white-space: normal; overflow: hidden; \}/.test(H)
        && /-webkit-line-clamp: 2/.test(H));

  check('no uncaught errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  srv.close();
  const passed = results.filter(r => r.ok).length;
  console.log('\n' + '='.repeat(64) + `\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
