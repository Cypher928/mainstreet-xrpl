/**
 * document-links.js — SEC-1: the ONE way a stored document is rendered.
 * ============================================================================
 * Loaded two ways from this single file, like request-limits.js:
 *
 *   browser   <script src="document-links.js">   → window.docLinkHtml, …
 *   tests     require('./document-links.js')     → module.exports
 *
 * ── WHY THIS IS A FILE AND NOT A FUNCTION SOMEWHERE ─────────────────────────
 * The `leases` and `invoices` buckets are going private, which means a stored
 * object's URL cannot be known at render time — it has to be exchanged for a
 * short-lived signed URL first. Every render site therefore has to make the
 * same decision, and the fix was applied one site at a time:
 *
 *   pass 1  Evidence Viewer, lease modal, Documents
 *   pass 2  the invoice viewer                       (missed in pass 1)
 *   pass 3  Space chips, Evidence Viewer fallback    (missed in passes 1–2)
 *   pass 4  AI evidence chips, Property Documents,
 *           timeline attachments, escrow documents   (missed in passes 1–3)
 *
 * Pass 4 was found in production: an AI evidence chip rendered
 * `<a href="{inv.fileUrl}">`, uploads had started returning a relative storage
 * reference, and the browser resolved it against the page origin and navigated
 * to a Vercel 404.
 *
 * Four passes is the evidence that per-site fixes do not hold. Render sites do
 * not get to decide any more — they call docLinkHtml() or docImageHtml() and
 * the decision is made here, once.
 */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.isStoredDocumentRef = api.isStoredDocumentRef;
    window.docLinkHtml         = api.docLinkHtml;
    window.docImageHtml        = api.docImageHtml;
  }
})(function () {
  'use strict';

  // Self-contained: this file must not depend on script.js having loaded.
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Is this reference an object in our storage?
   *
   * Two shapes, both real:
   *   `leases/<uid>/file.pdf`                         written after SEC-1
   *   `https://…/storage/v1/object/public/leases/…`   rows written before it
   *
   * Everything else — an inline data: URL from Add Activity, an external link,
   * a blob: preview — is not ours to sign and opens directly.
   */
  function isStoredDocumentRef(url) {
    if (typeof url !== 'string' || !url) return false;
    return /\/storage\/v1\/object\//.test(url) || /^(leases|invoices)\//.test(url);
  }

  /**
   * A clickable document.
   *
   * A stored object becomes a <button> carrying the reference, opened by the
   * app-wide [data-doc-url] handler after resolving a signed URL. Anything else
   * stays a plain <a href>. A missing url renders as inert text rather than a
   * link to nowhere.
   *
   * `innerHtml` is inserted as-is — callers escape their own text, because most
   * of them are composing an icon plus markup.
   */
  function docLinkHtml(url, innerHtml, opts) {
    var o = opts || {};
    var cls = o.className || 'doc-link';
    var title = o.title ? ' title="' + esc(o.title) + '"' : '';
    var extra = o.extraAttrs ? ' ' + o.extraAttrs : '';
    var body = innerHtml == null ? '' : innerHtml;
    if (!url) {
      return '<span class="' + esc(cls) + ' doc-link--missing"' + title + extra + '>' + body + '</span>';
    }
    if (isStoredDocumentRef(url)) {
      return '<button type="button" class="' + esc(cls) + '" data-doc-url="' + esc(url) + '"' +
        title + extra + '>' + body + '</button>';
    }
    return '<a class="' + esc(cls) + '" href="' + esc(url) + '" target="_blank" rel="noopener"' +
      title + extra + '>' + body + '</a>';
  }

  /**
   * An inline thumbnail.
   *
   * A stored object is emitted with NO src — only `data-doc-src`. The observer
   * in script.js fills it in when the node enters the DOM. Emitting a src that
   * cannot load would show a broken-image icon, which is how a private bucket
   * announces itself if nobody thinks about it.
   */
  function docImageHtml(url, alt, opts) {
    var o = opts || {};
    var cls = o.className ? ' class="' + esc(o.className) + '"' : '';
    var a = ' alt="' + esc(alt || '') + '"';
    if (!url) return '<span' + cls + '></span>';
    if (isStoredDocumentRef(url)) {
      return '<img' + cls + a + ' data-doc-src="' + esc(url) + '" loading="lazy">';
    }
    return '<img' + cls + a + ' src="' + esc(url) + '" loading="lazy">';
  }

  return {
    isStoredDocumentRef: isStoredDocumentRef,
    docLinkHtml: docLinkHtml,
    docImageHtml: docImageHtml,
  };
});
