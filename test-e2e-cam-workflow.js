// test-e2e-cam-workflow.js
// ============================================================================
// THE CAM PAGE READS AS A WORKFLOW: Prepare → Calculate → Tenant Results →
// AI Audit Review. A reorganisation of the existing machinery under its
// existing ids — nothing about the calculation, the gates, the findings, the
// stale protection, the year scope or persistence may move. This suite checks
// both halves: the shape the manager reads, and that every figure and verdict
// in it is the authority's own.
//
//   A · four steps, in order, each holding what it should
//   B · Prepare's facts are the register's and the roster's own numbers
//   C · Calculate's context is the year in force, CamPool's pool, the roster
//   D · Tenant Results: charges on screen before any audit material
//   E · AI Audit Review: four buckets over the same findings, same counts
//   F · Calculate CAM → the same modal → the same runAllocation; amounts,
//       blockers and findings identical after the re-run; the row is saved
//   G · an edit after the run: stale protection, on the page and in the gate
//   H · a run for a year with no invoices is refused, and the page says so
//   I · reload: the restored path renders the same four steps and amounts
//   J · at phone width: stacked, no horizontal page scroll, one full-width button;
//       the collapsed register puts Calculate much closer than the expanded one
//   K · the register: collapsed by default behind its summary row; expanded in
//       place with every row action working; Property → Invoices still opens
//   L · a held tenant's action is not dressed as a cleared one
//
// Run: node test-e2e-cam-workflow.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8979;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const yes = (c, label, d) => c ? ok(label) : bad(label, d);

