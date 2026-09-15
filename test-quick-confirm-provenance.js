'use strict';
/**
 * test-quick-confirm-provenance.js — the confirmations survive being made.
 *
 *   node test-quick-confirm-provenance.js
 *
 * THE DEFECT THIS PINS
 * --------------------
 * quickConfirmTenantFields captured `const t = tenantData[idx]` before its loop.
 * The loop calls persistFieldEvidence once per core field, and that function
 * REPLACES tenantData[idx] with a new object each time it appends a snapshot —
 * so by the end of the loop the slot held a tenant carrying up to fourteen
 * fresh confirmations, and `t` knew about none of them. The line after the loop
 * then wrote `tenantData[idx] = { ...t, review }`, and every snapshot the loop
 * had just written was gone.
 *
 * WHAT IT COST, PRECISELY
 * -----------------------
 * Not blob corruption: savePropertyData strips fieldEvidence from the persisted
 * property anyway (ms_useNormalizedEvidence makes tenant_field_evidence
 * authoritative), so the JSON on disk was never the record. The cost was
 * in-session and on the failure path:
 *
 *   1. IN SESSION. Immediately after a reviewer clicked "Confirm N CAM-ready
 *      extractions", FieldProvenance resolved those fields back to their floor
 *      — ai_extracted, or manually_entered for the cap base — because the
 *      snapshots proving manually_confirmed had been discarded. The screen
 *      contradicted the act that had just been performed. A reload silently
 *      repaired it from the normalized table, which is why it survived review.
 *
 *   2. WHEN THE DUAL-WRITE FAILS. persistFieldEvidence writes each snapshot to
 *      tenant_field_evidence non-blocking and FAIL-SILENT. When that write does
 *      not land — RLS, offline, a dropped request — the in-memory snapshot was
 *      the only copy, and this line destroyed it. Nothing repaired that.
 *
 * WHAT THE TESTS ASSERT
 * ---------------------
 * That every confirmable core field keeps its snapshot (Group B), that the
 * resolved provenance says manually_confirmed in the same session (Group C),
 * that the review flag still gets set (Group D — the fix must not trade one
 * write for another), and that the round trip through strip → normalized rows →
 * rehydrate still lands on manually_confirmed (Group E).
 */

const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;
const scriptSrc = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const FP = require(path.join(ROOT, 'field-provenance.js'));

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
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const REVIEWER = { id: 'uid-7', email: 'confirmer@example.com' };

/**
 * A tenant with a value in EVERY confirmable core field, so the loop has a
 * reason to write a snapshot for each one. A fixture that populated only two
 * fields would still pass a fix that preserved only the last snapshot.
 */
function fullTenant() {
  return {
    id: 'tq', tenant_name: 'Maple Coffee Co', leased_sqft: 3000,
    lease_type: 'NNN', start_date: '2024-03-01', end_date: '2029-02-28',
    cap: 5, capBaseAmount: '26000', admin_fee_pct: 4, admin_fee_basis: 'net',
    gross_up_pct: 95, expense_stop: 1000, audit_rights: true,
    pro_rata_method: 'rentable', renewal_options: '1 × 5-year',
    fileName: 'maple_plaza_messy_lease.pdf',
    fieldEvidence: {}, reviewOverrides: {}, review: {},
  };
}

