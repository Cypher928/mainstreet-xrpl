// test-allocation.js
// ============================================================================
// THE CAM ENGINE THAT ACTUALLY RUNS.
//
// This file used to `require('./allocation-engine')` and test runCAMAllocation
// — a second CAM implementation whose result was computed in runAllocation()
// and then discarded four lines later by `lastResults = fullResults`. The two
// engines disagreed (one guarded divide-by-zero and validated the cap range,
// the production one did neither), and every green run of this suite was
// evidence about a function no tenant statement ever came from. That is CAM-6.
//
// runFullReconciliation() lives in script.js and depends on the page —
// currentProperty(), showToast, the Property/Lease/Invoice classes — so it
// cannot be required. It is driven here in a browser instead. Slower, and it
// tests the arithmetic that reaches a tenant.
//
// Run: node test-allocation.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8933;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  await p.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(`window.supabase={createClient:function(){return {auth:{
    getUser:function(){return Promise.resolve({data:{user:{id:'u1',email:'pm@example.com'}},error:null});},
    getSession:function(){return Promise.resolve({data:{session:{user:{id:'u1',email:'pm@example.com'}}},error:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return Promise.resolve({error:null});}},
    rpc:function(){return Promise.resolve({data:null,error:null});},
    from:function(){var q={select:function(){return q;},eq:function(){return q;},neq:function(){return q;},
      is:function(){return q;},not:function(){return q;},order:function(){return q;},limit:function(){return q;},
      ilike:function(){return q;},in:function(){return Promise.resolve({data:[],error:null});},
      single:function(){return Promise.resolve({data:null,error:null});},
      then:function(f){return Promise.resolve({data:[],error:null}).then(f);}};return q;},
    storage:{from:function(){return {getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`);
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);

  // One helper, used by every case: build a property, run the REAL engine.
  const run = (cfg) => p.evaluate((c) => {
    window.currentProperty = function () { return { id: 'p1', tenants: c.tenants.map(t => ({ ...t })) }; };
    const prop = new Property('Test Center', c.totalSqft);
    if (c.camYear !== undefined) prop.camYear = c.camYear;
    prop.addLeases(c.tenants.map(t => {
      const l = new Lease(t.tenant_name, t.unitNumber || '', t.leased_sqft, t.start_date || '', t.end_date || '',
        t.excluded || [], t.cap ?? null, t.capBase ?? null, false, null, t.lease_type || 'NNN');
      l.id = t.id; return l;
    }));
    prop.addInvoices(c.invoices.map((i, n) =>
      new Invoice('i' + n, i.date, i.amount, i.vendor, i.category, '', { camEligible: i.camEligible })));
    // Match invoices the way runAllocation does, so direct/shared split is real.
    const res = runFullReconciliation(prop) || [];
    return res.map(r => ({
      name: r.tenantName || r.name,
      // The engine's own field names. `flags` does not exist on a result — it
      // is `ambiguityFlags`, and reading the wrong one made three checks pass
      // vacuously on an empty array.
      allocated: r.totalAllocated,
      proRataPct: r.proRataPercent,
      flags: (r.ambiguityFlags || []).map(f => f.code),
      flagText: (r.ambiguityFlags || []).map(f => f.explanation || '').join(' | '),
    }));
  }, cfg);

  // ── the baseline allocation this file has always covered ────────────────
  sec('pro-rata allocation and exclusions');
  {
    const r = await run({
      totalSqft: 20000,
      tenants: [
        { id: 't1', tenant_name: 'Sunrise Cafe',   leased_sqft: 2000, excluded: [] },
        { id: 't2', tenant_name: 'TechHub Office', leased_sqft: 5000, excluded: ['janitorial'] },
        { id: 't3', tenant_name: 'MegaMart',       leased_sqft: 8000, excluded: ['landscaping', 'security'] },
      ],
      invoices: [
        { vendor: 'CleanCo',      category: 'janitorial',  amount: 8000, date: '2026-03-01' },
        { vendor: 'LandscapeInc', category: 'landscaping', amount: 6000, date: '2026-03-02' },
        { vendor: 'SecureGuard',  category: 'security',    amount: 4000, date: '2026-03-03' },
        { vendor: 'FixItFast',    category: 'maintenance', amount: 5000, date: '2026-03-04' },
        { vendor: 'UtilityPlus',  category: 'utilities',   amount: 9000, date: '2026-03-05' },
      ],
    });
    const by = Object.fromEntries(r.map(x => [x.name, Math.round(x.allocated * 100) / 100]));
    // Sunrise 10% of all 32,000 = 3,200.
    (by['Sunrise Cafe'] === 3200) ? ok('a tenant with no exclusions pays its full pro-rata share ($3,200)')
      : bad('pro-rata share wrong for Sunrise Cafe', String(by['Sunrise Cafe']));
    // TechHub 25% of (32,000 - 8,000 janitorial) = 6,000.
    (by['TechHub Office'] === 6000) ? ok('an excluded category is removed before the share is taken ($6,000)')
      : bad('exclusion not applied for TechHub', String(by['TechHub Office']));
    // MegaMart 40% of (32,000 - 6,000 - 4,000) = 8,800.
    (by['MegaMart'] === 8800) ? ok('multiple exclusions compound correctly ($8,800)')
      : bad('multiple exclusions wrong for MegaMart', String(by['MegaMart']));
  }

  // ── CAM-1 · currency strings ────────────────────────────────────────────
  sec('CAM-1 · currency parsing reaches the engine');
  {
    const parsed = await p.evaluate(() => ({
      comma:  parseMoney('1,250.00'), dollar: parseMoney('$84,500'),
      paren:  parseMoney('(500)'),    code:   parseMoney('84,500.00 USD'),
      junk:   parseMoney('abc'),      empty:  parseMoney(''), zero: parseMoney(0),
    }));
    (parsed.comma === 1250 && parsed.dollar === 84500 && parsed.code === 84500)
      ? ok('"1,250.00", "$84,500" and "84,500.00 USD" parse at full value')
      : bad('currency strings mis-parsed', JSON.stringify(parsed));
    (parsed.paren === -500) ? ok('an accounting negative "(500)" parses as -500') : bad('paren negative', String(parsed.paren));
    (parsed.junk === null && parsed.empty === null && parsed.zero === 0)
      ? ok('unreadable returns NULL, and zero stays zero — they are different facts')
      : bad('null/zero conflated', JSON.stringify(parsed));

    const r = await run({
      totalSqft: 10000,
      tenants: [{ id: 't1', tenant_name: 'A', leased_sqft: 5000, excluded: [] }],
      invoices: [{ vendor: 'Metro Roofing', category: 'repairs', amount: '$84,500', date: '2026-05-01' }],
    });
    (Math.round(r[0].allocated) === 42250)
      ? ok('an invoice entered as "$84,500" allocates at $84,500, not $0')
      : bad('a currency string was dropped or mis-valued in the ENGINE', String(r[0].allocated));
  }

  // ── CAM-2 · year scoping ────────────────────────────────────────────────
  sec('CAM-2 · a reconciliation allocates only its own year');
  {
    const inv = [
      { vendor: 'ThisYear', category: 'utilities', amount: 10000, date: '2026-03-01' },
      { vendor: 'LastYear', category: 'utilities', amount: 50000, date: '2025-03-01' },
    ];
    const t = [{ id: 't1', tenant_name: 'A', leased_sqft: 5000, excluded: [] }];
    const scoped   = await run({ totalSqft: 10000, tenants: t, invoices: inv, camYear: 2026 });
    const unscoped = await run({ totalSqft: 10000, tenants: t, invoices: inv });
    (Math.round(scoped[0].allocated) === 5000)
      ? ok('a 2026 run allocates only 2026 invoices ($5,000, not $30,000)')
      : bad('prior-year invoices leaked into the reconciliation', String(scoped[0].allocated));
    (Math.round(unscoped[0].allocated) === 30000)
      ? ok('and with no year set, nothing is filtered — the scoping is deliberate, not incidental')
      : bad('unscoped behaviour changed unexpectedly', String(unscoped[0].allocated));
  }
  {
    // An undated invoice is kept, because dropping it would lose a real expense.
    const r = await run({
      totalSqft: 10000, camYear: 2026,
      tenants: [{ id: 't1', tenant_name: 'A', leased_sqft: 5000, excluded: [] }],
      invoices: [{ vendor: 'Undated', category: 'utilities', amount: 10000, date: '' }],
    });
    (Math.round(r[0].allocated) === 5000)
      ? ok('an undated invoice is kept rather than silently dropped')
      : bad('undated invoice handling', String(r[0].allocated));
  }

  // ── CAM-3 · exclusions apply to direct matches too ──────────────────────
  sec('CAM-3 · the exclusion schedule binds direct matches');
  {
    const r = await run({
      totalSqft: 32000,
      tenants: [{ id: 't1', tenant_name: 'Harbor Cafe', leased_sqft: 4200,
                  excluded: ['capital expenditures'] }],
      invoices: [{ vendor: 'Harbor Cafe', category: 'capital expenditures', amount: 50000, date: '2026-06-01' }],
    });
    (Math.round(r[0].allocated) === 0)
      ? ok('a $50,000 excluded capital expenditure matched to the tenant is NOT billed')
      : bad('an excluded category was billed in full via a direct match', String(r[0].allocated));
    r[0].flags.includes('DIRECT_EXCLUDED_CATEGORY')
      ? ok('and the manager is told it was recognised and why it was not billed')
      : bad('the exclusion happened silently', r[0].flags.join(','));
  }

  // ── CAM-4 · whole-invoice assignments are visible ───────────────────────
  sec('CAM-4 · every direct assignment is surfaced');
  {
    const r = await run({
      totalSqft: 32000,
      tenants: [{ id: 't1', tenant_name: 'Harbor Cafe', leased_sqft: 4200, excluded: [] }],
      invoices: [{ vendor: 'Harbor Cafe', category: 'repairs', amount: 9000, date: '2026-06-01' }],
    });
    (Math.round(r[0].allocated) === 9000)
      ? ok('a direct match bills the whole invoice, as designed')
      : bad('direct assignment amount', String(r[0].allocated));
    r[0].flags.includes('DIRECT_ASSIGNMENT')
      ? ok('and it is flagged by name and amount for confirmation')
      : bad('a whole-invoice assignment happened with no flag', r[0].flags.join(','));
    /9,000/.test(r[0].flagText)
      ? ok('the flag states the amount, so it can be checked without opening the invoice')
      : bad('the flag does not name the amount', r[0].flagText.slice(0, 90));
  }

  // ── CAM-4b · the matcher must not manufacture direct matches ────────────
  // Found while writing this file, and the most severe defect in the audit.
  // The haystack included the INVOICE DATE and matching was naive substring:
  //   unit "1" vs "apex roofing 2026-05-01" -> hit at 90% -> whole invoice
  // Units 1 and 2 are the commonest unit numbers there are, so on any property
  // with a Unit 1 tenant EVERY 2026-dated invoice was billed in full to them.
  sec('CAM-4b · direct matching is conservative');
  {
    const cases = await p.evaluate(() => {
      const inv = { vendorName: 'Apex Roofing & Sheet Metal', category: 'repairs', invoiceDate: '2026-05-01' };
      const probe = (name, unit) => {
        const m = matchInvoiceToTenant(inv, [{ tenantName: name, unitNumber: unit, id: 't' }]);
        return m ? m.confidence : 0;
      };
      const legit = matchInvoiceToTenant(
        { vendorName: 'Suite 210 HVAC service', category: 'maintenance', invoiceDate: '2026-05-01' },
        [{ tenantName: 'Harbor Cafe', unitNumber: '210', id: 't' }]);
      return {
        unit1: probe('X', '1'), unit2: probe('Y', '2'),
        singleLetter: probe('A', ''), substring: probe('Roof', ''),
        realName: probe('Apex Roofing & Sheet Metal', ''),
        legitUnit: legit ? legit.confidence : 0,
      };
    });
    (cases.unit1 === 0 && cases.unit2 === 0)
      ? ok('unit "1" and "2" no longer match every dated invoice')
      : bad('a single-digit unit still matches the invoice date', JSON.stringify(cases));
    (cases.singleLetter === 0)
      ? ok('a one-letter tenant name cannot carry a whole invoice')
      : bad('short name still direct-matches', String(cases.singleLetter));
    (cases.substring === 0)
      ? ok('"Roof" does not match "Roofing" — token boundaries, not substrings')
      : bad('substring matching still active', String(cases.substring));
    (cases.realName >= 75)
      ? ok('a genuine vendor/tenant name match still resolves to direct')
      : bad('the fix broke legitimate name matching', String(cases.realName));
    (cases.legitUnit >= 90)
      ? ok('and a real unit reference ("Suite 210") still matches at high confidence')
      : bad('the fix broke legitimate unit matching', String(cases.legitUnit));
  }

  // ── CAM-5 · no rentable area means no reconciliation ────────────────────
  sec('CAM-5 · zero building area refuses rather than dividing');
  {
    const r = await run({
      totalSqft: 0,
      tenants: [{ id: 't1', tenant_name: 'A', leased_sqft: 5000, excluded: [] }],
      invoices: [{ vendor: 'X', category: 'utilities', amount: 10000, date: '2026-03-01' }],
    });
    (Array.isArray(r) && r.length === 0)
      ? ok('a property with no square footage produces no allocation at all')
      : bad('the engine allocated against a zero denominator', JSON.stringify(r));
    const infinite = r.some(x => !Number.isFinite(x.allocated));
    !infinite ? ok('and no Infinity or NaN reaches a result') : bad('a non-finite amount was produced');
  }

  // ── CAM-6 · one engine ──────────────────────────────────────────────────
  sec('CAM-6 · there is only one CAM engine');
  {
    const only = await p.evaluate(() => ({
      full: typeof runFullReconciliation,
      dead: typeof window.runCAMAllocation,
    }));
    (only.full === 'function') ? ok('runFullReconciliation is the engine under test') : bad('engine missing', only.full);
    (only.dead === 'undefined')
      ? ok('the second, discarded engine no longer exists in the app')
      : bad('a second CAM implementation is still present', only.dead);
  }

  (errs.length === 0) ? ok('no uncaught errors during the reconciliations')
                      : bad('uncaught errors', errs.slice(0, 3).join(' | '));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed` + '\x1b[0m');
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
