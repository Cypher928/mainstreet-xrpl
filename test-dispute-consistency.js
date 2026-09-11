'use strict';
/**
 * test-dispute-consistency.js — every surface counts the same disputes.
 *
 *   node test-dispute-consistency.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * A manager-walkthrough of the Cascade Commons demo found the product
 * disagreeing with itself about two disputes — one `open`, one
 * `docs_requested`:
 *
 *     Overview attention panel        2 open disputes
 *     CAM dispute list                1 open · 1 filed under "🟢 Resolved"
 *     "Disputes Resolved" counter     1
 *     Selectors.buildPropMeta         openDisputes: 1
 *
 * The one printed as resolved was `docs_requested`: the landlord has asked the
 * tenant for documents and nobody has decided anything. Telling a manager that
 * charge is settled is the opposite of true.
 *
 * ROOT CAUSE
 *
 * dispute-status.js (M7) already settled this. It derives "open" from the
 * lifecycle table — a dispute is open while the machine still permits it to
 * move — and its own header names the modules holding the narrow opinion. Three
 * consumers adopted it in 2025: property-workspace.js, tenant-space.js and
 * get_disputes. Everything else kept `status === 'open'`, so the Overview panel
 * (converted) and the CAM list (not converted) were reading two different
 * definitions of the same word.
 *
 * WHAT THIS PINS
 *   A  the authoritative mapping itself, including docs_requested and unknown
 *   B  every converted surface agrees, on the same fixture
 *   C  closed and unknown statuses are not silently folded into each other
 *   D  scoping — a tenant's count is that tenant's
 *   E  the empty case, and no dispute invented anywhere
 *   F  Ask AI consumes the same authority
 *   G  the deliberate exceptions stay deliberate, and are guards not counts
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const DS = require('./dispute-status.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); fail++; }
}
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const H  = (s) => console.log(`\n\x1b[36m── ${s} ──\x1b[0m`);

// Source, comment-stripped: this slice's own prose must not satisfy an
// assertion about the code it describes.
const code = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC = {
  script:   code('script.js'),
  sel:      code('selectors.js'),
  cc:       code('command-center.js'),
  lrp:      code('lease-review-packets.js'),
  acq:      code('acquisition-engine.js'),
  ai:       code('ai-workspace.js'),
  ts:       code('tenant-space.js'),
  pw:       code('property-workspace.js'),
};

// ── the fixture: the demo's own shape, plus the two edge statuses ──────────
const D = (id, tenant, status) => ({
  id, tenantName: tenant, status, vendor: 'Acme', category: 'repairs',
  tenantShare: 100, reason: 'r', timestamp: '2026-01-01T00:00:00.000Z',
});
const FIXTURE = [
  D(0, 'Whole Health Market',        'docs_requested'), // OPEN — the defect
  D(1, 'Summit Coffee & Provisions', 'open'),           // open
  D(2, 'FitZone Athletics',          'accepted'),       // closed
  D(3, 'Harbor Nail & Beauty Studio','rejected'),       // closed
  D(4, 'ProActive Physical Therapy', 'resolved'),       // closed (legacy)
  D(5, 'Corner Market',              'escalated'),      // UNKNOWN — never written
];
const EXPECT = { total: 6, open: 2, closed: 3, unknown: 1 };

console.log('\n══ Dispute status / count consistency ══');

// ── A — the authoritative mapping ─────────────────────────────────────────
H('A · the authoritative vocabulary and lifecycle');

t('A1 docs_requested is OPEN — it can still move', () => {
  eq(DS.classify('docs_requested'), 'open');
  ok(DS.TRANSITIONS.docs_requested.length > 0, 'the table calls it terminal');
});
t('A2 open is OPEN', () => eq(DS.classify('open'), 'open'));
t('A3 accepted, rejected and resolved are CLOSED', () => {
  ['accepted', 'rejected', 'resolved'].forEach(s => eq(DS.classify(s), 'closed', s));
});
t('A4 an unwritten status is UNKNOWN, not quietly closed', () => {
  ['escalated', 'withdrawn', 'weird', '', null, undefined].forEach(s =>
    eq(DS.classify(s), 'unknown', String(s)));
});
t('A5 the tally loses nothing: total === open + closed + unknown', () => {
  const x = DS.tally(FIXTURE);
  eq(x.total, EXPECT.total); eq(x.open, EXPECT.open);
  eq(x.closed, EXPECT.closed); eq(x.unknown, EXPECT.unknown);
  eq(x.open + x.closed + x.unknown, x.total);
  assert.deepStrictEqual(x.unknownStatuses, ['escalated']);
});
t('A6 the open predicate is DERIVED from the table, not a hard-coded list', () => {
  const src = fs.readFileSync(path.join(__dirname, 'dispute-status.js'), 'utf8');
  ok(/TRANSITIONS\[status\]\.length \? OPEN : CLOSED/.test(src),
     'classify() restates a list instead of reading the transition table');
});

// ── B — every surface agrees ──────────────────────────────────────────────
H('B · every converted surface produces the same counts');

// Each surface's own predicate, extracted by behaviour rather than by reading
// its source: the shipped modules are browser IIFEs, so the shared rule is
// exercised through DisputeStatus, and the source checks below prove each
// module actually routes into it.
const openCount = (list) => list.filter(d => DS.isOpen(d)).length;

// Slice a whole top-level function body, rather than guessing a byte length —
// the first draft of this suite used fixed windows and two assertions silently
// fell off the end of renderOpenDisputes() when it grew.
function fnBody(src, decl) {
  const i = src.indexOf(decl);
  if (i === -1) throw new Error('not found: ' + decl);
  const j = src.indexOf('\n}', i);
  if (j === -1) throw new Error('unterminated: ' + decl);
  return src.slice(i, j);
}

t('B1 the shared rule gives 2 open on the fixture', () => eq(openCount(FIXTURE), EXPECT.open));

t('B2 [source] the CAM dispute list groups by the authority, not by === open', () => {
  const body = fnBody(SRC.script, 'function renderOpenDisputes');
  ok(/_disputeClass\(d\) === 'open'/.test(body),   'openList does not use the shared classifier');
  ok(/_disputeClass\(d\) === 'closed'/.test(body), 'resolvedList does not use the shared classifier');
  ok(!/d\.status === 'open'/.test(body),  'the narrow reading is still there');
  ok(!/d\.status !== 'open'/.test(body),  'the inverse narrow reading is still there');
});

t('B3 [source] the shared helpers delegate rather than restate', () => {
  const i = SRC.script.indexOf('function _disputeIsOpen');
  const body = SRC.script.slice(i, i + 420);
  ok(/window\.DisputeStatus/.test(body), '_disputeIsOpen does not read the authority');
  ok(/DS\.isOpen\(d\)/.test(body),       '_disputeIsOpen does not call isOpen');
});

t('B4 [source] every script.js dispute COUNT routes through the helpers', () => {
  // Whatever remains must be a comment, the helper fallback itself, or one of
  // the two documented non-count readings pinned in section G.
  const lines = SRC.script.split('\n')
    .map((l, n) => ({ n: n + 1, l }))
    .filter(x => /status === 'open'|status !== 'open'/.test(x.l))
    .filter(x => !/d\.status === 'open' \|\| d\.status === 'docs_requested'/.test(x.l))
    .filter(x => !/const isOpen   = d\.status === 'open';/.test(x.l))
    .filter(x => !/const statusLabel = d\.status === 'open' \? 'Open'/.test(x.l));
  eq(lines.length, 0, 'unconverted count(s): ' + JSON.stringify(lines));
});

[['selectors.js', 'sel'], ['command-center.js', 'cc'], ['lease-review-packets.js', 'lrp'],
 ['acquisition-engine.js', 'acq']].forEach(([file, key], i) => {
  t(`B${5 + i} [source] ${file} counts through the authority`, () => {
    const src = SRC[key];
    ok(/DisputeStatus/.test(src), `${file} never reaches for the authority`);
    ok(/DS\.isOpen/.test(src),    `${file} does not call isOpen`);
    const bad = src.split('\n').filter(l =>
      /status === 'open'|status !== 'open'/.test(l) &&
      !/status === 'open' \|\| d\.status === 'docs_requested'/.test(l));
    eq(bad.length, 0, `${file} still counts narrowly: ` + JSON.stringify(bad));
  });
});

t('B9 [source] the two surfaces the walkthrough compared read the same rule', () => {
  // property-workspace (Overview) was already right; selectors (the card KPI
  // it deliberately stopped trusting) is the half this slice fixed.
  ok(/DS\.tally\(_disp\)\.open/.test(SRC.pw), 'the Overview panel stopped using tally()');
  ok(/\(prop\.disputes \|\| \[\]\)\.filter\(_isOpenDispute\)/.test(SRC.sel),
     'buildPropMeta no longer routes through the shared predicate');
});

// ── C — closed and unknown are kept apart ─────────────────────────────────
H('C · docs_requested, closed and unknown each read honestly');

t('C1 a docs_requested dispute is never labelled Resolved on the CAM list', () => {
  const body = fnBody(SRC.script, 'function renderOpenDisputes');
  // The badge text may still say "Docs Requested" — that is its status. What
  // must not happen is it landing in the resolved GROUP.
  ok(/const resolvedList = disputes\.filter\(d => _disputeClass\(d\) === 'closed'\)/.test(body),
     'the resolved group can still take an open dispute');
});

t('C2 an unrecognised status gets its own group, not the resolved one', () => {
  const body = fnBody(SRC.script, 'function renderOpenDisputes');
  ok(/const unknownList  = disputes\.filter\(d => _disputeClass\(d\) === 'unknown'\)/.test(body),
     'unknown disputes are not separated');
  ok(/disputes-unknown-head/.test(body), 'the unknown group has no heading');
  ok(/Unrecognised status/.test(body),   'the unknown heading does not say so');
});

t('C3 the unknown heading is styled rather than invisible', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  ok(/\.disputes-unknown-head\s*\{/.test(html), 'no .disputes-unknown-head rule');
});

t('C4 the "Disputes Resolved" counter counts only closed disputes', () => {
  const body = fnBody(SRC.script, 'function renderOpenDisputes');
  ok(/resolvedCount'\)\.textContent = resolvedList\.length/.test(body),
     'the resolved counter reads something other than the closed group');
  eq(FIXTURE.filter(d => DS.classify(d.status) === 'closed').length, EXPECT.closed);
});

t('C5 the statement pill colours by open/closed and names the real status', () => {
  const i = SRC.script.indexOf("const statusLabel = d.status === 'open' ? 'Open'");
  const body = SRC.script.slice(i, i + 700);
  ok(/_disputeIsOpen\(d\) \? 'open' : 'closed'/.test(body),
     'the pill still colours a docs_requested dispute as closed');
  ok(/Unrecognised \(/.test(body),
     'an unknown status is still printed as "Docs Requested" by the trailing else');
});

// ── D — scoping ───────────────────────────────────────────────────────────
H('D · a tenant’s count is that tenant’s');

t('D1 the tenant-scoped helper filters by tenant AND by openness', () => {
  const i = SRC.script.indexOf('function _openDisputes');
  const body = SRC.script.slice(i, i + 300);
  ok(/_disputeIsOpen\(d\)/.test(body),        'the scoped helper does not apply the shared rule');
  ok(/tenantName == null \|\| d\.tenantName === tenantName/.test(body),
     'the scoped helper does not scope');
});

t('D2 scoping does not leak another tenant’s dispute', () => {
  const mine = FIXTURE.filter(d => DS.isOpen(d) && d.tenantName === 'Whole Health Market');
  eq(mine.length, 1);
  eq(mine[0].status, 'docs_requested');
  const other = FIXTURE.filter(d => DS.isOpen(d) && d.tenantName === 'FitZone Athletics');
  eq(other.length, 0, 'a closed dispute was counted as the tenant’s open one');
});

t('D3 TenantSpace still scopes by identity, unchanged by this slice', () => {
  ok(/DS\.isOpen/.test(SRC.ts) || /docs_requested/.test(SRC.ts),
     'tenant-space stopped using the shared rule');
  ok(/noIdentity \? \[\] :/.test(SRC.ts),
     'the id-less space guard was disturbed');
});

// ── E — empty, and nothing invented ───────────────────────────────────────
H('E · the empty case, and no dispute invented');

t('E1 no disputes ⇒ every bucket zero', () => {
  const x = DS.tally([]);
  assert.deepStrictEqual(x, { total: 0, open: 0, closed: 0, unknown: 0, unknownStatuses: [] });
});
t('E2 a null/garbage entry is skipped, not counted', () => {
  const x = DS.tally([null, undefined, false, 0]);
  eq(x.total, 0, 'a falsy entry became a dispute');
});
t('E3 an all-closed list reports 0 open and invents nothing', () => {
  const closed = FIXTURE.filter(d => DS.classify(d.status) === 'closed');
  eq(DS.tally(closed).open, 0);
  eq(DS.tally(closed).unknown, 0);
});
t('E4 the CAM list renders no group it has no disputes for', () => {
  const body = fnBody(SRC.script, 'function renderOpenDisputes');
  ok(/if \(openList\.length\)/.test(body),     'the open group renders unconditionally');
  ok(/if \(resolvedList\.length\)/.test(body), 'the resolved group renders unconditionally');
  ok(/if \(unknownList\.length\)/.test(body),  'the unknown group renders unconditionally');
});

// ── F — Ask AI ────────────────────────────────────────────────────────────
H('F · Ask AI consumes the same authority');

global.window   = global.window   || {};
global.document = global.document || { addEventListener: function () {} };
require('./ai-workspace.js');
const AIW = global.window.AIWorkspace;

const PROP = { id: 'p1', name: 'Cascade Commons', tenants: [], invoices: [], disputes: FIXTURE };
const askDisputes = () => AIW.answer({
  question: 'Show me the disputes', context: { propertyId: 'p1' },
  props: [PROP], deps: { DisputeStatus: DS },
});

t('F1 the dispute intent answers', () => eq(askDisputes().intent, 'disputes'));

t('F2 it counts 2 awaiting a decision — docs_requested included', () => {
  const a = askDisputes();
  const text = (a.paragraphs || []).join(' ');
  ok(/2 disputes need a decision/.test(text), text);
});

t('F3 the open bullets name both open tenants and neither closed one', () => {
  const b = (askDisputes().bullets || []).join(' | ');
  ok(/Whole Health Market/.test(b), b);
  ok(/Summit Coffee/.test(b), b);
  ok(!/FitZone/.test(b), 'a closed dispute was listed as awaiting a decision');
});

t('F4 an unrecognised status is reported, not filed under resolved history', () => {
  const a = askDisputes();
  const text = (a.paragraphs || []).join(' ');
  ok(/does not recognise/.test(text), text);
  const hist = (text.match(/Resolved history: [^.]*/) || [''])[0];
  ok(!/Corner Market/.test(hist), 'the unknown dispute was called resolved: ' + hist);
});

