'use strict';
/**
 * AUDIT_RIGHTS validator regression suite.
 *
 * audit_rights is a BOOLEAN by extraction contract (true | false | null); the
 * clause text lives in the parallel quotes channel. The check previously read
 * the day count off the boolean, which meant it could never work on an
 * extracted lease: true crashed on .match(), false and null both reported
 * "not extracted".
 *
 * Pins the four states, and that waiver is treated as materially different
 * from silence.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8827;
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

  const RECON = '2025-01-01T00:00:00.000Z';
  const check = (audit_rights, quote, page_ = 2) => page.evaluate(({ audit_rights, quote, page_, RECON }) => {
    const t = { tenant_name: 'T', admin_fee_pct: null, audit_rights,
      fieldEvidence: quote ? { audit_rights: { snapshots: [{ quote, page: page_ }] } } : {} };
    let out;
    try { out = _tier1LeaseChecks(t, 1000, [], RECON); }
    catch (e) { return { threw: e.message }; }
    const f = out.find(x => x.check === 'AUDIT_RIGHTS');
    return f ? { finding: f.finding, severity: f.severity, quote: f.quote, page: f.page } : { missing: true };
  }, { audit_rights, quote, page_, RECON });

  const CLAUSE = "Tenant shall have the right to audit… within ninety (90) days after Tenant's receipt of such reconciliation statement";

  console.log('\n── Granted, with a parsable deadline ──');
  let r = await check(true, CLAUSE);
  if (r.threw) bad('threw', r.threw);
  else {
    /audit window/i.test(r.finding) ? ok(`deadline computed from the clause: "${r.finding}"`)
                                    : bad('no audit window computed', JSON.stringify(r));
    r.quote === CLAUSE ? ok('finding carries the verbatim clause') : bad('quote not attached');
    r.page === 2 ? ok('finding cites page 2 from the evidence snapshot') : bad('page not carried', String(r.page));
  }

  console.log('\n── Granted, deadline not parsable ──');
  r = await check(true, 'Tenant may audit the records upon reasonable notice.');
  // Was `severity === 'info'`, which the panel renders as a green PASSED tick.
  // The right exists but its window cannot be computed, so whether the tenant
  // can still audit is UNKNOWN — the one thing it is not is confirmed. The
  // assertion's intent is unchanged and now also pins the negative.
  (!r.threw && /could not be computed/i.test(r.finding) && r.severity === 'unconfirmed')
    ? ok('reports the clause and says the deadline is unknown') : bad('unexpected', JSON.stringify(r));
  r.severity !== 'info'
    ? ok('an uncomputable audit window is not reported as a pass')
    : bad('an unknown audit window still renders as PASSED');

  console.log('\n── Granted, no quote captured ──');
  r = await check(true, null);
  (!r.threw && /no deadline was extracted/i.test(r.finding))
    ? ok('states the right exists without inventing a window') : bad('unexpected', JSON.stringify(r));

  console.log('\n── Explicitly waived vs. not addressed ──');
  const waived = await check(false, 'Tenant hereby waives any right to audit.');
  const silent = await check(null, null);
  (waived.severity === 'warning' && /waived/i.test(waived.finding))
    ? ok(`waiver is a review item, not a pass: "${waived.finding}"`)
    : bad('waiver not surfaced as warning', JSON.stringify(waived));
  // Was `silent.severity === 'info'`. That expectation is what made "Audit
  // rights are not addressed in this lease" display a green PASSED badge —
  // absence of evidence shown as confirmation, which is indefensible in front
  // of a tenant auditor. The intent of this case ("silence is distinct from
  // waiver") is unchanged; only the severity it was pinned to was wrong.
  (silent.severity === 'unconfirmed' && /not addressed/i.test(silent.finding))
    ? ok(`silence is distinct: "${silent.finding}"`) : bad('silence wrong', JSON.stringify(silent));
  (silent.severity !== 'info' && silent.severity !== 'warning')
    ? ok('silence is neither a pass nor a fault')
    : bad('silence was collapsed into pass or warning', silent.severity);
  (waived.finding !== silent.finding)
    ? ok('the two states are reported differently') : bad('waived and silent are indistinguishable');

  console.log('\n── The old crash cannot come back ──');
  r = await check(true, CLAUSE);
  !r.threw ? ok('boolean true no longer reaches a string method') : bad('still throws', r.threw);
  r = await check('90 days from reconciliation', null);
  !r.threw ? ok('a stray legacy string degrades safely rather than throwing') : bad('legacy string throws', r.threw);

  console.log('\n── Demo seed matches the contract ──');
  const seed = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const block = seed.slice(seed.indexOf('const demoTenantConfigs'), seed.indexOf('const demoInvoiceList'));
  !/audit_rights:\s*'/.test(block)
    ? ok('no demo tenant carries a string audit_rights')
    : bad('a demo tenant still uses a string', 'it normalises to false = "waived"');
  /audit_rights:\s*true/.test(block)
    ? ok('Whole Health Market grants audit rights, matching its lease §7.1')
    : bad('Whole Health audit_rights is not true');

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
