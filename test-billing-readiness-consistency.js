'use strict';
/**
 * test-billing-readiness-consistency.js — one billing verdict, wherever it is
 * printed.
 *
 *   node test-billing-readiness-consistency.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * On the Cascade Commons demo, the CAM tab said this about every tenant:
 *
 *     Whole Health Market  9,200  35.38%  −$31,979.23  $34,650.00  Blocked · property
 *     … and the same for the other four, under "⛔ Not ready to bill"
 *
 * while each tenant's own Space — the screen a manager opens to ask "can I bill
 * this tenant?" — said, in its financial tile:
 *
 *     $34,650 Allocated    $0 Variance    Ready Status
 *
 * Five tenants, one reconciliation, two opposite answers, and the optimistic one
 * on the surface a manager reaches first. Acting on it means issuing a statement
 * the product elsewhere refuses to issue.
 *
 * ROOT CAUSE — tenant-space.js:
 *
 *     var status = (cr.status === 'needs review') ? 'Needs review' : 'Ready';
 *
 * `cr.status` is the CALCULATION status. Its value on all five tenants is
 * 'calculated'. Anything not literally the string 'needs review' rendered as
 * "Ready", so the tile never consulted billing readiness at all. THE DANGEROUS
 * CASE IS PINNED IN SECTION C: calculated + authoritatively blocked must read
 * blocked.
 *
 * THE SECOND HALF, on the lease-intake screen:
 *
 *     5 TOTAL TENANTS    5 READY    3 EXPIRING ≤12 MO
 *     … directly above …
 *     ⚠️ Harbor Nail & Beauty Studio … ⚠ Needs Review
 *
 * The tile counted the raw `t._needsReview` extraction flag; the row badge read
 * the DERIVED ReviewEngine state. Harbor is needs_review because it is an NNN
 * lease with no cap percentage — derived, with the raw flag false.
 *
 * WHAT THIS SUITE REFUSES TO DO
 *
 * It does not assert that strings exist in a source file. Both decisions are
 * CALLED, with injected authorities, and their answers compared — sections A–D.
 * Sections E–G open the real app and compare what the CAM table and the Space
 * actually render, character for character, for the same tenant.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { fnSource } = require('./test-support/fn-source');

const ROOT = __dirname;
const PORT = parseInt(process.env.BRC_PORT || '8974', 10);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let passed = 0, failed = 0;
const failures = [];
function is(cond, label, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; failures.push(label); console.log('  ✗ ' + label + (detail != null ? '\n      ' + detail : '')); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  is(a === e, label, a === e ? null : 'expected ' + e + '\n      actual   ' + a);
}
function S(t) { console.log('\n\x1b[35m' + t + '\x1b[0m'); }

// ── Load both decisions and CALL them ────────────────────────────────────────
const TS_SRC = fs.readFileSync(path.join(ROOT, 'tenant-space.js'), 'utf8');
const SC_SRC = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

function pick(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(name + ' not found');
  return fnSource('\n' + src.slice(at), name);
}

// billingStatusLabel closes over its UNKNOWN constant — take it from the file so
// a passing test cannot be passing against a word this suite invented.
const UNKNOWN_DECL = (TS_SRC.match(/var BILLING_STATUS_UNKNOWN = '[^']*';/) || [])[0];
if (!UNKNOWN_DECL) throw new Error('BILLING_STATUS_UNKNOWN not found in tenant-space.js');
const UNKNOWN = UNKNOWN_DECL.match(/'([^']*)'/)[1];

const billingStatusLabel = new Function(
  UNKNOWN_DECL + '\n' + pick(TS_SRC, 'billingStatusLabel') + '\nreturn billingStatusLabel;')();
const leaseIntakeTally = new Function(
  pick(SC_SRC, '_leaseIntakeTally') + '\nreturn _leaseIntakeTally;')();

const verdict = (label, state) => () => ({ label, state, reason: 'fixture' });

S('A. billingStatusLabel prints the authority\'s verdict, not its own');
{
  eq(billingStatusLabel('Acme', { billingStateOf: verdict('Billable', 'billable') }), 'Billable',
    'a tenant the authority clears reads Billable');
  eq(billingStatusLabel('Acme', { billingStateOf: verdict('Blocked · property', 'blocked') }),
    'Blocked · property', 'a tenant blocked property-wide reads Blocked · property');
  eq(billingStatusLabel('Acme', { billingStateOf: verdict('Blocked', 'blocked') }), 'Blocked',
    'a tenant blocked on its own reads Blocked');
  eq(billingStatusLabel('Acme', { billingStateOf: verdict('Needs confirmation', 'confirm') }),
    'Needs confirmation', 'a tenant needing confirmation says so — it is neither ready nor blocked');
  eq(billingStatusLabel('Acme', { billingStateOf: verdict('Billable · part period', 'billable') }),
    'Billable · part period', 'the authority\'s qualifier is carried through verbatim');

  // The label is RELAYED, never re-derived: a verdict this suite invents comes
  // back unchanged, which is only possible if nothing here re-interprets it.
  eq(billingStatusLabel('Acme', { billingStateOf: verdict('Anything At All', 'x') }), 'Anything At All',
    'the label is relayed, not re-interpreted');

  // And the tenant it asks about is the tenant it was given.
  let sawName = null;
  billingStatusLabel('Summit Coffee & Provisions', {
    billingStateOf: (n) => { sawName = n; return { label: 'Billable', state: 'billable' }; } });
  eq(sawName, 'Summit Coffee & Provisions', 'the authority is asked about THIS tenant');
}

S('B. Unknown is never Ready');
{
  eq(billingStatusLabel('Acme', { billingStateOf: () => null }), UNKNOWN,
    'a null verdict reads Unknown');
  eq(billingStatusLabel('Acme', { billingStateOf: () => undefined }), UNKNOWN,
    'an undefined verdict reads Unknown');
  eq(billingStatusLabel('Acme', { billingStateOf: () => ({}) }), UNKNOWN,
    'a verdict with no label reads Unknown');
  eq(billingStatusLabel('Acme', { billingStateOf: () => ({ label: '' }) }), UNKNOWN,
    'an empty label reads Unknown');
  eq(billingStatusLabel('Acme', { billingStateOf: () => ({ label: 42 }) }), UNKNOWN,
    'a non-string label reads Unknown');
  eq(billingStatusLabel('Acme', { billingStateOf: () => { throw new Error('boom'); } }), UNKNOWN,
    'an authority that THROWS reads Unknown, and does not propagate');
  eq(billingStatusLabel('Acme', {}), UNKNOWN,
    'no authority available reads Unknown');
  eq(billingStatusLabel(null, { billingStateOf: verdict('Billable', 'billable') }), UNKNOWN,
    'no tenant name reads Unknown — a verdict about nobody is not a verdict');
  eq(billingStatusLabel('', { billingStateOf: verdict('Billable', 'billable') }), UNKNOWN,
    'an empty tenant name reads Unknown');

  is(billingStatusLabel('Acme', { billingStateOf: () => null }) !== 'Ready',
    'THE OLD DEFAULT IS GONE: nothing routes to "Ready" by falling through');
}

S('C. THE DANGEROUS CASE — calculated, but authoritatively blocked');
{
  // This is the exact shape the demo carries on all five tenants: the CAM
  // result's own status is 'calculated' (not 'needs review'), which the old
  // code turned into "Ready". The authority says blocked. Blocked wins.
  const camResult = { tenantName: 'Whole Health Market', status: 'calculated',
                      allocatedAmount: 34650, variance: 0 };
  const authority = (n) => n === camResult.tenantName
    ? { label: 'Blocked · property', state: 'blocked', reason: '1 property-level exception' }
    : null;

  const shown = billingStatusLabel(camResult.tenantName, { billingStateOf: authority });
  eq(shown, 'Blocked · property',
    'calculation status "calculated" + authority blocked → the Space reads Blocked · property');
  is(shown !== 'Ready', 'and it is NOT "Ready" — the defect, pinned');

  // The old rule, reproduced, to show the two genuinely disagree on this input.
  const oldRule = (camResult.status === 'needs review') ? 'Needs review' : 'Ready';
  eq(oldRule, 'Ready', 'the retired rule really did call this input Ready');
  is(oldRule !== shown, 'so this fixture would have passed silently before the change');

  // The mirror image: the authority clearing a tenant whose calc status is
  // 'needs review' must NOT be overridden back to blocked by the old string.
  const cleared = billingStatusLabel('Clean Co', { billingStateOf: verdict('Billable', 'billable') });
  eq(cleared, 'Billable', 'a cleared tenant reads Billable regardless of any calculation status');
}

S('D. The lease-intake tally reads the DERIVED review state');
{
  const T = (name, extra) => Object.assign({ tenant_name: name }, extra || {});
  const states = (m) => (t) => m[t.tenant_name];

  eq(leaseIntakeTally([T('a'), T('b')], { reviewStateOf: () => 'verified' }),
    { total: 2, pending: 0, failed: 0, needsAttn: 0, ready: 2 },
    'all verified → all ready');

  // The Harbor case: derived needs_review with the RAW flag false. The old
  // counter looked only at the raw flag and called this tenant ready.
  eq(leaseIntakeTally([T('a'), T('harbor', { _needsReview: false })],
      { reviewStateOf: states({ a: 'verified', harbor: 'needs_review' }) }),
    { total: 2, pending: 0, failed: 0, needsAttn: 1, ready: 1 },
    'DERIVED needs_review counts as attention even with the raw flag false');

  eq(leaseIntakeTally([T('a'), T('b')], { reviewStateOf: states({ a: 'verified', b: 'incomplete' }) }),
    { total: 2, pending: 0, failed: 0, needsAttn: 1, ready: 1 },
    'incomplete counts as attention');

  eq(leaseIntakeTally([T('a')], { reviewStateOf: () => 'manually_verified' }),
    { total: 1, pending: 0, failed: 0, needsAttn: 0, ready: 1 },
    'manually verified is ready');

  // The raw flag is no longer consulted: a tenant the ENGINE calls verified is
  // ready even carrying a stale raw flag, and vice versa.
  eq(leaseIntakeTally([T('a', { _needsReview: true })], { reviewStateOf: () => 'verified' }),
    { total: 1, pending: 0, failed: 0, needsAttn: 0, ready: 1 },
    'a stale raw _needsReview flag no longer creates phantom attention');

  // Double-counting guard: ReviewEngine reports a failed extraction as
  // 'incomplete'. Counting it in BOTH buckets would drive ready negative.
  eq(leaseIntakeTally([T('a', { extractionFailed: true }), T('b')],
      { reviewStateOf: states({ a: 'incomplete', b: 'verified' }) }),
    { total: 2, pending: 0, failed: 1, needsAttn: 0, ready: 1 },
    'a FAILED extraction is counted once, as failed — not also as attention');
  eq(leaseIntakeTally([T('a', { status: 'pending' }), T('b')],
      { reviewStateOf: states({ a: 'incomplete', b: 'verified' }) }),
    { total: 2, pending: 1, failed: 0, needsAttn: 0, ready: 1 },
    'a PENDING extraction is counted once, as pending');
  const mixed = leaseIntakeTally(
    [T('a', { extractionFailed: true }), T('b', { status: 'pending' }), T('c'), T('d')],
    { reviewStateOf: states({ a: 'incomplete', b: 'incomplete', c: 'needs_review', d: 'verified' }) });
  eq(mixed, { total: 4, pending: 1, failed: 1, needsAttn: 1, ready: 1 },
    'the four buckets partition the list exactly once each');
  is(mixed.pending + mixed.failed + mixed.needsAttn + mixed.ready === mixed.total,
    'and the buckets sum to the total — ready can never go negative');

  // Unknown is not clean, here either.
  eq(leaseIntakeTally([T('a')], { reviewStateOf: () => null }),
    { total: 1, pending: 0, failed: 0, needsAttn: 1, ready: 0 },
    'an unreadable review state counts as needing attention');
  eq(leaseIntakeTally([T('a')], { reviewStateOf: () => 'some_future_status' }),
    { total: 1, pending: 0, failed: 0, needsAttn: 0, ready: 1 },
    'an unrecognised status is not forced into attention — only the two the engine names are');

  eq(leaseIntakeTally([], { reviewStateOf: () => 'verified' }),
    { total: 0, pending: 0, failed: 0, needsAttn: 0, ready: 0 }, 'an empty list is zeroes');
  eq(leaseIntakeTally(null, { reviewStateOf: () => 'verified' }),
    { total: 0, pending: 0, failed: 0, needsAttn: 0, ready: 0 }, 'a missing list is not a crash');
  eq(leaseIntakeTally([null, undefined, T('a')], { reviewStateOf: () => 'verified' }),
    { total: 1, pending: 0, failed: 0, needsAttn: 0, ready: 1 }, 'holes are dropped, not counted');
}

// ── The live app ─────────────────────────────────────────────────────────────
let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
               '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
               '.pdf': 'application/pdf', '.woff2': 'font/woff2' };

const SUPABASE_MOCK = `
(function() {
  var _store = { properties: [], tenants: [] };
  var _user = { id: 'brc-user', email: 'brc@e2e-test.local' }, _session = null;
  function P(v) { return Promise.resolve(v); }
  function makeQ(t) {
    var f = {};
    function rows() { return (_store[t]||[]).filter(function(r){
      return Object.keys(f).every(function(k){ return r[k] === f[k]; }); }); }
    var q = {
      select: function(){ return q; }, eq: function(c,v){ f[c]=v; return q; },
      neq: function(){ return q; }, not: function(){ return q; }, is: function(){ return q; },
      in: function(){ return q; }, order: function(){ return q; }, limit: function(){ return q; },
      insert: function(rs){ var a = Array.isArray(rs)?rs:[rs];
        a.forEach(function(r){ if(!r.id) r.id='row-'+Math.random().toString(36).slice(2);
          if(_store[t]) _store[t].push(r); });
        var p = P({data:a,error:null});
        p.select = function(){ return { single: function(){ return P({data:a[0],error:null}); },
          then: function(fn){ return P({data:a,error:null}).then(fn); } }; };
        return p; },
      upsert: function(rs){ var a = Array.isArray(rs)?rs:[rs];
        a.forEach(function(r){ if(!r.id) r.id='row-'+Math.random().toString(36).slice(2);
          if(!_store[t]) _store[t]=[];
          var i=_store[t].findIndex(function(x){return x.id===r.id;});
          if(i>=0) _store[t][i]=r; else _store[t].push(r); });
        var p = P({data:a,error:null}); p.select=function(){ return P({data:a,error:null}); }; return p; },
      update: function(v){ rows().forEach(function(r){ Object.assign(r,v); });
        var p = P({data:null,error:null}); p.select=function(){return P({data:null,error:null});};
        p.eq=function(){return P({data:null,error:null});}; return p; },
      delete: function(){ return { eq:function(){return P({error:null});},
        in:function(){return P({error:null});}, neq:function(){return P({error:null});} }; },
      single: function(){ return P({data: rows()[0]||null, error:null}); },
      maybeSingle: function(){ return P({data: rows()[0]||null, error:null}); },
      then: function(fn){ return P({data: rows(), error:null}).then(fn); }
    };
    return q;
  }
  function sess(){ return { user:_user, access_token:'mock', expires_at:(Date.now()/1000)+3600 }; }
  window.supabase = { createClient: function(){ return {
    auth: {
      getUser: function(){ return P({data:{user:_session?_user:null},error:null}); },
      getSession: function(){ return P({data:{session:_session},error:null}); },
      refreshSession: function(){ return P({data:{session:_session},error:null}); },
      signUp: function(){ _session=sess(); return P({data:{session:_session,user:_user},error:null}); },
      signInWithPassword: function(){ _session=sess(); return P({data:{session:_session,user:_user},error:null}); },
      onAuthStateChange: function(){ return {data:{subscription:{unsubscribe:function(){}}}}; },
      signOut: function(){ _session=null; return P({error:null}); }
    },
    from: function(t){ if(!_store[t]) _store[t]=[]; return makeQ(t); },
    rpc: function(){ return P({data:null,error:null}); },
    storage: { from: function(){ return {
      upload: function(){ return P({data:{path:'mock'},error:null}); },
      createSignedUrl: function(){ return P({data:{signedUrl:'https://mock.local/x'},error:null}); },
      getPublicUrl: function(){ return {data:{publicUrl:''}}; } }; } }
  }; } };
})();`;

(async () => {
  const server = http.createServer((req, res) => {
    let r = decodeURIComponent(req.url.split('?')[0]);
    if (r === '/') r = '/index.html';
    fs.readFile(path.join(ROOT, r), (e, d) => {
      if (e) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  await new Promise((rs, rj) => { server.listen(PORT, '127.0.0.1', rs); server.on('error', rj); });

  const launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (fs.existsSync(CHROME)) launch.executablePath = CHROME;
  const browser = await pw.chromium.launch(launch);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String((e && e.message) || e).split('\n')[0]));

  try {
    await page.route('**/*', route => route.request().url().includes('127.0.0.1')
      ? route.continue()
      : route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* blocked */' }));
    await page.addInitScript(SUPABASE_MOCK);
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 60000 });

    // Enter through the landing hero so MainStreetLanding.hide() actually runs —
    // otherwise #msLanding stays mounted at z-index 99000 over the whole app.
    await page.waitForTimeout(1200);
    const heroUp = await page.evaluate(() => {
      const r = document.getElementById('msLanding');
      return !!(r && r.classList.contains('msl-on'));
    });
    if (heroUp) {
      await page.locator('#msLanding button, #msLanding a').filter({ hasText: /^Sign In$/ })
        .first().click({ timeout: 12000 });
      await page.waitForTimeout(800);
    }
    await page.waitForSelector('#loginEmail', { state: 'visible', timeout: 25000 });
    await page.fill('#loginEmail', 'brc@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.locator('#loginBtn').click({ timeout: 12000 });
    await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== '';
    }, null, { timeout: 45000 });

    await page.waitForSelector('.ptf-demo-card', { timeout: 20000 });
    await page.locator('.ptf-demo-card').filter({ hasText: 'Cascade Commons' })
      .first().locator('.ptf-card-open-btn').first().click({ timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Cascade Commons';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.switchWorkspaceTab && window.switchWorkspaceTab('cam'));
    await page.waitForTimeout(3000);

    S('E. The CAM table and the Space agree, tenant by tenant');
    const both = await page.evaluate(async () => {
      const p = window.currentProperty();
      const rows = {};
      document.querySelectorAll('.rcs-table tbody tr').forEach(tr => {
        const cells = [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim());
        if (cells.length) rows[cells[0]] = cells[cells.length - 1];
      });
      const out = [];
      for (const t of (p.tenants || [])) {
        window.TenantSpace.openSpace(t.id);
        await new Promise(r => setTimeout(r, 500));
        const cell = [...document.querySelectorAll('.ts-cam-cell')]
          .find(c => (c.querySelector('.ts-cam-l') || {}).textContent === 'Status');
        const spaceStatus = cell ? (cell.querySelector('.ts-cam-v') || {}).textContent.trim() : null;
        window.TenantSpace.closeSpace();
        await new Promise(r => setTimeout(r, 200));
        out.push({ name: t.tenant_name, camTable: rows[t.tenant_name] || null, space: spaceStatus });
      }
      return out;
    });
    both.forEach(r => {
      is(r.camTable != null && r.space != null && r.camTable === r.space,
        `${r.name}: CAM table and Space print the same verdict`,
        `CAM "${r.camTable}" vs Space "${r.space}"`);
    });
    is(both.length === 5, 'all five tenants were compared', 'got ' + both.length);
    is(both.every(r => r.space !== 'Ready'),
      'NO Space prints "Ready" on a reconciliation that cannot be billed',
      JSON.stringify(both.map(r => r.space)));
    is(both.every(r => /Blocked/.test(r.space)),
      'every Space reports the block the CAM screen reports',
      JSON.stringify(both.map(r => r.space)));

    S('F. The accessor is the authority, and is honest when it cannot answer');
    const acc = await page.evaluate(() => {
      const AX = window.AuditExposure;
      const exposure = AX.deriveExposure(buildAuditSummary(), (typeof lastTotal !== 'undefined' ? lastTotal : 0) || 0);
      const direct = {}, viaAccessor = {};
      (window.currentProperty().tenants || []).forEach(t => {
        direct[t.tenant_name] = _tenantBillingState(t.tenant_name, exposure).label;
        viaAccessor[t.tenant_name] = (window.tenantBillingState(t.tenant_name) || {}).label;
      });
      // With no results loaded the accessor must decline rather than guess.
      const saved = lastResults;
      // eslint-disable-next-line no-global-assign
      lastResults = [];
      const whenBlind = window.tenantBillingState('Whole Health Market');
      const labelWhenBlind = window.TenantSpace.billingStatusLabel('Whole Health Market');
      lastResults = saved;
      return { direct, viaAccessor, whenBlind, labelWhenBlind };
    });
    eq(acc.viaAccessor, acc.direct,
      'window.tenantBillingState returns exactly what _tenantBillingState returns');
    is(acc.whenBlind === null,
      'with no results loaded the accessor returns null — it declines rather than guessing',
      JSON.stringify(acc.whenBlind));
    is(acc.labelWhenBlind !== 'Ready',
      'and the Space label for that case is not "Ready"', String(acc.labelWhenBlind));
    eq(acc.labelWhenBlind, UNKNOWN, 'it is Unknown');

    // The accessor's OTHER two failure paths, forced rather than hoped for.
    // A guard nothing exercises is a guard nothing protects: both of these
    // survived mutation until they were driven directly.
    const forced = await page.evaluate(() => {
      const AX = window.AuditExposure;
      const realDerive = AX.deriveExposure;
      const out = {};
      AX.deriveExposure = function () { return null; };
      out.exposureNull = window.tenantBillingState('Whole Health Market');
      out.labelExposureNull = window.TenantSpace.billingStatusLabel('Whole Health Market');
      AX.deriveExposure = function () { throw new Error('audit module unavailable'); };
      out.derivationThrew = window.tenantBillingState('Whole Health Market');
      out.labelDerivationThrew = window.TenantSpace.billingStatusLabel('Whole Health Market');
      AX.deriveExposure = realDerive;
      out.restored = (window.tenantBillingState('Whole Health Market') || {}).label;
      return out;
    });
    is(forced.exposureNull === null,
      'an unusable exposure makes the accessor decline, not approve', JSON.stringify(forced.exposureNull));
    eq(forced.labelExposureNull, UNKNOWN, 'and the Space reads Unknown');
    is(forced.derivationThrew === null,
      'a THROWING audit module makes the accessor decline, not approve', JSON.stringify(forced.derivationThrew));
    eq(forced.labelDerivationThrew, UNKNOWN, 'and the Space reads Unknown there too');
    eq(forced.restored, 'Blocked · property', 'and the real verdict returns once the module does');

    // THE TENANT SCOPE IS PASSED THROUGH. On this demo a property-wide blocker
    // makes the tenant verdict and the property verdict read alike, so the only
    // way to see the difference is to watch the call itself.
    const scoped = await page.evaluate(() => {
      const AX = window.AuditExposure;
      const real = AX.billingReadiness;
      const seen = [];
      AX.billingReadiness = function (x, tenantName) {
        seen.push(arguments.length < 2 ? '(no second argument)'
                : tenantName === undefined ? '(undefined)' : tenantName);
        return real.apply(this, arguments);
      };
      try { window.tenantBillingState('FitZone Athletics'); } finally { AX.billingReadiness = real; }
      return seen;
    });
    is(scoped.indexOf('FitZone Athletics') !== -1,
      'the accessor asks billingReadiness about THAT tenant, not the property',
      JSON.stringify(scoped));

    // AND THE SPACE ASKS WITH THE CAM RESULT'S OWN KEY. rec.space.name is a
    // different string whenever a tenant has been renamed since the run, and it
    // falls back to the literal "Space" for an unnamed one — either way a
    // verdict about somebody else. Diverged in memory only, and restored.
    const keyed = await page.evaluate(async () => {
      const p = window.currentProperty();
      const t = (p.tenants || [])[0];
      const rr = (p.camReconciliation || {}).results || [];
      const cr = rr.find(r => r && r.tenantId === t.id);
      const realName = cr.tenantName, realAlt = cr.name;
      const realAccessor = window.tenantBillingState;
      const asked = [];
      window.tenantBillingState = function (n) { asked.push(n); return realAccessor.apply(this, arguments); };
      cr.tenantName = 'CAM-KEY-SENTINEL'; cr.name = 'CAM-KEY-SENTINEL';
      try {
        window.TenantSpace.openSpace(t.id);
        await new Promise(r => setTimeout(r, 600));
        window.TenantSpace.closeSpace();
      } finally {
        cr.tenantName = realName; cr.name = realAlt;
        window.tenantBillingState = realAccessor;
      }
      return { asked, spaceLabel: t.tenant_name, restoredTo: cr.tenantName };
    });
    is(keyed.asked.indexOf('CAM-KEY-SENTINEL') !== -1,
      'the Space looks the verdict up by the CAM RESULT\'s name — the key the CAM table uses',
      JSON.stringify(keyed.asked));
    is(keyed.asked.indexOf(keyed.spaceLabel) === -1,
      'and not by the space label, which drifts when a tenant is renamed',
      JSON.stringify(keyed.asked));
    eq(keyed.restoredTo, 'Whole Health Market', 'the fixture restored the record it borrowed');

    S('G. The lease-intake tile agrees with the row badges beneath it');
    await page.evaluate(() => window.switchWorkspaceTab && window.switchWorkspaceTab('spaces'));
    await page.waitForTimeout(2500);
    const intake = await page.evaluate(() => {
      const tiles = {};
      document.querySelectorAll('.prerecon-tile').forEach(e => {
        const v = e.querySelector('.prerecon-val'), l = e.querySelector('.prerecon-lbl');
        if (v && l) tiles[l.textContent.trim()] = parseInt(v.textContent.trim(), 10);
      });
      const badges = [...document.querySelectorAll('[id^="btr-"]')].map(e => {
        const t = (e.innerText || '').replace(/\s+/g, ' ');
        return /Needs Review/.test(t) ? 'needs' : 'ready';
      });
      return { tiles, badges,
               needsBadged: badges.filter(b => b === 'needs').length,
               readyBadged: badges.filter(b => b === 'ready').length };
    });
    is(intake.tiles['Ready'] === intake.readyBadged,
      'the READY tile equals the number of rows NOT badged Needs Review',
      `tile ${intake.tiles['Ready']} vs rows ${intake.readyBadged}`);
    is(intake.tiles['Needs Attention'] === intake.needsBadged,
      'the NEEDS ATTENTION tile equals the number of rows badged Needs Review',
      `tile ${intake.tiles['Needs Attention']} vs rows ${intake.needsBadged}`);
    is(intake.needsBadged === 1 && intake.tiles['Ready'] === 4,
      'on this demo that is 4 ready and 1 needing attention — not the old 5/0',
      JSON.stringify(intake));
    is(intake.tiles['Total Tenants'] === 5, 'and five tenants in total');

    S('H. The page loaded clean');
    is(pageErrors.length === 0, 'no uncaught page errors', pageErrors.slice(0, 5).join(' | '));
  } catch (e) {
    failed++; failures.push('harness: ' + (e && e.message));
    console.log('\n  ✗ HARNESS ERROR: ' + (e && e.stack));
  } finally {
    try { await browser.close(); } catch (_) {}
    try { server.close(); } catch (_) {}
  }

  console.log('\n' + '─'.repeat(72));
  console.log(failed === 0
    ? `\x1b[32m✓ ALL ${passed} ASSERTIONS PASSED\x1b[0m`
    : `\x1b[31m✗ ${failed} FAILED\x1b[0m (${passed} passed)\n  ` + failures.join('\n  '));
  process.exit(failed === 0 ? 0 : 1);
})();
