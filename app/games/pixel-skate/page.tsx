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

const GAME_ID    = 'pixel-skate';
const ACCENT     = '#10b981';
const DURATION   = 45;
const GAME_EMOJI = '🛹';
const GAME_TITLE = 'Pixel Skate';
const GAME_TAGLINE = 'Flick tricks. Stack the combo.';

// Trick system: swipe direction → trick name
type TrickInput = 'up'|'down'|'left'|'right';
const TRICKS: Record<TrickInput,{name:string;pts:number}> = {
  up:    {name:'Kickflip',pts:2},
  down:  {name:'Grind',pts:3},
  left:  {name:'Heelflip',pts:2},
  right: {name:'360 Flip',pts:4},
};

interface Obstacle { x:number; type:'ramp'|'rail'|'gap'|'cone'; passed:boolean; }

interface Signals {
  tricksLanded: number;
  crashes: number;
  maxCombo: number;
  comboCurrent: number;
  totalPoints: number;
  score: number;
}

function getPersonality(s: Signals): string {
  if (s.tricksLanded>=20&&s.crashes===0) return 'Pro Skater 🏆';
  if (s.maxCombo>=8)                     return 'Combo God 🔥';
  if (s.crashes>=6)                      return 'Wipeout King 💥';
  if (s.tricksLanded>=12)                return 'Street Shredder 🛹';
  return 'Park Learner 🎿';
}

type Phase = 'start'|'countdown'|'playing'|'done';
interface GS {
  running:boolean; timeLeft:number; sig:Signals; frame:number; accentColor:string;
  skaterX:number; skaterY:number; baseY:number;
  jumping:boolean; jumpVY:number; onRail:boolean;
  obstacles:Obstacle[]; obsTimer:number; speed:number;
  scrollX:number;
  trickDisplay:string; trickAlpha:number;
  swipeStartX:number; swipeStartY:number; swipeStartTime:number; isSwiping:boolean;
  particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;
  crashed:boolean; crashTimer:number;
}

