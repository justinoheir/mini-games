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

const GAME_ID = 'voice-sculpt';
const ACCENT = '#d946ef';
const DURATION = 45;
const GAME_EMOJI = '🎨';
const GAME_TITLE = 'Voice Sculpt';
const GAME_TAGLINE = 'Hum to shape the clay.';
const BG_COLOR = '#14000f';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'calm';
const PB_KEY = 'mg_pb_voice-sculpt';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Voice Artist 🎨';
  if (acc >= 0.55) return 'Clay Hummer 🎵';
  if (sig.maxStreak >= 4) return 'Tonal 🎶';
  return 'Flat Note 🎤';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function VoiceSculptGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const analyserRef = useRef<AnalyserNode|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, pitchNorm:0.5, targetPitch:0.5, holdTime:0, hasMic:false });

  const getPitch = () => {
    const a=analyserRef.current; if(!a) return 0.5;
    const buf=new Float32Array(a.fftSize); a.getFloatTimeDomainData(buf);
    let c=0; for(let i=1;i<buf.length;i++) if(buf[i-1]<0&&buf[i]>=0) c++;
    return Math.min(1,Math.max(0,(c*(a.context.sampleRate/buf.length)-80)/800));
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
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});streamRef.current=stream;const ac=new AudioContext();const src=ac.createMediaStreamSource(stream);const an=ac.createAnalyser();an.fftSize=2048;src.connect(an);analyserRef.current=an;s.hasMic=true;}catch{s.hasMic=false;}
    s.running=true; s.timeLeft=DURATION; s.pitchNorm=0.5; s.holdTime=0;
    s.sig={score:0,hits:0,attempts:0,reactionTimes:[],maxStreak:0,streakCurrent:0};
    s.targetPitch=0.2+Math.random()*0.6; s.sig.attempts++;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current=startMusic(MUSIC_PAT);
    timerRef.current=setInterval(()=>{s.timeLeft--;setTimeLeft(s.timeLeft);if(s.timeLeft<=0){sfx.fail();haptic([100]);endGame();}},1000);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      if(s.hasMic) s.pitchNorm=getPitch();
      else s.pitchNorm=0.5+0.06*Math.sin(Date.now()*0.0008);
      const sX=W*0.76,sW=28,sH=H*0.62,sY=(H-sH)/2;
      ctx.fillStyle='#ffffff0e'; ctx.roundRect(sX,sY,sW,sH,6); ctx.fill();
      const tzY=sY+sH*(1-s.targetPitch-0.07); const tzH=sH*0.14;
      ctx.fillStyle=ACCENT+'44'; ctx.roundRect(sX,tzY,sW,tzH,5); ctx.fill();
      ctx.strokeStyle=ACCENT; ctx.lineWidth=2; ctx.roundRect(sX,tzY,sW,tzH,5); ctx.stroke();
      const iY=sY+sH*(1-s.pitchNorm)-5;
      const inZ=Math.abs(s.pitchNorm-s.targetPitch)<0.07;
      ctx.shadowBlur=inZ?20:8; ctx.shadowColor=inZ?'#22c55e':ACCENT;
      ctx.fillStyle=inZ?'#22c55e':ACCENT; ctx.roundRect(sX-5,iY,sW+10,10,5); ctx.fill(); ctx.shadowBlur=0;
      if(inZ){
        s.holdTime+=1/60;
        const hW=Math.min(1,s.holdTime/1.5),mW=W*0.55,mX=(W-mW)/2,mY=H*0.8;
        ctx.fillStyle='#ffffff0d'; ctx.roundRect(mX,mY,mW,16,5); ctx.fill();
        ctx.fillStyle=ACCENT; ctx.roundRect(mX,mY,mW*hW,16,5); ctx.fill();
        if(s.holdTime>=1.5){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]); s.holdTime=0; s.targetPitch=0.2+Math.random()*0.6; s.sig.attempts++;
        }
      } else {
        s.holdTime=Math.max(0,s.holdTime-0.04);
      }
      ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.hasMic?'HUM / SING � MATCH THE TARGET':'DRAG UP/DOWN TO SIMULATE',W/2,H*0.88);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('x'+s.sig.streakCurrent+' COMBO!',W/2,H*0.92);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;};
    resize(); window.addEventListener('resize',resize);
    const onMove=(e:PointerEvent)=>{ if(phase!=='playing') return; const rect=c.getBoundingClientRect(); stateRef.current.pitchNorm=1-(e.clientY-rect.top)/rect.height; };
    c.addEventListener('pointermove',onMove);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointermove',onMove);};
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
        <canvas ref={canvasRef} aria-label="Voice Sculpt game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
        {phase==='playing'&&<GameHUD accentColor={theme.colors.accent??ACCENT} items={[{label:'TIME',value:timeLeft,danger:timeLeft<=5},{label:'SCORE',value:scoreDisplay}]}/>}
      </>}
      {phase==='done'&&finalSig&&<>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent??ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score>=5}/>
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current}/>
      </>}
    </GameShell>
  );
}
