'use strict';
// test-e2e-unapplied-provisions.js
// ============================================================================
// A LEASE TERM THE ENGINE DOES NOT APPLY HOLDS THE STATEMENT — end to end, on
// the real page. test-unapplied-provisions.js proves the detector and the gate
// in isolation; this suite proves the path a manager walks: the demo opens
// exactly as it did, a stop put on one lease surfaces in AI Audit Review under
// that tenant only, "Tenant Statement" refuses with the term named, the
// allocation itself does not move, and taking the term away restores the demo
// verdict bit for bit.
//
//   1 · the demo is unchanged — no provision finding, the same blockers, the
//       same amounts, the same five held cards
//   2 · an expense stop on Whole Health Market: held, named, quoted as absent,
//       amounts unchanged, statement refused; nobody else held for it
//   3 · zero is a stated stop; '' is not — and '' restores the demo verdict
//   4 · a gross-up on Summit holds Summit, not Whole Health Market
//   5 · no uncaught errors
//
//   node test-e2e-unapplied-provisions.js
// ============================================================================
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8983;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.png':'image/png' };
const showroom = fs.readFileSync(path.join(ROOT, 'test-e2e-demo-showroom.js'), 'utf8');
const DB = showroom.slice(showroom.indexOf('const DB = `') + 12, showroom.indexOf('`;', showroom.indexOf('const DB = `')));

let pass = 0, fail = 0;
const yes = (c, m, d) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); } else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      → ${d}` : ''}`); } };
const is  = (a, b, m) => yes(JSON.stringify(a) === JSON.stringify(b), m, `expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`);
const sec = s => console.log(`\n── ${s} ──`);

