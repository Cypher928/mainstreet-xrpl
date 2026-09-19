/**
 * lease-job-write.js — a lease job's state moves forward, or it does not move.
 * ============================================================================
 * WHAT WENT WRONG
 *
 * Every write to lease_jobs was a bare `upsert(row)`, fired and forgotten. A
 * single processFile issues nine of them — queued, upload, OCR, extraction,
 * normalize, confidence, persistence, then the terminal status — microseconds
 * apart, each its own HTTP request, none awaited. Nothing ordered them: not on
 * the client, where the promises resolve in any order, and not on the wire,
 * where independent requests are multiplexed and PostgREST serves them on
 * separate connections. Two upserts on one primary key race, and last commit
 * wins — "last" decided by server scheduling, not by issue order.
 *
 * So a slow `stage: normalize` write could land AFTER the terminal write and
 * restore `status = 'processing'`. The job was then stuck forever: nothing
 * server-side ages a job out, and the only sweep that could close it runs at
 * startup and was itself failing. Measured on the pilot: of 50 stuck jobs whose
 * document could be attributed unambiguously, 50 had that document written
 * AFTER the job's last recorded write — proof the pipeline reached the end —
 * and 34 of those showed a stage EARLIER than persistence despite provably
 * having passed it. The recorded stage was not where the job stopped. It was
 * whichever write happened to land last.
 *
 * WHY THE FIX IS HERE AND NOT IN A PROMISE QUEUE
 *
 * Serialising the client's promises would not be enough while separate requests
 * can still arrive out of order. So the ordering decision is made by Postgres,
 * inside each UPDATE's own transaction, as a predicate the row must satisfy
 * before it is touched. A stale write does not lose a race — it matches zero
 * rows and changes nothing, whenever it arrives.
 *
 * NO SCHEMA CHANGE WAS NEEDED
 *
 * `progress` is already a NOT NULL integer, CHECK-constrained 0..100, that the
 * pipeline advances strictly: 0, 10, 30, 55, 72, 88, 95, 100. It is the
 * monotonic revision this needs, and adding a second one would be duplicate
 * state with its own consistency problem. `status` is likewise NOT NULL with a
 * closed terminal set. Both being NOT NULL matters: the sibling defect in the
 * reaper existed because a NULL fed to `IN (…)` yields NULL, which reads as
 * false. Neither of these columns can misfire that way.
 *
 * `updated_at` is deliberately NOT the ordering key. It is stamped from the
 * client clock, ties within a millisecond, skews between devices, and the
 * lease_jobs_updated_at trigger overwrites it on every UPDATE — so the stored
 * value records ARRIVAL, which is the very thing that is wrong.
 */
