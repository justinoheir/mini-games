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

const GAME_ID = 'ski-slalom';
const ACCENT = '#818cf8';
const DURATION = 45;
const GAME_EMOJI = '⛷️';
const GAME_TITLE = 'Ski Slalom';
const GAME_TAGLINE = 'Weave through the gates. Go fast.';
const BG_COLOR = '#0a0014';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'sports';
const PB_KEY = 'mg_pb_ski-slalom';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Slalom King 🎿';
  if (acc >= 0.55) return 'Clean Run ⛷️';
  if (sig.maxStreak >= 4) return 'Speed Demon 🏎️';
  return 'Powder Bro 🌨️';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function SkiSlalomGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, playerX:0, tiltX:0, items:[] as {x:number,y:number,r:number,type:'good'|'bad',id:number}[], nextId:0 });

const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  

  useEffect(()=>{
    const h=(e:DeviceMotionEvent)=>{ const s=stateRef.current; if(!s.running) return; s.tiltX=e.accelerationIncludingGravity?.x??0; };
    window.addEventListener('devicemotion',h);
    return()=>window.removeEventListener('devicemotion',h);
  },[]);

  const spawnItem = useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; const isBad=Math.random()<0.28;
    s.items.push({x:20+Math.random()*(c.width-40),y:-22,r:16,type:isBad?'bad':'good',id:s.nextId++});
    if(!isBad) s.sig.attempts++;
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
    s.running=true; s.timeLeft=DURATION; s.items=[]; s.nextId=0; s.tiltX=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.playerX=c.width/2;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    let spTimer=0;
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      s.playerX=Math.max(28,Math.min(W-28,s.playerX-s.tiltX*1.6));
      spTimer++; if(spTimer>38){spTimer=0;spawnItem();}
      const py=H-52, spd=2.2+s.sig.hits*0.09;
      ctx.shadowBlur=14; ctx.shadowColor=ACCENT;
      ctx.strokeStyle=ACCENT; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(s.playerX,py,24,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=ACCENT+'20'; ctx.fill(); ctx.shadowBlur=0;
      s.items=s.items.filter(it=>{
        it.y+=spd;
        if(Math.hypot(it.x-s.playerX,it.y-py)<30){
          if(it.type==='good'){
            s.sig.hits++; s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
            s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
            sfx.collect(); haptic([30]);
          } else {
            s.sig.streakCurrent=0; sfx.nearMiss(); haptic([20,30,20]);
          }
          return false;
        }
        if(it.y>H+20) return false;
        ctx.shadowBlur=10; ctx.shadowColor=it.type==='good'?ACCENT:'#ef4444';
        ctx.fillStyle=it.type==='good'?ACCENT:'#ef4444';
        ctx.beginPath(); ctx.arc(it.x,it.y,it.r,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
        return true;
      });
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('×'+s.sig.streakCurrent,W/2,75);}
      ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText('TILT or DRAG to move',W/2,H-12);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnItem]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onMove=(e:PointerEvent)=>{ if(phase!=='playing') return; const rect=c.getBoundingClientRect(); stateRef.current.playerX=(e.clientX-rect.left)*(c.width/rect.width); };
    c.addEventListener('pointermove',onMove);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointermove',onMove);};
  },[phase]);

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
      { label: 'Best Streak', value: '×' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };
  
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} aria-label="Ski Slalom game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=5}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
