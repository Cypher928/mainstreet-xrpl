'use strict';
// test-e2e-cap-resolution.js
// ============================================================================
// CAM CAP UNRESOLVED → ENTER PRIOR-YEAR BASE → RE-RUN → CAP APPLIED, on the
// real page. A tenant with a cap on file and no prior-year base used to be
// told "Cap type needs confirmation before MainStreet can determine whether a
// base is required" — a control that does not exist, for a step that is not
// required — with no button; and the "CAM cap unresolved" banner was never
// cleared, so two runs showed it twice and a resolved cap still sat under it.
//
//   1 · cap present + base missing → the unresolved warning appears, worded
//       for what is actually missing
//   2 · the warning offers "Add cap base"
//   3 · the action opens the Lease Intake row on the Prior-Year CAM Base field
//   4 · entering the base marks the results as needing a re-run
//   5 · recalculate → the cap is enforced
//   6 · the unresolved warning is gone
//   7 · repeated unresolved runs show one warning, not two
//   8 · the other capped tenants are exactly what they were throughout
//
//   node test-e2e-cap-resolution.js
// ============================================================================
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8994;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.png':'image/png' };
const showroom = fs.readFileSync(path.join(ROOT, 'test-e2e-demo-showroom.js'), 'utf8');
const DB = showroom.slice(showroom.indexOf('const DB = `') + 12, showroom.indexOf('`;', showroom.indexOf('const DB = `')));

let pass = 0, fail = 0;
const yes = (c, m, d) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); } else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      → ${d}` : ''}`); } };
const is  = (a, b, m) => yes(JSON.stringify(a) === JSON.stringify(b), m, `expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`);
const sec = s => console.log(`\n── ${s} ──`);

