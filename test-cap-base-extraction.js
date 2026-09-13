'use strict';
/**
 * test-cap-base-extraction.js — S4: the lease may state a cap base; nothing else may.
 *
 *   node test-cap-base-extraction.js
 *
 * WHAT S4 ADDED
 * -------------
 * /api/claude's extraction contract had no key for the dollar operand of a CAM
 * ceiling. capBaseAmount reached a tenant only by hand, which is why all eleven
 * in pilot resolve manually_entered and why the field sat outside the evidence
 * model until S1. The contract now asks for `cap_base_amount` and, beside it in
 * the parallel `quotes` channel, the clause that states it.
 *
 * THE INVARIANT THIS SUITE EXISTS FOR
 * -----------------------------------
 * S1 moved this field's floor from `ai_extracted` to `manually_entered`, on the
 * proven ground that no extraction path could supply one. S4 makes that ground
 * shift — so the two have to be reconciled, or S1's honesty guarantee inverts.
 *
 * The reconciliation is a gate in the normalizer: a cap base is accepted ONLY
 * when the model also returned the clause. With a quote it becomes an evidence
 * snapshot and resolves `lease_confirmed`. Without one it is DISCARDED before it
 * reaches the tenant. So the floor stays truthful — anything resting on it was
 * genuinely typed by a person, because the extraction path cannot deposit a
 * quote-less base at all.
 *
 * That is what Group C tests, and it is the assertion that matters most: the
 * prompt asking the model not to guess is a request, and a request is not a
 * guarantee.
 */

let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8861;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json' };

