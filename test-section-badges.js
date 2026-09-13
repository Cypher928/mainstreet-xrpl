'use strict';
/**
 * test-section-badges.js — the badge names its subject; it does not number it.
 *
 *   node test-section-badges.js
 *
 * WHAT THIS EXISTS FOR
 *
 * Seven section badges carried the digits 1, 3, 4, 5, 6, 7, 8. They were
 * authored when index.html was one linear scrolling page. property-os.js
 * `_reparent()` later moved the cards into subject tabs, and the digits were
 * never updated, so no reader ever saw the run: Property showed 1, CAM showed
 * 3-4-5, Reports 6, Reserves 7-8, and the Spaces card that had been 2 was
 * re-badged in an earlier slice — leaving a hole nobody could account for.
 *
 * THE NUMBERS WERE NOT IDENTITY, AND THIS SUITE PINS THAT. They were literal
 * text nodes: no producer, no collection, no id, no index. Section F feeds
 * NON-SEQUENTIAL dispute ids (0, 4, 9) and empties the tenant and invoice
 * collections, then asserts the badge map is unchanged — the check that
 * separates this from the dispute #2/#3 case, where a displayed number really
 * did sit over a collection that was losing a record.
 *
 * WHY GLYPHS AND NOT 1-8. Five tabs cannot be walked 1 -> 8 in order, so
 * renumbering would restore a linear claim the navigation no longer supports and
 * create a third numbering system beside the two that already agree:
 *
 *   updateStepBar()          live, state-driven, 1-5 with checkmarks  (section C)
 *   the onboarding modal     static 1-5, the same five steps          (section D)
 *
 * Both are left exactly as they were, and both are asserted here so that a later
 * "tidy up the numbering" change cannot quietly take them with it.
 *
 * WHAT IS NOT CHANGED: no data, no ids, no CAM logic, no reports, no reserves,
 * no disputes, no AI, no `_reparent()`, no tab behaviour. Section B proves every
 * re-badged card is still reachable and still works, by using it rather than by
 * looking for its markup.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const PORT = parseInt(process.env.ORD_PORT || '8971', 10);
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
  var _user = { id: 'ord-user', email: 'ord@e2e-test.local' }, _session = null;
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

// The seven cards whose badge was a digit, and the tab each actually lives on
// after `_reparent()` has run.
const AFFECTED = [
  { id: 'cardSetup',             tab: 'property', was: '1' },
  { id: 'cardInvoices',          tab: 'cam',      was: '3' },
  { id: 'results',               tab: 'cam',      was: '4' },
  { id: 'disputeSection',        tab: 'cam',      was: '5' },
  { id: 'reportsSection',        tab: 'reports',  was: '6' },
  { id: 'escrowSection',         tab: 'reserves', was: '7' },
  { id: 'escrowRequestsSection', tab: 'reserves', was: '8' },
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
    await page.fill('#loginEmail', 'ord@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.locator('#loginBtn').click({ timeout: 12000 });
    await page.waitForFunction(() => {
      const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== '';
    }, null, { timeout: 45000 });

    // ── D · the onboarding modal, read BEFORE the demo is opened ───────────
    // It is static markup and the one place a 1-5 list is authored by hand.
    S('D. The onboarding 1-5 is untouched');
    const D = await page.evaluate(() =>
      [...document.querySelectorAll('.ob-modal-step')].map(li => ({
        num: ((li.querySelector('.ob-modal-step-num') || {}).textContent || '').trim(),
        text: ((li.querySelector('.ob-modal-step-text') || {}).textContent || '')
          .replace(/\s+/g, ' ').trim(),
      })));
    eq(D.map(x => x.num), ['1', '2', '3', '4', '5'],
      'the onboarding modal still numbers its five steps 1-5, with no hole');
    is(/Name your property/.test(D[0].text) && /Review/.test(D[4].text),
      'and still names the same first and last step', D.map(x => x.text.slice(0, 24)).join(' | '));

    // Open Cascade Commons the way a manager does.
    await page.waitForSelector('.ptf-demo-card', { timeout: 25000 });
    await page.locator('.ptf-demo-card').filter({ hasText: 'Cascade Commons' })
      .first().locator('.ptf-card-open-btn').first().click({ timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('propertyName');
      return el && el.value === 'Cascade Commons';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2500);

    // ── A · the badge slot holds one vocabulary ────────────────────────────
    S('A. No section badge is a bare ordinal, on any tab');
    const A = await page.evaluate(async (AFFECTED) => {
      const tabs = (typeof WORKSPACE_TABS !== 'undefined') ? WORKSPACE_TABS : [];
      const byTab = {};
      for (const t of tabs) {
        window.switchWorkspaceTab(t);
        await new Promise(r => setTimeout(r, 450));
        const pane = document.getElementById('wsPane-' + t);
        byTab[t] = pane ? [...pane.querySelectorAll('.sec-num')]
          .map(e => (e.textContent || '').trim()) : 'NO PANE';
      }
      const all = [...document.querySelectorAll('.sec-num')].map(e => (e.textContent || '').trim());
      const affectedBadges = {};
      for (const c of AFFECTED) {
        const el = document.getElementById(c.id);
        const b = el ? el.querySelector('.sec-num') : null;
        affectedBadges[c.id] = b ? (b.textContent || '').trim() : null;
      }
      return { byTab, all, affectedBadges };
    }, AFFECTED);
    is(A.all.length > 0, 'there are section badges to check at all', JSON.stringify(A.all));
    is(!A.all.some(b => /^\d+$/.test(b)),
      'NOT ONE badge anywhere in the app is a bare ordinal', JSON.stringify(A.all));
    for (const c of AFFECTED) {
      const b = A.affectedBadges[c.id];
      is(b !== null && b !== '' && !/^\d+$/.test(b),
        `${c.id} (was "${c.was}") now carries a non-numeric badge`, JSON.stringify(b));
    }
    is(new Set(Object.values(A.affectedBadges)).size === AFFECTED.length,
      'and the seven badges are distinct from each other — each names its own subject',
      JSON.stringify(A.affectedBadges));
    is(!Object.values(A.byTab).some(v => Array.isArray(v) && v.some(b => /^\d+$/.test(b))),
      'no tab shows a fragment of a numbered sequence', JSON.stringify(A.byTab));

    // ── B · every re-badged card is still reachable and still works ────────
    S('B. Every affected card is reachable and operable through its own tab');
    const B = await page.evaluate(async (AFFECTED) => {
      const out = {};
      for (const c of AFFECTED) {
        window.switchWorkspaceTab(c.tab);
        await new Promise(r => setTimeout(r, 550));
        try {
          if (window.PropertyOS && window.PropertyOS.revealForAnchor) {
            window.PropertyOS.revealForAnchor(c.id);
          }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 350));
        const el = document.getElementById(c.id);
        if (!el) { out[c.id] = { exists: false }; continue; }
        const pane = el.closest('[id^="wsPane-"]');
        const btns = [...el.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null);
        const first = btns[0] || null;
        let hit = null;
        if (first) {
          first.scrollIntoView({ block: 'center' });
          await new Promise(r => setTimeout(r, 160));
          const r2 = first.getBoundingClientRect();
          const at = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2);
          hit = at ? (at === first || first.contains(at) || at.contains(first)) : false;
        }
        out[c.id] = {
          exists: true,
          onExpectedTab: pane ? pane.id === 'wsPane-' + c.tab : false,
          visible: el.offsetParent !== null,
          heading: ((el.querySelector('.sec-head h2') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
          enabledButtons: btns.length,
          firstBtnLabel: first ? (first.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36) : null,
          firstBtnHasHandler: first ? !!first.getAttribute('onclick') : null,
          firstBtnHitTestable: hit,
          editableInputs: [...el.querySelectorAll('input,select,textarea')]
            .filter(i => !i.disabled && !i.readOnly && i.offsetParent !== null).length,
          text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
        };
      }
      return out;
    }, AFFECTED);
    for (const c of AFFECTED) {
      const r = B[c.id];
      is(r.exists && r.visible, `${c.id} renders`, JSON.stringify(r));
      is(r.onExpectedTab, `${c.id} is on the ${c.tab} tab`, JSON.stringify(r && r.onExpectedTab));
      is(!!r.heading, `${c.id} still has its heading ("${r.heading}")`);
    }
    // Operability, judged by what each card actually offers rather than by a
    // control every card is assumed to have.
    is(B.cardSetup.editableInputs >= 3,
      'Property Setup offers its editable fields (name, sqft, CAM year)',
      'editable inputs: ' + B.cardSetup.editableInputs);
    for (const id of ['cardInvoices', 'results', 'disputeSection', 'reportsSection', 'escrowSection']) {
      is(B[id].enabledButtons > 0 && B[id].firstBtnHasHandler === true && B[id].firstBtnHitTestable === true,
        `${id} has a live, clickable control ("${B[id].firstBtnLabel}")`, JSON.stringify(B[id].firstBtnHitTestable));
    }
    // The reserve-requests section is an EMPTY STATE on this data and has no
    // control by design. Asserting a button here would be asserting a fiction;
    // what it owes the reader is a statement of why it is empty and where to start.
    is(/No reserve requests yet/i.test(B.escrowRequestsSection.text),
      'Reserve Requests states plainly that it is empty rather than looking broken');
    is(/reserve account above/i.test(B.escrowRequestsSection.text),
      'and says where a request starts, so the empty state is still a next action');

    // Two cards driven for real, so "operable" is not only hit-testing.
    S('B2. Two controls actually used');
    const B2 = await page.evaluate(async () => {
      window.switchWorkspaceTab('cam');
      await new Promise(r => setTimeout(r, 600));
      // 1 — the calculation panel opens from the re-badged results card.
      const card = document.getElementById('results');
      const btn = [...card.querySelectorAll('.explain-btn')][0] || null;
      let explainOpened = null;
      if (btn) {
        btn.click();
        await new Promise(r => setTimeout(r, 900));
        const p = document.getElementById('explainPanel') ||
                  document.querySelector('.explain-panel, .ep-wrap, #epOverlay');
        explainOpened = !!(p && (p.offsetParent !== null || getComputedStyle(p).display !== 'none'));
        if (typeof window.closeExplainPanel === 'function') { try { window.closeExplainPanel(); } catch (_) {} }
      }
      // 2 — the setup field still accepts a keystroke and reports it back.
      window.switchWorkspaceTab('property');
      await new Promise(r => setTimeout(r, 600));
      try { window.PropertyOS && window.PropertyOS.revealForAnchor('cardSetup'); } catch (_) {}
      await new Promise(r => setTimeout(r, 350));
      const nameEl = document.getElementById('propertyName');
      let typed = null, restored = null;
      if (nameEl) {
        const orig = nameEl.value;
        nameEl.focus();
        nameEl.value = orig + ' X';
        nameEl.dispatchEvent(new Event('input', { bubbles: true }));
        typed = nameEl.value;
        nameEl.value = orig;
        nameEl.dispatchEvent(new Event('input', { bubbles: true }));
        restored = nameEl.value;
      }
      return { explainBtnFound: !!btn, explainOpened, typed, restored };
    });
    is(B2.explainBtnFound === true, 'the results card still offers "View Calculation"');
    is(B2.explainOpened === true, 'and clicking it opens the calculation panel', JSON.stringify(B2));
    is(B2.typed === 'Cascade Commons X', 'the Property Setup name field accepts input', B2.typed);
    eq(B2.restored, 'Cascade Commons', 'and the test left the property name as it found it');

    // ── C · the one numbering that IS live still works ─────────────────────
    S('C. The step bar still progresses 1-5 with checkmarks');
    const C = await page.evaluate(() => {
      const read = () => [...document.querySelectorAll('#stepBar .step-dot')]
        .map(d => (d.textContent || '').trim());
      const labels = [...document.querySelectorAll('#stepBar .step-label')]
        .map(d => (d.textContent || '').trim());
      const seen = {};
      ['setup', 'leases', 'invoices', 'calculate', 'review', 'done'].forEach(s => {
        window.updateStepBar(s);
        seen[s] = read();
      });
      const classes = {};
      ['setup', 'invoices', 'review'].forEach(s => {
        window.updateStepBar(s);
        classes[s] = ['setup', 'leases', 'invoices', 'calculate', 'review'].map(x => {
          const el = document.getElementById('step-' + x);
          return el ? (el.classList.contains('done') ? 'done'
                     : el.classList.contains('active') ? 'active' : '') : null;
        });
      });
      window.updateStepBar('done');
      return { labels, seen, classes, final: read() };
    });
    eq(C.labels, ['Setup', 'Leases', 'Invoices', 'Calculate', 'Review'],
      'the five workflow steps keep their names');
    eq(C.seen.setup, ['1', '2', '3', '4', '5'],
      'at step 1 the dots read 1-5 — the ordinals here are real and still shown');
    eq(C.seen.leases, ['✓', '2', '3', '4', '5'], 'at step 2 the first is checked');
    eq(C.seen.invoices, ['✓', '✓', '3', '4', '5'], 'at step 3 the first two are checked');
    eq(C.seen.calculate, ['✓', '✓', '✓', '4', '5'], 'at step 4, three');
    eq(C.seen.review, ['✓', '✓', '✓', '✓', '5'], 'at step 5, four');
    eq(C.seen.done, ['✓', '✓', '✓', '✓', '✓'], 'and "done" checks all five');
    eq(C.classes.setup, ['active', '', '', '', ''], 'step 1 marks only itself active');
    eq(C.classes.invoices, ['done', 'done', 'active', '', ''],
      'step 3 marks the two behind it done and itself active');
    eq(C.classes.review, ['done', 'done', 'done', 'done', 'active'], 'and step 5 likewise');

    // ── E · the reparenting that caused the drift is unchanged ─────────────
    S('E. _reparent() still places each card under its subject');
    const E = await page.evaluate(() => ({
      setupUnderProperty: !!document.querySelector('#wsPane-property #cardSetup'),
      leasesUnderSpaces:  !!document.querySelector('#wsPane-spaces #cardLeases'),
      propertyPaneExists: !!document.getElementById('wsPane-property'),
      propertyTabBtn:     !!document.getElementById('wsTabBtn-property'),
      // The retired Documents tab. Its PANE no longer exists in the markup at
      // all, so testing the pane's display would be vacuous — `_reparent()`
      // hides the BUTTON, and that is the branch that still runs.
      documentsPaneExists: !!document.getElementById('wsPane-documents'),
      documentsBtnExists:  !!document.getElementById('wsTabBtn-documents'),
      documentsBtnHidden:  (() => {
        const b = document.getElementById('wsTabBtn-documents');
        return b ? (b.style.display === 'none' || b.offsetParent === null) : null;
      })(),
      tabs: (typeof WORKSPACE_TABS !== 'undefined') ? WORKSPACE_TABS : null,
    }));
    is(E.propertyPaneExists && E.propertyTabBtn,
      'the Property pane and its tab button are still created at runtime');
    is(E.setupUnderProperty, 'Property Setup still sits under the Property tab');
    is(E.leasesUnderSpaces, 'Lease intake still sits under the Spaces tab');
    is(E.documentsBtnExists === true && E.documentsBtnHidden === true,
      'the retired Documents tab button is still hidden from navigation',
      JSON.stringify({ exists: E.documentsBtnExists, hidden: E.documentsBtnHidden }));
    is(E.documentsPaneExists === false,
      'and its pane is gone from the markup entirely, so nothing can navigate to it');
    eq(E.tabs, ['overview', 'property', 'spaces', 'cam', 'reports', 'reserves'],
      'and the tab list is unchanged');

    // ── F · the badges are not identity, and cannot be moved by data ───────
    S('F. Non-sequential data cannot touch the badge map');
    const F = await page.evaluate(async () => {
      const read = async () => {
        const out = {};
        const tabs = (typeof WORKSPACE_TABS !== 'undefined') ? WORKSPACE_TABS : [];
        for (const t of tabs) {
          window.switchWorkspaceTab(t);
          await new Promise(r => setTimeout(r, 350));
          const p = document.getElementById('wsPane-' + t);
          out[t] = p ? [...p.querySelectorAll('.sec-num')].map(e => (e.textContent || '').trim()) : null;
        }
        return out;
      };
      const before = await read();

      // NON-SEQUENTIAL IDS. If any badge were an ordinal over this collection,
      // 0/4/9 would show it — this is the shape of the dispute #2/#3 defect.
      const mk = id => ({ id, tenantName: 'T' + id, status: 'open',
                          timestamp: new Date().toISOString(), type: 'other', severity: 'low' });
      disputes.splice(0, disputes.length, mk(0), mk(4), mk(9));
      if (typeof window.renderDisputes === 'function') window.renderDisputes();
      await new Promise(r => setTimeout(r, 450));
      const afterDisputes = await read();

      // And now remove the underlying records entirely.
      const p = window.currentProperty();
      const counts = { tenants: (p.tenants || []).length, invoices: (p.invoices || []).length };
      p.tenants = []; p.invoices = [];
      tenantData.splice(0, tenantData.length);
      invoiceData.splice(0, invoiceData.length);
      if (typeof window.renderTenants === 'function') window.renderTenants();
      if (typeof window.renderInvResults === 'function') window.renderInvResults();
      await new Promise(r => setTimeout(r, 600));
      const afterEmpty = await read();

      return { before, afterDisputes, afterEmpty, counts,
               disputeIds: disputes.map(d => d.id) };
    });
    eq(F.disputeIds, [0, 4, 9], 'the fixture really is non-sequential (0, 4, 9)');
    is(F.counts.tenants > 0 && F.counts.invoices > 0,
      'and there really were records to remove (not a vacuous check)', JSON.stringify(F.counts));
    eq(F.afterDisputes, F.before,
      'disputes numbered 0, 4 and 9 move no badge — no badge is an ordinal over that collection');
    eq(F.afterEmpty, F.before,
      'and emptying every tenant and invoice moves no badge — the badges are not derived from data');
    is(!JSON.stringify(F.afterEmpty).match(/"\d+"/),
      'the badge map contains no digit even with the data gone', JSON.stringify(F.afterEmpty));

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
