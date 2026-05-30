'use strict';
/**
 * test-packets.js — Phase 16: Lease Review Packets Test Suite
 *
 * Zero-DOM, zero-network. Inlines all functions under test.
 * 16 assertions covering all public API functions.
 *
 * Run: node test-packets.js
 */

// ── Minimal global stubs ──────────────────────────────────────────────────────
global.window = global.window || {};

// ── Inline: LeaseReviewPackets module ────────────────────────────────────────

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _fmt(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return '—';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _fmtDate(d) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (_) { return String(d); }
}

function _displayValue(field, val) {
  if (val == null) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (field === 'cap' || field === 'admin_fee_pct' || field === 'gross_up_pct') return val + '%';
  if (field === 'expense_stop') return _fmt(val) + '/sqft';
  if (field === 'leased_sqft') return Number(val).toLocaleString('en-US') + ' sqft';
  if (field === 'start_date' || field === 'end_date') return _fmtDate(val) || String(val);
  return String(val);
}

const CANONICAL_FIELDS = ['cap','admin_fee_pct','gross_up_pct','expense_stop','audit_rights','pro_rata_method','renewal_options','leased_sqft','start_date','end_date','lease_type'];

function buildExecutiveSummary(property, metrics) {
  const m = metrics || {};
  const tenants  = Array.isArray(property.tenants)  ? property.tenants  : [];
  const disputes = Array.isArray(property.disputes) ? property.disputes : [];
  const criticalItems = [];
  const warningItems  = [];
  const unresolvedItems = [];

  const amdCount = tenants.reduce((s, t) => s + (Array.isArray(t.amendments) ? t.amendments.length : 0), 0);
  if (amdCount > 0) {
    criticalItems.push(`${amdCount} amendment${amdCount !== 1 ? 's' : ''} on file — verify governing clause precedence for each affected field.`);
  }

  for (const t of tenants) {
    const ams = Array.isArray(t.amendments) ? t.amendments : [];
    if (ams.length < 2) continue;
    const seen = {};
    for (const a of ams) for (const f of (a.overriddenFields || [])) seen[f] = (seen[f] || 0) + 1;
    for (const [field, count] of Object.entries(seen)) {
      if (count > 1) criticalItems.push(`Amendment conflict: multiple amendments modify ${field} for ${t.tenant_name || t.id} — governing version requires confirmation.`);
    }
  }

  const capAmbiguous = tenants.filter(t => {
    const isNnn = (t.lease_type || '').toLowerCase().includes('nnn') || (t.lease_type || '').toLowerCase().includes('triple');
    return isNnn && t.cap == null;
  });
  if (capAmbiguous.length > 0) criticalItems.push(`${capAmbiguous.length} NNN tenant${capAmbiguous.length !== 1 ? 's' : ''} with no CAM cap specified — expense increase exposure unquantified.`);

  const grossUpNoQuote = tenants.filter(t => t.gross_up_pct != null && !(t.fieldEvidence?.gross_up_pct?.snapshots || []).some(s => s.quote));
  if (grossUpNoQuote.length > 0) warningItems.push(`Gross-up language detected with occupancy threshold ambiguity in ${grossUpNoQuote.length} lease${grossUpNoQuote.length !== 1 ? 's' : ''}.`);

  const auditNoTimeline = tenants.filter(t => t.audit_rights === true && !(t.fieldEvidence?.audit_rights?.snapshots || []).some(s => s.quote?.match(/\d+[\s-]year/i)));
  if (auditNoTimeline.length > 0) warningItems.push(`Audit rights language missing reimbursement timeline in ${auditNoTimeline.length} lease${auditNoTimeline.length !== 1 ? 's' : ''}.`);

  const lowConf = tenants.filter(t => t._confidence === 'low' || t._confidenceScore < 55);
  if (lowConf.length > 0) warningItems.push(`${lowConf.length} lease${lowConf.length !== 1 ? 's' : ''} extracted with low confidence — manual field verification recommended.`);

  const missingCrit = tenants.filter(t => !t.leased_sqft || !t.start_date || !t.end_date);
  if (missingCrit.length > 0) unresolvedItems.push(`${missingCrit.length} lease${missingCrit.length !== 1 ? 's' : ''} missing critical fields (sqft or dates) — reconciliation may be inaccurate.`);

  const openDisp = disputes.filter(d => d.status === 'open');
  if (openDisp.length > 0) {
    const exposure = openDisp.reduce((s, d) => s + (parseFloat(d.tenantShare) || 0), 0);
    criticalItems.push(`${openDisp.length} open dispute${openDisp.length !== 1 ? 's' : ''} totaling ${_fmt(exposure)} require resolution before reconciliation close.`);
  }

  return {
    healthStatus:        m.health?.status        || 'unknown',
    healthScore:         m.health?.score          ?? null,
    criticalItems,
    warningItems,
    unresolvedItems,
    totalTenants:        tenants.length,
    tenantsNeedingReview: m.reviewStats?.tenantsNeedingReview ?? null,
    openDisputes:        (m.disputeStats?.openDisputes)       ?? openDisp.length,
    amendmentCount:      amdCount,
    camCoverage:         m.financialStats?.allocationCoveragePct ?? null,
  };
}