export default function PixelSkateGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const stateRef = useRef<GS>({
    running:false,timeLeft:DURATION,
    sig:{tricksLanded:0,crashes:0,maxCombo:0,comboCurrent:0,totalPoints:0,score:0},
    frame:0,accentColor:ACCENT,
    skaterX:0,skaterY:0,baseY:0,jumping:false,jumpVY:0,onRail:false,
    obstacles:[],obsTimer:0,speed:4,scrollX:0,
    trickDisplay:'',trickAlpha:0,
    swipeStartX:0,swipeStartY:0,swipeStartTime:0,isSwiping:false,
    particles:[],crashed:false,crashTimer:0,
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
    s.running=true; s.timeLeft=DURATION; s.frame=0; s.speed=4;
    s.sig={tricksLanded:0,crashes:0,maxCombo:0,comboCurrent:0,totalPoints:0,score:0};
    s.baseY=H*0.65; s.skaterX=W*0.25; s.skaterY=s.baseY;
    s.jumping=false; s.onRail=false; s.crashed=false;
    s.obstacles=[]; s.obsTimer=0; s.scrollX=0; s.particles=[];
    s.trickDisplay=''; s.trickAlpha=0;
    setScore(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current=setInterval(()=>{
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if(s.timeLeft<=0){ sfx.fail(); endGame(); }
      if(s.timeLeft===30||s.timeLeft===15) s.speed+=0.8;
    },1000);

    const PIXEL=4; // pixel art scale
    function drawPixelSkater(ctx:CanvasRenderingContext2D,x:number,y:number,jumping:boolean,frame:number){
      const tilt=jumping?-0.3:Math.sin(frame*0.3)*0.05;
      ctx.save(); ctx.translate(x,y); ctx.rotate(tilt);
      // Board
      ctx.fillStyle='#10b981';
      ctx.fillRect(-18,0,36,PIXEL*2);
      // Wheels
      ctx.fillStyle='#6b7280';
      ctx.fillRect(-14,PIXEL*2,PIXEL*3,PIXEL*3);
      ctx.fillRect(10,PIXEL*2,PIXEL*3,PIXEL*3);
      // Body
      ctx.fillStyle='#f97316';
      ctx.fillRect(-6,-20,12,20);
      // Head
      ctx.fillStyle='#fbbf24';
      ctx.fillRect(-7,-30,14,10);
      // Helmet
      ctx.fillStyle='#1d4ed8';
      ctx.fillRect(-8,-34,16,8);
      ctx.restore();
    }

    const loop=()=>{
      if(!s.running) return; s.frame++;
      const W=canvas.width,H=canvas.height;
      s.scrollX+=s.speed;

      // Retro pixel background
      ctx.fillStyle='#0f172a'; ctx.fillRect(0,0,W,H);
      // Pixel grid overlay
      ctx.fillStyle='rgba(30,60,30,0.3)';
      for(let gx=0;gx<W;gx+=8) for(let gy=0;gy<H;gy+=8) if((gx+gy)%16===0) ctx.fillRect(gx,gy,4,4);

      // Scrolling background buildings
      for(let i=0;i<6;i++){
        const bx=((i*200-s.scrollX*0.3)%W+W)%W-50;
        const bh=60+i*25;
        ctx.fillStyle='#0a1830'; ctx.fillRect(bx,H*0.4-bh,50,bh);
        // Windows
        for(let wy=0;wy<bh;wy+=20) for(let wx=5;wx<45;wx+=15){
          const on=Math.floor((s.scrollX/50+wx+wy)%3)===0;
          ctx.fillStyle=on?'#fbbf2466':'#0f172a';
          ctx.fillRect(bx+wx,H*0.4-bh+wy+5,8,8);
        }
      }

      // Ground
      ctx.fillStyle='#374151'; ctx.fillRect(0,s.baseY+5,W,H-s.baseY-5);
      // Ground tiles (pixel art)
      ctx.strokeStyle='#4b5563'; ctx.lineWidth=1;
      for(let tx=(-s.scrollX%40+40)%40;tx<W;tx+=40) ctx.strokeRect(tx,s.baseY+5,40,H-s.baseY);
      // Neon ground line
      ctx.strokeStyle='#10b981'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(0,s.baseY+4); ctx.lineTo(W,s.baseY+4); ctx.stroke();

      // Physics
      if(s.crashed){
        s.crashTimer--; if(s.crashTimer<=0){ s.crashed=false; s.skaterY=s.baseY; }
        s.skaterY=s.baseY;
      } else {
        if(s.jumping){ s.jumpVY+=0.8; s.skaterY+=s.jumpVY; }
        if(s.skaterY>=s.baseY){ s.skaterY=s.baseY; s.jumping=false; s.jumpVY=0; }
      }

      // Spawn obstacles
      s.obsTimer++;
      if(s.obsTimer>=70){
        s.obsTimer=0;
        const types:Obstacle['type'][]=['ramp','rail','gap','cone'];
        const type=types[Math.floor(Math.random()*types.length)];
        s.obstacles.push({x:W+30,type,passed:false});
      }

      // Update/draw obstacles
      for(let i=s.obstacles.length-1;i>=0;i--){
        const ob=s.obstacles[i]; ob.x-=s.speed;
        if(ob.x<-60){ s.obstacles.splice(i,1); continue; }

        // Draw obstacle
        ctx.save(); ctx.shadowBlur=8; ctx.shadowColor='#ef4444';
        switch(ob.type){
          case 'ramp':
            ctx.fillStyle='#78350f';
            ctx.beginPath(); ctx.moveTo(ob.x,s.baseY+5); ctx.lineTo(ob.x+30,s.baseY+5);
            ctx.lineTo(ob.x+30,s.baseY-25); ctx.closePath(); ctx.fill();
            ctx.strokeStyle='#d97706'; ctx.lineWidth=2; ctx.stroke();
            break;
          case 'rail':
            ctx.fillStyle='#94a3b8';
            ctx.fillRect(ob.x,s.baseY-20,50,6);
            ctx.fillRect(ob.x+5,s.baseY-20,4,20); ctx.fillRect(ob.x+41,s.baseY-20,4,20);
            break;
          case 'gap':
            ctx.fillStyle='#0f172a';
            ctx.fillRect(ob.x,s.baseY+4,40,H);
            ctx.strokeStyle='#7c3aed'; ctx.lineWidth=2;
            ctx.strokeRect(ob.x,s.baseY+4,40,20);
            break;
          case 'cone':
            ctx.fillStyle='#f97316';
            ctx.beginPath(); ctx.moveTo(ob.x+12,s.baseY-30); ctx.lineTo(ob.x,s.baseY+4); ctx.lineTo(ob.x+24,s.baseY+4); ctx.fill();
            ctx.fillStyle='#fff'; ctx.fillRect(ob.x+4,s.baseY-10,16,4); ctx.fillRect(ob.x+4,s.baseY-20,16,4);
            break;
        }
        ctx.restore();

        // Collision detection
        if(!ob.passed&&!s.crashed&&ob.x<s.skaterX+18&&ob.x+50>s.skaterX-18){
          const grounded=Math.abs(s.skaterY-s.baseY)<2;
          if(ob.type==='gap'&&grounded){
            // Crash into gap
            s.sig.crashes++; s.sig.comboCurrent=0; s.crashed=true; s.crashTimer=40;
            sfx.collision(); hapticFail();
          } else if((ob.type==='ramp'||ob.type==='cone')&&grounded){
            // Jump over ramp (award point) or crash into cone
            if(ob.type==='cone'&&grounded){
              s.sig.crashes++; s.sig.comboCurrent=0; s.crashed=true; s.crashTimer=30;
              sfx.collision(); hapticFail();
            } else { ob.passed=true; }
          } else { ob.passed=true; }
          if(!s.crashed) s.obstacles.splice(i,1);
        }
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const p=s.particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.2; p.alpha*=0.9;
        if(p.alpha<0.02){ s.particles.splice(i,1); continue; }
        ctx.save(); ctx.globalAlpha=p.alpha; ctx.fillStyle=p.color;
        ctx.fillRect(p.x-2,p.y-2,4,4); ctx.restore();
      }

      // Draw skater
      if(!s.crashed) drawPixelSkater(ctx,s.skaterX,s.skaterY,s.jumping,s.frame);
      else {
        // Crash animation
        ctx.save(); ctx.translate(s.skaterX,s.skaterY); ctx.rotate(Math.PI/2);
        drawPixelSkater(ctx,0,0,false,s.frame);
        ctx.restore();
      }

      // Trick display
      if(s.trickAlpha>0){
        s.trickAlpha*=0.95;
        ctx.save(); ctx.globalAlpha=s.trickAlpha;
        ctx.fillStyle=ACCENT; ctx.font=`bold ${Math.round(W*0.06)}px sans-serif`;
        ctx.textAlign='center'; ctx.shadowBlur=10; ctx.shadowColor=ACCENT;
        ctx.fillText(s.trickDisplay,W/2,H*0.35); ctx.restore();
      }

      // Combo counter
      if(s.sig.comboCurrent>=2){
        ctx.fillStyle='#fbbf24'; ctx.font='bold 16px sans-serif'; ctx.textAlign='left';
        ctx.fillText(`COMBO ×${s.sig.comboCurrent}`,10,70);
      }

      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  const performTrick = useCallback((dir:TrickInput)=>{
    const s=stateRef.current; if(!s.running||s.crashed) return;
    const trick=TRICKS[dir];
    if(!s.jumping){ // must be in air for flip tricks, or grind on rail
      if(dir==='down') {
        // Grind: jump to start
        if(!s.jumping){ s.jumping=true; s.jumpVY=-12; sfx.click(); return; }
      }
      s.jumping=true; s.jumpVY=-14;
    }
    // Land trick
    s.sig.tricksLanded++; s.sig.comboCurrent++;
    if(s.sig.comboCurrent>s.sig.maxCombo) s.sig.maxCombo=s.sig.comboCurrent;
    const mult=Math.ceil(s.sig.comboCurrent/3);
    const pts=trick.pts*mult; s.sig.score+=pts; s.sig.totalPoints+=pts;
    s.trickDisplay=`${trick.name} +${pts}`; s.trickAlpha=1;
    sfx.collect(); hapticScore();
    if(s.sig.comboCurrent>=4) hapticCombo(s.sig.comboCurrent);
    const canvas=canvasRef.current;
    if(canvas) for(let p=0;p<8;p++) s.particles.push({
      x:s.skaterX,y:s.skaterY, vx:(Math.random()-0.5)*10, vy:-4-Math.random()*4,
      alpha:1, color:ACCENT
    });
    setScore(s.sig.score);
  },[]);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const resize=()=>{ canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize',resize);

    const onPD=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      stateRef.current.swipeStartX=e.clientX;
      stateRef.current.swipeStartY=e.clientY;
      stateRef.current.swipeStartTime=Date.now();
      stateRef.current.isSwiping=true;
    };
    const onPU=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; if(!s.isSwiping) return;
      s.isSwiping=false;
      const dx=e.clientX-s.swipeStartX, dy=e.clientY-s.swipeStartY;
      const dist=Math.hypot(dx,dy);
      if(dist<20) return; // tap, not swipe
      let dir:TrickInput;
      if(Math.abs(dx)>Math.abs(dy)) dir=dx>0?'right':'left';
      else dir=dy<0?'up':'down';
      performTrick(dir);
    };
    canvas.addEventListener('pointerdown',onPD);
    canvas.addEventListener('pointerup',onPU);
    return()=>{ window.removeEventListener('resize',resize);
      canvas.removeEventListener('pointerdown',onPD); canvas.removeEventListener('pointerup',onPU); };
  },[phase,performTrick]);

  useEffect(()=>()=>{ cancelAnimationFrame(animRef.current); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const handleStart=useCallback(async(n:string,a:string)=>{
    playerSessionRef.current=savePlayerSession(GAME_ID,n,a); await initAudio(); setPhase('countdown');
  },[]);
  const handlePlayAgain=useCallback(()=>{ setPhase('start'); setScore(0); setTimeLeft(DURATION); setFinalSig(null); },[]);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
        ctaLabel="Drop In 🛹" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(
        <><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}
            role="img" aria-label="Pixel skateboarding game canvas"/>
          {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT}
            items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}
        </>
      )}
      {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[
          {label:'Tricks',value:`${finalSig.tricksLanded}`,color:'#4ade80'},
          {label:'Crashes',value:`${finalSig.crashes}`,color:finalSig.crashes===0?'#4ade80':'#ef4444'},
          {label:'Max Combo',value:`×${finalSig.maxCombo}`,color:ACCENT},
          {label:'Trick Points',value:`${finalSig.totalPoints}`,color:'#fbbf24'},
        ]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.tricksLanded>=15}/>}
    </GameShell>
  );
}
