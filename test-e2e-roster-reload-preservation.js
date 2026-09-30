'use strict';
/**
 * test-e2e-roster-reload-preservation.js — opening a property whose tenants
 * TABLE has rows keeps the SAVED roster, and every saved-only field survives
 * reload and save.
 *
 *   node test-e2e-roster-reload-preservation.js
 *   APP_ROOT=/path/to/other/checkout node test-e2e-roster-reload-preservation.js
 *
 * loadProperties builds each portfolio roster from the tenants table — columns
 * only. selectProperty painted that placeholder into the live buffer, adopted
 * the saved roster (properties.data.tenants) a moment later, and rendered again;
 * renderProperty kept the live buffer and wrote it back over the saved roster,
 * and the next save persisted it. Every saved-only field of every tenant —
 * leaseDocumentId, amendments, capBaseAmount, reviewOverrides — was erased.
 * Every suite that opened a property started from an EMPTY tenants table, where
 * the placeholder is empty and the saved roster is painted directly, so none of
 * them could see it. Every scenario here has table rows, except the control.
 *
 * Supabase is mocked in the page and persisted in sessionStorage, so a real
 * page reload reads back what the app wrote. Nothing leaves the machine.
 *
 *   §0  the merge rule itself (_reconcileProvisionalRoster), in isolation
 *   §1  table mirrors the saved roster: open, reload, edit, reload, save
 *   §2  table holds MORE rows than the saved roster: the saved roster still wins
 *   §3  an edit and an upload made before the saved roster arrives both survive
 *   §4  control: empty tenants table (the case every other suite covers)
 *   §5  a lease file restored late lands on the saved row, not the placeholder
 *   §6  a roster holding placeholder rows AND a real row: only the placeholder
 *       rows are replaced
 */
let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const http = require('http');
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');
const { fnSource } = require('./test-support/fn-source');

