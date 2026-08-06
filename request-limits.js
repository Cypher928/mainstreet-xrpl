/**
 * request-limits.js — ONE definition of how large a request body may be.
 * ============================================================================
 * Loaded two ways on purpose, from this single file:
 *
 *   browser   <script src="request-limits.js">  → window.MSRequestLimits
 *   server    require('../request-limits.js')   → module.exports
 *
 * It is one file because the failure it prevents is a DISAGREEMENT. The client
 * accepted files up to 60 MB. Vercel's Node runtime rejects any request body
 * over ~4.5 MB before the handler runs, and every upload path here base64-
 * encodes the file into a JSON body, which adds a third. The real ceiling was
 * ~3.3 MB of file — eighteen times smaller than what the client allowed.
 *
 * A commercial lease scanned at 300 dpi is routinely 5–20 MB. Everything in
 * that range passed the client check, spent time being read and base64-encoded,
 * went over the wire, and came back as a bare HTTP 413 that no code path
 * explained. Phase 0 runs on real scanned leases; it would have met this on
 * day one.
 *
 * The `config.api.bodyParser.sizeLimit` exports in api/*.js do NOT raise the
 * limit — `api.bodyParser` is a Next.js API-route construct and this is not a
 * Next.js project (no next dependency, no pages/ or app/ dir). api/claude.js
 * documents that correctly; api/explain.js and api/upload.js claimed the
 * opposite. Only the platform limit below is real.
 */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.MSRequestLimits = api;
})(function () {
  'use strict';

  /**
   * Vercel's Node serverless runtime rejects request bodies over this size
   * BEFORE the handler runs, with a bare 413 and no application error. Not
   * configurable from this codebase — it is a platform property.
   */
  var PLATFORM_BODY_LIMIT = 4.5 * 1024 * 1024;      // 4,718,592

  /**
   * Non-payload bytes in a request: the prompt, the JSON envelope, headers.
   * The extraction prompt is ~2 KB; 64 KB is a generous allowance kept
   * deliberately loose so the ceiling errs small.
   */
  var REQUEST_OVERHEAD = 64 * 1024;                 // 65,536

  /** Base64 inflates by 4/3 and pads to a multiple of 4. */
  function estimateEncodedBytes(rawBytes) {
    if (!(rawBytes > 0)) return 0;
    return Math.ceil(rawBytes / 3) * 4;
  }

  /** Largest RAW file that still fits once base64-encoded into one request. */
  var MAX_UPLOAD_BYTES = Math.floor((PLATFORM_BODY_LIMIT - REQUEST_OVERHEAD) * 3 / 4);  // ~3.33 MB

  /** Would this payload survive the platform limit if sent whole? */
  function fitsInOneRequest(rawBytes) {
    return estimateEncodedBytes(rawBytes) + REQUEST_OVERHEAD <= PLATFORM_BODY_LIMIT;
  }

  function _mb(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
  }

  /**
   * The one user-facing sentence for a file that cannot be sent.
   *
   * It states the file's size, the limit, and what to do — because "Upload
   * failed" and a raw 413 are both things a property manager can do nothing
   * with. `what` names the thing in the user's words ("lease", "invoice"), not
   * the endpoint's.
   */
  function tooLargeMessage(rawBytes, what) {
    var noun = what || 'file';
    return 'This ' + noun + ' is ' + _mb(rawBytes) + ' MB. The largest that can be uploaded is '
      + _mb(MAX_UPLOAD_BYTES) + ' MB, because the file is encoded for transfer and the server '
      + 'rejects anything larger before it arrives. Split the ' + noun
      + ' into parts, or upload a compressed or lower-resolution copy.';
  }

  /**
   * The single gate. Returns { ok: true } or { ok: false, error, rawBytes, limit }.
   *
   * Callers must check this BEFORE reading and encoding the file. Encoding a
   * 40 MB PDF to base64 in the browser takes seconds and allocates ~53 MB, and
   * every one of those seconds is spent on a request that cannot succeed.
   */
  function checkUploadSize(rawBytes, what) {
    var n = Number(rawBytes);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'File size could not be determined — re-select the file and try again.',
               rawBytes: null, limit: MAX_UPLOAD_BYTES };
    }
    if (n === 0) {
      return { ok: false, error: 'That file is empty (0 bytes). Re-export it and try again.',
               rawBytes: 0, limit: MAX_UPLOAD_BYTES };
    }
    if (!fitsInOneRequest(n)) {
      return { ok: false, error: tooLargeMessage(n, what), rawBytes: n, limit: MAX_UPLOAD_BYTES };
    }
    return { ok: true, rawBytes: n, limit: MAX_UPLOAD_BYTES };
  }

  /**
   * Server-side gate, in ENCODED bytes — what the handler actually holds.
   *
   * The client check can be bypassed (a direct POST, a stale tab), so the
   * server checks too. It reports the same ceiling in the same words, so a user
   * who somehow reaches it is not told two different stories.
   */
  function checkEncodedSize(encodedLength, what) {
    var n = Number(encodedLength);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: 'No file content was received.', encoded: null };
    }
    if (n + REQUEST_OVERHEAD > PLATFORM_BODY_LIMIT) {
      // Report the RAW size the user would recognise, not the encoded one.
      return { ok: false, error: tooLargeMessage(Math.floor(n * 3 / 4), what), encoded: n };
    }
    return { ok: true, encoded: n };
  }

  /**
   * Total base64 bytes across every document/image block in a messages array.
   *
   * Sums rather than maxes: a batched vision call carries several page images,
   * and it is the whole body the platform weighs, not the largest part of it.
   */
  function base64DocBytes(messages) {
    var total = 0;
    var list = Array.isArray(messages) ? messages : [];
    for (var i = 0; i < list.length; i++) {
      var content = list[i] && list[i].content;
      if (!Array.isArray(content)) continue;
      for (var j = 0; j < content.length; j++) {
        var block = content[j];
        var data = block && block.source && block.source.data;
        if (typeof data === 'string') total += data.length;
      }
    }
    return total;
  }

  return {
    base64DocBytes:       base64DocBytes,
    PLATFORM_BODY_LIMIT:  PLATFORM_BODY_LIMIT,
    REQUEST_OVERHEAD:     REQUEST_OVERHEAD,
    MAX_UPLOAD_BYTES:     MAX_UPLOAD_BYTES,
    estimateEncodedBytes: estimateEncodedBytes,
    fitsInOneRequest:     fitsInOneRequest,
    checkUploadSize:      checkUploadSize,
    checkEncodedSize:     checkEncodedSize,
    tooLargeMessage:      tooLargeMessage,
  };
});
