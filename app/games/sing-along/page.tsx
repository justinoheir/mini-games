'use client';
/**
 * SING ALONG — A moving pitch target line travels across the canvas. Hum/sing to track it.
 * Autocorrelation pitch detection via Web Audio API. Score = time on target.
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

const GAME_ID   = 'sing-along';
const PB_KEY    = 'mg_pb_sing-along';
const ACCENT    = '#34d399';
const DURATION  = 45;
const GAME_EMOJI  = '🎤';
const GAME_TITLE  = 'Sing Along';
const GAME_TAGLINE = 'Follow the melody line with your voice.';

const FREQ_MIN = 100, FREQ_MAX = 580;
const HIT_CENTS = 60, PRECISION_CENTS = 25;
const SCORE_TICK_MS = 80;
const HUD_H = 64;

// The target melody: a series of {freq, duration} segments
const MELODY: {freq:number;durationMs:number}[] = [
  {freq:261.63,durationMs:2000},{freq:293.66,durationMs:1500},{freq:329.63,durationMs:1500},
  {freq:349.23,durationMs:2000},{freq:392.00,durationMs:2500},{freq:349.23,durationMs:1500},
  {freq:329.63,durationMs:1500},{freq:293.66,durationMs:2000},{freq:261.63,durationMs:3000},
  {freq:329.63,durationMs:2000},{freq:392.00,durationMs:2000},{freq:440.00,durationMs:2500},
  {freq:523.25,durationMs:3000},{freq:440.00,durationMs:2000},{freq:392.00,durationMs:2000},
  {freq:329.63,durationMs:2500},{freq:261.63,durationMs:3000},
];
function freqToY(freq:number,H:number):number{
  const logMin=Math.log2(FREQ_MIN), logMax=Math.log2(FREQ_MAX);
  const logF=Math.log2(Math.max(FREQ_MIN,Math.min(FREQ_MAX,freq)));
  return HUD_H+(H-HUD_H)*(1-(logF-logMin)/(logMax-logMin));
}

function autoCorrelate(buf:Float32Array,sampleRate:number):number{
  const SIZE=buf.length, HALF=SIZE>>1;
  let rms=0; for(let i=0;i<SIZE;i++) rms+=buf[i]*buf[i]; rms=Math.sqrt(rms/SIZE);
  if(rms<0.012) return -1;
  const minLag=Math.floor(sampleRate/700), maxLag=Math.min(Math.ceil(sampleRate/80),SIZE-2);
  let bestLag=-1, bestCorr=-Infinity;
  for(let lag=minLag;lag<=maxLag;lag++){
    let c=0; for(let i=0;i<HALF;i++) c+=buf[i]*buf[i+lag];
    if(c>bestCorr){bestCorr=c;bestLag=lag;}
  }
  if(bestLag<1) return -1;
  let norm=0; for(let i=0;i<HALF;i++) norm+=buf[i]*buf[i];
  if(norm<1e-8||bestCorr/norm<0.28) return -1;
  if(bestLag>1&&bestLag<maxLag-1){
    let c0=0,c1=0,c2=0;
    for(let i=0;i<HALF;i++){c0+=buf[i]*buf[i+bestLag-1];c1+=buf[i]*buf[i+bestLag];c2+=buf[i]*buf[i+bestLag+1];}
    const a=(c0+c2-2*c1)/2, b=(c2-c0)/2;
    if(a<0){ const ref=bestLag-b/(2*a); return sampleRate/ref; }
  }
  return sampleRate/bestLag;
}

interface Signals {
  score: number; onTargetSecs: number; maxHoldSecs: number;
  avgDeviation: number; silenceGaps: number;
}
function getPersonality(s:Signals):string{
  if(s.onTargetSecs>20&&s.avgDeviation<30) return 'Natural Singer 🎼';
  if(s.maxHoldSecs>5&&s.onTargetSecs>10)  return 'Melodic Voice 🎵';
  if(s.onTargetSecs>8)                    return 'Pitch Finder 🎯';
  return 'Finding the Note 🌱';
}

interface GS {
  running:boolean; timeLeft:number;
  detectedPitch:number; displayPitch:number; lastDetectTs:number;
  gameStartTs:number; currentMelodyNote:number; noteElapsedMs:number;
  onTarget:boolean; holdStartTs:number; maxHoldMs:number; onTargetMs:number;
  lastScoreTick:number; hitFlashAlpha:number;
  inSilence:boolean; silenceStartTs:number; silenceGaps:number; firstPitch:boolean;
  particles:Particle[]; devTotal:number; devSamples:number;
  pitchBuf:Float32Array<ArrayBuffer>|null; accentColor:string;
}
type Phase='start'|'permission'|'countdown'|'playing'|'done';

export default function SingAlongGame(){
  const theme=useBrandTheme();
  const accent=theme.colors.accent??ACCENT;
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const animRef=useRef(0);
  const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef=useRef<(()=>void)|null>(null);
  const audioCtxRef=useRef<AudioContext|null>(null);
  const analyserRef=useRef<AnalyserNode|null>(null);
  const micStreamRef=useRef<MediaStream|null>(null);
  const resizeRef=useRef<(()=>void)|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);

  const stateRef=useRef<GS>({
    running:false,timeLeft:DURATION,
    detectedPitch:-1,displayPitch:-1,lastDetectTs:0,
    gameStartTs:0,currentMelodyNote:0,noteElapsedMs:0,
    onTarget:false,holdStartTs:0,maxHoldMs:0,onTargetMs:0,
    lastScoreTick:0,hitFlashAlpha:0,
    inSilence:false,silenceStartTs:0,silenceGaps:0,firstPitch:false,
    particles:[],devTotal:0,devSamples:0,
    pitchBuf:null as Float32Array<ArrayBuffer>|null,accentColor:ACCENT,
  });

  const [phase,setPhase]=useState<Phase>('start');
  const [timeLeft,setTimeLeft]=useState(DURATION);
  const [scoreDisp,setScoreDisp]=useState(0);
  const [finalSig,setFinalSig]=useState<Signals|null>(null);
  const [permError,setPermError]=useState('');
  const [isNewBest,setIsNewBest]=useState(false);
  const {pops,triggerPop}=useScorePop();
  const prevScore=useRef(0);

  useEffect(()=>{stateRef.current.accentColor=accent;},[accent]);
  useEffect(()=>{
    if(scoreDisp>prevScore.current) triggerPop(`+${scoreDisp-prevScore.current}`,window.innerWidth/2,200);
    prevScore.current=scoreDisp;
  },[scoreDisp,triggerPop]);

  const endGame=useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    const sig:Signals={
      score:Math.round(s.onTargetMs/100)+Math.round(s.maxHoldMs/500)*10,
      onTargetSecs:Math.round(s.onTargetMs/1000),
      maxHoldSecs:parseFloat((s.maxHoldMs/1000).toFixed(1)),
      avgDeviation:s.devSamples>0?Math.round(s.devTotal/s.devSamples):0,
      silenceGaps:s.silenceGaps,
    };
    sfx.success(); hapticVictory(); playVictoryFanfare();
    try{const p=parseInt(localStorage.getItem(PB_KEY)||'0',10);if(sig.score>p){localStorage.setItem(PB_KEY,String(sig.score));setIsNewBest(true);}}catch{/**/}
    setFinalSig(sig); setPhase('done');
  },[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    const resize=()=>{
      const dpr=window.devicePixelRatio||1,w=window.innerWidth,h=window.innerHeight;
      canvas.style.width=w+'px';canvas.style.height=h+'px';
      canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
    };
    resize(); window.addEventListener('resize',resize); resizeRef.current=()=>window.removeEventListener('resize',resize);

    s.running=true;s.timeLeft=DURATION;s.detectedPitch=-1;s.displayPitch=-1;
    s.gameStartTs=Date.now();s.currentMelodyNote=0;s.noteElapsedMs=0;
    s.onTarget=false;s.holdStartTs=0;s.maxHoldMs=0;s.onTargetMs=0;
    s.lastScoreTick=Date.now();s.hitFlashAlpha=0;
    s.inSilence=false;s.silenceGaps=0;s.firstPitch=false;
    s.particles=[];s.devTotal=0;s.devSamples=0;

    setScoreDisp(0);setTimeLeft(DURATION);setPhase('playing');
    stopMusicRef.current=startMusic('calm');
    timerRef.current=setInterval(()=>{
      s.timeLeft--;setTimeLeft(s.timeLeft);sfx.tick();
      if(s.timeLeft===10) sfx.warning();
      if(s.timeLeft<=0) endGame();
    },1000);

    // History buffer for scrolling waveform
    const HISTORY_LEN=200;
    const pitchHistory:number[]=Array(HISTORY_LEN).fill(-1);
    const targetHistory:number[]=Array(HISTORY_LEN).fill(0);
    let histIdx=0, histTickMs=0;
    const HIST_INTERVAL=DURATION*1000/HISTORY_LEN;

    const loop=(ts:number)=>{
      if(!s.running) return;
      const now=Date.now();
      const W=window.innerWidth,H=window.innerHeight;

      // Pitch detection every 50ms
      if(now-s.lastDetectTs>=50&&analyserRef.current&&s.pitchBuf&&audioCtxRef.current){
        s.lastDetectTs=now;
        analyserRef.current.getFloatTimeDomainData(s.pitchBuf);
        s.detectedPitch=autoCorrelate(s.pitchBuf,audioCtxRef.current.sampleRate);
      }

      // Current melody note
      const elapsed=now-s.gameStartTs;
      let noteAccMs=0,noteIdx=0;
      for(let i=0;i<MELODY.length;i++){
        noteAccMs+=MELODY[i].durationMs;
        if(elapsed<noteAccMs){noteIdx=i;break;}
        if(i===MELODY.length-1) noteIdx=i;
      }
      s.currentMelodyNote=noteIdx;
      const targetFreq=MELODY[noteIdx].freq;

      // Pitch smoothing
      if(s.detectedPitch>0){
        s.displayPitch=s.displayPitch>0?s.displayPitch*0.8+s.detectedPitch*0.2:s.detectedPitch;
        s.firstPitch=true;
        if(s.inSilence){s.inSilence=false;}
      } else {
        if(s.firstPitch&&!s.inSilence){s.inSilence=true;s.silenceStartTs=now;}
        if(s.inSilence&&now-s.silenceStartTs>600){s.silenceGaps++;s.inSilence=false;}
        if(s.displayPitch>0){s.displayPitch*=0.94;if(s.displayPitch<FREQ_MIN+5) s.displayPitch=-1;}
      }

      // Hit zone check
      const dp=s.displayPitch;
      let inHit=false,centsOff=999;
      if(dp>0){centsOff=Math.abs(1200*Math.log2(dp/targetFreq));inHit=centsOff<=HIT_CENTS;}
      const inPrec=inHit&&centsOff<=PRECISION_CENTS;

      if(inHit){
        if(!s.onTarget){s.onTarget=true;s.holdStartTs=now;sfx.collect();hapticScore();}
        s.hitFlashAlpha=Math.min(1,s.hitFlashAlpha+0.06);
        if(now-s.lastScoreTick>=SCORE_TICK_MS){
          s.lastScoreTick=now;
          const pts=inPrec?3:1;
          const newScore=Math.round(s.onTargetMs/100)+Math.round(s.maxHoldMs/500)*10+pts;
          s.onTargetMs+=SCORE_TICK_MS;
          s.devTotal+=centsOff;s.devSamples++;
          setScoreDisp(s.onTargetMs>0?Math.round(s.onTargetMs/100):0);
          if(Math.random()<0.05) spawnBurst(s.particles,W*0.5,freqToY(dp,H),accent,4,2);
        }
        const holdMs=now-s.holdStartTs;
        if(holdMs>s.maxHoldMs) s.maxHoldMs=holdMs;
      } else {
        if(s.onTarget){s.onTarget=false;}
        s.hitFlashAlpha=Math.max(0,s.hitFlashAlpha-0.04);
      }

      // History recording
      if(now-histTickMs>=HIST_INTERVAL){
        histTickMs=now; pitchHistory[histIdx]=dp; targetHistory[histIdx]=targetFreq;
        histIdx=(histIdx+1)%HISTORY_LEN;
      }

      // --- RENDER ---
      ctx.fillStyle='#060412'; ctx.fillRect(0,0,W,H);

      // Background glow when on target
      if(s.hitFlashAlpha>0){
        const bgGrd=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*0.7);
        bgGrd.addColorStop(0,`rgba(52,211,153,${s.hitFlashAlpha*0.1})`);
        bgGrd.addColorStop(1,'transparent');
        ctx.fillStyle=bgGrd; ctx.fillRect(0,0,W,H);
      }

      // Frequency guide lines
      const GUIDES=[130.81,196,261.63,329.63,392,440,523.25];
      for(const gf of GUIDES){
        const gy=freqToY(gf,H);
        ctx.strokeStyle='rgba(255,255,255,0.03)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(W,gy);ctx.stroke();
      }

      // Hit zone band
      const tY=freqToY(targetFreq,H);
      const hitTopY=freqToY(targetFreq*Math.pow(2,HIT_CENTS/1200),H);
      const hitBotY=freqToY(targetFreq*Math.pow(2,-HIT_CENTS/1200),H);
      ctx.fillStyle=`rgba(52,211,153,${0.06+s.hitFlashAlpha*0.08})`;
      ctx.fillRect(0,hitTopY,W,hitBotY-hitTopY);

      // Precision zone
      const pTopY=freqToY(targetFreq*Math.pow(2,PRECISION_CENTS/1200),H);
      const pBotY=freqToY(targetFreq*Math.pow(2,-PRECISION_CENTS/1200),H);
      ctx.fillStyle=`rgba(52,211,153,${0.04+s.hitFlashAlpha*0.06})`;
      ctx.fillRect(0,pTopY,W,pBotY-pTopY);

      // Dashed zone borders
      ctx.save(); ctx.setLineDash([5,8]);
      ctx.strokeStyle=`rgba(52,211,153,${0.15+s.hitFlashAlpha*0.15})`; ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(0,hitTopY);ctx.lineTo(W*0.88,hitTopY);
      ctx.moveTo(0,hitBotY);ctx.lineTo(W*0.88,hitBotY);ctx.stroke(); ctx.restore();

      // Scrolling target history line (shows where target has been)
      ctx.save();
      ctx.strokeStyle='rgba(52,211,153,0.35)'; ctx.lineWidth=2.5;
      ctx.shadowBlur=inHit?10:4; ctx.shadowColor=accent;
      ctx.beginPath();
      let drawn=false;
      for(let i=0;i<HISTORY_LEN;i++){
        const hi=(histIdx+i)%HISTORY_LEN;
        const tf=targetHistory[hi]; if(tf<=0) continue;
        const px=W*(i/HISTORY_LEN); const py=freqToY(tf,H);
        if(!drawn){ctx.moveTo(px,py);drawn=true;} else ctx.lineTo(px,py);
      }
      ctx.stroke(); ctx.restore();

      // Target label
      ctx.save();ctx.fillStyle=inHit?accent:'rgba(52,211,153,0.6)';
      ctx.font='bold 12px "JetBrains Mono",monospace';ctx.textBaseline='middle';
      if(inHit){ctx.shadowBlur=10;ctx.shadowColor=accent;}
      const noteNames:Record<number,string>={261.63:'C4',293.66:'D4',329.63:'E4',349.23:'F4',392:'G4',440:'A4',523.25:'C5'};
      ctx.fillText(noteNames[targetFreq]??`${Math.round(targetFreq)}Hz`,W*0.9,tY);ctx.restore();

      // Player pitch line
      if(dp>0){
        const pY=freqToY(dp,H);
        ctx.save();
        ctx.strokeStyle=inHit?accent:'rgba(255,255,255,0.75)'; ctx.lineWidth=inHit?3:2;
        ctx.shadowBlur=inHit?20:6; ctx.shadowColor=inHit?accent:'rgba(255,255,255,0.4)';
        ctx.beginPath();ctx.moveTo(W*0.06,pY);ctx.lineTo(W*0.82,pY);ctx.stroke();
        ctx.beginPath();ctx.arc(W*0.04,pY,5,0,Math.PI*2);
        ctx.fillStyle=inHit?accent:'rgba(255,255,255,0.9)';ctx.fill();
        ctx.restore();
      }

      // Scrolling pitch history (player)
      if(s.firstPitch){
        ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=1.5;
        ctx.beginPath(); let pDrawn=false;
        for(let i=0;i<HISTORY_LEN;i++){
          const hi=(histIdx+i)%HISTORY_LEN;
          const pf=pitchHistory[hi]; if(pf<=0){pDrawn=false;continue;}
          const px=W*(i/HISTORY_LEN); const py2=freqToY(pf,H);
          if(!pDrawn){ctx.moveTo(px,py2);pDrawn=true;} else ctx.lineTo(px,py2);
        }
        ctx.stroke(); ctx.restore();
      }

      // Note progress dots (right side)
      for(let i=0;i<MELODY.length;i++){
        const dy=HUD_H+8+i*(H-HUD_H-16)/MELODY.length;
        ctx.beginPath();ctx.arc(W-12,dy,i===noteIdx?5:3,0,Math.PI*2);
        ctx.fillStyle=i<noteIdx?accent:i===noteIdx?`rgba(52,211,153,0.8)`:'rgba(255,255,255,0.1)';
        ctx.fill();
      }

      // Combo indicator
      if(inHit&&s.onTargetMs>2000){
        ctx.fillStyle=accent;ctx.font='bold 12px "Space Grotesk",sans-serif';
        ctx.textBaseline='bottom';ctx.shadowBlur=8;ctx.shadowColor=accent;
        ctx.fillText('ON PITCH ✓',14,H-12);ctx.shadowBlur=0;
      }

      updateAndDrawParticles(ctx,s.particles);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,accent,triggerPop]);

  useEffect(()=>()=>{
    cancelAnimationFrame(animRef.current);
    if(timerRef.current) clearInterval(timerRef.current);
    if(stopMusicRef.current) stopMusicRef.current();
    if(resizeRef.current) resizeRef.current();
    if(audioCtxRef.current) audioCtxRef.current.close().catch(()=>{});
    if(micStreamRef.current) micStreamRef.current.getTracks().forEach(t=>t.stop());
  },[]);

  const handleStart=useCallback(async(name:string,avatar:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);
    initAudio(); sfx.click(); setPermError('');
    if((window as unknown as Record<string,unknown>).__DISABLE_AUDIO){setPhase('countdown');return;}
    if(!navigator.mediaDevices?.getUserMedia){setPermError('Microphone not supported in this browser.');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      micStreamRef.current=stream;
      const actx=new AudioContext(); await actx.resume(); audioCtxRef.current=actx;
      const analyser=actx.createAnalyser(); analyser.fftSize=2048; analyser.smoothingTimeConstant=0;
      analyserRef.current=analyser;
      stateRef.current.pitchBuf=new Float32Array(new ArrayBuffer(analyser.fftSize*Float32Array.BYTES_PER_ELEMENT));
      actx.createMediaStreamSource(stream).connect(analyser);
      setPhase('countdown');
    }catch{ setPermError('Microphone access denied. Please allow mic access and try again.'); }
  },[]);

  const handlePlayAgain=useCallback(()=>{
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    analyserRef.current=null; stateRef.current.pitchBuf=null;
    setPhase('start');setScoreDisp(0);setTimeLeft(DURATION);setFinalSig(null);setIsNewBest(false);prevScore.current=0;
  },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%,rgba(52,211,153,0.08) 0%,transparent 50%),linear-gradient(180deg,#060412 0%,#080614 100%)">

      {phase==='start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Enable Mic & Sing →" accentColor={accent} onStart={handleStart}
          sensorNote="🎤 Microphone — hum or sing to follow the line"
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%,#0b1a12 0%,#060412 55%,#040210 100%)">
          {permError && <div style={{marginTop:14,padding:'10px 14px',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:10,color:'#ef4444',fontSize:14,lineHeight:1.5}}>{permError}</div>}
        </GameStartScreen>
      )}

      {phase==='countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}

      {(phase==='playing'||phase==='countdown') && <>
        <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} />
        {phase==='playing' && <GameHUD accentColor={accent} items={[
          {label:'TIME',value:timeLeft,danger:timeLeft<=10,testId:'timer'},
          {label:'SCORE',value:scoreDisp,testId:'score'},
        ]}/>}
      </>}

      {phase==='done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'On Pitch',    value:`${finalSig.onTargetSecs}s`,                  color:accent},
            {label:'Best Hold',   value:`${finalSig.maxHoldSecs}s`,                  color:'#fbbf24'},
            {label:'Avg Deviation',value:`±${finalSig.avgDeviation} cents`,          color:'#06b6d4'},
            {label:'Silence Gaps',value:`${finalSig.silenceGaps}`,                   color:'#ef4444'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.onTargetSecs>=8} />
      )}
      {phase==='done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}

      {phase==='playing' && <>
        <ScorePopEffect pops={pops} accentColor={accent} />
        <StreakBadge streak={0} accentColor={accent} />
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
    postWebhook(theme,GAME_ID,{personality,score:sig.score,onTargetSecs:sig.onTargetSecs,maxHoldSecs:sig.maxHoldSecs,avgDeviation:sig.avgDeviation,silenceGaps:sig.silenceGaps},player);
  },[theme,sig,personality,player]);
  return null;
}
