/**
 * property-reference.js — Property Information & document catalogs.
 * ============================================================================
 * Reference information about a property — the facts a manager looks UP, not
 * the alerts they act ON. Deliberately separate from the "Attention Needed"
 * advisor surface: this section never nags, it answers.
 *
 * Also holds the document catalogs for the two subjects:
 *   Property-level — site plan, survey, insurance, roof warranty, etc.
 *   Space-level    — lease, amendments, estoppel, COIs, CAM backup, etc.
 *
 * DEMO DATA: the demo property (Cascade Commons) is given realistic commercial
 * real-estate values so the app reads like a live production system during a
 * demonstration. Real properties show their own `property.info` when present, or
 * an honest empty state — demo values are NEVER shown for a real property.
 *
 * Exposes: window.PropertyReference (and module.exports for tests)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PropertyReference = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Field definitions — label, group, and formatting hint. Order is display order.
  var FIELDS = [
    // Identity
    { key: 'propertyName',      label: 'Property Name',        group: 'Identity' },
    { key: 'propertyType',      label: 'Property Type',        group: 'Identity' },
    { key: 'address',           label: 'Address',              group: 'Identity' },
    { key: 'owner',             label: 'Owner',                group: 'Identity' },
    { key: 'propertyManager',   label: 'Property Manager',     group: 'Identity' },
    { key: 'parcelId',          label: 'Parcel / Tax ID',      group: 'Identity' },
    // Physical
    { key: 'yearBuilt',         label: 'Year Built',           group: 'Physical' },
    { key: 'grossSqft',         label: 'Gross Square Feet',    group: 'Physical', fmt: 'sqft' },
    { key: 'lotSize',           label: 'Lot Size',             group: 'Physical' },
    { key: 'numSpaces',         label: 'Number of Spaces',     group: 'Physical' },
    { key: 'occupancyPct',      label: 'Occupancy',            group: 'Physical', fmt: 'pct' },
    { key: 'constructionType',  label: 'Construction Type',    group: 'Physical' },
    { key: 'parkingSpaces',     label: 'Parking Spaces',       group: 'Physical' },
    { key: 'zoning',            label: 'Zoning',               group: 'Physical' },
    // Risk & systems
    { key: 'insuranceCarrier',  label: 'Insurance Carrier',    group: 'Risk & Systems' },
    { key: 'insurancePolicyNo', label: 'Policy Number',        group: 'Risk & Systems' },
    { key: 'insuranceExpires',  label: 'Insurance Expiration', group: 'Risk & Systems', fmt: 'date' },
    { key: 'roofAge',           label: 'Roof Age',             group: 'Risk & Systems' },
    { key: 'hvacSummary',       label: 'HVAC Summary',         group: 'Risk & Systems' },
    { key: 'fireProtection',    label: 'Fire Protection',      group: 'Risk & Systems' },
    { key: 'utilities',         label: 'Utilities',            group: 'Risk & Systems' },
  ];

  var GROUPS = ['Identity', 'Physical', 'Risk & Systems'];

  // ── Demo reference data (Cascade Commons) ──────────────────────────────────
  // Realistic values for a 26,000 sqft suburban retail strip center in Austin,
  // consistent with the demo's tenants, vendors, and CAM year.
  function demoInfo(property) {
    var sqft = (property && (property.totalSqft || property.sqft)) || 26000;
    return {
      propertyName:      (property && property.name) || 'Cascade Commons',
      propertyType:      'Retail — Neighborhood Strip Center',
      address:           '4820 Cascade Parkway, Austin, TX 78745',
      owner:             'Cascade Commons Holdings, LLC',
      propertyManager:   'Christy Alvarez — Regional Property Manager',
      parcelId:          'TRAVIS-02-4417-0209',
      yearBuilt:         '2003 (renovated 2019)',
      grossSqft:         sqft,
      lotSize:           '2.41 acres (104,980 sqft)',
      numSpaces:         (property && (property.tenants || []).length) || 5,
      occupancyPct:      null,     // derived at render from live tenant data
      constructionType:  'Type III-B — masonry bearing wall, steel joist roof',
      parkingSpaces:     '132 surface spaces (6 ADA) — 5.1 per 1,000 sqft',
      zoning:            'GR — Community Commercial (City of Austin)',
      insuranceCarrier:  'Travelers Commercial Property',
      insurancePolicyNo: 'TRV-CP-8843017-25',
      insuranceExpires:  '2026-09-30',
      roofAge:           'TPO membrane, installed 2019 — 7 yrs of 20 yr warranty used',
      hvacSummary:       '6 rooftop units (Carrier 48TC), 3–10 ton, installed 2019–2024',
      fireProtection:    'Wet-pipe sprinkler throughout, monitored alarm, annual inspection current',
      utilities:         'Electric: Austin Energy · Water/Waste: Austin Water · Gas: Texas Gas Service',
    };
  }

  // ── Document catalogs ──────────────────────────────────────────────────────
  function demoPropertyDocuments() {
    return [
      { name: 'Site Plan — Cascade Commons (2019 rev C).pdf',        kind: 'plan',      category: 'Site Plan',              when: '2019-06-14' },
      { name: 'ALTA Survey — Travis County.pdf',                     kind: 'pdf',       category: 'Survey',                 when: '2019-04-02' },
      { name: 'Building Plans — Shell & Core.pdf',                   kind: 'plan',      category: 'Building Plans',         when: '2003-08-21' },
      { name: 'Phase I Environmental Site Assessment.pdf',           kind: 'pdf',       category: 'Environmental Reports',  when: '2019-03-11' },
      { name: 'Travelers Property Policy TRV-CP-8843017-25.pdf',     kind: 'pdf',       category: 'Insurance Policies',     when: '2025-10-01' },
      { name: 'Roof Warranty — Carlisle TPO 20yr.pdf',               kind: 'warranty',  category: 'Roof Warranty',          when: '2019-08-30' },
      { name: 'Parking Lot Striping & Seal Plan.pdf',                kind: 'plan',      category: 'Parking Lot Plans',      when: '2025-04-22' },
      { name: 'Capital Improvement — LED Retrofit Scope.pdf',        kind: 'pdf',       category: 'Capital Improvement',    when: '2024-11-05' },
      { name: 'Building Exterior — North Elevation.jpg',             kind: 'photo',     category: 'Building Photos',        when: '2025-05-15' },
      { name: 'Building Exterior — Parking Field.jpg',               kind: 'photo',     category: 'Building Photos',        when: '2025-05-15' },
    ];
  }

  function demoSpaceDocuments(tenantName, suite) {
    var t = tenantName || 'Tenant';
    var s = suite ? ' (' + suite + ')' : '';
    return [
      { name: t + ' — Executed Lease' + s + '.pdf',                kind: 'pdf',      category: 'Lease',                 when: '2021-01-04' },
      { name: t + ' — First Amendment.pdf',                        kind: 'pdf',      category: 'Amendments',            when: '2023-03-01' },
      { name: t + ' — Estoppel Certificate.pdf',                   kind: 'pdf',      category: 'Estoppel',              when: '2025-02-18' },
      { name: t + ' — Certificate of Insurance 2026.pdf',          kind: 'pdf',      category: 'Certificates of Insurance', when: '2026-01-08' },
      { name: t + ' — 2025 CAM Reconciliation Backup.pdf',         kind: 'invoice',  category: 'CAM Backup',            when: '2026-01-31' },
      { name: t + ' — Notice of CAM True-Up.pdf',                  kind: 'pdf',      category: 'Notices',               when: '2026-02-02' },
      { name: t + ' — Correspondence (HVAC service).pdf',          kind: 'pdf',      category: 'Correspondence',        when: '2025-07-19' },
      { name: t + ' — Storefront.jpg',                             kind: 'photo',    category: 'Tenant Photos',         when: '2025-05-15' },
      { name: t + ' — Move-in Condition Report.jpg',               kind: 'photo',    category: 'Move-in / Move-out',    when: '2021-01-11' },
    ];
  }

  /**
   * True when this is the seeded demo property (never fake data for real ones).
   * The persisted row carries _demoVersion/_demoV, but the in-memory object
   * built by ensureDemoProperty does not — so also match the demo id, which is
   * deliberately constructed with a 'dec00000-' prefix (real properties get
   * random UUIDs and cannot collide with it).
   */
  function isDemo(property) {
    if (!property) return false;
    if (property._demoVersion || property._demoV) return true;
    return /^dec00000-/i.test(String(property.id || ''));
  }

  /**
   * Reference info for a property: its own `info` when present, demo values for
   * the demo property, else null (caller shows an honest empty state).
   */
  function infoFor(property) {
    if (!property) return null;
    if (property.info && typeof property.info === 'object' && Object.keys(property.info).length) return property.info;
    return isDemo(property) ? demoInfo(property) : null;
  }

  function propertyDocumentsFor(property) {
    return isDemo(property) ? demoPropertyDocuments() : [];
  }
  function spaceDocumentsFor(property, tenant) {
    if (!isDemo(property) || !tenant) return [];
    return demoSpaceDocuments(tenant.tenant_name, tenant.suite || null);
  }

  /** Live occupancy from tenant data — never a hardcoded number. */
  function occupancyPct(property) {
    if (!property) return null;
    var total = Number(property.totalSqft || property.sqft) || 0;
    if (!total) return null;
    var leased = (property.tenants || []).reduce(function (s, t) {
      return s + (Number(t && (t.leased_sqft || t.sqft)) || 0);
    }, 0);
    if (!leased) return null;
    return Math.min(100, Math.round((leased / total) * 1000) / 10);
  }

  function formatValue(field, value, property) {
    if (field.key === 'occupancyPct') {
      var live = occupancyPct(property);
      return live != null ? live + '%' : (value != null ? value + '%' : '—');
    }
    if (value === null || value === undefined || value === '') return '—';
    if (field.fmt === 'sqft') { try { return Number(value).toLocaleString() + ' sqft'; } catch (_) { return String(value); } }
    if (field.fmt === 'pct')  return value + '%';
    if (field.fmt === 'date') {
      try { return new Date(value + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
      catch (_) { return String(value); }
    }
    return String(value);
  }

  return {
    FIELDS: FIELDS, GROUPS: GROUPS,
    demoInfo: demoInfo, demoPropertyDocuments: demoPropertyDocuments, demoSpaceDocuments: demoSpaceDocuments,
    isDemo: isDemo, infoFor: infoFor,
    propertyDocumentsFor: propertyDocumentsFor, spaceDocumentsFor: spaceDocumentsFor,
    occupancyPct: occupancyPct, formatValue: formatValue,
  };
});
