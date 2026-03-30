'use client';
/**
 * CHANT POWER — Mic volume drives a rising power meter. Sustain at 90%+ for 3s to charge.
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

const GAME_ID   = 'chant-power';
const PB_KEY    = 'mg_pb_chant-power';
const ACCENT    = '#a855f7';
const DURATION  = 45;
const GAME_EMOJI  = '📣';
const GAME_TITLE  = 'Chant Power';
const GAME_TAGLINE = 'Chant loud. Fill the power. Charge the crystal.';
const CHARGE_THRESH = 0.88; // volume fraction to be "charging"
const CHARGE_HOLD   = 3.0;  // seconds to hold for a charge
const IDLE_THRESH   = 0.25; // below this = silence

interface Signals {
  score: number; charges: number; avgVolume: number;
  peakVolume: number; sustainSecs: number;
}
function getPersonality(s: Signals): string {
  if (s.charges >= 3) return 'Crowd Conductor 🎙️';
  if (s.charges >= 2) return 'Power Chanter 💪';
  if (s.charges >= 1) return 'Energy Rising ⚡';
  return 'Finding the Frequency 🌀';
}

interface GS {
  running: boolean; timeLeft: number;
  smoothVol: number; chargeProgress: number; // 0-1
  charges: number; particles: Particle[];
  volSum: number; volCount: number; peakVol: number;
  sustainSecs: number; // cumulative secs above CHARGE_THRESH
  flashAlpha: number; accentColor: string;
}
type Phase = 'start'|'permission'|'countdown'|'playing'|'done';

export default function ChantPowerGame() {
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
    running:false, timeLeft:DURATION,
    smoothVol:0, chargeProgress:0,
    charges:0, particles:[],
    volSum:0, volCount:0, peakVol:0, sustainSecs:0,
    flashAlpha:0, accentColor:ACCENT,
  });

  const [phase,      setPhase]      = useState<Phase>('start');
  const [timeLeft,   setTimeLeft]   = useState(DURATION);
  const [scoreDisp,  setScoreDisp]  = useState(0);
  const [chargesDisp,setChargesDisp]= useState(0);
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
    const a=analyserRef.current, d=dataArrRef.current;
    if(!a||!d) return 0;
    a.getByteFrequencyData(d);
    let sum=0; for(let i=0;i<d.length;i++) sum+=d[i]*d[i];
    return Math.min(1,Math.sqrt(sum/d.length)/128);
  },[]);

  const endGame = useCallback(()=>{
    const s=stateRef.current;
    s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    const sig:Signals={
      score:s.charges*100 + Math.round(s.sustainSecs*5),
      charges:s.charges, avgVolume:s.volCount>0?s.volSum/s.volCount:0,
      peakVolume:s.peakVol, sustainSecs:Math.round(s.sustainSecs),
    };
    sfx.success(); hapticVictory(); playVictoryFanfare();
    try{
      const prev=parseInt(localStorage.getItem(PB_KEY)||'0',10);
      if(sig.score>prev){localStorage.setItem(PB_KEY,String(sig.score));setIsNewBest(true);}
    }catch{/**/}
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

    s.running=true; s.timeLeft=DURATION; s.smoothVol=0; s.chargeProgress=0;
    s.charges=0; s.particles=[]; s.volSum=0; s.volCount=0; s.peakVol=0; s.sustainSecs=0; s.flashAlpha=0;
    setScoreDisp(0); setTimeLeft(DURATION); setChargesDisp(0); setPhase('playing');
    stopMusicRef.current=startMusic('pulse');

    timerRef.current=setInterval(()=>{
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      sfx.tick();
      if(s.timeLeft===10) sfx.warning();
      if(s.timeLeft<=0) endGame();
    },1000);

    const CHARGE_FRAMES=CHARGE_HOLD*60;
    const loop=(ts:number)=>{
      if(!s.running) return;
      const W=window.innerWidth, H=window.innerHeight;
      const raw=getMicVol();
      s.smoothVol=s.smoothVol*0.82+raw*0.18;
      const vol=s.smoothVol;
      s.volSum+=vol; s.volCount++;
      if(vol>s.peakVol) s.peakVol=vol;

      // Charge progress
      if(vol>=CHARGE_THRESH){
        s.chargeProgress=Math.min(1,s.chargeProgress+1/CHARGE_FRAMES);
        s.sustainSecs+=1/60;
        if(s.chargeProgress>=1){
          // CHARGED!
          s.charges++;
          s.chargeProgress=0;
          s.flashAlpha=1;
          const score=s.charges*100+Math.round(s.sustainSecs*5);
          setScoreDisp(score); setChargesDisp(s.charges);
          hapticVictory(); sfx.collect();
          spawnBurst(s.particles,W/2,H*0.35,accent,30,8);
          triggerPop(`CHARGED!`,W/2,H*0.35);
        }
      } else {
        // Decay charge progress if too quiet
        if(vol<IDLE_THRESH) s.chargeProgress=Math.max(0,s.chargeProgress-1.5/CHARGE_FRAMES);
      }
      s.flashAlpha=Math.max(0,s.flashAlpha-0.025);

      // --- RENDER ---
      ctx.fillStyle='#06030d'; ctx.fillRect(0,0,W,H);

      const mW=68, mH=H*0.55, mX=(W-mW)/2, mY=H*0.18;

      // Power glow background
      const glowR=mW*2+vol*80;
      const grd=ctx.createRadialGradient(W/2,mY+mH*0.5,0,W/2,mY+mH*0.5,glowR);
      grd.addColorStop(0,`rgba(168,85,247,${vol*0.18})`);
      grd.addColorStop(1,'transparent');
      ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);

      // Meter track
      ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.roundRect(mX,mY,mW,mH,12); ctx.fill(); ctx.stroke();

      // Meter fill (volume)
      const fillH=mH*vol; const fillY=mY+mH-fillH;
      if(fillH>2){
        const grad=ctx.createLinearGradient(0,fillY,0,mY+mH);
        grad.addColorStop(0,accent); grad.addColorStop(1,`${accent}55`);
        ctx.fillStyle=grad; ctx.shadowBlur=vol>CHARGE_THRESH?18:6; ctx.shadowColor=accent;
        ctx.beginPath(); ctx.roundRect(mX+3,fillY,mW-6,fillH,[0,0,8,8]); ctx.fill(); ctx.shadowBlur=0;
      }

      // Charge threshold line
      const threshY=mY+mH*(1-CHARGE_THRESH);
      ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=1.5; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(mX-8,threshY); ctx.lineTo(mX+mW+8,threshY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='10px "Space Grotesk",sans-serif';
      ctx.textAlign='center'; ctx.fillText('CHARGE',W/2,threshY-6); ctx.textAlign='left';

      // Charge progress arc above meter
      if(s.chargeProgress>0&&vol>=CHARGE_THRESH){
        const cx=W/2, cy=mY-30, r=22;
        ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=5;
        ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
        ctx.strokeStyle=accent; ctx.shadowBlur=12; ctx.shadowColor=accent;
        ctx.beginPath(); ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+Math.PI*2*s.chargeProgress); ctx.stroke();
        ctx.shadowBlur=0;
        ctx.fillStyle='#fff'; ctx.font='bold 14px "Space Grotesk",sans-serif';
        ctx.textAlign='center'; ctx.fillText(`${Math.round(s.chargeProgress*100)}%`,cx,cy+5); ctx.textAlign='left';
      }

      // Charges display (crystals)
      const maxDisp=6;
      for(let i=0;i<maxDisp;i++){
        const cx2=W/2+(i-maxDisp/2+0.5)*28, cy2=mY+mH+36;
        const filled=i<s.charges;
        ctx.beginPath(); ctx.arc(cx2,cy2,9,0,Math.PI*2);
        ctx.fillStyle=filled?accent:'rgba(255,255,255,0.08)';
        if(filled){ctx.shadowBlur=12;ctx.shadowColor=accent;}
        ctx.fill(); ctx.shadowBlur=0;
      }

      // Wolf silhouette (simple geometric)
      const wolfX=W/2, wolfY=H*0.78;
      const wolfScale=0.6+vol*0.5+s.chargeProgress*0.3;
      drawWolf(ctx, wolfX, wolfY, wolfScale, vol, s.chargeProgress, accent);

      // Flash on charge
      if(s.flashAlpha>0){
        ctx.fillStyle=`rgba(168,85,247,${s.flashAlpha*0.3})`; ctx.fillRect(0,0,W,H);
      }

      // Volume label
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='bold 15px "Space Grotesk",sans-serif';
      ctx.textAlign='center'; ctx.fillText(`${Math.round(vol*100)}%`,W/2,mY+mH+18); ctx.textAlign='left';

      updateAndDrawParticles(ctx,s.particles);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,getMicVol,accent,triggerPop]);

  function drawWolf(ctx:CanvasRenderingContext2D,x:number,y:number,scale:number,vol:number,charge:number,col:string){
    ctx.save();
    ctx.translate(x,y); ctx.scale(scale,scale);
    const howl=charge>0.5||vol>0.7;
    const glow=vol*12+charge*18;
    ctx.shadowBlur=glow; ctx.shadowColor=col;
    ctx.fillStyle=`rgba(168,85,247,${0.35+vol*0.45+charge*0.2})`;
    // body
    ctx.beginPath(); ctx.ellipse(0,0,22,14,0,0,Math.PI*2); ctx.fill();
    // head
    ctx.beginPath(); ctx.ellipse(-20,-8,12,10,0.2,0,Math.PI*2); ctx.fill();
    // ears
    ctx.beginPath(); ctx.moveTo(-27,-14); ctx.lineTo(-22,-26); ctx.lineTo(-17,-15); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-18,-13); ctx.lineTo(-14,-24); ctx.lineTo(-10,-14); ctx.closePath(); ctx.fill();
    // snout / howl mouth
    if(howl){
      ctx.beginPath(); ctx.arc(-28,-4,6,-Math.PI*0.3,Math.PI*0.3); ctx.strokeStyle=col; ctx.lineWidth=2; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(-28,-6,5,3,0,0,Math.PI*2); ctx.fill();
    }
    // tail (wagging)
    const wave=Math.sin(Date.now()*0.005)*0.3*vol;
    ctx.beginPath(); ctx.moveTo(18,0); ctx.quadraticCurveTo(30+vol*8,-10+wave*20,22,-20+wave*15);
    ctx.strokeStyle=col; ctx.lineWidth=3; ctx.stroke();
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
      analyserRef.current=analyser;
      dataArrRef.current=new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      actx.createMediaStreamSource(stream).connect(analyser);
      setPhase('countdown');
    }catch{setPermError('Microphone access denied. Please allow mic access and try again.');}
  },[]);

  const handlePlayAgain=useCallback(()=>{
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    analyserRef.current=null; dataArrRef.current=null;
    setPhase('start'); setScoreDisp(0); setTimeLeft(DURATION);
    setFinalSig(null); setIsNewBest(false); setChargesDisp(0); prevScore.current=0;
  },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%,rgba(168,85,247,0.12) 0%,transparent 55%),linear-gradient(180deg,#06030d 0%,#0a0414 100%)">

      {phase==='start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Chant →" accentColor={accent} onStart={handleStart}
          sensorNote="🎤 Microphone — chant into your phone"
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%,#0e0318 0%,#060310 55%,#030208 100%)" />
      )}

      {phase==='permission' && (
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#06030d',padding:'32px 24px',gap:24}}>
          <div style={{width:96,height:96,borderRadius:'50%',background:'rgba(168,85,247,0.12)',border:`2px solid ${accent}44`,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Mic size={48} color={accent} />
          </div>
          <div style={{textAlign:'center',maxWidth:300}}>
            <div style={{fontSize:28,fontWeight:800,color:'#fff',marginBottom:12}}>Mic Access Needed</div>
            <div style={{fontSize:16,color:'rgba(255,255,255,0.6)',lineHeight:1.6}}>Chant Power measures your voice volume to charge the crystal. Your mic data stays on your device.</div>
          </div>
          {permError && <div style={{color:'#ef4444',fontSize:14,textAlign:'center',maxWidth:280,background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.2)',padding:'12px 16px',borderRadius:10,lineHeight:1.5}}>{permError}</div>}
          <button onClick={()=>void handlePermission()} style={{background:accent,color:'#000',border:'none',borderRadius:14,padding:'0 48px',height:56,fontSize:18,fontWeight:800,cursor:'pointer',minWidth:240}}>Allow &amp; Start</button>
          <button onClick={()=>setPhase('start')} style={{background:'transparent',color:'rgba(255,255,255,0.45)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,padding:'10px 24px',fontSize:15,cursor:'pointer'}}>Back</button>
        </div>
      )}

      {phase==='countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}

      {(phase==='playing'||phase==='countdown') && (
        <>
          <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} />
          {phase==='playing' && <GameHUD accentColor={accent} items={[
            {label:'TIME',value:timeLeft,danger:timeLeft<=10,testId:'timer'},
            {label:'CHARGES',value:chargesDisp,testId:'score'},
          ]}/>}
        </>
      )}

      {phase==='done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Charges',    value:`${finalSig.charges}`,                  color:accent},
            {label:'Peak Volume',value:`${Math.round(finalSig.peakVolume*100)}%`,color:'#fbbf24'},
            {label:'Avg Volume', value:`${Math.round(finalSig.avgVolume*100)}%`, color:'#06b6d4'},
            {label:'Sustain',    value:`${finalSig.sustainSecs}s`,             color:'#22c55e'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.charges>=1} />
      )}
      {phase==='done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}

      {phase==='playing' && <>
        <ScorePopEffect pops={pops} accentColor={accent} />
        <StreakBadge streak={chargesDisp} accentColor={accent} position="bottom-center" />
      </>}

      <AnimatePresence>
        {isNewBest && <motion.div key="pb" initial={{opacity:0,y:-20,scale:0.8}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-20}} transition={{duration:0.4,delay:0.5}} style={{position:'fixed',top:'10%',left:'50%',transform:'translateX(-50%)',zIndex:90,pointerEvents:'none',background:'linear-gradient(135deg,#fbbf24,#f59e0b)',borderRadius:20,padding:'8px 20px',fontSize:20,fontWeight:900,color:'#000',whiteSpace:'nowrap',boxShadow:'0 4px 20px rgba(251,191,36,0.5)'}}>🏆 New Best!</motion.div>}
      </AnimatePresence>
    </GameShell>
  );
}

function WebhookEmitter({theme,sig,personality,player}:{
  theme:ReturnType<typeof useBrandTheme>;sig:Signals;personality:string;player:PlayerSession|null;
}){
  const fired=useRef(false);
  useEffect(()=>{
    if(fired.current) return; fired.current=true;
    postWebhook(theme,GAME_ID,{personality,score:sig.score,charges:sig.charges,peakVolume:sig.peakVolume,avgVolume:sig.avgVolume,sustainSecs:sig.sustainSecs},player);
  },[theme,sig,personality,player]);
  return null;
}
