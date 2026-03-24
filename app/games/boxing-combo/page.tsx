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

const GAME_ID = 'boxing-combo';
const ACCENT = '#ef4444';
const DURATION = 30;
const GAME_EMOJI = '🥊';
const GAME_TITLE = 'Boxing Combo';
const GAME_TAGLINE = 'Jab. Cross. Hook. Repeat.';

interface Signals { totalAttempts: number; bestResult: number; maxStreak: number; streakCurrent: number; score: number; goodAttempts: number; perfectAttempts: number; }
function getPersonality(sig: Signals): string {
  if (sig.perfectAttempts >= 4 && sig.maxStreak >= 3) return 'Elite Athlete 🏆';
  if (sig.maxStreak >= 5) return 'On a Roll 🔥';
  if (sig.goodAttempts >= 5) return 'Solid Performer 💪';
  return 'Rising Athlete 🌱';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  chargeLevel: number; charging: boolean; chargeStart: number;
  inFlight: boolean; flightX: number; flightY: number; flightVX: number; flightVY: number;
  resultFlash: number; accentColor: string;
  floats: Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;
  scorePop: number; frame: number;
}

export default function Gameboxingcombo() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null); const animRef = useRef(0); const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef = useRef<GameState>({ running:false,timeLeft:DURATION,sig:{totalAttempts:0,bestResult:0,maxStreak:0,streakCurrent:0,score:0,goodAttempts:0,perfectAttempts:0},chargeLevel:0,charging:false,chargeStart:0,inFlight:false,flightX:0,flightY:0,flightVX:0,flightVY:0,resultFlash:0,accentColor:ACCENT,floats:[],scorePop:0,frame:0 });
  const [phase,setPhase]=useState<Phase>('start'); const [timeLeft,setTimeLeft]=useState(DURATION); const [scoreDisplay,setScoreDisplay]=useState(0); const [finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");if(s.sig.score>pb)localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={totalAttempts:0,bestResult:0,maxStreak:0,streakCurrent:0,score:0,goodAttempts:0,perfectAttempts:0};
    s.chargeLevel=0;s.charging=false;s.inFlight=false;s.frame=0;s.floats=[];s.scorePop=0;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      // Stadium background - unique color scheme
      const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#0a1008');bg.addColorStop(0.6,'#0f1a0a');bg.addColorStop(1,'#060a04');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
      // Field
      ctx.fillStyle='#1a4a10';ctx.fillRect(0,H*0.7,W,H*0.3);ctx.strokeStyle='rgba(255,255,255,0.2)';ctx.lineWidth=1;
      for(let fx=0;fx<W;fx+=40){ctx.beginPath();ctx.moveTo(fx,H*0.7);ctx.lineTo(fx,H);ctx.stroke();}
      // Charge meter
      if(s.charging){s.chargeLevel=Math.min(1,(Date.now()-s.chargeStart)/1500);}
      const mW=W*0.6,mH=20;ctx.fillStyle='#1a2010';ctx.fillRect(W*0.2,H-50,mW,mH);
      const mColor=s.chargeLevel>0.8?'#ef4444':s.chargeLevel>0.5?'#fbbf24':ACCENT;ctx.fillStyle=mColor;ctx.fillRect(W*0.2,H-50,mW*s.chargeLevel,mH);ctx.strokeStyle=ACCENT+'44';ctx.lineWidth=1;ctx.strokeRect(W*0.2,H-50,mW,mH);
      // Optimal zone marker
      ctx.fillStyle='rgba(74,222,128,0.3)';ctx.fillRect(W*0.2+mW*0.7,H-50,mW*0.15,mH);
      ctx.fillStyle='#4ade80';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillText('SWEET SPOT',W*0.2+mW*0.775,H-55);
      // Flight animation
      if(s.inFlight){s.flightVY+=0.3;s.flightX+=s.flightVX;s.flightY+=s.flightVY;
        ctx.save();ctx.shadowBlur=14;ctx.shadowColor=ACCENT;ctx.fillStyle=ACCENT;ctx.beginPath();ctx.arc(s.flightX,s.flightY,10,0,Math.PI*2);ctx.fill();ctx.restore();
        if(s.flightY>H+20||s.flightX>W+20){s.inFlight=false;}
      }
      // Player
      ctx.save();ctx.fillStyle='#fed7aa';ctx.strokeStyle='#fed7aa';ctx.lineWidth=4;ctx.lineCap='round';
      const px=W*0.2,py=H*0.65;
      const poseAngle=s.charging?(-0.3-s.chargeLevel*0.8):(-0.3);
      ctx.translate(px,py);ctx.rotate(poseAngle);
      ctx.beginPath();ctx.moveTo(0,-40);ctx.lineTo(0,0);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-20,-20);ctx.lineTo(20,-30);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-10,30);ctx.stroke();ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(10,30);ctx.stroke();
      ctx.fillStyle='#fed7aa';ctx.beginPath();ctx.arc(0,-48,10,0,Math.PI*2);ctx.fill();
      ctx.restore();
      // Landing zones
      const zones=[{x:W*0.5,w:W*0.15,pts:1,color:'#3b82f6',label:'OK'},{x:W*0.65,w:W*0.15,pts:3,color:'#10b981',label:'GOOD'},{x:W*0.8,w:W*0.15,pts:5,color:'#fbbf24',label:'BEST'}];
      zones.forEach(z=>{ctx.fillStyle=z.color+'30';ctx.fillRect(z.x,H*0.7,z.w,20);ctx.fillStyle=z.color;ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.fillText(z.label,z.x+z.w/2,H*0.7+14);});
      if(s.resultFlash>0){ctx.fillStyle='rgba(251,191,36,'+s.resultFlash/20*0.3+')';ctx.fillRect(0,0,W,H);s.resultFlash--;}
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/400;ctx.save();ctx.globalAlpha=t;ctx.font='bold '+Math.round(38*(1+(1-t)*0.3))+'px sans-serif';ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(''+s.sig.score,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.96;});
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onDown=()=>{if(phase!=='playing')return;const s=stateRef.current;if(s.inFlight)return;s.charging=true;s.chargeStart=Date.now();};
    const onUp=()=>{if(phase!=='playing')return;const s=stateRef.current;if(!s.charging)return;s.charging=false;
      const W=canvas.width,H=canvas.height;
      const isOptimal=s.chargeLevel>=0.7&&s.chargeLevel<=0.85;const isGood=s.chargeLevel>=0.5;
      const speed=6+s.chargeLevel*12;s.flightX=W*0.2;s.flightY=H*0.6;s.flightVX=speed;s.flightVY=-speed*0.8;s.inFlight=true;
      s.sig.totalAttempts++;
      // Score when landing
      const landX=W*0.2+speed*speed*0.15;
      const zone=landX>W*0.8?{pts:5}:landX>W*0.65?{pts:3}:landX>W*0.5?{pts:1}:null;
      const pts=zone?zone.pts:0;
      if(isOptimal)s.sig.perfectAttempts++;else if(isGood)s.sig.goodAttempts++;
      s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
      const mult=s.sig.streakCurrent>=3?2:1;s.sig.score+=pts*mult;s.scorePop=Date.now()+400;setScoreDisplay(s.sig.score);
      if(pts>=5){sfx.success();hapticScore();s.resultFlash=20;}else if(pts>0){sfx.collect();hapticScore();}else{sfx.collision();hapticFail();s.sig.streakCurrent=0;}
      s.floats.push({x:W*0.7,y:H*0.5,text:pts>0?'+'+pts*mult+(isOptimal?' PERFECT!':''):'No score',alpha:1,vy:-2,color:pts>=5?'#fbbf24':'#4ade80'});
      s.chargeLevel=0;hapticImpact();};
    canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointerup',onUp);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp);};
  },[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Go! 🥊" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label="Boxing Combo game canvas"/>
      {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
      {phase==='done'&&finalSig&&(<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{label:'Perfect',value:String(finalSig.perfectAttempts),color:'#fbbf24'},{label:'Good',value:String(finalSig.goodAttempts),color:ACCENT},{label:'Best Streak',value:'x'+finalSig.maxStreak,color:'#4ade80'},{label:'Attempts',value:String(finalSig.totalAttempts),color:'#06b6d4'}]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.perfectAttempts>=3}/>)}
    </GameShell>
  );
}