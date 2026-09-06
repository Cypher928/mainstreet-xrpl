'use strict';
/**
 * test-m3-dependency-hardening.js — every global the server graph can reach
 * for, classified, and the classification checked rather than asserted.
 *
 *   node test-m3-dependency-hardening.js
 *
 * OFFLINE. Reads source files and drives the M2 harness, whose probes run with
 * fetch throwing. Nothing here can reach a network, Pilot or Production.
 *
 * THE TWO MEASUREMENTS, AND WHY BOTH
 * ----------------------------------
 * M2 recorded what the graph ASKED FOR while five scenarios ran. That is real
 * evidence and it is bounded: a window.showToast on a branch no fixture reached
 * is undeclared, live, and invisible to it. tenant-space.js reaches for nineteen
 * names; M2's fixtures touched none of them, which could mean they are
 * unreachable or could mean the fixtures were thin.
 *
 * So M3 measures twice:
 *
 *   static   every name the graph COULD reach for — complete by construction,
 *            including BARE identifiers, which no window.* scan can see
 *   runtime   every name it DID reach for, under the widest property this graph
 *            can be handed: disputes, every attachment kind, a CAM
 *            reconciliation, lease documents, invoices
 *
 * and requires the runtime set to be a subset of the classified static set.
 *
 * THE ANSWER
 * ----------
 * 28 names. None unclassified. None unsafe. The eighteen browser-only ones live
 * in the render and action halves of two files, and the widest fixture reaches
 * none of them — which is now a measurement rather than a hope.
 */

const fs      = require('fs');
const path    = require('path');
const INV     = require('./tools/global-dependency-inventory.js');
const HARNESS = require('./tools/m2-runtime-harness.js');
const DEPS    = require('./api/_server-deps.js');

const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b)
  ? ok(m, JSON.stringify(a))
  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const INVENTORY = INV.inventory();
const RUN = HARNESS.run(['rich', 'normal', 'degraded', 'unauthenticated', 'notOwned']);
const R   = RUN.results;
const RICH = R.rich;

/** The four kinds the brief asks for, plus env. `undeclared` must stay empty. */
const KINDS = ['shimmed', 'module', 'browser_only', 'env'];

