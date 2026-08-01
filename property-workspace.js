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

  // Collect prioritized attention items from state the app already computes.
  function collectAttention(p) {
    if (!p) return [];
    var S = window.Selectors || {};
    var rd = (typeof S.derivePropertyReadiness === 'function') ? S.derivePropertyReadiness(p) : {};
    var meta = (typeof S.buildPropMeta === 'function') ? S.buildPropMeta(p) : {};
    var openDisputes = (meta.openDisputes != null)
      ? meta.openDisputes
      : (Array.isArray(p.disputes) ? p.disputes.filter(function (d) { return d && d.status === 'open'; }).length : 0);

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
      // CAM underbilling: allocated materially below the eligible pool.
      var snap = p.camReconciliation;
      if (snap && Array.isArray(snap.results) && snap.results.length && snap.total) {
        var allocated = snap.results.reduce(function (s, r) {
          return s + (Number(r.allocatedAmount != null ? r.allocatedAmount : r.totalAllocated) || 0);
        }, 0);
        var under = Number(snap.total) - allocated;
        if (under > Number(snap.total) * 0.05) items.push(_mk('warning', '\u{1F4B0}',
          'CAM underbilling — ' + '$' + Math.round(under).toLocaleString() + ' unrecovered',
          'Allocated charges fall short of the eligible expense pool.',
          { tab: 'cam', anchors: ['results', 'cardInvoices'] }, 'Review allocation'));
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

    var items = collectAttention(property);
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
  };
})();
