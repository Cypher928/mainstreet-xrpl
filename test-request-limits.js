'use strict';
/**
 * test-request-limits.js — the three connector-audit fixes.
 *
 *   1. Upload limits   — client and server agree, and refuse before encoding.
 *   2. Evidence model  — provenance records the model that ran, never a literal.
 *   3. CDN pinning     — production behaviour cannot change without a deploy.
 *
 * The client used to accept 60 MB. Vercel rejects any request body over ~4.5 MB
 * before the handler runs, and every upload path base64-encodes the file into
 * JSON, which adds a third — so the real ceiling was ~3.3 MB, eighteen times
 * smaller. A 9 MB scanned lease passed the client check, spent seconds being
 * encoded, and came back as a bare 413 nothing explained.
 *
 * Run: node test-request-limits.js
 */

const fs = require('fs'), path = require('path'), http = require('http');
let pw; try { pw = require('playwright'); }
catch (_) { try { pw = require('/opt/node22/lib/node_modules/playwright'); } catch (_e) { pw = null; } }

let passed = 0, failed = 0;
const ok  = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); passed++; };
const bad = (m, d) => { console.error(`  \x1b[31m✗\x1b[0m ${m}${d ? ' — ' + d : ''}`); failed++; };
const assert = (m, c, d) => c ? ok(m) : bad(m, d);
const sec = (t) => console.log(`\n── ${t} ──`);

const ROOT = __dirname;
const L = require('./request-limits.js');
const MB = 1024 * 1024;

process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
process.env.PILOT_SUPABASE_URL      = process.env.PILOT_SUPABASE_URL      || 'https://stub.supabase.co';
process.env.PILOT_SUPABASE_ANON_KEY = process.env.PILOT_SUPABASE_ANON_KEY || 'stub-anon-key';
process.env.SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'stub-anon-key';

