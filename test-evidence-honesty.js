// test-evidence-honesty.js
// ============================================================================
// What the Evidence Viewer says when it CANNOT do the thing it promises.
//
// Two failures reported from the pilot walkthrough, both about wording rather
// than behaviour — and both worth a regression test, because wording is exactly
// what silently drifts back:
//
//   1. "Jumped to page 1 — the exact paragraph couldn't be automatically
//      identified" reads as though navigation failed. It didn't. The quote is
//      verbatim from the document; what could not be done is mapping it onto a
//      rendered page, because the PDF's text layer splits and reorders words
//      the stored text keeps together. Leading with the jump blamed the wrong
//      thing.
//
//   2. When a citation carries no page or section, the Citation and Page rows
//      showed "—". A dash in a value slot reads as a rendering failure — the
//      field looks like it should have had something and didn't.
//
// Driven through the real window.EvidenceViewer.open(), against the real demo
// PDF, and asserted on rendered text. Nothing here reimplements the viewer.
//
// Run: node test-evidence-honesty.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8917;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Blocking a CDN inside the sandbox resets the connection mid-parse and the
  // browser truncates index.html at the failing tag, so nothing instantiates.
  // Stub them — except pdf.js, which the viewer genuinely needs.
  //
  // The app loads pdf.js 3.11.174 as a CLASSIC script from cdnjs, so the viewer
  // reads window.pdfjsLib. Serving it a v4 .mjs build would define nothing.
  // pdfjs-v3 is that exact version, aliased in devDependencies so it can sit
  // beside pdfjs-dist@4 (which test-demo-lease.js imports as an ES module).
  //
  // If it is missing the PDF checks below cannot run — and they FAIL rather
  // than skip. A regression test that quietly covers nothing is how the wording
  // this file exists to protect would drift back unnoticed.
  let pdfjs = null;
  for (const p of ['node_modules/pdfjs-v3/build/pdf.min.js',
                   'node_modules/pdfjs-v3/build/pdf.js']) {
    if (fs.existsSync(path.join(ROOT, p))) { pdfjs = path.join(ROOT, p); break; }
  }
  const pdfWorker = pdfjs && path.join(path.dirname(pdfjs), 'pdf.worker.min.js');
  await page.route('**cdnjs**', r => {
    const u = r.request().url();
    // The worker matters as much as the library: without it getTextContent()
    // never resolves, tier 3 never runs, and the banner this test exists for is
    // never written. The first run "passed" that way by finding no banner.
    if (pdfWorker && /pdf\.worker(\.min)?\.js/.test(u) && fs.existsSync(pdfWorker))
      return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(pdfWorker, 'utf8') });
    if (pdfjs && /pdf(\.min)?\.js/.test(u))
      return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(pdfjs, 'utf8') });
    return r.fulfill({ status: 200, body: '/*x*/' });
  });
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(`window.supabase={createClient:function(){return {auth:{
    getUser:function(){return Promise.resolve({data:{user:null},error:null});},
    getSession:function(){return Promise.resolve({data:{session:null},error:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return Promise.resolve({error:null});}},
    from:function(){return {select:function(){return this;},eq:function(){return this;},
      order:function(){return this;},limit:function(){return this;},
      then:function(f){return Promise.resolve({data:[],error:null}).then(f);}};},
    storage:{from:function(){return {getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`);

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  console.log('\nEvidence Viewer — what it says when it cannot deliver\n' + '='.repeat(62));

  const api = await page.evaluate(() => typeof window.EvidenceViewer?.open);
  check('EvidenceViewer.open is reachable', api === 'function', api);

  // ── 1 · a citation with no page and no section ───────────────────────────
  await page.evaluate(() => {
    window.EvidenceViewer.open({ citations: [{
      source: 'Lease — Whole Health Market',
      quote:  'Tenant shall pay its proportionate share of Common Area Maintenance.',
      // no page, no detail, no fileUrl — the case that produced the dashes
    }] });
  });
  await page.waitForTimeout(600);

  const panel = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#evidenceViewer .evd-row')].map(r => ({
      label: (r.querySelector('span')?.textContent || '').trim(),
      value: (r.querySelector('b')?.textContent || '').trim(),
      na:    !!r.querySelector('b.evd-na'),
    }));
    return { rows, text: (document.getElementById('evidenceViewer')?.innerText || '') };
  });

  const row = k => panel.rows.find(r => r.label === k) || { value: '(row missing)', na: false };
  check('Citation row states the absence instead of a dash',
        /not available/i.test(row('Citation').value), row('Citation').value);
  check('Page row states the absence instead of a dash',
        /not available/i.test(row('Page').value), row('Page').value);
  check('no row anywhere in the panel is a bare dash',
        !panel.rows.some(r => /^[—–-]$/.test(r.value)),
        panel.rows.map(r => r.label + '=' + r.value).join(' | '));
  check('the absent values are styled as absence, not as a value',
        row('Citation').na && row('Page').na,
        `Citation.na=${row('Citation').na} Page.na=${row('Page').na}`);
  check('the verbatim quote is still shown as the evidence of record',
        /proportionate share of Common Area Maintenance/.test(panel.text));

  // ── 2 · a quote that cannot be located in the rendered page ──────────────
  const demoPdf = 'assets/demo/lease-whole-health-market.pdf';
  const havePdf = fs.existsSync(path.join(ROOT, demoPdf));
  if (!havePdf || !pdfjs) {
    check('the mapping-banner checks can run at all', false,
          `demo PDF: ${havePdf}, classic pdf.js: ${!!pdfjs} — run: npm install`);
  } else {
    await page.evaluate((url) => {
      window.EvidenceViewer.close();
      window.EvidenceViewer.open({ citations: [{
        source: 'Lease — Whole Health Market',
        // Verbatim-looking prose that is deliberately NOT in the document, so
        // tier 3 misses and the banner has to explain itself. No seeded
        // evidence and no fabricated citation reaches the database — this
        // exists only inside the test page.
        quote: 'Landlord shall reimburse Tenant for all snow removal undertaken on alternate Tuesdays.',
        page: 1, fileUrl: url,
      }] });
    }, `http://127.0.0.1:${PORT}/${demoPdf}`);
    await page.waitForTimeout(4500);

    // Read the banner ELEMENT, not whatever text happens to match — a search
    // for the old wording can only ever confirm the old wording.
    const banner = await page.evaluate(() => {
      const b = document.getElementById('evdBanner');
      if (!b || getComputedStyle(b).display === 'none') return null;
      return (b.textContent || '').trim();
    });

    check('a banner explains the miss', !!banner, banner ? banner.slice(0, 80) + '…' : 'no banner found');
    if (banner) {
      check('it leads with the evidence being verbatim, not with the jump',
            /^this quote is verbatim/i.test(banner), banner.slice(0, 60));
      check('it does not open by blaming navigation ("Jumped to page …")',
            !/^jumped to page/i.test(banner), banner.slice(0, 40));
      check('it names citation mapping as what failed, not the lookup',
            /pinpointing it on the page|map/i.test(banner), banner.slice(0, 90));
      check('it still says which page is on screen',
            /page \d+/i.test(banner), banner.slice(-50));
      check('it still points at the exact text in the panel',
            /exact text is in the panel/i.test(banner), banner.slice(-50));
    }
  }

  // ── 3 · a refusal must not RENDER as an answer either ────────────────────
  // The server drops citations on answered:false. This asserts the client does
  // not put them back — and that the screen says, before the sentence is read,
  // that this is not an answer. Drives the real _submitLeaseQuestion() against
  // a stubbed endpoint; the only thing faked is the network.
  {
    const render = await page.evaluate(async () => {
      const id = 'probe-doc';
      const host = document.createElement('div');
      host.innerHTML = `<textarea id="lc-q-${id}"></textarea><div id="lc-ans-${id}"></div>`;
      document.body.appendChild(host);
      document.getElementById('lc-q-' + id).value = 'Who pays the most rent?';

      const realFetch = window.fetch;
      window.fetch = async () => ({
        ok: true,
        json: async () => ({
          answered: false,
          answer: 'This lease covers a single tenant, so it cannot say which tenant pays the most rent.',
          // The server would have emptied this. Sending it anyway is the point:
          // if the client ever renders it, the guard is one-deep and the next
          // regression puts a citation back under a refusal.
          citations: [{ quote: "Tenant's Proportionate Share shall be 12.4%", section: 'Section 4.2', page: 7 }],
          fileUrl: null, truncated: false, charsAnalyzed: 42000,
        }),
      });
      try {
        if (typeof window._submitLeaseQuestion !== 'function') return { missing: true };
        await window._submitLeaseQuestion(id);
      } finally { window.fetch = realFetch; }

      const el = document.getElementById('lc-ans-' + id);
      return {
        html: el.innerHTML,
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
        hasCitationCard: !!el.querySelector('.lc-citation'),
        hasSourceLabel: /Source from lease/i.test(el.textContent || ''),
        hasBadge: !!el.querySelector('.lc-answer-noanswer'),
      };
    });

    if (render.missing) {
      check('_submitLeaseQuestion is reachable for the refusal probe', false, 'function not defined');
    } else {
      check('a refusal renders NO citation card', !render.hasCitationCard, render.html.slice(0, 120));
      check('a refusal renders no "Source from lease" label', !render.hasSourceLabel);
      check('a refusal is badged so it does not read as an answer', render.hasBadge, render.text.slice(0, 70));
      check('the refusal text itself is shown', /cannot say which tenant/i.test(render.text), render.text.slice(0, 90));
    }
  }

  // ── 4 · AI-4: a citation naming a page the document does not have ────────
  //
  // The viewer clamped it: `Math.min(Math.max(c.page || 1, 1), pdf.numPages)`.
  // A citation claiming page 47 of a 12-page lease rendered the last page and
  // labelled it "Page 12 of 12". The user saw a real page from the real
  // document with nothing to suggest anything had gone wrong — a wrong citation
  // silently converted into a plausible one. This is the surface where the
  // product's central claim gets checked; it is the last place that should
  // round a bad citation into a believable one.
  if (!havePdf || !pdfjs) {
    check('the citation-page checks can run at all', false,
          `demo PDF: ${havePdf}, classic pdf.js: ${!!pdfjs} — run: npm install`);
  } else {
    const readViewer = () => page.evaluate(() => {
      const lbl = document.querySelector('.evd-page-lbl');
      const b   = document.getElementById('evdBanner');
      return {
        label:     lbl ? (lbl.textContent || '').trim() : null,
        labelBad:  !!(lbl && lbl.classList.contains('evd-page-lbl--bad')),
        banner:    (b && getComputedStyle(b).display !== 'none') ? (b.textContent || '').trim() : null,
      };
    });
    const show = (cit) => page.evaluate((c) => {
      window.EvidenceViewer.close();
      window.EvidenceViewer.open({ citations: [c] });
    }, cit);

    const url = `http://127.0.0.1:${PORT}/${demoPdf}`;
    // A real quote from the demo lease, so the only thing wrong is the page.
    const QUOTE = 'proportionate share of Common Area Maintenance';

    // How many pages the document really has — asserted against, not assumed.
    const realPages = await page.evaluate(async (u) => {
      const pdf = await window.pdfjsLib.getDocument({ url: u }).promise;
      return pdf.numPages;
    }, url);
    check('the demo document has a known page count', realPages > 0, String(realPages));

    // (a) a page number beyond the end of the document
    await show({ source: 'Lease — Whole Health Market', quote: QUOTE, page: realPages + 35, fileUrl: url });
    await page.waitForTimeout(4500);
    const over = await readViewer();

    check('an out-of-range citation still renders a page',
          !!over.label, JSON.stringify(over));
    // THE REGRESSION. The old label was "Page N of N" and nothing else.
    check('the label says the cited page does not exist',
          !!over.label && /no such page/i.test(over.label), over.label);
    check('the label names the page the citation actually claimed',
          !!over.label && over.label.includes(String(realPages + 35)), over.label);
    check('the label is marked as a fault, not styled as an ordinary caption',
          over.labelBad, `class evd-page-lbl--bad present: ${over.labelBad}`);
    check('a banner explains it in words', !!over.banner, over.banner || 'no banner');
    check('the banner says the page reference is wrong',
          !!over.banner && /page reference is wrong/i.test(over.banner), (over.banner || '').slice(0, 100));
    check('the banner states the real page count',
          !!over.banner && over.banner.includes(String(realPages)), (over.banner || '').slice(0, 120));
    // The mapping banner would talk over the real fault.
    check('it does NOT blame quote-mapping when the page is the problem',
          !!over.banner && !/pinpointing it on the page/i.test(over.banner), (over.banner || '').slice(0, 90));

    // (b) page 0 — out of range at the other end
    await show({ source: 'Lease — Whole Health Market', quote: QUOTE, page: 0, fileUrl: url });
    await page.waitForTimeout(4500);
    const zero = await readViewer();
    check('page 0 is reported as no such page, not silently floored to 1',
          !!zero.label && /no such page/i.test(zero.label), zero.label);

    // (c) no page number at all — a different thing from a wrong one
    await show({ source: 'Lease — Whole Health Market', quote: QUOTE, page: null, fileUrl: url });
    await page.waitForTimeout(4500);
    const none = await readViewer();
    check('a citation with no page says so rather than implying page 1 was cited',
          !!none.label && /gave no page/i.test(none.label), none.label);
    check('and it is not reported as a wrong page',
          !!none.label && !/no such page/i.test(none.label), none.label);

    // (d) a page that IS in range — the honest case must stay quiet
    await show({ source: 'Lease — Whole Health Market', quote: QUOTE, page: 1, fileUrl: url });
    await page.waitForTimeout(4500);
    const good = await readViewer();
    check('a valid page renders the plain label with no fault text',
          !!good.label && /^Page 1 of \d+$/.test(good.label), good.label);
    check('and is not styled as a fault', !good.labelBad, `labelBad=${good.labelBad}`);
  }

  await ctx.close(); await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(62));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})();
