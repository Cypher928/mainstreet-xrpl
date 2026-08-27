'use strict';
/**
 * test-e2e-billing-readiness.js — one tenant's holdover must not make the rest
 * of the centre unbillable.
 *
 *   node test-e2e-billing-readiness.js
 *
 *   node test-e2e-billing-readiness.js
 *
 * RIVERSIDE COMMONS, the walkthrough that turned I-4 from an architectural
 * concern into a product requirement. A 62,400 sqft strip centre: an anchor
 * grocer holding over on a month-to-month while renewal is negotiated, a Gross
 * lease taking shared CAM, and three inline tenants with nothing wrong.
 *
 * Before: every one of the five was blocked, and Cornerstone's refusal screen
 * could not name a single thing wrong with Cornerstone.
 *
 *     Cornerstone Physical Therapy   BLOCKED   exceptions naming it: 0 of 1
 *
 * Anchor holdover is routine. Asserted here on RENDERED STATEMENTS rather than
 * on the readiness function, because the gate reads a set the unit tests can
 * construct directly and the screen reads whatever generateTenantStatement
 * actually hands it.
 */
process.env.TZ = 'America/New_York';

const SKIP = process.env.SKIP_BROWSER_TESTS === '1';

let pw = null;
if (!SKIP) {
  try { pw = require('playwright'); }
  catch (_) {
    try { pw = require('/opt/node22/lib/node_modules/playwright'); }
    catch (_2) {
      console.error('\n\x1b[31mtest-e2e-billing-readiness: playwright is not installed.\x1b[0m');
      console.error('This suite drives the reconciliation screen in a real browser and');
      console.error('cannot verify anything without one. Install playwright, or set');
      console.error('SKIP_BROWSER_TESTS=1 to deliberately skip it.\n');
      process.exit(1);
    }
  }
}
if (SKIP) {
  console.log('\n\x1b[33m⚠ test-e2e-billing-readiness SKIPPED (SKIP_BROWSER_TESTS=1).\x1b[0m');
  console.log('  The variance CTA and the exception scope column were NOT verified.\n');
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
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
               '.mp4':'video/mp4', '.webm':'video/webm', '.woff2':'font/woff2' };

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(44) + ':', typeof v === 'string' ? v : JSON.stringify(v));

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

// ── Riverside Commons ────────────────────────────────────────────────────────
// A 62,400 sqft neighbourhood strip centre. One anchor grocer, four inline
// tenants, one vacant unit. 2026 CAM reconciliation, run in August 2027 —
// which is when this work actually happens.
//
// The data is deliberately ORDINARY, not adversarial: this is what a manager's
// records look like after a year of AI extraction and manual edits. Where it is
// messy, it is messy in the ways real records are messy.
const PROP_ID = 'rc-prop-000000000001';
const TENANTS = [
  // The anchor. Lease expired at the end of 2025 and they are holding over on a
  // month-to-month while renewal is negotiated — extremely common, and the
  // single most likely thing to trip a CAM run.
  { id: 'rc-t-grocer', tenant_name: 'Value Grocers #418', leased_sqft: 42000,
    lease_type: 'Triple Net (NNN)', start_date: '2016-01-01', end_date: '2025-12-31',
    cap: '4', capBaseAmount: '58000', excluded_categories: 'capital', status: 'complete' },

  // Straightforward inline tenant.
  { id: 'rc-t-pt', tenant_name: 'Cornerstone Physical Therapy', leased_sqft: 8500,
    lease_type: 'Triple Net (NNN)', start_date: '2022-06-01', end_date: '2032-05-31',
    cap: '5', capBaseAmount: '12000', excluded_categories: '', status: 'complete' },

  // A GROSS lease in a NNN centre. Happens when a landlord takes a deal to fill
  // a unit. Should NOT be receiving shared CAM.
  { id: 'rc-t-wok', tenant_name: 'Golden Wok', leased_sqft: 3100,
    lease_type: 'Gross', start_date: '2023-09-01', end_date: '2028-08-31',
    cap: null, capBaseAmount: null, excluded_categories: '', status: 'complete' },

  // Square footage came off the lease exhibit with a comma. This is exactly the
  // shape I-1 was about, and the point of including it is to see whether a
  // manager would ever notice.
  { id: 'rc-t-clean', tenant_name: 'Sunrise Cleaners', leased_sqft: '2,400',
    lease_type: 'Triple Net (NNN)', start_date: '2021-03-01', end_date: '2031-02-28',
    cap: null, capBaseAmount: null, excluded_categories: '', status: 'complete' },

  // Extraction never found the end date on a scanned lease.
  { id: 'rc-t-nails', tenant_name: 'Bella Nails & Spa', leased_sqft: 1200,
    lease_type: 'Triple Net (NNN)', start_date: '2024-11-01', end_date: null,
    cap: null, capBaseAmount: null, excluded_categories: '', status: 'complete' },
];
// 57,200 of 62,400 leased. Unit 7 (5,200 sqft) has been dark since March.

