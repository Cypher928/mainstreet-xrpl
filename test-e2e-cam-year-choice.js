'use strict';
// test-e2e-cam-year-choice.js
// ============================================================================
// THE CAM YEAR IS CHOSEN WHERE IT IS RECONCILED — Maple Plaza, on the real
// page. A property whose invoices are all dated 2024, opened in 2026:
//
//   A · the trap as found: 2026 selected, "Dated in 2026: 0", the run refused,
//       the refusal says "switch the CAM year" — and now there is a control
//       on the CAM tab, and Prepare says which year the invoices carry
//   B · choosing 2024 through the Prepare selector: badge, Property Setup
//       select, Prepare facts and hint all follow the one authority
//   C · Calculate produces a 2024 reconciliation from the 2024 invoices
//   D · mixed years: a 2025 invoice is counted outside and not billed
//   E · switching the year after the run stales the results, Calculate reads
//       "Re-run needed", export and statement refuse; switching back does
//       not un-stale (the next run does)
//   F · the refusal panel's button lands on the Prepare selector
//   G · after a reload the property opens on the year it was run for
//   H · no uncaught errors
//
//   node test-e2e-cam-year-choice.js
// ============================================================================
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8992;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.png':'image/png' };
const showroom = fs.readFileSync(path.join(ROOT, 'test-e2e-demo-showroom.js'), 'utf8');
const DB = showroom.slice(showroom.indexOf('const DB = `') + 12, showroom.indexOf('`;', showroom.indexOf('const DB = `')));

let pass = 0, fail = 0;
const yes = (c, m, d) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); } else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      → ${d}` : ''}`); } };
const is  = (a, b, m) => yes(JSON.stringify(a) === JSON.stringify(b), m, `expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`);
const sec = s => console.log(`\n── ${s} ──`);

