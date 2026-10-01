// test-e2e-acquisition-matrix13.js
// ============================================================================
// The acquisition matrix — the buyer's thirteen columns — and the merge-only
// "Read the new terms", walked in the page with Maple Plaza as the Pilot
// holds it (fixtures/maple-plaza-acquisition.js).
//
//   1  the review still opens on the summary matrix; the thirteen columns are
//      a second view, one click away
//   2  exactly the buyer's thirteen headers, in the buyer's order; one row per
//      leasehold; every cell the same state the summary matrix shows
//   3  a cell opens its sources: the governing document, its clause, every
//      earlier reading (F3) — and a contested cell, what each document says;
//      Escape closes it and gives focus back to the cell
//   4  the tenant opens the lease record; Back lands on the thirteen columns
//   5  the CSV: the buyer's thirteen headers, never a blank cell, a BOM; the
//      sources CSV: one row per leasehold × column
//   6  "Read the new terms" asks for the five keys only, and adds them: every
//      entry already stored is byte-identical, the reading's status, model
//      and time are untouched, and the new value reaches the matrix
//   7  a failed new-terms reading writes nothing
//   8  a closed (converted) acquisition offers no new-terms reading
//   9  the phone: the table scrolls inside its frame, never the page; the
//      tenant stays in view
//
// The stand-in database is test-e2e-acquisition-lease-matrix.js's, read from
// that file so the two cannot drift.
//
// Run: node test-e2e-acquisition-matrix13.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const F = require('./fixtures/maple-plaza-acquisition.js');
const ROOT = __dirname, PORT = 8951;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = F.UID, MAPLE = F.REVIEW;
const SHOP = F.FAM.shoprite;
const SHOP_LEASE = '3fc9463f-230e-424c-8bba-7dfacafd6a98';
const SHOP_AMD   = 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf';
const HEADERS = ['Tenant', 'Lease Exp.', 'Sq. Ft.', 'Base Rent', 'Rent Inc.', 'CAM', 'Taxes', 'Ins.', '% Rent',
                 'Options', 'Exclusive', 'Co-Ten', 'Termination Right'];

const SRC = fs.readFileSync(path.join(ROOT, 'test-e2e-acquisition-lease-matrix.js'), 'utf8');
const DB = SRC.slice(SRC.indexOf('const DB = `') + 'const DB = `'.length, SRC.indexOf('})();`;') + '})();'.length)
  .replace('${UID}', UID);

