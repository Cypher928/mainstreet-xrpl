/**
 * fixtures/allocation-cases.js
 * Financial invariant test fixtures for AllocationIntegrity (Phase 5G).
 * Each fixture is a standalone allocation set — no property context needed.
 */
window.QAFixtures = window.QAFixtures || {};

// ── Clean balanced set ────────────────────────────────────────────────────────
// 3 tenants, sqft-based: 26.67% + 53.33% + 20.00% = 100.00%
window.QAFixtures.allocBalanced = [
  { tenantId: 't-1', tenantName: 'Anchor Coffee',   percent: 26.666666, amount: 12000 },
  { tenantId: 't-2', tenantName: 'Summit Fitness',  percent: 53.333334, amount: 24000 },
  { tenantId: 't-3', tenantName: 'Metro Bank',      percent: 20.000000, amount: 9000  },
];

// ── Floating-point drift ──────────────────────────────────────────────────────
// Percents sum to 99.99999 due to JS floating-point — should still be "balanced"
// (within BALANCE_TOLERANCE of 0.01%) and normalizable.
window.QAFixtures.allocFloatDrift = [
  { tenantId: 't-a', tenantName: 'Unit A', percent: 33.333333, amount: 10000 },
  { tenantId: 't-b', tenantName: 'Unit B', percent: 33.333333, amount: 10000 },
  { tenantId: 't-c', tenantName: 'Unit C', percent: 33.333334, amount: 10000 },
];

// ── Over-allocation (150%) ────────────────────────────────────────────────────
// Critical: total exceeds 100% significantly
window.QAFixtures.allocOverAllocation = [
  { tenantId: 't-x', tenantName: 'Tenant X', percent: 75, amount: 30000 },
  { tenantId: 't-y', tenantName: 'Tenant Y', percent: 75, amount: 30000 },
];

// ── Negative percent ──────────────────────────────────────────────────────────
// Critical: one tenant has a negative pro-rata
window.QAFixtures.allocNegativePercent = [
  { tenantId: 't-ok', tenantName: 'Good Tenant', percent: 110,  amount: 44000 },
  { tenantId: 't-ng', tenantName: 'Bad Tenant',  percent: -10,  amount: -4000 },
];

// ── Duplicate tenant ──────────────────────────────────────────────────────────
// Critical: same tenantId appears twice
window.QAFixtures.allocDuplicate = [
  { tenantId: 'dup-id', tenantName: 'Main Office',   percent: 50, amount: 20000 },
  { tenantId: 'dup-id', tenantName: 'Main Office 2', percent: 30, amount: 12000 },
  { tenantId: 'unique', tenantName: 'Side Office',   percent: 20, amount: 8000  },
];

// ── Zero-basis allocation ─────────────────────────────────────────────────────
// Warning: tenant has 0% pro-rata but a non-zero amount
window.QAFixtures.allocZeroBasis = [
  { tenantId: 'z-1', tenantName: 'Normal Tenant',     percent: 100, amount: 40000 },
  { tenantId: 'z-2', tenantName: 'No-Sqft Tenant',   percent: 0,   amount: 500   },
];

// ── NaN values ────────────────────────────────────────────────────────────────
// Critical: non-numeric percent
window.QAFixtures.allocNaN = [
  { tenantId: 'n-1', tenantName: 'Good Tenant',   percent: 60,  amount: 24000 },
  { tenantId: 'n-2', tenantName: 'Broken Tenant', percent: NaN, amount: 16000 },
];

// ── Under-allocation (60%) ────────────────────────────────────────────────────
// Warning: significant portion of pool unallocated
window.QAFixtures.allocUnder = [
  { tenantId: 'u-1', tenantName: 'Tenant 1', percent: 30, amount: 12000 },
  { tenantId: 'u-2', tenantName: 'Tenant 2', percent: 30, amount: 12000 },
];

// ── Rounding edge case ────────────────────────────────────────────────────────
// 3 equal tenants: 33.33% each = 99.99% — gap is 0.01% (at tolerance boundary)
window.QAFixtures.allocRoundingEdge = [
  { tenantId: 'r-1', tenantName: 'Equal A', percent: 33.33, amount: 9999.67 },
  { tenantId: 'r-2', tenantName: 'Equal B', percent: 33.33, amount: 9999.67 },
  { tenantId: 'r-3', tenantName: 'Equal C', percent: 33.33, amount: 9999.66 },
];

// ── Single tenant (edge case) ─────────────────────────────────────────────────
window.QAFixtures.allocSingle = [
  { tenantId: 's-1', tenantName: 'Only Tenant', percent: 100, amount: 50000 },
];

// ── Empty set ─────────────────────────────────────────────────────────────────
window.QAFixtures.allocEmpty = [];
