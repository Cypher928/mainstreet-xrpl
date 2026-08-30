'use strict';
/**
 * fresh-property-validation.js — a genuinely fresh property, driven through the
 * real UI, observed rather than asserted.
 *
 * NOT A TEST. It makes no pass/fail claim and fixes nothing. It builds one
 * realistic property, signs in, runs the reconciliation the manager runs, and
 * dumps what the product actually said — per tenant, per invoice, per bucket —
 * then reloads the page and dumps it again, then re-renders at phone width.
 *
 * The property is new: not the CI fixture, not any property used to validate T2.
 */
process.env.TZ = 'America/New_York';

let pw;
try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = process.env.APP_ROOT || '/home/user/mainstreet-xrpl';
const PORT     = parseInt(process.env.APP_PORT || '7991', 10);
const HEADLESS = process.env.HEADLESS !== '0';
const CHROME   = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT      = process.env.OUT_DIR || __dirname;

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };

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

// ── THE PROPERTY ────────────────────────────────────────────────────────────
// Northgate Exchange — 100,000 sqft mixed retail/office, reconciling CY2025 in
// August 2026, which is when CAM reconciliation actually happens.
//
//   92,000 sqft under six leases, 8,000 sqft vacant.
//
const PROP_ID = 'ng-prop-2025-northgate';
const CAM_YEAR = 2025;
const TOTAL_SQFT = 100000;

const TENANTS = [
  // Full period, no cap, no exclusions — the control.
  { id: 'ng-t-brightwater', tenant_name: 'Brightwater Grocers', unitNumber: '100',
    leased_sqft: 32000, lease_type: 'Triple Net (NNN)',
    start_date: '2019-03-01', end_date: '2034-02-28',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },

  // Begins mid-period: took occupancy 1 April 2025.
  { id: 'ng-t-ridgeline', tenant_name: 'Ridgeline Outfitters', unitNumber: '120',
    leased_sqft: 18000, lease_type: 'Triple Net (NNN)',
    start_date: '2025-04-01', end_date: '2032-03-31',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },

  // Ends mid-period: vacated 30 September 2025.
  { id: 'ng-t-calder', tenant_name: 'Calder Fitness', unitNumber: '210',
    leased_sqft: 15000, lease_type: 'Triple Net (NNN)',
    start_date: '2016-09-01', end_date: '2025-09-30',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },

  // GENUINELY MISSING start date — the lease was scanned and the term page is
  // absent. Empty, with nothing recorded as unreadable.
  { id: 'ng-t-alder', tenant_name: 'Alder & Vine Cafe', unitNumber: '130',
    leased_sqft: 8000, lease_type: 'Triple Net (NNN)',
    start_date: '', end_date: '2030-06-30',
    cap: '', capBaseAmount: '', excluded_categories: '', status: 'complete' },

  // UNREADABLE start date — the lease says "TBD". The field is empty and the
  // raw text is kept beside it, which is the shape normalizeTenant produces.
  // Also carries an exclusion the resolver cannot map to a CAM category.
  { id: 'ng-t-perrin', tenant_name: 'Perrin Legal Group', unitNumber: '305',
    leased_sqft: 12000, lease_type: 'Modified Gross',
    start_date: '', end_date: '2029-11-30',
    unreadableDates: { start_date: 'TBD' },
    cap: '', capBaseAmount: '', excluded_categories: 'capital expenditures', status: 'complete' },

  // ANNUAL CAP with a prior-year base, plus an exclusion that DOES map.
  { id: 'ng-t-thorne', tenant_name: 'Thorne Dental', unitNumber: '220',
    leased_sqft: 7000, lease_type: 'Triple Net (NNN)',
    start_date: '2021-01-01', end_date: '2028-12-31',
    cap: '5', capBaseAmount: '9000', excluded_categories: 'management fees', status: 'complete' },
];

const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });

