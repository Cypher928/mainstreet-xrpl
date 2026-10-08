/**
 * acquisition-assignment.js — Acquisition Intake (I-3a): which property a held
 * document belongs to — the evidence, the ranking, and when to stop and ask.
 *
 * This module PROPOSES; it never assigns. A person assigns (I-3b); I-4 files
 * only human assignments. Nothing here writes anywhere. Wrong property is worse
 * than no property: every uncertain case comes out as a question with the
 * uncertainty spelled out, never as a guess.
 *
 * Evidence — all already in the browser, none of it a model call:
 *   ADDRESS        strong  the prospect's address (house number and street, in
 *                          order, abbreviations expanded on both sides); an
 *                          address-shaped prospect name is matched the same way
 *   STREET_ONLY    weak    the street without its number
 *   NAME           strong  the prospect's name as a phrase, with a distinctive
 *                          word (a generic-only name is never matched, and the
 *                          profile says so)
 *   NAME_PARTIAL   weak    scattered name words
 *   TENANT_KNOWN   medium  the tenant the classifier read is, by the leasehold
 *                          comparator (the 044 rule), the SAME as a tenant known
 *                          to the prospect; weak when that tenant is known to two
 *                          prospects (a chain)
 *   TENANT_SIMILAR weak    similar, not the same — flagged
 *   ROSTER         medium  three or more known tenants named in the text
 *   TENANT_IN_TEXT weak    one or two
 *   SUITE          weak    a known suite — nothing on its own
 *   BATCH_SIBLING  medium  another held file for the same tenant that a person
 *                          assigned, or that names the prospect strongly in its
 *                          own text — one hop, never a chain, never for a shared
 *                          tenant
 * File names are never evidence. An address that matches no prospect is named
 * and blocks a proposal that has no strong clue.
 *
 * Decision: proposed only with a strong text clue — or two medium clues of which
 * one is read from the text — and no other prospect at medium or above;
 * candidates whenever there is competition, when the evidence is AI-derived
 * only, or when an unknown address is present; SEVERAL — and so a multi-select
 * — only when the document's type can legitimately cover several properties
 * (rent roll, PSA, financial statement) AND its mentions are balanced; a lease
 * that mentions a prior location at another property is candidates, never
 * several. Nothing is implicit with a single prospect. Explanations carry the
 * snippet, the page and what matched, and say why not the others.
 */
