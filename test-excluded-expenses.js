'use strict';
/**
 * test-excluded-expenses.js — the four excluded invoices, accounted for.
 *
 *   node test-excluded-expenses.js
 *
 * WHAT THIS EXISTS FOR
 *
 * The ProActive result card said "Included 22 of 26" and stopped. The other four
 * expenses were a number with no account: the manager could see that something
 * had been held back and had no way to learn what, or why, or how much.
 *
 * The answer was already recorded. `result.excludedShares` is built by the
 * allocation loop when a lease's exclusion schedule withholds a category (D8),
 * and it carries `{id, vendorName, category, scope, cents}` per decision. This
 * slice reads that list onto the card. It derives nothing, re-applies no
 * predicate, and changes no figure — `22 of 26` is byte-identical before and
 * after.
 *
 * THE TRAP THIS SUITE IS BUILT AROUND
 *
 * On Cascade Commons, `denominator - eligibleCount` equals
 * `excludedShares.length` for EVERY tenant — 4 = 26 − 22, and 0 = 26 − 26 for
 * the other four. A renderer that claimed "these records account for the
 * difference" unconditionally would look perfect on the demo and lie on the
 * first property with an invoice held out for any other reason. `excludedShares`
 * records ONE reason, a lease schedule; the same loop also holds invoices out
 * for reasons it never exposes (outside the occupancy window, undated,
 * direct-matched to another tenant). So section C below uses a fixture where the
 * two numbers DIFFER, and that is the assertion that matters most here.
 *
 * WHAT IS NOT CHANGED, and is asserted so: eligibleCount, the denominators, the
 * exclusion predicate, excludedShares generation, invoice ids, lastInvoicesFull,
 * the demo data, allocation, or any amount.
 *
 * THE TWO FUNCTIONS ARE CALLED, NOT GREPPED. `excludedExpenseSummary` decides
 * what is true and is exercised directly; `_excludedExpensesHtml` renders it and
 * is exercised through its real output. Section G proves both card renderers
 * route through the one builder by REPLACING it and watching both paths change.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const PORT = parseInt(process.env.EXC_PORT || '8973', 10);
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
  var _user = { id: 'exc-user', email: 'exc@e2e-test.local' }, _session = null;
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
    await page.fill('#loginEmail', 'exc@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.locator('#loginBtn').click({ timeout: 12000 });
    await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== '';
    }, null, { timeout: 45000 });

    // ── A · THE SUMMARY, CALLED ────────────────────────────────────────────
    // A function cannot cross page.evaluate, so every fixture is built inside
    // the page from plain data.
    S('A. excludedExpenseSummary — the shape of the answer');
    const A = await page.evaluate(() => {
      const rec = () => ({ id: null, vendorName: 'Cascade Property Management',
                           category: 'management', scope: 'shared', cents: 128615 });
      const four = [rec(), rec(), rec(), rec()];
      const s = excludedExpenseSummary({ eligibleCount: 22, excludedShares: four }, 26);
      return {
        count: s.count,
        recordCount: s.records.length,
        total: s.totalWithheldCents,
        residual: s.residual,
        gap: s.gap,
        denominator: s.denominator,
        eligibleCount: s.eligibleCount,
        anyIdentified: s.anyIdentified,
        firstRecord: s.records[0],
      };
    });
    eq(A.count, 4, 'four recorded exclusions are reported as four');
    eq(A.recordCount, 4, 'and four rows of detail are produced');
    eq(A.total, 514460, 'the total withheld is the exact sum of stored cents (4 × 128615)');
    eq(A.residual, 0, 'residual = 26 − 22 − 4 = 0');
    eq(A.gap, 'accounted', 'so the gap verdict is "accounted"');
    eq(A.firstRecord, { vendorName: 'Cascade Property Management', category: 'management',
                        scope: 'shared', withheldCents: 128615, identified: false },
      'a record carries vendor, category, scope and withheld cents — and nothing it was not given');
    is(A.anyIdentified === false, 'with null ids, nothing claims to be identified');

    // ── B · REQUIREMENT 1 — the Cascade-style case, rendered ───────────────
    S('B. The Cascade case: 26 total, 22 eligible, 4 excluded');
    const B = await page.evaluate(() => {
      const rec = () => ({ id: null, vendorName: 'Cascade Property Management',
                           category: 'management', scope: 'shared', cents: 128615 });
      const html = _excludedExpensesHtml(
        { eligibleCount: 22, excludedShares: [rec(), rec(), rec(), rec()] }, 26);
      const d = document.createElement('div'); d.innerHTML = html;
      const t = e => e ? (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : null;
      return {
        rows: [...d.querySelectorAll('.rc-excl-row')].map(t),
        meta: t(d.querySelector('.rc-excl-meta')),
        total: t(d.querySelector('.rc-excl-total')),
        gap: t(d.querySelector('.rc-excl-gap')),
      };
    });
    eq(B.rows.length, 4, 'four rows render — one per recorded decision');
    eq(B.meta, '4 records', 'the section leads with the count');
    is(/\$5,144\.60/.test(B.total), 'the total withheld renders as $5,144.60', B.total);
    is(/account for the difference/.test(B.gap),
      'with residual 0, the records may be said to account for the difference', B.gap);
    is(/\b26\b/.test(B.gap) && /\b22\b/.test(B.gap),
      'and the sentence names both figures it reconciles', B.gap);

    // ── C · REQUIREMENT 2 — the residual the demo can never show ───────────
    S('C. A gap LARGER than the exclusion records — the disclosure that matters');
    const C = await page.evaluate(() => {
      const rec = () => ({ id: null, vendorName: 'Cascade Property Management',
                           category: 'management', scope: 'shared', cents: 128615 });
      // 26 in the run, 20 billed to this tenant, only 4 explained by a lease
      // schedule. Two are held out for a reason this record does not carry.
      const r = { eligibleCount: 20, excludedShares: [rec(), rec(), rec(), rec()] };
      const s = excludedExpenseSummary(r, 26);
      const d = document.createElement('div');
      d.innerHTML = _excludedExpensesHtml(r, 26);
      const t = e => e ? (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : null;
      return { residual: s.residual, gap: s.gap, sentence: t(d.querySelector('.rc-excl-gap')),
               rows: d.querySelectorAll('.rc-excl-row').length,
               count: s.count, meta: t(d.querySelector('.rc-excl-meta')) };
    });
    eq(C.residual, 2, 'residual = 26 − 20 − 4 = 2');
    // THE COUNT IS THE RECORDS, NOT THE GAP. Here the gap is 6 and the records
    // are 4, so the two finally disagree — on the Cascade figures they are both
    // 4 and a count derived from the gap would pass unnoticed.
    eq(C.count, 4, 'the count is the 4 recorded exclusions, NOT the 6-expense gap');
    eq(C.meta, '4 records', 'and the section still leads with 4 records, not 6');
    eq(C.gap, 'partial', 'the verdict is "partial", not "accounted"');
    is(/\b2 further expenses\b/.test(C.sentence),
      'the two unattributed expenses are stated explicitly', C.sentence);
    is(/not attributed/.test(C.sentence),
      'and named as NOT attributed by the records shown', C.sentence);
    is(!/account for the difference/.test(C.sentence),
      'THE OVERCLAIM IS ABSENT — it never says these records account for the gap', C.sentence);
    is(!/occupancy|window|undated|unmatched|vacan/i.test(C.sentence),
      'and it does not guess WHY they were held out — no reason is invented', C.sentence);
    eq(C.rows, 4, 'the four recorded exclusions still render, unchanged by the residual');

    // ── D · REQUIREMENT 3 — identical records stay distinct ────────────────
    S('D. Four identical-looking records are four decisions');
    const D = await page.evaluate(() => {
      const rec = () => ({ id: null, vendorName: 'Cascade Property Management',
                           category: 'management', scope: 'shared', cents: 128615 });
      const s = excludedExpenseSummary({ eligibleCount: 22, excludedShares: [rec(), rec(), rec(), rec()] }, 26);
      const d = document.createElement('div');
      d.innerHTML = _excludedExpensesHtml({ eligibleCount: 22, excludedShares: [rec(), rec(), rec(), rec()] }, 26);
      return { count: s.count, records: s.records.length, total: s.totalWithheldCents,
               rows: d.querySelectorAll('.rc-excl-row').length };
    });
    eq(D.count, 4, 'the count is 4, not 1 — identical display fields are not one record');
    eq(D.records, 4, 'four records survive into the summary');
    eq(D.rows, 4, 'and four rows survive into the markup');
    eq(D.total, 514460, 'the total is four shares, not one — dedup would report $1,286.15');

    // ── E · REQUIREMENT 4 — no exclusions, no section ──────────────────────
    S('E. An empty exclusion record renders no section');
    const E = await page.evaluate(() => ({
      emptyArray:  excludedExpenseSummary({ eligibleCount: 26, excludedShares: [] }, 26),
      missing:     excludedExpenseSummary({ eligibleCount: 26 }, 26),
      notAnArray:  excludedExpenseSummary({ eligibleCount: 26, excludedShares: 'nonsense' }, 26),
      nullResult:  excludedExpenseSummary(null, 26),
      htmlEmpty:   _excludedExpensesHtml({ eligibleCount: 26, excludedShares: [] }, 26),
      htmlMissing: _excludedExpensesHtml({ eligibleCount: 26 }, 26),
    }));
    is(E.emptyArray === null, 'an empty list yields null, not an empty section');
    is(E.missing === null, 'a result with no excludedShares at all yields null');
    is(E.notAnArray === null, 'a non-array excludedShares yields null rather than throwing');
    is(E.nullResult === null, 'a null result yields null');
    eq(E.htmlEmpty, '', 'and the markup is the empty string — no false exclusion section');
    eq(E.htmlMissing, '', 'likewise when the field is absent');

    // ── F · REQUIREMENT 5 — identity is never fabricated ──────────────────
    S('F. Null ids: nothing is invented');
    const F = await page.evaluate(() => {
      const rec = (id) => ({ id, vendorName: 'Cascade Property Management',
                             category: 'management', scope: 'shared', cents: 128615 });
      const nulls = [rec(null), rec(null), rec(null), rec(null)];
      const real  = [rec('inv-abc-4'), rec('inv-def-12')];
      const sN = excludedExpenseSummary({ eligibleCount: 22, excludedShares: nulls }, 26);
      const sR = excludedExpenseSummary({ eligibleCount: 24, excludedShares: real }, 26);
      const dN = document.createElement('div');
      dN.innerHTML = _excludedExpensesHtml({ eligibleCount: 22, excludedShares: nulls }, 26);
      const dR = document.createElement('div');
      dR.innerHTML = _excludedExpensesHtml({ eligibleCount: 24, excludedShares: real }, 26);
      const t = e => e ? (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : null;
      return {
        nullIdentified: sN.records.map(x => x.identified),
        realIdentified: sR.records.map(x => x.identified),
        nullAny: sN.anyIdentified, realAny: sR.anyIdentified,
        nullNote: t(dN.querySelector('.rc-excl-idnote')),
        realNote: t(dR.querySelector('.rc-excl-idnote')),
        nullText: t(dN),
      };
    });
    eq(F.nullIdentified, [false, false, false, false], 'a null id is not an identity');
    eq(F.realIdentified, [true, true], 'a real id is');
    is(F.nullAny === false && F.realAny === true, 'anyIdentified follows the records');
    is(F.nullNote && /cannot be linked to individual invoices/.test(F.nullNote),
      'when nothing is identified, the section SAYS SO once', F.nullNote);
    is(F.realNote === null, 'and says nothing when the records do carry references');
    is(!/\d{4}-\d{2}-\d{2}/.test(F.nullText || ''),
      'NO DATE APPEARS ANYWHERE — the record carries none and none is invented', F.nullText);
    is(!/inv-/.test(F.nullText || ''),
      'and no invoice reference is fabricated', F.nullText);

    // ── G · REQUIREMENT 6 — one builder, both renderers ───────────────────
    S('G. Live and restored cards route through the SAME builder');
    // Open Cascade Commons the way a manager does — the CAM tab renders the
    // property that is actually open, and its results card is replayed from the
    // persisted snapshot, not recomputed.
    await page.waitForSelector('.ptf-demo-card', { timeout: 25000 });
    await page.locator('.ptf-demo-card').filter({ hasText: 'Cascade Commons' })
      .first().locator('.ptf-card-open-btn').first().click({ timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Cascade Commons';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.switchWorkspaceTab && window.switchWorkspaceTab('cam'));
    await page.waitForTimeout(3000);

    const G = await page.evaluate(async () => {
      const card = () => document.getElementById('result-card-ProActive-Physical-Therapy');
      const openAndRead = () => {
        const c = card();
        if (!c) return { card: 'ABSENT' };
        const tg = c.querySelector('.rc-breakdown-toggle');
        if (tg) tg.click();
        const b = c.querySelector('.rc-excl-block');
        if (b) { const h = b.querySelector('.rc-excl-head'); if (h) h.click(); }
        const t = e => e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : null;
        return {
          present: !!b,
          meta: t(b && b.querySelector('.rc-excl-meta')),
          rows: b ? [...b.querySelectorAll('.rc-excl-row')].map(t) : [],
          total: t(b && b.querySelector('.rc-excl-total')),
          gap: t(b && b.querySelector('.rc-excl-gap')),
          sentinel: !!(c.querySelector('#excl-sentinel')),
          idNote: t(b && b.querySelector('.rc-excl-idnote')),
          blockText: t(b),
          registerLen: (typeof lastInvoicesFull !== 'undefined' ? (lastInvoicesFull || []) : []).length,
          // What the RECORD carries on this path, read straight off the result.
          recordIds: (() => {
            const rr = lastResults.find(x => /ProActive/.test(x.name));
            return ((rr && rr.excludedShares) || []).map(e => e && e.id);
          })(),
          stat: [...c.querySelectorAll('.result-stat')]
            .map(e => t(e)).find(s => /Included/i.test(s || '')) || null,
        };
      };

      // 1 — the RESTORED card, which is what the manager lands on.
      const restored = openAndRead();

      // 2 — the LIVE card, from runAllocation.
      await window.runAllocation();
      const live = openAndRead();

      // 3 — REPLACE the shared builder and re-render both. If either renderer
      //     had its own copy of this markup, its output would not change.
      const orig = _excludedExpensesHtml;
      window._excludedExpensesHtml = () => '<div id="excl-sentinel">SENTINEL</div>';
      await window.runAllocation();
      const liveSwapped = openAndRead();
      restoreResultsDisplay();
      const restoredSwapped = openAndRead();
      window._excludedExpensesHtml = orig;

      return { restored, live, liveSwapped, restoredSwapped };
    });
    is(G.restored.present === true,
      'the RESTORED card (what the manager lands on) shows the exclusion section');
    is(G.live.present === true, 'and so does the LIVE card after a run');
    eq(G.restored.rows.length, 4, 'restored: four rows');
    eq(G.live.rows.length, 4, 'live: four rows');
    is(G.restored.total === G.live.total,
      'both paths state the same total withheld', `${G.restored.total} vs ${G.live.total}`);
    is(G.restored.gap === G.live.gap,
      'and word the residual identically — they cannot drift', `${G.restored.gap} vs ${G.live.gap}`);
    is(G.liveSwapped.sentinel === true,
      'replacing the builder changes the LIVE card — it really calls it');
    is(G.restoredSwapped.sentinel === true,
      'and changes the RESTORED card — one builder, not two copies');

    // ── THE JOIN IS REFUSED WHERE IT WOULD SUCCEED ─────────────────────────
    // The two paths genuinely differ in what the RECORD carries, and each must
    // report its own truth rather than the other's:
    //
    //   RESTORED — the seeded snapshot was computed before ids were stamped, so
    //              `excludedShares` carries id: null. The register IS loaded and
    //              holds four `Cascade Property Management / management` rows
    //              whose vendor and category match these records exactly, so a
    //              renderer reaching for identity by matching those fields would
    //              find all four and drop the disclosure. It must not:
    //              vendor+category cannot say WHICH invoice a record belongs to,
    //              which is why variance-breakdown.js refuses the same join.
    //   LIVE     — runAllocation reads ids from the register, so the records
    //              really are referenced and the disclosure is correctly absent.
    is(G.restored.registerLen === 26 && G.live.registerLen === 26,
      'the invoice register is loaded on both paths, so a join WOULD find matches',
      `${G.restored.registerLen} / ${G.live.registerLen}`);
    is(G.restored.recordIds.every(v => v === null),
      'RESTORED: the exclusion records carry no invoice reference',
      JSON.stringify(G.restored.recordIds));
    is(G.restored.idNote && /cannot be linked to individual invoices/.test(G.restored.idNote),
      'so the restored card SAYS they cannot be linked — the available join is refused',
      G.restored.idNote);
    is(G.live.recordIds.length === 4 && G.live.recordIds.every(v => typeof v === 'string' && v),
      'LIVE: the same records do carry references, read from the register by the engine',
      JSON.stringify(G.live.recordIds));
    is(G.live.idNote === null,
      'so the live card omits the disclosure — it is not claiming an absence it does not have',
      G.live.idNote);
    is(!/\d{4}-\d{2}-\d{2}/.test(G.restored.blockText || ''),
      'no invoice date appears on the restored card, though the register carries four',
      G.restored.blockText);
    is(!/\d{4}-\d{2}-\d{2}/.test(G.live.blockText || ''),
      'nor on the live card, where a date could have been joined by id',
      G.live.blockText);
    is(!/inv-/.test(G.restored.blockText || '') && !/inv-/.test(G.live.blockText || ''),
      'and no raw invoice reference is printed at a manager on either path');

    // ── H · REQUIREMENT 7 — the count itself is untouched ─────────────────
    S('H. "22 of 26" is unchanged');
    eq(G.restored.stat, 'INCLUDED EXPENSES 22 of 26',
      'the restored card still reads exactly "INCLUDED EXPENSES 22 of 26"');
    eq(G.live.stat, 'INCLUDED 22 of 26',
      'and the live card exactly "INCLUDED 22 of 26" — neither label nor figure moved');
    const H = await page.evaluate(() => {
      const r = lastResults.find(x => /ProActive/.test(x.name));
      return {
        eligibleCount: r.eligibleCount,
        included: (r.includedInvoices || []).length,
        excluded: (r.excludedShares || []).length,
        denominator: (lastInvoicesFull || []).length,
        allocated: r.allocatedAmount,
        others: lastResults.filter(x => !/ProActive/.test(x.name))
          .map(x => ({ n: x.name, e: x.eligibleCount, x: (x.excludedShares || []).length })),
      };
    });
    eq(H.eligibleCount, 22, 'eligibleCount is still 22');
    eq(H.included, 22, 'includedInvoices is still 22 long');
    eq(H.excluded, 4, 'excludedShares is still 4 long — generation untouched');
    eq(H.allocated, 13780, 'and the allocated amount is unchanged at $13,780');
    is(H.others.every(o => o.e === 26 && o.x === 0),
      'the other four tenants are still 26-of-26 with no exclusions', JSON.stringify(H.others));

    // ── I · the unknown denominator is REPORTED, never assumed ────────────
    S('I. An unsupplied denominator claims nothing');
    const I = await page.evaluate(() => {
      const rec = () => ({ id: null, vendorName: 'V', category: 'management',
                           scope: 'shared', cents: 1000 });
      const r = { eligibleCount: 22, excludedShares: [rec(), rec()] };
      const mk = (den) => {
        const s = excludedExpenseSummary(r, den);
        const d = document.createElement('div');
        d.innerHTML = _excludedExpensesHtml(r, den);
        const g = d.querySelector('.rc-excl-gap');
        return { residual: s.residual, gap: s.gap,
                 sentence: g ? (g.textContent || '').replace(/\s+/g, ' ').trim() : null };
      };
      const negative = excludedExpenseSummary({ eligibleCount: 24, excludedShares: [rec(), rec(), rec(), rec()] }, 26);
      const dn = document.createElement('div');
      dn.innerHTML = _excludedExpensesHtml({ eligibleCount: 24, excludedShares: [rec(), rec(), rec(), rec()] }, 26);
      const gn = dn.querySelector('.rc-excl-gap');
      return {
        omitted: mk(undefined), nulled: mk(null), nan: mk(NaN), text: mk('26'),
        noEligible: excludedExpenseSummary({ excludedShares: [rec()] }, 26).gap,
        negResidual: negative.residual, negGap: negative.gap,
        negSentence: gn ? (gn.textContent || '').replace(/\s+/g, ' ').trim() : null,
      };
    });
    for (const [k, v] of Object.entries({ omitted: I.omitted, nulled: I.nulled, nan: I.nan, text: I.text })) {
      is(v.residual === null, `a ${k} denominator yields residual null — not 0`);
      is(v.gap === 'unknown', `and gap "unknown" — not "accounted"`);
      is(!/account for the difference/.test(v.sentence || ''),
        `and the ${k} case never claims the records account for the gap`, v.sentence);
    }
    eq(I.noEligible, 'unknown', 'a missing eligibleCount is equally unknown, not zero');
    eq(I.negResidual, -2, 'more records than gap gives a negative residual');
    eq(I.negGap, 'inconsistent', 'which is reported as "inconsistent"');
    is(/do not reconcile/.test(I.negSentence || ''),
      'and said plainly rather than rounded up to "accounted"', I.negSentence);

    // ── J · cents is a withheld share, and is never called a total ────────
    S('J. The withheld share is not labelled an invoice total');
    const J = await page.evaluate(() => {
      const r = { eligibleCount: 22, excludedShares: [
        { id: null, vendorName: 'V', category: 'management', scope: 'shared', cents: 128615 },
        { id: null, vendorName: 'W', category: 'capital', scope: 'direct', cents: 760000 },
        { id: null, vendorName: 'X', category: null, scope: null, cents: null },
      ] };
      const s = excludedExpenseSummary(r, 26);
      const d = document.createElement('div');
      d.innerHTML = _excludedExpensesHtml(r, 26);
      const flat = e => (e ? (e.textContent || '') : '').replace(/\s+/g, ' ').trim();
      const rows = [...d.querySelectorAll('.rc-excl-row')].map(flat);
      return {
        rows, total: s.totalWithheldCents,
        caveat: flat(d.querySelector('.rc-excl-caveat')),
        // Every label attached to an amount, and the total's own label.
        amountLabels: [...d.querySelectorAll('.rc-excl-amt-lbl')].map(flat),
        totalLabel: flat(d.querySelector('.rc-excl-total')),
      };
    });
    // The phrase may appear ONCE, in the disclaimer that denies it. What must
    // never happen is an AMOUNT being labelled an invoice total, so this checks
    // the labels rather than the whole block.
    is(J.rows.every(t => !/invoice total/i.test(t)),
      'no row labels its amount an invoice total', J.rows.join(' || '));
    is(J.amountLabels.every(l => l === 'WITHHELD'),
      'every amount is labelled WITHHELD and nothing else', JSON.stringify(J.amountLabels));
    is(/withheld/i.test(J.totalLabel) && !/invoice total/i.test(J.totalLabel),
      'and the total is "withheld from this tenant", not an invoice total', J.totalLabel);
    is(/not the invoice totals/i.test(J.caveat),
      'the caveat says outright that these are not invoice totals', J.caveat);
    is(/withheld/i.test(J.rows[0]), 'each amount is labelled as withheld', J.rows[0]);
    is(/Shared expense/.test(J.rows[0]) && /Direct charge/.test(J.rows[1]),
      'scope is reported per record, shared and direct distinctly');
    is(/Excluded by lease schedule: management/.test(J.rows[0]),
      'the reason names the schedule term the loop matched', J.rows[0]);
    is(/category not recorded/.test(J.rows[2]),
      'and an unrecorded category says so rather than naming nothing', J.rows[2]);
    is(/Scope not recorded/.test(J.rows[2]), 'likewise an unrecorded scope', J.rows[2]);
    is(/Not recorded/.test(J.rows[2]), 'and an unreadable amount is "Not recorded", never $0.00', J.rows[2]);
    is(J.total === null,
      'ONE UNREADABLE AMOUNT MAKES THE TOTAL UNKNOWN — it is not summed as if it were zero');

    // ── K · the reason is read, not guessed from the vendor ───────────────
    S('K. The reason comes from the record, not the vendor');
    const K = await page.evaluate(() => {
      // Same vendor, two different recorded categories. A renderer inferring the
      // reason from the vendor would print one term twice.
      const r = { eligibleCount: 22, excludedShares: [
        { id: null, vendorName: 'Cascade Property Management', category: 'management', scope: 'shared', cents: 100 },
        { id: null, vendorName: 'Cascade Property Management', category: 'capital', scope: 'shared', cents: 200 },
      ] };
      const d = document.createElement('div');
      d.innerHTML = _excludedExpensesHtml(r, 26);
      return [...d.querySelectorAll('.rc-excl-reason')].map(e => (e.textContent || '').trim());
    });
    eq(K, ['Excluded by lease schedule: management', 'Excluded by lease schedule: capital'],
      'two records from one vendor report their own two categories');

    // ── L · HTML is escaped ───────────────────────────────────────────────
    S('L. Recorded strings are escaped');
    const L = await page.evaluate(() => {
      const r = { eligibleCount: 1, excludedShares: [
        { id: null, vendorName: '<img src=x onerror=alert(1)>', category: '<b>mgmt</b>',
          scope: 'shared', cents: 100 } ] };
      const d = document.createElement('div');
      d.innerHTML = _excludedExpensesHtml(r, 6);
      return { imgs: d.querySelectorAll('img').length, bolds: d.querySelectorAll('b').length,
               text: (d.querySelector('.rc-excl-vendor') || {}).textContent || '' };
    });
    eq(L.imgs, 0, 'a vendor name cannot inject an element');
    eq(L.bolds, 0, 'nor can a category');
    is(/<img/.test(L.text), 'the raw text is preserved as text', L.text);

    S('M. The page loaded clean');
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
