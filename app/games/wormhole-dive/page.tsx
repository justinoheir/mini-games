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

const GAME_ID    = 'wormhole-dive';
const ACCENT     = '#7c3aed';
const DURATION   = 60;
const GAME_EMOJI = '🌀';
const GAME_TITLE = 'Wormhole Dive';
const GAME_TAGLINE = 'Survive the warp. Keep diving.';

interface Ring { z:number; x:number; y:number; r:number; gap:number; color:string; passed:boolean; }

interface Signals {
  ringsHit: number;   // passed through ring
  ringsMissed: number;
  closePasses: number; // passed within 20% of ring center
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.ringsHit>=30&&s.closePasses>=10) return 'Wormhole Ace 🌟';
  if (s.ringsHit>=25)                    return 'Space Diver 🚀';
  if (s.ringsMissed>=10)                 return 'Wall Kisser 💥';
  if (s.maxStreak>=12)                   return 'Tunnel Vision 🎯';
  return 'Deep Space Cadet 🪐';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  shipX:number; shipY:number; targetX:number; targetY:number;
  rings:Ring[]; ringTimer:number; speed:number;
  stars:Array<{x:number;y:number;z:number}>;
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
  shakeX:number; shakeY:number;
}

const RING_COLORS=['#7c3aed','#a855f7','#00ffff','#818cf8','#c084fc'];

