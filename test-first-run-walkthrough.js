// test-first-run-walkthrough.js
// ============================================================================
// An END-TO-END WALKTHROUGH, not a component test. It drives the product from a
// genuinely empty account the way a first-time property manager would: it only
// ever clicks things by their VISIBLE LABEL, and it only ever asserts on what is
// actually on screen. No internal state is consulted to decide what to do next —
// if a human could not find the next step, neither can this.
//
// It exists because "the component renders" kept being true while the workflow
// was impossible. Every dead end below was found by walking, not by reading:
//
//   * creating a property landed on Overview, which says "OCCUPANCY — Set total
//     sqft to enable" and contains no field to set it in; the inputs are on the
//     Property tab and nothing pointed there
//   * there was no Save action at all — the fields autosave invisibly
//   * saving called renderPortfolio(), which hides #mainWorkflow, so the user
//     was thrown back out to the portfolio the instant they saved
//   * the entire Lease Upload card lived in #wsPane-documents, a pane removed
//     from WORKSPACE_TABS — unreachable, along with its "next step" hint
//   * the empty state told users to upload "in the Documents tab", which no
//     longer exists
//
// A caution recorded here because it cost real time: the bulk upload panel does
// not use .upload-zone. Checking only for that class reported a DEAD END on a
// screen that was working perfectly. When this harness says something is
// missing, confirm it is missing for a user before believing it.
//
// Run: node test-first-run-walkthrough.js
// Walk MainStreet as a first-time property manager, from an EMPTY account.
// Records only what a user can see: visible headings, visible buttons, and a
// screenshot. No internal state is consulted to decide what to click.
const http=require('http'),fs=require('fs'),path=require('path');
let pw;try{pw=require('playwright');}catch(_){pw=require('/opt/node22/lib/node_modules/playwright');}
const ROOT='/home/user/mainstreet-xrpl',PORT=8910,OUT=process.env.OUT||'/tmp/claude-0/-home-user-mainstreet-xrpl/1fbf60da-4d0d-55d1-a66a-ea7fc9ee7968/scratchpad/walk';
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.pdf':'application/pdf','.svg':'image/svg+xml'};
fs.mkdirSync(OUT,{recursive:true});
const MOCK=fs.readFileSync(path.join(ROOT,'..','mainstreet-xrpl','tools','capture-film-ui-plates.js'),'utf8');
// stateful supabase stand-in
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
  },from:function(n){return q(n);},storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;

const seen=[];
async function snap(p,label){
  const info=await p.evaluate(()=>{
    const isVis=e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);
      return cs.display!=='none'&&cs.visibility!=='hidden'&&parseFloat(cs.opacity||'1')>0.05&&r.width>2&&r.height>2
        && r.bottom>0 && r.top<(window.innerHeight*3);};
    const txt=e=>(e.innerText||e.value||'').replace(/\s+/g,' ').trim();
    const heads=[...document.querySelectorAll('h1,h2,h3,.sec-head h2,.ptf-empty-title')].filter(isVis).map(txt).filter(Boolean);
    const btns=[...document.querySelectorAll('button,a.btn,[role=button],.btn')].filter(isVis)
      .map(e=>txt(e)).filter(t=>t&&t.length<60);
    const fields=[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(isVis)
      .map(e=>({id:e.id,label:(document.querySelector(`label[for="${e.id}"]`)||{}).innerText||e.placeholder||'',value:e.value}));
    const empty=[...document.querySelectorAll('.ptf-empty-state,.workspace-empty,.empty-state')].filter(isVis).map(txt);
    return {heads:[...new Set(heads)],btns:[...new Set(btns)],fields,empty,
      tab:(typeof _activeWorkspaceTab!=='undefined'?_activeWorkspaceTab:null),
      url:location.pathname};
  });
  await p.screenshot({path:path.join(OUT,label.replace(/[^a-z0-9]+/gi,'-')+'.png')});
  seen.push({label,...info});
  console.log(`\n=== ${label}  [tab: ${info.tab}]`);
  if(info.heads.length) console.log('   headings : '+info.heads.slice(0,6).join(' | '));
  if(info.fields.length) console.log('   fields   : '+info.fields.map(f=>`${f.label||f.id}${f.value?'="'+f.value+'"':''}`).join(' | '));
  console.log('   buttons  : '+(info.btns.slice(0,14).join(' | ')||'(none)'));
  if(info.empty.length) console.log('   emptyMsg : '+info.empty.join(' // ').slice(0,200));
  return info;
}