function loadConfirm() {
  const src = [
    extract(/\nconst _FIELD_STORAGE  = \{[\s\S]*?\nfunction _fieldCanonical\(k\) \{[^\n]*\n/, 'field key maps'),
    extract(/\nfunction _mkEvidenceSnapshot\(fieldKey, t, opts\) \{[\s\S]*?\n\}\n/, '_mkEvidenceSnapshot'),
    extract(/\nfunction persistFieldEvidence\(tenantId, fieldKey, opts\) \{[\s\S]*?\n\}\n/, 'persistFieldEvidence'),
    extract(/\nfunction quickConfirmTenantFields\(tenantId\) \{[\s\S]*?\n\}\n/, 'quickConfirmTenantFields'),
    extract(/\nfunction getEffectiveLeaseField\(fieldName, t\) \{[\s\S]*?\n\}\n/, 'getEffectiveLeaseField'),
    extract(/\nfunction _extractionVersionTag\(t\) \{[\s\S]*?\n\}\n/, '_extractionVersionTag'),
    extract(/\nfunction _evidenceDbStatus\(snapshot\) \{[\s\S]*?\n\}\n/, '_evidenceDbStatus'),
    extract(/\nfunction _evidenceRowToSnapshot\(row\) \{[\s\S]*?\n\}\n/, '_evidenceRowToSnapshot'),
  ].join('\n');

  const calls = { evidenceWrites: [], auditRows: [], timeline: [], saves: 0 };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} },
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    isNaN, parseFloat, parseInt, Set, Map, setTimeout,
    tenantData: [], _props: [], activePropId: 'p1',
    savePropertyData() { calls.saves++; },
    deriveTenantReviewState: () => ({ status: 'complete' }),
    appendReviewAuditEntry: (e) => calls.auditRows.push(e),
    appendPropertyTimelineEvent: (p, e) => calls.timeline.push(e),
    rebuildDerivedState() {}, _refreshLfcExpansion() {}, showToast() {},
    _writeTenantFieldEvidence: (p, tid, fk, snap) =>
      calls.evidenceWrites.push({ propId: p, tenantId: tid, fieldKey: fk, snapshot: snap }),
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.currentProperty = () => ({ id: 'p1', tenants: sandbox.tenantData });
  sandbox.window.AuthService = { getCurrentUser: () => REVIEWER };
  sandbox.window.FieldProvenance = FP;
  vm.createContext(sandbox);
  vm.runInContext(
    'function getFieldConfidence(f, t){ return { status: "manual", note: "Manually confirmed" }; }\n' + src,
    sandbox, { filename: 'confirm-chain' });
  sandbox.__calls = calls;
  return { sandbox, calls };
}

/** Resolve a field the way PropertyRecord does, honouring the cap base's storage name. */
const resolve = (t, key) => (key === 'cap_base_amount')
  ? FP.fieldProvenance(key, t, { value: t.capBaseAmount })
  : FP.fieldProvenance(key, t);

// Read the list from source so the suite cannot drift from the code.
const CORE = (() => {
  const m = code(scriptSrc).match(/const CORE_FIELDS = \[([\s\S]*?)\]/);
  return m ? m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : [];
})();

// ── A. The fixture and the field list line up ───────────────────────────────
sec('A. Every core field has a value to confirm');
{
  truthy(CORE.length >= 14, 'CORE_FIELDS has all fourteen entries  — ' + CORE.length);
  const { sandbox } = loadConfirm();
  const t = fullTenant();
  const missing = CORE.filter(fk => {
    const sk = sandbox._fieldStore(fk);
    const v = t[sk];
    return v === null || v === undefined || v === '';
  });
  eq(missing.length, 0, 'the fixture populates every core field  — else the loop skips it')
  ;(missing.length ? bad : ok)('no core field is silently skipped'
    + (missing.length ? ' — unpopulated: ' + missing.join(', ') : ''));
}

// ── B. Every snapshot the loop writes survives the review update ────────────
sec('B. All fourteen confirmations survive');
{
  const { sandbox, calls } = loadConfirm();
  sandbox.tenantData = [fullTenant()];
  sandbox.quickConfirmTenantFields('tq');
  const t = sandbox.tenantData[0];

  eq(calls.evidenceWrites.length, CORE.length,
     'the loop emitted one evidence write per core field');

  const kept = CORE.filter(fk => ((t.fieldEvidence[fk] || {}).snapshots || []).length === 1);
  eq(kept.length, CORE.length,
     'and ALL of them are still on the tenant afterwards  — kept ' + kept.length + '/' + CORE.length);

  const lost = CORE.filter(fk => !((t.fieldEvidence[fk] || {}).snapshots || []).length);
  eq(lost.length, 0, 'no field lost its snapshot' + (lost.length ? ' — lost: ' + lost.join(', ') : ''));

  // The bug discarded ALL of them, so a fix that preserved only the last one
  // would still show a plausible-looking single snapshot. Count, don't sample.
  truthy(Object.keys(t.fieldEvidence).length === CORE.length,
         'fieldEvidence holds exactly one entry per core field');
}

