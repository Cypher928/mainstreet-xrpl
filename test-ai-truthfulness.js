'use strict';
/**
 * PHASE L — three ways the workspace stated something it did not know.
 *
 * 1. THE INVERSE QUESTION. cam_caps answered one question however it was asked.
 *    "Which tenants are missing a cap?" returned "4 leases carry a CAM cap" and
 *    listed the four that have one — the exact inverse, at 92% confidence.
 *
 * 2. THE FALSE NEGATIVE. A miss in knowledge_search returned "I searched … and
 *    found nothing on file", which reads as a statement about the building. It
 *    is a statement about the text MainStreet happens to have captured, and
 *    Phase G caught it saying it about a property holding two open disputes.
 *
 * 3. THE SWALLOWED CRASH. Every handler ran inside `catch { result = null }`, so
 *    a thrown intent produced the same answer an unrecognised question does:
 *    "I couldn't map that question to your data." Phase K shipped exactly this —
 *    knowledge_search referenced an undestructured `deps`, so every search threw
 *    and every search claimed the data was the problem.
 *
 * The common shape: the product knew less than it said. These tests pin the
 * three places it now says so.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8855;
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
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + String(d).slice(0, 150) : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + String(d).slice(0, 240) : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

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

  const R = await page.evaluate(() => {
    // THREE CAP STATES that must never collapse:
    //   tHas  — a cap on file
    //   tNone — the record was read and carries no cap
    //   tDark — the cap field could not be read at all
    const prop = {
      id: 'p1', name: 'Harborview',
      tenants: [
        { id: 'tHas',  tenant_name: 'Capped Co',   lease_type: 'NNN', cap: 5, capBaseAmount: 33000,
          fieldEvidence: { cap: { snapshots: [
            { value: 5, quote: 'shall not increase by more than five percent (5%)',
              page: 12, reviewedAt: '2026-05-01T00:00:00Z', superseded: false },
            { value: 9, quote: 'shall not increase by more than nine percent (9%)',
              page: 3, reviewedAt: '2026-01-01T00:00:00Z', superseded: true },
          ] } } },
        { id: 'tNone', tenant_name: 'Uncapped Co', lease_type: 'NNN', cap: null, fieldEvidence: {} },
        { id: 'tDark', tenant_name: 'Unread Co',   lease_type: 'NNN', cap: null, fieldEvidence: {} },
      ],
      invoices: [], camReconciliation: { camYear: 2025, total: 0, results: [] },
      timeline: [],
      disputes: [{ id: 1, tenantName: 'Capped Co', status: 'open', reason: 'HVAC allocation queried', vendor: 'ACME' }],
    };

    const REC = {
      identity: { name: 'Harborview', camYear: 2025, totalSqft: null, leasedSqft: null, occupancy: null },
      spaces: [
        { tenantId: 'tHas',  tenantName: 'Capped Co',   space: { name: 'Capped Co' },   lease: { type: 'NNN', cap: 5 },    camResult: null, counts: {} },
        { tenantId: 'tNone', tenantName: 'Uncapped Co', space: { name: 'Uncapped Co' }, lease: { type: 'NNN', cap: null }, camResult: null, counts: {} },
        { tenantId: 'tDark', tenantName: 'Unread Co',   space: { name: 'Unread Co' },   lease: { type: 'NNN', cap: null }, camResult: null, counts: {} },
      ],
      // tDark is deliberately ABSENT from fields: its cap could not be read.
      fields: {
        tHas:  { cap: { field: 'cap', state: 'lease_confirmed', label: 'Extracted from lease document',
                        quote: 'shall not increase by more than five percent (5%)', page: 12, sourceFile: null } },
        tNone: { cap: { field: 'cap', state: 'unknown', label: 'Not found', quote: null, page: null },
                 lease_type: { field: 'lease_type', state: 'ai_extracted', label: 'AI extraction — no supporting clause captured',
                               quote: null, page: null, sourceFile: null } },
      },
      cam: { pool: 0, results: [], unallocated: null, capped: [] },
      timeline: { property: [], byTenant: {} },
      disputes: prop.disputes,
      attention: [], documents: [], meta: { unavailable: [] },
    };

    const mk = (rec) => ({ PropertyRecord: { assemble: () => rec },
                           FieldProvenance: window.FieldProvenance, now: new Date('2026-09-03T00:00:00Z') });
    const ask = (question, rec) => window.AIWorkspace.answer({
      question, context: { propertyId: 'p1' }, props: [prop], deps: mk(rec === undefined ? REC : rec) });
    const flat = (a) => [a.heading || '', ...(a.paragraphs || []), ...(a.bullets || [])].join(' | ');
    const shape = (a) => ({ intent: a.intent, text: flat(a), heading: a.heading,
                            bullets: a.bullets || [], conf: a.confidence || null,
                            citations: (a.citations || []).map(c => c.quote || null),
                            resultSet: a.resultSet ? a.resultSet.label : null,
                            failure: a._failure || null,
                            html: window.AIWorkspace.renderAnswerHtml(a) });

    // ── A record whose fields section is unavailable entirely.
    const DARK = JSON.parse(JSON.stringify(REC));
    DARK.fields = {}; DARK.meta = { unavailable: ['fields'] };
    // ── A property with literally nothing captured.
    const BARE = JSON.parse(JSON.stringify(REC));
    BARE.fields = {}; BARE.disputes = []; BARE.meta = { unavailable: [] };

    const out = {
      capsHave:    shape(ask('which tenants have a CAM cap?')),
      capsMissing: shape(ask('which tenants are missing a cap?')),
      capsWithout: shape(ask('which tenants have no cap?')),
      capsDark:    shape(ask('which tenants are missing a cap?', DARK)),
      searchMiss:  shape(ask('find zzzqqq')),
      searchBare:  shape(ask('find zzzqqq', BARE)),
      searchDark:  shape(ask('find zzzqqq', DARK)),
      searchHit:   shape(ask('find five percent')),
      searchSup:   shape(ask('find nine percent')),
      unmatched:   shape(ask('what is the airspeed velocity of an unladen swallow?')),
    };

    // ── The crash path. A registered intent is made to throw on demand.
    window.AIWorkspace.registerIntent({
      id: 'l_boom',
      match: (s) => /trigger the phase l explosion/.test(s),
      handle: () => { throw new Error('SECRET_INTERNAL_DETAIL at line 42'); },
    });
    const boom = ask('trigger the phase l explosion');
    out.boom = shape(boom);
    out.lastFailure = window.AIWorkspace.lastFailure ? window.AIWorkspace.lastFailure() : null;

    // A matcher that throws must not take the question down with it.
    window.AIWorkspace.registerIntent({
      id: 'l_badmatch',
      match: () => { throw new Error('MATCHER_BOOM'); },
      handle: () => ({ heading: 'never', paragraphs: [], citations: [] }),
    });
    out.afterBadMatcher = shape(ask('which tenants have a CAM cap?'));
    // The throwing matcher is registered LAST, so only a question that matches
    // no built-in intent actually reaches it. Without the guard the exception
    // escapes answer() entirely and the caller gets nothing at all.
    let escaped = null;
    try { out.afterBadMatcherUnmatched = shape(ask('what is the airspeed velocity of an unladen swallow?')); }
    catch (e) { escaped = (e && e.message) || String(e); out.afterBadMatcherUnmatched = null; }
    out.matcherEscaped = escaped;
    return out;
  });

  const has = (k, s) => R[k] && R[k].text.toLowerCase().includes(String(s).toLowerCase());

  // ═══ 1. cam_caps inverse ═══
  sec('the cap question is answered in the direction it was asked');
  eq(R.capsHave.intent, 'cam_caps', 'L1  "which have a cap" reaches cam_caps');
  is(/CAM caps on file/.test(R.capsHave.heading), 'L1b and keeps its original heading', R.capsHave.heading);
  is(has('capsHave', 'Capped Co') && has('capsHave', '5% annual cap'),
     'L1c listing the capped tenant with its percentage', R.capsHave.text);
  eq(R.capsHave.resultSet, 'Tenants with CAM caps', 'L1d and its original result set');

  eq(R.capsMissing.intent, 'cam_caps', 'L2  "which are missing a cap" still reaches cam_caps');
  is(/no CAM cap on file/i.test(R.capsMissing.heading),
     'L2b but now answers the INVERSE question', R.capsMissing.heading);
  is(!/^\s*\d+ leases? carr(y|ies) a CAM cap\.?$/i.test((R.capsMissing.text.split('|')[1] || '').trim()),
     'L2c and does not lead with "N leases carry a CAM cap"');
  is(has('capsMissing', 'Uncapped Co'), 'L3  it names the tenant WITHOUT a cap', R.capsMissing.text);
  is(!R.capsMissing.bullets.some(x => /Capped Co .*5% annual cap/.test(x)),
     'L3b and does not list the capped tenant as an answer', JSON.stringify(R.capsMissing.bullets));
  eq(R.capsMissing.resultSet, 'Tenants with no CAM cap', 'L3c the result set is the missing ones');
  is(has('capsWithout', 'Uncapped Co') && /no CAM cap on file/i.test(R.capsWithout.heading),
     'L3d "which have no cap" is read the same way', R.capsWithout.heading);

  sec('the three cap states do not collapse');
  is(R.capsMissing.bullets.some(x => /Unread Co/.test(x) && /could not be read/i.test(x)),
     'L4  the unreadable tenant is reported as unreadable, not as uncapped',
     JSON.stringify(R.capsMissing.bullets));
  is(!R.capsMissing.bullets.some(x => /Unread Co/.test(x) && /no cap on file/i.test(x)),
     'L4b it is never asserted to have no cap');
  is(R.capsHave.bullets.some(x => /Capped Co/.test(x)) &&
     R.capsHave.bullets.some(x => /Uncapped Co/.test(x)) &&
     R.capsHave.bullets.some(x => /Unread Co/.test(x)),
     'L4c the positive answer still distinguishes all three', JSON.stringify(R.capsHave.bullets));
  is(has('capsDark', 'could not be read'),
     'L5  with the whole fields section unavailable, nothing is called uncapped', R.capsDark.text);
  is(!/Uncapped Co .*no cap on file/.test(R.capsDark.bullets.join(' ')),
     'L5b — absence of knowledge is not evidence of absence');

  sec('the inverse answer attaches no evidence to the opposite claim');
  eq(R.capsMissing.citations.length, 0,
     'L6  a "missing cap" answer carries no lease citations (they belong to the capped leases)');
  is(R.capsHave.citations.some(c => c && /five percent/.test(c)),
     'L6b while the positive answer still cites the canonical clause', JSON.stringify(R.capsHave.citations));
  is(!R.capsHave.citations.some(c => c && /nine percent/.test(c)),
     'L6c and never the superseded one');

  // ═══ 2. knowledge_search false negative ═══
  sec('a search miss is a statement about captured text, not about the building');
  eq(R.searchMiss.intent, 'knowledge_search', 'L7  a search question reaches knowledge_search');
  is(!has('searchMiss', 'found nothing on file'),
     'L7b it no longer claims "found nothing on file"', R.searchMiss.text);
  is(has('searchMiss', 'captured'), 'L7c it scopes the claim to what was captured', R.searchMiss.heading);
  is(has('searchMiss', 'dispute record'),
     'L8  case C — it discloses the dispute records it did not search', R.searchMiss.text);
  is(has('searchMiss', 'no clause text behind') || has('searchMiss', 'limit of what was captured'),
     'L9  case B — it explains that some fields have values but no captured clause', R.searchMiss.text);
  is(has('searchBare', 'nothing') && has('searchBare', 'to search yet'),
     'L10 case A — with nothing captured at all it says so plainly', R.searchBare.text);
  is(has('searchDark', 'could not read'),
     'L11 case D — an unreadable record concludes nothing', R.searchDark.text);
  is(!has('searchDark', 'found nothing on file'), 'L11b and makes no absence claim');

  sec('the hit path and evidence rules are untouched');
  is(has('searchHit', 'five percent'), 'L12 a real match is still found and quoted', R.searchHit.text);
  is(!has('searchSup', 'nine percent'), 'L12b the superseded clause still cannot surface', R.searchSup.text);
  is(!/five percent|nine percent/.test(R.searchMiss.text),
     'L12c a miss fabricates no quote');
  eq(R.searchMiss.citations.length, 0, 'L12d and attaches no citations');

  // ═══ 3. swallowed exceptions ═══
  sec('a crash is not a "nothing found"');
  eq(R.unmatched.intent, 'fallback', 'L13 an unmatched question still gets the normal fallback');
  eq(R.unmatched.conf, null, 'L13b which still carries no confidence (Phase I)');
  eq(R.boom.intent, 'intent_error', 'L14 a THROWN intent takes a distinct path');
  is(!/couldn't map that question to your data/i.test(R.boom.text),
     'L14b and never claims the data was the problem', R.boom.text);
  is(/couldn't complete that request/i.test(R.boom.heading), 'L14c saying the request failed', R.boom.heading);
  is(has('boom', 'fault in MainStreet'), 'L14d and naming whose fault it is');
  eq(R.boom.conf, null, 'L14e a failure scores itself no confidence');
  is(!/aiw-conf/.test(R.boom.html), 'L14f and renders no confidence badge');

  sec('the fault is observable to developers, invisible to users');
  is(R.lastFailure && /SECRET_INTERNAL_DETAIL/.test(R.lastFailure.message || ''),
     'L15 the exception message is available on AIWorkspace.lastFailure()',
     R.lastFailure && R.lastFailure.intent);
  eq(R.lastFailure && R.lastFailure.intent, 'l_boom', 'L15b named by the intent that threw');
  is(R.lastFailure && !!R.lastFailure.stack, 'L15c with a stack for debugging');
  is(R.boom.failure && R.boom.failure.intent === 'l_boom',
     'L15d and the answer object carries the failure for tests');
  is(!/SECRET_INTERNAL_DETAIL/.test(R.boom.html),
     'L16 but no internal message reaches the rendered answer');
  is(!/line 42|at Object|Error:/.test(R.boom.html), 'L16b and no stack trace does either');

  sec('a broken matcher does not take the question down');
  eq(R.afterBadMatcher.intent, 'cam_caps',
     'L17 a throwing matcher is skipped and the right intent still answers');
  is(has('afterBadMatcher', 'Capped Co'), 'L17b with its normal answer intact');
  eq(R.matcherEscaped, null,
     'L17c a throwing matcher never escapes answer() to the caller');
  eq(R.afterBadMatcherUnmatched && R.afterBadMatcherUnmatched.intent, 'fallback',
     'L17d a question that REACHES the broken matcher still gets the normal fallback');

  // ═══ Phase H / I / K protections ═══
  sec('the earlier phases still hold');
  const aw = fs.readFileSync(path.join(ROOT, 'ai-workspace.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  is(!/capBaseAmount\s*\*\s*\(1|_camCeiling/.test(aw), 'L18 no CAM ceiling arithmetic in the workspace');
  is(!/basis: 'honest fallback'/.test(aw), 'L19 no fallback confidence reintroduced');
  is(/_showConfidence\(a\)/.test(aw), 'L19b the confidence badge is still gated');
  is(/FP\.latestSnapshot\(key, t\)/.test(aw), 'L20 canonical evidence resolution still in place');
  const capsLive = (R.capsHave.html.match(/aiw-cite--live/g) || []).length;
  is(capsLive >= 1, 'L21 quote-backed citations are still live chips (Phase I)', capsLive);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
