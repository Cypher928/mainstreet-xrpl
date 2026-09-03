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

  /**
   * SEC-6 — the only place an action verb becomes a call.
   *
   * Every verb is a fixed name in this table. A value that arrives in a data
   * attribute is passed as an ARGUMENT, never concatenated into source. There is
   * no default branch: an unrecognised verb does nothing rather than guessing.
   */
  const _AIW_ACTIONS = {
    openProperty:      (id)   => window.ccOpenProperty      && window.ccOpenProperty(id),
    openReserves:      (id)   => window.ccOpenReserves      && window.ccOpenReserves(id),
    showPortfolio:     ()     => window.ccShowPortfolio     && window.ccShowPortfolio(),
    showCommandCenter: ()     => window.showCommandCenter   && window.showCommandCenter(),
    openAcquisitions:  ()     => window.ccOpenAcquisitions  && window.ccOpenAcquisitions(),
    startTour:         ()     => window.startGuidedTour     && window.startGuidedTour(),
    ask:               (text) => window.aiwAsk              && window.aiwAsk(text),
    openDrafting:      (type, ctxJson) => {
      if (!window.openDraftingStudio) return;
      let ctx = null;
      // The context is JSON in a data attribute, parsed — not interpolated into
      // an object literal, which is what let a tenant id become code.
      if (ctxJson) { try { ctx = JSON.parse(ctxJson); } catch (_) { ctx = null; } }
      return ctx ? window.openDraftingStudio(type, ctx) : window.openDraftingStudio(type);
    },
    // SEC-6 — a URL from a settlement record is data. Only https may be opened;
    // a stored javascript: URL would otherwise execute in the app's origin.
    openUrl: (url) => {
      let u;
      try { u = new URL(String(url), window.location.origin); } catch (_) { return; }
      if (u.protocol !== 'https:') {
        console.warn('[aiw] refused to open a non-https URL:', u.protocol);
        return;
      }
      window.open(u.href, '_blank', 'noopener');
    },
    showEvidence: (_a, _b, btn) => {
      const c = btn && btn.closest('.aiw-answer') && btn.closest('.aiw-answer').querySelector('.aiw-cite--live');
      if (c) c.click();
    },
  };

  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest && e.target.closest('.aiw-action[data-aiw-act]');
    if (!btn) return;
    const fn = Object.prototype.hasOwnProperty.call(_AIW_ACTIONS, btn.dataset.aiwAct)
      ? _AIW_ACTIONS[btn.dataset.aiwAct] : null;
    if (!fn) { console.warn('[aiw] unknown action verb:', btn.dataset.aiwAct); return; }
    fn(btn.dataset.aiwArg, btn.dataset.aiwArg2, btn);
  });
  const _fmt$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const _num  = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  function _defaultDeps() {
    return {
      Selectors:         window.Selectors,
      EscrowEngine:      window.EscrowReserveEngine,
      AcquisitionEngine: window.AcquisitionEngine,
      ReconExplainer:    window.ReconciliationExplainer,
      computeRecovered:  window.computeRecoveredRevenue || null,
      // K — THE CANONICAL READ SOURCE. Every property-scoped fact an intent
      // needs now comes from here rather than from the blob, so the workspace
      // and the rest of the product cannot hold different opinions about the
      // same property. Injectable, so the rewiring is testable without a browser.
      PropertyRecord:    window.PropertyRecord || null,
      FieldProvenance:   window.FieldProvenance || null,
      now:               new Date(),
    };
  }

  /**
   * K — one assembly per answer, per property.
   *
   * PropertyRecord.assemble() is pure, so calling it twice is safe but wasteful;
   * more importantly, an intent that assembled its own copy could be handed a
   * different one than the intent beside it. A single memo per answer means every
   * section of an answer describes the same instant of the same property.
   *
   * Returns null when the record cannot be built at all — which is NOT the same
   * as a record whose sections are empty, and callers must not conflate them.
   */
  function _makeRecordFn(deps) {
    const memo = new Map();
    return function record(p) {
      if (!p || !deps || !deps.PropertyRecord) return null;
      const key = p.id != null ? p.id : p;
      if (memo.has(key)) return memo.get(key);
      let rec = null;
      try { rec = deps.PropertyRecord.assemble(p, deps.recordDeps || undefined); }
      catch (_e) { rec = null; }
      memo.set(key, rec);
      return rec;
    };
  }

  /**
   * K — did the record fail to compose this section?
   *
   * `meta.unavailable` names sections that could not be built. An intent that
   * treated that as an empty list would answer "no spaces", "no documents",
   * "nothing needs attention" about a property it simply could not read — the
   * exact false negative Phase G found knowledge_search making. Absence of
   * knowledge is reported as such.
   */
  function _unavailable(rec, section) {
    return !!(rec && rec.meta && Array.isArray(rec.meta.unavailable) &&
              rec.meta.unavailable.indexOf(section) !== -1);
  }

  /**
   * K — one shape for "the spaces of this property", record-first.
   *
   * Lease facts come from PropertyRecord.spaces[].lease, which TenantSpace owns,
   * so a cap quoted in an answer is the cap the Space view shows. The raw tenant
   * travels alongside because CITATIONS still need its fieldEvidence — the record
   * deliberately does not expose evidence blobs, and Phase I's citation rules read
   * them through the canonical resolver rather than the record.
   *
   * The legacy branch fires only when the record could not be built at all. It is
   * the previous behaviour, not a preferred alternative, and an intent that needs
   * to TELL the user something is missing should ask _unavailable() rather than
   * silently accepting this fallback.
   */
  function _spacesOf(rec, p) {
    const tenants = (p && p.tenants || []).filter(Boolean);
    if (rec && Array.isArray(rec.spaces)) {
      return rec.spaces.map(function (sp) {
        const t = tenants.find(function (x) { return x && x.id === sp.tenantId; }) || null;
        return { tenantId: sp.tenantId, name: sp.tenantName || (sp.space && sp.space.name) || null,
                 lease: sp.lease || null, camResult: sp.camResult || null,
                 space: sp.space || null, noIdentity: !!sp.noIdentity, tenant: t };
      });
    }
    return tenants.map(function (t) {
      return { tenantId: t.id, name: t.tenant_name || null,
               lease: { type: t.lease_type || null, sqft: t.leased_sqft || t.sqft || null,
                        start: t.start_date || null, end: t.end_date || null,
                        cap: (t.cap != null && t.cap !== '') ? t.cap : null },
               camResult: null, space: null, noIdentity: false, tenant: t };
    });
  }

  function _cannotRead(what, p) {
    return {
      heading: `I can't read ${what} right now`,
      paragraphs: [`MainStreet could not assemble the ${what} for ${p ? p.name : 'this property'}. ` +
        `That is not the same as there being none on file — I don't know either way, so I won't say.`],
      citations: [], actions: p ? [_actOpenProperty(p)] : [_actPortfolio()],
    };
  }

  const _recon = (p) => p.camReconciliation ?? p.results ?? null;
  const _reconBilled = (p) => (_recon(p)?.results || []).reduce((s, r) => s + (_num(r.totalAllocated) || _num(r.allocated)), 0);

  // ── evidence / citation helpers (reuse existing structures, no new index) ──

  /**
   * G1 — THE CANONICAL SNAPSHOT, NOT THE LAST ONE IN THE ARRAY.
   *
   * This read `snaps[snaps.length - 1]`: newest by array position. The provenance
   * model decides differently and for good reason — FieldProvenance.latestSnapshot
   * skips snapshots marked `superseded` and orders by `reviewedAt`, because a
   * field's provenance is a property of its CURRENT value, not of everything that
   * ever happened to it.
   *
   * Where those two disagree the workspace quoted the retired clause. Demonstrated:
   * a cap whose canonical snapshot reads "five percent (5%)" and whose superseded
   * one, sitting last in the array, reads "nine percent (9%)" — the AI cited the
   * nine. A citation naming a clause the lease no longer operates under is worse
   * than no citation, because it is checkable and wrong.
   *
   * One resolver now, shared with every other surface. The array-position read is
   * kept ONLY as the fallback for when FieldProvenance is not injected at all, so
   * a caller without it degrades to the previous behaviour rather than to nothing.
   */
  function _canonicalSnapshot(t, key, deps) {
    const FP = deps && deps.FieldProvenance;
    if (FP && typeof FP.latestSnapshot === 'function') {
      try { return FP.latestSnapshot(key, t) || null; } catch (_e) { /* fall through */ }
    }
    const snaps = t && t.fieldEvidence && t.fieldEvidence[key] && t.fieldEvidence[key].snapshots;
    return (Array.isArray(snaps) && snaps.length) ? snaps[snaps.length - 1] : null;
  }

  function _tenantEvidence(t, fieldKeys, deps) {
    for (const k of fieldKeys) {
      const last = _canonicalSnapshot(t, k, deps);
      if (last && (last.quote || last.page != null)) {
        return { quote: last.quote || null, page: last.page ?? null };
      }
    }
    return null;
  }

  /**
   * I — the clause a citation actually carries, or null.
   *
   * One reading of "has a quote", used by the renderer and by every intent that
   * describes its own evidence. A blank or whitespace-only string is not a
   * clause: `''`, `'   '` and `'\n'` all cite nothing, and a chip built on one
   * would make the same claim as a chip built on real lease text.
   */
  function _clauseQuote(c) {
    const q = c && c.quote;
    return (typeof q === 'string' && q.trim()) ? q.trim() : null;
  }

  /**
   * I — describe the evidence actually held, not the evidence hoped for.
   *
   * cam_caps reported `basis: 'extracted lease terms'` on citations whose quote
   * was null, so the sentence under the answer asserted a captured clause that
   * did not exist. The basis now follows the citations: it claims a term only
   * when one of them carries the clause.
   */
  function _clauseBasis(citations, whenCaptured) {
    return (citations || []).some(_clauseQuote)
      ? whenCaptured
      : 'lease source identified; clause not captured';
  }

  function _leaseCitation(p, t, fieldKeys, deps) {
    const ev = _tenantEvidence(t, fieldKeys || [], deps);
    return {
      source: `Lease — ${t.tenant_name}`,
      detail: ev && ev.page != null ? `Page ${ev.page}` : (p ? p.name : null),
      page:   ev && ev.page != null ? ev.page : null,
      quote:  ev ? ev.quote : null,
      // Interactive evidence (Phase 24): when the lease file itself is on file,
      // this citation becomes a one-click "open the document at this page".
      fileUrl:  t.leaseUrl || t.lease_url || null,
      fileName: t.leaseFileName || null,
    };
  }

  function _reserveCitations(r) {
    const cites = [];
    const ev = r.evidence || {};
    const best = ev.current_balance || ev.eligible_uses || ev.reserve_type;
    cites.push({
      source: `Mortgage — ${r.sourceFileName || 'reserve document'}`,
      detail: (r.sourcePages || []).length ? `Page ${r.sourcePages.join(', ')}` : null,
      page:   (best && best.page != null) ? best.page : ((r.sourcePages || [])[0] ?? null),
      quote:  best && best.quote ? best.quote : null,
      fileUrl:  r.sourceFileUrl || null,
      fileName: r.sourceFileName || null,
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

  const _actOpenProperty  = (p) => ({ label: `Open ${p.name}`, act: 'openProperty', arg: p.id });
  const _actReserves      = (p) => ({ label: 'Open Reserve Requests', act: 'openReserves', arg: p.id });
  const _actCommandCenter = () => ({ label: 'Open Command Center', act: 'showCommandCenter' });
  const _actPortfolio     = () => ({ label: 'View Portfolio', act: 'showPortfolio' });
  const _actAcquisitions  = () => ({ label: 'Open Acquisition Review', act: 'openAcquisitions' });

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
    intent_error: 'None (request failed)',
    // K, Tier 2 — retrieval over the canonical record.
    property_history: 'Property Record — Timeline', spaces_list: 'Property Record — Spaces',
    attention: 'Property Record — Attention', field_provenance: 'Property Record — Field Provenance',
    followup_filter: 'Workspace Context', followup_draft: 'Drafting Engine',
    followup_evidence: 'Lease Review Engine', followup_open: 'Workspace Context',
    followup_why: 'Reasoning Trace',
  };

  const INTENT_SOURCES = {
    cam_caps: ['PropertyRecord.spaces (lease terms)', 'lease fieldEvidence (canonical snapshot)'],
    audit_rights: ['PropertyRecord.spaces', 'lease fieldEvidence (canonical snapshot)'],
    expirations: ['PropertyRecord.spaces (lease end dates)'],
    tenant_charge: ['PropertyRecord.cam.results', 'lease terms', 'ReconciliationExplainer'],
    explain_recon: ['PropertyRecord.cam (pool, results, capped)'],
    disputes: ['PropertyRecord.disputes'],
    compare_costs: ['invoice records'],
    recovered_most: ['computeRecoveredRevenue'],
    reserve_balances: ['lender-stated balances', 'draw records'],
    reserve_rules: ['extracted reserve terms', 'reserve narrative'],
    draw_ready: ['draw validation checklist', 'escrow readiness'],
    acquisitions: ['acquisition analysis'],
    settlements: ['settlement records', 'reconciliation state'],
    forecast: ['reconciliation history (camRuns)'],
    knowledge_search: ['lease fieldEvidence (canonical snapshot)', 'excluded categories', 'reserve terms', 'dispute reasons'],
    draft_document: ['drafting engine (evidence-grounded)'],
    explain_property: ['PropertyRecord.identity', 'PropertyRecord.attention', 'portfolio KPIs'],
    intent_error:     [],
    property_history: ['PropertyRecord.timeline'],
    spaces_list:      ['PropertyRecord.spaces'],
    attention:        ['PropertyRecord.attention'],
    field_provenance: ['PropertyRecord.fields (FieldProvenance)'],
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
          act: 'openDrafting', arg: type,
          arg2: JSON.stringify({ propertyId: it.propertyId, tenantId: it.tenantId }),
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
        const ev = _tenantEvidence(t, ['cam_cap', 'cap', 'audit_rights', 'excluded_categories'], deps);
        if (ev && ev.quote) {
          rows.push(`${it.tenantName}: "${ev.quote}"${ev.page != null ? ` (p. ${ev.page})` : ''}`);
          citations.push({ source: `Lease — ${it.tenantName}`, detail: ev.page != null ? `Page ${ev.page}` : (p ? p.name : null), page: ev.page ?? null, quote: ev.quote, fileUrl: (t.leaseUrl || t.lease_url || null) });
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
        actions: chosen.slice(0, 3).map(([, type, label]) => ({ label: `Draft ${label}`, act: 'openDrafting', arg: type })),
        confidence: { pct: 95, basis: 'drafting engine (evidence-grounded)' },
      };
    },
  });

  // 1) CAM caps across the portfolio
  /**
   * L — one reading of "asking which leases DON'T have a cap".
   *
   * The matcher decides whether cam_caps answers at all; the handler decides
   * which direction to answer in. Sharing one predicate is what stops them from
   * disagreeing — a matcher that admits the question and a handler that answers
   * the opposite one is precisely the defect being fixed.
   */
  const _ASKS_NO_CAP = /\b(missing|without|no cap|don'?t have|do not have|lack|lacking|uncapped|not have)\b/;

  registerIntent({
    id: 'cam_caps',
    // L — the matcher required "cam cap", "expense cap" or the PLURAL "caps", so
    // "which tenants are missing a cap?" matched none of them and fell through to
    // knowledge_search, which answered about captured text instead. Widened by
    // exactly one case: a singular "cap" alongside a negative qualifier. Every
    // other phrasing routes as it did before.
    match: (s) => (/cam cap|expense cap|caps\b/.test(s)
                   || (/\bcaps?\b/.test(s) && _ASKS_NO_CAP.test(s)))
                  && !/reserve|readiness/.test(s),
    handle: (q, ctx, { props, deps, record }) => {
      const scoped = _scopedProps(ctx, props);
      // L — WHICH QUESTION WAS ACTUALLY ASKED.
      //
      // This intent answered one question however it was phrased. Asked "which
      // tenants are MISSING a cap?" it replied "4 leases carry a CAM cap" and
      // listed the four that have one — the precise inverse, delivered at 92%
      // confidence. The matcher is unchanged; what is new is that the handler
      // now reads whether the question was negative before choosing a heading.
      const asksMissing = _ASKS_NO_CAP.test(q.toLowerCase());

      const withCap = [], withoutCap = [], unknownCap = [];
      const citations = [], items = [], missingItems = [];
      for (const p of scoped) {
        // K — the lease terms come from the record's spaces, so the cap this
        // sentence reports and the cap the Space view shows are the same read.
        const rec = record ? record(p) : null;
        const fieldsUnavailable = _unavailable(rec, 'fields');
        for (const sp of _spacesOf(rec, p)) {
          const t = sp.tenant, name = sp.name, cap = sp.lease && sp.lease.cap;
          // THREE STATES, KEPT APART.
          //   has        — a cap value is on file
          //   none       — the record was read and carries no cap for this lease
          //   unreadable — the cap field could not be read at all
          // Collapsing the last two would turn "I don't know" into "there is no
          // cap", which is the same false certainty the inverse bug produced.
          const prov = (rec && rec.fields && rec.fields[sp.tenantId]) ? rec.fields[sp.tenantId].cap : null;
          const capKnown = !fieldsUnavailable && (prov || rec === null || !rec.fields);
          if (cap != null && cap !== '') {
            withCap.push(`${name} (${p.name}) — ${cap}% annual cap${t && t.capBaseAmount ? ` on a ${_fmt$(t.capBaseAmount)} base` : ''}`);
            citations.push(_leaseCitation(p, t, ['cam_cap', 'cap'], deps));
            items.push({ propertyId: p.id, propertyName: p.name, tenantId: sp.tenantId, tenantName: name });
          } else if (!capKnown) {
            unknownCap.push(`${name} (${p.name}) — cap information could not be read`);
          } else {
            const kind = /nnn|triple/i.test(String((sp.lease && sp.lease.type) || '')) ? 'NNN lease, ' : '';
            withoutCap.push(`${name} (${p.name}) — ${kind}no cap on file`);
            missingItems.push({ propertyId: p.id, propertyName: p.name, tenantId: sp.tenantId, tenantName: name });
          }
        }
      }
      // I — the basis names what these very citations hold. The cap PERCENTAGES
      // are genuinely extracted, so the confidence stands; what was not always
      // true is that a lease CLAUSE was captured behind them.
      const _cites4 = citations.slice(0, 4);
      const paragraphs = [];

      if (asksMissing) {
        if (withoutCap.length) {
          paragraphs.push(`${withoutCap.length} lease${withoutCap.length !== 1 ? 's carry' : ' carries'} no CAM cap on file.`);
          paragraphs.push(`Until a cap is confirmed, MainStreet can't verify these tenants aren't being overcharged.`);
        } else {
          paragraphs.push('Every lease in this scope has a cap on file.');
        }
        if (unknownCap.length) paragraphs.push(`${unknownCap.length} more could not be read, so I can't say either way about ${unknownCap.length !== 1 ? 'them' : 'it'}.`);
        if (withCap.length) paragraphs.push(`${withCap.length} lease${withCap.length !== 1 ? 's do' : ' does'} carry one — ask "which tenants have a CAM cap?" for those.`);
        return {
          heading: 'Leases with no CAM cap on file',
          paragraphs,
          bullets: [...withoutCap.map(w => `⚠ ${w}`), ...unknownCap.map(u => `? ${u}`)],
          // The citations that exist belong to the CAPPED leases, which this
          // answer is not about. Citing them here would attach evidence to the
          // opposite claim.
          citations: [],
          actions: scoped.slice(0, 2).map(_actOpenProperty),
          confidence: { pct: 92, basis: 'lease cap fields on file' },
          resultSet: missingItems.length ? { kind: 'tenants', label: 'Tenants with no CAM cap', items: missingItems } : null,
        };
      }

      const bullets = [...withCap, ...withoutCap.map(w => `⚠ ${w}`), ...unknownCap.map(u => `? ${u}`)];
      if (withCap.length) paragraphs.push(`${withCap.length} lease${withCap.length !== 1 ? 's carry' : ' carries'} a CAM cap.`);
      if (withoutCap.length) paragraphs.push(`Until a cap is confirmed, MainStreet can't verify the flagged tenants aren't being overcharged.`);
      if (unknownCap.length) paragraphs.push(`${unknownCap.length} lease${unknownCap.length !== 1 ? 's' : ''} could not be read for a cap — that is not the same as having none.`);
      if (!withCap.length && !withoutCap.length && !unknownCap.length) paragraphs.push('No CAM caps are on file for this scope — upload leases so cap terms can be extracted and enforced.');
      return {
        heading: 'CAM caps on file', paragraphs, bullets, citations: _cites4,
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 92, basis: _clauseBasis(_cites4, 'extracted lease terms') },
        resultSet: items.length ? { kind: 'tenants', label: 'Tenants with CAM caps', items } : null,
      };
    },
  });

  // 2) Audit rights
  registerIntent({
    id: 'audit_rights',
    match: (s) => /audit right/.test(s),
    handle: (q, ctx, { props, deps, record }) => {
      const scoped = _scopedProps(ctx, props);
      const rows = [], citations = [], items = [];
      for (const p of scoped) {
        // K — the roster comes from the record; audit_rights itself is not a
        // lease field the record carries, so it is still read from the tenant.
        const rec = record ? record(p) : null;
        for (const sp of _spacesOf(rec, p)) {
          const t = sp.tenant;
          if (t && t.audit_rights) {
            rows.push(`${sp.name} (${p.name}) — ${typeof t.audit_rights === 'string' ? t.audit_rights : 'audit rights on file'}`);
            citations.push(_leaseCitation(p, t, ['audit_rights'], deps));
            items.push({ propertyId: p.id, propertyName: p.name, tenantId: sp.tenantId, tenantName: sp.name });
          }
        }
      }
      return {
        resultSet: items.length ? { kind: 'tenants', label: 'Tenants with audit rights', items } : null,
        heading: 'Tenants with audit rights',
        bullets: rows,
        paragraphs: rows.length
          ? ['Allocations for these tenants should be airtight — they can demand your backup documentation.']
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
    match: (s) => (/expir/.test(s) && /lease|tenant|next year|this year|soon/.test(s)) || /renewal|renewals|rollover/.test(s),
    handle: (q, ctx, { props, deps, record }) => {
      const scoped = _scopedProps(ctx, props);
      const today = deps.now.toISOString().slice(0, 10);
      const yearMatch = q.match(/(20\d{2})/);
      const nextYear = /next year/.test(q.toLowerCase()) ? deps.now.getFullYear() + 1 : null;
      const targetYear = yearMatch ? Number(yearMatch[1]) : nextYear;
      const rows = [], items = [];
      for (const p of scoped) {
        // K — end dates and areas come from the record's lease facts.
        const rec = record ? record(p) : null;
        for (const sp of _spacesOf(rec, p)) {
          const end = sp.lease && sp.lease.end;
          if (!end) continue;
          const inYear = targetYear ? String(end).startsWith(String(targetYear)) : true;
          if (!inYear) continue;
          const expired = end < today;
          rows.push({ line: `${sp.name} (${p.name}) — ${expired ? 'EXPIRED ' : ''}${end} · ${Number((sp.lease && sp.lease.sqft) || 0).toLocaleString('en-US')} sf`, date: end });
          items.push({ propertyId: p.id, propertyName: p.name, tenantId: sp.tenantId, tenantName: sp.name });
        }
      }
      rows.sort((a, b) => a.date.localeCompare(b.date));
      return {
        resultSet: items.length ? { kind: 'tenants', label: targetYear ? `Leases expiring in ${targetYear}` : 'Lease expirations', items } : null,
        heading: targetYear ? `Leases expiring in ${targetYear}` : 'Lease expirations',
        bullets: rows.map(r => r.line),
        paragraphs: rows.length
          ? ['Expired or near-term leases weaken CAM enforcement — start renewals early to protect recovery terms.']
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
    handle: (q, ctx, { props, deps, record }) => {
      const hit = _findTenantByQuestion(q, props, ctx);
      if (!hit) return null;
      const { p, t } = hit;
      // K — JOIN ON IDENTITY, NOT ON A NAME.
      // This matched `r.tenantName === t.tenant_name`, so two tenants sharing a
      // name — a chain in two suites, or the very common "Vacant" — could be
      // handed each other's charge. The record carries tenantId on every row, so
      // the id is used where it exists and the name only as the last resort for
      // rows written before ids were stored.
      const rec = record ? record(p) : null;
      const _rows = (rec && rec.cam && Array.isArray(rec.cam.results)) ? rec.cam.results : (_recon(p)?.results || []);
      const result = (t.id != null && _rows.some(r => r && r.tenantId != null)
                        ? _rows.find(r => r && r.tenantId === t.id)
                        : null)
                    || _rows.find(r => r && r.tenantName === t.tenant_name);
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
        citations: [_leaseCitation(p, t, ['cam_cap', 'leased_sqft'], deps), _camReportCitation(p)].filter(c => c.detail || c.quote),
        actions: [_actOpenProperty(p)],
        confidence: { pct: result ? 93 : 85, basis: result ? 'reconciliation results & lease terms' : 'workflow state' },
      };
    },
  });

  // 5) Explain the reconciliation / how CAM was calculated
  registerIntent({
    id: 'explain_recon',
    match: (s) => /explain (this |the )?reconciliation|how was cam calculated|how is cam calculated|what are (the |my )?operating expenses/.test(s),
    handle: (q, ctx, { props, record }) => {
      const p = _ctxProperty(ctx, props);
      if (!p) return { heading: 'Which property?', paragraphs: ['Open a property (or ask about one by name) and I\'ll walk through its reconciliation.'], citations: [], actions: [_actPortfolio()], confidence: { pct: 95, basis: 'workflow state' } };
      // K — the pool, the rows and the unallocated remainder all come from the
      // record, so this narrative cannot disagree with the CAM tab about any of
      // the three. Nothing here recomputes a share, a ceiling or a variance.
      const rec = record ? record(p) : null;
      const recon = _recon(p);
      const results = (rec && rec.cam && Array.isArray(rec.cam.results)) ? rec.cam.results : (recon?.results || []);
      if (!results.length) {
        return { heading: `${p.name} — no reconciliation yet`, paragraphs: ['No completed reconciliation is on file. Load leases and invoices, then run the CAM allocation.'], citations: [], actions: [_actOpenProperty(p)], confidence: { pct: 95, basis: 'workflow state' } };
      }
      const total = (rec && rec.cam && rec.cam.pool != null) ? rec.cam.pool : _num(recon && recon.total);
      const billed = results.reduce((s, r) => s + (_num(r.totalAllocated) || _num(r.allocated) || _num(r.allocatedAmount)), 0);
      const capSaved = ((rec && rec.cam && rec.cam.capped) || results.filter(r => r.capApplied))
        .reduce((s, r) => s + _num(r.capAdjustment), 0);
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
    handle: (q, ctx, { props, record }) => {
      const scoped = _scopedProps(ctx, props);
      const open = [], resolved = [], citations = [];
      for (const p of scoped) {
        // K — dispute records come from the record. They are real stored records
        // either way; reading them here keeps one path to them.
        const rec = record ? record(p) : null;
        const list = (rec && Array.isArray(rec.disputes)) ? rec.disputes : (p.disputes || []).filter(Boolean);
        for (const d of list) {
          const line = `${d.tenantName || 'Tenant'} — ${d.vendor || d.category || 'charge'} ${_num(d.tenantShare ?? d.amount) ? '(' + _fmt$(d.tenantShare ?? d.amount) + ')' : ''} · ${d.status}`;
          (d.status === 'open' || d.status === 'docs_requested' ? open : resolved).push(line);
          citations.push({ source: 'Dispute Record', detail: `${d.tenantName || ''} · ${p.name}`, quote: d.reason ? String(d.reason).slice(0, 140) : null });
        }
      }
      const paragraphs = [];
      if (open.length) paragraphs.push(`${open.length} dispute${open.length !== 1 ? 's need' : ' needs'} a decision — each holds its charge in limbo until you respond.`);
      else paragraphs.push('No disputes are awaiting a decision.');
      if (resolved.length) paragraphs.push(`Resolved history: ${resolved.join('; ')}.`);
      return {
        heading: 'Dispute status', paragraphs, bullets: open, citations: citations.slice(0, 4),
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 95, basis: 'dispute records' },
      };
    },
  });

  // 7) Compare costs by category
  registerIntent({
    id: 'compare_costs',
    match: (s) => /compare .*(cost|expense)|insurance costs|insurance allocation|cost of (insurance|janitorial|utilities)/.test(s),
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
        bullets: rows.map(r => `${r.name}: ${_fmt$(r.sum)}${r.sqft ? ` (${(r.sum / r.sqft).toFixed(2)}/sf)` : ''}`),
        paragraphs: rows.length
          ? [rows.length > 1 ? 'Per-square-foot cost is the comparable number — a high outlier is a re-bid candidate.' : 'Add more properties to compare across the portfolio.']
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
    match: (s) => /reserve balance|show reserves|reserve accounts?|(roof|hvac|capital|tenant.improvement) reserve|capital expenditures?/.test(s),
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
        bullets: rows,
        paragraphs: rows.length ? [] : ['No reserve accounts are on file — upload the mortgage or escrow agreement and MainStreet will extract them.'],
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
          actions.push(rd.ready ? { label: 'Generate Lender Package', act: 'openReserves', arg: p.id } : { label: 'Complete Draw Request', act: 'openReserves', arg: p.id });
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
          if (s.explorerLink) actions.push({ label: 'View Transaction on XRPL', act: 'openUrl', arg: s.explorerLink });
        } else if (billed > 0) {
          ready.push(`${p.name} — ${_fmt$(billed)} reconciled and billable in RLUSD`);
          actions.push({ label: `Review ${p.name} Settlement`, act: 'openProperty', arg: p.id });
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
    handle: (q, ctx, { props, deps, record }) => {
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
      // K — OCCUPANCY IS THE RECORD'S, NOT A LOCAL SUM.
      // This computed its own leased/total ratio, which is one of the three
      // disagreeing definitions Phase J refused to make canonical. The record
      // exposes PropertyReference.occupancyPct — the single named occupancy rule
      // — and returns null when the property has no total area, which this now
      // reports as "occupancy not on file" instead of inventing a percentage.
      const rec = record ? record(p) : null;
      const occ = (rec && rec.identity && rec.identity.occupancy != null)
        ? rec.identity.occupancy : null;
      const tenantCount = (rec && Array.isArray(rec.spaces)) ? rec.spaces.length : (p.tenants || []).length;
      // Attention was invisible to the AI entirely (Phase G). It is a ranked list
      // the product already computes; the summary now names its top item.
      const attn = (rec && Array.isArray(rec.attention)) ? rec.attention : null;
      return {
        heading: `${p.name} at a glance`,
        paragraphs: [
          `${tenantCount} tenants${occ != null ? `, ${occ}% occupied` : ', occupancy not on file'}${meta.total ? `, ${_fmt$(meta.total)} in ${meta.camYear || 'current'} CAM expenses` : ''}${meta.openDisputes ? `, ${meta.openDisputes} open dispute${meta.openDisputes !== 1 ? 's' : ''}` : ''}. Risk level: ${meta.riskLevel || 'not assessed'}.`,
          ...(attn && attn.length ? [`Top of the list right now: ${attn[0].title}.`] : []),
          'Ask me anything specific — a tenant\'s charge, a lease clause, reserve rules, or settlement status.',
        ],
        citations: [_camReportCitation(p)],
        actions: [_actOpenProperty(p), _actCommandCenter()],
        confidence: { pct: 94, basis: 'property records' },
      };
    },
  });

  // 15b) Outstanding / due balances — honest mapping (Phase 25): MainStreet
  // computes reconciled BILLINGS; payment status lives in the user's accounting
  // system. The answer says exactly that instead of pretending to be an A/R ledger.
  registerIntent({
    id: 'balances',
    match: (s) => /outstanding|balance due|balances? due|unpaid|remaining balance|amount due|past due|owes? the most|who owes/.test(s),
    handle: (q, ctx, { props, record }) => {
      const scoped = _scopedProps(ctx, props);
      const rows = [], items = [];
      for (const p of scoped) {
        // K — billed amounts come from the record's reconciliation rows, and the
        // tenant id off the row itself where it has one rather than by matching
        // the printed name back to a tenant.
        const rec = record ? record(p) : null;
        const recon = _recon(p);
        const camYear = (rec && rec.identity && rec.identity.camYear != null)
          ? rec.identity.camYear : (recon && recon.camYear) || '';
        const _rows = (rec && rec.cam && Array.isArray(rec.cam.results)) ? rec.cam.results : (recon?.results || []);
        for (const r of _rows) {
          const billed = _num(r.totalAllocated) || _num(r.allocated) || _num(r.allocatedAmount);
          if (!(billed > 0)) continue;
          rows.push({ billed, line: `${r.tenantName} (${p.name}) — ${_fmt$(billed)} reconciled ${camYear} CAM share` });
          const t = (p.tenants || []).find(x => x && x.tenant_name === r.tenantName);
          items.push({ propertyId: p.id, propertyName: p.name,
                       tenantId: r.tenantId != null ? r.tenantId : (t ? t.id : null),
                       tenantName: r.tenantName });
        }
      }
      rows.sort((a, b) => b.billed - a.billed);
      return {
        heading: 'Reconciled CAM billings by tenant',
        bullets: rows.map(r => r.line),
        paragraphs: rows.length
          ? ['These are the reconciled amounts billed to each tenant. MainStreet computes and documents the billings — actual payment status lives in your accounting system, so "paid vs. outstanding" should be confirmed there.']
          : ['No completed reconciliation on file yet — run the CAM allocation to compute each tenant\'s share.'],
        citations: scoped.filter(p => (_recon(p)?.results || []).length).slice(0, 2).map(_camReportCitation),
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 93, basis: 'reconciliation results (billings, not payment status)' },
        resultSet: items.length ? { kind: 'tenants', label: 'Tenants with reconciled billings', items } : null,
      };
    },
  });

  // 15c) Rent roll / tenant roster — a clean view of existing lease data.
  registerIntent({
    id: 'rent_roll',
    match: (s) => /rent roll|tenant (list|roster)|list (of )?(my )?tenants|show (me )?(my |the )?tenants/.test(s),
    handle: (q, ctx, { props, deps, record }) => {
      const scoped = _scopedProps(ctx, props);
      const today = deps.now.toISOString().slice(0, 10);
      const bullets = [], items = [];
      for (const p of scoped) {
        // K — the roll is the record's spaces, so it agrees with the Spaces view.
        const rec = record ? record(p) : null;
        for (const sp of _spacesOf(rec, p)) {
          const L = sp.lease || {};
          const expired = L.end && L.end < today;
          bullets.push(`${sp.name} (${p.name}) — ${Number(L.sqft || 0).toLocaleString('en-US')} sf · ${L.type || 'lease type n/a'} · ${L.cap != null && L.cap !== '' ? L.cap + '% cap' : 'no cap'} · ${expired ? '⚠ expired ' : 'expires '}${L.end || 'n/a'}`);
          items.push({ propertyId: p.id, propertyName: p.name, tenantId: sp.tenantId, tenantName: sp.name });
        }
      }
      return {
        heading: `Rent roll — ${bullets.length} tenant${bullets.length !== 1 ? 's' : ''}`,
        bullets,
        paragraphs: bullets.length ? [] : ['No tenants on file yet — upload leases or add tenants to build the rent roll.'],
        citations: [],
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 95, basis: 'lease records on file' },
        resultSet: items.length ? { kind: 'tenants', label: 'Rent roll', items } : null,
      };
    },
  });

  // 15d) Navigation awareness (Phase 25) — "where do I find …?" gets a real
  // answer and a button that goes there, never the fallback.
  const NAV_MAP = [
    { re: /command center|daily briefing|dashboard|priorities/, label: 'AI Command Center', how: 'Your daily briefing — ranked priorities, portfolio health, and settlement status.', act: () => ({ act: 'showCommandCenter' }) },
    { re: /reserve|escrow|draw request|reimburse/, label: 'Reserves tab', how: "Open a property and use the Reserves tab — 'Reserve & Loan Documents' holds the mortgage extraction; 'Reserve Requests' is where reimbursements start.", act: (p) => p ? { act: 'openReserves', arg: p.id } : { act: 'showPortfolio' } },
    { re: /reconcil|cam charges|allocation/, label: 'CAM tab', how: 'Open a property and use the CAM tab to run and review reconciliations.', act: (p) => p ? { act: 'openProperty', arg: p.id } : { act: 'showPortfolio' } },
    { re: /report|statement|export|lender summary|master report/, label: 'Reports tab', how: 'Open a property and use the Reports tab — landlord, tenant, and lender reports plus CSV exports.', act: (p) => p ? { act: 'openProperty', arg: p.id } : { act: 'showPortfolio' } },
    { re: /dispute/, label: 'CAM tab → Disputes', how: 'Disputes live with the reconciliation — open the property and review them from the CAM workflow.', act: (p) => p ? { act: 'openProperty', arg: p.id } : { act: 'showPortfolio' } },
    { re: /settle|rlusd|xrpl|transaction/, label: 'Property overview / Command Center', how: 'Settlement status shows on the property overview and in the Command Center — settled payments link straight to the XRPL explorer.', act: () => ({ act: 'showCommandCenter' }) },
    { re: /draft|letter|document studio/, label: 'Drafting Studio', how: 'Ask me to generate any letter or package — the Drafting Studio opens with an editable, evidence-grounded draft.', act: () => null },
    { re: /tour|walkthrough|guide/, label: 'Guided Tour', how: 'A two-minute walkthrough of the whole platform.', act: () => ({ act: 'startTour' }) },
    { re: /upload|lease file|mortgage document|invoice file/, label: 'Property workspace', how: 'Open a property — leases upload in the Leases step, invoices in the Invoices step, and mortgage documents under Reserves.', act: (p) => p ? { act: 'openProperty', arg: p.id } : { act: 'showPortfolio' } },
  ];
  registerIntent({
    id: 'navigation',
    match: (s) => /(where (is|are|do i|can i)|how do i (find|open|get to|see|start|run)|where do i)/.test(s) && NAV_MAP.some(n => n.re.test(s)),
    handle: (q, ctx, { props, deps }) => {
      const s = q.toLowerCase();
      const hit = NAV_MAP.find(n => n.re.test(s));
      if (!hit) return null;
      const p = _ctxProperty(ctx, props) || props[0] || null;
      const nav = hit.act(p);
      return {
        heading: `That's in the ${hit.label}`,
        paragraphs: [hit.how],
        citations: [],
        actions: nav
          ? [{ label: `Take me there`, ...nav }]
          : [{ label: 'Generate a document', act: 'ask', arg: 'Generate a recovery letter' }],
        confidence: { pct: 98, basis: 'application navigation' },
      };
    },
  });

  // Shared evidence scanner — the ONE search over extracted terms, evidence
  // quotes, reserve terms, and dispute records. Used by knowledge_search and
  // lease_terms; never duplicated.
  function _scanEvidence(scoped, terms, deps) {
    const hits = [];
    if (!terms.length) return hits;
    for (const p of scoped) {
      for (const t of (p.tenants || []).filter(Boolean)) {
        const excl = String(t.excluded_categories || '').toLowerCase();
        if (terms.some(w => excl.includes(w))) hits.push({ text: `${t.tenant_name} (${p.name}) — lease excludes: ${t.excluded_categories}`, cite: _leaseCitation(p, t, ['excluded_categories'], deps) });
        for (const k of Object.keys(t.fieldEvidence || {})) {
          // G1 — the CANONICAL snapshot, not the last one in the array. Searching
          // a superseded clause would surface text the lease no longer operates
          // under, and hand it to the reader as a find. Wording and matching are
          // untouched here; only WHICH snapshot is read has changed.
          const last = _canonicalSnapshot(t, k, deps);
          if (last && last.quote && terms.some(w => String(last.quote).toLowerCase().includes(w))) {
            hits.push({ text: `${t.tenant_name} (${p.name}) — lease ${k.replace(/_/g, ' ')}: "${String(last.quote).slice(0, 120)}"`, cite: { source: `Lease — ${t.tenant_name}`, detail: last.page != null ? `Page ${last.page}` : null, page: last.page ?? null, quote: last.quote, fileUrl: t.leaseUrl || t.lease_url || null } });
          }
        }
      }
      for (const r of (p.escrowReserves || []).filter(Boolean)) {
        const hay = [r.eligibleUses, r.notes, r.reserveTypeLabel].filter(Boolean).join(' ').toLowerCase();
        if (terms.some(w => hay.includes(w))) hits.push({ text: `${r.reserveTypeLabel} (${p.name}) — ${r.eligibleUses || r.notes || 'terms on file'}`, cite: _reserveCitations(r)[0] });
      }
      for (const d of (p.disputes || []).filter(Boolean)) {
        if (d.reason && terms.some(w => String(d.reason).toLowerCase().includes(w))) hits.push({ text: `Dispute — ${d.tenantName || ''} (${p.name}): ${String(d.reason).slice(0, 120)}`, cite: { source: 'Dispute Record', detail: p.name, quote: null } });
      }
    }
    return hits;
  }

  // 15e) Commercial-lease vocabulary (Phase 27) — base year, tax stop, CPI,
  // TI allowance, estoppel, SNDA, and friends. Searches the SAME extracted
  // evidence; where MainStreet doesn't track a concept as a field, the answer
  // says so plainly instead of guessing.
  const _LEASE_TERMS = [
    { re: /base year/,                 term: 'base year' },
    { re: /tax stop|expense stop/,     term: 'tax stop' },
    { re: /cpi|consumer price|escalation/, term: 'escalation' },
    { re: /tenant improvement|ti allowance/, term: 'tenant improvement', reserveType: 'tenant_improvement' },
    { re: /estoppel/,                  term: 'estoppel', notTracked: 'Estoppel certificates aren\'t a tracked field in MainStreet yet' },
    { re: /snda|subordination|non.?disturbance/, term: 'subordination', notTracked: 'SNDA agreements aren\'t a tracked field in MainStreet yet' },
    { re: /landlord responsib/,        term: 'landlord' },
    { re: /base rent/,                 term: 'base rent' },
  ];
  registerIntent({
    id: 'lease_terms',
    match: (s) => _LEASE_TERMS.some(x => x.re.test(s)),
    handle: (q, ctx, { props }) => {
      const s = q.toLowerCase();
      const def = _LEASE_TERMS.find(x => x.re.test(s));
      if (!def) return null;
      const scoped = _scopedProps(ctx, props);
      const hits = _scanEvidence(scoped, def.term.split(/\s+/));
      const paragraphs = [];
      // TI allowance can also live as a lender reserve — check that too.
      if (def.reserveType) {
        for (const p of scoped) {
          for (const r of (p.escrowReserves || []).filter(x => x && x.reserveType === def.reserveType)) {
            paragraphs.push(`${p.name} also has a ${r.reserveTypeLabel} with the lender${r.currentBalance != null ? ` (${_fmt$(r.currentBalance)} stated balance)` : ''}.`);
          }
        }
      }
      if (def.notTracked) paragraphs.push(`${def.notTracked} — what follows is anything the extracted lease language mentions about it.`);
      if (!hits.length) {
        paragraphs.push(`Nothing about "${def.term}" appears in the extracted lease terms on file. If a lease covers it, reprocess the document — or the clause may simply not exist in these leases. I won't guess either way.`);
      }
      return {
        heading: `"${def.term}" in your documents`,
        bullets: hits.slice(0, 6).map(h => h.text),
        paragraphs,
        citations: hits.slice(0, 4).map(h => h.cite).filter(Boolean),
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: hits.length ? 88 : 92, basis: hits.length ? 'extracted evidence (quotes & citations)' : 'extracted terms on file (nothing found — stated honestly)' },
      };
    },
  });

  // 16) Generic knowledge search across extracted evidence (last resort before fallback)
  registerIntent({
    id: 'knowledge_search',
    match: (s) => /where does|which (lease|tenant)|find |search |show .*(clause|exclusion)|who pays|clause/.test(s),
    handle: (q, ctx, { props, deps, record }) => {
      const scoped = _scopedProps(ctx, props);
      const terms = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length > 3 && !['does', 'which', 'where', 'show', 'find', 'search', 'every', 'lease', 'leases', 'tenant', 'tenants', 'discuss', 'clause', 'clauses', 'document', 'documents', 'pays'].includes(w));
      const hits = _scanEvidence(scoped, terms, deps);
      if (!hits.length) {
        // ── L — "NOTHING ON FILE" WAS A CLAIM THIS SEARCH COULD NOT MAKE ─────
        //
        // A miss returned "I searched … and found nothing on file", which reads
        // as a statement about the building. It is a statement about the text
        // MainStreet happens to have captured. Phase G caught it saying exactly
        // that about a property holding two open disputes — the same records the
        // dispute intent lists on request.
        //
        // The four cases are now kept apart:
        //   A  nothing captured at all — the honest empty case
        //   B  fields are on file but their clauses were never captured, so the
        //      words could not be there to find
        //   C  the words are absent from captured text, but related records
        //      (disputes) exist and can be asked for directly
        //   D  the record could not be read, so nothing may be concluded
        //
        // Wording of the HIT path and the matcher are untouched.
        let fieldsTotal = 0, fieldsUncited = 0, disputesN = 0, unreadable = 0;
        for (const p of scoped) {
          const rec = record ? record(p) : null;
          if (!rec || _unavailable(rec, 'fields')) { unreadable++; continue; }
          for (const byField of Object.values(rec.fields || {})) {
            for (const prov of Object.values(byField || {})) {
              if (!prov || prov.state === 'unknown') continue;
              fieldsTotal++;
              if (!prov.quote) fieldsUncited++;
            }
          }
          disputesN += (rec.disputes || []).length;
        }
        const searched = terms.length ? ` for "${terms.join(' ')}"` : '';
        const paragraphs = [];
        if (unreadable) {
          paragraphs.push(`I could not read the records for ${unreadable} propert${unreadable !== 1 ? 'ies' : 'y'} in this scope, so I can't tell you whether they mention it.`);
        }
        if (fieldsTotal || disputesN) {
          paragraphs.push(`Nothing in the text I have captured matches${searched}.`);
          if (fieldsUncited) {
            paragraphs.push(`That is a limit of what was captured, not a finding about your lease: ${fieldsUncited} of the ${fieldsTotal} lease field${fieldsTotal !== 1 ? 's' : ''} on file ${fieldsUncited !== 1 ? 'have' : 'has'} a value but no clause text behind ${fieldsUncited !== 1 ? 'them' : 'it'}, so the wording simply isn't here to search.`);
          } else if (fieldsTotal) {
            paragraphs.push(`${fieldsTotal} lease field${fieldsTotal !== 1 ? 's are' : ' is'} on file with captured text, and none of ${fieldsTotal !== 1 ? 'them' : 'it'} contains those words.`);
          }
          if (disputesN) paragraphs.push(`There ${disputesN !== 1 ? 'are' : 'is'} ${disputesN} dispute record${disputesN !== 1 ? 's' : ''} on file here — ask about disputes and I'll show ${disputesN !== 1 ? 'them' : 'it'}.`);
          paragraphs.push('If the source document does mention it, reprocess it with AI so the clause gets extracted.');
        } else if (!unreadable) {
          paragraphs.push(`No lease clauses, reserve terms or dispute records are captured for this scope at all, so there is nothing${searched} to search yet. Upload and process the documents and I'll be able to answer.`);
        }
        return {
          heading: unreadable && !fieldsTotal && !disputesN
            ? 'I couldn\'t read those records'
            : 'No match in the text I have captured',
          paragraphs,
          citations: [], actions: scoped.slice(0, 1).map(_actOpenProperty),
          confidence: { pct: 85, basis: 'captured evidence text only' },
        };
      }
      return {
        heading: `Found ${hits.length} match${hits.length !== 1 ? 'es' : ''} in your documents`,
        bullets: hits.slice(0, 5).map(h => h.text),
        paragraphs: [],
        citations: hits.slice(0, 4).map(h => h.cite).filter(Boolean),
        actions: scoped.slice(0, 2).map(_actOpenProperty),
        confidence: { pct: 88, basis: 'extracted evidence (quotes & citations)' },
      };
    },
  });

  // ── K, Tier 2 — four retrieval intents over the canonical record ───────────
  //
  // The Phase G battery asked what happened at a property, which spaces it has,
  // what needs attention and where a lease term came from. All four fell to the
  // honest fallback — not because the data was missing, but because nothing read
  // it: Timeline, Spaces, attention and provenance were invisible to the AI while
  // the product computed all four. These intents retrieve. They compute nothing,
  // call no model, and add no business rule; each hands back one section of
  // PropertyRecord in the shape this workspace already renders.
  //
  // Each also distinguishes "there are none" from "I could not read it" via
  // meta.unavailable, because a read model that fails silently is worse than one
  // that fails loudly.

  // 20) Property history / timeline.
  registerIntent({
    id: 'property_history',
    match: (s) => /what happened|property history|history of|recent activity|activity log|timeline/.test(s),
    handle: (q, ctx, { props, record }) => {
      const p = _ctxProperty(ctx, props);
      if (!p) return { heading: 'Which property?', paragraphs: ['Open a property and I\'ll show its recorded history.'],
                       citations: [], actions: [_actPortfolio()], confidence: { pct: 95, basis: 'workflow state' } };
      const rec = record ? record(p) : null;
      if (!rec) return _cannotRead('history', p);
      if (_unavailable(rec, 'timeline.scoping')) return _cannotRead('history', p);

      // A named tenant narrows to that space's events; otherwise property-level.
      const hit = _findTenantByQuestion(q, [p], ctx);
      const tenantScoped = !!(hit && hit.t && hit.t.id != null);
      const events = tenantScoped
        ? ((rec.timeline.byTenant || {})[hit.t.id] || [])
        : (rec.timeline.property || []);
      const who = tenantScoped ? hit.t.tenant_name : p.name;

      if (!events.length) {
        return {
          heading: `${who} — nothing recorded yet`,
          paragraphs: [tenantScoped
            ? `No events are recorded against ${who}. Property-level activity is kept separately — ask about ${p.name} to see it.`
            : `No property-level events are recorded for ${p.name} yet.`],
          citations: [], actions: [_actOpenProperty(p)],
          confidence: { pct: 95, basis: 'property timeline' },
        };
      }
      const sorted = events.slice().sort((a, b) =>
        String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      return {
        heading: `${who} — recorded history`,
        paragraphs: [`${events.length} event${events.length !== 1 ? 's' : ''} on file` +
          (tenantScoped ? ', scoped to this tenant.' : ', at property level.')],
        bullets: sorted.slice(0, 8).map(e =>
          `${String(e.timestamp || '').slice(0, 10)} — ${e.title || e.type}${e.description ? ' · ' + e.description : ''}`),
        citations: [], actions: [_actOpenProperty(p)],
        confidence: { pct: 95, basis: 'property timeline' },
      };
    },
  });

  // 21) Spaces / tenants.
  registerIntent({
    id: 'spaces_list',
    match: (s) => /what spaces|which spaces|space list|who occupies|occupied space|vacant space|spaces (does|are)/.test(s),
    handle: (q, ctx, { props, record }) => {
      const p = _ctxProperty(ctx, props);
      if (!p) return { heading: 'Which property?', paragraphs: ['Open a property and I\'ll list its spaces.'],
                       citations: [], actions: [_actPortfolio()], confidence: { pct: 95, basis: 'workflow state' } };
      const rec = record ? record(p) : null;
      if (!rec || rec.spaces === null || _unavailable(rec, 'spaces')) return _cannotRead('spaces', p);

      const rows = rec.spaces.map(sp => {
        const L = sp.lease || {};
        const name = sp.tenantName || (sp.space && sp.space.name) || 'Unnamed space';
        return `${name} — ${L.sqft ? Number(L.sqft).toLocaleString('en-US') + ' sf' : 'area not on file'}` +
               `${L.type ? ' · ' + L.type : ''}${L.end ? ' · through ' + L.end : ''}`;
      });
      // Vacancy is NOT invented here. MainStreet records a space through its
      // tenant, so it has no representation for an empty one; saying "none are
      // vacant" would be a claim the data cannot support.
      const asksVacancy = /vacant/.test(q.toLowerCase());
      const paragraphs = [`${rec.spaces.length} space${rec.spaces.length !== 1 ? 's' : ''} on file at ${p.name}, each identified by its tenant.`];
      if (asksVacancy) paragraphs.push('MainStreet records a space through the tenant occupying it, so it holds no representation of a vacant one. I can only list what is occupied — an empty suite would simply be absent from this list rather than marked vacant.');
      return {
        heading: `${p.name} — spaces`, paragraphs, bullets: rows,
        citations: [], actions: [_actOpenProperty(p)],
        resultSet: rec.spaces.length
          ? { kind: 'tenants', label: 'Spaces', items: rec.spaces.map(sp => ({
              propertyId: p.id, propertyName: p.name, tenantId: sp.tenantId, tenantName: sp.tenantName })) }
          : null,
        confidence: { pct: 95, basis: 'space records' },
      };
    },
  });

  // 22) What needs attention.
  registerIntent({
    id: 'attention',
    match: (s) => /needs? (my |your )?attention|need attention|what should i (look at|do)|attention items?|what.s wrong|priorit(y|ies) (here|for this)/.test(s),
    handle: (q, ctx, { props, record }) => {
      const p = _ctxProperty(ctx, props);
      if (!p) return { heading: 'Which property?', paragraphs: ['Open a property and I\'ll show what needs attention there. For the whole portfolio, the Command Center ranks it.'],
                       citations: [], actions: [_actCommandCenter(), _actPortfolio()], confidence: { pct: 95, basis: 'workflow state' } };
      const rec = record ? record(p) : null;
      if (!rec || rec.attention === null || _unavailable(rec, 'attention')) return _cannotRead('attention list', p);
      if (!rec.attention.length) {
        return { heading: `${p.name} — nothing needs action`, paragraphs: ['No attention items are outstanding on this property.'],
                 citations: [], actions: [_actOpenProperty(p)], confidence: { pct: 95, basis: 'property readiness' } };
      }
      return {
        heading: `${p.name} — ${rec.attention.length} item${rec.attention.length !== 1 ? 's' : ''} need${rec.attention.length === 1 ? 's' : ''} attention`,
        paragraphs: ['Ranked by severity, from the same list the property workspace shows.'],
        bullets: rec.attention.map(a => `${a.title}${a.why ? ' — ' + a.why : ''}`),
        citations: [], actions: [_actOpenProperty(p)],
        confidence: { pct: 95, basis: 'property readiness' },
      };
    },
  });

  // 23) Where a lease term came from.
  registerIntent({
    id: 'field_provenance',
    match: (s) => /where did .*(come from|it come)|source of (this |the )?(field|term|value|number)|how do you know|provenance|lease.?confirmed|ai.?extracted|is that verified|who confirmed/.test(s),
    handle: (q, ctx, { props, record }) => {
      const p = _ctxProperty(ctx, props);
      if (!p) return { heading: 'Which property?', paragraphs: ['Open a property and name a tenant, and I\'ll show where each lease term came from.'],
                       citations: [], actions: [_actPortfolio()], confidence: { pct: 95, basis: 'workflow state' } };
      const rec = record ? record(p) : null;
      if (!rec || _unavailable(rec, 'fields')) return _cannotRead('field provenance', p);

      const hit = _findTenantByQuestion(q, [p], ctx);
      const t = hit && hit.t;
      const ids = t && t.id != null ? [t.id] : Object.keys(rec.fields || {});
      if (!ids.length) {
        return { heading: `${p.name} — no field provenance on file`,
                 paragraphs: ['No lease fields have provenance recorded for this property yet.'],
                 citations: [], actions: [_actOpenProperty(p)], confidence: { pct: 90, basis: 'field provenance' } };
      }
      const bullets = [], citations = [];
      for (const id of ids.slice(0, 3)) {
        const byField = (rec.fields || {})[id] || {};
        const name = (rec.spaces || []).find(sp => sp.tenantId === id);
        const who = (name && name.tenantName) || id;
        for (const [key, prov] of Object.entries(byField)) {
          if (!prov || prov.state === 'unknown') continue;
          bullets.push(`${who} · ${key.replace(/_/g, ' ')} — ${prov.label}`);
          // Phase I governs the chip: a clause travels only when one was captured.
          // A provenance answer never manufactures one to look better cited.
          citations.push({ source: `Lease — ${who}`, detail: prov.page != null ? `Page ${prov.page}` : p.name,
                           page: prov.page != null ? prov.page : null, quote: prov.quote || null,
                           fileUrl: prov.sourceFile || null });
        }
      }
      if (!bullets.length) {
        return { heading: `${t ? t.tenant_name : p.name} — nothing recorded`,
                 paragraphs: ['Every canonical lease field for this scope is still unknown — no value, so no source to report.'],
                 citations: [], actions: [_actOpenProperty(p)], confidence: { pct: 90, basis: 'field provenance' } };
      }
      const _c = citations.slice(0, 4);
      return {
        heading: `${t ? t.tenant_name : p.name} — where each term came from`,
        paragraphs: ['Each line states how MainStreet knows that value: a lease clause, a person, or an unverified extraction.'],
        bullets: bullets.slice(0, 12), citations: _c,
        actions: [_actOpenProperty(p)],
        confidence: { pct: 92, basis: _clauseBasis(_c, 'lease fieldEvidence (verbatim quotes)') },
      };
    },
  });

  // Fallback — honest capability statement, never an invention.
  const FALLBACK = {
    id: 'fallback',
    handle: (q, ctx, { props }) => ({
      heading: 'I answer from your portfolio, not from the internet',
      paragraphs: [
        "I couldn't map that question to your data, so rather than guess, here's what I can answer:",
      ],
      bullets: [
        'Explain reconciliations and any tenant\'s charges',
        'Search extracted lease and mortgage terms — with citations',
        'Check reserve balances, eligibility, and reimbursement readiness',
        'Review disputes, compare costs, and show the rent roll',
        'Show RLUSD settlement status, and draft letters and lender packages',
      ],
      citations: [], actions: [_actCommandCenter(), _actPortfolio()],
      // I — NO CONFIDENCE ON A NON-ANSWER. This carried
      // `{ pct: 100, basis: 'honest fallback' }`, which the renderer printed as
      // "Confidence 100% · honest fallback" directly beneath "I couldn't map that
      // question to your data". Twenty-one of the thirty-five questions in the
      // Phase G battery ended here, each wearing a full-confidence badge over an
      // admission that nothing had been answered. The fallback is still honest
      // about what it can do; it no longer scores itself for failing.
      showSuggestions: true,
    }),
  };

  /**
   * L — a handler fault, made observable without being made public.
   *
   * Two audiences, two channels. A developer needs the intent, the message and
   * the stack, and gets them on the console and on `AIWorkspace.lastFailure`,
   * which a test can read. A property manager needs to know the request failed
   * and gets exactly that — no message, no stack, nothing that would invite them
   * to debug the product instead of running their building.
   */
  var _lastFailure = null;
  function _noteFailure(where, err) {
    const f = { intent: where, message: (err && err.message) || String(err),
                stack: (err && err.stack) || null, at: new Date().toISOString() };
    _lastFailure = f;
    try { console.error('[AIWorkspace] intent "' + where + '" threw:', err); } catch (_e) {}
    return f;
  }

  function _failureAnswer(f) {
    return {
      heading: 'I couldn\'t complete that request',
      paragraphs: [
        'Something went wrong on my side while answering this one. That is a fault in MainStreet, not a statement about your property — it does not mean there is no record of what you asked about.',
        'Try again, or open the property directly and I\'ll pick it up from there.',
      ],
      // No citations and NO CONFIDENCE. A failure that scored itself would be
      // the Phase I defect wearing a different hat.
      citations: [], actions: [_actCommandCenter(), _actPortfolio()],
      // Not rendered — carried so a test can assert the failure was real and a
      // developer can see which intent produced it.
      _failure: { intent: f.intent, message: f.message },
    };
  }

  // ── public API ─────────────────────────────────────────────────────────────

  function answer({ question, context, wctx, props, acqReviews, deps } = {}) {
    const d = { ..._defaultDeps(), ...(deps || {}) };
    const q = String(question || '').trim();
    const safeProps = Array.isArray(props) ? props.filter(Boolean) : [];
    const env = { props: safeProps, acqReviews: acqReviews || [], deps: d,
                  record: _makeRecordFn(d) };
    const s = q.toLowerCase();

    // Follow-up pre-pass: reuse the current deterministic result set when the
    // question refers back to it ("which of those…", "generate letters", "why?").
    // ── L — A CRASH IS NOT A "NOTHING FOUND" ────────────────────────────────
    //
    // Every handler ran inside `catch (_) { result = null; }`, so a thrown intent
    // fell through to the same fallback an unrecognised question gets. The two
    // are opposite claims: one says MainStreet has no answer for you, the other
    // says MainStreet broke. The workspace said the first while meaning the
    // second, and it said it in a voice built to sound trustworthy.
    //
    // It was not hypothetical. Phase K shipped knowledge_search referencing an
    // undestructured `deps`, so EVERY search threw and every search answered
    // "I couldn't map that question to your data" — a sentence that was false
    // about the question and false about the data. Nothing surfaced it; the
    // suite caught it only because it asserted on a specific answer.
    //
    // A failure now stops the loop and takes its own path. It is reported to the
    // console for a developer and carried on the result for a test, and the
    // reader is told plainly that the request failed rather than that their
    // building holds no such record.
    let result = null, intentId = 'fallback', isFollowup = false, failure = null;
    try { result = _tryFollowup(q, s, wctx || null, env); }
    catch (e) { failure = _noteFailure('followup', e); result = null; }
    if (result) { intentId = result.intent; isFollowup = true; }

    if (!result && !failure) {
      for (const intent of INTENTS) {
        let m = false;
        // A matcher that throws is also broken, but it must not take the whole
        // question down with it: the next intent still deserves its turn. It is
        // recorded rather than routed.
        try { m = intent.match(s, context, env); }
        catch (e) { _noteFailure(intent.id + '.match', e); m = false; }
        if (!m) continue;
        try { result = intent.handle(q, context, env); }
        catch (e) { failure = _noteFailure(intent.id, e); result = null; }
        if (failure) { intentId = intent.id; break; }
        if (result) { intentId = intent.id; break; }
      }
    }
    if (failure) { result = _failureAnswer(failure); intentId = 'intent_error'; }
    else if (!result) result = FALLBACK.handle(q, context, env);

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
      : ['Who owes the most CAM this year?', 'Show my rent roll', 'Which leases expire next year?', 'Show unresolved disputes', 'Find every CAM cap', 'Show reserve balances', 'Which reconciliations are ready for RLUSD settlement?', 'Generate a recovery letter'];
    return base;
  }

  /**
   * I — a confidence badge belongs to an ANSWER, never to a fallback.
   *
   * Enforced here rather than only at the fallback's own return, because this is
   * the one place every answer passes through: any future intent that reaches
   * the fallback outcome inherits the rule without having to remember it.
   */
  function _showConfidence(a) {
    if (!a || !a.confidence) return false;
    const intent = a.intent || (a.trace && a.trace.intent) || null;
    return intent !== 'fallback';
  }

  // ── renderer — the identity rule lives HERE so every answer carries it ────
  function renderAnswerHtml(a) {
    // Phase 24: citations with real evidence (a quote, a page, or a source file)
    // become interactive — one click opens the Evidence Viewer at that citation.
    // ── I — A CITATION MAY CLAIM A CLAUSE ONLY WHEN IT CARRIES ONE ───────────
    //
    // The chip was promoted to live evidence on `quote || page != null ||
    // fileUrl`, so a lease with a filename and no captured clause rendered as a
    // gold, clickable citation. Asked "show me where the lease says the CAM cap
    // is 5%", the workspace answered with four such chips — every one
    // quote: null — under the words "extracted lease terms". That is the
    // product's central promise (every figure traceable to the clause it came
    // from) spent on chips backed by nothing.
    //
    // _lenderVerification() and /api/ask-lease already draw this line: a value
    // nothing cites is INFERRED, not VERIFIED, and a refusal that still carries
    // a citation is the failure being fixed. The renderer now draws it too.
    //
    //   quote present  → an evidence chip, clickable, opening that clause
    //   quote absent   → plain provenance text that says the clause is not held
    //
    // A blank or whitespace-only quote is an absent quote: " " cites nothing.
    const liveCites = (a.citations || []).filter(c => c && (c.source || _clauseQuote(c)));
    const evdPayload = liveCites.map(c => ({
      source: c.source || null, detail: c.detail || null,
      page: c.page ?? (c.detail && /Page (\d+)/.exec(c.detail) ? Number(RegExp.$1) : null),
      quote: _clauseQuote(c), fileUrl: c.fileUrl || null, fileName: c.fileName || null,
      reason: c.reason || null, confidence: c.confidence ?? null,
    }));
    // "Show Evidence" must not appear when there is no clause to show. A page
    // number or a file URL locates a document; it does not quote it.
    const hasEvidence = evdPayload.some(c => c.quote);
    const evdAttr = hasEvidence ? ` data-evd="${_esc(JSON.stringify(evdPayload))}"` : '';
    const cites = liveCites.map((c, i) => {
      const label = `${_esc(c.source)}${c.detail ? ` · ${_esc(c.detail)}` : ''}`;
      const cited = evdPayload[i].quote !== null;
      return cited
        ? `<button class="aiw-cite aiw-cite--live" data-idx="${i}" onclick="EvidenceViewer.openFromChip(this)" title="${_esc(evdPayload[i].quote)}">${label} ↗</button>`
        : `<span class="aiw-cite aiw-cite--nosrc" title="MainStreet has this source on file but did not capture the clause behind this value.">${label} · clause not captured</span>`;
    }).join('');
    // Phase 25: whenever real evidence exists, offer it as a first-class action —
    // the button clicks the first live citation chip (no payload duplication).
    const baseActions = (a.actions && a.actions.length ? a.actions : [{ label: 'Open Command Center', act: 'showCommandCenter' }]);
    const withEvidence = hasEvidence
      ? [{ label: 'Show Evidence', act: 'showEvidence' }, ...baseActions]
      : baseActions;
    // SEC-6 — actions no longer carry constructed JavaScript.
    //
    // This was `onclick="${x.js}"` where x.js was built by interpolating values
    // into a JS string: `window.open('${s.explorerLink}','_blank')`,
    // `ccOpenProperty('${p.id}')`. Escaping the attribute does not help — HTML
    // entities decode BEFORE the JS parses, so &#39; becomes a real quote and
    // closes the string anyway. The only fix is to stop building code from data.
    //
    // The verb is now an allow-listed name and the value rides in a data
    // attribute, where it is inert. Same pattern as the Restore button fix.
    const actions = withEvidence
      .map(x => `<button class="aiw-action" data-aiw-act="${_esc(x.act || '')}"` +
                `${x.arg  != null ? ` data-aiw-arg="${_esc(x.arg)}"` : ''}` +
                `${x.arg2 != null ? ` data-aiw-arg2="${_esc(x.arg2)}"` : ''}` +
                `>${_esc(x.label)}</button>`).join('');
    return `
      <div class="aiw-answer"${evdAttr}>
        ${a.heading ? `<div class="aiw-heading">${_esc(a.heading)}</div>` : ''}
        ${(a.bullets && a.bullets.length) ? `<ul class="aiw-bullets">${a.bullets.map(b => `<li>${_esc(b)}</li>`).join('')}</ul>` : ''}
        ${(a.paragraphs || []).map(t => `<p class="aiw-p">${_esc(t)}</p>`).join('')}
        ${cites ? `<div class="aiw-cites">${cites}</div>` : ''}
        ${_showConfidence(a) ? `<div class="aiw-conf">Confidence ${a.confidence.pct}% · ${_esc(a.confidence.basis)}</div>` : ''}
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

  return { answer, buildSuggestions, renderAnswerHtml, registerIntent,
           // L — the developer/test channel for a handler fault. Never rendered.
           lastFailure: function () { return _lastFailure; } };
})();