(async () => {

// ══ 1 · THE LIMIT ══════════════════════════════════════════════════════════
sec('the arithmetic behind the ceiling');
{
  assert('the platform limit is 4.5 MB, as Vercel enforces it', L.PLATFORM_BODY_LIMIT === 4.5 * MB, String(L.PLATFORM_BODY_LIMIT));
  assert('base64 inflation is 4/3, padded', L.estimateEncodedBytes(3) === 4 && L.estimateEncodedBytes(3 * MB) >= 4 * MB);
  // THE REGRESSION. The client allowed 60 MB against a ~3.3 MB ceiling.
  assert('the raw-file ceiling is ~3.3 MB, not 60 MB',
    L.MAX_UPLOAD_BYTES > 3.2 * MB && L.MAX_UPLOAD_BYTES < 3.5 * MB,
    (L.MAX_UPLOAD_BYTES / MB).toFixed(2) + ' MB');
  assert('a file exactly at the ceiling fits', L.fitsInOneRequest(L.MAX_UPLOAD_BYTES));
  assert('one byte over does not', !L.fitsInOneRequest(L.MAX_UPLOAD_BYTES + 1));
  assert('the old 60 MB allowance would not fit', !L.fitsInOneRequest(60 * MB));
  // The ceiling must leave room for the prompt and envelope, or a file that
  // "fits" by itself still 413s once the request is built around it.
  assert('the ceiling reserves request overhead',
    L.estimateEncodedBytes(L.MAX_UPLOAD_BYTES) + L.REQUEST_OVERHEAD <= L.PLATFORM_BODY_LIMIT);
}

sec('what the user is told');
{
  const v = L.checkUploadSize(9 * MB, 'lease');
  assert('a 9 MB lease is refused', !v.ok);
  assert('the message states the size of THEIR file', /\b9 MB\b/.test(v.error), v.error);
  assert('the message states the limit', /3\.3 MB/.test(v.error), v.error);
  assert('the message says what to do about it', /Split|compressed|lower-resolution/i.test(v.error), v.error);
  assert('it explains WHY, not just that it failed', /encoded for transfer/i.test(v.error), v.error);
  assert('it names the thing in the user\'s words', /this lease/i.test(v.error), v.error);

  assert('a 2 MB lease passes', L.checkUploadSize(2 * MB, 'lease').ok);
  assert('an empty file is refused with its own message',
    !L.checkUploadSize(0, 'lease').ok && /empty/i.test(L.checkUploadSize(0, 'lease').error));
  assert('an unknown size is refused rather than assumed to fit',
    !L.checkUploadSize(undefined, 'lease').ok && !L.checkUploadSize(NaN, 'lease').ok);
  // Never silently pass something it cannot measure — that is the whole class
  // of bug this file exists for.
  assert('a negative size is refused', !L.checkUploadSize(-1, 'lease').ok);
}

sec('client and server cannot disagree');
{
  // ONE file, loaded two ways. If someone forks it into a client copy and a
  // server copy, this is where it shows up.
  const src = fs.readFileSync(path.join(ROOT, 'request-limits.js'), 'utf8');
  assert('request-limits.js exports to CommonJS', /module\.exports\s*=/.test(src));
  assert('request-limits.js exports to window', /window\.MSRequestLimits\s*=/.test(src));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert('the browser loads it', /<script src="request-limits\.js">/.test(html));
  // Load ORDER matters: script.js gates uploads on window.MSRequestLimits.
  assert('it loads before script.js',
    html.indexOf('request-limits.js') < html.indexOf('src="script.js"'));
  assert('it loads before lease-ingest.js',
    html.indexOf('request-limits.js') < html.indexOf('src="lease-ingest.js"'));

  for (const f of ['api/upload.js', 'api/explain.js', 'api/claude.js']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert(`${f} requires the shared limits`, /require\('\.\.\/request-limits\.js'\)/.test(s));
    assert(`${f} enforces them`, /checkEncodedSize\(/.test(s), 'imported but never called');
    // No second definition of the same number anywhere.
    assert(`${f} does not redefine the limit`, !/4\.5\s*\*\s*1024\s*\*\s*1024/.test(s));
  }
}

sec('the misleading bodyParser comments are corrected');
{
  // api/claude.js documented the truth; explain.js and upload.js claimed the
  // opposite about the identical construct. Three files, one story now.
  for (const f of ['api/claude.js', 'api/explain.js', 'api/upload.js']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert(`${f} says the bodyParser export has no effect`,
      /(does NOT raise|NO runtime effect|no runtime effect)/i.test(s));
    assert(`${f} no longer claims the override prevents a 413`,
      !/Without this override, Vercel's default/.test(s));
  }
}

sec('the server refuses oversize payloads');
{
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'u1', email: 'pm@example.com' }) };
    if (u.includes('api.anthropic.com')) { sent.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-sonnet-4-6' }) }; }
    throw new Error('unexpected fetch ' + u);
  };
  const mkRes = () => ({ statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

  const explain = require('./api/explain.js');
  const big   = 'A'.repeat(5 * MB);          // encoded bytes, over the limit
  const small = 'A'.repeat(64 * 1024);

  sent.length = 0;
  let res = mkRes();
  await explain({ method: 'POST', headers: { authorization: 'Bearer t' }, body: {
    task: 'lease_text_extraction',
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: big } },
      { type: 'text', text: 'transcribe' }] }],
  } }, res);
  assert('/api/explain refuses an oversize PDF with 413', res.statusCode === 413, `got ${res.statusCode}`);
  assert('and explains why in the same words the client uses',
    /largest that can be uploaded/i.test(res.body?.error || ''), res.body?.error);
  assert('and never calls Anthropic for a request that cannot succeed', sent.length === 0);

  sent.length = 0;
  res = mkRes();
  await explain({ method: 'POST', headers: { authorization: 'Bearer t' }, body: {
    task: 'lease_text_extraction',
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: small } },
      { type: 'text', text: 'transcribe' }] }],
  } }, res);
  assert('a PDF within the limit still goes through', res.statusCode === 200 && sent.length === 1,
    `status ${res.statusCode}, calls ${sent.length}`);

  // A batched vision call carries several images. The platform weighs the whole
  // body, so the check must SUM them, not take the largest.
  const third = 'A'.repeat(2 * MB);
  sent.length = 0;
  res = mkRes();
  await explain({ method: 'POST', headers: { authorization: 'Bearer t' }, body: {
    task: 'lease_text_extraction',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: third } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: third } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: third } }] }],
  } }, res);
  assert('three blocks that individually fit but together do not are refused',
    res.statusCode === 413, `got ${res.statusCode} (a max-not-sum check would pass this)`);

  global.fetch = realFetch;
}

