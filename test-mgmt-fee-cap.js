'use strict';
/**
 * MGMT_FEE_CAP validator regression suite.
 *
 * Two defects of the same class as the audit-rights bug — a deterministic check
 * reading the wrong source and producing a confident false result:
 *
 *   1. cap was read with `typeof === 'number'`. The extraction normalizer emits
 *      a number, but the tenant-record loader passes the stored value through
 *      untouched, so a jsonb-persisted "15" arrived as a string and the check
 *      reported "no cap was extracted".
 *   2. the evidence quote came from snapshots[0] — the ORIGINAL extraction —
 *      while the number came from the current field, so after a correction the
 *      finding quoted superseded language beside an up-to-date number.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8833;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const MOCK = `(function(){var u={id:'t',email:'t@t.local'};function P(v){return Promise.resolve(v);}
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
  const page = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(MOCK);
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**supabase**', r => { const u = r.request().url();
    return u.includes('127.0.0.1') ? r.continue() : r.fulfill({ status: 200, body: '/*x*/' }); });
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#appContent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const LINES = [{ category: 'management fee', amount: 2000 }, { category: 'landscaping', amount: 8000 }];
  const check = (admin_fee_pct, snapshots) => page.evaluate(({ admin_fee_pct, snapshots, LINES }) => {
    const t = { tenant_name: 'T', admin_fee_pct, audit_rights: null,
                fieldEvidence: snapshots ? { admin_fee_pct: { snapshots } } : {} };
    let out; try { out = _tier1LeaseChecks(t, 10000, LINES, '2025-01-01T00:00:00.000Z'); }
    catch (e) { return { threw: e.message }; }
    const f = out.find(x => x.check === 'MGMT_FEE_CAP');
    return f ? { finding: f.finding, severity: f.severity, quote: f.quote } : { missing: true };
  }, { admin_fee_pct, snapshots, LINES });

  console.log('\n── A cap stored as a string is still a cap ──');
  let r = await check('25', null);
  (!r.threw && /within the 25% lease cap/i.test(r.finding))
    ? ok(`string "25" is read as a cap: "${r.finding}"`)
    : bad('string cap misread', JSON.stringify(r));
  const asNum = await check(25, null);
  (asNum.finding === r.finding)
    ? ok('string and numeric caps produce an identical finding')
    : bad('string and numeric disagree', `${r.finding} vs ${asNum.finding}`);

  console.log('\n── A genuine breach is still reported ──');
  r = await check(10, null);   // 2000/10000 = 20% against a 10% cap
  (r.severity === 'warning' && /exceeds the 10% lease cap/i.test(r.finding))
    ? ok(`breach detected: "${r.finding}"`) : bad('breach missed', JSON.stringify(r));

  console.log('\n── Absence is still absence ──');
  r = await check(null, null);
  /No management fee cap was extracted/i.test(r.finding)
    ? ok('null cap reports absence, as before') : bad('null cap wrong', JSON.stringify(r));
  r = await check('not a number', null);
  /No management fee cap was extracted/i.test(r.finding)
    ? ok('unparsable value reports absence rather than a garbled cap') : bad('garbage not handled', JSON.stringify(r));

  console.log('\n── The quote matches the value in use ──');
  const OLD = 'administrative fee not to exceed twenty percent (20%)';
  const NEW = 'administrative fee not to exceed fifteen percent (15%)';
  r = await check(15, [{ quote: OLD, page: 3 }, { quote: NEW, page: 4 }]);
  r.quote === NEW
    ? ok('finding quotes the latest snapshot, matching the current cap')
    : bad('finding quotes a superseded snapshot', `got: ${JSON.stringify(r.quote)}`);
  r = await check(15, [{ quote: NEW, page: 4 }]);
  r.quote === NEW ? ok('single-snapshot case unaffected') : bad('single snapshot broke', JSON.stringify(r.quote));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
