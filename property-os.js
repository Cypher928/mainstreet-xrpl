/**
 * property-os.js — Property Operating System: the Property subject.
 * ============================================================================
 * Information architecture: records belong to SUBJECTS, not feature modules.
 *
 *   Property   → everything belonging to the building as a whole
 *                (setup, financials, building systems, property documents,
 *                 the invoice register, property-wide timeline)
 *   Space      → everything specific to one suite (tenant-space.js)
 *   CAM        → a workflow that REFERENCES invoices; it does not own them
 *   Reports    → generated outputs only
 *   Reserves   → long-term capital planning
 *
 * KEY ARCHITECTURAL RULE — invoices belong to the Property:
 * every invoice is uploaded once to the property (property.invoices, which is
 * already where they live) and may optionally relate to a Space, to CAM
 * eligibility, to a Building System, and to a Vendor. CAM consumes them from the
 * property's financial record rather than owning them.
 *
 * Nav re-parenting: instead of moving hundreds of lines of markup (and risking
 * the handlers/ids inside those cards), this module MOVES the existing card
 * nodes into their subject panes at init. Every id and listener is preserved
 * because the node itself is relocated, not cloned.
 *
 * Reuses: property.invoices, property.timeline (subject-scoped), savePropertyData,
 * switchWorkspaceTab, esc(). No new store, no new backend.
 *
 * Exposes: window.PropertyOS
 */
