// test-space-activity.js
// ============================================================================
// A space must be a folder, not a viewer.
//
// The Space panel showed Maintenance, Photos and Documents sections and had no
// means of accepting any of them — the rows in it came from property-reference.js
// sample data, so it displayed a maintenance history it could not record. A
// property manager standing in Suite 204 had nowhere to put a move-out photo.
//
// Add Activity writes ONE timeline event per action, scoped to the tenant, with
// its attachments tagged by kind. assemble() already scopes property.timeline to
// the space and _attach(events, kind) already files attachments into sections —
// so a correctly-shaped event makes Timeline, Maintenance, Photos and Documents
// all update themselves. This suite proves that end to end: it drives the real
// UI and then asserts the sections actually changed.
//
// Run: node test-space-activity.js

const http=require('http'),fs=require('fs'),path=require('path');
let pw;try{pw=require('playwright');}catch(_){pw=require('/opt/node22/lib/node_modules/playwright');}
const ROOT=__dirname,PORT=8960;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.pdf':'application/pdf'};
let pass=0,fail=0;
const ok=m=>{console.log('  \x1b[32m✓\x1b[0m '+m);pass++;};
const bad=(m,d)=>{console.log('  \x1b[31m✗\x1b[0m '+m+(d?'\n      '+d:''));fail++;};
const DB=`
(function(){
  var U={id:'first-timer',email:'newuser@example.com'};
  function P(v){return Promise.resolve(v);}
  function store(){try{return JSON.parse(localStorage.getItem('__mockdb')||'{}');}catch(e){return {};}}
  function put(s){localStorage.setItem('__mockdb',JSON.stringify(s));}
  function tbl(n){var s=store();s[n]=s[n]||[];return s[n];}
  function save(n,r){var s=store();s[n]=r;put(s);}
  function uuid(){return 'p'+Math.random().toString(16).slice(2,10)+'-1111-4000-a000-'+Date.now().toString(16);}
  function q(name){var filters=[],single=false;
    var api={select:function(){return api;},eq:function(k,v){filters.push([k,v]);return api;},
      neq:function(){return api;},is:function(){return api;},order:function(){return api;},
      limit:function(){return api;},ilike:function(){return api;},in:function(){return P({data:[],error:null});},
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
  },rpc:function(){return P({data:null,error:null});},from:function(n){return q(n);},storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;
(async()=>{
const srv=http.createServer((rq,rs)=>{const u=decodeURIComponent(rq.url.split('?')[0]);
 if(u.startsWith('/api/')){rs.writeHead(200,{'Content-Type':'application/json'});rs.end('{}');return;}
 let r=u==='/'?'/index.html':u;
 fs.readFile(path.join(ROOT,r),(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}
  rs.writeHead(200,{'Content-Type':MIME[path.extname(r)]||'application/octet-stream'});rs.end(d);});});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await pw.chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1100}})).newPage();
await p.addInitScript('window.__TEST_AUTHED=true;');await p.addInitScript(DB);
await p.route('**jsdelivr**',r=>r.fulfill({status:200,body:'/*x*/'}));
await p.route('**supabase**',r=>r.request().url().includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'/*x*/'}));
p.on('pageerror',e=>console.log('  !! '+e.message.split('\n')[0]));
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.waitForSelector('#appContent',{state:'visible',timeout:20000}).catch(()=>{});
await p.waitForTimeout(2000);

// A property with one space — Suite 204's tenant.
const tenantId = await p.evaluate(async()=>{
  const x=[...document.querySelectorAll('button')].find(e=>/go to portfolio/i.test(e.innerText)); if(x)x.click();
  await new Promise(r=>setTimeout(r,800));
  await addNewProperty();
  await new Promise(r=>setTimeout(r,2200));
  const rows=[{tenant_name:'Suite 204 — Vantage Optical',leased_sqft:2400,start_date:'2022-01-01',end_date:'2027-12-31',lease_type:'NNN',cap:5}].map(normalizeTenant);
  const prop=_props.find(y=>y.id===activePropId);
  prop.name='Harbour Point'; prop.totalSqft=26000; prop.tenants=rows;
  tenantData.splice(0,tenantData.length,...rows);
  switchWorkspaceTab('spaces'); renderBulkResults();
  await new Promise(r=>setTimeout(r,600));
  return rows[0].id;
});

console.log('\n── the space offers a way to contribute ──');
const opened = await p.evaluate(async(tid)=>{
  TenantSpace.openSpace(tid);
  await new Promise(r=>setTimeout(r,700));
  const vis=e=>!!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>2;
  return {overlay:vis(document.getElementById('tsOverlay')),
          addBtn:vis(document.getElementById('tsAddBtn')),
          label:(document.getElementById('tsAddBtn')||{}).innerText||''};
}, tenantId);
(opened.overlay&&opened.addBtn)?ok(`the space opens with an "${opened.label.trim()}" control`)
                               :bad('no Add Activity control in the space',JSON.stringify(opened));

const choices = await p.evaluate(async()=>{
  document.getElementById('tsAddBtn').click();
  await new Promise(r=>setTimeout(r,350));
  return [...document.querySelectorAll('#tsAddPanel .ts-add-choice')].map(b=>(b.innerText||'').trim());
});
const want=['Add Photos','Add Maintenance','Upload Document','Add Note','Add Vendor Invoice','Report Damage','Add Warranty'];
const missing=want.filter(w=>!choices.some(c=>c.includes(w)));
(missing.length===0)?ok(`all seven activities offered (${choices.length})`)
                    :bad('activities missing from the picker',missing.join(', '));

// ── Christy records maintenance on the space ────────────────────────────
console.log('\n── adding maintenance files itself everywhere ──');
const before = await p.evaluate(t=>{
  const r=TenantSpace.assemble(currentProperty(),t);
  return {events:r.counts.events, docs:r.counts.documents, photos:r.counts.photos};
}, tenantId);

const after = await p.evaluate(async(t)=>{
  document.querySelector('#tsAddPanel .ts-add-choice[data-act="maintenance"]').click();
  await new Promise(r=>setTimeout(r,350));
  document.getElementById('tsAfTitle').value  = 'HVAC serviced by ABC Mechanical';
  document.getElementById('tsAfVendor').value = 'ABC Mechanical';
  document.getElementById('tsAfCost').value   = '480';
  document.getElementById('tsAfWarranty').value = '2028-07-12';
  document.getElementById('tsAfSave').click();
  await new Promise(r=>setTimeout(r,1800));
  const prop=currentProperty();
  const r=TenantSpace.assemble(prop,t);
  const ev=(prop.timeline||[]).filter(e=>e.tenantId===t);
  const panel=document.getElementById('tsOverlay');
  return {events:r.counts.events, timelineLen:ev.length,
    last: ev.length?{title:ev[ev.length-1].title,cat:ev[ev.length-1].category,
                     meta:ev[ev.length-1].metadata,manual:ev[ev.length-1].manual,
                     scoped:ev[ev.length-1].tenantId===t}:null,
    onScreen: panel?/HVAC serviced by ABC Mechanical/.test(panel.innerText||''):false,
    maintSection: panel?/Maintenance/.test(panel.innerText||''):false};
}, tenantId);

(after.timelineLen>0)?ok('the activity is written as a timeline event')
                     :bad('nothing was recorded on the property timeline');
(after.last&&after.last.scoped)?ok('scoped to this space (tenantId set)')
                               :bad('the event is not scoped to the space',JSON.stringify(after.last));
// The probe returns this field as `cat`; asserting on `.category` read undefined
// and failed a correct implementation.
(after.last&&after.last.cat==='maintenance')
  ?ok(`filed under the right category ("${after.last.cat}")`)
  :bad('wrong category',JSON.stringify({got:after.last&&after.last.cat,full:after.last}));
(after.last&&after.last.meta&&after.last.meta.costUsd===480&&after.last.meta.vendor==='ABC Mechanical'&&after.last.meta.warrantyExpires==='2028-07-12')
  ?ok('cost, vendor and warranty expiry are all captured')
  :bad('structured fields lost',JSON.stringify(after.last&&after.last.meta));
(after.events>before.events)
  ?ok(`the space's own record grew (${before.events} → ${after.events} events)`)
  :bad('assemble() did not pick the new event up');
