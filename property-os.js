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
  // ── Property Records ────────────────────────────────────────────────────────
  // ONE surface over ONE store. Categories are a filter, not screens, and every
  // record below is a property-scoped timeline event — the same events the
  // Building Systems grid counts and the Property documents list draws files
  // from. Nothing here has its own array. docs/PROPERTY_WORKSPACE.md.
  var _filter = { cat: 'all', system: null };
  var _docIcon = function () { return '\u{1F4C4}'; };

  function setRecordFilter(cat, system) {
    _filter = { cat: cat || 'all', system: system || null };
    renderPropertyPage();
  }

  // Every property-scoped event: the building as a whole, plus each system.
  // Space-scoped events belong to the Space workspace and are deliberately out.
  function propertyRecords(property) {
    return (property.timeline || [])
      .filter(function (e) {
        if (!e) return false;
        var t = e.subject && e.subject.type;
        return !e.subject || t === 'property' || t === 'system';
      })
      .sort(function (a, b) {
        return (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0);
      });
  }

  function _applyFilter(records) {
    return records.filter(function (e) {
      if (_filter.system) {
        if (!(e.subject && e.subject.type === 'system' && e.subject.id === _filter.system)) return false;
      }
      if (_filter.cat !== 'all' && (e.category || '') !== _filter.cat) return false;
      return true;
    });
  }

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

    var PR = window.PropertyReference;   // declared early: the documents section uses it
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
      return '<div class="pos-sys-cell' + (tot ? ' pos-sys-cell--on' : '') +
        (_filter.system === s.key ? ' pos-sys-cell--sel' : '') + '" role="button" tabindex="0"' +
        ' data-sys="' + _esc(s.key) + '"' +
        ' onclick="PropertyOS.setRecordFilter(\'all\', this.dataset.sys)"' +
        ' title="Show only records for this system"><span class="pos-sys-ic">' + s.icon + '</span>' +
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
    // Demo property: show the document set a real building would keep on file.
    if (PR) docs = docs.concat(PR.propertyDocumentsFor(property));
    _docIcon = function (k) {
      return k === 'photo' ? '\u{1F5BC}\u{FE0F}' : (k === 'invoice' ? '\u{1F9FE}'
        : (k === 'warranty' ? '\u{1F6E1}\u{FE0F}' : (k === 'plan' ? '\u{1F4D0}' : '\u{1F4C4}')));
    };
    var docHtml = docs.length
      ? '<div class="pos-docs">' + docs.slice(0, 30).map(function (a) {
          var inner = _docIcon(a.kind) + '&nbsp;<span class="pos-doc-n">' + _esc(a.name) + '</span>' +
            (a.category ? '<span class="pos-doc-cat">' + _esc(a.category) + '</span>' : '') +
            (a.when ? '<span class="pos-doc-w">' + _esc(_fmtDate(a.when)) + '</span>' : '');
          return a.url
            ? '<a class="pos-doc" href="' + _esc(a.url) + '" target="_blank" rel="noopener">' + inner + '</a>'
            : '<div class="pos-doc pos-doc--ref">' + inner + '</div>';
        }).join('') + '</div>' + (docs.length > 30 ? '<div class="pos-empty">Showing 30 of ' + docs.length + '</div>' : '')
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

    // ── Property Information — reference facts, not operational alerts ──────
    var infoHtml = '';
    if (PR) {
      var info = PR.infoFor(property);
      if (info) {
        infoHtml = PR.GROUPS.map(function (g) {
          var rows = PR.FIELDS.filter(function (f) { return f.group === g; }).map(function (f) {
            return '<div class="pos-info-row"><span class="pos-info-k">' + _esc(f.label) + '</span>' +
              '<span class="pos-info-v">' + _esc(PR.formatValue(f, info[f.key], property)) + '</span></div>';
          }).join('');
          return '<div class="pos-info-grp"><div class="pos-info-grp-t">' + _esc(g) + '</div>' + rows + '</div>';
        }).join('');
        infoHtml = '<div class="pos-info">' + infoHtml + '</div>';
      } else {
        infoHtml = _empty('No property information recorded yet. Address, year built, insurance, roof and HVAC details appear here once added.');
      }
    }

    // ── Property Records — the operating surface ──────────────────────────
    var allRecs  = propertyRecords(property);
    var shown    = _applyFilter(allRecs);
    var PT       = window.PropertyTimeline;
    var catKeys  = (PT && PT.propertyCategories) || [];
    // Only offer a chip for a category that exists here or is a building-level
    // one — a filter that always returns nothing teaches people not to use it.
    var present  = {};
    allRecs.forEach(function (e) { if (e.category) present[e.category] = (present[e.category] || 0) + 1; });
    var chipKeys = catKeys.filter(function (k) { return present[k]; });
    Object.keys(present).forEach(function (k) { if (chipKeys.indexOf(k) < 0) chipKeys.push(k); });

    var chip = function (key, label, count, on) {
      return '<button type="button" class="pos-chip' + (on ? ' pos-chip--on' : '') + '" ' +
        'data-cat="' + _esc(key) + '" onclick="PropertyOS.setRecordFilter(this.dataset.cat, ' +
        (_filter.system ? "'" + _esc(_filter.system) + "'" : 'null') + ')">' +
        _esc(label) + (count != null ? ' <span class="pos-chip-n">' + count + '</span>' : '') + '</button>';
    };
    var chipsHtml = '<div class="pos-chips">' +
      chip('all', 'All records', allRecs.length, _filter.cat === 'all') +
      chipKeys.map(function (k) {
        var d = (PT && PT.describe) ? PT.describe({ category: k, type: k }) : { label: k };
        return chip(k, d.label || k, present[k] || 0, _filter.cat === k);
      }).join('') + '</div>';

    var sysFilterHtml = _filter.system
      ? '<div class="pos-filter-note">Showing <b>' + _esc(systemLabel(_filter.system) || _filter.system) +
        '</b> only <button type="button" class="pos-clear" onclick="PropertyOS.setRecordFilter(\'' +
        _esc(_filter.cat) + '\', null)">Clear</button></div>'
      : '';

    var recHtml = shown.length
      ? '<div class="pos-recs">' + shown.slice(0, 40).map(function (e) {
          var d = (PT && PT.describe) ? PT.describe(e) : { label: e.type, icon: null };
          var subj = e.subject && e.subject.type === 'system'
            ? (systemLabel(e.subject.id) || e.subject.id) : 'Property-wide';
          var by = (e.metadata && e.metadata.recordedBy) || e.actor || null;
          var atts = (e.attachments || []).filter(function (a) { return a && a.url; });
          return '<div class="pos-rec">' +
            '<div class="pos-rec-top">' +
              '<span class="pos-rec-t">' + _esc(e.title || d.label || e.type) + '</span>' +
              '<span class="pos-rec-w">' + _esc(_fmtDate(e.timestamp)) + '</span>' +
            '</div>' +
            '<div class="pos-rec-meta">' +
              '<span class="pos-rec-cat">' + (d.icon || '') + ' ' + _esc(d.label || e.category || e.type) + '</span>' +
              '<span class="pos-rec-subj">' + _esc(subj) + '</span>' +
              (by ? '<span class="pos-rec-by">Recorded by ' + _esc(by) + '</span>' : '') +
            '</div>' +
            (e.description ? '<div class="pos-rec-note">' + _esc(e.description) + '</div>' : '') +
            (atts.length ? '<div class="pos-rec-att">' + atts.map(function (a) {
              return '<a class="pos-doc" href="' + _esc(a.url) + '" target="_blank" rel="noopener">' +
                _docIcon(a.kind) + '&nbsp;<span class="pos-doc-n">' + _esc(a.name) + '</span></a>';
            }).join('') + '</div>' : '') +
          '</div>';
        }).join('') + '</div>' +
        (shown.length > 40 ? '<div class="pos-empty">Showing 40 of ' + shown.length + '</div>' : '')
      : _empty(allRecs.length
          ? 'Nothing recorded under this filter yet. Choose another category, or add a record.'
          : 'Nothing recorded for this building yet. Tax bills, insurance policies, surveys, site and building plans, environmental reports, capital improvements, photos and system warranties all live here — each one a dated entry on the property timeline.');

    var addBtn = '<button type="button" class="pos-add" onclick="PropertyOS.addRecord()">\u2795 Add Record</button>';

    body.innerHTML =
      (infoHtml ? _sec('Property information', null, infoHtml) : '') +
      _sec('Property records', allRecs.length, addBtn + chipsHtml + sysFilterHtml + recHtml) +
      _sec('Building systems', null, sysHtml) +
      _sec('Financials', null, finHtml) +
      _sec('Invoice register', invs.length, regHtml) +
      _sec('Property documents', docs.length, docHtml) +
      _sec('Property timeline', propEvents.length, tlHtml);
  }

  // Opens the EXISTING timeline modal. No new persistence, no second writer —
  // the same path the Overview timeline uses, so a record added here is the
  // same kind of object as one added there.
  function addRecord() {
    var property = window.currentProperty && window.currentProperty();
    if (!property) return;
    if (window.PropertyTimeline && PropertyTimeline.openAddEntry) {
      PropertyTimeline.openAddEntry(property);
    }
  }

  function injectStyles() {
    if (_d('pos-styles')) return;
    var gold = '#C9973A';
    var css = [
      '.pos-sec{padding:14px 0;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.06);}',
      // ── Property Records ──
      '.pos-add{font:700 0.76rem/1 inherit;color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';border-radius:8px;padding:9px 15px;cursor:pointer;margin-bottom:12px;min-height:36px;}',
      '.pos-add:hover{filter:brightness(1.08);}',
      '.pos-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}',
      '.pos-chip{font:600 0.72rem/1 inherit;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.04);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:999px;padding:6px 11px;cursor:pointer;min-height:30px;}',
      '.pos-chip:hover{background:rgba(var(--line-rgb,255,255,255),0.09);color:var(--text-1,#E2E8F0);}',
      '.pos-chip--on{background:rgba(201,151,58,0.15);border-color:rgba(201,151,58,0.45);color:' + gold + ';}',
      '.pos-chip-n{opacity:0.65;font-weight:500;}',
      '.pos-filter-note{font-size:0.76rem;color:var(--text-3,#94A3B8);margin-bottom:9px;}',
      '.pos-clear{font:600 0.7rem/1 inherit;color:var(--text-4,#64748B);background:none;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:6px;padding:3px 8px;margin-left:8px;cursor:pointer;}',
      '.pos-recs{display:flex;flex-direction:column;gap:8px;}',
      '.pos-rec{border:1px solid rgba(var(--line-rgb,255,255,255),0.08);background:rgba(var(--line-rgb,255,255,255),0.02);border-radius:9px;padding:10px 12px;}',
      '.pos-rec-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline;}',
      '.pos-rec-t{font-size:0.88rem;font-weight:600;color:var(--text-1,#E2E8F0);}',
      '.pos-rec-w{font-size:0.72rem;color:var(--text-4,#64748B);white-space:nowrap;}',
      '.pos-rec-meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;font-size:0.72rem;color:var(--text-4,#64748B);}',
      '.pos-rec-cat{color:' + gold + ';}',
      '.pos-rec-note{margin-top:6px;font-size:0.79rem;color:var(--text-3,#94A3B8);line-height:1.5;}',
      '.pos-rec-att{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
      '.pos-sys-cell{cursor:pointer;}',
      '.pos-sys-cell--sel{border-color:rgba(201,151,58,0.5)!important;background:rgba(201,151,58,0.08)!important;}',
      '@media(max-width:600px){.pos-add{width:100%;}.pos-rec-top{flex-direction:column;gap:2px;}}',
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
      '.pos-doc--ref{cursor:default;}',
      '.pos-doc-cat{font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--text-4,#64748B);background:rgba(var(--line-rgb,255,255,255),0.06);border-radius:5px;padding:1px 6px;margin-left:8px;flex:none;}',
      // Property information — reference facts, calm and scannable
      '.pos-info{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;}',
      '.pos-info-grp-t{font-size:0.66rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:' + gold + ';margin-bottom:7px;}',
      '.pos-info-row{display:flex;gap:10px;padding:5px 0;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.05);font-size:0.8rem;}',
      '.pos-info-row:last-child{border-bottom:none;}',
      '.pos-info-k{flex:none;width:130px;color:var(--text-4,#64748B);}',
      '.pos-info-v{flex:1;color:var(--text-1,#E2E8F0);min-width:0;}',
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
    setRecordFilter: setRecordFilter, addRecord: addRecord, propertyRecords: propertyRecords,
    invoices: invoices, setInvoiceRelation: setInvoiceRelation,
    init: init, renderPropertyPage: renderPropertyPage,
  };
})();
