'use strict';
/**
 * test-e2e-partial-basis-persistence.js — a manager's confirmation must survive
 * a reload AS A MANAGER'S CONFIRMATION.
 *
 *   node test-e2e-partial-basis-persistence.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * When a lease says nothing about apportioning a partial year, the
 * reconciliation applies a per-diem DEFAULT and holds the tenant for one
 * confirmation. The manager confirms. Measured on a walkthrough, after a real
 * page reload:
 *
 *     basis      per_diem      <- survived
 *     source     lease         <- WAS 'manual'
 *     confidence "No supporting clause captured — confirm against the lease"
 *
 * The value persisted and its provenance did not, so the manager's own answer
 * came back reading as though the LEASE had stated per-diem. That is precisely
 * the claim this whole flow exists to prevent.
 *
 * FOUR CAUSES, ALL AT THE SAVE BOUNDARY
 *
 *   1. `ms_useNormalizedEvidence` is on and tenant_field_evidence is
 *      authoritative, so the evidence never reached the blob. Nothing wrote the
 *      normalized row either: _persistExtractedEvidence skips any snapshot with
 *      no quote and no page, which is exactly the shape of a manual
 *      confirmation. So the confirmation now writes that row directly.
 *   2. The VALUE went into the property blob, whose write sits behind an 800ms
 *      keystroke debounce — a manager who confirms and navigates leaves it in a
 *      timer. The confirmation flushes it now instead of queueing it.
 *   3. savePropertyData did the Phase-20 strip as it synced tenantData into the
 *      property record, which took the evidence off the IN-MEMORY property too.
 *      The detector reads its tenants from that record, so every save discarded
 *      a confirmation the load had just restored. The strip moved to
 *      _stripBlobs, the boundary both writers already pass through.
 *   4. The two writes are not one transaction, and when they came apart the
 *      value read back null while the evidence read back intact. The basis is
 *      now recoverable from its own evidence row — with the provenance attached,
 *      so it can never come back as the lease's language.
 *
 * This suite drives a REAL reload — a fresh page load reading state back out of
 * storage — because an in-session check passes either way, and did.
 *
 * DETERMINISM
 * Fixed timezone, fixed fixture, own port and localStorage key, no network egress.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';
let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-partial-basis-persistence: playwright is not installed.\x1b[0m');
      console.error('This suite drives a real save and reload in a browser and cannot verify');
      console.error('anything without one. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-partial-basis-persistence SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Confirmation provenance across a reload was NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7975', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(34) + ':', typeof v === 'string' ? v : JSON.stringify(v));

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

const PROP_ID = 'pb-prop-000000000001';
// Two tenants that commence mid-period and say nothing about partial years —
// the state every lease in Pilot is in today. One is confirmed; the other is
// the control that must stay held.
const TENANTS = [
  { id: 'pb-t-anchor', tenant_name: 'Anchor Provisions', leased_sqft: 30000,
    lease_type: 'Triple Net (NNN)', start_date: '2018-01-01', end_date: '2032-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'pb-t-quill',  tenant_name: 'Quill & Press',     leased_sqft: 10000,
    lease_type: 'Triple Net (NNN)', start_date: '2026-04-01', end_date: '2031-03-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'pb-t-rowan',  tenant_name: 'Rowan Threads',     leased_sqft: 10000,
    lease_type: 'Triple Net (NNN)', start_date: '2026-07-01', end_date: '2031-06-30',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
];
const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
// $50,000 across five vendors. The spread is deliberate: at two invoices the
// larger one was 60% of the pool, the concentration detector raised a
// PROPERTY-level red, and every tenant chip read "Blocked · property" — which
// would have hidden the per-tenant confirmation state this suite is about
// behind a finding that has nothing to do with it.
const INVOICES = [
  { id: 'pb-i-01', vendorName: 'Halden Janitorial',  amount: '15000', category: 'janitorial',  invoiceDate: '2026-02-01', camEligible: true, ...doc('hal') },
  { id: 'pb-i-02', vendorName: 'Ivory Insurance',    amount: '12000', category: 'insurance',   invoiceDate: '2026-01-10', camEligible: true, ...doc('ivo') },
  { id: 'pb-i-03', vendorName: 'Marlow Landscaping', amount: '10000', category: 'landscaping', invoiceDate: '2026-05-04', camEligible: true, ...doc('mar') },
  { id: 'pb-i-04', vendorName: 'Prentice Security',  amount:  '8000', category: 'security',    invoiceDate: '2026-08-12', camEligible: true, ...doc('pre') },
  { id: 'pb-i-05', vendorName: 'Voss Utilities',     amount:  '5000', category: 'utilities',   invoiceDate: '2026-11-02', camEligible: true, ...doc('vos') },
];

// The mock stores rows per table and persists to localStorage, so a genuine page
// reload reads back what the app actually wrote. `select()` clears the
// last-inserted row so a read returns the whole table rather than the last
// write — without that, tenant_field_evidence reads would answer with one row
// and the reload assertions would pass for the wrong reason.
const SUPABASE_MOCK = `
(function () {
  var USER_ID='pb-user', _user={id:USER_ID,email:'pb@e2e-test.local'}, _session=null, KEY='__pb_store';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Pemberton Walk',sqft:50000,
    data:{invoices:${JSON.stringify(INVOICES)},disputes:[],camYear:2026,results:null,camReconciliation:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(TENANTS)}}}],tenants:[]};
  function load(){try{var r=localStorage.getItem(KEY);if(r)return JSON.parse(r);}catch(e){}return JSON.parse(JSON.stringify(seed));}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(_store));}catch(e){}}
  var _store=load(); window.__store=function(){return _store;};
  function res(d){return Promise.resolve({data:d,error:null});} var _seq=0;
  function table(name){var rows=_store[name]||(_store[name]=[]);var last=null;var api={
    select:function(){last=null;return api;},eq:function(){return api;},not:function(){return api;},
    is:function(){return api;},in:function(){return api;},order:function(){return api;},limit:function(){return api;},
    maybeSingle:function(){return res(last||rows[0]||null);},single:function(){return res(last||rows[0]||null);},
    insert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);rows.push(row);return row;});last=a[0];persist();return api;},
    upsert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);var i=rows.findIndex(function(x){return x.id===row.id;});if(i>=0){rows[i]=Object.assign({},rows[i],row);persist();return rows[i];}rows.push(row);return row;});last=a[0];persist();return api;},
    update:function(v){rows.forEach(function(r){Object.assign(r,JSON.parse(JSON.stringify(v)));});last=rows[0];persist();return api;},
    delete:function(){return api;},
    then:function(f){return Promise.resolve({data:last?[last]:rows,error:null}).then(f);}};return api;}
  window.supabase = { createClient: function () { return {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: _session }, error: null }); },
      getUser:    function () { return Promise.resolve({ data: { user: _session ? _user : null }, error: null }); },
      signInWithPassword: function () { _session={access_token:'mock',user:_user};
        return Promise.resolve({ data: { session:_session, user:_user }, error: null }); },
      signUp:  function () { return Promise.resolve({ data: { user: _user }, error: null }); },
      signOut: function () { _session=null; return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    },
    from: table,
    storage: { from: function () { return { upload: function(){return res({path:'m'});},
      createSignedUrl: function(){return res({signedUrl:'https://mock.local/x'});} }; } },
  }; } };
})();
`;

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    return route.abort();
  });
  await ctx.addInitScript(SUPABASE_MOCK);

  const signInAndRun = async () => {
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
    await page.fill('#loginEmail', 'pb@e2e-test.local');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginBtn');
    await page.waitForFunction(() => { const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== ''; }, { timeout: 20000 });
    await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, { timeout: 20000 });
    await page.evaluate((id) => selectProperty(id), PROP_ID);
    await page.waitForFunction(() => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === 3,
                               { timeout: 20000 });
    await page.evaluate(async () => { await runAllocation(); });
    await page.waitForFunction(() => typeof lastResults !== 'undefined' && lastResults.length === 3, { timeout: 25000 });
  };

  const readState = (name) => page.evaluate((n) => {
    const t = tenantData.find(x => x && x.tenant_name === n);
    const AX = window.AuditExposure;
    const expo = AX.deriveExposure(buildAuditSummary(), lastTotal || 0);
    const snaps = ((t.fieldEvidence || {}).partial_period_basis || {}).snapshots || [];
    return {
      basis: t.partial_period_basis,
      // What the reader RESOLVES to, which is not the same question as what is
      // on the record: when the blob copy is lost the field is legitimately
      // empty and the answer comes back off the evidence row.
      resolved: window.LeasePeriod.partialPeriodBasis(t).basis,
      source: window.LeasePeriod.partialPeriodBasis(t).source,
      stated: window.LeasePeriod.partialPeriodBasis(t).stated,
      confidence: getFieldConfidence('partial_period_basis', t),
      snapshots: snaps.map(s => ({ manual: s.manuallyEdited, value: s.value })),
      chip: _tenantBillingState(n, expo).label,
      held: buildAuditSummary().yellow.some(f => /partial year is apportioned/.test(f.title || '')
                                                && new RegExp(n).test(f.title)),
      allocated: (lastResults.find(r => r.name === n) || {}).totalAllocated,
    };
  }, name);

  console.log('\n══ A confirmation survives a reload as a confirmation ══');

  await signInAndRun();

  console.log('\n── Before: the lease says nothing ──');
  const before = await readState('Quill & Press');
  R('basis', before.basis);
  R('source', before.source);
  R('confidence', before.confidence);
  R('chip', before.chip);
  yes('the field is empty — silence recorded as silence', before.basis === null, JSON.stringify(before));
  yes('the basis reads as the product default', before.source === 'default' && before.stated === false,
      JSON.stringify(before));
  yes('and the tenant is held', before.held === true && before.chip === 'Needs confirmation',
      JSON.stringify(before));

  console.log('\n── The manager confirms, and the write is awaited ──');
  const confirmed = await page.evaluate(async (PID) => {
    const t = tenantData.find(x => x.tenant_name === 'Quill & Press');
    const okc = await confirmPartialPeriodBasis(t.id, 'per_diem');
    const st = window.__store();
    const row = (st.properties || []).find(p => p.id === PID) || {};
    const stored = (((row.data || {}).tenants) || []).find(x => x && x.id === t.id) || {};
    return { okc, storedBasis: stored.partial_period_basis ?? null,
      evidenceRows: (st.tenant_field_evidence || []).map(r => ({
        field: r.field_key, tenant: r.tenant_id, value: r.value,
        manual: r.manually_edited, status: r.confidence_status })) };
  }, PROP_ID);
  R('returned', confirmed.okc);
  R('rows written', confirmed.evidenceRows);
  yes('the confirmation reports success', confirmed.okc === true, JSON.stringify(confirmed));
  yes('THE DURABLE WRITE HAPPENED — a row reached tenant_field_evidence',
      confirmed.evidenceRows.some(r => r.field === 'partial_period_basis'),
      'the confirmation lives only in the blob, which savePropertyData strips');
  yes('    and it is marked as manually edited',
      confirmed.evidenceRows.some(r => r.field === 'partial_period_basis' && r.manual === true),
      JSON.stringify(confirmed.evidenceRows));
  // The other half of the write, and the one that is easiest to lose: the value
  // on the tenant record travels in the property blob, which savePropertyData
  // queues behind an 800ms keystroke debounce. A manager who confirms and
  // navigates leaves that write in a timer. It has to be on disk when this
  // call returns, not merely scheduled.
  yes('    and the blob write was flushed, not left on the debounce',
      confirmed.storedBasis === 'per_diem',
      `stored basis is ${JSON.stringify(confirmed.storedBasis)} — the write was still queued when the check ran`);

  console.log('\n── A REAL RELOAD ──');
  await signInAndRun();
  const after = await readState('Quill & Press');
  R('basis', after.basis);
  R('source', after.source);
  R('confidence', after.confidence);
  R('snapshots', after.snapshots);
  R('chip', after.chip);

  yes('the value survived', after.basis === 'per_diem', JSON.stringify(after));
  yes('THE PROVENANCE SURVIVED — source is manual, not lease',
      after.source === 'manual',
      `source came back as "${after.source}" — a manager's confirmation is reading as the lease's own language`);
  yes('    the evidence snapshot came back marked manual',
      after.snapshots.some(s => s.manual === true), JSON.stringify(after.snapshots));
  yes('    and the confidence surface agrees',
      after.confidence.status === 'manual' && after.confidence.source === 'manual',
      JSON.stringify(after.confidence));
  yes('    it never reads as lease-confirmed',
      after.confidence.source !== 'structured' && !/lease document/i.test(after.confidence.note || ''),
      JSON.stringify(after.confidence));

  console.log('\n── And the next reconciliation stays confirmed ──');
  yes('the hold does not come back', after.held === false && after.chip === 'Billable · part period',
      JSON.stringify({ held: after.held, chip: after.chip }));
  yes('the amount is unchanged by the reload',
      Math.abs(after.allocated - before.allocated) < 0.005,
      JSON.stringify({ before: before.allocated, after: after.allocated }));

  // THE TWO WRITES ARE NOT ONE TRANSACTION.
  //
  // A confirmation lands in two places — an evidence row, written immediately,
  // and the value on the tenant record, which travels in the property blob. They
  // can come apart: the blob write can fail, be skipped (savePropertyData
  // returns early when activePropId is null), or be superseded by an older
  // in-memory copy. When that happened the value came back null while the
  // evidence row came back intact, and the manager was asked to confirm
  // something they had already confirmed.
  //
  // So: keep the evidence row, take the blob value away, and reload. The answer
  // has to come back — and come back as the MANAGER'S, not the lease's.
  console.log('\n── The blob write is lost; the evidence row is not ──');
  await page.evaluate((PID) => {
    const KEY = '__pb_store';
    const st = JSON.parse(localStorage.getItem(KEY));
    const prop = st.properties.find(p => p.id === PID);
    const t = prop.data.tenants.find(x => x.id === 'pb-t-quill');
    delete t.partial_period_basis;
    localStorage.setItem(KEY, JSON.stringify(st));
  }, PROP_ID);
  await signInAndRun();
  const recovered = await readState('Quill & Press');
  R('basis', recovered.basis);
  R('source', recovered.source);
  R('chip', recovered.chip);
  yes('the confirmation is read back off the evidence row',
      recovered.basis == null && recovered.resolved === 'per_diem' && recovered.stated === true,
      JSON.stringify(recovered));
  yes('    still as the manager\'s answer, not the lease\'s',
      recovered.source === 'manual', JSON.stringify(recovered));
  yes('    and the tenant is not asked a second time',
      recovered.held === false && recovered.chip === 'Billable · part period',
      JSON.stringify({ held: recovered.held, chip: recovered.chip }));
  yes('    on the same dollars',
      Math.abs(recovered.allocated - before.allocated) < 0.005,
      JSON.stringify({ before: before.allocated, recovered: recovered.allocated }));

  console.log('\n── The control: the OTHER silent lease is still held ──');
  const rowan = await readState('Rowan Threads');
  R('Rowan Threads', { basis: rowan.basis, source: rowan.source, chip: rowan.chip, held: rowan.held });
  yes('confirming one lease did not confirm another',
      rowan.basis === null && rowan.source === 'default' && rowan.held === true,
      JSON.stringify(rowan));

  console.log('\n── Console ──');
  yes('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n' + '─'.repeat(58));
  if (fail) console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  else      console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n\x1b[31mtest-e2e-partial-basis-persistence crashed:\x1b[0m', e && e.stack || e);
  process.exit(1);
});
