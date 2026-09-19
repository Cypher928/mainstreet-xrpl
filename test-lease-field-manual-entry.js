'use strict';
/**
 * test-lease-field-manual-entry.js — a field the AI could not read can be
 * entered by hand, and the record says a person entered it.
 *
 *   node test-lease-field-manual-entry.js
 *
 * THE TWO DEFECTS THIS PINS
 * -------------------------
 * 1. "Edit Fields" in the Lease Review Workspace opened openTenantDetailPanel,
 *    which is a READ-ONLY sheet — every lease value in it is a
 *    <div class="tdp-stat-value"> and a field the extraction missed renders as
 *    an em-dash. So the workspace listed each gap, offered a button labelled
 *    Edit Fields, and delivered a page with nothing to type into. The fields
 *    were editable all along, on the lease intake card; this was the one review
 *    path that did not go there.
 *
 * 2. Seven of the eight intake-card fields blurred through handleFieldBlur,
 *    which writes the value and nothing else. FieldProvenance's floor branch
 *    then reported a hand-typed square footage as
 *
 *        state ai_extracted · method "AI Extraction" · sourceFile <the lease>
 *
 *    crediting a model for a number it never produced, and naming a document
 *    that does not contain it. Measured against the real module before the fix.
 *
 * WHAT THIS SUITE IS NOT
 * ----------------------
 * It is not a second provenance mechanism and it does not test one. Every
 * assertion below runs the EXISTING chain — handleProvenancedFieldBlur →
 * saveFieldOverride → persistFieldEvidence → FieldProvenance — lifted out of
 * script.js and run over real tenant records. The storage boundary is the
 * product's own _stripBlobs and normalizeTenant, so "survives a reload" means
 * what the product means by it, not what a fixture asserts.
 */

