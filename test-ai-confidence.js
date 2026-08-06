// test-ai-confidence.js
// ============================================================================
// AI-1 — MISSING CONFIDENCE IS NOT HIGH CONFIDENCE.
//
// The lease extraction prompt (CLAUDE_LEASE_SYSTEM) never asks the model for a
// per-field confidence block. It asks for `quotes`. So for every AI-extracted
// lease in the product, `t.confidence.leased_sqft` is ABSENT — and four places
// in the codebase defaulted that absence to a passing score:
//
//   script.js               (t.confidence?.leased_sqft ?? 100) < 70   → never true
//   script.js               getFieldConfidence → '✓ Extracted from lease document'
//   lease-intelligence.js   t._confidenceScore ?? 100                 → simple model
//   lease-review-packets.js t._confidenceScore ?? 70                  → invented average
//
// Every one of them turned "the extractor told us nothing" into "the extractor
// was certain". Nothing entered the review queue, every square footage carried
// a ✓, and Phase 0 — which measures how often a reviewer had to correct a
// field — would have recorded that silence as success.
//
// These functions live in the page (script.js needs the DOM; the two modules
// attach to window), so they are exercised in a browser rather than required.
//
// Run: node test-ai-confidence.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8941;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const eq  = (actual, expected, msg) =>
  (actual === expected) ? ok(msg) : bad(msg, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// A tenant as extraction actually produces one: a quote for each field the
// model found, and no `confidence` object anywhere.
const QUOTED = {
  id: 't-quoted', tenant_name: 'Quoted Co', leased_sqft: 2400,
  fieldEvidence: { leased_sqft: { snapshots: [{ fieldKey: 'leased_sqft', value: 2400,
    quote: 'approximately 2,400 rentable square feet', extractedAt: '2026-01-01T00:00:00Z' }] } },
};
// The same lease when the model returned a value but no supporting clause.
const BARE = { id: 't-bare', tenant_name: 'Bare Co', leased_sqft: 2400, fieldEvidence: {} };

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
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
  await p.addInitScript(`window.supabase={createClient:function(){return {auth:{
    getUser:function(){return Promise.resolve({data:{user:{id:'u1',email:'pm@example.com'}},error:null});},
    getSession:function(){return Promise.resolve({data:{session:{user:{id:'u1',email:'pm@example.com'}}},error:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return Promise.resolve({error:null});}},
    rpc:function(){return Promise.resolve({data:null,error:null});},
    from:function(){var q={select:function(){return q;},eq:function(){return q;},neq:function(){return q;},
      is:function(){return q;},not:function(){return q;},order:function(){return q;},limit:function(){return q;},
      ilike:function(){return q;},in:function(){return Promise.resolve({data:[],error:null});},
      single:function(){return Promise.resolve({data:null,error:null});},
      then:function(f){return Promise.resolve({data:[],error:null}).then(f);}};return q;},
    storage:{from:function(){return {getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`);
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);

  // The suite is worthless if the page didn't finish parsing — a truncated
  // script.js leaves these undefined and every "not verified" check would pass
  // by accident. Prove they exist before asserting anything about them.
  sec('the functions under test are actually defined');
  {
    const present = await p.evaluate(() => ({
      sqftConfidenceScore: typeof window.sqftConfidenceScore,
      hasFieldQuote:       typeof window.hasFieldQuote,
      sqftIsApproximate:   typeof window.sqftIsApproximate,
      getFieldConfidence:  typeof getFieldConfidence,
      routing:             typeof window.LeaseIntelligence?.modelRoutingRecommendation,
      narratives:          typeof window.LeaseReviewPackets?.buildConfidenceNarratives,
      execSummary:         typeof window.LeaseReviewPackets?.buildExecutiveSummary,
    }));
    for (const [name, t] of Object.entries(present)) {
      eq(t, 'function', `${name} is defined in the page`);
    }
  }

  // ── the score reader itself ───────────────────────────────────────────────
  sec('sqftConfidenceScore reports null, never a number it did not receive');
  {
    const r = await p.evaluate(() => ({
      absent:    window.sqftConfidenceScore({ leased_sqft: 2400 }),
      emptyConf: window.sqftConfidenceScore({ confidence: {} }),
      snake:     window.sqftConfidenceScore({ confidence: { leased_sqft: 45 } }),
      camel:     window.sqftConfidenceScore({ confidence: { leasedSqft: 45 } }),
      zero:      window.sqftConfidenceScore({ confidence: { leased_sqft: 0 } }),
      textual:   window.sqftConfidenceScore({ confidence: { leased_sqft: 'high' } }),
      nan:       window.sqftConfidenceScore({ confidence: { leased_sqft: NaN } }),
      nullTenant: window.sqftConfidenceScore(null),
    }));
    eq(r.absent,     null, 'no confidence object at all → null (this is the production case)');
    eq(r.emptyConf,  null, 'an empty confidence object → null');
    eq(r.snake,      45,   'leased_sqft score is read');
    eq(r.camel,      45,   'leasedSqft (camelCase) score is read');
    eq(r.zero,       0,    'a score of 0 survives — 0 is a real score, not "missing"');
    eq(r.textual,    null, 'a non-numeric score is null, not a truthy value');
    eq(r.nan,        null, 'NaN is null — it must never flow into a < 70 comparison');
    eq(r.nullTenant, null, 'a null tenant is null, not a throw');
  }

  // ── the badge a reviewer reads ────────────────────────────────────────────
  sec('getFieldConfidence does not put a ✓ on a number nothing stands behind');
  {
    const r = await p.evaluate(([quoted, bare]) => {
      const g = t => { const c = getFieldConfidence('leased_sqft', t); return { status: c.status, note: c.note }; };
      return {
        bare:      g(bare),
        quoted:    g(quoted),
        lowScore:  g({ ...bare, confidence: { leased_sqft: 45 } }),
        highScore: g({ ...bare, confidence: { leased_sqft: 95 } }),
        empty:     g({ ...bare, leased_sqft: '' }),
      };
    }, [QUOTED, BARE]);

    // THE REGRESSION. Before AI-1 this returned 'verified' /
    // 'Extracted from lease document' — the strongest claim the product makes,
    // on the strength of nothing at all.
    (r.bare.status !== 'verified')
      ? ok(`no score and no clause is not 'verified' (got '${r.bare.status}')`)
      : bad('no score and no clause still badges as verified', r.bare.note);
    /no confidence score and no source clause/i.test(r.bare.note)
      ? ok('the note says why: no confidence score and no source clause')
      : bad('the note does not explain what is missing', r.bare.note);
    !/Extracted from lease document/i.test(r.bare.note)
      ? ok('it no longer claims "Extracted from lease document"')
      : bad('still claims extraction verified the value', r.bare.note);

    eq(r.quoted.status,    'verified',  'a stored verbatim clause IS evidence — quoted field stays verified');
    eq(r.lowScore.status,  'estimated', 'a reported score below 70 is estimated');
    eq(r.highScore.status, 'verified',  'a reported score above 70 is verified');
    eq(r.empty.status,     'missing',   'an empty square footage is missing, not estimated');
  }

  // ── the flag the CAM engine carries ───────────────────────────────────────
  sec('sqftIsApproximate — three states, not two');
  {
    const r = await p.evaluate(([quoted, bare]) => ({
      bare:      window.sqftIsApproximate(bare),
      quoted:    window.sqftIsApproximate(quoted),
      lowScore:  window.sqftIsApproximate({ ...bare, confidence: { leased_sqft: 45 } }),
      highScore: window.sqftIsApproximate({ ...bare, confidence: { leased_sqft: 95 } }),
      reviewed:  window.sqftIsApproximate({ ...bare,
        reviewOverrides: { leased_sqft: { reviewerConfirmed: true, value: 2400 } } }),
    }), [QUOTED, BARE]);

    eq(r.bare,      true,  'no score and no clause → approximate (was false under `?? 100`)');
    eq(r.quoted,    false, 'a clause backs the number → not approximate');
    eq(r.lowScore,  true,  'a score below threshold → approximate');
    eq(r.highScore, false, 'a score above threshold → not approximate');
    eq(r.reviewed,  false, 'a reviewer who confirmed the field outranks all of it');
  }

  // ── the chip on the review workspace ──────────────────────────────────────
  sec('the review-workspace chip does not read High on an unmeasured field');
  {
    const r = await p.evaluate(([quoted, bare]) => ({
      bare:     typeof _rwConfChip === 'function' ? _rwConfChip('leased_sqft', bare).label     : 'N/A-fn-missing',
      quoted:   typeof _rwConfChip === 'function' ? _rwConfChip('leased_sqft', quoted).label   : 'N/A-fn-missing',
      lowScore: typeof _rwConfChip === 'function'
        ? _rwConfChip('leased_sqft', { ...bare, confidence: { leased_sqft: 20 } }).label : 'N/A-fn-missing',
    }), [QUOTED, BARE]);
    (r.bare !== 'High')
      ? ok(`an unmeasured, unquoted sqft does not chip High (got '${r.bare}')`)
      : bad('unmeasured sqft still chips High');
    eq(r.quoted,   'High', 'a clause-backed sqft still chips High');
    eq(r.lowScore, 'Low',  'a reported score of 20 chips Low');
  }

  // ── model routing ─────────────────────────────────────────────────────────
  sec('modelRoutingRecommendation routes an unmeasured lease conservatively');
  {
    const r = await p.evaluate(() => {
      const R = window.LeaseIntelligence.modelRoutingRecommendation;
      const base = { tenant_name: 'X', leased_sqft: 1000, start_date: '2022-01-01',
                     end_date: '2027-01-01', amendments: [], fieldEvidence: {} };
      const call = t => { const x = R(t); return { tier: x.tier, signals: x.signals }; };
      return {
        unknown: call({ ...base }),
        high:    call({ ...base, _confidenceScore: 92 }),
        low:     call({ ...base, _confidenceScore: 40 }),
        zero:    call({ ...base, _confidenceScore: 0 }),
      };
    });

    // THE REGRESSION. `?? 100` sent a lease nobody scored to the lightweight
    // model on the strength of a score that was never computed.
    eq(r.unknown.tier, 'complex', 'no confidence score → complex tier, not simple');
    r.unknown.signals.some(s => /confidence unknown/i.test(s))
      ? ok('the routing reason names the unknown confidence')
      : bad('routing gave no reason mentioning unknown confidence', JSON.stringify(r.unknown.signals));
    eq(r.high.tier, 'simple',  'a measured high score still routes simple');
    eq(r.low.tier,  'complex', 'a measured low score still routes complex');
    eq(r.zero.tier, 'complex', 'a measured score of 0 routes complex, not treated as missing');
    !r.high.signals.some(s => /confidence unknown/i.test(s))
      ? ok('a measured lease is not labelled unknown')
      : bad('a measured lease was labelled unknown', JSON.stringify(r.high.signals));
  }

  // ── the packet a landlord reads ───────────────────────────────────────────
  sec('buildConfidenceNarratives does not average in a score it invented');
  {
    const r = await p.evaluate(() => {
      const B = window.LeaseReviewPackets.buildConfidenceNarratives;
      const measured = { tenant_name: 'Measured LLC', _confidenceScore: 85, fieldEvidence: {} };
      const unmeasured = { tenant_name: 'Unmeasured LLC', fieldEvidence: {} };
      const weak = { tenant_name: 'Weak LLC', _confidenceScore: 40, fieldEvidence: {} };
      const pick = x => ({
        avg: x.averageScore, overall: x.overallConfidenceLevel,
        high: x.highConfidence.map(e => e.tenantName),
        medium: x.mediumConfidence.map(e => e.tenantName),
        low: x.lowConfidence.map(e => e.tenantName),
        unknown: (x.unknownConfidence || []).map(e => e.tenantName),
        narratives: x.narratives,
      });
      return {
        mixed:     pick(B([measured, unmeasured])),
        allUnknown: pick(B([unmeasured])),
        measuredOnly: pick(B([measured, weak])),
      };
    });

    // THE REGRESSION. `?? 70` scored the unmeasured lease a passing 70 and
    // averaged it in: (85 + 70) / 2 = 78. The landlord read 78 with no way to
    // tell that half of it was fabricated.
    eq(r.mixed.avg, 85, 'an unmeasured lease is excluded from the average (85, not 78)');
    r.mixed.unknown.includes('Unmeasured LLC')
      ? ok('the unmeasured lease is bucketed as unknown')
      : bad('unmeasured lease missing from the unknown bucket', JSON.stringify(r.mixed));
    !r.mixed.medium.includes('Unmeasured LLC')
      ? ok('it is NOT bucketed as medium confidence')
      : bad('unmeasured lease was filed under medium confidence');
    r.mixed.narratives.some(n => /no extraction confidence score/i.test(n))
      ? ok('a narrative says the average excludes unmeasured leases')
      : bad('no narrative explains the exclusion', JSON.stringify(r.mixed.narratives));

    eq(r.allUnknown.avg,     null,      'nothing measured → no average, not a number');
    eq(r.allUnknown.overall, 'unknown', "nothing measured → overall 'unknown', not 'low'");

    eq(r.measuredOnly.avg, Math.round((85 + 40) / 2), 'measured leases still average normally (63)');
    r.measuredOnly.low.includes('Weak LLC')
      ? ok('a measured low score still lands in the low bucket')
      : bad('measured low score lost its bucket', JSON.stringify(r.measuredOnly));
  }

  sec('buildExecutiveSummary names the leases it cannot vouch for');
  {
    const r = await p.evaluate(() => {
      const B = window.LeaseReviewPackets.buildExecutiveSummary;
      const t = (name, extra) => ({ tenant_name: name, leased_sqft: 1000,
        start_date: '2022-01-01', end_date: '2027-01-01', fieldEvidence: {}, ...extra });
      const pick = x => ({ warnings: x.warningItems, unresolved: x.unresolvedItems });
      return {
        unmeasured: pick(B({ tenants: [t('A'), t('B')], disputes: [] }, {})),
        weak:       pick(B({ tenants: [t('C', { _confidenceScore: 40 })], disputes: [] }, {})),
        strong:     pick(B({ tenants: [t('D', { _confidenceScore: 90 })], disputes: [] }, {})),
      };
    });

    r.unmeasured.unresolved.some(s => /no extraction confidence score/i.test(s) && /2 leases/.test(s))
      ? ok('two unmeasured leases are reported as unresolved, by count')
      : bad('unmeasured leases went unmentioned in the packet', JSON.stringify(r.unmeasured));
    !r.unmeasured.warnings.some(s => /low confidence/i.test(s))
      ? ok('unmeasured is not overstated as "low confidence"')
      : bad('unmeasured leases were reported as low confidence');
    r.weak.warnings.some(s => /low confidence/i.test(s))
      ? ok('a measured score of 40 still raises the low-confidence warning')
      : bad('low-confidence warning stopped firing', JSON.stringify(r.weak));
    !r.strong.unresolved.some(s => /no extraction confidence score/i.test(s))
      ? ok('a measured lease produces no unknown-confidence line')
      : bad('a measured lease was reported as unmeasured', JSON.stringify(r.strong));
  }

  await b.close();
  srv.close();

  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
