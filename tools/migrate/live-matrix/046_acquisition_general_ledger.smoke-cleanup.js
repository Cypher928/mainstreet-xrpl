#!/usr/bin/env node
'use strict';
/*
 * smoke-046-cleanup.js — remove the ONE storage object the 046 smoke test left behind.
 *
 * This is step 9 of smoke-046.js on its own: sign in as the test owner, confirm the
 * owner's folder in bucket `leases` holds exactly the smoke CSV (189 bytes), delete
 * that one object through the Storage API, and confirm the folder is empty.
 * It touches nothing else. It never prints the password or the token.
 *
 *   cd ~/Downloads && node smoke-046-cleanup.js
 */
const fs = require('fs');
const path = require('path');

const PILOT_REF = 'bhmktujbxdbvdmpybmad';
const SUPABASE_URL = 'https://bhmktujbxdbvdmpybmad.supabase.co';
const ANON_KEY = 'sb_publishable__Gi3NcVbKmnhu4SfjUxLHw_QpZMYEz1';          // Pilot's publishable key (supabase-config.js; safe to share)
const EMAIL = 'pilot-tenant-a@mainstreet-test.local';
const OWNER_UID = '1c682d8e-0fcb-42c9-9d91-95b9524bb113';
const OBJECT_NAME = '1c682d8e-0fcb-42c9-9d91-95b9524bb113/acq_1e0d6aca-bfb6-4e6c-8bd5-eae0a9b31789_1791387133796-smoke.csv';
const OBJECT_BYTES = 189;

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) { console.error('Node 18 or newer is needed (this is ' + process.version + '). Nothing sent.'); process.exit(64); }
if (!SUPABASE_URL.includes(PILOT_REF) || /zhsuhehgehbzkmzurzyf/.test(SUPABASE_URL)) { console.error('Refusing: not the Pilot project. Nothing sent.'); process.exit(65); }
const DONE = path.join(__dirname, '.smoke-046-cleanup.done');
if (fs.existsSync(DONE)) { console.error('Refusing: ' + DONE + ' exists — the cleanup already ran here once. Do not re-run; report the earlier output.'); process.exit(67); }

const LOG = [];
const say = (s) => { const line = new Date().toISOString() + ' ' + s; console.log(line); LOG.push(line); };
function finish(code) { fs.writeFileSync(path.join(__dirname, 'smoke-046-cleanup.log'), LOG.join('\n') + '\n'); process.exit(code); }
function stop(what, extra) {
  say('STOP: ' + what);
  if (extra !== undefined) say('  saw: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 1200));
  say('  Nothing was retried. Report this output; the state is left for a read-only inspection.');
  finish(1);
}
function readPassword() {
  for (const name of ['.smoke-046.password', 'smoke-046.password.txt']) {
    const pf = path.join(__dirname, name);
    if (fs.existsSync(pf)) { const v = fs.readFileSync(pf, 'utf8').trim(); if (v) { say('password source: file ' + name + ' (' + v.length + ' chars, never printed)'); return v; } }
  }
  console.error('No password file (smoke-046.password.txt) next to the script. Nothing sent.'); process.exit(64);
}
async function call(label, url, opts, expectStatus) {
  let r, text;
  try { r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(30000) }, opts)); text = await r.text(); }
  catch (e) { stop(label + ' failed to connect: ' + (e && e.message || e)); }
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  say(label + ': HTTP ' + r.status + (r.status === expectStatus ? '' : ' (expected ' + expectStatus + ')'));
  if (r.status !== expectStatus) stop(label + ' answered HTTP ' + r.status, text);
  return json === null ? text : json;
}

(async () => {
  const password = readPassword();
  say('---- 046 smoke-test cleanup, Pilot ' + PILOT_REF + ', account ' + EMAIL + ', one object: ' + OBJECT_NAME);

  const auth = await call('sign-in', SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password }),
  }, 200);
  const TOKEN = auth.access_token, UID = auth.user && auth.user.id;
  if (!TOKEN || UID !== OWNER_UID) stop('signed-in user is not the OWNER test account', { uid: UID });
  say('signed in as ' + UID.slice(0, 8) + '… (token held in memory only)');
  const hdr = { apikey: ANON_KEY, Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
  const list = () => call('storage list (owner folder)', SUPABASE_URL + '/storage/v1/object/list/leases', {
    method: 'POST', headers: hdr, body: JSON.stringify({ prefix: UID + '/', limit: 100 }),
  }, 200);

  // before: the folder must hold exactly the one smoke object, 189 bytes
  const before = await list();
  const names = (Array.isArray(before) ? before : []).map(o => UID + '/' + o.name);
  say('owner folder before: ' + names.length + ' object(s): ' + JSON.stringify(names));
  if (names.length !== 1 || names[0] !== OBJECT_NAME) stop('the owner folder does not hold exactly the one smoke object', before);
  const size = before[0].metadata && Number(before[0].metadata.size);
  if (size !== OBJECT_BYTES) stop('the smoke object is not ' + OBJECT_BYTES + ' bytes', before[0].metadata);
  say('confirmed: one object, ' + size + ' bytes, mimetype ' + (before[0].metadata && before[0].metadata.mimetype));

  fs.writeFileSync(DONE, new Date().toISOString() + '\n');
  const del = await call('DELETE storage object', SUPABASE_URL + '/storage/v1/object/leases/' + OBJECT_NAME.split('/').map(encodeURIComponent).join('/'), {
    method: 'DELETE', headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + TOKEN },
  }, 200);
  say('storage delete answered: ' + JSON.stringify(del).slice(0, 300));

  const after = await list();
  const left = (Array.isArray(after) ? after : []).length;
  say('owner folder after: ' + left + ' object(s)');
  if (left !== 0) stop('the owner folder is not empty after the delete', after);

  say('RESULT: CLEANUP DONE — the one smoke-test storage object is removed; nothing else was touched.');
  finish(0);
})().catch((e) => stop('unexpected error: ' + (e && e.stack || e)));