const doc = n => ({ fileName: n + '.pdf', fileUrl: 'https://mock.local/' + n + '.pdf' });
const INVOICES = [
  { id: 'rc-i-01', vendorName: 'Meridian Landscape Services', amount: '8400',    category: 'grounds',     invoiceDate: '2026-04-15', camEligible: true, ...doc('meridian-q2') },
  { id: 'rc-i-02', vendorName: 'Northline Snow & Ice',        amount: '12750',   category: 'snow',        invoiceDate: '2026-02-28', camEligible: true, ...doc('northline') },
  { id: 'rc-i-03', vendorName: 'SweepRight Parking Lot',      amount: '3600',    category: 'grounds',     invoiceDate: '2026-06-30', camEligible: true, ...doc('sweepright') },
  { id: 'rc-i-04', vendorName: 'Consolidated Power',          amount: '9240',    category: 'utilities',   invoiceDate: '2026-12-31', camEligible: true, ...doc('cp-annual') },
  // Straight off a PDF, currency-formatted. Pre-I-2 this counted as $0 in the pool.
  { id: 'rc-i-05', vendorName: 'Continental Casualty',        amount: '$18,500.00', category: 'insurance', invoiceDate: '2026-01-15', camEligible: true, ...doc('cna-2026') },
  { id: 'rc-i-06', vendorName: 'Metro Waste Solutions',       amount: '6900',    category: 'trash',       invoiceDate: '2026-07-01', camEligible: true, ...doc('metro') },
  // Roof section replacement. The grocer's lease excludes capital from CAM.
  { id: 'rc-i-07', vendorName: 'Apex Roofing & Sheet Metal',  amount: '14200',   category: 'capital',     invoiceDate: '2026-08-20', camEligible: true, ...doc('apex-roof') },
  { id: 'rc-i-08', vendorName: 'Sentinel Patrol',             amount: '5400',    category: 'security',    invoiceDate: '2026-05-01', camEligible: true, ...doc('sentinel') },
  // The invoice date never came off the scan.
  { id: 'rc-i-09', vendorName: 'ClimateCare HVAC',            amount: '4100',    category: 'hvac',        invoiceDate: '',           camEligible: true, ...doc('climatecare') },
  { id: 'rc-i-10', vendorName: 'Riverside Commons Management',amount: '11000',   category: 'management',  invoiceDate: '2026-12-31', camEligible: true, ...doc('mgmt-fee') },
  // No source document attached — the bookkeeper entered it from a statement.
  { id: 'rc-i-11', vendorName: 'City of Fairhaven — Water',   amount: '2860',    category: 'utilities',   invoiceDate: '2026-09-30', camEligible: true },
];
const SUPABASE_MOCK = `
(function () {
  var USER_ID = 'rc-user';
  var _user = { id: USER_ID, email: 'rc@e2e-test.local' };
  var _session = null;
  var KEY = '__rc_store';
  var seed = {
    properties: [{
      id: ${JSON.stringify(PROP_ID)}, user_id: USER_ID, name: 'Riverside Commons', sqft: 62400,
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


// The outcome this suite exists to hold. Value Grocers is held by its own
// expired lease; Golden Wok by an unconfirmed CAM treatment on a Gross lease;
// the other three by nothing at all.
const EXPECTED = {
  // Carries BOTH an expired lease and an exclusion the matcher cannot apply. It
  // used to land on the exclusion screen first; I-12 puts the material reason in
  // front and keeps the exclusion as a secondary section.
  'Value Grocers #418':           { bills: false, label: 'Not ready to bill' },
  'Golden Wok':                   { bills: false, label: 'Needs confirmation before billing' },
  'Cornerstone Physical Therapy': { bills: true,  label: 'Ready to bill' },
  'Sunrise Cleaners':             { bills: true,  label: 'Ready to bill' },
  'Bella Nails & Spa':            { bills: true,  label: 'Ready to bill' },
};

(async () => {
  const server  = await startServer();
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**', r => {
    const u = r.request().url();
    if (u.startsWith('http://127.0.0.1:' + PORT)) return r.continue();
    if (/supabase-js/.test(u)) return r.fulfill({ status:200, contentType:'application/javascript', body:'/**/' });
    return r.abort();
  });
  await page.addInitScript(SUPABASE_MOCK);
  await page.addInitScript(() => { window.__PROP_ID = 'rc-prop-000000000001'; });

  console.log('\n══ Riverside Commons — per-tenant billing readiness ══');

  await page.goto('http://127.0.0.1:' + PORT + '/?signin=1', { waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForSelector('#loginBtn', { state:'visible', timeout:20000 });
  // The button paints with the HTML; submitAuth() arrives with script.js. The
  // form is wired as onsubmit="submitAuth(event)", an inline attribute, so a
  // click in the gap between those two moments fires a ReferenceError and is
  // LOST — after which the suite waits out its full timeout for an app that was
  // never told to sign in. Three suites failed this way intermittently, only
  // ever inside the full regression, where a dozen browsers have already run.
  // Waiting for the handler states the real precondition.
  await page.waitForFunction(() => typeof submitAuth === 'function', null, { timeout: 45000 });
  await page.fill('#loginEmail','rc@e2e-test.local'); await page.fill('#loginPassword','TestPass123!');
  await page.click('#loginBtn');
  await page.waitForFunction(() => { const a=document.getElementById('appContent');
    return a && a.style.display !== 'none' && a.style.display !== ''; }, null, { timeout:45000 });
  await page.waitForFunction(() => typeof _props!=='undefined' && _props.length>0, null, { timeout:45000 });
  await page.evaluate(() => selectProperty(window.__PROP_ID));
  await page.waitForFunction(() => typeof tenantData!=='undefined' && tenantData.filter(Boolean).length===5, null, { timeout:45000 });
  await page.evaluate(async () => { await runAllocation(); await new Promise(r=>setTimeout(r,600)); });
  await page.waitForFunction(() => typeof lastResults!=='undefined' && lastResults.length===5, null, { timeout:45000 });

  const run = await page.evaluate(() => ({
    pool: lastTotal, tenants: lastResults.map(r=>r.name),
    proRata: +lastResults.reduce((s,r)=>s+r.proRataPercent,0).toFixed(1),
  }));
  R('pool', '$' + run.pool.toLocaleString());
  R('reconciled', run.tenants);
  yes('the fixture reconciles all five leases',
      run.tenants.length === 5 && run.pool === 96950, JSON.stringify(run));
  // The comma'd square footage must still be in the run — I-1 guarding I-4's fixture.
  yes('Sunrise Cleaners ("2,400" sqft) is in the reconciliation',
      run.tenants.indexOf('Sunrise Cleaners') >= 0, JSON.stringify(run.tenants));

  // ── the property headline ────────────────────────────────────────────────
  console.log('\n── The property still has a verdict of its own ──');
  const prop = await page.evaluate(() => {
    const AXs = window.AuditExposure;
    const ex  = AXs.deriveExposure(buildAuditSummary(), lastTotal || 0);
    const b = document.getElementById('resultsBody');
    return { verdict: AXs.billingReadiness(ex),
             propertyBlockers: ex.blocking.property.length,
             badge: (()=>{const n=b.querySelector('.rcs-readiness-badge');return n?n.textContent.trim():null;})() };
  });
  R('property verdict', prop.verdict.label + ' — ' + prop.verdict.reason);
  R('badge on the CAM screen', prop.badge);
  yes('the property headline is kept even though tenants can bill',
      prop.verdict.canBill === false && prop.verdict.label === 'Not ready to bill', JSON.stringify(prop.verdict));
  yes('and it counts tenants rather than claiming no statement can issue',
      /2 tenants cannot be billed yet/.test(prop.verdict.reason)
        && !/before statements are issued/.test(prop.verdict.reason), prop.verdict.reason);
  yes('no property-scoped blocker on this fixture', prop.propertyBlockers === 0, String(prop.propertyBlockers));
  yes('the CAM screen badge still shows the property state',
      !!prop.badge && /not ready/i.test(prop.badge), String(prop.badge));

  // ── the matrix, from RENDERED statements ─────────────────────────────────
  console.log('\n── Each statement, actually generated ──');
  const rows = [];
  for (const name of Object.keys(EXPECTED)) {
    const r = await page.evaluate(async (n) => {
      generateTenantStatement(n);
      await new Promise(x=>setTimeout(x,450));
      const body = document.getElementById('rptBody');
      const txt  = body.innerText || body.textContent;
      const out = {
        title: (document.getElementById('rptToolbarTitle')||{}).textContent,
        refused: /HAS NOT BEEN ISSUED/i.test(txt),
        isStatement: /TENANT CAM STATEMENT/i.test(txt),
        label: (body.querySelector('.rpt-readiness')||{}).textContent
          ? body.querySelector('.rpt-readiness').textContent.replace(/\s+/g,' ').trim().split('—')[0].trim() : null,
        mentionsOtherTenant: ['Value Grocers #418','Golden Wok','Cornerstone Physical Therapy',
                              'Sunrise Cleaners','Bella Nails & Spa']
          .filter(o => o !== n && new RegExp(o.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(txt)),
      };
      closeReport(); return out;
    }, name);
    rows.push({ name, ...r });
    console.log('  ' + name.padEnd(30) + (r.refused ? 'REFUSED' : 'ISSUED ') + '  ' + (r.label || ''));
  }

  rows.forEach(r => {
    const want = EXPECTED[r.name];
    yes(`${r.name}: statement ${want.bills ? 'issues' : 'is refused'}`,
        r.refused === !want.bills, JSON.stringify(r));
    if (want.bills) {
      yes(`${r.name}: and it is a real statement`, r.isStatement, JSON.stringify(r));
    } else {
      yes(`${r.name}: refusal reads "${want.label}"`,
          (r.label || '').indexOf(want.label) === 0, String(r.label));
    }
  });

  const billable = rows.filter(r => !r.refused).map(r => r.name);
  yes('THE FIX: three clean tenants bill despite the anchor holding over',
      billable.length === 3
        && billable.indexOf('Cornerstone Physical Therapy') >= 0
        && billable.indexOf('Sunrise Cleaners') >= 0
        && billable.indexOf('Bella Nails & Spa') >= 0,
      JSON.stringify(billable));

  // ── the refusals must be about the tenant in front of you ────────────────
  console.log('\n── A refusal explains THIS tenant, not somebody else ──');
  const gw = rows.find(r => r.name === 'Golden Wok');
  yes('Golden Wok is not told another tenant’s lease expired',
      gw.mentionsOtherTenant.length === 0,
      `the refusal names: ${JSON.stringify(gw.mentionsOtherTenant)}`);

  const detail = await page.evaluate(async () => {
    generateTenantStatement('Golden Wok'); await new Promise(x=>setTimeout(x,450));
    const body = document.getElementById('rptBody');
    const txt  = body.innerText || body.textContent;
    const tbl  = body.querySelector('table');
    const out = {
      rows: tbl ? [...tbl.querySelectorAll('tbody tr')].map(r =>
        [...r.querySelectorAll('td')].map(c => c.textContent.replace(/\s+/g,' ').trim())) : [],
      saysLeaseExpired: /lease on file has expired/.test(txt),
      saysOthersHeld: /other tenant/.test(txt),
      lead: (body.querySelector('.rpt-helper-text')||{}).textContent.replace(/\s+/g,' ').trim(),
    };
    closeReport(); return out;
  });
  R('rows on the refusal', detail.rows.map(r => r[0] + ' | ' + (r[1]||'').slice(0,44)));
  yes('the refusal lists only what blocks Golden Wok',
      detail.rows.length === 1 && /Gross-lease/.test(detail.rows[0][1] || ''),
      JSON.stringify(detail.rows));
  yes('THE NOTE I BROKE: it no longer claims Golden Wok’s lease expired',
      detail.saysLeaseExpired === false,
      'the unconditional expired-lease explanation is back on a screen where it is false');
  yes('and it says other tenants are held for their own reasons',
      detail.saysOthersHeld === true, detail.lead.slice(0,200));

  // ── the anchor's refusal leads with the material reason ──────────────────
  //
  // WAS: "Acknowledging the exclusion still lands on the expired lease". This
  // tenant carries both, and the exclusion gate used to return first — so the
  // screen was about "capital / ambiguous / repairs" and the holdover was
  // reachable only by pressing "I have reviewed these — issue the statement",
  // a button promising a document it could not produce. I-12 reverses the order;
  // the exclusion is kept below, where it is context rather than the headline.
  console.log('\n── The anchor is refused for the reason that matters ──');
  const anchor = await page.evaluate(async () => {
    generateTenantStatement('Value Grocers #418'); await new Promise(x=>setTimeout(x,500));
    const b = document.getElementById('rptBody');
    // innerText for the HEAD (it preserves the visual line order a reader sees);
    // textContent for presence checks, because innerText omits anything outside
    // the overlay's visible region and would report a rendered section as absent.
    const txt = b.innerText || b.textContent;
    const head = txt.replace(/\n{2,}/g,'\n').trim().split('\n').slice(0, 6).join(' ');
    const out = {
      refused: /HAS NOT BEEN ISSUED/i.test(txt),
      label: (b.querySelector('.rpt-readiness')||{}).textContent
        ? b.querySelector('.rpt-readiness').textContent.replace(/\s+/g,' ').trim().split('—')[0].trim() : null,
      leadsWithLease: /lease that ended 2025-12-31/.test(head),
      leadsWithExclusion: /exclusion in this lease/.test(head),
      // textContent, not innerText — see the note on the head capture below.
      keepsExclusion: /Also on this lease/.test(b.textContent),
      promisesIssue: [...b.querySelectorAll('button')].some(x=>/issue the statement/i.test(x.textContent)),
      leaksOtherTenants: ['Golden Wok','Cornerstone Physical Therapy','Sunrise Cleaners','Bella Nails']
        .filter(o => txt.indexOf(o) >= 0),
    };
    closeReport(); return out;
  });
  R('the anchor refusal', anchor);
  yes('it is refused, by the audit gate',
      anchor.refused === true && anchor.label === 'Not ready to bill', JSON.stringify(anchor));
  yes('THE ORDERING: it leads with the expired lease, not the exclusion',
      anchor.leadsWithLease === true && anchor.leadsWithExclusion === false, JSON.stringify(anchor));
  yes('the exclusion is preserved below rather than dropped',
      anchor.keepsExclusion === true, JSON.stringify(anchor));
  yes('no button promises to issue a statement that is refused',
      anchor.promisesIssue === false, JSON.stringify(anchor));
  yes('no other tenant appears on its refusal',
      anchor.leaksOtherTenants.length === 0, JSON.stringify(anchor.leaksOtherTenants));

  // ── I-12 · the verdict must be VISIBLE, not merely correct ───────────────
  //
  // I-4 answered "can I bill this tenant" correctly and reported it nowhere. The
  // results table's last column read "Calc verified" for every tenant — a
  // statement about the arithmetic — and the only billing signal on screen was a
  // property badge, true of the property and false of the tenants under it. A
  // manager had to generate every statement to find the ones that work.
  console.log('\n── I-12: billing status on the results screen ──');
  const surf = await page.evaluate(() => {
    const b = document.getElementById('resultsBody');
    const roster = b.querySelector('.rcs-bill-roster');
    return {
      columns: [...b.querySelectorAll('thead th')].map(h => h.textContent.replace(/\s+/g,' ').trim()),
      rows: [...b.querySelectorAll('.rcs-row')].map(r => {
        const c = [...r.querySelectorAll('td')].map(x => x.textContent.replace(/\s+/g,' ').trim());
        const chip = r.querySelector('.rcs-bill');
        return { name: c[0], calc: c[5], billing: c[6],
                 cls: chip ? chip.className : null,
                 onclick: chip ? chip.getAttribute('onclick') : null,
                 tip: chip ? chip.getAttribute('title') : null };
      }),
      roster: roster ? roster.textContent.replace(/\s+/g,' ').trim() : null,
      rosterNames: roster ? roster.getAttribute('title') : null,
      footer: (() => { const f = b.querySelector('.rcs-bill-total'); return f ? f.textContent.trim() : null; })(),
    };
  });
  R('columns', surf.columns);
  surf.rows.forEach(r => console.log('    ' + (r.name||'').padEnd(30) + (r.calc||'').padEnd(16) + (r.billing||'')));
  R('roster', surf.roster + '  — ' + surf.rosterNames);

  yes('the results table carries a Billing status column',
      surf.columns.indexOf('Billing status') >= 0, JSON.stringify(surf.columns));
  yes('and keeps the CAM calculation column beside it',
      surf.columns.indexOf('CAM calculation') >= 0, JSON.stringify(surf.columns));

  const by = Object.fromEntries(surf.rows.map(r => [r.name, r]));
  yes('Value Grocers reads Blocked', (by['Value Grocers #418']||{}).billing === 'Blocked',
      JSON.stringify(by['Value Grocers #418']));
  yes('Golden Wok reads Needs confirmation', (by['Golden Wok']||{}).billing === 'Needs confirmation',
      JSON.stringify(by['Golden Wok']));
  ['Cornerstone Physical Therapy','Sunrise Cleaners','Bella Nails & Spa'].forEach(n =>
    yes(`${n} reads Billable`, (by[n]||{}).billing === 'Billable', JSON.stringify(by[n])));

  yes('every chip is colour-coded by its state, not by severity',
      surf.rows.every(r => /rcs-bill--(billable|confirm|blocked)/.test(r.cls || '')),
      JSON.stringify(surf.rows.map(r => r.cls)));
  yes('every chip carries the reason as its tooltip',
      surf.rows.every(r => (r.tip || '').length > 10), JSON.stringify(surf.rows.map(r => r.tip)));
  yes('and every chip navigates into the existing statement workflow',
      surf.rows.every(r => /^generateTenantStatement\(/.test(r.onclick || '')),
      JSON.stringify(surf.rows.map(r => r.onclick)));

  // THE ACCEPTANCE CRITERION: the count is readable without opening anything.
  yes('THE PHONE TEST: the screen states how many tenants are billable',
      surf.roster === '3 of 5 tenants billable', String(surf.roster));
  yes('and names them without opening a statement',
      /Cornerstone Physical Therapy/.test(surf.rosterNames || '')
        && /Sunrise Cleaners/.test(surf.rosterNames || '')
        && !/Value Grocers/.test(surf.rosterNames || ''), String(surf.rosterNames));
  yes('the table footer agrees with the roster line',
      surf.footer === '3 of 5 billable', String(surf.footer));
  yes('the roster count matches the chips exactly',
      surf.rows.filter(r => r.billing === 'Billable').length === 3, JSON.stringify(surf.rows.map(r=>r.billing)));

  // ── I-12 · the material reason speaks first ──────────────────────────────
  console.log('\n── I-12: refusal ordering ──');
  const order = await page.evaluate(async () => {
    // Give the anchor an exclusion the matcher cannot apply, so BOTH gates hit
    // the same tenant — the condition under which the technicality used to win.
    const t = tenantData.filter(Boolean).find(x => /Value Grocers/.test(x.tenant_name));
    t.excluded_categories = 'capital';
    currentProperty().tenants = tenantData.filter(Boolean);
    await runAllocation(); await new Promise(x => setTimeout(x, 500));
    generateTenantStatement('Value Grocers #418'); await new Promise(x => setTimeout(x, 500));
    const b = document.getElementById('rptBody');
    const txt = b.innerText || b.textContent;
    const head = txt.replace(/\n{2,}/g,'\n').trim().split('\n').slice(0, 6);
    const o = {
      head,
      leadsWithMaterial: /lease that ended/.test(head.join(' ')),
      leadsWithExclusion: /exclusion in this lease/.test(head.join(' ')),
      keepsExclusion: /Also on this lease/.test(b.textContent),
      exclusionDetail: /capital/.test(b.textContent) && /ambiguous/.test(b.textContent),
      buttons: [...b.querySelectorAll('button')].map(x => x.textContent.replace(/\s+/g,' ').trim()),
    };
    closeReport(); return o;
  });
  console.log('  first lines of the refusal:');
  order.head.forEach(l => console.log('    ' + l.slice(0, 96)));
  yes('THE MATERIAL REASON LEADS — the expired lease, not the exclusion',
      order.leadsWithMaterial === true && order.leadsWithExclusion === false,
      JSON.stringify(order.head));
  yes('the exclusion is preserved as a secondary section',
      order.keepsExclusion === true && order.exclusionDetail === true, JSON.stringify(order));
  yes('and the screen no longer offers a button promising to issue the statement',
      !order.buttons.some(x => /issue the statement/i.test(x)), JSON.stringify(order.buttons));

  const held = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.tenant-stmt-card-btn')].map(b => b.textContent.replace(/\s+/g,' ').trim());
    return btns;
  });
  R('result-card buttons', held);
  yes('a held tenant\'s card button does not read "Tenant Statement"',
      held.some(b => /Why it/.test(b) || /Confirm to bill/.test(b)), JSON.stringify(held));

  yes('no uncaught page errors', errors.length === 0, errors.slice(0,3).join(' | '));

  const TOTAL = 46;
  yes(`suite runs all ${TOTAL} checks`, pass + fail + 1 === TOTAL, `saw ${pass + fail + 1}`);
  await browser.close(); server.close();
  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('\nHARNESS FAILURE:', e); process.exit(1); });
