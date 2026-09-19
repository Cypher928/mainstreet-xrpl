'use strict';
/**
 * test-lease-job-ordering.js — a lease job moves forward, or it does not move.
 *
 *   node test-lease-job-ordering.js
 *
 * WHAT THIS PREVENTS
 *
 * Nine writes per processFile, none awaited, each its own HTTP request. Nothing
 * ordered them — not the client's promises, not the wire. A slow `normalize`
 * write could land after the terminal write and restore `status='processing'`,
 * and the job was then stuck forever. 68 rows on the pilot; for 50 of them the
 * document written AFTER the job's last record proves the pipeline had already
 * finished.
 *
 * HOW IT IS TESTED
 *
 * The centre of this suite is a small in-memory store that actually HONOURS
 * PostgREST filters — eq / not-in / in / lte / lt — and a request queue that can
 * be flushed in any order. So "a stale write arrives late" is not simulated by
 * asserting on a filter string; it is performed, against a store that enforces
 * the same predicate Postgres would, and the surviving row is inspected.
 *
 * A test that only issues writes in order cannot fail on an ordering bug, which
 * is exactly how this defect survived. Every ordering assertion here replays
 * out of order.
 *
 * §7 lifts the real script.js functions so the delegation, the returned
 * promises and the reaper's sequencing are checked against the product rather
 * than a copy.
 *
 * NO REAL DATA. Every row here is a fixture. The 68 historical rows are not
 * touched, read or referenced by this suite.
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { fnSource } = require('./test-support/fn-source');

const LJW    = require('./lease-job-write.js');
const SCRIPT = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

const PROP = '00000000-0000-4000-a000-00000000fixt';   // fixture property, not a real one
const JOB  = '00000000-0000-4000-b000-00000000job1';

// ── A store that enforces the filters, and a queue that can reorder ──────────
function makeDb() {
  const rows = new Map();
  const queue = [];          // pending requests, flushed on demand
  const log = [];            // every request, in ISSUE order

  const matches = (row, filters) => filters.every((f) => {
    const [op, col] = f;
    if (op === 'eq')  return row[col] === f[2];
    if (op === 'lte') return typeof row[col] === 'number' && row[col] <= f[2];
    if (op === 'lt')  return typeof row[col] === 'number' && row[col] <  f[2];
    if (op === 'in')  return String(f[2]).slice(1, -1).split(',').includes(String(row[col]));
    if (op === 'not' && f[2] === 'in') return !String(f[3]).slice(1, -1).split(',').includes(String(row[col]));
    throw new Error('unsupported filter in fixture store: ' + op);
  });

  function enqueue(kind, payload, filters) {
    log.push({ kind, filters: filters.map(f => f.join(':')), payload });
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    queue.push({ resolve, run: () => {
      if (kind === 'upsert') { rows.set(payload.id, { ...payload }); return { data: [{ id: payload.id }], error: null }; }
      if (kind === 'select') {
        const r = rows.get(filters.find(f => f[1] === 'id')[2]);
        return { data: r ? [{ id: r.id }] : [], error: null };
      }
      const existing = rows.get(payload.id);
      if (!existing || !matches(existing, filters)) return { data: [], error: null };
      rows.set(payload.id, { ...existing, ...payload });
      return { data: [{ id: payload.id }], error: null };
    } });
    return p;
  }

  // A builder that collects filters, then resolves through the queue.
  function builder(kind, payload) {
    const filters = [];
    const self = {
      eq:  (c, v)       => (filters.push(['eq', c, v]), self),
      lte: (c, v)       => (filters.push(['lte', c, v]), self),
      lt:  (c, v)       => (filters.push(['lt', c, v]), self),
      in:  (c, v)       => (filters.push(['in', c, v]), self),
      not: (c, op, v)   => (filters.push(['not', c, op, v]), self),
      select: ()        => enqueue(kind, payload, filters),
      then: (res, rej)  => enqueue(kind, payload, filters).then(res, rej),
    };
    return self;
  }

  return {
    rows, log, queue,
    seed: (row) => rows.set(row.id, { ...row }),
    get:  (id) => rows.get(id),
    from: () => ({
      upsert: (row) => builder('upsert', row),
      update: (row) => builder('update', row),
      select: ()    => builder('select', {}),
    }),
    // Flush pending requests. `order` reorders them — this is the whole point.
    flush: async (order) => {
      const batch = queue.splice(0, queue.length);
      const seq = order ? order.map(i => batch[i]) : batch;
      for (const item of seq) item.resolve(item.run());
      await new Promise((r) => setImmediate(r));
    },
    pending: () => queue.length,
  };
}

const job = (over) => Object.assign({
  id: JOB, property_id: PROP, status: 'processing', stage: 'upload',
  progress: 10, retry_count: 0, created_at: 'x', updated_at: 'x',
}, over);

const errors = [];
const hooks  = { logError: (t, e, c) => errors.push({ t, m: e && e.message, c }) };
const reset  = () => { errors.length = 0; };

console.log('\n══ A lease job moves forward, or it does not move ══');

(async function main() {

  // ── 1. plan(): the decision, in isolation ─────────────────────────────────
  H('The write plan');
  {
    const f = (p) => p.filters.map(x => x.join(':'));

    const ins = LJW.plan(job(), { insert: true });
    yes('insert is unfiltered', ins.mode === 'insert' && ins.filters.length === 0);
    yes('    and a zero-row insert is never an expected refusal', ins.guarded === false);

    const adv = LJW.plan(job({ progress: 72 }), {});
    yes('advance refuses to overwrite a terminal job',
        f(adv).includes('not:status:in:(completed,failed,review_required)'), f(adv).join(' '));
    yes('advance refuses to move progress backward', f(adv).includes('lte:progress:72'), f(adv).join(' '));
    yes('advance pins the retry generation', f(adv).includes('eq:retry_count:0'), f(adv).join(' '));
    yes('    and a zero row is an expected refusal there', adv.guarded === true);

    const term = LJW.plan(job({ status: 'completed', progress: 100 }), { terminal: true });
    yes('a terminal write carries no state guard', f(term).join(' ') === 'eq:id:' + JOB, f(term).join(' '));
    yes('    so a zero row would be a fault, not a refusal', term.guarded === false);

    const reap = LJW.plan(job({ status: 'failed' }), { terminal: true, scopeActive: true });
    yes('the reaper is scoped to the state it observed',
        f(reap).includes('in:status:(queued,processing)'), f(reap).join(' '));
    yes('    and its zero row IS an expected refusal', reap.guarded === true);

    const rst = LJW.plan(job({ retry_count: 1, progress: 0 }), { reset: true });
    yes('a reset is guarded on its generation only', f(rst).join(' ') === 'eq:id:' + JOB + ' lt:retry_count:1',
        f(rst).join(' '));
    yes('    so it may move progress backward', !f(rst).some(s => s.startsWith('lte:progress')));

    const noProg = LJW.plan({ id: JOB, status: 'completed', stage: 'completed' }, { terminal: true });
    yes('a terminal payload with no progress is fine', noProg.mode === 'terminal');
    const advNoProg = LJW.plan({ id: JOB, stage: 'OCR' }, {});
    yes('an advance with no progress still guards the terminal set',
        f(advNoProg).join(' ') === 'eq:id:' + JOB + ' not:status:in:(completed,failed,review_required)',
        f(advNoProg).join(' '));
  }

  // ── 1b. Insert: the one write whose row does not exist yet ────────────────
  H('A new job is created, not filtered');
  {
    reset();
    const db = makeDb();                       // deliberately empty
    LJW.sync(db, job({ status: 'queued', stage: 'queued', progress: 0 }), { insert: true }, hooks);
    await db.flush(); await db.flush();

    yes('the row is created', !!db.get(JOB), 'createLeaseJob must still be able to land a new job');
    yes('    at its opening state', db.get(JOB).status === 'queued' && db.get(JOB).progress === 0);
    yes('and nothing is logged — an absent row is expected here, not a fault',
        errors.length === 0, JSON.stringify(errors));
    yes('the request was an upsert, not a filtered update',
        db.log.length === 1 && db.log[0].kind === 'upsert' && db.log[0].filters.length === 0,
        JSON.stringify(db.log));
  }

  // ── 2. THE REQUIRED INVARIANT, replayed out of order ──────────────────────
  H('non-terminal → terminal → LATE non-terminal leaves the job terminal');
  {
    reset();
    const db = makeDb();
    db.seed(job({ progress: 10 }));

    LJW.sync(db, job({ stage: 'normalize', progress: 72 }), {}, hooks);      // #0
    LJW.sync(db, job({ status: 'completed', stage: 'completed', progress: 100 }), { terminal: true }, hooks); // #1
    LJW.sync(db, job({ stage: 'confidence', progress: 88 }), {}, hooks);     // #2  issued BEFORE terminal lands

    // Arrival order: the stale confidence write lands LAST.
    await db.flush([0, 1, 2]);
    await db.flush();   // settle the existence check, if any

    const r = db.get(JOB);
    yes('the job is terminal', r.status === 'completed', JSON.stringify(r));
    yes('    at stage completed', r.stage === 'completed', r.stage);
    yes('    at progress 100 — the late write did not drag it back', r.progress === 100, String(r.progress));
    yes('and the refusal was NOT reported as an error',
        errors.filter(e => e.t !== 'lease_job_sync_missing').length === 0, JSON.stringify(errors));
  }
  {
    // The same three writes, arriving in the worst possible order.
    reset();
    const db = makeDb();
    db.seed(job({ progress: 10 }));
    LJW.sync(db, job({ stage: 'normalize',  progress: 72 }), {}, hooks);
    LJW.sync(db, job({ status: 'completed', stage: 'completed', progress: 100 }), { terminal: true }, hooks);
    LJW.sync(db, job({ stage: 'confidence', progress: 88 }), {}, hooks);
    await db.flush([2, 0, 1]);   // confidence, normalize, then terminal
    await db.flush();
    const r = db.get(JOB);
    yes('terminal still wins when it arrives last of all', r.status === 'completed' && r.progress === 100,
        JSON.stringify(r));
  }

  // ── 3. Progress never moves backward ──────────────────────────────────────
  H('Older stage → newer stage → older arrives late');
  {
    reset();
    const db = makeDb();
    db.seed(job({ progress: 10 }));
    LJW.sync(db, job({ stage: 'persistence', progress: 95 }), {}, hooks);
    LJW.sync(db, job({ stage: 'OCR',         progress: 30 }), {}, hooks);
    await db.flush([0, 1]);      // the OCR write lands after persistence
    await db.flush();
    const r = db.get(JOB);
    yes('the job stays at the further stage', r.stage === 'persistence' && r.progress === 95, JSON.stringify(r));
    yes('and nothing was logged as an error', errors.length === 0, JSON.stringify(errors));
  }
  {
    // Re-sending the CURRENT stage is harmless — lte, not lt.
    const db = makeDb();
    db.seed(job({ stage: 'normalize', progress: 72 }));
    const out = await (LJW.sync(db, job({ stage: 'normalize', progress: 72 }), {}, hooks), db.flush());
    void out;
    yes('a duplicate write for the current stage still applies', db.get(JOB).progress === 72);
  }

  // ── 4. Retry: the one legitimate way backward ─────────────────────────────
  H('Retry resets, and a pre-retry write cannot undo it');
  {
    reset();
    const db = makeDb();
    db.seed(job({ stage: 'persistence', progress: 95, retry_count: 0 }));

    // The exact sequence you asked for: old progress 95 in flight, a retry
    // resets to 0, then the old 95 arrives late.
    LJW.sync(db, job({ stage: 'persistence', progress: 95, retry_count: 0 }), {}, hooks);        // #0 stale
    LJW.sync(db, job({ status: 'processing', stage: 'upload', progress: 0, retry_count: 1 }), { reset: true }, hooks); // #1

    await db.flush([1, 0]);   // reset lands FIRST, stale 95 lands after
    await db.flush();

    const r = db.get(JOB);
    yes('the retry stands at progress 0', r.progress === 0, String(r.progress));
    yes('    at stage upload', r.stage === 'upload', r.stage);
    yes('    with the new generation', r.retry_count === 1, String(r.retry_count));
    yes('the stale pre-retry write was refused, not logged as an error',
        errors.length === 0, JSON.stringify(errors));
  }
  {
    // A replayed reset must not apply twice.
    reset();
    const db = makeDb();
    db.seed(job({ retry_count: 1, progress: 55, stage: 'extraction' }));
    LJW.sync(db, job({ status: 'processing', stage: 'upload', progress: 0, retry_count: 1 }), { reset: true }, hooks);
    await db.flush();
    await db.flush();
    yes('a reset carrying an already-stored generation is refused',
        db.get(JOB).progress === 55 && db.get(JOB).stage === 'extraction', JSON.stringify(db.get(JOB)));
    yes('    and is not reported as an error', errors.length === 0, JSON.stringify(errors));
  }
  {
    // After a retry, the NEW generation's writes apply normally.
    const db = makeDb();
    db.seed(job({ retry_count: 1, progress: 0, stage: 'upload' }));
    LJW.sync(db, job({ stage: 'OCR', progress: 30, retry_count: 1 }), {}, hooks);
    await db.flush();
    yes('writes from the new generation advance as usual', db.get(JOB).progress === 30);
  }

  // ── 5. The reaper cannot terminate a job that has since finished ──────────
  H('A stale reaper leaves a finished job alone');
  {
    reset();
    const db = makeDb();
    db.seed(job({ status: 'completed', stage: 'completed', progress: 100 }));
    // Issued, then flushed — awaiting before the flush would deadlock against
    // the fixture queue, which is the point of having one.
    LJW.sync(db, job({ status: 'failed', stage: 'normalize', progress: 72 }),
             { terminal: true, scopeActive: true }, hooks);
    await db.flush();
    await db.flush();
    const r = db.get(JOB);
    yes('the completed job is untouched', r.status === 'completed' && r.progress === 100, JSON.stringify(r));
    yes('and the reaper did not log an error for a healthy refusal',
        errors.length === 0, JSON.stringify(errors));
  }
  {
    const db = makeDb();
    db.seed(job({ status: 'processing', stage: 'normalize', progress: 72 }));
    LJW.sync(db, job({ status: 'failed', stage: 'normalize', progress: 72 }),
             { terminal: true, scopeActive: true }, hooks);
    await db.flush();
    yes('but a genuinely stuck job IS closed out', db.get(JOB).status === 'failed');
  }

  // ── 6. Zero rows: refused vs missing ──────────────────────────────────────
  H('A zero-row result is classified, not guessed');
  {
    reset();
    const db = makeDb();
    db.seed(job({ status: 'completed', progress: 100 }));
    LJW.sync(db, job({ stage: 'OCR', progress: 30 }), {}, hooks);
    await db.flush(); await db.flush();
    yes('a guarded refusal on an existing row logs nothing', errors.length === 0, JSON.stringify(errors));
  }
  {
    reset();
    const db = makeDb();   // row deliberately absent
    LJW.sync(db, job({ stage: 'OCR', progress: 30 }), {}, hooks);
    await db.flush(); await db.flush();
    yes('a guarded write against a MISSING row is reported',
        errors.length === 1 && errors[0].t === 'lease_job_sync_missing', JSON.stringify(errors));
    yes('    and names the job', /does not exist/.test(errors[0].m) && errors[0].m.includes(JOB));
  }
  {
    reset();
    const db = makeDb();   // row absent, unguarded terminal write
    LJW.sync(db, job({ status: 'completed', progress: 100 }), { terminal: true }, hooks);
    await db.flush(); await db.flush();
    yes('an UNGUARDED write that matches nothing is a fault',
        errors.some(e => /not found/.test(e.m || '')), JSON.stringify(errors));
  }
  {
    reset();
    const db = makeDb();
    LJW.sync(db, { id: JOB, status: 'failed' }, { terminal: true }, hooks);   // no property_id
    await db.flush();
    yes('a row with no property_id is refused before any request',
        errors.length === 1 && errors[0].t === 'lease_job_sync_incomplete', JSON.stringify(errors));
    yes('    and nothing was sent', db.log.length === 0, JSON.stringify(db.log));
  }

  // ── 7. The monolith delegates, and its awaits are real ────────────────────
  H('script.js delegates and returns the write');
  {
    const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

    const SYNC = fnSource(CODE, '_syncJobToDb');
    yes('_syncJobToDb is a delegation to LeaseJobWrite',
        /LeaseJobWrite\.sync\(db, job, opts, \{ logError \}\)/.test(SYNC), SYNC.trim());
    yes('    and the monolith no longer builds the request itself',
        !/upsert\(|\.update\(/.test(SYNC), 'the filter logic must live in the module');

    const UPD = fnSource(CODE, 'updateLeaseJob');
    yes('updateLeaseJob returns the write on the write-through branch',
        /return _syncJobToDb\(\{ id: jobId/.test(UPD));
    yes('    and on the in-Map branch', /return _syncJobToDb\(job, opts\)/.test(UPD));

    const FAIL = fnSource(CODE, 'failLeaseJob');
    yes('failLeaseJob forwards caller options alongside terminal',
        /\{ terminal: true, \.\.\.\(opts \|\| \{\}\) \}/.test(FAIL), FAIL.slice(-160));

    const REAP = fnSource(CODE, '_reapStaleLeaseJobs');
    yes('the reaper scopes its write to the state it observed',
        /\{ scopeActive: true \}/.test(REAP));
    yes('    and still carries property_id (R1 preserved)', /job\.property_id/.test(REAP));

    const RETRY = fnSource(CODE, 'retryLeaseJob');
    yes('retryLeaseJob declares itself a reset', /\{ reset: true \}/.test(RETRY));

    const CREATE = fnSource(CODE, 'createLeaseJob');
    yes('createLeaseJob declares itself an insert', /\{ insert: true \}/.test(CREATE));

    yes('confirm-review remains an unconditional terminal transition',
        /updateLeaseJob\(d\._jobId, \{ status: 'completed', stage: 'completed' \}\)/.test(CODE),
        'it must keep working without a progress field');
  }

  // ── 8. The reaper's await is genuinely sequential ─────────────────────────
  H('The reaper closes jobs one at a time');
  {
    const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

    let inFlight = 0, maxInFlight = 0;
    const order = [];
    const ctx = {
      db: { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: ctx.__rows, error: null }) }) }) },
      console: { warn: () => {}, log: () => {}, error: () => {} },
      logError: () => {},
      _clearJobWatchdog: () => {},
      _armJobWatchdog: () => {},
      _trackJobLiveness: () => {},
      _leaseJobs: new Map(),
      _TERMINAL_JOB_STATUSES: new Set(['completed', 'review_required', 'failed']),
      _lastIngestTelemetry: null,
      _JOB_STAGES: { normalize: { progress: 72 }, extraction: { progress: 55 } },
      // Stand in for the module so concurrency is observable.
      _syncJobToDb: (row) => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); order.push(row.id);
        return new Promise((r) => setTimeout(() => { inFlight--; r(true); }, 5));
      },
      Promise, Object, Date, Set, Map, JSON, Error, Number, String, setTimeout, clearTimeout,
    };
    ctx.globalThis = ctx;
    ctx.__rows = [
      { id: 'j1', status: 'processing', stage: 'normalize', updated_at: '2020-01-01T00:00:00Z', property_id: PROP },
      { id: 'j2', status: 'processing', stage: 'normalize', updated_at: '2020-01-01T00:00:00Z', property_id: PROP },
      { id: 'j3', status: 'processing', stage: 'normalize', updated_at: '2020-01-01T00:00:00Z', property_id: PROP },
    ];
    vm.createContext(ctx);
    vm.runInContext([
      fnSource(CODE, 'updateLeaseJob'),
      fnSource(CODE, 'failLeaseJob'),
      fnSource(CODE, '_reapStaleLeaseJobs'),
      'const JOB_STALE_MS = 15 * 60 * 1000;',
    ].join('\n\n'), ctx);

    const res = await ctx._reapStaleLeaseJobs();
    yes('all three abandoned jobs are closed out', res.reaped === 3, JSON.stringify(res));
    yes('never more than one write in flight — the await is real',
        maxInFlight === 1, 'peak concurrency was ' + maxInFlight);
    yes('and they are closed in the order they were found', order.join(',') === 'j1,j2,j3', order.join(','));
  }

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
