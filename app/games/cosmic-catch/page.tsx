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

const GAME_ID    = 'cosmic-catch';
const ACCENT     = '#6366f1';
const DURATION   = 30;
const GAME_EMOJI = '⭐';
const GAME_TITLE = 'Cosmic Catch';
const GAME_TAGLINE = 'Swipe the stars before they fade.';

type StarType = 'common'|'rare'|'super';
const STAR_CONFIG: Record<StarType,{pts:number;color:string;r:number}> = {
  common: {pts:1,color:'#a5b4fc',r:14},
  rare:   {pts:3,color:'#fbbf24',r:20},
  super:  {pts:5,color:'#f472b6',r:28},
};

interface Star {
  id:number; type:StarType; x:number; y:number;
  vx:number; vy:number; alpha:number; lifespan:number; age:number;
  caught:boolean; flashT:number;
  twinkle:number; // phase offset
}

interface Signals {
  starsCaught: number;
  raresCaught: number;
  supersCaught: number;
  missed: number;
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.supersCaught>=3&&s.raresCaught>=5) return 'Cosmic Champion 🌌';
  if (s.starsCaught>=20)                   return 'Star Collector ⭐';
  if (s.missed>=10)                        return 'Too Slow! 🐢';
  if (s.maxStreak>=8)                      return 'Constellation King 👑';
  return 'Space Cadet 🚀';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  stars:Star[]; nextId:number; spawnTimer:number;
  swipeTrail:Array<{x:number;y:number;alpha:number}>;
  lastSwipeX:number; lastSwipeY:number; swiping:boolean;
  nebula:Array<{x:number;y:number;r:number;alpha:number;hue:number}>;
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
}

