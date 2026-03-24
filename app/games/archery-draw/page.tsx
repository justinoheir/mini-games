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
const GAME_ID = 'archery-draw'; const ACCENT = '#16a34a'; const DURATION = 60; const GAME_EMOJI = '🏹'; const GAME_TITLE = 'Archery Draw'; const GAME_TAGLINE = 'Pull back. Wait. Release.';
interface Signals { shots: number; bullseyes: number; inners: number; outers: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  const bull = sig.shots > 0 ? sig.bullseyes / sig.shots : 0;
  if (bull >= 0.7) return 'Robin Hood 🏹';
  if (sig.maxStreak >= 5) return 'Arrow Master ⚡';
  if (bull >= 0.4) return 'Steady Archer 🎯';
  return 'Learning the Draw 🌱';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  targetX: number; targetY: number; aimX: number; aimY: number; aimOscillation: number;
  drawing: boolean; drawLevel: number; drawStart: number; aimLocked: boolean; lockTimer: number;
  arrowFlight: boolean; arrowX: number; arrowY: number; arrowVX: number; arrowVY: number;
  accentColor: string; floats: Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>; scorePop: number; frame: number;
}

export default function ArcheryDraw() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null); const animRef = useRef(0); const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef = useRef<GameState>({ running:false,timeLeft:DURATION,sig:{shots:0,bullseyes:0,inners:0,outers:0,maxStreak:0,streakCurrent:0,score:0},targetX:0,targetY:0,aimX:0,aimY:0,aimOscillation:0,drawing:false,drawLevel:0,drawStart:0,aimLocked:false,lockTimer:0,arrowFlight:false,arrowX:0,arrowY:0,arrowVX:0,arrowVY:0,accentColor:ACCENT,floats:[],scorePop:0,frame:0 });
  const [phase,setPhase]=useState<Phase>('start'); const [timeLeft,setTimeLeft]=useState(DURATION); const [scoreDisplay,setScoreDisplay]=useState(0); const [finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem(`pb_${GAME_ID}`)??"0");if(s.sig.score>pb)localStorage.setItem(`pb_${GAME_ID}`,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current; const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={shots:0,bullseyes:0,inners:0,outers:0,maxStreak:0,streakCurrent:0,score:0};
    s.targetX=W/2;s.targetY=H*0.3;s.aimX=W/2;s.aimY=H*0.3;s.drawing=false;s.arrowFlight=false;s.frame=0;s.floats=[];s.scorePop=0;
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return; ctx.clearRect(0,0,W,H); s.frame++;
      // Forest background
      ctx.fillStyle='#0a1a0a'; ctx.fillRect(0,0,W,H);
      // Trees silhouette
      ctx.fillStyle='#0d240d';
      for(let i=0;i<8;i++){const tx=(i/8)*W+20;ctx.beginPath();ctx.moveTo(tx-20,H);ctx.lineTo(tx,H*0.1);ctx.lineTo(tx+20,H);ctx.closePath();ctx.fill();}
      // Target
      const rings=[{r:60,color:'#ffffff'},{r:45,color:'#000000'},{r:30,color:'#3b82f6'},{r:20,color:'#ef4444'},{r:10,color:'#ef4444'}];
      rings.forEach(ring=>{ctx.fillStyle=ring.color;ctx.beginPath();ctx.arc(s.targetX,s.targetY,ring.r,0,Math.PI*2);ctx.fill();});
      ctx.strokeStyle='#00000044';ctx.lineWidth=1;rings.forEach(r=>{ctx.beginPath();ctx.arc(s.targetX,s.targetY,r.r,0,Math.PI*2);ctx.stroke();});
      // Aim oscillation
      if(s.drawing&&!s.aimLocked){s.aimOscillation+=0.06;const wobble=(1-s.drawLevel)*30;s.aimX=s.targetX+Math.sin(s.aimOscillation*1.7)*wobble;s.aimY=s.targetY+Math.cos(s.aimOscillation)*wobble;}
      // Aim indicator
      if(s.drawing&&!s.arrowFlight){
        ctx.save();ctx.strokeStyle=s.aimLocked?'#4ade80':'rgba(255,255,255,0.5)';ctx.lineWidth=2;ctx.setLineDash([4,4]);
        ctx.beginPath();ctx.arc(s.aimX,s.aimY,8+Math.sin(s.frame*0.1)*3,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        // Crosshair
        ctx.strokeStyle=s.aimLocked?'#4ade80':'rgba(255,255,255,0.4)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(s.aimX-14,s.aimY);ctx.lineTo(s.aimX+14,s.aimY);ctx.stroke();
        ctx.beginPath();ctx.moveTo(s.aimX,s.aimY-14);ctx.lineTo(s.aimX,s.aimY+14);ctx.stroke();
        ctx.restore();
      }
      // Arrow flight
      if(s.arrowFlight){s.arrowX+=s.arrowVX;s.arrowY+=s.arrowVY;s.arrowVY+=0.3;
        const dist=Math.hypot(s.arrowX-s.targetX,s.arrowY-s.targetY);
        if(dist<65||s.arrowY>H+20||s.arrowX<-10||s.arrowX>W+10){
          if(dist<65){
            s.sig.shots++;const d=dist;
            const isBull=d<10,isInner=d<30,isOuter=d<65;
            const pts=isBull?5:isInner?3:isOuter?1:0;
            if(isBull)s.sig.bullseyes++;else if(isInner)s.sig.inners++;else s.sig.outers++;
            s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;
            const mult=s.sig.streakCurrent>=3?2:1;s.sig.score+=pts*mult;s.scorePop=Date.now()+400;setScoreDisplay(s.sig.score);
            sfx.success();hapticScore();
            s.floats.push({x:s.targetX,y:s.targetY-40,text:isBull?`+${pts*mult} 🎯 BULL!`:`+${pts*mult}`,alpha:1,vy:-2,color:isBull?'#fbbf24':'#4ade80'});
          }
          s.arrowFlight=false;
        }
        // Draw arrow
        ctx.save();ctx.strokeStyle='#d97706';ctx.lineWidth=3;const angle=Math.atan2(s.arrowVY,s.arrowVX);
        ctx.translate(s.arrowX,s.arrowY);ctx.rotate(angle);
        ctx.beginPath();ctx.moveTo(-15,0);ctx.lineTo(12,0);ctx.stroke();
        ctx.fillStyle='#d97706';ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(6,-4);ctx.lineTo(6,4);ctx.closePath();ctx.fill();
        ctx.restore();
      }
      // Draw bow (bottom)
      ctx.save();ctx.strokeStyle='#8b4513';ctx.lineWidth=4;
      ctx.beginPath();ctx.arc(W/2,H+40,120,Math.PI*1.2,Math.PI*1.8);ctx.stroke();
      if(s.drawing){ctx.strokeStyle='#fbbf24';ctx.lineWidth=2;
        const stretchX=W/2,stretchY=H-60+s.drawLevel*30;
        ctx.beginPath();ctx.moveTo(W/2-50,H-30);ctx.lineTo(stretchX,stretchY);ctx.lineTo(W/2+50,H-30);ctx.stroke();}
      ctx.restore();
      // Draw level meter
      ctx.fillStyle='#1a1a2e';ctx.fillRect(20,H-80,20,60);
      ctx.fillStyle=ACCENT;ctx.fillRect(20,H-80+60*(1-s.drawLevel),20,60*s.drawLevel);
      ctx.strokeStyle=ACCENT+'44';ctx.lineWidth=1;ctx.strokeRect(20,H-80,20,60);
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/400;ctx.save();ctx.globalAlpha=t;ctx.font=`bold ${Math.round(38*(1+(1-t)*0.3))}px sans-serif`;ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(`${s.sig.score}`,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.96;});
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(s.arrowFlight)return;s.drawing=true;s.drawStart=Date.now();s.drawLevel=0;s.aimLocked=false;s.aimOscillation=0;};
    const onMove=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(!s.drawing)return;s.drawLevel=Math.min(1,(Date.now()-s.drawStart)/1500);if(s.drawLevel>=0.8)s.aimLocked=true;};
    const onUp=()=>{if(phase!=='playing')return;const s=stateRef.current;if(!s.drawing)return;s.drawing=false;
      if(s.drawLevel>0.2){const dx=s.aimX-W/2,dy=s.aimY-(canvas.height-50);const dist=Math.sqrt(dx*dx+dy*dy);const speed=8+s.drawLevel*8;s.arrowX=W/2;s.arrowY=canvas.height-80;s.arrowVX=(dx/dist)*speed;s.arrowVY=(dy/dist)*speed;s.arrowFlight=true;sfx.click();hapticImpact();}
      s.drawLevel=0;};
    canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerup',onUp);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointermove',onMove);canvas.removeEventListener('pointerup',onUp);};
  },[phase]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(name:string,avatar:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,name,avatar);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Hold to draw the bow. Aim settles when fully drawn. Release for glory!" ctaLabel="Draw! 🏹" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label="Archery bow game canvas"/>
      {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
      {phase==='done'&&finalSig&&(<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{label:'Bullseyes',value:String(finalSig.bullseyes),color:'#ef4444'},{label:'Inner Ring',value:String(finalSig.inners),color:ACCENT},{label:'Best Streak',value:`×${finalSig.maxStreak}`,color:'#fbbf24'},{label:'Total Shots',value:String(finalSig.shots),color:'#06b6d4'}]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.bullseyes>=3}/>)}
    </GameShell>
  );
}
