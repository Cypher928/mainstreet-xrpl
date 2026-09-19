'use strict';
// test-e2e-vacancy.js
// ============================================================================
// MARK A SPACE VACANT, on the real page. Every surface that said "confirm the
// space is vacant" pointed at nothing: no control created a vacancy. Now the
// Spaces list carries "Mark space vacant"; the record is the existing
// `vacant: true` row (suite + area, no tenant); and the coverage finding, the
// variance breakdown and the Prepare facts read it. A vacancy is NEVER a
// tenant: it enters no allocation, renders no intake card, and — because it is
// not a reconciliation input — does not make a saved run stale.
//
// The demo: Cascade Commons, 26,000 sqft; five leases totalling 23,400 sqft
// (90.0% documented, 2,600 sqft / 10.0% unresolved).
//
//   1 · the manager can mark a space vacant from Spaces (suite + sqft)
//   2 · the vacancy persists across a reload
//   3 · the vacant space is a clearly-labelled Vacant row in Spaces
//   4 · coverage/readiness recognise the confirmed vacancy and say the
//       landlord absorbs that share (audit finding, variance, Prepare)
//   5 · the vacant space is not billable (not in getValidTenants, no result)
//   6 · the vacancy is not a fake tenant (no intake card, no name)
//   7 · repeated rendering / re-recording does not duplicate the record
//   8 · the occupied tenants and their charges are exactly what they were
//   + · recording a vacancy does not stale the results or change the inputs
//       fingerprint; refusals (no suite, no area, a leased suite) are explained
//
//   node test-e2e-vacancy.js
// ============================================================================
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8995;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.png':'image/png' };
const showroom = fs.readFileSync(path.join(ROOT, 'test-e2e-demo-showroom.js'), 'utf8');
const DB = showroom.slice(showroom.indexOf('const DB = `') + 12, showroom.indexOf('`;', showroom.indexOf('const DB = `')));

let pass = 0, fail = 0;
const yes = (c, m, d) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); } else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      → ${d}` : ''}`); } };
const is  = (a, b, m) => yes(JSON.stringify(a) === JSON.stringify(b), m, `expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`);
const sec = s => console.log(`\n── ${s} ──`);

