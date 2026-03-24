'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID    = 'clover-path';
const ACCENT     = '#22c55e';
const DURATION   = 45;
const GAME_EMOJI = '🍀';
const GAME_TITLE = 'Clover Path';
const GAME_TAGLINE = "Trace the lucky path. Don't stray!";

// Generate a 4-leaf clover path as a series of bezier curve points
function generateCloverPath(cx:number,cy:number,r:number): Array<[number,number]> {
  const pts: Array<[number,number]> = [];
  const STEPS = 120;
  for(let i=0;i<=STEPS;i++){
    const t=(i/STEPS)*Math.PI*2;
    // Four-leaf clover: r = sin(2θ)
    const dist=r*Math.abs(Math.sin(2*t));
    const x=cx+dist*Math.cos(t);
    const y=cy+dist*Math.sin(t);
    pts.push([x,y]);
  }
  return pts;
}

interface Signals {
  pathCoverage: number;   // % of path completed (0-100)
  strays: number;         // times went off path
  completedLeaves: number;
  bestCoverage: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.pathCoverage>=90&&s.strays===0) return 'Lucky Legend 🍀';
  if (s.completedLeaves>=3)             return 'Clover Master 🌿';
  if (s.strays>=8)                      return 'Path Wanderer 🧭';
  if (s.pathCoverage>=70)               return 'Almost Lucky ✨';
  return 'First Leaf 🌱';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  cloverPath:Array<[number,number]>; pathRadius:number;
  userTrail:Array<[number,number]>; coverageSet:Set<number>;
  drawing:boolean; lastX:number; lastY:number;
  offPath:boolean; offPathFrames:number;
  completions:number; showCelebration:number;
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
}