window.PropertyOS = (function () {
  'use strict';

  var _esc = (window.esc) || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  var _d = function (id) { return document.getElementById(id); };
  function _money(n) { try { return '$' + Math.round(Number(n) || 0).toLocaleString('en-US'); } catch (_) { return '$' + n; } }
  function _fmtDate(ts) { try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return String(ts || ''); } }

  // Shared building systems — the physical assets of the building as a whole.
  var BUILDING_SYSTEMS = [
    { key: 'roof',            label: 'Roof',            icon: '\u{1F3E0}' },
    { key: 'parking',         label: 'Parking Lot',     icon: '\u{1F17F}\u{FE0F}' },
    { key: 'hvac',            label: 'HVAC',            icon: '\u{2744}\u{FE0F}' },
    { key: 'fire',            label: 'Fire Suppression',icon: '\u{1F9EF}' },
    { key: 'landscaping',     label: 'Landscaping',     icon: '\u{1F333}' },
    { key: 'electrical',      label: 'Electrical',      icon: '\u{26A1}' },
    { key: 'plumbing',        label: 'Plumbing',        icon: '\u{1F6BF}' },
    { key: 'other',           label: 'Other / Shared',  icon: '\u{1F527}' },
  ];
  function systemLabel(key) {
    for (var i = 0; i < BUILDING_SYSTEMS.length; i++) if (BUILDING_SYSTEMS[i].key === key) return BUILDING_SYSTEMS[i].label;
    return null;
  }

  // ── Invoice relational model ────────────────────────────────────────────────
  // Invoices already live on property.invoices. We read them with their optional
  // relations normalized, and write relations back additively.
  function invoices(property) {
    return (property && Array.isArray(property.invoices) ? property.invoices : []).map(function (inv, i) {
      return {
        _i: i,
        vendorName: inv.vendorName || inv.fileName || 'Vendor',
        amount: Number(inv.amount) || 0,
        category: inv.category || null,
        invoiceDate: inv.invoiceDate || null,
        fileUrl: inv.fileUrl || null,
        fileName: inv.fileName || null,
        // relations (optional, additive — absent on legacy invoices)
        spaceId: inv.spaceId || null,
        camEligible: inv.camEligible !== false,   // default: CAM-eligible unless told otherwise
        system: inv.system || null,
      };
    });
  }

  function setInvoiceRelation(index, field, value) {
    var p = window.currentProperty && window.currentProperty();
    if (!p || !Array.isArray(p.invoices)) return;
    var inv = p.invoices[index];
    if (!inv) return;
    if (field === 'camEligible') inv.camEligible = !!value;
    else inv[field] = value || null;
    try { if (window.savePropertyData) window.savePropertyData(); } catch (_e) {}
    renderPropertyPage(p);
  }

  // ── Nav: create the Property pane and re-parent cards to their subjects ─────
  function _ensurePane() {
    if (_d('wsPane-property')) return _d('wsPane-property');
    var overview = _d('wsPane-overview');
    if (!overview || !overview.parentNode) return null;
    var pane = document.createElement('div');
    pane.className = 'workspace-tab-pane';
    pane.id = 'wsPane-property';
    pane.style.display = 'none';
    pane.innerHTML =
      '<div class="card" id="propertySection">' +
        '<div class="sec-head"><div class="sec-num" style="background:#0ea5e9;">\u{1F3E2}</div>' +
          '<div><h2>Property</h2><p>Everything that belongs to the building as a whole.</p></div></div>' +
        '<div id="propertyOsBody"></div>' +
      '</div>';
    overview.parentNode.insertBefore(pane, overview.nextSibling);
    return pane;
  }

  function _ensureTabButton() {
    if (_d('wsTabBtn-property')) return;
    var bar = _d('workspaceTabBar');
    var ov = _d('wsTabBtn-overview');
    if (!bar || !ov) return;
    var b = document.createElement('button');
    b.className = 'workspace-tab';
    b.id = 'wsTabBtn-property';
    b.setAttribute('onclick', "switchWorkspaceTabFromNav('property')");
    b.innerHTML = '<span class="ws-tab-icon">\u{1F3E2}</span>Property';
    bar.insertBefore(b, ov.nextSibling);
  }

  var _reparented = false;
  function _reparent() {
    if (_reparented) return;
    var pane = _ensurePane();
    if (!pane) return;
    var body = _d('propertyOsBody');
    // Property Setup belongs to the Property subject.
    var setup = _d('cardSetup');
    if (setup && body && !body.contains(setup)) body.parentNode.insertBefore(setup, body);
    // Lease intake creates spaces → it belongs under Spaces (no app-wide Lease section).
    var leases = _d('cardLeases'), spacesPane = _d('wsPane-spaces');
    if (leases && spacesPane && !spacesPane.contains(leases)) spacesPane.appendChild(leases);
    // The old Documents pane is retired from navigation; hide whatever remains.
    var docs = _d('wsPane-documents');
    if (docs) docs.style.display = 'none';
    var docsBtn = _d('wsTabBtn-documents');
    if (docsBtn) docsBtn.style.display = 'none';
    _reparented = true;
  }

  function init() {
    _ensureTabButton();
    _ensurePane();
    _reparent();
    injectStyles();
  }

  // ── Property page ───────────────────────────────────────────────────────────
  function _sec(title, count, body) {
    return '<section class="pos-sec"><div class="pos-sec-head"><span class="pos-sec-title">' + _esc(title) + '</span>' +
      (count != null ? '<span class="pos-sec-count">' + count + '</span>' : '') + '</div>' +
      '<div class="pos-sec-body">' + body + '</div></section>';
  }
  function _empty(m) { return '<div class="pos-empty">' + _esc(m) + '</div>'; }

  function renderPropertyPage(property) {
    property = property || (window.currentProperty && window.currentProperty());
    var body = _d('propertyOsBody');
    if (!body || !property) return;
    injectStyles();

    var invs = invoices(property);
    var spaces = (property.tenants || []).filter(function (t) { return t && (t.tenant_name || t.id); });
    var tl = (property.timeline || []);

    // Financial snapshot — property-wide money, read from the record.
    var total = invs.reduce(function (s, i) { return s + i.amount; }, 0);
    var camPool = invs.filter(function (i) { return i.camEligible; }).reduce(function (s, i) { return s + i.amount; }, 0);
    var nonCam = total - camPool;
    var finHtml = invs.length
      ? '<div class="pos-fin">' +
          '<div class="pos-fin-cell"><div class="pos-fin-v">' + _money(total) + '</div><div class="pos-fin-l">Total invoiced</div></div>' +
          '<div class="pos-fin-cell"><div class="pos-fin-v">' + _money(camPool) + '</div><div class="pos-fin-l">CAM-eligible</div></div>' +
          '<div class="pos-fin-cell"><div class="pos-fin-v">' + _money(nonCam) + '</div><div class="pos-fin-l">Not CAM</div></div>' +
        '</div>'
      : _empty('No invoices on file for this property yet.');

    // Invoice register — uploaded once to the property, related outward.
    var spaceOpts = function (sel) {
      return '<option value="">Property only</option>' + spaces.map(function (t) {
        return '<option value="' + _esc(t.id) + '"' + (sel === t.id ? ' selected' : '') + '>' + _esc(t.tenant_name || t.id) + '</option>';
      }).join('');
    };
    var sysOpts = function (sel) {
      return '<option value="">No system</option>' + BUILDING_SYSTEMS.map(function (s) {
        return '<option value="' + s.key + '"' + (sel === s.key ? ' selected' : '') + '>' + _esc(s.label) + '</option>';
      }).join('');
    };
    var regHtml = invs.length
      ? '<div class="pos-reg">' + invs.slice(0, 40).map(function (inv) {
          return '<div class="pos-inv">' +
            '<div class="pos-inv-top">' +
              '<span class="pos-inv-vendor">' + _esc(inv.vendorName) + '</span>' +
              '<span class="pos-inv-amt">' + _money(inv.amount) + '</span>' +
            '</div>' +
            '<div class="pos-inv-meta">' + _esc([inv.category, inv.invoiceDate ? _fmtDate(inv.invoiceDate) : null].filter(Boolean).join(' · ') || '—') + '</div>' +
            '<div class="pos-inv-rel">' +
              '<label class="pos-rel"><span>Space</span><select onchange="PropertyOS.setInvoiceRelation(' + inv._i + ',\'spaceId\',this.value)">' + spaceOpts(inv.spaceId) + '</select></label>' +
              '<label class="pos-rel"><span>System</span><select onchange="PropertyOS.setInvoiceRelation(' + inv._i + ',\'system\',this.value)">' + sysOpts(inv.system) + '</select></label>' +
              '<label class="pos-rel pos-rel--chk"><input type="checkbox"' + (inv.camEligible ? ' checked' : '') + ' onchange="PropertyOS.setInvoiceRelation(' + inv._i + ',\'camEligible\',this.checked)"><span>CAM eligible</span></label>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>' +
        (invs.length > 40 ? '<div class="pos-empty">Showing 40 of ' + invs.length + '</div>' : '') +
        '<div class="pos-note">Uploaded once to the property. CAM references these — it doesn’t own them.</div>'
      : _empty('Invoices uploaded to this property will appear here, ready to relate to a space, a building system, or CAM.');

    // Building systems — the shared physical assets, with what's attached to each.
    var sysHtml = '<div class="pos-sys">' + BUILDING_SYSTEMS.map(function (s) {
      var n = invs.filter(function (i) { return i.system === s.key; }).length;
      var ev = tl.filter(function (e) { return e && e.subject && e.subject.type === 'system' && e.subject.id === s.key; }).length;
      var tot = n + ev;
      return '<div class="pos-sys-cell' + (tot ? ' pos-sys-cell--on' : '') + '"><span class="pos-sys-ic">' + s.icon + '</span>' +
        '<span class="pos-sys-l">' + _esc(s.label) + '</span>' +
        '<span class="pos-sys-n">' + (tot ? tot + ' record' + (tot !== 1 ? 's' : '') : '—') + '</span></div>';
    }).join('') + '</div>';

    // Property documents — files attached to property-wide records.
    var docs = [];
    tl.forEach(function (e) {
      var isProp = !e.subject || e.subject.type === 'property' || e.subject.type === 'system';
      if (!isProp) return;
      (e.attachments || []).forEach(function (a) { if (a && a.url) docs.push({ name: a.name, url: a.url, kind: a.kind, when: e.timestamp }); });
    });
    invs.forEach(function (i) { if (i.fileUrl && !i.spaceId) docs.push({ name: i.fileName || i.vendorName, url: i.fileUrl, kind: 'invoice', when: i.invoiceDate }); });
    var docHtml = docs.length
      ? '<div class="pos-docs">' + docs.slice(0, 30).map(function (a) {
          var ic = a.kind === 'photo' ? '\u{1F5BC}\u{FE0F}' : (a.kind === 'invoice' ? '\u{1F9FE}' : (a.kind === 'warranty' ? '\u{1F6E1}\u{FE0F}' : '\u{1F4C4}'));
          return '<a class="pos-doc" href="' + _esc(a.url) + '" target="_blank" rel="noopener">' + ic + '&nbsp;<span class="pos-doc-n">' + _esc(a.name) + '</span>' +
            (a.when ? '<span class="pos-doc-w">' + _esc(_fmtDate(a.when)) + '</span>' : '') + '</a>';
        }).join('') + '</div>'
      : _empty('Insurance policies, tax bills, surveys, vendor contracts and building warranties attached to property-wide records appear here.');

    // Property-wide timeline — what affects the building as a whole.
    var propEvents = tl.filter(function (e) { return !e.subject || e.subject.type === 'property' || e.subject.type === 'system'; })
      .sort(function (a, b) { return (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0); });
    var tlHtml = propEvents.length
      ? '<div class="pos-tl">' + propEvents.slice(0, 10).map(function (e) {
          var d = (window.PropertyTimeline && PropertyTimeline.describe) ? PropertyTimeline.describe(e) : { label: e.type };
          return '<div class="pos-tl-row"><span class="pos-tl-w">' + _esc(_fmtDate(e.timestamp)) + '</span>' +
            '<span class="pos-tl-b">' + _esc(d.label || e.type) + '</span>' +
            '<span class="pos-tl-t">' + _esc(e.title) + '</span></div>';
        }).join('') + '</div>' + (propEvents.length > 10 ? '<div class="pos-empty">+ ' + (propEvents.length - 10) + ' earlier — full history on Overview</div>' : '')
      : _empty('Roof replacements, insurance renewals, tax appeals and capital improvements appear here.');

    body.innerHTML =
      _sec('Financials', null, finHtml) +
      _sec('Invoice register', invs.length, regHtml) +
      _sec('Building systems', null, sysHtml) +
      _sec('Property documents', docs.length, docHtml) +
      _sec('Property timeline', propEvents.length, tlHtml);
  }

  function injectStyles() {
    if (_d('pos-styles')) return;
    var gold = '#C9973A';
    var css = [
      '.pos-sec{padding:14px 0;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.06);}',
      '.pos-sec:last-child{border-bottom:none;}',
      '.pos-sec-head{display:flex;align-items:center;gap:8px;margin-bottom:9px;}',
      '.pos-sec-title{font-size:0.74rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-4,#64748B);}',
      '.pos-sec-count{font-size:0.66rem;font-weight:800;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.07);border-radius:20px;padding:1px 8px;}',
      '.pos-empty{font-size:0.78rem;color:var(--text-4,#64748B);line-height:1.5;}',
      '.pos-note{font-size:0.72rem;color:var(--text-4,#64748B);margin-top:8px;font-style:italic;}',
      '.pos-fin{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;}',
      '.pos-fin-cell{background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:10px;padding:11px 13px;}',
      '.pos-fin-v{font-size:1.05rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.pos-fin-l{font-size:0.72rem;color:var(--text-4,#64748B);margin-top:2px;}',
      '.pos-reg{display:flex;flex-direction:column;gap:9px;}',
      '.pos-inv{background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:10px;padding:11px 13px;}',
      '.pos-inv-top{display:flex;align-items:baseline;gap:10px;}',
      '.pos-inv-vendor{font-size:0.86rem;font-weight:700;color:var(--text-1,#E2E8F0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pos-inv-amt{margin-left:auto;font-size:0.86rem;font-weight:800;color:' + gold + ';flex:none;}',
      '.pos-inv-meta{font-size:0.74rem;color:var(--text-4,#64748B);margin-top:2px;}',
      '.pos-inv-rel{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px;}',
      '.pos-rel{display:flex;align-items:center;gap:5px;font-size:0.72rem;color:var(--text-4,#64748B);}',
      '.pos-rel select{padding:6px 8px;border-radius:7px;font:0.75rem inherit;background:var(--theme-card,#0F1217);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);color:var(--text-1,#E2E8F0);max-width:150px;}',
      '.pos-rel select:focus{outline:none;border-color:' + gold + ';}',
      '.pos-rel--chk{background:var(--theme-card,#0F1217);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:7px;padding:6px 9px;cursor:pointer;}',
      '.pos-rel--chk input{accent-color:' + gold + ';width:15px;height:15px;}',
      '.pos-sys{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}',
      '.pos-sys-cell{display:flex;align-items:center;gap:7px;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:9px;padding:9px 11px;}',
      '.pos-sys-cell--on{border-color:rgba(201,151,58,0.4);}',
      '.pos-sys-l{font-size:0.8rem;color:var(--text-2,#CBD5E1);}',
      '.pos-sys-n{margin-left:auto;font-size:0.68rem;color:var(--text-4,#64748B);flex:none;}',
      '.pos-docs{display:flex;flex-direction:column;gap:5px;}',
      '.pos-doc{display:flex;align-items:center;gap:7px;font-size:0.78rem;color:var(--text-2,#CBD5E1);text-decoration:none;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:8px;padding:8px 10px;}',
      '.pos-doc:hover{border-color:' + gold + ';}',
      '.pos-doc-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pos-doc-w{margin-left:auto;font-size:0.7rem;color:var(--text-4,#64748B);flex:none;}',
      '.pos-tl{display:flex;flex-direction:column;gap:6px;}',
      '.pos-tl-row{display:flex;align-items:center;gap:9px;font-size:0.8rem;}',
      '.pos-tl-w{color:var(--text-4,#64748B);font-size:0.72rem;flex:none;width:96px;}',
      '.pos-tl-b{font-size:0.62rem;font-weight:800;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.07);border-radius:5px;padding:1px 6px;flex:none;}',
      '.pos-tl-t{color:var(--text-2,#CBD5E1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '@media (max-width:480px){',
      '  .pos-tl-w{width:74px;}',
      '  .pos-rel select{max-width:120px;}',
      '  .pos-sys{grid-template-columns:1fr 1fr;}',
      '}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'pos-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  return {
    BUILDING_SYSTEMS: BUILDING_SYSTEMS, systemLabel: systemLabel,
    invoices: invoices, setInvoiceRelation: setInvoiceRelation,
    init: init, renderPropertyPage: renderPropertyPage,
  };
})();