// Vendor names are deliberately chosen so the matcher's own rules decide what is
// shared and what is direct: a direct invoice carries the tenant's full name as
// a whole token, a shared one carries nobody's.
const INVOICES = [
  // ── shared, in year, CAM-eligible ───────────────────────────────────────
  { id: 'ng-i-01', vendorName: 'Halvorsen Janitorial',   amount: '28000', category: 'janitorial',  invoiceDate: '2025-02-14', camEligible: true, ...doc('halvorsen') },
  { id: 'ng-i-02', vendorName: 'Meridian Insurance',     amount: '24000', category: 'insurance',   invoiceDate: '2025-01-08', camEligible: true, ...doc('meridian') },
  { id: 'ng-i-03', vendorName: 'Ostrander Landscaping',  amount: '19000', category: 'landscaping', invoiceDate: '2025-05-20', camEligible: true, ...doc('ostrander') },
  { id: 'ng-i-04', vendorName: 'Kestrel Security',       amount: '22000', category: 'security',    invoiceDate: '2025-07-03', camEligible: true, ...doc('kestrel') },
  { id: 'ng-i-05', vendorName: 'Bellweather Utilities',  amount: '31000', category: 'utilities',   invoiceDate: '2025-10-11', camEligible: true, ...doc('bellweather') },
  // Thorne Dental's lease excludes management fees — this is the invoice that
  // exclusion has to bite on, and only for that tenant.
  { id: 'ng-i-06', vendorName: 'Pinnacle Management Co', amount: '16000', category: 'management',  invoiceDate: '2025-06-30', camEligible: true, ...doc('pinnacle') },
  { id: 'ng-i-07', vendorName: 'Quarry Snow Services',   amount: '12000', category: 'snow',        invoiceDate: '2025-12-18', camEligible: true, ...doc('quarry') },
  // UNDATED shared invoice — kept by the year filter, and reported as included
  // on no evidence.
  { id: 'ng-i-08', vendorName: 'Lockridge Repairs',      amount:  '9000', category: 'repairs',     invoiceDate: '',           camEligible: true, ...doc('lockridge') },

  // ── out of the CAM year ─────────────────────────────────────────────────
  { id: 'ng-i-09', vendorName: 'Ashfield Paving',        amount: '14000', category: 'repairs',     invoiceDate: '2024-11-20', camEligible: true, ...doc('ashfield') },

  // ── in year, marked NOT CAM-eligible by the manager ─────────────────────
  { id: 'ng-i-10', vendorName: 'Sterling Roof Replacement', amount: '26000', category: 'other',    invoiceDate: '2025-08-05', camEligible: false, ...doc('sterling') },

  // ── direct: INSIDE the tenant's occupancy window ────────────────────────
  { id: 'ng-i-11', vendorName: 'Calder Fitness submeter reconciliation', amount: '4800', category: 'utilities', invoiceDate: '2025-05-10', camEligible: true, ...doc('calder-sub') },
  // ── direct: OUTSIDE the window (Calder vacated 30 Sep) ──────────────────
  { id: 'ng-i-12', vendorName: 'Calder Fitness HVAC replacement',        amount: '6500', category: 'repairs',   invoiceDate: '2025-11-15', camEligible: true, ...doc('calder-hvac') },
  // ── direct: UNDATED, on a part-period tenant ────────────────────────────
  { id: 'ng-i-13', vendorName: 'Ridgeline Outfitters storefront signage', amount: '3200', category: 'repairs',  invoiceDate: '',           camEligible: true, ...doc('ridgeline-sign') },
  // ── direct: inside, full-period tenant ──────────────────────────────────
  { id: 'ng-i-14', vendorName: 'Thorne Dental plumbing repair',          amount: '2400', category: 'repairs',   invoiceDate: '2025-03-22', camEligible: true, ...doc('thorne-plumb') },
];