export default function CloverPathGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{pathCoverage:0,strays:0,completedLeaves:0,bestCoverage:0,score:0},
    frame:0,accentColor:ACCENT,
    cloverPath:[],pathRadius:0,
    userTrail:[],coverageSet:new Set(),
    drawing:false,lastX:0,lastY:0,
    offPath:false,offPathFrames:0,
    completions:0,showCelebration:0,
    particles:[],
  });

  const [phase,setPhase]        = useState<Phase>('start');
  const [timeLeft,setTimeLeft]  = useState(DURATION);
  const [scoreDisplay,setScore] = useState(0);
  const [finalSig,setFinalSig]  = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  useEffect(()=>{ stateRef.current.accentColor=theme.colors.accent??ACCENT; },[theme]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){ clearInterval(timerRef.current); timerRef.current=null; }
    // Final coverage
    const coverage=Math.round((s.coverageSet.size/s.cloverPath.length)*100);
    s.sig.pathCoverage=coverage;
    const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");
    if(s.sig.score>pb) localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));
    setFinalSig({...s.sig}); setPhase('done'); hapticVictory();
  },[]);

  const regeneratePath = useCallback((W:number,H:number)=>{
    const s=stateRef.current;
    const r=Math.min(W,H)*0.32;
    s.pathRadius=r;
    s.cloverPath=generateCloverPath(W/2,H/2+20,r);
    s.userTrail=[]; s.coverageSet=new Set(); s.drawing=false;
  },[]);

  const startLoop = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current; const W=canvas.width,H=canvas.height;
    s.running=true; s.timeLeft=DURATION; s.frame=0;
    s.sig={pathCoverage:0,strays:0,completedLeaves:0,bestCoverage:0,score:0};
    s.offPath=false; s.offPathFrames=0; s.completions=0; s.showCelebration=0;
    s.particles=[];
    regeneratePath(W,H);
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);

    const TRACK_WIDTH=18; // tolerance in pixels

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;

      // Irish meadow background
      const bgGrad=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H));
      bgGrad.addColorStop(0,'#052808');
      bgGrad.addColorStop(1,'#021505');
      ctx.fillStyle=bgGrad; ctx.fillRect(0,0,W,H);

      // Grass texture
      for(let i=0;i<40;i++){
        const gx=((i*173+s.frame*0.05)%W), gy=H*0.8+((i*97)%(H*0.2));
        ctx.fillStyle='rgba(34,197,94,0.06)';
        ctx.fillRect(gx,gy,2,8+i%5);
      }

      // Draw clover path track
      ctx.save();
      ctx.strokeStyle='rgba(34,197,94,0.25)'; ctx.lineWidth=TRACK_WIDTH*2;
      ctx.lineJoin='round'; ctx.lineCap='round';
      ctx.beginPath();
      s.cloverPath.forEach(([x,y],i)=>{ i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
      ctx.stroke();
      // Path guide line
      ctx.strokeStyle='rgba(34,197,94,0.5)'; ctx.lineWidth=2; ctx.setLineDash([8,8]);
      ctx.lineDashOffset=-s.frame*0.5;
      ctx.beginPath();
      s.cloverPath.forEach(([x,y],i)=>{ i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
      ctx.stroke(); ctx.setLineDash([]); ctx.restore();

      // Show covered path segments
      if(s.coverageSet.size>0){
        ctx.save(); ctx.strokeStyle='#4ade80'; ctx.lineWidth=4; ctx.lineCap='round';
        let started=false; let lastCovered=false;
        s.cloverPath.forEach(([x,y],i)=>{
          const covered=s.coverageSet.has(i);
          if(covered&&!lastCovered){ ctx.beginPath(); ctx.moveTo(x,y); started=true; }
          else if(covered&&started) ctx.lineTo(x,y);
          else if(!covered&&lastCovered&&started){ ctx.stroke(); started=false; }
          lastCovered=covered;
        });
        if(started) ctx.stroke();
        ctx.restore();
      }

      // Coverage percentage
      const coverage=Math.round((s.coverageSet.size/s.cloverPath.length)*100);
      if(coverage>0){
        const pulse=0.8+Math.sin(s.frame*0.1)*0.2;
        ctx.save(); ctx.globalAlpha=pulse; ctx.fillStyle='#4ade80';
        ctx.font='bold 16px sans-serif'; ctx.textAlign='center';
        ctx.fillText(`${coverage}% traced`,W/2,H-20); ctx.restore();
      }

      // Check 100% coverage
      if(coverage>=99&&s.drawing){
        s.sig.completedLeaves++;
        const pts=3;
        s.sig.score+=pts; setScore(s.sig.score);
        if(coverage>s.sig.bestCoverage) s.sig.bestCoverage=coverage;
        sfx.success(); hapticCombo(4);
        s.showCelebration=80;
        for(let p=0;p<20;p++) s.particles.push({
          x:W/2,y:H/2, vx:(Math.random()-0.5)*12, vy:(Math.random()-0.5)*12,
          alpha:1, color:`hsl(${120+Math.random()*60},90%,60%)`
        });
        // Reset for another run
        s.userTrail=[]; s.coverageSet=new Set(); s.drawing=false;
      }

      // User trail
      if(s.userTrail.length>1){
        ctx.save(); ctx.strokeStyle=s.offPath?'#ef4444':'#86efac';
        ctx.lineWidth=3; ctx.lineCap='round'; ctx.lineJoin='round';
        ctx.beginPath(); s.userTrail.forEach(([x,y],i)=>{ i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
        ctx.stroke(); ctx.restore();
      }

      // Off-path warning
      if(s.offPath){
        const a=0.4+Math.sin(s.frame*0.3)*0.3;
        ctx.save(); ctx.globalAlpha=a; ctx.fillStyle='#ef4444';
        ctx.font='bold 16px sans-serif'; ctx.textAlign='center';
        ctx.fillText('Stay on the path! ⚠️',W/2,60); ctx.restore();
      }

      // Celebration
      if(s.showCelebration>0){
        s.showCelebration--;
        const a=Math.min(1,s.showCelebration/20);
        ctx.save(); ctx.globalAlpha=a; ctx.fillStyle='#fbbf24';
        ctx.font=`bold ${Math.round(W*0.09)}px sans-serif`; ctx.textAlign='center';
        ctx.fillText('🍀 Lucky!',W/2,H/2); ctx.restore();
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.alpha*=0.93;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill(); ctx.restore();
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,regeneratePath]);

  // Check if point is on path
  function isOnPath(x:number,y:number,s:GS,threshold:number): {onPath:boolean;nearestIdx:number}{
    let minDist=Infinity, nearestIdx=0;
    for(let i=0;i<s.cloverPath.length;i++){
      const [px,py]=s.cloverPath[i];
      const d=Math.hypot(x-px,y-py);
      if(d<minDist){ minDist=d; nearestIdx=i; }
    }
    return {onPath:minDist<=threshold,nearestIdx};
  }

  const trackDraw = useCallback((cx:number,cy:number,isStart:boolean)=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const s=stateRef.current; if(!s.running) return;
    const rect=canvas.getBoundingClientRect();
    const x=(cx-rect.left)*(canvas.width/rect.width);
    const y=(cy-rect.top)*(canvas.height/rect.height);
    const TOLERANCE=22;

    if(isStart){ s.drawing=true; s.lastX=x; s.lastY=y; return; }
    if(!s.drawing) return;

    const {onPath,nearestIdx}=isOnPath(x,y,s,TOLERANCE);
    if(onPath){
      s.offPath=false;
      // Cover nearby path points
      for(let di=-3;di<=3;di++){
        const idx=(nearestIdx+di+s.cloverPath.length)%s.cloverPath.length;
        s.coverageSet.add(idx);
      }
      s.userTrail.push([x,y]);
      if(s.userTrail.length>60) s.userTrail.shift();
      s.sig.score+=0; // score on completion
    } else {
      if(!s.offPath){
        s.offPath=true; s.sig.strays++;
        sfx.collision(); hapticFail();
      }
      s.offPathFrames++;
    }
    s.lastX=x; s.lastY=y;
  },[]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; regeneratePath(canvas.width,canvas.height); };
    resize(); window.addEventListener('resize',resize);

    const onPD=(e:PointerEvent)=>{ if(phase==='playing'){ e.preventDefault(); trackDraw(e.clientX,e.clientY,true); }};
    const onPM=(e:PointerEvent)=>{ if(phase==='playing'&&e.buttons>0) trackDraw(e.clientX,e.clientY,false); };
    const onPU=()=>{ stateRef.current.drawing=false; };

    canvas.addEventListener('pointerdown',onPD);
    canvas.addEventListener('pointermove',onPM);
    canvas.addEventListener('pointerup',onPU);
    return()=>{ window.removeEventListener('resize',resize);
      canvas.removeEventListener('pointerdown',onPD); canvas.removeEventListener('pointermove',onPM);
      canvas.removeEventListener('pointerup',onPU); };
  },[phase,trackDraw,regeneratePath]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Trace Your Luck 🍀" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Clover path tracing canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Path Traced',value:`${finalSig.pathCoverage}%`,color:'#4ade80'},
          {label:'Strays',value:`${finalSig.strays}`,color:finalSig.strays===0?'#4ade80':'#ef4444'},
          {label:'Full Clovers',value:`${finalSig.completedLeaves}`,color:ACCENT},
          {label:'Best',value:`${finalSig.bestCoverage}%`,color:'#fbbf24'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.completedLeaves>=2}/>}
    </GameShell>
  );
}
