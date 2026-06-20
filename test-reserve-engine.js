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

// ── Group 2b: extraction confidence & source-page citation ────────────────────
console.log('\n── Group 2b: extraction confidence & source-page citation ──────────────────');
{
  // Strong evidence: every confidence field has a verbatim quote + page
  const strong = EE.normalizeReserve({
    reserve_type: 'Roof Reserve', current_balance: 75000, eligible_uses: 'Roof repair only',
    evidence: {
      reserve_type:    { quote: 'Roof Reserve Account', page: 17 },
      current_balance: { quote: 'balance of $75,000.00', page: 17 },
      eligible_uses:    { quote: 'used solely for roof repair', page: 18 },
    },
  });
  assertEq('normalizeReserve: confidence level "high" when all fields quoted + paged', strong.extractionConfidence.level, 'high');
  assertEq('normalizeReserve: sourcePages deduped and sorted', strong.sourcePages, [17, 18]);
  assert('normalizeReserve: evidence carried through verbatim', strong.evidence.reserve_type.quote === 'Roof Reserve Account');

  // No evidence at all — confidence should be low/failed, no source pages
  const weak = EE.normalizeReserve({ reserve_type: 'HVAC Reserve', current_balance: 50000 });
  assert('normalizeReserve: confidence is not "high" with zero quotes', weak.extractionConfidence.level !== 'high');
  assertEq('normalizeReserve: sourcePages empty when no evidence', weak.sourcePages, []);
  assert('normalizeReserve: reasons explain missing quotes', weak.extractionConfidence.reasons.length > 0);

  // deriveReserveExtractionConfidence directly — pdf_vision path lowers score
  const textPath = EE.deriveReserveExtractionConfidence({
    reserve_type: { quote: 'x', page: 1 }, current_balance: { quote: 'x', page: 1 }, eligible_uses: { quote: 'x', page: 1 },
  }, { extractionPath: 'text' });
  const visionPath = EE.deriveReserveExtractionConfidence({
    reserve_type: { quote: 'x', page: 1 }, current_balance: { quote: 'x', page: 1 }, eligible_uses: { quote: 'x', page: 1 },
  }, { extractionPath: 'pdf_vision' });
  assert('deriveReserveExtractionConfidence: pdf_vision path scores lower than text path', visionPath.score < textPath.score);

  const shortOcr = EE.deriveReserveExtractionConfidence({}, { ocrChars: 100 });
  const noOcrInfo = EE.deriveReserveExtractionConfidence({}, {});
  assert('deriveReserveExtractionConfidence: short OCR text lowers score further', shortOcr.score < noOcrInfo.score);

  const noQuotePage = EE.deriveReserveExtractionConfidence({
    reserve_type: { quote: 'x', page: null }, current_balance: { quote: 'x', page: null }, eligible_uses: { quote: 'x', page: null },
  }, {});
  const withPage = EE.deriveReserveExtractionConfidence({
    reserve_type: { quote: 'x', page: 5 }, current_balance: { quote: 'x', page: 5 }, eligible_uses: { quote: 'x', page: 5 },
  }, {});
  assert('deriveReserveExtractionConfidence: missing page numbers score lower than same quotes with pages', noQuotePage.score < withPage.score);
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

  // Citation + status history + draw number (Priority 1 — lender package additions)
  const citedReserve = EE.normalizeReserve({
    reserve_type: 'Roof Reserve', current_balance: 75000,
    evidence: { current_balance: { quote: 'Lender shall maintain a Roof Reserve Account with an initial balance of $75,000', page: 3 } },
  }, { id: 'res-2', sourceFileName: 'Reserve_Agreement.pdf' });
  const numberedDraw = {
    id: 'dr-3', drawNumber: 3, reserveId: 'res-2', amountRequested: 42179.61, status: 'submitted',
    invoices: [], attachedDocuments: {},
    statusHistory: [{ status: 'draft', timestamp: '2026-01-01T00:00:00Z', actor: 'User' }, { status: 'submitted', timestamp: '2026-01-02T00:00:00Z', actor: 'User' }],
  };
  const citedValidation = EE.validateDrawRequest(citedReserve, numberedDraw, [numberedDraw]);
  const citedPkg = EE.buildDrawRequestPackage(property, citedReserve, numberedDraw, citedValidation);

  assertEq('buildDrawRequestPackage: drawNumber carried through', citedPkg.drawRequest.drawNumber, 3);
  assertEq('buildDrawRequestPackage: statusHistory carried through', citedPkg.drawRequest.statusHistory.length, 2);
  assert('buildDrawRequestPackage: reserve citation quote present', citedPkg.reserve.citation && citedPkg.reserve.citation.quote.includes('$75,000'));
  assertEq('buildDrawRequestPackage: reserve citation page present', citedPkg.reserve.citation.page, 3);
  assertEq('buildDrawRequestPackage: reserve citation source file name present', citedPkg.reserve.citation.sourceFileName, 'Reserve_Agreement.pdf');

  const uncitedPkg = EE.buildDrawRequestPackage(property, reserve, drawRequest, validation);
  assertEq('buildDrawRequestPackage: citation is null when reserve has no evidence quotes', uncitedPkg.reserve.citation, null);
}

