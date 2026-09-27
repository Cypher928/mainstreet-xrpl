'use strict';
/**
 * test-e2e-acquire-preservation.js — in the real browser: acquire a deal in
 * place, open the acquired property, let the ordinary save run, and read what
 * the database was sent.
 *
 *   node test-e2e-acquire-preservation.js
 *
 * THE BUG THIS PINS (Maple plaza, 2026-09-27 13:40Z): acquire_property wrote
 * data.acquiredFrom and stamped the carried invoices; the first open of the
 * property ran selectProperty → loadPropertyData → renderProperty →
 * PropertyOS.ensureInvoiceIds (the invoices had no id) → savePropertyData → the
 * 800 ms debounce → saveProperty, and the upsert rebuilt properties.data from a
 * fixed key list. The provenance was gone 17 seconds after it was written.
 *
 * Here the Supabase client is a mock that plays the server's part: its
 * acquire_property writes exactly what migration 035 writes (same property id,
 * stage acquired, acquiredFrom, stamped invoices without ids, the roster under
 * data.tenants) and its upsert records every payload. The page is the real
 * index.html + script.js + property-os.js; the gate helpers that need a loaded
 * document record are replaced so the deal is acquirable, nothing on the save
 * path is.
 *
 *   PR-E2E-1  the deal is created through begin_acquisition (a prospect + episode)
 *   PR-E2E-2  Acquire runs ONE acquire_property call; the review is converted on the SAME property
 *   PR-E2E-3  opening the acquired property triggers the ordinary save (ensureInvoiceIds minted ids)
 *   PR-E2E-4  that save carried acquiredFrom and every invoice's sourceEpisodeId / acquiredAt
 *   PR-E2E-5  the client-owned keys are the client's (timeline has sync_restored; tenants normalised)
 *   PR-E2E-6  the row's own columns are untouched by the save (stage, acquired_at)
 *   PR-E2E-7  no page errors
 *
 * Optional env vars: HEADLESS=false, APP_PORT=8071
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');
const PORT = parseInt(process.env.APP_PORT || '8071', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT = __dirname;

let failures = 0;
function pass(label)    { console.log('\x1b[32m  ✅ ' + label + '\x1b[0m'); }
function fail(label, d) { console.error('\x1b[31m  ❌ ' + label + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; }
function info(label)    { console.log('  · ' + label); }
function section(label) { console.log('\n── ' + label + ' ' + '─'.repeat(Math.max(0, 60 - label.length))); }
function assert(cond, label, detail) { cond ? pass(label) : fail(label, detail); }

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url).split('?')[0];
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

// ── The Supabase mock: a store, filters honoured, upserts recorded, and the
//    two lifecycle RPCs playing migrations 034 and 035. ─────────────────────
const SUPABASE_MOCK = `
(function () {
  var _store = { properties: [], acquisition_reviews: [], tenants: [], __upserts: [], __rpcs: [] };
  var _user  = { id: 'e2e-test-user-id', email: 'e2e@test.local' };
  var P = function (v) { return Promise.resolve(v); };
  function rowsOf(table, f) {
    return (_store[table] || []).filter(function (r) {
      return Object.keys(f.eq).every(function (k) { return r[k] === f.eq[k]; })
        && Object.keys(f.in).every(function (k) { return f.in[k].indexOf(r[k]) !== -1; })
        && Object.keys(f.is).every(function (k) { return f.is[k] === null ? (r[k] == null) : r[k] === f.is[k]; });
    });
  }
  function makeQ(table) {
    var f = { eq: {}, in: {}, is: {} }, pending = null, op = 'select', payload = null;
    var q = {
      select: function () { return q; },
      insert: function (rows) { var arr = Array.isArray(rows) ? rows : [rows]; arr.forEach(function (r) { _store[table].push(r); }); op = 'insert'; payload = arr; return q; },
      upsert: function (row) {
        var arr = Array.isArray(row) ? row : [row];
        arr.forEach(function (r) {
          var i = _store[table].findIndex(function (x) { return x.id === r.id; });
          // PostgREST sets the columns it is given and leaves the rest — so does this.
          if (i >= 0) Object.assign(_store[table][i], JSON.parse(JSON.stringify(r))); else _store[table].push(JSON.parse(JSON.stringify(r)));
          if (table === 'properties') _store.__upserts.push(JSON.parse(JSON.stringify(r)));
        });
        op = 'upsert'; payload = arr; return q;
      },
      update: function (patch) { pending = patch; return q; },
      delete: function () { op = 'delete'; return q; },
      eq: function (c, v) { f.eq[c] = v; return q; }, in: function (c, v) { f.in[c] = v; return q; }, is: function (c, v) { f.is[c] = v; return q; },
      neq: function () { return q; }, not: function () { return q; }, or: function () { return q; }, gte: function () { return q; }, lte: function () { return q; },
      order: function () { return q; }, limit: function () { return q; }, range: function () { return q; }, ilike: function () { return q; },
      single: function () { var r = rowsOf(table, f); return P(r.length ? { data: r[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }); },
      maybeSingle: function () { var r = rowsOf(table, f); return P({ data: r[0] || null, error: null }); },
      then: function (res, rej) {
        if (op === 'delete') { var keep = _store[table].filter(function (r) { return !rowsOf(table, f).includes(r); }); _store[table] = keep; return P({ data: null, error: null }).then(res, rej); }
        if (op === 'insert' || op === 'upsert') return P({ data: payload, error: null }).then(res, rej);
        var rows = rowsOf(table, f);
        if (pending) rows.forEach(function (r) { Object.assign(r, pending); r.updated_at = 'rev-' + Date.now() + '-' + Math.random().toString(36).slice(2); });
        return P({ data: rows, error: null }).then(res, rej);
      }
    };
    return q;
  }
  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getUser: function () { return P({ data: { user: _user }, error: null }); },
          getSession: function () { return P({ data: { session: { user: _user } }, error: null }); },
          onAuthStateChange: function (cb) { setTimeout(function () { cb('SIGNED_IN', { user: _user }); }, 50); return { data: { subscription: { unsubscribe: function () {} } } }; },
          signOut: function () { return P({ error: null }); }
        },
        from: function (table) { if (!_store[table]) _store[table] = []; return makeQ(table); },
        rpc: function (fn, args) {
          var a = args || {}; var now = new Date().toISOString();
          _store.__rpcs.push({ fn: fn, args: JSON.parse(JSON.stringify(a)) });
          if (fn === 'begin_acquisition') {              // migration 034
            var pid = 'prop-' + Math.random().toString(36).slice(2);
            var rid = a.p_review_id || ('rev-' + Math.random().toString(36).slice(2));
            _store.properties.push({ id: pid, user_id: _user.id, name: a.p_name, sqft: 0, data: {}, lifecycle_stage: 'prospect', acquired_at: null, archived_at: null });
            _store.acquisition_reviews.push({ id: rid, user_id: _user.id, name: a.p_name, status: 'draft', data: a.p_data || {}, property_id: pid, converted_at: null, created_at: now, updated_at: now });
            return P({ data: { property_id: pid, review_id: rid, name: a.p_name, status: 'draft', lifecycle_stage: 'prospect', created_at: now, updated_at: now }, error: null });
          }
          if (fn === 'acquire_property') {               // migration 035, the writes it makes
            var prop = _store.properties.find(function (r) { return r.id === a.p_property_id; });
            var rev  = _store.acquisition_reviews.find(function (r) { return r.id === a.p_review_id; });
            if (!prop || !rev) return P({ data: null, error: { code: 'P0002', message: 'no such property or review' } });
            if (prop.lifecycle_stage !== 'prospect') return P({ data: null, error: { code: '23514', message: 'Property is ' + prop.lifecycle_stage + ', not a prospect' } });
            var roster = (a.p_snapshot && a.p_snapshot.roster) || [];
            var pubRoster = roster.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = r[k]; }); var fid = r.family_id || r._leaseholdId || r.id; o.id = fid; o._fromAcquisition = true; o._leaseholdId = fid; return o; });
            var carried = (rev.data.invoices || []).map(function (i) { return Object.assign({}, i, { sourceEpisodeId: rev.id, acquiredAt: now }); });
            prop.lifecycle_stage = 'acquired'; prop.acquired_at = now;
            prop.data = Object.assign({}, prop.data || {}, { invoices: ((prop.data || {}).invoices || []).concat(carried), tenants: pubRoster, acquiredFrom: { reviewId: rev.id, acquiredAt: now, source: 'acquire_property' } });
            roster.forEach(function (r) { var fid = r.family_id || r._leaseholdId || r.id; _store.tenants.push({ id: fid, property_id: prop.id, name: r.tenant_name || 'Unnamed', sqft: Number(r.leased_sqft) || null, cap: r.cap == null ? null : Number(r.cap), start_date: r.start_date || null, end_date: r.end_date || null, lease_url: null, lease_type: r.lease_type || null }); });
            rev.status = 'converted'; rev.converted_at = now; rev.updated_at = now + '-srv';
            rev.data = Object.assign({}, rev.data, { conversionRecord: { propertyId: prop.id, propertyName: prop.name, convertedAt: now, reviewId: rev.id, source: 'acquire_property' }, stage: 'acquired' });
            return P({ data: { ok: true, property_id: prop.id, review_id: rev.id, lifecycle_stage: 'acquired', acquired_at: now, converted_at: now, tenants_written: roster.length, invoices_carried: carried.length, event_id: 'ev-1',
                                review: { id: rev.id, name: rev.name, status: rev.status, property_id: prop.id, converted_at: now, created_at: rev.created_at, updated_at: rev.updated_at, data: rev.data } }, error: null });
          }
          return P({ data: null, error: null });
        },
        _store: _store
      };
    }
  };
  window.__e2eStore = _store;
})();
`;

const F1 = 'ffffffff-0000-4000-8000-0000000000f1', F2 = 'ffffffff-0000-4000-8000-0000000000f2';

(async () => {
  info('Starting local HTTP server on port ' + PORT + '…');
  const server = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('**/supabase-js**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed by e2e mock */' }));
  await page.addInitScript(SUPABASE_MOCK);

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => { const app = document.getElementById('appContent'); return app && app.style.display !== 'none' && app.style.display !== ''; }, null, { timeout: 45000 });
    await page.evaluate(() => {
      const m = document.getElementById('obWelcomeModal');
      if (m && m.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else m.style.display = 'none'; }
    });

    // ── PR-E2E-1: the deal ─────────────────────────────────────────────────
    section('PR-E2E-1: a deal begins as a prospect + episode');
    // What the "+ New Review" button does (it is not rendered while the
    // portfolio is empty, so it is called rather than clicked).
    await page.evaluate(async () => { window.prompt = () => 'Preservation Deal'; await createAcquisitionReview(); });
    await page.waitForFunction(() => window.__e2eStore.acquisition_reviews.length === 1 && window.__e2eStore.properties.length === 1, null, { timeout: 30000 });
    const deal = await page.evaluate(() => {
      const s = window.__e2eStore; const rev = s.acquisition_reviews[0]; const prop = s.properties.find(p => p.id === rev.property_id);
      return { pid: prop && prop.id, rid: rev.id, stage: prop && prop.lifecycle_stage, status: rev.status };
    });
    assert(deal.pid && deal.stage === 'prospect' && deal.status === 'draft', 'PR-E2E-1: begin_acquisition created the prospect and its draft episode', JSON.stringify(deal));

    // The episode's record: two leaseholds, two invoices, an analysis. The gate
    // helpers that need the loaded document record are replaced; nothing on
    // the save path is.
    await page.evaluate(({ rid, pid, F1, F2 }) => {
      const canon = [
        { id: F1, _leaseholdId: F1, _source: 'leasehold', _status: 'ok', tenant_name: 'Tenant One', leased_sqft: '400', cap: 5, start_date: '2024-01-01', end_date: '2029-12-31', lease_type: 'NNN' },
        { id: F2, _leaseholdId: F2, _source: 'leasehold', _status: 'ok', tenant_name: 'Tenant Two.', leased_sqft: '600', cap: null, start_date: null, end_date: null, lease_type: 'Gross' },
      ];
      const store = window.__e2eStore.acquisition_reviews.find(r => r.id === rid);
      store.data = { tenants: [], invoices: [{ vendorName: 'GreenScape', amount: 3200, category: 'landscaping', invoiceDate: '2024-01-15', fileName: 'inv1.pdf' }, { vendorName: 'ABC Insurance', amount: 6000, category: 'insurance', invoiceDate: '2026-01-01', fileName: 'abc.pdf' }],
                     totalSqFt: 1000, documents: [], analysis: { summary: {}, rentRoll: { occupancy: 100, walt: 4.2 } } };
      const mem = (typeof _acqReviews !== 'undefined') ? _acqReviews.find(r => r.id === rid) : null;
      if (mem) { mem.data = store.data; mem.status = 'complete'; store.status = 'complete'; }
      window._acqConversionBlock = () => '';
      window._acqEnsureRecord = async () => {};
      window._acqConversionReview = (r) => Object.assign({}, r, { data: Object.assign({}, r.data, { tenants: canon }) });
      _activeAcqId = rid;
    }, { rid: deal.rid, pid: deal.pid, F1, F2 });

    // ── PR-E2E-2: Acquire ──────────────────────────────────────────────────
    section('PR-E2E-2: Acquire in place');
    await page.evaluate(async () => { await convertAcquisitionToProperty(); });
    await page.waitForTimeout(400);
    const after = await page.evaluate(({ pid, rid }) => {
      const s = window.__e2eStore; const prop = s.properties.find(p => p.id === pid); const rev = s.acquisition_reviews.find(r => r.id === rid);
      return { rpcs: s.__rpcs.map(r => r.fn), stage: prop.lifecycle_stage, acquired_at: prop.acquired_at, acquiredFrom: prop.data.acquiredFrom, invoices: prop.data.invoices, tenants: prop.data.tenants,
               revStatus: rev.status, revProp: rev.property_id, props: s.properties.length, upserts: s.__upserts.length, inPortfolio: (typeof _props !== 'undefined') ? _props.map(p => p.id) : null };
    }, deal);
    assert(after.rpcs.filter(f => f === 'acquire_property').length === 1, 'PR-E2E-2: exactly one acquire_property call', after.rpcs.join());
    assert(after.stage === 'acquired' && after.props === 1 && after.revStatus === 'converted' && after.revProp === deal.pid, 'PR-E2E-2: the SAME property is acquired, no second row, the review converted on it', JSON.stringify(after));
    assert(after.upserts === 0, 'PR-E2E-2: the acquisition itself made no client write to properties', String(after.upserts));
    assert(after.invoices.length === 2 && after.invoices.every(i => i.sourceEpisodeId === deal.rid && i.acquiredAt && i.id == null), 'PR-E2E-2: the server carried 2 stamped invoices, without ids (what 035 writes)', JSON.stringify(after.invoices));
    assert(Array.isArray(after.inPortfolio) && after.inPortfolio.includes(deal.pid), 'PR-E2E-2: the portfolio was reloaded and holds the same property', JSON.stringify(after.inPortfolio));
    const provenance = { acquiredFrom: after.acquiredFrom, stamps: after.invoices.map(i => [i.sourceEpisodeId, i.acquiredAt]) };

    // ── PR-E2E-3/4/5/6: open it, let the ordinary save run ─────────────────
    section('PR-E2E-3..6: open the acquired property; the ordinary save runs; the provenance survives');
    await page.evaluate(async (pid) => { await selectProperty(pid); }, deal.pid);
    await page.waitForFunction(() => window.__e2eStore.__upserts.length > 0, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);     // past the 800 ms debounce, and any second save behind it
    const saved = await page.evaluate((pid) => {
      const s = window.__e2eStore; const prop = s.properties.find(p => p.id === pid);
      const ups = s.__upserts.filter(u => u.id === pid);
      return { n: ups.length, last: ups[ups.length - 1], row: { stage: prop.lifecycle_stage, acquired_at: prop.acquired_at, keys: Object.keys(prop.data).sort() },
               workflowVisible: (document.getElementById('mainWorkflow') || {}).style && document.getElementById('mainWorkflow').style.display !== 'none' };
    }, deal.pid);
    assert(saved.n >= 1 && saved.last && saved.last.data, 'PR-E2E-3: opening the property triggered the ordinary save (' + saved.n + ' upsert(s))', JSON.stringify(saved.n));
    const d = (saved.last && saved.last.data) || {};
    assert(Array.isArray(d.invoices) && d.invoices.length === 2 && d.invoices.every(i => /^inv-/.test(String(i.id))), 'PR-E2E-3: it was the ensureInvoiceIds save — every invoice now has a minted id', JSON.stringify(d.invoices));
    assert(JSON.stringify(d.acquiredFrom) === JSON.stringify(provenance.acquiredFrom), 'PR-E2E-4: the upsert payload carries data.acquiredFrom exactly as the server wrote it', JSON.stringify(d.acquiredFrom));
    assert(d.invoices.every((i, k) => i.sourceEpisodeId === provenance.stamps[k][0] && i.acquiredAt === provenance.stamps[k][1]), 'PR-E2E-4: every invoice keeps sourceEpisodeId and acquiredAt', JSON.stringify(d.invoices.map(i => [i.sourceEpisodeId, i.acquiredAt])));
    assert(Array.isArray(d.timeline) && d.timeline.some(e => e.type === 'sync_restored') && Array.isArray(d.tenants) && d.tenants.length === 2 && d.tenants.every(x => 'reviewOverrides' in x) && d.tenants.map(x => x.id).sort().join() === [F1, F2].sort().join(),
      'PR-E2E-5: client-owned keys are the client\'s — timeline carries sync_restored, tenants are the normalised rows keyed by the leasehold ids', JSON.stringify({ tl: (d.timeline || []).map(e => e.type), tenants: (d.tenants || []).map(x => x.id) }));
    assert(!('lifecycle_stage' in saved.last) && saved.row.stage === 'acquired' && saved.row.acquired_at, 'PR-E2E-6: the save names no stage column; the row stays acquired with its acquired_at', JSON.stringify(saved.row));
    assert(saved.row.keys.includes('acquiredFrom'), 'PR-E2E-6: after the save the stored blob still holds acquiredFrom', saved.row.keys.join());
    assert(saved.workflowVisible, 'PR-E2E-6: the property workspace is on screen', String(saved.workflowVisible));

    // ── PR-E2E-7 ───────────────────────────────────────────────────────────
    section('PR-E2E-7: page errors');
    assert(pageErrors.length === 0, 'PR-E2E-7: no page errors', pageErrors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('harness error: ' + e.message, e.stack && e.stack.split('\n').slice(0, 3).join(' '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + '─'.repeat(58));
  if (failures) { console.log(`\x1b[31m${failures} assertion(s) failed\x1b[0m`); process.exit(1); }
  console.log('\x1b[32mAll assertions passed\x1b[0m');
})();
