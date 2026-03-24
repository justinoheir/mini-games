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

const GAME_ID    = 'lantern-float';
const ACCENT     = '#f97316';
const DURATION   = 45;
const GAME_EMOJI = '🏮';
const GAME_TITLE = 'Lantern Float';
const GAME_TAGLINE = 'Hold to fill. Release to launch!';

interface Lantern {
  x: number; y: number; vy: number; fill: number; // 0-100
  launched: boolean; reached: boolean; burned: boolean;
  color: string; alpha: number;
}

interface Signals {
  lanternsLaunched: number;
  lanternsReached: number;    // made it to the stars
  overcharged: number;        // released at >95% (burned)
  perfectLaunches: number;    // launched at 60-80% fill
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.perfectLaunches>=6&&s.overcharged===0) return 'Sky Lantern Guru 🌟';
  if (s.lanternsReached>=8)                    return 'Festival Master 🎆';
  if (s.overcharged>=4)                        return 'Too Eager! 🔥';
  if (s.lanternsReached>=4)                    return 'Night Sky Lover ✨';
  return 'First Launch 🕯️';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  lanterns:Lantern[]; currentLantern:Lantern|null;
  holding:boolean; holdStart:number;
  stars:Array<{x:number;y:number;alpha:number}>;
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
}

const LANTERN_COLORS=['#f97316','#ef4444','#fbbf24','#f472b6','#fb923c'];

function makeLantern(W:number,H:number): Lantern {
  return {
    x:W*0.2+Math.random()*W*0.6, y:H-80,
    vy:0, fill:0, launched:false, reached:false, burned:false,
    color:LANTERN_COLORS[Math.floor(Math.random()*LANTERN_COLORS.length)], alpha:1
  };
}

