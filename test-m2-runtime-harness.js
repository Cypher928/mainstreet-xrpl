'use strict';
/**
 * test-m2-runtime-harness.js — M2: does the hydrator actually RUN on a server?
 *
 *   node test-m2-runtime-harness.js
 *
 * OFFLINE. The harness spawns Node subprocesses, and inside each one `fetch`
 * throws, so no assertion here can reach a network, Pilot, or Production.
 *
 * WHAT M1b COULD NOT PROVE
 * ------------------------
 * M1b's suite ran in this repository, in this process. Two failures are
 * invisible from there, and both are the kind that only appear in production:
 *
 *   1. A dependency the deployment bundle does not contain. Vercel ships what
 *      its bundler could trace. `require(path.join(__dirname, rel))` traces to
 *      nothing — the function deploys, and dies on its first invocation. Before
 *      M2, a static trace from the hydrator reached THREE files: itself,
 *      _server-deps.js and _pilot-target.js. All ten dependency modules were
 *      invisible. Section A is the assertion that keeps it that way.
 *
 *   2. A global that happens to exist locally. A `document` left behind by an
 *      earlier suite makes a browser dependency look satisfied when it is not.
 *      Sections B and C run in a fresh process where contact THROWS, so
 *      "nothing touched it" is a measurement rather than an assumption.
 *
 * The harness therefore copies exactly the traceable file set into a temporary
 * directory and runs a probe inside it. If hydration completes there, it
 * completes on a server.
 */

const fs    = require('fs');
const path  = require('path');
const TRACE = require('./tools/static-require-trace.js');
const HARNESS = require('./tools/m2-runtime-harness.js');
const DEPS  = require('./api/_server-deps.js');

const HSRC = fs.readFileSync(require.resolve('./api/_server-deps.js'), 'utf8');
const YSRC = fs.readFileSync(require.resolve('./api/_property-record-hydrator.js'), 'utf8');
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const HCODE = strip(HSRC), YCODE = strip(YSRC);

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b)
  ? ok(m, JSON.stringify(a))
  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

/**
 * Every dependency the graph must be able to load. If a bundler cannot see one
 * of these, the deployed function is broken and nothing local will say so.
 */
const MUST_BUNDLE = [
  'api/_property-record-hydrator.js',
  'api/_server-deps.js',
  'api/_pilot-target.js',
  'property-record.js',
  'tenant-normalize.js',
  'field-provenance.js',
  'cam-pool.js',
  'property-reference.js',
  'timeline-merge.js',
  'variance-breakdown.js',
  'lease-intelligence.js',
  'tenant-space.js',
  'property-workspace.js',
  // Reached transitively, by cam-pool.js / money-cents.js / variance-breakdown.js.
  'money-cents.js',
  'source-values.js',
];

/**
 * `window.<name>` lookups the dependency graph is KNOWN to make, beyond the
 * four the shim supplies. Each is safe for one specific, verified reason —
 * asserted in section E, not taken on trust. A name that appears at runtime and
 * is not in this list is a new undeclared global dependency, and section E
 * fails loudly rather than absorbing it.
 */
const EXPECTED_UNDECLARED = {
  CamPool:      "variance-breakdown.js:223 — falls back to require('./cam-pool.js')",
  MoneyCents:   "cam-pool.js:82, variance-breakdown.js:60/187 — falls back to require('./money-cents.js')",
  SourceValues: "cam-pool.js:54, money-cents.js:83 — falls back to require('./source-values.js')",
  Selectors:    'property-workspace.js:42 — falls back to {}, and the hydrator reports the degradation',
};

const RECORD_KEYS = ['attention', 'cam', 'disputes', 'documents', 'fields',
                     'identity', 'meta', 'spaces', 'timeline'];

// One build, five subprocesses. Everything below reads from this.
const RUN = HARNESS.run();
const B   = RUN.bundle;
const R   = RUN.results;

