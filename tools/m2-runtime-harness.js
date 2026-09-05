'use strict';
/**
 * tools/m2-runtime-harness.js — run the hydrator the way a server would.
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * M1b proved the hydrator behaves correctly. It could not prove the hydrator
 * RUNS, because every M1b test executed inside a full repository checkout with
 * this process's globals already whatever they were. Two whole classes of
 * failure are invisible from there:
 *
 *   1. Files that are not in the deployed bundle. A serverless function ships
 *      only what its bundler could trace. Requiring a dependency by a computed
 *      path deploys fine and dies on the first invocation.
 *   2. Globals that happen to exist locally. A test process that has already
 *      loaded something, or a `document` left behind by an earlier suite, can
 *      make a browser dependency look satisfied when it is not.
 *
 * So this harness does not test in place. It builds a directory containing ONLY
 * the files a bundler could see, and runs a probe inside it in a FRESH Node
 * process with browser globals booby-trapped to throw on contact. If hydration
 * completes there, it completes on a server.
 *
 * WHAT IT IS NOT
 * --------------
 * Not an HTTP route, not an MCP tool, not an authentication layer. It calls
 * hydrate() as a module, with a transport it defines itself, and it never
 * reaches a network: `fetch` inside the probe throws.
 *
 * READ-ONLY with respect to the product. It writes only into a temp directory
 * it creates, and removes it afterwards.
 */

const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const { execFileSync } = require('child_process');
const TRACE = require('./static-require-trace.js');

const ROOT  = path.join(__dirname, '..');
const ENTRY = 'api/_property-record-hydrator.js';

