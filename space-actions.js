/**
 * space-actions.js — Property Operating System: "Act on this space."
 * ============================================================================
 * The capstone. Every action a manager can take from a tenant space reads the
 * SAME assembled verified record (TenantSpace.assemble). Only the prompt and the
 * output change; the verified record stays the single source of truth.
 *
 * Phase 2 implements one action — Reply to tenant — but it is registered through
 * an action registry, so future actions (draft landlord update, explain CAM,
 * review warranty coverage, prepare renewal, maintenance summary…) are simply
 * additional entries against the same record. No new pipeline per action.
 *
 * AI discipline (enforced in the system prompt for EVERY action):
 *   1. Use ONLY the provided verified record — never general knowledge.
 *   2. Cite every factual statement to a specific record (lease §, invoice,
 *      warranty, timeline entry).
 *   3. Pre-select supporting attachments by exact name.
 *   4. If the record lacks enough information, SAY SO — do not guess.
 * Grounded-and-honest matters more than a polished paragraph.
 *
 * Reuses: /api/claude (Anthropic proxy that returns parsed JSON), _authHeaders,
 * TenantSpace.record(), esc(). No new backend.
 *
 * Exposes: window.SpaceActions
 */
window.SpaceActions = (function () {
  'use strict';

  var _esc = (window.esc) || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  function _fmtDate(ts) { try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return String(ts || ''); } }

  // ── Action registry ─────────────────────────────────────────────────────────
  var ACTIONS = {};
  function registerAction(key, def) { if (key && def) ACTIONS[key] = def; }
  function listActions() { return Object.keys(ACTIONS).map(function (k) { return Object.assign({ key: k }, ACTIONS[k]); }); }

  // The discipline — identical for every action; only the task text changes.
  var SYSTEM = [
    'You are MainStreet, the verified memory for a commercial property.',
    'You act ONLY from the VERIFIED RECORD provided for one tenant space.',
    'Non-negotiable rules:',
    '1. Use only facts present in the VERIFIED RECORD. Never use outside or general knowledge.',
    '2. Cite every factual statement to a specific record item (a lease section, invoice, warranty, or timeline entry) by its exact label/name.',
    '3. List every supporting document from the record in "attachmentsToSelect" by its EXACT name as shown.',
    '4. If the record does not contain enough information to complete the task, set "insufficient" to true and put what is missing in "missing" — do NOT guess or fill gaps.',
    'Respond with ONLY a JSON object of this shape:',
    '{"draft": string, "citations": [{"claim": string, "source": string}], "attachmentsToSelect": [string], "insufficient": boolean, "missing": string}'
  ].join('\n');

  // Serialize the assembled record into a compact, grounded context block.
  function recordToContext(rec) {
    if (!rec) return '';
    var L = [];
    L.push('SPACE: ' + (rec.space && rec.space.name || 'Space'));
    if (rec.lease) {
      var ln = [];
      if (rec.lease.type) ln.push('type ' + rec.lease.type);
      if (rec.lease.sqft) ln.push(rec.lease.sqft + ' sqft');
      if (rec.lease.start || rec.lease.end) ln.push('term ' + (rec.lease.start || '?') + ' to ' + (rec.lease.end || '?'));
      if (rec.lease.cap != null) ln.push('CAM cap ' + rec.lease.cap);
      if (ln.length) L.push('LEASE: ' + ln.join(', '));
    }
    var addDocs = function (label, arr) { (arr || []).forEach(function (a) { L.push(label + ': "' + a.name + '"' + (a.when ? ' (' + _fmtDate(a.when) + ')' : '')); }); };
    L.push('DOCUMENTS ON FILE:');
    addDocs('- invoice', rec.invoices); addDocs('- warranty', rec.warranties);
    addDocs('- photo', rec.photos); addDocs('- document', rec.documents);
    if (!(rec.invoices.length + rec.warranties.length + rec.photos.length + rec.documents.length)) L.push('- (none)');
    L.push('TIMELINE (newest first):');
    (rec.events || []).slice(0, 20).forEach(function (e) {
      var d = (window.PropertyTimeline && PropertyTimeline.describe) ? PropertyTimeline.describe(e) : { label: e.type };
      L.push('- ' + _fmtDate(e.timestamp) + ' [' + (d.label || e.type) + '] ' + e.title +
        (e.description ? ' — ' + e.description : '') +
        (e.responsibility && e.responsibility !== 'na' ? ' (responsibility: ' + e.responsibility + ')' : '') +
        (e.leaseRef ? ' (lease ' + e.leaseRef + ')' : ''));
    });
    if (!(rec.events || []).length) L.push('- (nothing recorded)');
    return L.join('\n');
  }

  function buildRequest(rec, actionKey, userInput) {
    var action = ACTIONS[actionKey] || {};
    var content = 'VERIFIED RECORD:\n' + recordToContext(rec) +
      '\n\nTASK: ' + (action.task || 'Summarize this space.') +
      (userInput ? '\n\nADDITIONAL CONTEXT (from the manager):\n' + userInput : '') +
      '\n\nReturn ONLY the JSON object described in the system instructions.';
    return { system: SYSTEM, messages: [{ role: 'user', content: content }], max_tokens: 1500 };
  }

  async function runAction(rec, actionKey, userInput) {
    var req = buildRequest(rec, actionKey, userInput);
    var headers = { 'Content-Type': 'application/json' };
    try { if (window._authHeaders) Object.assign(headers, await window._authHeaders()); } catch (_e) {}
    var resp = await fetch('/api/claude', { method: 'POST', headers: headers, body: JSON.stringify(req) });
    var data = await resp.json().catch(function () { return { error: 'Could not read response' }; });
    if (!resp.ok || data.error) return { error: data.error || ('HTTP ' + resp.status) };
    return data; // { draft, citations, attachmentsToSelect, insufficient, missing }
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  function open() {
    var box = document.getElementById('tsActions');
    var rec = window.TenantSpace && window.TenantSpace.record && window.TenantSpace.record();
    if (!box || !rec) return;
    // Tapping again closes — otherwise a second tap silently re-renders and
    // still looks like nothing happened.
    if (box.innerHTML && box.getAttribute('data-open') === '1') { close(); return; }
    injectStyles();
    var acts = listActions();
    var available = acts.filter(function (a) { return a.available; });
    box.innerHTML =
      '<div class="sa-panel">' +
        '<div class="sa-choose">' +
          acts.map(function (a) {
            return '<button class="sa-choice' + (a.available ? '' : ' sa-choice--soon') + '" data-key="' + _esc(a.key) + '"' + (a.available ? '' : ' disabled') + '>' +
              (a.icon || '') + '&nbsp;' + _esc(a.label) + (a.available ? '' : ' <span class="sa-soon">soon</span>') + '</button>';
          }).join('') +
        '</div>' +
        '<div id="saRun"></div>' +
      '</div>';
    box.setAttribute('data-open', '1');
    box.querySelectorAll('.sa-choice[data-key]').forEach(function (b) {
      if (b.disabled) return;
      b.onclick = function () { _startAction(rec, b.getAttribute('data-key')); _reveal(box); };
    });
    // Only one action is built so far — go straight to it rather than making the
    // user pick from a list that is mostly "coming soon".
    if (available.length === 1) {
      _startAction(rec, available[0].key);
      var only = box.querySelector('.sa-choice[data-key="' + available[0].key + '"]');
      if (only) only.classList.add('sa-choice--on');
    }
    // THE FIX: the actions panel sits at the bottom of a long scrolling drawer,
    // so without this it renders below the fold and the tap looks like a no-op.
    _reveal(box);
  }

  function close() {
    var box = document.getElementById('tsActions');
    if (!box) return;
    box.innerHTML = '';
    box.removeAttribute('data-open');
  }

  // Bring the panel into view inside the scrolling overlay (and the page).
  function _reveal(el) {
    if (!el) return;
    setTimeout(function () {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        var ov = document.getElementById('tsOverlay');
        if (ov && typeof ov.scrollTo === 'function') {
          // Nudge the overlay so the panel is comfortably visible, not flush to
          // the bottom edge on a phone.
          var r = el.getBoundingClientRect();
          var overflow = r.bottom - window.innerHeight;
          if (overflow > -24) ov.scrollTop = ov.scrollTop + overflow + 24;
        }
      } catch (_e) {}
    }, 30);
  }

  function _startAction(rec, key) {
    var action = ACTIONS[key]; if (!action) return;
    var run = document.getElementById('saRun');
    run.innerHTML =
      (action.needsInput
        ? '<label class="sa-label">' + _esc(action.inputLabel || 'Context (optional)') + '</label>' +
          '<textarea class="sa-input" id="saInput" rows="3" placeholder="' + _esc(action.inputPlaceholder || '') + '"></textarea>'
        : '') +
      '<button class="sa-go" id="saGo">' + _esc(action.cta || 'Generate') + '</button>' +
      '<div id="saResult"></div>';
    document.getElementById('saGo').onclick = function () { _generate(rec, key); };
  }

  async function _generate(rec, key) {
    var go = document.getElementById('saGo');
    var input = document.getElementById('saInput');
    var res = document.getElementById('saResult');
    go.disabled = true; go.textContent = 'Reading the record…';
    var data;
    try { data = await runAction(rec, key, input ? input.value.trim() : ''); }
    catch (e) { data = { error: e && e.message || 'Request failed' }; }
    go.disabled = false; go.textContent = (ACTIONS[key] && ACTIONS[key].cta) || 'Generate';

    if (!data || data.error) {
      res.innerHTML = '<div class="sa-err">Couldn’t complete that: ' + _esc((data && data.error) || 'unknown error') + '</div>';
      return;
    }
    // Honesty rule: not enough in the record → say so, don't show a guessed draft.
    if (data.insufficient) {
      res.innerHTML = '<div class="sa-insuff"><b>Not enough in the record to answer confidently.</b>' +
        (data.missing ? '<div class="sa-missing">Missing: ' + _esc(data.missing) + '</div>' : '') +
        '<div class="sa-missing">Add the missing record to this space, then try again.</div></div>';
      return;
    }
    res.innerHTML = _renderResult(rec, data);
    var copy = document.getElementById('saCopy');
    if (copy) copy.onclick = function () {
      var draft = document.getElementById('saDraft');
      try { navigator.clipboard.writeText(draft ? draft.value : (data.draft || '')); copy.textContent = 'Copied ✓'; setTimeout(function () { copy.textContent = 'Copy draft'; }, 1400); } catch (_e) {}
    };
  }

  // Pre-select attachments the AI named (matched to the record by exact name).
  function _matchAttachments(rec, names) {
    var want = {}; (names || []).forEach(function (n) { want[String(n).toLowerCase()] = true; });
    var all = [].concat(rec.invoices || [], rec.warranties || [], rec.photos || [], rec.documents || []);
    var seen = {};
    return all.filter(function (a) { if (seen[a.url]) return false; seen[a.url] = 1; return true; })
      .map(function (a) { return { name: a.name, url: a.url, kind: a.kind, selected: !!want[String(a.name).toLowerCase()] }; });
  }

  function _renderResult(rec, data) {
    var atts = _matchAttachments(rec, data.attachmentsToSelect);
    var cites = (data.citations || []).filter(function (c) { return c && (c.claim || c.source); });
    return '<div class="sa-result">' +
      '<div class="sa-lbl">Draft — review before sending</div>' +
      '<textarea class="sa-draft" id="saDraft" rows="8">' + _esc(data.draft || '') + '</textarea>' +
      (cites.length
        ? '<div class="sa-lbl">Grounded in these records</div><ul class="sa-cites">' +
          cites.map(function (c) { return '<li><span class="sa-claim">' + _esc(c.claim || '') + '</span><span class="sa-src">' + _esc(c.source || '') + '</span></li>'; }).join('') + '</ul>'
        : '') +
      (atts.length
        ? '<div class="sa-lbl">Attachments' + (atts.some(function (a) { return a.selected; }) ? ' — supporting documents pre-selected' : '') + '</div>' +
          '<div class="sa-atts">' + atts.map(function (a) {
            var ic = a.kind === 'photo' ? '\u{1F5BC}\u{FE0F}' : (a.kind === 'invoice' ? '\u{1F9FE}' : (a.kind === 'warranty' ? '\u{1F6E1}\u{FE0F}' : '\u{1F4C4}'));
            return '<label class="sa-att' + (a.selected ? ' sa-att--on' : '') + '"><input type="checkbox"' + (a.selected ? ' checked' : '') + '>' + ic + '&nbsp;' + _esc(a.name) + '</label>';
          }).join('') + '</div>'
        : '') +
      '<div class="sa-actions"><button class="sa-copy" id="saCopy">Copy draft</button>' +
        '<span class="sa-note">You review — MainStreet drafted this from the record, not the internet.</span></div>' +
    '</div>';
  }

  // ── Phase 2: register the one action. Future actions register here too. ──────
  registerAction('reply', {
    label: 'Reply to tenant', icon: '✉️', available: true,
    task: 'Draft a professional reply to the tenant about this space. Ground every factual claim in the record (lease section, invoice, warranty, service history). Select the supporting documents the tenant should receive.',
    needsInput: true, inputLabel: "Tenant's message (optional)", inputPlaceholder: 'Paste the tenant’s question…',
    cta: 'Draft reply',
  });
  // Nothing is registered until it is built. Four actions used to appear here as
  // available:false and rendered as disabled "soon" chips, so four of the five
  // things this surface offered did nothing — which reads as unfinished software
  // rather than as a roadmap. One working action is a feature; five where four
  // are dead is a promise the screen cannot keep.
  //
  // When the next one is built, register it here and it appears. Candidates:
  // draft landlord update, explain CAM charges, maintenance summary. NOT
  // "review warranty coverage" — standalone warranties were removed; warranty
  // cover belongs to the maintenance record it came from.

  function injectStyles() {
    if (document.getElementById('sa-styles')) return;
    var gold = '#C9973A';
    var css = [
      '.sa-panel{padding:10px 0 4px;}',
      '.sa-choose{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}',
      '.sa-choice{font:700 0.8rem/1 inherit;color:var(--text-1,#E2E8F0);background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:9px;padding:9px 12px;cursor:pointer;min-height:38px;}',
      '.sa-choice:hover:not(:disabled){border-color:' + gold + ';}',
      '.sa-choice--soon{opacity:0.5;cursor:default;}',
      '.sa-choice--on{border-color:' + gold + ';color:' + gold + ';}',
      '.sa-soon{font-size:0.6rem;font-weight:800;text-transform:uppercase;color:var(--text-4,#64748B);border:1px solid rgba(var(--line-rgb,255,255,255),0.2);border-radius:5px;padding:1px 4px;margin-left:4px;}',
      '.sa-label,.sa-lbl{display:block;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--text-4,#64748B);margin:10px 0 5px;}',
      '.sa-input,.sa-draft{width:100%;box-sizing:border-box;padding:10px 11px;border-radius:8px;font:0.85rem inherit;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);color:var(--text-1,#E2E8F0);resize:vertical;}',
      '.sa-input:focus,.sa-draft:focus{outline:none;border-color:' + gold + ';}',
      '.sa-go{margin-top:10px;min-height:42px;padding:0 16px;border-radius:9px;font:800 0.85rem/1 inherit;cursor:pointer;color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';}',
      '.sa-go:disabled{opacity:0.6;cursor:default;}',
      '.sa-result{margin-top:12px;}',
      '.sa-cites{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;}',
      '.sa-cites li{display:flex;flex-direction:column;gap:2px;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-left:3px solid ' + gold + ';border-radius:8px;padding:8px 10px;}',
      '.sa-claim{font-size:0.8rem;color:var(--text-2,#CBD5E1);}',
      '.sa-src{font-size:0.72rem;color:var(--text-4,#64748B);}',
      '.sa-atts{display:flex;flex-direction:column;gap:6px;}',
      '.sa-att{display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-2,#CBD5E1);background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:8px;padding:8px 10px;cursor:pointer;}',
      '.sa-att--on{border-color:' + gold + ';}',
      '.sa-att input{accent-color:' + gold + ';width:16px;height:16px;}',
      '.sa-actions{display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap;}',
      '.sa-copy{min-height:40px;padding:0 14px;border-radius:8px;font:700 0.82rem/1 inherit;cursor:pointer;color:var(--text-1,#E2E8F0);background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.16);}',
      '.sa-note{font-size:0.72rem;color:var(--text-4,#64748B);}',
      '.sa-insuff{background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.3);border-radius:9px;padding:11px 13px;font-size:0.82rem;color:var(--text-2,#CBD5E1);margin-top:12px;}',
      '.sa-missing{font-size:0.78rem;color:var(--text-3,#94A3B8);margin-top:5px;}',
      '.sa-err{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:9px;padding:11px 13px;font-size:0.82rem;color:#fca5a5;margin-top:12px;}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'sa-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  return {
    registerAction: registerAction, listActions: listActions,
    recordToContext: recordToContext, buildRequest: buildRequest, runAction: runAction,
    open: open, close: close, ACTIONS: ACTIONS, SYSTEM: SYSTEM,
  };
})();
