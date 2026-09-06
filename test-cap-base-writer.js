'use strict';
/**
 * test-cap-base-writer.js — S2: a cap base entered by hand says who entered it.
 *
 *   node test-cap-base-writer.js
 *
 * WHAT S2 CHANGED
 * ---------------
 * The Prior-Year CAM Base input called handleFieldBlur, which writes the value
 * and nothing else — no snapshot, no audit row, no reviewer, no timestamp. For
 * most fields that is survivable because an extraction already deposited
 * evidence underneath. The cap base has no extraction: /api/claude's contract
 * carries no key for it, so the form IS its only origin and a typed value was
 * the entire record of itself. That is why all eleven cap bases in pilot
 * resolve with `by: null`, and why the $26,000 on Maple Coffee Co cannot name
 * the person who put it there.
 *
 * The input now routes through saveFieldOverride — the same path the Lease
 * Review Workspace has always used for a corrected field. No new mechanism:
 * the snapshot, the reviewOverride, the activity entry and the field-level
 * audit row are the existing four writes, reached by an existing function.
 *
 * THE TWO THINGS THIS SUITE HAS TO HOLD APART
 * -------------------------------------------
 * NEW entries must gain an author. EXISTING values must not — nothing in S2
 * backfills, and a stored number whose typist is unrecorded must keep saying
 * `by: null` rather than borrowing the current session's identity. Group C
 * exists for that second half, because it is the one a careless implementation
 * gets wrong.
 */

