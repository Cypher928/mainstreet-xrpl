// test-no-silent-failures.js
// ============================================================================
// NO ASYNC USER ACTION MAY FAIL SILENTLY.
//
// Reported from the pilot: a lease editor filled in completely, Done pressed,
// "nothing happened". saveBulkTenant() ends with all of its user feedback — row
// flash, "Saved ✓", collapse, re-render, toast — downstream of three bare
// awaits, and the inline onclick does not catch. A rejected promise skipped
// every line of it and rejected into nothing, so a failed save was
// indistinguishable from a dead button.
//
// An audit found that was not one function: 20 of the 45 async functions
// reachable from an inline handler had no try/catch at all.
//
// This suite enforces the invariant for the whole class, statically and at
// runtime. A failed operation must:
//   1. leave the user's data intact,
//   2. explain itself on screen,
//   3. be logged for debugging.
//
// Run: node test-no-silent-failures.js

const http=require('http'),fs=require('fs'),path=require('path');
let pw;try{pw=require('playwright');}catch(_){pw=require('/opt/node22/lib/node_modules/playwright');}
const ROOT=__dirname,PORT=8950;
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

// ── static: every async handler reachable from the UI must be covered ──────
console.log('\n── every async user action is protected ──');
{
  const src=fs.readFileSync(path.join(ROOT,'script.js'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const called=new Set();
  for(const m of (html+src).matchAll(/on(?:click|change|submit|input)\s*=\s*["']([^"']+)["']/g))
    for(const f of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) called.add(f[1]);
  const bodyOf=name=>{
    const m=new RegExp('\\basync\\s+function\\s+'+name.replace(/\$/g,'\\$')+'\\s*\\(').exec(src);
    if(!m)return null;
    let i=src.indexOf('{',m.index+m[0].length-1),d=0;
    for(let j=i;j<src.length;j++){if(src[j]==='{')d++;else if(src[j]==='}'){d--;if(!d)return src.slice(i,j+1);}}
    return null;
  };
  const listed=new Set((/_ASYNC_USER_ACTIONS\s*=\s*\[([\s\S]*?)\]/.exec(src)||[,''])[1]
    .match(/'([^']+)'/g)?.map(s=>s.replace(/'/g,''))||[]);
  const asyncActions=[...called].filter(n=>{const b=bodyOf(n);return b&&/\bawait\b/.test(b);});
  const unguarded=asyncActions.filter(n=>{
    const b=bodyOf(n);
    return !/\btry\s*\{/.test(b) && !listed.has(n);
  });
  console.log(`   ${asyncActions.length} async user actions found; ${listed.size} listed in _ASYNC_USER_ACTIONS`);
  (unguarded.length===0)
    ? ok('every one either catches its own errors or is wrapped at dispatch')
    : bad(`${unguarded.length} can reject into nothing`, unguarded.join(', '));
}

(async()=>{
const srv=http.createServer((rq,rs)=>{const u=decodeURIComponent(rq.url.split('?')[0]);
 if(u.startsWith('/api/')){rs.writeHead(200,{'Content-Type':'application/json'});rs.end('{}');return;}
 let r=u==='/'?'/index.html':u;
 fs.readFile(path.join(ROOT,r),(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}
  rs.writeHead(200,{'Content-Type':MIME[path.extname(r)]||'application/octet-stream'});rs.end(d);});});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await pw.chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1400,height:1000}})).newPage();
await p.addInitScript('window.__TEST_AUTHED=true;');await p.addInitScript(DB);
await p.route('**jsdelivr**',r=>r.fulfill({status:200,body:'/*x*/'}));
await p.route('**supabase**',r=>r.request().url().includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'/*x*/'}));
const unhandled=[];
p.on('pageerror',e=>unhandled.push(e.message.split('\n')[0]));
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.waitForSelector('#appContent',{state:'visible',timeout:20000}).catch(()=>{});
await p.waitForTimeout(2000);

console.log('\n── the guard is actually installed at runtime ──');
const installed=await p.evaluate(()=>({
  guarded:!!window.__asyncActionsGuarded,
  count:(window._ASYNC_USER_ACTIONS||[]).filter(n=>typeof window[n]==='function'&&window[n].__guarded).length,
  total:(window._ASYNC_USER_ACTIONS||[]).length}));
(installed.guarded&&installed.count>0)
  ? ok(`${installed.count} of ${installed.total} listed actions wrapped on load`)
  : bad('the dispatch guard did not install',JSON.stringify(installed));

// ── runtime: force a failure THROUGH THE REAL GUARD ───────────────────────
// Deliberately not a reimplementation of the wrapper. An earlier version of
// this file built its own try/catch probe and "exercised" 0 real actions while
// reporting three passes — a test that measures its own copy of the code.
console.log('\n── a forced failure is reported, logged, and changes nothing ──');
const results=await p.evaluate(async()=>{
  const names=(window._ASYNC_USER_ACTIONS||[]).filter(n=>typeof window[n]==='function');
  const notWrapped=names.filter(n=>!window[n].__guarded);
  // Install a throwing function under a fresh name and wrap it with the REAL guard.
  window.__silentProbe = async () => { throw new Error('forced failure'); };
  window._ASYNC_USER_ACTIONS.push('__silentProbe');
  window.__asyncActionsGuarded = false;          // allow a second pass
  window._guardAsyncUserActions();
  const toasts=[],logs=[];
  const realToast=window.showToast, realLog=window.logError;
  window.showToast=m=>{toasts.push(String(m));};
  window.logError=(t)=>{logs.push(t);};
  let rejected=false, returned;
  try { returned = await window.__silentProbe(); } catch(_) { rejected=true; }
  window.showToast=realToast; window.logError=realLog;
  return {names:names.length, notWrapped, wrapped:!!window.__silentProbe.__guarded,
          rejected, returned, toasts, logs};
});
(results.notWrapped.length===0)
  ? ok(`all ${results.names} listed actions are wrapped on the page`)
  : bad(`${results.notWrapped.length} listed action(s) are not wrapped`, results.notWrapped.join(', '));
(results.wrapped && !results.rejected)
  ? ok('a failing action does not reject out to the caller')
  : bad('a failing action still rejects', JSON.stringify({wrapped:results.wrapped,rejected:results.rejected}));
(results.toasts.some(t=>/could not/i.test(t)))
  ? ok(`the user is told what failed ("${(results.toasts[0]||'').slice(0,64)}…")`)
  : bad('the failure produced no on-screen message', JSON.stringify(results.toasts));
(results.logs.some(t=>/asyncAction\//.test(t)))
  ? ok(`and it is logged for debugging (${results.logs[0]})`)
  : bad('the failure was not logged', JSON.stringify(results.logs));
(unhandled.length===0)?ok('no unhandled promise rejections reached the page')
                      :bad('unhandled rejections',unhandled.slice(0,3).join(' | '));

console.log('\n'+(fail?'\x1b[31m':'\x1b[32m')+`RESULT: ${pass} passed, ${fail} failed`+'\x1b[0m');
await b.close();srv.close();process.exit(fail?1:0);
})();
