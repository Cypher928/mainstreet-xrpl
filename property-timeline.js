/**
 * property-timeline.js — Property Timeline v1 (Phase 2)
 * ============================================================================
 * The manager-facing layer on top of MainStreet's existing timeline engine.
 * Adds: an extensible event-type registry, a "+ Add to timeline" entry modal
 * (manual logbook entries with responsibility, optional lease reference, and
 * invoice/PDF/photo attachments), and the styles for the enhanced timeline view.
 *
 * Reuses (never re-implements): the event store + persistence
 * (appendPropertyTimelineEvent / savePropertyData / property.timeline blob), the
 * renderer (renderPropertyActivity), the upload path (uploadInvoiceFile →
 * /api/upload), and esc() — all globals from script.js. Loaded AFTER script.js.
 *
 * Extensibility: future modules (CAM, disputes, payments, acquisitions, AI
 * recommendations) become timeline events by calling
 *   PropertyTimeline.registerType(type, { label, icon, group })
 * and emitting appendPropertyTimelineEvent(...). No renderer changes required.
 *
 * Exposes: window.PropertyTimeline
 */
window.PropertyTimeline = (function () {
  'use strict';

  var _esc = (window.esc) || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  // ── Event-type registry ─────────────────────────────────────────────────────
  // key → { label, icon, group }. Manual categories and existing auto types are
  // seeded here; future modules register their own so they render uniformly.
  var REGISTRY = {};
  function registerType(key, def) {
    if (!key || !def) return;
    REGISTRY[key] = { label: def.label || key, icon: def.icon || null, group: def.group || 'system' };
  }

  // Manager-authored categories (the logbook).
  var MANUAL_CATEGORIES = [
    { key: 'note',          label: 'Note',          icon: '\u{1F4DD}' }, // 📝
    { key: 'maintenance',   label: 'Maintenance',   icon: '\u{1F527}' }, // 🔧
    { key: 'inspection',    label: 'Inspection',    icon: '\u{1F50D}' }, // 🔍
    { key: 'communication', label: 'Communication', icon: '\u{1F4AC}' }, // 💬
    { key: 'payment',       label: 'Payment',       icon: '\u{1F4B5}' }, // 💵
    { key: 'other',         label: 'Other',         icon: '\u{1F4CC}' }, // 📌
  ];
  MANUAL_CATEGORIES.forEach(function (c) { registerType(c.key, { label: c.label, icon: c.icon, group: 'manual' }); });

  // Existing auto types (so they render with the same registry path).
  [
    ['lease_uploaded', 'Lease', '\u{1F4C4}', 'leases'],
    ['extraction_completed', 'Extraction', '\u{1F4C4}', 'leases'],
    ['extraction_warning', 'Extraction', '\u{1F4C4}', 'leases'],
    ['amendment_uploaded', 'Amendment', '\u{1F4C4}', 'leases'],
    ['amendment_applied', 'Amendment', '\u{1F4C4}', 'leases'],
    ['field_overridden', 'Field', '\u{270F}\u{FE0F}', 'leases'],
    ['review_confirmed', 'Review', '\u{2705}', 'leases'],
    ['invoice_imported', 'Invoice', '\u{1F9FE}', 'cam'],
    ['dispute_created', 'Dispute', '\u{2696}\u{FE0F}', 'disputes'],
    ['dispute_resolved', 'Dispute', '\u{2696}\u{FE0F}', 'disputes'],
    ['export_generated', 'Export', '\u{1F4E4}', 'system'],
    ['derived_metrics_rebuilt', 'Metrics', '\u{1F4CA}', 'cam'],
    ['sync_restored', 'Sync', '\u{1F504}', 'system'],
    ['merge_recovered', 'Merge', '\u{1F500}', 'system'],
  ].forEach(function (r) { registerType(r[0], { label: r[1], icon: r[2], group: r[3] }); });

  // Resolve an event → { label, icon } for the renderer.
  function describe(ev) {
    if (!ev) return { label: '', icon: null };
    var key = ev.manual ? (ev.category || String(ev.type || '').replace(/^manual_/, '')) : ev.type;
    var def = REGISTRY[key] || REGISTRY[String(ev.type || '').replace(/^manual_/, '')];
    if (def) return { label: def.label, icon: def.icon };
    return { label: (ev.category || ev.type || ''), icon: null };
  }

  // ── Add-entry modal ───────────────────────────────────────────────────────
  var _pending = []; // [{ file, kind, name }]

  function _todayISODate() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function _toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'ptl-toast ptl-toast--' + (kind || 'ok');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 2600);
    setTimeout(function () { t.remove(); }, 3200);
  }

  function _renderPendingList() {
    var box = document.getElementById('ptlFileList');
    if (!box) return;
    if (!_pending.length) { box.innerHTML = ''; return; }
    box.innerHTML = _pending.map(function (p, i) {
      var ic = p.kind === 'photo' ? '\u{1F5BC}\u{FE0F}' : (p.kind === 'invoice' ? '\u{1F9FE}' : '\u{1F4C4}');
      return '<div class="ptl-file"><span>' + ic + '&nbsp;' + _esc(p.name) + '</span>' +
        '<button type="button" class="ptl-file-x" data-i="' + i + '" aria-label="Remove">✕</button></div>';
    }).join('');
    box.querySelectorAll('.ptl-file-x').forEach(function (b) {
      b.onclick = function () { _pending.splice(Number(b.getAttribute('data-i')), 1); _renderPendingList(); };
    });
  }

  function _pickFiles(kind, accept) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = true;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = function () {
      Array.prototype.forEach.call(inp.files || [], function (f) {
        _pending.push({ file: f, kind: kind, name: f.name });
      });
      _renderPendingList();
      inp.remove();
    };
    inp.click();
  }

  function closeModal() {
    var ov = document.getElementById('ptlOverlay');
    if (ov) ov.remove();
    _pending = [];
  }

  function openAddEntry(property) {
    property = property || (window.currentProperty && window.currentProperty());
    if (!property) { _toast('Open a property first', 'err'); return; }
    if (document.getElementById('ptlOverlay')) return;
    injectStyles();
    _pending = [];

    var catOpts = MANUAL_CATEGORIES.map(function (c) {
      return '<option value="' + c.key + '">' + _esc(c.label) + '</option>';
    }).join('');

    var ov = document.createElement('div');
    ov.id = 'ptlOverlay'; ov.className = 'ptl-overlay';
    ov.innerHTML =
      '<div class="ptl-modal" role="dialog" aria-modal="true" aria-label="Add to timeline">' +
        '<div class="ptl-head"><span class="ptl-title">Add to timeline</span>' +
          '<button type="button" class="ptl-x" id="ptlClose" aria-label="Close">✕</button></div>' +
        '<div class="ptl-body">' +
          '<div class="ptl-field"><label class="ptl-label" for="ptlDate">Date</label>' +
            '<input class="ptl-input" type="date" id="ptlDate" value="' + _todayISODate() + '"></div>' +
          '<div class="ptl-field"><label class="ptl-label" for="ptlCat">Category</label>' +
            '<select class="ptl-input" id="ptlCat">' + catOpts + '</select></div>' +
          '<div class="ptl-field"><label class="ptl-label" for="ptlTitle">What happened</label>' +
            '<input class="ptl-input" id="ptlTitle" maxlength="140" placeholder="e.g. Roof leak patched — Bldg C"></div>' +
          '<div class="ptl-field"><label class="ptl-label" for="ptlNotes">Notes (optional)</label>' +
            '<textarea class="ptl-input ptl-textarea" id="ptlNotes" rows="2" maxlength="600" placeholder="Vendor, details, what was agreed…"></textarea></div>' +
          '<div class="ptl-field"><span class="ptl-label">Responsibility</span>' +
            '<div class="ptl-radios" id="ptlResp">' +
              _radio('landlord', 'Landlord') + _radio('tenant', 'Tenant') +
              _radio('shared', 'Shared') + _radio('na', 'N/A', true) +
            '</div></div>' +
          '<div class="ptl-field"><label class="ptl-label" for="ptlLease">Lease reference (optional)</label>' +
            '<input class="ptl-input" id="ptlLease" maxlength="120" placeholder="e.g. §7.2 Roof &amp; Structure"></div>' +
          '<div class="ptl-field"><span class="ptl-label">Attachments</span>' +
            '<div class="ptl-file-btns">' +
              '<button type="button" class="ptl-file-btn" id="ptlAddInvoice">+ Invoice</button>' +
              '<button type="button" class="ptl-file-btn" id="ptlAddPdf">+ PDF</button>' +
              '<button type="button" class="ptl-file-btn" id="ptlAddPhoto">+ Photo</button>' +
            '</div><div class="ptl-file-list" id="ptlFileList"></div></div>' +
        '</div>' +
        '<div class="ptl-actions">' +
          '<button type="button" class="ptl-btn" id="ptlCancel">Cancel</button>' +
          '<button type="button" class="ptl-btn ptl-btn--primary" id="ptlSave">Save entry</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    document.getElementById('ptlClose').onclick = closeModal;
    document.getElementById('ptlCancel').onclick = closeModal;
    document.getElementById('ptlAddInvoice').onclick = function () { _pickFiles('invoice', 'application/pdf,image/*'); };
    document.getElementById('ptlAddPdf').onclick = function () { _pickFiles('pdf', 'application/pdf'); };
    document.getElementById('ptlAddPhoto').onclick = function () { _pickFiles('photo', 'image/*'); };
    document.getElementById('ptlSave').onclick = function () { _save(property); };
    setTimeout(function () { var el = document.getElementById('ptlTitle'); if (el) el.focus(); }, 40);
  }

  function _radio(val, label, checked) {
    return '<label class="ptl-radio"><input type="radio" name="ptlResp" value="' + val + '"' +
      (checked ? ' checked' : '') + '><span>' + _esc(label) + '</span></label>';
  }

  async function _save(property) {
    var btn = document.getElementById('ptlSave');
    var title = (document.getElementById('ptlTitle').value || '').trim();
    if (!title) {
      var ti = document.getElementById('ptlTitle');
      ti.classList.add('ptl-input--err'); ti.focus();
      setTimeout(function () { ti.classList.remove('ptl-input--err'); }, 1500);
      return;
    }
    var category = document.getElementById('ptlCat').value || 'note';
    var notes    = (document.getElementById('ptlNotes').value || '').trim();
    var leaseRef = (document.getElementById('ptlLease').value || '').trim();
    var dateVal  = (document.getElementById('ptlDate').value || '').trim();
    var respEl   = document.querySelector('input[name="ptlResp"]:checked');
    var responsibility = respEl ? respEl.value : 'na';

    var timestamp;
    try { timestamp = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : new Date().toISOString(); }
    catch (_) { timestamp = new Date().toISOString(); }

    // Upload attachments (reuse the app's upload path). Failures are surfaced,
    // never silently dropped — the entry still saves with whatever succeeded.
    var attachments = [], failed = 0;
    if (_pending.length) {
      if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
      for (var i = 0; i < _pending.length; i++) {
        var p = _pending[i];
        try {
          var res = (window.uploadInvoiceFile) ? await window.uploadInvoiceFile(p.file) : { url: null, error: 'no-uploader' };
          if (res && res.url) attachments.push({ name: p.name, url: res.url, kind: p.kind });
          else failed++;
        } catch (_e) { failed++; }
      }
    }

    if (window.appendPropertyTimelineEvent) {
      window.appendPropertyTimelineEvent(property, {
        manual: true,
        type: 'manual_' + category,
        category: category,
        severity: 'info',
        title: title,
        description: notes,
        timestamp: timestamp,
        responsibility: responsibility,
        leaseRef: leaseRef,
        attachments: attachments,
        actor: 'Property Manager',
      });
    }
    try { if (window.savePropertyData) await window.savePropertyData(); } catch (_e) {}
    try { if (window.renderPropertyActivity) window.renderPropertyActivity(property); } catch (_e) {}

    closeModal();
    if (failed) _toast('Entry saved — ' + failed + ' attachment' + (failed !== 1 ? 's' : '') + " couldn't upload", 'err');
    else _toast('Added to timeline', 'ok');
  }

  // ── Styles (design tokens; matches the existing timeline look) ──────────────
  function injectStyles() {
    if (document.getElementById('ptl-styles')) return;
    var gold = '#C9973A';
    var css = [
      // header add button + timeline enhancements
      '.tl-add-btn{font:700 0.72rem/1 inherit;color:' + gold + ';background:rgba(201,151,58,0.12);border:1px solid rgba(201,151,58,0.4);border-radius:7px;padding:5px 10px;cursor:pointer;margin-right:8px;}',
      '.tl-add-btn:hover{background:rgba(201,151,58,0.2);}',
      '.tl-day-divider{font-size:0.68rem;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-4,#64748B);margin:14px 0 6px;padding-bottom:3px;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.07);}',
      '.tl-resp{font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;border-radius:5px;padding:2px 6px;margin-left:6px;white-space:nowrap;}',
      '.tl-resp--landlord{color:#7dd3fc;background:rgba(125,211,252,0.14);border:1px solid rgba(125,211,252,0.35);}',
      '.tl-resp--tenant{color:#fbbf24;background:rgba(251,191,36,0.14);border:1px solid rgba(251,191,36,0.35);}',
      '.tl-resp--shared{color:#a78bfa;background:rgba(167,139,250,0.14);border:1px solid rgba(167,139,250,0.35);}',
      '.tl-refline{margin-top:4px;}',
      '.tl-lease-ref{display:inline-block;font-size:0.72rem;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.05);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:6px;padding:2px 7px;}',
      '.tl-attachments{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;}',
      '.tl-attach{display:inline-flex;align-items:center;font-size:0.74rem;color:var(--text-2,#CBD5E1);text-decoration:none;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.12);border-radius:7px;padding:5px 9px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.tl-attach:hover{border-color:' + gold + ';}',
      '.tl-attach--photo{padding:0;border:none;background:none;}',
      '.tl-thumb{width:46px;height:46px;object-fit:cover;border-radius:8px;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);display:block;}',
      // modal
      '.ptl-overlay{position:fixed;inset:0;z-index:99800;background:rgba(0,0,0,0.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px;}',
      '.ptl-modal{width:100%;max-width:460px;background:var(--theme-card,#0F1217);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,0.6);overflow:hidden;}',
      '.ptl-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.08);}',
      '.ptl-title{font-size:0.98rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.ptl-x{margin-left:auto;background:none;border:none;color:var(--text-3,#94A3B8);font-size:1.05rem;cursor:pointer;padding:2px 6px;}',
      '.ptl-body{padding:14px 16px;max-height:70vh;overflow-y:auto;}',
      '.ptl-field{margin-bottom:12px;}',
      '.ptl-label{display:block;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--text-4,#64748B);margin-bottom:5px;}',
      '.ptl-input{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;font:0.85rem inherit;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);color:var(--text-1,#E2E8F0);}',
      '.ptl-input:focus{outline:none;border-color:' + gold + ';}',
      '.ptl-input--err{border-color:#ef4444;}',
      '.ptl-textarea{resize:vertical;min-height:44px;}',
      '.ptl-radios{display:flex;flex-wrap:wrap;gap:8px;}',
      '.ptl-radio{display:inline-flex;align-items:center;gap:5px;font-size:0.8rem;color:var(--text-2,#CBD5E1);background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:8px;padding:6px 10px;cursor:pointer;}',
      '.ptl-radio input{accent-color:' + gold + ';}',
      '.ptl-file-btns{display:flex;flex-wrap:wrap;gap:8px;}',
      '.ptl-file-btn{font:700 0.76rem/1 inherit;color:var(--text-2,#CBD5E1);background:var(--theme-panel,#0A0D12);border:1px dashed rgba(var(--line-rgb,255,255,255),0.24);border-radius:8px;padding:8px 12px;cursor:pointer;}',
      '.ptl-file-btn:hover{border-color:' + gold + ';color:var(--text-1,#E2E8F0);}',
      '.ptl-file-list{margin-top:8px;display:flex;flex-direction:column;gap:6px;}',
      '.ptl-file{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:0.78rem;color:var(--text-2,#CBD5E1);background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:7px;padding:6px 9px;}',
      '.ptl-file-x{background:none;border:none;color:var(--text-4,#64748B);cursor:pointer;font-size:0.85rem;}',
      '.ptl-actions{display:flex;gap:10px;padding:14px 16px;border-top:1px solid rgba(var(--line-rgb,255,255,255),0.08);}',
      '.ptl-btn{flex:1;min-height:42px;border-radius:9px;font:700 0.85rem/1 inherit;cursor:pointer;border:1px solid rgba(var(--line-rgb,255,255,255),0.16);background:var(--theme-panel,#0A0D12);color:var(--text-2,#CBD5E1);}',
      '.ptl-btn--primary{background:' + gold + ';color:#07090C;border-color:' + gold + ';}',
      '.ptl-btn--primary:disabled{opacity:0.6;cursor:default;}',
      '.ptl-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99900;padding:11px 16px;border-radius:9px;font-size:0.82rem;font-weight:700;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.4);transition:opacity 0.5s;max-width:90vw;text-align:center;}',
      '.ptl-toast--ok{background:#166534;}.ptl-toast--err{background:#7f1d1d;}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'ptl-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  // Inject styles at load so the enhanced renderer looks right immediately.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectStyles);
  else injectStyles();

  return {
    registerType: registerType,
    describe: describe,
    openAddEntry: openAddEntry,
    closeModal: closeModal,
    categories: MANUAL_CATEGORIES,
    _registry: REGISTRY,
  };
})();
