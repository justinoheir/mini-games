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

const GAME_ID = 'rowing-rhythm';
const ACCENT = '#38bdf8';
const DURATION = 60;
const GAME_EMOJI = '🚣';
const GAME_TITLE = 'Rowing Rhythm';
const GAME_TAGLINE = 'Sync your strokes. Row!';
const BG_COLOR = '#001014';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'sports';
const PB_KEY = 'mg_pb_rowing-rhythm';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Olympic Rower 🚣';
  if (acc >= 0.55) return 'Steady Oar ⚡';
  if (sig.maxStreak >= 4) return 'Endurance 💪';
  return 'Learning Rhythm 🎵';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function RowingRhythmGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, lastTap:0, lane:'left'as'left'|'right', bpm:0, particles:[] as {x:number,y:number,r:number,alpha:number}[] });

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
    s.running=true; s.timeLeft=DURATION; s.lastTap=0; s.bpm=0; s.lane='left'; s.particles=[];
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      const lX=W*0.27,rX=W*0.73,zY=H*0.7,zR=68;
      [lX,rX].forEach((zx,i)=>{
        const active=s.lane===(i===0?'left':'right');
        ctx.shadowBlur=active?22:6; ctx.shadowColor=ACCENT;
        ctx.strokeStyle=ACCENT+(active?'ff':'3a'); ctx.lineWidth=active?4.5:2;
        ctx.beginPath(); ctx.arc(zx,zY,zR,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle=ACCENT+(active?'28':'0d'); ctx.fill(); ctx.shadowBlur=0;
        ctx.fillStyle=ACCENT+(active?'cc':'44'); ctx.font='bold 13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(i===0?'LEFT':'RIGHT',zx,zY);
      });
      s.particles=s.particles.filter(p=>{p.y-=2.5;p.alpha-=0.025;if(p.alpha<=0)return false;ctx.globalAlpha=p.alpha;ctx.fillStyle=ACCENT;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;return true;});
      if(s.bpm>0){ctx.fillStyle=ACCENT;ctx.font='14px monospace';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(Math.round(s.bpm)+' BPM',W/2,68);}
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,90);}
      ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='12px sans-serif'; ctx.textBaseline='bottom';
      ctx.fillText('TAP YOUR SIDE IN RHYTHM',W/2,H-14);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  const handleTap = useCallback((side:'left'|'right')=>{
    const s=stateRef.current; if(!s.running) return;
    const now=Date.now();
    s.sig.attempts++;
    if(s.lane===side){
      s.sig.hits++; const rt=s.lastTap>0?now-s.lastTap:500;
      s.sig.reactionTimes.push(rt);
      if(rt>80&&rt<900){const b=60000/rt;s.bpm=s.bpm*0.7+b*0.3;}
      s.sig.streakCurrent++;
      if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
      s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([18]);
      const c=canvasRef.current;
      if(c){const W=c.width,H=c.height;s.particles.push({x:side==='left'?W*0.27:W*0.73,y:H*0.7,r:9,alpha:1});}
    } else {
      s.sig.streakCurrent=0; sfx.nearMiss(); haptic([20,30,20]);
    }
    s.lastTap=now; s.lane=side==='left'?'right':'left';
  },[]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const rect=c.getBoundingClientRect();
      handleTap(e.clientX-rect.left<c.offsetWidth/2?'left':'right');
    };
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
        <canvas ref={canvasRef} aria-label="Rowing Rhythm game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
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