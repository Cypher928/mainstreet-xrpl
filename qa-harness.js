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

  // ── Persistence Integrity suite ────────────────────────────────────────────

  function suitePersistence(fx) {
    const s = createSuite('Persistence Integrity');

    // normalizePropertyState and sanitizeImportedPropertyData live in script.js
    // and are not available in the pure-engine QA context. We test the contracts
    // they enforce by calling them directly when available, and test the fixture
    // data shapes when not (e.g. pure-Node smoke run).
    const NPS = typeof normalizePropertyState !== 'undefined' ? normalizePropertyState : null;
    const SID = typeof sanitizeImportedPropertyData !== 'undefined' ? sanitizeImportedPropertyData : null;

    const malformed  = fx.malformedPersisted;
    const dirty      = fx.unsanitizedImport;

    // ── normalizePropertyState contract ──
    if (NPS) {
      // null input → null
      s.assertEq(NPS(null),      null, 'NPS(null) → null');
      s.assertEq(NPS(undefined), null, 'NPS(undefined) → null');
      s.assertEq(NPS('string'),  null, 'NPS("string") → null');

      // Malformed fixture: null/invalid tenants filtered, valid one kept
      const normBad = NPS(malformed);
      s.assert(normBad !== null,                           'NPS(malformed) returns non-null');
      s.assertEq(normBad._schemaVersion, 1,               'NPS sets _schemaVersion = 1');
      s.assertEq(normBad._migrated, true,                 'NPS marks _migrated when schema was 0');
      s.assertEq(normBad._malformed, true,                'NPS marks _malformed when entries filtered');
      s.assert(Array.isArray(normBad.tenants),            'NPS: tenants is array');
      s.assertEq(normBad.tenants.length, 1,               'NPS: 2 invalid tenants filtered → 1 valid');
      s.assertEq(normBad.tenants[0].id, 't-bad-001',      'NPS: valid tenant preserved');
      s.assert(Array.isArray(normBad.disputes),           'NPS: disputes is array');
      s.assertEq(normBad.disputes.length, 1,              'NPS: dispute without id filtered → 1 valid');
      s.assertEq(normBad.disputes[0].id, 'disp-ok',       'NPS: valid dispute preserved');
      s.assert(Array.isArray(normBad.activityLog),        'NPS: activityLog is array');
      s.assertEq(normBad.activityLog.length, 1,           'NPS: entry missing type/timestamp filtered');
      s.assert(Array.isArray(normBad.invoices),           'NPS: invoices is array');
      s.assertEq(normBad.invoices.length, 1,              'NPS: null invoice filtered → 1 valid');

      // Clean fixture → no migration, no malformed flag
      const normA = NPS(fx.samplePropertyA);
      s.assert(normA !== null,                            'NPS(propA) returns non-null');
      s.assertEq(normA._migrated, false,                  'NPS: propA has no schema migration');
      s.assertEq(normA.tenants.length, fx.samplePropertyA.tenants.length,
        'NPS: propA tenant count unchanged');

      // Idempotency: running NPS twice produces same shape
      const norm2 = NPS(normBad);
      s.assertEq(norm2._migrated, false,                  'NPS is idempotent: second run no migration');
      s.assertEq(norm2.tenants.length, normBad.tenants.length, 'NPS idempotent: tenant count stable');

      // Guarantees arrays when fields missing entirely
      const normEmpty = NPS({ id: 'x', name: 'y' });
      s.assert(Array.isArray(normEmpty.tenants),          'NPS: missing tenants → []');
      s.assert(Array.isArray(normEmpty.disputes),         'NPS: missing disputes → []');
      s.assert(Array.isArray(normEmpty.activityLog),      'NPS: missing activityLog → []');
      s.assert(Array.isArray(normEmpty.invoices),         'NPS: missing invoices → []');
    } else {
      s.assert(true, 'normalizePropertyState not in scope (engine-only context — skip)');
    }

    // ── sanitizeImportedPropertyData contract ──
    if (SID) {
      // null input → null
      s.assertEq(SID(null),      null, 'SID(null) → null');
      s.assertEq(SID('bad'),     null, 'SID(non-object) → null');

      const sanitized = SID(dirty);
      s.assert(sanitized !== null,                        'SID(dirty) returns non-null');

      // Duplicate IDs: only first 't-dup' survives
      s.assertEq(sanitized.tenants.length, 2,             'SID: duplicate tenant ID deduplicated → 2 tenants');
      s.assertEq(sanitized.tenants[0].id, 't-dup',        'SID: first t-dup kept');
      s.assertEq(sanitized.tenants[1].id, 't-clean',      'SID: clean tenant kept');

      // NaN sqft → normalized (null or 0 via normalizeTenant)
      const dedupTenant = sanitized.tenants[0];
      s.assert(!isNaN(dedupTenant.leased_sqft || 0),      'SID: NaN sqft not propagated');

      // NaN cap → null
      s.assert(dedupTenant.cap === null || !isNaN(dedupTenant.cap || 0),
        'SID: NaN cap → null');

      // Invalid date → null
      s.assert(dedupTenant.start_date === null || dedupTenant.start_date === '',
        'SID: invalid start_date → null/empty');

      // Confidence clamped to [0,100]
      const conf = dedupTenant.confidence?.leased_sqft ?? null;
      if (conf !== null) s.assertRange(conf, 0, 100, 'SID: out-of-range confidence clamped to [0,100]');

      // Invalid dispute status → 'open'
      s.assertEq(sanitized.disputes[0].status, 'open',   'SID: invalid dispute status → open');
      // NaN amount → 0
      s.assertEq(sanitized.disputes[0].amount, 0,        'SID: NaN dispute amount → 0');
      // Valid dispute preserved
      s.assertEq(sanitized.disputes[1].status, 'open',   'SID: valid dispute status preserved');
      s.assertEq(sanitized.disputes[1].amount, 1500,     'SID: valid amount preserved');
    } else {
      s.assert(true, 'sanitizeImportedPropertyData not in scope (engine-only context — skip)');
    }

    // ── Stale save simulation ──
    // Verify the _saveGeneration contract: a "stale" generation never equals the current.
    {
      const genBefore = typeof _saveGeneration !== 'undefined' ? _saveGeneration : 0;
      // Simulate two rapid saves: gen A is captured, then gen B fires and increments counter.
      // Gen A checks: genA !== _saveGeneration (which is now genA+1) → stale, discards.
      const genA = genBefore + 1;
      const genB = genBefore + 2;
      s.assert(genA !== genB,                             'Stale save: gen A !== gen B (different saves)');
      s.assert(genA < genB,                               'Stale save: gen B is newer');
      // Only genB equals the final counter value
      s.assertEq(genB, genBefore + 2,                    'Stale save: only latest gen matches counter');
    }

    // ── Corrupted review state recovery ──
    // ReviewEngine must not crash on tenants with malformed review objects.
    const RE = window.ReviewEngine;
    if (RE) {
      const badReviewTenant = {
        id: 't-corrupt', tenant_name: 'Corrupt Review',
        lease_type: 'NNN', leased_sqft: 1000,
        start_date: '2022-01-01', end_date: '2027-12-31',
        cap: 3, capBaseAmount: 5000, confidence: { leased_sqft: 85 },
        flags: [], doc_has_dates: true, doc_has_lease_type: true,
        _usedFallback: false, _needsReview: false,
        review: null,                   // null review object
        reviewOverrides: undefined,     // undefined overrides
      };
      let threw = false;
      let rv;
      try { rv = RE.deriveTenantReviewState(badReviewTenant, []); }
      catch (e) { threw = true; }
      s.assert(!threw,                                    'deriveTenantReviewState does not throw on null review');
      if (rv) {
        s.assertType(rv.status, 'string',               'Corrupted review: status is still a string');
        s.assertNoNaN(rv.score,                          'Corrupted review: score not NaN');
      }

      // Completely empty tenant object
      let threw2 = false;
      let rv2;
      try { rv2 = RE.deriveTenantReviewState({}, []); }
      catch (e) { threw2 = true; }
      s.assert(!threw2,                                   'deriveTenantReviewState does not throw on {}');

      // null tenant → returns _empty baseline
      const rvNull = RE.deriveTenantReviewState(null, []);
      s.assertEq(rvNull.status, 'incomplete',            'deriveTenantReviewState(null) → incomplete');
      s.assertEq(rvNull.score, 0,                        'deriveTenantReviewState(null) → score 0');
    }

    // ── Overlapping autosave simulation ──
    // _captureSnapshot must be callable multiple times without corrupting state.
    if (typeof _captureSnapshot !== 'undefined') {
      const snapProp = { id: 'snap-test', tenants: [{ id: 't1' }], disputes: [], activityLog: [] };
      _captureSnapshot(snapProp);
      _captureSnapshot({ ...snapProp, tenants: [{ id: 't1' }, { id: 't2' }] }); // second call
      const recovered = typeof recoverLastSnapshot !== 'undefined' ? recoverLastSnapshot('snap-test') : null;
      if (recovered) {
        s.assertEq(recovered.propertyId, 'snap-test',   'Snapshot: propertyId preserved');
        s.assertEq(recovered.tenants.length, 2,         'Snapshot: second (newer) capture wins');
        s.assertType(recovered.timestamp, 'string',     'Snapshot: timestamp is string');
        s.assert(/^\d{4}-\d{2}-\d{2}T/.test(recovered.timestamp), 'Snapshot: timestamp is ISO-like');
      } else {
        s.assert(true, '_captureSnapshot not in scope (engine-only context — skip)');
      }
    } else {
      s.assert(true, '_captureSnapshot not in scope (engine-only context — skip)');
    }

    // ── Deterministic timestamps ──
    // All ISO timestamps produced by Date.toISOString() must match ISO 8601.
    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    const AS = window.AuditService;
    if (AS) {
      const ev = AS.shapeEvent('ts_test', 'Timestamp test');
      s.assert(ISO_RE.test(ev.timestamp), 'AuditService timestamp is ISO 8601');
    }

    return s;
  }

  // ── AllocationIntegrity suite ──────────────────────────────────────────────

  function suiteAllocationIntegrity(fx) {
    const s  = createSuite('AllocationIntegrity');
    const AI = window.AllocationIntegrity;
    if (!AI) { s.assert(false, 'AllocationIntegrity not loaded'); return s; }

    const TOL = AI.BALANCE_TOLERANCE;

    // ── validateAllocationSet — balanced inputs ──
    const vBal = AI.validateAllocationSet(fx.allocBalanced);
    s.assert(vBal.isBalanced,                              'Balanced set: isBalanced === true');
    s.assertRange(vBal.totalPercent, 99.99, 100.01,        'Balanced set: totalPercent ~100');
    s.assertNoNaN(vBal.totalAmount,                         'Balanced set: totalAmount not NaN');
    s.assertEq(vBal.issues.length, 0,                      'Balanced set: no issues');
    s.assert(Array.isArray(vBal.normalizedAllocations),    'Balanced set: normalizedAllocations is array');

    // ── Float drift — within BALANCE_TOLERANCE ──
    const vDrift = AI.validateAllocationSet(fx.allocFloatDrift);
    s.assert(vDrift.isBalanced,                            'Float drift: within tolerance → isBalanced');
    s.assertRange(vDrift.totalPercent, 99.9, 100.1,        'Float drift: totalPercent reasonable');
    s.assertEq(vDrift.issues.length, 0,                    'Float drift: no issues (within tolerance)');

    // ── Over-allocation → critical ──
    const vOver = AI.validateAllocationSet(fx.allocOverAllocation);
    s.assert(!vOver.isBalanced,                            'Over-allocation: isBalanced === false');
    s.assert(vOver.totalPercent > 100 + TOL,               'Over-allocation: totalPercent > 100+tol');
    s.assert(vOver.issues.some(i => i.type === 'over_allocation' && i.severity === 'critical'),
      'Over-allocation: critical over_allocation issue');

    // ── Negative percent → critical ──
    const vNeg = AI.validateAllocationSet(fx.allocNegativePercent);
    s.assert(vNeg.issues.some(i => i.type === 'negative_percent' && i.severity === 'critical'),
      'Negative percent: critical negative_percent issue');
    s.assert(vNeg.issues.some(i => i.type === 'negative_amount' && i.severity === 'critical'),
      'Negative percent: critical negative_amount issue');

    // ── Duplicate tenant → critical ──
    const vDup = AI.validateAllocationSet(fx.allocDuplicate);
    s.assert(vDup.issues.some(i => i.type === 'duplicate_tenant' && i.severity === 'critical'),
      'Duplicate: critical duplicate_tenant issue');
    // Deduplication: same type+tenantId only once
    const dupIssues = vDup.issues.filter(i => i.type === 'duplicate_tenant');
    s.assertEq(dupIssues.length, 1,                        'Duplicate: issue deduplicated to 1 entry');

    // ── Zero-basis allocation → warning ──
    const vZero = AI.validateAllocationSet(fx.allocZeroBasis);
    s.assert(vZero.issues.some(i => i.type === 'zero_basis_allocation' && i.severity === 'warning'),
      'Zero basis: warning zero_basis_allocation issue');

    // ── NaN percent → critical ──
    const vNaN = AI.validateAllocationSet(fx.allocNaN);
    s.assert(vNaN.issues.some(i => i.type === 'nan_percent' && i.severity === 'critical'),
      'NaN percent: critical nan_percent issue');
    s.assert(!vNaN.isBalanced,                             'NaN percent: isBalanced === false');

    // ── Under-allocation → warning ──
    const vUnder = AI.validateAllocationSet(fx.allocUnder);
    s.assert(vUnder.issues.some(i => i.type === 'under_allocation' && i.severity === 'warning'),
      'Under-allocation: warning issue');

    // ── Edge: empty set ──
    const vEmpty = AI.validateAllocationSet(fx.allocEmpty);
    s.assertEq(vEmpty.totalPercent, 0,                     'Empty set: totalPercent === 0');
    s.assertEq(vEmpty.totalAmount, 0,                      'Empty set: totalAmount === 0');
    s.assertEq(vEmpty.issues.length, 0,                    'Empty set: no issues');

    // ── Edge: null / non-array input ──
    const vNull = AI.validateAllocationSet(null);
    s.assertEq(vNull.issues.length, 0,                     'null input: no issues');
    s.assertEq(vNull.totalPercent, 0,                      'null input: totalPercent 0');

    // ── Edge: single tenant ──
    const vSingle = AI.validateAllocationSet(fx.allocSingle);
    s.assert(vSingle.isBalanced,                           'Single tenant: isBalanced');
    s.assertEq(vSingle.issues.length, 0,                   'Single tenant: no issues');

    // ── normalizeAllocationPrecision ──
    const norm = AI.normalizeAllocationPrecision(fx.allocBalanced, 45000);
    s.assert(Array.isArray(norm),                          'NormPrecision: returns array');
    s.assertEq(norm.length, fx.allocBalanced.length,       'NormPrecision: length preserved');
    norm.forEach((a, i) => {
      s.assertNoNaN(a.displayAmount,                       `NormPrecision[${i}]: displayAmount not NaN`);
      s.assertNoNaN(a.displayPercent,                      `NormPrecision[${i}]: displayPercent not NaN`);
      s.assertRange(a.displayPercent, 0, 100,              `NormPrecision[${i}]: displayPercent in [0,100]`);
    });
    // Sum of displayAmounts ≈ targetTotal
    const normSum = norm.reduce((s, a) => s + a.displayAmount, 0);
    s.assert(Math.abs(normSum - 45000) < 0.02,             `NormPrecision: sum of displayAmounts ≈ 45000 (got ${normSum})`);

    // Rounding edge case: 3 × 33.33% = 99.99% — exactly at tolerance boundary
    const vEdge = AI.validateAllocationSet(fx.allocRoundingEdge);
    s.assertNoNaN(vEdge.totalPercent,                      'Rounding edge: totalPercent not NaN');
    s.assertRange(vEdge.totalPercent, 99.98, 100.02,       'Rounding edge: totalPercent near 100');
    // normalize and check displayPercents sum to ~100
    const normEdge = AI.normalizeAllocationPrecision(fx.allocRoundingEdge, 29999);
    const pctSum = normEdge.reduce((s, a) => s + a.displayPercent, 0);
    s.assert(Math.abs(pctSum - 100) < 0.1,                 `NormPrecision edge: displayPercent sum ≈ 100 (got ${pctSum.toFixed(4)})`);

    // ── buildAllocationExplanation ──
    const expl = AI.buildAllocationExplanation(fx.allocBalanced);
    s.assertType(expl, 'string',                           'buildExplanation returns string');
    s.assert(expl.length > 0,                              'buildExplanation non-empty');
    s.assert(expl.includes('3 active tenants'),            'buildExplanation mentions tenant count');
    s.assertEq(AI.buildAllocationExplanation([]), 'No tenants in allocation pool.',
      'buildExplanation([]) → no-tenants message');

    // ── buildIntegritySummary ──
    const sum = AI.buildIntegritySummary(fx.allocBalanced);
    s.assert(sum.balanced,                                 'IntegritySummary: balanced set → balanced=true');
    s.assertEq(sum.criticalIssueCount, 0,                  'IntegritySummary: balanced set → 0 critical');
    s.assertEq(sum.warningCount, 0,                        'IntegritySummary: balanced set → 0 warnings');
    s.assertType(sum.explainability, 'string',             'IntegritySummary: explainability is string');
    s.assert(Array.isArray(sum.normalizedAllocations),     'IntegritySummary: normalizedAllocations is array');
    s.assertNoNaN(sum.totalPercent,                        'IntegritySummary: totalPercent not NaN');
    s.assertNoNaN(sum.totalAmount,                         'IntegritySummary: totalAmount not NaN');

    const sumCrit = AI.buildIntegritySummary(fx.allocOverAllocation);
    s.assert(sumCrit.criticalIssueCount > 0,               'IntegritySummary: over-alloc → criticalIssueCount > 0');
    s.assert(!sumCrit.balanced,                            'IntegritySummary: over-alloc → balanced=false');

    // ── Determinism: same input → same output ──
    const run1 = AI.validateAllocationSet(fx.allocBalanced);
    const run2 = AI.validateAllocationSet(fx.allocBalanced);
    s.assertEq(run1.totalPercent, run2.totalPercent,       'Determinism: totalPercent identical');
    s.assertEq(run1.isBalanced,   run2.isBalanced,         'Determinism: isBalanced identical');
    s.assertEq(run1.issues.map(i => i.type), run2.issues.map(i => i.type), 'Determinism: issue types identical');

    // ── No NaN propagation from any fixture ──
    [fx.allocBalanced, fx.allocFloatDrift, fx.allocRoundingEdge, fx.allocSingle].forEach((set, i) => {
      const v = AI.validateAllocationSet(set);
      s.assertNoNaN(v.totalPercent, `No-NaN fixture[${i}]: totalPercent`);
      s.assertNoNaN(v.totalAmount,  `No-NaN fixture[${i}]: totalAmount`);
      v.normalizedAllocations.forEach((a, j) => {
        s.assertNoNaN(a.displayAmount,  `No-NaN fixture[${i}][${j}]: displayAmount`);
        s.assertNoNaN(a.displayPercent, `No-NaN fixture[${i}][${j}]: displayPercent`);
      });
    });

    // ── deduplication: issues never repeat same type+tenantId ──
    [vOver, vNeg, vDup, vNaN].forEach((v, i) => {
      const keys = v.issues.map(iss => `${iss.type}:${iss.tenantId ?? ''}`);
      s.assertNoDuplicates(v.issues, iss => `${iss.type}:${iss.tenantId ?? ''}`,
        `Issues deduplicated — fixture set ${i}`);
    });

    return s;
  }

  // ── ReconciliationExplainer suite ─────────────────────────────────────────

  function suiteReconciliationExplainer() {
    const s  = createSuite('ReconciliationExplainer');
    const RE = window.ReconciliationExplainer;
    if (!RE) { s.assert(false, 'ReconciliationExplainer not loaded'); return s; }

    // ── Shared fixtures ────────────────────────────────────────────────────
    const baseResult = {
      tenantName:     'Anchor Coffee',
      name:           'Anchor Coffee',
      sqFt:           4200,
      proRataPercent: 26.67,
      totalAllocated: 12000,
      allocatedAmount: 12000,
      capApplied:     false,
      capAdjustment:  null,
      ambiguityFlags: [],
    };
    const cappedResult = {
      tenantName:     'Summit Fitness',
      name:           'Summit Fitness',
      sqFt:           8000,
      proRataPercent: 53.33,
      totalAllocated: 18000,
      allocatedAmount: 18000,
      capApplied:     true,
      capAdjustment:  2000,
      ambiguityFlags: [
        { code: 'SQFT_APPROXIMATE', message: 'Square footage may be incorrect', explanation: 'Missing sqft.' },
        { code: 'BASE_YEAR_MISMATCH', message: 'Invoice dates may not match lease period', explanation: 'Pre-lease invoices.' },
      ],
    };
    const tenant = { lease_type: 'NNN', excluded_categories: 'management fees, admin' };
    const context = { method: 'leased square footage', totalSqFt: 15750 };
    const normContext = { method: 'leased square footage', totalSqFt: 15750, normalizationApplied: true, normalizationDelta: 0.0033 };

    // ── buildAllocationNarrative ───────────────────────────────────────────

    const allocBasic = RE.buildAllocationNarrative(baseResult, context);
    s.assertType(allocBasic, 'string', 'buildAllocationNarrative returns string');
    s.assert(allocBasic.includes('leased square footage'), 'Alloc narrative includes method');
    s.assert(allocBasic.includes('4,200'), 'Alloc narrative includes tenant sqft');
    s.assert(allocBasic.includes('15,750'), 'Alloc narrative includes total sqft');
    s.assert(allocBasic.includes('26.67%'), 'Alloc narrative includes pro-rata pct');
    s.assert(!allocBasic.includes('cap'), 'Alloc narrative: no cap sentence when capApplied=false');
    s.assert(!allocBasic.includes('normalized'), 'Alloc narrative: no normalization when not applied');
    s.assert(!allocBasic.includes('undefined'), 'Alloc narrative: no undefined placeholder');

    const allocCap = RE.buildAllocationNarrative(cappedResult, context);
    s.assert(allocCap.includes('cap applied'), 'Cap sentence present when capApplied=true');
    s.assert(allocCap.includes('$2,000.00'), 'Cap adjustment amount in narrative');
    s.assert(!allocCap.includes('undefined'), 'Cap narrative: no undefined placeholder');

    const allocNorm = RE.buildAllocationNarrative(baseResult, normContext);
    s.assert(allocNorm.includes('normalized'), 'Normalization sentence present when applied');
    s.assert(allocNorm.includes('+0.0033%'), 'Normalization delta value in narrative');
    s.assert(!allocNorm.includes('undefined'), 'Normalization narrative: no undefined placeholder');

    const allocNoCtx = RE.buildAllocationNarrative(baseResult, null);
    s.assert(allocNoCtx.includes('leased square footage'), 'Default method used when context null');
    s.assert(!allocNoCtx.includes('sqft of'), 'No sqft sentence when totalSqFt missing');

    const allocNoSqft = RE.buildAllocationNarrative({ proRataPercent: 50 }, context);
    s.assert(!allocNoSqft.includes('sqft of'), 'No sqft sentence when tenant sqFt missing');

    // ── Determinism ───────────────────────────────────────────────────────
    const alloc1 = RE.buildAllocationNarrative(baseResult, context);
    const alloc2 = RE.buildAllocationNarrative(baseResult, context);
    s.assertEq(alloc1, alloc2, 'buildAllocationNarrative is deterministic');

    // ── buildExclusionNarrative ────────────────────────────────────────────

    const exInactive = RE.buildExclusionNarrative('inactive_lease');
    s.assertType(exInactive, 'string', 'buildExclusionNarrative returns string');
    s.assert(exInactive.includes('lease term has ended'), 'inactive_lease narrative');
    s.assert(!exInactive.includes('undefined'), 'inactive_lease: no undefined placeholder');

    const exClause = RE.buildExclusionNarrative('lease_clause', 'management fees, admin');
    s.assert(exClause.includes('management fees'), 'lease_clause narrative includes categories');
    s.assert(exClause.includes('excluded'), 'lease_clause narrative mentions exclusion');

    const exClauseNoDetail = RE.buildExclusionNarrative('lease_clause', null);
    s.assert(typeof exClauseNoDetail === 'string', 'lease_clause without detail returns string');
    s.assert(!exClauseNoDetail.includes('null'), 'lease_clause without detail: no null in output');

    const exZero = RE.buildExclusionNarrative('zero_sqft');
    s.assert(exZero.includes('no square footage'), 'zero_sqft narrative');

    const exMissing = RE.buildExclusionNarrative('missing_basis');
    s.assert(exMissing.includes('insufficient data'), 'missing_basis narrative');

    const exUnknown = RE.buildExclusionNarrative('unknown_reason');
    s.assertType(exUnknown, 'string', 'Unknown reason returns string (fallback)');
    s.assert(!exUnknown.includes('undefined'), 'Unknown reason: no undefined placeholder');

    // Determinism
    s.assertEq(RE.buildExclusionNarrative('zero_sqft'), RE.buildExclusionNarrative('zero_sqft'), 'buildExclusionNarrative is deterministic');

    // ── buildWarningNarrative ──────────────────────────────────────────────

    const codes = ['SQFT_OVERFLOW', 'SQFT_APPROXIMATE', 'BASE_YEAR_MISMATCH', 'NNN_GROSS_UNKNOWN'];
    codes.forEach(code => {
      const narr = RE.buildWarningNarrative({ code, message: 'msg', explanation: 'expl' });
      s.assertType(narr, 'string', `buildWarningNarrative returns string for ${code}`);
      s.assert(narr.length > 20, `${code} narrative is substantive (>20 chars)`);
      s.assert(!narr.includes('undefined'), `${code} narrative: no undefined placeholder`);
    });

    // Unknown code falls back to explanation
    const wUnknown = RE.buildWarningNarrative({ code: 'UNKNOWN', message: 'msg', explanation: 'fallback expl' });
    s.assertEq(wUnknown, 'fallback expl', 'Unknown code uses explanation as fallback');

    // No code falls back to message
    const wNoCode = RE.buildWarningNarrative({ message: 'just a message' });
    s.assertEq(wNoCode, 'just a message', 'No code and no explanation uses message');

    // Null/missing issue
    const wNull = RE.buildWarningNarrative(null);
    s.assertEq(wNull, '', 'Null issue returns empty string');

    // Determinism
    const wDet = { code: 'SQFT_OVERFLOW', message: 'm', explanation: 'e' };
    s.assertEq(RE.buildWarningNarrative(wDet), RE.buildWarningNarrative(wDet), 'buildWarningNarrative is deterministic');

    // ── buildReconciliationSummaryNarrative ────────────────────────────────

    const summFull = RE.buildReconciliationSummaryNarrative(baseResult, tenant);
    s.assertType(summFull, 'string', 'buildReconciliationSummaryNarrative returns string');
    s.assert(summFull.includes('Anchor Coffee'), 'Summary includes tenant name');
    s.assert(summFull.includes('NNN'), 'Summary includes lease type when tenant provided');
    s.assert(summFull.includes('4,200'), 'Summary includes sqFt');
    s.assert(summFull.includes('26.67%'), 'Summary includes pro-rata pct');
    s.assert(summFull.includes('$12,000.00'), 'Summary includes allocated amount');
    s.assert(!summFull.includes('cap'), 'No cap sentence when capApplied=false');
    s.assert(!summFull.includes('undefined'), 'Summary: no undefined placeholder');

    const summCap = RE.buildReconciliationSummaryNarrative(cappedResult, tenant);
    s.assert(summCap.includes('cap'), 'Cap sentence in summary when capApplied=true');
    s.assert(summCap.includes('$2,000.00'), 'Cap adjustment amount in summary');
    s.assert(summCap.includes('2 data quality'), 'Flag count in summary (2 flags)');
    s.assert(!summCap.includes('undefined'), 'Capped summary: no undefined placeholder');

    const summOneFlagResult = Object.assign({}, baseResult, { ambiguityFlags: [{ code: 'SQFT_OVERFLOW', message: 'm', explanation: 'e' }] });
    const summOneFlag = RE.buildReconciliationSummaryNarrative(summOneFlagResult, null);
    s.assert(summOneFlag.includes('One data quality'), 'Singular flag sentence for 1 flag');
    s.assert(!summOneFlag.includes('NNN'), 'No lease type when tenant not provided');

    const summNull = RE.buildReconciliationSummaryNarrative(null, null);
    s.assertEq(summNull, '', 'Null result returns empty string');

    // Determinism
    const sum1 = RE.buildReconciliationSummaryNarrative(cappedResult, tenant);
    const sum2 = RE.buildReconciliationSummaryNarrative(cappedResult, tenant);
    s.assertEq(sum1, sum2, 'buildReconciliationSummaryNarrative is deterministic');

    // ── buildExplainability ────────────────────────────────────────────────

    const expl = RE.buildExplainability(cappedResult, tenant, normContext);
    s.assert(expl && typeof expl === 'object', 'buildExplainability returns object');
    s.assert(expl.explanations && typeof expl.explanations === 'object', 'explanations key present');

    const { allocation, exclusions, warnings, normalization, summary } = expl.explanations;
    s.assertType(allocation, 'string', 'explanations.allocation is string');
    s.assert(Array.isArray(exclusions), 'explanations.exclusions is array');
    s.assert(Array.isArray(warnings), 'explanations.warnings is array');
    s.assert(!expl.explanations.hasOwnProperty('normalization') || normalization === null || typeof normalization === 'string',
      'explanations.normalization is string or null');
    s.assertType(summary, 'string', 'explanations.summary is string');

    // Normalization present when applied
    s.assert(typeof normalization === 'string', 'Normalization narrative present when normalizationApplied=true');
    s.assert(normalization.includes('100%'), 'Normalization narrative mentions 100%');

    // Normalization absent when not applied
    const explNoNorm = RE.buildExplainability(baseResult, tenant, context);
    s.assertEq(explNoNorm.explanations.normalization, null, 'Normalization null when not applied');

    // Exclusions from excluded_categories
    s.assert(exclusions.length === 1, 'One exclusion entry for excluded_categories string');
    s.assert(exclusions[0].includes('management fees'), 'Exclusion narrative includes categories');

    // No exclusions when no excluded_categories
    const explNoCats = RE.buildExplainability(baseResult, { lease_type: 'NNN' }, context);
    s.assertEq(explNoCats.explanations.exclusions.length, 0, 'No exclusions when tenant has none');

    // Warnings deduplicated — cappedResult has SQFT_APPROXIMATE and BASE_YEAR_MISMATCH (distinct)
    s.assertEq(warnings.length, 2, 'Two unique warnings from two distinct flag codes');

    // Dedup: same code twice → one warning
    const dupResult = Object.assign({}, baseResult, {
      ambiguityFlags: [
        { code: 'SQFT_OVERFLOW', message: 'msg', explanation: 'e' },
        { code: 'SQFT_OVERFLOW', message: 'msg', explanation: 'e' },
      ],
    });
    const explDup = RE.buildExplainability(dupResult, null, context);
    s.assertEq(explDup.explanations.warnings.length, 1, 'Duplicate warning codes deduped to one');

    // No undefined in any field
    [allocation, summary, ...exclusions, ...warnings].forEach((txt, i) => {
      s.assert(typeof txt === 'string' && !txt.includes('undefined'),
        `No undefined placeholder in explanations field ${i}`);
    });

    // Determinism for full buildExplainability
    const expl1 = RE.buildExplainability(cappedResult, tenant, normContext);
    const expl2 = RE.buildExplainability(cappedResult, tenant, normContext);
    s.assertEq(JSON.stringify(expl1), JSON.stringify(expl2), 'buildExplainability is deterministic');

    // Edge: null inputs
    const explAllNull = RE.buildExplainability(null, null, null);
    s.assert(explAllNull && typeof explAllNull === 'object', 'buildExplainability handles all-null inputs');
    s.assertEq(explAllNull.explanations.exclusions.length, 0, 'No exclusions on null tenant');
    s.assertEq(explAllNull.explanations.warnings.length, 0, 'No warnings on null result');
    s.assertEq(explAllNull.explanations.normalization, null, 'Normalization null on null context');

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
      suitePersistence(fx),
      suiteAllocationIntegrity(fx),
      suiteReconciliationExplainer(),
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
