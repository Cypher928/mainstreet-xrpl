'use strict';
/**
 * lease-review-packets.js — Phase 16: AI Lease Review Packets
 *
 * Generates enterprise-grade explainable review/export packets.
 * Pure module — no DOM, no global state mutations, no network.
 *
 * Exposes: window.LeaseReviewPackets
 */
window.LeaseReviewPackets = (() => {

  // ── DISPLAY HELPERS ───────────────────────────────────────────────────────

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

  // ── TASK 2: EXECUTIVE SUMMARY ─────────────────────────────────────────────

  function buildExecutiveSummary(property, metrics) {
    const m = metrics || {};
    const tenants  = Array.isArray(property.tenants)  ? property.tenants  : [];
    const disputes = Array.isArray(property.disputes) ? property.disputes : [];
    const criticalItems = [];
    const warningItems  = [];
    const unresolvedItems = [];

    // Amendment findings
    const amdCount = tenants.reduce((s, t) => s + (Array.isArray(t.amendments) ? t.amendments.length : 0), 0);
    if (amdCount > 0) {
      criticalItems.push(`${amdCount} amendment${amdCount !== 1 ? 's' : ''} on file — verify governing clause precedence for each affected field.`);
    }

    // Amendment conflicts
    for (const t of tenants) {
      const ams = Array.isArray(t.amendments) ? t.amendments : [];
      if (ams.length < 2) continue;
      const seen = {};
      for (const a of ams) for (const f of (a.overriddenFields || [])) seen[f] = (seen[f] || 0) + 1;
      for (const [field, count] of Object.entries(seen)) {
        if (count > 1) criticalItems.push(`Amendment conflict: multiple amendments modify ${field} for ${t.tenant_name || t.id} — governing version requires confirmation.`);
      }
    }

    // CAM cap ambiguity
    const capAmbiguous = tenants.filter(t => {
      const isNnn = (t.lease_type || '').toLowerCase().includes('nnn') || (t.lease_type || '').toLowerCase().includes('triple');
      return isNnn && t.cap == null;
    });
    if (capAmbiguous.length > 0) criticalItems.push(`${capAmbiguous.length} NNN tenant${capAmbiguous.length !== 1 ? 's' : ''} with no CAM cap specified — expense increase exposure unquantified.`);

    // Gross-up ambiguity
    const grossUpNoQuote = tenants.filter(t => t.gross_up_pct != null && !(t.fieldEvidence?.gross_up_pct?.snapshots || []).some(s => s.quote));
    if (grossUpNoQuote.length > 0) warningItems.push(`Gross-up language detected with occupancy threshold ambiguity in ${grossUpNoQuote.length} lease${grossUpNoQuote.length !== 1 ? 's' : ''}.`);

    // Audit rights without timeline
    const auditNoTimeline = tenants.filter(t => t.audit_rights === true && !(t.fieldEvidence?.audit_rights?.snapshots || []).some(s => s.quote?.match(/\d+[\s-]year/i)));
    if (auditNoTimeline.length > 0) warningItems.push(`Audit rights language missing reimbursement timeline in ${auditNoTimeline.length} lease${auditNoTimeline.length !== 1 ? 's' : ''}.`);

    // Low confidence leases
    const lowConf = tenants.filter(t => t._confidence === 'low' || t._confidenceScore < 55);
    if (lowConf.length > 0) warningItems.push(`${lowConf.length} lease${lowConf.length !== 1 ? 's' : ''} extracted with low confidence — manual field verification recommended.`);

    // Missing critical fields
    const missingCrit = tenants.filter(t => !t.leased_sqft || !t.start_date || !t.end_date);
    if (missingCrit.length > 0) unresolvedItems.push(`${missingCrit.length} lease${missingCrit.length !== 1 ? 's' : ''} missing critical fields (sqft or dates) — reconciliation may be inaccurate.`);

    // Open disputes
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

  // ── TASK 3: AMENDMENT CHRONOLOGY ─────────────────────────────────────────

  function buildAmendmentChronology(tenants) {
    const entries = [];

    for (const t of (tenants || [])) {
      const tid  = t.id || '';
      const name = t.tenant_name || tid;
      const ams  = Array.isArray(t.amendments) ? t.amendments : [];

      // Original lease entry
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

      // Track which fields have been modified for contradiction detection
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

    // Sort ascending by date (nulls last)
    entries.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    return entries;
  }

  // ── TASK 4: EVIDENCE APPENDIX ─────────────────────────────────────────────

  function buildEvidenceAppendix(tenants) {
    const CAM_FINANCIAL = new Set(['cap', 'admin_fee_pct', 'gross_up_pct', 'expense_stop']);
    const CITE_REQUIRED = new Set(['cap', 'admin_fee_pct', 'gross_up_pct', 'expense_stop', 'audit_rights']);

    let totalExceptions = 0, totalCleanFields = 0, tenantsWithExceptions = 0;
    const tenantSections = [];

    for (const t of (tenants || [])) {
      const fev       = t.fieldEvidence || {};
      const ams       = Array.isArray(t.amendments) ? t.amendments : [];
      const name      = t.tenant_name || t.id || '';
      const tid       = t.id || '';
      const confScore = t._confidenceScore ?? null;
      const confLevel = t._confidence || (confScore != null ? (confScore >= 80 ? 'high' : confScore >= 55 ? 'medium' : 'low') : null);
      const isNnn     = (t.lease_type || '').toLowerCase().includes('nnn') || (t.lease_type || '').toLowerCase().includes('triple');

      const criticalExceptions  = [];
      const leaseRisks          = [];
      const lowConfidenceFields = [];
      const missingCitations    = [];
      let cleanFieldCount = 0;

      // Seed field set; also include null critical fields and NNN cap absence
      const fields = new Set([
        ...Object.keys(fev),
        ...CANONICAL_FIELDS.filter(f => t[f] != null),
      ]);
      if (t.leased_sqft == null) fields.add('leased_sqft');
      if (t.start_date  == null) fields.add('start_date');
      if (t.end_date    == null) fields.add('end_date');
      if (isNnn && t.cap == null) fields.add('cap');

      for (const field of fields) {
        const snapshots   = fev[field]?.snapshots || [];
        const latestSnap  = snapshots[snapshots.length - 1] || null;
        const value       = t[field] ?? latestSnap?.value ?? null;
        const isNullCrit  = ['leased_sqft', 'start_date', 'end_date'].includes(field) && value == null;
        const isNnnCapGap = isNnn && field === 'cap' && value == null;

        if (value == null && !snapshots.length && !isNullCrit && !isNnnCapGap) continue;

        const amdModCount    = ams.filter(a => (a.overriddenFields || []).includes(field)).length;
        const quote          = latestSnap?.quote || null;
        const displayValue   = value != null ? _displayValue(field, value) : '—';
        const supersededFrom = snapshots.slice(0, -1).map(s => _displayValue(field, s.value));

        // ── Priority 1: Critical Exceptions ───────────────────────────────
        if (amdModCount > 1) {
          criticalExceptions.push({ field, displayValue, issue: `Modified by ${amdModCount} amendments`, supersededFrom });
          continue;
        }
        if (isNullCrit) {
          criticalExceptions.push({ field, displayValue: '—', issue: 'Required field missing — reconciliation affected', supersededFrom: [] });
          continue;
        }

        // ── Priority 2: Lease Risks ────────────────────────────────────────
        let risk = null;
        if (isNnnCapGap) {
          risk = 'CAM cap absent — increase exposure unquantified';
        } else if (field === 'gross_up_pct' && value != null && !quote) {
          risk = 'Gross-up threshold unverified by clause language';
        } else if (field === 'audit_rights' && value === true && !quote) {
          risk = 'Audit window unclear — no clause language found';
        } else if (field === 'renewal_options' && value != null && !quote) {
          risk = 'Renewal terms unverified — no clause language found';
        }
        if (risk) {
          leaseRisks.push({ field, displayValue, risk, confidence: confScore, confidenceLevel: confLevel });
          continue;
        }

        // ── Priority 3: Low Confidence Fields (CAM financial, score < 55) ─
        if (CAM_FINANCIAL.has(field) && confScore != null && confScore < 55) {
          lowConfidenceFields.push({ field, displayValue, score: confScore, level: confLevel });
          continue;
        }

        // ── Priority 4: Missing Citations (CAM financial, value, no quote) ─
        if (CITE_REQUIRED.has(field) && value != null && !quote) {
          const govAmd = ams.slice().reverse().find(a => (a.overriddenFields || []).includes(field));
          missingCitations.push({ field, displayValue, governingDocument: govAmd ? 'amendment' : 'original_lease' });
          continue;
        }

        // ── Priority 5: Verified ──────────────────────────────────────────
        cleanFieldCount++;
      }

      const exceptionCount = criticalExceptions.length + leaseRisks.length + lowConfidenceFields.length + missingCitations.length;
      totalExceptions  += exceptionCount;
      totalCleanFields += cleanFieldCount;
      if (exceptionCount > 0) tenantsWithExceptions++;

      tenantSections.push({
        tenantId:           tid,
        tenantName:         name,
        confidence:         confLevel,
        confidenceScore:    confScore,
        exceptionCount,
        cleanFieldCount,
        criticalExceptions,
        leaseRisks,
        lowConfidenceFields,
        missingCitations,
      });
    }

    return {
      tenantSections,
      summary: {
        totalTenants:          tenantSections.length,
        tenantsWithExceptions,
        totalExceptions,
        totalCleanFields,
      },
    };
  }

  // ── TASK 5: DISPUTE SUMMARY ───────────────────────────────────────────────

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

    // Risk narrative
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

  // ── TASK 8: CONFIDENCE NARRATIVES ────────────────────────────────────────

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

      // Narrative: amendment conflict
      if (ams.length >= 2) {
        const seen = {};
        for (const a of ams) for (const f of (a.overriddenFields || [])) seen[f] = (seen[f] || 0) + 1;
        if (Object.values(seen).some(c => c > 1)) {
          narratives.push(`Confidence reduced due to conflicting amendment language.`);
        }
      }

      // Narrative: weak OCR
      const edgeCases = t._edgeCases?.edgeCases || [];
      if (edgeCases.some(e => e.type === 'WEAK_OCR' || e.type === 'MALFORMED_OCR')) {
        narratives.push(`Clause partially obscured — OCR source quality degraded.`);
      }

      // Narrative: ambiguous clauses
      if (edgeCases.some(e => e.type === 'AMBIGUOUS_GROSS_UP' || e.type === 'CONTRADICTORY_CAP_AND_STOP')) {
        narratives.push(`Multiple candidate CAM exclusion clauses detected.`);
      }

      // Narrative: fields without direct quotes
      const fev = t.fieldEvidence || {};
      const noQuoteFields = CANONICAL_FIELDS.filter(f => t[f] != null && !(fev[f]?.snapshots || []).some(s => s.quote));
      if (noQuoteFields.length > 0) {
        narratives.push(`Value inferred without direct clause quote — manual verification recommended.`);
      }

      // Narrative: clean amendment
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

  // ── TASK 1: MAIN GENERATOR ────────────────────────────────────────────────

  function generateLeaseReviewPacket(property, options) {
    const opts     = options || {};
    const audience = opts.audience || 'landlord';
    const maxTl    = opts.maxTimelineEvents || 20;

    const tenants  = Array.isArray(property.tenants)  ? property.tenants  : [];
    const timeline = Array.isArray(property.timeline) ? property.timeline : [];

    // Use cached metrics if available, otherwise derive inline
    const metrics = property._derivedMetrics || _deriveMetricsLite(property);

    // Collect unresolved warnings from tenant review states
    const unresolvedWarnings = [];
    for (const t of tenants) {
      if (!t._edgeCases) continue;
      for (const ec of (t._edgeCases.edgeCases || [])) {
        unresolvedWarnings.push({ tenantName: t.tenant_name || t.id, warningType: ec.type, warningText: ec.description, fieldImpact: ec.fieldImpact });
      }
    }

    // CAM risk flags
    const CAMRiskFlags = [];
    for (const t of tenants) {
      for (const ec of (t._edgeCases?.edgeCases || [])) {
        CAMRiskFlags.push({ tenantName: t.tenant_name || t.id, riskType: ec.type, severity: ec.severity, description: ec.description, reviewerNote: ec.reviewerNote });
      }
    }

    // Aggregate reviewer notes
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

  // Per-tenant lease terms (for section 3 table)
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

  // Lightweight metrics fallback when derivePropertyMetrics not available (node test context)
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

  // ── TASK 6: HTML RENDERING ────────────────────────────────────────────────

  function formatReviewPacketHtml(packet, options) {
    if (!packet) return '';
    const opts     = options || {};
    const audience = packet.audience || 'landlord';
    const now      = _fmtDate(packet.generatedAt) || new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const propName = _esc(packet.propertyName || 'Property');
    const es       = packet.executiveSummary || {};

    // ── Cover ──────────────────────────────────────────────────────────────
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

    // ── Executive Summary ──────────────────────────────────────────────────
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

    // ── Extracted Lease Terms ──────────────────────────────────────────────
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

    // ── Amendment Chronology ───────────────────────────────────────────────
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

    // ── Evidence Appendix ──────────────────────────────────────────────────
    const showEvidence = audience === 'attorney' || audience === 'auditor' || audience === 'landlord';
    let evidenceHtml = '';
    if (showEvidence) {
      const ea       = packet.evidenceAppendix || {};
      const sections = Array.isArray(ea.tenantSections) ? ea.tenantSections : [];
      const eaSum    = ea.summary || {};

      const _evRow = (field, displayValue, detail, badge) =>
        `<div class="rpt-ev-row"><span class="rpt-ev-field">${_esc(field)}</span><span class="rpt-ev-val">${_esc(displayValue)}</span><span class="rpt-ev-detail">${_esc(detail)}</span>${badge || ''}</div>`;

      const _evCat = (items, label, mod, renderFn) =>
        items.length ? `<div class="rpt-ev-cat rpt-ev-cat--${mod}"><div class="rpt-ev-cat-hdr">${label} (${items.length})</div>${items.map(renderFn).join('')}</div>` : '';

      const tenantCards = sections.map(s => {
        const cc = s.confidence === 'high' ? '#4ade80' : s.confidence === 'medium' ? '#fbbf24' : s.confidence === 'low' ? '#f87171' : '#94a3b8';

        const critHtml = _evCat(s.criticalExceptions, '⚠ Critical Exceptions', 'critical', e =>
          _evRow(e.field, e.displayValue, e.issue,
            e.supersededFrom?.length ? `<span class="rpt-ev-history">Was: ${_esc(e.supersededFrom.join(' → '))}</span>` : ''));

        const riskHtml = _evCat(s.leaseRisks, 'Lease Risks', 'risk', e => {
          const lcc   = e.confidenceLevel === 'high' ? '#4ade80' : e.confidenceLevel === 'medium' ? '#fbbf24' : '#f87171';
          const badge = e.confidence != null ? `<span class="rpt-ev-conf" style="color:${lcc};">${e.confidence}/100 ${_esc(e.confidenceLevel || '')}</span>` : '';
          return _evRow(e.field, e.displayValue, e.risk, badge);
        });

        const lcHtml = _evCat(s.lowConfidenceFields, 'Low Confidence Fields', 'lowconf', e =>
          _evRow(e.field, e.displayValue, `Score ${e.score}/100 (${_esc(e.level || '')})`));

        const citeHtml = _evCat(s.missingCitations, 'Missing Citations', 'cite', e =>
          _evRow(e.field, e.displayValue, `No verbatim clause quote — ${_esc(e.governingDocument.replace('_', ' '))}`));

        const cleanLine = s.cleanFieldCount > 0
          ? `<div class="rpt-ev-clean">✓ ${s.cleanFieldCount} field${s.cleanFieldCount !== 1 ? 's' : ''} verified — no exceptions</div>` : '';

        return `<details class="rpt-ev-tenant"${s.exceptionCount > 0 ? ' open' : ''}>
          <summary class="rpt-ev-tenant-hdr">
            <span class="rpt-ev-tenant-name">${_esc(s.tenantName)}</span>
            <span class="rpt-ev-tenant-conf" style="color:${cc};">${_esc(s.confidence || '—')}${s.confidenceScore != null ? ` (${s.confidenceScore}/100)` : ''}</span>
            ${s.exceptionCount > 0
              ? `<span class="rpt-ev-tenant-exc">${s.exceptionCount} exception${s.exceptionCount !== 1 ? 's' : ''}</span>`
              : `<span class="rpt-ev-tenant-clean">✓ Clean</span>`}
          </summary>
          <div class="rpt-ev-tenant-body">${critHtml}${riskHtml}${lcHtml}${citeHtml}${cleanLine}</div>
        </details>`;
      }).join('');

      const sumBar = eaSum.totalTenants
        ? `<div class="rpt-ev-summary">${eaSum.totalTenants} tenant${eaSum.totalTenants !== 1 ? 's' : ''} · ${eaSum.totalExceptions} exception${eaSum.totalExceptions !== 1 ? 's' : ''} · ${eaSum.totalCleanFields} verified field${eaSum.totalCleanFields !== 1 ? 's' : ''}</div>`
        : '';

      evidenceHtml = `<div class="rpt-section-title">Evidence Appendix</div>
        ${sumBar}
        ${tenantCards || '<div style="color:#64748b;font-size:0.8rem;">No field evidence recorded.</div>'}`;
    }

    // ── Dispute Summary ────────────────────────────────────────────────────
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

    // ── Audit Timeline ─────────────────────────────────────────────────────
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

    // ── Confidence Narratives ──────────────────────────────────────────────
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

    // ── Reviewer Notes ────────────────────────────────────────────────────
    const notes = packet.reviewerNotes || [];
    const notesHtml = notes.length ? `<div class="rpt-section-title">Reviewer Action Items</div>
      <ul style="margin:0 0 0 16px;padding:0;">${notes.map(n => `<li style="font-size:0.81rem;color:#e2e8f0;margin-bottom:5px;">${_esc(n)}</li>`).join('')}</ul>` : '';

    // ── Footer ────────────────────────────────────────────────────────────
    const footerHtml = `<div class="rpt-footer">
      <span class="rpt-footer-brand">Mainstreet CAM Platform</span>
      <span>${propName} &nbsp;&middot;&nbsp; Lease Review Packet</span>
      <span>Generated ${_esc(now)}</span>
    </div>`;

    return [coverHtml, execHtml, termsHtml, chronoHtml, evidenceHtml, disputeHtml, timelineHtml, confHtml, notesHtml, footerHtml].filter(Boolean).join('\n');
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────────────
  return {
    generateLeaseReviewPacket,
    buildExecutiveSummary,
    buildAmendmentChronology,
    buildEvidenceAppendix,
    buildDisputeSummary,
    buildConfidenceNarratives,
    formatReviewPacketHtml,
  };
})();
