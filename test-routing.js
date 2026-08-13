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

  // ── Auth emails must land somewhere that can sign the user in ───────────
  // When the marketing page took the root, every auth redirect pointing at the
  // bare origin quietly started landing on it. home.html loads no Supabase
  // client at all, so the #access_token fragment Supabase appends is read by
  // nothing and a user who has just confirmed their email ends up on marketing,
  // still signed out.
  //
  // The property under test is NOT "is this the app" — /reset-password is a
  // standalone page and legitimately is not. It is "can the document served at
  // this URL establish a session from the fragment", i.e. does it load a
  // Supabase client. Each target is resolved through the same routing table the
  // rest of this suite uses, and the constants are read out of script.js rather
  // than restated here.
  console.log('\n── Auth email redirects land where a session can be established ──');
  const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  // Production value of each PUBLIC_/APP_ constant, as a path.
  const consts = {};
  let cm; const reConst = /const (PUBLIC_APP_URL|APP_ENTRY_URL) =[\s\S]*?:\s*(?:'([^']+)'|([A-Z_]+)\s*\+\s*'([^']+)');/g;
  while ((cm = reConst.exec(src))) {
    consts[cm[1]] = cm[2] ? '/' : ((consts[cm[3]] === '/' ? '' : consts[cm[3]] || '') + cm[4]);
  }
  (consts.PUBLIC_APP_URL && consts.APP_ENTRY_URL)
    ? ok(`resolved PUBLIC_APP_URL -> "${consts.PUBLIC_APP_URL}", APP_ENTRY_URL -> "${consts.APP_ENTRY_URL}"`)
    : bad('could not resolve the auth URL constants', JSON.stringify(consts));

  const targets = [];
  let m; const reTarget = /(?:emailRedirectTo|redirectTo):\s*(PUBLIC_APP_URL|APP_ENTRY_URL)(?:\s*\+\s*'([^']+)')?/g;
  while ((m = reTarget.exec(src))) targets.push({ base: m[1], suffix: m[2] || '' });
  (targets.length >= 2)
    ? ok(`found ${targets.length} auth redirect target(s) in script.js`)
    : bad('could not find the auth redirect targets', String(targets.length));

  for (const t of targets) {
    const label = t.base + (t.suffix ? " + '" + t.suffix + "'" : '');
    const base = consts[t.base] || '/';
    const url = t.suffix ? (base === '/' ? t.suffix : base + t.suffix) : base;
    const r = await get(url);
    const canAuth = /supabase-config\.js|@supabase\/supabase-js|createClient/.test(r.body || '');
    const isMarketing = /product-film\.js/.test(r.body || '') && !canAuth;
    canAuth
      ? ok(`${label} -> ${url}, which loads a Supabase client and can complete the sign-in`)
      : bad(`${label} -> ${url} cannot establish a session`,
            isMarketing ? 'it serves the MARKETING page — the auth fragment is dropped and the user stays signed out'
                        : 'the document loads no Supabase client');
  }

  // ── Tenant portal magic-link redirect ───────────────────────────────────────
  // Same failure this file already guards for the landlord app, on a new surface.
  // Tenants authenticate by magic link, so the redirect target IS the sign-in:
  // if it resolves to a document that loads no Supabase client, the token
  // fragment is dropped and the tenant simply never gets in — and unlike a
  // password flow there is no second way for them to try.
  const psrc = fs.readFileSync(path.join(ROOT, 'portal.js'), 'utf8');

  const pm = psrc.match(/(?:const|var|let) PORTAL_URL =[\s\S]*?:\s*window\.location\.origin \+ '([^']+)';/);
  pm ? ok(`resolved PORTAL_URL -> "${pm[1]}"`)
     : bad('could not resolve PORTAL_URL in portal.js');

  const pTargets = [];
  let pmt; const rePortal = /emailRedirectTo:\s*([A-Za-z_]+)/g;
  while ((pmt = rePortal.exec(psrc))) pTargets.push(pmt[1]);
  pTargets.length
    ? ok(`found ${pTargets.length} auth redirect target(s) in portal.js`)
    : bad('portal.js declares no emailRedirectTo — a magic link would land wherever Supabase defaults to');

  // Every portal redirect must be built from PORTAL_URL, never a bare origin.
  pTargets.every(t => t === 'redirect' || t === 'PORTAL_URL')
    ? ok('portal redirect targets derive from PORTAL_URL')
    : bad('a portal redirect target is not derived from PORTAL_URL', pTargets.join(', '));

  if (pm) {
    const r = await get(pm[1]);
    const canAuth = /supabase-config\.js|@supabase\/supabase-js|createClient/.test(r.body || '');
    canAuth
      ? ok(`PORTAL_URL -> ${pm[1]}, which loads a Supabase client and can complete the magic-link sign-in`)
      : bad(`PORTAL_URL -> ${pm[1]} cannot establish a session`,
            'the document loads no Supabase client, so the magic-link fragment is dropped');

    // The portal must not ship the landlord bundle — that is the B1 boundary.
    /src="script\.js"/.test(r.body || '')
      ? bad(`${pm[1]} loads script.js — the tenant would receive the landlord application`)
      : ok(`${pm[1]} does not load the landlord bundle`);
  }

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
  srv.close(); process.exit(fail ? 1 : 0);
});
