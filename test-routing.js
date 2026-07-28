'use strict';
/**
 * Routing contract for vercel.json.
 *
 * Serves the repo through the same rewrite table Vercel will apply, then
 * asserts which HTML each public path actually returns. Exists because the
 * root currently points at the marketing page for pilot review — this test is
 * what makes that state visible instead of silently shipping to production.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8899;
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

// Models VERCEL'S ORDER, which is the whole point of this test:
//   redirects → headers → FILESYSTEM → rewrites
// Rewrites are the last step and only fire when nothing on disk matched. An
// earlier version of this function applied rewrites first and unconditionally,
// so it asserted a routing table Vercel never had: `/` "rewrote" to home.html
// here while production served index.html from disk and the rewrite never ran.
function resolve(urlPath) {
  // 1 — redirects run before anything touches the filesystem.
  for (const r of (CFG.redirects || [])) {
    if (r.source === urlPath) return { redirect: r.destination };
  }
  // 2 — filesystem. `/` resolves to index.html when it exists.
  const asFile = urlPath === '/' ? '/index.html' : urlPath;
  if (fs.existsSync(path.join(ROOT, asFile.replace(/^\//, '')))) return { file: asFile };
  // 3 — rewrites, last.
  for (const r of (CFG.rewrites || [])) {
    if (r.source.includes(':')) continue;              // param routes: not exercised here
    if (r.source === urlPath) return { file: r.destination };
  }
  return { file: urlPath };
}

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const srv = http.createServer((rq, rs) => {
  const r = resolve(rq.url.split('?')[0]);
  if (r.redirect) { rs.writeHead(308, { Location: r.redirect }); rs.end(); return; }
  const file = path.join(ROOT, r.file);
  fs.readFile(file, (e, d) => {
    if (e) { rs.writeHead(404); rs.end('not found'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    rs.end(d);
  });
});

// Collect Buffers and concat once. Appending chunks to a string would decode
// each chunk independently and mangle any UTF-8 sequence that straddles a chunk
// boundary — index.html has emoji, so that corruption is intermittent and real.
const getOnce = p => new Promise(res => http.get({ host:'127.0.0.1', port:PORT, path:p }, r => {
  const cs = []; r.on('data', c => cs.push(c));
  r.on('end', () => res({ code:r.statusCode, body:Buffer.concat(cs).toString('utf8'),
                          location:r.headers.location || null }));
}));
// A redirect is a legitimate way to land on a page; follow one hop so the test
// asks "what does the visitor end up seeing", not "what did the first hop say".
const get = async p => {
  const first = await getOnce(p);
  if (first.code >= 300 && first.code < 400 && first.location) {
    const next = await getOnce(first.location);
    return { ...next, via: first.code + ' → ' + first.location };
  }
  return first;
};

// Which page each path must return. Identified by exact file contents rather
// than a text marker — the app's landing overlay reuses the marketing copy, so
// substring matching cannot tell the two documents apart.
const FILES = {
  marketing: fs.readFileSync(path.join(ROOT, 'home.html'), 'utf8'),
  app:       fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
};
const identify = body => Object.keys(FILES).find(k => FILES[k] === body) || 'unknown';
const EXPECT = [
  ['/',                 'marketing'],   // review setting — see docs/BRANCHING_AND_DEPLOYMENT.md
  ['/home',             'marketing'],
  ['/app',              'app'],
  ['/index',            'app'],
  ['/index.html',       'app'],
];

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

srv.listen(PORT, '127.0.0.1', async () => {
  console.log('\n── vercel.json is valid and complete ──');
  Array.isArray(CFG.rewrites) ? ok('rewrites parse as an array of ' + CFG.rewrites.length)
                              : bad('rewrites malformed');
  CFG.rewrites.every(r => typeof r === 'object' && r.source && r.destination)
    ? ok('every rewrite is a {source, destination} object')
    : bad('a rewrite entry is not a valid object');

  console.log('\n── Public paths serve the right page ──');
  for (const [p, want] of EXPECT) {
    const r = await get(p);
    if (r.code !== 200) { bad(p + ' returned ' + r.code); continue; }
    const got = identify(r.body);
    got === want ? ok(p.padEnd(13) + '→ ' + want)
                 : bad(p + ' served "' + got + '", expected "' + want + '"');
  }

  console.log('\n── The application is always reachable ──');
  const app = await get('/app');
  (identify(app.body) === 'app' && app.body.includes('id="loginScreen"'))
    ? ok('/app reaches the login screen, so the root swap never strands a pilot user')
    : bad('/app does not reach the app');

  console.log('\n\u2500\u2500 Vercel precedence is respected \u2500\u2500');
  const rootRewrite = (CFG.rewrites || []).some(r => r.source === '/');
  !rootRewrite
    ? ok('no rewrite targets "/" \u2014 it could never fire, index.html wins the filesystem check')
    : bad('a rewrite targets "/"', 'rewrites run AFTER the filesystem; this one is dead config');
  const rootRedirect = (CFG.redirects || []).find(r => r.source === '/');
  rootRedirect
    ? ok(`"/" is handled by a redirect to ${rootRedirect.destination} \u2014 redirects run before the filesystem`)
    : bad('nothing routes "/" to the marketing page');

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
  srv.close(); process.exit(fail ? 1 : 0);
});
