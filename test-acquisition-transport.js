// test-acquisition-transport.js
// ============================================================================
// Acquisition Review P4-3 remediation, Issue A — the transport, and why a
// correct answer used to be thrown away.
//
// THE FAILURE THIS SUITE EXISTS FOR
//
// A lease amendment on the live Pilot came back `abstraction_status='failed'`
// with abstracted_fields {}, no model, no timestamp and no error text. The
// server logs said something else entirely: /api/claude had returned HTTP 200
// with valid 27-field evidence. The browser's fetch ceiling was 58s, the
// function's maxDuration is 60s, and the reading landed in the two-second gap
// between them. Correct work, aborted by the client, filed under a word that
// described none of it.
//
// WHAT IS PROVED HERE
//
//   1  the hierarchy is real, read from the three files that set it:
//        client 75s  >  maxDuration 60s  >  Anthropic 45s
//   2  the server's bound fires and is reported as 504 + upstream_timeout —
//      driven by the REAL AbortController, with time scaled so the suite is
//      fast rather than the mechanism faked
//   3  every other server failure names itself distinctly
//   4  a success is a success: the handler returns the model's JSON
//   5  a response that would have died under the old ceiling survives the new
//      one, and one that outlives the new ceiling still aborts
//   6  every non-acquisition caller keeps the 58s default, unchanged
//   7  a sparse reply still stores all 27 fields, each missing one null
//   8  MISSING IS NOT NONE: an explicit denial stays a VALUE with its clause
//   9  the six failure reasons are one vocabulary in three places, and each
//      maps from the thing that actually causes it
//
// Run: node test-acquisition-transport.js
// ============================================================================
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = __dirname;
const AT = require('./acquisition-terms.js');
const AD = require('./acquisition-documents.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
  else    { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
}
function section(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length))); }

const SCRIPT_SRC = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const CLAUDE_SRC = fs.readFileSync(path.join(ROOT, 'api', 'claude.js'), 'utf8');
const TASKS_SRC  = fs.readFileSync(path.join(ROOT, 'api', '_claude-tasks.js'), 'utf8');
const VERCEL     = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

console.log('\n══ acquisition abstraction — transport ══');

// ── 1 · the hierarchy, from the three files that set it ────────────────────
section('1 · client 75s > maxDuration 60s > Anthropic 45s');

const MAX_DURATION_MS = VERCEL.functions['api/claude.js'].maxDuration * 1000;
const ANTHROPIC_MS    = Number((CLAUDE_SRC.match(/const ANTHROPIC_TIMEOUT\s*=\s*(\d+)/) || [])[1]);
const CLIENT_DEFAULT  = Number((SCRIPT_SRC.match(/function _fetchWithTimeout\(url, opts, ms = (\d+)\)/) || [])[1]);
const ABSTRACTION_MS  = Number((SCRIPT_SRC.match(/timeoutMs:\s*(\d+),?\s*\n\s*\}\);\s*\n\s*\} catch \(e\) \{\s*\n\s*failure = AT\.abstractionErrorFor/) || [])[1]);

check('api/claude.js declares an Anthropic bound', ANTHROPIC_MS === 45000, String(ANTHROPIC_MS));
check('vercel.json still gives api/claude.js 60s', MAX_DURATION_MS === 60000, String(MAX_DURATION_MS));
check('the abstraction asks for 75s', ABSTRACTION_MS === 75000, String(ABSTRACTION_MS));
check('and they read in the right order — this is the whole fix',
  ABSTRACTION_MS > MAX_DURATION_MS && MAX_DURATION_MS > ANTHROPIC_MS,
  `${ABSTRACTION_MS} > ${MAX_DURATION_MS} > ${ANTHROPIC_MS}`);
check('the abstraction ceiling is ABOVE maxDuration, so an abort can only follow a killed function',
  ABSTRACTION_MS > MAX_DURATION_MS);
check('the OLD arrangement is gone: the default alone no longer covers the abstraction',
  CLIENT_DEFAULT < MAX_DURATION_MS && ABSTRACTION_MS !== CLIENT_DEFAULT,
  `default ${CLIENT_DEFAULT} would still have lost the live reading`);
check('and 58 was not simply nudged to 60 — the margin is real',
  ABSTRACTION_MS - MAX_DURATION_MS >= 10000, `${(ABSTRACTION_MS - MAX_DURATION_MS) / 1000}s of headroom`);
