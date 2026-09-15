'use strict';
/**
 * test-suite-registration.js — no test file may exist unaccounted for.
 *
 *   node test-suite-registration.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * Two suites were found broken that nobody had noticed. test-smoke-fixes.js
 * crashed on load — it pulled a function out of script.js by its SIGNATURE, and
 * the function had gained an optional parameter — so six real assertions about
 * the tenant statement's staleness guards had been going unevaluated. And
 * test-restore-renderer-parity.js reported that the product was missing a
 * button it has, because the button gained a conditional modifier class.
 *
 * Neither was registered in test-regression.js. Nothing ran them. Nobody knew.
 * The audit that followed found 74 of 110 test files in the same position.
 *
 * A test nobody runs is not coverage — it is a note claiming coverage, which is
 * worse, because it is counted. This suite makes the accounting explicit: every
 * test-*.js is either registered, or listed in test-support/coverage-manifest.js
 * with a category and a reason. A new file that is neither fails here, on the
 * next full regression, rather than in six months.
 *
 * It asserts NOTHING about the product. It is about whether the other tests are
 * being asked.
 */

const fs   = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const ROOT = __dirname;
const { EXCLUDED } = require('./test-support/coverage-manifest.js');
const REG_SRC = fs.readFileSync(path.join(ROOT, 'test-regression.js'), 'utf8');

// What the orchestrator actually runs, read from its own command strings rather
// than from a list kept alongside it — a second list is a list that drifts.
const registered = new Set([...REG_SRC.matchAll(/node\s+(test-[\w.-]+\.js)/g)].map(m => m[1]));

const onDisk = fs.readdirSync(ROOT)
  .filter(f => /^test-.*\.js$/.test(f))
  .filter(f => f !== 'test-regression.js' && f !== path.basename(__filename))
  .sort();

const VALID_REASONS = new Set(['credentials', 'network', 'cosmetic', 'stale']);

console.log('\n══ Test registration accounting ══');
console.log(`\n  ${onDisk.length} test files · ${registered.size} registered · ${Object.keys(EXCLUDED).length} excluded by manifest`);

console.log('\n── Every test file is accounted for ──');

t('no test file is both unregistered and unexplained', () => {
  const orphans = onDisk.filter(f => !registered.has(f) && !EXCLUDED[f]);
  ok(orphans.length === 0,
     `${orphans.length} test file(s) run nowhere and are listed nowhere:\n        ` +
     orphans.join('\n        ') +
     '\n      Register it in test-regression.js, or add it to test-support/coverage-manifest.js ' +
     'with a category and a reason. A test that nobody runs is not coverage.');
});

t('nothing is both registered and excluded', () => {
  const both = onDisk.filter(f => registered.has(f) && EXCLUDED[f]);
  ok(both.length === 0,
     `contradictory accounting for: ${both.join(', ')} — it is either run or it is excused, not both`);
});

t('every registered suite exists on disk', () => {
  const missing = [...registered].filter(f => !fs.existsSync(path.join(ROOT, f)));
  ok(missing.length === 0,
     `test-regression.js runs file(s) that do not exist: ${missing.join(', ')} — ` +
     'execSync would fail the whole suite on this');
});

t('every manifest entry exists on disk', () => {
  const ghosts = Object.keys(EXCLUDED).filter(f => !fs.existsSync(path.join(ROOT, f)));
  ok(ghosts.length === 0,
     `the manifest excuses file(s) that are gone: ${ghosts.join(', ')} — ` +
     'delete the entry so the list stays a description of reality');
});

console.log('\n── Every exclusion states a category and a reason ──');

t('each excluded file names a recognised category', () => {
  for (const [f, e] of Object.entries(EXCLUDED)) {
    ok(e && typeof e === 'object', `${f}: manifest entry is not an object`);
    ok(VALID_REASONS.has(e.reason),
       `${f}: category "${e.reason}" is not one of ${[...VALID_REASONS].join(', ')}`);
  }
});

t('each excluded file explains itself in a sentence, not a word', () => {
  for (const [f, e] of Object.entries(EXCLUDED)) {
    ok(typeof e.detail === 'string' && e.detail.trim().length >= 30,
       `${f}: the reason is too thin to act on — say what it needs, or what is broken`);
  }
});

// The two categories that mean "this ground is uncovered" are worth stating out
// loud on every run, not just when something breaks. A `stale` list that quietly
// grows is the same failure this suite exists to prevent, one level up.
console.log('\n── What is NOT being verified here ──');
for (const cat of ['credentials', 'network', 'stale']) {
  const files = Object.keys(EXCLUDED).filter(f => EXCLUDED[f].reason === cat);
  if (!files.length) continue;
  console.log(`\n  ${cat} (${files.length}):`);
  files.forEach(f => console.log(`    · ${f}`));
}

t('the uncovered list has not grown without anyone deciding to', () => {
  // A number, deliberately hard-coded. Raising it is a decision someone makes in
  // a diff, with a reason in the manifest beside it — which is the entire point.
  const STALE_BUDGET = 13;
  const stale = Object.keys(EXCLUDED).filter(f => EXCLUDED[f].reason === 'stale');
  ok(stale.length <= STALE_BUDGET,
     `${stale.length} suites are parked as stale, budget is ${STALE_BUDGET}. ` +
     'Repair one before parking another, or raise the budget deliberately.');
});

console.log('\n' + '─'.repeat(58));
if (fail) {
  console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