/** The probe: everything below runs in a fresh process, inside the sandbox. */
const PROBE = String.raw`
'use strict';
// ── 1. What this runtime looks like BEFORE anything is loaded ──────────────
const out = { scenario: process.argv[2] };
out.cleanRuntime = {
  document:       typeof document,
  localStorage:   typeof localStorage,
  window:         typeof window,
  sessionStorage: typeof sessionStorage,
};
out.globalsBefore = Object.getOwnPropertyNames(global).sort();

// Is this actually a sandbox, or did the harness quietly run in the repository?
// A bundle assertion made from inside a full checkout proves nothing at all.
{
  const _fs = require('fs');
  const has = (f) => { try { _fs.statSync(f); return true; } catch (_e) { return false; } };
  out.sandbox = {
    cwd:              process.cwd(),
    hasScriptJs:      has('script.js'),        // repo-only, never traced
    hasSelectorsJs:   has('selectors.js'),     // repo-only, deliberately excluded
    hasIndexHtml:     has('index.html'),       // repo-only
    hasNodeModules:   has('node_modules'),     // the graph needs none
    hasPropertyRecord:has('property-record.js'),
  };
}

// ── 2. Booby-trap every browser global. Contact throws; it does not return
//       undefined, because "undefined" is indistinguishable from "not asked". ─
out.touched = [];
for (const name of ['document','localStorage','sessionStorage','navigator','location',
                    'history','alert','XMLHttpRequest']) {
  Object.defineProperty(global, name, {
    configurable: true,
    get() { out.touched.push(name); throw new Error('[probe] ' + name + ' was touched'); },
  });
}
// A server-side record must come from the injected transport, never a socket.
global.fetch = function () { throw new Error('[probe] fetch was called — no network here'); };

// ── 3. Fixtures. Plain data: nothing crosses the process boundary. ─────────
const PROP  = '11111111-1111-4111-8111-111111111111';
const USER  = '22222222-2222-4222-8222-222222222222';
const OTHER = '99999999-9999-4999-8999-999999999999';
const T1    = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2    = 'aaaaaaaa-0000-4000-8000-000000000002';

const EVIDENCE = [{
  tenant_id: T1, field_key: 'cap', value: '0.05',
  confidence_status: 'high', confidence_note: null,
  source_file: 'lease.pdf', source_page: 3, quote: 'Section 4.2 caps CAM at 5%.',
  extraction_id: 'e1', extraction_version: 1,
  reviewer_uid: null, reviewer_email: null, reviewed_at: null,
  approved: null, manually_edited: false, original_extracted_value: null,
  created_at: '2025-01-01T00:00:00Z',
}];

const BLOB_TENANTS = [
  { id: T1, tenant_name: 'Acme Coffee LLC', leased_sqft: 500, cap: 0.05,
    start_date: '2020-01-01', end_date: '2030-01-01', lease_type: 'NNN' },
  { id: T2, tenant_name: 'Northside Hardware', leased_sqft: 300, cap: null,
    start_date: '2021-06-01', end_date: '2026-06-01', lease_type: 'NNN' },
];

const TABLE_TENANTS = [
  { id: T1, property_id: PROP, name: 'Legacy Tenant', sqft: 400, cap: null,
    start_date: null, end_date: null, lease_url: null, lease_type: 'NNN' },
];

// Scenario -> back end shape. Each is a pure description; the transport below
// turns it into responses and records every request it was asked for.
const SCENARIOS = {
  // A property with everything: tenants in the blob, evidence, invoices, a
  // reconciliation snapshot. The record should compose completely.
  normal: {
    owns: true, blobTenants: BLOB_TENANTS, evidence: EVIDENCE,
    invoices: [{ id: 'i1', amount: 12000, category: 'Landscaping', camEligible: true },
               { id: 'i2', amount:  8000, category: 'Roof',        camEligible: false }],
  },
  // A property that can only be partly answered: nothing in the blob, so the
  // tenants table is the fallback (no review state), and the evidence read
  // fails outright. The record must still compose, and must SAY what it lost.
  degraded: {
    owns: true, blobTenants: [], tableTenants: TABLE_TENANTS, evStatus: 503,
    invoices: [],
  },
  // No authenticated user at all.
  unauthenticated: { owns: true, noUser: true },
  // Authenticated, but not this user's property.
  notOwned:        { owns: false, propertyId: OTHER },
  // The read-only guard, exercised through the real transport wrapper.
  writeAttempt:    { owns: true, blobTenants: BLOB_TENANTS, tryWrite: true },
  // Proves the booby-traps in step 2 actually fire. Without this, "touched: []"
  // in every other scenario is indistinguishable from a trap that never worked.
  trapSelfTest:    { owns: true, blobTenants: BLOB_TENANTS, touchFirst: true },
  // No injected transport, so the module falls through to its own _defaultFetch.
  // The global fetch throws in here, which proves the only other path out of
  // this module is a network call, and that nothing else was quietly making one.
  noTransport:     { owns: true, blobTenants: BLOB_TENANTS, omitTransport: true },
};

function transport(s) {
  const calls = [];
  const fn = async (p, options) => {
    calls.push({ path: p, method: (options && options.method) || 'GET' });
    if (/^\/properties\?.*select=id$/.test(p)) {
      return { status: 200, json: s.owns ? [{ id: PROP }] : [] };
    }
    if (/^\/properties\?/.test(p)) {
      return { status: 200, json: [{
        id: PROP, name: 'Main Street Plaza', sqft: 1000,
        data: {
          tenants:  s.blobTenants || [],
          invoices: s.invoices    || [],
          disputes: [],
          timeline: [],
          camReconciliation: s.recon || null,
        },
      }] };
    }
    if (/^\/tenants\?/.test(p)) {
      if (s.tenantStatus >= 300) return { status: s.tenantStatus, json: { message: 'x' } };
      return { status: 200, json: s.tableTenants || [] };
    }
    if (/^\/tenant_field_evidence\?/.test(p)) {
      if (s.evStatus >= 300) return { status: s.evStatus, json: { message: 'x' } };
      return { status: 200, json: s.evidence || [] };
    }
    return { status: 404, json: [] };
  };
  fn.calls = calls;
  return fn;
}

(async function () {
  try {
    // ── 4. Load the module graph, inside the sandbox, from the bundle ───────
    const H    = require('./api/_property-record-hydrator.js');
    const DEPS = require('./api/_server-deps.js');
    out.loaded = true;

    DEPS.load();
    out.deps = { required: DEPS.REQUIRED.slice().sort(), missing: DEPS.missing().slice().sort() };
    out.shimKeysAfterLoad = DEPS.shimKeys();
    out.leakedWindowAfterLoad = DEPS.leakedWindow();
    DEPS.resetObservations();

    const s  = SCENARIOS[out.scenario];
    if (!s) throw new Error('unknown scenario ' + out.scenario);

    if (s.touchFirst) {
      // Plant a global. If newGlobals cannot see this one, it cannot see any.
      global.__m2_probe_marker = 1;
      out.trapThrew = {};
      for (const name of ['document', 'localStorage']) {
        try { void global[name]; out.trapThrew[name] = false; }
        catch (_e) { out.trapThrew[name] = true; }
      }
    }

    const sb = transport(s);

    if (s.tryWrite) {
      // Go through the module's own guard, not a copy of it.
      const guarded = H._readOnly(sb);
      out.writeRefused = {};
      for (const m of ['POST', 'PATCH', 'PUT', 'DELETE', 'post']) {
        try { await guarded('/properties', { method: m }); out.writeRefused[m] = false; }
        catch (_e) { out.writeRefused[m] = true; }
      }
    }

    const args = { propertyId: s.propertyId || PROP, userId: s.noUser ? undefined : USER };
    if (!s.omitTransport) args.sbFetch = sb;

    let r;
    if (s.omitTransport) {
      try { r = await H.hydrate(args); out.networkAttempted = false; }
      catch (e) { out.networkAttempted = /no network here/.test(String(e && e.message)); r = { ok: false }; }
    } else {
      r = await H.hydrate(args);
    }

    out.ok       = r.ok;
    out.reason   = r.reason || null;
    out.reads    = r.reads;
    out.degraded = r.degraded;
    out.methods  = Array.from(new Set(sb.calls.map(c => c.method)));
    if (r.record) {
      out.record = {
        keys:        Object.keys(r.record).sort(),
        meta:        r.record.meta,
        spaces:      r.record.spaces.length,
        spaceNames:  r.record.spaces.map(x => x.tenantName),
        fieldTenants: Object.keys(r.record.fields || {}).length,
        attention:   Array.isArray(r.record.attention) ? r.record.attention.length : null,
        identity:    r.record.identity || null,
      };
    }

    // ── 5. What the dependency graph asked the runtime for ─────────────────
    out.shimReads       = DEPS.shimReads();
    out.undeclaredReads = DEPS.undeclaredReads();
    out.blockedWrites   = DEPS.blockedWrites();
    out.leakedWindow    = DEPS.leakedWindow();
    out.shimKeys        = DEPS.shimKeys();
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  }

  // ── 6. Did running any of this add a global? ──────────────────────────────
  const after = Object.getOwnPropertyNames(global).sort();
  const traps = ['document','localStorage','sessionStorage','navigator','location',
                 'history','alert','XMLHttpRequest','fetch'];
  out.newGlobals = after.filter(k => out.globalsBefore.indexOf(k) === -1 &&
                                     traps.indexOf(k) === -1);
  delete out.globalsBefore;   // large and uninteresting once diffed
  process.stdout.write('@@M2@@' + JSON.stringify(out) + '@@M2@@');
})();
`;

