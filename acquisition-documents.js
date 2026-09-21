'use strict';
/**
 * acquisition-documents.js — what may be written about a document, and how a
 * document row is addressed.
 *
 * Phase 1 of Acquisition Review (docs/ACQUISITION_REVIEW.md), increment P1-2.
 *
 * WHY THIS IS A MODULE AND NOT AN ENDPOINT
 *
 * P1-2 first shipped its own serverless function, api/acquisition-documents.js,
 * which held the service-role key, checked the review's owner before every read
 * and write, and wrote user_id from the verified token. It was the thirteenth
 * function in api/, and the deployment refused it: Vercel's Hobby plan allows
 * twelve. The table it fronted was already reachable the way acquisition_reviews
 * has always been reached — browser to Supabase, authenticated, under RLS — so
 * the function was removed and the same rules are now stated here and enforced
 * by the database.
 *
 * WHO ENFORCES THE OWNERSHIP RULE NOW
 *
 * The database, which is where it was already being enforced. A document row
 * may exist only if the review it names belongs to the user it names:
 *
 *   - RLS (migration 023, policy acq_docs_owner_all) admits a row only where
 *     user_id = auth.uid(), for select, insert, update and delete alike. There
 *     is no anon policy, so an unauthenticated caller sees nothing at all.
 *   - The composite foreign key (review_id, user_id) → acquisition_reviews
 *     (id, user_id) then refuses a document whose review does not belong to
 *     that same user. A caller who names someone else's review gets their OWN
 *     id written into user_id by `buildPayload` below, so the pair does not
 *     exist in the parent table and the insert fails.
 *
 * Together those are the check the endpoint used to make, held one layer lower,
 * where a wrong line in this file cannot get past them. That was the point of
 * the composite key when migration 023 was written.
 *
 * WHAT THIS MODULE IS
 *
 * Pure: no DOM, no network, no globals. It decides what a caller may write
 * (`WRITABLE`, `buildPayload`), which columns a list asks for (`LIST_COLUMNS`,
 * which excludes the document text), and how to recognise the table being
 * absent (`isMissingTable`, `migrationFor`). script.js's data layer applies the
 * result through the authenticated Supabase client; nothing here talks to it.
 *
 * NO DELETE. Preserving every source is the point of this increment. There is
 * no remove-a-document path in the data layer and no control for one; removing
 * a source would be an explicit archive workflow with its own column and its
 * own approval.
 */
