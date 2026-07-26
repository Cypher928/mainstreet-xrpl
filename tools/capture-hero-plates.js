'use strict';
/**
 * Capture the real-UI plates for Film 1 (homepage hero loop).
 *
 * The production package requires every frame containing a number to come from
 * the shipping product, never from motion graphics or a generative tool. This
 * script produces those plates from a live render of the demo property so the
 * motion studio animates real captures instead of rebuilding the UI.
 *
 *   beat1-cap-catch.png   CAM allocation table, Whole Health Market cap row
 *   beat3-settlement.png  Settlement row, verified on the XRP Ledger
 *   hero-poster.png       Poster frame for the <video> element
 *
 * Beat 2 (Evidence Viewer clause) is NOT captured here — see
 * docs/FILM1_IMPLEMENTATION.md for why it is currently unfilmable.
 *
 *   node tools/capture-hero-plates.js [--out DIR]
 */
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const PORT = 8817;
const argOut = process.argv.indexOf('--out');
const OUT = argOut > -1 ? process.argv[argOut + 1] : path.join(ROOT, 'assets', 'landing');

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

// Minimal Supabase stand-in: the plates come from the demo property held in
// memory, so nothing needs a network round trip.
const SUPABASE_MOCK = `
(function(){
  var _user = { id:'plate-capture', email:'ops@mainstreet.local' };
  var _store = {};
  function P(v){return Promise.resolve(v);}
  function chain(d){return {select:function(){return P({data:d,error:null});},single:function(){return P({data:null,error:null});},then:function(f){return P({data:d,error:null}).then(f);}};}
  function makeQ(t){var q={select:function(){return q;},insert:function(r){return chain(r);},upsert:function(r){return chain([r]);},
    update:function(){return P({data:null,error:null});},delete:function(){return {eq:function(){return P({error:null});}};},
    eq:function(){return q;},neq:function(){return q;},in:function(){return q;},is:function(){return q;},order:function(){return q;},
    limit:function(){return q;},ilike:function(){return q;},single:function(){return P({data:null,error:null});},
    then:function(f){return P({data:[],error:null}).then(f);}};return q;}
  window.supabase={createClient:function(){return {auth:{
    getUser:function(){return P({data:{user:_user},error:null});},
    getSession:function(){return P({data:{session:{user:_user}},error:null});},
    onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:_user});},40);return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return P({error:null});}
  },from:function(t){return makeQ(t);},storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}},_store:_store};}};
})();`;

function serve() {
  return http.createServer((rq, rs) => {
    let r = rq.url.split('?')[0]; if (r === '/') r = '/index.html';
    fs.readFile(path.join(ROOT, r), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' });
      rs.end(d);
    });
  });
}

// Strip anything that is local-only chrome or a personalised greeting. A plate
// that carries a dev switcher or an account name is not shippable.
const CLEAN = () => {
  ['restoredBanner', '_devRoleSwitcher'].forEach(id => {
    const e = document.getElementById(id); if (e) e.remove();
  });
  document.querySelectorAll('.cc-brief-greet').forEach(el => {
    el.textContent = el.textContent.replace(/,\s*[^,]*$/, '');
  });
};

