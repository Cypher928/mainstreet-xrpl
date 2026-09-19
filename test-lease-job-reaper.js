'use strict';
/**
 * test-lease-job-reaper.js — a reaped lease job carries its property with it.
 *
 *   node test-lease-job-reaper.js
 *
 * WHAT THIS PREVENTS
 *
 * Measured on Pilot: every app load produced a burst of four
 * `POST /rest/v1/lease_jobs → 403`, and Postgres logged
 * `new row violates row-level security policy for table "lease_jobs"`. The
 * table had not accepted a write since 2026-09-16 and 68 rows — 6 owners, 19
 * properties — were stuck in `processing`, unable ever to be closed out.
 *
 * The chain, all of it client-side:
 *
 *   1. _reapStaleLeaseJobs selected `id,status,stage,updated_at` — NO property_id.
 *   2. It called failLeaseJob for each job older than 15 minutes.
 *   3. After a reload the in-memory _leaseJobs Map is empty, so updateLeaseJob
 *      took its write-through branch and sent `{ id, ...updates, updated_at }`.
 *   4. _syncJobToDb upserted that row with property_id absent → NULL.
 *   5. RLS `lease_jobs_owner_all` WITH CHECK is
 *      `property_id IN (SELECT member_property_ids())`, and `NULL IN (…)`
 *      evaluates to NULL, which a policy reads as false → 403.
 *   6. `terminal: true` retried once, so every stale job cost TWO 403s. Two
 *      stale jobs for the observed user; four 403s per load, forever.
 *
 * The policy was right. The row was wrong. Nothing here touches RLS.
 *
 * HOW IT IS TESTED
 *
 * The four real functions are lifted out of script.js by name and executed in a
 * VM against stub collaborators, so what is asserted is what they do — the
 * exact row handed to `db.from('lease_jobs').upsert(...)` — rather than what the
 * source looks like. §5 additionally pins the reaper's SELECT as text, because a
 * column silently dropped from it is how this bug arrives again.
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { fnSource } = require('./test-support/fn-source');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

const PROP = '24246b76-d96e-455d-8089-f2ec8512c24b';   // the real property from the Pilot trace
const JOB1 = '361238eb-f0d1-4950-a641-8ec0ccdb62d1';   // "Chase (7-30-24).pdf",  stage normalize
const JOB2 = '5bbe0808-45ad-4f0e-83bc-673faf549588';   // "Pret A Porte.pdf",     stage confidence

/**
 * Builds a live sandbox holding the four real functions.
 *
 * `rows` are what the lease_jobs SELECT returns. `upsertFails` makes every
 * upsert answer with an RLS-shaped error, which is how the retry path is
 * reached. Everything the functions touch that is not under test is a stub, and
 * each stub records rather than simulates.
 */
