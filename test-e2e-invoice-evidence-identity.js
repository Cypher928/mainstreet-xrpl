// test-e2e-invoice-evidence-identity.js
// ============================================================================
// ONE REGISTER DECIDES WHAT AN INVOICE IS.
//
// The pilot smoke test on Cascade Commons showed one finding stating two
// different amounts, three lines apart:
//
//   Key Findings        "the entire CAM expense pool of $188,300.00 cannot be
//                        independently verified"
//   Financial Exposure  "$105,350 of the pool flagged for documentation"
//
// Both came from the SAME finding. deriveExposure de-duplicates impact items by
// id and keeps the largest — correct, and what makes one invoice named by
// several findings count once. But every invoice-scoped detector keyed its
// items `invoice:<vendorName>`, and a vendor name is not an invoice. Cascade
// bills 26 invoices from 10 vendors — four quarterly utility bills, four
// janitorial, four management — so 16 of the 26 shared an id and the max
// quietly discarded $82,950.
//
// TWO OBVIOUS FIXES ARE BOTH WRONG, and this suite exists to keep them out.
//
//   Keying on the record's `id` (fixture B): invoiceData rows carry no id until
//   PropertyOS.ensureInvoiceIds runs, and the upload path never calls it. Every
//   freshly uploaded invoice keys on `invoice:undefined` and the pool collapses
//   to its single largest invoice — $7,800 of $20,700, measured.
//
//   Keying on a position (fixtures C2/C3): the detectors do not read one array.
//   Concentration walks lastInvoicesFull, the documentation detectors walk
//   invoiceData, and those hold different objects for the same invoice. A
//   position in one array means nothing in the other.
//
// So identity is resolved against ONE register — invoiceData — and fixture F
// pins the rule that matters when resolution is not certain: an unresolvable
// row must NOT be given an invented identity. Two identities for one invoice
// double-count, which is how $110,000 of a $67,300 pool was once reported; the
// vendor-scoped fallback merges instead, which under-states and is safe.
//
// FIXTURES ARE BUILT SO RIGHT AND WRONG DIFFER. Same-vendor invoices carry
// DIFFERENT amounts; with equal amounts the vendor-keyed and invoice-keyed
// totals coincide and a broken build passes. A is $33,100 correct against
// $18,100 vendor-collapsed.
//
// D is the negative control on the part that must NOT change — two findings
// naming one invoice still collapse to one amount.
//
// Run: node test-e2e-invoice-evidence-identity.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8956;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const eqMoney = (got, want, label, extra) =>
  (Math.abs(Number(got) - want) < 0.005)
    ? ok(`${label} = $${want.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    : bad(label, `expected $${want} got $${got}${extra ? ' · ' + extra : ''}`);

const DB = `
(function(){
  var U={id:'disclosure-tester',email:'pm@example.com'};
  function P(v){return Promise.resolve(v);}
  function store(){try{return JSON.parse(localStorage.getItem('__mockdb')||'{}');}catch(e){return {};}}
  function put(s){localStorage.setItem('__mockdb',JSON.stringify(s));}
  function tbl(n){var s=store();s[n]=s[n]||[];return s[n];}
  function save(n,r){var s=store();s[n]=r;put(s);}
  function uuid(){return 'p'+Math.random().toString(16).slice(2,10)+'-1111-4000-a000-'+Date.now().toString(16);}
  function q(name){var filters=[],single=false;
    var api={select:function(){return api;},eq:function(k,v){filters.push([k,v]);return api;},
      neq:function(){return api;},is:function(){return api;},not:function(){return api;},
      order:function(){return api;},limit:function(){return api;},ilike:function(){return api;},
      in:function(){return P({data:[],error:null});},
      single:function(){single=true;return run();},
      insert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        var made=arr.map(function(x){var c=Object.assign({},x);if(!c.id)c.id=uuid();rows.push(c);return c;});
        save(name,rows);var p=P({data:made,error:null});
        p.select=function(){var q2=P({data:made,error:null});q2.single=function(){return P({data:made[0],error:null});};return q2;};return p;},
      upsert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        arr.forEach(function(x){var i=rows.findIndex(function(y){return y.id===x.id;});if(i>=0)rows[i]=Object.assign({},rows[i],x);else rows.push(Object.assign({},x));});
        save(name,rows);var p=P({data:arr,error:null});
        p.select=function(){var q2=P({data:arr,error:null});q2.single=function(){return P({data:arr[0],error:null});};return q2;};return p;},
      update:function(){return P({data:null,error:null});},
      delete:function(){return {eq:function(){return P({error:null});}};},
      then:function(f){return run().then(f);}};
    function run(){var rows=tbl(name).filter(function(r){return filters.every(function(f){return r[f[0]]===f[1];});});
      if(single)return P(rows.length?{data:rows[0],error:null}:{data:null,error:{message:'no rows'}});
      return P({data:rows,error:null});}
    return api;}
  window.supabase={createClient:function(){return {auth:{
    getUser:function(){return P({data:{user:U},error:null});},
    getSession:function(){return P({data:{session:{user:U}},error:null});},
    onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:U});},40);return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return P({error:null});}
  },rpc:function(){return P({data:null,error:null});},
    from:function(n){return q(n);},
    storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;
