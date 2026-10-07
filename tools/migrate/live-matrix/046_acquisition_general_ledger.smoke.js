#!/usr/bin/env node
'use strict';
/**
 * smoke-046.js — the deployed Pilot ledger endpoints, exercised once, end to end,
 * exactly as the application would use them:
 *
 *   sign in as the OWNER test account (pilot-tenant-a@mainstreet-test.local)
 *   → begin_acquisition (RPC)                        a prospect property + review
 *   → POST /api/upload                                the 189-byte CSV original into Storage
 *   → file the acquisition_documents row (REST)       as the signed-in person
 *   → POST /api/upload?op=ledger-import               reaches import_general_ledger() on Pilot
 *   → read back: source, 2 lines, 2 links, history row, property event
 *   → POST ?op=ledger-import again                    answered already_imported (writes nothing)
 *   → POST /api/upload?op=ledger-reverse              reaches reverse_general_ledger_import()
 *   → read back: 0 lines, 2 archived, source reversed, history row, event
 *   → delete_prospect_acquisition (RPC)               property, review, document, source go
 *   → DELETE the stored CSV from Storage              allowed once the document is gone
 *
 * PILOT ONLY. Refuses any other project ref. Never prints the password or token.
 * Stops at the FIRST unexpected answer and prints what it saw; it never retries
 * and never improvises a cleanup — the state is left for a read-only inspection.
 *
 * What it leaves behind BY DESIGN (046 keeps evidence): three append-only rows in
 * ledger_import_history for the smoke property (import, reverse, evidence_removed).
 * They cannot be deleted by anyone; purge_ledger_import_history() removes them after
 * the retention period. Everything else is removed by the script.
 *
 *   node smoke-046.js            (asks for the OWNER test account's password, silently)
 *   FIXTURE_PASSWORD=… node smoke-046.js
 *
 * Needs Node 18 or newer (built-in fetch). No npm install.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PILOT_REF = 'bhmktujbxdbvdmpybmad';
const SUPABASE_URL = 'https://bhmktujbxdbvdmpybmad.supabase.co';
const ANON_KEY = 'sb_publishable__Gi3NcVbKmnhu4SfjUxLHw_QpZMYEz1';          // Pilot's publishable key (supabase-config.js; safe to share)
const APP_URL = process.env.APP_URL || 'https://www.mainstreet-review.com';
const EMAIL = process.env.SMOKE_EMAIL || 'pilot-tenant-a@mainstreet-test.local';
const OWNER_UID = '1c682d8e-0fcb-42c9-9d91-95b9524bb113';                   // the account the live matrix used as its owner

// The ledger: two balanced lines, ISO dates. The server reads it with gl-import.js
// and must see exactly these numbers (checked locally with the repository's parser).
const CSV = 'Date,Account,Account Name,Description,Vendor,Reference,Debit,Credit\n'
          + '2025-01-15,6100,Repairs,046 smoke repair,Smoke Co,S-1,123.45,\n'
          + '2025-01-15,1000,Cash,046 smoke repair,Smoke Co,S-1,,123.45\n';
const CSV_BUF = Buffer.from(CSV, 'utf8');
const EXPECT = { bytes: 189, sha256: 'b1640e4856a97f64b34fd4771d38c2189904d2e93c203c6ccfd860dd8e2eb666', lines: 2, debitCents: 12345, creditCents: 12345, dateOrder: 'iso' };

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) { console.error('Node 18 or newer is needed (this is ' + process.version + '). Nothing sent.'); process.exit(64); }
if (!SUPABASE_URL.includes(PILOT_REF) || /zhsuhehgehbzkmzurzyf/.test(SUPABASE_URL + APP_URL)) { console.error('Refusing: not the Pilot project. Nothing sent.'); process.exit(65); }
if (CSV_BUF.length !== EXPECT.bytes || crypto.createHash('sha256').update(CSV_BUF).digest('hex') !== EXPECT.sha256) { console.error('Refusing: the CSV is not the reviewed one. Nothing sent.'); process.exit(66); }

const ATTEMPT = path.join(__dirname, '.smoke-046.attempt');
if (fs.existsSync(ATTEMPT)) { console.error('Refusing: ' + ATTEMPT + ' exists — this script already ran here once. Read the database before anything else; do not re-run.'); process.exit(67); }

const LOG = [];
const say = (s) => { const line = new Date().toISOString() + ' ' + s; console.log(line); LOG.push(line); };
const ids = {};
function stop(what, extra) {
  say('STOP: ' + what);
  if (extra !== undefined) say('  saw: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 1200));
  say('  ids so far: ' + JSON.stringify(ids));
  say('  Nothing was retried and nothing was cleaned up. Report this output; the state is left for a read-only inspection.');
  fs.writeFileSync(path.join(__dirname, 'smoke-046.log'), LOG.join('\n') + '\n');
  process.exit(1);
}
async function readPassword() {
  // A temporary password file next to the script (written for this run, removed after it) is read first,
  // so nobody has to see or type it; then FIXTURE_PASSWORD; then a hidden prompt.
  for (const name of ['.smoke-046.password', 'smoke-046.password.txt']) {
    const pf = path.join(__dirname, name);
    if (fs.existsSync(pf)) { const v = fs.readFileSync(pf, 'utf8').trim(); if (v) { say('password source: file ' + name + ' (' + v.length + ' chars, never printed)'); return v; } }
  }
  if (process.env.FIXTURE_PASSWORD) { say('password source: environment variable FIXTURE_PASSWORD (' + process.env.FIXTURE_PASSWORD.length + ' chars, never printed) — no password file was found next to the script'); return process.env.FIXTURE_PASSWORD; }
  say('password source: hidden terminal prompt — no password file next to the script and FIXTURE_PASSWORD is not set');
  if (!process.stdin.isTTY) { console.error('No FIXTURE_PASSWORD and stdin is not a terminal. Nothing sent.'); process.exit(64); }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write('Password for ' + EMAIL + ' (typing is hidden): ');
    const onData = (c) => { const ch = String(c); if (ch === '\n' || ch === '\r' || ch === '\u0004') process.stdin.removeListener('data', onData); };
    process.stdin.on('data', onData);
    rl._writeToOutput = function () {};   // silent prompt
    rl.question('', (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}
async function call(label, url, opts, expectStatus) {
  let r, text;
  try {
    r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(30000) }, opts));
    text = await r.text();
  } catch (e) {
    stop(label + ': network error ' + (e && e.message));
  }
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  const ok = Array.isArray(expectStatus) ? expectStatus.includes(r.status) : r.status === expectStatus;
  say(label + ': HTTP ' + r.status + (ok ? '' : ' (expected ' + expectStatus + ')'));
  if (!ok) stop(label + ' answered HTTP ' + r.status, text);
  return json === null ? text : json;
}

(async () => {
  const password = await readPassword();
  fs.writeFileSync(ATTEMPT, new Date().toISOString() + '\n');
  say('---- 046 deployed smoke test, Pilot ' + PILOT_REF + ', app ' + APP_URL + ', account ' + EMAIL);

  // 0 · sign in as the owner test account
  const auth = await call('sign-in', SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password }),
  }, 200);
  const TOKEN = auth.access_token, UID = auth.user && auth.user.id;
  if (!TOKEN || UID !== OWNER_UID) stop('signed-in user is not the OWNER test account', { uid: UID });
  say('signed in as ' + UID.slice(0, 8) + '… (token held in memory only)');
  const asUser = { apikey: ANON_KEY, Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' };
  const rest = (p, o, st) => call('rest ' + p.split('?')[0], SUPABASE_URL + '/rest/v1/' + p, Object.assign({ headers: asUser }, o || {}), st || 200);

  // pre-state, as the person sees it
  const pre = await rest('properties?select=id&user_id=eq.' + UID);
  if (pre.length !== 0) stop('the owner test account already owns properties', pre);
  const preHist = await rest('ledger_import_history?select=id');
  say('pre: owner properties 0, visible import history ' + preHist.length);

  // 1 · begin the acquisition (the app's RPC)
  const acq = await rest('rpc/begin_acquisition', { method: 'POST', body: JSON.stringify({ p_name: '046 deployed smoke test', p_data: { totalSqFt: '1000' } }) });
  ids.property_id = acq.property_id; ids.review_id = acq.review_id;
  if (!ids.property_id || !ids.review_id) stop('begin_acquisition did not return a property and a review', acq);
  say('acquisition: property ' + ids.property_id.slice(0, 8) + '… review ' + ids.review_id.slice(0, 8) + '…');

  // 2 · store the original through the deployed upload endpoint, named as the app names it
  const stamp = Date.now();
  const up = await call('POST /api/upload', APP_URL + '/api/upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'acq/' + ids.review_id + '/' + stamp + '-smoke.csv', fileType: 'text/csv', fileBase64: CSV_BUF.toString('base64'), bucket: 'leases' }),
  }, 200);
  ids.storage_path = up.url;
  const expectedPath = 'leases/' + UID + '/acq_' + ids.review_id + '_' + stamp + '-smoke.csv';
  if (ids.storage_path !== expectedPath) stop('upload stored the original under an unexpected path', { got: ids.storage_path, expected: expectedPath });
  ids.object_name = ids.storage_path.slice('leases/'.length);
  say('stored original: ' + ids.storage_path);

  // 3 · file the document, as the signed-in person (property_id is bound by 034's trigger)
  const doc = await rest('acquisition_documents?select=id,property_id,storage_path', {
    method: 'POST', headers: Object.assign({ Prefer: 'return=representation' }, asUser),
    body: JSON.stringify({ review_id: ids.review_id, user_id: UID, file_name: 'smoke.csv', intake_id: 'ik-046-smoke-' + stamp, intake_kind: 'other', storage_path: ids.storage_path }),
  }, 201);
  ids.document_id = doc[0] && doc[0].id;
  if (!ids.document_id || doc[0].property_id !== ids.property_id) stop('the document row was not filed under the acquisition', doc);
  say('document filed: ' + ids.document_id.slice(0, 8) + '…');

  // 4 · THE IMPORT, through the deployed endpoint → import_general_ledger()
  const preview = { lines: EXPECT.lines, debitCents: EXPECT.debitCents, creditCents: EXPECT.creditCents, dateOrder: EXPECT.dateOrder, fileSha256: EXPECT.sha256 };
  const imp = await call('POST /api/upload?op=ledger-import', APP_URL + '/api/upload?op=ledger-import', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId: ids.document_id, preview }),
  }, 200);
  ids.source_id = imp.source_id;
  say('import answered: ' + JSON.stringify(imp));
  if (imp.already_imported !== false || imp.inserted !== 2 || !ids.source_id) stop('the import did not insert exactly 2 new lines', imp);

  // 5 · what the database now holds, read as the person
  const src = await rest('financial_sources?select=import_status,file_sha256,file_bytes,storage_path,kind,acquisition_document_id&id=eq.' + ids.source_id);
  const lines = await rest('gl_entries?select=id,account_code,debit,credit,posted_on,source_row&source_id=eq.' + ids.source_id + '&order=source_row');
  const links = await rest('gl_entry_sources?select=gl_entry_id&source_id=eq.' + ids.source_id);
  const hist1 = await rest('ledger_import_history?select=action,actor_uid,lines,inserted,file_bytes,file_sha256,balanced&source_id=eq.' + ids.source_id + '&order=occurred_at');
  const ev1 = await rest('property_events?select=action&property_id=eq.' + ids.property_id + '&action=like.ledger*');
  const s0 = src[0] || {};
  const importOk = s0.import_status === 'active' && s0.file_sha256 === EXPECT.sha256 && s0.file_bytes === EXPECT.bytes && s0.storage_path === ids.storage_path
    && s0.kind === 'general_ledger' && s0.acquisition_document_id === ids.document_id
    && lines.length === 2 && links.length === 2 && hist1.length === 1 && hist1[0].action === 'import' && hist1[0].actor_uid === UID && hist1[0].inserted === 2 && hist1[0].balanced === true
    && ev1.length === 1 && ev1[0].action === 'ledger_imported';
  say('after import: source ' + JSON.stringify(s0) + '; lines ' + lines.length + ' ' + JSON.stringify(lines.map(l => [l.account_code, l.debit, l.credit, l.posted_on, l.source_row]))
    + '; links ' + links.length + '; history ' + JSON.stringify(hist1) + '; events ' + JSON.stringify(ev1.map(e => e.action)));
  if (!importOk) stop('the records after the import are not the expected ones');

  // 6 · the same file again writes nothing
  const again = await call('POST ?op=ledger-import (again)', APP_URL + '/api/upload?op=ledger-import', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId: ids.document_id, preview }),
  }, 200);
  say('again answered: ' + JSON.stringify(again));
  if (again.already_imported !== true || again.source_id !== ids.source_id) stop('the repeat import was not answered already_imported', again);
  const lines2 = await rest('gl_entries?select=id&source_id=eq.' + ids.source_id);
  if (lines2.length !== 2) stop('the repeat import changed the line count', lines2.length);

  // 7 · THE REVERSAL, through the deployed endpoint → reverse_general_ledger_import()
  const rev = await call('POST /api/upload?op=ledger-reverse', APP_URL + '/api/upload?op=ledger-reverse', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceId: ids.source_id, reason: '046 deployed smoke test: reversal' }),
  }, 200);
  say('reverse answered: ' + JSON.stringify(rev));
  if (rev.lines_removed !== 2) stop('the reversal did not remove exactly 2 lines', rev);
  const src2 = await rest('financial_sources?select=import_status,reversed_by,reversal_reason&id=eq.' + ids.source_id);
  const lines3 = await rest('gl_entries?select=id&source_id=eq.' + ids.source_id);
  const arch = await rest('gl_entries_reversed?select=id,account_code&reversed_source=eq.' + ids.source_id);
  const hist2 = await rest('ledger_import_history?select=action,actor_uid&source_id=eq.' + ids.source_id + '&order=occurred_at');
  const ev2 = await rest('property_events?select=action&property_id=eq.' + ids.property_id + '&action=like.ledger*&order=created_at');
  const r0 = src2[0] || {};
  const reverseOk = r0.import_status === 'reversed' && r0.reversed_by === UID && r0.reversal_reason === '046 deployed smoke test: reversal'
    && lines3.length === 0 && arch.length === 2 && hist2.map(h => h.action).join(',') === 'import,reverse'
    && ev2.map(e => e.action).join(',') === 'ledger_imported,ledger_import_reversed';
  say('after reversal: source ' + JSON.stringify(r0) + '; lines ' + lines3.length + '; archived ' + arch.length + '; history ' + hist2.map(h => h.action).join(',') + '; events ' + ev2.map(e => e.action).join(','));
  if (!reverseOk) stop('the records after the reversal are not the expected ones');

  // 8 · remove the prospect (the app's delete): property, review, document, source and its archive go; history stays
  const histBefore = await rest('ledger_import_history?select=id&property_id=eq.' + ids.property_id);
  await rest('rpc/delete_prospect_acquisition', { method: 'POST', body: JSON.stringify({ p_review_id: ids.review_id }) }, [200, 204]);
  const propLeft = await rest('properties?select=id&id=eq.' + ids.property_id);
  const docLeft = await rest('acquisition_documents?select=id&id=eq.' + ids.document_id);
  const srcLeft = await rest('financial_sources?select=id&id=eq.' + ids.source_id);
  const histAfter = await rest('ledger_import_history?select=action&property_id=eq.' + ids.property_id + '&order=occurred_at');
  say('after delete_prospect_acquisition: property ' + propLeft.length + ', document ' + docLeft.length + ', source ' + srcLeft.length
    + '; history ' + histBefore.length + ' → ' + histAfter.length + ' (' + histAfter.map(h => h.action).join(',') + ')');
  if (propLeft.length !== 0 || docLeft.length !== 0 || srcLeft.length !== 0) stop('the prospect was not fully removed');
  if (histAfter.map(h => h.action).join(',') !== 'import,reverse,evidence_removed') stop('the history after removal is not import,reverse,evidence_removed', histAfter);

  // 9 · remove the stored CSV (no document points at it any more, so the owner may)
  const del = await call('DELETE storage object', SUPABASE_URL + '/storage/v1/object/leases/' + ids.object_name.split('/').map(encodeURIComponent).join('/'), {
    method: 'DELETE', headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + TOKEN },
  }, 200);
  say('storage delete answered: ' + JSON.stringify(del));
  const listed = await call('storage list', SUPABASE_URL + '/storage/v1/object/list/leases', {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: UID + '/', limit: 100 }),
  }, 200);
  const stillThere = (Array.isArray(listed) ? listed : []).filter(o => o && o.name && o.name.includes('smoke'));
  say('owner folder after delete: ' + (Array.isArray(listed) ? listed.length : '?') + ' objects, smoke objects ' + stillThere.length);
  if (stillThere.length !== 0) stop('the stored CSV is still in Storage', listed);

  say('RESULT: SMOKE TEST PASSED — import and reversal reached the 046 functions through the deployed endpoints; the prospect and the stored file are removed;'
    + ' 3 append-only history rows remain by design.');
  say('IDS ' + JSON.stringify(ids));
  fs.writeFileSync(path.join(__dirname, 'smoke-046.log'), LOG.join('\n') + '\n');
  say('log written to smoke-046.log (holds no password or token)');
})().catch((e) => stop('unexpected error: ' + (e && e.stack || e)));
