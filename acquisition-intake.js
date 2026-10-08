/**
 * acquisition-intake.js — Acquisition Intake, the Documents step (I-2): what a
 * dropped file becomes while it is HELD in the tab — accepted or refused, read,
 * classified, waiting for a person — before anything is filed anywhere.
 *
 * Pure rules, no DOM, no network, no storage. script.js owns the reader (one
 * file at a time, paused by a 429) and the screen; this module decides:
 *
 *   - what may be dropped: the union of the two lanes' accept lists (PDF, text,
 *     JPG, PNG, WebP), the MIME type matching the extension when one is given,
 *     an empty file refused, everything else named and refused with a hint;
 *   - what a held file is at each moment: queued → reading → classified |
 *     needs_type | read_failed, and left_out at a person's word;
 *   - what is read and what is not: text and the text layer of a PDF are read
 *     and classified; an image is NEVER transcribed or classified here, and a
 *     PDF whose text layer is too thin to be a text layer (a scan) is NEVER
 *     sent on — both wait for a person to say what they are. A lease a person
 *     names is read by the lease reader when it is FILED (I-4), not here;
 *   - how sure the classifier was: below the floor its answer is kept as a hint
 *     and the file needs a type; below the confidence line the type stands but
 *     is badged; the row always says who proposed the type — the AI or you;
 *   - which lane a type goes to when filed: a lease-family type to the lease
 *     lane, the rest to the documents lane, no type to nobody;
 *   - that a file left out while it is being read stays left out when the read
 *     lands; that a type a person set is never re-read; that a person's type
 *     keeps the AI's answer beside it; that held text is capped so sixty files
 *     fit in a tab;
 *   - a duplicate (same name, same size) is held but left out, so a person sees
 *     it happened.
 *
 * Nothing here writes. I-4 is the first step that files.
 */
