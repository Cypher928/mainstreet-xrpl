'use strict';
/**
 * test-dispute-id-zero.js — a dispute numbered zero is a dispute.
 *
 *   node test-dispute-id-zero.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * normalizePropertyState rejected any dispute failing `!d.id`:
 *
 *     if (!d || typeof d !== 'object' || !d.id) { malformed = true; return false; }
 *
 * `nextDisputeId` starts at 0, so the FIRST dispute anyone ever files carries
 * id 0 — and `!0` is true. Every property silently lost its first dispute on
 * the next load, and the property was flagged `_malformed`, raising an audit
 * event that claimed the data was corrupt. It was not. It was dispute #1.
 *
 * On the demo the app's own diagnostic showed it happening:
 *
 *     [LANDLORD disputes] source: renderProperty   disputesLen: 3
 *     [LANDLORD disputes] source: merge            mergedLen: 3
 *     [LANDLORD disputes] source: renderProperty   disputesLen: 2   ← gone
 *
 * and it surfaced as two separate-looking confusions: the register numbered
 * its disputes #2 and #3 with no #1, and the timeline carried "Dispute opened /
 * resolved — FitZone Athletics" for a dispute the register did not have.
 *
 * WHAT IS NOT CHANGED
 *
 * Not the 0-based id scheme, not nextDisputeId, not the `d.id + 1` display
 * ordinal, not the demo seed, not dispute status semantics or counting. The
 * numbering was already correct; it only looked wrong because record #1 had
 * been deleted underneath it.
 *
 * THE ID CONTRACT, stated exactly. `_isUsableRecordId` accepts any finite
 * number and any non-blank string. Against the old truthiness test that means:
 *
 *   0            was REJECTED, now kept          ← the fix
 *   '0', '4', UUID   accepted, still accepted    ← unchanged
 *   null, undefined, '', '   '  rejected, still rejected
 *   NaN, Infinity, true, {}     were accepted by truthiness, now rejected
 *
 * The last row is a narrowing, listed because it is a real behaviour change:
 * none of those values is an identifier, and none is producible as one by this
 * app (nextDisputeId++ yields finite numbers; JSON turns NaN into null).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { fnSource } = require('./test-support/fn-source');

const ROOT = __dirname;
const PORT = parseInt(process.env.DIZ_PORT || '8977', 10);
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

// ── The identity predicate, called directly ──────────────────────────────────
const SRC = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const isUsableRecordId = new Function(
  fnSource(SRC, '_isUsableRecordId') + '\nreturn _isUsableRecordId;')();

S('A. What counts as an identifier');
{
  is(isUsableRecordId(0) === true, 'ZERO is a usable id — the whole point');
  is(isUsableRecordId(4) === true, 'and 4');
  is(isUsableRecordId(9) === true, 'and 9');
  is(isUsableRecordId(-1) === true, 'and a negative number');
  is(isUsableRecordId('0') === true, 'the string "0" is a usable id, as it always was');
  is(isUsableRecordId('a1b2-uuid') === true, 'and a uuid string');

  is(isUsableRecordId(null) === false, 'null is not an id');
  is(isUsableRecordId(undefined) === false, 'undefined is not an id');
  is(isUsableRecordId('') === false, 'the empty string is not an id');
  is(isUsableRecordId('   ') === false, 'nor is whitespace');
  is(isUsableRecordId(NaN) === false, 'NaN is not an id');
  is(isUsableRecordId(Infinity) === false, 'Infinity is not an id');
  is(isUsableRecordId(true) === false, 'a boolean is not an id');
  is(isUsableRecordId({}) === false, 'an object is not an id');
  is(isUsableRecordId([]) === false, 'an array is not an id');

  // The old rule, reproduced, to show exactly where the two differ.
  const oldRule = (v) => !!v;
  is(oldRule(0) === false && isUsableRecordId(0) === true,
    'the retired truthiness rule really did reject 0, and this one does not');
  is(oldRule('0') === isUsableRecordId('0'),
    'and the two agree about "0", so no string behaviour was broadened');
}

// ── The normalizer, in the app ───────────────────────────────────────────────
let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
               '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
               '.pdf': 'application/pdf', '.woff2': 'font/woff2' };

const SUPABASE_MOCK = `
(function() {
  var _store = { properties: [], tenants: [] };
  var _user = { id: 'diz-user', email: 'diz@e2e-test.local' }, _session = null;
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
    await page.fill('#loginEmail', 'diz@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.locator('#loginBtn').click({ timeout: 12000 });
    await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== '';
    }, null, { timeout: 45000 });

    S('B. normalizePropertyState keeps a dispute numbered zero');
    // NON-SEQUENTIAL IDS THROUGHOUT, so an implementation that quietly used the
    // array position — or position+1 — cannot pass any of these.
    const norm = await page.evaluate(() => {
      const mk = (id) => ({ id, tenantName: 'T' + String(id), status: 'open',
                            timestamp: new Date().toISOString() });
      const run = (ds) => {
        const out = normalizePropertyState({ tenants: [], disputes: ds, activityLog: [], invoices: [] });
        return { ids: (out.disputes || []).map(d => d.id), malformed: !!out._malformed };
      };
      return {
        zeroFourNine: run([0, 4, 9].map(mk)),
        fourNine:     run([4, 9].map(mk)),
        onlyZero:     run([0].map(mk)),
        nullId:       run([mk(4), { tenantName: 'no id', status: 'open' }]),
        explicitNull: run([mk(4), mk(null)]),
        emptyString:  run([mk(4), mk('')]),
        stringZero:   run([mk('0'), mk(9)]),
        notAnObject:  run([mk(0), 'nonsense', null, 42]),
      };
    });
    eq(norm.zeroFourNine, { ids: [0, 4, 9], malformed: false },
      '[0, 4, 9] — all three survive, nothing flagged malformed');
    eq(norm.fourNine, { ids: [4, 9], malformed: false },
      '[4, 9] — both survive');
    eq(norm.onlyZero, { ids: [0], malformed: false },
      '[0] alone survives, and is not malformed');
    is(norm.onlyZero.malformed === false,
      'A VALID ZERO NEVER SETS _malformed — no false audit event about corrupt data');

    S('C. Genuinely missing and malformed records are still rejected');
    eq(norm.nullId, { ids: [4], malformed: true },
      'a dispute with no id at all is dropped and flagged');
    eq(norm.explicitNull, { ids: [4], malformed: true },
      'an explicitly null id is dropped and flagged');
    eq(norm.emptyString, { ids: [4], malformed: true },
      'an empty-string id is dropped and flagged');
    eq(norm.notAnObject, { ids: [0], malformed: true },
      'a string, a null and a number in the array are dropped — the zero-id dispute is not');
    eq(norm.stringZero, { ids: ['0', 9], malformed: false },
      'the string "0" is still accepted, exactly as before — no id type was broadened');

    S('D. The demo survives seed → persistence → normalization → reload');
    await page.waitForSelector('.ptf-demo-card', { timeout: 20000 });
    await page.locator('.ptf-demo-card').filter({ hasText: 'Cascade Commons' })
      .first().locator('.ptf-card-open-btn').first().click({ timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Cascade Commons';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.switchWorkspaceTab && window.switchWorkspaceTab('cam'));
    await page.waitForTimeout(3000);

    const loaded = await page.evaluate(() => {
      const p = window.currentProperty();
      return {
        onProperty: (p.disputes || []).map(d => ({ id: d.id, tenant: d.tenantName, status: d.status })),
        inGlobal: (typeof disputes !== 'undefined' ? disputes : []).map(d => d.id),
        nextDisputeId: typeof nextDisputeId !== 'undefined' ? nextDisputeId : null,
      };
    });
    eq(loaded.onProperty.map(d => d.id), [0, 1, 2],
      'all three seeded disputes reach the loaded property');
    eq(loaded.onProperty[0], { id: 0, tenant: 'FitZone Athletics', status: 'accepted' },
      'including FitZone at id 0 — the one that used to vanish');
    eq(loaded.inGlobal, [0, 1, 2], 'and the working set holds the same three');
    eq(loaded.nextDisputeId, 3, 'nextDisputeId is unchanged at 3 — the id scheme is untouched');

    S('E. Rendered — the register numbers them from the ids it has');
    const rendered = await page.evaluate(() => {
      const sec = document.getElementById('disputeSection');
      return {
        metas: [...sec.querySelectorAll('.d-meta')].map(e => (e.textContent || '').trim()),
        actions: [...sec.querySelectorAll('button,a[onclick]')]
          .map(b => b.getAttribute('onclick')).filter(Boolean)
          .filter(s => /Dispute|dispute/.test(s)),
        // The count lives in its own element beside the label, so read it there.
        resolvedCounter: (document.getElementById('resolvedCount') || {}).textContent || null,
      };
    });
    is(rendered.metas.some(m => /^#1 · FitZone Athletics/.test(m)),
      'FitZone now appears as #1', JSON.stringify(rendered.metas));
    is(rendered.metas.some(m => /^#2 · Whole Health Market/.test(m)),
      'Whole Health remains #2', JSON.stringify(rendered.metas));
    is(rendered.metas.some(m => /^#3 · Summit Coffee & Provisions/.test(m)),
      'Summit remains #3', JSON.stringify(rendered.metas));
    eq(rendered.metas.length, 3, 'three disputes are listed, not two');

    S('F. Actions still target the RAW id, never the displayed ordinal');
    is(rendered.actions.includes('openDisputeWorkspace(0)'),
      'the dispute displayed as #1 opens raw id 0', JSON.stringify(rendered.actions));
    is(rendered.actions.includes('openDisputeWorkspace(1)'),
      'the dispute displayed as #2 opens raw id 1');
    is(rendered.actions.includes('openDisputeWorkspace(2)'),
      'the dispute displayed as #3 opens raw id 2');
    is(!rendered.actions.includes('openDisputeWorkspace(3)'),
      'and nothing opens id 3 — no display ordinal leaked into a lookup',
      JSON.stringify(rendered.actions));
    is(rendered.actions.includes("resolveDispute(1,'accepted')") &&
       rendered.actions.includes("resolveDispute(2,'accepted')"),
      'the open disputes still resolve by raw id');

    S('G. Status and counting semantics are unchanged');
    const tally = await page.evaluate(() => {
      const p = window.currentProperty();
      const DS = window.DisputeStatus;
      return { tally: DS.tally(p.disputes || []),
               classes: (p.disputes || []).map(d => ({ id: d.id, cls: DS.classify(d.status) })) };
    });
    eq(tally.tally, { total: 3, open: 2, closed: 1, unknown: 0, unknownStatuses: [] },
      'the tally now sees all three: 2 open, 1 closed');
    eq(tally.classes, [{ id: 0, cls: 'closed' }, { id: 1, cls: 'open' }, { id: 2, cls: 'open' }],
      'and each keeps the class its own status maps to — docs_requested is still open');
    eq(String(rendered.resolvedCounter).trim(), '1',
      'the resolved counter reads 1, matching the timeline that always said one was resolved');

    S('H. The id allocator is untouched, and survives non-sequential ids');
    // THE DEMO MASKS THIS. Its ids are 0,1,2, so `max(id + 1)` and
    // `disputes.length` are both 3 and an allocator using either reads the
    // same. With 0,4,9 they diverge — length says 3, which would hand the next
    // dispute an id that already exists. Drive the real load path and see.
    const alloc = await page.evaluate(() => {
      const p = window.currentProperty();
      const saved = p.disputes;
      const out = {};
      try {
        p.disputes = [0, 4, 9].map(id => ({ id, tenantName: 'T' + id, status: 'open',
                                            timestamp: new Date().toISOString() }));
        renderProperty(p);
        out.afterNonSequential = nextDisputeId;
        out.idsKept = (typeof disputes !== 'undefined' ? disputes : []).map(d => d.id);
      } finally {
        p.disputes = saved;
        renderProperty(p);
      }
      out.restored = nextDisputeId;
      out.restoredIds = (typeof disputes !== 'undefined' ? disputes : []).map(d => d.id);
      return out;
    });
    eq(alloc.idsKept, [0, 4, 9], 'a non-sequential set loads intact, zero included');
    eq(alloc.afterNonSequential, 10,
      'the next id is 10 — one past the HIGHEST id, not the count of disputes');
    is(alloc.afterNonSequential !== 3,
      'and specifically not 3, which is what counting them would have given',
      String(alloc.afterNonSequential));
    eq(alloc.restored, 3, 'the fixture put the demo back');
    eq(alloc.restoredIds, [0, 1, 2], 'with its three disputes');

    const fresh = await page.evaluate(() => {
      // The counter's STARTING value, read before any property has been loaded.
      // The load path only overwrites it when saved disputes exist, so on a
      // brand-new property this is the id the first dispute will carry.
      const el = document.createElement('iframe');
      el.style.display = 'none';
      document.body.appendChild(el);
      return new Promise(resolve => {
        el.onload = () => {
          // `nextDisputeId` is a top-level `let`, which is script-scoped rather
          // than a window property — so it has to be read through eval in that
          // frame's own global scope, not off contentWindow.
          try { resolve(el.contentWindow.eval('nextDisputeId')); }
          catch (e) { resolve('unreadable: ' + e.message); }
          finally { el.remove(); }
        };
        el.src = location.href;
      });
    });
    eq(fresh, 0,
      'a fresh session starts the counter at 0 — the first dispute anyone files is id 0, which is the whole reason this bug existed');

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
