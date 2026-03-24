'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
const GAME_ID = 'hockey-slap'; const ACCENT = '#3b82f6'; const DURATION = 45; const GAME_EMOJI = '🏒'; const GAME_TITLE = 'Hockey Slap'; const GAME_TAGLINE = 'Pick your angle. Fire away.';
interface Signals { shots: number; goals: number; saved: number; topCorner: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  const g = sig.shots > 0 ? sig.goals / sig.shots : 0;
  if (g >= 0.75 && sig.topCorner >= 3) return 'Sniper 🎯';
  if (sig.maxStreak >= 5) return 'Hat Trick Hero 🏆';
  if (g >= 0.5) return 'Sharp Shooter 🏒';
  return 'Slap Happy 🎪';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
interface Goalie { x: number; direction: number; speed: number; w: number; h: number; }
interface Puck { x: number; y: number; vx: number; vy: number; active: boolean; }
interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  goalie: Goalie; puck: Puck; swipeStartX: number; swipeStartY: number; swiping: boolean;
  netX: number; netY: number; netW: number; netH: number;
  accentColor: string; floats: Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>; scorePop: number; frame: number; goalFlash: number;
}

export default function HockeySlap() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null); const animRef = useRef(0); const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef = useRef<GameState>({ running:false,timeLeft:DURATION,sig:{shots:0,goals:0,saved:0,topCorner:0,maxStreak:0,streakCurrent:0,score:0},goalie:{x:0,direction:1,speed:3,w:60,h:80},puck:{x:0,y:0,vx:0,vy:0,active:false},swipeStartX:0,swipeStartY:0,swiping:false,netX:0,netY:0,netW:0,netH:0,accentColor:ACCENT,floats:[],scorePop:0,frame:0,goalFlash:0 });
  const [phase,setPhase]=useState<Phase>('start'); const [timeLeft,setTimeLeft]=useState(DURATION); const [scoreDisplay,setScoreDisplay]=useState(0); const [finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem(`pb_${GAME_ID}`)??"0");if(s.sig.score>pb)localStorage.setItem(`pb_${GAME_ID}`,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current; const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={shots:0,goals:0,saved:0,topCorner:0,maxStreak:0,streakCurrent:0,score:0};
    s.netX=W*0.2;s.netY=H*0.08;s.netW=W*0.6;s.netH=H*0.18;
    s.goalie={x:W/2,direction:1,speed:3+Math.random()*2,w:70,h:90};
    s.puck={x:W/2,y:H*0.82,vx:0,vy:0,active:false};
    s.frame=0;s.floats=[];s.scorePop=0;s.goalFlash=0;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      // Ice rink
      const bg=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,H);bg.addColorStop(0,'#e8f4ff');bg.addColorStop(1,'#c8e0f0');
      ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
      // Ice lines
      ctx.strokeStyle='rgba(59,130,246,0.15)';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(0,H*0.5);ctx.lineTo(W,H*0.5);ctx.stroke();
      ctx.beginPath();ctx.arc(W/2,H*0.5,80,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.ellipse(W/2,H*0.75,W*0.2,H*0.08,0,0,Math.PI*2);ctx.stroke();
      // Net
      ctx.fillStyle='rgba(200,230,255,0.6)';ctx.fillRect(s.netX,s.netY,s.netW,s.netH);
      ctx.strokeStyle='#1d4ed8';ctx.lineWidth=3;ctx.strokeRect(s.netX,s.netY,s.netW,s.netH);
      // Net lines
      ctx.strokeStyle='rgba(100,150,200,0.4)';ctx.lineWidth=1;
      for(let gx=s.netX;gx<s.netX+s.netW;gx+=20){ctx.beginPath();ctx.moveTo(gx,s.netY);ctx.lineTo(gx,s.netY+s.netH);ctx.stroke();}
      for(let gy=s.netY;gy<s.netY+s.netH;gy+=15){ctx.beginPath();ctx.moveTo(s.netX,gy);ctx.lineTo(s.netX+s.netW,gy);ctx.stroke();}
      // Goalie move
      s.goalie.x+=s.goalie.direction*s.goalie.speed;
      if(s.goalie.x-s.goalie.w/2<s.netX)s.goalie.direction=1;
      if(s.goalie.x+s.goalie.w/2>s.netX+s.netW)s.goalie.direction=-1;
      // Draw goalie
      ctx.save();ctx.shadowBlur=4;ctx.shadowColor='#1e40af';
      ctx.fillStyle='#1d4ed8';ctx.fillRect(s.goalie.x-s.goalie.w/2,s.netY+s.netH-s.goalie.h,s.goalie.w,s.goalie.h);
      ctx.fillStyle='#fbbf24';ctx.fillRect(s.goalie.x-10,s.netY+s.netH-s.goalie.h,20,20);// helmet
      ctx.restore();
      // Puck
      if(s.puck.active){
        s.puck.x+=s.puck.vx;s.puck.y+=s.puck.vy;s.puck.vy-=0.05;// slight gravity
        // Goal check
        if(s.puck.y<s.netY+s.netH&&s.puck.y>s.netY&&s.puck.x>s.netX&&s.puck.x<s.netX+s.netW){
          const isTopCorner=s.puck.y<s.netY+s.netH*0.4&&(s.puck.x<s.netX+s.netW*0.3||s.puck.x>s.netX+s.netW*0.7);
          const goalieSaved=Math.abs(s.puck.x-s.goalie.x)<s.goalie.w/2;
          if(!goalieSaved){
            s.sig.goals++;if(isTopCorner)s.sig.topCorner++;
            s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
            const mult=s.sig.streakCurrent>=3?2:1;const pts=(isTopCorner?3:2)*mult;
            s.sig.score+=pts;s.scorePop=Date.now()+400;setScoreDisplay(s.sig.score);
            sfx.success();hapticScore();s.goalFlash=30;
            s.floats.push({x:W/2,y:H*0.35,text:isTopCorner?`+${pts} TOP CORNER! 🎯`:`+${pts} GOAL!`,alpha:1,vy:-2,color:'#fbbf24'});
          }else{s.sig.saved++;sfx.collision();hapticFail();s.sig.streakCurrent=0;s.floats.push({x:W/2,y:H*0.3,text:'SAVED! 🧤',alpha:1,vy:-1.5,color:'#ef4444'});}
          s.puck.active=false;s.puck.x=W/2;s.puck.y=H*0.82;
        }
        if(s.puck.y<-20||s.puck.x<-20||s.puck.x>W+20){s.puck.active=false;s.puck.x=W/2;s.puck.y=H*0.82;s.sig.streakCurrent=0;}
        if(s.puck.active){ctx.save();ctx.fillStyle='#1a1a1a';ctx.shadowBlur=6;ctx.shadowColor='#000';ctx.beginPath();ctx.ellipse(s.puck.x,s.puck.y,12,7,0,0,Math.PI*2);ctx.fill();ctx.restore();}
      }else{// stationary puck
        ctx.save();ctx.fillStyle='#1a1a1a';ctx.beginPath();ctx.ellipse(W/2,H*0.82,12,7,0,0,Math.PI*2);ctx.fill();ctx.restore();
      }
      if(s.goalFlash>0){ctx.fillStyle=`rgba(251,191,36,${s.goalFlash/30*0.3})`;ctx.fillRect(0,0,W,H);s.goalFlash--;}
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/400;ctx.save();ctx.globalAlpha=t;ctx.font=`bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(`${s.sig.score}`,W/2,H*0.65);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.96;});
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(s.puck.active)return;const rect=canvas.getBoundingClientRect();s.swipeStartX=(e.clientX-rect.left)*(canvas.width/rect.width);s.swipeStartY=(e.clientY-rect.top)*(canvas.height/rect.height);s.swiping=true;};
    const onUp=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(!s.swiping)return;s.swiping=false;const rect=canvas.getBoundingClientRect();const ex=(e.clientX-rect.left)*(canvas.width/rect.width),ey=(e.clientY-rect.top)*(canvas.height/rect.height);
      const dx=ex-s.swipeStartX,dy=ey-s.swipeStartY;const speed=Math.min(Math.sqrt(dx*dx+dy*dy)/20,12);if(speed>2){const len=Math.sqrt(dx*dx+dy*dy);s.puck.vx=(dx/len)*speed;s.puck.vy=(dy/len)*speed;s.puck.active=true;s.sig.shots++;sfx.click();hapticImpact();}};
    canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointerup',onUp);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp);};
  },[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Swipe to shoot the puck into the net past the goalie!" ctaLabel="Shoot! 🏒" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label="Hockey slap shot game canvas"/>
      {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
      {phase==='done'&&finalSig&&(<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{label:'Goals',value:String(finalSig.goals),color:ACCENT},{label:'Top Corner',value:String(finalSig.topCorner),color:'#fbbf24'},{label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#4ade80'},{label:'Shots',value:String(finalSig.shots),color:'#06b6d4'}]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.goals>=5}/>)}
    </GameShell>
  );
}
