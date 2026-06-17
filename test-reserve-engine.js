'use strict';

// ─── Escrow & Reserve Engine Test Suite (Phase 21) ───────────────────────────
// Tests escrow-reserve-engine.js — the lender reserve / draw-request pure
// function layer. Not to be confused with test-escrow.js (XRPL CAM escrow
// reconciliation — an unrelated, pre-existing module).
// Run: node test-reserve-engine.js

const path = require('path');
eval(require('fs').readFileSync(path.join(__dirname, 'escrow-reserve-engine.js'), 'utf8'));

const EE = (typeof EscrowReserveEngine !== 'undefined') ? EscrowReserveEngine : module.exports;

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(label, ok, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ── Group 1: classifyReserveType ──────────────────────────────────────────────
console.log('\n── Group 1: classifyReserveType ──────────────────────────────────────────');
{
  assertEq('classifies "Roof Replacement Reserve" as roof',           EE.classifyReserveType('Roof Replacement Reserve'), 'roof');
  assertEq('classifies "HVAC Reserve Account" as hvac',                EE.classifyReserveType('HVAC Reserve Account'), 'hvac');
  assertEq('classifies "Tenant Improvement Allowance" as tenant_improvement', EE.classifyReserveType('Tenant Improvement Allowance'), 'tenant_improvement');
  assertEq('classifies "TI Reserve" as tenant_improvement',            EE.classifyReserveType('TI Reserve'), 'tenant_improvement');
  assertEq('classifies "Leasing Commission Escrow" as leasing_commission', EE.classifyReserveType('Leasing Commission Escrow'), 'leasing_commission');
  assertEq('classifies "Capital Expenditure Reserve" as capital',      EE.classifyReserveType('Capital Expenditure Reserve'), 'capital');
  assertEq('classifies "Insurance Recovery Account" as insurance_recovery', EE.classifyReserveType('Insurance Recovery Account'), 'insurance_recovery');
  assertEq('classifies unrecognized text as other',                    EE.classifyReserveType('Miscellaneous Lender Holdback'), 'other');
  assertEq('classifies null/empty as other',                           EE.classifyReserveType(null), 'other');
}

// ── Group 2: normalizeReserve ─────────────────────────────────────────────────
console.log('\n── Group 2: normalizeReserve ──────────────────────────────────────────────');
{
  const r = EE.normalizeReserve({
    reserve_type: 'Roof Reserve',
    current_balance: '125,000',
    eligible_uses: 'Roof repair and replacement only',
    requires_invoices: true,
    requires_photos: true,
    requires_lien_waivers: true,
    min_draw_amount: 5000,
    draw_request_deadline: '2026-12-31',
  }, { sourceFileName: 'roof-reserve.pdf' });

  assertEq('normalizeReserve: reserveType classified correctly', r.reserveType, 'roof');
  assertEq('normalizeReserve: label set from canonical map', r.reserveTypeLabel, 'Roof Reserve');
  assertEq('normalizeReserve: currentBalance parsed from comma string', r.currentBalance, 125000);
  assert('normalizeReserve: has a generated id', !!r.id);
  assertEq('normalizeReserve: sourceFileName carried through', r.sourceFileName, 'roof-reserve.pdf');
  assertEq('normalizeReserve: requiresInvoices true', r.requirements.requiresInvoices, true);
  assertEq('normalizeReserve: requiresPhotos true', r.requirements.requiresPhotos, true);
  assertEq('normalizeReserve: requiresLienWaivers true', r.requirements.requiresLienWaivers, true);
  assertEq('normalizeReserve: requiresContractorBids defaults false', r.requirements.requiresContractorBids, false);
  assertEq('normalizeReserve: minDrawAmount parsed', r.requirements.minDrawAmount, 5000);
  assertEq('normalizeReserve: drawRequestDeadline parsed', r.deadlines.drawRequestDeadline, '2026-12-31');

  // "Other" reserve uses lender-defined name when canonical type unrecognized
  const other = EE.normalizeReserve({ reserve_type: 'Lender Holdback', reserve_name: 'Special Lender Holdback Account' });
  assertEq('normalizeReserve: "other" type classified', other.reserveType, 'other');
  assertEq('normalizeReserve: "other" uses reserve_name as label', other.reserveTypeLabel, 'Special Lender Holdback Account');

  // Defaults: requires_invoices/requires_approval default true unless explicitly false
  const defaults = EE.normalizeReserve({ reserve_type: 'HVAC Reserve' });
  assertEq('normalizeReserve: requiresInvoices defaults true when unspecified', defaults.requirements.requiresInvoices, true);
  assertEq('normalizeReserve: requiresApproval defaults true when unspecified', defaults.requirements.requiresApproval, true);
  const explicitFalse = EE.normalizeReserve({ reserve_type: 'HVAC Reserve', requires_invoices: false, requires_approval: false });
  assertEq('normalizeReserve: requiresInvoices false when explicitly false', explicitFalse.requirements.requiresInvoices, false);
  assertEq('normalizeReserve: requiresApproval false when explicitly false', explicitFalse.requirements.requiresApproval, false);

  // currentBalance null when not provided — never coerced to 0
  const noBalance = EE.normalizeReserve({ reserve_type: 'Capital Reserve' });
  assertEq('normalizeReserve: currentBalance is null, not 0, when absent', noBalance.currentBalance, null);
}

// ── Group 3: computeReserveBalance ────────────────────────────────────────────
console.log('\n── Group 3: computeReserveBalance ──────────────────────────────────────────');
{
  const reserve = EE.normalizeReserve({ reserve_type: 'Roof Reserve', current_balance: 100000 }, { id: 'res-1' });
  const draws = [
    { id: 'd1', reserveId: 'res-1', status: 'funded',       amountRequested: 20000 },
    { id: 'd2', reserveId: 'res-1', status: 'under_review',  amountRequested: 15000 },
    { id: 'd3', reserveId: 'res-1', status: 'denied',        amountRequested: 9000 },  // excluded
    { id: 'd4', reserveId: 'res-1', status: 'draft',         amountRequested: 5000 },  // excluded
    { id: 'd5', reserveId: 'res-2', status: 'submitted',     amountRequested: 50000 }, // different reserve
  ];

  const bal = EE.computeReserveBalance(reserve, draws);
  assertEq('computeReserveBalance: committedAmount sums only submitted/under_review/approved/funded for THIS reserve', bal.committedAmount, 35000);
  assertEq('computeReserveBalance: availableBalance = currentBalance - committed', bal.availableBalance, 65000);
  assertEq('computeReserveBalance: drawCount counts only draws for this reserve', bal.drawCount, 4);

  const noBalanceReserve = EE.normalizeReserve({ reserve_type: 'HVAC Reserve' }, { id: 'res-3' });
  const bal2 = EE.computeReserveBalance(noBalanceReserve, []);
  assertEq('computeReserveBalance: availableBalance is null when currentBalance unknown', bal2.availableBalance, null);
}

// ── Group 4: validateDrawRequest ──────────────────────────────────────────────
console.log('\n── Group 4: validateDrawRequest ──────────────────────────────────────────');
{
  const reserve = EE.normalizeReserve({
    reserve_type: 'Roof Reserve', current_balance: 50000,
    requires_invoices: true, requires_photos: true, requires_lien_waivers: true,
    min_draw_amount: 1000,
  }, { id: 'res-1' });

  // Happy path: everything attached, sufficient balance
  const goodDraw = {
    id: 'dr-1', reserveId: 'res-1', amountRequested: 10000,
    invoices: [{ vendorName: 'ABC Roofing', amount: 10000 }],
    attachedDocuments: { photos: [{ fileName: 'roof1.jpg' }], lienWaivers: [{ fileName: 'waiver.pdf' }] },
  };
  let v = EE.validateDrawRequest(reserve, goodDraw, [goodDraw]);
  assert('validateDrawRequest: passes when all requirements satisfied', v.pass === true);
  assertEq('validateDrawRequest: no missing items on happy path', v.missing.length, 0);

  // Missing everything
  const emptyDraw = { id: 'dr-2', reserveId: 'res-1', amountRequested: 10000, invoices: [], attachedDocuments: {} };
  v = EE.validateDrawRequest(reserve, emptyDraw, [emptyDraw]);
  assert('validateDrawRequest: fails when invoices missing', v.pass === false);
  assert('validateDrawRequest: missing list includes invoices', v.missing.some(m => m.key === 'invoices'));
  assert('validateDrawRequest: missing list includes photos', v.missing.some(m => m.key === 'photos'));
  assert('validateDrawRequest: missing list includes lienWaivers', v.missing.some(m => m.key === 'lienWaivers'));

  // No reserve selected at all
  v = EE.validateDrawRequest(null, emptyDraw, []);
  assert('validateDrawRequest: fails with no eligible reserve', v.pass === false);
  assertEq('validateDrawRequest: single checklist item when no reserve', v.checklist.length, 1);

  // Insufficient balance: existing committed draws reduce available balance
  const otherDraw = { id: 'dr-existing', reserveId: 'res-1', status: 'approved', amountRequested: 45000 };
  const tightDraw = { id: 'dr-3', reserveId: 'res-1', amountRequested: 10000,
    invoices: [{ vendorName: 'X', amount: 10000 }],
    attachedDocuments: { photos: [{ fileName: 'a.jpg' }], lienWaivers: [{ fileName: 'b.pdf' }] } };
  v = EE.validateDrawRequest(reserve, tightDraw, [otherDraw, tightDraw]);
  assert('validateDrawRequest: fails when other committed draws exhaust balance', v.pass === false);
  assert('validateDrawRequest: missing list includes sufficientBalance', v.missing.some(m => m.key === 'sufficientBalance'));

  // Below minimum draw amount
  const tinyDraw = { id: 'dr-4', reserveId: 'res-1', amountRequested: 500,
    invoices: [{ vendorName: 'X', amount: 500 }],
    attachedDocuments: { photos: [{ fileName: 'a.jpg' }], lienWaivers: [{ fileName: 'b.pdf' }] } };
  v = EE.validateDrawRequest(reserve, tinyDraw, [tinyDraw]);
  assert('validateDrawRequest: fails when below minDrawAmount', v.pass === false);
  assert('validateDrawRequest: missing list includes minDrawAmount', v.missing.some(m => m.key === 'minDrawAmount'));

  // Unknown balance reserve always fails sufficientBalance
  const unknownBalReserve = EE.normalizeReserve({ reserve_type: 'HVAC Reserve' }, { id: 'res-4' });
  const draw = { id: 'dr-5', reserveId: 'res-4', amountRequested: 100, invoices: [{ vendorName: 'X', amount: 100 }] };
  v = EE.validateDrawRequest(unknownBalReserve, draw, [draw]);
  assert('validateDrawRequest: unknown balance never passes sufficientBalance', !v.checklist.find(c => c.key === 'sufficientBalance').met);
}

// ── Group 5: applyDrawStatus ──────────────────────────────────────────────────
console.log('\n── Group 5: applyDrawStatus ──────────────────────────────────────────────');
{
  const mkDraws = () => [
    { id: 'dr-1', reserveId: 'res-1', status: 'draft', amountRequested: 1000, statusHistory: [] },
    { id: 'dr-2', reserveId: 'res-1', status: 'draft', amountRequested: 2000 },
  ];

  let draws = mkDraws();
  let ok = EE.applyDrawStatus(draws, 'dr-1', 'submitted', { actor: 'pm@example.com' });
  assert('applyDrawStatus: returns true on match', ok === true);
  assertEq('applyDrawStatus: status updated', draws[0].status, 'submitted');
  assertEq('applyDrawStatus: history entry appended', draws[0].statusHistory.length, 1);
  assertEq('applyDrawStatus: history entry has correct status', draws[0].statusHistory[0].status, 'submitted');
  assertEq('applyDrawStatus: history entry records actor', draws[0].statusHistory[0].actor, 'pm@example.com');
  assert('applyDrawStatus: does not touch sibling draw', draws[1].status === 'draft');

  draws = mkDraws();
  assert('applyDrawStatus: initializes missing statusHistory array', (() => {
    EE.applyDrawStatus(draws, 'dr-2', 'submitted');
    return Array.isArray(draws[1].statusHistory) && draws[1].statusHistory.length === 1;
  })());

  draws = mkDraws();
  ok = EE.applyDrawStatus(draws, 'dr-1', 'bogus_status');
  assert('applyDrawStatus: rejects unrecognized status', ok === false);
  assertEq('applyDrawStatus: leaves status untouched on rejection', draws[0].status, 'draft');

  draws = mkDraws();
  ok = EE.applyDrawStatus(draws, 'nope', 'submitted');
  assert('applyDrawStatus: unknown id returns false', ok === false);
}

// ── Group 6: buildDrawRequestPackage ──────────────────────────────────────────
console.log('\n── Group 6: buildDrawRequestPackage ──────────────────────────────────────');
{
  const property = { id: 'p1', name: 'Main St Plaza', totalSqft: 50000 };
  const reserve  = EE.normalizeReserve({ reserve_type: 'Roof Reserve', current_balance: 50000 }, { id: 'res-1' });
  const drawRequest = {
    id: 'dr-1', reserveId: 'res-1', amountRequested: 10000, status: 'draft', createdAt: '2026-01-01T00:00:00Z',
    invoices: [{ vendorName: 'ABC Roofing', amount: 10000 }],
    attachedDocuments: { photos: [{ fileName: 'roof1.jpg' }], lienWaivers: [{ fileName: 'waiver.pdf' }] },
  };
  const validation = EE.validateDrawRequest(reserve, drawRequest, [drawRequest]);
  const pkg = EE.buildDrawRequestPackage(property, reserve, drawRequest, validation);

  assertEq('buildDrawRequestPackage: property name carried through', pkg.property.name, 'Main St Plaza');
  assertEq('buildDrawRequestPackage: reserve type carried through', pkg.reserve.type, 'Roof Reserve');
  assertEq('buildDrawRequestPackage: invoice total computed', pkg.invoiceSummary.total, 10000);
  assertEq('buildDrawRequestPackage: invoice count computed', pkg.invoiceSummary.count, 1);
  assertEq('buildDrawRequestPackage: supportingDocuments flattened with category', pkg.supportingDocuments.length, 2);
  assert('buildDrawRequestPackage: photo tagged with category', pkg.supportingDocuments.some(d => d.category === 'Photo'));
  assert('buildDrawRequestPackage: lien waiver tagged with category', pkg.supportingDocuments.some(d => d.category === 'Lien Waiver'));
  assertEq('buildDrawRequestPackage: complete reflects validation.pass (true)', pkg.complete, true);

  // Incomplete package — validation fails, complete must be false
  const badDraw = { id: 'dr-2', reserveId: 'res-1', amountRequested: 10000, invoices: [], attachedDocuments: {} };
  const badValidation = EE.validateDrawRequest(reserve, badDraw, [badDraw]);
  const badPkg = EE.buildDrawRequestPackage(property, reserve, badDraw, badValidation);
  assertEq('buildDrawRequestPackage: complete is false when validation fails', badPkg.complete, false);

  // No reserve at all
  const noReservePkg = EE.buildDrawRequestPackage(property, null, badDraw, { pass: false, checklist: [] });
  assertEq('buildDrawRequestPackage: reserve is null when none provided', noReservePkg.reserve, null);
}

// ── Group 7: Enum integrity ───────────────────────────────────────────────────
console.log('\n── Group 7: Enum integrity ───────────────────────────────────────────────');
{
  assertEq('RESERVE_TYPES has 7 canonical types', EE.RESERVE_TYPES.length, 7);
  assertEq('DRAW_STATUSES matches locked vocabulary', EE.DRAW_STATUSES,
    ['draft', 'submitted', 'under_review', 'approved', 'funded', 'denied']);
  EE.DRAW_STATUSES.forEach(s => {
    assert(`DRAW_STATUS_LABELS has a label for "${s}"`, typeof EE.DRAW_STATUS_LABELS[s] === 'string');
  });
  EE.RESERVE_TYPES.forEach(r => {
    assertEq(`RESERVE_TYPE_LABELS["${r.key}"] matches`, EE.RESERVE_TYPE_LABELS[r.key], r.label);
  });
}

console.log('\n' + '─'.repeat(62));
console.log(`Results: ${passed}/${passed + failed} passed`);
console.log('─'.repeat(62));

if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('\n✅ All escrow & reserve engine tests pass');
}
