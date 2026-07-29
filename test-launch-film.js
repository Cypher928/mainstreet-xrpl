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
  // Wait for the FILM, not the landing overlay — ?demo=1 no longer renders the
  // hero at all, so waiting on #msLanding burned a 12s timeout while the film
  // auto-advanced, and the walk below started two beats in.
  await p.waitForSelector('#pfFilm.msl-on',{timeout:12000}).catch(()=>{});
  await p.waitForTimeout(700);
  clearInterval(sampler);

  console.log('\n── The film opens and tells the new story ──');
  const hero=await p.evaluate(()=>({
    h1:(document.querySelector('.msl-h1')||{}).innerText||'',
    eyebrow:(document.querySelector('.msl-eyebrow')||{}).innerText||'',
    filmOn:!!document.querySelector('#pfFilm.msl-on'),
  }));
  (!hero.h1)?ok('?demo=1 never renders the landing hero — the film is the destination')
            :bad('landing hero rendered on ?demo=1',JSON.stringify(hero.h1));
  hero.filmOn?ok('?demo=1 starts the film'):bad('film did not start');

  // Walk the scenes with ArrowRight, recording each caption.
  const caps=[];
  for(let i=0;i<10;i++){
    await p.waitForTimeout(450);
    caps.push(await p.evaluate(()=>(document.getElementById('pfCap')||{}).innerText||''));
    await p.keyboard.press('ArrowRight');
  }
  console.log('   scenes: '+caps.map(c=>c.split(' — ')[0]).join(' | '));
  const want=[/starts reading/i,/reads every clause/i,/checked against/i,/entitled to recover/i,/open a space/i,/ask anything/i,/living memory/i,/settled in rlusd/i,/verified on-chain/i,/^$/];
  const misses=want.filter((re,i)=>!re.test(caps[i]||''));
  misses.length===0?ok('all 10 beats play in story order, closing on the brand rather than the ledger screen')
                   :bad(misses.length+' scene caption(s) off',JSON.stringify(caps));
  const grounded=await p.evaluate(()=>/\$34,650|\$6,051/.test((document.querySelector('.msl-cine')||{}).innerText||''));

  console.log('\n── No login screen ever paints ──');
  console.log('   loginVisible samples: '+JSON.stringify(loginSamples));
  loginSamples.every(v=>v===false)?ok('#loginScreen never became visible across '+loginSamples.length+' samples during boot')
                                  :bad('login screen flashed',JSON.stringify(loginSamples));

  console.log('\n── Pacing ──');
  const timing=await p.evaluate(()=>{const s=document.querySelector('script[src*="landing-experience"]');return null;});
  const durs=require('fs').readFileSync(require('path').join(__dirname,'product-film.js'),'utf8').match(/dur:\s*(\d+)/g).map(x=>+x.replace(/\D/g,''));
  const total=durs.reduce((a,b)=>a+b,0)/1000;
  (total<=45)?ok('film runs '+total.toFixed(1)+'s — under the 45s ceiling'):bad('film too long',total+'s');
  // Deliberate variation, not uniformity: the four hero beats breathe, the
  // connective beats move. A flat cadence is what made the earlier cut feel
  // like a slideshow.
  const IDS=['upload','extract','recon','recover','space','ask','timeline','settle','verify','brand'];
  const by=Object.fromEntries(IDS.map((id,i)=>[id,durs[i]]));
  const heroes=['extract','recover','ask'];
  heroes.every(h=>by[h]>=5000)?ok('hero beats breathe: '+heroes.map(h=>h+' '+by[h]/1000+'s').join(', '))
    :bad('a hero beat is too short',JSON.stringify(by));
  const connective=IDS.filter(id=>!heroes.includes(id)&&id!=='brand');
  connective.every(id=>by[id]>=3400&&by[id]<=4600)?ok('connective beats stay 3.4–4.6s — long enough to read, short enough to move')
    :bad('connective pacing off',JSON.stringify(by));
  (by.brand>=2600&&by.brand<=4000)?ok('brand close holds '+by.brand/1000+'s'):bad('brand close mistimed',String(by.brand));
  heroes.every(h=>connective.every(cid=>by[h]>by[cid]))?ok('every hero beat is longer than every connective beat')
    :bad('hero beats do not stand out from connective ones',JSON.stringify(by));

  console.log('\n── Composition ──');
  const comp=require('fs').readFileSync(require('path').join(__dirname,'product-film.js'),'utf8');
  const fws=[...comp.matchAll(/\sfw:\s*(\d+)/g)].map(m=>+m[1]);
  (fws.length===10)?ok('every beat declares its own composition width: '+[...new Set(fws)].sort((a,b)=>a-b).join(' / ')+'px')
    :bad('scenes missing fw',String(fws.length));
  (new Set(fws).size>=4)?ok('widths vary per beat — framed individually, not to one global fill')
    :bad('composition widths too uniform',JSON.stringify(fws));
  /msl-bignum--center/.test(comp)?ok('revenue hero is centre-composed'):bad('revenue hero not centred');
  // The app is back as context on the revenue beat, but pushed deep (20%
  // opacity, blurred) so its own "$99,542" cannot compete with the hero number.
  /pf-shot--deep/.test(comp.slice(comp.indexOf("id: 'recover'"),comp.indexOf("id: 'space'")))
    ?ok('revenue beat shows the app as deep context, not a competing foreground')
    :bad('revenue beat lost its app context');
  // The reconciliation beat now uses the REAL allocation screenshot, whose
  // header reads "CAP ADJ" because that is what the product renders. The
  // plain-language framing comes from an animated callout over it instead of
  // from re-typing the column, which would no longer be the real UI.
  /Prevented by lease caps/.test(comp)?ok('a callout labels the savings column in plain language over the real table'):bad('no savings callout');
  /didn’t allow|didn.t allow/.test(comp)?ok('reconciliation lands a plain-language summary'):bad('no summary line');
  /msl-close-mark/.test(comp)?ok('film closes on the MainStreet brand'):bad('no brand close');
  // The regression this guards: beats composed as minimal cards on black read as
  // title slides. The product itself has to be the base layer.
  const shots=(comp.match(/class="pf-shot/g)||[]).length;
  (shots>=7)?ok(shots+' beats are built on a real product screenshot — the app is the star')
    :bad('too few beats show the product',shots+' of 10');
  const realAssets=['ui-upload','beat1-cap-catch','ui-command-center','ui-space-modal','ui-workspace','ui-settlement']
    .filter(a=>comp.includes(a));
  (realAssets.length>=6)?ok('drawn from real captures: '+realAssets.join(', '))
    :bad('missing real captures',JSON.stringify(realAssets));

  console.log('\n── Narration scaffold (no synthetic voice) ──');
  const cues=await p.evaluate(()=>window.ProductFilm&&window.ProductFilm.narrationCues?window.ProductFilm.narrationCues():null);
  (cues&&cues.length===10)?ok('narration cues exposed for all 10 beats'):bad('narration cues missing',JSON.stringify(cues&&cues.length));
  (cues&&cues.every(c=>c.line&&c.line.length>10))?ok('every beat has a written narration line'):bad('a beat has no narration line');
  (cues&&cues[0].atMs===0&&cues[9].atMs===durs.slice(0,9).reduce((a,b)=>a+b,0))
    ?ok('cue times derive from scene durations — a recorded read stays in sync')
    :bad('cue times do not track durations',JSON.stringify(cues&&cues.map(c=>c.atMs)));
  const hasAudio=/new Audio|speechSynthesis|<audio/.test(comp);
  !hasAudio?ok('no synthetic narration is played — scaffold only'):bad('synthetic audio present');

  console.log('\n── Exit paths ──');
  // The end card is up now; its own control is the intended way out from here.
  await p.waitForSelector('#pfEndBack',{timeout:8000}).catch(()=>{});
  const endBack=await p.$('#pfEndBack');
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
  await p3.waitForSelector('#pfClose',{timeout:12000}).catch(()=>{});
  await p3.waitForTimeout(900);
  await p3.click('#pfClose');
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
  await p2.click('#pfClose');
  await p2.waitForTimeout(600);
  const st=await p2.evaluate(()=>({url:location.pathname,heroVisible:!!document.querySelector('.msl-h1'),cineOn:!!document.querySelector('#pfFilm.msl-on')}));
  (st.url.includes('index')&&st.heroVisible&&!st.cineOn)
    ?ok('direct visitor closing the film stays on the overlay hero — behaviour unchanged')
    :bad('direct-visit close changed',JSON.stringify(st));

  console.log('\n'+(fail===0?'\x1b[32m':'\x1b[31m')+'RESULT: '+pass+' passed, '+fail+' failed\x1b[0m');
  await b.close();srv.close();process.exit(fail?1:0);
});