export default function WormholeDiveGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{ringsHit:0,ringsMissed:0,closePasses:0,maxStreak:0,streakCurrent:0,score:0},
    frame:0,accentColor:ACCENT,
    shipX:200,shipY:300,targetX:200,targetY:300,
    rings:[],ringTimer:0,speed:3,
    stars:[],particles:[],shakeX:0,shakeY:0,
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
    s.running=true; s.timeLeft=DURATION; s.frame=0; s.speed=3;
    s.sig={ringsHit:0,ringsMissed:0,closePasses:0,maxStreak:0,streakCurrent:0,score:0};
    s.shipX=W/2; s.shipY=H/2; s.targetX=W/2; s.targetY=H/2;
    s.rings=[]; s.ringTimer=0; s.particles=[];
    s.stars=Array.from({length:80},()=>({x:Math.random()*W,y:Math.random()*H,z:Math.random()*200+50}));
    s.shakeX=0; s.shakeY=0;
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
      if([45,30,15].includes(s.timeLeft)) s.speed+=0.5;
    },1000);

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;

      // Deep space background
      ctx.fillStyle='#030010'; ctx.fillRect(0,0,W,H);

      // Wormhole tunnel effect (concentric ellipses)
      for(let i=0;i<8;i++){
        const r=((s.frame*2+i*30)%240);
        const alpha=1-r/240; const wr=r*(W/300), hr=r*(H/300);
        ctx.save(); ctx.globalAlpha=alpha*0.15;
        ctx.strokeStyle='#7c3aed'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.ellipse(W/2,H/2,wr,hr,0,0,Math.PI*2); ctx.stroke();
        ctx.restore();
      }

      // Moving stars (parallax)
      s.stars.forEach(st=>{
        st.z-=s.speed*0.5; if(st.z<1) st.z=200;
        const px=W/2+(st.x-W/2)*(100/st.z), py=H/2+(st.y-H/2)*(100/st.z);
        const r=Math.max(0.5,(1-st.z/200)*3);
        const alpha=1-st.z/200;
        if(px<0||px>W||py<0||py>H) return;
        ctx.fillStyle=`rgba(200,180,255,${alpha*0.8})`; ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fill();
      });

      // Spawn rings
      s.ringTimer++;
      if(s.ringTimer>=55){
        s.ringTimer=0;
        const r=Math.min(W,H)*0.35;
        const gap=r*(0.35+Math.random()*0.2);
        s.rings.push({
          z:500, x:W*0.15+Math.random()*W*0.7, y:H*0.15+Math.random()*H*0.7,
          r, gap, color:RING_COLORS[s.rings.length%RING_COLORS.length], passed:false
        });
      }

      // Move ship toward target
      s.shipX+=(s.targetX-s.shipX)*0.12;
      s.shipY+=(s.targetY-s.shipY)*0.12;

      // Apply shake
      s.shakeX*=0.8; s.shakeY*=0.8;

      // Update and draw rings
      for(let i=s.rings.length-1;i>=0;i--){
        const ring=s.rings[i];
        ring.z-=s.speed;
        if(ring.z<0){ s.rings.splice(i,1); continue; }

        const scale=Math.max(0.01,1-ring.z/500);
        const rx=ring.x; const ry=ring.y;
        const displayR=ring.r*scale;
        const displayGap=ring.gap*scale;
        const alpha=Math.min(1,scale*3);

        // Draw ring (outer edge = wall, gap = passage)
        ctx.save(); ctx.globalAlpha=alpha;
        ctx.strokeStyle=ring.color; ctx.lineWidth=8*scale+2;
        ctx.shadowBlur=20*scale; ctx.shadowColor=ring.color;
        ctx.beginPath(); ctx.arc(rx,ry,displayR+displayGap*0.5+4,0,Math.PI*2); ctx.stroke();
        ctx.restore();

        // Ring hole
        ctx.save(); ctx.globalAlpha=alpha*0.3;
        ctx.fillStyle='rgba(0,0,30,0.5)';
        ctx.beginPath(); ctx.arc(rx,ry,displayGap*0.5,0,Math.PI*2); ctx.fill();
        ctx.restore();

        // Check pass-through
        const shipDist=Math.hypot(s.shipX+s.shakeX-rx, s.shipY+s.shakeY-ry);
        if(!ring.passed&&ring.z<10&&ring.z>-10){
          ring.passed=true;
          if(shipDist<=displayGap*0.5){
            s.sig.ringsHit++; s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
            const center=shipDist<displayGap*0.2;
            if(center) s.sig.closePasses++;
            const pts=center?3:s.sig.streakCurrent>=4?2:1;
            s.sig.score+=pts; sfx.collect(); hapticScore();
            if(s.sig.streakCurrent>=4) hapticCombo(s.sig.streakCurrent);
            setScore(s.sig.score);
            for(let p=0;p<8;p++) s.particles.push({
              x:s.shipX,y:s.shipY, vx:(Math.random()-0.5)*8, vy:(Math.random()-0.5)*8,
              alpha:1, color:ring.color
            });
          } else {
            s.sig.ringsMissed++; s.sig.streakCurrent=0;
            s.shakeX=(Math.random()-0.5)*12; s.shakeY=(Math.random()-0.5)*12;
            sfx.collision(); hapticFail();
          }
        }
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.alpha*=0.9;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill(); ctx.restore();
      }

      // Draw ship
      const sx=s.shipX+s.shakeX, sy=s.shipY+s.shakeY;
      ctx.save(); ctx.shadowBlur=16; ctx.shadowColor='#a855f7';
      ctx.fillStyle='#818cf8';
      ctx.beginPath();
      ctx.moveTo(sx,sy-12); ctx.lineTo(sx-8,sy+10); ctx.lineTo(sx+8,sy+10); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#c084fc';
      ctx.beginPath(); ctx.arc(sx,sy-2,5,0,Math.PI*2); ctx.fill();
      ctx.restore();

      // Speed indicator
      const sp=Math.round((s.speed-3)/0.5);
      if(sp>0){
        ctx.fillStyle='rgba(160,100,255,0.6)'; ctx.font='12px sans-serif'; ctx.textAlign='right';
        ctx.fillText(`Warp ${sp+1}`,W-10,30);
      }

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
      const s=stateRef.current;
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
        ctaLabel="Enter the Wormhole 🌀" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Wormhole diving game canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Rings Hit',value:`${finalSig.ringsHit}`,color:'#4ade80'},
          {label:'Missed',value:`${finalSig.ringsMissed}`,color:finalSig.ringsMissed===0?'#4ade80':'#ef4444'},
          {label:'Close Passes',value:`${finalSig.closePasses}`,color:ACCENT},
          {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.ringsHit>=20}/>}
    </GameShell>
  );
}
