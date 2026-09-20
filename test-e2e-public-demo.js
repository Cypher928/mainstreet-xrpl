'use strict';
/**
 * test-e2e-public-demo.js — the public /demo route keeps its promises.
 *
 *   node test-e2e-public-demo.js
 *
 * THE PROMISES, AND WHY EACH IS TESTED HERE RATHER THAN ASSUMED.
 *
 * /demo exists because the demo data has no read-only grant: every RLS policy
 * on it is FOR ALL to `authenticated`, so any session that can show a judge the
 * data can also delete it. The route's whole value is that it shows the real
 * product with no session at all. That is a claim about what does NOT happen —
 * no auth, no connection, no persistence — and claims like that rot silently.
 * One import added to index.html in six months could reopen the connection and
 * nothing would look wrong on screen.
 *
 *   A  it boots with no authentication and no login screen
 *   B  ZERO requests to Supabase or /api leave the page
 *   C  it opens directly in Cascade Commons
 *   D  the data is the current seed: 3 of 5 billable, 26 documented invoices
 *   E  writes cannot persist — a reload is back to the seeded state
 *   F  the read-only banner is present and says what it must
 *   G  the route is inert everywhere else
 *
 * Runs the real index.html from this worktree in a real browser. The ONLY
 * network the harness allows is its own localhost server; anything else is
 * recorded and asserted against.
 */
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8977;
const MIME = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json',
               '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.pdf':'application/pdf',
               '.mp3':'audio/mpeg','.webm':'audio/webm' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const yes = (c, m, d) => c ? ok(m) : bad(m, d);
const sec = t => console.log('\n── ' + t + ' ──');

