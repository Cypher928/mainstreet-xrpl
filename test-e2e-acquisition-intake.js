// test-e2e-acquisition-intake.js
// ============================================================================
// Acquisition Intake — the front door (I-1): properties, one or many.
//
// A brand-new account (no managed property) sees the Acquisitions section and
// "+ New Acquisition". The Intake's Properties step names one property or
// many; each is created as a PROSPECT through begin_acquisition, one after
// another, by the one creation path "+ New Review" shares. A failure stops the
// sequence at the row it hit: what was created is kept, the failed row keeps
// its text and says why, and Create again goes on from it — nothing is created
// twice. The address stays on the review as evidence (data.address) and never
// reaches a property column; no document, property or tenant row is written.
//
// The Supabase stand-in is test-e2e-acquisition-isolation.js's, carried
// verbatim, with three test-only additions: every RPC call and every table
// write is logged (window.__rpcCalls, window.__writes), and begin_acquisition
// can be made to refuse one named property (window.__failCreateFor).
//
// Run: node test-e2e-acquisition-intake.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8931;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = 'u1';

const DB = `
(function(){
  var U = { id: '${UID}', email: 'pm@example.com' };
  var STORE = { acquisition_reviews: [], acquisition_documents: [],
                acquisition_document_families: [], acquisition_term_decisions: [],
                properties: [], tenants: [] };
  var _seq = 0;
  window.__dbRefusals = [];
  window.__rpcCalls = [];
  window.__writes = [];
  window.__failCreateFor = null;
  function P(v) { return Promise.resolve(v); }
  function tbl(n) { STORE[n] = STORE[n] || []; return STORE[n]; }
  function clone(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }
  function project(arr, sel) {
    if (!sel || sel.indexOf('*') >= 0) return arr.map(clone);
    var cols = sel.split(',').map(function (s) { return s.trim(); });
    return arr.map(function (r) { var o = {}; cols.forEach(function (c) { if (c in r) o[c] = r[c]; }); return o; });
  }
  function refuse(code, message) {
    window.__dbRefusals.push({ code: code, message: message });
    return { data: null, error: { code: code, message: message } };
  }
  var OWNED = { acquisition_documents: 1, acquisition_document_families: 1, acquisition_term_decisions: 1 };

  function q(name) {
    var filters = [], pending = null, sel = null, ord = null;
    var owned = !!OWNED[name];
    function rows() {
      var out = tbl(name).filter(function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); });
      if (owned) out = out.filter(function (r) { return r.user_id === U.id; });
      if (ord) out = out.slice().sort(function (a, b) {
        var x = a[ord[0]], y = b[ord[0]];
        return (x === y ? 0 : (x > y ? 1 : -1)) * (ord[1] ? 1 : -1);
      });
      return out;
    }
    function run() {
      if (pending) {
        if (name === 'acquisition_term_decisions') return P(refuse('2F004', 'acquisition_term_decisions is append-only: UPDATE is refused'));
        var changed = rows();
        window.__writes.push({ table: name, op: 'update', n: changed.length });
        changed.forEach(function (r) { Object.assign(r, pending); r.updated_at = 'rev-' + (++_seq); });
        return P({ data: owned ? project(changed, sel) : changed, error: null });
      }
      return P({ data: owned ? project(rows(), sel) : rows(), error: null });
    }
    var api = {
      select: function (cols) { sel = (typeof cols === 'string' && cols) ? cols : null; return api; },
      eq: function (k, v) { filters.push([k, v]); return api; },
      neq: function () { return api; }, is: function () { return api; }, not: function () { return api; },
      in: function () { return api; }, limit: function () { return api; }, ilike: function () { return api; },
      order: function (col, opts) { ord = [col, !opts || opts.ascending !== false]; return api; },
      single: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: r.error || null }; }); },
      maybeSingle: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: r.error || null }; }); },
      update: function (patch) { pending = patch; return api; },
      insert: function (r) {
        var arr = Array.isArray(r) ? r : [r], out = [];
        window.__writes.push({ table: name, op: 'insert', n: arr.length });
        arr.forEach(function (x) { var row = clone(x); if (!row.id) row.id = 'row-' + (++_seq); tbl(name).push(row); out.push(row); });
        var p = P({ data: out, error: null });
        p.select = function (cols) { var s2 = (typeof cols === 'string' && cols) ? cols : null; return p.then(function () { return { data: owned ? project(out, s2) : out, error: null }; }); };
        return p;
      },
      upsert: function (r, opts) {
        var arr = Array.isArray(r) ? r : [r], t = tbl(name);
        var key = (opts && opts.onConflict) ? String(opts.onConflict).split(',').map(function (s) { return s.trim(); }) : ['id'];
        var out = [], err = null;
        window.__writes.push({ table: name, op: 'upsert', n: arr.length });
        arr.forEach(function (x) {
          if (err) return;
          if (owned && x.user_id !== U.id) { err = refuse('42501', 'row-level security'); return; }
          var i = -1;
          for (var n = 0; n < t.length; n++) { if (key.every(function (k) { return t[n][k] === x[k]; })) { i = n; break; } }
          var next = (i >= 0) ? Object.assign(clone(t[i]), x) : Object.assign({ id: 'row-' + (++_seq) }, x);
          if (i >= 0) { Object.assign(t[i], next); out.push(t[i]); } else { t.push(next); out.push(next); }
        });
        var p = err ? P(err) : P({ data: out, error: null });
        p.select = function (cols) { var s2 = (typeof cols === 'string' && cols) ? cols : null; return p.then(function (res) { return res.error ? res : { data: owned ? project(out, s2) : out, error: null }; }); };
        return p;
      },
      delete: function () {
        return { eq: function (k, v) { window.__writes.push({ table: name, op: 'delete', n: 1 }); STORE[name] = tbl(name).filter(function (x) { return x[k] !== v; }); return P({ error: null }); },
                 in: function () { return P({ error: null }); } };
      },
      then: function (res, rej) { return run().then(res, rej); },
    };
    return api;
  }
  window.__store = STORE;
  window.supabase = { createClient: function () { return {
    auth: {
      getUser: function () { return P({ data: { user: U }, error: null }); },
      getSession: function () { return P({ data: { session: { user: U, access_token: 'tok' } }, error: null }); },
      onAuthStateChange: function (cb) { setTimeout(function () { try { cb('SIGNED_IN', { user: U }); } catch (_) {} }, 40);
        return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return P({ error: null }); },
    },
    // begin_acquisition (migration 034) creates the prospect property and its
    // episode together; the stand-in writes both rows and returns both ids. A
    // property row carries NO address: that is the point being tested.
    rpc: function (fn, args) {
      window.__rpcCalls.push({ fn: fn, args: JSON.parse(JSON.stringify(args || {})) });
      if (fn === 'begin_acquisition') {
        var a = args || {}, now = new Date().toISOString();
        if (window.__failCreateFor && a.p_name === window.__failCreateFor) return P(refuse('42501', 'the database refused this prospect (test refusal)'));
        var pid = 'prop-' + (++_seq), rid = a.p_review_id || ('rev-' + (++_seq));
        tbl('properties').push({ id: pid, user_id: U.id, name: a.p_name, sqft: 0, data: {}, lifecycle_stage: 'prospect', archived_at: null });
        tbl('acquisition_reviews').push({ id: rid, user_id: U.id, name: a.p_name, status: 'draft', data: JSON.parse(JSON.stringify(a.p_data || {})), property_id: pid, converted_at: null, created_at: now, updated_at: now });
        return P({ data: { property_id: pid, review_id: rid, name: a.p_name, status: 'draft', lifecycle_stage: 'prospect', created_at: now, updated_at: now }, error: null });
      }
      return P({ data: null, error: null });
    },
    from: q,
    storage: { from: function () { return { upload: function () { window.__writes.push({ table: 'storage', op: 'upload', n: 1 }); return P({ data: { path: 'x' }, error: null }); },
                                           getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
  }; } };
})();`;