(function (root) {
  'use strict';

  // ── What may be dropped ────────────────────────────────────────────────────
  // The union of the lease lane's accept (.pdf,.txt) and the documents lane's
  // (.pdf,.jpg,.jpeg,.png,.webp). The MIME a browser reports must agree with
  // the extension when it reports one; a missing MIME is allowed (some systems
  // report none for .txt).
  var ACCEPT = {
    pdf:  ['application/pdf'],
    txt:  ['text/plain'],
    jpg:  ['image/jpeg'],
    jpeg: ['image/jpeg'],
    png:  ['image/png'],
    webp: ['image/webp'],
  };
  var ACCEPT_ATTR = '.pdf,.txt,.jpg,.jpeg,.png,.webp';
  var IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, webp: 1 };

  var MAX_HELD = 100;              // files held in one tab; the 60-file walk sits well inside
  var TEXT_CAP = 150000;           // characters of text kept per file (the classifier reads 12,000)
  var SCAN_LETTERS_TOTAL = 100;    // a PDF with fewer letters than this in its text layer is a scan
  var SCAN_LETTERS_PER_PAGE = 20;  // …or with fewer than this per page read
  var CLASSIFIER_FLOOR = 0.5;      // below: the AI's answer is a hint, the file needs a type
  var LOW_CONFIDENCE = 0.75;       // below: the type stands, badged "Low confidence"
  var MIN_TEXT_TO_CLASSIFY = 40;   // _acqClassifyDocument's own floor; said here so the screen can say it

  var STATE = { QUEUED: 'queued', READING: 'reading', CLASSIFIED: 'classified', NEEDS_TYPE: 'needs_type',
                READ_FAILED: 'read_failed', LEFT_OUT: 'left_out' };
  var SETTLED = { classified: 1, needs_type: 1, read_failed: 1 };

  var WARN = {
    DUPLICATE: 'A file with this name and size is already held — this copy is left out.',
    ORIGINAL_NOT_STORABLE: 'Over the upload limit: the text can be read and classified; the original will not be stored.',
  };

  // Why a file needs a person (item.reason).
  var REASON = {
    IMAGE: 'image',                 // never transcribed here
    SCANNED: 'scanned',             // a PDF with no real text layer; never transcribed here
    NO_TEXT: 'no_text',             // a text file with nothing to read
    LOW: 'low_confidence',          // the classifier's answer is below the floor
    CLASSIFIER: 'classifier_unavailable',
    UNKNOWN: 'unknown',             // the classifier said "unknown"
  };

  // ── Types and lanes ────────────────────────────────────────────────────────
  // acquisition-documents.js's table, reproduced: the labels and which types
  // belong to a leasehold (a test holds the two equal). A lease-family type is
  // filed through the lease lane; the rest through the documents lane; no type
  // goes nowhere until a person speaks.
  var TYPES = {
    original_lease:      { label: 'Original Lease',      family: true  },
    amendment:           { label: 'Amendment',           family: true  },
    renewal:             { label: 'Renewal',             family: true  },
    extension:           { label: 'Extension',           family: true  },
    assignment:          { label: 'Assignment',          family: true  },
    guaranty:            { label: 'Guaranty',            family: true  },
    estoppel:            { label: 'Estoppel',            family: true  },
    snda:                { label: 'SNDA',                family: true  },
    side_letter:         { label: 'Side Letter',         family: true  },
    psa:                 { label: 'Purchase Agreement',  family: false },
    rent_roll:           { label: 'Rent Roll',           family: false },
    financial_statement: { label: 'Financial Statement', family: false },
    invoice:             { label: 'Invoice',             family: false },
    other:               { label: 'Other',               family: false },
    unknown:             { label: 'Unclassified',        family: false },
  };
  var LANE = { LEASE: 'lease', OTHER: 'other' };
  var LANE_LABEL = {
    lease: 'Lease lane — read for its terms when filed',
    other: 'Documents lane — filed with the review',
  };
  function typeLabel(t) { return (TYPES[t] && TYPES[t].label) || 'Unclassified'; }
  function isFamilyType(t) { return !!(TYPES[t] && TYPES[t].family); }
  function laneFor(type) {
    if (!type || !TYPES[type] || type === 'unknown') return null;
    return isFamilyType(type) ? LANE.LEASE : LANE.OTHER;
  }
  function laneLabel(lane) { return LANE_LABEL[lane] || ''; }
  // What a person may pick: every real type; never "unknown".
  var PICKS = Object.keys(TYPES).filter(function (t) { return t !== 'unknown'; });
  function picksFor(item) { void item; return PICKS.slice(); }

  // ── Accepting a drop ───────────────────────────────────────────────────────
  function extOf(name) {
    var m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function accept(f) {
    var name = f && f.name ? String(f.name) : '';
    var ext = extOf(name);
    if (!name) return { ok: false, reason: 'The file has no name.', hint: 'Re-select it and try again.' };
    if (!ACCEPT[ext]) {
      return { ok: false, ext: ext, reason: (ext ? '.' + ext : 'This kind of file') + ' is not a document Intake reads.',
               hint: 'Drop a PDF, a text file, or a JPG, PNG or WebP image.' };
    }
    var mime = f.type ? String(f.type).toLowerCase() : '';
    if (mime && ACCEPT[ext].indexOf(mime) === -1) {
      return { ok: false, ext: ext, reason: 'The file says it is ' + mime + ', not a .' + ext + '.',
               hint: 'Its contents may not be what the name says — re-export it and try again.' };
    }
    var size = Number(f.size);
    if (!Number.isFinite(size) || size < 0) return { ok: false, ext: ext, reason: 'The file size could not be read.', hint: 'Re-select it and try again.' };
    if (size === 0) return { ok: false, ext: ext, reason: 'The file is empty (0 bytes).', hint: 'Re-export it and try again.' };
    return { ok: true, ext: ext, image: !!IMAGE_EXT[ext] };
  }

  var _seq = 0;
  function mintId() {
    return 'held-' + Date.now().toString(36) + '-' + (++_seq) + '-' + Math.random().toString(36).slice(2, 7);
  }
  function newItem(f) {
    var ext = (f && f.ext) || extOf(f && f.name);
    return {
      itemId: mintId(), file: null,
      name: String((f && f.name) || ''), bytes: Number((f && f.size) || 0), mime: String((f && f.type) || ''), ext: ext,
      image: !!IMAGE_EXT[ext],
      state: STATE.QUEUED,
      text: '', textSource: null, pagesRead: 0, truncated: false, letters: 0,
      reading: null,                                   // the classifier's answer, as returned
      type: { value: null, source: null, confidence: null, evidence: null },
      aiType: null,                                    // the AI's type, kept beside a person's
      lane: null, warnings: [], error: null, reason: null,
      attempts: 0, resume: null, picking: false, readToken: 0, removed: false,
    };
  }

  // Same name, same size, already held — the earlier one, or null.
  function duplicateOf(held, item) {
    for (var i = 0; i < (held || []).length; i++) {
      var h = held[i];
      if (h && h !== item && h.name === item.name && h.bytes === item.bytes) return h;
    }
    return null;
  }

  // ── Reading ────────────────────────────────────────────────────────────────
  // The reader's own lines — "--- Page 3 ---", "--- Document truncated ---",
  // "[This page could not be read …]" — are not the document's text and are not
  // counted: fifty page markers must not make a scan look like a text layer.
  function withoutReaderArtifacts(text) {
    return String(text || '').replace(/^--- (?:Page \d+|Document truncated) ---$/gm, '').replace(/^\[[^\]\n]*\]$/gm, '');
  }
  function letterCount(text) { var m = withoutReaderArtifacts(text).match(/[A-Za-z]/g); return m ? m.length : 0; }
  // A PDF whose text layer is too thin to be a text layer is a scan: fewer
  // letters in all than a paragraph, or fewer per page than a caption.
  function isScanned(info) {
    if (!info || info.isPdf === false) return false;
    var letters = typeof info.letters === 'number' ? info.letters : letterCount(info.text);
    if (letters < SCAN_LETTERS_TOTAL) return true;
    var pages = Number(info.pagesRead) || 0;
    if (pages > 0 && letters / pages < SCAN_LETTERS_PER_PAGE) return true;
    return false;
  }
  function capText(text) {
    var s = String(text || '');
    return s.length > TEXT_CAP ? { text: s.slice(0, TEXT_CAP), truncated: true } : { text: s, truncated: false };
  }

  // ── Transitions ────────────────────────────────────────────────────────────
  // Every change of a held file's state goes through here, so the rules are in
  // one place. Returns the item; throws on a transition the rules refuse.
  function transition(item, event, info) {
    info = info || {};
    switch (event) {
      case 'read_start':
        if (item.state === STATE.LEFT_OUT) throw new Error('a left-out file is not read');
        if (item.type.source === 'human') throw new Error('a type set by a person is not re-read');
        item.state = STATE.READING; item.attempts += 1; item.error = null; item.reason = null;
        item.readToken += 1;
        return item;

      case 'read_ok': {
        // What the reader found. An image never gets here as text (the reader
        // does not read images); if it did, it is still a person's call.
        var capped = capText(info.text);
        item.text = capped.text; item.truncated = capped.truncated;
        item.textSource = info.textSource || (item.ext === 'pdf' ? 'pdf' : 'text');
        item.pagesRead = Number(info.pagesRead) || 0;
        item.letters = letterCount(item.text);
        if (item.image) return needsType(item, REASON.IMAGE);
        if (item.ext === 'pdf' && isScanned({ isPdf: true, text: item.text, letters: item.letters, pagesRead: item.pagesRead })) {
          return needsType(item, REASON.SCANNED);
        }
        if (item.letters < MIN_TEXT_TO_CLASSIFY) return needsType(item, REASON.NO_TEXT);
        return item;   // still reading: the classifier is next
      }

      case 'classified': {
        var r = info.reading || null;
        item.reading = r;
        if (!r || !r.docType) return needsType(item, REASON.CLASSIFIER);
        var conf = typeof r.confidence === 'number' ? r.confidence : null;
        var t = TYPES[r.docType] ? r.docType : 'unknown';
        item.aiType = { value: t, confidence: conf, evidence: r.evidence || null };
        if (t === 'unknown') return needsType(item, REASON.UNKNOWN);
        if (conf !== null && conf < CLASSIFIER_FLOOR) return needsType(item, REASON.LOW);
        item.type = { value: t, source: 'ai', confidence: conf, evidence: r.evidence || null };
        item.lane = laneFor(t);
        item.state = STATE.CLASSIFIED; item.reason = null;
        return item;
      }

      case 'read_failed':
        item.state = STATE.READ_FAILED; item.error = String(info.error || 'The file could not be read.');
        return item;

      case 'set_type': {
        var pick = info.type;
        if (!TYPES[pick] || pick === 'unknown') throw new Error('not a type a person may pick: ' + pick);
        if (item.state === STATE.LEFT_OUT) throw new Error('a left-out file is not typed');
        // The AI's answer is kept beside the person's, never forgotten.
        item.type = { value: pick, source: 'human', confidence: null, evidence: null };
        item.lane = laneFor(pick);
        item.state = STATE.CLASSIFIED; item.reason = null; item.picking = false;
        return item;
      }

      case 'requeue':
        // Not the file's fault (the classifier asked for a wait): back to the
        // queue as it was, to be read again when the reader resumes.
        if (item.state !== STATE.READING) return item;
        item.readToken += 1;
        item.state = STATE.QUEUED;
        return item;

      case 'leave_out':
        // A read in flight lands on a token that no longer matches and is dropped.
        item.readToken += 1;
        item.state = STATE.LEFT_OUT; item.picking = false;
        return item;

      case 'include':
        if (item.state !== STATE.LEFT_OUT) return item;
        item.readToken += 1;
        item.state = item.type.value ? STATE.CLASSIFIED : STATE.QUEUED;
        return item;

      case 'retry':
        if (item.type.source === 'human') throw new Error('a type set by a person is not re-read');
        if (item.state !== STATE.READ_FAILED && item.state !== STATE.NEEDS_TYPE && item.state !== STATE.CLASSIFIED) return item;
        item.readToken += 1;
        item.state = STATE.QUEUED; item.error = null; item.reason = null;
        return item;

      default:
        throw new Error('unknown transition: ' + event);
    }
  }
  function needsType(item, reason) {
    item.state = STATE.NEEDS_TYPE; item.reason = reason;
    item.type = { value: null, source: null, confidence: null, evidence: null };
    item.lane = null;
    return item;
  }

  // The next file the one reader takes: the first queued file that is not left
  // out. One at a time — the classifier is rate-limited per user.
  function nextToRead(held) {
    for (var i = 0; i < (held || []).length; i++) {
      var h = held[i];
      if (h && h.state === STATE.QUEUED && !h.removed) return h;
    }
    return null;
  }

  // ── What the row says ──────────────────────────────────────────────────────
  function pct(c) { return Math.round(c * 100) + '%'; }
  function describe(item) {
    var t = item.type || {};
    switch (item.state) {
      case STATE.QUEUED:   return { label: 'Waiting to be read', badge: null, note: null };
      case STATE.READING:  return { label: 'Reading…', badge: null, note: null };
      case STATE.LEFT_OUT: return { label: 'Left out', badge: null, note: 'Not filed. Include it to bring it back.' };
      case STATE.READ_FAILED: return { label: 'Could not be read', badge: null, note: item.error || null };
      case STATE.NEEDS_TYPE: {
        var why = item.reason === REASON.IMAGE ? 'An image is not read here — say what it is.'
               : item.reason === REASON.SCANNED ? 'This PDF has no text layer (a scan) — say what it is; a lease you name is read when it is filed.'
               : item.reason === REASON.NO_TEXT ? 'Nothing to read in this file — say what it is.'
               : item.reason === REASON.LOW ? 'AI was not sure' + (item.aiType && item.aiType.value ? ' — it read "' + typeLabel(item.aiType.value) + '" at ' + pct(item.aiType.confidence || 0) : '') + ' — say what it is.'
               : item.reason === REASON.UNKNOWN ? 'AI could not tell what this is — say what it is.'
               : 'The classifier was unavailable — say what it is, or read it again.';
        return { label: 'Needs a type', badge: null, note: why };
      }
      case STATE.CLASSIFIED: {
        var who = t.source === 'human'
          ? 'set by you' + (item.aiType && item.aiType.value && item.aiType.value !== t.value ? ' (AI read "' + typeLabel(item.aiType.value) + '")' : '')
          : 'proposed by AI' + (typeof t.confidence === 'number' ? ' at ' + pct(t.confidence) : '');
        var badge = (t.source === 'ai' && typeof t.confidence === 'number' && t.confidence < LOW_CONFIDENCE) ? 'Low confidence' : null;
        return { label: typeLabel(t.value), badge: badge, note: who };
      }
    }
    return { label: '', badge: null, note: null };
  }

  // Short hints from the classifier's reading, for the row.
  function hintsFor(reading) {
    if (!reading) return [];
    var out = [];
    if (reading.tenantName) out.push('Tenant: ' + reading.tenantName);
    if (reading.docDate) out.push('Dated ' + reading.docDate);
    if (reading.suite) out.push('Suite ' + reading.suite);
    return out;
  }

  function summary(held) {
    var c = { held: 0, classified: 0, needsType: 0, failed: 0, leftOut: 0, reading: 0, queued: 0, textChars: 0 };
    (held || []).forEach(function (h) {
      if (!h) return;
      c.held++;
      c.textChars += (h.text || '').length;
      if (h.state === STATE.CLASSIFIED) c.classified++;
      else if (h.state === STATE.NEEDS_TYPE) c.needsType++;
      else if (h.state === STATE.READ_FAILED) c.failed++;
      else if (h.state === STATE.LEFT_OUT) c.leftOut++;
      else if (h.state === STATE.READING) c.reading++;
      else if (h.state === STATE.QUEUED) c.queued++;
    });
    return c;
  }
  function summaryText(held) {
    var c = summary(held);
    if (!c.held) return '';
    var parts = [c.held + ' file' + (c.held === 1 ? '' : 's') + ' held'];
    if (c.classified) parts.push(c.classified + ' classified');
    if (c.needsType) parts.push(c.needsType + ' need' + (c.needsType === 1 ? 's' : '') + ' a type');
    if (c.failed) parts.push(c.failed + ' could not be read');
    if (c.leftOut) parts.push(c.leftOut + ' left out');
    return parts.join(' · ');
  }

  // The reader's one line: what it is doing now.
  function readerStatus(held, st) {
    st = st || {};
    var c = summary(held);
    if (st.paused) {
      var now = typeof st.now === 'number' ? st.now : Date.now();
      var secs = st.resumeAt ? Math.max(0, Math.ceil((st.resumeAt - now) / 1000)) : null;
      return 'Paused — the classifier asked for a wait' + (secs !== null ? '; reading resumes in ' + secs + 's' : '') + '.';
    }
    if (st.current) {
      var cur = (held || []).filter(function (h) { return h && h.itemId === st.current; })[0];
      var done = c.classified + c.needsType + c.failed;
      return 'Reading ' + (cur ? '"' + cur.name + '"' : 'a file') + ' — ' + done + ' of ' + (c.held - c.leftOut) + ' read.';
    }
    if (c.queued) return c.queued + ' waiting to be read.';
    return '';
  }

  var api = {
    ACCEPT: ACCEPT, ACCEPT_ATTR: ACCEPT_ATTR, IMAGE_EXT: IMAGE_EXT, MAX_HELD: MAX_HELD, TEXT_CAP: TEXT_CAP,
    SCAN_LETTERS_TOTAL: SCAN_LETTERS_TOTAL, SCAN_LETTERS_PER_PAGE: SCAN_LETTERS_PER_PAGE,
    CLASSIFIER_FLOOR: CLASSIFIER_FLOOR, LOW_CONFIDENCE: LOW_CONFIDENCE, MIN_TEXT_TO_CLASSIFY: MIN_TEXT_TO_CLASSIFY,
    STATE: STATE, SETTLED: SETTLED, WARN: WARN, REASON: REASON, TYPES: TYPES, LANE: LANE,
    typeLabel: typeLabel, isFamilyType: isFamilyType, laneFor: laneFor, laneLabel: laneLabel, picksFor: picksFor,
    extOf: extOf, accept: accept, newItem: newItem, duplicateOf: duplicateOf,
    letterCount: letterCount, isScanned: isScanned, capText: capText,
    transition: transition, nextToRead: nextToRead,
    describe: describe, hintsFor: hintsFor, summary: summary, summaryText: summaryText, readerStatus: readerStatus,
  };
  if (root) root.AcquisitionIntake = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
