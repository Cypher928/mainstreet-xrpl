/**
 * lease-ingest.js — Lease Ingestion Hardening.
 * ============================================================================
 * Goal: a property manager uploads the leases they already have — 40 MB copier
 * scans included — without thinking about file size or scan quality.
 *
 * THE PROBLEM THIS SOLVES
 * Scanned leases have no text layer, so they take the Claude vision path, which
 * base64-encodes the whole PDF into the request body. Vercel's Node serverless
 * runtime caps request bodies at ~4.5 MB (a platform limit — the Next.js-style
 * `config.api.bodyParser.sizeLimit` export does NOT apply to this app, which is
 * not a Next.js project). Base64 adds ~33%, so any source PDF over ~3.3 MB was
 * rejected with HTTP 413 before our handler ever ran. The client accepted files
 * up to 25 MB, so the failure was invisible until it happened.
 *
 * THE FIX (no new OCR vendor)
 *   1. Pre-flight  — measure the ENCODED size and tell the user what will happen.
 *   2. Downscale   — rasterize pages via PDF.js to JPEG at a target DPI. A 40 MB
 *                    scan becomes a few hundred KB per page.
 *   3. Chunk       — pack pages into batches that fit the body budget, one call
 *                    per batch (also keeps each call under the 60s maxDuration).
 *   4. Merge       — combine per-batch field extractions; first non-null wins, so
 *                    a CAM cap on page 30 is still found.
 * Partial success beats total failure: a failed batch never discards the others.
 *
 * The pure functions (estimateEncodedBytes / planIngestion / mergeExtractions /
 * preflight) are dependency-free so they can be unit-tested in Node.
 *
 * Exposes: window.LeaseIngest  (and module.exports for tests)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LeaseIngest = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ── Budgets ────────────────────────────────────────────────────────────────
  // Vercel Node serverless hard limit is 4.5 MB of request body. Reserve room
  // for the prompt, JSON envelope, and headers.
  var PLATFORM_BODY_LIMIT = 4.5 * 1024 * 1024;
  // Non-payload bytes in the request: prompt, JSON envelope, headers. Small —
  // the extraction prompt is ~2 KB; 64 KB is a generous allowance.
  var REQUEST_OVERHEAD    = 64 * 1024;
  // Per-CALL packing budget when we are already compressing (many JPEGs in one
  // body) — deliberately conservative. NOTE: this is NOT the compression
  // trigger; see fitsInOneRequest.
  var BODY_BUDGET         = 3.6 * 1024 * 1024;
  var RAW_BUDGET          = Math.floor(BODY_BUDGET * 3 / 4); // pre-base64 bytes (~2.7 MB)
  var DEFAULT_DPI         = 150;                 // legible for lease text
  var MIN_DPI             = 96;                  // fallback for stubborn pages
  var DEFAULT_QUALITY     = 0.72;
  var MIN_QUALITY         = 0.5;
  var MAX_PAGES           = 50;                  // matches extractPdfText's cap
  var TEXT_LAYER_MIN      = 50;                  // chars: below this = scanned

  // ── Pure helpers (unit-testable in Node) ───────────────────────────────────

  /** Base64 inflates by 4/3 and pads to a multiple of 4. */
  function estimateEncodedBytes(rawBytes) {
    if (!(rawBytes > 0)) return 0;
    return Math.ceil(rawBytes / 3) * 4;
  }

  /**
   * Would this payload survive the platform body limit if sent whole?
   *
   * THIS IS THE COMPRESSION TRIGGER, and it is deliberately set at the real
   * platform ceiling (not the conservative packing budget) so that **any file
   * that previously uploaded successfully still takes the exact same code path
   * as before**. Compression only engages for files that would genuinely have
   * been rejected with HTTP 413.
   */
  function fitsInOneRequest(rawBytes) {
    return estimateEncodedBytes(rawBytes) + REQUEST_OVERHEAD <= PLATFORM_BODY_LIMIT;
  }

  /**
   * Decide how to ingest a document.
   * @param {{fileBytes:number, pages:number, textLayerChars:number}} info
   * @returns {{route:string, reason:string, needsRasterize:boolean,
   *            estimatedEncoded:number, wouldHave413:boolean}}
   */
  function planIngestion(info) {
    info = info || {};
    var bytes = info.fileBytes || 0;
    var pages = info.pages || 0;
    var chars = info.textLayerChars || 0;
    var encoded = estimateEncodedBytes(bytes);
    var wouldHave413 = encoded > PLATFORM_BODY_LIMIT;

    if (chars >= TEXT_LAYER_MIN) {
      return {
        route: 'text', reason: 'Digital PDF with a readable text layer.',
        needsRasterize: false, estimatedEncoded: encoded, wouldHave413: false,
      };
    }
    if (fitsInOneRequest(bytes)) {
      return {
        route: 'vision-direct',
        reason: 'Scanned PDF small enough to send as-is.',
        needsRasterize: false, estimatedEncoded: encoded, wouldHave413: wouldHave413,
      };
    }
    return {
      route: 'vision-compressed',
      reason: 'Scanned PDF too large to send whole — pages are downscaled' +
              (pages > 1 ? ' and sent in batches.' : '.'),
      needsRasterize: true, estimatedEncoded: encoded, wouldHave413: wouldHave413,
    };
  }

  /**
   * Pack page payloads into batches that each fit the body budget.
   * @param {number[]} pageSizes raw (pre-base64) byte size per page
   * @returns {number[][]} arrays of zero-based page indexes
   */
  function planBatches(pageSizes) {
    var batches = [], cur = [], curBytes = 0;
    (pageSizes || []).forEach(function (sz, i) {
      var s = Math.max(0, sz || 0);
      // A single oversized page still goes alone — better a risky call than none.
      if (cur.length && curBytes + s > RAW_BUDGET) { batches.push(cur); cur = []; curBytes = 0; }
      cur.push(i); curBytes += s;
    });
    if (cur.length) batches.push(cur);
    return batches;
  }

  /**
   * Merge per-batch field extractions. First non-null/non-empty wins, so a CAM
   * cap that only appears deep in the document is still captured.
   */
  function mergeExtractions(parts) {
    var out = {};
    (parts || []).filter(Boolean).forEach(function (p) {
      Object.keys(p).forEach(function (k) {
        if (k.indexOf('__') === 0) return;
        var v = p[k];
        var empty = (v === null || v === undefined || v === '' ||
                     (typeof v === 'string' && /^(null|n\/a|unknown)$/i.test(v.trim())));
        if (!empty && (out[k] === undefined || out[k] === null || out[k] === '')) out[k] = v;
      });
    });
    return out;
  }

  function _mb(n) { return (n / (1024 * 1024)).toFixed(1) + ' MB'; }

  /** Human pre-flight message — says what will happen, before it happens. */
  function preflight(info) {
    var plan = planIngestion(info);
    var bytes = (info && info.fileBytes) || 0;
    var pages = (info && info.pages) || 0;
    if (plan.route === 'text') {
      return { ok: true, plan: plan, level: 'ok',
        title: 'Ready to extract',
        detail: 'Digital lease' + (pages ? ' · ' + pages + ' page' + (pages !== 1 ? 's' : '') : '') + ' · ' + _mb(bytes) + '.' };
    }
    if (plan.route === 'vision-direct') {
      return { ok: true, plan: plan, level: 'ok',
        title: 'Scanned lease — reading with vision',
        detail: 'No text layer found' + (pages ? ' · ' + pages + ' page' + (pages !== 1 ? 's' : '') : '') + ' · ' + _mb(bytes) + '.' };
    }
    return { ok: true, plan: plan, level: 'info',
      title: 'Large scanned lease — optimizing before upload',
      detail: _mb(bytes) + (pages ? ' · ' + pages + ' pages' : '') +
        '. Pages are downscaled and sent in batches so the upload succeeds. This takes a little longer.' };
  }

  // ── Browser-only: analyze + rasterize ──────────────────────────────────────
  function _pdfjs() {
    var lib = (typeof window !== 'undefined') && window.pdfjsLib;
    if (!lib) throw new Error('PDF.js not available');
    return lib;
  }

  /** Inspect a PDF: page count and how much text layer it actually has. */
  async function analyze(file) {
    var info = { fileBytes: file ? file.size : 0, pages: 0, textLayerChars: 0, isPdf: false };
    var isPdf = !!file && (/\.pdf$/i.test(file.name || '') || file.type === 'application/pdf');
    info.isPdf = isPdf;
    if (!isPdf) return info;
    try {
      var buf = await file.arrayBuffer();
      var pdf = await _pdfjs().getDocument({ data: buf }).promise;
      info.pages = pdf.numPages;
      // Sample the first few pages — enough to tell digital from scanned.
      var sample = Math.min(pdf.numPages, 3), chars = 0;
      for (var p = 1; p <= sample; p++) {
        try {
          var tc = await (await pdf.getPage(p)).getTextContent();
          chars += tc.items.map(function (it) { return it.str; }).join(' ').trim().length;
        } catch (_e) { /* unreadable page — counts as no text */ }
      }
      info.textLayerChars = chars;
    } catch (e) {
      info.error = e && e.message;
    }
    return info;
  }

  /**
   * Render pages to JPEG at a target DPI. Returns [{page, base64, bytes}].
   * Automatically steps down DPI/quality for pages that stay oversized.
   */
  async function rasterize(file, opts) {
    opts = opts || {};
    var dpi = opts.dpi || DEFAULT_DPI;
    var quality = opts.quality || DEFAULT_QUALITY;
    var maxPages = opts.maxPages || MAX_PAGES;
    var buf = await file.arrayBuffer();
    var pdf = await _pdfjs().getDocument({ data: buf }).promise;
    var count = Math.min(pdf.numPages, maxPages);
    var out = [];
    for (var p = 1; p <= count; p++) {
      try {
        var img = await _renderPage(pdf, p, dpi, quality);
        // One more attempt at lower fidelity if a single page busts the budget.
        if (img.bytes > RAW_BUDGET) img = await _renderPage(pdf, p, MIN_DPI, MIN_QUALITY);
        out.push({ page: p, base64: img.base64, bytes: img.bytes });
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[LeaseIngest] page ' + p + ' render failed:', e && e.message);
      }
    }
    return out;
  }

  async function _renderPage(pdf, pageNum, dpi, quality) {
    var page = await pdf.getPage(pageNum);
    // PDF user units are 72/inch; scale to the requested DPI.
    var viewport = page.getViewport({ scale: dpi / 72 });
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    var ctx = canvas.getContext('2d');
    // White matte — scans render with transparent background otherwise.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    var dataUrl = canvas.toDataURL('image/jpeg', quality);
    var base64 = dataUrl.split(',')[1] || '';
    // free the bitmap promptly — 50 page canvases add up
    canvas.width = canvas.height = 0;
    return { base64: base64, bytes: Math.floor(base64.length * 3 / 4) };
  }

  /** Build Anthropic image content blocks for a batch of rasterized pages. */
  function buildImageBlocks(pages) {
    return (pages || []).map(function (p) {
      return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.base64 } };
    });
  }

  // ── Telemetry ──────────────────────────────────────────────────────────────
  // Operational metrics only — which path ran, how big, how long, did it work.
  // Deliberately contains NO document content, file names, tenant names, or user
  // identifiers, so it is safe to persist and aggregate.
  //
  // Answers questions like "are 90% of uploads taking the text path?" and
  // "are copier scans routinely hitting compression?"
  //
  // Never let telemetry break ingestion: every entry point is failure-tolerant.
  var PATHS = { TEXT: 'text', VISION_DIRECT: 'vision-direct', VISION_COMPRESSED: 'vision-compressed', VISION_CHUNKED: 'vision-chunked' };
  var _runs = [];          // rolling in-session buffer
  var MAX_RUNS = 200;

  function begin(fileBytes) {
    return {
      path: null,
      originalBytes: fileBytes || 0,
      payloadBytes: null,     // what we actually sent (post-compression)
      pages: null,
      batches: null,
      batchFailures: 0,
      outcome: null,          // 'success' | 'failure'
      reason: null,           // short failure reason, no document content
      ms: null,
      _t0: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
    };
  }

  function mark(run, fields) {
    if (!run || !fields) return run;
    try { Object.keys(fields).forEach(function (k) { run[k] = fields[k]; }); } catch (_e) {}
    return run;
  }

  function end(run, outcome, reason) {
    if (!run) return null;
    try {
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      run.ms = Math.round(now - run._t0);
      run.outcome = outcome || 'success';
      // Keep the reason short and content-free (an error class, not a payload).
      run.reason = reason ? String(reason).slice(0, 120) : null;
      delete run._t0;
      // Compression ratio is the number that tells us if downscaling is working.
      if (run.payloadBytes && run.originalBytes) {
        run.compressionRatio = Math.round((run.payloadBytes / run.originalBytes) * 100) / 100;
      }
      _runs.push(run);
      if (_runs.length > MAX_RUNS) _runs = _runs.slice(-MAX_RUNS);
      if (typeof console !== 'undefined') {
        console.log('[INGEST]', run.path, '|', (run.originalBytes / 1048576).toFixed(2) + 'MB',
          run.payloadBytes ? '→ ' + (run.payloadBytes / 1048576).toFixed(2) + 'MB' : '',
          '| pages:', run.pages ?? '—', '| batches:', run.batches ?? '—',
          '|', run.outcome, '|', run.ms + 'ms');
      }
    } catch (_e) {}
    return run;
  }

  /** The persisted shape — flat, small, no document content. */
  function summary(run) {
    if (!run) return null;
    return {
      path: run.path, originalBytes: run.originalBytes, payloadBytes: run.payloadBytes,
      compressionRatio: run.compressionRatio ?? null, pages: run.pages, batches: run.batches,
      batchFailures: run.batchFailures || 0, outcome: run.outcome, reason: run.reason, ms: run.ms,
    };
  }

  /** In-session aggregate — answers the path-mix question without a DB query. */
  function sessionStats() {
    var byPath = {}, ok = 0, failed = 0, totalMs = 0;
    _runs.forEach(function (r) {
      byPath[r.path || 'unknown'] = (byPath[r.path || 'unknown'] || 0) + 1;
      if (r.outcome === 'success') ok++; else failed++;
      totalMs += r.ms || 0;
    });
    var n = _runs.length;
    var pct = {};
    Object.keys(byPath).forEach(function (k) { pct[k] = n ? Math.round((byPath[k] / n) * 100) + '%' : '0%'; });
    return { runs: n, byPath: byPath, pathMix: pct, success: ok, failed: failed, avgMs: n ? Math.round(totalMs / n) : 0 };
  }

  function recentRuns() { return _runs.slice(); }

  return {
    // budgets (exported for tests + callers)
    PLATFORM_BODY_LIMIT: PLATFORM_BODY_LIMIT, BODY_BUDGET: BODY_BUDGET, RAW_BUDGET: RAW_BUDGET,
    DEFAULT_DPI: DEFAULT_DPI, TEXT_LAYER_MIN: TEXT_LAYER_MIN, MAX_PAGES: MAX_PAGES,
    // pure
    estimateEncodedBytes: estimateEncodedBytes, fitsInOneRequest: fitsInOneRequest,
    planIngestion: planIngestion, planBatches: planBatches,
    mergeExtractions: mergeExtractions, preflight: preflight,
    // browser
    analyze: analyze, rasterize: rasterize, buildImageBlocks: buildImageBlocks,
    // telemetry (operational metrics only — no document content)
    PATHS: PATHS, begin: begin, mark: mark, end: end, summary: summary,
    sessionStats: sessionStats, recentRuns: recentRuns,
  };
});
