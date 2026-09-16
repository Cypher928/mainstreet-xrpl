'use strict';
// test-e2e-northgate-billable.js
// ============================================================================
// THE PROPERTY MAINSTREET CAN BILL — the whole lifecycle, on the real page.
//
// Cascade Commons proves MainStreet knows when NOT to bill: every invoice
// lacks a source document, so a red property-wide finding holds every
// statement. Northgate Exchange is the other half of the claim. It bills
// because its evidence and its lease terms genuinely support billing, and this
// test is only worth anything if it proves that distinction rather than
// assuming it — so it ends by taking the evidence away and watching the same
// property refuse.
//
//   1 · the portfolio carries BOTH demo properties, and Cascade is untouched
//   2 · opening Northgate shows five occupied spaces and one confirmed vacancy
//   3 · the lease and invoice documents are on file and fetchable
//   4 · Prepare reports the register and the roster as ready
//   5 · Calculate succeeds — five allocations, from the live engine
//   6 · cap enforcement is visible: two caps bite, one is respected
//   7 · the exclusion changes a number, and the explanation says so
//   8 · coverage is green because the vacancy accounts for the remainder
//   9 · the verdict is billable, with no blocker, and every tenant can bill
//  10 · after a reload the results are still current and identical
//  11 · tenant results, evidence and audit surfaces all agree
//  12 · seeding again changes nothing — no duplicated spaces or invoices
//  13 · NEGATIVE: remove the source documents → the same property refuses
//  14 · NEGATIVE: make one lease Modified Gross → that tenant alone is held
//  16 · the run is actually PERSISTED — ids Postgres accepts, rows on the
//       server, still there after a reload, and no save-failed banner
//  17 · the property shows ITS OWN rendering, not Cascade's
//
//   node test-e2e-northgate-billable.js
// ============================================================================
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8999;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.png':'image/png' };
const showroom = fs.readFileSync(path.join(ROOT, 'test-e2e-demo-showroom.js'), 'utf8');
const DB_RAW = showroom.slice(showroom.indexOf('const DB = `') + 12, showroom.indexOf('`;', showroom.indexOf('const DB = `')));
const D = require('./demo-northgate.js');

// ── A DATABASE THAT REJECTS WHAT POSTGRES REJECTS ───────────────────────────
// Northgate's property id began 'ne000000-…'. `n` is not a hex digit, so that
// string is not a uuid — and properties.id, tenants.id and
// cam_reconciliations.property_id are all `uuid` columns. On a real database
// every Northgate write was refused and the manager saw "These CAM results
// weren't saved to the server" under a reconciliation that had otherwise
// worked. This suite passed throughout, because the mock stored any string it
// was handed and the stub API answered every POST with success.
//
// Two things are fixed here so the suite can fail on that defect.
//
// First, the mock user id. The demo ids are derived from the first twelve hex
// characters of the authenticated user's uuid, and 'showroom-user-…' yields
// 'showroomuser' — so under a real uuid check EVERY demo id would be invalid,
// for reasons that are the fixture's fault rather than the product's. A
// Supabase user id is always a uuid; this one now is too.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOCK_USER_OLD = "id:'showroom-user-0001-4000-a000-000000000001'";
const MOCK_USER_ID  = '7f3a2b1c-9d4e-4a5b-8c6d-0e1f2a3b4c5d';
const DB = DB_RAW.replace(MOCK_USER_OLD, `id:'${MOCK_USER_ID}'`);

// Second, a uuid constraint over the tables that have one. A rejection is
// shaped like Postgres's (SQLSTATE 22P02) and recorded, so the test can name
// the column and the value rather than only observing that something failed.
const PG_UUID = `
(function(){
  var RE=${UUID_RE.toString()};
  var COLS={properties:['id'],tenants:['id','property_id']};
  window.__pgUuidRejections=[];
  var create=window.supabase.createClient;
  window.supabase.createClient=function(){
    var c=create.apply(this,arguments), from=c.from.bind(c);
    c.from=function(n){
      var q=from(n), cols=COLS[n];
      if(!cols) return q;
      ['insert','upsert'].forEach(function(op){
        var orig=q[op].bind(q);
        q[op]=function(r){
          var arr=Array.isArray(r)?r:[r], bad=null;
          arr.forEach(function(x){cols.forEach(function(k){
            if(x&&x[k]!=null&&!RE.test(String(x[k]))&&!bad) bad={col:k,val:String(x[k])};});});
          if(!bad) return orig(r);
          window.__pgUuidRejections.push({table:n,column:bad.col,value:bad.val});
          var err={message:'invalid input syntax for type uuid: "'+bad.val+'"',code:'22P02'};
          var p=Promise.resolve({data:null,error:err});
          p.select=function(){var q2=Promise.resolve({data:null,error:err});
            q2.single=function(){return Promise.resolve({data:null,error:err});};return q2;};
          return p;
        };
      });
      return q;
    };
    return c;
  };
})();`;

let pass = 0, fail = 0;
const yes = (c, m, d) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); } else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      → ${d}` : ''}`); } };
const is  = (a, b, m) => yes(JSON.stringify(a) === JSON.stringify(b), m, `expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`);
const sec = s => console.log(`\n── ${s} ──`);

const NG = D.PROPERTY.name;

