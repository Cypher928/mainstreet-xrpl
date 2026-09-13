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
 *
 * D2-1 adds the third, and the largest: the check could not fire at all on the
 * category this product writes. Every invoice leaves the categoriser as one of
 * CATEGORIES (script.js:696), where the admin one is exactly 'management' — and
 * the keyword list was matched with `cat.includes(kw)`, in which nothing
 * matches 'management' ('management fee' is LONGER than the category it was
 * meant to catch). Measured across the pilot dataset: 12 of 12 management
 * invoices categorised 'management', so the check was dead on all of them and
 * reported "no administrative fee line items identified" on reconciliations
 * whose largest line was the management fee.
 *
 * The cases below fix the fixture that hid it: the ORIGINAL suite fed
 * `category: 'management fee'`, a string the product never emits.
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
  // THE CATEGORY THE PRODUCT ACTUALLY WRITES. Same money, same shape, the one
  // string CATEGORIES contains — and the one the check used to be blind to.
  const CANON = [{ category: 'management', amount: 2000 }, { category: 'landscaping', amount: 8000 }];
  // Every line item is passed as the pool it is measured against, which is the
  // same-basis contract _runLeaseValidation establishes at the call site.
  const POOL  = 10000;
  const check = (admin_fee_pct, snapshots, lines = LINES, pool = POOL) =>
    page.evaluate(({ admin_fee_pct, snapshots, lines, pool }) => {
      const t = { tenant_name: 'T', admin_fee_pct, audit_rights: null,
                  fieldEvidence: snapshots ? { admin_fee_pct: { snapshots } } : {} };
      let out; try { out = _tier1LeaseChecks(t, pool, lines, '2025-01-01T00:00:00.000Z'); }
      catch (e) { return { threw: e.message }; }
      const f = out.find(x => x.check === 'MGMT_FEE_CAP');
      return f ? { finding: f.finding, severity: f.severity, quote: f.quote,
                   explanation: f.explanation } : { missing: true };
    }, { admin_fee_pct, snapshots, lines, pool });

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

  console.log('\n── D2-1 · the canonical category the product actually writes ──');
  // THE ONE THAT WAS DEAD. 2,000 of a 10,000 pool is 20%, twice a 10% cap —
  // and before D2-1 this reported "no administrative fee line items
  // identified", because no keyword is a substring of 'management'.
  r = await check(10, null, CANON);
  (r.severity === 'warning' && /exceeds the 10% lease cap/i.test(r.finding))
    ? ok(`category "management" is recognised and the breach is reported: "${r.finding}"`)
    : bad('canonical category still not recognised', JSON.stringify(r));
  const kw = await check(10, null, LINES);
  (r.finding === kw.finding && r.severity === kw.severity)
    ? ok('canonical and free-text categories produce an identical finding')
    : bad('canonical and keyword disagree', `${r.finding} vs ${kw.finding}`);

  r = await check(25, null, CANON);
  (r.severity === 'info' && /within the 25% lease cap/i.test(r.finding))
    ? ok(`a genuine within-cap case still reads as within cap: "${r.finding}"`)
    : bad('within-cap case wrong on the canonical category', JSON.stringify(r));

  // The keyword fallback must survive — data that never went through the
  // categoriser still carries free text.
  r = await check(10, null, [{ category: 'Property Management Fee — Q3', amount: 2000 },
                             { category: 'landscaping', amount: 8000 }]);
  (r.severity === 'warning' && /exceeds the 10% lease cap/i.test(r.finding))
    ? ok('the free-text keyword fallback is retained for uncategorised data')
    : bad('keyword fallback lost', JSON.stringify(r));

  // Canonical and free-text lines in one reconciliation are both counted, and
  // counted once: 1,000 + 1,000 of 10,000 is the same 20%.
  r = await check(10, null, [{ category: 'management', amount: 1000 },
                             { category: 'admin', amount: 1000 },
                             { category: 'landscaping', amount: 8000 }]);
  /exceeds the 10% lease cap by 10\.0 percentage points/i.test(r.finding)
    ? ok('canonical and free-text admin lines are summed together, not double-counted')
    : bad('mixed admin lines miscounted', JSON.stringify(r));

  console.log('\n── D2-1 · absence is still absence, never a pass ──');
  r = await check(10, null, [{ category: 'landscaping', amount: 8000 },
                             { category: 'utilities', amount: 2000 }]);
  (r.severity === 'unconfirmed' && /could not be tested/i.test(r.finding))
    ? ok(`no admin lines stays UNCONFIRMED, not info: "${r.finding}"`)
    : bad('absence of admin lines became a pass', JSON.stringify(r));
  // 'management' must not be matched loosely enough to swallow its neighbours.
  r = await check(10, null, [{ category: 'maintenance', amount: 2000 },
                             { category: 'landscaping', amount: 8000 }]);
  (r.severity === 'unconfirmed')
    ? ok('"maintenance" is not read as an admin line')
    : bad('a non-admin category was counted as admin', JSON.stringify(r));
  // THE CANONICAL MATCH IS EQUALITY, NOT A PREFIX. A substring rule loose
  // enough to catch 'management' — `cat.includes('man')` — also catches free
  // text that has nothing to do with an admin fee, and would invent a breach
  // out of somebody's materials bill.
  r = await check(10, null, [{ category: 'manufacturing supplies', amount: 2000 },
                             { category: 'landscaping', amount: 8000 }]);
  (r.severity === 'unconfirmed')
    ? ok('"manufacturing supplies" is not read as an admin line either')
    : bad('loose substring matching counted a non-admin category', JSON.stringify(r));

  console.log('\n── D2-1 · the finding names the denominator it divided by ──');
  r = await check(10, null, CANON);
  (/of the \$10,000 CAM pool this reconciliation billed from/i.test(r.explanation || ''))
    ? ok(`the explanation states the pool: "${r.explanation}"`)
    : bad('explanation does not name its denominator', JSON.stringify(r.explanation));
  // The ratio follows the pool it is given, and 2,000 of 20,000 is 10% — the
  // arithmetic a wrong (gross) denominator would produce. Pinned so a revert to
  // gross changes a number this suite reads.
  r = await check(15, null, CANON, 20000);
  (r.severity === 'info' && /\(10\.0%\) is within the 15% lease cap/i.test(r.finding))
    ? ok('the percentage is struck from the pool argument, whatever it is')
    : bad('percentage does not follow the pool argument', JSON.stringify(r));

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
