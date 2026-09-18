'use strict';
/**
 * tools/lifecycle-stage-mutation.js — do the P0.2 lifecycle suites bite?
 *
 *   node tools/lifecycle-stage-mutation.js
 *
 * The invariant is "a prospect never enters the portfolio, and joins it only by
 * a stage transition". Each mutant below is a one-token edit that would let a
 * prospect leak into an aggregate, let a transition copy or skip, or make a
 * server capability describe a deal as a managed property. The suites must
 * object to every one. Negative controls close the portfolio on the people it
 * must admit.
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
const HYD = 'api/_property-record-hydrator.js';
const MCP = 'api/_mcp-capabilities.js';

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

  // ── the server ────────────────────────────────────────────────────────────
  { id: 'H01', file: HYD, why: 'the hydrator assembles a record for a prospect',
    from: "  if (allowed.indexOf(stage) === -1) {\n    return { ok: false, reason: REFUSAL.NOT_MANAGED, lifecycleStage: stage, reads, degraded };\n  }",
    to:   "  if (false) {\n    return { ok: false, reason: REFUSAL.NOT_MANAGED, lifecycleStage: stage, reads, degraded };\n  }" },
  { id: 'H02', file: HYD, why: 'the hydrator widens the default to every stage',
    from: "  const allowed = Array.isArray(o.stages) && o.stages.length ? o.stages : PL.MANAGED;",
    to:   "  const allowed = Array.isArray(o.stages) && o.stages.length ? o.stages : PL.STAGES;" },
  { id: 'H03', file: HYD, why: 'the hydrator does not select the stage, so it cannot refuse',
    from: "  let propRes = await sb(`${propPath}&select=id,name,sqft,data,lifecycle_stage`, { method: 'GET' });",
    to:   "  let propRes = await sb(`${propPath}&select=id,name,sqft,data`, { method: 'GET' });" },
  { id: 'C01', file: MCP, why: 'list_properties lists prospects as properties',
    from: "  const rows      = allRows.filter(PL.isManaged);",
    to:   "  const rows      = allRows;" },
  { id: 'C02', file: MCP, why: 'list_properties leaves prospects out silently',
    from: "  if (leftOut > 0) {",
    to:   "  if (false) {" },
  { id: 'C03', file: MCP, why: 'get_property maps a prospect refusal to a generic read failure',
    from: "    [HYD.REFUSAL.NOT_MANAGED]: [REFUSAL.NOT_MANAGED,",
    to:   "    [HYD.REFUSAL.NOT_MANAGED]: [REFUSAL.READ_FAILED," },
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
for (const f of [PL, APP, HYD, MCP]) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-lifecycle-stage.js', 'test-property-lifecycle.js', 'test-property-record-hydrator.js', 'test-m4-mcp-capabilities.js'];
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