(function (root) {
  'use strict';

  // ── Vocabulary shared with acquisition-leasehold.js (a test holds them equal) ──
  var LEGAL_SUFFIX = { llc: 1, inc: 1, incorporated: 1, corp: 1, corporation: 1, co: 1, company: 1, ltd: 1,
                       limited: 1, lp: 1, llp: 1, plc: 1, pllc: 1, pc: 1, pa: 1, dba: 1 };
  var FILLER = { and: 1, of: 1, the: 1, a: 1, an: 1, at: 1, by: 1 };
  var GENERIC_TENANT = { cafe: 1, coffee: 1, bakery: 1, restaurant: 1, grill: 1, kitchen: 1, bar: 1, pizza: 1, deli: 1,
    shop: 1, shops: 1, store: 1, stores: 1, market: 1, markets: 1, supermarket: 1, supermarkets: 1, salon: 1, spa: 1,
    nails: 1, studio: 1, services: 1, service: 1, group: 1, holdings: 1, enterprises: 1, partners: 1, associates: 1,
    international: 1, retail: 1, center: 1, wellness: 1, security: 1, insurance: 1, bank: 1, pharmacy: 1,
    fitness: 1, gym: 1, dental: 1, medical: 1, clinic: 1, health: 1 };
  var GENERIC_PROPERTY = { plaza: 1, center: 1, centre: 1, shopping: 1, mall: 1, retail: 1, square: 1, commons: 1,
    marketplace: 1, village: 1, crossing: 1, station: 1, property: 1, properties: 1, building: 1,
    street: 1, st: 1, avenue: 1, ave: 1, road: 1, rd: 1, boulevard: 1, blvd: 1, drive: 1, dr: 1, lane: 1, ln: 1,
    way: 1, suite: 1, ste: 1, highway: 1, hwy: 1, parkway: 1, pkwy: 1 };

  // Address words, expanded on both sides before they are compared.
  var ABBREV = {
    st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', blvd: 'boulevard', dr: 'drive', ln: 'lane', hwy: 'highway',
    pkwy: 'parkway', ct: 'court', pl: 'place', ter: 'terrace', cir: 'circle', sq: 'square', trl: 'trail',
    ste: 'suite', apt: 'apartment', fl: 'floor', bldg: 'building', n: 'north', s: 'south', e: 'east', w: 'west',
    ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest', mt: 'mount', ft: 'fort',
  };
  var STREET_SUFFIX = { street: 1, avenue: 1, road: 1, boulevard: 1, drive: 1, lane: 1, highway: 1, parkway: 1, court: 1,
    place: 1, terrace: 1, circle: 1, square: 1, trail: 1, way: 1, plaza: 1, commons: 1, crossing: 1, row: 1, loop: 1 };
  var UNIT_WORDS = { suite: 1, unit: 1, apartment: 1, floor: 1, room: 1, building: 1 };

  var STRENGTH = { STRONG: 'strong', MEDIUM: 'medium', WEAK: 'weak' };
  var KIND = { ADDRESS: 'address', STREET_ONLY: 'street_only', NAME: 'name', NAME_PARTIAL: 'name_partial',
               TENANT_KNOWN: 'tenant_known', TENANT_SIMILAR: 'tenant_similar', ROSTER: 'roster',
               TENANT_IN_TEXT: 'tenant_in_text', SUITE: 'suite', BATCH_SIBLING: 'batch_sibling' };
  var TEXT_BASED = { address: 1, street_only: 1, name: 1, name_partial: 1, roster: 1, tenant_in_text: 1 };
  var AI_DERIVED = { tenant_known: 1, tenant_similar: 1, suite: 1, batch_sibling: 1 };
  var NOTE = { SHARED_TENANT: 'shared_tenant', UNKNOWN_ADDRESS: 'unknown_address', GENERIC_NAME: 'generic_name',
               NO_ADDRESS: 'no_address', NO_TEXT: 'no_text', ONLY_PROSPECT: 'only_prospect', AI_ONLY: 'ai_only',
               TYPE_UNSET: 'type_unset', FAINT: 'faint', SEVERAL_MENTIONS: 'several_mentions' };
  var STATE = { PROPOSED: 'proposed', CANDIDATES: 'candidates', SEVERAL: 'several', NONE: 'none' };
  var PORTFOLIO_TYPES = { rent_roll: 1, psa: 1, financial_statement: 1 };
  var ROSTER_MIN = 3;
  var BALANCE_RATIO = 1 / 3;
  var WEIGHT = { strong: 3, medium: 2, weak: 1 };
  var TYPE_LABELS = { original_lease: 'original lease', amendment: 'amendment', renewal: 'renewal', extension: 'extension',
    assignment: 'assignment', guaranty: 'guaranty', estoppel: 'estoppel', snda: 'SNDA', side_letter: 'side letter',
    psa: 'purchase agreement', rent_roll: 'rent roll', financial_statement: 'financial statement', invoice: 'invoice',
    other: 'document', unknown: 'document' };

  function _str(v) { return (v == null) ? '' : String(v); }
  function _arr(v) { return Array.isArray(v) ? v : []; }
  function _isNum(w) { return /^\d+$/.test(w); }
  function _norm(w) { return ABBREV[w] || w; }
  function _a(label) { return (/^[aeiou]/i.test(label) ? 'an ' : 'a ') + label; }
  function _A(label) { var s = _a(label); return s.charAt(0).toUpperCase() + s.slice(1); }
  function typeLabel(t) { return TYPE_LABELS[t] || 'document'; }

  // ── Words with their place in the original text ───────────────────────────
  // Lower case; "&" reads as "and"; apostrophes vanish; single letters followed
  // by dots join into one word ("L.L.C." → "llc"); everything else that is not
  // a letter or digit separates words. Positions are kept so a clue can quote
  // the page and the words around it.
  function tokenize(text) {
    var s = _str(text).toLowerCase();
    var out = [];
    var re = /[a-z0-9]+|&/g, m;
    while ((m = re.exec(s)) !== null) {
      if (m[0] === '&') { out.push({ w: 'and', s: m.index, e: m.index + 1 }); continue; }
      var tok = { w: m[0], s: m.index, e: m.index + m[0].length };
      var prev = out[out.length - 1];
      if (prev) {
        var gap = s.slice(prev.e, tok.s);
        // "don't" → "dont"; "L.L.C." → "llc" (single letters joined by dots)
        if (/^['’]$/.test(gap) || (gap === '.' && prev.w.length === 1 && /^[a-z]$/.test(prev.w) && tok.w.length === 1 && /^[a-z]$/.test(tok.w))
            || (gap === '.' && /^[a-z]+$/.test(prev.w) && prev.w.length <= 3 && tok.w.length === 1 && /^[a-z]$/.test(tok.w) && prev._joined)) {
          prev.w += tok.w; prev.e = tok.e; prev._joined = true;
          continue;
        }
      }
      out.push(tok);
    }
    return out.map(function (t) { return { w: t.w, s: t.s, e: t.e }; });
  }
  function words(text) { return tokenize(text).map(function (t) { return t.w; }); }
  function distinctive(ws) {
    return _arr(ws).filter(function (w) { return !FILLER[w] && !LEGAL_SUFFIX[w] && !GENERIC_PROPERTY[w] && !_isNum(w) && w.length >= 3; });
  }

  // Page of an offset: the page markers the readers write ("--- Page 3 ---")
  // introduce a page; offset 0 is inside page 1.
  function pageAt(text, offset) {
    var s = _str(text).slice(0, Math.max(0, offset || 0));
    var m = s.match(/--- Page \d+ ---/g);
    return m && m.length ? m.length : 1;
  }
  // The words around a match, page markers removed, cut edges marked.
  function snippetAt(text, s, e) {
    var t = _str(text);
    var from = Math.max(0, s - 40), to = Math.min(t.length, e + 40);
    var piece = t.slice(from, to).replace(/--- (?:Page \d+|Document truncated) ---/g, ' ').replace(/\s+/g, ' ').trim();
    return '“' + (from > 0 ? '…' : '') + piece + (to < t.length ? '…' : '') + '”';
  }

  // Every place a sequence of words appears, in order, abbreviations expanded
  // on both sides.
  function findSequence(tokens, seq) {
    var want = _arr(seq).map(_norm).filter(Boolean);
    if (!want.length) return [];
    var hits = [];
    for (var i = 0; i + want.length <= tokens.length; i++) {
      var ok = true;
      for (var j = 0; j < want.length; j++) { if (_norm(tokens[i + j].w) !== want[j]) { ok = false; break; } }
      if (ok) hits.push(i);
    }
    return hits;
  }
  function locate(text, seq) {
    var tokens = tokenize(text);
    return findSequence(tokens, seq).map(function (i) {
      var s = tokens[i].s, e = tokens[i + seq.length - 1].e;
      return { s: s, e: e, page: pageAt(text, s), snippet: snippetAt(text, s, e) };
    });
  }

  // "120 Maple Ave, Springfield" → { number: '120', street: ['maple', 'avenue'] }.
  // The street runs from the number to the first street-suffix word (included),
  // or four words at most; a unit ("Suite 110") is not an address.
  function addressParts(address) {
    var ws = words(address);
    var ni = -1;
    for (var i = 0; i < ws.length; i++) if (_isNum(ws[i])) { ni = i; break; }
    if (ni === -1 || ni > 0 && UNIT_WORDS[ws[ni - 1]]) return { ok: false, number: null, street: [] };
    var street = [];
    for (var j = ni + 1; j < ws.length && street.length < 4; j++) {
      var w = _norm(ws[j]);
      if (_isNum(w) || UNIT_WORDS[w]) break;
      street.push(w);
      if (STREET_SUFFIX[w]) break;
    }
    if (!street.length) return { ok: false, number: ws[ni], street: [] };
    return { ok: true, number: ws[ni], street: street };
  }

  // ── What is known about a prospect ─────────────────────────────────────────
  function _tenantNamesOf(review, families, docs) {
    var out = [];
    var d = review && review.data ? review.data : {};
    _arr(d.tenants).forEach(function (t) { var n = _str(t && (t.tenant_name || t.tenantName)).trim(); if (n) out.push(n); });
    _arr(families).forEach(function (f) { var n = _str(f && (f.tenant_name || f.tenantName)).trim(); if (n) out.push(n); });
    return out;
  }
  function _sameTenant(a, b, deps) {
    if (!a || !b) return false;
    var cmp = deps && typeof deps.compareTenantNames === 'function' ? deps.compareTenantNames(a, b) : undefined;
    if (cmp === null) return true;
    if (cmp && cmp.level) return false;
    // No comparator: the names without legal suffixes and filler, as words.
    var wa = words(a).filter(function (w) { return !LEGAL_SUFFIX[w] && !FILLER[w]; }).join(' ');
    var wb = words(b).filter(function (w) { return !LEGAL_SUFFIX[w] && !FILLER[w]; }).join(' ');
    return !!wa && wa === wb;
  }
  function _similarTenant(a, b, deps) {
    var cmp = deps && typeof deps.compareTenantNames === 'function' ? deps.compareTenantNames(a, b) : undefined;
    return (cmp && cmp.level === 'uncertain' && !/blank|too generic/.test(_str(cmp.why))) ? cmp.why : null;
  }
  function profileOf(review, families, docs, deps) {
    var name = _str(review && review.name).trim();
    var address = _str(review && review.data && review.data.address).trim();
    var ap = addressParts(address);
    var nameAp = addressParts(name);
    var nameWords = words(name).filter(function (w) { return !FILLER[w]; });
    var dist = distinctive(nameWords);
    var tenants = [];
    _tenantNamesOf(review, families, docs).forEach(function (n) {
      if (!tenants.some(function (t) { return _sameTenant(t, n, deps); })) tenants.push(n);
    });
    var suites = [];
    _arr(review && review.data && review.data.tenants).forEach(function (t) { var s = _str(t && t.suite).trim(); if (s && suites.indexOf(s) === -1) suites.push(s); });
    var famById = {};
    _arr(families).forEach(function (f) { if (f && f.id) famById[f.id] = f; });
    var docRows = _arr(docs).filter(Boolean).map(function (r) {
      var fam = r.family_id ? famById[r.family_id] : null;
      var fields = r.abstracted_fields && r.abstracted_fields.fields;
      var tn = fam ? _str(fam.tenant_name).trim() : (fields && fields.tenant_name && fields.tenant_name.value ? _str(fields.tenant_name.value).trim() : '');
      return { fileName: _str(r.file_name), docType: _str(r.doc_type) || null, docDate: _str(r.doc_date) || null, tenantName: tn || null, superseded: !!r.superseded_by_document_id };
    });
    return {
      reviewId: review ? review.id : null, name: name, address: address || null,
      addressParts: ap.ok ? ap : null, addressShapedName: !ap.ok && nameAp.ok, nameAddressParts: nameAp.ok ? nameAp : null,
      nameWords: nameWords, distinctive: dist, genericName: nameWords.length > 0 && dist.length === 0 && !nameAp.ok,
      tenants: tenants, suites: suites, files: docRows.map(function (d) { return d.fileName; }).filter(Boolean), docs: docRows,
    };
  }
  function prospectsKnowing(profiles, tenantName, deps) {
    return _arr(profiles).filter(function (p) { return p.tenants.some(function (t) { return _sameTenant(tenantName, t, deps); }); });
  }

  // ── Clues ──────────────────────────────────────────────────────────────────
  function clue(kind, strength, extra) {
    var c = { kind: kind, strength: strength, matched: null, source: null, page: null, snippet: null, count: 1, flag: null, aiDerived: !!AI_DERIVED[kind], via: null };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) c[k] = extra[k];
    return c;
  }
  function _hitsFor(text, tokens, seq) {
    return findSequence(tokens, seq).map(function (i) { var s = tokens[i].s, e = tokens[i + seq.length - 1].e; return { page: pageAt(text, s), snippet: snippetAt(text, s, e) }; });
  }
  // The tenant's words as they would be found in the text: no suffix, no filler.
  function _tenantSeq(name) { return words(name).filter(function (w) { return !LEGAL_SUFFIX[w] && !FILLER[w]; }); }

  function directClues(item, profile, allProfiles, deps) {
    var text = _str(item && item.text);
    var tokens = tokenize(text);
    var clues = [];
    if (!tokens.length) return clues;
    var reading = (item && item.reading) || {};

    // The address — or an address-shaped name — as number and street, in order.
    var ap = profile.addressParts || profile.nameAddressParts;
    if (ap) {
      var seq = [ap.number].concat(ap.street);
      var hits = _hitsFor(text, tokens, seq);
      if (hits.length) {
        clues.push(clue(KIND.ADDRESS, STRENGTH.STRONG, { matched: profile.address || profile.name, source: 'the address you gave', page: hits[0].page, snippet: hits[0].snippet, count: hits.length }));
      } else if (ap.street.length >= 2) {
        var sh = _hitsFor(text, tokens, ap.street);
        if (sh.length) clues.push(clue(KIND.STREET_ONLY, STRENGTH.WEAK, { matched: ap.street.join(' '), source: 'the street without its number', page: sh[0].page, snippet: sh[0].snippet, count: sh.length }));
      }
    }
    // The name as a phrase; a generic-only name is never matched.
    if (!profile.genericName && profile.nameWords.length && !profile.addressShapedName) {
      var nh = _hitsFor(text, tokens, profile.nameWords);
      if (nh.length) {
        clues.push(clue(KIND.NAME, STRENGTH.STRONG, { matched: profile.name, source: 'the prospect\'s name', page: nh[0].page, snippet: nh[0].snippet, count: nh.length }));
      } else {
        var found = profile.distinctive.filter(function (w) { return findSequence(tokens, [w]).length > 0; });
        if (found.length) {
          var ph = _hitsFor(text, tokens, [found[0]]);
          clues.push(clue(KIND.NAME_PARTIAL, STRENGTH.WEAK, { matched: found.join(' '), source: 'part of the name', page: ph[0].page, snippet: ph[0].snippet, count: found.length }));
        }
      }
    }
    // The tenant the classifier read, against the tenants the prospect knows.
    var tn = _str(reading.tenantName).trim();
    if (tn && profile.tenants.length) {
      var known = profile.tenants.filter(function (t) { return _sameTenant(tn, t, deps); });
      if (known.length) {
        var shared = prospectsKnowing(allProfiles, tn, deps).length >= 2;
        clues.push(clue(KIND.TENANT_KNOWN, shared ? STRENGTH.WEAK : STRENGTH.MEDIUM, { matched: tn, source: shared ? 'known here AND in another prospect (a chain), so weak' : 'already known to ' + profile.name, flag: shared ? 'shared' : null, aiDerived: true }));
      } else {
        var why = null;
        for (var i = 0; i < profile.tenants.length && !why; i++) why = _similarTenant(tn, profile.tenants[i], deps);
        if (why) clues.push(clue(KIND.TENANT_SIMILAR, STRENGTH.WEAK, { matched: tn, source: why, flag: 'similar', aiDerived: true }));
      }
    }
    // Known tenants named in the text itself.
    var named = [], firstHit = null;
    profile.tenants.forEach(function (t) {
      var seqT = _tenantSeq(t);
      if (!seqT.length) return;
      var th = _hitsFor(text, tokens, seqT);
      if (th.length) { named.push(t); if (!firstHit) firstHit = th[0]; }
    });
    if (named.length >= ROSTER_MIN) {
      clues.push(clue(KIND.ROSTER, STRENGTH.MEDIUM, { matched: named.join(', '), source: named.length + ' known tenants named in the text', page: firstHit.page, snippet: firstHit.snippet, count: named.length }));
    } else if (named.length) {
      clues.push(clue(KIND.TENANT_IN_TEXT, STRENGTH.WEAK, { matched: named.join(', '), source: 'known tenant(s) named in the text', page: firstHit.page, snippet: firstHit.snippet, count: named.length }));
    }
    // A known suite — nothing on its own.
    var suite = _str(reading.suite).trim();
    if (suite && profile.suites.indexOf(suite) >= 0) {
      clues.push(clue(KIND.SUITE, STRENGTH.WEAK, { matched: suite, source: 'the suite the classifier read, a known suite of this prospect', aiDerived: true }));
    }
    return clues;
  }

  // Addresses in the text that match no prospect: a house number followed by
  // one to three words ending in a street suffix. A unit number ("Suite 110,
  // Maple Plaza") is not a house number. Up to three are named.
  function unknownAddresses(item, profiles) {
    var text = _str(item && item.text);
    var tokens = tokenize(text);
    var known = {};
    (profiles || []).forEach(function (p) {
      var ap = p.addressParts || p.nameAddressParts;
      if (ap) known[[ap.number].concat(ap.street).join(' ')] = 1;
    });
    var out = [], seen = {};
    for (var i = 0; i < tokens.length; i++) {
      if (!_isNum(tokens[i].w) || tokens[i].w.length > 6) continue;
      if (i > 0 && UNIT_WORDS[_norm(tokens[i - 1].w)]) continue;
      for (var len = 1; len <= 3 && i + len < tokens.length; len++) {
        var suffix = _norm(tokens[i + len].w);
        if (STREET_SUFFIX[suffix]) {
          var street = tokens.slice(i + 1, i + len + 1).map(function (t) { return _norm(t.w); });
          if (street.length < 2 || street.slice(0, -1).some(function (w) { return _isNum(w) || UNIT_WORDS[w]; })) break;
          var key = [tokens[i].w].concat(street).join(' ');
          if (!known[key] && !seen[key]) {
            seen[key] = 1;
            out.push({ address: text.slice(tokens[i].s, tokens[i + len].e), page: pageAt(text, tokens[i].s), snippet: snippetAt(text, tokens[i].s, tokens[i + len].e) });
          }
          break;
        }
        if (_isNum(suffix)) break;
      }
      if (out.length >= 3) break;
    }
    return out;
  }

  // ── Ranking ───────────────────────────────────────────────────────────────
  function tally(reviewId, clues) {
    var t = { reviewId: reviewId, clues: clues, strong: 0, medium: 0, weak: 0, score: 0, mentions: 0, textBased: 0, aiDerived: 0 };
    clues.forEach(function (c) {
      if (c.kind === KIND.SUITE && clues.length === 1) return;   // a suite alone is nothing
      t[c.strength]++;
      t.score += WEIGHT[c.strength];
      if (c.kind === KIND.ADDRESS || c.kind === KIND.NAME) t.mentions += c.count || 1;
      if (TEXT_BASED[c.kind]) t.textBased++;
      if (AI_DERIVED[c.kind]) t.aiDerived++;
    });
    return t;
  }
  function rank(tallies) {
    return _arr(tallies).slice().sort(function (a, b) {
      return (b.strong - a.strong) || (b.medium - a.medium) || (b.weak - a.weak) || (b.score - a.score) || (b.mentions - a.mentions) || _str(a.reviewId).localeCompare(_str(b.reviewId));
    });
  }

  // ── The decision ──────────────────────────────────────────────────────────
  // ctx: { type, prospectsCount, unknown: unknownAddresses(...), hasText, profiles }
  function decide(ranked, notes, ctx) {
    var c = ctx || {};
    var out = { state: STATE.NONE, proposal: null, candidates: [], basis: null, notes: _arr(notes).slice(), multiAllowed: false };
    var unknown = _arr(c.unknown);
    var addUnknown = function () { unknown.slice(0, 3).forEach(function (u) { out.notes.push({ kind: NOTE.UNKNOWN_ADDRESS, address: u.address, page: u.page }); }); };
    if (!c.hasText) { out.notes.push({ kind: NOTE.NO_TEXT }); out.basis = 'no_text'; return out; }

    var withClue = ranked.filter(function (r) { return r.strong + r.medium + r.weak > 0; });
    var strongs = withClue.filter(function (r) { return r.strong > 0; });

    if (strongs.length >= 2) {
      var byMentions = strongs.slice().sort(function (a, b) { return b.mentions - a.mentions; });
      var max = byMentions[0].mentions || 1, min = byMentions[byMentions.length - 1].mentions || 0;
      var portfolio = !!PORTFOLIO_TYPES[c.type];
      var counts = byMentions.map(function (r) { return { reviewId: r.reviewId, mentions: r.mentions }; });
      if (portfolio && min / max >= BALANCE_RATIO) {
        out.state = STATE.SEVERAL; out.candidates = byMentions; out.multiAllowed = true; out.basis = 'portfolio_balanced';
        out.notes.push({ kind: NOTE.SEVERAL_MENTIONS, basis: out.basis, type: c.type, counts: counts });
      } else {
        out.state = STATE.CANDIDATES; out.candidates = byMentions;
        out.basis = !c.type ? 'type_unset' : (portfolio ? 'portfolio_unbalanced' : 'single_premises');
        if (!c.type) out.notes.push({ kind: NOTE.TYPE_UNSET });
        out.notes.push({ kind: NOTE.SEVERAL_MENTIONS, basis: out.basis, type: c.type, counts: counts });
      }
      addUnknown();
      return out;
    }

    if (strongs.length === 1) {
      var top = strongs[0];
      var others = withClue.filter(function (r) { return r !== top; });
      var mediums = others.filter(function (r) { return r.medium > 0; });
      if (mediums.length) {
        out.state = STATE.CANDIDATES; out.candidates = [top].concat(mediums); out.basis = 'competition';
      } else {
        out.state = STATE.PROPOSED; out.proposal = top; out.candidates = [top]; out.basis = 'strong';
        others.forEach(function (r) { out.notes.push({ kind: NOTE.FAINT, reviewId: r.reviewId }); });
      }
      addUnknown();
      return out;
    }

    // No strong clue anywhere. Two medium clues can carry a proposal only when
    // one of them is read from the TEXT (a roster) — the tenant name the
    // classifier read, and a sibling that shares it, are both AI-derived and
    // together are still only a reason to ask.
    var mediumsAll = withClue.filter(function (r) { return r.medium > 0; });
    if (mediumsAll.length === 1 && mediumsAll[0].medium >= 2) {
      var m = mediumsAll[0];
      var textMedium = m.clues.some(function (cl) { return cl.strength === STRENGTH.MEDIUM && TEXT_BASED[cl.kind]; });
      if (textMedium && !unknown.length) {
        out.state = STATE.PROPOSED; out.proposal = m; out.basis = 'medium_text'; out.candidates = [m];
        withClue.filter(function (r) { return r !== m; }).forEach(function (r) { out.notes.push({ kind: NOTE.FAINT, reviewId: r.reviewId }); });
        return out;
      }
      out.state = STATE.CANDIDATES; out.candidates = withClue; out.basis = textMedium ? 'unknown_address' : 'ai_only';
      if (!textMedium) out.notes.push({ kind: NOTE.AI_ONLY, reviewId: m.reviewId });
      if (c.prospectsCount === 1) out.notes.push({ kind: NOTE.ONLY_PROSPECT });
      addUnknown();
      return out;
    }
    if (withClue.length) {
      out.state = STATE.CANDIDATES; out.candidates = withClue; out.basis = unknown.length ? 'unknown_address' : (mediumsAll.length ? 'medium_only' : 'weak_only');
      if (c.prospectsCount === 1) out.notes.push({ kind: NOTE.ONLY_PROSPECT });
      addUnknown();
      return out;
    }
    out.state = STATE.NONE; out.basis = unknown.length ? 'unknown_address' : 'no_clue';
    addUnknown();
    return out;
  }

  // ── Everything held, every open prospect ──────────────────────────────────
  // Never touches an assignment: what the evidence says is recomputed from
  // scratch; what a person decided is theirs.
  function recompute(items, profiles, deps) {
    var profs = _arr(profiles);
    var live = _arr(items).filter(function (it) { return it && !it.removed && it.state !== 'left_out'; });
    var firstPass = {};
    live.forEach(function (it) {
      var per = {};
      profs.forEach(function (p) { per[p.reviewId] = directClues(it, p, profs, deps); });
      firstPass[it.itemId] = per;
    });
    // Siblings in the batch, one hop: another held file for the SAME tenant
    // that a person assigned to one prospect, or that names a prospect strongly
    // in its own text. Never for a tenant two prospects share (a chain).
    live.forEach(function (it) {
      var tn = _str(it.reading && it.reading.tenantName).trim();
      if (!tn || prospectsKnowing(profs, tn, deps).length >= 2) return;
      live.forEach(function (sib) {
        if (sib === it) return;
        var stn = _str(sib.reading && sib.reading.tenantName).trim();
        if (!stn || !_sameTenant(tn, stn, deps)) return;
        var lend = {};
        if (sib.assignment && sib.assignment.by === 'human' && _arr(sib.assignment.reviewIds).length === 1) {
          lend[sib.assignment.reviewIds[0]] = { human: true };
        } else {
          profs.forEach(function (p) {
            var strong = (firstPass[sib.itemId][p.reviewId] || []).some(function (cl) { return cl.strength === STRENGTH.STRONG && TEXT_BASED[cl.kind]; });
            if (strong) lend[p.reviewId] = { human: false };
          });
        }
        Object.keys(lend).forEach(function (rid) {
          if (!firstPass[it.itemId][rid]) return;
          var entry = firstPass[it.itemId];
          if (entry[rid].some(function (cl) { return cl.kind === KIND.BATCH_SIBLING && cl.via === sib.itemId; })) return;
          entry[rid].push(clue(KIND.BATCH_SIBLING, STRENGTH.MEDIUM, { matched: stn, aiDerived: true,
            source: 'the same tenant appears in ' + _str(sib.name || 'another held file') + ', which ' + (lend[rid].human ? 'you assigned to this prospect' : 'names this prospect in its text'),
            via: sib.itemId, sibling: sib.name || null, human: !!lend[rid].human }));
        });
      });
    });
    var decisions = {}, tallies = {};
    live.forEach(function (it) {
      var per = firstPass[it.itemId];
      var ts = profs.map(function (p) { return tally(p.reviewId, per[p.reviewId] || []); });
      var ranked = rank(ts);
      var notes = [];
      var hasText = _str(it.text).trim().length > 0;
      var tn = _str(it.reading && it.reading.tenantName).trim();
      if (tn && prospectsKnowing(profs, tn, deps).length >= 2) notes.push({ kind: NOTE.SHARED_TENANT, tenant: tn });
      profs.forEach(function (p) { if (p.genericName) notes.push({ kind: NOTE.GENERIC_NAME, reviewId: p.reviewId }); });
      var type = it.type && it.type.value ? it.type.value : null;
      var d = decide(ranked, notes, { type: type, prospectsCount: profs.length, unknown: hasText ? unknownAddresses(it, profs) : [], hasText: hasText });
      // The proposal's or the first candidate's prospect without an address is worth saying.
      var lead = d.proposal || d.candidates[0];
      if (lead) { var lp = profs.filter(function (p) { return p.reviewId === lead.reviewId; })[0]; if (lp && !lp.address && !lp.addressShapedName) d.notes.push({ kind: NOTE.NO_ADDRESS, reviewId: lp.reviewId }); }
      decisions[it.itemId] = d;
      tallies[it.itemId] = ranked;
    });
    return { decisions: decisions, tallies: tallies };
  }

  // ── A person's choice, validated ──────────────────────────────────────────
  function assign(decision, reviewIds, profiles, now) {
    var ids = [];
    _arr(reviewIds).forEach(function (id) { var s = _str(id).trim(); if (s && ids.indexOf(s) === -1) ids.push(s); });
    if (!ids.length) return { ok: false, error: 'Choose a property.' };
    var known = {};
    _arr(profiles).forEach(function (p) { known[p.reviewId] = p; });
    var missing = ids.filter(function (id) { return !known[id]; });
    if (missing.length) return { ok: false, error: 'That prospect is not open.' };
    if (ids.length > 1) {
      if (!decision || !decision.multiAllowed) return { ok: false, error: 'This document can be filed to one property. Only a portfolio document that names several properties in balance can go to more than one.' };
      var named = {};
      _arr(decision.candidates).forEach(function (r) { named[r.reviewId] = 1; });
      if (ids.some(function (id) { return !named[id]; })) return { ok: false, error: 'Only the properties this document names can share it.' };
    }
    var proposedReviewId = decision && decision.proposal ? decision.proposal.reviewId : null;
    return { ok: true, assignment: { reviewIds: ids, by: 'human', at: _str(now) || new Date().toISOString(), fromProposal: ids.length === 1 && proposedReviewId === ids[0], proposedReviewId: proposedReviewId } };
  }

  // ── Words for the screen ──────────────────────────────────────────────────
  function _nameOf(profiles, reviewId) {
    var p = _arr(profiles).filter(function (x) { return x.reviewId === reviewId; })[0];
    return p ? p.name : 'a prospect';
  }
  function clueSentence(c, profiles, reviewId) {
    var P = _nameOf(profiles, reviewId);
    var times = c.count > 1 ? ' ' + c.count + ' times' : '';
    switch (c.kind) {
      case KIND.ADDRESS:        return 'Its address “' + c.matched + '” appears' + times + ' (' + c.snippet + ') — the address you gave.';
      case KIND.STREET_ONLY:    return 'Its street “' + c.matched + '” appears without the number (' + c.snippet + ') — weak.';
      case KIND.NAME:           return '“' + c.matched + '” appears' + times + ' (' + c.snippet + ').';
      case KIND.NAME_PARTIAL:   return 'Part of its name — “' + c.matched + '” — appears (' + c.snippet + ') — weak.';
      case KIND.TENANT_KNOWN:   return 'Tenant read by AI as “' + c.matched + '” — ' + c.source + (c.flag === 'shared' ? '' : '.');
      case KIND.TENANT_SIMILAR: return 'Tenant read by AI as similar to “' + c.matched + '”, not the same — ' + c.source + ' — weak, flagged.';
      case KIND.ROSTER:         return c.count + ' known tenants are named in the text: ' + c.matched + ' (' + c.snippet + ').';
      case KIND.TENANT_IN_TEXT: return 'Known tenant(s) named in the text: ' + c.matched + ' (' + c.snippet + ') — weak.';
      case KIND.SUITE:          return 'Suite ' + c.matched + ' is a known suite of ' + P + ' — weak, only with another clue.';
      case KIND.BATCH_SIBLING:  return 'Tenant “' + c.matched + '” also appears in ' + _str(c.sibling || 'another held file') + ', which ' + (c.human ? 'you assigned to this prospect' : 'names this prospect in its text') + '.';
    }
    return '';
  }
  function _countsText(counts, profiles) { return _arr(counts).map(function (x) { return _nameOf(profiles, x.reviewId) + ' ×' + x.mentions; }).join(', '); }
  function noteSentence(n, profiles) {
    switch (n.kind) {
      case NOTE.UNKNOWN_ADDRESS: return 'Names an address not among your prospects: “' + n.address + '” — create a prospect for it?';
      case NOTE.FAINT:           return 'Faint mention of ' + _nameOf(profiles, n.reviewId) + '.';
      case NOTE.SEVERAL_MENTIONS: {
        var k = _arr(n.counts).length, label = typeLabel(n.type);
        if (n.basis === 'portfolio_balanced')   return 'Names ' + k + ' properties, and ' + _a(label) + ' can cover several — file it to each, or pick one.';
        if (n.basis === 'portfolio_unbalanced') return 'Names ' + k + ' properties, but mostly one (' + _countsText(n.counts, profiles) + ') — ' + _a(label) + ' that covered several would name them in balance.';
        if (n.basis === 'type_unset')           return 'Names ' + k + ' properties (' + _countsText(n.counts, profiles) + ') — say what the document is before it can go to several.';
        return 'Names ' + k + ' properties, but ' + _a(label) + ' covers one premises: ' + _countsText(n.counts, profiles) + '.';
      }
      case NOTE.SHARED_TENANT:   return 'The tenant “' + n.tenant + '” is known to more than one prospect (a chain), so the tenant alone points nowhere.';
      case NOTE.GENERIC_NAME:    return '“' + _nameOf(profiles, n.reviewId) + '” is a generic name — every word describes a kind of property — so the name alone cannot be matched; give it an address.';
      case NOTE.NO_ADDRESS:      return 'No address on record for ' + _nameOf(profiles, n.reviewId) + ' — an address would make matching stronger.';
      case NOTE.NO_TEXT:         return 'Nothing was read from this file, so nothing in it points anywhere.';
      case NOTE.ONLY_PROSPECT:   return 'One open prospect — nothing is assumed; say where this file belongs.';
      case NOTE.AI_ONLY:         return 'Only the tenant name points at ' + _nameOf(profiles, n.reviewId) + ' — confirm it yourself.';
      case NOTE.TYPE_UNSET:      return 'Say what this document is before it can be filed to several.';
    }
    return '';
  }
  function _strengthOf(t) { return t.strong ? 'strong' : t.medium ? 'medium' : t.weak ? 'weak' : 'none'; }
  function explain(decision, ranked, profiles) {
    var d = decision || { state: STATE.NONE, candidates: [], notes: [] };
    var names = _arr(d.candidates).map(function (r) { return _nameOf(profiles, r.reviewId); });
    var headline;
    if (d.state === STATE.PROPOSED) headline = 'Proposed: ' + _nameOf(profiles, d.proposal.reviewId);
    else if (d.state === STATE.SEVERAL) headline = 'Names several properties — and may cover them';
    else if (d.state === STATE.CANDIDATES) headline = 'Could belong to ' + names.join(' or ') + ' — which is it?';
    else headline = 'No property is named in this document.';
    var reasons = d.proposal ? d.proposal.clues.map(function (c) { return clueSentence(c, profiles, d.proposal.reviewId); }) : [];
    var others = _arr(ranked).map(function (t) {
      var usable = t.clues.filter(function (c) { return !(c.kind === KIND.SUITE && t.clues.length === 1); });
      return { reviewId: t.reviewId, name: _nameOf(profiles, t.reviewId), strength: _strengthOf(t),
               reasons: usable.length ? usable.map(function (c) { return clueSentence(c, profiles, t.reviewId); }) : ['no mention'] };
    });
    var notes = _arr(d.notes).map(function (n) { return noteSentence(n, profiles); }).filter(Boolean);
    return { headline: headline, reasons: reasons, others: others, notes: notes };
  }

  // ── Near-duplicates in the batch, and what the prospect already holds ─────
  function nearDuplicates(items, deps) {
    var live = _arr(items).filter(function (it) { return it && !it.removed && it.state !== 'left_out' && _str(it.text).trim(); });
    var out = [];
    for (var i = 0; i < live.length; i++) {
      for (var j = i + 1; j < live.length; j++) {
        var a = live[i], b = live[j];
        var ta = a.type && a.type.value, tb = b.type && b.type.value;
        if (!ta || ta !== tb) continue;
        var da = _str(a.reading && a.reading.docDate), db = _str(b.reading && b.reading.docDate);
        if (!da || da !== db) continue;
        var la = _str(a.text).length, lb = _str(b.text).length;
        if (Math.abs(la - lb) > Math.max(la, lb) * 0.1) continue;
        var na = _str(a.reading && a.reading.tenantName).trim(), nb = _str(b.reading && b.reading.tenantName).trim();
        if (!na || !nb || !_sameTenant(na, nb, deps)) continue;
        out.push({ a: a.itemId, b: b.itemId, text: '“' + a.name + '” and “' + b.name + '” look like the same document (same type, date, tenant and length) — if one is a copy, leave it out.' });
      }
    }
    return out;
  }
  function filedConflicts(item, profile, deps) {
    var out = [];
    if (!item || !profile) return out;
    var name = _str(item.name);
    if (name && profile.files.indexOf(name) >= 0) {
      out.push({ kind: 'same_name', text: 'A file named ' + name + ' is already in ' + profile.name + '; filing will supersede it (the earlier upload is kept, marked superseded — one is kept).' });
    }
    var type = item.type && item.type.value, date = _str(item.reading && item.reading.docDate), tn = _str(item.reading && item.reading.tenantName).trim();
    if (type && date && tn) {
      profile.docs.forEach(function (d) {
        if (d.superseded || d.docType !== type || _str(d.docDate) !== date || !d.tenantName || !_sameTenant(tn, d.tenantName, deps)) return;
        out.push({ kind: 'same_document', text: _A(typeLabel(type)) + ' for ' + d.tenantName + ' dated ' + date + ' is already in ' + profile.name + '.' });
      });
    }
    return out;
  }

  var api = {
    LEGAL_SUFFIX: LEGAL_SUFFIX, FILLER: FILLER, GENERIC_TENANT: GENERIC_TENANT, GENERIC_PROPERTY: GENERIC_PROPERTY,
    ABBREV: ABBREV, STREET_SUFFIX: STREET_SUFFIX, UNIT_WORDS: UNIT_WORDS,
    STRENGTH: STRENGTH, KIND: KIND, NOTE: NOTE, STATE: STATE, PORTFOLIO_TYPES: PORTFOLIO_TYPES,
    ROSTER_MIN: ROSTER_MIN, BALANCE_RATIO: BALANCE_RATIO, WEIGHT: WEIGHT, TEXT_BASED: TEXT_BASED, AI_DERIVED: AI_DERIVED,
    tokenize: tokenize, words: words, distinctive: distinctive, pageAt: pageAt, snippetAt: snippetAt, locate: locate,
    findSequence: findSequence, addressParts: addressParts, profileOf: profileOf, prospectsKnowing: prospectsKnowing,
    directClues: directClues, unknownAddresses: unknownAddresses, tally: tally, rank: rank, decide: decide,
    recompute: recompute, assign: assign, clueSentence: clueSentence, noteSentence: noteSentence, explain: explain,
    nearDuplicates: nearDuplicates, filedConflicts: filedConflicts, typeLabel: typeLabel,
  };
  if (root) root.AcquisitionAssignment = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
