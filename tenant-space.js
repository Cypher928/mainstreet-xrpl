/**
 * tenant-space.js — Property Operating System: the Tenant Space view.
 * ============================================================================
 * "Open Suite 210 and see the complete story of that space." Assembles
 * everything about one tenant space from the property's verified record —
 * lease, scoped timeline, photos, invoices, warranties, documents, notes, and
 * CAM activity — into one view. Nothing scattered across modules.
 *
 * This is the memory made visible for a space. It is also the exact verified
 * record the "Reply with AI" capstone reads from (built next) — so it is
 * assembled as structured data first, then rendered.
 *
 * Reuses (never re-computes): property.timeline scoped by subject/tenant, the
 * attachment model (kind: photo/invoice/warranty/pdf/file), the tenant lease
 * fields, PropertyTimeline.describe for labels, and esc(). No new data store.
 *
 * Exposes: window.TenantSpace
 */
window.TenantSpace = (function () {
  'use strict';

  var _esc = (window.esc) || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  var _t = function (id) { return document.getElementById(id); };
  var _openRec = null; // the assembled record for the currently-open space (actions read this)
  function _fmtDate(ts) { try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return String(ts || ''); } }

  function _scopedEvents(property, tenantId) {
    return (property.timeline || [])
      .filter(function (e) { return e && ((e.subject && e.subject.id === tenantId) || e.tenantId === tenantId); })
      .sort(function (a, b) { return (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0); });
  }
  function _attach(events, kind) {
    var out = [];
    events.forEach(function (e) {
      (e.attachments || []).forEach(function (a) {
        if (a && a.kind === kind) out.push({ name: a.name, url: a.url, kind: a.kind, when: e.timestamp, from: e.title });
      });
    });
    return out;
  }

  // Structured verified record for a space — the single source both the view and
  // the (future) grounded AI reply read from.
  function assemble(property, tenantId) {
    var t = (property.tenants || []).find(function (x) { return x && x.id === tenantId; }) || {};
    var events = _scopedEvents(property, tenantId);
    var photos     = _attach(events, 'photo');
    var invoices   = _attach(events, 'invoice');
    var warranties = _attach(events, 'warranty');
    var documents  = _attach(events, 'pdf').concat(_attach(events, 'file'));
    var notes      = events.filter(function (e) { return e.manual && e.category === 'note'; });
    var cam        = events.filter(function (e) { return /^(cam_reconciled|invoice_imported|derived_metrics_rebuilt|manual_cam)$/.test(e.type); });
    var lease = {
      type: t.lease_type || null, sqft: t.leased_sqft || t.sqft || null,
      start: t.start_date || null, end: t.end_date || null, cap: (t.cap != null && t.cap !== '') ? t.cap : null,
      url: t.leaseUrl || t.lease_url || null,
    };
    // Grounded summary — facts read from the record, not general knowledge.
    var bits = [];
    if (lease.type) bits.push(lease.type + (lease.sqft ? ' · ' + lease.sqft + ' sqft' : ''));
    if (warranties.length) bits.push(warranties.length + ' warranty doc' + (warranties.length !== 1 ? 's' : '') + ' on file');
    if (invoices.length) bits.push(invoices.length + ' invoice' + (invoices.length !== 1 ? 's' : ''));
    if (photos.length) bits.push(photos.length + ' photo' + (photos.length !== 1 ? 's' : ''));
    var lastResp = (events.find(function (e) { return e.responsibility && e.responsibility !== 'na'; }) || {}).responsibility;
    if (lastResp) bits.push('most recent work: ' + lastResp + ' responsible');
    var summary = bits.length ? bits.join(' · ') : 'No records yet for this space.';

    return {
      space: { id: tenantId, name: t.tenant_name || 'Space' },
      lease: lease, summary: summary,
      counts: { events: events.length, photos: photos.length, invoices: invoices.length, warranties: warranties.length, documents: documents.length, notes: notes.length, cam: cam.length },
      events: events, photos: photos, invoices: invoices, warranties: warranties, documents: documents, notes: notes, cam: cam,
    };
  }

  // ── View ────────────────────────────────────────────────────────────────────
  function _attachChip(a, icon) {
    return '<a class="ts-doc" href="' + _esc(a.url) + '" target="_blank" rel="noopener" title="' + _esc(a.name) + '">' +
      icon + '&nbsp;<span class="ts-doc-name">' + _esc(a.name) + '</span>' +
      '<span class="ts-doc-when">' + _esc(_fmtDate(a.when)) + '</span></a>';
  }
  function _section(title, count, bodyHtml) {
    return '<section class="ts-sec"><div class="ts-sec-head"><span class="ts-sec-title">' + _esc(title) + '</span>' +
      (count != null ? '<span class="ts-sec-count">' + count + '</span>' : '') + '</div>' +
      '<div class="ts-sec-body">' + bodyHtml + '</div></section>';
  }
  function _empty(msg) { return '<div class="ts-empty">' + _esc(msg) + '</div>'; }

  function openSpace(tenantId) {
    var property = window.currentProperty && window.currentProperty();
    if (!property || !tenantId) return;
    if (_t('tsOverlay')) return;
    injectStyles();
    var rec = assemble(property, tenantId);
    _openRec = rec;

    var leaseRows = [];
    if (rec.lease.type)  leaseRows.push(['Lease type', rec.lease.type]);
    if (rec.lease.sqft)  leaseRows.push(['Leased area', rec.lease.sqft + ' sqft']);
    if (rec.lease.start || rec.lease.end) leaseRows.push(['Term', (rec.lease.start || '?') + ' → ' + (rec.lease.end || '?')]);
    if (rec.lease.cap != null) leaseRows.push(['CAM cap', String(rec.lease.cap)]);
    var leaseHtml = leaseRows.length
      ? '<div class="ts-lease">' + leaseRows.map(function (r) { return '<div class="ts-lease-row"><span>' + _esc(r[0]) + '</span><b>' + _esc(r[1]) + '</b></div>'; }).join('') +
        (rec.lease.url ? '<a class="ts-doc ts-doc--lease" href="' + _esc(rec.lease.url) + '" target="_blank" rel="noopener">\u{1F4C4}&nbsp;Open lease</a>' : '') + '</div>'
      : _empty('No lease on file for this space.');

    var timelineHtml = rec.events.length
      ? '<div class="ts-timeline">' + rec.events.slice(0, 12).map(function (e) {
          var d = (window.PropertyTimeline && PropertyTimeline.describe) ? PropertyTimeline.describe(e) : { label: e.type, icon: null };
          return '<div class="ts-tl-row"><span class="ts-tl-when">' + _esc(_fmtDate(e.timestamp)) + '</span>' +
            '<span class="ts-tl-badge">' + _esc(d.label) + '</span>' +
            '<span class="ts-tl-title">' + _esc(e.title) + '</span></div>';
        }).join('') + (rec.events.length > 12 ? '<div class="ts-empty">+ ' + (rec.events.length - 12) + ' earlier</div>' : '') + '</div>'
      : _empty('Nothing recorded for this space yet.');

    var photosHtml = rec.photos.length
      ? '<div class="ts-photos">' + rec.photos.map(function (a) { return '<a class="ts-photo" href="' + _esc(a.url) + '" target="_blank" rel="noopener" title="' + _esc(a.name) + '"><img src="' + _esc(a.url) + '" alt="' + _esc(a.name) + '" loading="lazy"></a>'; }).join('') + '</div>'
      : _empty('No photos yet.');
    var invHtml = rec.invoices.length ? '<div class="ts-docs">' + rec.invoices.map(function (a) { return _attachChip(a, '\u{1F9FE}'); }).join('') + '</div>' : _empty('No invoices yet.');
    var warrHtml = rec.warranties.length ? '<div class="ts-docs">' + rec.warranties.map(function (a) { return _attachChip(a, '\u{1F6E1}\u{FE0F}'); }).join('') + '</div>' : _empty('No warranties on file.');
    var docHtml = rec.documents.length ? '<div class="ts-docs">' + rec.documents.map(function (a) { return _attachChip(a, '\u{1F4C4}'); }).join('') + '</div>' : _empty('No other documents.');
    var notesHtml = rec.notes.length
      ? '<div class="ts-notes">' + rec.notes.map(function (e) { return '<div class="ts-note"><div class="ts-note-t">' + _esc(e.title) + '</div>' + (e.description ? '<div class="ts-note-d">' + _esc(e.description) + '</div>' : '') + '<div class="ts-note-w">' + _esc(_fmtDate(e.timestamp)) + '</div></div>'; }).join('') + '</div>'
      : _empty('No notes yet.');
    var camHtml = rec.cam.length
      ? '<div class="ts-timeline">' + rec.cam.map(function (e) { return '<div class="ts-tl-row"><span class="ts-tl-when">' + _esc(_fmtDate(e.timestamp)) + '</span><span class="ts-tl-title">' + _esc(e.title) + '</span></div>'; }).join('') + '</div>'
      : _empty('No CAM activity for this space.');

    var ov = document.createElement('div');
    ov.id = 'tsOverlay'; ov.className = 'ts-overlay';
    ov.innerHTML =
      '<div class="ts-panel" role="dialog" aria-modal="true" aria-label="' + _esc(rec.space.name) + '">' +
        '<div class="ts-head">' +
          '<div class="ts-head-main"><div class="ts-space-name">\u{1F4CD}&nbsp;' + _esc(rec.space.name) + '</div>' +
            '<div class="ts-space-sub">Everything about this space, in one place</div></div>' +
          '<button class="ts-x" id="tsClose" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="ts-summary">' + _esc(rec.summary) + '</div>' +
        '<div class="ts-actbar"><button class="ts-act-btn" id="tsActBtn">\u{26A1}&nbsp;Act on this space</button></div>' +
        '<div id="tsActions" class="ts-actions"></div>' +
        '<div class="ts-body">' +
          _section('Lease & terms', null, leaseHtml) +
          _section('Timeline', rec.counts.events, timelineHtml) +
          _section('Photos', rec.counts.photos, photosHtml) +
          _section('Invoices', rec.counts.invoices, invHtml) +
          _section('Warranties', rec.counts.warranties, warrHtml) +
          _section('Documents', rec.counts.documents, docHtml) +
          _section('Notes', rec.counts.notes, notesHtml) +
          _section('CAM activity', rec.counts.cam, camHtml) +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSpace(); });
    _t('tsClose').onclick = closeSpace;
    var _ab = _t('tsActBtn'); if (_ab) _ab.onclick = function () { if (window.SpaceActions) window.SpaceActions.open(); };
  }
  function closeSpace() { var o = _t('tsOverlay'); if (o) o.remove(); _openRec = null; }
  function record() { return _openRec; }

  function injectStyles() {
    if (_t('ts-styles')) return;
    var gold = '#C9973A';
    var css = [
      '.ts-overlay{position:fixed;inset:0;z-index:99820;background:rgba(0,0,0,0.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px;-webkit-overflow-scrolling:touch;}',
      '.ts-panel{width:100%;max-width:640px;margin:auto;background:var(--theme-bg,#07090C);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,0.6);overflow:hidden;}',
      '.ts-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px;background:var(--theme-card,#0F1217);border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.08);}',
      '.ts-space-name{font-size:1.08rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.ts-space-sub{font-size:0.76rem;color:var(--text-3,#94A3B8);margin-top:2px;}',
      '.ts-x{margin-left:auto;background:none;border:none;color:var(--text-3,#94A3B8);font-size:1.1rem;cursor:pointer;padding:4px 8px;min-height:34px;}',
      '.ts-summary{padding:11px 18px;font-size:0.82rem;color:var(--text-2,#CBD5E1);background:rgba(201,151,58,0.06);border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.06);}',
      '.ts-actbar{padding:12px 18px 0;}',
      '.ts-act-btn{width:100%;min-height:46px;border-radius:10px;font:800 0.9rem/1 inherit;cursor:pointer;color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';}',
      '.ts-act-btn:hover{filter:brightness(1.08);}',
      '.ts-actions{padding:0 18px;}',
      '.ts-body{padding:8px 18px 20px;max-height:70vh;overflow-y:auto;}',
      '.ts-sec{padding:12px 0;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.06);}',
      '.ts-sec:last-child{border-bottom:none;}',
      '.ts-sec-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}',
      '.ts-sec-title{font-size:0.74rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-4,#64748B);}',
      '.ts-sec-count{font-size:0.66rem;font-weight:800;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.07);border-radius:20px;padding:1px 8px;}',
      '.ts-empty{font-size:0.78rem;color:var(--text-4,#64748B);}',
      '.ts-lease{display:flex;flex-direction:column;gap:5px;}',
      '.ts-lease-row{display:flex;justify-content:space-between;font-size:0.82rem;color:var(--text-3,#94A3B8);}',
      '.ts-lease-row b{color:var(--text-1,#E2E8F0);font-weight:700;}',
      '.ts-doc{display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;color:var(--text-2,#CBD5E1);text-decoration:none;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.12);border-radius:8px;padding:7px 10px;margin-top:6px;max-width:100%;}',
      '.ts-doc:hover{border-color:' + gold + ';}',
      '.ts-doc--lease{margin-top:8px;}',
      '.ts-doc-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;}',
      '.ts-doc-when{margin-left:auto;color:var(--text-4,#64748B);font-size:0.7rem;}',
      '.ts-docs{display:flex;flex-direction:column;gap:2px;}',
      '.ts-photos{display:flex;flex-wrap:wrap;gap:8px;}',
      '.ts-photo img{width:74px;height:74px;object-fit:cover;border-radius:9px;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);display:block;}',
      '.ts-timeline{display:flex;flex-direction:column;gap:6px;}',
      '.ts-tl-row{display:flex;align-items:center;gap:9px;font-size:0.8rem;}',
      '.ts-tl-when{color:var(--text-4,#64748B);font-size:0.72rem;flex:none;width:96px;}',
      '.ts-tl-badge{font-size:0.62rem;font-weight:800;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.07);border-radius:5px;padding:1px 6px;flex:none;}',
      '.ts-tl-title{color:var(--text-2,#CBD5E1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ts-notes{display:flex;flex-direction:column;gap:8px;}',
      '.ts-note{background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:9px;padding:9px 11px;}',
      '.ts-note-t{font-size:0.82rem;font-weight:700;color:var(--text-1,#E2E8F0);}',
      '.ts-note-d{font-size:0.78rem;color:var(--text-3,#94A3B8);margin-top:3px;}',
      '.ts-note-w{font-size:0.7rem;color:var(--text-4,#64748B);margin-top:4px;}',
      '@media (max-width:480px){',
      '  .ts-overlay{padding:10px 8px;}',
      '  .ts-tl-when{width:74px;}',
      '  .ts-doc-name{max-width:150px;}',
      '  .ts-photo img{width:64px;height:64px;}',
      '}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'ts-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  return { assemble: assemble, openSpace: openSpace, closeSpace: closeSpace, record: record };
})();
