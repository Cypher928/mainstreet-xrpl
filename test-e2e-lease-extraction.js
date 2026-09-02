'use strict';
/**
 * test-e2e-lease-extraction.js — a partial-period clause, document to resolver.
 *
 *   node test-e2e-lease-extraction.js
 *
 * WHAT THIS COVERS THAT A SCHEMA TEST CANNOT
 *
 * Asserting that a field name appears in a prompt string proves nothing about
 * whether the value survives to the place that needs it. The chain has five
 * links and every one of them has broken in this codebase before:
 *
 *   1. the prompt asks for the field
 *   2. the model's answer is normalised onto the tenant record
 *   3. the verbatim clause becomes a fieldEvidence snapshot
 *   4. the record survives normalizeTenant — an ALLOW-LIST that has silently
 *      dropped fields on reload before, which is worse than never saving them
 *   5. LeasePeriod.obligationTerm() resolves it into a term
 *
 * So this drives the REAL callClaudeForLease in a real browser with /api/claude
 * intercepted, and follows one clause the whole way. The interception replaces
 * the model, nothing else: the prompt, the normaliser, the quote map, the
 * allow-list and the resolver are all production code.
 *
 * IT ALSO PINS THE OTHER DIRECTION. A lease that is silent about partial
 * periods must produce source 'default' and never read as lease-confirmed, and
 * a lease with neither new field must behave exactly as it does today.
 *
 * DETERMINISM
 * Fixed timezone, fixed fixture, own port and localStorage key, no network egress.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';

let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-lease-extraction: playwright is not installed.\x1b[0m');
      console.error('This suite drives the real extraction path in a browser and cannot');
      console.error('verify anything without one. Install playwright, or set');
      console.error('SKIP_BROWSER_TESTS=1 to deliberately skip it.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-lease-extraction SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The extraction → evidence → obligation-term chain was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7971', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(36) + ':', typeof v === 'string' ? v : JSON.stringify(v));

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

const PROP_ID = 'lx-prop-000000000001';

// The clause a real lease carries, and the one the whole chain has to survive.
const LEASE_TEXT = [
  'ARTICLE 4. OPERATING EXPENSES.',
  '4.1 Tenant shall commence payment of its Proportionate Share of Operating Expenses',
  '    on the Rent Commencement Date, being April 1, 2026, notwithstanding the',
  '    Commencement Date of this Lease.',
  '4.2 If the Term commences or expires on a day other than the first or last day of',
  '    an Expense Year, Tenant\'s Proportionate Share of Operating Expenses shall be',
  '    prorated on a per diem basis, based upon the number of days of the Term',
  '    falling within such Expense Year.',
].join('\n');

// For the D-1 fixtures: a document with no dates anywhere in it, so the
// regex fallback inside the normaliser cannot quietly supply one and turn a
// deliberately absent date into a present one.
const TEXT_NO_DATES = [
  'ARTICLE 4. OPERATING EXPENSES.',
  '4.1 Tenant shall pay its Proportionate Share of Operating Expenses.',
].join('\n');

const CLAUSE_CAM   = 'Tenant shall commence payment of its Proportionate Share of Operating Expenses on the Rent Commencement Date, being April 1, 2026';
const CLAUSE_BASIS = 'shall be prorated on a per diem basis, based upon the number of days of the Term falling within such Expense Year';

const SUPABASE_MOCK = `
(function () {
  var USER_ID = 'lx-user';
  var _user = { id: USER_ID, email: 'lx@e2e-test.local' };
  var _session = null;
  var KEY = '__lx_store';
  var seed = {
    properties: [{
      id: ${JSON.stringify(PROP_ID)}, user_id: USER_ID, name: 'Larkspur Exchange', sqft: 40000,
      data: { invoices: [], disputes: [], camYear: 2026, results: null, camReconciliation: null,
              activityLog: [], timeline: [], escrowReserves: [], drawRequests: [], tenants: [] },
    }],
    tenants: [],
  };
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return JSON.parse(JSON.stringify(seed));
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(_store)); } catch (e) {} }
  var _store = load();
  function res(data) { return Promise.resolve({ data: data, error: null }); }
  var _seq = 0;
  function table(name) {
    var rows = _store[name] || (_store[name] = []);
    var last = null;
    var api = {
      select: function () { return api; }, eq: function () { return api; },
      not: function () { return api; }, is: function () { return api; },
      in: function () { return api; }, order: function () { return api; },
      limit: function () { return api; },
      maybeSingle: function () { return res(last || rows[0] || null); },
      single: function () { return res(last || rows[0] || null); },
      insert: function (v) { var a = [].concat(v).map(function (r) {
          var row = JSON.parse(JSON.stringify(r));
          if (!row.id) row.id = 'mock-' + name + '-' + (++_seq);
          rows.push(row); return row; }); last = a[0]; persist(); return api; },
      upsert: function (v) { var a = [].concat(v).map(function (r) {
          var row = JSON.parse(JSON.stringify(r));
          if (!row.id) row.id = 'mock-' + name + '-' + (++_seq);
          var i = rows.findIndex(function (x) { return x.id === row.id; });
          if (i >= 0) { rows[i] = Object.assign({}, rows[i], row); persist(); return rows[i]; }
          rows.push(row); return row; }); last = a[0]; persist(); return api; },
      update: function (v) { rows.forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(v))); });
        last = rows[0]; persist(); return api; },
      delete: function () { return api; },
      then: function (r2) { return Promise.resolve({ data: last ? [last] : rows, error: null }).then(r2); },
    };
    return api;
  }
  window.supabase = { createClient: function () { return {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: _session }, error: null }); },
      getUser:    function () { return Promise.resolve({ data: { user: _session ? _user : null }, error: null }); },
      signInWithPassword: function () { _session = { access_token: 'mock', user: _user };
        return Promise.resolve({ data: { session: _session, user: _user }, error: null }); },
      signUp:  function () { return Promise.resolve({ data: { user: _user }, error: null }); },
      signOut: function () { _session = null; return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    },
    from: table,
    storage: { from: function () { return {
      upload: function () { return res({ path: 'mock' }); },
      createSignedUrl: function () { return res({ signedUrl: 'https://mock.local/x' }); } }; } },
  }; } };
})();
`;

// ── The model's answers. Only the model is replaced; everything downstream is
//    production code. ──────────────────────────────────────────────────────────
const REPLY = {
  // A lease that says both things, with the clauses it said them in.
  stated: {
    tenant_name: 'Larkspur Books', lease_start_date: '2026-01-01', lease_end_date: '2031-03-31',
    cam_commencement_date: '2026-04-01', partial_period_basis: 'per_diem',
    lease_type: 'NNN', sqft: 8000, cam_cap: 5, property_name: 'Larkspur Exchange',
    quotes: { cam_commencement_date: CLAUSE_CAM, partial_period_basis: CLAUSE_BASIS, cam_cap: 'capped at five percent (5%)' },
  },
  // A lease that says neither. Null is a real answer.
  silent: {
    tenant_name: 'Quiet Corner Cafe', lease_start_date: '2026-01-01', lease_end_date: '2030-12-31',
    cam_commencement_date: null, partial_period_basis: null,
    lease_type: 'NNN', sqft: 3000, cam_cap: null, property_name: 'Larkspur Exchange',
    quotes: {},
  },
  // The model answered with something outside the vocabulary.
  odd: {
    tenant_name: 'Odd Basis Ltd', lease_start_date: '2026-01-01', lease_end_date: '2030-12-31',
    cam_commencement_date: null, partial_period_basis: 'weekly',
    lease_type: 'NNN', sqft: 2000, property_name: 'Larkspur Exchange', quotes: {},
  },
  // A CAM commencement date that is not a date.
  malformed: {
    tenant_name: 'Malformed Date Co', lease_start_date: '2026-01-01', lease_end_date: '2030-12-31',
    cam_commencement_date: 'upon opening', partial_period_basis: 'per_diem',
    lease_type: 'NNN', sqft: 2500, property_name: 'Larkspur Exchange', quotes: {},
  },
  // A US-format date the normaliser has to repair.
  usFormat: {
    tenant_name: 'Repairable Date Inc', lease_start_date: '2026-01-01', lease_end_date: '2030-12-31',
    cam_commencement_date: '4/1/2026', partial_period_basis: 'per_diem',
    lease_type: 'NNN', sqft: 2500, property_name: 'Larkspur Exchange', quotes: {},
  },
  // D-1. A lease whose term ends on an EVENT, which is how a great many real
  // leases are written before the certificate of occupancy is issued.
  unreadableEnd: {
    tenant_name: 'Fenwick Interiors', lease_start_date: '2026-01-01',
    lease_end_date: 'upon substantial completion of the Landlord Work',
    cam_commencement_date: null, partial_period_basis: 'per_diem',
    lease_type: 'NNN', sqft: 4000, property_name: 'Larkspur Exchange', quotes: {},
  },
  // The control: a lease with genuinely no end date on file. Same empty field,
  // different problem, and the two must not read alike.
  absentEnd: {
    tenant_name: 'Marrow & Co', lease_start_date: '2026-01-01', lease_end_date: null,
    cam_commencement_date: null, partial_period_basis: 'per_diem',
    lease_type: 'NNN', sqft: 4000, property_name: 'Larkspur Exchange', quotes: {},
  },
  // An older extraction that never heard of either field.
  legacy: {
    tenant_name: 'Legacy Lease Co', lease_start_date: '2026-01-01', lease_end_date: '2030-12-31',
    lease_type: 'NNN', sqft: 5000, cam_cap: null, property_name: 'Larkspur Exchange', quotes: {},
  },
};

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({
    headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);

  let currentReply = REPLY.stated;
  let lastPrompt   = '';

  await page.route('**', route => {
    const u = route.request().url();
    if (/\/api\/claude/.test(u)) {
      // Capture the REAL prompt the app built, then answer as the model would.
      try {
        const body = JSON.parse(route.request().postData() || '{}');
        lastPrompt = (body.messages || []).map(m => m.content).join('\n');
      } catch (_) { lastPrompt = ''; }
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify(currentReply) });
    }
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    }
    return route.abort();
  });
  await page.addInitScript(SUPABASE_MOCK);

  console.log('\n══ Lease clause → extracted field → evidence → obligation term ══');

  // Factored out because D-1 needs to come back through it a second time: an
  // allow-list drop is invisible until the page is loaded again from storage.
  const signIn = async () => {
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await _e2eSignIn(page, { email: "lx@e2e-test.local", errors: errors });
    await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
    await page.evaluate((id) => selectProperty(id), PROP_ID);
  };
  await signIn();

  yes('the resolver module is loaded',
      await page.evaluate(() => !!(window.LeasePeriod && window.LeasePeriod.obligationTerm)),
      'lease-period.js is not on the page — every assertion below would be vacuous');

  // Runs the REAL callClaudeForLease, then follows the record all the way through.
  const extract = async (text) => page.evaluate(async (t) => {
    const rec = await callClaudeForLease(t, 'lease.pdf');
    if (!rec) return { failed: true };
    const LP = window.LeasePeriod;
    // The storage round trip: normalizeTenant is an ALLOW-LIST, and a field it
    // does not name is written to storage and dropped on the way back in.
    const roundTripped = normalizeTenant(JSON.parse(JSON.stringify(rec)));
    const quoteOf = (r, k) => ((r.fieldEvidence || {})[k]?.snapshots || [])
      .map(s => s && s.quote).filter(Boolean).pop() || null;
    return {
      cam_commencement_date: rec.cam_commencement_date,
      partial_period_basis:  rec.partial_period_basis,
      start_date:            rec.start_date,
      end_date:              rec.end_date,
      quoteCam:   quoteOf(rec, 'cam_commencement_date'),
      quoteBasis: quoteOf(rec, 'partial_period_basis'),
      confCam:    getFieldConfidence('cam_commencement_date', rec),
      confBasis:  getFieldConfidence('partial_period_basis', rec),
      confEnd:    getFieldConfidence('end_date', rec),
      unreadableDates: rec.unreadableDates ?? null,
      term:       LP.obligationTerm(rec),
      basis:      LP.partialPeriodBasis(rec),
      classify:   LP.classify(rec, LP.periodFrom('2026-12-31')),
      rt: {
        cam_commencement_date: roundTripped.cam_commencement_date,
        partial_period_basis:  roundTripped.partial_period_basis,
        quoteBasis:            quoteOf(roundTripped, 'partial_period_basis'),
        end_date:              roundTripped.end_date,
        unreadableDates:       roundTripped.unreadableDates ?? null,
        endStatus:             LP.obligationTerm(roundTripped).endStatus,
      },
    };
  }, text);

  // ── 1. The prompt actually asks ────────────────────────────────────────────
  console.log('\n── 1. The prompt asks the document for both facts ──');
  currentReply = REPLY.stated;
  const stated = await extract(LEASE_TEXT);
  yes('the app asked for cam_commencement_date',
      /"cam_commencement_date"/.test(lastPrompt), lastPrompt.slice(0, 120));
  yes('and for partial_period_basis, with the vocabulary spelled out',
      /"partial_period_basis": "per_diem" \| "monthly" \| "full_period"/.test(lastPrompt), '');
  yes('and asked for a verbatim clause for each',
      /"quotes":[\s\S]{0,400}"cam_commencement_date"/.test(lastPrompt)
        && /"quotes":[\s\S]{0,400}"partial_period_basis"/.test(lastPrompt), '');
  yes('and told the model that silence is a real answer, not a guess',
      /null is a real answer, do NOT guess/i.test(lastPrompt), '');
  yes('and told it NOT to copy the lease start date into the CAM field',
      /Do NOT copy the lease start date/i.test(lastPrompt), '');

  // ── 2. The stated lease, end to end ────────────────────────────────────────
  console.log('\n── 2. A lease that states both, followed the whole way ──');
  R('cam_commencement_date', stated.cam_commencement_date);
  R('partial_period_basis',  stated.partial_period_basis);
  R('obligation term',       { start: stated.term.start, source: stated.term.startSource });
  R('basis',                 stated.basis);
  R('classification',        stated.classify.case);

  yes('the extracted value reached the tenant record',
      stated.cam_commencement_date === '2026-04-01' && stated.partial_period_basis === 'per_diem',
      JSON.stringify(stated));
  yes('the verbatim clause became evidence — CAM commencement',
      typeof stated.quoteCam === 'string' && /Rent Commencement Date/.test(stated.quoteCam),
      String(stated.quoteCam));
  yes('the verbatim clause became evidence — partial-period basis',
      typeof stated.quoteBasis === 'string' && /per diem basis/.test(stated.quoteBasis),
      String(stated.quoteBasis));
  yes('with a clause behind it, the field reads VERIFIED from the document',
      stated.confBasis.status === 'verified' && stated.confBasis.source === 'structured',
      JSON.stringify(stated.confBasis));
  yes('THE RESOLVER USES IT: the term starts 2026-04-01, not the lease start',
      stated.term.start === '2026-04-01' && stated.term.startSource === 'cam_commencement_date',
      JSON.stringify(stated.term));
  yes('    and the lease start is still recorded, not overwritten',
      stated.term.leaseStart === '2026-01-01' && stated.start_date === '2026-01-01',
      JSON.stringify(stated.term));
  yes('    so the classification follows the OBLIGATION, not the term',
      stated.classify.case === 'commences_within' && stated.classify.overlapStart === '2026-04-01',
      JSON.stringify({ case: stated.classify.case, from: stated.classify.overlapStart }));
  yes('the basis is reported as coming from the lease',
      stated.basis.basis === 'per_diem' && stated.basis.source === 'lease' && stated.basis.stated === true,
      JSON.stringify(stated.basis));
  yes('and the record survives the storage allow-list',
      stated.rt.cam_commencement_date === '2026-04-01'
        && stated.rt.partial_period_basis === 'per_diem'
        && /per diem basis/.test(String(stated.rt.quoteBasis)),
      JSON.stringify(stated.rt));

  // ── 3. The silent lease ────────────────────────────────────────────────────
  console.log('\n── 3. A silent lease defaults, and says that it defaulted ──');
  currentReply = REPLY.silent;
  const silent = await extract(LEASE_TEXT);
  R('partial_period_basis', silent.partial_period_basis);
  R('basis', silent.basis);
  R('confidence', silent.confBasis);
  yes('the field is null — silence is recorded as silence',
      silent.partial_period_basis === null, JSON.stringify(silent.partial_period_basis));
  yes('a basis is still available to compute with',
      silent.basis.basis === 'per_diem', JSON.stringify(silent.basis));
  yes('THE CLAIM IS NOT MADE: source is default, and stated is false',
      silent.basis.source === 'default' && silent.basis.stated === false,
      JSON.stringify(silent.basis));
  yes('and the confidence surface says so in the same words',
      silent.confBasis.source === 'default' && silent.confBasis.status === 'missing'
        && /default/i.test(silent.confBasis.note),
      JSON.stringify(silent.confBasis));
  yes('no clause is invented to support it',
      silent.quoteBasis === null, String(silent.quoteBasis));
  yes('an absent CAM commencement is normal, not a gap to chase',
      silent.confCam.status === 'verified' && /begins with the lease term/i.test(silent.confCam.note),
      JSON.stringify(silent.confCam));
  yes('and the term falls back to the lease start',
      silent.term.start === '2026-01-01' && silent.term.startSource === 'start_date',
      JSON.stringify(silent.term));

  // ── 4. Values the vocabulary does not contain ──────────────────────────────
  console.log('\n── 4. An unrecognised basis is a data problem, not a default ──');
  currentReply = REPLY.odd;
  const odd = await extract(LEASE_TEXT);
  R('stored', odd.partial_period_basis);
  R('basis', odd.basis);
  yes('the raw value is kept, not silently discarded',
      odd.partial_period_basis === 'weekly', JSON.stringify(odd.partial_period_basis));
  yes('it does NOT read as a default — the two are different problems',
      odd.basis.source === 'unrecognised' && odd.basis.stated === false, JSON.stringify(odd.basis));
  yes('and the confidence surface asks for confirmation',
      odd.confBasis.status === 'estimated' && /not recognised/i.test(odd.confBasis.note),
      JSON.stringify(odd.confBasis));

  // ── 5. Dates that cannot be read ───────────────────────────────────────────
  console.log('\n── 5. Malformed and repairable CAM commencement dates ──');
  currentReply = REPLY.malformed;
  const malformed = await extract(LEASE_TEXT);
  R('stored', malformed.cam_commencement_date);
  R('term', { start: malformed.term.start, status: malformed.term.startStatus, source: malformed.term.startSource });
  R('classification', malformed.classify.case);
  yes('"upon opening" is not stored as a date',
      malformed.cam_commencement_date === null, JSON.stringify(malformed.cam_commencement_date));
  yes('    so the term falls back to the lease start rather than failing',
      malformed.term.start === '2026-01-01' && malformed.term.startSource === 'start_date',
      JSON.stringify(malformed.term));

  currentReply = REPLY.usFormat;
  const us = await extract(LEASE_TEXT);
  R('stored', us.cam_commencement_date);
  yes('a US-format date is repaired to ISO on the way in',
      us.cam_commencement_date === '2026-04-01', JSON.stringify(us.cam_commencement_date));
  yes('    and resolves to the same term as the ISO form',
      us.term.start === '2026-04-01' && us.term.startSource === 'cam_commencement_date',
      JSON.stringify(us.term));

  // ── 5b. D-1: a date the lease HAS and we cannot read ───────────────────────
  //
  // toISODate answers '' for a date it cannot parse and '' for no date at all,
  // and normalizeTenant stored that ''. So a term ending "upon substantial
  // completion of the Landlord Work" — how a great many leases are written
  // before the certificate of occupancy — arrived at the reconciliation
  // indistinguishable from a lease with no end date. lease-period.js had an
  // `unreadable` status the whole time that nothing in storage could produce,
  // and the finding that quotes the offending text printed "".
  //
  // Two different conversations: "send us your dates" versus "your lease dates
  // its term from an event that has to be fixed before we can bill it".
  console.log('\n── 5b. An unreadable date is not an absent date ──');
  currentReply = REPLY.unreadableEnd;
  const unread = await extract(LEASE_TEXT);
  R('stored end_date',   unread.end_date);
  R('unreadableDates',   unread.unreadableDates);
  R('term end',          { status: unread.term.endStatus, raw: unread.term.endRaw });
  R('classification',    unread.classify.case);
  R('confidence',        unread.confEnd);
  yes('the ISO field keeps its contract — empty, never half a date',
      unread.end_date === '', JSON.stringify(unread.end_date));
  yes('THE TEXT IS KEPT: what the lease actually says is recorded beside it',
      /upon substantial completion/i.test(String((unread.unreadableDates || {}).end_date)),
      JSON.stringify(unread.unreadableDates));
  yes('    so the resolver reports UNREADABLE, not absent',
      unread.term.endStatus === 'unreadable', JSON.stringify(unread.term));
  yes('    and carries the raw text, so a finding can quote it',
      /upon substantial completion/i.test(String(unread.term.endRaw)), String(unread.term.endRaw));
  yes('    and the classification is the unreadable case, not unknown_end',
      unread.classify.case === 'unreadable', unread.classify.case);
  yes('    with the confidence note quoting it rather than saying "not found"',
      unread.confEnd.source === 'unreadable'
        && /upon substantial completion/i.test(unread.confEnd.note),
      JSON.stringify(unread.confEnd));
  yes('    and it survives the storage allow-list — value AND distinction',
      unread.rt.end_date === ''
        && /upon substantial completion/i.test(String((unread.rt.unreadableDates || {}).end_date))
        && unread.rt.endStatus === 'unreadable',
      JSON.stringify(unread.rt));

  console.log('\n── 5c. The control: a lease with genuinely no end date ──');
  currentReply = REPLY.absentEnd;
  const absent = await extract(TEXT_NO_DATES);
  R('stored end_date', absent.end_date);
  R('unreadableDates', absent.unreadableDates);
  R('term end',        { status: absent.term.endStatus, raw: absent.term.endRaw });
  R('classification',  absent.classify.case);
  yes('nothing is invented to fill the gap',
      absent.end_date === '' && absent.unreadableDates === null,
      JSON.stringify({ e: absent.end_date, u: absent.unreadableDates }));
  yes('    the resolver reports ABSENT — the other problem entirely',
      absent.term.endStatus === 'absent' && absent.term.endRaw === null,
      JSON.stringify(absent.term));
  yes('    and the classification says no end date is on file',
      absent.classify.case === 'unknown_end', absent.classify.case);
  yes('    with the confidence note that belongs to a missing field',
      absent.confEnd.source === 'missing' && /not found/i.test(absent.confEnd.note),
      JSON.stringify(absent.confEnd));

  // A REAL RELOAD. normalizeTenant runs over every stored tenant on load, so the
  // second pass sees an empty ISO field and no raw input to re-derive from — and
  // would erase the distinction it had just preserved. Only a load shows that.
  console.log('\n── 5d. …and both survive a real page load ──');
  currentReply = REPLY.unreadableEnd;
  await page.evaluate(async (t) => {
    const rec = await callClaudeForLease(t, 'lease.pdf');
    tenantData.length = 0;
    tenantData.push(rec);
    await savePropertyData();
    await savePropertyNow();
  }, LEASE_TEXT);
  await signIn();
  // selectProperty kicks off the load; the tenants arrive a tick later.
  await page.waitForFunction(
    () => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length > 0, null,
    { timeout: 45000 });
  const reloaded = await page.evaluate(() => {
    const t = tenantData.find(Boolean) || {};
    const LP = window.LeasePeriod;
    const term = LP.obligationTerm(t);
    return { name: t.tenant_name, end_date: t.end_date, unreadableDates: t.unreadableDates ?? null,
             endStatus: term.endStatus, endRaw: term.endRaw,
             case: LP.classify(t, LP.periodFrom('2026-12-31')).case,
             conf: getFieldConfidence('end_date', t) };
  });
  R('after reload', reloaded);
  yes('the record came back',
      reloaded.name === 'Fenwick Interiors', JSON.stringify(reloaded.name));
  yes('THE DISTINCTION SURVIVED THE ALLOW-LIST AND THE ROUND TRIP',
      /upon substantial completion/i.test(String((reloaded.unreadableDates || {}).end_date))
        && reloaded.endStatus === 'unreadable' && reloaded.case === 'unreadable',
      JSON.stringify(reloaded));
  yes('    and still reads as unreadable on the confidence surface',
      reloaded.conf.source === 'unreadable', JSON.stringify(reloaded.conf));

  // And it has to STOP being unreadable when someone fixes it. Left behind, the
  // text would sit under a field that now holds a perfectly good date — inert
  // today because the resolver only consults it when the field is empty, and a
  // trap for the next reader who does not know that.
  const corrected = await page.evaluate(() => {
    const t = tenantData.find(Boolean);
    const fixed = normalizeTenant(Object.assign({}, t, { end_date: '2031-03-31' }));
    return { end_date: fixed.end_date, unreadableDates: fixed.unreadableDates ?? null,
             endStatus: window.LeasePeriod.obligationTerm(fixed).endStatus,
             conf: getFieldConfidence('end_date', fixed) };
  });
  R('after the manager corrects it', corrected);
  yes('correcting the date clears the record of the unreadable one',
      corrected.end_date === '2031-03-31' && corrected.unreadableDates === null,
      JSON.stringify(corrected));
  yes('    and nothing is left claiming the date cannot be read',
      corrected.endStatus === 'ok' && corrected.conf.source !== 'unreadable',
      JSON.stringify(corrected));

  // ── 6. Leases that predate the fields ──────────────────────────────────────
  console.log('\n── 6. An extraction that never heard of either field ──');
  currentReply = REPLY.legacy;
  const legacy = await extract(LEASE_TEXT);
  R('cam_commencement_date', legacy.cam_commencement_date);
  R('partial_period_basis',  legacy.partial_period_basis);
  R('term', { start: legacy.term.start, source: legacy.term.startSource });
  yes('both fields are null, not undefined and not empty strings',
      legacy.cam_commencement_date === null && legacy.partial_period_basis === null,
      JSON.stringify({ c: legacy.cam_commencement_date, b: legacy.partial_period_basis }));
  yes('the obligation term is exactly the lease term, as it is today',
      legacy.term.start === '2026-01-01' && legacy.term.end === '2030-12-31'
        && legacy.term.startSource === 'start_date',
      JSON.stringify(legacy.term));
  yes('the classification is unchanged — a full-period lease raises nothing',
      legacy.classify.case === 'covers_period'
        && legacy.classify.needsOccupancyConfirmation === false,
      JSON.stringify(legacy.classify));
  yes('and it survives the allow-list as null, not as a dropped key',
      legacy.rt.cam_commencement_date === null && legacy.rt.partial_period_basis === null,
      JSON.stringify(legacy.rt));

  // ── 7. One owner ───────────────────────────────────────────────────────────
  console.log('\n── 7. One owner of the question ──');
  const src = await page.evaluate(async () => {
    const files = ['script.js', 'lease-period.js', 'reconciliation-engine.js', 'review-engine.js',
                   'audit-exposure.js', 'property-os.js', 'lease-intelligence.js', 'selectors.js'];
    const out = {};
    for (const f of files) {
      const txt = await (await fetch('/' + f)).text();
      out[f] = txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    }
    return out;
  });
  const readers = Object.entries(src)
    .map(([f, code]) => [f, (code.match(/cam_commencement_date/g) || []).length])
    .filter(([, n]) => n > 0);
  R('files mentioning the field', readers);
  yes('only lease-period.js and the extraction/persistence path name it',
      readers.every(([f]) => f === 'script.js' || f === 'lease-period.js'),
      JSON.stringify(readers));
  // ONE READER, WHATEVER THE MECHANISM. The three date fields are no longer
  // read as `t.<field>` at all — D-1 pairs each one with what could not be read
  // (`unreadableDates`), and _readField does that pairing. So the property to
  // assert is not the old spelling: it is that nothing reads the fields
  // directly, that the pairing helper is the single door, and that every call to
  // it is inside the resolver. Retargeted rather than relaxed — a second reader
  // still fails this, by either route.
  const _lp        = src['lease-period.js'];
  const _obligIdx  = _lp.indexOf('function obligationTerm');
  const _classIdx  = _lp.indexOf('function classify');
  const _helperIdx = _lp.indexOf('function _readField');
  const _bareReads = (_lp.match(/t\.(?:start_date|end_date|cam_commencement_date)\b/g) || []);
  const _calls     = [..._lp.matchAll(/_readField\(/g)].map(m => m.index)
                       .filter(i => i !== _helperIdx + 'function '.length);
  R('bare field reads in the resolver module', _bareReads);
  R('_readField call sites inside obligationTerm',
    _calls.filter(i => i > _obligIdx && i < _classIdx).length + ' of ' + _calls.length);
  yes('and lease-period.js reads it in exactly ONE function',
      _bareReads.length === 0 && _calls.length === 3
        && _calls.every(i => i > _obligIdx && i < _classIdx),
      JSON.stringify({ bare: _bareReads, calls: _calls.length }));
  yes('classify() goes THROUGH the resolver, not around it',
      /var ot = obligationTerm\(t\);/.test(_lp), 'classify does not call obligationTerm');
  yes('    and start_date is read in exactly one place — the resolver',
      (_lp.match(/_readField\(t, 'start_date'/g) || []).length === 1
        && (_lp.match(/_readField\(t, 'cam_commencement_date'/g) || []).length === 1
        && _lp.indexOf("_readField(t, 'start_date'") > _obligIdx
        && _lp.indexOf("_readField(t, 'start_date'") < _classIdx,
      'start_date is resolved somewhere other than obligationTerm');
  // And the record of what could not be read is reachable ONLY through the same
  // door. A surface that reads unreadableDates itself is a second reader of the
  // date fields wearing a different hat.
  const _rawReaders = Object.entries(src)
    .map(([f, code]) => [f, (code.match(/unreadableDates/g) || []).length])
    .filter(([, n]) => n > 0);
  R('files naming unreadableDates', _rawReaders);
  yes('    and only the normaliser and the resolver name unreadableDates',
      _rawReaders.every(([f]) => f === 'script.js' || f === 'lease-period.js')
        && (_lp.match(/unreadableDates/g) || []).length === 1,
      JSON.stringify(_rawReaders));
  yes('no consumer outside the resolver derives a term itself',
      !/cam_commencement_date\s*\|\|\s*/.test(src['script.js'])
        && !/cam_commencement_date\s*\?\?\s*[a-z]*\.?start_date/i.test(src['script.js']),
      'a second resolver appeared in script.js');

  console.log('\n── Console ──');
  yes('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + '─'.repeat(58));
  if (fail) console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  else      console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);

  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n\x1b[31mtest-e2e-lease-extraction crashed:\x1b[0m', e && e.stack || e);
  process.exit(1);
});
