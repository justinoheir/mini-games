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
const GAME_ID='color-word';const ACCENT='#f43f5e';const DURATION=30;const GAME_EMOJI='🎨';const GAME_TITLE='Color Word';const GAME_TAGLINE='Ignore the meaning. Trust your eyes.';
interface Signals{total:number;correct:number;wrong:number;avgMs:number;msSum:number;maxStreak:number;streakCurrent:number;score:number;}
function getPersonality(sig:Signals){const acc=sig.total>0?sig.correct/sig.total:0;if(acc>=0.85&&sig.maxStreak>=6)return'Stroop Master 🧠';if(acc>=0.75)return'Mind Over Matter 💜';if(sig.maxStreak>=5)return'Selective Focus 🎯';return'Brain Trainer 🏋️';}
type Phase='start'|'countdown'|'playing'|'done';
const COLORS=[{name:'RED',hex:'#ef4444'},{name:'BLUE',hex:'#3b82f6'},{name:'GREEN',hex:'#22c55e'},{name:'YELLOW',hex:'#fbbf24'},{name:'PURPLE',hex:'#a855f7'},{name:'ORANGE',hex:'#f97316'}];
interface StroopCard{word:string;inkColor:string;correctAnswer:string;}
function makeCard():StroopCard{const ink=COLORS[Math.floor(Math.random()*COLORS.length)];let word=COLORS[Math.floor(Math.random()*COLORS.length)];while(word===ink&&Math.random()<0.7)word=COLORS[Math.floor(Math.random()*COLORS.length)];return{word:word.name,inkColor:ink.hex,correctAnswer:ink.name};}
interface GameState{running:boolean;timeLeft:number;sig:Signals;card:StroopCard|null;shownAt:number;feedback:boolean|null;feedbackTimer:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;frame:number;}