const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;
const scriptSrc = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const eq  = (a, b, m) => (a === b ? ok(m) : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const truthy = (v, m) => v ? ok(m) : bad(m, 'expected truthy, got ' + JSON.stringify(v));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

function extract(pattern, label) {
  const m = scriptSrc.match(pattern);
  if (!m) throw new Error(`${label} not found in script.js`);
  return m[0];
}
/** Comments must never satisfy a source assertion — this suite names what it forbids. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * The real writer chain, lifted from script.js and run over a fake tenant.
 * Everything the chain touches that is not under test is captured, not stubbed
 * away, so the assertions are about what production would actually persist.
 */
function loadWriter() {
  const src = [
    extract(/\nconst _FIELD_STORAGE  = \{[\s\S]*?\nfunction _fieldCanonical\(k\) \{[^\n]*\n/, 'field key maps'),
    extract(/\nfunction _mkEvidenceSnapshot\(fieldKey, t, opts\) \{[\s\S]*?\n\}\n/, '_mkEvidenceSnapshot'),
    extract(/\nfunction persistFieldEvidence\(tenantId, fieldKey, opts\) \{[\s\S]*?\n\}\n/, 'persistFieldEvidence'),
    extract(/\nfunction saveFieldOverride\(tenantId, fieldName, newValue\) \{[\s\S]*?\n\}\n/, 'saveFieldOverride'),
    extract(/\nfunction handleProvenancedFieldBlur\(index, field, value, el\) \{[\s\S]*?\n\}\n/, 'handleProvenancedFieldBlur'),
    extract(/\nfunction handleFieldBlur\(index, field, value, el\) \{[\s\S]*?\n\}\n/, 'handleFieldBlur'),
    extract(/\nfunction quickConfirmTenantFields\(tenantId\) \{[\s\S]*?\n\}\n/, 'quickConfirmTenantFields'),
    extract(/\nfunction updateTenantField\(index, field, value\) \{[\s\S]*?\n\}\n/, 'updateTenantField'),
    extract(/\nfunction getEffectiveLeaseField\(fieldName, t\) \{[\s\S]*?\n\}\n/, 'getEffectiveLeaseField'),
    extract(/\nfunction _extractionVersionTag\(t\) \{[\s\S]*?\n\}\n/, '_extractionVersionTag'),
  ].join('\n');

  const calls = { evidenceWrites: [], auditRows: [], activity: [], timeline: [], saves: 0 };
  const REVIEWER = { id: 'uid-9', email: 'reviewer@example.com' };

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    isNaN, parseFloat, parseInt, Set, Map, setTimeout,
    tenantData: [], lastResults: [], isEditingField: false,
    savePropertyData() { calls.saves++; },
    _updateStaleResultsBanner() {},
    _resultsStale: false,
    currentProperty: () => ({ id: 'p1', tenants: sandbox.tenantData }),
    deriveTenantReviewState: () => ({ status: 'complete' }),
    // The tail of saveFieldOverride refreshes derived state and the UI. None of
    // it is under test, but it is captured rather than removed so the chain
    // runs to completion exactly as production does — a writer that throws
    // halfway would still have written the snapshot, and this suite would not
    // notice.
    _props: [], activePropId: 'p1',
    rebuildDerivedState() {},
    appendPropertyTimelineEvent: (p, e) => calls.timeline.push(e),
    renderBulkResults() {},
    _refreshLfcExpansion() {},
    showToast() {},
    logActivity: (type, label, meta) => calls.activity.push({ type, label, meta }),
    appendReviewAuditEntry: (e) => calls.auditRows.push(e),
    _writeTenantFieldEvidence: (p, tid, fk, snap) =>
      calls.evidenceWrites.push({ propId: p, tenantId: tid, fieldKey: fk, snapshot: snap }),
    // The real projection, so a CHECK-constraint violation would show up here.
    _evidenceDbStatus: null,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.window.AuthService = { getCurrentUser: () => REVIEWER };
  sandbox.window.FieldProvenance = require(path.join(ROOT, 'field-provenance.js'));
  vm.createContext(sandbox);
  // getFieldConfidence is large and pulls in the world; the chain only reads
  // {status, note} off it. The real one is exercised by test-evidence-honesty.
  vm.runInContext(
    'function getFieldConfidence(f, t){ return { status: "manual", note: "Manually entered" }; }\n' + src,
    sandbox, { filename: 'writer-chain' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'field-provenance.js'), 'utf8'), sandbox);
  sandbox._evidenceDbStatus = vm.runInContext(
    '(' + extract(/\nfunction _evidenceDbStatus\(snapshot\) \{[\s\S]*?\n\}\n/, '_evidenceDbStatus')
        .trim() + ')', sandbox);
  sandbox.__calls = calls;
  return { sandbox, calls, REVIEWER };
}

/** The dual-write payloads a sandbox recorded — what the writer actually emitted. */
const calls_of = (sandbox) => sandbox.__calls.evidenceWrites;

const FP = require(path.join(ROOT, 'field-provenance.js'));
const resolveBase = (t) => FP.fieldProvenance('cap_base_amount', t, { value: t.capBaseAmount });

// ── A. A NEW entry gains a snapshot, an author and a timestamp ──────────────
sec('A. A newly typed cap base records who typed it');
{
  const { sandbox, calls, REVIEWER } = loadWriter();
  sandbox.tenantData = [{ id: 'tc1', tenant_name: 'Maple Coffee Co', cap: 5,
                          capBaseAmount: null, fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.handleProvenancedFieldBlur(0, 'capBaseAmount', '26000', null);

  const t = sandbox.tenantData[0];
  eq(t.capBaseAmount, '26000', 'the value lands on capBaseAmount, the storage property');
  eq(t.cap_base_amount, undefined, 'and NOT on the canonical key — the engine reads capBaseAmount');

  const snaps = (t.fieldEvidence.cap_base_amount || {}).snapshots || [];
  eq(snaps.length, 1, 'exactly one evidence snapshot was appended');
  eq((t.fieldEvidence.capBaseAmount || {}).snapshots, undefined,
     'evidence is keyed CANONICALLY — latestSnapshot() looks up cap_base_amount');

  const s = snaps[0] || {};
  eq(s.value, '26000', 'the snapshot carries the new value');
  eq(s.manuallyEdited, true, 'manuallyEdited is true — asserting, not checking');
  eq(s.approved, true, 'approved is true — the person committed the edit');
  eq(s.reviewerEmail, REVIEWER.email, 'the snapshot names the reviewer');
  eq(s.reviewerUid, REVIEWER.id, 'and their uid');
  truthy(s.reviewedAt, 'and stamps when');
  eq(s.quote, null, 'no clause is invented');
  eq(s.page, null, 'no page is invented');
  eq(s.extractionVersion, 'manual', 'the version records that no extraction produced it');
  eq(s.originalExtractedValue, null, 'the prior value (none) is preserved as the original');

  eq(calls.evidenceWrites.length, 1, 'the normalized table received one dual-write');
  eq(calls.evidenceWrites[0].fieldKey, 'cap_base_amount', 'under the canonical field_key');
  eq(sandbox._evidenceDbStatus(s), 'estimated',
     'and projects to `estimated` — a typed value can never reach `verified`');

  eq(calls.auditRows.length, 1, 'one field-level audit row was written');
  eq(calls.auditRows[0].fieldKey, 'cap_base_amount', 'the audit row names the canonical field');
  eq(calls.auditRows[0].action, 'field_override', 'with the existing field_override action');
  eq(calls.auditRows[0].newValue, '26000', 'and the new value');
  truthy(calls.activity.length >= 1, 'an activity entry was logged');
}

// ── B. The resolved provenance now names a person ───────────────────────────
sec('B. FieldProvenance reads the new snapshot');
{
  const { sandbox, REVIEWER } = loadWriter();
  sandbox.tenantData = [{ id: 'tc1', cap: 5, capBaseAmount: null,
                          fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.handleProvenancedFieldBlur(0, 'capBaseAmount', '26000', null);

  const r = resolveBase(sandbox.tenantData[0]);
  eq(r.state, 'manually_entered', 'the state is manually_entered');
  eq(r.by, REVIEWER.email, 'and it now NAMES the person — the S2 payoff');
  truthy(r.when, 'and carries when');
  eq(r.cited, false, 'still uncited — an author is not a citation');
  eq(r.sourceFile, null, 'and still attributes no document');
  truthy(!/lease document/i.test(r.label), 'the label never says "lease document"');
}

// ── C. EXISTING values are untouched ────────────────────────────────────────
sec('C. A stored value with no snapshot keeps by: null');
{
  // Exactly the eleven pilot rows: a value, no evidence, no override.
  const legacy = { id: 'tl', cap: 5, capBaseAmount: '26000',
                   fileName: 'maple_plaza_messy_lease.pdf',
                   fieldEvidence: {}, reviewOverrides: {} };
  const r = resolveBase(legacy);
  eq(r.state, 'manually_entered', 'a legacy base still resolves manually_entered');
  eq(r.by, null, 'with by: null — S2 backfills nothing and invents no author');
  eq(r.when, null, 'and no timestamp is manufactured');
  eq(r.cited, false, 'uncited');
  eq(r.sourceFile, null, 'and no document is attributed');

  // And a blur that changes nothing must not turn one into an assertion.
  const { sandbox, calls } = loadWriter();
  sandbox.tenantData = [{ id: 'tl', cap: 5, capBaseAmount: '26000',
                          fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.handleProvenancedFieldBlur(0, 'capBaseAmount', '26000', null);
  const snaps = (sandbox.tenantData[0].fieldEvidence.cap_base_amount || {}).snapshots || [];
  eq(snaps.length, 0, 'an UNCHANGED value writes no snapshot — a blur is not an assertion');
  eq(calls.auditRows.length, 0, 'and no audit row');
  eq(resolveBase(sandbox.tenantData[0]).by, null, 'so it still cannot name an author');
}

// ── D. Editing an existing value DOES record the edit ───────────────────────
sec('D. Correcting a legacy value records the correction');
{
  const { sandbox, calls, REVIEWER } = loadWriter();
  sandbox.tenantData = [{ id: 'tl', cap: 5, capBaseAmount: '26000',
                          fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.handleProvenancedFieldBlur(0, 'capBaseAmount', '2600', null);

  const t = sandbox.tenantData[0];
  eq(t.capBaseAmount, '2600', 'the corrected value is stored');
  const s = ((t.fieldEvidence.cap_base_amount || {}).snapshots || [])[0] || {};
  eq(s.originalExtractedValue, '26000', 'the ORIGINAL value is preserved on the snapshot');
  eq(s.reviewerEmail, REVIEWER.email, 'the corrector is named');
  eq(calls.auditRows[0].oldValue, '26000', 'the audit row records what it was');
  eq(calls.auditRows[0].newValue, '2600', 'and what it became');
  eq(resolveBase(t).by, REVIEWER.email, 'and provenance now names them');
}

// ── E. Clearing the field returns it to unknown ─────────────────────────────
sec('E. Clearing a cap base is not an assertion of zero');
{
  const { sandbox } = loadWriter();
  sandbox.tenantData = [{ id: 'tl', cap: 5, capBaseAmount: '26000',
                          fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.handleProvenancedFieldBlur(0, 'capBaseAmount', '', null);
  const t = sandbox.tenantData[0];
  eq(t.capBaseAmount, null, 'an emptied input stores null, not ""');
  eq(resolveBase(t).state, 'unknown', 'and the field returns to unknown');
  eq(resolveBase(t).stated, false, 'claiming nothing was stated');
}

// ── F. cap_base_amount is confirmable ───────────────────────────────────────
sec('F. A reviewer can confirm the cap base, not just the percentage');
{
  const bare = code(scriptSrc);
  const m = bare.match(/const CORE_FIELDS = \[([\s\S]*?)\]/);
  truthy(m, 'CORE_FIELDS is declared');
  const keys = m ? m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : [];
  truthy(keys.includes('cap_base_amount'), 'cap_base_amount is in CORE_FIELDS');
  truthy(keys.includes('cap'), 'the percentage is still there');

  // The confirm path writes approved:true, manuallyEdited:false → manually_confirmed.
  const confirmed = {
    id: 'tc', cap: 5, capBaseAmount: '26000', reviewOverrides: {},
    fieldEvidence: { cap_base_amount: { snapshots: [{
      fieldKey: 'cap_base_amount', value: '26000', approved: true, manuallyEdited: false,
      reviewerEmail: 'reviewer@example.com', reviewedAt: '2026-09-04T00:00:00Z',
    }] } },
  };
  const r = resolveBase(confirmed);
  eq(r.state, 'manually_confirmed', 'an approved, unedited snapshot reaches manually_confirmed');
  eq(r.by, 'reviewer@example.com', 'naming the reviewer');
  eq(r.cited, false, 'a confirmation is still not a citation');

  // …and the REAL confirm path emits exactly that snapshot. Asserting the state
  // machine against a hand-built object leaves quickConfirmTenantFields itself
  // untested — flip its manuallyEdited to true and every assertion above still
  // passes while the field silently drops to manually_entered.
  //
  // The assertion is on what the path EMITS (the dual-write payload), not on
  // the tenant afterwards. quickConfirmTenantFields captures `const t` before
  // its loop and then writes `tenantData[idx] = { ...t, review }` after it, so
  // the stale spread discards every snapshot persistFieldEvidence just appended
  // in memory. That is a PRE-EXISTING defect affecting all thirteen
  // CORE_FIELDS equally, not something S2 introduced or depends on: the
  // normalized row is written before the overwrite and is authoritative on
  // reload, which is why it has gone unnoticed. Pinning the emitted snapshot
  // tests the confirm path's actual contract without also asserting that the
  // bug is fine.
  const { sandbox, REVIEWER } = loadWriter();
  sandbox.tenantData = [{ id: 'tq', tenant_name: 'Maple Coffee Co', cap: 5,
                          capBaseAmount: '26000', leased_sqft: 3000,
                          fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.quickConfirmTenantFields('tq');

  const emitted = calls_of(sandbox).find(w => w.fieldKey === 'cap_base_amount');
  truthy(emitted, 'quickConfirmTenantFields emits a cap_base_amount evidence write');
  eq(emitted && emitted.snapshot.manuallyEdited, false, 'as a confirmation, not an edit');
  eq(emitted && emitted.snapshot.approved, true, 'and as approved');
  eq(emitted && emitted.snapshot.reviewerEmail, REVIEWER.email, 'naming the confirming reviewer');
  // Feed the emitted snapshot back through the resolver: this is the state the
  // normalized row will produce on the next load.
  const rehydrated = resolveBase({
    id: 'tq', cap: 5, capBaseAmount: '26000', reviewOverrides: {},
    fieldEvidence: { cap_base_amount: { snapshots: [emitted ? emitted.snapshot : {}] } },
  });
  eq(rehydrated.state, 'manually_confirmed',
     'and that snapshot resolves to manually_confirmed — the confirm path works end to end');
}

// ── G. The wiring is real, and scoped ───────────────────────────────────────
sec('G. The input is wired, and nothing else was rerouted');
{
  const bare = code(scriptSrc);
  truthy(/onblur="handleProvenancedFieldBlur\(\$\{i\},'capBaseAmount',this\.value,this\)"/.test(bare),
         'the Prior-Year CAM Base input calls handleProvenancedFieldBlur');
  truthy(!/onblur="handleFieldBlur\(\$\{i\},'capBaseAmount'/.test(bare),
         'and no longer calls the provenance-free handleFieldBlur');

  const routed = (bare.match(/handleProvenancedFieldBlur\(\$\{i\},'([A-Za-z_]+)'/g) || []);
  eq(routed.length, 1, 'exactly ONE field was rerouted — S2 is not a blanket change');
  truthy(/capBaseAmount/.test(routed[0] || ''), 'and it is the cap base');

  // The other fields must keep their existing writer.
  for (const f of ['tenant_name', 'leased_sqft', 'start_date', 'cap']) {
    truthy(new RegExp("handleFieldBlur\\(\\$\\{i\\},'" + f + "'").test(bare),
           f + ' still uses handleFieldBlur');
  }
  truthy(/function handleProvenancedFieldBlur/.test(bare), 'the handler is defined');
  truthy(/saveFieldOverride\(t\.id, field, next\)/.test(bare),
         'and delegates to saveFieldOverride — the existing path, not a new one');
}

// ── H. The writer runs to completion ────────────────────────────────────────
// saveFieldOverride read `user?.email` for the property-timeline append while
// `user` was declared nowhere. Optional chaining does not rescue an undeclared
// identifier — it throws ReferenceError — so the function wrote its value, its
// snapshot and its audit row and then died before the timeline event, the
// re-render and the confirmation toast. Every assertion above would still pass
// with that bug present, because the writes happen first. This group is what
// notices.
sec('H. The override chain completes, it does not throw part-way');
{
  const { sandbox, calls } = loadWriter();
  sandbox.tenantData = [{ id: 'tc1', tenant_name: 'Maple Coffee Co', cap: 5,
                          capBaseAmount: null, fieldEvidence: {}, reviewOverrides: {} }];
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  let threw = null;
  try { sandbox.handleProvenancedFieldBlur(0, 'capBaseAmount', '26000', null); }
  catch (e) { threw = e; }
  eq(threw, null, 'a cap base entry completes without throwing');
  eq(calls.timeline.length, 1, 'the property timeline event IS appended — past the old throw point');
  eq(calls.timeline[0].type, 'field_overridden', 'and records a field override');
  truthy(calls.timeline[0].actor, 'naming an actor rather than dying on an undeclared `user`');

  const bare = code(scriptSrc);
  const fn = bare.match(/function saveFieldOverride\([\s\S]*?\n\}\n/);
  truthy(fn, 'saveFieldOverride is present');
  truthy(fn && /const user = window\.AuthService/.test(fn[0]),
         'and declares `user` before reading it');
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
            `RESULT: ${pass} passed, ${fail} failed` + '\x1b[0m');
process.exit(fail === 0 ? 0 : 1);
