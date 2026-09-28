'use strict';
/**
 * test-e2e-property-leaseholds.js — P5-2 in a real browser.
 *
 * UPLOAD/VERIFY ONCE → ACQUIRE → THE PROPERTY REMEMBERS IT.
 *
 * An ACQUIRED property shaped exactly like Maple plaza (five tenants whose ids
 * are the five leasehold ids; eight acquisition documents, five of them live
 * and confirmed; term decisions) is opened in the ordinary Property Workspace
 * against a persisted Supabase stand-in that emulates the tables' membership
 * RLS (rows of a property this user does not own are invisible) and counts
 * every write.
 *
 *   LH-1  the workspace opens; Spaces shows the same five tenants, ShopRite 67,000, 77,500 leased
 *   LH-2  the ShopRite file: two acquisition documents on file, "Verified at acquisition — 3 term decisions"
 *   LH-3  a document another member uploaded is on file, without a link
 *   LH-4  Sunrise (an entered leasehold, no document) reads exactly as before
 *   LH-5  superseded and unfiled documents appear on no tenant
 *   LH-6  open → leave → reopen → open the file again: ZERO writes anywhere; tenants 5; families 5; the row byte-identical; the review still converted
 *   LH-7  a property switch: the legacy property shows only its own lease document; nothing of Maple's leaks; its projection is empty
 *   LH-8  a prospect: nothing is read from the acquisition tables for it
 *   LH-9  another user's property: the membership scope returns nothing; no leasehold, no error
 *   LH-10 no page errors
 *
 *   node test-e2e-property-leaseholds.js
 */
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = __dirname, PORT = 8074, HEADLESS = true;
let passes = 0, failures = 0;
function pass(l) { console.log('\x1b[32m  ✅ ' + l + '\x1b[0m'); passes++; }
function fail(l, d) { console.error('\x1b[31m  ❌ ' + l + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; }
function section(l) { console.log('\n── ' + l + ' ' + '─'.repeat(Math.max(0, 60 - l.length))); }
function assert(c, l, d) { c ? pass(l) : fail(l, d); }
const is = (got, want, l) => assert(JSON.stringify(got) === JSON.stringify(want), l, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let u = req.url.split('?')[0]; if (u === '/') u = '/index.html';
      if (u.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
      fs.readFile(path.join(ROOT, u), (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server)); server.on('error', reject);
  });
}