// A Supabase stand-in whose rows outlive a reload (mirrored into localStorage).
const DB = `
(function(){
  var U={id:'cam-workflow-0001-4000-a000-000000000001',email:'pm@example.com'};
  function P(v){return Promise.resolve(v);}
  function store(){try{return JSON.parse(localStorage.getItem('__mockdb')||'{}');}catch(e){return {};}}
  function put(s){localStorage.setItem('__mockdb',JSON.stringify(s));}
  function tbl(n){var s=store();s[n]=s[n]||[];return s[n];}
  function save(n,r){var s=store();s[n]=r;put(s);}
  function uuid(){return 'p'+Math.random().toString(16).slice(2,10)+'-1111-4000-a000-'+Date.now().toString(16);}
  function q(name){var filters=[],single=false;
    var api={select:function(){return api;},eq:function(k,v){filters.push([k,v]);return api;},
      neq:function(){return api;},is:function(){return api;},not:function(){return api;},
      order:function(){return api;},limit:function(){return api;},ilike:function(){return api;},
      gte:function(){return api;},lte:function(){return api;},
      in:function(){return P({data:[],error:null});},
      single:function(){single=true;return run();},
      maybeSingle:function(){single=true;return run();},
      insert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        var made=arr.map(function(x){var c=Object.assign({},x);if(!c.id)c.id=uuid();rows.push(c);return c;});
        save(name,rows);var p=P({data:made,error:null});
        p.select=function(){var q2=P({data:made,error:null});q2.single=function(){return P({data:made[0],error:null});};return q2;};return p;},
      upsert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        arr.forEach(function(x){var i=rows.findIndex(function(y){return y.id===x.id;});if(i>=0)rows[i]=Object.assign({},rows[i],x);else rows.push(Object.assign({},x));});
        save(name,rows);var p=P({data:arr,error:null});
        p.select=function(){var q2=P({data:arr,error:null});q2.single=function(){return P({data:arr[0],error:null});};return q2;};return p;},
      update:function(){var p=P({data:null,error:null});p.eq=function(){return P({data:null,error:null});};p.select=function(){return P({data:null,error:null});};return p;},
      delete:function(){return {eq:function(k,v){var rows=tbl(name).filter(function(r){return r[k]!==v;});save(name,rows);return P({error:null});}};},
      then:function(f){return run().then(f);}};
    function run(){var rows=tbl(name).filter(function(r){return filters.every(function(f){return r[f[0]]===f[1];});});
      if(single)return P(rows.length?{data:rows[0],error:null}:{data:null,error:{message:'no rows'}});
      return P({data:rows,error:null});}
    return api;}
  window.supabase={createClient:function(){return {auth:{
    getUser:function(){return P({data:{user:U},error:null});},
    getSession:function(){return P({data:{session:{user:U}},error:null});},
    onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:U});},40);return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return P({error:null});}
  },rpc:function(){return P({data:null,error:null});},
    from:function(n){return q(n);},
    storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;

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
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(DB);

  const boot = async (p) => {
    p = p || page;
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2600);
    await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
    await p.waitForTimeout(600);
    await p.evaluate(() => loadDemo());
    await p.waitForFunction(() => {
      const el = document.getElementById('mainWorkflow');
      return el && el.style.display !== 'none' && typeof lastResults !== 'undefined' && lastResults.length > 0
        && document.getElementById('auditPanel');
    }, null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.evaluate(() => switchWorkspaceTab('cam'));
    await p.waitForTimeout(600);
  };
  // The state the page shows and the state the authorities hold, side by side.
  const READ = `(function () {
    const $ = id => document.getElementById(id);
    const T = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
    const steps = Array.from(document.querySelectorAll('#camFlow > .cam-step')).map(s => ({
      id: s.id, h2: T(s.querySelector('.cam-step-title h2')), status: T(s.querySelector('.cam-step-status')) }));
    const inside = (container, id) => { const c = $(container), e = $(id); return !!(c && e && c.contains(e)); };
    const facts = {}; document.querySelectorAll('#camPrepFacts .cam-fact').forEach(f => { facts[T(f.querySelector('.cam-fact-l'))] = T(f.querySelector('.cam-fact-v')); });
    const cells = {}; document.querySelectorAll('#camCalcContext .cam-calc-cell').forEach(c => { cells[T(c.querySelector('.cam-fact-l'))] = T(c.querySelector('.cam-fact-v')); });
    const buckets = {}; document.querySelectorAll('#camAuditStrip .cam-audit-bucket').forEach(b => { buckets[b.dataset.bucket] = Number(b.dataset.count); });
    const sections = {}; document.querySelectorAll('#auditPanel .ap-section').forEach(s => { sections[s.dataset.bucket] = s.querySelectorAll('.ap-flag').length; });
    const tableRows = Array.from(document.querySelectorAll('#resultsBody .rcs-table tbody tr')).map(tr => ({
      name: T(tr.querySelector('.rcs-name-cell')).replace(/ · .*$/, ''), alloc: T(tr.querySelector('.rcs-alloc-total')), bill: T(tr.querySelector('.rcs-bill')) }));
    const order = (a, b) => { const x = document.querySelector(a), y = document.querySelector(b); return !!(x && y) && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING); };
    const prep = _camPrepState();
    const invAll = invoiceData.filter(Boolean);
    const withDoc = invAll.filter(i => i.fileUrl || i.fileName).length;
    const scope = { in: 0, out: 0, undated: 0 }; invAll.forEach(i => { scope[camYearScopeOf(i, getCamYear())]++; });
    const b = lastResults.length ? _camAuditBuckets() : null;
    const summary = lastResults.length ? buildAuditSummary() : null;
    return {
      steps, facts, cells, buckets, sections, tableRows,
      runBtn: { in: inside('camStepCalculate', 'runBtn'), text: T($('runBtn')), onclick: $('runBtn').getAttribute('onclick') },
      placed: { results: inside('camStepResults', 'results'), resultsBody: inside('camStepResults', 'resultsBody'), title: inside('camStepResults', 'resultsTitle'),
                gl: inside('camStepPrepare', 'cardGL'), invoices: inside('camStepPrepare', 'cardInvoices'), register: inside('camStepPrepare', 'invResults'),
                narrative: inside('camAuditReview', 'narrativePanel'), audit: inside('camAuditReview', 'auditPanel'),
                trends: !$('trendsPanel') || inside('camAuditReview', 'trendsPanel'),
                prevRuns: inside('camStepResults', 'previousRunsSection'), disputesAfter: order('#camStepAudit', '#disputeSection') },
      tableBeforeAudit: order('#resultsBody .rcs-table', '#narrativePanel') && order('#resultsBody .rcs-table', '#auditPanel'),
      cardsBeforeAudit: order('#resultsBody .result-card', '#narrativePanel'),
      title: T($('resultsTitle')), cards: document.querySelectorAll('#resultsBody .result-card').length,
      auth: { year: getCamYear(), invoices: invAll.length, tenants: prep.tenants.length, ready: prep.ready, withDoc, scope,
              pool: window.CamPool.total(invAll), gross: window.CamPool.grossTotal(invAll), sqft: prep.totalSqft,
              results: lastResults.map(r => ({ name: r.name, amount: Math.round(r.allocatedAmount * 100) / 100 })),
              verdict: _lastBillingVerdict ? { canBill: _lastBillingVerdict.readiness.canBill, billable: _lastBillingVerdict.billableNames.length, n: _lastBillingVerdict.tenantCount,
                                               blockers: (_lastBillingVerdict.readiness.blockers || []).map(x => x.title).sort() } : null,
              buckets: b ? { blocking: b.blocking.length, property: b.property.length, tenant: b.tenant.length, advisory: b.advisory.length } : null,
              findings: summary ? { red: summary.red.length, yellow: summary.yellow.length, green: summary.green.length } : null,
              stale: _resultsStale, unverified: _resultsUnverified,
              savedAt: (currentProperty().camReconciliation || {}).savedAt || null },
      fmt: { pool: fmt(window.CamPool.total(invAll)) },
    };
  })()`;
  const read = (p) => (p || page).evaluate(READ);

  await boot();
  const S = await read();

  // ══ A · the shape ══════════════════════════════════════════════════════════
  sec('A · four steps, in order, each holding what it should');
  is(S.steps.map(s => s.id), ['camStepPrepare', 'camStepCalculate', 'camStepResults', 'camStepAudit'], 'the CAM page is four steps, in workflow order');
  is(S.steps.map(s => s.h2), ['Prepare', 'Calculate', 'Tenant Results', 'AI Audit Review'], 'titled Prepare · Calculate · Tenant Results · AI Audit Review');
  yes(S.steps.every(s => s.status), 'each step carries one status', JSON.stringify(S.steps));
  yes(S.placed.gl && S.placed.invoices && S.placed.register, 'Prepare holds the GL upload, the invoice upload and the register');
  yes(S.runBtn.in && S.runBtn.text === 'Calculate CAM Charges' && S.runBtn.onclick === 'showAllocationModal()', 'Calculate holds the one button, "Calculate CAM Charges", on its existing handler', JSON.stringify(S.runBtn));
  yes(S.placed.results && S.placed.resultsBody && S.placed.title && S.placed.prevRuns, 'Tenant Results holds #results, its body, its title and Previous Runs');
  yes(S.placed.narrative && S.placed.audit && S.placed.trends, 'AI Audit Review holds the narrative, the findings panel and (when present) the trends panel');
  yes(S.placed.disputesAfter, 'Tenant Disputes follows the four steps, untouched');

  // ══ B · Prepare ════════════════════════════════════════════════════════════
  sec('B · Prepare reports the register and the roster as they are');
  is(S.facts['Invoices loaded'].split(' ')[0], String(S.auth.invoices), `invoices loaded = the register (${S.auth.invoices})`);
  is(S.facts['Leases ready'].split(' ')[0], String(S.auth.tenants), `leases ready = tenants with a name and leased sqft (${S.auth.tenants})`);
  is(S.facts['With a source document'], `${S.auth.withDoc} of ${S.auth.invoices}`, 'source-document count uses the audit’s own predicate');
  is(S.facts[`Dated in ${S.auth.year}`].split(' ')[0], String(S.auth.scope.in), 'dated-in-year uses camYearScopeOf, the engine’s predicate');
  yes(/Ready for 2025/.test(S.steps[0].status) && S.auth.ready, 'the step reads Ready because _camPrepState (the modal’s own predicate) says so');

  // ══ B2 · the register is collapsed by default ══════════════════════════════
  sec('B2 · the invoice register is collapsed behind one summary row');
  const R0 = await page.evaluate(() => {
    const inv = document.getElementById('invResults');
    const meta = document.getElementById('camRegisterMeta').textContent.replace(/\s+/g, ' ').trim();
    const btn = document.getElementById('camRegisterToggle');
    const invAll = invoiceData.filter(Boolean);
    return { hidden: getComputedStyle(inv).display === 'none', rows: inv.querySelectorAll('.bulk-tenant-row').length, meta,
             toggle: btn.textContent.trim(), expanded: btn.getAttribute('aria-expanded'),
             want: `${invAll.length} invoices · ${fmt(window.CamPool.grossTotal(invAll))} · ${invAll.filter(i => i.fileUrl || i.fileName).length} with a source document`,
             uploadVisible: getComputedStyle(document.getElementById('invZone')).display !== 'none' && document.getElementById('invZone').getBoundingClientRect().height > 40,
             fileInput: !!document.getElementById('invFileInput') };
  });
  yes(R0.hidden && R0.rows > 0, 'the register is rendered but hidden by default', JSON.stringify(R0));
  is(R0.meta, R0.want, 'the summary row carries the register’s own counts: invoices · gross · with a source document');
  yes(/View invoices/.test(R0.toggle) && R0.expanded === 'false', 'with a "View invoices" control', R0.toggle);
  yes(R0.uploadVisible && R0.fileInput, 'the upload controls are not collapsed — the drop zone is right there');
  // The register holds every invoice, eligible or not, so its dollar figure is
  // the gross — not the CAM pool. On the demo the two coincide; hold one
  // invoice out of CAM (in memory only) so they differ, and check which one
  // the summary row shows. Then put it back and re-render.
  const R1 = await page.evaluate(() => {
    const invAll = invoiceData.filter(Boolean);
    const was = invAll[0].camEligible;
    invAll[0].camEligible = false;
    renderCamWorkflow();
    const meta = document.getElementById('camRegisterMeta').textContent.replace(/\s+/g, ' ').trim();
    const out = { meta, gross: fmt(window.CamPool.grossTotal(invAll)), pool: fmt(window.CamPool.total(invAll)) };
    if (was === undefined) delete invAll[0].camEligible; else invAll[0].camEligible = was;
    renderCamWorkflow();
    out.restored = document.getElementById('camRegisterMeta').textContent.replace(/\s+/g, ' ').trim();
    return out;
  });
  yes(R1.gross !== R1.pool && R1.meta.includes(R1.gross) && !R1.meta.includes(R1.pool), 'the figure is the gross of every invoice in the register, not the CAM pool', JSON.stringify(R1));
  is(R1.restored, R0.want, 'and the row reads as before once the invoice is back in CAM');
  // A LOAD DOES NOT OPEN IT. A batch upload, a Yardi import and a GL import
  // all end in renderInvResults(); a real property can carry hundreds of
  // invoices, and a batch landing must not unfold every card. The summary row
  // updates; the manager chooses "View invoices". Checked two ways: the three
  // load paths carry no opener, and a render with new rows leaves it hidden.
  const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const fnBody = name => { const i = src.indexOf(`function ${name}(`); return src.slice(i, src.indexOf('\n}\n', i)); };
  const loaders = ['handleBatchInvoices', 'confirmYardiImport', 'importGLToInvoices'];
  const openers = loaders.filter(f => /setCamRegisterOpen\(true\)|_camRegisterOpen\s*=\s*true|toggleCamRegister\(\)/.test(fnBody(f)));
  is(openers, [], 'none of the three load paths (batch upload, Yardi import, GL import) opens the register');
  yes(loaders.every(f => /renderInvResults\(\)/.test(fnBody(f))), 'each of them ends in the same renderInvResults() the check below exercises');
  const R2 = await page.evaluate(() => {
    const inv = document.getElementById('invResults');
    const n0 = invoiceData.filter(Boolean).length;
    invoiceData.push({ vendorName: 'Probe Vendor', category: 'other', amount: 1, invoiceDate: '2025-06-01' });
    renderInvResults();
    const out = { hidden: getComputedStyle(inv).display === 'none', rows: inv.querySelectorAll('.bulk-tenant-row').length, n0,
                  meta: document.getElementById('camRegisterMeta').textContent.replace(/\s+/g, ' ').trim(),
                  toggle: document.getElementById('camRegisterToggle').textContent.trim() };
    invoiceData.pop();
    renderInvResults();
    out.after = document.getElementById('camRegisterMeta').textContent.replace(/\s+/g, ' ').trim();
    return out;
  });
  yes(R2.hidden && R2.rows === R2.n0 + 1, 'new rows rendered into the register leave it collapsed', JSON.stringify(R2));
  yes(new RegExp('^' + (R2.n0 + 1) + ' invoices').test(R2.meta) && /View invoices/.test(R2.toggle), 'while the summary row counts the new invoice and still offers View invoices', R2.meta);
  is(R2.after, R0.want, 'and reads as before once it is gone');

  // ══ C · Calculate ══════════════════════════════════════════════════════════
  sec('C · Calculate shows the year, the pool, the roster and readiness — from the authorities');
  is(S.cells['CAM year'], String(S.auth.year), 'the CAM year is getCamYear()');
  is(S.cells['Recoverable pool'], S.fmt.pool, 'the recoverable pool is CamPool.total over the register');
  is(S.cells['Tenants'], String(S.auth.tenants), 'the tenant count is the roster’s');
  yes(/Calculated/.test(S.cells['Readiness']) && /Calculated/.test(S.steps[1].status), 'readiness reads Calculated on a current run');

  // ══ D · Tenant Results ═════════════════════════════════════════════════════
  sec('D · Tenant Results: each tenant’s charge, before any audit material');
  is(S.title, '2025 CAM — Cascade Commons', 'the results title is the run’s');
  is(S.tableRows.map(r => r.name), S.auth.results.map(r => r.name), 'the summary table lists every tenant of the run');
  is(S.tableRows.map(r => r.alloc), S.auth.results.map(r => fmtUSD(r.amount)), 'with the run’s own allocated amounts');
  is(S.cards, S.auth.results.length, 'and one result card per tenant');
  yes(S.tableBeforeAudit && S.cardsBeforeAudit, 'the charges come before the narrative and the findings panel in reading order');
  yes(S.auth.verdict && new RegExp(`${S.auth.verdict.billable} of ${S.auth.verdict.n} billable`).test(S.steps[2].status), 'the step status is the billing verdict’s own count', S.steps[2].status);

  // ══ E · AI Audit Review ════════════════════════════════════════════════════
  sec('E · AI Audit Review: the same findings, grouped by what they affect');
  is(S.buckets, S.auth.buckets, 'the four strip counts are _camAuditBuckets() over buildAuditSummary() and the billing verdict');
  is(S.sections, Object.fromEntries(Object.entries(S.auth.buckets).filter(([, n]) => n > 0)), 'the panel’s four groups hold exactly those findings');
  is(Object.values(S.buckets).reduce((a, b) => a + b, 0), S.auth.findings.red + S.auth.findings.yellow + S.auth.findings.green, 'every finding is in exactly one group — none dropped, none duplicated');
  is(S.buckets.blocking, S.auth.verdict.blockers.length, 'Critical / blocking is the billing gate’s blocker set');
  yes(/blocking/.test(S.steps[3].status), 'the step status names the blocking count', S.steps[3].status);

  // ══ F · the same calculation path ══════════════════════════════════════════
  sec('F · Calculate CAM → the same confirmation → the same runAllocation; nothing about the run moves');
  const before = S.auth;
  const spy = await page.evaluate(async () => {
    const orig = window.runAllocation; let calls = 0;
    window.runAllocation = function () { calls++; return orig.apply(this, arguments); };
    document.getElementById('runBtn').click();
    await new Promise(r => setTimeout(r, 300));
    const modal = document.getElementById('allocModal');
    const modalShown = !!modal && getComputedStyle(modal).display !== 'none';
    const confirmBtn = modal && Array.from(modal.querySelectorAll('button')).find(b => /confirmAllocation/.test(b.getAttribute('onclick') || ''));
    if (confirmBtn) confirmBtn.click();
    await new Promise(r => setTimeout(r, 4000));
    window.runAllocation = orig;
    return { modalShown, confirm: !!confirmBtn, calls };
  });
  yes(spy.modalShown && spy.confirm, 'the button opens the existing confirmation modal', JSON.stringify(spy));
  is(spy.calls, 1, 'confirming calls runAllocation exactly once — the same path as before');
  await page.waitForTimeout(1500);
  const S2 = await read();
  is(S2.auth.results, before.results, 'every tenant amount is unchanged after the re-run');
  is(S2.auth.verdict, before.verdict, 'the billing verdict and its blockers are unchanged');
  is(S2.auth.findings, before.findings, 'the audit findings are unchanged');
  is(S2.buckets, before.buckets, 'and the four groups are unchanged');
  yes(S2.auth.savedAt && S2.auth.savedAt !== before.savedAt, 'the run was saved (camReconciliation.savedAt advanced)', String(S2.auth.savedAt));
  const row = await page.evaluate(() => {
    const r = (JSON.parse(localStorage.getItem('__mockdb') || '{}').properties || []).find(x => x.id === DEMO_PROPERTY_ID);
    return r && r.data.camReconciliation ? r.data.camReconciliation.results.map(x => ({ name: x.name, amount: Math.round(x.allocatedAmount * 100) / 100 })) : null;
  });
  is(row, before.results, '…and the stored row carries the same amounts');
  is([S2.auth.stale, S2.auth.unverified], [false, false], 'a fresh run is current');

  // ══ G · stale protection ═══════════════════════════════════════════════════
  sec('G · an input edited after the run: the page and the gate both say re-run');
  const G = await page.evaluate(async (src) => {
    const i = tenantData.findIndex(t => t && t.tenant_name === 'FitZone Athletics');
    handleFieldBlur(i, 'leased_sqft', '6900', null);
    await new Promise(r => setTimeout(r, 200));
    const st = eval(src);
    const seen = []; const orig = window.showToast; window.showToast = (m, o) => { seen.push(String(m)); return orig(m, o); };
    generateTenantStatement('FitZone Athletics');
    await new Promise(r => setTimeout(r, 300)); window.showToast = orig;
    const banner = document.getElementById('staleResultsBanner');
    return { chip: st.steps[1].status, readiness: st.cells['Readiness'], last: document.getElementById('camCalcLast').textContent,
             bannerShown: getComputedStyle(banner).display !== 'none', toast: seen[0] || null };
  }, READ);
  yes(/Re-run needed/.test(G.chip) && /Re-run needed/.test(G.readiness), 'the Calculate step reads Re-run needed', JSON.stringify(G));
  yes(/stale/.test(G.last) && /data changed/.test(G.last), 'and says why beneath the button', G.last);
  yes(G.bannerShown, 'the stale banner is shown in Tenant Results');
  yes(G.toast && /Results may be stale/.test(G.toast), 'the statement is still refused by the gate', G.toast);

  // ══ H · year scope ═════════════════════════════════════════════════════════
  sec('H · a year with no invoices: the engine refuses and the page reads Not reconciled');
  const H = await page.evaluate(async (src) => {
    setCamYear(2024);
    await runAllocation();
    await new Promise(r => setTimeout(r, 2500));
    const st = eval(src);
    return { title: st.title, refusal: !!document.querySelector('#resultsBody .cam-refusal'), calc: st.steps[1].status, results: st.steps[2].status, last: document.getElementById('camCalcLast').textContent };
  }, READ);
  yes(H.refusal && /not reconciled/i.test(H.title), 'the run is refused and the title says so', JSON.stringify(H));
  yes(/Not reconciled/.test(H.calc) && /Not reconciled/.test(H.results), 'Calculate and Tenant Results both read Not reconciled', JSON.stringify(H));
  yes(/refused/.test(H.last), 'and the Calculate step explains what to change', H.last);
  const H2 = await page.evaluate(async (src) => {
    setCamYear(2025);
    await runAllocation();
    await new Promise(r => setTimeout(r, 3000));
    return eval(src);
  }, READ);
  is(H2.auth.results, before.results, 'back on 2025, the run produces the same amounts again');
  yes(/Calculated/.test(H2.steps[1].status), 'and the page is current again');

  // ══ I · the restored path ══════════════════════════════════════════════════
  sec('I · after a reload the saved reconciliation renders the same four steps');
  await boot();
  const I = await read();
  is(I.steps.map(s => s.id), ['camStepPrepare', 'camStepCalculate', 'camStepResults', 'camStepAudit'], 'four steps, in order');
  is(I.auth.results, before.results, 'the restored amounts are the saved amounts');
  is(I.tableRows.map(r => r.alloc), before.results.map(r => fmtUSD(r.amount)), 'and the table shows them');
  is(I.buckets, before.buckets, 'the audit groups are the same');
  yes(I.placed.narrative && I.placed.audit, 'the panels mount in AI Audit Review on the restored path too');
  yes(/Calculated/.test(I.steps[1].status) && /billable/.test(I.steps[2].status), 'the statuses read from the restored run', JSON.stringify(I.steps));

  // ══ K · the register expands in place, everything still works ════════════
  sec('K · View invoices expands the existing register in place; its actions work; the filing link opens Property → Invoices');
  const K = await page.evaluate(async () => {
    const T = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    const inv = document.getElementById('invResults');
    const n0 = invoiceData.filter(Boolean).length;
    document.getElementById('camRegisterToggle').click();
    const shown = getComputedStyle(inv).display !== 'none' && inv.getBoundingClientRect().height > 100;
    const rows = Array.from(inv.querySelectorAll('.bulk-tenant-row'));
    // The handler is the call after `event.stopPropagation();` — e.g. "viewInvoice(0)".
    const actions = rows.map(r => Array.from(r.querySelectorAll('.inv-action-btns button')).map(b => [T(b), (/;\s*(\w+)\(/.exec(b.getAttribute('onclick') || '') || [])[1] || null]));
    const first = rows[0];
    first.querySelector('.bulk-tenant-summary').click();          // toggleInvDetail
    const detail = first.querySelector('.bulk-tenant-detail');
    const detailOpen = detail && detail.style.display === 'block';
    const field = document.getElementById('ifield-0-vendorName');
    const editable = !!field && !field.disabled && field.offsetParent !== null;
    // Remove the LAST invoice through its own button (the dialog is accepted).
    const lastIdx = n0 - 1;
    const removeBtn = rows[lastIdx].querySelector('.bulk-t-remove');
    const stale0 = _resultsStale;
    removeBtn.click();
    await new Promise(r => setTimeout(r, 600));
    const n1 = invoiceData.filter(Boolean).length;
    const persisted = (currentProperty().invoices || []).length;
    const meta = T(document.getElementById('camRegisterMeta'));
    const toggle = T(document.getElementById('camRegisterToggle'));
    document.getElementById('camRegisterToggle').click();
    const hiddenAgain = getComputedStyle(inv).display === 'none';
    return { shown, rowCount: rows.length, n0, n1, persisted, actions: actions[0], everyRowHasFour: actions.every(a => a.length === 4), detailOpen, editable, meta, toggle, hiddenAgain, stale0, stale: _resultsStale };
  });
  yes(K.shown && K.rowCount === K.n0, `View invoices shows the register with all ${K.n0} rows`, JSON.stringify(K));
  is(K.actions.map(a => a[0]), ['View', 'Explain', 'Dispute', 'Remove'], 'each row keeps View · Explain · Dispute · Remove');
  is(K.actions.map(a => a[1]), ['viewInvoice', 'explainCharge', 'disputeCharge', 'removeInvItem'], '…on their existing handlers');
  yes(K.everyRowHasFour, 'on every row');
  yes(K.detailOpen && K.editable, 'a row opens its editable detail in place');
  is(K.n1, K.n0 - 1, 'Remove still removes the invoice from the register');
  yes(new RegExp('^' + K.n1 + ' invoices').test(K.meta), 'and the summary row follows the register', K.meta);
  is(K.persisted, K.n1, '…and the removal is written to the property, as before');
  // removeInvItem never touched the stale flag (only upload, tenant edits,
  // amendments and bulk-clear do) — this slice leaves that exactly as it was.
  is(K.stale, K.stale0, '…and the stale flag is exactly what it was before the removal (removal never set it)');
  yes(/Hide invoices/.test(K.toggle), 'the control reads "Hide invoices" while open', K.toggle);
  yes(K.hiddenAgain, 'and hides the register again');
  // A re-render of the register (every edit, every removal) keeps whatever
  // state it is in — open stays open, closed stays closed.
  const K2 = await page.evaluate(() => {
    const inv = document.getElementById('invResults');
    const shown = () => getComputedStyle(inv).display !== 'none';
    setCamRegisterOpen(true);
    renderInvResults();
    const openSurvives = shown() && /Hide invoices/.test(document.getElementById('camRegisterToggle').textContent);
    setCamRegisterOpen(false);
    renderInvResults();
    const closedSurvives = !shown() && /View invoices/.test(document.getElementById('camRegisterToggle').textContent);
    return { openSurvives, closedSurvives };
  });
  yes(K2.openSurvives && K2.closedSurvives, 'a re-render of the register keeps it open when open and closed when closed', JSON.stringify(K2));
  const link = await page.evaluate(async () => {
    Array.from(document.querySelectorAll('#camRegisterHead .cam-link')).find(b => /Property/.test(b.textContent)).click();
    await new Promise(r => setTimeout(r, 400));
    const st = PropertyCabinetView.state();
    return { tab: _activeWorkspaceTab, drawer: st.drawer, folders: document.querySelectorAll('#propertyOsBody .pcv-folder').length };
  });
  yes(link.tab === 'property' && link.drawer === 'invoices' && link.folders > 0, 'Filed under Property › Invoices opens the property’s Invoices drawer on its vendor folders', JSON.stringify(link));
  await page.evaluate(() => switchWorkspaceTab('cam'));

  // ══ L · a held tenant's action is not green ═══════════════════════════════
  sec('L · "Why it can’t bill" is not dressed as a cleared state');
  const L = await page.evaluate(() => {
    const held = document.querySelector('#resultsBody .tenant-stmt-card-btn--held');
    const probe = document.createElement('button'); probe.className = 'tenant-stmt-card-btn'; probe.textContent = 'x';
    document.getElementById('resultsBody').appendChild(probe);
    const rgb = el => { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).color); return m ? m[1].split(',').slice(0, 3).map(Number) : null; };
    const out = { label: held && held.textContent.trim(), held: rgb(held), billable: rgb(probe) };
    probe.remove(); return out;
  });
  yes(L.label === '⛔ Why it can’t bill', 'the action and its wording are unchanged', L.label);
  yes(L.held && !(L.held[1] > L.held[0] && L.held[1] > L.held[2]), 'its text colour is not green-dominant', JSON.stringify(L.held));
  yes(L.billable && L.billable[1] > L.billable[0] && L.billable[1] > L.billable[2] && JSON.stringify(L.billable) !== JSON.stringify(L.held), 'while the billable action keeps its green — the two states no longer look alike', JSON.stringify(L));

  // ══ J · phone ══════════════════════════════════════════════════════════════
  sec('J · at phone width: stacked steps, no sideways page scroll, one full-width button');
  const mctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const mp = await mctx.newPage();
  const merrs = []; mp.on('pageerror', e => merrs.push(String(e.message).split('\n')[0]));
  await mp.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await mp.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await mp.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await mp.addInitScript('window.__TEST_AUTHED=true;');
  await mp.addInitScript(DB);
  await boot(mp);
  const J = await mp.evaluate(() => {
    const iw = window.innerWidth;
    const steps = Array.from(document.querySelectorAll('#camFlow > .cam-step')).map(s => { const r = s.getBoundingClientRect(); return { id: s.id, w: Math.round(r.width), left: Math.round(r.left) }; });
    const btn = document.getElementById('runBtn').getBoundingClientRect();
    const body = document.querySelector('#camStepCalculate .cam-step-body').getBoundingClientRect();
    const wrap = document.querySelector('#resultsBody .rcs-table-wrap');
    const cells = Array.from(document.querySelectorAll('#camCalcContext .cam-calc-cell')).map(c => Math.round(c.getBoundingClientRect().width));
    return { iw, sw: document.scrollingElement.scrollWidth, steps, btnW: Math.round(btn.width), bodyW: Math.round(body.width),
             tableScrollsInside: !!wrap && wrap.scrollWidth > wrap.clientWidth && wrap.getBoundingClientRect().right <= iw + 1,
             cells, stacked: steps.every((s, i, a) => i === 0 || a[i - 1].left === s.left) };
  });
  is(J.sw <= J.iw + 1, true, `the page does not scroll sideways (${J.sw} ≤ ${J.iw})`);
  yes(J.steps.length === 4 && J.stacked && J.steps.every(s => s.w <= J.iw && s.w >= 300), 'the four steps stack, each the width of the screen', JSON.stringify(J.steps));
  yes(Math.abs(J.btnW - J.bodyW) <= 2, 'the Calculate button spans its step', `${J.btnW} vs ${J.bodyW}`);
  yes(J.cells.length === 4 && J.cells.every(w => w >= 140), 'the four context cells sit two per row at readable widths', JSON.stringify(J.cells));
  yes(J.tableScrollsInside, 'the summary table scrolls inside its own wrap, not the page');
  const JR = await mp.evaluate(() => {
    const top = () => document.getElementById('runBtn').getBoundingClientRect().top - document.getElementById('wsPane-cam').getBoundingClientRect().top;
    const collapsed = Math.round(top());
    document.getElementById('camRegisterToggle').click();
    const expanded = Math.round(top());
    const sw = document.scrollingElement.scrollWidth;
    document.getElementById('camRegisterToggle').click();
    return { collapsed, expanded, sw, iw: window.innerWidth, screens: Math.round(collapsed / window.innerHeight * 10) / 10 };
  });
  yes(JR.collapsed < JR.expanded * 0.5, `the collapsed register puts Calculate at ${JR.collapsed}px instead of ${JR.expanded}px (${JR.screens} screens down)`, JSON.stringify(JR));
  is(JR.sw <= JR.iw + 1, true, 'the expanded register does not scroll sideways either');
  is(merrs, [], 'no uncaught errors at phone width');
  await mctx.close();

  sec('K · quiet page');
  is(errs, [], 'no uncaught errors on desktop');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

function fmtUSD(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