const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;
const scriptSrc = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const FP = require(path.join(ROOT, 'field-provenance.js'));
const { normalizeTenant } = require(path.join(ROOT, 'tenant-normalize.js'));

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const eq  = (a, b, m) => (a === b ? ok(m) : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const truthy = (v, m, d) => v ? ok(m) : bad(m, d || ('expected truthy, got ' + JSON.stringify(v)));
const falsy  = (v, m, d) => !v ? ok(m) : bad(m, d || ('expected falsy, got ' + JSON.stringify(v)));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

function extract(pattern, label) {
  const m = scriptSrc.match(pattern);
  if (!m) throw new Error(`${label} not found in script.js`);
  return m[0];
}
/** Comments must never satisfy a source assertion. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** The real edit chain, over a real tenant. Nothing under test is stubbed. */
function loadChain() {
  const src = [
    extract(/\nconst _FIELD_STORAGE  = \{[\s\S]*?\nfunction _fieldCanonical\(k\) \{[^\n]*\n/, 'field key maps'),
    extract(/\nfunction _mkEvidenceSnapshot\(fieldKey, t, opts\) \{[\s\S]*?\n\}\n/, '_mkEvidenceSnapshot'),
    extract(/\nfunction persistFieldEvidence\(tenantId, fieldKey, opts\) \{[\s\S]*?\n\}\n/, 'persistFieldEvidence'),
    // EXTRACTED BY NAME, NOT BY SIGNATURE. This named all three parameters, and
    // the function gained an optional fourth — so the suite stopped finding it
    // and died on load. That is the exact failure the coverage manifest opens
    // with (test-smoke-fixes.js, six assertions silently unevaluated).
    extract(/\nfunction saveFieldOverride\([^)]*\) \{[\s\S]*?\n\}\n/, 'saveFieldOverride'),
    extract(/\nfunction handleProvenancedFieldBlur\(index, field, value, el\) \{[\s\S]*?\n\}\n/, 'handleProvenancedFieldBlur'),
    extract(/\nfunction handleFieldBlur\(index, field, value, el\) \{[\s\S]*?\n\}\n/, 'handleFieldBlur'),
    extract(/\nfunction updateTenantField\(index, field, value\) \{[\s\S]*?\n\}\n/, 'updateTenantField'),
    extract(/\nfunction getEffectiveLeaseField\(fieldName, t\) \{[\s\S]*?\n\}\n/, 'getEffectiveLeaseField'),
    extract(/\nfunction _extractionVersionTag\(t\) \{[\s\S]*?\n\}\n/, '_extractionVersionTag'),
  ].join('\n');

  const calls = { evidenceWrites: [], auditRows: [], activity: [], timeline: [], saves: 0, renders: 0 };
  const REVIEWER = { id: 'uid-77', email: 'manager@mainstreet.example' };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    isNaN, parseFloat, parseInt, Set, Map, setTimeout,
    tenantData: [], lastResults: [], isEditingField: false,
    savePropertyData() { calls.saves++; },
    _updateStaleResultsBanner() {},
    _resultsStale: false,
    currentProperty: () => ({ id: 'p1', tenants: sandbox.tenantData }),
    deriveTenantReviewState: () => ({ status: 'complete' }),
    _props: [], activePropId: 'p1',
    rebuildDerivedState() {},
    appendPropertyTimelineEvent: (p, e) => calls.timeline.push(e),
    renderBulkResults() { calls.renders++; },
    _refreshLfcExpansion() {},
    showToast() {},
    logActivity: (type, label, meta) => calls.activity.push({ type, label, meta }),
    appendReviewAuditEntry: (e) => calls.auditRows.push(e),
    _writeTenantFieldEvidence: (p, tid, fk, snap) =>
      calls.evidenceWrites.push({ propId: p, tenantId: tid, fieldKey: fk, snapshot: snap }),
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.window.AuthService = { getCurrentUser: () => REVIEWER };
  sandbox.window.FieldProvenance = FP;
  vm.createContext(sandbox);
  vm.runInContext(
    'function getFieldConfidence(f, t){ return { status: "manual", note: "Manually entered" }; }\n' + src,
    sandbox, { filename: 'edit-chain' });
  return { sandbox, calls, REVIEWER };
}

/**
 * A save/reload round trip through the product's OWN storage boundary.
 *
 * _stripBlobs is what both writers (the Supabase payload and the localStorage
 * fallback) pass through, and normalizeTenant is the allow-list every property
 * load re-reads the blob with. Anything this pair drops is gone in production,
 * whatever the in-memory object said a moment earlier — which is the whole
 * question the lifecycle checks are asking.
 */
const stripBlobs = (() => {
  const sb = { window: {}, undefined: undefined };
  sb.globalThis = sb;
  vm.createContext(sb);
  return vm.runInContext(
    '(' + extract(/\nfunction _stripBlobs\(property\) \{[\s\S]*?\n\}\n/, '_stripBlobs').trim() + ')', sb);
})();

function roundTrip(tenant) {
  // Exactly what savePropertyData does: the live buffer becomes prop.tenants,
  // the property goes through _stripBlobs on the way out, and the tenants come
  // back through normalizeTenant on the way in.
  const stored = stripBlobs({ id: 'p1', tenants: [tenant], invoices: [] });
  const wire   = JSON.parse(JSON.stringify(stored));   // a database round trip
  return normalizeTenant(wire.tenants[0]);
}

// ── A. A field the AI never produced can be typed in, and says who typed it ──
sec('A. AI-missing field → manual entry');
let A_saved = null;
{
  const { sandbox, calls, REVIEWER } = loadChain();
  // A lease the AI read. It produced a name and a type; square footage is the
  // gap — the exact case the Review Workspace tells the manager to fill in.
  sandbox.tenantData = [{
    id: 'tn-1', tenant_name: 'Maple Coffee Co', fileName: 'CascadeLease.pdf',
    leased_sqft: null, lease_type: 'Triple Net (NNN)',
    fieldEvidence: { lease_type: { snapshots: [{ fieldKey: 'lease_type', value: 'Triple Net (NNN)',
      quote: 'Tenant shall pay its pro rata share', page: 4, extractedAt: '2026-01-04T10:00:00Z' }] } },
    reviewOverrides: {},
  }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });

  // Before: this is what the manager was shown for a number nobody had entered.
  const before = FP.fieldProvenance('leased_sqft', sandbox.tenantData[0]);
  eq(before.state, 'unknown', 'with no value the field reports unknown, not a guess');

  sandbox.handleProvenancedFieldBlur(0, 'leased_sqft', '4200', null);
  const t = sandbox.tenantData[0];

  eq(t.leased_sqft, '4200', 'the typed value lands on the tenant');
  truthy(calls.saves > 0, 'and a save was triggered');

  const p = FP.fieldProvenance('leased_sqft', t);
  eq(p.state, 'manually_entered', 'provenance is manually_entered — NOT ai_extracted');
  eq(p.method, 'Manually Entered', 'the Review Workspace method line says Manually Entered');
  eq(p.by, REVIEWER.email, 'and it names the signed-in reviewer');
  eq(p.sourceFile, null, 'a typed value claims no source document');
  truthy(FP.isHumanBacked('leased_sqft', t), 'a person is the authority for this value');
  truthy(ISO_RE.test(p.when || ''), 'carrying an ISO-8601 timestamp', p.when);

  // The regression that made this necessary, stated as the thing it must not be.
  const stripped = { ...t, reviewOverrides: {}, fieldEvidence: {} };
  eq(FP.fieldProvenance('leased_sqft', stripped).method, 'AI Extraction',
     'CONTROL: the same value with no provenance record still reads "AI Extraction" — ' +
     'which is what the old writer produced, and what this suite exists to prevent');

  // The other field's citation is untouched — this edit is about one field.
  eq(FP.fieldProvenance('lease_type', t).state, 'lease_confirmed',
     'the lease-confirmed field beside it is unaffected');

  A_saved = t;
}

// ── B. It survives the reload, with its author and its timestamp ────────────
sec('B. save → reload → reopen');
{
  const before = FP.fieldProvenance('leased_sqft', A_saved);
  const after  = roundTrip(A_saved);

  eq(after.leased_sqft, '4200', 'the VALUE survives the storage round trip');
  eq(!!after.reviewOverrides.leased_sqft, true, 'the override survives');
  eq(after.reviewOverrides.leased_sqft.reviewerConfirmed, true, 'still reviewer-confirmed');
  eq(after.reviewOverrides.leased_sqft.original, null,
     'and remembers there was nothing there before — the AI found no sqft');
  truthy(ISO_RE.test(after.reviewOverrides.leased_sqft.reviewedAt || ''),
         'with an ISO-8601 reviewedAt', after.reviewOverrides.leased_sqft.reviewedAt);

  const p = FP.fieldProvenance('leased_sqft', after);
  eq(p.state, 'manually_entered', 'PROVENANCE survives the reload');
  eq(p.method, 'Manually Entered', 'the method line still says Manually Entered');
  eq(p.by, before.by, 'naming the same reviewer as before the reload');
  eq(p.when, before.when, 'at the same instant');
  eq(p.sourceFile, null, 'and still claims no source document');
  truthy(FP.isHumanBacked('leased_sqft', after), 'still human-backed after reload');
}

// ── C. Correcting a value the AI DID extract ────────────────────────────────
//
// The harder half. The AI read a cap of 5% and captured the clause that says
// so. The manager corrects it to 6%. The correction must persist, must be
// audited — and the clause stating five percent must NOT be presented as
// evidence for six.
sec('C. AI-extracted value → corrected');
let C_saved = null;
{
  const { sandbox, calls, REVIEWER } = loadChain();
  sandbox.tenantData = [{
    id: 'tn-2', tenant_name: 'Harborview Dental', fileName: 'HarborviewLease.pdf',
    cap: 5, leased_sqft: 3100, reviewOverrides: {},
    fieldEvidence: { cap: { snapshots: [{
      fieldKey: 'cap', value: 5, page: 12, extractedAt: '2026-01-04T10:00:00Z',
      quote: 'shall not increase by more than five percent (5%) annually',
      sourceFile: 'HarborviewLease.pdf',
    }] } },
  }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });

  const before = FP.fieldProvenance('cap', sandbox.tenantData[0]);
  eq(before.state, 'lease_confirmed', 'before the correction the cap is lease-confirmed');
  truthy(before.quote, 'carrying the clause that states five percent');

  sandbox.handleProvenancedFieldBlur(0, 'cap', '6', null);
  const t = sandbox.tenantData[0];

  eq(t.cap, '6', 'the corrected value lands on the tenant');

  // The audit half of the requirement.
  eq(calls.auditRows.length, 1, 'exactly one field-level audit row was written');
  const row = calls.auditRows[0];
  eq(row.action, 'field_override', 'recorded as a field override');
  eq(row.fieldKey, 'cap', 'against the canonical field key');
  eq(String(row.oldValue), '5', 'preserving what the AI had extracted');
  eq(String(row.newValue), '6', 'and what the human put there');
  eq(row.tenantId, 'tn-2', 'naming the tenant');
  truthy(calls.activity.some(a => a.type === 'field_override'),
         'and an activity-log entry accompanies it');
  eq(calls.timeline.length, 1, 'the property timeline records the correction too');
  eq(calls.timeline[0].type, 'field_overridden', 'as a field_overridden event');
  truthy(calls.timeline[0].actor, 'naming an actor');

  // The truthfulness half — the one that matters most.
  const p = FP.fieldProvenance('cap', t);
  eq(p.state, 'manually_entered', 'the corrected cap is manually_entered, not lease_confirmed');
  falsy(p.cited, 'it is NOT cited');
  eq(p.quote, null,
     'and the superseded five-percent clause is NOT offered as evidence for six');
  eq(p.by, REVIEWER.email, 'the correction names its reviewer');
  truthy(ISO_RE.test(p.when || ''), 'with an ISO-8601 timestamp', p.when);

  C_saved = t;
}