function buildAmendmentChronology(tenants) {
  const entries = [];

  for (const t of (tenants || [])) {
    const tid  = t.id || '';
    const name = t.tenant_name || tid;
    const ams  = Array.isArray(t.amendments) ? t.amendments : [];

    entries.push({
      date:             t.start_date || null,
      tenantId:         tid,
      tenantName:       name,
      docType:          'original_lease',
      amendmentNumber:  0,
      fileName:         t.fileName || null,
      overriddenFields: [],
      precedenceNote:   'Original lease — baseline for all field values.',
      contradictionFlag: false,
    });

    const fieldHistory = {};
    ams.forEach((a, idx) => {
      const fields = Array.isArray(a.overriddenFields) ? a.overriddenFields : [];
      const contradictions = fields.filter(f => fieldHistory[f] != null);

      let precedenceNote = '';
      if (idx === 0) {
        precedenceNote = fields.length > 0
          ? `Introduces amendment to: ${fields.join(', ')}.`
          : 'First amendment — no field overrides detected.';
      } else {
        const superseded = fields.filter(f => fieldHistory[f] != null);
        precedenceNote = superseded.length > 0
          ? `Supersedes Amendment #${superseded.map(f => (fieldHistory[f] || 0) + 1).join(', #')} for: ${superseded.join(', ')}.`
          : `Amendment #${idx + 1} — no prior amendment fields superseded.`;
      }

      entries.push({
        date:             a.effectiveDate || a.uploadedAt || null,
        tenantId:         tid,
        tenantName:       name,
        docType:          'amendment',
        amendmentNumber:  idx + 1,
        fileName:         a.fileName || null,
        overriddenFields: fields,
        precedenceNote,
        contradictionFlag: contradictions.length > 0,
      });

      for (const f of fields) fieldHistory[f] = idx;
    });
  }

  entries.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return entries;
}

function buildEvidenceAppendix(tenants) {
  const rows = [];

  for (const t of (tenants || [])) {
    const fev  = t.fieldEvidence || {};
    const ams  = Array.isArray(t.amendments) ? t.amendments : [];
    const name = t.tenant_name || t.id || '';
    const tid  = t.id || '';

    const fields = new Set([
      ...Object.keys(fev),
      ...CANONICAL_FIELDS.filter(f => t[f] != null),
    ]);

    for (const field of fields) {
      const snapshots  = fev[field]?.snapshots || [];
      const latestSnap = snapshots[snapshots.length - 1] || null;
      const value      = t[field] ?? latestSnap?.value ?? null;
      if (value == null && !snapshots.length) continue;

      const govAmd = ams.slice().reverse().find(a => (a.overriddenFields || []).includes(field));
      const govDoc      = govAmd ? 'amendment' : 'original_lease';
      const govDocDate  = govAmd ? (govAmd.effectiveDate || govAmd.uploadedAt || null) : (t.start_date || null);
      const quote       = latestSnap?.quote || null;
      const confScore   = (typeof latestSnap?.confidence === 'object' && latestSnap.confidence !== null)
        ? null
        : (t._confidenceScore ?? null);
      const confLevel   = t._confidence || (confScore != null ? (confScore >= 80 ? 'high' : confScore >= 55 ? 'medium' : 'low') : null);
      const amdModCount = ams.filter(a => (a.overriddenFields || []).includes(field)).length;

      const supersededHistory = snapshots.slice(0, -1).map(s => ({
        value:       s.value,
        amendmentId: s.amendmentId || null,
        sourceFile:  s.sourceFile  || null,
        extractedAt: s.extractedAt || null,
      }));

      rows.push({
        tenantName:             name,
        tenantId:               tid,
        field,
        extractedValue:         value,
        displayValue:           _displayValue(field, value),
        governingDocument:      govDoc,
        governingDocumentDate:  govDocDate,
        quote,
        confidence:             confScore,
        confidenceLevel:        confLevel,
        supersededHistory,
        reviewerAttentionRequired: (confScore != null && confScore < 70) || amdModCount > 1 || !quote,
      });
    }
  }

  return rows;
}

function buildDisputeSummary(property) {
  const allDisputes = Array.isArray(property.disputes) ? property.disputes : [];
  const open        = allDisputes.filter(d => d.status === 'open');
  const resolved    = allDisputes.filter(d => d.status !== 'open');
  const totalExposure = open.reduce((s, d) => s + (parseFloat(d.tenantShare) || 0), 0);

  const now = Date.now();
  const openDisputes = open.map(d => {
    const created = d.timestamp ? new Date(d.timestamp).getTime() : now;
    return {
      id:          d.id,
      tenantName:  d.tenantName || '—',
      vendor:      d.vendor     || '—',
      category:    d.category   || '—',
      amount:      parseFloat(d.tenantShare) || 0,
      reason:      d.reason     || '',
      daysOpen:    Math.floor((now - created) / 86400000),
      severity:    d.severity   || 'medium',
      disputeType: d.disputeType || null,
    };
  });

  const resolvedDisputes = resolved.map(d => ({
    id:         d.id,
    tenantName: d.tenantName || '—',
    vendor:     d.vendor     || '—',
    resolution: d.status,
    resolvedAt: d.resolvedAt || null,
  }));

  let riskNarrative = '';
  if (open.length === 0) {
    riskNarrative = 'No open disputes.';
  } else {
    const vendorCounts = {};
    for (const d of open) { const v = d.vendor || 'Unknown'; vendorCounts[v] = (vendorCounts[v] || 0) + (parseFloat(d.tenantShare) || 0); }
    const topVendor = Object.entries(vendorCounts).sort((a, b) => b[1] - a[1])[0];
    const topPct    = topVendor ? Math.round((topVendor[1] / totalExposure) * 100) : 0;
    riskNarrative   = `${open.length} open dispute${open.length !== 1 ? 's' : ''} totaling ${_fmt(totalExposure)}${topVendor && topPct > 40 ? ` — ${topPct}% of disputed amount involves ${topVendor[0]} charges` : ''}.`;
  }

  return { totalDisputes: allDisputes.length, openCount: open.length, resolvedCount: resolved.length, totalExposure, openDisputes, resolvedDisputes, riskNarrative };
}

