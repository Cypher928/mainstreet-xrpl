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
//   6  navigation (Step B): "← Back to Acquisitions" is in view from the
//      Summary, the Acquisition Matrix and a lease record, however far down,
//      at 1366, 768 and 375 wide; it lands on the Acquisitions section with
//      the review's card focused and marked; Enter on the card reopens it.
//      "← Back to Lease Matrix" returns to the view the record was opened
//      from — the Matrix stays the Matrix — with the control that opened it
//      focused (the Summary row, the Matrix tenant, or the Matrix cell, out
//      from under the held tenant column). Keyboard only, end to end. A
//      converted review goes back the same way. No history entry is added:
//      the browser's own Back is untouched. The report's title has no "v2".
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
  '#acqBackToAcqsBtn',
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


  // ── 6 · navigation ───────────────────────────────────────────────────────
  // Is "Back to Acquisitions" on screen, and is it what a tap there reaches?
  const barCheck = (p) => p.evaluate(() => {
    const b = document.getElementById('acqBackToAcqsBtn');
    if (!b) return { ok: false, why: 'no button' };
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: r.top >= -0.5 && r.bottom <= window.innerHeight && r.height > 0 && !!hit && (hit === b || b.contains(hit)),
             top: Math.round(r.top), scrollY: Math.round(window.scrollY), text: b.textContent.trim(), hit: hit && hit.className };
  });
  const toBottom = (p) => p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const landed = (p, id) => p.evaluate((id) => {
    const sec = document.getElementById('acqSection');
    const card = document.querySelector(`#acqReviewsGrid .acq-card[data-review-id="${id}"]`);
    const sr = sec.getBoundingClientRect(), cr = card ? card.getBoundingClientRect() : null;
    return {
      panelHidden: getComputedStyle(document.getElementById('acqDetailPanel')).display === 'none',
      sectionInView: sr.top < window.innerHeight && sr.bottom > 0,
      cardInView: !!cr && cr.top >= 0 && cr.bottom <= window.innerHeight,
      focused: !!card && document.activeElement === card,
      marked: !!card && card.classList.contains('acq-card-returned'),
      active: _activeAcqId,
    };
  }, id);
  const histNow = (p) => p.evaluate(() => ({ len: history.length, href: location.href }));

  for (const [label, vp, mobile] of [['desktop 1366', { width: 1366, height: 900 }, false],
                                     ['tablet 768', { width: 768, height: 1024 }, true],
                                     ['phone 375', { width: 375, height: 812 }, true]]) {
    const { ctx: c, page: p } = await open(vp, mobile);
    const h0 = await histNow(p);
    // From the Summary, scrolled to the foot of the review.
    let b = await barCheck(p);
    check(`${label}: "← Back to Acquisitions" is at the top of the review`, b.ok && b.text === '← Back to Acquisitions', JSON.stringify(b));
    await toBottom(p);
    b = await barCheck(p);
    check(`${label}: and still in view, and tappable, at the foot of the Summary`, b.ok && b.scrollY > 200, JSON.stringify(b));
    // From the Acquisition Matrix.
    await p.click('#acqTermsList .acq-lm-view[data-view="acquisition"]');
    await p.waitForSelector('#acqTermsList .acq-m13-table');
    await toBottom(p);
    b = await barCheck(p);
    check(`${label}: in view at the foot of the Acquisition Matrix`, b.ok && b.scrollY > 200, JSON.stringify(b));
    // From a lease record opened from the Matrix.
    await p.evaluate((s) => document.querySelector(`#acqTermsList .acq-m13-open[data-leasehold="${s}"]`).scrollIntoView({ block: 'center' }), SHOP);
    await p.click(`#acqTermsList .acq-m13-open[data-leasehold="${SHOP}"]`);
    await p.waitForSelector('#acqTermsList .acq-lh');
    const rec = await p.evaluate(() => {
      const back = document.querySelector('#acqTermsList .acq-lh-back');
      const bar = document.getElementById('acqNavBar').getBoundingClientRect();
      const r = back.getBoundingClientRect();
      // The record's card is scrolled to: its top edge lands below the bar.
      const card = document.getElementById('acqTermsCard').getBoundingClientRect();
      return { text: back.textContent.trim(), title: back.title, focused: document.activeElement === back,
               belowBar: r.top >= bar.bottom - 0.5 && card.top >= bar.bottom - 0.5 && card.top <= bar.bottom + 40,
               cardTop: Math.round(card.top), barBottom: Math.round(bar.bottom), view: back.getAttribute('data-return-view') };
    });
    check(`${label}: the lease record opened from the Matrix offers "← Back to Lease Matrix", back to the Acquisition Matrix`,
          rec.text === '← Back to Lease Matrix' && rec.title === 'Back to the Acquisition Matrix' && rec.view === 'acquisition', JSON.stringify(rec));
    check(`${label}: it opens with that Back focused, and the record lands just below the bar, not under it`, rec.focused && rec.belowBar, JSON.stringify(rec));
    await toBottom(p);
    b = await barCheck(p);
    check(`${label}: "← Back to Acquisitions" in view at the foot of the lease record`, b.ok && b.scrollY > 200, JSON.stringify(b));
    // Back to Lease Matrix → the Matrix, the tenant focused.
    await p.evaluate(() => document.querySelector('#acqTermsList .acq-lh-back').scrollIntoView({ block: 'center' }));
    await p.click('#acqTermsList .acq-lh-back');
    const m = await p.evaluate((s) => ({
      m13: !!document.querySelector('#acqTermsList .acq-m13-table'), summary: !!document.querySelector('#acqTermsList .acq-lm-table'),
      focused: document.activeElement === document.querySelector(`#acqTermsList .acq-m13-open[data-leasehold="${s}"]`),
      tab: (document.querySelector('#acqTermsList .acq-lm-view.active') || {}).getAttribute ? document.querySelector('#acqTermsList .acq-lm-view.active').getAttribute('data-view') : null,
    }), SHOP);
    check(`${label}: "← Back to Lease Matrix" returns to the Acquisition Matrix — not the Summary — with the tenant focused`,
          m.m13 && !m.summary && m.focused && m.tab === 'acquisition', JSON.stringify(m));
    // A far-right cell's sources open its record; Back returns to that cell,
    // brought into the frame on a narrow screen and clear of the tenant column.
    await p.evaluate((s) => {
      const cell = document.querySelector(`#acqTermsList .acq-m13-cell[data-leasehold="${s}"][data-field="termination_rights"]`);
      const sc = document.querySelector('#acqTermsList .acq-m13-scroll');
      cell.closest('tr').scrollIntoView({ block: 'center' });
      sc.scrollLeft = sc.scrollWidth;
    }, SHOP);
    await p.click(`#acqTermsList .acq-m13-cell[data-leasehold="${SHOP}"][data-field="termination_rights"]`);
    await p.waitForSelector('#acqTermsList .acq-m13-detail');
    await p.evaluate(() => document.querySelector('#acqTermsList .acq-m13-record').scrollIntoView({ block: 'center' }));
    await p.click('#acqTermsList .acq-m13-record');
    await p.waitForSelector('#acqTermsList .acq-lh');
    await p.evaluate(() => document.querySelector('#acqTermsList .acq-lh-back').scrollIntoView({ block: 'center' }));
    await p.click('#acqTermsList .acq-lh-back');
    const fr = await p.evaluate((s) => {
      const cell = document.querySelector(`#acqTermsList .acq-m13-cell[data-leasehold="${s}"][data-field="termination_rights"]`);
      const th = cell.closest('tr').querySelector('th').getBoundingClientRect();
      const frame = document.querySelector('#acqTermsList .acq-m13-scroll').getBoundingClientRect();
      const r = cell.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
      return { focused: document.activeElement === cell, inFrame: r.left >= th.right - 1 && r.left < frame.right,
               tappable: !!hit && (hit === cell || cell.contains(hit)), cellL: Math.round(r.left), heldR: Math.round(th.right), frameR: Math.round(frame.right) };
    }, SHOP);
    check(`${label}: Back from a record opened from the far-right Termination Right cell — that cell focused, in the frame, clear of the tenant column, tappable`,
          fr.focused && fr.inFrame && fr.tappable, JSON.stringify(fr));
    // Back to Acquisitions from the Matrix.
    await p.click('#acqBackToAcqsBtn');
    const l = await landed(p, MAPLE);
    check(`${label}: "← Back to Acquisitions" lands on the Acquisitions section, the review's card in view, focused and marked`,
          l.panelHidden && l.sectionInView && l.cardInView && l.focused && l.marked && l.active === null, JSON.stringify(l));
    // Enter on the focused card reopens the review.
    await p.keyboard.press('Enter');
    await p.waitForSelector(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"], #acqTermsList .acq-m13-open[data-leasehold="${SHOP}"]`, { timeout: 15000 });
    check(`${label}: Enter on the focused card opens the review again`, await p.evaluate((id) => _activeAcqId === id, MAPLE));
    const h1 = await histNow(p);
    check(`${label}: no history entry was added or taken — the browser's Back is as it was`, h1.len === h0.len && h1.href === h0.href, JSON.stringify([h0, h1]));
    await c.close();
  }

  // Keyboard only, desktop: Summary row → record → Back → the row; the cell
  // whose sources opened a record → Back → that cell, out from under the
  // held tenant column; Back to Acquisitions from a record opened from the
  // Summary.
  {
    const { ctx: c, page: p } = await open({ width: 1366, height: 900 }, false);
    await p.focus(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`);
    await p.keyboard.press('Enter');
    await p.waitForSelector('#acqTermsList .acq-lh');
    const k1 = await p.evaluate(() => { const b = document.querySelector('#acqTermsList .acq-lh-back');
      return { focused: document.activeElement === b, title: b.title, view: b.getAttribute('data-return-view') }; });
    check('keyboard: Enter on a Summary row opens the record, its Back focused and naming the Summary',
          k1.focused && k1.title === 'Back to the Summary' && k1.view === 'summary', JSON.stringify(k1));
    await p.keyboard.press('Enter');
    const k2 = await p.evaluate((s) => ({ summary: !!document.querySelector('#acqTermsList .acq-lm-table'),
      focused: document.activeElement === document.querySelector(`#acqTermsList .acq-lm-row[data-leasehold="${s}"]`) }), SHOP);
    check('keyboard: Enter on Back returns to the Summary with the row focused', k2.summary && k2.focused, JSON.stringify(k2));
    // From a Matrix cell's sources.
    await p.click('#acqTermsList .acq-lm-view[data-view="acquisition"]');
    await p.waitForSelector('#acqTermsList .acq-m13-table');
    await p.focus(`#acqTermsList .acq-m13-cell[data-leasehold="${SHOP}"][data-field="termination_rights"]`);
    await p.keyboard.press('Enter');
    await p.waitForSelector('#acqTermsList .acq-m13-detail');
    await p.focus('#acqTermsList .acq-m13-record');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#acqTermsList .acq-lh');
    await p.focus('#acqTermsList .acq-lh-back');
    await p.keyboard.press('Enter');
    const k3 = await p.evaluate((s) => {
      const cell = document.querySelector(`#acqTermsList .acq-m13-cell[data-leasehold="${s}"][data-field="termination_rights"]`);
      const r = cell.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { m13: !!document.querySelector('#acqTermsList .acq-m13-table'), focused: document.activeElement === cell,
               visible: !!hit && (hit === cell || cell.contains(hit)), inViewport: r.top >= 0 && r.bottom <= window.innerHeight };
    }, SHOP);
    check('keyboard: a record opened from a Matrix cell\'s sources returns to the Matrix with that cell focused, in view and not under the tenant column',
          k3.m13 && k3.focused && k3.visible && k3.inViewport, JSON.stringify(k3));
    // A record opened from the Summary, then Back to Acquisitions: the
    // Summary is unchanged for the next visit.
    await p.click('#acqTermsList .acq-lm-view[data-view="summary"]');
    await p.click(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`);
    await p.waitForSelector('#acqTermsList .acq-lh');
    await p.focus('#acqBackToAcqsBtn');
    await p.keyboard.press('Enter');
    const k4 = await landed(p, MAPLE);
    check('keyboard: Back to Acquisitions from a lease record lands on the focused card', k4.panelHidden && k4.focused && k4.marked, JSON.stringify(k4));
    // The cards are drawn again (a count arriving later): focus and mark stay.
    await p.evaluate(() => _renderAcqSection(_acqReviews));
    const k5 = await landed(p, MAPLE);
    check('the focus and the mark survive the cards being drawn again', k5.focused && k5.marked, JSON.stringify(k5));
    await p.keyboard.press('Enter');
    await p.waitForSelector(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`, { timeout: 15000 });
    check('and the review reopens on its Summary, as a review always opens', await p.evaluate(() => !!document.querySelector('#acqTermsList .acq-lm-table') && !document.querySelector('#acqTermsList .acq-lh')));
    // The report: its title, and the bar under it.
    await p.click('#acqReportV2Btn');
    await p.waitForSelector('#reportOverlay', { state: 'visible', timeout: 15000 });
    const rp = await p.evaluate(() => {
      const ov = document.getElementById('reportOverlay');
      const b = document.getElementById('acqBackToAcqsBtn').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { text: ov.textContent, barCovered: !!hit && !hit.closest('#acqNavBar') };
    });
    check('the opened report is titled "Acquisition Report" — "v2" nowhere in it', /Acquisition Report/.test(rp.text) && !/Acquisition Report v2/.test(rp.text));
    check('the report overlay sits above the bar', rp.barCovered);
    await p.evaluate(() => closeReport());
    await c.close();
  }

  // A converted review goes back the same way.
  {
    const { ctx: c, page: p } = await open({ width: 375, height: 812 }, true, { status: 'converted' });
    await toBottom(p);
    const b = await barCheck(p);
    check('a converted review: "← Back to Acquisitions" in view at its foot, on a phone', b.ok, JSON.stringify(b));
    await p.click('#acqBackToAcqsBtn');
    const l = await landed(p, MAPLE);
    check('and it lands on the converted review\'s card, focused', l.panelHidden && l.focused && l.marked, JSON.stringify(l));
    await c.close();
  }

  // ── the source, for what a walk cannot reach ─────────────────────────────
  const S = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const H = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('no acquisition button is still labelled "Export CSV", "Download matrix", "Download sources" or "Acquisition Report v2"',
        !/acqExportRentRollCsv\(\)">[^<]*Export CSV/.test(S) && !/Download matrix \(CSV\)|Download sources \(CSV\)/.test(S)
        && !/&#x1F4D8; Acquisition Report v2/.test(H) && !/'Acquisition Report v2/.test(S));
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
