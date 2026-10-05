'use strict';
/**
 * POST /api/upload?op=ledger-import — import a general ledger from an
 * acquisition document's STORED ORIGINAL (migration 046, Financial Intake
 * increment one).
 *
 * Not a function of its own (leading underscore): Vercel's Hobby plan deploys
 * twelve and api/ holds twelve, so api/upload.js — where the original arrived —
 * hands the request here untouched. Every check below is this module's own;
 * nothing upload.js does for an upload runs first. Each wait is capped so the
 * whole import fits inside upload.js's 30 s (4 + 4 + 8 + 10 s, plus the parse).
 *
 * The browser previews the CSV and sends only:
 *   { documentId, dateOrder?, overrideReason?, preview: { lines, debitCents,
 *     creditCents, dateOrder, fileSha256 } }
 * Nothing it sends is imported. This handler:
 *   1. verifies the person from their own token;
 *   2. reads the document AS THAT PERSON (row rules decide whether they see it);
 *   3. requires its storage path to be an acquisition original of that review,
 *      in the review owner's folder;
 *   4. downloads the stored original with the service key, refuses it over the
 *      upload limit, and hashes it (sha256) — the fingerprint is the server's;
 *   5. refuses when the previewed file is not that file (fingerprints differ);
 *   6. parses it with gl-import.js (CSV only) and the person's date order — an
 *      ambiguous file without a choice is refused, never guessed;
 *   7. refuses when the server's lines or totals differ from the preview;
 *   8. calls import_general_ledger as service_role, naming the person; the
 *      database re-checks the person's rights, the review, the stored object
 *      and the fingerprint, and imports every line or none.
 *
 * Nothing here touches the CAM tab's invoice pool (properties.data).
 */
const crypto = require('crypto');
const GL = require('../gl-import.js');
const { UUID, verifyUser, acquisitionOriginal, refusal } = require('./_ledger-common');

const SHA = /^[0-9a-f]{64}$/;

/** A response body, read to at most `max` bytes; null (and the stream cancelled) past that. */
async function readCapped(body, max) {
  if (!body) return Buffer.alloc(0);
  const chunks = [];
  let n = 0;
  for await (const c of body) {
    n += c.length;
    if (n > max) return null;   // leaving the loop cancels the stream
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks, n);
}
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

