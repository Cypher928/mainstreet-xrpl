'use strict';
/**
 * tools/section-badges-mutation.js — does the badge suite bite?
 *
 *   node tools/section-badges-mutation.js
 *
 * Five kinds of mutant:
 *
 *   REGRESS   a digit comes back into a badge, in any of the seven places. This
 *             is the defect: an ordinal with nothing to order, on a tab that
 *             shows only a fragment of the run.
 *   ERASE     a badge is emptied or its card loses its heading — "no digit" must
 *             not be satisfiable by removing the thing entirely.
 *   WORKFLOW  the numbering that IS legitimate is damaged: updateStepBar's
 *             `i + 1` replaced by a constant or an index, its checkmarks
 *             dropped or inverted, or the onboarding 1-5 renumbered. This slice
 *             promised to leave both alone, so the suite must feel them move.
 *   REPARENT  `_reparent()` stops placing a card under its subject. That
 *             migration is what stranded the ordinals in the first place; if it
 *             regresses, the cards are unreachable where the suite looks.
 *   IDENTITY  a badge starts being derived from data — the exact thing the trace
 *             proved it is not. Section F feeds ids 0/4/9 and empties the
 *             collections, so a data-derived badge cannot survive.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['index.html', 'script.js', 'property-os.js'];

// The seven re-badged slots, exactly as they now read.
const BADGES = [
  ['B01', 'Property Setup',   '      <div class="sec-num">&#x1F4D0;</div>',
                              '      <div class="sec-num">1</div>'],
  ['B02', 'Invoice Upload',   '      <div class="sec-num">&#x1F9FE;</div>',
                              '      <div class="sec-num">3</div>'],
  ['B03', 'Allocation',       '      <div class="sec-num green">&#x1F4CA;</div>',
                              '      <div class="sec-num green">4</div>'],
  ['B04', 'Disputes',         '      <div class="sec-num" style="background:#ea580c;">&#x2696;&#xFE0F;</div>',
                              '      <div class="sec-num" style="background:#ea580c;">5</div>'],
  ['B05', 'Reports',          '      <div class="sec-num" style="background:#7c3aed;">&#x1F4D1;</div>',
                              '      <div class="sec-num" style="background:#7c3aed;">6</div>'],
  ['B06', 'Reserve docs',     '      <div class="sec-num" style="background:#0e7490;">&#x1F3E6;</div>',
                              '      <div class="sec-num" style="background:#0e7490;">7</div>'],
  ['B07', 'Reserve requests', '      <div class="sec-num" style="background:#0e7490;">&#x1F4B8;</div>',
                              '      <div class="sec-num" style="background:#0e7490;">8</div>'],
];

const MUTANTS = [];

// ── REGRESS: each digit comes back, one at a time ────────────────────────────
for (const [id, what, from, to] of BADGES) {
  MUTANTS.push({ id, file: 'index.html', why: `the ordinal returns to ${what}`, from, to });
}
// ── ERASE: "no digit" must not be satisfiable by deleting the badge ──────────
MUTANTS.push(
  { id: 'B08', file: 'index.html', why: 'the Reports badge is emptied instead of re-badged',
    from: BADGES[4][2], to: '      <div class="sec-num" style="background:#7c3aed;"></div>' },
  { id: 'B09', file: 'index.html', why: 'two sections share one badge, so it names nothing',
    from: BADGES[5][2], to: '      <div class="sec-num" style="background:#0e7490;">&#x1F4B8;</div>' },
  { id: 'B10', file: 'index.html', why: 'the Reserve & Loan Documents heading is removed',
    from: '<h2>Reserve &amp; Loan Documents</h2>', to: '<h2></h2>' },
  { id: 'B11', file: 'script.js', why: 'the empty reserve-requests state stops saying why it is empty',
    from: 'No reserve requests yet. Start one from a reserve account above',
    to:   'No data.' },
);

// ── WORKFLOW: the legitimate numbering must not move ────────────────────────
MUTANTS.push(
  { id: 'B12', file: 'script.js', why: 'the step bar stops numbering its dots from position',
    from: '    if (i >= idx && dot) dot.textContent = i + 1;',
    to:   '    if (i >= idx && dot) dot.textContent = idx + 1;' },
  { id: 'B13', file: 'script.js', why: 'the step bar numbers from zero',
    from: '    if (i >= idx && dot) dot.textContent = i + 1;',
    to:   '    if (i >= idx && dot) dot.textContent = i;' },
  { id: 'B14', file: 'script.js', why: 'the step bar drops its digits entirely, like the badges',
    from: '    if (i >= idx && dot) dot.textContent = i + 1;',
    to:   "    if (i >= idx && dot) dot.textContent = '\\u25CF';" },
  { id: 'B15', file: 'script.js', why: 'completed steps stop being checked',
    from: '    if (i < idx && dot) dot.innerHTML = \'&#x2713;\';',
    to:   '    if (i < idx && dot) dot.innerHTML = String(i + 1);' },
  { id: 'B16', file: 'script.js', why: 'the checkmark rule is inverted — steps ahead read as done',
    from: '    if (i < idx)  el.classList.add(\'done\');\n    if (i === idx) el.classList.add(\'active\');',
    to:   '    if (i > idx)  el.classList.add(\'done\');\n    if (i === idx) el.classList.add(\'active\');' },
  { id: 'B17', file: 'script.js', why: '"done" no longer checks every step',
    from: "      if (dot) dot.innerHTML = '&#x2713;';",
    to:   "      if (dot) dot.innerHTML = '';" },
  { id: 'B18', file: 'index.html', why: 'the onboarding list is renumbered from 0',
    from: '<div class="ob-modal-step-num">1</div>', to: '<div class="ob-modal-step-num">0</div>' },
  { id: 'B19', file: 'index.html', why: 'the onboarding list loses a step, leaving a hole',
    from: '<div class="ob-modal-step-num">3</div>', to: '<div class="ob-modal-step-num">4</div>' },
  { id: 'B20', file: 'index.html', why: 'the onboarding steps are re-badged too, losing a real ordinal',
    from: '<div class="ob-modal-step-num">5</div>', to: '<div class="ob-modal-step-num">&#x2714;</div>' },
  { id: 'B21', file: 'index.html', why: 'a step label is renamed, so the workflow stops matching',
    from: '<div class="step-label">Invoices</div>', to: '<div class="step-label">Expenses</div>' },
);

// ── REPARENT: the migration that stranded the ordinals must not regress ─────
MUTANTS.push(
  { id: 'B22', file: 'property-os.js', why: 'Property Setup is no longer moved under Property',
    from: '    if (setup && body && !body.contains(setup)) body.parentNode.insertBefore(setup, body);',
    to:   '    if (false) body.parentNode.insertBefore(setup, body);' },
  // B23 was `if (false) spacesPane.appendChild(leases)` and B24 was flipping
  // `docs.style.display` to 'block'. Both were PROVABLE EQUIVALENTS and were
  // replaced rather than argued:
  //
  //   B23  #cardLeases is STATICALLY nested inside #wsPane-spaces in index.html
  //        (the card at line ~7390, the pane opening at ~7351), so
  //        `!spacesPane.contains(leases)` is already false and the appendChild
  //        never executes. Any edit inside that if-body is unobservable. The
  //        replacement mutates the CONDITION and the destination, so the card
  //        really does leave the pane.
  //   B24  #wsPane-documents does not exist anywhere — not in index.html and
  //        nothing creates it — so `_d('wsPane-documents')` is null and that line
  //        is dead. The live branch is the tab BUTTON, which is what the
  //        replacement mutates. (This survivor also exposed a vacuous assertion,
  //        which accepted an absent pane as a pass; section E now checks the
  //        button, and states the pane's absence as its own fact.)
  { id: 'B23', file: 'property-os.js', why: 'Lease intake is reparented to the wrong container',
    from: '    if (leases && spacesPane && !spacesPane.contains(leases)) spacesPane.appendChild(leases);',
    to:   '    if (leases && spacesPane) document.body.appendChild(leases);' },
  { id: 'B24', file: 'property-os.js', why: 'the retired Documents tab button comes back into navigation',
    from: '    if (docsBtn) docsBtn.style.display = \'none\';',
    to:   '    if (docsBtn) docsBtn.style.display = \'block\';' },
  { id: 'B25', file: 'property-os.js', why: 'the Property pane badge becomes an ordinal',
    from: '<div class="sec-num" style="background:#0ea5e9;">\\u{1F3E2}</div>',
    to:   '<div class="sec-num" style="background:#0ea5e9;">1</div>' },
  { id: 'B26', file: 'script.js', why: 'the tab list gains a tab with no pane',
    from: "const WORKSPACE_TABS = ['overview', 'property', 'spaces', 'cam', 'reports', 'reserves'];",
    to:   "const WORKSPACE_TABS = ['overview', 'property', 'spaces', 'cam', 'reports', 'reserves', 'estoppels'];" },
);

// ── IDENTITY: a badge starts being derived from data ────────────────────────
MUTANTS.push(
  { id: 'B27', file: 'script.js', why: 'the disputes badge is rewritten from the dispute count',
    from: 'function updateStepBar(reached) {',
    to:   'function updateStepBar(reached) {\n  try { var _b = document.querySelector(\'#disputeSection .sec-num\');\n    if (_b) _b.textContent = String((typeof disputes !== \'undefined\' ? disputes : []).length); } catch (_) {}' },
  { id: 'B28', file: 'script.js', why: 'the disputes badge is rewritten from the highest dispute id',
    from: 'function updateStepBar(reached) {',
    to:   'function updateStepBar(reached) {\n  try { var _b = document.querySelector(\'#disputeSection .sec-num\');\n    var _ds = (typeof disputes !== \'undefined\' ? disputes : []);\n    if (_b && _ds.length) _b.textContent = String(Math.max.apply(null, _ds.map(function (d) { return d.id; })) + 1); } catch (_) {}' },
  { id: 'B29', file: 'property-os.js', why: 'every badge is renumbered from its position on the page',
    from: '    _reparented = true;',
    to:   '    _reparented = true;\n    try { var _all = document.querySelectorAll(\'.sec-num\');\n      for (var _i = 0; _i < _all.length; _i++) _all[_i].textContent = String(_i + 1); } catch (_) {}' },
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ordmut-'));
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

const SUITES = ['test-section-badges.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { ORD_PORT: '8972' }),
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
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { ORD_PORT: '8972' }) });
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
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passedM) { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                                    console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
