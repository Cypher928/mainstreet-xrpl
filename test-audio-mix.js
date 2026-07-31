'use strict';
/**
 * Audio mix contract: the voice is always the primary focus.
 *
 * The first bed level was set from an RMS ratio — music 20dB under the
 * narration's speech-only mean — and it still competed with the voice. An
 * overall RMS ratio does not predict intelligibility, because masking is
 * frequency-specific: music energy between 1kHz and 4kHz covers consonants at
 * levels where the broadband number looks perfectly safe.
 *
 * So this measures the thing that actually matters. It renders the real signal
 * chain offline —
 *
 *     bed -> presence dip (peaking ~2.4kHz) -> base gain -> sidechain duck
 *
 * — with the duck automated by the same envelope follower the live loop runs,
 * at the same 60Hz, reading the same constants out of product-film.js. Then it
 * band-limits both the voice and the music to 1-4kHz and compares them inside
 * every spoken window.
 *
 * Broadcast practice puts speech at least 10dB above the bed in that band. The
 * upper bound matters too: past about 32dB the music has stopped contributing
 * anything and the brief asked for a mix you notice emotionally.
 */
let pw;try{pw=require('playwright');}catch(_){pw=require('/opt/node22/lib/node_modules/playwright');}
const http=require('http'),fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=__dirname,PORT=8858;
const MIME={'.mp3':'audio/mpeg','.webm':'audio/webm'};
const srv=http.createServer((rq,rs)=>{const u=decodeURIComponent(rq.url.split('?')[0]);
  if(u==='/'){rs.writeHead(200,{'Content-Type':'text/html'});rs.end('<!doctype html><title>x</title>');return;}
  fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){rs.writeHead(404);rs.end();return;}
    rs.writeHead(200,{'Content-Type':MIME[path.extname(u)]||'application/octet-stream'});rs.end(d);});});

// The cue schedule and the mix constants come from the module itself.
const sb={window:{},Audio:function(){},document:{createElement:()=>({canPlayType:()=>''})},
  setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame:()=>0,
  cancelAnimationFrame:()=>{},Float32Array,Math,Date,console};
vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(ROOT,'product-film.js'),'utf8'),sb);
const CUES=sb.window.ProductFilm.narrationCues().filter(c=>c.audio);
const SRC=fs.readFileSync(path.join(ROOT,'product-film.js'),'utf8');
// EQ_Q shares a `var` statement with EQ_HZ, so anchoring on `var NAME` missed
// it. Match the binding wherever it is declared.
const K=n=>{const m=new RegExp('\\b'+n+'\\s*=\\s*(-?[\\d.]+)').exec(SRC);
  if(!m) throw new Error('constant not found in product-film.js: '+n);
  return parseFloat(m[1]);};
const CFG={base:K('BED_BASE_DB'),duck:K('BED_DUCK_DB'),brand:K('BED_BRAND_DB'),
  eqHz:K('EQ_HZ'),eqQ:K('EQ_Q'),eqIdle:K('EQ_IDLE_DB'),eqDuck:K('EQ_DUCK_DB'),
  atk:K('FOLLOW_ATTACK'),rel:K('FOLLOW_RELEASE'),floor:K('VOICE_FLOOR'),full:K('VOICE_FULL')};
console.log('  constants read from product-film.js:', JSON.stringify(CFG));

