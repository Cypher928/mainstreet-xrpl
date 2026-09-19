// test-live-extraction-walk.js
// ============================================================================
// The first-run workflow driven by a REAL lease PDF through the REAL client
// pipeline and the REAL api/claude.js handler.
//
//   ANTHROPIC_API_KEY=sk-... node test-live-extraction-walk.js
//       Genuine end to end. api/claude.js runs as it does in production and
//       calls Anthropic. THIS is the run that closes the last gap in the Pilot
//       Readiness Sprint; nothing else proves the extraction actually works.
//
//   node test-live-extraction-walk.js
//       No key present. Everything up to the API boundary still runs for real —
//       the PDF is read, uploaded, attached as a document block and posted with
//       the extraction prompt — and the response is then supplied locally so the
//       client parser still executes. The mode is printed; do not read a pass
//       here as a live pass.
//
// WHAT THE KEYLESS RUN HAS ALREADY PROVEN (recorded so it is not re-litigated):
//   1. /api/upload      receives the real 57KB PDF
//   2. /api/explain     model claude-sonnet-4-6, content ["document","text"]
//   3. /api/claude      64KB request, content ["document","text"] — the actual
//                       lease document plus the extraction prompt
//   4. /api/lease-documents  persists the attachment
// The client half of extraction is real and correctly formed. What is NOT
// proven without a key is that Claude's reply parses into tenant fields and
// flows on into review, CAM and statements.
//
// A NOTE ON THE MOCK: it must generate row ids on insert. The capture-tool mock
// does not, so saveProperty() gets no id back and addNewProperty() correctly
// refuses to create the property — which looks like a broken Create button and
// is actually the id-leak guard doing its job.
const http=require('http'),fs=require('fs'),path=require('path');
let pw;try{pw=require('playwright');}catch(_){pw=require('/opt/node22/lib/node_modules/playwright');}
const ROOT='/home/user/mainstreet-xrpl',PORT=8920;
const LEASE=path.join(ROOT,'assets','demo','lease-whole-health-market.pdf');
const LIVE=!!process.env.ANTHROPIC_API_KEY;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.pdf':'application/pdf','.svg':'image/svg+xml'};
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

// What the extractor is asked to return, in the API's real response shape.
function stubAnthropic(bodyText){
  const fields={tenant_name:'Whole Health Market',leased_sqft:9200,start_date:'2021-01-01',
    end_date:'2028-12-31',lease_type:'NNN',cap:5,excluded_categories:'capital improvements'};
  return {id:'msg_stub',type:'message',role:'assistant',model:'stub',
    content:[{type:'text',text:JSON.stringify(fields)}],
    stop_reason:'end_turn',usage:{input_tokens:0,output_tokens:0}};
}

let apiCalls=[];
(async()=>{
if(!fs.existsSync(LEASE)){console.log('no lease pdf at '+LEASE);process.exit(1);}
console.log(`\n── mode: ${LIVE?'\x1b[32mLIVE — real Anthropic API\x1b[0m':'\x1b[33mHANDLER-REAL, API STUBBED (no ANTHROPIC_API_KEY)\x1b[0m'}`);
console.log(`   lease: ${path.relative(ROOT,LEASE)} (${(fs.statSync(LEASE).size/1024).toFixed(0)} KB, text-layer PDF)`);

const srv=http.createServer(async (rq,rs)=>{
  const u=decodeURIComponent(rq.url.split('?')[0]);
  if(u.startsWith('/api/')){
    let raw='';for await(const c of rq) raw+=c;
    let body=null; try{body=JSON.parse(raw||'{}');}catch(_){body={};}
    apiCalls.push({path:u,model:body.model,msgCount:(body.messages||[]).length,
      bytes:raw.length,
      contentKinds:[...new Set(((body.messages||[])[0]?.content||[]).map(c=>c.type||typeof c))]});
    const res={code:200,hdrs:{},status(c){this.code=c;return this;},
      setHeader(k,v){this.hdrs[k]=v;},
      json(o){rs.writeHead(this.code,{'Content-Type':'application/json'});rs.end(JSON.stringify(o));},
      end(){rs.writeHead(this.code);rs.end();}};
    if(u==='/api/claude'){
      if(LIVE){
        // Run the real handler against the real API.
        const h=require(path.join(ROOT,'api','claude.js'));
        await h({method:rq.method,headers:rq.headers,body},res).catch(e=>{
          rs.writeHead(500);rs.end(JSON.stringify({error:e.message}));});
      } else {
        rs.writeHead(200,{'Content-Type':'application/json'});
        rs.end(JSON.stringify(stubAnthropic(raw)));
      }
      return;
    }
    rs.writeHead(200,{'Content-Type':'application/json'});rs.end('{}');return;
  }
  let r=u==='/'?'/index.html':u;
  fs.readFile(path.join(ROOT,r),(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}
    rs.writeHead(200,{'Content-Type':MIME[path.extname(r)]||'application/octet-stream'});rs.end(d);});
});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await pw.chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.addInitScript('window.__TEST_AUTHED=true;');
await p.addInitScript(DB);
await p.route('**jsdelivr**',r=>r.fulfill({status:200,body:'/*x*/'}));
await p.route('**supabase**',r=>r.request().url().includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'/*x*/'}));
p.on('pageerror',e=>console.log('  !! '+e.message.split('\n')[0]));
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.waitForSelector('#appContent',{state:'visible',timeout:20000}).catch(()=>{});
await p.waitForTimeout(2500);

