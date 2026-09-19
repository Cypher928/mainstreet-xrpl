'use strict';
// test-e2e-demo-discoverability.js
// ============================================================================
// THE DEMO PROPERTIES ARE REACHABLE FROM A PORTFOLIO THAT IS NOT EMPTY.
//
// Every route into loadDemo() sat inside the zero-properties branch of
// renderPortfolio: the "Open Demo" cards, the "Try Live Demo" button, and the
// welcome panel, which _maybeShowWelcome dismisses permanently the moment a real
// property exists. Measured on the pilot preview: a manager with one property of
// their own had NO control anywhere in the product that would seed or open
// Cascade Commons or Northgate Exchange, and the only way in was to call
// loadDemo() from the browser console. The seeders were fine. They were
// unreachable.
//
//   1 · an account with no properties still sees the demo cards (unchanged)
//   2 · an account WITH a real property now sees them too
//   3 · nothing is seeded until the manager chooses — opt-in, not on load
//   4 · choosing one seeds Cascade AND Northgate, exactly once each
//   5 · the manager's own property is untouched
//   6 · Northgate is then an ordinary portfolio card, badged DEMO
//   7 · a reload duplicates nothing, and the invitation withdraws
//   8 · Cascade is there too, still refusing, for the contrast
//
//   node test-e2e-demo-discoverability.js
// ============================================================================
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8970;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.png':'image/png' };
const showroom = fs.readFileSync(path.join(ROOT, 'test-e2e-demo-showroom.js'), 'utf8');
const DB = showroom.slice(showroom.indexOf('const DB = `') + 12, showroom.indexOf('`;', showroom.indexOf('const DB = `')));

let pass = 0, fail = 0;
const yes = (c, m, d) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); } else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      → ${d}` : ''}`); } };
const is  = (a, b, m) => yes(JSON.stringify(a) === JSON.stringify(b), m, `expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`);
const sec = s => console.log(`\n── ${s} ──`);

const USER = 'showroom-user-0001-4000-a000-000000000001';
const MAPLE_ID = 'aaaa1111-2222-4000-a000-maple00000001';

// The manager's own property, already in the account before the demo is ever
// opened. Written straight into the mock store so the account starts the way a
// pilot account does: one real building, no demos.
// Runs on EVERY navigation, so it must seed only once. Overwriting the store on
// each reload would wipe whatever the app had persisted and the test would be
// measuring its own fixture rather than the product.
const SEED_REAL = `
(function(){
  var s = {};
  try { s = JSON.parse(localStorage.getItem('__mockdb') || '{}'); } catch (e) { s = {}; }
  if (Array.isArray(s.properties) && s.properties.length) return;
  s.properties = [{
    id: ${JSON.stringify(MAPLE_ID)}, user_id: ${JSON.stringify(USER)},
    name: 'Maple Plaza', sqft: 18000, archived_at: null,
    data: { camYear: 2025, invoices: [], disputes: [], timeline: [], results: null }
  }];
  s.tenants = [
    { id: 'ttt11111-0000-4000-a000-maple0000t1', property_id: ${JSON.stringify(MAPLE_ID)},
      name: 'Maple Dry Goods', sqft: 5200, cap: null,
      start_date: '2022-01-01', end_date: '2027-12-31', lease_type: 'NNN', lease_url: null },
    { id: 'ttt22222-0000-4000-a000-maple0000t2', property_id: ${JSON.stringify(MAPLE_ID)},
      name: 'Maple Barber Co', sqft: 1400, cap: null,
      start_date: '2023-06-01', end_date: '2028-05-31', lease_type: 'NNN', lease_url: null }
  ];
  localStorage.setItem('__mockdb', JSON.stringify(s));
})();`;

