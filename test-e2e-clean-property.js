'use strict';
/**
 * test-e2e-clean-property.js — the happy path, end to end.
 *
 *   node test-e2e-clean-property.js
 *
 * WHY THIS SUITE EXISTS
 *
 * Every e2e suite in this repo drives a property with problems. That is where
 * the defects were, so that is where the coverage went — and it left the most
 * common real case completely untested: a property whose leases are current,
 * whose square footage adds up, and whose invoices are documented and ordinary.
 *
 * A system tuned entirely on failure cases fails in a specific way: it cries
 * wolf. Findings calibrated against expired leases and an 81.7% concentration
 * can fire on a property where nothing is wrong, and a manager who is told to
 * resolve three exceptions on a clean reconciliation stops reading them. So the
 * assertions here are mostly NEGATIVE — no critical exceptions, no coverage
 * gap, no NOT CONFIRMED finding that has no evidence behind it — and the
 * positive ones check that the workflow actually completes: Ready to bill, a
 * statement that issues, and reports that agree with each other.
 *
 * THE PROPERTY
 * 100,000 sq ft, fully leased by three current NNN tenants (40,000 + 35,000 +
 * 25,000 = 100%), each with a cap percentage, a prior-year base and a resolved
 * audit-rights clause. Six documented, dated invoices totalling $54,400, none
 * above 21% of the pool. Nothing here should raise a red finding.
 *
 * DETERMINISM
 * Fixed timezone, fixed seed data, its own port and localStorage key, no network
 * egress. No wall-clock date is asserted on.
 */
process.env.TZ = 'America/New_York';

// Registered in test-regression.js, so it must not take the whole suite down on
// a machine with no browser — but it must not quietly pass there either, which
// is the same vacuous-pass failure this file exists to prevent. Skipping is
// therefore explicit and loud, never inferred.
const SKIP = process.env.SKIP_BROWSER_TESTS === '1';