// create + describe + save, as a user
const click=async(re,what)=>{
  const hit=await p.evaluate(pattern=>{
    const rx=new RegExp(pattern,'i');
    const c=[...document.querySelectorAll('button,a,[role=button]')].filter(e=>{
      const r=e.getBoundingClientRect();const cs=getComputedStyle(e);
      return cs.display!=='none'&&r.width>2&&r.height>2&&rx.test((e.innerText||'').trim());});
    if(!c.length)return null;const t=(c[0].innerText||'').replace(/\s+/g,' ').trim();c[0].click();return t;
  },re);
  console.log(`   click ${what}: ${hit?JSON.stringify(hit):'\x1b[31mNOT FOUND\x1b[0m'}`);
  await p.waitForTimeout(2500); return hit;
};
console.log('\n── steps 1-3: create, describe, save ──');
await click('go to portfolio|get started|skip','dismiss welcome');
await click('add your first propert|create first propert|create propert|add propert','create property');
const ready=await p.evaluate(()=>{const e=document.getElementById('propertyName');
  return !!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>2;});
if(!ready){
  console.log('   \x1b[31mproperty setup fields never appeared\x1b[0m');
  console.log('   visible buttons: '+JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('button')]
    .filter(e=>e.getBoundingClientRect().height>2).map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()).slice(0,14))));
  await b.close();srv.close();process.exit(1);
}
await p.fill('#propertyName','Cedar Park Commons');await p.waitForTimeout(200);
await p.fill('#totalSqft','26000');await p.waitForTimeout(500);
await p.evaluate(()=>savePropertyAndContinue());
await p.waitForTimeout(3000);
console.log('\n── step 4: upload a REAL lease PDF through the real file input ──');
await p.setInputFiles('#bulkLeaseInput',LEASE);
console.log('   uploaded; waiting for the extraction pipeline...');
await p.waitForTimeout(30000);

console.log('\n── what the client actually sent to /api/claude ──');
apiCalls.forEach((c,i)=>console.log(`   ${i+1}. ${c.path}  bytes=${c.bytes}  model=${c.model||'-'}  msgs=${c.msgCount}  content=${JSON.stringify(c.contentKinds)}`));
console.log('   total API calls: '+apiCalls.length);

const after=await p.evaluate(()=>({
  tenants:tenantData.filter(Boolean).map(t=>({name:t.tenant_name,sqft:t.leased_sqft,type:t.lease_type,cap:t.cap,
    needsReview:t._needsReview,failed:t.extractionFailed,status:t.status})),
  bodyMentions:['Whole Health Market'].filter(n=>(document.body.innerText||'').includes(n)),
}));
console.log('\n── step 5: what the product extracted ──');
console.log('   '+JSON.stringify(after,null,1));
await p.screenshot({path:path.join('/tmp/claude-0/-home-user-mainstreet-xrpl/1fbf60da-4d0d-55d1-a66a-ea7fc9ee7968/scratchpad','live-extract.png')});
await b.close();srv.close();
})();