const WHM = 'Whole Health Market';
const READ = `(() => {
  const T = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  const warns = Array.from(document.querySelectorAll('#results .cam-cap-incomplete-warning'));
  const t = currentProperty().tenants.find(x => x && x.tenant_name === ${JSON.stringify(WHM)});
  const st = window.LeaseIntelligence.deriveCapState(t);
  const r = lastResults.find(x => x.name === ${JSON.stringify(WHM)}) || {};
  return {
    warnings: warns.length, warningText: warns.map(T).join(' || '),
    warningButtons: warns.flatMap(w => Array.from(w.querySelectorAll('button')).map(b => ({ label: b.textContent.trim(), onclick: b.getAttribute('onclick') || '' }))),
    state: st.state, actionable: st.actionable, field: st.field, base: t.capBaseAmount, title: st.title,
    capApplied: !!r.capApplied, capAdjustment: r.capAdjustment || null, allocated: r.totalAllocated,
    others: Object.fromEntries(lastResults.filter(x => x.name !== ${JSON.stringify(WHM)}).map(x => [x.name, [x.totalAllocated, !!x.capApplied]])),
    stale: _resultsStale, calc: T(document.querySelector('#camStepCalculate .cam-step-status')),
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
  await page.waitForTimeout(500);
  const read = () => page.evaluate(READ);
  const run  = () => page.evaluate(async () => { await runAllocation(); await new Promise(r => setTimeout(r, 2500)); });
  const setBase = v => page.evaluate((v) => { [tenantData, currentProperty().tenants].flat().filter(t => t && t.tenant_name === 'Whole Health Market').forEach(t => { t.capBaseAmount = v; }); }, v);

  // ══ 0 · as shipped: every capped tenant enforced, no warning ══════════════
  sec('0 · as the demo ships');
  const D0 = await read();
  yes(D0.warnings === 0 && D0.state === 'enforced' && D0.capApplied, 'no warning; Whole Health Market’s cap is enforced', JSON.stringify({ w: D0.warnings, s: D0.state }));
  const OTHERS = D0.others;

  // ══ 1–2 · cap present, base missing ══════════════════════════════════════
  sec('1–2 · cap on file, no prior-year base: the warning appears, worded for what is missing, with the action');
  await setBase(null); await run();
  const D1 = await read();
  is(D1.warnings, 1, 'exactly one unresolved-cap warning');
  yes(/CAM cap unresolved for 1 tenant/.test(D1.warningText), 'it names the count', D1.warningText);
  yes(/no prior-year CAM base/i.test(D1.warningText) && /not being applied/i.test(D1.warningText), 'it says the base is what is missing and the cap is not applied', D1.warningText);
  yes(/applies it as a percentage/i.test(D1.warningText), 'and how the cap will be applied once the base is entered', D1.warningText);
  yes(!/Cap type needs confirmation|whether a base is required/i.test(D1.warningText), 'the old sentence is gone', D1.warningText);
  yes(/Whole Health Market/.test(D1.warningText), 'it names the tenant');
  is(D1.state, 'unit_unconfirmed', 'the cap state is unchanged — the unit is still unconfirmed');
  yes(D1.actionable === true && D1.field === 'cap_base_amount', 'and the state offers the base field');
  yes(/prior-year base needed/i.test(D1.title) && !/Cap type needs confirmation/i.test(D1.title), 'the state’s title names the base, not a cap type', D1.title);
  yes(D1.warningButtons.length === 1 && /Add cap base/.test(D1.warningButtons[0].label) && /openReviewItemFix\(.*'cap_base_amount'\)/.test(D1.warningButtons[0].onclick), 'the warning carries one "Add cap base →" button on the existing fix path', JSON.stringify(D1.warningButtons));
  yes(D1.capApplied === false, 'and the cap is genuinely not applied in these results');
  is(D1.others, OTHERS, '8 · the other capped tenants are exactly what they were');

  // ══ 3 · the action lands on the field ════════════════════════════════════
  sec('3 · "Add cap base" opens the Lease Intake row on Prior-Year CAM Base');
  const F = await page.evaluate(async () => {
    document.querySelector('#results .cam-cap-incomplete-warning button').click();
    await new Promise(r => setTimeout(r, 900));
    const a = document.activeElement;
    const label = a && a.closest('.field') ? (a.closest('.field').querySelector('label') || {}).textContent : '';
    return { tab: _activeWorkspaceTab, tag: a && a.tagName, onblur: a ? (a.getAttribute('onblur') || '') : '', label: (label || '').replace(/\s+/g, ' ').trim().slice(0, 40),
             detailOpen: (() => { const i = tenantData.findIndex(t => t && t.tenant_name === 'Whole Health Market'); const d = document.getElementById('bdet-' + i); return !!d && getComputedStyle(d).display !== 'none'; })() };
  });
  yes(F.tab === 'spaces' && F.detailOpen, 'the Spaces tab opens with the tenant’s Lease Intake detail expanded', JSON.stringify(F));
  yes(F.tag === 'INPUT' && /capBaseAmount/.test(F.onblur) && /^Prior-Year CAM Base/.test(F.label), 'and the Prior-Year CAM Base input has focus', JSON.stringify(F));

  // ══ 4 · entering the base ════════════════════════════════════════════════
  sec('4 · entering the base through that field makes the results need a re-run');
  const E = await page.evaluate(async () => {
    const el = document.activeElement; el.value = '33000'; el.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 800));
    switchWorkspaceTab('cam');
    return null;
  });
  const D2 = await read();
  yes(D2.base !== null && Number(D2.base) === 33000, 'the base is on the tenant', String(D2.base));
  yes(D2.stale === true && /Re-run needed/.test(D2.calc), 'results are marked stale, Calculate reads Re-run needed', JSON.stringify({ stale: D2.stale, calc: D2.calc }));
  yes(D2.capApplied === false && D2.warnings === 1, 'nothing is applied and the warning stays until the re-run', JSON.stringify({ applied: D2.capApplied, w: D2.warnings }));

  // ══ 5–6 · recalculate ════════════════════════════════════════════════════
  sec('5–6 · recalculate: the cap is enforced and the warning is gone');
  await run();
  const D3 = await read();
  is(D3.state, 'enforced', 'the cap state is enforced');
  yes(D3.capApplied === true && D3.capAdjustment > 0, 'the cap is applied with a reduction', JSON.stringify({ applied: D3.capApplied, adj: D3.capAdjustment }));
  yes(Math.abs(D3.allocated - 33000 * 1.05) < 0.02, 'at the ceiling base × (1 + 5%)', String(D3.allocated));
  is(D3.warnings, 0, 'no unresolved-cap warning remains on the page');
  yes(D3.stale === false && /Calculated/.test(D3.calc), 'results current', JSON.stringify({ stale: D3.stale, calc: D3.calc }));
  is(D3.others, OTHERS, '8 · the other capped tenants are exactly what they were');

  // ══ 7 · repeated unresolved runs ═════════════════════════════════════════
  sec('7 · repeated unresolved runs show one warning, not two');
  await setBase(null); await run(); await run(); await run();
  const D4 = await read();
  is(D4.warnings, 1, 'three unresolved runs, one warning');
  await setBase('33000'); await run();
  const D5 = await read();
  yes(D5.warnings === 0 && D5.capApplied === true, 'resolved again: no warning, cap applied');
  is(D5.others, OTHERS, '8 · the other capped tenants are exactly what they were');

  sec('9 · quiet page');
  is(errors, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