const READ = `(() => {
  const T = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  const p = currentProperty();
  const s = lastResults.length ? buildAuditSummary() : null;
  const AX = window.AuditExposure;
  const invAll = invoiceData.filter(Boolean);
  const pool = window.CamPool.total(invAll);
  const ex = s ? AX.deriveExposure(s, pool) : null;
  const rd = ex ? AX.billingReadiness(ex) : null;
  const prep = _camPrepState();
  const scope = { in:0, out:0, undated:0 }; invAll.forEach(i => { scope[camYearScopeOf(i, getCamYear())]++; });
  const rows = Array.from(document.querySelectorAll('#spacesList .tsl-row')).map(r => ({
    suite: T(r.querySelector('.tsl-suite')), tenant: T(r.querySelector('.tsl-tenant')),
    sqft: T(r.querySelector('.tsl-sqft')), status: T(r.querySelector('.tsl-status')),
    vacant: r.classList.contains('tsl-row--vacant') }));
  const facts = {}; document.querySelectorAll('#camPrepFacts .cam-fact').forEach(f => { facts[T(f.querySelector('.cam-fact-l'))] = T(f.querySelector('.cam-fact-v')); });
  const bk = _lastVarianceBreakdown || null;
  return {
    propName: p.name, propSqft: p.totalSqft, camYear: getCamYear(),
    spaces: (p.tenants||[]).length,
    vacantRows: (p.tenants||[]).filter(t => t && t.vacant === true).map(t => ({ suite: t.suite, sqft: Number(t.leased_sqft) })),
    leaseUrls: (p.tenants||[]).filter(t => t && t.vacant !== true).map(t => t.leaseUrl || null),
    invCount: invAll.length, invPool: pool,
    invWithDoc: invAll.filter(i => i.fileUrl || i.fileName).length,
    invEligible: invAll.filter(i => window.CamPool.isEligible(i)).length,
    invScope: scope,
    invDocs: invAll.map(i => i.fileUrl || null),
    prep: { ready: prep.ready, missing: prep.missing, tenants: prep.tenants.length, totalSqft: prep.totalSqft },
    prepFacts: facts,
    results: lastResults.map(r => ({ name: r.name, alloc: Math.round(r.totalAllocated*100)/100,
      pct: r.proRataPercent, cap: !!r.capApplied, capAdj: Math.round((r.capAdjustment||0)*100)/100 })),
    billed: Math.round(lastResults.reduce((a,r)=>a+(r.totalAllocated||0),0)*100)/100,
    counts: ex ? ex.counts : null,
    verdict: rd ? { canBill: rd.canBill, label: rd.label } : null,
    blockProp: ex ? (ex.blocking.property||[]).map(b => b.title) : null,
    blockTenants: ex ? Object.keys(ex.blocking.byTenant||{}) : null,
    perTenant: ex ? lastResults.map(r => ({ name: r.name, canBill: AX.billingReadiness(ex, r.name).canBill })) : null,
    red: s ? s.red.map(f => f.title) : null,
    yellow: s ? s.yellow.map(f => f.title) : null,
    green: s ? s.green.map(f => f.title) : null,
    auditGroups: (() => { const b = lastResults.length ? _camAuditBuckets() : null;
      return b ? { blocking: b.blocking.length, property: b.property.length, tenant: b.tenant.length, advisory: b.advisory.length } : null; })(),
    tableRows: Array.from(document.querySelectorAll('#resultsBody .rcs-table tbody tr')).map(tr => ({
      name: T(tr.querySelector('.rcs-name-cell')), bill: T(tr.querySelector('.rcs-bill')) })),
    bk: bk ? { uncovered: bk.uncovered, vacantPct: bk.vacantPct, vacantResolved: bk.vacantResolved,
               lines: (bk.lines||[]).map(l => l.key) } : null,
    stale: _resultsStale, unverified: _resultsUnverified,
    calcStatus: T(document.querySelector('#camStepCalculate .cam-step-status')),
  };
})()`;

