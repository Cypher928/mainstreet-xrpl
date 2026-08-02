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
  function _fmtDate(ts) {
    // An absent or unparsable date renders as nothing, not "Invalid Date".
    // The lease chip has no `when` (assemble() attaches the document without a
    // date), and new Date(undefined).toLocaleDateString() returns the literal
    // string "Invalid Date" without throwing — so the catch never helped.
    if (ts == null || ts === '') return '';
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return ''; }
  }
  function _money(n) { try { return '$' + Math.round(Number(n)).toLocaleString('en-US'); } catch (_) { return '$' + n; } }

  // Scope events to a space. Matches on subject id and tenantId, and falls back
  // to the subject's recorded label (the space name). The label fallback makes
  // scoping resilient if a persisted property's tenant ids ever drift from the
  // events written against them — the events stay attached to the right space
  // instead of silently disappearing from it.
  function _scopedEvents(property, tenantId, tenantName) {
    return (property.timeline || [])
      .filter(function (e) {
        if (!e) return false;
        if (e.subject && e.subject.id === tenantId) return true;
        if (e.tenantId === tenantId) return true;
        if (tenantName && e.subject && e.subject.type === 'suite' && e.subject.label === tenantName) return true;
        return false;
      })
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
    var events = _scopedEvents(property, tenantId, t.tenant_name);
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

    // Disputes for this tenant — surfaced here so issues are discovered where a
    // manager looks; the dispute WORKFLOW stays in CAM (not duplicated).
    var disputes = (property.disputes || []).filter(function (d) {
      return d && (d.tenantId === tenantId || d.tenantName === t.tenant_name);
    }).sort(function (a, b) { return (new Date(b.timestamp || 0)) - (new Date(a.timestamp || 0)); });

    return {
      disputes: disputes,
      space: { id: tenantId, name: t.tenant_name || 'Space' },
      lease: lease, leaseDocs: leaseDocs, summary: summary,
      camYear: (camRec && camRec.camYear) || null, camResult: camResult,
      counts: { disputes: disputes.length, openDisputes: disputes.filter(function (d) { return d.status === 'open' || d.status === 'docs_requested'; }).length,
        events: events.length, photos: photos.length, invoices: invoices.length, warranties: warranties.length, documents: documents.length, notes: notes.length, cam: camEvents.length + (camResult ? 1 : 0) },
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

    // ── Disputes (surface only — the workflow lives in CAM) ─────────────────
    var _DSTAT = { open: 'Open', accepted: 'Accepted', rejected: 'Rejected', docs_requested: 'Docs requested' };
    var disputesHtml = (rec.disputes || []).length
      ? '<div class="ts-disputes">' + rec.disputes.slice(0, 5).map(function (d) {
          var st = _DSTAT[d.status] || d.status || 'Open';
          var isOpen = d.status === 'open' || d.status === 'docs_requested';
          var last = d.resolvedAt || d.timestamp;
          return '<button type="button" class="ts-disp" data-dispid="' + _esc(String(d.id)) + '" title="Open the dispute workspace">' +
            '<span class="ts-disp-st ts-disp-st--' + (isOpen ? 'open' : 'closed') + '">' + _esc(st) + '</span>' +
            '<span class="ts-disp-main">' +
              '<span class="ts-disp-t">' + _esc((d.vendor || 'Charge') + (d.category ? ' · ' + d.category : '')) + '</span>' +
              '<span class="ts-disp-w">Last activity ' + _esc(_fmtDate(last)) + '</span>' +
            '</span>' +
            (d.tenantShare != null ? '<span class="ts-disp-amt">' + _esc(_money(parseFloat(d.tenantShare))) + '</span>' : '') +
            '<span class="ts-tl-go">&#x203A;</span></button>';
        }).join('') + '</div>' +
        (rec.disputes.length > 5 ? '<div class="ts-empty">+ ' + (rec.disputes.length - 5) + ' more</div>' : '')
      : _empty('No disputes for this space.');

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
        // Everything about Suite 204 happens inside Suite 204. This is the only
        // way anything gets INTO a space record — before it, the panel could
        // show a maintenance history and a photo set it had no means of
        // accepting, which made the sample rows read as real ones.
        '<div class="ts-addbar">' +
          '<button class="ts-add-btn" id="tsAddBtn">\u2795&nbsp;Add Activity</button>' +
          '<div class="ts-add-hint">Photos, repairs, documents, notes \u2014 filed to this space.</div>' +
        '</div>' +
        '<div id="tsAddPanel" class="ts-add-panel" style="display:none"></div>' +
        '<div class="ts-body">' +
          _section('Lease', null, leaseHtml) +
          _section('Financial activity', rec.counts.cam + rec.counts.invoices, finHtml) +
          _section('Disputes', (rec.counts.disputes || 0), disputesHtml) +
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
    var _addBtn = _t('tsAddBtn');
    if (_addBtn) _addBtn.onclick = function () { _openAddPicker(tenantId); };
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
    // Disputes → the existing dispute workspace. The Space only surfaces them.
    ov.querySelectorAll('[data-dispid]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-dispid');
        closeSpace();
        try {
          if (typeof window.openDisputeWorkspace === 'function') { window.openDisputeWorkspace(isNaN(Number(id)) ? id : Number(id)); return; }
          if (window.switchWorkspaceTab) window.switchWorkspaceTab('cam');
          var el = document.getElementById('disputeSection');
          if (el && window._ccFlashEl) window._ccFlashEl(el);
        } catch (_e) {}
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
      // Add Activity — the way anything gets INTO a space record.
      '.ts-addbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 18px 4px;}',
      '.ts-add-btn{min-height:42px;padding:0 16px;border-radius:10px;font:800 0.86rem/1 inherit;cursor:pointer;',
      '  color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';}',
      '.ts-add-btn:hover{filter:brightness(1.08);}',
      '.ts-add-hint{font-size:0.76rem;color:rgba(255,255,255,0.5);}',
      '.ts-add-panel{padding:8px 18px 4px;}',
      '.ts-add-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}',
      '.ts-add-choice{display:flex;align-items:center;gap:8px;padding:11px 12px;border-radius:10px;cursor:pointer;',
      '  font:600 0.82rem/1.2 inherit;text-align:left;color:rgba(255,255,255,0.92);',
      '  background:rgba(255,255,255,0.04);border:1px solid rgba(var(--line-rgb,255,255,255),0.12);}',
      '.ts-add-choice:hover{background:rgba(255,255,255,0.08);border-color:' + gold + ';}',
      '.ts-add-ic{font-size:1rem;flex:0 0 auto;}',
      '.ts-add-form{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:12px;',
      '  background:rgba(255,255,255,0.03);border:1px solid rgba(var(--line-rgb,255,255,255),0.12);}',
      '.ts-add-head{font:800 0.9rem/1.2 inherit;color:#fff;margin-bottom:4px;}',
      '.ts-af-l{font-size:0.74rem;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-top:6px;}',
      '.ts-af-opt{text-transform:none;letter-spacing:0;color:rgba(255,255,255,0.35);}',
      '.ts-af-i{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;font:400 0.86rem/1.35 inherit;',
      '  color:#fff;background:rgba(0,0,0,0.28);border:1px solid rgba(var(--line-rgb,255,255,255),0.16);}',
      '.ts-af-i:focus{outline:none;border-color:' + gold + ';}',
      '.ts-af-ta{resize:vertical;min-height:44px;}',
      '.ts-af-file{padding:7px;font-size:0.78rem;}',
      '.ts-af-note{font-size:0.74rem;color:rgba(255,255,255,0.5);}',
      '.ts-af-err{font-size:0.78rem;color:#FFB4AE;background:rgba(255,120,110,0.08);',
      '  border:1px solid rgba(255,120,110,0.3);border-radius:8px;padding:8px 10px;}',
      '.ts-af-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;}',
      '.ts-af-cancel{padding:9px 14px;border-radius:8px;cursor:pointer;font:700 0.8rem/1 inherit;',
      '  color:rgba(255,255,255,0.75);background:transparent;border:1px solid rgba(var(--line-rgb,255,255,255),0.18);}',
      '.ts-af-save{padding:9px 16px;border-radius:8px;cursor:pointer;font:800 0.8rem/1 inherit;',
      '  color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';}',
      '.ts-af-save:disabled{opacity:0.6;cursor:default;}',
      '@media(max-width:560px){.ts-add-grid{grid-template-columns:1fr 1fr;}.ts-af-actions{flex-direction:column-reverse;}',
      '  .ts-af-cancel,.ts-af-save{width:100%;}}',
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
      '.ts-disputes{display:flex;flex-direction:column;gap:7px;}',
      '.ts-disp{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;cursor:pointer;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:9px;padding:9px 11px;}',
      '.ts-disp:hover{border-color:' + gold + ';}',
      '.ts-disp-st{font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;border-radius:5px;padding:2px 7px;flex:none;}',
      '.ts-disp-st--open{color:#fbbf24;background:rgba(251,191,36,0.14);border:1px solid rgba(251,191,36,0.35);}',
      '.ts-disp-st--closed{color:#4ade80;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.3);}',
      '.ts-disp-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
      '.ts-disp-t{font-size:0.82rem;color:var(--text-1,#E2E8F0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ts-disp-w{font-size:0.7rem;color:var(--text-4,#64748B);}',
      '.ts-disp-amt{font-size:0.82rem;font-weight:700;color:' + gold + ';flex:none;}',
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

  // ── Add Activity ──────────────────────────────────────────────────────────
  // A space's record IS its timeline: assemble() scopes property.timeline to the
  // tenant, and _attach(events, kind) files each event's attachments into the
  // Photos / Documents / Financial sections. So adding an activity is appending
  // one correctly-shaped timeline event — every section then updates itself,
  // with no separate stores to keep in sync.
  var ACTIVITY_TYPES = [
    { key: 'photos',      icon: '\u{1F4F7}', label: 'Add Photos',        kind: 'photo',    category: 'inspection',  accept: 'image/*',                multiple: true,
      titlePlaceholder: 'Move-out inspection', verb: 'Added photos' },
    { key: 'maintenance', icon: '\u{1F527}', label: 'Add Maintenance',   kind: 'document', category: 'maintenance', accept: 'image/*,application/pdf', multiple: true,
      titlePlaceholder: 'HVAC serviced by ABC Mechanical', verb: 'Added maintenance', cost: true, vendor: true, warranty: true },
    { key: 'document',    icon: '\u{1F4C4}', label: 'Upload Document',   kind: 'document', category: 'document',    accept: 'application/pdf,image/*,.doc,.docx', multiple: true,
      titlePlaceholder: 'Estoppel certificate', verb: 'Uploaded document' },
    { key: 'note',        icon: '\u{1F4DD}', label: 'Add Note',          kind: null,       category: 'note',        accept: null,                      multiple: false,
      titlePlaceholder: 'Tenant requested repaint before renewal', verb: 'Added note' },
    { key: 'invoice',     icon: '\u{1F4B0}', label: 'Add Vendor Invoice', kind: 'invoice', category: 'invoice',     accept: 'application/pdf,image/*', multiple: true,
      titlePlaceholder: 'ABC Mechanical \u2014 invoice 4417', verb: 'Added vendor invoice', cost: true, vendor: true },
    { key: 'damage',      icon: '\u{26A0}',  label: 'Report Damage',     kind: 'photo',    category: 'damage',      accept: 'image/*',                multiple: true,
      titlePlaceholder: 'Water damage \u2014 rear stockroom ceiling', verb: 'Reported damage', severity: 'warning', cost: true },
    { key: 'warranty',    icon: '\u{1F6E1}', label: 'Add Warranty',      kind: 'warranty', category: 'warranty',    accept: 'application/pdf,image/*', multiple: true,
      titlePlaceholder: 'Rooftop unit \u2014 5 year parts & labour', verb: 'Added warranty', vendor: true, warranty: true },
  ];

  function _typeByKey(k) { for (var i = 0; i < ACTIVITY_TYPES.length; i++) if (ACTIVITY_TYPES[i].key === k) return ACTIVITY_TYPES[i]; return null; }

  function _openAddPicker(tenantId) {
    var panel = _t('tsAddPanel');
    if (!panel) return;
    if (panel.style.display !== 'none' && panel.getAttribute('data-mode') === 'picker') { _closeAddPanel(); return; }
    panel.setAttribute('data-mode', 'picker');
    panel.style.display = 'block';
    panel.innerHTML =
      '<div class="ts-add-grid">' +
        ACTIVITY_TYPES.map(function (t) {
          return '<button class="ts-add-choice" data-act="' + t.key + '">' +
                   '<span class="ts-add-ic">' + t.icon + '</span>' + _esc(t.label) +
                 '</button>';
        }).join('') +
      '</div>';
    Array.prototype.forEach.call(panel.querySelectorAll('.ts-add-choice'), function (b) {
      b.onclick = function () { _openAddForm(tenantId, b.getAttribute('data-act')); };
    });
  }

  function _closeAddPanel() {
    var panel = _t('tsAddPanel');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; panel.removeAttribute('data-mode'); }
  }

  function _openAddForm(tenantId, key) {
    var t = _typeByKey(key); if (!t) return;
    var panel = _t('tsAddPanel'); if (!panel) return;
    panel.setAttribute('data-mode', 'form');
    panel.innerHTML =
      '<div class="ts-add-form" id="tsAddForm">' +
        '<div class="ts-add-head">' + t.icon + '&nbsp;' + _esc(t.label) + '</div>' +
        '<label class="ts-af-l" for="tsAfTitle">What happened</label>' +
        '<input class="ts-af-i" id="tsAfTitle" type="text" placeholder="' + _esc(t.titlePlaceholder) + '">' +
        '<label class="ts-af-l" for="tsAfDetail">Details <span class="ts-af-opt">optional</span></label>' +
        '<textarea class="ts-af-i ts-af-ta" id="tsAfDetail" rows="2"></textarea>' +
        (t.vendor ? '<label class="ts-af-l" for="tsAfVendor">Vendor <span class="ts-af-opt">optional</span></label>' +
                    '<input class="ts-af-i" id="tsAfVendor" type="text" placeholder="ABC Mechanical">' : '') +
        (t.cost ? '<label class="ts-af-l" for="tsAfCost">Cost <span class="ts-af-opt">optional</span></label>' +
                  '<input class="ts-af-i" id="tsAfCost" type="number" min="0" step="0.01" placeholder="480">' : '') +
        (t.warranty ? '<label class="ts-af-l" for="tsAfWarranty">Warranty expires <span class="ts-af-opt">optional</span></label>' +
                      '<input class="ts-af-i" id="tsAfWarranty" type="date">' : '') +
        (t.accept ? '<label class="ts-af-l" for="tsAfFiles">Attach <span class="ts-af-opt">' +
                      (t.key === 'photos' || t.key === 'damage' ? 'photos' : 'files') + '</span></label>' +
                    '<input class="ts-af-i ts-af-file" id="tsAfFiles" type="file" accept="' + t.accept + '"' +
                      (t.multiple ? ' multiple' : '') + '>' +
                    '<div class="ts-af-note" id="tsAfFileNote"></div>' : '') +
        '<div class="ts-af-err" id="tsAfErr" style="display:none"></div>' +
        '<div class="ts-af-actions">' +
          '<button class="ts-af-cancel" id="tsAfCancel">Cancel</button>' +
          '<button class="ts-af-save" id="tsAfSave">Save to this space</button>' +
        '</div>' +
      '</div>';
    var files = _t('tsAfFiles');
    if (files) files.onchange = function () {
      var n = files.files ? files.files.length : 0;
      var note = _t('tsAfFileNote');
      if (note) note.textContent = n ? (n + (n === 1 ? ' file selected' : ' files selected')) : '';
    };
    _t('tsAfCancel').onclick = function () { _openAddPicker(tenantId); };
    _t('tsAfSave').onclick   = function () { _submitActivity(tenantId, key); };
    var ti = _t('tsAfTitle'); if (ti) ti.focus();
  }

  // Files are read to data URLs so a pilot user's photos survive a reload with no
  // storage bucket wired up. Capped, because properties.data is a JSON blob and a
  // 12-megapixel photo would bloat every subsequent save of the whole property.
  var MAX_INLINE_BYTES = 1200000;
  function _readFiles(list) {
    var out = [], arr = Array.prototype.slice.call(list || []);
    if (!arr.length) return Promise.resolve(out);
    return Promise.all(arr.map(function (f) {
      return new Promise(function (resolve) {
        var base = { name: f.name, size: f.size, mime: f.type || '' };
        if (f.size > MAX_INLINE_BYTES) { out.push(Object.assign(base, { url: null, oversize: true })); return resolve(); }
        var fr = new FileReader();
        fr.onload  = function () { out.push(Object.assign(base, { url: String(fr.result) })); resolve(); };
        fr.onerror = function () { out.push(Object.assign(base, { url: null, unreadable: true })); resolve(); };
        fr.readAsDataURL(f);
      });
    })).then(function () { return out; });
  }

  function _submitActivity(tenantId, key) {
    var t = _typeByKey(key); if (!t) return;
    var errEl  = _t('tsAfErr');
    var saveBtn = _t('tsAfSave');
    var title  = (_t('tsAfTitle') || {}).value || '';
    var detail = (_t('tsAfDetail') || {}).value || '';
    var vendor = (_t('tsAfVendor') || {}).value || '';
    var cost   = (_t('tsAfCost') || {}).value || '';
    var warr   = (_t('tsAfWarranty') || {}).value || '';
    var fileEl = _t('tsAfFiles');
    var picked = fileEl && fileEl.files ? fileEl.files : [];

    var fail = function (msg) {
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save to this space'; }
    };
    // Something must actually be recorded — an empty event is not memory.
    if (!title.trim() && !picked.length) return fail('Describe what happened, or attach at least one file.');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026'; }
    if (errEl) errEl.style.display = 'none';

    var property = window.currentProperty && window.currentProperty();
    if (!property) return fail('No property is open — reopen the space and try again.');

    _readFiles(picked).then(function (files) {
      var attachments = files.map(function (f) {
        return { name: f.name, url: f.url, kind: t.kind || 'document', size: f.size, mime: f.mime,
                 oversize: !!f.oversize, unreadable: !!f.unreadable };
      });
      var meta = {};
      if (vendor.trim()) meta.vendor = vendor.trim();
      if (cost !== '' && !isNaN(Number(cost))) meta.costUsd = Number(cost);
      if (warr) meta.warrantyExpires = warr;
      if (attachments.length) meta.fileCount = attachments.length;

      var headline = title.trim() || (attachments.length + ' file' + (attachments.length === 1 ? '' : 's') + ' attached');
      var bits = [];
      if (meta.vendor) bits.push(meta.vendor);
      if (meta.costUsd != null) bits.push(_money(meta.costUsd));
      if (meta.warrantyExpires) bits.push('warranty to ' + meta.warrantyExpires);
      if (attachments.length) bits.push(attachments.length + (attachments.length === 1 ? ' file' : ' files'));

      var evt = {
        type: 'space_' + t.key,
        severity: t.severity || 'info',
        actor: 'Property Manager',
        manual: true,
        category: t.category,
        tenantId: tenantId,
        subject: { type: 'suite', id: tenantId, label: (_openRec && _openRec.space && _openRec.space.name) || '' },
        title: t.verb + ' \u2014 ' + headline,
        description: [detail.trim(), bits.join(' \u00B7 ')].filter(Boolean).join(' \u2014 '),
        metadata: meta,
        attachments: attachments,
      };

      try {
        window.appendPropertyTimelineEvent(property, evt);
      } catch (e) {
        return fail('Could not record that: ' + (e && e.message ? e.message : 'unknown error'));
      }

      var done = function () {
        // Re-open the space so Timeline, Maintenance, Photos and Documents all
        // re-assemble from the event that was just written.
        closeSpace();
        openSpace(tenantId);
        if (window.showToast) window.showToast(t.verb + ' to ' + ((_openRec && _openRec.space && _openRec.space.name) || 'this space'));
      };
      var saved = window.saveProperty ? window.saveProperty(property) : null;
      if (saved && typeof saved.then === 'function') {
        saved.then(done).catch(function (e) {
          // The event is already on the in-memory record; say the persistence failed.
          done();
          if (window.showToast) window.showToast('Recorded, but saving to the server failed: ' + (e && e.message ? e.message : 'unknown error') + ' \u2014 it may not survive a reload.',
            { color: '#92400e', textColor: '#fef3c7', duration: 8000 });
        });
      } else { done(); }
    }).catch(function (e) { fail('Could not read those files: ' + (e && e.message ? e.message : 'unknown error')); });
  }

  return { assemble: assemble, openSpace: openSpace, closeSpace: closeSpace, record: record, renderList: renderList,
           addActivity: _openAddPicker, activityTypes: function () { return ACTIVITY_TYPES.slice(); } };
})();
