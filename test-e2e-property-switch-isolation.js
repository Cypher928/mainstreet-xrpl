// test-e2e-property-switch-isolation.js
// ============================================================================
// TWO BUILDINGS, ONE SESSION. NOTHING FROM ONE MAY APPEAR UNDER THE OTHER.
//
// No suite in this repo had ever opened a second property. That is the gap that
// let both of these live:
//
//   HIGH-1  Reconcile A, reconcile B, reopen A without re-running, and A's CAM
//           screen measured A's invoices against B's pool. Measured, verbatim:
//           "This invoice represents 199.1% of total CAM expenses ($42,000.00 of
//           $21,100.00), exceeding the 40% materiality threshold by $22,810.00."
//           $21,100 was the other building. Audit-grade findings, wrong
//           denominator, percentages over 100%.
//           Cause: lastCamPool was written by runAllocation and restored
//           nowhere, so a restored reconciliation kept the previous run's pool.
//
//   HIGH-2  Open A, open B, and the Spaces tab listed all four tenants under
//           "Every tenant space in this property", the other building's first
//           and unlabelled. Cause: _refreshAdvisorSurfaces fires 120ms late
//           holding the property it was handed, and selectProperty saves the
//           property being LEFT — so the departing building's render landed on
//           top of the arriving one's.
//
// THE FIXTURE IS BUILT SO CONTAMINATION CANNOT PASS BY COINCIDENCE. The two
// buildings share no name, no tenant, no vendor and no total, and each has one
// invoice over the 40% materiality threshold OF ITS OWN POOL — so each produces
// a concentration finding that names its own pool, and a finding citing the
// other building's number is unmistakable.
//
// The switches are repeated three times in each direction, because the original
// symptom accumulated rather than swapped.
//
// Run: node test-e2e-property-switch-isolation.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8950;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.pdf':'application/pdf', '.svg':'image/svg+xml' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');

