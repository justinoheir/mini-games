'use client';
/**
 * HUM MAZE — Hum pitch steers a glowing ball through scrolling corridor gates.
 * Low pitch (< 220Hz) drifts LEFT. High pitch (> 350Hz) drifts RIGHT.
 * Gates scroll from right to left. Navigate through the correct gap.
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

const GAME_ID   = 'hum-maze';
const PB_KEY    = 'mg_pb_hum-maze';
const ACCENT    = '#818cf8';
const DURATION  = 60;
const GAME_EMOJI  = '🌀';
const GAME_TITLE  = 'Hum Maze';
const GAME_TAGLINE = 'Hum low to drift left, high to drift right. Navigate the gates.';

const HUD_H       = 64;
const BALL_R      = 14;
const GATE_W      = 28;
const GAP_W_RATIO = 0.32; // gap is 32% of screen width
const GATE_SPEED  = 140;  // px/s
const GATE_SPACING= 280;

const PITCH_LOW  = 220; // Hz — steer left
const PITCH_HIGH = 350; // Hz — steer right
const DRIFT_SPEED= 120; // px/s max drift

// Autocorrelation pitch detection (same as pitch-match / sing-along)
function autoCorrelate(buf:Float32Array,sampleRate:number):number{
  const SIZE=buf.length,HALF=SIZE>>1;
  let rms=0; for(let i=0;i<SIZE;i++) rms+=buf[i]*buf[i]; rms=Math.sqrt(rms/SIZE);
  if(rms<0.01) return -1;
  const minLag=Math.floor(sampleRate/700),maxLag=Math.min(Math.ceil(sampleRate/80),SIZE-2);
  let bestLag=-1,bestCorr=-Infinity;
  for(let lag=minLag;lag<=maxLag;lag++){
    let c=0; for(let i=0;i<HALF;i++) c+=buf[i]*buf[i+lag];
    if(c>bestCorr){bestCorr=c;bestLag=lag;}
  }
  if(bestLag<1) return -1;
  let norm=0; for(let i=0;i<HALF;i++) norm+=buf[i]*buf[i];
  if(norm<1e-8||bestCorr/norm<0.26) return -1;
  if(bestLag>1&&bestLag<maxLag-1){
    let c0=0,c1=0,c2=0;
    for(let i=0;i<HALF;i++){c0+=buf[i]*buf[i+bestLag-1];c1+=buf[i]*buf[i+bestLag];c2+=buf[i]*buf[i+bestLag+1];}
    const a=(c0+c2-2*c1)/2,b=(c2-c0)/2;
    if(a<0){const ref=bestLag-b/(2*a);return sampleRate/ref;}
  }
  return sampleRate/bestLag;
}

type GateDir = 'left'|'center'|'right';
interface Gate { x:number; dir:GateDir; passed:boolean; }
interface Signals {
  score:number; gatesPassed:number; collisions:number;
  avgPitch:number; perfectRun:boolean;
}
function getPersonality(s:Signals):string{
  if(s.perfectRun&&s.gatesPassed>=8) return 'Pitch Navigator 🗺️';
  if(s.gatesPassed>=8) return 'Hum Master 🎵';
  if(s.gatesPassed>=4) return 'Drone Pilot 🚁';
  return 'Learning to Hum 🌀';
}

interface GS {
  running:boolean; timeLeft:number;
  ballX:number; pitch:number; displayPitch:number; lastDetectTs:number;
  gates:Gate[]; particles:Particle[];
  gatesPassed:number; collisions:number;
  pitchSum:number; pitchCount:number;
  hitFlash:number; pitchBuf:Float32Array<ArrayBuffer>|null; accentColor:string;
}
type Phase='start'|'permission'|'countdown'|'playing'|'done';

export default function HumMazeGame(){
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
    running:false,timeLeft:DURATION,ballX:0,pitch:-1,displayPitch:-1,lastDetectTs:0,
    gates:[],particles:[],gatesPassed:0,collisions:0,pitchSum:0,pitchCount:0,
    hitFlash:0, pitchBuf:null, accentColor:ACCENT,
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
      score:s.gatesPassed*30+(s.collisions===0?50:0),
      gatesPassed:s.gatesPassed,collisions:s.collisions,
      avgPitch:s.pitchCount>0?Math.round(s.pitchSum/s.pitchCount):0,
      perfectRun:s.collisions===0,
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

    const W=window.innerWidth,H=window.innerHeight;
    const BALL_Y=H*0.62; // ball fixed Y
    s.running=true; s.timeLeft=DURATION; s.ballX=W/2;
    s.pitch=-1; s.displayPitch=-1; s.lastDetectTs=0;
    s.gates=[]; s.particles=[]; s.gatesPassed=0; s.collisions=0;
    s.pitchSum=0; s.pitchCount=0; s.hitFlash=0;

    // Seed initial gates
    const DIRS:GateDir[]=['left','center','right'];
    for(let i=1;i<=6;i++){
      s.gates.push({x:W+i*GATE_SPACING, dir:DIRS[Math.floor(Math.random()*3)], passed:false});
    }

    setScoreDisp(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic('calm');
    timerRef.current=setInterval(()=>{
      s.timeLeft--;setTimeLeft(s.timeLeft);sfx.tick();
      if(s.timeLeft===10) sfx.warning();
      if(s.timeLeft<=0) endGame();
    },1000);

    let lastTs=performance.now();
    const loop=(ts:number)=>{
      if(!s.running) return;
      const dt=(ts-lastTs)/1000; lastTs=ts;
      const W2=window.innerWidth,H2=window.innerHeight;
      const gapW=W2*GAP_W_RATIO;
      const now=Date.now();

      // Pitch detection (every 50ms)
      if(now-s.lastDetectTs>=50&&analyserRef.current&&s.pitchBuf&&audioCtxRef.current){
        s.lastDetectTs=now;
        analyserRef.current.getFloatTimeDomainData(s.pitchBuf);
        s.pitch=autoCorrelate(s.pitchBuf,audioCtxRef.current.sampleRate);
        if(s.pitch>0){s.pitchSum+=s.pitch;s.pitchCount++;}
      }

      // Pitch → ball drift
      const p=s.pitch;
      let drift=0;
      if(p>0){
        s.displayPitch=s.displayPitch>0?s.displayPitch*0.75+p*0.25:p;
        const dp=s.displayPitch;
        if(dp<PITCH_LOW) drift=-1*(1-dp/PITCH_LOW); // low pitch → left
        else if(dp>PITCH_HIGH) drift=Math.min(1,(dp-PITCH_HIGH)/200); // high pitch → right
        // else neutral zone → no drift
      } else {
        if(s.displayPitch>0) s.displayPitch*=0.95;
      }
      s.ballX+=drift*DRIFT_SPEED*dt;
      s.ballX=Math.max(BALL_R+4,Math.min(W2-BALL_R-4,s.ballX));

      // Move gates
      for(const g of s.gates) g.x-=GATE_SPEED*dt;

      // Gap X positions based on dir
      const getGapX=(g:Gate)=>{
        if(g.dir==='left')   return W2*0.1;
        if(g.dir==='right')  return W2-W2*0.1-gapW;
        return (W2-gapW)/2;
      };

      // Check passes and collisions
      const GATE_DEPTH=30; // vertical depth of gate "hitbox"
      for(const g of s.gates){
        if(!g.passed&&g.x+GATE_W<s.ballX-10){
          // Gate passed the ball
          const gapX=getGapX(g);
          const inGap=s.ballX>gapX&&s.ballX<gapX+gapW;
          if(inGap){
            g.passed=true; s.gatesPassed++;
            hapticScore(); sfx.collect();
            spawnBurst(s.particles,s.ballX,BALL_Y,accent,14,5);
            setScoreDisp(s.gatesPassed*30+(s.collisions===0?50:0));
          } else {
            // Collision with wall
            s.collisions++; s.hitFlash=0.9;
            hapticFail(); sfx.collision();
            spawnBurst(s.particles,s.ballX,BALL_Y,'#ef4444',8,4);
            g.passed=true; // consume so we don't multi-trigger
          }
        }
      }

      // Recycle gates
      s.gates=s.gates.filter(g=>g.x>-GATE_W-10);
      while(s.gates.length<7){
        const lastX=s.gates.length>0?Math.max(...s.gates.map(g=>g.x)):W2;
        const DIRS2:GateDir[]=['left','center','right'];
        s.gates.push({x:lastX+GATE_SPACING,dir:DIRS2[Math.floor(Math.random()*3)],passed:false});
      }
      s.hitFlash=Math.max(0,s.hitFlash-0.04);

      // --- RENDER ---
      ctx.fillStyle='#04030f'; ctx.fillRect(0,0,W2,H2);

      // Background grid
      ctx.strokeStyle='rgba(129,140,248,0.04)'; ctx.lineWidth=1;
      const gS=48; for(let x=0;x<W2;x+=gS){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H2);ctx.stroke();}
      for(let y=0;y<H2;y+=gS){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W2,y);ctx.stroke();}

      // Pitch indicator zones (background strip)
      const stripY=H2*0.87,stripH=14,stripW=W2*0.7,stripX=(W2-stripW)/2;
      ctx.fillStyle='rgba(255,255,255,0.04)';ctx.beginPath();ctx.roundRect(stripX,stripY,stripW,stripH,7);ctx.fill();
      // Left zone (low pitch)
      ctx.fillStyle='rgba(59,130,246,0.2)';ctx.beginPath();ctx.roundRect(stripX,stripY,stripW*0.35,stripH,[7,0,0,7]);ctx.fill();
      // Right zone (high pitch)
      ctx.fillStyle='rgba(239,68,68,0.2)';ctx.beginPath();ctx.roundRect(stripX+stripW*0.65,stripY,stripW*0.35,stripH,[0,7,7,0]);ctx.fill();
      // Indicator
      if(s.displayPitch>0){
        const pFrac=Math.max(0,Math.min(1,(s.displayPitch-80)/(600-80)));
        const indX=stripX+pFrac*stripW-5;
        ctx.fillStyle=s.displayPitch<PITCH_LOW?'#3b82f6':s.displayPitch>PITCH_HIGH?'#ef4444':'rgba(255,255,255,0.7)';
        ctx.shadowBlur=8;ctx.shadowColor=ctx.fillStyle;
        ctx.beginPath();ctx.roundRect(indX,stripY-1,10,stripH+2,5);ctx.fill();ctx.shadowBlur=0;
      }
      // Labels
      ctx.fillStyle='rgba(255,255,255,0.3)';ctx.font='10px "Space Grotesk",sans-serif';ctx.textAlign='center';
      ctx.fillText('LOW',stripX+stripW*0.17,stripY-4);
      ctx.fillText('NEUTRAL',stripX+stripW*0.5,stripY-4);
      ctx.fillText('HIGH',stripX+stripW*0.83,stripY-4);
      ctx.textAlign='left';

      // Draw gates
      for(const g of s.gates){
        const gapX=getGapX(g);
        const col='rgba(129,140,248,0.35)';
        const border='rgba(129,140,248,0.6)';
        const gateH=H2*0.75;
        const gateTop=HUD_H+H2*0.04;

        // Left wall
        const lW=gapX;
        if(lW>0){
          ctx.fillStyle=col;ctx.strokeStyle=border;ctx.lineWidth=1;
          ctx.beginPath();ctx.roundRect(g.x,gateTop,GATE_W,gateH,[0,0,8,8]);ctx.fill();ctx.stroke();
        }
        // Right wall
        const rX=gapX+gapW;
        const rW=W2-rX;
        if(rW>0){
          ctx.fillStyle=col;ctx.strokeStyle=border;ctx.lineWidth=1;
          ctx.beginPath();ctx.roundRect(g.x,gateTop,GATE_W,gateH,[0,0,8,8]);ctx.fill();ctx.stroke();
        }

        // Actually draw left and right sections:
        // Left section: from gate.x to gate.x+GATE_W, covers x:0 to gapX
        // Right section: from gate.x to gate.x+GATE_W, covers x:gapX+gapW to W2
        // We draw the gate as 2 vertical bars with a gap between them, projected to ball's lane
        // Simpler: draw full gate, then cut out gap
        ctx.save();
        ctx.fillStyle='rgba(129,140,248,0.3)';ctx.strokeStyle='rgba(129,140,248,0.55)';ctx.lineWidth=1.5;

        // Left bar (gate column, left of gap)
        const lBarW=gapX-4;
        if(lBarW>4){
          ctx.beginPath();ctx.roundRect(g.x,gateTop,GATE_W,gateH,[0,0,8,8]);ctx.fill();ctx.stroke();
        }
        ctx.restore();

        // Simpler: just draw 2 colored vertical walls
        // left wall (from screen left to gap start)
        const lWallW=gapX;
        if(lWallW>0){
          ctx.fillStyle='rgba(129,140,248,0.22)';ctx.strokeStyle='rgba(129,140,248,0.5)';ctx.lineWidth=1;
          ctx.beginPath();ctx.roundRect(g.x,gateTop,GATE_W,gateH);ctx.fill();
          // Draw left bar
          ctx.fillStyle='rgba(129,140,248,0.3)';
          ctx.fillRect(g.x,gateTop,Math.min(GATE_W,lWallW),gateH);
        }

        // right wall (from gap end to screen right)  
        if(rW>0){
          const rStart=Math.max(g.x,rX);
          ctx.fillStyle='rgba(129,140,248,0.3)';
          ctx.fillRect(rStart,gateTop,Math.min(GATE_W,rW),gateH);
        }

        // Gap highlight
        ctx.strokeStyle='rgba(129,140,248,0.12)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
        ctx.beginPath();ctx.moveTo(g.x+GATE_W/2,gateTop);ctx.lineTo(g.x+GATE_W/2,gateTop+gateH);ctx.stroke();
        ctx.setLineDash([]);

        // Direction arrow
        const arrowY=gateTop+gateH/2;
        ctx.fillStyle='rgba(129,140,248,0.55)';ctx.font='bold 14px "Space Grotesk",sans-serif';ctx.textAlign='center';
        const arrow=g.dir==='left'?'◀':g.dir==='right'?'▶':'—';
        ctx.fillText(arrow,g.x+GATE_W/2,arrowY+5);ctx.textAlign='left';
      }

      // Ball glow trail
      const trailGrd=ctx.createRadialGradient(s.ballX,BALL_Y,0,s.ballX,BALL_Y,BALL_R*4);
      trailGrd.addColorStop(0,`rgba(129,140,248,${0.1+s.hitFlash*0.05})`);
      trailGrd.addColorStop(1,'transparent');
      ctx.fillStyle=trailGrd;ctx.fillRect(0,0,W2,H2);

      // Ball
      ctx.save();
      ctx.shadowBlur=20+s.hitFlash*10;ctx.shadowColor=s.hitFlash>0?'#ef4444':accent;
      const ballGrd=ctx.createRadialGradient(s.ballX,BALL_Y,0,s.ballX,BALL_Y,BALL_R);
      ballGrd.addColorStop(0,'#fff');
      ballGrd.addColorStop(0.45,s.hitFlash>0?'#ef4444':accent);
      ballGrd.addColorStop(1,`${accent}00`);
      ctx.fillStyle=ballGrd;ctx.beginPath();ctx.arc(s.ballX,BALL_Y,BALL_R,0,Math.PI*2);ctx.fill();
      ctx.restore();

      // Ball horizontal axis indicator
      ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=1;ctx.setLineDash([3,8]);
      ctx.beginPath();ctx.moveTo(BALL_R+4,BALL_Y);ctx.lineTo(W2-BALL_R-4,BALL_Y);ctx.stroke();
      ctx.setLineDash([]);

      // Hit flash
      if(s.hitFlash>0){ctx.fillStyle=`rgba(239,68,68,${s.hitFlash*0.25})`;ctx.fillRect(0,0,W2,H2);}

      // Score label
      ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='12px "Space Grotesk",sans-serif';
      ctx.textAlign='center';ctx.fillText(`${s.gatesPassed} gates cleared${s.collisions===0?' 🌟':''}`,W2/2,H2*0.95);ctx.textAlign='left';

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
    initAudio();sfx.click();setPermError('');
    if((window as unknown as Record<string,unknown>).__DISABLE_AUDIO){setPhase('countdown');return;}
    if(!navigator.mediaDevices?.getUserMedia){setPermError('Microphone not supported in this browser.');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      micStreamRef.current=stream;
      const actx=new AudioContext();await actx.resume();audioCtxRef.current=actx;
      const analyser=actx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=0;
      analyserRef.current=analyser;
      stateRef.current.pitchBuf=new Float32Array(new ArrayBuffer(analyser.fftSize*Float32Array.BYTES_PER_ELEMENT));
      actx.createMediaStreamSource(stream).connect(analyser);
      setPhase('countdown');
    }catch{setPermError('Microphone access denied. Please allow mic access and try again.');}
  },[]);

  const handlePlayAgain=useCallback(()=>{
    if(audioCtxRef.current){audioCtxRef.current.close().catch(()=>{});audioCtxRef.current=null;}
    if(micStreamRef.current){micStreamRef.current.getTracks().forEach(t=>t.stop());micStreamRef.current=null;}
    analyserRef.current=null;stateRef.current.pitchBuf=null;
    setPhase('start');setScoreDisp(0);setTimeLeft(DURATION);setFinalSig(null);setIsNewBest(false);prevScore.current=0;
  },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 40%,rgba(129,140,248,0.1) 0%,transparent 55%),linear-gradient(180deg,#04030f 0%,#060412 100%)">

      {phase==='start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Enable Mic & Hum →" accentColor={accent} onStart={handleStart}
          sensorNote="🎤 Microphone — hum low or high to steer"
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%,#0a0820 0%,#060412 55%,#040210 100%)">
          {permError && <div style={{marginTop:14,padding:'10px 14px',background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:10,color:'#ef4444',fontSize:14,lineHeight:1.5}}>{permError}</div>}
        </GameStartScreen>
      )}

      {phase==='countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}

      {(phase==='playing'||phase==='countdown') && <>
        <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} />
        {phase==='playing' && <GameHUD accentColor={accent} items={[
          {label:'TIME',value:timeLeft,danger:timeLeft<=10,testId:'timer'},
          {label:'GATES',value:scoreDisp,testId:'score'},
        ]}/>}
      </>}

      {phase==='done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            {label:'Gates Passed',value:`${finalSig.gatesPassed}`,      color:'#22c55e'},
            {label:'Collisions',  value:`${finalSig.collisions}`,       color:'#ef4444'},
            {label:'Avg Pitch',   value:finalSig.avgPitch>0?`${finalSig.avgPitch}Hz`:'—',color:accent},
            {label:'Perfect Run', value:finalSig.perfectRun?'YES 🌟':'Not yet',color:finalSig.perfectRun?'#fbbf24':'#555'},
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.gatesPassed>=4} />
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
    postWebhook(theme,GAME_ID,{personality,score:sig.score,gatesPassed:sig.gatesPassed,collisions:sig.collisions,avgPitch:sig.avgPitch,perfectRun:sig.perfectRun},player);
  },[theme,sig,personality,player]);
  return null;
}
