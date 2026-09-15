'use strict';
// test-e2e-invoice-input-stale.js
// ============================================================================
// A REGISTER CHANGE MAKES THE RESULTS STALE — the customer lifecycle, on the
// real page, for every path that changes the reconciliation's inputs:
//
//   1 · Calculate with a known invoice set (results current)
//   2 · make ONE register change
//   3 · the results are visibly stale: banner, "Re-run needed"
//   4 · the CSV export refuses
//   5 · the tenant statement refuses
//   6 · the on-screen figures are the OLD ones and say so — nothing recomputes
//       silently
//   7 · Calculate again
//   8 · the new result reflects the changed register and the stale state clears
//
// Paths: remove a row · edit an amount · edit a category · edit a date · edit
// a vendor · take an invoice out of CAM in the Property → Invoices drawer ·
// Clear All (which cannot re-run, so it stops at the refusals).
//
// BEFORE THIS FIX the same removal was flagged after a reload (the saved
// fingerprint no longer matched) and passed as current in the session it
// happened in: "✓ Calculated" beside the old amounts, the CSV export waved
// through. This suite fails against that build on every path.
//
//   node test-e2e-invoice-input-stale.js
// ============================================================================
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8986;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.png':'image/png' };
const showroom = fs.readFileSync(path.join(ROOT, 'test-e2e-demo-showroom.js'), 'utf8');
const DB = showroom.slice(showroom.indexOf('const DB = `') + 12, showroom.indexOf('`;', showroom.indexOf('const DB = `')));

let pass = 0, fail = 0;
const yes = (c, m, d) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); } else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      → ${d}` : ''}`); } };
const is  = (a, b, m) => yes(JSON.stringify(a) === JSON.stringify(b), m, `expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`);
const sec = s => console.log(`\n── ${s} ──`);

// What the page believes, from the authorities the screens read.
const READ = `(() => ({
  stale: _resultsStale,
  banner: getComputedStyle(document.getElementById('staleResultsBanner')).display,
  bannerText: document.getElementById('staleResultsBanner').textContent.trim(),
  calc: document.querySelector('#camStepCalculate .cam-step-status').textContent.trim(),
  amounts: Object.fromEntries(lastResults.map(r => [r.name, r.totalAllocated])),
  // What each tenant was billed FROM. Four demo tenants sit at their cap, so
  // a change to the pool can leave their totals untouched while the invoices
  // behind them change — this is the figure that must move.
  billedFrom: Object.fromEntries(lastResults.map(r => [r.name, (r.includedInvoices || []).map(i => String(i.id ?? (i.vendorName + '@' + i.amount))).sort()])),
  shown: Array.from(document.querySelectorAll('#resultsBody .rcs-table tbody tr')).map(tr => tr.textContent.replace(/\\s+/g, ' ').trim()).join(' | '),
  invoices: invoiceData.filter(Boolean).length,
  pool: window.CamPool.total(invoiceData),
}))()`;