const DB = `
(function(){
  var U={id:'switch-tester',email:'pm@example.com'};
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
      in:function(){return P({data:[],error:null});},
      single:function(){single=true;return run();},
      insert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        var made=arr.map(function(x){var c=Object.assign({},x);if(!c.id)c.id=uuid();rows.push(c);return c;});
        save(name,rows);var p=P({data:made,error:null});
        p.select=function(){var q2=P({data:made,error:null});q2.single=function(){return P({data:made[0],error:null});};return q2;};return p;},
      upsert:function(r){var rows=tbl(name);var arr=Array.isArray(r)?r:[r];
        arr.forEach(function(x){var i=rows.findIndex(function(y){return y.id===x.id;});if(i>=0)rows[i]=Object.assign({},rows[i],x);else rows.push(Object.assign({},x));});
        save(name,rows);var p=P({data:arr,error:null});
        p.select=function(){var q2=P({data:arr,error:null});q2.single=function(){return P({data:arr[0],error:null});};return q2;};return p;},
      update:function(){return P({data:null,error:null});},
      delete:function(){return {eq:function(){return P({error:null});}};},
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

// A: 114,500 invoiced, but the 26,100 janitorial invoice is marked NOT CAM
//    eligible, so the recoverable pool is 88,400 — deliberately DIFFERENT from
//    the gross total. A restore that grabbed the gross figure instead of the
//    CAM pool would otherwise be indistinguishable from a correct one, which is
//    exactly how this fixture nearly let a mutant through.
//    70,000 is 79.2% of 88,400, over the 40% materiality threshold.
// B: 21,100 invoiced, all eligible; 9,300 is 44.1%, also over the threshold.
const A = { id: 'fernhill-court', name: 'Fernhill Court', pool: 88400, poolText: '$88,400.00',
            gross: 114500, tenants: ['Cedar Park Dental', 'Bright Leaf Grocers'] };
const B = { id: 'marlow-yard',    name: 'Marlow Yard',    pool: 21100,  poolText: '$21,100.00',
            gross: 21100, tenants: ['Harbour Print Co', 'Ridgeline Fitness'] };

const SEED = `(async () => {
  const t = (name, sqft, id) => ({ tenant_name: name, leased_sqft: sqft, start_date: '2020-01-01',
    end_date: '2030-12-31', lease_type: 'NNN', cap: null, id, flags: [], confidence: {},
    suite: '', unitNumber: '' });
  const mk = (id, name, sqft, tenants, invoices) => ({ id, name, totalSqft: sqft,
    status: 'in-progress', tenantCount: 0, invoiceCount: 0, totalCAM: 0, openDisputes: 0,
    createdAt: new Date().toISOString(), tenants, invoices,
    disputes: [], activityLog: [], timeline: [] });
  const a = mk('fernhill-court', 'Fernhill Court', 26000,
    [t('Cedar Park Dental', 4200, 'f-t1'), t('Bright Leaf Grocers', 9100, 'f-t2')],
    [{ id: 'f1', vendorName: 'Northside Landscaping', category: 'landscaping', amount: 70000, invoiceDate: '2025-04-12' },
     { id: 'f2', vendorName: 'Talon Security',        category: 'security',    amount: 18400, invoiceDate: '2025-05-03' },
     { id: 'f3', vendorName: 'Pacific Facilities',    category: 'janitorial',  amount: 26100, invoiceDate: '2025-06-21', camEligible: false }]);
  const b = mk('marlow-yard', 'Marlow Yard', 12000,
    [t('Harbour Print Co', 3000, 'm-t1'), t('Ridgeline Fitness', 5500, 'm-t2')],
    [{ id: 'm1', vendorName: 'Orchard Waste',   category: 'waste',     amount: 9300, invoiceDate: '2025-03-09' },
     { id: 'm2', vendorName: 'Keystone Paving', category: 'parking',   amount: 7700, invoiceDate: '2025-07-14' },
     { id: 'm3', vendorName: 'Vale Utilities',  category: 'utilities', amount: 4100, invoiceDate: '2025-09-02' }]);
  _props.push(a, b);
  await saveProperty(a);
  await saveProperty(b);
})()`;

// Everything a manager could read that names a property, a tenant or a pool.
const VIEW = `(async () => {
  const T = e => e ? (e.innerText||'').replace(/\\s+/g,' ').trim() : null;
  window.switchWorkspaceTab('spaces');
  await new Promise(r => setTimeout(r, 1400));
  const spacesTxt = T(document.getElementById('wsPane-spaces')) || '';
  const spacesList = T(document.getElementById('spacesList')) || '';
  window.switchWorkspaceTab('cam');
  await new Promise(r => setTimeout(r, 1600));
  const camTxt = T(document.getElementById('wsPane-cam')) || '';
  const names = ['Cedar Park Dental','Bright Leaf Grocers','Harbour Print Co','Ridgeline Fitness'];
  return {
    activeProp:   (currentProperty() || {}).name,
    lastCamPool:  (typeof lastCamPool !== 'undefined' ? lastCamPool : null),
    lastTotal:    (typeof lastTotal   !== 'undefined' ? lastTotal   : null),
    spacesNames:  names.filter(n => spacesTxt.includes(n)),
    spacesListNames: names.filter(n => spacesList.includes(n)),
    // every concentration finding, with the pool it measured against
    claims: [...camTxt.matchAll(/represents ([\\d.]+)% of total CAM expenses \\((\\$[\\d,.]+) of (\\$[\\d,.]+)\\)/g)]
              .map(m => ({ pct: parseFloat(m[1]), invoice: m[2], pool: m[3] })),
    attention: T(document.querySelector('[class*="attention"], #attentionPanel')) || '',
  };
})()`;

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  await p.addInitScript('window.__TEST_AUTHED=true;');
  await p.addInitScript(DB);
  await p.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
  await p.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.route('**/api/**',    r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  await p.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
  await p.waitForTimeout(1500);

  await p.evaluate(SEED);
  await p.waitForTimeout(2500);

  const reconcile = async (id) => await p.evaluate(async (pid) => {
    await selectProperty(pid);
    await new Promise(r => setTimeout(r, 2600));
    setCamYear('2025');
    window.switchWorkspaceTab('cam');
    await new Promise(r => setTimeout(r, 1200));
    await window.runAllocation();
    await new Promise(r => setTimeout(r, 3500));
    return { cards: document.querySelectorAll('#resultsBody .result-card').length, pool: lastCamPool };
  }, id);
  const openProp = async (id) => {
    await p.evaluate(async (pid) => {
      await selectProperty(pid);
      await new Promise(r => setTimeout(r, 2800));
    }, id);
    // past the 120ms advisor refresh, so a late write would have landed
    await p.waitForTimeout(900);
  };

  sec('setup · two buildings, each reconciled against its own pool');
  const ra = await reconcile(A.id);
  const rb = await reconcile(B.id);
  (ra.cards === 2 && rb.cards === 2)
    ? ok('both properties reconcile two tenants each')
    : bad('setup did not reconcile both', JSON.stringify({ ra, rb }));
  (ra.pool === A.pool && rb.pool === B.pool)
    ? ok(`pools differ and are correct (${A.pool} vs ${B.pool})`)
    : bad('pools are not what the fixture intends', JSON.stringify({ ra, rb }));
  (A.pool !== A.gross)
    ? ok(`A's recoverable pool (${A.pool}) differs from its gross invoiced total (${A.gross})`)
    : bad('the fixture cannot tell the CAM pool from the gross total', 'they are equal');

  // The switches, three times in each direction.
  const check = async (prop, other, round) => {
    await openProp(prop.id);
    const v = await p.evaluate(VIEW);
    const tag = `${prop.name} (round ${round})`;

    (v.activeProp === prop.name)
      ? ok(`${tag}: the open property is ${prop.name}`)
      : bad(`${tag}: wrong property open`, String(v.activeProp));

    // ── HIGH-2 ──────────────────────────────────────────────────────────
    const foreignSpaces = v.spacesNames.filter(n => other.tenants.includes(n));
    const ownSpaces     = prop.tenants.filter(n => v.spacesNames.includes(n));
    (foreignSpaces.length === 0)
      ? ok(`${tag}: Spaces shows no tenant from ${other.name}`)
      : bad(`${tag}: Spaces shows ${other.name}'s tenants`, foreignSpaces.join(', '));
    (ownSpaces.length === prop.tenants.length)
      ? ok(`${tag}: both of its own tenants are listed`)
      : bad(`${tag}: its own tenants are missing from Spaces`,
            JSON.stringify({ shown: v.spacesNames, expected: prop.tenants }));
    (v.spacesListNames.length === prop.tenants.length &&
     v.spacesListNames.every(n => prop.tenants.includes(n)))
      ? ok(`${tag}: #spacesList holds exactly its own two`)
      : bad(`${tag}: #spacesList content is wrong`, JSON.stringify(v.spacesListNames));

    // ── HIGH-1 ──────────────────────────────────────────────────────────
    (v.lastCamPool === prop.pool)
      ? ok(`${tag}: the CAM pool in force is its own (${prop.pool})`)
      : bad(`${tag}: the CAM pool belongs to another run`,
            `${v.lastCamPool} (own ${prop.pool}, other ${other.pool})`);
    (v.claims.length > 0)
      ? ok(`${tag}: ${v.claims.length} concentration finding(s) present to check`)
      : bad(`${tag}: no concentration finding — the fixture proves nothing here`,
            'expected one invoice over 40% of this property’s pool');
    const wrongPool = v.claims.filter(c => c.pool !== prop.poolText);
    (wrongPool.length === 0)
      ? ok(`${tag}: every finding measures against ${prop.poolText}`)
      : bad(`${tag}: a finding measures against another building's pool`,
            JSON.stringify(wrongPool));
    const impossible = v.claims.filter(c => c.pct > 100);
    (impossible.length === 0)
      ? ok(`${tag}: no finding claims an invoice exceeds 100% of the pool`)
      : bad(`${tag}: a finding claims over 100% of the pool`, JSON.stringify(impossible));
    const foreignInAttention = other.tenants.filter(n => v.attention.includes(n));
    (foreignInAttention.length === 0)
      ? ok(`${tag}: the attention panel names no tenant from ${other.name}`)
      : bad(`${tag}: the attention panel describes the other building`,
            foreignInAttention.join(', '));
  };

  for (let round = 1; round <= 3; round++) {
    sec(`round ${round} · ${A.name} → ${B.name} → ${A.name}`);
    await check(A, B, round);
    await check(B, A, round);
  }

  sec('after all six switches, a fresh selection is still clean');
  await openProp(A.id);
  const finalView = await p.evaluate(VIEW);
  (finalView.spacesNames.length === 2 && finalView.spacesNames.every(n => A.tenants.includes(n)))
    ? ok('nothing accumulated across six property switches')
    : bad('content accumulated across repeated switches', JSON.stringify(finalView.spacesNames));
  (finalView.claims.every(c => c.pool === A.poolText))
    ? ok('and the findings still measure against the right pool')
    : bad('findings drifted after repeated switches', JSON.stringify(finalView.claims));

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
