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
    const tenantSummary = tenants.map(normalizeAcqTenant);
    const rentRoll = {
      occupancy:          occupancyAnalysis(tenantSummary, totalSqFt),
      expirationSchedule: leaseExpirationSchedule(tenantSummary),
      walt:               waltAnalysis(tenantSummary),
      rolloverRisk:       rolloverRiskAnalysis(tenantSummary, totalSqFt),
    };

    if (!tenants.length || !invoices.length) {
      return {
        error: 'Insufficient data — upload leases and invoices first',
        tenants: tenants.length,
        invoices: invoices.length,
        tenantSummary,
        rentRoll,
      };
    }

    const recon        = runAcquisitionReconciliation(tenants, invoices, totalSqFt);
    const underbilling = underbillingAnalysis(recon);
    const caps         = capLeakageAnalysis(recon);
    const exclusions   = exclusionAnalysis(tenants, invoices);
    const auditWindows = auditWindowAnalysis(tenants);
    const gap          = operationalVsStructuralGap(underbilling);
    const matching     = tenantMatchingAnalysis(tenants, invoices);
    const renewalRisk  = renewalRiskAnalysis(tenants);
    const proRataRisk  = proRataRiskAnalysis(tenants);

    const totalExpenses  = invoices.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);
    const totalRecovered = recon.reduce((s, r) => s + r.allocatedAmount, 0);
    const recoveryRate   = totalExpenses > 0
      ? parseFloat(((totalRecovered / totalExpenses) * 100).toFixed(1))
      : 0;

    const openAuditWindows        = auditWindows.filter(a => a.windowStatus === 'open' || a.windowStatus === 'closing').length;
    const unusualExclusionTenants = exclusions.filter(e => e.hasUnusualExclusions).length;
    const criticalRenewalCount    = renewalRisk.filter(r => r.riskLevel === 'critical' || r.riskLevel === 'high').length;

    const partialReport = { capLeakage: caps, exclusions, auditWindows, underbilling, renewalRisk };
    const findings      = buildFindingsWithCitations(partialReport, tenants);

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
      criticalRenewalCount > 0 && {
        type:         'renewal_risk',
        label:        'Lease Expiry Risk',
        annualImpact: null,
        detail:       `${criticalRenewalCount} tenant(s) have leases expiring within 12 months or already expired`,
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
        criticalRenewalCount,
      },
      reconciliation:  recon,
      underbilling,
      capLeakage:      caps,
      exclusions,
      auditWindows,
      gap,
      renewalRisk,
      proRataRisk,
      findings,
      topRisks,
      tenantSummary,
      rentRoll,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Rent Roll Analytics ─────────────────────────────────────────────────

  function occupancyAnalysis(tenantSummary, buildingSqft) {
    const bsqft    = parseFloat(buildingSqft) || 0;
    const occupied = tenantSummary.reduce((s, t) => s + (parseFloat(t.leased_sqft) || 0), 0);
    const vacant   = Math.max(0, bsqft - occupied);
    const occRate  = bsqft > 0 ? parseFloat(((occupied / bsqft) * 100).toFixed(1)) : 0;
    const vacRate  = bsqft > 0 ? parseFloat((100 - occRate).toFixed(1)) : 100;
    return { buildingSqft: bsqft, occupiedSqft: occupied, vacantSqft: vacant,
             occupancyRate: occRate, vacancyRate: vacRate };
  }

  function leaseExpirationSchedule(tenantSummary) {
    const byYear = {};
    for (const t of tenantSummary) {
      if (!t.lease_end) continue;
      const yr = new Date(t.lease_end + 'T12:00:00').getFullYear();
      if (isNaN(yr)) continue;
      if (!byYear[yr]) byYear[yr] = { year: yr, count: 0, sqft: 0, tenants: [] };
      byYear[yr].count++;
      byYear[yr].sqft += parseFloat(t.leased_sqft) || 0;
      byYear[yr].tenants.push(t.tenant_name);
    }
    return Object.values(byYear).sort((a, b) => a.year - b.year);
  }

  function waltAnalysis(tenantSummary, referenceDate) {
    const ref    = referenceDate ? new Date(referenceDate) : new Date();
    const MS_YR  = 365.25 * 24 * 3600 * 1000;
    let weighted = 0, totalSqft = 0;
    for (const t of tenantSummary) {
      const sqft = parseFloat(t.leased_sqft) || 0;
      if (!t.lease_end || !sqft) continue;
      const remMs = new Date(t.lease_end + 'T12:00:00') - ref;
      if (remMs <= 0) continue;  // expired leases excluded
      weighted  += (remMs / MS_YR) * sqft;
      totalSqft += sqft;
    }
    if (totalSqft === 0) return { walt: null, waltMonths: null, weightedSqft: 0 };
    const walt       = parseFloat((weighted / totalSqft).toFixed(2));
    const waltMonths = Math.round(walt * 12);
    return { walt, waltMonths, weightedSqft: totalSqft };
  }

  function rolloverRiskAnalysis(tenantSummary, buildingSqft, referenceDate) {
    const ref   = referenceDate ? new Date(referenceDate) : new Date();
    const MS_12 = 365.25 * 24 * 3600 * 1000;
    const MS_24 = 2 * MS_12;
    const exp12 = { count: 0, sqft: 0, tenants: [] };
    const exp24 = { count: 0, sqft: 0, tenants: [] };
    let totalOccupied = 0;
    for (const t of tenantSummary) {
      const sqft = parseFloat(t.leased_sqft) || 0;
      totalOccupied += sqft;
      if (!t.lease_end) continue;
      const remMs = new Date(t.lease_end + 'T12:00:00') - ref;
      if (remMs <= MS_12) { exp12.count++; exp12.sqft += sqft; exp12.tenants.push(t.tenant_name); }
      if (remMs <= MS_24) { exp24.count++; exp24.sqft += sqft; exp24.tenants.push(t.tenant_name); }
    }
    const pct = sqft => totalOccupied > 0 ? parseFloat(((sqft / totalOccupied) * 100).toFixed(1)) : 0;
    exp12.pctOfOccupied = pct(exp12.sqft);
    exp24.pctOfOccupied = pct(exp24.sqft);
    return { expiring12: exp12, expiring24: exp24, totalOccupied };
  }

  // ─── Tenant Summary Normalization ────────────────────────────────────────
  // Projects the full tenant shape to the 9-field acquisition display schema.
  // Safe on pre-existing tenant objects that lack the newer fields — all null.

  function _deriveCamStructure(t) {
    const lt    = (t.lease_type || '').toUpperCase().trim();
    const cap   = t.cap != null ? t.cap : (t.cam_cap != null ? t.cam_cap : null);
    const parts = [];
    if (lt) parts.push(lt);
    if (cap != null && cap > 0) parts.push(cap + '% cap');
    if (t.admin_fee_pct != null && t.admin_fee_pct > 0) parts.push(t.admin_fee_pct + '% admin');
    if (t.gross_up_pct  != null && t.gross_up_pct  > 0) parts.push(t.gross_up_pct  + '% gross-up');
    if (t.expense_stop  != null && t.expense_stop  > 0) parts.push('$' + t.expense_stop + '/sf stop');
    const excl = (t.excluded_categories || t.excludedCategories || '').toString().trim();
    if (excl) parts.push('excl: ' + (excl.length > 40 ? excl.slice(0, 40) + '…' : excl));
    return parts.length ? parts.join(' · ') : null;
  }

  function normalizeAcqTenant(t) {
    return {
      tenant_name:      (t.tenant_name || t.tenantName || '').trim() || '(unnamed)',
      suite:            (t.suite || t.unit || t.unitNumber || '').trim() || null,
      leased_sqft:      t.leased_sqft != null ? Number(t.leased_sqft) : null,
      lease_start:      t.start_date  || t.lease_start || null,
      lease_end:        t.end_date    || t.lease_end   || null,
      base_rent:        t.base_rent        != null ? Number(t.base_rent)        : null,
      renewal_options:  t.renewal_options  || null,
      security_deposit: t.security_deposit != null ? Number(t.security_deposit) : null,
      cam_structure:    _deriveCamStructure(t),
    };
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────────

  function _parseExcluded(t) {
    if (Array.isArray(t.excludedCategories)) return t.excludedCategories;
    const raw = t.excluded_categories || t.excludedCategories || '';
    if (!raw) return [];
    return String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  // Returns a citation object for `field` from tenant.quotes, or null.
  // Field names match the keys Claude returns: cam_cap, audit_rights,
  // renewal_options, pro_rata_method, excluded_categories, etc.
  function _extractCitation(tenant, field) {
    if (!tenant || !field) return null;
    const quotes = tenant.quotes || tenant._quotes || {};
    const text   = quotes[field];
    if (!text || typeof text !== 'string' || !text.trim()) return null;
    return {
      field,
      text:       text.trim(),
      tenantName: tenant.tenantName || tenant.tenant_name || '',
      tenantId:   tenant.id || null,
    };
  }

  // Builds a fast lookup: { [tenantId]: { [field]: quoteText }, ... }
  // Falls back to tenantName as key when id is absent.
  function buildCitationIndex(tenants) {
    const index = {};
    for (const t of tenants) {
      const key    = t.id || (t.tenantName || t.tenant_name || '');
      if (!key) continue;
      const quotes = t.quotes || t._quotes || {};
      index[key]   = {};
      for (const [f, text] of Object.entries(quotes)) {
        if (text && typeof text === 'string' && text.trim()) {
          index[key][f] = text.trim();
        }
      }
    }
    return index;
  }

  // ─── Renewal Risk Analysis ────────────────────────────────────────────────
  // Flags tenants whose leases expire within 2 years and/or lack renewal options.
  // riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none'

  const RENEWAL_THRESHOLDS = { critical: 0, high: 365, medium: 730 };

  function renewalRiskAnalysis(tenants) {
    const now = Date.now();
    return tenants.map(t => {
      const name         = t.tenantName || t.tenant_name || '';
      const endDate      = t.end_date || t.lease_end_date || null;
      const hasRenewal   = !!(t.renewal_options && String(t.renewal_options).trim());
      let daysToExpiry   = null;

      if (endDate) {
        daysToExpiry = Math.round((new Date(endDate).getTime() - now) / 86400000);
      }

      const riskLevel = daysToExpiry === null          ? 'none'
                      : daysToExpiry < 0               ? 'critical'
                      : daysToExpiry < RENEWAL_THRESHOLDS.high    && !hasRenewal ? 'high'
                      : daysToExpiry < RENEWAL_THRESHOLDS.high    &&  hasRenewal ? 'medium'
                      : daysToExpiry < RENEWAL_THRESHOLDS.medium  && !hasRenewal ? 'medium'
                      : daysToExpiry < RENEWAL_THRESHOLDS.medium  &&  hasRenewal ? 'low'
                      : 'none';

      return {
        tenantName:       name,
        tenantId:         t.id || null,
        leaseEndDate:     endDate,
        daysToExpiry,
        hasRenewalOption: hasRenewal,
        renewalOptions:   t.renewal_options || null,
        riskLevel,
        citation:         _extractCitation(t, 'renewal_options'),
      };
    }).filter(r => r.riskLevel !== 'none');
  }

  // ─── Pro-Rata Method Risk Analysis ────────────────────────────────────────
  // Non-standard methods (occupied, gross) allow tenants to pay less during
  // vacancy periods, shifting unrecovered costs to the landlord.

  const STANDARD_PRO_RATA = new Set(['rentable', 'leasable']);

  function proRataRiskAnalysis(tenants) {
    return tenants.map(t => {
      const name   = t.tenantName || t.tenant_name || '';
      const method = (t.pro_rata_method || t.proRataMethod || '').toLowerCase().trim();
      const isNonStandard = !!(method && !STANDARD_PRO_RATA.has(method));
      const isUnknown     = !method;
      const riskLevel     = isNonStandard ? 'medium' : isUnknown ? 'low' : 'none';

      return {
        tenantName:    name,
        tenantId:      t.id || null,
        proRataMethod: t.pro_rata_method || t.proRataMethod || null,
        isNonStandard,
        isUnknown,
        riskLevel,
        citation:      _extractCitation(t, 'pro_rata_method'),
      };
    }).filter(r => r.riskLevel !== 'none');
  }

  // ─── Citation-Backed Findings ─────────────────────────────────────────────
  // Flattens the report into a single list of actionable findings.
  // Each finding carries the verbatim lease clause that creates the risk so
  // a buyer can present evidence to an investment committee.
  //
  // Returns array sorted by annualValue descending (highest impact first).

  function buildFindingsWithCitations(report, tenants) {
    const byId   = {};
    const byName = {};
    for (const t of tenants) {
      const id   = t.id   || null;
      const name = (t.tenantName || t.tenant_name || '').toLowerCase();
      if (id)   byId[id]     = t;
      if (name) byName[name] = t;
    }

    function lookupTenant(tenantName, tenantId) {
      if (tenantId && byId[tenantId])           return byId[tenantId];
      if (tenantName && byName[tenantName.toLowerCase()]) return byName[tenantName.toLowerCase()];
      return null;
    }

    const findings = [];

    // ── Cap leakage ────────────────────────────────────────────────────────
    for (const r of (report.capLeakage?.affectedTenants || [])) {
      const t = lookupTenant(r.tenantName, r.tenantId);
      findings.push({
        type:        'cap_leakage',
        label:       'CAM Cap Leakage',
        tenantName:  r.tenantName,
        tenantId:    r.tenantId,
        value:       r.capLeakage,
        annualValue: r.annualizedLeakage,
        citation:    t ? _extractCitation(t, 'cam_cap') : null,
      });
    }

    // ── Non-standard exclusions ────────────────────────────────────────────
    for (const r of (report.exclusions || [])) {
      if (!r.hasUnusualExclusions) continue;
      const t = lookupTenant(r.tenantName, r.tenantId);
      findings.push({
        type:        'unusual_exclusion',
        label:       'Non-Standard CAM Exclusion',
        tenantName:  r.tenantName,
        tenantId:    r.tenantId,
        value:       r.unusualExclusions,
        annualValue: null,
        citation:    t ? _extractCitation(t, 'excluded_categories') : null,
      });
    }

    // ── Audit window risk ──────────────────────────────────────────────────
    for (const r of (report.auditWindows || [])) {
      if (r.windowStatus !== 'closing' && r.windowStatus !== 'expired') continue;
      const t = lookupTenant(r.tenantName, r.tenantId);
      findings.push({
        type:        'audit_window',
        label:       r.windowStatus === 'expired' ? 'Audit Window Expired' : 'Audit Window Closing',
        tenantName:  r.tenantName,
        tenantId:    r.tenantId,
        value:       r.daysToExpiry,
        annualValue: null,
        citation:    t ? _extractCitation(t, 'audit_rights') : null,
      });
    }

    // ── Underbilling (significant gaps only — ≥$1) ─────────────────────────
    for (const r of (report.underbilling || [])) {
      if (r.gap < 1) continue;
      const t             = lookupTenant(r.tenantName, r.tenantId);
      const citationField = r.cause === 'cap'        ? 'cam_cap'
                          : r.cause === 'exclusions' ? 'excluded_categories'
                          : null;
      findings.push({
        type:        'underbilling',
        label:       'CAM Underbilling Gap',
        tenantName:  r.tenantName,
        tenantId:    r.tenantId,
        cause:       r.cause,
        value:       r.gap,
        annualValue: parseFloat((r.gap * 12).toFixed(2)),
        gapPct:      r.gapPct,
        citation:    (t && citationField) ? _extractCitation(t, citationField) : null,
      });
    }

    // ── Renewal risk ───────────────────────────────────────────────────────
    for (const r of (report.renewalRisk || [])) {
      if (r.riskLevel !== 'critical' && r.riskLevel !== 'high') continue;
      findings.push({
        type:        'renewal_risk',
        label:       r.riskLevel === 'critical' ? 'Lease Expired' : 'Lease Expiring Soon',
        tenantName:  r.tenantName,
        tenantId:    r.tenantId,
        value:       r.daysToExpiry,
        annualValue: null,
        riskLevel:   r.riskLevel,
        citation:    r.citation,
      });
    }

    return findings.sort((a, b) => (b.annualValue || 0) - (a.annualValue || 0));
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
    renewalRiskAnalysis,
    proRataRiskAnalysis,
    buildCitationIndex,
    buildFindingsWithCitations,
    buildAcquisitionReport,
    normalizeAcqTenant,
    occupancyAnalysis,
    leaseExpirationSchedule,
    waltAnalysis,
    rolloverRiskAnalysis,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AcquisitionEngine;
  } else {
    root.AcquisitionEngine = AcquisitionEngine;
  }

}(typeof window !== 'undefined' ? window : global));