// One place the fixtures describe an invoice. `id: null` means "as the upload
// path leaves it" — no id stamped yet.
const INV = (id, vendor, amount, date) => ({ id, vendorName: vendor, amount,
                                             category: 'utilities', invoiceDate: date });

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  await p.addInitScript('window.__TEST_AUTHED=true;');
  await p.addInitScript(DB);
  await p.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.route('**/api/**',    r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);

  // The detectors read the global invoiceData, which is what the upload path
  // fills. `foreign` seeds lastInvoicesFull with SEPARATE objects, the way
  // runAllocation leaves it, so the concentration detector is exercised across
  // the array boundary rather than on the register rows themselves.
  const measure = (rows, foreign) => p.evaluate(({ rows, foreign }) => {
    invoiceData.splice(0, invoiceData.length);
    rows.forEach(r => {
      const rec = { vendorName: r.vendorName, amount: r.amount, category: r.category,
                    invoiceDate: r.invoiceDate, confidence: {}, _error: null };
      if (r.id != null) rec.id = r.id;
      if (r.fileName) rec.fileName = r.fileName;
      invoiceData.push(canonicaliseInvoiceAmount(rec));
    });
    const gross = invoiceData.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    // distinct objects, deliberately missing the fields Test 3 showed missing
    lastInvoicesFull = (foreign || rows).map(r => ({
      vendorName: r.vendorName, vendor: r.vendorName,
      amount: r.amount, category: r.category,
    }));
    lastCamPool = gross; lastTotal = gross;
    const summary = buildAuditSummary([], invoiceData, gross);
    const exp = window.AuditExposure.deriveExposure(summary, gross);
    const find = (re) => (summary.red || []).concat(summary.yellow || [])
      .find(f => re.test(f.title || '')) || null;
    const md = find(/missing source document/);
    const ud = find(/missing invoice date/);
    const cc = find(/Unusually large invoice/);
    const ids = (f) => (f && f.impact && f.impact.items) ? f.impact.items.map(i => i.id) : [];
    return {
      gross,
      poolUnsubstantiated: exp.poolUnsubstantiated,
      poolConcentration: exp.poolConcentration,
      poolFlagged: exp.poolFlagged,
      exceedsPool: exp.exceedsPool,
      unquantified: exp.unquantified,
      missingTitle: md ? md.title : null,
      missingDeclared: md && md.impact ? md.impact.amount : null,
      missingIds: ids(md), missingDistinct: new Set(ids(md)).size,
      undatedIds: ids(ud), concIds: ids(cc),
      concTitle: cc ? cc.title : null,
      sharedMissingUndated: ids(md).filter(x => ids(ud).indexOf(x) >= 0),
      sharedMissingConc:    ids(md).filter(x => ids(cc).indexOf(x) >= 0),
    };
  }, { rows, foreign });

  // ══ A · SAME VENDOR, DIFFERENT INVOICES ══════════════════════════════════
  sec('A · three bills from one vendor are three sums of money');
  const A = await measure([
    INV('a1', 'Austin Energy',       7200, '2025-03-31'),
    INV('a2', 'Austin Energy',       7800, '2025-06-30'),
    INV('a3', 'Austin Energy',       8600, '2025-09-30'),
    INV('a4', 'PavePro Inc',         5700, '2025-04-22'),
    INV('a5', 'BrightPath Electric', 3800, '2025-05-15'),
  ]);
  console.log('  ids: ' + JSON.stringify(A.missingIds));
  eqMoney(A.gross, 33100, 'fixture gross');
  eqMoney(A.poolUnsubstantiated, 33100, 'undocumented pool', 'vendor-collapsed would be 18100');
  (A.poolUnsubstantiated !== 18100)
    ? ok('the vendor-collapsed figure ($18,100) is not what is reported')
    : bad('items are still keyed by vendor name', JSON.stringify(A));
  (A.missingDistinct === 5)
    ? ok('five invoices produce five distinct impact ids')
    : bad('impact ids collapsed', `${A.missingDistinct} distinct from ${A.missingIds.length}`);
  (A.missingDeclared === A.poolUnsubstantiated)
    ? ok('the amount the finding declares equals the amount the exposure reports')
    : bad('the finding still contradicts its own exposure',
          `declared ${A.missingDeclared} vs exposed ${A.poolUnsubstantiated}`);
  /^5 of 5 invoices missing source document$/.test(A.missingTitle || '')
    ? ok('the finding text is unchanged: "' + A.missingTitle + '"')
    : bad('the finding title moved', String(A.missingTitle));

  // ══ B · NO ID AT ALL — THE UPLOAD PATH ═══════════════════════════════════
  sec('B · invoices with no id, as the upload path leaves them');
  const B = await measure([
    INV(null, 'Austin Energy', 7200, '2025-03-31'),
    INV(null, 'Austin Energy', 7800, '2025-06-30'),
    INV(null, 'PavePro Inc',   5700, '2025-04-22'),
  ]);
  console.log('  ids: ' + JSON.stringify(B.missingIds));
  eqMoney(B.poolUnsubstantiated, 20700, 'undocumented pool with no ids present',
          'a bare `invoice:${i.id}` would report 7800');
  (B.missingDistinct === 3)
    ? ok('three id-less invoices still produce three distinct ids')
    : bad('id-less invoices collapsed onto one key', JSON.stringify(B.missingIds));
  (B.missingIds.every(x => !/undefined/.test(String(x))))
    ? ok('no impact id is "invoice:undefined"')
    : bad('an id-less invoice keyed on undefined', JSON.stringify(B.missingIds));

  // ══ C · ONE INVOICE, TWO FINDINGS ════════════════════════════════════════
  sec('C · an invoice that is both undocumented and undated is one sum');
  const C = await measure([
    INV('c1', 'Austin Energy', 7200, '2025-03-31'),
    INV('c2', 'Austin Energy', 7800, ''),
    INV('c3', 'PavePro Inc',   5700, '2025-04-22'),
  ]);
  eqMoney(C.poolUnsubstantiated, 20700, 'pool counting the shared invoice once',
          'double-counting it would give 28500');
  (C.sharedMissingUndated.length === 1)
    ? ok('both detectors give that invoice the same id: ' + C.sharedMissingUndated[0])
    : bad('the detectors disagree on the invoice id', JSON.stringify(C));

  sec('C2 · the same with no ids — where a positional identity diverges');
  const C2 = await measure([
    INV(null, 'Austin Energy', 7200, '2025-03-31'),
    INV(null, 'Austin Energy', 7800, ''),
    INV(null, 'PavePro Inc',   5700, '2025-04-22'),
  ]);
  console.log('  missing: ' + JSON.stringify(C2.missingIds));
  console.log('  undated: ' + JSON.stringify(C2.undatedIds));
  eqMoney(C2.poolUnsubstantiated, 20700, 'pool with id-less invoices in both findings',
          'a per-detector index would report 21300');
  (C2.sharedMissingUndated.length === 1 && C2.undatedIds[0] === C2.missingIds[1])
    ? ok('the undated invoice carries one identity in both: ' + C2.undatedIds[0])
    : bad('identities diverged', JSON.stringify(C2));

  // C2 alone still lets a positional identity pass: when every invoice is
  // undocumented the filtered subset and the register line up. One documented
  // invoice shifts the subset and they part company.
  sec('C3 · one invoice documented, so a position-derived identity diverges');
  const C3 = await measure([
    { id: null, vendorName: 'Austin Energy', amount: 7200, category: 'utilities',
      invoiceDate: '2025-03-31', fileName: 'austin-q1.pdf' },
    INV(null, 'Austin Energy', 7800, ''),
    INV(null, 'PavePro Inc',   5700, '2025-04-22'),
  ]);
  console.log('  missing: ' + JSON.stringify(C3.missingIds) + '  (' + C3.missingTitle + ')');
  console.log('  undated: ' + JSON.stringify(C3.undatedIds));
  eqMoney(C3.poolUnsubstantiated, 13500, 'pool over the two undocumented invoices',
          'a per-detector index would report 15600');
  (C3.missingIds.every(x => !/\|7200\|/.test(String(x))))
    ? ok('the documented invoice does not appear among the undocumented ids')
    : bad('the documented invoice leaked in', JSON.stringify(C3.missingIds));
  (C3.sharedMissingUndated.length === 1 && /Austin Energy\|7800\|/.test(String(C3.undatedIds[0])))
    ? ok('the undated invoice carries one identity in both: ' + C3.undatedIds[0])
    : bad('identities diverged', JSON.stringify(C3));

  // ══ E · ACROSS THE ARRAY BOUNDARY ════════════════════════════════════════
  // Concentration reads lastInvoicesFull; the documentation detectors read
  // invoiceData. This is the Test 3 shape in miniature: the foreign row has no
  // id and no date, so it can only be tied to the register by vendor + amount.
  sec('E · concentration and missing-docs agree across the two arrays');
  const E = await measure([
    INV('e1', 'MainStreet CAM Validation', 55000, '2026-02-10'),
    INV('e2', 'Alpha Landscaping',          4200, '2026-03-01'),
    INV('e3', 'Beta Janitorial',            3100, '2026-03-02'),
  ]);
  console.log('  concentration: ' + JSON.stringify(E.concIds) + '  (' + E.concTitle + ')');
  console.log('  missing-docs : ' + JSON.stringify(E.missingIds));
  (E.concIds.length === 1)
    ? ok('the concentration finding fired on the $55,000 invoice')
    : bad('no concentration finding — fixture no longer exercises the boundary', JSON.stringify(E));
  (E.sharedMissingConc.length === 1)
    ? ok('the foreign row resolved to the register row: ' + E.sharedMissingConc[0])
    : bad('concentration and missing-docs gave one invoice two identities',
          `conc=${JSON.stringify(E.concIds)} missing=${JSON.stringify(E.missingIds)}`);
  eqMoney(E.poolFlagged, 62300, 'union across both axes', 'double-counting gives 117300');
  (E.exceedsPool === false)
    ? ok('the union does not exceed the pool')
    : bad('expense-side total exceeds the pool — double counting', JSON.stringify(E));

  // ══ F · AMBIGUITY IS NOT GUESSED AT ══════════════════════════════════════
  // Two id-less register rows identical in vendor AND amount cannot be told
  // apart from a foreign row carrying only those two fields. The rule is that
  // an unresolvable row keeps the old vendor-scoped key — which merges, and so
  // under-states — rather than being handed an invented identity that could
  // double-count against another detector.
  sec('F · an invoice that cannot be resolved uniquely is not given a false identity');
  const F = await measure([
    INV(null, 'Twin Vendor', 9000, '2025-01-05'),
    INV(null, 'Twin Vendor', 9000, '2025-07-05'),   // same vendor AND amount
    INV(null, 'Solo Vendor', 4000, '2025-02-02'),
  ], [
    { vendorName: 'Twin Vendor', amount: 9000, category: 'utilities' },
  ]);
  console.log('  missing: ' + JSON.stringify(F.missingIds));
  console.log('  concentration: ' + JSON.stringify(F.concIds) + '  (' + F.concTitle + ')');
  (F.missingDistinct === 3)
    ? ok('the register still tells its own two twin rows apart (different dates)')
    : bad('register rows collapsed', JSON.stringify(F.missingIds));
  (F.concIds.length === 0)
    ? ok('the unresolvable row carries no priced impact — no invented identity')
    : bad('an unresolvable row was given a guessed identity', JSON.stringify(F.concIds));
  (F.poolConcentration === 0)
    ? ok('and contributes nothing to the concentration total')
    : bad('unresolvable dollars were priced anyway', String(F.poolConcentration));
  (F.exceedsPool === false)
    ? ok('so the union cannot exceed the pool')
    : bad('the fallback double-counted', JSON.stringify(F));
  (F.unquantified >= 1)
    ? ok('it is reported as not-yet-quantified rather than as zero')
    : bad('the ambiguity vanished instead of being surfaced', JSON.stringify(F));

  // ══ D · THE MAX-DEDUPE ITSELF IS UNCHANGED ═══════════════════════════════
  sec('D · deriveExposure still collapses two findings naming one invoice');
  const D = await p.evaluate(() => {
    const AX = window.AuditExposure;
    const f = (title, amt) => ({ severity: 'yellow', title,
      impact: { amount: amt, kind: 'unsubstantiated',
                items: [{ id: 'invoice:same-one', amount: amt }] } });
    const x = AX.deriveExposure({ red: [], yellow: [f('a', 4000), f('b', 9000)], green: [] }, 20000);
    return { poolUnsubstantiated: x.poolUnsubstantiated };
  });
  eqMoney(D.poolUnsubstantiated, 9000, 'one id across two findings', 'summing would give 13000');

  // ══ G · THE DEMO, END TO END ═════════════════════════════════════════════
  sec('G · Cascade Commons — the reported case, through the real screen');
  const G = await p.evaluate(async () => {
    await loadDemo();
    await new Promise(r => setTimeout(r, 7000));
    const d = (_props || []).find(x => /Cascade/i.test(x.name || ''));
    await selectProperty(d.id);
    await new Promise(r => setTimeout(r, 3000));
    const AX = window.AuditExposure;
    const summary = buildAuditSummary(lastResults || [], invoiceData || [], lastTotal || 0);
    const exp = AX.deriveExposure(summary, lastTotal || 0);
    const md = (summary.red || []).find(f => /missing source document/.test(f.title || ''));
    const rdy = AX.billingReadiness(exp);
    return {
      invoices: (invoiceData || []).length,
      vendors: new Set((invoiceData || []).map(i => i.vendorName)).size,
      title: md ? md.title : null, severity: md ? md.severity : null,
      poolFlagged: exp.poolFlagged, totalPool: exp.totalPool,
      excludedRecoverable: exp.excludedRecoverable,
      confirmedAtRisk: exp.confirmedAtRisk, requiringReview: exp.requiringReview,
      unquantified: exp.unquantified, counts: exp.counts, exceedsPool: exp.exceedsPool,
      allocation: (lastResults || []).reduce((s, r) => s + (r.allocatedAmount || 0), 0),
      capAdj: (lastResults || []).reduce((s, r) => s + (r.capAdjustment || 0), 0),
      canBill: rdy.canBill,
      billableTenants: (lastResults || [])
        .filter(r => AX.billingReadiness(exp, r.tenantName).canBill).length,
      tenants: (lastResults || []).length,
      sentence: AX.describeExposure(exp),
    };
  });
  console.log('  ' + G.invoices + ' invoices from ' + G.vendors + ' vendors');
  console.log('  ' + G.sentence);
  (G.title === '26 of 26 invoices missing source document' && G.severity === 'red')
    ? ok('the 26/26 finding is unchanged and still red')
    : bad('the finding moved', `${G.title} / ${G.severity}`);
  eqMoney(G.poolFlagged, 188300, 'flagged pool', 'was 105350 before the fix');
  eqMoney(G.totalPool, 188300, 'total invoiced');
  eqMoney(G.allocation, 88776.77, 'tenant allocation');
  eqMoney(G.capAdj, 75548.60, 'cap reductions');
  eqMoney(G.excludedRecoverable, 75548.60, 'excluded or recovered');
  eqMoney(G.confirmedAtRisk, 0, 'requiring lease verification');
  eqMoney(G.requiringReview, 0, 'requiring review');
  (G.unquantified === 7) ? ok('7 findings not yet quantified')
                         : bad('unquantified count moved', String(G.unquantified));
  (G.counts.red === 1 && G.counts.yellow === 8 && G.counts.green === 2)
    ? ok('finding counts unchanged: 1 red · 8 yellow · 2 green')
    : bad('finding counts moved', JSON.stringify(G.counts));
  (G.exceedsPool === false) ? ok('the exposure does not exceed the pool')
                            : bad('exceedsPool set on the demo', JSON.stringify(G));
  (G.canBill === false && G.billableTenants === 0 && G.tenants === 5)
    ? ok('billing gate unchanged: 0 of 5 tenants billable')
    : bad('the billing gate moved', JSON.stringify(G));

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