// ── A. The deployment bundle ───────────────────────────────────────────────
sec('A. Every dependency is reachable by requires a bundler can see');
{
  is(!R.normal.crashed, 'A0 the probe ran at all',
     R.normal.crashed ? String(R.normal.stderr).split('\n')[0] : 'no crash');

  for (const f of MUST_BUNDLE) {
    is(B.files.indexOf(f) !== -1, 'A1.' + f + ' is in the traced bundle');
  }
  eq(B.computed, [], 'A2 no computed require anywhere in the graph — a bundler gives up on those');
  eq(B.unresolved, [], 'A3 every literal require resolves to a file that exists');
  eq(B.external, [], 'A4 the graph needs no npm package, so the sandbox needs no node_modules');
  eq(B.builtins, ['path'], 'A5 and only one node builtin');

  // The regression this section exists for: before M2 the trace reached three
  // files. Assert the shape of the failure, not just the fix.
  is(B.files.length >= MUST_BUNDLE.length,
     'A6 the traced set covers at least the required list', B.files.length + ' files');
  is(!/require\(\s*path\.join/.test(HCODE) && !/require\(\s*path\.join/.test(YCODE),
     'A7 neither module requires a dependency by a computed path');

  // A bundle claim made from inside a full checkout proves nothing. Show that
  // the probe really ran somewhere the untraced files do not exist.
  const sx = R.normal.sandbox;
  is(sx.cwd !== process.cwd(), 'A9 the probe ran outside this repository', sx.cwd);
  eq(sx.hasScriptJs,    false, 'A10 script.js is not there — it was never traced');
  eq(sx.hasSelectorsJs, false, 'A11 nor selectors.js, which this phase deliberately excludes');
  eq(sx.hasIndexHtml,   false, 'A12 nor index.html');
  eq(sx.hasNodeModules, false, 'A13 and there is no node_modules to fall back on');
  eq(sx.hasPropertyRecord, true, 'A14 while property-record.js IS there, because it was traced');

  // The guard that refuses a dependency with no literal require. Nothing on the
  // happy path reaches it, so it is exercised directly rather than left to be
  // discovered missing by a deployment.
  let reqThrew = false, reqMsg = '';
  try { DEPS._req('../not-declared-anywhere.js'); }
  catch (e) { reqThrew = true; reqMsg = String(e.message); }
  is(reqThrew, 'A14a a dependency with no static require entry is REFUSED, not returned as null');
  is(/bundler could not see it/.test(reqMsg),
     'A14b and the refusal says why it would fail at runtime');
  is(DEPS._req('../field-provenance.js') === require('./field-provenance.js'),
     'A14c while a declared one loads the same module a direct require gives');

  // A tracer that reports nothing would make A2 pass for the wrong reason.
  {
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm2-trace-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.js'),
        "const p=require('path');\nrequire(p.join(__dirname,'b.js'));\nrequire('./c.js');\nrequire('xrpl');\nrequire('./missing.js');\n");
      fs.writeFileSync(path.join(tmp, 'c.js'), 'module.exports = 1;\n');
      const t = TRACE.traceRelative(tmp, ['a.js']);
      eq(t.reachable, ['a.js', 'c.js'], 'A15 the tracer follows literal requires and only those');
      is(t.computed.length === 1, 'A16 and REPORTS the computed one it could not follow',
         t.computed.length + ' found');
      eq(t.external, ['xrpl'], 'A17 an npm package is reported as external');
      is(t.unresolved.length === 1, 'A18 and a literal require pointing at nothing is reported');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // The static-require table and the declared dependency maps must not drift.
  const declared = Object.values(DEPS.CLEAN).concat(Object.values(DEPS.NEEDS_WINDOW)).sort();
  const literal  = (HCODE.match(/'(\.\.\/[a-z-]+\.js)':\s*\(\)\s*=>\s*require\('\1'\)/g) || [])
                     .map(s => s.match(/'(\.\.\/[a-z-]+\.js)'/)[1]).sort();
  eq(literal, declared,
     'A8 every declared dependency has a matching string-literal require, and none is spare');
}

// ── B. A clean Node runtime ────────────────────────────────────────────────
sec('B. The probe starts in a plain Node process, not a dressed-up one');
{
  const c = R.normal.cleanRuntime;
  eq(c.document,       'undefined', 'B1 no document exists before anything loads');
  eq(c.localStorage,   'undefined', 'B2 no localStorage');
  eq(c.window,         'undefined', 'B3 no window');
  eq(c.sessionStorage, 'undefined', 'B4 no sessionStorage');
  is(R.normal.loaded, 'B5 and the module graph loads there');
}

// ── C. Browser globals throw on contact ────────────────────────────────────
sec('C. document and localStorage throw if touched, and nothing touches them');
{
  for (const k of Object.keys(R)) {
    if (k === 'trapSelfTest') continue;   // that one touches them on purpose
    eq(R[k].touched, [], 'C1.' + k + ' no browser global was touched during ' + k);
    is(!R[k].error, 'C2.' + k + ' and the scenario raised no error',
       R[k].error ? R[k].error.split('\n')[0] : 'clean');
  }

  // Without this, "touched: []" above is indistinguishable from a trap that
  // never worked. The self-test uses the probe's OWN traps, not a copy.
  const t = R.trapSelfTest;
  eq(t.trapThrew, { document: true, localStorage: true },
     'C3 the probe\'s own traps DO throw when something touches them');
  eq(t.touched, ['document', 'localStorage'],
     'C4 and record what was touched, in order — so an empty list means an empty list');
  is(t.ok, 'C5 and hydration still completes afterwards, so C1 is not passing by crashing');

  // Same argument for the global diff: an empty newGlobals list is only
  // meaningful if a planted global would have shown up in it.
  is((t.newGlobals || []).indexOf('__m2_probe_marker') !== -1,
     'C6 a deliberately planted global IS reported — so "no new globals" is a measurement',
     JSON.stringify(t.newGlobals));
}

// ── D. No leaked global ────────────────────────────────────────────────────
sec('D. Nothing survives the call');
{
  for (const k of Object.keys(R)) {
    eq(R[k].leakedWindow === undefined ? false : R[k].leakedWindow, false,
       'D1.' + k + ' no window remains after ' + k);
    if (k === 'trapSelfTest') continue;   // that one plants one on purpose
    eq(R[k].newGlobals, [], 'D2.' + k + ' and no new global appeared at all');
  }
  eq(R.normal.leakedWindowAfterLoad, false, 'D3 loading the dependencies alone leaves none either');
  eq(R.normal.shimKeysAfterLoad,
     ['LeaseIntelligence', 'PropertyReference', 'PropertyWorkspace', 'TenantSpace'],
     'D4 the shim holds exactly the four allow-listed names');
  eq(R.normal.shimKeys, R.normal.shimKeysAfterLoad,
     'D5 and a full hydration does not grow it');
  is((R.normal.blockedWrites || []).indexOf('MoneyCents') !== -1,
     'D6 a call-time attempt to attach MoneyCents was refused, not absorbed',
     JSON.stringify(R.normal.blockedWrites));

  // Pinned to a literal, not to itself. Widening the allow-list is the one edit
  // that could let browser state into a server record, and a test that reads the
  // list it is checking would wave it through.
  eq(DEPS.SHIM_KEYS.slice().sort(),
     ['LeaseIntelligence', 'PropertyReference', 'PropertyWorkspace', 'TenantSpace'],
     'D7 the declared allow-list is exactly those four names and no others');

  // resetObservations() is only worth having if it actually clears.
  DEPS.load();
  DEPS.withWindow(() => { void global.window.Selectors; });
  const before = DEPS.shimReads().length;
  DEPS.resetObservations();
  is(before > 0 && DEPS.shimReads().length === 0,
     'D8 resetObservations clears a real recording', before + ' -> ' + DEPS.shimReads().length);
}

// ── E. No UNDECLARED global dependency ─────────────────────────────────────
sec('E. Every global the graph reaches for is one we have accounted for');
{
  const seen = new Set();
  for (const k of Object.keys(R)) (R[k].undeclaredReads || []).forEach(n => seen.add(n));
  const unexpected = Array.from(seen).filter(n => !(n in EXPECTED_UNDECLARED)).sort();

  eq(unexpected, [],
     'E1 no window.<name> was reached for that this phase has not accounted for');
  eq(Array.from(seen).sort(), Object.keys(EXPECTED_UNDECLARED).sort(),
     'E2 and the measured set is exactly the accounted-for one — not a subset, not empty');

  // Each accounted-for name is safe for a stated reason. Check the reason.
  const src = {
    'cam-pool.js':           fs.readFileSync('cam-pool.js', 'utf8'),
    'variance-breakdown.js': fs.readFileSync('variance-breakdown.js', 'utf8'),
    'money-cents.js':        fs.readFileSync('money-cents.js', 'utf8'),
    'property-workspace.js': fs.readFileSync('property-workspace.js', 'utf8'),
  };
  const all = Object.values(src).join('\n');
  for (const name of ['CamPool', 'MoneyCents', 'SourceValues']) {
    const re = new RegExp('window\\.' + name + '\\)?\\s*\\n?\\s*\\|\\|[\\s\\S]{0,80}?require\\(');
    is(re.test(all), 'E3.' + name + ' every window.' + name +
       ' lookup falls back to a require, so its absence changes nothing');
  }
  is(/window\.Selectors\s*\|\|\s*\{\}/.test(src['property-workspace.js']),
     'E4.Selectors falls back to {} — a degradation, and one the hydrator reports');
  is((R.normal.degraded || []).indexOf('attention.without_selectors_readiness') !== -1,
     'E5 which is exactly what the record says happened');

  // The four the shim DOES supply must actually be asked for, or the allow-list
  // is carrying something nothing needs.
  const asked = new Set();
  for (const k of Object.keys(R)) (R[k].shimReads || []).forEach(n => asked.add(n));
  is(asked.has('PropertyReference'),
     'E6 PropertyReference is genuinely read at call time — it earns its place in the shim');
}

// ── F. Declared dependency completeness ────────────────────────────────────
sec('F. The declared dependency set is sufficient, and complete');
{
  eq(R.normal.deps.missing, [], 'F1 nothing in the declared set failed to load in the sandbox');
  eq(R.normal.deps.required.length, 8, 'F2 eight dependencies are declared');
  eq(R.normal.record.meta.unavailable, [],
     'F3 and assemble() reports no section it could not compose');
  eq(Object.keys(DEPS.CLEAN).length + Object.keys(DEPS.NEEDS_WINDOW).length, 8,
     'F4 the two maps together are that same set');
  // Sufficiency is only meaningful if a shortfall would be visible.
  const short = DEPS.missing({ FieldProvenance: {} });
  is(short.length === 7, 'F5 a shortfall IS detected — missing() is not blind', short.length + ' reported');
}

// ── G. Normal hydration ────────────────────────────────────────────────────
sec('G. A normal property hydrates completely');
{
  const n = R.normal;
  is(n.ok, 'G1 hydration succeeded in the sandbox');
  eq(n.record.spaces, 2, 'G2 both tenants became spaces');
  eq(n.record.spaceNames, ['Acme Coffee LLC', 'Northside Hardware'], 'G3 with their blob names');
  eq(n.record.fieldTenants, 2, 'G4 provenance is present for both');
  eq(n.record.identity.totalSqft, 1000, 'G5 identity carries the property total');
  eq(n.record.identity.occupancy, 80, 'G6 and the occupancy PropertyReference computed');
  eq(n.record.meta.unavailable, [], 'G7 nothing unavailable');
  eq(n.degraded, ['attention.without_selectors_readiness'],
     'G8 the only degradation is the one this phase declared');
}

// ── H. Degraded hydration ──────────────────────────────────────────────────
sec('H. A degraded property still hydrates, and says what it lost');
{
  const d = R.degraded;
  is(d.ok, 'H1 an empty blob and a failed evidence read still produce a record');
  eq(d.record.spaces, 1, 'H2 built from the tenants table instead');
  eq(d.record.spaceNames, ['Legacy Tenant'], 'H3 with the table row');
  is(d.degraded.indexOf('tenants.from_table_no_review_state') !== -1,
     'H4 and says the fallback rows carry no review state');
  is(d.degraded.indexOf('evidence.read_failed') !== -1,
     'H5 and that the evidence read failed — not silently absent');
  eq(d.record.meta.unavailable, [],
     'H6 meta.unavailable stays empty: every section WAS composed, just from less');
  eq(d.reads.length, 4, 'H7 four requests: ownership, property, tenants fallback, evidence');
  is(d.record.keys.join(',') === R.normal.record.keys.join(','),
     'H8 and the record has the same shape as the healthy one');
}

// ── I. Ownership refusal ───────────────────────────────────────────────────
sec('I. The ownership contract survives the move to a real runtime');
{
  eq(R.unauthenticated.ok, false, 'I1 no userId is refused');
  eq(R.unauthenticated.reason, 'authentication_required', 'I2 with the right reason');
  eq(R.unauthenticated.reads.length, 0, 'I3 without a single read — fail closed BEFORE transport');
  is(!R.unauthenticated.record, 'I4 and no record');

  eq(R.notOwned.ok, false, 'I5 a property the user does not own is refused');
  eq(R.notOwned.reason, 'not_authorized', 'I6 with the right reason');
  eq(R.notOwned.reads.length, 1, 'I7 after the ownership probe and nothing more');
  is(!R.notOwned.record, 'I8 and no record');
}

// ── J. Read-only transport ─────────────────────────────────────────────────
sec('J. The transport refuses writes, in the runtime as in the module');
{
  const w = R.writeAttempt.writeRefused;
  for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    is(w[m] === true, 'J1.' + m + ' a ' + m + ' is refused inside the sandbox');
  }
  is(w.post === true, 'J2 lower-case "post" is refused too');
  for (const k of Object.keys(R)) {
    const methods = R[k].methods || [];
    is(methods.every(m => m === 'GET'), 'J3.' + k + ' every request ' + k + ' made was a GET',
       methods.join(',') || 'none');
  }

  // Without an injected transport the module falls through to its own fetch.
  // That path exists and is the ONLY other way out — which is worth proving,
  // because it also shows nothing above was quietly reaching a network.
  is(R.noTransport.networkAttempted === true,
     'J4 with no transport injected the module attempts a network call, and the probe blocks it');
  is(R.noTransport.ok !== true,
     'J5 so that scenario produces no record — no silent fallback to live data');
}

// ── K. Exactly the approved reads ──────────────────────────────────────────
sec('K. The approved reads, and only those');
{
  const tables = (reads) => Array.from(new Set(reads.map(r => r.split('?')[0]))).sort();
  eq(tables(R.normal.reads), ['/properties', '/tenant_field_evidence'],
     'K1 with tenants in the blob: properties and evidence only');
  eq(tables(R.degraded.reads), ['/properties', '/tenant_field_evidence', '/tenants'],
     'K2 with an empty blob the tenants fallback joins them');

  const all = Object.values(R).flatMap(x => x.reads || []).join(' ');
  is(!/tenant_review_audit/.test(all), 'K3 tenant_review_audit is never read');
  is(!/cam_reconciliations/.test(all), 'K4 cam_reconciliations is never read');
  is(!/payments|payment_settlements|lease_documents/.test(all),
     'K5 no payment or lease-document table is touched');
  is(/user_id=eq\./.test(R.normal.reads[0]) && /user_id=eq\./.test(R.normal.reads[1]),
     'K6 both the ownership probe and the property read carry the user filter');
}

// ── L. A stable PropertyRecord shape ───────────────────────────────────────
sec('L. The record has one shape, whatever the property looks like');
{
  eq(R.normal.record.keys, RECORD_KEYS, 'L1 the healthy record has the expected sections');
  eq(R.degraded.record.keys, RECORD_KEYS, 'L2 so does the degraded one');
  eq(R.writeAttempt.record.keys, RECORD_KEYS, 'L3 and the third scenario');
  is(Array.isArray(R.normal.record.attention) || typeof R.normal.record.attention === 'number',
     'L4 attention is a list, present rather than omitted', String(R.normal.record.attention));
  is(R.degraded.record.attention !== null,
     'L5 present in the degraded record too — composed from fewer inputs, not dropped');
}

// ── M. Structured origin metadata ──────────────────────────────────────────
sec('M. origin and includesBrowserLocalState are structured facts');
{
  for (const k of ['normal', 'degraded', 'writeAttempt']) {
    eq(R[k].record.meta.origin, 'server', 'M1.' + k + ' meta.origin');
    eq(R[k].record.meta.includesBrowserLocalState, false,
       'M2.' + k + ' meta.includesBrowserLocalState');
  }
  is(typeof R.normal.record.meta.note === 'string' && R.normal.record.meta.note.length > 0,
     'M3 the note is prose, alongside the flags rather than instead of them');
  is(!/meta\.note\s*(===|==|\.includes|\.indexOf|\.match|\.startsWith)/.test(YCODE),
     'M4 and nothing branches on its text');
  is('unavailable' in R.normal.record.meta,
     'M5 meta.unavailable survives the addition — the metadata is additive');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
