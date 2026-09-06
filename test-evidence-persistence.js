'use strict';
/**
 * Extracted evidence must be persisted, and must be persisted as PENDING.
 *
 * persistFieldEvidence() was only ever called from a manual edit or an approval,
 * so tenant_field_evidence stayed empty and the Evidence Viewer could only cite a
 * field a human had already touched — never one the extraction found. The
 * normalizer already builds complete snapshots from the model's `quotes`; nothing
 * wrote them to the normalized table.
 *
 * The trust property matters as much as the availability one: a machine-extracted
 * citation is available immediately, but must never claim to be approved or to
 * have been reviewed by a person.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8841;
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

  const CLAUSE = "shall not increase by more than five percent (5%)";

  const run = () => page.evaluate((CLAUSE) => {
    const writes = [];
    const orig = window._writeTenantFieldEvidence;
    window._writeTenantFieldEvidence = (p, t, k, snap) => { writes.push({ prop: p, tenant: t, key: k, snap }); };
    const fev = {
      cap:        { snapshots: [{ fieldKey: 'cap', quote: CLAUSE, page: 2, approved: false,
                                  manuallyEdited: false, reviewerUid: null, reviewerEmail: null,
                                  confidence: { status: 'estimated', note: 'AI-extracted' } }] },
      lease_type: { snapshots: [{ fieldKey: 'lease_type', quote: 'Triple Net (NNN)', page: 1, approved: false,
                                  manuallyEdited: false, reviewerUid: null, reviewerEmail: null,
                                  confidence: { status: 'estimated', note: 'AI-extracted' } }] },
      empty:      { snapshots: [{ fieldKey: 'empty', quote: null, page: null }] },
      none:       { snapshots: [] },
    };
    const n = _persistExtractedEvidence('prop-1', 'tenant-1', fev);
    window._writeTenantFieldEvidence = orig;
    return { n, writes };
  }, CLAUSE);

  const r = await run();

  console.log('\n── Extracted evidence reaches the normalized table ──');
  (r.n === 2) ? ok(`2 citable snapshots written (cap, lease_type)`) : bad('wrong write count', String(r.n));
  r.writes.some(w => w.key === 'cap' && w.snap.quote === CLAUSE)
    ? ok('the cap citation carries the verbatim clause') : bad('cap quote missing');
  r.writes.every(w => w.prop === 'prop-1' && w.tenant === 'tenant-1')
    ? ok('every write is scoped to the property and the linked tenant') : bad('scoping wrong');

  console.log('\n── Nothing uncitable is written ──');
  !r.writes.some(w => w.key === 'empty')
    ? ok('a snapshot with no quote and no page is skipped, not written as an empty citation')
    : bad('wrote an uncitable snapshot');
  !r.writes.some(w => w.key === 'none')
    ? ok('a field with no snapshots is skipped') : bad('wrote an empty field');

  console.log('\n── Available immediately, but never claimed as approved ──');
  r.writes.every(w => w.snap.approved === false)
    ? ok('every extracted snapshot is approved:false') : bad('an extracted snapshot claims approval');
  r.writes.every(w => w.snap.manuallyEdited === false)
    ? ok('none claims to be a manual correction') : bad('claims manual edit');
  r.writes.every(w => !w.snap.reviewerUid && !w.snap.reviewerEmail)
    ? ok('no reviewer is attributed — a machine extraction is not a human review')
    : bad('a reviewer was attributed to machine output');
  r.writes.every(w => w.snap.confidence && w.snap.confidence.status === 'estimated')
    ? ok('confidence reads "estimated" — the pending-review state the viewer shows')
    : bad('confidence status is not estimated');

  console.log('\n── Losing evidence never fails an upload ──');
  const guarded = await page.evaluate(() => {
    const orig = window._writeTenantFieldEvidence;
    window._writeTenantFieldEvidence = () => { throw new Error('table unavailable'); };
    let threw = false;
    try {
      _persistExtractedEvidence('p', 't', { cap: { snapshots: [{ quote: 'x', page: 1 }] } });
    } catch (e) { threw = true; }
    window._writeTenantFieldEvidence = orig;
    return !threw;
  });
  guarded ? ok('a write failure is swallowed — evidence is supporting material, not a gate')
          : bad('a failed evidence write propagated');

  console.log('\n── Networking is consistent ──');
  const net = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  // The old end marker was `const CAM_EXPLAIN_SYSTEM_PROMPT`, which AI-2 deleted
  // — the system prompts moved to api/_explain-tasks.js. Anchor on the comment
  // that replaced it so the slice still ends where explainFetch does.
  const ef = net.slice(net.indexOf('async function explainFetch'), net.indexOf('// AI-2 — CAM_EXPLAIN_SYSTEM_PROMPT'));
  /_fetchWithTimeout\('\/api\/explain'/.test(ef)
    ? ok('explainFetch goes through _fetchWithTimeout like every other Claude call')
    : bad('explainFetch still calls fetch directly', 'an unbounded request can hang the pipeline');
  !/await fetch\(/.test(ef) ? ok('no bare fetch left in explainFetch') : bad('a bare fetch remains');

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
