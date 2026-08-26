'use strict';
/**
 * lease-period.js — where a lease term sits relative to the CAM period, decided
 * once.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * One line in reconciliation-engine.js was the only place a lease date ever met
 * the CAM year:
 *
 *     if (t?.end_date && t.end_date < evalDate && r.totalAllocated > 0)
 *
 * with `evalDate` = the last day of the CAM year. That is a single-endpoint test
 * standing in for a question about two intervals overlapping, and it failed in
 * both directions at once:
 *
 *   A lease ENDING inside the period — an ordinary expiry, five days away — was
 *   reported as "a lease that ended 2026-08-31", past tense about a future date,
 *   and blocked from billing.
 *
 *   A lease STARTING inside the period was not tested at all. A tenant who took
 *   occupancy on 1 September was billed all twelve months, marked "Calc
 *   verified", and raised no finding of any severity.
 *
 * A false positive on the endpoint it tested, a silent false negative on the one
 * it did not.
 *
 * WHAT THIS MODULE DOES AND DOES NOT DO
 *
 * It CLASSIFIES. It reports which of the interval cases a lease is in, and the
 * dates bounding the overlap. It deliberately does NOT compute an occupancy
 * factor, a day count, or any apportionment: whether a partial period is billed
 * in full, apportioned by days, apportioned by months, or governed by the
 * lease's own commencement/surrender language is an open product question, and
 * a helper that returned `factor: 0.6658` would settle it by accident. When that
 * decision is made, the factor belongs here beside the classification — and in
 * the allocation, which is the only place money is decided.
 *
 * FAILS CLOSED. A date that cannot be read is not treated as absent and it is
 * not silently compared. `'8/31/2026' < '2026-12-31'` is false as a string
 * comparison, so a malformed end date used to slip past the old predicate with
 * no finding at all. Anything unreadable here classifies as needing
 * confirmation.
 *
 * Exposes: window.LeasePeriod  (and module.exports for the test suites)
 */
