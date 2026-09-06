'use strict';
/**
 * tools/global-dependency-inventory.js — every global the server-side
 * PropertyRecord graph can reach for, and what each one is.
 *
 * WHY A STATIC INVENTORY AS WELL AS THE RUNTIME ONE
 * ------------------------------------------------
 * M2 records what the graph ACTUALLY asked the shim for while five scenarios
 * ran. That is precise and it is evidence, but it is bounded by what those
 * scenarios exercised: a `window.showToast` on a branch no fixture reached is
 * real, undeclared, and invisible to it. tenant-space.js alone reaches for
 * nineteen names.
 *
 * So the two measurements answer different questions and neither replaces the
 * other:
 *
 *   static  — every name the graph COULD reach for, complete by construction
 *   runtime — every name it DID reach for, complete for the paths that ran
 *
 * The static set must therefore be classified in full, and the runtime set must
 * be a subset of it. A runtime name that is not in the static set means this
 * scanner is wrong; a static name with no classification means nobody has
 * decided whether it is safe. Both are failures.
 *
 * WHAT COUNTS AS A GLOBAL HERE
 * ----------------------------
 * `window.<Name>`, split into the file's own export assignment and a genuine
 * dependency read, plus `process.env.<NAME>` — an environment dependency is
 * still an undeclared runtime dependency, and a serverless function that reads
 * one that is not set behaves differently from one that does.
 *
 * READ-ONLY. Reads source files. Executes nothing.
 */

const fs    = require('fs');
const path  = require('path');
const TRACE = require('./static-require-trace.js');

const ROOT = path.join(__dirname, '..');

/** Comments are stripped first — several of these files DISCUSS the globals
 *  they must not use, and a scanner that counts prose is worse than none. */
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Comments AND string contents blanked, keeping the quotes so the code still
 * parses by eye. Needed for the bare-global scan and for nothing else: these
 * files are full of English inside strings, and 'Estoppel Certificate.pdf'
 * looks exactly like a reference to a global named Certificate.
 */
function stripStringsAndComments(src) {
  const noComments = strip(src);
  return noComments.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
                            (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0]);
}

/** Identifiers that are part of the language or of Node, not a dependency. */
const INTRINSIC = new Set(['Math', 'Date', 'Array', 'Object', 'JSON', 'String', 'Number',
  'Boolean', 'Set', 'Map', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise',
  'Infinity', 'NaN', 'Intl', 'Symbol', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'BigInt',
  'ArrayBuffer', 'Uint8Array', 'Int32Array', 'Float64Array', 'TextEncoder', 'TextDecoder',
  'URL', 'URLSearchParams', 'Buffer', 'Function']);

/**
 * Free capitalised identifiers used as `X.y` or `X(`, with no declaration in the
 * file. This is an approximation, not a parser — but it is the approximation
 * that finds the one case a window.* scan cannot: selectors.js calls a BARE
 * `ReviewEngine`, which no amount of grepping for `window.` will ever reveal.
 */
function bareGlobals(code) {
  const used = new Set();
  for (const m of code.matchAll(/(?<![.\w$])\b([A-Z][A-Za-z0-9_$]+)\b\s*[.(]/g)) used.add(m[1]);
  const declared = new Set();
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\bwindow\.([A-Za-z0-9_$]+)\s*=(?!=)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/([A-Za-z0-9_$]+)\s*:/g)) declared.add(m[1]);
  for (const m of code.matchAll(/function\s*\(([^)]*)\)/g))
    m[1].split(',').forEach(a => declared.add(a.trim()));
  return Array.from(used).filter(n => !INTRINSIC.has(n) && !declared.has(n)).sort();
}