// ── C. The resolved state says confirmed, in the same session ───────────────
sec('C. Provenance reports manually_confirmed without a reload');
{
  const { sandbox } = loadConfirm();
  sandbox.tenantData = [fullTenant()];
  sandbox.quickConfirmTenantFields('tq');
  const t = sandbox.tenantData[0];

  const notConfirmed = CORE.filter(fk => resolve(t, fk).state !== 'manually_confirmed');
  eq(notConfirmed.length, 0,
     'every core field resolves manually_confirmed'
     + (notConfirmed.length ? ' — not: ' + notConfirmed.join(', ') : ''));

  const capBase = resolve(t, 'cap_base_amount');
  eq(capBase.state, 'manually_confirmed', 'including the cap base, S1/S2\'s field');
  eq(capBase.by, REVIEWER.email, 'naming the confirming reviewer');
  eq(capBase.cited, false, 'a confirmation is still not a citation');
  eq(resolve(t, 'cap').state, 'manually_confirmed', 'and the cap percentage beside it');
}

// ── D. The fix did not trade one write for another ──────────────────────────
sec('D. The review flag and audit row are still written');
{
  const { sandbox, calls } = loadConfirm();
  sandbox.tenantData = [fullTenant()];
  sandbox.quickConfirmTenantFields('tq');
  const t = sandbox.tenantData[0];

  eq(t.review.reviewerConfirmed, true, 'review.reviewerConfirmed is set');
  eq(t.review.reviewedBy, REVIEWER.email, 'and names who confirmed');
  truthy(t.review.reviewedAt, 'and when');
  eq(calls.auditRows.length, 1, 'one quick_confirm audit row was written');
  eq(calls.auditRows[0].action, 'quick_confirm', 'with the existing action');
  eq(calls.auditRows[0].reviewStateBefore, 'complete',
     'reviewStateBefore is still read from the pre-operation tenant');
  eq(calls.timeline.length, 1, 'and the property timeline records the confirmation');
  truthy(calls.saves >= 1, 'and the property was saved');

  // Everything else about the tenant must be intact.
  eq(t.tenant_name, 'Maple Coffee Co', 'the tenant name survived');
  eq(t.capBaseAmount, '26000', 'the cap base value survived');
  eq(t.leased_sqft, 3000, 'the square footage survived');
}

// ── E. The round trip through persistence still lands confirmed ────────────
sec('E. Strip → normalized rows → rehydrate keeps the confirmation');
{
  const { sandbox, calls } = loadConfirm();
  sandbox.tenantData = [fullTenant()];
  sandbox.quickConfirmTenantFields('tq');
  const live = sandbox.tenantData[0];

  // 1. savePropertyData strips fieldEvidence from the blob — by design, because
  //    tenant_field_evidence is authoritative. Simulate that.
  const stripped = { ...live, fieldEvidence: undefined };
  eq(stripped.fieldEvidence, undefined, 'the persisted blob carries no fieldEvidence');
  eq(resolve(stripped, 'cap_base_amount').state, 'manually_entered',
     'so the stripped tenant alone cannot prove a confirmation');

  // 2. The dual-write payloads become tenant_field_evidence rows.
  const rows = calls.evidenceWrites.map(w => ({
    tenant_id: w.tenantId, field_key: w.fieldKey,
    value: w.snapshot.value,
    confidence_status: sandbox._evidenceDbStatus(w.snapshot),
    confidence_note: w.snapshot.confidence?.note ?? null,
    source_file: w.snapshot.sourceFile, source_page: w.snapshot.page,
    extraction_id: w.snapshot.extractionId, extraction_version: w.snapshot.extractionVersion,
    reviewer_uid: w.snapshot.reviewerUid, reviewer_email: w.snapshot.reviewerEmail,
    reviewed_at: w.snapshot.reviewedAt, approved: w.snapshot.approved,
    manually_edited: w.snapshot.manuallyEdited,
    original_extracted_value: w.snapshot.originalExtractedValue, quote: w.snapshot.quote,
  }));
  eq(rows.length, CORE.length, 'one normalized row per core field reached the table');
  const badStatus = rows.filter(r => !['verified', 'estimated', 'missing'].includes(r.confidence_status));
  eq(badStatus.length, 0, 'every row satisfies the confidence_status CHECK constraint');
  eq(rows.every(r => r.confidence_status === 'verified'), true,
     'and a named reviewer approving an unedited field projects to `verified`');

  // 3. loadPropertyData overlays them back.
  const byField = {};
  for (const r of rows) {
    (byField[r.field_key] = byField[r.field_key] || { snapshots: [] })
      .snapshots.push(sandbox._evidenceRowToSnapshot(r));
  }
  const rehydrated = { ...stripped, fieldEvidence: byField };

  const stillNot = CORE.filter(fk => resolve(rehydrated, fk).state !== 'manually_confirmed');
  eq(stillNot.length, 0,
     'after reload every core field is manually_confirmed again'
     + (stillNot.length ? ' — not: ' + stillNot.join(', ') : ''));
  eq(resolve(rehydrated, 'cap_base_amount').by, REVIEWER.email,
     'and the reviewer survives the round trip');
}

