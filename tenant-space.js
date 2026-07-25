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
  function _money(n) { try { return '$' + Math.round(Number(n)).toLocaleString('en-US'); } catch (_) { return '$' + n; } }

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
    var camEvents  = events.filter(function (e) { return /^(cam_reconciled|invoice_imported|derived_metrics_rebuilt|manual_cam)$/.test(e.type); });
    // Auto-reflect completed CAM reconciliation for this space — no manual step.
    var camRec = property.camReconciliation || null;
    var camResult = null;
    if (camRec && Array.isArray(camRec.results)) {
      camResult = camRec.results.find(function (r) {
        return r && ((r.tenantId && r.tenantId === tenantId) || (r.tenantName && r.tenantName === t.tenant_name) || (r.name && r.name === t.tenant_name));
      }) || null;
    }
    var lease = {
      type: t.lease_type || null, sqft: t.leased_sqft || t.sqft || null,
      start: t.start_date || null, end: t.end_date || null, cap: (t.cap != null && t.cap !== '') ? t.cap : null,
      url: t.leaseUrl || t.lease_url || null, fileName: t.leaseFileName || null,
    };
    // Actual lease document(s) already on file for this space (not just terms).
    var leaseDocs = [];
    if (lease.url) leaseDocs.push({ name: lease.fileName || ((t.tenant_name || 'Tenant') + ' lease'), url: lease.url, kind: 'pdf' });
    // Grounded summary — facts read from the record, not general knowledge.
    var bits = [];
    if (lease.type) bits.push(lease.type + (lease.sqft ? ' · ' + lease.sqft + ' sqft' : ''));
    if (camResult) bits.push((camRec && camRec.camYear ? camRec.camYear + ' ' : '') + 'CAM ' + _money(camResult.allocatedAmount != null ? camResult.allocatedAmount : camResult.totalAllocated) + ' allocated');
    if (warranties.length) bits.push(warranties.length + ' warranty doc' + (warranties.length !== 1 ? 's' : '') + ' on file');
    if (invoices.length) bits.push(invoices.length + ' invoice' + (invoices.length !== 1 ? 's' : ''));
    if (photos.length) bits.push(photos.length + ' photo' + (photos.length !== 1 ? 's' : ''));
    var lastResp = (events.find(function (e) { return e.responsibility && e.responsibility !== 'na'; }) || {}).responsibility;
    if (lastResp) bits.push('most recent work: ' + lastResp + ' responsible');
    var summary = bits.length ? bits.join(' · ') : 'No records yet for this space.';

    return {
      space: { id: tenantId, name: t.tenant_name || 'Space' },
      lease: lease, leaseDocs: leaseDocs, summary: summary,
      camYear: (camRec && camRec.camYear) || null, camResult: camResult,
      counts: { events: events.length, photos: photos.length, invoices: invoices.length, warranties: warranties.length, documents: documents.length, notes: notes.length, cam: camEvents.length + (camResult ? 1 : 0) },
      events: events, photos: photos, invoices: invoices, warranties: warranties, documents: documents, notes: notes, cam: camEvents,
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
    var leaseDocsHtml = (rec.leaseDocs || []).map(function (a) { return _attachChip(a, '\u{1F4C4}'); }).join('');
    var leaseHtml = (leaseRows.length || leaseDocsHtml)
      ? '<div class="ts-lease">' +
          leaseRows.map(function (r) { return '<div class="ts-lease-row"><span>' + _esc(r[0]) + '</span><b>' + _esc(r[1]) + '</b></div>'; }).join('') +
          (leaseDocsHtml || '<div class="ts-empty" style="margin-top:6px">Lease terms on file — no lease document uploaded yet.</div>') +
        '</div>'
      : _empty('No lease on file for this space.');

    var timelineHtml = rec.events.length
      ? '<div class="ts-timeline">' + rec.events.slice(0, 12).map(function (e) {
          var d = (window.PropertyTimeline && PropertyTimeline.describe) ? PropertyTimeline.describe(e) : { label: e.type, icon: null };
          // Every entry opens the record that created it.
          return '<button type="button" class="ts-tl-row ts-tl-row--click" data-tlid="' + _esc(e.id) + '" title="Open this record">' +
            '<span class="ts-tl-when">' + _esc(_fmtDate(e.timestamp)) + '</span>' +
            '<span class="ts-tl-badge">' + _esc(d.label) + '</span>' +
            '<span class="ts-tl-title">' + _esc(e.title) + '</span>' +
            '<span class="ts-tl-go">&#x203A;</span></button>';
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
    var camResultHtml = '';
    if (rec.camResult) {
      var cr = rec.camResult;
      var alloc = cr.allocatedAmount != null ? cr.allocatedAmount : cr.totalAllocated;
      var vari = (cr.variance != null) ? cr.variance
        : ((cr.actualCam != null && cr.expectedCam != null) ? (cr.actualCam - cr.expectedCam) : null);
      var status = (cr.status === 'needs review') ? 'Needs review' : 'Ready';
      var vStr = vari == null ? '—' : ((vari > 0 ? '+' : '') + _money(vari));
      // Summary only — the full reconciliation stays in CAM.
      camResultHtml =
        '<div class="ts-cam">' +
          '<div class="ts-cam-yr">' + _esc((rec.camYear || '') + ' CAM') + '</div>' +
          '<div class="ts-cam-grid">' +
            '<div class="ts-cam-cell"><div class="ts-cam-v">' + _esc(alloc != null ? _money(alloc) : '—') + '</div><div class="ts-cam-l">Allocated</div></div>' +
            '<div class="ts-cam-cell"><div class="ts-cam-v' + (vari > 0 ? ' ts-cam-v--up' : '') + '">' + _esc(vStr) + '</div><div class="ts-cam-l">Variance</div></div>' +
            '<div class="ts-cam-cell"><div class="ts-cam-v">' + _esc(status) + '</div><div class="ts-cam-l">Status</div></div>' +
          '</div>' +
          '<div class="ts-cam-links">' +
            '<button type="button" class="ts-cam-link" id="tsViewRecon">View Full Reconciliation &#x2192;</button>' +
            '<button type="button" class="ts-cam-link" id="tsTenantStmt">Tenant Statement &#x2192;</button>' +
          '</div>' +
        '</div>';
    }
    var camEventsHtml = rec.cam.length
      ? '<div class="ts-timeline"' + (camResultHtml ? ' style="margin-top:8px"' : '') + '>' + rec.cam.map(function (e) { return '<div class="ts-tl-row"><span class="ts-tl-when">' + _esc(_fmtDate(e.timestamp)) + '</span><span class="ts-tl-title">' + _esc(e.title) + '</span></div>'; }).join('') + '</div>'
      : '';
    var camHtml = (camResultHtml || camEventsHtml) ? (camResultHtml + camEventsHtml) : '';

    // ── Financial activity: CAM allocation + this space's invoices ───────────
    var finHtml = (camHtml || invHtml !== _empty('No invoices yet.'))
      ? (camHtml || '') + (rec.invoices.length ? '<div class="ts-lbl">Invoices</div>' + invHtml : '')
      : '';
    if (!finHtml) finHtml = _empty('No CAM allocations or invoices for this space yet.');

    // ── Maintenance: work performed on this space + its warranties ───────────
    var maintEvents = rec.events.filter(function (e) {
      return /^(maintenance|repair|vendor|inspection|capital_improvement)$/.test(e.category || '');
    });
    var maintCount = maintEvents.length + rec.counts.warranties;
    var maintHtml = '';
    if (maintEvents.length) {
      maintHtml += '<div class="ts-timeline">' + maintEvents.slice(0, 8).map(function (e) {
        var resp = (e.responsibility && e.responsibility !== 'na') ? ' <span class="ts-tl-b">' + _esc(e.responsibility) + '</span>' : '';
        return '<div class="ts-tl-row"><span class="ts-tl-when">' + _esc(_fmtDate(e.timestamp)) + '</span>' +
          '<span class="ts-tl-title">' + _esc(e.title) + '</span>' + resp + '</div>';
      }).join('') + '</div>';
    }
    if (rec.warranties.length) maintHtml += '<div class="ts-lbl">Warranties</div>' + warrHtml;
    if (!maintHtml) maintHtml = _empty('No repairs, vendor work, or warranties recorded for this space yet.');

    // ── Documents & notes ────────────────────────────────────────────────────
    // Demo spaces show the document set a real suite would keep on file
    // (lease, amendments, estoppel, COIs, CAM backup, notices, photos).
    var refAll = [];
    try {
      var _pr = window.PropertyReference;
      var _t2 = (property.tenants || []).find(function (x) { return x && x.id === tenantId; });
      if (_pr && _t2) refAll = _pr.spaceDocumentsFor(property, _t2);
    } catch (_e) {}
    // Photos belong in the Photos section, not buried under Documents.
    var refPhotos = refAll.filter(function (a) { return a.kind === 'photo'; });
    var refDocs   = refAll.filter(function (a) { return a.kind !== 'photo'; });

    // These are reference entries — the document set this space WOULD keep on
    // file. There is no stored file behind them, so they must not look like
    // links. Same honesty rule as the AI evidence chips: never a dead click.
    var _refRow = function (a, i) {
      var ic = a.kind === 'invoice' ? '\u{1F9FE}' : (a.kind === 'photo' ? '\u{1F5BC}\u{FE0F}' : '\u{1F4C4}');
      // Clickable: opens a rendered preview of the document. Sample records are
      // still labelled honestly, but tapping always does something.
      return '<button type="button" class="ts-doc ts-doc--ref" data-refdoc="' + i + '" title="Open ' + _esc(a.category) + '">' +
        ic + '&nbsp;<span class="ts-doc-name">' + _esc(a.name) + '</span>' +
        '<span class="ts-doc-cat">' + _esc(a.category) + '</span>' +
        '<span class="ts-doc-sample">sample</span>' +
        '<span class="ts-doc-when">' + _esc(_fmtDate(a.when)) + '</span></button>';
    };
    var refDocsHtml = refDocs.length ? '<div class="ts-docs">' + refDocs.map(_refRow).join('') + '</div>' : '';
    var docNotesHtml = (rec.documents.length ? docHtml : '') + refDocsHtml +
      (rec.notes.length ? '<div class="ts-lbl">Notes</div>' + notesHtml : '');
    if (!docNotesHtml) docNotesHtml = _empty('No documents or notes for this space yet.');
    if (refDocs.length) docNotesHtml += '<div class="ts-ref-note">Sample records show the documents this space would keep on file. Upload a file to replace one.</div>';

    // Merge reference photos into the Photos section.
    if (refPhotos.length) {
      photosHtml = (rec.photos.length ? photosHtml : '') +
        '<div class="ts-docs">' + refPhotos.map(_refRow).join('') + '</div>';
    }
    // Counts must match what is actually on screen.
    var docCount   = rec.counts.documents + rec.counts.notes + refDocs.length;
    var photoCount = rec.counts.photos + refPhotos.length;

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
        '<div class="ts-body">' +
          _section('Lease', null, leaseHtml) +
          _section('Financial activity', rec.counts.cam + rec.counts.invoices, finHtml) +
          _section('Maintenance', maintCount, maintHtml) +
          _section('Photos', photoCount, photosHtml) +
          _section('Documents', docCount, docNotesHtml) +
          _section('Timeline', rec.counts.events, timelineHtml) +
        '</div>' +
        '<div class="ts-actbar"><button class="ts-act-btn" id="tsActBtn">\u{26A1}&nbsp;Act on this space</button>' +
          '<div class="ts-act-hint">Review the record above, then take action — grounded in it.</div></div>' +
        '<div id="tsActions" class="ts-actions"></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSpace(); });
    _t('tsClose').onclick = closeSpace;
    var _ab = _t('tsActBtn'); if (_ab) _ab.onclick = function () { if (window.SpaceActions) window.SpaceActions.open(); };

    // ── Every row opens the record behind it ────────────────────────────────
    var _spaceName = rec.space.name;
    // Sample / reference documents → rendered document preview.
    var _allRef = refDocs.concat(refPhotos);
    ov.querySelectorAll('[data-refdoc]').forEach(function (b) {
      b.onclick = function () {
        var list = b.closest('.ts-sec') && /Photos/.test((b.closest('.ts-sec').querySelector('.ts-sec-title') || {}).textContent || '') ? refPhotos : refDocs;
        var a = list[Number(b.getAttribute('data-refdoc'))];
        if (a && window.DocViewer) window.DocViewer.openDoc({ name: a.name, url: a.url, kind: a.kind, category: a.category, when: a.when, space: _spaceName });
      };
    });
    // Timeline entries → the document, note, invoice or dispute behind them.
    ov.querySelectorAll('[data-tlid]').forEach(function (b) {
      b.onclick = function () {
        var ev = (rec.events || []).find(function (x) { return String(x.id) === b.getAttribute('data-tlid'); });
        if (!ev || !window.DocViewer) return;
        // Navigating to another pane means leaving the drawer.
        var navigates = !(ev.attachments || []).length && !(ev.manual);
        if (navigates) closeSpace();
        window.DocViewer.openTimelineEvent(ev, { spaceName: _spaceName });
      };
    });
    // CAM summary → the full reconciliation / the tenant statement (Reports).
    var _vr = _t('tsViewRecon');
    if (_vr) _vr.onclick = function () {
      closeSpace();
      try { if (window.switchWorkspaceTab) window.switchWorkspaceTab('cam'); } catch (_e) {}
      try {
        var el = document.getElementById('results') || document.getElementById('cardInvoices');
        if (el && window._ccFlashEl) window._ccFlashEl(el);
      } catch (_e) {}
    };
    var _stm = _t('tsTenantStmt');
    if (_stm) _stm.onclick = function () {
      // Generation stays in Reports — this just makes it reachable from the tenant.
      closeSpace();
      try {
        if (typeof window.generateTenantStatement === 'function') { window.generateTenantStatement(_spaceName); return; }
        if (window.switchWorkspaceTab) window.switchWorkspaceTab('reports');
        var rs = document.getElementById('reportsSection');
        if (rs && window._ccFlashEl) window._ccFlashEl(rs);
      } catch (_e) {}
    };
  }
  function closeSpace() { var o = _t('tsOverlay'); if (o) o.remove(); _openRec = null; }
  function record() { return _openRec; }

  // Top-level Spaces list — first-class, subject-first navigation for the
  // property's tenant spaces. Each card opens the full Space view.
  function renderList(property) {
    property = property || (window.currentProperty && window.currentProperty());
    var host = _t('spacesList');
    if (!host || !property) return;
    injectStyles();
    var tenants = (property.tenants || []).filter(function (t) { return t && (t.tenant_name || t.id); });
    if (!tenants.length) {
      host.innerHTML = '<div class="ts-empty">No tenant spaces yet. Add tenants under Documents → Add One Tenant, and they’ll appear here as spaces.</div>';
      return;
    }
    host.innerHTML = '<div class="tsl-grid">' + tenants.map(function (t) {
      var rec = assemble(property, t.id);
      var meta = [];
      if (t.lease_type) meta.push(t.lease_type);
      if (t.leased_sqft || t.sqft) meta.push((t.leased_sqft || t.sqft) + ' sqft');
      if (t.end_date) meta.push('to ' + t.end_date);
      var counts = [];
      if (rec.counts.events) counts.push(rec.counts.events + ' event' + (rec.counts.events !== 1 ? 's' : ''));
      if (rec.counts.warranties) counts.push(rec.counts.warranties + ' warranty');
      if (rec.counts.invoices) counts.push(rec.counts.invoices + ' invoice' + (rec.counts.invoices !== 1 ? 's' : ''));
      if (rec.counts.photos) counts.push(rec.counts.photos + ' photo' + (rec.counts.photos !== 1 ? 's' : ''));
      return '<div class="tsl-card">' +
        '<div class="tsl-name">\u{1F4CD}&nbsp;' + _esc(t.tenant_name || 'Space') + '</div>' +
        (meta.length ? '<div class="tsl-meta">' + _esc(meta.join(' · ')) + '</div>' : '') +
        (counts.length ? '<div class="tsl-counts">' + _esc(counts.join(' · ')) + '</div>' : '<div class="tsl-counts tsl-counts--empty">No records yet</div>') +
        '<button class="tsl-open" onclick="if(window.TenantSpace){TenantSpace.openSpace(\'' + _esc(t.id) + '\');}">Open space →</button>' +
      '</div>';
    }).join('') + '</div>';
  }

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
      '.ts-actbar{padding:14px 18px 6px;border-top:1px solid rgba(var(--line-rgb,255,255,255),0.08);}',
      '.ts-act-btn{width:100%;min-height:46px;border-radius:10px;font:800 0.9rem/1 inherit;cursor:pointer;color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';}',
      '.ts-act-btn:hover{filter:brightness(1.08);}',
      '.ts-act-hint{font-size:0.72rem;color:var(--text-4,#64748B);text-align:center;margin-top:6px;}',
      '.ts-actions{padding:0 18px 18px;}',
      '.ts-cam-result{border-left:3px solid ' + gold + ';padding-left:10px;}',
      '.ts-lbl{font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-4,#64748B);margin:10px 0 5px;}',
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
      '.ts-doc-when{margin-left:auto;color:var(--text-4,#64748B);font-size:0.7rem;flex:none;}',
      '.ts-doc--ref{cursor:pointer;border-style:dashed;opacity:0.85;width:100%;text-align:left;font:inherit;}',
      '.ts-doc--ref:hover{border-color:' + gold + ';opacity:1;}',
      '.ts-tl-row--click{width:100%;text-align:left;background:none;border:none;font:inherit;cursor:pointer;padding:6px 4px;border-radius:7px;}',
      '.ts-tl-row--click:hover{background:rgba(var(--line-rgb,255,255,255),0.05);}',
      '.ts-tl-go{margin-left:auto;color:var(--text-4,#64748B);flex:none;font-size:1rem;}',
      '.ts-cam{background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-left:3px solid ' + gold + ';border-radius:10px;padding:12px 14px;}',
      '.ts-cam-yr{font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:' + gold + ';margin-bottom:9px;}',
      '.ts-cam-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}',
      '.ts-cam-v{font-size:0.98rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.ts-cam-v--up{color:#4ade80;}',
      '.ts-cam-l{font-size:0.68rem;color:var(--text-4,#64748B);margin-top:2px;}',
      '.ts-cam-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}',
      '.ts-cam-link{flex:1 1 auto;min-height:38px;border-radius:8px;font:700 0.76rem/1 inherit;cursor:pointer;color:' + gold + ';background:rgba(201,151,58,0.1);border:1px solid rgba(201,151,58,0.4);padding:9px 11px;}',
      '.ts-cam-link:hover{background:rgba(201,151,58,0.2);}',
      '@media (max-width:480px){ .ts-cam-grid{grid-template-columns:1fr 1fr;} .ts-cam-link{flex:1 1 100%;} }',
      '.ts-doc-sample{font-size:0.58rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-4,#64748B);border:1px dashed rgba(var(--line-rgb,255,255,255),0.28);border-radius:4px;padding:0 4px;margin-left:6px;flex:none;}',
      '.ts-ref-note{font-size:0.7rem;color:var(--text-4,#64748B);font-style:italic;margin-top:8px;line-height:1.5;}',
      '.ts-doc-cat{font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--text-4,#64748B);background:rgba(var(--line-rgb,255,255,255),0.06);border-radius:5px;padding:1px 5px;margin-left:7px;flex:none;}',
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
      // Spaces list (top-level tab)
      '.tsl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}',
      '.tsl-card{background:var(--theme-card,#0F1217);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:5px;}',
      '.tsl-name{font-size:0.95rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.tsl-meta{font-size:0.78rem;color:var(--text-3,#94A3B8);}',
      '.tsl-counts{font-size:0.74rem;color:var(--text-4,#64748B);}',
      '.tsl-counts--empty{font-style:italic;}',
      '.tsl-open{margin-top:8px;min-height:40px;border-radius:9px;font:800 0.82rem/1 inherit;cursor:pointer;color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';}',
      '.tsl-open:hover{filter:brightness(1.08);}',
      '@media (max-width:480px){',
      '  .ts-overlay{padding:10px 8px;}',
      '  .ts-tl-when{width:74px;}',
      '  .ts-doc-name{max-width:150px;}',
      '  .ts-photo img{width:64px;height:64px;}',
      '  .tsl-grid{grid-template-columns:1fr;}',
      '}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'ts-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  return { assemble: assemble, openSpace: openSpace, closeSpace: closeSpace, record: record, renderList: renderList };
})();
