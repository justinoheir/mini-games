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

const GAME_ID    = 'dream-catch';
const ACCENT     = '#818cf8';
const DURATION   = 60;
const GAME_EMOJI = '🌙';
const GAME_TITLE = 'Dream Catch';
const GAME_TAGLINE = 'Float through. Catch the fragments.';

// Dream fragment types
type FragType = 'star'|'moon'|'cloud'|'feather'|'bubble';
const FRAG_CONFIG: Record<FragType,{emoji:string;pts:number;color:string;rare:boolean}> = {
  star:    {emoji:'⭐',pts:3,color:'#fbbf24',rare:true},
  moon:    {emoji:'🌙',pts:2,color:'#818cf8',rare:false},
  cloud:   {emoji:'☁️',pts:1,color:'#94a3b8',rare:false},
  feather: {emoji:'🪶',pts:2,color:'#a5f3fc',rare:false},
  bubble:  {emoji:'🫧',pts:1,color:'#7dd3fc',rare:false},
};
const FRAG_TYPES: FragType[] = ['star','moon','cloud','feather','bubble'];

interface Fragment {
  id:number; type:FragType; x:number; y:number;
  vx:number; vy:number; alpha:number; r:number;
  age:number; lifespan:number; caught:boolean; flashT:number;
}

interface Signals {
  fragmentsCaught: number;
  starsCaught: number;
  missed: number;
  maxStreak: number;
  streakCurrent: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.starsCaught>=8&&s.missed<=3) return 'Dream Weaver 🌟';
  if (s.fragmentsCaught>=25)         return 'Night Collector 🌙';
  if (s.missed>=15)                  return 'Heavy Sleeper 😴';
  if (s.maxStreak>=8)                return 'Lucid Dreamer ✨';
  return 'Dream Walker 🌀';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  frags:Fragment[]; nextId:number; spawnTimer:number;
  catcher:{x:number;y:number}; // dreamcatcher position (follows touch)
  targetCatcher:{x:number;y:number};
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string;emoji:string}>;
  nebula:Array<{x:number;y:number;r:number;color:string;alpha:number}>;
}

