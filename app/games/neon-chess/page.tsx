'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'neon-chess';
const ACCENT = '#00ffff';
const DURATION = 60;
const GAME_EMOJI = '♟️';
const GAME_TITLE = 'Neon Chess';
const GAME_TAGLINE = 'One move. Best move. Neon style.';
const BG_COLOR = '#000f0f';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'minimal';
const PB_KEY = 'mg_pb_neon-chess';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Grandmaster ♟️';
  if (acc >= 0.55) return 'Tactician 🎯';
  if (sig.maxStreak >= 4) return 'Calculated 🧠';
  return 'Blunder King 😬';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function NeonChessGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const QUESTIONS: {q:string,opts:string[],c:number}[] = [{"q":"Knight on e4. Can reach f6?","opts":["Yes","No","Maybe","Depends"],"c":0},{"q":"Rook on a1. Reach h1 in one move?","opts":["Yes","No","Only if empty","Diagonally"],"c":0},{"q":"Bishop moves?","opts":["Straight","Diagonally","L-shape","Any"],"c":1},{"q":"Checkmate means?","opts":["King in check, no legal move","King captured","Draw","Stalemate"],"c":0}];
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, cur:{q:'',opts:[] as string[],c:0,spawnTime:0}, btns:[] as {x:number,y:number,w:number,h:number,label:string,ok:boolean,flash:number}[] });

  const newQ = useCallback((W:number,H:number)=>{
    const s=stateRef.current; const q=QUESTIONS[Math.floor(Math.random()*QUESTIONS.length)];
    const opts=[...q.opts]; const ans=opts[q.c];
    for(let i=opts.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[opts[i],opts[j]]=[opts[j],opts[i]];}
    const nc=opts.indexOf(ans); s.cur={q:q.q,opts,c:nc,spawnTime:Date.now()}; s.sig.attempts++;
    const N=opts.length,bW=Math.min((W-60)/2,155),bH=52,gap=10;
    const sX=(W-2*bW-gap)/2, sY=H*0.54;
    s.btns=Array.from({length:N},(_,i)=>({x:sX+(i%2)*(bW+gap),y:sY+Math.floor(i/2)*(bH+gap),w:bW,h:bH,label:opts[i],ok:i===nc,flash:0}));
  },[]);

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    newQ(c.width,c.height);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      ctx.fillStyle='rgba(255,255,255,0.88)'; ctx.font='bold 16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      const words=s.cur.q.split(' '),mW=W-40,lines:string[]=[]; let line='';
      words.forEach(w=>{const t=line+w+' ';if(ctx.measureText(t).width>mW&&line){lines.push(line.trim());line=w+' ';}else line=t;}); lines.push(line.trim());
      lines.forEach((l,i)=>ctx.fillText(l,W/2,H*0.33+(i-lines.length/2+0.5)*24));
      s.btns.forEach(b=>{
        const bright=b.flash>0;
        ctx.shadowBlur=bright?16:0; ctx.shadowColor=bright?(b.ok?'#22c55e':'#ef4444'):'transparent';
        ctx.fillStyle=bright?(b.ok?'#22c55e33':'#ef444433'):ACCENT+'20';
        ctx.strokeStyle=bright?(b.ok?'#22c55e':ACCENT):ACCENT+'55'; ctx.lineWidth=bright?2.5:1.5;
        ctx.roundRect(b.x,b.y,b.w,b.h,10); ctx.fill(); ctx.stroke(); ctx.shadowBlur=0;
        ctx.fillStyle='rgba(255,255,255,0.82)'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(b.label,b.x+b.w/2,b.y+b.h/2);
        if(b.flash>0) b.flash--;
      });
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('×'+s.sig.streakCurrent+' STREAK!',W/2,H-30);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,newQ]);

  const handleTap = useCallback((cx:number,cy:number)=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; if(!s.running) return;
    const rect=c.getBoundingClientRect();
    const x=(cx-rect.left)*(c.width/rect.width),y=(cy-rect.top)*(c.height/rect.height);
    for(const b of s.btns){
      if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h){
        b.flash=18; s.sig.reactionTimes.push(Date.now()-s.cur.spawnTime);
        if(b.ok){s.sig.hits++;s.sig.streakCurrent++;if(s.sig.streakCurrent>s.sig.maxStreak)s.sig.maxStreak=s.sig.streakCurrent;s.sig.score+=s.sig.streakCurrent>=3?2:1;setScoreDisplay(s.sig.score);sfx.collect();haptic([30]);}
        else{s.sig.streakCurrent=0;sfx.fail();haptic([40,30,40]);}
        setTimeout(()=>{if(s.running&&c)newQ(c.width,c.height);},360);
        break;
      }
    }
  },[newQ]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase==='playing')handleTap(e.clientX,e.clientY);};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  
  const handleStart = useCallback((name: string, avatar: string) => { initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown'); }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);
  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits/sig.attempts)*100) : 0;
    const avg = sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length) : 0;
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Accuracy', value: acc + '%', color: acc>=70?'#4ade80':acc>=40?'#facc15':'#ef4444' },
      { label: 'Avg React', value: avg + 'ms', color: ACCENT },
      { label: 'Best Streak', value: '×' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };
  
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} aria-label="Neon Chess game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=5}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
}