const READ = `(() => {
  const T = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  const sel = document.getElementById('camYearSelectCam'), psel = document.getElementById('camYearSelect');
  return {
    year: getCamYear(), badge: T(document.getElementById('camYearBadge')),
    camSelect: sel ? { value: sel.value, options: Array.from(sel.options).map(o => o.value), visible: sel.offsetParent !== null, inPrepare: !!sel.closest('#camStepPrepare') } : null,
    propSelect: psel ? psel.value : null,
    hint: T(document.getElementById('camYearHint')),
    prepFacts: T(document.getElementById('camPrepFacts')),
    calc: T(document.querySelector('#camStepCalculate .cam-step-status')),
    calcLast: T(document.getElementById('camCalcLast')),
    resultsTitle: T(document.getElementById('resultsTitle')),
    refusal: !!document.querySelector('#resultsBody .cam-refusal'),
    refusalBtn: T(document.querySelector('#resultsBody .cam-refusal .cam-refusal-year-btn')),
    results: lastResults.map(r => [r.name, r.totalAllocated]),
    stale: _resultsStale, banner: getComputedStyle(document.getElementById('staleResultsBanner')).display,
    bannerText: T(document.getElementById('staleResultsBanner')),
    savedYear: currentProperty().camYear, runYear: (camRuns[0] || {}).camYear || (camRuns[0] || {}).year || null,
  };
})()`;
const GATES = `(async () => {
  const toasts = []; const _o = window.showToast; window.showToast = (m, o) => { toasts.push(String(m)); return _o ? _o(m, o) : null; };
  const ov = document.getElementById('reportOverlay'); if (ov) ov.style.display = 'none';
  exportReconciliationCSV(); await new Promise(r => setTimeout(r, 400));
  const ex = toasts.slice(); toasts.length = 0;
  generateTenantStatement('Maple Dental'); await new Promise(r => setTimeout(r, 1000));
  const st = toasts.slice(); const overlay = document.getElementById('reportOverlay');
  const out = { exportToast: ex[0] || null, stmtToast: st[0] || null, overlayShown: !!overlay && overlay.style.display === 'block' };
  if (overlay) overlay.style.display = 'none'; window.showToast = _o; return out;
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
  };
  await boot();
  const read = () => page.evaluate(READ);
  const run  = () => page.evaluate(async () => { await runAllocation(); await new Promise(r => setTimeout(r, 2500)); });

  // ── Maple Plaza: one tenant, three 2024 invoices, opened in the current year
  await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find(e => /go to portfolio/i.test(e.innerText)); if (x) x.click(); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => addNewProperty());
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    document.getElementById('propertyName').value = 'Maple Plaza';
    document.getElementById('totalSqft').value = '26000';
    const prop = currentProperty();
    prop.tenants = [{ id: 'mp-t1', tenant_name: 'Maple Dental', leased_sqft: 5000, lease_type: 'NNN', start_date: '2020-01-01', end_date: '2030-12-31' }];
    tenantData.splice(0, tenantData.length, ...prop.tenants);
    const inv = [
      { id: 'mp-i1', vendorName: 'Snow Co',   category: 'snow',       amount: 4000,  invoiceDate: '2024-02-10' },
      { id: 'mp-i2', vendorName: 'Clean Co',  category: 'janitorial', amount: 6000,  invoiceDate: '2024-06-30' },
      { id: 'mp-i3', vendorName: 'Insure Co', category: 'insurance',  amount: 10000, invoiceDate: '2024-11-01' },
    ];
    invoiceData.splice(0, invoiceData.length, ...inv); prop.invoices = inv;
    await saveProperty(prop);
    setCamYear(new Date().getFullYear());
    switchWorkspaceTab('cam'); renderInvResults();
  });
  await page.waitForTimeout(800);
  const thisYear = new Date().getFullYear();

  // ══ A ═════════════════════════════════════════════════════════════════════
  sec('A · the trap as found, with a way out on the same tab');
  const A0 = await read();
  is(A0.year, thisYear, 'the year defaults to the current calendar year');
  yes(A0.camSelect && A0.camSelect.visible && A0.camSelect.inPrepare, 'the CAM tab’s Prepare step carries the year selector, visible', JSON.stringify(A0.camSelect));
  yes(A0.camSelect && A0.camSelect.options.includes('2024') && A0.camSelect.options.includes(String(thisYear)), 'and it offers 2024', JSON.stringify(A0.camSelect && A0.camSelect.options));
  yes(new RegExp(`Dated in ${thisYear}\\s*0`).test(A0.prepFacts.replace(/·/g, ' ')), `Prepare reads Dated in ${thisYear}: 0`, A0.prepFacts);
  yes(/3 of 3 invoices are dated 2024/.test(A0.hint) && new RegExp(`none in ${thisYear}`).test(A0.hint), 'and says which year the invoices carry', A0.hint);
  await run();
  const A1 = await read();
  yes(A1.refusal && /not reconciled/i.test(A1.resultsTitle), 'Calculate is refused, as before', A1.resultsTitle);
  is(A1.refusalBtn, 'Change the CAM year ›', 'the refusal panel now has a "Change the CAM year" button');
  yes(/Not reconciled/.test(A1.calc), 'Calculate reads Not reconciled', A1.calc);

  // ══ F (early, while the refusal is on screen) ═════════════════════════════
  sec('F · the refusal button lands on the Prepare selector');
  const F = await page.evaluate(async () => {
    switchWorkspaceTab('property');
    document.querySelector('#resultsBody .cam-refusal .cam-refusal-year-btn').click();
    await new Promise(r => setTimeout(r, 700));
    return { tab: _activeWorkspaceTab, focused: document.activeElement && document.activeElement.id };
  });
  yes(F.tab === 'cam' && F.focused === 'camYearSelectCam', 'it switches to CAM and focuses the selector', JSON.stringify(F));

  // ══ B ═════════════════════════════════════════════════════════════════════
  sec('B · choosing 2024 on the CAM tab moves every year surface');
  await page.evaluate(() => { const s = document.getElementById('camYearSelectCam'); s.value = '2024'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(500);
  const B = await read();
  is(B.year, 2024, 'getCamYear() is 2024');
  is(B.badge, '2024 CAM', 'the header badge follows');
  is(B.propSelect, '2024', 'the Property Setup select follows');
  yes(/Dated in 2024\s*3/.test(B.prepFacts.replace(/·/g, ' ')), 'Prepare reads Dated in 2024: 3', B.prepFacts);
  is(B.hint, '', 'the hint goes quiet once the year has invoices');
  // And the other way round: Property Setup's select is the same authority.
  const B2 = await page.evaluate(async () => {
    const p = document.getElementById('camYearSelect'); p.value = '2023'; p.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const out = { year: getCamYear(), cam: document.getElementById('camYearSelectCam').value, badge: document.getElementById('camYearBadge').textContent };
    setCamYear(2024); await new Promise(r => setTimeout(r, 300));
    out.back = document.getElementById('camYearSelectCam').value;
    return out;
  });
  is({ y: B2.year, c: B2.cam, b: B2.badge, back: B2.back }, { y: 2023, c: '2023', b: '2023 CAM', back: '2024' }, 'changing the year in Property Setup moves the CAM selector too, and back');

  // ══ C ═════════════════════════════════════════════════════════════════════
  sec('C · Calculate produces the 2024 reconciliation');
  await run();
  const C = await read();
  yes(!C.refusal && C.results.length === 1 && C.results[0][0] === 'Maple Dental' && C.results[0][1] > 0, 'one tenant, allocated from the 2024 invoices', JSON.stringify(C.results));
  yes(Math.abs(C.results[0][1] - 20000 * 5000 / 26000) < 0.02, 'the share is 5,000 / 26,000 of the $20,000 2024 pool', String(C.results[0][1]));
  is(C.resultsTitle, '2024 CAM — Maple Plaza', 'the results title carries the year');
  yes(/Calculated/.test(C.calc) && C.stale === false, 'Calculate reads Calculated, results current');
  is(C.savedYear, 2024, 'the property remembers the year it was run for');

  // ══ D ═════════════════════════════════════════════════════════════════════
  sec('D · mixed years: a 2025 invoice is counted outside and not billed');
  await page.evaluate(() => { invoiceData.push({ id: 'mp-i4', vendorName: 'Roof Co', category: 'repairs', amount: 9000, invoiceDate: '2025-03-01' }); currentProperty().invoices = Array.from(invoiceData); });
  await run();
  const D = await read();
  yes(/Dated in 2024\s*3\s*[· ]*1 outside the year/.test(D.prepFacts), 'Prepare counts 3 in, 1 outside', D.prepFacts);
  yes(Math.abs(D.results[0][1] - 20000 * 5000 / 26000) < 0.02, 'the allocation is unchanged — the 2025 invoice is not in the 2024 pool', String(D.results[0][1]));

  // ══ E ═════════════════════════════════════════════════════════════════════
  sec('E · switching the year after a run: the page says the results are for another year');
  await page.evaluate(() => { const s = document.getElementById('camYearSelectCam'); s.value = '2025'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(500);
  const E1 = await read();
  yes(E1.banner === 'block' && /results are for 2024, not 2025/.test(E1.bannerText), 'the banner says the results are for 2024, not 2025', E1.bannerText);
  yes(E1.stale === false, 'nothing about the inputs changed, so this is not the edited-inputs stale flag');
  yes(/Re-run needed/.test(E1.calc), 'Calculate reads Re-run needed', E1.calc);
  yes(/results are for 2024/.test(E1.calcLast), 'and says why beneath the button', E1.calcLast);
  is(E1.resultsTitle, '2024 CAM — Maple Plaza', 'the results still say which year they are for');
  const G1 = await page.evaluate(GATES);
  yes(/Results are from 2024/.test(G1.exportToast || ''), 'the CSV export refuses, naming the results’ year', G1.exportToast);
  yes(/Results are from 2024|stale/i.test(G1.stmtToast || '') && !G1.overlayShown, 'the tenant statement refuses and opens nothing', JSON.stringify(G1));
  await page.evaluate(() => { const s = document.getElementById('camYearSelectCam'); s.value = '2024'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(400);
  const E2 = await read();
  yes(E2.banner === 'none' && /Calculated/.test(E2.calc) && E2.stale === false, 'switching back makes them current again with no run — nothing changed', JSON.stringify({ banner: E2.banner, calc: E2.calc }));
  const G2 = await page.evaluate(GATES);
  yes(!/Results are from|stale/i.test(G2.exportToast || ''), 'and the export is allowed again', G2.exportToast);
  // A genuine edit plus a year switch: the edit still holds after switching back.
  await page.evaluate(() => { const el = document.getElementById('ifield-0-amount'); setCamRegisterOpen(true); el.value = '4500'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => { const s = document.getElementById('camYearSelectCam'); s.value = '2025'; s.dispatchEvent(new Event('change', { bubbles: true })); s.value = '2024'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(400);
  const E3 = await read();
  yes(E3.stale === true && E3.banner === 'block' && /edited since the last run/.test(E3.bannerText), 'an edited register stays stale through a year round-trip', E3.bannerText);
  await run();
  const E4 = await read();
  yes(E4.stale === false && E4.banner === 'none' && /Calculated/.test(E4.calc), 'and the run clears it', JSON.stringify({ stale: E4.stale, calc: E4.calc }));

  // ══ G ═════════════════════════════════════════════════════════════════════
  sec('G · after a reload the property opens on the year it was run for');
  await boot();
  const G = await page.evaluate(async () => {
    const p = _props.find(x => x.name === 'Maple Plaza'); await selectProperty(p.id); await new Promise(r => setTimeout(r, 3000));
    switchWorkspaceTab('cam'); await new Promise(r => setTimeout(r, 400));
    return { year: getCamYear(), camSelect: document.getElementById('camYearSelectCam').value, propSelect: document.getElementById('camYearSelect').value,
             title: (document.getElementById('resultsTitle') || {}).textContent, results: lastResults.length, stale: _resultsStale };
  });
  is({ y: G.year, c: G.camSelect, p: G.propSelect }, { y: 2024, c: '2024', p: '2024' }, 'year, CAM selector and Property Setup selector all read 2024');
  yes(G.results === 1 && G.stale === false && /2024 CAM/.test(G.title || ''), 'the 2024 reconciliation is restored and current', JSON.stringify(G));

  sec('H · quiet page');
  is(errors, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
