/**
 * qa-harness.js
 * Deterministic engine validation — no DOM, no network, no rendering.
 * Load after: review-engine.js, reconciliation-engine.js, audit-service.js, selectors.js
 * Load after: fixtures/*.js
 *
 * Entry point: window.runMainstreetQA()
 * Returns:     { passed, failed, warnings, snapshots, suites }
 *
 * Exposes: window.QAHarness, window.runMainstreetQA
 */
window.QAHarness = (() => {
  'use strict';

  // ── Micro assertion engine ─────────────────────────────────────────────────

  function createSuite(name) {
    const results = [];

    function pass(msg)       { results.push({ passed: true,  msg }); }
    function fail(msg, ctx)  { results.push({ passed: false, msg, ctx: ctx ?? null }); }

    function assert(cond, msg, ctx) {
      cond ? pass(msg) : fail(msg, ctx);
    }
    function assertEq(a, b, msg) {
      const ok = JSON.stringify(a) === JSON.stringify(b);
      ok ? pass(msg) : fail(msg, { expected: b, actual: a });
    }
    function assertType(val, type, msg) {
      typeof val === type ? pass(msg) : fail(msg, { expected: type, actual: typeof val, value: val });
    }
    function assertNoNaN(val, msg) {
      (typeof val === 'number' && !isNaN(val) && isFinite(val))
        ? pass(msg) : fail(msg, { value: val });
    }
    function assertRange(val, lo, hi, msg) {
      (typeof val === 'number' && val >= lo && val <= hi)
        ? pass(msg) : fail(msg, { value: val, lo, hi });
    }
    function assertNoDuplicates(arr, keyFn, msg) {
      const keys = (arr || []).map(keyFn || (x => x));
      const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
      dups.length === 0 ? pass(msg) : fail(msg, { duplicates: dups });
    }

    return { name, assert, assertEq, assertType, assertNoNaN, assertRange, assertNoDuplicates, results };
  }

  // ── ReviewEngine suite ─────────────────────────────────────────────────────

  function suiteReviewEngine(fx) {
    const s  = createSuite('ReviewEngine');
    const RE = window.ReviewEngine;
    if (!RE) { s.assert(false, 'ReviewEngine not loaded'); return s; }

    const propA = fx.samplePropertyA;
    const propM = fx.malformedLease;
    const propD = fx.disputeHeavy;
    const reconA = propA?.camReconciliation?.results ?? [];

    // ── Verified tenant (Anchor Coffee: NNN, cap set, high confidence) ──
    const anchorT = propA?.tenants?.[0];
    const anchorR = RE.deriveTenantReviewState(anchorT, reconA);
    s.assertEq(anchorR.status, 'verified',       'Anchor Coffee → verified');
    s.assertEq(anchorR.score,  100,              'Anchor Coffee score === 100');
    s.assertNoNaN(anchorR.score,                 'Anchor Coffee score not NaN');
    s.assertRange(anchorR.score, 0, 100,         'Anchor Coffee score in [0,100]');
    s.assertNoDuplicates(anchorR.warnings, w => w.type, 'Anchor Coffee: no duplicate warnings');
    s.assertEq(anchorR.warnings.length, 0,       'Anchor Coffee: zero warnings');

    // ── Summit Fitness: also verified ──
    const summitR = RE.deriveTenantReviewState(propA?.tenants?.[1], reconA);
    s.assertEq(summitR.status, 'verified',       'Summit Fitness → verified');

    // ── Metro Bank: NNN, no cap → needs_review ──
    const metroT = propA?.tenants?.[2];
    const metroR = RE.deriveTenantReviewState(metroT, reconA);
    s.assertEq(metroR.status, 'needs_review',    'Metro Bank (NNN no cap) → needs_review');
    s.assert(metroR.warnings.some(w => w.type === 'nnn_cap_missing'),
      'Metro Bank has nnn_cap_missing warning');
    s.assertRange(metroR.score, 0, 100,          'Metro Bank score in [0,100]');
    s.assertNoDuplicates(metroR.warnings, w => w.type, 'Metro Bank: no duplicate warnings');

    // ── extractionFailed tenant → incomplete ──
    const failT = propM?.tenants?.[0];
    const failR = RE.deriveTenantReviewState(failT, []);
    s.assertEq(failR.status, 'incomplete',       'extractionFailed → incomplete');
    s.assert(failR.warnings.some(w => w.type === 'missing_lease_type'),
      'extractionFailed: missing_lease_type warning');
    s.assert(failR.warnings.some(w => w.type === 'missing_sqft'),
      'extractionFailed: missing_sqft warning');
    s.assertRange(failR.score, 0, 100,           'extractionFailed score in [0,100]');

    // ── _usedFallback + low confidence + NNN no cap → needs_review ──
    const fbT = propM?.tenants?.[1];
    const fbR = RE.deriveTenantReviewState(fbT, []);
    s.assertEq(fbR.status, 'needs_review',       '_usedFallback → needs_review');
    s.assert(fbR.warnings.some(w => w.type === 'fallback_extraction'),
      '_usedFallback: fallback_extraction warning');
    s.assert(fbR.warnings.some(w => w.type === 'low_sqft_confidence'),
      '_usedFallback: low_sqft_confidence warning');
    s.assert(fbR.warnings.some(w => w.type === 'nnn_cap_missing'),
      '_usedFallback NNN: nnn_cap_missing warning');
    s.assertNoDuplicates(fbR.warnings, w => w.type, '_usedFallback: no duplicate warnings');

    // ── reviewerConfirmed → manually_verified ──
    const verT = propD?.tenants?.[0];
    const verR = RE.deriveTenantReviewState(verT, []);
    s.assertEq(verR.status, 'manually_verified', 'reviewerConfirmed → manually_verified');
    s.assertEq(verR.reviewerConfirmed, true,     'reviewerConfirmed flag preserved');
    s.assertEq(verR.reviewedBy, 'Jane Smith',    'reviewedBy preserved');
    s.assertEq(verR.notes, 'Verified against executed lease — all figures match.', 'notes preserved');

    // ── Determinism ──
    const d1 = RE.deriveTenantReviewState(anchorT, reconA);
    const d2 = RE.deriveTenantReviewState(anchorT, reconA);
    s.assertEq(
      { status: d1.status, score: d1.score, wt: d1.warnings.map(w => w.type) },
      { status: d2.status, score: d2.score, wt: d2.warnings.map(w => w.type) },
      'deriveTenantReviewState is deterministic'
    );

    // ── getWarnings ──
    const ws = RE.getWarnings(['no_term_in_doc', 'lease_type_missing', 'approx_sqft_detected']);
    s.assertEq(ws.length, 3,                     'getWarnings returns 3 items');
    s.assert(ws[0].includes('No lease term'),    'getWarnings: no_term_in_doc mapped');
    s.assert(ws[1].includes('Lease type'),       'getWarnings: lease_type_missing mapped');
    s.assert(ws[2].includes('pprox'),            'getWarnings: approx_sqft_detected mapped');

    // ── urgencyClass ──
    s.assertEq(RE.urgencyClass(40),  'rq-critical', 'urgencyClass(40) → rq-critical');
    s.assertEq(RE.urgencyClass(70),  'rq-moderate', 'urgencyClass(70) → rq-moderate');
    s.assertEq(RE.urgencyClass(85),  'rq-healthy',  'urgencyClass(85) → rq-healthy');
    s.assertEq(RE.urgencyClass(50),  'rq-moderate', 'urgencyClass(50) → rq-moderate (boundary)');
    s.assertEq(RE.urgencyClass(80),  'rq-healthy',  'urgencyClass(80) → rq-healthy (boundary)');

    return s;
  }

  // ── ReconciliationEngine suite ─────────────────────────────────────────────

  function suiteReconciliationEngine(fx) {
    const s   = createSuite('ReconciliationEngine');
    const RCE = window.ReconciliationEngine;
    if (!RCE) { s.assert(false, 'ReconciliationEngine not loaded'); return s; }

    const propA   = fx.samplePropertyA;
    const propB   = fx.samplePropertyB;
    const reconA  = propA?.camReconciliation?.results ?? [];
    const reconB  = propB?.camReconciliation?.results ?? [];
    const evalDate = '2025-12-31';

    // ── Clean property → no issues ──
    const cleanIssues = RCE.detectReconciliationIssues(reconA, propA, evalDate);
    s.assertEq(cleanIssues.length, 0,            'Sample A (clean NNN) → no issues');

    // ── Null / empty edge cases ──
    s.assertEq(RCE.detectReconciliationIssues(null,  propA, evalDate).length, 0, 'null results → no issues');
    s.assertEq(RCE.detectReconciliationIssues([],    propA, evalDate).length, 0, 'empty results → no issues');

    // ── Sample B → 4 expected flags ──
    const bIssues = RCE.detectReconciliationIssues(reconB, propB, evalDate);
    s.assert(bIssues.length >= 4,               'Sample B → at least 4 issues');

    s.assert(bIssues.some(i => i.severity === 'red'    && /Expired/i.test(i.title)),
      'Sample B → expired lease flag (red)');
    s.assert(bIssues.some(i => i.severity === 'yellow' && /Cap applied/i.test(i.title)),
      'Sample B → cap applied flag (yellow)');
    s.assert(bIssues.some(i => /Pro-rata coverage gap/i.test(i.title)),
      'Sample B → pro-rata gap flag');
    s.assert(bIssues.some(i => i.severity === 'yellow' && /Gross-lease/i.test(i.title)),
      'Sample B → gross lease CAM flag (yellow)');

    // 8% gap → red (|gap| > 5)
    const gapFlag = bIssues.find(i => /Pro-rata coverage gap/i.test(i.title));
    s.assertEq(gapFlag?.severity, 'red',         'Pro-rata 8% gap → red severity');

    // ── All issues have required shape ──
    bIssues.forEach((issue, i) => {
      s.assertType(issue.severity,   'string', `issue[${i}].severity is string`);
      s.assertType(issue.title,      'string', `issue[${i}].title is string`);
      s.assertType(issue.detail,     'string', `issue[${i}].detail is string`);
      s.assert(Array.isArray(issue.conditions), `issue[${i}].conditions is array`);
      s.assert(issue.conditions.length > 0,     `issue[${i}].conditions not empty`);
    });

    // ── Determinism ──
    const run1 = RCE.detectReconciliationIssues(reconB, propB, evalDate).map(i => i.title);
    const run2 = RCE.detectReconciliationIssues(reconB, propB, evalDate).map(i => i.title);
    s.assertEq(run1, run2,                       'detectReconciliationIssues is deterministic');

    // ── deriveCalcState ──
    const tConf = { lease_type: 'NNN', confidence: { leased_sqft: 95 }, doc_has_lease_type: true };
    const tLow  = { lease_type: 'NNN', confidence: { leased_sqft: 55 }, doc_has_lease_type: true };
    const tNone = { lease_type: null,  confidence: {},                   doc_has_lease_type: false };

    s.assertEq(RCE.deriveCalcState({ ambiguityFlags: [{ code: 'NNN_GROSS_UNKNOWN' }] }, tConf).state,
      'missing_inputs', 'deriveCalcState: NNN_GROSS_UNKNOWN → missing_inputs');
    s.assertEq(RCE.deriveCalcState({ ambiguityFlags: [{ code: 'SQFT_APPROXIMATE' }] }, tConf).state,
      'missing_inputs', 'deriveCalcState: SQFT_APPROXIMATE → missing_inputs');
    s.assertEq(RCE.deriveCalcState({ ambiguityFlags: [{ code: 'SQFT_OVERFLOW' }] }, tConf).state,
      'partial', 'deriveCalcState: SQFT_OVERFLOW → partial');
    s.assertEq(RCE.deriveCalcState({ ambiguityFlags: [{ code: 'BASE_YEAR_MISMATCH' }] }, tConf).state,
      'partial', 'deriveCalcState: BASE_YEAR_MISMATCH → partial');
    s.assertEq(RCE.deriveCalcState({ ambiguityFlags: [] }, tConf).state,
      'verified', 'deriveCalcState: no flags + high conf → verified');
    s.assertEq(RCE.deriveCalcState({ ambiguityFlags: [] }, tLow).state,
      'estimated', 'deriveCalcState: no flags + low conf → estimated');
    s.assertEq(RCE.deriveCalcState({ ambiguityFlags: [] }, tNone).state,
      'estimated', 'deriveCalcState: no lease_type → estimated');

    // CSS classes
    const cs = RCE.deriveCalcState({ ambiguityFlags: [] }, tConf);
    s.assertType(cs.label, 'string',             'deriveCalcState.label is string');
    s.assertType(cs.cls,   'string',             'deriveCalcState.cls is string');

    return s;
  }

  // ── AuditService suite ─────────────────────────────────────────────────────

  function suiteAuditService() {
    const s  = createSuite('AuditService');
    const AS = window.AuditService;
    if (!AS) { s.assert(false, 'AuditService not loaded'); return s; }

    const ev = AS.shapeEvent('lease_update', 'Lease updated', {
      detail:         'Changed NNN cap to 5%',
      severity:       'success',
      actor:          'Jane Smith',
      relatedEntity:  'Tenant: Harbor Café',
      financialImpact:'$1,200',
      propertyId:     'prop-001',
      tenantId:       'tenant-001',
    });

    // ── All 10 required fields present ──
    ['type','title','detail','severity','timestamp','actor','relatedEntity','financialImpact','propertyId','tenantId']
      .forEach(f => s.assert(f in ev, `shapeEvent has field: ${f}`));

    // ── Field values preserved ──
    s.assertEq(ev.type,           'lease_update',        'type preserved');
    s.assertEq(ev.title,          'Lease updated',       'title preserved');
    s.assertEq(ev.detail,         'Changed NNN cap to 5%', 'detail preserved');
    s.assertEq(ev.severity,       'success',             'valid severity preserved');
    s.assertEq(ev.actor,          'Jane Smith',          'actor preserved');
    s.assertEq(ev.propertyId,     'prop-001',            'propertyId preserved');
    s.assertEq(ev.tenantId,       'tenant-001',          'tenantId preserved');

    // ── String fields are strings ──
    ['type','title','detail','severity','timestamp','actor','relatedEntity','financialImpact']
      .forEach(f => s.assertType(ev[f], 'string', `${f} is string`));

    // ── Timestamp is ISO 8601 ──
    s.assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(ev.timestamp),
      'timestamp matches ISO 8601');

    // ── Invalid severity → 'info' ──
    s.assertEq(AS.shapeEvent('t','t',{ severity: 'critical' }).severity, 'info',
      'invalid severity → info');
    s.assertEq(AS.shapeEvent('t','t',{ severity: '' }).severity, 'info',
      'empty severity → info');

    // ── Missing / empty type → 'unknown' ──
    s.assertEq(AS.shapeEvent('',  't').type, 'unknown', 'empty type → unknown');
    s.assertEq(AS.shapeEvent(null,'t').type, 'unknown', 'null type → unknown');

    // ── Defaults ──
    const d = AS.shapeEvent('x', 'y');
    s.assertEq(d.actor,          'System', 'default actor → System');
    s.assertEq(d.detail,         '',       'default detail → empty string');
    s.assertEq(d.relatedEntity,  '',       'default relatedEntity → empty string');
    s.assertEq(d.financialImpact,'',       'default financialImpact → empty string');
    s.assertEq(d.propertyId,     null,     'default propertyId → null');
    s.assertEq(d.tenantId,       null,     'default tenantId → null');

    // ── All 4 valid severities pass through ──
    ['info','success','warning','error'].forEach(sev =>
      s.assertEq(AS.shapeEvent('t','t',{ severity: sev }).severity, sev,
        `severity '${sev}' passes through`)
    );

    // ── Determinism (non-timestamp fields) ──
    const e1 = AS.shapeEvent('a','b',{ severity: 'warning', actor: 'Bot' });
    const e2 = AS.shapeEvent('a','b',{ severity: 'warning', actor: 'Bot' });
    s.assertEq(
      { type: e1.type, title: e1.title, severity: e1.severity, actor: e1.actor },
      { type: e2.type, title: e2.title, severity: e2.severity, actor: e2.actor },
      'shapeEvent non-timestamp fields are deterministic'
    );

    return s;
  }

  // ── Selectors suite ────────────────────────────────────────────────────────

  function suiteSelectors(fx) {
    const s   = createSuite('Selectors');
    const SEL = window.Selectors;
    if (!SEL) { s.assert(false, 'Selectors not loaded'); return s; }

    const propA     = fx.samplePropertyA;
    const propB     = fx.samplePropertyB;
    const propM     = fx.malformedLease;
    const propD     = fx.disputeHeavy;
    const allProps  = [propA, propB, propM, propD].filter(Boolean);

    // ── portfolioKPIs ──
    const kpis = SEL.portfolioKPIs(allProps);
    s.assertEq(kpis.properties, 4,               'portfolioKPIs.properties === 4');
    s.assertType(kpis.cam,               'number','portfolioKPIs.cam is number');
    s.assertType(kpis.openDisputes,      'number','portfolioKPIs.openDisputes is number');
    s.assertType(kpis.criticalOrElevated,'number','portfolioKPIs.criticalOrElevated is number');
    s.assertType(kpis.totalMissingDocs,  'number','portfolioKPIs.totalMissingDocs is number');
    // avgConf is number | null — both are valid
    s.assert(kpis.avgConf === null || (typeof kpis.avgConf === 'number' && !isNaN(kpis.avgConf)),
      'portfolioKPIs.avgConf is number or null');
    s.assertEq(SEL.portfolioKPIs([]).properties, 0, 'portfolioKPIs([]) → 0 properties');

    // ── getReviewQueueItems ──
    // propA: Anchor+Summit are verified (excluded), Metro → needs_review = 1 item
    const qA = SEL.getReviewQueueItems([propA]);
    s.assertEq(qA.length, 1,                     'propA queue: 1 item (2 verified excluded)');
    s.assertEq(qA[0].tenantId, 't-a-003',        'propA queue: Metro Bank is the item');
    s.assertEq(qA[0].reviewState, 'needs_review','propA queue item state === needs_review');

    // propM: both tenants need attention = 2 items
    const qM = SEL.getReviewQueueItems([propM]);
    s.assertEq(qM.length, 2,                     'propM queue: 2 items (no verified tenants)');

    // propD: Harbor(manually_verified) + Pier(needs_review) = 2 items
    const qD = SEL.getReviewQueueItems([propD]);
    s.assertEq(qD.length, 2,                     'propD queue: 2 items');
    s.assert(qD.some(i => i.reviewState === 'manually_verified'), 'propD queue has manually_verified item');
    s.assert(qD.some(i => i.reviewState === 'needs_review'),      'propD queue has needs_review item');

    // Queue item shape
    qA.concat(qD).forEach((item, i) => {
      s.assertType(item.tenantId,    'string',  `item[${i}].tenantId is string`);
      s.assertType(item.tenantName,  'string',  `item[${i}].tenantName is string`);
      s.assertType(item.reviewState, 'string',  `item[${i}].reviewState is string`);
      s.assertNoNaN(item.reviewScore,           `item[${i}].reviewScore not NaN`);
      s.assertRange(item.reviewScore, 0, 100,   `item[${i}].reviewScore in [0,100]`);
      s.assert(Array.isArray(item.missingFields),`item[${i}].missingFields is array`);
      s.assert(Array.isArray(item.warningReasons),`item[${i}].warningReasons is array`);
    });

    // Queue ordering: incomplete before needs_review before manually_verified
    const qAll = SEL.getReviewQueueItems(allProps);
    const incompleteIdx = qAll.findIndex(i => i.reviewState === 'incomplete');
    const needsRevIdx   = qAll.findIndex(i => i.reviewState === 'needs_review');
    if (incompleteIdx !== -1 && needsRevIdx !== -1) {
      s.assert(incompleteIdx < needsRevIdx,      'Queue: incomplete before needs_review');
    } else {
      s.assert(true, 'Queue order: no mixed states to compare (skip)');
    }

    // Determinism
    const ord1 = SEL.getReviewQueueItems(allProps).map(i => `${i.propertyId}:${i.tenantId}`);
    const ord2 = SEL.getReviewQueueItems(allProps).map(i => `${i.propertyId}:${i.tenantId}`);
    s.assertEq(ord1, ord2,                       'getReviewQueueItems ordering is deterministic');

    // ── computeReviewHealth ──
    s.assertEq(SEL.computeReviewHealth([]),       100, 'computeReviewHealth([]) === 100');
    s.assertEq(SEL.computeReviewHealth(null),     100, 'computeReviewHealth(null) === 100');
    s.assertEq(SEL.computeReviewHealth([{ reviewScore: 20 }, { reviewScore: 30 }]),
      25,                                              'computeReviewHealth([20,30]) === 25');
    s.assertEq(SEL.computeReviewHealth([{ reviewScore: 100 }]),
      100,                                             'computeReviewHealth([100]) === 100');
    s.assertRange(SEL.computeReviewHealth(qAll), 0, 100, 'computeReviewHealth(allItems) in [0,100]');

    // ── reviewHealthClass ──
    s.assertEq(SEL.reviewHealthClass(100), 'review-health--good', 'reviewHealthClass(100) → good');
    s.assertEq(SEL.reviewHealthClass(80),  'review-health--good', 'reviewHealthClass(80) → good (boundary)');
    s.assertEq(SEL.reviewHealthClass(79),  'review-health--mid',  'reviewHealthClass(79) → mid');
    s.assertEq(SEL.reviewHealthClass(50),  'review-health--mid',  'reviewHealthClass(50) → mid (boundary)');
    s.assertEq(SEL.reviewHealthClass(49),  'review-health--low',  'reviewHealthClass(49) → low');
    s.assertEq(SEL.reviewHealthClass(0),   'review-health--low',  'reviewHealthClass(0) → low');

    // ── propCardBullets ──
    const bullets = SEL.propCardBullets(SEL.getReviewQueueItems(allProps));
    s.assert(Array.isArray(bullets),             'propCardBullets returns array');
    s.assert(bullets.length <= 3,               'propCardBullets max 3 chips');
    bullets.forEach((b, i) => {
      s.assertType(b.label, 'string',           `bullet[${i}].label is string`);
      s.assert('cls' in b,                      `bullet[${i}] has cls field`);
    });
    s.assertEq(SEL.propCardBullets([]).length, 0, 'propCardBullets([]) → 0 chips');

    // ── sortProperties — deterministic ──
    const pairs   = allProps.map(p => ({ p, m: SEL.buildPropMeta(p) }));
    const sorted1 = SEL.sortProperties([...pairs], 'risk').map(x => x.p.id);
    const sorted2 = SEL.sortProperties([...pairs], 'risk').map(x => x.p.id);
    s.assertEq(sorted1, sorted2,                 'sortProperties is deterministic');
    s.assertEq(sorted1.length, allProps.length,  'sortProperties preserves count');

    // ── derivePropertyReadiness ──
    const rdA = SEL.derivePropertyReadiness(propA);
    const VALID_READINESS = ['reconciled','reconciliation_ready','partially_verified','needs_review','high_risk'];
    s.assertType(rdA.readiness, 'string',        'propA readiness is string');
    s.assert(VALID_READINESS.includes(rdA.readiness),
      `propA readiness '${rdA.readiness}' is valid`);
    s.assertNoNaN(rdA.riskScore,                 'propA riskScore not NaN');
    s.assertRange(rdA.riskScore, 0, 100,         'propA riskScore in [0,100]');
    s.assertType(rdA.weightedRisk, 'string',     'propA weightedRisk is string');

    return s;
  }

  // ── Regression suite ───────────────────────────────────────────────────────

  function suiteRegression(fx) {
    const s   = createSuite('Regression');
    const RE  = window.ReviewEngine;
    const SEL = window.Selectors;
    const AS  = window.AuditService;
    const RCE = window.ReconciliationEngine;

    const allProps = [fx.samplePropertyA, fx.samplePropertyB, fx.malformedLease, fx.disputeHeavy].filter(Boolean);
    const VALID_STATUSES = new Set(['verified','needs_review','incomplete','manually_verified']);

    // ── Engines loaded ──
    ['ReviewEngine','ReconciliationEngine','AuditService','Selectors'].forEach(name =>
      s.assert(typeof window[name] === 'object' && window[name] !== null, `window.${name} is loaded`)
    );

    if (!RE || !SEL || !AS || !RCE) return s;

    // ── All tenants produce valid, NaN-free review state ──
    allProps.forEach(prop => {
      const reconResults = (prop.camReconciliation ?? prop.results)?.results ?? [];
      (prop.tenants || []).forEach(t => {
        const rv = RE.deriveTenantReviewState(t, reconResults);
        s.assert(VALID_STATUSES.has(rv.status),      `${t.tenant_name}: status '${rv.status}' is valid`);
        s.assertNoNaN(rv.score,                       `${t.tenant_name}: score not NaN`);
        s.assertRange(rv.score, 0, 100,               `${t.tenant_name}: score in [0,100]`);
        s.assertNoDuplicates(rv.warnings, w => w.type,`${t.tenant_name}: no duplicate warning types`);
      });
    });

    // ── No duplicate tenant entries in combined queue ──
    const allItems = SEL.getReviewQueueItems(allProps);
    s.assertNoDuplicates(allItems, i => `${i.propertyId}:${i.tenantId}`,
      'No duplicate tenant entries across combined queue');

    // ── All queue items have valid statuses ──
    allItems.forEach(item =>
      s.assert(VALID_STATUSES.has(item.reviewState),
        `Queue item '${item.tenantName}': state '${item.reviewState}' is valid`)
    );

    // ── Stable ordering ──
    const ord1 = SEL.getReviewQueueItems(allProps).map(i => `${i.propertyId}:${i.tenantId}`);
    const ord2 = SEL.getReviewQueueItems(allProps).map(i => `${i.propertyId}:${i.tenantId}`);
    s.assertEq(ord1, ord2, 'Queue ordering stable across consecutive runs');

    // ── portfolioKPIs: no NaN in numeric fields ──
    const kpis = SEL.portfolioKPIs(allProps);
    ['properties','cam','openDisputes','criticalOrElevated','totalMissingDocs'].forEach(k =>
      s.assertNoNaN(kpis[k], `portfolioKPIs.${k} not NaN`)
    );

    // ── AuditService: shapeEvent never produces NaN or undefined fields ──
    const ev = AS.shapeEvent('reg_test', 'Regression test', { severity: 'info' });
    ['type','title','detail','severity','timestamp','actor'].forEach(f =>
      s.assert(ev[f] !== undefined && ev[f] !== null, `AuditService.shapeEvent.${f} defined`)
    );

    // ── computePortfolioIntel: numeric fields ──
    const intel = SEL.computePortfolioIntel(allProps);
    ['totalUnresolved','totalMissingCaps','totalExpired','totalExpiring','totalLowConf','totalExposure','proRataGapProps']
      .forEach(k => s.assertNoNaN(intel[k], `portfolioIntel.${k} not NaN`));
    s.assertType(intel.summary, 'string', 'portfolioIntel.summary is string');

    // ── No negative counts in intel ──
    ['totalUnresolved','totalMissingCaps','totalExpired','totalExpiring','totalLowConf','proRataGapProps']
      .forEach(k => s.assert(intel[k] >= 0, `portfolioIntel.${k} >= 0`));

    return s;
  }

  // ── Performance suite ──────────────────────────────────────────────────────

  function suitePerformance(fx) {
    const s   = createSuite('Performance');
    const RE  = window.ReviewEngine;
    const RCE = window.ReconciliationEngine;
    const SEL = window.Selectors;
    if (!RE || !RCE || !SEL) { s.assert(false, 'Engines not loaded'); return s; }

    const allProps  = [fx.samplePropertyA, fx.samplePropertyB, fx.malformedLease, fx.disputeHeavy].filter(Boolean);
    const tenant    = fx.samplePropertyA?.tenants?.[0];
    const reconA    = fx.samplePropertyA?.camReconciliation?.results ?? [];
    const reconB    = fx.samplePropertyB?.camReconciliation?.results ?? [];
    const propB     = fx.samplePropertyB;
    const N         = 200;

    const t0 = performance.now();
    for (let i = 0; i < N; i++) RE.deriveTenantReviewState(tenant, reconA);
    const reviewAvg = (performance.now() - t0) / N;

    const t1 = performance.now();
    for (let i = 0; i < N; i++) RCE.detectReconciliationIssues(reconB, propB, '2025-12-31');
    const reconAvg = (performance.now() - t1) / N;

    const t2 = performance.now();
    for (let i = 0; i < N; i++) SEL.getReviewQueueItems(allProps);
    const selectorAvg = (performance.now() - t2) / N;

    s.assert(reviewAvg  < 5,  `deriveTenantReviewState avg ${reviewAvg.toFixed(3)}ms < 5ms`);
    s.assert(reconAvg   < 10, `detectReconciliationIssues avg ${reconAvg.toFixed(3)}ms < 10ms`);
    s.assert(selectorAvg < 20,`getReviewQueueItems (4 props) avg ${selectorAvg.toFixed(3)}ms < 20ms`);

    s._timing = { reviewAvg, reconAvg, selectorAvg };
    return s;
  }

  // ── Main runner ────────────────────────────────────────────────────────────

  function runQaHarness() {
    const fx = window.QAFixtures || {};
    const suites = [
      suiteReviewEngine(fx),
      suiteReconciliationEngine(fx),
      suiteAuditService(),
      suiteSelectors(fx),
      suiteRegression(fx),
      suitePerformance(fx),
    ];

    let passed = 0, failed = 0;
    const warnings = [];
    const snapshots = {};

    suites.forEach(s => s.results.forEach(r => r.passed ? passed++ : failed++));

    const perfSuite = suites.find(s => s.name === 'Performance');
    if (perfSuite?._timing) {
      snapshots.performance = perfSuite._timing;
      const { reviewAvg, reconAvg, selectorAvg } = perfSuite._timing;
      if (reviewAvg  > 2)  warnings.push(`deriveTenantReviewState ${reviewAvg.toFixed(2)}ms — consider profiling`);
      if (reconAvg   > 5)  warnings.push(`detectReconciliationIssues ${reconAvg.toFixed(2)}ms — consider profiling`);
      if (selectorAvg > 10) warnings.push(`getReviewQueueItems ${selectorAvg.toFixed(2)}ms — consider profiling`);
    }

    // Snapshot: review states for sample-property-a
    const RE = window.ReviewEngine;
    if (RE && fx.samplePropertyA) {
      const reconA = fx.samplePropertyA.camReconciliation?.results ?? [];
      snapshots.reviewStates = fx.samplePropertyA.tenants.map(t => {
        const rv = RE.deriveTenantReviewState(t, reconA);
        return { tenantId: t.id, status: rv.status, score: rv.score, warnings: rv.warnings.map(w => w.type) };
      });
    }

    return { passed, failed, warnings, snapshots, suites };
  }

  function runMainstreetQA() {
    /* eslint-disable no-console */
    console.group('%cMainstreet QA Harness', 'font-weight:bold;font-size:13px;color:#6366f1');
    const t0     = performance.now();
    const result = runQaHarness();
    const elapsed = (performance.now() - t0).toFixed(1);

    result.suites.forEach(suite => {
      const total  = suite.results.length;
      const nPass  = suite.results.filter(r => r.passed).length;
      const nFail  = total - nPass;
      if (nFail === 0) {
        console.log(`%c ✓ ${suite.name} — ${nPass}/${total}`, 'color:#22c55e');
      } else {
        console.group(`%c ✗ ${suite.name} — ${nPass}/${total}`, 'color:#ef4444;font-weight:bold');
        suite.results.filter(r => !r.passed).forEach(r => console.warn(`FAIL: ${r.msg}`, r.ctx ?? ''));
        console.groupEnd();
      }
    });

    if (result.warnings.length) {
      console.group('%c ⚠ Performance warnings', 'color:#f59e0b');
      result.warnings.forEach(w => console.warn(w));
      console.groupEnd();
    }

    if (result.snapshots.performance) {
      const p = result.snapshots.performance;
      console.log(
        `%c ⏱  reviewState=${p.reviewAvg.toFixed(3)}ms · recon=${p.reconAvg.toFixed(3)}ms · selectors=${p.selectorAvg.toFixed(3)}ms`,
        'color:#94a3b8'
      );
    }

    if (result.snapshots.reviewStates) {
      console.group('%c 📸 Snapshot: sample-property-a review states', 'color:#94a3b8');
      result.snapshots.reviewStates.forEach(s =>
        console.log(`  ${s.tenantId}  status=${s.status}  score=${s.score}  warnings=[${s.warnings.join(',')}]`)
      );
      console.groupEnd();
    }

    const allOk = result.failed === 0;
    console.log(
      `%c ${allOk ? '✓ ALL PASSED' : '✗ FAILURES DETECTED'} — ${result.passed} passed, ${result.failed} failed — ${elapsed}ms`,
      `font-weight:bold;color:${allOk ? '#22c55e' : '#ef4444'}`
    );
    console.groupEnd();
    /* eslint-enable no-console */
    return result;
  }

  return { runQaHarness, runMainstreetQA };
})();

window.runMainstreetQA = () => window.QAHarness.runMainstreetQA();
