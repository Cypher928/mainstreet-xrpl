'use strict';
/**
 * Dispute lifecycle regression suite.
 *
 *   open -> docs_requested -> accepted | rejected
 *   open -> accepted | rejected
 *   accepted / rejected are terminal
 *
 * Covers the change that made docs_requested a waypoint instead of a dead end,
 * and pins the two behaviours that must NOT drift: existing open-to-decision
 * transitions keep working, and the audit fingerprint is minted only when a
 * dispute is actually decided.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8825;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };
const MOCK = `
(function(){var u={id:'t',email:'t@t.local'};function P(v){return Promise.resolve(v);}
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
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(MOCK);
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**supabase**', r => {
    const u = r.request().url();
    return u.includes('127.0.0.1') ? r.continue() : r.fulfill({ status: 200, body: '/*x*/' });
  });
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#appContent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(() => { if (typeof loadDemo === 'function') return loadDemo(); });
  await page.waitForTimeout(4500);

  // Drive one dispute through a path and report what the engine did.
  const run = (steps, startStatus) => page.evaluate(async ({ steps, startStatus }) => {
    const id = 990000 + Math.floor(performance.now() % 9000);
    disputes.push({ id, tenantName: 'T', invoiceId: null, vendor: 'V', category: 'maintenance',
      tenantShare: '100', reason: 'r', timestamp: new Date().toISOString(),
      status: startStatus, resolution: null, resolvedAt: null, hash: null, history: [] });
    const out = [];
    for (const s of steps) {
      await resolveDispute(id, s);
      const d = disputes.find(x => x.id === id);
      out.push({ attempted: s, status: d.status, hash: !!d.hash, history: (d.history || []).length });
    }
    const d = disputes.find(x => x.id === id);
    return { steps: out, finalHistory: (d.history || []).map(h => `${h.fromStatus}→${h.toStatus}`) };
  }, { steps, startStatus });

  console.log('\n── The gap that was fixed ──');
  let r = await run(['docs_requested', 'accepted'], 'open');
  r.steps[0].status === 'docs_requested'
    ? ok('open → docs_requested')
    : bad('open → docs_requested failed', r.steps[0].status);
  r.steps[1].status === 'accepted'
    ? ok('docs_requested → accepted (previously impossible — this was the dead end)')
    : bad('docs_requested → accepted still blocked', r.steps[1].status);

  r = await run(['docs_requested', 'rejected'], 'open');
  r.steps[1].status === 'rejected' ? ok('docs_requested → rejected') : bad('docs_requested → rejected blocked', r.steps[1].status);

  console.log('\n── Existing behaviour preserved ──');
  r = await run(['accepted'], 'open');
  r.steps[0].status === 'accepted' ? ok('open → accepted still works') : bad('open → accepted broke', r.steps[0].status);
  r = await run(['rejected'], 'open');
  r.steps[0].status === 'rejected' ? ok('open → rejected still works') : bad('open → rejected broke', r.steps[0].status);

  console.log('\n── Terminal states stay terminal ──');
  r = await run(['rejected'], 'accepted');
  r.steps[0].status === 'accepted' ? ok('accepted is terminal — cannot be re-decided') : bad('accepted was overwritten', r.steps[0].status);
  r = await run(['accepted'], 'rejected');
  r.steps[0].status === 'rejected' ? ok('rejected is terminal — cannot be re-decided') : bad('rejected was overwritten', r.steps[0].status);
  r = await run(['docs_requested'], 'docs_requested');
  r.steps[0].history === 0 ? ok('docs_requested → docs_requested is a no-op') : bad('re-requesting docs logged a transition');

  console.log('\n── Audit fingerprint only on a real decision ──');
  r = await run(['docs_requested'], 'open');
  !r.steps[0].hash ? ok('no fingerprint minted for docs_requested — it is not a decision')
                   : bad('fingerprint minted on docs_requested', 'contradicts the packet copy');
  r = await run(['docs_requested', 'accepted'], 'open');
  (!r.steps[0].hash && r.steps[1].hash)
    ? ok('fingerprint minted exactly when the dispute is decided')
    : bad('fingerprint timing wrong', JSON.stringify(r.steps.map(s => s.hash)));
  r = await run(['rejected'], 'open');
  r.steps[0].hash ? ok('rejection mints a fingerprint too') : bad('no fingerprint on rejection');

  console.log('\n── History records the real transition ──');
  r = await run(['docs_requested', 'accepted'], 'open');
  JSON.stringify(r.finalHistory) === JSON.stringify(['open→docs_requested', 'docs_requested→accepted'])
    ? ok(`history is accurate: ${r.finalHistory.join(', ')}`)
    : bad('history fromStatus is wrong', JSON.stringify(r.finalHistory));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await ctx.close(); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
