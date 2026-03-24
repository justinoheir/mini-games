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

const GAME_ID = 'bbq-master';
const ACCENT = '#f97316';
const DURATION = 60;
const GAME_EMOJI = '🏆';
const GAME_TITLE = 'BBQ Master';
const GAME_TAGLINE = 'Flip it right. Don\'t burn dad\'s burger.';
const BG_COLOR = '#14080a';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'holiday';
const PB_KEY = 'mg_pb_bbq-master';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Grill Master 🏆';
  if (acc >= 0.55) return "Dad's Helper 👨‍🍳";
  if (sig.maxStreak >= 4) return 'Flipper 🍔';
  return 'Char Artist 🔥';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function BbqMasterGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, meter:0, dir:1, speed:0.012, zone:{min:0.38,max:0.62}, spawnTime:0 });

const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  

  const nextRound = useCallback(()=>{
    const s=stateRef.current; s.meter=Math.random()*0.3;
    s.dir=Math.random()>0.5?1:-1; s.speed=0.01+s.sig.hits*0.0007;
    const w=0.1+Math.random()*0.14; const c=0.3+Math.random()*0.4;
    s.zone={min:c-w/2,max:c+w/2}; s.spawnTime=Date.now(); s.sig.attempts++;
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
    nextRound();
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      s.meter+=s.dir*s.speed; if(s.meter>=1){s.meter=1;s.dir=-1;} if(s.meter<=0){s.meter=0;s.dir=1;}
      const bW=W*0.82,bX=(W-bW)/2,bY=H*0.5-18,bH=36;
      ctx.fillStyle='#ffffff10'; ctx.roundRect(bX,bY,bW,bH,10); ctx.fill();
      const tzX=bX+bW*s.zone.min,tzW=bW*(s.zone.max-s.zone.min);
      ctx.fillStyle=ACCENT+'44'; ctx.roundRect(tzX,bY,tzW,bH,8); ctx.fill();
      ctx.strokeStyle=ACCENT+'88'; ctx.lineWidth=2; ctx.roundRect(tzX,bY,tzW,bH,8); ctx.stroke();
      const iX=bX+bW*s.meter-5;
      ctx.shadowBlur=18; ctx.shadowColor=ACCENT; ctx.fillStyle=ACCENT;
      ctx.roundRect(iX,bY-6,10,bH+12,5); ctx.fill(); ctx.shadowBlur=0;
      ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='14px monospace'; ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText('TAP IN THE ZONE',W/2,bY-12);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 17px sans-serif';ctx.textBaseline='top';ctx.fillText('Ã—'+s.sig.streakCurrent+' COMBO!',W/2,bY+bH+16);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,nextRound]);

  const handleTap = useCallback(()=>{
    const s=stateRef.current; if(!s.running) return;
    const inZone=s.meter>=s.zone.min&&s.meter<=s.zone.max;
    s.sig.reactionTimes.push(Date.now()-s.spawnTime);
    if(inZone){
      s.sig.hits++; s.sig.streakCurrent++;
      if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
      s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([30]);
    } else {
      s.sig.streakCurrent=0; sfx.nearMiss(); haptic([20,30,20]);
    }
    setTimeout(()=>{if(s.running)nextRound();},280);
  },[nextRound]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=()=>{if(phase==='playing')handleTap();};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();},[]);

  
 
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
      { label: 'Best Streak', value: 'Ã—' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };
  
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} aria-label="BBQ Master game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=5}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
