'use strict';
/**
 * Modal layering + background scroll lock.
 *
 * Pins the two pilot-blocking behaviours found in the UX review:
 *   1. A generated report must sit above the surface that launched it. The
 *      Dispute Packet is opened from a button inside the Dispute Workspace, so
 *      #reportOverlay must outrank #disputeWorkspace.
 *   2. Opening a modal must lock the page behind it, so a user reading a
 *      document does not lose their place in the reconciliation.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8831;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };
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
  await page.waitForTimeout(800);
  await page.evaluate(() => { if (typeof loadDemo === 'function') return loadDemo(); });
  await page.waitForTimeout(4500);

  const z = id => page.evaluate(i => {
    const e = document.getElementById(i);
    return e ? parseInt(getComputedStyle(e).zIndex, 10) : null;
  }, id);

  console.log('\n── A report outranks the surface that launched it ──');
  const zReport = await z('reportOverlay'), zWork = await z('disputeWorkspace');
  (zReport > zWork)
    ? ok(`#reportOverlay (${zReport}) is above #disputeWorkspace (${zWork})`)
    : bad(`#reportOverlay (${zReport}) is not above #disputeWorkspace (${zWork})`, 'the packet renders behind the panel');

  // Both open at once — the real sequence: open a dispute, then its packet.
  const stacked = await page.evaluate(() => {
    // Use a seeded dispute if one exists; otherwise create one. The subject
    // here is layering, not demo seeding.
    let d = (typeof disputes !== 'undefined' && disputes && disputes[0]) ? disputes[0] : null;
    if (!d && typeof disputes !== 'undefined') {
      d = { id: 987001, tenantName: 'T', invoiceId: null, vendor: 'V', category: 'maintenance',
            tenantShare: '100', reason: 'r', timestamp: new Date().toISOString(),
            status: 'open', resolution: null, resolvedAt: null, hash: null, history: [] };
      disputes.push(d);
    }
    if (!d) return { skipped: 'disputes array unavailable' };
    if (typeof openDisputeWorkspace === 'function') openDisputeWorkspace(d.id);
    if (typeof generateDisputePacket === 'function') generateDisputePacket(d.id);
    const w = document.getElementById('disputeWorkspace'), r = document.getElementById('reportOverlay');
    const vis = e => e && getComputedStyle(e).display !== 'none';
    return { workspaceOpen: vis(w), packetOpen: vis(r),
             zw: parseInt(getComputedStyle(w).zIndex, 10), zr: parseInt(getComputedStyle(r).zIndex, 10) };
  });
  if (stacked.skipped) bad('could not exercise the real path', stacked.skipped);
  else if (!stacked.packetOpen) bad('packet did not open');
  else if (stacked.workspaceOpen && stacked.zr <= stacked.zw)
    bad('packet is behind the still-open workspace', JSON.stringify(stacked));
  else ok(stacked.workspaceOpen
    ? `packet (${stacked.zr}) renders above the still-open workspace (${stacked.zw})`
    : 'packet opens and the workspace is dismissed — no occlusion possible');

  console.log('\n── The page behind a modal is locked ──');
  const lock = await page.evaluate(async () => {
    const body = document.body;
    const res = { idle: getComputedStyle(body).overflow, opened: {}, restored: null };
    const show = (id, disp) => { const e = document.getElementById(id); if (e) e.style.display = disp; };
    const hide = id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; };
    for (const [id, disp] of [['evidenceViewer', 'flex'], ['reportOverlay', 'block'], ['disputeWorkspace', 'block']]) {
      show(id, disp);
      await new Promise(r => setTimeout(r, 120));
      res.opened[id] = getComputedStyle(body).overflow;
      hide(id);
      await new Promise(r => setTimeout(r, 120));
    }
    res.restored = getComputedStyle(body).overflow;
    // If the lock is still on, name what the observer still considers open.
    res.stillOpen = ['evidenceViewer','reportOverlay','explainPanel','leaseViewerModal',
      'allocModal','disputeWorkspace','tenantDetailPanel','draftingModal','invFileViewer']
      .filter(id => { const e = document.getElementById(id); if (!e) return false;
        const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    return res;
  });
  for (const [id, ov] of Object.entries(lock.opened)) {
    ov === 'hidden' ? ok(`#${id} open → background scroll locked`)
                    : bad(`#${id} open → background still scrolls`, `overflow: ${ov}`);
  }
  lock.restored !== 'hidden'
    ? ok(`scrolling restored after every modal closed (overflow: ${lock.restored})`)
    : bad('background left locked after modals closed', 'still open: ' + JSON.stringify(lock.stillOpen));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