// ══ 2 · EVIDENCE MODEL ═════════════════════════════════════════════════════
sec('provenance records the model that actually ran');
{
  const s = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  // THE REGRESSION. Two save sites wrote a literal model name into the evidence
  // chain. The Evidence Viewer displayed it as provenance; that model had not
  // served an extraction in this product for some time.
  const literals = s.match(/extractionModel:\s*'claude-[^']+'/g) || [];
  assert('no hard-coded model name is written as provenance', literals.length === 0, literals.join(', '));
  assert('the real model is carried out of the normalizer',
    /normalized\._extractionModel\s*=\s*_extractionModel/.test(s));
  assert('the single-file save site records it',
    /extractionModel:\s*normalized\._extractionModel\s*\?\?\s*null/.test(s));
  assert('the bulk save site records it',
    /extractionModel:\s*norm\?\._extractionModel\s*\?\?\s*null/.test(s));
  // Absent must resolve to null, never to a guess — the AI-1 rule.
  assert('an unreported model becomes null, not a default',
    /const _extractionModel = _meta\.model \|\| null;/.test(s));

  const c = fs.readFileSync(path.join(ROOT, 'api/claude.js'), 'utf8');
  assert('the server forwards the model Anthropic reported',
    /model:\s*json\.model\s*\|\|\s*model/.test(c));

  // The viewer must state absence rather than dropping the row, so a record
  // with no model does not look complete.
  assert('the Evidence Viewer always renders a Model row',
    /Not recorded for this extraction/.test(s));
}

