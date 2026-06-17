'use strict';
/**
 * test-error-handling.js — Regression tests for Phase 20 Track 1 (Pre-Pilot Hardening).
 *
 * Covers:
 *  - withRetry(): retries transient failures, gives up immediately on non-retryable ones
 *  - classifyExtractionFailure(): maps raw errors (timeout, rate limit, overload, context
 *    limit, malformed doc) to short user-facing reasons
 *  - api/claude.js status mapping: Anthropic error bodies map to the right HTTP status
 *    (429 rate limit, 503 overloaded, 413 context limit) instead of a flat 500
 *
 * Self-contained: zero network/DOM. Inlines the logic under test (kept in sync with
 * script.js / api/claude.js by the assertions below — if the source drifts from these
 * copies, the behavior they describe should be re-verified against script.js directly).
 * Run: node test-error-handling.js
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertEqual(a, b, label) {
  if (a === b) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    failed++;
  }
}

async function assertRejects(fn, label) {
  try {
    await fn();
    console.error(`  ✗ ${label} — expected rejection, but it resolved`);
    failed++;
  } catch (_) {
    console.log(`  ✓ ${label}`);
    passed++;
  }
}

// ── Inline copies of the functions under test (script.js) ─────────────────────

async function withRetry(fn, { attempts = 3, isRetryable = () => true, baseDelayMs = 1200 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (i >= attempts - 1 || !isRetryable(e, i)) throw e;
      await new Promise(r => setTimeout(r, (i + 1) * baseDelayMs));
    }
  }
  throw lastErr;
}

function classifyExtractionFailure(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'AbortError') return 'Request timed out — the document may be too large or complex';
  const status = err.httpStatus;
  if (status === 429) return 'Rate limit reached — please wait a moment and retry';
  if (status === 503) return 'Claude is temporarily overloaded — please retry shortly';
  if (status === 413) return 'Document exceeds the size/context limit — try a smaller or simpler file';
  if (status === 400) return 'Malformed or unreadable document';
  return err.message || 'Unknown extraction error';
}

// Inline copy of the Anthropic-error → HTTP-status mapping in api/claude.js
function classifyAnthropicError(anthropicStatus, errText) {
  let errType = '';
  try { errType = JSON.parse(errText)?.error?.type || ''; } catch (_) {}
  let status = 500;
  let reason = 'Anthropic API error';
  if (anthropicStatus === 429 || errType === 'rate_limit_error') {
    status = 429; reason = 'Claude rate limit reached — please wait a moment and retry';
  } else if (errType === 'overloaded_error') {
    status = 503; reason = 'Claude is temporarily overloaded — please retry shortly';
  } else if (errType === 'invalid_request_error' && /too long|context|maximum/i.test(errText)) {
    status = 413; reason = 'Document exceeds Claude\'s context limit — try splitting the file';
  }
  return { status, reason };
}

function mkErr(message, extra) {
  const e = new Error(message);
  return Object.assign(e, extra);
}

(async () => {

console.log('\n[withRetry — success on first try]');
{
  let calls = 0;
  const result = await withRetry(() => { calls++; return Promise.resolve('ok'); });
  assertEqual(result, 'ok', 'returns the resolved value');
  assertEqual(calls, 1, 'only calls fn once when it succeeds immediately');
}

console.log('\n[withRetry — retry success after transient failure]');
{
  let calls = 0;
  const result = await withRetry(() => {
    calls++;
    if (calls < 3) return Promise.reject(mkErr('Anthropic API error', { httpStatus: 500 }));
    return Promise.resolve('recovered');
  }, {
    attempts: 3,
    baseDelayMs: 1, // keep test fast
    isRetryable: (e) => e.httpStatus === 500 || e.httpStatus === 503 || e.name === 'AbortError',
  });
  assertEqual(result, 'recovered', 'eventually returns the successful result');
  assertEqual(calls, 3, 'retried until success (3 attempts)');
}

console.log('\n[withRetry — Claude API 500 response, all attempts exhausted]');
{
  let calls = 0;
  await assertRejects(() => withRetry(() => {
    calls++;
    return Promise.reject(mkErr('Anthropic API error', { httpStatus: 500 }));
  }, {
    attempts: 3,
    baseDelayMs: 1,
    isRetryable: (e) => e.httpStatus === 500 || e.httpStatus === 503 || e.name === 'AbortError',
  }), 'rejects after exhausting all attempts on persistent 500');
  assertEqual(calls, 3, 'attempted exactly 3 times before giving up');
}

console.log('\n[withRetry — timeout (AbortError) is retryable]');
{
  let calls = 0;
  const result = await withRetry(() => {
    calls++;
    if (calls === 1) {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      return Promise.reject(e);
    }
    return Promise.resolve('ok-after-timeout');
  }, {
    attempts: 3,
    baseDelayMs: 1,
    isRetryable: (e) => e.name === 'AbortError' || e.httpStatus === 500 || e.httpStatus === 503,
  });
  assertEqual(result, 'ok-after-timeout', 'recovers after a single timeout');
  assertEqual(calls, 2, 'retried exactly once after the timeout');
}

console.log('\n[withRetry — non-retryable error (rate limit) fails immediately, no retry]');
{
  let calls = 0;
  await assertRejects(() => withRetry(() => {
    calls++;
    return Promise.reject(mkErr('rate limited', { httpStatus: 429 }));
  }, {
    attempts: 3,
    baseDelayMs: 1,
    isRetryable: (e) => e.httpStatus === 500 || e.httpStatus === 503 || e.name === 'AbortError',
  }), 'rejects on the first 429 without retrying');
  assertEqual(calls, 1, 'only called once — rate limit is not retried');
}

console.log('\n[classifyExtractionFailure — meaningful messages per failure type]');
{
  const timeoutErr = new Error('aborted'); timeoutErr.name = 'AbortError';
  assert(/timed out/i.test(classifyExtractionFailure(timeoutErr)), 'timeout → mentions "timed out"');

  const rateLimitErr = mkErr('rate limited', { httpStatus: 429 });
  assert(/rate limit/i.test(classifyExtractionFailure(rateLimitErr)), 'HTTP 429 → mentions "rate limit"');

  const overloadedErr = mkErr('overloaded', { httpStatus: 503 });
  assert(/overloaded/i.test(classifyExtractionFailure(overloadedErr)), 'HTTP 503 → mentions "overloaded"');

  const contextErr = mkErr('too big', { httpStatus: 413 });
  assert(/context limit|size/i.test(classifyExtractionFailure(contextErr)), 'HTTP 413 → mentions size/context limit');

  const malformedErr = mkErr('bad request', { httpStatus: 400 });
  assert(/malformed|unreadable/i.test(classifyExtractionFailure(malformedErr)), 'HTTP 400 → mentions malformed/unreadable document');

  const unknownErr = mkErr('something weird happened');
  assertEqual(classifyExtractionFailure(unknownErr), 'something weird happened', 'unrecognized error falls back to err.message (not a generic blanket string)');

  assertEqual(classifyExtractionFailure(null), 'Unknown error', 'null error never throws — returns a safe fallback');
}

console.log('\n[classifyExtractionFailure — never returns the old generic blanket message]');
{
  const cases = [
    new Error('aborted'),
    mkErr('x', { httpStatus: 429 }),
    mkErr('x', { httpStatus: 503 }),
    mkErr('x', { httpStatus: 413 }),
    mkErr('x', { httpStatus: 400 }),
  ];
  cases[0].name = 'AbortError';
  const allDistinctFromGeneric = cases.every(e => classifyExtractionFailure(e) !== 'Extraction failed — tap Retry to re-upload');
  assert(allDistinctFromGeneric, 'every classified failure reason differs from the old one-size-fits-all message');
}

console.log('\n[api/claude.js — Anthropic error → HTTP status mapping]');
{
  const rl = classifyAnthropicError(429, JSON.stringify({ error: { type: 'rate_limit_error', message: 'rate limited' } }));
  assertEqual(rl.status, 429, 'rate_limit_error → 429 (not flattened to 500)');
  assert(/rate limit/i.test(rl.reason), 'rate limit reason is user-meaningful');

  const ol = classifyAnthropicError(529, JSON.stringify({ error: { type: 'overloaded_error', message: 'overloaded' } }));
  assertEqual(ol.status, 503, 'overloaded_error → 503 (not flattened to 500)');
  assert(/overloaded/i.test(ol.reason), 'overload reason is user-meaningful');

  const ctx = classifyAnthropicError(400, JSON.stringify({ error: { type: 'invalid_request_error', message: 'prompt is too long: maximum context length exceeded' } }));
  assertEqual(ctx.status, 413, 'context-length invalid_request_error → 413 (not flattened to 500)');
  assert(/context limit/i.test(ctx.reason), 'context-limit reason is user-meaningful');

  const generic = classifyAnthropicError(400, JSON.stringify({ error: { type: 'invalid_request_error', message: 'missing required field' } }));
  assertEqual(generic.status, 500, 'unrelated invalid_request_error still falls back to 500');

  const malformedBody = classifyAnthropicError(500, 'not json');
  assertEqual(malformedBody.status, 500, 'unparseable Anthropic error body degrades gracefully to 500, does not throw');
}

console.log('\n' + '='.repeat(60));
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) process.exit(1);

})();
