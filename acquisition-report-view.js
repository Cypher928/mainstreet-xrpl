'use strict';
/**
 * acquisition-report-view.js — Acquisition Report v2, drawn.
 *
 * Phase 1 of Acquisition Review (docs/ACQUISITION_REVIEW.md §7), increment
 * P1-7. Step R-2 drew questions 3 and 4; step R-3 adds 1 and 2.
 *
 *   1. What am I buying?
 *   2. What income am I actually buying?
 *   3. What obligations am I inheriting?
 *   4. What documents and evidence prove it?
 *
 * Question 5 is drawn IN ITS PLACE as not yet included, rather than being
 * left out: a report that silently skips a question reads as though it
 * answered it.
 *
 * THE ONE RULE THIS FILE KEEPS
 *
 * It renders what acquisition-report.js decided and decides nothing itself.
 * Every state, origin, derived flag, competing value and note comes from
 * AcquisitionReport.buildReport. There is no second projection here, no state
 * computed from a value, and no fact omitted because it would look untidy. If
 * the model and the page ever disagree, the page is wrong.
 *
 * WHAT IT MAY NOT DO
 *
 *   · show a missing term as blank, zero or "none"
 *   · show an AI-read reading and an entered figure under the same label
 *   · show a derived figure as though a document stated it — its clause is
 *     labelled "Calculated from", never "Source"
 *   · pick a side in a contradiction
 *   · imply the report is complete while three of its five questions are not
 *     yet drawn
 *
 * Pure: returns HTML strings. No DOM, no network, no globals. The one thing it
 * cannot know — how to open a stored original — is injected as `linkFor`, so
 * the page passes window.docLinkHtml and a test passes nothing.
 */
