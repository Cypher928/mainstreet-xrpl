'use strict';
/**
 * test-e2e-lease-field-editing.js — a manager fills in what the AI could not
 * read, in the running application, and the record says who filled it in.
 *
 *   node test-e2e-lease-field-editing.js
 *   HEADLESS=false node test-e2e-lease-field-editing.js
 *
 * WHY THIS EXISTS
 *
 * test-lease-field-manual-entry.js pins the writer chain over real tenant
 * objects. It cannot see two things that only the running app has: whether the
 * input is reachable at all, and whether the card survives its own save. Both
 * were the defect.
 *
 *   "Edit Fields" in the Lease Review Workspace opened openTenantDetailPanel —
 *   a read-only sheet where a field the extraction missed renders as an
 *   em-dash. The workspace named each gap, offered a button labelled Edit
 *   Fields, and delivered a page with nothing to type into. The fields were
 *   editable all along, one surface over, on the lease intake card.
 *
 *   And seven of the eight intake-card fields wrote through handleFieldBlur,
 *   which records the value and nothing else — so a hand-typed square footage
 *   came back from a reload reading "AI Extraction · CascadeLease.pdf", naming
 *   a document that does not contain the number.
 *
 * THE RELOAD IS THE POINT. Every persistence claim below is made across a real
 * page reload against a store that outlives it, because the in-memory object is
 * not the question — _stripBlobs and normalizeTenant are, and they have
 * silently dropped fields before.
 */

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { signIn, attachDiagnostics } = require('./test-support/e2e-login');

