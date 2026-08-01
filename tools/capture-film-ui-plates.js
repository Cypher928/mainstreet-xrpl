'use strict';
/**
 * Re-capture the two product-film plates that shipped with dev-only chrome in
 * them.
 *
 *   ui-upload.png      Lease Upload — the drop zone and the extracted tenants
 *   ui-settlement.png  The settlement chain, settled and verified on the XRPL
 *
 * Both of these were shot by hand rather than by a tool, and both caught the
 * `_devRoleSwitcher` panel — the "DEV / SWITCH ROLE / Landlord" box that only
 * exists on a local build. It sat over the last tenant row on the upload plate
 * and over the "View Transaction" link on the settlement plate, and the film
 * puts it on screen in five separate beats. A prospect watching the film reads
 * that as unfinished software.
 *
 * Same rule as every other plate here: marketing screenshots come from the
 * running product against the demo property, never from a mockup and never
 * retouched. This strips the local-only chrome BEFORE the shutter, which is the
 * honest way to remove it — the pixels that remain are all real.
 *
 *   node tools/capture-film-ui-plates.js [--out DIR]
 */
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const PORT = 8847;
const argOut = process.argv.indexOf('--out');
const OUT = argOut > -1 ? process.argv[argOut + 1] : path.join(ROOT, 'assets', 'landing');

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf' };

// Same offline stand-in the other capture tools use: the plates must not depend
// on a live Supabase project, and a capture run must never write to one.
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

// The whole point of this tool. Removing the node is better than covering it:
// nothing is painted over real product pixels.
const CLEAN = () => {
  ['_devRoleSwitcher', 'restoredBanner'].forEach(id => {
    const e = document.getElementById(id); if (e) e.remove();
  });
  document.querySelectorAll('.cc-brief-greet').forEach(el => {
    el.textContent = el.textContent.replace(/,\s*[^,]*$/, '');
  });
};

const report = { plates: [] };

// `pad` widens the element's SIDE padding only, on top of whatever the card
// already has. The cards are border-box, so side padding narrows the content
// inside a fixed width — which is what buys the film's camera push its room.
// Touching the vertical padding instead would change the element's height, and
// height decides which band of the plate the film's object-fit:cover shows.
async function shootEl(page, handle, file, pad = 0) {
  try {
    if (!handle) throw new Error('element not found');
    await handle.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    // Re-run the strip AFTER scrolling: the switcher is position:fixed, so it
    // re-enters the frame on every scroll if anything re-mounted it.
    await page.evaluate(CLEAN);
    const undo = await handle.evaluate((el, p) => {
      const prev = [el.style.paddingLeft, el.style.paddingRight];
      if (p) {
        const cs = getComputedStyle(el);
        el.style.paddingLeft = (parseFloat(cs.paddingLeft) || 0) + p + 'px';
        el.style.paddingRight = (parseFloat(cs.paddingRight) || 0) + p + 'px';
      }
      return prev;
    }, pad);
    await page.waitForTimeout(200);
    // animations:'disabled' matters on the upload card: its progress bar and
    // status pulses never settle, and Playwright waits for a stable box before
    // it will fire the shutter — the first run timed out on exactly that.
    await handle.screenshot({ path: path.join(OUT, file), timeout: 30000, animations: 'disabled', caret: 'hide' });
    await handle.evaluate((el, prev) => { el.style.paddingLeft = prev[0]; el.style.paddingRight = prev[1]; }, undo);
    const box = await handle.boundingBox();
    // Proof the badge is gone, from the DOM rather than from my eyes.
    const dev = await page.evaluate(() => !!document.getElementById('_devRoleSwitcher'));
    report.plates.push({ file, width: box && Math.round(box.width), height: box && Math.round(box.height), devSwitcherPresent: dev });
    return true;
  } catch (e) {
    report.plates.push({ file, error: e.message.split('\n')[0] });
    return false;
  }
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
  // deviceScaleFactor 2: the film scales these plates to ~160% on a 1440p
  // display, and the originals were shot at 1x. Same framing, twice the pixels.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
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

  // ── ui-upload.png · Lease Upload ─────────────────────────────────────────
  // #cardLeases lives in #wsPane-documents, and 'documents' was deliberately
  // dropped from WORKSPACE_TABS (script.js:3297) when lease intake moved under
  // Spaces — so switchWorkspaceTab('documents') is a no-op and the pane stays
  // display:none. That is why the first attempt timed out on a 0x0 box. The
  // pane and its markup are still real, shipping code rendering real demo data;
  // only the nav entry is retired. Reveal it directly for the shutter.
  //
  // #wsPane-documents is nested INSIDE #wsPane-spaces at runtime (the
  // "/wsPane-spaces" comment in index.html sits above the closing tag the
  // parser actually pairs it with), so the Spaces tab has to be the active one
  // as well or the pane stays collapsed inside a display:none ancestor.
  await page.evaluate(() => {
    if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('spaces');
    const pane = document.getElementById('wsPane-documents');
    if (pane) pane.style.display = 'block';
    if (typeof switchLeaseTab === 'function') { try { switchLeaseTab('bulk'); } catch (_) {} }
  });
  await page.waitForTimeout(1600);
  // The side padding is not decoration. This plate is object-fit:cover in the
  // film, so it lands flush against the frame and the beat's camera move
  // (glide × the `arrive` entry) cropped 101px off the left — enough to turn
  // "Extracted Tenants (5)" into "cted Tenants (5)". Padding the element before
  // the shutter gives the push its own room to eat: 8% of the plate width each
  // side, against a 7.3% worst-case crop once `pfArrive`'s tail is softened
  // (product-film.js). The card fills the frame almost exactly as the beat ends,
  // which is the arrival the move was aiming at all along.
  await shootEl(page, await page.$('#cardLeases'), 'ui-upload.png', 96);
  await page.evaluate(() => {
    const pane = document.getElementById('wsPane-documents');
    if (pane) pane.style.display = 'none';
  });

  // ── ui-settlement.png · the settled chain ────────────────────────────────
  await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('overview'); });
  await page.waitForTimeout(1400);
  let stl = await page.$('.stl-flow--live');
  if (!stl) stl = await page.$('.stl-flow');
  await shootEl(page, stl, 'ui-settlement.png');

  fs.writeFileSync(path.join(OUT, 'film-ui-plates.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await ctx.close(); await browser.close(); srv.close();
})();
