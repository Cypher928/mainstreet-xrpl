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
const want=['Add Photos','Add Maintenance','Add Space Document','Add Note','Add Vendor Invoice','Report Damage','Add Warranty'];
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

// ── demo mode must end the moment the space has a real record ───────────
console.log('\n── sample records give way to real ones ──');
const demo = await p.evaluate(async(t)=>{
  // Fresh property + space so we can observe the transition from zero.
  await addNewProperty();
  await new Promise(r=>setTimeout(r,2000));
  const rows=[{tenant_name:'Suite 118 — Halcyon Bakery',leased_sqft:1600,start_date:'2023-01-01',end_date:'2028-01-01',lease_type:'NNN',cap:4}].map(normalizeTenant);
  const prop=_props.find(y=>y.id===activePropId);
  prop.name='Harbour Point'; prop.totalSqft=26000; prop.tenants=rows;
  tenantData.splice(0,tenantData.length,...rows);
  switchWorkspaceTab('spaces'); renderBulkResults();
  await new Promise(r=>setTimeout(r,500));
  // Read the id back OFF THE APP. Holding the id from my own array went stale —
  // the property the app ends up with is not necessarily the object I built.
  const id=(currentProperty().tenants||[])[0].id;

  TenantSpace.openSpace(id);
  await new Promise(r=>setTimeout(r,700));
  const panel=()=>document.getElementById('tsOverlay');
  const before={samples:(panel().innerText.match(/sample/gi)||[]).length};

  // Record one real thing.
  document.getElementById('tsAddBtn').click();
  await new Promise(r=>setTimeout(r,300));
  document.querySelector('#tsAddPanel .ts-add-choice[data-act="note"]').click();
  await new Promise(r=>setTimeout(r,300));
  document.getElementById('tsAfTitle').value='Walked the suite after move-out';
  document.getElementById('tsAfSave').click();
  await new Promise(r=>setTimeout(r,1800));
  const after={samples:(panel().innerText.match(/sample/gi)||[]).length,
               hasReal:/Walked the suite after move-out/.test(panel().innerText)};
  return {id,before,after};
}, tenantId);
// PropertyReference only generates sample rows for properties it recognises, so
// a synthetic fixture may legitimately have none. Say so rather than passing a
// 0 -> 0 transition off as proof.
if (demo.before.samples === 0) {
  console.log('  \x1b[33m·\x1b[0m this fixture produced no sample rows, so the visual transition is not exercised here');
} else {
  (demo.after.hasReal && demo.after.samples===0)
    ? ok(`samples (${demo.before.samples}) all disappear once one real activity is recorded`)
    : bad('samples still shown alongside real activity', JSON.stringify(demo.after));
}
// The gate itself, exercised directly — this is what actually decides it.
const gate = await p.evaluate(async()=>{
  const t=(TenantSpace.record()||{}).space?.id;
  const prop=currentProperty();
  const rec=TenantSpace.assemble(prop,t);
  const real=(prop.timeline||[]).filter(e=>e.tenantId===t&&e.manual===true).length;
  // Strip the manual events and re-assemble: the space must fall back to demo.
  const keep=prop.timeline.slice();
  prop.timeline=prop.timeline.filter(e=>!(e.tenantId===t&&e.manual===true));
  const recEmpty=TenantSpace.assemble(prop,t);
  prop.timeline=keep;
  return {realEvents:real,
    liveHasActivity:(rec.events||[]).some(e=>e.manual===true),
    emptyHasActivity:(recEmpty.events||[]).some(e=>e.manual===true)};
});
(gate.realEvents>0 && gate.liveHasActivity && !gate.emptyHasActivity)
  ? ok(`the live/demo gate keys off real manual activity (${gate.realEvents} event(s) present; none when removed)`)
  : bad('the demo/live gate does not track real activity', JSON.stringify(gate));

