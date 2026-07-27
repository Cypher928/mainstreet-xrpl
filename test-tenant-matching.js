'use strict';
/**
 * Tenant matching for lease uploads.
 *
 * An upload appended a new tenant unconditionally (placeholderIdx =
 * tenantData.length, no lookup), so re-uploading a lease for an existing tenant
 * produced a duplicate: "Whole Health Market" and "Whole Health Market, Inc".
 * The lease landed on the new record, and surfaces keyed to the original
 * reported no lease on file.
 *
 * Match order is suite, then normalized name, then nothing. Ambiguity is never
 * merged — a wrong merge silently corrupts CAM allocation across two real
 * tenants, which is worse than a visible duplicate.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8839;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const MOCK = `(function(){var u={id:'t',email:'t@t.local'};function P(v){return Promise.resolve(v);}
function q(){var o={select:function(){return o;},insert:function(r){return P({data:r,error:null});},upsert:function(r){return P({data:[r],error:null});},
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

  const match = (tenants, incoming, skipIdx = -1) =>
    page.evaluate(({ tenants, incoming, skipIdx }) => findTenantMatch(tenants, incoming, skipIdx),
                  { tenants, incoming, skipIdx });
  const norm = name => page.evaluate(n => _normalizeTenantName(n), name);

  const EXISTING = [
    { id: 'a', tenant_name: 'Whole Health Market',       unitNumber: '100' },
    { id: 'b', tenant_name: 'Summit Coffee & Provisions', unitNumber: '210' },
  ];

  console.log('\n── The reported case ──');
  let r = await match(EXISTING, { tenant_name: 'Whole Health Market, Inc', suite: 'Suite 100' });
  (r && r.index === 0 && r.basis === 'suite')
    ? ok('"Whole Health Market, Inc" in Suite 100 links to the existing tenant by suite')
    : bad('did not link', JSON.stringify(r));

  console.log('\n── Suite wins, and beats the name ──');
  r = await match(EXISTING, { tenant_name: 'Something Entirely Different', suite: '210' });
  (r && r.index === 1 && r.basis === 'suite')
    ? ok('a renamed tenant in a known suite still links (suite is the stronger signal)')
    : bad('suite match failed', JSON.stringify(r));
  for (const form of ['Suite 100', 'Ste. 100', 'Unit 100', '#100', '100']) {
    r = await match(EXISTING, { tenant_name: 'X', suite: form });
    (r && r.index === 0) ? ok(`suite form "${form}" normalizes and matches`) : bad(`suite form "${form}" missed`);
  }

  console.log('\n── Name fallback when there is no suite ──');
  r = await match(EXISTING, { tenant_name: 'WHOLE HEALTH MARKET, L.L.C.' });
  (r && r.index === 0 && r.basis === 'name')
    ? ok('case, punctuation and legal suffix are all normalized away')
    : bad('name fallback failed', JSON.stringify(r));
  (await norm('Whole Health Market, Inc.')) === (await norm('whole health market'))
    ? ok('"Whole Health Market, Inc." and "whole health market" normalize identically')
    : bad('normalizer inconsistent');

  console.log('\n── Genuinely different tenants are not merged ──');
  r = await match(EXISTING, { tenant_name: 'Summit Coffee Roasters', suite: '999' });
  (r === null) ? ok('"Summit Coffee Roasters" is not merged into "Summit Coffee & Provisions"')
               : bad('merged two distinct tenants', JSON.stringify(r));
  r = await match(EXISTING, { tenant_name: 'Brand New Tenant' });
  (r === null) ? ok('an unknown tenant creates a new record, as it should') : bad('false match', JSON.stringify(r));

  console.log('\n── Ambiguity is surfaced, never guessed ──');
  const DUPES = [
    { id: 'a', tenant_name: 'Acme Holdings', unitNumber: '300' },
    { id: 'b', tenant_name: 'Acme Holdings LLC', unitNumber: '400' },
  ];
  r = await match(DUPES, { tenant_name: 'Acme Holdings, Inc.' });
  (r && r.ambiguous && r.candidates.length === 2)
    ? ok('two tenants with the same normalized name are flagged, not merged')
    : bad('ambiguous name not flagged', JSON.stringify(r));
  const SAME_SUITE = [
    { id: 'a', tenant_name: 'Old Tenant', unitNumber: '500' },
    { id: 'b', tenant_name: 'New Tenant', unitNumber: 'Suite 500' },
  ];
  r = await match(SAME_SUITE, { tenant_name: 'Whoever', suite: '500' });
  (r && r.ambiguous && r.basis === 'suite')
    ? ok('two tenants in one suite are flagged, not merged')
    : bad('ambiguous suite not flagged', JSON.stringify(r));

  console.log('\n── An upload never matches its own placeholder ──');
  const WITH_PLACEHOLDER = [
    { id: 'a', tenant_name: 'Whole Health Market', unitNumber: '100' },
    { id: 'job-1', tenant_name: null, leaseExpected: true, fileName: 'x.pdf' },
  ];
  r = await match(WITH_PLACEHOLDER, { tenant_name: 'Whole Health Market', suite: '100' }, 1);
  (r && r.index === 0) ? ok('the in-flight placeholder is skipped and the real tenant matched')
                       : bad('placeholder interfered', JSON.stringify(r));
  r = await match([{ id: 'p', tenant_name: null, leaseExpected: true }], { tenant_name: 'Anything' }, -1);
  (r === null) ? ok('a pending placeholder is never a match target') : bad('matched a placeholder', JSON.stringify(r));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