const WRITE = /\bwindow\.([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/g;
const READ  = /\bwindow\.([A-Za-z_][A-Za-z0-9_]*)/g;
const ENV   = /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * The classification. Every name the scanner finds must appear here, and the
 * reason has to be specific enough to check.
 *
 *   module       resolved by require() on the server; the window branch is the
 *                browser half of a dual-resolution and reads undefined here
 *   shimmed      supplied by the sealed allow-list in api/_server-deps.js
 *   browser_only must stay absent on a server; reading it gives undefined,
 *                which is the branch the code already handles
 *   env          an environment variable, not a browser global
 */
const CLASSIFICATION = {
  // ── intentionally shimmed pure dependencies ────────────────────────────
  LeaseIntelligence: { kind: 'shimmed', why: 'pure; supplied by the allow-list' },
  TenantSpace:       { kind: 'shimmed', why: 'pure; supplied by the allow-list' },
  PropertyWorkspace: { kind: 'shimmed', why: 'pure; supplied by the allow-list' },
  PropertyReference: { kind: 'shimmed', why: 'pure; supplied by the allow-list, and read at call time by property-workspace.js:86 with no fallback' },

  // ── explicit module dependencies (dual-resolution, require wins here) ──
  CamPool:      { kind: 'module', require: './cam-pool.js',
                  why: "variance-breakdown.js falls back to require('./cam-pool.js')" },
  MoneyCents:   { kind: 'module', require: './money-cents.js',
                  why: "cam-pool.js and variance-breakdown.js fall back to require('./money-cents.js')" },
  SourceValues: { kind: 'module', require: './source-values.js',
                  why: "cam-pool.js and money-cents.js fall back to require('./source-values.js')" },
  VarianceBreakdown: { kind: 'module', require: './variance-breakdown.js',
                  why: 'own export assignment in variance-breakdown.js; also a declared dependency' },

  // ── browser-only: must remain excluded ─────────────────────────────────
  Selectors: { kind: 'browser_only',
    why: 'pure logic, but calls a BARE ReviewEngine identifier that only a second ' +
         'global could satisfy. Reads {} here; the hydrator reports the degradation ' +
         'as attention.without_selectors_readiness.' },
  PropertyTimeline: { kind: 'browser_only', why: 'property-timeline.js touches document at load' },
  DocViewer:        { kind: 'browser_only', why: 'opens a document in a DOM overlay; tenant-space.js reaches for it only from click handlers, never from assemble()' },
  SpaceActions:     { kind: 'browser_only', why: 'UI action dispatcher' },
  AuthService:      { kind: 'browser_only', why: 'browser SESSION state — the current signed-in user' },
  currentProperty:  { kind: 'browser_only', why: 'browser SESSION state — the property open in the tab' },
  savePropertyNow:  { kind: 'browser_only', why: 'a WRITE path; must never be reachable from a read-only server module' },
  saveProperty:     { kind: 'browser_only', why: 'a WRITE path; must never be reachable from a read-only server module' },
  appendPropertyTimelineEvent: { kind: 'browser_only', why: 'a WRITE path — it appends an event to the property record, and must never be reachable from a read-only server module' },
  showToast:        { kind: 'browser_only', why: 'transient UI notification; every call site guards it with if (window.showToast), so absence is the handled branch' },
  esc:              { kind: 'browser_only', why: 'HTML escaper; each file has its own local fallback' },
  docLinkHtml:      { kind: 'browser_only', why: 'HTML rendering helper' },
  docImageHtml:     { kind: 'browser_only', why: 'HTML rendering helper' },
  isStoredDocumentRef: { kind: 'browser_only', why: 'storage-reference helper; falls back to a local test' },
  switchWorkspaceTab:  { kind: 'browser_only', why: 'moves the browser tab focus between workspace panels; navigation, with no meaning on a server' },
  openDisputeWorkspace:{ kind: 'browser_only', why: 'navigates the browser to the dispute panel; reached only from a click handler in tenant-space.js' },
  generateTenantStatement: { kind: 'browser_only', why: 'renders a tenant statement into the page; a UI action reached only from a click handler' },
  _ccFlashEl:       { kind: 'browser_only', why: 'DOM highlight effect' },
  FileReader:       { kind: 'browser_only', why: 'bare browser global at tenant-space.js:1114, inside an upload handler assemble() never reaches' },

  // ── environment ────────────────────────────────────────────────────────
  VERCEL_ENV:                     { kind: 'env', why: 'selects production vs pilot; absent ⇒ pilot, which is the fail-safe direction' },
  SUPABASE_URL:                   { kind: 'env', why: 'production transport target' },
  SUPABASE_ANON_KEY:              { kind: 'env', why: 'production transport credential' },
  SUPABASE_SERVICE_ROLE_KEY:      { kind: 'env', why: 'production transport credential' },
  PILOT_SUPABASE_SERVICE_ROLE_KEY:{ kind: 'env', why: 'pilot transport credential' },
  XRPL_NETWORK:                   { kind: 'env', why: 'read by _pilot-target.js for other callers; unused by the hydrator' },
};

/** Scan one file. Returns { exports, reads, env }. */
function scanFile(abs) {
  const code = strip(fs.readFileSync(abs, 'utf8'));
  const exportsOf = new Set();
  for (const m of code.matchAll(WRITE)) exportsOf.add(m[1]);
  const reads = new Set();
  for (const m of code.matchAll(READ)) if (!exportsOf.has(m[1])) reads.add(m[1]);
  // A file that both assigns and reads its own name (variance-breakdown.js does)
  // is still only exporting it, so `reads` excludes anything it assigns.
  const env = new Set();
  for (const m of code.matchAll(ENV)) env.add(m[1]);
  // Bare globals are scanned from a version with string contents blanked too.
  const bare = bareGlobals(stripStringsAndComments(fs.readFileSync(abs, 'utf8')))
                 .filter(n => !exportsOf.has(n));
  return { exports: Array.from(exportsOf).sort(),
           reads:   Array.from(reads).sort(),
           env:     Array.from(env).sort(),
           bare };
}

/** Inventory the whole traced graph. */
function inventory(opts) {
  const o     = opts || {};
  const root  = o.root  || ROOT;
  const entry = o.entry || 'api/_property-record-hydrator.js';
  const t     = TRACE.traceRelative(root, [entry]);

  const byFile = {};
  const names  = new Map();   // name -> Set(files that READ it)
  const envs   = new Map();
  const bares  = new Map();   // name -> Set(files with a BARE reference)
  const owned  = new Map();   // name -> Set(files that EXPORT it)

  for (const rel of t.reachable) {
    const s = scanFile(path.join(root, rel));
    byFile[rel] = s;
    for (const n of s.reads)   { if (!names.get(n)) names.set(n, new Set()); names.get(n).add(rel); }
    for (const n of s.bare)    { if (!bares.get(n)) bares.set(n, new Set()); bares.get(n).add(rel); }
    for (const n of s.exports) { if (!owned.get(n)) owned.set(n, new Set()); owned.get(n).add(rel); }
    for (const n of s.env)     { if (!envs.get(n))  envs.set(n,  new Set()); envs.get(n).add(rel); }
  }

  const classify = (n) => CLASSIFICATION[n] || null;
  const rows = [];
  for (const [n, files] of names) {
    const c = classify(n);
    rows.push({ name: n, kind: c ? c.kind : 'UNCLASSIFIED', why: c ? c.why : null,
                readBy: Array.from(files).sort(),
                exportedBy: Array.from(owned.get(n) || []).sort() });
  }
  for (const [n, files] of bares) {
    const c = classify(n);
    const existing = rows.find(r => r.name === n);
    if (existing) { existing.bareIn = Array.from(files).sort(); continue; }
    rows.push({ name: n, kind: c ? c.kind : 'UNCLASSIFIED', why: c ? c.why : null,
                readBy: [], exportedBy: [], bareIn: Array.from(files).sort() });
  }
  for (const [n, files] of envs) {
    const c = classify(n);
    rows.push({ name: n, kind: c ? c.kind : 'UNCLASSIFIED', why: c ? c.why : null,
                readBy: Array.from(files).sort(), exportedBy: [], env: true });
  }
  rows.sort((a, b) => (a.kind + a.name).localeCompare(b.kind + b.name));

  return {
    files: t.reachable,
    byFile,
    rows,
    unclassified: rows.filter(r => r.kind === 'UNCLASSIFIED').map(r => r.name),
    byKind: rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] || []).concat(r.name)), a), {}),
  };
}

module.exports = { inventory, scanFile, bareGlobals, stripStringsAndComments,
                   CLASSIFICATION, INTRINSIC, strip, ROOT };

if (require.main === module) {
  const inv = inventory();
  for (const kind of ['shimmed', 'module', 'browser_only', 'env', 'UNCLASSIFIED']) {
    const rows = inv.rows.filter(r => r.kind === kind);
    if (!rows.length) continue;
    console.log('\n' + kind.toUpperCase() + ' (' + rows.length + ')');
    for (const r of rows) {
      const where = (r.readBy.length ? 'window: ' + r.readBy.join(', ') : '') +
                    (r.bareIn ? (r.readBy.length ? ' | ' : '') + 'bare: ' + r.bareIn.join(', ') : '');
      console.log('  ' + r.name.padEnd(32) + ' ' + where);
    }
  }
  console.log('\nunclassified: ' + (inv.unclassified.join(', ') || '(none)'));
}
