'use strict';
/**
 * test-acquisition-documents.js — Acquisition Review Phase 1, increment P1-2.
 *
 *   node test-acquisition-documents.js
 *
 * Two halves. The first DRIVES acquisition-documents.js — the real module —
 * because what a caller may write is the boundary that matters: `user_id` comes
 * from the session and never from the fields offered, an unknown key is dropped
 * rather than written, an out-of-list value is normalised before a column
 * constraint ever sees it, a list never asks for the document text, and a
 * missing table is recognised and names the right migration.
 *
 * There is no endpoint. P1-2 first shipped api/acquisition-documents.js and it
 * was the thirteenth Serverless Function in api/, one past what the Hobby plan
 * deploys. The table is now written straight from the browser, the way
 * acquisition_reviews always has been, and the ownership rule it enforced is
 * migration 023's RLS policy and composite foreign key — which is where it was
 * already enforced. This suite therefore also checks that the endpoint is GONE
 * and that api/ is back inside its budget.
 *
 * The second half reads script.js, index.html and the migration as text
 * (through code(), which strips comments so a fix's own explanation cannot
 * satisfy an assertion) and pins the intake to the rules this increment exists
 * for: the row is written BEFORE extraction, a failed extraction still leaves a
 * row, what is stored is a reference and never a public URL, and the panel
 * offers a control that opens the original.
 *
 * The browser half of this increment is test-e2e-acquisition-documents.js,
 * which drives the real data layer against a Supabase stand-in that enforces
 * the owner policy and the foreign key; the migration itself is executed by
 * tools/verify-migration-023.js.
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

// ── the module, driven for real ──────────────────────────────────────────────
// No network, no stubs: this is the code the browser runs, deciding what a
// document row may contain.
const AD = require('./acquisition-documents.js');

const OWNER  = 'user-owner-0001';
const OTHER  = 'user-other-0002';
const REVIEW = 'rev-0000-0000-0001';

// Every row needs the identity of its upload (P1-3, D-14), so these helpers
// supply one unless the case under test is about it. That the identity is
// REQUIRED is asserted on its own below, and again in
// test-acquisition-classification.js where it belongs.
const INTAKE = 'ik-test-0001';
const build = (fields, reviewId = REVIEW, userId = OWNER) =>
  AD.buildPayload(reviewId, userId, Object.assign({ intakeId: INTAKE }, fields));
const payloadOf = fields => { const r = build(fields); ok(r.ok, 'build refused: ' + r.error); return r.payload; };

(async () => {

console.log('\n══ Acquisition documents — P1-2 ══');

sec('what a write may set');

t('user_id comes from the session, never from the fields offered', () => {
  const p = payloadOf({ fileName: 'lease.pdf', user_id: OTHER, userId: OTHER, uid: OTHER });
  eq(p.user_id, OWNER, 'a field overrode the session');
});

t('review_id comes from the review being viewed, not from the fields', () => {
  const p = payloadOf({ fileName: 'lease.pdf', review_id: 'some-other-review', reviewId: 'yet-another' });
  eq(p.review_id, REVIEW);
});

t('an id in the fields is ignored — the database mints it', () => {
  const p = payloadOf({ fileName: 'lease.pdf', id: 'chosen-by-caller' });
  ok(!('id' in p), JSON.stringify(p));
});

t('unknown keys are dropped rather than written', () => {
  const p = payloadOf({ fileName: 'lease.pdf', created_at: '1999-01-01', updated_at: '1999-01-01', nonsense: 1 });
  ok(!('created_at' in p) && !('updated_at' in p) && !('nonsense' in p), JSON.stringify(p));
});

t('an out-of-list parsing_status or intake_kind is normalised, not passed through', () => {
  const p = payloadOf({ fileName: 'l.pdf', parsingStatus: 'nearly', intakeKind: 'spreadsheet' });
  eq(p.parsing_status, 'pending');
  eq(p.intake_kind, 'other');
});

t('the four real statuses and both real kinds survive', () => {
  for (const s of ['pending', 'success', 'partial', 'failed']) {
    eq(payloadOf({ fileName: 'l.pdf', parsingStatus: s }).parsing_status, s, s);
  }
  for (const k of ['lease', 'invoice']) {
    eq(payloadOf({ fileName: 'l.pdf', intakeKind: k }).intake_kind, k, k);
  }
});

t('produced_kind is a tenant or an invoice or nothing at all', () => {
  eq(payloadOf({ fileName: 'l.pdf', producedKind: 'tenant' }).produced_kind, 'tenant');
  eq(payloadOf({ fileName: 'l.pdf', producedKind: 'invoice' }).produced_kind, 'invoice');
  eq(payloadOf({ fileName: 'l.pdf', producedKind: 'property' }).produced_kind, null);
});

t('used_pdf_direct is a boolean, and a truthy string is not true', () => {
  eq(payloadOf({ fileName: 'l.pdf', usedPdfDirect: true }).used_pdf_direct, true);
  eq(payloadOf({ fileName: 'l.pdf', usedPdfDirect: 'yes' }).used_pdf_direct, false);
});

t('a byte size is a non-negative whole number or nothing', () => {
  eq(payloadOf({ fileName: 'l.pdf', byteSize: '2048.7' }).byte_size, 2048);
  eq(payloadOf({ fileName: 'l.pdf', byteSize: -5 }).byte_size, null);
  eq(payloadOf({ fileName: 'l.pdf', byteSize: 'huge' }).byte_size, null);
});

t('a field that was not offered is not written at all', () => {
  const p = payloadOf({ fileName: 'l.pdf' });
  ok(!('storage_path' in p) && !('extracted_text' in p) && !('error_message' in p), JSON.stringify(p));
});

t('the text is written when it is offered — that is the point of the row', () => {
  eq(payloadOf({ fileName: 'l.pdf', extractedText: 'THE WHOLE LEASE' }).extracted_text, 'THE WHOLE LEASE');
  eq(payloadOf({ fileName: 'l.pdf', extractedText: '' }).extracted_text, null);
});

t('a long error message is kept but bounded', () => {
  const p = payloadOf({ fileName: 'l.pdf', errorMessage: 'x'.repeat(5000) });
  eq(p.error_message.length, 2000);
});

sec('a write that is not a row');

t('no review is refused', () => {
  const r = build({ fileName: 'l.pdf' }, null);
  ok(!r.ok && /reviewId/i.test(r.error), JSON.stringify(r));
});

t('no signed-in user is refused — a row must name its owner', () => {
  const r = build({ fileName: 'l.pdf' }, REVIEW, null);
  ok(!r.ok && /userId/i.test(r.error), JSON.stringify(r));
});

t('a missing fileName is refused', () => {
  const r = build({ intakeKind: 'lease' });
  ok(!r.ok && /fileName/i.test(r.error), JSON.stringify(r));
});

t('a whitespace-only fileName is refused — not a row named " "', () => {
  ok(!build({ fileName: '   ' }).ok);
});

t('no intake identity is refused — the upsert keys on it', () => {
  const r = AD.buildPayload(REVIEW, OWNER, { fileName: 'l.pdf' });
  ok(!r.ok && /intakeId/i.test(r.error), JSON.stringify(r));
});

sec('the list, the key, and a table that is not there');

t('the list does NOT ask for the document text', () => {
  ok(AD.LIST_COLUMNS.indexOf('extracted_text') === -1, AD.LIST_COLUMNS.join(','));
  ok(!/extracted_text/.test(AD.LIST_SELECT), AD.LIST_SELECT);
});

t('but it asks for everything the panel shows', () => {
  for (const c of ['id', 'file_name', 'intake_kind', 'byte_size', 'storage_path',
                   'parsing_status', 'error_message', 'produced_kind', 'produced_id', 'created_at']) {
    ok(AD.LIST_COLUMNS.indexOf(c) >= 0, 'the list never asks for ' + c);
  }
});

// P1-3 (D-14) moved this key off the file name. What it has always guaranteed
// — the two writes of one upload land on ONE row — is unchanged; what it no
// longer does is treat a re-upload of the same name as the same document and
// drop the earlier source from the record.
t('one UPLOAD is one row — the conflict key is (review_id, intake_id)', () => {
  eq(AD.CONFLICT_KEY, 'review_id,intake_id');
});

t('a missing table is recognised by its code', () => {
  ok(AD.isMissingTable({ code: '42P01' }), 'the code alone was not enough');
  ok(AD.isMissingTable({ message: 'relation "public.acquisition_documents" does not exist' }));
  ok(!AD.isMissingTable({ code: '23505', message: 'duplicate key value violates unique constraint' }));
  ok(!AD.isMissingTable({ code: '23503', message: 'violates foreign key constraint' }));
  ok(!AD.isMissingTable(null) && !AD.isMissingTable({}));
});

// Mutation testing found this in the endpoint before it was removed: both the
// reviews list and the documents panel can meet an absent table, and naming 023
// when what is missing is the reviews table sends an operator to the wrong file.
t('a missing table names the migration for THAT table', () => {
  ok(/023_acquisition_documents\.sql/.test(AD.migrationFor('acquisition_documents')));
  ok(/006_acquisition_reviews\.sql/.test(AD.migrationFor('acquisition_reviews')));
  ok(!/023/.test(AD.migrationFor('acquisition_reviews')), AD.migrationFor('acquisition_reviews'));
});

sec('the endpoint is gone, and api/ is back inside its budget');

// Vercel's Hobby plan deploys at most 12 Serverless Functions. P1-2's thirteenth
// one failed the deployment outright, so this is a build constraint, not taste.
t('api/acquisition-documents.js no longer exists', () => {
  ok(!fs.existsSync(path.join(ROOT, 'api/acquisition-documents.js')),
     'the endpoint is back — the deployment will fail on the function limit');
});

t('api/ holds no more than 12 deployable functions', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => /\.js$/.test(f) && !f.startsWith('_'));
  ok(fns.length <= 12, fns.length + ' functions: ' + fns.join(', '));
});

t('nothing in the app calls the endpoint that was removed', () => {
  for (const f of ['script.js', 'index.html', 'acquisition-documents.js']) {
    ok(!/api\/acquisition-documents/.test(code(f)), f + ' still calls it');
  }
});

t('the module is loaded by the page, before script.js uses it', () => {
  const H0 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const mod = H0.indexOf('src="acquisition-documents.js"');
  const app = H0.indexOf('src="script.js"');
  ok(mod > -1, 'index.html does not load acquisition-documents.js');
  ok(mod < app, 'it loads after script.js');
});

sec('the data layer writes the table itself, under the rules the database keeps');

{
  const S0    = code('script.js');
  const load0 = fnBody(S0, '_acqLoadDocuments');
  const save0 = fnBody(S0, '_acqSaveDocument');

  t('both halves go to acquisition_documents through the authenticated client', () => {
    ok(/db\s*\n?\s*\.from\('acquisition_documents'\)/.test(load0), 'the read does not use the db client');
    ok(/db\s*\n?\s*\.from\('acquisition_documents'\)/.test(save0), 'the write does not use the db client');
    ok(!/fetch\(/.test(load0) && !/fetch\(/.test(save0), 'it is still going through an endpoint');
  });

  t('the read is scoped to the review AND the signed-in user, oldest first', () => {
    ok(/\.eq\('review_id', reviewId\)/.test(load0), 'the read is not scoped to the review');
    ok(/\.eq\('user_id', user\.id\)/.test(load0), 'the read is not scoped to the signed-in user');
    ok(/\.order\('created_at', \{ ascending: true \}\)/.test(load0), 'the order is not the order they arrived in');
  });

  t('neither half asks the database for the document text', () => {
    ok(/\.select\(_AD\(\)\.LIST_SELECT\)/.test(load0), 'the read picks its own columns');
    ok(/\.select\(_AD\(\)\.LIST_SELECT\)/.test(save0), 'the write reads back its own columns');
  });

  t('the write upserts on the module’s conflict key', () => {
    ok(/\.upsert\(built\.payload, \{ onConflict: _AD\(\)\.CONFLICT_KEY \}\)/.test(save0), save0.slice(0, 200));
  });

  t('the owner written is the session’s, and no field can name a different one', () => {
    ok(/buildPayload\([^)]*user\.id/.test(save0), 'the payload is not built with the session user');
    ok(!/fields\.userId|fields\.user_id/.test(save0), 'a field can name the owner');
    ok(/db\.auth\.getUser\(\)/.test(save0), 'the write never asks who is signed in');
  });

  t('a write with no signed-in user writes nothing', () => {
    ok(/if \(!user\?\.id\) return null/.test(save0), save0.slice(0, 400));
  });

  t('both halves recognise a missing table and say so', () => {
    // P1-3 widened this from "the table is missing" to "the schema is behind
    // the code", which also covers a column an unapplied migration has not
    // added yet. The product behaviour it guards is unchanged.
    ok(/schemaGap\(error\)/.test(load0) && /_acqDocsMissing\(/.test(load0), 'the read does not');
    ok(/schemaGap\(error\)/.test(save0) && /_acqDocsMissing\(/.test(save0), 'the write does not');
    ok(/toast: true/.test(save0), 'nobody is told when a document is not filed');
  });

  t('the ownership rule is named where it now lives', () => {
    const mod = fs.readFileSync(path.join(ROOT, 'acquisition-documents.js'), 'utf8');
    ok(/composite foreign key/i.test(mod) && /row-level security|RLS/i.test(mod),
       'the module does not say who enforces ownership');
  });
}

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
  ok(/_acqSchemaGapFile/.test(r) && /023_acquisition_documents\.sql/.test(r),
     'it does not name a migration to run');
  const load = fnBody(S, '_acqLoadDocuments');
  ok(/schemaGap\(error\)/.test(load), 'the loader does not recognise the state');
  ok(/_acqDocsMissing\('acquisition_documents'/.test(load), 'the loader does not record it');
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
