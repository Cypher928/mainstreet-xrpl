// test-pilot-readiness.js
// ============================================================================
// Three behaviours the sprint asked to be verified, walked rather than read:
//
//   1. Editing a lease and pressing Done immediately recalculates the review,
//      removes the warnings the edit resolved, and confirms the save visibly.
//   2. The AI Auditor Narrative does not generate until the reconciliation
//      prerequisites are satisfied.
//   3. An incomplete property produces SETUP GUIDANCE, not a reconciliation
//      failure — the user is told what is missing, not that something broke.
//
// Everything here runs against the product's own code paths. No credentials
// are required; nothing in this file touches the AI endpoint.
//
// Run: node test-pilot-readiness.js

const http=require('http'),fs=require('fs'),path=require('path');
let pw;try{pw=require('playwright');}catch(_){pw=require('/opt/node22/lib/node_modules/playwright');}
const ROOT=__dirname,PORT=8930;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.pdf':'application/pdf','.svg':'image/svg+xml'};
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

const seedTenants = `[
  {tenant_name:'Cedar Park Dental',leased_sqft:4200,start_date:'2022-03-01',end_date:'2027-02-28',lease_type:'NNN',cap:5},
  {tenant_name:'Bright Leaf Grocers',leased_sqft:9100,start_date:'2021-06-01',end_date:'2028-05-31',lease_type:'NNN',cap:4},
  {tenant_name:'Willow & Vine Florist',leased_sqft:1500,start_date:'2024-02-01',end_date:'2029-01-31',lease_type:'NNN',cap:null}
]`;

(async()=>{
const srv=http.createServer((rq,rs)=>{
  const u=decodeURIComponent(rq.url.split('?')[0]);
  if(u.startsWith('/api/')){rs.writeHead(200,{'Content-Type':'application/json'});rs.end('{}');return;}
  let r=u==='/'?'/index.html':u;
  fs.readFile(path.join(ROOT,r),(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}
    rs.writeHead(200,{'Content-Type':MIME[path.extname(r)]||'application/octet-stream'});rs.end(d);});
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await pw.chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1500,height:1100}})).newPage();
await p.addInitScript('window.__TEST_AUTHED=true;');
await p.addInitScript(DB);
await p.route('**jsdelivr**',r=>r.fulfill({status:200,body:'/*x*/'}));
await p.route('**supabase**',r=>r.request().url().includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'/*x*/'}));
p.on('pageerror',e=>console.log('  !! pageerror: '+e.message.split('\n')[0]));
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.waitForSelector('#appContent',{state:'visible',timeout:20000}).catch(()=>{});
await p.waitForTimeout(2000);

// ── ITEM 3 first: an INCOMPLETE property must guide, not fail ────────────
// Run it before anything is filled in, which is the state a first-time user is
// actually in when they press the button too early.
console.log('\n── 3. an incomplete property guides instead of failing ──');
await p.evaluate(()=>{const x=[...document.querySelectorAll('button')].find(e=>/go to portfolio/i.test(e.innerText));if(x)x.click();});
await p.waitForTimeout(1200);
await p.evaluate(()=>addNewProperty());
await p.waitForTimeout(2800);
const early=await p.evaluate(async()=>{
  // Guidance can arrive as a toast, an alert, or inline text. Capture all of
  // them — checking only toasts would report a silent failure that isn't one.
  const toasts=[];
  const realToast=window.showToast, realAlert=window.alert;
  window.showToast=function(m){toasts.push('toast: '+String(m));return realToast&&realToast.apply(this,arguments);};
  window.alert=function(m){toasts.push('alert: '+String(m));};
  const before=(document.body.innerText||'');
  try{ showAllocationModal(); }catch(e){ window.showToast=realToast;window.alert=realAlert; return {threw:e.message}; }
  await new Promise(r=>setTimeout(r,1800));
  window.showToast=realToast; window.alert=realAlert;
  const added=(document.body.innerText||'').split('\n').filter(l=>l.trim()&&!before.includes(l.trim()));
  added.slice(0,4).forEach(l=>toasts.push('inline: '+l.trim()));
  const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  const body=(document.body.innerText||'');
  return {toasts,
    modalOpened:vis(document.getElementById('allocModal')),
    guidance:/enter|add|upload|set |need|require|first|before/i.test(toasts.join(' ')),
    // Word-boundaried, and NaN is case-SENSITIVE: /NaN/i matched the "nan" in
    // "tenant" and reported a perfectly good guidance message as a crash.
    mentionsCrash:/\b(error|failed|exception|undefined)\b/i.test(toasts.join(' '))
               || /\bNaN\b/.test(toasts.join(' ')),
    setupPrompt:(document.getElementById('setupNextMsg')||{}).innerText||null};
});
if(early.threw) bad('pressing Calculate on an empty property threw',early.threw);
else {
  (!early.modalOpened)
    ? ok('the confirmation modal does not open on an empty property')
    : bad('an empty property opened the allocation confirmation');
  (early.toasts.length && early.guidance && !early.mentionsCrash)
    ? ok(`it says what is missing: "${early.toasts[0].slice(0,90)}"`)
    : bad('no setup guidance was given',
          `guidance=${early.guidance} mentionsCrash=${early.mentionsCrash} n=${early.toasts.length}\n      `+JSON.stringify(early.toasts));
  early.setupPrompt
    ? ok(`and the setup card still states the next step: "${early.setupPrompt.slice(0,70)}"`)
    : bad('the setup card offers no next step');
}

