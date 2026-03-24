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
const GAME_ID='voice-sculpt';const ACCENT='#d946ef';const DURATION=45;const GAME_EMOJI='🎤';const GAME_TITLE='Voice Sculpt';const GAME_TAGLINE='Hum to shape the clay.';
interface Signals{total:number;success:number;fail:number;maxStreak:number;streakCurrent:number;score:number;bonus:number;}
function getPersonality(s:Signals){const a=s.total>0?s.success/s.total:0;if(a>=0.9&&s.maxStreak>=5)return'Champion '+GAME_EMOJI;if(s.maxStreak>=6)return'On Fire 🔥';if(a>=0.7)return'Skilled Player 🎯';return'Keep Practicing 💪';}
type Phase='start'|'countdown'|'playing'|'done';
interface GameState{running:boolean;timeLeft:number;sig:Signals;frame:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;activeZone:number;zoneTimer:number;particles:Array<{x:number;y:number;vx:number;vy:number;alpha:number;color:string}>;}
export default function VoiceSculpt(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0},frame:0,accentColor:ACCENT,floats:[],scorePop:0,activeZone:-1,zoneTimer:0,particles:[]});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");if(s.sig.score>pb)localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);
  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={total:0,success:0,fail:0,maxStreak:0,streakCurrent:0,score:0,bonus:0};s.frame=0;s.floats=[];s.scorePop=0;s.activeZone=Math.floor(Math.random()*6);s.zoneTimer=60;s.particles=[];
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const COLS=3;const ROWS=2;const cellW=Math.floor(W/COLS);const cellH=Math.floor(H*0.65/ROWS);const gridY=H*0.15;
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      ctx.fillStyle='#18000f';ctx.fillRect(0,0,W,H);
      ctx.strokeStyle=ACCENT+'06';ctx.lineWidth=1;
      for(let gx=0;gx<W;gx+=28){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,H);ctx.stroke();}
      for(let gy=0;gy<H;gy+=28){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(W,gy);ctx.stroke();}
      s.zoneTimer--;if(s.zoneTimer<=0){s.activeZone=Math.floor(Math.random()*(COLS*ROWS));s.zoneTimer=Math.max(20,70-s.sig.success*3);}
      for(let z=0;z<COLS*ROWS;z++){const row=Math.floor(z/COLS),col=z%COLS;const zx=col*cellW,zy=gridY+row*cellH;const isActive=z===s.activeZone;
        ctx.save();ctx.shadowBlur=isActive?18:3;ctx.shadowColor=isActive?ACCENT:'transparent';
        ctx.fillStyle=isActive?ACCENT+'44':'rgba(255,255,255,0.04)';ctx.strokeStyle=isActive?ACCENT:'rgba(255,255,255,0.12)';ctx.lineWidth=isActive?3:1;
        ctx.beginPath();(ctx as any).roundRect?.(zx+6,zy+4,cellW-12,cellH-8,10)??ctx.rect(zx+6,zy+4,cellW-12,cellH-8);ctx.fill();ctx.stroke();
        if(isActive){ctx.fillStyle='#ffffff';ctx.font='bold '+Math.min(32,cellW*0.15)+'px sans-serif';ctx.textAlign='center';ctx.fillText(GAME_EMOJI,zx+cellW/2,zy+cellH/2+10);}
        ctx.restore();}
      s.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.alpha*=0.91;p.vy+=0.1;});s.particles=s.particles.filter(p=>p.alpha>0.05);
      s.particles.forEach(p=>{ctx.save();ctx.globalAlpha=p.alpha;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();ctx.restore();});
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/300;ctx.save();ctx.globalAlpha=t;ctx.font='bold '+Math.round(36*(1+(1-t)*0.3))+'px sans-serif';ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(''+s.sig.score,W/2,H*0.88);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 20px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.95;});
      animRef.current=requestAnimationFrame(loop);};
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onPointerDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;const rect=canvas.getBoundingClientRect();const px=(e.clientX-rect.left)*(canvas.width/rect.width),py=(e.clientY-rect.top)*(canvas.height/rect.height);
      const W=canvas.width,H=canvas.height;const COLS=3;const ROWS=2;const cellW=Math.floor(W/COLS);const cellH=Math.floor(H*0.65/ROWS);const gridY=H*0.15;
      for(let z=0;z<COLS*ROWS;z++){const row=Math.floor(z/COLS),col=z%COLS;const zx=col*cellW,zy=gridY+row*cellH;
        if(px>=zx+6&&px<=zx+cellW-6&&py>=zy+4&&py<=zy+cellH-4){s.sig.total++;
          if(z===s.activeZone){s.sig.success++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;const mult=s.sig.streakCurrent>=3?2:1;s.sig.score+=mult;s.scorePop=Date.now()+300;setScoreDisplay(s.sig.score);sfx.collect();hapticScore();if(s.sig.streakCurrent>=3)hapticCombo(s.sig.streakCurrent);for(let p=0;p<6;p++)s.particles.push({x:px,y:py,vx:(Math.random()-0.5)*5,vy:-2-Math.random()*3,alpha:1,color:ACCENT});s.floats.push({x:px,y:py-20,text:'+'+mult+(s.sig.streakCurrent>=3?' 🔥':''),alpha:1,vy:-2.5,color:'#fbbf24'});s.activeZone=Math.floor(Math.random()*(COLS*ROWS));s.zoneTimer=Math.max(20,70-s.sig.success*3);}
          else{s.sig.fail++;s.sig.streakCurrent=0;sfx.collision();hapticFail();s.floats.push({x:px,y:py-20,text:'Miss!',alpha:1,vy:-1.5,color:'#ef4444'});}
          break;}}};
    canvas.addEventListener('pointerdown',onPointerDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onPointerDown);};
  },[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(n:string,a:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,n,a);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(<GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
    {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel={'Play! '+GAME_EMOJI} accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
    {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
    {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label={'Voice Sculpt game canvas'}/>
    {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
    {phase==='done'&&finalSig&&<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
      insights={[{label:'Success',value:String(finalSig.success),color:ACCENT},{label:'Accuracy',value:finalSig.total>0?Math.round(finalSig.success/finalSig.total*100)+'%':'0%',color:'#4ade80'},{label:'Best Streak',value:'x'+finalSig.maxStreak,color:'#fbbf24'},{label:'Attempts',value:String(finalSig.total),color:'#06b6d4'}]}
      accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.success>=8}/>}
  </GameShell>);}