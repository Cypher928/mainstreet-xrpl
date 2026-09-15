'use strict';
/**
 * test-billing-blocker-visibility.js — "Not ready to bill" must say what on.
 *
 *   node test-billing-blocker-visibility.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * A manager-walkthrough of the Cascade Commons demo reached the CAM screen and
 * read:
 *
 *     0 of 5 tenants billable   ⛔ Not ready to bill
 *
 * and nothing else. The reason sat in a `title=` tooltip, and even that was a
 * COUNT — "1 property-level exception must be resolved" — never the exception.
 * The one screen that named it was the tenant statement:
 *
 *     PROPERTY-WIDE · 26 of 26 invoices missing source document · Weakly Evidenced
 *
 * which a manager only reaches by trying to bill and being refused. Asking the
 * product directly did not help either: every natural phrasing of the question
 * ("why is this reconciliation blocked?", "why are 0 of 5 tenants billable?",
 * "what is holding up billing?", "why can't I bill these tenants?") fell
 * through to the honest fallback — "I couldn't map that question to your data".
 *
 * ROOT CAUSE, and it is one line of behaviour, not a missing feature:
 * billingReadiness() has TWO branches. The tenant branch returns `blockers`,
 * which is why the statement can name the exception. The PROPERTY branch —
 * the one the CAM screen calls — returned the tally and dropped the records it
 * had just counted. The information existed, derived, one property away from
 * the screen that needed it.
 *
 * WHAT THIS PINS
 *   A  the property verdict carries the records it counts
 *   B  the CAM surface renders them, and renders nothing when billing is clear
 *   C  Ask AI answers each phrasing from that same verdict
 *   D  no fabrication: no invented cause, no citation claiming a captured source
 *   E  the tenant statement path is untouched
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const AX = require('./audit-exposure.js');

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
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*<!--[\s\S]*?-->/gm, '');
const scriptCode = code('script.js');
const aiCode     = code('ai-workspace.js');
const axCode     = code('audit-exposure.js');
const htmlSrc    = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── findings shaped exactly as the detectors emit them ──────────────────────
//
// The missing-source-document detector emits RED at 100% and YELLOW below it,
// which is why the demo is blocked and a half-documented property is not.
const missingDocs = (missing, total) => ({
  group: 'missing_docs',
  severity: missing === total ? 'red' : 'yellow',
  title: `${missing} of ${total} invoice${missing > 1 ? 's' : ''} missing source document`,
  conditions: [`Invoices missing attachments: ${missing} of ${total}`],
  impact: { amount: 188300, kind: 'unsubstantiated',
            items: [{ id: 'invoice:Meridian', amount: 188300 }] },
});
const grossCam = (name) => ({
  severity: 'yellow', blocksBilling: true,
  title: `Modified Gross tenant receiving shared CAM — ${name} ($26,721.55)`,
  conditions: [`Tenant: ${name}`, 'Lease type: Modified Gross'],
});
const expiredLease = (name) => ({
  title: `${name} is being billed 2026 CAM on a lease that ended 2016-02-28`,
  conditions: [`Tenant: ${name}`, 'Lease end date: 2016-02-28'],
});
const yoy = () => ({ blocksBilling: false, title: 'Total CAM increased 24.0% year-over-year', conditions: [] });

const exposure = (red, yellow) =>
  AX.deriveExposure({ red: red || [], yellow: yellow || [], green: [] }, 188300);

// The demo's own shape: every invoice undocumented (property-wide, red) plus
// one Modified Gross tenant holding its own statement (tenant, yellow).
const CASCADE = exposure([missingDocs(26, 26)], [grossCam('ProActive Physical Therapy')]);

console.log('\n══ Billing blocker visibility ══');

// ── A — the property verdict carries what it counts ────────────────────────
H('A · the property verdict names its blockers, not just a count');

t('A1 blocked billing with missing source documents reports the exception', () => {
  const r = AX.billingReadiness(CASCADE);
  eq(r.canBill, false);
  eq(r.label, 'Not ready to bill');
  ok(Array.isArray(r.blockers), 'the property verdict returned no blockers array');
  const titles = r.blockers.map(b => b.title);
  ok(titles.some(x => /26 of 26 invoices missing source document/.test(x)),
     'the blocking exception is not named: ' + JSON.stringify(titles));
});

t('A2 and carries the tenant-scoped blocker alongside it', () => {
  const r = AX.billingReadiness(CASCADE);
  eq(r.blockers.length, 2);
  const prop = r.blockers.filter(b => b.scope === 'property');
  const ten  = r.blockers.filter(b => b.scope === 'tenant');
  eq(prop.length, 1);
  eq(ten.length, 1);
  eq(ten[0].tenant, 'ProActive Physical Therapy');
});

t('A3 the count in the reason still matches the property-scoped records', () => {
  const r = AX.billingReadiness(CASCADE);
  const n = r.blockers.filter(b => b.scope === 'property').length;
  ok(new RegExp(`^${n} property-level exception`).test(r.reason), r.reason);
});

t('A4 MULTIPLE property blockers are all reported, none dropped', () => {
  const x = exposure([missingDocs(26, 26), expiredLease('Anchor Foods'), yoy()], []);
  const r = AX.billingReadiness(x);
  const titles = r.blockers.map(b => b.title);
  ok(titles.some(s => /missing source document/.test(s)), titles.join(' | '));
  ok(titles.some(s => /lease that ended/.test(s)),        titles.join(' | '));
  // yoy() declares blocksBilling:false — a finding that does not block must
  // never be listed as a reason billing is held.
  ok(!titles.some(s => /year-over-year/.test(s)),
     'a non-blocking finding was reported as a blocker: ' + titles.join(' | '));
});

t('A5 NO FABRICATED BLOCKER when billing is actually ready', () => {
  const clean = exposure([], []);
  const r = AX.billingReadiness(clean);
  eq(r.canBill, true);
  eq(r.label, 'Ready to bill');
  eq((r.blockers || []).length, 0, 'a clear reconciliation reported blockers');
});

t('A6 nor on "Bill with review", where findings exist but none blocks', () => {
  const r = AX.billingReadiness(exposure([], [missingDocs(3, 26)]));
  eq(r.canBill, true);
  eq(r.label, 'Bill with review');
  eq((r.blockers || []).length, 0, 'an advisory finding was reported as a blocker');
});

t('A7 a tenant-only block still names the tenant records', () => {
  const r = AX.billingReadiness(exposure([], [grossCam('ProActive Physical Therapy')]));
  eq(r.canBill, false);
  ok(/1 tenant cannot be billed yet/.test(r.reason), r.reason);
  eq(r.blockers.length, 1);
  eq(r.blockers[0].tenant, 'ProActive Physical Therapy');
});

t('A8 the tenant verdict is unchanged — the statement asks the same question', () => {
  const mine = AX.billingReadiness(CASCADE, 'ProActive Physical Therapy');
  eq(mine.canBill, false);
  eq(mine.blockers.length, 2);      // 1 property + its own
  const other = AX.billingReadiness(CASCADE, 'Whole Health Market');
  eq(other.canBill, false);         // held by the property-wide exception
  eq(other.blockers.length, 1);
  eq(other.blockers[0].scope, 'property');
});

t('A9 [source] the blockers are the records deriveExposure already tallied', () => {
  const i = axCode.indexOf('function billingReadiness');
  const body = axCode.slice(i, axCode.indexOf('\n  }', i));
  ok(/const tenantFlat = Object\.keys\(bl\.byTenant/.test(body),
     'the property branch builds its list from somewhere other than bl.byTenant');
  ok(/allBlockers = prop\.concat\(tenantFlat\)/.test(body),
     'the property blockers are not prop + the tenant tally');
  // A second walk over the findings would be a second calculation.
  ok(!/findings|buckets|severityOf\(/.test(body),
     'billingReadiness re-reads the findings instead of the tally');
});

// ── B — the CAM surface renders them ───────────────────────────────────────
H('B · the CAM screen names the blocker where the manager is stuck');

t('B1 the reconciliation summary renders a hold block from the verdict', () => {
  ok(/rcs-held/.test(scriptCode), 'no hold block is rendered on the CAM summary');
  const i = scriptCode.indexOf('rcs-held-head');
  ok(i !== -1, 'the hold block has no heading');
  const around = scriptCode.slice(Math.max(0, i - 2500), i + 1500);
  ok(/Why billing is on hold/.test(around), 'the hold block is not labelled for a manager');
});

t('B2 it reads _billing.blockers — the same verdict the badge reads', () => {
  const i = scriptCode.indexOf('const _bl = _billing.blockers');
  ok(i !== -1, 'the hold block does not read the rendered verdict');
  const body = scriptCode.slice(i, i + 2200);
  // Not a second derivation: no deriveExposure / buildAuditSummary here.
  ok(!/deriveExposure|buildAuditSummary/.test(body),
     'the hold block derives its own exposure instead of reusing the verdict');
});

t('B3 it renders ONLY when billing is blocked', () => {
  const i = scriptCode.indexOf('const _bl = _billing.blockers');
  const before = scriptCode.slice(Math.max(0, i - 400), i);
  ok(/if \(!_billing \|\| _billable\) return ''/.test(before),
     'the hold block does not stand down when the reconciliation is billable');
});

t('B4 and renders nothing rather than an empty panel when nothing is named', () => {
  const i = scriptCode.indexOf('const _bl = _billing.blockers');
  const after = scriptCode.slice(i, i + 300);
  ok(/if \(!_bl\.length\) return ''/.test(after),
     'an empty blocker list would still draw the panel');
});

t('B5 every blocker is listed — no slice, no "top" one', () => {
  const i = scriptCode.indexOf('const _bl = _billing.blockers');
  const body = scriptCode.slice(i, i + 2200);
  ok(/_prop\.map\(_row\)/.test(body) && /_ten\.map\(_row\)/.test(body),
     'the hold block does not map every blocker');
  ok(!/\.slice\(0,\s*\d\)/.test(body), 'the hold block truncates the blocker list');
  ok(!/\.sort\(/.test(body), 'the hold block re-orders findings, inventing priority');
});

t('B6 the scope label is read off the record, not guessed from the text', () => {
  const i = scriptCode.indexOf('const _row = (b) =>');
  const body = scriptCode.slice(i, i + 900);
  ok(/b\.scope === 'property'/.test(body), 'scope is not read from the blocking record');
});

t('B7 titles are escaped — a finding carries vendor and tenant text', () => {
  const i = scriptCode.indexOf('const _row = (b) =>');
  const body = scriptCode.slice(i, i + 900);
  ok(/esc\(_title\)/.test(body), 'the blocker title is interpolated unescaped');
  ok(/esc\(_label\)/.test(body), 'the scope label is interpolated unescaped');
});

t('B8 the hold block is styled — not invisible markup', () => {
  ok(/\.rcs-held\s*\{/.test(htmlSrc),   'no .rcs-held rule');
  ok(/\.rcs-held-list\s*\{/.test(htmlSrc), 'no .rcs-held-list rule');
  ok(/\.rcs-held-scope--prop\s*\{/.test(htmlSrc), 'no property-scope chip rule');
});

t('B9 the verdict on screen is captured for Ask AI, not recomputed for it', () => {
  ok(/_lastBillingVerdict = _billing \?/.test(scriptCode),
     'the rendered verdict is never captured');
  ok(/window\.billingVerdictOnScreen = function/.test(scriptCode),
     'the captured verdict is not reachable');
  const i = scriptCode.indexOf('_lastBillingVerdict = _billing ?');
  const body = scriptCode.slice(i, i + 400);
  ok(/readiness:\s*_billing/.test(body), 'the capture stores something other than the verdict');
  // Not merely "a propertyId key exists" — `propertyId: null` satisfies that
  // and loses the scoping the cross-property refusal depends on.
  ok(/propertyId:\s*\(currentProperty\(\) \|\| \{\}\)\.id/.test(body),
     'the capture does not record WHICH property it describes');
  ok(/propertyName:\s*\(currentProperty\(\) \|\| \{\}\)\.name/.test(body),
     'the capture cannot name the property it describes');
});

t('B10 and it is cleared when the workflow resets', () => {
  // The DECLARATION is `let _lastBillingVerdict = null;`, so a bare search for
  // that assignment is satisfied without any reset existing at all. Count them:
  // one declaration plus one reset.
  const hits = (scriptCode.match(/_lastBillingVerdict = null;/g) || []).length;
  eq(hits, 2, 'a stale verdict can outlive the reconciliation it describes');
  const i = scriptCode.indexOf('_lastReconIssues = []; _dwActiveDid = null;');
  ok(i !== -1, 'the workflow reset moved');
  ok(/_lastBillingVerdict = null;/.test(scriptCode.slice(i, i + 400)),
     'the verdict is not cleared where the rest of the run state is');
});

// ── C — Ask AI answers, from that same verdict ─────────────────────────────
H('C · Ask AI answers the question the CAM screen provokes');

// A headless AIWorkspace. ai-workspace.js is a browser script — it assigns to
// `window.AIWorkspace` and registers one delegated click handler at load — so
// the two globals it touches on the way in are stubbed. Nothing else is
// faked: `answer()` itself is pure, and the verdict it reads arrives through
// the injected dep, which is the whole point of that dep existing.
global.window   = global.window   || {};
global.document = global.document || { addEventListener: function () {} };
require('./ai-workspace.js');
const AIW = global.window.AIWorkspace;

const PROP = { id: 'p-cascade', name: 'Cascade Commons', tenants: [], invoices: [], disputes: [] };
const VERDICT = {
  propertyId: 'p-cascade', propertyName: 'Cascade Commons',
  readiness: AX.billingReadiness(CASCADE),
  billableNames: [], tenantCount: 5,
};
const askWith = (verdict) => (question) => AIW.answer({
  question, context: { propertyId: 'p-cascade' }, props: [PROP],
  deps: { billingVerdict: () => verdict },
});
const ask = askWith(VERDICT);

const PHRASINGS = [
  'Why is this reconciliation blocked?',
  'Why are 0 of 5 tenants billable?',
  'What is holding up billing?',
  "Why can't I bill these tenants?",
  "Why can't I bill this reconciliation?",
  'What is holding up billing at Cascade Commons?',
  'Why is billing blocked?',
  'What is preventing billing?',
];

PHRASINGS.forEach((q, i) => {
  t(`C${i + 1} "${q}" is answered, not deflected`, () => {
    const a = ask(q);
    eq(a.intent, 'billing_blocked', `routed to "${a.intent}" instead`);
    const text = JSON.stringify(a);
    ok(/26 of 26 invoices missing source document/.test(text),
       'the answer does not name the blocking exception');
  });
});

t('C9 the answer reports the tenant-scoped blocker too', () => {
  const a = ask('Why is this reconciliation blocked?');
  const text = (a.bullets || []).join(' | ');
  ok(/Modified Gross tenant receiving shared CAM/.test(text), text);
  ok(/ProActive Physical Therapy/.test(text), text);
});

t('C10 and states the billable count from the verdict, not from a guess', () => {
  const a = ask('What is holding up billing?');
  const text = (a.paragraphs || []).join(' ');
  ok(/0 of 5 tenants can be billed/.test(text), text);
});

t('C11 the trace names the authoritative engine', () => {
  const a = ask('Why is this reconciliation blocked?');
  ok(/Audit Exposure/.test(JSON.stringify(a.trace || a)), JSON.stringify(a.trace));
});

t('C12 NOT ROUTED when the question is about something else', () => {
  ['Which tenants have CAM caps?', 'Which leases expire next year?',
   'Explain this reconciliation', 'Show reserve balances'].forEach(q => {
    const a = ask(q);
    ok(a.intent !== 'billing_blocked', `"${q}" was hijacked by the blocker intent`);
  });
});

// ── D — no fabrication ─────────────────────────────────────────────────────
H('D · nothing is invented when the answer is not available');

t('D1 no reconciliation on screen → says so, does NOT say billing is clear', () => {
  const a = askWith(null)('Why is this reconciliation blocked?');
  eq(a.intent, 'billing_blocked');
  const text = JSON.stringify(a);
  ok(/no reconciliation|none has been run/i.test(text), text.slice(0, 300));
  ok(!/nothing is blocking|ready to bill/i.test(text),
     'absence of a verdict was reported as an all-clear');
});

t('D2 a verdict about another property is refused, not repurposed', () => {
  const other = Object.assign({}, VERDICT, { propertyId: 'p-other', propertyName: 'Harborview' });
  const a = askWith(other)('Why is this reconciliation blocked?');
  const text = JSON.stringify(a);
  ok(/isn.t Cascade Commons|Harborview/.test(text), text.slice(0, 300));
  ok(!/26 of 26 invoices/.test(text),
     "another property's blocker was reported as this property's");
});

t('D3 a clear reconciliation is reported clear, with no invented blocker', () => {
  const clear = { propertyId: 'p-cascade', propertyName: 'Cascade Commons',
                  readiness: AX.billingReadiness(exposure([], [])),
                  billableNames: ['A', 'B', 'C', 'D', 'E'], tenantCount: 5 };
  const a = askWith(clear)('Why is this reconciliation blocked?');
  const text = JSON.stringify(a);
  ok(/nothing is blocking billing/i.test(text), text.slice(0, 300));
  ok(!(a.bullets || []).length, 'a clear reconciliation produced blocker bullets');
});

t('D4 a blocked verdict that named nothing does not get a cause invented', () => {
  const vague = { propertyId: 'p-cascade', propertyName: 'Cascade Commons',
                  readiness: { canBill: false, label: 'Not ready to bill',
                               reason: '1 property-level exception must be resolved.', blockers: [] },
                  billableNames: [], tenantCount: 5 };
  const a = askWith(vague)('Why is this reconciliation blocked?');
  const text = JSON.stringify(a);
  ok(/did not name the individual exceptions/i.test(text), text.slice(0, 400));
  ok(!(a.bullets || []).length, 'bullets were manufactured from an empty blocker list');
});

t('D5 NO CITATION is attached — this is a derived verdict, not a quoted clause', () => {
  [ask('Why is this reconciliation blocked?'),
   askWith(null)('What is holding up billing?')].forEach(a => {
    eq((a.citations || []).length, 0,
       'the blocker answer attaches a citation, claiming a source it did not read');
  });
});

t('D6 [source] the intent never reaches for generic knowledge or a second derivation', () => {
  const i = aiCode.indexOf("id: 'billing_blocked'");
  ok(i !== -1, 'the intent is not registered');
  const body = aiCode.slice(i, aiCode.indexOf("id: 'explain_recon'", i));
  ok(/deps && deps\.billingVerdict/.test(body), 'the intent does not read the rendered verdict');
  ok(!/deriveExposure|buildAuditSummary|_detectReconciliationIssues/.test(body),
     'the intent derives its own exposure rather than reusing the verdict');
  ok(!/citations: \[_/.test(body), 'the intent builds a citation chip');
});

t('D7 [source] the verdict getter is injectable, so it is never assumed present', () => {
  ok(/billingVerdict:\s*window\.billingVerdictOnScreen \|\| null/.test(aiCode),
     'the dep is not declared with a null fallback');
  const i = aiCode.indexOf("id: 'billing_blocked'");
  const body = aiCode.slice(i, aiCode.indexOf("id: 'explain_recon'", i));
  ok(/typeof getter === 'function'/.test(body), 'a missing getter would throw');
  ok(/catch \(_\) \{ return null; \}/.test(body), 'a throwing getter would take the answer down');
});

// ── E — the statement path is untouched ────────────────────────────────────
H('E · the tenant-statement refusal screen is unchanged');

t('E1 the gate still asks the TENANT question', () => {
  const i = scriptCode.indexOf('function _statementReadinessBlock');
  const body = scriptCode.slice(i, scriptCode.indexOf('\n}', i));
  ok(/billingReadiness\(exposure, tenantName\)/.test(body),
     'the statement gate no longer asks the tenant question');
  ok(/readiness\.blockers/.test(body), 'the gate stopped reading the blocking set');
});

t('E2 the refusal wording is still there', () => {
  // Rendered in sentence case and upper-cased by the stylesheet, which is why
  // this reads the source rather than the screen.
  eq((scriptCode.match(/This statement has not been issued/g) || []).length, 2,
     'the statement refusal headline is gone or duplicated');
  ok(/must not be sent to a tenant/.test(scriptCode),
     'the non-billable draft warning is gone');
});

t('E3 a tenant with no blockers of its own still reads property-level', () => {
  const r = AX.billingReadiness(CASCADE, 'Whole Health Market');
  ok(/property-level exception/.test(r.reason), r.reason);
  eq(r.blockers.filter(b => b.scope === 'property').length, 1);
});

// ── Z — the suite tested what it thinks it did ─────────────────────────────
H('Z · self-checks');

t('Z1 the fixture really is blocked', () => {
  eq(AX.billingReadiness(CASCADE).canBill, false);
  eq(CASCADE.blocking.property.length, 1);
  eq(Object.keys(CASCADE.blocking.byTenant).length, 1);
});

t('Z2 the source read is comment-stripped', () => {
  ok(!/THE DEFECT THIS EXISTS FOR/.test(scriptCode), 'block comments survived stripping');
  ok(!/Why billing is on hold, the blocking exceptions/.test(scriptCode),
     'line comments survived stripping');
});

t('Z3 AIWorkspace and AuditExposure both loaded', () => {
  eq(typeof AIW.answer, 'function');
  eq(typeof AX.billingReadiness, 'function');
});

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
  `${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
