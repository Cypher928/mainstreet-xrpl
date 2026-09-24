'use strict';
/**
 * acquisition-report.js — the buyer's five questions, answered from evidence.
 *
 * Phase 1 of Acquisition Review (docs/ACQUISITION_REVIEW.md §7), increment
 * P1-7, step R-1. This file is the MODEL: it turns what P1-2/P1-3/P1-4 know
 * into the shape a buyer's report renders. It draws nothing; R-2 and R-3 do
 * that.
 *
 * WHY THIS EXISTS
 *
 * Today's Acquisition Decision Report leads with 311% CAM recovery, missed
 * recovery, cap leakage and audit windows. Those are the questions an
 * OWNER-OPERATOR asks about a property they already hold. A buyer in diligence
 * asks five different ones (§7), in this order:
 *
 *   1. What am I buying?
 *   2. What income am I actually buying?
 *   3. What obligations am I inheriting?
 *   4. What documents and evidence prove it?
 *   5. What needs attention before acquisition?
 *
 * The existing report is NOT replaced or modified. It is the right tool for an
 * owner-operator and the Rent Roll tab and the Convert flow both read what it
 * produces. This is a second report for a different reader.
 *
 * FOUR STATES, AND WHAT THEY MAY NOT HIDE
 *
 * §7 fixes the vocabulary at four: verified · assumption · issue · missing.
 * That vocabulary is kept exactly. Two things ride ALONGSIDE it rather than
 * becoming a fifth and sixth word, because the moment a report has six states
 * nobody reads any of them:
 *
 *   origin   an assumption is `ai_read` (a model read it off a document and
 *            nobody has confirmed it) or `entered` (a person typed or
 *            underwrote it and no document says it). §7 defines `assumption`
 *            as the latter. Collapsing both into one word would tell a buyer
 *            that a quoted clause and a hand-typed figure are the same kind of
 *            claim, which is the confusion this product exists to prevent.
 *
 *   derived  the value is not in the clause behind it — it was calculated from
 *            it. The live case: base_rent 1,202,500 from "$18.50 per square
 *            foot" × 65,000 sf. Defensible arithmetic, and NOT something the
 *            document states. A derived figure is never presented as
 *            document-stated, and is never an issue merely for being derived.
 *
 * MISSING IS NOT NONE
 *
 * Every field in the vocabulary appears in the model, always. A term nothing
 * establishes is `missing` WITH A SENTENCE saying so — never zero, never
 * blank, never dropped to make the report look complete. The same rule governs
 * whole sources: until P1-5 lands, the rent roll and the general ledger are
 * `missing` income sources that SAY they are not on file, rather than being
 * quietly left out of a report that then reads as though the contractual
 * column were the whole picture.
 *
 * Pure: no DOM, no network, no globals. Loaded after acquisition-terms.js.
 */