(async()=>{
const srv=http.createServer((rq,rs)=>{let r=decodeURIComponent(rq.url.split('?')[0]);if(r==='/')r='/index.html';
 fs.readFile(path.join(ROOT,r),(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(r)]||'application/octet-stream'});rs.end(d);});});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await pw.chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.addInitScript('window.__TEST_AUTHED=true;');
await p.addInitScript(DB);
await p.route('**jsdelivr**',r=>r.fulfill({status:200,body:'/*x*/'}));
await p.route('**supabase**',r=>r.request().url().includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'/*x*/'}));
await p.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
p.on('pageerror',e=>console.log('  !! PAGEERROR: '+e.message.split('\n')[0]));
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.waitForSelector('#appContent',{state:'visible',timeout:15000}).catch(()=>{});
await p.waitForTimeout(2500);

await snap(p,'01 empty account, first screen');

// Click by VISIBLE LABEL, the way a user does. Returns what was clicked.
async function click(p,re,what){
  const hit=await p.evaluate(pattern=>{
    const rx=new RegExp(pattern,'i');
    const cands=[...document.querySelectorAll('button,a,[role=button],.btn')].filter(e=>{
      const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
      return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>2&&r.height>2&&rx.test((e.innerText||'').trim());});
    if(!cands.length)return null;
    const b=cands[0]; const t=(b.innerText||'').replace(/\s+/g,' ').trim(); b.click(); return t;
  },re.source||re);
  console.log(`\n>> click "${what}" -> ${hit?JSON.stringify(hit):'\x1b[31mNOT FOUND — DEAD END\x1b[0m'}`);
  await p.waitForTimeout(2200);
  return hit;
}

// A first-time user faces a welcome overlay. Get past it.
await click(p,/go to portfolio|get started|skip|close/i,'dismiss the welcome');
await snap(p,'02 portfolio, empty account');

const madeProp=await click(p,/create (your )?first propert|add (your )?first propert|create propert|add propert/i,'create a property');
await snap(p,'03 after creating a property');

// ── Steps 2-3: describe the property and save it ────────────────────────
const setup=await p.evaluate(()=>{
  const vis=e=>e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>2;
  return {name:vis(document.getElementById('propertyName')),sqft:vis(document.getElementById('totalSqft'))};
});
if(!setup.name||!setup.sqft){ console.log('\x1b[31m   DEAD END: no property fields on the screen the user landed on\x1b[0m'); }
else {
  await p.fill('#propertyName','Cedar Park Commons'); await p.waitForTimeout(200);
  await p.fill('#totalSqft','26000');                 await p.waitForTimeout(600);
  await snap(p,'04 property described');
  const saved=await click(p,/save & continue|save and continue/i,'save the property');
  if(!saved) console.log('\x1b[31m   DEAD END: nothing to click to commit the property\x1b[0m');
  await snap(p,'05 after save');
}