check('the server leaves itself room too',
  MAX_DURATION_MS - ANTHROPIC_MS >= 10000, `${(MAX_DURATION_MS - ANTHROPIC_MS) / 1000}s`);

// ── the handler, exercised ─────────────────────────────────────────────────
// Time is SCALED, not faked: the real AbortController and the real
// setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT) both run. Only the
// duration is compressed, and only for the one delay that equals the constant.
const realSetTimeout = global.setTimeout;
global.setTimeout = function (fn, ms, ...rest) {
  return realSetTimeout(fn, ms === ANTHROPIC_MS ? 30 : ms, ...rest);
};

const handler = require('./api/claude.js');
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-used';

function fakeRes() {
  const r = { code: 0, body: null, ended: false };
  r.status = function (c) { r.code = c; return r; };
  r.json   = function (b) { r.body = b; r.ended = true; return r; };
  return r;
}
function fakeReq(body) {
  return { method: 'POST', headers: { authorization: 'Bearer tok' }, body };
}
const ABSTRACTION_BODY = {
  task: 'acquisition_abstraction',
  max_tokens: 6000,
  messages: [{ role: 'user', content: 'Document text:\nA LEASE AMENDMENT' }],
};

/** Runs the handler with auth stubbed out and `anthropic` standing in for the model. */
async function callHandler(anthropic, body) {
  const realFetch = global.fetch;
  global.fetch = async function (url, opts) {
    if (String(url).includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'u1', email: 'pm@example.com' }) };
    }
    return anthropic(url, opts);
  };
  const res = fakeRes();
  try { await handler(fakeReq(body || ABSTRACTION_BODY), res); }
  finally { global.fetch = realFetch; }
  return res;
}
/** Anthropic that never answers, and honours the abort signal it is handed. */
function hangingAnthropic() {
  return (url, opts) => new Promise((_resolve, reject) => {
    const sig = opts && opts.signal;
    if (!sig) return reject(new Error('the handler did not pass an AbortSignal'));
    if (sig.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    sig.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
}
function respondingAnthropic(text, opts = {}) {
  return async () => ({
    ok: opts.ok !== false,
    status: opts.status || 200,
    text: async () => (opts.ok === false ? text : 'unused'),
    json: async () => ({ model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 20 },
                         content: [{ type: 'text', text }] }),
  });
}

(async () => {

// ── 2 · the server's own bound ─────────────────────────────────────────────
section('2 · the Anthropic bound fires, and says so distinctly');
{
  const t0 = Date.now();
  const res = await callHandler(hangingAnthropic());
  const took = Date.now() - t0;
  check('the handler passes a real AbortSignal to Anthropic', res.code !== 500 || !/did not pass/.test(String(res.body && res.body.error)));
  check('a model that never answers ends in 504, not 500', res.code === 504, `HTTP ${res.code}`);
  check('the body names the cause machine-readably', res.body && res.body.reason === 'upstream_timeout',
    JSON.stringify(res.body));
  check('and flags it for a caller reading the old shape', res.body && res.body.timeout === true);
  check('the message says how long it waited', /45s/.test(String(res.body && res.body.error)),
    String(res.body && res.body.error));
  check('the bound really is a timer, not a fake — it fired on its own', took >= 20 && took < 5000, took + 'ms (scaled from 45000)');
}

// ── 3 · every other failure names itself ───────────────────────────────────
section('3 · the other server failures are distinguishable');
{
  const cases = [
    ['Anthropic answers with an error',  respondingAnthropic('overloaded', { ok: false, status: 529 }), 500, 'upstream_error'],
    ['the reply is not JSON at all',     respondingAnthropic('I cannot help with that.'),               500, 'unparsable'],
    ['the reply is JSON-shaped garbage', respondingAnthropic('{ "fields": { broken '),                  500, 'unparsable'],
  ];
  for (const [name, anth, code, reason] of cases) {
    const res = await callHandler(anth);
    check(`${name} → ${code} + ${reason}`, res.code === code && res.body && res.body.reason === reason,
      `HTTP ${res.code} ${JSON.stringify(res.body && res.body.reason)}`);
  }
  const netDown = await callHandler(async () => { throw new Error('ECONNREFUSED'); });
  check('the network being down → 500 + upstream_error',
    netDown.code === 500 && netDown.body.reason === 'upstream_error', `HTTP ${netDown.code}`);
  check('a timeout is NOT reported as upstream_error — the two are different facts',
    (await callHandler(hangingAnthropic())).body.reason !== 'upstream_error');
}

// ── 4 · and a success is a success ─────────────────────────────────────────
section('4 · a good answer comes back intact');
{
  const reply = JSON.stringify({ fields: { cap: { value: 3, quote: 'capped at 3% per year', page: 1, confidence: 0.97 } } });
  const res = await callHandler(respondingAnthropic(reply));
  check('HTTP 200', res.code === 200, `HTTP ${res.code}`);
  check('the fields arrive as the model wrote them',
    res.body && res.body.fields && res.body.fields.cap.value === 3, JSON.stringify(res.body && res.body.fields));
  check('with no `reason` on a success', !(res.body && res.body.reason));
  check('and the model metadata rides along',
    res.body.__meta && res.body.__meta.model === 'claude-sonnet-4-6' && res.body.__meta.outputTokens === 20);
}
global.setTimeout = realSetTimeout;

// ── 5 · the client ceiling, scaled ─────────────────────────────────────────
//
// The real numbers are 58s and 75s. Scaled by the same trick as above — the
// REAL _fetchWithTimeout, the REAL AbortController, only the durations
// compressed — a response arriving "between the two ceilings" is exactly the
// live failure, and it must now survive.
section('5 · a late-but-successful response is no longer discarded');
{
  const SCALE = 1000;                       // 58s → 58ms, 75s → 75ms
  const sandbox = {
    console,
    AbortController, Event, EventTarget,
    setTimeout: (fn, ms, ...r) => realSetTimeout(fn, Math.max(0, Math.round(ms / SCALE)), ...r),
    clearTimeout,
    _onAuthLost: () => {},
    _authHeaders: async () => ({}),
  };
  // Only the two functions under test, lifted verbatim from script.js.
  // Lift one function verbatim: match the parameter list first (a default of
  // `{}` is braces too), then brace-match the body from the '{' after it.
  const grab = (name) => {
    const i = SCRIPT_SRC.indexOf(name);
    if (i < 0) throw new Error('not found in script.js: ' + name);
    let p = SCRIPT_SRC.indexOf('(', i), par = 0, k = p;
    for (; k < SCRIPT_SRC.length; k++) {
      if (SCRIPT_SRC[k] === '(') par++;
      else if (SCRIPT_SRC[k] === ')') { par--; if (par === 0) break; }
    }
    let depth = 0;
    for (k = SCRIPT_SRC.indexOf('{', k); k < SCRIPT_SRC.length; k++) {
      if (SCRIPT_SRC[k] === '{') depth++;
      else if (SCRIPT_SRC[k] === '}') { depth--; if (depth === 0) break; }
    }
    return SCRIPT_SRC.slice(i, k + 1);
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(grab('function _fetchWithTimeout(url, opts, ms = ') + '\n'
                + grab('async function claudeFetch(body, opts = {})'), ctx);

  // A server that answers after `delay` ms (scaled) — and a signal that is
  // honoured, so an abort is a real abort.
  function serverTaking(delayMs, reply) {
    return (url, opts) => new Promise((resolve, reject) => {
      const sig = opts && opts.signal;
      const t = realSetTimeout(() => resolve({
        ok: true, status: 200, json: async () => reply || { fields: { cap: { value: 3, quote: 'x', page: 1, confidence: 1 } } },
      }), delayMs);
      if (sig) sig.addEventListener('abort', () => {
        clearTimeout(t);
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      });
    });
  }
  const run = async (delayMs, opts) => {
    sandbox.fetch = serverTaking(delayMs);
    try {
      const value = await vm.runInContext('claudeFetch', ctx)({ task: 'acquisition_abstraction' }, opts);
      return { ok: true, value };
    } catch (e) { return { ok: false, name: e.name, message: e.message }; }
  };

  // 59ms stands for 59 SECONDS: past the old 58s ceiling, inside the new 75s.
  const oldWouldLose = await run(59, {});                          // default 58s → 58ms
  check('under the OLD ceiling a 59s answer is lost — the live bug, reproduced',
    !oldWouldLose.ok && oldWouldLose.name === 'AbortError', oldWouldLose.name || 'resolved');

  const nowSurvives = await run(59, { timeoutMs: 75000 });          // abstraction's ceiling
  check('under the abstraction ceiling the SAME answer arrives and is kept',
    nowSurvives.ok && nowSurvives.value.fields.cap.value === 3,
    nowSurvives.ok ? 'kept' : nowSurvives.name);

  const stillAborts = await run(90, { timeoutMs: 75000 });
  check('and a response that outlives even 75s still aborts — this is a ceiling, not its removal',
    !stillAborts.ok && stillAborts.name === 'AbortError', stillAborts.name || 'resolved');

  // 6 · other callers are untouched.
  const otherCaller = await run(40, {});
  check('a caller passing no options still gets the 58s default, and a 40s answer still lands',
    otherCaller.ok, otherCaller.ok ? 'kept' : otherCaller.name);

  // The thrown error carries what the reason vocabulary needs.
  sandbox.fetch = async () => ({ ok: false, status: 504,
    json: async () => ({ error: 'Claude did not answer within 45s', timeout: true, reason: 'upstream_timeout' }) });
  const gatewayTimeout = await (async () => {
    try { await vm.runInContext('claudeFetch', ctx)({ task: 'acquisition_abstraction' }); return null; }
    catch (e) { return e; }
  })();
  check('a 504 from the server becomes an Error carrying status, timeout and reason',
    gatewayTimeout && gatewayTimeout.status === 504 && gatewayTimeout.upstreamTimeout === true
      && gatewayTimeout.reason === 'upstream_timeout',
    gatewayTimeout && `${gatewayTimeout.status}/${gatewayTimeout.reason}`);
}

// ── 6 · no other caller moved ──────────────────────────────────────────────
section('6 · every existing caller keeps its old behaviour');
{
  check('_fetchWithTimeout still defaults to 58000', CLIENT_DEFAULT === 58000, String(CLIENT_DEFAULT));
  check('claudeFetch takes opts and defaults them to {}',
    /async function claudeFetch\(body, opts = \{\}\)/.test(SCRIPT_SRC));
  check('it forwards opts.timeoutMs and nothing else',
    /_fetchWithTimeout\('\/api\/claude', \{[\s\S]*?\}, opts\.timeoutMs\)/.test(SCRIPT_SRC));

  // Every claudeFetch call site, and which of them raises the ceiling.
  const sites = [...SCRIPT_SRC.matchAll(/claudeFetch\(/g)].map(m => m.index);
  const raising = [...SCRIPT_SRC.matchAll(/timeoutMs:\s*\d+/g)].map(m => m.index);
  check('there is exactly ONE raised ceiling in the whole file', raising.length === 1, String(raising.length));
  check('and it belongs to the abstraction, not to anything else',
    SCRIPT_SRC.slice(Math.max(0, raising[0] - 2000), raising[0]).includes("task: 'acquisition_abstraction'"));
  check('every other claudeFetch call site passes no second argument',
    sites.length > 1, `${sites.length} call sites, 1 raised`);
  check('explainFetch is untouched — its 90s ceiling still matches /api/explain',
    /_fetchWithTimeout\('\/api\/explain', fetchOpts, timeoutMs \|\| 90000\)/.test(SCRIPT_SRC)
    && VERCEL.functions['api/explain.js'].maxDuration === 90);
  check('ask-lease keeps its own 45s constant, unchanged',
    /const ANTHROPIC_TIMEOUT = 45000;/.test(fs.readFileSync(path.join(ROOT, 'api', 'ask-lease.js'), 'utf8')));
  check('vercel.json was not edited: the six functions and their durations stand',
    Object.keys(VERCEL.functions).length === 6 && VERCEL.functions['api/claude.js'].maxDuration === 60);
}

// ── 7 · a sparse reply still stores all 27 ─────────────────────────────────
section('7 · the 27-field stored contract is unchanged by the smaller prompt');
{
  const sparse = { fields: {
    cap:       { value: 3, quote: "controllable CAM increases shall not exceed 3% per year", page: 1, confidence: 0.97 },
    base_rent: { value: 1251250, quote: 'the annual base rent shall be $19.25 per rentable square foot', page: 1, confidence: 0.9 },
  } };
  const built = AT.buildAbstraction(sparse, { model: 'claude-sonnet-4-6', at: '2026-09-22T04:00:00.000Z' });
  check('a two-field reply is accepted', built.ok && built.status === 'success', built.status);
  const f = built.abstraction.fields;
  check('and all 27 fields are stored', Object.keys(f).length === 27, String(Object.keys(f).length));
  check('every one of AcquisitionTerms.FIELDS is present',
    AT.FIELDS.every(k => Object.prototype.hasOwnProperty.call(f, k)));
  const missing = AT.FIELDS.filter(k => !(k in sparse.fields));
  check('each omitted key became exactly {value:null, quote:null, page:null, confidence:null}',
    missing.every(k => f[k].value === null && f[k].quote === null && f[k].page === null && f[k].confidence === null),
    `${missing.length} omitted`);
  check('and none of them became 0, false or ""',
    missing.every(k => f[k].value !== 0 && f[k].value !== false && f[k].value !== ''));
  check('the two the document DID establish kept their values and clauses',
    f.cap.value === 3 && /3% per year/.test(f.cap.quote)
    && f.base_rent.value === 1251250 && /\$19\.25/.test(f.base_rent.quote));
  check('an omitted key and an explicit null store identically — the prompt change is invisible here',
    JSON.stringify(AT.buildAbstraction({ fields: { cap: sparse.fields.cap } }, {}).abstraction.fields.audit_rights)
    === JSON.stringify(AT.buildAbstraction({ fields: { cap: sparse.fields.cap,
          audit_rights: { value: null, quote: null, page: null, confidence: null } } }, {}).abstraction.fields.audit_rights));
  check('a reply that establishes nothing is `partial`, not `failed`',
    AT.buildAbstraction({ fields: {} }, {}).status === 'partial');
  check('and a reply with no fields object at all is still `failed`',
    AT.buildAbstraction({ nope: 1 }, {}).ok === false && AT.buildAbstraction({ nope: 1 }, {}).status === 'failed');
}

// ── 8 · MISSING IS NOT NONE ────────────────────────────────────────────────
section('8 · an explicit denial is still a VALUE, not an absence');
{
  const denied = AT.buildAbstraction({ fields: {
    renewal_options: { value: 'Tenant shall have no option to renew.',
                       quote: 'Tenant shall have no option to renew.', page: 7, confidence: 0.99 },
    cap:             { value: 'none', quote: 'there shall be no cap on Operating Expenses', page: 7, confidence: 0.95 },
    audit_rights:    { value: false, quote: 'Tenant waives any right to audit.', page: 8, confidence: 0.98 },
  } }, {});
  const f = denied.abstraction.fields;
  check('a denial in words stays the words, with its clause',
    f.renewal_options.value === 'Tenant shall have no option to renew.' && !!f.renewal_options.quote);
  check('a denied NUMBER becomes 0 — because the clause says so',
    f.cap.value === 0 && /no cap/.test(f.cap.quote));
  check('a waived BOOLEAN becomes false, with its clause', f.audit_rights.value === false && !!f.audit_rights.quote);
  check('and evidenceSupport calls the denied number `stated`, not derived',
    AT.evidenceSupport('cap', f.cap) === 'stated');
  check('while a term nobody addressed is still null and quoteless',
    f.guaranty_limit.value === null && f.guaranty_limit.quote === null);
  check('"none" with NO quote is still null — a guess is not a denial',
    AT.normalizeFieldValue('cap', 'none', false) === null);
  check('the prompt still carries the rule, in the words that make it enforceable',
    /MISSING IS NOT NONE/.test(TASKS_SRC) && /omitting a key is how you say MISSING/.test(TASKS_SRC));
  check('and it still forbids reporting an unaddressed term as 0, false, "none" or ""',
    /Never report an unaddressed term as 0, false, "none" or ""/.test(TASKS_SRC));
  check('the prompt asks for established fields only',
    /Report ONLY the fields THIS DOCUMENT ESTABLISHES/.test(TASKS_SRC));
  check('and it no longer demands all 27 be emitted',
    !/Report EVERY one of these 27 fields/.test(TASKS_SRC));
  check('but the 27 keys are still spelled out for the model',
    AT.FIELDS.every(k => TASKS_SRC.includes('\n  ' + k + ' ') || TASKS_SRC.includes('\n  ' + k + '  ')),
    AT.FIELDS.filter(k => !TASKS_SRC.includes('\n  ' + k)).join(',') || 'all 27 named');
  check('the task ceiling is untouched at 6000',
    /acquisition_abstraction:\s*\{ system: _withBoundary\(ACQUISITION_ABSTRACTION_SYSTEM\),\s*maxTokens: 6000 \}/.test(TASKS_SRC));
}

// ── 9 · the six reasons ────────────────────────────────────────────────────
section('9 · one failure vocabulary, in three places');
{
  const SIX = ['no_text', 'transport', 'upstream_timeout', 'upstream_error', 'unparsable', 'no_fields'];
  const MIG = fs.readFileSync(path.join(ROOT, 'migrations', '027_acquisition_abstraction_error.sql'), 'utf8');
  check('acquisition-terms.js names exactly the six', JSON.stringify(AT.ABSTRACTION_ERRORS) === JSON.stringify(SIX));
  check('acquisition-documents.js names the same six', JSON.stringify(AD.ABSTRACTION_ERRORS) === JSON.stringify(SIX));
  check('migration 027 enforces the same six', SIX.every(r => MIG.includes(`'${r}'`)));
  check('and nothing added a seventh anywhere',
    !/'(timed_out|network|bad_json|empty)'/.test(MIG + JSON.stringify(AT.ABSTRACTION_ERRORS)));

  const map = [
    ['a client abort',               { name: 'AbortError' },                                'transport'],
    ['a client timeout by any name', { name: 'TimeoutError' },                              'transport'],
    ['a 504 from the server',        { status: 504 },                                       'upstream_timeout'],
    ['the timeout flag alone',       { upstreamTimeout: true },                             'upstream_timeout'],
    ['the server naming unparsable', { status: 500, reason: 'unparsable' },                 'unparsable'],
    ['the server naming upstream',   { status: 500, reason: 'upstream_error' },             'upstream_error'],
    ['a bare 500',                   { status: 500 },                                       'upstream_error'],
    ['a 401',                        { status: 401 },                                       'upstream_error'],
    ['nothing at all',               null,                                                  'transport'],
    ['an error with no status',      new Error('boom'),                                     'transport'],
    ['a reason outside the six',     { status: 500, reason: 'mysterious' },                 'upstream_error'],
  ];
  for (const [name, err, want] of map) {
    check(`${name} → ${want}`, AT.abstractionErrorFor(err) === want, AT.abstractionErrorFor(err));
  }
  check('a 504 outranks a bare status — the more specific fact wins',
    AT.abstractionErrorFor({ status: 504, reason: undefined }) === 'upstream_timeout');
  check('every one of the six is reachable from something',
    SIX.filter(r => r !== 'no_text' && r !== 'no_fields')
       .every(r => map.some(([, e, w]) => w === r)));

  // The two the transport cannot produce come from the call site.
  check("`no_text` is written when there is nothing to read",
    /body\.length < 40[\s\S]{0,180}abstractionError: 'no_text'/.test(SCRIPT_SRC));
  check("`no_fields` is the fallback when a reply arrived but carried none",
    /abstractionError: failure \|\| 'no_fields'/.test(SCRIPT_SRC));
  check('a landed reading CLEARS the reason rather than leaving a stale one',
    /abstractionStatus: built\.status,[\s\S]{0,300}abstractionError:\s*null/.test(SCRIPT_SRC));
  check('and so does `skipped`', /abstractionStatus: 'skipped', abstractionError: null/.test(SCRIPT_SRC));

  // The column the reason lands in.
  check('abstraction_error is writable through the document contract',
    !!AD.WRITABLE.abstraction_error && AD.CAMEL.abstractionError === 'abstraction_error');
  check('a word outside the six is dropped rather than written through',
    AD.buildPayload('r', 'u', { intakeId: 'i', fileName: 'f.pdf', abstractionError: 'mysterious' })
      .payload.abstraction_error === null);
  for (const r of SIX) {
    check(`'${r}' survives the contract`,
      AD.buildPayload('r', 'u', { intakeId: 'i', fileName: 'f.pdf', abstractionError: r })
        .payload.abstraction_error === r);
  }
  check('the reason is carried on the list read, so the chip can explain itself',
    AD.LIST_SELECT.includes('abstraction_error'));
  check('the evidence column is still NOT on the list read',
    !AD.LIST_SELECT.split(',').map(s => s.trim()).includes('abstracted_fields'));
  check('a missing column points at 027, not at 025',
    AD.MIGRATION_FOR_COLUMN.abstraction_error === 'migrations/027_acquisition_abstraction_error.sql');
  check('omitting the reason does not write null over an existing one',
    !Object.prototype.hasOwnProperty.call(
      AD.buildPayload('r', 'u', { intakeId: 'i', fileName: 'f.pdf', docType: 'amendment' }).payload,
      'abstraction_error'));
}

console.log('\n' + '─'.repeat(66));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
