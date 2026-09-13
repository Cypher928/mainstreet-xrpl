'use strict';
/**
 * test-e2e-evidence-quote.js — the clause survives the save that used to eat it.
 *
 *   node test-e2e-evidence-quote.js
 *
 * THE DEFECT THIS EXISTS TO HOLD DOWN.
 *
 * Lease extraction returns a verbatim clause for every field it reads, and
 * normalizeTenant already wrote it into a fieldEvidence snapshot. Two steps then
 * destroyed it, in order:
 *
 *   1. savePropertyData -> _stripBlobs deletes fieldEvidence from the property
 *      blob, because ms_useNormalizedEvidence is true and tenant_field_evidence
 *      is authoritative.
 *   2. _writeTenantFieldEvidence's payload had fifteen fields and no quote,
 *      because the table had no column for one.
 *
 * The irony is exact: _persistExtractedEvidence writes a row ONLY when the
 * snapshot carries a quote or a page (script.js:5038) — the quote is the reason
 * the row exists, and it was the one thing the row could not keep. Measured on
 * pilot: all three tenants with an admin_fee_pct have an evidence row and no
 * fieldEvidence at all, so the clause behind every management-fee cap in the
 * dataset is gone and cannot be recovered without re-extracting the document.
 *
 * Migration 019 adds the nullable column; this drives the real writer and the
 * real reader through a save and a reload and asserts the round trip, including
 * that a pre-019 row with no quote still reads back as null rather than
 * breaking or inventing one.
 *
 * WHAT IT DOES NOT DO. Nothing here asserts anything about billing. D2-2 — a
 * management-fee cap breach holding a tenant statement — is deliberately not
 * implemented; test-e2e-mgmt-fee-cap.js still pins that a breach changes no
 * allocation, no audit finding and no billing verdict.
 *
 * DETERMINISM
 * Fixed timezone, fixed fixture, own port and localStorage key, no egress. The
 * mock store is seeded ONCE and persists across the reload.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';
let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-evidence-quote: playwright is not installed.\x1b[0m\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-evidence-quote SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Whether the extracted clause survives a save was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7993', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(44) + ':', typeof v === 'string' ? v : JSON.stringify(v));
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const p = path.join(ROOT, req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]);
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

const PROP_ID = 'eq-prop-000000000001';
const CLAUSE  = 'Administrative fee shall not exceed fifteen percent (15%) of controllable expenses, exclusive of such fee.';

// Two tenants, and the difference between them is the whole point.
//   Fairweather — extracted WITH a clause and a basis: the post-019 world.
//   Legacy Tools — a cap and nothing behind it: every pilot record today.
const TENANTS = [
  { id: 'eq-t-fair', tenant_name: 'Fairweather Books', unitNumber: '101', leased_sqft: 10000,
    admin_fee_pct: '15', admin_fee_basis: 'controllable_expenses',
    fieldEvidence: { admin_fee_basis: { snapshots: [{
      fieldKey: 'admin_fee_basis', value: 'controllable_expenses',
      confidence: { status: 'estimated', note: 'AI-extracted' },
      sourceFile: 'fairweather-lease.pdf', page: null, quote: CLAUSE,
      approved: false, manuallyEdited: false, reviewedAt: '2026-01-02T00:00:00.000Z',
    }] } } },
  { id: 'eq-t-legacy', tenant_name: 'Legacy Tools', unitNumber: '102', leased_sqft: 10000,
    admin_fee_pct: '15' },
].map(t => ({ ...t, lease_type: 'Triple Net (NNN)', start_date: '2018-01-01', end_date: '2033-12-31',
  cap: '', capBaseAmount: '', excluded_categories: '', audit_rights: true, status: 'complete' }));

const INVOICES = [
  { id: 'eq-i-1', vendorName: 'Cascade Property Management', amount: '10000', category: 'management',
    invoiceDate: '2025-03-31', camEligible: true, fileName: 'm.pdf', fileUrl: 'https://mock.local/m.pdf' },
  { id: 'eq-i-2', vendorName: 'CleanSpace Commercial', amount: '40000', category: 'janitorial',
    invoiceDate: '2025-06-30', camEligible: true, fileName: 'j.pdf', fileUrl: 'https://mock.local/j.pdf' },
];

// The mock DB stores whatever column the app sends, so a `quote` field in the
// payload lands in the row exactly as migration 019 makes it land in Postgres.
// A pre-019 row is modelled by simply not having the key.
const MOCK = `
(function () {
  var USER_ID='eq-user', _user={id:USER_ID,email:'eq@e2e-test.local'}, _session=null;
  var KEY='__eq_store', BOOT='__eq_booted';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Quote Court',sqft:20000,
    data:{invoices:${JSON.stringify(INVOICES)},disputes:[],camYear:2025,results:null,camReconciliation:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(TENANTS)}}}],
    tenants:[],
    tenant_field_evidence:[
      // A PRE-019 ROW: written before the column existed, so it has no quote key
      // at all. It must read back as quote:null, not undefined-shaped breakage.
      { id:'pre019', property_id:${JSON.stringify(PROP_ID)}, tenant_id:'eq-t-legacy',
        field_key:'admin_fee_pct', value:'15', confidence_status:'estimated',
        confidence_note:'AI-extracted', source_file:null, source_page:null,
        approved:false, manually_edited:false, original_extracted_value:null,
        reviewed_at:'2025-01-01T00:00:00.000Z' }
    ]};
  try {
    if (!localStorage.getItem(BOOT)) { localStorage.removeItem(KEY); localStorage.setItem(BOOT,'1'); }
  } catch (e) {}
  function load(){try{var r=localStorage.getItem(KEY);if(r)return JSON.parse(r);}catch(e){}return JSON.parse(JSON.stringify(seed));}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(_store));}catch(e){}}
  var _store=load(); window.__store=function(){return _store;};
  function res(d){return Promise.resolve({data:d,error:null});} var _seq=0;
  function table(name){var rows=_store[name]||(_store[name]=[]);var last=null;var filters=[];var api={
    sel:function(){return rows.filter(function(r){return filters.every(function(f){return String(r[f[0]])===String(f[1]);});});},
    select:function(){last=null;return api;},eq:function(c,v){filters.push([c,v]);return api;},not:function(){return api;},
    is:function(){return api;},in:function(){return api;},order:function(){return api;},limit:function(){return api;},
    maybeSingle:function(){return res(last||api.sel()[0]||null);},single:function(){return res(last||api.sel()[0]||null);},
    insert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);rows.push(row);return row;});last=a[0];persist();return api;},
    upsert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);var i=rows.findIndex(function(x){return x.id===row.id;});if(i>=0){rows[i]=Object.assign({},rows[i],row);persist();return rows[i];}rows.push(row);return row;});last=a[0];persist();return api;},
    update:function(v){api.sel().forEach(function(r){Object.assign(r,JSON.parse(JSON.stringify(v)));});last=api.sel()[0];persist();return api;},
    delete:function(){return api;},
    then:function(f){return Promise.resolve({data:last?[last]:api.sel(),error:null}).then(f);}};return api;}
  window.supabase = { createClient: function () { return {
    auth: { getSession:function(){return Promise.resolve({data:{session:_session},error:null});},
      getUser:function(){return Promise.resolve({data:{user:_session?_user:null},error:null});},
      signInWithPassword:function(){_session={access_token:'mock',user:_user};return Promise.resolve({data:{session:_session,user:_user},error:null});},
      signUp:function(){return Promise.resolve({data:{user:_user},error:null});},
      signOut:function(){_session=null;return Promise.resolve({error:null});},
      onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};} },
    from: table,
    storage:{from:function(){return {upload:function(){return res({path:'m'});},createSignedUrl:function(){return res({signedUrl:'https://mock.local/x'});}};}},
  }; } };
})();
`;

const READ = () => {
  const t = (name) => (tenantData || []).filter(Boolean).find(x => x.tenant_name === name) || null;
  const basis = (name) => { const x = t(name); return x ? window.LeasePeriod.adminFeeBasis(x) : null; };
  const rows = () => ((window.__store().tenant_field_evidence) || []).map(r => ({
    tenant: r.tenant_id, field: r.field_key, value: r.value,
    // `in` rather than a truthiness check: a pre-019 row has NO key, a post-019
    // row with a manual confirmation has the key set to null, and the two are
    // different facts about the same column.
    hasQuoteKey: Object.prototype.hasOwnProperty.call(r, 'quote'),
    quote: r.quote === undefined ? '(absent)' : r.quote,
    manual: r.manually_edited === true,
  }));
  return {
    fairBasis:   basis('Fairweather Books'),
    legacyBasis: basis('Legacy Tools'),
    fairPct:     (t('Fairweather Books') || {}).admin_fee_pct,
    legacyPct:   (t('Legacy Tools') || {}).admin_fee_pct,
    rows: rows(),
    // The snapshot shape the app reconstructs from a row — the path the
    // Evidence Viewer and _tier1LeaseChecks both read.
    rebuilt: (() => {
      const r = ((window.__store().tenant_field_evidence) || [])
        .find(x => x.tenant_id === 'eq-t-legacy' && x.field_key === 'admin_fee_pct');
      return r && typeof _evidenceRowToSnapshot === 'function'
        ? (() => { const s = _evidenceRowToSnapshot(r); return { quote: s.quote, value: s.value }; })()
        : null;
    })(),
    allocations: Object.fromEntries((lastResults || []).map(x => [x.name, x.totalAllocated])),
  };
};

async function boot(browser) {
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    return route.abort();
  });
  await ctx.addInitScript(MOCK);
  return { ctx, page, errors };
}
async function open(page, email) {
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await _e2eSignIn(page, { email });
  await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
  await page.evaluate(id => selectProperty(id), PROP_ID);
  await page.waitForFunction(n => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === n,
                             TENANTS.length, { timeout: 45000 });
}

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const { ctx, page, errors } = await boot(browser);

  console.log('\n══ An extracted clause has to survive being saved ══');
  try {
    await open(page, 'eq@e2e-test.local');
    await page.evaluate(async () => { await runAllocation(); });
    await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 2,
                               null, { timeout: 60000 });
    const before = await page.evaluate(READ);

    H('The extracted basis resolves as lease-stated');
    R('Fairweather basis', before.fairBasis);
    R('Legacy basis', before.legacyBasis);
    yes('an extracted basis reads source "lease" and stated true',
        before.fairBasis && before.fairBasis.source === 'lease' && before.fairBasis.stated === true,
        JSON.stringify(before.fairBasis));
    yes('a record with no basis reads "default" and NOT stated',
        before.legacyBasis && before.legacyBasis.source === 'default'
          && before.legacyBasis.stated === false,
        JSON.stringify(before.legacyBasis));
    yes('    and its percentage is untouched — 15 either way',
        before.fairPct === '15' && before.legacyPct === '15',
        JSON.stringify([before.fairPct, before.legacyPct]));

    H('A pre-019 row reads back as quote: null');
    R('rebuilt from the legacy row', before.rebuilt);
    yes('_evidenceRowToSnapshot returns null, not undefined or a crash',
        before.rebuilt && before.rebuilt.quote === null, JSON.stringify(before.rebuilt));
    yes('    and the value still comes through',
        before.rebuilt && before.rebuilt.value === '15', JSON.stringify(before.rebuilt));

    // ── The write, and the reload ───────────────────────────────────────────
    H('A manual confirmation, saved and then reloaded');
    // THE EXTRACTION -> NORMALIZED-TABLE HOP, which is where the clause used to
    // die. _persistExtractedEvidence is the real function that carries a
    // fieldEvidence snapshot to tenant_field_evidence, and it writes a row ONLY
    // when the snapshot has a quote or a page (script.js:5038). It runs during
    // extraction; the fixture seeds the snapshot extraction would have produced
    // and then drives the same function, so what is asserted below is the
    // product's own writer and not a stand-in for it.
    const _written = await page.evaluate(() => {
      const t = tenantData.filter(Boolean).find(x => x.tenant_name === 'Fairweather Books');
      return _persistExtractedEvidence(currentProperty().id, t.id, t.fieldEvidence);
    });
    R('rows written by _persistExtractedEvidence', _written);
    yes('the extracted snapshot qualified for persistence — it has a quote',
        _written >= 1, 'nothing was written: the quote/page guard rejected it');

    // THE REAL CONFIRM PATH, and a pre-existing defect it walks into.
    //
    // saveFieldOverride references a bare `user` at script.js:7704 that the
    // function never declares — `user?.email` does NOT protect an undeclared
    // identifier, it throws ReferenceError. Present at HEAD before any of this
    // work; verified by extracting the same function from git HEAD.
    //
    // The throw lands AFTER persistFieldEvidence and savePropertyData and
    // before renderBulkResults, so the write completes and the UI refresh and
    // success toast are lost — a manager corrects a field, the value is stored,
    // and the screen says nothing. Recorded, NOT fixed: it is outside this
    // change. Caught here so the assertions below still exercise the real
    // writer rather than a hand-rolled stand-in for it.
    const _overrideThrew = await page.evaluate(() => {
      const t = tenantData.filter(Boolean).find(x => x.tenant_name === 'Legacy Tools');
      try { saveFieldOverride(t.id, 'admin_fee_basis', 'excluding_management_fee'); return null; }
      catch (e) { return String(e && e.message || e); }
    });
    R('saveFieldOverride threw (pre-existing)', _overrideThrew || '(no)');
    yes('the known defect is still exactly the one recorded, and no other',
        _overrideThrew === null || /user is not defined/.test(_overrideThrew),
        'saveFieldOverride failed for a different reason: ' + _overrideThrew);
    await page.evaluate(async () => { const p = currentProperty(); savePropertyData(); await saveProperty(p); });
    const saved = await page.evaluate(READ);
    const savedRow = saved.rows.find(r => r.tenant === 'eq-t-legacy' && r.field === 'admin_fee_basis');
    R('the confirmation row', savedRow);
    yes('the confirmation reached the normalized table',
        !!savedRow && savedRow.value === 'excluding_management_fee' && savedRow.manual === true,
        JSON.stringify(savedRow));
    yes('    and it carries the quote column, set to null — a person is not a clause',
        !!savedRow && savedRow.hasQuoteKey === true && savedRow.quote === null,
        JSON.stringify(savedRow));

    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await open(page, 'eq@e2e-test.local');
    const after = await page.evaluate(READ);

    H('After a real reload');
    R('Fairweather basis', after.fairBasis);
    R('Legacy basis', after.legacyBasis);
    yes('THE MANUAL CONFIRMATION SURVIVED',
        after.legacyBasis && after.legacyBasis.value === 'excluding_management_fee'
          && after.legacyBasis.stated === true,
        JSON.stringify(after.legacyBasis));
    yes('    and it reads "manual" — never promoted to a lease citation',
        after.legacyBasis && after.legacyBasis.source === 'manual',
        JSON.stringify(after.legacyBasis));
    yes('the extracted basis survived the reload too',
        after.fairBasis && after.fairBasis.value === 'controllable_expenses'
          && after.fairBasis.source === 'lease',
        JSON.stringify(after.fairBasis));

    H('The clause itself reached storage');
    const qRows = after.rows.filter(r => r.quote && r.quote !== '(absent)');
    R('rows carrying a clause', qRows.map(r => [r.tenant, r.field, String(r.quote).slice(0, 40) + '…']));
    yes('at least one evidence row carries the verbatim clause',
        qRows.length >= 1, JSON.stringify(after.rows));
    yes('    and it is the clause, not a truncation to nothing',
        qRows.some(r => String(r.quote).includes('controllable expenses')),
        JSON.stringify(qRows.map(r => r.quote)));

    H('Nothing about the money changed');
    R('allocations', after.allocations);
    yes('allocations are identical before and after',
        JSON.stringify(after.allocations) === JSON.stringify(before.allocations),
        'before: ' + JSON.stringify(before.allocations) + '\n      → after: ' + JSON.stringify(after.allocations));

    H('Page errors');
    R('errors', errors.length ? errors : '(none)');
    yes('no uncaught page errors', errors.length === 0, errors.join(' | '));

  } catch (e) {
    bad('suite crashed', e && e.stack ? e.stack : String(e));
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
  }

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})();
