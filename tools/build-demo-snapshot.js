'use strict';
/**
 * Freeze the demo seed into a static snapshot the public /demo route can boot
 * from with no database behind it.
 *
 *   node tools/build-demo-snapshot.js            # writes demo-snapshot.js
 *   node tools/build-demo-snapshot.js --check    # exit 1 if missing or stale
 *
 * WHAT THIS IS NOT. It is not a hand-written fixture, and it is not a mockup.
 * It runs the REAL seeder — ensureDemoProperty() and ensureNorthgateDemo() in
 * script.js — in a real browser against the real product, and writes down what
 * they produced. If the seed changes, this is re-run and the snapshot changes
 * with it. A judge on /demo is looking at the same rows a signed-in pilot user
 * would have been given, not at a story about them.
 *
 * WHY A SNAPSHOT AT ALL. The demo data is seeded per user and every RLS policy
 * on it is FOR ALL to `authenticated` — there is no read-only grant. So any
 * session that can show the data can also delete it. Rather than hand the
 * public a writable session, /demo boots from this file into memory and never
 * opens a connection. See docs/PUBLIC_DEMO.md.
 */
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const OUT  = path.join(ROOT, 'demo-snapshot.js');
const PORT = 8973;
const MIME = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json',
               '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.pdf':'application/pdf',
               '.mp3':'audio/mpeg','.webm':'audio/webm' };

// A Supabase stand-in for the BUILD only. It exists so the seeder has somewhere
// to write; what it wrote is then read back out. It never ships.
const DB = `
(function(){
  var U={id:'demo-public-0000-4000-a000-000000000001',email:'demo@mainstreet.invalid'};
  function P(v){return Promise.resolve(v);}
  function store(){try{return JSON.parse(localStorage.getItem('__mockdb')||'{}');}catch(e){return {};}}
  function put(s){localStorage.setItem('__mockdb',JSON.stringify(s));}
  function tbl(n){var s=store();s[n]=s[n]||[];return s;}
  function match(row,f){return f.every(function(c){var v=row[c[1]];
    if(c[0]==='eq')return v===c[2]; if(c[0]==='in')return (c[2]||[]).indexOf(v)>=0; if(c[0]==='is')return v==null; return true;});}
  function Q(name){var f=[],lim=null;var q={};
    q.select=function(){return q;};
    q.eq=function(c,v){f.push(['eq',c,v]);return q;}; q.in=function(c,v){f.push(['in',c,v]);return q;};
    q.is=function(c,v){f.push(['is',c,v]);return q;}; q.neq=function(){return q;}; q.ilike=function(){return q;};
    q.order=function(){return q;}; q.limit=function(n){lim=n;return q;}; q.range=function(){return q;};
    q.maybeSingle=q.single=function(){var s=tbl(name);var r=s[name].filter(function(x){return match(x,f);});return P({data:r[0]||null,error:null});};
    q.upsert=function(row){var rows=Array.isArray(row)?row:[row];var s=tbl(name);rows.forEach(function(r){var i=s[name].findIndex(function(x){return x.id===r.id;});if(i>=0)s[name][i]=Object.assign({},s[name][i],r);else s[name].push(r);});put(s);var p=P({data:rows,error:null});p.select=function(){return P({data:rows,error:null});};p.single=function(){return P({data:rows[0],error:null});};return p;};
    q.insert=q.upsert;
    q.update=function(patch){var s=tbl(name);var ch=[];s[name].forEach(function(x,i){if(match(x,f)){s[name][i]=Object.assign({},x,patch);ch.push(s[name][i]);}});put(s);var p=P({data:ch,error:null});p.select=function(){return P({data:ch,error:null});};p.eq=function(c,v){f.push(['eq',c,v]);return p;};p.in=function(c,v){f.push(['in',c,v]);return p;};return p;};
    q.delete=function(){var d={};d.eq=function(c,v){f.push(['eq',c,v]);var s=tbl(name);s[name]=s[name].filter(function(x){return !match(x,f);});put(s);return P({error:null});};d.in=d.eq;return d;};
    q.then=function(res,rej){var s=tbl(name);var r=s[name].filter(function(x){return match(x,f);});if(lim)r=r.slice(0,lim);return P({data:r,error:null}).then(res,rej);};
    return q;}
  window.supabase={createClient:function(){return {auth:{
    getUser:function(){return P({data:{user:U},error:null});},
    getSession:function(){return P({data:{session:{user:U}},error:null});},
    onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:U});},40);return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return P({error:null});}},
    from:Q, rpc:function(){return P({data:null,error:null});},
    storage:{from:function(){return {upload:function(){return P({data:null,error:null});},
      getPublicUrl:function(p){return {data:{publicUrl:p}};}};}}};}};
})();`;

