'use strict';
/**
 * tools/static-require-trace.js — which files a bundler can actually SEE.
 *
 * WHY THIS EXISTS
 * ---------------
 * A serverless deployment does not ship the repository. Vercel's Node builder
 * runs @vercel/nft over each function entry point, follows the requires it can
 * resolve STATICALLY, and packages only those files. Anything it cannot see is
 * simply not there at runtime.
 *
 * `require('../field-provenance.js')` is a string literal and gets traced.
 * `require(path.join(__dirname, rel))` is a computed expression and does not:
 * nft has no value for `rel`, so it follows nothing and says nothing. The
 * function deploys, the tests pass locally, and the first real invocation dies
 * on MODULE_NOT_FOUND.
 *
 * This module models that: follow only string-literal relative requires, and
 * report every computed one it had to give up on. It is deliberately a
 * conservative approximation of nft rather than a reimplementation of it — the
 * point is not to predict a bundle byte for byte, it is to make "a bundler
 * cannot see this" a thing a test can assert.
 *
 * READ-ONLY. Reads source files, resolves paths, touches nothing else.
 */

const fs   = require('fs');
const path = require('path');

/** Comments are stripped first: a require inside one is not a require. */
function _stripComments(src) {
  return src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Relative requires written as a plain string literal. */
const LITERAL = /\brequire\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g;

/** Any require whose argument is not a plain string literal. */
const COMPUTED = /\brequire\(\s*(?!['"])[^)]*\)/g;

/** A literal require that is NOT relative: a node builtin or an npm package. */
const BARE = /\brequire\(\s*(['"])([^.'"][^'"]*)\1\s*\)/g;

/** Node builtins need no bundling; an npm package does. */
const BUILTIN = new Set(['assert', 'buffer', 'child_process', 'crypto', 'events', 'fs',
  'http', 'https', 'module', 'net', 'os', 'path', 'process', 'querystring', 'readline',
  'stream', 'string_decoder', 'timers', 'tls', 'url', 'util', 'v8', 'vm', 'worker_threads',
  'zlib']);

/** Resolve a relative specifier the way Node would, trying .js if bare. */
function _resolve(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, base + '.js', path.join(base, 'index.js')]) {
    try { if (fs.statSync(c).isFile()) return c; } catch (_e) { /* next */ }
  }
  return null;
}

/**
 * Follow string-literal relative requires from `entries`, transitively.
 *
 * @param {string[]} entries  absolute paths
 * @returns {{ reachable: string[], computed: Array<{file:string, expr:string}>,
 *             unresolved: Array<{file:string, spec:string}> }}
 *   reachable  — every file a bundler could include, entries included, sorted
 *   computed   — requires whose argument is not a literal, so nothing was followed
 *   unresolved — literal requires that do not resolve to a file on disk
 */
function trace(entries) {
  const seen       = new Set();
  const computed   = [];
  const unresolved = [];
  const external   = new Set();
  const builtins   = new Set();
  const queue      = entries.slice();

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);

    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch (_e) { continue; }
    const code = _stripComments(src);

    for (const m of code.matchAll(COMPUTED)) {
      computed.push({ file, expr: m[0].replace(/\s+/g, ' ').slice(0, 80) });
    }
    for (const m of code.matchAll(BARE)) {
      const spec = m[2].split('/')[0];
      (BUILTIN.has(spec) ? builtins : external).add(spec);
    }
    for (const m of code.matchAll(LITERAL)) {
      const target = _resolve(file, m[2]);
      if (!target) { unresolved.push({ file, spec: m[2] }); continue; }
      if (!seen.has(target)) queue.push(target);
    }
  }

  return {
    reachable:  Array.from(seen).sort(),
    computed,
    unresolved,
    external:   Array.from(external).sort(),
    builtins:   Array.from(builtins).sort(),
  };
}

/** trace(), with paths relative to `root` — easier to assert and to read. */
function traceRelative(root, entries) {
  const abs = entries.map(e => path.resolve(root, e));
  const r   = trace(abs);
  const rel = (p) => path.relative(root, p);
  return {
    reachable:  r.reachable.map(rel).sort(),
    computed:   r.computed.map(c => ({ file: rel(c.file), expr: c.expr })),
    unresolved: r.unresolved.map(u => ({ file: rel(u.file), spec: u.spec })),
    external:   r.external,
    builtins:   r.builtins,
  };
}

module.exports = { trace, traceRelative, _stripComments, LITERAL, COMPUTED, BARE, BUILTIN };

// `node tools/static-require-trace.js api/_property-record-hydrator.js`
if (require.main === module) {
  const root = path.join(__dirname, '..');
  const args = process.argv.slice(2);
  const r = traceRelative(root, args.length ? args : ['api/_property-record-hydrator.js']);
  console.log('reachable (' + r.reachable.length + '):');
  r.reachable.forEach(f => console.log('  ' + f));
  console.log('\ncomputed requires a bundler cannot follow (' + r.computed.length + '):');
  r.computed.forEach(c => console.log('  ' + c.file + '  ->  ' + c.expr));
  console.log('\nnode builtins: ' + (r.builtins.join(', ') || '(none)'));
  console.log('npm packages : ' + (r.external.join(', ') || '(none)'));
  if (r.unresolved.length) {
    console.log('\nunresolved literal requires (' + r.unresolved.length + '):');
    r.unresolved.forEach(u => console.log('  ' + u.file + '  ->  ' + u.spec));
  }
}
