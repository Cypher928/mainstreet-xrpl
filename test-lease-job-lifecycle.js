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
  //
  // R2 replaced the bare upsert with a FILTERED update — the ordering guards are
  // PostgREST predicates now — and kept upsert only for a brand-new row. So this
  // stub accepts both, records the row either way, and exposes the filters that
  // travelled with it. It also answers the module's existence probe, which fires
  // after a guarded write matches nothing.
  await page.evaluate(() => {
    window.__writes = [];      // rows, in issue order
    window.__filters = [];     // the predicate list for each write
    window.__failNext = 0;
    window.__exists = true;    // what the existence probe should answer
    const origFrom = db.from.bind(db);
    db.from = (table) => {
      if (table !== 'lease_jobs') return origFrom(table);
      const write = (row) => {
        const filters = [];
        window.__writes.push(JSON.parse(JSON.stringify(row)));
        window.__filters.push(filters);
        const answer = () => {
          if (window.__failNext > 0) { window.__failNext--; return Promise.resolve({ data: null, error: { message: 'simulated write failure' } }); }
          return Promise.resolve({ data: [row], error: null });
        };
        const self = {
          eq: () => self, lte: () => self, lt: () => self, in: () => self,
          not: (c, op, v) => { filters.push('not:' + c + ':' + op + ':' + v); return self; },
          select: answer,
          then: (res, rej) => answer().then(res, rej),
        };
        // Record the guard-bearing filters for assertions.
        ['eq', 'lte', 'lt', 'in'].forEach((op) => {
          self[op] = (c, v) => { filters.push(op + ':' + c + ':' + v); return self; };
        });
        return self;
      };
      return {
        upsert: write,
        update: write,
        select: () => ({ eq: (_c, id) => Promise.resolve({ data: window.__exists ? [{ id }] : [], error: null }) }),
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
  //
  // The original contract was "the Map must not decide whether a terminal
  // status is recorded". R1 sharpened it: the row must also be ATTRIBUTABLE,
  // because lease_jobs_owner_all's WITH CHECK is
  // `property_id IN member_property_ids()` and a NULL there yields NULL, which
  // a policy reads as false. So a write-through row with no property_id was
  // never reaching the database — it was producing a 403 and a retry. It is now
  // refused locally and reported, which is the same loss made visible.
  //
  // Both halves are pinned below: with an attribution it writes; without one it
  // is refused OUT LOUD rather than silently dropped.
  let w = await run(`
    _leaseJobs.delete('ghost-1');
    _leaseJobs.set('ghost-1', { id:'ghost-1', property_id:'00000000-0000-4000-a000-00000000fixt',
                                status:'processing', stage:'confidence', progress:88, retry_count:0 });
    finalizeLeaseJob('ghost-1', { norm:{}, conf:{level:'high',score:95}, meta:{extractionRoute:'text'}, tenantId:null });
  `);
  w.length ? ok(`finalizeLeaseJob wrote ${w.length} row(s)`)
           : bad('finalizeLeaseJob wrote nothing', 'terminal status would be lost');
  (w[0] && w[0].status === 'completed')
    ? ok(`status reached the database as "${w[0].status}"`)
    : bad('status not completed', JSON.stringify(w[0]));
  (w[0] && w[0].id === 'ghost-1')
    ? ok('the write is keyed by the job id') : bad('job id missing from the row', JSON.stringify(w[0]));
  (w[0] && w[0].extraction_route === 'text' && w[0].confidence_level === 'high')
    ? ok('diagnostics (extraction_route, confidence_level) are carried, not null')
    : bad('diagnostic columns missing', JSON.stringify(w[0]));

  // THE WRITE-THROUGH BRANCH, with no attribution available. This is the gap
  // R1 exposed: finalizeLeaseJob takes no propertyId argument, so a job that
  // has fallen out of the Map cannot complete. It must SAY SO, not vanish.
  const ghostNoProp = await page.evaluate(async () => {
    window.__writes = [];
    const seen = [];
    const origLog = window.logError;
    window.logError = (t, e, c) => { seen.push({ t, m: e && e.message }); };
    _leaseJobs.delete('ghost-3');
    finalizeLeaseJob('ghost-3', { norm:{}, conf:{level:'high',score:95}, meta:{extractionRoute:'text'}, tenantId:null });
    await new Promise(r => setTimeout(r, 200));
    window.logError = origLog;
    return { writes: window.__writes.length, seen };
  });
  (ghostNoProp.writes === 0)
    ? ok('an unattributable terminal write issues no doomed request')
    : bad('a row with no property_id was still sent', String(ghostNoProp.writes));
  (ghostNoProp.seen.some(s => s.t === 'lease_job_sync_incomplete'))
    ? ok('and it is reported — the loss is visible, not silent')
    : bad('unattributable write vanished without a word', JSON.stringify(ghostNoProp.seen));

  // failLeaseJob DOES take a propertyId (R1), so the reaper's path still works
  // from outside the Map.
  w = await run(`
    _leaseJobs.delete('ghost-2');
    failLeaseJob('ghost-2', new Error('boom'), 'extraction', '00000000-0000-4000-a000-00000000fixt');
  `);
  (w[0] && w[0].status === 'failed' && /boom/.test(w[0].error_message || ''))
    ? ok(`failLeaseJob records the failure: "${w[0].error_message}"`)
    : bad('failure not recorded', JSON.stringify(w[0]));
  (w[0] && w[0].property_id === '00000000-0000-4000-a000-00000000fixt')
    ? ok('and the supplied property_id travels with it')
    : bad('property_id lost on the write-through branch', JSON.stringify(w[0]));

  console.log('\n── A terminal write retries once when it fails ──');
  w = await page.evaluate(async () => {
    window.__writes = []; window.__failNext = 1;
    _leaseJobs.set('retry-1', { id:'retry-1', property_id:'00000000-0000-4000-a000-00000000fixt',
                                status:'processing', stage:'confidence', progress:88, retry_count:0 });
    finalizeLeaseJob('retry-1', { norm:{}, conf:{level:'high',score:90}, meta:{extractionRoute:'text'}, tenantId:null });
    await new Promise(r => setTimeout(r, 300));
    return window.__writes;
  });
  (w.length === 2) ? ok('a failed terminal write is retried (2 attempts observed)')
                   : bad('terminal write not retried', `${w.length} attempt(s)`);

  w = await page.evaluate(async () => {
    window.__writes = []; window.__failNext = 1;
    _leaseJobs.set('mid-1', { id:'mid-1', property_id:'00000000-0000-4000-a000-00000000fixt',
                              status:'processing', stage:'upload', progress:10, retry_count:0 });
    updateLeaseJob('mid-1', { stage: 'normalize' });
    await new Promise(r => setTimeout(r, 300));
    return window.__writes;
  });
  (w.length === 1) ? ok('a non-terminal write is not retried — only the final status matters')
                   : bad('non-terminal write retried', `${w.length} attempt(s)`);

  // R2: the guards that make ordering safe must actually travel on the wire.
  console.log('\n── The ordering guards travel with the write (R2) ──');
  const guards = await page.evaluate(async () => {
    window.__writes = []; window.__filters = [];
    _leaseJobs.set('g-1', { id:'g-1', property_id:'00000000-0000-4000-a000-00000000fixt',
                            status:'processing', stage:'upload', progress:10, retry_count:0 });
    updateLeaseJob('g-1', { stage: 'normalize', progress: 72 });
    await new Promise(r => setTimeout(r, 150));
    const advance = (window.__filters[0] || []).join(' ');
    window.__writes = []; window.__filters = [];
    updateLeaseJob('g-1', { status: 'completed', stage: 'completed', progress: 100 }, { terminal: true });
    await new Promise(r => setTimeout(r, 150));
    const terminal = (window.__filters[0] || []).join(' ');
    return { advance, terminal };
  });
  /not:status:in:\(completed,failed,review_required\)/.test(guards.advance)
    ? ok('a stage write refuses to overwrite a terminal job') : bad('terminal guard missing', guards.advance);
  /lte:progress:72/.test(guards.advance)
    ? ok('a stage write refuses to move progress backward') : bad('progress guard missing', guards.advance);
  /eq:retry_count:0/.test(guards.advance)
    ? ok('a stage write is pinned to its retry generation') : bad('generation guard missing', guards.advance);
  !/not:status|lte:progress/.test(guards.terminal)
    ? ok('a terminal write carries no state guard — finishing a job is the point')
    : bad('terminal write was guarded', guards.terminal);

  console.log('\n── Normal in-map behaviour is unchanged ──');
  const inMap = await page.evaluate(async () => {
    window.__writes = [];
    _leaseJobs.set('live-1', { id: 'live-1', property_id: '00000000-0000-4000-a000-00000000fixt', status: 'processing', stage: 'upload', progress: 10, retry_count: 0 });
    const returned = updateLeaseJob('live-1', { stage: 'extraction' });
    await new Promise(r => setTimeout(r, 200));
    return { thenable: !!(returned && typeof returned.then === 'function'),
             stage: _leaseJobs.get('live-1').stage, writes: window.__writes.length };
  });
  // R2: updateLeaseJob returns the WRITE now, not the map entry, so the
  // reaper's `await` is genuinely sequential instead of awaiting a non-promise.
  inMap.thenable ? ok('updateLeaseJob returns the write, so callers can await it')
                 : bad('return value is not awaitable', 'the reaper await would be fake again');
  (inMap.stage === 'extraction') ? ok('the in-memory job is still mutated') : bad('map not updated', inMap.stage);
  (inMap.writes === 1) ? ok('still exactly one write for an in-map update') : bad('write count changed', String(inMap.writes));

  console.log('\n── In-memory-only fields never reach the database ──');
  const stripped = await page.evaluate(async () => {
    window.__writes = [];
    _leaseJobs.set('live-2', { id: 'live-2', property_id: '00000000-0000-4000-a000-00000000fixt', status: 'processing', progress: 10, retry_count: 0, _secret: 'do-not-persist' });
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
    failLeaseJob('diag-1', new Error('extraction exploded'), 'extraction', '00000000-0000-4000-a000-00000000fixt');
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
    _leaseJobs.set('wd-1', { id:'wd-1', property_id: '00000000-0000-4000-a000-00000000fixt', status:'processing', stage:'upload', progress:10, retry_count:0 });
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
    const stale = [{ id: 'stale-1', status: 'processing', stage: 'normalize', updated_at: '2020-01-01T00:00:00Z', property_id: '00000000-0000-4000-a000-00000000fixt' }];
    const origFrom = db.from.bind(db);
    db.from = (t) => {
      if (t !== 'lease_jobs') return origFrom(t);
      return {
        select: () => ({
          in: () => Promise.resolve({ data: stale, error: null }),
          eq: (_c, id) => Promise.resolve({ data: [{ id }], error: null }),
        }),
        update: (row) => { window.__writes.push(JSON.parse(JSON.stringify(row)));
          const self = { eq: () => self, lte: () => self, lt: () => self, in: () => self, not: () => self,
            select: () => Promise.resolve({ data: [row], error: null }),
            then: (f, j) => Promise.resolve({ data: [row], error: null }).then(f, j) };
          return self; },
      };
    };
    window.__writes = [];
    const res = await _reapStaleLeaseJobs();
    return { res, writes: window.__writes };
  });
  (reap.res && reap.res.reaped === 1) ? ok('one abandoned job found and closed out')
                                      : bad('reaper did not close the stale job', JSON.stringify(reap.res));
  const rw = reap.writes && reap.writes[0];
  (rw && rw.status === 'failed' && /did not reach a durable final state/i.test(rw.error_message || '')
       && !/tab closed|Re-upload/i.test(rw.error_message || ''))
    ? ok(`reaped job explains itself: "${rw.error_message.slice(0, 58)}\u2026"`)
    : bad('reaped job lacks an explanation', JSON.stringify(rw));

  console.log('\n\u2500\u2500 The watchdog does not race a slow-but-healthy extraction \u2500\u2500');
  const race = await page.evaluate(async () => {
    // Threshold must exceed the longest single bounded call (85s
    // extractTextFromPdfDirect, /api/explain maxDuration 90) with margin.
    const longestBoundedCallMs = 90000;
    return {
      threshold: JOB_WATCHDOG_MS,
      exceedsOneCall: JOB_WATCHDOG_MS > longestBoundedCallMs * 1.5,
      hasHeartbeat: typeof _touchJobWatchdog === 'function',
    };
  });
  race.exceedsOneCall
    ? ok(`threshold ${race.threshold / 1000}s exceeds one bounded call (90s) with margin`)
    : bad('threshold too close to a single legitimate call', String(race.threshold));
  race.hasHeartbeat ? ok('a heartbeat exists for operations that make no stage transition')
                    : bad('no heartbeat — a multi-batch extraction would be killed mid-run');

  const beat = await page.evaluate(async () => {
    _leaseJobs.set('slow-1', { id:'slow-1', property_id: '00000000-0000-4000-a000-00000000fixt', status:'processing', stage:'upload', progress:10, retry_count:0 });
    updateLeaseJob('slow-1', { stage: 'extraction' });
    const armedAt = _jobWatchdogs.get('slow-1');
    // A telemetry mark is emitted per batch; it must reset the timer.
    _recordIngestTelemetry({ path: 'vision-chunked', pages: 40, batches: 4, outcome: 'success' });
    const afterBeat = _jobWatchdogs.get('slow-1');
    const stillArmed = _jobWatchdogs.has('slow-1');
    updateLeaseJob('slow-1', { status: 'completed' });
    return { reset: armedAt !== afterBeat, stillArmed };
  });
  beat.reset ? ok('each batch\u2019s telemetry mark resets the clock — the timer measures silence, not duration')
             : bad('telemetry mark did not reset the watchdog', 'a chunked extraction could still be killed');
  beat.stillArmed ? ok('the job stays under watch after a heartbeat') : bad('heartbeat disarmed the watchdog');

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
