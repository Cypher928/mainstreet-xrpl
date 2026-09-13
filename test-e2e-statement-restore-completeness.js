'use strict';
/**
 * test-e2e-statement-restore-completeness.js — what a saved reconciliation gives
 * back, and whose name is on each charge.
 *
 *   node test-e2e-statement-restore-completeness.js
 *
 * N1 — EVERY CHARGE ON EVERY TENANT STATEMENT HAD A BLANK VENDOR.
 *
 * The charge rows rendered `inv.vendor`. The engine's Invoice objects do not
 * have that field — the constructor sets `vendorName`. So a tenant received a
 * statement listing amounts against nobody: measured 17 of 17 rows across four
 * tenants. The RESULTS CARD was unaffected because it reads `vendorName`, which
 * is why this survived. A statement whose charges name no vendor cannot be
 * audited by the person paying it.
 *
 * N2 — REOPENING A SAVED RECONCILIATION DROPPED THE WHOLE BREAKDOWN.
 *
 * Measured on Northgate Exchange: 36,103 rendered characters became 3,610, six
 * "View invoice breakdown" buttons became zero, 49 charge-detail panels became
 * zero. Every charge-level fact — vendor, invoice total, tenant share, and the
 * equation P5 prints — disappeared behind an unchanged dollar figure.
 *
 * IT WAS NOT DATA LOSS, AND THAT MATTERS. `includedInvoices` restores intact:
 * [6,5,5,5] with identical totals. The restored card is simply a second, thinner
 * renderer that never emitted a breakdown. Marking such a snapshot "reduced
 * fidelity" would have been a false statement about complete data, and would
 * have told a manager to re-run something that needs no re-running.
 *
 * So the fix is one shared builder, and the reduced-fidelity disclosure is
 * reserved for the case that genuinely has no detail — a record rebuilt from
 * cam_reconciliations rows, where `includedInvoices` is [] by construction.
 *
 * WHAT THIS SUITE REFUSES TO ALLOW
 *
 *   · a charge row that names no vendor, or names the wrong field
 *   · a restored card that hides a breakdown it holds
 *   · a restored card that INVENTS a breakdown it does not hold
 *   · an absent breakdown with no explanation
 *   · any figure moving by a cent across a save and reload
 *   · runFullReconciliation running during a restore
 *
 * DETERMINISM
 * Fixed timezone, fixed fixture, own port and localStorage key, no egress.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';
let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-statement-restore-completeness: playwright is not installed.\x1b[0m');
      console.error('This suite reads a rendered statement and a rendered restore out of a real');
      console.error('DOM. Install playwright, or set SKIP_BROWSER_TESTS=1.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-statement-restore-completeness SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  Vendor names on statements and breakdown survival on restore were NOT verified.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const { signIn: _e2eSignIn, attachDiagnostics } = require('./test-support/e2e-login');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7973', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(40) + ':', typeof v === 'string' ? v : JSON.stringify(v));

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

// ── The fixture ─────────────────────────────────────────────────────────────
//
// 40,000 sqft, CAM 2025, three tenants, every lease full-period and every date
// readable, so all three statements issue and nothing unrelated competes for the
// billing gate. Five invoices with five DISTINCT vendor names — the point of N1
// is that each name reaches the row it belongs to.
const PROP_ID    = 'sr-prop-000000000001';
const CAM_YEAR   = 2025;
const TOTAL_SQFT = 40000;

const TENANTS = [
  { id: 'sr-t-alder', tenant_name: 'Alder Bakery', unitNumber: '210',
    leased_sqft: 20000, lease_type: 'Triple Net (NNN)',
    start_date: '2018-01-01', end_date: '2033-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'sr-t-birch', tenant_name: 'Birch Optical', unitNumber: '214',
    leased_sqft: 12000, lease_type: 'Triple Net (NNN)',
    start_date: '2018-01-01', end_date: '2033-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
  { id: 'sr-t-cedar', tenant_name: 'Cedar Fitness', unitNumber: '320',
    leased_sqft: 8000, lease_type: 'Triple Net (NNN)',
    start_date: '2018-01-01', end_date: '2033-12-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },
];

const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
const INVOICES = [
  { id: 'sr-i-1', vendorName: 'Halloway Janitorial', amount: '12000', category: 'janitorial',
    invoiceDate: '2025-03-05', camEligible: true, ...doc('hal') },
  { id: 'sr-i-2', vendorName: 'Prosper Insurance',   amount:  '9000', category: 'insurance',
    invoiceDate: '2025-06-01', camEligible: true, ...doc('pro') },
  { id: 'sr-i-3', vendorName: 'Meriden Utilities',   amount:  '6000', category: 'utilities',
    invoiceDate: '2025-10-20', camEligible: true, ...doc('mer') },
  { id: 'sr-i-4', vendorName: 'Ashgrove Security',   amount:  '4000', category: 'security',
    invoiceDate: '2025-11-02', camEligible: true, ...doc('ash') },
  { id: 'sr-i-5', vendorName: 'Kirkwall Landscaping', amount: '3000', category: 'landscaping',
    invoiceDate: '2025-05-18', camEligible: true, ...doc('kir') },
];
// NOTE ON THE FALLBACK THAT CANNOT BE REACHED FROM HERE. An invoice with no
// vendorName never becomes a charge row at all: runAllocation filters on
// `inv.vendorName` before the engine sees it, so the product refuses to bill a
// nameless invoice upstream of this rendering. Adding one to this fixture
// therefore proves nothing — it simply never appears. The guarantee that the row
// consults no OTHER field is asserted at source instead, below.
const VENDORS = INVOICES.map(i => i.vendorName).filter(Boolean);
// Fields no charge row may ever fall back to. A statement that prints a category
// or a filename where a vendor belongs is worse than one that prints nothing:
// it looks correct.
const NOT_VENDORS = INVOICES.map(i => i.category).concat(INVOICES.map(i => i.fileName));

// `reduced` seeds a stored reconciliation shaped like the cam_reconciliations
// rebuild: amounts and shares as billed, and NO per-invoice detail at all.
const mockFor = (opts) => {
  const o = opts || {};
  const reduced = o.reduced ? `,
      camReconciliation: {
        propId: ${JSON.stringify(PROP_ID)}, propName: 'Marlow Court', camYear: ${CAM_YEAR},
        total: 34000, fidelity: 'reduced', rebuiltFrom: 'cam_reconciliations',
        fidelityReasons: ['The per-invoice breakdown was not stored on these rows.'],
        results: [
          { name: 'Alder Bakery',  allocatedAmount: 17000, totalAllocated: 17000, proRataPercent: 50, proRata: 0.5,
            eligibleCount: 5, capApplied: null, capAdjustment: null, includedInvoices: [], ambiguityFlags: [] },
          { name: 'Birch Optical', allocatedAmount: 10200, totalAllocated: 10200, proRataPercent: 30, proRata: 0.3,
            eligibleCount: 5, capApplied: null, capAdjustment: null, includedInvoices: [], ambiguityFlags: [] },
          { name: 'Cedar Fitness', allocatedAmount: 6800,  totalAllocated: 6800,  proRataPercent: 20, proRata: 0.2,
            eligibleCount: 5, capApplied: null, capAdjustment: null, includedInvoices: [], ambiguityFlags: [] }
        ],
        invoices: [], invoicesFull: [], tenants: []
      }` : '';
  return `
(function () {
  var USER_ID='sr-user', _user={id:USER_ID,email:'sr@e2e-test.local'}, _session=null, KEY=${JSON.stringify('__sr_store_' + (o.reduced ? 'reduced' : 'full'))};
  // runFullReconciliation announces itself on the console. Counting that is how
  // this suite proves a RESTORE did not quietly re-run the engine — no patching
  // of app globals, just the signal the engine already emits.
  window.__rfrCalls = 0;
  var _cl = console.log;
  console.log = function () {
    try { if (String(arguments[0]).indexOf('[runFullReconciliation] ENTER') === 0) window.__rfrCalls++; } catch (e) {}
    return _cl.apply(console, arguments);
  };
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Marlow Court',sqft:${TOTAL_SQFT},
    data:{invoices:${JSON.stringify(INVOICES)},disputes:[],camYear:${CAM_YEAR},results:null,
          activityLog:[],timeline:[],escrowReserves:[],drawRequests:[],tenants:${JSON.stringify(TENANTS)}${reduced}}}],tenants:[]};
  function load(){try{var r=localStorage.getItem(KEY);if(r)return JSON.parse(r);}catch(e){}return JSON.parse(JSON.stringify(seed));}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(_store));}catch(e){}}
  var _store=load(); window.__store=function(){return _store;};
  function res(d){return Promise.resolve({data:d,error:null});} var _seq=0;
  function table(name){var rows=_store[name]||(_store[name]=[]);var last=null;var filters=[];var api={
    sel:function(){return rows.filter(function(r){return filters.every(function(f){
      return String(r[f[0]])===String(f[1]);});});},
    select:function(){last=null;return api;},
    eq:function(c,v){filters.push([c,v]);return api;},not:function(){return api;},
    is:function(){return api;},in:function(){return api;},order:function(){return api;},limit:function(){return api;},
    maybeSingle:function(){return res(last||api.sel()[0]||null);},single:function(){return res(last||api.sel()[0]||null);},
    insert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);rows.push(row);return row;});last=a[0];persist();return api;},
    upsert:function(v){var a=[].concat(v).map(function(r){var row=JSON.parse(JSON.stringify(r));if(!row.id)row.id='m-'+name+'-'+(++_seq);var i=rows.findIndex(function(x){return x.id===row.id;});if(i>=0){rows[i]=Object.assign({},rows[i],row);persist();return rows[i];}rows.push(row);return row;});last=a[0];persist();return api;},
    update:function(v){api.sel().forEach(function(r){Object.assign(r,JSON.parse(JSON.stringify(v)));});last=api.sel()[0];persist();return api;},
    delete:function(){return api;},
    then:function(f){return Promise.resolve({data:last?[last]:api.sel(),error:null}).then(f);}};return api;}
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
};

const SNAP = () => {
  const T = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    results:        (lastResults || []).length,
    totals:         Object.fromEntries((lastResults || []).map(r => [r.name, r.totalAllocated])),
    includedCounts: Object.fromEntries((lastResults || []).map(r => [r.name, (r.includedInvoices || []).length])),
    breakdownButtons: document.querySelectorAll('.rc-breakdown-toggle').length,
    cardChargeRows:   document.querySelectorAll('.result-card .ts-inv-card').length,
    cardVendors:      Array.from(document.querySelectorAll('.result-card .charge-vendor')).map(T),
    absentNotices:    document.querySelectorAll('.rc-breakdown-absent').length,
    absentText:       Array.from(document.querySelectorAll('.rc-breakdown-absent')).map(T),
    fidelityNotice:   document.querySelectorAll('.rcs-fidelity').length,
    rfrCalls:         window.__rfrCalls || 0,
  };
};

const STATEMENT = (name) => {
  const T = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  try { document.getElementById('reportOverlay').style.display = 'none'; } catch (_) {}
  try { document.getElementById('rptBody').innerHTML = ''; } catch (_) {}
  generateTenantStatement(name);
  const b = document.getElementById('rptBody');
  return {
    rows:        b ? b.querySelectorAll('.ts-inv-card').length : 0,
    vendors:     b ? Array.from(b.querySelectorAll('.charge-vendor')).map(T) : [],
    detailVendors: b ? Array.from(b.querySelectorAll('.ts-detail-row'))
                        .filter(d => /^Vendor/.test(T(d))).map(d => T(d).replace(/^Vendor/, '')) : [],
    text:        b ? (b.innerText || '').replace(/\s+/g, ' ') : '',
  };
};

async function boot(browser, opts, label) {
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = attachDiagnostics(page);
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    return route.abort();
  });
  await ctx.addInitScript(mockFor(opts));
  const signIn = async () => {
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await _e2eSignIn(page, { email: "sr@e2e-test.local", errors: errors });
    await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
    await page.evaluate((id) => selectProperty(id), PROP_ID);
  };
  return { ctx, page, errors, signIn, label };
}

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n══ A complete reconciliation: fresh, then saved and reopened ══\n');
  const A = await boot(browser, {}, 'full');
  await A.signIn();
  await A.page.waitForFunction((n) => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === n,
                               TENANTS.length, { timeout: 45000 });
  await A.page.evaluate(async () => { await runAllocation(); });
  await A.page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                               TENANTS.length, { timeout: 60000 });
  await A.page.waitForSelector('.result-card', { state: 'attached', timeout: 20000 });
  const fresh = await A.page.evaluate(SNAP);
  const freshStmt = {};
  for (const t of TENANTS.map(x => x.tenant_name)) freshStmt[t] = await A.page.evaluate(STATEMENT, t);

  await A.page.evaluate(async () => { try { await savePropertyData(); } catch (_) {} try { await savePropertyNow(); } catch (_) {} });
  await A.page.waitForTimeout(1500);
  await A.signIn();
  await A.page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                               TENANTS.length, { timeout: 25000 });
  await A.page.waitForSelector('.result-card', { state: 'attached', timeout: 20000 });
  const restored = await A.page.evaluate(SNAP);
  const restoredStmt = {};
  for (const t of TENANTS.map(x => x.tenant_name)) restoredStmt[t] = await A.page.evaluate(STATEMENT, t);

  R('fresh    breakdown buttons / rows', `${fresh.breakdownButtons} / ${fresh.cardChargeRows}`);
  R('restored breakdown buttons / rows', `${restored.breakdownButtons} / ${restored.cardChargeRows}`);
  R('restored includedInvoices', restored.includedCounts);
  R('runFullReconciliation calls (restore)', restored.rfrCalls);

  // ── N1 · every charge row names its vendor ────────────────────────────────
  console.log('\n── N1 · every statement charge row names its vendor ──');
  TENANTS.map(x => x.tenant_name).forEach(t => {
    const s = freshStmt[t];
    yes(`${t}: statement issued with ${s.rows} charge rows`, s.rows === INVOICES.length,
        JSON.stringify({ rows: s.rows }));
    yes(`    every row carries a non-empty vendor name`,
        s.vendors.length === s.rows && s.vendors.every(v => v && v.length > 0),
        JSON.stringify(s.vendors));
    yes(`    and every non-empty one is a real vendor from the fixture`,
        s.vendors.filter(Boolean).every(v => VENDORS.includes(v)), JSON.stringify(s.vendors));
    yes(`    the charge-detail panel names the same vendor`,
        s.detailVendors.length === s.rows
          && s.detailVendors.filter(Boolean).every(v => VENDORS.includes(v)),
        JSON.stringify(s.detailVendors));
  });
  // NEGATIVE — the fields it must never fall back to.
  // THE ONLY TWO FIELDS THE ROW MAY CONSULT. A rendered fixture cannot reach a
  // third branch — a nameless invoice never becomes a row — so the prohibition
  // is asserted where it lives. `category` or `description` here would put a
  // plausible wrong name on a billing document, which is worse than a blank.
  const _src = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
  yes('[source] the statement vendor reader consults vendorName then vendor, and nothing else',
      /const _vendorName = inv\.vendorName \|\| inv\.vendor \|\| '';/.test(_src),
      'the vendor reader has grown another fallback');
  yes('no charge row falls back to a category or a filename',
      !Object.values(freshStmt).some(s => s.vendors.some(v => NOT_VENDORS.includes(v))),
      JSON.stringify(Object.values(freshStmt).map(s => s.vendors)));
  yes('every distinct vendor appears exactly once per statement — no row shows another row\'s name',
      Object.values(freshStmt).every(s => new Set(s.vendors.filter(Boolean)).size === s.vendors.filter(Boolean).length),
      JSON.stringify(Object.values(freshStmt).map(s => s.vendors)));
  yes('and the vendor names survive a save and reload',
      TENANTS.map(x => x.tenant_name).every(t =>
        JSON.stringify(restoredStmt[t].vendors) === JSON.stringify(freshStmt[t].vendors)),
      JSON.stringify({ fresh: freshStmt['Alder Bakery'].vendors, restored: restoredStmt['Alder Bakery'].vendors }));

  // ── N2 · the breakdown survives, and nothing is invented ──────────────────
  console.log('\n── N2 · a complete snapshot keeps its breakdown ──');
  yes('a fresh reconciliation renders a breakdown for every tenant',
      fresh.breakdownButtons === TENANTS.length && fresh.cardChargeRows === TENANTS.length * INVOICES.length,
      JSON.stringify({ buttons: fresh.breakdownButtons, rows: fresh.cardChargeRows }));
  yes('and after a save and a real reload it renders the SAME breakdown',
      restored.breakdownButtons === fresh.breakdownButtons
        && restored.cardChargeRows === fresh.cardChargeRows,
      JSON.stringify({ fresh: [fresh.breakdownButtons, fresh.cardChargeRows],
                       restored: [restored.breakdownButtons, restored.cardChargeRows] }));
  yes('    with the same vendor names on the same rows',
      JSON.stringify(restored.cardVendors) === JSON.stringify(fresh.cardVendors),
      JSON.stringify({ fresh: fresh.cardVendors.slice(0, 4), restored: restored.cardVendors.slice(0, 4) }));
  yes('    and no "detail not stored" notice, because the detail IS stored',
      restored.absentNotices === 0, JSON.stringify(restored.absentText));
  yes('    nor a reduced-fidelity notice on a record that is not reduced',
      restored.fidelityNotice === 0);

  console.log('\n── N2 · the money does not move ──');
  yes('every tenant total is byte-identical across the save and reload',
      JSON.stringify(restored.totals) === JSON.stringify(fresh.totals),
      JSON.stringify({ fresh: fresh.totals, restored: restored.totals }));
  yes('    and every includedInvoices count is unchanged',
      JSON.stringify(restored.includedCounts) === JSON.stringify(fresh.includedCounts),
      JSON.stringify({ fresh: fresh.includedCounts, restored: restored.includedCounts }));

  console.log('\n── N2 · the restore does not re-run the engine ──');
  // The breakdown coming back must be the SAVED one. If restoring quietly called
  // runFullReconciliation, the screen would look right for the wrong reason and
  // a stale property could silently re-bill.
  yes('runFullReconciliation was not called during the restore',
      restored.rfrCalls === 0, `it ran ${restored.rfrCalls} time(s)`);
  yes('    (and the counter does work — the fresh run tripped it)',
      fresh.rfrCalls > 0, `fresh run counted ${fresh.rfrCalls}`);

  yes('no page errors on the complete-snapshot pass', A.errors.length === 0,
      A.errors.slice(0, 3).join(' | '));
  await A.ctx.close();

  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n══ A genuinely reduced snapshot: nothing invented, and it says so ══\n');
  const B = await boot(browser, { reduced: true }, 'reduced');
  await B.signIn();
  await B.page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                               TENANTS.length, { timeout: 30000 });
  await B.page.waitForSelector('.result-card', { state: 'attached', timeout: 20000 });
  const red = await B.page.evaluate(SNAP);
  R('reduced: includedInvoices', red.includedCounts);
  R('reduced: buttons / rows / notices', `${red.breakdownButtons} / ${red.cardChargeRows} / ${red.absentNotices}`);

  yes('the stored record genuinely carries no per-invoice detail',
      Object.values(red.includedCounts).every(n => n === 0), JSON.stringify(red.includedCounts));
  yes('NOTHING IS FABRICATED — no breakdown button and no charge row',
      red.breakdownButtons === 0 && red.cardChargeRows === 0,
      JSON.stringify({ buttons: red.breakdownButtons, rows: red.cardChargeRows }));
  yes('    and no vendor names are conjured from the invoice register',
      red.cardVendors.length === 0, JSON.stringify(red.cardVendors));
  yes('THE ABSENCE IS DISCLOSED, once per tenant',
      red.absentNotices === TENANTS.length, String(red.absentNotices));
  yes('    the notice says the detail was not stored and the amount is still as billed',
      red.absentText.every(t => /Per-invoice detail was not stored/.test(t)
                             && /as billed/.test(t)), JSON.stringify(red.absentText[0]));
  yes('    and it tells the manager the one thing that would rebuild it',
      red.absentText.every(t => /Re-run the reconciliation to rebuild the breakdown/.test(t)));
  yes('the existing reduced-fidelity panel notice still fires for this record',
      red.fidelityNotice > 0, String(red.fidelityNotice));
  yes('the billed amounts are shown exactly as stored',
      red.totals['Alder Bakery'] === 17000 && red.totals['Birch Optical'] === 10200
        && red.totals['Cedar Fitness'] === 6800, JSON.stringify(red.totals));
  yes('and opening a reduced record does not re-run the engine either',
      red.rfrCalls === 0, `it ran ${red.rfrCalls} time(s)`);
  yes('no page errors on the reduced-snapshot pass', B.errors.length === 0,
      B.errors.slice(0, 3).join(' | '));
  await B.ctx.close();

  console.log('\n' + '─'.repeat(58));
  console.log(fail === 0
    ? `\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`
    : `\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await browser.close();
  server.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Runner error:', e && e.stack ? e.stack : e); process.exit(1); });