function buildConfidenceNarratives(tenants) {
  const high = [], medium = [], low = [];
  const narratives = [];
  let scoreSum = 0, scoreCount = 0;

  for (const t of (tenants || [])) {
    const name  = t.tenant_name || t.id || 'Unknown';
    const score = t._confidenceScore ?? 70;
    const level = t._confidence || (score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low');
    scoreSum += score; scoreCount++;

    const bucket = level === 'high' ? high : level === 'medium' ? medium : low;
    bucket.push({ tenantName: name, score, level });

    const ams = Array.isArray(t.amendments) ? t.amendments : [];

    if (ams.length >= 2) {
      const seen = {};
      for (const a of ams) for (const f of (a.overriddenFields || [])) seen[f] = (seen[f] || 0) + 1;
      if (Object.values(seen).some(c => c > 1)) {
        narratives.push(`Confidence reduced due to conflicting amendment language.`);
      }
    }

    const edgeCases = t._edgeCases?.edgeCases || [];
    if (edgeCases.some(e => e.type === 'WEAK_OCR' || e.type === 'MALFORMED_OCR')) {
      narratives.push(`Clause partially obscured — OCR source quality degraded.`);
    }

    if (edgeCases.some(e => e.type === 'AMBIGUOUS_GROSS_UP' || e.type === 'CONTRADICTORY_CAP_AND_STOP')) {
      narratives.push(`Multiple candidate CAM exclusion clauses detected.`);
    }

    const fev = t.fieldEvidence || {};
    const noQuoteFields = CANONICAL_FIELDS.filter(f => t[f] != null && !(fev[f]?.snapshots || []).some(s => s.quote));
    if (noQuoteFields.length > 0) {
      narratives.push(`Value inferred without direct clause quote — manual verification recommended.`);
    }

    for (const [idx, a] of ams.entries()) {
      if ((a.overriddenFields || []).length > 0 && ams.length === idx + 1) {
        narratives.push(`Amendment #${idx + 1} supersedes prior ${a.overriddenFields[0]} value — governing clause confirmed.`);
      }
    }
  }

  const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null;
  const overallLevel = !avgScore ? 'low' : avgScore >= 80 ? 'high' : avgScore >= 55 ? 'medium' : 'low';

  return { highConfidence: high, mediumConfidence: medium, lowConfidence: low, narratives: [...new Set(narratives)], overallConfidenceLevel: overallLevel, averageScore: avgScore };
}

function _buildLeaseTerms(tenants) {
  return (tenants || []).map(t => ({
    tenantId:      t.id,
    tenantName:    t.tenant_name || '—',
    leasedSqft:    t.leased_sqft,
    leaseType:     t.lease_type,
    startDate:     t.start_date,
    endDate:       t.end_date,
    cap:           t.cap,
    adminFeePct:   t.admin_fee_pct,
    grossUpPct:    t.gross_up_pct,
    expenseStop:   t.expense_stop,
    auditRights:   t.audit_rights,
    proRataMethod: t.pro_rata_method,
    renewalOptions:t.renewal_options,
    confidence:    t._confidence || null,
    confidenceScore: t._confidenceScore ?? null,
    amendmentCount: (t.amendments || []).length,
  }));
}

function _deriveMetricsLite(p) {
  const disputes   = Array.isArray(p.disputes)  ? p.disputes  : [];
  const tenants    = Array.isArray(p.tenants)   ? p.tenants   : [];
  const openDisp   = disputes.filter(d => d.status === 'open').length;
  const amdCount   = tenants.reduce((s, t) => s + (t.amendments || []).length, 0);
  return {
    health:       { status: 'unknown', score: null },
    disputeStats: { openDisputes: openDisp, totalDisputes: disputes.length, resolvedDisputes: disputes.length - openDisp },
    reviewStats:  { tenantsNeedingReview: 0, amendmentCount: amdCount },
    financialStats: { totalCAM: 0, allocationCoveragePct: null },
  };
}

function generateLeaseReviewPacket(property, options) {
  const opts     = options || {};
  const audience = opts.audience || 'landlord';
  const maxTl    = opts.maxTimelineEvents || 20;

  const tenants  = Array.isArray(property.tenants)  ? property.tenants  : [];
  const timeline = Array.isArray(property.timeline) ? property.timeline : [];

  const metrics = property._derivedMetrics || _deriveMetricsLite(property);

  const unresolvedWarnings = [];
  for (const t of tenants) {
    if (!t._edgeCases) continue;
    for (const ec of (t._edgeCases.edgeCases || [])) {
      unresolvedWarnings.push({ tenantName: t.tenant_name || t.id, warningType: ec.type, warningText: ec.description, fieldImpact: ec.fieldImpact });
    }
  }

  const CAMRiskFlags = [];
  for (const t of tenants) {
    for (const ec of (t._edgeCases?.edgeCases || [])) {
      CAMRiskFlags.push({ tenantName: t.tenant_name || t.id, riskType: ec.type, severity: ec.severity, description: ec.description, reviewerNote: ec.reviewerNote });
    }
  }

  const reviewerNotes = [];
  const confSummary = buildConfidenceNarratives(tenants);
  for (const n of confSummary.narratives) reviewerNotes.push(n);
  const expl = tenants.flatMap(t => t._explainability?.reviewNotes || []);
  for (const n of expl) { if (!reviewerNotes.includes(n)) reviewerNotes.push(n); }

  return {
    generatedAt:         new Date().toISOString(),
    propertyId:          property.id          || null,
    propertyName:        property.name         || 'Property',
    audience,
    executiveSummary:    buildExecutiveSummary(property, metrics),
    extractedLeaseTerms: _buildLeaseTerms(tenants),
    amendmentChronology: buildAmendmentChronology(tenants),
    unresolvedWarnings,
    CAMRiskFlags,
    disputeSummary:      buildDisputeSummary(property),
    auditTimeline:       timeline.slice(-maxTl).reverse(),
    evidenceAppendix:    buildEvidenceAppendix(tenants),
    reviewerNotes,
    confidenceSummary:   confSummary,
  };
}

function formatReviewPacketHtml(packet, options) {
  if (!packet) return '';
  const opts     = options || {};
  const audience = packet.audience || 'landlord';
  const now      = _fmtDate(packet.generatedAt) || new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const propName = _esc(packet.propertyName || 'Property');
  const es       = packet.executiveSummary || {};

  const coverHtml = `<div class="rpt-cover">
    <div class="rpt-cover-brand">Mainstreet CAM Platform</div>
    <div class="rpt-cover-title">${propName}</div>
    <div class="rpt-cover-type">Lease Review Packet — ${_esc(audience.charAt(0).toUpperCase() + audience.slice(1))}</div>
    <div class="rpt-cover-meta">
      <div class="rpt-cover-meta-item"><span>Generated</span><span>${_esc(now)}</span></div>
      <div class="rpt-cover-meta-item"><span>Tenants</span><span>${_esc(String(es.totalTenants ?? '—'))}</span></div>
      <div class="rpt-cover-meta-item"><span>Open Disputes</span><span>${_esc(String(es.openDisputes ?? '—'))}</span></div>
      <div class="rpt-cover-meta-item"><span>Amendments</span><span>${_esc(String(es.amendmentCount ?? '—'))}</span></div>
      ${es.camCoverage != null ? `<div class="rpt-cover-meta-item"><span>CAM Coverage</span><span>${_esc(String(es.camCoverage))}%</span></div>` : ''}
    </div>
  </div>`;

  const itemList = (items, cls) => items.length
    ? `<ul style="margin:6px 0 0 16px;padding:0;">${items.map(i => `<li class="${cls}" style="margin-bottom:3px;font-size:0.82rem;">${_esc(i)}</li>`).join('')}</ul>`
    : '';
  const execHtml = `<div class="rpt-section-title">Executive Summary</div>
    <div class="rpt-kpi-row">
      <div class="rpt-kpi${es.healthScore != null && es.healthScore < 50 ? ' rpt-kpi--alert' : ''}"><div class="kpi-val">${_esc(String(es.healthScore ?? '—'))}</div><div class="kpi-lbl">Health Score</div></div>
      <div class="rpt-kpi${es.openDisputes > 0 ? ' rpt-kpi--warn' : ''}"><div class="kpi-val">${_esc(String(es.openDisputes ?? '—'))}</div><div class="kpi-lbl">Open Disputes</div></div>
      <div class="rpt-kpi"><div class="kpi-val">${_esc(String(es.totalTenants ?? '—'))}</div><div class="kpi-lbl">Tenants</div></div>
      <div class="rpt-kpi"><div class="kpi-val">${_esc(String(es.amendmentCount ?? '—'))}</div><div class="kpi-lbl">Amendments</div></div>
    </div>
    ${es.criticalItems.length ? `<div style="margin-top:10px;font-size:0.78rem;font-weight:600;color:#f87171;">Critical Items</div>${itemList(es.criticalItems, 'lrp-critical')}` : ''}
    ${es.warningItems.length  ? `<div style="margin-top:8px;font-size:0.78rem;font-weight:600;color:#fbbf24;">Warnings</div>${itemList(es.warningItems, 'lrp-warning')}` : ''}
    ${es.unresolvedItems.length ? `<div style="margin-top:8px;font-size:0.78rem;font-weight:600;color:#94a3b8;">Unresolved</div>${itemList(es.unresolvedItems, 'lrp-unresolved')}` : ''}`;

  const termsRows = (packet.extractedLeaseTerms || []).map(t => `<tr>
    <td>${_esc(t.tenantName)}</td>
    <td style="text-align:right">${t.leasedSqft != null ? Number(t.leasedSqft).toLocaleString('en-US') : '—'}</td>
    <td>${_esc(t.leaseType || '—')}</td>
    <td style="text-align:right">${t.cap != null ? t.cap + '%' : '—'}</td>
    <td style="text-align:right">${t.adminFeePct != null ? t.adminFeePct + '%' : '—'}</td>
    <td style="text-align:right">${t.grossUpPct != null ? t.grossUpPct + '%' : '—'}</td>
    <td>${t.auditRights === true ? '✓' : t.auditRights === false ? '✗' : '—'}</td>
    <td><span style="color:${t.confidence === 'high' ? '#4ade80' : t.confidence === 'medium' ? '#fbbf24' : t.confidence === 'low' ? '#f87171' : '#94a3b8'}">${_esc(t.confidence || '—')}</span></td>
  </tr>`).join('');
  const termsHtml = `<div class="rpt-section-title">Extracted Lease Terms</div>
    <table class="rpt-table">
      <thead><tr><th>Tenant</th><th style="text-align:right">Sqft</th><th>Type</th><th style="text-align:right">CAM Cap</th><th style="text-align:right">Admin Fee</th><th style="text-align:right">Gross-Up</th><th>Audit Rights</th><th>Confidence</th></tr></thead>
      <tbody>${termsRows || '<tr><td colspan="8" style="text-align:center;color:#64748b;">No lease data</td></tr>'}</tbody>
    </table>`;

  const chronoRows = (packet.amendmentChronology || []).map(e => `<tr>
    <td>${_esc(e.date ? _fmtDate(e.date) : '—')}</td>
    <td>${_esc(e.tenantName)}</td>
    <td>${e.docType === 'original_lease' ? 'Original Lease' : `Amendment #${e.amendmentNumber}`}${e.contradictionFlag ? ' <span style="color:#f87171">⚠ Conflict</span>' : ''}</td>
    <td>${_esc(e.fileName || '—')}</td>
    <td>${_esc((e.overriddenFields || []).join(', ') || '—')}</td>
    <td style="font-size:0.72rem;color:#64748b;">${_esc(e.precedenceNote)}</td>
  </tr>`).join('');
  const chronoHtml = `<div class="rpt-section-title">Amendment Chronology</div>
    <table class="rpt-table">
      <thead><tr><th>Date</th><th>Tenant</th><th>Document</th><th>File</th><th>Fields Modified</th><th>Precedence</th></tr></thead>
      <tbody>${chronoRows || '<tr><td colspan="6" style="text-align:center;color:#64748b;">No amendments on file</td></tr>'}</tbody>
    </table>`;

  const showEvidence = audience === 'attorney' || audience === 'auditor' || audience === 'landlord';
  const evidenceHtml = showEvidence ? `<div class="rpt-section-title">Evidence Appendix</div>
    ${(packet.evidenceAppendix || []).map(e => `<details style="margin-bottom:6px;border:1px solid rgba(100,116,139,0.15);border-radius:6px;padding:4px 10px;">
      <summary style="cursor:pointer;font-size:0.8rem;color:${e.reviewerAttentionRequired ? '#fbbf24' : '#e2e8f0'};font-weight:${e.reviewerAttentionRequired ? '600' : '400'};">
        ${_esc(e.tenantName)} — ${_esc(e.field)} : ${_esc(e.displayValue)}
        ${e.reviewerAttentionRequired ? ' ⚠' : ''}
      </summary>
      <div style="font-size:0.73rem;color:#64748b;padding:6px 0;">
        <div><strong>Governing:</strong> ${_esc(e.governingDocument.replace('_',' '))}${e.governingDocumentDate ? ` (${_esc(_fmtDate(e.governingDocumentDate))})` : ''}</div>
        ${e.quote ? `<div style="margin:4px 0;padding:4px 8px;background:rgba(99,102,241,0.08);border-left:2px solid #818cf8;font-style:italic;">"${_esc(e.quote.slice(0,200))}${e.quote.length > 200 ? '…' : ''}"</div>` : '<div style="color:#f87171;font-size:0.71rem;">No direct clause quote — manual verification recommended.</div>'}
        ${e.supersededHistory.length ? `<div><strong>Superseded history:</strong> ${e.supersededHistory.map(h => _esc(String(h.value))).join(' → ')}</div>` : ''}
        <div><strong>Confidence:</strong> ${_esc(e.confidenceLevel || '—')}${e.confidence != null ? ` (${e.confidence}/100)` : ''}</div>
      </div>
    </details>`).join('') || '<div style="color:#64748b;font-size:0.8rem;">No field evidence recorded.</div>'}` : '';

  const ds = packet.disputeSummary || {};
  const hideDisputeDetail = audience === 'lender';
  const disputeHtml = !hideDisputeDetail ? `<div class="rpt-section-title">Dispute Summary</div>
    <div style="font-size:0.82rem;color:#cbd5e1;margin-bottom:8px;">${_esc(ds.riskNarrative || 'No disputes.')}</div>
    ${ds.openDisputes?.length ? `<table class="rpt-table">
      <thead><tr><th>#</th><th>Tenant</th><th>Vendor</th><th>Category</th><th style="text-align:right">Amount</th><th>Days Open</th><th>Severity</th></tr></thead>
      <tbody>${ds.openDisputes.map(d => `<tr>
        <td>${d.id + 1}</td><td>${_esc(d.tenantName)}</td><td>${_esc(d.vendor)}</td><td>${_esc(d.category)}</td>
        <td style="text-align:right">${_fmt(d.amount)}</td><td>${d.daysOpen}</td>
        <td><span style="color:${d.severity==='high'?'#f87171':d.severity==='low'?'#4ade80':'#fbbf24'}">${_esc(d.severity)}</span></td>
      </tr>`).join('')}</tbody>
    </table>` : ''}` : `<div class="rpt-section-title">Dispute Overview</div>
    <div style="font-size:0.82rem;color:#cbd5e1;">${_esc(ds.riskNarrative || 'No disputes.')}</div>`;

  const showFullTimeline = audience === 'auditor' || audience === 'attorney';
  const tlEvents = packet.auditTimeline || [];
  const tlRows = (showFullTimeline ? tlEvents : tlEvents.slice(0, 8)).map(e => `<tr>
    <td style="font-size:0.72rem;color:#64748b;">${_esc(e.timestamp ? new Date(e.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric'}) : '—')}</td>
    <td><span style="color:${e.severity==='critical'?'#f87171':e.severity==='warning'?'#fbbf24':e.severity==='success'?'#4ade80':'#818cf8'}">${_esc(e.type || '—')}</span></td>
    <td style="font-size:0.78rem;">${_esc(e.title || '—')}</td>
    <td style="font-size:0.72rem;color:#64748b;">${_esc(e.actor || '—')}</td>
  </tr>`).join('');
  const timelineHtml = tlEvents.length ? `<div class="rpt-section-title">Audit Timeline${!showFullTimeline && tlEvents.length > 8 ? ` (recent 8 of ${tlEvents.length})` : ''}</div>
    <table class="rpt-table">
      <thead><tr><th>Date</th><th>Event</th><th>Description</th><th>By</th></tr></thead>
      <tbody>${tlRows}</tbody>
    </table>` : '';

  const cn = packet.confidenceSummary || {};
  const showConfDetail = audience === 'auditor' || audience === 'attorney' || audience === 'landlord';
  const confHtml = showConfDetail ? `<div class="rpt-section-title">Confidence Assessment</div>
    <div class="rpt-kpi-row">
      <div class="rpt-kpi"><div class="kpi-val">${_esc(String(cn.averageScore ?? '—'))}</div><div class="kpi-lbl">Avg Score</div></div>
      <div class="rpt-kpi" style="color:#4ade80;"><div class="kpi-val">${cn.highConfidence?.length ?? 0}</div><div class="kpi-lbl">High Confidence</div></div>
      <div class="rpt-kpi" style="color:#fbbf24;"><div class="kpi-val">${cn.mediumConfidence?.length ?? 0}</div><div class="kpi-lbl">Medium</div></div>
      <div class="rpt-kpi" style="color:#f87171;"><div class="kpi-val">${cn.lowConfidence?.length ?? 0}</div><div class="kpi-lbl">Low Confidence</div></div>
    </div>
    ${cn.narratives?.length ? `<ul style="margin:8px 0 0 16px;padding:0;">${cn.narratives.map(n => `<li style="font-size:0.79rem;color:#94a3b8;margin-bottom:4px;">${_esc(n)}</li>`).join('')}</ul>` : ''}` : '';

  const notes = packet.reviewerNotes || [];
  const notesHtml = notes.length ? `<div class="rpt-section-title">Reviewer Action Items</div>
    <ul style="margin:0 0 0 16px;padding:0;">${notes.map(n => `<li style="font-size:0.81rem;color:#e2e8f0;margin-bottom:5px;">${_esc(n)}</li>`).join('')}</ul>` : '';

  const footerHtml = `<div class="rpt-footer">
    <span class="rpt-footer-brand">Mainstreet CAM Platform</span>
    <span>${propName} &nbsp;&middot;&nbsp; Lease Review Packet</span>
    <span>Generated ${_esc(now)}</span>
  </div>`;

  return [coverHtml, execHtml, termsHtml, chronoHtml, evidenceHtml, disputeHtml, timelineHtml, confHtml, notesHtml, footerHtml].filter(Boolean).join('\n');
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Tenant A: 2 amendments, cap conflict, audit rights with quote, NNN
const tenantA = {
  id: 'tenant-a', tenant_name: 'Acme Corp', leased_sqft: 5000,
  start_date: '2020-01-15', end_date: '2025-01-14', lease_type: 'Triple Net (NNN)',
  cap: 3, admin_fee_pct: 15, gross_up_pct: null, expense_stop: null, audit_rights: true,
  pro_rata_method: 'rentable', renewal_options: 'Two 5-year options at market rate',
  _confidence: 'high', _confidenceScore: 85, _edgeCases: null,
  fieldEvidence: {
    cap: { snapshots: [
      { value: 5, amendmentId: null, quote: 'CAM increases capped at 5% per year.', reviewedAt: '2020-01-15T00:00:00Z', sourceFile: 'lease.pdf' },
      { value: 3, amendmentId: 'amd-002', quote: 'CAM cap reduced to 3%.', reviewedAt: '2023-04-11T00:00:00Z', sourceFile: 'amd2.pdf' },
    ]},
    audit_rights: { snapshots: [
      { value: true, amendmentId: null, quote: 'Tenant has 2-year audit rights per Section 8.4.', reviewedAt: '2020-01-15T00:00:00Z', sourceFile: 'lease.pdf' },
    ]},
  },
  amendments: [
    { amendmentId: 'amd-001', effectiveDate: '2021-06-01', uploadedAt: '2021-06-01T00:00:00Z', fileName: 'amd1.pdf', overriddenFields: ['cap'], extractedFields: { cap: 4 } },
    { amendmentId: 'amd-002', effectiveDate: '2023-04-11', uploadedAt: '2023-04-11T00:00:00Z', fileName: 'amd2.pdf', overriddenFields: ['cap'], extractedFields: { cap: 3 } },
  ],
};

// Tenant B: no amendments, missing sqft, low confidence
const tenantB = {
  id: 'tenant-b', tenant_name: 'Beta LLC', leased_sqft: null,
  start_date: '2022-03-01', end_date: '2027-02-28', lease_type: 'Gross',
  cap: null, admin_fee_pct: null, gross_up_pct: 95, expense_stop: null, audit_rights: null,
  pro_rata_method: null, renewal_options: null,
  _confidence: 'low', _confidenceScore: 42, _edgeCases: { edgeCases: [{ type: 'WEAK_OCR', severity: 'high', description: 'Very short OCR text.', fieldImpact: ['tenant_name'], reviewerNote: 'Retry.', confidenceAdjustment: -20 }] },
  fieldEvidence: { gross_up_pct: { snapshots: [{ value: 95, amendmentId: null, quote: null, reviewedAt: '2022-03-01T00:00:00Z', sourceFile: 'lease2.pdf' }] } },
  amendments: [],
};

const property = {
  id: 'prop-1', name: 'Sunrise Plaza', totalSqft: 20000,
  tenants: [tenantA, tenantB],
  disputes: [
    { id: 0, tenantName: 'Acme Corp', vendor: 'Acme HVAC', category: 'HVAC', tenantShare: 2500, reason: 'HVAC charge not in lease scope.', status: 'open', timestamp: new Date(Date.now() - 10 * 86400000).toISOString(), disputeType: 'exclusion', severity: 'high', history: [] },
    { id: 1, tenantName: 'Beta LLC', vendor: 'City Utilities', category: 'utilities', tenantShare: 800, reason: 'Already paid separately.', status: 'resolved', timestamp: new Date(Date.now() - 30 * 86400000).toISOString(), disputeType: 'duplicate', severity: 'medium', resolvedAt: new Date(Date.now() - 5 * 86400000).toISOString(), history: [] },
  ],
  activityLog: [],
  timeline: [
    { type: 'lease_uploaded', severity: 'info', title: '2 leases uploaded', actor: 'User', timestamp: '2022-01-01T10:00:00Z' },
    { type: 'dispute_created', severity: 'warning', title: 'Dispute filed — Acme HVAC', actor: 'Acme Corp', timestamp: '2024-01-15T14:00:00Z' },
  ],
};

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}`); failed++; }
}
function assertEqual(a, b, label) {
  if (a === b) { console.log(`  ✓ ${label}`); passed++; }
  else         { console.error(`  ✗ ${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); failed++; }
}

// ── TEST GROUP 1: buildAmendmentChronology ────────────────────────────────────

console.log('\n═══ TEST 1: buildAmendmentChronology ═══');

const chrono = buildAmendmentChronology([tenantA, tenantB]);

// Test 1: entries are sorted ascending by date (nulls last)
{
  const dates = chrono.filter(e => e.date).map(e => new Date(e.date).getTime());
  let sorted = true;
  for (let i = 1; i < dates.length; i++) { if (dates[i] < dates[i - 1]) { sorted = false; break; } }
  assert(sorted, 'buildAmendmentChronology returns entries sorted ascending by date');
}

// Test 2: includes docType: 'original_lease' entries for each tenant
{
  const origEntries = chrono.filter(e => e.docType === 'original_lease');
  assertEqual(origEntries.length, 2, 'buildAmendmentChronology includes original_lease entry for each tenant');
}

// Test 3: sets contradictionFlag=true for the second amendment (both modify cap)
{
  const amd2 = chrono.find(e => e.docType === 'amendment' && e.tenantId === 'tenant-a' && e.amendmentNumber === 2);
  assert(amd2 != null && amd2.contradictionFlag === true, 'buildAmendmentChronology sets contradictionFlag=true for second amendment modifying same field');
}

// ── TEST GROUP 2: buildEvidenceAppendix ──────────────────────────────────────

console.log('\n═══ TEST 2: buildEvidenceAppendix ═══');

const evidence = buildEvidenceAppendix([tenantA, tenantB]);

// Test 4: includes cap field for tenantA with supersededHistory.length === 1
{
  const capRow = evidence.find(r => r.tenantId === 'tenant-a' && r.field === 'cap');
  assert(capRow != null && capRow.supersededHistory.length === 1, 'buildEvidenceAppendix: cap row for tenantA has 1 superseded history entry');
}

// Test 5: reviewerAttentionRequired=true for tenantB's gross_up_pct (no quote)
{
  const grossRow = evidence.find(r => r.tenantId === 'tenant-b' && r.field === 'gross_up_pct');
  assert(grossRow != null && grossRow.reviewerAttentionRequired === true, 'buildEvidenceAppendix: tenantB gross_up_pct reviewerAttentionRequired=true (no quote)');
}

// Test 6: only includes non-null fields
{
  const nullValRows = evidence.filter(r => r.extractedValue == null && r.supersededHistory.length === 0);
  assertEqual(nullValRows.length, 0, 'buildEvidenceAppendix: only includes rows with non-null values or snapshots');
}

// ── TEST GROUP 3: buildDisputeSummary ─────────────────────────────────────────

console.log('\n═══ TEST 3: buildDisputeSummary ═══');

const ds = buildDisputeSummary(property);

// Test 7: totalExposure equals 2500 (only open dispute)
assertEqual(ds.totalExposure, 2500, 'buildDisputeSummary: totalExposure = 2500 (open dispute only)');

// Test 8: riskNarrative mentions HVAC or 2,500
assert(ds.riskNarrative.includes('HVAC') || ds.riskNarrative.includes('2,500'), 'buildDisputeSummary: riskNarrative mentions HVAC or 2,500');

// Test 9: openCount=1, resolvedCount=1
assertEqual(ds.openCount, 1, 'buildDisputeSummary: openCount = 1');
assertEqual(ds.resolvedCount, 1, 'buildDisputeSummary: resolvedCount = 1');

// ── TEST GROUP 4: buildExecutiveSummary ──────────────────────────────────────

console.log('\n═══ TEST 4: buildExecutiveSummary ═══');

const es = buildExecutiveSummary(property);

// Test 10: criticalItems contains amendment-related finding
assert(
  es.criticalItems.some(item => item.toLowerCase().includes('amendment')),
  'buildExecutiveSummary: criticalItems contains amendment-related finding'
);

// Test 11: warningItems contains low-confidence finding
assert(
  es.warningItems.some(item => item.toLowerCase().includes('confidence') || item.toLowerCase().includes('low')),
  'buildExecutiveSummary: warningItems contains low-confidence finding'
);

// ── TEST GROUP 5: buildConfidenceNarratives ───────────────────────────────────

console.log('\n═══ TEST 5: buildConfidenceNarratives ═══');

const cn = buildConfidenceNarratives([tenantA, tenantB]);

// Test 12: lowConfidence array contains tenantB entry
assert(
  cn.lowConfidence.some(e => e.tenantName === 'Beta LLC'),
  'buildConfidenceNarratives: lowConfidence array contains tenantB (Beta LLC)'
);

// Test 13: averageScore = Math.round((85+42)/2) = 64
assertEqual(cn.averageScore, Math.round((85 + 42) / 2), 'buildConfidenceNarratives: averageScore = 64');

// ── TEST GROUP 6: generateLeaseReviewPacket ───────────────────────────────────

console.log('\n═══ TEST 6: generateLeaseReviewPacket ═══');

const packet = generateLeaseReviewPacket(property, { audience: 'landlord' });

// Test 14: returns object with all 10 required sections
const requiredSections = ['executiveSummary','extractedLeaseTerms','amendmentChronology','unresolvedWarnings','CAMRiskFlags','disputeSummary','auditTimeline','evidenceAppendix','reviewerNotes','confidenceSummary'];
assert(
  requiredSections.every(s => packet[s] !== undefined),
  'generateLeaseReviewPacket: returns object with all 10 required sections'
);

// ── TEST GROUP 7: formatReviewPacketHtml ─────────────────────────────────────

console.log('\n═══ TEST 7: formatReviewPacketHtml ═══');

const html = formatReviewPacketHtml(packet);

// Test 15: return value includes 'Executive Summary' text
assert(html.includes('Executive Summary'), 'formatReviewPacketHtml: output includes "Executive Summary"');

// Test 16: with audience 'lender' uses "Dispute Overview" section without detailed table
const lenderPacket = generateLeaseReviewPacket(property, { audience: 'lender' });
const lenderHtml = formatReviewPacketHtml(lenderPacket);
// Lender view replaces "Dispute Summary" + table with "Dispute Overview" + narrative only
assert(
  !lenderHtml.includes('Dispute Summary') && lenderHtml.includes('Dispute Overview') && !lenderHtml.includes('Days Open'),
  'formatReviewPacketHtml (lender): shows "Dispute Overview" without dispute detail table'
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));

if (failed > 0) {
  console.error(`\x1b[31m  FAILED — ${failed} assertion(s) did not pass\x1b[0m`);
  process.exit(1);
} else {
  console.log(`\x1b[32m  ALL ${passed} ASSERTIONS PASSED\x1b[0m`);
}
