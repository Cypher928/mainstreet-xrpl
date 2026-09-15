'use strict';
/**
 * test-spaces-vocabulary.js — the Spaces tab must name one inventory, once.
 *
 *   node test-spaces-vocabulary.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * Opening the Spaces tab on the Cascade Commons demo, a manager saw the five
 * tenant spaces as cards:
 *
 *     📍 Whole Health Market            Open space →
 *     📍 Summit Coffee & Provisions     Open space →
 *     … three more
 *
 * and then, immediately below and without a word connecting the two, the SAME
 * five tenants again:
 *
 *     ② Lease Upload
 *       Extracted Tenants (5)
 *       Whole Health Market   [Edit] [View Lease] [Remove]
 *       … four more
 *
 * Two nouns for one set of things, two action sets, and nothing saying how they
 * relate or which one is authoritative. The manager has to work out unaided
 * that "Spaces" and "Extracted Tenants" are the same five tenants — and the
 * second list is the one with a Remove button on it.
 *
 * Three things were wrong, and each is fixed separately below:
 *
 *   FRAMING   The block is the INPUT — upload a lease and a space appears above
 *             — not a rival inventory. Its heading now says so.
 *
 *   NAMING    "Extracted Tenants (5)" competed with "Spaces" for the same job.
 *             It is now named after its SOURCE ("Leases from your uploads"),
 *             which is the one thing about it that is not also true of Spaces.
 *
 *   ORDINAL   The "2" badge was step two of a numbered setup flow retired from
 *             navigation. There is no 1 and no 3 on that screen. An ordinal
 *             with nothing to order is noise, and it is gone.
 *
 * AND THE BLOCK GETS OUT OF THE WAY — but only when there is nothing in it.
 *
 * WHAT THIS SUITE REFUSES TO DO
 *
 * It does not assert that strings exist in a source file. Four earlier slices
 * in this series proved that shape of assertion hollow: a mutant that flips a
 * condition to `false`, or reads the wrong bucket, leaves every string exactly
 * where it was and the suite passes. So:
 *
 *   · the collapse decision is CALLED, with injected review states, and its
 *     verdict compared — sections A and B;
 *   · reachability is measured on the LIVE PAGE by asking which controls the
 *     browser reports as visible before hiding and after re-opening, by
 *     identity — section E. Markup that exists inside a display:none ancestor
 *     counts as unreachable, which is the entire point;
 *   · the lease data is read back off the live demo property and compared
 *     field by field against a pinned expectation — section H.
 *
 * Sections A–C run headless in milliseconds. Sections D–I boot the real app
 * against a local server with an in-memory Supabase stand-in: no pilot data, no
 * production data, no network egress.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { fnSource } = require('./test-support/fn-source');

const ROOT = __dirname;
const PORT = parseInt(process.env.SV_PORT || '8973', 10);
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let passed = 0, failed = 0;
const failures = [];
function is(cond, label, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else {
    failed++; failures.push(label);
    console.log('  ✗ ' + label + (detail != null ? '\n      ' + detail : ''));
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  is(a === e, label, a === e ? null : 'expected ' + e + '\n      actual   ' + a);
}
function S(t) { console.log('\n\x1b[35m' + t + '\x1b[0m'); }

// ── Load the decision functions and CALL them ────────────────────────────────
const POS_SRC = fs.readFileSync(path.join(ROOT, 'property-os.js'), 'utf8');

// leaseBlockState closes over LEASE_BLOCK_READY_STATES, so the constant comes
// with it. Taking the constant from the file rather than restating it here
// means a test that "passes" cannot be passing against a list this suite
// invented.
const READY_DECL = (POS_SRC.match(/var LEASE_BLOCK_READY_STATES = \[[^\]]*\];/) || [])[0];
if (!READY_DECL) throw new Error('LEASE_BLOCK_READY_STATES not found in property-os.js');

// These live inside property-os.js's IIFE, so they are indented and fnSource's
// declaration match (which anchors to a line start) needs the leading run
// trimmed off. Slicing to the declaration does that without touching the shared
// extractor or reflowing the body.
function pick(name) {
  const at = POS_SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(name + ' not found in property-os.js');
  return fnSource('\n' + POS_SRC.slice(at), name);
}

const leaseBlockState = new Function(
  READY_DECL + '\n' + pick('leaseBlockState') + '\nreturn leaseBlockState;')();
const leaseSummaryLine = new Function(
  pick('leaseSummaryLine') + '\nreturn leaseSummaryLine;')();

// A tenant is just an object here: leaseBlockState never inspects one, it asks
// the injected reviewStateOf. That is the whole reason it takes the function.
const T = (n) => ({ tenant_name: n });
const stateMap = (m) => (t) => m[t.tenant_name];

S('A. leaseBlockState — when does the block get out of the way?');
{
  const allReady = leaseBlockState([T('a'), T('b')], { reviewStateOf: () => 'verified' });
  eq(allReady, { collapsed: true, reason: 'all_ready', needsAttention: 0, total: 2 },
    'every lease verified → collapsed');

  eq(leaseBlockState([T('a')], { reviewStateOf: () => 'manually_verified' }),
    { collapsed: true, reason: 'all_ready', needsAttention: 0, total: 1 },
    'a manually verified lease is ready too');

  eq(leaseBlockState([T('a'), T('b')], { reviewStateOf: stateMap({ a: 'verified', b: 'needs_review' }) }),
    { collapsed: false, reason: 'needs_attention', needsAttention: 1, total: 2 },
    'ONE lease needing review keeps the whole block open');

  eq(leaseBlockState([T('a'), T('b')], { reviewStateOf: stateMap({ a: 'verified', b: 'incomplete' }) }),
    { collapsed: false, reason: 'needs_attention', needsAttention: 1, total: 2 },
    'an incomplete lease keeps it open');

  eq(leaseBlockState([T('a'), T('b'), T('c')],
      { reviewStateOf: stateMap({ a: 'incomplete', b: 'needs_review', c: 'verified' }) }),
    { collapsed: false, reason: 'needs_attention', needsAttention: 2, total: 3 },
    'the count is of leases needing attention, not of leases');

  // Zero tenants is the case where the block IS the job.
  eq(leaseBlockState([], { reviewStateOf: () => 'verified' }),
    { collapsed: false, reason: 'no_tenants', needsAttention: 0, total: 0 },
    'no tenants → stays open, because uploading is the work');
  eq(leaseBlockState(null, { reviewStateOf: () => 'verified' }),
    { collapsed: false, reason: 'no_tenants', needsAttention: 0, total: 0 },
    'a missing tenants array is no tenants, not a crash');
  eq(leaseBlockState('not an array', { reviewStateOf: () => 'verified' }),
    { collapsed: false, reason: 'no_tenants', needsAttention: 0, total: 0 },
    'a non-array is no tenants');

  eq(leaseBlockState([null, undefined, T('a')], { reviewStateOf: () => 'verified' }),
    { collapsed: true, reason: 'all_ready', needsAttention: 0, total: 1 },
    'holes in the tenant array are dropped, not counted');
}

S('B. leaseBlockState — an unreadable state is not a clean state');
{
  // The failure mode this guards: readiness that cannot be determined getting
  // treated as readiness, and the block folding over work nobody has seen.
  eq(leaseBlockState([T('a')], { reviewStateOf: () => null }),
    { collapsed: false, reason: 'needs_attention', needsAttention: 1, total: 1 },
    'a null review state counts as needing attention');
  eq(leaseBlockState([T('a')], { reviewStateOf: () => undefined }),
    { collapsed: false, reason: 'needs_attention', needsAttention: 1, total: 1 },
    'an undefined review state counts as needing attention');
  eq(leaseBlockState([T('a')], { reviewStateOf: () => { throw new Error('boom'); } }),
    { collapsed: false, reason: 'needs_attention', needsAttention: 1, total: 1 },
    'a review state that THROWS counts as needing attention, and does not propagate');

  // The allowlist, not the complement of a blocklist. A status nobody has
  // taught this function about must land in "needs a look".
  eq(leaseBlockState([T('a')], { reviewStateOf: () => 'some_future_status' }),
    { collapsed: false, reason: 'needs_attention', needsAttention: 1, total: 1 },
    'an UNRECOGNISED status needs attention — ready is an allowlist');
  eq(leaseBlockState([T('a')], { reviewStateOf: () => '' }),
    { collapsed: false, reason: 'needs_attention', needsAttention: 1, total: 1 },
    'an empty-string status needs attention');

  // No way to ask at all: report it rather than claiming there is no work.
  // With no injected function and no window, this is the ReviewEngine-missing
  // path. needsAttention is null — the contract's "unknown", never 0.
  const blind = leaseBlockState([T('a'), T('b')], {});
  eq(blind, { collapsed: false, reason: 'review_state_unavailable', needsAttention: null, total: 2 },
    'no review engine → open, reason review_state_unavailable, needsAttention null');
  is(blind.needsAttention !== 0,
    'unknown readiness is reported as null, NOT as zero needing attention');
  is(blind.collapsed === false,
    'unknown readiness never collapses the block');

  // A non-function reviewStateOf is not a reviewStateOf.
  eq(leaseBlockState([T('a')], { reviewStateOf: 'verified' }).reason, 'review_state_unavailable',
    'a non-function reviewStateOf falls through to unavailable, it is not called');
}

S('C. leaseSummaryLine — the bar says what the state found');
{
  eq(leaseSummaryLine({ total: 0, needsAttention: 0 }), 'No leases uploaded yet',
    'nothing uploaded');
  eq(leaseSummaryLine({ total: 5, needsAttention: 0 }), '5 leases on file, all reviewed',
    'all clear names the total');
  eq(leaseSummaryLine({ total: 1, needsAttention: 0 }), '1 lease on file, all reviewed',
    'one lease, singular');
  eq(leaseSummaryLine({ total: 5, needsAttention: 1 }), '1 of 5 leases still needs a look',
    'one outstanding agrees with its verb');
  eq(leaseSummaryLine({ total: 5, needsAttention: 3 }), '3 of 5 leases still need a look',
    'three outstanding agrees with its verb');
  eq(leaseSummaryLine({ total: 1, needsAttention: 1 }), '1 of 1 lease still needs a look',
    'one of one');
  // The honesty case: readiness unknown must not read as "all reviewed".
  eq(leaseSummaryLine({ total: 5, needsAttention: null }), '5 leases on file · review status unavailable',
    'unknown readiness SAYS unknown');
  is(!/all reviewed/.test(leaseSummaryLine({ total: 5, needsAttention: null })),
    'unknown readiness never claims the leases were reviewed');
  eq(leaseSummaryLine({}), 'No leases uploaded yet', 'an empty state is not a crash');
  eq(leaseSummaryLine(null), 'No leases uploaded yet', 'a missing state is not a crash');
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
  var _user = { id: 'sv-user', email: 'sv@e2e-test.local' }, _session = null;
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
  await new Promise((r, j) => { server.listen(PORT, '127.0.0.1', r); server.on('error', j); });

  const launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (fs.existsSync(CHROME)) launch.executablePath = CHROME;
  const browser = await pw.chromium.launch(launch);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String((e && e.message) || e).split('\n')[0]));

  try {
    // No egress. Anything that is not the local server is answered locally, so
    // this suite cannot reach pilot or production even by accident.
    await page.route('**/*', route =>
      route.request().url().includes('127.0.0.1')
        ? route.continue()
        : route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* blocked */' }));
    await page.addInitScript(SUPABASE_MOCK);
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 60000 });

    await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: 60000 });
    await page.evaluate(() => {
      document.getElementById('loginEmail').value = 'sv@e2e-test.local';
      document.getElementById('loginPassword').value = 'TestPass123!';
      const b = document.getElementById('loginBtn'); b.disabled = false; b.click();
    });
    await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== '';
    }, null, { timeout: 45000 });

    // Open the app's own Cascade Commons demo, exactly as a manager would.
    await page.waitForSelector('.ptf-demo-card', { timeout: 20000 });
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.ptf-demo-card'))
        .find(c => c.innerText.includes('Cascade Commons'));
      const btn = card && card.querySelector('.ptf-card-open-btn');
      if (btn) btn.click();
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Cascade Commons';
    }, null, { timeout: 60000 });
    await page.evaluate(() => window.switchWorkspaceTab && window.switchWorkspaceTab('spaces'));
    await page.waitForTimeout(2500);

    S('D. The Spaces tab names one inventory');
    const seen = await page.evaluate(() => {
      const pane = document.getElementById('wsPane-spaces');
      const vis = e => e.offsetParent !== null;
      return {
        headings: Array.from(pane.querySelectorAll('h2,h3')).filter(vis)
          .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()),
        badges: Array.from(pane.querySelectorAll('.sec-num')).map(e => (e.textContent || '').trim()),
        text: pane.innerText,
        // The card's own heading and the collapsed bar are SEPARATE sources and
        // are read separately. An assertion that accepts either would pass with
        // one of them gutted — which is exactly what two mutants proved.
        cardHead: ((document.querySelector('#cardLeases .sec-head') || {}).innerText || '')
          .replace(/\s+/g, ' ').trim(),
        summaryText: (document.getElementById('posLeaseSummary') || {}).innerText || ''
      };
    });
    is(!/Extracted Tenants/.test(seen.text),
      '"Extracted Tenants" no longer appears anywhere on the Spaces tab',
      seen.text.split('\n').filter(l => /Extracted/.test(l)).join(' | '));
    is(seen.headings.some(h => /^Spaces$/.test(h)),
      'the Spaces list still heads the tab', seen.headings.join(' | '));
    is(seen.headings.some(h => /Leases from your uploads \(\d+\)/.test(h)),
      'the upload list is named after its source, not after tenants', seen.headings.join(' | '));
    is(!seen.badges.some(b => /^\d+$/.test(b)),
      'no bare ordinal badge survives on the Spaces tab', 'badges: ' + JSON.stringify(seen.badges));
    is(/spaces? above|becomes a space/i.test(seen.cardHead),
      'the CARD HEADING states the block feeds the Spaces above', JSON.stringify(seen.cardHead));
    is(!/^Lease Upload/.test(seen.cardHead),
      'the card is no longer headed as a bare upload step', JSON.stringify(seen.cardHead));
    is(/spaces? above|becomes a space/i.test(seen.summaryText),
      'the COLLAPSED BAR says the same thing, for the manager who never expands it',
      JSON.stringify(seen.summaryText));
    is(/1 of 5 leases still needs a look/.test(seen.summaryText),
      'the collapsed bar reports the demo\'s real readiness', JSON.stringify(seen.summaryText));

    S('E. Hiding the block and re-opening it loses no control');
    const reach = await page.evaluate(() => {
      const card = document.getElementById('cardLeases');
      const btn = () => document.getElementById('posLeaseToggle');
      // Reachable = the browser reports it laid out. Markup inside a
      // display:none ancestor has offsetParent null and does not count.
      const names = () => Array.from(card.querySelectorAll('button,input,select,textarea'))
        .filter(e => e.offsetParent !== null)
        .map(e => e.tagName + '#' + (e.id || '') + '#' +
          (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24));
      const before = names();
      btn().click();
      const whileHidden = { label: btn().textContent, count: names().length,
                            cardVisible: card.offsetParent !== null };
      btn().click();
      const after = names();
      return { before, whileHidden, after, label: btn().textContent,
               cardVisible: card.offsetParent !== null,
               missing: before.filter(n => after.indexOf(n) === -1),
               added: after.filter(n => before.indexOf(n) === -1) };
    });
    is(reach.before.length > 10,
      'the open block really does carry the controls (' + reach.before.length + ' reachable)');
    is(reach.whileHidden.cardVisible === false && reach.whileHidden.count === 0,
      'hiding the block makes its controls unreachable — so re-opening is a real test');
    eq(reach.whileHidden.label, 'Open', 'the button offers to Open while hidden');
    is(reach.cardVisible === true, 'clicking Open brings the block back');
    eq(reach.label, 'Hide', 'the button offers to Hide once open');
    eq(reach.missing, [], 'EVERY control reachable before hiding is reachable again after opening');
    eq(reach.added, [], 'and re-opening conjures no controls that were not there before');

    S('F. A collapsed block is still a navigation target');
    const nav = await page.evaluate(() => {
      const card = document.getElementById('cardLeases');
      const out = {};
      // Collapse it the way a ready property would arrive.
      window.PropertyOS.toggleLeaseBlock(false);
      out.hiddenFirst = card.offsetParent === null;
      out.opened = window.PropertyOS.revealForAnchor(['cardLeases', 'spacesSection']);
      out.visibleAfterReveal = card.offsetParent !== null;

      // An anchor that does not name it leaves it alone.
      window.PropertyOS.toggleLeaseBlock(false);
      out.untouched = window.PropertyOS.revealForAnchor(['spacesSection']);
      out.stillHidden = card.offsetParent === null;

      // The comma-separated form the KPI tiles use.
      out.openedByString = window.PropertyOS.revealForAnchor('cardLeases,spacesSection');
      out.visibleAfterString = card.offsetParent !== null;

      // Already open: nothing to do, and it says so.
      out.openedWhenAlreadyOpen = window.PropertyOS.revealForAnchor(['cardLeases']);

      // The real navigator, end to end, from a collapsed block.
      window.PropertyOS.toggleLeaseBlock(false);
      out.hiddenBeforeNav = card.offsetParent === null;
      return new Promise(resolve => {
        window._kpiTileNavigate('spaces', 'cardLeases,spacesSection');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          out.visibleAfterKpiNav = card.offsetParent !== null;
          resolve(out);
        }));
      });
    });
    is(nav.hiddenFirst, 'the block can be collapsed');
    eq(nav.opened, ['cardLeases'], 'revealForAnchor opens the collapsed card it was asked about');
    is(nav.visibleAfterReveal, 'and the card is visible afterwards');
    eq(nav.untouched, [], 'an anchor list that does not name it opens nothing');
    is(nav.stillHidden, 'and the card stays collapsed');
    eq(nav.openedByString, ['cardLeases'], 'the comma-separated anchor form works too');
    is(nav.visibleAfterString, 'and opens the card');
    eq(nav.openedWhenAlreadyOpen, [], 'revealing an already-open card is a no-op');
    is(nav.hiddenBeforeNav && nav.visibleAfterKpiNav,
      '_kpiTileNavigate reaches a COLLAPSED #cardLeases instead of falling back past it',
      JSON.stringify(nav));

    S('G. The attention list reaches it too, and focus is never yanked');
    const deep = await page.evaluate(() => {
      const card = document.getElementById('cardLeases');
      const p = window.currentProperty && window.currentProperty();
      const out = {};

      // The OTHER navigator: PropertyWorkspace's attention items carry their
      // own anchor loop, so _kpiTileNavigate passing proves nothing about it.
      // Find the item that actually targets the lease block and fire its action.
      const items = window.PropertyWorkspace.collectAttention(p) || [];
      const idx = items.findIndex(it => it.nav && (it.nav.anchors || []).indexOf('cardLeases') !== -1);
      out.attentionItem = idx >= 0 ? items[idx].action : null;
      window.PropertyWorkspace.renderAttention(p);          // populates its item list
      window.PropertyOS.toggleLeaseBlock(false);
      out.hiddenBeforeAct = card.offsetParent === null;
      window.PropertyWorkspace.act(idx);
      out.visibleAfterAct = card.offsetParent !== null;

      // The focus guard. All four remaining leases are verified, so the block
      // WOULD collapse — except someone is typing in it. Collapsing here is the
      // mobile Total Sqft bug: focus dropped, page reflowed, field replaced by
      // a button. Re-render with focus inside, then again without.
      const ready = { tenants: (p.tenants || []).filter(t => t.tenant_name !== 'Harbor Nail & Beauty Studio') };
      window.PropertyOS.toggleLeaseBlock(true);
      const ctl = Array.from(card.querySelectorAll('input:not([type=file]),button,select,textarea'))
        .find(e => e.offsetParent !== null);
      ctl.focus();
      out.focusIsInside = card.contains(document.activeElement);
      window.PropertyOS.renderLeaseSummary(ready, { allowCollapse: true });
      out.openWhileFocused = card.offsetParent !== null;
      out.focusKept = card.contains(document.activeElement);

      document.activeElement.blur();
      window.PropertyOS.renderLeaseSummary(ready, { allowCollapse: true });
      out.collapsedOnceBlurred = card.offsetParent === null;
      out.readyLine = (document.getElementById('posLeaseSummary').innerText || '').replace(/\s+/g, ' ');

      // The THIRD navigator, and the one with two levels of collapse under it:
      // the review queue's "Fix it" jump expands a lease card's detail. If the
      // block around that card is shut, it expands a detail nobody can see.
      const needy = (p.tenants || []).find(t => t && t.id);
      out.reviewTenant = needy ? needy.tenant_name : null;
      window.PropertyOS.toggleLeaseBlock(false);
      out.hiddenBeforeFix = card.offsetParent === null;
      try { window.openReviewItemFix(needy.id, 'cap'); } catch (e) { out.fixError = e.message; }
      out.visibleAfterFix = card.offsetParent !== null;

      // A re-render in place must not move the block either way.
      window.PropertyOS.toggleLeaseBlock(true);
      window.PropertyOS.renderLeaseSummary(ready, { allowCollapse: false });
      out.refreshLeftItOpen = card.offsetParent !== null;
      return out;
    });
    is(deep.attentionItem != null,
      'an attention item really does target the lease block (' + deep.attentionItem + ')');
    is(deep.hiddenBeforeAct && deep.visibleAfterAct,
      'PropertyWorkspace.act reveals a COLLAPSED lease block before navigating to it',
      JSON.stringify(deep));
    is(deep.hiddenBeforeFix && deep.visibleAfterFix,
      'openReviewItemFix reveals the block before expanding a lease card inside it',
      JSON.stringify({ tenant: deep.reviewTenant, hidden: deep.hiddenBeforeFix,
                       visible: deep.visibleAfterFix, err: deep.fixError }));
    is(deep.focusIsInside, 'the focus-guard case really does have focus inside the block');
    is(deep.openWhileFocused,
      'a re-render with every lease ready does NOT collapse the block while someone is typing in it');
    is(deep.focusKept, 'and the control they were using keeps focus');
    is(deep.collapsedOnceBlurred,
      'the same re-render DOES collapse it once focus has left — so the guard is the reason, not inertia');
    is(/4 leases on file, all reviewed/.test(deep.readyLine),
      'and the bar then reports the block as clear', JSON.stringify(deep.readyLine));
    is(deep.refreshLeftItOpen,
      'a refresh in place (allowCollapse false) leaves the manager\'s own choice alone');

    S('H. The five tenants and their lease data are untouched');
    const tenants = await page.evaluate(() => {
      const p = window.currentProperty && window.currentProperty();
      return (p.tenants || []).map(t => ({
        name: t.tenant_name, sqft: t.leased_sqft, type: t.lease_type,
        start: t.start_date, end: t.end_date, cap: t.cap
      }));
    });
    // Pinned by reading the demo off the app at commit fd5e518, BEFORE this
    // slice touched anything — not by copying this suite's own output, which
    // would make the check circular and unable to fail.
    const EXPECTED = [
      { name: 'Whole Health Market',         sqft: 9200, type: 'NNN',             start: '2021-01-01', end: '2028-12-31', cap: '5' },
      { name: 'Summit Coffee & Provisions',  sqft: 1800, type: 'NNN',             start: '2023-03-01', end: '2026-02-28', cap: '8' },
      { name: 'ProActive Physical Therapy',  sqft: 4400, type: 'Modified Gross',  start: '2022-07-01', end: '2027-06-30', cap: '6' },
      { name: 'FitZone Athletics',           sqft: 6800, type: 'NNN',             start: '2022-01-01', end: '2026-12-31', cap: '4' },
      { name: 'Harbor Nail & Beauty Studio', sqft: 1200, type: 'NNN',             start: '2024-02-01', end: '2027-01-31', cap: null }
    ];
    is(tenants.length === 5, 'the demo still has five tenants', 'got ' + tenants.length);
    EXPECTED.forEach((want, i) => eq(tenants[i], want, 'lease data unchanged: ' + want.name));

    S('I. The page loaded clean');
    is(pageErrors.length === 0, 'no uncaught page errors while exercising the block',
      pageErrors.slice(0, 5).join(' | '));
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
