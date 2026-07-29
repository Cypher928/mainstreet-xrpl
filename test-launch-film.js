'use strict';
/**
 * Launch film contract.
 *
 * The film is a product launch asset, not a screen recording. These checks pin
 * the things that make it one: no auth UI ever paints, the nine beats play in
 * story order, pacing stays tight, and closing it returns the viewer to the
 * page they came from.
 *
 * The login-flash check tests OPACITY as well as display/visibility. That
 * distinction is the whole fix: hiding #loginScreen with display:none also
 * hides it from the overlay's own shown() predicate, which is what the film
 * waits on — so the flash and the film disappear together. Zero opacity paints
 * nothing while leaving the predicate true.
 */
let pw;try{pw=require('playwright');}catch(_){pw=require('/opt/node22/lib/node_modules/playwright');}
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=__dirname,PORT=8851;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const MOCK=`(function(){function P(v){return Promise.resolve(v);}
function q(){var o={select:function(){return o;},insert:function(r){return P({data:r,error:null});},upsert:function(r){return P({data:[r],error:null});},
eq:function(){return o;},neq:function(){return o;},in:function(){return P({data:[],error:null});},order:function(){return o;},limit:function(){return o;},
single:function(){return P({data:null,error:null});},then:function(f){return P({data:[],error:null}).then(f);}};return o;}
window.supabase={createClient:function(){return {auth:{getUser:function(){return P({data:{user:null},error:null});},
getSession:function(){return P({data:{session:null},error:null});},
onAuthStateChange:function(cb){setTimeout(function(){cb('INITIAL_SESSION',null);},30);return {data:{subscription:{unsubscribe:function(){}}}};},
signOut:function(){return P({error:null});}},from:function(){return q();},
storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};})();`;
let pass=0,fail=0;const ok=m=>{console.log('  \x1b[32m✓\x1b[0m '+m);pass++;};const bad=(m,d)=>{console.log('  \x1b[31m✗\x1b[0m '+m+(d?' — '+d:''));fail++;};
const srv=http.createServer((rq,rs)=>{let r=decodeURIComponent(rq.url.split('?')[0]);if(r==='/')r='/index.html';
 fs.readFile(path.join(ROOT,r),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(r)]||'application/octet-stream'});rs.end(d);});});