(async () => {
  const srv = http.createServer((rq, rs) => {
    let r = decodeURIComponent(rq.url.split('?')[0]);
    if (r === '/' || r === '/demo' || r === '/app') r = '/index.html';   // mirrors vercel.json
    fs.readFile(path.join(ROOT, r), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium',
                                             headless: true, args: ['--no-sandbox'] });

  // Every request the page attempts, recorded. Nothing is stubbed out, because
  // stubbing is exactly how you stop seeing the call you are testing for.
  const offsite = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const p = await ctx.newPage();
    p.on('request', r => {
      const u = r.url();
      if (!u.startsWith(`http://127.0.0.1:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:')) offsite.push(u);
    });
    // Third-party libraries the shell loads are irrelevant to the claim and
    // would otherwise need real internet; they are served empty, and still
    // recorded above so the assertion sees them.
    for (const g of ['**cdnjs**', '**jsdelivr**']) await p.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
    await p.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    return p;
  };

  const boot = async (p, route) => {
    await p.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5200);
  };

  // ══ A · no authentication ═════════════════════════════════════════════════
  sec('A · it boots with no account');
  const p = await newPage();
  await boot(p, '/demo');
  const A = await p.evaluate(() => {
    const login = document.getElementById('loginScreen');
    const app   = document.getElementById('appContent');
    const land  = document.getElementById('msLanding');
    return {
      loginShown: !!login && getComputedStyle(login).display !== 'none',
      appShown:   !!app   && getComputedStyle(app).display   !== 'none',
      landingShown: !!land && land.classList.contains('msl-on'),
      hasToken: Object.keys(localStorage).some(k => /supabase|sb-|auth-token/i.test(k)),
      cookies: document.cookie || '',
    };
  });
  yes(!A.loginShown, 'no sign-in screen — a judge is never asked for an account', JSON.stringify(A));
  yes(A.appShown, 'the product shell is up', JSON.stringify(A));
  yes(!A.landingShown, 'the pre-login landing overlay never mounts');
  yes(!A.hasToken, 'no Supabase session token is stored', JSON.stringify(Object.keys(A)));
  yes(!/sb-|supabase/i.test(A.cookies), 'no auth cookie is set', A.cookies);

  // ══ B · nothing reaches a backend ═════════════════════════════════════════
  sec('B · zero Supabase, database or API requests');
  const supa = offsite.filter(u => /supabase\.(co|in)/i.test(u));
  const api  = offsite.filter(u => /\/api\//i.test(u));
  yes(supa.length === 0, 'no request to Supabase', supa.join('\n      '));
  yes(api.length === 0, 'no request to /api', api.join('\n      '));
  // The stand-in must be what the app is holding, not merely present.
  // Awaited INSIDE the page: a Promise handed back through evaluate() serializes
  // to {}, which compared unequal to everything and said nothing either way.
  const B = await p.evaluate(async () => ({
    standInInstalled: !!(window.__MS_DEMO && window.__MS_DEMO.readOnly),
    blocked: await fetch('/api/cam-reconciliations').then(r => r.status).catch(() => 'threw'),
  }));
  yes(B.standInInstalled, 'the in-memory stand-in is the client the app is using');
  yes(B.blocked === 503, 'a direct /api call from the page is refused locally, not forwarded', String(B.blocked));

  // ══ C · opens in Cascade Commons ══════════════════════════════════════════
  sec('C · it opens directly in Cascade Commons');
  const C = await p.evaluate(() => {
    const cur = (typeof currentProperty === 'function' && currentProperty()) || null;
    return { name: cur && cur.name, workflowUp: !!document.getElementById('mainWorkflow'),
             heading: (document.body.innerText.match(/Cascade Commons/) || [])[0] || null };
  });
  yes(C.name === 'Cascade Commons', 'the open property is Cascade Commons — no portfolio detour', JSON.stringify(C));
  yes(!!C.heading, 'and its name is on screen');

  // ══ D · the current seed, not an old one ══════════════════════════════════
  sec('D · the data is the v9 seed a signed-in user would get');
  const D = await p.evaluate(async () => {
    const cur = currentProperty();
    const inv = cur.invoices || [];
    if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 700));
    if (typeof runAllocation === 'function') await runAllocation();
    await new Promise(r => setTimeout(r, 2600));
    const body = (document.getElementById('camWorkflow') || document.body).innerText;
    return {
      version: cur._demoV,
      invoices: inv.length,
      documented: inv.filter(i => i && (i.fileUrl || i.fileName)).length,
      billable: (body.match(/\d+ of \d+ billable/) || [])[0] || null,
      missingDocs: /invoices missing source document/.test(body),
      wholeHealth: (body.match(/\$34,650\.00/) || [])[0] || null,
    };
  });
  yes(String(D.version) === '9', 'seed version 9', String(D.version));
  yes(D.invoices === 26 && D.documented === 26, 'all 26 invoices carry a source document', JSON.stringify(D));
  yes(D.billable === '3 of 5 billable', 'the reconciliation reports 3 of 5 billable', String(D.billable));
  yes(!D.missingDocs, 'the missing-source-document finding is not raised');
  yes(D.wholeHealth === '$34,650.00', 'Whole Health Market is billable at its capped $34,650.00', String(D.wholeHealth));

  // ══ E · writes cannot persist ═════════════════════════════════════════════
  sec('E · a write cannot outlive the tab');
  const E1 = await p.evaluate(async () => {
    const cur = currentProperty();
    cur.name = 'TAMPERED BY TEST';
    (cur.invoices || []).splice(0, 5);
    try { if (typeof saveProperty === 'function') await saveProperty(cur); } catch (_) {}
    await new Promise(r => setTimeout(r, 600));
    return { storageKeys: Object.keys(localStorage).length, idb: typeof indexedDB !== 'undefined' };
  });
  await boot(p, '/demo');   // reload — the only state that could survive is persisted state
  const E2 = await p.evaluate(() => {
    const cur = (typeof currentProperty === 'function' && currentProperty()) || {};
    return { name: cur.name, invoices: (cur.invoices || []).length };
  });
  yes(E2.name === 'Cascade Commons', 'after a reload the property name is back to the seed', String(E2.name));
  yes(E2.invoices === 26, 'and all 26 invoices are back', String(E2.invoices));
  const persisted = await p.evaluate(() => Object.keys(localStorage).filter(k => /prop|demo|mainstreet|__mockdb/i.test(k)));
  yes(persisted.length === 0, 'nothing about the demo was written to localStorage', persisted.join(', '));
  // And no write reached anything off-page during all of that.
  yes(offsite.filter(u => /supabase\.(co|in)|\/api\//i.test(u)).length === 0,
      'still zero backend requests after attempting to write', offsite.filter(u => /supabase|\/api\//.test(u)).join(' '));

  // ══ F · it says what it is ════════════════════════════════════════════════
  sec('F · the demo declares itself');
  const F = await p.evaluate(() => {
    const b = document.getElementById('msDemoBanner');
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return {
      text: b ? b.innerText.replace(/\s+/g, ' ').trim() : null,
      fixed: b ? getComputedStyle(b).position : null,
      fileInputs: fileInputs.length,
      fileInputsDisabled: fileInputs.filter(i => i.disabled).length,
    };
  });
  yes(/Demo Environment/i.test(F.text || ''), 'the banner names it a demo environment', String(F.text));
  yes(/Read-only/i.test(F.text || ''), 'and says read-only', String(F.text));
  yes(/Demonstration Data/i.test(F.text || ''), 'and says demonstration data', String(F.text));
  yes(F.fixed === 'fixed', 'the banner is pinned, not scrolled away', String(F.fixed));
  yes(F.fileInputs === 0 || F.fileInputsDisabled === F.fileInputs,
      'every file input is disabled', `${F.fileInputsDisabled} of ${F.fileInputs}`);

  // ══ G · inert elsewhere ═══════════════════════════════════════════════════
  sec('G · the rest of the app is untouched by its presence');
  const q = await newPage();
  await q.goto(`http://127.0.0.1:${PORT}/app`, { waitUntil: 'domcontentloaded' });
  await q.waitForTimeout(2200);
  const G = await q.evaluate(() => ({
    standIn: !!(window.__MS_DEMO),
    banner: !!document.getElementById('msDemoBanner'),
  }));
  yes(!G.standIn, 'on /app the demo store does not install itself');
  yes(!G.banner, 'on /app there is no demo banner');

  await browser.close(); srv.close();
  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE FAILED', e); process.exit(2); });
