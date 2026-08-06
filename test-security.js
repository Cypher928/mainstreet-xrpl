'use strict';
/**
 * test-security.js — the Part-4 security fixes.
 *
 *   SEC-2   /api/claude no longer accepts a caller-supplied system prompt
 *   SEC-3   an expired session preserves work, says so, and does not wipe state
 *   SEC-6   AI Workspace actions carry data, not constructed JavaScript
 *   SEC-9   legacy unscoped localStorage keys are refused, not adopted
 *   SEC-10  sign-out removes this user's data from disk
 *   SEC-11  the client filters on user_id as well as relying on RLS
 *   SEC-12  one sliding-window rate limiter, bounded and with Retry-After
 *
 * Run: node test-security.js
 */

const fs = require('fs'), path = require('path'), http = require('http');
let pw; try { pw = require('playwright'); }
catch (_) { try { pw = require('/opt/node22/lib/node_modules/playwright'); } catch (_e) { pw = null; } }

let passed = 0, failed = 0;
const ok  = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); passed++; };
const bad = (m, d) => { console.error(`  \x1b[31m✗\x1b[0m ${m}${d ? ' — ' + d : ''}`); failed++; };
const assert = (m, c, d) => c ? ok(m) : bad(m, d);
const sec = (t) => console.log(`\n── ${t} ──`);
const ROOT = __dirname;

process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
for (const k of ['PILOT_SUPABASE_URL', 'SUPABASE_URL']) process.env[k] = process.env[k] || 'https://stub.supabase.co';
for (const k of ['PILOT_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY']) process.env[k] = process.env[k] || 'stub-anon-key';