let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-test3: playwright is not installed.\x1b[0m');
      console.error('This suite replays the Test 3 workflow in a real browser and cannot');
      console.error('verify anything without one. Install playwright, or set');
      console.error('SKIP_BROWSER_TESTS=1 to deliberately skip it.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-test3 SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The Test 3 workflow was NOT verified on this run.\n');
  process.exit(0);
}
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const PORT     = parseInt(process.env.APP_PORT || '7931', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const SHOTS    = process.env.SHOTS === '1';
const SHOT_DIR = path.join(__dirname, 'screenshots-t3');
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
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

// ── The Test 3 dataset, exactly as the walkthrough used it ────────────────────
// Property: 100,000 sqft, CAM year 2026.
// Three leases: two expired with sqft, one live with NO sqft.
// Five invoices totalling $67,300, one of them $55,000 (81.7% of the pool).
const PROP_ID = 'clean-prop-00000000001';
const T = {
  dover: 't3-tenant-dover-000001',
  para:  't3-tenant-para-0000001',
  gsb:   't3-tenant-gsb-00000001',
};
const TENANTS = [
  { id: 'c-north', tenant_name: 'Northline Outfitters', leased_sqft: 40000,
    lease_type: 'Triple Net (NNN)', start_date: '2022-01-01', end_date: '2032-12-31',
    cap: '5', capBaseAmount: '30000', excluded_categories: '', status: 'complete',
    audit_rights: true, fileName: 'northline.pdf' },
  { id: 'c-harbor', tenant_name: 'Harbor Point Dental', leased_sqft: 35000,
    lease_type: 'Triple Net (NNN)', start_date: '2021-06-01', end_date: '2031-05-31',
    cap: '5', capBaseAmount: '26000', excluded_categories: '', status: 'complete',
    audit_rights: true, fileName: 'harbor.pdf' },
  { id: 'c-cedar', tenant_name: 'Cedar Row Books', leased_sqft: 25000,
    lease_type: 'Triple Net (NNN)', start_date: '2023-03-01', end_date: '2033-02-28',
    cap: '5', capBaseAmount: '19000', excluded_categories: '', status: 'complete',
    audit_rights: true, fileName: 'cedar.pdf' },
];
const INVOICES = [
  { id: 'c-1', vendorName: 'Alpha Landscaping', amount: '9800', category: 'landscaping',
    invoiceDate: '2026-03-01', fileName: 'a.pdf', fileUrl: 'https://mock.local/a.pdf',
    confidence: { amount: 95, vendor: 95, category: 92 } },
  { id: 'c-2', vendorName: 'Beta Janitorial', amount: '11200', category: 'janitorial',
    invoiceDate: '2026-04-01', fileName: 'b.pdf', fileUrl: 'https://mock.local/b.pdf',
    confidence: { amount: 95, vendor: 95, category: 92 } },
  { id: 'c-3', vendorName: 'Gamma Snow Removal', amount: '8600', category: 'snow',
    invoiceDate: '2026-01-15', fileName: 'g.pdf', fileUrl: 'https://mock.local/g.pdf',
    confidence: { amount: 95, vendor: 95, category: 92 } },
  { id: 'c-4', vendorName: 'Delta Utilities', amount: '10400', category: 'utilities',
    invoiceDate: '2026-05-01', fileName: 'd.pdf', fileUrl: 'https://mock.local/d.pdf',
    confidence: { amount: 95, vendor: 95, category: 92 } },
  { id: 'c-5', vendorName: 'Epsilon Security', amount: '7500', category: 'security',
    invoiceDate: '2026-06-01', fileName: 'e.pdf', fileUrl: 'https://mock.local/e.pdf',
    confidence: { amount: 95, vendor: 95, category: 92 } },
  { id: 'c-6', vendorName: 'Zeta Elevator Service', amount: '6900', category: 'elevator',
    invoiceDate: '2026-07-01', fileName: 'z.pdf', fileUrl: 'https://mock.local/z.pdf',
    confidence: { amount: 95, vendor: 95, category: 92 } },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID = 't3-user';
  var _user = { id: USER_ID, email: 't3@e2e-test.local' };
  var _session = null;
  var KEY = '__clean_store';
  var seed = {
    properties: [{
      id: ${JSON.stringify(PROP_ID)}, user_id: USER_ID, name: 'Clean Property', sqft: 100000,
      data: {
        invoices: ${JSON.stringify(INVOICES)},
        disputes: [], camYear: 2026, results: null, camReconciliation: null,
        activityLog: [], timeline: [], escrowReserves: [], drawRequests: [],
        tenants: ${JSON.stringify(TENANTS)},
      },
    }],
    tenants: [],
  };
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return JSON.parse(JSON.stringify(seed));
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(_store)); } catch (e) {} }
  var _store = load();
  window.__store = function () { return _store; };
  function res(data) { return Promise.resolve({ data: data, error: null }); }
  var _seq = 0;
  function table(name) {
    var rows = _store[name] || (_store[name] = []);
    var last = null;
    var api = {
      select: function () { return api; }, eq: function () { return api; },
      not: function () { return api; }, is: function () { return api; },
      in: function () { return api; }, order: function () { return api; },
      limit: function () { return api; },
      maybeSingle: function () { return res(last || rows[0] || null); },
      single: function () { return res(last || rows[0] || null); },
      insert: function (v) {
        var a = [].concat(v).map(function (r) {
          var row = JSON.parse(JSON.stringify(r));
          if (!row.id) row.id = 'mock-' + name + '-' + (++_seq);
          rows.push(row); return row;
        });
        last = a[0]; persist(); return api;
      },
      upsert: function (v) {
        var a = [].concat(v).map(function (r) {
          var row = JSON.parse(JSON.stringify(r));
          if (!row.id) row.id = 'mock-' + name + '-' + (++_seq);
          var i = rows.findIndex(function (x) { return x.id === row.id; });
          if (i >= 0) { rows[i] = Object.assign({}, rows[i], row); persist(); return rows[i]; }
          rows.push(row); return row;
        });
        last = a[0]; persist(); return api;
      },
      update: function (v) {
        rows.forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(v))); });
        last = rows[0]; persist(); return api;
      },
      delete: function () { return api; },
      then: function (r2) { return Promise.resolve({ data: last ? [last] : rows, error: null }).then(r2); },
    };
    return api;
  }
  window.supabase = { createClient: function () { return {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: _session }, error: null }); },
      getUser:    function () { return Promise.resolve({ data: { user: _session ? _user : null }, error: null }); },
      signInWithPassword: function () { _session = { access_token: 'mock', user: _user };
        return Promise.resolve({ data: { session: _session, user: _user }, error: null }); },
      signUp:  function () { return Promise.resolve({ data: { user: _user }, error: null }); },
      signOut: function () { _session = null; return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    },
    from: table,
    storage: { from: function () { return {
      upload: function () { return res({ path: 'mock' }); },
      createSignedUrl: function () { return res({ signedUrl: 'https://mock.local/x' }); } }; } },
  }; } };
})();
`;

(async () => {
  if (SHOTS && !fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server  = await startServer();
  const browser = await chromium.launch({
    headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    }
    return route.abort();
  });
  await page.addInitScript(SUPABASE_MOCK);
  await page.addInitScript(() => { window.__PROP_ID = 'clean-prop-00000000001'; });

  console.log('\n══ CLEAN-PROPERTY VALIDATION — the happy path ══');

  // ── sign in ────────────────────────────────────────────────────────────────
  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
  await page.fill('#loginEmail', 't3@e2e-test.local');
  await page.fill('#loginPassword', 'TestPass123!');
  await page.click('#loginBtn');
  await page.waitForFunction(() => {
    const app = document.getElementById('appContent');
    return app && app.style.display !== 'none' && app.style.display !== '';
  }, { timeout: 20000 });
  await page.waitForFunction(() => typeof _props !== 'undefined' && Array.isArray(_props) && _props.length > 0,
                             { timeout: 20000 });
  await page.evaluate(() => selectProperty(window.__PROP_ID));
  await page.waitForFunction(() => typeof tenantData !== 'undefined'
    && tenantData.filter(Boolean).length === 3, { timeout: 20000 });

  const seeded = await page.evaluate(() => ({
    prop:     currentProperty()?.name,
    sqft:     document.getElementById('totalSqft')?.value,
    camYear:  typeof getCamYear === 'function' ? getCamYear() : null,
    tenants:  tenantData.filter(Boolean).map(t => `${t.tenant_name}/${t.leased_sqft ?? 'no sqft'}`),
    invoices: invoiceData.filter(Boolean).map(i => `${i.vendorName} ${i.amount}`),
    invTotal: invoiceData.filter(Boolean).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0),
  }));
  console.log('\n── Loaded state ──');
  console.log('  property :', seeded.prop, '·', seeded.sqft, 'sqft · CAM year', seeded.camYear);
  console.log('  leases   :', seeded.tenants.join(' | '));
  console.log('  invoices :', seeded.invoices.join(' | '));
  console.log('  pool     : $' + seeded.invTotal.toLocaleString());

  yes('the three clean leases loaded', seeded.tenants.length === 3, JSON.stringify(seeded.tenants));
  yes('the six invoices loaded and total $54,400',
      seeded.invoices.length === 6 && seeded.invTotal === 54400,
      `got ${seeded.invoices.length} / $${seeded.invTotal}`);


  const say=(l,v)=>console.log('  '+String(l).padEnd(46)+':', typeof v==='string'?v:JSON.stringify(v));

  console.log('\n── Readiness: nothing should be blocked ──');
  await page.evaluate(()=>{ if(typeof switchWorkspaceTab==='function')switchWorkspaceTab('spaces');
    if(typeof switchLeaseTab==='function')switchLeaseTab('bulk'); renderBulkResults(); });
  const bulk=await page.evaluate(()=>{ const el=document.getElementById('bulkResults');
    const g=(s)=>{const n=el.querySelector(s);return n?n.textContent.replace(/\s+/g,' ').trim():null;};
    return { btn:[...el.querySelectorAll('button')].map(b=>b.textContent.replace(/\s+/g,' ').trim())
               .find(t=>/confirm .* extraction/i.test(t))||null,
             blocked:g('.bulk-cam-blocked'), review:g('.bulk-cam-review'),
             warnGlyphs:(el.textContent.match(/⚠/g)||[]).length,
             engine:getValidTenants().map(t=>t.tenant_name) };});
  say('confirm button', bulk.btn); say('blocked block', bulk.blocked||'(none)');
  say('review block', bulk.review||'(none)'); say('engine accepts', bulk.engine);
  yes('no lease is blocked from CAM', !bulk.blocked, String(bulk.blocked));
  // A FALSE-ALARM GUARD, not a "no review items" guard.
  //
  // A perfect lease here still raises one item: audit_rights_present, "Tenant
  // has CAM audit rights — document response SLA". Its review state is
  // `verified` with a score of 100 — nothing is missing, nothing is unresolved,
  // and the landlord recorded the fact correctly. It appears only because
  // audit_rights_present sits in MISSING_FIELD_TYPES, a taxonomy question that
  // is deliberately out of scope for this pass.
  //
  // So what is asserted is the property that actually protects the reader: on a
  // clean property no lease may be told something is MISSING, UNRESOLVED, NOT
  // SPECIFIED or NEEDS REVIEW. An informational attribute may be surfaced; a
  // manufactured gap may not. A real gap appearing here still fails this.
  const _falseAlarm = /missing|not specified|not resolved|unresolved|needs review|incomplete/i;
  yes('no lease is told something is missing or unresolved',
      !bulk.review || !_falseAlarm.test(bulk.review),
      `a clean lease is being told it has a gap: ${String(bulk.review)}`);
  yes('every lease reads as verified — no manufactured Needs Review',
      await page.evaluate(() => tenantData.filter(Boolean)
        .every(d => getTenantReviewState(d) === 'verified')),
      await page.evaluate(() => JSON.stringify(tenantData.filter(Boolean)
        .map(d => [d.tenant_name, getTenantReviewState(d), getTenantReviewScore(d)]))));
  yes('and every lease scores 100', await page.evaluate(() =>
        tenantData.filter(Boolean).every(d => getTenantReviewScore(d) === 100)),
      'a clean lease is being marked down');
  yes('all three leases reach the engine', bulk.engine.length===3, JSON.stringify(bulk.engine));
  yes('all three are offered for confirmation', !!bulk.btn && /\b3\b/.test(bulk.btn), String(bulk.btn));

  console.log('\n── Reconciliation: full coverage, no variance banner ──');
  const rec=await page.evaluate(async()=>{ if(typeof switchWorkspaceTab==='function')switchWorkspaceTab('cam');
    await runAllocation(); const b=document.getElementById('resultsBody');
    const t=b.textContent.replace(/\s+/g,' ');
    return { rows:lastResults.map(r=>({n:r.name,pct:+(r.proRata*100).toFixed(2),amt:+Number(r.totalAllocated).toFixed(2)})),
      pool:lastTotal, billed:+lastResults.reduce((s,r)=>s+(+r.totalAllocated||0),0).toFixed(2),
      kpis:[...b.querySelectorAll('.rcs-kpi')].map(k=>k.textContent.replace(/\s+/g,' ').trim()),
      readiness:(()=>{const n=b.querySelector('.rcs-readiness-badge');return n?n.textContent.trim():null;})(),
      states:[...b.querySelectorAll('.rc-calc-state')].map(x=>x.textContent.trim()),
      partial:/Partial property coverage/.test(t), variance:/Reconciliation variance detected/.test(t),
      skipBanner:(()=>{const n=document.querySelector('.cam-skip-warning');return n?n.textContent.trim():null;})() };});
  say('rows', rec.rows); say('pool / billed', '$'+rec.pool+' / $'+rec.billed);
  say('KPIs', rec.kpis); say('readiness badge', rec.readiness);
  say('calc-state chips', rec.states);
  yes('every tenant is reconciled', rec.rows.length===3, JSON.stringify(rec.rows));
  yes('pro-rata sums to 100% of the building',
      Math.abs(rec.rows.reduce((s,r)=>s+r.pct,0)-100)<0.01, JSON.stringify(rec.rows.map(r=>r.pct)));
  yes('the whole pool is allocated — nothing left unassigned',
      Math.abs(rec.billed-rec.pool)<0.05, `pool ${rec.pool} vs billed ${rec.billed}`);
  yes('NO partial-coverage banner on a fully covered property', !rec.partial, 'a coverage gap is claimed');
  yes('NO variance warning', !rec.variance, 'a variance warning fired on a balanced run');
  yes('NO property-mismatch exclusion banner', !rec.skipBanner, String(rec.skipBanner));

  console.log('\n── C2/C3/C4: terminology on a billable run ──');
  yes('C2 the KPI says Total Billed once the run IS billable',
      rec.kpis.some(k=>/Total Billed/.test(k)) && !rec.kpis.some(k=>/Calculated Tenant Allocation/.test(k)),
      JSON.stringify(rec.kpis));
  yes('C4 the flags KPI names its narrow scope',
      rec.kpis.some(k=>/Allocation Flags/.test(k)) && !rec.kpis.some(k=>/^0Flagged$/.test(k)),
      JSON.stringify(rec.kpis));
  yes('C3 row chips say what was verified — the calculation',
      rec.states.length>0 && rec.states.every(x=>/^Calc /.test(x)) && !rec.states.includes('Verified'),
      JSON.stringify(rec.states));
  yes('the canonical readiness badge reads Ready to bill',
      !!rec.readiness && /Ready to bill/i.test(rec.readiness) && !/Not ready/i.test(rec.readiness),
      String(rec.readiness));

  console.log('\n── Audit: no false alarms ──');
  const audit=await page.evaluate(()=>{ const s=buildAuditSummary(); const n=buildAuditNarrative();
    return { red:s.red.map(f=>f.title), yellow:s.yellow.map(f=>f.title), green:s.green.length,
      riskLevel:n.riskLevel, headline:n.headline, readiness:n.readiness,
      nextAction:n.nextAction, financialImpact:n.financialImpact,
      exposure:{atRisk:n.exposure.confirmedAtRisk,flagged:n.exposure.poolFlagged,
                unq:n.exposure.unquantified,exceeds:n.exposure.exceedsPool} };});
  say('RED', audit.red); say('YELLOW', audit.yellow); say('risk level', audit.riskLevel);
  say('headline', audit.headline); say('readiness', audit.readiness);
  say('exposure', audit.exposure); say('financial impact', audit.financialImpact);
  console.log('  nextAction:', JSON.stringify(audit.nextAction, null, 1).replace(/\n/g,'\n    '));
  yes('NO critical exceptions on a clean property', audit.red.length===0, JSON.stringify(audit.red));
  yes('no coverage-gap finding', !audit.yellow.some(t=>/coverage/i.test(t)), JSON.stringify(audit.yellow));
  yes('no expired-lease finding', !audit.yellow.concat(audit.red).some(t=>/lease that ended/i.test(t)),
      JSON.stringify(audit.yellow));
  yes('no concentration finding — no invoice dominates the pool',
      !audit.yellow.concat(audit.red).some(t=>/Unusually large invoice/i.test(t)), JSON.stringify(audit.yellow));
  yes('no money is at risk', Number(audit.exposure.atRisk)===0 && Number(audit.exposure.flagged)===0,
      JSON.stringify(audit.exposure));
  yes('risk level is Low', audit.riskLevel==='Low', audit.riskLevel);
  yes('the headline does not warn about billing', !/Before Tenant Billing|Immediate Review/i.test(audit.headline),
      audit.headline);
  yes('READY TO BILL', audit.readiness && audit.readiness.canBill===true, JSON.stringify(audit.readiness));

  console.log('\n── I11: the next required action ──');
  yes('nextAction exists and is derived, not empty', !!audit.nextAction && !!audit.nextAction.label,
      JSON.stringify(audit.nextAction));
  yes('on a clean run it says statements can be issued',
      audit.nextAction.state==='ready' && /can be issued/i.test(audit.nextAction.detail||''),
      JSON.stringify(audit.nextAction));
  yes('it agrees with the canonical readiness state — no second source of truth',
      (audit.nextAction.state==='ready')===(audit.readiness.canBill===true)
        && audit.nextAction.label===audit.readiness.label,
      JSON.stringify({na:audit.nextAction.label,rd:audit.readiness.label}));
  yes('it lists no blocking steps when nothing blocks',
      !audit.nextAction.steps || audit.nextAction.steps.length===0, JSON.stringify(audit.nextAction.steps));

  console.log('\n── The statement ISSUES ──');
  const st=await page.evaluate(async()=>{ const b=document.getElementById('rptBody'); if(b)b.innerHTML='';
    await generateTenantStatement('Northline Outfitters');
    const o=document.getElementById('rptBody');
    return { title:(document.getElementById('rptToolbarTitle')||{}).textContent,
             text:(o?.textContent||'').replace(/\s+/g,' ').trim() };});
  say('report title', st.title);
  console.log('  first 260 chars:', st.text.slice(0,260));
  yes('a real statement is issued, not a block screen',
      !/Statement blocked/i.test(st.title) && !/has not been issued/i.test(st.text), st.title);
  yes('it is NOT marked a non-billable draft',
      !/NON-BILLABLE DRAFT/i.test(st.text) && !/DO NOT SEND TO TENANT/i.test(st.text), 'draft markings on a billable statement');
  yes('it uses billed terminology now that billing is cleared',
      /Total Billed/i.test(st.text) && !/Calculated CAM charge/i.test(st.text), st.text.slice(0,200));
  yes('it still makes no present-tense on-chain claim',
      !/(settled|recorded|paid) on( the)? XRP( Ledger)?\b/i.test(st.text)
        && !/transaction (was )?confirmed/i.test(st.text), 'an unearned settlement claim');

  console.log('\n── Reports stay coherent ──');
  const reports={};
  for (const [label,fn] of [['CAM Reconciliation Summary','generateReconciliationSummary'],
      ['Audit Exception Summary','generateExceptionReport'],['Coverage Gap Report','generateHolesReport'],
      ['Risk & Disputes Report','generateLandlordExport'],['Lender Summary','generateLenderSummaryReport']]) {
    const r=await page.evaluate(async(f)=>{ const b=document.getElementById('rptBody'); if(b)b.innerHTML='';
      try{ await window[f](); }catch(e){ return {err:String(e&&e.message||e)}; }
      return {text:(document.getElementById('rptBody')?.textContent||'').replace(/\s+/g,' ').trim()}; },fn);
    reports[label]=r;
    yes(`${label} renders`, !r.err && r.text.length>200, r.err||`only ${(r.text||'').length} chars`);
  }
  const cg=reports['Coverage Gap Report'].text||'';
  say('coverage gap — property block', (cg.match(/Property coverage.{0,120}/)||[''])[0]);
  yes('B1 the Coverage Gap Report reports FULL property coverage',
      /Property coverage/.test(cg) && /100\.0% documented/.test(cg) && !/unresolved/.test(cg.match(/Property coverage.{0,160}/)||[''])[0],
      (cg.match(/Property coverage.{0,200}/)||[''])[0]);
  yes('B1 it never claims all leases are uploaded', !/all leases are uploaded/i.test(cg),
      'the unknowable claim is back');
  const all=Object.values(reports).map(r=>r.text||'').join(' ');
  // Scoped to the STATED VERDICTS, not to any sentence containing the words.
  // The reports carry static explanatory copy ("Resolve before billing",
  // "enumerated in the Audit Exception Summary") that mentions exceptions
  // without claiming any, so a blanket phrase search fails on prose rather than
  // on a defect. What must hold is that no report states a non-zero count.
  const exceptionClaims = (all.match(/(\d+)\s+critical exception/gi) || [])
    .filter(m => !/^0\s/.test(m));
  say('non-zero exception claims across reports', exceptionClaims);
  yes('no report states a non-zero exception count on a clean property',
      exceptionClaims.length === 0, JSON.stringify(exceptionClaims));
  yes('and the reports positively state that there are none',
      /No exceptions/i.test(all) || /0 critical/i.test(all),
      'no report says the reconciliation is clean');
  yes('no report shows a dollar figure above the pool',
      (all.match(/\$[\d,]+(?:\.\d\d)?/g)||[]).map(x=>parseFloat(x.replace(/[$,]/g,'')))
        .filter(v=>v>54400 && v<1e7).length===0, 'a figure exceeds the pool');

  console.log('\n── No misleading NOT CONFIRMED verdicts ──');
  const lv=await page.evaluate(()=>{ const host=document.createElement('div');
    host.innerHTML=_renderValidationPanel([
      {check:'CAM_EXCLUSIONS',severity:'info',confidence:'high',source:'ai',
       finding:'The lease lists the CAM exclusions applied in this reconciliation.'}],{});
    const b=host.querySelector('.lv-sev-badge'), c=host.querySelector('.lv-conf');
    return {badge:b?b.textContent.trim():null, chip:c?c.textContent.trim():null};});
  say('supported finding badge', lv.badge); say('chip', lv.chip);
  yes('an evidence-supported finding still reads PASSED', lv.badge==='PASSED', String(lv.badge));
  yes('and keeps the ordinary AI confidence wording', /^AI confidence:/.test(lv.chip||''), String(lv.chip));

  yes('no uncaught page errors', errors.length===0, errors.slice(0,3).join(' | '));

  const TOTAL_EXPECTED = 48;
  yes(`suite runs all ${TOTAL_EXPECTED} checks`, pass+fail+1===TOTAL_EXPECTED,
      `assertion count changed — update TOTAL_EXPECTED deliberately (saw ${pass+fail+1})`);
  await browser.close(); server.close();
  console.log(`\n${fail===0?'\x1b[32m':'\x1b[31m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail===0?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
