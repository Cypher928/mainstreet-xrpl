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
    // Building-level records. These are what makes the Property tab the
    // operating system for the building rather than a report about it — and
    // they are CATEGORIES on the one timeline, not new stores. Adding an
    // entry here is the whole of "supporting Real Estate Taxes"; nothing else
    // needs to know.
    { key: 'real_estate_taxes',   label: 'Real Estate Taxes',   icon: '\u{1F3DB}\u{FE0F}' },// 🏛️
    { key: 'mortgage_financing',  label: 'Mortgage / Financing',icon: '\u{1F3E6}' },        // 🏦
    { key: 'survey',              label: 'Survey',              icon: '\u{1F4CF}' },        // 📏
    { key: 'site_plan',           label: 'Site Plan',           icon: '\u{1F5FA}\u{FE0F}' },// 🗺️
    { key: 'building_plan',       label: 'Building Plan',       icon: '\u{1F4D0}' },        // 📐
    { key: 'environmental',       label: 'Environmental Report',icon: '\u{1F33F}' },        // 🌿
    { key: 'building_photo',      label: 'Building Photo',      icon: '\u{1F5BC}\u{FE0F}' },// 🖼️
    { key: 'warranty',            label: 'Warranty',            icon: '\u{1F6E1}\u{FE0F}' },// 🛡️
    { key: 'other',               label: 'Other',               icon: '\u{1F4CC}' },        // 📌
  ];

  // Categories that describe the BUILDING rather than a tenancy. Used by the
  // Property Records filter; a category absent from this list still works, it
  // just is not offered as a building-level filter chip.
  var PROPERTY_CATEGORIES = ['real_estate_taxes', 'insurance', 'mortgage_financing', 'survey',
    'site_plan', 'building_plan', 'environmental', 'capital_improvement', 'building_photo',
    'warranty', 'inspection', 'vendor'];
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
    // Workspace move #2 — the real workflows become part of the property's story.
    ['cam_reconciled', 'CAM', '\u{1F4CA}', 'cam'],
    ['document_uploaded', 'Document', '\u{1F4C4}', 'leases'],
    ['reserve_updated', 'Reserve', '\u{1F3E6}', 'reserves'],
    ['settlement_completed', 'Settlement', '\u{1F4B8}', 'system'],
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
    leases:   { tab: 'spaces',    anchors: ['cardLeases','spacesSection'] },
    reserves: { tab: 'reserves',  anchors: ['escrowSection'] },
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
      var ic = a.kind === 'photo' ? '\u{1F5BC}\u{FE0F}' : (a.kind === 'invoice' ? '\u{1F9FE}' : (a.kind === 'warranty' ? '\u{1F6E1}\u{FE0F}' : '\u{1F4C4}'));
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

  // The signed-in user, by the same route the Space workspace uses.
  function _who() {
    try {
      var u = window.AuthService && AuthService.getCurrentUser && AuthService.getCurrentUser();
      return (u && (u.email || u.name)) || 'Property Manager';
    } catch (_) { return 'Property Manager'; }
  }

  // Human labels for the fields a revision can report, so the history reads as
  // sentences rather than as property names.
  var FIELD_LABEL = {
    title: 'Title', description: 'Notes', category: 'Category', timestamp: 'Date',
    responsibility: 'Responsibility', leaseRef: 'Lease reference', subject: 'Attached to',
  };

  function _subjectLabel(sub) {
    if (!sub || sub.type === 'property') return 'Property-wide';
    if (sub.type === 'system') {
      return (window.PropertyOS && PropertyOS.systemLabel && PropertyOS.systemLabel(sub.id)) || sub.id;
    }
    return sub.label || sub.id || String(sub.type);
  }

  function _fieldValue(ev, k) {
    if (k === 'subject') return _subjectLabel(ev.subject);
    if (k === 'timestamp') return _isoToDateInput(ev.timestamp);
    if (k === 'category') return (describe({ category: ev.category, type: ev.type }) || {}).label || ev.category;
    return ev[k];
  }

  /**
   * Append-only edit. Returns true if anything actually changed.
   *
   * Attachment REMOVAL is recorded, not silently applied: a document that was
   * on the record yesterday and is gone today is exactly the kind of thing the
   * timeline exists to still know about. The file reference survives in the
   * revision even though it leaves the current attachment list.
   */
  function _amendEvent(ev, next, finalAtt) {
    if (!Array.isArray(ev.revisions) || !ev.revisions.length) {
      ev.revisions = [{
        at: ev.timestamp,
        by: (ev.metadata && ev.metadata.recordedBy) || ev.actor || 'Unknown',
        action: 'created',
        snapshot: {
          title: ev.title, description: ev.description, category: ev.category,
          timestamp: ev.timestamp, responsibility: ev.responsibility,
          leaseRef: ev.leaseRef, subject: ev.subject ? Object.assign({}, ev.subject) : null,
          attachments: (ev.attachments || []).map(function (a) { return { name: a.name, url: a.url, kind: a.kind }; }),
        },
      }];
    }

    var rev = { at: new Date().toISOString(), by: _who(), action: 'amended', changes: [] };

    Object.keys(next).forEach(function (k) {
      if (k === 'tenantId') { ev.tenantId = next[k]; return; }   // derived, not reported
      var from = _fieldValue(ev, k);
      var applied = next[k];
      var to = k === 'subject' ? _subjectLabel(applied)
             : k === 'timestamp' ? _isoToDateInput(applied)
             : k === 'category' ? ((describe({ category: applied, type: applied }) || {}).label || applied)
             : applied;
      if (String(from == null ? '' : from) === String(to == null ? '' : to)) {
        // Unchanged as far as the user is concerned, but still assign: the raw
        // value may differ in form (an ISO timestamp vs a date input) while the
        // meaning is identical, and we do not want a spurious revision line.
        if (k === 'subject') ev.subject = applied; else if (k !== 'category') ev[k] = applied;
        return;
      }
      rev.changes.push({ field: k, label: FIELD_LABEL[k] || k, from: from == null ? null : String(from), to: to == null ? null : String(to) });
      if (k === 'subject') ev.subject = applied;
      else if (k === 'category') { ev.category = applied; ev.type = 'manual_' + applied; }
      else ev[k] = applied;
    });

    // Attachments: what arrived, and what left.
    var before = (ev.attachments || []);
    var afterUrls = (finalAtt || []).map(function (a) { return a.url; });
    var beforeUrls = before.map(function (a) { return a.url; });
    var added   = (finalAtt || []).filter(function (a) { return beforeUrls.indexOf(a.url) < 0; });
    var removed = before.filter(function (a) { return afterUrls.indexOf(a.url) < 0; });
    if (added.length)   rev.added   = added.map(function (a) { return { name: a.name, url: a.url, kind: a.kind }; });
    if (removed.length) rev.removed = removed.map(function (a) { return { name: a.name, url: a.url, kind: a.kind }; });
    ev.attachments = finalAtt || [];

    ev.manual = true;
    if (!rev.changes.length && !rev.added && !rev.removed) return false;
    ev.revisions.push(rev);
    return true;
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
    // Space (subject) — attach this record to a tenant space; default is the whole property.
    var _spaces = (property.tenants || []).filter(function (t) { return t && (t.tenant_name || t.id); });
    var _curSpace = isEdit ? String((existing.subject && existing.subject.type === 'suite' && existing.subject.id) || existing.tenantId || '') : '';
    var _spaceFieldHtml = _spaces.length
      ? '<div class="ptl-field"><label class="ptl-label" for="ptlSpace">Space (optional)</label>' +
        '<select class="ptl-input" id="ptlSpace"><option value="">Property (all)</option>' +
        _spaces.map(function (t) { return '<option value="' + _esc(t.id) + '"' + (_curSpace === String(t.id) ? ' selected' : '') + '>' + _esc(t.tenant_name || t.id) + '</option>'; }).join('') +
        '</select></div>'
      : '';

    // Building system (subject) — the piece the subject model always supported
    // and the UI never offered. property-os.js has counted
    // subject.type === 'system' events since it shipped; nothing could create
    // one. This is how a warranty gets attached to the Roof.
    //
    // A record has ONE subject. Space and System are mutually exclusive, and
    // choosing one clears the other rather than silently winning — a warranty
    // that claims to be both Suite 210 and the HVAC is not a record anyone can
    // act on.
    var _systems = (window.PropertyOS && PropertyOS.BUILDING_SYSTEMS) || [];
    var _curSys = isEdit ? String((existing.subject && existing.subject.type === 'system' && existing.subject.id) || '') : '';
    var _sysFieldHtml = _systems.length
      ? '<div class="ptl-field"><label class="ptl-label" for="ptlSystem">Building system (optional)</label>' +
        '<select class="ptl-input" id="ptlSystem"><option value="">Not system-specific</option>' +
        _systems.map(function (sy) { return '<option value="' + _esc(sy.key) + '"' + (_curSys === String(sy.key) ? ' selected' : '') + '>' + _esc(sy.label) + '</option>'; }).join('') +
        '</select>' +
        '<div class="ptl-hint" id="ptlSubjHint">Warranties, inspections and repairs belong to a system.</div></div>'
      : '';
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
          _spaceFieldHtml +
          _sysFieldHtml +
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
              '<button type="button" class="ptl-file-btn" id="ptlAddWarranty">+ Warranty</button>' +
              '<button type="button" class="ptl-file-btn" id="ptlAddPhoto">+ Photo</button>' +
              '<button type="button" class="ptl-file-btn" id="ptlAddPdf">+ PDF</button>' +
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
    document.getElementById('ptlAddWarranty').onclick = function () { _pickFiles('warranty', 'application/pdf,image/*'); };
    document.getElementById('ptlAddPdf').onclick = function () { _pickFiles('pdf', 'application/pdf'); };
    document.getElementById('ptlAddPhoto').onclick = function () { _pickFiles('photo', 'image/*'); };
    document.getElementById('ptlTitle').addEventListener('input', _syncSave);

    // One subject per record: picking a Space clears the System and vice versa.
    // Enforced in the form, so the user sees which one they chose rather than
    // discovering later that the other silently won.
    var _sp = document.getElementById('ptlSpace');
    var _sy = document.getElementById('ptlSystem');
    if (_sp && _sy) {
      _sp.addEventListener('change', function () { if (_sp.value) _sy.value = ''; });
      _sy.addEventListener('change', function () { if (_sy.value) _sp.value = ''; });
    }
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
    var spaceEl  = document.getElementById('ptlSpace');
    var spaceId  = spaceEl ? (spaceEl.value || '') : '';
    var spaceLabel = (spaceId && spaceEl && spaceEl.options[spaceEl.selectedIndex]) ? spaceEl.options[spaceEl.selectedIndex].text : '';
    var sysEl    = document.getElementById('ptlSystem');
    var sysId    = sysEl ? (sysEl.value || '') : '';
    var sysLabel = (sysId && window.PropertyOS && PropertyOS.systemLabel) ? PropertyOS.systemLabel(sysId) : '';
    // One subject per record. A space wins if somehow both are set, because the
    // space is the narrower claim — but the form clears the other on change, so
    // this is a guard rather than a policy.
    var subject  = spaceId ? { type: 'suite', id: spaceId, label: spaceLabel }
                 : (sysId ? { type: 'system', id: sysId, label: sysLabel } : null);

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
      // AMEND, never overwrite. This used to assign straight onto the event —
      // target.title = title — so an edit destroyed what the record previously
      // said, on a timeline whose entire purpose is being the building's
      // verified memory. ARCHITECTURE_PRINCIPLES §6.
      //
      // Same shape as the Space workspace's _amend(): revisions[0] is a
      // snapshot of the record AS CREATED, captured lazily on the first edit,
      // and every edit after that appends a field-level diff. The current
      // values do move on — that is what an edit is — but the original and the
      // path it took are both still readable.
      var target = (property.timeline || []).find(function (x) { return x.id === existing.id; });
      if (target) _amendEvent(target, {
        title: title, description: notes, category: category,
        timestamp: timestamp,
        responsibility: (['landlord', 'tenant', 'shared', 'na'].indexOf(responsibility) >= 0 ? responsibility : 'na'),
        leaseRef: leaseRef,
        subject: subject || { type: 'property', id: (property.id || null), label: null },
        tenantId: spaceId || null,
      }, finalAtt);
    } else if (window.appendPropertyTimelineEvent) {
      window.appendPropertyTimelineEvent(property, {
        manual: true, type: 'manual_' + category, category: category, severity: 'info',
        title: title, description: notes, timestamp: timestamp,
        responsibility: responsibility, leaseRef: leaseRef, attachments: finalAtt,
        tenantId: spaceId || null, subject: subject || undefined,
        // Who recorded it, mirroring the Space workspace. 'Property Manager'
        // was a placeholder that named nobody; metadata.recordedBy is what
        // every Space record already carries and what the UI already reads.
        actor: _who(),
        metadata: { recordedBy: _who() },
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
      '.ptl-hint{font-size:0.7rem;color:var(--text-4,#64748B);margin-top:4px;}',
      '.tl-open-space{font:700 0.72rem/1 inherit;color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';border-radius:8px;padding:7px 11px;cursor:pointer;white-space:nowrap;min-height:34px;}',
      '.tl-open-space:hover{filter:brightness(1.08);}',
      '.tl-edit-btn{font:600 0.68rem/1 inherit;color:var(--text-4,#64748B);background:none;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:6px;padding:4px 8px;cursor:pointer;min-height:26px;}',
      '.tl-edit-btn:hover{color:' + gold + ';border-color:' + gold + ';}',
      '.tl-view-btn{font:600 0.68rem/1 inherit;color:var(--text-3,#94A3B8);background:none;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:6px;padding:4px 8px;cursor:pointer;min-height:26px;margin-left:auto;}',
      '.tl-view-btn:hover{color:' + gold + ';border-color:' + gold + ';}',
      '.tl-view-btn--ev{color:' + gold + ';border-color:rgba(201,151,58,0.45);margin-left:auto;}',
      '.tl-day-divider{font-size:0.68rem;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-4,#64748B);margin:14px 0 6px;padding-bottom:3px;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.07);}',
      '.tl-scope-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px;}',
      '.tl-scope-label{font-size:0.72rem;font-weight:700;color:var(--text-4,#64748B);white-space:nowrap;}',
      '.tl-scope-sel{flex:1;max-width:260px;padding:7px 9px;border-radius:8px;font:0.8rem inherit;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);color:var(--text-1,#E2E8F0);}',
      '.tl-scope-sel:focus{outline:none;border-color:' + gold + ';}',
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
    amendEvent: _amendEvent,
    openEditEntry: openEditEntry,
    closeModal: closeModal,
    categories: MANUAL_CATEGORIES,
    propertyCategories: PROPERTY_CATEGORIES,
    _registry: REGISTRY,
  };
})();