// ── F. The stale capture is gone from the source ───────────────────────────
sec('F. The function reads the array, not the pre-loop capture');
{
  const bare = code(scriptSrc);
  const fn = bare.match(/function quickConfirmTenantFields\(tenantId\) \{[\s\S]*?\n\}\n/);
  truthy(fn, 'quickConfirmTenantFields is present');
  const body = fn ? fn[0] : '';
  truthy(!/tenantData\[idx\] = \{\s*\.\.\.t,/.test(body),
         'it no longer spreads the pre-loop `t` over the slot');
  truthy(/const _confirmed = tenantData\[idx\]/.test(body),
         'it re-reads tenantData[idx] after the loop');
  truthy(/\.\.\._confirmed,/.test(body), 'and spreads that');
  truthy(/deriveTenantReviewState\(t\)\.status/.test(body),
         'while reviewStateBefore still reads the ORIGINAL tenant — "before" means before');
}

// ── G. No sibling call site has the same shape ─────────────────────────────
sec('G. The pattern does not recur elsewhere');
{
  const bare = code(scriptSrc);
  // A slot write that spreads a variable captured earlier, in a function that
  // also calls persistFieldEvidence, is the shape of this bug.
  // Bound each slice to ONE function body by brace-matching. Slicing a fixed
  // window forward bleeds into the next function and reports its neighbours;
  // and the declaration line itself must not count as a call, or
  // persistFieldEvidence flags itself.
  const bodies = [];
  const fnRe = /\nfunction ([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = fnRe.exec(bare)) !== null) {
    const open = bare.indexOf('{', m.index);
    let depth = 0, end = open;
    for (let k = open; k < bare.length; k++) {
      if (bare[k] === '{') depth++;
      else if (bare[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    bodies.push({ name: m[1], body: bare.slice(open, end + 1) });
  }
  truthy(bodies.length > 100, 'the scanner found the file\'s functions  — ' + bodies.length);

  // The bug shape precisely: a slot write that spreads an identifier BOUND TO
  // THE SLOT BEFORE the persistFieldEvidence call. Spreading a binding taken
  // AFTER the call is the fix, not the defect, so the capture position is what
  // separates them — not the mere presence of a named binding.
  const risky = bodies.filter(({ body }) => {
    const callAt = body.search(/persistFieldEvidence\s*\(\s*[A-Za-z_$]/);
    if (callAt === -1) return false;
    const write = /tenantData\[\w+\] = \{\s*\.\.\.([A-Za-z_$][\w$]*),/.exec(body);
    if (!write || write.index < callAt) return false;
    const spread = write[1];
    if (spread === 'tenantData') return false;          // spreads the array element itself
    const capture = new RegExp('(?:const|let|var)\\s+' + spread + '\\s*=\\s*tenantData\\[').exec(body);
    return !!(capture && capture.index < callAt);       // captured before the write loop ⇒ stale
  }).map(x => x.name);

  eq(risky.length, 0,
     'no function writes a stale spread AFTER calling persistFieldEvidence'
     + (risky.length ? ' — ' + risky.join(', ') : ''));
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
            `RESULT: ${pass} passed, ${fail} failed` + '\x1b[0m');
process.exit(fail === 0 ? 0 : 1);
