/**
 * property-cabinet.js — Property Workspace V2: the filing cabinet, as data.
 * ============================================================================
 * PURE. No DOM, no network, no globals read at call time. Every function takes
 * a property (or a record) and returns plain, JSON-serialisable data. Phase 1
 * renders what this module answers; nothing here renders.
 *
 * THE ONE FINDING THIS MODULE RESTS ON
 * ------------------------------------
 * The filing cabinet already exists as data. A property-level record is a
 * timeline event with `subject.type` of 'property' or 'system' and a
 * `category` drawn from PropertyTimeline.MANUAL_CATEGORIES — real_estate_taxes,
 * insurance, mortgage_financing, warranty, capital_improvement and so on. What
 * the product lacked was a surface that files those records by drawer and
 * year instead of rendering one flat list capped at forty rows.
 *
 * So this module holds ONE map from what a record already says about itself
 * to the drawer it lives in. It is deliberately the only such map: the Property
 * tab, the Space file's "see this on the property" links, the AI's citations
 * and the MCP projection must all agree on where a record is filed, and they
 * agree by asking here.
 *
 * ONE HOME, MANY VIEWS
 * --------------------
 * A record has exactly one canonical drawer (drawerOfRecord). It may also
 * appear in History, in Important Dates, in a building-system group, in a
 * search result or in an AI answer — but each of those is a POINTER carrying
 * the record's id and drawer, never a copy of the record. There is no second
 * store here; buildIndex derives everything from property.timeline,
 * property.invoices, property.tenants, property.info and
 * property.escrowReserves, and can be thrown away and rebuilt at any time.
 *
 * WHAT IS NOT IN THE CABINET
 * --------------------------
 * A record scoped to a suite (subject.type === 'suite', or a tenantId with no
 * property/system subject) belongs to that Space's file, and drawerOfRecord
 * returns null for it. An invoice with a spaceId is the same: it files under
 * its Space, and the property Invoices drawer sees it only through a
 * "by space" filter. Vacancies are spaces, not records: see isVacant.
 *
 * Exposes: window.PropertyCabinet (and module.exports for tests)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PropertyCabinet = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ── The drawers ────────────────────────────────────────────────────────────
  //
  // `categories` are the PropertyTimeline manual categories whose canonical
  // home is this drawer. `types` are the auto-generated event types (the ones
  // registerType() knows) that file here when they are property-scoped. A key
  // named in neither list is unfiled and falls back — see FALLBACK_DRAWER.
  //
  // 'invoices' has no categories: it is a view of the invoice REGISTER
  // (property.invoices), which is its own record type. 'dates' and 'history'
  // are views over the other drawers and own nothing.
  var DRAWERS = [
    { key: 'taxes',      label: 'Real Estate Taxes',    icon: '\u{1F3DB}\u{FE0F}',
      categories: ['real_estate_taxes'], types: [] },
    { key: 'insurance',  label: 'Insurance',            icon: '\u{1F6E1}\u{FE0F}',
      categories: ['insurance'], types: [] },
    { key: 'invoices',   label: 'Invoices',             icon: '\u{1F9FE}',
      categories: [], types: [] },
    { key: 'financing',  label: 'Mortgage & Financing', icon: '\u{1F3E6}',
      categories: ['mortgage_financing'], types: ['reserve_updated'] },
    { key: 'financials', label: 'Property Financials',  icon: '\u{1F4CA}',
      categories: ['payment', 'cam'],
      types: ['cam_reconciled', 'invoice_imported', 'derived_metrics_rebuilt', 'settlement_completed'] },
    { key: 'agreements', label: 'Agreements',           icon: '\u{1F4DD}',
      // A property-scoped LEASE record is an agreement about the building (a
      // ground lease, a master lease); a tenant's own lease is suite-scoped
      // and never reaches this map.
      categories: ['vendor', 'lease'], types: [] },
    { key: 'building',   label: 'Building & Systems',   icon: '\u{1F3E2}',
      categories: ['capital_improvement', 'warranty', 'inspection', 'maintenance', 'repair',
                   'building_photo', 'survey', 'site_plan', 'building_plan', 'environmental'],
      types: [] },
    { key: 'dates',      label: 'Important Dates',      icon: '\u{1F4C5}',
      categories: [], types: [] },
    { key: 'history',    label: 'History',              icon: '\u{1F553}',
      categories: [], types: [] },
  ];

  // History is the one drawer that is both a view of everything and the home of
  // last resort. A record that names no drawer — category 'other', 'tenant' at
  // property scope, a system event like sync_restored — is not lost and is not
  // guessed into a drawer it does not belong in; it is filed under History and
  // drawerOfRecord says so with reason 'fallback', so a surface can tell a
  // deliberate filing from a default one.
  var FALLBACK_DRAWER = 'history';

  var BY_KEY = {};
  var CATEGORY_DRAWER = {};
  var TYPE_DRAWER = {};
  DRAWERS.forEach(function (d) {
    BY_KEY[d.key] = d;
    d.categories.forEach(function (c) { CATEGORY_DRAWER[c] = d.key; });
    d.types.forEach(function (t) { TYPE_DRAWER[t] = d.key; });
  });

  function drawer(key) { return BY_KEY[key] || null; }
  function drawerKeys() { return DRAWERS.map(function (d) { return d.key; }); }

  // ── Scope: whose record is this? ───────────────────────────────────────────
  //
  // Mirrors PropertyOS.propertyRecords exactly: a record is the building's when
  // it has no subject, or a 'property' or 'system' subject. Everything else —
  // a 'suite' subject, or a bare tenantId that the writer would have turned
  // into a suite subject — is a Space's.
  function scopeOf(ev) {
    if (!ev) return null;
    var t = ev.subject && ev.subject.type;
    if (!ev.subject) return ev.tenantId != null ? 'space' : 'property';
    if (t === 'property' || t === 'system') return 'property';
    return 'space';
  }

  // ── The map, applied ───────────────────────────────────────────────────────
  //
  // Returns { drawer, reason } where reason is one of:
  //   'category'  the record's manual category names this drawer
  //   'type'      its auto event type names this drawer
  //   'system'    it has no filing of its own but belongs to a building system
  //   'fallback'  nothing claimed it; filed under History
  // and null for a record that is not the property's at all.
  //
  // The record's key is read exactly as PropertyTimeline.describe() reads it,
  // so the cabinet and the timeline can never disagree about what a record is:
  // a manual event is described by its `category` (its `type` is only
  // 'manual_<category>', kept as a fallback for rows written before category
  // existed); an auto event is described by its `type`, and any `category` on
  // it is not consulted.
  function recordKey(ev) {
    if (!ev) return '';
    var stripped = ev.type != null ? String(ev.type).replace(/^manual_/, '') : '';
    if (ev.manual) return (ev.category != null && ev.category !== '') ? String(ev.category) : stripped;
    return ev.type != null ? String(ev.type) : '';
  }
  function drawerOfRecord(ev) {
    if (!ev || scopeOf(ev) !== 'property') return null;
    var key = recordKey(ev);
    if (ev.manual) {
      if (key && CATEGORY_DRAWER[key]) return { drawer: CATEGORY_DRAWER[key], reason: 'category' };
    } else {
      if (key && TYPE_DRAWER[key]) return { drawer: TYPE_DRAWER[key], reason: 'type' };
    }
    if (ev.subject && ev.subject.type === 'system') return { drawer: 'building', reason: 'system' };
    return { drawer: FALLBACK_DRAWER, reason: 'fallback' };
  }

  // An invoice is a property record unless it has been related to a space.
  function drawerOfInvoice(inv) {
    if (!inv) return null;
    return inv.spaceId ? null : 'invoices';
  }

  // Manual categories that would fall back. Exposed so a test can assert the
  // list is exactly the one this module intends, and nothing has slipped into
  // History by omission.
  function uncoveredCategories(keys) {
    return (keys || []).filter(function (k) { return !CATEGORY_DRAWER[k]; });
  }

  // ── Years ──────────────────────────────────────────────────────────────────
  function yearOf(value) {
    if (value == null || value === '') return null;
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear();
  }
  function recordYear(ev)   { return yearOf(ev && (ev.timestamp || ev.when)); }
  function invoiceYear(inv) { return yearOf(inv && (inv.invoiceDate || inv.date)); }

  // ── Vacancy ────────────────────────────────────────────────────────────────
  //
  // A vacant space is a row on property.tenants with `vacant: true`. The row
  // keeps its suite and area so the space exists on its own terms, and it is
  // NOT a lease: activeTenants() is what CAM inputs and coverage arithmetic
  // should read once Phase 1 routes them here. Nothing in this module changes
  // what CAM reads today.
  function isVacant(t) { return !!(t && t.vacant === true); }

  function activeTenants(property) {
    return ((property && property.tenants) || []).filter(function (t) {
      return t && !isVacant(t) && (t.tenant_name || t.id);
    });
  }

  function _num(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  // One row per physical space, occupied or not — the shape the Spaces list
  // renders in Phase 1. A vacant row reads 'Vacant' rather than a tenant name.
  function spaces(property) {
    return ((property && property.tenants) || [])
      .filter(function (t) { return t && (t.tenant_name || t.id || t.suite || t.unitNumber); })
      .map(function (t) {
        var vacant = isVacant(t);
        return {
          id:       t.id != null ? t.id : null,
          suite:    (t.suite || t.unitNumber || '') || null,
          tenant:   vacant ? null : (t.tenant_name || null),
          sqft:     _num(t.leased_sqft),
          leaseEnd: vacant ? null : (t.end_date || null),
          vacant:   vacant,
          status:   vacant ? 'vacant' : 'occupied',
        };
      });
  }

  // ── The index ──────────────────────────────────────────────────────────────
  //
  // Everything a drawer tile, a year filter or a count needs, computed once per
  // property load. Every entry is a POINTER: { id, drawer, year, title, when }
  // for a record, { id, year, vendor, category } for an invoice. The record
  // itself stays where it lives.
  function _pointer(ev, filed) {
    return {
      id: ev.id != null ? String(ev.id) : null,
      drawer: filed.drawer, reason: filed.reason,
      year: recordYear(ev),
      title: ev.title || ev.type || '',
      when: ev.timestamp || null,
      category: ev.category || null,
      type: ev.type || null,
      system: (ev.subject && ev.subject.type === 'system') ? (ev.subject.id || null) : null,
      attachments: Array.isArray(ev.attachments) ? ev.attachments.length : 0,
    };
  }

  function buildIndex(property) {
    var drawers = {};
    DRAWERS.forEach(function (d) {
      drawers[d.key] = { key: d.key, label: d.label, icon: d.icon,
                         count: 0, years: {}, records: [], invoices: [], sources: [] };
    });
    var bump = function (key, year) {
      var d = drawers[key]; if (!d) return;
      d.count++;
      var y = year == null ? 'undated' : String(year);
      d.years[y] = (d.years[y] || 0) + 1;
    };

    // Timeline records, each to exactly one drawer (and to History as a view).
    var records = [];
    ((property && property.timeline) || []).forEach(function (ev) {
      var filed = drawerOfRecord(ev);
      if (!filed) return;                       // a Space's record
      var ptr = _pointer(ev, filed);
      records.push(ptr);
      drawers[filed.drawer].records.push(ptr.id);
      bump(filed.drawer, ptr.year);
      if (filed.drawer !== 'history') {
        // History lists everything but counts only what it is home to, so a
        // record is never counted twice across the tiles.
        drawers.history.records.push(ptr.id);
      }
    });

    // The invoice register, property-scoped only.
    var inv = { total: 0, byYear: {}, byVendor: {}, byCategory: {}, bySpace: {}, undated: 0 };
    ((property && property.invoices) || []).forEach(function (i) {
      if (!i) return;
      var y = invoiceYear(i);
      var v = String(i.vendorName || i.vendor || '').trim();
      var c = String(i.category || 'other').trim().toLowerCase();
      if (i.spaceId) {
        inv.bySpace[String(i.spaceId)] = (inv.bySpace[String(i.spaceId)] || 0) + 1;
        return;                                 // files under its Space
      }
      inv.total++;
      if (y == null) inv.undated++; else inv.byYear[String(y)] = (inv.byYear[String(y)] || 0) + 1;
      if (v) inv.byVendor[v] = (inv.byVendor[v] || 0) + 1;
      inv.byCategory[c] = (inv.byCategory[c] || 0) + 1;
      drawers.invoices.invoices.push(i.id != null ? String(i.id) : null);
      bump('invoices', y);
    });

    // Reserve and loan documents surface under Financing as POINTERS to the
    // reserve that holds them — the reserve stays the home (decision 6).
    ((property && property.escrowReserves) || []).forEach(function (r) {
      if (!r) return;
      var docs = Array.isArray(r.sourceDocuments) ? r.sourceDocuments : [];
      docs.forEach(function (doc) {
        if (!doc) return;
        drawers.financing.sources.push({
          kind: 'reserve', reserveId: r.id != null ? String(r.id) : null,
          name: doc.fileName || null, url: doc.fileUrl || null, when: doc.uploadedAt || null,
        });
        bump('financing', yearOf(doc.uploadedAt));
      });
    });

    var sp = spaces(property);
    var vacant = sp.filter(function (s) { return s.vacant; }).length;

    return {
      drawers: drawers,
      records: records,
      invoices: inv,
      spaces: { total: sp.length, occupied: sp.length - vacant, vacant: vacant },
    };
  }

  // ── Invoices: the paging primitive ─────────────────────────────────────────
  //
  // A property with a thousand invoices is answered a page at a time. Filters
  // are ANDed; `q` matches vendor, category or file name, case-insensitively.
  // Space-scoped invoices are excluded unless `spaceId` asks for them, so the
  // property drawer and a Space file cannot both claim the same row by default.
  function invoiceQuery(property, opts) {
    opts = opts || {};
    var page = Math.max(1, parseInt(opts.page, 10) || 1);
    var size = Math.min(500, Math.max(1, parseInt(opts.pageSize, 10) || 50));
    var q = opts.q ? String(opts.q).trim().toLowerCase() : '';
    var year = opts.year != null && opts.year !== '' ? String(opts.year) : null;
    var vendor = opts.vendor ? String(opts.vendor).trim().toLowerCase() : '';
    var category = opts.category ? String(opts.category).trim().toLowerCase() : '';
    var spaceId = opts.spaceId != null && opts.spaceId !== '' ? String(opts.spaceId) : null;

    var rows = ((property && property.invoices) || []).filter(function (i) {
      if (!i) return false;
      if (spaceId) { if (String(i.spaceId || '') !== spaceId) return false; }
      else if (i.spaceId) return false;
      if (year) {
        var y = invoiceYear(i);
        if (year === 'undated' ? y != null : String(y) !== year) return false;
      }
      var v = String(i.vendorName || i.vendor || '').toLowerCase();
      var c = String(i.category || 'other').toLowerCase();
      if (vendor && v !== vendor) return false;
      if (category && c !== category) return false;
      if (q && v.indexOf(q) < 0 && c.indexOf(q) < 0 &&
          String(i.fileName || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

    // Newest first; undated last, so a missing date never floats to the top.
    rows.sort(function (a, b) {
      var ta = new Date(a.invoiceDate || a.date || 0).getTime() || 0;
      var tb = new Date(b.invoiceDate || b.date || 0).getTime() || 0;
      return tb - ta;
    });

    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / size));
    if (page > pages) page = pages;
    return {
      items: rows.slice((page - 1) * size, page * size),
      total: total, page: page, pageSize: size, pages: pages,
    };
  }

  // ── Invoices as a filing system ────────────────────────────────────────────
  //
  //   Property → Invoices → Vendor → Year → Month → Invoice
  //
  // Every level is a VIEW over property.invoices. A folder is a grouping key
  // and the invoices that carry it — never a copy, never a second store — and
  // the register's own `id` is the only identity used. An invoice is in
  // exactly one vendor folder and, within it, exactly one year (or Undated),
  // so the folder counts sum to the register. The scope rule is invoiceQuery's:
  // a space-scoped invoice is its Space's unless `spaceId` asks for it.
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var UNKNOWN_VENDOR = 'Unknown vendor';

  function _round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function _invAmount(i) { return _num(i && i.amount) || 0; }
  function _invVendor(i) { return String((i && (i.vendorName || i.vendor)) || '').trim() || UNKNOWN_VENDOR; }
  function _invInScope(i, spaceId) {
    if (!i) return false;
    if (spaceId) return String(i.spaceId || '') === String(spaceId);
    return !i.spaceId;
  }
  function _invYearKey(i) { var y = invoiceYear(i); return y == null ? 'undated' : String(y); }
  function _invMonthKey(i) {
    var d = new Date(i.invoiceDate || i.date || '');
    if (!(i.invoiceDate || i.date) || isNaN(d.getTime())) return 'undated';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function _invTime(i) { var t = new Date(i.invoiceDate || i.date || 0).getTime(); return isNaN(t) ? 0 : t; }

  /**
   * The top of the cabinet: one folder per vendor, alphabetical, each carrying
   * its dominant category, its count and total, and its years (newest first,
   * Undated last). `opts.spaceId` scopes to a Space's tenant-direct invoices.
   */
  function invoiceFolders(property, opts) {
    opts = opts || {};
    var spaceId = opts.spaceId != null && opts.spaceId !== '' ? String(opts.spaceId) : null;
    var byVendor = {};
    ((property && property.invoices) || []).forEach(function (i) {
      if (!_invInScope(i, spaceId)) return;
      // One folder per vendor however extraction cased the name — the same
      // case-insensitive identity invoiceQuery's vendor filter already uses.
      // The first spelling seen names the folder.
      var v = _invVendor(i), k = v.toLowerCase();
      var f = byVendor[k] || (byVendor[k] = { vendor: v, count: 0, total: 0, years: {}, categories: {}, undated: 0 });
      var amt = _invAmount(i);
      f.count++; f.total += amt;
      var y = _invYearKey(i);
      if (y === 'undated') f.undated++;
      var yy = f.years[y] || (f.years[y] = { year: y, count: 0, total: 0 });
      yy.count++; yy.total += amt;
      var c = String(i.category || 'other').trim().toLowerCase();
      f.categories[c] = (f.categories[c] || 0) + 1;
    });
    return Object.keys(byVendor)
      .sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); })
      .map(function (k) {
        var f = byVendor[k];
        var cats = Object.keys(f.categories).sort(function (a, b) {
          return (f.categories[b] - f.categories[a]) || a.localeCompare(b);
        });
        var years = Object.keys(f.years).filter(function (y) { return y !== 'undated'; })
          .sort(function (a, b) { return Number(b) - Number(a); })
          .map(function (y) { return f.years[y]; });
        if (f.years.undated) years.push(f.years.undated);
        return {
          vendor: f.vendor, category: cats[0] || 'other', categories: cats,
          count: f.count, total: _round2(f.total), undated: f.undated,
          years: years.map(function (y) { return { year: y.year, count: y.count, total: _round2(y.total) }; }),
        };
      });
  }

  /**
   * One folder opened: a vendor's invoices for a year (or every year when
   * `year` is null), grouped by month in calendar order, each month's
   * invoices chronological. `year === 'undated'` is the vendor's undated
   * folder. Items are the register's own rows.
   */
  function invoiceFolder(property, vendor, year, opts) {
    opts = opts || {};
    var spaceId = opts.spaceId != null && opts.spaceId !== '' ? String(opts.spaceId) : null;
    var v = String(vendor || '').trim().toLowerCase();
    var y = year != null && year !== '' ? String(year) : null;
    var byMonth = {};
    var count = 0, total = 0;
    ((property && property.invoices) || []).forEach(function (i) {
      if (!_invInScope(i, spaceId)) return;
      if (_invVendor(i).toLowerCase() !== v) return;
      var yk = _invYearKey(i);
      if (y && yk !== y) return;
      var mk = _invMonthKey(i);
      var m = byMonth[mk] || (byMonth[mk] = { key: mk, count: 0, total: 0, items: [] });
      m.count++; m.total += _invAmount(i); m.items.push(i);
      count++; total += _invAmount(i);
    });
    var months = Object.keys(byMonth)
      .sort(function (a, b) {                      // calendar order; Undated last
        if (a === 'undated') return 1;
        if (b === 'undated') return -1;
        return a < b ? -1 : a > b ? 1 : 0;
      })
      .map(function (k) {
        var m = byMonth[k];
        m.items.sort(function (a, b) { return _invTime(a) - _invTime(b); });   // chronological
        var label = k === 'undated' ? 'Undated' : MONTHS[Number(k.slice(5, 7)) - 1] + (y ? '' : ' ' + k.slice(0, 4));
        return { key: k, label: label, count: m.count, total: _round2(m.total), items: m.items };
      });
    return { vendor: vendor, year: y, count: count, total: _round2(total), months: months };
  }

  // ── Important Dates ────────────────────────────────────────────────────────
  //
  // DERIVED, NEVER AUTHORED HERE. Every date points at the record it came from,
  // and a date with no record behind it is not shown. Sources today:
  //
  //   lease_expiration     tenants[].end_date          → the Space
  //   insurance_renewal    info.insuranceExpires       → Insurance drawer
  //   reserve_expiration   escrowReserves[].deadlines  → Financing drawer
  //   <keyDateKind>        timeline event `keyDate`    → the record's drawer
  //
  // The last is read now and written later: appendPropertyTimelineEvent is an
  // allow-list and does not yet keep `keyDate`, so no event carries one today.
  // Reading it costs nothing and gives Phase 2 a target that does not move.
  var KEY_DATE_KINDS = ['renewal', 'deadline', 'maturity', 'expiry', 'inspection', 'permit'];

  function _iso(d) { return d.toISOString().slice(0, 10); }
  function _daysBetween(from, to) { return Math.round((to.getTime() - from.getTime()) / 86400000); }

  function importantDates(property, opts) {
    opts = opts || {};
    var now = opts.now ? new Date(opts.now) : new Date();
    if (isNaN(now.getTime())) now = new Date();
    // undefined = the 90-day default; an explicit null = no horizon at all.
    var horizon = opts.horizonDays === undefined ? 90 : opts.horizonDays;
    var includePast = opts.includePast === true;
    var out = [];
    var push = function (dateVal, kind, label, source, drawerKey) {
      var d = dateVal ? new Date(dateVal) : null;
      if (!d || isNaN(d.getTime())) return;                 // no date, no entry
      var days = _daysBetween(now, d);
      if (!includePast && days < 0) return;
      if (horizon != null && days > horizon) return;
      out.push({ date: _iso(d), daysOut: days, kind: kind, label: label,
                 source: source, drawer: drawerKey || null });
    };

    ((property && property.tenants) || []).forEach(function (t) {
      if (!t || isVacant(t) || !t.end_date) return;
      push(t.end_date, 'lease_expiration',
           'Lease ends — ' + (t.tenant_name || t.suite || 'tenant'),
           { type: 'tenant', id: t.id != null ? String(t.id) : null, label: t.tenant_name || null }, null);
    });

    var info = property && property.info;
    if (info && info.insuranceExpires) {
      push(info.insuranceExpires, 'insurance_renewal',
           'Insurance renews' + (info.insuranceCarrier ? ' — ' + info.insuranceCarrier : ''),
           { type: 'info', id: 'insuranceExpires', label: info.insurancePolicyNo || null }, 'insurance');
    }

    ((property && property.escrowReserves) || []).forEach(function (r) {
      var exp = r && r.deadlines && r.deadlines.reserveExpirationDate;
      if (!exp) return;
      push(exp, 'reserve_expiration',
           'Reserve expires — ' + (r.reserveTypeLabel || r.reserveType || 'reserve'),
           { type: 'reserve', id: r.id != null ? String(r.id) : null, label: r.reserveTypeLabel || null }, 'financing');
    });

    ((property && property.timeline) || []).forEach(function (ev) {
      if (!ev || !ev.keyDate) return;
      var filed = drawerOfRecord(ev);
      if (!filed) return;                                   // a Space's date is the Space's
      var kind = KEY_DATE_KINDS.indexOf(ev.keyDateKind) >= 0 ? ev.keyDateKind : 'deadline';
      push(ev.keyDate, kind, ev.title || kind,
           { type: 'record', id: ev.id != null ? String(ev.id) : null, label: ev.title || null }, filed.drawer);
    });

    out.sort(function (a, b) { return a.daysOut - b.daysOut; });
    return out;
  }

  // ── Addressing ─────────────────────────────────────────────────────────────
  //
  // The one address format for "this drawer, this year, this record", so an
  // attention item, an AI citation or an MCP answer can point into the cabinet.
  // Pure format/parse only — nothing here touches location.hash. Phase 1 wires
  // it to the tab switcher.
  //
  //   #property/taxes/2025/tl-abc            { tab:'property', drawer:'taxes', year:'2025', recordId:'tl-abc' }
  //   #property/invoices/Green%20Valley/2025/inv-7
  //                                          { tab:'property', drawer:'invoices', vendor:'Green Valley', year:'2025', recordId:'inv-7' }
  //   #spaces/mp-t1                          { tab:'spaces', spaceId:'mp-t1' }
  //
  // The Invoices drawer is the one whose address carries a VENDOR, because its
  // filing is Vendor → Year → Invoice; '-' holds an empty level open.
  var _has = function (v) { return v != null && v !== ''; };
  function address(a) {
    if (!a || !a.tab) return '';
    var parts = [a.tab];
    if (a.tab === 'spaces' && a.spaceId != null) parts.push(encodeURIComponent(String(a.spaceId)));
    if (a.tab === 'property' && a.drawer) {
      parts.push(a.drawer);
      if (a.drawer === 'invoices') {
        if (_has(a.vendor) || _has(a.year) || _has(a.recordId)) parts.push(_has(a.vendor) ? encodeURIComponent(String(a.vendor)) : '-');
        if (_has(a.year) || _has(a.recordId)) parts.push(_has(a.year) ? String(a.year) : '-');
        if (_has(a.recordId)) parts.push(encodeURIComponent(String(a.recordId)));
      } else {
        if (_has(a.year)) parts.push(String(a.year));
        if (_has(a.recordId)) {
          if (!_has(a.year)) parts.push('-');
          parts.push(encodeURIComponent(String(a.recordId)));
        }
      }
    }
    return '#' + parts.join('/');
  }

  function parseAddress(hash) {
    var s = String(hash || '').replace(/^#/, '');
    if (!s) return null;
    var parts = s.split('/').map(function (x) { try { return decodeURIComponent(x); } catch (_) { return x; } });
    var tab = parts[0];
    if (!tab) return null;
    var out = { tab: tab };
    if (tab === 'spaces' && parts[1]) out.spaceId = parts[1];
    if (tab === 'property' && parts[1]) {
      if (!BY_KEY[parts[1]]) return { tab: tab };            // unknown drawer → the tab itself
      out.drawer = parts[1];
      if (out.drawer === 'invoices') {
        if (parts[2] && parts[2] !== '-') out.vendor = parts[2];
        if (parts[3] && parts[3] !== '-') out.year = parts[3];
        if (parts[4]) out.recordId = parts[4];
      } else {
        if (parts[2] && parts[2] !== '-') out.year = parts[2];
        if (parts[3]) out.recordId = parts[3];
      }
    }
    return out;
  }

  return {
    DRAWERS: DRAWERS, FALLBACK_DRAWER: FALLBACK_DRAWER, KEY_DATE_KINDS: KEY_DATE_KINDS,
    drawer: drawer, drawerKeys: drawerKeys,
    scopeOf: scopeOf, drawerOfRecord: drawerOfRecord, drawerOfInvoice: drawerOfInvoice,
    uncoveredCategories: uncoveredCategories,
    yearOf: yearOf, recordYear: recordYear, invoiceYear: invoiceYear,
    isVacant: isVacant, activeTenants: activeTenants, spaces: spaces,
    buildIndex: buildIndex, invoiceQuery: invoiceQuery, importantDates: importantDates,
    invoiceFolders: invoiceFolders, invoiceFolder: invoiceFolder, MONTHS: MONTHS, UNKNOWN_VENDOR: UNKNOWN_VENDOR,
    address: address, parseAddress: parseAddress,
  };
});
