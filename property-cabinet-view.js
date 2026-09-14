/**
 * property-cabinet-view.js — Property Workspace V2, Phase 1: the filing cabinet.
 * ============================================================================
 * The Property tab as the front page of the building's organized record:
 *
 *   header      name · address · Total size / Spaces / Occupied / Vacant / Occupancy
 *   attention   the SAME items PropertyWorkspace ranks for Overview, mounted here
 *   cabinet     nine tiles, counts read from PropertyCabinet.buildIndex()
 *   activity    the five most recent property records, pointing into History
 *
 * and, one click in, a DRAWER: the records filed under one heading, grouped by
 * year, each rendered by PropertyOS.recordCardHtml so Edit / Attach / Link and
 * the revision history are the one implementation they always were.
 *
 * NOTHING HERE IS A STORE. Every count comes from the index; every row is a
 * pointer to a timeline event, an invoice in the register, a tenant row, a
 * fact in property.info or a reserve — the same objects the Space file, the
 * AI read model and the MCP projection read. Opening a drawer never copies a
 * record; closing one never loses anything.
 *
 * Addressing: #property/<drawer>/<year>/<recordId> and #spaces/<spaceId>
 * (PropertyCabinet.address / parseAddress). Written with replaceState so the
 * page never jumps; read on hashchange and on the first render for a property
 * so a pasted link lands on the drawer it names.
 *
 * Reuses: PropertyCabinet (the map, the index, paging, dates), PropertyOS (the
 * renderers, the setup card, filters), PropertyWorkspace (attention),
 * PropertyTimeline (describe, add/edit modal), PropertyReference (facts),
 * TenantSpace (the Space file), switchWorkspaceTab.
 *
 * Exposes: window.PropertyCabinetView
 */
