'use strict';
/**
 * test-m8-lease-field-values.js — the seven canonical values, now readable.
 *
 *   node test-m8-lease-field-values.js
 *
 * OFFLINE. Every transport and every auth call is defined in this file. Nothing
 * here opens a socket or can reach Pilot or Production.
 *
 * WHAT M8a/M8b DID, AND WHAT IT DID NOT
 * -------------------------------------
 * It projected. The M8 preflight measured that the seven values were never
 * lost — they survive ingest, normalizeTenant and _stripBlobs, and most are
 * stored a second time in tenant_field_evidence.value. They were absent from
 * every capability because FieldProvenance returns thirteen keys and `value` is
 * not one of them, and that resolver was their only route to a reader.
 *
 * So: no new database read, no write, no migration, no extraction change, no
 * capability. Section F asserts each of those rather than asserting them in a
 * commit message.
 *
 * THE TWO SECTIONS WORTH READING
 * ------------------------------
 * Section C — value and state must describe the SAME figure. The projection
 * reads the value through the same storage-key rule the resolver reads it by,
 * so a field cannot report `manually_confirmed` beside a number nobody
 * confirmed. C6-C9 prove that by moving the stored value and watching both
 * move together.
 *
 * Section D — cap_base_amount is not a lease term and must not read as one even
 * when a quote is attached to it. `state` and `origin.kind` are separate axes,
 * the same distinction M6 drew between arithmetic and verification, and D5
 * checks the hard case: fabricated lease evidence makes the state
 * `lease_confirmed` while the kind stays `operating_actual`.
 */

const fs   = require('fs');
const MCP  = require('./api/_mcp-capabilities.js');
const HYD  = require('./api/_property-record-hydrator.js');
const DEPS = require('./api/_server-deps.js');
const TN   = require('./tenant-normalize.js');
const PR   = require('./property-record.js');
const FP   = require('./field-provenance.js');
const LI   = DEPS.load().LeaseIntelligence;
const INV  = require('./tools/global-dependency-inventory.js');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b)
  ? ok(m, JSON.stringify(a))
  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

// ── Fixtures ───────────────────────────────────────────────────────────────
const OWNER = '22222222-2222-4222-8222-222222222222';
const TENANT_USER = '33333333-3333-4333-8333-333333333333';
const PROP  = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const T1    = 'aaaaaaaa-0000-4000-8000-000000000001';
const NOW   = '2026-09-09T12:00:00.000Z';

/** The six the extractor produces, plus the one it cannot. */
const SIX = ['admin_fee_pct', 'gross_up_pct', 'expense_stop',
             'audit_rights', 'pro_rata_method', 'renewal_options'];
const CAP_BASE = 'cap_base_amount';
const SEVEN = SIX.concat([CAP_BASE]);
/** The canonical key whose value is stored under a different name. */
const STORAGE = { cap_base_amount: 'capBaseAmount' };
const store = (k) => STORAGE[k] || k;

const VALUES = {
  admin_fee_pct: 15, gross_up_pct: 95, expense_stop: 2.75,
  audit_rights: 'Tenant may audit within 90 days of the statement',
  pro_rata_method: 'rentable', renewal_options: 'One 5-year option at market',
  capBaseAmount: 100000,
};

function tenant(over) {
  return Object.assign({
    id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 500, cap: 5,
    start_date: '2020-01-01', end_date: '2030-01-01', lease_type: 'NNN',
  }, VALUES, over || {});
}
function blob(over) {
  return Object.assign({ tenants: [tenant()], invoices: [], disputes: [], timeline: [] },
                       over || {});
}

const auth = (opts) => async (tok) => {
  const o = opts || {};
  if (o.throws) { const e = new Error('x'); e.name = o.throws; throw e; }
  if (tok === 'owner')  return { status: 200, json: { id: OWNER } };
  if (tok === 'tenant') return { status: 200, json: { id: TENANT_USER } };
  return { status: 401, json: {} };
};