(async () => {
  const check = process.argv.includes('--check');
  if (check) {
    if (!fs.existsSync(OUT)) { console.log('missing: demo-snapshot.js'); process.exit(1); }
    const src = fs.readFileSync(OUT, 'utf8');
    const okv = /"_demoV":\s*9/.test(src);
    console.log(okv ? 'demo-snapshot.js present, seed v9' : 'demo-snapshot.js is STALE (not v9)');
    process.exit(okv ? 0 : 1);
  }

  const srv = http.createServer((rq, rs) => {
    let r = decodeURIComponent(rq.url.split('?')[0]); if (r === '/') r = '/index.html';
    fs.readFile(path.join(ROOT, r), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  for (const p of ['**cdnjs**', '**jsdelivr**']) await page.route(p, r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(DB);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });

  // The real seeders, through the real load path.
  await page.evaluate(() => loadDemo());
  await page.waitForFunction(() => {
    const el = document.getElementById('mainWorkflow');
    return el && el.style.display !== 'none' && (currentProperty() || {}).invoices;
  }, null, { timeout: 40000 });
  await page.evaluate(async () => { if (typeof ensureNorthgateDemo === 'function') await ensureNorthgateDemo(); });
  await page.waitForTimeout(3000);

  // FROM THE LIVE OBJECTS, NOT THE SAVED ROWS.
  //
  // The save boundary strips what it can rebuild: Northgate's `tenants` never
  // reach the persisted payload, because on load they are rehydrated from the
  // normalized tenants table. Reading the stored row therefore produced a
  // property with sixteen invoices and no tenants — a demo that opens on a
  // building with nobody in it. `_props` is what the app is actually holding
  // once both seeders have run, which is the state /demo needs to restore.
  const snap = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('__mockdb') || '{}');
    const rows = s.properties || [];
    // `_props` is a top-level `let`, which creates a global BINDING but not a
    // window property — window._props is undefined and silently yielded [].
    const live = (typeof _props !== 'undefined' && Array.isArray(_props)) ? _props : [];
    const properties = live.map(p => {
      const row = rows.find(r => r.id === p.id) || {};
      // The live object IS the data payload the app works from; the row carries
      // the columns around it.
      const { id, ...rest } = p;
      return { id: p.id, user_id: row.user_id || null, name: p.name,
               sqft: row.sqft != null ? row.sqft : (p.totalSqft || null), data: rest };
    });
    return { properties, tenants: s.tenants || [] };
  });
  await browser.close(); srv.close();

  const casc = snap.properties.find(p => /Cascade/i.test(p.name || ''));
  if (!casc) { console.error('REFUSING TO WRITE: Cascade Commons not in the seeded output'); process.exit(2); }
  const inv = (casc.data && casc.data.invoices) || [];
  const documented = inv.filter(i => i && (i.fileUrl || i.fileName)).length;
  if (inv.length !== 26 || documented !== 26) {
    console.error(`REFUSING TO WRITE: expected 26 documented invoices, got ${documented} of ${inv.length}`);
    process.exit(2);
  }
  if (String(casc.data && casc.data._demoV) !== '9') {
    console.error('REFUSING TO WRITE: Cascade is not at seed v9 — got ' + (casc.data && casc.data._demoV));
    process.exit(2);
  }

  const body = JSON.stringify(snap, null, 1);
  fs.writeFileSync(OUT,
`/* GENERATED — do not edit. node tools/build-demo-snapshot.js
 *
 * The demo seed, frozen. Produced by running the real ensureDemoProperty() and
 * ensureNorthgateDemo() in a real browser and writing down what they made, so
 * the public /demo route shows the same rows a signed-in pilot user is given
 * rather than a retelling of them. Re-run this whenever the seed changes.
 *
 * Cascade Commons: seed v${casc.data._demoV}, ${inv.length} invoices, ${documented} with a source document.
 */
window.__MS_DEMO_SNAPSHOT = ${body};
`);
  console.log(`wrote demo-snapshot.js — ${snap.properties.length} properties, ${snap.tenants.length} tenants, `
    + `Cascade v${casc.data._demoV} with ${documented}/${inv.length} documented invoices, `
    + `${Math.round(fs.statSync(OUT).size / 1024)} KB`);
})();
