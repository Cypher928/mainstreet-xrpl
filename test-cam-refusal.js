// test-cam-refusal.js
// ============================================================================
// A RUN THE ENGINE REFUSED MUST NOT BE DESCRIBED AS A RECONCILIATION.
//
// runFullReconciliation already refuses when no invoice is dated in the CAM year
// being billed, and records that on the property as `_yearScope.refused`. The
// defect this file covers was entirely downstream of that: the application read
// an empty result list, could not tell a refusal from a run where nobody
// happened to be billed, and wrote a success everywhere it could reach.
//
// So every case below drives the REAL engine to produce the verdict and feeds
// that verdict — untouched — to the REAL notice builder and renderer. Nothing
// here constructs a scope object by hand for the happy path, because the thing
// under test is precisely whether the two halves agree.
//
// A NOTE ON FIXTURES. Cascade Commons cannot exercise any of this: its invoice
// dates match its CAM year, so a correct refusal and a missing refusal look the
// same there. Every fixture in this file is built so that the right answer and
// the wrong answer DIFFER — in particular the mixed-year and undated-only cases,
// which must NOT refuse, and which are what catches a fix that refuses too much.
//
// Run: node test-cam-refusal.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8947;
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
  await p.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
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

  // Drive the REAL engine, then the REAL notice builder on whatever it recorded.
  // The scope is never authored here — it is read back off the property the
  // engine was handed, which is the only place the verdict lives.
  const run = (cfg) => p.evaluate((c) => {
    window.currentProperty = function () { return { id: 'p1', tenants: c.tenants.map(t => ({ ...t })) }; };
    const prop = new Property('Test Center', c.totalSqft);
    if (c.camYear !== undefined) prop.camYear = c.camYear;
    prop.addLeases(c.tenants.map(t => {
      const l = new Lease(t.tenant_name, '', t.leased_sqft, t.start_date || '', t.end_date || '',
        [], t.cap ?? null, null, false, null, 'NNN');
      l.id = t.id; return l;
    }));
    prop.addInvoices(c.invoices.map((i, n) =>
      new Invoice('i' + n, i.date, i.amount, i.vendor, i.category, '', {})));
    const results = runFullReconciliation(prop) || [];
    const scope   = prop._yearScope || null;
    const notice  = camRefusalNotice(scope);
    const html    = _camRefusalHtml(scope);
    return { resultCount: results.length, scope, notice, html };
  }, cfg);

  const TENANTS = [
    { id: 't1', tenant_name: 'Cedar Park Dental',  leased_sqft: 4200, start_date: '2022-03-01', end_date: '2027-02-28', cap: null },
    { id: 't2', tenant_name: 'Bright Leaf Grocers', leased_sqft: 9100, start_date: '2021-06-01', end_date: '2028-05-31', cap: null },
  ];

  // ── A. the reproduced blocker: every invoice dated outside the billed year ──
  sec('A · the year the manager billed has no invoices in it');
  let refusedScope = null;
  {
    const r = await run({
      totalSqft: 26000, camYear: 2026, tenants: TENANTS,
      invoices: [
        { vendor: 'Northside Landscaping', category: 'landscaping', amount: 18400, date: '2025-04-12' },
        { vendor: 'Talon Security',        category: 'security',    amount: 26100, date: '2025-05-03' },
        { vendor: 'Pacific Facilities',    category: 'janitorial',  amount: 31250, date: '2025-06-21' },
        { vendor: 'Cascade Insurance',     category: 'insurance',   amount: 42000, date: '2025-02-01' },
      ],
    });
    refusedScope = r.scope;
    (r.resultCount === 0) ? ok('no tenant is allocated anything')
      : bad('the engine allocated on a year with no invoices', String(r.resultCount));
    (r.scope && r.scope.refused === true) ? ok('the engine records the run as refused')
      : bad('_yearScope.refused was not set', JSON.stringify(r.scope));
    (r.scope && r.scope.reason === 'no_dated_invoice_in_year')
      ? ok('the refusal names which condition fired')
      : bad('wrong refusal reason', JSON.stringify(r.scope));
    (r.notice && typeof r.notice.title === 'string') ? ok('a notice is produced from that verdict')
      : bad('camRefusalNotice returned nothing for a refused run', JSON.stringify(r.notice));
    // What the manager is told.
    const txt = r.notice ? [r.notice.title, r.notice.detail, r.notice.consequence, r.notice.action].join(' ') : '';
    /\b2026\b/.test(txt) ? ok('the notice names the year that was billed')
      : bad('the billed year is not in the notice', txt);
    /\b4\b/.test(txt) ? ok('the notice names how many invoices were looked at')
      : bad('the invoice count is not in the notice', txt);
    /no tenant was charged/i.test(txt) ? ok('it says plainly that nobody was charged')
      : bad('the notice does not say nobody was charged', txt);
    /not saved as a reconciliation|nothing was saved/i.test(txt)
      ? ok('it says plainly that nothing was recorded as a reconciliation')
      : bad('the notice does not say the run was not recorded', txt);
    /switch the CAM year|upload invoices for 2026/i.test(txt)
      ? ok('it tells the manager what to do next')
      : bad('the notice offers no way forward', txt);
    // The failure that started this: a screen that reads like a completed run.
    // Both headlines the product used to emit on this path are ruled out by
    // shape — the results heading "2026 CAM — <property>" and the timeline's
    // "CAM reconciled — 2026" — and the replacement has to carry a negation.
    {
      const t = r.notice.title;
      const looksLikeSuccess = /^\d{4} CAM —/.test(t) || /^CAM reconciled/i.test(t);
      (!looksLikeSuccess && /\bno\b/i.test(t))
        ? ok('the headline denies the reconciliation rather than announcing one')
        : bad('the headline could be read as a completed run', t);
    }
    !/\$/.test(txt) ? ok('no dollar total is presented alongside the refusal')
      : bad('a money figure appears in a refusal notice', txt);
  }

  // ── B. the negative control the demo cannot provide ─────────────────────────
  sec('B · invoices dated IN the billed year — nothing may be refused');
  {
    const r = await run({
      totalSqft: 26000, camYear: 2026, tenants: TENANTS,
      invoices: [
        { vendor: 'Northside Landscaping', category: 'landscaping', amount: 18400, date: '2026-04-12' },
        { vendor: 'Talon Security',        category: 'security',    amount: 26100, date: '2026-05-03' },
      ],
    });
    (r.resultCount === 2) ? ok('both tenants are allocated')
      : bad('an in-year run produced the wrong number of results', String(r.resultCount));
    (!r.scope || r.scope.refused !== true) ? ok('the engine does not record a refusal')
      : bad('an in-year run was recorded as refused', JSON.stringify(r.scope));
    (r.notice === null) ? ok('no refusal notice is produced')
      : bad('a refusal notice appeared on a successful run', JSON.stringify(r.notice));
    (r.html === '') ? ok('no refusal panel is rendered')
      : bad('a refusal panel was rendered on a successful run', r.html.slice(0, 160));
  }

  // ── C. the discriminating case: SOME invoices in year ───────────────────────
  sec('C · one invoice in the billed year is enough — the run proceeds');
  {
    const r = await run({
      totalSqft: 26000, camYear: 2026, tenants: TENANTS,
      invoices: [
        { vendor: 'Northside Landscaping', category: 'landscaping', amount: 18400, date: '2025-04-12' },
        { vendor: 'Talon Security',        category: 'security',    amount: 26100, date: '2025-05-03' },
        { vendor: 'Pacific Facilities',    category: 'janitorial',  amount: 31250, date: '2026-06-21' },
      ],
    });
    (r.resultCount === 2) ? ok('the tenants are allocated from the in-year invoice')
      : bad('a partially in-year run was blocked', String(r.resultCount));
    (r.scope && r.scope.refused !== true) ? ok('the engine does not refuse')
      : bad('a partially in-year run was refused', JSON.stringify(r.scope));
    (r.scope && r.scope.excluded === 2 && r.scope.datedInYear === 1)
      ? ok('the year scope still counts what it set aside (2 out, 1 in)')
      : bad('year-scope counts are wrong', JSON.stringify(r.scope));
    (r.notice === null) ? ok('no refusal notice is produced')
      : bad('a refusal notice appeared on a run that went ahead', JSON.stringify(r.notice));
  }

  // ── D. undated invoices alongside out-of-year ones ──────────────────────────
  sec('D · undated invoices are named as undated, not as wrongly dated');
  {
    const r = await run({
      totalSqft: 26000, camYear: 2026, tenants: TENANTS,
      invoices: [
        { vendor: 'Northside Landscaping', category: 'landscaping', amount: 18400, date: '2025-04-12' },
        { vendor: 'Talon Security',        category: 'security',    amount: 26100, date: '2025-05-03' },
        { vendor: 'Pacific Facilities',    category: 'janitorial',  amount: 31250, date: '' },
      ],
    });
    (r.scope && r.scope.refused === true) ? ok('two dated invoices outside the year still refuse the run')
      : bad('the run was not refused', JSON.stringify(r.scope));
    (r.scope && r.scope.excluded === 2 && r.scope.undated === 1)
      ? ok('the scope separates the 2 misdated from the 1 undated')
      : bad('the scope did not separate them', JSON.stringify(r.scope));
    const txt = r.notice ? r.notice.detail : '';
    /2 (are|is) dated outside it/.test(txt)
      ? ok('the notice says 2 are dated outside the year')
      : bad('the misdated count is wrong or missing', txt);
    /1 carries no date at all/.test(txt)
      ? ok('the notice says 1 carries no date at all')
      : bad('the undated invoice is not distinguished', txt);
    !/All 3 invoices/.test(txt)
      ? ok('it does not claim all three were misdated')
      : bad('the notice lumps the undated invoice in with the misdated ones', txt);
  }

  // ── D2. the other refusal the engine can record ────────────────────────────
  // The engine has two refusal branches and writes `all_out_of_year` on the
  // second. The first one — no_dated_invoice_in_year — fires on every input the
  // second would catch, so it shadows it and this reason cannot be produced
  // through a real run today. The scope shape is still written to the property,
  // so the wording it produces is covered here directly rather than left to
  // whichever refusal happens to be reachable.
  sec('D2 · the all-out-of-year wording');
  {
    const r = await p.evaluate(() => {
      const scope = { year: 2026, excluded: 5, undated: 0, datedInYear: 0,
                      refused: true, reason: 'all_out_of_year' };
      const n = camRefusalNotice(scope);
      return { detail: n ? n.detail : null, title: n ? n.title : null };
    });
    /All 5 invoices loaded are dated outside the 2026 CAM year/.test(r.detail || '')
      ? ok('it says all 5 are dated outside the year')
      : bad('the all-out-of-year wording is wrong', String(r.detail));
    !/carries no date|carry no date/.test(r.detail || '')
      ? ok('it does not mention undated invoices when there are none')
      : bad('undated invoices are mentioned where there are none', String(r.detail));
    /No CAM was reconciled for 2026/.test(r.title || '')
      ? ok('the headline is the same denial either way')
      : bad('the headline differs by reason', String(r.title));
  }

  // ── E. undated ONLY — deliberately allowed, must not refuse ─────────────────
  sec('E · invoices with no dates at all do not contradict the year');
  {
    const r = await run({
      totalSqft: 26000, camYear: 2026, tenants: TENANTS,
      invoices: [
        { vendor: 'Northside Landscaping', category: 'landscaping', amount: 18400, date: '' },
        { vendor: 'Talon Security',        category: 'security',    amount: 26100, date: '' },
      ],
    });
    (r.resultCount === 2) ? ok('the run goes ahead on undated invoices')
      : bad('an undated-only run was blocked', String(r.resultCount));
    (r.notice === null) ? ok('no refusal notice is produced')
      : bad('undated-only invoices were treated as a refusal', JSON.stringify(r.notice));
  }

  // ── F. the panel the manager actually reads ─────────────────────────────────
  sec('F · the rendered refusal panel');
  {
    const r = await p.evaluate((scope) => {
      const host = document.createElement('div');
      host.innerHTML = _camRefusalHtml(scope);
      const panel = host.querySelector('.cam-refusal');
      return {
        rendered:  !!panel,
        year:      panel ? panel.getAttribute('data-refusal-year') : null,
        reason:    panel ? panel.getAttribute('data-refusal-reason') : null,
        text:      panel ? (panel.textContent || '').replace(/\s+/g, ' ').trim() : '',
        emptyHtml: _camRefusalHtml({ refused: false, year: 2026 }),
        nullHtml:  _camRefusalHtml(null),
      };
    }, refusedScope);
    r.rendered ? ok('a refused scope renders a panel')
      : bad('nothing rendered for a refused scope', JSON.stringify(r));
    (r.year === '2026') ? ok('the panel carries the year it refused')
      : bad('wrong year on the panel', String(r.year));
    (r.reason === 'no_dated_invoice_in_year') ? ok('the panel carries the refusal reason')
      : bad('wrong reason on the panel', String(r.reason));
    /No CAM was reconciled for 2026/.test(r.text) ? ok('the panel headline denies the reconciliation')
      : bad('panel headline wrong', r.text.slice(0, 160));
    (r.emptyHtml === '') ? ok('a scope that was not refused renders nothing')
      : bad('a non-refusal rendered a panel', r.emptyHtml.slice(0, 160));
    (r.nullHtml === '') ? ok('no scope at all renders nothing')
      : bad('a null scope rendered a panel', r.nullHtml.slice(0, 160));
  }

  // ── G. painting it over the results area ────────────────────────────────────
  sec('G · the refusal replaces the results area and clears stale claims');
  {
    const r = await p.evaluate((scope) => {
      const section = document.getElementById('results');
      const body    = document.getElementById('resultsBody');
      const title   = document.getElementById('resultsTitle');
      // Put the section in the exact state a refused run leaves behind: a cap
      // warning prepended before the engine was called, plus a previous run's
      // cards still in the body.
      const warn = document.createElement('div');
      warn.className = 'cam-cap-incomplete-warning';
      warn.textContent = 'CAM cap unresolved for 3 tenants. These charges were calculated with no cap limit.';
      section.prepend(warn);
      body.innerHTML = '<div class="summary-bar">Total Expenses $117,750.00 Tenants 0 Invoices 4</div>'
                     + '<div class="result-card">Cedar Park Dental</div>';
      title.textContent = '2026 CAM — Cedar Park Commons';

      const returned = renderCamRefusal(section, body, scope);
      const sectionText = (section.innerText || '').replace(/\s+/g, ' ');
      return {
        returned,
        capWarnings: section.querySelectorAll('.cam-cap-incomplete-warning').length,
        resultCards: body.querySelectorAll('.result-card').length,
        summaryBars: body.querySelectorAll('.summary-bar').length,
        title:       title.textContent,
        panelText:   (body.innerText || '').replace(/\s+/g, ' ').trim(),
        mentionsPoolAsTotal: /TOTAL EXPENSES/i.test(sectionText),
        // and the no-op case, on the same live DOM
        noopReturn: renderCamRefusal(section, body, { refused: false, year: 2026 }),
      };
    }, refusedScope);
    r.returned ? ok('renderCamRefusal reports that it painted the refusal')
      : bad('renderCamRefusal declined to render a refused scope', JSON.stringify(r));
    (r.capWarnings === 0) ? ok('the cap warning about calculated charges is removed')
      : bad('a cap warning survived, claiming charges that do not exist', String(r.capWarnings));
    (r.resultCards === 0) ? ok('a previous run’s tenant cards are cleared')
      : bad('stale result cards remain under a refusal', String(r.resultCards));
    (r.summaryBars === 0) ? ok('the summary bar is cleared')
      : bad('the summary bar survived the refusal', String(r.summaryBars));
    !r.mentionsPoolAsTotal ? ok('the invoice pool is no longer presented as reconciliation totals')
      : bad('"TOTAL EXPENSES" still on screen under a refusal', 'section still shows the summary strip');
    /not reconciled/i.test(r.title) ? ok('the section heading says the year was not reconciled')
      : bad('the heading still reads like a completed run', r.title);
    /No CAM was reconciled for 2026/.test(r.panelText) ? ok('the durable panel is what fills the results area')
      : bad('the results area does not carry the refusal', r.panelText.slice(0, 200));
    (r.noopReturn === false) ? ok('rendering a non-refusal is a no-op that reports false')
      : bad('renderCamRefusal acted on a scope that was not refused', String(r.noopReturn));
  }

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
