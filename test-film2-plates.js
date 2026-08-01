'use strict';
/**
 * Film 2 plate contract.
 *
 * Asserts the plates exist, that they were captured from the product, and — the
 * point of the whole package — that no audit fingerprint was invented. If the
 * demo ever does mint a real hash, this test notices and says so rather than
 * silently passing on stale expectations.
 */
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'assets', 'landing', 'film2');
const J = path.join(DIR, 'film2-plates.json');

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m\u2713\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m\u2717\x1b[0m ' + m + (d ? ' \u2014 ' + d : '')); fail++; };

if (!fs.existsSync(J)) {
  bad('film2-plates.json missing', 'run node tools/capture-film2-plates.js');
  console.log('\nRESULT: 0 passed, 1 failed'); process.exit(1);
}
const r = JSON.parse(fs.readFileSync(J, 'utf8'));

console.log('\n\u2500\u2500 Every approved scene has a plate \u2500\u2500');
const WANT = { 'S3':'upload', 'S1+S5':'allocation + cap row', 'S6':'property timeline',
               'S7':'dispute packet evidence index', 'S4':'honest gap (Command Center card)',
               'S8':'settlement', 'S9':'command center' };
for (const [scene, what] of Object.entries(WANT)) {
  const p = r.plates.find(x => x.scene === scene);
  if (!p) { bad(`${scene} missing entirely`); continue; }
  if (p.error) { bad(`${scene} (${what}) failed`, p.error); continue; }
  fs.existsSync(path.join(DIR, p.file))
    ? ok(`${scene.padEnd(6)} ${what} \u2014 ${p.file} (${p.width}px)`)
    : bad(`${scene} recorded ${p.file} but it is not on disk`);
}

console.log('\n\u2500\u2500 Facts came from the product \u2500\u2500');
(r.facts && r.facts.timeline && r.facts.timeline.events > 0)
  ? ok(`property timeline reports ${r.facts.timeline.events} real events`)
  : bad('timeline event count not recorded');

const ei = (r.facts && r.facts.evidenceIndex) || [];
ei.length === 6 ? ok(`evidence index captured all ${ei.length} provenance rows`)
                : bad('evidence index rows missing', String(ei.length));
const onFile = ei.filter(row => row[1] === 'On file').map(row => row[0]);
onFile.length ? ok(`records genuinely on file: ${onFile.join(', ')}`)
              : bad('no records on file', 'the packet would look empty');

console.log('\n\u2500\u2500 No fabricated audit fingerprint \u2500\u2500');
const fp = ei.find(row => /Audit fingerprint/i.test(row[0]));
const minted = !!(r.facts && r.facts.dispute && r.facts.dispute.hashGenerated);
if (!fp) { bad('audit fingerprint row not captured'); }
else if (minted) {
  fp[1] === 'On file'
    ? ok(`a REAL fingerprint was minted by the product \u2014 include it (${r.facts.dispute.hashPrefix}\u2026)`)
    : bad('dispute reports a hash but the packet says Not attached', JSON.stringify(fp));
} else {
  fp[1] === 'Not attached' && /Generated when the dispute is resolved/i.test(fp[2])
    ? ok('fingerprint honestly reads "Not attached" \u2014 nothing invented')
    : bad('fingerprint state is inconsistent with an unminted hash', JSON.stringify(fp));
}

console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
