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

const GAME_ID = 'sparkler-draw';
const ACCENT = '#fbbf24';
const DURATION = 45;
const GAME_EMOJI = '✨';
const GAME_TITLE = 'Sparkler Draw';
const GAME_TAGLINE = 'Draw with fire. Make it sparkle.';
const BG_COLOR = '#0a0800';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'holiday';
const PB_KEY = 'mg_pb_sparkler-draw';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Sparkle Artist 🌟';
  if (acc >= 0.55) return 'Fire Writer ✍️';
  if (sig.maxStreak >= 4) return 'Persistent Glow 🔦';
  return 'Squiggly ✨';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function SparklerDrawGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, targets:[] as {x:number,y:number,r:number,alpha:number,spawnTime:number,id:number}[], nextId:0, speedMult:1 });

const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);
  

  const spawnTarget = useCallback(() => {
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current;
    const r=26+Math.random()*20, m=r+8;
    s.targets.push({x:m+Math.random()*(c.width-m*2),y:m+Math.random()*(c.height-m*2),r,alpha:1,spawnTime:Date.now(),id:s.nextId++});
    s.sig.attempts++;
  },[]);

  const endGame = useCallback(() => {
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(() => {
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    s.running=true; s.timeLeft=DURATION; s.targets=[]; s.nextId=0; s.speedMult=1;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    for(let i=0;i<3;i++) spawnTarget();
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height,now=Date.now();
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1;
      for(let x=0;x<W;x+=52){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
      for(let y=0;y<H;y+=52){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
      s.targets=s.targets.filter(t=>{
        t.alpha=Math.max(0,1-(now-t.spawnTime)/2800);
        if(t.alpha<=0){s.sig.streakCurrent=0;sfx.nearMiss();haptic([20,30,20]);return false;}
        ctx.save(); ctx.globalAlpha=t.alpha;
        ctx.shadowBlur=18; ctx.shadowColor=ACCENT;
        ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle=ACCENT+'18'; ctx.fill();
        ctx.shadowBlur=0; ctx.fillStyle=ACCENT;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r*0.22,0,Math.PI*2); ctx.fill();
        const pulse=0.4+0.4*Math.sin(now*0.004+t.id*1.3);
        ctx.strokeStyle=ACCENT+'55'; ctx.lineWidth=1; ctx.globalAlpha=t.alpha*pulse;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r*1.38,0,Math.PI*2); ctx.stroke();
        ctx.restore(); return true;
      });
      if(s.targets.length<4&&Math.random()<0.018*s.speedMult) spawnTarget();
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,68);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,spawnTarget]);

  const handleTap = useCallback((cx:number,cy:number)=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; if(!s.running) return;
    const rect=c.getBoundingClientRect();
    const x=(cx-rect.left)*(c.width/rect.width),y=(cy-rect.top)*(c.height/rect.height);
    let hit=false;
    s.targets=s.targets.filter(t=>{
      if(hit) return true;
      if(Math.hypot(x-t.x,y-t.y)<=t.r+10){
        hit=true; s.sig.hits++; s.sig.reactionTimes.push(Date.now()-t.spawnTime);
        s.sig.streakCurrent++; if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
        s.sig.score+=s.sig.streakCurrent>=3?2:1; s.speedMult=Math.min(2.5,1+s.sig.hits*0.05);
        setScoreDisplay(s.sig.score); sfx.collect(); haptic([30]); return false;
      }
      return true;
    });
    if(!hit){s.sig.streakCurrent=0;}
  },[]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase==='playing')handleTap(e.clientX,e.clientY);};
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
      { label: 'Best Streak', value: '×' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };
  
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent??ACCENT}>
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} aria-label="Sparkler Draw game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=5}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