const PORT     = parseInt(process.env.APP_PORT || '7851', 10);
const HEADLESS = process.env.HEADLESS !== 'false';
const ROOT     = __dirname;
const PID      = 'c1f00000-0000-4000-d000-leaseedit0001';
const USER_EMAIL = 'e2e@e2e-test.local';

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const eqs = (m, a, b) => (String(a) === String(b) ? ok(m) : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const R   = (l, v) => console.log('  ' + String(l).padEnd(44) + ':', typeof v === 'string' ? v : JSON.stringify(v));
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

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

// A store that outlives a reload. A persistence question cannot be answered by
// a mock whose rows vanish with the page.
const SUPABASE_MOCK = `
(function () {
  var KEY = '__lfeMockStore';
  var _store = null;
  try { _store = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
  if (!_store) _store = { properties: [], tenants: [], acquisition_reviews: [],
                          cam_reconciliations: [], lease_documents: [], tenant_field_evidence: [] };
  function flush() { try { localStorage.setItem(KEY, JSON.stringify(_store)); } catch (_) {} }
  var _user = { id: 'e2e-test-user-id', email: '${USER_EMAIL}' };
  function P(v) { return Promise.resolve(v); }
  function makeQ(t) {
    var f = {};
    var q = {
      select: function () { return q; },
      insert: function (rows) { var a = Array.isArray(rows) ? rows : [rows];
        if (!_store[t]) _store[t] = []; a.forEach(function (r) { _store[t].push(r); }); flush();
        var r = P({ data: a, error: null }); r.select = function () { return P({ data: a, error: null }); }; return r; },
      // UPSERT MUST MATCH ON THE CONFLICT TARGET, NOT ON id.
      //
      // This matched \`x.id === rw.id\`, and tenant_field_evidence rows carry no
      // id in their payload — the column is generated. So every evidence write
      // found the previous id-less row (undefined === undefined) and REPLACED
      // it: two fields edited in one session left exactly one evidence row, the
      // last one written. The suite caught it as a product defect that was not
      // there — a reviewer's name vanishing from one field but not another —
      // which is precisely the kind of thing a sloppy mock invents.
      //
      // The real call is .upsert(payload, { onConflict: 'tenant_id,field_key,reviewed_at' }),
      // so that is the key when no id is supplied.
      upsert: function (row, opts) { var a = Array.isArray(row) ? row : [row];
        if (!_store[t]) _store[t] = [];
        var keys = (opts && opts.onConflict) ? String(opts.onConflict).split(',') : null;
        a.forEach(function (rw) {
          var i = -1;
          if (rw.id !== undefined) {
            i = _store[t].findIndex(function (x) { return x.id === rw.id; });
          } else if (keys) {
            i = _store[t].findIndex(function (x) {
              return keys.every(function (k) { return x[k.trim()] === rw[k.trim()]; }); });
          }
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
})();
`;

// ── The fixture ────────────────────────────────────────────────────────────
//
// T_GAP is the case the whole change is about: the AI read the lease, produced
// a name and a lease type, and found no square footage. That is what the
// Review Workspace tells the manager to go and enter.
//
// T_CITED is the harder half: a cap the AI DID read, with a page citation
// behind it, which the manager is about to correct.
const T_GAP = {
  id: 'lfe-t1', tenant_name: 'Maple Coffee Co', fileName: 'CascadeLease.pdf',
  leased_sqft: null, lease_type: 'Triple Net (NNN)',
  start_date: '2024-01-01', end_date: '2029-12-31',
  cap: null, reviewOverrides: {}, amendments: [], confidence: {},
};
const T_CITED = {
  id: 'lfe-t2', tenant_name: 'Harborview Dental', fileName: 'HarborviewLease.pdf',
  leased_sqft: 3100, lease_type: 'Triple Net (NNN)',
  start_date: '2023-06-01', end_date: '2028-05-31',
  cap: 5, reviewOverrides: {}, amendments: [], confidence: {},
};

const FIXTURE = {
  id: PID, name: 'Lease Edit Plaza', totalSqft: 20000, camYear: 2025,
  tenants: [T_GAP, T_CITED],
  invoices: [], disputes: [], timeline: [], activityLog: [],
  escrowReserves: [], drawRequests: [], aiDrafts: [],
  results: null, settlement: null, camReconciliation: null,
};

/** Everything the app can say about one field, read from the live page. */
const _probe = `(function (tid, field) {
  var p = currentProperty();
  var t = (p && p.tenants || []).find(function (x) { return x && x.id === tid; });
  if (!t) return { missing: true };
  var pv = window.FieldProvenance ? FieldProvenance.fieldProvenance(field, t) : null;
  var ov = (t.reviewOverrides || {})[field] || null;
  return {
    value:      t[field] == null ? null : String(t[field]),
    state:      pv && pv.state,
    method:     pv && pv.method,
    by:         pv && pv.by,
    when:       pv && pv.when,
    cited:      pv && pv.cited,
    quote:      pv && pv.quote,
    page:       pv && pv.page,
    sourceFile: pv && pv.sourceFile,
    override:   ov ? { original: ov.original == null ? null : String(ov.original),
                       confirmed: !!ov.reviewerConfirmed, at: ov.reviewedAt } : null,
    rwMethod:   (typeof _rwExtractionMethod === 'function' ? _rwExtractionMethod(field, t) : null),
    rwChip:     (typeof _rwConfChip === 'function' ? _rwConfChip(field, t).label : null),
  };
})`;

(async () => {
  console.log('\n══ A field the AI could not read can be entered, and says who entered it ══');
  const server  = await startServer();
  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);
  page.on('dialog', d => d.accept());

  await page.route('**/supabase-js**', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* supabase CDN suppressed */' }));
  await page.addInitScript(SUPABASE_MOCK);

  const probe = (tid, field) =>
    page.evaluate(([src, id, f]) => eval(src)(id, f), [_probe, tid, field]);

  /**
   * Open the fixture property and land on the lease intake list.
   *
   * loadProperties() first when the property is not in memory — which is the
   * case after a reload, and is exactly the read path being tested. selectProperty
   * is what hydrates tenantData from prop.tenants, so the intake cards exist.
   */
  const openProperty = async () => {
    await page.evaluate(async (pid) => {
      if (!(Array.isArray(_props) ? _props : []).some(p => p && p.id === pid)) {
        if (typeof loadProperties === 'function') await loadProperties();
      }
      activePropId = pid;
      if (typeof selectProperty === 'function') await selectProperty(pid);
    }, PID);
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      if (typeof switchWorkspaceTab === 'function') switchWorkspaceTab('spaces');
      if (typeof switchLeaseTab === 'function') switchLeaseTab('bulk');
      if (typeof renderBulkResults === 'function') renderBulkResults();
    });
    await page.waitForTimeout(600);
  };

  /** The tenantData index of a tenant, which is what the card ids are keyed on. */
  const idxOf = (tid) => page.evaluate(
    (id) => tenantData.findIndex(t => t && t.id === id), tid);

  /**
   * Expand a card the way a user does — by clicking its summary row.
   *
   * The lease block itself folds away on a property whose leases are all
   * reviewed, and after a reload it comes back folded, so the summary row is
   * present but has no box to click. openReviewItemFix opens it with the same
   * call; doing it here keeps the click a real click rather than a scripted
   * toggle.
   */
  const expandCard = async (i) => {
    await page.evaluate(() => {
      try {
        if (window.PropertyOS && window.PropertyOS.revealForAnchor)
          window.PropertyOS.revealForAnchor(['cardLeases']);
      } catch (_) {}
    });
    await page.waitForTimeout(300);
    const open = await page.evaluate((n) => {
      const d = document.getElementById('bdet-' + n);
      return !!d && d.style.display === 'block';
    }, i);
    if (open === true) return;
    const clickable = await page.evaluate((n) => {
      const s = document.querySelector('#btr-' + n + ' .bulk-tenant-summary');
      if (!s) return false;
      const r = s.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }, i);
    if (clickable) {
      await page.click(`#btr-${i} .bulk-tenant-summary`);
    } else {
      // The card is rendered but not laid out — report it rather than hide it,
      // then open it directly so the rest of the suite can still run.
      R('NOTE: card ' + i + ' summary had no box; opened via toggleBulkDetail', true);
      await page.evaluate((n) => toggleBulkDetail(n), i);
    }
    await page.waitForTimeout(400);
  };

  /** The input under a given label inside a card. */
  const fieldInput = (i, labelRe) => page.evaluate(([n, re]) => {
    const row = document.getElementById('btr-' + n);
    if (!row) return null;
    const rx = new RegExp(re);
    const f = [...row.querySelectorAll('.field')]
      .find(x => rx.test((x.querySelector('label')?.textContent || '').trim()));
    if (!f) return null;
    const el = f.querySelector('input, select');
    if (!el) return null;
    if (!el.id) el.id = 'lfe-probe-' + n + '-' + Math.random().toString(36).slice(2, 8);
    const r = el.getBoundingClientRect();
    return { id: el.id, tag: el.tagName, value: el.value, disabled: !!el.disabled,
             readOnly: !!el.readOnly, visible: r.width > 0 && r.height > 0 };
  }, [i, labelRe.source]);

  let exitCode = 0;
  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await signIn(page, { errors });

    H('STEP 0 — seed a property whose AI extraction left a gap');
    // Seeded through the product's OWN writer. A hand-written row is not the
    // shape loadProperties reads back, and the suite proved it: _props came
    // back empty and the intake list showed its no-leases empty state. Using
    // saveProperty means the row under test is the row the app writes, which
    // is also what makes the reload in STEP 4 a real question.
    const seeded = await page.evaluate(async (fx) => {
      _props = (Array.isArray(_props) ? _props : []).filter(p => p && p.id !== fx.id)
                 .concat([JSON.parse(JSON.stringify(fx))]);
      activePropId = fx.id;
      await saveProperty(_props[_props.length - 1]);
      return { props: _props.length, rows: (window.__e2eStore.properties || []).length };
    }, FIXTURE);
    R('seeded', JSON.stringify(seeded));
    await page.waitForTimeout(800);
    await openProperty();

    const i1 = await idxOf('lfe-t1');
    const i2 = await idxOf('lfe-t2');
    R('Maple Coffee Co card index', i1);
    R('Harborview Dental card index', i2);
    yes('both leases are on the intake list', i1 >= 0 && i2 >= 0, `got ${i1} / ${i2}`);

    // ── 1. The gap is reachable and typeable ────────────────────────────────
    H('STEP 1 — the missing field is an editable, empty input');
    await expandCard(i1);
    const sqftIn = await fieldInput(i1, /Leased Sqft/);
    yes('the Leased Sqft input exists on the card', !!sqftIn, JSON.stringify(sqftIn));
    if (sqftIn) {
      yes('it is visible', sqftIn.visible);
      yes('it is not disabled', !sqftIn.disabled);
      yes('it is not read-only', !sqftIn.readOnly);
      eqs('and it is empty — the AI found nothing', sqftIn.value, '');
    }

    const beforeEntry = await probe('lfe-t1', 'leased_sqft');
    R('before entry (sqft)', beforeEntry.state + ' / ' + beforeEntry.method +
                             ' / value=' + JSON.stringify(beforeEntry.value));
    // PRE-EXISTING, RECORDED RATHER THAN ASSERTED AWAY. selectProperty's restore
    // path coerces every leased_sqft with `Number(t.leased_sqft) || 0`
    // (script.js:29098), so a lease the AI found no square footage for arrives
    // in tenantData carrying 0 rather than null. The input still renders empty
    // — `${d.leased_sqft || ''}` — so the manager sees the gap, but the resolver
    // sees a value and reports ai_extracted for it. That is a separate defect
    // in a different function and it is NOT in this change's scope; it is
    // pinned here so the next reader knows the 0 is real and where it comes from.
    eqs('the stored sqft is the coerced 0, not null (see script.js:29098)',
        beforeEntry.value, '0');

    // `cap` takes no such coercion, so it shows the honest starting state for a
    // field the extraction never produced.
    const beforeCap = await probe('lfe-t1', 'cap');
    R('before entry (cap)', beforeCap.state + ' / value=' + JSON.stringify(beforeCap.value));
    eqs('a genuinely absent field reports unknown, not a guess', beforeCap.state, 'unknown');

    // ── 2. Type it, blur, and stay put ──────────────────────────────────────
    H('STEP 2 — enter 4200 by hand');
    await page.fill('#' + sqftIn.id, '4200');
    // Blur to a sibling field, which is what tabbing out does.
    await page.evaluate((id) => { document.getElementById(id).blur(); }, sqftIn.id);
    // savePropertyData is debounced by 800ms and saveFieldOverride re-renders.
    await page.waitForTimeout(2000);

    const stillOpen = await page.evaluate((n) => {
      const d = document.getElementById('bdet-' + n);
      const c = document.getElementById('bchev-' + n);
      return { open: !!d && d.style.display === 'block',
               chev: (c && c.textContent || '').trim() };
    }, i1);
    R('card state after save', JSON.stringify(stillOpen));
    yes('THE CARD IS STILL OPEN after the save re-rendered the list', stillOpen.open,
        'the manager was closed out of the card they were typing in');
    yes('and the chevron still reads Close', /Close/.test(stillOpen.chev), stillOpen.chev);

    const afterEntry = await probe('lfe-t1', 'leased_sqft');
    R('after entry', JSON.stringify(afterEntry));
    eqs('the value is on the tenant', afterEntry.value, '4200');
    eqs('provenance is manually_entered', afterEntry.state, 'manually_entered');
    eqs('the Review Workspace reads "Manually Entered"', afterEntry.rwMethod, 'Manually Entered');
    eqs('and its chip reads Manual', afterEntry.rwChip, 'Manual');
    eqs('naming the signed-in user', afterEntry.by, USER_EMAIL);
    yes('with an ISO-8601 timestamp', ISO_RE.test(afterEntry.when || ''), afterEntry.when);
    yes('and claiming no source document', afterEntry.sourceFile === null,
        String(afterEntry.sourceFile));

    // ── 2b. The card survives a rebuild it did not ask for ──────────────────
    //
    // The card's own edits no longer rebuild the list — that is what stopped
    // the next field being destroyed mid-entry. But plenty of other things DO
    // rebuild it while a card is open: pressing Done (saveBulkTenant), the
    // Lease Field Confidence editor in the report expansion, and the Needs
    // Review CTA all call renderBulkResults. Before this change that function
    // reopened only the cards carrying _autoExpand, so any card the manager had
    // opened by hand closed underneath them. Driven through the product's own
    // function rather than asserted from its source, because a mutation run
    // showed the source assertions could not tell the capture apart from the
    // restore.
    H('STEP 2b — an unrelated rebuild does not close the open card');
    const rebuilt = await page.evaluate((n) => {
      const before = document.getElementById('bdet-' + n).style.display;
      renderBulkResults();
      const det = document.getElementById('bdet-' + n);
      const chev = document.getElementById('bchev-' + n);
      // Every OTHER card must stay closed — reopening the whole list would
      // "pass" this check while being a different bug.
      const others = Array.from(document.querySelectorAll('.bulk-tenant-detail'))
        .filter(d => d.id !== 'bdet-' + n && d.style.display === 'block').length;
      return { before, after: det ? det.style.display : null,
               chev: (chev && chev.textContent || '').trim(), othersOpen: others };
    }, i1);
    R('across renderBulkResults()', JSON.stringify(rebuilt));
    eqs('the card was open before the rebuild', rebuilt.before, 'block');
    eqs('and is still open after it', rebuilt.after, 'block');
    yes('with its chevron still reading Close', /Close/.test(rebuilt.chev), rebuilt.chev);
    eqs('and no card the user had closed was reopened', rebuilt.othersOpen, 0);

    const survivedRebuild = await fieldInput(i1, /Leased Sqft/);
    eqs('and the value is still in the input', survivedRebuild && survivedRebuild.value, '4200');

    // ── 3. Correct a value the AI DID extract ───────────────────────────────
    H('STEP 3 — correct an AI-extracted cap from 5 to 6');
    await expandCard(i2);
    const capIn = await fieldInput(i2, /CAM Cap/);
    yes('the CAM Cap input exists', !!capIn, JSON.stringify(capIn));
    eqs('showing the extracted 5', capIn && capIn.value, '5');

    const auditBefore = await page.evaluate(() =>
      ((currentProperty() || {}).activityLog || []).filter(a => a.type === 'field_override').length);

    await page.fill('#' + capIn.id, '6');
    await page.evaluate((id) => { document.getElementById(id).blur(); }, capIn.id);
    await page.waitForTimeout(2000);

    const afterCorrection = await probe('lfe-t2', 'cap');
    R('after correction', JSON.stringify(afterCorrection));
    eqs('the corrected value is on the tenant', afterCorrection.value, '6');
    eqs('provenance is manually_entered, not lease_confirmed', afterCorrection.state, 'manually_entered');
    eqs('the override remembers the AI original', afterCorrection.override &&
        afterCorrection.override.original, '5');
    yes('the correction is reviewer-confirmed',
        !!(afterCorrection.override && afterCorrection.override.confirmed));
    eqs('naming the signed-in user', afterCorrection.by, USER_EMAIL);
    yes('with an ISO-8601 timestamp', ISO_RE.test(afterCorrection.when || ''), afterCorrection.when);
    yes('and it is NOT cited', afterCorrection.cited === false, String(afterCorrection.cited));
    yes('no clause is offered as evidence for the corrected value',
        afterCorrection.quote === null, String(afterCorrection.quote));

    const auditAfter = await page.evaluate(() => {
      const p = currentProperty() || {};
      const log = (p.activityLog || []).filter(a => a.type === 'field_override');
      // logActivity prepends, so "the entry for this edit" is found by its
      // field rather than by position — an assumption about ordering is not
      // worth having when the field key is right there.
      const capRow = log.find(a => /^cap:/.test(String(a.detail || '')));
      return { count: log.length, capRow: capRow || null,
               timeline: (p.timeline || []).filter(e => e.type === 'field_overridden').length };
    });
    R('field_override activity entries', auditAfter.count);
    R('the cap entry', auditAfter.capRow && auditAfter.capRow.detail);
    yes('the correction is recorded in the activity log', auditAfter.count > auditBefore,
        `${auditBefore} → ${auditAfter.count}`);
    yes('naming the field and both values',
        !!(auditAfter.capRow && /"5"/.test(auditAfter.capRow.detail || '') &&
           /"6"/.test(auditAfter.capRow.detail || '')),
        auditAfter.capRow && auditAfter.capRow.detail);
    yes('and the property timeline carries the correction too', auditAfter.timeline > 0,
        String(auditAfter.timeline));

    // ── 4. THE RELOAD ───────────────────────────────────────────────────────
    H('STEP 4 — reload the browser and reopen the property');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await signIn(page, { errors });
    await page.waitForTimeout(1200);
    await openProperty();

    const j1 = await idxOf('lfe-t1');
    const j2 = await idxOf('lfe-t2');
    yes('both leases came back', j1 >= 0 && j2 >= 0, `got ${j1} / ${j2}`);
    await expandCard(j1);
    const sqftAfterReload = await fieldInput(j1, /Leased Sqft/);
    eqs('the input shows the entered value after reload', sqftAfterReload && sqftAfterReload.value, '4200');

    const reloadedGap = await probe('lfe-t1', 'leased_sqft');
    R('reloaded (entered field)', JSON.stringify(reloadedGap));
    eqs('THE VALUE PERSISTS', reloadedGap.value, '4200');
    eqs('THE PROVENANCE PERSISTS as manually_entered', reloadedGap.state, 'manually_entered');
    eqs('the workspace still reads "Manually Entered"', reloadedGap.rwMethod, 'Manually Entered');
    eqs('THE USER IDENTITY PERSISTS', reloadedGap.by, USER_EMAIL);
    yes('THE ISO TIMESTAMP PERSISTS', ISO_RE.test(reloadedGap.when || ''), reloadedGap.when);
    eqs('matching the one written before the reload', reloadedGap.when, afterEntry.when);
    yes('and it still claims no source document', reloadedGap.sourceFile === null,
        String(reloadedGap.sourceFile));
    yes('the override survived the storage round trip',
        !!(reloadedGap.override && reloadedGap.override.confirmed));

    const reloadedCap = await probe('lfe-t2', 'cap');
    R('reloaded (corrected field)', JSON.stringify(reloadedCap));
    eqs('THE CORRECTED VALUE PERSISTS — not the AI original', reloadedCap.value, '6');
    eqs('still manually_entered after reload', reloadedCap.state, 'manually_entered');
    eqs('the AI original is still on file as history',
        reloadedCap.override && reloadedCap.override.original, '5');
    eqs('the reviewer persists', reloadedCap.by, USER_EMAIL);
    yes('the ISO timestamp persists', ISO_RE.test(reloadedCap.when || ''), reloadedCap.when);
    yes('STILL NOT CITED after reload', reloadedCap.cited === false, String(reloadedCap.cited));
    yes('THE ORIGINAL AI EVIDENCE IS NOT PRESENTED AS SUPPORTING THE CORRECTION',
        reloadedCap.quote === null && reloadedCap.page === null,
        `quote=${reloadedCap.quote} page=${reloadedCap.page}`);
    const leaseClaim = await page.evaluate((tid) => {
      const t = (currentProperty().tenants || []).find(x => x && x.id === tid);
      return window.FieldProvenance.isLeaseConfirmed('cap', t);
    }, 'lfe-t2');
    yes('and the field cannot claim the lease document backs it', leaseClaim === false,
        String(leaseClaim));

    // ── 5. The Edit Fields button ───────────────────────────────────────────
    H('STEP 5 — "Edit Fields" from the Review Workspace lands on the input');
    await page.evaluate(() => {
      if (typeof closeTenantDetailPanel === 'function') closeTenantDetailPanel();
      // Collapse the card first, so landing on an already-open card proves nothing.
      const d = document.getElementById('bdet-' + tenantData.findIndex(t => t && t.id === 'lfe-t1'));
      if (d) d.style.display = 'none';
      openReviewWorkspace('lfe-t1');
    });
    await page.waitForTimeout(500);

    const wsOpen = await page.evaluate(() => {
      const w = document.getElementById('reviewWorkspace');
      const b = document.querySelector('#rwActions .rw-btn--edit');
      return { open: !!w && w.classList.contains('open'),
               btn: b ? (b.textContent || '').trim() : null };
    });
    yes('the Review Workspace opened', wsOpen.open);
    eqs('and offers a button labelled Edit Fields', wsOpen.btn, 'Edit Fields');

    await page.click('#rwActions .rw-btn--edit');
    // openReviewItemFix works through two nested setTimeouts (60ms + 90ms).
    await page.waitForTimeout(1200);

    const landed = await page.evaluate(() => {
      const i = tenantData.findIndex(t => t && t.id === 'lfe-t1');
      const det = document.getElementById('bdet-' + i);
      const tdp = document.getElementById('tenantDetailPanel');
      const ws  = document.getElementById('reviewWorkspace');
      const act = document.activeElement;
      const inCard = !!(act && det && det.contains(act));
      return {
        readOnlyPanelOpen: !!(tdp && tdp.classList.contains('open')),
        workspaceClosed:   !(ws && ws.classList.contains('open')),
        cardOpen:          !!(det && det.style.display === 'block'),
        focusedTag:        act ? act.tagName : null,
        focusedInCard:     inCard,
        inputCount:        det ? det.querySelectorAll('input, select').length : 0,
      };
    });
    R('where Edit Fields landed', JSON.stringify(landed));
    yes('it did NOT open the read-only Tenant Detail Panel', !landed.readOnlyPanelOpen,
        'this is the defect: Edit Fields opened a sheet with nothing to type into');
    yes('the Review Workspace closed behind it', landed.workspaceClosed);
    yes('THE LEASE CARD IS OPEN', landed.cardOpen);
    yes('with editable fields in it', landed.inputCount >= 8, String(landed.inputCount));
    yes('and focus is on a control inside that card', landed.focusedInCard,
        `focused <${landed.focusedTag}>`);

    H('Page errors');
    const real = errors.filter(e => !/favicon|supabase-js|net::ERR/i.test(String(e)));
    yes('no uncaught page errors', real.length === 0, real.slice(0, 4).join('\n      → '));

  } catch (e) {
    bad('SUITE THREW', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n      ') : String(e));
    exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') +
    `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail === 0 && exitCode === 0 ? 0 : 1);
})();