(function (root) {
  'use strict';

  /** A job in one of these is finished. Mirrors _TERMINAL_JOB_STATUSES. */
  const TERMINAL = ['completed', 'failed', 'review_required'];

  /** The states the startup reaper is allowed to act on. */
  const ACTIVE = ['queued', 'processing'];

  // TWO FILTERS, TWO CONTRACTS, AND THEY ARE NOT THE SAME.
  //
  //   .in(column, values)        takes an ARRAY and formats the list itself
  //   .not(column, 'in', value)  takes the value VERBATIM, so it needs the
  //                              parenthesised string
  //
  // Handing `.in()` the preformatted string made supabase-js iterate it as a
  // sequence of characters. The reaper's scope went out as
  // `status=in.("(",q,u,e,d,",",p,r,o,c,s,i,n,g,")")`, which matches no row,
  // so every reaper write returned 200 and changed nothing — and R2's zero-row
  // classification correctly read that as a healthy stale refusal and stayed
  // silent. Caught only by reading the request URL in the Pilot edge log.
  // _list is therefore for `.not()` alone.
  const _list = (values) => '(' + values.join(',') + ')';
  const _int  = (v) => (typeof v === 'number' && Number.isFinite(v)) ? Math.trunc(v) : null;

  /**
   * Decides HOW a given row may be written. Pure: no db, no clock, no globals.
   *
   * Returns { mode, filters, guarded } where `filters` is an ordered list of
   * [method, ...args] tuples to apply to a PostgREST builder, and `guarded`
   * says whether a zero-row result is an EXPECTED refusal rather than a fault.
   *
   *   insert    the row does not exist yet (createLeaseJob)
   *   terminal  a final status — wins over any in-flight non-terminal write
   *   reset     a retry: an intentional move BACKWARD, guarded on its generation
   *   advance   an ordinary stage step — refused if the job is already terminal,
   *             if it would move progress backward, or if it belongs to a
   *             superseded retry generation
   */
  function plan(row, opts) {
    const o  = opts || {};
    const id = row && row.id;

    if (o.insert) return { mode: 'insert', filters: [], guarded: false };

    const filters = [['eq', 'id', id]];

    // A RETRY IS THE ONE LEGITIMATE WAY BACKWARD, and it must not be replayable.
    // retry_count increments on each reset, so `lt` admits the new generation
    // exactly once: a duplicate or re-sent reset carrying the same count finds
    // the row already there and matches nothing.
    if (o.reset) {
      const gen = _int(row && row.retry_count);
      if (gen !== null) filters.push(['lt', 'retry_count', gen]);
      return { mode: 'reset', filters, guarded: gen !== null };
    }

    if (o.terminal) {
      // The reaper terminates jobs it observed as active. By the time its write
      // lands the job may have finished on its own — in another tab, or in this
      // one after a long suspension — and turning a completed job into a failed
      // one is worse than leaving a stale row alone. So it is scoped to the
      // state it actually saw. Every other terminal write is unconditional:
      // finishing a job is the whole point of reaching the end of the pipeline.
      if (o.scopeActive) {
        filters.push(['in', 'status', ACTIVE]);
        return { mode: 'terminal', filters, guarded: true };
      }
      return { mode: 'terminal', filters, guarded: false };
    }

    // ── advance ──────────────────────────────────────────────────────────────
    // Never overwrite a finished job.
    filters.push(['not', 'status', 'in', _list(TERMINAL)]);

    // Never move progress backward. `lte` rather than `lt` so a re-sent write
    // for the CURRENT stage is harmless rather than an error.
    const prog = _int(row && row.progress);
    if (prog !== null) filters.push(['lte', 'progress', prog]);

    // A write issued before a retry carries the OLD generation, and progress
    // alone cannot catch it: after a reset to 0 a stale `progress: 95` would
    // satisfy `lte` and drag the fresh attempt back to persistence. Pinning the
    // generation is what makes the reset stick.
    const gen = _int(row && row.retry_count);
    if (gen !== null) filters.push(['eq', 'retry_count', gen]);

    return { mode: 'advance', filters, guarded: true };
  }

  /** Strips in-memory-only fields (leading underscore) before the wire. */
  function wireRow(job) {
    return Object.fromEntries(Object.entries(job || {}).filter(([k]) => !k.startsWith('_')));
  }

  function _apply(builder, filters) {
    return filters.reduce((b, f) => b[f[0]].apply(b, f.slice(1)), builder);
  }

  /**
   * Performs one guarded write and reports what happened.
   *
   * Resolves true when the row was written, false otherwise. `hooks.logError`
   * is called only for faults — never for a guard doing its job.
   *
   * ZERO ROWS IS TWO DIFFERENT EVENTS and conflating them re-creates the silent
   * failure this file exists to end. On a guarded write it usually means the
   * write was correctly refused as stale, which is success for the system even
   * though this row did not change. But it ALSO happens when the job is not
   * there at all — an insert that never landed — and that is a real fault. They
   * are told apart by asking whether the row exists, which costs one extra
   * request only in the rare zero-row case.
   */
  function sync(db, job, opts, hooks) {
    const o    = opts  || {};
    const h    = hooks || {};
    const log  = typeof h.logError === 'function' ? h.logError : function () {};
    const row  = wireRow(job);
    const ctx  = { jobId: row.id, stage: row.stage, terminal: !!o.terminal };

    // lease_jobs_owner_all's WITH CHECK is `property_id IN member_property_ids()`,
    // and NULL IN (…) is NULL, which a policy reads as false. An incomplete row
    // is a 403 the caller then retries — say so once instead of writing twice.
    if (!row.property_id) {
      log('lease_job_sync_incomplete', new Error('no property_id on lease job ' + row.id), ctx);
      return Promise.resolve(false);
    }

    const p = plan(row, o);
    ctx.mode = p.mode;

    const send = () => {
      if (p.mode === 'insert') return Promise.resolve(db.from('lease_jobs').upsert(row).select('id'));
      return Promise.resolve(_apply(db.from('lease_jobs').update(row), p.filters).select('id'));
    };

    const attempt = (isRetry) => send().then((res) => {
      const error = res && res.error;
      const rows  = (res && res.data) || [];
      if (error) {
        log(isRetry ? 'lease_job_sync_retry' : 'lease_job_sync', error, ctx);
        return { ok: false, retryable: true };
      }
      if (rows.length) return { ok: true };
      if (!p.guarded) {
        // An unguarded write that matched nothing can only mean the row is gone.
        log(isRetry ? 'lease_job_sync_retry' : 'lease_job_sync',
            new Error('lease job ' + row.id + ' not found'), ctx);
        return { ok: false, retryable: false };
      }
      return { ok: false, refused: true };
    });

    return attempt(false).then((r) => {
      if (r.ok) return true;

      if (r.refused) {
        // Refused by a guard. Either this write is stale — the normal, healthy
        // case — or the job does not exist, which the guard cannot distinguish
        // on its own. One read settles it.
        return Promise.resolve(db.from('lease_jobs').select('id').eq('id', row.id))
          .then((chk) => {
            const exists = !!(chk && !chk.error && (chk.data || []).length);
            if (!exists) log('lease_job_sync_missing', new Error('lease job ' + row.id + ' does not exist'), ctx);
            else if (typeof h.onStale === 'function') h.onStale(ctx);
            return false;
          })
          .catch(() => false);
      }

      // A genuine error. The final status is the one write that cannot be lost,
      // so terminal writes get one more attempt. The request is conditional and
      // therefore idempotent: re-sending it after a success matches nothing.
      if (o.terminal && r.retryable) return attempt(true).then((r2) => !!r2.ok);
      return false;
    }).catch((e) => { log('lease_job_sync', e, ctx); return false; });
  }

  const api = { plan, sync, wireRow, TERMINAL, ACTIVE };
  if (root) root.LeaseJobWrite = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