const SUPABASE_MOCK = `
(function () {
  var USER_ID='ng-user', _user={id:USER_ID,email:'ng@fresh-validation.local'}, _session=null, KEY='__ng_store';
  var seed={properties:[{id:${JSON.stringify(PROP_ID)},user_id:USER_ID,name:'Northgate Exchange',sqft:${TOTAL_SQFT},
    data:{invoices:${JSON.stringify(INVOICES)},disputes:[],camYear:${CAM_YEAR},results:null,camReconciliation:null,
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

// ── The observation. Everything below is READ from the page. ────────────────
const OBSERVE = () => {
  const out = {};
  const AX = window.AuditExposure;
  const summary = buildAuditSummary();
  const expo = AX.deriveExposure(summary, typeof lastTotal !== 'undefined' ? lastTotal : 0);

  out.property = {
    name: (currentProperty() || {}).name,
    totalSqft: (currentProperty() || {}).totalSqft,
    camYear: typeof getCamYear === 'function' ? getCamYear() : null,
    yearScope: (typeof _lastEngineInvoices !== 'undefined') ? null : null,
  };

  out.totals = {
    lastTotal: typeof lastTotal !== 'undefined' ? lastTotal : null,
    lastCamPool: typeof lastCamPool !== 'undefined' ? lastCamPool : null,
    billed: (lastResults || []).reduce((s, r) => s + (r.totalAllocated || 0), 0),
    proRataSum: (lastResults || []).reduce((s, r) => s + (r.proRataPercent || 0), 0),
  };

  out.tenants = (lastResults || []).map(r => {
    const t = (currentProperty().tenants || []).find(x => x && x.tenant_name === r.name) || {};
    const chip = _tenantBillingState(r.name, expo);
    const term = window.LeasePeriod.obligationTerm(t);
    const cls  = window.LeasePeriod.classify(t, { start: `${getCamYear()}-01-01`, end: `${getCamYear()}-12-31` });
    return {
      name: r.name,
      sqft: t.leased_sqft,
      proRataPercent: r.proRataPercent,
      occupancy: r.occupancy ? {
        applied: r.occupancy.applied, unresolved: r.occupancy.unresolved,
        factor: r.occupancy.factor, numerator: r.occupancy.numerator,
        denominator: r.occupancy.denominator, unit: r.occupancy.unit,
        case: r.occupancy.case, label: r.occupancy.label,
        basis: r.occupancy.basis, basisSource: r.occupancy.basisSource,
        capProrated: r.occupancy.capProrated,
        overlapStart: r.occupancy.overlapStart, overlapEnd: r.occupancy.overlapEnd,
      } : null,
      termCase: cls.case, termLabel: cls.label,
      startStatus: term.startStatus, endStatus: term.endStatus,
      startRaw: term.startRaw, needsOccupancyConfirmation: cls.needsOccupancyConfirmation,
      totalAllocated: r.totalAllocated,
      allocatedAmount: r.allocatedAmount,
      capApplied: r.capApplied, capAdjustment: r.capAdjustment,
      capPct: t.cap, capBase: t.capBaseAmount,
      exclusionsRaw: t.excluded_categories,
      exclusionsApplied: (window.CamExclusions.tenantExclusionState(t.excluded_categories).applied) || [],
      exclusionsNotApplied: (window.CamExclusions.tenantExclusionState(t.excluded_categories).notApplied || []).map(x => ({ raw: x.raw, status: x.status, reason: x.reason })),
      chip: { state: chip.state, label: chip.label, reason: chip.reason,
              propertyLevel: chip.propertyLevel, exclusionOnly: chip.exclusionOnly,
              canBill: chip.readiness ? chip.readiness.canBill : null,
              readinessLabel: chip.readiness ? chip.readiness.label : null,
              blockers: chip.readiness ? (chip.readiness.blockers || []).map(b => ({ scope: b.scope, title: b.title })) : [] },
      flags: (r.ambiguityFlags || []).map(f => ({ code: f.code, message: f.message, explanation: f.explanation,
                                                   held: (f.held || []).map(h => ({ vendor: h.vendorName, amount: h.amount, date: h.date })) })),
      included: (r.includedInvoices || []).map(li => ({ id: li.id, vendor: li.vendorName || li.vendor,
                                                        category: li.category, amount: li.amount,
                                                        allocation: li.allocation, share: li.share })),
    };
  });

  // The variance panel's own numbers, exactly as the screen derives them.
  const engineInvoices = (typeof _lastEngineInvoices !== 'undefined' ? _lastEngineInvoices : []) || [];
  const reconciled     = (typeof _lastReconciledInvoices !== 'undefined' ? _lastReconciledInvoices : []) || [];
  const totalPool  = engineInvoices.reduce((s, inv) => s + (parseFloat(inv.amount) || 0), 0);
  const totalBilled = (lastResults || []).reduce((s, r) => s + r.totalAllocated, 0);
  const bk = window.VarianceBreakdown.derive({
    results: lastResults, invoices: engineInvoices, reconciled, pool: totalPool, billed: totalBilled,
  });
  out.variance = {
    pool: bk.pool, billed: bk.billed, difference: bk.difference,
    billedPct: bk.billedPct, proRataSum: bk.proRataSum, gapPct: bk.gapPct,
    occupancyCoveredPct: bk.occupancyCoveredPct,
    outOfYear: bk.outOfYear, notEligible: bk.notEligible, uncovered: bk.uncovered,
    notOccupied: bk.notOccupied, claimShortfall: bk.claimShortfall, capTotal: bk.capTotal,
    residual: bk.residual, explained: bk.explained,
    lines: bk.lines.map(l => ({ key: l.key, label: l.label, amount: l.amount })),
    nextStep: window.VarianceBreakdown.nextStep(bk),
    invoices: bk.invoices.map(r => ({ id: r.id, vendor: r.vendor, category: r.category,
      amount: r.amount, allocated: r.allocated, unallocated: r.unallocated,
      eligible: r.eligible, isDirect: r.isDirect, considered: r.considered,
      reason: r.reason, reasonLabel: window.VarianceBreakdown.REASON_LABEL[r.reason] || r.reason,
      coverageShare: r.coverageShare, occupancyShare: r.occupancyShare, claimShare: r.claimShare })),
  };

  out.findings = {
    red: (summary.red || []).map(f => ({ title: f.title, severity: f.severity, blocksBilling: f.blocksBilling, detail: f.detail })),
    yellow: (summary.yellow || []).map(f => ({ title: f.title, severity: f.severity, blocksBilling: f.blocksBilling, detail: f.detail })),
    green: (summary.green || []).map(f => ({ title: f.title })),
  };

  out.exposure = {
    totalPool: expo.totalPool, confirmedAtRisk: expo.confirmedAtRisk,
    requiringReview: expo.requiringReview, excludedRecoverable: expo.excludedRecoverable,
    poolUnsubstantiated: expo.poolUnsubstantiated, poolConcentration: expo.poolConcentration,
    poolFlagged: expo.poolFlagged, unquantified: expo.unquantified,
    counts: expo.counts,
    blockingProperty: (expo.blocking && expo.blocking.property || []).map(b => b.title || b),
    blockingByTenant: Object.fromEntries(Object.entries((expo.blocking && expo.blocking.byTenant) || {})
      .map(([k, v]) => [k, (v || []).map(b => b.title || b)])),
  };

  // The reconciliation summary as the manager reads it, so the words can be
  // checked against the numbers instead of assumed to agree with them.
  const rs = document.querySelector('.reconciliation-summary, .rcs, #reconciliationSummary');
  out.summaryPanelText = rs ? rs.innerText.replace(/\s+/g, ' ').trim() : null;

  return JSON.parse(JSON.stringify(out));
};

// THE BILLING GATE, EXERCISED RATHER THAN INFERRED. Asks the product for each
// tenant's statement and records what came back: a statement, or a refusal.
const STATEMENTS = () => {
  const names = (lastResults || []).map(r => r.name);
  const out = [];
  for (const n of names) {
    try { document.getElementById('reportOverlay').style.display = 'none'; } catch (_) {}
    try { document.getElementById('rptBody').innerHTML = ''; } catch (_) {}
    try { document.getElementById('rptToolbarTitle').textContent = ''; } catch (_) {}
    let threw = null;
    try { generateTenantStatement(n); } catch (e) { threw = e.message; }
    const title = (document.getElementById('rptToolbarTitle') || {}).textContent || '';
    const body  = (document.getElementById('rptBody') || {}).innerText || '';
    const shown = (document.getElementById('reportOverlay') || {}).style.display === 'block';
    const money = body.match(/\$[\d,]+\.\d{2}/g) || [];
    out.push({
      tenant: n, threw, reportShown: shown, reportTitle: title,
      producedStatement: /Tenant Statement —/.test(title),
      looksBlocked: /can.?t be issued|cannot be issued|before this statement|Why it can|not ready/i.test(body),
      bodyLength: body.length,
      firstMoney: money.slice(0, 4),
      bodyFull: body.replace(/\s+/g, ' ').trim().slice(0, 9000),
    });
  }
  try { document.getElementById('reportOverlay').style.display = 'none'; } catch (_) {}
  return JSON.parse(JSON.stringify(out));
};

// Stable render fingerprint of the results surface — used to compare the run
// before a reload with the run restored after one.
const RENDER_FINGERPRINT = () => {
  const el = document.getElementById('resultsBody') || document.getElementById('results');
  const txt = (el ? el.innerText : '').replace(/\s+/g, ' ').trim();
  return {
    title: (document.getElementById('resultsTitle') || {}).textContent || '',
    length: txt.length,
    text: txt,
    tenantRows: Array.from(document.querySelectorAll('.rcs-tenant-row, .result-card, .tenant-result'))
                     .map(n => n.innerText.replace(/\s+/g, ' ').trim()).slice(0, 40),
  };
};

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' });
    return route.abort();
  });
  await ctx.addInitScript(SUPABASE_MOCK);

  const signIn = async () => {
    await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: 45000 });
    await page.fill('#loginEmail', 'ng@fresh-validation.local');
    await page.fill('#loginPassword', 'TestPass123!');
    const appUp = () => page.waitForFunction(() => { const a = document.getElementById('appContent');
      return a && a.style.display !== 'none' && a.style.display !== ''; }, null, { timeout: 15000 });
    await page.click('#loginBtn');
    try { await appUp(); }
    catch (_) { await page.click('#loginBtn').catch(() => {}); await appUp(); }
    await page.waitForFunction(() => typeof _props !== 'undefined' && _props.length > 0, null, { timeout: 45000 });
    await page.evaluate((id) => selectProperty(id), PROP_ID);
    await page.waitForFunction((n) => typeof tenantData !== 'undefined' && tenantData.filter(Boolean).length === n,
                               TENANTS.length, { timeout: 45000 });
    // SET THE CAM YEAR THE WAY A MANAGER DOES — through the Property Setup
    // dropdown. It is not taken from the property: _camYear is a per-USER
    // localStorage preference, and selecting a property does not call
    // setCamYear() with the camYear stored on that property. Left alone, this
    // run reconciles the current year (2026) against a 2025 invoice set.
    await page.evaluate((y) => {
      const sel = document.getElementById('camYearSelect');
      if (sel) { sel.value = String(y); sel.dispatchEvent(new Event('change')); }
      if (typeof getCamYear === 'function' && getCamYear() !== y && typeof setCamYear === 'function') setCamYear(y);
    }, CAM_YEAR);
  };

  const report = { generatedAt: new Date().toISOString() };

  // ── Pass 1: the reconciliation ────────────────────────────────────────────
  await signIn();
  await page.evaluate(async () => { await runAllocation(); });
  await page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                             TENANTS.length, { timeout: 60000 });

  report.run1 = await page.evaluate(OBSERVE);
  report.run1.yearScope = await page.evaluate(() => {
    // _yearScope is stamped on the engine Property, not the app one; the
    // engine's own console line is the record. Read what the app kept instead.
    return { engineInvoiceCount: (typeof _lastEngineInvoices !== 'undefined' ? _lastEngineInvoices.length : null),
             reconciledCount: (typeof _lastReconciledInvoices !== 'undefined' ? _lastReconciledInvoices.length : null) };
  });
  report.render1 = await page.evaluate(RENDER_FINGERPRINT);
  report.tenantCards = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#resultsBody .result-card, #resultsBody [id^="rescard-"], #resultsBody .rescard').forEach(n => {
      const t = n.innerText.replace(/\s+/g, ' ').trim();
      const m = t.match(/^([^·]+?)\s*·/);
      out[(m ? m[1] : t.slice(0, 30)).trim()] = t.slice(0, 4000);
    });
    return out;
  });

  // The variance panel's rendered prose, so the words can be checked against the
  // numbers rather than assumed to match them. It renders into the report
  // overlay (openReport -> #rptBody), not a modal of its own.
  report.variancePanel = await page.evaluate(() => {
    try { if (typeof openVarianceDetails === 'function') openVarianceDetails(); }
    catch (e) { return { error: e.message }; }
    const b = document.getElementById('rptBody');
    return { title: (document.getElementById('rptToolbarTitle') || {}).textContent || '',
             text: b ? b.innerText : null };
  });
  await page.evaluate(() => { try { document.getElementById('reportOverlay').style.display = 'none'; } catch (_) {} });

  // The billing gate, per tenant.
  report.statements = await page.evaluate(STATEMENTS);

  // Phone width, measured on the FULL run rather than the restored one.
  // THE CAM PANE MUST BE THE VISIBLE ONE. The workspace opens on Overview, and
  // measuring #resultsBody while the CAM pane is hidden returns zero overflow
  // for every node in it — a clean phone result about a surface nobody was
  // looking at.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { try { switchWorkspaceTab('cam'); } catch (_) {} });
  await page.waitForTimeout(900);
  await page.evaluate(() => { const r = document.getElementById('results'); if (r) r.scrollIntoView(); });
  await page.waitForTimeout(400);
  report.phonePaneCheck = await page.evaluate(() => {
    const rb = document.getElementById('resultsBody');
    const r  = rb ? rb.getBoundingClientRect() : null;
    return { activeTab: (typeof _activeWorkspaceTab !== 'undefined' ? _activeWorkspaceTab : null),
             resultsBodyVisible: !!(r && r.width > 0 && r.height > 0),
             resultsBodyWidth: r ? Math.round(r.width) : null,
             childCount: rb ? rb.querySelectorAll('*').length : 0 };
  });
  report.phoneRun1 = await page.evaluate(() => {
    const de = document.documentElement;
    const bad = [];
    document.querySelectorAll('#resultsBody *').forEach(n => {
      if (n.scrollWidth > n.clientWidth + 2 && n.clientWidth > 0) {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'visible' || cs.overflowX === 'clip') {
          bad.push({ tag: n.tagName.toLowerCase(), cls: (n.className || '').toString().slice(0, 70),
                     scrollWidth: n.scrollWidth, clientWidth: n.clientWidth });
        }
      }
    });
    return { docScrollWidth: de.scrollWidth, docClientWidth: de.clientWidth,
             horizontalPageScroll: de.scrollWidth > de.clientWidth + 1,
             overflowCount: bad.length, overflowing: bad.slice(0, 25) };
  });
  await page.screenshot({ path: path.join(OUT, 'phone-results-run1.png'), fullPage: false });

  // And the variance report at phone width - the widest table the product emits.
  await page.evaluate(() => { try { openVarianceDetails(); } catch (_) {} });
  await page.waitForTimeout(500);
  report.phoneVarianceReport = await page.evaluate(() => {
    const de = document.documentElement;
    const bad = [];
    document.querySelectorAll('#rptBody *').forEach(n => {
      if (n.scrollWidth > n.clientWidth + 2 && n.clientWidth > 0) {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'visible' || cs.overflowX === 'clip') {
          bad.push({ tag: n.tagName.toLowerCase(), cls: (n.className || '').toString().slice(0, 70),
                     scrollWidth: n.scrollWidth, clientWidth: n.clientWidth });
        }
      }
    });
    const tb = document.querySelector('.rpt-toolbar, #rptToolbar');
    return { docScrollWidth: de.scrollWidth, docClientWidth: de.clientWidth,
             horizontalPageScroll: de.scrollWidth > de.clientWidth + 1,
             toolbarWidth: tb ? Math.round(tb.getBoundingClientRect().width) : null,
             overflowCount: bad.length, overflowing: bad.slice(0, 20) };
  });
  await page.screenshot({ path: path.join(OUT, 'phone-variance-report.png'), fullPage: false });
  await page.evaluate(() => { try { document.getElementById('reportOverlay').style.display = 'none'; } catch (_) {} });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'desktop-results.png'), fullPage: false });


  // ── Pass 2: save, real reload, restore ────────────────────────────────────
  await page.evaluate(async () => { try { await savePropertyData(); } catch (_) {} try { await savePropertyNow(); } catch (_) {} });
  await page.waitForTimeout(1500);

  await signIn();                      // a genuine fresh page load
  // Wait for the restored reconciliation rather than re-running it: the question
  // is whether the SAVED result comes back, not whether a second run agrees.
  const restored = await page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                                              TENANTS.length, { timeout: 20000 })
    .then(() => true).catch(() => false);
  report.restoredWithoutRerun = restored;
  if (!restored) {
    await page.evaluate(async () => { await runAllocation(); });
    await page.waitForFunction((n) => typeof lastResults !== 'undefined' && lastResults.length === n,
                               TENANTS.length, { timeout: 60000 });
  }
  report.run2 = await page.evaluate(OBSERVE);
  report.render2 = await page.evaluate(RENDER_FINGERPRINT);

  // ── Pass 3: phone width ───────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  report.phone = await page.evaluate(() => {
    const de = document.documentElement;
    const overflowing = [];
    document.querySelectorAll('#resultsBody *, #results *').forEach(n => {
      if (n.scrollWidth > n.clientWidth + 2 && n.clientWidth > 0) {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'visible' || cs.overflowX === 'clip') {
          overflowing.push({ tag: n.tagName.toLowerCase(), cls: (n.className || '').toString().slice(0, 60),
                             scrollWidth: n.scrollWidth, clientWidth: n.clientWidth, overflowX: cs.overflowX });
        }
      }
    });
    return {
      docScrollWidth: de.scrollWidth,
      docClientWidth: de.clientWidth,
      horizontalPageScroll: de.scrollWidth > de.clientWidth + 1,
      overflowingUnscrollable: overflowing.slice(0, 25),
      overflowCount: overflowing.length,
    };
  });
  await page.screenshot({ path: path.join(OUT, 'phone-results.png'), fullPage: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'desktop-results.png'), fullPage: false });

  report.pageErrors = pageErrors;
  report.consoleErrors = consoleErrors.slice(0, 40);

  fs.writeFileSync(path.join(OUT, 'fresh-property-result.json'), JSON.stringify(report, null, 2));
  console.log('WROTE ' + path.join(OUT, 'fresh-property-result.json'));
  console.log('pageErrors: ' + pageErrors.length + ' consoleErrors: ' + consoleErrors.length);

  await browser.close();
  server.close();
})().catch(e => { console.error('RUNNER ERROR:', e && e.stack ? e.stack : e); process.exit(1); });
