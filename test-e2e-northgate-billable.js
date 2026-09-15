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
//
//   node test-e2e-northgate-billable.js
// ============================================================================
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8999;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.png':'image/png' };
const showroom = fs.readFileSync(path.join(ROOT, 'test-e2e-demo-showroom.js'), 'utf8');
const DB = showroom.slice(showroom.indexOf('const DB = `') + 12, showroom.indexOf('`;', showroom.indexOf('const DB = `')));
const D = require('./demo-northgate.js');

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
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]); if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
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

  await boot();

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
  const KEEP = await page.evaluate(async () => {
    const p = currentProperty();
    const t = p.tenants.find(x => x && x.tenant_name === 'Ridgeline Outfitters');
    const was = t.cap;
    [tenantData, p.tenants].flat().filter(x => x && x.tenant_name === 'Ridgeline Outfitters')
      .forEach(x => { x.cap = '9'; });
    await savePropertyData();
    await new Promise(r => setTimeout(r, 500));
    await ensureNorthgateDemo();
    await new Promise(r => setTimeout(r, 600));
    const after = (currentProperty().tenants.find(x => x && x.tenant_name === 'Ridgeline Outfitters') || {}).cap;
    [tenantData, currentProperty().tenants].flat().filter(x => x && x.tenant_name === 'Ridgeline Outfitters')
      .forEach(x => { x.cap = was; });
    await savePropertyData();
    await new Promise(r => setTimeout(r, 500));
    return { was, after };
  });
  is(String(KEEP.after), '9',
     'an edit made to the demo SURVIVES a re-seed — the version marker stops the seed overwriting the manager');
  const BACK0 = await read();
  is(BACK0.results, C.results, 'and restoring the edit leaves the allocations exactly as they were');

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

  sec('15 · quiet page');
  is(errors, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
