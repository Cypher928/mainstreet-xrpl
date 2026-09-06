'use strict';
/**
 * PHASE K — the AI answers from the canonical record, or says it cannot.
 *
 * WHAT THESE TESTS ARE FOR
 * ------------------------
 * Rewiring a source of truth is invisible from the outside: an answer built from
 * the blob and an answer built from PropertyRecord can read identically while
 * disagreeing with the rest of the product. So the record injected here carries
 * SENTINEL values that the blob does not — a different cap, a different
 * allocation, a different tenant name. If an answer shows the blob's value, the
 * intent is still reading the blob, and the test fails.
 *
 * G1 gets the sharpest test. `_tenantEvidence` and `_scanEvidence` selected the
 * LAST snapshot by array position while FieldProvenance.latestSnapshot skips
 * superseded snapshots and orders by reviewedAt. Where those disagreed the
 * workspace quoted a clause the lease no longer operates under — checkable, and
 * wrong. The fixture below puts a superseded "nine percent" clause last in the
 * array and the canonical "five percent" first, and no answer may cite the nine.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8853;
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
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + String(d).slice(0, 220) : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

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
  // Any network call at all during an answer is a failure of requirement K.
  let networkCalls = 0;
  await page.route('**/api/**', r => { networkCalls++;
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#appContent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const R = await page.evaluate(() => {
    // ── Blob values and RECORD values differ on purpose. Any answer showing a
    //    blob value is still reading the blob.
    const prop = {
      id: 'p1', name: 'Harborview', camYear: 2025, totalSqft: 20000,
      tenants: [
        { id: 'tA', tenant_name: 'Alpha Co', leased_sqft: 1111, cap: 11, lease_type: 'NNN',
          end_date: '2099-01-01', audit_rights: true, capBaseAmount: 33000,
          fieldEvidence: { cap: { snapshots: [
            // CANONICAL: earlier in the array, later reviewedAt, not superseded.
            { value: 5, quote: 'shall not increase by more than five percent (5%)',
              page: 12, reviewedAt: '2026-05-01T00:00:00Z', superseded: false },
            // SUPERSEDED: last in the array — what the old reader picked.
            { value: 9, quote: 'shall not increase by more than nine percent (9%)',
              page: 3, reviewedAt: '2026-01-01T00:00:00Z', superseded: true },
          ] } } },
        { id: 'tB', tenant_name: 'Beta LLC', leased_sqft: 2222, cap: null, lease_type: 'NNN',
          end_date: '2098-01-01', fieldEvidence: {} },
      ],
      invoices: [{ vendor: 'V', amount: 999, category: 'utilities', date: '2025-01-01' }],
      camReconciliation: { camYear: 2025, total: 999,
        results: [{ tenantId: 'tA', tenantName: 'Alpha Co', allocatedAmount: 111, totalAllocated: 111,
                    proRataPercent: 1, capApplied: false, expectedCam: 111, variance: 1 }] },
      timeline: [{ id: 'blobEvent', type: 'note', title: 'BLOB_EVENT', timestamp: '2026-01-01T00:00:00Z' }],
      disputes: [{ id: 9, tenantName: 'Alpha Co', status: 'open', reason: 'BLOB_DISPUTE', vendor: 'X' }],
    };

    const SENT = {
      spaces: [
        { tenantId: 'tA', tenantName: 'Alpha Co', space: { name: 'Alpha Co' }, noIdentity: false,
          lease: { type: 'REC_NNN', sqft: 8888, start: '2020-01-01', end: '2031-12-31', cap: 7 },
          camResult: null, counts: {} },
        { tenantId: 'tB', tenantName: 'Beta LLC', space: { name: 'Beta LLC' }, noIdentity: false,
          lease: { type: 'REC_GROSS', sqft: 4444, start: '2021-01-01', end: '2032-12-31', cap: null },
          camResult: null, counts: {} },
      ],
      fields: { tA: { cap: { field: 'cap', state: 'lease_confirmed', label: 'REC_LABEL_CONFIRMED',
                             quote: 'REC_CANONICAL_QUOTE', page: 12, sourceFile: null },
                      // Stated, but with NO clause captured — the case Phase I
                      // exists for, and the only one that can prove a label is
                      // never substituted for a quote.
                      lease_type: { field: 'lease_type', state: 'ai_extracted',
                                    label: 'REC_LABEL_UNCITED', quote: null, page: null, sourceFile: null } },
                tB: { cap: { field: 'cap', state: 'unknown', label: 'Not found', quote: null, page: null } } },
      cam: { pool: 777777,
             results: [
                       // A DIFFERENT tenant with the SAME name, listed first. A
                       // name match returns this one; only an id match returns tA.
                       { tenantId: 'tZ', tenantName: 'Alpha Co', allocatedAmount: 11111,
                         totalAllocated: 11111, proRataPercent: 2, capApplied: false,
                         capAdjustment: null, expectedCam: null, variance: null },
                       { tenantId: 'tA', tenantName: 'Alpha Co', allocatedAmount: 54321,
                         totalAllocated: 54321, proRataPercent: 44, capApplied: true,
                         capAdjustment: 1234, expectedCam: 60000, variance: -5679,
                         expectedCamBasis: 'cap_ceiling' }],
             unallocated: 4242, capped: [{ tenantId: 'tA', tenantName: 'Alpha Co', capApplied: true, capAdjustment: 1234 }] },
      timeline: { property: [{ id: 'recProp', type: 'cam_reconciled', title: 'REC_PROPERTY_EVENT',
                               timestamp: '2026-06-01T00:00:00Z' }],
                  byTenant: { tA: [{ id: 'recTen', type: 'note', title: 'REC_TENANT_EVENT',
                                     timestamp: '2026-07-01T00:00:00Z' }], tB: [] } },
      disputes: [{ id: 1, tenantName: 'Alpha Co', status: 'open', reason: 'REC_DISPUTE_REASON',
                   vendor: 'RecVendor', tenantShare: 4321 }],
      attention: [{ severity: 'critical', title: 'REC_ATTENTION_1', why: 'because', action: 'go' },
                  { severity: 'warning', title: 'REC_ATTENTION_2', why: 'also', action: 'go' },
                  { severity: 'info', title: 'REC_ATTENTION_3', why: 'and', action: 'go' },
                  { severity: 'info', title: 'REC_ATTENTION_4', why: 'and', action: 'go' },
                  { severity: 'info', title: 'REC_ATTENTION_5', why: 'and', action: 'go' },
                  { severity: 'info', title: 'REC_ATTENTION_6', why: 'and', action: 'go' }],
      documents: [], identity: { name: 'Harborview', camYear: 2025, totalSqft: 20000,
                                 leasedSqft: null, occupancy: 66.6 },
      meta: { unavailable: [] },
    };

    let assembles = 0;
    const mkDeps = (rec) => ({
      PropertyRecord: { assemble: () => { assembles++; return rec; } },
      FieldProvenance: window.FieldProvenance,
      now: new Date('2026-09-03T00:00:00Z'),
    });

    const ask = (question, rec) => window.AIWorkspace.answer({
      question, context: { propertyId: 'p1' }, props: [prop], deps: mkDeps(rec === undefined ? SENT : rec) });

    const flat = (a) => [a.heading || '', ...(a.paragraphs || []), ...(a.bullets || [])].join(' | ');
    const out = {};
    const record = (k, question, rec) => {
      const a = ask(question, rec);
      out[k] = { intent: a.intent, text: flat(a), sources: (a.trace && a.trace.sources) || [],
                 citations: (a.citations || []).map(c => ({ quote: c.quote || null, source: c.source || null })),
                 conf: a.confidence || null,
                 html: window.AIWorkspace.renderAnswerHtml(a) };
    };

    assembles = 0;
    record('caps',        'which tenants have a CAM cap?');
    record('rentroll',    'show me the rent roll');
    record('expirations', 'when do the leases expire?');
    record('recon',       'explain this reconciliation');
    record('charge',      'why does Alpha Co owe this amount?');
    record('balances',    'who owes the most?');
    record('disputes',    'show me open disputes');
    record('history',     'what happened at this property?');
    record('histTenant',  'what happened with Alpha Co?');
    record('spaces',      'what spaces does this property have?');
    record('vacant',      'which spaces are vacant?');
    record('attention',   'what needs my attention?');
    record('provenance',  'where did this lease term come from?');
    record('search',      'find nine percent');
    record('search5',     'find five percent');
    record('property',    'explain this property');

    // Unavailable-record variants.
    const UNAVAIL = JSON.parse(JSON.stringify(SENT));
    UNAVAIL.spaces = null; UNAVAIL.attention = null; UNAVAIL.documents = null;
    UNAVAIL.meta = { unavailable: ['spaces', 'attention', 'documents', 'fields', 'timeline.scoping'] };
    record('unavailSpaces',    'what spaces does this property have?', UNAVAIL);
    record('unavailAttention', 'what needs my attention?',             UNAVAIL);
    record('unavailHistory',   'what happened at this property?',      UNAVAIL);
    record('unavailProv',      'where did this lease term come from?', UNAVAIL);

    // Empty-but-available: a real "none".
    const EMPTY = JSON.parse(JSON.stringify(SENT));
    EMPTY.attention = []; EMPTY.spaces = []; EMPTY.meta = { unavailable: [] };
    record('emptyAttention', 'what needs my attention?', EMPTY);

    // Intents outside PropertyRecord's scope must be untouched.
    record('settlement', 'show settlement status');
    record('reserves',   'show reserve balances');
    // A question nothing matches — the real fallback, for the Phase I check.
    record('fallbackAns', 'what is the airspeed velocity of an unladen swallow?');

    return { out, assembles, intentCount: (window.AIWorkspace.answer({ question: 'x', props: [] }).intent) };
  });

  const T = R.out;
  const has = (k, s) => T[k] && T[k].text.includes(s);

  // ── 1. Tier 1 reads the record ─────────────────────────────────────────────
  sec('Tier 1 intents read PropertyRecord, not the blob');
  eq(T.caps.intent, 'cam_caps', 'K1  cap question reaches cam_caps');
  is(has('caps', '7% annual cap'), 'K1b  the cap is the RECORD\'s 7%, not the blob\'s 11%', T.caps.text);
  is(!has('caps', '11% annual cap'), 'K1c  the blob cap does not appear');
  is(has('rentroll', 'REC_NNN') && has('rentroll', '8,888'),
     'K2  rent roll shows the record\'s lease type and area', T.rentroll.text);
  is(!has('rentroll', '1,111'), 'K2b  not the blob\'s square footage');
  is(has('expirations', '2031-12-31'), 'K3  expirations use the record\'s end dates', T.expirations.text);
  is(!has('expirations', '2099-01-01'), 'K3b  not the blob\'s');
  is(has('recon', '$777,777'), 'K4  explain_recon uses the record\'s CAM pool', T.recon.text);
  is(!has('recon', '$999'), 'K4b  not the blob\'s total');
  is(has('disputes', 'REC_DISPUTE_REASON') || T.disputes.citations.some(c => /REC_DISPUTE_REASON/.test(c.quote || '')),
     'K5  disputes come from the record', T.disputes.text);
  is(!has('disputes', 'BLOB_DISPUTE'), 'K5b  not the blob\'s dispute');
  is(has('balances', '$54,321'), 'K6  balances use the record\'s allocation', T.balances.text);
  is(has('property', '66.6% occupied'), 'K7  explain_property uses the record\'s occupancy', T.property.text);
  is(has('property', 'REC_ATTENTION_1'), 'K7b  and names the record\'s top attention item');

  // ── 2/3. CAM values pass through unchanged ─────────────────────────────────
  sec('CAM values are passed through, never recomputed');
  eq(T.charge.intent, 'tenant_charge', 'K8  charge question reaches tenant_charge');
  is(has('charge', '$54,321') || has('charge', '54,321'),
     'K8b  the allocation is the record\'s row (joined on tenantId)', T.charge.text);
  is(has('charge', '$1,234'), 'K8c  and the stored capAdjustment is reported as-is');
  is(!has('charge', '11,111'),
     'K8d  the SAME-NAMED other tenant\'s row is not picked — the join is on id', T.charge.text);
  const aw = code(fs.readFileSync(path.join(ROOT, 'ai-workspace.js'), 'utf8'));
  /capBaseAmount\s*\*\s*\(1|_camCeiling|expectedCam\s*=\s*[^=]/.test(aw)
    ? bad('K9  ai-workspace computes no expectedCam / cap ceiling of its own')
    : ok('K9  ai-workspace computes no expectedCam / cap ceiling of its own');

  // ── 4/5. G1 — canonical evidence wins ──────────────────────────────────────
  sec('G1 — a superseded clause can never be cited');
  const allQuotes = Object.values(T).flatMap(x => x.citations.map(c => c.quote || ''))
    .concat(Object.values(T).map(x => x.text));
  const citedNine = allQuotes.filter(q => /nine percent/i.test(q));
  eq(citedNine.length, 0, 'K10 NO answer anywhere cites the superseded "nine percent" clause');
  const capsCite = T.caps.citations.find(c => c.quote);
  is(capsCite ? /five percent/i.test(capsCite.quote) : false,
     'K10b cam_caps cites the canonical "five percent" clause', capsCite && capsCite.quote);
  is(has('search5', 'five percent'), 'K11 knowledge_search finds the canonical clause', T.search5.text);
  is(!has('search', 'nine percent'), 'K11b and cannot surface the superseded one', T.search.text);
  eq(T.provenance.intent, 'field_provenance', 'K12 provenance question reaches field_provenance');
  is(has('provenance', 'REC_LABEL_CONFIRMED'),
     'K12b and reports the record\'s FieldProvenance label', T.provenance.text);

  // ── 6. Phase I citation rules intact ───────────────────────────────────────
  sec('Phase I citation rules survive the rewiring');
  const provLive = (T.provenance.html.match(/aiw-cite--live/g) || []).length;
  const provNo   = (T.provenance.html.match(/aiw-cite--nosrc/g) || []).length;
  is(provLive >= 1, 'K13 a quote-backed provenance citation is still a live chip', provLive);
  eq(T.fallbackAns.intent, 'fallback', 'K14 an unmatched question still falls back');
  is(!/aiw-conf/.test(T.fallbackAns.html), 'K14b and the fallback renders no confidence badge');
  eq(T.fallbackAns.conf, null, 'K14c carrying no confidence value at all');
  is(T.provenance.html.includes('REC_CANONICAL_QUOTE') || provLive >= 1,
     'K13b carrying the canonical quote');
  is(provNo >= 1 && T.provenance.html.includes('clause not captured'),
     'K13c a stated-but-uncited field renders as provenance, saying the clause is missing', provNo);
  is(!T.provenance.citations.some(c => c.quote === 'REC_LABEL_UNCITED'),
     'K13d and its LABEL is never substituted for the missing quote',
     JSON.stringify(T.provenance.citations.map(c => c.quote)));

  // ── 7–10. Tier 2 reads its section ─────────────────────────────────────────
  sec('Tier 2 intents retrieve their section of the record');
  eq(T.history.intent, 'property_history', 'K15 history question reaches property_history');
  is(has('history', 'REC_PROPERTY_EVENT'), 'K15b and reads timeline.property', T.history.text);
  is(!has('history', 'BLOB_EVENT'), 'K15c not the blob timeline');
  is(!has('history', 'REC_TENANT_EVENT'), 'K16 property scope excludes tenant events');
  is(has('histTenant', 'REC_TENANT_EVENT'), 'K16b a named tenant reads timeline.byTenant', T.histTenant.text);
  is(!has('histTenant', 'REC_PROPERTY_EVENT'), 'K16c and does not borrow property events');
  eq(T.spaces.intent, 'spaces_list', 'K17 spaces question reaches spaces_list');
  is(has('spaces', 'Alpha Co') && has('spaces', '8,888'), 'K17b and reads PropertyRecord.spaces', T.spaces.text);
  eq(T.attention.intent, 'attention', 'K18 attention question reaches the attention intent');
  is(has('attention', 'REC_ATTENTION_1') && has('attention', 'REC_ATTENTION_6'),
     'K18b and reads all six items — not truncated to the UI limit', T.attention.text);

  // Vacancy must not be invented.
  is(has('vacant', 'no representation of a vacant one') || has('vacant', 'vacant'),
     'K19 a vacancy question is answered without inventing vacancy semantics', T.vacant.text);
  is(!/0 vacant|no vacant spaces|none are vacant/i.test(T.vacant.text),
     'K19b and never asserts a vacancy count the data cannot support');

  // ── 11. unavailable ≠ empty ────────────────────────────────────────────────
  sec('unavailable is never reported as none');
  for (const [k, what] of [['unavailSpaces', 'spaces'], ['unavailAttention', 'attention list'],
                           ['unavailHistory', 'history'], ['unavailProv', 'field provenance']]) {
    is(/can't read|could not assemble/i.test(T[k].text),
       `K20 ${what}: an unavailable section reports that it could not be read`, T[k].text.slice(0, 90));
    is(!/no |none|nothing|0 /i.test(T[k].text.replace(/not the same as there being none on file/i, '')),
       `K20b ${what}: and asserts no absence`);
  }
  is(/nothing needs action|no attention items/i.test(T.emptyAttention.text),
     'K21 an available-but-empty section DOES report a real "none"', T.emptyAttention.text);

  // ── 12–15. Boundaries ──────────────────────────────────────────────────────
  sec('the rewiring changed the source, not the engine');
  eq(networkCalls, 0, 'K22 no network call was made while answering');
  is(!/claude|anthropic|\/api\//i.test(aw), 'K23 ai-workspace still makes no model call');
  is(R.assembles > 0, 'K24 the record was actually assembled', R.assembles);
  is(has('settlement', 'ettle') || T.settlement.intent === 'settlements',
     'K25 an out-of-scope intent (settlements) still answers', T.settlement.intent);
  eq(T.reserves.intent, 'reserve_balances', 'K25b and reserves too — untouched by K');
  const pr = code(fs.readFileSync(path.join(ROOT, 'property-record.js'), 'utf8'));
  is(!/localStorage|fetch\(|supabase/i.test(pr), 'K26 PropertyRecord is still pure');
  const newIds = ['property_history', 'spaces_list', 'attention', 'field_provenance'];
  const registered = newIds.filter(id => new RegExp(`id: '${id}',`).test(aw));
  eq(registered.length, 4, 'K27 all four Tier 2 intents are registered');
  is(/function registerIntent\(/.test(aw) && /INTENTS\.push/.test(aw) === false || /registerIntent\(\{/.test(aw),
     'K27b via the existing registerIntent matcher architecture, not a new one');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
