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
const GAME_ID='equation-tap';const ACCENT='#facc15';const DURATION=45;const GAME_EMOJI='🧮';const GAME_TITLE='Equation Tap';const GAME_TAGLINE='Solve it. Tap it. Beat the clock.';
interface Signals{total:number;correct:number;wrong:number;avgMs:number;msSum:number;maxStreak:number;streakCurrent:number;score:number;}
function getPersonality(sig:Signals){const acc=sig.total>0?sig.correct/sig.total:0;const avg=sig.total>0?sig.msSum/sig.total:9999;if(acc>=0.9&&avg<1000)return'Math Genius 🧮';if(acc>=0.8&&sig.maxStreak>=6)return'Calculator Mind 💡';if(avg<900)return'Quick Counter ⚡';return'Problem Solver 📐';}
type Phase='start'|'countdown'|'playing'|'done';
interface Question{a:number;b:number;op:string;answer:number;options:number[];}

function makeQuestion(level:number):Question{
  const ops=['+','-','×'];const op=ops[Math.floor(Math.random()*(level>3?3:level>1?2:1))];
  let a=1+Math.floor(Math.random()*(10+level*3)),b=1+Math.floor(Math.random()*(10+level*2)),answer=0;
  if(op==='+'){answer=a+b;}else if(op==='-'){if(a<b)[a,b]=[b,a];answer=a-b;}else{a=1+Math.floor(Math.random()*10);b=1+Math.floor(Math.random()*(level>4?10:6));answer=a*b;}
  const opts=new Set([answer]);while(opts.size<3){const w=answer+Math.floor(Math.random()*11)-5;if(w!==answer&&w>=0)opts.add(w);}
  return{a,b,op,answer,options:[...opts].sort(()=>Math.random()-0.5)};
}

interface GameState{running:boolean;timeLeft:number;sig:Signals;q:Question|null;shownAt:number;level:number;feedbackCorrect:boolean|null;feedbackTimer:number;accentColor:string;floats:Array<{x:number;y:number;text:string;alpha:number;vy:number;color:string}>;scorePop:number;frame:number;}