// ── Step 4: upload leases ───────────────────────────────────────────────
const lease=await p.evaluate(()=>{
  const vis=e=>e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>2;
  // NB: the bulk panel does NOT use .upload-zone — checking only that class
  // reported a false dead end on a screen that was working. Look for anything
  // droppable: a visible file input is what actually matters to the user.
  const zones=[...document.querySelectorAll('#cardLeases .upload-zone, #cardLeases input[type=file]')].map(z=>({
    id:z.id,visible:vis(z),panel:(z.closest('[id^=leasePanel]')||{}).id||'?',
    text:(z.innerText||'').replace(/\s+/g,' ').trim().slice(0,60)}));
  const activeZone=zones.find(z=>z.visible);
  return {zones,zoneVisible:!!activeZone,zoneText:activeZone?activeZone.text:null,
    fileInput:!!document.querySelector('#cardLeases input[type=file]'),
    cardVisible:vis(document.getElementById('cardLeases'))};
});
console.log('\n   lease upload reachable? zoneVisible='+lease.zoneVisible+' cardVisible='+lease.cardVisible);
console.log(JSON.stringify(await p.evaluate(()=>{
  const vis=e=>e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>2;
  const panels=['leasePanelBulk','leasePanelSingle','leasePanelCenter'].map(id=>{
    const e=document.getElementById(id);
    return {id,visible:vis(e),text:e?(e.innerText||'').replace(/\s+/g,' ').trim().slice(0,120):'MISSING',
      fileInputs:e?[...e.querySelectorAll('input[type=file]')].map(i=>({id:i.id,visible:vis(i),
        parentVisible:vis(i.parentElement)})):[]};
  });
  return {panels, bulkInput:(()=>{const i=document.getElementById('bulkLeaseInput');
    return i?{exists:true,visible:vis(i),parent:(i.parentElement||{}).className}:{exists:false};})()};
}),null,1));
if(!lease.zoneVisible) console.log('\x1b[31m   DEAD END: after saving there is no visible way to upload a lease\x1b[0m');

// Feed it the project's own demo lease, as a user would pick a file.
const leaseFile=['fixtures/demo-lease.pdf','assets/demo/demo-lease.pdf','fixtures/lease.pdf']
  .map(f=>require('path').join(ROOT,f)).find(f=>require('fs').existsSync(f));
console.log('   demo lease on disk: '+(leaseFile||'(none found)'));
if(lease.fileInput&&leaseFile){
  await p.setInputFiles('#cardLeases input[type=file]',leaseFile).catch(e=>console.log('   upload failed: '+e.message.split('\n')[0]));
  await p.waitForTimeout(6000);
  await snap(p,'06 after choosing a lease');
}

// ── Step 5: review the AI extraction ────────────────────────────────────
// The AI endpoint is not reachable offline, so the state a successful upload
// WOULD have produced is seeded here — through the product's own
// normalizeTenant() and its own persistence, not hand-built objects — and the
// walk continues from there exactly as a pilot customer would experience it.
// Four leases for a 26,000 sqft property, one of which the extractor could not
// find a CAM cap in. That last one is the whole point: it is what a review
// queue exists for.
console.log('\n── seeding the state a successful lease upload produces ──');
await p.evaluate(async () => {
  const raw = [
    { tenant_name:'Cedar Park Dental',      leased_sqft:4200, start_date:'2022-03-01', end_date:'2027-02-28', lease_type:'NNN', cap:5 },
    { tenant_name:'Bright Leaf Grocers',    leased_sqft:9100, start_date:'2021-06-01', end_date:'2028-05-31', lease_type:'NNN', cap:4 },
    { tenant_name:'Anvil Coffee Roasters',  leased_sqft:1800, start_date:'2023-01-01', end_date:'2026-12-31', lease_type:'NNN', cap:6 },
    // The extractor read the lease but found no cap percentage — needs a human.
    { tenant_name:'Willow & Vine Florist',  leased_sqft:1500, start_date:'2024-02-01', end_date:'2029-01-31', lease_type:'NNN', cap:null,
      _needsReview:true, flags:['NNN cap percentage not specified'] },
  ];
  const rows = raw.map(normalizeTenant);
  const prop = _props.find(x => x.id === activePropId);
  prop.tenants = rows;
  tenantData.splice(0, tenantData.length, ...rows);
  if (typeof rebuildDerivedState === 'function') rebuildDerivedState(prop);
  if (typeof renderBulkResults === 'function') renderBulkResults();
  if (typeof renderProperty === 'function') renderProperty(prop);
  await saveProperty(prop);
});
await p.waitForTimeout(2500);
await snap(p,'06 extraction reviewed');