srv.listen(PORT,'127.0.0.1',async()=>{
  const b=await pw.chromium.launch({headless:true,args:['--no-sandbox']});
  const p=await (await b.newContext({viewport:{width:1280,height:900}})).newPage();
  await p.addInitScript(MOCK);
  await p.route('**jsdelivr**',r=>r.fulfill({status:200,body:'/*x*/'}));
  await p.route('**supabase**',r=>{const u=r.request().url();return u.includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'/*x*/'});});
  await p.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  const loginSamples=[];
  const sampler=setInterval(async()=>{try{loginSamples.push(await p.evaluate(()=>{const l=document.getElementById('loginScreen');
    if(!l)return false;const cs=getComputedStyle(l);const r=l.getBoundingClientRect();
    return cs.display!=='none'&&cs.visibility!=='hidden'&&parseFloat(cs.opacity||'1')>0.01&&r.width>0&&r.height>0;}));}catch(_){}} ,60);
  await p.goto('http://127.0.0.1:'+PORT+'/index.html?demo=1');
  await p.waitForSelector('#msLanding',{timeout:12000}).catch(()=>{});
  await p.waitForTimeout(1400);
  clearInterval(sampler);

  console.log('\n── The film opens and tells the new story ──');
  const hero=await p.evaluate(()=>({
    h1:(document.querySelector('.msl-h1')||{}).innerText||'',
    eyebrow:(document.querySelector('.msl-eyebrow')||{}).innerText||'',
    filmOn:!!document.querySelector('.msl-cine.msl-on'),
  }));
  /verified memory/i.test(hero.h1)?ok('overlay hero carries the new message'):bad('hero',JSON.stringify(hero.h1));
  /AI Operating System/i.test(hero.eyebrow)?ok('overlay eyebrow states the category'):bad('eyebrow',hero.eyebrow);
  hero.filmOn?ok('?demo=1 starts the film'):bad('film did not start');

  // Walk the scenes with ArrowRight, recording each caption.
  const caps=[];
  for(let i=0;i<9;i++){
    await p.waitForTimeout(450);
    caps.push(await p.evaluate(()=>(document.getElementById('mslCap')||{}).innerText||''));
    await p.keyboard.press('ArrowRight');
  }
  console.log('   scenes: '+caps.map(c=>c.split(' — ')[0]).join(' | '));
  const want=[/in one place/i,/reads every clause/i,/checked against/i,/entitled to recover/i,/open a space/i,/ask anything/i,/living memory/i,/settled in rlusd/i,/verified on-chain/i];
  const misses=want.filter((re,i)=>!re.test(caps[i]||''));
  misses.length===0?ok('all 9 scenes play in story order: upload → extract → reconcile → recover → space → ask AI → timeline → settle → verify')
                   :bad(misses.length+' scene caption(s) off',JSON.stringify(caps));
  const grounded=await p.evaluate(()=>/\$34,650|\$6,051/.test((document.querySelector('.msl-cine')||{}).innerText||''));

  console.log('\n── No login screen ever paints ──');
  console.log('   loginVisible samples: '+JSON.stringify(loginSamples));
  loginSamples.every(v=>v===false)?ok('#loginScreen never became visible across '+loginSamples.length+' samples during boot')
                                  :bad('login screen flashed',JSON.stringify(loginSamples));

  console.log('\n── Pacing ──');
  const timing=await p.evaluate(()=>{const s=document.querySelector('script[src*="landing-experience"]');return null;});
  const durs=require('fs').readFileSync(require('path').join(__dirname,'landing-experience.js'),'utf8').match(/dur:\s*(\d+)/g).map(x=>+x.replace(/\D/g,''));
  const total=durs.reduce((a,b)=>a+b,0)/1000;
  (total<=45)?ok('film runs '+total.toFixed(1)+'s — under the 45s ceiling'):bad('film too long',total+'s');
  (Math.max(...durs)<=4200&&Math.min(...durs)>=3000)?ok('every scene is 3.0–4.2s — no scene lingers or flashes')
    :bad('pacing uneven',JSON.stringify(durs.map(d=>d/1000)));

  console.log('\n── Exit paths ──');
  // The end card is up now; its own control is the intended way out from here.
  await p.waitForSelector('#mslEndBack',{timeout:8000}).catch(()=>{});
  const endBack=await p.$('#mslEndBack');
  if(!endBack){bad('end card has no way back to the site');}
  else{ await endBack.click(); await p.waitForTimeout(900);
        /\/home$/.test(p.url())?ok('end card "Back to site" → /home'):bad('end card back went to',p.url()); }

  // And the X, mid-film, before the end card covers it.
  const p3=await (await b.newContext({viewport:{width:1280,height:900}})).newPage();
  await p3.addInitScript(MOCK);
  await p3.route('**jsdelivr**',r=>r.fulfill({status:200,body:'/*x*/'}));
  await p3.route('**supabase**',r=>{const u=r.request().url();return u.includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'/*x*/'});});
  await p3.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await p3.goto('http://127.0.0.1:'+PORT+'/index.html?demo=1');
  await p3.waitForSelector('#mslCineClose',{timeout:12000}).catch(()=>{});
  await p3.waitForTimeout(900);
  await p3.click('#mslCineClose');
  await p3.waitForTimeout(900);
  /\/home$/.test(p3.url())?ok('close (X) mid-film → /home'):bad('X went to',p3.url());

  // Signed-out visitor WITHOUT ?demo=1: close must NOT navigate away.
  const p2=await (await b.newContext({viewport:{width:1280,height:900}})).newPage();
  await p2.addInitScript(MOCK);
  await p2.route('**jsdelivr**',r=>r.fulfill({status:200,body:'/*x*/'}));
  await p2.route('**supabase**',r=>{const u=r.request().url();return u.includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'/*x*/'});});
  await p2.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await p2.goto('http://127.0.0.1:'+PORT+'/index.html');
  await p2.waitForSelector('#msLanding',{timeout:12000}).catch(()=>{});
  await p2.waitForTimeout(800);
  await p2.evaluate(()=>{if(window.MainStreetLanding)MainStreetLanding.playDemo();});
  await p2.waitForTimeout(600);
  await p2.click('#mslCineClose');
  await p2.waitForTimeout(600);
  const st=await p2.evaluate(()=>({url:location.pathname,heroVisible:!!document.querySelector('.msl-h1'),cineOn:!!document.querySelector('.msl-cine.msl-on')}));
  (st.url.includes('index')&&st.heroVisible&&!st.cineOn)
    ?ok('direct visitor closing the film stays on the overlay hero — behaviour unchanged')
    :bad('direct-visit close changed',JSON.stringify(st));

  console.log('\n'+(fail===0?'\x1b[32m':'\x1b[31m')+'RESULT: '+pass+' passed, '+fail+' failed\x1b[0m');
  await b.close();srv.close();process.exit(fail?1:0);
});