function db(opts) {
  const o = Object.assign({ blob: blob(), evidence: [], evStatus: 200 }, opts || {});
  const calls = [];
  const fn = async (p, options) => {
    calls.push({ path: p, method: (options && options.method) || 'GET' });
    if (/^\/properties\?id=eq\.[^&]+&user_id=eq\.([^&]+)&select=id$/.test(p)) {
      const uid = decodeURIComponent(p.match(/user_id=eq\.([^&]+)/)[1]);
      const pid = decodeURIComponent(p.match(/id=eq\.([^&]+)/)[1]);
      return { status: 200, json: (uid === OWNER && pid === PROP) ? [{ id: pid }] : [] };
    }
    if (/^\/properties\?/.test(p)) {
      return { status: 200, json: [{ id: PROP, name: 'Plaza', sqft: 1000, data: o.blob }] };
    }
    if (/^\/tenant_field_evidence\?/.test(p)) {
      if (o.evStatus >= 300) return { status: o.evStatus, json: { message: 'x' } };
      return { status: 200, json: o.evidence };
    }
    if (/^\/tenants\?/.test(p)) return { status: 200, json: [] };
    return { status: 404, json: [] };
  };
  fn.calls = calls;
  return fn;
}

const ctx = (over) => Object.assign(
  { token: 'owner', authFetch: auth(), sbFetch: db(), now: NOW }, over || {});
const codes = (env) => env.caveats.map(c => c.code);

/** An evidence row for one field, optionally carrying a lease citation. */
const evRow = (k, over) => Object.assign({
  tenant_id: T1, field_key: k, value: String(VALUES[store(k)]),
  confidence_status: 'high', confidence_note: null,
  source_file: 'acme-lease.pdf', source_page: null, quote: null,
  extraction_id: 'e-' + k, extraction_version: 1,
  reviewer_uid: null, reviewer_email: null, reviewed_at: null,
  approved: null, manually_edited: false, original_extracted_value: null,
  created_at: '2025-01-01T00:00:00Z',
}, over || {});

const fieldsOf = async (over) => {
  const h = await HYD.hydrate({ propertyId: PROP, userId: OWNER,
                                sbFetch: (over && over.sbFetch) || db() });
  return h.record.fields[T1];
};