(function (root) {

  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  /**
   * ONE reading of a lease date, shaped like SourceValues.readArea/readMoney:
   * a value or NULL, never a silently-wrong value.
   *
   *   status  'ok' | 'absent' | 'unreadable'
   *   value   'YYYY-MM-DD', or null
   *   normalised  true when the input was not already ISO and had to be parsed
   */
  function readDate(v) {
    if (v === null || v === undefined) return { value: null, status: 'absent', raw: v, normalised: false };
    var s = String(v).trim();
    if (s === '') return { value: null, status: 'absent', raw: v, normalised: false };
    if (ISO.test(s)) return { value: s, status: 'ok', raw: v, normalised: false };
    // Not ISO. Ingest normalises via toISODate and the edit form is an
    // <input type="date">, so this is a repair path, not the common one. Local
    // getters, not toISOString: the string was written in a local format and
    // must not shift a day crossing UTC.
    var d = new Date(s);
    if (isNaN(d.getTime())) return { value: null, status: 'unreadable', raw: v, normalised: false };
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      value: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
      status: 'ok', raw: v, normalised: true,
    };
  }

  /** The CAM period for a calendar year. */
  function periodForYear(year) {
    var y = parseInt(year, 10);
    if (!isFinite(y)) return null;
    return { start: y + '-01-01', end: y + '-12-31' };
  }

  /**
   * Accepts what callers already have. A `{start, end}` passes through — which
   * is how a fiscal CAM period will arrive without another change here. A bare
   * date string is read as the period END, with the start taken as 1 January of
   * that year, which is exactly what the caller meant when it passed
   * `${getCamYear()}-12-31`.
   */
  function periodFrom(input) {
    if (!input) return null;
    if (typeof input === 'object') {
      var s = readDate(input.start), e = readDate(input.end);
      if (s.status !== 'ok' || e.status !== 'ok') return null;
      return { start: s.value, end: e.value };
    }
    var d = readDate(input);
    if (d.status !== 'ok') return null;
    return { start: d.value.slice(0, 4) + '-01-01', end: d.value };
  }

  /**
   * THE ONE OWNER OF "WHEN DOES THIS TENANT OWE CAM".
   *
   * `start_date` is when the LEASE begins. `cam_commencement_date` is when the
   * CAM OBLIGATION begins, and the two differ routinely — free-rent periods,
   * delivery versus opening for business, "CAM commences upon opening". Two
   * fields answering one question is the shape of every defect this codebase has
   * spent weeks removing, so exactly one function resolves them and everything
   * else takes the resolved term. No caller reads `cam_commencement_date`
   * directly; a test asserts that.
   *
   * There is deliberately no `cam_expiration_date`. A CAM obligation ending
   * before the term is rare enough that a manual edit to `end_date` is the right
   * cost, and a second optional end field would be a second representation for
   * no gain.
   */
  /**
   * Read one date field, pairing the stored ISO value with what could not be
   * read.
   *
   * normalizeTenant keeps `start_date`/`end_date`/`cam_commencement_date`
   * strictly ISO-or-empty, so a lease whose term begins "upon substantial
   * completion" stores '' — the same '' as a lease with no date at all. The
   * original text is kept beside it in `unreadableDates`, and this is where the
   * two come back together: the field is empty, but the lease was not silent.
   *
   * The raw travels with the reading so the surfaces can QUOTE it. Telling
   * someone a date cannot be read, without saying what is written there, sends
   * them back to the document to find out what the system already knew.
   */
  function _readField(t, field, altKey) {
    var v = t[field] !== undefined ? t[field] : (altKey ? t[altKey] : undefined);
    var r = readDate(v);
    if (r.status === 'absent') {
      var u = t.unreadableDates;
      var raw = (u && typeof u === 'object') ? u[field] : null;
      if (raw != null && String(raw).trim() !== '') {
        return { value: null, status: 'unreadable', normalised: null, raw: String(raw).trim() };
      }
    }
    r.raw = (v == null || String(v).trim() === '') ? null : String(v).trim();
    return r;
  }

  function obligationTerm(tenant) {
    var t = tenant || {};
    var camStart   = _readField(t, 'cam_commencement_date');
    var leaseStart = _readField(t, 'start_date', 'start');
    var end        = _readField(t, 'end_date', 'end');

    // An UNREADABLE cam_commencement_date is not "fall back to start_date". The
    // field was populated and cannot be read, so the answer is unknown and the
    // term must fail closed rather than quietly using a different date.
    var useCam = camStart.status === 'ok' || camStart.status === 'unreadable';

    var startReading = useCam ? camStart : leaseStart;
    return {
      start:            startReading.value,
      end:              end.value,
      startStatus:      startReading.status,
      endStatus:        end.status,
      startNormalised:  startReading.normalised,
      endNormalised:    end.normalised,
      startSource:      useCam ? 'cam_commencement_date' : 'start_date',
      leaseStart:       leaseStart.value,
      camStart:         camStart.value,
      // What is actually written where a date should be — quotable by any
      // surface reporting that it could not be read.
      startRaw:         startReading.raw || null,
      endRaw:           end.raw || null,
    };
  }

  /**
   * How a partial period is apportioned, and WHERE THAT ANSWER CAME FROM.
   *
   * `basis` alone is not enough: per-diem chosen by the product and per-diem
   * written into the lease are the same word and a completely different claim.
   * `source: 'default'` is what keeps a system assumption from ever reading as
   * lease-confirmed — the same discipline SourceValues applies to a number that
   * could not be read.
   */
  var BASES = ['per_diem', 'monthly', 'full_period'];
  var DEFAULT_BASIS = 'per_diem';

  function partialPeriodBasis(tenant) {
    var t = tenant || {};
    var raw = t.partial_period_basis;
    var v = raw == null ? '' : String(raw).trim().toLowerCase();
    // The latest manual snapshot, read once: it answers both questions below —
    // whether a recognised value was a manager's answer, and, when the field
    // itself came back empty, what that answer was.
    var snaps = (t.fieldEvidence && t.fieldEvidence.partial_period_basis
                 && t.fieldEvidence.partial_period_basis.snapshots) || [];
    var manualSnap = null;
    for (var i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i] && snaps[i].manuallyEdited === true) { manualSnap = snaps[i]; break; }
    }
    if (BASES.indexOf(v) >= 0) {
      // A MANAGER'S CONFIRMATION IS NOT THE LEASE'S LANGUAGE. When the lease is
      // silent the manager is asked once, and that answer is written to the same
      // field with a manual evidence snapshot behind it. Both then read as
      // "stated", because both are a decision someone made — but the source has
      // to say which, or a confirmation quietly becomes a citation.
      return { basis: v, source: manualSnap ? 'manual' : 'lease', stated: true, raw: raw };
    }
    // THE EVIDENCE ROW IS THE RECORD OF THE CONFIRMATION, not a footnote to it.
    // The confirmation writes two places: the field on the tenant, which travels
    // in the property blob, and a tenant_field_evidence row, which is written
    // immediately and is authoritative. Those two can come apart — the blob is
    // written on a debounce, and savePropertyData strips fieldEvidence out of it
    // entirely — and when they did, the value came back null while the manual
    // snapshot came back intact, so the tenant was held for a confirmation that
    // had already been given. Read the answer back off the evidence when the
    // field is empty; the provenance travels with it, so this can never turn a
    // manager's answer into a lease citation.
    if (v === '' && manualSnap) {
      var mv = manualSnap.value == null ? '' : String(manualSnap.value).trim().toLowerCase();
      if (BASES.indexOf(mv) >= 0) {
        return { basis: mv, source: 'manual', stated: true, raw: manualSnap.value };
      }
    }
    if (v !== '') {
      // Populated with something that is not one of the three. Not silently
      // defaulted — an unrecognised basis is a data problem, and saying so is
      // cheaper than guessing which of the three was meant.
      return { basis: DEFAULT_BASIS, source: 'unrecognised', stated: false, raw: raw };
    }
    return { basis: DEFAULT_BASIS, source: 'default', stated: false, raw: null };
  }

  var CASES = {
    covers_period:    'Runs for the whole CAM period',
    commences_within: 'Begins inside the CAM period',
    expires_within:   'Ends inside the CAM period',
    within_period:    'Begins and ends inside the CAM period',
    ended_before:     'Ended before the CAM period began',
    begins_after:     'Does not begin until after the CAM period ends',
    unknown_end:      'No end date on file',
    unknown_start:    'No start date on file',
    no_term:          'No lease dates on file',
    unreadable:       'A lease date on file cannot be read',
    no_period:        'No CAM period supplied',
  };

  /**
   * @param {object} term    anything carrying start_date/end_date (or start/end)
   * @param {object|string} period  {start,end}, or the period end as a date string
   * @returns {object} classification — dates and booleans only, no arithmetic
   */
  function classify(term, period) {
    var p = periodFrom(period);
    var t = term || {};
    // THROUGH THE RESOLVER, NEVER AROUND IT. classify() used to read start_date
    // and end_date itself, which would have made it a second reader the moment
    // cam_commencement_date existed. obligationTerm() is the only function in
    // the codebase that touches either field.
    var ot = obligationTerm(t);
    var s = { value: ot.start, status: ot.startStatus, normalised: ot.startNormalised };
    var e = { value: ot.end,   status: ot.endStatus,   normalised: ot.endNormalised };

    var out = {
      case: null, label: null,
      periodStart: p ? p.start : null, periodEnd: p ? p.end : null,
      leaseStart: s.value, leaseEnd: e.value,
      startStatus: s.status, endStatus: e.status,
      startSource: ot.startSource,
      // What is written on the lease where a date should be. Carried so a
      // surface can quote it without reading start_date/end_date itself — the
      // detector was doing exactly that, and printed "" for the very case it
      // exists to report.
      startRaw: ot.startRaw, endRaw: ot.endRaw,
      normalisedStart: s.normalised, normalisedEnd: e.normalised,
      overlapStart: null, overlapEnd: null,
      assumedStart: false, assumedEnd: false,
      overlapsPeriod: false,
      coversWholePeriod: false,
      // The one question the billing gate asks. TRUE whenever this reconciliation
      // cannot establish from the file alone that the tenant owed CAM for the
      // whole period being billed — which is not the same as "the charge is
      // wrong", and the findings must not say that it is.
      needsOccupancyConfirmation: false,
    };

    if (!p) { out.case = 'no_period'; out.label = CASES.no_period; return out; }

    if (s.status === 'unreadable' || e.status === 'unreadable') {
      out.case = 'unreadable'; out.label = CASES.unreadable;
      out.needsOccupancyConfirmation = true;      // fails closed
      return out;
    }

    var sKnown = s.status === 'ok';
    var eKnown = e.status === 'ok';

    if (!sKnown && !eKnown) {
      out.case = 'no_term'; out.label = CASES.no_term;
      // Assumed to cover the period, exactly as unknown_start and unknown_end
      // are — and the overlap bounds are filled in so a caller doing arithmetic
      // on them is not handed a null. Both bounds are marked assumed, so nothing
      // downstream can mistake this for a term that was read off a document.
      out.assumedStart = true; out.assumedEnd = true;
      out.overlapStart = p.start; out.overlapEnd = p.end;
      out.overlapsPeriod = true; out.coversWholePeriod = true;
      return out;                                  // D4 owns this; no claim made here
    }

    // AN ABSENT BOUND IS NOT AN UNKNOWABLE ONE. A missing start date says
    // nothing about an end date that plainly falls before the period, and the
    // first cut of this module let exactly that swallow a lease that ended in
    // 2003. So each endpoint is tested on its own, and an absent bound is
    // treated as extending past the period — the assumption the old predicate
    // made silently, recorded here as a flag the caller can see.
    out.assumedStart = !sKnown;
    out.assumedEnd   = !eKnown;

    if (eKnown && e.value < p.start) {
      out.case = 'ended_before'; out.label = CASES.ended_before;
      out.needsOccupancyConfirmation = true;
      return out;
    }
    if (sKnown && s.value > p.end) {
      out.case = 'begins_after'; out.label = CASES.begins_after;
      out.needsOccupancyConfirmation = true;
      return out;
    }

    // Every comparison is on ISO strings, which sort chronologically — the
    // reason readDate refuses to hand back anything else.
    var lateStart = sKnown && s.value > p.start;
    var earlyEnd  = eKnown && e.value < p.end;

    out.overlapsPeriod    = true;
    out.overlapStart      = maxDate(sKnown ? s.value : p.start, p.start);
    out.overlapEnd        = minDate(eKnown ? e.value : p.end,   p.end);
    out.coversWholePeriod = !lateStart && !earlyEnd;

    if (lateStart && earlyEnd) out.case = 'within_period';
    else if (lateStart)        out.case = 'commences_within';
    else if (earlyEnd)         out.case = 'expires_within';
    else if (out.assumedEnd)   out.case = 'unknown_end';
    else if (out.assumedStart) out.case = 'unknown_start';
    else                       out.case = 'covers_period';

    out.label = CASES[out.case];
    out.needsOccupancyConfirmation = !out.coversWholePeriod;
    return out;
  }

  // ── T2: the arithmetic, kept OUT of classify() ─────────────────────────────
  //
  // classify() answers "where does this term sit"; occupancy() answers "what
  // fraction of the period is that". They are deliberately separate functions:
  // classify() returns dates and booleans and no numbers at all, so a reader can
  // still ask the shape question without being handed a factor it did not want.
  //
  // THE RATIONAL IS THE STORED FORM. `factor` is a convenience for display;
  // 243/365 replays exactly and 0.66575342 does not. Every consumer that has to
  // reproduce a billed figure reads numerator/denominator.

  function _dayNum(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000; }
  // INCLUSIVE of both endpoints: 1 Jan – 31 Dec is 365 days, not 364. An
  // exclusive convention loses a day per tenant and the variance identity stops
  // closing. UTC throughout, so a DST boundary cannot move a day.
  function _span(a, b) { return _dayNum(b) - _dayNum(a) + 1; }
  function _monthNum(iso) { return (+iso.slice(0, 4)) * 12 + (+iso.slice(5, 7)) - 1; }
  function _monthSpan(a, b) { return _monthNum(b) - _monthNum(a) + 1; }

  /**
   * @param {object} tenant  carries start_date / cam_commencement_date / end_date
   *                         and optionally partial_period_basis
   * @param {object|string} period
   * @returns {object} the factor, the rational behind it, and where both came from
   */
  function occupancy(tenant, period) {
    var c = classify(tenant, period);
    var b = partialPeriodBasis(tenant);

    var out = {
      // The shape, carried through so no caller re-derives it.
      case: c.case, label: c.label,
      periodStart: c.periodStart, periodEnd: c.periodEnd,
      termStart: c.leaseStart, termEnd: c.leaseEnd, startSource: c.startSource,
      overlapStart: c.overlapStart, overlapEnd: c.overlapEnd,
      assumedStart: c.assumedStart, assumedEnd: c.assumedEnd,
      // The basis and — the part that matters — where the basis came from.
      basis: b.basis, basisSource: b.source, basisStated: b.stated,
      // The arithmetic.
      factor: null, numerator: null, denominator: null, unit: null,
      overlapDays: null, periodDays: null,
      // Was the factor applied to money? FALSE is not "factor 1" — it means the
      // allocation is un-apportioned and something else must decide what to do.
      applied: false,
      // Occupancy could not be established at all.
      unresolved: false,
      capProrated: false,   // T2 keeps the annual cap. Recorded so it is a
                            // stated treatment and not an unexamined default.
    };

    if (!c.periodStart || !c.periodEnd) { out.unresolved = true; return out; }
    out.periodDays = _span(c.periodStart, c.periodEnd);

    // Unreadable dates, a holdover, or a term that begins after the period: no
    // factor is computed and none is applied. A holdover must NEVER fall through
    // to factor 0 and a $0 bill — that silently writes off a real receivable.
    if (c.case === 'unreadable' || c.case === 'ended_before' || c.case === 'begins_after') {
      out.unresolved = true;
      return out;
    }

    // Belt and braces: every case that reaches here has overlap bounds, but a
    // null slipping into the day arithmetic threw inside runFullReconciliation
    // and took the whole reconciliation down with it. An unresolved occupancy is
    // a state to report, never an exception to raise.
    if (!c.overlapStart || !c.overlapEnd) { out.unresolved = true; return out; }
    out.overlapDays = _span(c.overlapStart, c.overlapEnd);

    if (b.basis === 'full_period') {
      // The lease says the full annual amount is due regardless of a partial
      // year. The overlap is still reported; it just does not reduce the bill.
      out.unit = 'period'; out.numerator = 1; out.denominator = 1; out.factor = 1;
    } else if (b.basis === 'monthly') {
      // "Prorated monthly" — calendar months of the period in which the tenant
      // occupied at least one day. Conventions vary and this is the common
      // commercial reading; the numerator and denominator are stored so the
      // convention used is inspectable rather than implied.
      out.unit = 'months';
      out.numerator   = _monthSpan(c.overlapStart, c.overlapEnd);
      out.denominator = _monthSpan(c.periodStart, c.periodEnd);
      out.factor = out.numerator / out.denominator;
    } else {
      out.unit = 'days';
      out.numerator   = out.overlapDays;
      out.denominator = out.periodDays;
      out.factor = out.numerator / out.denominator;
    }
    out.applied = true;
    return out;
  }

  function maxDate(a, b) { return a > b ? a : b; }
  function minDate(a, b) { return a < b ? a : b; }

  var api = { readDate: readDate, periodForYear: periodForYear, periodFrom: periodFrom,
              classify: classify, CASES: CASES,
              obligationTerm: obligationTerm, partialPeriodBasis: partialPeriodBasis,
              occupancy: occupancy,
              BASES: BASES, DEFAULT_BASIS: DEFAULT_BASIS };
  if (root) root.LeasePeriod = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
