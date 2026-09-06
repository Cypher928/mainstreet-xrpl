'use strict';
/**
 * PHASE I — a citation may claim a clause only when it carries one, and a
 * non-answer may not wear a confidence score.
 *
 * THE TWO DEFECTS THIS PINS
 * -------------------------
 * 1. renderAnswerHtml promoted a chip to live, clickable evidence on
 *    `quote || page != null || fileUrl`. A lease with a filename and no captured
 *    clause therefore rendered as a gold citation. Asked "show me where the lease
 *    says the CAM cap is 5%", the workspace returned four such chips — every one
 *    quote: null — beneath the words "extracted lease terms". The product's whole
 *    claim is that a figure can be traced to the clause it came from; spending
 *    that on chips backed by nothing teaches a manager the citations mean less
 *    than they do. _lenderVerification() and /api/ask-lease already refuse this.
 *
 * 2. The honest fallback carried `{ pct: 100, basis: 'honest fallback' }`, which
 *    printed as "Confidence 100% · honest fallback" directly under "I couldn't
 *    map that question to your data". In the Phase G battery, 21 of 35 questions
 *    ended there — each wearing a full-confidence badge over an admission that
 *    nothing had been answered.
 *
 * WHAT THE TESTS ASSERT
 * ---------------------
 * The rendered HTML, not the intermediate objects: the chip is what a manager
 * sees and believes. A whitespace-only quote is checked explicitly, because ' '
 * is truthy and would otherwise buy a citation the same standing as real lease
 * text.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8849;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json' };
const MOCK = `(function(){var u={id:'t',email:'t@t.local'};function P(v){return Promise.resolve(v);}
function q(){var o={select:function(){return o;},insert:function(r){return P({data:r,error:null});},
upsert:function(r){return P({data:[r],error:null});},update:function(){return P({data:null,error:null});},
delete:function(){return {match:function(){return P({error:null});},eq:function(){return P({error:null});}};},
eq:function(){return o;},neq:function(){return o;},in:function(){return P({data:[],error:null});},
is:function(){return o;},order:function(){return o;},limit:function(){return o;},ilike:function(){return o;},
single:function(){return P({data:null,error:null});},then:function(f){return P({data:[],error:null}).then(f);}};return o;}
window.supabase={createClient:function(){return {auth:{getUser:function(){return P({data:{user:u},error:null});},
getSession:function(){return P({data:{session:{user:u}},error:null});},
onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:u});},30);return {data:{subscription:{unsubscribe:function(){}}}};},
signOut:function(){return P({error:null});}},from:function(){return q();},
storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},
getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};})();`;

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const REAL_CLAUSE = 'Operating Expenses shall not increase by more than five percent (5%) per annum';

(async () => {
  const srv = http.createServer((rq, rs) => {
    let r = decodeURIComponent(rq.url.split('?')[0]); if (r === '/') r = '/index.html';
    fs.readFile(path.join(ROOT, r), (e, d) => { if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' }); rs.end(d); });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(MOCK);
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**supabase**', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#appContent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // ── 1. The chip rule ───────────────────────────────────────────────────────
  sec('a chip is evidence only when it carries the clause');
  const R = await page.evaluate((CLAUSE) => {
    const render = (cites) => window.AIWorkspace.renderAnswerHtml({
      intent: 'cam_caps', heading: 'CAM caps on file', paragraphs: ['x'], bullets: [],
      citations: cites, confidence: { pct: 92, basis: 'extracted lease terms' },
      trace: { intent: 'cam_caps', engine: 'Lease Review Engine', property: 'P',
               sources: [], citationsUsed: cites.length },
    });
    const shape = (html) => ({
      html,
      liveChips:  (html.match(/aiw-cite--live/g)  || []).length,
      noSrcChips: (html.match(/aiw-cite--nosrc/g) || []).length,
      openFromChip: (html.match(/openFromChip/g)  || []).length,
      hasEvdAttr: /data-evd=/.test(html),
      showEvidence: /data-aiw-act="showEvidence"/.test(html),
      saysNotCaptured: /clause not captured/.test(html),
    });
    const src = { source: 'Lease — Tollgrade Communications, Inc', detail: 'Happy Plaza',
                  page: null, fileUrl: null, fileName: null };
    return {
      quoted:     shape(render([{ ...src, quote: CLAUSE }])),
      nullQuote:  shape(render([{ ...src, quote: null }])),
      noQuoteKey: shape(render([{ ...src }])),
      emptyQuote: shape(render([{ ...src, quote: '' }])),
      wsQuote:    shape(render([{ ...src, quote: '   \n\t  ' }])),
      // A page and a real file locate a document; they do not quote it.
      pageOnly:   shape(render([{ ...src, quote: null, page: 12, fileUrl: 'https://x/lease.pdf' }])),
      mixed:      shape(render([{ ...src, quote: CLAUSE }, { ...src, quote: null }])),
    };
  }, REAL_CLAUSE);

  eq(R.quoted.liveChips, 1,       'I1  a quote-backed citation still renders as an evidence chip');
  eq(R.quoted.openFromChip, 1,    'I1b and is still clickable into the Evidence Viewer');
  is(R.quoted.hasEvdAttr,         'I1c and still carries its evidence payload');
  is(R.quoted.showEvidence,       'I1d and still offers "Show Evidence"');
  is(R.quoted.html.includes(REAL_CLAUSE), 'I1e and the real clause reaches the chip');

  for (const [key, label] of [['nullQuote','null'], ['noQuoteKey','absent'],
                              ['emptyQuote','empty string'], ['wsQuote','whitespace-only']]) {
    eq(R[key].liveChips, 0,    `I2  a ${label} quote renders NO evidence/clause chip`);
    eq(R[key].openFromChip, 0, `I2b a ${label} quote is not clickable into evidence`);
    eq(R[key].noSrcChips, 1,   `I2c a ${label} quote renders as plain provenance instead`);
    is(R[key].saysNotCaptured, `I2d a ${label} quote says the clause was not captured`);
    eq(R[key].showEvidence, false, `I2e a ${label} quote offers no "Show Evidence" action`);
    eq(R[key].hasEvdAttr, false,   `I2f a ${label} quote attaches no evidence payload`);
  }

  eq(R.pageOnly.liveChips, 0, 'I3  a page + file with no clause is not a clause citation');
  eq(R.pageOnly.noSrcChips, 1,'I3b it renders as provenance — the document is located, not quoted');
  // Caught by mutation I-M1d: the four cases above carry neither page nor
  // fileUrl, so only THIS one can prove that "Show Evidence" is gated on the
  // clause rather than on the document being locatable.
  eq(R.pageOnly.showEvidence, false, 'I3c and offers no "Show Evidence" — there is no clause to show');
  eq(R.pageOnly.hasEvdAttr, false,   'I3d and attaches no evidence payload');

  eq(R.mixed.liveChips, 1,    'I4  a mixed set promotes only the cited one');
  eq(R.mixed.noSrcChips, 1,   'I4b and demotes only the uncited one');

  // Nothing may be invented to fill an absent quote.
  sec('no quote is fabricated to fill the gap');
  const invented = ['5%', 'annual cap', 'shall not increase', 'per annum', 'Operating Expenses']
    .filter(t => R.nullQuote.html.includes(t));
  eq(invented.length, 0, 'I5  an uncited chip contains no substituted clause text');
  is(!/title="[^"]{40,}"/.test(R.nullQuote.html) ||
     /MainStreet has this source on file/.test(R.nullQuote.html),
     'I5b its tooltip explains the absence rather than quoting something');

  // ── 2. Fallback confidence ─────────────────────────────────────────────────
  sec('a non-answer wears no confidence badge');
  const F = await page.evaluate(() => {
    const mk = (intent, conf) => window.AIWorkspace.renderAnswerHtml({
      intent, heading: 'H', paragraphs: ['p'], bullets: [], citations: [],
      confidence: conf, trace: { intent, engine: 'E', property: 'P', sources: [], citationsUsed: 0 },
    });
    // A fallback identified ONLY by its trace — the shape a consumer sees when it
    // spreads the result without the top-level intent. Caught by mutation I-M2d.
    const traceOnly = window.AIWorkspace.renderAnswerHtml({
      heading: 'H', paragraphs: ['p'], bullets: [], citations: [],
      confidence: { pct: 100, basis: 'honest fallback' },
      trace: { intent: 'fallback', engine: 'None (honest fallback)', property: 'P',
               sources: [], citationsUsed: 0 },
    });
    const answered = window.AIWorkspace.answer({ question: 'what is the airspeed of a swallow?', props: [] });
    return {
      traceOnlyRendered: /aiw-conf/.test(traceOnly),
      fallbackRendered:  /aiw-conf/.test(mk('fallback', { pct: 100, basis: 'honest fallback' })),
      answeredRendered:  /aiw-conf/.test(mk('cam_caps', { pct: 92, basis: 'extracted lease terms' })),
      answeredText:      mk('cam_caps', { pct: 92, basis: 'extracted lease terms' }).match(/Confidence [^<]*/),
      // The fallback no longer even carries a confidence to render.
      liveFallbackIntent: answered.intent,
      liveFallbackConf:   answered.confidence ?? null,
      liveFallbackHtml:   /aiw-conf/.test(window.AIWorkspace.renderAnswerHtml(answered)),
      stillExplains:      (answered.bullets || []).length > 0,
    };
  });
  eq(F.fallbackRendered, false, 'I6  a fallback renders NO confidence badge, even if handed one');
  eq(F.traceOnlyRendered, false, 'I6a a fallback known only by its trace is excluded too');
  eq(F.liveFallbackIntent, 'fallback', 'I6b the live unmatched question really does fall back');
  eq(F.liveFallbackConf, null,  'I6c and carries no confidence value at all');
  eq(F.liveFallbackHtml, false, 'I6d so nothing prints "Confidence 100% · honest fallback"');
  is(F.stillExplains,           'I6e the fallback still explains what it can answer');
  eq(F.answeredRendered, true,  'I7  a real answered intent KEEPS its confidence badge');
  is(F.answeredText && /92%/.test(F.answeredText[0]), 'I7b with its unchanged percentage', F.answeredText && F.answeredText[0]);

  // ── 3. cam_caps basis wording ──────────────────────────────────────────────
  sec('cam_caps describes the evidence it actually holds');
  const C = await page.evaluate(() => {
    const mkProp = (quote) => ({
      id: 'p1', name: 'Happy Plaza',
      tenants: [{ id: 't1', tenant_name: 'Tollgrade Communications, Inc', cap: 3,
                  lease_type: 'Triple Net (NNN)', leased_sqft: 22122,
                  fieldEvidence: quote ? { cap: { snapshots: [{ value: 3, quote, reviewedAt: '2026-01-01T00:00:00Z' }] } } : {} }],
    });
    const ask = (p) => window.AIWorkspace.answer({
      question: 'which tenants have a CAM cap?', context: { propertyId: 'p1' }, props: [p] });
    const noQ = ask(mkProp(null));
    const wiQ = ask(mkProp('Operating Expenses shall not increase by more than three percent (3%)'));
    return {
      noQuoteBasis: noQ.confidence && noQ.confidence.basis,
      noQuoteIntent: noQ.intent,
      withQuoteBasis: wiQ.confidence && wiQ.confidence.basis,
      withQuoteIntent: wiQ.intent,
      noQuotePct: noQ.confidence && noQ.confidence.pct,
    };
  });
  eq(C.noQuoteIntent, 'cam_caps', 'I8  the cap question reaches cam_caps');
  is(C.noQuoteBasis !== 'extracted lease terms',
     'I8b with no clause captured it does NOT claim "extracted lease terms"', C.noQuoteBasis);
  eq(C.noQuoteBasis, 'lease source identified; clause not captured',
     'I8c it says the source is known and the clause is not');
  eq(C.noQuotePct, 92, 'I8d the confidence percentage itself is unchanged');
  if (C.withQuoteIntent === 'cam_caps') {
    eq(C.withQuoteBasis, 'extracted lease terms',
       'I9  when a clause IS captured the original wording returns');
  } else { bad('I9  when a clause IS captured the original wording returns', 'intent=' + C.withQuoteIntent); }

  // ── 4. Source pins ─────────────────────────────────────────────────────────
  sec('the old admission rules are gone from source');
  const aw = code(fs.readFileSync(path.join(ROOT, 'ai-workspace.js'), 'utf8'));
  /filter\(c => c && \(c\.source \|\| c\.quote\)\)/.test(aw)
    ? bad('I10 the `c.source || c.quote` chip-admission rule is gone')
    : ok('I10 the `c.source || c.quote` chip-admission rule is gone');
  /evdPayload\[i\]\.quote \|\| evdPayload\[i\]\.page != null \|\| evdPayload\[i\]\.fileUrl/.test(aw)
    ? bad('I11 the old live-chip rule (quote || page || fileUrl) is gone')
    : ok('I11 the old live-chip rule (quote || page || fileUrl) is gone');
  /basis: 'honest fallback'/.test(aw)
    ? bad('I12 the fallback no longer carries a confidence object')
    : ok('I12 the fallback no longer carries a confidence object');
  /\$\{a\.confidence \? `<div class="aiw-conf">/.test(aw)
    ? bad('I13 the confidence badge is rendered behind _showConfidence')
    : ok('I13 the confidence badge is rendered behind _showConfidence');

  // ── The cap base cannot be cited into the answer ─────────────────────────
  //
  // S1 admitted cap_base_amount to the canonical fields, so PropertyRecord now
  // carries it and the AI can read it. That is the point — and it is also the
  // moment the field becomes able to appear in an answer. A hand-typed base has
  // no clause, so the chip rule must refuse it a live citation exactly as it
  // refuses any other uncited value. This asserts the RENDERED html, which is
  // the only place that guarantee is observable.
  sec('an uncited cap base gets no live citation');
  const CB = await page.evaluate(() => {
    const t = { id: 'x', tenant_name: 'Maple Coffee Co', cap: 5, capBaseAmount: '26000',
                fileName: 'maple_plaza_messy_lease.pdf',
                fieldEvidence: {}, reviewOverrides: {} };
    const prov = window.FieldProvenance.fieldProvenance('cap_base_amount', t,
                                                        { value: t.capBaseAmount });
    // Build the citation the way an answer would from that resolved field.
    const cite = { source: 'Lease — Maple Coffee Co', detail: 'Maple Plaza',
                   quote: prov.quote, page: prov.page,
                   fileUrl: null, fileName: prov.sourceFile };
    const html = window.AIWorkspace.renderAnswerHtml({
      intent: 'cam_caps', heading: 'Prior-year CAM base', paragraphs: ['x'], bullets: [],
      citations: [cite], confidence: { pct: 92, basis: 'lease cap fields on file' },
      trace: { intent: 'cam_caps', engine: 'Lease Review Engine', property: 'P',
               sources: [], citationsUsed: 1 },
    });
    return {
      state: prov.state, quote: prov.quote, sourceFile: prov.sourceFile,
      liveChips:  (html.match(/aiw-cite--live/g)  || []).length,
      noSrcChips: (html.match(/aiw-cite--nosrc/g) || []).length,
      openFromChip: (html.match(/openFromChip/g)  || []).length,
      saysNotCaptured: /clause not captured/.test(html),
      namesDocument: /maple_plaza_messy_lease/.test(html),
    };
  });
  eq(CB.state, 'manually_entered', 'I14 the cap base resolves as manually entered');
  eq(CB.quote, null,               'I14b carrying no clause');
  eq(CB.liveChips, 0,              'I14c so the answer renders NO live citation chip');
  eq(CB.openFromChip, 0,           'I14d and nothing is clickable through to a document');
  eq(CB.noSrcChips, 1,             'I14e it renders the no-source chip instead');
  is(CB.saysNotCaptured,           'I14f which says the clause was not captured');
  is(!CB.namesDocument,
     'I14g and the tenant\'s lease filename is NOT attributed to a typed number');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