(function (root) {

  // The columns a LIST asks for. extracted_text is deliberately absent: it is
  // the largest column in the table and a list of documents does not need it.
  // The text is read by the increments that use it (P1-4 abstraction, P1-9
  // Q&A), one document at a time.
  var LIST_COLUMNS = [
    'id', 'review_id', 'file_name', 'intake_kind', 'byte_size', 'content_type',
    'storage_path', 'parsing_status', 'extraction_model', 'used_pdf_direct',
    'error_message', 'produced_kind', 'produced_id', 'created_at', 'updated_at',
  ];
  var LIST_SELECT = LIST_COLUMNS.join(', ');

  // The key one file is filed under. Calling the save twice for the same file —
  // once when it arrives, once when its extraction lands — updates one row
  // rather than filing two. The database holds this as a unique constraint, so
  // it is true even if a second tab writes at the same moment.
  var CONFLICT_KEY = 'review_id,file_name';

  function _str(v, max) {
    return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : null;
  }

  // What a save may set. A field outside this list is dropped rather than
  // written — particularly `user_id`, which comes from the session, `review_id`,
  // which comes from the review being viewed, and `id`, which the database
  // mints. Each value is normalised here so a column constraint is never the
  // first thing to notice a bad value.
  var WRITABLE = {
    file_name:        function (v) { return _str(v, 500); },
    intake_kind:      function (v) { return ['lease', 'invoice', 'other'].indexOf(v) >= 0 ? v : 'other'; },
    byte_size:        function (v) { return (isFinite(Number(v)) && Number(v) >= 0) ? Math.floor(Number(v)) : null; },
    content_type:     function (v) { return _str(v, 255); },
    storage_path:     function (v) { return _str(v, 1000); },
    extracted_text:   function (v) { return (typeof v === 'string' && v) ? v : null; },
    parsing_status:   function (v) { return ['pending', 'success', 'partial', 'failed'].indexOf(v) >= 0 ? v : 'pending'; },
    extraction_model: function (v) { return _str(v, 255); },
    used_pdf_direct:  function (v) { return v === true; },
    error_message:    function (v) { return _str(v, 2000); },
    produced_kind:    function (v) { return ['tenant', 'invoice'].indexOf(v) >= 0 ? v : null; },
    produced_id:      function (v) { return _str(v, 200); },
  };

  // camelCase in the app, snake_case in the table.
  var CAMEL = {
    fileName: 'file_name', intakeKind: 'intake_kind', byteSize: 'byte_size',
    contentType: 'content_type', storagePath: 'storage_path', extractedText: 'extracted_text',
    parsingStatus: 'parsing_status', extractionModel: 'extraction_model',
    usedPdfDirect: 'used_pdf_direct', errorMessage: 'error_message',
    producedKind: 'produced_kind', producedId: 'produced_id',
  };

  /**
   * The row to write, from the fields a caller offered.
   *
   * `userId` is the signed-in user, read from the session by the caller and
   * never taken from `fields` — a field named user_id is not in CAMEL, so it is
   * dropped like any other unknown key. `reviewId` is the review on screen.
   * The two together are what the composite foreign key checks.
   *
   * Returns { ok: true, payload } or { ok: false, error } — a save with no
   * review or no file name is a caller mistake, not a row.
   */
  function buildPayload(reviewId, userId, fields) {
    var f = (fields && typeof fields === 'object') ? fields : {};
    if (!reviewId) return { ok: false, error: 'Missing reviewId' };
    if (!userId)   return { ok: false, error: 'Missing userId' };

    var payload = { review_id: reviewId, user_id: userId };
    for (var camel in CAMEL) {
      if (!Object.prototype.hasOwnProperty.call(CAMEL, camel)) continue;
      if (f[camel] === undefined) continue;
      var snake = CAMEL[camel];
      payload[snake] = WRITABLE[snake](f[camel]);
    }
    if (!payload.file_name) return { ok: false, error: 'fileName must be a non-empty string' };
    return { ok: true, payload: payload };
  }

  // The migration that creates each table this feature reads.
  //
  // Two different reads can fail with "relation does not exist" — the reviews
  // list touches acquisition_reviews (migration 006), the documents panel
  // touches acquisition_documents (migration 023) — and telling an operator to
  // run 023 when what is absent is the reviews table sends them to the wrong
  // file. Mutation testing found that exact bug in the endpoint this replaces.
  var MIGRATION_FOR = {
    acquisition_reviews:   'migrations/006_acquisition_reviews.sql',
    acquisition_documents: 'migrations/023_acquisition_documents.sql',
  };
  function migrationFor(table) {
    return MIGRATION_FOR[table] || MIGRATION_FOR.acquisition_documents;
  }

  /**
   * Is this error the table not being there?
   *
   * PostgREST reports an absent relation as SQLSTATE 42P01 with a message that
   * names it. The code is checked first because it is exact; the message is a
   * fallback for the shapes that arrive without one. A missing table is not a
   * failure to hide: the caller says so on screen and keeps extracting.
   */
  function isMissingTable(error) {
    if (!error) return false;
    if (error.code === '42P01') return true;
    var msg = String(error.message || error.error || error.details || '').toLowerCase();
    if (!msg) return false;
    return msg.indexOf('does not exist') >= 0 && (msg.indexOf('relation') >= 0 || msg.indexOf('table') >= 0);
  }

  var api = {
    LIST_COLUMNS: LIST_COLUMNS,
    LIST_SELECT: LIST_SELECT,
    CONFLICT_KEY: CONFLICT_KEY,
    WRITABLE: WRITABLE,
    CAMEL: CAMEL,
    buildPayload: buildPayload,
    MIGRATION_FOR: MIGRATION_FOR,
    migrationFor: migrationFor,
    isMissingTable: isMissingTable,
  };
  if (root) root.AcquisitionDocuments = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
