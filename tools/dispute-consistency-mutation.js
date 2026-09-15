'use strict';
/**
 * tools/dispute-consistency-mutation.js — does the consistency suite bite?
 *
 *   node tools/dispute-consistency-mutation.js
 *
 * Four kinds of mutant:
 *
 *   REVERT     a surface goes back to `status === 'open'` — the original defect,
 *              one module at a time.
 *   FOLD       an unknown status is quietly swept into open or closed, which is
 *              the reclassification dispute-status.js exists to refuse.
 *   AUTHORITY  the shared rule is broken at its source, or a helper stops
 *              delegating and restates the rule instead.
 *   GUARD      the deliberately-unchanged lifecycle guards are widened or
 *              narrowed — including re-creating the dead Accept click.
 *
 * A FAILING BASELINE IS NOT A PASS. The baseline is asserted before any mutant
 * runs and the harness exits non-zero if it fails, because a copy that cannot
 * run kills every mutant trivially and reports a perfect score. That happened
 * on the previous slice's first run.
 *
 * Applied to a COPY in a scratch directory; the working tree is never touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// The whole working tree is copied, not a hand-listed subset.
//
// The first draft listed the files the mutants touch. test-m7-semantic-coherence
// pulls in api/_mcp-capabilities, api/_server-deps and
// tools/global-dependency-inventory, so the copy could not run it and the
// BASELINE FAILED — which the guard below caught before it could report a
// perfect score against a broken copy. Copying everything (minus .git and
// node_modules, neither of which any suite reads) removes the whole class of
// "the harness was wrong, not the code".
const MUTATED_FILES = ['dispute-status.js', 'script.js', 'selectors.js', 'command-center.js',
               'lease-review-packets.js', 'acquisition-engine.js', 'ai-workspace.js',
               'tenant-space.js', 'index.html'];

const MUTANTS = [
  // ── AUTHORITY: break the rule at its source ─────────────────────────────
  { id: 'D01', file: 'dispute-status.js', why: 'docs_requested becomes terminal, so it reads closed',
    from: "    docs_requested: ['accepted', 'rejected'],", to: '    docs_requested: [],' },
  { id: 'D02', file: 'dispute-status.js', why: 'classify restates a list instead of reading the table',
    from: '      return TRANSITIONS[status].length ? OPEN : CLOSED;',
    to:   "      return status === 'open' ? OPEN : CLOSED;" },
  { id: 'D03', file: 'dispute-status.js', why: 'an unknown status is folded into closed',
    from: '    return UNKNOWN;\n  }', to: '    return CLOSED;\n  }' },
  { id: 'D04', file: 'dispute-status.js', why: 'an unknown status is folded into open',
    from: "    if (typeof status !== 'string' || status === '') return UNKNOWN;",
    to:   "    if (typeof status !== 'string' || status === '') return OPEN;" },
  { id: 'D05', file: 'dispute-status.js', why: 'the legacy resolved status stops being closed',
    from: "  var LEGACY_CLOSED = ['resolved'];", to: '  var LEGACY_CLOSED = [];' },
  { id: 'D06', file: 'dispute-status.js', why: 'tally drops the unknown bucket it promises',
    from: "        var s = (typeof d.status === 'string' && d.status) ? d.status : '(absent)';\n        if (out.unknownStatuses.indexOf(s) === -1) out.unknownStatuses.push(s);",
    to:   '        ;' },

  // ── REVERT: one surface at a time ───────────────────────────────────────
  { id: 'D07', file: 'script.js', why: 'the CAM open group narrows again',
    from: "  const openList     = disputes.filter(d => _disputeClass(d) === 'open');",
    to:   "  const openList     = disputes.filter(d => d.status === 'open');" },
  { id: 'D08', file: 'script.js', why: 'the CAM resolved group sweeps up everything again',
    from: "  const resolvedList = disputes.filter(d => _disputeClass(d) === 'closed');",
    to:   "  const resolvedList = disputes.filter(d => d.status !== 'open');" },
  { id: 'D09', file: 'script.js', why: 'the unknown group disappears from the CAM list',
    from: "  const unknownList  = disputes.filter(d => _disputeClass(d) === 'unknown');",
    to:   '  const unknownList  = [];' },
  { id: 'D10', file: 'script.js', why: 'the unknown group is rendered but never headed',
    from: "    html += `<div class=\"disputes-heading disputes-unknown-head\">&#x2753; Unrecognised status &mdash; not counted as open or resolved</div>`;",
    to:   '    ;' },
  { id: 'D11', file: 'script.js', why: 'the shared helper stops delegating and restates the rule',
    from: "  const DS = window.DisputeStatus;\n  if (DS && typeof DS.isOpen === 'function') return DS.isOpen(d);\n  return !!d && (d.status === 'open' || d.status === 'docs_requested');",
    to:   "  return !!d && d.status === 'open';" },
  { id: 'D12', file: 'script.js', why: 'the tenant-scoped helper stops applying the open rule',
    from: '  return arr.filter(d => d && _disputeIsOpen(d) &&',
    to:   '  return arr.filter(d => d &&' },
  { id: 'D13', file: 'script.js', why: 'the tenant-scoped helper stops scoping to the tenant',
    from: '    (tenantName == null || d.tenantName === tenantName));',
    to:   '    true);' },
  { id: 'D14', file: 'script.js', why: 'the statement pill colours docs_requested as closed again',
    from: "        const pill = `<span class=\"rpt-pill ${_disputeIsOpen(d) ? 'open' : 'closed'}\">${statusLabel}</span>`;",
    to:   "        const pill = `<span class=\"rpt-pill ${d.status === 'open' ? 'open' : 'closed'}\">${statusLabel}</span>`;" },
  { id: 'D15', file: 'script.js', why: 'an unknown status is printed as "Docs Requested" again',
    from: "          : `Unrecognised (${esc(String(d.status || 'none'))})`;",
    to:   "          : 'Docs Requested';" },
  { id: 'D16', file: 'selectors.js', why: 'buildPropMeta narrows again — the card KPI disagrees',
    from: '    const openDisputes = (prop.disputes || []).filter(_isOpenDispute).length;',
    to:   "    const openDisputes = (prop.disputes || []).filter(d => d.status === 'open').length;" },
  { id: 'D17', file: 'selectors.js', why: 'the selectors helper stops delegating',
    from: "    if (DS && typeof DS.isOpen === 'function') return DS.isOpen(d);\n    return !!d && (d.status === 'open' || d.status === 'docs_requested');\n  };",
    to:   "    return !!d && d.status === 'open';\n  };" },
  { id: 'D18', file: 'command-center.js', why: 'the briefing exposure narrows again',
    from: "    if (DS && typeof DS.isOpen === 'function') return DS.isOpen(d);\n    return !!d && (d.status === 'open' || d.status === 'docs_requested');",
    to:   "    return !!d && d.status === 'open';" },
  { id: 'D19', file: 'lease-review-packets.js', why: 'the packets narrow again',
    from: "    if (DS && typeof DS.isOpen === 'function') return DS.isOpen(d);\n    return !!d && (d.status === 'open' || d.status === 'docs_requested');",
    to:   "    return !!d && d.status === 'open';" },
  { id: 'D20', file: 'lease-review-packets.js', why: 'the packet resolved list sweeps up open disputes',
    from: '    const resolved    = allDisputes.filter(d => !_isOpenDispute(d));',
    to:   "    const resolved    = allDisputes.filter(d => d.status !== 'open');" },
  { id: 'D21', file: 'acquisition-engine.js', why: 'the briefing count narrows again',
    from: "    if (DS && typeof DS.isOpen === 'function') return DS.isOpen(d);\n    return !!d && (d.status === 'open' || d.status === 'docs_requested');",
    to:   "    return !!d && d.status === 'open';" },

  // ── the AI ──────────────────────────────────────────────────────────────
  { id: 'D22', file: 'ai-workspace.js', why: 'the AI classifies inline again instead of asking',
    from: "        if (DS && typeof DS.classify === 'function') return DS.classify(d && d.status);\n        return _isOpenDispute(d, deps) ? 'open' : 'closed';",
    to:   "        return (d && d.status === 'open') ? 'open' : 'closed';" },
  { id: 'D23', file: 'ai-workspace.js', why: 'an unknown status falls into resolved history',
    from: "          (_k === 'open' ? open : _k === 'closed' ? resolved : unrecognised).push(line);",
    to:   "          (_k === 'open' ? open : resolved).push(line);" },
  { id: 'D24', file: 'ai-workspace.js', why: 'the unrecognised disputes are never mentioned',
    from: '      if (unrecognised.length) paragraphs.push(',
    to:   '      if (false) paragraphs.push(' },
  { id: 'D25', file: 'ai-workspace.js', why: 'the authority stops being injectable, so headless differs from the browser',
    from: '      DisputeStatus:     window.DisputeStatus || null,', to: '' },

  // ── GUARD: the deliberate exceptions ────────────────────────────────────
  { id: 'D26', file: 'script.js', why: 'THE DEAD CLICK RETURNS — Accept on a docs_requested dispute is dropped',
    from: '  const _allowed = DISPUTE_TRANSITIONS[d.status] || [];\n  if (!_allowed.includes(resolution)) return;',
    to:   "  if (d.status !== 'open') return;" },
  { id: 'D27', file: 'script.js', why: 'the resolve guard accepts a transition the table forbids',
    from: '  if (!_allowed.includes(resolution)) return;', to: '  ;' },
  { id: 'D28', file: 'script.js', why: 'the card offers decisions the table forbids',
    from: "          ${nextStates.includes('docs_requested') ? `<button class=\"d-res-btn docs\"",
    to:   "          ${true ? `<button class=\"d-res-btn docs\"" },
  { id: 'D29', file: 'script.js', why: 'the editability gate is widened, changing a product rule',
    from: "  const isOpen   = d.status === 'open';\n",
    to:   '  const isOpen   = _disputeIsOpen(d);\n' },
  { id: 'D30', file: 'script.js', why: 'the panel stops reading the lifecycle table for its decisions',
    from: '  const nextStates = DISPUTE_TRANSITIONS[d.status] || [];\n  const canDecide  = nextStates.length > 0;',
    to:   '  const nextStates = [];\n  const canDecide  = nextStates.length > 0;' },
  { id: 'D31', file: 'script.js', why: 'script.js grows a second lifecycle table',
    from: 'const DISPUTE_TRANSITIONS = (window.DisputeStatus && window.DisputeStatus.TRANSITIONS) ||',
    to:   'const DISPUTE_TRANSITIONS = (false) ||' },
  { id: 'D32', file: 'script.js', why: 'the engine stops enforcing the transition table',
    from: '  if (!allowed || !allowed.includes(resolution)) return;', to: '  ;' },

  // ── the identity guard this slice must not disturb ──────────────────────
  { id: 'D33', file: 'tenant-space.js', why: 'an id-less space claims disputes again',
    from: '    var disputes = noIdentity ? [] : (property.disputes || []).filter',
    to:   '    var disputes = (property.disputes || []).filter' },
  { id: 'D34', file: 'index.html', why: 'the unknown heading loses its styling',
    from: '    .disputes-unknown-head  {', to: '    .disputes-unknown-head-X {' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dispmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const f of MUTATED_FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-dispute-consistency.js', 'test-m7-semantic-coherence.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 120000 });
    } catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  // Every mutant would "die" against a broken copy and the run would report a
  // perfect score it has not earned.
  console.error('\nThe unmutated copy does not pass. Every result below would be\n' +
                'meaningless, so nothing is mutated. Fix the copy set or the suites first.');
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 120000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-2500)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`);
    survived.push(m.id + ' (malformed)');
    continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passed) {
    if (m.equivalent) { console.log(`  EQUIV ${m.id}  ${m.why}`); }
    else { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  } else {
    killed++;
    if (m.equivalent) {
      survived.push(`${m.id} was declared EQUIVALENT but was killed — re-read the note above it`);
      console.log(`  ??!  ${m.id}  declared equivalent, but the suites caught it`);
    } else {
      console.log(`  kill ${m.id}  ${m.why}`);
    }
  }
}

const equivalents = MUTANTS.filter(m => m.equivalent).length;
console.log(`\n${killed}/${MUTANTS.length - equivalents} killed` +
            (equivalents ? ` (${equivalents} declared equivalent, argued in place)` : ''));
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