export default function DreamCatchGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{fragmentsCaught:0,starsCaught:0,missed:0,maxStreak:0,streakCurrent:0,score:0},
    frame:0,accentColor:ACCENT,
    frags:[],nextId:0,spawnTimer:0,
    catcher:{x:200,y:300},targetCatcher:{x:200,y:300},
    particles:[],nebula:[],
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
    s.sig={fragmentsCaught:0,starsCaught:0,missed:0,maxStreak:0,streakCurrent:0,score:0};
    s.frags=[]; s.nextId=0; s.spawnTimer=0;
    s.catcher={x:W/2,y:H/2}; s.targetCatcher={x:W/2,y:H/2};
    s.particles=[];
    // Generate nebula clouds
    s.nebula=Array.from({length:8},()=>({
      x:Math.random()*W, y:Math.random()*H,
      r:50+Math.random()*80, color:`hsl(${220+Math.random()*60},70%,${15+Math.random()*10}%)`,
      alpha:0.15+Math.random()*0.1
    }));
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;

      // Deep dream sky
      const grad=ctx.createLinearGradient(0,0,0,H);
      grad.addColorStop(0,'#050118');
      grad.addColorStop(0.5,'#0d0530');
      grad.addColorStop(1,'#180845');
      ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);

      // Nebula
      s.nebula.forEach(n=>{
        n.x+=Math.sin(s.frame*0.008+n.r)*0.2;
        n.y+=Math.cos(s.frame*0.006+n.r)*0.15;
        const g=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r);
        g.addColorStop(0,`rgba(100,80,200,${n.alpha})`);
        g.addColorStop(1,'transparent');
        ctx.fillStyle=g; ctx.fillRect(n.x-n.r,n.y-n.r,n.r*2,n.r*2);
      });

      // Floating star dust
      for(let i=0;i<80;i++){
        const sx=((i*173+s.frame*0.3)%W), sy=((i*97+s.frame*0.2)%H);
        const a=0.15+Math.sin(s.frame*0.05+i)*0.1;
        ctx.fillStyle=`rgba(200,180,255,${a})`;
        ctx.beginPath(); ctx.arc(sx,sy,0.8,0,Math.PI*2); ctx.fill();
      }

      // Smooth catcher movement
      s.catcher.x+=(s.targetCatcher.x-s.catcher.x)*0.12;
      s.catcher.y+=(s.targetCatcher.y-s.catcher.y)*0.12;

      // Spawn fragments
      s.spawnTimer++;
      if(s.spawnTimer>=35){
        s.spawnTimer=0;
        const type=FRAG_TYPES[Math.random()<0.15?0:Math.floor(Math.random()*FRAG_TYPES.length)];
        const edge=Math.floor(Math.random()*4);
        let x=0,y=0,vx=0,vy=0;
        const sp=0.8+Math.random()*1.2;
        if(edge===0){x=Math.random()*W;y=-30;vx=(Math.random()-0.5)*sp;vy=sp;}
        else if(edge===1){x=W+30;y=Math.random()*H;vx=-sp;vy=(Math.random()-0.5)*sp;}
        else if(edge===2){x=Math.random()*W;y=H+30;vx=(Math.random()-0.5)*sp;vy=-sp;}
        else{x=-30;y=Math.random()*H;vx=sp;vy=(Math.random()-0.5)*sp;}
        s.frags.push({id:s.nextId++,type,x,y,vx,vy,alpha:0,r:20,age:0,lifespan:300+Math.random()*200,caught:false,flashT:0});
      }

      // Update fragments
      for(let i=s.frags.length-1;i>=0;i--){
        const f=s.frags[i];
        if(f.caught){ f.flashT++; if(f.flashT>20) s.frags.splice(i,1); continue; }
        f.age++; f.x+=f.vx; f.y+=f.vy;
        // Gentle drift toward center
        f.vx+=(W/2-f.x)*0.0003; f.vy+=(H/2-f.y)*0.0003;
        f.alpha=Math.min(1,f.age/30)*Math.max(0,1-(f.age-f.lifespan+30)/30);
        if(f.age>f.lifespan){
          s.sig.missed++; s.sig.streakCurrent=0;
          s.frags.splice(i,1); continue;
        }
        // Check catch
        const dist=Math.hypot(f.x-s.catcher.x,f.y-s.catcher.y);
        if(dist<=36){
          f.caught=true; const cfg=FRAG_CONFIG[f.type];
          s.sig.fragmentsCaught++; s.sig.streakCurrent++;
          if(f.type==='star') s.sig.starsCaught++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          const mult=s.sig.streakCurrent>=5?2:1;
          s.sig.score+=cfg.pts*mult; setScore(s.sig.score);
          if(cfg.rare){ sfx.success(); hapticCombo(3); }
          else { sfx.collect(); hapticScore(); }
          if(s.sig.streakCurrent>=5) hapticCombo(s.sig.streakCurrent);
          for(let p=0;p<8;p++) s.particles.push({
            x:f.x,y:f.y, vx:(Math.random()-0.5)*6, vy:(Math.random()-0.5)*6,
            alpha:1, color:cfg.color, emoji:cfg.emoji
          });
        }
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.alpha*=0.9;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.font='14px sans-serif'; ctx.textAlign='center';
        ctx.fillText(p.emoji,p.x,p.y); ctx.restore();
      }

      // Draw fragments
      s.frags.forEach(f=>{
        const cfg=FRAG_CONFIG[f.type];
        const wave=Math.sin(s.frame*0.08+f.id)*3;
        ctx.save(); ctx.globalAlpha=f.caught?1-f.flashT/20:f.alpha;
        if(cfg.rare){ ctx.shadowBlur=20; ctx.shadowColor=cfg.color; }
        ctx.font=`${f.r*1.5}px sans-serif`; ctx.textAlign='center';
        ctx.fillText(cfg.emoji,f.x+wave,f.y);
        ctx.restore();
      });

      // Draw dreamcatcher
      const catchR=32;
      ctx.save();
      ctx.shadowBlur=20; ctx.shadowColor='#818cf8';
      // Outer ring
      ctx.strokeStyle='#818cf8'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(s.catcher.x,s.catcher.y,catchR,0,Math.PI*2); ctx.stroke();
      // Web pattern
      ctx.strokeStyle='rgba(129,140,248,0.5)'; ctx.lineWidth=1;
      for(let k=0;k<6;k++){
        const angle=s.frame*0.02+k*Math.PI/3;
        ctx.beginPath();
        ctx.moveTo(s.catcher.x,s.catcher.y);
        ctx.lineTo(s.catcher.x+Math.cos(angle)*catchR,s.catcher.y+Math.sin(angle)*catchR);
        ctx.stroke();
      }
      // Inner gem
      ctx.fillStyle='rgba(129,140,248,0.6)';
      ctx.beginPath(); ctx.arc(s.catcher.x,s.catcher.y,8,0,Math.PI*2); ctx.fill();
      // Feathers
      for(let k=0;k<3;k++){
        const fx=s.catcher.x+(k-1)*12, fy=s.catcher.y+catchR+3+Math.sin(s.frame*0.1+k)*4;
        ctx.strokeStyle='rgba(129,140,248,0.6)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(fx,s.catcher.y+catchR); ctx.lineTo(fx,fy+12); ctx.stroke();
      }
      ctx.restore();

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);

    const update=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current;
      const rect=canvas.getBoundingClientRect();
      s.targetCatcher.x=(e.clientX-rect.left)*(canvas.width/rect.width);
      s.targetCatcher.y=(e.clientY-rect.top)*(canvas.height/rect.height);
    };
    canvas.addEventListener('pointermove',update);
    canvas.addEventListener('pointerdown',update);
    return()=>{ window.removeEventListener('resize',resize);
      canvas.removeEventListener('pointermove',update); canvas.removeEventListener('pointerdown',update); };
  },[phase]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Enter the Dreamscape 🌙" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Dream catching game canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Caught',value:`${finalSig.fragmentsCaught}`,color:'#4ade80'},
          {label:'Stars',value:`${finalSig.starsCaught}`,color:'#fbbf24'},
          {label:'Missed',value:`${finalSig.missed}`,color:finalSig.missed===0?'#4ade80':'#ef4444'},
          {label:'Best Streak',value:`×${finalSig.maxStreak}`,color:ACCENT},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.fragmentsCaught>=20}/>}
    </GameShell>
  );
}