// What the portfolio is showing, and what the account actually holds.
const READ = `(() => {
  const T = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  const grid = document.getElementById('propertyCardsGrid');
  const store = (() => { try { return JSON.parse(localStorage.getItem('__mockdb') || '{}'); } catch (e) { return {}; } })();
  const rows = (store.properties || []);
  return {
    demoSectionTitle: T(document.querySelector('.ptf-demo-section-title')),
    demoCards: Array.from(document.querySelectorAll('.ptf-prop-card.ptf-demo-card'))
      .map(c => ({ name: T(c.querySelector('.ptf-prop-name')), onclick: c.getAttribute('onclick') })),
    realCards: Array.from(document.querySelectorAll('.ptf-prop-card:not(.ptf-demo-card)'))
      .map(c => ({ name: T(c.querySelector('.ptf-prop-name')),
                   demoBadge: !!c.querySelector('.ptf-demo-badge') })),
    propsInMemory: (_props || []).map(p => p.name).sort(),
    // Rows actually persisted, counted per id so a duplicate would show up.
    storedIds: rows.map(r => r.id).sort(),
    storedByName: rows.reduce((a, r) => { a[r.name] = (a[r.name] || 0) + 1; return a; }, {}),
    demoIds: { cascade: DEMO_PROPERTY_ID, northgate: NORTHGATE_PROPERTY_ID },
    welcomePanel: (() => { const p = document.getElementById('demoWelcomePanel');
      return p ? (p.style.display !== 'none') : null; })(),
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

  // ══ 1 · the existing flow, on an account with nothing in it ═══════════════
  sec('1 · an account with no properties still gets the demo cards');
  {
    const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
    for (const p of ['**cdnjs**', '**jsdelivr**']) await page.route(p, r => r.fulfill({ status: 200, body: '' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.addInitScript('window.__TEST_AUTHED=true;');
    await page.addInitScript(DB);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    await page.evaluate(() => { try { MainStreetLanding.hide(); } catch (_) {} });
    await page.waitForTimeout(900);
    const E = await page.evaluate(READ);
    is(E.realCards.map(c => c.name), [], 'the portfolio has no real property cards');
    yes(/Demo Properties/.test(E.demoSectionTitle || ''), 'the demo section is offered', E.demoSectionTitle);
    is(E.demoCards.map(c => c.name),
       ['Cascade Commons', 'Northgate Exchange', 'Harborview Retail Center'],
       'all three demo cards are present, in order');
    is(E.storedIds, [], 'and nothing has been seeded merely by arriving');

    // A SEEDED DEMO IS NOT THE MANAGER ACQUIRING A PROPERTY. _maybeShowWelcome
    // dismisses its panel for good once a real property exists, so if a demo
    // counted as one, exploring the demo would silently retire the onboarding
    // panel for an account that still has nothing of its own.
    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.ptf-prop-card.ptf-demo-card'))
        .find(c => /Northgate Exchange/.test((c.querySelector('.ptf-prop-name') || {}).textContent || ''));
      card.querySelector('.ptf-card-open-btn').click();
    });
    await page.waitForFunction(() => { const p = currentProperty();
      return p && /Northgate/.test(p.name || ''); }, null, { timeout: 40000 });
    await page.waitForTimeout(1500);
    const W = await page.evaluate(async () => {
      ccShowPortfolio();
      await new Promise(r => setTimeout(r, 700));
      const panel = document.getElementById('demoWelcomePanel');
      let seen = null;
      try { seen = !!(JSON.parse(localStorage.getItem('ms_onboarding') || '{}').welcomeSeen); } catch (_) {}
      return { panelShown: panel ? panel.style.display !== 'none' : null,
               props: (_props || []).map(p => p.name).sort() };
    });
    is(W.props, ['Cascade Commons', 'Northgate Exchange'],
       'opening a demo card from an empty portfolio seeds both CAM demos');
    is(W.panelShown, true,
       'and the welcome panel is STILL offered — a demo property is not the manager’s own');
    await page.context().close();
  }

  // ══ 2–3 · an account that already has a property ══════════════════════════
  sec('2–3 · an account WITH a real property sees them too, and nothing is seeded on load');
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  for (const p of ['**cdnjs**', '**jsdelivr**']) await page.route(p, r => r.fulfill({ status: 200, body: '' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(DB);
  await page.addInitScript(SEED_REAL);

  const boot = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    await page.evaluate(() => { try { MainStreetLanding.hide(); } catch (_) {} });
    await page.waitForFunction(() => typeof _props !== 'undefined'
      && _props.some(p => p && p.name === 'Maple Plaza'), null, { timeout: 30000 });
    await page.waitForTimeout(1200);
  };
  await boot();

  const A = await page.evaluate(READ);
  is(A.realCards.map(c => c.name), ['Maple Plaza'], 'the manager’s own property is on screen');
  is(A.propsInMemory, ['Maple Plaza'], 'and it is the only property in memory');
  yes(/Demo Properties/.test(A.demoSectionTitle || ''),
      '2 · THE FIX: the demo section is offered beside it', A.demoSectionTitle);
  is(A.demoCards.map(c => c.name),
     ['Cascade Commons', 'Northgate Exchange', 'Harborview Retail Center'],
     '2 · with the same three cards the empty portfolio offers');
  const ngCard = A.demoCards.find(c => c.name === 'Northgate Exchange');
  is(ngCard && ngCard.onclick, '_openNorthgateDemo()', '2 · the Northgate card calls the existing opener');
  const ccCard = A.demoCards.find(c => c.name === 'Cascade Commons');
  is(ccCard && ccCard.onclick, 'loadDemo()', '2 · and the Cascade card still calls loadDemo()');
  is(A.storedIds, [MAPLE_ID], '3 · NO demo property has been seeded — arriving at the portfolio seeds nothing');
  is(A.realCards[0].demoBadge, false, 'a real property carries no DEMO badge');
  is(A.welcomePanel, false, 'and the welcome panel stays dismissed for an account with a real property');

  sec('3b · a search shows results only — the demo cards are not results');
  const SEARCH = await page.evaluate(async () => {
    _portfolioQuery = 'maple';
    _applyPortfolioSearch();
    await new Promise(r => setTimeout(r, 500));
    const during = {
      demo: document.querySelectorAll('.ptf-prop-card.ptf-demo-card').length,
      real: document.querySelectorAll('.ptf-prop-card:not(.ptf-demo-card)').length,
      title: !!document.querySelector('.ptf-demo-section-title'),
    };
    _portfolioQuery = '';
    _applyPortfolioSearch();
    await new Promise(r => setTimeout(r, 500));
    const after = {
      demo: document.querySelectorAll('.ptf-prop-card.ptf-demo-card').length,
      title: !!document.querySelector('.ptf-demo-section-title'),
    };
    return { during, after };
  });
  is(SEARCH.during, { demo: 0, real: 1, title: false },
     'while searching, only the matching property is shown — no demo cards, no demo heading');
  is(SEARCH.after, { demo: 3, title: true }, 'and clearing the search brings the invitation back');

  // ══ 4 · choosing the demo ════════════════════════════════════════════════
  sec('4 · clicking Open Demo on the Northgate card seeds both CAM demos, once each');
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.ptf-prop-card.ptf-demo-card'))
      .find(c => /Northgate Exchange/.test((c.querySelector('.ptf-prop-name') || {}).textContent || ''));
    card.querySelector('.ptf-card-open-btn').click();
  });
  await page.waitForFunction(() => { const p = currentProperty();
    return p && /Northgate/.test(p.name || '') && typeof lastResults !== 'undefined' && lastResults.length > 0;
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1800);
  const B = await page.evaluate(READ);
  const openedName = await page.evaluate(() => currentProperty().name);
  is(openedName, 'Northgate Exchange', 'the Northgate demo opens');
  is(B.storedByName, { 'Maple Plaza': 1, 'Cascade Commons': 1, 'Northgate Exchange': 1 },
     '4 · exactly one stored row each: the real property, Cascade, and Northgate');
  is(B.storedIds.length, 3, 'three rows in total — nothing seeded twice');
  yes(B.storedIds.includes(B.demoIds.cascade) && B.storedIds.includes(B.demoIds.northgate),
      '4 · and both were written under their own stable demo ids', JSON.stringify(B.demoIds));

  // ══ 5 · the manager's property ═══════════════════════════════════════════
  sec('5 · the manager’s own property is untouched');
  const MAPLE = await page.evaluate((id) => {
    const p = (_props || []).find(x => x && x.id === id);
    const store = JSON.parse(localStorage.getItem('__mockdb') || '{}');
    const row = (store.properties || []).find(r => r.id === id);
    const tn = (store.tenants || []).filter(t => t.property_id === id).map(t => t.name).sort();
    return { inMemory: p ? { name: p.name, sqft: p.totalSqft || p.sqft } : null,
             row: row ? { name: row.name, sqft: row.sqft } : null, tenants: tn };
  }, MAPLE_ID);
  is(MAPLE.row, { name: 'Maple Plaza', sqft: 18000 }, 'its stored row is exactly as it was');
  is(MAPLE.tenants, ['Maple Barber Co', 'Maple Dry Goods'], 'and both of its tenants are still there');
  yes(MAPLE.inMemory && MAPLE.inMemory.name === 'Maple Plaza', 'it is still in the portfolio', JSON.stringify(MAPLE.inMemory));

  // ══ 6–8 · after the reload ═══════════════════════════════════════════════
  sec('6–8 · after a reload: three cards, two badged DEMO, nothing duplicated');
  await boot();
  const C = await page.evaluate(READ);
  is(C.realCards.map(c => c.name).sort(), ['Cascade Commons', 'Maple Plaza', 'Northgate Exchange'],
     '6 · Northgate is an ordinary portfolio card, beside Cascade and the real property');
  is(C.storedByName, { 'Maple Plaza': 1, 'Cascade Commons': 1, 'Northgate Exchange': 1 },
     '7 · the reload duplicated nothing');
  is(C.demoCards.map(c => c.name), [],
     '7 · and the invitation has withdrawn — the demos are here, so they are not offered again');
  const badges = C.realCards.reduce((a, c) => { a[c.name] = c.demoBadge; return a; }, {});
  is(badges, { 'Cascade Commons': true, 'Maple Plaza': false, 'Northgate Exchange': true },
     '6 · both demos are badged DEMO and the real property is not — they cannot be mistaken for each other');

  sec('6b · and Northgate opens from that ordinary card, at its current seed');
  const NGOPEN = await page.evaluate(async () => {
    const card = Array.from(document.querySelectorAll('.ptf-prop-card:not(.ptf-demo-card)'))
      .find(c => /Northgate Exchange/.test((c.querySelector('.ptf-prop-name') || {}).textContent || ''));
    if (!card) return { error: 'no Northgate card' };
    card.click();
    await new Promise(r => setTimeout(r, 3500));
    const p = currentProperty();
    const AX = window.AuditExposure;
    const ex = AX.deriveExposure(buildAuditSummary(), window.CamPool.total(invoiceData.filter(Boolean)));
    const rd = AX.billingReadiness(ex);
    return { name: p.name, spaces: (p.tenants || []).length,
             vacant: (p.tenants || []).filter(t => t && t.vacant === true).length,
             results: lastResults.length, canBill: rd.canBill, label: rd.label,
             stale: _resultsStale };
  });
  is(NGOPEN.name, 'Northgate Exchange', 'clicking the card opens Northgate');
  is([NGOPEN.spaces, NGOPEN.vacant, NGOPEN.results], [6, 1, 5],
     'with its six spaces, one vacancy and five allocations intact');
  yes(NGOPEN.canBill === true && NGOPEN.label === 'Bill with review',
      'and it is still billable, opened this way', JSON.stringify(NGOPEN));
  is(NGOPEN.stale, false, 'its reconciliation is current');

  sec('8 · Cascade is still there, and still refuses');
  const CASC = await page.evaluate(async () => {
    const c = (_props || []).find(p => /Cascade/.test(p.name || ''));
    await selectProperty(c.id);
    await new Promise(r => setTimeout(r, 3000));
    const s = buildAuditSummary();
    const AX = window.AuditExposure;
    const ex = AX.deriveExposure(s, window.CamPool.total(invoiceData.filter(Boolean)));
    const rd = AX.billingReadiness(ex);
    const byTenant = ex.blocking.byTenant || {};
    return { name: currentProperty().name, canBill: rd.canBill, label: rd.label,
             blockers: (ex.blocking.property || []).map(b => b.title),
             heldTenants: Object.keys(byTenant),
             heldTitles: Object.keys(byTenant).reduce((a, t) => a.concat((byTenant[t] || []).map(b => b.title)), []),
             documented: (invoiceData || []).filter(i => i && (i.fileUrl || i.fileName)).length,
             invoices: (invoiceData || []).length };
  });
  is(CASC.name, 'Cascade Commons', 'Cascade opens from its portfolio card');
  yes(CASC.canBill === false && CASC.label === 'Not ready to bill',
      '8 · and still refuses to bill', JSON.stringify(CASC));

  // WHAT HOLDS IT HAS MOVED, AND THAT IS THE POINT OF SEED v9.
  //
  // This asserted one property-level finding — 26 of 26 invoices missing source
  // document — which held every tenant. The register now carries its source
  // documents (assets/demo/invoices), so that finding is answered and nothing
  // holds the property as a whole. What remains is one TENANT's hold, and it is
  // a hold the engine is right to keep: a Modified Gross lease may or may not
  // permit CAM pass-throughs, and it will not assert which without a human
  // reading the lease. The demo refuses to bill for a better reason than it
  // used to, not for no reason.
  is(CASC.documented, CASC.invoices,
     '8 · every invoice in the register carries a source document');
  is(CASC.blockers, [],
     '8 · nothing holds the property as a whole any more');
  is(CASC.heldTenants, ['ProActive Physical Therapy'],
     '8 · exactly one tenant is held, and no other tenant is affected');
  yes(CASC.heldTitles.length === 1 && /^Modified Gross tenant receiving shared CAM/.test(CASC.heldTitles[0]),
      '8 · held by the lease question the engine will not answer for itself', JSON.stringify(CASC.heldTitles));

  sec('9 · opening a demo twice seeds nothing more');
  const TWICE = await page.evaluate(async () => {
    const before = JSON.parse(localStorage.getItem('__mockdb') || '{}').properties.length;
    await _openNorthgateDemo();
    await new Promise(r => setTimeout(r, 1500));
    await loadDemo();
    await new Promise(r => setTimeout(r, 1500));
    const store = JSON.parse(localStorage.getItem('__mockdb') || '{}');
    return { before, after: store.properties.length,
             names: store.properties.map(p => p.name).sort() };
  });
  is(TWICE.after, TWICE.before, 'both openers are idempotent — the row count does not move');
  is(TWICE.names, ['Cascade Commons', 'Maple Plaza', 'Northgate Exchange'], 'and the same three properties remain');

  sec('9b · with only ONE demo seeded the invitation comes back');
  //
  // An account that opened the demo under an older build holds Cascade and not
  // Northgate. If "seeded" meant either one, that account would never be
  // offered the property this demo exists to show.
  const ONE = await page.evaluate(async () => {
    const ngId = NORTHGATE_PROPERTY_ID;
    const store = JSON.parse(localStorage.getItem('__mockdb') || '{}');
    const keptRow = (store.properties || []).find(r => r.id === ngId);
    const keptMem = (_props || []).find(p => p.id === ngId);
    // Take Northgate away, exactly as an older account would not have it.
    store.properties = (store.properties || []).filter(r => r.id !== ngId);
    localStorage.setItem('__mockdb', JSON.stringify(store));
    _props.splice(_props.findIndex(p => p.id === ngId), 1);
    renderPortfolio();
    await new Promise(r => setTimeout(r, 600));
    const out = {
      demoCards: Array.from(document.querySelectorAll('.ptf-prop-card.ptf-demo-card'))
        .map(c => (c.querySelector('.ptf-prop-name') || {}).textContent.trim()),
      realCards: Array.from(document.querySelectorAll('.ptf-prop-card:not(.ptf-demo-card)'))
        .map(c => (c.querySelector('.ptf-prop-name') || {}).textContent.trim()).sort(),
    };
    // Put it back so the rest of the account is as it was.
    store.properties.push(keptRow);
    localStorage.setItem('__mockdb', JSON.stringify(store));
    _props.push(keptMem);
    renderPortfolio();
    await new Promise(r => setTimeout(r, 400));
    return out;
  });
  is(ONE.realCards, ['Cascade Commons', 'Maple Plaza'], 'with Northgate gone, two cards remain');
  yes(ONE.demoCards.includes('Northgate Exchange'),
      'and the invitation is offered again — one seeded demo is not both', JSON.stringify(ONE.demoCards));

  sec('9c · a stale stored demo is brought current when its card is opened');
  //
  // The seed guarantee Cascade already carries: however the property is opened,
  // it opens at the CURRENT seed. A row left behind by an older build must not
  // open as whatever that build wrote.
  const STALE = await page.evaluate(async () => {
    const ngId = NORTHGATE_PROPERTY_ID;
    const store = JSON.parse(localStorage.getItem('__mockdb') || '{}');
    const row = (store.properties || []).find(r => r.id === ngId);
    // Age the stored row and damage what the seed would restore.
    row.data = Object.assign({}, row.data, { _ngV: 0 });
    row.data.camReconciliation = Object.assign({}, row.data.camReconciliation, { results: [] });
    localStorage.setItem('__mockdb', JSON.stringify(store));
    const before = { ngV: row.data._ngV, results: row.data.camReconciliation.results.length };
    ccShowPortfolio();
    await new Promise(r => setTimeout(r, 700));
    const card = Array.from(document.querySelectorAll('.ptf-prop-card:not(.ptf-demo-card)'))
      .find(c => /Northgate Exchange/.test((c.querySelector('.ptf-prop-name') || {}).textContent || ''));
    card.click();
    await new Promise(r => setTimeout(r, 4000));
    const after = JSON.parse(localStorage.getItem('__mockdb') || '{}')
      .properties.find(r => r.id === ngId);
    return { before,
             afterNgV: after.data._ngV,
             afterResults: (after.data.camReconciliation.results || []).length,
             opened: currentProperty().name, live: lastResults.length };
  });
  is(STALE.before, { ngV: 0, results: 0 }, 'fixture: the stored row was aged and emptied');
  is(STALE.afterNgV, 1, 'opening its card re-seeded it to the current version');
  is(STALE.afterResults, 5, 'and restored the reconciliation the seed defines');
  is([STALE.opened, STALE.live], ['Northgate Exchange', 5], 'the property opened, with its five allocations');

  sec('10 · quiet page');
  is(errors, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
