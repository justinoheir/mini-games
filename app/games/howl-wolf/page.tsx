'use client';
/**
 * HOWL WOLF — Sustain mic volume in a narrow moving band. Wolf howls when you're on target.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic } from 'lucide-react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { spawnBurst, updateAndDrawParticles, Particle } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID   = 'howl-wolf';
const PB_KEY    = 'mg_pb_howl-wolf';
const ACCENT    = '#f59e0b';
const DURATION  = 45;
const GAME_EMOJI  = '🐺';
const GAME_TITLE  = 'Howl Wolf';
const GAME_TAGLINE = 'Hit the howl zone. Sustain. Call the pack.';

const BAND_WIDTH   = 0.18; // fraction of meter (±9%)
const BAND_CHANGE_MS = 7000; // zone moves every 7s
const PACK_SIZE    = 4; // wolves in the pack

interface Signals {
  score: number; howlTime: number; packCalled: number;
  avgVolume: number; peakVolume: number;
}
function getPersonality(s: Signals): string {
  if (s.packCalled >= 4) return 'Alpha Wolf 🐺';
  if (s.packCalled >= 2) return 'Pack Leader 🌕';
  if (s.howlTime > 8)    return 'Night Howler 🌙';
  return 'Lone Wolf 🏔️';
}

interface GS {
  running: boolean; timeLeft: number;
  smoothVol: number;
  bandCenter: number; // 0-1
  bandNextChangeTime: number;
  inZone: boolean; inZoneFrames: number;
  howlTime: number; // seconds in zone
  packCalled: number;
  particles: Particle[]; flashAlpha: number;
  volSum: number; volCount: number; peakVol: number;
  wolfScale: number; wolfMouthOpen: number;
  streakSecs: number; accentColor: string;
}
type Phase = 'start'|'permission'|'countdown'|'playing'|'done';

export default function HowlWolfGame() {
  const theme   = useBrandTheme();
  const accent  = theme.colors.accent ?? ACCENT;
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const audioCtxRef  = useRef<AudioContext|null>(null);
  const analyserRef  = useRef<AnalyserNode|null>(null);
  const micStreamRef = useRef<MediaStream|null>(null);
  const dataArrRef   = useRef<Uint8Array<ArrayBuffer>|null>(null);
  const resizeRef    = useRef<(()=>void)|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,smoothVol:0,
    bandCenter:0.5,bandNextChangeTime:0,inZone:false,inZoneFrames:0,
    howlTime:0,packCalled:0,particles:[],flashAlpha:0,
    volSum:0,volCount:0,peakVol:0,wolfScale:1,wolfMouthOpen:0,streakSecs:0,accentColor:ACCENT,
  });

  const [phase,      setPhase]      = useState<Phase>('start');
  const [timeLeft,   setTimeLeft]   = useState(DURATION);
  const [scoreDisp,  setScoreDisp]  = useState(0);
  const [packDisp,   setPackDisp]   = useState(0);
  const [finalSig,   setFinalSig]   = useState<Signals|null>(null);
  const [permError,  setPermError]  = useState('');
  const [isNewBest,  setIsNewBest]  = useState(false);
  const { pops, triggerPop } = useScorePop();
  const prevScore = useRef(0);

  useEffect(()=>{ stateRef.current.accentColor=accent; },[accent]);
  useEffect(()=>{
    if(scoreDisp>prevScore.current) triggerPop(`+${scoreDisp-prevScore.current}`,window.innerWidth/2,200);
    prevScore.current=scoreDisp;
  },[scoreDisp,triggerPop]);

  const getMicVol = useCallback(():number=>{
    const a=analyserRef.current,d=dataArrRef.current;
    if(!a||!d) return 0;
    a.getByteFrequencyData(d); let sum=0;
    for(let i=0;i<d.length;i++) sum+=d[i]*d[i];
    return Math.min(1,Math.sqrt(sum/d.length)/128);
  },[]);

  const endGame = useCallback(()=>{
    const s=stateRef.current;
    s.running=false; cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    const sig:Signals={
      score:Math.round(s.howlTime*10)+s.packCalled*50,
      howlTime:Math.round(s.howlTime), packCalled:s.packCalled,
      avgVolume:s.volCount>0?s.volSum/s.volCount:0, peakVolume:s.peakVol,
    };
    sfx.success(); hapticVictory(); playVictoryFanfare();
    try{ const p=parseInt(localStorage.getItem(PB_KEY)||'0',10); if(sig.score>p){localStorage.setItem(PB_KEY,String(sig.score));setIsNewBest(true);} }catch{/**/}
    setFinalSig(sig); setPhase('done');
  },[]);

  const startLoop = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    const resize=()=>{
      const dpr=window.devicePixelRatio||1,w=window.innerWidth,h=window.innerHeight;
      canvas.style.width=w+'px'; canvas.style.height=h+'px';
      canvas.width=w*dpr; canvas.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
    };
    resize(); window.addEventListener('resize',resize); resizeRef.current=()=>window.removeEventListener('resize',resize);

    s.running=true; s.timeLeft=DURATION; s.smoothVol=0;
    s.bandCenter=0.5; s.bandNextChangeTime=Date.now()+BAND_CHANGE_MS;
    s.inZone=false; s.inZoneFrames=0; s.howlTime=0; s.packCalled=0;
    s.particles=[]; s.flashAlpha=0; s.volSum=0; s.volCount=0; s.peakVol=0;
    s.wolfScale=1; s.wolfMouthOpen=0; s.streakSecs=0;
    setScoreDisp(0); setTimeLeft(DURATION); setPackDisp(0); setPhase('playing');
    stopMusicRef.current=startMusic('pulse');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft); sfx.tick();
      if(s.timeLeft===10) sfx.warning();
      if(s.timeLeft<=0) endGame();
    },1000);

    const loop=(ts:number)=>{
      if(!s.running) return;
      const W=window.innerWidth, H=window.innerHeight;
      const now=Date.now();
      const vol=getMicVol();
      s.smoothVol=s.smoothVol*0.82+vol*0.18;
      const sv=s.smoothVol;
      s.volSum+=sv; s.volCount++;
      if(sv>s.peakVol) s.peakVol=sv;

      // Move band
      if(now>=s.bandNextChangeTime){
        s.bandCenter=0.25+Math.random()*0.5;
        s.bandNextChangeTime=now+BAND_CHANGE_MS;
        sfx.tick();
      }

      const lo=Math.max(0,s.bandCenter-BAND_WIDTH/2);
      const hi=Math.min(1,s.bandCenter+BAND_WIDTH/2);
      s.inZone=sv>=lo&&sv<=hi;

      if(s.inZone){
        s.inZoneFrames++;
        s.howlTime+=1/60;
        s.wolfMouthOpen=Math.min(1,s.wolfMouthOpen+0.05);
        s.wolfScale=1+Math.sin(ts*0.008)*0.04+sv*0.15;
        const scoreSec=Math.floor(s.howlTime);
        if(scoreSec>0&&scoreSec!==Math.floor(s.howlTime-1/60)){
          hapticScore();
          const pack=Math.floor(s.howlTime/4);
          if(pack>s.packCalled){
            s.packCalled=pack;
            s.flashAlpha=0.7;
            spawnBurst(s.particles,W/2,H*0.3,accent,20,6);
            setPackDisp(s.packCalled); sfx.collect();
          }
          const score=Math.round(s.howlTime*10)+s.packCalled*50;
          setScoreDisp(score);
        }
      } else {
        s.inZoneFrames=0;
        s.wolfMouthOpen=Math.max(0,s.wolfMouthOpen-0.04);
        s.wolfScale=Math.max(1,s.wolfScale*0.97);
      }
      s.flashAlpha=Math.max(0,s.flashAlpha-0.025);

      // --- RENDER ---
      ctx.fillStyle='#040810'; ctx.fillRect(0,0,W,H);

      // Night sky gradient
      const sky=ctx.createLinearGradient(0,0,0,H*0.6);
      sky.addColorStop(0,'#0a0520'); sky.addColorStop(1,'transparent');
      ctx.fillStyle=sky; ctx.fillRect(0,0,W,H*0.6);

      // Moon
      ctx.save(); ctx.shadowBlur=30; ctx.shadowColor='rgba(245,158,11,0.5)';
      ctx.fillStyle='rgba(245,158,11,0.15)'; ctx.beginPath(); ctx.arc(W*0.75,H*0.15,35,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(245,215,100,0.6)'; ctx.beginPath(); ctx.arc(W*0.75,H*0.15,22,0,Math.PI*2); ctx.fill(); ctx.restore();

      // Stars
      ctx.fillStyle='rgba(255,255,255,0.5)';
      const starPositions=[[0.1,0.05],[0.2,0.08],[0.35,0.04],[0.5,0.09],[0.6,0.02],[0.4,0.12],[0.15,0.14],[0.85,0.07],[0.9,0.12]];
      for(const [sx,sy] of starPositions){ ctx.beginPath(); ctx.arc(W*sx,H*sy,1+Math.random()*0.5,0,Math.PI*2); ctx.fill(); }

      // Vertical meter (center-right)
      const mX=W-60, mW=32, mH=H*0.55, mY=(H-mH)/2;
      ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.roundRect(mX,mY,mW,mH,8); ctx.fill(); ctx.stroke();

      // Fill (volume indicator)
      const volFillH=mH*sv; const volFillY=mY+mH-volFillH;
      if(volFillH>2){
        const grd=ctx.createLinearGradient(0,volFillY,0,mY+mH);
        grd.addColorStop(0,sv>lo&&sv<hi?accent:'#6366f1'); grd.addColorStop(1,`${accent}44`);
        ctx.fillStyle=grd; ctx.shadowBlur=s.inZone?16:4; ctx.shadowColor=accent;
        ctx.beginPath(); ctx.roundRect(mX+3,volFillY,mW-6,volFillH,[0,0,6,6]); ctx.fill(); ctx.shadowBlur=0;
      }

      // Target band
      const bandTopY=mY+mH*(1-hi); const bandBotY=mY+mH*(1-lo);
      ctx.fillStyle=s.inZone?`rgba(245,158,11,0.25)`:`rgba(245,158,11,0.12)`;
      ctx.shadowBlur=s.inZone?12:0; ctx.shadowColor=accent;
      ctx.beginPath(); ctx.roundRect(mX-4,bandTopY,mW+8,bandBotY-bandTopY,4); ctx.fill(); ctx.shadowBlur=0;
      ctx.strokeStyle=s.inZone?accent:`rgba(245,158,11,0.45)`; ctx.lineWidth=s.inZone?2:1;
      ctx.beginPath(); ctx.roundRect(mX-4,bandTopY,mW+8,bandBotY-bandTopY,4); ctx.stroke();

      // HOW badge
      ctx.fillStyle=s.inZone?accent:'rgba(255,255,255,0.35)';
      ctx.font=`bold 10px "Space Grotesk",sans-serif`; ctx.textAlign='center';
      ctx.fillText('ZONE',mX+mW/2,mY-8); ctx.textAlign='left';

      // Wolf pack silhouettes
      for(let i=0;i<PACK_SIZE;i++){
        const wX=W*0.15+i*(W*0.18);
        const wY=H*0.72;
        const active=i<s.packCalled||( i===s.packCalled&&s.inZone );
        const ws=active?s.wolfScale:0.65;
        drawWolfSilhouette(ctx,wX,wY,ws,active?sv:0,s.wolfMouthOpen*(active?1:0),accent);
      }

      // In-zone glow
      if(s.inZone){ ctx.fillStyle=`rgba(245,158,11,${0.04+sv*0.05})`; ctx.fillRect(0,0,W,H); }

      // Flash
      if(s.flashAlpha>0){ ctx.fillStyle=`rgba(245,158,11,${s.flashAlpha*0.25})`; ctx.fillRect(0,0,W,H); }

      // Howl time
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='14px "Space Grotesk",sans-serif';
      ctx.textAlign='center'; ctx.fillText(`Howl: ${s.howlTime.toFixed(1)}s`,W/2,H*0.92); ctx.textAlign='left';

      updateAndDrawParticles(ctx,s.particles);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,getMicVol,accent,triggerPop]);

  function drawWolfSilhouette(ctx:CanvasRenderingContext2D,x:number,y:number,scale:number,vol:number,mouthOpen:number,col:string){
    ctx.save(); ctx.translate(x,y); ctx.scale(scale,scale);
    const alpha=0.3+vol*0.5+mouthOpen*0.2;
    ctx.fillStyle=`rgba(245,158,11,${alpha})`; ctx.strokeStyle=col; ctx.lineWidth=1;
    if(mouthOpen>0.3){ ctx.shadowBlur=10+mouthOpen*12; ctx.shadowColor=col; }
    // body
    ctx.beginPath(); ctx.ellipse(0,-5,16,10,-0.2,0,Math.PI*2); ctx.fill();
    // head
    ctx.beginPath(); ctx.ellipse(-18,-12,9,8,0.1,0,Math.PI*2); ctx.fill();
    // ears
    ctx.beginPath(); ctx.moveTo(-23,-18); ctx.lineTo(-20,-28); ctx.lineTo(-16,-18); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-16,-17); ctx.lineTo(-14,-25); ctx.lineTo(-10,-17); ctx.closePath(); ctx.fill();
    // howl mouth
    if(mouthOpen>0.1){
      const mY=-9-mouthOpen*4;
      ctx.beginPath(); ctx.arc(-24,mY,4+mouthOpen*2,Math.PI*0.1,Math.PI*0.9,false);
      ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.stroke();
    }
    // tail
    ctx.beginPath(); ctx.moveTo(14,0); ctx.quadraticCurveTo(22,-12+mouthOpen*8,16,-22+mouthOpen*10);
    ctx.strokeStyle=col; ctx.lineWidth=2.5; ctx.stroke();
    ctx.restore();
  }

  useEffect(()=>()=>{
    cancelAnimationFrame(animRef.current);
    if(timerRef.current) clearInterval(timerRef.current);
    if(stopMusicRef.current) stopMusicRef.current();
    if(resizeRef.current) resizeRef.current();
    if(audioCtxRef.current) audioCtxRef.current.close().catch(()=>{});
    if(micStreamRef.current) micStreamRef.current.getTracks().forEach(t=>t.stop());
  },[]);

  const handleStart=useCallback((name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);
    initAudio(); sfx.click(); setPhase('permission');
  },[]);

  const handlePermission=useCallback(async()=>{
    setPermError('');
    if((window as unknown as Record<string,unknown>).__DISABLE_AUDIO){setPhase('countdown');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      micStreamRef.current=stream;
      const actx=new AudioContext(); audioCtxRef.current=actx;
      const analyser=actx.createAnalyser(); analyser.fftSize=256; analyser.smoothingTimeConstant=0.3;
      analyserRef.current=analyser; dataArrRef.current=new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      actx.createMediaStreamSource(stream).connect(analyser);
      setPhase('countdown');
    }catch{ setPermError('Microphone access denied. Please allow mic access and try again.'); }
  },[]);

  const handlePlayAgain=useCallback(()=>{
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    analyserRef.current=null; dataArrRef.current=null;
    setPhase('start'); setScoreDisp(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setPackDisp(0); prevScore.current=0;
  },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 20%,rgba(245,158,11,0.1) 0%,transparent 55%),linear-gradient(180deg,#040810 0%,#06080f 100%)">

      {phase==='start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Mic & Howl →" accentColor={accent} onStart={handleStart} sensorNote="🎤 Microphone — howl into your phone" gradient="radial-gradient(ellipse 80% 70% at 50% 30%,#110808 0%,#08060e 55%,#040408 100%)" />}

      {phase==='permission' && (
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#040810',padding:'32px 24px',gap:24}}>
          <div style={{width:96,height:96,borderRadius:'50%',background:'rgba(245,158,11,0.1)',border:`2px solid ${accent}44`,display:'flex',alignItems:'center',justifyContent:'center'}}><Mic size={48} color={accent}/></div>
          <div style={{textAlign:'center',maxWidth:300}}>
            <div style={{fontSize:28,fontWeight:800,color:'#fff',marginBottom:12}}>Mic Access Needed</div>
            <div style={{fontSize:16,color:'rgba(255,255,255,0.6)',lineHeight:1.6}}>Howl Wolf measures your voice volume to find the zone. Your mic data stays on your device.</div>
          </div>
          {permError && <div style={{color:'#ef4444',fontSize:14,textAlign:'center',maxWidth:280,background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.2)',padding:'12px 16px',borderRadius:10,lineHeight:1.5}}>{permError}</div>}
          <button onClick={()=>void handlePermission()} style={{background:accent,color:'#000',border:'none',borderRadius:14,padding:'0 48px',height:56,fontSize:18,fontWeight:800,cursor:'pointer',minWidth:240}}>Allow &amp; Start</button>
          <button onClick={()=>setPhase('start')} style={{background:'transparent',color:'rgba(255,255,255,0.45)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,padding:'10px 24px',fontSize:15,cursor:'pointer'}}>Back</button>
        </div>
      )}

      {phase==='countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}

      {(phase==='playing'||phase==='countdown') && <>
        <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} />
        {phase==='playing' && <GameHUD accentColor={accent} items={[
          {label:'TIME',value:timeLeft,danger:timeLeft<=10,testId:'timer'},
          {label:'PACK',value:packDisp,testId:'score'},
        ]}/>}
      </>}

      {phase==='done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Pack Called',  value:`${finalSig.packCalled}/${PACK_SIZE}`, color:accent},
            {label:'Howl Time',    value:`${finalSig.howlTime}s`,               color:'#22c55e'},
            {label:'Peak Volume',  value:`${Math.round(finalSig.peakVolume*100)}%`,color:'#fbbf24'},
            {label:'Avg Volume',   value:`${Math.round(finalSig.avgVolume*100)}%`, color:'#06b6d4'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.packCalled>=1} />
      )}
      {phase==='done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}

      {phase==='playing' && <>
        <ScorePopEffect pops={pops} accentColor={accent} />
        <StreakBadge streak={packDisp} accentColor={accent} position="bottom-center" />
      </>}

      <AnimatePresence>
        {isNewBest && <motion.div key="pb" initial={{opacity:0,y:-20,scale:0.8}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-20}} transition={{duration:0.4,delay:0.5}} style={{position:'fixed',top:'10%',left:'50%',transform:'translateX(-50%)',zIndex:90,pointerEvents:'none',background:'linear-gradient(135deg,#fbbf24,#f59e0b)',borderRadius:20,padding:'8px 20px',fontSize:20,fontWeight:900,color:'#000',whiteSpace:'nowrap',boxShadow:'0 4px 20px rgba(251,191,36,0.5)'}}>🏆 New Best!</motion.div>}
      </AnimatePresence>
    </GameShell>
  );
}

function WebhookEmitter({theme,sig,personality,player}:{theme:ReturnType<typeof useBrandTheme>;sig:Signals;personality:string;player:PlayerSession|null;}){
  const fired=useRef(false);
  useEffect(()=>{
    if(fired.current) return; fired.current=true;
    postWebhook(theme,GAME_ID,{personality,score:sig.score,howlTime:sig.howlTime,packCalled:sig.packCalled,peakVolume:sig.peakVolume,avgVolume:sig.avgVolume},player);
  },[theme,sig,personality,player]);
  return null;
}
