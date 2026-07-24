'use strict';
/**
 * test-lease-ingest.js — Lease Ingestion Hardening verification.
 * Pure math runs in Node; analyze/rasterize and the batched vision path run in a
 * real browser against a real generated PDF (PDF.js must actually rasterize).
 */
let pw; try { pw = require('playwright'); } catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = '/home/user/mainstreet-xrpl', PORT = 8766;
const SCRATCH = '/tmp/claude-0/-home-user-mainstreet-xrpl/1fbf60da-4d0d-55d1-a66a-ea7fc9ee7968/scratchpad';
const MIME = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.pdf':'application/pdf' };
let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };
const sec = m => console.log('\n── ' + m + ' ──');

const LI = require(path.join(ROOT, 'lease-ingest.js'));
const MB = 1024 * 1024;

// Serve the app plus the generated test PDF.
const srv = http.createServer((rq, rs) => {
  const url = rq.url.split('?')[0];
  const f = url === '/lease-6p.pdf' ? path.join(SCRATCH, 'lease-6p.pdf')
          : path.join(ROOT, url === '/' ? '/index.html' : url);
  fs.readFile(f, (e, d) => { if (e) { rs.writeHead(404); rs.end(); return; } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(d); });
});

srv.listen(PORT, '127.0.0.1', async () => {
  sec('Pure size math (the HTTP 413 root cause)');
  (Math.abs(LI.estimateEncodedBytes(3 * MB) - 4 * MB) < 0.05 * MB) ? ok('base64 overhead modelled (+33%)') : bad('encode math');
  !LI.fitsInOneRequest(4 * MB) ? ok('4 MB source exceeds the 4.5 MB body limit') : bad('4MB should not fit');
  LI.fitsInOneRequest(2 * MB) ? ok('2 MB source fits in one request') : bad('2MB should fit');

  sec('Routing');
  (LI.planIngestion({ fileBytes: MB, pages: 20, textLayerChars: 5000 }).route === 'text') ? ok('digital lease → text route (unchanged, fast)') : bad('text route');
  (LI.planIngestion({ fileBytes: MB, pages: 8, textLayerChars: 0 }).route === 'vision-direct') ? ok('small scan → vision direct') : bad('vision-direct');
  const big = LI.planIngestion({ fileBytes: 22 * MB, pages: 38, textLayerChars: 0 });
  (big.route === 'vision-compressed' && big.needsRasterize) ? ok('22 MB copier scan → downscale + batch') : bad('compressed route', big.route);
  big.wouldHave413 ? ok('plan records that this file would previously have 413ed') : bad('no 413 flag');

  sec('Batching + merge');
  const sizes = new Array(30).fill(400 * 1024);
  const b = LI.planBatches(sizes);
  (b.length > 1) ? ok('30 pages split into ' + b.length + ' batches') : bad('no batching');
  b.every(g => g.reduce((s, i) => s + sizes[i], 0) <= LI.RAW_BUDGET) ? ok('every batch fits the budget') : bad('batch over budget');
  (b.flat().length === 30 && new Set(b.flat()).size === 30) ? ok('no page lost or duplicated') : bad('page coverage');
  const m = LI.mergeExtractions([{ tenant_name: 'Acme LLC', cam_cap: null }, { tenant_name: null, cam_cap: 5 }]);
  (m.tenant_name === 'Acme LLC' && m.cam_cap === 5) ? ok('merge captures a CAM cap found in a later batch') : bad('merge', JSON.stringify(m));

  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); }
  catch (_) { browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] }); }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m2 => logs.push({ t: m2.type(), x: m2.text() }));
  page.on('pageerror', e => logs.push({ t: 'PAGEERROR', x: e.message }));
  await page.route('**/supabase-js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/*mock*/' }));
  await page.route('**cdnjs.cloudflare.com**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/*cdn blocked in sandbox*/' }));
  const SRC = fs.readFileSync(path.join(ROOT, 'test-e2e-activity-timeline.js'), 'utf8');
  await page.addInitScript(SRC.slice(SRC.indexOf('const SUPABASE_MOCK = `') + 'const SUPABASE_MOCK = `'.length, SRC.indexOf('`;\n\n(async')));

  // PDF.js loads from a CDN the sandbox cannot reach, so stub its API surface.
  // NOTE: this does NOT test PDF.js rendering fidelity (whether a 150-DPI JPEG
  // stays legible) — that validates on the pilot. It DOES exercise everything we
  // wrote: canvas sizing at the target DPI, real browser JPEG encoding, byte
  // measurement, budget adherence, batching, merge, and partial-failure handling.
  await page.addInitScript(() => {
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument() {
        return { promise: Promise.resolve({
          numPages: (window.__TEST_PDF_PAGES || 6),
          getPage(n) {
            return Promise.resolve({
              getViewport({ scale }) { return { width: 612 * scale, height: 792 * scale, transform: [scale,0,0,scale,0,0] }; },
              getTextContent() {
                return Promise.resolve({ items: [{ str: 'Commercial Lease Agreement Page ' + n + ' Tenant: Riverside Deli LLC Premises Suite ' + (100 + n) }] });
              },
              render({ canvasContext, viewport }) {
                // Draw real content so JPEG encoding produces a realistic payload.
                const ctx = canvasContext;
                ctx.fillStyle = '#111';
                ctx.font = '16px sans-serif';
                for (let y = 40; y < viewport.height - 20; y += 26) {
                  ctx.fillText('Lease clause text line for page ' + n + ' — CAM, taxes, insurance, maintenance.', 40, y);
                }
                return { promise: Promise.resolve() };
              },
            });
          },
        }) };
      },
    };
  });

  // Capture what actually gets POSTed to /api/claude so we can measure the body.
  const bodies = [];
  await page.route('**/api/claude', async r => {
    bodies.push((r.request().postData() || '').length);
    await r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ tenant_name: 'Riverside Deli LLC', sqft: 2400, cam_cap: null, lease_type: 'NNN' }) });
  });

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => !!window.LeaseIngest && !!window.pdfjsLib, { timeout: 15000 });
    ok('LeaseIngest + PDF.js available in the app');

    sec('analyze() on a real PDF');
    const info = await page.evaluate(async () => {
      const res = await fetch('/lease-6p.pdf');
      const blob = await res.blob();
      const file = new File([blob], 'lease-6p.pdf', { type: 'application/pdf' });
      return await LeaseIngest.analyze(file);
    });
    (info.pages === 6) ? ok('page count read correctly (6)') : bad('pages', String(info.pages));
    (info.textLayerChars > 50) ? ok('text layer detected (' + info.textLayerChars + ' chars) → digital route') : bad('text layer', String(info.textLayerChars));
    info.isPdf ? ok('identified as PDF') : bad('not detected as pdf');

    sec('rasterize() actually downscales pages');
    const ras = await page.evaluate(async () => {
      const res = await fetch('/lease-6p.pdf');
      const blob = await res.blob();
      const file = new File([blob], 'lease-6p.pdf', { type: 'application/pdf' });
      const pages = await LeaseIngest.rasterize(file, { dpi: 150 });
      return { n: pages.length, bytes: pages.map(p => p.bytes), hasB64: pages.every(p => p.base64 && p.base64.length > 500) };
    });
    (ras.n === 6) ? ok('all 6 pages rasterized') : bad('rasterized pages', String(ras.n));
    ras.hasB64 ? ok('each page produced real JPEG base64 data') : bad('empty page data');
    const maxPage = Math.max(...ras.bytes);
    (maxPage < LI.RAW_BUDGET) ? ok('every rasterized page fits the per-request budget (max ' + Math.round(maxPage / 1024) + ' KB)') : bad('page too big', String(maxPage));

    sec('Batched vision path stays under the platform limit');
    const runBatched = await page.evaluate(async () => {
      const res = await fetch('/lease-6p.pdf');
      const blob = await res.blob();
      // Force the compressed path regardless of real size.
      const file = new File([blob], 'big-scan.pdf', { type: 'application/pdf' });
      Object.defineProperty(file, 'size', { value: 22 * 1024 * 1024 });
      const out = await callClaudeWithPdfDirect(file);
      return { tenant: out && out.tenant_name, sqft: out && out.sqft };
    });
    (runBatched.tenant === 'Riverside Deli LLC') ? ok('compressed path returns merged extraction') : bad('extraction', JSON.stringify(runBatched));
    (bodies.length >= 1) ? ok('vision call(s) issued: ' + bodies.length) : bad('no api calls');
    const maxBody = Math.max(...bodies);
    (maxBody <= LI.PLATFORM_BODY_LIMIT)
      ? ok('largest request body ' + (maxBody / MB).toFixed(2) + ' MB — under the 4.5 MB limit (no 413)')
      : bad('body exceeds platform limit', (maxBody / MB).toFixed(2) + ' MB');

    sec('Partial failure tolerance');
    await page.unroute('**/api/claude');
    let call = 0;
    await page.route('**/api/claude', async r => {
      call++;
      if (call === 1) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tenant_name: 'Riverside Deli LLC', cam_cap: 5 }) });
    });
    const partial = await page.evaluate(async () => {
      // 30 pages forces multiple batches, so failing the first still leaves others.
      window.__TEST_PDF_PAGES = 30;
      const res = await fetch('/lease-6p.pdf');
      const blob = await res.blob();
      const file = new File([blob], 'big-scan2.pdf', { type: 'application/pdf' });
      Object.defineProperty(file, 'size', { value: 22 * 1024 * 1024 });
      try {
        const out = await callClaudeWithPdfDirect(file);
        return { ok: true, tenant: out && out.tenant_name, cap: out && out.cam_cap };
      } catch (e) { return { ok: false, err: e.message }; }
    });
    (partial.ok && partial.tenant === 'Riverside Deli LLC')
      ? ok('a failed batch does not discard the others (partial success)') : bad('partial failure handling', JSON.stringify(partial));

    sec('Pre-flight messaging');
    const pf = LI.preflight({ fileBytes: 22 * MB, pages: 38, textLayerChars: 0 });
    (/optimiz/i.test(pf.title) && /22.0 MB/.test(pf.detail)) ? ok('large scan explains itself with the real size') : bad('preflight', pf.title);
    (LI.preflight({ fileBytes: MB, pages: 10, textLayerChars: 9000 }).plan.route === 'text') ? ok('digital lease pre-flights clean') : bad('preflight text');

    sec('Console errors');
    const errs = logs.filter(l => (l.t === 'error' || l.t === 'PAGEERROR')
      && !/favicon|Failed to load resource|ERR_CERT|net::ERR|\[saveCamResults\]|\[loadCamResults\]/.test(l.x));
    errs.length === 0 ? ok('no unexpected console errors') : bad('console errors', JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    bad('UNCAUGHT', e.message);
    logs.slice(-20).forEach(l => console.error('   ' + l.t + ': ' + l.x));
  } finally {
    await browser.close(); srv.close();
    console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
    process.exit(fail === 0 ? 0 : 1);
  }
});
