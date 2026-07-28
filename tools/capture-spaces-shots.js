'use strict';
/**
 * Capture the Spaces experience for the marketing landing page.
 *
 * Same rule as the film plates: marketing screenshots come from the running
 * product against the demo property, never from mockups. Local-only chrome
 * (dev switcher, demo banner, personalised greeting) is stripped first.
 *
 *   ui-spaces.png       the Spaces card grid on the property workspace
 *   ui-space-modal.png  one Space opened — lease terms, CAM, timeline
 *
 *   node tools/capture-spaces-shots.js [--out DIR]
 */
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const PORT = 8843;
const argOut = process.argv.indexOf('--out');
const OUT = argOut > -1 ? process.argv[argOut + 1] : path.join(ROOT, 'assets', 'landing');

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };
const SUPABASE_MOCK = `
(function(){
  var _user = { id:'plate-capture', email:'ops@mainstreet.local' };
  function P(v){return Promise.resolve(v);}
  function ins(r){var rows=Array.isArray(r)?r:[r];var p=P({data:rows,error:null});p.select=function(){return P({data:rows,error:null});};return p;}
  function makeQ(){var q={select:function(){return q;},insert:ins,upsert:ins,
    update:function(){return P({data:null,error:null});},delete:function(){return {eq:function(){return P({error:null});}};},
    eq:function(){return q;},neq:function(){return q;},in:function(){return P({data:[],error:null});},is:function(){return q;},order:function(){return q;},
    limit:function(){return q;},ilike:function(){return q;},single:function(){return P({data:null,error:null});},
    then:function(f){return P({data:[],error:null}).then(f);}};return q;}
  window.supabase={createClient:function(){return {auth:{
    getUser:function(){return P({data:{user:_user},error:null});},
    getSession:function(){return P({data:{session:{user:_user}},error:null});},
    onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:_user});},40);return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return P({error:null});}
  },from:function(){return makeQ();},storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;

const CLEAN = () => {
  ['restoredBanner', '_devRoleSwitcher'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
  document.querySelectorAll('.cc-brief-greet').forEach(el => {
    el.textContent = el.textContent.replace(/,\s*[^,]*$/, '');
  });
};

async function shootEl(handle, file, pad = 20) {
  await handle.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
  const undo = await handle.evaluate((el, p) => { const prev = el.style.padding; el.style.padding = p + 'px'; return prev; }, pad);
  await new Promise(r => setTimeout(r, 150));
  await handle.screenshot({ path: path.join(OUT, file), timeout: 9000 });
  await handle.evaluate((el, prev) => { el.style.padding = prev; }, undo);
  const box = await handle.boundingBox();
  return { file, width: box ? Math.round(box.width) : null, height: box ? Math.round(box.height) : null };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = http.createServer((rq, rs) => {
    let r = decodeURIComponent(rq.url.split('?')[0]); if (r === '/') r = '/index.html';
    fs.readFile(path.join(ROOT, r), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR:', e.message.split('\n')[0]));
  page.on('console', m => { const t = m.text(); if (/ensureDemoProperty|loadDemo|SEED|error/i.test(t) && !/favicon|font/.test(t)) console.log('CONSOLE:', t.slice(0, 160)); });
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(SUPABASE_MOCK);
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**supabase**', r => {
    const u = r.request().url();
    return u.includes('127.0.0.1') ? r.continue() : r.fulfill({ status: 200, body: '/*x*/' });
  });
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#appContent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(() => { if (typeof loadDemo === 'function') return loadDemo(); });
  await page.waitForTimeout(5000);
  await page.evaluate(CLEAN);
  // The Command Center overlays the workspace after a demo load; the workspace
  // panes report zero size while it is up. Dismiss it the way the app does.
  await page.evaluate(() => {
    const cc = document.getElementById('commandCenter');
    if (cc && getComputedStyle(cc).display !== 'none') cc.style.display = 'none';
    const wf = document.getElementById('mainWorkflow');
    if (wf) wf.style.display = 'block';
  });
  await page.waitForTimeout(300);

  const out = [];

  // ── Spaces card grid ──────────────────────────────────────────────────────
  await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('spaces'); });
  await page.waitForSelector('.tsl-grid', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(CLEAN);
  const probe = await page.evaluate(() => ({
    host: !!document.getElementById('spacesList'),
    hostHtml: (document.getElementById('spacesList') || {}).innerHTML ? (document.getElementById('spacesList').innerHTML.length) : 0,
    tabs: typeof switchWorkspaceTab,
    ts: !!window.TenantSpace,
    visible: (() => { const h = document.getElementById('spacesList'); if (!h) return null;
      const r = h.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  }));
  console.log('probe:', JSON.stringify(probe));
  if (probe.host && !probe.hostHtml) {
    await page.evaluate(() => {
      const prop = (typeof _props !== 'undefined' && _props[0]) || null;
      if (prop && window.TenantSpace && TenantSpace.renderList) TenantSpace.renderList(prop);
    });
    await page.waitForTimeout(400);
  }
  const grid = await page.$('.tsl-grid');
  if (grid) out.push(await shootEl(grid, 'ui-spaces.png'));
  else out.push({ error: 'spaces grid not found' });

  // ── One Space opened — Whole Health Market (lease, CAM, timeline) ─────────
  const opened = await page.evaluate(() => {
    const prop = (typeof _props !== 'undefined' && _props[0]) || null;
    const t = prop && (prop.tenants || []).find(x => x && /Whole Health/i.test(x.tenant_name || ''));
    const cp = typeof currentProperty === 'function' ? currentProperty() : null;
    if (!t || !window.TenantSpace) return { ok: false, why: 'no tenant or TenantSpace', t: !!t };
    // openSpace resolves the property itself via currentProperty(); make sure
    // the active property is the demo one before asking.
    if (!cp && typeof selectProperty === 'function' && prop) selectProperty(prop.id);
    TenantSpace.openSpace(t.id);
    return { ok: !!document.getElementById('tsOverlay'), why: 'called',
             cp: !!cp, tenant: t.tenant_name };
  });
  console.log('open:', JSON.stringify(opened));
  const tl = await page.evaluate(() => {
    const prop = (typeof _props !== 'undefined' && _props[0]) || null;
    const t = prop && (prop.tenants || []).find(x => x && /Whole Health/i.test(x.tenant_name || ''));
    const ev = (prop && prop.timeline) || [];
    return { timelineLen: ev.length,
             sampleSubjects: ev.slice(0, 4).map(e => e && e.subject),
             tenantId: t && t.id,
             camRec: !!(prop && prop.camReconciliation && prop.camReconciliation.results) };
  });
  console.log('timeline probe:', JSON.stringify(tl));
  if (opened.ok) {
    await page.waitForSelector('#tsOverlay', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.evaluate(CLEAN);
    const modal = await page.$('#tsOverlay .ts-panel, #tsOverlay > div, #tsOverlay');
    if (modal) out.push(await shootEl(modal, 'ui-space-modal.png', 0));
    else out.push({ error: 'space modal element not found' });
  } else out.push({ error: 'could not open a space' });

  console.log(JSON.stringify(out, null, 2));
  await ctx.close(); await browser.close(); srv.close();
})();
