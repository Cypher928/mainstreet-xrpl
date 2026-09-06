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
    // S1 — NO IDENTITY, NO RECORD.
    //
    // `e.tenantId === tenantId` is true when BOTH are undefined, and every
    // property-wide event (lease uploaded, CAM reconciled, settlement) has no
    // tenantId. So a tenant whose id has not been assigned yet — freshly
    // extracted, before resyncTenantsToTable runs — used to scope in the whole
    // building's history as if it had happened in that suite. Counts, summary
    // and citability all became the property's, and a draft would quote them
    // back as the tenant's own record.
    //
    // Refusing to scope without an identity is the only safe answer: an empty
    // record is recoverable, a wrong one reaches a tenant.
    if (tenantId == null || tenantId === '') return [];

    // S2 — the label fallback must not fire on a duplicated name.
    //
    // The fallback exists so events survive if tenant ids ever drift. But
    // "Vacant" is the most common tenant name in a real rent roll, and a chain
    // occupying two suites is routine — so matching on label alone made two
    // spaces share each other's records. Trade: keep the resilience only where
    // the name identifies exactly one space.
    var nameIsUnique = false;
    if (tenantName) {
      var sameName = (property.tenants || []).filter(function (x) {
        return x && x.tenant_name === tenantName;
      }).length;
      nameIsUnique = sameName <= 1;
    }

    return (property.timeline || [])
      .filter(function (e) {
        if (!e) return false;
        if (e.subject && e.subject.id != null && e.subject.id === tenantId) return true;
        if (e.tenantId != null && e.tenantId === tenantId) return true;
        if (nameIsUnique && e.subject && e.subject.type === 'suite' && e.subject.label === tenantName) return true;
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
    // Surfaced rather than swallowed: a space with no id shows nothing, and the
    // view has to be able to explain why instead of looking like an empty one.
    var noIdentity = (tenantId == null || tenantId === '');
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
      noIdentity: noIdentity,
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
  // Has a human actually put something in this space? Manual timeline events and
  // any real attachment both count; seeded/derived system events do not, or a
  // brand-new space would look "live" purely because the app logged its own
  // creation.
  // A draft is only as good as what it can cite. With an empty record the strict
  // prompt behind this correctly returns "insufficient" — so offering the button
  // produces a refusal, which reads as the feature being broken. Better to say
  // why it is not available yet, which also teaches what the record is for.
  function _citableRecord(rec) {
    if (!rec) return { ok: false, why: 'This space has no record yet.' };
    if (rec.noIdentity) return { ok: false,
      why: 'This space has no identifier yet \u2014 finish saving the tenant, then its record can be cited.' };
    var lease = rec.lease || {};
    var hasLease = !!(lease.type || lease.sqft || lease.start || lease.end || lease.cap != null);

    // S7 — ONE predicate. This used to count `rec.events.length > 0`, which is
    // true of a system-generated event like "lease uploaded", directly against
    // the comment above saying seeded/derived events must not count.
    // _hasRealActivity already draws the line correctly (manual === true, or a
    // real attachment); two predicates for one question is how they disagree.
    //
    // Two things _hasRealActivity does not cover are genuinely citable and are
    // added explicitly: a completed CAM allocation, and the lease document
    // itself on file.
    var hasCam  = !!rec.camResult;
    var hasLeaseDoc = (rec.leaseDocs || []).length > 0;
    if (_hasRealActivity(rec) || hasCam || hasLeaseDoc) return { ok: true };
    if (hasLease) return { ok: false,
      why: 'Only the lease terms are on file. Record something that happened here \u2014 a repair, a note, a document \u2014 and a draft can cite it.' };
    return { ok: false,
      why: 'Nothing is recorded for this space yet. Drafts quote the record, so there is nothing to write from.' };
  }

  function _hasRealActivity(rec) {
    if (!rec) return false;
    var ev = rec.events || [];
    for (var i = 0; i < ev.length; i++) {
      if (ev[i] && ev[i].manual === true) return true;
      if (ev[i] && (ev[i].attachments || []).length) return true;
    }
    return (rec.photos || []).length > 0 || (rec.documents || []).length > 0 ||
           (rec.notes || []).length > 0  || (rec.invoices || []).length > 0 ||
           (rec.warranties || []).length > 0;
  }

  // SEC-1 — a chip may point at either kind of attachment, and they open
  // differently.
  //
  // Activity attachments are inlined base64 data: URLs (see
  // docs/BACKLOG_ATTACHMENT_STORAGE.md) and open directly. A lease document is
  // an object in the now-private leases bucket, and its stored URL does not
  // resolve on its own — it has to be exchanged for a signed one first.
  //
  // A bare <a href> could only ever serve the first case. Anything in storage
  // goes through DocViewer, which resolves before opening and reports it when
  // it cannot.
  // Delegates to the app-wide definition so there is one answer to "is this a
  // stored object?", not two that can drift.
  function _isStoredObject(url) {
    return window.isStoredDocumentRef ? window.isStoredDocumentRef(url)
      : (typeof url === 'string' && (/\/storage\/v1\/object\//.test(url) || /^(leases|invoices)\//.test(url)));
  }

  // SEC-1 — one renderer for every document chip in the app.
  //
  // This used to build its own <a href>/<button> pair and its own delegated
  // handler. That was the fourth place to grow a private copy of the same
  // decision, and the copies kept diverging — which is how the AI evidence
  // chips shipped a raw href that 404'd. docLinkHtml() is the single answer.
  function _attachChip(a, icon) {
    var inner = icon + '&nbsp;<span class="ts-doc-name">' + _esc(a.name) + '</span>' +
      '<span class="ts-doc-when">' + _esc(_fmtDate(a.when)) + '</span>';
    return window.docLinkHtml
      ? window.docLinkHtml(a.url, inner, { className: 'ts-doc', title: a.name })
      : '<span class="ts-doc">' + inner + '</span>';
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
          (leaseDocsHtml || '<div class="ts-empty" style="margin-top:6px">Lease terms are on file but the document is not \u2014 upload the executed lease so every CAM figure can cite the clause it came from.</div>') +
        '</div>'
      : _empty('No lease document on file. Upload the executed lease and any amendments so every CAM figure can cite its source.');

    var timelineHtml = rec.events.length
      ? '<div class="ts-timeline">' + rec.events.slice(0, 12).map(function (e) {
          var d = (window.PropertyTimeline && PropertyTimeline.describe) ? PropertyTimeline.describe(e) : { label: e.type, icon: null };
          // Every entry opens the record that created it.
          return '<button type="button" class="ts-tl-row ts-tl-row--click" data-tlid="' + _esc(e.id) + '" title="Open this record">' +
            '<span class="ts-tl-when">' + _esc(_fmtDate(e.timestamp)) + '</span>' +
            '<span class="ts-tl-badge">' + _esc(d.label) + '</span>' +
            '<span class="ts-tl-title">' + _esc(e.title) +
              // Provenance, shown rather than merely stored: a verified memory
              // that cannot say who recorded an entry is not verified.
              (function () {
                var by  = (e.metadata && e.metadata.recordedBy) || e.actor;
                var via = (e.metadata && e.metadata.recordedVia) ||
                          (e.source ? (e.source.charAt(0).toUpperCase() + e.source.slice(1)) : null) ||
                          (e.manual ? 'Manual' : 'System');
                if (!by) return '';
                return '<span class="ts-prov">' + _esc(by) + ' \u00B7 ' + _esc(via) + '</span>';
              })() +
            '</span>' +
            '<span class="ts-tl-go">&#x203A;</span></button>';
        }).join('') + (rec.events.length > 12 ? '<div class="ts-empty">+ ' + (rec.events.length - 12) + ' earlier</div>' : '') + '</div>'
      : _empty('Nothing recorded yet. Every repair, photo, note and document you add appears here as a dated record of what happened in this suite.');

    var photosHtml = rec.photos.length
      ? '<div class="ts-photos">' + rec.photos.map(function (a) {
          // SEC-1 — Add Activity inlines photos as data: URLs, but Property OS
          // uploads them to storage. Both land here.
          return window.docLinkHtml
            ? window.docLinkHtml(a.url, window.docImageHtml(a.url, a.name), { className: 'ts-photo', title: a.name })
            : '<span class="ts-photo"></span>';
        }).join('') + '</div>'
      : _empty('No photos yet. Move-in and move-out condition, damage, and completed repairs \u2014 photographed here, they stay attached to this suite.');
    var invHtml = rec.invoices.length ? '<div class="ts-docs">' + rec.invoices.map(function (a) { return _attachChip(a, '\u{1F9FE}'); }).join('') + '</div>' : _empty('No vendor invoices yet. Add the bills for work done in this suite so the cost history sits with the space it belongs to.');
    var warrHtml = rec.warranties.length ? '<div class="ts-docs">' + rec.warranties.map(function (a) { return _attachChip(a, '\u{1F6E1}\u{FE0F}'); }).join('') + '</div>' : _empty('No warranties on file. Record equipment and workmanship warranties with their expiry, so a future repair can be checked against them first.');
    var docHtml = rec.documents.length ? '<div class="ts-docs">' + rec.documents.map(function (a) { return _attachChip(a, '\u{1F4C4}'); }).join('') + '</div>' : _empty('No documents yet. Inspection reports, correspondence, certificates of insurance \u2014 anything about this tenant that is not the lease itself.');
    var notesHtml = rec.notes.length
      ? '<div class="ts-notes">' + rec.notes.map(function (e) { return '<div class="ts-note"><div class="ts-note-t">' + _esc(e.title) + '</div>' + (e.description ? '<div class="ts-note-d">' + _esc(e.description) + '</div>' : '') + '<div class="ts-note-w">' + _esc(_fmtDate(e.timestamp)) + '</div></div>'; }).join('') + '</div>'
      : _empty('No notes yet. Conversations, requests and decisions \u2014 written down here they survive staff turnover.');
    var camResultHtml = '';
    if (rec.camResult) {
      var cr = rec.camResult;
      var alloc = cr.allocatedAmount != null ? cr.allocatedAmount : cr.totalAllocated;
      // H — NO RE-DERIVATION HERE. This used to fall back to
      // `cr.actualCam - cr.expectedCam` whenever a stored variance was absent.
      // expectedCam was the cap PERCENTAGE, so the fallback rebuilt the
      // dollars-minus-percent figure client-side and printed it as this space's
      // "Variance" — reviving the defect for exactly the older records that had
      // escaped it. A variance is now either persisted with its expected amount
      // or it is not a number this tile is entitled to invent: it shows "—".
      var vari = (cr.variance != null) ? cr.variance : null;
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
    var finHtml = (camHtml || invHtml !== _empty('No vendor invoices yet. Add the bills for work done in this suite so the cost history sits with the space it belongs to.'))
      ? (camHtml || '') + (rec.invoices.length ? '<div class="ts-lbl">Invoices</div>' + invHtml : '')
      : '';
    if (!finHtml) finHtml = _empty('No CAM activity yet. Once a reconciliation runs, this space\u2019s allocation, variance and statement appear here.');

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
    if (!maintHtml) maintHtml = _empty('No maintenance recorded yet. Record repairs, inspections, vendor work and warranties here \u2014 with cost, vendor and the invoice attached.');

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
      : _empty('No disputes. If this tenant challenges a CAM charge, the dispute and its evidence will be tracked here.');

    // ── Documents & notes ────────────────────────────────────────────────────
    // Demo spaces show the document set a real suite would keep on file
    // (lease, amendments, estoppel, COIs, CAM backup, notices, photos).
    var refAll = [];
    try {
      var _pr = window.PropertyReference;
      var _t2 = (property.tenants || []).find(function (x) { return x && x.id === tenantId; });
      // Demo mode ends the moment this space has a real record of its own.
      // Showing sample rows beside genuine ones asks a property manager to tell
      // demonstration data from their own building at a glance, which nobody
      // should have to do — and the sample rows carry no file behind them.
      if (_pr && _t2 && !_hasRealActivity(rec)) refAll = _pr.spaceDocumentsFor(property, _t2);
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
    if (!docNotesHtml) docNotesHtml = _empty('No documents or notes yet. Upload repair invoices, warranty certificates, inspection reports and correspondence \u2014 or write a note about what was agreed.');
    if (refDocs.length) docNotesHtml += '<div class="ts-ref-note">Sample records show the documents this space would keep on file \u2014 they disappear as soon as you add anything real.</div>';

    // Merge reference photos into the Photos section.
    if (refPhotos.length) {
      photosHtml = (rec.photos.length ? photosHtml : '') +
        '<div class="ts-docs">' + refPhotos.map(_refRow).join('') + '</div>';
    }
    // Counts must match what is actually on screen.
    var docCount   = rec.counts.documents + rec.counts.notes + refDocs.length;
    var photoCount = rec.counts.photos + refPhotos.length;

    var _draftable = _citableRecord(rec);

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
          '<div class="ts-add-hint">Record something that happened in ' +
            _esc(rec.space.name || 'this suite') + '.</div>' +
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
        // The counterpart to Add Activity, and deliberately quieter than it.
        // Add Activity WRITES to the verified record; this READS from it. One
        // primary per screen, and on a Space that primary is recording what
        // happened — this is the payoff for having done so.
        '<div class="ts-actbar">' +
          '<button class="ts-act-btn" id="tsActBtn"' + (_draftable.ok ? '' : ' disabled') + '>' +
            '\u{270D}\u{FE0F}&nbsp;Draft from this record</button>' +
          '<div class="ts-act-hint">' +
            _esc(_draftable.ok
              ? 'Every draft quotes this space\u2019s own record and cites what it used.'
              : _draftable.why) +
          '</div></div>' +
        '<div id="tsActions" class="ts-actions"></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSpace(); });
    _t('tsClose').onclick = closeSpace;
    var _addBtn = _t('tsAddBtn');
    if (_addBtn) _addBtn.onclick = function () { _openAddPicker(tenantId); };
    var _ab = _t('tsActBtn');
    if (_ab && !_ab.disabled) _ab.onclick = function () { if (window.SpaceActions) window.SpaceActions.open(); };

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
        if (!ev) return;
        // An activity someone recorded is a living record — it opens for
        // continuing, not just for reading. Derived and system events keep the
        // document viewer, which is the right destination for them.
        if (ev.manual === true) { openActivity(rec.space.id, ev.id); return; }
        if (!window.DocViewer) return;
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
      '.ts-panel{width:100%;max-width:640px;margin:auto;background:var(--theme-bg,#07090C);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,0.6);overflow:visible;}',
      '.ts-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px;background:var(--theme-card,#0F1217);border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.08);}',
      '.ts-space-name{font-size:1.08rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.ts-space-sub{font-size:0.76rem;color:var(--text-3,#94A3B8);margin-top:2px;}',
      '.ts-x{margin-left:auto;background:none;border:none;color:var(--text-3,#94A3B8);font-size:1.1rem;cursor:pointer;padding:4px 8px;min-height:34px;}',
      '.ts-summary{padding:11px 18px;font-size:0.82rem;color:var(--text-2,#CBD5E1);background:rgba(201,151,58,0.06);border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.06);}',
      // Add Activity — the way anything gets INTO a space record.
      // Sticky: a space is scrolled through, and the one control that puts
      // anything INTO it was only reachable from the top. Recording something
      // should never require scrolling back to where you started.
      '.ts-addbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 18px 10px;',
      '  position:sticky;top:0;z-index:6;background:var(--theme-bg,#07090C);',
      '  border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.08);}',
      '.ts-add-panel{position:sticky;top:58px;z-index:5;background:var(--theme-bg,#07090C);}',
      '.ts-add-btn{min-height:42px;padding:0 16px;border-radius:10px;font:800 0.86rem/1 inherit;cursor:pointer;',
      '  color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';}',
      '.ts-add-btn:hover{filter:brightness(1.08);}',
      '.ts-add-hint{font-size:0.76rem;color:rgba(255,255,255,0.5);}',
      '.ts-add-panel{padding:8px 18px 10px;}',
      '.ts-add-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}',
      '.ts-add-choice{display:flex;align-items:center;gap:8px;padding:11px 12px;border-radius:10px;cursor:pointer;',
      '  font:600 0.82rem/1.2 inherit;text-align:left;color:rgba(255,255,255,0.92);',
      '  background:rgba(255,255,255,0.04);border:1px solid rgba(var(--line-rgb,255,255,255),0.12);}',
      '.ts-add-choice:hover{background:rgba(255,255,255,0.08);border-color:' + gold + ';}',
      '.ts-add-ic{font-size:1rem;flex:0 0 auto;}',
      '.ts-add-lead{font:700 0.84rem/1.3 inherit;color:rgba(255,255,255,0.82);margin:2px 0 8px;}',
      '.ts-add-sub{font-size:0.76rem;line-height:1.45;color:rgba(255,255,255,0.55);margin:-2px 0 4px;}',
      '.ts-add-sub b{color:rgba(255,255,255,0.85);}',
      '.ts-prov{font-size:0.72rem;color:rgba(255,255,255,0.42);margin-top:3px;}',
      // Living record view
      '.ts-act-rec{padding:12px;border-radius:12px;background:rgba(255,255,255,0.03);',
      '  border:1px solid rgba(var(--line-rgb,255,255,255),0.12);}',
      '.ts-ar-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
      '.ts-ar-title{font:800 0.95rem/1.3 inherit;color:#fff;flex:1 1 auto;min-width:0;}',
      '.ts-ar-status{font:700 0.7rem/1 inherit;padding:5px 9px;border-radius:999px;white-space:nowrap;}',
      '.ts-ar-status--open{background:rgba(234,179,8,0.14);color:#fde68a;border:1px solid rgba(234,179,8,0.35);}',
      '.ts-ar-status--in_progress{background:rgba(59,130,246,0.14);color:#bfdbfe;border:1px solid rgba(59,130,246,0.35);}',
      '.ts-ar-status--complete{background:rgba(52,211,153,0.14);color:#a7f3d0;border:1px solid rgba(52,211,153,0.35);}',
      '.ts-ar-desc{font-size:0.83rem;line-height:1.5;color:rgba(255,255,255,0.78);margin-top:6px;}',
      '.ts-ar-meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:0.76rem;color:rgba(255,255,255,0.55);}',
      '.ts-ar-meta b{color:rgba(255,255,255,0.85);}',
      '.ts-ar-sec{margin-top:14px;font:700 0.74rem/1 inherit;letter-spacing:0.05em;text-transform:uppercase;',
      '  color:rgba(255,255,255,0.5);display:flex;align-items:center;gap:8px;}',
      '.ts-ar-n{font-size:0.7rem;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,0.08);}',
      '.ts-ar-hist{cursor:pointer;user-select:none;}',
      '.ts-ar-hist:hover{color:rgba(255,255,255,0.8);}',
      '.ts-ar-acts{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px;}',
      '.ts-ar-btn{padding:8px 12px;border-radius:8px;cursor:pointer;font:700 0.76rem/1 inherit;',
      '  color:rgba(255,255,255,0.86);background:rgba(255,255,255,0.05);',
      '  border:1px solid rgba(var(--line-rgb,255,255,255),0.14);}',
      '.ts-ar-btn:hover{background:rgba(255,255,255,0.1);}',
      '.ts-ar-btn--go{background:' + gold + ';color:#07090C;border-color:' + gold + ';}',
      '.ts-ar-revs{margin-top:8px;display:flex;flex-direction:column;gap:6px;}',
      '.ts-rev{font-size:0.76rem;color:rgba(255,255,255,0.62);padding:7px 9px;border-radius:8px;',
      '  background:rgba(255,255,255,0.03);border-left:2px solid rgba(var(--line-rgb,255,255,255),0.2);}',
      '.ts-rev-w{color:rgba(255,255,255,0.42);margin-right:8px;}',
      '.ts-rev-note{margin-top:4px;color:rgba(255,255,255,0.8);font-style:italic;}',
      '.ts-ar-back{margin-top:12px;}',
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
      // Secondary on purpose: two gold primaries made Add Activity and this look
      // like alternatives rather than opposites.
      '.ts-act-btn{width:100%;min-height:44px;border-radius:10px;font:700 0.86rem/1 inherit;cursor:pointer;',
      '  color:rgba(255,255,255,0.9);background:rgba(255,255,255,0.05);',
      '  border:1px solid rgba(var(--line-rgb,255,255,255),0.18);}',
      '.ts-act-btn:hover:not(:disabled){background:rgba(255,255,255,0.1);border-color:' + gold + ';}',
      '.ts-act-btn:disabled{opacity:0.45;cursor:not-allowed;}',
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

  // ── Living records ────────────────────────────────────────────────────────
  // An activity is not a log line. A roof repair is reported, a vendor is
  // assigned, photos arrive, an invoice lands, a warranty is filed, it goes in
  // progress, it completes, it reopens. All of that is ONE repair — "the roof
  // repair we did last September" — not six unrelated records.
  //
  // So amendments APPEND. The event carries its current, easily-read values and
  // a revisions[] log of how it got them: what changed, from what, to what, by
  // whom, when. Nothing is overwritten without leaving a trace, which is the
  // whole claim behind "verified memory". revisions[0] is the creation snapshot,
  // so the original record is always recoverable.
  var STATUS_FLOW = ['open', 'in_progress', 'complete'];
  var STATUS_LABEL = { open: 'Open', in_progress: 'In progress', complete: 'Complete' };
  // Status belongs on work. A note or a document is not work and does not get one.
  function _hasStatus(ev) { return /^space_(maintenance|damage)$/.test(ev && ev.type || ''); }

  function _who() {
    try {
      var u = window.AuthService && window.AuthService.getCurrentUser && window.AuthService.getCurrentUser();
      if (u && (u.name || u.email)) return u.name || u.email;
    } catch (_e) {}
    return 'Property Manager';
  }

  function _findEvent(eventId) {
    var prop = window.currentProperty && window.currentProperty();
    if (!prop) return null;
    return (prop.timeline || []).find(function (e) { return String(e.id) === String(eventId); }) || null;
  }

  // Every amendment goes through here, so nothing can change without a record.
  function _amend(ev, changes, note, added) {
    if (!Array.isArray(ev.revisions) || !ev.revisions.length) {
      // First amendment: capture what the record looked like when created, so
      // the original survives even though the current values move on.
      ev.revisions = [{
        at: ev.timestamp, by: (ev.metadata && ev.metadata.recordedBy) || ev.actor || 'Unknown',
        via: (ev.metadata && ev.metadata.recordedVia) || 'Manual', action: 'created',
        snapshot: { title: ev.title, description: ev.description,
                    status: ev.status || null, metadata: Object.assign({}, ev.metadata || {}) },
      }];
    }
    var rev = { at: new Date().toISOString(), by: _who(), via: 'Manual', action: 'amended', changes: [] };
    Object.keys(changes || {}).forEach(function (k) {
      var from = k === 'status' ? (ev.status || null)
               : (k === 'title' || k === 'description') ? ev[k]
               : (ev.metadata || {})[k];
      var to = changes[k];
      if (String(from == null ? '' : from) === String(to == null ? '' : to)) return;
      rev.changes.push({ field: k, from: from == null ? null : from, to: to });
      if (k === 'status') ev.status = to;
      else if (k === 'title' || k === 'description') ev[k] = to;
      else { ev.metadata = ev.metadata || {}; ev.metadata[k] = to; }
    });
    if (note && note.trim()) rev.note = note.trim();
    if (added && added.length) {
      ev.attachments = (ev.attachments || []).concat(added);
      rev.added = added.map(function (a) { return { name: a.name, kind: a.kind }; });
    }
    if (!rev.changes.length && !rev.note && !rev.added) return false;  // nothing happened
    ev.revisions.push(rev);
    return true;
  }

  function _revLine(r) {
    var when = _fmtDate(r.at);
    if (r.action === 'created') return '<div class="ts-rev"><span class="ts-rev-w">' + _esc(when) + '</span>' +
      '<span class="ts-rev-t">Recorded by ' + _esc(r.by) + '</span></div>';
    var parts = (r.changes || []).map(function (c) {
      var label = c.field === 'status' ? 'Status' : c.field.charAt(0).toUpperCase() + c.field.slice(1);
      if (c.field === 'status') return label + ': ' + _esc(STATUS_LABEL[c.from] || c.from || 'none') +
        ' → ' + _esc(STATUS_LABEL[c.to] || c.to);
      return label + ' changed';
    });
    if (r.added && r.added.length) parts.push(r.added.length + ' file' + (r.added.length === 1 ? '' : 's') + ' added');
    if (r.note) parts.push('note added');
    return '<div class="ts-rev"><span class="ts-rev-w">' + _esc(when) + '</span>' +
      '<span class="ts-rev-t">' + _esc(parts.join(' · ') || 'updated') + ' — ' + _esc(r.by) + '</span>' +
      (r.note ? '<div class="ts-rev-note">' + _esc(r.note) + '</div>' : '') + '</div>';
  }

  function openActivity(tenantId, eventId) {
    var ev = _findEvent(eventId); if (!ev) return;
    var host = _t('tsAddPanel'); if (!host) return;
    var st = ev.status || (_hasStatus(ev) ? 'open' : null);
    var m = ev.metadata || {};
    var atts = ev.attachments || [];
    var revs = ev.revisions || [];

    host.setAttribute('data-mode', 'activity');
    host.style.display = 'block';
    host.innerHTML =
      '<div class="ts-act-rec">' +
        '<div class="ts-ar-head">' +
          '<div class="ts-ar-title">' + _esc(ev.title || 'Activity') + '</div>' +
          (st ? '<span class="ts-ar-status ts-ar-status--' + _esc(st) + '">' + _esc(STATUS_LABEL[st] || st) + '</span>' : '') +
        '</div>' +
        (ev.description ? '<div class="ts-ar-desc">' + _esc(ev.description) + '</div>' : '') +
        '<div class="ts-ar-meta">' +
          (m.vendor ? '<span>Vendor: <b>' + _esc(m.vendor) + '</b></span>' : '') +
          (m.costUsd != null ? '<span>Cost: <b>' + _esc(_money(m.costUsd)) + '</b></span>' : '') +
          (m.warrantyExpires ? '<span>Warranty to: <b>' + _esc(m.warrantyExpires) + '</b></span>' : '') +
          '<span>Recorded by <b>' + _esc(m.recordedBy || ev.actor || 'Unknown') + '</b> · ' + _esc(_fmtDate(ev.timestamp)) + '</span>' +
        '</div>' +
        // Related Items: everything filed against THIS activity, in one place.
        // The roof repair, not the invoice and the photo and the warranty.
        '<div class="ts-ar-sec">Related items <span class="ts-ar-n">' + atts.length + '</span></div>' +
        (atts.length
          ? '<div class="ts-docs">' + atts.map(function (a) { return _attachChip(a, a.kind === 'photo' ? '\u{1F5BC}\u{FE0F}' : (a.kind === 'invoice' ? '\u{1F9FE}' : '\u{1F4C4}')); }).join('') + '</div>'
          : '<div class="ts-empty">Nothing attached yet. Photos, the invoice and the warranty for this job all belong here, on the job — not scattered across the space.</div>') +
        '<div class="ts-ar-acts">' +
          '<button class="ts-ar-btn" data-amend="note">\u{1F4DD} Follow-up note</button>' +
          '<button class="ts-ar-btn" data-amend="photos">\u{1F4F7} Add photos</button>' +
          '<button class="ts-ar-btn" data-amend="files">\u{1F4C4} Attach document or invoice</button>' +
          '<button class="ts-ar-btn" data-amend="edit">✏️ Edit details</button>' +
          (st === 'open'        ? '<button class="ts-ar-btn ts-ar-btn--go" data-status="in_progress">Mark in progress</button>' : '') +
          (st === 'in_progress' ? '<button class="ts-ar-btn ts-ar-btn--go" data-status="complete">Mark complete</button>' : '') +
          (st === 'complete'    ? '<button class="ts-ar-btn" data-status="open">Reopen</button>' : '') +
        '</div>' +
        '<div id="tsArForm"></div>' +
        '<div class="ts-ar-sec ts-ar-hist" id="tsArHistToggle">History <span class="ts-ar-n">' + revs.length + '</span> <span class="ts-ar-chev">▾</span></div>' +
        '<div id="tsArHist" class="ts-ar-revs" style="display:none">' +
          (revs.length ? revs.slice().reverse().map(_revLine).join('')
                       : '<div class="ts-empty">No changes yet — this is the record as first entered.</div>') +
        '</div>' +
        '<div class="ts-ar-back"><button class="ts-af-cancel" id="tsArBack">‹ Back to the space</button></div>' +
      '</div>';

    var hist = _t('tsArHist'), tog = _t('tsArHistToggle');
    if (tog) tog.onclick = function () { hist.style.display = hist.style.display === 'none' ? 'block' : 'none'; };
    _t('tsArBack').onclick = function () { _closeAddPanel(); };
    host.querySelectorAll('[data-status]').forEach(function (b) {
      b.onclick = function () { _applyAmend(tenantId, eventId, { status: b.getAttribute('data-status') }, null, []); };
    });
    host.querySelectorAll('[data-amend]').forEach(function (b) {
      b.onclick = function () { _amendForm(tenantId, eventId, b.getAttribute('data-amend')); };
    });
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _amendForm(tenantId, eventId, mode) {
    var ev = _findEvent(eventId); if (!ev) return;
    var slot = _t('tsArForm'); if (!slot) return;
    var m = ev.metadata || {};
    var isEdit = mode === 'edit';
    slot.innerHTML =
      '<div class="ts-add-form">' +
        '<div class="ts-add-head">' +
          (isEdit ? '✏️ Edit details' : mode === 'note' ? '\u{1F4DD} Follow-up note'
            : mode === 'photos' ? '\u{1F4F7} Add photos' : '\u{1F4C4} Attach document or invoice') + '</div>' +
        '<div class="ts-add-sub">Nothing is overwritten — the change is added to this record’s history.</div>' +
        (isEdit
          ? '<label class="ts-af-l">What happened</label><input class="ts-af-i" id="tsAmTitle" value="' + _esc(ev.title || '') + '">' +
            '<label class="ts-af-l">Details</label><textarea class="ts-af-i ts-af-ta" id="tsAmDetail" rows="2">' + _esc(ev.description || '') + '</textarea>' +
            '<label class="ts-af-l">Vendor</label><input class="ts-af-i" id="tsAmVendor" value="' + _esc(m.vendor || '') + '">' +
            '<label class="ts-af-l">Cost</label><input class="ts-af-i" id="tsAmCost" type="number" step="0.01" value="' + _esc(m.costUsd != null ? m.costUsd : '') + '">' +
            '<label class="ts-af-l">Warranty expires</label><input class="ts-af-i" id="tsAmWarranty" type="date" value="' + _esc(m.warrantyExpires || '') + '">'
          : '<label class="ts-af-l">Note</label><textarea class="ts-af-i ts-af-ta" id="tsAmNote" rows="2" placeholder="What has happened since?"></textarea>') +
        (mode === 'photos' || mode === 'files'
          ? '<label class="ts-af-l">Attach</label><input class="ts-af-i ts-af-file" id="tsAmFiles" type="file" multiple accept="' +
            (mode === 'photos' ? 'image/*' : 'application/pdf,image/*') + '">' : '') +
        '<div class="ts-af-err" id="tsAmErr" style="display:none"></div>' +
        '<div class="ts-af-actions">' +
          '<button class="ts-af-cancel" id="tsAmCancel">Cancel</button>' +
          '<button class="ts-af-save" id="tsAmSave">Save to this record</button>' +
        '</div>' +
      '</div>';
    _t('tsAmCancel').onclick = function () { slot.innerHTML = ''; };
    _t('tsAmSave').onclick = function () {
      var changes = {}, note = null;
      if (isEdit) {
        changes.title = (_t('tsAmTitle') || {}).value || '';
        changes.description = (_t('tsAmDetail') || {}).value || '';
        var v = (_t('tsAmVendor') || {}).value || ''; if (v.trim()) changes.vendor = v.trim();
        var c = (_t('tsAmCost') || {}).value || ''; if (c !== '' && !isNaN(Number(c))) changes.costUsd = Number(c);
        var w = (_t('tsAmWarranty') || {}).value || ''; if (w) changes.warrantyExpires = w;
      } else {
        note = (_t('tsAmNote') || {}).value || '';
      }
      var fEl = _t('tsAmFiles');
      var btn = _t('tsAmSave'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      _readFiles(fEl && fEl.files ? fEl.files : []).then(function (files) {
        var kind = mode === 'photos' ? 'photo' : 'document';
        var added = files.map(function (f) {
          return { name: f.name, url: f.url, kind: kind, size: f.size, mime: f.mime,
                   oversize: !!f.oversize, unreadable: !!f.unreadable };
        });
        if (!Object.keys(changes).length && !(note && note.trim()) && !added.length) {
          var e = _t('tsAmErr');
          if (e) { e.textContent = 'Add a note, change something, or attach a file.'; e.style.display = 'block'; }
          if (btn) { btn.disabled = false; btn.textContent = 'Save to this record'; }
          return;
        }
        _applyAmend(tenantId, eventId, changes, note, added);
      });
    };
  }

  function _applyAmend(tenantId, eventId, changes, note, added) {
    var prop = window.currentProperty && window.currentProperty();
    var ev = _findEvent(eventId);
    // S4 — every exit says something. These used to return silently, so
    // "Mark complete" on a record whose property had been switched underneath
    // did nothing at all: no toast, no error, no console line.
    if (!prop) { if (window.showToast) window.showToast('No property is open — reopen the space and try again.',
      { color: '#92400e', textColor: '#fef3c7', duration: 6000 }); return; }
    if (!ev) { if (window.showToast) window.showToast('That record is no longer open — it may belong to another property.',
      { color: '#92400e', textColor: '#fef3c7', duration: 6000 }); return; }
    if (!_amend(ev, changes, note, added)) {
      if (window.showToast) window.showToast('Nothing changed — the record is as it was.');
      return;
    }

    // S8 — re-render IN PLACE. This used to close the space, reopen it, and
    // then fire openActivity() on a 260ms timer: a magic number that silently
    // failed to reopen the record on a slow device or a long timeline, leaving
    // the user on the space list unsure whether the save had worked.
    //
    // _refreshOpenRecord() re-assembles from the mutated property and repaints
    // the record synchronously — no teardown, no timer, and the panel keeps its
    // scroll position.
    var saved = window.savePropertyNow ? window.savePropertyNow(prop)
              : (window.saveProperty ? window.saveProperty(prop) : null);
    _refreshOpenRecord(tenantId, eventId);
    if (saved && typeof saved.then === 'function') {
      saved.then(function () { if (window.showToast) window.showToast('Record updated'); })
           .catch(function (e) {
             if (window.showToast) window.showToast('Updated here, but saving to the server failed: ' +
               (e && e.message ? e.message : 'unknown error') + ' — it may not survive a reload.',
               { color: '#92400e', textColor: '#fef3c7', duration: 8000 });
           });
    }
  }

  // Re-assemble the open space from the current property and repaint the open
  // record, synchronously. Used after an amendment so the change is visible
  // without a close/open cycle.
  function _refreshOpenRecord(tenantId, eventId) {
    var property = window.currentProperty && window.currentProperty();
    if (!property) return false;
    _openRec = assemble(property, tenantId);
    if (!_t('tsAddPanel')) return false;   // panel gone — nothing to repaint
    openActivity(tenantId, eventId);
    return true;
  }

  // ── Add Activity ──────────────────────────────────────────────────────────
  // A space's record IS its timeline: assemble() scopes property.timeline to the
  // tenant, and _attach(events, kind) files each event's attachments into the
  // Photos / Documents / Financial sections. So adding an activity is appending
  // one correctly-shaped timeline event — every section then updates itself,
  // with no separate stores to keep in sync.
  // 'Add Warranty' was removed as a standalone activity. Nobody wakes up and
  // decides to add a warranty — they replace an HVAC compressor, and that repair
  // has a vendor, an invoice, photos AND a warranty. Splitting the warranty out
  // made the manager file one job as two records. It now lives on maintenance,
  // which already carries a warranty expiry, and any warranty document attaches
  // to that repair like every other file. Existing standalone warranty records
  // keep rendering; only the way to create new ones is gone.
  var ACTIVITY_TYPES = [
    { key: 'photos',      icon: '\u{1F4F7}', label: 'Add Photos',        kind: 'photo',    category: 'inspection',  accept: 'image/*',                multiple: true,
      titlePlaceholder: 'Move-out inspection', verb: 'Added photos' },
    { key: 'maintenance', icon: '\u{1F527}', label: 'Add Maintenance',   kind: 'document', category: 'maintenance', accept: 'image/*,application/pdf', multiple: true,
      titlePlaceholder: 'HVAC serviced by ABC Mechanical', verb: 'Added maintenance', cost: true, vendor: true, warranty: true },
    { key: 'document',    icon: '\u{1F4C4}', label: 'Add Space Document',   kind: 'document', category: 'document',    accept: 'application/pdf,image/*,.doc,.docx', multiple: true,
      titlePlaceholder: 'Estoppel certificate', verb: 'Added document' },
    { key: 'note',        icon: '\u{1F4DD}', label: 'Add Note',          kind: null,       category: 'note',        accept: null,                      multiple: false,
      titlePlaceholder: 'Tenant requested repaint before renewal', verb: 'Added note' },
    { key: 'invoice',     icon: '\u{1F4B0}', label: 'Add Vendor Invoice', kind: 'invoice', category: 'invoice',     accept: 'application/pdf,image/*', multiple: true,
      titlePlaceholder: 'ABC Mechanical \u2014 invoice 4417', verb: 'Added vendor invoice', cost: true, vendor: true },
    { key: 'damage',      icon: '\u{26A0}',  label: 'Report Damage',     kind: 'photo',    category: 'damage',      accept: 'image/*',                multiple: true,
      titlePlaceholder: 'Water damage \u2014 rear stockroom ceiling', verb: 'Reported damage', severity: 'warning', cost: true },
  ];

  function _typeByKey(k) { for (var i = 0; i < ACTIVITY_TYPES.length; i++) if (ACTIVITY_TYPES[i].key === k) return ACTIVITY_TYPES[i]; return null; }

  function _openAddPicker(tenantId) {
    var panel = _t('tsAddPanel');
    if (!panel) return;
    if (panel.style.display !== 'none' && panel.getAttribute('data-mode') === 'picker') { _closeAddPanel(); return; }
    panel.setAttribute('data-mode', 'picker');
    panel.style.display = 'block';
    panel.innerHTML =
      '<div class="ts-add-lead">What happened in this suite?</div>' +
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
        '<div class="ts-add-sub">Recording this against <b>' +
          _esc((_openRec && _openRec.space && _openRec.space.name) || 'this suite') +
          '</b>. It joins the timeline and files itself into the right section.</div>' +
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

  // S10 — what a property record legitimately holds. Everything here becomes a
  // data: URL in an href; an uploaded .html would be data:text/html, which
  // modern browsers refuse to open top-level but which has no business on a
  // lease record either. Allow-list, not block-list: the set of things a
  // manager attaches is small and known, and the set of dangerous types is not.
  var ALLOWED_MIME = /^(image\/(jpeg|png|gif|webp|heic|heif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.|application\/vnd\.ms-excel|text\/plain|text\/csv)/i;
  // Some browsers report an empty type for known-safe extensions; fall back to
  // the extension rather than rejecting a legitimate photo.
  var ALLOWED_EXT = /\.(jpe?g|png|gif|webp|heic|heif|pdf|docx?|xlsx?|txt|csv)$/i;
  function _mimeAllowed(f) {
    var type = (f && f.type) || '';
    if (type) return ALLOWED_MIME.test(type);
    return ALLOWED_EXT.test((f && f.name) || '');
  }
  function _readFiles(list) {
    var out = [], arr = Array.prototype.slice.call(list || []);
    if (!arr.length) return Promise.resolve(out);
    return Promise.all(arr.map(function (f) {
      return new Promise(function (resolve) {
        var base = { name: f.name, size: f.size, mime: f.type || '' };
        if (!_mimeAllowed(f)) { out.push(Object.assign(base, { url: null, rejectedType: true })); return resolve(); }
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

    // S11 — reject before anything is written, and say which field.
    if (cost !== '') {
      var costNum = Number(cost);
      if (!isFinite(costNum)) return fail('Cost must be a number.');
      if (costNum < 0) return fail('Cost cannot be negative. Record a credit as a note instead.');
      if (costNum > 100000000) return fail('That cost looks wrong — check the figure before saving.');
    }
    // S12 — a warranty that has already expired is almost always a mistyped
    // year. Compared against TODAY, which is when the work is being recorded.
    if (warr) {
      var wExp = new Date(warr + 'T12:00:00');
      if (isNaN(wExp.getTime())) return fail('That warranty date is not a valid date.');
      var today = new Date(); today.setHours(0, 0, 0, 0);
      if (wExp < today) return fail('That warranty expiry is in the past — check the year.');
    }

    _readFiles(picked).then(function (files) {
      // S3 — a file that did not read is NOT an attachment. These used to be
      // stored with url:null and the save reported success, so a record claimed
      // two photos and held two nulls. A phone photo over 1.2MB is the normal
      // case, not an edge case.
      var attachments = files.filter(function (f) { return f && f.url; }).map(function (f) {
        return { name: f.name, url: f.url, kind: t.kind || 'document', size: f.size, mime: f.mime };
      });
      var rejected = files.filter(function (f) { return !f || !f.url; });
      if (rejected.length) {
        var why = rejected.map(function (f) {
          var r = f.rejectedType ? 'unsupported type' : f.oversize ? 'over 1.2 MB' : 'could not be read';
          return (f.name || 'file') + ' (' + r + ')';
        }).join(', ');
        if (window.showToast) window.showToast('\u26A0\uFE0F Not attached \u2014 ' + why,
          { color: '#92400e', textColor: '#fef3c7', duration: 8000 });
      }
      // Nothing survived and nothing was typed: there is no record to make.
      if (!attachments.length && !title.trim()) {
        return fail('None of those files could be attached, and no description was given.');
      }
      // Provenance is the point of a verified memory: every entry carries who put
      // it there, when, and by what route. Resolved HERE, above the metadata it
      // feeds — declared below it first time round, and `var` hoisting meant
      // meta.recordedBy was silently set to undefined on every activity.
      var _who = 'Property Manager';
      try {
        var u = window.AuthService && window.AuthService.getCurrentUser && window.AuthService.getCurrentUser();
        if (u && (u.email || u.name)) _who = u.name || u.email;
      } catch (_e) {}
      var meta = {};
      if (vendor.trim()) meta.vendor = vendor.trim();
      // S11 — min="0" on the input is a hint the browser does not enforce on
      // paste or on programmatic set. Validate the value we are about to store.
      if (cost !== '') meta.costUsd = Number(cost);
      if (warr) meta.warrantyExpires = warr;
      if (attachments.length) meta.fileCount = attachments.length;
      meta.recordedBy = _who;
      meta.recordedAt = new Date().toISOString();
      meta.recordedVia = 'Manual';

      var headline = title.trim() || (attachments.length + ' file' + (attachments.length === 1 ? '' : 's') + ' attached');

      var evt = {
        type: 'space_' + t.key,
        severity: t.severity || 'info',
        actor: _who,
        source: 'manual',      // Manual | AI | Import | Email — set by whoever writes the event
        manual: true,
        // Work starts Open. Without this the field was undefined until the first
        // transition, and the history then read "Status: none → In progress" —
        // true to the data and wrong to the reader, who did open it as Open.
        status: (t.key === 'maintenance' || t.key === 'damage') ? 'open' : undefined,
        category: t.category,
        tenantId: tenantId,
        subject: { type: 'suite', id: tenantId, label: (_openRec && _openRec.space && _openRec.space.name) || '' },
        // Title is what happened, nothing else. It read "Added maintenance —
        // HVAC compressor replaced": the manager thinks "HVAC compressor
        // replaced", and the row already carries a Maintenance badge, so the
        // prefix was pure noise repeated on every line of the timeline.
        title: headline,
        // Vendor/cost/warranty are structured fields and are rendered from
        // metadata. Repeating them here printed the same three facts twice on
        // the record, once as prose and once as labelled values.
        description: detail.trim(),
        metadata: meta,
        attachments: attachments,
        // The record starts with its own creation. History read "0" on a record
        // that someone had plainly just created.
        revisions: [{
          at: new Date().toISOString(), by: _who, via: 'Manual', action: 'created',
          snapshot: { title: headline, description: detail.trim(),
                      status: (t.key === 'maintenance' || t.key === 'damage') ? 'open' : null,
                      metadata: Object.assign({}, meta) },
        }],
      };

      try {
        var _stored = window.appendPropertyTimelineEvent(property, evt);
        if (_stored && _stored.id) evt.id = _stored.id;
      } catch (e) {
        return fail('Could not record that: ' + (e && e.message ? e.message : 'unknown error'));
      }

      var done = function () {
        // Re-open the space so every section re-assembles from the new event.
        //
        // NOT auto-opening the new record here, though the walkthrough shows it
        // costs a click: after saving you must find the row on the timeline and
        // click it before you can attach the photo already in your hand. An
        // attempt to land on the record automatically raced the panel state and
        // I could not verify it, so it is left out rather than shipped unproven.
        // Worth revisiting — see the walkthrough notes in the commit.
        closeSpace();
        openSpace(tenantId);
        if (window.showToast) window.showToast(t.verb + ' to ' + ((_openRec && _openRec.space && _openRec.space.name) || 'this space'));
      };
      // S9 — savePropertyNow cancels any debounced write first, so there is
      // exactly one write in flight and this promise is the one that resolves
      // it. Calling saveProperty() directly raced the 800ms timer queued by
      // savePropertyData().
      var _save = window.savePropertyNow || window.saveProperty;
      var saved = _save ? _save(property) : null;
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
           addActivity: _openAddPicker, activityTypes: function () { return ACTIVITY_TYPES.slice(); },
           openActivity: openActivity,
           // SEC-1 test seam. The stored-vs-inline decision picks between a
           // signed-URL round trip and a direct open, so it is worth asserting
           // as BEHAVIOUR rather than grepping for the branch in the source.
           _isStoredObject: _isStoredObject, _attachChip: _attachChip };
})();
