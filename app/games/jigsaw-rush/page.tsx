'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
const GAME_ID='jigsaw-rush';const ACCENT='#fbbf24';const DURATION=60;const GAME_EMOJI='🧩';const GAME_TITLE='Jigsaw Rush';const GAME_TAGLINE='Snap it. Fast. Clock\x27s ticking.';
interface Signals{total:number;success:number;fail:number;maxStreak:number;streakCurrent:number;score:number;bonus:number;}
function getPersonality(s:Signals){const a=s.total>0?s.success/s.total:0;if(a>=0.9&&s.maxStreak>=5)return'Master '+GAME_EMOJI;if(s.maxStreak>=6)return'On Fire 🔥';if(a>=0.7)return'Skilled 🎯';return'Training 💪';}
type Phase='start'|'countdown'|'playing'|'done';
interface GameState{running:boolean;timeLeft:number;sig:Signals;frame:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;swipeStartX:number;swipeStartY:number;swiping:boolean;ringX:number;ringY:number;ringR:number;ringVX:number;ringVY:number;}
export default function JigsawRush(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0},frame:0,accentColor:ACCENT,floats:[],scorePop:0,swipeStartX:0,swipeStartY:0,swiping:false,ringX:0,ringY:0,ringR:30,ringVX:2,ringVY:1.5});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");if(s.sig.score>pb)localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);
  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0};s.frame=0;s.floats=[];s.scorePop=0;s.ringX=W/2;s.ringY=H/2;s.ringVX=2+Math.random()*2;s.ringVY=1.5+Math.random()*1.5;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      ctx.fillStyle='#1a1200';ctx.fillRect(0,0,W,H);
      for(let i=0;i<10;i++){const bx=(i*131+s.frame*0.18)%W,by=(i*87+s.frame*0.12)%H;ctx.fillStyle=ACCENT+'0a';ctx.beginPath();ctx.arc(bx,by,12+i*2,0,Math.PI*2);ctx.fill();}
      // Moving ring target
      s.ringX+=s.ringVX;s.ringY+=s.ringVY;
      if(s.ringX<s.ringR||s.ringX>W-s.ringR)s.ringVX*=-1;
      if(s.ringY<s.ringR||s.ringY>H-s.ringR)s.ringVY*=-1;
      const pulse=1+Math.sin(s.frame*0.15)*0.1;
      ctx.save();ctx.shadowBlur=16;ctx.shadowColor=ACCENT;ctx.strokeStyle=ACCENT;ctx.lineWidth=4;ctx.beginPath();ctx.arc(s.ringX,s.ringY,s.ringR*pulse,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle=ACCENT+'22';ctx.beginPath();ctx.arc(s.ringX,s.ringY,s.ringR*pulse,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#ffffff';ctx.font='22px sans-serif';ctx.textAlign='center';ctx.fillText(GAME_EMOJI,s.ringX,s.ringY+8);ctx.restore();
      // Swipe arrow
      if(s.swiping){ctx.save();ctx.strokeStyle=ACCENT+'66';ctx.lineWidth=3;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(s.swipeStartX,s.swipeStartY);ctx.lineTo(s.ringX,s.ringY);ctx.stroke();ctx.setLineDash([]);ctx.restore();}
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/300;ctx.save();ctx.globalAlpha=t;ctx.font='bold '+Math.round(38*(1+(1-t)*0.3))+'px sans-serif';ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(''+s.sig.score,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.95;});
      animRef.current=requestAnimationFrame(loop);};
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;const rect=canvas.getBoundingClientRect();s.swipeStartX=(e.clientX-rect.left)*(canvas.width/rect.width);s.swipeStartY=(e.clientY-rect.top)*(canvas.height/rect.height);s.swiping=true;};
    const onUp=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(!s.swiping)return;s.swiping=false;const rect=canvas.getBoundingClientRect();const ex=(e.clientX-rect.left)*(canvas.width/rect.width),ey=(e.clientY-rect.top)*(canvas.height/rect.height);
      const dist=Math.hypot(ex-s.ringX,ey-s.ringY);s.sig.total++;
      if(dist<=s.ringR+20){s.sig.success++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;const mult=s.sig.streakCurrent>=3?2:1;s.sig.score+=mult;s.scorePop=Date.now()+300;setScoreDisplay(s.sig.score);sfx.collect();hapticScore();if(s.sig.streakCurrent>=3)hapticCombo(s.sig.streakCurrent);s.floats.push({x:s.ringX,y:s.ringY-30,text:'+'+mult+(s.sig.streakCurrent>=3?' 🔥':''),alpha:1,vy:-2.5,color:'#fbbf24'});s.ringVX*=1.05;s.ringVY*=1.05;}
      else{s.sig.fail++;s.sig.streakCurrent=0;sfx.collision();hapticFail();}};
    canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointerup',onUp);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp);};
  },[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(n:string,a:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,n,a);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(<GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
    {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel={'Go! '+GAME_EMOJI} accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
    {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
    {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label={'Jigsaw Rush game canvas'}/>
    {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
    {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
      insights={[{label:'Hits',value:String(finalSig.success),color:ACCENT},{label:'Misses',value:String(finalSig.fail),color:'#ef4444'},{label:'Best Streak',value:'x'+finalSig.maxStreak,color:'#fbbf24'},{label:'Total',value:String(finalSig.total),color:'#06b6d4'}]}
      accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.success>=10}/>}
  </GameShell>);}