// ── D. The correction survives the reload, still uncited ────────────────────
sec('D. corrected value → reload → reopen');
{
  const after = roundTrip(C_saved);
  eq(String(after.cap), '6', 'the CORRECTED value survives the reload — not the AI original');
  eq(String(after.reviewOverrides.cap.original), '5',
     'and the original AI reading is preserved as history');

  const p = FP.fieldProvenance('cap', after);
  eq(p.state, 'manually_entered', 'still manually_entered after reload');
  falsy(p.cited, 'still uncited');
  eq(p.quote, null, 'the old clause still does not vouch for the new value');
  truthy(p.by, 'still naming a reviewer', String(p.by));
  truthy(ISO_RE.test(p.when || ''), 'still carrying an ISO timestamp', p.when);
  falsy(FP.isLeaseConfirmed('cap', after),
        'and the field can never claim the lease document backs it');
}

// ── E. A blur is not an assertion ───────────────────────────────────────────
//
// The guard that keeps the widened routing honest. Tabbing through seven fields
// without touching them must not manufacture seven "a person entered this"
// records — that would be the same fabrication in the opposite direction.
sec('E. An unchanged blur records nothing');
{
  const { sandbox, calls } = loadChain();
  sandbox.tenantData = [{
    id: 'tn-3', tenant_name: 'Summit Yoga', leased_sqft: 2000, cap: 4,
    start_date: '2024-01-01', lease_type: 'Gross',
    fieldEvidence: {}, reviewOverrides: {},
  }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });

  sandbox.handleProvenancedFieldBlur(0, 'tenant_name', 'Summit Yoga', null);
  sandbox.handleProvenancedFieldBlur(0, 'leased_sqft', '2000', null);   // number vs string
  sandbox.handleProvenancedFieldBlur(0, 'cap', '4', null);              // number vs string
  sandbox.handleProvenancedFieldBlur(0, 'start_date', '2024-01-01', null);
  sandbox.handleProvenancedFieldBlur(0, 'lease_type', 'Gross', null);

  eq(calls.auditRows.length, 0, 'five unchanged blurs wrote no audit rows');
  eq(calls.evidenceWrites.length, 0, 'and no evidence snapshots');
  eq(Object.keys(sandbox.tenantData[0].reviewOverrides).length, 0, 'and no overrides');
  eq(FP.fieldProvenance('leased_sqft', sandbox.tenantData[0]).state, 'ai_extracted',
     'an untouched extracted value still reports itself as an extraction');

  // And a REAL change on the same tenant still registers.
  sandbox.handleProvenancedFieldBlur(0, 'leased_sqft', '2400', null);
  eq(calls.auditRows.length, 1, 'but a genuine change does record one');
}