// Try the two guarded downstream actions and report what each did. showToast
// is spied, not stubbed, so the page behaves exactly as it would for a person.
const GATES = `(async () => {
  const toasts = []; const _orig = window.showToast;
  window.showToast = (m, o) => { toasts.push(String(m)); return _orig ? _orig(m, o) : null; };
  const ov = document.getElementById('reportOverlay'); if (ov) ov.style.display = 'none';
  exportReconciliationCSV();
  await new Promise(r => setTimeout(r, 500));
  const exportToast = toasts.slice();
  toasts.length = 0;
  generateTenantStatement('Harbor Nail & Beauty Studio');
  await new Promise(r => setTimeout(r, 1200));
  const stmtToast = toasts.slice();
  const overlay = document.getElementById('reportOverlay');
  const out = { exportRefused: exportToast.some(t => /stale/i.test(t)), stmtRefusedStale: stmtToast.some(t => /stale/i.test(t)),
                overlayShown: !!overlay && overlay.style.display === 'block',
                overlayTitle: (document.getElementById('rptToolbarTitle') || {}).textContent || '' };
  if (overlay) overlay.style.display = 'none';
  window.showToast = _orig;
  return out;
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
  await page.evaluate(() => { switchWorkspaceTab('cam'); setCamRegisterOpen(true); });
  await page.waitForTimeout(600);

  const read  = () => page.evaluate(READ);
  const gates = () => page.evaluate(GATES);
  const rerun = () => page.evaluate(async () => { await runAllocation(); await new Promise(r => setTimeout(r, 2500)); });

  // ONE LIFECYCLE PER PATH. `change` runs in the page and returns a note.
  // `moves` says whether this change must alter the allocation on re-run.
  async function lifecycle(label, change, { moves }) {
    sec(label);
    await rerun();
    const R0 = await read();
    yes(R0.stale === false && /Calculated/.test(R0.calc) && R0.banner === 'none', '1 · calculated: results are current', JSON.stringify({ stale: R0.stale, calc: R0.calc }));
    const note = await page.evaluate(change);
    await page.waitForTimeout(800);
    const R1 = await read();
    yes(R1.stale === true, `2–3 · after ${note}: the results are marked stale`);
    yes(R1.banner === 'block' && /re-run CAM allocation/i.test(R1.bannerText), '3 · the stale banner is shown and says to re-run', R1.bannerText);
    yes(/Re-run needed/.test(R1.calc), '3 · Calculate reads "Re-run needed"', R1.calc);
    is(R1.amounts, R0.amounts, '6 · the figures on screen are the old ones — nothing recomputed silently');
    is(R1.shown, R0.shown, '6 · and the per-tenant table still shows them, under the banner');
    const G1 = await gates();
    yes(G1.exportRefused, '4 · the CSV export refuses, naming stale results', JSON.stringify(G1));
    yes(G1.stmtRefusedStale && !G1.overlayShown, '5 · the tenant statement refuses, naming stale results, and opens nothing', JSON.stringify(G1));
    await rerun();
    const R2 = await read();
    yes(R2.stale === false && R2.banner === 'none' && /Calculated/.test(R2.calc), '7–8 · calculated again: the stale state clears', JSON.stringify({ stale: R2.stale, calc: R2.calc }));
    const sig = R => JSON.stringify({ a: R.amounts, b: R.billedFrom });
    if (moves) yes(sig(R2) !== sig(R0), '8 · the new result reflects the changed register — what a tenant is billed from, or for, has changed', JSON.stringify({ before: R0.billedFrom, after: R2.billedFrom }));
    else       yes(sig(R2) === sig(R0), '8 · this change does not move the allocation, and the re-run says so', JSON.stringify({ before: R0.amounts, after: R2.amounts }));
    const G2 = await gates();
    yes(!G2.exportRefused, '8 · the export is no longer refused for staleness');
    yes(!G2.stmtRefusedStale, '8 · nor is the statement (the demo’s own blocker still holds it, which is a different refusal)', JSON.stringify(G2));
    return { R0, R1, R2 };
  }

  await lifecycle('A · remove a row', async () => {
    const n = invoiceData.length; await removeInvItem(n - 1); return `removing invoice ${n}`;
  }, { moves: true });

  await lifecycle('B · edit an amount through the register field', () => {
    const el = document.getElementById('ifield-0-amount');
    el.value = String((parseFloat(invoiceData[0].amount) || 0) + 5000);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return `changing invoice 1’s amount to ${el.value}`;
  }, { moves: true });

  await lifecycle('C · edit a category through the register field', () => {
    const i = invoiceData.findIndex(x => x && x.category === 'management');
    const el = document.getElementById(`ifield-${i}-category`);
    el.value = 'repairs';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return `re-categorising a management invoice as repairs (ProActive excludes management)`;
  }, { moves: true });

  await lifecycle('D · edit a date through the register field', () => {
    const el = document.getElementById('ifield-0-invoiceDate');
    el.value = '2024-01-15';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'moving invoice 1 out of the CAM year';
  }, { moves: true });

  await lifecycle('E · edit a vendor through the register field', () => {
    const el = document.getElementById('ifield-1-vendorName');
    el.value = 'Renamed Vendor LLC';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'renaming invoice 2’s vendor';
  }, { moves: false });

  await lifecycle('F · take an invoice out of CAM in the Property → Invoices drawer', () => {
    // An invoice the last run actually billed from: in CAM, in the year, and
    // large enough that the one uncapped tenant's share visibly moves.
    const inv = invoiceData.find(x => x && x.id && window.CamPool.isEligible(x) && parseFloat(x.amount) > 1000
                                      && camYearScopeOf(x, getCamYear()) === 'in');
    PropertyOS.setInvoiceRelation(inv.id, 'camEligible', false);
    switchWorkspaceTab('cam');
    return `unticking "in CAM" on ${inv.vendorName}`;
  }, { moves: true });

  // ══ G · Clear All — stale, refused, and honest about not being able to re-run
  sec('G · Clear All');
  await rerun();
  const C0 = await read();
  yes(C0.stale === false, '1 · calculated: results are current');
  await page.evaluate(async () => { await clearInvResults(); });
  await page.waitForTimeout(800);
  const C1 = await read();
  // With nothing in the register Prepare is not ready, so Calculate reads
  // "Not ready" rather than "Re-run needed" — it cannot re-run at all. The
  // stale flag and banner are what hold the old figures out of the gates.
  yes(C1.invoices === 0 && C1.stale === true && C1.banner === 'block' && /Not ready|Re-run needed/.test(C1.calc), '2–3 · the register is empty, the results are marked stale, and Calculate cannot run', JSON.stringify({ n: C1.invoices, stale: C1.stale, calc: C1.calc }));
  is(C1.amounts, C0.amounts, '6 · the old figures are still the ones on screen, under the banner');
  const CG = await gates();
  yes(CG.exportRefused && CG.stmtRefusedStale && !CG.overlayShown, '4–5 · export and statement both refuse', JSON.stringify(CG));

  sec('H · quiet page');
  is(errors, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
