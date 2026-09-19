'use strict';
/**
 * test-build-identity.js — P1: a deployment says which one it is, and a stale
 * asset cannot outlive it.
 *
 *   node test-build-identity.js
 *
 * WHAT THIS PREVENTS
 *
 * A pilot validation session ran for two hours against a hostname serving a
 * build older than the feature under test. Every observation was consistent
 * and every diagnosis was wrong, because nothing in the browser could say
 * which commit was running. Two mechanisms close that, and this suite holds
 * both to their contract:
 *
 *   A  every script index.html loads is covered by a Cache-Control rule in
 *      vercel.json, so a browser cannot serve one stale module beside fresh
 *      ones
 *   B  api/build-info.js reports the deployment's identity — and ONLY that.
 *      A file that reads process.env and answers over HTTP is one careless
 *      line away from being a secret leak, so the field list is pinned here.
 *   C  build-stamp.js publishes window.__MS_BUILD, logs one line, and cannot
 *      be the reason a page fails to load
 *
 * Offline. No network, no browser: the header rule is matched against the
 * script tags by the same path-to-regexp shape Vercel uses, and build-stamp.js
 * is executed in a stub environment with fetch forced to fail.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT   = __dirname;
const HTML   = fs.readFileSync(path.join(ROOT, 'index.html'),   'utf8');
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const STAMP  = fs.readFileSync(path.join(ROOT, 'build-stamp.js'), 'utf8');
const INFO   = fs.readFileSync(path.join(ROOT, 'api', 'build-info.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    fail++; failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
}

// ── A. Every local script is covered by a cache rule ─────────────────────────
console.log('\n── A · asset freshness ──');

// Local <script src> only. A CDN URL is pinned by version in its own path and
// is not ours to set headers for.
const scriptSrcs = [...HTML.matchAll(/<script\s+src="([^"]+)"/g)]
  .map(m => m[1])
  .filter(s => !/^https?:\/\//.test(s));

t('index.html loads local scripts at all', scriptSrcs.length > 0,
  'the extraction found none — the regex or the markup changed');

// Vercel compiles `source` with path-to-regexp, which passes regular-expression
// syntax — groups, alternation, escapes — straight through. So the source IS a
// regex for our purposes, anchored at both ends. The one construct that is NOT
// regex is a named parameter (`:path*`), which this repository's header rules
// do not use; reject it rather than approximate it, so a future rule that needs
// one fails loudly here instead of being silently reported as covering nothing.
function sourceToRegExp(source) {
  if (source.includes(':')) return null;
  try { return new RegExp('^' + source + '$'); }
  catch (_e) { return null; }
}

const jsRules = (VERCEL.headers || []).filter(r => {
  const re = sourceToRegExp(r.source || '');
  return re && re.test('/anything.js');
});

t('vercel.json has a Cache-Control rule matching .js', jsRules.length > 0,
  'no rule matches /anything.js — a stale module can outlive a deployment');

const jsCacheValues = jsRules.flatMap(r =>
  (r.headers || []).filter(h => (h.key || '').toLowerCase() === 'cache-control').map(h => h.value));

t('the .js rule sets Cache-Control', jsCacheValues.length > 0);
t('the .js rule is no-cache — revalidate before every use',
  jsCacheValues.some(v => /(^|,\s*)no-cache(\s*,|$)/.test(v)),
  `got ${JSON.stringify(jsCacheValues)}`);

for (const src of scriptSrcs) {
  const url = src.startsWith('/') ? src : '/' + src;
  const covered = (VERCEL.headers || []).some(r => {
    const re = sourceToRegExp(r.source || '');
    return re && re.test(url) &&
      (r.headers || []).some(h => (h.key || '').toLowerCase() === 'cache-control');
  });
  t(`covered by a cache rule: ${src}`, covered,
    'this file can be served from a browser cache after a deployment');
}

t('build-stamp.js is loaded by index.html', scriptSrcs.includes('build-stamp.js'));

// It has to run before the app it describes, and beside the Supabase line the
// reader is already looking at.
t('build-stamp.js loads immediately after supabase-config.js',
  /<script src="supabase-config\.js"><\/script>[\s\S]{0,400}?<script src="build-stamp\.js"><\/script>/.test(HTML),
  'the two identity lines must be adjacent, and both must precede script.js');

t('build-stamp.js precedes script.js',
  HTML.indexOf('build-stamp.js') < HTML.indexOf('src="script.js"'));

// ── B. The endpoint reports identity and nothing else ────────────────────────
console.log('\n── B · api/build-info.js says only what it should ──');

const envReads = [...INFO.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(m => m[1]).sort();
const ALLOWED  = ['VERCEL_DEPLOYMENT_ID', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'VERCEL_GIT_COMMIT_SHA'];

t('reads only the four public deployment variables',
  JSON.stringify([...new Set(envReads)]) === JSON.stringify(ALLOWED),
  `reads ${JSON.stringify([...new Set(envReads)])}`);

// The named shapes that must never appear here, whatever else changes.
t('names no secret-shaped variable',
  !/process\.env\.[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|SERVICE_ROLE)/.test(INFO),
  'a credential-shaped env var is referenced in a public endpoint');

t('answers no-store', /Cache-Control['"]\s*,\s*['"]no-store/.test(INFO),
  'an endpoint whose job is "which build is live" must never be cached');

t('responds 200 with JSON', /res\.status\(200\)\.json\(/.test(INFO));

t('exports a handler in the repository convention',
  /module\.exports\s*=\s*async function handler\(req, res\)/.test(INFO));

// ── C. The stamp publishes, logs, and never throws ───────────────────────────
console.log('\n── C · build-stamp.js behaviour ──');

function runStamp(fetchImpl) {
  const logs = [];
  const ctx = {
    location: { hostname: 'Example.Vercel.App' },
    window:   {},
    console:  { log: m => logs.push(String(m)), error: m => logs.push('ERR ' + String(m)) },
    fetch:    fetchImpl,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(STAMP, ctx);
  return { ctx, logs };
}

// Synchronously-throwing fetch: the catch must still leave a readable object.
{
  const { ctx, logs } = runStamp(() => { throw new Error('no network'); });
  const b = ctx.window.__MS_BUILD;
  t('a throwing fetch does not throw out of the module', !!b);
  t('window.__MS_BUILD is published even when the fetch throws',
    b && b.commit === null && b.resolved === false);
  t('the host is lower-cased', b && b.host === 'example.vercel.app');
  t('a line is still logged when identity is unknown',
    logs.some(l => /^\[build\] /.test(l) && /commit unknown/.test(l)),
    JSON.stringify(logs));
}

// No fetch at all (file://, an old runtime) — same contract.
{
  const { ctx, logs } = runStamp(undefined);
  t('a missing fetch is survivable', !!ctx.window.__MS_BUILD);
  t('a line is logged with no fetch available', logs.some(l => /^\[build\] /.test(l)));
}

// The asynchronous cases have to settle before the result is printed, so the
// rest of the suite runs inside one async main rather than nested callbacks.
const settle = () => new Promise(r => setImmediate(r));

(async function main() {
  // The happy path, resolved through a real promise.
  {
    const body = { commit: 'c9789b1ed60842dfb3481c0952f09063ee2a66fd', ref: 'my-branch', env: 'preview', deployId: 'dpl_x' };
    const { ctx, logs } = runStamp(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }));
    await settle();

    const b = ctx.window.__MS_BUILD;
    t('the commit is recorded', b.commit === body.commit);
    t('the ref is recorded', b.ref === 'my-branch');
    t('the env is recorded', b.env === 'preview');
    t('the deployment id is recorded', b.deployId === 'dpl_x');
    t('resolved flips true only on an answer', b.resolved === true);
    t('the logged commit is the short form',
      logs.some(l => l.includes('commit c9789b1') && !l.includes(body.commit)),
      JSON.stringify(logs));
    t('the logged line names host, commit, ref and env',
      logs.some(l => /^\[build\] host "example\.vercel\.app" · commit \S+ · ref \S+ · env \S+$/.test(l)),
      JSON.stringify(logs));
  }

  // A non-ok response is an answer we cannot use — same as no answer.
  {
    const { ctx, logs } = runStamp(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    await settle();
    t('a non-ok response leaves resolved false', ctx.window.__MS_BUILD.resolved === false);
    t('a non-ok response still logs', logs.some(l => /^\[build\] /.test(l)));
  }

  // A rejected promise — the network path, as opposed to the throwing one.
  {
    const { ctx, logs } = runStamp(() => Promise.reject(new Error('offline')));
    await settle();
    t('a rejected fetch leaves a readable object', ctx.window.__MS_BUILD.resolved === false);
    t('a rejected fetch still logs', logs.some(l => /commit unknown/.test(l)));
  }

  console.log('\n' + '─'.repeat(62));
  if (fail) {
    console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
    failures.forEach(f => console.log(`  · ${f}`));
    process.exit(1);
  }
  console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
})();
