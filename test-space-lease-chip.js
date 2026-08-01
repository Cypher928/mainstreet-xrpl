'use strict';
/**
 * The Space modal must never render "Invalid Date".
 *
 * assemble() attaches the lease document chip without a `when`, and
 * new Date(undefined).toLocaleDateString() returns the literal string
 * "Invalid Date" rather than throwing — so every Space with a lease on file
 * showed "Invalid Date" beside the document name, including a real uploaded
 * lease. _fmtDate now renders nothing for absent or unparsable dates.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8845;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };
// Rich mock: insert/upsert results expose .select() because the demo seed calls
// db.from('properties').upsert(...).select('id') — a slimmer mock aborts the
// seed midway and the Space renders empty.
const MOCK = `(function(){var u={id:'t',email:'t@t.local'};function P(v){return Promise.resolve(v);}
function ins(r){var rows=Array.isArray(r)?r:[r];var p=P({data:rows,error:null});p.select=function(){return P({data:rows,error:null});};return p;}
function q(){var o={select:function(){return o;},insert:ins,upsert:ins,
update:function(){return P({data:null,error:null});},delete:function(){return {eq:function(){return P({error:null});}};},
eq:function(){return o;},neq:function(){return o;},in:function(){return P({data:[],error:null});},is:function(){return o;},order:function(){return o;},
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
  const page = await (await b.newContext({ viewport: { width: 1400, height: 1100 } })).newPage();
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
  await page.waitForTimeout(5000);

  const res = await page.evaluate(() => {
    const prop = (typeof _props !== 'undefined' && _props[0]) || null;
    const t = prop && (prop.tenants || []).find(x => x && /Whole Health/i.test(x.tenant_name || ''));
    if (!t || !window.TenantSpace) return { err: 'no tenant or TenantSpace' };
    TenantSpace.openSpace(t.id);
    const ov = document.getElementById('tsOverlay');
    if (!ov) return { err: 'space did not open' };
    const text = ov.innerText || '';
    return {
      hasLeaseChip: !!ov.querySelector('.ts-doc'),
      invalidDate: /Invalid Date/i.test(text),
      leaseBlock: /Lease type|Leased area/i.test(text),
      timelineEvents: prop.timeline ? prop.timeline.length : 0,
    };
  });

  console.log('\n── The Space renders a dated-less document cleanly ──');
  if (res.err) { bad('setup failed', res.err); }
  else {
    res.leaseBlock  ? ok('lease terms render (demo seed completed)') : bad('lease block missing', 'seed may have aborted');
    res.hasLeaseChip ? ok('the lease document chip is present') : bad('no lease chip', 'nothing to test');
    !res.invalidDate ? ok('no "Invalid Date" anywhere in the Space modal')
                     : bad('"Invalid Date" still rendered', 'the chip shows it beside the document name');
    res.timelineEvents > 0 ? ok(`demo timeline seeded (${res.timelineEvents} events) — rich state, not an empty shell`)
                           : bad('demo timeline empty', 'the rich-mock premise failed');
  }

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