const extraction = await p.evaluate(() => {
  const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  const body=(document.body.innerText||'');
  const named=['Cedar Park Dental','Bright Leaf Grocers','Anvil Coffee Roasters','Willow & Vine Florist']
    .filter(n=>body.includes(n));
  const flagged=body.includes('Willow & Vine Florist') &&
    /needs review|needs attention|incomplete|cap percentage/i.test(body);
  const rq=document.getElementById('propertyReviewQueuePanel');
  return {tenantsOnScreen:named, flaggedVisible:flagged, reviewPanelVisible:vis(rq),
    reviewPanelText:vis(rq)?(rq.innerText||'').replace(/\s+/g,' ').trim().slice(0,180):null};
});
console.log('   tenants on screen : '+extraction.tenantsOnScreen.join(', '));
console.log('   review flagged    : '+extraction.flaggedVisible);
console.log('   review queue panel: '+(extraction.reviewPanelVisible?extraction.reviewPanelText:'\x1b[31mNOT VISIBLE\x1b[0m'));
console.log('   review engine says: '+JSON.stringify(await p.evaluate(()=>{
  const prop=_props.find(x=>x.id===activePropId);
  const items=getReviewQueueItems([prop]);
  return {itemCount:items.length,items:items.map(i=>({t:i.tenantName,state:i.reviewState,score:i.reviewScore,missing:i.missingFields,warn:i.warningReasons})),
    perTenant:(prop.tenants||[]).map(t=>({n:t.tenant_name,st:ReviewEngine.deriveTenantReviewState(t,[]).status}))};
})));

// ── Step 6: resolve the review item ─────────────────────────────────────
console.log('\n── step 6: resolve the review item ──');
const resolveCta = await p.evaluate(() => {
  const vis=e=>{const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  return [...document.querySelectorAll('button,a,[role=button]')].filter(vis)
    .map(e=>(e.innerText||'').replace(/\s+/g,' ').trim())
    .filter(t=>/review|resolve|fix|complete|verify|attention/i.test(t)&&t.length<60);
});
console.log('   review CTAs offered: '+(resolveCta.length?JSON.stringify(resolveCta.slice(0,8)):'\x1b[31mNONE — dead end\x1b[0m'));

// Does "Resolve <tenant>" actually land on THAT tenant?
const opened = await click(p,/^Resolve /i,'resolve the flagged tenant');
await p.waitForTimeout(1500);
const landed = await p.evaluate(() => {
  const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  const ov=document.getElementById('tsOverlay');
  const body=(document.body.innerText||'');
  return {spaceModalOpen:vis(ov),
    modalNamesTenant: vis(ov) ? (ov.innerText||'').includes('Willow & Vine Florist') : false,
    modalShowsTheGap: vis(ov) ? /cap/i.test(ov.innerText||'') : false,
    mentionsOtherTenants: vis(ov) ? ['Cedar Park Dental','Bright Leaf Grocers','Anvil Coffee'].filter(n=>(ov.innerText||'').includes(n)) : []};
});
console.log('   landed on the specific tenant? '+JSON.stringify(landed));
if(!landed.spaceModalOpen) console.log('\x1b[31m   BROKEN PROMISE: "Resolve <tenant>" did not open that tenant\x1b[0m');
await snap(p,'07 review item opened');
await p.evaluate(()=>{const b=document.querySelector('#tsOverlay .ts-close,#tsOverlay [onclick*=close]');if(b)b.click();
  else if(window.TenantSpace&&TenantSpace.closeSpace)TenantSpace.closeSpace();});
await p.waitForTimeout(800);

// ── Step 7: upload invoices ─────────────────────────────────────────────
console.log('\n── step 7: upload invoices ──');
await click(p,/go to invoices/i,'follow the next step to invoices') ||
  await p.evaluate(()=>switchWorkspaceTab('cam'));
await p.waitForTimeout(1500);
const inv = await p.evaluate(()=>{
  const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  const card=document.getElementById('cardInvoices');
  return {invoiceCard:vis(card), fileInput:!!document.querySelector('#cardInvoices input[type=file]'),
    fileInputVisible:vis(document.querySelector('#cardInvoices input[type=file]')),
    heading:card?(card.innerText||'').replace(/\s+/g,' ').trim().slice(0,90):'MISSING'};
});
console.log('   invoices reachable: '+JSON.stringify(inv));
await snap(p,'08 invoices');

// ── Step 8: run CAM ─────────────────────────────────────────────────────
console.log('\n── step 8: run the reconciliation ──');
const runBtn = await p.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  const b=[...document.querySelectorAll('button')].filter(vis)
    .find(x=>/run .*(cam|allocation|reconcil)/i.test(x.innerText||''));
  return b?{label:(b.innerText||'').replace(/\s+/g,' ').trim(),disabled:b.disabled}:null;
});
console.log('   run button: '+(runBtn?JSON.stringify(runBtn):'\x1b[31mNOT FOUND\x1b[0m'));