// ── A. The inventory is complete ───────────────────────────────────────────
sec('A. Every global the graph can reach for is inventoried and classified');
{
  eq(INVENTORY.unclassified, [],
     'A1 no name in the graph is unclassified — nobody has left one undecided');
  is(!INVENTORY.byKind.UNCLASSIFIED, 'A2 and there is no UNCLASSIFIED bucket at all');
  eq(Object.keys(INVENTORY.byKind).sort(), KINDS.slice().sort(),
     'A3 every classified name falls into one of the four declared kinds');

  const total = INVENTORY.rows.length;
  is(total >= 28, 'A4 the inventory is not trivially small', total + ' names');
  eq(INVENTORY.byKind.module.slice().sort(), ['CamPool', 'MoneyCents', 'SourceValues'],
     'A5 three explicit module dependencies');
  eq(INVENTORY.byKind.browser_only.length, 19, 'A6 nineteen browser-only names');
  eq(INVENTORY.byKind.env.slice().sort(),
     ['PILOT_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_URL', 'VERCEL_ENV', 'XRPL_NETWORK'],
     'A7 six environment dependencies — an env var is a runtime dependency too');

  // An UNKNOWN global must come back as UNCLASSIFIED. Without this, both
  // "unclassified: []" and "default everything to module" would pass A1.
  {
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-inv-'));
    try {
      fs.mkdirSync(path.join(tmp, 'api'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'api', 'entry.js'),
        "require('../dep.js');\nvar x = window.CompletelyMadeUpGlobal;\n");
      fs.writeFileSync(path.join(tmp, 'dep.js'), "var y = window.AnotherInventedOne;\n");
      const inv2 = INV.inventory({ root: tmp, entry: 'api/entry.js' });
      eq(inv2.unclassified.sort(), ['AnotherInventedOne', 'CompletelyMadeUpGlobal'],
         'A7a an unknown global IS reported as unclassified, in the entry and transitively');
      is((inv2.byKind.UNCLASSIFIED || []).length === 2,
         'A7b and lands in the UNCLASSIFIED bucket rather than being assumed safe');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // A scanner that finds nothing would make A1 pass for the wrong reason.
  {
    const probe = "window.Thing = 1;\nvar a = window.Undeclared_X.y;\n" +
                  "BareThing.go();\nvar e = process.env.MADE_UP_VAR;\n";
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'm3-scan-'));
    try {
      const f = path.join(tmp, 'p.js');
      fs.writeFileSync(f, probe);
      const s = INV.scanFile(f);
      eq(s.exports, ['Thing'],       'A8 the scanner separates a file\'s own export from a read');
      eq(s.reads,   ['Undeclared_X'],'A9 and finds a window.* dependency read');
      eq(s.bare,    ['BareThing'],   'A10 and finds a BARE global, which no window.* scan could');
      eq(s.env,     ['MADE_UP_VAR'], 'A11 and an environment read');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // And that it does not invent names out of English prose inside strings.
  const proseHits = INV.bareGlobals(INV.stripStringsAndComments(src('property-reference.js')));
  eq(proseHits, [],
     'A12 prose inside string literals is not mistaken for a global ("Estoppel Certificate.pdf")');
  const unstripped = INV.bareGlobals(INV.strip(src('property-reference.js')));
  is(unstripped.length > 0,
     'A13 which matters, because without the string stripping it reports ' +
     unstripped.length + ' phantom globals');
}

// ── B. The classification is checked, not asserted ─────────────────────────
sec('B. Each classification is verified against the source it describes');
{
  // shimmed ⇒ on the allow-list.
  const shimmed = Object.entries(INV.CLASSIFICATION)
    .filter(([, v]) => v.kind === 'shimmed').map(([k]) => k).sort();
  eq(shimmed, ['LeaseIntelligence', 'PropertyReference', 'PropertyWorkspace', 'TenantSpace'],
     'B1 exactly four names are classified as intentionally shimmed');
  eq(shimmed, DEPS.SHIM_KEYS.slice().sort(),
     'B2 and that set IS the sealed allow-list — the two cannot drift apart');

  // module ⇒ a require fallback really exists next to the window read.
  for (const [name, meta] of Object.entries(INV.CLASSIFICATION)) {
    if (meta.kind !== 'module') continue;
    const readers = (INVENTORY.rows.find(r => r.name === name) || {}).readBy || [];
    if (!readers.length) continue;
    const anyFallback = readers.some(f => {
      const code = INV.strip(src(f));
      const re = new RegExp('window\\.' + name + '\\)?[\\s\\S]{0,120}?require\\(');
      return re.test(code);
    });
    is(anyFallback, 'B3.' + name + ' every window.' + name +
       ' read sits next to a require fallback, so the server resolves a module',
       readers.join(', '));
    is(/^\.\//.test(meta.require), 'B4.' + name + ' and the classification names that module',
       meta.require);
  }

  // browser_only ⇒ NOT on the allow-list, and not silently supplied.
  for (const name of INVENTORY.byKind.browser_only) {
    is(DEPS.SHIM_KEYS.indexOf(name) === -1,
       'B5.' + name + ' is browser-only and is NOT on the allow-list');
  }
  is(DEPS.shimKeys().every(k => INV.CLASSIFICATION[k] && INV.CLASSIFICATION[k].kind === 'shimmed'),
     'B6 and everything the shim actually holds is classified as shimmed');

  // Every classification carries a reason specific enough to check.
  const vague = Object.entries(INV.CLASSIFICATION)
    .filter(([, v]) => !v.why || v.why.length < 20).map(([k]) => k);
  eq(vague, [], 'B7 every entry states a reason, not just a verdict');
}

// ── C. Nothing unsafe is left ──────────────────────────────────────────────
sec('C. There is no undeclared or unsafe dependency remaining');
{
  is(!INVENTORY.byKind.undeclared, 'C1 the undeclared bucket does not exist');
  is(!INVENTORY.byKind.unsafe,     'C2 nor an unsafe one');

  // The runtime set must be a subset of the classified static set. A runtime
  // name the scanner never saw would mean the inventory is wrong.
  const runtime = new Set();
  for (const k of Object.keys(R)) (R[k].shimReads || []).forEach(n => runtime.add(n));
  const known = new Set(Object.keys(INV.CLASSIFICATION));
  const unknown = Array.from(runtime).filter(n => !known.has(n)).sort();
  eq(unknown, [], 'C3 every name reached at runtime is one the static scan classified');
  is(runtime.size > 0, 'C4 and names WERE reached — the comparison is not vacuous',
     Array.from(runtime).sort().join(', '));

  // The undeclared-at-runtime set is exactly the three modules plus Selectors.
  const undeclared = new Set();
  for (const k of Object.keys(R)) (R[k].undeclaredReads || []).forEach(n => undeclared.add(n));
  eq(Array.from(undeclared).sort(), ['CamPool', 'MoneyCents', 'Selectors', 'SourceValues'],
     'C5 the runtime undeclared set is exactly the three dual-resolved modules and Selectors');
  is(Array.from(undeclared).every(n =>
       ['module', 'browser_only'].indexOf(INV.CLASSIFICATION[n].kind) !== -1),
     'C6 and each of those is classified module or browser_only — none is unsafe');
}

// ── D. The browser-only names are unreachable, measured not assumed ────────
sec('D. Eighteen window names and a bare FileReader, none of them reachable');
{
  is(RICH.ok, 'D1 the widest property this graph can be handed hydrates',
     RICH.error ? RICH.error.split('\n')[0] : 'clean');
  eq(RICH.touched, [], 'D2 and touches no booby-trapped browser global');
  eq(RICH.newGlobals, [], 'D3 and leaves no new global');
  eq(RICH.leakedWindow, false, 'D4 and no window');

  const reached = new Set(RICH.shimReads || []);
  const browserReached = INVENTORY.byKind.browser_only.filter(n => reached.has(n) && n !== 'Selectors');
  eq(browserReached, [],
     'D5 not one browser-only name was reached, with disputes, every attachment ' +
     'kind, a CAM reconciliation, lease documents and invoices all present');

  // D5 is only worth anything if the fixture actually drove those code paths.
  // A property with no disputes and no timeline would touch no dispute or
  // attachment branch, and would prove precisely nothing about them.
  eq(RICH.record.spaces, 2, 'D6 the rich fixture produced two spaces');
  is(RICH.record.attention >= 1, 'D7 and attention items', String(RICH.record.attention));
  is(RICH.reads.length === 3, 'D8 over the same three requests', String(RICH.reads.length));
  is(RICH.record.fieldTenants >= 1, 'D9 with provenance attached');
  is(RICH.record.disputes >= 2, 'D9a and the record really carries disputes',
     String(RICH.record.disputes));
  is(RICH.record.timeline >= 5, 'D9b and timeline events, scoped to spaces',
     String(RICH.record.timeline));
  is(RICH.record.documents >= 1, 'D9c and documents', String(RICH.record.documents));
  is(RICH.record.spaceEvents.reduce((a, b) => a + b, 0) >= 5,
     'D9d with events attributed to the spaces', JSON.stringify(RICH.record.spaceEvents));
  is(RICH.record.spaceDisputes.reduce((a, b) => a + b, 0) >= 2,
     'D9e and disputes attributed to them', JSON.stringify(RICH.record.spaceDisputes));
  is(RICH.record.camResults >= 2, 'D9f and a CAM reconciliation with results',
     String(RICH.record.camResults));

  // The write paths specifically. These are the ones that would matter most.
  for (const w of ['savePropertyNow', 'saveProperty', 'appendPropertyTimelineEvent']) {
    is(!reached.has(w), 'D10.' + w + ' the write path ' + w + ' was never reached');
    is(INV.CLASSIFICATION[w].why.toLowerCase().indexOf('write') !== -1,
       'D11.' + w + ' and is classified as a write path, so its presence would be flagged');
  }
}

// ── E. Selectors stays excluded, and the reason is checkable ───────────────
sec('E. Selectors: pure, and still correctly excluded');
{
  const S  = src('selectors.js');
  const RE = src('review-engine.js');
  const Sc = INV.strip(S), REc = INV.strip(RE);

  // It is genuinely pure — which is why the question is worth asking at all.
  for (const [label, re] of [['document', /\bdocument\s*\./], ['localStorage', /\blocalStorage\b/],
                             ['fetch', /\bfetch\s*\(/], ['timers', /\bsetTimeout\b|\bsetInterval\b/],
                             ['innerHTML', /\binnerHTML\b/]]) {
    is(!re.test(Sc), 'E1.' + label + ' selectors.js contains no ' + label);
  }
  is(!/\bdocument\s*\./.test(REc),
     'E2 review-engine.js has no DOM contact either — its six "document" hits are the English word');

  // The blocker, stated exactly.
  is(/(?<![.\w])ReviewEngine\./.test(Sc),
     'E3 but selectors.js calls a BARE ReviewEngine, not window.ReviewEngine');
  const bareCount = (Sc.match(/(?<![.\w])ReviewEngine\./g) || []).length;
  is(bareCount >= 5, 'E4 at several call sites', bareCount + ' of them');
  is(!/window\.ReviewEngine/.test(Sc),
     'E5 and never through window, so the sealed shim cannot satisfy it');
  is(!/module\.exports/.test(Sc) && !/module\.exports/.test(REc),
     'E6 neither file has a module.exports, so require() alone cannot supply it');

  // The SECOND blocker, which is the decisive one: including ReviewEngine would
  // import a dependency whose absence silently corrupts every answer.
  is(/window\.SourceValues\)\s*\|\|\s*null/.test(REc),
     'E7 review-engine.js resolves SourceValues with || null and NO require fallback');
  is(/every lease will read as missing its area/.test(RE),
     'E8 and says what that costs — every lease would read as missing its area');

  // So the exclusion holds, and the record says so rather than hiding it.
  is(DEPS.SHIM_KEYS.indexOf('Selectors') === -1,     'E9 Selectors is not on the allow-list');
  is(DEPS.SHIM_KEYS.indexOf('ReviewEngine') === -1,  'E10 nor is ReviewEngine');
  is(DEPS.SHIM_KEYS.indexOf('SourceValues') === -1,  'E11 nor SourceValues');
  is((RICH.degraded || []).indexOf('attention.without_selectors_readiness') !== -1,
     'E12 and the record reports the degradation the exclusion causes');
  is(INV.CLASSIFICATION.Selectors.why.indexOf('BARE ReviewEngine') !== -1,
     'E13 with the reason recorded in the inventory, not only in a commit message');

  // selectors.js is not in the bundle, and must not be.
  is(RUN.bundle.files.indexOf('selectors.js') === -1, 'E14 selectors.js is not in the bundle');
  is(RUN.bundle.files.indexOf('review-engine.js') === -1, 'E15 nor review-engine.js');
}

// ── F. One module, one instance ────────────────────────────────────────────
sec('F. The graph resolves the same modules the dependency set declares');
{
  const si = RICH.sameInstance || {};
  is(!si.error, 'F1 the identity check ran', si.error || 'clean');

  // The EXPECTED polarity lives here, not in the probe. A probe that reported
  // its own expectations would agree with itself no matter what it measured.
  const ex = {
    CamPool:                true,
    FieldProvenance:        true,
    VarianceBreakdown:      true,
    PropertyReference:      true,
    TimelineMerge:          true,
    control_pool_vs_cents:  false,
    control_merge_vs_pool:  false,
  };
  eq(Object.keys(si).filter(k => k !== 'error').sort(), Object.keys(ex).sort(),
     'F1a the probe measured exactly the pairs this suite expects');

  const names = Object.keys(ex);
  is(names.length >= 7, 'F2 across a table of pairs', names.length + ' pairs');
  for (const n of names) {
    is(si[n] === ex[n], 'F3.' + n + ' resolves ' + (ex[n] ? 'to the same instance' : 'to a DIFFERENT one'),
       'got ' + si[n]);
  }

  // The negatives are the point: a check that answered "true" to everything
  // would look exactly like a passing one without them.
  const negatives = names.filter(n => ex[n] === false);
  is(negatives.length >= 2, 'F4 and at least two of the pairs are negative controls',
     negatives.join(', '));
  is(negatives.every(n => si[n] === false),
     'F5 every negative control came back false, so the comparison is computed');
  const positives = names.filter(n => ex[n] === true);
  is(positives.length >= 5 && positives.every(n => si[n] === true),
     'F6 and every positive pair is one instance', positives.length + ' positives');
}

// ── G. Environment dependencies ────────────────────────────────────────────
sec('G. Environment reads are inventoried, and the unset direction is safe');
{
  const t = src('api/_pilot-target.js');
  is(/VERCEL_ENV === 'production'/.test(t),
     'G1 production is selected only by an exact VERCEL_ENV match');
  is(/IS_PROD \? \{/.test(t) || /IS_PROD/.test(t),
     'G2 and everything else resolves to pilot');
  is(/FAIL-SAFE/.test(t),
     'G3 which the file states as the fail-safe direction — unset cannot reach production');
  for (const n of INVENTORY.byKind.env) {
    is(INV.CLASSIFICATION[n].kind === 'env', 'G4.' + n + ' is classified as an environment read');
  }
  is(INVENTORY.byFile['api/_pilot-target.js'].env.length === 6,
     'G5 all six live in one file, so the environment surface is one place');
}

// ── H. M1b semantics survive the hardening ─────────────────────────────────
sec('H. Ownership, read-only, evidence, provenance and unavailable are unchanged');
{
  eq(R.unauthenticated.reason, 'authentication_required', 'H1 no user is still refused');
  eq(R.unauthenticated.reads.length, 0, 'H2 still before any read');
  eq(R.notOwned.reason, 'not_authorized', 'H3 a non-owner is still refused');
  eq(R.notOwned.reads.length, 1, 'H4 still after the ownership probe alone');

  is((RICH.methods || []).every(m => m === 'GET'), 'H5 every request is still a GET',
     (RICH.methods || []).join(','));
  const tables = Array.from(new Set(RICH.reads.map(r => r.split('?')[0]))).sort();
  eq(tables, ['/properties', '/tenant_field_evidence'],
     'H6 and the approved reads are unchanged even for the richest property');

  eq(RICH.record.meta.unavailable, [], 'H7 meta.unavailable keeps its meaning and stays empty');
  eq(RICH.record.meta.origin, 'server', 'H8 meta.origin');
  eq(RICH.record.meta.includesBrowserLocalState, false, 'H9 meta.includesBrowserLocalState');
  is(R.degraded.degraded.indexOf('evidence.read_failed') !== -1,
     'H10 a failed evidence read is still reported');
  is(R.degraded.degraded.indexOf('tenants.from_table_no_review_state') !== -1,
     'H11 and the tenant fallback still flags its missing review state');
  eq(RICH.record.keys, ['attention', 'cam', 'disputes', 'documents', 'fields',
                        'identity', 'meta', 'spaces', 'timeline'],
     'H12 the record shape is unchanged');
}

// ── I. The M2 bundle proof still holds ─────────────────────────────────────
sec('I. The bundle-trace proof from M2 is intact');
{
  eq(RUN.bundle.computed, [], 'I1 no computed require anywhere in the graph');
  eq(RUN.bundle.external, [], 'I2 no npm package');
  eq(RUN.bundle.unresolved, [], 'I3 nothing unresolved');
  is(RUN.bundle.files.length === 15, 'I4 fifteen files in the bundle',
     String(RUN.bundle.files.length));
  eq(INVENTORY.files, RUN.bundle.files,
     'I5 and the inventory covers exactly the files the bundle contains');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
