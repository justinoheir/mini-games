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
const GAME_ID='pattern-predict';const ACCENT='#14b8a6';const DURATION=45;const GAME_EMOJI='📈';const GAME_TITLE='Pattern Predict';const GAME_TAGLINE='What comes next? You tell me.';
interface Signals{totalItems:number;correct:number;wrong:number;maxStreak:number;streakCurrent:number;score:number;reactionSum:number;}
function getPersonality(sig:Signals){const acc=sig.totalItems>0?sig.correct/sig.totalItems:0;if(acc>=0.9&&sig.maxStreak>=5)return'Cognitive Elite 🧠';if(sig.maxStreak>=6)return'Focus Master 🎯';if(acc>=0.75)return'Sharp Mind ⚡';return'Brain Trainer 💪';}
type Phase='start'|'countdown'|'playing'|'done';
const COLORS=['#14b8a6','#4ade80','#3b82f6','#f43f5e','#fbbf24','#a855f7'];
interface Item{x:number;y:number;value:string;correct:boolean;id:number;}
interface GameState{running:boolean;timeLeft:number;sig:Signals;items:Item[];spawnTimer:number;shownAt:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;frame:number;level:number;}

export default function PatternPredict(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{totalItems:0,correct:0,wrong:0,maxStreak:0,streakCurrent:0,score:0,reactionSum:0},items:[],spawnTimer:0,shownAt:Date.now(),accentColor:ACCENT,floats:[],scorePop:0,frame:0,level:1});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");if(s.sig.score>pb)localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);

  const spawnItems=useCallback((W:number,H:number,level:number)=>{
    const s=stateRef.current;const count=4+Math.min(level,6);const emojis=['🍎','🐶','🌟','🎵','🦋','🏠','🌸','⚽','🎪','🔮','🌈','🦊'];
    const target=emojis[Math.floor(Math.random()*emojis.length)];const distractors=emojis.filter(e=>e!==target);
    s.items=[];let targetPlaced=false;
    for(let i=0;i<count;i++){const isTarget=!targetPlaced&&(i===Math.floor(Math.random()*count)||i===count-1);if(isTarget)targetPlaced=true;
      s.items.push({x:60+Math.random()*(W-120),y:120+Math.random()*(H-220),value:isTarget?target:distractors[Math.floor(Math.random()*distractors.length)],correct:isTarget,id:i});}
    s.shownAt=Date.now();
  },[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={totalItems:0,correct:0,wrong:0,maxStreak:0,streakCurrent:0,score:0,reactionSum:0};
    s.level=1;s.frame=0;s.floats=[];s.scorePop=0;
    spawnItems(W,H,1);
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      // Unique background - warm cream
      ctx.fillStyle='#1a0a18';ctx.fillRect(0,0,W,H);
      ctx.strokeStyle='rgba(,0.05)';ctx.lineWidth=1;
      for(let gx=0;gx<W;gx+=30){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,H);ctx.stroke();}
      for(let gy=0;gy<H;gy+=30){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(W,gy);ctx.stroke();}
      // Target hint
      const target=s.items.find(it=>it.correct);
      if(target){ctx.save();ctx.fillStyle='rgba(255,255,255,0.4)';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText('Find: '+target.value,W/2,70);ctx.restore();}
      // Draw items
      s.items.forEach(item=>{
        ctx.save();ctx.font='40px sans-serif';ctx.textAlign='center';
        ctx.fillText(item.value,item.x,item.y);
        if(item.correct){ctx.strokeStyle=ACCENT+'44';ctx.lineWidth=2;ctx.beginPath();ctx.arc(item.x,item.y-10,28,0,Math.PI*2);ctx.stroke();}
        ctx.restore();
      });
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/400;ctx.save();ctx.globalAlpha=t;ctx.font='bold '+Math.round(38*(1+(1-t)*0.3))+'px sans-serif';ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(''+s.sig.score,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.96;});
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnItems]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onPointerDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;const rect=canvas.getBoundingClientRect();const px=(e.clientX-rect.left)*(canvas.width/rect.width),py=(e.clientY-rect.top)*(canvas.height/rect.height);
      for(const item of s.items){if(Math.hypot(item.x-px,item.y-py)<35){const ms=Date.now()-s.shownAt;s.sig.totalItems++;s.sig.reactionSum+=ms;
        if(item.correct){s.sig.correct++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;const mult=s.sig.streakCurrent>=3?2:1;const pts=mult*(ms<1500?3:2);s.sig.score+=pts;s.scorePop=Date.now()+400;setScoreDisplay(s.sig.score);sfx.collect();hapticScore();if(s.sig.streakCurrent>=3)hapticCombo(s.sig.streakCurrent);s.level=Math.min(8,1+Math.floor(s.sig.correct/4));s.floats.push({x:px,y:py-20,text:'+'+pts+(ms<1000?' FAST!':''),alpha:1,vy:-2.5,color:'#fbbf24'});}
        else{s.sig.wrong++;s.sig.streakCurrent=0;sfx.collision();hapticFail();s.floats.push({x:px,y:py-20,text:'Wrong!',alpha:1,vy:-1.5,color:'#ef4444'});}
        spawnItems(canvas.width,canvas.height,s.level);break;}}};
    canvas.addEventListener('pointerdown',onPointerDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onPointerDown);};
  },[phase,spawnItems]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(n:string,a:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,n,a);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Identify the next element in the visual pattern and tap it!" ctaLabel="Play! 📈" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label="Pattern Predict game canvas"/>
      {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
      {phase==='done'&&finalSig&&(<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{label:'Accuracy',value:finalSig.totalItems>0?Math.round(finalSig.correct/finalSig.totalItems*100)+'%':'0%',color:ACCENT},{label:'Correct',value:String(finalSig.correct),color:'#4ade80'},{label:'Best Streak',value:'x'+finalSig.maxStreak,color:'#fbbf24'},{label:'Avg Speed',value:finalSig.totalItems>0?Math.round(finalSig.reactionSum/finalSig.totalItems)+'ms':'0ms',color:'#06b6d4'}]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct>=10}/>)}
    </GameShell>
  );
}