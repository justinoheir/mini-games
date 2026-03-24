'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact, hapticCelebration } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
const GAME_ID='bowling-curve';const ACCENT='#7c3aed';const DURATION=45;const GAME_EMOJI='🎳';const GAME_TITLE='Bowling Curve';const GAME_TAGLINE='Hook it. Hit the pocket.';
interface Pin{x:number;y:number;knocked:boolean;vx:number;vy:number;}
interface Signals{frames:number;strikes:number;spares:number;totalPins:number;maxStreak:number;streakCurrent:number;score:number;}
function getPersonality(sig:Signals){if(sig.strikes>=4&&sig.maxStreak>=3)return'Perfect Game Pro 🎳';if(sig.strikes>=3)return'Strike King 👑';if(sig.maxStreak>=4)return'Pocket Finder 🎯';return'Lane Learner 🌀';}
type Phase='start'|'countdown'|'playing'|'done';
interface Ball{x:number;y:number;vx:number;vy:number;spin:number;active:boolean;}
interface GameState{running:boolean;timeLeft:number;sig:Signals;ball:Ball;pins:Pin[];swipeStartX:number;swipeStartY:number;swipeCurveX:number;swiping:boolean;settleTimer:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;frame:number;}

function makePins(W:number,H:number):Pin[]{
  const pins:Pin[]=[];const rows=4;const startY=H*0.12;const gap=34;
  for(let r=0;r<rows;r++){const count=r+1;const startX=W/2-(count-1)*gap/2;
    for(let c=0;c<count;c++){pins.push({x:startX+c*gap,y:startY+r*gap*0.7,knocked:false,vx:0,vy:0});}}
  return pins;
}