t('F5 [source] the AI asks the authority rather than restating it', () => {
  const i = SRC.ai.indexOf("id: 'disputes'");
  const body = SRC.ai.slice(i, i + 1800);
  ok(/_classOf\(d\)/.test(body), 'the dispute intent classifies inline again');
  ok(!/d\.status === 'open' \|\| d\.status === 'docs_requested'/.test(body),
     'the restatement is still in the handler');
  ok(/DisputeStatus:\s*window\.DisputeStatus \|\| null/.test(SRC.ai),
     'the authority is not injectable, so the headless answer differs from the browser');
});

// ── G — the deliberate exceptions stay deliberate ─────────────────────────
H('G · guards are guards, and counts are counts');

t('G1 the dispute-workspace editability gate is still status-narrow, on purpose', () => {
  ok(/const isOpen   = d\.status === 'open';/.test(SRC.script),
     'the editability gate was widened — that is a product rule, not a count');
});

t('G2 and the decisions beside it come from the lifecycle table', () => {
  const i = SRC.script.indexOf("const isOpen   = d.status === 'open';");
  const body = SRC.script.slice(i, i + 900);
  ok(/const nextStates = DISPUTE_TRANSITIONS\[d\.status\] \|\| \[\]/.test(body),
     'the panel stopped reading the transition table');
});

