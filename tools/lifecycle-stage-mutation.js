'use strict';
/**
 * tools/lifecycle-stage-mutation.js — do the P0.2 lifecycle suites bite?
 *
 *   node tools/lifecycle-stage-mutation.js
 *
 * The invariant is "a prospect never enters the portfolio, and joins it only by
 * a stage transition". Each mutant below is a one-token edit that would let a
 * prospect leak into an aggregate, or let a transition copy or skip. The suites
 * must object to every one. P3 added the server side (the hydrator refuses a
 * prospect; list_properties lists managed rows only) and the client's one way
 * to start a deal (begin_acquisition). Negative controls close the portfolio
 * on the people it must admit.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PL  = 'property-lifecycle.js';
const APP = 'script.js';
// P3 — the server learned the stage: the hydrator refuses a prospect, and
// list_properties lists managed rows only. Both are mutated here too.
const HYD = 'api/_property-record-hydrator.js';
const CAP = 'api/_mcp-capabilities.js';

const MUTANTS = [
  // ── the module ────────────────────────────────────────────────────────────
  { id: 'L01', file: PL, why: 'an unrecognised stage counts as managed',
    from: "  function isManaged(row)        { return MANAGED.indexOf(stageOf(row)) !== -1; }",
    to:   "  function isManaged(row)        { return !isPreAcquisition(row) && !isPassed(row); }" },
  { id: 'L02', file: PL, why: 'a passed deal counts as managed',
    from: "  var MANAGED         = Object.freeze(['acquired']);",
    to:   "  var MANAGED         = Object.freeze(['acquired', 'passed']);" },
  { id: 'L03', file: PL, why: 'classify() files prospects under active',
    from: "      out.prospects.push(row);\n      if (!isKnownStage(row.lifecycleStage)) out.unrecognised.push(row);",
    to:   "      out.active.push(row);\n      if (!isKnownStage(row.lifecycleStage)) out.unrecognised.push(row);" },
  { id: 'L04', file: PL, why: 'classify() files an archived prospect under archived (archive promotes)',
    from: "      if (isManaged(row)) {\n        (row.archivedAt ? out.archived : out.active).push(row);\n        return;\n      }",
    to:   "      if (isManaged(row) || row.archivedAt) {\n        (row.archivedAt ? out.archived : out.active).push(row);\n        return;\n      }" },
  { id: 'L05', file: PL, why: 'NEGATIVE CONTROL — a row with no stage is a prospect, so every pre-023 property vanishes',
    from: "  var DEFAULT_STAGE   = 'acquired';",
    to:   "  var DEFAULT_STAGE   = 'prospect';" },
  { id: 'L06', file: PL, why: 'stageOf reads only the app-side field, so the database column is ignored',
    from: "    var s = row.lifecycle_stage != null ? row.lifecycle_stage : row.lifecycleStage;",
    to:   "    var s = row.lifecycleStage;" },
  { id: 'L07', file: PL, why: 'acquired is no longer terminal — a managed property can be sent back to a deal stage',
    from: "    acquired:      Object.freeze([]),",
    to:   "    acquired:      Object.freeze(['prospect', 'passed']),", },
  { id: 'L08', file: PL, why: 'passed → acquired without reopening',
    from: "    passed:        Object.freeze(['prospect']),",
    to:   "    passed:        Object.freeze(['prospect', 'acquired'])," },
  { id: 'L16', file: PL, why: 'LOCKED LIFECYCLE: a property may be sent to under_review (episode progress leaking back onto the property)',
    from: "    prospect:      Object.freeze(['acquired', 'passed']),",
    to:   "    prospect:      Object.freeze(['under_review', 'acquired', 'passed'])," },
  { id: 'L17', file: PL, why: 'LOCKED LIFECYCLE: a legacy under_review row may be acquired without first becoming a prospect',
    from: "    under_review:  Object.freeze(['prospect']),",
    to:   "    under_review:  Object.freeze(['prospect', 'acquired'])," },
  { id: 'L09', file: PL, why: 'THE INVARIANT: the transition patch carries the row\'s data (a copy)',
    from: "    if (to === 'acquired') patch.acquired_at = now;",
    to:   "    if (to === 'acquired') { patch.acquired_at = now; patch.data = row.data; patch.name = row.name; }" },
  { id: 'L10', file: PL, why: 'a transition to the same stage is accepted',
    from: "    if (from === to) return { ok: false, from: from, to: to, error: 'already_in_stage' };",
    to:   "" },
  { id: 'L11', file: PL, why: 'an unrecognised current stage is treated as prospect',
    from: "    if (!isKnownStage(from)) return { ok: false, from: from, to: to, error: 'unrecognised_current_stage' };",
    to:   "    if (!isKnownStage(from)) from = 'prospect';" },
  { id: 'L12', file: PL, why: 'passed_at is not stamped',
    from: "    if (to === 'passed')   patch.passed_at   = now;",
    to:   "" },
  { id: 'L13', file: PL, why: 'managedOnly() ignores archive',
    from: "      return r && typeof r === 'object' && isManaged(r) && !_archivedAt(r);",
    to:   "      return r && typeof r === 'object' && isManaged(r);" },
  { id: 'L14', file: PL, why: 'visibility() shows a passed deal among acquisitions',
    from: "      acquisitions: isPreAcquisition(row),",
    to:   "      acquisitions: isPreAcquisition(row) || isPassed(row)," },
  { id: 'L15', file: PL, why: 'the column-missing detector never fires, so a pre-023 project gets an empty portfolio',
    from: "    return /lifecycle_stage/.test(msg) && (/does not exist|42703|column/i.test(msg) || err.code === '42703');",
    to:   "    return false;" },

  // ── the monolith's one touch-point ────────────────────────────────────────
  { id: 'S01', file: APP, why: 'loadProperties returns every row it read — prospects enter _props',
    from: "  const properties = archived ? split.archived : split.active;",
    to:   "  const properties = archived ? split.archived : split.active.concat(split.prospects);" },
  { id: 'S02', file: APP, why: 'the archived read overwrites the deal list',
    from: "  _prospectProps = archived ? _prospectProps : split.prospects;",
    to:   "  _prospectProps = split.prospects;" },
  { id: 'S03', file: APP, why: 'the pre-023 fallback is dropped — the portfolio empties on that project',
    from: "  if (PropertyLifecycle.isStageColumnMissing(error)) {",
    to:   "  if (false) {" },
  { id: 'S04', file: APP, why: 'the stage column is never selected, so every row reads as acquired',
    from: "  let { data, error } = await _q(PropertyLifecycle.SELECT_COLUMNS);",
    to:   "  let { data, error } = await _q(PropertyLifecycle.SELECT_COLUMNS_PRE_023);" },

  // ── P3: the server learns the stage ───────────────────────────────────────
  { id: 'H01', file: HYD, why: 'the hydrator hydrates a prospect as if it were a managed property',
    from: "  if (!PropertyLifecycle.isManaged(row)) {\n    return { ok: false, reason: REFUSAL.NOT_MANAGED, reads, degraded: [] };\n  }",
    to:   "" },
  { id: 'H02', file: HYD, why: 'the hydrator stops selecting the stage, so every row reads as acquired and the refusal never fires',
    from: "&select=id,name,sqft,data,lifecycle_stage`,",
    to:   "&select=id,name,sqft,data`," },
  { id: 'H03', file: HYD, why: 'a prospect is refused as NOT FOUND — the caller is told a building it is evaluating does not exist',
    from: "    return { ok: false, reason: REFUSAL.NOT_MANAGED, reads, degraded: [] };",
    to:   "    return { ok: false, reason: REFUSAL.NOT_FOUND, reads, degraded: [] };" },
  { id: 'C01', file: CAP, why: 'list_properties lists every row — prospects and passed deals enter the portfolio listing',
    from: "  const rows      = allRows.filter(row => PropertyLifecycle.isManaged(row));",
    to:   "  const rows      = allRows;" },
  { id: 'C02', file: CAP, why: 'the rows left out are dropped silently — no prospects_not_listed caveat',
    from: "  if (leftOut > 0) {",
    to:   "  if (false) {" },
  { id: 'C03', file: CAP, why: 'the list read stops selecting the stage, so every row reads as acquired',
    from: "&select=id,name,sqft,created_at,updated_at,archived_at,lifecycle_stage&order=name.asc`,",
    to:   "&select=id,name,sqft,created_at,updated_at,archived_at&order=name.asc`," },

  // ── P3: the client starts a deal only through begin_acquisition ───────────
  { id: 'S05', file: APP, why: 'deleting a deal on a prospect property bypasses delete_prospect_acquisition (the prospect property is left behind)',
    from: "    if (onProspect) {\n      ({ error } = await db.rpc('delete_prospect_acquisition', { p_review_id: id }));",
    to:   "    if (false) {\n      ({ error } = await db.rpc('delete_prospect_acquisition', { p_review_id: id }));" },
  { id: 'S06', file: APP, why: 'a begin_acquisition call that returns no record still puts a card on screen — a review that can never save',
    from: "    if (!created || !created.review_id || !created.property_id) {",
    to:   "    if (false) {" },
  { id: 'S07', file: APP, why: 'the conversion state ignores the row\'s own property_id and reads only the legacy record',
    from: "  const pid = review?.property_id || review?.data?.conversionRecord?.propertyId;",
    to:   "  const pid = review?.data?.conversionRecord?.propertyId;" },
  // ── the temporary P3 → P4 safety guard ────────────────────────────────────
  { id: 'G01', file: APP, why: 'the guard never fires — the legacy Acquire would insert a second property beside the prospect',
    from: "  if (!review || !review.property_id || review.status === 'converted') return '';\n  return _ACQ_LEGACY_ACQUIRE_UNAVAILABLE;",
    to:   "  return '';" },
  { id: 'G02', file: APP, why: 'P4: a review that has its property falls through to the LEGACY copy-based path instead of acquire_property',
    from: "  if (review.property_id && review.status !== 'converted') {\n    return _acqAcquireInPlace(review);\n  }",
    to:   "  if (false) {\n    return _acqAcquireInPlace(review);\n  }" },
  { id: 'G03', file: APP, why: 'the guard ignores property_id and blocks every open review, including the legacy one whose path is unchanged',
    from: "  if (!review || !review.property_id || review.status === 'converted') return '';",
    to:   "  if (!review || review.status === 'converted') return '';" },
  { id: 'G04', file: APP, why: 'P4: the roster rows stop naming their property, so the server cannot check them against the arguments',
    from: "    o.property_id = review.property_id;\n    o.review_id   = review.id;",
    to:   "    o.property_id = null;\n    o.review_id   = review.id;" },
  { id: 'G05', file: APP, why: 'P4: the client performs a second conversion write after the RPC (the review save that could contradict the server)',
    from: "    if (srv.updated_at) { review.updated_at = srv.updated_at; _acqRevs.set(review.id, String(srv.updated_at)); }",
    to:   "    if (srv.updated_at) { review.updated_at = srv.updated_at; _acqRevs.set(review.id, String(srv.updated_at)); }\n    await _saveAcqReview(review);" },
  { id: 'G06', file: APP, why: 'P4: the client trusts any result — a response that does not name the acquired property is adopted',
    from: "    if (!result || result.ok !== true || result.property_id !== review.property_id) {",
    to:   "    if (false) {" },
  { id: 'G07', file: APP, why: 'P4: the portfolio is not reloaded from the database after the acquisition (the same property never appears)',
    from: "    await _reloadPortfolioAfterLifecycleChange();\n    _hideAcqConvertModal();",
    to:   "    _hideAcqConvertModal();" },
  { id: 'G08', file: APP, why: 'P4: the client gate is skipped in front of the RPC (a half-loaded record is sent to the server)',
    from: "  await _acqEnsureRecord(review.id);\n  const _blocked = _acqConversionBlock(review);\n  if (_blocked) {\n    _hideAcqConvertModal();\n    alert(_blocked);\n    return;\n  }\n  const confirmBtn = document.getElementById('acqConvertConfirmBtn');\n  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Acquiring…'; }",
    to:   "  await _acqEnsureRecord(review.id);\n  const confirmBtn = document.getElementById('acqConvertConfirmBtn');\n  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Acquiring…'; }" },
  { id: 'S08', file: APP, why: 'a save that finds no stored row re-creates it from the browser (the pre-034 upsert), bypassing begin_acquisition',
    from: "      showToast('⚠️ Review save failed — this review has no stored record. Reload to see the saved reviews.',\n        { color: '#92400e', textColor: '#fef3c7', duration: 7000 });\n      return false;",
    to:   "      const { error: upErr } = await db.from('acquisition_reviews').upsert({ id: review.id, user_id: user.id, ...payload }, { onConflict: 'id' });\n      return !upErr;" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const f of [PL, APP, HYD, CAP]) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-lifecycle-stage.js', 'test-property-lifecycle.js'];
function runSuites() {
  const failed = [];
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 });
    } catch (_) { failed.push(suite); }
  }
  return failed;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline.length ? 'FAIL ' + baseline.join(', ') : 'PASS'));
if (baseline.length) {
  console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0, survived = 0;
const survivors = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) {
    console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`);
    survived++; survivors.push(m.id + ' (anchor missing)');
    continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (failed.length) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed by ${failed.join(', ')} — ${m.why}`); }
  else { survived++; survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survived} survived of ${MUTANTS.length}`);
if (survived) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
