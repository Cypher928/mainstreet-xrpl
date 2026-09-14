'use strict';
/**
 * tools/demo-showroom-mutation.js — does the showroom suite actually look?
 *
 *   node tools/demo-showroom-mutation.js
 *
 * The showroom is data, and a data suite can pass by admiring the data it was
 * written against. These mutants break the seed, the key-date writer and the
 * header image one decision at a time; test-e2e-demo-showroom.js must notice
 * every one.
 *
 *   S01  the writer drops keyDate
 *   S02  the writer accepts any keyDateKind
 *   S03  the writer keeps the time on a key date
 *   S04  the register loses its stable ids
 *   S05  records lose their invoice/record links
 *   S06  records lose their key dates
 *   S07  system records are filed as property-wide
 *   S08  tax records are filed under Other (→ History)
 *   S09  records lose their attachments
 *   S10  attachments point at the wrong folder
 *   S11  the header never shows the image
 *   S12  the image loses its caption
 *   S13  the caption stops saying it is not a photograph
 *   S14  a real property is given the demo image
 *   S15  the records are not manual records
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', V = 'property-cabinet-view.js', R = 'property-reference.js';

const MUTANTS = [
  { id: 'S01', file: S, why: 'the writer drops keyDate',
    from: "                           ? event.keyDate.slice(0, 10) : null,", to: "                           ? null : null," },
  { id: 'S02', file: S, why: 'the writer accepts any keyDateKind',
    from: "    keyDateKind:         (['renewal', 'deadline', 'maturity', 'expiry', 'inspection', 'permit'].includes(event.keyDateKind)\n                           ? event.keyDateKind : null),",
    to:   "    keyDateKind:         (event.keyDateKind ?? null)," },
  { id: 'S03', file: S, why: 'the writer keeps the time on a key date',
    from: "                           ? event.keyDate.slice(0, 10) : null,", to: "                           ? event.keyDate : null," },
  { id: 'S04', file: S, why: 'the register loses its stable ids',
    from: "      id: `inv-${i}`,\n      vendorName: inv.vendorName, amount: inv.amount,", to: "      vendorName: inv.vendorName, amount: inv.amount," },
  { id: 'S05', file: S, why: 'records lose their invoice/record links',
    from: "        relatedTo:           links,", to: "        relatedTo:           []," },
  { id: 'S06', file: S, why: 'records lose their key dates',
    from: "        keyDate:             x.keyDate || null,", to: "        keyDate:             null," },
  { id: 'S07', file: S, why: 'system records are filed as property-wide',
    from: "          ? { type: 'system', id: x.system, label: null }", to: "          ? { type: 'property', id: DEMO_PROPERTY_ID, label: null }" },
  { id: 'S08', file: S, why: 'tax records are filed under Other',
    from: "    const TAX = 'real_estate_taxes', INS = 'insurance', LOAN = 'mortgage_financing';", to: "    const TAX = 'other', INS = 'insurance', LOAN = 'mortgage_financing';" },
  { id: 'S09', file: S, why: 'records lose their attachments',
    from: "        attachments:         (x.docs || []).map(d => ({", to: "        attachments:         [].map(d => ({" },
  { id: 'S10', file: S, why: 'attachments point at the wrong folder',
    from: "    const DOC = 'assets/demo/records/';", to: "    const DOC = 'assets/demo/';" },
  { id: 'S11', file: V, why: 'the header never shows the image',
    from: "    var image = info && info.imageUrl", to: "    var image = false" },
  { id: 'S12', file: V, why: 'the image loses its caption',
    from: "          (info.imageCaption ? '<figcaption>' + _esc(info.imageCaption) + '</figcaption>' : '') + '</figure>'", to: "          '</figure>'" },
  { id: 'S13', file: R, why: 'the caption stops saying it is not a photograph',
    from: "      imageCaption:      'Architectural rendering of the fictional Cascade Commons — demonstration illustration, not a photograph',",
    to:   "      imageCaption:      'Cascade Commons',", },
  { id: 'S14', file: V, why: 'a real property is given the demo image',
    from: "    var image = info && info.imageUrl", to: "    var image = info && (info.imageUrl || 'assets/demo/cascade-commons-rendering.svg')" },
  { id: 'S15', file: S, why: 'the records are not manual records',
    from: "        manual:              true,\n        severity:            'info',\n        propertyId:          DEMO_PROPERTY_ID,\n        tenantId:            null,\n        actor:               x.actor || PM,",
    to:   "        manual:              false,\n        severity:            'info',\n        propertyId:          DEMO_PROPERTY_ID,\n        tenantId:            null,\n        actor:               x.actor || PM," },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'showmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
// pdfjs-dist is resolved from node_modules; the copy has none, so link the real one.
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}
const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-e2e-demo-showroom.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passedM) { survived.push(`${m.id} (${m.file}): ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                                      console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