t('G3 THE DEAD CONTROL IS GONE: _dwResolveWithNote gates on the table', () => {
  const i = SRC.script.indexOf('async function _dwResolveWithNote');
  const body = SRC.script.slice(i, i + 600);
  ok(!/d\.status !== 'open'/.test(body),
     'a docs_requested dispute can still have its Accept click silently dropped');
  ok(/DISPUTE_TRANSITIONS\[d\.status\]/.test(body), 'the guard does not read the table');
  ok(/_allowed\.includes\(resolution\)/.test(body), 'the guard does not check the resolution');
});

t('G4 the card offers exactly the decisions the table permits', () => {
  const body = fnBody(SRC.script, 'function renderOpenDisputes');
  // EACH BUTTON, gated — not "the phrase appears somewhere in the function".
  // The first version of this assertion only checked for the substring, and a
  // mutant that ungated the Request Documentation button survived because the
  // hidden attach-panel below it still carried the same phrase.
  const gated = [
    [/\$\{nextStates\.includes\('accepted'\) \? `<button class="d-res-btn accept"/,     'Accept'],
    [/\$\{nextStates\.includes\('rejected'\) \? `<button class="d-res-btn reject"/,     'Reject'],
    [/\$\{nextStates\.includes\('docs_requested'\) \? `<button class="d-res-btn docs"/, 'Request Documentation'],
    [/\$\{nextStates\.includes\('docs_requested'\) \? `\s*\n?\s*<div id="docs-req-/,    'the attach panel'],
  ];
  gated.forEach(([re, label]) => ok(re.test(body), `${label} is not gated on the transition table`));
});

t('G5 and the engine still refuses anything the table forbids', () => {
  const i = SRC.script.indexOf('async function resolveDispute');
  const body = SRC.script.slice(i, i + 400);
  ok(/allowed\.includes\(resolution\)/.test(body),
     'resolveDispute stopped enforcing the transition table');
});

t('G6 script.js still reads ONE transition table, not a second copy', () => {
  ok(/const DISPUTE_TRANSITIONS = \(window\.DisputeStatus && window\.DisputeStatus\.TRANSITIONS\)/
     .test(SRC.script), 'script.js grew its own lifecycle table again');
});

// ── Z — self-checks ───────────────────────────────────────────────────────
H('Z · self-checks');

t('Z1 the fixture actually spans all three classes', () => {
  const x = DS.tally(FIXTURE);
  ok(x.open > 0 && x.closed > 0 && x.unknown > 0, JSON.stringify(x));
});
t('Z2 the source reads are comment-stripped', () => {
  ok(!/THE DEFECT THIS EXISTS FOR/.test(SRC.script), 'block comments survived');
  ok(!/one definition of an open dispute, read at call time/.test(SRC.sel),
     'line/block comments survived in selectors.js');
});
t('Z3 every module under test actually loaded', () => {
  Object.entries(SRC).forEach(([k, v]) => ok(v.length > 200, k + ' is empty'));
  eq(typeof AIW.answer, 'function');
});

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
  `${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