// ── provenance is captured and shown, not just stored ──────────────────
console.log('\n── every activity records who, when and how ──');
const prov = await p.evaluate(()=>{
  // The id the open space is bound to, read now — ids passed between evaluates
  // went stale because the property's tenants array is replaced by the async
  // load in selectProperty().
  const t=(TenantSpace.record()||{}).space?.id;
  const prop=currentProperty();
  const ev=(prop.timeline||[]).filter(e=>e.tenantId===t);
  const last=ev[ev.length-1];
  const panel=document.getElementById('tsOverlay');
  return last?{actor:last.actor,source:last.source,ts:last.timestamp,
    by:last.metadata&&last.metadata.recordedBy,via:last.metadata&&last.metadata.recordedVia,
    at:last.metadata&&last.metadata.recordedAt,
    onScreen:panel?/Manual/.test(panel.innerText||''):false}:null;
});
(prov&&prov.by&&prov.at&&prov.via==='Manual'&&prov.source==='manual')
  ? ok(`captured: by "${prov.by}", via ${prov.via}, at ${String(prov.at).slice(0,19)}`)
  : bad('provenance is missing from the recorded activity',JSON.stringify(prov));
(prov&&prov.onScreen)
  ? ok('and it is shown on the timeline entry, not just stored')
  : bad('provenance is stored but invisible to the user');

// ── every activity type reaches the timeline ───────────────────────────
console.log('\n── the timeline is the single source of truth ──');
const allTypes = await p.evaluate(async()=>{
  const t=(TenantSpace.record()||{}).space?.id;
  const kinds=['photos','maintenance','document','invoice','damage','warranty'];
  for(const k of kinds){
    document.getElementById('tsAddBtn').click();
    await new Promise(r=>setTimeout(r,250));
    const choice=document.querySelector(`#tsAddPanel .ts-add-choice[data-act="${k}"]`);
    if(!choice) continue;
    choice.click();
    await new Promise(r=>setTimeout(r,250));
    document.getElementById('tsAfTitle').value='Recorded '+k;
    document.getElementById('tsAfSave').click();
    await new Promise(r=>setTimeout(r,1200));
  }
  const prop=currentProperty();
  const ev=(prop.timeline||[]).filter(e=>e.tenantId===t);
  return {total:ev.length, types:[...new Set(ev.map(e=>e.type))],
          allManual:ev.filter(e=>e.type.startsWith('space_')).every(e=>e.manual===true),
          allSourced:ev.filter(e=>e.type.startsWith('space_')).every(e=>!!e.source)};
});
(allTypes.types.filter(x=>x.startsWith('space_')).length>=6)
  ? ok(`every activity type lands on the timeline (${allTypes.types.filter(x=>x.startsWith('space_')).length} kinds, ${allTypes.total} events)`)
  : bad('some activity types never reached the timeline',JSON.stringify(allTypes.types));
(allTypes.allManual&&allTypes.allSourced)
  ? ok('all of them carry manual + source, so history stays attributable')
  : bad('some events lack manual/source',JSON.stringify(allTypes));

// ── the control that records things must stay reachable ─────────────────
console.log('\n── Add Activity stays with you while you scroll ──');
const sticky = await p.evaluate(async()=>{
  const bar=document.querySelector('.ts-addbar');
  const ov=document.getElementById('tsOverlay');
  if(!bar||!ov) return {err:'no space open'};
  const before=bar.getBoundingClientRect().top;
  // Scroll the space the way someone reading its history would.
  ov.scrollTop = ov.scrollHeight;
  await new Promise(r=>setTimeout(r,400));
  const r=bar.getBoundingClientRect();
  return {position:getComputedStyle(bar).position,
          before:Math.round(before), after:Math.round(r.top),
          stillOnScreen:r.top>=-2 && r.top < window.innerHeight,
          btnVisible:!!document.getElementById('tsAddBtn') &&
                     document.getElementById('tsAddBtn').getBoundingClientRect().height>2};
});
(sticky.position==='sticky')
  ? ok('the Add Activity bar is sticky')
  : bad('the bar scrolls away with the content', JSON.stringify(sticky));
(sticky.stillOnScreen && sticky.btnVisible)
  ? ok(`still on screen after scrolling to the bottom (top ${sticky.after}px)`)
  : bad('Add Activity is off screen once you scroll', JSON.stringify(sticky));

