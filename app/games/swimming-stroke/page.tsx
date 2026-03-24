'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticTick } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
const GAME_ID='swimming-stroke';const ACCENT='#0ea5e9';const DURATION=60;const GAME_EMOJI='🏊';const GAME_TITLE='Swimming Stroke';const GAME_TAGLINE='Alternate arms. Keep the pace.';
interface Signals{totalStrokes:number;perfectRhythm:number;rhythmBreaks:number;laps:number;maxSpeed:number;maxStreak:number;streakCurrent:number;score:number;}
function getPersonality(sig:Signals){if(sig.laps>=4&&sig.rhythmBreaks===0)return'Olympic Swimmer 🥇';if(sig.maxSpeed>=12)return'Speed Fish 🐠';if(sig.maxStreak>=8)return'Rhythm Master 🌊';return'Pool Explorer 🏊';}
type Phase='start'|'countdown'|'playing'|'done';
interface GameState{running:boolean;timeLeft:number;sig:Signals;swimmerX:number;swimmerY:number;speed:number;lastStrokeSide:'left'|'right'|null;strokeTimer:number;idealRhythm:number;rhythmWindow:number;distance:number;lapLength:number;wakeParticles:Array<{x:number;y:number;alpha:number;vx:number}>;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;frame:number;}