// ══ 3 · CDN PINNING ════════════════════════════════════════════════════════
sec('production behaviour cannot change without a deploy');
{
  const files = ['index.html', 'reset-password.html', 'home.html', 'terms-of-service.html', 'privacy-policy.html']
    .filter(f => fs.existsSync(path.join(ROOT, f)));
  let unpinned = [];
  for (const f of files) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of s.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^"']+/g) || []) {
      // A jsDelivr npm path is pinned only if it carries a full x.y.z.
      if (!/@\d+\.\d+\.\d+/.test(m)) unpinned.push(`${f}: ${m}`);
    }
    for (const m of s.match(/https:\/\/cdnjs\.cloudflare\.com\/[^"']+/g) || []) {
      if (!/\/\d+\.\d+\.\d+\//.test(m)) unpinned.push(`${f}: ${m}`);
    }
  }
  // THE REGRESSION. `@supabase/supabase-js@2` is a moving tag with 241 releases
  // behind it — production could change with no deploy and nothing in git.
  assert('every CDN script is pinned to an exact version', unpinned.length === 0, unpinned.join('\n      '));

  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert('supabase-js is pinned', /supabase-js@2\.\d+\.\d+/.test(idx));
  assert('pdf.js is pinned', /pdf\.js\/3\.11\.174\//.test(idx));
  assert('xlsx is pinned', /xlsx@0\.18\.5\//.test(idx));
  assert('the pdf.js WORKER is pinned to the same version as the library',
    (fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').match(/pdf\.js\/3\.11\.174\/pdf\.worker/) || []).length > 0,
    'a worker on a different version than the library is a silent mismatch');

  // Fonts stay dynamic on purpose — see the report. Assert that is deliberate
  // and not simply an oversight nobody noticed.
  const fonts = (idx.match(/fonts\.googleapis\.com[^"']*/g) || []).length;
  assert('Google Fonts is still a dynamic stylesheet (intentional)', fonts > 0);
}

// ══ THROUGH THE REAL INTERFACE ═════════════════════════════════════════════
sec('the app refuses an oversize file before encoding it');
if (!pw) { bad('playwright unavailable — the client gate went unexercised'); }
else {
  const PORT = 8953;
  const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
                 '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };
  const hits = [];
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) {
      hits.push(u);
      rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return;
    }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await p.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);

    const shared = await p.evaluate(() => ({
      present: typeof window.MSRequestLimits === 'object' && !!window.MSRequestLimits,
      max:     window.MSRequestLimits && window.MSRequestLimits.MAX_UPLOAD_BYTES,
      guard:   typeof window._guardUploadSize,
    }));
    assert('the page exposes the same limits module the server uses', shared.present);
    assert('and the same number, byte for byte', shared.max === L.MAX_UPLOAD_BYTES,
      `page ${shared.max} vs server ${L.MAX_UPLOAD_BYTES}`);
    assert('the client gate exists', shared.guard === 'function', shared.guard);

    // Drive the REAL upload function with a real oversize File, and prove it
    // never reaches the network. Timing it also proves it failed before
    // encoding: base64-ing 9 MB is not instant.
    hits.length = 0;
    const outcome = await p.evaluate(async () => {
      const big = new File([new Uint8Array(9 * 1024 * 1024)], 'big-lease.pdf', { type: 'application/pdf' });
      const t0 = performance.now();
      let threw = null;
      try { await uploadInvoiceFile(big); } catch (e) { threw = e.message; }
      const ms = performance.now() - t0;
      const toast = (document.body.innerText || '');
      return { threw, ms, toldUser: /largest that can be uploaded/i.test(toast) };
    });
    assert('an oversize upload is rejected', !!outcome.threw, 'it did not throw');
    assert('the rejection carries the explaining sentence',
      /largest that can be uploaded/i.test(outcome.threw || ''), outcome.threw);
    assert('nothing was sent to /api/upload', !hits.includes('/api/upload'), hits.join(','));
    assert('it failed fast, before base64-encoding 9 MB', outcome.ms < 250, `${outcome.ms.toFixed(0)}ms`);
    assert('the user was told on screen, not only in a thrown error', outcome.toldUser);

    // And a file within the limit must still go through — a gate that refuses
    // everything would pass every assertion above.
    hits.length = 0;
    const okCase = await p.evaluate(async () => {
      const small = new File([new Uint8Array(64 * 1024)], 'small-lease.pdf', { type: 'application/pdf' });
      try { await uploadInvoiceFile(small); } catch (e) { return { threw: e.message }; }
      return { threw: null };
    });
    assert('a file within the limit still reaches the server',
      hits.includes('/api/upload'), `threw: ${okCase.threw}; hits: ${hits.join(',')}`);

    // The extraction path must NOT be gated on raw size — LeaseIngest
    // downscales and batches a 40 MB copier scan, and refusing it would break
    // the feature built to accept it.
    const s = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const retryFn = s.slice(s.indexOf('async function retryExtractionWithFile'),
                            s.indexOf('async function retryExtractionWithFile') + 900);
    assert('the downscaling extraction path is NOT gated on raw file size',
      !/_guardUploadSize/.test(retryFn),
      'gating it would reject the 40 MB scans LeaseIngest exists to handle');
  } finally {
    await b.close(); srv.close();
  }
}

console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${passed} passed, ${failed} failed\x1b[0m`);
process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