(async function main() {

// ── A. The seven survive every stage before the projection ────────────────
sec('A. Nothing was lost — the preflight finding, pinned');
{
  const t = tenant();
  const n = TN.normalizeTenant(t);
  for (const k of SEVEN) {
    is(n[store(k)] !== undefined && n[store(k)] !== null,
       'A1.' + k + ' survives normalizeTenant', JSON.stringify(n[store(k)]));
  }

  // _stripBlobs is the save-time reducer. If it dropped one of these, the value
  // would vanish on the next load — the failure mode tenant-normalize's own
  // allow-list comment warns about.
  const src = fs.readFileSync(require.resolve('./script.js'), 'utf8');
  const m = src.match(/function _stripBlobs[\s\S]{0,1600}/);
  is(!!m, 'A2 _stripBlobs is present to inspect');
  if (m) {
    is(/fieldEvidence/.test(m[0]), 'A2a it strips fieldEvidence, as documented');
    for (const k of SEVEN) {
      is(!(new RegExp('\\b' + store(k) + '\\b').test(m[0])),
         'A3.' + k + ' is NOT stripped before save');
    }
  }

  // And the whole chain, through the real hydrator.
  const f = await fieldsOf();
  for (const k of SEVEN) {
    eq(f[k].value, VALUES[store(k)],
       'A4.' + k + ' arrives through the hydrator with its value intact');
  }
}

// ── B. Every canonical field is projected, not just the seven ─────────────
sec('B. The projection covers CANONICAL_FIELDS, not a list of its own');
{
  const f = await fieldsOf();
  eq(Object.keys(f).sort(), LI.CANONICAL_FIELDS.slice().sort(),
     'B1 every canonical field appears, and nothing else');
  is(LI.CANONICAL_FIELDS.length === 13, 'B2 thirteen of them', String(LI.CANONICAL_FIELDS.length));

  for (const k of LI.CANONICAL_FIELDS) {
    const v = f[k];
    is(v && typeof v === 'object', 'B3.' + k + ' is an object');
    for (const key of ['value', 'valuePresent', 'origin', 'state']) {
      is(Object.prototype.hasOwnProperty.call(v, key),
         'B4.' + k + ' carries ' + key);
    }
    is(v.origin && typeof v.origin.kind === 'string' &&
       typeof v.origin.extractable === 'boolean',
       'B5.' + k + ' origin names a kind and an extractability');
  }

  // The provenance keys are still all there — M8a ADDED, it did not replace.
  const bare = FP.fieldProvenance('cap', tenant());
  for (const key of Object.keys(bare)) {
    is(Object.prototype.hasOwnProperty.call(f.cap, key),
       'B6.' + key + ' from the resolver is preserved');
  }
  eq(f.cap.state, bare.state, 'B7 and the state is the resolver\'s, unchanged');
}

// ── C. Value and state describe the SAME figure ───────────────────────────
sec('C. A field cannot report a state about one number and show another');
{
  const f = await fieldsOf();

  // Present ⇒ value shown, valuePresent true, state not 'unknown'.
  for (const k of SEVEN) {
    eq(f[k].value, VALUES[store(k)], 'C1.' + k + ' shows the stored value');
    eq(f[k].valuePresent, true, 'C2.' + k + ' is marked present');
    is(f[k].state !== 'unknown', 'C3.' + k + ' has a state other than unknown', f[k].state);
  }

  // Absent ⇒ null, false, 'unknown'. All three agree.
  const gone = {};
  for (const k of SEVEN) gone[store(k)] = undefined;
  const f2 = await fieldsOf({ sbFetch: db({ blob: blob({ tenants: [tenant(gone)] }) }) });
  for (const k of SEVEN) {
    eq(f2[k].value, null, 'C4.' + k + ' absent ⇒ value null');
    eq(f2[k].valuePresent, false, 'C5.' + k + ' absent ⇒ valuePresent false');
    eq(f2[k].state, 'unknown', 'C5a.' + k + ' absent ⇒ state unknown');
  }

  // THE COUPLING. Move the stored value and BOTH must move. A projection that
  // read a different source — the evidence row's `value`, say — would keep
  // showing the old figure beside a state derived from the new one.
  const moved = await fieldsOf({ sbFetch: db({
    blob: blob({ tenants: [tenant({ admin_fee_pct: 42 })] }),
    evidence: [evRow('admin_fee_pct', { value: '15' })] }) });
  eq(moved.admin_fee_pct.value, 42,
     'C6 the projected value follows the TENANT record, not the evidence row');
  is(moved.admin_fee_pct.state !== 'unknown',
     'C7 and the state is computed from that same figure', moved.admin_fee_pct.state);

  // valuePresent is derived from the resolver's own emptiness test, not a
  // second implementation of it. Pin the exact boundary cases.
  const EMPTY = [undefined, null, '', '   '];
  const FULL  = [0, false, 'x', 0.0001];
  for (const v of EMPTY) {
    const r = await fieldsOf({ sbFetch: db({
      blob: blob({ tenants: [tenant({ admin_fee_pct: v })] }) }) });
    eq([r.admin_fee_pct.valuePresent, r.admin_fee_pct.state], [false, 'unknown'],
       'C8 ' + JSON.stringify(v) + ' is empty to BOTH the resolver and the projection');
    // And the VALUE itself must be null, not the empty thing that was stored.
    // normalizeTenant defaults an absent area to '', so empty strings really do
    // occur here; showing one beside `state: 'unknown'` would be the value and
    // the state describing different things, which is what section C exists for.
    eq(r.admin_fee_pct.value, null,
       'C8a ' + JSON.stringify(v) + ' is reported as null, not as itself');
  }
  for (const v of FULL) {
    const r = await fieldsOf({ sbFetch: db({
      blob: blob({ tenants: [tenant({ admin_fee_pct: v })] }) }) });
    is(r.admin_fee_pct.valuePresent === true && r.admin_fee_pct.state !== 'unknown',
       'C9 ' + JSON.stringify(v) + ' is present to BOTH', r.admin_fee_pct.state);
    eq(r.admin_fee_pct.value, v, 'C9a and ' + JSON.stringify(v) + ' is shown as itself');
  }
}

// ── D. cap_base_amount is not a lease term, and cannot be read as one ─────
sec('D. The one field that is not a lease term says so, always');
{
  const f = await fieldsOf();

  eq(f[CAP_BASE].origin.kind, 'operating_actual',
     'D1 cap_base_amount is an operating actual');
  eq(f[CAP_BASE].origin.extractable, false, 'D2 and no extractor can produce it');
  is(/NOT a lease term/.test(f[CAP_BASE].origin.note),
     'D3 with a note saying so in words');
  is(/Never describe it as lease-supported/.test(f[CAP_BASE].origin.note),
     'D3a and naming the inference it exists to prevent');

  for (const k of SIX) {
    eq(f[k].origin.kind, 'lease_term', 'D4.' + k + ' IS a lease term');
    eq(f[k].origin.extractable, true, 'D4a.' + k + ' and the extractor asks for it');
    eq(f[k].origin.note, null, 'D4b.' + k + ' needs no special note');
  }

  // THE HARD CASE. Attach a quoted, paged lease citation to the cap base. The
  // resolver will call it lease_confirmed — correctly, something IS cited. The
  // KIND must not move: it is still last year's actual CAM, whatever a document
  // says. These are two axes and M8b exists to keep them apart.
  const cited = await fieldsOf({ sbFetch: db({ evidence: [
    evRow(CAP_BASE, { quote: 'Base year CAM was $100,000.', source_page: 7 }) ] }) });
  eq(cited[CAP_BASE].state, 'lease_confirmed',
     'D5 a quoted citation does move the STATE');
  eq(cited[CAP_BASE].origin.kind, 'operating_actual',
     'D5a but the KIND does not — it is still an operating actual');
  eq(cited[CAP_BASE].origin.extractable, false, 'D5b and still not extractable');

  // The extractability claim is derived, not restated. Prove the export agrees
  // with the behaviour it describes: a never-extracted field with a value and
  // no citation floors to manually_entered, an ordinary one to ai_extracted.
  is(FP.NEVER_EXTRACTED && FP.NEVER_EXTRACTED[CAP_BASE] === true,
     'D6 FieldProvenance exports the fact the projection derives from');
  eq(FP.fieldProvenance(CAP_BASE, {}, { value: 1 }).state, 'manually_entered',
     'D6a and behaves accordingly — a typed value is not credited to a model');
  eq(FP.fieldProvenance('admin_fee_pct', { admin_fee_pct: 1 }).state, 'ai_extracted',
     'D6b while an extractable field floors to ai_extracted');
  for (const k of LI.CANONICAL_FIELDS) {
    const declared = !(FP.NEVER_EXTRACTED && FP.NEVER_EXTRACTED[k] === true);
    const behaved  = FP.fieldProvenance(k, {}, { value: 1 }).state === 'ai_extracted';
    eq(declared, behaved,
       'D7.' + k + ' the exported list and the observed floor agree');
  }
}

// ── E. What the capabilities expose ───────────────────────────────────────
sec('E. The three distinctions an agent has to be able to make');
{
  const ev  = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 }, ctx());
  const ten = await MCP.call('get_tenant', { propertyId: PROP, tenantId: T1 }, ctx());

  for (const k of SEVEN) {
    eq(ev.data.evidence[k].value, VALUES[store(k)],
       'E1.' + k + ' get_lease_evidence exposes the value');
    eq(ten.data.fieldProvenance[k].value, VALUES[store(k)],
       'E2.' + k + ' and get_tenant agrees exactly');
  }

  // 1 · value present + provenance   2 · absent + genuinely unknown
  const partial = ctx({ sbFetch: db({ blob: blob({
    tenants: [tenant({ gross_up_pct: undefined })] }) }) });
  const ev2 = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 }, partial);
  eq(ev2.data.evidence.admin_fee_pct.value, 15, 'E3 one field present…');
  eq([ev2.data.evidence.gross_up_pct.value, ev2.data.evidence.gross_up_pct.state],
     [null, 'unknown'], 'E4 …and its neighbour genuinely unknown, in one response');

  // 3 · manually entered prior-year CAM base
  eq(ev.data.evidence[CAP_BASE].origin.kind, 'operating_actual',
     'E5 and the cap base is distinguishable from both');

  // The section-level UNKNOWN is still a different answer from an absent field.
  const evFail = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 },
                                ctx({ sbFetch: db({ evStatus: 503 }) }));
  eq(evFail.data, null, 'E6 an evidence READ FAILURE is still null for the whole section');
  is(codes(evFail).indexOf('evidence.read_failed') !== -1, 'E6a with the M4 caveat');
  is(JSON.stringify(evFail).indexOf('"value"') === -1,
     'E7 — measured: no value is offered when provenance itself is unknown');

  // Units for the numbers that just became visible.
  const u = ev.provenance.units;
  eq(u['fields.admin_fee_pct.value'].unit, 'percent', 'E8 admin_fee_pct is a percentage');
  eq(u['fields.expense_stop.value'].unit, 'currency_per_square_foot',
     'E9 expense_stop is per square foot, not a total');
  eq(u['fields.cap_base_amount.value'].currencyCode, null,
     'E10 and no currency is invented for the cap base');
  for (const k of ['audit_rights', 'pro_rata_method', 'renewal_options']) {
    is(!u['fields.' + k + '.value'],
       'E11.' + k + ' has NO unit declared — it has none to declare');
  }
  is(/NOT a lease term/.test(ev.provenance.originNote),
     'E12 provenance carries the origin rule in words');
}