/**
 * Copy exactly the statically-traceable file set into a fresh directory.
 * Nothing else goes in — no node_modules, no sibling scripts, no package.json.
 * If the graph needed an npm package this would be the wrong shape, so the
 * trace's `external` list is returned for the caller to assert on.
 */
function buildSandbox(opts) {
  const o    = opts || {};
  const root = o.root || ROOT;
  const t    = TRACE.traceRelative(root, [o.entry || ENTRY]);
  const dir  = o.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'm2-sandbox-'));

  for (const rel of t.reachable) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dest);
  }
  fs.writeFileSync(path.join(dir, '_probe.js'), PROBE);

  return { dir, files: t.reachable, computed: t.computed, external: t.external,
           builtins: t.builtins, unresolved: t.unresolved };
}

/** Run one scenario in a fresh Node process inside the sandbox. */
function runScenario(dir, scenario) {
  let stdout = '', failed = null;
  try {
    stdout = execFileSync(process.execPath, ['_probe.js', scenario], {
      cwd: dir, encoding: 'utf8', timeout: 60000,
      env: { PATH: process.env.PATH },   // a deliberately bare environment
    });
  } catch (e) {
    stdout = String(e.stdout || '');
    failed = String(e.stderr || e.message || '');
  }
  const m = stdout.match(/@@M2@@([\s\S]*?)@@M2@@/);
  if (!m) return { scenario, crashed: true, stderr: failed, stdout: stdout.slice(0, 4000) };
  const parsed = JSON.parse(m[1]);
  if (failed) parsed.stderr = failed;
  return parsed;
}

/** Build once, run every scenario, tear down. */
function run(scenarios) {
  const names = scenarios ||
    ['normal', 'degraded', 'unauthenticated', 'notOwned', 'writeAttempt',
     'trapSelfTest', 'noTransport'];
  const box = buildSandbox({});
  const results = {};
  try {
    for (const n of names) results[n] = runScenario(box.dir, n);
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
  return { bundle: { files: box.files, computed: box.computed, external: box.external,
                     builtins: box.builtins, unresolved: box.unresolved },
           results };
}

module.exports = { run, buildSandbox, runScenario, PROBE, ROOT, ENTRY };

if (require.main === module) {
  const r = run();
  console.log(JSON.stringify(r, null, 2));
}
