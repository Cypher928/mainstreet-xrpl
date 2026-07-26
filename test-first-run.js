'use strict';
/**
 * First-run experience contract.
 *
 * A signed-in account with no properties must be offered the first step. The
 * UX review found the visible actions were Sign out, Guided Tour, Portfolio,
 * Go to Portfolio, Start Tour and the legal links — navigation and explanation,
 * but no way to add a property.
 *
 * The welcome panel is shown only when there are no real properties
 * (_maybeShowWelcome, script.js:9877), so it is the correct place for the CTA
 * and it disappears on its own once a property exists.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8835;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const MOCK = `(function(){var u={id:'t',email:'ops@mainstreet.local'};function P(v){return Promise.resolve(v);}
function q(){var o={select:function(){return o;},insert:function(r){return P({data:r,error:null});},upsert:function(r){return P({data:[r],error:null});},
update:function(){return P({data:null,error:null});},delete:function(){return {eq:function(){return P({error:null});}};},
eq:function(){return o;},neq:function(){return o;},in:function(){return o;},is:function(){return o;},order:function(){return o;},
limit:function(){return o;},ilike:function(){return o;},single:function(){return P({data:null,error:null});},
then:function(f){return P({data:[],error:null}).then(f);}};return o;}
window.supabase={createClient:function(){return {auth:{getUser:function(){return P({data:{user:u},error:null});},
getSession:function(){return P({data:{session:{user:u}},error:null});},
onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:u});},30);return {data:{subscription:{unsubscribe:function(){}}}};},
signOut:function(){return P({error:null});}},from:function(){return q();},
storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};})();`;

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

(async () => {
  const srv = http.createServer((rq, rs) => {
    let r = decodeURIComponent(rq.url.split('?')[0]); if (r === '/') r = '/index.html';
    fs.readFile(path.join(ROOT, r), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(MOCK);
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**supabase**', r => { const u = r.request().url();
    return u.includes('127.0.0.1') ? r.continue() : r.fulfill({ status: 200, body: '/*x*/' }); });
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#appContent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Render the empty portfolio the way the app does for a fresh account.
  await page.evaluate(() => { if (typeof renderPortfolio === 'function') renderPortfolio([]); });
  await page.waitForTimeout(600);

  console.log('\n── The first step is offered ──');
  const cta = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
    const add = btns.find(e => /add your first property/i.test(e.innerText || ''));
    return {
      found: !!add,
      label: add ? add.innerText.trim() : null,
      wiredTo: add ? (add.getAttribute('onclick') || '') : null,
      inWelcome: add ? !!add.closest('#demoWelcomePanel') : false,
      panelVisible: (() => { const p = document.getElementById('demoWelcomePanel');
        return !!p && getComputedStyle(p).display !== 'none'; })(),
      allLabels: btns.map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 12),
    };
  });
  cta.panelVisible ? ok('welcome panel is shown for an account with no properties')
                   : bad('welcome panel not shown', 'the first-run surface is missing');
  cta.found ? ok(`primary action present: "${cta.label}"`)
            : bad('no "add your first property" action', `visible: ${JSON.stringify(cta.allLabels)}`);
  /addNewProperty\(\)/.test(cta.wiredTo || '')
    ? ok('wired to the existing addNewProperty() — no new workflow')
    : bad('not wired to addNewProperty()', String(cta.wiredTo));
  cta.inWelcome ? ok('lives in the first-run panel, not bolted onto navigation')
                : bad('CTA is outside the welcome panel');

  console.log('\n── It gets out of the way once there is a property ──');
  const after = await page.evaluate(() => {
    if (typeof _maybeShowWelcome === 'function') _maybeShowWelcome([{ id: 'real-1', name: 'A Property' }]);
    const p = document.getElementById('demoWelcomePanel');
    return { visible: !!p && getComputedStyle(p).display !== 'none' };
  });
  !after.visible ? ok('panel hides once a real property exists — no lingering CTA')
                 : bad('panel still shown with a property present');

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
