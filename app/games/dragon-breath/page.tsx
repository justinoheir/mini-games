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

const GAME_ID = 'dragon-breath';
const ACCENT = '#ef4444';
const DURATION = 30;
const GAME_EMOJI = '🐉';
const GAME_TITLE = 'Dragon Breath';
const GAME_TAGLINE = 'Blow hard. Breathe fire!';
const BG_COLOR = '#1a0000';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'calm';
const PB_KEY = 'mg_pb_dragon-breath';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Fire Dragon 🐉';
  if (acc >= 0.55) return 'Flame Thrower 🔥';
  if (sig.maxStreak >= 4) return 'Long Breath 💪';
  return 'Spark 🌟';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function DragonBreathGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const analyserRef = useRef<AnalyserNode|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, volume:0, power:0, hasMic:false, tX:0, tY:0 });

  const getVol = () => {
    const a=analyserRef.current; if(!a) return 0;
    const buf=new Uint8Array(a.frequencyBinCount); a.getByteFrequencyData(buf);
    return buf.reduce((s,v)=>s+v,0)/buf.length/255;
  };

  const endGame = useCallback(()=>{
    const s=stateRef.current; s.running=false;
    cancelAnimationFrame(animRef.current);
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    if(stopMusicRef.current){stopMusicRef.current();stopMusicRef.current=null;}
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;}
    setFinalSig({...s.sig}); setPhase('done');
  },[]);

  const startLoop = useCallback(async()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const s=stateRef.current;
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});streamRef.current=stream;const ac=new AudioContext();const src=ac.createMediaStreamSource(stream);const an=ac.createAnalyser();an.fftSize=256;src.connect(an);analyserRef.current=an;s.hasMic=true;}catch{s.hasMic=false;}
    s.running=true; s.timeLeft=DURATION; s.power=0; s.volume=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.tX=50+Math.random()*(c.width-100); s.tY=80+Math.random()*(c.height*0.45); s.sig.attempts++;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      s.volume=s.hasMic?getVol():0.08+Math.random()*0.04;
      s.power=Math.min(1,Math.max(0,s.power+s.volume*0.09-0.013));
      const bW=W*0.72,bX=(W-bW)/2,bY=H*0.76,bH=22;
      ctx.fillStyle='#ffffff0e'; ctx.roundRect(bX,bY,bW,bH,6); ctx.fill();
      const g2=ctx.createLinearGradient(bX,0,bX+bW,0); g2.addColorStop(0,ACCENT); g2.addColorStop(1,'#ffffff');
      ctx.fillStyle=g2; ctx.roundRect(bX,bY,bW*s.power,bH,6); ctx.fill();
      ctx.strokeStyle=ACCENT+'55'; ctx.lineWidth=1.5; ctx.roundRect(bX,bY,bW,bH,6); ctx.stroke();
      ctx.shadowBlur=16; ctx.shadowColor=ACCENT; ctx.strokeStyle=ACCENT; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(s.tX,s.tY,32,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle=ACCENT+'20'; ctx.fill(); ctx.shadowBlur=0;
      if(s.power>0.12){
        const beamH=H*0.68-s.power*(H*0.52);
        ctx.strokeStyle=ACCENT+'88'; ctx.lineWidth=s.power*22;
        ctx.beginPath(); ctx.moveTo(W/2,H*0.68); ctx.lineTo(W/2,beamH); ctx.stroke();
        if(s.power>0.5&&Math.abs(W/2-s.tX)<64&&beamH<s.tY+34){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]); s.power=0;
          s.tX=50+Math.random()*(W-100); s.tY=80+Math.random()*(H*0.45); s.sig.attempts++;
        }
      }
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.hasMic?'SPEAK / BLOW INTO MIC':'TAP TO SIMULATE',W/2,H*0.84);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('×'+s.sig.streakCurrent+' COMBO!',W/2,H*0.89);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onDown=()=>{if(phase==='playing')stateRef.current.power=Math.min(1,stateRef.current.power+0.22);};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase]);

  useEffect(()=>()=>{cancelAnimationFrame(animRef.current);if(timerRef.current)clearInterval(timerRef.current);if(stopMusicRef.current)stopMusicRef.current();if(streamRef.current)streamRef.current.getTracks().forEach(t=>t.stop());},[]);

  
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
      {phase==='start'&&<GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Mic" accentColor={theme.colors.accent??ACCENT} onStart={handleStart}/>}
      {phase==='countdown'&&<Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent??ACCENT}/>}
      {(phase==='playing'||phase==='countdown')&&<>
        <canvas ref={canvasRef} aria-label="Dragon Breath game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
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