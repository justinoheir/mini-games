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

const GAME_ID    = 'bead-catch';
const ACCENT     = '#a855f7';
const DURATION   = 30;
const GAME_EMOJI = '📿';
const GAME_TITLE = 'Bead Catch';
const GAME_TAGLINE = 'Slide the net. Catch the beads!';

// Mardi Gras colors: purple, green, gold
const BEAD_COLORS = ['#a855f7','#22c55e','#eab308','#d946ef','#4ade80','#fbbf24'];
const NET_W = 90;

interface Bead {
  x: number; y: number; vy: number; vx: number;
  r: number; color: string; isBad: boolean; // bad=bottle
  caught: boolean; missed: boolean; flashT: number;
}

interface Signals {
  beadsCaught: number;
  bottlesHit: number;
  maxCombo: number;
  comboCurrent: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.beadsCaught >= 20 && s.bottlesHit === 0) return 'Mardi Gras Queen 👑';
  if (s.maxCombo >= 8)                            return 'Bead Magnet 🧲';
  if (s.bottlesHit >= 5)                          return 'Party Crasher 🍾';
  if (s.beadsCaught >= 12)                        return 'Parade Pro 🎊';
  return 'Street Dancer 🎭';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  netX:number; targetNetX:number; beads:Bead[]; spawnTimer:number;
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
}

