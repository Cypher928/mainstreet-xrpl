'use strict';
/**
 * test-p03-live-roundtrip.js — migrations 025–029 against the real pilot
 * database: persistence, RLS, immutability and append-only, with real JWTs.
 *
 *   node test-p03-live-roundtrip.js
 *
 * THE CLAIMS UNDER TEST (each one is a fact about a server, not about code)
 *   025  a member files a document with type/status/hash and reads it back
 *        through property_documents with a derived storage_ref; the view
 *        honours RLS (a stranger and a revoked member see nothing); a label
 *        outside the vocabulary is refused by the database
 *   026  a provision round-trips with the same five states as tenant fields;
 *        editing it in place is REFUSED; superseding it is allowed once;
 *        a member cannot delete it
 *   027  an evidence row carries source_document_id and amendment_id and
 *        reads back with them
 *   028  an event is stamped with the caller's uid and the property's
 *        organisation; a row naming another actor is refused; UPDATE and
 *        DELETE are refused for the member AND for the service role; the
 *        stranger sees nothing; anon sees nothing
 *   029  a financial source and a ledger line round-trip; a duplicate
 *        row_hash is refused; a member cannot delete
 *
 * FIXTURE. Runs inside the pilot live gate after scripts/pilot-live-fixture.js
 * setup: A owns the property, C is an active member, D a revoked member, B a
 * stranger. It writes rows under A's property only; the fixture's property
 * delete removes them by cascade — which is itself a claim this suite relies
 * on (028's guard must let the cascade through), and the teardown's residue
 * check is what would fail if it did not.
 *
 * NOT RUN IS NOT A PASS, AND NOT A FAILURE EITHER. Until 025–029 are applied
 * to pilot the tables are absent. The suite says so as a CI warning and exits
 * 0 — the same rule Group 4 of test-rls-cross-user.js follows — but a PARTIAL
 * application (some tables present, some not) is a failure.
 *
 * PILOT ONLY. This suite WRITES. It refuses production and exits 2 rather
 * than skipping when it cannot establish where it is.
 * Exit codes: 0 all passed or not run · 1 assertion failed · 2 refused.
 */

const { resolveOrAbort } = require('./test-support/supabase-target.js');

const PILOT_REF      = 'bhmktujbxdbvdmpybmad';
const PRODUCTION_REF = 'zhsuhehgehbzkmzurzyf';

function abort(msg) { console.error('::error::' + msg); process.exit(2); }

const TARGET = resolveOrAbort('p03-live-roundtrip');
if (TARGET.isProduction || TARGET.url.includes(PRODUCTION_REF) || !TARGET.url.includes(PILOT_REF)) {
  abort('this suite WRITES and will only ever write to pilot ' + PILOT_REF + '. Resolved: ' + TARGET.url);
}
const URL_ = TARGET.url, ANON = TARGET.anonKey;
const SERVICE_KEY = (process.env.PILOT_SUPABASE_SERVICE_ROLE_KEY || '').trim();
const STRICT = process.env.MS_REQUIRE_ALL_GROUPS === '1';

const ENV = {};
for (const k of ['USER_A_EMAIL', 'USER_A_PASS', 'USER_A_PROP_ID', 'USER_B_EMAIL', 'USER_B_PASS', 'USER_C_EMAIL', 'USER_C_PASS', 'USER_D_EMAIL', 'USER_D_PASS']) {
  ENV[k] = process.env[k];
  if (!ENV[k]) abort('missing ' + k + ' — run inside the pilot live gate (scripts/pilot-live-fixture.js setup)');
}
const PROP = ENV.USER_A_PROP_ID;
const ORG_A = process.env.USER_A_ORG_ID || null;
const TENANT_ID = process.env.TEST_TENANT_ID || ('plci-tenant-' + Date.now());

let failures = 0, passes = 0;
const pass = (m) => { passes++; console.log('  ✅ ' + m); };
const fail = (m) => { failures++; console.log('  ❌ ' + m); };
const info = (m) => console.log('  ℹ️  ' + m);