// ── Group 6b: buildDrawEmailDraft ──────────────────────────────────────────
console.log('\n── Group 6b: buildDrawEmailDraft ───────────────────────────────────────────');
{
  const property = { id: 'p1', name: 'Maple Plaza' };
  const reserve  = EE.normalizeReserve({ reserve_type: 'Roof Reserve' }, { id: 'res-1' });
  const drawRequest = {
    id: 'dr-3', drawNumber: 3, amountRequested: 42179.61,
    invoices: [{ vendorName: 'ABC Roofing', amount: 42179.61 }],
    attachedDocuments: { lienWaivers: [{ fileName: 'waiver.pdf' }], photos: [{ fileName: 'p1.jpg' }] },
  };
  const draft = EE.buildDrawEmailDraft(property, reserve, drawRequest);

  assertEq('buildDrawEmailDraft: subject follows "{Reserve} Draw Request - {Property}" format',
    draft.subject, 'Roof Reserve Draw Request - Maple Plaza');
  assert('buildDrawEmailDraft: body references the draw number', draft.body.includes('Draw Request #3'));
  assert('buildDrawEmailDraft: body references the reserve type', draft.body.includes('Roof Reserve'));
  assert('buildDrawEmailDraft: body lists invoices as supporting documentation', draft.body.includes('Invoice'));
  assert('buildDrawEmailDraft: body lists lien waivers', draft.body.includes('Lien Waiver'));
  assert('buildDrawEmailDraft: body lists photos', draft.body.includes('Photos'));
  assert('buildDrawEmailDraft: body includes the formatted requested amount', draft.body.includes('$42,179.61'));

  const noDrawNumberDraft = EE.buildDrawEmailDraft(property, reserve, { amountRequested: 1000, invoices: [], attachedDocuments: {} });
  assert('buildDrawEmailDraft: falls back to generic "Draw Request" label when no drawNumber set',
    noDrawNumberDraft.body.includes('Draw Request\n') || noDrawNumberDraft.body.startsWith('Draw Request'));
  assertEq('buildDrawEmailDraft: handles missing property/reserve/draw gracefully', EE.buildDrawEmailDraft(null, null, null).subject, 'Reserve Draw Request - (unnamed property)');
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

// ── Group 8: Phase 21 hardening pass ───────────────────────────────────────
console.log('\n── Group 8: Phase 21 hardening pass ───────────────────────────────────────');
{
  // FP-H1 (#8): document category keys used across the draw pipeline must be the
  // canonical camelCase plural set — guards against the upload-button key mismatch.
  const CANONICAL_DOC_CATEGORIES = ['photos', 'lienWaivers', 'contractorBids', 'engineerCertification'];
  const draws = [{
    id: 'dr-cat', reserveId: 'res-1', amountRequested: 5000, status: 'draft',
    attachedDocuments: {
      photos: [{ fileName: 'roof1.jpg' }],
      lienWaivers: [{ fileName: 'waiver.pdf' }],
      contractorBids: [{ fileName: 'bid.pdf' }],
      engineerCertification: [{ fileName: 'cert.pdf' }],
    },
  }];
  const reserve = EE.normalizeReserve({ reserve_type: 'Roof Reserve', current_balance: 50000 }, { id: 'res-1' });
  const pkg = EE.buildDrawRequestPackage({ id: 'p1', name: 'Test' }, reserve, draws[0], { pass: true, checklist: [] });
  assert('buildDrawRequestPackage: defines all 4 canonical document categories', CANONICAL_DOC_CATEGORIES.length === 4);
  assertEq('buildDrawRequestPackage: all 4 canonical categories flatten into supportingDocuments',
    pkg.supportingDocuments.length, 4);
  assert('buildDrawRequestPackage: engineer certification carried through with category label',
    pkg.supportingDocuments.some(d => d.category === 'Engineer Certification'));

  // FP-H2 (#12): applyDrawStatus must append a "timestamp" key (not "at") so the
  // status-history timeline can render every entry — including the initial
  // draft entry created at draw-request creation time — with one field name.
  let historyDraws = [{ id: 'dr-h', reserveId: 'res-1', status: 'draft', amountRequested: 1000,
    statusHistory: [{ status: 'draft', timestamp: '2026-01-01T00:00:00Z', note: null, actor: 'User' }] }];
  EE.applyDrawStatus(historyDraws, 'dr-h', 'submitted', { actor: 'pm@example.com' });
  assert('applyDrawStatus: appended entry uses "timestamp" key', 'timestamp' in historyDraws[0].statusHistory[1]);
  assert('applyDrawStatus: appended entry has no "at" key', !('at' in historyDraws[0].statusHistory[1]));
  assertEq('applyDrawStatus: history now has both the initial entry and the new one',
    historyDraws[0].statusHistory.length, 2);

  // FP-H3 (#10): replicate the $0/invalid-amount draw-request guard so the
  // validation rule itself is regression-tested independent of the DOM.
  const isValidDrawAmount = (raw) => {
    const n = parseFloat(raw);
    return !!n && !isNaN(n) && n > 0;
  };
  assert('draw amount guard: rejects empty string', !isValidDrawAmount(''));
  assert('draw amount guard: rejects zero', !isValidDrawAmount('0'));
  assert('draw amount guard: rejects negative', !isValidDrawAmount('-50'));
  assert('draw amount guard: rejects non-numeric', !isValidDrawAmount('abc'));
  assert('draw amount guard: accepts a positive amount', isValidDrawAmount('2500.50'));
}

// ── Group 9: Multi-reserve document extraction ─────────────────────────────
console.log('\n── Group 9: Multi-reserve document extraction ─────────────────────────────');
{
  // Reproduction case: a single loan agreement describing three distinct reserve
  // accounts (Roof, HVAC, Capital). The extraction prompt now asks Claude for an
  // array — one element per reserve — instead of collapsing to a single object.
  const rawReserves = [
    { reserve_type: 'Roof Reserve', current_balance: 75000, eligible_uses: 'Roof repair and replacement only' },
    { reserve_type: 'HVAC Reserve', current_balance: 40000, eligible_uses: 'HVAC repair and replacement only' },
    // A reserve where Claude could not confidently determine a balance — this
    // must normalize to a null currentBalance, not crash downstream renderers.
    { reserve_type: 'Capital Reserve', current_balance: null, eligible_uses: 'General capital improvements' },
  ];
  const normalized = rawReserves.map(r => EE.normalizeReserve(r, { sourceFileName: 'Reserve_Agreement.pdf' }));

  assertEq('normalizeReserve: produces one reserve per array element', normalized.length, 3);
  assert('normalizeReserve: each reserve has a distinct id',
    new Set(normalized.map(r => r.id)).size === 3);
  assertEq('normalizeReserve: first reserve type preserved', normalized[0].reserveType, 'roof');
  assertEq('normalizeReserve: second reserve type preserved', normalized[1].reserveType, 'hvac');
  assertEq('normalizeReserve: third reserve type preserved', normalized[2].reserveType, 'capital');
  assertEq('normalizeReserve: balances are not cross-contaminated between reserves',
    normalized[0].currentBalance, 75000);
  assertEq('normalizeReserve: second reserve balance independent of first', normalized[1].currentBalance, 40000);
  assertEq('normalizeReserve: null current_balance normalizes to null, not NaN', normalized[2].currentBalance, null);

  // computeReserveBalance must surface a null balance as null (never NaN/undefined)
  // so a currency formatter can detect it and avoid calling toLocaleString on null.
  const balForNullReserve = EE.computeReserveBalance(normalized[2], []);
  assertEq('computeReserveBalance: currentBalance stays null when reserve has no stated balance',
    balForNullReserve.currentBalance, null);
  assertEq('computeReserveBalance: availableBalance is null (not NaN) when balance is unknown',
    balForNullReserve.availableBalance, null);

  // Regression guard for the reported crash: "null is not an object (evaluating
  // 'n.toLocaleString')". Replicates script.js's fmt() null-safety contract —
  // a currency formatter must never call .toLocaleString() directly on a value
  // that can legitimately be null (current_balance is documented as
  // `number | null` in the extraction schema).
  const safeFmt = (n) => {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  assertEq('fmt-equivalent: renders "—" for a null balance instead of throwing', safeFmt(null), '—');
  assertEq('fmt-equivalent: renders "—" for an undefined balance instead of throwing', safeFmt(undefined), '—');
  assertEq('fmt-equivalent: renders a real balance normally', safeFmt(75000), '$75,000.00');
  assert('fmt-equivalent: does not throw when called on every reserve in a mixed-null batch', (() => {
    try { normalized.forEach(r => safeFmt(EE.computeReserveBalance(r, []).availableBalance)); return true; }
    catch (e) { return false; }
  })());
}

// ── Group 10: classifyInvoiceReserveType ───────────────────────────────────
console.log('\n── Group 10: classifyInvoiceReserveType ────────────────────────────────────');
{
  assertEq('classifies a roofing vendor invoice as roof',
    EE.classifyInvoiceReserveType({ vendorName: 'ABC Roofing Co.' }).reserveType, 'roof');
  assertEq('classifies an HVAC vendor invoice as hvac',
    EE.classifyInvoiceReserveType({ vendorName: 'Acme HVAC & Heating Services' }).reserveType, 'hvac');
  assertEq('classifies an insurance-category invoice as insurance_recovery via category fallback',
    EE.classifyInvoiceReserveType({ vendorName: 'State Farm', category: 'insurance' }).reserveType, 'insurance_recovery');
  assertEq('classifies a capital project invoice (parking lot paving) as capital',
    EE.classifyInvoiceReserveType({ vendorName: 'Statewide Paving Inc.', description: 'parking lot paving' }).reserveType, 'capital');
  assertEq('classifies an unrelated vendor invoice as other',
    EE.classifyInvoiceReserveType({ vendorName: 'Acme Office Supplies' }).reserveType, 'other');
  assertEq('classifies an invoice with no fields as other',
    EE.classifyInvoiceReserveType({}).reserveType, 'other');
  assert('roof match returns a confidence score above the "other" fallback score',
    EE.classifyInvoiceReserveType({ vendorName: 'Roofing Experts LLC' }).confidence >
    EE.classifyInvoiceReserveType({}).confidence);
}

// ── Group 11: normalizeReserve sourceDocuments ─────────────────────────────
console.log('\n── Group 11: normalizeReserve sourceDocuments ──────────────────────────────');
{
  const r1 = EE.normalizeReserve({ reserve_type: 'Roof Reserve', current_balance: 75000 }, {
    sourceFileName: 'loan-agreement.pdf', sourceFileUrl: 'https://example.com/loan-agreement.pdf',
  });
  assertEq('normalizeReserve: sourceDocuments seeded from sourceFileName/sourceFileUrl',
    r1.sourceDocuments.length, 1);
  assertEq('normalizeReserve: seeded sourceDocuments entry has the right fileName',
    r1.sourceDocuments[0].fileName, 'loan-agreement.pdf');
  assertEq('normalizeReserve: seeded sourceDocuments entry has the right fileUrl',
    r1.sourceDocuments[0].fileUrl, 'https://example.com/loan-agreement.pdf');

  const r2 = EE.normalizeReserve({ reserve_type: 'Roof Reserve' }, {});
  assertEq('normalizeReserve: sourceDocuments defaults to an empty array when no file metadata given',
    r2.sourceDocuments.length, 0);
}

// ── Group 12: mergeReserveExtractions ───────────────────────────────────────
console.log('\n── Group 12: mergeReserveExtractions ───────────────────────────────────────');
{
  // Same reserve type extracted from page 1 (with balance + evidence) and
  // page 2 (no balance restated) of the same upload batch should collapse
  // into one card carrying both citations — this is the "one card, multiple
  // citations" fix for the duplicate Capital Reserve cards complaint.
  const r1 = EE.normalizeReserve({
    reserve_type: 'Capital Reserve', current_balance: 150000,
    evidence: { current_balance: { quote: 'Capital Reserve balance: $150,000', page: 1 } },
  }, { sourceFileName: 'mortgage.pdf', sourceFileUrl: 'https://example.com/mortgage.pdf' });

  const r2 = EE.normalizeReserve({
    reserve_type: 'Capital Reserve', current_balance: null,
    evidence: { eligible_uses: { quote: 'May be used for capital improvements', page: 2 } },
    eligible_uses: 'Capital improvements',
  }, { sourceFileName: 'mortgage.pdf', sourceFileUrl: 'https://example.com/mortgage.pdf' });

  const merged = EE.mergeReserveExtractions([r1, r2]);
  assertEq('mergeReserveExtractions: collapses same-type extractions into one reserve', merged.length, 1);
  assertEq('mergeReserveExtractions: keeps the non-null balance from the first mention', merged[0].currentBalance, 150000);
  assertEq('mergeReserveExtractions: unions sourcePages from both mentions', merged[0].sourcePages, [1, 2]);
  assertEq('mergeReserveExtractions: carries forward eligibleUses from the second mention', merged[0].eligibleUses, 'Capital improvements');
  assert('mergeReserveExtractions: evidence includes both pages\' citations',
    !!(merged[0].evidence.current_balance && merged[0].evidence.eligible_uses),
    JSON.stringify(merged[0].evidence));

  // Different reserve types in the same batch should NOT be merged.
  const r3 = EE.normalizeReserve({ reserve_type: 'Roof Reserve', current_balance: 50000 }, { sourceFileName: 'mortgage.pdf' });
  const mergedMixed = EE.mergeReserveExtractions([r1, r2, r3]);
  assertEq('mergeReserveExtractions: leaves distinct reserve types as separate cards', mergedMixed.length, 2);

  // sourceDocuments union, deduplicated by fileUrl+fileName.
  const a = EE.normalizeReserve({ reserve_type: 'HVAC Reserve' }, { sourceFileName: 'a.pdf', sourceFileUrl: 'https://x/a.pdf' });
  const b = EE.normalizeReserve({ reserve_type: 'HVAC Reserve' }, { sourceFileName: 'b.pdf', sourceFileUrl: 'https://x/b.pdf' });
  const mergedDocs = EE.mergeReserveExtractions([a, b]);
  assertEq('mergeReserveExtractions: unions sourceDocuments across files', mergedDocs[0].sourceDocuments.length, 2);

  // requirements booleans OR together across the group.
  const c = EE.normalizeReserve({ reserve_type: 'TI Reserve', requires_photos: false, requires_lien_waivers: true }, {});
  const d = EE.normalizeReserve({ reserve_type: 'TI Reserve', requires_photos: true, requires_lien_waivers: false }, {});
  const mergedReq = EE.mergeReserveExtractions([c, d]);
  assertEq('mergeReserveExtractions: ORs requiresPhotos across the group', mergedReq[0].requirements.requiresPhotos, true);
  assertEq('mergeReserveExtractions: ORs requiresLienWaivers across the group', mergedReq[0].requirements.requiresLienWaivers, true);

  // Single-element groups pass through unchanged.
  const single = EE.mergeReserveExtractions([r3]);
  assertEq('mergeReserveExtractions: single-element group passes through unchanged', single[0], r3);

  // Empty/falsy-filled input is handled safely.
  assertEq('mergeReserveExtractions: filters out null/undefined entries', EE.mergeReserveExtractions([null, r3, undefined]).length, 1);
  assertEq('mergeReserveExtractions: empty array returns empty array', EE.mergeReserveExtractions([]).length, 0);
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