(after.onScreen)?ok('and it is visible in the reopened space panel')
                :bad('the panel does not show what was just added');

// ── a note, with no attachment, must also work ──────────────────────────
console.log('\n── a note is enough on its own ──');
const note = await p.evaluate(async(t)=>{
  document.getElementById('tsAddBtn').click();
  await new Promise(r=>setTimeout(r,300));
  document.querySelector('#tsAddPanel .ts-add-choice[data-act="note"]').click();
  await new Promise(r=>setTimeout(r,300));
  document.getElementById('tsAfTitle').value='Tenant requested repaint before renewal';
  document.getElementById('tsAfSave').click();
  await new Promise(r=>setTimeout(r,1500));
  const prop=currentProperty();
  const ev=(prop.timeline||[]).filter(e=>e.tenantId===t);
  const panel=document.getElementById('tsOverlay');
  return {n:ev.length,last:ev[ev.length-1]?.title,
          onScreen:panel?/repaint before renewal/.test(panel.innerText||''):false};
}, tenantId);
(note.n>=2&&/repaint before renewal/.test(note.last||''))
  ?ok(`a note records with no attachment ("${note.last}")`)
  :bad('the note was not recorded',JSON.stringify(note));
(note.onScreen)?ok('and appears in the space immediately'):bad('the note is not on screen');

// ── an empty submission must be refused, not silently dropped ──────────
console.log('\n── an empty activity is refused with a reason ──');
const empty = await p.evaluate(async()=>{
  document.getElementById('tsAddBtn').click();
  await new Promise(r=>setTimeout(r,300));
  document.querySelector('#tsAddPanel .ts-add-choice[data-act="note"]').click();
  await new Promise(r=>setTimeout(r,300));
  const before=(currentProperty().timeline||[]).length;
  document.getElementById('tsAfSave').click();
  await new Promise(r=>setTimeout(r,600));
  const err=document.getElementById('tsAfErr');
  return {shown:!!err&&getComputedStyle(err).display!=='none',msg:err?(err.innerText||'').trim():null,
          added:(currentProperty().timeline||[]).length-before};
});
(empty.shown&&empty.added===0)
  ?ok(`refused with a reason ("${(empty.msg||'').slice(0,60)}"), nothing written`)
  :bad('an empty activity was accepted or failed silently',JSON.stringify(empty));

console.log('\n'+(fail?'\x1b[31m':'\x1b[32m')+`RESULT: ${pass} passed, ${fail} failed`+'\x1b[0m');
await b.close();srv.close();process.exit(fail?1:0);
})();
