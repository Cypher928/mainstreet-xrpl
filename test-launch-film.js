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
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg'};
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

  // Rewind to beat 0 before walking. waitForSelector + a 700ms settle used to
  // leave the film wherever it had drifted to, and with a 1.5s opening beat that
  // was already past `story` — so the walk sampled 13 captions starting from the
  // second beat and reported the whole sequence off by one.
  // Poll the film's own beat id and record every transition. This replaces an
  // arrow-key walk that was measuring the wrong thing: scrubbing is a separate
  // feature, and the walk's cadence raced the beat durations — a 1.5s beat was
  // skipped between two samples and the suite reported the whole sequence wrong.
  // Polling asks only "which beats does playback pass through, in what order".
  await p.evaluate(()=>{ window.__seq=[]; window.ProductFilm.play();
    window.__poll=setInterval(()=>{
      const b=window.ProductFilm.beatId();
      const el=document.getElementById('pfCap');
      // What the viewer can actually READ. renderScene zeroes the caption's
      // opacity immediately and only swaps its text 260ms later, so innerText
      // alone reports the previous beat's line across every transition — which
      // is why this check first came back off by one.
      const vis=el&&parseFloat(getComputedStyle(el).opacity||'0')>0.01;
      const cap=vis?(el.innerText||''):'';
      const last=window.__seq[window.__seq.length-1];
      if(!last||last.id!==b) window.__seq.push({id:b,cap:cap});
      else last.cap=cap;                          // settle on the visible text
    },90); });
  const runMs=await p.evaluate(()=>window.ProductFilm.scenes().reduce((a,s)=>a+s.dur,0));
  await p.waitForTimeout(runMs+900);
  await p.evaluate(()=>clearInterval(window.__poll));
  const seq=await p.evaluate(()=>window.__seq);
  const ids=seq.map(x=>x.id), caps=seq.map(x=>x.cap);
  console.log('   beats:  '+ids.join(' -> '));
  const WANT=['story','logo','promise','upload','extract','recon','recover','space','ask','timeline','settle','verify','brand'];
  JSON.stringify(ids)===JSON.stringify(WANT)
    ?ok('all 13 beats play once, in story order, closing on the brand rather than the ledger screen')
    :bad('beat order wrong',JSON.stringify(ids));
  // The three opening beats carry no caption on purpose: they are the film's
  // establishing sequence, and captions over them would make them title cards.
  const wantCap=[/^$/,/^$/,/^$/,/starts reading/i,/reads every clause/i,/checked against/i,
                 /entitled to recover/i,/open a space/i,/ask anything/i,/living memory/i,
                 /settled in rlusd/i,/verified on/i,/^$/];
  const misses=wantCap.filter((re,i)=>!re.test(caps[i]||''));
  misses.length===0?ok('every caption matches its beat, and the opening three carry none')
                   :bad(misses.length+' scene caption(s) off',JSON.stringify(caps));
  const grounded=await p.evaluate(()=>/\$34,650|\$6,051/.test((document.querySelector('.msl-cine')||{}).innerText||''));

  console.log('\n── No login screen ever paints ──');
  console.log('   loginVisible samples: '+JSON.stringify(loginSamples));
  loginSamples.every(v=>v===false)?ok('#loginScreen never became visible across '+loginSamples.length+' samples during boot')
                                  :bad('login screen flashed',JSON.stringify(loginSamples));

  console.log('\n── Pacing ──');
  // Ask the module for its own scenes. This used to regex `dur:` out of the
  // source and zip the results against a hardcoded id list, so adding a beat
  // silently shifted every duration onto the wrong name — it reported `upload`
  // at 1800ms when 1800ms was the new establishing shot.
  const SC=await p.evaluate(()=>window.ProductFilm.scenes());
  const by=Object.fromEntries(SC.map(s=>[s.id,s.dur]));
  const durs=SC.map(s=>s.dur);
  const total=durs.reduce((a,b)=>a+b,0)/1000;
  // Ceiling raised from 45s when the recorded narration landed: a narrated cut
  // needs the two lines the muted cut did without, plus an establishing shot to
  // open on. 48s is the new bound.
  // Raised again for the directed opening sequence: three beats of anticipation
  // before the first feature, which the 48s bound predated.
  (total<=51)?ok('film runs '+total.toFixed(1)+'s — under the 51s ceiling'):bad('film too long',total+'s');
  // Deliberate variation, not uniformity: the hero beats breathe, the
  // connective beats move. A flat cadence is what made the earlier cut feel
  // like a slideshow.
  const heroes=['extract','recover','ask'];
  heroes.every(h=>by[h]>=4800)?ok('hero beats breathe: '+heroes.map(h=>h+' '+by[h]/1000+'s').join(', '))
    :bad('a hero beat is too short',JSON.stringify(by));
  const connective=SC.map(s=>s.id).filter(id=>!heroes.includes(id)&&id!=='brand'&&!['story','logo','promise'].includes(id));
  connective.every(id=>by[id]>=3400&&by[id]<=4600)?ok('connective beats stay 3.4–4.6s — long enough to read, short enough to move')
    :bad('connective pacing off',JSON.stringify(by));
  (by.brand>=3600&&by.brand<=4800)?ok('brand close holds '+by.brand/1000+'s'):bad('brand close mistimed',String(by.brand));
  heroes.every(h=>connective.every(cid=>by[h]>=by[cid]))?ok('every hero beat is at least as long as every connective beat')
    :bad('hero beats do not stand out from connective ones',JSON.stringify(by));
  // The opening sequence: emotion, then the name, then the promise. Order and
  // lengths come straight from the storyboard.
  const openSeq=SC.slice(0,3).map(x=>x.id).join(',');
  const openMs=SC.slice(0,3).reduce((a,x)=>a+x.dur,0);
  (openSeq==='story,logo,promise'&&by.story===1500&&by.logo===1500&&by.promise===2500)
    ?ok(`opening sequence runs story 1.5s -> logo 1.5s -> promise 2.5s, cutting to the workflow at ${openMs}ms`)
    :bad('opening sequence wrong',openSeq+' '+JSON.stringify({s:by.story,l:by.logo,p:by.promise}));

  console.log('\n── Composition ──');
  const comp=require('fs').readFileSync(require('path').join(__dirname,'product-film.js'),'utf8');
  const fws=[...comp.matchAll(/\sfw:\s*(\d+)/g)].map(m=>+m[1]);
  (fws.length===13)?ok('every beat declares its own composition width: '+[...new Set(fws)].sort((a,b)=>a-b).join(' / ')+'px')
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
  // The opening frame is the supplied key art, not a UI screenshot dropped on
  // black, and the lockup over it is live text plus the extracted monogram —
  // no invented office, no re-typeset wordmark baked into a raster.
  /keyart-scene\.jpg/.test(comp)?ok('the open uses the real key-art photography'):bad('open lost its plate');
  /pf-story/.test(comp)&&/has <em>a story/.test(comp)
    ?ok('opens on emotion, not software — a type card with no product in frame')
    :bad('the story card is missing');
  // Was /pf-arrive/, which by this point matched only the comment recording that
  // pf-arrive had been REMOVED — a false pass on prose. The motion itself is
  // measured in test-film-motion.js; what belongs here is the declaration.
  /\{ id: 'upload',[^}]*chain: true/.test(comp)
    ?ok('the workflow continues the camera into itself rather than starting a new move')
    :bad('upload does not chain from the beat before it');
  /pf-open-mark/.test(comp)&&/MAINSTREET/.test(comp)
    ?ok('the lockup animates: extracted monogram plus live wordmark and tagline')
    :bad('opening lockup missing');
  /pfFromBlack/.test(comp)&&/@keyframes pfGlide/.test(comp)
    ?ok('fades up from black over the continuous glide — the cut lands mid-move')
    :bad('opening has no fade-from-black or camera glide');
  /msl-close-mark/.test(comp)?ok('film closes on the MainStreet brand'):bad('no brand close');
  // The brand card is the last thing anyone sees. It used to carry an XRPL
  // proof line as well, which split the frame between the name and the ledger.
  !/msl-close-proof/.test(comp)?ok('the closing card is the mark and tagline alone — the ledger proof stays on the beat before it')
    :bad('the brand card still shares the frame with the ledger proof');
  // The regression this guards: beats composed as minimal cards on black read as
  // title slides. The product itself has to be the base layer.
  const shots=(comp.match(/class="pf-shot/g)||[]).length;
  (shots>=7)?ok(shots+' beats are built on a real product screenshot — the app is the star')
    :bad('too few beats show the product',shots+' of '+SC.length);
  const realAssets=['ui-upload','beat1-cap-catch','ui-command-center','ui-space-modal','ui-workspace','ui-settlement']
    .filter(a=>comp.includes(a));
  (realAssets.length>=6)?ok('drawn from real captures: '+realAssets.join(', '))
    :bad('missing real captures',JSON.stringify(realAssets));

  console.log('\n── Narration (recorded clips, never synthesised) ──');
  const cues=await p.evaluate(()=>window.ProductFilm&&window.ProductFilm.narrationCues?window.ProductFilm.narrationCues():null);
  (cues&&cues.length===13)?ok('narration cues exposed for all 13 beats'):bad('narration cues missing',JSON.stringify(cues&&cues.length));
  (cues&&cues.filter(c=>c.line&&c.line.length>10).length===10)?ok('every beat outside the opening sequence has a written narration line'):bad('a beat has no narration line');
  (cues&&cues[0].atMs===0&&cues[12].atMs===durs.slice(0,12).reduce((a,b)=>a+b,0))
    ?ok('cue times derive from scene durations — a recorded read stays in sync')
    :bad('cue times do not track durations',JSON.stringify(cues&&cues.map(c=>c.atMs)));
  // This used to ban `new Audio` outright, from when the film was a scaffold
  // with no voice. The film now plays a recorded read, so the guarantee narrows
  // to the one that still matters: nothing is generated in the browser. A
  // speech-synthesis fallback would put a robot voice on the launch film the
  // first time a clip failed to load, which is worse than silence.
  const synth=/speechSynthesis|SpeechSynthesisUtterance/.test(comp);
  !synth?ok('no speech synthesis — the voice is a recorded track, not generated at runtime')
    :bad('the browser is synthesising speech');
  const srcs=(cues||[]).filter(c=>c.audio).map(c=>c.audio);
  (srcs.length>0&&srcs.every(s=>/^assets\/vo\/vo-[a-z]+\.mp3$/.test(s)))
    ?ok(srcs.length+' lines play from assets/vo/ — every source is a file in the repo')
    :bad('a narration clip has an unexpected source',JSON.stringify(srcs));

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