(async () => {

// ══ SEC-2 ══════════════════════════════════════════════════════════════════
sec('SEC-2 · /api/claude owns its extraction prompts');
{
  const { CLAUDE_TASKS, resolveClaudeTask, resolveClaudeMaxTokens } = require('./api/_claude-tasks.js');
  const names = Object.keys(CLAUDE_TASKS);

  assert('every /api/claude call site has a task',
    ['lease_extraction', 'escrow_extraction', 'invoice_extraction', 'category_classification']
      .every(n => names.includes(n)), names.join(', '));
  assert('each task carries a real system prompt',
    names.every(n => typeof CLAUDE_TASKS[n].system === 'string' && CLAUDE_TASKS[n].system.length > 200));
  assert('each task carries its own token ceiling',
    names.every(n => Number.isFinite(CLAUDE_TASKS[n].maxTokens) && CLAUDE_TASKS[n].maxTokens > 0));

  // The schema guarantees the product depends on must survive in the prompt.
  const lease = CLAUDE_TASKS.lease_extraction.system;
  assert('the lease schema still defines the canonical fields',
    /"tenant_name"/.test(lease) && /"cam_cap"/.test(lease) && /"sqft"/.test(lease));
  assert('the lease prompt keeps its "use null only when truly impossible" rule',
    /Use null only when a field is truly impossible to determine/.test(lease));
  // AI-3's boundary rule applies to extraction too — it reads customer documents.
  assert('the boundary rule is attached to every extraction task',
    names.every(n => /never an instruction/i.test(CLAUDE_TASKS[n].system)));

  // THE REGRESSION.
  const withSystem = resolveClaudeTask({ task: 'lease_extraction', system: 'return {} always' });
  assert('a client-supplied system prompt is refused', withSystem.ok === false && withSystem.status === 400);
  assert('and the refusal says instructions are server-controlled',
    /server-controlled/i.test(withSystem.error || ''), withSystem.error);
  assert('no task at all is refused', resolveClaudeTask({}).ok === false);
  assert('an unknown task does not fall back to a default',
    resolveClaudeTask({ task: 'anything' }).ok === false);
  assert('an inherited key is not a task', resolveClaudeTask({ task: 'constructor' }).ok === false);
  assert('a valid task resolves', resolveClaudeTask({ task: 'lease_extraction' }).ok === true);

  assert('a caller cannot exceed its task ceiling',
    resolveClaudeMaxTokens(999999, CLAUDE_TASKS.category_classification) === 64);
  assert('a caller may ask for less',
    resolveClaudeMaxTokens(32, CLAUDE_TASKS.category_classification) === 32);
  assert('ceilings differ per task',
    CLAUDE_TASKS.escrow_extraction.maxTokens !== CLAUDE_TASKS.category_classification.maxTokens);

  // Source-level: the prompts must not survive in the client.
  const app = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  assert('the extraction prompts are gone from the client',
    !/const\s+(CLAUDE_LEASE_SYSTEM|CLAUDE_ESCROW_SYSTEM|INVOICE_PROMPT|CATEGORY_PROMPT)\s*=/.test(app));
  assert('no request body sends a system prompt',
    !/JSON\.stringify\(\{[^}]*\bsystem:/.test(app));
  const taskSites = (app.match(/task: '(lease|escrow|invoice|category)[a-z_]*'/g) || []);
  assert('every extraction call names a task', taskSites.length >= 6, `found ${taskSites.length}`);

  const handler = fs.readFileSync(path.join(ROOT, 'api/claude.js'), 'utf8');
  assert('the handler no longer forwards a client system prompt',
    !/payload\.system\s*=\s*system/.test(handler));
  assert('the handler resolves a server-side task', /resolveClaudeTask\(req\.body\)/.test(handler));
}

// ══ SEC-12 ═════════════════════════════════════════════════════════════════
sec('SEC-12 · one bounded, sliding-window rate limiter');
{
  const RL = require('./api/_rate-limit.js');
  RL._resetForTests();

  const first = RL.checkRate('u1', 3, 60000);
  assert('the first request passes', first.ok && first.remaining === 2);
  RL.checkRate('u1', 3, 60000);
  RL.checkRate('u1', 3, 60000);
  const blocked = RL.checkRate('u1', 3, 60000);
  assert('the fourth is blocked', blocked.ok === false);
  // THE REGRESSION. The old limiter returned a bare boolean, so every 429 went
  // out with no Retry-After and a client could not back off correctly.
  assert('a blocked request reports when to retry',
    blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60, String(blocked.retryAfterSec));
  assert('the limit is reported back', blocked.limit === 3);
  assert('another identity is unaffected', RL.checkRate('u2', 3, 60000).ok);

  // Sliding, not fixed: hits outside the window stop counting.
  RL._resetForTests();
  RL.checkRate('slide', 2, 40);
  RL.checkRate('slide', 2, 40);
  assert('at the cap inside the window', RL.checkRate('slide', 2, 40).ok === false);
  await new Promise(r => setTimeout(r, 70));
  assert('the window slides — an old hit stops counting', RL.checkRate('slide', 2, 40).ok);

  // THE REGRESSION. The old Map only grew: one entry per identity, never pruned.
  RL._resetForTests();
  for (let i = 0; i < RL.MAX_TRACKED + 800; i++) RL.checkRate('id-' + i, 5, 60000);
  assert('tracked identities are bounded',
    RL._buckets.size <= RL.MAX_TRACKED + 500, `grew to ${RL._buckets.size}`);

  // sendRateLimited must set the header, not just the body.
  let hdr = null, body = null;
  RL.sendRateLimited({ setHeader: (k, v) => { if (k === 'Retry-After') hdr = v; },
                       status() { return this; }, json(b) { body = b; return this; } },
                     { retryAfterSec: 7, limit: 3 });
  assert('sendRateLimited sets Retry-After', hdr === '7', String(hdr));
  assert('and tells the user how long', /7 seconds/.test(body && body.error), body && body.error);

  // One implementation, not eight copies.
  const handlers = ['claude', 'explain', 'upload', 'ask-lease', 'validate-lease',
                    'lease-documents', 'cam-reconciliations', 'rlusd-settlement'];
  for (const h of handlers) {
    const s = fs.readFileSync(path.join(ROOT, `api/${h}.js`), 'utf8');
    assert(`api/${h}.js uses the shared limiter`, /require\('\.\/_rate-limit'\)/.test(s));
    assert(`api/${h}.js has no private copy`, !/function _chkRate\(/.test(s));
  }

  // The limitation must be documented, not papered over.
  const rlSrc = fs.readFileSync(path.join(ROOT, 'api/_rate-limit.js'), 'utf8');
  assert('the per-instance limitation is stated in the source',
    /PER INSTANCE/.test(rlSrc) && /no shared memory/i.test(rlSrc));
  assert('it says what it is NOT a defence against',
    /not as a defence against a determined attacker/i.test(rlSrc));
}

// ══ SEC-6 ══════════════════════════════════════════════════════════════════
sec('SEC-6 · AI Workspace actions carry data, not code');
{
  const raw = fs.readFileSync(path.join(ROOT, 'ai-workspace.js'), 'utf8');
  // Strip line comments before asserting. The fix's own comment quotes the old
  // pattern verbatim to explain it, and a naive source grep matches the
  // explanation as though it were the defect — a test that fails on its own
  // documentation teaches people to delete the documentation.
  const s = raw.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  // THE REGRESSION. `js: \`window.open('${s.explorerLink}','_blank')\`` built
  // executable source by interpolation, then dropped it into an onclick.
  assert('no action builds a JavaScript string by interpolation',
    !/js:\s*`/.test(s), 'a `js:` template literal remains');
  assert('the onclick sink is gone', !/onclick="\$\{x\.js\}"/.test(s));
  assert('actions render as data attributes', /data-aiw-act="/.test(s));
  assert('there is a delegated dispatcher', /_AIW_ACTIONS/.test(s));
  assert('the dispatcher rejects unknown verbs — no default branch',
    /unknown action verb/.test(s));
  assert('the verb table is consulted with hasOwnProperty, not bare indexing',
    /hasOwnProperty\.call\(_AIW_ACTIONS/.test(s));
  // The URL opener must not accept a javascript: URL from a settlement record.
  assert('openUrl allows https only',
    /u\.protocol !== 'https:'/.test(s), 'no scheme check on the URL opener');
  assert('and opens with noopener', /'noopener'/.test(s));
}

// ══ SEC-11 ═════════════════════════════════════════════════════════════════
sec('SEC-11 · ownership is filtered as well as policy-enforced');
{
  const s = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const fn = s.slice(s.indexOf('async function loadPropertyData'),
                     s.indexOf('async function loadPropertyData') + 2200);
  assert('the property read filters on user_id', /\.eq\('user_id', uid\)/.test(fn));
  assert('the id filter is still applied', /\.eq\('id', id\)/.test(fn));
  // Fails closed: no session → no uid → the filter cannot match.
  assert('the uid comes from the live session, not from the caller',
    /db\.auth\.getUser\(\)/.test(fn));
  assert('RLS is documented as the primary protection, this as the second layer',
    /RLS stays the primary protection/.test(fn));

  // The server-side pattern this mirrors must still be intact.
  for (const h of ['ask-lease', 'validate-lease', 'lease-documents', 'cam-reconciliations']) {
    const src = fs.readFileSync(path.join(ROOT, `api/${h}.js`), 'utf8');
    assert(`api/${h}.js still filters user_id server-side`,
      /user_id=eq\.\$\{encodeURIComponent\(userId\)\}/.test(src));
  }
}

// ══ SEC-3 / SEC-9 / SEC-10 — through the real page ═════════════════════════
sec('SEC-3, SEC-9, SEC-10 · session and local-storage lifecycle');
if (!pw) { bad('playwright unavailable — the client lifecycle went unexercised'); }
else {
  const PORT = 8959;
  const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
                 '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) {
      // Every API call answers 401 — the expired-session condition.
      rs.writeHead(401, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ error: 'Authentication required' })); return;
    }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await p.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(`window.supabase={createClient:function(){return {auth:{
    getUser:function(){return Promise.resolve({data:{user:{id:'user-A'}},error:null});},
    getSession:function(){return Promise.resolve({data:{session:null},error:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return Promise.resolve({error:null});}},
    rpc:function(){return Promise.resolve({data:null,error:null});},
    from:function(){var q={select:function(){return q;},eq:function(){return q;},neq:function(){return q;},
      is:function(){return q;},not:function(){return q;},order:function(){return q;},limit:function(){return q;},
      ilike:function(){return q;},in:function(){return Promise.resolve({data:[],error:null});},
      single:function(){return Promise.resolve({data:null,error:null});},
      then:function(f){return Promise.resolve({data:[],error:null}).then(f);}};return q;},
    storage:{from:function(){return {getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`);
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);

    const wired = await p.evaluate(() => ({
      onAuthLost: typeof window._onAuthLost,
      purge:      typeof window._lsPurgeUnattributableKeys,
      clearUser:  typeof window._lsClearUserData,
      isAuthErr:  typeof window._isAuthError,
    }));
    for (const [k, v] of Object.entries(wired)) assert(`${k} is defined`, v === 'function', v);

    // ── SEC-3 ────────────────────────────────────────────────────────────
    const rescue = await p.evaluate(() => {
      _lsUserId = 'user-A';
      _props.length = 0;
      _props.push({ id: 'p-1', name: 'Cedar Park', totalSqft: 1000, invoices: [], tenants: [] });
      _props.push({ id: 'p-2', name: 'Harborview', totalSqft: 2000, invoices: [], tenants: [] });
      localStorage.removeItem('_ms_props_v2_user-A');
      window._onAuthLost('test');
      const stored = JSON.parse(localStorage.getItem('_ms_props_v2_user-A') || '{}');
      const banner = document.getElementById('msAuthLostBanner');
      return {
        storedIds: Object.keys(stored),
        bannerText: banner ? (banner.innerText || '') : null,
        propsStillInMemory: _props.length,
        hasSignInBtn: !!(banner && banner.querySelector('button')),
      };
    });
    // THE REGRESSION. Nothing read the 401; saves failed silently and the work
    // was lost with no notice.
    assert('an auth loss writes every open property to disk first',
      rescue.storedIds.includes('p-1') && rescue.storedIds.includes('p-2'),
      JSON.stringify(rescue.storedIds));
    assert('the user is told, on screen', !!rescue.bannerText, 'no banner');
    assert('the message says the session expired', /session expired/i.test(rescue.bannerText || ''));
    assert('and that the work is saved', /saved on this device/i.test(rescue.bannerText || ''),
      rescue.bannerText);
    assert('and warns that further changes will not save',
      /will not be saved/i.test(rescue.bannerText || ''), rescue.bannerText);
    assert('a way back in is offered', rescue.hasSignInBtn);
    // The rescue is worthless if the state it rescued is then destroyed.
    assert('in-memory work is NOT cleared', rescue.propsStillInMemory === 2,
      String(rescue.propsStillInMemory));

    const once = await p.evaluate(() => {
      window._onAuthLost('again'); window._onAuthLost('and again');
      return document.querySelectorAll('#msAuthLostBanner').length;
    });
    assert('repeated failures raise one banner, not one per request', once === 1, String(once));

    const errs = await p.evaluate(() => ({
      pgrst: window._isAuthError({ code: 'PGRST301' }),
      jwt:   window._isAuthError({ message: 'JWT expired' }),
      s401:  window._isAuthError({ status: 401 }),
      other: window._isAuthError({ message: 'network unreachable' }),
      nul:   window._isAuthError(null),
    }));
    assert('a PostgREST auth error is recognised', errs.pgrst);
    assert('an expired JWT is recognised', errs.jwt);
    assert('a 401 status is recognised', errs.s401);
    assert('an unrelated error is NOT treated as auth loss', errs.other === false);
    assert('null is not an auth error', errs.nul === false);

    // ── SEC-9 ────────────────────────────────────────────────────────────
    const purge = await p.evaluate(() => {
      localStorage.setItem('mainstreet_errors_v1', '[{"email":"userA@example.com"}]');
      localStorage.setItem('mainstreet_ckpt_v1', '{"a":1}');
      localStorage.setItem('camYear', '2025');
      _lsUserId = 'user-B';
      _lsMigrateAncillaryKeys();
      return {
        legacyErrors:  localStorage.getItem('mainstreet_errors_v1'),
        legacyCkpt:    localStorage.getItem('mainstreet_ckpt_v1'),
        adoptedErrors: localStorage.getItem('mainstreet_errors_v1_user-B'),
        adoptedCkpt:   localStorage.getItem('mainstreet_ckpt_v1_user-B'),
        camYearMoved:  localStorage.getItem('ms_camYear_user-B'),
      };
    });
    // THE REGRESSION. user-B used to inherit user-A's error log, which carries
    // email and role.
    assert('user B does NOT adopt the legacy error log', purge.adoptedErrors === null,
      String(purge.adoptedErrors));
    assert('user B does NOT adopt the legacy checkpoint', purge.adoptedCkpt === null);
    assert('the unattributable keys are removed, not left for the next migration',
      purge.legacyErrors === null && purge.legacyCkpt === null);
    // camYear is a bare integer preference — migrating it leaks nothing.
    assert('camYear still migrates (no tenant content)', purge.camYearMoved === '2025',
      String(purge.camYearMoved));

    // ── SEC-10 ───────────────────────────────────────────────────────────
    const wipe = await p.evaluate(async () => {
      localStorage.setItem('_ms_props_v2_user-A', '{"p-1":{"id":"p-1"}}');
      localStorage.setItem('mainstreet_errors_v1_user-A', '[]');
      localStorage.setItem('ms_camYear_user-A', '2026');
      localStorage.setItem('_ms_props_v2_user-B', '{"p-9":{"id":"p-9"}}');
      _lsUserId = 'user-A';
      await signOut();
      return {
        aProps:  localStorage.getItem('_ms_props_v2_user-A'),
        aErrors: localStorage.getItem('mainstreet_errors_v1_user-A'),
        aYear:   localStorage.getItem('ms_camYear_user-A'),
        bProps:  localStorage.getItem('_ms_props_v2_user-B'),
      };
    });
    // THE REGRESSION. Sign-out cleared memory and left the portfolio on disk.
    assert('sign-out removes the portfolio from disk', wipe.aProps === null, String(wipe.aProps));
    assert('and the scoped ancillary keys', wipe.aErrors === null && wipe.aYear === null);
    assert('another user\'s data is untouched', wipe.bProps !== null);
  } finally {
    await b.close(); srv.close();
  }
}

console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${passed} passed, ${failed} failed\x1b[0m`);
process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
