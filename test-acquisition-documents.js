'use strict';
/**
 * test-acquisition-documents.js — Acquisition Review Phase 1, increment P1-2.
 *
 *   node test-acquisition-documents.js
 *
 * Two halves. The first DRIVES /api/acquisition-documents — the real handler,
 * with Supabase's REST API stubbed — because the ownership rule and the write
 * allow-list are this endpoint's security boundary: a caller may touch a
 * document only through a review they own, `user_id` comes from the verified
 * token and never from the body, and a missing table says so rather than
 * looking like a review with no documents. The second reads script.js,
 * index.html and the migration as text (through code(), which strips comments
 * so a fix's own explanation cannot satisfy an assertion) and pins the intake
 * to the rules this increment exists for: the row is written BEFORE extraction,
 * a failed extraction still leaves a row, what is stored is a reference and
 * never a public URL, and the panel offers a control that opens the original.
 *
 * The browser half of this increment is test-e2e-acquisition-documents.js; the
 * migration itself is executed by tools/verify-migration-023.js.
 */
const fs   = require('fs');
const path = require('path');
const ROOT = __dirname;

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
async function ta(name, fn) {
  try { await fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }

function code(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*|--)/.test(l))
    .join('\n');
}
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function ' + name + ' not found');
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j === -1 ? undefined : j + 2);
}

// ── the endpoint, driven for real ───────────────────────────────────────────
// Supabase is stubbed at fetch(). Every request it receives is recorded, so the
// assertions are about what the handler actually asked the database for.
const OWNER  = 'user-owner-0001';
const OTHER  = 'user-other-0002';
const REVIEW = 'rev-0000-0000-0001';

let calls = [];
let sbBehaviour = 'normal';   // 'normal' | 'missing_table'

function installFetch() {
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null,
                 headers: opts.headers || {} });

    if (u.includes('/auth/v1/user')) {
      const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
      const tok  = auth.replace(/^Bearer\s+/, '');
      if (tok === 'token-owner') return { ok: true, json: async () => ({ id: OWNER, email: 'owner@example.com' }) };
      if (tok === 'token-other') return { ok: true, json: async () => ({ id: OTHER, email: 'other@example.com' }) };
      return { ok: false, json: async () => ({}) };
    }

    if (sbBehaviour === 'missing_table' && u.includes('/acquisition_documents')) {
      return { status: 404, text: async () => JSON.stringify({ code: '42P01', message: 'relation "public.acquisition_documents" does not exist' }) };
    }

    if (u.includes('/acquisition_reviews')) {
      if (sbBehaviour === 'missing_reviews') {
        return { status: 404, text: async () => JSON.stringify({ code: '42P01', message: 'relation "public.acquisition_reviews" does not exist' }) };
      }
      // The handler asks: does this review belong to this user?
      const ownedByOwner = u.includes(`user_id=eq.${OWNER}`) && u.includes(`id=eq.${REVIEW}`);
      return { status: 200, text: async () => JSON.stringify(ownedByOwner ? [{ id: REVIEW }] : []) };
    }

    if (u.includes('/acquisition_documents')) {
      if ((opts.method || 'GET') === 'POST') {
        const sent = JSON.parse(opts.body);
        return { status: 201, text: async () => JSON.stringify([{ id: 'doc-1', extracted_text: 'SHOULD NOT BE ECHOED', ...sent }]) };
      }
      return { status: 200, text: async () => JSON.stringify([{ id: 'doc-1', file_name: 'lease.pdf' }]) };
    }
    return { status: 500, text: async () => '{}' };
  };
}

function mkRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.status = c => { res.statusCode = c; return res; };
  res.json   = b => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
async function call(method, { token = 'token-owner', body = null, query = null } = {}) {
  calls = [];
  const res = mkRes();
  await handler({ method, headers: token ? { authorization: 'Bearer ' + token } : {}, body, query }, res);
  return res;
}

process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
installFetch();
const handler = require('./api/acquisition-documents.js');

