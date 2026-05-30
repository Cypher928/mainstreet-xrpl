'use strict';
/**
 * test-timeline.js — Regression tests for appendPropertyTimelineEvent / derivePropertyTimeline.
 * Zero-DOM, zero-network. Run: node test-timeline.js
 */

// ── Minimal stubs ─────────────────────────────────────────────────────────────
global.window = global.window || {};
window.ms_timelineDebug = { propertyId: null, lastEvent: null, totalEvents: 0, updatedAt: null };
console.log = console.log.bind(console); // let [TIMELINE] lines pass through

// ── Inline implementations ────────────────────────────────────────────────────

function appendPropertyTimelineEvent(property, event) {
  if (!property || !event) return null;
  if (!Array.isArray(property.timeline)) property.timeline = [];
  const now = new Date().toISOString();
  const entry = {
    id:                  event.id || ('tl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
    timestamp:           event.timestamp || now,
    type:                event.type || 'unknown',
    severity:            (['critical','warning','info','success'].includes(event.severity) ? event.severity : 'info'),
    propertyId:          event.propertyId ?? property.id ?? null,
    tenantId:            event.tenantId   ?? null,
    actor:               event.actor      ?? 'System',
    source:              event.source     ?? null,
    title:               event.title      ?? '',
    description:         event.description ?? '',
    metadata:            (event.metadata && typeof event.metadata === 'object') ? event.metadata : {},
    relatedEvidenceIds:  Array.isArray(event.relatedEvidenceIds)  ? event.relatedEvidenceIds  : [],
    relatedDisputeIds:   Array.isArray(event.relatedDisputeIds)   ? event.relatedDisputeIds   : [],
    relatedInvoiceIds:   Array.isArray(event.relatedInvoiceIds)   ? event.relatedInvoiceIds   : [],
    derivedStateVersion: event.derivedStateVersion ?? property.derivedStateVersion ?? null,
  };
  property.timeline.push(entry);
  if (property.timeline.length > 500) property.timeline = property.timeline.slice(-500);
  window.ms_timelineDebug = {
    propertyId:   property.id,
    lastEvent:    entry,
    totalEvents:  property.timeline.length,
    updatedAt:    now,
  };
  console.log('[TIMELINE]', entry.type, '|', entry.severity, '|', entry.title, '| v' + (entry.derivedStateVersion ?? '?'));
  return entry;
}

function derivePropertyTimeline(property) {
  const tl = Array.isArray(property.timeline) ? property.timeline : [];
  return {
    totalEvents:      tl.length,
    criticalEvents:   tl.filter(e => e.severity === 'critical'),
    recentActivity:   tl.slice(-10).reverse(),
    disputeHistory:   tl.filter(e => e.type === 'dispute_created' || e.type === 'dispute_resolved'),
    amendmentHistory: tl.filter(e => e.type === 'amendment_uploaded' || e.type === 'amendment_applied'),
    extractionHistory:tl.filter(e => ['lease_uploaded','extraction_completed','extraction_warning'].includes(e.type)),
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error(`  FAIL: ${msg}`);
    failed++;
  } else {
    console.log(`  pass: ${msg}`);
    passed++;
  }
}

function assertEqual(a, b, msg) {
  if (a !== b) {
    console.error(`  FAIL: ${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    failed++;
  } else {
    console.log(`  pass: ${msg}`);
    passed++;
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── TEST timeline-1: Dispute submit appends event ────────────────────────────

console.log('\nTEST timeline-1 — Dispute submit appends event');
{
  const prop = { id: 'prop-1' };
  appendPropertyTimelineEvent(prop, {
    type: 'dispute_created', severity: 'warning',
    title: 'Dispute filed — Acme', metadata: { vendor: 'Acme' },
  });
  assertEqual(prop.timeline.length, 1, 'timeline has 1 entry');
  assertEqual(prop.timeline[0].type, 'dispute_created', 'type is dispute_created');
  assertEqual(prop.timeline[0].severity, 'warning', 'severity is warning');
  assert(prop.timeline[0].id.startsWith('tl-'), 'id starts with tl-');
}

// ── TEST timeline-2: Amendment upload appends event ──────────────────────────

console.log('\nTEST timeline-2 — Amendment upload appends event');
{
  const prop = { id: 'prop-2' };
  const now = Date.now();
  appendPropertyTimelineEvent(prop, {
    type: 'amendment_uploaded', severity: 'info',
    title: 'Amendment uploaded — lease_v2.pdf',
    timestamp: new Date(now).toISOString(),
  });
  appendPropertyTimelineEvent(prop, {
    type: 'amendment_applied', severity: 'info',
    title: 'Amendment applied — 2 fields modified',
    timestamp: new Date(now + 10).toISOString(),
  });
  assertEqual(prop.timeline.length, 2, 'timeline has 2 entries');
  assertEqual(prop.timeline[0].type, 'amendment_uploaded', 'first event is amendment_uploaded');
  assertEqual(prop.timeline[1].type, 'amendment_applied', 'second event is amendment_applied');
  assert(prop.timeline[1].timestamp >= prop.timeline[0].timestamp, 'second timestamp >= first (chronological)');
}

// ── TEST timeline-3: Field override appends immutable audit entry ─────────────

console.log('\nTEST timeline-3 — Field override appends immutable audit entry');
{
  const prop = { id: 'prop-3' };
  appendPropertyTimelineEvent(prop, {
    type: 'field_overridden', severity: 'info',
    title: 'Field corrected — leased_sqft', metadata: { fieldName: 'leased_sqft', original: '1000', newValue: '1200' },
  });
  const originalId = prop.timeline[0].id;
  const originalMeta = JSON.stringify(prop.timeline[0].metadata);
  appendPropertyTimelineEvent(prop, { type: 'review_confirmed', severity: 'success', title: 'All fields confirmed' });
  assertEqual(prop.timeline.length, 2, 'timeline has 2 entries after second event');
  assertEqual(prop.timeline[0].id, originalId, 'original entry id unchanged');
  assertEqual(JSON.stringify(prop.timeline[0].metadata), originalMeta, 'original entry metadata unchanged');
}

// ── TEST timeline-4: Timeline survives reload (JSON round-trip) ───────────────

console.log('\nTEST timeline-4 — Timeline survives reload');
{
  const prop = { id: 'prop-4' };
  appendPropertyTimelineEvent(prop, {
    type: 'lease_uploaded', severity: 'info',
    title: 'Lease uploaded', metadata: { total: 3, successCount: 3 },
    relatedDisputeIds: ['d-1', 'd-2'],
  });
  const serialized   = JSON.stringify(prop.timeline);
  const deserialized = JSON.parse(serialized);
  assertEqual(deserialized.length, prop.timeline.length, 'entry count unchanged after round-trip');
  assertEqual(deserialized[0].id, prop.timeline[0].id, 'entry id identical after round-trip');
  assert(deepEqual(deserialized[0].metadata, { total: 3, successCount: 3 }), 'metadata intact after round-trip');
  assert(deepEqual(deserialized[0].relatedDisputeIds, ['d-1', 'd-2']), 'relatedDisputeIds intact after round-trip');
}

// ── TEST timeline-5: Timeline export remains chronological ───────────────────

console.log('\nTEST timeline-5 — Timeline export remains chronological');
{
  const prop = { id: 'prop-5' };
  const base = new Date('2025-01-01T00:00:00Z').getTime();
  for (let i = 0; i < 5; i++) {
    appendPropertyTimelineEvent(prop, {
      type: 'sync_restored', severity: 'info',
      title: `Event ${i}`,
      timestamp: new Date(base + i * 1000).toISOString(),
    });
  }
  assert(prop.timeline[0].timestamp < prop.timeline[4].timestamp, 'oldest-first order in timeline array');
  const derived = derivePropertyTimeline(prop);
  assert(derived.recentActivity[0].timestamp > derived.recentActivity[1].timestamp, 'recentActivity is newest-first');
}

// ── TEST timeline-6: derivedStateVersion attached correctly ──────────────────

console.log('\nTEST timeline-6 — derivedStateVersion attached correctly');
{
  const prop = { id: 'prop-6', derivedStateVersion: 7 };
  appendPropertyTimelineEvent(prop, { type: 'invoice_imported', severity: 'info', title: 'Invoices imported' });
  assertEqual(prop.timeline[0].derivedStateVersion, 7, 'derivedStateVersion from property when not explicit');

  prop.derivedStateVersion = 8;
  appendPropertyTimelineEvent(prop, { type: 'dispute_created', severity: 'warning', title: 'Dispute filed', derivedStateVersion: 99 });
  assertEqual(prop.timeline[1].derivedStateVersion, 99, 'explicit derivedStateVersion wins over property value');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
console.log(`Timeline tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('TIMELINE SUITE FAILED');
  process.exit(1);
} else {
  console.log('Timeline suite PASSED');
}
