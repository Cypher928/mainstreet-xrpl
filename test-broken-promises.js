// test-broken-promises.js
// ============================================================================
// BROKEN PROMISE REGRESSION SUITE
//
// A button must go where its label says. Not to the right page — to the right
// OBJECT. These all shipped, and all of them "worked" by any component test:
//
//   "Jump to Tenant"   -> selectProperty(propertyId)   // opened the property
//   "Review Lease"     -> selectProperty(propertyId)   // opened the property
//
// The rule this suite enforces, from the sprint brief: every dashboard card,
// CTA, AI recommendation and action button must either take the user directly
// to the specific object requiring attention, or clearly explain why it cannot.
// Generic navigation where a contextual action is promised is a bug.
//
// HOW IT DECIDES
// A control is SPECIFIC if its handler carries an identifying argument — an id,
// a tenant name, an index — that names the thing in its label. A control is
// GENERIC if its handler takes no argument, or only a container's id (a
// property, a tab, a section), while its label promises a particular object.
// Labels that promise nothing in particular ("Portfolio", "Sign out") are
// exempt: they are honest signposts, not false specifics.
//
// A control is also allowed to be generic if it VISIBLY explains why — the
// escape hatch the brief allows. That is why openReviewItem() says "No lease
// document is attached to X" instead of quietly opening something adjacent.
//
// Run: node test-broken-promises.js

const http=require('http'),fs=require('fs'),path=require('path');
let pw;try{pw=require('playwright');}catch(_){pw=require('/opt/node22/lib/node_modules/playwright');}
const ROOT=__dirname,PORT=8925;
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
  },from:function(n){return q(n);},storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;

