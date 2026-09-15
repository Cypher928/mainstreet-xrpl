'use strict';
/**
 * test-restore-renderer-parity.js — the saved-reconciliation card must offer the
 * same tenant actions as the fresh-run card.
 *
 *   node test-restore-renderer-parity.js
 *
 * Two functions render tenant result cards into #resultsBody:
 *
 *   runAllocation()          — after a fresh reconciliation
 *   restoreResultsDisplay()  — when a landlord OPENS a saved reconciliation
 *
 * They were written separately and drifted. The restored card carried only
 * "View Calculation", so opening a saved run silently lost "Validate Against
 * Lease" and "Tenant Statement". That mattered because the Modified Gross
 * finding tells the user to "use 'Validate Against Lease' on <tenant>'s result
 * card" — an instruction with no button behind it on that path. The restored
 * card also omitted the lv-panel mount div (_runLeaseValidation opens with
 * `if (!panelEl) return;`, so the button would have been a no-op even once
 * added).
 *
 * These tests assert BOTH renderers emit the same action set, so adding a
 * button to one renderer and forgetting the other fails CI rather than
 * shipping a half-wired card. They are source-level on purpose: the point is
 * that the two templates cannot diverge, which is a property of the source.
 *
 * ── On the result-card anchor id, precisely ──────────────────────────────────
 *
 * The anchor assertion below is structural parity, NOT a repair of a broken
 * control. State of play today:
 *
 *   · _buildNeedsReviewRollupHtml (script.js) is called from exactly one place,
 *     inside runAllocation. The fresh-run renderer emits the "Needs Review"
 *     rollup above the Reconciliation Summary, and only when at least one
 *     tenant carries ambiguityFlags — it returns '' otherwise.
 *   · restoreResultsDisplay does NOT call it. There is no Needs Review rollup
 *     on a saved reconciliation, so on that path there are no rollup buttons,
 *     working or broken.
 *   · The anchor id is therefore live on the fresh card (the rollup's scroll
 *     target) and, on the restored card, retained as parity/preparation for a
 *     possible future restore-path rollup.
 *
 * So: the anchor assertion for the restored renderer does not currently
 * correspond to any user-visible action. It is kept deliberately, because it is
 * a precondition for wiring the rollup into that path later and costs nothing
 * to hold. Do not read it as evidence that Needs Review works on saved runs.
 *
 * Rendering the rollup on the restore path is deliberately NOT done here — see
 * PHASE2_FOLLOWUP_RESTORE_ROLLUP.md. It first needs an answer to whether
 * ambiguityFlags survive the snapshot/restore cycle at all.
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function ok(c, m) { if (!c) throw new Error(m || 'expected truthy'); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const src = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

// The shared extractor. See test-support/fn-source.js — the regexes here used
// to pin the SIGNATURE and run to the first `}` at column 0, which is how a
// sibling suite died unnoticed when a function gained a parameter.
const { fnSource: _fnSource } = require('./test-support/fn-source.js');
const fnSource = (name) => _fnSource(src, name);

const FRESH   = fnSource('runAllocation');
const RESTORE = fnSource('restoreResultsDisplay');

// The action row each renderer emits, and the button classes inside it.
function actionRow(fnSrc, label) {
  const m = fnSrc.match(/<div class="result-card-actions">([\s\S]*?)<\/div>/);
  if (!m) throw new Error(`${label} emits no <div class="result-card-actions"> block`);
  return m[1];
}
// The BASE class of each button in the row.
//
// This used to require a literal closing quote — `<button class="foo"` — and
// I-12 gave the statement button a conditional modifier:
//
//     class="tenant-stmt-card-btn${... ? ' tenant-stmt-card-btn--held' : ''}"
//
// so the matcher stopped seeing a button that was right there in both
// renderers, and reported the product as missing an action it has. Reading the
// base class up to the quote, the whitespace, or the start of an interpolation
// keeps every assertion below intact — the button must still be present, in the
// action row, wired to its handler — while surviving a modifier class.
function buttonClasses(rowHtml) {
  return (rowHtml.match(/<button class="([a-zA-Z0-9_-]+)/g) || [])
    .map(s => s.replace(/^<button class="/, ''))
    .sort();
}
function rowHasButton(rowHtml, cls) {
  return new RegExp('<button class="' + cls + '(?=["\\s$])').test(rowHtml);
}

// The three actions a tenant result card must offer, and the handler each must
// be wired to. Adding a fourth action to either renderer without adding it to
// the other is exactly the drift these tests exist to catch.
const REQUIRED_ACTIONS = [
  ['explain-btn',           /openExplainPanel\('\$\{esc\(r\.name\)\}'\)/,        'View Calculation'],
  ['lv-validate-btn',       /_startLeaseValidation\('\$\{_lvPanelId\}',\$\{tdIdx\}\)/, 'Validate Against Lease'],
  ['tenant-stmt-card-btn',  /generateTenantStatement\('\$\{esc\(r\.name\)\}'\)/, 'Tenant Statement'],
];

for (const [label, fnSrc] of [['fresh (runAllocation)', FRESH], ['restored (restoreResultsDisplay)', RESTORE]]) {
  console.log(`\n── ${label} renderer ──`);

  t(`${label}: emits a result-card-actions row`, () => {
    ok(/<div class="result-card-actions">/.test(fnSrc), 'no action row emitted');
  });

  for (const [cls, handler, human] of REQUIRED_ACTIONS) {
    t(`${label}: offers ${human}`, () => {
      const row = actionRow(fnSrc, label);
      ok(rowHasButton(row, cls), `${human} button (.${cls}) missing from the action row`);
      ok(handler.test(row), `${human} is not wired to its handler`);
    });
  }

  t(`${label}: emits the lv-panel mount point _runLeaseValidation requires`, () => {
    ok(/<div id="\$\{_lvPanelId\}" class="lv-panel"/.test(fnSrc),
       'no lv-panel div — _startLeaseValidation would find no panel and return silently');
    ok(/const _lvPanelId = `lv-panel-\$\{tdIdx >= 0 \? tdIdx : r\.name\.replace\(\/\[\^a-zA-Z0-9\]\/g, '-'\)\}`/.test(fnSrc),
       'the lv-panel id is not derived the same way as the other renderer');
  });

  // Fresh renderer: this is the live scroll target for the Needs Review rollup.
  // Restored renderer: parity only — that path emits no rollup today, so this
  // guards a target with no user-visible entry point. See the docblock.
  t(`${label}: the card carries the result-card anchor id`, () => {
    ok(/<div class="result-card[^"]*"[^>]*id="\$\{_resultCardAnchorId\(r\.name\)\}"/.test(fnSrc),
       'the result card has no _resultCardAnchorId — on the fresh renderer this is the ' +
       'Needs Review rollup scroll target; on the restored renderer it is structural parity ' +
       'held for a future restore-path rollup');
  });
}

console.log('\n── Drift guard: the two renderers must stay in step ──');

t('both renderers expose an identical set of tenant actions', () => {
  const fresh    = buttonClasses(actionRow(FRESH, 'fresh'));
  const restored = buttonClasses(actionRow(RESTORE, 'restored'));
  eq(restored.join(','), fresh.join(','),
     'the saved-reconciliation card offers a different action set than the fresh card —\n' +
     `       fresh:    [${fresh.join(', ')}]\n` +
     `       restored: [${restored.join(', ')}]\n` +
     '       add the new action to BOTH renderers (or neither) —');
});

t('the action set is exactly the three documented actions', () => {
  const expected = REQUIRED_ACTIONS.map(a => a[0]).sort().join(',');
  eq(buttonClasses(actionRow(FRESH, 'fresh')).join(','), expected,
     'the fresh renderer gained or lost an action without this test being updated —');
  eq(buttonClasses(actionRow(RESTORE, 'restored')).join(','), expected,
     'the restored renderer gained or lost an action without this test being updated —');
});

// The parity the class-literal matcher had accidentally stopped checking. I-12
// made the statement button's LABEL follow billing state — a tenant the gate is
// about to refuse must not be offered "Tenant Statement" — and that behaviour
// has to be in both renderers or a reopened reconciliation offers a document it
// will then refuse to produce.
t('both renderers derive the statement button from the billing state', () => {
  for (const [label, fnSrc] of [['fresh', FRESH], ['restored', RESTORE]]) {
    const row = actionRow(fnSrc, label);
    ok(/_tenantBillingState\(r\.name/.test(row),
       `the ${label} renderer does not ask _tenantBillingState for the button label`);
    ok(/tenant-stmt-card-btn--held/.test(row),
       `the ${label} renderer never marks the button held`);
    ok(/_b \? _b\.cta/.test(row),
       `the ${label} renderer does not use the billing state's own call to action`);
  }
});

t('the lease-validation guard that makes the mount point mandatory still exists', () => {
  ok(/async function _runLeaseValidation\(panelEl[^)]*\) \{\s*if \(!panelEl\) return;/.test(src),
     '_runLeaseValidation no longer early-returns on a missing panel — if this guard changed, ' +
     'the lv-panel assertions above may no longer describe why the mount point is required');
});

const TOTAL_EXPECTED = 17;
t(`suite runs all ${TOTAL_EXPECTED} checks`, () => {
  eq(pass + fail + 1, TOTAL_EXPECTED, 'test count changed — update TOTAL_EXPECTED deliberately');
});

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log(`  · ${f}`)); process.exit(1); }
