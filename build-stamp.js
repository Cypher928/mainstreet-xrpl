/**
 * build-stamp.js — the app says which build it is, out loud, on every load.
 * ============================================================================
 * WHY THIS EXISTS
 *
 * A pilot validation session ran for two hours against a hostname that was
 * serving a build older than the feature being validated. Every symptom was
 * consistent and every diagnosis was wrong, because the one fact that would
 * have settled it in ten seconds — which commit is running — was not available
 * anywhere in the browser. The deployment was identifiable only from the
 * server side, by reading a referer header out of a database log after the
 * fact.
 *
 * So the app states it. One line, beside the Supabase target line, on every
 * load:
 *
 *   [build] host "..." · commit c9789b1 · ref my-branch · env preview
 *
 * Read together, those two lines answer the only two questions a live test
 * ever needs to establish first: which database am I talking to, and which
 * code is doing the talking.
 *
 * WHAT IT IS NOT
 *
 * This identifies the DEPLOYMENT the page came from — api/build-info.js reads
 * the commit from the deployment's own environment. It does not fingerprint
 * each asset, so it cannot by itself catch one stale file among fresh ones.
 * That is the `Cache-Control: no-cache` rule on *.js in vercel.json, which
 * prevents the skew rather than reporting it. The two ship together.
 *
 * FAILS QUIET, NEVER FATAL. This runs before the app and must never be the
 * reason a page does not load, so every failure path still logs a line and
 * leaves window.__MS_BUILD readable with nulls. An unreachable endpoint (local
 * file:// use, an offline load) is not an error worth interrupting anyone for.
 */
(function () {
  'use strict';

  var host = (location.hostname || '').toLowerCase();

  // Published before the fetch resolves, so a console session that opens
  // immediately finds the object rather than `undefined`. `resolved` is how a
  // reader tells "not answered yet" from "answered, and the commit is unknown".
  window.__MS_BUILD = {
    commit:   null,
    ref:      null,
    env:      null,
    deployId: null,
    host:     host,
    resolved: false,
  };

  function log() {
    var b = window.__MS_BUILD;
    console.log(
      '[build] host "' + b.host + '"' +
      ' · commit ' + (b.commit ? String(b.commit).slice(0, 7) : 'unknown') +
      ' · ref '    + (b.ref || 'unknown') +
      ' · env '    + (b.env || 'unknown')
    );
  }

  try {
    fetch('/api/build-info', { cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && typeof j === 'object') {
          window.__MS_BUILD.commit   = j.commit   || null;
          window.__MS_BUILD.ref      = j.ref      || null;
          window.__MS_BUILD.env      = j.env      || null;
          window.__MS_BUILD.deployId = j.deployId || null;
          window.__MS_BUILD.resolved = true;
        }
        log();
      })
      .catch(function () { log(); });
  } catch (_e) {
    log();
  }
})();
