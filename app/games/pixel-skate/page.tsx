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

const GAME_ID = 'pixel-skate';
const ACCENT = '#10b981';
const DURATION = 45;
const GAME_EMOJI = '🛹';
const GAME_TITLE = 'Pixel Skate';
const GAME_TAGLINE = 'Flick tricks. Stack the combo.';
const BG_COLOR = '#001a0d';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'sports';
const PB_KEY = 'mg_pb_pixel-skate';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Tony Hawk 🛹';
  if (acc >= 0.55) return 'Street Skater 💨';
  if (sig.maxStreak >= 4) return 'Combo King 👑';
  return 'Beginner Bail 😅';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function PixelSkateGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, zones:[] as {x:number,y:number,r:number,flash:number}[], sequence:[] as number[], progress:0, showing:true, showIdx:0, showTimer:0 });

  const buildZones = useCallback((W:number,H:number)=>{
    const s=stateRef.current; const N=4; const cx=W/2,cy=H*0.52; const R=Math.min(W,H)*0.31;
    s.zones=Array.from({length:N},(_,i)=>{ const a=(i/N)*Math.PI*2-Math.PI/2; return {x:cx+Math.cos(a)*R,y:cy+Math.sin(a)*R,r:38,flash:0}; });
  },[]);

  const newSeq = useCallback(()=>{
    const s=stateRef.current; const len=Math.min(2+Math.floor(s.sig.hits/3),7);
    s.sequence=Array.from({length:len},()=>Math.floor(Math.random()*s.zones.length));
    s.progress=0; s.showing=true; s.showIdx=0; s.showTimer=0; s.sig.attempts++;
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
    buildZones(c.width,c.height); setTimeout(()=>newSeq(),700);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      if(s.showing){ s.showTimer++; if(s.showTimer%28===0){ if(s.showIdx<s.sequence.length){s.zones[s.sequence[s.showIdx]].flash=16;sfx.countdown();haptic([20]);s.showIdx++;}else{s.showing=false;} } }
      s.zones.forEach((z,i)=>{
        const isNext=!s.showing&&s.sequence[s.progress]===i;
        ctx.shadowBlur=z.flash>0?22:8; ctx.shadowColor=z.flash>0?ACCENT:'rgba(255,255,255,0.2)';
        ctx.fillStyle=z.flash>0?ACCENT:isNext?ACCENT+'44':ACCENT+'1a';
        ctx.strokeStyle=isNext?ACCENT:z.flash>0?ACCENT:'rgba(255,255,255,0.25)';
        ctx.lineWidth=isNext?3.5:z.flash>0?3:1.5;
        ctx.beginPath(); ctx.arc(z.x,z.y,z.r,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.shadowBlur=0;
        ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='bold 15px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(i+1),z.x,z.y);
        if(z.flash>0) z.flash--;
      });
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='13px monospace'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.showing?'WATCH…':s.progress+' / '+s.sequence.length+' — YOUR TURN',W/2,56);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,76);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,buildZones,newSeq]);

  const handleTap = useCallback((cx:number,cy:number)=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; if(!s.running||s.showing) return;
    const rect=c.getBoundingClientRect();
    const x=(cx-rect.left)*(c.width/rect.width),y=(cy-rect.top)*(c.height/rect.height);
    for(let i=0;i<s.zones.length;i++){
      const z=s.zones[i];
      if(Math.hypot(x-z.x,y-z.y)<=z.r+10){
        z.flash=12; sfx.click(); haptic([20]);
        if(s.sequence[s.progress]===i){
          s.progress++;
          if(s.progress>=s.sequence.length){
            s.sig.hits++; s.sig.streakCurrent++;
            if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
            s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
            sfx.success(); haptic([50,20,80]); setTimeout(()=>{if(s.running)newSeq();},550);
          }
        } else {
          s.sig.streakCurrent=0; sfx.fail(); haptic([40,30,40]); setTimeout(()=>{if(s.running)newSeq();},480);
        }
        break;
      }
    }
  },[newSeq]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;buildZones(c.width,c.height);};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase==='playing')handleTap(e.clientX,e.clientY);};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap,buildZones]);

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
        <canvas ref={canvasRef} aria-label="Pixel Skate game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
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