// Element-level capture rather than a viewport clip: Playwright scrolls the
// element into view itself, so a plate far down the page (the settlement row)
// captures without hand-managing scroll offsets. `pad` is applied as temporary
// padding on the element so the plate has breathing room around it.
async function shootEl(page, handle, file, pad = 24) {
  await handle.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
  const undo = await handle.evaluate((el, p) => {
    const prev = el.style.padding;
    el.style.padding = p + 'px';
    return prev;
  }, pad);
  await page.waitForTimeout(120);
  await handle.screenshot({ path: path.join(OUT, file), timeout: 8000 });
  await handle.evaluate((el, prev) => { el.style.padding = prev; }, undo);
  const box = await handle.boundingBox();
  return { width: box ? Math.round(box.width) : null, height: box ? Math.round(box.height) : null };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = serve();
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1400 }, deviceScaleFactor: 2 });
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

  const report = { plates: [], figures: {} };

  // Record the figures the engine actually computed, so the studio can verify
  // the captions against the render rather than against this document.
  report.figures = await page.evaluate(() => {
    const prop = (typeof _props !== 'undefined' && _props[0]) || null;
    const recon = prop && (prop.camReconciliation || prop.reconciliation || prop.recon);
    const res = (recon && (recon.results || recon.allocations)) || [];
    const wh = res.find(r => /Whole Health/.test(r.name || ''));
    return {
      property: prop ? prop.name : null,
      wholeHealth: wh ? { capApplied: wh.capApplied, capAdjustment: wh.capAdjustment, totalAllocated: wh.totalAllocated } : null,
      cappedCount: res.filter(r => r.capApplied).length,
    };
  });

  // ── BEAT 1 — the cap catch ───────────────────────────────────────────────
  await page.evaluate(() => { if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('cam'); });
  await page.waitForTimeout(600);
  // The allocation table is written by a reconciliation run, not by loading a
  // stored result — so run one. This is also literally what beat 1 depicts:
  // the table resolving live.
  // runAllocation() is the UI-level entry point — it assembles the Property,
  // Lease and Invoice objects from live form state and writes the results DOM.
  // runFullReconciliation() takes an already-built Property, so calling it with
  // a raw _props entry throws.
  await page.evaluate(() => {
    if (typeof runAllocation === 'function') return runAllocation();
  });
  await page.waitForSelector('.rcs-cap-cell', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(CLEAN);
  const capRow = await page.$('.rcs-cap-cell');
  if (capRow) {
    const table = await page.evaluateHandle(el => el.closest('table') || el.closest('.rcs-wrap') || el.parentElement.parentElement, capRow);
    const dims = await shootEl(page, table.asElement(), 'beat1-cap-catch.png', 20);
    report.plates.push({ beat: 1, file: 'beat1-cap-catch.png', ...dims });
    // The poster is beat 1 rather than beat 2 — see FILM1_IMPLEMENTATION.md.
    // Framed on the allocation table itself: wider crops of this view pull in a
    // red variance banner and a completion toast, neither of which belongs on a
    // marketing page.
    await shootEl(page, table.asElement(), 'hero-poster.png', 20);
    report.plates.push({ beat: 'poster', file: 'hero-poster.png', ...dims });
  } else {
    report.plates.push({ beat: 1, error: 'no .rcs-cap-cell found — cap enforcement did not render' });
  }

  // ── BEAT 3 — verified settlement ─────────────────────────────────────────
  await page.evaluate(() => { if (typeof showCommandCenter === 'function') showCommandCenter(); });
  await page.waitForTimeout(1400);
  await page.evaluate(CLEAN);
  // Require the node to actually be laid out. Matching purely on text picks up
  // hidden ancestors and templates, which then time out on screenshot.
  const settle = await page.evaluateHandle(() => {
    const visible = e => {
      if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false;
      const r = e.getBoundingClientRect();
      return r.width > 40 && r.height > 10;
    };
    const hit = Array.from(document.querySelectorAll('div,section,li'))
      .filter(e => /settled & verified on the XRP Ledger/i.test(e.textContent || ''))
      .filter(visible)
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
    return hit || null;
  });
  if (settle.asElement()) {
    try {
      const dims3 = await shootEl(page, settle.asElement(), 'beat3-settlement.png', 20);
      report.plates.push({ beat: 3, file: 'beat3-settlement.png', ...dims3 });
    } catch (e) {
      report.plates.push({ beat: 3, error: 'capture failed: ' + e.message.split('\n')[0] });
    }
  } else {
    report.plates.push({ beat: 3, error: 'settlement row not found in a visible container' });
  }

  fs.writeFileSync(path.join(OUT, 'hero-plates.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await ctx.close(); await browser.close(); srv.close();
})();
