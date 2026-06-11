'use strict';

// ─── Acquisition Due Diligence Engine ────────────────────────────────────────
// All functions are pure — no DOM access, no global state, no side effects.
// Input shapes mirror the existing tenant/invoice structures used in script.js
// so callers can pass data directly without conversion.

(function (root) {

  // ─── Tenant Matching ──────────────────────────────────────────────────────
  // Matches an invoice to the best-fitting tenant using unit number and name.
  // Identical algorithm to matchInvoiceToTenant in script.js — pure copy with
  // no global state dependency.

  function matchInvoiceToTenant(invoice, tenants) {
    const text = [invoice.vendorName, invoice.category, invoice.invoiceDate]
      .filter(Boolean).join(' ').toLowerCase();
    let bestMatch = null;
    let bestConf  = 0;

    for (const t of tenants) {
      let conf   = 0;
      let reason = '';
      const name = t.tenantName || t.tenant_name || '';
      const unit = t.unitNumber || t.unit_number || '';
      const unitHit = !!(unit && text.includes(unit.toLowerCase()));
      const nameHit = !!(name && text.includes(name.toLowerCase()));
      if (unitHit) { conf = 90; reason = `Unit ${unit}`; }
      if (nameHit && conf < 75) { conf = 75; reason = name; }
      if (conf > bestConf) {
        bestConf  = conf;
        bestMatch = { tenantName: name, tenantId: t.id || null, confidence: conf, reason };
      }
    }
    return bestMatch;
  }

  // ─── Tenant Matching Quality ──────────────────────────────────────────────

  function tenantMatchingAnalysis(tenants, invoices) {
    if (!invoices.length) return { matched: 0, shared: 0, unmatched: 0, matchRate: 0 };
    let matched = 0;
    let shared  = 0;
    for (const inv of invoices) {
      const m = matchInvoiceToTenant(inv, tenants);
      if (!m)         { shared++;  continue; }
      if (m.confidence >= 75) matched++;
      else                    shared++;
    }
    return {
      matched,
      shared,
      unmatched: 0,
      matchRate: parseFloat(((matched / invoices.length) * 100).toFixed(1)),
    };
  }

  // ─── Acquisition Reconciliation ───────────────────────────────────────────
  // Pure version of runFullReconciliation — no global state, no currentProperty().
  // Returns one result object per tenant.

  function runAcquisitionReconciliation(tenants, invoices, totalSqFt) {
    if (!tenants.length || !invoices.length || !totalSqFt) return [];

    const tagged = invoices.map(inv => {
      const m = matchInvoiceToTenant(inv, tenants);
      return { ...inv, _matchedTenant: m ? m.tenantName : null,
                       _matchedId:     m ? m.tenantId   : null,
                       _matchConf:     m ? m.confidence : 0 };
    });

    const direct = tagged.filter(inv => inv._matchConf >= 75);
    const shared = tagged.filter(inv => inv._matchConf  < 75);

    const totalExpenses = invoices.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);

    return tenants.map(t => {
      const name   = t.tenantName || t.tenant_name || '';
      const sqFt   = parseFloat(t.leased_sqft || t.sqFt || t.sqft || 0);
      const proRata = totalSqFt > 0 ? sqFt / totalSqFt : 0;

      const excluded = _parseExcluded(t);

      const eligibleShared = shared.filter(inv =>
        !excluded.includes((inv.category || '').toLowerCase())
      );
      const sharedTotal = eligibleShared.reduce(
        (s, inv) => s + (parseFloat(inv.amount) || 0), 0
      ) * proRata;

      const ownInvoices = direct.filter(inv =>
        (inv._matchedId     && t.id && inv._matchedId     === t.id) ||
        (inv._matchedTenant && inv._matchedTenant === name)
      );
      const ownTotal = ownInvoices.reduce(
        (s, inv) => s + (parseFloat(inv.amount) || 0), 0
      );

      let raw       = sharedTotal + ownTotal;
      let capApplied = false;
      let capLeakage = 0;

      const capPct  = parseFloat(t.cam_cap || t.capPercentage || 0);
      const capBase = parseFloat(t.capBaseAmount || 0);
      if (capPct > 0 && capBase > 0) {
        const cap = capBase * (1 + capPct / 100);
        if (raw > cap) { capLeakage = raw - cap; raw = cap; capApplied = true; }
      }

      const fullLiability = parseFloat((totalExpenses * proRata).toFixed(2));

      return {
        tenantId:           t.id || null,
        tenantName:         name,
        unitNumber:         t.unitNumber || t.unit_number || '',
        sqFt,
        proRataPct:         parseFloat((proRata * 100).toFixed(2)),
        allocatedAmount:    parseFloat(raw.toFixed(2)),
        fullLiability,
        capApplied,
        capLeakage:         parseFloat(capLeakage.toFixed(2)),
        excludedCategories: excluded,
        sharedTotal:        parseFloat(sharedTotal.toFixed(2)),
        ownTotal:           parseFloat(ownTotal.toFixed(2)),
        invoiceCount:       eligibleShared.length + ownInvoices.length,
        leaseType:          t.lease_type || t.leaseType || null,
        auditRights:        t.audit_rights,
        leaseEndDate:       t.end_date || t.lease_end_date || null,
        renewalOptions:     t.renewal_options || null,
      };
    });
  }

  // ─── Underbilling Analysis ────────────────────────────────────────────────
  // Gap between each tenant's full pro-rata liability and actual allocated amount.
  // Cause: 'cap' | 'exclusions' | 'partial_match' | 'none'

  function underbillingAnalysis(reconResults) {
    return reconResults.map(r => {
      const gap    = parseFloat(Math.max(0, r.fullLiability - r.allocatedAmount).toFixed(2));
      const gapPct = r.fullLiability > 0
        ? parseFloat(((gap / r.fullLiability) * 100).toFixed(1))
        : 0;
      const cause  = r.capApplied                    ? 'cap'
                   : r.excludedCategories.length > 0 ? 'exclusions'
                   : gap > 0.01                      ? 'partial_match'
                   : 'none';
      return {
        tenantName:      r.tenantName,
        tenantId:        r.tenantId,
        fullLiability:   r.fullLiability,
        allocatedAmount: r.allocatedAmount,
        gap,
        gapPct,
        cause,
        capApplied:      r.capApplied,
      };
    });
  }

  // ─── Cap Leakage Analysis ─────────────────────────────────────────────────
  // Monthly leakage (single invoice pool) and annualized projection.

  function capLeakageAnalysis(reconResults) {
    const leaking      = reconResults.filter(r => r.capApplied && r.capLeakage > 0);
    const totalLeakage = leaking.reduce((s, r) => s + r.capLeakage, 0);
    return {
      totalLeakage:     parseFloat(totalLeakage.toFixed(2)),
      annualizedTotal:  parseFloat((totalLeakage * 12).toFixed(2)),
      affectedTenants:  leaking.map(r => ({
        tenantName:         r.tenantName,
        tenantId:           r.tenantId,
        capLeakage:         r.capLeakage,
        annualizedLeakage:  parseFloat((r.capLeakage * 12).toFixed(2)),
      })),
    };
  }

  // ─── Exclusion Analysis ───────────────────────────────────────────────────
  // Flags non-standard exclusions that limit CAM recoverability.

  function exclusionAnalysis(tenants, invoices) {
    const NON_STANDARD = [
      'management fee', 'management fees', 'capital', 'structural',
      'roof', 'foundation', 'parking', 'depreciation', 'mortgage',
    ];

    return tenants.map(t => {
      const name    = t.tenantName || t.tenant_name || '';
      const excl    = _parseExcluded(t);
      const unusual = excl.filter(e => NON_STANDARD.some(f => e.includes(f)));

      const excludedAmt = invoices
        .filter(inv => excl.includes((inv.category || '').toLowerCase()))
        .reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);

      return {
        tenantName:            name,
        tenantId:              t.id || null,
        exclusionList:         excl,
        unusualExclusions:     unusual,
        hasUnusualExclusions:  unusual.length > 0,
        excludedInvoiceTotal:  parseFloat(excludedAmt.toFixed(2)),
      };
    }).filter(r => r.exclusionList.length > 0);
  }

  // ─── Audit Window Analysis ────────────────────────────────────────────────

  function auditWindowAnalysis(tenants) {
    const now = Date.now();
    return tenants.map(t => {
      const name      = t.tenantName || t.tenant_name || '';
      const hasRights = t.audit_rights === true || t.audit_rights === 'true';
      const endDate   = t.end_date || t.lease_end_date || null;
      let daysToExpiry = null;
      if (endDate) {
        daysToExpiry = Math.round((new Date(endDate).getTime() - now) / 86400000);
      }
      const windowStatus = !hasRights          ? 'none'
                         : daysToExpiry === null ? 'unknown'
                         : daysToExpiry < 0      ? 'expired'
                         : daysToExpiry < 365    ? 'closing'
                         : 'open';
      return {
        tenantName:   name,
        tenantId:     t.id || null,
        hasAuditRights: hasRights,
        leaseEndDate: endDate,
        daysToExpiry,
        windowStatus,
      };
    });
  }

  // ─── Operational vs Structural Gap ───────────────────────────────────────
  // Structural: caused by lease terms (permanent).
  // Operational: caused by matching / data gaps (recoverable).

  function operationalVsStructuralGap(underbilling) {
    let structural  = 0;
    let operational = 0;
    for (const r of underbilling) {
      if (r.cause === 'cap' || r.cause === 'exclusions') structural  += r.gap;
      else if (r.cause === 'partial_match')              operational += r.gap;
    }
    return {
      structural:             parseFloat(structural.toFixed(2)),
      operational:            parseFloat(operational.toFixed(2)),
      total:                  parseFloat((structural + operational).toFixed(2)),
      annualizedStructural:   parseFloat((structural  * 12).toFixed(2)),
      annualizedOperational:  parseFloat((operational * 12).toFixed(2)),
    };
  }

  // ─── Full Acquisition Report ──────────────────────────────────────────────

  function buildAcquisitionReport(tenants, invoices, totalSqFt) {
    if (!tenants.length || !invoices.length) {
      return {
        error: 'Insufficient data — upload leases and invoices first',
        tenants: tenants.length,
        invoices: invoices.length,
      };
    }

    const recon       = runAcquisitionReconciliation(tenants, invoices, totalSqFt);
    const underbilling = underbillingAnalysis(recon);
    const caps        = capLeakageAnalysis(recon);
    const exclusions  = exclusionAnalysis(tenants, invoices);
    const auditWindows = auditWindowAnalysis(tenants);
    const gap         = operationalVsStructuralGap(underbilling);
    const matching    = tenantMatchingAnalysis(tenants, invoices);

    const totalExpenses  = invoices.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);
    const totalRecovered = recon.reduce((s, r) => s + r.allocatedAmount, 0);
    const recoveryRate   = totalExpenses > 0
      ? parseFloat(((totalRecovered / totalExpenses) * 100).toFixed(1))
      : 0;

    const openAuditWindows       = auditWindows.filter(a => a.windowStatus === 'open' || a.windowStatus === 'closing').length;
    const unusualExclusionTenants = exclusions.filter(e => e.hasUnusualExclusions).length;

    const topRisks = [
      caps.annualizedTotal > 0 && {
        type:         'cap_leakage',
        label:        'CAM Cap Leakage',
        annualImpact: caps.annualizedTotal,
        detail:       `${caps.affectedTenants.length} tenant(s) have caps limiting monthly recovery`,
      },
      gap.annualizedStructural > 0 && {
        type:         'structural_gap',
        label:        'Structural Lease Gap',
        annualImpact: gap.annualizedStructural,
        detail:       'Lease terms permanently limit CAM recovery potential',
      },
      gap.annualizedOperational > 0 && {
        type:         'operational_gap',
        label:        'Operational Gap',
        annualImpact: gap.annualizedOperational,
        detail:       'Invoice matching gaps — addressable through better billing practices',
      },
      unusualExclusionTenants > 0 && {
        type:         'unusual_exclusions',
        label:        'Non-Standard CAM Exclusions',
        annualImpact: null,
        detail:       `${unusualExclusionTenants} tenant(s) have unusual exclusion language`,
      },
    ].filter(Boolean).sort((a, b) => (b.annualImpact || 0) - (a.annualImpact || 0));

    return {
      summary: {
        tenantCount:             tenants.length,
        invoiceCount:            invoices.length,
        totalExpenses:           parseFloat(totalExpenses.toFixed(2)),
        totalRecovered:          parseFloat(totalRecovered.toFixed(2)),
        recoveryRate,
        annualMissedRecovery:    parseFloat((gap.total * 12).toFixed(2)),
        capLeakageAnnualized:    caps.annualizedTotal,
        openAuditWindows,
        unusualExclusionTenants,
        matchRate:               matching.matchRate,
      },
      reconciliation:  recon,
      underbilling,
      capLeakage:      caps,
      exclusions,
      auditWindows,
      gap,
      topRisks,
      generatedAt:     new Date().toISOString(),
    };
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────────

  function _parseExcluded(t) {
    if (Array.isArray(t.excludedCategories)) return t.excludedCategories;
    const raw = t.excluded_categories || t.excludedCategories || '';
    if (!raw) return [];
    return String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  // ─── Exports ──────────────────────────────────────────────────────────────

  const AcquisitionEngine = {
    matchInvoiceToTenant,
    tenantMatchingAnalysis,
    runAcquisitionReconciliation,
    underbillingAnalysis,
    capLeakageAnalysis,
    exclusionAnalysis,
    auditWindowAnalysis,
    operationalVsStructuralGap,
    buildAcquisitionReport,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AcquisitionEngine;
  } else {
    root.AcquisitionEngine = AcquisitionEngine;
  }

}(typeof window !== 'undefined' ? window : global));
