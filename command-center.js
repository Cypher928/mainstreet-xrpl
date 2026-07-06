/**
 * command-center.js — Phase 21: AI Command Center (orchestration layer)
 *
 * Unifies MainStreet's existing intelligence — reconciliation, acquisition review,
 * disputes, lease analysis, recovered-revenue, and XRPL settlement state — into one
 * ranked, prioritized daily view. Pure derivation + HTML string builders:
 *   - NO new AI pipelines. Every number is computed live from data the engines
 *     already produced (Selectors, AcquisitionEngine, computeRecoveredRevenue).
 *   - NO fabricated activity. The briefing reports what actually exists in the
 *     portfolio right now; the timeline shows real recorded events with their real
 *     timestamps. (The autonomous overnight engine is a future phase — until it
 *     exists, nothing here claims overnight analysis happened.)
 *   - NO settlement logic. XRPL surfaces read existing per-property settlement
 *     state and navigate to existing flows; nothing here signs or submits.
 *
 * Depends on (read at call time, injectable for tests):
 *   window.Selectors, window.AcquisitionEngine, window.computeRecoveredRevenue
 *
 * Exposes: window.CommandCenter = { buildModel, renderHtml }
 */
window.CommandCenter = (() => {
  'use strict';

  // ── helpers ────────────────────────────────────────────────────────────────

  const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const _fmt$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const _clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

  function _defaultDeps() {
    return {
      Selectors:         window.Selectors,
      AcquisitionEngine: window.AcquisitionEngine,
      EscrowEngine:      window.EscrowReserveEngine,
      computeRecovered:  window.computeRecoveredRevenue || null,
      now:               new Date(),
    };
  }

  // Reconciliation snapshot accessor — same fallback chain the app uses everywhere.
  function _recon(p) { return p.camReconciliation ?? p.results ?? null; }

  function _reconBilled(p) {
    const results = _recon(p)?.results || [];
    return results.reduce((s, r) => s + (_num(r.totalAllocated) || _num(r.allocated)), 0);
  }

  function _proRataSum(p) {
    const results = _recon(p)?.results || [];
    return results.reduce((s, r) => s + (_num(r.proRataPercent)), 0);
  }

  // ── recommendation builders (each returns rec objects; all data real) ──────
  // Rec shape: { id, priority, propertyId, propertyName, title, reason,
  //              impact (number|null), impactNote, confidence, confidenceBasis,
  //              evidence: string[], action: {label, js} }

  function _recsForProperty(p, meta, readiness, deps) {
    const recs    = [];
    const tenants = Array.isArray(p.tenants) ? p.tenants.filter(Boolean) : [];
    const recon   = _recon(p);
    const today   = deps.now.toISOString().slice(0, 10);
    const openJs  = `ccOpenProperty('${p.id}')`;
    // Cross-module context for connection lines (Phase 21C): what else on this
    // property does each issue touch? Deterministic and data-backed only.
    const stl = _settlementFor(p);

    // 1) Open disputes — real exposure, real dispute records as evidence.
    const openDisps = (p.disputes || []).filter(d => d && d.status !== 'accepted' && d.status !== 'rejected' && d.status !== 'resolved');
    if (openDisps.length) {
      const exposure = openDisps.reduce((s, d) => s + _num(d.tenantShare ?? d.amount), 0);
      recs.push({
        id: `disp:${p.id}`, priority: exposure > 5000 ? 'high' : 'medium',
        propertyId: p.id, propertyName: p.name,
        title: `${openDisps.length} unresolved dispute${openDisps.length !== 1 ? 's' : ''}`,
        reason: 'Tenant disputes block reconciliation sign-off and can delay settlement.',
        impact: exposure || null, impactNote: exposure ? 'disputed exposure' : null,
        confidence: 95, confidenceBasis: 'dispute records',
        evidence: openDisps.slice(0, 3).map(d =>
          `Dispute — ${d.vendor || d.category || 'charge'} ${_num(d.tenantShare ?? d.amount) ? '(' + _fmt$(d.tenantShare ?? d.amount) + ')' : ''} · ${d.status || 'open'}`),
        connections: (stl && stl.state === 'ready')
          ? [`Resolving this clears the way to settle ${_fmt$(stl.billed)} in RLUSD on XRPL.`] : [],
        action: { label: 'Review disputes', js: openJs },
      });
    }

    // 2) Expired / soon-expiring leases — date math on real lease records.
    // Conversational (Phase 21D): name the tenant when there's one; an advisor
    // says "Beta Cafe's lease has expired", not "1 lease expired".
    const expired = tenants.filter(t => t.end_date && t.end_date < today);
    if (expired.length) {
      const billedByName = {};
      (recon?.results || []).forEach(r => { billedByName[r.tenantName] = _num(r.totalAllocated) || _num(r.allocated); });
      const atRisk = expired.reduce((s, t) => s + (billedByName[t.tenant_name] || 0), 0);
      recs.push({
        id: `exp:${p.id}`, priority: 'high',
        propertyId: p.id, propertyName: p.name,
        title: expired.length === 1
          ? `${expired[0].tenant_name}'s lease has expired`
          : `${expired.length} leases have expired — renewals not started`,
        reason: expired.length === 1
          ? `The lease ended ${expired[0].end_date} and a renewal hasn't started. Expired terms are unenforceable — including the CAM recovery language.`
          : 'These leases have ended without renewals. Expired terms are unenforceable — including the CAM recovery language.',
        impact: atRisk || null, impactNote: atRisk ? 'annual CAM share at risk' : null,
        confidence: 90, confidenceBasis: 'lease end dates',
        evidence: expired.slice(0, 3).map(t => `Lease — ${t.tenant_name} · expired ${t.end_date} · ${Number(t.leased_sqft || 0).toLocaleString('en-US')} sf`),
        connections: atRisk > 0
          ? [`Also affects CAM: ${_fmt$(atRisk)} of this year's allocations rest on expired lease terms.`] : [],
        action: { label: 'Review leases', js: openJs },
      });
    }

    // 3) NNN tenants missing a CAM cap — data gap with real risk, honestly unquantified.
    const missingCap = tenants.filter(t =>
      /nnn|triple[\s-]?net/i.test(String(t.lease_type || '')) && (t.cap == null || t.cap === ''));
    if (missingCap.length) {
      const oneName = missingCap.length === 1 ? missingCap[0].tenant_name : null;
      recs.push({
        id: `cap:${p.id}`, priority: 'medium',
        propertyId: p.id, propertyName: p.name,
        title: oneName
          ? `${oneName} needs attention`
          : `${missingCap.length} NNN tenants need attention`,
        reason: oneName
          ? "The lease is missing a CAM expense cap. Until it's verified, MainStreet can't confirm this tenant isn't being overcharged."
          : "These NNN leases are missing CAM expense caps. Until they're verified, MainStreet can't confirm these tenants aren't being overcharged.",
        impact: null, impactNote: 'estimated risk: unknown',
        confidence: 92, confidenceBasis: 'lease field completeness',
        evidence: missingCap.slice(0, 3).map(t => `Lease — ${t.tenant_name} (NNN, no cap on file)`),
        connections: (recon?.results || []).length
          ? ['CAM impact: these allocations cannot be cap-validated until terms are on file.'] : [],
        action: { label: 'Review lease & confirm CAM cap', js: openJs },
      });
    }

    // 4) Year-over-year CAM trend — from real camRuns history.
    if (meta && meta.trendPct != null && Math.abs(meta.trendPct) >= 10 && meta.trendDir === 'up') {
      const runs = recon?.camRuns || [];
      const curr = runs[0], prev = runs.slice(1).find(r => r.camYear !== curr?.camYear) || runs[1];
      const delta = (curr?.totalExpenses && prev?.totalExpenses) ? curr.totalExpenses - prev.totalExpenses : null;
      recs.push({
        id: `trend:${p.id}`, priority: meta.trendPct > 20 ? 'high' : 'medium',
        propertyId: p.id, propertyName: p.name,
        title: `CAM expenses up ${Math.abs(meta.trendPct).toFixed(1)}% year-over-year`,
        reason: 'Increases above 10% exceed standard CAM audit monitoring thresholds — review vendor pricing and one-time charges.',
        impact: delta, impactNote: delta ? 'YoY increase' : null,
        confidence: 88, confidenceBasis: 'reconciliation history',
        evidence: (curr && prev) ? [`CAM ${prev.camYear}: ${_fmt$(prev.totalExpenses)} → ${curr.camYear}: ${_fmt$(curr.totalExpenses)}`] : [],
        action: { label: 'Review expenses', js: openJs },
      });
    }

    // 5) Pro-rata coverage gap / vacancy — pool share no tenant is paying.
    const prSum = _proRataSum(p);
    const pool  = _num(recon?.total) || _num(meta?.total);
    if ((recon?.results || []).length > 0 && pool > 0 && (100 - prSum) >= 5) {
      const gapPct = 100 - prSum;
      const gap$   = pool * (gapPct / 100);
      recs.push({
        id: `gap:${p.id}`, priority: 'medium',
        propertyId: p.id, propertyName: p.name,
        title: `${gapPct.toFixed(1)}% of the CAM pool is unallocated`,
        reason: 'Vacant or unbilled space means this share of expenses is not recoverable from tenants.',
        impact: gap$, impactNote: 'unrecovered CAM/yr',
        confidence: 90, confidenceBasis: 'allocation results',
        evidence: [`Pool ${_fmt$(pool)} × ${gapPct.toFixed(1)}% coverage gap`],
        action: { label: 'Review occupancy', js: openJs },
      });
    }

    // 6) Data-quality queue — tenants the review engine flagged.
    const unresolved = (readiness?.unresolvedCount || 0);
    if (unresolved > 0) {
      recs.push({
        id: `rq:${p.id}`, priority: 'low',
        propertyId: p.id, propertyName: p.name,
        title: `${unresolved} lease record${unresolved !== 1 ? 's' : ''} awaiting review`,
        reason: 'Verified lease data raises allocation confidence and audit-readiness.',
        impact: null, impactNote: null,
        confidence: 85, confidenceBasis: 'review engine flags',
        evidence: [], action: { label: 'Open review queue', js: openJs },
      });
    }

    // 7) Reconciliation not yet run despite data being present.
    if (!(recon?.results || []).length && tenants.length > 0 && (p.invoices || []).length > 0) {
      recs.push({
        id: `run:${p.id}`, priority: 'medium',
        propertyId: p.id, propertyName: p.name,
        title: 'Data ready — CAM reconciliation not yet run',
        reason: `${tenants.length} leases and ${(p.invoices || []).length} invoices are loaded; run the allocation to surface recoveries.`,
        impact: null, impactNote: null,
        confidence: 95, confidenceBasis: 'workflow state',
        evidence: [], action: { label: 'Run reconciliation', js: openJs },
      });
    }

    // 8) All clear — reconciled, no open issues (the honest green card).
    if ((recon?.results || []).length > 0 && !openDisps.length && !expired.length && !missingCap.length && unresolved === 0) {
      recs.push({
        id: `ok:${p.id}`, priority: 'low',
        propertyId: p.id, propertyName: p.name,
        title: 'Reconciled — no action required',
        reason: 'Allocations verified, no open disputes, lease data complete.',
        impact: null, impactNote: null,
        confidence: 95, confidenceBasis: 'reconciliation state',
        evidence: [], action: { label: 'View property', js: openJs },
      });
    }

    return recs;
  }

  // Capital reserves → recommendations (Phase 21B — orchestrates EscrowReserveEngine).
  // Three honest card sources: a draft draw whose readiness gate passes ("money is
  // recoverable now"), a draft draw with missing items (the Readiness checklist),
  // and reserves whose planned work exceeds available funds (shortfall / runway).
  function _recsForReserves(p, d) {
    const EE = d.EscrowEngine;
    if (!EE || typeof EE.computeEscrowReadiness !== 'function') return [];
    const reserves = Array.isArray(p.escrowReserves) ? p.escrowReserves.filter(Boolean) : [];
    const draws    = Array.isArray(p.drawRequests)   ? p.drawRequests.filter(Boolean)   : [];
    const recs = [];
    const openJs = `ccOpenReserves('${p.id}')`;

    for (const r of reserves) {
      for (const dr of draws.filter(x => x.reserveId === r.id && x.status === 'draft')) {
        const rd  = EE.computeEscrowReadiness(r, dr, draws);
        const amt = _num(dr.amountRequested);
        if (rd.ready && amt > 0) {
          recs.push({
            id: `rsv:${dr.id}`, priority: 'high', propertyId: p.id, propertyName: p.name,
            title: `Lender reimbursement ready — ${r.reserveTypeLabel}`,
            reason: rd.summary || 'Documentation is complete — the draw package can be generated and sent to the lender.',
            impact: amt, impactNote: 'eligible reimbursement',
            confidence: 95, confidenceBasis: 'draw validation checklist',
            evidence: rd.items.filter(i => i.met).slice(0, 4).map(i => `✓ ${i.label}`),
            connections: [`Cash-flow impact: funding returns ${_fmt$(amt)} to the property.`],
            action: { label: 'Generate lender package', js: openJs },
          });
        } else {
          recs.push({
            id: `rsvdoc:${dr.id}`, priority: 'medium', propertyId: p.id, propertyName: p.name,
            title: `Draw request ${rd.score}% ready — ${r.reserveTypeLabel}`,
            reason: rd.summary || 'Complete the draw request to submit.',
            impact: amt || null, impactNote: amt ? 'estimated reimbursement' : null,
            confidence: 90, confidenceBasis: 'draw validation checklist',
            evidence: rd.missing.slice(0, 3).map(i => `⚠ ${i.label}`),
            action: { label: 'Complete draw request', js: openJs },
          });
        }
      }

      if (typeof EE.computeReserveHealth === 'function') {
        const h = EE.computeReserveHealth(r, draws, { now: d.now });
        if (h.shortfall > 0) {
          recs.push({
            id: `rshort:${r.id}`, priority: 'high', propertyId: p.id, propertyName: p.name,
            title: `Reserve shortfall — ${r.reserveTypeLabel}`,
            reason: 'Planned capital work exceeds available reserve funds — increase monthly contributions or re-phase the work.',
            impact: h.shortfall, impactNote: 'funding gap',
            confidence: 88, confidenceBasis: 'reserve balance & planned projects',
            evidence: [`Available ${_fmt$(Math.max(h.availableBalance || 0, 0))} vs planned ${_fmt$(h.upcomingPlannedCost)}`],
            action: { label: 'Review reserves', js: openJs },
          });
        } else if (typeof EE.projectReserveRunway === 'function') {
          const rw = EE.projectReserveRunway(r, draws, 12, { now: d.now });
          if (rw && !rw.unknown && rw.depletionInMonths != null) {
            recs.push({
              id: `rdep:${r.id}`, priority: 'medium', propertyId: p.id, propertyName: p.name,
              title: `${r.reserveTypeLabel} projected to deplete in ${rw.depletionInMonths} month${rw.depletionInMonths === 1 ? '' : 's'}`,
              reason: 'At the current contribution rate, planned outflows exhaust this reserve within 12 months.',
              impact: rw.fundingGap || null, impactNote: rw.fundingGap ? 'projected funding gap' : null,
              confidence: 80, confidenceBasis: 'reserve runway projection',
              evidence: [`Starting ${_fmt$(rw.startingBalance)} + ${_fmt$(rw.monthlyContribution)}/mo contributions`],
              action: { label: 'Review reserves', js: openJs },
            });
          }
        }
      }
    }
    return recs;
  }

  // Acquisition reviews → recommendations (reads the analysis the engine already ran).
  function _recsForAcquisitions(acqReviews) {
    const recs = [];
    for (const rev of (acqReviews || [])) {
      const a = rev && (rev.analysis || rev);
      if (!a) continue;
      const rate   = _num(a.recoveryRate ?? a.revenueRecovery?.recoveryRate);
      const atRisk = _num(a.totalAtRisk ?? a.revenueRecovery?.totalAtRisk);
      if (rate && rate < 70) {
        recs.push({
          id: `acq:${rev.id}`, priority: 'high',
          propertyId: null, propertyName: rev.name || 'Acquisition review',
          title: `Acquisition: CAM recovery ${rate.toFixed(1)}% — below 70% threshold`,
          reason: 'Cap leakage and missed recoveries reduce NOI on this target — quantify before closing.',
          impact: atRisk || null, impactNote: atRisk ? 'at risk per year' : null,
          confidence: 90, confidenceBasis: 'acquisition analysis',
          evidence: [`Acquisition review — ${rev.name || ''}`],
          connections: ['If acquired as-is, this leakage becomes a recurring portfolio priority.'],
          action: { label: 'Open acquisition review', js: 'ccOpenAcquisitions()' },
        });
      }
    }
    return recs;
  }

  // ── health, opportunities, intel, timeline, settlements ────────────────────

  function _healthFor(p, meta, readiness) {
    const openDisputes = meta?.openDisputes || 0;
    const score = _clamp(Math.round(100
      - openDisputes * 6
      - (readiness?.expiredCount    || 0) * 8
      - (readiness?.expiringCount   || 0) * 3
      - (readiness?.missingCapCount || 0) * 6
      - (readiness?.lowConfCount    || 0) * 4
      - (readiness?.unresolvedCount || 0) * 4
      - ((meta?.missingDocs || 0) > 0 ? 4 : 0)
      - ((readiness?.proRataGap || 0) >= 5 ? 4 : 0)
      - ({ Critical: 12, Elevated: 8, Moderate: 4 }[meta?.riskLevel] || 0)
    ), 5, 100);
    return {
      score,
      risk: meta?.riskLevel || 'None',
      openIssues: (readiness?.unresolvedCount || 0) + (readiness?.missingCapCount || 0) + (readiness?.expiredCount || 0),
      disputes: openDisputes,
    };
  }

  function _largestExpense(p) {
    const recon = _recon(p);
    const invoices = (recon?.invoicesFull?.length ? recon.invoicesFull : null) || recon?.invoices || p.invoices || [];
    const byCat = {};
    invoices.forEach(inv => { if (inv) byCat[inv.category || 'other'] = (byCat[inv.category || 'other'] || 0) + _num(inv.amount); });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    return top ? { category: top[0], amount: top[1] } : null;
  }

  function _nextExpiration(p, now) {
    const today = now.toISOString().slice(0, 10);
    const future = (p.tenants || []).filter(t => t && t.end_date && t.end_date >= today)
      .sort((a, b) => a.end_date.localeCompare(b.end_date))[0];
    const past = (p.tenants || []).filter(t => t && t.end_date && t.end_date < today)
      .sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
    if (past)   return { tenant: past.tenant_name, date: past.end_date, expired: true };
    if (future) return { tenant: future.tenant_name, date: future.end_date, expired: false };
    return null;
  }

  function _settlementFor(p) {
    const recon = _recon(p);
    if (!(recon?.results || []).length) return null;
    const billed = _reconBilled(p);
    if (!(billed > 0)) return null;
    const s = p.settlement;
    if (s && s.txHash) {
      return { propertyId: p.id, propertyName: p.name, amountUsd: s.amountUsd ?? null,
               billed, state: 'settled', explorerLink: s.explorerLink || null };
    }
    return { propertyId: p.id, propertyName: p.name, amountUsd: null, billed, state: 'ready', explorerLink: null };
  }

  function _timeline(props, limit) {
    const events = [];
    for (const p of (props || [])) {
      for (const ev of (p.timeline || [])) {
        if (ev && ev.timestamp && ev.title) events.push({ ...ev, propertyName: p.name });
      }
    }
    events.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return events.slice(0, limit || 8);
  }

  // ── executive summary (deterministic narrative over the ranked model) ──────
  // Reads like an analyst, but every sentence is derived from a card below it —
  // nothing appears here that isn't backed by real data elsewhere on the page.

  const _WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const _countWord = (n) => (n >= 0 && n <= 10) ? _WORDS[n] : String(n);

  function _oppPhrase(r) {
    const at = r.propertyName ? ` at ${r.propertyName}` : '';
    switch (String(r.id).split(':')[0]) {
      case 'disp':  return `resolving the open disputes${at}`;
      case 'exp':   return `the expired-lease renewal${at}`;
      case 'cap':   return `completing CAM cap data${at}`;
      case 'trend': return `the year-over-year expense increase${at}`;
      case 'gap':   return `unrecovered CAM from vacancy${at}`;
      case 'run':   return `running the pending reconciliation${at}`;
      case 'rsv':   return `the lender reimbursement ready to request${at}`;
      case 'rsvdoc': return `completing the escrow draw request${at}`;
      case 'rshort': return `the reserve funding shortfall${at}`;
      case 'rdep':  return `the projected reserve depletion${at}`;
      case 'acq':   return `the below-threshold CAM recovery on ${r.propertyName || 'the acquisition target'}`;
      default:      return `${r.title}${at}`;
    }
  }

  function _executiveSummary({ recs, settlements, identifiedTotal, expiring60, reimburseReady, reimburseCount, criticalCount }) {
    const parts = [];

    const attentionProps = new Set(recs.filter(r => r.priority === 'high').map(r => r.propertyId || r.propertyName));
    if (attentionProps.size > 0) {
      parts.push(`${_countWord(attentionProps.size)} propert${attentionProps.size === 1 ? 'y requires' : 'ies require'} immediate attention.`);
    } else if (recs.some(r => r.priority === 'medium')) {
      parts.push('No properties require immediate attention, though a few items are worth reviewing this week.');
    } else if (recs.length) {
      parts.push('The portfolio is clean — everything reconciled, no urgent items today.');
    }

    // Largest opportunity — skipped when it IS the reimbursement package, since
    // the package sentence below already carries that number (no double-counting
    // the same dollar figure in an executive's ear).
    const largest = recs.filter(r => (r.impact || 0) > 0).sort((a, b) => b.impact - a.impact)[0];
    if (largest && !String(largest.id).startsWith('rsv:')) {
      parts.push(`The largest opportunity is ${_oppPhrase(largest)} (${_fmt$(largest.impact)}).`);
    }

    if (expiring60 > 0) parts.push(`${_countWord(expiring60)} lease expiration${expiring60 === 1 ? ' occurs' : 's occur'} within 60 days.`);

    if (reimburseCount > 0) {
      parts.push(`${_countWord(reimburseCount)} lender reimbursement package${reimburseCount === 1 ? '' : 's'} totaling ${_fmt$(reimburseReady)} ${reimburseCount === 1 ? 'is' : 'are'} ready for submission.`);
    }

    const ready   = settlements.filter(s => s.state === 'ready').length;
    const settled = settlements.filter(s => s.state === 'settled').length;
    if (ready > 0) parts.push(`${_countWord(ready)} propert${ready === 1 ? 'y is' : 'ies are'} ready for RLUSD settlement.`);
    else if (settled > 0) parts.push(settled === 1
      ? 'The reconciled settlement is verified on the XRP Ledger.'
      : 'All reconciled settlements are verified on the XRP Ledger.');

    // Risk verdict — an executive briefing should end with a verdict, and it
    // must be earned: "no critical risks" only when the risk engine agrees.
    if (criticalCount > 0) {
      parts.push(`${_countWord(criticalCount)} propert${criticalCount === 1 ? 'y carries' : 'ies carry'} a critical risk flag.`);
    } else if (recs.length) {
      parts.push('No critical portfolio risks were detected.');
    }

    if (identifiedTotal > 0) parts.push(`Total identified portfolio opportunity: ${_fmt$(identifiedTotal)}.`);

    return parts.join(' ');
  }

  // ── model ──────────────────────────────────────────────────────────────────

  /**
   * Builds the full Command Center view model from live portfolio state.
   * Pure: no DOM writes, no network. All figures computed from existing data.
   */
  function buildModel({ props, acqReviews, userName, deps } = {}) {
    const d = { ..._defaultDeps(), ...(deps || {}) };
    const S = d.Selectors;
    const safeProps = Array.isArray(props) ? props.filter(Boolean) : [];

    // Per-property derivations (reuses the exact engines the rest of the app uses)
    const perProp = safeProps.map(p => {
      const meta      = S?.buildPropMeta ? S.buildPropMeta(p) : {};
      const readiness = S?.derivePropertyReadiness ? S.derivePropertyReadiness(p) : {};
      return { p, meta, readiness };
    });

    // Recommendations
    let recs = [];
    perProp.forEach(({ p, meta, readiness }) => { recs = recs.concat(_recsForProperty(p, meta, readiness, d)); });
    perProp.forEach(({ p }) => { recs = recs.concat(_recsForReserves(p, d)); });
    recs = recs.concat(_recsForAcquisitions(acqReviews));

    // Asset-manager focus (Phase 21C): several clean properties should read as
    // one quiet line, not a card apiece — the cards are for things needing action.
    const okRecs = recs.filter(r => String(r.id).startsWith('ok:'));
    if (okRecs.length > 1) {
      recs = recs.filter(r => !String(r.id).startsWith('ok:'));
      recs.push({
        id: 'ok:all', priority: 'low', propertyId: null, propertyName: null,
        title: `${okRecs.length} properties reconciled — no action required`,
        reason: 'Allocations verified, no open disputes, lease data complete across these properties.',
        impact: null, impactNote: null, confidence: 95, confidenceBasis: 'reconciliation state',
        evidence: okRecs.map(r => r.propertyName).filter(Boolean),
        action: { label: 'View portfolio', js: 'ccShowPortfolio()' },
      });
    }

    recs.sort((a, b) =>
      (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) ||
      ((b.impact || 0) - (a.impact || 0)));

    // Recovered / identified value (reuses computeRecoveredRevenue verbatim)
    const rr = (typeof d.computeRecovered === 'function')
      ? d.computeRecovered(safeProps)
      : { capSavings: 0, disputeRecoveries: 0, exclusionSavings: 0, total: 0, byProperty: [] };

    // Opportunity center — identified value (real) listed separately from open exposure.
    const vacancyGap = perProp.reduce((s, { p }) => {
      const pool = _num(_recon(p)?.total); const pr = _proRataSum(p);
      return ((_recon(p)?.results || []).length && pool > 0 && (100 - pr) >= 5) ? s + pool * ((100 - pr) / 100) : s;
    }, 0);
    const openExposure = safeProps.reduce((s, p) =>
      s + (p.disputes || []).filter(dd => dd && dd.status === 'open')
            .reduce((x, dd) => x + _num(dd.tenantShare ?? dd.amount), 0), 0);
    // Lender reimbursements whose readiness gate passes — recoverable cash, so it
    // joins the identified total. (Draws still missing documentation are cards
    // only; their estimates never inflate the total.)
    const reimburseReady = recs.filter(r => String(r.id).startsWith('rsv:'))
      .reduce((s, r) => s + (r.impact || 0), 0);

    const opportunities = {
      items: [
        { label: 'Cap enforcement savings',        amount: rr.capSavings,        note: `${rr.capCount || 0} tenant cap${(rr.capCount || 0) !== 1 ? 's' : ''} enforced` },
        { label: 'Dispute recoveries',             amount: rr.disputeRecoveries, note: 'charges upheld after review' },
        { label: 'Exclusion savings',              amount: rr.exclusionSavings,  note: 'lease exclusions honored' },
        { label: 'Unrecovered CAM (vacancy gap)',  amount: vacancyGap,           note: 'pool share with no paying tenant' },
        { label: 'Lender reimbursements ready',    amount: reimburseReady,       note: 'escrow draw packages complete' },
      ].filter(o => o.amount > 0),
      identifiedTotal: rr.total + vacancyGap + reimburseReady,
      openExposure,
    };

    // Portfolio health & per-property intelligence
    const health = perProp.map(({ p, meta, readiness }) => {
      const h = _healthFor(p, meta, readiness);
      const rrProp = (rr.byProperty || []).find(bp => bp.id === p.id);
      const occupied = (p.tenants || []).reduce((s, t) => s + _num(t && t.leased_sqft), 0);
      return {
        propertyId: p.id, propertyName: p.name, ...h,
        opportunity: (rrProp?.total || 0),
        occupancyPct: p.totalSqft ? Math.round((occupied / p.totalSqft) * 100) : null,
        largestExpense: _largestExpense(p),
        nextExpiration: _nextExpiration(p, d.now),
        topAction: recs.find(r => r.propertyId === p.id)?.title || 'No action required',
      };
    });

    // Briefing — every count is real and computed at this moment.
    const hour = d.now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const totals = {
      properties: safeProps.length,
      leases:     safeProps.reduce((s, p) => s + ((p.tenants || []).filter(Boolean).length), 0),
      invoices:   safeProps.reduce((s, p) => {
        const recon = _recon(p);
        return s + ((recon?.invoicesFull?.length ? recon.invoicesFull : null) || recon?.invoices || p.invoices || []).length;
      }, 0),
      priorities: recs.filter(r => r.priority !== 'low').length,
    };

    // Lease expirations inside the next 60 days (real end dates, portfolio-wide)
    const in60 = new Date(d.now); in60.setDate(in60.getDate() + 60);
    const today60 = d.now.toISOString().slice(0, 10), cutoff60 = in60.toISOString().slice(0, 10);
    const expiring60 = safeProps.reduce((s, p) => s + (p.tenants || []).filter(t =>
      t && t.end_date && t.end_date >= today60 && t.end_date <= cutoff60).length, 0);

    const settlements = safeProps.map(_settlementFor).filter(Boolean);
    const criticalCount  = perProp.filter(({ meta }) => meta && meta.riskLevel === 'Critical').length;
    const reimburseCount = recs.filter(r => String(r.id).startsWith('rsv:')).length;
    const summary = _executiveSummary({
      recs, settlements, identifiedTotal: opportunities.identifiedTotal, expiring60,
      reimburseReady, reimburseCount, criticalCount,
    });

    return {
      briefing: { greeting, userName: userName || null, totals, identifiedTotal: opportunities.identifiedTotal, openExposure, summary, expiring60 },
      recommendations: recs,
      health,
      opportunities,
      timeline: _timeline(safeProps, 8),
      settlements,
      acqCount: (acqReviews || []).length,
    };
  }

  // ── HTML ───────────────────────────────────────────────────────────────────

  const PRI = {
    high:   { label: 'High Priority',   dot: '#f87171', cls: 'cc-card--high'   },
    medium: { label: 'Medium Priority', dot: '#fbbf24', cls: 'cc-card--medium' },
    low:    { label: 'Low Priority',    dot: '#4ade80', cls: 'cc-card--low'    },
  };

  function _recCard(r) {
    const pri = PRI[r.priority] || PRI.low;
    const impact = r.impact
      ? `<div class="cc-impact"><span class="cc-impact-num">${_fmt$(r.impact)}</span><span class="cc-impact-note">${_esc(r.impactNote || 'estimated impact')}</span></div>`
      : (r.impactNote ? `<div class="cc-impact"><span class="cc-impact-note">${_esc(r.impactNote)}</span></div>` : '');
    const evid = r.evidence?.length
      ? `<div class="cc-evidence">${r.evidence.map(e => `<span class="cc-evid-chip">${_esc(e)}</span>`).join('')}</div>` : '';
    const conn = r.connections?.length
      ? `<div class="cc-connect">${r.connections.map(c => `<span>↔ ${_esc(c)}</span>`).join('')}</div>` : '';
    return `<div class="cc-card ${pri.cls}">
      <div class="cc-card-top">
        <span class="cc-pri"><span class="cc-dot" style="background:${pri.dot}"></span>${pri.label}</span>
        <span class="cc-conf" title="Heuristic confidence derived from ${_esc(r.confidenceBasis)}">Confidence ${r.confidence}%</span>
      </div>
      <div class="cc-card-prop">${_esc(r.propertyName || '')}</div>
      <div class="cc-card-title">${_esc(r.title)}</div>
      <div class="cc-card-reason">${_esc(r.reason)}</div>
      ${impact}${evid}${conn}
      <button class="cc-action-btn" onclick="${r.action.js}">${_esc(r.action.label)}</button>
    </div>`;
  }

  function renderHtml(m) {
    const b = m.briefing;
    const name = b.userName ? `, ${_esc(b.userName)}` : '';
    const statLine = [
      `${b.totals.properties} propert${b.totals.properties === 1 ? 'y' : 'ies'}`,
      `${b.totals.leases} lease${b.totals.leases !== 1 ? 's' : ''}`,
      `${b.totals.invoices} invoice${b.totals.invoices !== 1 ? 's' : ''} analyzed`,
    ].join(' · ');

    // Focus: an experienced asset manager leads with the few most important
    // actions. Top 6 render as cards; the remainder collapse behind a toggle.
    const MAX_TOP = 6;
    const topRecs  = m.recommendations.slice(0, MAX_TOP);
    const restRecs = m.recommendations.slice(MAX_TOP);
    const recsHtml = m.recommendations.length
      ? topRecs.map(_recCard).join('')
      : `<div class="cc-empty">Add a property or load the demo to see prioritized recommendations.</div>`;
    const moreHtml = restRecs.length
      ? `<details class="cc-more"><summary>Show ${restRecs.length} more recommendation${restRecs.length === 1 ? '' : 's'}</summary>
           <div class="cc-cards" style="margin-top:12px;">${restRecs.map(_recCard).join('')}</div>
         </details>`
      : '';

    const oppHtml = m.opportunities.items.length
      ? m.opportunities.items.map(o => `<div class="cc-opp-row">
          <span class="cc-opp-label">${_esc(o.label)}<span class="cc-opp-note">${_esc(o.note)}</span></span>
          <span class="cc-opp-amt">${_fmt$(o.amount)}</span></div>`).join('')
      : `<div class="cc-empty">Run a reconciliation to surface identified value.</div>`;

    const healthHtml = m.health.map(h => `<div class="cc-health-card" onclick="ccOpenProperty('${h.propertyId}')">
        <div class="cc-health-name">${_esc(h.propertyName)}</div>
        <div class="cc-health-score"><span class="cc-health-num">${h.score}</span><span class="cc-health-den">/ 100</span></div>
        <div class="cc-health-rows">
          <span>Risk <b>${_esc(h.risk)}</b></span>
          ${h.occupancyPct != null ? `<span>Occupancy <b>${h.occupancyPct}%</b></span>` : ''}
          <span>Open issues <b>${h.openIssues}</b></span>
          <span>Disputes <b>${h.disputes}</b></span>
          ${h.opportunity ? `<span>Value identified <b>${_fmt$(h.opportunity)}</b></span>` : ''}
        </div>
        <div class="cc-health-intel">
          ${h.largestExpense ? `<span>Largest expense: <b>${_esc(h.largestExpense.category)}</b> (${_fmt$(h.largestExpense.amount)})</span>` : ''}
          ${h.nextExpiration ? `<span>${h.nextExpiration.expired ? '⚠ Expired lease' : 'Next expiration'}: <b>${_esc(h.nextExpiration.tenant)}</b> · ${_esc(h.nextExpiration.date)}</span>` : ''}
          <span>Recommended: <b>${_esc(h.topAction)}</b></span>
        </div>
      </div>`).join('');

    const tlHtml = m.timeline.length
      ? m.timeline.map(ev => {
          const t = new Date(ev.timestamp);
          const ts = isNaN(t) ? '' : t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          return `<div class="cc-tl-row"><span class="cc-tl-time">${_esc(ts)}</span>
            <span class="cc-tl-title">${_esc(ev.title)}</span>
            <span class="cc-tl-prop">${_esc(ev.propertyName || '')}</span></div>`;
        }).join('')
      : `<div class="cc-empty">Activity will appear here as analyses run.</div>`;

    // XRPL stays invisible until money is ready to move — only settled/ready rows render.
    const stlHtml = m.settlements.map(s => s.state === 'settled'
      ? `<div class="cc-stl-row cc-stl--settled">
           <span class="cc-stl-dot"></span><span>${_esc(s.propertyName)} — settled &amp; verified on the XRP Ledger (RLUSD)</span>
           ${s.explorerLink ? `<a href="${_esc(s.explorerLink)}" target="_blank" rel="noopener" class="cc-stl-link">View Transaction ↗</a>` : ''}
         </div>`
      : `<div class="cc-stl-row cc-stl--ready">
           <span class="cc-stl-dot"></span>
           <span>${_esc(s.propertyName)} — Settlement ready · <b>RLUSD ${Math.round(s.billed).toLocaleString('en-US')}</b> reconciled and billable</span>
           <button class="cc-stl-btn" onclick="ccOpenProperty('${s.propertyId}')">Review Settlement</button>
         </div>`).join('');

    return `
    <div class="cc-nav">
      <span class="cc-nav-brand">✨ AI Command Center</span>
      <span class="cc-nav-links">
        <button class="cc-nav-link" onclick="ccShowPortfolio()">Portfolio</button>
        ${m.acqCount ? `<button class="cc-nav-link" onclick="ccOpenAcquisitions()">Acquisitions</button>` : ''}
      </span>
    </div>

    <div class="cc-brief">
      <div class="cc-brief-greet">${b.greeting}${name}</div>
      <div class="cc-brief-line">Your portfolio right now: <b>${statLine}</b></div>
      <div class="cc-brief-stats">
        <div class="cc-brief-stat"><div class="cc-bs-num">${_fmt$(b.identifiedTotal)}</div><div class="cc-bs-lbl">value identified</div></div>
        <div class="cc-brief-stat"><div class="cc-bs-num">${b.totals.priorities}</div><div class="cc-bs-lbl">priorit${b.totals.priorities === 1 ? 'y' : 'ies'} today</div></div>
        ${b.openExposure ? `<div class="cc-brief-stat"><div class="cc-bs-num">${_fmt$(b.openExposure)}</div><div class="cc-bs-lbl">open dispute exposure</div></div>` : ''}
      </div>
      ${b.summary ? `<div class="cc-exec">
        <div class="cc-exec-title">Today's Executive Summary</div>
        <p class="cc-exec-p">${_esc(b.summary)}</p>
      </div>` : ''}
      <div class="cc-brief-honest">Computed live from your portfolio data — leases, invoices, reconciliations, and disputes on file.</div>
    </div>

    <div class="cc-section-title">Today's Priorities</div>
    <div class="cc-cards">${recsHtml}</div>
    ${moreHtml}

    <div class="cc-two-col">
      <div>
        <div class="cc-section-title">Opportunity Center</div>
        <div class="cc-opp-panel">
          ${oppHtml}
          ${m.opportunities.items.length ? `<div class="cc-opp-total"><span>Total value identified</span><span>${_fmt$(m.opportunities.identifiedTotal)}</span></div>` : ''}
        </div>
        ${stlHtml ? `<div class="cc-section-title">Settlement</div><div class="cc-stl-panel">${stlHtml}</div>` : ''}
      </div>
      <div>
        <div class="cc-section-title">Analysis Timeline</div>
        <div class="cc-tl-panel">${tlHtml}</div>
      </div>
    </div>

    <div class="cc-section-title">Portfolio Health</div>
    <div class="cc-health-grid">${healthHtml || `<div class="cc-empty">No properties yet.</div>`}</div>`;
  }

  return { buildModel, renderHtml };
})();
