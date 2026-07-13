/**
 * guided-tour.js — Phase 23 Stage 3: Guided Demo Mode
 *
 * A first-class walkthrough for judges, investors, and first-time users.
 * Pure orchestration: every step navigates EXISTING screens via the existing
 * view functions (showCommandCenter, ccOpenProperty, openAIWorkspace,
 * openDraftingStudio, ccOpenReserves) — no duplicate demo implementations.
 *
 * Honest by design: steps adapt to what's actually on file. If the portfolio
 * has no reserve documents, the Reserve step says so and shows where to upload
 * them — it never stages fake data. buildSteps() is pure and Node-testable;
 * the overlay runner lives in script.js view glue.
 *
 * Exposes: window.GuidedTour = { buildSteps }
 */
window.GuidedTour = (() => {
  'use strict';

  const _fmt$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

  function buildSteps({ props, acqReviews } = {}) {
    const safeProps = Array.isArray(props) ? props.filter(Boolean) : [];
    // Anchor the tour on the richest property: one with a completed reconciliation.
    const p = safeProps.find(x => ((x.camReconciliation ?? x.results)?.results || []).length) || safeProps[0] || null;
    const recon = p ? (p.camReconciliation ?? p.results) : null;
    const topResult = (recon?.results || []).slice()
      .sort((a, b) => (parseFloat(b.totalAllocated) || 0) - (parseFloat(a.totalAllocated) || 0))[0] || null;
    const hasReserves  = !!(p && (p.escrowReserves || []).length);
    const hasDraftDraw = !!(p && (p.drawRequests || []).some(d => d && d.status === 'draft'));
    const hasSettlement = safeProps.some(x => x.settlement && x.settlement.txHash);

    const steps = [
      {
        id: 'welcome', title: 'Welcome to MainStreet',
        body: 'Your AI analyst for commercial real estate. This two-minute tour walks the full workflow — from CAM reconciliation to on-chain settlement — using the live product, not a mock.',
        go: null,
      },
      {
        id: 'command', title: 'AI Command Center',
        body: "Every session starts here: an executive briefing, ranked priorities with dollar impact, and portfolio health — computed live from your leases, invoices, and reconciliations. Nothing on this screen is invented.",
        go: () => { try { showCommandCenter(); } catch (_) {} },
        highlight: '.cc-brief',
      },
      p && {
        id: 'recon', title: 'CAM Reconciliation',
        body: `Each tenant's share is computed from their actual lease — caps and exclusions enforced automatically${topResult ? `. ${topResult.tenantName}'s reconciled share here is ${_fmt$(topResult.totalAllocated)}` : ''}. Every figure traces to an invoice or a lease clause.`,
        go: () => { try { ccOpenProperty(p.id); } catch (_) {} },
        delay: 700,
      },
      {
        id: 'workspace', title: 'AI Workspace',
        body: 'Ask anything in plain English. Answers come from your own documents — with page-level citations — and every answer ends with the next action you can take.',
        go: () => {
          try {
            openAIWorkspace(p ? { propertyId: p.id } : { scope: 'portfolio' });
            const q = (p && topResult) ? `Why does ${topResult.tenantName} owe money?` : 'Explain this portfolio';
            setTimeout(() => { try { aiwAsk(q); } catch (_) {} }, 200);
          } catch (_) {}
        },
        delay: 400,
      },
      p && {
        id: 'draft', title: 'Generate a Recovery Letter',
        body: 'MainStreet drafts professional documents from your evidence — reconciliation figures, verbatim lease quotes — for you to edit, save, and export. Nothing is ever sent automatically.',
        go: () => { try { openDraftingStudio('recoveryLetter', { propertyId: p.id }); } catch (_) {} },
      },
      p && (hasReserves
        ? {
            id: 'reserves', title: 'Reserve Intelligence',
            body: 'Lender reserves, decoded: balances, eligible uses, and exactly what stands between you and a reimbursement — the Escrow Readiness checklist tells you what the lender still needs.',
            go: () => { try { dftClose(); ccOpenReserves(p.id); } catch (_) {} },
            delay: 800,
          }
        : {
            id: 'reserves', title: 'Reserve Intelligence',
            body: "Upload a mortgage or escrow agreement here and MainStreet extracts the reserves — balances, eligible uses, lender requirements — with page-level citations, then tracks reimbursement readiness. (This portfolio hasn't loaded one yet, so you're seeing the starting point.)",
            go: () => { try { dftClose(); ccOpenReserves(p.id); } catch (_) {} },
            delay: 800,
          }),
      (p && hasReserves && hasDraftDraw) && {
        id: 'lender', title: 'Generate a Lender Package',
        body: 'When documentation is complete, MainStreet assembles the full reimbursement package — cover letter, reserve accounting, enclosure checklist — grounded in the mortgage terms it extracted.',
        go: () => { try { openDraftingStudio('lenderReimbursement', { propertyId: p.id }); } catch (_) {} },
      },
      {
        id: 'settlement', title: 'XRPL Settlement',
        body: hasSettlement
          ? 'Completed reconciliations settle in RLUSD on the XRP Ledger — a public, permanent receipt that landlord and tenant verify independently. The green settlement you see here is a real mainnet transaction.'
          : 'Completed reconciliations settle in RLUSD on the XRP Ledger — a public, permanent receipt that landlord and tenant verify independently. Once a reconciliation is billed, it appears here as ready to settle.',
        go: () => { try { dftClose(); showCommandCenter(); } catch (_) {} },
        highlight: '.cc-stl-panel',
      },
      {
        id: 'done', title: "That's MainStreet",
        body: 'Reconcile, explain, draft, get reimbursed, settle on-chain — one AI operating system for commercial real estate. Explore freely, or open the AI Workspace and just ask.',
        go: null,
      },
    ].filter(Boolean);

    return steps;
  }

  return { buildSteps };
})();