// ── F. Clearing a field is an edit too ──────────────────────────────────────
sec('F. Emptying a field is recorded, not silently ignored');
{
  const { sandbox, calls } = loadChain();
  sandbox.tenantData = [{ id: 'tn-4', tenant_name: 'Bayside Books', cap: 5,
                          fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.handleProvenancedFieldBlur(0, 'cap', '', null);
  eq(sandbox.tenantData[0].cap, null, 'an emptied field becomes null, not the empty string');
  eq(calls.auditRows.length, 1, 'and the clearing is audited');
  eq(FP.fieldProvenance('cap', sandbox.tenantData[0]).state, 'unknown',
     'a cleared field reports unknown — an override does not promote an absent value');
}

// ── F2. Filling in a blank is not signing off the lease ────────────────────
//
// THE REGRESSION THIS CHANGE CAUSED, AND THE ONE IT MUST NOT CAUSE AGAIN.
// review-engine.js short-circuits a tenant to `manually_verified` the moment
// ANY field override is reviewerConfirmed. That is right for the Lease Field
// Confidence editor — opening a field there and pressing Save is a reviewer
// vouching for it — and wrong for data entry. Routing the intake card through
// the same writer without the distinction made a lease with two outstanding
// advisory items report itself as Verified as soon as one blank was filled,
// which is this change's own fabrication pointed the other way.
// Measured by test-e2e-lease-review-flow, which went 74/0 → 72/2.
sec('F2. Card data entry does not mark the whole lease reviewer-verified');
{
  // review-engine.js attaches to `window` and has no CommonJS export, so it is
  // loaded the way every other Node suite loads it — in a sandbox with a window.
  const RE = (() => {
    const sb = { console: { log() {}, warn() {}, error() {} }, Math, Date, JSON,
      Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseFloat,
      parseInt, Set, Map, module: { exports: {} } };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    for (const f of ['money-cents.js', 'source-values.js', 'review-engine.js']) {
      sb.module = { exports: {} };
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
    }
    return sb.ReviewEngine;
  })();
  const { sandbox } = loadChain();
  sandbox.tenantData = [{ id: 'tn-5', tenant_name: 'Cedar Optics', fileName: 'CedarLease.pdf',
                          leased_sqft: null, lease_type: 'Triple Net (NNN)',
                          start_date: '2024-01-01', end_date: '2029-12-31',
                          cap: null, fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.handleProvenancedFieldBlur(0, 'leased_sqft', '5000', null);
  const t = sandbox.tenantData[0];

  eq(t.reviewOverrides.leased_sqft.overrideSource, 'data_entry',
     'a card edit is recorded as data entry');
  const st = RE.deriveTenantReviewState(t, []).status;
  truthy(st !== 'manually_verified',
         'and does NOT promote the lease to manually_verified', 'got ' + st);
  // Field-level provenance is untouched by the distinction — that is the point.
  eq(FP.fieldProvenance('leased_sqft', t).state, 'manually_entered',
     'while the FIELD still reports manually_entered');
  eq(FP.fieldProvenance('leased_sqft', t).by, 'manager@mainstreet.example',
     'still naming the person who typed it');

  // The review editor's own overrides keep their original meaning. Nothing
  // stored before this change carries `data_entry`, so nothing is re-read.
  const reviewed = { ...t, reviewOverrides: { leased_sqft: {
    ...t.reviewOverrides.leased_sqft, overrideSource: 'manual' } } };
  eq(RE.deriveTenantReviewState(reviewed, []).status, 'manually_verified',
     'a review-editor override still DOES mark the lease verified — unchanged');
  const legacy = { ...t, reviewOverrides: { leased_sqft: {
    original: null, override: '5000', reviewerConfirmed: true, reviewedAt: t.reviewOverrides.leased_sqft.reviewedAt } } };
  eq(RE.deriveTenantReviewState(legacy, []).status, 'manually_verified',
     'and an override with no source at all reads as before — no stored data is reinterpreted');
}

// ── F3. The card does not rebuild itself out from under the typist ─────────
//
// saveFieldOverride ends by calling renderBulkResults, which replaces every
// card's DOM. For the Lease Field Confidence editor — which lives in the report
// expansion — refreshing the list below it is free. For the intake card, which
// IS the list, it destroys the node the user is moving to: type a cap, tab to
// Prior-Year CAM Base, type 33000, and the base arrives null because the input
// it was typed into was already detached. Measured by test-cap-base-persistence,
// which went 12/0 → 6/6.
sec('F3. A card edit does not rebuild the list it lives in');
{
  const { sandbox, calls } = loadChain();
  sandbox.tenantData = [{ id: 'tn-6', tenant_name: 'Ridgeline Pilates', cap: null,
                          capBaseAmount: null, fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.handleProvenancedFieldBlur(0, 'cap', '5', null);
  eq(calls.renders, 0, 'a card edit triggers no bulk re-render');
  // And the second field, which the re-render used to eat, still lands.
  sandbox.handleProvenancedFieldBlur(0, 'capBaseAmount', '33000', null);
  eq(sandbox.tenantData[0].capBaseAmount, '33000',
     'so a second edit straight after the first still writes its value');
  eq(calls.auditRows.length, 2, 'and both edits are audited');

  // The review editor keeps the refresh it has always had.
  const { sandbox: s2, calls: c2 } = loadChain();
  s2.tenantData = [{ id: 'tn-7', tenant_name: 'Ridgeline Pilates', cap: 4,
                     fieldEvidence: {}, reviewOverrides: {} }];
  s2.currentProperty = () => ({ id: 'p1', tenants: s2.tenantData });
  s2.saveFieldOverride('tn-7', 'cap', '6');
  eq(c2.renders, 1, 'while the review editor still refreshes the list, as before');
}

// ── G. "Edit Fields" lands somewhere a field can be edited ──────────────────
sec('G. The Review Workspace edit button routes to the editor');
{
  const bare = code(scriptSrc);
  const fn = bare.match(/function rwOpenTenant\(tenantId\) \{[\s\S]*?\n\}/);
  truthy(fn, 'rwOpenTenant is defined');
  const body = fn ? fn[0] : '';

  falsy(/openTenantDetailPanel/.test(body),
        'it no longer opens the READ-ONLY Tenant Detail Panel');
  truthy(/openLeaseBlockerFix\(tenantId\)/.test(body),
         'it routes through openLeaseBlockerFix — the path the Needs Review CTA already uses');
  truthy(/closeReviewWorkspace\(\)/.test(body), 'and closes the workspace first');

  // The button that calls it still says Edit Fields, so the claim and the
  // destination are checked together rather than one drifting from the other.
  truthy(/onclick="rwOpenTenant\('\$\{tid\}'\)">Edit Fields</.test(bare),
         'and the button labelled "Edit Fields" is the one wired to it');

  // The destination really is an editor: openReviewItemFix expands the card's
  // detail and focuses the field's input.
  const orif = bare.match(/function openReviewItemFix\(tenantId, field\) \{[\s\S]*?\n\}\n/);
  truthy(orif, 'openReviewItemFix is defined');
  truthy(orif && /toggleBulkDetail\(i\)/.test(orif[0]),
         'and it expands the lease card detail');
  truthy(orif && /inp\.focus\(\)/.test(orif[0]),
         'and focuses the field input');

  // The read-only panel is still read-only — it was not "fixed" by adding
  // inputs to it. Two surfaces claiming to edit the same field is the thing
  // this change was avoiding.
  const tdp = bare.match(/function openTenantDetailPanel\(i\) \{[\s\S]*?\n\}\n/);
  truthy(tdp, 'openTenantDetailPanel is still defined');
  falsy(tdp && /<input|<select|handleProvenancedFieldBlur/.test(tdp[0]),
        'and remains display-only — no second editor was created');
}

// ── H. The card the manager is typing in stays open ─────────────────────────
//
// saveFieldOverride ends by calling renderBulkResults, which rebuilds every
// card from scratch and reopens only those carrying _autoExpand. Before this
// change only one field took that path; now eight do, so a rebuild that
// discards the open state would close the card on every edit.
sec('H. renderBulkResults preserves what the user had open');
{
  const bare = code(scriptSrc);
  const fn = bare.match(/function renderBulkResults\(\) \{[\s\S]*?\n\}\n/);
  truthy(fn, 'renderBulkResults is defined');
  const body = fn ? fn[0] : '';

  truthy(/_openBefore/.test(body), 'it records which cards were open before the rebuild');
  truthy(/querySelectorAll\('\.bulk-tenant-detail'\)/.test(body),
         'reading the state from the live DOM');
  truthy(/style\.display === 'block'/.test(body), 'by which ones are displayed');
  // Order matters: the capture must happen BEFORE the wipe, or it captures nothing.
  const capAt  = body.indexOf('_openBefore');
  const wipeAt = body.indexOf("el.innerHTML = ''");
  truthy(capAt !== -1 && wipeAt !== -1 && capAt < wipeAt,
         'and it captures BEFORE clearing the container, not after');
  truthy(/_openBefore\.forEach/.test(body), 'then reopens them after the rebuild');
  truthy(/bchev-/.test(body) && /Close/.test(body),
         'setting the chevron to match, so it does not read "Edit" above an open card');

  // The open state must not be written onto the tenant record, where it would
  // be persisted and reloaded as though it meant something about the lease.
  falsy(/_openBefore[\s\S]{0,400}?tenantData\[/.test(body),
        'and the open state is never written onto the tenant data');
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
  `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