(function (root) {

  var STATE_LABEL = {
    verified:   'Verified',
    assumption: 'Assumption',
    issue:      'Issue',
    missing:    'Missing',
  };
  // An assumption always says which kind it is. The two are never shown under
  // one bare word (decision C-3).
  var ORIGIN_LABEL = {
    ai_read: 'AI-read · not confirmed',
    entered: 'Entered · no document',
  };
  var DERIVED_LABEL = 'Derived — calculated from lease terms';

  // The questions drawn in full. The rest are drawn as not yet included, in
  // their place.
  var RENDERED = ['what_am_i_buying', 'what_income', 'what_obligations', 'what_evidence'];

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * A value, as its type reads. Returns NULL for no value — the caller then
   * says the term is not established. It never returns '' or '0' for nothing.
   * A real zero (an explicit denial, "no cap") is a value and is shown.
   */
  function formatValue(value, type) {
    if (value === null || value === undefined || value === '') return null;
    switch (type) {
      case 'money':
        return typeof value === 'number'
          ? '$' + value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(value);
      case 'percent':
        return typeof value === 'number' ? value + '%' : String(value);
      case 'number':
        return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
      case 'boolean':
        return value === true ? 'Yes' : value === false ? 'No' : String(value);
      default:
        return String(value);
    }
  }

  /** The state chip. An assumption carries its origin; a derived fact says so. */
  function stateChip(fact) {
    var f = fact || {};
    var st = STATE_LABEL[f.state] ? f.state : 'missing';
    var html = '<span class="acqr-chip acqr-' + st + '" data-state="' + st + '">'
      + esc(STATE_LABEL[st]) + '</span>';
    if (st === 'assumption' && ORIGIN_LABEL[f.origin]) {
      html += '<span class="acqr-origin acqr-origin-' + esc(f.origin) + '" data-origin="'
        + esc(f.origin) + '">' + esc(ORIGIN_LABEL[f.origin]) + '</span>';
    }
    if (f.derived) {
      html += '<span class="acqr-derived" data-derived="true">' + esc(DERIVED_LABEL) + '</span>';
    }
    return html;
  }

  /**
   * The clause behind a fact. For a derived figure it is labelled
   * "Calculated from" — the clause gives a rate, not this number, and the page
   * must not say otherwise.
   */
  function evidenceHtml(ev, derived, opts) {
    if (!ev || (!ev.quote && !ev.documentName)) return '';
    var o = opts || {};
    var where = [];
    if (ev.documentName) where.push(esc(ev.documentName));
    if (ev.page != null) where.push('p.&nbsp;' + esc(ev.page));
    if (ev.confidence != null) where.push('confidence ' + esc(Math.round(Number(ev.confidence) * 100)) + '%');
    var lead = derived ? 'Calculated from' : 'Source';
    return '<div class="acqr-evidence" data-evidence-kind="' + (derived ? 'calculated-from' : 'source') + '">'
      + '<span class="acqr-evidence-lead">' + lead + ':</span> '
      + (where.length ? '<span class="acqr-evidence-where">' + where.join(' · ') + '</span>' : '')
      + (ev.quote ? '<blockquote class="acqr-quote">&ldquo;' + esc(ev.quote) + '&rdquo;</blockquote>' : '')
      + (ev.docStatus && ev.docStatus !== 'confirmed' && ev.docStatus !== 'corrected'
          ? '<div class="acqr-evidence-caveat">The document’s own classification is not confirmed.</div>' : '')
      + (typeof o.afterEvidence === 'function' ? o.afterEvidence(ev) : '')
      + '</div>';
  }

  /** Both sides of a contradiction. Neither is marked as the answer. */
  function competingHtml(fact) {
    var list = Array.isArray(fact.competing) ? fact.competing : [];
    if (list.length < 2) return '';
    return '<ul class="acqr-competing" data-competing="' + list.length + '">'
      + list.map(function (c) {
          var v = formatValue(c.value, fact.type);
          return '<li class="acqr-competing-item">'
            + '<span class="acqr-competing-value">' + esc(v === null ? '(no value)' : v) + '</span>'
            + (c.derived ? ' <span class="acqr-derived" data-derived="true">' + esc(DERIVED_LABEL) + '</span>' : '')
            + ' <span class="acqr-competing-doc">— ' + esc(c.documentName || 'a document')
            + (c.page != null ? ', p.&nbsp;' + esc(c.page) : '') + '</span>'
            + (c.quote ? '<blockquote class="acqr-quote">&ldquo;' + esc(c.quote) + '&rdquo;</blockquote>' : '')
            + '</li>';
        }).join('')
      + '</ul>'
      + '<div class="acqr-unchosen">Neither value has been selected.</div>';
  }

  /**
   * A table cell whose contents are ONE element. On a phone the report tables
   * become cards and each <td> a two-column grid (heading, value); a cell with
   * several children would have them dealt across both columns — a contested
   * value's two sides ended up in the heading gutter. One wrapper keeps the
   * cell's content together in the value column at every width.
   */
  function cell(cls, inner) {
    return '<td' + (cls ? ' class="' + cls + '"' : '') + '><div class="acqr-cell">' + inner + '</div></td>';
  }

  /** One fact, as a table row. Every fact renders; none is skipped. */
  function factRow(fact, opts) {
    var f = fact || {};
    var shown = formatValue(f.value, f.type);
    var valueCell;
    // A contradiction's provenance is its competing list — each side with its
    // own document, page and quote. The single "Source:" block would name one
    // side after "Neither value has been selected", and read as a choice.
    var contested = f.state === 'issue' && Array.isArray(f.competing) && f.competing.length >= 2;
    if (f.state === 'missing') {
      valueCell = '<span class="acqr-missing-value">Not established</span>';
    } else if (contested) {
      valueCell = '<span class="acqr-contested">Contested</span>';
    } else {
      valueCell = shown === null
        ? '<span class="acqr-missing-value">No value read</span>'
        : '<span class="acqr-value">' + esc(shown) + '</span>';
    }
    return '<tr class="acqr-fact" data-key="' + esc(f.key || '') + '" data-state="' + esc(f.state || 'missing') + '"'
      + (f.origin ? ' data-origin="' + esc(f.origin) + '"' : '')
      + (f.derived ? ' data-derived="true"' : '') + '>'
      + cell('acqr-label', esc(f.label || f.key || ''))
      + cell('acqr-state', stateChip(f))
      + cell('acqr-detail', valueCell
        + competingHtml(f)
        + (contested ? '' : evidenceHtml(f.evidence, f.derived, opts))
        + (f.note ? '<div class="acqr-note">' + esc(f.note) + '</div>' : ''))
      + '</tr>';
  }

  function countsHtml(s) {
    var c = s || {};
    var parts = [
      ['verified', c.verified], ['assumption', c.assumption], ['issue', c.issue], ['missing', c.missing],
    ].map(function (p) {
      return '<span class="acqr-count acqr-' + p[0] + '" data-count="' + p[0] + '">'
        + esc(STATE_LABEL[p[0]]) + ' ' + esc(p[1] || 0) + '</span>';
    });
    // The two kinds of assumption are counted separately, never merged.
    if (c.assumption) {
      parts.push('<span class="acqr-count-sub" data-count="assumption_ai_read">'
        + esc(ORIGIN_LABEL.ai_read) + ' ' + esc(c.assumption_ai_read || 0) + '</span>');
      parts.push('<span class="acqr-count-sub" data-count="assumption_entered">'
        + esc(ORIGIN_LABEL.entered) + ' ' + esc(c.assumption_entered || 0) + '</span>');
    }
    if (c.derived) {
      parts.push('<span class="acqr-count-sub" data-count="derived">Derived ' + esc(c.derived) + '</span>');
    }
    return '<div class="acqr-counts">' + parts.join('') + '</div>';
  }

  function questionHead(q) {
    return '<div class="rpt-section-title acqr-qtitle">' + esc(q.n) + '. ' + esc(q.title) + '</div>';
  }

  /** Q3 — one table per leasehold, every obligation listed. */
  function renderObligations(q, opts) {
    if (!q) return '';
    var html = '<section class="acqr-question" data-q="' + esc(q.id) + '">' + questionHead(q);
    if (q.empty) {
      return html + '<p class="acqr-empty">' + esc(q.emptyNote) + '</p></section>';
    }
    html += countsHtml(q.summary);
    (q.sections || []).forEach(function (s) {
      html += '<div class="acqr-leasehold" data-leasehold="' + esc(s.leaseholdId || '') + '">'
        + '<div class="acqr-leasehold-name">' + esc(s.label) + '</div>'
        + '<table class="rpt-table acqr-table"><thead><tr>'
        + '<th>Obligation</th><th>State</th><th>What the documents say</th>'
        + '</tr></thead><tbody>'
        + (s.facts || []).map(function (f) { return factRow(f, opts); }).join('')
        + '</tbody></table></div>';
    });
    if (q.emptyNote) html += '<p class="acqr-empty">' + esc(q.emptyNote) + '</p>';
    html += enteredHtml(q.entered, opts);
    return html + '</section>';
  }

  /** Figures a person entered. Never mixed into the AI-read rows. */
  function enteredHtml(list, opts) {
    var items = Array.isArray(list) ? list : [];
    if (!items.length) return '';
    return '<div class="acqr-entered" data-entered="' + items.length + '">'
      + '<div class="acqr-leasehold-name">Entered by a person</div>'
      + '<table class="rpt-table acqr-table"><thead><tr>'
      + '<th>Figure</th><th>State</th><th>Detail</th></tr></thead><tbody>'
      + items.map(function (f) { return factRow(f, opts); }).join('')
      + '</tbody></table></div>';
  }

  // ── R-3: questions 1 and 2 ──────────────────────────────────────────────
  //
  // Drawn from the same model, with the same row, chip and evidence as Q3.
  // renderObligations is left exactly as R-2 shipped it; these share its
  // parts, not its code path, so a change here cannot move question 3.

  /** One table per leasehold, every field the model gives, under `factHead`. */
  function termTables(q, opts, factHead) {
    return (q.sections || []).map(function (s) {
      return '<div class="acqr-leasehold" data-leasehold="' + esc(s.leaseholdId || '') + '">'
        + '<div class="acqr-leasehold-name">' + esc(s.label) + '</div>'
        + '<table class="rpt-table acqr-table"><thead><tr>'
        + '<th>' + esc(factHead) + '</th><th>State</th><th>What the documents say</th>'
        + '</tr></thead><tbody>'
        + (s.facts || []).map(function (f) { return factRow(f, opts); }).join('')
        + '</tbody></table></div>';
    }).join('');
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /**
   * Q1 — the property, the leaseholds on file, and who each one is.
   *
   * The model knows the property only by the name a person gave the review.
   * No document is read for a property-level fact (address, site, building
   * area, title), so that is said, as Missing, rather than left out — a
   * report that opens on a name and then lists tenants reads as though the
   * building had been established.
   */
  function renderIdentity(q, model, opts) {
    if (!q) return '';
    var m = model || {};
    var html = '<section class="acqr-question" data-q="' + esc(q.id) + '">' + questionHead(q);

    html += '<div class="acqr-property" data-property="true">'
      + '<div class="acqr-leasehold-name">' + esc(m.reviewName || 'Acquisition Review') + '</div>'
      + '<div class="acqr-note">The name this review was given. It is a label, not a fact any document establishes.</div>'
      + '<div class="acqr-property-facts" data-state="missing">'
      +   '<span class="acqr-chip acqr-missing" data-state="missing">Missing</span> '
      +   '<span class="acqr-missing-value">Property-level facts — address, site, building area, title — are not established.</span>'
      +   '<div class="acqr-note">No document is read for them yet. What follows is per leasehold, from the leases.</div>'
      + '</div></div>';

    // What the workspace holds: each leasehold, and every document that is in
    // none — nothing such a document says can appear under a leasehold.
    var ls = Array.isArray(m.leaseholds) ? m.leaseholds : [];
    var q4 = (m.questions || []).filter(function (x) { return x && x.id === 'what_evidence'; })[0];
    var unfiled = (q4 && Array.isArray(q4.documents) ? q4.documents : [])
      .filter(function (d) { return d && !d.leasehold && !d.superseded; });
    html += '<div class="acqr-counts">'
      + '<span class="acqr-count" data-count="leaseholds">Leaseholds ' + esc(ls.length) + '</span>'
      + '<span class="acqr-count" data-count="unfiled">Documents in no leasehold ' + esc(unfiled.length) + '</span>'
      + '</div>';
    if (ls.length) {
      html += '<ul class="acqr-roster">' + ls.map(function (l) {
        return '<li data-leasehold="' + esc(l.familyId || '') + '">' + esc(l.label)
          + ' <span class="acqr-roster-docs">— ' + esc(plural(l.documentCount || 0, 'document', 'documents')) + '</span></li>';
      }).join('') + '</ul>';
    }
    if (unfiled.length) {
      html += '<div class="acqr-note" data-unfiled="' + unfiled.length + '">'
        + esc(plural(unfiled.length, 'document is', 'documents are'))
        + ' not filed into any leasehold, so nothing '
        + (unfiled.length === 1 ? 'it says' : 'they say') + ' is reported under one: '
        + unfiled.map(function (d) { return esc(d.fileName); }).join(', ') + '.</div>';
    }

    if (q.empty) return html + '<p class="acqr-empty">' + esc(q.emptyNote) + '</p></section>';
    html += countsHtml(q.summary);
    html += termTables(q, opts, 'Fact');
    if (q.emptyNote) html += '<p class="acqr-empty">' + esc(q.emptyNote) + '</p>';
    html += enteredHtml(q.entered, opts);
    return html + '</section>';
  }

  /** The contractual figure in one cell: its state, then its value or why there is none. */
  function sourceValue(f) {
    var x = f || {};
    var shown = formatValue(x.value, x.type);
    var contested = x.state === 'issue' && Array.isArray(x.competing) && x.competing.length >= 2;
    var v = x.state === 'missing' ? '<span class="acqr-missing-value">Not established</span>'
      : contested ? '<span class="acqr-contested">Contested</span>'
      : shown === null ? '<span class="acqr-missing-value">No value read</span>'
      : '<span class="acqr-value">' + esc(shown) + '</span>';
    return '<span data-source="contractual" data-state="' + esc(x.state || 'missing') + '"'
      + (x.derived ? ' data-derived="true"' : '') + '>' + stateChip(x) + ' ' + v + '</span>';
  }

  /**
   * §7: contractual income next to what the rent roll claims and what the GL
   * shows — not merged into one number. The model carries all three sources
   * even when two are not on file; so does the page, so a buyer can see the
   * contractual column is the only column.
   */
  function sourcesHtml(sources) {
    var list = Array.isArray(sources) ? sources.filter(Boolean) : [];
    if (!list.length) return '';
    var contractual = list.filter(function (s) { return s.id === 'contractual'; })[0] || { leaseholds: [] };
    var absent = list.filter(function (s) { return !s.available; });
    var html = '<div class="acqr-sources" data-sources="' + list.length + '">'
      + '<div class="acqr-leasehold-name">Base rent, by source</div>'
      + '<div class="acqr-note">Each column says only what its own source says. They are not merged into one number.</div>';
    var rows = (contractual.leaseholds || []).map(function (l) {
      return '<tr class="acqr-income" data-leasehold="' + esc(l.leaseholdId || '') + '">'
        + cell('acqr-label', esc(l.label))
        + list.map(function (s) {
            if (s.id === 'contractual') return cell('', sourceValue(l.baseRent));
            return cell('', '<span data-source="' + esc(s.id) + '" data-state="' + esc(s.state || 'missing') + '">'
              + '<span class="acqr-chip acqr-missing" data-state="missing">Missing</span> '
              + '<span class="acqr-missing-value">Not on file</span></span>');
          }).join('')
        + '</tr>';
    }).join('');
    if (rows) {
      html += '<table class="rpt-table acqr-table acqr-sources-table"><thead><tr><th>Leasehold</th>'
        + list.map(function (s) { return '<th>' + esc(s.label) + '</th>'; }).join('')
        + '</tr></thead><tbody>' + rows + '</tbody></table>';
    } else if (contractual.note) {
      html += '<p class="acqr-empty">' + esc(contractual.note) + '</p>';
    }
    absent.forEach(function (s) {
      if (s.id === 'contractual') return;
      html += '<div class="acqr-note" data-absent-source="' + esc(s.id) + '">' + esc(s.note || '') + '</div>';
    });
    if (absent.some(function (s) { return s.pendingIncrement; })) {
      html += '<div class="acqr-intake" data-financial-intake="not-included">'
        + 'Financial intake — the rent roll and the general ledger — is not yet part of Acquisition Review. '
        + 'Until it is, the only income this report can state is what the leases say.</div>';
    }
    return html + '</div>';
  }

  /** Q2 — what the leases oblige the tenant to pay, and what else would say so. */
  function renderIncome(q, opts) {
    if (!q) return '';
    var html = '<section class="acqr-question" data-q="' + esc(q.id) + '">' + questionHead(q);
    html += sourcesHtml(q.sources);
    if (q.empty) return html + '<p class="acqr-empty">' + esc(q.emptyNote) + '</p></section>';
    html += countsHtml(q.summary);
    html += termTables(q, opts, 'Term');
    if (q.emptyNote) html += '<p class="acqr-empty">' + esc(q.emptyNote) + '</p>';
    html += enteredHtml(q.entered, opts);
    return html + '</section>';
  }

  /** Q4 — every document, what it is, and whether it can be trusted yet. */
  function renderEvidence(q, opts) {
    if (!q) return '';
    var o = opts || {};
    var html = '<section class="acqr-question" data-q="' + esc(q.id) + '">' + questionHead(q);
    if (q.empty) {
      return html + '<p class="acqr-empty">' + esc(q.emptyNote) + '</p></section>';
    }
    var c = q.counts || {};
    html += '<div class="acqr-counts">'
      + '<span class="acqr-count" data-count="documents">Documents ' + esc(c.total || 0) + '</span>'
      + '<span class="acqr-count" data-count="withOriginal">Original on file ' + esc(c.withOriginal || 0) + '</span>'
      + '<span class="acqr-count" data-count="classificationSettled">Classification confirmed '
      + esc(c.classificationSettled || 0) + '</span>'
      + '<span class="acqr-count" data-count="read">Read for terms ' + esc(c.read || 0) + '</span>'
      + (c.superseded ? '<span class="acqr-count" data-count="superseded">Replaced ' + esc(c.superseded) + '</span>' : '')
      + '</div>';
    html += '<table class="rpt-table acqr-table"><thead><tr>'
      + '<th>Document</th><th>What it is</th><th>Leasehold</th><th>Read for terms</th>'
      + '</tr></thead><tbody>';
    (q.documents || []).forEach(function (d) {
      var opener = d.originalOnFile && typeof o.linkFor === 'function'
        ? o.linkFor(d.storagePath, d.fileName)
        : '<span class="acqr-docname">' + esc(d.fileName) + '</span>';
      var typeLabel = typeof o.typeLabel === 'function' ? o.typeLabel(d.docType) : (d.docType || 'Unclassified');
      html += '<tr class="acqr-doc" data-doc="' + esc(d.documentId || '') + '"'
        + ' data-settled="' + (d.classificationSettled ? 'true' : 'false') + '"'
        + (d.superseded ? ' data-superseded="true"' : '') + '>'
        + cell('', opener
          + (d.originalOnFile ? '' : '<div class="acqr-note">Original not on file.</div>')
          + (d.superseded ? '<div class="acqr-note">Replaced by a newer upload — kept on record.</div>' : ''))
        + cell('', esc(d.docType ? typeLabel : 'Unclassified')
          + '<div class="acqr-note">' + (d.classificationSettled
              ? 'Confirmed by a person.'
              : (d.docType ? 'Proposed by AI — not confirmed.' : 'Nobody has said what this is yet.')) + '</div>')
        + cell('', d.leasehold ? esc(d.leasehold)
            + '<div class="acqr-note">' + (d.familyStatus === 'confirmed' ? 'Filing confirmed.' : 'Filing proposed — not confirmed.') + '</div>'
            : '<span class="acqr-missing-value">Not in a leasehold</span>')
        + cell('', readCell(d))
        + '</tr>';
    });
    return html + '</tbody></table></section>';
  }

  var READ_LABEL = {
    success: 'Read', partial: 'Read — nothing established',
    failed: 'Could not be read', skipped: 'Not a lease document', pending: 'Not read yet',
  };
  var REASON_LABEL = {
    no_text: 'no usable text on file', transport: 'the request did not complete',
    upstream_timeout: 'the reader did not answer in time', upstream_error: 'the reader returned an error',
    unparsable: 'the answer could not be read', no_fields: 'the answer carried no terms',
  };
  function readCell(d) {
    var label = READ_LABEL[d.readForTerms] || 'Not read yet';
    var why = d.readForTerms === 'failed' && REASON_LABEL[d.readFailedBecause]
      ? '<div class="acqr-note" data-reason="' + esc(d.readFailedBecause) + '">Because '
        + esc(REASON_LABEL[d.readFailedBecause]) + '.</div>' : '';
    return '<span data-read="' + esc(d.readForTerms) + '">' + esc(label) + '</span>' + why;
  }

  /** A question this step does not yet draw — shown in its place, never skipped. */
  function renderPending(q) {
    if (!q) return '';
    return '<section class="acqr-question acqr-pending" data-q="' + esc(q.id) + '" data-pending="true">'
      + questionHead(q)
      + '<p class="acqr-empty">Not included in this version of the report yet. '
      + 'Nothing here should be read as an answer to this question.</p></section>';
  }

  /** What this report does and does not cover, before anything else is read. */
  function coverageHtml(model) {
    var qs = (model && model.questions) || [];
    var drawn = qs.filter(function (q) { return q && RENDERED.indexOf(q.id) >= 0; }).length;
    return '<div class="acqr-coverage" data-drawn="' + drawn + '" data-of="' + qs.length + '">'
      + '<strong>This report currently answers ' + drawn + ' of ' + qs.length + ' questions.</strong> '
      + 'It is not a complete acquisition report. '
      + qs.map(function (q) {
          var on = RENDERED.indexOf(q.id) >= 0;
          return '<span class="acqr-cov ' + (on ? 'acqr-cov-on' : 'acqr-cov-off') + '">'
            + esc(q.n) + '. ' + esc(q.title) + (on ? '' : ' — not yet included') + '</span>';
        }).join('')
      + '</div>';
  }

  /** The legend, so every chip on the page can be read without guessing. */
  function legendHtml() {
    return '<div class="acqr-legend">'
      + '<span class="acqr-chip acqr-verified">Verified</span> a person confirmed it and a document supports it · '
      + '<span class="acqr-chip acqr-assumption">Assumption</span> read by AI and not confirmed, or entered with no document · '
      + '<span class="acqr-chip acqr-issue">Issue</span> documents disagree, or a value has nothing behind it · '
      + '<span class="acqr-chip acqr-missing">Missing</span> nothing on file answers this · '
      + '<span class="acqr-derived">' + esc(DERIVED_LABEL) + '</span> the figure is worked out from a clause that states a rate, not stated in it'
      + '</div>';
  }

  /**
   * The report body, in §7's order. Questions in RENDERED are drawn in full;
   * the others are drawn in place as not yet included.
   */
  function renderReport(model, opts) {
    var m = model || {};
    if (!m.ok) {
      return '<p class="acqr-empty">This report could not be built: '
        + esc(m.error || 'unknown reason') + '.</p>';
    }
    var byId = {};
    (m.questions || []).forEach(function (q) { if (q) byId[q.id] = q; });
    var body = coverageHtml(m) + legendHtml();
    (m.questions || []).forEach(function (q) {
      if (!q) return;
      if (q.id === 'what_am_i_buying') body += renderIdentity(q, m, opts);
      else if (q.id === 'what_income') body += renderIncome(q, opts);
      else if (q.id === 'what_obligations') body += renderObligations(q, opts);
      else if (q.id === 'what_evidence') body += renderEvidence(q, opts);
      else body += renderPending(q);
    });
    return '<div class="acqr" data-report="acquisition-v2">' + body + '</div>';
  }

  var api = {
    STATE_LABEL: STATE_LABEL,
    ORIGIN_LABEL: ORIGIN_LABEL,
    DERIVED_LABEL: DERIVED_LABEL,
    RENDERED: RENDERED,
    READ_LABEL: READ_LABEL,
    REASON_LABEL: REASON_LABEL,
    esc: esc,
    formatValue: formatValue,
    stateChip: stateChip,
    factRow: factRow,
    renderIdentity: renderIdentity,
    renderIncome: renderIncome,
    renderObligations: renderObligations,
    renderEvidence: renderEvidence,
    renderPending: renderPending,
    renderReport: renderReport,
  };
  if (root) root.AcquisitionReportView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