const READ = `(() => {
  const T = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  const prop = currentProperty();
  const rows = Array.from(document.querySelectorAll('#spacesList .tsl-row')).map(r => ({
    suite: T(r.querySelector('.tsl-suite')), tenant: T(r.querySelector('.tsl-tenant')), sqft: T(r.querySelector('.tsl-sqft')),
    status: T(r.querySelector('.tsl-status')), vacant: r.classList.contains('tsl-row--vacant') }));
  const facts = {}; document.querySelectorAll('#camPrepFacts .cam-fact').forEach(f => { facts[T(f.querySelector('.cam-fact-l'))] = T(f.querySelector('.cam-fact-v')); });
  const findings = lastResults.length ? _detectReconciliationIssues(lastResults, prop).filter(f => f.kind === 'coverage').map(f => ({ sev: f.severity, title: f.title, detail: f.detail, conditions: f.conditions || [], blocks: !!f.blocksBilling })) : [];
  const summary = lastResults.length ? buildAuditSummary() : null;
  const panel = {}; document.querySelectorAll('#auditPanel .ap-section').forEach(s => { panel[s.dataset.bucket] = Array.from(s.querySelectorAll('.ap-flag-title')).map(T); });
  const bk = _lastVarianceBreakdown || null;
  const unc = bk ? (bk.lines || []).find(l => l.key === 'uncovered') : null;
  const step = (bk && window.VarianceBreakdown) ? window.VarianceBreakdown.nextStep(bk) : null;
  // The demo's largest bucket is the cap reduction, so the uncovered CTA is
  // probed on the real breakdown with the uncovered line as the only candidate.
  const stepUnc = (bk && window.VarianceBreakdown) ? window.VarianceBreakdown.nextStep(Object.assign({}, bk, { lines: (bk.lines || []).filter(l => l.key === 'uncovered') })) : null;
  const banner = T(document.querySelector('#resultsBody .rcs-vb-note'));
  const occupied = (prop.tenants || []).filter(t => t && t.vacant !== true).map(t => ({ id: t.id, name: t.tenant_name, sqft: String(t.leased_sqft), cap: t.cap ?? null, base: t.capBaseAmount ?? null }));
  const vacRows = (prop.tenants || []).filter(t => t && t.vacant === true);
  return {
    hasButton: !!document.getElementById('tslVacantBtn'), buttonText: T(document.getElementById('tslVacantBtn')),
    formOpen: !!document.getElementById('tslVacantForm'), formError: T(document.getElementById('tslVacantError')),
    uncovered: T(document.getElementById('tslUncovered')),
    summaryLine: T(document.querySelector('#spacesList .tsl-summary')),
    rows, facts,
    intakeCards: document.querySelectorAll('#bulkResults .bulk-tenant-row').length,
    valid: getValidTenants().map(t => t.tenant_name),
    prepTenants: _camPrepState().tenants.length,
    tenantDataLen: tenantData.filter(Boolean).length,
    tenantDataVacant: tenantData.filter(t => t && t.vacant === true).length,
    propVacant: vacRows.map(t => ({ id: t.id, name: t.tenant_name, suite: t.suite, sqft: t.leased_sqft, vacant: t.vacant })),
    occupied,
    results: lastResults.map(r => [r.name, Math.round(r.totalAllocated * 100) / 100, Math.round((r.proRataPercent || 0) * 100) / 100]),
    resultNames: lastResults.map(r => r.name),
    stale: _resultsStale, unverified: _resultsUnverified,
    fp: camInputsFingerprint(prop.tenants, invoiceData),
    findings, panel,
    audit: summary ? { red: summary.red.length, yellow: summary.yellow.length, green: summary.green.length } : null,
    verdict: _lastBillingVerdict ? { canBill: _lastBillingVerdict.readiness.canBill, blockers: (_lastBillingVerdict.readiness.blockers || []).map(x => x.title).sort() } : null,
    bk: bk ? { vacantPct: bk.vacantPct, unresolvedPct: bk.unresolvedPct, vacantResolved: bk.vacantResolved, uncovered: bk.uncovered, gapPct: bk.gapPct, label: unc ? unc.label : null, detail: unc ? unc.detail : null } : null,
    step, stepUnc, banner,
    confirmed: _confirmedVacancy(prop),
    calc: T(document.querySelector('#camStepCalculate .cam-step-status')),
    activity: (activityLog || []).filter(a => a.type === 'space_marked_vacant').length,
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
      && typeof lastResults !== 'undefined' && lastResults.length > 0 && document.getElementById('auditPanel'), null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { switchWorkspaceTab('spaces'); });
    await page.waitForTimeout(500);
  };
  const read = () => page.evaluate(READ);
  const run  = () => page.evaluate(async () => { switchWorkspaceTab('cam'); await runAllocation(); await new Promise(r => setTimeout(r, 2500)); });

  await boot();

  // ══ 0 · as shipped ════════════════════════════════════════════════════════
  sec('0 · as the demo ships: 90% documented, 2,600 sqft unresolved, and a way to say it is vacant');
  const D0 = await read();
  yes(D0.hasButton && /Mark space vacant/.test(D0.buttonText), 'the Spaces list carries "Mark space vacant"', JSON.stringify({ b: D0.hasButton, t: D0.buttonText }));
  yes(/2,600 of 26,000 sq ft is not under a loaded lease or recorded as vacant/.test(D0.uncovered || ''), 'the uncovered remainder is shown with the building total', D0.uncovered);
  yes(/mark it vacant/i.test(D0.uncovered || '') && /never billed/i.test(D0.uncovered || '') && /landlord/i.test(D0.uncovered || ''), 'and it says what marking vacant means: never billed, the landlord’s share', D0.uncovered);
  is(D0.rows.length, 5, 'five spaces, all occupied');
  is(D0.propVacant, [], 'no vacancy recorded');
  is(D0.findings.map(f => [f.sev, f.title]), [['yellow', 'Property CAM coverage: 90.0% documented · 10.0% unresolved']], 'the coverage finding is yellow and unresolved');
  // gapPct is 100 minus the sum of two-decimal display shares, so 10.01 here.
  yes(D0.bk && D0.bk.vacantPct === 0 && D0.bk.vacantResolved === false && Math.abs(D0.bk.gapPct - 10) < 0.05 && Math.abs(D0.bk.unresolvedPct - 10) < 0.05, 'the variance breakdown carries no vacancy: 10% unresolved', JSON.stringify(D0.bk));
  yes(D0.stepUnc && D0.stepUnc.key === 'uncovered' && /mark the space vacant/i.test(D0.stepUnc.cta), 'the uncovered line’s next step names marking the space vacant', JSON.stringify(D0.stepUnc));
  yes(!D0.stale, 'results current');
  const BASE = { results: D0.results, occupied: D0.occupied, fp: D0.fp, valid: D0.valid, verdict: D0.verdict, intake: D0.intakeCards, uncovered: D0.bk.uncovered, audit: D0.audit };

  // ══ 1 · mark a space vacant ═══════════════════════════════════════════════
  sec('1 · Mark space vacant → suite + sqft → Save: a vacancy record');
  await page.evaluate(() => document.getElementById('tslVacantBtn').click());
  await page.waitForTimeout(300);
  const F = await page.evaluate(() => ({ open: !!document.getElementById('tslVacantForm'), focused: document.activeElement && document.activeElement.id,
    note: (document.querySelector('#tslVacantForm .tsl-vf-note') || {}).textContent || '' }));
  yes(F.open && F.focused === 'tslVacSuite', 'the inline form opens with the suite field focused', JSON.stringify(F));
  yes(/not a tenant/i.test(F.note) && /no CAM allocation/i.test(F.note) && /does not change a saved reconciliation/i.test(F.note), 'the form says what it records: a space, not a tenant', F.note);
  await page.fill('#tslVacSuite', '106');
  await page.fill('#tslVacSqft', '2,600');
  await page.evaluate(() => document.querySelector('#tslVacantForm .tsl-vf-save').click());
  await page.waitForTimeout(900);
  const D1 = await read();
  yes(!D1.formOpen, 'the form closes on save');
  is(D1.propVacant.map(v => ({ name: v.name, suite: v.suite, sqft: v.sqft, vacant: v.vacant })), [{ name: '', suite: '106', sqft: 2600, vacant: true }], 'one vacancy record: suite 106, 2,600 sqft, vacant: true, no tenant name');
  yes(D1.propVacant[0].id && String(D1.propVacant[0].id).length > 8, 'it carries a stored record id', String(D1.propVacant[0].id));
  is(D1.tenantDataVacant, 1, 'and it is in the working buffer once');
  is(D1.activity, 1, 'the activity log records the vacancy');
  yes(D1.uncovered == null, 'the uncovered-remainder note is gone — the building is accounted for', D1.uncovered);

  // ══ 3 · represented in Spaces ═════════════════════════════════════════════
  // ══ 1b · every surface that counts spaces agrees, with no reload ══════════
  // The Property tab's header was drawn when the property opened and not
  // redrawn here, so it went on saying "0 Vacant" until a reload; and the
  // Property Information panel and the AI summary counted the vacancy as a
  // tenant and its area as occupied. All of them now read one definition.
  sec('1b · the Property header, Property Information and the AI summary all say 5 occupied · 1 vacant, immediately');
  const S1 = await page.evaluate(() => {
    const T = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    switchWorkspaceTab('property');
    const snap = Array.from(document.querySelectorAll('#propertyOsBody .pcv-snap-cell')).map(T);
    const strip = T(document.getElementById('propertyKpiHeader'));
    const info = window.PropertyReference.infoFor(currentProperty());
    const occ = window.PropertyReference.occupancyPct(currentProperty());
    const p = currentProperty();
    const ai = window.AIWorkspace.answer({ question: 'Summarize ' + p.name, context: { propertyId: p.id }, wctx: { propertyId: p.id }, props: _props });
    switchWorkspaceTab('spaces');
    return { snap, strip, numSpaces: info.numSpaces, occ, aiFirst: (ai.paragraphs || [])[0] || '' };
  });
  is(S1.snap, ['26,000 SFTotal size', '6Spaces', '5Occupied', '1Vacant', '90%Occupancy'], 'the Property header already shows 6 spaces · 5 occupied · 1 vacant · 90% — no reload');
  yes(/5 tenant spaces/.test(S1.strip || '') && /90%/.test(S1.strip || ''), 'the KPI strip above the tabs agrees: 5 tenant spaces, 90%', S1.strip);
  is(S1.numSpaces, 6, 'Property Information counts six spaces — a vacancy is a space');
  is(S1.occ, 90, 'and its Occupancy is 90%, from occupied area, not 100%');
  yes(/^5 tenants, 90% occupied/.test(S1.aiFirst), 'the AI summary says "5 tenants, 90% occupied"', S1.aiFirst);

  sec('3 · the vacant space is a clearly-labelled row in Spaces');
  const vac = D1.rows.find(r => r.vacant);
  yes(vac && vac.suite === '106' && vac.tenant === 'Vacant' && vac.status === 'Vacant' && vac.sqft === '2,600', 'row: Suite 106 · Vacant · 2,600 · Vacant badge', JSON.stringify(vac));
  is(D1.rows.length, 6, 'six rows: five occupied and the vacancy');
  is(D1.summaryLine, '6 spaces · 5 occupied · 1 vacant · 23,400 sq ft leased', 'the summary counts it as vacant, not as leased area');

  // ══ 5–6 · never a tenant, never billable ══════════════════════════════════
  sec('5–6 · the vacancy is not a tenant: not billable, no intake card, no name');
  is(D1.valid, BASE.valid, 'getValidTenants() is unchanged — the vacancy is not in the allocation set');
  is(D1.prepTenants, 5, '_camPrepState counts five leases, not six');
  is(D1.intakeCards, BASE.intake, 'no Lease Intake card is rendered for the vacancy');
  is(D1.facts['Leases ready'].split(' ')[0], '5', 'Prepare: Leases ready 5');
  is(D1.facts['Recorded vacant'], '1 space · 2,600 sqft · landlord absorbs', 'Prepare: Recorded vacant 1 space · 2,600 sqft · landlord absorbs');
  is(D1.confirmed, { count: 1, sqft: 2600, pct: 10 }, '_confirmedVacancy: 1 space, 2,600 sqft, 10%');

  // ══ + · not a reconciliation input ════════════════════════════════════════
  sec('+ · recording a vacancy is not a change to the reconciliation inputs');
  is(D1.stale, false, 'results are not marked stale');
  is(D1.fp, BASE.fp, 'the inputs fingerprint is identical');
  is(D1.results, BASE.results, 'the results on screen did not move');
  yes(/Calculated/.test(D1.calc), 'Calculate still reads Calculated', D1.calc);

  // ══ 4 · coverage recognises it ════════════════════════════════════════════
  sec('4 · coverage/readiness recognise the confirmed vacancy without a re-run');
  is(D1.findings.map(f => [f.sev, f.title, f.blocks]), [['green', 'Property CAM coverage: 90.0% documented · 10.0% confirmed vacant', false]], 'the coverage finding is green: 90.0% documented · 10.0% confirmed vacant, not blocking');
  yes(/landlord's/.test(D1.findings[0].detail) && /no tenant is billed for it/.test(D1.findings[0].detail) && /no lease is missing/.test(D1.findings[0].detail), 'it says the vacant share is the landlord’s and no lease is missing', D1.findings[0].detail);
  yes(D1.findings[0].conditions.some(c => /Confirmed vacant: 10\.00% \(2,600 sqft, 1 space\)/.test(c)) && D1.findings[0].conditions.some(c => /landlord absorbs/.test(c)), 'its conditions carry the vacant share and who absorbs it', JSON.stringify(D1.findings[0].conditions));
  yes((D1.panel.advisory || []).some(t => /10\.0% confirmed vacant/.test(t)) && !Object.keys(D1.panel).filter(k => k !== 'advisory').some(k => D1.panel[k].some(t => /Property CAM coverage/.test(t))), 'the audit panel re-rendered: the finding sits under Advisory and nowhere else', JSON.stringify(D1.panel));
  is(D1.audit, { red: BASE.audit.red, yellow: BASE.audit.yellow - 1, green: BASE.audit.green + 1 }, 'one finding moved from yellow to green; nothing else changed');
  is(D1.verdict, BASE.verdict, 'the billing verdict is exactly what it was (the coverage finding never blocked)');

  // ══ 4b · a re-run reads the same vacancy into the variance explanation ═══
  sec('4b · re-run: same charges; the variance explanation names the vacancy and stops asking for a lease');
  await run();
  const D2 = await read();
  is(D2.results, BASE.results, 'every charge and share is identical after the re-run');
  is(D2.resultNames.length, 5, 'five results — the vacancy produced none');
  yes(D2.bk && D2.bk.vacantPct === 10 && Math.abs(D2.bk.unresolvedPct) < 0.05 && D2.bk.vacantResolved === true, 'the breakdown reads 10% vacant, nothing unresolved beyond display rounding, resolved', JSON.stringify(D2.bk));
  is(D2.bk.uncovered, BASE.uncovered, 'the uncovered bucket amount is unchanged — explanation, not arithmetic');
  yes(/\(10\.0% recorded vacant\)/.test(D2.bk.label || ''), 'the uncovered line is labelled with the recorded vacancy', D2.bk.label);
  yes(/landlord's/.test(D2.bk.detail || '') && /no lease is missing/.test(D2.bk.detail || ''), 'its detail says the share is the landlord’s and no lease is missing', D2.bk.detail);
  is(D2.stepUnc, null, 'the uncovered line no longer yields a next step — nothing is missing');
  yes(D2.step && D2.step.key === D0.step.key, 'the breakdown’s overall next step is what it was (the cap bucket)', JSON.stringify([D0.step, D2.step]));
  yes(/is the landlord's: 10\.0% of the property is recorded as vacant/.test(D2.banner || ''), 'the summary banner says the landlord absorbs the recorded vacant share', D2.banner);
  yes(!/has not been established/.test(D2.banner || ''), 'and no longer calls the cause unestablished', D2.banner);
  is(D2.findings.map(f => f.sev), ['green'], 'the coverage finding is green on the fresh run too');
  is(D2.verdict, BASE.verdict, 'the billing verdict is unchanged');
  yes(!D2.stale, 'results current');
  await page.evaluate(() => switchWorkspaceTab('spaces'));
  await page.waitForTimeout(300);

  // ══ 7 · no duplicates ═════════════════════════════════════════════════════
  sec('7 · repeated rendering and re-recording do not duplicate the record');
  const D3 = await page.evaluate(async () => {
    const prop = currentProperty();
    for (let i = 0; i < 5; i++) { TenantSpace.renderList(prop); renderBulkResults(); renderCamWorkflow(); }
    if (window.PropertyCabinetView && PropertyCabinetView.render) { try { PropertyCabinetView.render(prop); } catch (_) {} }
    await new Promise(r => setTimeout(r, 400));
    const again = recordVacantSpace('106', '2,700');      // same suite, new area
    const again2 = recordVacantSpace(' 106 ', 2600);      // whitespace, back to 2,600
    await new Promise(r => setTimeout(r, 400));
    return {
      again: { ok: again.ok, updated: again.updated }, again2: { ok: again2.ok, updated: again2.updated },
      propVac: currentProperty().tenants.filter(t => t && t.vacant === true).map(t => [t.suite, t.leased_sqft]),
      bufVac: tenantData.filter(t => t && t.vacant === true).length,
      rows: document.querySelectorAll('#spacesList .tsl-row--vacant').length,
      intake: document.querySelectorAll('#bulkResults .bulk-tenant-row').length,
      stale: _resultsStale,
    };
  });
  yes(D3.again.ok && D3.again.updated && D3.again2.ok && D3.again2.updated, 'recording the same suite again updates it rather than adding', JSON.stringify(D3));
  is(D3.propVac, [['106', 2600]], 'one vacancy record on the property, at the last area given');
  is(D3.bufVac, 1, 'one in the working buffer');
  is(D3.rows, 1, 'one Vacant row after five re-renders');
  is(D3.intake, BASE.intake, 'still no intake card');
  is(D3.stale, false, 'still not stale');

  // ══ 5b · a NAMED vacant row is still not a tenant ═════════════════════════
  // Older fixtures label a vacant row tenant_name: 'Vacant'. The exclusions
  // must hold on the flag, not on the absence of a name — otherwise a row
  // labelled "Vacant" with an area is a billable tenant called Vacant.
  sec('5b · a vacant row that carries a name is still not billable, not a lease, not a card');
  const N = await page.evaluate(async () => {
    const rows = [tenantData, currentProperty().tenants].flat().filter(t => t && t.vacant === true);
    rows.forEach(t => { t.tenant_name = 'Vacant'; });
    renderBulkResults(); renderCamWorkflow();
    await new Promise(r => setTimeout(r, 200));
    const out = { valid: getValidTenants().map(t => t.tenant_name), prep: _camPrepState().tenants.length,
      cards: document.querySelectorAll('#bulkResults .bulk-tenant-row').length,
      fp: camInputsFingerprint(currentProperty().tenants, invoiceData), stale: _resultsStale };
    rows.forEach(t => { t.tenant_name = ''; });
    renderBulkResults(); renderCamWorkflow();
    return out;
  });
  is(N.valid, BASE.valid, 'getValidTenants() still excludes it by the flag');
  is(N.prep, 5, '_camPrepState still counts five');
  is(N.cards, BASE.intake, 'still no intake card');
  is(N.fp, BASE.fp, 'the fingerprint still ignores it');
  is(N.stale, false, 'and nothing went stale');

  // ══ + · refusals ══════════════════════════════════════════════════════════
  sec('+ · what it refuses, and says why');
  const R = await page.evaluate(async () => {
    const out = {};
    out.noSuite = recordVacantSpace('', 500);
    out.noArea  = recordVacantSpace('107', 'abc');
    out.zero    = recordVacantSpace('107', 0);
    const whm = tenantData.find(t => t && t.tenant_name === 'Whole Health Market');
    whm.suite = '100';
    out.leased  = recordVacantSpace('100', 500);
    delete whm.suite;
    // Through the form: an empty suite shows the error inline.
    TenantSpace.openVacantForm();
    document.getElementById('tslVacSqft').value = '400';
    document.querySelector('#tslVacantForm .tsl-vf-save').click();
    await new Promise(r => setTimeout(r, 300));
    out.formError = (document.getElementById('tslVacantError') || {}).textContent || null;
    out.formStillOpen = !!document.getElementById('tslVacantForm');
    TenantSpace.closeVacantForm();
    out.vac = currentProperty().tenants.filter(t => t && t.vacant === true).length;
    return out;
  });
  yes(!R.noSuite.ok && /suite/i.test(R.noSuite.error), 'no suite → refused, asks for the suite', JSON.stringify(R.noSuite));
  yes(!R.noArea.ok && /square feet/i.test(R.noArea.error) && !R.zero.ok, 'no usable area → refused, asks for the area', JSON.stringify([R.noArea, R.zero]));
  yes(!R.leased.ok && /Whole Health Market/.test(R.leased.error) && /under a loaded lease/i.test(R.leased.error), 'a suite under a loaded lease → refused, names the lease', JSON.stringify(R.leased));
  yes(R.formStillOpen && /suite/i.test(R.formError || ''), 'the form shows the refusal inline and stays open', JSON.stringify({ e: R.formError, o: R.formStillOpen }));
  is(R.vac, 1, 'none of the refusals recorded anything');

  // ══ 2 · persists across a reload ══════════════════════════════════════════
  sec('2 · after a reload the vacancy is still there, and the saved reconciliation is still current');
  await boot();
  const D4 = await read();
  is(D4.propVacant.map(v => ({ suite: v.suite, sqft: Number(v.sqft), vacant: v.vacant, name: v.name || '' })), [{ suite: '106', sqft: 2600, vacant: true, name: '' }], 'the vacancy record survived the reload');
  is(D4.rows.filter(r => r.vacant).map(r => [r.suite, r.status, r.sqft]), [['106', 'Vacant', '2,600']], 'Spaces shows Suite 106 as Vacant');
  is(D4.summaryLine, '6 spaces · 5 occupied · 1 vacant · 23,400 sq ft leased', 'the summary is the same');
  is(D4.valid, BASE.valid, 'still not in the allocation set');
  is(D4.intakeCards, BASE.intake, 'still no intake card');
  yes(D4.stale === false && D4.unverified === false, 'the restored reconciliation is current — a vacancy is not an input, so nothing needs re-running', JSON.stringify({ stale: D4.stale, unverified: D4.unverified }));
  is(D4.fp, BASE.fp, 'the inputs fingerprint on the reloaded property equals the original');
  is(D4.results, BASE.results, 'the restored charges are the original charges');
  is(D4.findings.map(f => [f.sev, f.title]), [['green', 'Property CAM coverage: 90.0% documented · 10.0% confirmed vacant']], 'the coverage finding is green on the restored path');
  is(D4.facts['Recorded vacant'], '1 space · 2,600 sqft · landlord absorbs', 'Prepare still shows the recorded vacancy');

  // ══ 2b · the portfolio card, after the reload ═════════════════════════════
  // The first screen a manager sees. It said "100% Occupied · 6 Tenants" of
  // this building with the vacancy recorded; it counts occupied tenants now.
  sec('2b · the portfolio card says 5 tenants and 90% occupied');
  const CARD = await page.evaluate(async () => {
    const T = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    const id = currentProperty().id;
    ccShowPortfolio();
    await new Promise(r => setTimeout(r, 700));
    const card = Array.from(document.querySelectorAll('.ptf-prop-card')).find(c => /Cascade Commons/.test(T(c)));
    const stats = card ? Array.from(card.querySelectorAll('.ptf-stat')).map(T) : null;
    selectProperty(id);
    await new Promise(r => setTimeout(r, 2000));
    switchWorkspaceTab('spaces');
    return { stats };
  });
  // The portfolio-level KPI beside the cards is a portfolio-wide figure over
  // every property and is pinned by test-vacancy.js C2; the card is the
  // per-property statement a manager reads first, and it is what was wrong.
  yes(CARD.stats && CARD.stats[0] === '90%Occupied' && CARD.stats[1] === '5Tenants', 'the card reads 90% Occupied · 5 Tenants', JSON.stringify(CARD.stats));

  // ══ 8 · occupied tenants unchanged ════════════════════════════════════════
  sec('8 · the occupied tenants are exactly what they were');
  is(D4.occupied, BASE.occupied, 'five occupied tenants: id, name, sqft, cap and base unchanged');
  is(D4.verdict, BASE.verdict, 'the billing verdict is unchanged');

  sec('9 · quiet page');
  is(errors, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