async function rest(path, token, opts = {}) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json', Prefer: opts.prefer || 'return=representation' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(URL_ + '/rest/v1' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, json, rows: Array.isArray(json) ? json.length : 0 };
}
async function service(path, opts = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', Prefer: opts.prefer || 'return=representation' };
  const r = await fetch(URL_ + '/rest/v1' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, json, rows: Array.isArray(json) ? json.length : 0 };
}
// GoTrue admin. Used only to create and remove a throwaway account of this
// run's own, so the foreign-key cleanup path can be exercised end to end.
async function admin(path, opts = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
  const r = await fetch(URL_ + '/auth/v1' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, json };
}
async function signIn(email, password) {
  const r = await fetch(URL_ + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  let d = null;
  try { d = await r.json(); } catch (_) { d = null; }
  return { token: d && d.access_token, uid: d && d.user && d.user.id };
}
const isMissing = (r) => r.status === 404 || (r.json && typeof r.json === 'object' && !Array.isArray(r.json) && /^(42P01|PGRST205)$/.test(String(r.json.code || '')));

(async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   P0.3 live round trip — 025–029 against pilot        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const A = await signIn(ENV.USER_A_EMAIL, ENV.USER_A_PASS);
  const B = await signIn(ENV.USER_B_EMAIL, ENV.USER_B_PASS);
  const C = await signIn(ENV.USER_C_EMAIL, ENV.USER_C_PASS);
  const D = await signIn(ENV.USER_D_EMAIL, ENV.USER_D_PASS);
  if (!A.token || !B.token || !C.token || !D.token) abort('could not sign in as every fixture account');

  // ── Are the tables there? ─────────────────────────────────────────────────
  const probes = {};
  for (const tbl of ['lease_provisions', 'property_events', 'financial_sources', 'gl_entries', 'property_documents']) {
    probes[tbl] = await rest('/' + tbl + '?select=id&limit=1', A.token);
  }
  const lineage = await rest('/tenant_field_evidence?select=source_document_id&limit=1', A.token);
  const register = await rest('/lease_documents?select=doc_type,status,sha256&limit=1', A.token);
  const absent  = Object.entries(probes).filter(([, r]) => isMissing(r)).map(([t]) => t);
  const present = Object.entries(probes).filter(([, r]) => !isMissing(r) && r.status < 300).map(([t]) => t);
  const colsAbsent = lineage.status === 400 || register.status === 400;
  if (absent.length === 5 && colsAbsent) {
    console.log('NOT RUN — migrations 025–029 (document register, provisions, lineage, events, financial tables) are not applied to this project.');
    console.log('  The P0.3 tables are unverified live until they are applied to pilot and this gate re-runs.');
    if (process.env.GITHUB_ACTIONS) console.log('::warning::P0.3 live round trip did not run: migrations 025–029 are not applied to the pilot project');
    process.exit(0);
  }
  if (absent.length || colsAbsent) {
    fail('PARTIAL application: present=' + present.join(',') + ' absent=' + absent.join(',') + ' lineage-columns=' + (lineage.status < 300) + ' register-columns=' + (register.status < 300));
    console.log('\n❌ ' + failures + ' assertion(s) FAILED'); process.exit(1);
  }
  pass('all five P0.3 surfaces are present on this project');

  const stamp = Date.now();
  const sha = ('0'.repeat(64) + stamp.toString(16)).slice(-64);

  // ── 025 ───────────────────────────────────────────────────────────────────
  console.log('\n025 — the document register\n');
  const docIns = await rest('/lease_documents', A.token, { method: 'POST', body: {
    property_id: PROP, file_name: 'plci-p03-' + stamp + '.pdf', file_url: 'leases/' + A.uid + '/plci-p03-' + stamp + '.pdf',
    doc_type: 'rent_roll', category: 'financials', status: 'received', sha256: sha, size_bytes: 1234, mime: 'application/pdf',
    uploaded_by: A.uid, classified_by: 'user', classification_confidence: 100,
  } });
  const doc = docIns.status < 300 && docIns.json && docIns.json[0];
  if (doc) pass('A files a document with type, status, hash, size, mime and uploader'); else fail('A could not file a document: ' + docIns.status + ' ' + JSON.stringify(docIns.json));
  if (doc) {
    const v = await rest('/property_documents?id=eq.' + doc.id, A.token);
    const row = v.rows === 1 ? v.json[0] : null;
    if (row && row.storage_ref === 'leases/' + A.uid + '/plci-p03-' + stamp + '.pdf' && row.has_text === false && row.doc_type === 'rent_roll')
      pass('the view returns it with a derived bare storage_ref, has_text=false and the type');
    else fail('the view did not return the filed document as expected: ' + JSON.stringify(v.json));
    if (row && !('extracted_text' in row)) pass('the view does not expose extracted_text'); else fail('the view exposes extracted_text');
    const vc = await rest('/property_documents?id=eq.' + doc.id, C.token);
    if (vc.rows === 1) pass('C (active member) sees it through the view'); else fail('C cannot see the document through the view (' + vc.status + ', ' + vc.rows + ' rows)');
    const vb = await rest('/property_documents?id=eq.' + doc.id, B.token);
    const vd = await rest('/property_documents?id=eq.' + doc.id, D.token);
    if (vb.rows === 0 && vd.rows === 0) pass('B (stranger) and D (revoked) see 0 rows through the view — security_invoker holds');
    else fail('the view leaked: B=' + vb.rows + ' D=' + vd.rows);
    const va = await rest('/property_documents?id=eq.' + doc.id, null);
    if (va.rows === 0) pass('anon sees 0 rows through the view'); else fail('anon sees ' + va.rows + ' rows through the view');
  }
  const badType = await rest('/lease_documents', A.token, { method: 'POST', body: { property_id: PROP, file_name: 'plci-bad-' + stamp + '.pdf', doc_type: 'not_a_type' } });
  if (badType.status >= 400) pass('a doc_type outside the vocabulary is refused by the database (' + badType.status + ')'); else fail('a bogus doc_type was accepted');
  const badStatus = await rest('/lease_documents', A.token, { method: 'POST', body: { property_id: PROP, file_name: 'plci-bad2-' + stamp + '.pdf', status: 'done' } });
  if (badStatus.status >= 400) pass('a status outside the five is refused (' + badStatus.status + ')'); else fail('a bogus status was accepted');

  // ── 026 ───────────────────────────────────────────────────────────────────
  console.log('\n026 — lease provisions\n');
  const provIns = await rest('/lease_provisions', A.token, { method: 'POST', body: {
    property_id: PROP, tenant_id: TENANT_ID, provision_key: 'renewal_option', ordinal: 0,
    structured: { count: 2, term_months: 60, notice_days_min: 180 }, plain: 'Tenant has two 5-year options with 180 days notice.',
    quote: 'Tenant shall have two (2) options to renew for five (5) years each', page: 12, section: '3.2', state: 'ai_extracted',
    source_document_id: doc ? doc.id : null, extraction_version: 'p03-live',
  } });
  const prov = provIns.status < 300 && provIns.json && provIns.json[0];
  if (prov && prov.state === 'ai_extracted' && prov.structured && prov.structured.count === 2) pass('A writes a provision with structure, sentence, quote, page and state; it reads back');
  else fail('A could not write a provision: ' + provIns.status + ' ' + JSON.stringify(provIns.json));
  if (prov) {
    const edit = await rest('/lease_provisions?id=eq.' + prov.id, A.token, { method: 'PATCH', body: { plain: 'edited in place' } });
    const after = await rest('/lease_provisions?id=eq.' + prov.id + '&select=plain', A.token);
    if (edit.status >= 400 && after.rows === 1 && after.json[0].plain === prov.plain) pass('editing a provision in place is REFUSED (' + edit.status + ') and the row is unchanged');
    else fail('a provision was edited in place: ' + edit.status + ' → ' + JSON.stringify(after.json));
    const succIns = await rest('/lease_provisions', A.token, { method: 'POST', body: {
      property_id: PROP, tenant_id: TENANT_ID, provision_key: 'renewal_option', ordinal: 0, structured: { count: 2, term_months: 60, notice_days_min: 270 },
      plain: 'Tenant has two 5-year options with 270 days notice.', quote: 'two hundred seventy (270) days', page: 12, state: 'manually_entered',
      reviewer_uid: A.uid, reviewer_email: ENV.USER_A_EMAIL, reviewed_at: new Date().toISOString(),
    } });
    const succ = succIns.status < 300 && succIns.json && succIns.json[0];
    const sup = succ ? await rest('/lease_provisions?id=eq.' + prov.id, A.token, { method: 'PATCH', body: { superseded_by: succ.id } }) : { status: 599 };
    if (succ && sup.status < 300) pass('a correction is a NEW row, and the old one may be pointed at it once'); else fail('could not supersede: ' + JSON.stringify(sup.json));
    const sup2 = await rest('/lease_provisions?id=eq.' + prov.id, A.token, { method: 'PATCH', body: { superseded_by: prov.id } });
    if (sup2.status >= 400) pass('superseded_by cannot be changed again (' + sup2.status + ')'); else fail('superseded_by was changed a second time');
    const cur = await rest('/lease_provisions?property_id=eq.' + PROP + '&tenant_id=eq.' + encodeURIComponent(TENANT_ID) + '&provision_key=eq.renewal_option&superseded_by=is.null&select=id', A.token);
    if (cur.rows === 1 && succ && cur.json[0].id === succ.id) pass('the current provision is the row with superseded_by null — the successor'); else fail('current-provision read returned ' + cur.rows + ' rows');
    const del = await rest('/lease_provisions?id=eq.' + prov.id, A.token, { method: 'DELETE' });
    const still = await rest('/lease_provisions?id=eq.' + prov.id + '&select=id', A.token);
    if (del.status >= 400 && still.rows === 1) pass('a member cannot delete a provision (' + del.status + '); history is kept'); else fail('a provision was deleted by a member: ' + del.status + ' / ' + still.rows);
    const badState = await rest('/lease_provisions', A.token, { method: 'POST', body: { property_id: PROP, tenant_id: TENANT_ID, provision_key: 'permitted_use', state: 'verified' } });
    if (badState.status >= 400) pass('a state outside the five FieldProvenance states is refused (' + badState.status + ')'); else fail('a bogus state was accepted');
    const pc = await rest('/lease_provisions?id=eq.' + prov.id + '&select=id', C.token);
    const pb = await rest('/lease_provisions?id=eq.' + prov.id + '&select=id', B.token);
    const pd = await rest('/lease_provisions?id=eq.' + prov.id + '&select=id', D.token);
    if (pc.rows === 1 && pb.rows === 0 && pd.rows === 0) pass('C sees the provision; B and D see 0 rows'); else fail('provision visibility: C=' + pc.rows + ' B=' + pb.rows + ' D=' + pd.rows);
    const bIns = await rest('/lease_provisions', B.token, { method: 'POST', body: { property_id: PROP, tenant_id: TENANT_ID, provision_key: 'permitted_use', state: 'unknown' } });
    if (bIns.status >= 400) pass('B cannot write a provision under A\'s property (' + bIns.status + ')'); else fail('B wrote a provision under A\'s property');
  }

  // ── 027 ───────────────────────────────────────────────────────────────────
  console.log('\n027 — evidence lineage\n');
  const tfeIns = await rest('/tenant_field_evidence', A.token, { method: 'POST', body: {
    property_id: PROP, tenant_id: TENANT_ID, field_key: 'plci_p03_field', value: '42', confidence_status: 'estimated',
    reviewed_at: new Date().toISOString(), source_document_id: doc ? doc.id : null, amendment_id: 'plci-am-' + stamp, quote: 'forty-two (42)',
  } });
  const tfe = tfeIns.status < 300 && tfeIns.json && tfeIns.json[0];
  if (tfe) {
    const back = await rest('/tenant_field_evidence?id=eq.' + tfe.id + '&select=source_document_id,amendment_id,superseded_by', A.token);
    const r = back.rows === 1 ? back.json[0] : {};
    if (doc && r.source_document_id === doc.id && r.amendment_id === 'plci-am-' + stamp && r.superseded_by === null) pass('an evidence row carries source_document_id and amendment_id and reads back with them');
    else fail('lineage did not round-trip: ' + JSON.stringify(back.json));
    const vb = await rest('/tenant_field_evidence?id=eq.' + tfe.id + '&select=id', B.token);
    if (vb.rows === 0) pass('B sees no evidence row'); else fail('B sees A\'s evidence row');
  } else fail('A could not write an evidence row with lineage: ' + tfeIns.status + ' ' + JSON.stringify(tfeIns.json));

  // ── 028 ───────────────────────────────────────────────────────────────────
  console.log('\n028 — property events\n');
  const evIns = await rest('/property_events', A.token, { method: 'POST', body: {
    property_id: PROP, action: 'p03_roundtrip', subject_type: 'document', subject_id: doc ? doc.id : null, detail: { stamp },
  } });
  const ev = evIns.status < 300 && evIns.json && evIns.json[0];
  if (ev && ev.actor_uid === A.uid) pass('an event written without actor_uid is stamped with the caller'); else fail('actor stamp: ' + evIns.status + ' ' + JSON.stringify(evIns.json));
  if (ev && ORG_A) { if (ev.organization_id === ORG_A) pass('and with the property\'s organisation'); else fail('organization_id stamped as ' + ev.organization_id + ', expected ' + ORG_A); }
  else if (ev) info('organisation stamp not asserted (USER_A_ORG_ID not provided by the fixture)');
  const spoof = await rest('/property_events', A.token, { method: 'POST', body: { property_id: PROP, action: 'p03_spoof', actor_uid: B.uid } });
  if (spoof.status >= 400) pass('an event naming another user as the actor is REFUSED (' + spoof.status + ')'); else fail('A wrote an event as B');
  if (ev) {
    const upd = await rest('/property_events?id=eq.' + ev.id, A.token, { method: 'PATCH', body: { action: 'tampered' } });
    const del = await rest('/property_events?id=eq.' + ev.id, A.token, { method: 'DELETE' });
    const still = await rest('/property_events?id=eq.' + ev.id + '&select=action', A.token);
    if (upd.status >= 400 && del.status >= 400 && still.rows === 1 && still.json[0].action === 'p03_roundtrip') pass('a member can neither update (' + upd.status + ') nor delete (' + del.status + ') an event');
    else fail('an event was mutated by a member: upd=' + upd.status + ' del=' + del.status + ' → ' + JSON.stringify(still.json));
    if (SERVICE_KEY) {
      const supd = await service('/property_events?id=eq.' + ev.id, { method: 'PATCH', body: { action: 'tampered' } });
      const sdel = await service('/property_events?id=eq.' + ev.id, { method: 'DELETE' });
      const sstill = await service('/property_events?id=eq.' + ev.id + '&select=action');
      if (supd.status >= 400 && sdel.status >= 400 && sstill.rows === 1) pass('the SERVICE ROLE can neither update (' + supd.status + ') nor delete (' + sdel.status + ') an event — append-only by construction');
      else fail('the service role mutated an event: upd=' + supd.status + ' del=' + sdel.status + ' rows=' + sstill.rows);
    } else info('service-role append-only check not run (no PILOT_SUPABASE_SERVICE_ROLE_KEY)');
    const ec = await rest('/property_events?id=eq.' + ev.id + '&select=id', C.token);
    const eb = await rest('/property_events?id=eq.' + ev.id + '&select=id', B.token);
    const ed = await rest('/property_events?id=eq.' + ev.id + '&select=id', D.token);
    const ea = await rest('/property_events?id=eq.' + ev.id + '&select=id', null);
    if (ec.rows === 1 && eb.rows === 0 && ed.rows === 0 && ea.rows === 0) pass('C sees the event; B, D and anon see 0 rows'); else fail('event visibility: C=' + ec.rows + ' B=' + eb.rows + ' D=' + ed.rows + ' anon=' + ea.rows);
    const cIns = await rest('/property_events', C.token, { method: 'POST', body: { property_id: PROP, action: 'p03_member_write' } });
    if (cIns.status < 300 && cIns.json[0].actor_uid === C.uid) pass('C (member) can write an event, stamped as C'); else fail('C could not write an event: ' + cIns.status);
    const bIns = await rest('/property_events', B.token, { method: 'POST', body: { property_id: PROP, action: 'p03_stranger_write' } });
    if (bIns.status >= 400) pass('B cannot write an event under A\'s property (' + bIns.status + ')'); else fail('B wrote an event under A\'s property');

    // 028b — the organisation is a fact about the property, not a claim the
    // writer makes. 028 kept whatever the caller supplied.
    if (ORG_A && SERVICE_KEY) {
      const otherOrg = await service('/organizations', { method: 'POST', body: { name: 'plci-' + stamp + '-not-As-org' } });
      const oid = otherOrg.status < 300 && otherOrg.json && otherOrg.json[0] && otherOrg.json[0].id;
      if (!oid) {
        info('organisation-authority check not run (could not create a throwaway organisation: ' + otherOrg.status + ')');
      } else {
        const mis = await rest('/property_events', A.token, { method: 'POST', body: {
          property_id: PROP, action: 'p03_org_claim', organization_id: oid,
        } });
        const stored = mis.status < 300 && mis.json && mis.json[0] && mis.json[0].organization_id;
        if (stored === ORG_A) pass('a mismatched organization_id supplied by the caller never becomes stored data');
        else fail('caller-supplied organisation was stored: ' + stored + ' (property belongs to ' + ORG_A + ')');
        await service('/organizations?id=eq.' + oid, { method: 'DELETE' });
      }
    }

    // 028b — a referenced row can still be deleted, and the event outlives it
    // with only that one column dropped. Under 028 both of these failed with
    // "rows are never updated", which would have blocked user deletion outright
    // once P0.5 starts writing events.
    if (SERVICE_KEY) {
      const email = 'plci-' + stamp + '-departing@pilot.invalid';
      const made = await admin('/admin/users', { method: 'POST', body: { email, password: 'x' + stamp + 'Aa!', email_confirm: true } });
      const uid = made.status < 300 && made.json && made.json.id;
      if (!uid) {
        info('user-deletion check not run (could not create a throwaway account: ' + made.status + ')');
      } else {
        const own = await service('/property_events', { method: 'POST', body: {
          property_id: PROP, action: 'p03_by_departing_user', actor_email: email, actor_uid: uid,
        } });
        const owned = own.status < 300 && own.json && own.json[0];
        const gone = await admin('/admin/users/' + uid, { method: 'DELETE' });
        const after = owned ? await service('/property_events?id=eq.' + owned.id + '&select=actor_uid,actor_email,action') : null;
        const row = after && after.json && after.json[0];
        if (gone.status < 300 && row && row.actor_uid === null && row.action === 'p03_by_departing_user' && row.actor_email === email) {
          pass('deleting a referenced user succeeds; the event survives with actor_uid NULL and nothing else changed');
        } else {
          fail('user deletion / event survival: delete=' + gone.status + ' row=' + JSON.stringify(row));
        }
      }
    }

    if (SERVICE_KEY) {
      // The same for an organisation. A property may not be left pointing at a
      // deleted organisation (properties.organization_id is ON DELETE RESTRICT),
      // so the throwaway property is moved back to A's organisation first; the
      // event keeps pointing at the organisation it was filed under.
      const tmpOrg = await service('/organizations', { method: 'POST', body: { name: 'plci-' + stamp + '-temp-org' } });
      const toid = tmpOrg.status < 300 && tmpOrg.json && tmpOrg.json[0] && tmpOrg.json[0].id;
      const tmpProp = toid ? await service('/properties', { method: 'POST', body: {
        user_id: A.uid, name: 'plci-' + stamp + '-org-probe', sqft: 1000, data: {}, organization_id: toid,
      } }) : null;
      const tpid = tmpProp && tmpProp.status < 300 && tmpProp.json && tmpProp.json[0] && tmpProp.json[0].id;
      if (!toid || !tpid) {
        info('organisation-deletion check not run (could not build the throwaway organisation/property)');
      } else {
        const oev = await service('/property_events', { method: 'POST', body: { property_id: tpid, action: 'p03_org_linked' } });
        const oevr = oev.status < 300 && oev.json && oev.json[0];
        await service('/properties?id=eq.' + tpid, { method: 'PATCH', body: { organization_id: ORG_A || null } });
        const odel = await service('/organizations?id=eq.' + toid, { method: 'DELETE' });
        const oafter = oevr ? await service('/property_events?id=eq.' + oevr.id + '&select=organization_id,action') : null;
        const orow = oafter && oafter.json && oafter.json[0];
        if (oevr && oevr.organization_id === toid && odel.status < 300 && orow && orow.organization_id === null && orow.action === 'p03_org_linked') {
          pass('deleting a referenced organisation succeeds; the event survives with organization_id NULL');
        } else {
          fail('organisation deletion / event survival: stamped=' + (oevr && oevr.organization_id) + ' delete=' + odel.status + ' row=' + JSON.stringify(orow));
        }
        // The event goes with the property, which is the one cascade 028 permits.
        await service('/properties?id=eq.' + tpid, { method: 'DELETE' });
      }
    }
  }

  // ── 029 ───────────────────────────────────────────────────────────────────
  console.log('\n029 — financial tables\n');
  const fsIns = await rest('/financial_sources', A.token, { method: 'POST', body: {
    property_id: PROP, kind: 'rent_roll', document_id: doc ? doc.id : null, period_start: '2026-01-01', period_end: '2026-12-31', period_label: 'CY2026', created_by: A.uid,
  } });
  const fsrc = fsIns.status < 300 && fsIns.json && fsIns.json[0];
  if (fsrc && fsrc.extraction_status === 'filed') pass('a financial source stub round-trips (kind, document, period), status filed'); else fail('financial source: ' + fsIns.status + ' ' + JSON.stringify(fsIns.json));
  const badKind = await rest('/financial_sources', A.token, { method: 'POST', body: { property_id: PROP, kind: 'invoice' } });
  if (badKind.status >= 400) pass('a kind outside the five is refused (' + badKind.status + ')'); else fail('a bogus kind was accepted');
  const glIns = await rest('/gl_entries', A.token, { method: 'POST', body: {
    property_id: PROP, source_id: fsrc ? fsrc.id : null, source_document_id: doc ? doc.id : null, period_start: '2026-01-01', period_end: '2026-01-31',
    account_code: '6100', account_name: 'Landscaping', description: 'Monthly service', vendor: 'Green Co', debit: 1250.5, credit: 0, amount: 1250.5, mapped_category: 'landscaping', confidence: 90, row_hash: 'plci-' + stamp,
  } });
  const gl = glIns.status < 300 && glIns.json && glIns.json[0];
  if (gl && Number(gl.amount) === 1250.5) pass('a ledger line round-trips with exact money'); else fail('ledger line: ' + glIns.status + ' ' + JSON.stringify(glIns.json));
  const dup = await rest('/gl_entries', A.token, { method: 'POST', body: { property_id: PROP, row_hash: 'plci-' + stamp, amount: 1 } });
  if (dup.status === 409) pass('a duplicate row_hash for the same property is refused (409) — re-import is idempotent'); else fail('duplicate row_hash answered ' + dup.status);
  if (gl) {
    const del = await rest('/gl_entries?id=eq.' + gl.id, A.token, { method: 'DELETE' });
    const still = await rest('/gl_entries?id=eq.' + gl.id + '&select=id', A.token);
    if (del.status >= 400 && still.rows === 1) pass('a member cannot delete a ledger line in Phase 0 (' + del.status + ')'); else fail('a ledger line was deleted: ' + del.status);
    const gb = await rest('/gl_entries?id=eq.' + gl.id + '&select=id', B.token);
    const gc = await rest('/gl_entries?id=eq.' + gl.id + '&select=id', C.token);
    if (gb.rows === 0 && gc.rows === 1) pass('B sees no ledger line; C sees it'); else fail('ledger visibility: B=' + gb.rows + ' C=' + gc.rows);
  }

  console.log('\n═══════════════════════════════════');
  console.log(failures ? '❌ ' + failures + ' assertion(s) FAILED (' + passes + ' passed)' : '✅ All ' + passes + ' assertions PASSED');
  console.log('═══════════════════════════════════\n');
  console.log('(rows written under property ' + PROP + ' are removed by the fixture\'s property delete — the cascade 028 permits)');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('Runner error:', e); process.exit(1); });
