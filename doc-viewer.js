/**
 * doc-viewer.js — one place to open any record.
 * ============================================================================
 * Principle: nothing appears clickable unless it opens something. Every
 * document row, timeline entry, and attachment in the Space workspace routes
 * through here.
 *
 * Three tiers, degrading honestly:
 *   1. Real file on record (url)  → open it.
 *   2. Sample/reference record    → open a rendered preview of that document,
 *                                   clearly labelled as a sample with no file
 *                                   uploaded yet. Never a dead tap, never a
 *                                   claim that a file exists.
 *   3. Non-document record (note, CAM run, dispute) → open the record that
 *                                   created it (the note, the reconciliation,
 *                                   the dispute workspace).
 *
 * Reuses the app's existing report modal (openReport) for the preview shell and
 * its rpt-* styling — no new modal system.
 *
 * Exposes: window.DocViewer
 */
window.DocViewer = (function () {
  'use strict';

  var _esc = (window.esc) || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  function _fmt(ts) {
    if (!ts) return '—';
    try { return new Date(String(ts).length <= 10 ? ts + 'T12:00:00' : ts)
      .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (_) { return String(ts); }
  }

  // Representative body copy per document category, so a sample preview reads
  // like the real thing during a demonstration.
  var BODIES = {
    'Lease': [
      'This Lease Agreement is entered into between Cascade Commons Holdings, LLC ("Landlord") and the Tenant identified above.',
      'ARTICLE 4 — OPERATING EXPENSES. Tenant shall pay its Proportionate Share of Common Area Maintenance costs, billed monthly in estimated installments and reconciled annually within one hundred twenty (120) days of calendar year end.',
      'ARTICLE 7 — MAINTENANCE AND REPAIR. Landlord shall maintain the roof, foundation, and structural elements. Tenant shall maintain all systems exclusively serving the Premises.',
      'ARTICLE 8.3 — WARRANTY WORK. Repairs covered by a manufacturer or contractor warranty during the warranty period shall remain the responsibility of Landlord.',
    ],
    'Amendments': [
      'FIRST AMENDMENT TO LEASE. The Lease is amended as set forth below. All capitalized terms retain the meanings given in the Lease.',
      '1. TERM. The Expiration Date is extended as stated in the summary above.',
      '2. CAM CAP. Controllable operating expenses shall not increase more than five percent (5%) per annum on a cumulative basis.',
      '3. RATIFICATION. Except as amended, all terms of the Lease remain in full force and effect.',
    ],
    'Estoppel': [
      'TENANT ESTOPPEL CERTIFICATE. The undersigned Tenant certifies to Landlord and any lender or purchaser as follows:',
      '1. The Lease is in full force and effect and has not been modified except by the amendments listed above.',
      '2. Tenant has accepted and is in possession of the Premises.',
      '3. To Tenant’s knowledge, no default exists under the Lease by either party.',
      '4. No rent has been prepaid more than one month in advance.',
    ],
    'Certificates of Insurance': [
      'CERTIFICATE OF LIABILITY INSURANCE. This certificate is issued as a matter of information only and confers no rights upon the certificate holder.',
      'Commercial General Liability — $1,000,000 each occurrence / $2,000,000 aggregate.',
      'Certificate Holder: Cascade Commons Holdings, LLC, as Additional Insured with respect to the Premises.',
      'The insurer will endeavor to provide thirty (30) days written notice prior to cancellation.',
    ],
    'CAM Backup': [
      'CAM RECONCILIATION BACKUP — supporting detail for the annual reconciliation of Common Area Maintenance charges.',
      'Includes the expense pool by category, the pro-rata calculation, invoice-level support for each line, and any cap or exclusion applied under the Lease.',
      'Amounts reconcile to the Tenant Statement issued for the same period.',
    ],
    'Notices': [
      'NOTICE OF ANNUAL CAM TRUE-UP. Pursuant to the Lease, Landlord provides notice of the reconciliation of estimated Common Area Maintenance charges against actual expenses for the period stated above.',
      'Any amount owing is due within thirty (30) days. Tenant retains the audit rights described in the Lease.',
    ],
    'Correspondence': [
      'Correspondence of record between Landlord and Tenant regarding the matter noted above.',
      'Retained as part of the property record so the full history of the discussion remains available to both parties.',
    ],
    'Tenant Photos': ['Photographic record of the Premises retained as part of the property file.'],
    'Move-in / Move-out': [
      'CONDITION REPORT. Photographic and written record of the condition of the Premises at the time of possession.',
      'Used to establish baseline condition for the purposes of maintenance responsibility and security deposit reconciliation.',
    ],
  };

  function _body(category) {
    return BODIES[category] || ['Record retained as part of the property file.'];
  }

  /** True when this record has a real stored file behind it. */
  function hasFile(rec) { return !!(rec && rec.url); }

  /**
   * Open any document record.
   * @param {{name, url, kind, category, when, space}} rec
   */
  function openDoc(rec) {
    if (!rec) return;
    // Tier 1 — a real file: open it.
    if (rec.url) {
      // SEC-1 — a stored /object/public/ URL no longer resolves once the bucket
      // is private. Exchange it for a signed one, which also re-checks that the
      // document belongs to this user. Async, so the tier-2 fallback below only
      // runs when there is genuinely no file.
      (async function () {
        var readable = window.resolveDocumentUrl ? await window.resolveDocumentUrl(rec.url) : rec.url;
        if (!readable) {
          if (typeof window.showToast === 'function') {
            window.showToast('⚠️ That document could not be opened — you may not have access, or it is no longer stored.',
              { color: '#92400e', textColor: '#fef3c7', duration: 8000 });
          }
          return;
        }
        try {
          if (/\.pdf($|\?)/i.test(readable) && typeof window.openLeaseModal === 'function') { window.openLeaseModal(readable); return; }
        } catch (_e) {}
        try { window.open(readable, '_blank', 'noopener'); } catch (_e) {}
      })();
      return;
    }
    // Tier 2 — a sample record: show a rendered preview, labelled honestly.
    if (typeof window.openReport !== 'function') return;
    var cat = rec.category || 'Document';
    var paras = _body(cat).map(function (t) { return '<p class="dv-p">' + _esc(t) + '</p>'; }).join('');
    var html =
      '<div class="dv-doc">' +
        '<div class="dv-banner">Sample record — no file has been uploaded for this document yet. ' +
          'Upload a file to replace it with the real document.</div>' +
        '<div class="dv-head">' +
          '<div class="dv-cat">' + _esc(cat) + '</div>' +
          '<div class="dv-title">' + _esc(rec.name || 'Document') + '</div>' +
          '<div class="dv-meta">' +
            (rec.space ? '<span><b>Space</b> ' + _esc(rec.space) + '</span>' : '') +
            '<span><b>Date</b> ' + _esc(_fmt(rec.when)) + '</span>' +
            '<span><b>Status</b> Sample</span>' +
          '</div>' +
        '</div>' +
        '<div class="dv-body">' + paras + '</div>' +
      '</div>';
    window.openReport(rec.name || cat, html);
    injectStyles();
  }

  /**
   * Open whatever record produced a timeline event: its document, its note, or
   * the workflow record behind it. Returns true when something was opened.
   */
  /**
   * Resolve an event to Evidence-Viewer citations: document + page + the
   * highlighted supporting language. Uses ONLY the existing evidence adapters —
   * a citation is returned solely when real extracted evidence exists. Never
   * fabricates one; returns null so the caller degrades gracefully.
   */
  function evidenceFor(ev, property) {
    try {
      if (!ev || !window.EvidenceViewer) return null;
      property = property || (window.currentProperty && window.currentProperty());
      if (!property) return null;

      // Lease / extraction / review events → the tenant's lease field evidence.
      var LEASE_TYPES = /^(lease_uploaded|extraction_completed|extraction_warning|amendment_uploaded|amendment_applied|field_overridden|review_confirmed)$/;
      if (LEASE_TYPES.test(ev.type || '')) {
        var tid = (ev.subject && ev.subject.id) || ev.tenantId;
        var t = (property.tenants || []).find(function (x) { return x && (x.id === tid || x.tenant_id === tid); });
        if (t && window.EvidenceViewer.fromTenantField) {
          // Prefer the field the event names; else any field with evidence.
          var keys = (ev.metadata && ev.metadata.fieldKey) ? [ev.metadata.fieldKey]
            : ['cam_cap', 'lease_type', 'leased_sqft', 'end_date', 'start_date', 'tenant_name'];
          var c = window.EvidenceViewer.fromTenantField(property, t, keys,
            'Supports “' + (ev.title || 'this record') + '”.');
          if (c) return [c];
        }
      }
      // Reserve events → the reserve document's extracted evidence.
      if (/^reserve_updated$/.test(ev.type || '') && window.EvidenceViewer.fromReserve) {
        var reserves = property.escrowReserves || [];
        for (var i = 0; i < reserves.length; i++) {
          var cites = window.EvidenceViewer.fromReserve(reserves[i]);
          if (cites && cites.length) return cites;
        }
      }
    } catch (_e) {}
    return null;   // no real evidence — caller falls back honestly
  }

  function openTimelineEvent(ev, opts) {
    if (!ev) return false;
    opts = opts || {};
    // Evidence first: a lease/extraction/reserve event opens the source document
    // at the cited page with the supporting language highlighted.
    var cites = evidenceFor(ev, opts.property);
    if (cites && cites.length && window.EvidenceViewer && window.EvidenceViewer.open) {
      window.EvidenceViewer.open({ citations: cites, index: 0 });
      return true;
    }
    // An attachment is the next most specific thing the event points at.
    var att = (ev.attachments || [])[0];
    if (att) { openDoc({ name: att.name, url: att.url, kind: att.kind, category: att.category || 'Attachment', when: ev.timestamp, space: opts.spaceName }); return true; }

    // A dispute event opens the dispute workspace.
    if (/^dispute_/.test(ev.type || '')) {
      var ids = ev.relatedDisputeIds || [];
      try {
        if (ids.length && typeof window.openDisputeWorkspace === 'function') { window.openDisputeWorkspace(ids[0]); return true; }
        if (typeof window.switchWorkspaceTab === 'function') { window.switchWorkspaceTab('cam'); return true; }
      } catch (_e) {}
    }
    // A CAM event opens the reconciliation.
    if (/^(cam_reconciled|invoice_imported|derived_metrics_rebuilt)$/.test(ev.type || '')) {
      try { if (window.PropertyTimeline && PropertyTimeline.viewSource) { PropertyTimeline.viewSource(ev.id); return true; } } catch (_e) {}
    }
    // A manual note (or anything else) opens the note itself.
    if (typeof window.openReport === 'function') {
      var d = (window.PropertyTimeline && PropertyTimeline.describe) ? PropertyTimeline.describe(ev) : { label: ev.type };
      var rows = [
        ['Type', d.label || ev.type],
        ['Date', _fmt(ev.timestamp)],
        ev.responsibility && ev.responsibility !== 'na' ? ['Responsibility', ev.responsibility] : null,
        ev.leaseRef ? ['Lease reference', ev.leaseRef] : null,
        ev.actor ? ['Recorded by', ev.actor] : null,
      ].filter(Boolean).map(function (r) {
        return '<div class="dv-row"><span>' + _esc(r[0]) + '</span><b>' + _esc(r[1]) + '</b></div>';
      }).join('');
      window.openReport(ev.title || 'Timeline entry',
        '<div class="dv-doc"><div class="dv-head"><div class="dv-cat">Timeline entry</div>' +
        '<div class="dv-title">' + _esc(ev.title || '') + '</div></div>' +
        '<div class="dv-rows">' + rows + '</div>' +
        (ev.description ? '<div class="dv-body"><p class="dv-p">' + _esc(ev.description) + '</p></div>' : '') +
        '</div>');
      injectStyles();
      return true;
    }
    return false;
  }

  function injectStyles() {
    if (document.getElementById('dv-styles')) return;
    var gold = '#C9973A';
    var css = [
      '.dv-doc{max-width:760px;margin:0 auto;}',
      '.dv-banner{background:rgba(201,151,58,0.1);border:1px dashed rgba(201,151,58,0.45);color:var(--text-2,#CBD5E1);border-radius:8px;padding:10px 13px;font-size:0.8rem;line-height:1.5;margin-bottom:18px;}',
      '.dv-head{border-bottom:2px solid ' + gold + ';padding-bottom:12px;margin-bottom:16px;}',
      '.dv-cat{font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:' + gold + ';}',
      '.dv-title{font-size:1.25rem;font-weight:800;color:var(--text-1,#E2E8F0);margin-top:4px;line-height:1.3;}',
      '.dv-meta{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:10px;font-size:0.76rem;color:var(--text-3,#94A3B8);}',
      '.dv-meta b{color:var(--text-4,#64748B);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;font-size:0.66rem;margin-right:5px;}',
      '.dv-body{font-size:0.9rem;line-height:1.75;color:var(--text-2,#CBD5E1);}',
      '.dv-p{margin:0 0 14px;}',
      '.dv-rows{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;}',
      '.dv-row{display:flex;justify-content:space-between;gap:14px;font-size:0.84rem;color:var(--text-3,#94A3B8);border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.06);padding-bottom:5px;}',
      '.dv-row b{color:var(--text-1,#E2E8F0);}',
      '@media (max-width:480px){ .dv-title{font-size:1.05rem;} .dv-meta{gap:6px 14px;} }',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'dv-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  return { openDoc: openDoc, openTimelineEvent: openTimelineEvent, evidenceFor: evidenceFor, hasFile: hasFile, injectStyles: injectStyles };
})();