export default function BeadCatchGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{beadsCaught:0,bottlesHit:0,maxCombo:0,comboCurrent:0,score:0},
    frame:0,accentColor:ACCENT,
    netX:200,targetNetX:200,beads:[],spawnTimer:0,
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
    s.running=true; s.timeLeft=DURATION; s.frame=0;
    s.sig={beadsCaught:0,bottlesHit:0,maxCombo:0,comboCurrent:0,score:0};
    s.netX=W/2; s.targetNetX=W/2; s.beads=[]; s.spawnTimer=0; s.particles=[];
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;
      const NET_Y=H-60;

      // Mardi Gras background
      ctx.fillStyle='#1a0030'; ctx.fillRect(0,0,W,H);
      // Crowd cheering silhouette
      for(let i=0;i<10;i++){
        const hx=i*(W/10)+20, hy=H-25;
        ctx.fillStyle='rgba(255,200,100,0.08)';
        ctx.beginPath(); ctx.arc(hx,hy,16,Math.PI,0); ctx.fill();
      }
      // Street confetti
      for(let i=0;i<20;i++){
        const cx2=((i*173+s.frame*2)%W), cy2=((i*97+s.frame)%H);
        ctx.fillStyle=BEAD_COLORS[i%BEAD_COLORS.length]+'44';
        ctx.fillRect(cx2,cy2,4,6);
      }

      // Smooth net movement
      s.netX+=(s.targetNetX-s.netX)*0.2;
      s.netX=Math.max(NET_W/2+5,Math.min(W-NET_W/2-5,s.netX));

      // Spawn beads
      s.spawnTimer++;
      if(s.spawnTimer>=28){
        s.spawnTimer=0;
        const isBad=Math.random()<0.2;
        s.beads.push({
          x:20+Math.random()*(W-40), y:-20,
          vy:2.5+Math.random()*2, vx:(Math.random()-0.5)*1.5,
          r:isBad?14:10,
          color:isBad?'#94a3b8':BEAD_COLORS[Math.floor(Math.random()*BEAD_COLORS.length)],
          isBad, caught:false, missed:false, flashT:0
        });
      }

      // Update beads
      for(let i=s.beads.length-1;i>=0;i--){
        const b=s.beads[i];
        if(b.caught||b.missed){ b.flashT++; if(b.flashT>20) s.beads.splice(i,1); continue; }
        b.x+=b.vx; b.y+=b.vy;
        // Bounce off walls
        if(b.x<b.r||b.x>W-b.r) b.vx*=-1;
        // Check net catch
        if(b.y>=NET_Y-b.r&&b.y<=NET_Y+10&&Math.abs(b.x-s.netX)<=NET_W/2+b.r){
          if(b.isBad){
            b.caught=true; s.sig.bottlesHit++; s.sig.comboCurrent=0;
            sfx.collision(); hapticFail();
          } else {
            b.caught=true; s.sig.beadsCaught++; s.sig.comboCurrent++;
            if(s.sig.comboCurrent>s.sig.maxCombo) s.sig.maxCombo=s.sig.comboCurrent;
            const pts=s.sig.comboCurrent>=4?3:s.sig.comboCurrent>=2?2:1;
            s.sig.score+=pts; sfx.collect(); hapticScore();
            if(s.sig.comboCurrent>=4) hapticCombo(s.sig.comboCurrent);
            for(let p=0;p<8;p++) s.particles.push({
              x:b.x,y:NET_Y, vx:(Math.random()-0.5)*8, vy:-3-Math.random()*4,
              alpha:1, color:b.color
            });
            setScore(s.sig.score);
          }
        }
        if(b.y>H+10){ b.missed=true; if(!b.isBad) s.sig.comboCurrent=0; }
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.15; p.alpha*=0.9;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill(); ctx.restore();
      }

      // Draw beads
      s.beads.forEach(b=>{
        const fy=b.caught||b.missed;
        ctx.save();
        if(fy){ ctx.globalAlpha=1-(b.flashT/20); }
        ctx.shadowBlur=10; ctx.shadowColor=b.color;
        if(b.isBad){
          ctx.fillStyle=b.color; ctx.font=`${b.r*2}px sans-serif`; ctx.textAlign='center';
          ctx.fillText('🍾',b.x,b.y+b.r);
        } else {
          ctx.fillStyle=b.color;
          ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
          ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=2;
          ctx.beginPath(); ctx.arc(b.x-3,b.y-3,b.r*0.5,0,Math.PI*2); ctx.stroke();
        }
        ctx.restore();
      });

      // Draw net/basket
      ctx.save(); ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
      // Net top bar
      ctx.beginPath(); ctx.moveTo(s.netX-NET_W/2,NET_Y); ctx.lineTo(s.netX+NET_W/2,NET_Y); ctx.stroke();
      // Net mesh
      ctx.strokeStyle='#7c3aed88'; ctx.lineWidth=1.5;
      for(let nx=-NET_W/2;nx<=NET_W/2;nx+=15){
        ctx.beginPath(); ctx.moveTo(s.netX+nx,NET_Y); ctx.lineTo(s.netX,NET_Y+30); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(s.netX-NET_W/2,NET_Y+10); ctx.lineTo(s.netX+NET_W/2,NET_Y+10); ctx.stroke();
      ctx.restore();

      // Combo indicator
      if(s.sig.comboCurrent>=2){
        const a=0.7+Math.sin(s.frame*0.3)*0.3;
        ctx.save(); ctx.globalAlpha=a; ctx.fillStyle='#fbbf24';
        ctx.font='bold 15px sans-serif'; ctx.textAlign='center';
        ctx.fillText(`COMBO ×${s.sig.comboCurrent}!`,W/2,NET_Y-20); ctx.restore();
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
      s.targetNetX=(e.clientX-rect.left)*(canvas.width/rect.width);
    };
    const onPD=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current;
      const rect=canvas.getBoundingClientRect();
      s.targetNetX=(e.clientX-rect.left)*(canvas.width/rect.width);
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
        ctaLabel="Let the Beads Fall! 📿" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Mardi Gras bead catch canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Beads Caught',value:`${finalSig.beadsCaught}`,color:ACCENT},
          {label:'Bottles Hit',value:`${finalSig.bottlesHit}`,color:finalSig.bottlesHit===0?'#4ade80':'#ef4444'},
          {label:'Max Combo',value:`×${finalSig.maxCombo}`,color:'#fbbf24'},
          {label:'Final Score',value:`${finalSig.score}`,color:'#4ade80'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.beadsCaught>=15}/>}
    </GameShell>
  );
}