function sandbox({ rows = [], upsertFails = false, seedMap = null } = {}) {
  const calls = { upserts: [], selects: [], errors: [], warns: [], watchdogsCleared: [], liveness: [] };

  const upsert = (row) => {
    calls.upserts.push(JSON.parse(JSON.stringify(row)));
    return Promise.resolve(upsertFails
      ? { error: { message: 'new row violates row-level security policy for table "lease_jobs"', code: '42501' } }
      : { error: null });
  };

  const db = {
    from: (table) => ({
      select: (cols) => { calls.selects.push({ table, cols }); return { in: () => Promise.resolve({ data: rows, error: null }) }; },
      upsert,
    }),
  };

  const ctx = {
    db,
    console: { warn: (...a) => calls.warns.push(a.join(' ')), log: () => {}, error: () => {} },
    logError: (type, err, c) => calls.errors.push({ type, message: err && err.message, ctx: c }),
    _leaseJobs: new Map(seedMap || []),
    _clearJobWatchdog: (id) => calls.watchdogsCleared.push(id),
    _armJobWatchdog: () => {},
    _trackJobLiveness: (id, u) => calls.liveness.push({ id, status: u && u.status }),
    _lastIngestTelemetry: { path: 'text' },
    _TERMINAL_JOB_STATUSES: new Set(['completed', 'review_required', 'failed']),
    Promise, Object, Date, Set, Map, JSON, Error, Number, String, setTimeout, clearTimeout,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  // The real thing, by name. A signature change or a renamed helper fails here
  // loudly rather than being quietly approximated by a copy.
  const src = [
    fnSource(SCRIPT, '_syncJobToDb'),
    fnSource(SCRIPT, 'updateLeaseJob'),
    fnSource(SCRIPT, 'failLeaseJob'),
    fnSource(SCRIPT, '_reapStaleLeaseJobs'),
    // Pulled in as data rather than lifted, so the stage→progress table stays a
    // fact about the product and not a second copy in a test.
    SCRIPT.slice(SCRIPT.indexOf('const _JOB_STAGES = {'), SCRIPT.indexOf('};', SCRIPT.indexOf('const _JOB_STAGES = {')) + 2),
    'const JOB_STALE_MS = 15 * 60 * 1000;',
  ].join('\n\n');
  vm.runInContext(src, ctx);
  return { ctx, calls };
}

const old = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
const staleRow = (id, stage) => ({ id, status: 'processing', stage, updated_at: old(60), property_id: PROP });

console.log('\n══ A reaped lease job carries its property with it ══');

(async function main() {

  // ── 1. THE REGRESSION: a reloaded stale job keeps its property_id ─────────
  H('A reloaded stale job retains property_id');
  {
    // _leaseJobs is EMPTY — this is the post-reload state in which the bug lived.
    const { ctx, calls } = sandbox({ rows: [staleRow(JOB1, 'normalize'), staleRow(JOB2, 'confidence')] });
    const res = await ctx._reapStaleLeaseJobs();

    yes('both abandoned jobs are reaped', res && res.reaped === 2, JSON.stringify(res));
    yes('the in-memory Map really was empty, so this is the write-through branch',
        ctx._leaseJobs.size === 0);
    yes('one upsert per job — no retry, because none failed', calls.upserts.length === 2,
        String(calls.upserts.length));
    yes('every upserted row carries the property_id',
        calls.upserts.every(r => r.property_id === PROP),
        JSON.stringify(calls.upserts.map(r => r.property_id)));
    yes('each row is the job it was reaped for',
        calls.upserts.map(r => r.id).sort().join(',') === [JOB1, JOB2].sort().join(','));
    yes('no incomplete-row refusal was needed', calls.errors.length === 0,
        JSON.stringify(calls.errors));
  }

  // ── 2. The terminal update produces a complete row ────────────────────────
  H('The terminal update produces a complete row');
  {
    const { ctx, calls } = sandbox({ rows: [staleRow(JOB1, 'normalize')] });
    await ctx._reapStaleLeaseJobs();
    const row = calls.upserts[0];

    yes('property_id is present and correct', row.property_id === PROP);
    yes('status is failed', row.status === 'failed');
    yes('the stage it died at is preserved, not overwritten with a default',
        row.stage === 'normalize', String(row.stage));
    yes('progress comes from the real stage table', row.progress === 72, String(row.progress));
    yes('error_message explains what happened to a person',
        typeof row.error_message === 'string' && /tab closed or was suspended/.test(row.error_message));
    yes('the diagnostic columns are written, not left null',
        row.confidence_level === 'failed' && row.confidence_score === 0 && row.extraction_route === 'text');
    yes('processing_completed_at is stamped', typeof row.processing_completed_at === 'string');
    yes('updated_at is stamped', typeof row.updated_at === 'string');
    yes('in-memory-only fields never reach the wire',
        !Object.keys(row).some(k => k.startsWith('_')), Object.keys(row).join(','));
    yes('the watchdog is cleared before the write', calls.watchdogsCleared.includes(JOB1));
  }

  // ── 3. A row with no property_id is refused BEFORE the network ────────────
  H('An incomplete row is refused locally, not sent');
  {
    // The pre-fix shape, reached directly: a write-through update with no
    // property_id anywhere. This is what used to become a 403.
    const { ctx, calls } = sandbox({});
    const out = await ctx._syncJobToDb({ id: JOB1, status: 'failed', stage: 'normalize' }, { terminal: true });

    yes('the write is refused', out === false, String(out));
    yes('NOTHING was sent to Supabase', calls.upserts.length === 0,
        JSON.stringify(calls.upserts));
    yes('and it is reported once, under its own name',
        calls.errors.length === 1 && calls.errors[0].type === 'lease_job_sync_incomplete',
        JSON.stringify(calls.errors));
    yes('the report names the job, so it is actionable',
        /no property_id on lease job/.test(calls.errors[0].message) &&
        calls.errors[0].message.includes(JOB1), calls.errors[0].message);
    yes('a terminal write is refused too — terminal is not a licence to retry a doomed row',
        calls.upserts.length === 0);
  }
  {
    // An explicit NULL is the same case as an absent key, and both must refuse.
    const { ctx, calls } = sandbox({});
    const out = await ctx._syncJobToDb({ id: JOB1, property_id: null, status: 'failed' }, {});
    yes('an explicit null property_id is refused as well', out === false && calls.upserts.length === 0);
  }

  // ── 4. Valid writes are untouched, and the retry still works ──────────────
  H('Existing valid lease-job writes are unchanged');
  {
    const full = { id: JOB1, property_id: PROP, status: 'processing', stage: 'extraction', progress: 55, _file: {}, _startMs: 1 };
    const { ctx, calls } = sandbox({});
    const out = await ctx._syncJobToDb(full, {});

    yes('a complete row is sent', out === true && calls.upserts.length === 1);
    yes('it is sent to lease_jobs with its property_id', calls.upserts[0].property_id === PROP);
    yes('underscore-prefixed fields are still stripped',
        !('_file' in calls.upserts[0]) && !('_startMs' in calls.upserts[0]));
    yes('no error is logged for a healthy write', calls.errors.length === 0);
  }
  {
    // The in-Map path: property_id comes from the Map entry, and failLeaseJob's
    // new fourth argument is not needed there. It must not disturb it.
    const seeded = [[JOB1, { id: JOB1, property_id: PROP, status: 'processing', stage: 'extraction', progress: 55 }]];
    const { ctx, calls } = sandbox({ seedMap: seeded });
    ctx.failLeaseJob(JOB1, new Error('boom'), 'extraction');

    yes('a job still in the Map keeps the property_id the Map holds',
        calls.upserts.length === 1 && calls.upserts[0].property_id === PROP,
        JSON.stringify(calls.upserts));
    yes('and an omitted propertyId argument does not blank it',
        calls.upserts[0].property_id === PROP);
    yes('the Map entry is updated in place, as before',
        ctx._leaseJobs.get(JOB1).status === 'failed');
  }
  {
    // A genuine RLS failure on a COMPLETE row must still retry once when
    // terminal — that behaviour is load-bearing and is not what was wrong.
    const { ctx, calls } = sandbox({ upsertFails: true });
    const out = await ctx._syncJobToDb({ id: JOB1, property_id: PROP, status: 'failed' }, { terminal: true });

    yes('a terminal write that genuinely fails is retried exactly once',
        calls.upserts.length === 2, String(calls.upserts.length));
    yes('and both attempts are reported',
        calls.errors.map(e => e.type).join(',') === 'lease_job_sync,lease_job_sync_retry',
        calls.errors.map(e => e.type).join(','));
    yes('the caller is told it failed', out === false);
  }
  {
    const { ctx, calls } = sandbox({ upsertFails: true });
    const out = await ctx._syncJobToDb({ id: JOB1, property_id: PROP, status: 'processing' }, {});
    yes('a non-terminal failure is not retried', calls.upserts.length === 1 && out === false);
  }

  // ── 5. The duplicate-403 pattern is gone ─────────────────────────────────
  H('The observed 403 pattern is not reproducible');
  {
    // The exact Pilot scenario: two stale jobs, empty Map, one app load.
    // Before the fix this produced 2 jobs × (1 write + 1 retry) = 4 rejected
    // POSTs. Now it produces 2 accepted ones.
    const { ctx, calls } = sandbox({ rows: [staleRow(JOB1, 'normalize'), staleRow(JOB2, 'confidence')] });
    await ctx._reapStaleLeaseJobs();

    yes('two stale jobs cost two writes, not four', calls.upserts.length === 2,
        `${calls.upserts.length} writes`);
    yes('none of them is incomplete, so none is a doomed 403',
        calls.upserts.every(r => !!r.property_id));
    yes('no retry was triggered', !calls.errors.some(e => e.type === 'lease_job_sync_retry'));
    yes('and the error log stays clean, so it can still be used to diagnose other things',
        calls.errors.length === 0, JSON.stringify(calls.errors));
  }
  {
    // A job the caller cannot attribute must be refused, not written blind —
    // and refusing it must cost ZERO requests, which is the whole point.
    const { ctx, calls } = sandbox({ rows: [{ id: JOB1, status: 'processing', stage: 'normalize', updated_at: old(60) }] });
    const res = await ctx._reapStaleLeaseJobs();

    yes('a row that arrives with no property_id still reaps without throwing', res.reaped === 1);
    yes('but issues no request at all', calls.upserts.length === 0);
    yes('and says why, once', calls.errors.length === 1 &&
        calls.errors[0].type === 'lease_job_sync_incomplete', JSON.stringify(calls.errors));
  }

  // ── 6. The SELECT is pinned as text ──────────────────────────────────────
  H('The reaper asks for the column it needs');
  {
    // Comments in this area quote `.lt()` to explain why it is NOT used, so the
    // "no .lt()" assertion below has to read code. Strip comments for it.
    const nc = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

    const REAP = fnSource(SCRIPT, '_reapStaleLeaseJobs');
    yes('property_id is in the lease_jobs SELECT',
        /\.select\('id,status,stage,updated_at,property_id'\)/.test(REAP),
        'dropping it from the SELECT is how this bug returns');
    yes('the age filter is still applied in JS, not with .lt()',
        /\.in\('status', \['queued', 'processing'\]\)/.test(REAP) && !/\.lt\(/.test(nc(REAP)));
    yes('the reaped property_id is handed to failLeaseJob',
        /failLeaseJob\([\s\S]*?job\.stage \|\| 'extraction', job\.property_id\)/.test(REAP),
        'the fourth argument is missing, so the write-through branch loses it again');

    const FAIL = fnSource(SCRIPT, 'failLeaseJob');
    yes('failLeaseJob accepts a propertyId', /function failLeaseJob\(jobId, err, stage, propertyId\)/.test(FAIL));
    yes('    and only sets property_id when it has one',
        /\.\.\.\(propertyId \? \{ property_id: propertyId \} : \{\}\)/.test(FAIL),
        'an unconditional spread would blank the Map copy with undefined');

    const SYNC = fnSource(SCRIPT, '_syncJobToDb');
    yes('the guard sits before the upsert',
        SYNC.indexOf('!row.property_id') < SYNC.indexOf("db.from('lease_jobs').upsert"));
    yes('and it resolves rather than throwing, since callers fire and forget',
        /return Promise\.resolve\(false\)/.test(SYNC));
    yes('no fallback property resolution was invented',
        !/currentProperty\(|activePropId|_props\.find/.test(SYNC),
        'the guard must refuse, not guess');
  }

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
