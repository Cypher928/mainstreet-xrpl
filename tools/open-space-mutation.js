'use strict';
/**
 * tools/open-space-mutation.js — do the open-space tests actually bite?
 *
 *   node tools/open-space-mutation.js
 *
 * Every mutant reintroduces a plausible version of the defect this slice fixed,
 * or breaks the working case the fix had to preserve. A survivor is either a
 * genuine gap in test-open-space-identity.js or an equivalent mutant that has
 * to be argued for in writing, not waved past.
 *
 * Mutants are applied to a COPY in a scratch directory; the working tree is
 * never touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = ['tenant-space.js', 'script.js', 'test-open-space-identity.js'];

const MUTANTS = [
  // ── the Spaces card ──────────────────────────────────────────────────────
  { id: 'S01', file: 'tenant-space.js', why: 'the dead button comes back for every space',
    from: '        (rec.noIdentity\n', to: '        (false\n' },
  { id: 'S02', file: 'tenant-space.js', why: 'the branch inverts — openable spaces lose their button',
    from: '        (rec.noIdentity\n', to: '        (!rec.noIdentity\n' },
  { id: 'S03', file: 'tenant-space.js', why: 'the explanation becomes a real button again',
    from: "          ? '<div class=\"tsl-noopen\"",
    to:   "          ? '<button class=\"tsl-noopen\"" },
  { id: 'S04', file: 'tenant-space.js', why: 'noIdentity stops covering the empty-string id',
    from: "    var noIdentity = (tenantId == null || tenantId === '');",
    to:   '    var noIdentity = (tenantId == null);' },
  { id: 'S05', file: 'tenant-space.js', why: 'noIdentity stops covering null/undefined',
    from: "    var noIdentity = (tenantId == null || tenantId === '');",
    to:   "    var noIdentity = (tenantId === '');" },
  { id: 'S06', file: 'tenant-space.js', why: 'noIdentity is never true, so nothing is ever explained',
    from: "    var noIdentity = (tenantId == null || tenantId === '');",
    to:   '    var noIdentity = false;' },
  { id: 'S07', file: 'tenant-space.js', why: 'the id-less card silently renders nothing at all',
    from: "          ? '<div class=\"tsl-noopen\" title=\"MainStreet has no stored record id for this space, so there is nothing to open yet.\">' +\n              'Can’t open yet — no saved record' +\n            '</div>'",
    to:   "          ? ''" },

  // ── openSpace's guard ────────────────────────────────────────────────────
  { id: 'S08', file: 'tenant-space.js', why: 'openSpace goes back to failing in silence',
    from: '    if (!property || !tenantId) {', to: '    if (false) {' },
  { id: 'S09', file: 'tenant-space.js', why: 'the guard stops checking the identity',
    from: '    if (!property || !tenantId) {', to: '    if (!property) {' },
  { id: 'S10', file: 'tenant-space.js', why: 'the guard rejects everything, valid ids included',
    from: '    if (!property || !tenantId) {', to: '    if (true) {' },
  { id: 'S11', file: 'tenant-space.js', why: 'the two refusals stop being distinguished',
    from: '        window.showToast(property\n', to: '        window.showToast(false\n' },

  // ── the review queue card ────────────────────────────────────────────────
  { id: 'S12', file: 'script.js', why: 'the id-less review item gets its dead buttons back',
    from: '        if (!tid) {', to: '        if (false) {' },
  { id: 'S13', file: 'script.js', why: 'the guard inverts — valid items lose their actions',
    from: '        if (!tid) {', to: '        if (tid) {' },
  { id: 'S14', file: 'script.js', why: 'the primary action is emitted before the guard',
    from: '        if (!tid) {\n          return `<span class="rq-chip rq-chip--warn"',
    to:   '        if (false) {\n          return `<span class="rq-chip rq-chip--warn"' },
  { id: 'S15', file: 'script.js', why: 'an acknowledged item loses its Review button',
    from: '        if (acked) return primary + `<span class="rq-chip">Ack\'d</span>`;',
    to:   '        if (acked) return `<span class="rq-chip">Ack\'d</span>`;' },
  { id: 'S16', file: 'script.js', why: 'the fix action stops carrying the tenant id',
    from: "openReviewItemFix('${tid}',", to: "openReviewItemFix(''," },

  // ── openReviewWorkspace ──────────────────────────────────────────────────
  { id: 'S17', file: 'script.js', why: 'the empty-id guard is removed',
    from: '  if (!tenantId) {\n    showToast(', to: '  if (false) {\n    showToast(' },
  { id: 'S18', file: 'script.js', why: 'the not-found case goes back to a silent return',
    from: "  if (!t) {\n    showToast('Could not open that tenant for review",
    to:   "  if (!t) { return; }\n  if (false) {\n    showToast('Could not open that tenant for review" },
  { id: 'S19', file: 'script.js', why: 'the guard moves after the scan, so an empty id scans first',
    from: '  if (!tenantId) {', to: '  if (tenantId === undefined && false) {' },

  // S20/S21 mutated an area guard this slice tried and then reverted — the
  // neighbour-area leak is real, but its fix belongs in assemble() and a guard
  // on the render line alone changes the shape M8c/M8d pinned. The leak is
  // recorded as a KNOWN GAP in the suite instead of being half-fixed here.
  //
  // A mutant for the `!= null` area rule itself was written and then removed
  // too: that rule is not this suite's to guard, and mutating it here would
  // report a survivor for a guarantee that IS held elsewhere. Verified rather
  // than assumed — test-m8d E12 matches /if \(rec\.lease\.sqft != null\)
  // meta\.push/, which is true of the current source and false of the
  // truthiness mutant, so M8d fails on it and this harness would only
  // double-count.
  //
  // S22/S23 originally mutated a second guard on the COUNTS in renderList.
  // Both survived, and investigating why showed the guard was dead:
  // _scopedEvents already refuses to scope without an identity, so the counts
  // are 0 either way. The guard was removed rather than kept as unfalsifiable
  // defence, and the mutants now aim at the protection that is actually load-
  // bearing — the upstream refusal itself.
  { id: 'S22', file: 'tenant-space.js', why: 'an id-less space scopes in the whole building’s history',
    from: "    if (tenantId == null || tenantId === '') return [];",
    to:   '    if (false) return [];' },
  { id: 'S23', file: 'tenant-space.js', why: 'the counts stop being rendered for valid spaces',
    from: "      if (rec.counts.events) counts.push(rec.counts.events + ' event'",
    to:   "      if (false) counts.push(rec.counts.events + ' event'" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openspace-mut-'));
const ORIGINAL = {};
for (const f of FILES) {
  ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  fs.writeFileSync(path.join(tmp, f), ORIGINAL[f]);
}

function runSuite() {
  try {
    execFileSync(process.execPath, ['test-open-space-identity.js'],
                 { cwd: tmp, stdio: 'pipe', timeout: 120000 });
    return true;
  } catch (_) { return false; }
}

console.log('Baseline (unmutated copy): ' + (runSuite() ? 'PASS' : 'FAIL — fix before mutating'));

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
  const passed = runSuite();
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