export default function ColorWord(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{total:0,correct:0,wrong:0,avgMs:0,msSum:0,maxStreak:0,streakCurrent:0,score:0},card:null,shownAt:0,feedback:null,feedbackTimer:0,accentColor:ACCENT,floats:[],scorePop:0,frame:0});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");if(s.sig.score>pb)localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);
  const nextCard=useCallback(()=>{const s=stateRef.current;s.card=makeCard();s.shownAt=Date.now();s.feedback=null;s.feedbackTimer=0;},[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={total:0,correct:0,wrong:0,avgMs:0,msSum:0,maxStreak:0,streakCurrent:0,score:0};
    s.frame=0;s.floats=[];s.scorePop=0;nextCard();
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      // Psychedelic background
      const bg=ctx.createRadialGradient(W/2,H/3,0,W/2,H/2,H);bg.addColorStop(0,'#1a0020');bg.addColorStop(1,'#0a0012');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
      // Animated color rings
      for(let r=0;r<3;r++){ctx.save();ctx.strokeStyle=COLORS[(r+Math.floor(s.frame/30))%COLORS.length].hex+'18';ctx.lineWidth=2;ctx.beginPath();ctx.arc(W/2,H*0.25,50+r*30+Math.sin(s.frame*0.02+r)*10,0,Math.PI*2);ctx.stroke();ctx.restore();}
      if(s.feedbackTimer>0)s.feedbackTimer--;
      if(s.feedback!==null&&s.feedbackTimer>0){ctx.fillStyle=s.feedback?'rgba(74,222,128,0.15)':'rgba(239,68,68,0.15)';ctx.fillRect(0,0,W,H);}
      const card=s.card;if(!card)return;
      // "TAP THE INK COLOR:" prompt
      ctx.save();ctx.fillStyle='rgba(255,255,255,0.5)';ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.fillText('TAP THE INK COLOR →',W/2,H*0.12);ctx.restore();
      // The word in ink color
      ctx.save();ctx.shadowBlur=16;ctx.shadowColor=card.inkColor;ctx.fillStyle=card.inkColor;ctx.font='bold '+Math.min(72,W*0.2)+'px sans-serif';ctx.textAlign='center';ctx.fillText(card.word,W/2,H*0.32);ctx.restore();
      // Color options
      const optPerRow=3,optW=W/4,optH=60,startX=(W-optPerRow*optW)/2;
      COLORS.slice(0,6).forEach((col,i)=>{
        const row=Math.floor(i/optPerRow),col2=i%optPerRow;const ox=startX+col2*optW+optW*0.05,oy=H*0.42+row*(optH+12);
        const isAnswer=col.name===card.correctAnswer;const isWrong=s.feedback===false&&col.name!==card.correctAnswer;
        ctx.save();ctx.shadowBlur=isAnswer&&s.feedback===true?20:4;ctx.shadowColor=col.hex;
        ctx.fillStyle=isAnswer&&s.feedback===true?'#1a3a1a':isWrong?'#3a1a1a':'#1a1030';
        ctx.strokeStyle=col.hex;ctx.lineWidth=3;
        ctx.beginPath();(ctx as any).roundRect?.(ox,oy,optW*0.9,optH,10)??ctx.rect(ox,oy,optW*0.9,optH);ctx.fill();ctx.stroke();
        ctx.fillStyle=col.hex;ctx.font='bold '+Math.min(18,W*0.045)+'px sans-serif';ctx.textAlign='center';
        ctx.fillText(col.name,ox+optW*0.45,oy+optH/2+6);ctx.restore();
      });
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/400;ctx.save();ctx.globalAlpha=t;ctx.font='bold '+Math.round(38*(1+(1-t)*0.3))+'px sans-serif';ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(''+s.sig.score,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.96;});
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,nextCard]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onPointerDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(s.feedback!==null||!s.card)return;
      const rect=canvas.getBoundingClientRect();const px=(e.clientX-rect.left)*(canvas.width/rect.width),py=(e.clientY-rect.top)*(canvas.height/rect.height);
      const W=canvas.width,H=canvas.height;const optPerRow=3,optW=W/4,optH=60,startX=(W-optPerRow*optW)/2;
      for(let i=0;i<6;i++){const row=Math.floor(i/optPerRow),col=i%optPerRow;const ox=startX+col*optW+optW*0.05,oy=H*0.42+row*(optH+12);
        if(px>=ox&&px<=ox+optW*0.9&&py>=oy&&py<=oy+optH){const chosen=COLORS[i];const ms=Date.now()-s.shownAt;s.sig.total++;s.sig.msSum+=ms;
          if(chosen.name===s.card.correctAnswer){s.sig.correct++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;const mult=s.sig.streakCurrent>=3?2:1;const pts=mult*(ms<600?3:2);s.sig.score+=pts;s.scorePop=Date.now()+400;setScoreDisplay(s.sig.score);s.feedback=true;sfx.collect();hapticScore();if(s.sig.streakCurrent>=3)hapticCombo(s.sig.streakCurrent);s.floats.push({x:W/2,y:H*0.38,text:'+'+pts+(s.sig.streakCurrent>=3?' 🧠':' '),alpha:1,vy:-2,color:'#fbbf24'});}
          else{s.sig.wrong++;s.sig.streakCurrent=0;s.feedback=false;sfx.collision();hapticFail();}
          s.feedbackTimer=15;setTimeout(()=>{if(s.running)nextCard();},350);break;}}};
    canvas.addEventListener('pointerdown',onPointerDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onPointerDown);};
  },[phase,nextCard]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(n:string,a:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,n,a);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="The word says one color but is WRITTEN in another. Tap the INK color, not the word!" ctaLabel="Focus! 🎨" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label="Color word Stroop game canvas"/>
      {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
      {phase==='done'&&finalSig&&(<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{label:'Accuracy',value:`${finalSig.total>0?Math.round(finalSig.correct/finalSig.total*100):0}%`,color:ACCENT},{label:'Correct',value:String(finalSig.correct),color:'#4ade80'},{label:'Best Streak',value:'×'+finalSig.maxStreak,color:'#fbbf24'},{label:'Avg Speed',value:`${finalSig.total>0?Math.round(finalSig.msSum/finalSig.total):0}ms`,color:'#06b6d4'}]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct>=8}/>)}
    </GameShell>
  );
}
