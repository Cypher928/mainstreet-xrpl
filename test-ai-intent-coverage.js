'use strict';
/**
 * test-ai-intent-coverage.js — Ask AI answers four questions it already had the
 * data for, and still refuses the ones it does not.
 *
 *   node test-ai-intent-coverage.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * On the Cascade Commons demo, every one of these fell to the honest fallback
 * — "I couldn't map that question to your data" — while the answer sat on the
 * screen behind the panel:
 *
 *   "Is this reconciliation ready to bill?"          verdict on the CAM tab
 *   "How much CAM was allocated to Whole Health …?"  $34,650.00, in three places
 *   "Why was $99,523 not billed?"                    a four-line breakdown
 *   "Who is the property manager?"                   on the Property tab
 *
 * The fallback was honest about the question and wrong about the data. None of
 * the four needed a new source; three needed only a wider matcher or an
 * existing authority passed in.
 *
 *   billing readiness   AuditExposure.billingReadiness, via the verdict the CAM
 *                       screen rendered (deps.billingVerdict). UNCHANGED
 *                       handler — only _BILL_BLOCK_RE learned the affirmative
 *                       phrasing, so "is it ready?" reaches the same verdict
 *                       "why can't I bill?" always did.
 *   tenant allocation   PropertyRecord.cam.results, joined on tenantId.
 *                       UNCHANGED handler — the matcher simply did not know the
 *                       word the CAM screen prints over that number.
 *   unbilled pool       VarianceBreakdown, via the breakdown the CAM banner
 *                       rendered (deps.varianceBreakdown). New intent, no new
 *                       arithmetic: it prints that module's own line labels.
 *   property manager    PropertyReference.infoFor. New intent. Its null is the
 *                       feature — a property with no reference record gets
 *                       "not in the record", never a plausible name.
 *
 * WHY THIS SUITE INJECTS ITS OWN AUTHORITIES
 *
 * The demo masks defects. Every Cascade Commons blocker is property-wide, so a
 * tenant-scoping bug reads identically to correct behaviour; and every tenant
 * is blocked, so an answer that ignored the verdict entirely and hard-coded
 * "blocked" would pass. Sections C–F therefore drive AIWorkspace.answer with
 * synthetic props and synthetic deps where the right answer and the wrong
 * answer DIFFER. Section B checks the live demo end to end.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const PORT = parseInt(process.env.AIC_PORT || '8976', 10);
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
  var _user = { id: 'aic-user', email: 'aic@e2e-test.local' }, _session = null;
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

// ── The four questions and their natural variants ────────────────────────────
const TARGETS = {
  billing_blocked: [
    'Is this reconciliation ready to bill?',
    'Can I bill this reconciliation?',
    'Are we ready to bill?',
    'Can I issue statements yet?',
    'Is it safe to bill?',
    "Why can't I bill Whole Health Market?",   // the pre-existing phrasing
  ],
  tenant_charge: [
    'How much CAM was allocated to Whole Health Market?',
    "What is Whole Health Market's CAM allocation?",
    'How much was FitZone Athletics allocated?',
    'Whole Health Market CAM amount',
    'What did Summit Coffee & Provisions get charged for CAM?',  // pre-existing
  ],
  variance_unbilled: [
    'Why was $99,523 not billed?',
    'Why was the rest of the pool not billed?',
    'Where did the unbilled money go?',
    'Why is only part of the pool allocated?',
    'What happened to the rest of the money?',
  ],
  property_info: [
    'Who is the property manager?',
    'Who manages this property?',
    'Who is the owner?',
    'What is the parcel ID?',
  ],
};

const MUST_FALL_BACK = [
  'What will CAM be next year?',
  'Should I sue Summit Coffee?',
  'What is the roof made of?',
  'What is the capital of France?',
  'How old is the roof?',
];

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
    await page.fill('#loginEmail', 'aic@e2e-test.local');
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
    // The CAM tab must render so the verdict and breakdown getters are primed —
    // that is the state a manager is in when they ask any of these.
    await page.evaluate(() => window.switchWorkspaceTab && window.switchWorkspaceTab('cam'));
    await page.waitForTimeout(3000);

    // deps are FUNCTIONS, and a function cannot cross into the page as an
    // argument. The stub is therefore described as data and rebuilt inside the
    // page: { billingVerdict: <value> } becomes a getter returning that value.
    // `_props` / `_aiwContext` are script-scoped bindings in script.js, not
    // window properties — reading them bare is what reaches the real ones.
    const ask = (question, stub) => page.evaluate(({ q, s }) => {
      let deps;
      if (s) {
        deps = {};
        for (const k of Object.keys(s)) {
          if (k === 'PropertyReference') {
            const v = s[k];
            deps[k] = { infoFor: () => { if (v === '__throw__') throw new Error('boom'); return v; } };
          } else {
            const v = s[k];
            deps[k] = () => v;
          }
        }
      }
      const a = AIWorkspace.answer(Object.assign({
        question: q, context: _aiwContext || { propertyId: activePropId }, wctx: null,
        props: _props, acqReviews: _acqReviews,
      }, deps ? { deps } : {}));
      return {
        intent: (a.trace && a.trace.intent) || null,
        engine: (a.trace && a.trace.engine) || null,
        sources: (a.trace && a.trace.sources) || [],
        heading: a.heading || null,
        bullets: a.bullets || [],
        text: [a.heading || ''].concat(a.paragraphs || []).join(' \n '),
        confidence: a.confidence || null,
        citations: (a.citations || []).length,
      };
    }, { q: question, s: stub || null });

    S('A. Every target question, and its variants, reaches its intent');
    for (const intent of Object.keys(TARGETS)) {
      for (const q of TARGETS[intent]) {
        const r = await ask(q);
        is(r.intent === intent, `${intent} ← "${q}"`, `resolved to ${r.intent}`);
      }
    }

    S('B. And the answers come from the right authority, on the live demo');
    const bill = await ask('Is this reconciliation ready to bill?');
    eq(bill.engine, 'Audit Exposure — Billing Readiness', 'readiness answer names the audit engine');
    is(bill.sources.join(' ').includes('AuditExposure.billingReadiness'),
      'and cites AuditExposure.billingReadiness as its source', JSON.stringify(bill.sources));
    is(/0 of 5 tenants can be billed/.test(bill.text),
      'it reports the verdict\'s own roster', bill.text.slice(0, 160));

    const alloc = await ask('How much CAM was allocated to Whole Health Market?');
    eq(alloc.engine, 'Reconciliation Engine', 'allocation answer names the reconciliation engine');
    is(/34,650/.test(alloc.text), 'and states Whole Health Market\'s $34,650 allocation',
      alloc.text.slice(0, 200));
    is(!/6,696|24,960|13,780|8,690/.test(alloc.text),
      'and does not quote another tenant\'s number', alloc.text.slice(0, 200));

    const unb = await ask('Why was $99,523 not billed?');
    eq(unb.engine, 'Variance Breakdown', 'unbilled answer names the variance breakdown');
    is(unb.bullets.some(b => /Reduced by a CAM cap/.test(b)),
      'it lists the cap line using the breakdown module\'s own label', JSON.stringify(unb.bullets));
    is(unb.bullets.some(b => /Excluded from CAM by a lease/.test(b)),
      'and the lease-exclusion line');
    is(unb.bullets.some(b => /covered by loaded leases/.test(b)),
      'and the coverage line');
    is(/75,54\d/.test(unb.bullets.join(' ')), 'with the cap amount the CAM banner shows',
      JSON.stringify(unb.bullets));
    is(/is an audit exception/i.test(unb.text),
      'and says plainly that this is not the blocked-billing question');

    const mgr = await ask('Who is the property manager?');
    eq(mgr.engine, 'Property Reference Record', 'manager answer names the reference record');
    is(/Christy Alvarez/.test(mgr.text), 'and reads the manager off it', mgr.text.slice(0, 160));

    // EACH QUESTION GETS ITS OWN FIELD. Asking about the parcel and being told
    // the manager is a confident wrong answer, and every one of these questions
    // routes through the same intent — so the field it selects has to be
    // asserted, not assumed.
    const owner = await ask('Who is the owner?');
    const parcel = await ask('What is the parcel ID?');
    is(/Cascade Commons Holdings/.test(owner.text),
      'the owner question answers with the owner', owner.text.slice(0, 160));
    is(!/Christy Alvarez/.test(owner.text),
      'and not with the property manager', owner.text.slice(0, 160));
    is(/TRAVIS-02-4417-0209/.test(parcel.text),
      'the parcel question answers with the parcel id', parcel.text.slice(0, 160));
    is(!/Christy Alvarez|Cascade Commons Holdings/.test(parcel.text),
      'and not with the manager or the owner', parcel.text.slice(0, 160));

    S('C. Billing readiness comes from the VERDICT, never the calculation status');
    // The demo cannot show this: every tenant is blocked AND every calc status
    // is 'calculated', so an answer keying off either reads the same. Inject a
    // verdict that says the opposite of the calculation status and see which
    // one the answer follows.
    const clear = await ask('Is this reconciliation ready to bill?', {
      billingVerdict: {
        propertyId: null, propertyName: 'Cascade Commons',
        readiness: { canBill: true, label: 'Ready to bill', reason: 'No exceptions were detected.', blockers: [] },
        billableNames: ['A', 'B', 'C', 'D', 'E'], tenantCount: 5 },
    });
    is(/nothing is blocking billing/i.test(clear.heading || ''),
      'a CLEAR verdict produces the clear answer, though every calc status still reads "calculated"',
      JSON.stringify(clear.heading));
    is(/Ready to bill/.test(clear.text), 'and quotes the verdict\'s own label');
    const blocked = await ask('Is this reconciliation ready to bill?', {
      billingVerdict: {
        propertyId: null, propertyName: 'Cascade Commons',
        readiness: { canBill: false, label: 'Not ready to bill', reason: 'One exception.',
                     blockers: [{ scope: 'property', severity: 'red', title: 'A property exception' }] },
        billableNames: [], tenantCount: 5 },
    });
    is(/can’t be billed yet/.test(blocked.heading || ''),
      'and a BLOCKED verdict produces the blocked answer', JSON.stringify(blocked.heading));
    is(blocked.bullets.some(b => /A property exception/.test(b)),
      'naming the blocker the verdict carried', JSON.stringify(blocked.bullets));
    const noVerdict = await ask('Is this reconciliation ready to bill?', {
      billingVerdict: null,
    });
    is(/No reconciliation is open/.test(noVerdict.heading || ''),
      'NO verdict is not an all-clear — it says no reconciliation is open',
      JSON.stringify(noVerdict.heading));
    is(!/nothing is blocking/i.test(noVerdict.text),
      'and never claims nothing is blocking billing');

    S('D. Tenant allocation is resolved by IDENTITY, not by position');
    // Two tenants, and the CAM rows deliberately in the OPPOSITE array order,
    // with tenantId the only correct join. Position-matching returns the other
    // tenant's money; name-matching alone would break on the shared surname.
    const idTest = await page.evaluate(() => {
      const props = [{
        id: 'prop-x', name: 'Test Plaza', totalSqft: 10000,
        tenants: [
          { id: 'T-ALPHA', tenant_name: 'Alpha Retail Group', leased_sqft: 4000, lease_type: 'NNN' },
          { id: 'T-BETA',  tenant_name: 'Beta Retail Group',  leased_sqft: 6000, lease_type: 'NNN' },
        ],
        camReconciliation: { camYear: 2025, total: 100000, results: [
          // reversed on purpose: index 0 belongs to BETA
          { tenantId: 'T-BETA',  tenantName: 'Beta Retail Group',  totalAllocated: 60000, proRataPercent: 60 },
          { tenantId: 'T-ALPHA', tenantName: 'Alpha Retail Group', totalAllocated: 40000, proRataPercent: 40 },
        ] },
      }];
      const a = AIWorkspace.answer({ question: 'How much CAM was allocated to Alpha Retail Group?',
        context: { propertyId: 'prop-x' }, props, acqReviews: [] });
      const b = AIWorkspace.answer({ question: 'How much CAM was allocated to Beta Retail Group?',
        context: { propertyId: 'prop-x' }, props, acqReviews: [] });
      const txt = (x) => [x.heading || ''].concat(x.paragraphs || []).join(' ');
      return { alpha: txt(a), beta: txt(b),
               alphaIntent: (a.trace && a.trace.intent), betaIntent: (b.trace && b.trace.intent) };
    });
    eq(idTest.alphaIntent, 'tenant_charge', 'the synthetic Alpha question reaches tenant_charge');
    is(/40,000/.test(idTest.alpha) && !/60,000/.test(idTest.alpha),
      'Alpha gets $40,000 — its own row, found by tenantId, not array index 0',
      idTest.alpha.slice(0, 200));
    is(/60,000/.test(idTest.beta) && !/40,000/.test(idTest.beta),
      'Beta gets $60,000 — the row at index 0, correctly NOT given to Alpha',
      idTest.beta.slice(0, 200));
    is(idTest.alpha !== idTest.beta, 'and the two answers genuinely differ');

    // DISTINCT NAMES ONLY DEFEAT POSITION-MATCHING. The defect the product's
    // own comment names is two tenants SHARING a name — "a chain in two suites,
    // or the very common 'Vacant'" — where a name join silently hands one the
    // other's money. _findTenantByQuestion returns the FIRST tenant whose name
    // appears in the question, so the row belonging to that tenant is the only
    // correct answer, and it is deliberately not the first row.
    const dupName = await page.evaluate(() => {
      const props = [{
        id: 'prop-d', name: 'Twin Plaza', totalSqft: 10000,
        tenants: [
          { id: 'T-FIRST',  tenant_name: 'Vacant Suite', leased_sqft: 1000, lease_type: 'NNN' },
          { id: 'T-SECOND', tenant_name: 'Vacant Suite', leased_sqft: 9000, lease_type: 'NNN' },
        ],
        camReconciliation: { camYear: 2025, total: 100000, results: [
          // The SECOND tenant's row sits first, so a name join returns it.
          { tenantId: 'T-SECOND', tenantName: 'Vacant Suite', totalAllocated: 90000, proRataPercent: 90 },
          { tenantId: 'T-FIRST',  tenantName: 'Vacant Suite', totalAllocated: 10000, proRataPercent: 10 },
        ] },
      }];
      const a = AIWorkspace.answer({ question: 'How much CAM was allocated to Vacant Suite?',
        context: { propertyId: 'prop-d' }, props, acqReviews: [] });
      return { text: [a.heading || ''].concat(a.paragraphs || []).join(' '),
               intent: (a.trace && a.trace.intent) };
    });
    eq(dupName.intent, 'tenant_charge', 'the shared-name question still reaches tenant_charge');
    is(/10,000/.test(dupName.text),
      'the tenant the question resolved to gets ITS row ($10,000), found by tenantId',
      dupName.text.slice(0, 220));
    is(!/90,000/.test(dupName.text),
      'and NOT the other same-named tenant\'s $90,000, which a name join would have returned',
      dupName.text.slice(0, 220));

    // AND NO TENANT RESOLVED MEANS NO TENANT ANSWER. A context tenantId that
    // matches nobody must not quietly become "the first tenant".
    const ghost = await page.evaluate(() => {
      const props = [{
        id: 'prop-g', name: 'Ghost Plaza', totalSqft: 1000,
        tenants: [{ id: 'T-REAL', tenant_name: 'Real Tenant', leased_sqft: 1000, lease_type: 'NNN' }],
        camReconciliation: { camYear: 2025, total: 50000, results: [
          { tenantId: 'T-REAL', tenantName: 'Real Tenant', totalAllocated: 50000, proRataPercent: 100 },
        ] },
      }];
      const a = AIWorkspace.answer({ question: 'Explain this tenant',
        context: { propertyId: 'prop-g', tenantId: 'T-DOES-NOT-EXIST' }, props, acqReviews: [] });
      return { intent: (a.trace && a.trace.intent),
               text: [a.heading || ''].concat(a.paragraphs || []).join(' ') };
    });
    is(ghost.intent !== 'tenant_charge',
      'a tenantId that matches no tenant does not produce a tenant answer',
      `resolved to ${ghost.intent}`);
    // It falls through to the property-level summary, which may legitimately
    // state the property's own CAM total — that is a property fact, not a
    // tenant answer. What must NOT happen is the tenant being named as though
    // the question had resolved to them.
    is(!/Real Tenant/.test(ghost.text),
      'and never names the tenant it did not resolve to', ghost.text.slice(0, 200));

    S('E. "Why not billed" reads the breakdown, and cannot be faked by subtraction');
    // pool − billed is the SIZE of the gap, not its reason. Inject a breakdown
    // whose categories are nothing like a naive subtraction would produce.
    const vb = await ask('Why was the rest of the pool not billed?', {
      varianceBreakdown: {
        propertyId: null, propertyName: 'Cascade Commons',
        breakdown: {
          pool: 1000, billed: 400, difference: 600, residual: 0, explained: true,
          unmatchedInvoices: 0,
          lines: [
            { key: 'caps', label: 'Reduced by a CAM cap', amount: 500 },
            { key: 'uncovered', label: 'Outside the 80.0% of the property covered by loaded leases', amount: 100 },
          ],
        } },
    });
    is(vb.bullets.length === 2, 'it lists exactly the lines the breakdown carried',
      JSON.stringify(vb.bullets));
    is(/Reduced by a CAM cap — \$500/.test(vb.bullets.join(' ')),
      'with the injected label and amount, verbatim', JSON.stringify(vb.bullets));
    is(/\$600/.test(vb.text), 'and states the difference the breakdown reported');
    is(!/47\.1|99,523|75,548/.test(vb.bullets.join(' ')),
      'and nothing leaked in from the real screen', JSON.stringify(vb.bullets));
    const vbUnexplained = await ask('Where did the unbilled money go?', {
      varianceBreakdown: {
        propertyId: null, propertyName: 'X',
        breakdown: { pool: 1000, billed: 400, difference: 600, residual: 250, explained: false,
                     unmatchedInvoices: 3,
                     lines: [{ key: 'residual', label: 'Not attributed', amount: 250 }] } },
    });
    // ON THE PARAGRAPH, NOT THE BULLETS. The injected breakdown already carries
    // a line LABELLED "Not attributed", so an assertion that accepts either
    // would pass with the whole warning paragraph deleted — which is exactly
    // what a mutant did. The warning is a sentence the bullets cannot supply.
    is(/do not account for it/.test(vbUnexplained.text),
      'an unexplained residual gets its own warning paragraph, not just a line item',
      vbUnexplained.text.slice(0, 300));
    is(/\$250/.test(vbUnexplained.text),
      'naming the unattributed amount', vbUnexplained.text.slice(0, 300));
    is(/numbers may be wrong|can mean the numbers are wrong/i.test(vbUnexplained.text),
      'and saying plainly that this is the line which can mean the numbers are wrong',
      vbUnexplained.text.slice(0, 300));
    is(/3 invoices could not be matched/.test(vbUnexplained.text),
      'and the unmatched-invoice count is carried through as incompleteness',
      vbUnexplained.text.slice(0, 300));
    const noVb = await ask('Why was the rest of the pool not billed?', {
      varianceBreakdown: null,
    });
    is(/No reconciliation is open/.test(noVb.heading || ''),
      'no breakdown is not "nothing was left over"', JSON.stringify(noVb.heading));

    // THE REAL GETTER, not the injected stub. Every assertion above replaces
    // deps.varianceBreakdown, so script.js's own exposure is never exercised by
    // them — and a getter that manufactured an empty breakdown instead of
    // declining would sail through. Drive it directly, and put it back.
    const realGetter = await page.evaluate(() => {
      const before = window.varianceBreakdownOnScreen();
      const saved = _lastVarianceBreakdown;
      _lastVarianceBreakdown = null;
      const whenNone = window.varianceBreakdownOnScreen();
      _lastVarianceBreakdown = saved;
      const after = window.varianceBreakdownOnScreen();
      return {
        hasBreakdownNow: !!(before && before.breakdown),
        scopedToProperty: !!(before && before.propertyId) && before.propertyId === currentProperty().id,
        whenNone,
        restored: !!(after && after.breakdown),
      };
    });
    is(realGetter.hasBreakdownNow,
      'varianceBreakdownOnScreen returns the rendered breakdown while one is on screen');
    is(realGetter.scopedToProperty,
      'and stamps the property it belongs to, so another building\'s can be refused');
    is(realGetter.whenNone === null,
      'with nothing rendered it returns NULL — it does not manufacture an empty breakdown',
      JSON.stringify(realGetter.whenNone));
    is(realGetter.restored, 'and the fixture restored what it borrowed');

    // A BREAKDOWN ABOUT ANOTHER BUILDING IS THE WRONG ANSWER, CONFIDENTLY
    // GIVEN. Every stub above carries propertyId null, which skips this guard
    // entirely — so it needs a breakdown that openly belongs elsewhere.
    const wrongProp = await ask('Where did the unbilled money go?', {
      varianceBreakdown: {
        propertyId: 'SOME-OTHER-PROPERTY', propertyName: 'Harborview Retail Center',
        breakdown: { pool: 9999, billed: 1, difference: 9998, residual: 0, explained: true,
                     unmatchedInvoices: 0,
                     lines: [{ key: 'caps', label: 'Reduced by a CAM cap', amount: 9998 }] },
      },
    });
    is(/isn’t .*’s/.test(wrongProp.heading || '') || /Harborview/.test(wrongProp.text),
      'a breakdown scoped to another property is refused, not answered',
      JSON.stringify(wrongProp.heading));
    is(!/9,998/.test(wrongProp.bullets.join(' ') + wrongProp.text),
      'and none of that other building\'s money is reported here',
      JSON.stringify(wrongProp.bullets));

    S('F. A property with no reference record gets an honest miss, not a guess');
    const noInfo = await ask('Who is the property manager?', {
      PropertyReference: null,
    });
    is(/isn’t in .*record/.test(noInfo.heading || ''),
      'the heading says the field is not in the record', JSON.stringify(noInfo.heading));
    is(/won’t guess/.test(noInfo.text), 'and the body says it will not guess');
    is(!/Christy|Alvarez/.test(noInfo.text), 'and names nobody', noInfo.text.slice(0, 200));
    const blankInfo = await ask('Who is the property manager?', {
      PropertyReference: { propertyManager: '   ' },
    });
    is(/isn’t in .*record/.test(blankInfo.heading || ''),
      'a blank value is treated as absent, not printed as an empty answer',
      JSON.stringify(blankInfo.heading));
    const throwInfo = await ask('Who is the property manager?', {
      PropertyReference: '__throw__',
    });
    is(/isn’t in .*record/.test(throwInfo.heading || ''),
      'a reference lookup that throws degrades to the honest miss',
      JSON.stringify(throwInfo.heading));

    S('G. The honest fallback still refuses what MainStreet cannot verify');
    for (const q of MUST_FALL_BACK) {
      const r = await ask(q);
      is(r.intent === 'fallback', `still falls back ← "${q}"`, `resolved to ${r.intent}`);
    }

    S('H. Existing answers this slice did not target are unchanged');
    for (const [q, want] of [
      ['Which tenants have open disputes?', 'disputes'],
      ["What is the CAM cap on Whole Health Market's lease?", 'cam_caps'],
      ['Explain this reconciliation', 'explain_recon'],
      ['Which leases expire next year?', 'expirations'],
      ['Show settlement status', 'settlements'],
    ]) {
      const r = await ask(q);
      is(r.intent === want, `${want} still answers "${q}"`, `resolved to ${r.intent}`);
    }

    S('I. The page loaded clean');
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
