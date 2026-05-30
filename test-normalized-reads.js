'use strict';
/**
 * test-normalized-reads.js — Phase 20: Normalized Read Migration
 *
 * Unit tests for the two row→in-memory conversion helpers and the evidence/audit
 * overlay logic introduced in Phase 20. Zero network calls — all Supabase
 * interactions are replaced with inline data.
 *
 * Run: node test-normalized-reads.js
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  ✓', label);
    passed++;
  } else {
    console.error('  ✗', label);
    failed++;
  }
}
function assertEqual(a, b, label) {
  assert(a === b, label + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// ── Inline helpers under test ────────────────────────────────────────────────

function _evidenceRowToSnapshot(row) {
  return {
    value:                  row.value,
    confidence:             { status: row.confidence_status, note: row.confidence_note },
    sourceFile:             row.source_file,
    page:                   row.source_page,
    extractionId:           row.extraction_id,
    extractionVersion:      row.extraction_version,
    reviewerUid:            row.reviewer_uid,
    reviewerEmail:          row.reviewer_email,
    reviewedAt:             row.reviewed_at,
    approved:               row.approved,
    manuallyEdited:         row.manually_edited,
    originalExtractedValue: row.original_extracted_value,
  };
}

function _auditRowToActivityEntry(row) {
  return {
    type:      'field_review_audit',
    tenantId:  row.tenant_id,
    timestamp: row.client_ts,
    actor:     row.reviewer_email  ?? null,
    title:     row.label           ?? 'Field review',
    severity:  row.severity        || 'info',
    detail:    JSON.stringify({
      fieldKey:          row.field_key,
      action:            row.action,
      oldValue:          row.old_value,
      newValue:          row.new_value,
      reviewStateBefore: row.review_state_before,
      reviewStateAfter:  row.review_state_after,
      reviewerUid:       row.reviewer_uid,
      reviewerEmail:     row.reviewer_email,
      ts:                row.client_ts,
    }),
  };
}

// Simulates the evidence overlay logic from loadPropertyData.
function overlayEvidence(tenants, evidRows) {
  if (!evidRows?.length) return tenants;
  const evByTenant = {};
  for (const row of evidRows) {
    if (!evByTenant[row.tenant_id]) evByTenant[row.tenant_id] = {};
    const fk = row.field_key;
    if (!evByTenant[row.tenant_id][fk]) evByTenant[row.tenant_id][fk] = { snapshots: [] };
    evByTenant[row.tenant_id][fk].snapshots.push(_evidenceRowToSnapshot(row));
  }
  return tenants.map(t =>
    evByTenant[t.id] ? { ...t, fieldEvidence: evByTenant[t.id] } : t
  );
}

// Simulates the audit merge logic from loadPropertyData.
function mergeAudit(blobActivityLog, auditRows) {
  if (!auditRows?.length) return blobActivityLog;
  const normalizedEntries = auditRows.map(_auditRowToActivityEntry);
  const nonAuditEntries   = (blobActivityLog || []).filter(e => e.type !== 'field_review_audit');
  return [...nonAuditEntries, ...normalizedEntries]
    .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
}

// ── P20-1: _evidenceRowToSnapshot column mapping ──────────────────────────────
console.log('\n═══ P20-1: _evidenceRowToSnapshot ═══');
{
  const row = {
    tenant_id:               't-001',
    field_key:               'cap',
    value:                   '5',
    confidence_status:       'high',
    confidence_note:         'explicit clause quote',
    source_file:             'lease.pdf',
    source_page:             3,
    extraction_id:           'ext-abc',
    extraction_version:      'v1',
    reviewer_uid:            'uid-1',
    reviewer_email:          'reviewer@example.com',
    reviewed_at:             '2026-01-15T10:00:00Z',
    approved:                true,
    manually_edited:         false,
    original_extracted_value: '5',
    created_at:              '2026-01-15T10:00:01Z',
  };
  const snap = _evidenceRowToSnapshot(row);
  assertEqual(snap.value, '5',                      'P20-1a: value');
  assertEqual(snap.confidence.status, 'high',       'P20-1b: confidence.status');
  assertEqual(snap.confidence.note, 'explicit clause quote', 'P20-1c: confidence.note');
  assertEqual(snap.sourceFile, 'lease.pdf',         'P20-1d: sourceFile');
  assertEqual(snap.page, 3,                         'P20-1e: page');
  assertEqual(snap.extractionId, 'ext-abc',         'P20-1f: extractionId');
  assertEqual(snap.extractionVersion, 'v1',         'P20-1g: extractionVersion');
  assertEqual(snap.reviewerUid, 'uid-1',            'P20-1h: reviewerUid');
  assertEqual(snap.reviewerEmail, 'reviewer@example.com', 'P20-1i: reviewerEmail');
  assertEqual(snap.reviewedAt, '2026-01-15T10:00:00Z', 'P20-1j: reviewedAt');
  assert(snap.approved === true,                    'P20-1k: approved');
  assert(snap.manuallyEdited === false,              'P20-1l: manuallyEdited');
  assertEqual(snap.originalExtractedValue, '5',     'P20-1m: originalExtractedValue');
  assert(!('created_at' in snap),                   'P20-1n: created_at not forwarded to snapshot');
}

// ── P20-2: _auditRowToActivityEntry column mapping ────────────────────────────
console.log('\n═══ P20-2: _auditRowToActivityEntry ═══');
{
  const row = {
    tenant_id:           't-001',
    field_key:           'cap',
    action:              'override',
    label:               'CAM Cap updated',
    severity:            'warning',
    old_value:           '5',
    new_value:           '3',
    review_state_before: 'pending',
    review_state_after:  'approved',
    reviewer_uid:        'uid-1',
    reviewer_email:      'reviewer@example.com',
    client_ts:           '2026-02-01T09:00:00Z',
  };
  const entry = _auditRowToActivityEntry(row);
  assertEqual(entry.type, 'field_review_audit',        'P20-2a: type');
  assertEqual(entry.tenantId, 't-001',                 'P20-2b: tenantId');
  assertEqual(entry.timestamp, '2026-02-01T09:00:00Z', 'P20-2c: timestamp');
  assertEqual(entry.actor, 'reviewer@example.com',     'P20-2d: actor');
  assertEqual(entry.title, 'CAM Cap updated',          'P20-2e: title');
  assertEqual(entry.severity, 'warning',               'P20-2f: severity');
  const detail = JSON.parse(entry.detail);
  assertEqual(detail.fieldKey, 'cap',                  'P20-2g: detail.fieldKey');
  assertEqual(detail.action, 'override',               'P20-2h: detail.action');
  assertEqual(detail.oldValue, '5',                    'P20-2i: detail.oldValue');
  assertEqual(detail.newValue, '3',                    'P20-2j: detail.newValue');
  assertEqual(detail.reviewStateBefore, 'pending',     'P20-2k: detail.reviewStateBefore');
  assertEqual(detail.reviewStateAfter, 'approved',     'P20-2l: detail.reviewStateAfter');
  assertEqual(detail.ts, '2026-02-01T09:00:00Z',       'P20-2m: detail.ts');
}

// ── P20-3: null label falls back to 'Field review' ───────────────────────────
console.log('\n═══ P20-3: _auditRowToActivityEntry default label ═══');
{
  const row = { tenant_id: 't-x', label: null, severity: null, action: 'review', client_ts: '2026-03-01T00:00:00Z' };
  const entry = _auditRowToActivityEntry(row);
  assertEqual(entry.title, 'Field review',             'P20-3a: null label → "Field review"');
  assertEqual(entry.severity, 'info',                  'P20-3b: null severity → "info"');
}

// ── P20-4: evidence overlay — normalized wins over blob ───────────────────────
console.log('\n═══ P20-4: evidence overlay (normalized wins) ═══');
{
  const tenants = [
    { id: 't-A', fieldEvidence: { cap: { snapshots: [{ value: '5_BLOB' }] } } },
    { id: 't-B', fieldEvidence: { cap: { snapshots: [{ value: '3_BLOB' }] } } },
  ];
  const evidRows = [
    { tenant_id: 't-A', field_key: 'cap', value: '7_DB', confidence_status: 'high', confidence_note: null,
      source_file: null, source_page: null, extraction_id: null, extraction_version: null,
      reviewer_uid: null, reviewer_email: null, reviewed_at: null, approved: false, manually_edited: false,
      original_extracted_value: null, created_at: '2026-04-01T00:00:00Z' },
  ];
  const result = overlayEvidence(tenants, evidRows);
  assertEqual(result[0].fieldEvidence.cap.snapshots[0].value, '7_DB',    'P20-4a: tenant-A cap from normalized table');
  assertEqual(result[1].fieldEvidence.cap.snapshots[0].value, '3_BLOB',  'P20-4b: tenant-B untouched (no normalized rows)');
}

// ── P20-5: evidence overlay — multiple fields and rows grouped correctly ──────
console.log('\n═══ P20-5: evidence overlay (multi-field grouping) ═══');
{
  const tenants = [{ id: 't-C', fieldEvidence: {} }];
  const evidRows = [
    { tenant_id: 't-C', field_key: 'cap',          value: '5', confidence_status: 'high',  confidence_note: null, source_file: null, source_page: null, extraction_id: null, extraction_version: null, reviewer_uid: null, reviewer_email: null, reviewed_at: null, approved: false, manually_edited: false, original_extracted_value: null, created_at: '2026-04-01T01:00:00Z' },
    { tenant_id: 't-C', field_key: 'admin_fee_pct', value: '10', confidence_status: 'medium', confidence_note: null, source_file: null, source_page: null, extraction_id: null, extraction_version: null, reviewer_uid: null, reviewer_email: null, reviewed_at: null, approved: false, manually_edited: false, original_extracted_value: null, created_at: '2026-04-01T02:00:00Z' },
    { tenant_id: 't-C', field_key: 'cap',          value: '5_v2', confidence_status: 'high', confidence_note: null, source_file: null, source_page: null, extraction_id: null, extraction_version: null, reviewer_uid: null, reviewer_email: null, reviewed_at: null, approved: true, manually_edited: true, original_extracted_value: '5', created_at: '2026-04-01T03:00:00Z' },
  ];
  const result = overlayEvidence(tenants, evidRows);
  assert(result[0].fieldEvidence.cap.snapshots.length === 2,       'P20-5a: two cap snapshots accumulated');
  assertEqual(result[0].fieldEvidence.cap.snapshots[1].value, '5_v2', 'P20-5b: second cap snapshot value');
  assert(result[0].fieldEvidence.admin_fee_pct.snapshots.length === 1, 'P20-5c: one admin_fee_pct snapshot');
  assertEqual(result[0].fieldEvidence.admin_fee_pct.snapshots[0].value, '10', 'P20-5d: admin_fee_pct value');
}

// ── P20-6: empty normalized rows → blob fieldEvidence unchanged ───────────────
console.log('\n═══ P20-6: empty normalized rows → no-op ═══');
{
  const tenants = [{ id: 't-D', fieldEvidence: { cap: { snapshots: [{ value: 'BLOB' }] } } }];
  const result = overlayEvidence(tenants, []);
  assertEqual(result[0].fieldEvidence.cap.snapshots[0].value, 'BLOB', 'P20-6: empty evidRows → blob unchanged');
}

// ── P20-7: audit merge — normalized replaces blob field_review_audit ──────────
console.log('\n═══ P20-7: audit merge ═══');
{
  const blobLog = [
    { type: 'invoice_added', timestamp: '2026-01-01T00:00:00Z', actor: 'admin' },
    { type: 'field_review_audit', timestamp: '2026-01-05T00:00:00Z', detail: '{}' },
  ];
  const auditRows = [
    { tenant_id: 't-A', field_key: 'cap', action: 'override', label: 'CAM cap fixed', severity: 'info',
      old_value: '5', new_value: '3', review_state_before: null, review_state_after: null,
      reviewer_uid: null, reviewer_email: 'a@b.com', client_ts: '2026-01-10T00:00:00Z' },
  ];
  const merged = mergeAudit(blobLog, auditRows);
  // invoice_added preserved
  assert(merged.some(e => e.type === 'invoice_added'), 'P20-7a: non-audit blob entry preserved');
  // stale field_review_audit blob entry replaced by normalized
  const auditEntries = merged.filter(e => e.type === 'field_review_audit');
  assert(auditEntries.length === 1,                    'P20-7b: exactly one field_review_audit entry (normalized)');
  assertEqual(auditEntries[0].timestamp, '2026-01-10T00:00:00Z', 'P20-7c: normalized audit timestamp');
  assertEqual(auditEntries[0].actor, 'a@b.com',        'P20-7d: normalized audit actor');
  // chronological sort
  assert(new Date(merged[0].timestamp) <= new Date(merged[merged.length - 1].timestamp), 'P20-7e: merged log is chronological');
}

// ── P20-8: audit merge — empty normalized rows → blob log unchanged ───────────
console.log('\n═══ P20-8: empty audit rows → blob log unchanged ═══');
{
  const blobLog = [{ type: 'invoice_added', timestamp: '2026-01-01T00:00:00Z' }];
  const merged = mergeAudit(blobLog, []);
  assert(merged.length === 1 && merged[0].type === 'invoice_added', 'P20-8: empty auditRows → blob log unchanged');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(48));
console.log(`  ${passed} passed, ${failed} failed`);
console.log('─'.repeat(48));

if (failed > 0) process.exit(1);
