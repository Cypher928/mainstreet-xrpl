'use strict';
/**
 * tools/spaces-vocabulary-mutation.js — does the Spaces vocabulary suite bite?
 *
 *   node tools/spaces-vocabulary-mutation.js
 *
 * Five kinds of mutant:
 *
 *   COLLAPSE    the block folds over work — a lease needing review, an
 *               unreadable review state, an unknown status, or no tenants at
 *               all. This is the failure the whole slice is about: a collapsed
 *               card that hides the job is worse than an expanded one showing
 *               none.
 *   HONESTY     readiness that could not be determined gets reported as
 *               readiness — needsAttention 0 instead of null, or a bar that
 *               says "all reviewed" when nothing was read.
 *   REACH       a collapsed card stops being a navigation target, so "Review
 *               leases" lands past it and the manager hunts for a control that
 *               is right there, hidden.
 *   FOCUS       the block collapses out from under someone typing in it. This
 *               is the mobile Total Sqft bug, in a new place.
 *   VOCABULARY  the two-inventory reading comes back — "Extracted Tenants", the
 *               orphan ordinal, or a heading that says nothing about the Spaces
 *               the block feeds.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails: a copy that cannot
 * run kills every mutant trivially and reports a fake perfect score. That has
 * happened twice in this series.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['property-os.js', 'script.js', 'index.html', 'property-workspace.js'];

const MUTANTS = [
  // ── COLLAPSE: the block folds over work ─────────────────────────────────
  { id: 'V01', file: 'property-os.js', why: 'a lease needing review counts as ready',
    from: "var LEASE_BLOCK_READY_STATES = ['verified', 'manually_verified'];",
    to:   "var LEASE_BLOCK_READY_STATES = ['verified', 'manually_verified', 'needs_review'];" },
  { id: 'V02', file: 'property-os.js', why: 'an incomplete lease counts as ready',
    from: "var LEASE_BLOCK_READY_STATES = ['verified', 'manually_verified'];",
    to:   "var LEASE_BLOCK_READY_STATES = ['verified', 'manually_verified', 'incomplete'];" },
  { id: 'V03', file: 'property-os.js', why: 'a manually verified lease is no longer ready — the block never closes',
    from: "var LEASE_BLOCK_READY_STATES = ['verified', 'manually_verified'];",
    to:   "var LEASE_BLOCK_READY_STATES = ['verified'];" },
  { id: 'V04', file: 'property-os.js', why: 'the ready allowlist becomes a blocklist — the sense inverts',
    from: '      if (LEASE_BLOCK_READY_STATES.indexOf(s) === -1) needing++;',
    to:   '      if (LEASE_BLOCK_READY_STATES.indexOf(s) !== -1) needing++;' },
  { id: 'V05', file: 'property-os.js', why: 'an UNRECOGNISED status is treated as ready (blocklist, not allowlist)',
    from: '      if (LEASE_BLOCK_READY_STATES.indexOf(s) === -1) needing++;',
    to:   "      if (s === 'incomplete' || s === 'needs_review') needing++;" },
  { id: 'V06', file: 'property-os.js', why: 'one outstanding lease is not enough to keep it open',
    from: '    return needing > 0', to: '    return needing > 1' },
  { id: 'V07', file: 'property-os.js', why: 'a property with NO leases collapses the upload block',
    from: "      return { collapsed: false, reason: 'no_tenants', needsAttention: 0, total: 0 };",
    to:   "      return { collapsed: true, reason: 'no_tenants', needsAttention: 0, total: 0 };" },
  { id: 'V08', file: 'property-os.js', why: 'a review state that throws is treated as ready',
    from: "      try { s = stateOf(list[i]); } catch (_e) { s = null; }",
    to:   "      try { s = stateOf(list[i]); } catch (_e) { s = 'verified'; }" },
  { id: 'V09', file: 'property-os.js', why: 'holes in the tenants array are counted as leases',
    from: '    var list = Array.isArray(tenants) ? tenants.filter(Boolean) : [];',
    to:   '    var list = Array.isArray(tenants) ? tenants : [];' },
  { id: 'V10', file: 'property-os.js', why: 'the renderer stops asking and always collapses',
    from: '    if (!st.collapsed) { toggleLeaseBlock(true); return; }',
    to:   '    if (false) { toggleLeaseBlock(true); return; }' },
  { id: 'V11', file: 'property-os.js', why: 'the renderer never collapses — the summary bar is decoration',
    from: '    toggleLeaseBlock(false);\n  }', to: '    toggleLeaseBlock(true);\n  }' },

  // ── HONESTY: unknown readiness reported as readiness ────────────────────
  { id: 'V12', file: 'property-os.js', why: 'no review engine reports zero needing attention instead of unknown',
    from: "      return { collapsed: false, reason: 'review_state_unavailable',\n               needsAttention: null, total: list.length };",
    to:   "      return { collapsed: false, reason: 'review_state_unavailable',\n               needsAttention: 0, total: list.length };" },
  { id: 'V13', file: 'property-os.js', why: 'no review engine collapses the block',
    from: "      return { collapsed: false, reason: 'review_state_unavailable',\n               needsAttention: null, total: list.length };",
    to:   "      return { collapsed: true, reason: 'review_state_unavailable',\n               needsAttention: null, total: list.length };" },
  { id: 'V14', file: 'property-os.js', why: 'a non-function reviewStateOf is called anyway',
    from: "    var stateOf = typeof o.reviewStateOf === 'function' ? o.reviewStateOf : null;",
    to:   '    var stateOf = o.reviewStateOf || null;' },
  { id: 'V15', file: 'property-os.js', why: 'the bar says "all reviewed" when readiness could not be read',
    from: "    if (s.needsAttention == null) return leases + ' on file · review status unavailable';",
    to:   '    if (false) return leases;' },
  { id: 'V16', file: 'property-os.js', why: 'the bar reports the total, not the number needing a look',
    from: "      return s.needsAttention + ' of ' + leases +",
    to:   "      return s.total + ' of ' + leases +" },
  { id: 'V17', file: 'property-os.js', why: 'the verb stops agreeing with the count',
    from: "        (s.needsAttention === 1 ? ' still needs' : ' still need') + ' a look';",
    to:   "        ' still need' + ' a look';" },
  { id: 'V18', file: 'property-os.js', why: 'an empty property claims leases are on file',
    from: "    if (!s.total) return 'No leases uploaded yet';",
    to:   "    if (false) return 'No leases uploaded yet';" },

  // ── REACH: a collapsed card stops being a navigation target ─────────────
  { id: 'V19', file: 'property-os.js', why: 'revealForAnchor reports what it would have opened but opens nothing',
    from: '      try { _COLLAPSIBLE[id](); opened.push(id); } catch (_e) {}',
    to:   '      try { opened.push(id); } catch (_e) {}' },
  { id: 'V20', file: 'property-os.js', why: 'the lease block is no longer declared collapsible, so nothing reveals it',
    from: '  var _COLLAPSIBLE = { cardLeases: function () { toggleLeaseBlock(true); },',
    to:   '  var _COLLAPSIBLE = { cardLeasesX: function () { toggleLeaseBlock(true); },' },
  { id: 'V21', file: 'property-os.js', why: 'reveal opens only cards that are already open',
    from: "      if (!el || el.style.display !== 'none') continue;",
    to:   "      if (!el || el.style.display === 'none') continue;" },
  { id: 'V22', file: 'property-os.js', why: 'reveal opens any anchor it is handed, collapsible or not',
    from: '      if (!_COLLAPSIBLE[id]) continue;', to: '      if (!_COLLAPSIBLE[id]) { opened.push(id); continue; }' },
  { id: 'V23', file: 'property-os.js', why: 'the comma-separated anchor form is not understood',
    from: "    var ids = typeof anchors === 'string' ? anchors.split(',')\n            : (Array.isArray(anchors) ? anchors : []);",
    to:   '    var ids = Array.isArray(anchors) ? anchors : [];' },
  { id: 'V24', file: 'script.js', why: 'the KPI navigator stops revealing, and silently lands on the fallback anchor',
    from: "    try { if (window.PropertyOS && window.PropertyOS.revealForAnchor) window.PropertyOS.revealForAnchor(ids); } catch (_) {}",
    to:   '    /* no reveal */' },
  { id: 'V25', file: 'property-workspace.js', why: 'the attention list stops revealing the card its action names',
    from: "    try { if (window.PropertyOS && window.PropertyOS.revealForAnchor) window.PropertyOS.revealForAnchor(an); } catch (_e) {}",
    to:   '    /* no reveal */' },
  { id: 'V25b', file: 'script.js', why: 'the review-queue "Fix it" jump expands a lease card inside a collapsed block',
    from: "  try { if (window.PropertyOS && window.PropertyOS.revealForAnchor) window.PropertyOS.revealForAnchor(['cardLeases']); } catch (_) {}\n  // The inner one is the card's own detail, which is built on expand, so the",
    to:   "  // The inner one is the card's own detail, which is built on expand, so the" },
  { id: 'V26', file: 'property-os.js', why: 'the toggle ignores the state it is told to take',
    from: "    var open = (force != null) ? !!force : (leases.style.display === 'none');",
    to:   "    var open = (leases.style.display === 'none');" },
  { id: 'V27', file: 'property-os.js', why: 'the toggle hides the block but leaves the button saying Hide',
    from: "    if (btn) btn.textContent = open ? 'Hide' : 'Open';",
    to:   "    if (btn) btn.textContent = 'Hide';" },

  // ── FOCUS: collapsing out from under someone using it ───────────────────
  { id: 'V28', file: 'property-os.js', why: 'the block collapses while a field inside it has focus',
    from: '    if (active && leases.contains(active)) return;',
    to:   '    if (false) return;' },
  { id: 'V29', file: 'property-os.js', why: 'a refresh in place overrides the choice the manager made',
    from: "    if (opts && opts.allowCollapse === false) { _syncLeaseToggleLabel(); return; }",
    to:   '    if (false) { _syncLeaseToggleLabel(); return; }' },
  { id: 'V30', file: 'property-os.js', why: 'the focus guard checks the wrong element',
    from: '    if (active && leases.contains(active)) return;',
    to:   '    if (active && bar.contains(active)) return;' },

  // ── VOCABULARY: the two-inventory reading comes back ────────────────────
  { id: 'V31', file: 'script.js', why: 'the upload list is named after tenants again',
    from: '      <h3>Leases from your uploads (${tenants.length})</h3>',
    to:   '      <h3>Extracted Tenants (${tenants.length})</h3>' },
  { id: 'V32', file: 'index.html', why: 'the orphan ordinal badge comes back',
    from: '          <div class="sec-num" style="background:#6b7280;">&#x1F4C2;</div>',
    to:   '          <div class="sec-num">2</div>' },
  { id: 'V33', file: 'index.html', why: 'the heading stops saying what the block is for',
    from: '            <h2>Lease intake</h2>\n            <p>Upload and review the leases behind the spaces above — AI extracts CAM terms, and each lease you add becomes a space.</p>',
    to:   '            <h2>Lease Upload</h2>\n            <p>Upload leases and invoices — AI extracts CAM terms automatically</p>' },
  { id: 'V34', file: 'property-os.js', why: 'the summary bar stops relating the block to the Spaces above',
    from: "        ' · upload or edit the leases behind the spaces above</span>' +",
    to:   "        '</span>' +" },
  { id: 'V35', file: 'property-os.js', why: 'the summary bar is never rendered at all',
    from: '    try { renderLeaseSummary(property, opts); } catch (_) {}',
    to:   '    /* no summary */' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'svmut-'));
// WHOLE TREE, minus .git and node_modules. A hand-listed subset has twice
// produced a baseline that could not load its own dependencies, which scores
// every mutant as killed and means nothing.
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

const SUITES = ['test-spaces-vocabulary.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 300000,
        env: Object.assign({}, process.env, { SV_PORT: '8977' }),
      });
    } catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 300000,
        env: Object.assign({}, process.env, { SV_PORT: '8977' }) });
    } catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
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
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passed) { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else        { killed++;                                    console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
