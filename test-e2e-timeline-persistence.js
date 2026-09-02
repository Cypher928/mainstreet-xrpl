'use strict';
/**
 * test-e2e-timeline-persistence.js — the record is still there tomorrow.
 *
 *   node test-e2e-timeline-persistence.js
 *   HEADLESS=false node test-e2e-timeline-persistence.js
 *
 * WHY THIS EXISTS
 *
 * The property timeline was written to properties.data on every save and never
 * read back. `selectProperty` restored nine sibling fields from
 * loadPropertyData's result and not this one, appended `sync_restored` to an
 * empty array, and the next save wrote that array over the stored history.
 *
 * Measured on a non-demo property before the fix: two manual entries in Supabase
 * and in localStorage before a reload; one event in memory after it — the fresh
 * sync_restored; zero in either store after the save that followed. Across the
 * pilot it left 27 properties holding a single session each, with no manual
 * entry, attachment or lease reference anywhere in 91 events.
 *
 * WHY THE DEMO IS THE WRONG FIXTURE. ensureDemoProperty() re-seeds
 * `timeline: demoTimeline` on every load, so Cascade Commons always shows its 21
 * events whether or not anything is restored. That is a reseed, not a restore,
 * and it hid this defect. Everything below runs on a property the demo seeder
 * has never heard of.
 *
 * WHAT IT DOES NOT TOUCH. Nothing here changes CAM methodology. The suite
 * snapshots both the allocation INPUTS (the invoice register, the lease fields
 * the engine divides by, the CAM year, the rentable area) and the stored OUTPUTS
 * (what each tenant was billed, and whether a cap bound) before any event is
 * recorded, and compares them again after six events and four reloads. A history
 * that survives must not move a single dollar.
 *
 * A NOTE ON WHAT AN EARLIER DRAFT ASSERTED. It called runFullReconciliation()
 * with `tenants`/`totalSqft`; that function reads `leases`/`totalSqFt` and
 * returned [] for both the before and after snapshot, so the comparison passed
 * by comparing two empty arrays. A green assertion about nothing is worse than
 * no assertion, and the figures below are real ones.
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { signIn, attachDiagnostics } = require('./test-support/e2e-login');

const PORT     = parseInt(process.env.APP_PORT || '7842', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT     = __dirname;
const PID      = 'a11d0000-0000-4000-b000-timelinefix01';

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(44) + ':', typeof v === 'string' ? v : JSON.stringify(v));
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
               '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
               '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url).split('?')[0];
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

// A Supabase stand-in whose rows OUTLIVE A RELOAD. The usual e2e mock keeps its
// store in a closure, so a page reload starts it empty — which makes every
// persistence question unanswerable and would have let this defect pass. Mirrored
// into localStorage under its own key, so the app's own `_ms_props_v2_*` key stays
// exactly what the app wrote.
const SUPABASE_MOCK = `
(function () {
  var KEY = '__tlMockStore';
  var _store = null;
  try { _store = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
  if (!_store) _store = { properties: [], tenants: [], acquisition_reviews: [],
                          cam_reconciliations: [], lease_documents: [], tenant_field_evidence: [] };
  function flush() { try { localStorage.setItem(KEY, JSON.stringify(_store)); } catch (_) {} }
  var _user = { id: 'e2e-test-user-id', email: 'e2e@e2e-test.local' };
  function P(v) { return Promise.resolve(v); }
  function makeQ(t) {
    var f = {};
    var q = {
      select: function () { return q; },
      insert: function (rows) { var a = Array.isArray(rows) ? rows : [rows];
        if (!_store[t]) _store[t] = []; a.forEach(function (r) { _store[t].push(r); }); flush();
        var r = P({ data: a, error: null }); r.select = function () { return P({ data: a, error: null }); }; return r; },
      upsert: function (row) { var a = Array.isArray(row) ? row : [row];
        if (!_store[t]) _store[t] = [];
        a.forEach(function (rw) { var i = _store[t].findIndex(function (x) { return x.id === rw.id; });
          if (i >= 0) _store[t][i] = rw; else _store[t].push(rw); }); flush();
        var r = P({ data: a, error: null }); r.select = function () { return P({ data: a, error: null }); }; return r; },
      update: function () { var r = P({ data: null, error: null });
        r.select = function () { return P({ data: null, error: null }); };
        r.eq = function () { return P({ data: null, error: null }); }; return r; },
      delete: function () { return { eq: function () { return P({ error: null }); } }; },
      eq: function (c, v) { f[c] = v; return q; },
      neq: function () { return q; }, is: function () { return q; }, not: function () { return q; },
      in: function () { return q; }, order: function () { return q; }, limit: function () { return q; },
      gte: function () { return q; }, lte: function () { return q; },
      single: function () { var rows = (_store[t] || []).filter(function (r) {
          return Object.keys(f).every(function (k) { return r[k] === f[k]; }); });
        return P({ data: rows[0] || null, error: null }); },
      maybeSingle: function () { var rows = (_store[t] || []).filter(function (r) {
          return Object.keys(f).every(function (k) { return r[k] === f[k]; }); });
        return P({ data: rows[0] || null, error: null }); },
      then: function (fn) { var rows = (_store[t] || []).filter(function (r) {
          return Object.keys(f).every(function (k) { return r[k] === f[k]; }); });
        return P({ data: rows, error: null }).then(fn); }
    };
    return q;
  }
  window.supabase = { createClient: function () { return {
    auth: {
      getUser: function () { return P({ data: { user: _user }, error: null }); },
      getSession: function () { return P({ data: { session: { user: _user, access_token: 'mock' } }, error: null }); },
      onAuthStateChange: function (cb) { setTimeout(function () { cb('SIGNED_IN', { user: _user }); }, 50);
        return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return P({ error: null }); }
    },
    from: function (tb) { if (!_store[tb]) _store[tb] = []; return makeQ(tb); },
    storage: { from: function () { return {
      upload: function () { return P({ data: { path: 'mock/path' }, error: null }); },
      createSignedUrl: function (p) { return P({ data: { signedUrl: 'https://mock.local/' + p }, error: null }); },
      getPublicUrl: function (p) { return { data: { publicUrl: 'https://mock.local/' + p } }; }
    }; } },
    _store: _store
  }; } };
  window.__e2eStore = _store;
  window.__tlFlush = flush;
})();
`;

// One tenant carrying a CAM cap that actually binds, one that does not, so the
// reconciliation this suite compares across the reload has a cap decision in it.
const FIXTURE = {
  id: PID, name: 'Riverbend Commons', totalSqft: 62000, camYear: 2025,
  tenants: [
    { id: 'tl-t1', tenant_name: 'Northgate Hardware', leased_sqft: '18000', cap: '5',
      capBaseAmount: '9000', suite: '', start_date: '2019-03-01', end_date: '2029-02-28',
      lease_type: 'NNN', excluded_categories: '', amendments: [] },
    { id: 'tl-t2', tenant_name: 'Volt Fitness', leased_sqft: '9200', cap: null,
      suite: '', start_date: '2021-11-01', end_date: '2026-10-31',
      lease_type: 'NNN', excluded_categories: '', amendments: [] },
  ],
  invoices: [
    { id: 'inv-1', vendorName: 'Statewide Mutual Insurance', amount: 38000, category: 'insurance', invoiceDate: '2025-02-01', camEligible: true },
    { id: 'inv-2', vendorName: 'Aspen Grounds Care',        amount: 14200, category: 'landscaping', invoiceDate: '2025-05-12', camEligible: true },
    { id: 'inv-3', vendorName: 'BrightClean Services',      amount: 19800, category: 'janitorial',  invoiceDate: '2025-09-30', camEligible: true },
  ],
  disputes: [], timeline: [], activityLog: [], escrowReserves: [], drawRequests: [],
  aiDrafts: [], results: null, settlement: null,
  // A completed reconciliation, in the shape selectProperty restores: `propId`
  // is load-bearing, because the restore nulls a snapshot whose propId does not
  // match the property being opened. These are the numbers a tenant would be
  // billed, and the assertion at the end of this suite is that a timeline merge
  // does not move any of them.
  camReconciliation: {
    propId: PID, camYear: 2025, totalExpenses: 72000,
    results: [
      { tenantId: 'tl-t1', tenantName: 'Northgate Hardware', proRataPercent: 29.03,
        allocatedAmount: 9450, totalAllocated: 9450, capApplied: true },
      { tenantId: 'tl-t2', tenantName: 'Volt Fitness', proRataPercent: 14.84,
        allocatedAmount: 10684.8, totalAllocated: 10684.8, capApplied: false },
    ],
  },
};

// Everything a tenant charge depends on: the allocation INPUTS (the invoice
// register and the lease fields the engine divides by) and the stored OUTPUTS
// (what each tenant was actually billed, and whether a cap bound). If none of
// this differs across the reload, no allocation can have changed.
const _moneyShape = `(function (p) {
  return {
    invoices: (p.invoices || []).map(function (i) {
      return { id: i.id, amount: i.amount, category: i.category, camEligible: i.camEligible };
    }),
    // BY VALUE, NOT BY TYPE. A tenant's leased_sqft goes in as the string the
    // extraction produced and comes back off the round trip as a number — a
    // pre-existing behaviour of the tenant path, identical at HEAD and untouched
    // by the timeline change (its diff contains no tenant, sqft or cap line).
    // Comparing raw JSON here failed on "18000" vs 18000 while every figure the
    // engine divides by was the same. What matters is the quantity.
    leaseInputs: (p.tenants || []).map(function (t) {
      var num = function (v) { var n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      return { id: t.id, sqft: num(t.leased_sqft), cap: num(t.cap), capBase: num(t.capBaseAmount),
               type: t.lease_type || null, excl: t.excluded_categories || null };
    }),
    allocations: (((p.camReconciliation || {}).results) || []).map(function (r) {
      return { tenant: r.tenantName, allocated: r.allocatedAmount,
               capApplied: !!r.capApplied, proRata: r.proRataPercent };
    }),
    camYear: p.camYear != null ? p.camYear : null,
    totalSqft: p.totalSqft
  };
})`;

// The two records a manager would actually make, carrying every field the audit
// found empty across the whole pilot: manual, responsibility, leaseRef, an
// attachment, and suite scoping.
const MANUAL_EVENTS = [
  { type: 'manual_maintenance', category: 'maintenance', responsibility: 'landlord',
    leaseRef: 'Section 7.3',
    title: 'RTU-3 compressor replaced',
    description: 'Rooftop unit over the stockroom. Under warranty — ComfortFirst HVAC.',
    attachments: [{ name: 'ComfortFirst invoice 4417.pdf', kind: 'invoice',
                    url: 'data:application/pdf;base64,JVBERi0xLjQK' }] },
  { type: 'manual_note', category: 'note', responsibility: 'tenant',
    title: 'Tenant phoned about parking',
    description: 'Wants two reserved bays before renewal. Agreed to revisit in Q1.' },
];

(async () => {
  console.log('\n══ A property\'s history is still there after a reload ══');
  const server  = await startServer();
  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);

  await page.route('**/supabase-js**', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed */' }));
  await page.addInitScript(SUPABASE_MOCK);

  const openFixture = async () => {
    await page.evaluate(async (pid) => {
      activePropId = pid;
      if (typeof selectProperty === 'function') await selectProperty(pid);
    }, PID);
    await page.waitForTimeout(2200);
  };

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await signIn(page, { errors });

    // ── Seed a property the demo seeder has never heard of ──────────────────
    H('A property the demo seeder does not own');
    const created = await page.evaluate(async (fx) => {
      _props = (Array.isArray(_props) ? _props : []).filter(p => p && p.id !== fx.id).concat([JSON.parse(JSON.stringify(fx))]);
      activePropId = fx.id;
      await saveProperty(_props[_props.length - 1]);
      try { if (typeof renderProperty === 'function') renderProperty(currentProperty()); } catch (_) {}
      const p = currentProperty();
      return { open: !!p, name: p && p.name,
               isDemo: window.PropertyReference ? PropertyReference.isDemo(p) : null };
    }, FIXTURE);
    R('property', created);
    yes('the fixture opens and is not the demo property',
        created.open && created.name === 'Riverbend Commons' && created.isDemo === false,
        JSON.stringify(created));

    // ── The money, before anything is recorded ──────────────────────────────
    const moneyBefore = await page.evaluate((src) => eval(src)(currentProperty()), _moneyShape);
    R('allocations (before)', moneyBefore.allocations);
    yes('the property carries a real reconciliation with a binding cap to compare against',
        moneyBefore.allocations.length === 2 && moneyBefore.allocations.some(a => a.capApplied),
        JSON.stringify(moneyBefore.allocations));

    // ── Record what a manager would record ──────────────────────────────────
    H('Two records, carrying every field the pilot has none of');
    const written = await page.evaluate(async (evs) => {
      const p = currentProperty(); const t = (p.tenants || [])[0];
      for (const e of evs) {
        await appendPropertyTimelineEvent(p, Object.assign({
          manual: true, tenantId: t.id, actor: 'Property Manager',
          subject: { type: 'suite', id: t.id, label: t.tenant_name },
        }, e));
      }
      // A system event too — history is not only what a person typed.
      await appendPropertyTimelineEvent(p, { type: 'invoice_imported', actor: 'System',
        title: 'Q3 invoices imported', description: '3 invoices imported.' });
      await savePropertyData().catch(() => {});
      const tl = currentProperty().timeline || [];
      return { total: tl.length, manual: tl.filter(e => e.manual).length,
               titles: tl.map(e => e.title) };
    }, MANUAL_EVENTS);
    R('written', written);
    yes('three events are on the property before the reload',
        written.total === 3 && written.manual === 2, JSON.stringify(written));

    await page.waitForTimeout(900);
    await page.evaluate(() => { try { window.__tlFlush && window.__tlFlush(); } catch (_) {} });

    const beforeStores = await page.evaluate(() => {
      const st = window.__e2eStore || {};
      const row = (st.properties || []).find(r => r.data && Array.isArray(r.data.timeline) && r.data.timeline.length);
      let ls = 0;
      try {
        const k = Object.keys(localStorage).find(x => /^_ms_props_v2_/.test(x));
        const o = JSON.parse(localStorage.getItem(k) || '{}');
        const first = Object.values(o)[0];
        ls = first && first.timeline ? first.timeline.length : 0;
      } catch (_) {}
      return { supabase: row ? row.data.timeline.length : 0, localStorage: ls };
    });
    R('stores before reload', beforeStores);
    yes('both stores hold all three events before the reload',
        beforeStores.supabase === 3 && beforeStores.localStorage === 3, JSON.stringify(beforeStores));

    // ── The merge also runs WITHOUT a reload ────────────────────────────────
    // Found by mutation testing: every assertion below the reload puts the
    // manual entries on the STORED side, so a merge that dropped manual events
    // from the live side passed the whole suite. Reopening a property in the
    // same session runs the same merge with this session's records as the
    // primary side — a note typed a moment before the load callback lands.
    H('Reopening in the same session does not eat what was just typed');
    const sameSession = await page.evaluate(async (pid) => {
      const p = currentProperty();
      await appendPropertyTimelineEvent(p, { manual: true, category: 'maintenance',
        type: 'manual_maintenance', responsibility: 'landlord', actor: 'Property Manager',
        tenantId: 'tl-t1', subject: { type: 'suite', id: 'tl-t1', label: 'Northgate Hardware' },
        title: 'Parking lot restriped', attachments: [] });
      const beforeReopen = (currentProperty().timeline || []).length;
      // Force the full load-and-merge path rather than selectProperty's
      // same-property early return.
      activePropId = null;
      await selectProperty(pid);
      await new Promise(r => setTimeout(r, 2200));
      const tl = (currentProperty() || {}).timeline || [];
      return { beforeReopen, afterReopen: tl.length,
               keptJustTyped: tl.some(e => e.title === 'Parking lot restriped'),
               keptEarlier:   tl.some(e => e.title === 'RTU-3 compressor replaced'),
               sync: tl.filter(e => e.type === 'sync_restored').length };
    }, PID);
    R('same-session reopen', sameSession);
    yes('an event recorded but NOT YET SAVED survives the reopen merge',
        sameSession.keptJustTyped === true, JSON.stringify(sameSession));
    yes('    and it does not cost the events already on disk',
        sameSession.keptEarlier === true && sameSession.afterReopen >= 4,
        JSON.stringify(sameSession));

    await page.evaluate(async () => { await saveProperty(currentProperty()); });
    await page.waitForTimeout(600);
    await page.evaluate(() => { try { window.__tlFlush && window.__tlFlush(); } catch (_) {} });

    // ── THE RELOAD ──────────────────────────────────────────────────────────
    H('Reload, reopen — this is where the history used to disappear');
    await page.reload({ waitUntil: 'networkidle' });
    await signIn(page, { errors });
    await openFixture();

    const afterReload = await page.evaluate(() => {
      const p = currentProperty(); const tl = (p && p.timeline) || [];
      const find = (t) => tl.find(e => (e.title || '') === t) || null;
      const maint = find('RTU-3 compressor replaced');
      const note  = find('Tenant phoned about parking');
      const sys   = find('Q3 invoices imported');
      const t = (p.tenants || [])[0];
      const rec = (window.TenantSpace && t) ? TenantSpace.assemble(p, t.id) : null;
      return {
        loaded: !!p, total: tl.length,
        maintenance: maint && { manual: maint.manual, responsibility: maint.responsibility,
          leaseRef: maint.leaseRef, attachments: (maint.attachments || []).length,
          attachmentUrlKept: !!(maint.attachments || []).some(a => String(a.url || '').startsWith('data:')),
          subjectType: maint.subject && maint.subject.type, subjectId: maint.subject && maint.subject.id,
          category: maint.category },
        note: note && { manual: note.manual, responsibility: note.responsibility, category: note.category },
        systemEvent: !!sys,
        syncRestored: tl.filter(e => e.type === 'sync_restored').length,
        chronological: tl.every((e, i) => i === 0 ||
          new Date(tl[i - 1].timestamp).getTime() <= new Date(e.timestamp).getTime()),
        spaceEvents: rec ? rec.counts.events : null,
        spaceNotes:  rec ? rec.counts.notes  : null,
      };
    });
    R('after reload', { total: afterReload.total, sync: afterReload.syncRestored,
                        spaceEvents: afterReload.spaceEvents, spaceNotes: afterReload.spaceNotes });
    R('maintenance record', afterReload.maintenance);

    yes('the manual maintenance record survived save → reload',
        !!afterReload.maintenance && afterReload.maintenance.manual === true,
        JSON.stringify(afterReload.maintenance));
    yes('its responsibility survived — landlord, not "na"',
        afterReload.maintenance && afterReload.maintenance.responsibility === 'landlord',
        String(afterReload.maintenance && afterReload.maintenance.responsibility));
    yes('its lease-section reference survived',
        afterReload.maintenance && afterReload.maintenance.leaseRef === 'Section 7.3',
        String(afterReload.maintenance && afterReload.maintenance.leaseRef));
    yes('its attachment survived, with the file behind it',
        afterReload.maintenance && afterReload.maintenance.attachments === 1 &&
        afterReload.maintenance.attachmentUrlKept,
        JSON.stringify(afterReload.maintenance));
    yes('its suite scoping survived, so it is still the right space\'s record',
        afterReload.maintenance && afterReload.maintenance.subjectType === 'suite' &&
        afterReload.maintenance.subjectId === 'tl-t1',
        JSON.stringify(afterReload.maintenance));
    yes('the note survived too',
        !!afterReload.note && afterReload.note.category === 'note', JSON.stringify(afterReload.note));
    yes('the system-generated event survived alongside the manual ones',
        afterReload.systemEvent === true, 'invoice_imported is gone');
    yes('sync_restored did NOT replace the history — all four records are still there',
        afterReload.total === 5 && afterReload.syncRestored === 1, String(afterReload.total));
    yes('the timeline is in chronological order',
        afterReload.chronological === true, 'events are out of order');
    // TWO, not three, and that is correct: `Q3 invoices imported` is a
    // property-level event with no tenantId, and TenantSpace refuses to scope an
    // unscoped event into a suite ("an empty record is recoverable, a wrong one
    // reaches a tenant"). The restored history is visible where it belongs
    // without the property's own events leaking into a tenant's record.
    yes('and the Space shows the three events that are its own, plus the note',
        afterReload.spaceEvents === 3 && afterReload.spaceNotes === 1,
        JSON.stringify({ e: afterReload.spaceEvents, n: afterReload.spaceNotes }));
    yes('    the property-level events stay out of the suite\'s record',
        afterReload.total === 5 && afterReload.spaceEvents === 3,
        JSON.stringify({ propertyEvents: afterReload.total, spaceEvents: afterReload.spaceEvents }));

    // ── Reload, then save — the step that used to destroy the record ────────
    H('Reload → save reproduces the history rather than overwriting it');
    const afterSave = await page.evaluate(async () => {
      const p = currentProperty();
      const beforeIds = (p.timeline || []).map(e => e.id).join(',');
      await saveProperty(p);
      await new Promise(r => setTimeout(r, 400));
      try { window.__tlFlush && window.__tlFlush(); } catch (_) {}
      const st = window.__e2eStore || {};
      const row = (st.properties || []).find(r => r.id === p.id);
      let ls = null;
      try {
        const k = Object.keys(localStorage).find(x => /^_ms_props_v2_/.test(x));
        const o = JSON.parse(localStorage.getItem(k) || '{}');
        ls = o[p.id] && o[p.id].timeline ? o[p.id].timeline : null;
      } catch (_) {}
      const dbTl = row && row.data ? (row.data.timeline || []) : [];
      return {
        beforeIds,
        dbCount: dbTl.length, lsCount: ls ? ls.length : 0,
        dbManual: dbTl.filter(e => e.manual).length,
        dbIds: dbTl.map(e => e.id).join(','),
        lsIds: ls ? ls.map(e => e.id).join(',') : '',
        dbAttachments: dbTl.reduce((n, e) => n + ((e.attachments || []).length), 0),
        dbResponsibilities: dbTl.filter(e => e.responsibility && e.responsibility !== 'na').length,
      };
    });
    R('after save', { db: afterSave.dbCount, ls: afterSave.lsCount, manual: afterSave.dbManual });
    yes('the save writes back all five events, not the one it started the session with',
        afterSave.dbCount === 5 && afterSave.dbManual === 3, JSON.stringify(afterSave));
    yes('the stored history is exactly what was in memory — no additions, no losses',
        afterSave.dbIds === afterSave.beforeIds, afterSave.dbIds + ' vs ' + afterSave.beforeIds);
    yes('localStorage and Supabase now hold the same history',
        afterSave.lsIds === afterSave.dbIds && afterSave.lsCount === afterSave.dbCount,
        JSON.stringify({ ls: afterSave.lsIds, db: afterSave.dbIds }));
    yes('the attachment and the responsibility are in the PERSISTED rows, not just in memory',
        afterSave.dbAttachments === 1 && afterSave.dbResponsibilities === 3,
        JSON.stringify({ att: afterSave.dbAttachments, resp: afterSave.dbResponsibilities }));

    // ── A second and third reload ───────────────────────────────────────────
    H('Repeated reloads neither duplicate nor accumulate');
    await page.reload({ waitUntil: 'networkidle' });
    await signIn(page, { errors });
    await openFixture();
    const second = await page.evaluate(() => {
      const tl = (currentProperty() || {}).timeline || [];
      return { total: tl.length, sync: tl.filter(e => e.type === 'sync_restored').length,
               ids: tl.map(e => e.id).join(',') };
    });
    await page.evaluate(async () => { await saveProperty(currentProperty()); });
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'networkidle' });
    await signIn(page, { errors });
    await openFixture();
    const third = await page.evaluate(() => {
      const tl = (currentProperty() || {}).timeline || [];
      const seen = {}; let dupes = 0;
      tl.forEach(e => { if (seen[e.id]) dupes++; seen[e.id] = 1; });
      return { total: tl.length, sync: tl.filter(e => e.type === 'sync_restored').length,
               dupes, ids: tl.map(e => e.id).join(',') };
    });
    R('reload 2', { total: second.total, sync: second.sync });
    R('reload 3', { total: third.total, sync: third.sync, dupes: third.dupes });
    yes('a second reload adds nothing',
        second.total === 5 && second.sync === 1, JSON.stringify(second));
    yes('a third reload, after another save, still adds nothing',
        third.total === 5 && third.sync === 1, JSON.stringify(third));
    yes('sync_restored does not duplicate itself across reloads',
        third.sync === 1, String(third.sync));
    yes('no event id appears twice',
        third.dupes === 0, String(third.dupes));
    yes('and the history is byte-for-byte the same set it was two reloads ago',
        third.ids === afterSave.dbIds, third.ids + ' vs ' + afterSave.dbIds);

    // ── A new record after all that ─────────────────────────────────────────
    H('The loop closes: record again, and both survive');
    const appended = await page.evaluate(async () => {
      const p = currentProperty(); const t = (p.tenants || [])[0];
      await appendPropertyTimelineEvent(p, { manual: true, category: 'inspection',
        type: 'manual_inspection', responsibility: 'shared', tenantId: t.id,
        subject: { type: 'suite', id: t.id, label: t.tenant_name },
        actor: 'Property Manager', title: 'Annual sprinkler inspection', attachments: [] });
      await saveProperty(p);
      await new Promise(r => setTimeout(r, 400));
      try { window.__tlFlush && window.__tlFlush(); } catch (_) {}
      return (currentProperty().timeline || []).length;
    });
    await page.reload({ waitUntil: 'networkidle' });
    await signIn(page, { errors });
    await openFixture();
    const finalState = await page.evaluate(() => {
      const tl = (currentProperty() || {}).timeline || [];
      return { total: tl.length, sync: tl.filter(e => e.type === 'sync_restored').length,
               hasOld: tl.some(e => e.title === 'RTU-3 compressor replaced'),
               hasNew: tl.some(e => e.title === 'Annual sprinkler inspection') };
    });
    R('after appending a sixth', { inMemory: appended, afterReload: finalState });
    yes('a record made after several reloads survives its own reload',
        finalState.hasNew === true, 'the new inspection is gone');
    yes('    and it did not cost the older ones',
        finalState.hasOld === true && finalState.total === 6, JSON.stringify(finalState));
    yes('    with still exactly one sync_restored',
        finalState.sync === 1, String(finalState.sync));

    // ── The money must not have moved ───────────────────────────────────────
    H('A history that survives moves no money');
    const moneyAfter = await page.evaluate((src) => eval(src)(currentProperty()), _moneyShape);
    R('allocations (after)', moneyAfter.allocations);
    yes('every allocation is identical after six events and four reloads',
        JSON.stringify(moneyAfter.allocations) === JSON.stringify(moneyBefore.allocations),
        JSON.stringify({ before: moneyBefore.allocations, after: moneyAfter.allocations }));
    yes('the cap decisions are identical',
        JSON.stringify(moneyAfter.allocations.map(a => a.capApplied)) ===
        JSON.stringify(moneyBefore.allocations.map(a => a.capApplied)),
        'a cap decision changed');
    yes('the allocation INPUTS are identical too — the invoice register',
        JSON.stringify(moneyAfter.invoices) === JSON.stringify(moneyBefore.invoices),
        JSON.stringify({ before: moneyBefore.invoices, after: moneyAfter.invoices }));
    yes('    and the lease fields the engine divides by',
        JSON.stringify(moneyAfter.leaseInputs) === JSON.stringify(moneyBefore.leaseInputs),
        JSON.stringify({ before: moneyBefore.leaseInputs, after: moneyAfter.leaseInputs }));
    yes('    and the CAM year and rentable area',
        moneyAfter.camYear === moneyBefore.camYear && moneyAfter.totalSqft === moneyBefore.totalSqft,
        JSON.stringify([moneyBefore.camYear, moneyAfter.camYear, moneyBefore.totalSqft, moneyAfter.totalSqft]));

    const verdicts = await page.evaluate(() => {
      const p = currentProperty();
      if (!window.AuditExposure || typeof buildAuditSummary !== 'function') return { unavailable: true };
      const sum = buildAuditSummary(p);
      const findings = (sum && sum.findings) || [];
      const exp = AuditExposure.deriveExposure(findings, p);
      const rd  = AuditExposure.billingReadiness(exp, p);
      return { findings: findings.length,
               verdict: rd && (rd.verdict || rd.state || rd.label) || null,
               blockedTenants: exp && exp.blocking && exp.blocking.byTenant
                 ? Object.keys(exp.blocking.byTenant).length : 0 };
    });
    R('billing readiness', verdicts);
    yes('billing readiness is computable and reports a verdict after the merge',
        !verdicts.unavailable && verdicts.verdict != null, JSON.stringify(verdicts));

    // ── Nothing broke on the way ────────────────────────────────────────────
    H('Page errors');
    R('errors', errors.length ? errors.slice(0, 4) : '(none)');
    yes('no uncaught page errors across four reloads', errors.length === 0,
        JSON.stringify(errors.slice(0, 4)));

  } catch (e) {
    bad('UNCAUGHT', e.message);
    console.error(e.stack);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
