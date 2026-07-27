'use strict';
/**
 * Lease job lifecycle — terminal state must not depend on in-memory state.
 *
 * _leaseJobs is an in-memory Map. Every lifecycle write went through
 * updateLeaseJob(), which returned null and wrote nothing when the Map lacked
 * the entry. Since finalizeLeaseJob() and failLeaseJob() both route through it,
 * a job could record neither its completion nor its failure: five real uploads
 * sat at status 'processing' with every diagnostic column null and no
 * error_message — indistinguishable from a job still running.
 *
 * These checks pin the terminal write to the database rather than the Map.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8837;
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

  // Intercept writes to lease_jobs so we can see exactly what reaches the DB.
  await page.evaluate(() => {
    window.__writes = [];
    window.__failNext = 0;
    const origFrom = db.from.bind(db);
    db.from = (table) => {
      if (table !== 'lease_jobs') return origFrom(table);
      return {
        upsert: (row) => {
          window.__writes.push(JSON.parse(JSON.stringify(row)));
          if (window.__failNext > 0) { window.__failNext--; return Promise.resolve({ error: { message: 'simulated write failure' } }); }
          return Promise.resolve({ data: [row], error: null });
        },
      };
    };
  });

  const run = fn => page.evaluate(async (src) => {
    window.__writes = [];
    // eslint-disable-next-line no-eval
    await eval(src);
    await new Promise(r => setTimeout(r, 200));
    return window.__writes;
  }, fn);

  console.log('\n── A job absent from the in-memory map still reaches the database ──');
  let w = await run(`
    _leaseJobs.delete('ghost-1');
    finalizeLeaseJob('ghost-1', { norm:{}, conf:{level:'high',score:95}, meta:{extractionRoute:'text'}, tenantId:null });
  `);
  w.length ? ok(`finalizeLeaseJob wrote ${w.length} row(s) despite no map entry`)
           : bad('finalizeLeaseJob wrote nothing', 'terminal status would be lost');
  (w[0] && w[0].status === 'completed')
    ? ok(`status reached the database as "${w[0].status}"`)
    : bad('status not completed', JSON.stringify(w[0]));
  (w[0] && w[0].id === 'ghost-1')
    ? ok('the write is keyed by the job id') : bad('job id missing from the row', JSON.stringify(w[0]));
  (w[0] && w[0].extraction_route === 'text' && w[0].confidence_level === 'high')
    ? ok('diagnostics (extraction_route, confidence_level) are carried, not null')
    : bad('diagnostic columns missing', JSON.stringify(w[0]));

  w = await run(`
    _leaseJobs.delete('ghost-2');
    failLeaseJob('ghost-2', new Error('boom'), 'extraction');
  `);
  (w[0] && w[0].status === 'failed' && /boom/.test(w[0].error_message || ''))
    ? ok(`failLeaseJob records the failure: "${w[0].error_message}"`)
    : bad('failure not recorded', JSON.stringify(w[0]));

  console.log('\n── A terminal write retries once when it fails ──');
  w = await page.evaluate(async () => {
    window.__writes = []; window.__failNext = 1;
    finalizeLeaseJob('retry-1', { norm:{}, conf:{level:'high',score:90}, meta:{extractionRoute:'text'}, tenantId:null });
    await new Promise(r => setTimeout(r, 300));
    return window.__writes;
  });
  (w.length === 2) ? ok('a failed terminal write is retried (2 attempts observed)')
                   : bad('terminal write not retried', `${w.length} attempt(s)`);

  w = await page.evaluate(async () => {
    window.__writes = []; window.__failNext = 1;
    updateLeaseJob('mid-1', { stage: 'normalize' });
    await new Promise(r => setTimeout(r, 300));
    return window.__writes;
  });
  (w.length === 1) ? ok('a non-terminal write is not retried — only the final status matters')
                   : bad('non-terminal write retried', `${w.length} attempt(s)`);

  console.log('\n── Normal in-map behaviour is unchanged ──');
  const inMap = await page.evaluate(async () => {
    window.__writes = [];
    _leaseJobs.set('live-1', { id: 'live-1', status: 'processing', stage: 'upload', progress: 10 });
    const returned = updateLeaseJob('live-1', { stage: 'extraction' });
    await new Promise(r => setTimeout(r, 200));
    return { returned: !!returned, stage: _leaseJobs.get('live-1').stage, writes: window.__writes.length };
  });
  inMap.returned ? ok('updateLeaseJob still returns the job when it is in the map') : bad('return value changed');
  (inMap.stage === 'extraction') ? ok('the in-memory job is still mutated') : bad('map not updated', inMap.stage);
  (inMap.writes === 1) ? ok('still exactly one write for an in-map update') : bad('write count changed', String(inMap.writes));

  console.log('\n── In-memory-only fields never reach the database ──');
  const stripped = await page.evaluate(async () => {
    window.__writes = [];
    _leaseJobs.set('live-2', { id: 'live-2', status: 'processing', _secret: 'do-not-persist' });
    updateLeaseJob('live-2', { stage: 'normalize', _alsoSecret: 1 });
    await new Promise(r => setTimeout(r, 200));
    return window.__writes[0];
  });
  (stripped && !('_secret' in stripped) && !('_alsoSecret' in stripped))
    ? ok('underscore-prefixed fields are still stripped') : bad('internal fields leaked', JSON.stringify(stripped));

  console.log('\n\u2500\u2500 A failure records every diagnostic column \u2500\u2500');
  let w2 = await page.evaluate(async () => {
    window.__writes = [];
    _lastIngestTelemetry = { path: 'text', pages: 3, outcome: 'failure' };
    failLeaseJob('diag-1', new Error('extraction exploded'), 'extraction');
    await new Promise(r => setTimeout(r, 200));
    return window.__writes[0];
  });
  for (const [col, want] of [['status','failed'], ['confidence_level','failed'],
                             ['extraction_route','text'], ['confidence_score', 0]]) {
    (w2 && w2[col] === want) ? ok(`${col} = ${JSON.stringify(w2[col])}`)
                             : bad(`${col} not recorded`, JSON.stringify(w2 && w2[col]));
  }
  (w2 && w2.error_message && w2.debug_summary && w2.debug_summary.ingest)
    ? ok('error_message and debug_summary.ingest both present')
    : bad('diagnostics incomplete', JSON.stringify(w2));

  console.log('\n\u2500\u2500 The watchdog guarantees an outcome \u2500\u2500');
  const wd = await page.evaluate(async () => {
    window.__writes = [];
    // Arm via a normal non-terminal update, then confirm a timer exists.
    updateLeaseJob('wd-1', { stage: 'extraction' });
    const armed = _jobWatchdogs.has('wd-1');
    // A terminal update must disarm it.
    updateLeaseJob('wd-1', { status: 'completed' });
    const cleared = !_jobWatchdogs.has('wd-1');
    return { armed, cleared };
  });
  wd.armed   ? ok('a non-terminal update arms the watchdog')  : bad('watchdog not armed');
  wd.cleared ? ok('a terminal update disarms it')             : bad('watchdog left running');

  console.log('\n\u2500\u2500 Abandoned jobs are closed out at startup \u2500\u2500');
  const reap = await page.evaluate(async () => {
    const stale = [{ id: 'stale-1', status: 'processing', stage: 'normalize', updated_at: '2020-01-01T00:00:00Z' }];
    const origFrom = db.from.bind(db);
    db.from = (t) => {
      if (t !== 'lease_jobs') return origFrom(t);
      return {
        select: () => ({ in: () => Promise.resolve({ data: stale, error: null }) }),
        upsert: (row) => { window.__writes.push(JSON.parse(JSON.stringify(row))); return Promise.resolve({ data: [row], error: null }); },
      };
    };
    window.__writes = [];
    const res = await _reapStaleLeaseJobs();
    return { res, writes: window.__writes };
  });
  (reap.res && reap.res.reaped === 1) ? ok('one abandoned job found and closed out')
                                      : bad('reaper did not close the stale job', JSON.stringify(reap.res));
  const rw = reap.writes && reap.writes[0];
  (rw && rw.status === 'failed' && /tab closed or was suspended/i.test(rw.error_message || ''))
    ? ok(`reaped job explains itself: "${rw.error_message.slice(0, 58)}\u2026"`)
    : bad('reaped job lacks an explanation', JSON.stringify(rw));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
