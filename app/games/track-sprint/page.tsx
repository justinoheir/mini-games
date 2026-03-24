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
const GAME_ID='track-sprint';const ACCENT='#f59e0b';const DURATION=30;const GAME_EMOJI='🏃';const GAME_TITLE='Track Sprint';const GAME_TAGLINE='Alternate taps. Stay in your lane!';
interface Signals{totalSteps:number;laneViolations:number;maxSpeed:number;finishes:number;maxStreak:number;streakCurrent:number;score:number;}
function getPersonality(sig:Signals){if(sig.finishes>=3&&sig.laneViolations===0)return'Sprint Maestro 🥇';if(sig.maxSpeed>=15)return'Speed Demon ⚡';if(sig.maxStreak>=8)return'Rhythm Runner 🎵';return'Training Hard 💪';}
type Phase='start'|'countdown'|'playing'|'done';
interface Runner{x:number;y:number;speed:number;lane:number;animFrame:number;}
interface GameState{running:boolean;timeLeft:number;sig:Signals;runner:Runner;lastTapSide:'left'|'right'|null;tapCount:number;distance:number;trackLength:number;speedDecay:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;frame:number;}

export default function TrackSprint(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{totalSteps:0,laneViolations:0,maxSpeed:0,finishes:0,maxStreak:0,streakCurrent:0,score:0},runner:{x:0,y:0,speed:0,lane:2,animFrame:0},lastTapSide:null,tapCount:0,distance:0,trackLength:1000,speedDecay:0.97,accentColor:ACCENT,floats:[],scorePop:0,frame:0});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem(`pb_${GAME_ID}`)??"0");if(s.sig.score>pb)localStorage.setItem(`pb_${GAME_ID}`,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={totalSteps:0,laneViolations:0,maxSpeed:0,finishes:0,maxStreak:0,streakCurrent:0,score:0};
    s.runner={x:W/2,y:H*0.55,speed:0,lane:2,animFrame:0};s.lastTapSide=null;s.tapCount=0;s.distance=0;s.frame=0;s.floats=[];s.scorePop=0;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const LANES=4;const laneW=W/LANES;
    const handleMotion=(e:DeviceMotionEvent)=>{if(!s.running)return;const tilt=e.accelerationIncludingGravity?.x??0;const lane=Math.max(0,Math.min(LANES-1,Math.round((s.runner.x/W)*LANES+tilt*0.5)));if(Math.abs(tilt)>3)s.runner.lane=lane;};
    window.addEventListener('devicemotion',handleMotion);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      // Stadium
      const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#0f0800');bg.addColorStop(0.5,'#1a1000');bg.addColorStop(1,'#0f0800');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
      // Crowd gradient top
      ctx.fillStyle='rgba(245,158,11,0.06)';ctx.fillRect(0,0,W,H*0.25);
      // Track surface
      const trackTop=H*0.3,trackH=H*0.5;
      ctx.fillStyle='#c2832a';ctx.fillRect(0,trackTop,W,trackH);
      // Lane lines
      ctx.strokeStyle='rgba(255,255,255,0.4)';ctx.lineWidth=2;
      for(let l=1;l<LANES;l++){ctx.beginPath();ctx.moveTo(l*laneW,trackTop);ctx.lineTo(l*laneW,trackTop+trackH);ctx.stroke();}
      ctx.strokeStyle='#ffffff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,trackTop);ctx.lineTo(W,trackTop);ctx.stroke();ctx.beginPath();ctx.moveTo(0,trackTop+trackH);ctx.lineTo(W,trackTop+trackH);ctx.stroke();
      // Finish line markers
      const progress=Math.min(1,s.distance/s.trackLength);
      const finishLineX=(1-progress)*W*0.8+W*0.1;
      ctx.strokeStyle='#fbbf24';ctx.lineWidth=4;ctx.setLineDash([8,6]);ctx.beginPath();ctx.moveTo(finishLineX,trackTop);ctx.lineTo(finishLineX,trackTop+trackH);ctx.stroke();ctx.setLineDash([]);
      // Speed decay
      s.runner.speed*=s.speedDecay;
      s.distance+=s.runner.speed;
      if(s.runner.speed>s.sig.maxSpeed)s.sig.maxSpeed=s.runner.speed;
      // Check lane
      const targetX=s.runner.lane*laneW+laneW/2;
      s.runner.x+=(targetX-s.runner.x)*0.1;
      s.runner.y=trackTop+trackH*0.4;
      // Check finish
      if(s.distance>=s.trackLength){s.sig.finishes++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;const mult=s.sig.streakCurrent>=3?2:1;const pts=5*mult;s.sig.score+=pts;s.scorePop=Date.now()+400;setScoreDisplay(s.sig.score);sfx.success();hapticScore();s.floats.push({x:W/2,y:H*0.25,text:`+${pts} FINISH! 🏁`,alpha:1,vy:-2,color:'#fbbf24'});s.distance=0;s.runner.speed=0;}
      // Draw runner (stick figure running)
      ctx.save();ctx.translate(s.runner.x,s.runner.y);
      const legAngle=Math.sin(s.frame*0.3+s.sig.totalSteps*0.5)*0.6;
      ctx.strokeStyle='#fde68a';ctx.lineWidth=4;ctx.lineCap='round';
      // Body
      ctx.beginPath();ctx.moveTo(0,-30);ctx.lineTo(0,0);ctx.stroke();
      // Arms
      ctx.beginPath();ctx.moveTo(-15,0-20);ctx.lineTo(0,-10);ctx.lineTo(15,0-20);ctx.stroke();
      // Legs
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-12*Math.cos(legAngle),16);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(12*Math.cos(legAngle),16);ctx.stroke();
      // Head
      ctx.fillStyle='#fde68a';ctx.beginPath();ctx.arc(0,-38,12,0,Math.PI*2);ctx.fill();
      ctx.restore();
      // Progress bar
      ctx.fillStyle='#1a1010';ctx.fillRect(20,H-30,W-40,14);ctx.fillStyle=ACCENT;ctx.fillRect(20,H-30,(W-40)*progress,14);ctx.strokeStyle=ACCENT+'44';ctx.lineWidth=1;ctx.strokeRect(20,H-30,W-40,14);
      // Speed indicator
      const speedPct=Math.min(1,s.runner.speed/15);ctx.fillStyle=speedPct>0.7?'#4ade80':speedPct>0.3?ACCENT:'#ef4444';ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.fillText(`${Math.round(s.runner.speed*10)/10} m/s`,W/2,H-40);
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/400;ctx.save();ctx.globalAlpha=t;ctx.font=`bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(`${s.sig.score}`,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.96;});
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
    return()=>window.removeEventListener('devicemotion',handleMotion);
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;const rect=canvas.getBoundingClientRect();const px=(e.clientX-rect.left)*(canvas.width/rect.width);const side=px<canvas.width/2?'left':'right';
      if(side!==s.lastTapSide){s.runner.speed=Math.min(15,s.runner.speed+0.8);s.sig.totalSteps++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;hapticTick();sfx.click();}else{s.runner.speed*=0.9;s.sig.laneViolations++;hapticFail();}
      s.lastTapSide=side;};
    canvas.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);};
  },[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Alternate LEFT and RIGHT taps to sprint! Don't tap the same side twice!" ctaLabel="Sprint! 🏃" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label="Track sprint game canvas"/>
      {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
      {phase==='done'&&finalSig&&(<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{label:'Finishes',value:String(finalSig.finishes),color:ACCENT},{label:'Total Steps',value:String(finalSig.totalSteps),color:'#4ade80'},{label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},{label:'Lane Fouls',value:String(finalSig.laneViolations),color:'#ef4444'}]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.finishes>=2}/>)}
    </GameShell>
  );
}
