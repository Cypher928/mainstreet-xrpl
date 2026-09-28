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
 *   LH-2  the ShopRite file: two acquisition documents on file, "Verified by you — 5 terms verified · 24 decisions"
 *   LH-3  a document another member uploaded is on file, without a link
 *   LH-4  Sunrise (an entered leasehold, no document) reads exactly as before
 *   LH-5  superseded and unfiled documents appear on no tenant
 *   LH-6  open → leave → reopen → open the file again: ZERO writes anywhere; tenants 5; families 5; the row byte-identical; the review still converted
 *   LH-7  a property switch: the legacy property shows only its own lease document; nothing of Maple's leaks; its projection is empty
 *   LH-8  a prospect: nothing is read from the acquisition tables for it
 *   LH-9  another user's property: the membership scope returns nothing; no leasehold, no error
 *   LH-11 P5-3 ShopRite: the Leased area row still reads 67,000; beneath it "Verified by you · Sep 26, 2026 · <amendment chip>";
 *         the CAM cap line cites p. 1; the collapsed history lists 24 entries incl. a Rejected and a Reopened
 *   LH-12 P5-3 Luxe: the Term row's Expiration line reads "Verified by you · Entered — no document on file"; 3 history entries
 *   LH-13 P5-3 Sunrise and Coffee: no line, no history; Prime: one line decided by ANOTHER member reads "by a person"
 *   LH-14 P5-3 a shown value edited after acquisition: the row shows the edited value; the line says "Verified at
 *         acquisition as 67,000 … the value shown has changed since"; nothing is written
 *   LH-15 P5-4 the REAL click path: Portfolio card → Maple → Spaces tab → the ShopRite row → the tenant file:
 *         Commencement "Contested at acquisition"; Expiration "Read by AI at acquisition"; the read-only record
 *   LH-16 P5-4 the Maple survival matrix in the Review Queue: each current gap annotated with its acquisition state
 *   LH-17 P5-4 Overview: ONE acquisition item, nothing the workspace already raises counted twice
 *   LH-18 P5-4 Sunrise: no document, not established; the unverified 2,800 sf upload never appears
 *   LH-19 P5-4 read-only: the acquisition record has no control, opens no editable review, writes nothing
 *   LH-20 P5-4 Luxe: a value read by AI at acquisition and shown unchanged says so; a blank start date says nothing new
 *   LH-10 no page errors
 *
 * The decision fixtures are Maple's 27 live rows (test-decision-standing.js), decided by this user, plus one
 * decision on Prime Wellness by another member.
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
const { MAPLE_DECISIONS } = require('./test-decision-standing.js');
const MX = require('./fixtures/maple-acquisition-canonical.js');
const T = (id, name, sqft, extra) => Object.assign({ id, tenant_name: name, leased_sqft: sqft, lease_type: 'NNN', start_date: '2024-03-01', end_date: '2029-02-28', cap: null, flags: [], confidence: {}, review: {}, reviewOverrides: {} }, extra || {});
// P5-4: Maple's tenants exactly as properties.data.tenants holds them on Pilot — the CURRENT values.
const MAPLE_TENANTS = MX.MAPLE_BLOB_TENANTS.map(t => Object.assign({}, t));
const tblRow = (t, pid) => ({ id: t.id, property_id: pid, name: t.tenant_name, sqft: t.leased_sqft == null ? null : Number(t.leased_sqft), cap: t.cap == null ? null : Number(t.cap), start_date: t.start_date || null, end_date: t.end_date || null, lease_url: t.leaseUrl || null, lease_type: t.lease_type || null });
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
    data: { conversionRecord: { propertyId: MAPLE, reviewId: RV, source: 'acquire_property' },
            // P5-4: the analysis the acquisition was gated on (its real canonical block), and the raw upload row
            // Sunrise's leasehold was established from — whose 2,800 sf must never reach the property.
            analysis: { canonical: MX.MAPLE_CANONICAL }, tenants: [MX.MAPLE_SUNRISE_RAW_UPLOAD], invoices: [] } }],
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
  acquisition_term_decisions: MAPLE_DECISIONS.map(r => Object.assign({}, r, { user_id: UID, decided_by: UID })).concat([
    // One decision by ANOTHER member, on Prime Wellness: the line must say "a person", never "you".
    { id: 'dec-prime-other', review_id: RV, property_id: MAPLE, user_id: OTHER_UID, family_id: F.prime, field_key: 'lease_type', action: 'confirm', previous_value: 'NNN', new_value: null, source_document_id: 'ebc3f7b1-69cc-431a-8beb-9c123b07265d', source_quote: null, source_page: 2, decided_by: OTHER_UID, decided_at: '2026-09-26T00:07:00Z', note: null, created_at: '2026-09-26T00:07:00Z' },
    { id: 'dec-foreign', review_id: 'rev-foreign', property_id: FOREIGN, user_id: OTHER_UID, family_id: 'for-t1', field_key: 'cap', action: 'confirm', new_value: '5', decided_by: OTHER_UID, decided_at: '2026-02-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z' },
  ]),
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
    var f = { eq: {}, in: {}, is: {} }, pending = null, op = 'select', payload = null, cols = null;
    // A column list with a JSON path ("canonical:data->analysis->canonical") is projected as PostgREST would:
    // ONLY the named columns come back. Other selects keep returning whole rows, as before.
    function proj(r) {
      if (!cols || cols.indexOf('->') < 0) return C(r);
      var o = {};
      cols.split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (c) {
        var m = /^(?:([A-Za-z_][A-Za-z0-9_]*):)?([A-Za-z_][A-Za-z0-9_]*)((?:->[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(c);
        if (!m) return;
        var v = r[m[2]];
        m[3].split('->').filter(Boolean).forEach(function (k) { v = (v && typeof v === 'object') ? v[k] : undefined; });
        o[m[1] || m[2]] = v === undefined ? null : C(v);
      });
      return o;
    }
    function logSel() { _store.__selects.push({ table: table, eq: C(f.eq) }); }
    var q = {
      select: function (c) { cols = typeof c === 'string' ? c : null; return q; },
      insert: function (rows) { var arr = Array.isArray(rows) ? rows : [rows]; _store.__writes.push({ op: 'insert', table: table, n: arr.length }); arr.forEach(function (r) { _store[table].push(C(r)); }); op = 'insert'; payload = arr; return q; },
      upsert: function (row) { var arr = Array.isArray(row) ? row : [row]; _store.__writes.push({ op: 'upsert', table: table, n: arr.length, ids: arr.map(function (r) { return r.id; }) });
        arr.forEach(function (r) { var i = _store[table].findIndex(function (x) { return x.id === r.id; }); if (i >= 0) Object.assign(_store[table][i], C(r)); else _store[table].push(C(r)); }); op = 'upsert'; payload = arr; return q; },
      update: function (patch) { _store.__writes.push({ op: 'update', table: table }); pending = patch; return q; },
      delete: function () { _store.__writes.push({ op: 'delete', table: table }); op = 'delete'; return q; },
      eq: function (c, v) { f.eq[c] = v; return q; }, in: function (c, v) { f.in[c] = v; return q; }, is: function (c, v) { f.is[c] = v; return q; },
      neq: function () { return q; }, not: function () { return q; }, or: function () { return q; }, gte: function () { return q; }, lte: function () { return q; },
      order: function () { return q; }, limit: function () { return q; }, range: function () { return q; }, ilike: function () { return q; },
      single: function () { logSel(); var r = rowsOf(table, f); return P(r.length ? { data: proj(r[0]), error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }); },
      maybeSingle: function () { logSel(); var r = rowsOf(table, f); return P({ data: r[0] ? proj(r[0]) : null, error: null }); },
      then: function (res, rej) {
        if (op === 'delete') { var keep = _store[table].filter(function (r) { return !rowsOf(table, f).includes(r); }); _store[table] = keep; return P({ data: null, error: null }).then(res, rej); }
        if (op === 'insert' || op === 'upsert') return P({ data: payload, error: null }).then(res, rej);
        logSel();
        var rows = rowsOf(table, f);
        if (pending) rows.forEach(function (r) { Object.assign(r, pending); });
        return P({ data: rows.map(proj), error: null }).then(res, rej);
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
  const page = await (await browser.newContext({ timezoneId: 'UTC' })).newPage();
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
      const chips = Array.from(o.querySelectorAll('.ts-lease .ts-doc, .ts-lease [data-doc-url]:not(.ts-acq-src)'));
      const uniq = []; chips.forEach(c => { if (!uniq.includes(c)) uniq.push(c); });
      return {
        chips: uniq.map(c => ({ name: (c.querySelector('.ts-doc-name') || {}).textContent || c.textContent.trim(), linked: c.hasAttribute('data-doc-url') || c.tagName === 'A', other: /uploaded by another member/.test(c.textContent) })),
        verified: (o.querySelector('.ts-acq-verified') || {}).textContent || null,
        // P5-3: the line beneath each term, and the collapsed history.
        lines: Array.from(o.querySelectorAll('.ts-acq-line')).map(l => ({ field: l.getAttribute('data-field'), text: l.textContent.replace(/\s+/g, ' ').trim(), linked: !!l.querySelector('[data-doc-url]'), plainSrc: !!l.querySelector('.ts-acq-src--plain') })),
        historySummary: (o.querySelector('.ts-acq-history > summary') || {}).textContent || null,
        // P5-4: the acquisition's line under a row, and the read-only record.
        acqHist: Array.from(o.querySelectorAll('.ts-acq-atacq')).map(l => ({ field: l.getAttribute('data-field'), kind: l.getAttribute('data-kind'), text: l.textContent.replace(/\s+/g, ' ').trim() })),
        record: (function () {
          const d = o.querySelector('.ts-acq-record'); if (!d) return null;
          return { summary: (d.querySelector('summary') || {}).textContent.replace(/\s+/g, ' ').trim(),
                   controls: d.querySelectorAll('button, a, input, select, textarea, [onclick]').length,
                   noDoc: !!d.querySelector('[data-kind="no_document"]'),
                   groups: Array.from(d.querySelectorAll('.ts-acq-rec-grp')).map(g => ({ state: g.getAttribute('data-state'), text: g.textContent.replace(/\s+/g, ' ').trim() })) };
        })(),
        history: Array.from(o.querySelectorAll('.ts-acq-h')).map(h => Array.from(h.children).map(c => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ')),
        rows: Array.from(o.querySelectorAll('.ts-lease-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()),
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
    is([L1.fams, L1.docs, L1.decs], [5, 5, 28], 'LH-1: the projection for Maple: 5 leaseholds, 5 documents on file, 28 decisions (the 27 live rows + one by another member)');

    section('LH-2: the ShopRite file remembers its documents and its verification');
    const S = await openFile(F.shoprite);
    is(S.chips.map(c => c.name), ['ShopRite_Anchor_Tenant_Lease.pdf', 'Maple_Plaza_Test_Lease_Amendment.pdf'], 'LH-2: two acquisition documents on file — the renewal lease and the amendment; the replaced old scan is not among them');
    assert(S.chips.every(c => c.linked && !c.other), 'LH-2: both link (this user uploaded them)', JSON.stringify(S.chips));
    assert(/^Verified by you — 5 terms verified · 24 decisions, last Sep 26, 2026$/.test(S.verified || ''), 'LH-2: "Verified by you — 5 terms verified · 24 decisions, last Sep 26, 2026" — 24 events, FIVE standing verified terms (not 24)', S.verified);
    assert(!S.noDocMsg, 'LH-2: the "document is not on file" message is gone');
    assert(/67,000 sqft|67000 sqft/.test(S.text), 'LH-2: the leased area row still reads 67,000');

    section('LH-3: a document another member uploaded is on file, without a link');
    const LX = await openFile(F.luxe);
    is(LX.chips.map(c => [c.name, c.linked, c.other]), [['Luxe_Nails_Lease.pdf', false, true]], 'LH-3: Luxe\'s lease is listed, unlinked, labelled as another member\'s upload');
    assert(/^Verified by you — 1 term verified · 3 decisions, last Sep 25, 2026$/.test(LX.verified || ''), 'LH-3: Luxe: "1 term verified · 3 decisions" (correct → reopen → correct is one standing term)', LX.verified);

    section('LH-4: an entered leasehold with no document reads exactly as before');
    const SR = await openFile(F.sunrise);
    is(SR.chips.length, 0, 'LH-4: Sunrise: no document chip');
    assert(SR.verified === null && SR.lines.length === 0 && SR.historySummary === null, 'LH-4: no verification line, no term line, no history (no decision was recorded)');
    assert(SR.noDocMsg, 'LH-4: the "terms on file but the document is not" message is still there');

    section('LH-5: superseded and unfiled documents appear on no tenant');
    const PR = await openFile(F.prime);
    is(PR.chips.map(c => c.name), ['Prime_Wellness_Spa_Lease.pdf'], 'LH-5: Prime Wellness shows ONE live lease, not the two superseded copies');
    const anySafe = await page.evaluate((ids) => ids.some(id => { TenantSpace.closeSpace(); TenantSpace.openSpace(id); const o = document.getElementById('tsOverlay'); const hit = /SafeShield/.test(o.textContent); return hit; }), Object.values(F));
    assert(!anySafe, 'LH-5: the unfiled SafeShield file is on no tenant\'s file');

    section('LH-11: P5-3 — the ShopRite file says what a person verified, beneath the value it did not change');
    const S11 = await openFile(F.shoprite);
    assert(S11.rows.some(r => /^Leased area ?67000 sqft$/.test(r)), 'LH-11: the Leased area row still reads the tenant row\'s 67000 sqft (the value is not replaced)', JSON.stringify(S11.rows));
    const sqLine = S11.lines.find(l => l.field === 'leased_sqft');
    assert(sqLine && /^Verified by you · Sep 26, 2026 · Maple_Plaza_Test_Lease_Amendment\.pdf$/.test(sqLine.text) && sqLine.linked, 'LH-11: beneath it "Verified by you · Sep 26, 2026 · Maple_Plaza_Test_Lease_Amendment.pdf", the document a linked chip (this user uploaded it)', JSON.stringify(sqLine));
    const capLine = S11.lines.find(l => l.field === 'cap');
    assert(capLine && /^Verified by you · Sep 22, 2026 · Maple_Plaza_Test_Lease_Amendment\.pdf · p\. 1$/.test(capLine.text) && capLine.linked, 'LH-11: the CAM cap row\'s line cites the amendment, p. 1', JSON.stringify(capLine));
    is(S11.lines.map(l => l.field).sort(), ['cap', 'leased_sqft'], 'LH-11: lines only for the rows the file shows AND a person decided (lease type, commencement, expiration were never decided — no line)');
    is(S11.historySummary, 'Verified history (24)', 'LH-11: the collapsed history is titled "Verified history (24)"');
    is(S11.history.length, 24, 'LH-11: …and lists all 24 events');
    assert(/^Sep 26, 2026 Corrected Leased sq ft 65,000 → 67,000 Maple_Plaza_Test_Lease_Amendment\.pdf$/.test(S11.history[0]), 'LH-11: newest first: "Sep 26, 2026 · Corrected · Leased sq ft · 65,000 → 67,000 · the amendment"', S11.history[0]);
    assert(S11.history.some(h => /Rejected Audit rights/.test(h)) && S11.history.some(h => /Reopened Security deposit/.test(h)) && S11.history.some(h => /Confirmed Suite Anchor Unit A-1 ShopRite_Anchor_Tenant_Lease\.pdf · p\. 1/.test(h)), 'LH-11: the history includes the Rejected audit rights, the Reopened security deposit and the confirmed Suite with its page', JSON.stringify(S11.history));
    assert(S11.history.some(h => /Corrected Admin fee % 10 Entered by a person\. No document on file supports it\./.test(h)), 'LH-11: an entered correction carries its note in the history');
    assert(!/e2e-test-user-id|someone-else-uid/.test(S11.text), 'LH-11: no uid is rendered anywhere on the file');

    section('LH-12: P5-3 — Luxe: an entered expiration');
    const L12 = await openFile(F.luxe);
    const expLine = L12.lines.find(l => l.field === 'end_date');
    assert(expLine && /^Expiration Verified by you · Entered — no document on file · Sep 25, 2026$/.test(expLine.text) && !expLine.linked, 'LH-12: the Term row\'s Expiration line: "Verified by you · Entered — no document on file · Sep 25, 2026"', JSON.stringify(expLine));
    is([L12.lines.length, L12.historySummary, L12.history.length], [1, 'Verified history (3)', 3], 'LH-12: one line; three history entries (correct → reopen → correct)');
    assert(/^Sep 25, 2026 Corrected Expiration 2031-07-07 Entered by a person/.test(L12.history[0]) && /Reopened Expiration/.test(L12.history[1]), 'LH-12: the history reads Corrected · Reopened · Corrected, newest first', JSON.stringify(L12.history));

    section('LH-13: P5-3 — nothing for the undecided; "a person" for another member\'s decision');
    const S13 = await openFile(F.sunrise), C13 = await openFile(F.coffee), P13 = await openFile(F.prime);
    is([S13.lines.length, S13.historySummary, S13.verified, C13.lines.length, C13.historySummary, C13.verified], [0, null, null, 0, null, null], 'LH-13: Sunrise and Coffee: no line, no history, no summary');
    const ltLine = P13.lines.find(l => l.field === 'lease_type');
    assert(ltLine && /^Verified by a person · Sep 26, 2026 · Prime_Wellness_Spa_Lease\.pdf · p\. 2$/.test(ltLine.text) && ltLine.linked, 'LH-13: Prime\'s Lease type line — decided by ANOTHER member — says "by a person" (never "you"); the document chip links (this user uploaded it)', JSON.stringify(ltLine));
    assert(/^Verified by a person — 1 term verified · 1 decision, last Sep 26, 2026$/.test(P13.verified || ''), 'LH-13: Prime\'s summary says "by a person"', P13.verified);

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
    assert(LG.record === null && LG.acqHist.length === 0, 'LH-7: P5-4 — a property with no acquisition has no acquisition record and no acquisition line');
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

    section('LH-14: P5-3 — a value edited after acquisition is shown as it is; the line says so');
    await openProp(MAPLE);
    const writesBefore14 = await writes();
    await page.evaluate((shop) => { const t = currentProperty().tenants.find(x => x.id === shop); t.__was = t.leased_sqft; t.leased_sqft = '70000'; }, F.shoprite);
    const S14 = await openFile(F.shoprite);
    const edited = S14.lines.find(l => l.field === 'leased_sqft');
    assert(S14.rows.some(r => /^Leased area ?70000 sqft$/.test(r)), 'LH-14: the row shows the EDITED value, 70000 — the decision never replaces it', JSON.stringify(S14.rows));
    assert(edited && /^Verified at acquisition as 67,000 by you · Sep 26, 2026 · Maple_Plaza_Test_Lease_Amendment\.pdf · the value shown has changed since$/.test(edited.text) && edited.linked, 'LH-14: the line: "Verified at acquisition as 67,000 by you · Sep 26, 2026 · <amendment> · the value shown has changed since"', JSON.stringify(edited));
    assert(/^Verified by you — 5 terms verified · 24 decisions/.test(S14.verified || ''), 'LH-14: the summary is unchanged (the decision still stands; the shown value is what moved)', S14.verified);
    await page.evaluate((shop) => { TenantSpace.closeSpace(); const t = currentProperty().tenants.find(x => x.id === shop); t.leased_sqft = t.__was; delete t.__was; }, F.shoprite);
    is((await writes()) - writesBefore14, 0, 'LH-14: reading the file wrote nothing');

    // ── P5-4 ────────────────────────────────────────────────────────────────
    section('LH-15: P5-4 — the REAL click path: Portfolio → Maple → Spaces → the ShopRite row → its file');
    await page.evaluate(() => { try { TenantSpace.closeSpace(); } catch (_) {} });
    await page.evaluate(async () => { await backToPortfolio(); });
    await page.waitForTimeout(1200);
    // Count any attempt to open the editable acquisition review from here on.
    await page.evaluate(() => { const o = window.selectAcquisitionReview; window.__acqOpened = 0; window.selectAcquisitionReview = function () { window.__acqOpened++; return o.apply(this, arguments); }; });
    const writesBefore15 = await writes();
    const decsBefore15 = await page.evaluate(() => window.__e2eStore.acquisition_term_decisions.length);
    await page.click('.ptf-prop-card[onclick*="' + MAPLE + '"]');
    await page.waitForTimeout(3500);
    await page.click('#wsTabBtn-spaces');
    await page.waitForTimeout(700);
    await page.click('#spacesList tr[data-space-id="' + F.shoprite + '"] td.tsl-tenant');
    await page.waitForSelector('#tsOverlay', { timeout: 8000 });
    await page.waitForTimeout(300);
    const R15 = await page.evaluate(() => {
      const o = document.getElementById('tsOverlay');
      const rec = o.querySelector('.ts-acq-record');
      return { rows: Array.from(o.querySelectorAll('.ts-lease-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()),
               hist: Array.from(o.querySelectorAll('.ts-acq-atacq')).map(l => ({ field: l.getAttribute('data-field'), kind: l.getAttribute('data-kind'), text: l.textContent.replace(/\s+/g, ' ').trim() })),
               p53: Array.from(o.querySelectorAll('.ts-acq-line')).map(l => l.getAttribute('data-field')).sort(),
               summary: rec ? rec.querySelector('summary').textContent.replace(/\s+/g, ' ').trim() : null,
               groups: rec ? Array.from(rec.querySelectorAll('.ts-acq-rec-grp')).map(g => ({ state: g.getAttribute('data-state'), text: g.textContent.replace(/\s+/g, ' ').trim() })) : [],
               title: (o.querySelector('.ts-title, h2, h3') || {}).textContent || '', text: o.textContent };
    });
    assert(/ShopRite/.test(R15.text) && R15.rows.some(r => /^Term ?\? → 2039-02-28$/.test(r)), 'LH-15: the click opened ShopRite\'s file; the Term row shows the CURRENT value, "? → 2039-02-28"', JSON.stringify(R15.rows));
    const st15 = R15.hist.find(h => h.field === 'start_date');
    assert(st15 && st15.kind === 'contested' && /^Commencement Contested at acquisition — the documents disagreed and nothing was chosen$/.test(st15.text),
      'LH-15: beneath it, "Commencement · Contested at acquisition — the documents disagreed and nothing was chosen" (not a missing field)', JSON.stringify(R15.hist));
    const en15 = R15.hist.find(h => h.field === 'end_date');
    assert(en15 && en15.kind === 'read' && /^Expiration Read by AI at acquisition · not verified by a person$/.test(en15.text), 'LH-15: and "Expiration · Read by AI at acquisition · not verified by a person" — the value shown is the one read', JSON.stringify(en15));
    is(R15.hist.map(h => h.field).sort(), ['end_date', 'start_date'], 'LH-15: no acquisition line where a decision stands (Leased area, CAM cap keep their P5-3 line) nor where the value cannot be compared (Lease type)');
    is(R15.p53, ['cap', 'leased_sqft'], 'LH-15: the P5-3 lines are unchanged');
    assert(/^Open acquisition record · read-only — 2 contested · 1 unclear · 11 read by AI, not verified · 8 not established$/.test(R15.summary || ''),
      'LH-15: the file offers "Open acquisition record · read-only — 2 contested · 1 unclear · 11 read by AI, not verified · 8 not established"', R15.summary);
    const g = (st) => (R15.groups.find(x => x.state === st) || {}).text || '';
    assert(/Commencement/.test(g('contested')) && /Renewal options/.test(g('contested')) && /Audit rights \(a person rejected the document’s reading\)/.test(g('unclear'))
      && /Leased sq ft/.test(g('verified')) && /Admin fee %/.test(g('entered')),
      'LH-15: the record lists contested Commencement and Renewal options, unclear Audit rights (rejected by a person), Leased sq ft verified, Admin fee % entered', JSON.stringify(R15.groups));

    section('LH-16: P5-4 — the Maple survival matrix in the Review Queue');
    await page.evaluate(() => { TenantSpace.closeSpace(); switchWorkspaceTab('overview'); });
    await page.waitForTimeout(500);
    const RQ = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('#propertyReviewQueuePanel [data-rq-tenant-id]').forEach(c => {
        const h = c.querySelector('.rq-acq-hist');
        out[c.getAttribute('data-rq-tenant-id')] = { chips: Array.from(c.querySelectorAll('.rq-chip')).map(x => x.textContent.trim()),
          hist: h ? h.textContent.replace(/\s+/g, ' ').trim() : null, histControls: h ? h.querySelectorAll('button,a,[onclick]').length : 0,
          parts: h ? Array.from(h.querySelectorAll('[data-field]')).map(x => x.getAttribute('data-field') + ':' + x.getAttribute('data-state')) : [] };
      });
      return { cards: out, panelText: (document.getElementById('propertyReviewQueuePanel') || {}).textContent || '' };
    });
    const c = (id) => RQ.cards[id] || {};
    assert(c(F.shoprite).chips && c(F.shoprite).chips.includes('Start Date') && /Start date contested — the documents disagreed; nothing was chosen/.test(c(F.shoprite).hist || '')
      && /Audit rights unclear — a person rejected the document’s reading/.test(c(F.shoprite).hist || ''),
      'LH-16 [1][2]: ShopRite — current chip "Start Date"; at acquisition "Start date contested…" and "Audit rights unclear — a person rejected the document’s reading"', JSON.stringify(c(F.shoprite)));
    is(c(F.luxe).parts, ['lease_type:missing', 'start_date:missing'], 'LH-16 [3][4]: Luxe — lease type and start date: not established at acquisition, still missing now');
    is(c(F.coffee).parts, ['lease_type:missing', 'end_date:missing'], 'LH-16 [5][6]: Maple Coffee — lease type and end date: not established at acquisition, still missing now');
    assert(c(F.sunrise).parts.includes('leased_sqft:missing') && /Sq ft not established — no lease document was filed/.test(c(F.sunrise).hist || '') && c(F.sunrise).chips.includes('Sq Ft'),
      'LH-16 [7]: Sunrise — current chip "Sq Ft" (the CAM blocker); at acquisition "Sq ft not established — no lease document was filed"', JSON.stringify(c(F.sunrise)));
    assert(Object.values(RQ.cards).every(x => x.histControls === 0) && !/2,?800/.test(RQ.panelText),
      'LH-16: the history is text only — no button, no acquisition task — and the unverified 2,800 sf appears nowhere in the queue');

    section('LH-17: P5-4 — Overview: one acquisition item, nothing counted twice');
    const OV = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('#propertyAttentionSlot .pw-item')).map(i => ({
        t: i.querySelector('.pw-item-title').textContent.trim(), w: i.querySelector('.pw-item-why').textContent.trim(), c: i.className }));
      const b = window.PropertyLeaseholds.get(currentProperty().id);
      const roll = window.PropertyLeaseholds.propertyAcquisitionAttention(b, currentProperty().tenants,
        t => window.ReviewEngine.deriveTenantReviewState(t).warnings.map(w => w.type));
      return { items, roll };
    });
    const acqItems = OV.items.filter(i => /acquisition/i.test(i.t + ' ' + i.w));
    is(acqItems.length, 1, 'LH-17: exactly ONE attention item speaks of the acquisition');
    assert(acqItems[0] && acqItems[0].t === 'Unresolved at acquisition on 4 spaces'
      && /^1 contested · 2 unclear · 7 lease terms shown were read by AI and not verified\. Recorded when the property was acquired; each space’s file says which\.$/.test(acqItems[0].w),
      'LH-17: "Unresolved at acquisition on 4 spaces — 1 contested · 2 unclear · 7 lease terms shown were read by AI and not verified"', JSON.stringify(acqItems));
    assert(acqItems[0] && acqItems[0].c.split(/\s+/).includes('pw-item--info') && !/pw-item--(warning|critical|blocker)/.test(acqItems[0].c),
      'LH-17: the acquisition item is history (info), never raised as a warning or an acquisition task', acqItems[0] && acqItems[0].c);
    assert(OV.items.some(i => /4 tenants missing lease info/.test(i.t)), 'LH-17: the workspace\'s own item "4 tenants missing lease info" is still there, unchanged');
    assert(!OV.roll.items.some(i => ['start_date', 'end_date', 'lease_type', 'audit_rights'].includes(i.field) && i.kind !== 'read') && !OV.roll.items.some(i => i.tenantId === F.sunrise),
      'LH-17: nothing the workspace already raises (missing start/end/lease type, audit rights, Sunrise) is counted in the acquisition item');

    section('LH-18: P5-4 — Sunrise: no document, not established; 2,800 sf never appears');
    await page.evaluate(() => switchWorkspaceTab('spaces'));
    await page.waitForTimeout(400);
    await page.click('#spacesList tr[data-space-id="' + F.sunrise + '"] td.tsl-tenant');
    await page.waitForSelector('#tsOverlay', { timeout: 8000 });
    await page.waitForTimeout(300);
    const SU = await page.evaluate(() => {
      const o = document.getElementById('tsOverlay'); const d = o.querySelector('.ts-acq-record');
      return { text: o.textContent, rows: Array.from(o.querySelectorAll('.ts-lease-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()),
               hist: o.querySelectorAll('.ts-acq-atacq').length, noDoc: d ? (d.querySelector('[data-kind="no_document"]') || {}).textContent || null : null,
               missing: d ? ((d.querySelector('[data-state="missing"]') || {}).textContent || '') : '' };
    });
    assert(SU.noDoc === 'No lease document was filed into this leasehold, so no term was established from a document.' && /Not established by any document \(27\)/.test(SU.missing),
      'LH-18: Sunrise\'s record: no lease document was filed; all 27 terms not established', JSON.stringify({ noDoc: SU.noDoc, missing: SU.missing.slice(0, 80) }));
    assert(!/2,?800/.test(SU.text) && SU.hist === 0, 'LH-18: the unverified 2,800 sf upload appears NOWHERE in the file, and no acquisition line is added under its 0 sq ft', JSON.stringify(SU.rows));

    section('LH-19: P5-4 — read-only: no control, no editable review, no write');
    await page.evaluate(() => TenantSpace.closeSpace());
    const S19 = await openFile(F.shoprite);
    await page.evaluate(() => { const d = document.querySelector('#tsOverlay .ts-acq-record'); d.querySelector('summary').click(); });
    await page.waitForTimeout(200);
    const ro = await page.evaluate(() => { const d = document.querySelector('#tsOverlay .ts-acq-record');
      return { open: d.open, controls: d.querySelectorAll('button, a, input, select, textarea, [onclick], [contenteditable]').length,
               histControls: document.querySelectorAll('#tsOverlay .ts-acq-atacq button, #tsOverlay .ts-acq-atacq a, #tsOverlay .ts-acq-atacq [onclick]').length,
               opened: window.__acqOpened, decs: window.__e2eStore.acquisition_term_decisions.length }; });
    assert(ro.open && ro.controls === 0 && ro.histControls === 0, 'LH-19: the record opens in place and holds NO control of any kind; the lines under rows hold none either', JSON.stringify(ro));
    is([ro.opened, ro.decs - decsBefore15, (await writes()) - writesBefore15], [0, 0, 0], 'LH-19: the editable acquisition review was never opened, no decision was added, and nothing was written across LH-15..LH-19');
    assert(S19.record && /The acquisition is closed: this is what it recorded, and nothing here can be changed\. The values in Lease & Terms above are the property’s current ones\./.test(S19.text),
      'LH-19: the record says it is history and that the values above are the current ones');

    section('LH-20: P5-4 — Luxe: an unchanged AI-read value says so; a blank start date adds nothing');
    const LX20 = await openFile(F.luxe);
    is(LX20.acqHist.map(h => h.field + ':' + h.kind), ['leased_sqft:read'], 'LH-20: only Leased area carries an acquisition line (3,000 read by AI, shown unchanged); the blank start date adds none (the Review Queue says it); Expiration keeps its P5-3 line');
    await page.evaluate(() => TenantSpace.closeSpace());

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