// ── F. A projection, and nothing else ─────────────────────────────────────
sec('F. No new read, no write, no capability, no extraction change');
{
  const f = db();
  await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 },
                 ctx({ sbFetch: f }));
  eq(f.calls.map(c => c.method), ['GET', 'GET', 'GET'], 'F1 three reads, all GET');
  eq(f.calls.length, 3, 'F2 the same three M1b approved — M8 added none');
  is(!f.calls.some(c => /lease_documents|cam_reconciliations/.test(c.path)),
     'F3 and no new table is touched');

  eq(MCP.TOOLS.map(t => t.name),
     ['list_properties', 'get_property', 'get_tenant', 'get_lease_evidence',
      'get_space', 'get_timeline', 'get_disputes', 'get_cam_status', 'get_attention'],
     'F4 the same nine capabilities — M8 added none');

  const exec = INV.stripStringsAndComments(
    fs.readFileSync(require.resolve('./api/_mcp-capabilities.js'), 'utf8'));
  is(!/method:\s*'(POST|PATCH|PUT|DELETE)'/.test(exec), 'F5 no write verb anywhere');

  // The extraction contract is untouched: the six are still requested, and the
  // cap base is still absent from it. M8 changed no prompt.
  const tasks = fs.readFileSync(require.resolve('./api/_claude-tasks.js'), 'utf8');
  for (const k of SIX) {
    is(new RegExp('"' + k + '"').test(tasks),
       'F6.' + k + ' is still requested by the extractor');
  }
  is(!/cap_base_amount/.test(tasks),
     'F7 and cap_base_amount is still absent from the extraction schema');

  // The record is not mutated by being read.
  const t = tenant();
  const before = JSON.stringify(t);
  // Through withWindow, because PropertyWorkspace reads window.Selectors at
  // CALL time — the same wrap the hydrator uses.
  DEPS.withWindow(() => PR.assemble({ id: PROP, name: 'P', tenants: [t] }, DEPS.load()));
  eq(JSON.stringify(t), before, 'F8 assembling the record mutates no tenant');
}

// ── G. The boundary is unchanged ──────────────────────────────────────────
sec('G. Values are behind the same door as everything else');
{
  for (const [tok, want] of [['', 'authentication_required'],
                             ['nonsense', 'invalid_or_expired_token'],
                             ['tenant', 'not_authorized']]) {
    const r = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 },
                             ctx({ token: tok }));
    eq(codes(r), [want], 'G1 a ' + (tok || 'missing') + ' token is refused');
    eq(r.data, null, 'G1a and no value crosses the line');
  }
  const foreign = await MCP.call('get_lease_evidence', { propertyId: OTHER, tenantId: T1 }, ctx());
  eq(codes(foreign), ['not_authorized'], 'G2 a property the caller does not own is refused');
  is(JSON.stringify(foreign).indexOf('100000') === -1,
     'G3 — measured: no cap base leaks through a refusal');

  const down = await MCP.call('get_lease_evidence', { propertyId: PROP, tenantId: T1 },
                              ctx({ authFetch: auth({ throws: 'TimeoutError' }) }));
  eq(codes(down), ['auth_service_unavailable'], 'G4 an auth timeout fails closed');
}

console.log('\n\x1b[1mRESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
