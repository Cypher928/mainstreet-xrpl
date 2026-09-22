'use strict';
/**
 * acquisition-documents.js — what may be written about a document, what a
 * document IS, and what it belongs to.
 *
 * Phase 1 of Acquisition Review (docs/ACQUISITION_REVIEW.md), increments P1-2
 * and P1-3.
 *
 * P1-2 is the write contract for a preserved source: the allow-list, the list's
 * columns, the upsert key, and recognising a schema that is not there.
 *
 * P1-3 is the document MODEL on top of it: the type vocabulary (which is
 * LeaseIntelligence's, so P1-4 feeds the reasoner that already exists), the
 * rules for proposing a family and a relationship — which decline far more
 * often than they propose — the append-only audit trail, supersession (D-14),
 * and the grouping the Documents panel renders. Every one of those is a
 * PROPOSAL until a person confirms it, and `buildPayload` refuses to write a
 * confirmation that names nobody, as migration 024's trigger does in the
 * database.
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
    'id', 'review_id', 'file_name', 'intake_id', 'intake_kind', 'byte_size', 'content_type',
    'storage_path', 'parsing_status', 'extraction_model', 'used_pdf_direct',
    'error_message', 'produced_kind', 'produced_id', 'created_at', 'updated_at',
    // P1-3. What it is, what it belongs to, what it changed, what replaced it.
    'doc_type', 'doc_type_status', 'doc_type_source', 'doc_type_confidence', 'doc_date',
    'family_id', 'family_status', 'family_source',
    'parent_document_id', 'relationship', 'relationship_status',
    'superseded_by_document_id', 'confirmed_by', 'confirmed_at',
    // The trail HAS to come back. Every write appends to what it was given, so
    // a list that does not return it hands the next write an empty array and
    // the trail is silently truncated to whatever happened last — which is the
    // opposite of an audit record. It is bounded (HISTORY_CAP small entries),
    // unlike extracted_text, which is why that one stays out and this does not.
    'classification_history',
    // P1-4. Whether and when the document was read for its terms — NOT the
    // evidence itself. abstracted_fields is 27 entries with quotes and, like
    // extracted_text, is read by the code that reasons from it (P4-2), one
    // family at a time, not by a list that only shows a status chip.
    // `abstraction_error` (027) rides with them: it is one short word and the
    // chip that says a reading failed is the place a person asks WHY.
    'abstraction_status', 'abstraction_model', 'abstracted_at', 'abstraction_error',
  ];
  var LIST_SELECT = LIST_COLUMNS.join(', ');

  // The columns a family list asks for.
  var FAMILY_COLUMNS = [
    'id', 'review_id', 'label', 'family_kind', 'tenant_hint', 'suite_hint',
    'created_at', 'updated_at',
  ];
  var FAMILY_SELECT = FAMILY_COLUMNS.join(', ');

  // The key one UPLOAD is filed under (D-14).
  //
  // It was (review_id, file_name) in P1-2, which meant uploading a file whose
  // name was already used REPLACED the row and that source left the record —
  // the opposite of what P1-2 is for. A document's identity is now its intake:
  // minted once when the file is taken in and reused by that upload's second
  // write, so the two writes of one upload still collapse into one row while
  // two uploads stay two rows even when they share a name. Migration 024 holds
  // this as a unique constraint, so it is true even if a second tab writes at
  // the same moment.
  var CONFLICT_KEY = 'review_id,intake_id';

  function _str(v, max) {
    return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : null;
  }
  function _oneOf(list, fallback) {
    return function (v) { return list.indexOf(v) >= 0 ? v : fallback; };
  }

  // ── What a document can be (P1-3) ──────────────────────────────────────────
  //
  // THE TIERS ARE NOT NEW. LeaseIntelligence.reasonMultiDocumentLease already
  // resolves governing terms across a lease's documents by tier and then date,
  // and its table is { side_letter: 4, estoppel: 3, amendment: 2,
  // original_lease: 1 }. Those four names are reproduced here EXACTLY so P1-4
  // feeds the reasoner that exists rather than a second one written to match a
  // new table. renewal, extension, assignment and guaranty join amendment at
  // tier 2: they modify a lease the same way and rank the same way.
  //
  // `family` marks the types that belong to a leasehold. The rest are review
  // level — a PSA or a rent roll is about the purchase, not about one lease —
  // and P1-3 does not invent families for them.
  var DOC_TYPES = {
    original_lease:      { label: 'Original Lease',        tier: 1, family: true  },
    amendment:           { label: 'Amendment',             tier: 2, family: true  },
    renewal:             { label: 'Renewal',               tier: 2, family: true  },
    extension:           { label: 'Extension',             tier: 2, family: true  },
    assignment:          { label: 'Assignment',            tier: 2, family: true  },
    guaranty:            { label: 'Guaranty',              tier: 2, family: true  },
    estoppel:            { label: 'Estoppel',              tier: 3, family: true  },
    snda:                { label: 'SNDA',                  tier: 3, family: true  },
    side_letter:         { label: 'Side Letter',           tier: 4, family: true  },
    psa:                 { label: 'Purchase Agreement',    tier: 0, family: false },
    rent_roll:           { label: 'Rent Roll',             tier: 0, family: false },
    financial_statement: { label: 'Financial Statement',   tier: 0, family: false },
    invoice:             { label: 'Invoice',               tier: 0, family: false },
    other:               { label: 'Other',                 tier: 0, family: false },
    unknown:             { label: 'Unclassified',          tier: 0, family: false },
  };
  var DOC_TYPE_NAMES = Object.keys(DOC_TYPES);

  // What each type DOES to the lease it belongs to. Used to propose a
  // relationship, never to assert one.
  var RELATIONSHIP_FOR_TYPE = {
    amendment:  'amends',     renewal:  'renews',     extension: 'extends',
    assignment: 'assigns',    guaranty: 'guarantees', side_letter: 'supplements',
    estoppel:   'certifies',  snda:     'relates_to',
  };
  var RELATIONSHIPS = ['amends', 'renews', 'extends', 'assigns', 'guarantees',
                       'supplements', 'certifies', 'relates_to'];

  var TYPE_STATUSES   = ['unclassified', 'proposed', 'confirmed', 'corrected'];
  var FAMILY_STATUSES = ['unfiled', 'proposed', 'confirmed'];
  // D-17 (P1-4 / P4-3): `needs_review` joins the two. A document reclassified
  // out of a lease family keeps the relationship it had and is flagged for a
  // person, rather than having the link discarded to keep two columns tidy.
  // Migration 026 widened the matching CHECK.
  var REL_STATUSES    = ['proposed', 'confirmed', 'needs_review'];
  // A status that asserts something as settled. Migration 024's trigger refuses
  // one of these with no confirmed_by; buildPayload refuses it here too, so the
  // mistake is caught before it reaches the database rather than as a 500.
  var CONFIRMED_STATUSES = ['confirmed', 'corrected'];
  // P1-4. Whether the document has been read for its terms. The list is
  // acquisition-terms.js's (ABSTRACTION_STATUSES) and migration 025's; it is
  // repeated here because this module loads first and depends on nothing, and
  // a test holds the three equal.
  var ABSTRACTION_STATUSES = ['pending', 'success', 'partial', 'failed', 'skipped'];
  // P4-3 remediation (Issue A4). WHY a reading failed, when one did. Migration
  // 027 holds the same six as a CHECK; acquisition-terms.js holds them as the
  // vocabulary; a test holds all three equal.
  var ABSTRACTION_ERRORS = ['no_text', 'transport', 'upstream_timeout',
                            'upstream_error', 'unparsable', 'no_fields'];

  function docTypeLabel(t) { return (DOC_TYPES[t] && DOC_TYPES[t].label) || 'Unclassified'; }
  function docTypeTier(t)  { return (DOC_TYPES[t] && DOC_TYPES[t].tier)  || 0; }
  function isFamilyType(t) { return !!(DOC_TYPES[t] && DOC_TYPES[t].family); }

  // An ISO date, or nothing. A document's own date orders its family, so a
  // half-parsed string is worse than an absent one.
  function _date(v) {
    if (typeof v !== 'string') return null;
    var s = v.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var d = new Date(s + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : s;
  }
  // A confidence, or the absence of one. `null` must NOT become 0: "no
  // confidence was recorded" and "the model was certain it was wrong" are
  // different claims, and Number(null) is 0, so the empty cases are excluded
  // before the range check rather than after it.
  function _num01(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = Number(v);
    return (isFinite(n) && n >= 0 && n <= 1) ? n : null;
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

    // ── P1-3 ────────────────────────────────────────────────────────────────
    // The identity of one upload (D-14). Not normalised away to null: a row
    // without it cannot exist, and buildPayload refuses one that is missing.
    intake_id:        function (v) { return _str(v, 120); },

    // NULL is an ordinary value here — a document may arrive unclassified and
    // be classified later — so an unrecognised type becomes 'unknown' rather
    // than being silently coerced into something plausible.
    doc_type:            function (v) { return v == null ? null : (DOC_TYPES[v] ? v : 'unknown'); },
    doc_type_status:     _oneOf(TYPE_STATUSES, 'unclassified'),
    doc_type_source:     function (v) { return ['ai', 'human', 'intake_kind'].indexOf(v) >= 0 ? v : null; },
    doc_type_confidence: _num01,
    doc_date:            _date,

    family_id:     function (v) { return _str(v, 64); },
    family_status: _oneOf(FAMILY_STATUSES, 'unfiled'),
    family_source: function (v) { return ['ai', 'human', 'inherited'].indexOf(v) >= 0 ? v : null; },

    parent_document_id:  function (v) { return _str(v, 64); },
    relationship:        function (v) { return RELATIONSHIPS.indexOf(v) >= 0 ? v : null; },
    relationship_status: function (v) { return REL_STATUSES.indexOf(v) >= 0 ? v : null; },

    superseded_by_document_id: function (v) { return _str(v, 64); },

    confirmed_by: function (v) { return _str(v, 64); },
    confirmed_at: function (v) { return _str(v, 40); },

    classification_history: function (v) { return Array.isArray(v) ? v : []; },

    // ── P1-4 ────────────────────────────────────────────────────────────────
    // The evidence is written whole, by the one code path that builds it
    // (acquisition-terms.js buildAbstraction). Anything that is not an object
    // becomes the empty object, which the status rule below then refuses to
    // pair with `success` — a corrupt reading cannot masquerade as a read.
    abstracted_fields:  function (v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; },
    abstraction_status: _oneOf(ABSTRACTION_STATUSES, 'pending'),
    abstraction_model:  function (v) { return _str(v, 255); },
    abstracted_at:      function (v) { return _str(v, 40); },
    // WHY a reading failed (027). One of the six words in
    // AcquisitionTerms.ABSTRACTION_ERRORS, or null. The list is repeated here
    // for the same reason ABSTRACTION_STATUSES is — this module loads first and
    // depends on nothing — and a test holds the two equal. Anything outside the
    // vocabulary becomes null rather than being written through: a reason
    // nobody can look up is not a reason.
    abstraction_error:  _oneOf(ABSTRACTION_ERRORS, null),
  };

  // camelCase in the app, snake_case in the table.
  var CAMEL = {
    fileName: 'file_name', intakeId: 'intake_id', intakeKind: 'intake_kind', byteSize: 'byte_size',
    contentType: 'content_type', storagePath: 'storage_path', extractedText: 'extracted_text',
    parsingStatus: 'parsing_status', extractionModel: 'extraction_model',
    usedPdfDirect: 'used_pdf_direct', errorMessage: 'error_message',
    producedKind: 'produced_kind', producedId: 'produced_id',
    docType: 'doc_type', docTypeStatus: 'doc_type_status', docTypeSource: 'doc_type_source',
    docTypeConfidence: 'doc_type_confidence', docDate: 'doc_date',
    familyId: 'family_id', familyStatus: 'family_status', familySource: 'family_source',
    parentDocumentId: 'parent_document_id', relationship: 'relationship',
    relationshipStatus: 'relationship_status',
    supersededByDocumentId: 'superseded_by_document_id',
    confirmedBy: 'confirmed_by', confirmedAt: 'confirmed_at',
    classificationHistory: 'classification_history',
    abstractedFields: 'abstracted_fields', abstractionStatus: 'abstraction_status',
    abstractionModel: 'abstraction_model', abstractedAt: 'abstracted_at',
    abstractionError: 'abstraction_error',
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
    // The upsert keys on it, so a write without one would file a second row for
    // a file that already has one — the D-14 bug in reverse.
    if (!payload.intake_id) return { ok: false, error: 'intakeId must be a non-empty string' };

    // A PROPOSAL MAY NOT BECOME A FACT WITH NOBODY BEHIND IT.
    //
    // Migration 024's trigger refuses this too, and deliberately: the database
    // is what makes it true. Refusing here as well turns a 500 from a broken
    // caller into a named mistake at the call site, which is where it can be
    // fixed.
    var claims = (CONFIRMED_STATUSES.indexOf(payload.doc_type_status) >= 0)
              || payload.family_status === 'confirmed'
              || payload.relationship_status === 'confirmed';
    if (claims && !payload.confirmed_by) {
      return { ok: false, error: 'A confirmed classification must name who confirmed it' };
    }

    // A STATUS THAT CLAIMS THE DOCUMENT WAS READ CARRIES WHAT WAS READ.
    //
    // Migration 025's check refuses `success` / `partial` with no `fields` key
    // or no timestamp. Refusing it here too names the mistake at the call
    // site. The data layer always writes the four abstraction columns together,
    // so a read that arrives without its evidence is a bug, not a partial save.
    if (payload.abstraction_status === 'success' || payload.abstraction_status === 'partial') {
      var ev = payload.abstracted_fields;
      if (!ev || typeof ev !== 'object' || !Object.prototype.hasOwnProperty.call(ev, 'fields') || !payload.abstracted_at) {
        return { ok: false, error: 'An abstraction marked ' + payload.abstraction_status + ' must carry its fields and its timestamp' };
      }
    }

    // Two columns may not disagree about whether the document is filed.
    if (payload.family_id === null && payload.family_status
        && payload.family_status !== 'unfiled') {
      payload.family_status = 'unfiled';
      payload.family_source = null;
    }

    // Half a relationship reads as a whole one later. Either both ends and a
    // standing, or none of it.
    var hasParent = !!payload.parent_document_id;
    if (payload.parent_document_id !== undefined || payload.relationship !== undefined) {
      if (hasParent && (!payload.relationship || !payload.relationship_status)) {
        return { ok: false, error: 'A parent document needs a relationship and a status' };
      }
      if (!hasParent && payload.parent_document_id !== undefined) {
        payload.relationship = null;
        payload.relationship_status = null;
      }
    }
    if (hasParent && payload.parent_document_id === f.id) {
      return { ok: false, error: 'A document cannot be its own parent' };
    }

    return { ok: true, payload: payload };
  }

  /**
   * The row a family is written from. Same rules, its own small allow-list.
   */
  function buildFamilyPayload(reviewId, userId, fields) {
    var f = (fields && typeof fields === 'object') ? fields : {};
    if (!reviewId) return { ok: false, error: 'Missing reviewId' };
    if (!userId)   return { ok: false, error: 'Missing userId' };
    var label = _str(f.label, 300);
    if (!label) return { ok: false, error: 'A family needs a label' };
    var payload = {
      review_id: reviewId, user_id: userId, label: label,
      family_kind: ['lease', 'financial', 'transaction', 'other'].indexOf(f.familyKind) >= 0
        ? f.familyKind : 'lease',
    };
    if (f.id !== undefined)         payload.id          = _str(f.id, 64);
    if (f.tenantHint !== undefined) payload.tenant_hint = _str(f.tenantHint, 300);
    if (f.suiteHint !== undefined)  payload.suite_hint  = _str(f.suiteHint, 120);
    return { ok: true, payload: payload };
  }

  // ── The audit trail ────────────────────────────────────────────────────────
  // Appended, never rewritten, so "the model read it as an amendment and a
  // person corrected it to a renewal" survives both acts. The current value
  // lives in columns because the database constrains and indexes those; the
  // trail lives here because it is a list that only grows.
  var HISTORY_CAP = 100;

  /**
   * One entry. `action` is what happened, `field` is what it happened to.
   *
   *   proposed   a model read the document and offered this
   *   confirmed  a person agreed with what was offered
   *   corrected  a person replaced it with something else
   *   inherited  a replacement upload took its predecessor's place (D-14)
   */
  function classificationEntry(e) {
    var o = (e && typeof e === 'object') ? e : {};
    var entry = {
      at:     _str(o.at, 40) || new Date().toISOString(),
      // `needs_review` is D-17's act (P1-4 / P4-3): a relationship preserved
      // and flagged when its document was reclassified out of the lease
      // family. Without it here the entry was silently rewritten to
      // `proposed`, and the trail recorded the opposite of what happened.
      action: ['proposed', 'confirmed', 'corrected', 'inherited', 'needs_review'].indexOf(o.action) >= 0
                ? o.action : 'proposed',
      field:  ['doc_type', 'family', 'relationship'].indexOf(o.field) >= 0 ? o.field : 'doc_type',
      from:   o.from === undefined ? null : o.from,
      to:     o.to === undefined ? null : o.to,
      source: ['ai', 'human', 'intake_kind', 'inherited'].indexOf(o.source) >= 0 ? o.source : null,
      actor:  (o.actor && (o.actor.uid || o.actor.email))
                ? { uid: o.actor.uid || null, email: o.actor.email || null } : null,
    };
    if (o.model !== undefined)      entry.model      = _str(o.model, 120);
    if (o.confidence !== undefined) entry.confidence = _num01(o.confidence);
    if (o.evidence !== undefined)   entry.evidence   = _str(o.evidence, 600);
    return entry;
  }

  /** The trail with one more entry on it, oldest first, bounded. */
  function appendHistory(existing, entry) {
    var list = Array.isArray(existing) ? existing.slice() : [];
    list.push(classificationEntry(entry));
    return list.length > HISTORY_CAP ? list.slice(list.length - HISTORY_CAP) : list;
  }

  // ── Recognising a tenant, without guessing ─────────────────────────────────
  // Case, punctuation and a trailing company form are not differences a person
  // would call differences: "Coastal Outfitters LLC" and "Coastal Outfitters,
  // Inc." are the same tenant to anyone reading them. Everything beyond that
  // IS a difference, and is left to a person.
  var LEGAL_SUFFIX = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|lp|llp|ltd|limited|plc|pllc|pc|trust|holdings?)\b/g;
  function normalizeParty(name) {
    if (typeof name !== 'string') return '';
    return name.toLowerCase()
      // A dotted acronym is ONE word: "L.L.C." has to become "llc" before the
      // punctuation pass, or it arrives at the suffix list as "l l c" and is
      // kept as part of the tenant's name. Only runs of single letters each
      // followed by a dot qualify, so "St. Mark's" is left alone.
      .replace(/\b(?:[a-z]\.){2,}/g, function (m) { return m.replace(/\./g, ''); })
      .replace(/[.,'"()&]/g, ' ')
      .replace(LEGAL_SUFFIX, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Which family this document belongs to — or, far more often, the honest
   * answer that we do not know.
   *
   * THIS FUNCTION EXISTS TO SAY NO. Inventing a relationship from a weak
   * signal and then storing it is the failure mode P1-3 was written to avoid,
   * so every branch that is not certain returns `none` with a reason a person
   * can read, and the document stays visible and unfiled.
   *
   * It proposes only when:
   *   · the type is one that belongs to a leasehold at all, and
   *   · exactly ONE existing family matches the tenant after normalisation.
   *
   * Two matches is ambiguity, not a coin toss. No match on a document that
   * modifies a lease is also a no: an amendment with no lease to amend is
   * exactly the case where guessing does damage. Only an original lease, which
   * begins a leasehold, may propose a NEW family.
   *
   * Returns { kind: 'existing'|'new'|'none', … , reason }.
   */
  function proposeFamily(doc, families) {
    var d = doc || {};
    var type = d.doc_type || d.docType || null;
    if (!type || type === 'unknown') {
      return { kind: 'none', reason: 'The document type is not known yet.' };
    }
    if (!isFamilyType(type)) {
      return { kind: 'none', reason: docTypeLabel(type) + ' belongs to the review, not to a lease.' };
    }
    var party = normalizeParty(d.tenant_hint || d.tenantHint || '');
    if (!party) {
      return { kind: 'none', reason: 'No tenant could be read from the document.' };
    }

    var matches = (Array.isArray(families) ? families : []).filter(function (fam) {
      return fam && normalizeParty(fam.tenant_hint || fam.label) === party;
    });
    if (matches.length === 1) {
      return { kind: 'existing', familyId: matches[0].id, reason: 'The tenant matches this family.' };
    }
    if (matches.length > 1) {
      return { kind: 'none',
               reason: 'More than one family names this tenant — which one is a decision for a person.' };
    }
    if (type === 'original_lease') {
      return { kind: 'new', label: _str(d.tenant_hint || d.tenantHint, 300),
               tenantHint: _str(d.tenant_hint || d.tenantHint, 300),
               reason: 'An original lease begins a leasehold.' };
    }
    return { kind: 'none',
             reason: 'There is no lease on file for this tenant yet, so what this ' +
                     docTypeLabel(type).toLowerCase() + ' changes is not known.' };
  }

  /**
   * What this document does to the lease it belongs to — proposed, never
   * asserted, and only when there is exactly one lease it could be.
   *
   * A family with two original leases in it is a family somebody needs to look
   * at, not one to pick a parent from.
   */
  function proposeRelationship(doc, siblings) {
    var d = doc || {};
    var type = d.doc_type || d.docType || null;
    var rel = RELATIONSHIP_FOR_TYPE[type];
    if (!rel) return { kind: 'none', reason: 'This type does not change another document.' };

    var leases = (Array.isArray(siblings) ? siblings : []).filter(function (s) {
      return s && s.id !== d.id && s.doc_type === 'original_lease' && !s.superseded_by_document_id;
    });
    if (leases.length === 1) {
      return { kind: 'proposed', parentDocumentId: leases[0].id, relationship: rel,
               reason: 'It is the only lease in this family.' };
    }
    if (leases.length > 1) {
      return { kind: 'none', reason: 'This family has more than one lease — which one is changed is a decision for a person.' };
    }
    return { kind: 'none', reason: 'No original lease is on file for this family yet.' };
  }

  // ── Reading the pile back ──────────────────────────────────────────────────

  /** Is this the current upload of its name, or has another one replaced it? */
  function isCurrent(row) { return !!row && !row.superseded_by_document_id; }

  /**
   * The row a new upload replaces: the CURRENT document of the same name in
   * the same review. Returns null when the name is new, which is the ordinary
   * case. Never matches the incoming row itself (D-14).
   */
  function findSuperseded(rows, fileName, intakeId) {
    var name = _str(fileName, 500);
    if (!name) return null;
    var hits = (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && r.file_name === name && r.intake_id !== intakeId && isCurrent(r);
    });
    // Oldest first everywhere else; here the most recent is the one being
    // replaced, so a third upload supersedes the second and not the first.
    hits.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? 1 : -1; });
    return hits[0] || null;
  }

  /**
   * Order inside a family: tier first, then the document's own date, newest
   * first — the same rule LeaseIntelligence.reasonMultiDocumentLease applies
   * when it resolves which value governs. A superseded upload sorts last
   * whatever its type, because it is not part of the current picture.
   */
  function orderWithinFamily(rows) {
    return (Array.isArray(rows) ? rows.slice() : []).sort(function (a, b) {
      var ca = isCurrent(a) ? 0 : 1, cb = isCurrent(b) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      var td = docTypeTier(b.doc_type) - docTypeTier(a.doc_type);
      if (td !== 0) return td;
      var da = a.doc_date ? Date.parse(a.doc_date) : 0;
      var db = b.doc_date ? Date.parse(b.doc_date) : 0;
      if (da !== db) return db - da;
      return String(a.created_at) < String(b.created_at) ? -1 : 1;
    });
  }

  /**
   * The Documents panel, as data.
   *
   * Three groups, in the order a person needs them:
   *
   *   needsReview  unclassified, unfiled, or a type that belongs to a lease
   *                with no lease to belong to. The pile somebody has to look
   *                at, FIRST rather than buried.
   *   families     one entry per leasehold, its documents in governing order.
   *   reviewLevel  the PSA, the rent roll, the financials, the invoices —
   *                classified, belonging to the review rather than to a lease.
   *
   * Every document appears exactly once. A document that would qualify for two
   * groups goes to needsReview, because that is the one a person acts on.
   */
  function groupDocuments(rows, families) {
    var docs = Array.isArray(rows) ? rows.slice() : [];
    var fams = Array.isArray(families) ? families : [];
    var byFamily = {}, needsReview = [], reviewLevel = [];

    docs.forEach(function (d) {
      if (!d) return;
      var type = d.doc_type || null;
      var filed = !!d.family_id;
      if (!type || type === 'unknown' || (isFamilyType(type) && !filed)) { needsReview.push(d); return; }
      if (filed) { (byFamily[d.family_id] = byFamily[d.family_id] || []).push(d); return; }
      reviewLevel.push(d);
    });

    var familyGroups = fams.map(function (fam) {
      var members = orderWithinFamily(byFamily[fam.id] || []);
      delete byFamily[fam.id];
      return {
        family: fam,
        documents: members,
        // What a person needs to see about the family without opening it.
        counts: {
          total:      members.length,
          current:    members.filter(isCurrent).length,
          proposed:   members.filter(function (m) { return m.family_status === 'proposed'; }).length,
          superseded: members.filter(function (m) { return !isCurrent(m); }).length,
        },
        governing: members.filter(isCurrent)[0] || null,
      };
    }).filter(function (g) { return g.documents.length > 0; });

    // A document filed into a family that is not in the list — a family
    // deleted in another tab, say. It is not dropped from the screen; it goes
    // where unplaced documents go.
    Object.keys(byFamily).forEach(function (k) {
      byFamily[k].forEach(function (d) { needsReview.push(d); });
    });

    return {
      needsReview: orderWithinFamily(needsReview),
      families:    familyGroups,
      reviewLevel: orderWithinFamily(reviewLevel),
      total:       docs.length,
    };
  }

  /**
   * One line saying what a document is and how sure anyone is about it. The
   * status is never dropped: an unconfirmed reading says so wherever it shows.
   */
  function describeClassification(row) {
    var d = row || {};
    var type = d.doc_type || null;
    if (!type || type === 'unknown') {
      return { label: 'Unclassified', status: 'unclassified', verified: false,
               note: 'Nobody has said what this document is yet.' };
    }
    var st = d.doc_type_status || 'unclassified';
    var confirmed = CONFIRMED_STATUSES.indexOf(st) >= 0;
    return {
      label: docTypeLabel(type),
      status: st,
      verified: confirmed,
      note: confirmed
        ? (st === 'corrected' ? 'Corrected by a person.' : 'Confirmed by a person.')
        : 'Proposed by AI — not confirmed.',
    };
  }

  // The migration that creates each table this feature reads.
  //
  // Two different reads can fail with "relation does not exist" — the reviews
  // list touches acquisition_reviews (migration 006), the documents panel
  // touches acquisition_documents (migration 023) — and telling an operator to
  // run 023 when what is absent is the reviews table sends them to the wrong
  // file. Mutation testing found that exact bug in the endpoint this replaces.
  var MIGRATION_FOR = {
    acquisition_reviews:           'migrations/006_acquisition_reviews.sql',
    acquisition_documents:         'migrations/023_acquisition_documents.sql',
    acquisition_document_families: 'migrations/024_acquisition_document_classification.sql',
  };
  var MIGRATION_FOR_COLUMNS = 'migrations/024_acquisition_document_classification.sql';

  // A missing column names the migration that ADDS that column. Every column
  // 024 added is 024's; the four 025 added are 025's. Sending an operator who
  // has run 024 back to 024 because 025 is what is missing is the same
  // wrong-file bug in a third coat of paint.
  var MIGRATION_FOR_COLUMN = {
    abstracted_fields:  'migrations/025_acquisition_abstraction.sql',
    abstraction_status: 'migrations/025_acquisition_abstraction.sql',
    abstraction_model:  'migrations/025_acquisition_abstraction.sql',
    abstracted_at:      'migrations/025_acquisition_abstraction.sql',
    abstraction_error:  'migrations/027_acquisition_abstraction_error.sql',
  };

  function migrationFor(table) {
    return MIGRATION_FOR[table] || MIGRATION_FOR.acquisition_documents;
  }

  /**
   * The column a 42703 names, when the message names one. PostgREST says
   * `column acquisition_documents.abstraction_status does not exist`; plain
   * PostgreSQL says `column "abstraction_status" does not exist`. Null when
   * the message is not in either shape.
   */
  function missingColumnName(error) {
    if (!error) return null;
    var msg = String(error.message || error.error || error.details || '');
    var m = msg.match(/column\s+"?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)"?\s+does not exist/i);
    return m ? m[1].toLowerCase() : null;
  }

  /**
   * Is this error a COLUMN that is not there rather than a table?
   *
   * This is the shape of "the code shipped before its migration did": the
   * table exists, every P1-2 column exists, and the P1-3 ones do not.
   * PostgREST reports it as 42703.
   */
  function isMissingColumn(error) {
    if (!error) return false;
    if (error.code === '42703') return true;
    var msg = String(error.message || error.error || error.details || '').toLowerCase();
    return /^column\b/.test(msg) && msg.indexOf('does not exist') >= 0;
  }

  /**
   * The migration an operator should actually run, decided from the error and
   * not from the table that was being read.
   *
   * A missing COLUMN names 024, because 023 is by definition already applied —
   * its table is what the column is missing from. Telling somebody to run a
   * migration they have already run is the same wrong-file bug mutation
   * testing found in P1-2's endpoint, wearing a different hat.
   */
  function migrationForError(error, table) {
    if (!isMissingColumn(error)) return migrationFor(table);
    var col = missingColumnName(error);
    return (col && MIGRATION_FOR_COLUMN[col]) || MIGRATION_FOR_COLUMNS;
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
    // A missing COLUMN also says "does not exist" and also names a relation,
    // so it has to be ruled out before the message is consulted or every
    // pre-migration error would read as an absent table.
    if (isMissingColumn(error)) return false;
    if (error.code === '42P01') return true;
    var msg = String(error.message || error.error || error.details || '').toLowerCase();
    if (!msg) return false;
    return msg.indexOf('does not exist') >= 0 && (msg.indexOf('relation') >= 0 || msg.indexOf('table') >= 0);
  }

  var api = {
    LIST_COLUMNS: LIST_COLUMNS,
    LIST_SELECT: LIST_SELECT,
    FAMILY_COLUMNS: FAMILY_COLUMNS,
    FAMILY_SELECT: FAMILY_SELECT,
    CONFLICT_KEY: CONFLICT_KEY,
    WRITABLE: WRITABLE,
    CAMEL: CAMEL,
    buildPayload: buildPayload,
    buildFamilyPayload: buildFamilyPayload,
    MIGRATION_FOR: MIGRATION_FOR,
    MIGRATION_FOR_COLUMN: MIGRATION_FOR_COLUMN,
    migrationFor: migrationFor,
    migrationForError: migrationForError,
    missingColumnName: missingColumnName,
    ABSTRACTION_STATUSES: ABSTRACTION_STATUSES,
    ABSTRACTION_ERRORS: ABSTRACTION_ERRORS,
    isMissingTable: isMissingTable,
    isMissingColumn: isMissingColumn,
    schemaGap: function (error) { return isMissingTable(error) || isMissingColumn(error); },

    // ── P1-3 ────────────────────────────────────────────────────────────────
    DOC_TYPES: DOC_TYPES,
    DOC_TYPE_NAMES: DOC_TYPE_NAMES,
    RELATIONSHIPS: RELATIONSHIPS,
    RELATIONSHIP_FOR_TYPE: RELATIONSHIP_FOR_TYPE,
    TYPE_STATUSES: TYPE_STATUSES,
    FAMILY_STATUSES: FAMILY_STATUSES,
    REL_STATUSES: REL_STATUSES,
    CONFIRMED_STATUSES: CONFIRMED_STATUSES,
    HISTORY_CAP: HISTORY_CAP,
    docTypeLabel: docTypeLabel,
    docTypeTier: docTypeTier,
    isFamilyType: isFamilyType,
    normalizeParty: normalizeParty,
    classificationEntry: classificationEntry,
    appendHistory: appendHistory,
    proposeFamily: proposeFamily,
    proposeRelationship: proposeRelationship,
    isCurrent: isCurrent,
    findSuperseded: findSuperseded,
    orderWithinFamily: orderWithinFamily,
    groupDocuments: groupDocuments,
    describeClassification: describeClassification,
  };
  if (root) root.AcquisitionDocuments = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