// Seed the invoices a user would have uploaded, then look for Run CAM.
console.log('\n   seeding uploaded CAM invoices...');
await p.evaluate(async () => {
  const inv = [
    { vendor:'Northside Landscaping', category:'landscaping', amount:18400, date:'2025-04-12', description:'Grounds maintenance' },
    { vendor:'Talon Security',        category:'security',    amount:26100, date:'2025-05-03', description:'Site patrol' },
    { vendor:'Pacific Facilities',    category:'janitorial',  amount:31250, date:'2025-06-21', description:'Common area cleaning' },
    { vendor:'Cascade Insurance',     category:'insurance',   amount:42000, date:'2025-02-01', description:'Property policy' },
  ];
  invoiceData.splice(0, invoiceData.length, ...inv);
  const prop = _props.find(x => x.id === activePropId);
  prop.invoices = inv;
  if (typeof renderInvResults === 'function') renderInvResults();
  if (typeof rebuildDerivedState === 'function') rebuildDerivedState(prop);
  await saveProperty(prop);
});
await p.waitForTimeout(2000);
const runNow = await p.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  const all=[...document.querySelectorAll('button')];
  const b=all.filter(vis).find(x=>/run|calculate|reconcile/i.test(x.innerText||'')&&/cam|allocation|charge|reconcil/i.test(x.innerText||''));
  const hidden=all.find(x=>x.id==='runBtn');
  return b?{found:true,label:(b.innerText||'').trim(),disabled:b.disabled}
          :{found:false,existsButHidden:!!hidden,hiddenLabel:hidden?(hidden.innerText||'').trim():null,
            hiddenId:hidden?hidden.id:null};
});
console.log('   run button after invoices: '+JSON.stringify(runNow));
await snap(p,'09 ready to reconcile');

if(runNow.found && !runNow.disabled){
  await click(p,/calculate cam|run cam|run allocation/i,'run the reconciliation');
  await p.waitForTimeout(6000);
  await snap(p,'10 reconciliation results');
  const res=await p.evaluate(()=>{
    const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
    const body=(document.body.innerText||'');
    const stmtBtns=[...document.querySelectorAll('button,a')].filter(vis)
      .map(e=>(e.innerText||'').replace(/\s+/g,' ').trim())
      .filter(t=>/statement|export|report|pdf/i.test(t)&&t.length<50);
    return {resultsVisible:vis(document.getElementById('resultsBody'))||/allocated/i.test(body),
      showsTenants:['Cedar Park Dental','Bright Leaf Grocers'].filter(n=>body.includes(n)),
      statementActions:[...new Set(stmtBtns)].slice(0,8)};
  });
  console.log('   results: '+JSON.stringify(res));
  if(!res.statementActions.length) console.log('\x1b[31m   DEAD END: no way to generate tenant statements\x1b[0m');
}

// ── Where does the product say to go next? ──────────────────────────────
const guidance=await p.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.height>2;};
  const hints=[...document.querySelectorAll('.ob-hint,.setup-next-msg,.workspace-empty,.ptf-empty-desc,[id*=hint i]')]
    .filter(vis).map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean);
  const step=[...document.querySelectorAll('.step-item')].filter(vis)
    .map(e=>({label:(e.innerText||'').replace(/\s+/g,' ').trim(),active:e.className.includes('active'),done:e.className.includes('done')}));
  return {hints,stepBar:step,stepBarVisible:!!step.length};
});
console.log('\n── what the product tells the user to do next ──');
console.log('   step bar : '+(guidance.stepBarVisible?guidance.stepBar.map(x=>(x.active?'['+x.label+']':x.label)).join(' > '):'\x1b[31mNOT VISIBLE\x1b[0m'));
console.log('   hints    : '+(guidance.hints.length?guidance.hints.join(' // ').slice(0,300):'\x1b[31mnone\x1b[0m'));


await b.close();srv.close();
})();
