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
const GAME_ID='dream-catch';const ACCENT='#818cf8';const DURATION=60;const GAME_EMOJI='🌙';const GAME_TITLE='Dream Catch';const GAME_TAGLINE='Float through. Catch the fragments.';
interface Signals{total:number;success:number;fail:number;maxStreak:number;streakCurrent:number;score:number;bonus:number;}
function getPersonality(s:Signals){const a=s.total>0?s.success/s.total:0;if(a>=0.9&&s.maxStreak>=5)return'Legend '+GAME_EMOJI;if(s.maxStreak>=6)return'Unstoppable 🔥';if(a>=0.7)return'Pro Player 🎯';return'Keep Playing 💪';}
type Phase='start'|'countdown'|'playing'|'done';
interface Obj{x:number;y:number;vy:number;r:number;color:string;active:boolean;id:number;}
interface GameState{running:boolean;timeLeft:number;sig:Signals;frame:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;objects:Obj[];nextId:number;basketX:number;}
const COLS=['#818cf8','#4ade80','#3b82f6','#f43f5e','#fbbf24','#a855f7','#f97316','#06b6d4'];
export default function DreamCatch(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0},frame:0,accentColor:ACCENT,floats:[],scorePop:0,objects:[],nextId:0,basketX:0});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");if(s.sig.score>pb)localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);
  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0};s.frame=0;s.floats=[];s.scorePop=0;s.objects=[];s.nextId=0;s.basketX=W/2;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      ctx.fillStyle='#04020f';ctx.fillRect(0,0,W,H);
      // Festive background elements
      for(let i=0;i<8;i++){const bx=(i*137+s.frame*0.2)%W,by=(i*91+s.frame*0.1)%H;ctx.fillStyle=COLS[i%COLS.length]+'12';ctx.beginPath();ctx.arc(bx,by,15+i*3,0,Math.PI*2);ctx.fill();}
      // Spawn objects
      if(s.frame%Math.max(15,50-s.sig.success*2)===0){s.objects.push({x:40+Math.random()*(W-80),y:-20,vy:2+Math.random()*2,r:22,color:COLS[Math.floor(Math.random()*COLS.length)],active:true,id:s.nextId++});}
      // Basket
      ctx.save();ctx.strokeStyle=ACCENT;ctx.lineWidth=4;ctx.shadowBlur=8;ctx.shadowColor=ACCENT;
      ctx.beginPath();ctx.moveTo(s.basketX-44,H-60);ctx.lineTo(s.basketX-50,H-20);ctx.lineTo(s.basketX+50,H-20);ctx.lineTo(s.basketX+44,H-60);ctx.stroke();ctx.restore();
      // Objects
      for(let i=s.objects.length-1;i>=0;i--){const obj=s.objects[i];if(!obj.active){s.objects.splice(i,1);continue;}
        obj.y+=obj.vy;
        if(obj.y+obj.r>H-60&&obj.y-obj.r<H-20&&Math.abs(obj.x-s.basketX)<50){obj.active=false;s.sig.total++;s.sig.success++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;const mult=s.sig.streakCurrent>=3?2:1;s.sig.score+=mult;s.scorePop=Date.now()+300;setScoreDisplay(s.sig.score);sfx.collect();hapticScore();if(s.sig.streakCurrent>=3)hapticCombo(s.sig.streakCurrent);s.floats.push({x:obj.x,y:obj.y-20,text:'+'+mult,alpha:1,vy:-2.5,color:'#fbbf24'});}
        else if(obj.y>H+30){obj.active=false;s.sig.fail++;s.sig.streakCurrent=0;hapticFail();}
        else{ctx.save();ctx.shadowBlur=10;ctx.shadowColor=obj.color;ctx.fillStyle=obj.color;ctx.beginPath();ctx.arc(obj.x,obj.y,obj.r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffffff';ctx.font='20px sans-serif';ctx.textAlign='center';ctx.fillText(GAME_EMOJI,obj.x,obj.y+7);ctx.restore();}}
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/300;ctx.save();ctx.globalAlpha=t;ctx.font='bold '+Math.round(38*(1+(1-t)*0.3))+'px sans-serif';ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(''+s.sig.score,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.95;});
      animRef.current=requestAnimationFrame(loop);};
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onPointerMove=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;const rect=canvas.getBoundingClientRect();s.basketX=Math.max(55,Math.min(canvas.width-55,(e.clientX-rect.left)*(canvas.width/rect.width)));};
    const onPointerDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;const rect=canvas.getBoundingClientRect();s.basketX=Math.max(55,Math.min(canvas.width-55,(e.clientX-rect.left)*(canvas.width/rect.width)));};
    canvas.addEventListener('pointermove',onPointerMove);canvas.addEventListener('pointerdown',onPointerDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointermove',onPointerMove);canvas.removeEventListener('pointerdown',onPointerDown);};
  },[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(n:string,a:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,n,a);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(<GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
    {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel={'Play! '+GAME_EMOJI} accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
    {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
    {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label={'Dream Catch game canvas'}/>
    {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
    {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
      insights={[{label:'Caught',value:String(finalSig.success),color:ACCENT},{label:'Missed',value:String(finalSig.fail),color:'#ef4444'},{label:'Best Streak',value:'x'+finalSig.maxStreak,color:'#fbbf24'},{label:'Total',value:String(finalSig.total),color:'#06b6d4'}]}
      accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.success>=15}/>}
  </GameShell>);}