export default function BowlingCurve(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{frames:0,strikes:0,spares:0,totalPins:0,maxStreak:0,streakCurrent:0,score:0},ball:{x:0,y:0,vx:0,vy:0,spin:0,active:false},pins:[],swipeStartX:0,swipeStartY:0,swipeCurveX:0,swiping:false,settleTimer:0,accentColor:ACCENT,floats:[],scorePop:0,frame:0});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem(`pb_${GAME_ID}`)??"0");if(s.sig.score>pb)localStorage.setItem(`pb_${GAME_ID}`,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={frames:0,strikes:0,spares:0,totalPins:0,maxStreak:0,streakCurrent:0,score:0};
    s.pins=makePins(W,H);s.ball={x:W/2,y:H*0.88,vx:0,vy:0,spin:0,active:false};s.frame=0;s.floats=[];s.scorePop=0;s.settleTimer=0;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      // Bowling alley
      const bg=ctx.createLinearGradient(0,0,W,0);bg.addColorStop(0,'#1a1008');bg.addColorStop(0.5,'#2d1a06');bg.addColorStop(1,'#1a1008');
      ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
      // Lane
      ctx.fillStyle='#c8a464';ctx.fillRect(W*0.1,0,W*0.8,H);
      // Lane lines
      ctx.strokeStyle='rgba(0,0,0,0.1)';ctx.lineWidth=1;
      for(let lx=W*0.1;lx<W*0.9;lx+=W*0.06){ctx.beginPath();ctx.moveTo(lx,0);ctx.lineTo(lx,H);ctx.stroke();}
      // Foul line
      ctx.strokeStyle='#ef4444';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(W*0.1,H*0.8);ctx.lineTo(W*0.9,H*0.8);ctx.stroke();
      // Update knocked pins
      s.pins.forEach(p=>{if(p.knocked){p.x+=p.vx;p.y+=p.vy;p.vx*=0.9;p.vy*=0.9;}});
      // Ball physics
      if(s.ball.active){
        s.ball.vy*=0.99;s.ball.x+=s.ball.vx+Math.sin(s.frame*0.1)*s.ball.spin;s.ball.y+=s.ball.vy;
        // Pin collision
        s.pins.forEach(p=>{if(p.knocked)return;const d=Math.hypot(s.ball.x-p.x,s.ball.y-p.y);if(d<28){p.knocked=true;s.sig.totalPins++;p.vx=(p.x-s.ball.x)/d*5;p.vy=(p.y-s.ball.y)/d*3;sfx.collision();}});
        // Reached top
        if(s.ball.y<H*0.08||s.ball.x<W*0.05||s.ball.x>W*0.95){s.ball.active=false;s.settleTimer=60;}
      }
      // Settle and score
      if(s.settleTimer>0){s.settleTimer--;if(s.settleTimer===0){
        const knocked=s.pins.filter(p=>p.knocked).length;const total=s.pins.length;
        const isStrike=knocked===total;const isSpare=knocked>0&&knocked<total&&s.sig.frames>0;
        s.sig.frames++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
        if(isStrike){s.sig.strikes++;hapticCelebration();sfx.success();s.floats.push({x:W/2,y:H*0.4,text:'🎳 STRIKE!',alpha:1,vy:-2,color:'#fbbf24'});}
        const mult=s.sig.streakCurrent>=3?2:1;const pts=isStrike?10*mult:knocked*mult;
        s.sig.score+=pts;s.scorePop=Date.now()+400;setScoreDisplay(s.sig.score);hapticScore();
        if(!isStrike)s.floats.push({x:W/2,y:H*0.4,text:`+${pts} (${knocked} pins)`,alpha:1,vy:-1.5,color:ACCENT});
        s.pins=makePins(W,H);s.ball={x:W/2,y:H*0.88,vx:0,vy:0,spin:0,active:false};
      }}
      // Draw pins
      s.pins.forEach(p=>{ctx.save();ctx.shadowBlur=6;ctx.shadowColor='#ffffff';ctx.fillStyle=p.knocked?'#444':'#ffffff';ctx.beginPath();ctx.ellipse(p.x,p.y,8,12,0,0,Math.PI*2);ctx.fill();if(!p.knocked){ctx.strokeStyle='#ef4444';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y-5,4,0,Math.PI*2);ctx.stroke();}ctx.restore();});
      // Draw ball
      if(s.ball.y<H+20){ctx.save();ctx.shadowBlur=12;ctx.shadowColor=ACCENT;const g=ctx.createRadialGradient(s.ball.x-6,s.ball.y-6,2,s.ball.x,s.ball.y,22);g.addColorStop(0,'#c4b5fd');g.addColorStop(1,'#4c1d95');ctx.fillStyle=g;ctx.beginPath();ctx.arc(s.ball.x,s.ball.y,22,0,Math.PI*2);ctx.fill();ctx.fillStyle='rgba(0,0,0,0.4)';for(let h=0;h<3;h++){const a=h*(Math.PI*2/3)+s.frame*0.05;ctx.beginPath();ctx.arc(s.ball.x+Math.cos(a)*8,s.ball.y+Math.sin(a)*8,4,0,Math.PI*2);ctx.fill();}ctx.restore();}
      // Aim guide
      if(!s.ball.active&&!s.swiping){ctx.save();ctx.strokeStyle='rgba(196,181,253,0.3)';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(s.ball.x,s.ball.y);ctx.lineTo(W/2,H*0.15);ctx.stroke();ctx.setLineDash([]);ctx.restore();}
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/400;ctx.save();ctx.globalAlpha=t;ctx.font=`bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(`${s.sig.score}`,W/2,H*0.65);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 24px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.96;});
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(s.ball.active||s.settleTimer>0)return;const rect=canvas.getBoundingClientRect();s.swipeStartX=(e.clientX-rect.left)*(canvas.width/rect.width);s.swipeStartY=(e.clientY-rect.top)*(canvas.height/rect.height);s.swipeCurveX=s.swipeStartX;s.swiping=true;};
    const onMove=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(!s.swiping)return;const rect=canvas.getBoundingClientRect();s.swipeCurveX=(e.clientX-rect.left)*(canvas.width/rect.width);};
    const onUp=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(!s.swiping)return;s.swiping=false;const rect=canvas.getBoundingClientRect();const ey=(e.clientY-rect.top)*(canvas.height/rect.height);const dy=ey-s.swipeStartY;if(dy>20)return;const curve=(s.swipeCurveX-s.swipeStartX)/100;s.ball.vx=curve*2;s.ball.vy=-12;s.ball.spin=curve*0.3;s.ball.active=true;sfx.click();hapticImpact();};
    canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerup',onUp);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointermove',onMove);canvas.removeEventListener('pointerup',onUp);};
  },[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Swipe up to bowl! Curve your swipe to add hook spin!" ctaLabel="Bowl! 🎳" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label="Bowling game canvas"/>
      {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
      {phase==='done'&&finalSig&&(<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{label:'Strikes',value:String(finalSig.strikes),color:'#fbbf24'},{label:'Pins Knocked',value:String(finalSig.totalPins),color:ACCENT},{label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#4ade80'},{label:'Frames',value:String(finalSig.frames),color:'#06b6d4'}]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.strikes>=3}/>)}
    </GameShell>
  );
}
