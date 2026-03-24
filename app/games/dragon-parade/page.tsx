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

const GAME_ID    = 'dragon-parade';
const ACCENT     = '#ef4444';
const DURATION   = 60;
const GAME_EMOJI = '🐉';
const GAME_TITLE = 'Dragon Parade';
const GAME_TAGLINE = 'Guide the dragon. Make it dance!';

const SEGMENT_COUNT = 14;
const SEGMENT_DIST  = 22;
const DRAGON_R      = 18;

interface Gate { x: number; y: number; w: number; h: number; passed: boolean; frame: number; }
interface Segment { x: number; y: number; }

interface Signals {
  gatesPassed: number;
  bodyCollisions: number;
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.gatesPassed >= 20 && s.bodyCollisions === 0) return 'Dragon Master 🐉';
  if (s.gatesPassed >= 15)                           return 'Parade Champion 🎊';
  if (s.bodyCollisions >= 8)                         return 'Wiggly Dragon 🌀';
  if (s.maxStreak >= 8)                              return 'Rhythm Dancer 🎵';
  return 'Festival Starter 🏮';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  segments:Segment[]; headX:number; headY:number; targetX:number; targetY:number;
  gates:Gate[]; gateTimer:number; gateSpeed:number;
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
}

export default function DragonParadeGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{gatesPassed:0,bodyCollisions:0,maxStreak:0,streakCurrent:0,score:0},
    frame:0,accentColor:ACCENT,
    segments:[],headX:200,headY:300,targetX:200,targetY:300,
    gates:[],gateTimer:0,gateSpeed:2,
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
    const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");
    if(s.sig.score>pb) localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));
    setFinalSig({...s.sig}); setPhase('done'); hapticVictory();
  },[]);

  const startLoop = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const s=stateRef.current; const W=canvas.width,H=canvas.height;
    s.running=true; s.timeLeft=DURATION; s.frame=0; s.gateSpeed=2;
    s.sig={gatesPassed:0,bodyCollisions:0,maxStreak:0,streakCurrent:0,score:0};
    s.headX=W/2; s.headY=H/2; s.targetX=W/2; s.targetY=H/2;
    s.segments=Array.from({length:SEGMENT_COUNT},(_,i)=>({x:W/2-i*SEGMENT_DIST,y:H/2}));
    s.gates=[]; s.gateTimer=60; s.particles=[];
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
      if(s.timeLeft===40||s.timeLeft===20) s.gateSpeed+=0.5;
    },1000);

    const COLORS=['#ef4444','#fbbf24','#f97316','#dc2626','#fde68a'];

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;

      // Festive red background
      ctx.fillStyle='#1a0005'; ctx.fillRect(0,0,W,H);
      // Lantern lights
      for(let i=0;i<8;i++){
        const lx=((i*137+s.frame*0.3)%W), ly=20+((i*97)%60);
        ctx.save(); ctx.shadowBlur=20; ctx.shadowColor='#fbbf24';
        ctx.fillStyle='#fde68a22'; ctx.beginPath();
        ctx.arc(lx,ly,12,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#fbbf24'; ctx.font='16px sans-serif'; ctx.textAlign='center';
        ctx.fillText('🏮',lx,ly+6); ctx.restore();
      }

      // Move head toward target (smooth)
      const dx=s.targetX-s.headX, dy=s.targetY-s.headY;
      const spd=5;
      if(Math.abs(dx)>1||Math.abs(dy)>1){
        s.headX+=dx*0.18; s.headY+=dy*0.18;
      }
      s.headX=Math.max(DRAGON_R,Math.min(W-DRAGON_R,s.headX));
      s.headY=Math.max(DRAGON_R+70,Math.min(H-DRAGON_R,s.headY));// Update body segments (follow head with distance constraint)
      s.segments[0].x=s.headX; s.segments[0].y=s.headY;
      for(let i=1;i<s.segments.length;i++){
        const prev=s.segments[i-1], curr=s.segments[i];
        const dx2=prev.x-curr.x, dy2=prev.y-curr.y;
        const dist=Math.hypot(dx2,dy2);
        if(dist>SEGMENT_DIST){
          curr.x=prev.x-dx2/dist*SEGMENT_DIST;
          curr.y=prev.y-dy2/dist*SEGMENT_DIST;
        }
      }

      // Spawn gates
      s.gateTimer--;
      if(s.gateTimer<=0){
        s.gateTimer=90;
        const gap=90+Math.random()*60; const gateY=80+Math.random()*(H-160);
        s.gates.push({ x:W+10, y:gateY-gap/2, w:40, h:gap, passed:false, frame:0 });
      }

      // Update and draw gates
      for(let i=s.gates.length-1;i>=0;i--){
        const g=s.gates[i]; g.x-=s.gateSpeed; g.frame++;
        if(g.x<-50){ s.gates.splice(i,1); continue; }

        // Collision: check if head passes through gate
        if(!g.passed && s.headX>g.x && s.headX<g.x+g.w){
          const inGap=s.headY<g.y && s.headY<g.y+g.h;
          if(!inGap){
            s.sig.bodyCollisions++; s.sig.streakCurrent=0;
            hapticFail(); sfx.collision();
          }
        }
        if(!g.passed && s.headX>g.x+g.w){
          g.passed=true;
          s.sig.gatesPassed++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          const pts=s.sig.streakCurrent>=3?2:1; s.sig.score+=pts;
          sfx.collect(); hapticScore();
          if(s.sig.streakCurrent>=3) hapticCombo(s.sig.streakCurrent);
          setScore(s.sig.score);
          for(let p=0;p<10;p++) s.particles.push({
            x:g.x,y:g.y+g.h/2, vx:(Math.random()-0.5)*8, vy:(Math.random()-0.5)*8,
            alpha:1, color:COLORS[Math.floor(Math.random()*COLORS.length)]
          });
        }

        // Draw gate as red drums/pillars
        ctx.save(); ctx.shadowBlur=8; ctx.shadowColor='#ef4444';
        ctx.fillStyle='#dc2626';
        ctx.fillRect(g.x-8,0,8,g.y); // top pillar
        ctx.fillRect(g.x-8,g.y+g.h,8,H); // bottom pillar
        ctx.strokeStyle='#fbbf24'; ctx.lineWidth=2;
        ctx.strokeRect(g.x-8,0,8,g.y); ctx.strokeRect(g.x-8,g.y+g.h,8,H-g.y-g.h);
        ctx.restore();
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.alpha*=0.9;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill(); ctx.restore();
      }

      // Draw body segments
      for(let i=s.segments.length-1;i>=0;i--){
        const seg=s.segments[i];
        const scale=1-i/(s.segments.length+5);
        const r=DRAGON_R*scale;
        const wave=Math.sin(s.frame*0.15+i*0.7)*3;
        ctx.save(); ctx.shadowBlur=8; ctx.shadowColor='#ef4444';
        ctx.fillStyle=COLORS[i%COLORS.length]+'dd';
        ctx.beginPath(); ctx.arc(seg.x+wave,seg.y,r,0,Math.PI*2); ctx.fill();
        ctx.restore();
      }

      // Draw head
      ctx.save(); ctx.shadowBlur=16; ctx.shadowColor='#ef4444';
      ctx.fillStyle='#ef4444';
      ctx.beginPath(); ctx.arc(s.headX,s.headY,DRAGON_R+4,0,Math.PI*2); ctx.fill();
      ctx.font=`${Math.round(DRAGON_R*2.2)}px sans-serif`; ctx.textAlign='center';
      ctx.fillText('🐉',s.headX,s.headY,DRAGON_R*0.8); ctx.restore();

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);

    const onPM=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; if(!s.running) return;
      const rect=canvas.getBoundingClientRect();
      s.targetX=(e.clientX-rect.left)*(canvas.width/rect.width);
      s.targetY=(e.clientY-rect.top)*(canvas.height/rect.height);
    };
    const onPD=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current;
      const rect=canvas.getBoundingClientRect();
      s.targetX=(e.clientX-rect.left)*(canvas.width/rect.width);
      s.targetY=(e.clientY-rect.top)*(canvas.height/rect.height);
    };
    canvas.addEventListener('pointermove',onPM);
    canvas.addEventListener('pointerdown',onPD);
    return()=>{ window.removeEventListener('resize',resize);
      canvas.removeEventListener('pointermove',onPM); canvas.removeEventListener('pointerdown',onPD); };
  },[phase]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Start the Parade 🐉" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Dragon parade game canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Gates Passed',value:`${finalSig.gatesPassed}`,color:'#4ade80'},
          {label:'Collisions',value:`${finalSig.bodyCollisions}`,color:finalSig.bodyCollisions===0?'#4ade80':'#ef4444'},
          {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:ACCENT},
          {label:'Final Score',value:`${finalSig.score}`,color:'#fbbf24'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.gatesPassed>=12}/>}
    </GameShell>
  );
}
