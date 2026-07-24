/**
 * property-timeline.js — Property Timeline v1 (Phase 2)
 * ============================================================================
 * The manager-facing layer on top of MainStreet's existing timeline engine.
 * Adds: an extensible event-type registry, an add/edit entry modal (manual
 * logbook entries with responsibility, optional lease reference, and
 * invoice/PDF/photo attachments), and the styles for the enhanced timeline view.
 *
 * Reuses (never re-implements): the event store + persistence
 * (appendPropertyTimelineEvent / savePropertyData / property.timeline blob), the
 * renderer (renderPropertyActivity), the upload path (uploadInvoiceFile →
 * /api/upload), and esc() — all globals from script.js. Loaded AFTER script.js.
 *
 * Extensibility: future modules become timeline events via
 *   PropertyTimeline.registerType(type, { label, icon, group })
 * plus appendPropertyTimelineEvent(...). No renderer changes required.
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
  var REGISTRY = {};
  function registerType(key, def) {
    if (!key || !def) return;
    REGISTRY[key] = { label: def.label || key, icon: def.icon || null, group: def.group || 'system' };
  }

  // Manager-authored categories (the logbook) — property-management taxonomy.
  var MANUAL_CATEGORIES = [
    { key: 'maintenance',         label: 'Maintenance',         icon: '\u{1F527}' },        // 🔧
    { key: 'repair',              label: 'Repair',              icon: '\u{1F6E0}\u{FE0F}' },// 🛠️
    { key: 'lease',               label: 'Lease',               icon: '\u{1F4C4}' },        // 📄
    { key: 'cam',                 label: 'CAM',                 icon: '\u{1F4CA}' },        // 📊
    { key: 'insurance',           label: 'Insurance',           icon: '\u{1F6E1}\u{FE0F}' },// 🛡️
    { key: 'vendor',              label: 'Vendor',              icon: '\u{1F69A}' },        // 🚚
    { key: 'tenant',              label: 'Tenant',              icon: '\u{1F464}' },        // 👤
    { key: 'payment',             label: 'Payment',             icon: '\u{1F4B5}' },        // 💵
    { key: 'inspection',          label: 'Inspection',          icon: '\u{1F50D}' },        // 🔍
    { key: 'capital_improvement', label: 'Capital Improvement', icon: '\u{1F3D7}\u{FE0F}' },// 🏗️
    { key: 'other',               label: 'Other',               icon: '\u{1F4CC}' },        // 📌
  ];
  MANUAL_CATEGORIES.forEach(function (c) { registerType(c.key, { label: c.label, icon: c.icon, group: 'manual' }); });

  // Existing auto types (so they render through the same registry path).
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

  function describe(ev) {
    if (!ev) return { label: '', icon: null };
    var key = ev.manual ? (ev.category || String(ev.type || '').replace(/^manual_/, '')) : ev.type;
    var def = REGISTRY[key] || REGISTRY[String(ev.type || '').replace(/^manual_/, '')];
    if (def) return { label: def.label, icon: def.icon };
    return { label: (ev.category || ev.type || ''), icon: null };
  }

  function _groupOf(ev) {
    var key = ev && ev.manual ? (ev.category || String(ev.type || '').replace(/^manual_/, '')) : (ev && ev.type);
    var def = REGISTRY[key];
    return def ? def.group : 'system';
  }

  // ── Timeline as the map: every event links to its source pane ────────────────
  // (Connected Property Workspace, move #1.) Reuses switchWorkspaceTab + _ccFlashEl.
  var GROUP_NAV = {
    cam:      { tab: 'cam',       anchors: ['results', 'cardInvoices'] },
    disputes: { tab: 'cam',       anchors: ['disputeSection', 'openDisputesWrap'] },
    leases:   { tab: 'documents', anchors: ['cardLeases'] },
  };
  // Returns { tab, anchors } for events whose source lives in a pane, else null
  // (manual notes and system events are their own record — no "View").
  function navFor(ev) {
    if (!ev) return null;
    return GROUP_NAV[_groupOf(ev)] || null;
  }
  function viewSource(id) {
    var p = window.currentProperty && window.currentProperty();
    if (!p) return;
    var ev = (p.timeline || []).find(function (x) { return x.id === id; });
    var nav = navFor(ev);
    if (!nav) return;
    try { if (window.switchWorkspaceTab) window.switchWorkspaceTab(nav.tab); } catch (_e) {}
    var el = null, any = null;
    for (var i = 0; i < nav.anchors.length; i++) {
      var cand = document.getElementById(nav.anchors[i]);
      if (cand && !any) any = cand;
      if (cand && cand.offsetParent !== null) { el = cand; break; }
    }
    el = el || any;
    try { if (el && window._ccFlashEl) window._ccFlashEl(el); } catch (_e) {}
  }

  // ── Add / edit entry modal ──────────────────────────────────────────────────
  // Unified attachment list: existing items carry a url; new items carry a File.
  var _attachments = []; // [{ existing:true, name, url, kind } | { file, kind, name }]

  function _todayISODate() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function _isoToDateInput(iso) {
    try { var d = new Date(iso); if (isNaN(d)) return _todayISODate();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    catch (_) { return _todayISODate(); }
  }

  function _toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'ptl-toast ptl-toast--' + (kind || 'ok');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 2600);
    setTimeout(function () { t.remove(); }, 3200);
  }

  function _renderAttList() {
    var box = document.getElementById('ptlFileList');
    if (!box) return;
    box.innerHTML = _attachments.map(function (a, i) {
      var ic = a.kind === 'photo' ? '\u{1F5BC}\u{FE0F}' : (a.kind === 'invoice' ? '\u{1F9FE}' : '\u{1F4C4}');
      var badge = a.existing ? '' : ' <span class="ptl-file-new">new</span>';
      return '<div class="ptl-file"><span class="ptl-file-name">' + ic + '&nbsp;' + _esc(a.name) + badge + '</span>' +
        '<button type="button" class="ptl-file-x" data-i="' + i + '" aria-label="Remove">✕</button></div>';
    }).join('');
    box.querySelectorAll('.ptl-file-x').forEach(function (b) {
      b.onclick = function () { _attachments.splice(Number(b.getAttribute('data-i')), 1); _renderAttList(); };
    });
  }

  function _pickFiles(kind, accept) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = true; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = function () {
      Array.prototype.forEach.call(inp.files || [], function (f) { _attachments.push({ file: f, kind: kind, name: f.name }); });
      _renderAttList(); inp.remove();
    };
    inp.click();
  }

  function _syncSave() {
    var t = document.getElementById('ptlTitle'), s = document.getElementById('ptlSave');
    if (t && s) s.disabled = !(t.value || '').trim();
  }

  function closeModal() {
    var ov = document.getElementById('ptlOverlay');
    if (ov) ov.remove();
    _attachments = [];
  }

  function openEditEntry(id) {
    var p = window.currentProperty && window.currentProperty();
    if (!p) return;
    var e = (p.timeline || []).find(function (x) { return x.id === id; });
    if (!e) { _toast('Entry not found', 'err'); return; }
    if (!e.manual) { _toast('Only manager entries can be edited', 'err'); return; }
    openAddEntry(p, e);
  }

  function openAddEntry(property, existing) {
    property = property || (window.currentProperty && window.currentProperty());
    if (!property) { _toast('Open a property first', 'err'); return; }
    if (document.getElementById('ptlOverlay')) return;
    injectStyles();

    var isEdit = !!(existing && existing.id);
    _attachments = isEdit && Array.isArray(existing.attachments)
      ? existing.attachments.map(function (a) { return { existing: true, name: a.name, url: a.url, kind: a.kind }; })
      : [];

    var curCat = isEdit ? (existing.category || 'other') : 'maintenance';
    var catOpts = MANUAL_CATEGORIES.map(function (c) {
      return '<option value="' + c.key + '"' + (c.key === curCat ? ' selected' : '') + '>' + _esc(c.label) + '</option>';
    }).join('');
    var curResp = isEdit ? (existing.responsibility || 'na') : 'na';
    var curTitle = isEdit ? (existing.title || '') : '';
    var curNotes = isEdit ? (existing.description || '') : '';
    var curLease = isEdit ? (existing.leaseRef || '') : '';
    var curDate  = isEdit ? _isoToDateInput(existing.timestamp) : _todayISODate();

    var ov = document.createElement('div');
    ov.id = 'ptlOverlay'; ov.className = 'ptl-overlay';
    ov.innerHTML =
      '<div class="ptl-modal" role="dialog" aria-modal="true" aria-label="' + (isEdit ? 'Edit timeline entry' : 'Add to timeline') + '">' +
        '<div class="ptl-head"><span class="ptl-title">' + (isEdit ? 'Edit timeline entry' : 'Add to timeline') + '</span>' +
          '<button type="button" class="ptl-x" id="ptlClose" aria-label="Close">✕</button></div>' +
        '<div class="ptl-body">' +
          // 1. What happened (first — it's what a PM thinks of first)
          '<div class="ptl-field"><label class="ptl-label" for="ptlTitle">What happened</label>' +
            '<input class="ptl-input" id="ptlTitle" maxlength="140" placeholder="e.g. Roof leak patched — Bldg C, Suite 210" value="' + _esc(curTitle) + '"></div>' +
          // 2. Category
          '<div class="ptl-field"><label class="ptl-label" for="ptlCat">Category</label>' +
            '<select class="ptl-input" id="ptlCat">' + catOpts + '</select></div>' +
          // 3. Date
          '<div class="ptl-field"><label class="ptl-label" for="ptlDate">Date</label>' +
            '<input class="ptl-input" type="date" id="ptlDate" value="' + curDate + '"></div>' +
          // 4. Responsibility
          '<div class="ptl-field"><span class="ptl-label">Responsibility</span>' +
            '<div class="ptl-radios" id="ptlResp">' +
              _radio('landlord', 'Landlord', curResp === 'landlord') + _radio('tenant', 'Tenant', curResp === 'tenant') +
              _radio('shared', 'Shared', curResp === 'shared') + _radio('na', 'N/A', curResp === 'na' || !curResp) +
            '</div></div>' +
          // 5. Lease reference
          '<div class="ptl-field"><label class="ptl-label" for="ptlLease">Lease reference (optional)</label>' +
            '<input class="ptl-input" id="ptlLease" maxlength="120" placeholder="e.g. §7.2 Roof &amp; Structure" value="' + _esc(curLease) + '"></div>' +
          // 6. Notes
          '<div class="ptl-field"><label class="ptl-label" for="ptlNotes">Notes (optional)</label>' +
            '<textarea class="ptl-input ptl-textarea" id="ptlNotes" rows="2" maxlength="600" placeholder="Vendor, details, what was agreed…">' + _esc(curNotes) + '</textarea></div>' +
          // 7. Attachments
          '<div class="ptl-field"><span class="ptl-label">Attachments</span>' +
            '<div class="ptl-file-btns">' +
              '<button type="button" class="ptl-file-btn" id="ptlAddInvoice">+ Invoice</button>' +
              '<button type="button" class="ptl-file-btn" id="ptlAddPdf">+ PDF</button>' +
              '<button type="button" class="ptl-file-btn" id="ptlAddPhoto">+ Photo</button>' +
            '</div><div class="ptl-file-list" id="ptlFileList"></div></div>' +
        '</div>' +
        '<div class="ptl-actions">' +
          '<button type="button" class="ptl-btn" id="ptlCancel">Cancel</button>' +
          '<button type="button" class="ptl-btn ptl-btn--primary" id="ptlSave"' + (curTitle.trim() ? '' : ' disabled') + '>' +
            (isEdit ? 'Save changes' : 'Save entry') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    _renderAttList();

    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    document.getElementById('ptlClose').onclick = closeModal;
    document.getElementById('ptlCancel').onclick = closeModal;
    document.getElementById('ptlAddInvoice').onclick = function () { _pickFiles('invoice', 'application/pdf,image/*'); };
    document.getElementById('ptlAddPdf').onclick = function () { _pickFiles('pdf', 'application/pdf'); };
    document.getElementById('ptlAddPhoto').onclick = function () { _pickFiles('photo', 'image/*'); };
    document.getElementById('ptlTitle').addEventListener('input', _syncSave);
    document.getElementById('ptlSave').onclick = function () { _save(property, isEdit ? existing : null); };
    _syncSave();
    setTimeout(function () { var el = document.getElementById('ptlTitle'); if (el) el.focus(); }, 40);
  }

  function _radio(val, label, checked) {
    return '<label class="ptl-radio"><input type="radio" name="ptlResp" value="' + val + '"' +
      (checked ? ' checked' : '') + '><span>' + _esc(label) + '</span></label>';
  }

  async function _save(property, existing) {
    var btn = document.getElementById('ptlSave');
    var title = (document.getElementById('ptlTitle').value || '').trim();
    if (!title) { _syncSave(); return; } // Save is disabled anyway; guard for safety
    var category = document.getElementById('ptlCat').value || 'other';
    var notes    = (document.getElementById('ptlNotes').value || '').trim();
    var leaseRef = (document.getElementById('ptlLease').value || '').trim() || null;
    var dateVal  = (document.getElementById('ptlDate').value || '').trim();
    var respEl   = document.querySelector('input[name="ptlResp"]:checked');
    var responsibility = respEl ? respEl.value : 'na';

    var timestamp;
    try { timestamp = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : new Date().toISOString(); }
    catch (_) { timestamp = new Date().toISOString(); }

    // Resolve attachments: keep existing (already uploaded), upload new files.
    var finalAtt = [], failed = 0;
    if (_attachments.length) {
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      for (var i = 0; i < _attachments.length; i++) {
        var a = _attachments[i];
        if (a.existing && a.url) { finalAtt.push({ name: a.name, url: a.url, kind: a.kind }); continue; }
        try {
          var res = (window.uploadInvoiceFile) ? await window.uploadInvoiceFile(a.file) : { url: null };
          if (res && res.url) finalAtt.push({ name: a.name, url: res.url, kind: a.kind });
          else failed++;
        } catch (_e) { failed++; }
      }
    }

    if (existing && existing.id) {
      // Edit in place — same modal, complete the workflow.
      var target = (property.timeline || []).find(function (x) { return x.id === existing.id; });
      if (target) {
        target.title = title;
        target.description = notes;
        target.category = category;
        target.type = 'manual_' + category;
        target.timestamp = timestamp;
        target.responsibility = (['landlord', 'tenant', 'shared', 'na'].indexOf(responsibility) >= 0 ? responsibility : 'na');
        target.leaseRef = leaseRef;
        target.attachments = finalAtt;
        target.manual = true;
      }
    } else if (window.appendPropertyTimelineEvent) {
      window.appendPropertyTimelineEvent(property, {
        manual: true, type: 'manual_' + category, category: category, severity: 'info',
        title: title, description: notes, timestamp: timestamp,
        responsibility: responsibility, leaseRef: leaseRef, attachments: finalAtt,
        actor: 'Property Manager',
      });
    }

    try { if (window.savePropertyData) await window.savePropertyData(); } catch (_e) {}
    try { if (window.renderPropertyActivity) window.renderPropertyActivity(property); } catch (_e) {}

    closeModal();
    if (failed) _toast('Saved — ' + failed + ' attachment' + (failed !== 1 ? 's' : '') + " couldn't upload", 'err');
    else _toast(existing ? 'Entry updated' : 'Added to timeline', 'ok');
  }

  // ── Styles (design tokens; mobile-polished) ─────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ptl-styles')) return;
    var gold = '#C9973A';
    var css = [
      '.tl-add-btn{font:700 0.72rem/1 inherit;color:' + gold + ';background:rgba(201,151,58,0.12);border:1px solid rgba(201,151,58,0.4);border-radius:7px;padding:6px 11px;cursor:pointer;margin-right:8px;min-height:30px;}',
      '.tl-add-btn:hover{background:rgba(201,151,58,0.2);}',
      '.tl-edit-btn{font:600 0.68rem/1 inherit;color:var(--text-4,#64748B);background:none;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:6px;padding:4px 8px;cursor:pointer;min-height:26px;}',
      '.tl-edit-btn:hover{color:' + gold + ';border-color:' + gold + ';}',
      '.tl-view-btn{font:600 0.68rem/1 inherit;color:var(--text-3,#94A3B8);background:none;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:6px;padding:4px 8px;cursor:pointer;min-height:26px;margin-left:auto;}',
      '.tl-view-btn:hover{color:' + gold + ';border-color:' + gold + ';}',
      '.tl-day-divider{font-size:0.68rem;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-4,#64748B);margin:14px 0 6px;padding-bottom:3px;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.07);}',
      '.tl-resp{font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;border-radius:5px;padding:2px 6px;margin-left:6px;white-space:nowrap;}',
      '.tl-resp--landlord{color:#7dd3fc;background:rgba(125,211,252,0.14);border:1px solid rgba(125,211,252,0.35);}',
      '.tl-resp--tenant{color:#fbbf24;background:rgba(251,191,36,0.14);border:1px solid rgba(251,191,36,0.35);}',
      '.tl-resp--shared{color:#a78bfa;background:rgba(167,139,250,0.14);border:1px solid rgba(167,139,250,0.35);}',
      '.tl-refline{margin-top:4px;}',
      '.tl-lease-ref{display:inline-block;font-size:0.72rem;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.05);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:6px;padding:2px 7px;}',
      '.tl-attachments{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;}',
      '.tl-attach{display:inline-flex;align-items:center;font-size:0.74rem;color:var(--text-2,#CBD5E1);text-decoration:none;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.12);border-radius:7px;padding:6px 10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:34px;box-sizing:border-box;}',
      '.tl-attach:hover{border-color:' + gold + ';}',
      '.tl-attach--photo{padding:0;border:none;background:none;min-height:0;}',
      '.tl-thumb{width:46px;height:46px;object-fit:cover;border-radius:8px;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);display:block;}',
      // modal
      '.ptl-overlay{position:fixed;inset:0;z-index:99800;background:rgba(0,0,0,0.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 12px;-webkit-overflow-scrolling:touch;}',
      '.ptl-modal{width:100%;max-width:460px;margin:auto;background:var(--theme-card,#0F1217);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,0.6);overflow:hidden;}',
      '.ptl-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.08);}',
      '.ptl-title{font-size:0.98rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.ptl-x{margin-left:auto;background:none;border:none;color:var(--text-3,#94A3B8);font-size:1.05rem;cursor:pointer;padding:4px 8px;min-height:34px;min-width:34px;}',
      '.ptl-body{padding:14px 16px;max-height:70vh;overflow-y:auto;-webkit-overflow-scrolling:touch;}',
      '.ptl-field{margin-bottom:13px;}',
      '.ptl-label{display:block;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--text-4,#64748B);margin-bottom:5px;}',
      '.ptl-input{width:100%;box-sizing:border-box;padding:10px 11px;border-radius:8px;font:0.9rem inherit;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);color:var(--text-1,#E2E8F0);}',
      '.ptl-input:focus{outline:none;border-color:' + gold + ';}',
      '.ptl-textarea{resize:vertical;min-height:46px;}',
      '.ptl-radios{display:flex;flex-wrap:wrap;gap:8px;}',
      '.ptl-radio{display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;color:var(--text-2,#CBD5E1);background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:8px;padding:9px 12px;cursor:pointer;min-height:40px;box-sizing:border-box;}',
      '.ptl-radio input{accent-color:' + gold + ';width:16px;height:16px;}',
      '.ptl-file-btns{display:flex;flex-wrap:wrap;gap:8px;}',
      '.ptl-file-btn{font:700 0.78rem/1 inherit;color:var(--text-2,#CBD5E1);background:var(--theme-panel,#0A0D12);border:1px dashed rgba(var(--line-rgb,255,255,255),0.24);border-radius:8px;padding:10px 13px;cursor:pointer;min-height:40px;}',
      '.ptl-file-btn:hover{border-color:' + gold + ';color:var(--text-1,#E2E8F0);}',
      '.ptl-file-list{margin-top:8px;display:flex;flex-direction:column;gap:6px;}',
      '.ptl-file{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:0.78rem;color:var(--text-2,#CBD5E1);background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:7px;padding:8px 10px;}',
      '.ptl-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ptl-file-new{font-size:0.6rem;font-weight:800;text-transform:uppercase;color:' + gold + ';margin-left:4px;}',
      '.ptl-file-x{background:none;border:none;color:var(--text-4,#64748B);cursor:pointer;font-size:0.9rem;padding:4px 6px;min-height:30px;flex:none;}',
      '.ptl-actions{display:flex;gap:10px;padding:14px 16px;border-top:1px solid rgba(var(--line-rgb,255,255,255),0.08);}',
      '.ptl-btn{flex:1;min-height:44px;border-radius:9px;font:700 0.88rem/1 inherit;cursor:pointer;border:1px solid rgba(var(--line-rgb,255,255,255),0.16);background:var(--theme-panel,#0A0D12);color:var(--text-2,#CBD5E1);}',
      '.ptl-btn--primary{background:' + gold + ';color:#07090C;border-color:' + gold + ';}',
      '.ptl-btn--primary:disabled{opacity:0.45;cursor:default;}',
      '.ptl-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99900;padding:11px 16px;border-radius:9px;font-size:0.82rem;font-weight:700;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.4);transition:opacity 0.5s;max-width:90vw;text-align:center;}',
      '.ptl-toast--ok{background:#166534;}.ptl-toast--err{background:#7f1d1d;}',
      // Mobile polish — no redesign, just spacing / tap targets / no iOS zoom.
      '@media (max-width:480px){',
      '  .ptl-overlay{padding:10px 8px;}',
      '  .ptl-modal{max-width:100%;border-radius:12px;}',
      '  .ptl-body{max-height:64vh;padding:13px 13px;}',
      '  .ptl-field{margin-bottom:15px;}',
      '  .ptl-input{font-size:16px;}',            /* 16px stops iOS from zooming on focus */
      '  .ptl-radio{flex:1 1 42%;justify-content:center;padding:11px 8px;}',
      '  .ptl-file-btn{flex:1 1 auto;text-align:center;padding:12px 10px;}',
      '  .ptl-actions{padding:12px 13px;}',
      '  .ptl-btn{min-height:48px;}',
      '  .tl-attach{max-width:150px;}',
      '  .tl-add-btn{min-height:34px;}',
      '}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'ptl-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectStyles);
  else injectStyles();

  return {
    registerType: registerType,
    describe: describe,
    navFor: navFor,
    viewSource: viewSource,
    openAddEntry: openAddEntry,
    openEditEntry: openEditEntry,
    closeModal: closeModal,
    categories: MANUAL_CATEGORIES,
    _registry: REGISTRY,
  };
})();