(async () => {
  const net = { upload: 0, claude: 0, other: [] };
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) {
      if (u === '/api/upload') net.upload++; else if (u === '/api/claude') net.claude++; else net.other.push(u);
      rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return;
    }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];

  async function boot(viewport) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    for (const g of ['**cdnjs**', '**jsdelivr**']) await page.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.addInitScript(DB);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
    });
    return { ctx, page };
  }
  const vis = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null;
    const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0; }, sel);
  const rows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#acqIntakeRows .acq-intake-row')).map(el => ({
    state: el.getAttribute('data-state'),
    name: el.querySelector('input[data-field="name"]') ? el.querySelector('input[data-field="name"]').value : (el.querySelector('strong') || {}).textContent || '',
    address: el.querySelector('input[data-field="address"]') ? el.querySelector('input[data-field="address"]').value : (el.querySelector('.acq-intake-addr') || {}).textContent || '',
    error: (el.querySelector('.acq-intake-row-error') || {}).textContent || '',
  })));
  const editable = (page) => page.$$('#acqIntakeRows .acq-intake-row:not(.acq-intake-row-created)');
  async function fillRow(page, index, name, address) {
    const els = await editable(page);
    const el = els[index];
    if (!el) throw new Error('no editable row ' + index);
    const n = await el.$('input[data-field="name"]'), a = await el.$('input[data-field="address"]');
    await n.fill(name); await a.fill(address || '');
  }
  const idle = (page) => page.waitForFunction(() => !_acqIntakeBusy, null, { timeout: 20000 }).catch(() => null);
  const count = (page) => page.$eval('#acqIntakeProspectCount', el => el.textContent);
  const status = (page) => page.$eval('#acqIntakeStatus', el => el.textContent);
  const rpcs = (page) => page.evaluate(() => __rpcCalls.filter(c => c.fn === 'begin_acquisition').map(c => c.args.p_name));

  console.log('\nAcquisition Intake I-1 — the front door: properties, one or many\n' + '='.repeat(64));
  const { ctx, page } = await boot({ width: 1280, height: 1000 });

  // ── 1 · a brand-new account sees the front door ───────────────────────────
  check('1. a zero-property account sees the Acquisitions section', await vis(page, '#acqSection'));
  check('   with "+ New Acquisition"', await vis(page, '.acq-intake-start') && /\+ New Acquisition/.test(await page.$eval('.acq-intake-start', el => el.textContent)));
  check('   and "Add Property" is still on screen, where a first-timer looks first', await vis(page, '.ptf-start-cta'));
  check('   no review exists yet', (await page.evaluate(() => _acqReviews.length)) === 0 && /No due diligence reviews yet/.test(await page.$eval('#acqReviewsGrid', el => el.textContent)));

  // ── 2 · open the Intake ───────────────────────────────────────────────────
  await page.click('.acq-intake-start');
  await page.waitForTimeout(300);
  check('2. the Intake panel opens and the portfolio steps aside', await vis(page, '#acqIntakePanel') && !(await vis(page, '#portfolioDashboard')) && !(await vis(page, '#acqDetailPanel')));
  let r = await rows(page);
  check('   one empty row, nothing preselected, the cursor in the name', r.length === 1 && r[0].state === 'new' && r[0].name === '' && r[0].address === ''
        && await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-field') === 'name'), JSON.stringify(r));
  check('   Create is disabled until a property is named; the count of open prospects is 0', await page.$eval('#acqIntakeCreateBtn', b => b.disabled) && (await count(page)) === '0');

  // ── 3 · one property ──────────────────────────────────────────────────────
  await fillRow(page, 0, 'Maple Plaza', '120 Maple Ave, Springfield');
  check('3. naming a property enables Create, labelled for one', !(await page.$eval('#acqIntakeCreateBtn', b => b.disabled)) && (await page.$eval('#acqIntakeCreateBtn', b => b.textContent)) === 'Create prospect');
  await page.click('#acqIntakeCreateBtn');
  await idle(page);
  await page.waitForTimeout(200);
  r = await rows(page);
  const store1 = await page.evaluate(() => ({ props: JSON.parse(JSON.stringify(__store.properties)), reviews: JSON.parse(JSON.stringify(__store.acquisition_reviews)), mem: _acqReviews.map(x => ({ name: x.name, address: x.data && x.data.address, property_id: x.property_id })) }));
  check('   the row is created, and a fresh empty row follows it', r.length === 2 && r[0].state === 'created' && /Maple Plaza/.test(r[0].name) && r[1].state === 'new' && r[1].name === '', JSON.stringify(r));
  check('   exactly one begin_acquisition, with the name and the address in the review data', JSON.stringify(await rpcs(page)) === '["Maple Plaza"]'
        && (await page.evaluate(() => __rpcCalls[0].args.p_data.address)) === '120 Maple Ave, Springfield');
  check('   one PROSPECT property row, with no address column written', store1.props.length === 1 && store1.props[0].lifecycle_stage === 'prospect' && !('address' in store1.props[0]), JSON.stringify(store1.props[0]));
  check('   the address is on the review as evidence — stored, and in memory', store1.reviews.length === 1 && store1.reviews[0].data.address === '120 Maple Ave, Springfield' && store1.mem[0].address === '120 Maple Ave, Springfield' && store1.mem[0].property_id === store1.props[0].id, JSON.stringify(store1.mem));
  check('   the open-prospect count is 1 and names it', (await count(page)) === '1' && /Maple Plaza/.test(await page.$eval('#acqIntakeProspectList', el => el.textContent)));
  check('   the status says what happened', /Created 1 prospect\./.test(await status(page)), await status(page));
  check('   the Acquisitions grid (behind the panel) already has its card', (await page.$$eval('#acqReviewsGrid .acq-card', els => els.length)) === 1);

  // ── 4 · many ──────────────────────────────────────────────────────────────
  await page.click('#acqIntakeAddRowBtn');
  await page.click('#acqIntakeAddRowBtn');
  check('4. "+ Another property" adds rows; the last new row gets the cursor', (await editable(page)).length === 3 && await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-field') === 'name'));
  await fillRow(page, 0, 'Cedar Court', '45 Cedar Ct, Springfield');
  await fillRow(page, 1, 'Harbor Point', '');
  check('   Create is labelled for the two that are named; a blank row is simply ignored', (await page.$eval('#acqIntakeCreateBtn', b => b.textContent)) === 'Create 2 prospects');
  await page.click('#acqIntakeCreateBtn');
  await idle(page);
  await page.waitForTimeout(200);
  r = await rows(page);
  check('   both are created in order, one after another; the blank row stays as the next one', JSON.stringify(await rpcs(page)) === '["Maple Plaza","Cedar Court","Harbor Point"]'
        && r.filter(x => x.state === 'created').length === 3 && r.filter(x => x.state === 'new').length === 1, JSON.stringify(r.map(x => x.state)));
  check('   three open prospects', (await count(page)) === '3');
  check('   a property named without an address has no address evidence', (await page.evaluate(() => { const h = __store.acquisition_reviews.find(x => x.name === 'Harbor Point'); return h && !('address' in h.data); })) === true);

  // ── 5 · a failure in the middle — recoverable, nothing twice ─────────────
  await page.evaluate(() => { window.__failCreateFor = 'Oak Ridge'; });
  await page.click('#acqIntakeAddRowBtn');
  await page.click('#acqIntakeAddRowBtn');
  await fillRow(page, 0, 'Pine Crossing', '77 Pine Crossing Dr');
  await fillRow(page, 1, 'Oak Ridge', '300 Oak Ridge Blvd');
  await fillRow(page, 2, 'Birch Commons', '12 Birch Commons Ln');
  const before5 = (await rpcs(page)).length;
  await page.click('#acqIntakeCreateBtn');
  await idle(page);
  await page.waitForTimeout(200);
  r = await rows(page);
  const ed = r.filter(x => x.state !== 'created');
  check('5. the sequence stops at the row that failed: one created, the failed row says why, the row after it is untouched',
        r.filter(x => x.state === 'created').length === 4 && ed.length === 2 && ed[0].state === 'failed' && /refused/.test(ed[0].error) && ed[0].name === 'Oak Ridge' && ed[0].address === '300 Oak Ridge Blvd'
        && ed[1].state === 'new' && ed[1].name === 'Birch Commons', JSON.stringify(ed));
  check('   only two calls were made — the row after the failure was not attempted', (await rpcs(page)).length - before5 === 2, JSON.stringify((await rpcs(page)).slice(before5)));
  const st5 = await status(page);
  check('   the status says where it stopped, that what was created is kept, and what to do', /Created 1 of 3\. Stopped at "Oak Ridge": .*refused/.test(st5) && /already created is kept/.test(st5) && /press Create again/.test(st5), st5);
  check('   nothing was created for the failed or untouched rows', (await page.evaluate(() => __store.acquisition_reviews.filter(x => x.name === 'Oak Ridge' || x.name === 'Birch Commons').length)) === 0);
  await page.evaluate(() => { window.__failCreateFor = null; });
  await page.click('#acqIntakeCreateBtn');
  await idle(page);
  await page.waitForTimeout(200);
  r = await rows(page);
  check('   Create again continues from the failed row: the two remaining are created, nothing twice',
        r.filter(x => x.state === 'created').length === 6 && (await rpcs(page)).length - before5 === 4
        && (await page.evaluate(() => __store.acquisition_reviews.filter(x => x.name === 'Pine Crossing').length)) === 1
        && (await page.evaluate(() => __store.acquisition_reviews.length)) === 6, JSON.stringify(await rpcs(page)));
  check('   six open prospects', (await count(page)) === '6');

  // ── 6 · an address without a name ────────────────────────────────────────
  await fillRow(page, 0, '', '9 Nameless Way');
  const before6 = (await rpcs(page)).length;
  check('6. with nothing named, Create is disabled', await page.$eval('#acqIntakeCreateBtn', b => b.disabled));
  await page.evaluate(() => acqIntakeCreate());
  await page.waitForTimeout(150);
  r = await rows(page);
  check('   an address without a name is not sent; the row is asked for a name', (await rpcs(page)).length === before6 && r.some(x => x.state === 'failed' && /Name this property/.test(x.error)) && /Every property needs a name/.test(await status(page)), await status(page));
  await fillRow(page, 0, '', '');

  // ── 7 · a closed acquisition is not an open prospect ─────────────────────
  await page.evaluate(() => { _acqReviews.push({ id: 'rev-closed', user_id: 'u1', name: 'Old Deal', status: 'converted', property_id: 'p-old', data: { conversionRecord: { propertyId: 'p-old' } } }); _renderAcqIntake(); });
  check('7. a converted (closed) acquisition does not count as an open prospect', (await count(page)) === '6' && !/Old Deal/.test(await page.$eval('#acqIntakeProspectList', el => el.textContent)));

  // ── 8 · nothing else was written ─────────────────────────────────────────
  const w = await page.evaluate(() => ({ writes: __writes.filter(x => /properties|tenants|acquisition_documents|acquisition_document_families|storage/.test(x.table)), rpcs: Array.from(new Set(__rpcCalls.map(c => c.fn))) }));
  check('8. no property, tenant, document, family or storage write; the only RPC is begin_acquisition; no upload or AI call',
        w.writes.length === 0 && w.rpcs.join(',') === 'begin_acquisition' && net.upload === 0 && net.claude === 0 && net.other.length === 0, JSON.stringify(w) + ` upload=${net.upload} claude=${net.claude} other=${net.other.join(',')}`);

  // ── 9 · back, and back in ─────────────────────────────────────────────────
  await page.click('#acqIntakeBackBtn');
  await page.waitForTimeout(300);
  // Seven cards: the six prospects and the closed acquisition added in step 7 — a card, but not an open prospect.
  const cards9 = await page.$$eval('#acqReviewsGrid .acq-card', els => els.length);
  check('9. Back returns to the portfolio with the Acquisitions section and its cards (six prospects and the closed one)', !(await vis(page, '#acqIntakePanel')) && await vis(page, '#portfolioDashboard') && await vis(page, '#acqSection') && cards9 === 7, `cards=${cards9}`);
  await page.click('.acq-intake-start');
  await page.waitForTimeout(200);
  check('   coming back, the created rows are still listed and one empty row is offered', (await rows(page)).filter(x => x.state === 'created').length === 6 && (await editable(page)).length === 1);
  await page.click('#acqIntakeBackBtn');
  await page.waitForTimeout(200);

  // ── 10 · "+ New Review", the prompt path, still creates through the same place
  const before10 = (await rpcs(page)).length;
  await page.evaluate(async () => { window.prompt = () => 'Legacy Plaza'; await createAcquisitionReview(); });
  await page.waitForTimeout(300);
  check('10. createAcquisitionReview still works, through the one creation path, and opens the review',
        (await rpcs(page)).length === before10 + 1 && (await page.evaluate(() => _acqReviews[0].name)) === 'Legacy Plaza' && await vis(page, '#acqDetailPanel'));
  await page.evaluate(() => backToAcquisitions());
  await page.waitForTimeout(200);

  // ── 11 · a phone ──────────────────────────────────────────────────────────
  const m = await boot({ width: 390, height: 844 });
  await m.page.click('.acq-intake-start');
  await m.page.waitForTimeout(300);
  const geo = await m.page.evaluate(() => {
    const row = document.querySelector('#acqIntakeRows .acq-intake-row');
    const n = row.querySelector('input[data-field="name"]'), a = row.querySelector('input[data-field="address"]');
    const btn = document.getElementById('acqIntakeCreateBtn');
    return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
             stacked: a.getBoundingClientRect().top >= n.getBoundingClientRect().bottom - 1,
             nameW: n.getBoundingClientRect().width, rowW: row.getBoundingClientRect().width,
             createH: btn.getBoundingClientRect().height };
  });
  check('11. phone: no horizontal scroll, the fields stack, the name takes the row, Create is 44px', geo.scrollW <= geo.innerW + 1 && geo.stacked && geo.nameW > geo.rowW * 0.8 && geo.createH >= 44, JSON.stringify(geo));
  await m.ctx.close();

  check('no uncaught errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();
  const failed = results.filter(x => !x.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