(function (root) {

  // ── The report's vocabulary ────────────────────────────────────────────────
  var REPORT_STATES      = ['verified', 'assumption', 'issue', 'missing'];
  var ASSUMPTION_ORIGINS = ['ai_read', 'entered'];

  // How settled each state is, for ordering and for summarising. `missing` is
  // NOT the weakest form of a value — it is the absence of one — so it sits
  // outside the scale, exactly as acquisition-terms.js keeps `missing` out of
  // STATE_STRENGTH.
  var STATE_RANK = { verified: 3, assumption: 2, issue: 1 };

  // ── The five questions, and which of the 27 fields answer each ────────────
  //
  // Every field belongs to EXACTLY ONE question. A field in two questions is a
  // figure a reader sees twice and reconciles by hand; a field in none is a
  // term that silently left the report. A test asserts the partition is total
  // and disjoint against AcquisitionTerms.FIELDS.
  var QUESTION_FIELDS = {
    // 1 · the leasehold's identity and its physical and legal facts
    what_am_i_buying: [
      'tenant_name', 'suite', 'leased_sqft', 'start_date', 'end_date', 'lease_type',
    ],
    // 2 · what the leases contractually oblige the tenant to pay
    what_income: [
      'base_rent', 'security_deposit',
      'cap', 'cap_base_amount', 'admin_fee_pct', 'admin_fee_basis',
      'gross_up_pct', 'expense_stop', 'pro_rata_method', 'excluded_categories',
    ],
    // 3 · what follows the property to the buyer
    what_obligations: [
      'renewal_options', 'audit_rights',
      'tenant_improvement_allowance', 'landlord_work',
      'guarantor_name', 'guaranty_limit',
      'termination_rights', 'expansion_rights',
      'assignment_consent', 'exclusive_use', 'co_tenancy',
    ],
  };

  var QUESTIONS = [
    { id: 'what_am_i_buying',     n: 1, title: 'What am I buying?' },
    { id: 'what_income',          n: 2, title: 'What income am I actually buying?' },
    { id: 'what_obligations',     n: 3, title: 'What obligations am I inheriting?' },
    { id: 'what_evidence',        n: 4, title: 'What documents and evidence prove it?' },
    { id: 'what_needs_attention', n: 5, title: 'What needs attention before acquisition?' },
  ];

  // ── The three income sources (§7: "not merged into one number") ───────────
  //
  // The rent roll and the GL are P1-5's. Until it lands they are present and
  // `missing`, which is the honest shape: a buyer must be able to see that the
  // contractual column is the ONLY column, rather than reading it as the whole
  // answer. P1-5 fills them in without the model changing.
  var INCOME_SOURCES = [
    { id: 'contractual', label: 'Contractual (from the leases)', increment: 'P1-4' },
    { id: 'rent_roll',   label: 'Rent roll (as the seller states it)', increment: 'P1-5' },
    { id: 'gl',          label: 'General ledger (as the books show it)', increment: 'P1-5' },
  ];

  function _str(v, max) {
    return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : null;
  }
  function _AT(opts) {
    return (opts && opts.terms) || (root && root.AcquisitionTerms) || null;
  }

  // ── One term, projected onto the report's vocabulary ──────────────────────
  /**
   * The rules, in the order they are applied — the order IS the design:
   *
   *   missing       nothing on file establishes the term. Says so in words.
   *   conflicting   documents disagree → ISSUE. A contradiction outranks
   *                 everything below it, including `derived`: two defensible
   *                 calculations that disagree are still a disagreement, and
   *                 the reader must choose. Both values are carried.
   *   verified      a person confirmed it and the provenance holds.
   *   unclear       a value whose quote does not support it. Two very
   *                 different things live here, and they are NOT the same:
   *                   · derived  — the clause gives a rate and the figure was
   *                               calculated from it. An ASSUMPTION, flagged
   *                               derived, never an issue for that alone.
   *                   · no quote — a value with nothing behind it. An ISSUE.
   *   ai_extracted  a model read it off a document, nobody confirmed it →
   *                 assumption, origin `ai_read`.
   *
   * `derived` rides on whatever state results, so a CONFIRMED derived figure
   * still shows its calculation and is never presented as document-stated.
   */
  function projectTerm(term) {
    var t = (term && typeof term === 'object') ? term : {};
    var derived = t.derived === true || t.support === 'derived';

    var fact = {
      key:      t.field || null,
      label:    t.label || t.field || null,
      group:    t.group || null,
      type:     t.type || null,
      state:    'missing',
      origin:   null,
      derived:  derived,
      value:    t.value === undefined ? null : t.value,
      termState: t.state || 'missing',
      evidence: null,
      competing: [],
      note:     null,
      source:   'terms',
    };

    if (t.governingDocumentId || t.quote) {
      fact.evidence = {
        documentId:   t.governingDocumentId || null,
        documentName: t.governingDocumentName || null,
        docType:      t.governingDocType || null,
        docStatus:    t.governingDocStatus || null,
        quote:        t.quote || null,
        page:         t.page == null ? null : t.page,
        confidence:   t.confidence == null ? null : t.confidence,
      };
    }

    if (t.state === 'missing' || t.state === undefined) {
      fact.state = 'missing';
      fact.value = null;
      fact.note  = t.note || 'No current document on file establishes this term.';
      return fact;
    }

    if (t.state === 'conflicting') {
      fact.state = 'issue';
      fact.competing = _competing(t);
      fact.note = derived
        ? 'Documents disagree, and the competing figures are calculated rather than stated. A person must choose.'
        : 'Documents disagree. Both values are shown; nothing has been chosen.';
      return fact;
    }

    if (t.state === 'verified') {
      fact.state = 'verified';
      // An ENTERED value (§4l): a person supplied it and no document supports
      // it. It is verified — a person vouched for it — and it carries its
      // origin and NO evidence, so nothing downstream can dress it as a
      // clause. The other origin of a verified fact is a document, and that
      // one carries its evidence as before.
      if (t.support === 'entered') {
        fact.origin   = 'entered';
        fact.evidence = null;
        fact.note     = t.note || 'Entered by a person. No document on file supports it.';
        return fact;
      }
      fact.note  = derived
        ? 'Confirmed by a person. The figure is calculated from the clause, not stated in it.'
        : (t.note || null);
      return fact;
    }

    if (t.state === 'unclear') {
      if (derived) {
        fact.state  = 'assumption';
        fact.origin = 'ai_read';
        fact.note   = t.note
          || 'Calculated from the clause behind it, which gives a rate rather than this figure.';
        return fact;
      }
      fact.state = 'issue';
      fact.note  = t.note
        || (fact.evidence && fact.evidence.quote
              ? 'A clause was found but no value could be read from it.'
              : 'A value with no supporting clause.');
      return fact;
    }

    // ai_extracted, and anything the resolver may add later: read off a
    // document, nobody has confirmed it.
    fact.state  = 'assumption';
    fact.origin = 'ai_read';
    fact.note   = t.note || null;
    return fact;
  }

  /** Both sides of a contradiction, each with the document that asserts it. */
  function _competing(t) {
    var out = [];
    var seen = {};
    function push(value, name, quote, page, isDerived) {
      // A contradiction entry with no value is not a second opinion; showing
      // it as one would put an empty cell beside a real figure and invite the
      // reader to treat the blank as a number.
      if (value === undefined || value === null || value === '') return;
      var k = String(value) + '|' + String(name);
      if (seen[k]) return;
      seen[k] = true;
      out.push({ value: value === undefined ? null : value,
                 documentName: name || null, quote: quote || null,
                 page: page == null ? null : page, derived: !!isDerived });
    }
    if (t.value !== undefined && t.value !== null) {
      push(t.value, t.governingDocumentName, t.quote, t.page, t.support === 'derived');
    }
    (Array.isArray(t.supersededValues) ? t.supersededValues : []).forEach(function (h) {
      if (h) push(h.value, h.fileName, h.quote, h.page, h.support === 'derived');
    });
    (Array.isArray(t.contradictions) ? t.contradictions : []).forEach(function (c) {
      if (!c) return;
      push(c.value !== undefined ? c.value : c.currentValue,
           c.fileName || c.documentName || c.docType, c.quote, c.page, false);
    });
    return out;
  }

  // ── Assumptions a person entered (D-8, read-only in this increment) ───────
  /**
   * `review.data.assumptions[]` — reserved by P1-1, filled by a later
   * deliberate workflow. P1-7 READS it and never writes it, so an entry that
   * predates the authoring UI still appears rather than being hidden.
   * Tolerant by design: a malformed entry is skipped, not rendered as a fact
   * nobody can trace.
   */
  function projectAssumption(entry) {
    var e = (entry && typeof entry === 'object' && !Array.isArray(entry)) ? entry : null;
    if (!e) return null;
    var label = _str(e.label, 200) || _str(e.key, 200) || _str(e.field, 200);
    if (!label) return null;
    return {
      key:   _str(e.key, 120) || _str(e.field, 120) || null,
      label: label,
      group: 'entered',
      type:  null,
      state: 'assumption',
      origin: 'entered',
      derived: false,
      value: e.value === undefined ? null : e.value,
      termState: null,
      evidence: null,
      competing: [],
      note: _str(e.note, 600) || 'Entered by a person. No document on file supports it.',
      source: 'assumptions',
      at:   _str(e.at, 40) || null,
      by:   _str(e.by, 120) || null,
    };
  }

  // ── The model ─────────────────────────────────────────────────────────────
  /**
   * The whole report, for one review.
   *
   *   review     the acquisition review (name, data.assumptions, data.totalSqFt)
   *   families   acquisition_document_families rows
   *   documents  acquisition_documents rows, WITH abstracted_fields merged on
   *   decisions  acquisition_term_decisions rows
   *   opts.terms      AcquisitionTerms (defaults to the global)
   *   opts.reasoner   LeaseIntelligence, passed through to the resolver
   *   opts.at         ISO timestamp for the header
   *
   * Returns { ok, error?, generatedAt, reviewName, leaseholds[], questions[],
   *           summary }. Never throws; a review with nothing in it produces a
   *           report that says so, question by question.
   */
  function buildReport(review, families, documents, decisions, opts) {
    var o  = opts || {};
    var AT = _AT(o);
    if (!AT || typeof AT.resolveFamilyTerms !== 'function') {
      return { ok: false, error: 'AcquisitionTerms is not available', questions: [], leaseholds: [] };
    }

    var rv    = (review && typeof review === 'object') ? review : {};
    var data  = (rv.data && typeof rv.data === 'object') ? rv.data : {};
    var fams  = Array.isArray(families) ? families.filter(Boolean) : [];
    var docs  = Array.isArray(documents) ? documents.filter(Boolean) : [];
    var decs  = Array.isArray(decisions) ? decisions.filter(Boolean) : [];

    // One resolved term set per leasehold. The resolver is P1-4's and is not
    // reimplemented here; this file only projects what it returns.
    var leaseholds = fams.map(function (fam) {
      var mine = docs.filter(function (d) { return d && d.family_id === fam.id; });
      var res  = AT.resolveFamilyTerms(mine, decs.filter(function (d) {
        return d && d.family_id === fam.id;
      }), { reasoner: o.reasoner });
      return {
        familyId: fam.id,
        label:    fam.label || fam.tenant_hint || 'Unnamed leasehold',
        tenantHint: fam.tenant_hint || null,
        suiteHint:  fam.suite_hint || null,
        documentCount: mine.length,
        ok:    !!(res && res.ok),
        terms: (res && res.terms) || {},
      };
    });

    var entered = (Array.isArray(data.assumptions) ? data.assumptions : [])
      .map(projectAssumption).filter(Boolean);

    var questions = [
      // Q1 absorbs the entered assumptions that name no lease field.
      _termQuestion(QUESTIONS[0], AT, leaseholds, entered, true),
      _incomeQuestion(QUESTIONS[1], AT, leaseholds, entered),
      _termQuestion(QUESTIONS[2], AT, leaseholds, entered, false),
      _evidenceQuestion(QUESTIONS[3], docs, fams),
      null, // attention is built last, from everything above
    ];
    questions[4] = _attentionQuestion(QUESTIONS[4], questions.slice(0, 4), leaseholds);

    return {
      ok: true,
      schemaVersion: 1,
      generatedAt: _str(o.at, 40) || new Date().toISOString(),
      reviewName: _str(rv.name, 300) || 'Acquisition Review',
      leaseholds: leaseholds.map(function (l) {
        return { familyId: l.familyId, label: l.label, documentCount: l.documentCount };
      }),
      questions: questions,
      summary: summarize(questions),
    };
  }

  /** Q1 and Q3: one row per field per leasehold, every field always present. */
  function _termQuestion(q, AT, leaseholds, entered, absorbUnmatched) {
    var fields = QUESTION_FIELDS[q.id] || [];
    var sections = leaseholds.map(function (l) {
      var facts = fields.map(function (f) {
        var term = l.terms[f];
        var fact = projectTerm(term || { field: f, label: (AT.FIELD_META[f] || {}).label, state: 'missing' });
        if (!fact.key)   fact.key = f;
        if (!fact.label) fact.label = (AT.FIELD_META[f] || {}).label || f;
        return fact;
      });
      return { leaseholdId: l.familyId, label: l.label, facts: facts, summary: _count(facts) };
    });
    // An entered assumption whose key names one of this question's fields
    // travels with it. Everything else — an exit cap rate, a stabilised NOI,
    // any underwriting figure that is not a lease term — has no field to
    // attach to, and MUST NOT therefore disappear. Those are absorbed by the
    // first question, which is the deal-level one. A report that silently
    // drops what somebody typed into it is the same failure as a report that
    // silently drops a term nothing establishes.
    var mine = entered.filter(function (a) { return a.key && fields.indexOf(a.key) >= 0; });
    if (absorbUnmatched) {
      var claimed = {};
      Object.keys(QUESTION_FIELDS).forEach(function (qid) {
        QUESTION_FIELDS[qid].forEach(function (f) { claimed[f] = true; });
      });
      entered.forEach(function (a) {
        if (!a.key || !claimed[a.key]) mine.push(a);
      });
    }
    return {
      id: q.id, n: q.n, title: q.title,
      sections: sections,
      entered: mine,
      empty: sections.length === 0 && mine.length === 0,
      emptyNote: (sections.length === 0 && mine.length === 0)
        ? 'No leasehold has been identified yet, so nothing can be reported here. '
          + 'Classify a lease document and file it into a leasehold.'
        : (sections.length === 0
            ? 'No leasehold has been identified yet. What is shown below was entered by a person, '
              + 'and no document on file supports it.'
            : null),
      summary: _count(sections.reduce(function (acc, s) { return acc.concat(s.facts); }, []).concat(mine)),
    };
  }

  /**
   * Q2: the same per-field rows as Q1/Q3, PLUS the three income sources side
   * by side. §7 forbids merging them into one number, so the shape carries all
   * three even when two of them are not on file — a buyer must be able to see
   * that the contractual column is the only column.
   */
  function _incomeQuestion(q, AT, leaseholds, entered) {
    var base = _termQuestion(q, AT, leaseholds, entered);
    base.sources = INCOME_SOURCES.map(function (src) {
      if (src.id !== 'contractual') {
        return {
          id: src.id, label: src.label, state: 'missing', available: false,
          note: src.id === 'rent_roll'
            ? 'No rent roll is on file. This column is not zero — it is unevidenced.'
            : 'No general ledger is on file. This column is not zero — it is unevidenced.',
          pendingIncrement: src.increment, leaseholds: [],
        };
      }
      return {
        id: src.id, label: src.label, available: leaseholds.length > 0,
        state: leaseholds.length ? 'available' : 'missing',
        note: leaseholds.length ? null
          : 'No leasehold has been identified yet, so no contractual income can be stated.',
        pendingIncrement: null,
        leaseholds: leaseholds.map(function (l) {
          var t = l.terms.base_rent;
          var f = projectTerm(t || { field: 'base_rent', state: 'missing' });
          return { leaseholdId: l.familyId, label: l.label, baseRent: f };
        }),
      };
    });
    return base;
  }

  /** Q4: the documents, and what each one is being trusted for. */
  function _evidenceQuestion(q, docs, fams) {
    var byFamily = {};
    fams.forEach(function (f) { byFamily[f.id] = f.label || f.tenant_hint || 'Unnamed leasehold'; });
    var items = docs.map(function (d) {
      var settled = d.doc_type_status === 'confirmed' || d.doc_type_status === 'corrected';
      return {
        documentId: d.id,
        fileName:   d.file_name || '(unnamed)',
        docType:    d.doc_type || null,
        docTypeStatus: d.doc_type_status || 'unclassified',
        classificationSettled: settled,
        leasehold:  d.family_id ? (byFamily[d.family_id] || 'a leasehold no longer on file') : null,
        familyStatus: d.family_status || 'unfiled',
        storagePath: d.storage_path || null,
        originalOnFile: !!d.storage_path,
        readForTerms: d.abstraction_status || 'pending',
        readFailedBecause: d.abstraction_error || null,
        superseded: !!d.superseded_by_document_id,
      };
    });
    return {
      id: q.id, n: q.n, title: q.title,
      documents: items,
      counts: {
        total: items.length,
        withOriginal: items.filter(function (i) { return i.originalOnFile; }).length,
        classificationSettled: items.filter(function (i) { return i.classificationSettled; }).length,
        read: items.filter(function (i) { return i.readForTerms === 'success' || i.readForTerms === 'partial'; }).length,
        superseded: items.filter(function (i) { return i.superseded; }).length,
      },
      empty: items.length === 0,
      emptyNote: items.length === 0
        ? 'No documents are on file for this review. Nothing in this report can be evidenced.' : null,
    };
  }

  /**
   * Q5: what a person has to deal with. RANKING IS P1-6's, and this does not
   * invent one: it groups by what the fact is, in the order a buyer cares —
   * contradictions, then values with nothing behind them, then absences — and
   * says so. P1-6 will rank within these and gate completion.
   */
  function _attentionQuestion(q, priorQuestions, leaseholds) {
    var issues = [], missing = [], derivedFacts = [];
    priorQuestions.forEach(function (pq) {
      (pq && pq.sections ? pq.sections : []).forEach(function (s) {
        s.facts.forEach(function (f) {
          var item = { question: pq.id, leasehold: s.label, key: f.key, label: f.label,
                       state: f.state, note: f.note, derived: f.derived,
                       competing: f.competing, evidence: f.evidence };
          if (f.state === 'issue')  issues.push(item);
          if (f.state === 'missing') missing.push(item);
          if (f.derived)            derivedFacts.push(item);
        });
      });
    });
    var docs = (priorQuestions[3] && priorQuestions[3].documents) || [];
    var unreadable = docs.filter(function (d) { return d.readForTerms === 'failed'; });
    var unclassified = docs.filter(function (d) { return !d.classificationSettled && !d.superseded; });

    return {
      id: q.id, n: q.n, title: q.title,
      ranked: false,
      rankingNote: 'Ordered by kind, not yet by severity — ranking and completion gating are P1-6.',
      contradictions: issues.filter(function (i) { return i.competing && i.competing.length > 1; }),
      unevidenced:    issues.filter(function (i) { return !(i.competing && i.competing.length > 1); }),
      missing:        missing,
      derived:        derivedFacts,
      documentsUnreadable:   unreadable,
      documentsUnconfirmed:  unclassified,
      counts: {
        issues: issues.length, missing: missing.length, derived: derivedFacts.length,
        documentsUnreadable: unreadable.length, documentsUnconfirmed: unclassified.length,
      },
      empty: leaseholds.length === 0 && docs.length === 0,
      emptyNote: (leaseholds.length === 0 && docs.length === 0)
        ? 'Nothing is on file yet, so nothing can be said about what needs attention.' : null,
    };
  }

  function _count(facts) {
    var out = { total: 0, verified: 0, assumption: 0, issue: 0, missing: 0,
                assumption_ai_read: 0, assumption_entered: 0, verified_entered: 0, derived: 0 };
    (Array.isArray(facts) ? facts : []).forEach(function (f) {
      if (!f) return;
      out.total++;
      if (REPORT_STATES.indexOf(f.state) >= 0) out[f.state]++;
      if (f.state === 'assumption' && f.origin === 'ai_read') out.assumption_ai_read++;
      if (f.state === 'assumption' && f.origin === 'entered') out.assumption_entered++;
      if (f.state === 'verified' && f.origin === 'entered') out.verified_entered++;
      if (f.derived) out.derived++;
    });
    return out;
  }

  /** The whole report's counts, from the question summaries. Never throws. */
  function summarize(questions) {
    var out = { total: 0, verified: 0, assumption: 0, issue: 0, missing: 0,
                assumption_ai_read: 0, assumption_entered: 0, verified_entered: 0, derived: 0 };
    (Array.isArray(questions) ? questions : []).forEach(function (q) {
      if (!q || !q.summary) return;
      Object.keys(out).forEach(function (k) { out[k] += (q.summary[k] || 0); });
    });
    return out;
  }

  var api = {
    REPORT_STATES: REPORT_STATES,
    ASSUMPTION_ORIGINS: ASSUMPTION_ORIGINS,
    STATE_RANK: STATE_RANK,
    QUESTIONS: QUESTIONS,
    QUESTION_FIELDS: QUESTION_FIELDS,
    INCOME_SOURCES: INCOME_SOURCES,
    projectTerm: projectTerm,
    projectAssumption: projectAssumption,
    buildReport: buildReport,
    summarize: summarize,
  };
  if (root) root.AcquisitionReport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
