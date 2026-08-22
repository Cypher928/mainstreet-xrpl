'use strict';
/**
 * test-lease-readiness.js — "ready for CAM" must mean what it says.
 *
 *   node test-lease-readiness.js
 *
 * THE BUGS THIS EXISTS FOR
 *
 * 1. A lease with no square footage was counted as Ready and offered under
 *    "Approve all ready", on a screen whose own card read "Missing Sq Ft". The
 *    count consulted only whether extraction had finished, never whether the
 *    lease carried the fields CAM needs.
 *
 * 2. The fix for (1) wired the count to deriveTenantReviewState().missing —
 *    the whole set. That set includes nnn_cap_missing and audit_rights_unknown,
 *    which are review items, not reconciliation inputs. Every Triple Net lease
 *    without an explicit cap was then listed as "extracted but not ready for
 *    CAM ... cannot be reconciled until the missing values are entered" — on
 *    the same run in which the engine reconciled it. That is the same
 *    contradiction inverted, and the sentence is untrue.
 *
 * THE RULE
 * getValidTenants() is the authority on what the CAM engine will reconcile: a
 * name, leased_sqft > 0, a successful extraction, no property mismatch. Only
 * the absence of a field in THAT filter may be described as blocking
 * reconciliation. Everything else is a review item and must be worded as one.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const eqj = (m, a, e) => JSON.stringify(a) === JSON.stringify(e)
  ? ok(`${m} → ${JSON.stringify(a)}`)
  : bad(m, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);

// ── load ReviewEngine ────────────────────────────────────────────────────────
const box = { window: {}, console, Date, Math, Number, String, Array, JSON, RegExp, Set, Boolean };
box.globalThis = box;
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'review-engine.js'), 'utf8'), box);
const RE = box.window.ReviewEngine;

const scriptCode = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

// Mirror of script.js's deriveTenantReviewState post-processing, built from the
// engine's own exported sets so it cannot drift from them silently. The source
// assertions below check that script.js really computes it this way.
const derive = (t) => {
  const rv = RE.deriveTenantReviewState(t, []);
  const missing     = rv.warnings.filter(w => RE.MISSING_FIELD_TYPES.has(w.type)).map(w => w.label);
  const camBlocking = rv.warnings.filter(w => RE.CAM_BLOCKING_FIELD_TYPES.has(w.type)).map(w => w.label);
  const reviewItems = rv.warnings
    .filter(w => RE.MISSING_FIELD_TYPES.has(w.type) && !RE.CAM_BLOCKING_FIELD_TYPES.has(w.type))
    .map(w => w.label);
  return { missing, camBlocking, reviewItems };
};

const NNN = 'Triple Net (NNN)';
const reconcilable = { tenant_name: 'Dover', leased_sqft: 8194, lease_type: NNN,
                       start_date: '2011-07-01', end_date: '2016-07-01', cap: null };
const noSqft       = { tenant_name: 'Guaranty State Bank', leased_sqft: null, lease_type: NNN,
                       start_date: '2020-01-01', end_date: '2030-01-01', cap: null };
const capped       = { tenant_name: 'Capped', leased_sqft: 5000, lease_type: NNN,
                       start_date: '2020-01-01', end_date: '2030-01-01', cap: '5', audit_rights: true };

console.log('\n── The two sets ──');

yes('CAM_BLOCKING_FIELD_TYPES is exported', RE.CAM_BLOCKING_FIELD_TYPES instanceof Set,
    'the engine does not expose a CAM-blocking set');
yes('every CAM-blocking type is also a missing-field type',
    [...RE.CAM_BLOCKING_FIELD_TYPES].every(t => RE.MISSING_FIELD_TYPES.has(t)),
    'a blocking type is not in MISSING_FIELD_TYPES');
yes('the blocking set is strictly smaller than the missing set',
    RE.CAM_BLOCKING_FIELD_TYPES.size < RE.MISSING_FIELD_TYPES.size,
    'the two sets are the same size — the over-blocking bug is back');

// The blocking set must match getValidTenants(), which is what actually decides
// whether a lease reaches the engine. Of the fields MISSING_FIELD_TYPES names,
// square footage is the only one that filter reads.
const validTenants = scriptCode.slice(
  scriptCode.indexOf('function getValidTenants'),
  scriptCode.indexOf('function getValidTenants') + 400);
yes('[source] getValidTenants still gates on leased_sqft',
    /Number\(t\.leased_sqft\)\s*>\s*0/.test(validTenants),
    'the engine filter changed — the blocking set must be re-derived from it');
yes('[source] getValidTenants does NOT gate on a cap or on audit rights',
    !/\bcap\b/.test(validTenants) && !/audit_rights/.test(validTenants),
    'the engine filter now reads a field the blocking set does not model');
eqj('the blocking set is exactly the fields the engine filter reads',
    [...RE.CAM_BLOCKING_FIELD_TYPES].sort(), ['missing_sqft']);

console.log('\n── A Triple Net lease with no cap reconciles ──');

const d1 = derive(reconcilable);
yes('it is reported as missing something (the review items are real)',
    d1.missing.length > 0, 'nothing flagged at all');
eqj('but nothing blocks CAM', d1.camBlocking, []);
yes('the cap and the audit-rights clause are review items',
    d1.reviewItems.some(l => /NNN Cap/i.test(l)) && d1.reviewItems.some(l => /audit rights/i.test(l)),
    JSON.stringify(d1.reviewItems));
yes('missing = camBlocking + reviewItems, with nothing lost between them',
    d1.missing.length === d1.camBlocking.length + d1.reviewItems.length,
    JSON.stringify(d1));

console.log('\n── A lease with no square footage does not ──');

const d2 = derive(noSqft);
eqj('square footage blocks CAM', d2.camBlocking, ['Sq Ft']);
yes('and the same lease still carries its review items',
    d2.reviewItems.length > 0, JSON.stringify(d2));
yes('Sq Ft is not double-counted as a review item',
    !d2.reviewItems.some(l => /Sq Ft/i.test(l)), JSON.stringify(d2.reviewItems));

console.log('\n── A fully specified lease is clean on both counts ──');

const d3 = derive(capped);
eqj('nothing blocks CAM', d3.camBlocking, []);
yes('and no NNN cap review item is raised once a cap exists',
    !d3.reviewItems.some(l => /NNN Cap/i.test(l)), JSON.stringify(d3.reviewItems));

console.log('\n── The screen and the button must agree ──');

const bulkSrc = scriptCode.slice(
  scriptCode.indexOf('const _camBlockers = (d) =>'),
  scriptCode.indexOf('const _camBlockers = (d) =>') + 3000);
yes('[source] the readiness count reads camBlocking, not missing',
    /_camBlockers\s*=\s*\(d\)\s*=>\s*\{[\s\S]{0,200}?deriveTenantReviewState\(d\)\.camBlocking/.test(bulkSrc),
    'the bulk screen is back on the whole missing[] set');
yes('[source] the button names the CAM-ready count',
    /Approve \$\{_readyCount\} ready for CAM/.test(scriptCode),
    'the approve button no longer states what it is approving');

const approveSrc = scriptCode.slice(
  scriptCode.indexOf('async function bulkApproveReady'),
  scriptCode.indexOf('async function bulkApproveReady') + 1200);
yes('[source] bulkApproveReady uses the SAME predicate as the count',
    /deriveTenantReviewState\(d\)\.camBlocking/.test(approveSrc),
    'the button can approve leases the count excluded, or the reverse');

console.log('\n── The wording must not overstate what is blocked ──');

// "cannot be reconciled" is a factual claim about the engine. It may appear only
// in the block listing camBlocking leases, never in the review-items note.
const blockedBlock = scriptCode.slice(
  scriptCode.indexOf('<div class="bulk-cam-blocked">'),
  scriptCode.indexOf('<div class="bulk-cam-blocked">') + 600);
const reviewBlock = scriptCode.slice(
  scriptCode.indexOf('<div class="bulk-cam-review">'),
  scriptCode.indexOf('<div class="bulk-cam-review">') + 600);

yes('the blocked note says the lease cannot be reconciled',
    /cannot be reconciled/.test(blockedBlock), 'the refusal no longer states its consequence');
yes('a separate note exists for leases that reconcile with open review items',
    reviewBlock.length > 100 && /will reconcile but/.test(reviewBlock),
    'reconcilable leases with review items are invisible or lumped in with blocked ones');
yes('the review note does NOT claim those leases cannot be reconciled',
    !/cannot be reconciled/.test(reviewBlock), 'the untrue claim is back');
yes('the review note says approval confirms extraction, not lease terms',
    /Approving confirms the extraction, not the lease terms/.test(reviewBlock),
    '"ready for CAM" can still be read as "verified"');
yes('the review note is driven by reviewItems, not by missing',
    /_reviewItems\(d\)/.test(scriptCode) && !/_reviewList[\s\S]{0,120}\.missing/.test(scriptCode),
    'the review note reads the wrong list');

const TOTAL_EXPECTED = 24;
yes(`suite runs all ${TOTAL_EXPECTED} checks`, pass + fail + 1 === TOTAL_EXPECTED,
    `test count changed — update TOTAL_EXPECTED deliberately (saw ${pass + fail + 1})`);

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