// What the page believes, read from the authorities the screens read from.
const READ = `(() => {
  const isProv = f => /^Lease provisions? not applied — /.test(f.title);
  const sum = buildAuditSummary();
  const exp = window.AuditExposure.deriveExposure(sum, window.CamPool.total(invoiceData));
  const ready = window.AuditExposure.billingReadiness(exp);
  const prov = sum.red.concat(sum.yellow).filter(isProv);
  return {
    amounts: Object.fromEntries(lastResults.map(r => [r.name, r.totalAllocated])),
    provisionFindings: prov.map(f => ({ title: f.title, severity: f.severity, blocks: f.blocksBilling, conditions: f.conditions })),
    blockingProperty: exp.blocking.property.map(b => b.title),
    blockingByTenant: Object.fromEntries(Object.entries(exp.blocking.byTenant).map(([k, v]) => [k, v.map(x => x.title)])),
    ready: { canBill: ready.canBill, label: ready.label },
    heldCards: document.querySelectorAll('#resultsBody .tenant-stmt-card-btn--held').length,
    cardLabels: Array.from(document.querySelectorAll('#resultsBody .tenant-stmt-card-btn')).map(b => b.textContent.trim()),
    auditText: (document.getElementById('camAuditReview') || {}).textContent || '',
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
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => { try { MainStreetLanding.hide(); } catch (_) {} });
  await page.waitForTimeout(400);
  await page.evaluate(() => loadDemo());
  await page.waitForFunction(() => document.getElementById('mainWorkflow').style.display !== 'none'
    && typeof lastResults !== 'undefined' && lastResults.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => switchWorkspaceTab('cam'));
  await page.waitForTimeout(600);

  const read = () => page.evaluate(READ);
  // Set one field on one demo tenant — on the live tenantData row, which
  // runAllocation copies into the property before the engine reads it — and
  // re-run, exactly as an edit on the Spaces tab followed by Calculate would.
  const setAndRerun = (name, field, value) => page.evaluate(async ({ name, field, value }) => {
    const rows = [tenantData, currentProperty().tenants].flat().filter(t => t && t.tenant_name === name);
    rows.forEach(t => { t[field] = value; });
    await runAllocation();
    await new Promise(r => setTimeout(r, 2500));
    return rows.length;
  }, { name, field, value });

  // ══ 1 · the demo, untouched ══════════════════════════════════════════════
  sec('1 · the demo opens exactly as it did');
  const D0 = await read();
  is(D0.provisionFindings, [], 'no provision finding on the demo — every such field is null on all five leases');
  is(D0.blockingProperty, ['26 of 26 invoices missing source document'], 'the one property-level blocker is the one the demo always had');
  is(Object.keys(D0.blockingByTenant), ['ProActive Physical Therapy'], 'only ProActive is held under its own name');
  yes(D0.blockingByTenant['ProActive Physical Therapy'].length === 1
      && /^Modified Gross tenant receiving shared CAM/.test(D0.blockingByTenant['ProActive Physical Therapy'][0]),
      'held once, by the Gross detector, for its lease type', JSON.stringify(D0.blockingByTenant));
  is(D0.ready, { canBill: false, label: 'Not ready to bill' }, 'the property verdict is what it was');
  is(D0.heldCards, 5, 'all five cards are held (the property-level blocker) — as before');
  yes(Object.keys(D0.amounts).length === 5 && Object.values(D0.amounts).every(v => v > 0), 'five allocations, all positive', JSON.stringify(D0.amounts));

  // ══ 2 · an expense stop on one lease ═════════════════════════════════════
  sec('2 · an expense stop on Whole Health Market holds Whole Health Market — and nobody else');
  const touched = await setAndRerun('Whole Health Market', 'expense_stop', 4.5);
  yes(touched >= 1, `the field was set on the live tenant row (${touched} row(s))`);
  const D1 = await read();
  is(D1.amounts, D0.amounts, 'the allocation does not move — the engine still ignores the stop, by design');
  is(D1.provisionFindings.map(f => f.title), ['Lease provision not applied — Whole Health Market: Expense stop'], 'one finding, naming the tenant and the term');
  yes(D1.provisionFindings[0] && D1.provisionFindings[0].severity === 'yellow' && D1.provisionFindings[0].blocks === true, 'yellow, and blocking');
  const C1 = (D1.provisionFindings[0] || {}).conditions || [];
  yes(C1[0] === 'Tenant: Whole Health Market', 'scoped to the tenant', JSON.stringify(C1));
  yes(C1.includes('Expense stop: $4.50/sqft'), 'the extracted value is stated', JSON.stringify(C1));
  yes(C1.includes('Expense stop — no lease quote on file'), 'no quote is on file for a demo lease, and it says so rather than inventing one', JSON.stringify(C1));
  yes(C1.some(c => /does not apply this provision/.test(c)), 'it says MainStreet does not apply the term');
  yes((D1.blockingByTenant['Whole Health Market'] || []).some(t => /^Lease provision not applied/.test(t)),
      'Whole Health Market is held under its own name for it', JSON.stringify(D1.blockingByTenant));
  is(Object.keys(D1.blockingByTenant).sort(), ['ProActive Physical Therapy', 'Whole Health Market'], 'no other tenant is held for it');
  is(D1.blockingByTenant['ProActive Physical Therapy'], D0.blockingByTenant['ProActive Physical Therapy'], 'ProActive’s own blocker is exactly what it was — not duplicated, not changed');
  is(D1.blockingProperty, D0.blockingProperty, 'nothing property-wide was added');
  yes(D1.auditText.includes('Lease provision not applied — Whole Health Market'), 'AI Audit Review lists it');

  // The statement: refused, with the term on the block screen.
  const stmt = await page.evaluate(async () => {
    generateTenantStatement('Whole Health Market');
    await new Promise(r => setTimeout(r, 1200));
    const overlay = document.getElementById('reportOverlay');
    return { shown: !!overlay && overlay.style.display === 'block',
             title: (document.getElementById('rptToolbarTitle') || {}).textContent || '',
             body: (document.getElementById('rptBody') || {}).textContent || '' };
  });
  yes(stmt.shown && /^Statement blocked — Whole Health Market/.test(stmt.title), 'Tenant Statement opens the block screen, not a statement', stmt.title);
  yes(/Lease provision not applied — Whole Health Market: Expense stop/.test(stmt.body), 'and the block screen names the term');
  await page.evaluate(() => { const o = document.getElementById('reportOverlay'); if (o) o.style.display = 'none'; });

  // ══ 3 · zero is a stated stop; '' is not ═════════════════════════════════
  sec('3 · zero is a stated stop; an empty field is not, and restores the demo verdict');
  await setAndRerun('Whole Health Market', 'expense_stop', 0);
  const D2 = await read();
  is(D2.provisionFindings.map(f => f.title), ['Lease provision not applied — Whole Health Market: Expense stop'], 'a stop of 0 still holds the statement');
  yes(((D2.provisionFindings[0] || {}).conditions || []).includes('Expense stop: $0.00/sqft'), 'and reads $0.00/sqft');
  await setAndRerun('Whole Health Market', 'expense_stop', '');
  const D3 = await read();
  is(D3.provisionFindings, [], "'' is absent — nothing fires");
  is({ p: D3.blockingProperty, t: D3.blockingByTenant, r: D3.ready, a: D3.amounts, h: D3.heldCards },
     { p: D0.blockingProperty, t: D0.blockingByTenant, r: D0.ready, a: D0.amounts, h: D0.heldCards },
     'the demo verdict, blockers, amounts and cards are exactly what they were');

  // ══ 4 · a gross-up on another lease ══════════════════════════════════════
  sec('4 · a gross-up on Summit holds Summit, not Whole Health Market');
  await setAndRerun('Summit Coffee & Provisions', 'gross_up_pct', 95);
  const D4 = await read();
  is(D4.provisionFindings.map(f => f.title), ['Lease provision not applied — Summit Coffee & Provisions: Gross-up'], 'one finding, for Summit');
  yes(((D4.provisionFindings[0] || {}).conditions || []).includes('Gross-up: 95%'), 'stating 95%');
  yes(!D4.blockingByTenant['Whole Health Market'], 'Whole Health Market is not held for Summit’s lease');
  yes((D4.blockingByTenant['Summit Coffee & Provisions'] || []).some(t => /Gross-up/.test(t)), 'Summit is', JSON.stringify(D4.blockingByTenant));
  is(D4.amounts, D0.amounts, 'and the allocation still does not move');
  await setAndRerun('Summit Coffee & Provisions', 'gross_up_pct', null);
  const D5 = await read();
  is(D5.provisionFindings, [], 'cleared — the finding is gone');

  // ══ 5 · quiet page ═══════════════════════════════════════════════════════
  sec('5 · quiet page');
  is(errors, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