const PORT     = parseInt(process.env.APP_PORT || '7857', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT     = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : __dirname;

let failures = 0;
const pass = (l) => console.log('\x1b[32m  ✅ ' + l + '\x1b[0m');
const fail = (l, d) => { console.error('\x1b[31m  ❌ ' + l + (d ? ' — ' + d : '') + '\x1b[0m'); failures++; };
const assert = (c, l, d) => (c ? pass(l) : fail(l, d));
const section = (l) => console.log('\n── ' + l + ' ' + '─'.repeat(Math.max(0, 60 - l.length)));

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = req.url.split('?')[0];
      const filePath = path.join(ROOT, u === '/' ? '/index.html' : u);
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

// ── The fixture ───────────────────────────────────────────────────────────────
const USER_ID = 'e2e-roster-user';
const EMAIL   = 'roster-test@e2e-test.local';
const PROP_ID = 'roster-reload-e2e';
const T = [
  { id: '7a1e0000-0000-4000-8000-000000000001', name: 'Birch Books',  sqft: 1500 },
  { id: '7a1e0000-0000-4000-8000-000000000002', name: 'Cedar Cafe',   sqft: 2000 },
  { id: '7a1e0000-0000-4000-8000-000000000003', name: 'Dune Dental',  sqft: 2500 },
];
const EXTRA = { id: '7a1e0000-0000-4000-8000-0000000000ff', name: 'Table-only Tenant', sqft: 900 };
const DOC = (i) => 'd0c00000-0000-4000-8000-00000000000' + (i + 1);

// What only the saved roster holds, per tenant. The table has none of it.
function savedOnly(i) {
  return {
    leaseDocumentId: DOC(i),
    amendments:      [{ amendmentId: 'amd-' + (i + 1), fileName: 'amendment-' + (i + 1) + '.pdf', effectiveDate: '2025-01-01' }],
    capBaseAmount:   1000 * (i + 1) + 11,
    reviewOverrides: { cap: { original: 3, override: 4 + i, reviewerConfirmed: true, reviewedAt: '2026-09-01T00:00:00.000Z', overrideSource: 'manual' } },
  };
}
const savedTenant = (x, i) => ({ id: x.id, tenant_name: x.name, leased_sqft: x.sqft, lease_type: 'NNN', cap: 4 + i,
  start_date: '2024-01-01', end_date: '2030-12-31', ...savedOnly(i) });
const tableRow = (x) => ({ id: x.id, property_id: PROP_ID, name: x.name, sqft: x.sqft, cap: 3, start_date: '2024-01-01',
  end_date: '2030-12-31', lease_url: null, lease_type: 'NNN', leasehold_status: 'active', ended_at: null, ended_reason: null });

function fixture(tableMode) {
  const table = tableMode === 'empty' ? [] : T.map(tableRow).concat(tableMode === 'extra' ? [tableRow(EXTRA)] : []);
  return {
    properties: [{
      id: PROP_ID, user_id: USER_ID, name: 'Roster Plaza', sqft: 12000, lifecycle_stage: 'acquired', archived_at: null,
      data: { invoices: [], disputes: [], camYear: 2025, results: null, camReconciliation: null, activityLog: [], timeline: [],
        escrowReserves: [], drawRequests: [], tenants: T.map(savedTenant) },
    }],
    tenants: table,
  };
}

// The mock database. Persisted in sessionStorage by the top frame on every write,
// so a reload reads back exactly what was written. `__propReadDelay` holds the
// single-property read back, to open a window between the placeholder paint and
// the saved roster's arrival.
const SUPABASE_MOCK = `
(function() {
  var USER_ID = '${USER_ID}';
  var _user = { id: USER_ID, email: '${EMAIL}' };
  var _session = null;
  try { var _ss = sessionStorage.getItem('__e2eSession'); if (_ss) _session = JSON.parse(_ss); } catch (_) {}
  var _saved = null; try { _saved = sessionStorage.getItem('__e2eStore'); } catch (_) {}
  var _store = _saved ? JSON.parse(_saved) : JSON.parse(sessionStorage.getItem('__e2eFixture') || 'null');
  function _persist() {
    if (window.top !== window) return;
    try {
      sessionStorage.setItem('__e2eStore', JSON.stringify(_store, function (k, v) { return (typeof File !== 'undefined' && v instanceof File) ? undefined : v; }));
      sessionStorage.setItem('__e2eSession', JSON.stringify(_session));
    } catch (e) { window.__persistErr = String(e && e.message); }
  }
  function P(v) { return Promise.resolve(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function makeQ(t) {
    var f = {}, fin = {}, fis = {};
    function rows() { return (_store[t] || []).filter(function(r){ return Object.keys(f).every(function(k){ return r[k] === f[k]; }) && Object.keys(fin).every(function(k){ return (fin[k] || []).indexOf(r[k]) !== -1; }) && Object.keys(fis).every(function(k){ return fis[k] === null ? r[k] == null : r[k] === fis[k]; }); }); }
    var q = {
      select: function() { return q; },
      insert: function(rs) { var a = Array.isArray(rs) ? rs : [rs]; a.forEach(function(r){ if (!r.id) r.id = 'row-' + Math.random().toString(36).slice(2); (_store[t] = _store[t] || []).push(clone(r)); }); _persist();
        var r = P({ data: a, error: null }); r.select = function(){ return { single: function(){ return P({ data: a[0], error: null }); }, then: function(fn){ return P({ data: a, error: null }).then(fn); } }; }; return r; },
      upsert: function(row) { var a = Array.isArray(row) ? row : [row]; a.forEach(function(x){ var arr = (_store[t] = _store[t] || []); var i = arr.findIndex(function(r){ return r.id === x.id; }); if (i >= 0) arr[i] = Object.assign({}, arr[i], clone(x)); else arr.push(clone(x)); }); _persist();
        var r = P({ data: a, error: null }); r.select = function(){ return P({ data: a.map(function(x){ return { id: x.id }; }), error: null }); }; return r; },
      update: function() { var r = P({ data: null, error: null }); r.select = function(){ return P({ data: null, error: null }); }; r.eq = function(){ return P({ data: null, error: null }); }; return r; },
      delete: function() { return { eq: function(){ return P({ error: null }); }, in: function(){ return P({ error: null }); } }; },
      eq: function(c, v) { f[c] = v; return q; }, neq: function(){ return q; }, not: function(){ return q; },
      is: function(c, v) { fis[c] = v; return q; }, gt: function(){ return q; }, gte: function(){ return q; },
      lt: function(){ return q; }, lte: function(){ return q; }, ilike: function(){ return q; }, or: function(){ return q; },
      range: function(){ return q; }, match: function(){ return q; }, contains: function(){ return q; },
      in: function(c, v) { fin[c] = v; return q; }, order: function(){ return q; }, limit: function(){ return q; },
      single: function() {
        var r = rows(); var out = { data: r[0] ? clone(r[0]) : null, error: r[0] ? null : { code: 'PGRST116', message: 'no rows' } };
        var d = (t === 'properties' && window.__propReadDelay) || 0;
        return d ? new Promise(function(res){ setTimeout(function(){ res(out); }, d); }) : P(out);
      },
      maybeSingle: function() { return q.single(); },
      then: function(fn) { return P({ data: clone(rows()), error: null }).then(fn); }
    };
    return q;
  }
  function makeSession() { return { user: _user, access_token: 'mock-access-token', expires_at: (Date.now() / 1000) + 3600 }; }
  window.supabase = { createClient: function() { return {
    auth: {
      getUser: function(){ return P({ data: { user: _session ? _user : null }, error: null }); },
      getSession: function(){ return P({ data: { session: _session }, error: null }); },
      refreshSession: function(){ return P({ data: { session: _session }, error: null }); },
      signUp: function(){ _session = makeSession(); _persist(); return P({ data: { session: _session, user: _user }, error: null }); },
      signInWithPassword: function(){ _session = makeSession(); _persist(); return P({ data: { session: _session, user: _user }, error: null }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; },
      signOut: function(){ _session = null; return P({ error: null }); }
    },
    from: function(t) { if (!_store[t]) _store[t] = []; return makeQ(t); },
    rpc: function(name, args) {
      if (name === 'resync_property_tenants') {
        var rs = (args && args.p_rows) || [];
        rs.forEach(function(r){ var arr = _store.tenants; var i = arr.findIndex(function(x){ return x.id === r.id; }); var row = Object.assign({}, i >= 0 ? arr[i] : { leasehold_status: 'active' }, { property_id: args.p_property_id }, r); if (i >= 0) arr[i] = row; else arr.push(row); });
        _persist();
        return P({ data: { ok: true, upserted: rs.length, deleted: 0 }, error: null });
      }
      return P({ data: null, error: null });
    },
    _store: _store
  }; } };
  window.__e2eStore = _store;
})();
`;

// ── In-page probes ────────────────────────────────────────────────────────────
// Each tenant's saved-only fields, read from wherever `where` points.
const READ_FIELDS = (where) => `(() => {
  const src = ${where};
  return (src || []).filter(Boolean).map(t => ({ id: t.id, name: t.tenant_name,
    leaseDocumentId: t.leaseDocumentId ?? null, amendments: (t.amendments || []).map(a => a && a.amendmentId),
    capBaseAmount: t.capBaseAmount ?? null, reviewOverrides: t.reviewOverrides || {}, cap: t.cap ?? null }));
})()`;
const LIVE   = READ_FIELDS('tenantData');
const RECORD = READ_FIELDS('(_props.find(p => p.id === "' + PROP_ID + '") || {}).tenants');
const STORED = READ_FIELDS('window.__e2eStore.properties[0].data.tenants');

function fieldsIntact(rows, label, ids) {
  const want = (ids || T.map(x => x.id));
  const byId = new Map((rows || []).map(r => [r.id, r]));
  const bad = [];
  want.forEach((id) => {
    const i = T.findIndex(x => x.id === id);
    const r = byId.get(id);
    if (!r) { bad.push(id.slice(-3) + ' missing'); return; }
    const s = savedOnly(i);
    if (r.leaseDocumentId !== s.leaseDocumentId) bad.push(r.name + ' leaseDocumentId=' + r.leaseDocumentId);
    if (JSON.stringify(r.amendments) !== JSON.stringify(s.amendments.map(a => a.amendmentId))) bad.push(r.name + ' amendments=' + JSON.stringify(r.amendments));
    if (r.capBaseAmount !== s.capBaseAmount) bad.push(r.name + ' capBaseAmount=' + r.capBaseAmount);
    if (JSON.stringify(r.reviewOverrides) !== JSON.stringify(s.reviewOverrides)) bad.push(r.name + ' reviewOverrides=' + JSON.stringify(r.reviewOverrides));
  });
  assert(bad.length === 0, label, bad.join('; '));
}

// ── §0 the merge rule, in isolation ──────────────────────────────────────────
function section0() {
  section('§0 the merge rule (_reconcileProvisionalRoster)');
  const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  let R;
  try {
    const src = ['_snapshotRoster', '_reconcileProvisionalRoster'].map(n => fnSource(SCRIPT, n)).join('\n');
    const box = { JSON, Map, Set, Object, String };
    vm.createContext(box);
    vm.runInContext(src + '\nthis.snap = (rows) => _snapshotRoster(rows, new Set(rows.map(t => String(t.id)))); this.rec = _reconcileProvisionalRoster;', box);
    R = box;
  } catch (e) { fail('the merge rule exists in script.js', e.message); return; }
  const ph = [{ id: 'a', tenant_name: 'A', cap: 3 }, { id: 'b', tenant_name: 'B', cap: 3 }, { id: 'x', tenant_name: 'X', cap: 3 }];
  const base = R.snap(ph);
  const saved = [{ id: 'a', tenant_name: 'A', cap: 4, capBaseAmount: 11 }, { id: 'b', tenant_name: 'B', cap: 5, capBaseAmount: 22 }, { id: 'c', tenant_name: 'C', capBaseAmount: 33 }];
  // untouched placeholder → the saved row, whole
  let out = R.rec(base, ph.map(t => ({ ...t })), saved);
  assert(JSON.stringify(out.map(t => t.id)) === '["a","b","c"]', 'untouched placeholder rows become the saved rows; a saved row the buffer lacks is appended; a placeholder row the saved roster lacks is dropped', JSON.stringify(out.map(t => t.id)));
  assert(out[0].capBaseAmount === 11 && out[0].cap === 4 && out[1].cap === 5, 'the saved row wins every field the session did not touch', JSON.stringify(out[0]));
  // a field changed this session is carried over; nothing else is
  const live = ph.map(t => ({ ...t })); live[0] = { ...live[0], cap: 9 };
  out = R.rec(base, live, saved);
  assert(out[0].cap === 9 && out[0].capBaseAmount === 11, 'a field changed since the placeholder was painted is kept, on top of the saved row', JSON.stringify(out[0]));
  // a row the placeholder never held is kept exactly
  const up = { id: 'n', tenant_name: 'New', status: 'pending' };
  out = R.rec(base, [...ph.map(t => ({ ...t })), up], saved);
  assert(out.includes(up) && out.filter(t => t.id === 'n').length === 1, 'a session row (upload, pipeline row) is kept as the same object');
  // a changed placeholder row the saved roster lacks is kept
  const lx = ph.map(t => ({ ...t })); lx[2] = { ...lx[2], cap: 7 };
  out = R.rec(base, lx, saved);
  assert(out.some(t => t.id === 'x' && t.cap === 7), 'a placeholder row changed this session is not dropped even if the saved roster lacks it');
  // nulls in the buffer are not rows
  out = R.rec(base, [null, ...ph.map(t => ({ ...t })), null], saved);
  assert(out.every(Boolean) && out.length === 3, 'empty slots are not carried');
  // a lease file (an object with no enumerable fields, as a File is) restored after the paint
  const f = Object.create({ name: 'lease.pdf' });
  const b2 = R.snap([{ id: 'a', tenant_name: 'A' }]);
  out = R.rec(b2, [{ id: 'a', tenant_name: 'A', leaseFile: f }], [{ id: 'a', tenant_name: 'A', capBaseAmount: 11 }]);
  assert(out[0].leaseFile === f && out[0].capBaseAmount === 11, 'a lease file restored after the paint is carried onto the saved row');
}

// ── Browser scenarios ─────────────────────────────────────────────────────────
async function withPage(browser, tableMode, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);
  await page.route('**/supabase-js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* suppressed */' }));
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript((fx) => { try { if (!sessionStorage.getItem('__e2eFixture')) sessionStorage.setItem('__e2eFixture', fx); } catch (_) {} }, JSON.stringify(fixture(tableMode)));
  await page.addInitScript(SUPABASE_MOCK);
  const settled = () => page.waitForEvent('console', { predicate: m => /SECOND renderProperty done/.test(m.text()), timeout: 45000 });
  const signIn = async () => {
    await page.evaluate(() => { try { MainStreetLanding.hide(); } catch (_) {} });
    await _e2eSignIn(page, { email: EMAIL, errors });
    // The portfolio has loaded (and with it the list's roster). Read from the
    // app's state rather than a card selector, so an older checkout's markup
    // can be put under the same test.
    await page.waitForFunction((id) => typeof _props !== 'undefined' && _props.some(p => p && p.id === id), PROP_ID, { timeout: 20000 });
  };
  const open = async (before) => {
    const done = settled();
    await page.evaluate((id) => { selectProperty(id); }, PROP_ID);
    if (before) await before();
    await done;
    await page.waitForTimeout(600);
  };
  const reload = async () => { await page.reload({ waitUntil: 'networkidle' }); await signIn(); };
  const save = async () => {
    await page.evaluate(async () => { await savePropertyData(); });
    await page.waitForTimeout(1400);       // the debounced write lands
  };
  try {
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'networkidle' });
    await signIn();
    await fn({ page, open, reload, save, errors });
  } catch (e) { fail('scenario ' + tableMode + ' ran to completion', e.message); }
  await ctx.close();
}