window.PropertyCabinetView = (function () {
  'use strict';

  var _esc = (window.esc) || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  var _d = function (id) { return document.getElementById(id); };
  var PAGE_RECORDS = 25;   // record cards shown per "Show more" step in a drawer
  var PAGE_INVOICES = 25;  // invoice rows per page
  var PAGE_HISTORY = 50;   // history rows per "Show more" step
  var RECENT = 5;          // rows in Recent activity on the landing page

  function _fmtDate(ts) {
    if (!ts) return '';
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return String(ts);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return String(ts || ''); }
  }
  function _plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function _num(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  function _fmtInt(n) { try { return Math.round(Number(n) || 0).toLocaleString('en-US'); } catch (_) { return String(n); } }
  function _money(v) {
    var n = _num(v);
    if (n === null) return '—';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function PC() { return window.PropertyCabinet; }
  function POS() { return window.PropertyOS; }
  function _prop() { return window.currentProperty && window.currentProperty(); }

  // ── Icons: small, monochrome, drawn once ───────────────────────────────────
  var ICONS = {
    taxes:      '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h5M10 17h5"/></svg>',
    insurance:  '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
    invoices:   '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    financing:  '<svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6"/><path d="M5 10v9M10 10v9M14 10v9M19 10v9"/><path d="M3 19h18"/></svg>',
    financials: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
    agreements: '<svg viewBox="0 0 24 24"><path d="M3 12l4-4 4 3 3-3 4 4"/><path d="M7 8L3 12l5 5 4-3 3 3 6-5"/></svg>',
    building:   '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.1-.5-.5-2.1z"/></svg>',
    dates:      '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    history:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    edit:       '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M12 6l4 4"/></svg>',
    back:       '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    go:         '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  };
  function _icon(k) { return '<span class="pcv-ic" aria-hidden="true">' + (ICONS[k] || '') + '</span>'; }

  // ── State ──────────────────────────────────────────────────────────────────
  // One object per open property. `drawer` null = the landing page.
  function _fresh(propId) {
    return { propId: propId, applied: false, drawer: null,
             year: null, cat: 'all', system: null, recordId: null, show: PAGE_RECORDS,
             q: '', vendor: '', category: '', spaceId: '', page: 1, hshow: PAGE_HISTORY };
  }
  var _state = _fresh(null);
  function state() { return JSON.parse(JSON.stringify(_state)); }

  function _resetFor(property) {
    if (_state.propId !== (property && property.id)) _state = _fresh(property && property.id);
  }
  function _resetDrawerFilters() {
    _state.year = null; _state.cat = 'all'; _state.system = null; _state.recordId = null;
    _state.show = PAGE_RECORDS; _state.q = ''; _state.vendor = ''; _state.category = '';
    _state.spaceId = ''; _state.page = 1; _state.hshow = PAGE_HISTORY;
  }

  // ── Derived data the tiles and drawers read ────────────────────────────────
  function _index(property) { return PC().buildIndex(property); }

  // The facts the cabinet derives dates from are the facts every other surface
  // shows: PropertyReference.infoFor resolves property.info (or the demo's
  // reference set on the demo property, and nothing on a real one). Handing
  // PropertyCabinet a property whose `info` is already resolved keeps the
  // Important Dates tile and the attention panel reading one answer.
  function _withInfo(property) {
    var PR = window.PropertyReference;
    var info = PR ? PR.infoFor(property) : (property && property.info) || null;
    if (!property || info === property.info) return property;
    var shim = Object.create(property);
    shim.info = info;
    return shim;
  }

  // Every document on the property, keyed by the drawer of the record it is on.
  // An invoice's own file belongs to the Invoices drawer.
  function _docsByDrawer(property, idx) {
    var out = {};
    var drawerOfId = {};
    idx.records.forEach(function (p) { if (p.id != null) drawerOfId[p.id] = p.drawer; });
    var docs = POS() && POS().propertyDocuments ? POS().propertyDocuments(property) : [];
    docs.forEach(function (a) {
      var key = a.recordId != null ? (drawerOfId[String(a.recordId)] || 'history') : 'invoices';
      (out[key] = out[key] || []).push(a);
    });
    return out;
  }

  function _years(map) {
    return Object.keys(map || {}).filter(function (k) { return k !== 'undated'; })
      .sort(function (a, b) { return Number(b) - Number(a); });
  }

  function _systemsWithRecords(property) {
    var sys = (POS() && POS().BUILDING_SYSTEMS) || [];
    var invs = POS() && POS().invoices ? POS().invoices(property) : [];
    var tl = property.timeline || [];
    return sys.filter(function (s) {
      return invs.some(function (i) { return i.system === s.key; }) ||
             tl.some(function (e) { return e && e.subject && e.subject.type === 'system' && e.subject.id === s.key; });
    });
  }

  /**
   * What a tile says under its name. Derived from the canonical index and
   * nothing else; an empty drawer says so rather than showing a number that
   * happens to be zero. Exposed so a test can hold it to the index directly.
   */
  function tileMeta(key, property, idx) {
    idx = idx || _index(property);
    var d = idx.drawers[key];
    var docs = (_docsByDrawer(property, idx)[key] || []).length;
    var info = window.PropertyReference ? window.PropertyReference.infoFor(property) : null;
    var years = _years(d.years);
    var yearLine = years.length ? years.slice(0, 4).join(' · ') + (years.length > 4 ? ' · +' + (years.length - 4) : '') : '';
    var recs = function (n) { return _plural(n, 'record'); };

    if (key === 'invoices') {
      var inv = idx.invoices;
      var bySpace = Object.keys(inv.bySpace).reduce(function (s, k) { return s + inv.bySpace[k]; }, 0);
      if (!inv.total && !bySpace) return { line1: 'No invoices yet', line2: 'Uploaded once to the property; CAM references them', empty: true };
      var ys = _years(inv.byYear);
      return {
        line1: _plural(inv.total, 'invoice') + (bySpace ? ' · ' + bySpace + ' tenant-direct' : ''),
        line2: (ys.length ? ys.slice(0, 4).join(' · ') : '') + (inv.undated ? (ys.length ? ' · ' : '') + inv.undated + ' undated' : ''),
        empty: false,
      };
    }
    if (key === 'building') {
      var sysOn = _systemsWithRecords(property);
      var hasInfo = !!info;
      if (!d.count && !sysOn.length && !hasInfo) return { line1: 'No records yet', line2: 'Roof, HVAC, warranties, photos, plans', empty: true };
      return {
        line1: (sysOn.length ? _plural(sysOn.length, 'system') + ' · ' : '') + recs(d.count) + (hasInfo ? ' · info on file' : ''),
        line2: sysOn.length ? sysOn.slice(0, 3).map(function (s) { return s.label; }).join(' · ') + (sysOn.length > 3 ? ' · More' : '') : (hasInfo ? 'Property information' : ''),
        empty: false,
      };
    }
    if (key === 'dates') {
      var up = PC().importantDates(_withInfo(property));
      if (!up.length) return { line1: 'Nothing in the next 90 days', line2: 'Lease ends, insurance, reserves', empty: true };
      var kinds = {};
      up.forEach(function (x) { kinds[x.kind] = 1; });
      var KIND_LABEL = { lease_expiration: 'Leases', insurance_renewal: 'Insurance', reserve_expiration: 'Reserves' };
      return { line1: up.length + ' upcoming', line2: Object.keys(kinds).map(function (k) { return KIND_LABEL[k] || 'Deadlines'; }).join(' · '), empty: false };
    }
    if (key === 'history') {
      var n = idx.records.length;
      if (!n) return { line1: 'No activity yet', line2: 'Everything recorded on this property', empty: true };
      var latest = idx.records.slice().sort(function (a, b) { return (new Date(b.when).getTime() || 0) - (new Date(a.when).getTime() || 0); })[0];
      return { line1: _plural(n, 'event'), line2: 'All activity' + (latest && latest.when ? ' · latest ' + _fmtDate(latest.when) : ''), empty: false };
    }
    if (key === 'financing') {
      var reserves = (property.escrowReserves || []).length;
      var srcDocs = d.sources.length;
      if (!d.count && !reserves && !srcDocs) return { line1: 'No records yet', line2: 'Loan documents, amendments, escrow', empty: true };
      // d.count already includes the reserve documents it pointed at.
      return {
        line1: recs(d.count) + (reserves ? ' · ' + _plural(reserves, 'reserve') : ''),
        line2: (srcDocs ? _plural(srcDocs, 'reserve document') : '') + (yearLine ? (srcDocs ? ' · ' : '') + yearLine : ''),
        empty: false,
      };
    }
    if (key === 'financials') {
      var rec = property.camReconciliation;
      var camLine = rec && rec.camYear ? 'CAM ' + rec.camYear + ' reconciled' : '';
      if (!d.count && !camLine) return { line1: 'No records yet', line2: 'Budgets, statements, CAM', empty: true };
      return { line1: recs(d.count), line2: [camLine, yearLine].filter(Boolean).join(' · '), empty: false };
    }
    if (key === 'insurance') {
      var policy = !!(info && (info.insuranceCarrier || info.insurancePolicyNo || info.insuranceExpires));
      if (!d.count && !docs && !policy) return { line1: 'No records yet', line2: 'Policies, certificates, claims, renewals', empty: true };
      return {
        // The policy facts live in Property information; with no records yet
        // that is what the drawer holds, so that is what the tile says.
        line1: (d.count || docs ? recs(d.count) + (docs ? ' · ' + _plural(docs, 'document') : '') : 'Policy on file'),
        line2: [info && info.insuranceExpires ? 'Renews ' + _fmtDate(info.insuranceExpires + 'T12:00:00') : '', yearLine].filter(Boolean).join(' · '),
        empty: false,
      };
    }
    // taxes · agreements
    var EMPTY2 = { taxes: 'Bills, assessments, appeals, receipts', agreements: 'Management, service, vendor, parking, easements' };
    if (!d.count) return { line1: 'No records yet', line2: EMPTY2[key] || '', empty: true };
    return {
      line1: (years.length ? _plural(years.length, 'year') + ' · ' : '') + recs(d.count) + (docs ? ' · ' + _plural(docs, 'document') : ''),
      line2: yearLine, empty: false,
    };
  }

  // What belongs in an empty drawer — the copy says what to record, and why.
  var EMPTY_COPY = {
    taxes:      'No tax records yet. Assessment notices, the annual bill, an appeal and the paid receipt are recorded here, by tax year.',
    insurance:  'No insurance records yet. The policy, its certificates, renewals and any claim are recorded here, so the building can always show what covered it.',
    financing:  'No financing records yet. The note, its amendments, escrow terms and lender correspondence are recorded here; reserve documents surface here from Reserves.',
    financials: 'No financial records yet. Budgets, owner statements and CAM reconciliation events are filed here as they happen.',
    agreements: 'No agreements yet. Management, service, vendor, parking and easement agreements for the building are recorded here.',
    building:   'Nothing recorded on the building yet. Capital improvements, warranties, inspections, repairs, photos, plans and surveys are recorded here — against the system they concern.',
    history:    'Nothing recorded for this building yet. Every record added to any drawer appears here, in order.',
  };

  // ── Landing page ───────────────────────────────────────────────────────────
  function _headerHtml(property, idx) {
    var PR = window.PropertyReference;
    var info = PR ? PR.infoFor(property) : null;
    var address = info && info.address ? String(info.address) : '';
    var totalSqft = _num(property.totalSqft) || 0;
    var occSqft = PC().activeTenants(property).reduce(function (s, t) { return s + (_num(t.leased_sqft) || 0); }, 0);
    var occPct = totalSqft > 0 ? Math.round((occSqft / totalSqft) * 100) : null;
    var sp = idx.spaces;
    var setupOpen = (function () { var c = _d('cardSetup'); return !!c && c.style.display !== 'none'; })();
    var cell = function (v, l) {
      return '<div class="pcv-snap-cell"><div class="pcv-snap-v">' + v + '</div><div class="pcv-snap-l">' + l + '</div></div>';
    };
    return '<header class="pcv-head">' +
      '<div class="pcv-head-main">' +
        '<h1 class="pcv-name">' + _esc(property.name || 'New Property') + '</h1>' +
        (address ? '<div class="pcv-addr">' + _esc(address) + '</div>' : '') +
        '<div class="pcv-snap">' +
          cell(totalSqft ? _esc(_fmtInt(totalSqft)) + ' <small>SF</small>' : '—', 'Total size') +
          cell(String(sp.total), 'Spaces') +
          cell(String(sp.occupied), 'Occupied') +
          cell(String(sp.vacant), 'Vacant') +
          cell(occPct != null ? occPct + '%' : '—', 'Occupancy') +
        '</div>' +
      '</div>' +
      '<div class="pcv-head-side">' +
        '<button type="button" class="pcv-btn pcv-btn--quiet" id="pcvEditBtn" onclick="PropertyCabinetView.toggleSetup()">' +
          _icon('edit') + (setupOpen ? 'Close editor' : 'Edit property') + '</button>' +
      '</div>' +
    '</header>' +
    '<div id="pcvSetupSlot"></div>';
  }

  function _tilesHtml(property, idx) {
    return '<div class="pcv-tiles">' + PC().DRAWERS.map(function (d) {
      var m = tileMeta(d.key, property, idx);
      return '<button type="button" class="pcv-tile' + (m.empty ? ' pcv-tile--empty' : '') + '" data-drawer="' + d.key + '"' +
        ' onclick="PropertyCabinetView.openDrawer(this.dataset.drawer)" aria-label="Open ' + _esc(d.label) + '">' +
        _icon(d.key) +
        '<span class="pcv-tile-body">' +
          '<span class="pcv-tile-t">' + _esc(d.label) + '</span>' +
          '<span class="pcv-tile-m">' + _esc(m.line1) + '</span>' +
          (m.line2 ? '<span class="pcv-tile-s">' + _esc(m.line2) + '</span>' : '') +
        '</span>' +
        '<span class="pcv-tile-go">' + _icon('go') + '</span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function _recentRows(property, idx, limit) {
    var PT = window.PropertyTimeline;
    var byId = {};
    (property.timeline || []).forEach(function (e) { if (e && e.id != null) byId[String(e.id)] = e; });
    var rows = idx.records.slice().sort(function (a, b) {
      return (new Date(b.when).getTime() || 0) - (new Date(a.when).getTime() || 0);
    });
    if (limit) rows = rows.slice(0, limit);
    return rows.map(function (p) {
      var ev = byId[p.id] || {};
      var d = (PT && PT.describe) ? PT.describe(ev) : { label: p.type || '' };
      var home = PC().drawer(p.drawer);
      return '<button type="button" class="pcv-arow" data-rec-id="' + _esc(p.id) + '" data-drawer="' + _esc(p.drawer) + '"' +
        ' onclick="PropertyCabinetView.openRecord(this.dataset.recId)" title="Open in ' + _esc(home ? home.label : 'History') + '">' +
        '<span class="pcv-arow-w">' + _esc(_fmtDate(p.when)) + '</span>' +
        '<span class="pcv-arow-b">' + _esc(d.label || p.type || '') + '</span>' +
        '<span class="pcv-arow-t">' + _esc(p.title || d.label || '') + '</span>' +
        '<span class="pcv-arow-d">' + _esc(home ? home.label : '') + '</span>' +
      '</button>';
    }).join('');
  }

  function _landingHtml(property, idx) {
    var n = idx.records.length;
    var recent = _recentRows(property, idx, RECENT);
    return '<div class="pcv">' +
      _headerHtml(property, idx) +
      '<section class="pcv-card" id="pcvAttentionCard">' +
        '<div class="pcv-card-head"><h2 class="pcv-h2">What needs your attention</h2>' +
          '<span class="pcv-count" id="pcvAttentionCount"></span>' +
          '<button type="button" class="pcv-link" onclick="PropertyCabinetView.openDrawer(\'dates\')">View all important dates ' + _icon('go') + '</button>' +
        '</div>' +
        '<div id="pcvAttention"></div>' +
      '</section>' +
      '<section class="pcv-card pcv-cabinet" id="pcvCabinet">' +
        '<div class="pcv-card-head"><h2 class="pcv-h2">Property</h2>' +
          '<span class="pcv-sub">The organized record of the whole building</span>' +
          // The one way a record gets in, reachable from the front page as well
          // as from every drawer: the existing timeline modal.
          '<span class="pcv-head-act">' + (POS() && POS().addRecordButtonHtml ? POS().addRecordButtonHtml() : '') + '</span>' +
        '</div>' +
        _tilesHtml(property, idx) +
      '</section>' +
      '<section class="pcv-card" id="pcvRecent">' +
        '<div class="pcv-card-head"><h2 class="pcv-h2">Recent activity</h2>' +
          (n ? '<button type="button" class="pcv-link" onclick="PropertyCabinetView.openDrawer(\'history\')">View all activity ' + _icon('go') + '</button>' : '') +
        '</div>' +
        (recent
          ? '<div class="pcv-arows">' + recent + '</div>' +
            (n > RECENT ? '<div class="pcv-more-note">' + (n - RECENT) + ' earlier — the complete record is in History</div>' : '')
          : '<div class="pcv-empty">Nothing recorded yet. Records added to any drawer appear here as they happen.</div>') +
      '</section>' +
    '</div>';
  }

  // ── Drawers ────────────────────────────────────────────────────────────────
  function _crumb(label) {
    return '<nav class="pcv-crumb" aria-label="Breadcrumb">' +
      '<button type="button" class="pcv-back" onclick="PropertyCabinetView.closeDrawer()">' + _icon('back') + 'Property</button>' +
      '<span class="pcv-crumb-sep">/</span><span class="pcv-crumb-cur">' + _esc(label) + '</span></nav>';
  }
  function _drawerHead(d, sub, actions) {
    return '<header class="pcv-dhead">' + _icon(d.key) +
      '<div class="pcv-dhead-main"><h1 class="pcv-dtitle">' + _esc(d.label) + '</h1>' +
        (sub ? '<div class="pcv-dsub">' + sub + '</div>' : '') + '</div>' +
      (actions ? '<div class="pcv-dactions">' + actions + '</div>' : '') +
    '</header>';
  }
  function _chip(label, on, onclick, count) {
    return '<button type="button" class="pos-chip pcv-chip' + (on ? ' pos-chip--on pcv-chip--on' : '') + '" onclick="' + onclick + '">' +
      _esc(label) + (count != null ? ' <span class="pos-chip-n">' + count + '</span>' : '') + '</button>';
  }

  // The records filed in a drawer, newest first, after the drawer's filters.
  function _drawerRecords(property, idx, key) {
    var byId = {};
    (property.timeline || []).forEach(function (e) { if (e && e.id != null) byId[String(e.id)] = e; });
    var ptrs = idx.records.filter(function (p) {
      if (key === 'history') return p.drawer === 'history';     // History is HOME only to its fallbacks
      return p.drawer === key;
    });
    var storyIds = null;
    if (_state.system && key === 'building' && POS() && POS().systemStory) {
      storyIds = {};
      POS().systemStory(property, _state.system).events.forEach(function (e) { storyIds[String(e.id)] = 1; });
    }
    return ptrs.filter(function (p) {
      if (_state.year && String(p.year == null ? 'undated' : p.year) !== String(_state.year)) return false;
      if (_state.cat && _state.cat !== 'all' && (p.category || '') !== _state.cat) return false;
      if (storyIds && !storyIds[p.id]) return false;
      return true;
    }).sort(function (a, b) {
      return (new Date(b.when).getTime() || 0) - (new Date(a.when).getTime() || 0);
    }).map(function (p) { return byId[p.id]; }).filter(Boolean);
  }

  function _recordsDrawerHtml(property, idx, key) {
    var d = PC().drawer(key);
    var dr = idx.drawers[key];
    var PT = window.PropertyTimeline;
    var docs = _docsByDrawer(property, idx)[key] || [];
    var recs = _drawerRecords(property, idx, key);
    var years = _years(dr.years);
    var info = window.PropertyReference ? window.PropertyReference.infoFor(property) : null;

    // Filters: year chips; category chips when the drawer holds more than one.
    var yearChips = '';
    if (years.length || dr.years.undated) {
      yearChips = '<div class="pcv-chips">' +
        _chip('All years', !_state.year, "PropertyCabinetView.setYear(null)", dr.count) +
        years.map(function (y) { return _chip(y, String(_state.year) === y, "PropertyCabinetView.setYear('" + y + "')", dr.years[y]); }).join('') +
        (dr.years.undated ? _chip('Undated', _state.year === 'undated', "PropertyCabinetView.setYear('undated')", dr.years.undated) : '') +
      '</div>';
    }
    var present = {};
    idx.records.forEach(function (p) { if (p.drawer === key && p.category) present[p.category] = (present[p.category] || 0) + 1; });
    var catKeys = Object.keys(present);
    var catChips = catKeys.length > 1
      ? '<div class="pcv-chips">' + _chip('All', _state.cat === 'all', "PropertyCabinetView.setCategory('all')") +
        catKeys.map(function (k) {
          var dd = (PT && PT.describe) ? PT.describe({ manual: true, category: k, type: 'manual_' + k }) : { label: k };
          return _chip(dd.label || k, _state.cat === k, "PropertyCabinetView.setCategory('" + _esc(k) + "')", present[k]);
        }).join('') + '</div>'
      : '';

    // Drawer-specific facts and views, all pointers into existing records.
    var top = '';
    if (key === 'insurance' && info && (info.insuranceCarrier || info.insurancePolicyNo || info.insuranceExpires)) {
      top += '<div class="pcv-facts"><span class="pcv-facts-k">Policy on file</span>' +
        '<span>' + _esc([info.insuranceCarrier, info.insurancePolicyNo].filter(Boolean).join(' · ')) +
        (info.insuranceExpires ? ' · expires ' + _esc(_fmtDate(info.insuranceExpires + 'T12:00:00')) : '') + '</span>' +
        '<button type="button" class="pcv-link" onclick="PropertyCabinetView.openDrawer(\'building\')">Property information ' + _icon('go') + '</button></div>';
    }
    var storyPointers = '';
    if (key === 'building') {
      top += '<details class="pcv-details"' + (recs.length ? '' : ' open') + '><summary>Property information</summary>' +
        (POS() && POS().infoHtml ? POS().infoHtml(property) : '') + '</details>';
      top += '<div class="pcv-sec-title">Building systems</div>' +
        (POS() && POS().systemsGridHtml ? POS().systemsGridHtml(property, _state.system) : '') +
        (POS() && POS().systemStoryHtml ? POS().systemStoryHtml(property, _state.system, _state.cat) : '');
      // CLICKING A SYSTEM ENDS THE SEARCH. A roof story can include records
      // whose home is another drawer — the insurance claim linked to the roof
      // job. They are listed here as POINTERS into their own drawer, so the
      // story is complete and the record still has exactly one home.
      if (_state.system && POS() && POS().systemStory) {
        var homeIds = {};
        recs.forEach(function (e) { homeIds[String(e.id)] = 1; });
        var elsewhere = POS().systemStory(property, _state.system).events.filter(function (e) {
          var f = PC().drawerOfRecord(e);
          return f && f.drawer !== 'building' && !homeIds[String(e.id)];
        });
        if (elsewhere.length) {
          storyPointers = '<div class="pcv-sec-title">Also in this story <span class="pcv-count">' + elsewhere.length + '</span></div>' +
            '<div class="pcv-arows">' + elsewhere.map(function (e) {
              var f = PC().drawerOfRecord(e); var home = PC().drawer(f.drawer);
              var dd = (PT && PT.describe) ? PT.describe(e) : { label: e.type };
              return '<button type="button" class="pcv-arow" data-rec-id="' + _esc(e.id) + '" data-drawer="' + _esc(f.drawer) + '"' +
                ' onclick="PropertyCabinetView.openRecord(this.dataset.recId)" title="Filed under ' + _esc(home ? home.label : '') + '">' +
                '<span class="pcv-arow-w">' + _esc(_fmtDate(e.timestamp)) + '</span>' +
                '<span class="pcv-arow-b">' + _esc(dd.label || e.type) + '</span>' +
                '<span class="pcv-arow-t">' + _esc(e.title || '') + '</span>' +
                '<span class="pcv-arow-d">' + _esc(home ? home.label : '') + '</span></button>';
            }).join('') + '</div>';
        }
      }
    }
    if (key === 'financials') {
      top += '<div class="pcv-sec-title">Financial snapshot</div>' + (POS() && POS().financialsHtml ? POS().financialsHtml(property) : '');
      var camRec = property.camReconciliation;
      if (camRec && camRec.camYear) {
        top += '<div class="pcv-facts"><span class="pcv-facts-k">CAM</span><span>' + _esc(String(camRec.camYear)) + ' reconciliation on file' +
          (camRec.savedAt ? ' · ' + _esc(_fmtDate(camRec.savedAt)) : '') + '</span>' +
          '<button type="button" class="pcv-link" onclick="PropertyCabinetView.goTab(\'cam\')">Open CAM ' + _icon('go') + '</button></div>';
      }
    }
    if (key === 'financing' && dr.sources.length) {
      top += '<div class="pcv-sec-title">Reserve &amp; loan documents <span class="pcv-count">' + dr.sources.length + '</span></div>' +
        '<div class="pos-docs-list">' + dr.sources.map(function (s) {
          var chip = window.docLinkHtml && s.url
            ? window.docLinkHtml(s.url, (POS() ? POS().docIcon('document') : '') + '&nbsp;<span class="pos-doc-n">' + _esc(s.name || 'document') + '</span>', { className: 'pos-doc' })
            : '<span class="pos-doc">' + _esc(s.name || 'document') + '</span>';
          return '<div class="pos-doc-row">' + chip +
            '<button type="button" class="pos-doc-on" onclick="PropertyCabinetView.goTab(\'reserves\')" title="Open the reserve this document belongs to">on: reserve ' + _esc(s.reserveId || '') + '</button>' +
            (s.when ? '<span class="pos-doc-w">' + _esc(_fmtDate(s.when)) + '</span>' : '') + '</div>';
        }).join('') + '</div>' +
        '<div class="pos-note">These files live on their reserve in the Reserves workflow; this drawer points at them.</div>';
    }

    var docsHtml = docs.length
      ? '<div class="pcv-sec-title">Documents on file <span class="pcv-count">' + docs.length + '</span></div>' +
        (POS() && POS().documentsHtml ? POS().documentsHtml(property, docs, { note: false }) : '')
      : '';

    var shown = recs.slice(0, _state.show);
    var listHtml = recs.length
      ? '<div class="pos-recs">' + shown.map(function (e) { return POS().recordCardHtml(property, e, { focusId: _state.recordId }); }).join('') + '</div>' +
        (recs.length > shown.length
          ? '<button type="button" class="pcv-btn pcv-btn--quiet pcv-more" onclick="PropertyCabinetView.showMore()">Show ' +
            Math.min(PAGE_RECORDS, recs.length - shown.length) + ' more of ' + recs.length + '</button>'
          : '')
      : '<div class="pcv-empty">' + _esc(dr.count
          ? 'Nothing filed under this filter. Choose another year or category.'
          : (EMPTY_COPY[key] || 'Nothing filed here yet.')) + '</div>';

    var sub = (dr.count ? _plural(dr.count, 'record') : 'Nothing filed yet') + (years.length ? ' · ' + years.length + (years.length === 1 ? ' year' : ' years') : '');
    var add = POS() && POS().addRecordButtonHtml ? POS().addRecordButtonHtml() : '';
    var histNote = key === 'history'
      ? '<div class="pos-note">Filed here: records with no other home. The complete activity list is below.</div>' : '';

    return '<div class="pcv pcv--drawer" data-drawer="' + key + '">' + _crumb(d.label) +
      _drawerHead(d, _esc(sub), add) +
      '<div class="pcv-dbody">' + top + histNote + yearChips + catChips + docsHtml +
        (key === 'building' || docsHtml ? '<div class="pcv-sec-title">Records <span class="pcv-count">' + recs.length + '</span></div>' : '') +
        listHtml + storyPointers +
        (key === 'history' ? _historyListHtml(property, idx) : '') +
        // Reference samples exist only on the seeded demo property, and only
        // here: the building's own document set, visibly apart from records.
        (key === 'building' && POS() && POS().sampleDocumentsHtml ? POS().sampleDocumentsHtml(property) : '') +
      '</div></div>';
  }

  // History: every property record, as rows pointing back to their home drawer.
  function _historyListHtml(property, idx) {
    var all = _recentRows(property, idx, _state.hshow);
    var n = idx.records.length;
    return '<div class="pcv-sec-title">All activity <span class="pcv-count">' + n + '</span></div>' +
      (n ? '<div class="pcv-arows pcv-arows--history">' + all + '</div>' +
           (n > _state.hshow ? '<button type="button" class="pcv-btn pcv-btn--quiet pcv-more" onclick="PropertyCabinetView.showMoreHistory()">Show ' +
             Math.min(PAGE_HISTORY, n - _state.hshow) + ' more of ' + n + '</button>' : '')
         : '<div class="pcv-empty">' + _esc(EMPTY_COPY.history) + '</div>');
  }

  function _invoicesDrawerHtml(property, idx) {
    var d = PC().drawer('invoices');
    var inv = idx.invoices;
    var q = PC().invoiceQuery(property, { q: _state.q, year: _state.year, vendor: _state.vendor,
      category: _state.category, spaceId: _state.spaceId || null, page: _state.page, pageSize: PAGE_INVOICES });
    var norm = {};
    (POS() && POS().invoices ? POS().invoices(property) : []).forEach(function (i) { if (i.id != null) norm[String(i.id)] = i; });
    var opt = function (v, label, sel) { return '<option value="' + _esc(v) + '"' + (sel ? ' selected' : '') + '>' + _esc(label) + '</option>'; };
    var years = _years(inv.byYear);
    var vendors = Object.keys(inv.byVendor).sort();
    var cats = Object.keys(inv.byCategory).sort();
    var spaces = PC().spaces(property).filter(function (s) { return s.id != null && inv.bySpace[String(s.id)]; });

    var toolbar = '<div class="pcv-toolbar">' +
      '<input type="search" class="pcv-search" id="pcvInvSearch" placeholder="Search vendor, category or file" value="' + _esc(_state.q) + '"' +
        ' oninput="PropertyCabinetView.setQuery(this.value)" aria-label="Search invoices">' +
      '<select class="pcv-select" aria-label="Year" onchange="PropertyCabinetView.setInvoiceFilter(\'year\', this.value)">' +
        opt('', 'All years', !_state.year) + years.map(function (y) { return opt(y, y + ' (' + inv.byYear[y] + ')', String(_state.year) === y); }).join('') +
        (inv.undated ? opt('undated', 'Undated (' + inv.undated + ')', _state.year === 'undated') : '') + '</select>' +
      '<select class="pcv-select" aria-label="Vendor" onchange="PropertyCabinetView.setInvoiceFilter(\'vendor\', this.value)">' +
        opt('', 'All vendors', !_state.vendor) + vendors.map(function (v) { return opt(v, v + ' (' + inv.byVendor[v] + ')', _state.vendor.toLowerCase() === v.toLowerCase()); }).join('') + '</select>' +
      '<select class="pcv-select" aria-label="Category" onchange="PropertyCabinetView.setInvoiceFilter(\'category\', this.value)">' +
        opt('', 'All categories', !_state.category) + cats.map(function (c) { return opt(c, c + ' (' + inv.byCategory[c] + ')', _state.category === c); }).join('') + '</select>' +
      (spaces.length
        ? '<select class="pcv-select" aria-label="Scope" onchange="PropertyCabinetView.setInvoiceFilter(\'spaceId\', this.value)">' +
            opt('', 'Property invoices', !_state.spaceId) +
            spaces.map(function (s) { return opt(s.id, 'Tenant-direct — ' + (s.tenant || ('Vacant' + (s.suite ? ' ' + s.suite : ''))) + ' (' + inv.bySpace[String(s.id)] + ')', _state.spaceId === String(s.id)); }).join('') +
          '</select>'
        : '') +
    '</div>';

    var from = q.total ? (q.page - 1) * q.pageSize + 1 : 0;
    var to = Math.min(q.total, q.page * q.pageSize);
    var filtered = !!(_state.q || _state.year || _state.vendor || _state.category || _state.spaceId);
    var summary = '<div class="pcv-summary" id="pcvInvSummary">' +
      (q.total ? 'Showing ' + from + '–' + to + ' of ' + _plural(q.total, 'invoice') : 'No invoices' + (filtered ? ' match' : '')) +
      (filtered ? ' · filtered' : '') + (_state.spaceId ? ' · tenant-direct, filed under the Space' : '') + '</div>';

    var rows = q.items.map(function (raw) {
      var i = raw && raw.id != null ? norm[String(raw.id)] : null;
      return i ? POS().invoiceRowHtml(property, i) : '';
    }).join('');
    var list = q.total
      ? '<div class="pos-reg">' + rows + '</div>'
      : '<div class="pcv-empty">' + (inv.total
          ? 'No invoices match these filters.'
          : 'No invoices on this property yet. Invoices are uploaded once to the property (CAM references them) and can be related to a space, a building system or CAM eligibility here.') + '</div>';
    var pager = q.pages > 1
      ? '<div class="pcv-pager">' +
          '<button type="button" class="pcv-btn pcv-btn--quiet" ' + (q.page <= 1 ? 'disabled' : '') + ' onclick="PropertyCabinetView.setPage(' + (q.page - 1) + ')">' + _icon('back') + 'Previous</button>' +
          '<span class="pcv-pager-at">Page ' + q.page + ' of ' + q.pages + '</span>' +
          '<button type="button" class="pcv-btn pcv-btn--quiet" ' + (q.page >= q.pages ? 'disabled' : '') + ' onclick="PropertyCabinetView.setPage(' + (q.page + 1) + ')">Next' + _icon('go') + '</button>' +
        '</div>'
      : '';
    var sub = inv.total ? _plural(inv.total, 'property invoice') + (years.length ? ' · ' + years[years.length - 1] + '–' + years[0] : '') : 'Nothing filed yet';
    return '<div class="pcv pcv--drawer" data-drawer="invoices">' + _crumb(d.label) +
      _drawerHead(d, _esc(sub), '') +
      '<div class="pcv-dbody">' + toolbar + summary + list + pager +
        '<div class="pos-note">Uploaded once to the property. CAM references these — it doesn’t own them.</div>' +
      '</div></div>';
  }

  function _datesDrawerHtml(property, idx) {
    var d = PC().drawer('dates');
    var all = PC().importantDates(_withInfo(property), { horizonDays: null });
    var soon = all.filter(function (x) { return x.daysOut <= 90; });
    var later = all.filter(function (x) { return x.daysOut > 90; });
    var KIND = { lease_expiration: 'Lease', insurance_renewal: 'Insurance', reserve_expiration: 'Reserve',
                 renewal: 'Renewal', deadline: 'Deadline', maturity: 'Maturity', expiry: 'Expiry', inspection: 'Inspection', permit: 'Permit' };
    var row = function (x) {
      var src = x.source || {};
      var go = src.type === 'tenant' && src.id ? "PropertyCabinetView.openSpace('" + _esc(src.id) + "')"
             : src.type === 'record' && src.id ? "PropertyCabinetView.openRecord('" + _esc(src.id) + "')"
             : src.type === 'reserve' ? "PropertyCabinetView.goTab('reserves')"
             : src.type === 'info' ? "PropertyCabinetView.openDrawer('building')"
             : x.drawer ? "PropertyCabinetView.openDrawer('" + _esc(x.drawer) + "')" : '';
      var where = src.type === 'tenant' ? 'Space' : src.type === 'reserve' ? 'Reserves' : src.type === 'info' ? 'Property information' : (PC().drawer(x.drawer) || {}).label || '';
      return '<div class="pcv-date" data-kind="' + _esc(x.kind) + '">' +
        '<span class="pcv-date-d">' + _esc(_fmtDate(x.date + 'T12:00:00')) + '</span>' +
        '<span class="pcv-date-in">' + (x.daysOut === 0 ? 'today' : x.daysOut === 1 ? 'tomorrow' : 'in ' + x.daysOut + ' days') + '</span>' +
        '<span class="pcv-date-b">' + _esc(KIND[x.kind] || 'Deadline') + '</span>' +
        '<span class="pcv-date-t">' + _esc(x.label) + '</span>' +
        (go ? '<button type="button" class="pcv-link" onclick="' + go + '">' + _esc(where) + ' ' + _icon('go') + '</button>' : '') +
      '</div>';
    };
    var body = all.length
      ? '<div class="pcv-sec-title">Next 90 days <span class="pcv-count">' + soon.length + '</span></div>' +
        (soon.length ? '<div class="pcv-dates">' + soon.map(row).join('') + '</div>' : '<div class="pcv-empty">Nothing due in the next 90 days.</div>') +
        (later.length ? '<div class="pcv-sec-title">Later <span class="pcv-count">' + later.length + '</span></div><div class="pcv-dates">' + later.map(row).join('') + '</div>' : '')
      : '<div class="pcv-empty">No upcoming dates on record. Lease end dates, the insurance expiration and reserve deadlines appear here as they are recorded — each one pointing at the record it came from.</div>';
    return '<div class="pcv pcv--drawer" data-drawer="dates">' + _crumb(d.label) +
      _drawerHead(d, all.length ? _esc(_plural(all.length, 'upcoming date')) + ' · derived from the record, never typed here' : 'Nothing upcoming on record', '') +
      '<div class="pcv-dbody">' + body + '</div></div>';
  }

  function _drawerHtml(property, idx) {
    var key = _state.drawer;
    if (!PC().drawer(key)) { _state.drawer = null; return _landingHtml(property, idx); }
    if (key === 'invoices') return _invoicesDrawerHtml(property, idx);
    if (key === 'dates') return _datesDrawerHtml(property, idx);
    return _recordsDrawerHtml(property, idx, key);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render(property, opts) {
    property = property || _prop();
    var body = _d('propertyOsBody');
    if (!body || !property) return;
    injectStyles();
    _resetFor(property);
    if (!_state.applied) {
      _state.applied = true;
      var a = PC().parseAddress(location.hash);
      if (a && a.tab === 'property' && a.drawer) {
        _state.drawer = a.drawer; _state.year = a.year || null; _state.recordId = a.recordId || null;
      }
    }
    // The setup card is a live form with listeners: park it outside the body
    // before innerHTML replaces everything, then seat it under the header.
    var setup = _d('cardSetup');
    if (setup && body.contains(setup)) body.parentNode.insertBefore(setup, body);
    var idx = _index(property);
    if (_state.recordId) _ensureShown(property, idx);
    body.innerHTML = _state.drawer ? _drawerHtml(property, idx) : _landingHtml(property, idx);
    var slot = _d('pcvSetupSlot');
    if (slot && setup) slot.appendChild(setup);
    _afterRender(property);
  }

  // A deep-linked record must be on the page, not behind "Show more".
  function _ensureShown(property, idx) {
    if (_state.drawer === 'invoices' || _state.drawer === 'dates') return;
    var recs = _drawerRecords(property, idx, _state.drawer);
    var at = recs.findIndex(function (e) { return String(e.id) === String(_state.recordId); });
    if (at >= _state.show) _state.show = at + 1;
  }

  function _afterRender(property) {
    // The attention items, from the one authority that ranks them.
    try { if (window.PropertyWorkspace && window.PropertyWorkspace.renderAttention && _d('pcvAttention')) window.PropertyWorkspace.renderAttention(property); } catch (_e) {}
    if (_state.recordId) {
      var el = document.querySelector('#propertyOsBody .pos-rec--focus');
      if (el && el.scrollIntoView) setTimeout(function () { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_e) {} }, 40);
    }
  }

  function _rerender() { var p = _prop(); if (p) render(p, { allowCollapse: false }); }

  function _writeHash() {
    var addr = PC().address({ tab: 'property', drawer: _state.drawer || null,
      year: _state.drawer ? _state.year : null, recordId: _state.drawer ? _state.recordId : null });
    try { history.replaceState(null, '', location.pathname + location.search + (addr || '#property')); } catch (_e) {}
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function openDrawer(key, opts) {
    if (!PC().drawer(key)) return false;
    var p = _prop(); if (!p) return false;
    _resetFor(p);
    if (_state.drawer !== key) _resetDrawerFilters();
    _state.drawer = key;
    if (opts) {
      if (opts.year !== undefined) _state.year = opts.year;
      if (opts.recordId !== undefined) _state.recordId = opts.recordId;
      if (opts.system !== undefined) _state.system = opts.system;
      if (opts.cat !== undefined) _state.cat = opts.cat || 'all';
    }
    try { if (window.switchWorkspaceTab) window.switchWorkspaceTab('property'); } catch (_e) {}
    _writeHash();
    render(p, { allowCollapse: false });
    var pane = _d('wsPane-property');
    if (pane && pane.scrollIntoView && !_state.recordId) {
      try { window.scrollTo({ top: Math.max(0, window.pageYOffset + pane.getBoundingClientRect().top - 12), behavior: 'smooth' }); } catch (_e) {}
    }
    return true;
  }
  function closeDrawer() {
    var p = _prop(); if (!p) return;
    _resetFor(p);
    _state.drawer = null; _resetDrawerFilters();
    _writeHash();
    render(p, { allowCollapse: false });
  }
  function goTab(tab) { try { if (window.switchWorkspaceTab) window.switchWorkspaceTab(tab); } catch (_e) {} }
  function openSpace(id) { try { if (window.TenantSpace && window.TenantSpace.openSpace) window.TenantSpace.openSpace(id); } catch (_e) {} }

  /** Open the record's own drawer, scrolled to and highlighted. A Space's record opens the Space. */
  function openRecord(recordId) {
    var p = _prop(); if (!p || recordId == null) return false;
    var ev = (p.timeline || []).find(function (x) { return x && String(x.id) === String(recordId); });
    if (!ev) return false;
    var filed = PC().drawerOfRecord(ev);
    if (!filed) {
      var sid = (ev.subject && ev.subject.id != null) ? ev.subject.id : ev.tenantId;
      if (sid != null) { openSpace(sid); return true; }
      return false;
    }
    return openDrawer(filed.drawer, { recordId: String(ev.id), year: null, cat: 'all', system: null });
  }

  /** PropertyOS.setRecordFilter arrives here: a category or system is a drawer. */
  function filter(cat, system) {
    var p = _prop(); if (!p) return;
    _resetFor(p);
    if (system) { openDrawer('building', { system: system, cat: cat && cat !== 'all' ? cat : 'all', recordId: null }); return; }
    if (cat && cat !== 'all') {
      var filed = PC().drawerOfRecord({ manual: true, category: cat, type: 'manual_' + cat, subject: { type: 'property', id: p.id } });
      openDrawer(filed ? filed.drawer : 'history', { cat: cat, system: null, recordId: null });
      return;
    }
    // 'all', no system: clear the system filter in place, or show everything.
    if (_state.drawer) { _state.system = null; _state.cat = 'all'; _state.recordId = null; _writeHash(); _rerender(); return; }
    openDrawer('history');
  }

  function setYear(y) { _state.year = y || null; _state.show = PAGE_RECORDS; _state.page = 1; _state.recordId = null; _writeHash(); _rerender(); }
  function setCategory(c) { _state.cat = c || 'all'; _state.show = PAGE_RECORDS; _state.recordId = null; _rerender(); }
  function showMore() { _state.show += PAGE_RECORDS; _rerender(); }
  function showMoreHistory() { _state.hshow += PAGE_HISTORY; _rerender(); }
  function setPage(n) { _state.page = Math.max(1, parseInt(n, 10) || 1); _rerender(); }
  function setInvoiceFilter(k, v) {
    if (k === 'year') _state.year = v || null;
    else if (k === 'vendor') _state.vendor = v || '';
    else if (k === 'category') _state.category = v || '';
    else if (k === 'spaceId') _state.spaceId = v || '';
    _state.page = 1; _rerender();
  }
  var _qTimer = null;
  function setQuery(v) {
    _state.q = v || ''; _state.page = 1;
    // Debounced so typing does not re-render every keystroke; the input keeps
    // its own value across the re-render because the markup echoes _state.q.
    clearTimeout(_qTimer);
    _qTimer = setTimeout(function () {
      var el = _d('pcvInvSearch'); var hadFocus = el && document.activeElement === el; var pos = el ? el.selectionStart : null;
      _rerender();
      if (hadFocus) { var el2 = _d('pcvInvSearch'); if (el2) { el2.focus(); try { el2.setSelectionRange(pos, pos); } catch (_e) {} } }
    }, 120);
  }

  function toggleSetup() {
    var card = _d('cardSetup'); if (!card || !POS()) return;
    var open = card.style.display === 'none';
    POS().toggleSetup(open);
    var btn = _d('pcvEditBtn');
    if (btn) btn.innerHTML = _icon('edit') + (open ? 'Close editor' : 'Edit property');
    if (open) { try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_e) {} var f = _d('propertyName'); if (f) f.focus(); }
  }

  /** Apply an address (from the hash) to the workspace. Returns what it did. */
  function applyAddress(hash) {
    var a = PC().parseAddress(hash == null ? location.hash : hash);
    if (!a) return null;
    var p = _prop();
    if (a.tab === 'spaces') {
      goTab('spaces');
      if (a.spaceId && p) openSpace(a.spaceId);
      return a;
    }
    if (a.tab === 'property') {
      if (!p) return a;
      _resetFor(p); _state.applied = true;
      if (a.drawer) openDrawer(a.drawer, { year: a.year || null, recordId: a.recordId || null });
      else { goTab('property'); if (_state.drawer) closeDrawer(); }
      return a;
    }
    return null;
  }
  var _hashBound = false;
  function _bindHash() {
    if (_hashBound) return; _hashBound = true;
    window.addEventListener('hashchange', function () { try { applyAddress(location.hash); } catch (_e) {} });
  }
  _bindHash();

  // ── Styles ─────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (_d('pcv-styles')) return;
    var gold = '#C9973A';
    var line = 'rgba(var(--line-rgb,255,255,255),';
    var css = [
      '.pcv{display:flex;flex-direction:column;gap:18px;min-width:0;}',
      '.pcv-ic{display:inline-flex;width:20px;height:20px;flex:none;color:var(--text-3,#94A3B8);}',
      '.pcv-ic svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}',
      // header
      '.pcv-head{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;padding:6px 2px 2px;}',
      '.pcv-head-main{flex:1 1 320px;min-width:0;}',
      '.pcv-head-side{flex:none;margin-left:auto;}',
      '.pcv-name{font-family:"Cormorant Garamond",Georgia,serif;font-size:2.1rem;font-weight:600;letter-spacing:-0.01em;line-height:1.05;color:var(--text-1,#E2E8F0);margin:0 0 4px;overflow-wrap:anywhere;}',
      '.pcv-addr{font-size:0.92rem;color:var(--text-3,#94A3B8);margin-bottom:14px;}',
      '.pcv-snap{display:flex;flex-wrap:wrap;gap:0;border-top:1px solid ' + line + '0.08);padding-top:10px;}',
      '.pcv-snap-cell{padding:2px 18px 2px 0;margin-right:18px;border-right:1px solid ' + line + '0.08);min-width:0;}',
      '.pcv-snap-cell:last-child{border-right:none;margin-right:0;}',
      '.pcv-snap-v{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.35rem;font-weight:700;color:var(--text-1,#E2E8F0);line-height:1.1;}',
      '.pcv-snap-v small{font-size:0.8rem;font-family:inherit;font-weight:600;color:var(--text-3,#94A3B8);}',
      '.pcv-snap-l{font-size:0.7rem;color:var(--text-4,#64748B);margin-top:2px;}',
      '.pcv-btn{display:inline-flex;align-items:center;gap:6px;font:600 0.78rem/1 inherit;border-radius:8px;padding:9px 13px;cursor:pointer;min-height:36px;white-space:nowrap;}',
      '.pcv-btn--quiet{color:var(--text-2,#CBD5E1);background:' + line + '0.03);border:1px solid ' + line + '0.14);}',
      '.pcv-btn--quiet:hover{border-color:' + gold + ';color:var(--text-1,#E2E8F0);}',
      '.pcv-btn[disabled]{opacity:0.45;cursor:default;}',
      '.pcv-btn .pcv-ic{width:15px;height:15px;color:inherit;}',
      // cards
      '.pcv-card{background:var(--theme-card,#0F1217);border:1px solid ' + line + '0.08);border-radius:14px;padding:18px 20px;min-width:0;}',
      '.pcv-card-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px;}',
      '.pcv-h2{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.35rem;font-weight:700;color:var(--text-1,#E2E8F0);margin:0;}',
      '.pcv-sub{font-size:0.78rem;color:var(--text-4,#64748B);}',
      '.pcv-head-act{margin-left:auto;}',
      '.pcv-head-act .pos-add{margin-bottom:0;padding:7px 12px;min-height:32px;font-size:0.72rem;}',
      '.pcv-count{font-size:0.66rem;font-weight:800;color:var(--text-3,#94A3B8);background:' + line + '0.07);border-radius:20px;padding:2px 8px;vertical-align:middle;}',
      '.pcv-count:empty{display:none;}',
      '.pcv-link{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font:600 0.76rem/1 inherit;color:' + gold + ';background:none;border:none;cursor:pointer;padding:4px 0;white-space:nowrap;}',
      '.pcv-link:hover{text-decoration:underline;}',
      '.pcv-link .pcv-ic{width:13px;height:13px;color:inherit;}',
      // attention (compact cards, severity colour only on the dot)
      '.pcv-attn{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;}',
      '.pcv-attn-card{display:flex;gap:10px;align-items:flex-start;text-align:left;background:var(--theme-panel,#0A0D12);border:1px solid ' + line + '0.08);border-radius:11px;padding:12px 12px 12px 13px;cursor:pointer;min-width:0;color:inherit;font:inherit;}',
      '.pcv-attn-card:hover{border-color:' + line + '0.22);}',
      '.pcv-attn-dot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:5px;}',
      '.pcv-attn-card--critical .pcv-attn-dot{background:#ef4444;}',
      '.pcv-attn-card--warning .pcv-attn-dot{background:#f59e0b;}',
      '.pcv-attn-card--info .pcv-attn-dot{background:#60a5fa;}',
      '.pcv-attn-main{flex:1;min-width:0;display:flex;flex-direction:column;}',
      '.pcv-attn-t,.pcv-attn-w,.pcv-attn-a{display:block;}',
      '.pcv-attn-t{font-size:0.84rem;font-weight:700;color:var(--text-1,#E2E8F0);overflow-wrap:anywhere;}',
      '.pcv-attn-w{font-size:0.74rem;color:var(--text-3,#94A3B8);margin-top:2px;line-height:1.4;}',
      '.pcv-attn-a{font-size:0.72rem;font-weight:600;color:' + gold + ';margin-top:6px;}',
      '.pcv-attn-clear{display:flex;align-items:center;gap:10px;font-size:0.84rem;color:var(--text-3,#94A3B8);}',
      '.pcv-attn-check{width:26px;height:26px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(22,101,52,0.2);color:#4ade80;font-weight:800;}',
      '.pcv-attn-all{margin-top:10px;font:600 0.74rem/1 inherit;color:var(--text-3,#94A3B8);background:none;border:1px solid ' + line + '0.14);border-radius:8px;padding:8px 12px;cursor:pointer;}',
      '.pcv-attn-all:hover{color:' + gold + ';border-color:' + gold + ';}',
      // tiles
      '.pcv-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:10px;}',
      '.pcv-tile{display:flex;align-items:flex-start;gap:11px;text-align:left;background:var(--theme-panel,#0A0D12);border:1px solid ' + line + '0.08);border-radius:12px;padding:14px 12px 14px 14px;cursor:pointer;min-width:0;color:inherit;font:inherit;transition:border-color .15s,transform .05s;}',
      '.pcv-tile:hover{border-color:rgba(201,151,58,0.45);}',
      '.pcv-tile:active{transform:translateY(1px);}',
      '.pcv-tile:focus-visible{outline:2px solid ' + gold + ';outline-offset:2px;}',
      '.pcv-tile .pcv-ic{width:22px;height:22px;margin-top:1px;}',
      '.pcv-tile-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;}',
      '.pcv-tile-t{font-size:0.9rem;font-weight:700;color:var(--text-1,#E2E8F0);line-height:1.2;}',
      '.pcv-tile-m{font-size:0.74rem;color:var(--text-3,#94A3B8);}',
      '.pcv-tile-s{font-size:0.7rem;color:var(--text-4,#64748B);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pcv-tile--empty .pcv-tile-m{color:var(--text-4,#64748B);}',
      '.pcv-tile-go{margin-left:auto;align-self:center;}',
      '.pcv-tile-go .pcv-ic{width:14px;height:14px;color:var(--text-4,#64748B);}',
      // activity rows
      '.pcv-arows{display:flex;flex-direction:column;}',
      '.pcv-arow{display:grid;grid-template-columns:96px auto 1fr auto;gap:10px;align-items:center;width:100%;text-align:left;background:none;border:none;border-top:1px solid ' + line + '0.06);padding:8px 2px;cursor:pointer;color:inherit;font:inherit;min-width:0;}',
      '.pcv-arow:first-child{border-top:none;}',
      '.pcv-arow:hover .pcv-arow-t{color:' + gold + ';}',
      '.pcv-arow-w{font-size:0.74rem;color:var(--text-4,#64748B);white-space:nowrap;}',
      '.pcv-arow-b{font-size:0.62rem;font-weight:800;color:var(--text-3,#94A3B8);background:' + line + '0.07);border-radius:5px;padding:2px 6px;white-space:nowrap;}',
      '.pcv-arow-t{font-size:0.82rem;color:var(--text-2,#CBD5E1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}',
      '.pcv-arow-d{font-size:0.7rem;color:var(--text-4,#64748B);white-space:nowrap;}',
      '.pcv-more-note{font-size:0.74rem;color:var(--text-4,#64748B);margin-top:8px;}',
      '.pcv-empty{font-size:0.8rem;color:var(--text-4,#64748B);line-height:1.55;}',
      // drawers
      '.pcv-crumb{display:flex;align-items:center;gap:8px;font-size:0.78rem;color:var(--text-4,#64748B);}',
      '.pcv-back{display:inline-flex;align-items:center;gap:3px;font:600 0.78rem/1 inherit;color:' + gold + ';background:none;border:none;cursor:pointer;padding:6px 0;}',
      '.pcv-back .pcv-ic{width:14px;height:14px;color:inherit;}',
      '.pcv-crumb-cur{color:var(--text-2,#CBD5E1);font-weight:600;}',
      '.pcv-dhead{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}',
      '.pcv-dhead>.pcv-ic{width:28px;height:28px;}',
      '.pcv-dhead-main{flex:1;min-width:0;}',
      '.pcv-dtitle{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.8rem;font-weight:600;color:var(--text-1,#E2E8F0);margin:0;line-height:1.1;}',
      '.pcv-dsub{font-size:0.78rem;color:var(--text-4,#64748B);margin-top:3px;}',
      '.pcv-dactions{margin-left:auto;}',
      '.pcv-dactions .pos-add{margin-bottom:0;}',
      '.pcv-dbody{background:var(--theme-card,#0F1217);border:1px solid ' + line + '0.08);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;min-width:0;}',
      '.pcv-sec-title{font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-4,#64748B);margin-top:6px;}',
      '.pcv-chips{display:flex;flex-wrap:wrap;gap:6px;}',
      '.pcv-facts{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:0.8rem;color:var(--text-2,#CBD5E1);background:var(--theme-panel,#0A0D12);border:1px solid ' + line + '0.08);border-radius:10px;padding:10px 12px;}',
      '.pcv-facts-k{font-size:0.66rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:' + gold + ';}',
      '.pcv-details>summary{cursor:pointer;font-size:0.8rem;font-weight:600;color:var(--text-2,#CBD5E1);padding:6px 0;}',
      '.pcv-more{align-self:center;}',
      // invoices
      '.pcv-toolbar{display:flex;flex-wrap:wrap;gap:8px;}',
      '.pcv-search{flex:1 1 200px;min-width:0;padding:9px 11px;border-radius:8px;border:1px solid ' + line + '0.16);background:var(--theme-panel,#0A0D12);color:var(--text-1,#E2E8F0);font:0.82rem inherit;}',
      '.pcv-select{flex:0 1 auto;max-width:100%;padding:8px 9px;border-radius:8px;border:1px solid ' + line + '0.16);background:var(--theme-panel,#0A0D12);color:var(--text-1,#E2E8F0);font:0.78rem inherit;}',
      '.pcv-search:focus,.pcv-select:focus{outline:none;border-color:' + gold + ';}',
      '.pcv-summary{font-size:0.76rem;color:var(--text-4,#64748B);}',
      '.pcv-pager{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:4px;}',
      '.pcv-pager-at{font-size:0.76rem;color:var(--text-3,#94A3B8);}',
      // dates
      '.pcv-dates{display:flex;flex-direction:column;}',
      '.pcv-date{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid ' + line + '0.06);padding:8px 2px;font-size:0.82rem;min-width:0;}',
      '.pcv-date:first-child{border-top:none;}',
      '.pcv-date-d{font-weight:700;color:var(--text-1,#E2E8F0);white-space:nowrap;min-width:96px;}',
      '.pcv-date-in{font-size:0.72rem;color:var(--text-4,#64748B);white-space:nowrap;min-width:70px;}',
      '.pcv-date-b{font-size:0.62rem;font-weight:800;color:var(--text-3,#94A3B8);background:' + line + '0.07);border-radius:5px;padding:2px 6px;white-space:nowrap;}',
      '.pcv-date-t{flex:1;min-width:0;color:var(--text-2,#CBD5E1);overflow-wrap:anywhere;}',
      // narrow
      '@media (max-width:600px){',
      '  .pcv-name{font-size:1.7rem;}',
      '  .pcv-snap-cell{padding-right:12px;margin-right:12px;}',
      '  .pcv-card{padding:14px;}',
      '  .pcv-dbody{padding:12px;}',
      '  .pcv-arow{grid-template-columns:78px 1fr;grid-template-rows:auto auto;}',
      '  .pcv-arow-b{grid-column:2;justify-self:start;}',
      '  .pcv-arow-t{grid-column:1/3;white-space:normal;overflow-wrap:anywhere;}',
      '  .pcv-arow-d{display:none;}',
      '  .pcv-head-side{margin-left:0;width:100%;}',
      '  .pcv-head-side .pcv-btn{width:100%;justify-content:center;}',
      '  .pcv-link{margin-left:0;}',
      '}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'pcv-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  return {
    render: render, state: state, tileMeta: tileMeta,
    openDrawer: openDrawer, closeDrawer: closeDrawer, openRecord: openRecord, openSpace: openSpace, goTab: goTab,
    filter: filter, setYear: setYear, setCategory: setCategory, showMore: showMore, showMoreHistory: showMoreHistory,
    setPage: setPage, setInvoiceFilter: setInvoiceFilter, setQuery: setQuery,
    toggleSetup: toggleSetup, applyAddress: applyAddress,
    PAGE_RECORDS: PAGE_RECORDS, PAGE_INVOICES: PAGE_INVOICES, PAGE_HISTORY: PAGE_HISTORY, RECENT: RECENT,
  };
})();