export default function LanternFloatGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{lanternsLaunched:0,lanternsReached:0,overcharged:0,perfectLaunches:0,score:0},
    frame:0,accentColor:ACCENT,
    lanterns:[],currentLantern:null,holding:false,holdStart:0,
    stars:[],particles:[],
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
    s.running=true; s.timeLeft=DURATION; s.frame=0; s.holding=false;
    s.sig={lanternsLaunched:0,lanternsReached:0,overcharged:0,perfectLaunches:0,score:0};
    s.lanterns=[]; s.particles=[];
    // Generate stars
    s.stars=Array.from({length:60},()=>({x:Math.random()*W,y:Math.random()*(H*0.4),alpha:0.4+Math.random()*0.6}));
    s.currentLantern=makeLantern(W,H);
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
    },1000);

    const TARGET_Y=H*0.2;

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;

      // Night sky
      const skyGrad=ctx.createLinearGradient(0,0,0,H);
      skyGrad.addColorStop(0,'#050020');
      skyGrad.addColorStop(0.5,'#0a0035');
      skyGrad.addColorStop(1,'#1a0020');
      ctx.fillStyle=skyGrad; ctx.fillRect(0,0,W,H);

      // Stars
      s.stars.forEach(st=>{
        const twinkle=st.alpha*(0.6+Math.sin(s.frame*0.05+st.x)*0.4);
        ctx.fillStyle=`rgba(255,255,200,${twinkle})`;
        ctx.beginPath(); ctx.arc(st.x,st.y,1.2,0,Math.PI*2); ctx.fill();
      });

      // Target zone at top
      ctx.save(); ctx.globalAlpha=0.2;
      const tg=ctx.createLinearGradient(0,TARGET_Y-30,0,TARGET_Y+10);
      tg.addColorStop(0,'transparent'); tg.addColorStop(0.5,'#fbbf24'); tg.addColorStop(1,'transparent');
      ctx.fillStyle=tg; ctx.fillRect(0,TARGET_Y-30,W,40); ctx.restore();
      ctx.strokeStyle='rgba(251,191,36,0.4)'; ctx.lineWidth=1; ctx.setLineDash([6,6]);
      ctx.beginPath(); ctx.moveTo(0,TARGET_Y); ctx.lineTo(W,TARGET_Y); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle='rgba(251,191,36,0.5)'; ctx.font='11px sans-serif';
      ctx.textAlign='center'; ctx.fillText('✨ Stars ✨',W/2,TARGET_Y-8);

      // Fill gauge display (if holding)
      if(s.holding&&s.currentLantern){
        const elapsed=(Date.now()-s.holdStart)/3000;
        s.currentLantern.fill=Math.min(100,elapsed*100);
        const gaugePct=s.currentLantern.fill/100;
        const gaugeColor=gaugePct<0.6?'#4ade80':gaugePct<0.8?'#fbbf24':gaugePct<0.95?'#f97316':'#ef4444';
        const gx=20,gy=H-40,gw=W-40,gh=12;
        ctx.fillStyle='rgba(255,255,255,0.1)'; ctx.fillRect(gx,gy,gw,gh);
        ctx.fillStyle=gaugeColor; ctx.fillRect(gx,gy,gw*gaugePct,gh);
        ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=1; ctx.strokeRect(gx,gy,gw,gh);
        ctx.fillStyle='#fff'; ctx.font='11px sans-serif'; ctx.textAlign='center';
        ctx.fillText(gaugePct<0.6?'Keep holding…':gaugePct<0.8?'Ready to release!':gaugePct<0.95?'Getting hot!':'RELEASE NOW!',W/2,gy-5);
      }

      // Current lantern (not yet launched)
      if(s.currentLantern&&!s.currentLantern.launched){
        const l=s.currentLantern;
        const glow=s.holding?(l.fill/100)*20:4;
        drawLantern(ctx,l.x,l.y,l.color,l.fill,glow,s.frame);
        if(!s.holding){
          const a=0.6+Math.sin(s.frame*0.15)*0.4;
          ctx.save(); ctx.globalAlpha=a; ctx.fillStyle='#fbbf24';
          ctx.font='bold 14px sans-serif'; ctx.textAlign='center';
          ctx.fillText('Hold to fill 🏮',l.x,l.y-50); ctx.restore();
        }
      }

      // Flying lanterns
      for(let i=s.lanterns.length-1;i>=0;i--){
        const l=s.lanterns[i];
        if(l.burned){ l.alpha*=0.9; if(l.alpha<0.05){ s.lanterns.splice(i,1); } continue; }
        l.y+=l.vy;
        if(!l.reached&&l.y<=TARGET_Y){
          l.reached=true; l.vy=0.3; // drift slowly
          s.sig.lanternsReached++;
          const pts=s.sig.sig_perfectLaunch?3:2;
          s.sig.score+=2; sfx.success(); hapticScore();
          setScore(s.sig.score);
          for(let p=0;p<12;p++) s.particles.push({
            x:l.x,y:l.y, vx:(Math.random()-0.5)*10, vy:(Math.random()-0.5)*10,
            alpha:1, color:l.color
          });
        }
        if(l.y<-100){ s.lanterns.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=l.alpha;
        drawLantern(ctx,l.x,l.y,l.color,100,l.reached?8:12,s.frame);
        ctx.restore();
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.alpha*=0.92;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill(); ctx.restore();
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  function drawLantern(ctx:CanvasRenderingContext2D,x:number,y:number,color:string,fill:number,glow:number,frame:number){
    ctx.save(); ctx.shadowBlur=glow; ctx.shadowColor=color;
    // Lantern body
    ctx.fillStyle=color+'cc';
    ctx.beginPath();
    ctx.roundRect(x-16,y-28,32,40,8);
    ctx.fill();
    // Inner glow based on fill
    const innerAlpha=fill/200;
    ctx.fillStyle=`rgba(255,230,150,${innerAlpha})`;
    ctx.beginPath(); ctx.ellipse(x,y-8,10,14,0,0,Math.PI*2); ctx.fill();
    // Flame effect
    if(fill>20){
      const flicker=Math.sin(frame*0.3+x)*2;
      ctx.fillStyle='rgba(255,200,0,0.8)';
      ctx.beginPath(); ctx.ellipse(x,y-32+flicker,4,6,0,0,Math.PI*2); ctx.fill();
    }
    // String
    ctx.strokeStyle=color+'88'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x,y+12); ctx.lineTo(x,y+22); ctx.stroke();
    ctx.restore();
  }

  const launchLantern = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const s=stateRef.current; if(!s.holding||!s.currentLantern) return;
    s.holding=false;
    const l=s.currentLantern; const fill=l.fill;
    l.launched=true;

    if(fill>=95){
      // Overcharged!
      l.burned=true; s.sig.overcharged++; sfx.collision(); hapticFail();
    } else {
      const speed=fill/100*5+1;
      l.vy=-speed;
      const perfect=fill>=60&&fill<=80;
      if(perfect){ s.sig.perfectLaunches++; hapticCombo(3); sfx.success(); }
      else { sfx.collect(); hapticScore(); }
      s.sig.lanternsLaunched++;
      s.lanterns.push(l);
    }
    // Spawn next
    setTimeout(()=>{ if(s.running) s.currentLantern=makeLantern(canvas.width,canvas.height); },600);
  },[]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);

    const onPD=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; if(!s.currentLantern||s.currentLantern.launched) return;
      s.holding=true; s.holdStart=Date.now();
    };
    const onPU=()=>{ if(phase==='playing') launchLantern(); };

    canvas.addEventListener('pointerdown',onPD);
    canvas.addEventListener('pointerup',onPU);
    return()=>{ window.removeEventListener('resize',resize);
      canvas.removeEventListener('pointerdown',onPD); canvas.removeEventListener('pointerup',onPU); };
  },[phase,launchLantern]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Float to the Stars 🌟" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Lantern floating game canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Launched',value:`${finalSig.lanternsLaunched}`,color:ACCENT},
          {label:'Reached Stars',value:`${finalSig.lanternsReached}`,color:'#4ade80'},
          {label:'Perfect',value:`${finalSig.perfectLaunches}`,color:'#fbbf24'},
          {label:'Overcharged',value:`${finalSig.overcharged}`,color:finalSig.overcharged===0?'#4ade80':'#ef4444'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.lanternsReached>=6}/>}
    </GameShell>
  );
}
