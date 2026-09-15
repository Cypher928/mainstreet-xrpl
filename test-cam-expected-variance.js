'use strict';
/**
 * PHASE H — expected CAM is a dollar ceiling, or it is nothing.
 *
 * THE DEFECT THIS PINS
 * --------------------
 * runFullReconciliation set `expectedCam = live.cap` — the cap PERCENTAGE — and
 * then computed `variance = actualCam - expectedCam`, subtracting a percent from
 * dollars. A tenant allocated $34,650.00 under a 5% cap reported a variance of
 * $34,645.00: essentially the entire bill, presented as the gap between what was
 * charged and what was expected. The pair was persisted to cam_reconciliations
 * (19 such rows in pilot) and rendered as the Space view's "Variance" tile, and
 * tenant-space.js re-derived the same subtraction client-side whenever a stored
 * variance was missing — so the older a record was, the more reliably it revived.
 *
 * WHAT THE TESTS ASSERT
 * ---------------------
 * The invariant, not the label. "expectedCam is a number" would have passed on
 * the defect. What has to be true is that expectedCam is the DOLLAR CEILING the
 * lease permits — capBaseAmount × (1 + cap%) — and that when no base is on file
 * there is no expectation at all. A cap percentage cannot be converted to dollars
 * without the base it applies to; that is the same line D2-2 draws, and
 * back-computing a base from the charge would only make the number agree with
 * itself.
 *
 * The magnitude check (H9) is the audit's own detector turned into a test: a
 * four-figure charge may not sit beside a single-digit "expected" amount.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8847;
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
const eq  = (a, b, m) => (a === b ? ok(m, String(a)) : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

// Strip comments before asserting on source: this suite's own prose names the
// expression it forbids, and a comment must never satisfy a code assertion.
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

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
  // Capture exactly what saveCamResults tries to persist.
  await page.route('**/api/cam-reconciliations', r => {
    let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (_e) {}
    if (r.request().method() === 'POST') {
      page.evaluate(rows => { window.__PERSISTED = rows; },
        body.rows || body.reconciliations || body).catch(() => {});
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#appContent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // ── 1. The ceiling helper ──────────────────────────────────────────────────
  sec('the ceiling is capBaseAmount × (1 + cap%), and needs both operands');
  const h1 = await page.evaluate(() => {
    const MC = window.MoneyCents;
    return {
      withBoth:   _camCeilingCents(33000, 5),
      expected:   MC.toCents(34650),
      noBase:     _camCeilingCents(null, 5),
      noPct:      _camCeilingCents(33000, null),
      baseNaN:    _camCeilingCents('not-a-number', 5),
      zeroPct:    _camCeilingCents(10000, 0),
      fractional: _camCeilingCents(33333.33, 7.5),   // D6's rounding case
    };
  });
  eq(h1.withBoth, h1.expected, 'H1  33,000 at a 5% cap gives a $34,650.00 ceiling');
  eq(h1.noBase,   null,        'H2  a cap percentage with no base yields no ceiling');
  eq(h1.noPct,    null,        'H3  a base with no cap percentage yields no ceiling');
  eq(h1.baseNaN,  null,        'H3b a non-numeric base yields no ceiling, not NaN');
  eq(h1.zeroPct,  1000000,     'H3c a 0% cap is a real ceiling equal to the base');
  eq(h1.fractional, 3583333,   'H3d the ceiling is quantised to cents where computed (D6)');

  // ── 2. The expectation ─────────────────────────────────────────────────────
  sec('expected CAM is that ceiling in dollars, or nothing at all');
  const h2 = await page.evaluate(() => ({
    capped:   _camExpectation(33000, 5, 34650),
    under:    _camExpectation(33000, 5, 30000),
    noBase:   _camExpectation(null, 5, 34650),
    noBaseHi: _camExpectation(null, 87, 66629.23),
    noActual: _camExpectation(33000, 5, null),
  }));
  eq(h2.capped.expectedCam,      34650,        'H4  expectedCam is the dollar ceiling');
  eq(h2.capped.variance,         0,            'H4b a charge at the ceiling has zero variance');
  eq(h2.capped.expectedCamBasis, 'cap_ceiling','H4c the basis is stamped, not inferred');
  eq(h2.under.variance,          -4650,        'H4d a charge under the ceiling varies by the shortfall');
  eq(h2.noBase.expectedCam,      null,         'H5  MISSING capBaseAmount produces expectedCam === null');
  eq(h2.noBase.variance,         null,         'H6  MISSING capBaseAmount produces variance === null');
  eq(h2.noBase.expectedCamBasis, null,         'H6b and no basis stamp to launder it through');
  eq(h2.noActual.variance,       null,         'H6c a ceiling with no charge yet has no variance');

  // THE INVARIANT — not "is it a number", but "is it the dollar quantity".
  const h3 = await page.evaluate(() => {
    const out = [];
    for (const [base, pct, actual] of [[33000,5,34650],[6200,8,6696],[24000,4,24960],[13000,6,13780]]) {
      const e = _camExpectation(base, pct, actual);
      out.push({ pct, base, expectedCam: e.expectedCam, variance: e.variance });
    }
    return out;
  });
  const isPct = h3.filter(r => r.expectedCam === r.pct);
  eq(isPct.length, 0, 'H7  expectedCam is NEVER the raw cap percentage');
  const wrongCeil = h3.filter(r => Math.abs(r.expectedCam - r.base * (1 + r.pct / 100)) > 0.005);
  eq(wrongCeil.length, 0, 'H7b every expectedCam equals its own base × (1 + cap%)');
  const bigVar = h3.filter(r => Math.abs(r.variance) > 1);
  eq(bigVar.length, 0, 'H7c a capped charge varies from its ceiling by ~$0, not by the whole bill');

  // ── 3. The producer ────────────────────────────────────────────────────────
  sec('runFullReconciliation reports the ceiling, and null where there is no base');
  const h4 = await page.evaluate(() => {
    const mk = (name, sqft, pct, base) =>
      new Lease(name, '', sqft, '2024-01-01', '2030-12-31', [], pct, base, false, null, 'NNN');
    const leases = [mk('Capped Co', 9200, 5, 33000), mk('Uncapped Co', 1200, 5, null)];
    const invoices = [
      { vendor: 'V1', amount: 60000, category: 'landscaping', date: '2025-06-01' },
      { vendor: 'V2', amount: 40000, category: 'utilities',   date: '2025-07-01' },
    ];
    // liveTenants is read from currentProperty(); give the ids something to match.
    const prop = { id: 'h-test', name: 'H Test', tenants: [
      { id: 'a', tenant_name: 'Capped Co',   cap: 5, capBaseAmount: 33000, leased_sqft: 9200 },
      { id: 'b', tenant_name: 'Uncapped Co', cap: 5, capBaseAmount: null,  leased_sqft: 1200 },
    ] };
    if (typeof _props !== 'undefined') {
      const i = _props.findIndex(x => x && x.id === prop.id);
      if (i >= 0) _props[i] = prop; else _props.push(prop);
      try { activePropId = prop.id; } catch (_e) {}
    }
    const res = runFullReconciliation({ leases, totalSqFt: 10400, invoices, camYear: 2025 });
    return (res || []).map(r => ({
      name: r.tenantName, actualCam: r.actualCam, expectedCam: r.expectedCam,
      variance: r.variance, basis: r.expectedCamBasis, capApplied: r.capApplied,
    }));
  });
  const capped   = h4.find(r => r.name === 'Capped Co');
  const uncapped = h4.find(r => r.name === 'Uncapped Co');
  if (!capped || !uncapped) { bad('H8  producer returned both tenants', JSON.stringify(h4)); }
  else {
    eq(capped.expectedCam, 34650,         'H8  a lease WITH a base reports its dollar ceiling');
    eq(capped.basis, 'cap_ceiling',       'H8b and stamps where that number came from');
    eq(capped.actualCam, 34650,           'H8c the cap held the charge at the ceiling');
    eq(capped.variance, 0,                'H8d so the variance is $0 — not $34,645');
    eq(uncapped.expectedCam, null,        'H9  a lease with NO base reports expectedCam null');
    eq(uncapped.variance, null,           'H9b and variance null');
    eq(uncapped.basis, null,              'H9c and carries no basis stamp');
    // The audit's own detector, as an assertion.
    const smell = h4.filter(r => r.actualCam > 1000 && r.expectedCam !== null && r.expectedCam < 100);
    eq(smell.length, 0, 'H9d no four-figure charge sits beside a single-digit "expected" amount');
    const anyIsPct = h4.filter(r => r.expectedCam === 5);
    eq(anyIsPct.length, 0, 'H9e live.cap (5) is never what expectedCam holds');
  }

  // ── 4. The persister ───────────────────────────────────────────────────────
  sec('saveCamResults cannot write a percent into the dollar column');
  const h5 = await page.evaluate(async () => {
    window.__PERSISTED = null;
    // A legacy in-memory result, exactly as the defect produced it: a percentage
    // in expectedCam, a dollars-minus-percent variance, and no basis stamp.
    const legacy = { tenantId: 'x', tenantName: 'Legacy Co', actualCam: 34650,
                     totalAllocated: 34650, expectedCam: 5, variance: 34645,
                     allocatedAmount: 34650, proRataPercent: 35.38 };
    const good   = { tenantId: 'y', tenantName: 'Fixed Co', actualCam: 34650,
                     totalAllocated: 34650, expectedCam: 34650, variance: 0,
                     expectedCamBasis: 'cap_ceiling', allocatedAmount: 34650, proRataPercent: 35.38 };
    await saveCamResults('h-test', [legacy, good], 2025, 100000);
    await new Promise(r => setTimeout(r, 250));
    return window.__PERSISTED;
  });
  if (!Array.isArray(h5)) { bad('H10 saveCamResults produced rows', 'got ' + JSON.stringify(h5)); }
  else {
    const L = h5.find(r => r.tenant_name === 'Legacy Co');
    const G = h5.find(r => r.tenant_name === 'Fixed Co');
    eq(L ? L.expected_cam : 'missing', null, 'H10 an UNSTAMPED percent is refused as expected_cam');
    eq(L ? L.variance : 'missing',     null, 'H10b and its dollars-minus-percent variance is refused too');
    eq(L ? L.actual_cam : 'missing',   34650,'H10c while the real charge is still persisted');
    eq(G ? G.expected_cam : 'missing', 34650,'H10d a STAMPED dollar ceiling persists normally');
    eq(G ? G.variance : 'missing',     0,    'H10e with its true variance');
  }

  // ── 5. The renderer ────────────────────────────────────────────────────────
  sec('the Space tile shows a variance or a dash — it never rebuilds one');
  const tsSrc = code(fs.readFileSync(path.join(ROOT, 'tenant-space.js'), 'utf8'));
  const hasFallback = /cr\.actualCam\s*[-−]\s*cr\.expectedCam/.test(tsSrc) ||
                      /actualCam\s*!=\s*null\s*&&\s*cr\.expectedCam\s*!=\s*null/.test(tsSrc);
  hasFallback
    ? bad('H11 tenant-space does NOT re-derive actualCam - expectedCam')
    : ok('H11 tenant-space does NOT re-derive actualCam - expectedCam');

  // TenantSpace exports no per-tile render hook, so the tile is asserted at its
  // source of truth: the single expression that can reach it.
  const variLine = (tsSrc.match(/var\s+vari\s*=[^;]+;/) || [''])[0].replace(/\s+/g, ' ').trim();
  /^var vari = \(cr\.variance != null\) \? cr\.variance : null;$/.test(variLine)
    ? ok('H12 the tile reads only the persisted variance', variLine)
    : bad('H12 the tile reads only the persisted variance', variLine || '(not found)');
  const dashLine = /vari == null \? '—'/.test(tsSrc);
  dashLine ? ok('H13 a legacy row with no variance renders "—"')
           : bad('H13 a legacy row with no variance renders "—"');

  // ── 6. The producer no longer reads the percentage ─────────────────────────
  sec('live.cap is not the source of expectedCam anywhere');
  const sSrc = code(fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8'));
  /expectedCam\s*=\s*live\.cap/.test(sSrc)
    ? bad('H14 `expectedCam = live.cap` is gone from script.js')
    : ok('H14 `expectedCam = live.cap` is gone from script.js');
  /:\s*\(r\.variance\s*\?\?\s*null\)/.test(sSrc)
    ? bad('H15 saveCamResults has no `?? r.variance` fallback')
    : ok('H15 saveCamResults has no `?? r.variance` fallback');

  // ── The two axes are independent ─────────────────────────────────────────
  //
  // expected_cam_basis describes the ARITHMETIC. The provenance of the base it
  // consumed is a separate fact, resolved by FieldProvenance. A correct
  // cap_ceiling can rest on a manually entered, uncited base, and MainStreet
  // has to be able to state both at once — "calculation $34,650, basis
  // cap_ceiling, base $33,000, base provenance manually_entered, lease evidence
  // none". Collapsing them in either direction is the tempting mistake:
  // discarding a correct calculation because its input is unverified, or
  // letting a stamped basis imply the input was verified.
  sec('the basis describes the calculation, not the trustworthiness of the base');
  const h16 = await page.evaluate(() => {
    const t = { id: 'x', tenant_name: 'Capped Co', cap: 5, capBaseAmount: 33000,
                leased_sqft: 9200, fieldEvidence: {}, reviewOverrides: {} };
    const prov = window.FieldProvenance.fieldProvenance('cap_base_amount', t,
                                                        { value: t.capBaseAmount });
    const exp  = _camExpectation(t.capBaseAmount, t.cap, 34650);
    return { state: prov.state, cited: prov.cited, by: prov.by,
             expectedCam: exp.expectedCam, basis: exp.expectedCamBasis, variance: exp.variance };
  });
  eq(h16.expectedCam, 34650,            'H16 the ceiling is still computed from an unverified base');
  eq(h16.basis, 'cap_ceiling',          'H16b and still stamped cap_ceiling — the math is the math');
  eq(h16.variance, 0,                   'H16c and the variance is still derived');
  eq(h16.state, 'manually_entered',     'H16d while the BASE resolves as manually entered');
  eq(h16.cited, false,                  'H16e uncited');
  eq(h16.by, null,                      'H16f and unattributed, because nothing recorded who typed it');
  h16.basis === 'cap_ceiling' && h16.state !== 'lease_confirmed'
    ? ok('H16g a correct cap_ceiling coexists with an unverified base — the axes do not collapse')
    : bad('H16g the two axes collapsed into one', JSON.stringify(h16));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