function createHandler(deps) {
  const t = deps.target;
  const fetchFn = deps.fetch || fetch;
  const rate = deps.rate || require('./_rate-limit');
  const log = deps.log || console.error;

  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    if (!t.serviceRoleKey) return res.status(503).json({ error: 'Ledger import is not configured on this server' });

    const user = await verifyUser(t, fetchFn, req, res);
    if (!user) return;
    const rl = rate.checkRate('ledger-import:' + user.id, 10, 60000);
    if (!rl.ok) return rate.sendRateLimited(res, rl);

    const b = req.body || {};
    const p = b.preview || {};
    if (!UUID.test(String(b.documentId || ''))) return res.status(400).json({ error: 'documentId is required' });
    if (b.dateOrder != null && b.dateOrder !== 'mdy' && b.dateOrder !== 'dmy') return res.status(400).json({ error: 'dateOrder must be mdy or dmy' });
    if (!isCount(p.lines) || !Number.isSafeInteger(p.debitCents) || !Number.isSafeInteger(p.creditCents)
        || !SHA.test(String(p.fileSha256 || '')) || !['iso', 'mdy', 'dmy'].includes(p.dateOrder)) {
      return res.status(400).json({ error: 'preview must carry lines, debitCents, creditCents, dateOrder and the previewed file\'s fileSha256' });
    }
    const overrideReason = b.overrideReason == null ? null : String(b.overrideReason).slice(0, 1000);

    // 2 · the document, as the person sees it
    let doc;
    try {
      const r = await fetchFn(`${t.url}/rest/v1/acquisition_documents?id=eq.${b.documentId}&select=id,review_id,property_id,user_id,storage_path,file_name`, {
        signal: AbortSignal.timeout(4000),
        headers: { apikey: t.anonKey, Authorization: `Bearer ${user.token}`, Accept: 'application/json' },
      });
      if (!r.ok) { const f = refusal(r.status, await r.text(), log); return res.status(f.http).json(f.body); }
      doc = (await r.json())[0];
    } catch (e) {
      return res.status(502).json({ error: 'Could not read the document' });
    }
    if (!doc) return res.status(404).json({ error: 'That document is not one you can see' });

    // 3 · its stored original
    const obj = acquisitionOriginal(doc.storage_path, doc.user_id, doc.review_id);
    if (!obj) return res.status(422).json({ error: 'This document has no stored acquisition original to import from' });

    // 4 · download and fingerprint it here
    let bytes;
    try {
      const r = await fetchFn(`${t.url}/storage/v1/object/${obj.bucket}/${obj.name.split('/').map(encodeURIComponent).join('/')}`, {
        signal: AbortSignal.timeout(8000),
        headers: { apikey: t.serviceRoleKey, Authorization: `Bearer ${t.serviceRoleKey}` },
      });
      if (r.status === 404) return res.status(404).json({ error: 'The stored original is no longer in storage' });
      if (!r.ok) return res.status(502).json({ error: 'Storage would not return the stored original' });
      const declared = Number(r.headers.get('content-length'));
      if (declared > GL.MAX_FILE_BYTES) return res.status(413).json({ error: 'The stored original is larger than a ledger import allows' });
      // Counted as it arrives, not trusted from the header: a reply without a
      // Content-Length, or with a wrong one, is cut off one byte past the limit.
      bytes = await readCapped(r.body, GL.MAX_FILE_BYTES);
      if (bytes === null) return res.status(413).json({ error: 'The stored original is larger than a ledger import allows' });
    } catch (e) {
      return res.status(502).json({ error: 'Could not download the stored original' });
    }
    if (bytes.length === 0) return res.status(422).json({ error: 'The stored original is empty', code: 'not_a_csv_ledger' });   // readCapped has already held it to the limit
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

    // 5 · the previewed file must be this file
    if (p.fileSha256 !== sha256) {
      return res.status(409).json({ error: 'The file that was previewed is not the stored original. Preview the stored file again.', code: 'fingerprint_mismatch' });
    }

    // 6 · read it as the preview did
    const csv = GL.readCsvFile(bytes);
    if (csv.error) return res.status(422).json({ error: csv.error, code: 'not_a_csv_ledger' });
    const parsed = GL.parseRows(csv.rows, { dateOrder: b.dateOrder || undefined, maxRows: GL.IMPORT_MAX_ROWS });
    if (parsed.needsDateOrder) return res.status(422).json({ error: parsed.errors[0].message, code: 'date_order_required' });
    if (!parsed.ok) return res.status(422).json({ error: 'The ledger has errors; nothing was imported.', code: 'ledger_errors', errors: parsed.errors.slice(0, 50) });

    // 7 · the server's reading must be what the person saw
    const payload = GL.importPayload(parsed);
    const s = payload.summary;
    if (s.lines !== p.lines || s.debitCents !== p.debitCents || s.creditCents !== p.creditCents || s.dateOrder !== p.dateOrder) {
      return res.status(409).json({ error: `The stored file reads as ${s.lines} lines, debits ${s.debitCents}, credits ${s.creditCents} (dates ${s.dateOrder}); the preview showed ${p.lines}, ${p.debitCents}, ${p.creditCents} (${p.dateOrder}). Nothing was imported.`, code: 'preview_mismatch' });
    }

    // 8 · the database imports it, all or nothing
    let r, text;
    try {
      r = await fetchFn(`${t.url}/rest/v1/rpc/import_general_ledger`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { apikey: t.serviceRoleKey, Authorization: `Bearer ${t.serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_actor: user.id, p_document_id: doc.id,
          p_file: { sha256, bytes: bytes.length, storagePath: doc.storage_path },
          p_payload: payload,
          p_preview: { lines: p.lines, debitCents: p.debitCents, creditCents: p.creditCents, dateOrder: p.dateOrder, fileSha256: p.fileSha256 },
          p_override_reason: overrideReason,
        }),
      });
      text = await r.text();
    } catch (e) {
      // The database stops the statement at 8 s and rolls it back; this wait is
      // longer. If it lapses anyway, the outcome is unknown here — say so. A
      // retry of the same file is safe: it is answered already_imported.
      return res.status(504).json({ error: 'The import did not answer in time. Check the import history before trying again; importing the same file again is safe.', code: 'outcome_unknown' });
    }
    if (!r.ok) { const f = refusal(r.status, text, log); return res.status(f.http).json(f.body); }
    let result;
    try { result = JSON.parse(text); } catch (_) { return res.status(502).json({ error: 'The database returned an unreadable result' }); }
    return res.status(200).json(result);
  };
}

module.exports = createHandler({ target: require('./_pilot-target') });
module.exports.createHandler = createHandler;