export default function EquationTap(){
  const theme=useBrandTheme();
  const canvasRef=useRef<HTMLCanvasElement>(null);const animRef=useRef(0);const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stateRef=useRef<GameState>({running:false,timeLeft:DURATION,sig:{total:0,correct:0,wrong:0,avgMs:0,msSum:0,maxStreak:0,streakCurrent:0,score:0},q:null,shownAt:0,level:1,feedbackCorrect:null,feedbackTimer:0,accentColor:ACCENT,floats:[],scorePop:0,frame:0});
  const[phase,setPhase]=useState<Phase>('start');const[timeLeft,setTimeLeft]=useState(DURATION);const[scoreDisplay,setScoreDisplay]=useState(0);const[finalSig,setFinalSig]=useState<Signals|null>(null);
  const playerSessionRef=useRef<PlayerSession|null>(null);
  useEffect(()=>{stateRef.current.accentColor=theme.colors.accent??ACCENT;},[theme]);
  const endGame=useCallback(()=>{const s=stateRef.current;s.running=false;cancelAnimationFrame(animRef.current);if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}const pb=parseInt(localStorage.getItem('pb_'+GAME_ID)??"0");if(s.sig.score>pb)localStorage.setItem('pb_'+GAME_ID,String(s.sig.score));setFinalSig({...s.sig});setPhase('done');hapticVictory();},[]);

  const nextQ=useCallback(()=>{const s=stateRef.current;s.q=makeQuestion(s.level);s.shownAt=Date.now();s.feedbackCorrect=null;s.feedbackTimer=0;},[]);

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const s=stateRef.current;const W=canvas.width,H=canvas.height;
    s.running=true;s.timeLeft=DURATION;s.sig={total:0,correct:0,wrong:0,avgMs:0,msSum:0,maxStreak:0,streakCurrent:0,score:0};
    s.level=1;s.frame=0;s.floats=[];s.scorePop=0;nextQ();
    setScoreDisplay(0);setTimeLeft(DURATION);setPhase('playing');
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();endGame();}},1000);
    const OPTS_W=W*0.28,OPTS_H=70;
    const loop=()=>{
      if(!s.running)return;ctx.clearRect(0,0,W,H);s.frame++;
      // Academic background - deep indigo
      const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#1e1b4b');bg.addColorStop(1,'#0f0e26');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
      // Floating math symbols
      const symbols=['∑','∫','π','√','∞','∂','÷','×','±','≠'];
      symbols.forEach((sym,i)=>{const sx=(i*137+s.frame*0.2)%W,sy=(i*97+s.frame*0.1)%H;ctx.fillStyle='rgba(250,204,21,0.06)';ctx.font='24px sans-serif';ctx.textAlign='center';ctx.fillText(sym,sx,sy);});
      if(s.feedbackTimer>0)s.feedbackTimer--;
      // Feedback flash
      if(s.feedbackCorrect!==null&&s.feedbackTimer>0){const alpha=s.feedbackTimer/20;ctx.fillStyle=s.feedbackCorrect?`rgba(74,222,128,${alpha*0.2})`:`rgba(239,68,68,${alpha*0.2})`;ctx.fillRect(0,0,W,H);}
      const q=s.q;if(!q)return;
      // Equation display
      ctx.save();ctx.shadowBlur=12;ctx.shadowColor=ACCENT;ctx.fillStyle='#ffffff';ctx.font=`bold ${Math.min(56,W*0.14)}px sans-serif`;ctx.textAlign='center';
      ctx.fillText(`${q.a} ${q.op} ${q.b} = ?`,W/2,H*0.35);ctx.restore();
      // Timer bar (question)
      const elapsed=Date.now()-s.shownAt;const questionTime=4000-s.level*300;const pct=Math.max(0,1-elapsed/questionTime);ctx.fillStyle='#1e1b4b';ctx.fillRect(20,H*0.45,W-40,8);ctx.fillStyle=pct>0.5?'#4ade80':pct>0.25?'#fbbf24':'#ef4444';ctx.fillRect(20,H*0.45,(W-40)*pct,8);
      // Auto-advance if time up (count as wrong)
      if(elapsed>questionTime&&s.feedbackCorrect===null){s.sig.wrong++;s.sig.streakCurrent=0;s.sig.total++;s.feedbackCorrect=false;s.feedbackTimer=15;hapticFail();sfx.collision();setTimeout(()=>{if(s.running)nextQ();},400);}
      // Draw options as large buttons
      const optW=OPTS_W,optH=OPTS_H,gap=(W-3*optW)/4;
      q.options.forEach((opt,i)=>{
        const ox=gap+(optW+gap)*i,oy=H*0.55;
        const highlight=s.feedbackCorrect!==null&&opt===q.answer;
        const isWrong=s.feedbackCorrect===false&&opt!==q.answer;
        ctx.save();ctx.shadowBlur=highlight?20:8;ctx.shadowColor=highlight?'#4ade80':ACCENT;
        ctx.fillStyle=highlight?'#166534':isWrong?'#7f1d1d':'#1e1b5b';
        ctx.strokeStyle=highlight?'#4ade80':isWrong?'#ef4444':ACCENT;ctx.lineWidth=2;
        ctx.beginPath();(ctx as any).roundRect?.(ox,oy,optW,optH,12)??ctx.rect(ox,oy,optW,optH);ctx.fill();ctx.stroke();
        ctx.fillStyle='#ffffff';ctx.font='bold '+Math.min(32,W*0.08)+'px sans-serif';ctx.textAlign='center';
        ctx.fillText(String(opt),ox+optW/2,oy+optH/2+10);
        ctx.restore();
      });
      if(s.scorePop>Date.now()){const t=(s.scorePop-Date.now())/400;ctx.save();ctx.globalAlpha=t;ctx.font='bold '+Math.round(38*(1+(1-t)*0.3))+'px sans-serif';ctx.fillStyle=ACCENT;ctx.textAlign='center';ctx.fillText(''+s.sig.score,W/2,90);ctx.restore();}
      s.floats=s.floats.filter(f=>f.alpha>0.02);s.floats.forEach(f=>{ctx.save();ctx.globalAlpha=f.alpha;ctx.fillStyle=f.color;ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.restore();f.y+=f.vy;f.alpha*=0.96;});
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,nextQ]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;};resize();window.addEventListener('resize',resize);
    const onPointerDown=(e:PointerEvent)=>{if(phase!=='playing')return;const s=stateRef.current;if(s.feedbackCorrect!==null||!s.q)return;
      const rect=canvas.getBoundingClientRect();const px=(e.clientX-rect.left)*(canvas.width/rect.width);const py=(e.clientY-rect.top)*(canvas.height/rect.height);
      const W=canvas.width,H=canvas.height;const OPTS_W=W*0.28,OPTS_H=70,gap=(W-3*OPTS_W)/4;
      for(let i=0;i<s.q.options.length;i++){const ox=gap+(OPTS_W+gap)*i,oy=H*0.55;
        if(px>=ox&&px<=ox+OPTS_W&&py>=oy&&py<=oy+OPTS_H){
          const opt=s.q.options[i];const ms=Date.now()-s.shownAt;s.sig.total++;s.sig.msSum+=ms;
          if(opt===s.q.answer){s.sig.correct++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;const mult=s.sig.streakCurrent>=3?2:1;const pts=mult*(ms<800?3:ms<1500?2:1);s.sig.score+=pts;s.scorePop=Date.now()+400;setScoreDisplay(s.sig.score);s.feedbackCorrect=true;sfx.collect();hapticScore();if(s.sig.streakCurrent>=3)hapticCombo(s.sig.streakCurrent);s.level=Math.min(8,1+Math.floor(s.sig.correct/4));s.floats.push({x:W/2,y:H*0.45,text:'+'+pts+(ms<800?' FAST! ⚡':''),alpha:1,vy:-2.5,color:'#fbbf24'});}
          else{s.sig.wrong++;s.sig.streakCurrent=0;s.feedbackCorrect=false;sfx.collision();hapticFail();}
          s.feedbackTimer=15;setTimeout(()=>{if(s.running)nextQ();},400);break;
        }}};
    canvas.addEventListener('pointerdown',onPointerDown);
    return()=>{window.removeEventListener('resize',resize);canvas.removeEventListener('pointerdown',onPointerDown);};
  },[phase,nextQ]);
  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);},[]);
  const handleStart=useCallback(async(n:string,a:string)=>{playerSessionRef.current=savePlayerSession(GAME_ID,n,a);await initAudio();setPhase('countdown');},[]);
  const handlePlayAgain=useCallback(()=>{setPhase('start');setScoreDisplay(0);setTimeLeft(DURATION);setFinalSig(null);},[]);
  return(
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Solve math equations and tap the correct answer fast!" ctaLabel="Calculate! 🧮" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={startLoop} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&(<><canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}} role="img" aria-label="Math equation game canvas"/>
      {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=10},{label:'SCORE',value:scoreDisplay}]}/>}</>)}
      {phase==='done'&&finalSig&&(<EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{label:'Accuracy',value:`${finalSig.total>0?Math.round(finalSig.correct/finalSig.total*100):0}%`,color:ACCENT},{label:'Correct',value:String(finalSig.correct),color:'#4ade80'},{label:'Best Streak',value:'×'+finalSig.maxStreak,color:'#fbbf24'},{label:'Avg Speed',value:`${finalSig.total>0?Math.round(finalSig.msSum/finalSig.total):0}ms`,color:'#06b6d4'}]}
        accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct>=10}/>)}
    </GameShell>
  );
}