(async () => {
  console.log('App under test: ' + ROOT);
  section0();

  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  section('§1 table mirrors the saved roster');
  await withPage(browser, 'mirror', async ({ page, open, reload, save, errors }) => {
    const listIsTable = await page.evaluate((id) => { const p = _props.find(x => x.id === id); return (p.tenants || []).every(t => t.capBaseAmount == null && t.leaseDocumentId == null); }, PROP_ID);
    assert(listIsTable, 'precondition: the portfolio list roster came from the tenants table (no saved-only fields)');
    await open();
    fieldsIntact(await page.evaluate(LIVE),   '1a open: the live buffer holds the saved roster with every saved-only field');
    fieldsIntact(await page.evaluate(RECORD), '1b open: the property record holds the same');
    await reload(); await open();
    fieldsIntact(await page.evaluate(LIVE),   '1c after a page reload: every saved-only field is still on screen');
    await save();
    fieldsIntact(await page.evaluate(STORED), '1d an edit after reload saves: the stored roster keeps every saved-only field');
    await reload(); await open(); await save();
    fieldsIntact(await page.evaluate(STORED), '1e a second reload and save: still intact (the loss does not accumulate)');
    const caps = await page.evaluate(LIVE);
    assert(caps.every((r, i) => r.cap === 4 + T.findIndex(x => x.id === r.id)), '1f the saved value wins where the table disagrees (cap: saved 4/5/6, table 3)', JSON.stringify(caps.map(r => r.cap)));
    assert(errors.filter(e => /pageerror/i.test(e)).length === 0, '1g no page errors', errors.join(' | '));
  });

  section('§2 table holds more rows than the saved roster');
  await withPage(browser, 'extra', async ({ page, open, reload, save }) => {
    await open();
    const live = await page.evaluate(LIVE);
    fieldsIntact(live, '2a open: the saved roster wins though the table has more rows — every saved-only field present');
    assert(JSON.stringify(live.map(r => r.id).sort()) === JSON.stringify(T.map(x => x.id).sort()), '2b the roster is the saved roster (the placeholder\'s table-only row is not adopted over it)', JSON.stringify(live.map(r => r.name)));
    await reload(); await open(); await save();
    fieldsIntact(await page.evaluate(STORED), '2c reload and save: the stored roster keeps every saved-only field');
  });

  section('§3 work done before the saved roster arrives');
  await withPage(browser, 'mirror', async ({ page, open, save }) => {
    await page.evaluate(() => { window.__propReadDelay = 1500; });
    await open(async () => {
      // The placeholder is on screen; the saved roster is still in flight.
      await page.waitForTimeout(300);
      await page.evaluate((ids) => {
        const i = tenantData.findIndex(t => t && t.id === ids.edit);
        tenantData[i] = { ...tenantData[i], cap: 9 };
        tenantData.push({ id: ids.added, tenant_name: 'Elm Electric', leased_sqft: 800, lease_type: 'NNN' });
      }, { edit: T[0].id, added: '7a1e0000-0000-4000-8000-0000000000aa' });
    });
    await page.evaluate(() => { window.__propReadDelay = 0; });
    const live = await page.evaluate(LIVE);
    fieldsIntact(live, '3a the saved roster still arrives: every saved-only field present');
    const edited = live.find(r => r.id === T[0].id);
    assert(edited && edited.cap === 9, '3b the field edited in that window is kept on top of the saved row', JSON.stringify(edited));
    assert(live.some(r => r.name === 'Elm Electric'), '3c the row added in that window is kept');
    await save();
    const stored = await page.evaluate(STORED);
    fieldsIntact(stored, '3d saved: the stored roster has the saved-only fields');
    assert(stored.some(r => r.name === 'Elm Electric') && stored.find(r => r.id === T[0].id).cap === 9, '3e saved: the window\'s edit and addition are stored too');
  });

  section('§4 control: empty tenants table');
  await withPage(browser, 'empty', async ({ page, open, reload, save }) => {
    await open();
    fieldsIntact(await page.evaluate(LIVE), '4a open: every saved-only field present');
    await reload(); await open(); await save();
    fieldsIntact(await page.evaluate(STORED), '4b reload and save: every saved-only field stored');
  });

  section('§5 a lease file restored late');
  await withPage(browser, 'mirror', async ({ page, open }) => {
    await open();
    const r = await page.evaluate(async (id) => {
      const i = tenantData.findIndex(t => t && t.id === id);
      const stale = { ...tenantData[i], capBaseAmount: null, leaseDocumentId: null, leaseExpected: true };
      tenantData[i] = stale;
      const orig = window.getLeaseFile;
      let release; const gate = new Promise(res => { release = res; });
      window.getLeaseFile = async (tid) => { await gate; return tid === id ? new File(['x'], 'lease.pdf') : null; };
      const run = restoreLeaseFiles();
      // The saved row replaces the one captured while the file was being read.
      const cur = tenantData.findIndex(t => t && t.id === id);
      tenantData[cur] = { ...tenantData[cur], capBaseAmount: 1011, leaseDocumentId: 'd0c00000-0000-4000-8000-000000000001' };
      release(); await run; window.getLeaseFile = orig;
      const t = tenantData.find(x => x && x.id === id);
      return { file: t.leaseFile instanceof File, cap: t.capBaseAmount, doc: t.leaseDocumentId };
    }, T[0].id);
    assert(r.file && r.cap === 1011 && r.doc === DOC(0), '5a the file lands on the row as it is now; the replaced copy is not written back', JSON.stringify(r));
  });

  section('§6 a roster holding both placeholder rows and a real one');
  await withPage(browser, 'mirror', async ({ page, open, save }) => {
    // A lease job finished for this property after the portfolio was re-read:
    // its real row sits in the list's roster beside the table's rows.
    await page.evaluate((id) => {
      const p = _props.find(x => x.id === id);
      p.tenants = [...p.tenants, { id: '7a1e0000-0000-4000-8000-0000000000bb', tenant_name: 'Fir Florist', leased_sqft: 700, lease_type: 'NNN', capBaseAmount: 55 }];
    }, PROP_ID);
    await open();
    const live = await page.evaluate(LIVE);
    fieldsIntact(live, '6a the placeholder rows are replaced by the saved rows — every saved-only field present');
    const fir = live.find(r => r.name === 'Fir Florist');
    assert(fir && fir.capBaseAmount === 55, '6b the real row beside them is kept, whole', JSON.stringify(fir));
    await save();
    const stored = await page.evaluate(STORED);
    fieldsIntact(stored, '6c saved: the stored roster has the saved-only fields');
    assert(stored.some(r => r.name === 'Fir Florist' && r.capBaseAmount === 55), '6d saved: the real row is stored');
  });

  await browser.close(); server.close();
  console.log('\n' + (failures ? '\x1b[31m❌ ' + failures + ' failure(s)\x1b[0m' : '\x1b[32m✅ roster reload preservation: all checks passed\x1b[0m'));
  process.exit(failures ? 1 : 0);
})();