const MOCK = `(function(){var u={id:'t',email:'t@t.local'};function P(v){return Promise.resolve(v);}
function q(){var o={select:function(){return o;},insert:function(r){return P({data:r,error:null});},
upsert:function(r){return P({data:[r],error:null});},update:function(){return P({data:null,error:null});},
delete:function(){return {match:function(){return P({error:null});},eq:function(){return P({error:null});}};},
match:function(){return P({error:null});},eq:function(){return o;},neq:function(){return o;},
in:function(){return P({data:[],error:null});},is:function(){return o;},order:function(){return o;},
limit:function(){return o;},ilike:function(){return o;},single:function(){return P({data:null,error:null});},
then:function(f){return P({data:[],error:null}).then(f);}};return o;}
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
/** Comments must never satisfy a source assertion — this file names what it forbids. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

// A short lease that DOES state a baseline, so the clause is real text.
const LEASE = `MAPLE PLAZA COMMERCIAL LEASE. Tenant: Maple Coffee Co.
7. Caps on Expenses. CAM increases are capped at five percent (5%) annually over
the prior year's Common Area Maintenance charges, which the parties agree were
Twenty-Six Thousand Dollars ($26,000.00) for calendar year 2023.`;

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

  // ROUTE ORDER MATTERS: Playwright gives precedence to the LAST matching route
  // registered, so the catch-all goes first and the specific stub second.
  // Registered the other way round, '**/api/**' swallows every extraction call
  // and the model reply never arrives.
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  // The extraction stub. The reply lives in NODE state, not page state: the
  // handler runs while the page is blocked inside fetch(), and awaiting
  // page.evaluate() there is a deadlock waiting to happen.
  let MODEL_REPLY = {}, LAST_PROMPT = '';
  await page.route('**/api/claude', (r) => {
    let sent = {}; try { sent = JSON.parse(r.request().postData() || '{}'); } catch (_e) {}
    LAST_PROMPT = (sent.messages && sent.messages[0] && sent.messages[0].content) || '';
    return r.fulfill({ status: 200, contentType: 'application/json',
                       body: JSON.stringify(MODEL_REPLY) });
  });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#appContent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  /** Run the REAL callClaudeForLease against a controlled model reply. */
  const extract = async (reply, text) => {
    MODEL_REPLY = reply;
    return page.evaluate(async ({ text }) => {
    const out = await callClaudeForLease(text, 'lease.pdf');
    const t = Array.isArray(out) ? out[0] : out;
    if (!t) return { none: true };
    const snaps = (t.fieldEvidence && t.fieldEvidence.cap_base_amount
                   && t.fieldEvidence.cap_base_amount.snapshots) || [];
    const prov = window.FieldProvenance.fieldProvenance('cap_base_amount', t,
                                                        { value: t.capBaseAmount });
    return {
      capBaseAmount: t.capBaseAmount === undefined ? '__undefined__' : t.capBaseAmount,
      cap: t.cap,
      snapCount: snaps.length,
      snapValue: snaps[0] ? snaps[0].value : null,
      snapQuote: snaps[0] ? snaps[0].quote : null,
      state: prov.state, cited: prov.cited, quote: prov.quote, sourceFile: prov.sourceFile,
      capSnaps: ((t.fieldEvidence && t.fieldEvidence.cap && t.fieldEvidence.cap.snapshots) || []).length,
    };
    }, { text });
  };

  const QUOTE = 'the prior year\'s Common Area Maintenance charges … were Twenty-Six Thousand Dollars ($26,000.00)';

  // ── A. The contract asks for it, and asks for the clause ──────────────────
  sec('A. The extraction contract carries the field and its quote');
  {
    await extract({ tenant_name: 'X' }, LEASE);
    const prompt = LAST_PROMPT;
    is(/"cap_base_amount":\s*number or null/.test(prompt),
       'A1 the JSON shape asks for cap_base_amount as a number');
    is(/"quotes":[^}]*"cap_base_amount":\s*string\|null/.test(prompt),
       'A2 and the parallel quotes channel asks for its clause');
    is(/CAP BASE AMOUNT:/.test(prompt), 'A3 the prompt has a dedicated instruction block');
    is(/NEVER derive it/.test(prompt), 'A4 which forbids deriving it');
    for (const forbidden of ['cap percentage', 'base rent', 'square footage']) {
      is(new RegExp(forbidden.replace(/ /g, '\\s'), 'i').test(prompt),
         'A5 and names ' + forbidden + ' among the sources it may not compute from');
    }
    is(/base YEAR[^.]*without stating that year's dollar amount has NO cap base/i.test(prompt),
       'A6 a base year with no figure is explicitly not a cap base');
    is(/Null is the correct and expected answer for most leases/.test(prompt),
       'A7 and null is stated to be the normal answer');
  }

  // ── B. A quoted base is extracted and becomes evidence ────────────────────
  sec('B. A stated, quoted base becomes lease-confirmed evidence');
  {
    const r = await extract({
      tenant_name: 'Maple Coffee Co', sqft: 3000, cam_cap: 5,
      cap_base_amount: 26000,
      quotes: { cam_cap: 'capped at five percent (5%)', cap_base_amount: QUOTE },
    }, LEASE);
    eq(r.capBaseAmount, 26000, 'B1 the base reaches the tenant as a number');
    eq(r.snapCount, 1,         'B2 with exactly one evidence snapshot');
    eq(r.snapValue, 26000,     'B3 the snapshot carries the VALUE, not null');
    is(String(r.snapQuote).includes('Twenty-Six Thousand'),
       'B4 and the verbatim clause', String(r.snapQuote).slice(0, 40));
    eq(r.state, 'lease_confirmed', 'B5 so it resolves lease_confirmed — never the floor');
    eq(r.cited, true,              'B6 cited');
    is(!!r.quote,                  'B7 carrying its clause into the provenance');
    eq(r.capSnaps, 1,              'B8 and the cap percentage beside it is unaffected');
  }

  // ── C. THE GATE: no quote, no base ────────────────────────────────────────
  sec('C. A base with no clause is discarded, not floored');
  {
    const noQuote = await extract({
      tenant_name: 'Maple Coffee Co', cam_cap: 5, cap_base_amount: 26000,
      quotes: { cam_cap: 'capped at five percent (5%)', cap_base_amount: null },
    }, LEASE);
    eq(noQuote.capBaseAmount, null, 'C1 an UNQUOTED base never reaches the tenant');
    eq(noQuote.snapCount, 0,        'C2 and writes no evidence');
    eq(noQuote.state, 'unknown',    'C3 the field reads unknown — the lease did not state one');
    is(noQuote.state !== 'manually_entered',
       'C4 and NOT manually_entered — no person typed it, so the floor must not claim one');
    is(noQuote.state !== 'ai_extracted',
       'C5 nor ai_extracted — S1\'s guarantee survives S4');

    for (const [label, q] of [['empty string', ''], ['whitespace', '   ']]) {
      const r = await extract({
        tenant_name: 'X', cam_cap: 5, cap_base_amount: 26000,
        quotes: { cap_base_amount: q },
      }, LEASE);
      eq(r.capBaseAmount, null, 'C6 a ' + label + ' quote is no quote');
    }
    const noQuotesObj = await extract({
      tenant_name: 'X', cam_cap: 5, cap_base_amount: 26000,
    }, LEASE);
    eq(noQuotesObj.capBaseAmount, null, 'C7 a reply with no quotes object at all yields no base');
  }

  // ── D. Absence and nonsense stay absent ───────────────────────────────────
  sec('D. Null is a real answer, and junk is not a number');
  {
    const none = await extract({
      tenant_name: 'X', cam_cap: 5, cap_base_amount: null,
      quotes: { cap_base_amount: QUOTE },
    }, LEASE);
    eq(none.capBaseAmount, null, 'D1 a null base stays null even WITH a quote');
    eq(none.state, 'unknown',    'D2 and reads unknown');

    for (const [label, v] of [['zero', 0], ['negative', -100], ['a string', 'twenty-six thousand'],
                              ['NaN-ish', 'n/a'], ['an object', { amount: 26000 }]]) {
      const r = await extract({
        tenant_name: 'X', cam_cap: 5, cap_base_amount: v,
        quotes: { cap_base_amount: QUOTE },
      }, LEASE);
      eq(r.capBaseAmount, null, 'D3 ' + label + ' is rejected as a cap base');
    }
    const strNum = await extract({
      tenant_name: 'X', cam_cap: 5, cap_base_amount: '26000',
      quotes: { cap_base_amount: QUOTE },
    }, LEASE);
    eq(strNum.capBaseAmount, 26000, 'D4 a numeric STRING is still parsed — OCR returns those');
  }

  // ── E. The gate is enforced in code, not only requested of the model ──────
  sec('E. The enforcement is in the normalizer');
  {
    const bare = code(SCRIPT);
    is(/_capBaseQuote/.test(bare) && /_capBaseAmount/.test(bare),
       'E1 the normalizer computes the quote and the value separately');
    is(/if \(!_capBaseQuote\) return null;/.test(bare),
       'E2 and returns null when the clause is missing');
    is(/capBaseAmount:\s+_capBaseAmount,/.test(bare),
       'E3 the tenant receives only the gated value');
    is(/cap_base_amount:\s+'cap_base_amount',/.test(bare),
       'E4 the quote map routes it canonically');
    is(/value:\s+normalized\[_fieldStore\(fieldKey\)\]/.test(bare),
       'E5 and the snapshot reads the value through _fieldStore');
    // Bound to the PDF function's OWN body by brace-matching. Splitting on the
    // name takes the entire rest of the file, which contains the text-path
    // additions and makes the assertion pass for the wrong reason.
    const pdfBody = (() => {
      const at = bare.indexOf('async function callClaudeWithPdfDirect');
      if (at === -1) return '';
      let d = 0; const open = bare.indexOf('{', at);
      for (let k = open; k < bare.length; k++) {
        if (bare[k] === '{') d++;
        else if (bare[k] === '}') { d--; if (d === 0) return bare.slice(open, k + 1); }
      }
      return '';
    })();
    is(pdfBody.length > 500, 'E6 the PDF-vision function body was located', String(pdfBody.length));
    is(!/cap_base_amount/.test(pdfBody),
       'E6b and it does NOT ask for a cap base — it has no quotes channel to gate on');
    is(!/"quotes"/.test(pdfBody),
       'E6c confirming that path has no quotes channel at all');
  }

  // ── F. Nothing else about the ceiling moved ───────────────────────────────
  sec('F. The downstream contract is unchanged');
  {
    const r = await page.evaluate(() => {
      const exp = _camExpectation(26000, 5, 27300);
      const noBase = _camExpectation(null, 5, 27300);
      return { expectedCam: exp.expectedCam, basis: exp.expectedCamBasis, variance: exp.variance,
               noBaseExpected: noBase.expectedCam, noBaseBasis: noBase.expectedCamBasis };
    });
    eq(r.expectedCam, 27300,      'F1 the ceiling still computes from a base and a percentage');
    eq(r.basis, 'cap_ceiling',    'F2 and is still stamped cap_ceiling');
    eq(r.variance, 0,             'F3 with the variance derived from it');
    eq(r.noBaseExpected, null,    'F4 no base still means no expectation');
    eq(r.noBaseBasis, null,       'F5 and no basis to stamp');

    const states = await page.evaluate(() => {
      const FP = window.FieldProvenance;
      const typed = { capBaseAmount: '26000', fieldEvidence: {}, reviewOverrides: {} };
      return { typed: FP.fieldProvenance('cap_base_amount', typed, { value: typed.capBaseAmount }).state,
               states: FP.STATES.length };
    });
    eq(states.typed, 'manually_entered',
       'F6 a hand-typed base still floors at manually_entered — S1/S2 untouched');
    eq(states.states, 5, 'F7 and no sixth state was invented');
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
