// test-e2e-product-identity.js
// ============================================================================
// THE PRODUCT IS PROPERTY INTELLIGENCE; CAM IS ONE OF ITS WORKFLOWS.
//
// The app shell used to introduce MainStreet as "AI-Powered CAM
// Reconciliation" — in the browser tab, the share cards, the structured data
// and the login tagline. Those are the global statements of what the product
// is, and they are now the broader one. CAM copy where CAM is the workflow
// being discussed is deliberately untouched, and this suite checks one such
// place still says so.
//
// Run: node test-e2e-product-identity.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8972;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const yes = (c, label, d) => c ? ok(label) : bad(label, d);

const TITLE = 'MainStreet — Property Intelligence';
const POSITIONING = /verified memory for every commercial property/i;
const CAM_ONLY = /AI-powered CAM reconciliation/i;

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  // Unauthenticated, so the login screen — the first thing a visitor reads — is the one rendered.
  await page.addInitScript(`window.supabase={createClient:function(){return {auth:{
    getUser:function(){return Promise.resolve({data:{user:null},error:null});},
    getSession:function(){return Promise.resolve({data:{session:null},error:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return Promise.resolve({error:null});}},
    rpc:function(){return Promise.resolve({data:null,error:null});},
    from:function(){var q={select:function(){return q;},eq:function(){return q;},is:function(){return q;},not:function(){return q;},
      order:function(){return q;},limit:function(){return q;},single:function(){return Promise.resolve({data:null,error:null});},
      then:function(f){return Promise.resolve({data:[],error:null}).then(f);}};return q;},
    storage:{from:function(){return {upload:function(){return Promise.resolve({data:null,error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const r = await page.evaluate(() => {
    const m = (sel) => { const e = document.querySelector(sel); return e ? e.getAttribute('content') : null; };
    let schema = null; try { schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent); } catch (_) {}
    const tag = document.querySelector('.login-tagline');
    const ob = document.querySelector('.ob-modal-sub');
    return {
      title: document.title,
      og: m('meta[property="og:title"]'), tw: m('meta[name="twitter:title"]'),
      desc: m('meta[name="description"]'), ogDesc: m('meta[property="og:description"]'), twDesc: m('meta[name="twitter:description"]'),
      schemaName: schema && schema.name, schemaDesc: schema && schema.description,
      tagline: tag ? tag.textContent.trim() : null,
      loginVisible: !!document.getElementById('loginScreen') && getComputedStyle(document.getElementById('loginScreen')).display !== 'none',
      camWorkflowCopy: ob ? ob.textContent.trim() : null,
    };
  });

  console.log('\n── The global identity ──');
  is(r.title, TITLE, 'the browser tab reads "MainStreet — Property Intelligence"');
  is([r.og, r.tw], [TITLE, TITLE], 'the share-card titles say the same');
  yes(POSITIONING.test(r.desc || ''), 'the page description carries the positioning: the verified memory for every commercial property', r.desc);
  yes(POSITIONING.test(r.ogDesc || '') && POSITIONING.test(r.twDesc || ''), 'and so do the share-card descriptions', r.ogDesc);
  is(r.schemaName, 'MainStreet', 'the structured data still names the product');
  yes(/property intelligence/i.test(r.schemaDesc || '') && POSITIONING.test(r.schemaDesc || ''), 'and describes it as property intelligence, the verified memory for every property', r.schemaDesc);
  yes(![r.title, r.og, r.tw, r.desc, r.ogDesc, r.twDesc, r.schemaDesc].some(s => CAM_ONLY.test(s || '')), 'nothing in the head presents MainStreet as solely AI-powered CAM reconciliation');

  console.log('\n── The first screen a visitor reads ──');
  yes(r.loginVisible, 'unauthenticated, the login screen is shown');
  is(r.tagline, 'The verified memory for every commercial property.', 'its tagline is the positioning');

  console.log('\n── CAM stays CAM where CAM is the workflow ──');
  yes(r.camWorkflowCopy && /CAM reconciliation/.test(r.camWorkflowCopy), 'the CAM quick-start still calls its workflow CAM reconciliation (no broad rewrite)', r.camWorkflowCopy);
  is(errs, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