// A label promises a SPECIFIC object when it names one, or points at one with a
// demonstrative. "Open Dispute", "Review Lease", "Jump to Tenant", "Complete
// Review", "Explain This", "Lease expiring" all promise a particular thing.
const PROMISES_SPECIFIC = [
  /\b(this|that)\b/i,
  /^(open|view|review|resolve|fix|jump to|go to|complete|explain|show)\b.*\b(lease|tenant|dispute|allocation|invoice|space|review|statement|packet|item|charge)\b/i,
  /\b(expiring|expires|needs? (attention|review)|unresolved|flagged|overdue)\b/i,
];
// Signposts. These promise a place, not an object, and are honest about it.
// Sort and filter chips reorder a list in place; they navigate nowhere and
// promise nothing. "Needs Review" as a portfolio SORT is not a broken promise.
const SORT_OR_FILTER = /_portfolioSort\s*=|_reviewQueueFilter\s*=|setReviewQueueFilter\(|filterTenants\(|_portfolioQuery/;
// Handlers that derive their own subject from the current screen. "Explain This"
// is honest: explainCurrentScreen() reads the active context. Asserted for real
// below rather than trusted, because a label with "This" in it is exactly the
// kind of promise that rots quietly.
const SELF_CONTEXTUAL = /^(explainCurrentScreen|explainThis)\(/;
const SIGNPOST = /^(portfolio|sign out|back to portfolio|command center|overview|property|spaces|cam|reserves|reports|documents|cancel|close|done|save|print|export summary|add property|create property|upload files|import from yardi|clear all|take the .*tour|start tour|go to portfolio|ask ai|data health|highest risk|most recent|all|ready|needs attention|failed|processing)\b/i;

// An argument that identifies a THING rather than a container.
function handlerIsSpecific(onclick, label) {
  if (!onclick) return null;                       // not an inline handler
  const args = [...onclick.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim()).filter(Boolean);
  if (!args.length) return false;                  // foo() — no object at all
  const joined = args.join(',');
  // A bare property id where the label promises a tenant/lease/dispute is the
  // exact failure mode this suite exists for.
  if (/^selectProperty\(/.test(onclick) && /\b(tenant|lease|dispute|allocation|review)\b/i.test(label)) return false;
  if (/^switchWorkspaceTab\(/.test(onclick)) return false;
  return /['"][^'"]+['"]|\d/.test(joined);
}

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
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.waitForSelector('#appContent',{state:'visible',timeout:20000}).catch(()=>{});
await p.waitForTimeout(2000);

// A property with real work in it, so cards and CTAs have objects to point at.
await p.evaluate(()=>{const x=[...document.querySelectorAll('button')].find(e=>/go to portfolio/i.test(e.innerText));if(x)x.click();});
await p.waitForTimeout(1200);
await p.evaluate(()=>addNewProperty());
await p.waitForTimeout(2500);
await p.evaluate(async()=>{
  document.getElementById('propertyName').value='Cedar Park Commons';
  document.getElementById('totalSqft').value='26000';
  const raw=[
    {tenant_name:'Cedar Park Dental',leased_sqft:4200,start_date:'2022-03-01',end_date:'2027-02-28',lease_type:'NNN',cap:5},
    {tenant_name:'Bright Leaf Grocers',leased_sqft:9100,start_date:'2021-06-01',end_date:'2028-05-31',lease_type:'NNN',cap:4},
    {tenant_name:'Willow & Vine Florist',leased_sqft:1500,start_date:'2024-02-01',end_date:'2029-01-31',lease_type:'NNN',cap:null,
     _needsReview:true,flags:['NNN cap percentage not specified']}];
  const rows=raw.map(normalizeTenant);
  const prop=_props.find(x=>x.id===activePropId);
  prop.tenants=rows; tenantData.splice(0,tenantData.length,...rows);
  const inv=[{vendorName:'Talon Security',category:'security',amount:26100,invoiceDate:'2025-05-03'},
             {vendorName:'Cascade Insurance',category:'insurance',amount:42000,invoiceDate:'2025-02-01'}];
  invoiceData.splice(0,invoiceData.length,...inv); prop.invoices=inv;
  if(typeof rebuildDerivedState==='function')rebuildDerivedState(prop);
  if(typeof renderBulkResults==='function')renderBulkResults();
  if(typeof renderProperty==='function')renderProperty(prop);
  await saveProperty(prop);
});
await p.waitForTimeout(2500);

// Sweep every screen a pilot user passes through.
const SCREENS=[
  ['property workspace — Overview', async()=>{switchWorkspaceTab('overview');}],
  ['property workspace — Spaces',   async()=>{switchWorkspaceTab('spaces');}],
  ['property workspace — CAM',      async()=>{switchWorkspaceTab('cam');}],
  ['property workspace — Reports',  async()=>{switchWorkspaceTab('reports');}],
  ['portfolio dashboard',           async()=>{renderPortfolio();}],
];
const violations=[];const selfContextual=[];
let scanned=0;
for(const [name,go] of SCREENS){
  await p.evaluate(go);
  await p.waitForTimeout(1200);
  const controls=await p.evaluate(()=>{
    const vis=e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);
      return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>2&&r.height>2;};
    return [...document.querySelectorAll('button,a[onclick],[role=button]')].filter(vis).map(e=>({
      label:(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim(),
      onclick:(e.getAttribute('onclick')||'').trim(),
      href:e.getAttribute('href')||''}));
  });
  for(const c of controls){
    if(!c.label||c.label.length>70) continue;
    if(SIGNPOST.test(c.label)) continue;
    if(!PROMISES_SPECIFIC.some(rx=>rx.test(c.label))) continue;
    scanned++;
    if(SORT_OR_FILTER.test(c.onclick)) continue;
    if(SELF_CONTEXTUAL.test(c.onclick)) { selfContextual.push({screen:name,label:c.label}); continue; }
    const specific=handlerIsSpecific(c.onclick,c.label);
    if(specific===false) violations.push({screen:name,label:c.label,onclick:c.onclick.slice(0,80)});
  }
}
console.log(`\n── every control that promises a specific object ──`);
console.log(`   scanned ${scanned} object-promising control(s) across ${SCREENS.length} screens`);
(violations.length===0)
  ? ok('every one carries an identifier for the thing it names')
  : bad(`${violations.length} control(s) promise an object and navigate generically`,
        violations.map(v=>`${v.screen}: "${v.label}"  ->  ${v.onclick}`).join('\n      '));

// "Explain This" derives its own subject. Prove it actually names what it is
// explaining, instead of taking the label on trust.
console.log('\n── controls that derive their own subject ──');
if(selfContextual.length){
  // Re-enter the property first. The sweep above ends on the portfolio, and
  // switchWorkspaceTab() only toggles panes — it does not re-show #mainWorkflow,
  // so asking from there correctly falls back to portfolio scope and looks like
  // a bug in explainCurrentScreen() when it is a bug in the test.
  await p.evaluate(async()=>{await selectProperty(activePropId);switchWorkspaceTab('cam');});
  await p.waitForTimeout(1500);
  const said=await p.evaluate(async()=>{
    // It opens the AI Workspace and asks a question derived from the active
    // tab — NOT #explainPanel, which is a different surface. Checking the wrong
    // element reported this as doing nothing at all.
    let asked=null;
    const realAsk=window.aiwAsk;
    window.aiwAsk=function(q){asked=q;return realAsk&&realAsk.apply(this,arguments);};
    try{ explainCurrentScreen(); }catch(e){ window.aiwAsk=realAsk; return {error:e.message}; }
    await new Promise(r=>setTimeout(r,1200));
    window.aiwAsk=realAsk;
    const w=document.getElementById('aiWorkspace')||document.getElementById('aiwPanel');
    const vis=w&&getComputedStyle(w).display!=='none'&&w.getBoundingClientRect().height>2;
    return {opened:!!vis,asked};
  });
  (said.asked && /reconciliation/i.test(said.asked))
    ? ok(`"Explain This" on the CAM tab asks about THIS reconciliation ("${said.asked}"), not the portfolio`)
    : bad('"Explain This" does not derive its subject from the current screen',JSON.stringify(said));
} else ok('no self-contextual controls on these screens');

// The two the sprint called out by name, asserted directly so they can never
// silently regress to selectProperty(propertyId).
console.log('\n── the review queue actions land on the tenant, not the property ──');
const rq=await p.evaluate(()=>{
  const prop=_props.find(x=>x.id===activePropId);
  const items=getReviewQueueItems([prop]).filter(i=>!i.reviewerConfirmed);
  if(!items.length)return null;
  renderPropertyReviewQueue(prop);
  const panel=document.getElementById('propertyReviewQueuePanel');
  return {tenantId:items[0].tenantId,tenantName:items[0].tenantName,
    html:[...panel.querySelectorAll('button')].map(b=>({l:(b.innerText||'').trim(),o:b.getAttribute('onclick')||''}))};
});
if(!rq) bad('no review item to check — the fixture stopped producing one');
else {
  const carries=rq.html.filter(x=>x.o.includes(rq.tenantId));
  (carries.length>=2)
    ? ok(`review actions carry the tenant id (${rq.html.filter(x=>/openReviewItem/.test(x.o)).length} via openReviewItem)`)
    : bad('review actions do not carry the tenant id',
          rq.html.map(x=>`"${x.l}" -> ${x.o.slice(0,70)}`).join('\n      '));
  const named=rq.html.some(x=>x.l.includes(rq.tenantName));
  named ? ok(`one action names the tenant outright ("Open ${rq.tenantName}")`)
        : bad('no action names the tenant it opens');
}

// ── Property Workspace ─────────────────────────────────────────────────────
// Two new classes of control, both of which promise a specific object:
//
//   "on: Roof replaced — full tear-off"   must open THAT record
//   a Building System cell                must show THAT system's history
//
// A document chip that opens the section you were already looking at is the
// same broken promise as "Jump to Tenant" opening the property — it just looks
// more innocent, because a file name feels like a label rather than a claim.
console.log('\n── Property Workspace: documents and systems ──');
{
  const pw2 = await p.evaluate(() => {
    if (!window.PropertyOS || !window.currentProperty) return { missing: true };
    const prop = window.currentProperty();
    if (!prop) return { missing: true };
    prop.timeline = prop.timeline || [];
    const job = appendPropertyTimelineEvent(prop, {
      manual: true, type: 'manual_capital_improvement', category: 'capital_improvement',
      title: 'Roof replaced — full tear-off', timestamp: new Date().toISOString(),
      subject: { type: 'system', id: 'roof', label: 'Roof' },
      attachments: [{ name: 'roof-warranty.pdf', url: 'https://x/roof-warranty.pdf', kind: 'document' }],
      actor: 'qa@example.com', metadata: { recordedBy: 'qa@example.com' },
    });
    const pane = document.getElementById('wsPane-property');
    if (pane) pane.style.display = 'block';
    PropertyOS.init();
    PropertyOS.renderPropertyPage(prop);
    const body = document.getElementById('propertyOsBody');
    const docBtn = body.querySelector('.pos-doc-on');
    const sysCell = [].slice.call(body.querySelectorAll('.pos-sys-cell'))
      .find(c => /Roof/.test(c.textContent));
    return {
      jobId: job.id,
      docLabel: docBtn ? docBtn.textContent.trim() : null,
      docCarries: docBtn ? docBtn.dataset.rec : null,
      docHandler: docBtn ? typeof docBtn.onclick === 'function' : false,
      sysCarries: sysCell ? sysCell.dataset.sys : null,
      sysHandler: sysCell ? typeof sysCell.onclick === 'function' : false,
    };
  });

  if (pw2.missing) {
    bad('Property Workspace not reachable — fixture produced no property');
  } else {
    (pw2.docLabel && /Roof replaced/.test(pw2.docLabel))
      ? ok(`a document row names the record it is filed on ("${pw2.docLabel}")`)
      : bad('a document row does not name its record', String(pw2.docLabel));
    (pw2.docCarries === pw2.jobId)
      ? ok('and carries that record\'s id, not a generic jump')
      : bad('document control does not carry a record id', `${pw2.docCarries} vs ${pw2.jobId}`);
    pw2.docHandler ? ok('its handler compiles') : bad('document control has a null onclick');
    (pw2.sysCarries === 'roof')
      ? ok('a Building System cell carries the system it names')
      : bad('Building System cell does not carry its key', String(pw2.sysCarries));
    pw2.sysHandler ? ok('and its handler compiles') : bad('Building System cell has a null onclick');

    // The promise kept: clicking actually lands on that object.
    const landed = await p.evaluate((jobId) => {
      const body = document.getElementById('propertyOsBody');
      body.querySelector('.pos-doc-on').click();
      const f = body.querySelector('.pos-rec--focus');
      const okFocus = !!f && f.dataset.recId === jobId;
      PropertyOS.setRecordFilter('all', 'roof');
      const note = (document.querySelector('#propertyOsBody .pos-filter-note') || {}).textContent || '';
      PropertyOS.setRecordFilter('all', null);
      return { okFocus, note: note.replace(/\s+/g, ' ').trim() };
    }, pw2.jobId);
    landed.okFocus ? ok('clicking the document opens THAT record, not the section')
                   : bad('clicking a document did not open its record');
    /Roof/.test(landed.note) ? ok(`clicking a system shows that system ("${landed.note.slice(0, 46)}")`)
                             : bad('clicking a system did not scope the view', landed.note);
  }
}

console.log('\n'+(fail?'\x1b[31m':'\x1b[32m')+`RESULT: ${pass} passed, ${fail} failed`+'\x1b[0m');
await b.close();srv.close();process.exit(fail?1:0);
})();
