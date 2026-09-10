'use strict';
/**
 * tools/cap-workflow-mutation.js — do the cap-workflow tests actually bite?
 *
 *   node tools/cap-workflow-mutation.js
 *
 * Each mutant is a single edit to a NEW predicate introduced by this slice,
 * chosen so that the mutated code is still syntactically valid and still
 * plausible — the kind of thing a later edit would really do. A mutant that
 * SURVIVES means test-cap-workflow.js would not have noticed the regression,
 * and is either a genuine gap or an equivalent mutant that must be argued for
 * explicitly rather than waved away.
 *
 * The edits are applied to a COPY in a scratch directory; the working tree is
 * never modified.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = ['lease-intelligence.js', 'script.js', 'field-provenance.js',
               'api/_mcp-capabilities.js', 'test-cap-workflow.js'];

const MUTANTS = [
  // ── capBaseIsUsable: the zero guard ──────────────────────────────────────
  { id: 'M01', file: 'lease-intelligence.js', why: 'zero becomes a usable base again (the pre-slice bug)',
    from: 'return Number.isFinite(n) && n > 0;', to: 'return Number.isFinite(n);' },
  { id: 'M02', file: 'lease-intelligence.js', why: 'negative bases accepted',
    from: 'return Number.isFinite(n) && n > 0;', to: 'return Number.isFinite(n) && n >= 0;' },

  // ── _camCeilingCents: the engine-side zero guard ─────────────────────────
  { id: 'M03', file: 'script.js', why: 'engine builds a $0 ceiling from a zero base again',
    from: '  if (!(base > 0)) return null;\n', to: '' },
  { id: 'M04', file: 'script.js', why: 'guard inverted to >= 0, letting zero through',
    from: 'if (!(base > 0)) return null;', to: 'if (!(base >= 0)) return null;' },

  // ── capUnit: the reading of the clause ───────────────────────────────────
  { id: 'M05', file: 'lease-intelligence.js', why: 'absence of a clause defaults to percent',
    from: "    if (!quotes.length) return CAP_UNIT.UNDECLARED;",
    to:   "    if (!quotes.length) return CAP_UNIT.PERCENT;" },
  { id: 'M06', file: 'lease-intelligence.js', why: 'a clause with both marks is called percent',
    from: '      if (pct && usd) return CAP_UNIT.UNDECLARED;',
    to:   '      if (pct && usd) return CAP_UNIT.PERCENT;' },
  { id: 'M07', file: 'lease-intelligence.js', why: 'disagreeing clauses resolve to percent',
    from: '    if (sawPercent && sawDollar) return CAP_UNIT.UNDECLARED;',
    to:   '    if (sawPercent && sawDollar) return CAP_UNIT.PERCENT;' },
  { id: 'M08', file: 'lease-intelligence.js', why: 'the dollar mark stops being recognised',
    from: "  const _DOLLAR_MARK  = /\\$|\\bdollars?\\b|\\bUSD\\b/i;",
    to:   "  const _DOLLAR_MARK  = /\\bUSD\\b/i;" },
  { id: 'M09', file: 'lease-intelligence.js', why: 'the word "percent" alone stops counting',
    from: "  const _PERCENT_MARK = /%|\\bper\\s?cent(?:um|age)?\\b|\\bpercent\\b/i;",
    to:   "  const _PERCENT_MARK = /%/i;" },
  { id: 'M10', file: 'lease-intelligence.js', why: 'only the extraction key is read, not the canonical one',
    from: "  const _CAP_EVIDENCE_KEYS = ['cap', 'cam_cap'];",
    to:   "  const _CAP_EVIDENCE_KEYS = ['cam_cap'];" },
  { id: 'M11', file: 'lease-intelligence.js', why: 'a whitespace-only quote counts as a clause',
    from: '        if (s && typeof s.quote === \'string\' && s.quote.trim()) out.push(s.quote);',
    to:   '        if (s && typeof s.quote === \'string\') out.push(s.quote);' },

  // ── deriveCapState: the routing ──────────────────────────────────────────
  { id: 'M12', file: 'lease-intelligence.js', why: 'a dollar cap is told to add a base',
    from: "      return { state: 'dollar_cap', unit, enforceable: false, actionable: false,",
    to:   "      return { state: 'dollar_cap', unit, enforceable: false, actionable: true," },
  { id: 'M13', file: 'lease-intelligence.js', why: 'an undeclared cap is treated as actionable',
    from: "      return { state: 'unit_unconfirmed', unit, enforceable: false, actionable: false,",
    to:   "      return { state: 'unit_unconfirmed', unit, enforceable: false, actionable: true," },
  { id: 'M14', file: 'lease-intelligence.js', why: 'missing_base stops naming the field that fixes it',
    from: "             field: 'cap_base_amount' };",
    to:   "             field: null };" },
  { id: 'M15', file: 'lease-intelligence.js', why: 'the enforced state is claimed without the engine mirror',
    from: '    const enforceable = capIsEnforceable(t);',
    to:   '    const enforceable = usable;' },
  { id: 'M16', file: 'lease-intelligence.js', why: 'a cap of 0/absent still reports no_cap incorrectly',
    from: '    if (!hasCap) {', to: '    if (false) {' },
  { id: 'M17', file: 'lease-intelligence.js', why: 'the out-of-range branch is removed',
    from: '    if (pct < 0 || pct > 100) {', to: '    if (false) {' },

  // ── capIsEnforceable: the engine mirror ──────────────────────────────────
  { id: 'M18', file: 'lease-intelligence.js', why: 'the mirror stops checking the base entirely',
    from: '    return capBaseIsUsable(t);', to: '    return true;' },

  // ── the banner and its action ────────────────────────────────────────────
  { id: 'M19', file: 'script.js', why: 'the banner shows enforced caps too',
    from: '.filter(x => !x.s.enforceable && x.s.state !== \'no_cap\')',
    to:   '.filter(x => x.s.state !== \'no_cap\')' },
  { id: 'M20', file: 'script.js', why: 'the action button is offered for every unresolved state',
    from: '        const act = (x.s.actionable && x.t.id)',
    to:   '        const act = (x.t.id)' },
  { id: 'M21', file: 'script.js', why: 'the action navigates to the wrong field',
    from: "'cap_base_amount')\">Add cap base", to: "'cap')\">Add cap base" },
  { id: 'M22', file: 'script.js', why: 'the navigation target for the base field is removed',
    from: '  cap_base_amount: /^Prior-Year CAM Base/i,', to: '' },
  { id: 'M23', file: 'script.js', why: 'the banner loses the evidence it derives the unit from',
    from: '      fieldEvidence:      t.fieldEvidence || null,', to: '' },
  { id: 'M24', file: 'script.js', why: 'the banner loses the id its action navigates by',
    from: '      id:                 t.id ?? null,', to: '' },

  // ── provenance guarantees ────────────────────────────────────────────────
  { id: 'M25', file: 'field-provenance.js', why: 'cap_base_amount leaves NEVER_EXTRACTED',
    from: '  var NEVER_EXTRACTED = { cap_base_amount: true };',
    to:   '  var NEVER_EXTRACTED = {};' },

  // ── the MCP trust gate ───────────────────────────────────────────────────
  { id: 'M26', file: 'api/_mcp-capabilities.js', why: 'a CAM row reaches a caller ungated',
    from: '  return row ? _camRow(row) : null;', to: '  return row || null;' },

  // ── the explainability wiring ────────────────────────────────────────────
  { id: 'M27', file: 'lease-intelligence.js', why: 'the note always names a missing base again',
    from: '        reviewNotes.push(_cs.actionable',
    to:   '        reviewNotes.push(true' },
  { id: 'M28', file: 'lease-intelligence.js', why: 'the summary prints % on a declared dollar cap',
    from: "    const _pctMark = _capSummaryState.unit === CAP_UNIT.DOLLAR ? '' : '%';",
    to:   "    const _pctMark = '%';" },
  { id: 'M29', file: 'lease-intelligence.js', why: 'engineWillCap ignores the base, over-claiming enforcement',
    from: '    const engineWillCap = Number.isFinite(pct) && usable;',
    to:   '    const engineWillCap = Number.isFinite(pct);' },
  { id: 'M30', file: 'script.js', why: 'the headline claims no-limit for every listed tenant again',
    from: '    const _noLimit = _capStates.filter(x => !x.s.engineWillCap).length;',
    to:   '    const _noLimit = _capStates.length;' },
  { id: 'M31', file: 'script.js', why: 'out-of-range caps are dropped from the banner entirely',
    from: "    const _order = ['missing_base', 'unit_unconfirmed', 'dollar_cap', 'cap_out_of_range'];",
    to:   "    const _order = ['missing_base', 'unit_unconfirmed', 'dollar_cap'];" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capmut-'));
fs.mkdirSync(path.join(tmp, 'api'), { recursive: true });
const ORIGINAL = {};
for (const f of FILES) {
  ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  fs.writeFileSync(path.join(tmp, f), ORIGINAL[f]);
}

function runSuite() {
  try {
    execFileSync(process.execPath, ['test-cap-workflow.js'],
                 { cwd: tmp, stdio: 'pipe', timeout: 120000 });
    return true;   // suite passed
  } catch (_) {
    return false;  // suite failed → mutant killed
  }
}

console.log('Baseline (unmutated copy): ' + (runSuite() ? 'PASS' : 'FAIL — fix before mutating'));

let killed = 0, survived = [];
for (const m of MUTANTS) {
  const target = path.join(tmp, m.file);
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — mutant is malformed`);
    survived.push(m.id + ' (malformed)');
    continue;
  }
  // Replace the FIRST occurrence only, so a mutant stays a single edit.
  const i = src.indexOf(m.from);
  fs.writeFileSync(target, src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuite();
  fs.writeFileSync(target, src);          // restore before the next mutant
  if (passed) { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else        { killed++;                                     console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
