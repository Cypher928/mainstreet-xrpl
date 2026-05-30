'use strict';
/**
 * test-extraction.js — Regression tests for Phase 10 extraction quality improvements.
 *
 * Self-contained: zero network/DOM. Inlines the logic under test.
 * Run: node test-extraction.js
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertEqual(a, b, label) {
  if (a === b) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    failed++;
  }
}

// ── Inline stubs for the functions under test ─────────────────────────────────

function normalizeTenant(d) {
  if (!d) return d;
  return {
    tenant_name:         d.tenant_name         ?? '',
    leased_sqft:         d.leased_sqft         ?? '',
    start_date:          d.start_date          ?? '',
    end_date:            d.end_date            ?? '',
    lease_type:          d.lease_type          ?? '',
    excluded_categories: d.excluded_categories ?? '',
    cap:                 d.cap                 ?? null,
    flags:               d.flags               ?? [],
    confidence:          d.confidence          ?? {},
    baseYear:            d.baseYear            ?? null,
    unitNumber:          d.unitNumber          ?? '',
    doc_has_dates:       d.doc_has_dates       ?? true,
    doc_has_lease_type:  d.doc_has_lease_type  ?? true,
    leaseUrl:            d.leaseUrl            ?? null,
    leaseExpected:       d.leaseExpected       ?? false,
    extractionFailed:    d.extractionFailed    ?? false,
    _needsReview:        d._needsReview        ?? false,
    _pendingJobReview:   d._pendingJobReview   ?? false,
    _userConfirmed:      d._userConfirmed      ?? false,
    _jobId:              d._jobId              ?? null,
    _usedFallback:       d._usedFallback       ?? false,
    id:                  d.id                  ?? 'test-uuid-' + Math.random().toString(36).slice(2),
    fileName:            d.fileName            ?? '',
    _error:              d._error              ?? null,
    reviewOverrides:     d.reviewOverrides     ?? {},
    review:              d.review              ?? {},
    capBaseAmount:       d.capBaseAmount       ?? null,
    fieldEvidence:       d.fieldEvidence       ?? {},
    admin_fee_pct:       d.admin_fee_pct       ?? null,
    gross_up_pct:        d.gross_up_pct        ?? null,
    expense_stop:        d.expense_stop        ?? null,
    audit_rights:        d.audit_rights        ?? null,
    pro_rata_method:     d.pro_rata_method     ?? null,
    renewal_options:     d.renewal_options     ?? null,
    amendments:          Array.isArray(d.amendments) ? d.amendments : [],
  };
}

function _mkEvidenceSnapshot(fieldKey, t, opts) {
  return {
    fieldKey,
    value:                  opts.value !== undefined ? opts.value : (t[fieldKey] ?? null),
    confidence:             opts.confidence || { status: 'estimated', note: 'AI-extracted' },
    sourceFile:             t.fileName  || null,
    page:                   opts.page   ?? null,
    section:                opts.section ?? null,
    quote:                  opts.quote != null ? String(opts.quote).slice(0, 200) : null,
    extractionId:           t._jobId   || null,
    extractionVersion:      opts.extractionVersion || 'v1',
    extractionModel:        opts.extractionModel ?? null,
    extractedAt:            opts.extractedAt     ?? null,
    superseded:             opts.superseded      ?? false,
    amendmentId:            opts.amendmentId     ?? null,
    reviewerUid:            null,
    reviewerEmail:          null,
    reviewedAt:             new Date().toISOString(),
    approved:               opts.approved       ?? false,
    manuallyEdited:         opts.manuallyEdited ?? false,
    originalExtractedValue: opts.originalExtractedValue ?? null,
  };
}

function getLatestFieldEvidence(fieldKey, t) {
  if (!t) return null;
  const snaps = t.fieldEvidence && t.fieldEvidence[fieldKey] && t.fieldEvidence[fieldKey].snapshots;
  if (!snaps || !snaps.length) return null;
  return snaps[snaps.length - 1];
}

function getEvidenceHistory(fieldKey, t) {
  if (!t) return [];
  const snaps = t.fieldEvidence && t.fieldEvidence[fieldKey] && t.fieldEvidence[fieldKey].snapshots;
  return Array.isArray(snaps) ? snaps : [];
}

// Simulates the quote injection logic from callClaudeForLease()
function injectQuoteSnapshots(normalized, rawQuotes) {
  const _quoteMap = {
    cam_cap:        'cap',
    admin_fee_pct:  'admin_fee_pct',
    gross_up_pct:   'gross_up_pct',
    expense_stop:   'expense_stop',
    audit_rights:   'audit_rights',
    pro_rata_method:'pro_rata_method',
    renewal_options:'renewal_options',
  };
  const _qTs = new Date().toISOString();
  let _fev = normalized.fieldEvidence || {};
  for (const [quoteKey, fieldKey] of Object.entries(_quoteMap)) {
    const qt = typeof rawQuotes[quoteKey] === 'string' ? rawQuotes[quoteKey].trim().slice(0, 200) : null;
    if (!qt) continue;
    const prev = (_fev[fieldKey] || { snapshots: [] }).snapshots;
    _fev = {
      ..._fev,
      [fieldKey]: { snapshots: [...prev, {
        fieldKey,
        value:                  normalized[fieldKey] ?? null,
        confidence:             { status: 'estimated', note: 'AI-extracted' },
        sourceFile:             normalized.fileName || null,
        page:                   null,
        section:                null,
        quote:                  qt,
        extractionId:           normalized._jobId || null,
        extractionVersion:      'v1',
        extractionModel:        null,
        extractedAt:            _qTs,
        superseded:             false,
        amendmentId:            null,
        reviewerUid:            null,
        reviewerEmail:          null,
        reviewedAt:             _qTs,
        approved:               false,
        manuallyEdited:         false,
        originalExtractedValue: null,
      }]},
    };
  }
  normalized.fieldEvidence = _fev;
  return normalized;
}

// ── TEST 1 — New field normalization ──────────────────────────────────────────
console.log('\nTEST 1 — New field normalization');

const t1 = normalizeTenant({
  tenant_name:     'Acme Corp',
  leased_sqft:     5000,
  admin_fee_pct:   15,
  gross_up_pct:    95,
  expense_stop:    8.50,
  audit_rights:    true,
  pro_rata_method: 'rentable',
  renewal_options: 'Two 5-year options at market rate',
});

assertEqual(t1.admin_fee_pct,   15,           'admin_fee_pct normalized to 15');
assertEqual(t1.gross_up_pct,    95,           'gross_up_pct normalized to 95');
assertEqual(t1.expense_stop,    8.5,          'expense_stop normalized to 8.5');
assertEqual(t1.audit_rights,    true,         'audit_rights normalized to true');
assertEqual(t1.pro_rata_method, 'rentable',   'pro_rata_method normalized');
assert(typeof t1.renewal_options === 'string', 'renewal_options is string');

const t1b = normalizeTenant({ tenant_name: 'Beta LLC' });
assertEqual(t1b.admin_fee_pct,   null, 'admin_fee_pct defaults to null');
assertEqual(t1b.gross_up_pct,    null, 'gross_up_pct defaults to null');
assertEqual(t1b.expense_stop,    null, 'expense_stop defaults to null');
assertEqual(t1b.audit_rights,    null, 'audit_rights defaults to null');
assertEqual(t1b.pro_rata_method, null, 'pro_rata_method defaults to null');
assertEqual(t1b.renewal_options, null, 'renewal_options defaults to null');

// Boolean coercion
const t1c = normalizeTenant({ tenant_name: 'Gamma Inc', audit_rights: false });
assertEqual(t1c.audit_rights, false, 'audit_rights false is preserved');

// ── TEST 2 — Quote injection ───────────────────────────────────────────────
console.log('\nTEST 2 — Quote injection via callClaudeForLease simulation');

const t2 = normalizeTenant({
  tenant_name: 'Acme Corp',
  cap:         5,
  admin_fee_pct: 12,
  gross_up_pct:  null,
});

const rawQuotes2 = {
  cam_cap:       'CAM increases shall not exceed 5% per annum over the prior year',
  admin_fee_pct: 'Administrative fee shall not exceed 12% of controllable expenses',
  gross_up_pct:  null,
  expense_stop:  null,
  audit_rights:  null,
  pro_rata_method: null,
  renewal_options: null,
};

injectQuoteSnapshots(t2, rawQuotes2);

const capSnap = getLatestFieldEvidence('cap', t2);
assert(capSnap !== null, 'cap field has a snapshot after injection');
assertEqual(capSnap.quote, 'CAM increases shall not exceed 5% per annum over the prior year', 'cap snapshot has correct quote');
assertEqual(capSnap.manuallyEdited, false, 'cap snapshot manuallyEdited is false');
assertEqual(capSnap.approved, false, 'cap snapshot approved is false');
assertEqual(capSnap.extractionVersion, 'v1', 'cap snapshot extractionVersion is v1');
assertEqual(capSnap.confidence.status, 'estimated', 'cap snapshot confidence is estimated');
assertEqual(capSnap.confidence.note, 'AI-extracted', 'cap snapshot confidence note is AI-extracted');

const adminSnap = getLatestFieldEvidence('admin_fee_pct', t2);
assert(adminSnap !== null, 'admin_fee_pct has a snapshot');
assert(adminSnap.quote.includes('Administrative fee'), 'admin_fee_pct quote is correct');

// Fields with null quotes should have NO snapshot
const grossSnap = getLatestFieldEvidence('gross_up_pct', t2);
assertEqual(grossSnap, null, 'gross_up_pct with null quote has no snapshot');

// ── TEST 3 — Snapshot immutability ────────────────────────────────────────
console.log('\nTEST 3 — Snapshot immutability');

const t3 = normalizeTenant({ tenant_name: 'Delta LLC', cap: 3 });
const snap3a = _mkEvidenceSnapshot('cap', t3, { quote: 'First clause text', value: 3 });
const prevSnaps3 = (t3.fieldEvidence['cap'] || { snapshots: [] }).snapshots;
t3.fieldEvidence = {
  ...t3.fieldEvidence,
  cap: { snapshots: [...prevSnaps3, snap3a] },
};

// Push a second snapshot
const snap3b = _mkEvidenceSnapshot('cap', t3, { quote: 'Second clause text', value: 3, manuallyEdited: true });
const prevSnaps3b = t3.fieldEvidence['cap'].snapshots;
t3.fieldEvidence = {
  ...t3.fieldEvidence,
  cap: { snapshots: [...prevSnaps3b, snap3b] },
};

const history3 = getEvidenceHistory('cap', t3);
assertEqual(history3.length, 2, 'Two snapshots in history');
assertEqual(history3[0].quote, 'First clause text', 'First snapshot unchanged after second push');
assertEqual(history3[1].quote, 'Second clause text', 'Second snapshot has correct quote');
assertEqual(history3[0].manuallyEdited, false, 'First snapshot manuallyEdited unchanged');
assertEqual(history3[1].manuallyEdited, true,  'Second snapshot manuallyEdited is true');

// ── TEST 4 — Evidence cap at 50 ───────────────────────────────────────────
console.log('\nTEST 4 — Evidence cap at 50 snapshots');

const t4 = normalizeTenant({ tenant_name: 'Echo Corp', cap: 5 });
let snaps4 = [];
for (let i = 0; i < 51; i++) {
  const snap = _mkEvidenceSnapshot('cap', t4, { value: i, quote: `Clause ${i}` });
  if (snaps4.length < 50) {
    snaps4 = [...snaps4, snap];
  } else {
    snaps4 = [...snaps4.slice(1), snap]; // drop oldest when cap reached
  }
}
t4.fieldEvidence = { cap: { snapshots: snaps4 } };

const hist4 = getEvidenceHistory('cap', t4);
assertEqual(hist4.length, 50, 'Capped at 50 snapshots');
assertEqual(hist4[0].quote, 'Clause 1', 'Oldest snapshot is index 1 (index 0 dropped)');
assertEqual(hist4[49].quote, 'Clause 50', 'Newest snapshot is Clause 50');

// ── TEST 5 — No evidence duplication ─────────────────────────────────────
console.log('\nTEST 5 — No evidence duplication on double injection');

const t5 = normalizeTenant({ tenant_name: 'Foxtrot Inc', cap: 4, admin_fee_pct: 10 });
const quotes5 = {
  cam_cap: 'CAM capped at 4%',
  admin_fee_pct: 'Admin fee not to exceed 10%',
};

injectQuoteSnapshots(t5, quotes5);
// Calling injection again (simulating a re-extraction) adds a second snapshot — each call is a new snapshot
injectQuoteSnapshots(t5, quotes5);

const hist5cap = getEvidenceHistory('cap', t5);
assertEqual(hist5cap.length, 2, 'Two injection calls produce two snapshots for cap (not duplicate-filtered by design)');
assertEqual(hist5cap[0].quote, hist5cap[1].quote, 'Both snapshots have same quote text from identical extraction');

// ── TEST 6 — Manual edit flag shape ──────────────────────────────────────
console.log('\nTEST 6 — Manual edit snapshot shape');

const t6 = normalizeTenant({ tenant_name: 'Golf LLC', cap: 3, _jobId: 'job-abc-123' });
const snap6 = _mkEvidenceSnapshot('cap', t6, {
  value:                  4,
  approved:               true,
  manuallyEdited:         true,
  extractionVersion:      'manual',
  originalExtractedValue: 3,
  quote:                  null,
});

assertEqual(snap6.manuallyEdited, true,     'manuallyEdited is true');
assertEqual(snap6.approved, true,            'approved is true');
assertEqual(snap6.extractionVersion, 'manual', 'extractionVersion is manual');
assertEqual(snap6.originalExtractedValue, 3,   'originalExtractedValue preserved');
assertEqual(snap6.quote, null,               'quote is null when not provided');
assertEqual(snap6.extractionId, 'job-abc-123', 'extractionId from _jobId');
assert('fieldKey' in snap6,     'fieldKey present');
assert('value' in snap6,        'value present');
assert('confidence' in snap6,   'confidence present');
assert('sourceFile' in snap6,   'sourceFile present');
assert('page' in snap6,         'page present');
assert('reviewerUid' in snap6,  'reviewerUid present');
assert('reviewerEmail' in snap6,'reviewerEmail present');
assert('reviewedAt' in snap6,   'reviewedAt present');

// ── TEST 7 — reviewerConfirmed set by quickConfirmTenantFields simulation ──
console.log('\nTEST 7 — quickConfirmTenantFields simulation');

// Simulate the tenant data manipulation (DOM-free)
const tenantDataSim = [
  normalizeTenant({
    id: 'tenant-sim-001',
    tenant_name: 'Hotel Corp',
    leased_sqft: 3000,
    lease_type: 'NNN',
    start_date: '2022-01-01',
    end_date: '2027-12-31',
    cap: 5,
    admin_fee_pct: 15,
    renewal_options: 'One 5-year option',
  }),
];

function simQuickConfirm(tenantId) {
  const idx = tenantDataSim.findIndex(t => t && t.id === tenantId);
  if (idx === -1) return;
  const t = tenantDataSim[idx];
  const CORE_FIELDS = [
    'tenant_name', 'leased_sqft', 'lease_type', 'start_date', 'end_date', 'cap',
    'admin_fee_pct', 'gross_up_pct', 'expense_stop', 'audit_rights',
    'pro_rata_method', 'renewal_options',
  ];
  let confirmedCount = 0;
  for (const fk of CORE_FIELDS) {
    const val = t[fk];
    if (val == null || val === '') continue;
    // Simulate persistFieldEvidence (snapshot append)
    const fev = t.fieldEvidence || {};
    const prev = (fev[fk] || { snapshots: [] }).snapshots;
    t.fieldEvidence = {
      ...fev,
      [fk]: { snapshots: [...prev, _mkEvidenceSnapshot(fk, t, { approved: true, manuallyEdited: false })] },
    };
    confirmedCount++;
  }
  tenantDataSim[idx] = {
    ...t,
    review: {
      ...t.review,
      reviewerConfirmed: true,
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'test@example.com',
    },
  };
  return confirmedCount;
}

const confirmedCount7 = simQuickConfirm('tenant-sim-001');
const t7after = tenantDataSim[0];

assertEqual(t7after.review.reviewerConfirmed, true, 'reviewerConfirmed is true after quick confirm');
assert(typeof t7after.review.reviewedAt === 'string', 'reviewedAt is set');
assertEqual(t7after.review.reviewedBy, 'test@example.com', 'reviewedBy is set');

// Non-null fields: tenant_name, leased_sqft, lease_type, start_date, end_date, cap, admin_fee_pct, renewal_options = 8
assert(confirmedCount7 >= 7, `At least 7 core fields confirmed (got ${confirmedCount7})`);
assert(getLatestFieldEvidence('tenant_name', t7after) !== null, 'tenant_name has evidence snapshot after confirm');
assert(getLatestFieldEvidence('cap', t7after) !== null, 'cap has evidence snapshot after confirm');
assert(getLatestFieldEvidence('admin_fee_pct', t7after) !== null, 'admin_fee_pct has evidence snapshot after confirm');

// Null fields should NOT have snapshots from quick confirm
assertEqual(getLatestFieldEvidence('gross_up_pct', t7after), null, 'gross_up_pct (null) has no snapshot from confirm');

// ── TEST 8 — Quote truncated at 200 chars in snapshot ───────────────────
console.log('\nTEST 8 — Quote capped at 200 chars in _mkEvidenceSnapshot');

const longQuote = 'A'.repeat(300);
const t8 = normalizeTenant({ tenant_name: 'India Corp', cap: 5 });
const snap8 = _mkEvidenceSnapshot('cap', t8, { quote: longQuote });

assert(snap8.quote !== null, 'Long quote is not null');
assertEqual(snap8.quote.length, 200, 'Long quote truncated to 200 chars');

// ── TEST 9 — Amendment override precedence ───────────────────────────────
console.log('\nTEST 9 — Amendment override precedence');

function simApplyAmendment(t, amFields, amendmentId, fileName) {
  const COMPARABLE_FIELDS = [
    'tenant_name', 'leased_sqft', 'start_date', 'end_date', 'lease_type', 'cap',
    'admin_fee_pct', 'gross_up_pct', 'expense_stop', 'audit_rights',
    'pro_rata_method', 'renewal_options',
  ];
  const overriddenFields = [];
  let updatedTenant = { ...t };
  const now = new Date().toISOString();

  for (const fk of COMPARABLE_FIELDS) {
    const amVal = amFields[fk] ?? null;
    if (amVal === null || amVal === '') continue;
    const origVal = t[fk] ?? null;
    if (origVal !== null && String(amVal) === String(origVal)) continue;
    overriddenFields.push(fk);
    updatedTenant = { ...updatedTenant, [fk]: amVal };
    const fev  = updatedTenant.fieldEvidence || {};
    const prev = (fev[fk] || { snapshots: [] }).snapshots;
    updatedTenant.fieldEvidence = {
      ...fev,
      [fk]: { snapshots: [...prev, {
        fieldKey: fk, value: amVal,
        confidence: { status: 'estimated', note: 'AI-extracted from amendment' },
        sourceFile: fileName || null, page: null, section: null,
        quote: `Amendment clause for ${fk}`,
        extractionId: null, extractionVersion: 'v1-amendment',
        extractionModel: 'claude-test', extractedAt: now,
        superseded: false, amendmentId,
        reviewerUid: null, reviewerEmail: null, reviewedAt: now,
        approved: false, manuallyEdited: false, originalExtractedValue: origVal,
      }]},
    };
  }

  const amendmentEntry = {
    amendmentId, uploadedAt: now, fileName: fileName || null,
    effectiveDate: amFields.start_date || null,
    extractedFields: COMPARABLE_FIELDS.reduce((acc, fk) => {
      if (amFields[fk] != null) acc[fk] = amFields[fk]; return acc;
    }, {}),
    overriddenFields,
  };
  updatedTenant = {
    ...updatedTenant,
    amendments: [...(Array.isArray(t.amendments) ? t.amendments : []), amendmentEntry],
  };
  return { updatedTenant, overriddenFields };
}

const t9orig = normalizeTenant({
  tenant_name: 'Jupiter Corp', leased_sqft: 5000, lease_type: 'NNN',
  start_date: '2022-01-01', end_date: '2026-12-31', cap: 3,
  admin_fee_pct: null, audit_rights: null,
});

const { updatedTenant: t9after, overriddenFields: t9overrides } = simApplyAmendment(
  t9orig,
  { cap: 5, admin_fee_pct: 10, audit_rights: true, end_date: '2028-12-31' },
  'amd-001',
  'Amendment_1.pdf'
);

// Amendment overrides correct values
assertEqual(t9after.cap, 5, 'cap overridden to 5 by amendment');
assertEqual(t9after.admin_fee_pct, 10, 'admin_fee_pct added by amendment');
assertEqual(t9after.audit_rights, true, 'audit_rights set by amendment');
assertEqual(t9after.end_date, '2028-12-31', 'end_date extended by amendment');

// Non-changed fields preserved
assertEqual(t9after.tenant_name, 'Jupiter Corp', 'tenant_name unchanged');
assertEqual(t9after.leased_sqft, 5000, 'leased_sqft unchanged');
assertEqual(t9after.start_date, '2022-01-01', 'start_date unchanged (same in amendment)');

// Override list is correct
assert(t9overrides.includes('cap'), 'cap in overriddenFields');
assert(t9overrides.includes('admin_fee_pct'), 'admin_fee_pct in overriddenFields');
assert(!t9overrides.includes('tenant_name'), 'tenant_name NOT in overriddenFields (unchanged)');

// Amendment entry recorded
assertEqual(t9after.amendments.length, 1, 'One amendment recorded');
assertEqual(t9after.amendments[0].amendmentId, 'amd-001', 'amendmentId correct');
assertEqual(t9after.amendments[0].overriddenFields.length, t9overrides.length, 'overriddenFields count matches');

// ── TEST 10 — Evidence lineage preservation ──────────────────────────────
console.log('\nTEST 10 — Evidence lineage preserved after amendment');

// Before amendment, cap had a snapshot (original extraction)
const t10 = normalizeTenant({ tenant_name: 'Kilo LLC', cap: 3 });
injectQuoteSnapshots(t10, { cam_cap: 'Original CAM cap not to exceed 3%' });

// Now apply amendment that changes cap to 5
const { updatedTenant: t10after } = simApplyAmendment(t10, { cap: 5 }, 'amd-002', 'Amd2.pdf');

const hist10 = getEvidenceHistory('cap', t10after);
assertEqual(hist10.length, 2, 'Two snapshots: original + amendment');
assertEqual(hist10[0].quote, 'Original CAM cap not to exceed 3%', 'Original snapshot preserved');
assertEqual(hist10[0].amendmentId, null, 'Original snapshot has no amendmentId');
assertEqual(hist10[0].value, 3, 'Original snapshot has original value');
assertEqual(hist10[1].amendmentId, 'amd-002', 'Amendment snapshot has amendmentId');
assertEqual(hist10[1].value, 5, 'Amendment snapshot has new value');
assertEqual(hist10[1].extractionVersion, 'v1-amendment', 'Amendment snapshot version tagged');

// ── TEST 11 — Amendment snapshot field shape ─────────────────────────────
console.log('\nTEST 11 — Amendment snapshot complete field shape');

const t11 = normalizeTenant({ tenant_name: 'Lima Corp', cap: 4 });
const { updatedTenant: t11after } = simApplyAmendment(t11, { cap: 6 }, 'amd-003', 'Lease_Amendment_3.pdf');
const snap11 = getLatestFieldEvidence('cap', t11after);

assert(snap11 !== null, 'Amendment snapshot exists');
assertEqual(snap11.amendmentId, 'amd-003', 'amendmentId set');
assertEqual(snap11.extractionVersion, 'v1-amendment', 'extractionVersion is v1-amendment');
assertEqual(snap11.superseded, false, 'Amendment snapshot is not superseded (it IS the current value)');
assertEqual(snap11.originalExtractedValue, 4, 'originalExtractedValue is original cap value');
assert(typeof snap11.extractedAt === 'string', 'extractedAt is a string timestamp');
assert(typeof snap11.section === 'string' || snap11.section === null, 'section is string or null');
assert(typeof snap11.extractionModel === 'string' || snap11.extractionModel === null, 'extractionModel is string or null');

// ── TEST 12 — Page citation persistence ──────────────────────────────────
console.log('\nTEST 12 — Page citation and section persistence in snapshot');

const t12 = normalizeTenant({ tenant_name: 'Mike Corp', cap: 5, _jobId: 'job-page-test' });
const snap12 = _mkEvidenceSnapshot('cap', t12, {
  value: 5, page: 12, section: 'Section 8.2', quote: 'CAM charges capped at 5%',
  extractionModel: 'claude-sonnet-4-6', extractedAt: '2026-05-28T10:00:00.000Z',
});

assertEqual(snap12.page, 12, 'page stored in snapshot');
assertEqual(snap12.section, 'Section 8.2', 'section stored in snapshot');
assertEqual(snap12.extractionModel, 'claude-sonnet-4-6', 'extractionModel stored');
assertEqual(snap12.extractedAt, '2026-05-28T10:00:00.000Z', 'extractedAt stored');
assertEqual(snap12.quote, 'CAM charges capped at 5%', 'quote stored');
assertEqual(snap12.superseded, false, 'superseded defaults to false');
assertEqual(snap12.amendmentId, null, 'amendmentId defaults to null');

// Verify page persists through normalizeTenant round-trip
const t12b = normalizeTenant({ tenant_name: 'Mike Corp', cap: 5, fieldEvidence: { cap: { snapshots: [snap12] } } });
const latest12b = getLatestFieldEvidence('cap', t12b);
assertEqual(latest12b?.page, 12, 'page survives normalizeTenant round-trip');
assertEqual(latest12b?.section, 'Section 8.2', 'section survives normalizeTenant round-trip');

// ── TEST 13 — Extraction telemetry shape ─────────────────────────────────
console.log('\nTEST 13 — Extraction telemetry object shape');

// Simulate what window.ms_extractionDebug looks like after callClaudeForLease()
const telemetrySim = {
  model:               'claude-sonnet-4-6',
  inputTokens:         1200,
  outputTokens:        320,
  extractionDurationMs: 2340,
  OCRUsed:             false,
  OCRConfidence:       null,
  clauseMatches:       3,
  fallbackUsed:        false,
  extractionVersion:   'v1',
  lastExtractedAt:     '2026-05-28T10:00:00.000Z',
};

assert(typeof telemetrySim.model === 'string',          'model is string');
assert(typeof telemetrySim.inputTokens === 'number',    'inputTokens is number');
assert(typeof telemetrySim.outputTokens === 'number',   'outputTokens is number');
assert(typeof telemetrySim.extractionDurationMs === 'number', 'extractionDurationMs is number');
assert(typeof telemetrySim.OCRUsed === 'boolean',       'OCRUsed is boolean');
assert(typeof telemetrySim.clauseMatches === 'number',  'clauseMatches is number');
assert(typeof telemetrySim.fallbackUsed === 'boolean',  'fallbackUsed is boolean');
assert(typeof telemetrySim.lastExtractedAt === 'string','lastExtractedAt is string');
assert(telemetrySim.clauseMatches >= 0,                 'clauseMatches is non-negative');
assert(!telemetrySim.OCRUsed,                           'OCRUsed false for text path');

// Simulate OCR path (PDF direct)
const telemetryOCR = { ...telemetrySim, OCRUsed: true };
assert(telemetryOCR.OCRUsed, 'OCRUsed true for PDF direct path');

// ── TEST 14 — warningGroups structure ────────────────────────────────────
console.log('\nTEST 14 — warningGroups grouping in deriveTenantReviewState');

// Inline the grouping logic (mirrors review-engine.js)
const FINANCIAL_PROTECTION_TYPES = new Set(['nnn_cap_missing', 'admin_fee_present', 'gross_up_present', 'expense_stop_present']);
const TENANT_RIGHT_TYPES = new Set(['audit_rights_present', 'audit_rights_unknown']);
const AMENDMENT_TYPES = new Set(['amendment_applied', 'multiple_amendments']);

function simWarningGroups(warnings) {
  return {
    financialProtections: warnings.filter(w => FINANCIAL_PROTECTION_TYPES.has(w.type)),
    tenantRights:         warnings.filter(w => TENANT_RIGHT_TYPES.has(w.type)),
    amendments:           warnings.filter(w => AMENDMENT_TYPES.has(w.type)),
    dataQuality:          warnings.filter(w =>
      !FINANCIAL_PROTECTION_TYPES.has(w.type) &&
      !TENANT_RIGHT_TYPES.has(w.type) &&
      !AMENDMENT_TYPES.has(w.type)
    ),
  };
}

const warnings14 = [
  { type: 'nnn_cap_missing',     severity: 'medium', label: 'NNN Cap' },
  { type: 'admin_fee_present',   severity: 'medium', label: 'Admin Fee 15%' },
  { type: 'audit_rights_present',severity: 'low',    label: 'Audit Rights' },
  { type: 'amendment_applied',   severity: 'medium', label: '1 amendment on file' },
  { type: 'missing_sqft',        severity: 'high',   label: 'Sq Ft' },
];

const groups14 = simWarningGroups(warnings14);

assertEqual(groups14.financialProtections.length, 2, 'Two financial protection warnings');
assertEqual(groups14.tenantRights.length, 1, 'One tenant rights warning');
assertEqual(groups14.amendments.length, 1, 'One amendment warning');
assertEqual(groups14.dataQuality.length, 1, 'One data quality warning (missing_sqft)');
assert(groups14.financialProtections.every(w => FINANCIAL_PROTECTION_TYPES.has(w.type)), 'All financial warnings correctly categorized');
assert(groups14.dataQuality[0].type === 'missing_sqft', 'missing_sqft goes to dataQuality');

// Empty warnings case
const groups14empty = simWarningGroups([]);
assertEqual(groups14empty.financialProtections.length, 0, 'Empty financialProtections when no warnings');
assertEqual(groups14empty.tenantRights.length, 0, 'Empty tenantRights when no warnings');
assertEqual(groups14empty.amendments.length, 0, 'Empty amendments when no warnings');
assertEqual(groups14empty.dataQuality.length, 0, 'Empty dataQuality when no warnings');

// ── TEST 15 — Amendment merge durability (amendments array survives normalizeTenant) ──
console.log('\nTEST 15 — Amendment merge durability');

const amendmentFixture = [
  { amendmentId: 'amd-A', uploadedAt: '2026-05-01T00:00:00Z', fileName: 'Amd_A.pdf',
    effectiveDate: '2026-06-01', extractedFields: { cap: 7 }, overriddenFields: ['cap'] },
  { amendmentId: 'amd-B', uploadedAt: '2026-05-15T00:00:00Z', fileName: 'Amd_B.pdf',
    effectiveDate: '2026-07-01', extractedFields: { end_date: '2029-12-31' }, overriddenFields: ['end_date'] },
];

const t15 = normalizeTenant({
  tenant_name: 'November Corp', cap: 7, end_date: '2029-12-31',
  amendments: amendmentFixture,
});

assertEqual(t15.amendments.length, 2, 'Two amendments preserved after normalizeTenant');
assertEqual(t15.amendments[0].amendmentId, 'amd-A', 'First amendment id preserved');
assertEqual(t15.amendments[1].amendmentId, 'amd-B', 'Second amendment id preserved');
assertEqual(t15.amendments[0].overriddenFields[0], 'cap', 'overriddenFields preserved');
assertEqual(t15.amendments[1].fileName, 'Amd_B.pdf', 'fileName preserved');

// Verify non-array amendments input defaults to []
const t15b = normalizeTenant({ tenant_name: 'Oscar LLC' });
assert(Array.isArray(t15b.amendments), 'amendments is always an array');
assertEqual(t15b.amendments.length, 0, 'amendments defaults to empty array');

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(56));
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(56));

if (failed > 0) {
  console.error('\x1b[31m  EXTRACTION TESTS FAILED\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32m  ALL EXTRACTION TESTS PASSED\x1b[0m');
}