(async () => {
  // The reconciliation store, standing in for the cam_reconciliations table.
  // It outlives page reloads, which is the whole point: a result that is only
  // in the browser is exactly what the save-failed banner warns about.
  let CAMDB = [];
  const json = (rs, code, body) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(body)); };

  const srv = http.createServer((rq, rs) => {
    const [u0, qs] = rq.url.split('?');
    let u = decodeURIComponent(u0); if (u === '/') u = '/index.html';

    // api/cam-reconciliations.js verifies ownership with
    // GET /properties?id=eq.<id>&user_id=eq.<uid>, treats any status >= 300 as
    // "not owned", and answers 403. A propertyId that is not a uuid makes that
    // query itself an error, which is how an invalid id became a Forbidden.
    if (u === '/api/cam-reconciliations') {
      if (rq.method === 'POST') {
        let body = '';
        rq.on('data', c => { body += c; });
        rq.on('end', () => {
          let b; try { b = JSON.parse(body || '{}'); } catch (_) { return json(rs, 400, { error: 'Bad JSON' }); }
          if (!UUID_RE.test(String(b.propertyId || ''))) {
            return json(rs, 403, { error: 'Forbidden', detail: `property ${b.propertyId} could not be verified` });
          }
          CAMDB = CAMDB.filter(r => !(r.property_id === b.propertyId && String(r.year) === String(b.year)));
          const rows = (b.rows || []).map(r => ({ ...r }));
          CAMDB = CAMDB.concat(rows);
          return json(rs, 200, { data: rows });
        });
        return;
      }
      const params = new URLSearchParams(qs || '');
      const pid = params.get('propertyId'), yr = params.get('year');
      if (pid && !UUID_RE.test(pid)) return json(rs, 403, { error: 'Forbidden' });
      return json(rs, 200, { data: CAMDB.filter(r =>
        (!pid || r.property_id === pid) && (!yr || String(r.year) === String(yr))) });
    }
    // The server's own view of what it stored, for the test only.
    if (u === '/__camdb') return json(rs, 200, { rows: CAMDB });

    if (u.startsWith('/api/')) { json(rs, 200, {}); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => { if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d); });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  for (const p of ['**cdnjs**', '**jsdelivr**']) await page.route(p, r => r.fulfill({ status: 200, body: '' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(DB);
  await page.addInitScript(PG_UUID);

  const boot = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    await page.evaluate(() => { try { MainStreetLanding.hide(); } catch (_) {} });
    await page.waitForTimeout(400);
    await page.evaluate(() => loadDemo());
    await page.waitForFunction(() => document.getElementById('mainWorkflow').style.display !== 'none'
      && typeof lastResults !== 'undefined' && lastResults.length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(2200);
  };
  // Open Northgate the way a manager would: from the portfolio card.
  const openNorthgate = async () => {
    const opened = await page.evaluate(async (name) => {
      // Back to the portfolio the way the Command Center's own control does.
      ccShowPortfolio();
      await new Promise(r => setTimeout(r, 500));
      const card = Array.from(document.querySelectorAll('.ptf-prop-card:not(.ptf-demo-card)'))
        .find(c => ((c.querySelector('.ptf-prop-name') || {}).textContent || '').includes(name));
      if (!card) return false;
      card.click();
      return true;
    }, NG);
    if (!opened) return false;
    await page.waitForFunction((n) => { const p = currentProperty(); return p && p.name === n
      && typeof lastResults !== 'undefined' && lastResults.length > 0; }, NG, { timeout: 30000 });
    await page.waitForTimeout(1800);
    return true;
  };
  const read = () => page.evaluate(READ);

  // The harness itself has to be honest before anything it measures is worth
  // reading: a fixture that quietly stopped enforcing uuids would make every
  // assertion in §16 vacuous.
  sec('0 · the fixture database enforces the constraint the real one has');
  yes(DB !== DB_RAW, 'the mock user id was replaced with a real uuid', 'the showroom fixture no longer contains ' + MOCK_USER_OLD);
  yes(UUID_RE.test(MOCK_USER_ID), 'and that replacement is itself a valid uuid');

  await boot();

  const GUARD = await page.evaluate(() => {
    // Prove the guard is live by offering it something Postgres would refuse,
    // then clear the record so a later rejection can only come from the product.
    return window.supabase.createClient().from('properties')
      .upsert({ id: 'ne000000-0000-4000-a000-abcdef012345', name: 'x' }).select('id')
      .then(r => { const seen = window.__pgUuidRejections.slice(); window.__pgUuidRejections.length = 0;
                   return { code: r.error && r.error.code, seen }; });
  });
  is(GUARD.code, '22P02', 'the fixture refuses a non-hex id with Postgres\'s own invalid-uuid error');
  is(GUARD.seen.length, 1, 'and records the refusal, so a real one cannot pass unnoticed');

  // ══ 1 · the portfolio ═════════════════════════════════════════════════════
  sec('1 · both demo properties are in the portfolio, and Cascade is untouched');
  const PORT0 = await page.evaluate(() => ({
    names: _props.map(p => p.name).sort(),
    cascade: (() => { const c = _props.find(p => /Cascade/.test(p.name || '')); return c ? {
      sqft: c.totalSqft, tenants: (c.tenants||[]).length,
      invoices: (c.invoices||[]).length,
      withDoc: (c.invoices||[]).filter(i => i && (i.fileUrl || i.fileName)).length } : null; })(),
  }));
  is(PORT0.names, ['Cascade Commons', NG].sort(), 'the portfolio holds exactly the two seeded demo properties');
  is(PORT0.cascade, { sqft: 26000, tenants: 5, invoices: 26, withDoc: 0 },
     'Cascade Commons is exactly as it was: 5 tenants, 26 invoices, none with a source document');

  // The LIVE object, before anything has been reloaded. The marker that made
  // Northgate wear Cascade's face travelled on this object as well as the
  // stored row, so both have to be checked, and the reload checks in §17 only
  // ever see the row.
  const LIVE = await page.evaluate(() => {
    const ng = _props.find(p => /Northgate/.test(p.name || ''));
    return { isDemo: window.PropertyReference.isDemo(ng), ngV: ng._ngV,
             demoVersion: ng._demoVersion ?? null, demoV: ng._demoV ?? null,
             image: (window.PropertyReference.infoFor(ng) || {}).imageUrl || null };
  });
  is(LIVE.isDemo, false, 'the freshly seeded Northgate does not read as the Cascade showroom');
  is([LIVE.demoVersion, LIVE.demoV], [null, null], 'it carries neither of Cascade\'s markers');
  is(LIVE.ngV, D.DEMO_VERSION, 'only its own, _ngV');
  is(LIVE.image, D.INFO.imageUrl, 'and it already points at its own rendering, before any reload');

  const cardOpened = await openNorthgate();
  yes(cardOpened, 'the Northgate card opens from the portfolio list, with no demo-only button');

  // ══ 2 · Spaces ════════════════════════════════════════════════════════════
  sec('2 · Spaces: five occupied suites and one confirmed vacancy');
  await page.evaluate(() => switchWorkspaceTab('spaces'));
  await page.waitForTimeout(700);
  const S = await read();
  is(S.propName, NG, 'the open property is Northgate Exchange');
  is(S.propSqft, D.PROPERTY.totalSqft, `the building is ${D.PROPERTY.totalSqft.toLocaleString()} sqft`);
  is(S.spaces, D.TENANTS.length + 1, 'six spaces: five leases and one vacancy');
  is(S.vacantRows, [{ suite: D.VACANCY.suite, sqft: D.VACANCY.leased_sqft }],
     `Suite ${D.VACANCY.suite} is recorded vacant at ${D.VACANCY.leased_sqft.toLocaleString()} sqft`);
  const vacRow = S.spaces ? null : null;
  const spaceRows = await page.evaluate(() => Array.from(document.querySelectorAll('#spacesList .tsl-row'))
    .map(r => ({ suite: (r.querySelector('.tsl-suite')||{}).textContent,
                 status: (r.querySelector('.tsl-status')||{}).textContent.trim(),
                 vacant: r.classList.contains('tsl-row--vacant') })));
  is(spaceRows.length, 6, 'the Spaces list renders six rows');
  is(spaceRows.filter(r => r.vacant).map(r => r.suite), [D.VACANCY.suite], 'exactly one row is marked vacant');
  is(spaceRows.filter(r => !r.vacant).length, 5, 'and five are occupied');

  // ══ 3 · the documents ═════════════════════════════════════════════════════
  sec('3 · lease and invoice documents are on file and really fetchable');
  is(S.leaseUrls.filter(Boolean).length, D.TENANTS.length, 'every lease points at a document');
  is(S.invWithDoc, D.INVOICES.length, `all ${D.INVOICES.length} invoices carry a source document`);
  const FETCH = await page.evaluate(async () => {
    const p = currentProperty();
    const lease = (p.tenants||[]).find(t => t && t.leaseUrl);
    const inv   = (p.invoices||[]).find(i => i && i.fileUrl);
    const one = async (u) => { try { const r = await fetch(u); return { s: r.status, t: r.headers.get('content-type') }; }
                              catch (e) { return { s: 0, t: String(e) }; } };
    return { lease: await one(lease.leaseUrl), leaseUrl: lease.leaseUrl,
             inv: await one(inv.fileUrl), invUrl: inv.fileUrl };
  });
  yes(FETCH.lease.s === 200 && /pdf/.test(FETCH.lease.t || ''), `a lease PDF fetches 200 application/pdf (${FETCH.leaseUrl})`, JSON.stringify(FETCH.lease));
  yes(FETCH.inv.s === 200 && /pdf/.test(FETCH.inv.t || ''), `an invoice PDF fetches 200 application/pdf (${FETCH.invUrl})`, JSON.stringify(FETCH.inv));

  // ══ 4 · Prepare ═══════════════════════════════════════════════════════════
  sec('4 · Prepare reports the register and the roster as ready');
  await page.evaluate(() => switchWorkspaceTab('cam'));
  await page.waitForTimeout(700);
  const P4 = await read();
  is(P4.prep.ready, true, 'Prepare is ready');
  is(P4.prep.missing, [], 'nothing is still needed');
  is(P4.prep.tenants, D.TENANTS.length, `${D.TENANTS.length} leases with a name and leased sqft — the vacancy is not counted as one`);
  is(P4.camYear, D.CAM_YEAR, `the CAM year is ${D.CAM_YEAR}`);
  is(P4.invScope, { in: D.INVOICES.length, out: 0, undated: 0 }, 'every invoice is dated inside the CAM year, none undated');
  is(P4.invEligible, D.INVOICES.length, 'and every invoice is CAM-eligible');
  is(P4.invPool, D.poolTotal(), `the pool is ${D.poolTotal().toLocaleString()}`);
  is(P4.prepFacts['With a source document'], `${D.INVOICES.length} of ${D.INVOICES.length}`, 'Prepare says every invoice has a source document');
  is(P4.prepFacts['Recorded vacant'], `1 space · ${D.VACANCY.leased_sqft.toLocaleString()} sqft · landlord absorbs`, 'and reports the recorded vacancy');

  // ══ 5–9 · Calculate and the verdict ═══════════════════════════════════════
  sec('5 · Calculate succeeds — run live, not read from the seed');
  const before = P4.results;
  await page.evaluate(async () => { await runAllocation(); await new Promise(r => setTimeout(r, 2500)); });
  const C = await read();
  is(C.results.length, D.TENANTS.length, `${D.TENANTS.length} tenants receive an allocation`);
  is(C.results, before, 'and a live re-run produces exactly the seeded figures');
  is(C.billed, 84882.25, 'total billed is $84,882.25');
  yes(C.results.every(r => r.alloc > 0), 'every allocation is a real, positive charge', JSON.stringify(C.results));
  is(C.tableRows.length, D.TENANTS.length, 'the tenant results table shows all five');

  sec('6 · cap enforcement is visible — two caps bite, one is respected');
  const capped = C.results.filter(r => r.cap).map(r => [r.name, r.capAdj]);
  is(capped, [['Ridgeline Outfitters', 2695], ['Northgate Family Dental', 689]],
     'two caps applied, with their reductions');
  const lakeside = C.results.find(r => r.name === 'Lakeside Veterinary Clinic');
  yes(lakeside && !lakeside.cap && lakeside.alloc === 18882.5,
      'the third capped lease lands inside its ceiling, so the cap is respected without reducing', JSON.stringify(lakeside));
  yes((C.yellow || []).some(t => /Cap applied to Ridgeline Outfitters/.test(t)),
      'the audit names the cap and its source', JSON.stringify(C.yellow));

  sec('7 · the exclusion changes a number and is explained');
  const cp = C.results.find(r => r.name === 'Corner Post Café');
  const mgmt = D.INVOICES.filter(i => i.category === 'management').reduce((s, i) => s + i.amount, 0);
  const noExcl = Math.round(D.poolTotal() * 8.75) / 100;
  yes(cp && Math.abs(cp.alloc - (D.poolTotal() - mgmt) * 0.0875) < 0.01,
      'the café is billed its share of the pool WITHOUT management', JSON.stringify(cp));
  yes(cp && cp.alloc < noExcl, `and that is ${(noExcl - cp.alloc).toFixed(2)} less than it would pay without the exclusion`);
  yes((C.yellow || []).some(t => /"management" excluded for 1 of 5 tenants/.test(t)),
      'the audit states the exclusion', JSON.stringify(C.yellow));

  sec('8 · coverage is green because the vacancy accounts for the remainder');
  yes((C.green || []).some(t => /Property CAM coverage: 83.8% documented · 16.3% confirmed vacant/.test(t)),
      'coverage is an advisory green finding naming the confirmed vacancy', JSON.stringify(C.green));
  yes(!(C.yellow || []).some(t => /unresolved/.test(t)), 'nothing is left unresolved', JSON.stringify(C.yellow));
  yes(C.bk && C.bk.vacantResolved === true && C.bk.vacantPct === 16.25,
      'the variance breakdown reads the vacancy as resolving the uncovered share', JSON.stringify(C.bk));

  sec('9 · the verdict is billable, with no blocker at all');
  is(C.counts.red, 0, 'no red findings');
  is(C.blockProp, [], 'no property-level blocker');
  is(C.blockTenants, [], 'and no tenant-level blocker');
  is(C.verdict, { canBill: true, label: 'Bill with review' }, 'the billing gate says the property may bill, with advisories to review');
  is(C.perTenant.filter(t => t.canBill).length, D.TENANTS.length, 'every one of the five tenants may be billed');
  yes((C.green || []).some(t => /All 16 invoices have source documents attached/.test(t)),
      'and the audit records that the pool is substantiated', JSON.stringify(C.green));

  sec('11 · tenant results, evidence and audit surfaces agree');
  is(C.auditGroups.blocking, 0, 'the audit panel has an empty Critical/blocking group');
  is(C.auditGroups.advisory, (C.green || []).length, 'its Advisory group equals the green findings');
  is(C.auditGroups.property + C.auditGroups.tenant, (C.yellow || []).length, 'and its yellow groups equal the yellow findings');
  yes(C.tableRows.every(r => !/can.t bill/i.test(r.bill || '')), 'no tenant row shows a refusal', JSON.stringify(C.tableRows));

  // ══ 10 · reload ═══════════════════════════════════════════════════════════
  sec('10 · after a full reload the reconciliation is still current and identical');
  await boot();
  yes(await openNorthgate(), 'Northgate reopens from the portfolio after the reload');
  await page.evaluate(() => switchWorkspaceTab('cam'));
  await page.waitForTimeout(700);
  const R = await read();
  is(R.results, C.results, 'every allocation is unchanged');
  is(R.billed, C.billed, 'the billed total is unchanged');
  yes(R.stale === false && R.unverified === false,
      'the restored run is CURRENT — it can account for its own inputs', JSON.stringify({ stale: R.stale, unverified: R.unverified }));
  yes(/Calculated/.test(R.calcStatus || ''), 'Calculate reads Calculated, not Re-run needed', R.calcStatus);
  is(R.verdict, C.verdict, 'the verdict survives the reload');
  is(R.counts, C.counts, 'and so do the finding counts');
  is(R.invWithDoc, D.INVOICES.length, 'every invoice still carries its source document');
  is(R.vacantRows, S.vacantRows, 'the recorded vacancy survives');

  // ══ 12 · idempotency ══════════════════════════════════════════════════════
  sec('12 · seeding again changes nothing');
  const AGAIN = await page.evaluate(async () => {
    const before = (() => { const p = _props.find(x => /Northgate/.test(x.name || '')); return {
      props: _props.length, spaces: (p.tenants||[]).length, invoices: (p.invoices||[]).length,
      ids: (p.tenants||[]).map(t => t.id).sort() }; })();
    await ensureNorthgateDemo();
    await ensureNorthgateDemo();
    await new Promise(r => setTimeout(r, 600));
    const p = _props.find(x => /Northgate/.test(x.name || ''));
    return { before, after: { props: _props.length, spaces: (p.tenants||[]).length,
             invoices: (p.invoices||[]).length, ids: (p.tenants||[]).map(t => t.id).sort() } };
  });
  is(AGAIN.after, AGAIN.before, 'two more seed calls leave the property count, the spaces and the invoices exactly as they were');
  is(new Set(AGAIN.after.ids).size, AGAIN.after.ids.length, 'and every space id is still unique');

  // A deterministic seed produces an identical property whether or not it
  // re-runs, so "nothing duplicated" cannot tell the version check from its
  // absence. What the check is FOR is not clobbering what the manager did, so
  // that is what is asserted: change something, seed again, and it survives.
  //
  // THIS BLOCK USED TO PASS FOR THE WRONG REASON. savePropertyData() is
  // debounced by 800 ms and returns before the write; the old version waited
  // 500 ms and re-seeded against a row that had not been written yet, so it
  // proved nothing about the persisted state — and the persisted state was
  // wrong: the save payload dropped _ngV, the next open found no current seed,
  // and re-seeded over the manager's edit. So: wait past the debounce, assert
  // on the STORED row, then do what a manager does — close the tab, come back
  // — and assert the edit is what opens. Two edit types, because the removed
  // invoice is how the defect was found and the cap is a lease field.
  const KEEP = await page.evaluate(async () => {
    const p = currentProperty();
    const t = p.tenants.find(x => x && x.tenant_name === 'Ridgeline Outfitters');
    const was = t.cap;
    [tenantData, p.tenants].flat().filter(x => x && x.tenant_name === 'Ridgeline Outfitters')
      .forEach(x => { x.cap = '9'; });
    savePropertyData();
    await new Promise(r => setTimeout(r, 1600));          // past the 800 ms debounce
    const { data } = await window.supabase.createClient().from('properties').select('data').eq('id', p.id).single();
    const row = (data && data.data) || {};
    const rowT = (row.tenants || []).find(x => x && x.tenant_name === 'Ridgeline Outfitters') || {};
    return { was, storedNgV: row._ngV ?? null, storedCap: rowT.cap ?? null, invoicesBefore: (row.invoices || []).length };
  });
  is(KEEP.storedNgV, D.DEMO_VERSION, 'after the debounced save, the STORED row still carries _ngV');
  is(String(KEEP.storedCap), '9', 'and the stored lease carries the edit');
  // Remove an invoice through the product's own control, then leave.
  const REMOVED = await page.evaluate(async () => {
    try { setCamRegisterOpen(true); } catch (_) {}
    await new Promise(r => setTimeout(r, 300));
    await removeInvItem(0);
    await new Promise(r => setTimeout(r, 1600));
    const { data } = await window.supabase.createClient().from('properties').select('data').eq('id', currentProperty().id).single();
    return { mem: invoiceData.filter(Boolean).length, stored: ((data && data.data && data.data.invoices) || []).length, storedNgV: (data && data.data && data.data._ngV) ?? null };
  });
  is(REMOVED, { mem: D.INVOICES.length - 1, stored: D.INVOICES.length - 1, storedNgV: D.DEMO_VERSION },
     'removing an invoice is written, and the row still carries _ngV');
  const seedLogs = [];
  const onSeed = m => { if (/\[ensureNorthgateDemo\] seeding/.test(m.text())) seedLogs.push(m.text()); };
  page.on('console', onSeed);
  await boot();
  yes(await openNorthgate(), 'the tab is closed and Northgate is reopened from the portfolio');
  page.off('console', onSeed);
  await page.evaluate(() => switchWorkspaceTab('cam'));
  await page.waitForTimeout(700);
  const REOPENED = await page.evaluate(() => ({
    cap: (currentProperty().tenants.find(x => x && x.tenant_name === 'Ridgeline Outfitters') || {}).cap,
    invoices: invoiceData.filter(Boolean).length, ngV: currentProperty()._ngV ?? null,
  }));
  is(seedLogs, [], 'the seeder did NOT re-run on reopen — the stored row is at the current version');
  is(String(REOPENED.cap), '9', 'the cap edit SURVIVES a real reopen');
  is(REOPENED.invoices, D.INVOICES.length - 1, 'and so does the removed invoice — the register is what the manager left');
  is(REOPENED.ngV, D.DEMO_VERSION, 'and the live object carries _ngV again, so the next save keeps it too');
  // Put both edits back for the sections that follow, and wait for the write.
  await page.evaluate(async () => {
    [tenantData, currentProperty().tenants].flat().filter(x => x && x.tenant_name === 'Ridgeline Outfitters')
      .forEach(x => { x.cap = '5'; });
    const ND = window.DemoNorthgate;
    const inv0 = ND.INVOICES[0];
    const restored = { id: 'ng-inv-0', vendorName: inv0.vendorName, amount: inv0.amount, category: inv0.category,
      invoiceDate: inv0.invoiceDate, camEligible: true, fileUrl: ND.invoicePath(inv0), fileName: inv0.n + '.pdf' };
    invoiceData.unshift(restored);
    currentProperty().invoices = Array.from(invoiceData);
    _invoiceInputChanged();
    savePropertyData();
    await new Promise(r => setTimeout(r, 1600));
    await runAllocation(); await new Promise(r => setTimeout(r, 2500));
  });
  const BACK0 = await read();
  is(BACK0.results, C.results, 'restoring both edits and re-running leaves the allocations exactly as they were');

  sec('12b · the stored reconciliation can account for its own inputs');
  const FP = await page.evaluate(() => {
    const p = currentProperty();
    const rec = p.camReconciliation || {};
    return { hasFp: typeof rec.inputsFingerprint === 'string' && rec.inputsFingerprint.length > 0,
             matchesNow: rec.inputsFingerprint === camInputsFingerprint(p.tenants, invoiceData),
             hasEngineInvoices: Array.isArray(rec.engineInvoices) && rec.engineInvoices.length > 0 };
  });
  yes(FP.hasFp, 'the seeded reconciliation carries an inputs fingerprint rather than relying on a fallback', JSON.stringify(FP));
  yes(FP.matchesNow, 'and it matches the property as it stands, which is why the run reopens current', JSON.stringify(FP));
  yes(FP.hasEngineInvoices, 'the engine invoice records travel with it too', JSON.stringify(FP));

  // ══ 13–14 · the negative boundary ═════════════════════════════════════════
  sec('13 · NEGATIVE — take the source documents away and the same property refuses');
  const N1 = await page.evaluate(async () => {
    const keep = invoiceData.map(i => ({ id: i.id, fileUrl: i.fileUrl, fileName: i.fileName }));
    invoiceData.forEach(i => { i.fileUrl = null; i.fileName = null; });
    const p = currentProperty(); p.invoices = invoiceData.map(i => ({ ...i }));
    await runAllocation(); await new Promise(r => setTimeout(r, 2500));
    const s = buildAuditSummary();
    const AX = window.AuditExposure;
    const ex = AX.deriveExposure(s, window.CamPool.total(invoiceData.filter(Boolean)));
    const rd = AX.billingReadiness(ex);
    const out = { canBill: rd.canBill, label: rd.label, red: s.red.map(f => f.title),
                  blockers: (ex.blocking.property||[]).map(b => b.title),
                  results: lastResults.map(r => Math.round(r.totalAllocated*100)/100) };
    // put it back
    invoiceData.forEach((i, n) => { i.fileUrl = keep[n].fileUrl; i.fileName = keep[n].fileName; });
    p.invoices = invoiceData.map(i => ({ ...i }));
    await runAllocation(); await new Promise(r => setTimeout(r, 2500));
    return out;
  });
  yes(N1.canBill === false && N1.label === 'Not ready to bill',
      'with no source documents the verdict flips to Not ready to bill', JSON.stringify({ canBill: N1.canBill, label: N1.label }));
  is(N1.blockers, [`${D.INVOICES.length} of ${D.INVOICES.length} invoices missing source document`],
     'held by exactly the finding that holds Cascade Commons');
  is(N1.results, C.results.map(r => r.alloc),
     'and the ARITHMETIC is unchanged — the refusal is about evidence, not about the numbers');
  const BACK = await read();
  is(BACK.verdict, { canBill: true, label: 'Bill with review' }, 'restoring the documents restores the billable verdict');

  sec('14 · NEGATIVE — one Modified Gross lease holds that tenant and nobody else');
  const N2 = await page.evaluate(async () => {
    const t = tenantData.find(x => x && x.tenant_name === 'Bright Lane Cleaners');
    const was = t.lease_type;
    [tenantData, currentProperty().tenants].flat()
      .filter(x => x && x.tenant_name === 'Bright Lane Cleaners')
      .forEach(x => { x.lease_type = 'Modified Gross'; });
    await runAllocation(); await new Promise(r => setTimeout(r, 2500));
    const s = buildAuditSummary();
    const AX = window.AuditExposure;
    const ex = AX.deriveExposure(s, window.CamPool.total(invoiceData.filter(Boolean)));
    const out = {
      byTenant: Object.keys(ex.blocking.byTenant || {}),
      property: (ex.blocking.property || []).map(b => b.title),
      perTenant: lastResults.map(r => ({ name: r.name, canBill: AX.billingReadiness(ex, r.name).canBill })),
    };
    [tenantData, currentProperty().tenants].flat()
      .filter(x => x && x.tenant_name === 'Bright Lane Cleaners')
      .forEach(x => { x.lease_type = was; });
    await runAllocation(); await new Promise(r => setTimeout(r, 2500));
    return out;
  });
  is(N2.byTenant, ['Bright Lane Cleaners'], 'the Modified Gross lease is held, by name');
  is(N2.property, [], 'and nothing property-wide is raised');
  is(N2.perTenant.filter(t => !t.canBill).map(t => t.name), ['Bright Lane Cleaners'],
     'the other four tenants remain billable — one lease in doubt does not stop the building');
  const BACK2 = await read();
  is(BACK2.verdict, { canBill: true, label: 'Bill with review' }, 'restoring the lease type restores the billable verdict');
  is(BACK2.results, C.results, 'and the allocations are exactly what they were');

  // ══ 16 · persistence ══════════════════════════════════════════════════════
  // What the manager reported: "CAM Reconciliation Complete" above a red
  // "These CAM results weren't saved to the server". The calculation was fine;
  // the property had never reached the database at all, because its id was not
  // a uuid, so the endpoint's ownership check could not find it and answered
  // 403. Everything below is that path, end to end.
  sec('16 · the reconciliation is actually saved, and stays saved');

  const IDS = await page.evaluate(() => {
    const ng = _props.find(p => /Northgate/.test(p.name || ''));
    const cas = _props.find(p => /Cascade/.test(p.name || ''));
    return { ng: ng.id, spaces: (ng.tenants || []).map(t => t.id), cascade: cas.id,
             rejections: window.__pgUuidRejections.slice() };
  });
  yes(UUID_RE.test(IDS.ng), `Northgate's property id is a uuid Postgres will accept (${IDS.ng})`, IDS.ng);
  yes(IDS.spaces.length === D.TENANTS.length + 1 && IDS.spaces.every(id => UUID_RE.test(id)),
      `and so is every one of its ${IDS.spaces.length} space ids`, JSON.stringify(IDS.spaces));
  yes(IDS.ng !== IDS.cascade && !/^dec00000-/i.test(IDS.ng),
      'it is its own id, on its own prefix — it cannot be mistaken for Cascade\'s');
  is(IDS.rejections, [], 'nothing the app wrote was refused for an invalid uuid');

  const SAVE = await page.evaluate(async () => {
    await runAllocation();
    await new Promise(r => setTimeout(r, 2600));
    const b = document.getElementById('camSaveWarningBanner');
    const p = currentProperty();
    const stored = await loadCamResults(p.id, getCamYear());
    return {
      bannerShown: !!(b && b.style.display !== 'none' && (b.textContent || '').trim()),
      bannerText: b ? (b.textContent || '').trim() : null,
      stored: stored.length,
      names: stored.map(r => r.tenant_name).sort(),
      allocated: Math.round(stored.reduce((s, r) => s + (Number(r.allocated_amount) || 0), 0) * 100) / 100,
      year: stored.length ? stored[0].year : null,
      propId: p.id,
    };
  });
  yes(!SAVE.bannerShown,
      'Calculate leaves NO "weren\'t saved to the server" banner — the write was accepted',
      SAVE.bannerText);
  is(SAVE.stored, D.TENANTS.length, `the server holds one row per tenant (${D.TENANTS.length})`);
  is(SAVE.names, D.TENANTS.map(t => t.tenant_name).sort(), 'and they are the five tenants, by name');
  is(SAVE.allocated, 84882.25, 'the persisted allocations add up to the billed total');
  is(SAVE.year, D.CAM_YEAR, `filed under CAM year ${D.CAM_YEAR}`);

  // Persisted means persisted: the rows are on the server, not in this tab.
  const SRV = await page.evaluate(async () => (await (await fetch('/__camdb')).json()).rows);
  is(SRV.length, D.TENANTS.length, 'the server\'s own store really has those rows, independently of the page');

  await boot();
  yes(await openNorthgate(), 'Northgate reopens after a second full reload');
  const AFTER = await page.evaluate(async () => {
    const p = currentProperty();
    const stored = await loadCamResults(p.id, getCamYear());
    const b = document.getElementById('camSaveWarningBanner');
    return { stored: stored.length, names: stored.map(r => r.tenant_name).sort(),
             allocated: Math.round(stored.reduce((s, r) => s + (Number(r.allocated_amount) || 0), 0) * 100) / 100,
             banner: !!(b && b.style.display !== 'none' && (b.textContent || '').trim()) };
  });
  is(AFTER.stored, D.TENANTS.length, 'after closing the tab and coming back the rows are STILL on the server');
  is(AFTER.names, SAVE.names, 'the same five tenants');
  is(AFTER.allocated, SAVE.allocated, 'and the same money — nothing was lost with the tab');
  yes(!AFTER.banner, 'and the restored run shows no save warning');

  // The endpoint's refusal is real, not something this stub invented: give it
  // the id the defect produced and it answers exactly as production did.
  const FORBID = await page.evaluate(async () => {
    const r = await fetch('/api/cam-reconciliations', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: 'ne000000-0000-4000-a000-abcdef012345', year: 2025,
                             rows: [{ tenant_name: 'X', allocated_amount: 1, year: 2025 }] }) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  is(FORBID.status, 403, 'the old non-hex id is refused 403 by the reconciliation endpoint — the defect, reproduced');
  const SRV2 = await page.evaluate(async () => (await (await fetch('/__camdb')).json()).rows.length);
  is(SRV2, D.TENANTS.length, 'and that refused write stored nothing, leaving Northgate\'s own rows intact');

  // Anyone who opened the demo before the fix has an unsaveable copy in
  // localStorage under the old id. It was never in the database — it could not
  // be — so there is nothing to migrate, but left in place it would reappear
  // beside the real one as a second identical Northgate Exchange.
  sec('16b · the unsaveable copy from the old id does not come back as a twin');
  const LEGACY = await page.evaluate(async () => {
    const ghostId = 'ne000000-0000-4000-a000-7f3a2b1c9d4e';
    const real = _props.find(p => /Northgate/.test(p.name || ''));
    // The legacy copy carried the property, not its run history: the ghost is
    // the identity and the roster, without the reconciliation payload, which
    // by this point in the suite has been re-run several times and would push
    // the per-user localStorage map past the browser's quota.
    const ghost = JSON.parse(JSON.stringify({ ...real, id: ghostId, camReconciliation: null, camRuns: [], activityLog: [], timeline: [], results: null }));
    _props.push(ghost);
    const key = _lsUserKey();
    const stored = JSON.parse(localStorage.getItem(key) || '{}');
    stored[ghostId] = ghost; localStorage.setItem(key, JSON.stringify(stored));
    const before = { names: _props.filter(p => /Northgate/.test(p.name || '')).length,
                     inLs: !!JSON.parse(localStorage.getItem(key) || '{}')[ghostId] };
    await ensureNorthgateDemo();
    await new Promise(r => setTimeout(r, 800));
    const after = { names: _props.filter(p => /Northgate/.test(p.name || '')).length,
                    inLs: !!JSON.parse(localStorage.getItem(key) || '{}')[ghostId],
                    ids: _props.filter(p => /Northgate/.test(p.name || '')).map(p => p.id) };
    return { before, after };
  });
  is(LEGACY.before, { names: 2, inLs: true }, 'with the old copy restored there are two Northgates and one is in localStorage');
  is(LEGACY.after.names, 1, 'after the seeder runs there is one');
  is(LEGACY.after.inLs, false, 'and the old copy is gone from localStorage');
  yes(UUID_RE.test(LEGACY.after.ids[0]), 'the survivor is the one with the valid id', JSON.stringify(LEGACY.after.ids));

  // ══ 17 · the property's own face ══════════════════════════════════════════
  // Northgate opened under Cascade Commons' rendering. PropertyReference falls
  // back to a hardcoded Cascade block for anything isDemo() matches, and the
  // Northgate seed carried _demoVersion — the very flag isDemo() reads.
  sec('17 · Northgate shows its own rendering, and only its own');

  const heroOf = async () => {
    await page.evaluate(() => { try { PropertyCabinetView.closeDrawer(); } catch (_) {} switchWorkspaceTab('property'); });
    await page.waitForTimeout(600);
    const loaded = await page.waitForFunction(
      () => { const i = document.querySelector('#propertyOsBody .pcv-hero img'); return !!(i && i.complete && i.naturalWidth > 0); },
      null, { timeout: 8000 }).then(() => true).catch(() => false);
    return page.evaluate((ok) => {
      const fig = document.querySelector('#propertyOsBody .pcv-hero');
      const i = fig && fig.querySelector('img');
      return { name: (document.querySelector('#propertyOsBody .pcv-name') || {}).textContent || null,
               addr: (document.querySelector('#propertyOsBody .pcv-addr') || {}).textContent || null,
               src: i ? i.getAttribute('src') : null,
               caption: fig ? ((fig.querySelector('figcaption') || {}).textContent || '') : null,
               loaded: ok };
    }, loaded);
  };

  const H = await heroOf();
  is(H.name, NG, 'the Property tab is showing Northgate Exchange');
  is(H.src, D.INFO.imageUrl, 'and its hero image is Northgate\'s own rendering');
  yes(!/cascade/i.test(H.src || ''), 'which is not the Cascade asset under any name', H.src);
  yes(H.loaded, 'the image actually loads over HTTP');
  is(H.addr, D.PROPERTY.address, 'the address beside it is Northgate\'s own');
  yes(/Northgate Exchange/i.test(H.caption || '') && /not a photograph/i.test(H.caption || ''),
      'the caption names Northgate and says it is not a photograph', H.caption);

  // THE STORED ROW, NOT THE CACHE. _lsSave writes the live object — info and
  // all — to localStorage, so a row that reached the database without its info
  // block still renders correctly in the tab that seeded it. On a second device
  // there is no localStorage to cover for it: the seeder finds a row already at
  // _ngV, skips, and hydrates a property with no info, no isDemo fallback and
  // therefore no image. Reading the row directly is the only way to see that.
  const ROW = await page.evaluate(async () => {
    const p = currentProperty();
    const { data } = await window.supabase.createClient().from('properties')
      .select('data').eq('id', p.id).single();
    const info = data && data.data && data.data.info;
    return { hasInfo: !!info, image: info ? info.imageUrl : null,
             address: info ? info.address : null,
             demoVersion: data && data.data ? (data.data._demoVersion ?? null) : 'no row' };
  });
  yes(ROW.hasInfo, 'the row IN THE DATABASE carries Northgate\'s info, not only the local cache', JSON.stringify(ROW));
  is(ROW.image, D.INFO.imageUrl, 'including its own rendering, so a second device shows the same picture');
  is(ROW.address, D.PROPERTY.address, 'and its own address');
  is(ROW.demoVersion, null, 'and the row carries no Cascade marker to fall back through');

  const REF = await page.evaluate(() => {
    const p = currentProperty();
    const info = PropertyReference.infoFor(p);
    return { owner: info.owner, parcel: info.parcelId, carrier: info.insuranceCarrier,
             isDemo: PropertyReference.isDemo(p),
             propDocs: PropertyReference.propertyDocumentsFor(p).map(d => d.name),
             spaceDocs: PropertyReference.spaceDocumentsFor(p, (p.tenants || [])[0]).length };
  });
  is(REF.owner, D.PROPERTY.owner, 'the Property Information panel states Northgate\'s owner');
  is(REF.parcel, D.PROPERTY.parcel, 'Northgate\'s parcel id');
  is(REF.carrier, D.INFO.insuranceCarrier, 'and Northgate\'s insurance carrier — none of it Cascade\'s');
  is(REF.propDocs, [], 'it is offered no Cascade site plan, survey or Travelers policy');
  is(REF.spaceDocs, 0, 'and its spaces are offered no Cascade lease catalog either');

  await boot();
  yes(await openNorthgate(), 'Northgate reopens from the portfolio once more');
  const H2 = await heroOf();
  is(H2.src, H.src, 'after a full reload the image is still Northgate\'s');
  is(H2.addr, H.addr, 'and so is the address — the saved property carries its own info');

  const CASC = await page.evaluate(async () => {
    const c = _props.find(p => /Cascade/.test(p.name || ''));
    selectProperty(c.id);
    await new Promise(r => setTimeout(r, 1800));
    return null;
  });
  void CASC;
  const HC = await heroOf();
  is(HC.name, 'Cascade Commons', 'opening Cascade Commons shows Cascade Commons');
  is(HC.src, 'assets/demo/cascade-commons-rendering.svg', 'still under its own rendering, untouched by this fix');
  yes(/Cascade Commons/i.test(HC.caption || ''), 'with its own caption', HC.caption);

  const REAL = await page.evaluate(() => {
    const real = { id: 'aaaaaaaa-1111-4000-a000-222222222222', name: 'Maple Plaza', totalSqft: 9000,
                   tenants: [], invoices: [], timeline: [], disputes: [], activityLog: [] };
    _props.push(real); const prev = activePropId; activePropId = real.id;
    PropertyOS.renderPropertyPage(real);
    const out = { hero: !!document.querySelector('#propertyOsBody .pcv-hero'),
                  name: (document.querySelector('#propertyOsBody .pcv-name') || {}).textContent || null,
                  info: PropertyReference.infoFor(real) };
    _props.pop(); activePropId = prev; PropertyOS.renderPropertyPage(currentProperty());
    return out;
  });
  is(REAL, { hero: false, name: 'Maple Plaza', info: null },
     'a manager\'s own property is unaffected: no image, no address and no facts invented for it');

  sec('15 · quiet page');
  is(errors, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
