/**
 * property-workspace.js — Property Operating System: the advisor surface.
 * ============================================================================
 * Move #3 — "What needs your attention." A compact, ranked panel at the top of
 * the property overview that answers, for today: what matters, why, and the one
 * action to take. It REDUCES cognitive load — it prioritizes, it does not pile
 * on information.
 *
 * Reuses (never re-computes): Selectors.derivePropertyReadiness / buildPropMeta
 * (the numbers the KPI header already derives) for the signals, and
 * switchWorkspaceTab + _ccFlashEl for the one-click action. No new data, no new
 * AI model — it surfaces and prioritizes what the verified record already knows.
 *
 * Design rules honored:
 *   - Show the FEW things that matter, ranked (3–5 shown; the rest behind "View all").
 *   - Every item = what (title) · why (one line) · one action (go to the proof).
 *   - "All caught up" is a first-class state — telling a manager they can relax
 *     is reducing load, not hiding work.
 *
 * Exposes: window.PropertyWorkspace
 */
window.PropertyWorkspace = (function () {
  'use strict';

  var _esc = (window.esc) || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  var MAX_SHOWN = 5;        // 3–5 prioritized items, then "View all"
  var _lastItems = [];
  var _expanded = false;

  function _plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function _mk(severity, icon, title, why, nav, action) {
    return { severity: severity, icon: icon, title: title, why: why, nav: nav, action: action };
  }

  function _money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString(); }

  // ── THE UNBILLED POOL IS READ, NOT INTERPRETED HERE ────────────────────────
  //
  // This panel used to compute `snap.total - allocated` and announce the result
  // as "CAM underbilling — $99,523 unrecovered / Allocated charges fall short of
  // the eligible expense pool". The subtraction was right and the sentence was
  // false. On Cascade Commons $75,548.60 of that figure is allocation the engine
  // computed and then WITHHELD because a lease cap was reached — money the
  // leases say those tenants do not owe — and a further $5,144.60 is a category
  // a lease excludes from CAM outright. Calling it "unrecovered underbilling"
  // sent the manager to go collect money their own leases forbid collecting, and
  // the CTA landed them on the CAM panel that says the opposite.
  //
  // VarianceBreakdown already decomposes exactly this number, and two other
  // surfaces already read it: the CAM variance panel and Ask AI's
  // variance_unbilled answer. This one now reads it too.
  //
  // IT IS READ FROM THE SCREEN'S OWN BREAKDOWN, NOT RE-DERIVED. The stamping
  // comment on varianceBreakdownOnScreen says re-deriving elsewhere "would need
  // those same two lists and would produce a figure that could drift from the
  // banner", and that is measurable rather than theoretical: deriving from
  // `camReconciliation` alone — whose `invoices` are stripped to
  // {vendor, category, amount} with no id — leaves 11 invoices unmatched and
  // reports residual -$46,515.36 with explained:false, against residual $0 and
  // explained:true from the lists the render actually used. So a second
  // derivation is not a fallback; it is a wrong answer.
  //
  // The scope guard is the one billingVerdictOnScreen already carries: a
  // breakdown belonging to another building is refused rather than borrowed.
  function _scopedVarianceBreakdown(p) {
    try {
      if (typeof window.varianceBreakdownOnScreen !== 'function') return null;
      var w = window.varianceBreakdownOnScreen();
      if (!w || !w.breakdown) return null;
      if (!p || !p.id || !w.propertyId || w.propertyId !== p.id) return null;
      return w.breakdown;
    } catch (_e) { return null; }
  }

  /**
   * How to describe money in the pool that was not billed to tenants.
   *
   * `difference` is the pool-minus-billed figure, which is a fact. What it MEANS
   * is the breakdown's to say, so this states one of exactly three things:
   *
   *   accounted   the named causes add up — they are listed, largest first, in
   *               the breakdown's own words. The total is never called
   *               "unrecovered": most of it routinely is not.
   *   partial     some of it is attributed and a remainder is not. The remainder
   *               is named an unaccounted variance, and no cause is guessed for it.
   *   unknown     no breakdown is on screen for this property. Then the only
   *               claim made is the one the subtraction supports — this much was
   *               not billed — and the reader is sent to the surface that can
   *               explain it. No interpretation, and no "unrecovered".
   *
   * Pure and exported so the wording can be tested against a breakdown fixture
   * without a reconciliation, including the cases the demo cannot produce.
   */
  function unbilledPoolNarrative(difference, breakdown) {
    var amt = _money(difference);
    if (!breakdown) {
      return { state: 'unknown',
        title: amt + ' of the expense pool was not billed to tenants',
        why: 'What accounts for it has not been established for this reconciliation. '
           + 'Open the reconciliation to see the breakdown.' };
    }
    // The residual line is the breakdown's own "not attributed" valve; it is not
    // one of the named causes and must not be listed as one.
    var named = (breakdown.lines || []).filter(function (l) {
      return l && l.key !== 'residual' && Number(l.amount);
    });
    var residual = Number(breakdown.residual) || 0;
    var settled = breakdown.explained === true && Math.abs(residual) < 0.01;

    if (settled && named.length) {
      var top = named[0];
      var rest = named.length - 1;
      return { state: 'accounted',
        title: amt + ' of the expense pool was not billed — accounted for',
        // The cause is quoted in the breakdown's own words, not re-worded — it
        // is the same sentence the CAM panel shows, and lower-casing it turned
        // "Reduced by a CAM cap" into "reduced by a cam cap".
        why: 'Largest cause — ' + String(top.label || 'Unnamed cause')
           + ' (' + _money(top.amount) + ')'
           + (rest > 0 ? '. ' + rest + ' further named cause' + (rest === 1 ? '' : 's')
                       + ' account' + (rest === 1 ? 's' : '') + ' for the rest.' : '.') };
    }
    // Not settled. Report the unattributed part as exactly that, and say how much
    // IS attributed rather than implying none of it is.
    var attributed = named.reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);
    var gap = Math.abs(residual) >= 0.01 ? Math.abs(residual) : Number(difference) || 0;
    return { state: 'partial',
      title: _money(gap) + ' of the expense pool is an unaccounted variance',
      why: named.length
        ? amt + ' was not billed; named causes account for ' + _money(attributed)
          + '. The remainder is not attributed to any cause on record.'
        : amt + ' was not billed and nothing on record accounts for it yet.' };
  }

  // Collect prioritized attention items from state the app already computes.
  //
  // `varianceBreakdown` is SUPPLIED BY THE CALLER, not fetched here. This
  // function runs on the server too — PropertyRecord.assemble() calls it for the
  // MCP attention projection — and varianceBreakdownOnScreen is a browser-only
  // global that closes over render-time state. Reaching for it here would make a
  // read-only server path depend on a browser, which is the thing the dependency
  // inventory exists to prevent. So renderAttention (browser) passes the scoped
  // breakdown in, the server passes nothing, and the wording degrades to "not
  // established" rather than to a guess.
  function collectAttention(p, varianceBreakdown) {
    if (!p) return [];
    var S = window.Selectors || {};
    var rd = (typeof S.derivePropertyReadiness === 'function') ? S.derivePropertyReadiness(p) : {};
    var meta = (typeof S.buildPropMeta === 'function') ? S.buildPropMeta(p) : {};
    // M7 — ONE definition of open, shared with TenantSpace and get_disputes.
    //
    // This read `d.status === 'open'`, so a dispute in `docs_requested` — which
    // the state machine says can still move, and which nobody has decided —
    // was not counted. get_disputes counted it. The same property reported "1
    // open dispute" here and openDisputeCount 2 there, both confidently.
    //
    // meta.openDisputes is no longer preferred: Selectors.buildPropMeta derives
    // it with the narrow rule, so trusting it would reintroduce the divergence
    // through the back door on any property where Selectors IS available.
    var DS = (typeof window !== 'undefined') && window.DisputeStatus;
    var _disp = Array.isArray(p.disputes) ? p.disputes : [];
    var openDisputes = (DS && typeof DS.tally === 'function')
      ? DS.tally(_disp).open
      : _disp.filter(function (d) { return d && (d.status === 'open' || d.status === 'docs_requested'); }).length;

    var items = [];
    // Critical — the record is out of date in a way that affects money/renewals.
    if (rd.expiredCount > 0) items.push(_mk('critical', '\u{1F534}',
      _plural(rd.expiredCount, 'lease', 'leases') + ' expired',
      'Confirm holdover status before it affects renewals.',
      { tab: 'spaces', anchors: ['cardLeases','spacesSection'] }, 'Review leases'));
    // Warnings — action needed before CAM/recoveries can be trusted.
    if (openDisputes > 0) items.push(_mk('warning', '\u{2696}\u{FE0F}',
      _plural(openDisputes, 'open dispute', 'open disputes'),
      'Unresolved charges hold up reconciliation.',
      { tab: 'cam', anchors: ['disputeSection', 'openDisputesWrap'] }, 'Review disputes'));
    if (rd.incompleteCount > 0) items.push(_mk('warning', '\u{1F4DD}',
      _plural(rd.incompleteCount, 'tenant', 'tenants') + ' missing lease info',
      'CAM can’t be trusted until lease terms are complete.',
      { tab: 'overview', anchors: ['propertyReviewQueuePanel'] }, 'Complete review'));
    if (rd.missingCapCount > 0) items.push(_mk('warning', '\u{1F6E1}\u{FE0F}',
      'Missing cap on ' + _plural(rd.missingCapCount, 'NNN tenant', 'NNN tenants'),
      'Without a cap, overbilling can’t be caught.',
      { tab: 'spaces', anchors: ['cardLeases','spacesSection'] }, 'Add cap'));
    // Informational — worth knowing, not urgent.
    if (rd.proRataGap >= 5) items.push(_mk('info', '\u{1F4C9}',
      'Vacancy reducing recoveries',
      Math.round(rd.proRataGap) + '% of CAM is unallocated to tenants.',
      { tab: 'cam', anchors: ['results', 'cardInvoices'] }, 'View allocation'));
    if (rd.expiringCount > 0) items.push(_mk('info', '\u{1F4C5}',
      _plural(rd.expiringCount, 'lease expires', 'leases expire') + ' within 12 months',
      'Start renewal conversations early.',
      { tab: 'spaces', anchors: ['cardLeases','spacesSection'] }, 'View leases'));
    if (rd.lowConfCount > 0) items.push(_mk('info', '\u{1F50D}',
      'Lease terms need review on ' + _plural(rd.lowConfCount, 'tenant', 'tenants'),
      'Low-confidence extractions should be verified.',
      { tab: 'overview', anchors: ['propertyReviewQueuePanel'] }, 'Verify terms'));

    // ── Reference-driven signals ────────────────────────────────────────────
    // Read from the property's own reference record (insurance, roof, CAM) —
    // still "what the verified record already knows", not new prediction.
    try {
      var PR = window.PropertyReference;
      var info = PR && PR.infoFor(p);
      if (info && info.insuranceExpires) {
        var days = Math.round((new Date(info.insuranceExpires + 'T12:00:00') - Date.now()) / 86400000);
        if (days >= 0 && days <= 120) items.push(_mk(days <= 45 ? 'warning' : 'info', '\u{1F6E1}\u{FE0F}',
          'Insurance renewal in ' + days + ' days',
          (info.insuranceCarrier || 'Carrier') + ' policy expires ' + info.insuranceExpires + '.',
          { tab: 'property', anchors: ['propertySection'] }, 'View policy'));
      }
      // The part of the pool that was not billed, INTERPRETED BY THE AUTHORITY
      // THAT ALREADY EXPLAINS IT rather than by this line's own subtraction.
      var snap = p.camReconciliation;
      if (snap && Array.isArray(snap.results) && snap.results.length && snap.total) {
        var allocated = snap.results.reduce(function (s, r) {
          return s + (Number(r.allocatedAmount != null ? r.allocatedAmount : r.totalAllocated) || 0);
        }, 0);
        var under = Number(snap.total) - allocated;
        if (under > Number(snap.total) * 0.05) {
          var _n = unbilledPoolNarrative(under, varianceBreakdown || null);
          items.push(_mk('warning', '\u{1F4B0}', _n.title, _n.why,
            { tab: 'cam', anchors: ['results', 'cardInvoices'] }, 'Review allocation'));
        }
      }
      // Audit window: tenants typically have a limited period to contest a
      // reconciliation. Surface it while there is still time to respond.
      if (snap && snap.savedAt) {
        var elapsed = Math.round((Date.now() - new Date(snap.savedAt)) / 86400000);
        var remaining = 90 - elapsed;
        if (remaining > 0 && remaining <= 30) items.push(_mk('warning', '\u{23F3}',
          'Audit window closes in ' + remaining + ' days',
          'Tenants can still contest the ' + (snap.camYear || '') + ' reconciliation.',
          { tab: 'cam', anchors: ['results'] }, 'Review CAM'));
      }
    } catch (_e) {}

    // Maintenance needing review — from the property's own timeline record.
    try {
      var maint = (p.timeline || []).filter(function (e) {
        return e && /^(maintenance|repair)$/.test(e.category || '') &&
               e.responsibility && e.responsibility !== 'na';
      });
      if (maint.length) {
        var latest = maint[maint.length - 1];
        items.push(_mk('info', '\u{1F527}', 'Maintenance requires review',
          String(latest.title || 'Recent work').slice(0, 70) + ' — confirm cost responsibility.',
          { tab: 'overview', anchors: ['propertyActivitySlot'] }, 'Open timeline'));
      }
    } catch (_e) {}

    var order = { critical: 0, warning: 1, info: 2 };
    items.sort(function (a, b) { return order[a.severity] - order[b.severity]; });
    return items;
  }

  // Reuse the app's navigation primitives to jump to the proof.
  function act(idx) {
    var it = _lastItems[idx];
    if (!it || !it.nav) return;
    try { if (window.switchWorkspaceTab) window.switchWorkspaceTab(it.nav.tab); } catch (_e) {}
    var el = null, any = null, an = it.nav.anchors || [];
    // Same reason as _kpiTileNavigate: reveal a collapsed target before the
    // visibility test below decides it is not there.
    try { if (window.PropertyOS && window.PropertyOS.revealForAnchor) window.PropertyOS.revealForAnchor(an); } catch (_e) {}
    for (var i = 0; i < an.length; i++) {
      var c = document.getElementById(an[i]);
      if (c && !any) any = c;
      if (c && c.offsetParent !== null) { el = c; break; }
    }
    el = el || any;
    try { if (el && window._ccFlashEl) window._ccFlashEl(el); } catch (_e) {}
  }

  function renderAttention(property) {
    property = property || (window.currentProperty && window.currentProperty());
    var actSlot = document.getElementById('propertyActivitySlot');
    if (!actSlot || !property) return; // overview not mounted yet
    injectStyles();

    var slot = document.getElementById('propertyAttentionSlot');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'propertyAttentionSlot';
      actSlot.parentNode.insertBefore(slot, actSlot);
    }

    // The browser half of the split: the scoped read happens HERE, on a path
    // only a browser takes, and the result is handed to collectAttention.
    var items = collectAttention(property, _scopedVarianceBreakdown(property));
    _lastItems = items;

    if (!items.length) {
      slot.innerHTML =
        '<div class="pw-attn pw-attn--clear">' +
          '<span class="pw-attn-check">✓</span>' +
          '<div><div class="pw-attn-clear-title">You’re all caught up</div>' +
          '<div class="pw-attn-clear-sub">Nothing needs action on this property right now.</div></div>' +
        '</div>';
      return;
    }

    var shown = _expanded ? items : items.slice(0, MAX_SHOWN);
    var more = items.length - shown.length;
    var rows = shown.map(function (it, i) {
      return '<div class="pw-item pw-item--' + it.severity + '">' +
        '<span class="pw-item-icon">' + it.icon + '</span>' +
        '<div class="pw-item-main">' +
          '<div class="pw-item-title">' + _esc(it.title) + '</div>' +
          '<div class="pw-item-why">' + _esc(it.why) + '</div>' +
        '</div>' +
        '<button class="pw-item-act" onclick="if(window.PropertyWorkspace){PropertyWorkspace.act(' + i + ');}">' +
          _esc(it.action) + '&nbsp;&#x2192;</button>' +
      '</div>';
    }).join('');

    slot.innerHTML =
      '<div class="pw-attn">' +
        '<div class="pw-attn-head"><span class="pw-attn-title">⚡&nbsp; What needs your attention</span>' +
          '<span class="pw-attn-count">' + items.length + '</span></div>' +
        '<div class="pw-attn-list">' + rows + '</div>' +
        (more > 0
          ? '<button class="pw-attn-all" onclick="PropertyWorkspace.toggleAll()">View all ' + items.length + ' &#x2192;</button>'
          : (_expanded && items.length > MAX_SHOWN
              ? '<button class="pw-attn-all" onclick="PropertyWorkspace.toggleAll()">Show top ' + MAX_SHOWN + ' &#x2191;</button>'
              : '')) +
      '</div>';
  }

  // "View all" — the widget stays prioritized by default; the full list is one
  // click away rather than crowding the dashboard.
  function toggleAll() {
    _expanded = !_expanded;
    try { renderAttention(); } catch (_e) {}
  }

  function injectStyles() {
    if (document.getElementById('pw-styles')) return;
    var gold = '#C9973A';
    var css = [
      '#propertyAttentionSlot{display:block;margin:0 0 14px;}',
      '.pw-attn{background:var(--theme-card,#0F1217);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:12px;padding:12px 14px;}',
      '.pw-attn-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}',
      '.pw-attn-title{font-size:0.92rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.pw-attn-count{margin-left:auto;font-size:0.7rem;font-weight:800;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.07);border-radius:20px;padding:2px 9px;}',
      '.pw-attn-list{display:flex;flex-direction:column;gap:8px;}',
      '.pw-item{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-left-width:3px;}',
      '.pw-item--critical{border-left-color:#ef4444;}',
      '.pw-item--warning{border-left-color:#fbbf24;}',
      '.pw-item--info{border-left-color:#7dd3fc;}',
      '.pw-item-icon{font-size:1rem;flex:none;}',
      '.pw-item-main{flex:1;min-width:0;}',
      '.pw-item-title{font-size:0.85rem;font-weight:700;color:var(--text-1,#E2E8F0);}',
      '.pw-item-why{font-size:0.76rem;color:var(--text-3,#94A3B8);margin-top:2px;line-height:1.4;}',
      '.pw-item-act{flex:none;font:700 0.74rem/1 inherit;color:' + gold + ';background:rgba(201,151,58,0.12);border:1px solid rgba(201,151,58,0.4);border-radius:8px;padding:9px 12px;cursor:pointer;white-space:nowrap;min-height:38px;}',
      '.pw-item-act:hover{background:rgba(201,151,58,0.2);}',
      '.pw-attn-more{font-size:0.74rem;color:var(--text-4,#64748B);margin-top:9px;}',
      '.pw-attn-all{margin-top:10px;width:100%;min-height:36px;border-radius:8px;font:700 0.74rem/1 inherit;cursor:pointer;color:var(--text-3,#94A3B8);background:transparent;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);}',
      '.pw-attn-all:hover{color:' + gold + ';border-color:' + gold + ';}',
      '.pw-attn--clear{display:flex;align-items:center;gap:12px;}',
      '.pw-attn-check{width:30px;height:30px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(22,101,52,0.2);color:#4ade80;font-weight:800;}',
      '.pw-attn-clear-title{font-size:0.9rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.pw-attn-clear-sub{font-size:0.78rem;color:var(--text-3,#94A3B8);margin-top:2px;}',
      '@media (max-width:480px){',
      '  .pw-item{flex-wrap:wrap;}',
      '  .pw-item-main{flex:1 1 100%;order:1;}',
      '  .pw-item-icon{order:0;}',
      '  .pw-item-act{order:2;margin-left:auto;min-height:42px;}',
      '}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'pw-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  return {
    collectAttention: collectAttention,
    renderAttention: renderAttention,
    act: act, toggleAll: toggleAll,
    // The unbilled-pool wording, exposed so it can be exercised against a
    // breakdown fixture directly — including the unaccounted and no-breakdown
    // cases, which the demo's fully-explained reconciliation cannot produce.
    unbilledPoolNarrative: unbilledPoolNarrative,
  };
})();