// What the model answers for the new keys — and a cap it was not asked for,
// which must never reach the stored reading.
const NEW_TERMS = { fields: {
  percentage_rent:  { value: '4% of sales over $3,986,250', quote: 'Tenant shall pay four percent (4%) of Gross Sales in excess of $3,986,250.', page: 5, confidence: 0.92 },
  rent_escalations: { value: 'Yrs 1-5 $1,202,500; Yrs 6-10 $1,322,750', quote: 'Years 1-5: $1,202,500 per annum. Years 6-10: $1,322,750 per annum.', page: 3, confidence: 0.9 },
  tax_recovery:     { value: 'None', quote: 'Tenant shall not be responsible for any portion of Real Estate Taxes.', page: 4, confidence: 0.9 },
  cap:              { value: 9, quote: 'capped at 9%', page: 1, confidence: 0.9 },
}, __meta: { model: 'm-new' } };

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const claudeBodies = [];
  let claudeMode = 'ok';

  async function open(viewport, mobile, opts) {
    const o = opts || {};
    const ctx = await browser.newContext({ viewport, isMobile: !!mobile, hasTouch: !!mobile, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    for (const g of ['**cdnjs**', '**jsdelivr**']) await page.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**/api/claude', r => {
      let body = null; try { body = JSON.parse(r.request().postData() || 'null'); } catch (_) {}
      claudeBodies.push(body);
      if (claudeMode === 'fail') return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"},"reason":"upstream_error"}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NEW_TERMS) });
    });
    await page.addInitScript(DB);
    await page.addInitScript(() => { try { localStorage.removeItem('acqMatrixView'); } catch (_) {} });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
    });
    await page.evaluate(async ({ maple, fx, status }) => {
      __store.acquisition_reviews.push({ id: maple, user_id: 'u1', name: 'Maple Plaza', status: status,
        created_at: '2026-09-17T19:14:41Z', updated_at: 'rev-0',
        data: { tenants: fx.tenants, invoices: [], totalSqFt: 0, documents: [], analysis: null } });
      fx.families.forEach(f => __store.acquisition_document_families.push(JSON.parse(JSON.stringify(f))));
      fx.documents.forEach(d => __store.acquisition_documents.push(Object.assign(JSON.parse(JSON.stringify(d)),
        { extracted_text: 'LEASE. ' + 'The full stored text of this document. '.repeat(4) })));
      fx.decisions.forEach(d => __store.acquisition_term_decisions.push(JSON.parse(JSON.stringify(d))));
      await _loadAcqReviewsAndRender();
      selectAcquisitionReview(maple);
    }, { maple: MAPLE, fx: F, status: o.status || 'complete' });
    await page.waitForSelector(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`, { timeout: 15000 });
    return { ctx, page };
  }

  const { ctx, page } = await open({ width: 1280, height: 1000 }, false);
  console.log('\nAcquisition matrix (13 columns) and the merge-only re-read, Maple Plaza\n' + '='.repeat(64));

  // ── 1 · a second view, the summary still first ───────────────────────────
  const v0 = await page.evaluate(() => ({
    summary: !!document.querySelector('#acqTermsList .acq-lm-table'),
    m13: !!document.querySelector('#acqTermsList .acq-m13-table'),
    tabs: [].map.call(document.querySelectorAll('#acqTermsList .acq-lm-view'), b => b.textContent.trim() + (b.classList.contains('active') ? '*' : '')),
  }));
  check('the review still opens on the summary matrix — the thirteen columns are not the default',
        v0.summary && !v0.m13, JSON.stringify(v0));
  check('the two views are named, the summary selected', v0.tabs.join('|') === 'Summary*|Acquisition matrix · 13 columns', v0.tabs.join('|'));
  await page.click('#acqTermsList .acq-lm-view[data-view="acquisition"]');
  await page.waitForSelector('#acqTermsList .acq-m13-table');

  // ── 2 · the thirteen ─────────────────────────────────────────────────────
  const read13 = () => page.evaluate(() => {
    const t = document.querySelector('#acqTermsList .acq-m13-table');
    return {
      headers: [].map.call(t.querySelectorAll('thead th'), th => th.textContent.trim()),
      rows: [].map.call(t.querySelectorAll('tbody tr'), tr => ({
        id: tr.getAttribute('data-leasehold'),
        tenant: tr.querySelector('.acq-m13-open').textContent.trim(),
        cells: [].map.call(tr.querySelectorAll('td'), td => ({
          col: td.getAttribute('data-col'),
          field: td.querySelector('.acq-m13-cell').getAttribute('data-field'),
          state: td.querySelector('.acq-m13-cell').getAttribute('data-state'),
          text: td.querySelector('.acq-m13-clamp').innerText.replace(/\s+/g, ' ').trim(),
          sub: ((td.querySelector('.acq-m13-sub') || {}).innerText || '').trim(),
          none: !!td.querySelector('[data-none-stated="true"]'),
        })),
      })),
    };
  });
  const m1 = await read13();
  check('exactly the buyer\'s thirteen headers, in the buyer\'s order', JSON.stringify(m1.headers) === JSON.stringify(HEADERS), m1.headers.join(' | '));
  check('one row per leasehold — four', m1.rows.length === 4, m1.rows.map(r => r.tenant).join(' | '));
  const shop = m1.rows.find(r => r.id === SHOP);
  const cell = (r, col) => r.cells.find(c => c.col === col);
  check('ShopRite: Lease Exp. 2/28/2039 · 67,000 ✓ · $1,251,250 ✓ with the monthly figure labelled calculated',
        cell(shop, 'lease_exp').text === '2/28/2039' && cell(shop, 'sqft').text === '67,000✓'
        && cell(shop, 'base_rent').text === '$1,251,250✓' && cell(shop, 'base_rent').sub === '$104,270.83/mo (calc.)',
        [cell(shop, 'lease_exp').text, cell(shop, 'sqft').text, cell(shop, 'base_rent').text, cell(shop, 'base_rent').sub].join(' | '));
  check('the five new columns read Not established (—) until a document is read for them — never blank, never None',
        ['rent_inc', 'cam', 'taxes', 'ins', 'pct_rent'].every(k => cell(shop, k).state === 'missing' && cell(shop, k).text === '—'),
        ['rent_inc', 'cam', 'taxes', 'ins', 'pct_rent'].map(k => cell(shop, k).state + ':' + cell(shop, k).text).join(' '));
  check('Options is contested (the undated renewal and the amendment disagree) — "Contested", no value',
        cell(shop, 'options').state === 'contested' && cell(shop, 'options').text === 'Contested');
  check('Co-Ten and Termination Right carry the amendment\'s denying text, as read',
        /no co-tenancy termination right/.test(cell(shop, 'co_ten').text) && /no unilateral early termination right/.test(cell(shop, 'termination').text));
  const same = await page.evaluate(() => {
    const LM = _LM(), AT = _AT();
    const rows = _acqCanonicalRows(_activeAcqId).rows.filter(r => r._source === 'leasehold');
    const bad = [];
    rows.forEach(r => LM.MATRIX13.forEach(c => {
      const a = LM.cellFor(r, c.field, { terms: AT }).state;
      const td = document.querySelector(`#acqTermsList .acq-m13-cell[data-leasehold="${r._leaseholdId}"][data-field="${c.field}"]`);
      if (td && td.getAttribute('data-state') !== a) bad.push(r.tenant_name + '/' + c.field);
    }));
    return bad;
  });
  check('every cell carries the same state the summary matrix and the record read (one resolver)', same.length === 0, same.join(', '));

  // ── 3 · a cell's sources ─────────────────────────────────────────────────
  await page.click(`#acqTermsList .acq-m13-cell[data-leasehold="${SHOP}"][data-field="base_rent"]`);
  await page.waitForSelector('#acqTermsList .acq-m13-detail');
  const d1 = await page.evaluate(() => {
    const d = document.querySelector('#acqTermsList .acq-m13-detail');
    return { text: d.textContent.replace(/\s+/g, ' '), field: d.getAttribute('data-field'),
             focus: document.activeElement && document.activeElement.classList.contains('acq-m13-close') };
  });
  check('Base Rent opens its sources: the governing amendment, its type and date, and its clause',
        d1.field === 'base_rent' && /Governing document Maple_Plaza_Test_Lease_Amendment\.pdf · Amendment · 1\/1\/2027/.test(d1.text)
        && /\$19\.25 per rentable square foot/.test(d1.text), d1.text.slice(0, 220));
  check('F3: the reading it replaced is open to inspection — the renewal\'s $1,202,500, undated, with its clause',
        /Earlier readings \(1\)/.test(d1.text) && /ShopRite_Anchor_Tenant_Lease\.pdf · Renewal · undated: 1202500/.test(d1.text)
        && /\$18\.50 per square foot/.test(d1.text), (d1.text.match(/Earlier readings[\s\S]{0,200}/) || [''])[0]);
  check('and the person\'s decision on it is named', /Confirmed by a person|Corrected by a person/.test(d1.text));
  check('focus moves to the sources\' Close', d1.focus);
  await page.keyboard.press('Escape');
  const d1x = await page.evaluate(() => ({ open: !!document.querySelector('#acqTermsList .acq-m13-detail'),
    back: document.activeElement && document.activeElement.getAttribute('data-field') }));
  check('Escape closes it and gives focus back to the cell', !d1x.open && d1x.back === 'base_rent', JSON.stringify(d1x));
  await page.click(`#acqTermsList .acq-m13-cell[data-leasehold="${SHOP}"][data-field="renewal_options"]`);
  const d2 = await page.evaluate(() => document.querySelector('#acqTermsList .acq-m13-detail').textContent.replace(/\s+/g, ' '));
  check('a contested cell shows what each document says — both readings, neither chosen',
        /Contested — nothing has been chosen/.test(d2) && /What each document says/.test(d2)
        && /fifteen \(15\) years/.test(d2) && /one additional five-year renewal option/.test(d2), d2.slice(0, 200));
  await page.click('#acqTermsList .acq-m13-close');

  // ── 4 · the tenant opens the record; Back returns to the thirteen ─────────
  await page.click(`#acqTermsList .acq-m13-open[data-leasehold="${SHOP}"]`);
  await page.waitForSelector('#acqTermsList .acq-lh');
  check('the tenant opens ShopRite\'s lease record', await page.evaluate((s) => document.querySelector('#acqTermsList .acq-lh').getAttribute('data-leasehold') === s, SHOP));
  await page.click('#acqTermsList .acq-lh-back');
  check('Back lands on the thirteen columns, the view kept', await page.evaluate(() => !!document.querySelector('#acqTermsList .acq-m13-table')));

  // ── 5 · the CSVs ─────────────────────────────────────────────────────────
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#acqTermsList .acq-m13-csv')]);
  const csv1 = fs.readFileSync(await dl1.path(), 'utf8');
  const lines1 = csv1.replace(/^\uFEFF/, '').trim().split(/\r\n/);
  check('the matrix CSV starts with a byte-order mark and the buyer\'s thirteen headers, in order',
        csv1.charCodeAt(0) === 0xFEFF && lines1[0] === HEADERS.join(','), lines1[0]);
  check('it is named for the review', dl1.suggestedFilename() === 'Maple_Plaza-lease-matrix.csv', dl1.suggestedFilename());
  const shopLine = lines1.find(l => /^"?ShopRite/.test(l)) || '';
  check('ShopRite\'s row: dates as written, the monthly figure labelled, Not established and Contested in words',
        /2\/28\/2039/.test(shopLine) && /"\$1,251,250 \/ \$104,270\.83\/mo \(calc\.\)"/.test(shopLine)
        && /Not established/.test(shopLine) && /Contested/.test(shopLine), shopLine.slice(0, 200));
  check('no data cell is blank', !lines1.slice(1).filter(l => l && !/^Not included/.test(l)).some(l => /(^|,)(,|$)/.test(l)));
  check('the entries not matched to a tenant are left out, and the file says so',
        /Not included: 6 extracted entries not matched to a tenant/.test(csv1));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#acqTermsList .acq-m13-prov')]);
  const csv2 = fs.readFileSync(await dl2.path(), 'utf8').replace(/^\uFEFF/, '');
  const lines2 = csv2.trim().split(/\r\n/);
  check('the sources CSV: one row per leasehold × column, with the governing document and clause',
        lines2[0] === 'Tenant,Column,Value,State,Governing document,Document type,Document date,Page,Confidence,Clause,Earlier readings,Decision'
        && lines2.length === 1 + 4 * 13 && /Maple_Plaza_Test_Lease_Amendment\.pdf/.test(csv2), String(lines2.length));

  // ── 6 · Read the new terms: merge-only ───────────────────────────────────
  const before = await page.evaluate((id) => JSON.parse(JSON.stringify(__store.acquisition_documents.find(d => d.id === id))), SHOP_LEASE);
  const btn = await page.evaluate((id) => {
    const b = document.querySelector(`#acqDocsList .acq-doc-read-new[data-doc-id="${id}"]`);
    return b ? b.textContent.trim() : null;
  }, SHOP_LEASE);
  check('a document read before the five existed offers "Read the new terms"', btn === 'Read the new terms', String(btn));
  check('and still does not offer the full "Read terms" — that would re-read what a person decided',
        await page.evaluate((id) => !document.querySelector(`#acqDocsList .acq-doc-reabstract[data-doc-id="${id}"]`), SHOP_LEASE));
  const uploadsBefore = await page.evaluate(() => __store.acquisition_documents.length);
  await page.click(`#acqDocsList .acq-doc-read-new[data-doc-id="${SHOP_LEASE}"]`);
  await page.waitForFunction((id) => {
    const d = __store.acquisition_documents.find(x => x.id === id);
    return d && d.abstracted_fields && d.abstracted_fields.fields && 'percentage_rent' in d.abstracted_fields.fields;
  }, SHOP_LEASE, { timeout: 15000 });
  const after = await page.evaluate((id) => JSON.parse(JSON.stringify(__store.acquisition_documents.find(d => d.id === id))), SHOP_LEASE);
  const ask = claudeBodies[claudeBodies.length - 1];
  check('it asks for the five keys only, from the stored text',
        ask && ask.task === 'acquisition_abstraction'
        && /^Report ONLY these keys: rent_escalations, cam_recovery, tax_recovery, insurance_recovery, percentage_rent\./.test(ask.messages[0].content)
        && /The full stored text of this document/.test(ask.messages[0].content), ask && ask.messages[0].content.slice(0, 120));
  check('every entry already stored is byte-identical — the 4% cap was not replaced by the 9% it was not asked for',
        Object.keys(before.abstracted_fields.fields).every(k => JSON.stringify(after.abstracted_fields.fields[k]) === JSON.stringify(before.abstracted_fields.fields[k]))
        && after.abstracted_fields.fields.cap.value === 4);
  check('the five are added — the two read, the three the document is silent on as null entries',
        after.abstracted_fields.fields.percentage_rent.value === '4% of sales over $3,986,250'
        && after.abstracted_fields.fields.tax_recovery.value === 'None'
        && after.abstracted_fields.fields.cam_recovery.value === null && after.abstracted_fields.fields.cam_recovery.quote === null,
        JSON.stringify(Object.keys(after.abstracted_fields.fields).length));
  check('the reading\'s status, model and time are the document\'s own, untouched',
        after.abstraction_status === before.abstraction_status && after.abstracted_fields.model === before.abstracted_fields.model
        && after.abstracted_fields.at === before.abstracted_fields.at
        && JSON.stringify(after.abstracted_fields.supplements.map(s => s.fields)) === JSON.stringify([['rent_escalations', 'cam_recovery', 'tax_recovery', 'insurance_recovery', 'percentage_rent']]));
  const otherCols = ['doc_type', 'doc_type_status', 'family_id', 'family_status', 'confirmed_by', 'superseded_by_document_id', 'storage_path', 'abstraction_error'];
  check('nothing else on the document row moved, and no row was added',
        otherCols.every(k => JSON.stringify(after[k]) === JSON.stringify(before[k]))
        && await page.evaluate(() => __store.acquisition_documents.length) === uploadsBefore);
  check('no decision was written or changed', await page.evaluate((n) => __store.acquisition_term_decisions.length === n, F.decisions.length));
  await page.waitForFunction((s) => {
    const c = document.querySelector(`#acqTermsList .acq-m13-cell[data-leasehold="${s}"][data-field="percentage_rent"]`);
    return c && c.getAttribute('data-state') !== 'missing';
  }, SHOP, { timeout: 8000 }).catch(() => {});
  const m2 = await read13();
  const shop2 = m2.rows.find(r => r.id === SHOP);
  check('the new value reaches the matrix: % Rent read by AI, with its figures in its clause',
        cell(shop2, 'pct_rent').state === 'read' && cell(shop2, 'pct_rent').text === '4% of sales over $3,986,250', JSON.stringify(cell(shop2, 'pct_rent')));
  check('a stated None reads "None (stated)" — the clause denies it', cell(shop2, 'taxes').text === 'None (stated)' && cell(shop2, 'taxes').none, JSON.stringify(cell(shop2, 'taxes')));
  check('Rent Inc.: the whole schedule, every amount in its clause, read by AI',
        cell(shop2, 'rent_inc').state === 'read' && /\$1,202,500; Yrs 6-10 \$1,322,750/.test(cell(shop2, 'rent_inc').text), JSON.stringify(cell(shop2, 'rent_inc')));
  check('a term the document is silent on stays Not established — never None', cell(shop2, 'cam').state === 'missing' && cell(shop2, 'cam').text === '—');
  check('and the document no longer offers the new-terms reading', await page.evaluate((id) => !document.querySelector(`#acqDocsList .acq-doc-read-new[data-doc-id="${id}"]`), SHOP_LEASE));

  // ── 7 · a failure writes nothing ─────────────────────────────────────────
  claudeMode = 'fail';
  const amdBefore = await page.evaluate((id) => JSON.stringify(__store.acquisition_documents.find(d => d.id === id)), SHOP_AMD);
  await page.click(`#acqDocsList .acq-doc-read-new[data-doc-id="${SHOP_AMD}"]`);
  await page.waitForFunction((id) => !!document.querySelector(`#acqDocsList .acq-doc-read-new[data-doc-id="${id}"]`), SHOP_AMD, { timeout: 15000 });
  await page.waitForTimeout(300);
  const amdAfter = await page.evaluate((id) => JSON.stringify(__store.acquisition_documents.find(d => d.id === id)), SHOP_AMD);
  check('a failed new-terms reading writes nothing — not even a `failed` status — and the control stays', amdAfter === amdBefore);
  claudeMode = 'ok';
  await ctx.close();

  // ── 8 · a closed acquisition ─────────────────────────────────────────────
  {
    const { ctx: c2, page: p2 } = await open({ width: 1280, height: 1000 }, false, { status: 'converted' });
    const n0 = claudeBodies.length;
    const fz = await p2.evaluate(async (id) => {
      const shown = document.querySelectorAll('#acqDocsList .acq-doc-read-new').length;
      const before = JSON.stringify(__store.acquisition_documents.find(d => d.id === id));
      await acqReadNewTerms(id);
      return { shown, same: JSON.stringify(__store.acquisition_documents.find(d => d.id === id)) === before };
    }, SHOP_LEASE);
    check('a converted acquisition offers no new-terms reading, and refuses one called directly — no request, no write',
          fz.shown === 0 && fz.same && claudeBodies.length === n0, JSON.stringify(fz));
    await p2.click('#acqTermsList .acq-lm-view[data-view="acquisition"]');
    check('its thirteen columns still read, as filed', await p2.evaluate(() => document.querySelectorAll('#acqTermsList .acq-m13-table tbody tr').length === 4));
    await c2.close();
  }

  // ── 9 · the phone ────────────────────────────────────────────────────────
  {
    const { ctx: c3, page: p3 } = await open({ width: 375, height: 800 }, true);
    // The page's own layout width at a phone, in the summary view — the header
    // controls already set it (not this view's concern); the thirteen columns
    // must not widen it.
    const base = await p3.evaluate(() => window.innerWidth);
    await p3.click('#acqTermsList .acq-lm-view[data-view="acquisition"]');
    await p3.waitForSelector('#acqTermsList .acq-m13-table');
    const ph = await p3.evaluate(() => {
      const sc = document.querySelector('#acqTermsList .acq-m13-scroll');
      const th = document.querySelector('#acqTermsList .acq-m13-table tbody .acq-m13-tenant');
      return { page: document.documentElement.scrollWidth - window.innerWidth, vw: window.innerWidth,
               inner: sc.scrollWidth > sc.clientWidth, sticky: getComputedStyle(th).position };
    });
    check('375px: the thirteen columns do not widen the page; the table scrolls inside its frame', ph.page <= 0 && ph.inner && ph.vw === base, JSON.stringify(Object.assign({ base }, ph)));
    check('375px: the tenant column is held in view', ph.sticky === 'sticky', ph.sticky);
    await p3.click(`#acqTermsList .acq-m13-cell[data-leasehold="${SHOP}"][data-field="base_rent"]`);
    const pd = await p3.evaluate(() => {
      const d = document.querySelector('#acqTermsList .acq-m13-detail');
      const b = d.getBoundingClientRect();
      return { right: b.right, w: window.innerWidth, page: document.documentElement.scrollWidth - window.innerWidth };
    });
    check('375px: the sources open within the screen', pd.right <= pd.w && pd.page <= 0, JSON.stringify(pd));
    await c3.close();
  }

  check('no uncaught errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();
  const passed = results.filter(r => r.ok).length;
  console.log('\n' + '='.repeat(64) + `\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