// ── Fixtures: Maple as the Pilot holds it, plus a legacy property, a prospect and another user's property ──
const UID = 'e2e-test-user-id', OTHER_UID = 'someone-else-uid';
const MAPLE = '3dc8a7b8-170c-4a51-b90d-dde831c56ca9', RV = '59af3e99-82dc-4a97-813b-21e4f956aca8';
const LEGACY = 'aaaaaaaa-1111-4111-8111-00000000le9a', PROSPECT = 'bbbbbbbb-2222-4222-8222-0000000pr05p', FOREIGN = 'cccccccc-3333-4333-8333-00000000f0re';
const F = { luxe: 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', coffee: 'ae6f43fd-eb1e-469f-928e-0caa706914a7', prime: 'a4ded336-7195-42d1-9f90-d9f67c6d62d6', shoprite: '8b175124-98c2-46be-a44c-34d622378e44', sunrise: 'c99dda4d-b477-4098-a9e3-2af250a6b8af' };
const T = (id, name, sqft, extra) => Object.assign({ id, tenant_name: name, leased_sqft: sqft, lease_type: 'NNN', start_date: '2024-03-01', end_date: '2029-02-28', cap: null, flags: [], confidence: {}, review: {}, reviewOverrides: {} }, extra || {});
const MAPLE_TENANTS = [T(F.luxe, 'Luxe Nails', '3000', { suite: 'A-1' }), T(F.coffee, 'Maple Coffee Co.', '3000', { suite: 'B-2' }), T(F.prime, 'Prime Wellness Spa', '4500', { suite: 'C-1' }), T(F.shoprite, 'ShopRite Supermarkets, Inc.', '67000', { suite: '100' }), T(F.sunrise, 'Sunrise Cafe & Bakery LLC', null, { suite: 'D-4' })];
const tblRow = (t, pid) => ({ id: t.id, property_id: pid, name: t.tenant_name, sqft: t.leased_sqft == null ? null : Number(t.leased_sqft), cap: null, start_date: t.start_date || null, end_date: t.end_date || null, lease_url: t.leaseUrl || null, lease_type: t.lease_type || null });
const fam = (id, label, pid, rid) => ({ id, review_id: rid || RV, property_id: pid || MAPLE, user_id: UID, label, family_kind: 'lease', tenant_hint: label, suite_hint: null, created_at: '2026-09-22T15:13:23Z', updated_at: '2026-09-27T03:27:53Z' });
const sp = (name, uid) => `leases/${uid || UID}/acq_${RV}_1789993792724-${name}`;
const doc = (o) => Object.assign({ review_id: RV, property_id: MAPLE, user_id: UID, content_type: 'application/pdf', byte_size: 1000, doc_type_status: 'confirmed', confirmed_by: UID, superseded_by_document_id: null, doc_date: null, intake_kind: 'lease', parsing_status: 'success' }, o);
const FIX = {
  properties: [
    { id: MAPLE, user_id: UID, name: 'Maple plaza', sqft: 77500, lifecycle_stage: 'acquired', acquired_at: '2026-09-27T13:40:41Z', archived_at: null,
      data: { tenants: MAPLE_TENANTS, invoices: [], disputes: [], timeline: [], camYear: 2025 } },
    { id: LEGACY, user_id: UID, name: 'Legacy Row', sqft: 9000, lifecycle_stage: 'acquired', acquired_at: '2026-01-01T00:00:00Z', archived_at: null,
      data: { tenants: [T('leg-t1', 'Legacy Tenant', '900', { leaseUrl: 'leases/' + UID + '/legacy-lease.pdf', leaseFileName: 'Legacy_Lease.pdf' })], invoices: [], disputes: [], timeline: [] } },
    { id: PROSPECT, user_id: UID, name: 'Prospect Deal', sqft: 0, lifecycle_stage: 'prospect', acquired_at: null, archived_at: null, data: { tenants: [], invoices: [] } },
    { id: FOREIGN, user_id: OTHER_UID, name: 'Foreign Plaza', sqft: 5000, lifecycle_stage: 'acquired', acquired_at: '2026-02-01T00:00:00Z', archived_at: null,
      data: { tenants: [T('for-t1', 'Foreign Tenant', '5000')], invoices: [] } },
  ],
  // The tenants table mirrors the blob (resync_property_tenants writes lease_url from t.leaseUrl), as every real row does.
  tenants: MAPLE_TENANTS.map(t => tblRow(t, MAPLE)).concat([tblRow(T('leg-t1', 'Legacy Tenant', '900', { leaseUrl: 'leases/' + UID + '/legacy-lease.pdf' }), LEGACY), tblRow(T('for-t1', 'Foreign Tenant', '5000'), FOREIGN)]),
  acquisition_reviews: [{ id: RV, user_id: UID, name: 'Maple plaza', status: 'converted', property_id: MAPLE, converted_at: '2026-09-27T13:40:41Z', created_at: '2026-09-17T19:14:41Z', updated_at: '2026-09-27T13:40:41Z',
    data: { conversionRecord: { propertyId: MAPLE, reviewId: RV, source: 'acquire_property' }, tenants: [], invoices: [] } }],
  acquisition_document_families: [
    fam(F.shoprite, 'ShopRite Supermarkets, Inc.'), fam(F.luxe, 'Luxe Nails'), fam(F.coffee, 'Maple Coffee Co.'), fam(F.prime, 'Prime Wellness Spa'), fam(F.sunrise, 'Sunrise Cafe & Bakery LLC'),
    fam('pppppppp-0000-4000-8000-000000000001', 'Prospect Tenant', PROSPECT, 'rev-prospect'),
    Object.assign(fam('for-t1', 'Foreign Tenant', FOREIGN, 'rev-foreign'), { user_id: OTHER_UID }),
  ],
  acquisition_documents: [
    doc({ id: '440d3294-d97d-4248-ae6e-8af6facdd8d3', file_name: 'SafeShield_Insurance_Lease.pdf', storage_path: sp('SafeShield_Insurance_Lease.pdf'), family_id: null, family_status: 'unfiled', doc_type: null, doc_type_status: 'unclassified', confirmed_by: null, confirmed_at: null, created_at: '2026-09-21T12:29:52Z' }),
    doc({ id: 'ed5abee6-b156-4617-b412-31f7a910161a', file_name: 'Prime_Wellness_Spa_Lease.pdf', storage_path: sp('Prime_Wellness_Spa_Lease.pdf'), family_id: null, family_status: 'unfiled', doc_type: null, confirmed_by: null, confirmed_at: null, superseded_by_document_id: 'cb91e8fc-58ba-43bc-95dd-f3ceb9df93ec', created_at: '2026-09-21T12:30:54Z' }),
    doc({ id: '3fc9463f-230e-424c-8bba-7dfacafd6a98', file_name: 'ShopRite_Anchor_Tenant_Lease.pdf', storage_path: sp('ShopRite_Anchor_Tenant_Lease.pdf'), family_id: F.shoprite, family_status: 'confirmed', doc_type: 'renewal', doc_type_status: 'corrected', confirmed_at: '2026-09-26T00:06:07Z', created_at: '2026-09-21T12:31:02Z' }),
    doc({ id: 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf', file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf', storage_path: sp('Maple_Plaza_Test_Lease_Amendment.pdf'), family_id: F.shoprite, family_status: 'confirmed', doc_type: 'amendment', doc_date: '2027-01-01', confirmed_at: '2026-09-22T15:14:14Z', created_at: '2026-09-22T03:15:36Z' }),
    // Luxe's lease was uploaded by ANOTHER member: on file, but not this user's to open.
    doc({ id: 'd11215d4-1035-4f73-958a-5a260fb339e7', file_name: 'Luxe_Nails_Lease.pdf', storage_path: sp('Luxe_Nails_Lease.pdf', OTHER_UID), user_id: OTHER_UID, family_id: F.luxe, family_status: 'confirmed', doc_type: 'original_lease', confirmed_at: '2026-09-22T20:12:34Z', created_at: '2026-09-22T20:12:10Z' }),
    doc({ id: 'cb91e8fc-58ba-43bc-95dd-f3ceb9df93ec', file_name: 'Prime_Wellness_Spa_Lease.pdf', storage_path: sp('Prime_Wellness_Spa_Lease.pdf'), family_id: null, family_status: 'unfiled', doc_type: null, confirmed_by: null, confirmed_at: null, superseded_by_document_id: 'ebc3f7b1-69cc-431a-8beb-9c123b07265d', created_at: '2026-09-22T20:12:24Z' }),
    doc({ id: 'c50c30e8-5c7c-43c0-91fa-378437e2d9d3', file_name: 'maple_plaza_messy_lease.pdf', storage_path: sp('maple_plaza_messy_lease.pdf'), family_id: F.coffee, family_status: 'confirmed', doc_type: 'original_lease', doc_date: '2024-03-01', confirmed_at: '2026-09-26T00:06:23Z', created_at: '2026-09-23T00:01:18Z' }),
    doc({ id: 'ebc3f7b1-69cc-431a-8beb-9c123b07265d', file_name: 'Prime_Wellness_Spa_Lease.pdf', storage_path: sp('Prime_Wellness_Spa_Lease.pdf'), family_id: F.prime, family_status: 'confirmed', doc_type: 'original_lease', doc_date: '2024-03-01', confirmed_at: '2026-09-26T00:06:25Z', created_at: '2026-09-23T02:06:18Z' }),
    // A ShopRite lease that was filed and confirmed, then replaced by a later upload: superseded, off the file.
    doc({ id: 'shop-old-version', file_name: 'ShopRite_Lease_OLD_SCAN.pdf', storage_path: sp('ShopRite_Lease_OLD_SCAN.pdf'), family_id: F.shoprite, family_status: 'confirmed', doc_type: 'original_lease', confirmed_at: '2026-09-20T00:00:00Z', superseded_by_document_id: '3fc9463f-230e-424c-8bba-7dfacafd6a98', created_at: '2026-09-20T00:00:00Z' }),
    doc({ id: 'doc-prospect', review_id: 'rev-prospect', property_id: PROSPECT, file_name: 'Prospect_Lease.pdf', storage_path: sp('Prospect_Lease.pdf'), family_id: 'pppppppp-0000-4000-8000-000000000001', family_status: 'confirmed', doc_type: 'original_lease', confirmed_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' }),
    doc({ id: 'doc-foreign', review_id: 'rev-foreign', property_id: FOREIGN, user_id: OTHER_UID, file_name: 'Foreign_Lease.pdf', storage_path: sp('Foreign_Lease.pdf', OTHER_UID), family_id: 'for-t1', family_status: 'confirmed', doc_type: 'original_lease', confirmed_at: '2026-02-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z' }),
  ],
  acquisition_term_decisions: [
    { id: 'dec-shop-1', review_id: RV, property_id: MAPLE, user_id: UID, family_id: F.shoprite, field_key: 'leased_sqft', action: 'confirm', previous_value: null, new_value: '65000', source_document_id: '3fc9463f-230e-424c-8bba-7dfacafd6a98', source_quote: null, source_page: null, decided_by: UID, decided_at: '2026-09-25T10:00:00Z', note: null, created_at: '2026-09-25T10:00:00Z' },
    { id: 'dec-shop-2', review_id: RV, property_id: MAPLE, user_id: UID, family_id: F.shoprite, field_key: 'cap', action: 'confirm', previous_value: null, new_value: '4', source_document_id: null, source_quote: null, source_page: null, decided_by: UID, decided_at: '2026-09-25T10:01:00Z', note: null, created_at: '2026-09-25T10:01:00Z' },
    { id: 'ac6c910d-0cd8-40b4-9587-955cb4f215ec', review_id: RV, property_id: MAPLE, user_id: UID, family_id: F.shoprite, field_key: 'leased_sqft', action: 'correct', previous_value: '65000', new_value: '67000', source_document_id: 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf', source_quote: null, source_page: null, decided_by: UID, decided_at: '2026-09-26T16:51:27Z', note: null, created_at: '2026-09-26T16:51:29Z' },
    { id: 'd045e5e7-58a2-4561-9bce-26aaa6fd54ed', review_id: RV, property_id: MAPLE, user_id: UID, family_id: F.luxe, field_key: 'end_date', action: 'correct', previous_value: null, new_value: '2031-07-07', source_document_id: null, source_quote: null, source_page: null, decided_by: UID, decided_at: '2026-09-25T23:29:00Z', note: 'Entered by a person. No document on file supports it.', created_at: '2026-09-25T23:29:00Z' },
    { id: 'dec-foreign', review_id: 'rev-foreign', property_id: FOREIGN, user_id: OTHER_UID, family_id: 'for-t1', field_key: 'cap', action: 'confirm', new_value: '5', decided_by: OTHER_UID, decided_at: '2026-02-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z' },
  ],
};

// The stand-in. Rows cross as JSON; membership RLS is emulated (this user is a
// member of the properties it owns and of nothing else); every write and every
// select is recorded.
const SUPABASE_MOCK = `
(function () {
  var _user = { id: '${UID}', email: 'e2e@test.local' };
  var _store = ${JSON.stringify(FIX)};
  _store.__writes = []; _store.__selects = [];
  var SCOPED = { tenants: 1, acquisition_document_families: 1, acquisition_documents: 1, acquisition_term_decisions: 1, acquisition_reviews: 1, tenant_field_evidence: 1, tenant_review_audit: 1, cam_reconciliations: 1 };
  function memberProps() { return _store.properties.filter(function (p) { return p.user_id === _user.id; }).map(function (p) { return p.id; }); }
  var P = function (v) { return Promise.resolve(v); };
  function C(x) { return JSON.parse(JSON.stringify(x)); }
  function rowsOf(table, f) {
    var mp = memberProps();
    return (_store[table] || []).filter(function (r) {
      if (table === 'properties' && r.user_id !== _user.id) return false;                 // RLS: owner-or-member
      if (SCOPED[table] && r.property_id != null && mp.indexOf(r.property_id) === -1) return false; // RLS: member_property_ids()
      return Object.keys(f.eq).every(function (k) { return r[k] === f.eq[k]; })
        && Object.keys(f.in).every(function (k) { return f.in[k].indexOf(r[k]) !== -1; })
        && Object.keys(f.is).every(function (k) { return f.is[k] === null ? (r[k] == null) : r[k] === f.is[k]; });
    });
  }
  function makeQ(table) {
    var f = { eq: {}, in: {}, is: {} }, pending = null, op = 'select', payload = null;
    function logSel() { _store.__selects.push({ table: table, eq: C(f.eq) }); }
    var q = {
      select: function () { return q; },
      insert: function (rows) { var arr = Array.isArray(rows) ? rows : [rows]; _store.__writes.push({ op: 'insert', table: table, n: arr.length }); arr.forEach(function (r) { _store[table].push(C(r)); }); op = 'insert'; payload = arr; return q; },
      upsert: function (row) { var arr = Array.isArray(row) ? row : [row]; _store.__writes.push({ op: 'upsert', table: table, n: arr.length, ids: arr.map(function (r) { return r.id; }) });
        arr.forEach(function (r) { var i = _store[table].findIndex(function (x) { return x.id === r.id; }); if (i >= 0) Object.assign(_store[table][i], C(r)); else _store[table].push(C(r)); }); op = 'upsert'; payload = arr; return q; },
      update: function (patch) { _store.__writes.push({ op: 'update', table: table }); pending = patch; return q; },
      delete: function () { _store.__writes.push({ op: 'delete', table: table }); op = 'delete'; return q; },
      eq: function (c, v) { f.eq[c] = v; return q; }, in: function (c, v) { f.in[c] = v; return q; }, is: function (c, v) { f.is[c] = v; return q; },
      neq: function () { return q; }, not: function () { return q; }, or: function () { return q; }, gte: function () { return q; }, lte: function () { return q; },
      order: function () { return q; }, limit: function () { return q; }, range: function () { return q; }, ilike: function () { return q; },
      single: function () { logSel(); var r = rowsOf(table, f); return P(r.length ? { data: C(r[0]), error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }); },
      maybeSingle: function () { logSel(); var r = rowsOf(table, f); return P({ data: r[0] ? C(r[0]) : null, error: null }); },
      then: function (res, rej) {
        if (op === 'delete') { var keep = _store[table].filter(function (r) { return !rowsOf(table, f).includes(r); }); _store[table] = keep; return P({ data: null, error: null }).then(res, rej); }
        if (op === 'insert' || op === 'upsert') return P({ data: payload, error: null }).then(res, rej);
        logSel();
        var rows = rowsOf(table, f);
        if (pending) rows.forEach(function (r) { Object.assign(r, pending); });
        return P({ data: rows.map(C), error: null }).then(res, rej);
      }
    };
    return q;
  }
  window.supabase = { createClient: function () { return {
    auth: { getUser: function () { return P({ data: { user: _user }, error: null }); }, getSession: function () { return P({ data: { session: { user: _user } }, error: null }); },
            onAuthStateChange: function (cb) { setTimeout(function () { cb('SIGNED_IN', { user: _user }); }, 50); return { data: { subscription: { unsubscribe: function () {} } } }; }, signOut: function () { return P({ error: null }); } },
    from: function (table) { if (!_store[table]) _store[table] = []; return makeQ(table); },
    rpc: function (fn, args) { _store.__writes.push({ op: 'rpc', fn: fn }); return P({ data: null, error: null }); },
    storage: { from: function () { return { upload: function () { _store.__writes.push({ op: 'storage' }); return P({ data: null, error: { message: 'no' } }); }, getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
  }; } };
  window.__e2eStore = _store;
})();`;

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await (await browser.newContext()).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('**/supabase-js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* cdn suppressed */' }));
  for (const g of ['**cdnjs**', '**jsdelivr**']) await page.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(SUPABASE_MOCK);

  const writes = () => page.evaluate(() => window.__e2eStore.__writes.length);
  const rowJson = (pid) => page.evaluate((id) => JSON.stringify(window.__e2eStore.properties.find(p => p.id === id)), pid);
  const openProp = async (pid) => { await page.evaluate(async (id) => { await selectProperty(id); }, pid); await page.waitForTimeout(3200); };
  const openFile = async (tid) => {
    await page.evaluate((id) => { TenantSpace.closeSpace(); switchWorkspaceTab('spaces'); TenantSpace.openSpace(id); }, tid);
    await page.waitForSelector('#tsOverlay', { timeout: 8000 });
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const o = document.getElementById('tsOverlay');
      const lease = o.querySelector('.ts-lease') || o;
      const chips = Array.from(o.querySelectorAll('.ts-lease .ts-doc, .ts-lease [data-doc-url]'));
      const uniq = []; chips.forEach(c => { if (!uniq.includes(c)) uniq.push(c); });
      return {
        chips: uniq.map(c => ({ name: (c.querySelector('.ts-doc-name') || {}).textContent || c.textContent.trim(), linked: c.hasAttribute('data-doc-url') || c.tagName === 'A', other: /uploaded by another member/.test(c.textContent) })),
        verified: (o.querySelector('.ts-acq-verified') || {}).textContent || null,
        noDocMsg: /Lease terms are on file but the document is not/.test(o.textContent),
        text: o.textContent,
      };
    });
  };

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => { const app = document.getElementById('appContent'); return app && app.style.display !== 'none' && app.style.display !== ''; }, null, { timeout: 45000 });
    await page.evaluate(() => { const m = document.getElementById('obWelcomeModal'); if (m && m.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else m.style.display = 'none'; } });
    await page.waitForFunction(() => typeof _props !== 'undefined' && _props.some(p => p && p.name === 'Maple plaza'), null, { timeout: 30000 });
    const rowBefore = await rowJson(MAPLE);
    const writesAtBoot = await writes();

    section('LH-1: the acquired property opens with its five tenants');
    await openProp(MAPLE);
    const L1 = await page.evaluate(({ shop }) => {
      const p = currentProperty();
      switchWorkspaceTab('spaces');
      const rows = TenantSpace.listRows(p, { sort: 'suite', dir: 1, q: '' });
      const host = document.getElementById('spacesList');
      const PL = window.PropertyLeaseholds.get(p.id);
      return { name: p.name, n: (p.tenants || []).length, ids: (p.tenants || []).map(t => t.id).sort(), rows: rows.length,
               shop: rows.find(r => r.id === shop), summary: host ? host.textContent : '',
               fams: PL ? PL.familyCount : null, matched: PL ? PL.tenantsMatched : null, docs: PL ? PL.documentCount : null, decs: PL ? PL.decisionCount : null };
    }, { shop: F.shoprite });
    is([L1.name, L1.n, L1.rows], ['Maple plaza', 5, 5], 'LH-1: Maple opens with five tenants and five Spaces rows');
    is(L1.ids, Object.values(F).sort(), 'LH-1: the same five tenant ids — the leasehold ids');
    // normalizeTenant's cleanTenantName trims a trailing period (pre-existing, P5 trace §9) — the name is matched without it.
    assert(L1.shop && /^ShopRite Supermarkets, Inc\.?$/.test(L1.shop.tenant) && L1.shop.sqft === 67000, 'LH-1: ShopRite is 67,000 sq ft', JSON.stringify(L1.shop));
    assert(/77,500 sq ft leased/.test(L1.summary), 'LH-1: the Spaces summary says 77,500 sq ft leased', L1.summary.slice(0, 120));
    is([L1.fams, L1.docs, L1.decs], [5, 5, 4], 'LH-1: the projection for Maple: 5 leaseholds, 5 documents on file, 4 decisions');

    section('LH-2: the ShopRite file remembers its documents and its verification');
    const S = await openFile(F.shoprite);
    is(S.chips.map(c => c.name), ['ShopRite_Anchor_Tenant_Lease.pdf', 'Maple_Plaza_Test_Lease_Amendment.pdf'], 'LH-2: two acquisition documents on file — the renewal lease and the amendment; the replaced old scan is not among them');
    assert(S.chips.every(c => c.linked && !c.other), 'LH-2: both link (this user uploaded them)', JSON.stringify(S.chips));
    assert(/Verified at acquisition — 3 term decisions by a person/.test(S.verified || ''), 'LH-2: "Verified at acquisition — 3 term decisions by a person"', S.verified);
    assert(!S.noDocMsg, 'LH-2: the "document is not on file" message is gone');
    assert(/67,000 sqft|67000 sqft/.test(S.text), 'LH-2: the leased area row still reads 67,000');

    section('LH-3: a document another member uploaded is on file, without a link');
    const LX = await openFile(F.luxe);
    is(LX.chips.map(c => [c.name, c.linked, c.other]), [['Luxe_Nails_Lease.pdf', false, true]], 'LH-3: Luxe\'s lease is listed, unlinked, labelled as another member\'s upload');
    assert(/1 term decision by a person/.test(LX.verified || ''), 'LH-3: Luxe: 1 term decision by a person', LX.verified);

    section('LH-4: an entered leasehold with no document reads exactly as before');
    const SR = await openFile(F.sunrise);
    is(SR.chips.length, 0, 'LH-4: Sunrise: no document chip');
    assert(SR.verified === null, 'LH-4: no verification line (no decision was recorded)');
    assert(SR.noDocMsg, 'LH-4: the "terms on file but the document is not" message is still there');

    section('LH-5: superseded and unfiled documents appear on no tenant');
    const PR = await openFile(F.prime);
    is(PR.chips.map(c => c.name), ['Prime_Wellness_Spa_Lease.pdf'], 'LH-5: Prime Wellness shows ONE live lease, not the two superseded copies');
    const anySafe = await page.evaluate((ids) => ids.some(id => { TenantSpace.closeSpace(); TenantSpace.openSpace(id); const o = document.getElementById('tsOverlay'); const hit = /SafeShield/.test(o.textContent); return hit; }), Object.values(F));
    assert(!anySafe, 'LH-5: the unfiled SafeShield file is on no tenant\'s file');

    section('LH-6: open → leave → reopen → open the file: zero writes');
    await page.evaluate(() => TenantSpace.closeSpace());
    await page.evaluate(async () => { await backToPortfolio(); });
    await page.waitForTimeout(1200);
    await openProp(MAPLE);
    await openFile(F.shoprite);
    await page.evaluate(() => TenantSpace.closeSpace());
    const after = await page.evaluate((m) => ({
      writes: window.__e2eStore.__writes, tenants: window.__e2eStore.tenants.filter(t => t.property_id === m).length,
      fams: window.__e2eStore.acquisition_document_families.filter(f => f.property_id === m).length,
      review: window.__e2eStore.acquisition_reviews[0].status, stage: window.__e2eStore.properties.find(p => p.id === m).lifecycle_stage,
      mem: (_props.find(p => p.id === m).tenants || []).length,
    }), MAPLE);
    is(after.writes.length - writesAtBoot, 0, 'LH-6: ZERO writes (no insert, upsert, update, delete, rpc or upload) across open → leave → reopen → file', JSON.stringify(after.writes));
    is([after.tenants, after.fams, after.mem], [5, 5, 5], 'LH-6: five tenants in the table, five families, five in memory — no duplicate created');
    assert((await rowJson(MAPLE)) === rowBefore, 'LH-6: properties.data is byte-identical to what the seed held');
    is([after.review, after.stage], ['converted', 'acquired'], 'LH-6: the review is still converted and the stage still acquired');

    section('LH-7: a property switch shows only that property\'s record');
    const pending = await page.evaluate(async ({ leg, shop }) => {
      const p = selectProperty(leg);                       // do not await: read the map while the load is pending
      const early = { has: window.PropertyLeaseholds.has(leg), shop: window.PropertyLeaseholds.forTenant(leg, shop) };
      await p; return early;
    }, { leg: LEGACY, shop: F.shoprite });
    is([pending.has, pending.shop], [false, null], 'LH-7: while the legacy property\'s load is pending nothing is answered for it — and nothing of Maple\'s');
    await page.waitForTimeout(3200);
    const LG = await openFile('leg-t1');
    const legProj = await page.evaluate(({ leg, shop, maple }) => { const b = window.PropertyLeaseholds.get(leg); return { fams: b ? b.familyCount : null, shop: window.PropertyLeaseholds.forTenant(leg, shop), maple: window.PropertyLeaseholds.get(maple) ? window.PropertyLeaseholds.get(maple).familyCount : null }; }, { leg: LEGACY, shop: F.shoprite, maple: MAPLE });
    assert(LG.chips.length === 1 && LG.chips[0].linked && !LG.chips[0].other, 'LH-7: the legacy tenant shows its own lease document (one linked chip), from its own row, exactly as before',
      JSON.stringify({ chips: LG.chips, noDocMsg: LG.noDocMsg }));
    assert(LG.verified === null && !/ShopRite|Maple_Plaza|Luxe/.test(LG.text), 'LH-7: no verification line and nothing of Maple\'s on the legacy file');
    is([legProj.fams, legProj.shop, legProj.maple], [0, null, 5], 'LH-7: the legacy projection is empty; asking it for a Maple leasehold yields null; Maple\'s own entry is intact');

    section('LH-8: a prospect reads nothing from the acquisition tables');
    const pro = await page.evaluate(async (pid) => {
      const before = window.__e2eStore.__selects.length;
      await loadPropertyData(pid);
      const sel = window.__e2eStore.__selects.slice(before).filter(s => /^acquisition_/.test(s.table) && s.eq.property_id === pid);
      return { acqSelects: sel.length, has: window.PropertyLeaseholds.has(pid) };
    }, PROSPECT);
    is([pro.acqSelects, pro.has], [0, false], 'LH-8: loading a prospect issued no acquisition select for it and built no projection');

    section('LH-9: another user\'s property: the membership scope returns nothing');
    const fo = await page.evaluate(async ({ pid, uid }) => {
      const b = await loadPropertyLeaseholds(pid, uid);
      const d = await loadPropertyData(pid);
      return { fams: b.familyCount, docs: b.documentCount, decs: b.decisionCount, tenant: window.PropertyLeaseholds.forTenant(pid, 'for-t1'), data: d === null ? 'null' : typeof d };
    }, { pid: FOREIGN, uid: UID });
    is([fo.fams, fo.docs, fo.decs, fo.tenant], [0, 0, 0, null], 'LH-9: the foreign property\'s families, documents and decisions are invisible; no leasehold resolves');

    section('LH-10: page errors');
    const real = pageErrors.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
    is(real, [], 'LH-10: no page errors');
  } catch (e) {
    fail('HARNESS ERROR', e && e.stack || String(e));
  } finally {
    await browser.close(); server.close();
  }
  console.log('\n' + '─'.repeat(58));
  if (failures) { console.error('\x1b[31m' + failures + ' assertion(s) failed\x1b[0m'); process.exit(1); }
  console.log('\x1b[32mAll assertions passed (' + passes + ')\x1b[0m');
})();
