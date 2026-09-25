'use strict';
/**
 * tools/acquisition-clarity-mutation.js — would anyone notice if the workspace
 * went back to blurring the record with its source material, or its states
 * with each other?
 *
 *   node tools/acquisition-clarity-mutation.js
 *
 * Each mutant undoes ONE part of the §4m clarity pass, and the Lease Matrix
 * suites (test-acquisition-lease-matrix.js, test-e2e-acquisition-lease-matrix.js)
 * must fail for every one.
 *
 *   The five states — acquisition-lease-matrix.js, script.js
 *     C01  "Verified" no longer says by a person
 *     C02  a value read by AI is labelled "AI extracted"
 *     C03  a term nothing establishes is labelled "Missing"
 *     C04  the evidence chip for an AI reading is "AI extracted"
 *     C05  the evidence chip for an absent term is "Missing"
 *     C06  counts lump the AI readings under one word ("11 AI")
 *     C07  the legend no longer says italic is Unclear
 *     C08  unclear values stop being italic
 *
 *   Needs attention as the workload — acquisition-lease-matrix.js, script.js
 *     C09  values only read by AI are not listed as needing attention
 *     C10  entered and unclear values are counted as unverified too
 *     C11  the matrix row stops counting its unverified values
 *     C22  a group of terms is summed into "1 item" again
 *     C23  a group stops naming the terms it counts
 *     C24  terms nothing establishes are left out of Needs attention
 *
 *   The record and its source material — index.html, script.js
 *     C12  the record is headed "Lease Matrix" again
 *     C13  the upload list is a tenant roster again (names, no files)
 *     C14  the upload card no longer says its list is not reviewed
 *
 *   Internal words — script.js, acquisition-lease-matrix.js
 *     C15  "not in a leasehold" is back on the matrix
 *     C16  "not yet placed" is back
 *     C17  a status says "issues" instead of contested
 *
 *   One queue — acquisition-lease-matrix.js, script.js
 *     C18  the record's status line leaves the documents out
 *     C19  the matrix drops its line to Documents › Needs review
 *     C20  that line no longer takes the reader there
 *     C21  Documents › Needs review stops using the shared words
 *
 * Not mutated, and why: _acqDocsToReview's split between "not yet matched"
 * and "of unknown type" — every Maple Plaza document under Needs review is
 * unmatched, so merging the two changes nothing the walk can see; the unit
 * suite pins the split by source instead.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', M = 'acquisition-lease-matrix.js', H = 'index.html';

const MUTANTS = [
  { id: 'C01', file: M, why: '"Verified" no longer says by a person',
    from: "    verified:  'Verified by a person',\n    entered:   'Verified by a person',",
    to:   "    verified:  'Verified',\n    entered:   'Verified',"},
  { id: 'C02', file: M, why: 'a value read by AI is labelled "AI extracted"',
    from: "    read:      'Read by AI · not yet verified',\n    unclear:   'Unclear',",
    to:   "    read:      'AI extracted',\n    unclear:   'Unclear'," },
  { id: 'C03', file: M, why: 'a term nothing establishes is labelled "Missing"',
    from: "    missing:   'Not established',\n  };",
    to:   "    missing:   'Missing',\n  };" },
  { id: 'C04', file: S, why: 'the evidence chip for an AI reading is "AI extracted"',
    from: "  ai_extracted: { label: 'Read by AI · not yet verified', cls: 'ai'       },",
    to:   "  ai_extracted: { label: 'AI extracted', cls: 'ai'       }," },
  { id: 'C05', file: S, why: 'the evidence chip for an absent term is "Missing"',
    from: "  missing:      { label: 'Not established',               cls: 'missing'  },",
    to:   "  missing:      { label: 'Missing',               cls: 'missing'  }," },
  { id: 'C06', file: M, why: 'counts lump the AI readings under one word ("11 AI")',
    from: "    if (x.read)      parts.push(x.read + ' read by AI, not yet verified');",
    to:   "    if (x.read)      parts.push(x.read + ' AI');" },
  { id: 'C07', file: S, why: 'the legend no longer says italic is Unclear',
    from: '<span class="acq-lm-v unclear">value</span> <em>italic</em> = Unclear</li>',
    to:   '<span class="acq-lm-v unclear">value</span> Unclear</li>' },
  { id: 'C08', file: H, why: 'unclear values stop being italic',
    from: '    .acq-lm-v.unclear { font-style: italic; }',
    to:   '    .acq-lm-v.unclear { }' },
  { id: 'C09', file: M, why: 'values only read by AI are not listed as needing attention',
    from: "    { kind: 'unverified', state: 'read',",
    to:   "    { kind: 'unverified', state: 'none'," },
  { id: 'C10', file: M, why: 'entered and unclear values are counted as unverified too',
    from: "return (r._states || {})[f] && cellFor(r, f, opts).state === 'read'; });",
    to:   "return (r._states || {})[f] && ['read', 'entered', 'unclear'].indexOf(cellFor(r, f, opts).state) >= 0; });" },
  { id: 'C11', file: S, why: 'the matrix row stops counting its unverified values',
    from: '${e.unverified.length\n            ? `<span class="acq-lm-unverified"',
    to:   '${false\n            ? `<span class="acq-lm-unverified"' },
  { id: 'C12', file: H, why: 'the record is headed "Lease Matrix" again',
    from: '      <h3>&#x1F4CB; MainStreet’s Record</h3>',
    to:   '      <h3>&#x1F4CB; Lease Matrix</h3>' },
  { id: 'C13', file: S, why: 'the upload list is a tenant roster again (names, no files)',
    from: "        <span class=\"acq-src-file\">&#x1F4C4; ${esc(file || 'File name not recorded')}</span>",
    to:   "        <span class=\"acq-src-file\">${esc(read || '')}</span>" },
  { id: 'C14', file: H, why: 'the upload card no longer says its list is not reviewed',
    from: '        <span class="acq-src-note">Source material: each file below is <strong>as extracted from your files — not reviewed</strong>. MainStreet’s Record above is the reviewed record.</span>',
    to:   '' },
  { id: 'C15', file: S, why: '"not in a leasehold" is back on the matrix',
    from: "not matched to a tenant — as extracted from the file, not reviewed`\n        : `Every extracted entry",
    to:   "not in a leasehold — as extracted from the file, not verified`\n        : `Every extracted entry" },
  { id: 'C16', file: M, why: '"not yet placed" is back',
    from: "(d.unmatched === 1 ? ' document' : ' documents') + ' not yet matched to a tenant');",
    to:   "(d.unmatched === 1 ? ' document' : ' documents') + ' not yet placed');" },
  { id: 'C17', file: M, why: 'a status says "issues" instead of contested',
    from: "    if (contested) return { kind: 'issues', label: contested + ' contested' };",
    to:   "    if (contested) return { kind: 'issues', label: contested + (contested === 1 ? ' issue' : ' issues') };" },
  { id: 'C18', file: M, why: "the record's status line leaves the documents out",
    from: '    parts = parts.concat(documentsLine(docs));',
    to:   '    parts = parts;' },
  { id: 'C19', file: S, why: 'the matrix drops its line to Documents › Needs review',
    from: '      ${dueText ? `<button type="button" class="acq-lm-docs-due">',
    to:   '      ${false ? `<button type="button" class="acq-lm-docs-due">' },
  { id: 'C20', file: S, why: 'that line no longer takes the reader there',
    from: "    if (t.closest && t.closest('.acq-lm-docs-due')) {\n      ev.preventDefault();",
    to:   "    if (t.closest && t.closest('.acq-lm-docs-due')) {\n      ev.preventDefault(); return;" },
  { id: 'C22', file: M, why: 'a group of terms is summed into "1 item" again',
    from: "      return { kind: k.kind, count: terms.length, text: terms.length + ' ' + k.words(terms.length), terms: terms };",
    to:   "      return { kind: k.kind, count: terms.length, text: '1 item', terms: terms };" },
  { id: 'C23', file: S, why: 'a group stops naming the terms it counts',
    from: '<span class="acq-lh-attn-terms">${g.terms.map(t =>',
    to:   '<span class="acq-lh-attn-terms">${[].map(t =>' },
  { id: 'C24', file: M, why: 'terms nothing establishes are left out of Needs attention',
    from: "    { kind: 'missing',    state: 'missing',",
    to:   "    { kind: 'missing',    state: 'none'," },
  { id: 'C21', file: S, why: 'Documents › Needs review stops using the shared words',
    from: '    (LMd ? LMd.documentsLine({ unmatched: due.unmatched, untyped: due.untyped }) :',
    to:   '    (false ? LMd.documentsLine({ unmatched: due.unmatched, untyped: due.untyped }) :' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-clarity-mut-'));
for (const entry of fs.readdirSync(ROOT)) {
  if (['node_modules', '.git', 'scratchpad', 'evidence', 'assets'].includes(entry)) continue;
  fs.cpSync(path.join(ROOT, entry), path.join(tmp, entry), { recursive: true });
}
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}

const ORIGINAL = {};
[S, M, H].forEach(f => { ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
// The fast suite first: a mutant it kills never pays for a browser.
const SUITES = [['node', 'test-acquisition-lease-matrix.js'], ['node', 'test-e2e-acquisition-lease-matrix.js']];
function runSuites() {
  for (const [bin, suite] of SUITES) {
    try { execFileSync(bin, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suite first.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — malformed mutant`); survived.push(m.id + ' (anchor not unique)'); continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (!passed) { killed++; console.log(`  kill ${m.id}  ${m.why}`); continue; }
  survived.push(`${m.id}: ${m.why}`);
  console.log(`  LIVE ${m.id}  ${m.why}`);
}
console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) { console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):'); survived.forEach(s => console.log('  · ' + s)); }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
