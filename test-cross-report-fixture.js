'use strict';
/**
 * test-cross-report-fixture.js — one Test 2 reconciliation, driven through the
 * real report builders.
 *
 * The five reports are written in three different files against three different
 * sets of module globals, which is exactly why they were free to disagree. This
 * module builds ONE fixture and exposes ONE function per report, each running
 * the real code out of script.js / lease-review-packets.js, so a test can put
 * two reports' numbers side by side and fail when they differ.
 *
 * THE FIXTURE
 * Reconstructed from the Test 2 reconciliation as reported:
 *   · four leases expired years before the CAM year, all still receiving CAM
 *   · a $38,000 invoice, 52.8% of the $71,950 pool — over the 40% threshold
 *   · one invoice with no invoice date
 *   · one low-confidence extraction and one low-confidence tenant match
 *   · Digital River: 18.54% stated in the lease vs 22.25% derived from sqft
 *
 * The lease end dates are stored exactly as the leases record them
 * (`2016-02-28`, `2003-07-31`, `2008-04-30`) — the values the reports were
 * observed to render one day earlier are these same values, not different ones.
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT       = __dirname;
const scriptSrc  = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

function extract(pattern, label) {
  const m = scriptSrc.match(pattern);
  if (!m) throw new Error(`${label} not found in script.js`);
  return m[0];
}
function fn(name) {
  return extract(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}\\n`), name);
}

// ── The fixture ─────────────────────────────────────────────────────────────

const CAM_YEAR   = 2026;
const EVAL_DATE  = `${CAM_YEAR}-12-31`;
const TOTAL_SQFT = 80000;
const POOL       = 71950;

// Lease end dates as stored. Two of the three fall on a month end; SHONAC's does
// not (2016 is a leap year, so February ends on the 29th). That matters: it rules
// out "month-end rounding" as an explanation for the observed off-by-one and
// leaves only a rendering shift, which applies to all three equally.
const TENANTS = [
  { id: 'shonac', tenant_name: 'SHONAC',        name: 'SHONAC',
    leased_sqft: 12000, lease_type: 'NNN', start_date: '2011-03-01', end_date: '2016-02-28',
    pro_rata_share: null, excludedCategories: [] },
  { id: 'digriv', tenant_name: 'Digital River', name: 'Digital River',
    leased_sqft: 17800, lease_type: 'NNN', start_date: '1998-08-01', end_date: '2003-07-31',
    // The share written into the executed lease. 17,800 / 80,000 = 22.25%.
    pro_rata_share: 18.54, excludedCategories: [] },
  { id: 'tollgr', tenant_name: 'Tollgrade',     name: 'Tollgrade',
    leased_sqft: 9400,  lease_type: 'NNN', start_date: '2003-05-01', end_date: '2008-04-30',
    pro_rata_share: null, excludedCategories: [] },
  { id: 'fourth', tenant_name: 'Fourth Tenant Co', name: 'Fourth Tenant Co',
    leased_sqft: 6200,  lease_type: 'NNN', start_date: '2000-10-01', end_date: '2005-09-30',
    pro_rata_share: null, excludedCategories: [],
    _confidence: 'low', _confidenceScore: 42 },
];

const pct = (sf) => (sf / TOTAL_SQFT) * 100;
const RESULTS = TENANTS.map(t => ({
  tenantId:       t.id,
  name:           t.name,
  sqFt:           t.leased_sqft,
  proRata:        pct(t.leased_sqft) / 100,
  proRataPercent: pct(t.leased_sqft),
  totalAllocated: Math.round(POOL * pct(t.leased_sqft)) / 100,
  // ReconciliationResult assigns allocatedAmount from totalAllocated and the
  // penny-adjustment path keeps them in lockstep; surfaces read one or the
  // other. Carrying only one here made a report print $NaN.
  allocatedAmount: Math.round(POOL * pct(t.leased_sqft)) / 100,
  ambiguityFlags: [],
  includedInvoices: [],
  capApplied: false,
  capAdjustment: 0,
}));

const INVOICES = [
  { vendorName: 'Metro Facility Services', vendor: 'Metro Facility Services',
    amount: 38000, category: 'janitorial',  invoiceDate: '2026-03-14',
    fileName: 'metro-mar.pdf', matchConfidence: 0, confidence: { amount: 96, vendor: 94 } },
  { vendorName: 'Northline Landscaping', vendor: 'Northline Landscaping',
    amount: 14200, category: 'landscaping', invoiceDate: '2026-05-02',
    fileName: 'northline-may.pdf', matchConfidence: 0, confidence: { amount: 91, vendor: 88 } },
  { vendorName: 'Harbor Snow Removal', vendor: 'Harbor Snow Removal',
    amount: 11750, category: 'snow',        invoiceDate: null,
    fileName: 'harbor-jan.pdf', matchConfidence: 0, confidence: { amount: 88, vendor: 84 } },
  { vendorName: 'Ridgeway Electric', vendor: 'Ridgeway Electric',
    amount: 8000,  category: 'utilities',   invoiceDate: '2026-07-19',
    fileName: 'ridgeway-jul.pdf',
    // Matched a tenant partially — below the 75% direct-charge threshold.
    matchConfidence: 61, matchReason: 'tenant name partial',
    confidence: { amount: 64, vendor: 71 } },
];

const DISPUTES = [];

const PROPERTY = {
  id: 'test2', name: 'Test 2 Property',
  totalSqft: TOTAL_SQFT,
  tenants: TENANTS, disputes: DISPUTES, timeline: [],
};

// ── Shared sandbox scaffolding ──────────────────────────────────────────────

function fmt(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function engine() {
  const box = { window: {}, console, module: {}, Date, Math, Number, String, Array, JSON, isFinite, parseFloat };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'reconciliation-engine.js'), 'utf8'), box,
                  { filename: 'reconciliation-engine.js' });
  return box.window.ReconciliationEngine;
}

const RE = engine();
const AX = require('./audit-exposure.js');

function baseSandbox() {
  return {
    console: { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
    parseFloat, parseInt, isNaN, isFinite, Number, Math, Date, JSON, Set, Map,
    Array, Object, String, Boolean, RegExp,
    fmt, esc,
    lastInvoicesFull: INVOICES,
    invoiceData:      INVOICES,
    lastResults:      RESULTS,
    lastTenants:      TENANTS,
    lastTotal:        POOL,
    lastPropName:     PROPERTY.name,
    tenantData:       TENANTS,
    disputes:         DISPUTES,
    camRuns:          [],
    getCamYear:       () => CAM_YEAR,
    currentProperty:  () => PROPERTY,
    parseSqft:        (v) => parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')) || 0,
    similarVendor:    (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
    logActivity:      () => {},
    logError:         () => {},
    showToast:        () => {},
    buildHistoricalTrends: () => null,
    // The real engine, evaluated at the CAM year end so output is deterministic.
    _detectReconciliationIssues: (results, property) =>
      RE.detectReconciliationIssues(results, property || PROPERTY, EVAL_DATE),
  };
}

function run(box, src, expr) {
  vm.createContext(box);
  vm.runInContext(src + `\nthis.__out = (${expr});`, box);
  return box.__out;
}

// ── Report 1: the audit finding set (shared by Exception Summary + panel) ────

const SUSPICIONS_SRC = fn('_detectInvoiceSuspicions');

function auditSummary() {
  const box = baseSandbox();
  return run(box, SUSPICIONS_SRC + fn('buildAuditSummary'), 'buildAuditSummary()');
}

function auditNarrative() {
  const box = baseSandbox();
  box.window = { AuditExposure: AX };
  return run(box, SUSPICIONS_SRC + fn('buildAuditSummary') + fn('buildAuditNarrative'),
             'buildAuditNarrative()');
}

// ── Report 2: Audit Exception Summary ───────────────────────────────────────

function exceptionReport() {
  const box = baseSandbox();
  const captured = {};
  box.window = { AuditExposure: AX };
  box.openReport = (title, html) => { captured.title = title; captured.html = html; };
  box.logError   = (where, e) => { throw e; };
  run(box, SUSPICIONS_SRC + fn('buildAuditSummary') + fn('buildAuditNarrative')
         + fn('_rptHeader') + fn('_rptFooter') + fn('generateExceptionReport'),
      'generateExceptionReport()');
  return captured;
}

// ── Derived property metrics ────────────────────────────────────────────────
//
// The real derivePropertyMetrics out of script.js, wired to the real
// derivePropertyReadiness out of selectors.js. The health score's components
// originate there, so a stub would prove nothing about the seam between them.

function propertyMetrics(property) {
  const box = baseSandbox();
  // selectors.js is loaded outside the vm, so its closures resolve free
  // variables against Node's global rather than the sandbox — the same way the
  // page resolves them against window when each file arrives in its own <script>
  // tag. Publish them there once.
  if (!global.Selectors) {
    const sel = {};
    ['lease-intelligence.js', 'review-engine.js', 'selectors.js'].forEach(f => {
      new Function('window', fs.readFileSync(path.join(ROOT, f), 'utf8'))
        .call({ window: sel }, sel);
    });
    global.LeaseIntelligence = sel.LeaseIntelligence;
    global.ReviewEngine      = sel.ReviewEngine;
    global.Selectors         = sel.Selectors;
  }
  box.window    = { Selectors: global.Selectors, AuditExposure: AX };
  box.Selectors = global.Selectors;
  box.disputes  = property.disputes || [];
  return run(box,
    fn('getPropertyInvoiceStats') + fn('derivePropertyMetrics')
      + `\nthis.__m = derivePropertyMetrics(${JSON.stringify(property)});`,
    '__m');
}

// ── The billing gate on tenant statements ───────────────────────────────────
//
// generateTenantStatement builds a large amount of DOM-coupled HTML, so the two
// functions that decide whether a statement may be issued are exercised here
// directly. What they return is what the statement path acts on.

function statementReadiness(tenantName, findings) {
  const box = baseSandbox();
  box.window = { AuditExposure: AX };
  const src = findings
    ? `function buildAuditSummary(){ return ${JSON.stringify(findings)}; }`
    : SUSPICIONS_SRC + fn('buildAuditSummary');
  return run(box, src + fn('_statementReadinessBlock'),
             `_statementReadinessBlock(${JSON.stringify(tenantName)})`);
}

function statementBlockHtml(tenantName) {
  const box = baseSandbox();
  box.window = { AuditExposure: AX };
  const captured = {};
  box.openReport = (title, html) => { captured.title = title; captured.html = html; };
  run(box, SUSPICIONS_SRC + fn('buildAuditSummary') + fn('_statementReadinessBlock')
         + fn('_renderStatementReadinessBlock'),
      `_renderStatementReadinessBlock(_statementReadinessBlock(${JSON.stringify(tenantName)}))`);
  return captured;
}

// ── The CAM Reconciliation Summary ──────────────────────────────────────────
//
// The report the collapsed status bar was seen in, and the one carrying the
// Tenant Allocation table whose percentage column needed its denominator named.

function reconciliationSummary() {
  const box = baseSandbox();
  const captured = {};
  box.window = { AuditExposure: AX };
  box.openReport = (title, html) => { captured.title = title; captured.html = html; };
  box.logError   = (where, e) => { throw e; };
  box._deriveCalcState = () => ({ cls: 'ok', label: 'Pro-rata' });
  box.buildHistoricalTrends = () => null;
  run(box, SUSPICIONS_SRC + fn('buildAuditSummary') + fn('buildAuditNarrative')
         + fn('_rptHeader') + fn('_rptFooter') + fn('generateReconciliationSummary'),
      'generateReconciliationSummary()');
  return captured;
}

// ── Report 3: Coverage Gap ──────────────────────────────────────────────────
//
// generateHolesReport writes straight into the DOM, so it runs here against a
// document stub that records what it was handed. Only its computed item lists
// are read; no assertion depends on the stub.

function coverageGap() {
  const box = baseSandbox();
  const captured = {};
  box.document = {
    getElementById: (id) => ({
      value: id === 'propertyName' ? PROPERTY.name : '',
      style: {}, textContent: '',
      set innerHTML(v) { captured.html = v; },
      get innerHTML() { return captured.html || ''; },
      scrollIntoView() {},
    }),
  };
  box.window = { scrollTo() {} };
  box.openReport = (title, html) => { captured.title = title; captured.html = html; };
  run(box, SUSPICIONS_SRC + fn('buildAuditSummary') + fn('_rptHeader') + fn('_rptFooter')
         + fn('generateHolesReport'),
      'generateHolesReport()');
  return captured;
}

// ── Report 4: Risk & Disputes ───────────────────────────────────────────────
//
// generateLandlordExport pulls in property metrics and the timeline; both are
// stubbed to their empty shape so the assertions land on the counts the report
// derives itself, which is where the divergence lives.

function riskAndDisputes() {
  const box = baseSandbox();
  const captured = {};
  box.window = { AuditExposure: AX };
  box.rebuildDerivedState      = () => {};
  // The real shape, including the field that caused the defect: financialStats
  // .totalCAM is the sum of allocatedAmount — the amount billed OUT — despite
  // its name. Returning {} here would stub away the exact thing that broke, so
  // a regression could not be detected.
  box.derivePropertyMetrics    = () => ({
    financialStats: {
      totalCAM:      Math.round(RESULTS.reduce((s, r) => s + r.totalAllocated, 0)),
      totalAllocated: Math.round(RESULTS.reduce((s, r) => s + r.totalAllocated, 0) * 100) / 100,
      allocationCoveragePct: 57,
    },
    disputeStats: { openDisputes: DISPUTES.filter(d => d.status === 'open').length },
  });
  box.derivePropertyTimeline   = () => ({ recentActivity: [] });
  box.appendPropertyTimelineEvent = () => {};
  box._deriveCalcState         = () => ({ cls: 'ok', label: 'Pro-rata' });
  box._DISPUTE_TYPES           = {};
  box._DISPUTE_SEV             = {};
  box.openReport = (title, html) => { captured.title = title; captured.html = html; };
  // Rethrow rather than let the report's own try/catch turn a harness mistake
  // into an empty report that silently passes.
  box.logError = (where, e) => { throw e; };
  run(box, SUSPICIONS_SRC + fn('buildAuditSummary') + fn('_rptHeader') + fn('_rptFooter')
         + fn('generateLandlordExport'),
      'generateLandlordExport()');
  return captured;
}

// ── Report 3: Lender Summary ────────────────────────────────────────────────

// lease-review-packets.js is a browser module that publishes onto `window`.
global.window = global.window || {};
global.window.AuditExposure = global.window.AuditExposure || AX;
require('./lease-review-packets.js');
const LRP = global.window.LeaseReviewPackets;

function lenderSummary(auditState) {
  return LRP.generateLenderSummaryHtml(PROPERTY, auditState);
}

module.exports = {
  CAM_YEAR, EVAL_DATE, TOTAL_SQFT, POOL,
  TENANTS, RESULTS, INVOICES, DISPUTES, PROPERTY,
  AX, RE, fmt, esc,
  auditSummary, auditNarrative, exceptionReport, coverageGap, riskAndDisputes, lenderSummary,
  reconciliationSummary,
  statementReadiness, statementBlockHtml, propertyMetrics,
  baseSandbox, extract, fn, run,
};