export default function SwimmingStroke(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{totalStrokes:0,perfectRhythm:0,rhythmBreaks:0,laps:0,maxSpeed:0,maxStreak:0,streakCurrent:0,score:0},swimmerX:80,swimmerY:0,speed:0,lastStrokeSide:null,strokeTimer:0,idealRhythm:600,rhythmWindow:150,distance:0,lapLength:500,wakeParticles:[],accentColor:ACCENT,floats:[],scorePop:0,frame:0});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem(`pb_${GAME_ID}`)??"0");if(s.sig.score>pb)localStorage.setItem(`pb_${GAME_ID}`,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={totalStrokes:0,perfectRhythm:0,rhythmBreaks:0,laps:0,maxSpeed:0,maxStreak:0,streakCurrent:0,score:0};
    s.swimmerX=80;s.swimmerY=H/2;s.speed=0;s.lastStrokeSide=null;s.strokeTimer=0;s.distance=0;s.wakeParticles=[];s.frame=0;s.floats=[];s.scorePop=0;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    let lastStrokeTime=0;
    const handleStroke=(side:'left'|'right')=>{if(side===s.lastStrokeSide){s.speed*=0.8;s.sig.rhythmBreaks++;s.sig.streakCurrent=0;hapticFail();return;}
      const now=Date.now();const timeSinceLastStroke=now-lastStrokeTime;const isRhythmic=lastStrokeTime>0&&Math.abs(timeSinceLastStroke-s.idealRhythm)<s.rhythmWindow;
      if(isRhythmic){s.sig.perfectRhythm++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;s.speed=Math.min(15,s.speed+1.2);}else{s.speed=Math.min(15,s.speed+0.6);}
      s.lastStrokeSide=side;lastStrokeTime=now;s.sig.totalStrokes++;
      if(s.speed>s.sig.maxSpeed)s.sig.maxSpeed=s.speed;
      hapticTick();sfx.click();
      s.wakeParticles.push({x:s.swimmerX-20,y:s.swimmerY+(Math.random()-0.5)*20,alpha:0.8,vx:-(1+Math.random()*2)});
    };
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      // Pool water
      const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#0c4a6e');bg.addColorStop(0.5,'#075985');bg.addColorStop(1,'#0369a1');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
      // Lane lines
      ctx.strokeStyle='rgba(255,255,255,0.15)';ctx.lineWidth=2;const laneCount=4;const laneH=H/laneCount;
      for(let i=0;i<=laneCount;i++){ctx.beginPath();ctx.moveTo(0,i*laneH);ctx.lineTo(W,i*laneH);ctx.stroke();}
      // Lane markers
      ctx.strokeStyle='rgba(251,191,36,0.4)';ctx.lineWidth=1;
      for(let lx=0;lx<W;lx+=40){ctx.beginPath();ctx.moveTo(lx,H/2-4);ctx.lineTo(lx+20,H/2-4);ctx.stroke();}
      // Water caustics
      for(let i=0;i<8;i++){const cx=(i*137+s.frame*0.5)%W,cy=(i*79)%H;ctx.fillStyle='rgba(255,255,255,0.04)';ctx.beginPath();ctx.ellipse(cx,cy,30,10,s.frame*0.02,0,Math.PI*2);ctx.fill();}
      // Speed
      s.speed*=0.99;s.swimmerX=Math.min(W-60,s.swimmerX+s.speed*0.8);
      // Distance & lap
      s.distance+=s.speed*0.8;if(s.distance>=s.lapLength){s.sig.laps++;const mult=s.sig.streakCurrent>=3?2:1;const pts=5*mult;s.sig.score+=pts;s.scorePop=Date.now()+400;setScoreDisplay(s.sig.score);sfx.success();hapticScore();s.floats.push({x:W/2,y:H*0.2,text:`+${pts} LAP! 🏊`,alpha:1,vy:-2,color:'#fbbf24'});s.distance=0;s.swimmerX=60;}
      // Wake particles
      s.wakeParticles.forEach(p=>{p.x+=p.vx;p.alpha*=0.9;});s.wakeParticles=s.wakeParticles.filter(p=>p.alpha>0.05);
      s.wakeParticles.forEach(p=>{ctx.save();ctx.globalAlpha=p.alpha;ctx.strokeStyle='rgba(255,255,255,0.6)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.stroke();ctx.restore();});
      // Draw swimmer (top-down view)
      ctx.save();ctx.translate(s.swimmerX,s.swimmerY);
      // Body
      ctx.fillStyle='#fed7aa';ctx.beginPath();ctx.ellipse(0,0,14,28,0,0,Math.PI*2);ctx.fill();
      // Arms alternating
      const armAngle=Math.sin(s.frame*0.3)*0.8;ctx.strokeStyle='#fed7aa';ctx.lineWidth=5;ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(-14,0);ctx.lineTo(-30*Math.cos(armAngle),-20*Math.sin(armAngle));ctx.stroke();
      ctx.beginPath();ctx.moveTo(14,0);ctx.lineTo(30*Math.cos(-armAngle),20*Math.sin(-armAngle));ctx.stroke();
      // Cap
      ctx.fillStyle='#0369a1';ctx.beginPath();ctx.ellipse(0,-18,10,14,0,0,Math.PI);ctx.fill();
      ctx.restore();
      // Rhythm indicator
      const rhythmPct=s.sig.totalStrokes>0?s.sig.perfectRhythm/s.sig.totalStrokes:0;
      ctx.fillStyle='rgba(0,0,0,0.4)';ctx.fillRect(W-50,H*0.3,20,H*0.4);ctx.fillStyle=rhythmPct>0.7?'#4ade80':ACCENT;ctx.fillRect(W-50,H*0.3+H*0.4*(1-rhythmPct),20,H*0.4*rhythmPct);ctx.strokeStyle=ACCENT+'44';ctx.lineWidth=1;ctx.strokeRect(W-50,H*0.3,20,H*0.4);
      // Progress bar
      const prog=s.distance/s.lapLength;ctx.fillStyle='#0c4a6e';ctx.fillRect(20,H-20,W-40,10);ctx.fillStyle='#38bdf8';ctx.fillRect(20,H-20,(W-40)*prog,10);
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/400;ctx.save();ctx.globalAlpha=t;ctx.font=`bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(`${s.sig.score}`,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.96;});
      // Tap guide
      ctx.save();ctx.fillStyle='rgba(255,255,255,0.3)';ctx.font='bold 18px sans-serif';
      ctx.textAlign='left';ctx.fillText('◀ LEFT',20,H-40);ctx.textAlign='right';ctx.fillText('RIGHT ▶',W-20,H-40);ctx.restore();
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
    (canvas as any)._handleStroke=handleStroke;
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase!=='playing')return;const rect=canvas.getBoundingClientRect();const px=(e.clientX-rect.left)*(canvas.width/rect.width);const side=px<canvas.width/2?'left':'right';const h=(canvas as any)._handleStroke;if(h)h(side);};
    canvas.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);};
  },[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tap LEFT and RIGHT alternately to swim! Keep a steady rhythm for speed!" ctaLabel="Swim! 🏊" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label="Swimming stroke game canvas"/>
      {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
      {phase==='done'&&finalSig&&(<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{label:'Laps',value:String(finalSig.laps),color:ACCENT},{label:'Perfect Rhythm',value:String(finalSig.perfectRhythm),color:'#4ade80'},{label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},{label:'Total Strokes',value:String(finalSig.totalStrokes),color:'#06b6d4'}]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.laps>=3}/>)}
    </GameShell>
  );
}