// Now describe the property and seed leases so the later items have real state.
await p.evaluate(async(tj)=>{
  document.getElementById('propertyName').value='Cedar Park Commons';
  document.getElementById('totalSqft').value='26000';
  const rows=eval(tj).map(normalizeTenant);
  const prop=_props.find(x=>x.id===activePropId);
  prop.name='Cedar Park Commons'; prop.totalSqft=26000;
  prop.tenants=rows; tenantData.splice(0,tenantData.length,...rows);
  if(typeof rebuildDerivedState==='function')rebuildDerivedState(prop);
  switchWorkspaceTab('spaces');
  if(typeof renderBulkResults==='function')renderBulkResults();
  await saveProperty(prop);
},seedTenants);
await p.waitForTimeout(2500);

// ── ITEM 1: edit a flagged lease, press Done ────────────────────────────
console.log('\n── 1. editing a lease and pressing Done ──');
const before=await p.evaluate(()=>{
  const prop=_props.find(x=>x.id===activePropId);
  const items=getReviewQueueItems([prop]).filter(i=>!i.reviewerConfirmed);
  const idx=tenantData.findIndex(t=>t&&t.tenant_name==='Willow & Vine Florist');
  return {flagged:items.map(i=>i.tenantName),idx,
    needsReview:tenantData[idx]?._needsReview,
    rowWarned:!!document.querySelector(`#btr-${idx}.has-warning`),
    banner:(document.getElementById('extractionNextStep')||{}).innerText||null};
});
console.log('   before: '+JSON.stringify(before));
(before.flagged.includes('Willow & Vine Florist'))
  ? ok('the florist lease starts flagged, missing its CAM cap')
  : bad('fixture did not produce a flagged lease',JSON.stringify(before.flagged));

const after=await p.evaluate(async(i)=>{
  const toasts=[];
  const realToast=window.showToast;
  window.showToast=function(m){toasts.push(String(m));return realToast&&realToast.apply(this,arguments);};
  toggleBulkDetail(i);                       // open the editor, as the user does
  await new Promise(r=>setTimeout(r,400));
  const detOpen=document.getElementById(`bdet-${i}`).style.display!=='none';
  handleFieldBlur(i,'cap','6',null);         // supply the missing cap
  await new Promise(r=>setTimeout(r,300));
  const btn=document.getElementById(`bdone-${i}`);
  const btnLabelBefore=(btn.innerText||'').trim();
  await saveBulkTenant(i);                   // press Done
  const btnLabelAfter=(btn.innerText||'').trim();
  const flashed=!!document.querySelector(`#btr-${i}.lease-save-flash`);
  await new Promise(r=>setTimeout(r,1600));  // let the 850ms re-render land
  window.showToast=realToast;
  const prop=_props.find(x=>x.id===activePropId);
  return {detOpen,btnLabelBefore,btnLabelAfter,flashed,toasts,
    cap:tenantData[i].cap, needsReview:tenantData[i]._needsReview,
    rowStillWarned:!!document.querySelector(`#btr-${i}.has-warning`),
    stillFlagged:getReviewQueueItems([prop]).filter(x=>!x.reviewerConfirmed).map(x=>x.tenantName),
    banner:(document.getElementById('extractionNextStep')||{}).innerText||null};
},before.idx);
console.log('   after : '+JSON.stringify({cap:after.cap,needsReview:after.needsReview,flagged:after.stillFlagged}));

(after.detOpen) ? ok('the row expands into an editor') : bad('the lease editor did not open');
(String(after.cap)==='6') ? ok('the edited value is committed to the model (cap = 6)')
                          : bad('the edit was not saved',String(after.cap));
(after.needsReview===false) ? ok('the review recalculates immediately — _needsReview cleared')
                            : bad('the tenant is still flagged after the fix');
(!after.stillFlagged.includes('Willow & Vine Florist'))
  ? ok('and the review queue drops it — resolved warnings removed')
  : bad('the review queue still lists the resolved lease',JSON.stringify(after.stillFlagged));
(!after.rowStillWarned) ? ok('the row no longer carries a warning state')
                        : bad('the row still shows has-warning after the fix');