// ── empty sections should teach, not just report emptiness ──────────────
console.log('\n── empty states explain what belongs there ──');
const empties = await p.evaluate(()=>{
  const ov=document.getElementById('tsOverlay');
  return [...ov.querySelectorAll('.ts-empty')].map(e=>(e.innerText||'').trim());
});
const terse = empties.filter(t=>t.length<60);
(empties.length>0 && terse.length===0)
  ? ok(`all ${empties.length} empty states teach what belongs there (shortest ${Math.min(...empties.map(t=>t.length))} chars)`)
  : bad(`${terse.length} empty state(s) just report emptiness`, terse.join(' | '));
// Checked on a genuinely untouched space, in its OWN page.
//
// The first version created the "fresh" property inside the same page session
// that had already recorded seven activities, and reported that Maintenance,
// Documents and Timeline never showed their empty states. That was wrong — the
// product was correct all along and I reported a product bug that did not
// exist. A page that has been driven through a whole workflow is not a clean
// room; the only way to observe a first-run state is to start one.
const freshEmpties = await (async () => {
  const fresh = await p.context().newPage();
  await fresh.addInitScript('window.__TEST_AUTHED=true;');
  await fresh.addInitScript(DB);
  await fresh.route('**jsdelivr**',r=>r.fulfill({status:200,body:'/*x*/'}));
  await fresh.route('**supabase**',r=>r.request().url().includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'/*x*/'}));
  await fresh.goto(`http://127.0.0.1:${PORT}/`);
  await fresh.waitForSelector('#appContent',{state:'visible',timeout:20000}).catch(()=>{});
  await fresh.waitForTimeout(1800);
  const out = await fresh.evaluate(async()=>{
    const x=[...document.querySelectorAll('button')].find(e=>/go to portfolio/i.test(e.innerText)); if(x)x.click();
    await new Promise(r=>setTimeout(r,800));
    await addNewProperty(); await new Promise(r=>setTimeout(r,2200));
    const rows=[{tenant_name:'Suite 300 — Untouched',leased_sqft:900,lease_type:'NNN',cap:3}].map(normalizeTenant);
    const prop=_props.find(y=>y.id===activePropId);
    prop.tenants=rows; tenantData.splice(0,tenantData.length,...rows);
    switchWorkspaceTab('spaces'); renderBulkResults(); await new Promise(r=>setTimeout(r,400));
    TenantSpace.openSpace((currentProperty().tenants||[])[0].id);
    await new Promise(r=>setTimeout(r,700));
    const ov=document.getElementById('tsOverlay');
    return [...ov.querySelectorAll('.ts-sec')].map(sec=>({
      section:(sec.querySelector('.ts-sec-title')||{}).innerText||'?',
      empty:(sec.querySelector('.ts-empty')||{}).innerText||null}));
  });
  await fresh.close();
  return out;
})();
console.log('   ' + freshEmpties.map(x=>x.section+': '+(x.empty?'teaches':'(has content)')).join('\n   '));
const maintEmpty=(freshEmpties.find(x=>/Maintenance/i.test(x.section))||{}).empty||'';
(/repairs, inspections/i.test(maintEmpty))
  ? ok('an untouched space explains what maintenance is for')
  : bad('the Maintenance section does not explain what to record', JSON.stringify(maintEmpty).slice(0,160));
const noEmpty=freshEmpties.filter(x=>!x.empty);
const shortOnes=freshEmpties.filter(x=>x.empty&&x.empty.length<60);
(noEmpty.length===0 && shortOnes.length===0)
  ? ok(`all ${freshEmpties.length} sections of an untouched space teach what belongs there`)
  : bad('some sections do not teach', [...noEmpty.map(x=>x.section+' (no empty state)'), ...shortOnes.map(x=>x.section+' (too terse)')].join(', '));

// ── the document activity is named for what it is ───────────────────────
console.log('\n── activity labels are specific ──');
const labels = await p.evaluate(()=>TenantSpace.activityTypes().map(t=>t.label));
(!labels.includes('Upload Document') && labels.some(l=>/Space Document/.test(l)))
  ? ok(`the generic "Upload Document" is gone (now "${labels.find(l=>/Document/.test(l))}")`)
  : bad('the document activity is still generically labelled', labels.join(', '));

console.log('\n'+(fail?'\x1b[31m':'\x1b[32m')+`RESULT: ${pass} passed, ${fail} failed`+'\x1b[0m');
await b.close();srv.close();process.exit(fail?1:0);
})();
