/**
 * ai-workspace.js — Phase 22: AI Workspace (conversational orchestration layer)
 *
 * NOT a general-purpose chatbot. A commercial-real-estate analyst that answers
 * questions by consulting the intelligence MainStreet already computed:
 * lease review (fieldEvidence citations), reconciliation snapshots +
 * ReconciliationExplainer, EscrowReserveEngine (reserves/readiness/narrative),
 * AcquisitionEngine analysis, computeRecoveredRevenue, disputes, and XRPL
 * settlement records.
 *
 * Architecture: a deterministic intent registry. Each intent = { id, match, handle }.
 * handle() consults engines/data and returns a structured answer:
 *   { intent, heading, paragraphs[], citations[], actions[], confidence }
 * The renderer appends the product identity rule to EVERY answer:
 *   "What would you like to do next?" + action buttons.
 *
 * Honesty rules (same as the Command Center):
 *  - Answers state only what is on file; unknowns are said as unknown.
 *  - Citations render only when real evidence exists (quote/page/tx hash).
 *  - Questions we can't answer get an honest fallback, never an invention.
 *
 * Future compatibility: registerIntent() is public — voice, agent workflows,
 * memory, drafting, and LLM paraphrase can plug in as new intents/middleware
 * without touching the core. Context ({propertyId, tenantId, reserveId, drawId})
 * flows through every handler so surfaces can open the workspace pre-scoped.
 *
 * Exposes: window.AIWorkspace = { answer, buildSuggestions, renderAnswerHtml, registerIntent }
 */