const confirmed = after.toasts.some(t=>/updated|saved/i.test(t)) || /saved/i.test(after.btnLabelAfter) || after.flashed;
confirmed ? ok(`the save is confirmed visibly (${after.toasts.filter(t=>/updat|save/i.test(t))[0]||after.btnLabelAfter||'row flash'})`)
          : bad('nothing told the user the save succeeded',JSON.stringify({toasts:after.toasts,btn:after.btnLabelAfter,flash:after.flashed}));
(after.banner && !/Willow/.test(after.banner))
  ? ok(`the next-step banner refreshes too: "${after.banner.replace(/\s+/g,' ').slice(0,80)}"`)
  : (after.banner ? bad('the banner still names the resolved lease',after.banner.slice(0,90))
                  : ok('no outstanding-review banner remains'));

// ── ITEM 2: the AI Auditor Narrative gates on reconciliation ────────────
console.log('\n── 2. the AI Auditor Narrative waits for reconciliation ──');
const preNarr=await p.evaluate(()=>{
  const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  renderNarrativePanel();               // ask for it directly, before any results
  return {resultsCount:lastResults.length,
    panelPresent:!!document.getElementById('narrativePanel'),
    panelVisible:vis(document.getElementById('narrativePanel'))};
});
(preNarr.resultsCount===0 && !preNarr.panelVisible)
  ? ok(`no narrative before reconciliation (lastResults=${preNarr.resultsCount})`)
  : bad('a narrative was produced with no reconciliation behind it',JSON.stringify(preNarr));

// Supply invoices and actually reconcile.
await p.evaluate(async()=>{
  const inv=[{vendorName:'Talon Security',category:'security',amount:26100,invoiceDate:'2025-05-03'},
             {vendorName:'Cascade Insurance',category:'insurance',amount:42000,invoiceDate:'2025-02-01'},
             {vendorName:'Pacific Facilities',category:'janitorial',amount:31250,invoiceDate:'2025-06-21'}];
  invoiceData.splice(0,invoiceData.length,...inv);
  const prop=_props.find(x=>x.id===activePropId); prop.invoices=inv;
  switchWorkspaceTab('cam');
  if(typeof renderInvResults==='function')renderInvResults();
  await saveProperty(prop);
});
await p.waitForTimeout(1200);
await p.evaluate(()=>showAllocationModal());
await p.waitForTimeout(1200);
await p.evaluate(()=>confirmAllocation());
await p.waitForTimeout(8000);
const postNarr=await p.evaluate(()=>{
  const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  const n=document.getElementById('narrativePanel');
  return {resultsCount:lastResults.length,panelVisible:vis(n),
    text:vis(n)?(n.innerText||'').replace(/\s+/g,' ').trim().slice(0,150):null};
});
(postNarr.resultsCount>0)
  ? ok(`reconciliation produced ${postNarr.resultsCount} allocation result(s)`)
  : bad('the reconciliation produced nothing to narrate');
(postNarr.panelVisible)
  ? ok(`and the narrative now generates: "${(postNarr.text||'').slice(0,80)}…"`)
  : bad('the narrative never appeared even after reconciliation',JSON.stringify(postNarr));

// ── 4. a deleted property must not leave its banner behind ──────────────
// Reported from the pilot: the whole portfolio was deleted, a new property
// created, and it showed "1 of 5 leases need a human — SafeShield Insurance"
// with an empty drop zone. Nothing had leaked; the extraction banner was a
// stale DOM node surviving from a property that no longer existed, because
// _renderExtractionNextStep() returned before removing it when its property
// lookup came back undefined.
console.log('\n── 4. no banner survives the property it described ──');
const stale = await p.evaluate(async () => {
  // Get a banner on screen for the CURRENT property.
  switchWorkspaceTab('spaces');
  renderBulkResults();
  await new Promise(r => setTimeout(r, 400));
  const had = !!document.getElementById('extractionNextStep');

  // Now make the active property vanish from _props, exactly as deleting it does,
  // and re-render. activePropId still points at the deleted id.
  const gone = activePropId;
  const i = _props.findIndex(x => x.id === gone);
  if (i > -1) _props.splice(i, 1);
  renderBulkResults();
  await new Promise(r => setTimeout(r, 400));
  const survived = !!document.getElementById('extractionNextStep');
  const text = survived ? (document.getElementById('extractionNextStep').innerText || '').replace(/\s+/g, ' ').slice(0, 80) : null;
  return { had, survived, text };
});
(stale.had)
  ? ok('a banner renders for a property with outstanding reviews')
  : bad('fixture produced no banner to begin with');
(!stale.survived)
  ? ok('and it is gone the moment that property no longer exists')
  : bad('the banner outlived its property — it will reappear on the next one', stale.text);

console.log('\n'+(fail?'\x1b[31m':'\x1b[32m')+`RESULT: ${pass} passed, ${fail} failed`+'\x1b[0m');
await b.close();srv.close();process.exit(fail?1:0);
})();
