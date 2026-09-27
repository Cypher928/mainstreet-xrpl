'use strict';
/**
 * test-e2e-view-is-read-only.js — in the real browser: looking at a property
 * does not rewrite its record; the database beats a stale local copy; an edit
 * still saves.
 *
 *   node test-e2e-view-is-read-only.js
 *
 * P5-0 / P5-1. The Supabase client is a mock that plays the server (migrations
 * 034/035 for the deal, PostgREST upsert semantics for the row) and records
 * every properties upsert. The page is the real index.html + script.js +
 * property-os.js.
 *
 *   RO-1  a deal is acquired in place (035 mock); the acquisition made no client write
 *   RO-2  open → wait → back to portfolio → reopen → ZERO upserts; the row is byte-for-byte unchanged
 *   RO-3  a stale, richer, UNFLAGGED localStorage copy is ignored: the database roster is shown, nothing saved
 *   RO-4  a property name edit writes ONE upsert carrying acquiredFrom and the invoice stamps
 *   RO-5  a tenant edit through savePropertyData writes ONE upsert with the edit
 *   RO-6  a legacy row (numeric invoice ids, no _schemaVersion) opens with no write
 *   RO-7  a prospect / acquisition detail visit writes nothing to properties
 *   RO-8  no page errors
 *
 * Optional env vars: HEADLESS=false, APP_PORT=8072
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');
const PORT = parseInt(process.env.APP_PORT || '8072', 10);
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

const LEGACY_ID = 'prop-legacy-0001';
const SUPABASE_MOCK = `
(function () {
  var _user  = { id: 'e2e-test-user-id', email: 'e2e@test.local' };
  var _store = { properties: [
      { id: '${LEGACY_ID}', user_id: _user.id, name: 'Legacy Row', sqft: 9000, lifecycle_stage: 'acquired', acquired_at: '2026-01-01T00:00:00Z', archived_at: null,
        data: { invoices: [{ id: 0, vendorName: 'Old Co', amount: 100, category: 'other', invoiceDate: '2026-01-05' }, { id: '1', vendorName: 'Older Co', amount: 50, category: 'other', invoiceDate: '2026-01-06' }],
                tenants: [{ id: 'leg-t1', tenant_name: 'Legacy Tenant', leased_sqft: '900', lease_type: 'NNN', cap: 5 }],
                timeline: [{ id: 'tl-1', type: 'lease_uploaded', timestamp: '2026-01-01T00:00:00Z', title: 'Lease uploaded' }], disputes: [] } }
    ], acquisition_reviews: [], tenants: [{ id: 'leg-t1', property_id: '${LEGACY_ID}', name: 'Legacy Tenant', sqft: 900, cap: 5, start_date: null, end_date: null, lease_url: null, lease_type: 'NNN' }], __upserts: [], __rpcs: [] };
  var P = function (v) { return Promise.resolve(v); };
  function rowsOf(table, f) {
    return (_store[table] || []).filter(function (r) {
      return Object.keys(f.eq).every(function (k) { return r[k] === f.eq[k]; })
        && Object.keys(f.in).every(function (k) { return f.in[k].indexOf(r[k]) !== -1; })
        && Object.keys(f.is).every(function (k) { return f.is[k] === null ? (r[k] == null) : r[k] === f.is[k]; });
    });
  }
  function C(x) { return JSON.parse(JSON.stringify(x)); }
  function makeQ(table) {
    var f = { eq: {}, in: {}, is: {} }, pending = null, op = 'select', payload = null;
    var q = {
      select: function () { return q; },
      insert: function (rows) { var arr = Array.isArray(rows) ? rows : [rows]; arr.forEach(function (r) { _store[table].push(r); }); op = 'insert'; payload = arr; return q; },
      upsert: function (row) {
        var arr = Array.isArray(row) ? row : [row];
        arr.forEach(function (r) {
          var i = _store[table].findIndex(function (x) { return x.id === r.id; });
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
      // Rows cross the wire as JSON: the page never holds the store's own objects,
      // so an in-memory mutation (a minted invoice id) cannot leak into the "database".
      single: function () { var r = rowsOf(table, f); return P(r.length ? { data: C(r[0]), error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }); },
      maybeSingle: function () { var r = rowsOf(table, f); return P({ data: r[0] ? C(r[0]) : null, error: null }); },
      then: function (res, rej) {
        if (op === 'delete') { var keep = _store[table].filter(function (r) { return !rowsOf(table, f).includes(r); }); _store[table] = keep; return P({ data: null, error: null }).then(res, rej); }
        if (op === 'insert' || op === 'upsert') return P({ data: payload, error: null }).then(res, rej);
        var rows = rowsOf(table, f);
        if (pending) rows.forEach(function (r) { Object.assign(r, pending); r.updated_at = 'rev-' + Date.now() + '-' + Math.random().toString(36).slice(2); });
        return P({ data: rows.map(C), error: null }).then(res, rej);
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
          if (fn === 'begin_acquisition') {
            var pid = 'prop-' + Math.random().toString(36).slice(2);
            var rid = a.p_review_id || ('rev-' + Math.random().toString(36).slice(2));
            _store.properties.push({ id: pid, user_id: _user.id, name: a.p_name, sqft: 0, data: {}, lifecycle_stage: 'prospect', acquired_at: null, archived_at: null });
            _store.acquisition_reviews.push({ id: rid, user_id: _user.id, name: a.p_name, status: 'draft', data: a.p_data || {}, property_id: pid, converted_at: null, created_at: now, updated_at: now });
            return P({ data: { property_id: pid, review_id: rid, name: a.p_name, status: 'draft', lifecycle_stage: 'prospect', created_at: now, updated_at: now }, error: null });
          }
          if (fn === 'acquire_property') {
            var prop = _store.properties.find(function (r) { return r.id === a.p_property_id; });
            var rev  = _store.acquisition_reviews.find(function (r) { return r.id === a.p_review_id; });
            if (!prop || !rev) return P({ data: null, error: { code: 'P0002', message: 'no such property or review' } });
            if (prop.lifecycle_stage !== 'prospect') return P({ data: null, error: { code: '23514', message: 'not a prospect' } });
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
const rowSnapshot = (pid) => `(function(){ var r = window.__e2eStore.properties.find(function(p){return p.id==='${pid}';}); return JSON.stringify(r); })()`;

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
  const upserts = (pid) => page.evaluate((id) => window.__e2eStore.__upserts.filter(u => u.id === id).length, pid);

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => { const app = document.getElementById('appContent'); return app && app.style.display !== 'none' && app.style.display !== ''; }, null, { timeout: 45000 });
    await page.evaluate(() => { const m = document.getElementById('obWelcomeModal'); if (m && m.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else m.style.display = 'none'; } });

    // ── RO-1: acquire ──────────────────────────────────────────────────────
    section('RO-1: a deal is acquired in place');
    await page.evaluate(async () => { window.prompt = () => 'Read Only Plaza'; await createAcquisitionReview(); });
    await page.waitForFunction(() => window.__e2eStore.acquisition_reviews.length === 1, null, { timeout: 30000 });
    const deal = await page.evaluate(() => { const rev = window.__e2eStore.acquisition_reviews[0]; return { pid: rev.property_id, rid: rev.id }; });
    await page.evaluate(({ rid, F1, F2 }) => {
      const canon = [
        { id: F1, _leaseholdId: F1, _source: 'leasehold', _status: 'ok', tenant_name: 'Tenant One', leased_sqft: '400', cap: 5, start_date: '2024-01-01', end_date: '2029-12-31', lease_type: 'NNN' },
        { id: F2, _leaseholdId: F2, _source: 'leasehold', _status: 'ok', tenant_name: 'Tenant Two', leased_sqft: '600', cap: null, start_date: null, end_date: null, lease_type: 'Gross' },
      ];
      const store = window.__e2eStore.acquisition_reviews.find(r => r.id === rid);
      store.data = { tenants: [], invoices: [{ vendorName: 'GreenScape', amount: 3200, category: 'landscaping', invoiceDate: '2024-01-15', fileName: 'inv1.pdf' }], totalSqFt: 1000, documents: [], analysis: { summary: {}, rentRoll: { occupancy: 100, walt: 4.2 } } };
      const mem = (typeof _acqReviews !== 'undefined') ? _acqReviews.find(r => r.id === rid) : null;
      if (mem) { mem.data = store.data; mem.status = 'complete'; store.status = 'complete'; }
      window._acqConversionBlock = () => ''; window._acqEnsureRecord = async () => {};
      window._acqConversionReview = (r) => Object.assign({}, r, { data: Object.assign({}, r.data, { tenants: canon }) });
      _activeAcqId = rid;
    }, { rid: deal.rid, F1, F2 });
    await page.evaluate(async () => { await convertAcquisitionToProperty(); });
    await page.waitForTimeout(400);
    const acquired = await page.evaluate((pid) => { const p = window.__e2eStore.properties.find(x => x.id === pid); return { stage: p.lifecycle_stage, af: !!p.data.acquiredFrom, inv: p.data.invoices.length, n: window.__e2eStore.__upserts.length }; }, deal.pid);
    assert(acquired.stage === 'acquired' && acquired.af && acquired.inv === 1 && acquired.n === 0, 'RO-1: the same property is acquired with acquiredFrom and one stamped invoice; the client wrote nothing', JSON.stringify(acquired));

    // ── RO-2: open, wait, back, reopen — nothing written ───────────────────
    section('RO-2: viewing writes nothing');
    const before = await page.evaluate(rowSnapshot(deal.pid));
    await page.evaluate(async (pid) => { await selectProperty(pid); }, deal.pid);
    await page.waitForTimeout(2200);
    assert((await upserts(deal.pid)) === 0, 'RO-2: open + wait past the debounce → 0 upserts');
    const minted = await page.evaluate(() => (invoiceData || []).length === 1 && /^inv-/.test(String(invoiceData[0].id)));
    assert(minted, 'RO-2: the invoice id was minted in memory only');
    await page.evaluate(async () => { await backToPortfolio(); });
    await page.waitForTimeout(600);
    assert((await upserts(deal.pid)) === 0, 'RO-2: back to the portfolio → still 0 upserts');
    await page.evaluate(async (pid) => { await selectProperty(pid); }, deal.pid);
    await page.waitForTimeout(2200);
    assert((await upserts(deal.pid)) === 0, 'RO-2: reopen → still 0 upserts');
    const after = await page.evaluate(rowSnapshot(deal.pid));
    assert(after === before, 'RO-2: the stored row is byte-for-byte what it was before the first open', after === before ? '' : 'row changed');
    const shown = await page.evaluate(() => ({ tenants: (tenantData || []).filter(Boolean).map(t => t.id).sort(), inv: (invoiceData || []).length }));
    assert(shown.tenants.join() === [F1, F2].sort().join() && shown.inv === 1, 'RO-2: the workspace shows the database roster and invoices', JSON.stringify(shown));

    // ── RO-3: a stale richer local copy is ignored ─────────────────────────
    section('RO-3: the database beats a stale local copy');
    await page.evaluate(async () => { await backToPortfolio(); });
    await page.waitForTimeout(400);
    await page.evaluate(({ pid, F1, F2 }) => {
      const stale = { id: pid, name: 'Read Only Plaza', totalSqft: 1000, invoices: [{ id: 'inv-stale', vendorName: 'Stale Co', amount: 1 }], timeline: [],
        tenants: [{ id: F1, tenant_name: 'Tenant One' }, { id: F2, tenant_name: 'Tenant Two' }, { id: 'ghost-t', tenant_name: 'Ghost Tenant' }] };
      const stored = JSON.parse(_lsGet(_lsUserKey()) || '{}'); stored[pid] = stale; _lsSet(_lsUserKey(), JSON.stringify(stored));
    }, { pid: deal.pid, F1, F2 });
    await page.evaluate(async (pid) => { await selectProperty(pid); }, deal.pid);
    await page.waitForTimeout(2200);
    const ro3 = await page.evaluate((pid) => ({ n: window.__e2eStore.__upserts.filter(u => u.id === pid).length, tenants: (tenantData || []).filter(Boolean).map(t => t.id).sort(), inv: (invoiceData || []).map(i => i.vendorName) }), deal.pid);
    assert(ro3.tenants.join() === [F1, F2].sort().join() && !ro3.inv.includes('Stale Co') && ro3.inv.length === 1, 'RO-3: the unflagged richer local copy contributed nothing — database tenants and invoices are shown', JSON.stringify(ro3));
    assert(ro3.n === 0, 'RO-3: and nothing was saved', String(ro3.n));

    // ── RO-4: a name edit saves once, with the provenance ──────────────────
    section('RO-4: an edit writes once and carries the provenance');
    await page.evaluate(() => { const el = document.getElementById('propertyName'); el.value = 'Read Only Plaza II'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction((pid) => window.__e2eStore.__upserts.filter(u => u.id === pid).length > 0, deal.pid, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    const ro4 = await page.evaluate((pid) => { const ups = window.__e2eStore.__upserts.filter(u => u.id === pid); const last = ups[ups.length - 1]; return { n: ups.length, name: last && last.name, af: last && last.data.acquiredFrom, inv: last && last.data.invoices }; }, deal.pid);
    assert(ro4.n === 1 && ro4.name === 'Read Only Plaza II', 'RO-4: the name edit wrote exactly one upsert with the new name', JSON.stringify({ n: ro4.n, name: ro4.name }));
    assert(ro4.af && ro4.af.reviewId === deal.rid && Array.isArray(ro4.inv) && ro4.inv.length === 1 && ro4.inv[0].sourceEpisodeId === deal.rid && !!ro4.inv[0].acquiredAt && /^inv-/.test(ro4.inv[0].id), 'RO-4: acquiredFrom and the invoice stamps travelled with it', JSON.stringify({ af: ro4.af, inv: ro4.inv }));
    await page.evaluate(async () => { await backToPortfolio(); });
    await page.waitForTimeout(600);
    assert((await upserts(deal.pid)) === 1, 'RO-4: leaving after the save wrote no second copy');

    // ── RO-5: a tenant edit ────────────────────────────────────────────────
    section('RO-5: a tenant edit writes once');
    await page.evaluate(async (pid) => { await selectProperty(pid); }, deal.pid);
    await page.waitForTimeout(2200);
    await page.evaluate(() => { const t = tenantData.find(x => x && x.tenant_name === 'Tenant Two'); t.cap = 7; savePropertyData(); });
    await page.waitForTimeout(1400);
    const ro5 = await page.evaluate((pid) => { const ups = window.__e2eStore.__upserts.filter(u => u.id === pid); const last = ups[ups.length - 1]; const t = last && last.data.tenants.find(x => x.tenant_name === 'Tenant Two'); return { n: ups.length, cap: t && t.cap, af: !!(last && last.data.acquiredFrom) }; }, deal.pid);
    assert(ro5.n === 2 && ro5.cap === 7 && ro5.af, 'RO-5: the tenant edit wrote exactly one more upsert carrying the cap and the provenance', JSON.stringify(ro5));

    // ── RO-6: legacy row ───────────────────────────────────────────────────
    section('RO-6: a legacy row opens with no write');
    await page.evaluate(async () => { await backToPortfolio(); });
    await page.waitForTimeout(400);
    const legacyBefore = await page.evaluate(rowSnapshot(LEGACY_ID));
    await page.evaluate(async (pid) => { await selectProperty(pid); }, LEGACY_ID);
    await page.waitForTimeout(2200);
    const ro6 = await page.evaluate((pid) => ({ n: window.__e2eStore.__upserts.filter(u => u.id === pid).length, ids: (invoiceData || []).map(i => String(i.id)), tenants: (tenantData || []).filter(Boolean).length }), LEGACY_ID);
    assert(ro6.n === 0 && ro6.ids.length === 2 && ro6.ids.every(i => /^inv-/.test(i)) && ro6.tenants === 1, 'RO-6: numeric legacy invoice ids were re-minted in memory; nothing written', JSON.stringify(ro6));
    assert((await page.evaluate(rowSnapshot(LEGACY_ID))) === legacyBefore, 'RO-6: the legacy row is unchanged');
    await page.evaluate(async () => { await backToPortfolio(); });
    await page.waitForTimeout(400);
    assert((await upserts(LEGACY_ID)) === 0, 'RO-6: leaving it wrote nothing');

    // ── RO-7: the acquisition side ─────────────────────────────────────────
    section('RO-7: a prospect visit writes nothing to properties');
    await page.evaluate(async () => { window.prompt = () => 'Prospect Only'; await createAcquisitionReview(); });
    await page.waitForFunction(() => window.__e2eStore.acquisition_reviews.length === 2, null, { timeout: 30000 });
    const prospect = await page.evaluate(() => window.__e2eStore.acquisition_reviews[1].property_id);
    await page.evaluate(() => { closeAcquisitionDetail(); });
    await page.waitForTimeout(400);
    await page.evaluate((rid) => { selectAcquisitionReview(rid); }, await page.evaluate(() => window.__e2eStore.acquisition_reviews[1].id));
    await page.waitForTimeout(600);
    await page.evaluate(() => { closeAcquisitionDetail(); });
    const ro7 = await page.evaluate((pid) => ({ n: window.__e2eStore.__upserts.filter(u => u.id === pid).length, stage: window.__e2eStore.properties.find(p => p.id === pid).lifecycle_stage }), prospect);
    assert(ro7.n === 0 && ro7.stage === 'prospect', 'RO-7: the prospect property was never upserted by the client and is still a prospect', JSON.stringify(ro7));

    section('RO-8: page errors');
    assert(pageErrors.length === 0, 'RO-8: no page errors', pageErrors.slice(0, 3).join(' | '));
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
