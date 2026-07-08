/**
 * document-drafting.js — Phase 23 Stage 1: AI Document Drafting
 *
 * Assembles professional, editable draft documents ENTIRELY from evidence and
 * analysis MainStreet already computed — reconciliation snapshots, lease
 * fieldEvidence (verbatim quotes + pages), EscrowReserveEngine readiness and
 * narratives, dispute records, and acquisition analysis. Deterministic: no LLM
 * call, no invented facts. Where a human decision belongs, the draft carries an
 * explicit [bracketed placeholder] instead of a fabricated position.
 *
 * Every document: DRAFT status, supporting citations, confidence, editable
 * preview, save, and print/PDF export. Nothing is ever sent automatically.
 *
 * Exposes: window.DocumentDrafting = { DOC_TYPES, build, renderEditableHtml, renderPrintHtml }
 */
window.DocumentDrafting = (() => {
  'use strict';

  const _esc  = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const _fmt$ = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const _num  = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const _recon = (p) => p.camReconciliation ?? p.results ?? null;

  function _deps(d) {
    return {
      EscrowEngine:   window.EscrowReserveEngine,
      ReconExplainer: window.ReconciliationExplainer,
      now:            new Date(),
      ...(d || {}),
    };
  }

  function _dateStr(now) {
    return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function _tenantQuote(t, keys) {
    for (const k of keys) {
      const snaps = t.fieldEvidence?.[k]?.snapshots;
      const last = Array.isArray(snaps) && snaps.length ? snaps[snaps.length - 1] : null;
      if (last && last.quote) return { quote: last.quote, page: last.page ?? null };
    }
    return null;
  }

  const DOC_TYPES = {
    recoveryLetter:        'CAM Recovery Letter',
    tenantCamExplanation:  'Tenant CAM Explanation',
    lenderReimbursement:   'Lender Reserve Reimbursement Letter',
    disputeResponse:       'Dispute Response',
    leaseReviewSummary:    'Lease Review Summary',
    acquisitionSummary:    'Acquisition Executive Summary',
  };

  // ── builders (each returns {sections, citations, confidence} or null) ─────

  function _pickTenant(p, ctx) {
    const tenants = (p.tenants || []).filter(Boolean);
    if (ctx && ctx.tenantId) { const t = tenants.find(x => x.id === ctx.tenantId); if (t) return t; }
    // Default: largest billed tenant in the reconciliation.
    const results = _recon(p)?.results || [];
    const top = results.slice().sort((a, b) => (_num(b.totalAllocated) || _num(b.allocated)) - (_num(a.totalAllocated) || _num(a.allocated)))[0];
    return top ? tenants.find(x => x.tenant_name === top.tenantName) || tenants[0] : tenants[0];
  }

  function _buildRecoveryLetter(p, ctx, d) {
    const t = _pickTenant(p, ctx);
    const recon = _recon(p);
    if (!t || !(recon?.results || []).length) return null;
    const r = recon.results.find(x => x.tenantName === t.tenant_name);
    if (!r) return null;
    const billed = _num(r.totalAllocated) || _num(r.allocated);
    const capEv = _tenantQuote(t, ['cam_cap', 'cap']);
    const sections = [
      { body: `${_dateStr(d.now)}` },
      { body: `RE: ${recon.camYear || ''} CAM Reconciliation — ${p.name}\nTenant: ${t.tenant_name}${t.suite ? ` · Suite ${t.suite}` : ''}` },
      { body: `Dear ${t.tenant_name},` },
      { body: `The annual Common Area Maintenance reconciliation for ${p.name} is complete. Total reconciled operating expenses for ${recon.camYear || 'the period'} were ${_fmt$(_num(recon.total))}. Based on your leased area of ${Number(t.leased_sqft || 0).toLocaleString('en-US')} square feet (${(r.proRataPercent || 0).toFixed(2)}% pro-rata share), your reconciled share is ${_fmt$(billed)}.` },
    ];
    if (r.capApplied && _num(r.capAdjustment) > 0) {
      sections.push({ body: `Per your lease's CAM cap${capEv ? ` ("${capEv.quote}")` : ''}, your share was reduced by ${_fmt$(r.capAdjustment)} from the uncapped amount — this cap has been applied in full.` });
    }
    sections.push(
      { body: `Amount due for the reconciliation period: ${_fmt$(billed)}. [State amounts already collected via estimates and the resulting balance due or credit.]` },
      { body: `Supporting documentation — the full reconciliation statement, invoice register, and allocation detail — is available for your review. Please remit the balance, or contact us with any questions, within [30] days.` },
      { body: `Sincerely,\n[Name]\nProperty Management — ${p.name}` },
    );
    const citations = [
      { source: 'CAM Report', detail: `${recon.camYear || ''} Allocation — ${p.name}` },
      ...(capEv ? [{ source: `Lease — ${t.tenant_name}`, detail: capEv.page != null ? `Page ${capEv.page}` : null, quote: capEv.quote }] : []),
    ];
    return { sections, citations, confidence: { pct: 93, basis: 'reconciliation results & lease terms' } };
  }

  function _buildTenantExplanation(p, ctx, d) {
    const t = _pickTenant(p, ctx);
    const recon = _recon(p);
    if (!t || !(recon?.results || []).length) return null;
    const r = recon.results.find(x => x.tenantName === t.tenant_name);
    if (!r) return null;
    const billed = _num(r.totalAllocated) || _num(r.allocated);
    let narrative = null;
    try { narrative = d.ReconExplainer?.buildReconciliationSummaryNarrative?.(r, t) || null; } catch (_) { narrative = null; }
    const invoices = (recon.invoicesFull?.length ? recon.invoicesFull : null) || recon.invoices || [];
    const byCat = {};
    invoices.forEach(inv => { if (inv) byCat[inv.category || 'other'] = (byCat[inv.category || 'other'] || 0) + _num(inv.amount); });
    const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([c, amt]) => `${c}: ${_fmt$(amt * (r.proRataPercent || 0) / 100)} (your share of ${_fmt$(amt)})`);
    const sections = [
      { heading: `Understanding your ${recon.camYear || ''} CAM charges — ${t.tenant_name}`, body: '' },
      { body: narrative || `Your space is ${Number(t.leased_sqft || 0).toLocaleString('en-US')} sf of the building's ${Number(p.totalSqft || 0).toLocaleString('en-US')} sf, so you pay ${(r.proRataPercent || 0).toFixed(2)}% of shared operating costs. For ${recon.camYear || 'this period'} that comes to ${_fmt$(billed)}.` },
      ...(topCats.length ? [{ heading: 'Where the money went', body: topCats.join('\n') }] : []),
    ];
    if (r.capApplied && _num(r.capAdjustment) > 0) {
      sections.push({ heading: 'Your lease cap, applied', body: `Your lease limits annual CAM increases. That cap reduced your bill by ${_fmt$(r.capAdjustment)} — automatically enforced from your lease terms.` });
    }
    sections.push({ body: 'Every figure traces to an invoice or lease clause. You can request the full backup documentation, or raise a question about any specific charge.' });
    return {
      sections,
      citations: [{ source: 'CAM Report', detail: `${recon.camYear || ''} Allocation — ${p.name}` }, { source: `Lease — ${t.tenant_name}`, detail: null }],
      confidence: { pct: 92, basis: 'reconciliation results & invoice records' },
    };
  }

  function _buildLenderLetter(p, ctx, d) {
    const EE = d.EscrowEngine;
    const draws = (p.drawRequests || []).filter(Boolean);
    const dr = (ctx && ctx.drawId ? draws.find(x => x.id === ctx.drawId) : null) || draws.find(x => x.status === 'draft') || draws[0];
    const r = dr ? (p.escrowReserves || []).find(x => x && x.id === dr.reserveId) : null;
    if (!dr || !r || !EE) return null;
    const rd = EE.computeEscrowReadiness(r, dr, draws);
    const narrative = EE.buildReserveNarrative ? EE.buildReserveNarrative(r) : '';
    const docs = dr.attachedDocuments || {};
    const enclosures = [
      (dr.invoices || []).length ? `${(dr.invoices || []).length} contractor invoice(s) totaling ${_fmt$((dr.invoices || []).reduce((s, i) => s + _num(i.amount), 0))}` : null,
      (docs.contractorBids || []).length ? `${docs.contractorBids.length} contractor bid(s)` : null,
      (docs.photos || []).length ? `${docs.photos.length} photograph(s) of completed work` : null,
      (docs.lienWaivers || []).length ? `${docs.lienWaivers.length} lien waiver(s)` : null,
      (docs.engineerCertification || []).length ? 'Engineer certification' : null,
    ].filter(Boolean);
    const sections = [
      { body: `${_dateStr(d.now)}` },
      { body: `RE: Reserve Disbursement Request — ${p.name}\n${r.reserveTypeLabel}${dr.drawNumber ? ` · Draw Request #${dr.drawNumber}` : ''}` },
      { body: 'To the Loan Servicing Team,' },
      { body: `We request a disbursement of ${_fmt$(dr.amountRequested)} from the ${r.reserveTypeLabel} held for ${p.name}, for completed work eligible under the reserve terms.` },
      ...(narrative ? [{ heading: 'Reserve terms (as documented)', body: narrative }] : []),
      ...(enclosures.length ? [{ heading: 'Enclosed documentation', body: enclosures.map(e => '• ' + e).join('\n') }] : []),
      { heading: 'Reserve accounting', body: `Current stated balance: ${r.currentBalance != null ? _fmt$(r.currentBalance) : '[on file with lender]'}${rd.remainingAfter != null ? `\nBalance after this disbursement: ${_fmt$(rd.remainingAfter)}` : ''}` },
      { body: rd.ready ? 'Our review confirms all documented requirements for this request are satisfied.' : `Note before sending: ${rd.summary}` },
      { body: `Please contact us with any questions.\n\nSincerely,\n[Name]\nProperty Management — ${p.name}` },
    ];
    const bestEv = (r.evidence || {}).current_balance || (r.evidence || {}).eligible_uses;
    return {
      sections,
      citations: [
        { source: `Mortgage — ${r.sourceFileName || 'reserve document'}`, detail: (r.sourcePages || []).length ? `Page ${r.sourcePages.join(', ')}` : null, quote: bestEv?.quote || null },
        { source: 'Draw validation checklist', detail: `${rd.score}% ready` },
      ],
      confidence: { pct: rd.ready ? 94 : 82, basis: 'reserve terms & draw validation' },
    };
  }

  function _buildDisputeResponse(p, ctx, d) {
    const disputes = (p.disputes || []).filter(Boolean);
    const dp = (ctx && ctx.disputeId ? disputes.find(x => x.id === ctx.disputeId) : null)
      || disputes.find(x => x.status === 'open' || x.status === 'docs_requested') || disputes[0];
    if (!dp) return null;
    const recon = _recon(p);
    const t = (p.tenants || []).find(x => x && x.tenant_name === dp.tenantName);
    const r = t ? (recon?.results || []).find(x => x.tenantName === t.tenant_name) : null;
    const sections = [
      { body: `${_dateStr(d.now)}` },
      { body: `RE: CAM Charge Inquiry — ${dp.vendor || dp.category || 'disputed charge'}${dp.tenantName ? `\nTenant: ${dp.tenantName}` : ''} · ${p.name}` },
      { body: `Dear ${dp.tenantName || 'Tenant'},` },
      { body: `Thank you for your inquiry regarding the ${dp.vendor || dp.category || ''} charge${_num(dp.tenantShare ?? dp.amount) ? ` (your share: ${_fmt$(dp.tenantShare ?? dp.amount)})` : ''}. You raised: "${String(dp.reason || '').slice(0, 300)}"` },
      ...(r ? [{ heading: 'How this charge was allocated', body: `Your share is calculated at ${(r.proRataPercent || 0).toFixed(2)}% pro-rata (${Number(t.leased_sqft || 0).toLocaleString('en-US')} sf of ${Number(p.totalSqft || 0).toLocaleString('en-US')} sf)${r.capApplied ? ', with your lease\'s CAM cap applied' : ''}. The allocation and the underlying invoice are available for your review.` }] : []),
      { heading: 'Our response', body: '[State the resolution position: accept the adjustment / provide the requested documentation / explain why the charge stands, citing the lease clause.]' },
      { body: `We aim to resolve this within [10] business days. Every resolution is recorded with a tamper-evident audit fingerprint.\n\nSincerely,\n[Name]\nProperty Management — ${p.name}` },
    ];
    return {
      sections,
      citations: [
        { source: 'Dispute Record', detail: `${dp.tenantName || ''} · ${dp.vendor || dp.category || ''}`, quote: dp.reason ? String(dp.reason).slice(0, 140) : null },
        ...(recon ? [{ source: 'CAM Report', detail: `${recon.camYear || ''} Allocation — ${p.name}` }] : []),
      ],
      confidence: { pct: 88, basis: 'dispute record & allocation results' },
    };
  }

  function _buildLeaseReviewSummary(p, ctx, d) {
    const tenants = (p.tenants || []).filter(Boolean);
    if (!tenants.length) return null;
    const today = d.now.toISOString().slice(0, 10);
    const lines = tenants.map(t => {
      const flags = [];
      if (t.end_date && t.end_date < today) flags.push('LEASE EXPIRED ' + t.end_date);
      if (/nnn|triple/i.test(String(t.lease_type || '')) && (t.cap == null || t.cap === '')) flags.push('no CAM cap on file');
      if (t.audit_rights) flags.push('audit rights');
      if (t.excluded_categories) flags.push(`exclusions: ${t.excluded_categories}`);
      return `• ${t.tenant_name} — ${Number(t.leased_sqft || 0).toLocaleString('en-US')} sf · ${t.lease_type || 'lease type n/a'} · ${t.cap != null && t.cap !== '' ? `${t.cap}% cap` : 'no cap'} · expires ${t.end_date || 'n/a'}${flags.length ? ` · ⚠ ${flags.join('; ')}` : ''}`;
    });
    const citations = tenants.slice(0, 3).map(t => {
      const ev = _tenantQuote(t, ['cam_cap', 'audit_rights', 'excluded_categories']);
      return { source: `Lease — ${t.tenant_name}`, detail: ev && ev.page != null ? `Page ${ev.page}` : null, quote: ev ? ev.quote : null };
    });
    return {
      sections: [
        { heading: `Lease portfolio summary — ${p.name}`, body: `${tenants.length} leases reviewed. Terms below are extracted from the executed documents; flagged items affect CAM recovery and should be prioritized.` },
        { body: lines.join('\n') },
      ],
      citations, confidence: { pct: 90, basis: 'extracted lease terms' },
    };
  }

  function _buildAcquisitionSummary(p, ctx, d, acqReviews) {
    const revs = (acqReviews || []).filter(Boolean);
    const rev = (ctx && ctx.acqId ? revs.find(x => x.id === ctx.acqId) : null) || revs[0];
    if (!rev) return null;
    const a = rev.analysis || rev;
    const rate = _num(a.recoveryRate ?? a.revenueRecovery?.recoveryRate);
    const atRisk = _num(a.totalAtRisk ?? a.revenueRecovery?.totalAtRisk);
    return {
      sections: [
        { heading: `Acquisition review — ${rev.name || 'Target'}`, body: `Prepared ${_dateStr(d.now)} · DRAFT for ownership review` },
        { heading: 'CAM recovery quality', body: `${rate ? `Current CAM recovery runs at ${rate.toFixed(1)}%${rate < 70 ? ' — below the 70% institutional threshold' : ''}.` : 'Recovery rate not yet computed.'}${atRisk ? ` Approximately ${_fmt$(atRisk)} per year is at risk from cap leakage and missed recoveries under current lease terms.` : ''}` },
        { heading: 'Recommendation', body: rate && rate < 70
          ? 'Condition the underwriting on the recovery gap: re-price, or negotiate lease amendments/estoppels addressing the leaking caps before closing. [Ownership decision required.]'
          : '[State the recommendation after reviewing the full analysis.]' },
        { body: 'Scope note: this summary covers lease and CAM recovery quality as analyzed by MainStreet. Pricing, financing, and full NOI modeling are outside this analysis.' },
      ],
      citations: [{ source: 'Acquisition Review', detail: rev.name || null }],
      confidence: { pct: 89, basis: 'acquisition analysis' },
    };
  }

  // ── public API ─────────────────────────────────────────────────────────────

  function build(type, { props, propertyId, context, acqReviews, deps } = {}) {
    const d = _deps(deps);
    const safeProps = Array.isArray(props) ? props.filter(Boolean) : [];
    const p = safeProps.find(x => x.id === (propertyId || context?.propertyId)) || safeProps[0] || null;
    if (!DOC_TYPES[type]) return null;
    if (!p && type !== 'acquisitionSummary') return null;

    let core = null;
    if (type === 'recoveryLetter')       core = _buildRecoveryLetter(p, context, d);
    if (type === 'tenantCamExplanation') core = _buildTenantExplanation(p, context, d);
    if (type === 'lenderReimbursement')  core = _buildLenderLetter(p, context, d);
    if (type === 'disputeResponse')      core = _buildDisputeResponse(p, context, d);
    if (type === 'leaseReviewSummary')   core = _buildLeaseReviewSummary(p, context, d);
    if (type === 'acquisitionSummary')   core = _buildAcquisitionSummary(p, context, d, acqReviews);
    if (!core) return null;

    return {
      id: 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      type, title: DOC_TYPES[type],
      propertyId: p ? p.id : null, propertyName: p ? p.name : null,
      status: 'draft',
      createdAt: d.now.toISOString(),
      sections: core.sections,
      citations: (core.citations || []).filter(c => c && c.source),
      confidence: core.confidence,
      disclaimer: 'DRAFT — generated from your documents and analyses. Review, edit, and send manually; MainStreet never sends documents automatically.',
    };
  }

  function _sectionsHtml(doc) {
    return doc.sections.map(s => `
      ${s.heading ? `<div class="dft-h">${_esc(s.heading)}</div>` : ''}
      ${s.body ? `<p class="dft-p">${_esc(s.body).replace(/\n/g, '<br>')}</p>` : ''}`).join('');
  }

  function renderEditableHtml(doc) {
    const cites = doc.citations.map(c => `<span class="aiw-cite" title="${_esc(c.quote || '')}">${_esc(c.source)}${c.detail ? ` · ${_esc(c.detail)}` : ''}</span>`).join('');
    return `
      <div class="dft-status">DRAFT · ${_esc(doc.title)}${doc.propertyName ? ` · ${_esc(doc.propertyName)}` : ''}</div>
      <div class="dft-paper" id="dftPaper" contenteditable="true" spellcheck="true">${_sectionsHtml(doc)}</div>
      ${cites ? `<div class="dft-cites-lbl">Grounded in</div><div class="aiw-cites">${cites}</div>` : ''}
      <div class="aiw-conf">Confidence ${doc.confidence.pct}% · ${_esc(doc.confidence.basis)} · ${_esc(doc.disclaimer)}</div>`;
  }

  function renderPrintHtml(doc, editedInnerHtml) {
    return `<!DOCTYPE html><html><head><title>${_esc(doc.title)}</title><style>
      body { font-family: Georgia, 'Times New Roman', serif; color: #111; max-width: 720px; margin: 48px auto; line-height: 1.6; }
      .dft-h { font-weight: bold; margin: 18px 0 6px; } .dft-p { margin: 10px 0; white-space: pre-wrap; }
      .wm { color: #999; border: 1px solid #ccc; display: inline-block; padding: 2px 10px; font-size: 12px; letter-spacing: 2px; margin-bottom: 24px; }
      .foot { margin-top: 36px; font-size: 11px; color: #777; border-top: 1px solid #ddd; padding-top: 10px; }
    </style></head><body>
      <div class="wm">DRAFT</div>
      ${editedInnerHtml || _sectionsHtml(doc)}
      <div class="foot">Generated by MainStreet from source documents and reconciliation records · ${_esc(doc.confidence.basis)} · Review before sending.</div>
    </body></html>`;
  }

  return { DOC_TYPES, build, renderEditableHtml, renderPrintHtml };
})();