(async () => {

console.log('\n══ Acquisition documents — P1-2 ══');

sec('the endpoint — authentication and ownership');

await ta('no token is 401', async () => {
  const r = await call('GET', { token: null, query: { reviewId: REVIEW } });
  eq(r.statusCode, 401);
});

await ta('an unrecognised token is 401', async () => {
  const r = await call('GET', { token: 'token-nobody', query: { reviewId: REVIEW } });
  eq(r.statusCode, 401);
});

await ta('a review the caller does not own is 403 — on read', async () => {
  const r = await call('GET', { token: 'token-other', query: { reviewId: REVIEW } });
  eq(r.statusCode, 403);
});

await ta('a review the caller does not own is 403 — on write', async () => {
  const r = await call('POST', { token: 'token-other', body: { reviewId: REVIEW, fileName: 'x.pdf' } });
  eq(r.statusCode, 403);
  ok(!calls.some(c => c.method === 'POST' && c.url.includes('/acquisition_documents')),
     'a refused caller still reached the documents table');
});

await ta('ownership is checked against acquisition_reviews, not properties', async () => {
  await call('GET', { query: { reviewId: REVIEW } });
  const check = calls.find(c => c.url.includes('/acquisition_reviews'));
  ok(check, 'no ownership lookup was made');
  ok(check.url.includes(`id=eq.${REVIEW}`) && check.url.includes(`user_id=eq.${OWNER}`), check.url);
  ok(!calls.some(c => c.url.includes('/properties')), 'it joined through properties — that is the managed-property model');
});

sec('the endpoint — what a write may set');

await ta('user_id comes from the token, never from the body', async () => {
  const r = await call('POST', { body: { reviewId: REVIEW, fileName: 'lease.pdf', user_id: OTHER, userId: OTHER } });
  eq(r.statusCode, 200);
  const write = calls.find(c => c.method === 'POST' && c.url.includes('/acquisition_documents'));
  eq(write.body.user_id, OWNER, 'the body overrode the token');
});

await ta('an id in the body is ignored — the database mints it', async () => {
  await call('POST', { body: { reviewId: REVIEW, fileName: 'lease.pdf', id: 'chosen-by-caller' } });
  const write = calls.find(c => c.method === 'POST' && c.url.includes('/acquisition_documents'));
  ok(!('id' in write.body), JSON.stringify(write.body));
});

await ta('unknown keys are dropped rather than forwarded', async () => {
  await call('POST', { body: { reviewId: REVIEW, fileName: 'lease.pdf', created_at: '1999-01-01', nonsense: 1, review_id: 'other-review' } });
  const write = calls.find(c => c.method === 'POST' && c.url.includes('/acquisition_documents'));
  ok(!('created_at' in write.body) && !('nonsense' in write.body), JSON.stringify(write.body));
  eq(write.body.review_id, REVIEW, 'review_id must come from the checked reviewId');
});

await ta('an out-of-list parsing_status or intake_kind is normalised, not passed through', async () => {
  await call('POST', { body: { reviewId: REVIEW, fileName: 'l.pdf', parsingStatus: 'nearly', intakeKind: 'spreadsheet' } });
  const write = calls.find(c => c.method === 'POST' && c.url.includes('/acquisition_documents'));
  eq(write.body.parsing_status, 'pending');
  eq(write.body.intake_kind, 'other');
});

await ta('the four real statuses and both real kinds survive', async () => {
  for (const s of ['pending', 'success', 'partial', 'failed']) {
    await call('POST', { body: { reviewId: REVIEW, fileName: 'l.pdf', parsingStatus: s } });
    eq(calls.find(c => c.method === 'POST' && c.url.includes('/acquisition_documents')).body.parsing_status, s, s);
  }
  for (const k of ['lease', 'invoice']) {
    await call('POST', { body: { reviewId: REVIEW, fileName: 'l.pdf', intakeKind: k } });
    eq(calls.find(c => c.method === 'POST' && c.url.includes('/acquisition_documents')).body.intake_kind, k, k);
  }
});

await ta('a missing fileName is 400, and nothing is written', async () => {
  const r = await call('POST', { body: { reviewId: REVIEW } });
  eq(r.statusCode, 400);
  ok(!calls.some(c => c.method === 'POST' && c.url.includes('/acquisition_documents')));
});

await ta('a whitespace-only fileName is 400 — not a row named " "', async () => {
  const r = await call('POST', { body: { reviewId: REVIEW, fileName: '   ' } });
  eq(r.statusCode, 400);
});

await ta('the write upserts on (review_id, file_name)', async () => {
  await call('POST', { body: { reviewId: REVIEW, fileName: 'lease.pdf' } });
  const write = calls.find(c => c.method === 'POST' && c.url.includes('/acquisition_documents'));
  ok(write.url.includes('on_conflict=review_id,file_name'), write.url);
  ok(String(write.headers.Prefer || '').includes('merge-duplicates'), JSON.stringify(write.headers));
});

await ta('the response does not echo the document text back', async () => {
  const r = await call('POST', { body: { reviewId: REVIEW, fileName: 'lease.pdf', extractedText: 'the whole lease' } });
  eq(r.statusCode, 200);
  ok(!('extracted_text' in r.body.data[0]), Object.keys(r.body.data[0]).join(','));
});

sec('the endpoint — reading');

await ta('a list asks for the review, ordered, and NOT for the text', async () => {
  const r = await call('GET', { query: { reviewId: REVIEW } });
  eq(r.statusCode, 200);
  const q = calls.find(c => c.url.includes('/acquisition_documents'));
  ok(q.url.includes(`review_id=eq.${REVIEW}`), q.url);
  ok(q.url.includes('order=created_at.asc'), q.url);
  ok(!/select=[^&]*extracted_text/.test(q.url), 'the list asked for extracted_text: ' + q.url);
  ok(/select=[^&]*storage_path/.test(q.url) && /select=[^&]*parsing_status/.test(q.url), q.url);
});

await ta('a list with no reviewId is 400', async () => {
  eq((await call('GET', {})).statusCode, 400);
});

sec('the endpoint — refusals that must stay refusals');

await ta('DELETE is 405 and says why', async () => {
  const r = await call('DELETE', { query: { id: 'doc-1' } });
  eq(r.statusCode, 405);
  ok(/preserved/i.test(r.body.error), r.body.error);
  ok(!calls.some(c => c.method === 'DELETE'), 'it reached the database anyway');
});

await ta('PUT and PATCH are 405', async () => {
  eq((await call('PUT',   { body: {} })).statusCode, 405);
  eq((await call('PATCH', { body: {} })).statusCode, 405);
});

sec('the endpoint — a missing table is said out loud');

await ta('a read against a missing documents table is 503 naming migration 023', async () => {
  sbBehaviour = 'missing_table';
  const r = await call('GET', { query: { reviewId: REVIEW } });
  sbBehaviour = 'normal';
  eq(r.statusCode, 503);
  eq(r.body.code, 'migration_missing');
  eq(r.body.table, 'acquisition_documents');
  ok(/023_acquisition_documents\.sql/.test(r.body.error), r.body.error);
});

await ta('and a write against a missing documents table is 503, not a silent success', async () => {
  sbBehaviour = 'missing_table';
  const r = await call('POST', { body: { reviewId: REVIEW, fileName: 'lease.pdf' } });
  sbBehaviour = 'normal';
  eq(r.statusCode, 503);
  eq(r.body.code, 'migration_missing');
  eq(r.body.table, 'acquisition_documents');
});

// Found by tools/acquisition-documents-mutation.js: this branch is a DIFFERENT
// missing table — the ownership lookup reads acquisition_reviews — and naming
// 023 here would send an operator to the wrong file.
await ta('a missing REVIEWS table names migration 006, not 023 — on read', async () => {
  sbBehaviour = 'missing_reviews';
  const r = await call('GET', { query: { reviewId: REVIEW } });
  sbBehaviour = 'normal';
  eq(r.statusCode, 503);
  eq(r.body.code, 'migration_missing');
  eq(r.body.table, 'acquisition_reviews');
  ok(/006_acquisition_reviews\.sql/.test(r.body.error), r.body.error);
  ok(!/023/.test(r.body.error), r.body.error);
});

await ta('…and on write, where it must not read as 403 either', async () => {
  sbBehaviour = 'missing_reviews';
  const r = await call('POST', { body: { reviewId: REVIEW, fileName: 'lease.pdf' } });
  sbBehaviour = 'normal';
  eq(r.statusCode, 503);
  eq(r.body.table, 'acquisition_reviews');
  ok(/006_acquisition_reviews\.sql/.test(r.body.error), r.body.error);
});

t('the migration-missing predicate recognises the code and the message', () => {
  ok(handler._isMigrationMissing({ code: '42P01' }));
  ok(handler._isMigrationMissing([{ message: 'relation "x" does not exist' }]));
  ok(!handler._isMigrationMissing({ code: '23505', message: 'duplicate key' }));
  ok(!handler._isMigrationMissing(null));
});

// ── the migration ───────────────────────────────────────────────────────────
sec('the migration says what it is for and what it is not');

const M = fs.readFileSync(path.join(ROOT, 'migrations/023_acquisition_documents.sql'), 'utf8');
const RB = fs.readFileSync(path.join(ROOT, 'migrations/023_acquisition_documents_rollback.sql'), 'utf8');

t('it is marked pilot-only and names production as off limits', () => {
  ok(/PILOT PROJECT ONLY/i.test(M) && /bhmktujbxdbvdmpybmad/.test(M), 'pilot target');
  ok(/NEVER apply to production/i.test(M) && /zhsuhehgehbzkmzurzyf/.test(M), 'production named');
});

t('it is re-runnable by construction', () => {
  ok(/create table if not exists public\.acquisition_documents/.test(M));
  ok(!/create table public\.acquisition_documents/.test(M.replace(/if not exists /g, 'if not exists ')));
  ok(/create index if not exists/.test(M));
  ok(/drop policy if exists/.test(M));
  ok(/drop trigger if exists/.test(M));
});

t('RLS is enabled, with an owner policy and no anon policy', () => {
  ok(/alter table public\.acquisition_documents enable row level security/.test(M));
  ok(/create policy "acq_docs_owner_all"/.test(M));
  ok(/user_id = auth\.uid\(\)/.test(M));
  ok(!/to anon/.test(M), 'a policy names anon');
});

t('the owner cannot disagree with the review — the composite foreign key', () => {
  ok(/foreign key \(review_id, user_id\)/.test(M));
  ok(/references public\.acquisition_reviews \(id, user_id\)/.test(M));
  ok(/on delete cascade/.test(M));
  ok(/acquisition_reviews_id_user_id_key/.test(M), 'the parent unique constraint');
});

t('it carries no classification, family or version column — that is P1-3', () => {
  for (const forbidden of ['doc_type', 'family_id', 'version_no', 'supersedes']) {
    ok(!new RegExp('^\\s*' + forbidden + '\\s', 'm').test(M), 'declares ' + forbidden);
  }
  ok(/intake_kind/.test(M), 'intake_kind is the one this increment does know');
});

t('storage_path is nullable and documented as a reference, not a URL', () => {
  ok(/storage_path\s+text,/.test(M), 'not NOT NULL');
  ok(/never a\s*\n?--\s*public URL|never a public URL/i.test(M) || /SEC-1/.test(M), 'SEC-1 note');
});

t('the rollback removes the table and the constraint it added', () => {
  ok(/drop table if exists public\.acquisition_documents cascade/.test(RB));
  ok(/drop constraint if exists acquisition_reviews_id_user_id_key/.test(RB));
  ok(!/drop table[^\n]*acquisition_reviews\b(?!_)/.test(RB), 'the rollback drops the reviews table');
});

// ── the upload allow-list ───────────────────────────────────────────────────
sec('the upload endpoint accepts what the acquisition UI offers');

const U = code('api/upload.js');
const H = code('index.html');

t('txt and webp are allowed, with their canonical types', () => {
  ok(/txt:\s*'text\/plain'/.test(U), 'txt');
  ok(/webp:\s*'image\/webp'/.test(U), 'webp');
});

t('every extension the acquisition pickers accept can actually be stored', () => {
  const accepts = [...H.matchAll(/id="acq(?:Lease|Invoice)Input"[^>]*accept="([^"]+)"/g)].map(m => m[1]);
  ok(accepts.length === 2, 'expected both acquisition file inputs, found ' + accepts.length);
  const exts = new Set(accepts.join(',').split(',').map(s => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean));
  ok(exts.size >= 5, [...exts].join(','));
  for (const ext of exts) {
    ok(new RegExp('^\\s*' + ext + ':\\s*\'', 'm').test(U), `the UI accepts .${ext} but /api/upload would refuse it`);
  }
});

t('the bucket list is unchanged — no new bucket, no new storage policy', () => {
  ok(/ALLOWED_BUCKETS = \['invoices', 'leases'\]/.test(U), 'the bucket allow-list changed');
});

// ── the intake ──────────────────────────────────────────────────────────────
sec('the intake — the rules this increment exists for');

const S = code('script.js');
const lease   = fnBody(S, 'acqHandleLeaseFiles');
const invoice = fnBody(S, 'acqHandleInvoiceFiles');

t('the row is written BEFORE anything is extracted, for both kinds', () => {
  for (const [label, body] of [['lease', lease], ['invoice', invoice]]) {
    const rowAt     = body.indexOf('_acqSaveDocument({');
    const extractAt = Math.min(...[body.indexOf('_acqStoreOriginal'), body.indexOf('callClaude')].filter(i => i > -1));
    ok(rowAt > -1, label + ': no row is written at all');
    ok(rowAt < extractAt, `${label}: extraction starts before the row exists (${rowAt} vs ${extractAt})`);
    ok(/parsingStatus:\s*'pending'/.test(body.slice(rowAt, extractAt)), label + ': the first write is not pending');
  }
});

t('a failed extraction still leaves a row, with its reason', () => {
  for (const [label, body] of [['lease', lease], ['invoice', invoice]]) {
    const cat = body.slice(body.indexOf('} catch'));
    ok(/_acqSaveDocument\(/.test(cat), label + ': the catch writes no row');
    ok(/parsingStatus:\s*'failed'/.test(cat), label + ': the row does not say it failed');
    ok(/errorMessage:/.test(cat), label + ': the row carries no reason');
  }
});

t('the original is stored for both kinds, and a failure to store is reported', () => {
  ok(/_acqStoreOriginal\(file, review\.id\)/.test(lease), 'lease');
  ok(/_acqStoreOriginal\(file, review\.id\)/.test(invoice), 'invoice');
  const store = fnBody(S, '_acqStoreOriginal');
  ok(/checkUploadSize/.test(store), 'no size pre-flight');
  ok(/return \{ ref: null, reason \}/.test(store), 'an over-size file is not reported as "not stored"');
  ok(/bucket: 'leases'/.test(store), 'it does not use the existing private bucket');
  ok(/acq\/\$\{reviewId\}\/\$\{Date\.now\(\)\}-\$\{file\.name\}/.test(store), 'the agreed storage naming');
});

t('what is stored is a reference — a public URL is never minted here', () => {
  ok(!/object\/public/.test(S.slice(S.indexOf('_acqStoreOriginal'), S.indexOf('_acqProducedLabel'))),
     'the acquisition upload path mentions a public object URL');
  ok(/storagePath: storage\.ref/.test(lease) && /storagePath: storage\.ref/.test(invoice));
});

t('a scanned lease is still transcribed, so the document can be read later', () => {
  ok(/extractTextFromPdfDirect\(file\)/.test(lease), 'no vision transcription pass');
  ok(/storedText \? 'success' : 'partial'/.test(lease), 'a document with no stored text still claims success');
});

t('the lease row names the tenant it produced; the invoice row names its invoice', () => {
  ok(/producedKind: 'tenant', producedId: normalized\.id/.test(lease), 'lease');
  ok(/producedKind: 'invoice', producedId: placeholder\.id/.test(invoice), 'invoice');
});

t('opening a review loads its documents and renders them', () => {
  const sel = fnBody(S, 'selectAcquisitionReview');
  ok(/_renderAcqDocuments\(\)/.test(sel), 'the panel is not rendered');
  ok(/_acqLoadDocuments\(id\)/.test(sel), 'the documents are not loaded');
});

t('the panel offers a control that opens a stored original (ARCH §9)', () => {
  const r = fnBody(S, '_renderAcqDocuments');
  ok(/docLinkHtml\(r\.storage_path/.test(r), 'no opener is rendered');
  ok(/Original not on file/.test(r), 'a document with no stored original says nothing about it');
});

t('a missing table is said on screen, not shown as "no documents"', () => {
  const r = fnBody(S, '_renderAcqDocuments');
  ok(/_acqDocsUnavailable/.test(r), 'the panel does not know the table can be absent');
  ok(/023_acquisition_documents\.sql/.test(r), 'it does not name the migration');
  const load = fnBody(S, '_acqLoadDocuments');
  ok(/migration_missing/.test(load), 'the loader does not recognise the state');
});

t('uploads keep working when the table is absent — extraction is not held hostage', () => {
  const save = fnBody(S, '_acqSaveDocument');
  ok(/if \(_acqDocsUnavailable\) return null/.test(save), 'it keeps retrying a table that is not there');
  ok(!/throw/.test(save), 'a document write can throw into the intake loop');
});

t('the activity entry carries the document ids', () => {
  ok(/documentIds/.test(lease) && /documentIds/.test(invoice));
});

t('index.html has the Documents panel', () => {
  ok(/id="acqDocsList"/.test(H) && /id="acqDocsCount"/.test(H));
  ok(/\.acq-doc-open\s*\{/.test(H), 'no style for the opener');
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);

})();