export default function CosmicCatchGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{starsCaught:0,raresCaught:0,supersCaught:0,missed:0,maxStreak:0,streakCurrent:0,score:0},
    frame:0,accentColor:ACCENT,
    stars:[],nextId:0,spawnTimer:0,
    swipeTrail:[],lastSwipeX:0,lastSwipeY:0,swiping:false,
    nebula:[],particles:[],
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
    s.sig={starsCaught:0,raresCaught:0,supersCaught:0,missed:0,maxStreak:0,streakCurrent:0,score:0};
    s.stars=[]; s.nextId=0; s.spawnTimer=0; s.swipeTrail=[]; s.swiping=false;
    s.particles=[];
    s.nebula=Array.from({length:6},()=>({
      x:Math.random()*W, y:Math.random()*H,
      r:80+Math.random()*100, alpha:0.08+Math.random()*0.06,
      hue:200+Math.random()*80
    }));
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;

      // Deep space background
      ctx.fillStyle='#02040f'; ctx.fillRect(0,0,W,H);

      // Nebula clouds
      s.nebula.forEach(n=>{
        n.x+=Math.sin(s.frame*0.004+n.hue)*0.2;
        n.y+=Math.cos(s.frame*0.003+n.hue)*0.1;
        const g=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r);
        g.addColorStop(0,`hsla(${n.hue},70%,30%,${n.alpha})`);
        g.addColorStop(1,'transparent');
        ctx.fillStyle=g; ctx.fillRect(n.x-n.r,n.y-n.r,n.r*2,n.r*2);
      });

      // Background stars (static)
      for(let i=0;i<100;i++){
        const bsx=((i*173+29)%W), bsy=((i*97+13)%H);
        const ba=0.1+Math.sin(s.frame*0.03+i)*0.05;
        ctx.fillStyle=`rgba(200,210,255,${ba})`; ctx.beginPath();
        ctx.arc(bsx,bsy,0.7,0,Math.PI*2); ctx.fill();
      }

      // Spawn stars
      s.spawnTimer++;
      const spawnRate=s.sig.streakCurrent>=5?18:22;
      if(s.spawnTimer>=spawnRate){
        s.spawnTimer=0;
        const roll=Math.random();
        const type:StarType=roll<0.04?'super':roll<0.2?'rare':'common';
        // Stars appear in patterns: spiral from center or crossing paths
        const angle=Math.random()*Math.PI*2;
        const dist=W*0.35+Math.random()*W*0.15;
        const x=W/2+Math.cos(angle)*dist*(0.5+Math.random()*0.5);
        const y=H/2+Math.sin(angle)*dist*(0.5+Math.random()*0.5);
        // Move toward center slightly
        const speed=0.4+Math.random()*0.6;
        const vx=-Math.cos(angle)*speed*0.3+(Math.random()-0.5)*speed;
        const vy=-Math.sin(angle)*speed*0.3+(Math.random()-0.5)*speed;
        s.stars.push({id:s.nextId++,type,x:Math.max(30,Math.min(W-30,x)),y:Math.max(30,Math.min(H-30,y)),
          vx,vy,alpha:0,lifespan:180+Math.random()*120,age:0,caught:false,flashT:0,
          twinkle:Math.random()*Math.PI*2});
      }

      // Update swipe trail
      for(let i=s.swipeTrail.length-1;i>=0;i--){
        const t=s.swipeTrail[i]; t.alpha*=0.85;
        if(t.alpha<0.02) s.swipeTrail.splice(i,1);
      }

      // Draw swipe trail
      if(s.swipeTrail.length>1){
        ctx.save(); ctx.strokeStyle=ACCENT; ctx.lineWidth=3; ctx.lineCap='round';
        ctx.beginPath(); s.swipeTrail.forEach((t,i)=>{
          ctx.globalAlpha=t.alpha; i===0?ctx.moveTo(t.x,t.y):ctx.lineTo(t.x,t.y);
        }); ctx.stroke(); ctx.restore();
      }

      // Update and draw stars
      for(let i=s.stars.length-1;i>=0;i--){
        const st=s.stars[i];
        if(st.caught){ st.flashT++; if(st.flashT>18) s.stars.splice(i,1); continue; }
        st.age++; st.x+=st.vx; st.y+=st.vy;
        // Fade in and out
        st.alpha=Math.min(1,st.age/30)*Math.max(0,1-(st.age-st.lifespan+30)/30);
        if(st.age>st.lifespan){ s.sig.missed++; s.sig.streakCurrent=0; s.stars.splice(i,1); continue; }

        const cfg=STAR_CONFIG[st.type];
        const twinkleA=st.alpha*(0.7+Math.sin(s.frame*0.15+st.twinkle)*0.3);

        ctx.save(); ctx.globalAlpha=st.caught?1-st.flashT/18:twinkleA;
        ctx.shadowBlur=cfg.r*1.5; ctx.shadowColor=cfg.color;
        // Draw 5-pointed star
        ctx.fillStyle=cfg.color;
        ctx.beginPath();
        for(let k=0;k<10;k++){
          const r=k%2===0?cfg.r:cfg.r*0.45;
          const a=k*Math.PI/5-Math.PI/2;
          k===0?ctx.moveTo(st.x+r*Math.cos(a),st.y+r*Math.sin(a)):
                ctx.lineTo(st.x+r*Math.cos(a),st.y+r*Math.sin(a));
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.alpha*=0.9;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill(); ctx.restore();
      }

      // Streak indicator
      if(s.sig.streakCurrent>=3){
        const a=0.6+Math.sin(s.frame*0.2)*0.4;
        ctx.save(); ctx.globalAlpha=a; ctx.fillStyle='#fbbf24';
        ctx.font='bold 14px sans-serif'; ctx.textAlign='center';
        ctx.fillText(`STREAK ×${s.sig.streakCurrent}! ⭐`,W/2,H-20); ctx.restore();
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  const catchAtPoint = useCallback((x:number,y:number)=>{
    const s=stateRef.current; if(!s.running) return;
    for(const st of s.stars){
      if(st.caught) continue;
      const cfg=STAR_CONFIG[st.type];
      if(Math.hypot(x-st.x,y-st.y)<=cfg.r+8){
        st.caught=true;
        s.sig.starsCaught++; s.sig.streakCurrent++;
        if(st.type==='rare') s.sig.raresCaught++;
        if(st.type==='super') s.sig.supersCaught++;
        if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
        const mult=s.sig.streakCurrent>=4?2:1;
        const pts=cfg.pts*mult; s.sig.score+=pts;
        setScore(s.sig.score);
        if(st.type==='super'){ sfx.success(); hapticCombo(5); }
        else if(st.type==='rare'){ sfx.collect(); hapticCombo(3); }
        else { sfx.click(); hapticScore(); }
        for(let p=0;p<8;p++) s.particles.push({
          x:st.x,y:st.y, vx:(Math.random()-0.5)*10, vy:(Math.random()-0.5)*10,
          alpha:1, color:cfg.color
        });
      }
    }
  },[]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);

    const getXY=(e:PointerEvent)=>{
      const rect=canvas.getBoundingClientRect();
      return {x:(e.clientX-rect.left)*(canvas.width/rect.width),y:(e.clientY-rect.top)*(canvas.height/rect.height)};
    };

    const onPD=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; const {x,y}=getXY(e);
      s.swiping=true; s.lastSwipeX=x; s.lastSwipeY=y;
      s.swipeTrail.push({x,y,alpha:0.8});
      catchAtPoint(x,y);
    };
    const onPM=(e:PointerEvent)=>{
      if(phase!=='playing'||!(e.buttons>0)) return;
      const s=stateRef.current; const {x,y}=getXY(e);
      s.swipeTrail.push({x,y,alpha:0.8});
      if(s.swipeTrail.length>20) s.swipeTrail.shift();
      // Catch along swipe path
      const dx=x-s.lastSwipeX, dy=y-s.lastSwipeY;
      const steps=Math.ceil(Math.hypot(dx,dy)/12)+1;
      for(let t=0;t<=steps;t++) catchAtPoint(s.lastSwipeX+dx*(t/steps),s.lastSwipeY+dy*(t/steps));
      s.lastSwipeX=x; s.lastSwipeY=y;
    };
    const onPU=()=>{ stateRef.current.swiping=false; };

    canvas.addEventListener('pointerdown',onPD);
    canvas.addEventListener('pointermove',onPM);
    canvas.addEventListener('pointerup',onPU);
    return()=>{ window.removeEventListener('resize',resize);
      canvas.removeEventListener('pointerdown',onPD); canvas.removeEventListener('pointermove',onPM);
      canvas.removeEventListener('pointerup',onPU); };
  },[phase,catchAtPoint]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Launch Into Space 🚀" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Cosmic star catching canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Stars Caught',value:`${finalSig.starsCaught}`,color:'#a5b4fc'},
          {label:'Rare ⭐',value:`${finalSig.raresCaught}`,color:'#fbbf24'},
          {label:'Super 🌟',value:`${finalSig.supersCaught}`,color:'#f472b6'},
          {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:ACCENT},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.starsCaught>=15}/>}
    </GameShell>
  );
}
