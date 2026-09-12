'use strict';
/**
 * test-unbilled-pool-narrative.js — a lease cap is not unrecovered revenue.
 *
 *   node test-unbilled-pool-narrative.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * The Overview attention panel computed `snap.total - allocated` and announced:
 *
 *     CAM underbilling — $99,523 unrecovered
 *     Allocated charges fall short of the eligible expense pool.
 *
 * On Cascade Commons VarianceBreakdown accounts for every cent of that $99,523:
 *
 *     Reduced by a CAM cap                              $75,548.60
 *     Outside the 90.0% covered by loaded leases        $18,830.00
 *     Excluded from CAM by a lease                       $5,144.60
 *     Rounding to the nearest cent                           $0.03
 *     residual $0 · explained true
 *
 * $75,548.60 — 76% of it — is allocation the engine computed and then WITHHELD
 * because a lease cap was reached. The CAM panel says so in words: "money the
 * leases say those tenants do not owe". Ask AI's variance_unbilled answer says
 * the same. The Overview alone called it recoverable underbilling, and its CTA
 * landed the manager on the panel that contradicts it.
 *
 * WHAT THIS PINS
 *   A  the three states, called directly on fixtures
 *   B  a lease-imposed reduction is NEVER described as recoverable
 *   C  the demo, end to end: the rendered item agrees with the CAM panel
 *   D  the figures and the decomposition are untouched
 *   E  the item's severity, rank, CTA destination and action are untouched
 *
 * WHY THE BREAKDOWN IS READ AND NOT RE-DERIVED. Deriving from
 * `camReconciliation` alone is not a fallback, it is a wrong answer: that
 * snapshot's `invoices` are stripped to {vendor, category, amount} with no id, so
 * identity matching fails and it reports residual -$46,515.36 with
 * explained:false where the render's own lists give residual $0 and
 * explained:true. Section F asserts that difference so nobody "simplifies" the
 * scoped read into a local derivation.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const PORT = parseInt(process.env.UBP_PORT || '8968', 10);
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

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
               '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
               '.pdf': 'application/pdf', '.woff2': 'font/woff2' };

const SUPABASE_MOCK = `
(function() {
  var _store = { properties: [], tenants: [] };
  var _user = { id: 'ubp-user', email: 'ubp@e2e-test.local' }, _session = null;
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

// Any wording that tells a manager the gap is money they failed to collect.
const RECOVERABLE_CLAIM = /underbilling|unrecovered|under-?billed|not recovered|lost revenue|failed to bill|should have been billed|fall(s)? short/i;

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
    await page.fill('#loginEmail', 'ubp@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.locator('#loginBtn').click({ timeout: 12000 });
    await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== '';
    }, null, { timeout: 45000 });

    // ── A · the three states, on fixtures ──────────────────────────────────
    S('A. The narrative states, called directly');
    const A = await page.evaluate(() => {
      const N = window.PropertyWorkspace.unbilledPoolNarrative;
      const CASCADE = {
        pool: 188300, billed: 88776.77, difference: 99523.23, residual: 0, explained: true,
        lines: [
          { key: 'caps', label: 'Reduced by a CAM cap', amount: 75548.6 },
          { key: 'uncovered', label: 'Outside the 90.0% of the property covered by loaded leases', amount: 18830 },
          { key: 'excluded_by_lease', label: 'Excluded from CAM by a lease', amount: 5144.6 },
          { key: 'rounding_residue', label: 'Rounding to the nearest cent', amount: 0.03 },
        ],
      };
      // Part attributed, part not — the case the demo cannot produce.
      const PARTIAL = {
        pool: 100000, billed: 40000, difference: 60000, residual: 12000, explained: false,
        lines: [
          { key: 'caps', label: 'Reduced by a CAM cap', amount: 30000 },
          { key: 'uncovered', label: 'Outside the covered share', amount: 18000 },
          { key: 'residual', label: 'Not attributed', amount: 12000 },
        ],
      };
      const NOTHING_ATTRIBUTED = {
        pool: 100000, billed: 40000, difference: 60000, residual: 60000, explained: false, lines: [],
      };
      const ONE_CAUSE = {
        pool: 100000, billed: 40000, difference: 60000, residual: 0, explained: true,
        lines: [{ key: 'caps', label: 'Reduced by a CAM cap', amount: 60000 }],
      };
      // THE TWO SIGNALS MADE TO DISAGREE. In every natural breakdown `explained`
      // and a zero residual travel together, so a wording rule that consulted
      // only one of them would pass every realistic fixture. These two are the
      // only fixtures that can tell the difference, and they are the reason the
      // rule tests both.
      const EXPLAINED_BUT_RESIDUAL = {
        pool: 100000, billed: 40000, difference: 60000, residual: 9000, explained: true,
        lines: [
          { key: 'caps', label: 'Reduced by a CAM cap', amount: 51000 },
          { key: 'residual', label: 'Not attributed', amount: 9000 },
        ],
      };
      const SETTLED_BUT_UNEXPLAINED = {
        pool: 100000, billed: 40000, difference: 60000, residual: 0, explained: false,
        lines: [{ key: 'caps', label: 'Reduced by a CAM cap', amount: 60000 }],
      };
      return {
        cascade: N(99523.23, CASCADE),
        partial: N(60000, PARTIAL),
        nothing: N(60000, NOTHING_ATTRIBUTED),
        oneCause: N(60000, ONE_CAUSE),
        noBreakdown: N(99523.23, null),
        undefinedBreakdown: N(99523.23, undefined),
        explainedButResidual: N(60000, EXPLAINED_BUT_RESIDUAL),
        settledButUnexplained: N(60000, SETTLED_BUT_UNEXPLAINED),
      };
    });
    eq(A.cascade.state, 'accounted', 'a fully explained gap is "accounted"');
    is(/\$99,523/.test(A.cascade.title), 'the title still states the figure', A.cascade.title);
    is(/accounted for/.test(A.cascade.title), 'and says it is accounted for', A.cascade.title);
    is(/Reduced by a CAM cap/.test(A.cascade.why),
      'the largest cause is named in the breakdown\'s own words', A.cascade.why);
    is(/\$75,549/.test(A.cascade.why), 'with its own amount', A.cascade.why);
    is(/3 further named causes/.test(A.cascade.why),
      'and the remaining causes are counted, not invented', A.cascade.why);

    eq(A.partial.state, 'partial', 'a residual that remains is "partial"');
    is(/\$12,000/.test(A.partial.title), 'the title states the UNACCOUNTED amount, not the whole gap',
      A.partial.title);
    is(/unaccounted variance/i.test(A.partial.title),
      'and calls it an unaccounted variance', A.partial.title);
    is(/\$48,000/.test(A.partial.why),
      'the why says how much IS attributed ($30,000 + $18,000)', A.partial.why);
    is(/not attributed to any cause on record/.test(A.partial.why),
      'and that the remainder is not attributed', A.partial.why);

    eq(A.nothing.state, 'partial', 'nothing attributed is still "partial", never "accounted"');
    is(/nothing on record accounts for it/.test(A.nothing.why),
      'and says plainly that nothing accounts for it', A.nothing.why);

    is(/1 further named cause/.test(A.oneCause.why) === false,
      'a single cause does not claim further causes', A.oneCause.why);
    is(/Reduced by a CAM cap/.test(A.oneCause.why) && /\$60,000/.test(A.oneCause.why),
      'it names that one cause and its amount', A.oneCause.why);

    // Each of these kills a rule that consults only one of the two signals.
    eq(A.explainedButResidual.state, 'partial',
      'explained:true with a residual still remaining is NOT "accounted for"');
    is(/\$9,000/.test(A.explainedButResidual.title),
      'and the unaccounted $9,000 is what the title names', A.explainedButResidual.title);
    is(/unaccounted variance/i.test(A.explainedButResidual.title),
      'called an unaccounted variance', A.explainedButResidual.title);
    eq(A.settledButUnexplained.state, 'partial',
      'and a zero residual with explained:false is NOT "accounted for" either');
    is(!/accounted for/.test(A.settledButUnexplained.title),
      'neither signal alone is enough to claim the gap is accounted for',
      A.settledButUnexplained.title);

    eq(A.noBreakdown.state, 'unknown', 'with no breakdown the state is "unknown"');
    is(/was not billed to tenants/.test(A.noBreakdown.title),
      'and the only claim made is the one subtraction supports', A.noBreakdown.title);
    is(/has not been established/.test(A.noBreakdown.why),
      'the absence of an explanation is stated, not filled in', A.noBreakdown.why);
    eq(A.undefinedBreakdown.state, 'unknown', 'undefined is treated the same as null');

    // ── B · the claim that must never be made ──────────────────────────────
    S('B. No state ever presents the gap as recoverable');
    const RC = new RegExp('underbilling|unrecovered|under-?billed|not recovered|lost revenue'
                        + '|failed to bill|should have been billed|fall(s)? short', 'i');
    for (const [k, v] of Object.entries(A)) {
      is(!RC.test(v.title), `${k}: the title makes no recoverable-revenue claim`, v.title);
      is(!RC.test(v.why), `${k}: nor does the why`, v.why);
    }
    is(!RC.test(JSON.stringify(A)), 'the words "underbilling" and "unrecovered" appear in no state');

    // ── C · the demo, end to end ───────────────────────────────────────────
    S('C. The rendered item agrees with the CAM panel');
    await page.waitForSelector('.ptf-demo-card', { timeout: 25000 });
    await page.locator('.ptf-demo-card').filter({ hasText: 'Cascade Commons' })
      .first().locator('.ptf-card-open-btn').first().click({ timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Cascade Commons';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.switchWorkspaceTab('overview'));
    await page.waitForTimeout(1500);

    const C = await page.evaluate(() => {
      const T = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : null;
      const slot = document.getElementById('propertyAttentionSlot');
      // Through the real browser path: renderAttention supplies the scoped
      // breakdown, so this is what a manager actually reads.
      window.PropertyWorkspace.renderAttention(window.currentProperty());
      const items = window.PropertyWorkspace.collectAttention(
        window.currentProperty(),
        (window.varianceBreakdownOnScreen() || {}).breakdown) || [];
      const idx = items.findIndex(i => /expense pool/.test(i.title || ''));
      const w = window.varianceBreakdownOnScreen ? window.varianceBreakdownOnScreen() : null;
      const b = w && w.breakdown;
      return {
        slotText: T(slot),
        item: idx >= 0 ? items[idx] : null,
        itemIndex: idx,
        totalItems: items.length,
        breakdown: b ? { difference: b.difference, residual: b.residual, explained: b.explained,
          topLine: (b.lines || []).filter(l => l.key !== 'residual')[0] } : null,
        scopeMatches: !!(w && w.propertyId === (window.currentProperty() || {}).id),
      };
    });
    is(C.item !== null, 'the unbilled-pool item is present on the demo', JSON.stringify(C.itemIndex));
    is(C.scopeMatches === true, 'and the breakdown it reads is scoped to this property');
    eq(C.breakdown.residual, 0, 'the demo breakdown is fully settled (residual 0)');
    is(C.breakdown.explained === true, 'and reports explained:true');
    is(/accounted for/.test(C.item.title),
      'so the item says the gap is accounted for', C.item.title);
    is(C.item.why.includes(C.breakdown.topLine.label),
      'and quotes the breakdown\'s own top-line label verbatim',
      `${C.item.why} || ${C.breakdown.topLine.label}`);
    is(!RC.test(C.slotText || ''),
      'THE WORD "UNDERBILLING" IS GONE FROM THE PANEL', (C.slotText || '').slice(0, 300));
    is(/\$99,523/.test(C.item.title), 'the figure is unchanged at $99,523', C.item.title);
    is(/\$75,549/.test(C.item.why), 'and the cap figure matches the panel', C.item.why);

    // ── D · the figures and decomposition are untouched ────────────────────
    S('D. Nothing about the reconciliation moved');
    const D = await page.evaluate(() => {
      const w = window.varianceBreakdownOnScreen();
      const b = w.breakdown;
      return {
        pool: b.pool, billed: b.billed, difference: b.difference,
        residual: b.residual, explained: b.explained,
        lines: (b.lines || []).map(l => ({ key: l.key, amount: Math.round(l.amount * 100) / 100 })),
        allocations: (typeof lastResults !== 'undefined' ? lastResults : [])
          .map(r => ({ n: r.name, a: r.allocatedAmount, e: r.eligibleCount })),
      };
    });
    eq(D.pool, 188300, 'the pool is still $188,300');
    eq(D.billed, 88776.77, 'the billed total is still $88,776.77');
    eq(D.difference, 99523.23, 'the difference is still $99,523.23');
    eq(D.lines, [
      { key: 'caps', amount: 75548.6 },
      { key: 'uncovered', amount: 18830 },
      { key: 'excluded_by_lease', amount: 5144.6 },
      { key: 'rounding_residue', amount: 0.03 },
    ], 'and the decomposition is byte-for-byte the one the audit recorded');
    eq(D.allocations.map(a => a.a), [34650, 6696, 13780, 24960, 8690.77],
      'every tenant allocation is unchanged');
    eq(D.allocations.map(a => a.e), [26, 26, 22, 26, 26],
      'and every included-expense count is unchanged');

    // ── E · the item's placement and action are untouched ──────────────────
    S('E. Severity, rank, destination and action are untouched');
    eq(C.item.severity, 'warning', 'the item is still a warning — its rank did not move');
    eq(C.item.nav.tab, 'cam', 'the CTA still goes to the CAM tab');
    eq(C.item.nav.anchors, ['results', 'cardInvoices'], 'to the same anchors');
    eq(C.item.action, 'Review allocation', 'with the same action label');
    eq(C.totalItems, 7, 'and the panel still collects the same seven items');

    // ── F · why the breakdown is read, not re-derived ──────────────────────
    S('F. Re-deriving from the snapshot would be a WRONG answer, not a fallback');
    const F = await page.evaluate(() => {
      const VB = window.VarianceBreakdown;
      const s = (window.currentProperty() || {}).camReconciliation;
      const results = s.results || [];
      const billed = results.reduce((a, r) =>
        a + (Number(r.allocatedAmount != null ? r.allocatedAmount : r.totalAllocated) || 0), 0);
      const stripped = s.invoicesFull || s.invoices || [];
      let local = null;
      try {
        local = VB.derive({ results, invoices: stripped, pool: Number(s.total) || 0, billed,
                            reconciled: s.reconciledInvoices || stripped });
      } catch (_) { local = null; }
      const onScreen = window.varianceBreakdownOnScreen().breakdown;
      return {
        snapshotInvoiceKeys: Object.keys(stripped[0] || {}),
        localResidual: local && Math.round(local.residual * 100) / 100,
        localExplained: local && local.explained,
        localUnmatched: local && local.unmatchedInvoices,
        onScreenResidual: onScreen.residual,
        onScreenExplained: onScreen.explained,
      };
    });
    // The snapshot's invoice projection DOES carry an id — a positional `inv-N`
    // key, not the engine's — and it drops the date and the match fields the
    // derivation needs. That is the invoiceKey identity mismatch VB-1 was about,
    // which is why the local answer below is wrong rather than merely different.
    is(F.snapshotInvoiceKeys.indexOf('invoiceDate') === -1 &&
       F.snapshotInvoiceKeys.indexOf('matchConfidence') === -1,
      'the snapshot invoices drop the date and match fields the derivation needs',
      JSON.stringify(F.snapshotInvoiceKeys));
    is(F.localExplained === false && Math.abs(F.localResidual) > 1,
      'so a local derivation cannot explain the gap', JSON.stringify({ r: F.localResidual, e: F.localExplained }));
    is(F.localUnmatched > 0, 'and leaves invoices unmatched', String(F.localUnmatched));
    is(F.onScreenExplained === true && F.onScreenResidual === 0,
      'while the breakdown on screen explains it exactly');
    is(F.localResidual !== F.onScreenResidual,
      'THE TWO GENUINELY DISAGREE — reading the screen is not a stylistic preference',
      `${F.localResidual} vs ${F.onScreenResidual}`);

    // ── H · a breakdown from another building is refused, not borrowed ──────
    S('H. The scope guard refuses another property\'s breakdown');
    const H = await page.evaluate(() => {
      const orig = window.varianceBreakdownOnScreen;
      const real = orig();
      // Driven through renderAttention — the browser path that performs the
      // scoped read — and read back off the rendered panel, so the guard is
      // exercised where it actually lives rather than through an injected arg.
      const item = () => {
        window.PropertyWorkspace.renderAttention(window.currentProperty());
        const slot = document.getElementById('propertyAttentionSlot');
        const rows = [...slot.querySelectorAll('.pw-item')].map(it => ({
          title: ((it.querySelector('.pw-item-title') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
          why: ((it.querySelector('.pw-item-why, .pw-item-sub') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
        }));
        return rows.find(r => /expense pool/.test(r.title)) || null;
      };
      const mine = item();
      // Same breakdown, stamped with a DIFFERENT building. Borrowing it would
      // describe this property's gap with another property's causes.
      window.varianceBreakdownOnScreen = function () {
        return { propertyId: 'some-other-building', propertyName: 'Elsewhere Plaza',
                 breakdown: real.breakdown };
      };
      const foreign = item();
      // And a wrapper with no scope at all.
      window.varianceBreakdownOnScreen = function () {
        return { propertyId: null, propertyName: null, breakdown: real.breakdown };
      };
      const unscoped = item();
      window.varianceBreakdownOnScreen = orig;
      const restored = item();
      return { mine, foreign, unscoped, restored };
    });
    is(/accounted for/.test(H.mine.title),
      'with the property\'s own breakdown the gap is accounted for', H.mine.title);
    is(/was not billed to tenants/.test(H.foreign.title) &&
       /has not been established/.test(H.foreign.why),
      'a breakdown stamped with ANOTHER building is refused — the item falls back to "unknown"',
      JSON.stringify(H.foreign));
    is(!/accounted for/.test(H.foreign.title),
      'and never claims another property\'s causes explain this one', H.foreign.title);
    is(!RC.test(H.foreign.title) && !RC.test(H.foreign.why),
      'nor does the refusal reintroduce recoverable-revenue wording', JSON.stringify(H.foreign));
    is(/was not billed to tenants/.test(H.unscoped.title),
      'a wrapper carrying no property id is refused too', H.unscoped.title);
    is(/accounted for/.test(H.restored.title),
      'and the real breakdown still works afterwards — the stub was undone', H.restored.title);

    // collectAttention runs on the server too (PropertyRecord.assemble calls it
    // for the MCP attention projection), so it must not reach for the browser
    // global itself. Given no breakdown it stays "unknown" even while a perfectly
    // good one is sitting on window.
    const H2 = await page.evaluate(() => {
      const items = window.PropertyWorkspace.collectAttention(window.currentProperty()) || [];
      const it = items.find(i => /expense pool/.test(i.title || '')) || null;
      return { title: it && it.title, why: it && it.why,
               globalAvailable: !!(window.varianceBreakdownOnScreen() || {}).breakdown };
    });
    is(H2.globalAvailable === true, 'the on-screen breakdown IS available on window');
    is(/was not billed to tenants/.test(H2.title) && !/accounted for/.test(H2.title),
      'yet collectAttention with no breakdown passed in stays "unknown" — it does not '
      + 'reach for the global, which is what keeps the server path browser-free', H2.title);
    is(!RC.test(H2.title) && !RC.test(H2.why),
      'and the server-shaped wording carries no recoverable-revenue claim either',
      JSON.stringify(H2));

    // ── I · the threshold is unchanged ─────────────────────────────────────
    // Cascade Commons is 52.9% under, so the demo alone cannot tell 5% from 50%.
    // These synthetic properties can. No demo data is touched.
    S('I. The 5% threshold still governs whether the item appears');
    const I = await page.evaluate(() => {
      const mk = (total, allocated) => ({
        id: 'synthetic-threshold-' + total + '-' + allocated,
        name: 'Threshold Fixture', tenants: [], disputes: [], timeline: [],
        camReconciliation: { total: total, results: [{ name: 'T', allocatedAmount: allocated }] },
      });
      const has = (p) => (window.PropertyWorkspace.collectAttention(p) || [])
        .some(i => /expense pool/.test(i.title || ''));
      return {
        under10pct: has(mk(100000, 90000)),   // 10% — above 5%, below 50%
        under6pct:  has(mk(100000, 94000)),   // 6%  — just above 5%
        under4pct:  has(mk(100000, 96000)),   // 4%  — below 5%
        under2pct:  has(mk(100000, 98000)),   // 2%  — well below
        exactlyZero: has(mk(100000, 100000)), // nothing unbilled
      };
    });
    is(I.under10pct === true, 'a 10% shortfall raises the item');
    is(I.under6pct === true, 'and so does 6%, just over the threshold');
    is(I.under4pct === false, 'but 4% does not — the threshold did not loosen');
    is(I.under2pct === false, 'nor does 2%');
    is(I.exactlyZero === false, 'and a fully billed pool raises nothing');

    S('G. The page loaded clean');
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
