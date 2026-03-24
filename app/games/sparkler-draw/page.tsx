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
const GAME_ID='sparkler-draw';const ACCENT='#fbbf24';const DURATION=45;const GAME_EMOJI='✨';const GAME_TITLE='Sparkler Draw';const GAME_TAGLINE='Draw with fire. Make it sparkle.';
interface Signals{total:number;success:number;fail:number;maxStreak:number;streakCurrent:number;score:number;bonus:number;}
function getPersonality(s:Signals){const a=s.total>0?s.success/s.total:0;if(a>=0.9&&s.maxStreak>=5)return'Champion '+GAME_EMOJI;if(s.maxStreak>=6)return'On Fire 🔥';if(a>=0.7)return'Great Player 🎯';return'Keep Going 💪';}
type Phase='start'|'countdown'|'playing'|'done';
interface GameState{running:boolean;timeLeft:number;sig:Signals;frame:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;targetX:number;targetY:number;targetR:number;targetTimer:number;particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;}
export default function SparklerDraw(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0},frame:0,accentColor:ACCENT,floats:[],scorePop:0,targetX:0,targetY:0,targetR:44,targetTimer:0,particles:[]});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");if(s.sig.score>pb)localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);
  const placeTarget=useCallback((W:number,H:number)=>{const s=stateRef.current;s.targetX=80+Math.random()*(W-160);s.targetY=100+Math.random()*(H-200);s.targetTimer=Math.max(30,90-s.sig.success*4);},[]);
  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0};s.frame=0;s.floats=[];s.scorePop=0;s.particles=[];
    placeTarget(W,H);
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      ctx.fillStyle='#0a0800';ctx.fillRect(0,0,W,H);
      // Unique themed elements
      for(let i=0;i<6;i++){const bx=(i*137+s.frame*0.15)%W,by=(i*91)%H;ctx.fillStyle=ACCENT+'08';ctx.beginPath();ctx.arc(bx,by,20+i*5,0,Math.PI*2);ctx.fill();}
      // Target
      s.targetTimer--;if(s.targetTimer<=0){s.sig.fail++;s.sig.streakCurrent=0;sfx.collision();hapticFail();placeTarget(W,H);}
      const pulse=1+Math.sin(s.frame*0.12)*0.12;
      ctx.save();ctx.shadowBlur=20;ctx.shadowColor=ACCENT;
      const grad=ctx.createRadialGradient(s.targetX-10,s.targetY-10,4,s.targetX,s.targetY,s.targetR*pulse);grad.addColorStop(0,ACCENT+'ff');grad.addColorStop(0.6,ACCENT+'88');grad.addColorStop(1,ACCENT+'00');
      ctx.fillStyle=grad;ctx.beginPath();ctx.arc(s.targetX,s.targetY,s.targetR*pulse,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=ACCENT;ctx.lineWidth=3;ctx.beginPath();ctx.arc(s.targetX,s.targetY,s.targetR*pulse,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#ffffff';ctx.font='28px sans-serif';ctx.textAlign='center';ctx.fillText(GAME_EMOJI,s.targetX,s.targetY+10);
      // Timer ring
      const pct=s.targetTimer/Math.max(30,90-s.sig.success*4);ctx.strokeStyle=pct>0.5?'#4ade80':pct>0.25?'#fbbf24':'#ef4444';ctx.lineWidth=4;ctx.beginPath();ctx.arc(s.targetX,s.targetY,s.targetR+8,-Math.PI/2,-Math.PI/2+pct*Math.PI*2);ctx.stroke();
      ctx.restore();
      s.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.alpha*=0.92;p.vy+=0.1;});s.particles=s.particles.filter(p=>p.alpha>0.05);
      s.particles.forEach(p=>{ctx.save();ctx.globalAlpha=p.alpha;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();ctx.restore();});
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/300;ctx.save();ctx.globalAlpha=t;ctx.font='bold '+Math.round(38*(1+(1-t)*0.3))+'px sans-serif';ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(''+s.sig.score,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.95;});
      animRef.current=requestAnimationFrame(loop);};
    animRef.current=requestAnimationFrame(loop);
  },[endGame,placeTarget]);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onPointerDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;const rect=canvas.getBoundingClientRect();const px=(e.clientX-rect.left)*(canvas.width/rect.width),py=(e.clientY-rect.top)*(canvas.height/rect.height);
      const dist=Math.hypot(px-s.targetX,py-s.targetY);s.sig.total++;
      if(dist<=s.targetR+10){s.sig.success++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;const mult=s.sig.streakCurrent>=3?2:1;s.sig.score+=mult;s.scorePop=Date.now()+300;setScoreDisplay(s.sig.score);sfx.collect();hapticScore();if(s.sig.streakCurrent>=3)hapticCombo(s.sig.streakCurrent);for(let p=0;p<8;p++)s.particles.push({x:px,y:py,vx:(Math.random()-0.5)*8,vy:-3-Math.random()*4,alpha:1,color:ACCENT});s.floats.push({x:px,y:py-25,text:'+'+mult+(s.sig.streakCurrent>=3?' 🔥':''),alpha:1,vy:-2.5,color:'#fbbf24'});placeTarget(canvas.width,canvas.height);}
      else{s.sig.fail++;s.sig.streakCurrent=0;sfx.collision();hapticFail();}};
    canvas.addEventListener('pointerdown',onPointerDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onPointerDown);};
  },[phase,placeTarget]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(n:string,a:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,n,a);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(<GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
    {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel={'Play! '+GAME_EMOJI} accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
    {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
    {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label={'Sparkler Draw game canvas'}/>
    {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
    {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
      insights={[{label:'Success',value:String(finalSig.success),color:ACCENT},{label:'Accuracy',value:finalSig.total>0?Math.round(finalSig.success/finalSig.total*100)+'%':'0%',color:'#4ade80'},{label:'Best Streak',value:'x'+finalSig.maxStreak,color:'#fbbf24'},{label:'Attempts',value:String(finalSig.total),color:'#06b6d4'}]}
      accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.success>=8}/>}
  </GameShell>);}