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
const GAME_ID='number-path';const ACCENT='#22c55e';const DURATION=45;const GAME_EMOJI='🔢';const GAME_TITLE='Number Path';const GAME_TAGLINE='1 to N. Fastest finger wins.';
interface Signals{total:number;success:number;fail:number;maxStreak:number;streakCurrent:number;score:number;bonus:number;}
function getPersonality(s:Signals){const a=s.total>0?s.success/s.total:0;if(a>=0.9&&s.maxStreak>=5)return'Pro '+GAME_EMOJI;if(s.maxStreak>=6)return'Unstoppable 🔥';if(a>=0.7)return'Sharp 🎯';return'Rising Star ⭐';}
type Phase='start'|'countdown'|'playing'|'done';
interface GameState{running:boolean;timeLeft:number;sig:Signals;frame:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;phase2:number;speedLevel:number;flashX:number;flashY:number;flashTimer:number;}
export default function NumberPath(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0},frame:0,accentColor:ACCENT,floats:[],scorePop:0,phase2:0,speedLevel:1,flashX:0,flashY:0,flashTimer:0});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");if(s.sig.score>pb)localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);
  const spawnFlash=useCallback((W:number,H:number)=>{const s=stateRef.current;s.flashX=60+Math.random()*(W-120);s.flashY=80+Math.random()*(H-160);s.flashTimer=Math.max(25,75-s.sig.success*3);},[]);
  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0};s.frame=0;s.floats=[];s.scorePop=0;s.speedLevel=1;
    spawnFlash(W,H);
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      ctx.fillStyle='#060f06';ctx.fillRect(0,0,W,H);
      for(let i=0;i<12;i++){const bx=(i*127+s.frame*0.1)%W,by=(i*83+s.frame*0.08)%H;ctx.fillStyle=ACCENT+'06';ctx.beginPath();ctx.arc(bx,by,8+i*3,0,Math.PI*2);ctx.fill();}
      s.flashTimer--;if(s.flashTimer<=0){s.sig.fail++;s.sig.streakCurrent=0;sfx.collision();hapticFail();spawnFlash(W,H);}
      const pct=s.flashTimer/Math.max(25,75-s.sig.success*3);
      const glow=ctx.createRadialGradient(s.flashX,s.flashY,0,s.flashX,s.flashY,50);glow.addColorStop(0,ACCENT+'ff');glow.addColorStop(0.5,ACCENT+'88');glow.addColorStop(1,'transparent');
      ctx.save();ctx.shadowBlur=24*pct;ctx.shadowColor=ACCENT;ctx.fillStyle=glow;ctx.beginPath();ctx.arc(s.flashX,s.flashY,50*pct,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=ACCENT;ctx.lineWidth=3;ctx.globalAlpha=pct;ctx.beginPath();ctx.arc(s.flashX,s.flashY,44,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=1;ctx.fillStyle='#ffffff';ctx.font='28px sans-serif';ctx.textAlign='center';ctx.fillText(GAME_EMOJI,s.flashX,s.flashY+10);ctx.restore();
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/300;ctx.save();ctx.globalAlpha=t;ctx.font='bold '+Math.round(38*(1+(1-t)*0.3))+'px sans-serif';ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(''+s.sig.score,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.95;});
      animRef.current=requestAnimationFrame(loop);};
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnFlash]);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onPointerDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;const rect=canvas.getBoundingClientRect();const px=(e.clientX-rect.left)*(canvas.width/rect.width),py=(e.clientY-rect.top)*(canvas.height/rect.height);const dist=Math.hypot(px-s.flashX,py-s.flashY);s.sig.total++;
      if(dist<=54){s.sig.success++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;const mult=s.sig.streakCurrent>=3?2:1;s.sig.score+=mult;s.scorePop=Date.now()+300;setScoreDisplay(s.sig.score);sfx.collect();hapticScore();if(s.sig.streakCurrent>=3)hapticCombo(s.sig.streakCurrent);s.floats.push({x:px,y:py-25,text:'+'+mult+(s.sig.streakCurrent>=3?' 🔥':''),alpha:1,vy:-2.5,color:'#fbbf24'});spawnFlash(canvas.width,canvas.height);}
      else{s.sig.fail++;s.sig.streakCurrent=0;sfx.collision();hapticFail();s.floats.push({x:px,y:py-20,text:'Miss!',alpha:1,vy:-1.5,color:'#ef4444'});}};
    canvas.addEventListener('pointerdown',onPointerDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onPointerDown);};
  },[phase,spawnFlash]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(n:string,a:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,n,a);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(<GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
    {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel={'Go! '+GAME_EMOJI} accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
    {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
    {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label={'Number Path game canvas'}/>
    {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
    {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
      insights={[{label:'Hits',value:String(finalSig.success),color:ACCENT},{label:'Misses',value:String(finalSig.fail),color:'#ef4444'},{label:'Best Streak',value:'x'+finalSig.maxStreak,color:'#fbbf24'},{label:'Total',value:String(finalSig.total),color:'#06b6d4'}]}
      accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.success>=10}/>}
  </GameShell>);}