'use strict';
/**
 * escrow-draw-packets.js — Phase 21: Escrow Draw Request Package (HTML)
 *
 * Pure module — no DOM, no global state mutations, no network.
 * Formats the structured package returned by
 * EscrowReserveEngine.buildDrawRequestPackage(...) into printable HTML,
 * mirroring the lease-intelligence / lease-review-packets split: the engine
 * produces data, this module formats it for the print/PDF surface (openReport
 * + window.print(), same as every other report in the app).
 *
 * Exposes: window.EscrowDrawPackets
 */
window.EscrowDrawPackets = (() => {

  function _esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _fmt(n) {
    const num = parseFloat(n);
    if (!Number.isFinite(num)) return '—';
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (_) { return String(d); }
  }

  // ── Cover letter ──────────────────────────────────────────────────────────
  function _coverLetter(pkg) {
    const propName  = pkg.property?.name || 'Property';
    const reserveType = pkg.reserve?.type || 'Reserve';
    const amount    = _fmt(pkg.drawRequest?.amountRequested);
    const today     = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `
    <div class="rpt-section-title">Cover Letter</div>
    <div style="line-height:1.7;font-size:0.92rem;color:#1a1a1a;">
      <p>${_esc(today)}</p>
      <p>RE: Escrow Draw Request — ${_esc(propName)} — ${_esc(reserveType)}</p>
      <p>To Whom It May Concern,</p>
      <p>This package requests a draw of <strong>${amount}</strong> from the ${_esc(reserveType)}
      held for <strong>${_esc(propName)}</strong>, supported by the invoices and documentation
      enclosed in this submission. Please see the Validation Checklist below confirming all
      applicable reserve requirements have been satisfied for this request.</p>
      <p>Sincerely,<br/>Property Management</p>
    </div>`;
  }

  // ── Property + reserve information ──────────────────────────────────────
  function _propertyAndReserveInfo(pkg) {
    const p = pkg.property || {};
    const r = pkg.reserve;
    const rows = [
      { label: 'Property',        value: p.name || '—' },
      { label: 'Total Sq Ft',     value: p.totalSqft != null ? Number(p.totalSqft).toLocaleString('en-US') + ' sf' : '—' },
      { label: 'Reserve Type',    value: r ? r.type : '—' },
      { label: 'Current Balance', value: r ? _fmt(r.currentBalance) : '—' },
      { label: 'Eligible Uses',   value: r?.eligibleUses || '—' },
    ];
    if (r?.deadlines) {
      if (r.deadlines.drawRequestDeadline)      rows.push({ label: 'Draw Request Deadline',      value: _fmtDate(r.deadlines.drawRequestDeadline) });
      if (r.deadlines.repairCompletionDeadline) rows.push({ label: 'Repair Completion Deadline',  value: _fmtDate(r.deadlines.repairCompletionDeadline) });
      if (r.deadlines.reserveExpirationDate)    rows.push({ label: 'Reserve Expiration',          value: _fmtDate(r.deadlines.reserveExpirationDate) });
    }
    const trs = rows.map(row => `<tr><td>${_esc(row.label)}</td><td>${_esc(row.value)}</td></tr>`).join('');
    return `
    <div class="rpt-section-title">Property &amp; Reserve Information</div>
    <table class="rpt-table"><tbody>${trs}</tbody></table>`;
  }

  // ── Invoice summary ───────────────────────────────────────────────────────
  function _invoiceSummary(pkg) {
    const invoices = pkg.invoiceSummary?.invoices || [];
    if (invoices.length === 0) {
      return `<div class="rpt-section-title">Invoice Summary</div><p style="color:#94A3B8;font-size:0.85rem;">No invoices attached.</p>`;
    }
    const rows = invoices.map(inv => `<tr>
      <td>${_esc(inv.vendorName || inv.fileName || 'Vendor')}</td>
      <td>${_esc(inv.invoiceDate || '—')}</td>
      <td>${_fmt(inv.amount)}</td>
    </tr>`).join('');
    return `
    <div class="rpt-section-title">Invoice Summary</div>
    <table class="rpt-table">
      <thead><tr><th>Vendor</th><th>Date</th><th>Amount</th></tr></thead>
      <tbody>${rows}
      <tr class="total-row"><td colspan="2"><strong>Total Requested</strong></td><td><strong>${_fmt(pkg.invoiceSummary?.total)}</strong></td></tr>
      </tbody>
    </table>`;
  }

  // ── Supporting documents ─────────────────────────────────────────────────
  function _supportingDocuments(pkg) {
    const docs = pkg.supportingDocuments || [];
    if (docs.length === 0) {
      return `<div class="rpt-section-title">Supporting Documents</div><p style="color:#94A3B8;font-size:0.85rem;">No supporting documents attached.</p>`;
    }
    const rows = docs.map(d => `<tr><td>${_esc(d.category)}</td><td>${_esc(d.fileName || '—')}</td></tr>`).join('');
    return `
    <div class="rpt-section-title">Supporting Documents</div>
    <table class="rpt-table"><thead><tr><th>Category</th><th>File</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ── Validation checklist ─────────────────────────────────────────────────
  function _validationChecklist(pkg) {
    const items = pkg.validationChecklist || [];
    const rows = items.map(c => `<tr>
      <td>${c.met ? '✅' : '❌'} ${_esc(c.label)}</td>
      <td>${c.met ? 'Satisfied' : _esc(c.detail || 'Missing')}</td>
    </tr>`).join('');
    const banner = pkg.complete
      ? `<div style="background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;padding:10px 14px;border-radius:6px;font-weight:700;margin-bottom:12px;">✅ All reserve requirements satisfied — this package is lender-ready.</div>`
      : `<div style="background:#fef2f2;border:1px solid #fca5a5;color:#7f1d1d;padding:10px 14px;border-radius:6px;font-weight:700;margin-bottom:12px;">⚠️ DRAFT — NOT LENDER-READY. One or more requirements below are unmet.</div>`;
    return `
    <div class="rpt-section-title">Validation Checklist</div>
    ${banner}
    <table class="rpt-table"><thead><tr><th>Requirement</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ── Full package HTML ────────────────────────────────────────────────────
  function formatDrawPackageHtml(pkg) {
    if (!pkg) return '<p>No draw request package available.</p>';
    const propName = pkg.property?.name || 'Property';
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const reportType = pkg.complete ? 'Escrow Draw Request Package' : 'Escrow Draw Request Package (Draft)';

    return `
    <div class="rpt-cover">
      <div class="rpt-cover-brand">Mainstreet CAM Platform</div>
      <div class="rpt-cover-title">${_esc(propName)}</div>
      <div class="rpt-cover-type">${_esc(reportType)}</div>
      <div class="rpt-cover-meta">
        <div class="rpt-cover-meta-item"><span>Generated</span><span>${_esc(now)}</span></div>
        <div class="rpt-cover-meta-item"><span>Amount Requested</span><span>${_fmt(pkg.drawRequest?.amountRequested)}</span></div>
        <div class="rpt-cover-meta-item"><span>Status</span><span>${_esc(pkg.drawRequest?.status || 'draft')}</span></div>
      </div>
    </div>
    ${_coverLetter(pkg)}
    ${_propertyAndReserveInfo(pkg)}
    ${_invoiceSummary(pkg)}
    ${_supportingDocuments(pkg)}
    ${_validationChecklist(pkg)}
    <div class="rpt-footer">
      <span class="rpt-footer-brand">Mainstreet CAM Platform</span>
      <span>${_esc(propName)} &nbsp;&middot;&nbsp; ${_esc(reportType)}</span>
      <span>Generated ${_esc(now)}</span>
    </div>`;
  }

  return {
    formatDrawPackageHtml,
  };

})();