(async()=>{
  await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
  const b=await pw.chromium.launch({headless:true,args:['--no-sandbox']});
  const p=await(await b.newContext()).newPage();
  await p.goto(`http://127.0.0.1:${PORT}/`);
  const out=await p.evaluate(async ({cues,cfg})=>{
    const SR=44100, DUR=51;
    const load=async u=>{const buf=await(await fetch(u)).arrayBuffer();
      return new OfflineAudioContext(1,SR,SR).decodeAudioData(buf);};
    const bed=await load('/assets/audio/bed.mp3');
    const vo={}; for(const c of cues) vo[c.id]=await load(c.audio);

    const mono=(ab)=>{ if(ab.numberOfChannels===1) return ab.getChannelData(0);
      const a=ab.getChannelData(0),b=ab.getChannelData(1),o=new Float32Array(a.length);
      for(let i=0;i<a.length;i++)o[i]=(a[i]+b[i])/2; return o; };

    // ── pass A: the voice bus alone ──────────────────────────────────────────
    const ctxA=new OfflineAudioContext(1,SR*DUR,SR);
    for(const c of cues){ const s=ctxA.createBufferSource(); s.buffer=vo[c.id];
      s.connect(ctxA.destination); s.start(c.startMs/1000); }
    const voiceBuf=await ctxA.startRendering();
    const voice=mono(voiceBuf);

    // ── the follower, computed exactly as the live loop does, at 60Hz ────────
    const HOP=Math.round(SR/60), env=[];
    let follow=0;
    for(let i=0;i+HOP<=voice.length;i+=HOP){
      let s=0; for(let k=i;k<i+HOP;k++) s+=voice[k]*voice[k];
      const rms=Math.sqrt(s/HOP);
      let want=(rms-cfg.floor)/(cfg.full-cfg.floor); want=want<0?0:(want>1?1:want);
      const k2=want>follow ? 1-Math.exp(-1/(60*cfg.atk)) : 1-Math.exp(-1/(60*cfg.rel));
      follow+=(want-follow)*k2;
      env.push({t:i/SR, f:follow});
    }

    // ── pass B: the bed through the real chain, automated by that envelope ───
    const ctxB=new OfflineAudioContext(1,SR*DUR,SR);
    const src=ctxB.createBufferSource(); src.buffer=bed;
    const eq=ctxB.createBiquadFilter(); eq.type='peaking';
    eq.frequency.value=cfg.eqHz; eq.Q.value=cfg.eqQ; eq.gain.value=cfg.eqIdle;
    const base=ctxB.createGain(); base.gain.value=Math.pow(10,cfg.base/20);
    const duck=ctxB.createGain(); duck.gain.value=1;
    src.connect(eq); eq.connect(base); base.connect(duck); duck.connect(ctxB.destination);
    const brandFrom=cues[cues.length-1].startMs/1000;
    for(const e of env){
      const depth = e.t>=brandFrom ? cfg.brand : cfg.duck;
      duck.gain.setValueAtTime(Math.pow(10,depth*e.f/20), e.t);
      eq.gain.setValueAtTime(cfg.eqIdle+(cfg.eqDuck-cfg.eqIdle)*e.f, e.t);
    }
    src.start(0);
    const music=mono(await ctxB.startRendering());

    // ── band-limit both to 1-4kHz and compare inside each spoken window ──────
    const band=async(sig,lo,hi)=>{
      lo=lo||1000; hi=hi||4000;
      const c=new OfflineAudioContext(1,sig.length,SR);
      const b2=c.createBuffer(1,sig.length,SR); b2.copyToChannel(sig,0);
      const s2=c.createBufferSource(); s2.buffer=b2;
      const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=lo; hp.Q.value=0.7;
      const lp=c.createBiquadFilter(); lp.type='lowpass';  lp.frequency.value=hi; lp.Q.value=0.7;
      s2.connect(hp); hp.connect(lp); lp.connect(c.destination); s2.start(0);
      return mono(await c.startRendering());
    };
    const vB=await band(voice), mB=await band(music);
    // A low band as well, so the presence dip can be measured as a CHANGE IN
    // BALANCE rather than in absolute level — turning everything down would
    // otherwise look identical to carving the voice's band out.
    const mLow=await band(music,100,800);
    const rms=(sig,a,z)=>{a=Math.round(a*SR);z=Math.round(z*SR);let s=0,n=0;
      for(let i=a;i<z&&i<sig.length;i++){s+=sig[i]*sig[i];n++;} return Math.sqrt(s/Math.max(1,n));};

    const rows=cues.map((c,i)=>{
      const a=c.startMs/1000, z=c.endMs/1000;
      // The gap right AFTER this line, so the duck is measured against the same
      // few seconds of music rather than against the track's own arrangement.
      const nx=cues[i+1] ? cues[i+1].startMs/1000 : 50.5;
      const g=(nx-z>0.8) ? {a:z+0.35, z:Math.min(nx-0.05, z+1.6)} : null;
      return {id:c.id, v:rms(vB,a,z), m:rms(mB,a,z),
              mid:rms(mB,a,z), low:rms(mLow,a,z),
              gapMid:g?rms(mB,g.a,g.z):null, gapLow:g?rms(mLow,g.a,g.z):null};
    });
    // Where there is no voice at all: the titles and the gaps.
    const quiet=[[0,cues[0].startMs/1000]];
    for(let i=1;i<cues.length;i++){
      const g0=cues[i-1].endMs/1000, g1=cues[i].startMs/1000;
      if(g1-g0>0.9) quiet.push([g0+0.25,g1-0.1]);
    }
    return {rows, quiet:quiet.map(([a,z])=>({a,z,m:rms(mB,a,z),mFull:rms(music,a,z)})),
            musicFullRms:rms(music,0,49.9), voiceFullRms:rms(voice,0,49.9)};
  },{cues:CUES,cfg:CFG});

  let pass=0,fail=0;
  const ok=m=>{console.log('  \x1b[32m✓\x1b[0m '+m);pass++;};
  const bad=(m,d)=>{console.log('  \x1b[31m✗\x1b[0m '+m+(d?' — '+d:''));fail++;};
  const dB=v=>20*Math.log10(Math.max(v,1e-9));

  console.log('\n── The voice is always above the music where it counts ──');
  console.log('   speech-to-music ratio inside 1-4kHz, per line\n');
  const FLOOR=10, CEIL=32;
  let worst=99, best=-99;
  for(const r of out.rows){
    const d=dB(r.v)-dB(r.m);
    if(d<worst)worst=d; if(d>best)best=d;
    console.log(`     ${r.id.padEnd(9)} voice ${dB(r.v).toFixed(1).padStart(6)}  music ${dB(r.m).toFixed(1).padStart(6)}  →  ${d.toFixed(1).padStart(5)}dB`);
  }
  console.log('');
  (worst>=FLOOR)
    ? ok(`every line clears the ${FLOOR}dB intelligibility floor — worst is ${worst.toFixed(1)}dB`)
    : bad('a line is masked by the music', `worst ${worst.toFixed(1)}dB, want >= ${FLOOR}dB`);
  (best<=CEIL)
    ? ok(`and none exceeds ${CEIL}dB — the bed is still present under the voice, not gone`)
    : bad('the music has vanished under the narration', `best ${best.toFixed(1)}dB, want <= ${CEIL}dB`);

  console.log('\n── The closing line is the one the music is allowed near ──');
  // The brand card is the payoff: the brief asked for the music to stay up
  // under the final logo, so this line should be the tightest ratio of the ten.
  const rows=out.rows.map(r=>({id:r.id,d:dB(r.v)-dB(r.m)}));
  const brand=rows[rows.length-1], others=rows.slice(0,-1);
  (brand.id==='brand' && brand.d===Math.min(...rows.map(r=>r.d)))
    ? ok(`the bed sits closest to the voice on the brand card (${brand.d.toFixed(1)}dB against ${Math.min(...others.map(r=>r.d)).toFixed(1)}dB elsewhere)`)
    : bad('the brand card is not the loudest point for the bed', JSON.stringify(rows));

  console.log('\n── The sidechain is doing the work, not the arrangement ──');
  // Each line is compared against the gap immediately after it. That isolates
  // the duck: an earlier version compared speech to the film's opening and
  // passed with the duck removed entirely, because the track's own intro is
  // quiet and that is what it was really measuring.
  const ducks=out.rows.filter(r=>r.gapMid!==null).map(r=>({id:r.id, d:dB(r.gapMid)-dB(r.mid)}));
  const meanDuck=ducks.reduce((a,x)=>a+x.d,0)/ducks.length;
  console.log('   music level, line vs the gap right after it (1-4kHz)\n');
  ducks.forEach(x=>console.log(`     ${x.id.padEnd(9)} ${x.d.toFixed(1).padStart(5)}dB`));
  console.log('');
  (meanDuck>=6)
    ? ok(`the bed drops ${meanDuck.toFixed(1)}dB on average when a line starts, and recovers after it`)
    : bad('the sidechain is not ducking', `mean ${meanDuck.toFixed(1)}dB against the adjacent gap, want >= 6dB`);

  console.log('\n── The mids are carved out, not just turned down ──');
  // Balance, not level: mid energy relative to low energy. Turning the whole
  // bed down cannot pass this, only moving the 1-4kHz band can. Removing the
  // presence dip used to leave every other assertion green.
  const spMid=out.rows.reduce((a,r)=>a+r.mid,0)/out.rows.length;
  const spLow=out.rows.reduce((a,r)=>a+r.low,0)/out.rows.length;
  const gpMid=ducks.length?out.rows.filter(r=>r.gapMid!==null).reduce((a,r)=>a+r.gapMid,0)/ducks.length:0;
  const gpLow=ducks.length?out.rows.filter(r=>r.gapLow!==null).reduce((a,r)=>a+r.gapLow,0)/ducks.length:0;
  const tilt=(dB(spMid)-dB(spLow))-(dB(gpMid)-dB(gpLow));
  (tilt<=-2.5)
    ? ok(`1-4kHz sits ${(-tilt).toFixed(1)}dB further below the low end while speaking — room carved for the voice`)
    : bad('the presence dip is not following the voice', `mid/low tilt ${tilt.toFixed(1)}dB, want <= -2.5dB`);

  console.log('\n── And the bed is audible where there is no narration ──');
  out.quiet.forEach(q=>console.log(`     ${q.a.toFixed(1).padStart(5)}-${q.z.toFixed(1).padStart(5)}s   ${dB(q.mFull).toFixed(1)}dBFS`));
  (Math.max(...out.quiet.map(q=>dB(q.mFull)))>=-36)
    ? ok('the title and the gaps carry the bed at an audible level')
    : bad('the bed is inaudible even with no voice over it');

  console.log('\n'+(fail?'\x1b[31m':'\x1b[32m')+`RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await b.close();srv.close();process.exit(fail?1:0);
})();