window.AIWorkspace = (() => {
  'use strict';

  const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const _fmt$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const _num  = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  function _defaultDeps() {
    return {
      Selectors:         window.Selectors,
      EscrowEngine:      window.EscrowReserveEngine,
      AcquisitionEngine: window.AcquisitionEngine,
      ReconExplainer:    window.ReconciliationExplainer,
      computeRecovered:  window.computeRecoveredRevenue || null,
      now:               new Date(),
    };
  }

  const _recon = (p) => p.camReconciliation ?? p.results ?? null;
  const _reconBilled = (p) => (_recon(p)?.results || []).reduce((s, r) => s + (_num(r.totalAllocated) || _num(r.allocated)), 0);

  // ── evidence / citation helpers (reuse existing structures, no new index) ──

  function _tenantEvidence(t, fieldKeys) {
    for (const k of fieldKeys) {
      const snaps = t.fieldEvidence?.[k]?.snapshots;
      const last = Array.isArray(snaps) && snaps.length ? snaps[snaps.length - 1] : null;
      if (last && (last.quote || last.page != null)) {
        return { quote: last.quote || null, page: last.page ?? null };
      }
    }
    return null;
  }

  function _leaseCitation(p, t, fieldKeys) {
    const ev = _tenantEvidence(t, fieldKeys || []);
    return {
      source: `Lease — ${t.tenant_name}`,
      detail: ev && ev.page != null ? `Page ${ev.page}` : (p ? p.name : null),
      quote:  ev ? ev.quote : null,
    };
  }

  function _reserveCitations(r) {
    const cites = [];
    const ev = r.evidence || {};
    const best = ev.current_balance || ev.eligible_uses || ev.reserve_type;
    cites.push({
      source: `Mortgage — ${r.sourceFileName || 'reserve document'}`,
      detail: (r.sourcePages || []).length ? `Page ${r.sourcePages.join(', ')}` : null,
      quote:  best && best.quote ? best.quote : null,
    });
    return cites;
  }

  function _camReportCitation(p) {
    const recon = _recon(p);
    return { source: 'CAM Report', detail: `${recon?.camYear || ''} Allocation — ${p.name}`.trim(), quote: null };
  }

  // ── context resolution ──────────────────────────────────────────────────

  function _ctxProperty(ctx, props) {
    if (ctx && ctx.propertyId) {
      const p = props.find(x => x.id === ctx.propertyId);
      if (p) return p;
    }
    return props.length === 1 ? props[0] : null;
  }

  function _findTenantByQuestion(q, props, ctx) {
    const s = q.toLowerCase();
    for (const p of props) {
      for (const t of (p.tenants || [])) {
        if (t && t.tenant_name && s.includes(t.tenant_name.toLowerCase())) return { p, t };
      }
    }
    if (ctx && ctx.tenantId) {
      for (const p of props) {
        const t = (p.tenants || []).find(x => x && x.id === ctx.tenantId);
        if (t) return { p, t };
      }
    }
    return null;
  }

  function _scopedProps(ctx, props) {
    const p = _ctxProperty(ctx, props);
    return p ? [p] : props;
  }

  // ── standard action builders (route into real workflows) ─────────────────

  const _actOpenProperty  = (p) => ({ label: `Open ${p.name}`, js: `ccOpenProperty('${p.id}')` });
  const _actReserves      = (p) => ({ label: 'Open Reserve Requests', js: `ccOpenReserves('${p.id}')` });
  const _actCommandCenter = () => ({ label: 'Open Command Center', js: 'showCommandCenter()' });
  const _actPortfolio     = () => ({ label: 'View Portfolio', js: 'ccShowPortfolio()' });
  const _actAcquisitions  = () => ({ label: 'Open Acquisition Review', js: 'ccOpenAcquisitions()' });

  // ── intent registry ───────────────────────────────────────────────────────

  const INTENTS = [];
  function registerIntent(def) { INTENTS.push(def); }

  // ── Workspace Context (Phase 23 Stage 2) ──────────────────────────────────
  // Deterministic context, NOT chat memory: we remember the user's current
  // analytical task — the property scope, which engine answered last, and the
  // structured RESULT SET the last answer produced — so follow-ups reuse that
  // exact set instead of re-searching the portfolio. It expires naturally:
  // every fresh (non-follow-up) answer replaces it; clearing the workspace
  // clears it. Everything is visible via the context panel and the trace.

  const ENGINE_LABELS = {
    cam_caps: 'Lease Review Engine', audit_rights: 'Lease Review Engine',
    expirations: 'Lease Review Engine', knowledge_search: 'Lease Review Engine',
    tenant_charge: 'Reconciliation Engine', explain_recon: 'Reconciliation Engine',
    compare_costs: 'Reconciliation Engine', forecast: 'Reconciliation Engine',
    recovered_most: 'Recovery Engine', disputes: 'Dispute Records',
    reserve_balances: 'Reserve Intelligence Engine', reserve_rules: 'Reserve Intelligence Engine',
    draw_ready: 'Reserve Intelligence Engine', acquisitions: 'Acquisition Engine',
    settlements: 'Settlement Records', draft_document: 'Drafting Engine',
    explain_property: 'Portfolio Records', fallback: 'None (honest fallback)',
    followup_filter: 'Workspace Context', followup_draft: 'Drafting Engine',
    followup_evidence: 'Lease Review Engine', followup_open: 'Workspace Context',
    followup_why: 'Reasoning Trace',
  };

  const INTENT_SOURCES = {
    cam_caps: ['extracted lease terms', 'lease fieldEvidence (quotes + pages)'],
    audit_rights: ['extracted lease terms', 'lease fieldEvidence (quotes + pages)'],
    expirations: ['lease end dates on file'],
    tenant_charge: ['reconciliation snapshot', 'lease terms', 'ReconciliationExplainer'],
    explain_recon: ['reconciliation snapshot'],
    disputes: ['dispute records'],
    compare_costs: ['invoice records'],
    recovered_most: ['computeRecoveredRevenue'],
    reserve_balances: ['lender-stated balances', 'draw records'],
    reserve_rules: ['extracted reserve terms', 'reserve narrative'],
    draw_ready: ['draw validation checklist', 'escrow readiness'],
    acquisitions: ['acquisition analysis'],
    settlements: ['settlement records', 'reconciliation state'],
    forecast: ['reconciliation history (camRuns)'],
    knowledge_search: ['extracted evidence quotes', 'excluded categories', 'reserve terms', 'dispute reasons'],
    draft_document: ['drafting engine (evidence-grounded)'],
    explain_property: ['property records', 'portfolio KPIs'],
    fallback: [],
  };

  function _findItem(it, props) {
    const p = props.find(x => x.id === it.propertyId);
    const t = p ? (p.tenants || []).find(x => x && (x.id === it.tenantId || x.tenant_name === it.tenantName)) : null;
    const r = p ? ((_recon(p)?.results) || []).find(x => x.tenantName === it.tenantName) : null;
    return { p, t, r };
  }

  // Follow-up pre-pass: runs BEFORE normal routing when the question refers
  // back to the current context. Each returns an answer object or null.
  const FOLLOWUP_FILTERS = [
    { re: /reduc|cap applied|capped|saving/, label: 'whose cap reduced recoveries',
      pred: ({ r }) => !!(r && r.capApplied && (parseFloat(r.capAdjustment) || 0) > 0),
      line: ({ it, r }) => `${it.tenantName} — cap reduced billing by ${_fmt$(r.capAdjustment)}` },
    { re: /expired/, label: 'with expired leases',
      pred: ({ t }, today) => !!(t && t.end_date && t.end_date < today),
      line: ({ it, t }) => `${it.tenantName} — lease expired ${t.end_date}` },
    { re: /no cap|missing cap|without.*cap/, label: 'missing a CAM cap',
      pred: ({ t }) => !!(t && /nnn|triple/i.test(String(t.lease_type || '')) && (t.cap == null || t.cap === '')),
      line: ({ it }) => `${it.tenantName} — NNN lease, no cap on file` },
    { re: /dispute/, label: 'with open disputes',
      pred: ({ p, it }) => !!(p && (p.disputes || []).some(dd => dd && dd.tenantName === it.tenantName && dd.status !== 'accepted' && dd.status !== 'resolved' && dd.status !== 'rejected')),
      line: ({ it }) => `${it.tenantName} — open dispute on file` },
    { re: /audit/, label: 'with audit rights',
      pred: ({ t }) => !!(t && t.audit_rights),
      line: ({ it, t }) => `${it.tenantName} — ${typeof t.audit_rights === 'string' ? t.audit_rights : 'audit rights on file'}` },
  ];

  function _tryFollowup(q, s, wctx, env) {
    if (!wctx) return null;
    const { props, deps } = env;
    const set = wctx.resultSet;
    const refersBack = /\b(those|these|them|of those|of these|that list)\b/.test(s) || /^which of\b/.test(s);

    // "Which of those …?" — filter the previous deterministic result set.
    if (set && set.kind === 'tenants' && set.items.length && refersBack) {
      const f = FOLLOWUP_FILTERS.find(x => x.re.test(s));
      if (f) {
        const today = deps.now.toISOString().slice(0, 10);
        const kept = set.items
          .map(it => ({ it, ..._findItem(it, props) }))
          .filter(row => { try { return f.pred(row, today); } catch (_) { return false; } });
        return {
          intent: 'followup_filter',
          heading: `Of ${set.items.length} — ${kept.length} ${f.label}`,
          paragraphs: kept.length
            ? [kept.map(row => f.line(row)).join('; ') + '.']
            : [`None of the ${set.items.length} in "${set.label}" match that — checked each against the same engines, nothing qualified.`],
          citations: [],
          actions: kept.slice(0, 2).map(row => _actOpenProperty(row.p)).filter(Boolean),
          confidence: { pct: 94, basis: `filtered from "${set.label}"` },
          resultSet: kept.length ? { kind: 'tenants', label: `${set.label} → ${f.label}`, items: kept.map(row => row.it) } : set,
          _reused: set.label,
        };
      }
    }

    // "Generate recovery letters" — draft for the tenants already selected.
    if (set && set.kind === 'tenants' && set.items.length && /(generate|draft|write)\b/.test(s) && /(letter|explanation)s?\b/.test(s)) {
      const type = /explanation/.test(s) ? 'tenantCamExplanation' : 'recoveryLetter';
      const label = type === 'recoveryLetter' ? 'Recovery Letter' : 'CAM Explanation';
      return {
        intent: 'followup_draft',
        heading: `Draft ${label.toLowerCase()}s for ${set.items.length} tenant${set.items.length !== 1 ? 's' : ''}`,
        paragraphs: [`Using your current selection — "${set.label}" — no re-searching needed. Each draft is assembled from that tenant's reconciliation results and lease citations, for you to review and send.`],
        citations: [],
        actions: set.items.slice(0, 3).map(it => ({
          label: `Draft for ${it.tenantName}`,
          js: `openDraftingStudio('${type}', {propertyId:'${it.propertyId}', tenantId:'${it.tenantId}'})`,
        })),
        confidence: { pct: 95, basis: 'drafting engine + current result set' },
        resultSet: set, _reused: set.label,
      };
    }

    // "Show supporting lease language" — surface the verbatim evidence for the set.
    if (set && set.kind === 'tenants' && set.items.length && /(lease language|supporting (language|evidence|clauses?)|show .*clauses?)/.test(s)) {
      const rows = [], citations = [];
      for (const it of set.items.slice(0, 5)) {
        const { p, t } = _findItem(it, props);
        if (!t) continue;
        const ev = _tenantEvidence(t, ['cam_cap', 'cap', 'audit_rights', 'excluded_categories']);
        if (ev && ev.quote) {
          rows.push(`${it.tenantName}: "${ev.quote}"${ev.page != null ? ` (p. ${ev.page})` : ''}`);
          citations.push({ source: `Lease — ${it.tenantName}`, detail: ev.page != null ? `Page ${ev.page}` : (p ? p.name : null), quote: ev.quote });
        } else {
          rows.push(`${it.tenantName}: no verbatim clause extracted — reprocess the lease to capture it.`);
        }
      }
      return {
        intent: 'followup_evidence',
        heading: `Lease language for "${set.label}"`,
        paragraphs: [rows.join(' · ')],
        citations, actions: [],
        confidence: { pct: 92, basis: 'lease fieldEvidence (verbatim quotes)' },
        resultSet: set, _reused: set.label,
      };
    }

    // "Open the reconciliation / property / lease" — navigate with current scope.
    if (/(open|go to)\b.*(reconciliation|property|lease)/.test(s)) {
      const pid = wctx.propertyId || (set && set.items && set.items[0] && set.items[0].propertyId);
      const p = props.find(x => x.id === pid);
      if (p) {
        return {
          intent: 'followup_open',
          heading: `Opening ${p.name}`,
          paragraphs: [`Taking you to ${p.name}${/reconciliation/.test(s) ? "'s reconciliation" : ''} — your context stays active here.`],
          citations: [], actions: [_actOpenProperty(p)],
          confidence: { pct: 98, basis: 'workspace context' },
          resultSet: set || null, _reused: set ? set.label : null,
        };
      }
    }

    // "Why?" — explain how the LAST answer was derived, from its stored trace.
    if (/^(why|how)\b[\s\S]{0,25}\??$/.test(s.trim()) && wctx.lastTrace) {
      const tr = wctx.lastTrace;
      return {
        intent: 'followup_why',
        heading: 'How I got that answer',
        paragraphs: [
          `The previous answer came from the ${tr.engine}, scoped to ${tr.property}. Sources consulted: ${tr.sources.length ? tr.sources.join('; ') : 'none — it was an honest fallback'}. ${tr.citationsUsed ? `${tr.citationsUsed} citation${tr.citationsUsed !== 1 ? 's were' : ' was'} attached — verbatim quotes and page references you can check against the source documents.` : 'No citations were needed for that answer.'}${tr.reusedResultSet ? ` It reused your current selection ("${tr.reusedResultSet}") instead of re-searching.` : ''}`,
          'Every answer is deterministic: the same question over the same data always produces the same result — nothing is generated from outside your portfolio.',
        ],
        citations: [], actions: [],
        confidence: { pct: 100, basis: 'reasoning trace of the previous answer' },
        resultSet: set || null, _reused: null,
      };
    }

    return null;
  }

  // 0) Document drafting (Phase 23) — verb-gated so it can't swallow other
  // intents; routes into the Drafting Studio, which assembles the document
  // deterministically from evidence already on file.
  const _DRAFT_MAP = [
    [/recovery letter|recovery/, 'recoveryLetter',       'CAM Recovery Letter'],
    [/tenant.*(explanation|statement)|explanation/, 'tenantCamExplanation', 'Tenant CAM Explanation'],
    [/lender|reimburse|reserve package|draw package|package/, 'lenderReimbursement', 'Lender Reimbursement Letter'],
    [/dispute/, 'disputeResponse',    'Dispute Response'],
    [/lease.*summary/, 'leaseReviewSummary', 'Lease Review Summary'],
    [/acquisition/, 'acquisitionSummary', 'Acquisition Executive Summary'],
  ];
  registerIntent({
    id: 'draft_document',
    match: (s) => /(generate|draft|write|prepare)\b/.test(s) && /(letter|response|summary|package|explanation|document)/.test(s),
    handle: (q) => {
      const s = q.toLowerCase();
      const picks = _DRAFT_MAP.filter(([re]) => re.test(s));
      const chosen = picks.length ? picks : _DRAFT_MAP;
      return {
        heading: picks.length === 1 ? `Draft: ${picks[0][2]}` : 'What should I draft?',
        paragraphs: [
          'I assemble the document from your reconciliation results, lease citations, reserve records, and dispute history — nothing invented, every figure traceable. You review, edit, and send it yourself; MainStreet never sends anything automatically.',
        ],
        citations: [],
        actions: chosen.slice(0, 3).map(([, type, label]) => ({ label: `Draft ${label}`, js: `openDraftingStudio('${type}')` })),
        confidence: { pct: 95, basis: 'drafting engine (evidence-grounded)' },
      };
    },
  });

  // 1) CAM caps across the portfolio
  registerIntent({
    id: 'cam_caps',
    match: (s) => /cam cap|expense cap|caps\b/.test(s) && !/reserve|readiness/.test(s),
    handle: (q, ctx, { props }) => {
      const scoped = _scopedProps(ctx, props);
      const withCap = [], withoutCap = [], citations = [], items = [];
      for (const p of scoped) {
        for (const t of (p.tenants || []).filter(Boolean)) {
          if (t.cap != null && t.cap !== '') {
            withCap.push(`${t.tenant_name} (${p.name}) — ${t.cap}% annual cap${t.capBaseAmount ? ` on a ${_fmt$(t.capBaseAmount)} base` : ''}`);
            citations.push(_leaseCitation(p, t, ['cam_cap', 'cap']));
            items.push({ propertyId: p.id, propertyName: p.name, tenantId: t.id, tenantName: t.tenant_name });
          } else if (/nnn|triple/i.test(String(t.lease_type || ''))) {
            withoutCap.push(`${t.tenant_name} (${p.name}) — NNN lease, no cap on file`);
          }
        }
      }
      const paragraphs = [];
      if (withCap.length) paragraphs.push(`${withCap.length} lease${withCap.length !== 1 ? 's carry' : ' carries'} a CAM cap: ${withCap.join('; ')}.`);
      if (withoutCap.length) paragraphs.push(`⚠ ${withoutCap.join('; ')}. Until a cap is confirmed, MainStreet can't verify these tenants aren't being overcharged.`);
      if (!withCap.length && !withoutCap.length) paragraphs.push('No CAM caps are on file for this scope — upload leases so cap terms can be extracted and enforced.');
      return {
        heading: 'CAM caps on file', paragraphs, citations: citations.slice(0, 4),
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 92, basis: 'extracted lease terms' },
        resultSet: items.length ? { kind: 'tenants', label: 'Tenants with CAM caps', items } : null,
      };
    },
  });

  // 2) Audit rights
  registerIntent({
    id: 'audit_rights',
    match: (s) => /audit right/.test(s),
    handle: (q, ctx, { props }) => {
      const scoped = _scopedProps(ctx, props);
      const rows = [], citations = [], items = [];
      for (const p of scoped) {
        for (const t of (p.tenants || []).filter(Boolean)) {
          if (t.audit_rights) {
            rows.push(`${t.tenant_name} (${p.name}) — ${typeof t.audit_rights === 'string' ? t.audit_rights : 'audit rights on file'}`);
            citations.push(_leaseCitation(p, t, ['audit_rights']));
            items.push({ propertyId: p.id, propertyName: p.name, tenantId: t.id, tenantName: t.tenant_name });
          }
        }
      }
      return {
        resultSet: items.length ? { kind: 'tenants', label: 'Tenants with audit rights', items } : null,
        heading: 'Tenants with audit rights',
        paragraphs: rows.length
          ? [`${rows.length} tenant${rows.length !== 1 ? 's have' : ' has'} audit rights: ${rows.join('; ')}.`,
             'Allocations for these tenants should be airtight — they can demand your backup documentation.']
          : ['No audit-rights clauses are on file in this scope.'],
        citations: citations.slice(0, 4),
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 90, basis: 'extracted lease terms' },
      };
    },
  });

  // 3) Lease expirations
  registerIntent({
    id: 'expirations',
    match: (s) => /expir/.test(s) && /lease|tenant|next year|this year|soon/.test(s),
    handle: (q, ctx, { props, deps }) => {
      const scoped = _scopedProps(ctx, props);
      const today = deps.now.toISOString().slice(0, 10);
      const yearMatch = q.match(/(20\d{2})/);
      const nextYear = /next year/.test(q.toLowerCase()) ? deps.now.getFullYear() + 1 : null;
      const targetYear = yearMatch ? Number(yearMatch[1]) : nextYear;
      const rows = [], items = [];
      for (const p of scoped) {
        for (const t of (p.tenants || []).filter(x => x && x.end_date)) {
          const inYear = targetYear ? t.end_date.startsWith(String(targetYear)) : true;
          if (!inYear) continue;
          const expired = t.end_date < today;
          rows.push({ line: `${t.tenant_name} (${p.name}) — ${expired ? 'EXPIRED ' : ''}${t.end_date} · ${Number(t.leased_sqft || 0).toLocaleString('en-US')} sf`, date: t.end_date });
          items.push({ propertyId: p.id, propertyName: p.name, tenantId: t.id, tenantName: t.tenant_name });
        }
      }
      rows.sort((a, b) => a.date.localeCompare(b.date));
      return {
        resultSet: items.length ? { kind: 'tenants', label: targetYear ? `Leases expiring in ${targetYear}` : 'Lease expirations', items } : null,
        heading: targetYear ? `Leases expiring in ${targetYear}` : 'Lease expirations',
        paragraphs: rows.length
          ? [rows.map(r => r.line).join('; ') + '.', 'Expired or near-term leases weaken CAM enforcement — start renewals early to protect recovery terms.']
          : ['No lease expirations found for that scope.'],
        citations: [], actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 95, basis: 'lease end dates on file' },
      };
    },
  });

  // 4) "Why does <tenant> owe …" / explain a tenant's charge
  registerIntent({
    id: 'tenant_charge',
    match: (s, ctx, { props }) => (/why does|owes?\b|charge/.test(s) && !!_findTenantByQuestion(s, props, ctx)) ||
                                  (/explain (this )?(lease|tenant)/.test(s) && !!(ctx && ctx.tenantId)),
    handle: (q, ctx, { props, deps }) => {
      const hit = _findTenantByQuestion(q, props, ctx);
      if (!hit) return null;
      const { p, t } = hit;
      const result = (_recon(p)?.results || []).find(r => r.tenantName === t.tenant_name);
      const paragraphs = [];
      if (result) {
        let narrative = null;
        try { narrative = deps.ReconExplainer?.buildReconciliationSummaryNarrative?.(result, t) || null; } catch (_) { narrative = null; }
        if (narrative) paragraphs.push(narrative);
        else {
          const billed = _num(result.totalAllocated) || _num(result.allocated);
          paragraphs.push(`${t.tenant_name} occupies ${Number(t.leased_sqft || 0).toLocaleString('en-US')} sf (${(result.proRataPercent || 0).toFixed(2)}% pro-rata share) and was billed ${_fmt$(billed)} for ${_recon(p)?.camYear || 'this'} CAM.`);
        }
        if (result.capApplied && _num(result.capAdjustment) > 0) {
          paragraphs.push(`Their lease cap reduced the bill by ${_fmt$(result.capAdjustment)} — enforced automatically from the lease terms.`);
        }
      } else {
        paragraphs.push(`${t.tenant_name} isn't in a completed reconciliation yet — run the CAM reconciliation on ${p.name} to compute their share.`);
      }
      return {
        heading: `${t.tenant_name} — charge explanation`, paragraphs,
        citations: [_leaseCitation(p, t, ['cam_cap', 'leased_sqft']), _camReportCitation(p)].filter(c => c.detail || c.quote),
        actions: [_actOpenProperty(p)],
        confidence: { pct: result ? 93 : 85, basis: result ? 'reconciliation results & lease terms' : 'workflow state' },
      };
    },
  });

  // 5) Explain the reconciliation / how CAM was calculated
  registerIntent({
    id: 'explain_recon',
    match: (s) => /explain (this |the )?reconciliation|how was cam calculated|how is cam calculated/.test(s),
    handle: (q, ctx, { props }) => {
      const p = _ctxProperty(ctx, props);
      if (!p) return { heading: 'Which property?', paragraphs: ['Open a property (or ask about one by name) and I\'ll walk through its reconciliation.'], citations: [], actions: [_actPortfolio()], confidence: { pct: 95, basis: 'workflow state' } };
      const recon = _recon(p);
      const results = recon?.results || [];
      if (!results.length) {
        return { heading: `${p.name} — no reconciliation yet`, paragraphs: ['No completed reconciliation is on file. Load leases and invoices, then run the CAM allocation.'], citations: [], actions: [_actOpenProperty(p)], confidence: { pct: 95, basis: 'workflow state' } };
      }
      const total = _num(recon.total);
      const billed = _reconBilled(p);
      const capSaved = results.reduce((s, r) => s + (r.capApplied ? _num(r.capAdjustment) : 0), 0);
      const prSum = results.reduce((s, r) => s + _num(r.proRataPercent), 0);
      const paragraphs = [
        `${p.name}'s ${recon.camYear || ''} CAM pool was ${_fmt$(total)}. Each tenant's share is their square footage as a percentage of the building, applied to the pool, then adjusted for the caps and exclusions in their lease.`,
        `Result: ${_fmt$(billed)} billed across ${results.length} tenants. Lease caps reduced billings by ${_fmt$(capSaved)} — money the leases say tenants don't owe.`,
      ];
      if (100 - prSum >= 5) paragraphs.push(`${(100 - prSum).toFixed(1)}% of costs (${_fmt$(total * (100 - prSum) / 100)}) have no paying tenant — absorbed by ownership until the space is leased.`);
      return {
        heading: `How ${p.name}'s CAM was calculated`, paragraphs,
        citations: [_camReportCitation(p)],
        actions: [_actOpenProperty(p)],
        confidence: { pct: 95, basis: 'reconciliation snapshot' },
      };
    },
  });

  // 6) Disputes (open / history / underpaying)
  registerIntent({
    id: 'disputes',
    match: (s) => /dispute|underpay/.test(s),
    handle: (q, ctx, { props }) => {
      const scoped = _scopedProps(ctx, props);
      const open = [], resolved = [], citations = [];
      for (const p of scoped) {
        for (const d of (p.disputes || []).filter(Boolean)) {
          const line = `${d.tenantName || 'Tenant'} — ${d.vendor || d.category || 'charge'} ${_num(d.tenantShare ?? d.amount) ? '(' + _fmt$(d.tenantShare ?? d.amount) + ')' : ''} · ${d.status}`;
          (d.status === 'open' || d.status === 'docs_requested' ? open : resolved).push(line);
          citations.push({ source: 'Dispute Record', detail: `${d.tenantName || ''} · ${p.name}`, quote: d.reason ? String(d.reason).slice(0, 140) : null });
        }
      }
      const paragraphs = [];
      if (open.length) paragraphs.push(`${open.length} dispute${open.length !== 1 ? 's need' : ' needs'} a decision: ${open.join('; ')}. Each holds its charge in limbo until you respond.`);
      else paragraphs.push('No disputes are awaiting a decision.');
      if (resolved.length) paragraphs.push(`Resolved history: ${resolved.join('; ')}.`);
      return {
        heading: 'Dispute status', paragraphs, citations: citations.slice(0, 4),
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 95, basis: 'dispute records' },
      };
    },
  });

  // 7) Compare costs by category
  registerIntent({
    id: 'compare_costs',
    match: (s) => /compare .*(cost|expense)|insurance costs|cost of (insurance|janitorial|utilities)/.test(s),
    handle: (q, ctx, { props }) => {
      const catMatch = q.toLowerCase().match(/compare\s+(\w+)|(insurance|janitorial|utilities|repairs|maintenance|management)/);
      const cat = (catMatch && (catMatch[1] || catMatch[2]) || 'insurance').toLowerCase();
      const rows = [], citations = [];
      for (const p of props) {
        const recon = _recon(p);
        const invoices = (recon?.invoicesFull?.length ? recon.invoicesFull : null) || recon?.invoices || p.invoices || [];
        const sum = invoices.filter(i => i && String(i.category || '').toLowerCase() === cat).reduce((s, i) => s + _num(i.amount), 0);
        if (sum > 0) {
          rows.push({ name: p.name, sum, sqft: p.totalSqft || null });
          citations.push({ source: 'Invoices', detail: `${p.name} — ${cat}`, quote: null });
        }
      }
      rows.sort((a, b) => b.sum - a.sum);
      return {
        heading: `${cat.charAt(0).toUpperCase() + cat.slice(1)} costs by property`,
        paragraphs: rows.length
          ? [rows.map(r => `${r.name}: ${_fmt$(r.sum)}${r.sqft ? ` (${(r.sum / r.sqft).toFixed(2)}/sf)` : ''}`).join('; ') + '.',
             rows.length > 1 ? 'Per-square-foot cost is the comparable number — a high outlier is a re-bid candidate.' : 'Add more properties to compare across the portfolio.']
          : [`No ${cat} invoices are on file yet.`],
        citations: citations.slice(0, 3), actions: rows.slice(0, 2).map(r => _actOpenProperty(props.find(p => p.name === r.name))),
        confidence: { pct: 93, basis: 'invoice records' },
      };
    },
  });

  // 8) Recovered the most / recovery totals
  registerIntent({
    id: 'recovered_most',
    match: (s) => /recovered the most|most revenue|recovery totals|how much.*recovered/.test(s),
    handle: (q, ctx, { props, deps }) => {
      const rr = typeof deps.computeRecovered === 'function' ? deps.computeRecovered(props) : null;
      if (!rr || !(rr.total > 0)) return { heading: 'Recovered value', paragraphs: ['No recovered value has been computed yet — run reconciliations to surface cap savings, dispute recoveries, and exclusion savings.'], citations: [], actions: [_actPortfolio()], confidence: { pct: 90, basis: 'recovery engine' } };
      const top = (rr.byProperty || []).slice().sort((a, b) => b.total - a.total)[0];
      return {
        heading: 'Recovered value',
        paragraphs: [
          `Portfolio total: ${_fmt$(rr.total)} — ${_fmt$(rr.capSavings)} from cap enforcement, ${_fmt$(rr.disputeRecoveries)} from resolved disputes, ${_fmt$(rr.exclusionSavings)} from lease exclusions.`,
          top ? `${top.name} leads with ${_fmt$(top.total)} identified.` : '',
        ].filter(Boolean),
        citations: [{ source: 'CAM Report', detail: 'Recovered Revenue analysis', quote: null }],
        actions: [_actCommandCenter()],
        confidence: { pct: 94, basis: 'recovery engine' },
      };
    },
  });

  // 9) Reserve balances / show reserves
  registerIntent({
    id: 'reserve_balances',
    match: (s) => /reserve balance|show reserves|reserve accounts?/.test(s),
    handle: (q, ctx, { props, deps }) => {
      const EE = deps.EscrowEngine;
      const scoped = _scopedProps(ctx, props);
      const rows = [], citations = [];
      for (const p of scoped) {
        for (const r of (p.escrowReserves || []).filter(Boolean)) {
          const bal = EE ? EE.computeReserveBalance(r, p.drawRequests || []) : { availableBalance: r.currentBalance };
          rows.push(`${r.reserveTypeLabel} (${p.name}) — ${bal.availableBalance != null ? _fmt$(bal.availableBalance) + ' available' : 'balance not on file'}${bal.committedAmount ? ` (${_fmt$(bal.committedAmount)} committed)` : ''}`);
          citations.push(..._reserveCitations(r));
        }
      }
      return {
        heading: 'Reserve balances',
        paragraphs: rows.length ? [rows.join('; ') + '.'] : ['No reserve accounts are on file — upload the mortgage or escrow agreement and MainStreet will extract them.'],
        citations: citations.slice(0, 3),
        actions: scoped.filter(p => (p.escrowReserves || []).length).slice(0, 2).map(_actReserves),
        confidence: { pct: 92, basis: 'lender-stated balances & draw records' },
      };
    },
  });

  // 10) Which reserve pays X / can this be reimbursed / lender requirements
  registerIntent({
    id: 'reserve_rules',
    match: (s) => /which reserve|be reimbursed|reimbursement for|lender requirement|reserve rule|explain lender/.test(s),
    handle: (q, ctx, { props, deps }) => {
      const EE = deps.EscrowEngine;
      const scoped = _scopedProps(ctx, props);
      const typeGuess = EE ? EE.classifyReserveType(q) : 'other';
      const matches = [];
      for (const p of scoped) {
        for (const r of (p.escrowReserves || []).filter(Boolean)) {
          if (typeGuess === 'other' || r.reserveType === typeGuess) matches.push({ p, r });
        }
      }
      if (!matches.length) {
        return { heading: 'Reserve eligibility', paragraphs: ['No matching reserve account is on file for that work. If your loan documents include one, upload them and MainStreet will extract the terms.'], citations: [], actions: scoped.slice(0, 1).map(_actReserves), confidence: { pct: 88, basis: 'reserve documents on file' } };
      }
      const paragraphs = [], citations = [];
      for (const { p, r } of matches.slice(0, 2)) {
        const narrative = EE && EE.buildReserveNarrative ? EE.buildReserveNarrative(r) : (r.eligibleUses || '');
        paragraphs.push(`${r.reserveTypeLabel} (${p.name}): ${narrative}`);
        citations.push(..._reserveCitations(r));
      }
      return {
        heading: 'What the lender allows', paragraphs, citations: citations.slice(0, 3),
        actions: matches.slice(0, 2).map(({ p }) => _actReserves(p)),
        confidence: { pct: 90, basis: 'extracted reserve terms' },
      };
    },
  });

  // 11) Why isn't this draw ready / missing documents
  registerIntent({
    id: 'draw_ready',
    match: (s) => /draw.*(ready|missing)|why isn'?t.*(draw|request)|documents.*(missing|still)|missing documents/.test(s),
    handle: (q, ctx, { props, deps }) => {
      const EE = deps.EscrowEngine;
      const scoped = _scopedProps(ctx, props);
      const paragraphs = [], citations = [], actions = [];
      let found = false;
      for (const p of scoped) {
        const draws = (p.drawRequests || []).filter(Boolean);
        for (const dr of draws.filter(d => d.status === 'draft' && (!ctx?.drawId || d.id === ctx.drawId))) {
          const r = (p.escrowReserves || []).find(x => x && x.id === dr.reserveId);
          if (!r || !EE?.computeEscrowReadiness) continue;
          found = true;
          const rd = EE.computeEscrowReadiness(r, dr, draws);
          paragraphs.push(`${r.reserveTypeLabel} draw for ${_fmt$(dr.amountRequested)} (${p.name}) — ${rd.score}% ready. ${rd.summary}`);
          citations.push(..._reserveCitations(r));
          actions.push(rd.ready ? { label: 'Generate Lender Package', js: `ccOpenReserves('${p.id}')` } : { label: 'Complete Draw Request', js: `ccOpenReserves('${p.id}')` });
        }
      }
      if (!found) paragraphs.push('No draft reserve requests are in progress. Start one from a reserve account after completing eligible work.');
      return {
        heading: 'Reserve request readiness', paragraphs, citations: citations.slice(0, 3),
        actions: actions.length ? actions.slice(0, 2) : scoped.slice(0, 1).map(_actReserves),
        confidence: { pct: 94, basis: 'draw validation checklist' },
      };
    },
  });

  // 12) Acquisitions
  registerIntent({
    id: 'acquisitions',
    match: (s) => /acquisition|investment score|capital risk|\broi\b|due diligence/.test(s),
    handle: (q, ctx, { acqReviews }) => {
      const revs = (acqReviews || []).filter(Boolean);
      if (!revs.length) return { heading: 'Acquisitions', paragraphs: ['No acquisition reviews are on file. Start one to analyze a target\'s leases, CAM recovery, and capital risk before you buy.'], citations: [], actions: [_actAcquisitions()], confidence: { pct: 95, basis: 'workflow state' } };
      const paragraphs = revs.slice(0, 3).map(rev => {
        const a = rev.analysis || rev;
        const rate = _num(a.recoveryRate ?? a.revenueRecovery?.recoveryRate);
        const atRisk = _num(a.totalAtRisk ?? a.revenueRecovery?.totalAtRisk);
        return `${rev.name || 'Target'}: CAM recovery ${rate ? rate.toFixed(1) + '%' : 'not computed'}${atRisk ? `, ${_fmt$(atRisk)}/yr at risk from cap leakage and missed recoveries` : ''}${rate && rate < 70 ? ' — below the 70% threshold; quantify before closing' : ''}.`;
      });
      paragraphs.push('Note: MainStreet analyzes recovery quality and lease risk — a full ROI model (price, financing, NOI) isn\'t computed here.');
      return {
        heading: 'Acquisition intelligence', paragraphs,
        citations: revs.slice(0, 2).map(rev => ({ source: 'Acquisition Review', detail: rev.name || null, quote: null })),
        actions: [_actAcquisitions()],
        confidence: { pct: 90, basis: 'acquisition analysis' },
      };
    },
  });

  // 13) Settlements / XRPL
  registerIntent({
    id: 'settlements',
    match: (s) => /settle|rlusd|xrpl|on.?chain|payments? (history|settled)/.test(s),
    handle: (q, ctx, { props }) => {
      const scoped = _scopedProps(ctx, props);
      const settled = [], ready = [], citations = [], actions = [];
      for (const p of scoped) {
        const s = p.settlement;
        const billed = _reconBilled(p);
        if (s && s.txHash) {
          settled.push(`${p.name} — settled${s.amountUsd ? ' (' + _fmt$(s.amountUsd) + ')' : ''} and verified on the XRP Ledger`);
          citations.push({ source: 'XRPL Transaction', detail: s.txHash.slice(0, 12) + '…', quote: null, href: s.explorerLink || null });
          if (s.explorerLink) actions.push({ label: 'View Transaction on XRPL', js: `window.open('${s.explorerLink}','_blank')` });
        } else if (billed > 0) {
          ready.push(`${p.name} — ${_fmt$(billed)} reconciled and billable in RLUSD`);
          actions.push({ label: `Review ${p.name} Settlement`, js: `ccOpenProperty('${p.id}')` });
        }
      }
      const paragraphs = [];
      if (settled.length) paragraphs.push(`Settled: ${settled.join('; ')}. Anyone — including your tenants — can verify these on the public ledger.`);
      if (ready.length) paragraphs.push(`Ready to settle: ${ready.join('; ')}.`);
      if (!settled.length && !ready.length) paragraphs.push('No settlements yet — complete a reconciliation and its billed amount becomes settleable in RLUSD.');
      return {
        heading: 'RLUSD settlement status', paragraphs, citations: citations.slice(0, 3),
        actions: actions.slice(0, 2),
        confidence: { pct: 96, basis: 'settlement records & reconciliation state' },
      };
    },
  });

  // 14) Forecast (honest heuristic from real history)
  registerIntent({
    id: 'forecast',
    match: (s) => /forecast|project(ed)? (cam|recovery)|next year.*cam/.test(s),
    handle: (q, ctx, { props }) => {
      const p = _ctxProperty(ctx, props) || props[0];
      const runs = _recon(p)?.camRuns || [];
      if (runs.length < 2) return { heading: 'CAM forecast', paragraphs: ['Not enough history to forecast — one more reconciled year and I can project from the actual trend. I won\'t invent a number.'], citations: [], actions: p ? [_actOpenProperty(p)] : [_actPortfolio()], confidence: { pct: 95, basis: 'reconciliation history' } };
      const curr = runs[0], prev = runs.slice(1).find(r => r.camYear !== curr.camYear) || runs[1];
      const pct = (curr.totalExpenses - prev.totalExpenses) / prev.totalExpenses;
      const projected = curr.totalExpenses * (1 + pct);
      return {
        heading: `CAM trend projection — ${p.name}`,
        paragraphs: [
          `Expenses moved ${(pct * 100).toFixed(1)}% (${_fmt$(prev.totalExpenses)} in ${prev.camYear} → ${_fmt$(curr.totalExpenses)} in ${curr.camYear}). At the same rate, next year lands near ${_fmt$(projected)}.`,
          'This is a straight-line trend from your actual history — a planning anchor, not a promise.',
        ],
        citations: [_camReportCitation(p)],
        actions: [_actOpenProperty(p)],
        confidence: { pct: 70, basis: 'two-year expense trend (heuristic)' },
      };
    },
  });

  // 15) Explain this property / portfolio overview
  registerIntent({
    id: 'explain_property',
    match: (s, ctx) => /explain (this )?(property|portfolio)|overview|summar(y|ize)/.test(s) || (/^explain/.test(s.trim()) && !!ctx?.propertyId),
    handle: (q, ctx, { props, deps }) => {
      const p = _ctxProperty(ctx, props);
      const S = deps.Selectors;
      if (!p) {
        // Portfolio-level explain (used by ✨ Explain This on portfolio surfaces).
        if (!/portfolio/.test(q.toLowerCase())) return null;
        const k = S?.portfolioKPIs ? S.portfolioKPIs(props) : null;
        return {
          heading: 'Your portfolio at a glance',
          paragraphs: [
            `${props.length} propert${props.length === 1 ? 'y' : 'ies'}${k?.occupancyPct != null ? `, ${k.occupancyPct}% average occupancy` : ''}${k?.cam ? `, ${_fmt$(k.cam)} in CAM expenses under management` : ''}${k?.openDisputes ? `, ${k.openDisputes} open dispute${k.openDisputes !== 1 ? 's' : ''}` : ''}.`,
            'Ask about any property, tenant, reserve, or settlement — or open the Command Center for today\'s prioritized actions.',
          ],
          citations: [], actions: [_actCommandCenter(), _actPortfolio()],
          confidence: { pct: 94, basis: 'portfolio records' },
        };
      }
      const meta = S?.buildPropMeta ? S.buildPropMeta(p) : {};
      const occupied = (p.tenants || []).reduce((s, t) => s + _num(t && t.leased_sqft), 0);
      const occ = p.totalSqft ? Math.round((occupied / p.totalSqft) * 100) : null;
      return {
        heading: `${p.name} at a glance`,
        paragraphs: [
          `${(p.tenants || []).length} tenants${occ != null ? `, ${occ}% occupied` : ''}${meta.total ? `, ${_fmt$(meta.total)} in ${meta.camYear || 'current'} CAM expenses` : ''}${meta.openDisputes ? `, ${meta.openDisputes} open dispute${meta.openDisputes !== 1 ? 's' : ''}` : ''}. Risk level: ${meta.riskLevel || 'not assessed'}.`,
          'Ask me anything specific — a tenant\'s charge, a lease clause, reserve rules, or settlement status.',
        ],
        citations: [_camReportCitation(p)],
        actions: [_actOpenProperty(p), _actCommandCenter()],
        confidence: { pct: 94, basis: 'property records' },
      };
    },
  });

  // 16) Generic knowledge search across extracted evidence (last resort before fallback)
  registerIntent({
    id: 'knowledge_search',
    match: (s) => /where does|which (lease|tenant)|find |search |show .*(clause|exclusion)|who pays|clause/.test(s),
    handle: (q, ctx, { props }) => {
      const scoped = _scopedProps(ctx, props);
      const terms = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length > 3 && !['does', 'which', 'where', 'show', 'find', 'search', 'every', 'lease', 'leases', 'tenant', 'tenants', 'discuss', 'clause', 'clauses', 'document', 'documents', 'pays'].includes(w));
      const hits = [];
      for (const p of scoped) {
        for (const t of (p.tenants || []).filter(Boolean)) {
          // excluded categories
          const excl = String(t.excluded_categories || '').toLowerCase();
          if (terms.some(w => excl.includes(w))) hits.push({ text: `${t.tenant_name} (${p.name}) — lease excludes: ${t.excluded_categories}`, cite: _leaseCitation(p, t, ['excluded_categories']) });
          // evidence quotes
          for (const k of Object.keys(t.fieldEvidence || {})) {
            const snaps = t.fieldEvidence[k]?.snapshots || [];
            const last = snaps[snaps.length - 1];
            if (last && last.quote && terms.some(w => String(last.quote).toLowerCase().includes(w))) {
              hits.push({ text: `${t.tenant_name} (${p.name}) — lease ${k.replace(/_/g, ' ')}: "${String(last.quote).slice(0, 120)}"`, cite: { source: `Lease — ${t.tenant_name}`, detail: last.page != null ? `Page ${last.page}` : null, quote: last.quote } });
            }
          }
        }
        for (const r of (p.escrowReserves || []).filter(Boolean)) {
          const hay = [r.eligibleUses, r.notes].filter(Boolean).join(' ').toLowerCase();
          if (terms.some(w => hay.includes(w))) hits.push({ text: `${r.reserveTypeLabel} (${p.name}) — ${r.eligibleUses || r.notes}`, cite: _reserveCitations(r)[0] });
        }
        for (const d of (p.disputes || []).filter(Boolean)) {
          if (d.reason && terms.some(w => String(d.reason).toLowerCase().includes(w))) hits.push({ text: `Dispute — ${d.tenantName || ''} (${p.name}): ${String(d.reason).slice(0, 120)}`, cite: { source: 'Dispute Record', detail: p.name, quote: null } });
        }
      }
      if (!hits.length) {
        return {
          heading: 'No matches in your documents',
          paragraphs: [`I searched the extracted lease terms, reserve documents, and dispute records${terms.length ? ` for "${terms.join(' ')}"` : ''} and found nothing on file. If the source document mentions it, reprocess it with AI so the clause gets extracted.`],
          citations: [], actions: scoped.slice(0, 1).map(_actOpenProperty),
          confidence: { pct: 85, basis: 'extracted evidence on file' },
        };
      }
      return {
        heading: `Found ${hits.length} match${hits.length !== 1 ? 'es' : ''} in your documents`,
        paragraphs: [hits.slice(0, 5).map(h => h.text).join(' · ')],
        citations: hits.slice(0, 4).map(h => h.cite).filter(Boolean),
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 88, basis: 'extracted evidence (quotes & citations)' },
      };
    },
  });

  // Fallback — honest capability statement, never an invention.
  const FALLBACK = {
    id: 'fallback',
    handle: (q, ctx, { props }) => ({
      heading: 'I answer from your portfolio, not from the internet',
      paragraphs: [
        'I can explain reconciliations and tenant charges, search extracted lease and mortgage terms, check reserve eligibility and readiness, review disputes, compare costs, and show RLUSD settlement status — all from the documents and analyses on file. I couldn\'t map that question to your data, so rather than guess, here are things I can answer:',
      ],
      citations: [], actions: [_actCommandCenter(), _actPortfolio()],
      confidence: { pct: 100, basis: 'honest fallback' },
      showSuggestions: true,
    }),
  };

  // ── public API ─────────────────────────────────────────────────────────────

  function answer({ question, context, wctx, props, acqReviews, deps } = {}) {
    const d = { ..._defaultDeps(), ...(deps || {}) };
    const q = String(question || '').trim();
    const safeProps = Array.isArray(props) ? props.filter(Boolean) : [];
    const env = { props: safeProps, acqReviews: acqReviews || [], deps: d };
    const s = q.toLowerCase();

    // Follow-up pre-pass: reuse the current deterministic result set when the
    // question refers back to it ("which of those…", "generate letters", "why?").
    let result = null, intentId = 'fallback', isFollowup = false;
    try { result = _tryFollowup(q, s, wctx || null, env); } catch (_) { result = null; }
    if (result) { intentId = result.intent; isFollowup = true; }

    if (!result) {
      for (const intent of INTENTS) {
        let m = false;
        try { m = intent.match(s, context, env); } catch (_) { m = false; }
        if (!m) continue;
        try { result = intent.handle(q, context, env); } catch (_) { result = null; }
        if (result) { intentId = intent.id; break; }
      }
    }
    if (!result) result = FALLBACK.handle(q, context, env);

    // ── Reasoning trace — the deterministic trail of how this answer was made.
    const scopedProp = _ctxProperty(context, safeProps);
    const trace = {
      intent: intentId,
      engine: ENGINE_LABELS[intentId] || 'Portfolio Records',
      property: scopedProp ? scopedProp.name : (wctx && wctx.propertyName && isFollowup ? wctx.propertyName : 'portfolio-wide'),
      sources: INTENT_SOURCES[intentId] || (isFollowup ? ['workspace context (previous result set)'] : []),
      citationsUsed: (result.citations || []).filter(c => c && (c.quote || c.detail)).length,
      reusedResultSet: result._reused || null,
      resultSetProduced: result.resultSet ? `${result.resultSet.label} (${result.resultSet.items.length})` : null,
    };

    // ── Next Workspace Context — natural expiry: a fresh answer replaces the
    // result set (with its own, or with nothing on a topic change); follow-ups
    // and the honest fallback preserve it.
    const keepSet = isFollowup || intentId === 'fallback';
    const nextWctx = {
      propertyId:   scopedProp ? scopedProp.id : (wctx ? wctx.propertyId : null) || null,
      propertyName: scopedProp ? scopedProp.name : (wctx ? wctx.propertyName : null) || null,
      engine:       trace.engine,
      intent:       intentId,
      resultSet:    result.resultSet || (keepSet && wctx ? wctx.resultSet : null) || null,
      lastTrace:    trace,
      updatedAt:    d.now.toISOString(),
    };

    const out = { intent: intentId, question: q, ...result, trace, context: nextWctx };
    delete out._reused;
    return out;
  }

  function buildSuggestions(context, { props } = {}) {
    const p = context && context.propertyId && Array.isArray(props) ? props.find(x => x.id === context.propertyId) : null;
    const base = p
      ? [`Explain ${p.name}'s reconciliation`, `Which tenants at ${p.name} have CAM caps?`, 'Why isn\'t this draw ready?', 'Show reserve balances', 'Show settlement status', 'Which leases expire next year?']
      : ['Find every CAM cap', 'Which leases expire next year?', 'Show unresolved disputes', 'Compare insurance costs', 'Which property recovered the most revenue?', 'Show reserve balances', 'Which reconciliations are ready for RLUSD settlement?', 'Generate a recovery letter'];
    return base;
  }

  // ── renderer — the identity rule lives HERE so every answer carries it ────
  function renderAnswerHtml(a) {
    const cites = (a.citations || []).filter(c => c && (c.source || c.quote)).map(c => `
      <span class="aiw-cite" title="${_esc(c.quote || '')}">${_esc(c.source)}${c.detail ? ` · ${_esc(c.detail)}` : ''}</span>`).join('');
    const actions = (a.actions && a.actions.length ? a.actions : [{ label: 'Open Command Center', js: 'showCommandCenter()' }])
      .map(x => `<button class="aiw-action" onclick="${x.js}">${_esc(x.label)}</button>`).join('');
    return `
      <div class="aiw-answer">
        ${a.heading ? `<div class="aiw-heading">${_esc(a.heading)}</div>` : ''}
        ${(a.paragraphs || []).map(t => `<p class="aiw-p">${_esc(t)}</p>`).join('')}
        ${cites ? `<div class="aiw-cites">${cites}</div>` : ''}
        ${a.confidence ? `<div class="aiw-conf">Confidence ${a.confidence.pct}% · ${_esc(a.confidence.basis)}</div>` : ''}
        ${a.trace ? `<div class="aiw-from">Answer generated from: <b>${_esc(a.trace.engine)}</b> · ${_esc(a.trace.property)}${a.trace.resultSetProduced ? ` · ${_esc(a.trace.resultSetProduced)}` : ''}${a.trace.reusedResultSet ? ` · reused “${_esc(a.trace.reusedResultSet)}”` : ''}</div>
        <details class="aiw-trace"><summary>Reasoning trace</summary>
          <div class="aiw-trace-rows">
            <div><span>Engine</span><b>${_esc(a.trace.engine)}</b></div>
            <div><span>Intent</span><b>${_esc(a.trace.intent)}</b></div>
            <div><span>Scope</span><b>${_esc(a.trace.property)}</b></div>
            <div><span>Sources consulted</span><b>${_esc(a.trace.sources.join('; ') || '—')}</b></div>
            <div><span>Citations attached</span><b>${a.trace.citationsUsed}</b></div>
            <div><span>Result set reused</span><b>${_esc(a.trace.reusedResultSet || '—')}</b></div>
            <div><span>Result set produced</span><b>${_esc(a.trace.resultSetProduced || '—')}</b></div>
          </div>
        </details>` : ''}
        <div class="aiw-next">What would you like to do next?</div>
        <div class="aiw-actions">${actions}</div>
      </div>`;
  }

  return { answer, buildSuggestions, renderAnswerHtml, registerIntent };
})();
