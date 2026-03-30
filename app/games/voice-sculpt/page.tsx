'use client';
/**
 * VOICE SCULPT — Mic volume controls a glowing particle's Y position.
 * Navigate through scrolling gap obstacles. Loud = up, quiet = down.
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

const GAME_ID   = 'voice-sculpt';
const PB_KEY    = 'mg_pb_voice-sculpt';
const ACCENT    = '#ec4899';
const DURATION  = 45;
const GAME_EMOJI  = '🎨';
const GAME_TITLE  = 'Voice Sculpt';
const GAME_TAGLINE = 'Louder floats up. Quieter sinks down. Guide your spark.';

const BALL_X_RATIO = 0.22; // fixed X position of particle
const BALL_RADIUS  = 12;
const WALL_W       = 22;
const GAP_H_RATIO  = 0.28; // gap is 28% of screen height
const WALL_SPEED   = 160; // px/s
const WALL_SPACING = 300; // px between walls
const HUD_H        = 60;

interface Wall {
  x: number;
  gapTop: number; // Y of gap top
  passed: boolean;
}
interface Signals {
  score: number; wallsPassed: number; collisions: number; avgVolume: number;
}
function getPersonality(s: Signals): string {
  const acc = (s.wallsPassed+s.collisions)>0 ? s.wallsPassed/(s.wallsPassed+s.collisions) : 0;
  if (acc >= 0.85 && s.wallsPassed >= 8) return 'Sound Sculptor 🎨';
  if (acc >= 0.70) return 'Voice Pilot ✈️';
  if (acc >= 0.50) return 'Frequency Rider 🌊';
  return 'Learning to Float 🎈';
}

interface GS {
  running: boolean; timeLeft: number;
  ballY: number; targetY: number;
  smoothVol: number;
  walls: Wall[];
  particles: Particle[];
  collisions: number; wallsPassed: number;
  volSum: number; volCount: number;
  hitFlash: number; accentColor: string;
  trailPoints: {x:number;y:number}[];
}
type Phase = 'start'|'permission'|'countdown'|'playing'|'done';

export default function VoiceSculptGame() {
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
    running:false,timeLeft:DURATION,ballY:0,targetY:0,
    smoothVol:0,walls:[],particles:[],collisions:0,wallsPassed:0,
    volSum:0,volCount:0,hitFlash:0,accentColor:ACCENT,trailPoints:[],
  });

  const [phase,      setPhase]      = useState<Phase>('start');
  const [timeLeft,   setTimeLeft]   = useState(DURATION);
  const [scoreDisp,  setScoreDisp]  = useState(0);
  const [finalSig,   setFinalSig]   = useState<Signals|null>(null);
  const [permError,  setPermError]  = useState('');
  const [isNewBest,  setIsNewBest]  = useState(false);
  const { pops, triggerPop } = useScorePop();
  const prevScore = useRef(0);

  useEffect(()=>{ stateRef.current.accentColor=accent; },[accent]);
  useEffect(()=>{
    if(scoreDisp>prevScore.current) triggerPop(`+${scoreDisp-prevScore.current}`,window.innerWidth*BALL_X_RATIO,200);
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
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    const sig:Signals={
      score:s.wallsPassed*20+Math.round((s.volSum/(s.volCount||1))*100),
      wallsPassed:s.wallsPassed, collisions:s.collisions,
      avgVolume:s.volCount>0?s.volSum/s.volCount:0,
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

    const H=window.innerHeight;
    s.running=true; s.timeLeft=DURATION; s.ballY=(H-HUD_H)/2+HUD_H;
    s.targetY=s.ballY; s.smoothVol=0; s.walls=[]; s.particles=[];
    s.collisions=0; s.wallsPassed=0; s.volSum=0; s.volCount=0; s.hitFlash=0; s.trailPoints=[];

    // Seed initial walls
    const W=window.innerWidth;
    for(let i=1;i<=6;i++){
      const gapH=H*GAP_H_RATIO;
      const gapTop=HUD_H+20+Math.random()*(H-HUD_H-40-gapH);
      s.walls.push({x:W+i*WALL_SPACING, gapTop, passed:false});
    }

    setScoreDisp(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic('pulse');
    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft); sfx.tick();
      if(s.timeLeft===10) sfx.warning();
      if(s.timeLeft<=0) endGame();
    },1000);

    let lastTs=performance.now();
    const loop=(ts:number)=>{
      if(!s.running) return;
      const dt=(ts-lastTs)/1000; lastTs=ts; // dt in seconds
      const W2=window.innerWidth, H2=window.innerHeight;
      const ballX=W2*BALL_X_RATIO;
      const gapH=H2*GAP_H_RATIO;

      // Volume → ball target Y (loud=top, quiet=bottom)
      const vol=getMicVol();
      s.smoothVol=s.smoothVol*0.8+vol*0.2;
      s.volSum+=s.smoothVol; s.volCount++;
      const playH=H2-HUD_H;
      s.targetY=HUD_H+BALL_RADIUS+10+(1-s.smoothVol)*(playH-BALL_RADIUS*2-20);
      // Lerp ball toward target
      s.ballY+=(s.targetY-s.ballY)*0.12;
      s.ballY=Math.max(HUD_H+BALL_RADIUS,Math.min(H2-BALL_RADIUS,s.ballY));

      // Trail
      s.trailPoints.push({x:ballX,y:s.ballY});
      if(s.trailPoints.length>20) s.trailPoints.shift();

      // Move walls
      for(const wall of s.walls){ wall.x-=WALL_SPEED*dt; }

      // Check passages and spawn new walls
      for(const wall of s.walls){
        if(!wall.passed && wall.x+WALL_W < ballX){
          wall.passed=true; s.wallsPassed++;
          hapticScore(); sfx.collect();
          spawnBurst(s.particles,ballX+BALL_RADIUS,s.ballY,accent,12,4);
          const score=s.wallsPassed*20+Math.round((s.volSum/(s.volCount||1))*100);
          setScoreDisp(score);
        }
      }

      // Recycle walls off-screen
      s.walls=s.walls.filter(w=>w.x>-WALL_W-10);
      while(s.walls.length<8){
        const lastX=s.walls.length>0?Math.max(...s.walls.map(w=>w.x)):W2;
        const gt=HUD_H+20+Math.random()*(H2-HUD_H-40-gapH);
        s.walls.push({x:lastX+WALL_SPACING, gapTop:gt, passed:false});
      }

      // Collision detection
      for(const wall of s.walls){
        if(wall.x<ballX+BALL_RADIUS && wall.x+WALL_W>ballX-BALL_RADIUS){
          const inGap=s.ballY>wall.gapTop&&s.ballY<wall.gapTop+gapH;
          if(!inGap){
            s.hitFlash=0.8; s.collisions++;
            hapticFail(); sfx.collision();
            spawnBurst(s.particles,ballX,s.ballY,'#ef4444',10,5);
          }
        }
      }
      s.hitFlash=Math.max(0,s.hitFlash-0.04);

      // --- RENDER ---
      ctx.clearRect(0,0,W2,H2);
      ctx.fillStyle='#060310'; ctx.fillRect(0,0,W2,H2);

      // Background glow at ball position
      const bgGrd=ctx.createRadialGradient(ballX,s.ballY,0,ballX,s.ballY,180);
      bgGrd.addColorStop(0,`rgba(236,72,153,${s.smoothVol*0.15})`);
      bgGrd.addColorStop(1,'transparent');
      ctx.fillStyle=bgGrd; ctx.fillRect(0,0,W2,H2);

      // Draw walls
      for(const wall of s.walls){
        ctx.fillStyle='rgba(236,72,153,0.25)'; ctx.strokeStyle='rgba(236,72,153,0.5)'; ctx.lineWidth=1;
        // top wall
        const topH=wall.gapTop-HUD_H;
        if(topH>0){
          ctx.beginPath(); ctx.roundRect(wall.x,HUD_H,WALL_W,topH,[0,0,6,6]); ctx.fill(); ctx.stroke();
        }
        // bottom wall
        const botY=wall.gapTop+gapH;
        const botH=H2-botY;
        if(botH>0){
          ctx.beginPath(); ctx.roundRect(wall.x,botY,WALL_W,botH,[6,6,0,0]); ctx.fill(); ctx.stroke();
        }
        // Gap highlight
        ctx.strokeStyle='rgba(236,72,153,0.15)'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(wall.x+WALL_W/2,wall.gapTop); ctx.lineTo(wall.x+WALL_W/2,wall.gapTop+gapH); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Trail
      if(s.trailPoints.length>1){
        ctx.save(); ctx.lineWidth=3;
        for(let i=1;i<s.trailPoints.length;i++){
          const alpha=(i/s.trailPoints.length)*0.4;
          ctx.strokeStyle=`rgba(236,72,153,${alpha})`;
          ctx.beginPath(); ctx.moveTo(s.trailPoints[i-1].x,s.trailPoints[i-1].y); ctx.lineTo(s.trailPoints[i].x,s.trailPoints[i].y); ctx.stroke();
        }
        ctx.restore();
      }

      // Ball (glowing particle)
      ctx.save();
      ctx.shadowBlur=20+s.smoothVol*15; ctx.shadowColor=accent;
      const ballGrd=ctx.createRadialGradient(ballX,s.ballY,0,ballX,s.ballY,BALL_RADIUS);
      ballGrd.addColorStop(0,'#fff'); ballGrd.addColorStop(0.4,accent); ballGrd.addColorStop(1,`${accent}00`);
      ctx.fillStyle=ballGrd; ctx.beginPath(); ctx.arc(ballX,s.ballY,BALL_RADIUS+s.smoothVol*6,0,Math.PI*2); ctx.fill();
      ctx.restore();

      // Volume bar (left side)
      const vbX=10,vbW=8,vbH=H2*0.5,vbY=(H2-vbH)/2;
      ctx.fillStyle='rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.roundRect(vbX,vbY,vbW,vbH,4); ctx.fill();
      const vFillH=vbH*s.smoothVol;
      if(vFillH>0){
        ctx.fillStyle=accent; ctx.shadowBlur=6; ctx.shadowColor=accent;
        ctx.beginPath(); ctx.roundRect(vbX,vbY+vbH-vFillH,vbW,vFillH,[0,0,4,4]); ctx.fill(); ctx.shadowBlur=0;
      }

      // Hit flash
      if(s.hitFlash>0){ ctx.fillStyle=`rgba(239,68,68,${s.hitFlash*0.3})`; ctx.fillRect(0,0,W2,H2); }

      // Score label
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='12px "Space Grotesk",sans-serif';
      ctx.textAlign='center'; ctx.fillText(`${s.wallsPassed} walls cleared`,W2/2,H2-12); ctx.textAlign='left';

      updateAndDrawParticles(ctx,s.particles);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,getMicVol,accent,triggerPop]);

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
    setPhase('start'); setScoreDisp(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); prevScore.current=0;
  },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 50%,rgba(236,72,153,0.08) 0%,transparent 55%),linear-gradient(180deg,#060310 0%,#080414 100%)">

      {phase==='start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Mic & Sculpt →" accentColor={accent} onStart={handleStart} sensorNote="🎤 Microphone — your voice controls the spark" gradient="radial-gradient(ellipse 80% 70% at 50% 30%,#140610 0%,#08040e 55%,#040308 100%)" />}

      {phase==='permission' && (
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#060310',padding:'32px 24px',gap:24}}>
          <div style={{width:96,height:96,borderRadius:'50%',background:'rgba(236,72,153,0.1)',border:`2px solid ${accent}44`,display:'flex',alignItems:'center',justifyContent:'center'}}><Mic size={48} color={accent}/></div>
          <div style={{textAlign:'center',maxWidth:300}}>
            <div style={{fontSize:28,fontWeight:800,color:'#fff',marginBottom:12}}>Mic Access Needed</div>
            <div style={{fontSize:16,color:'rgba(255,255,255,0.6)',lineHeight:1.6}}>Voice Sculpt uses your voice volume to float a particle through obstacles. Your mic data stays on your device.</div>
          </div>
          {permError && <div style={{color:'#ef4444',fontSize:14,textAlign:'center',maxWidth:280,background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.2)',padding:'12px 16px',borderRadius:10,lineHeight:1.5}}>{permError}</div>}
          <button onClick={()=>void handlePermission()} style={{background:accent,color:'#fff',border:'none',borderRadius:14,padding:'0 48px',height:56,fontSize:18,fontWeight:800,cursor:'pointer',minWidth:240}}>Allow &amp; Start</button>
          <button onClick={()=>setPhase('start')} style={{background:'transparent',color:'rgba(255,255,255,0.45)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,padding:'10px 24px',fontSize:15,cursor:'pointer'}}>Back</button>
        </div>
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
            {label:'Walls Cleared',value:`${finalSig.wallsPassed}`,    color:'#22c55e'},
            {label:'Collisions',   value:`${finalSig.collisions}`,     color:'#ef4444'},
            {label:'Avg Volume',   value:`${Math.round(finalSig.avgVolume*100)}%`,color:accent},
            {label:'Precision',    value:finalSig.collisions===0?'Perfect! 🎯':`${finalSig.wallsPassed} clean`,color:'#fbbf24'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.wallsPassed>=5} />
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
    postWebhook(theme,GAME_ID,{personality,score:sig.score,wallsPassed:sig.wallsPassed,collisions:sig.collisions,avgVolume:sig.avgVolume},player);
  },[theme,sig,personality,player]);
  return null;
}
