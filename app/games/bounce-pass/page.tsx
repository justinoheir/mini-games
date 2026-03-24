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

const GAME_ID = 'bounce-pass';
const ACCENT = '#84cc16';
const DURATION = 45;
const GAME_EMOJI = '🏀';
const GAME_TITLE = 'Bounce Pass';
const GAME_TAGLINE = 'Angle the bounce. Make the pass.';
const BG_COLOR = '#071a00';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'drive';
const PB_KEY = 'mg_pb_bounce-pass';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Point Guard 🏀';
  if (acc >= 0.55) return 'Playmaker ⚡';
  if (sig.maxStreak >= 4) return 'On Fire 🔥';
  return 'Learning 📐';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function BouncePassGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, proj:{x:0,y:0,vx:0,vy:0,active:false,spawnTime:0}, target:{x:0,y:0,r:30}, dragStart:{x:0,y:0}, dragging:false });

  const spawnTarget = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; const m=60;
    s.target={x:m+Math.random()*(c.width-m*2),y:60+Math.random()*(c.height*0.45),r:28};
    s.sig.attempts++;
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
    s.proj={x:c.width/2,y:c.height*0.82,vx:0,vy:0,active:false,spawnTime:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    spawnTarget();
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      // Target
      ctx.shadowBlur=16; ctx.shadowColor=ACCENT;
      ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(s.target.x,s.target.y,s.target.r,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=ACCENT+'22'; ctx.fill();
      ctx.shadowBlur=0; ctx.fillStyle=ACCENT+'cc';
      ctx.beginPath(); ctx.arc(s.target.x,s.target.y,8,0,Math.PI*2); ctx.fill();
      // Launch zone indicator
      ctx.strokeStyle=ACCENT+'33'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(W/2,H*0.82,20,0,Math.PI*2); ctx.stroke();
      // Projectile
      if(s.proj.active){
        s.proj.x+=s.proj.vx; s.proj.y+=s.proj.vy; s.proj.vy+=0.35;
        ctx.shadowBlur=10; ctx.shadowColor='#ffffff'; ctx.fillStyle='#ffffff';
        ctx.beginPath(); ctx.arc(s.proj.x,s.proj.y,10,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
        if(Math.hypot(s.proj.x-s.target.x,s.proj.y-s.target.y)<s.target.r+12){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]); s.proj.active=false; spawnTarget();
        }
        if(s.proj.x<-60||s.proj.x>W+60||s.proj.y>H+60){
          s.sig.streakCurrent=0; s.proj.active=false; sfx.nearMiss(); haptic([20,30,20]);
        }
      }
      // Drag guide
      if(s.dragging&&!s.proj.active){
        ctx.strokeStyle=ACCENT+'55'; ctx.lineWidth=2; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(W/2,H*0.82); ctx.lineTo(s.dragStart.x,s.dragStart.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,H-30);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnTarget]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; s.dragging=true; s.dragStart={x:e.clientX,y:e.clientY};
    };
    const onUp=(e:PointerEvent)=>{
      if(phase!=='playing') return;
      const s=stateRef.current; if(!s.dragging||s.proj.active) return;
      s.dragging=false;
      const dx=s.dragStart.x-e.clientX,dy=s.dragStart.y-e.clientY;
      const spd=Math.min(Math.hypot(dx,dy)*0.11,18);
      const a=Math.atan2(dy,dx);
      s.proj={x:c.width/2,y:c.height*0.82,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,active:true,spawnTime:Date.now()};
      sfx.whoosh(); haptic([20]);
    };
    c.addEventListener('pointerdown',onDown); window.addEventListener('pointerup',onUp);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);window.removeEventListener('pointerup',onUp);};
  },[phase]);

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
        <canvas ref={canvasRef} aria-label="Bounce Pass game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=5}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
