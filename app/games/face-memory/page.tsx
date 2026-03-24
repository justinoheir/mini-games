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

const GAME_ID = 'face-memory';
const ACCENT = '#f43f5e';
const DURATION = 60;
const GAME_EMOJI = '👁️';
const GAME_TITLE = 'Face Memory';
const GAME_TAGLINE = 'Remember the faces. Spot them.';
const BG_COLOR = '#14000a';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'minimal';
const PB_KEY = 'mg_pb_face-memory';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Face Reader 👁️';
  if (acc >= 0.55) return 'People Person 😊';
  if (sig.maxStreak >= 4) return 'Persistent 💪';
  return 'Face Blind 😵';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function FaceMemoryGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const COLORS = ['#ef4444','#3b82f6','#22c55e','#fbbf24','#a855f7','#f97316'];
  const stateRef = useRef({ running:false, timeLeft:DURATION, sig:{score:0,hits:0,attempts:0,reactionTimes:[] as number[],maxStreak:0,streakCurrent:0}, cells:[] as {x:number,y:number,w:number,h:number,lit:number,color:string}[], sequence:[] as number[], playerSeq:[] as number[], phase:'showing'as'showing'|'input', showIdx:0, showTimer:0 });

  const buildGrid = useCallback((W:number,H:number)=>{
    const s=stateRef.current; const N=6,cols=3,cw=(W-56)/3,ch=72,sX=28,sY=H/2-ch;
    s.cells=Array.from({length:N},(_,i)=>({x:sX+(i%cols)*(cw+4),y:sY+Math.floor(i/cols)*(ch+8),w:cw,h:ch,lit:0,color:COLORS[i]}));
  },[]);

  const newRound = useCallback(()=>{
    const s=stateRef.current; const len=Math.min(2+Math.floor(s.sig.hits/2),8);
    s.sequence=Array.from({length:len},()=>Math.floor(Math.random()*s.cells.length));
    s.playerSeq=[]; s.phase='showing'; s.showIdx=0; s.showTimer=0; s.sig.attempts++;
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
    buildGrid(c.width,c.height); setTimeout(()=>newRound(),500);
    const loop=()=>{
      if(!s.running) return;
      const W=c.width,H=c.height;
      ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,H);
      if(s.phase==='showing'){s.showTimer++;if(s.showTimer%26===0){if(s.showIdx<s.sequence.length){s.cells[s.sequence[s.showIdx]].lit=18;sfx.countdown();haptic([15]);s.showIdx++;}else{s.phase='input';}}}
      s.cells.forEach((cel,i)=>{
        const bright=cel.lit>0;
        ctx.shadowBlur=bright?18:0; ctx.shadowColor=cel.color;
        ctx.fillStyle=bright?cel.color:cel.color+'2a';
        ctx.strokeStyle=cel.color+(bright?'':'44'); ctx.lineWidth=bright?2.5:1.5;
        ctx.roundRect(cel.x,cel.y,cel.w,cel.h,8); ctx.fill(); ctx.stroke(); ctx.shadowBlur=0;
        ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='11px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(String(i+1),cel.x+cel.w/2,cel.y+cel.h/2);
        if(cel.lit>0) cel.lit--;
      });
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(s.phase==='showing'?'WATCH…':'TAP THE SEQUENCE! '+s.playerSeq.length+'/'+s.sequence.length,W/2,H*0.22);
      if(s.sig.streakCurrent>=3){ctx.fillStyle=ACCENT;ctx.font='bold 15px sans-serif';ctx.fillText('×'+s.sig.streakCurrent+' STREAK!',W/2,H-70);}
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
  },[endGame,buildGrid,newRound]);

  const handleTap = useCallback((cx:number,cy:number)=>{
    const c=canvasRef.current; if(!c) return;
    const s=stateRef.current; if(!s.running||s.phase!=='input') return;
    const rect=c.getBoundingClientRect();
    const x=(cx-rect.left)*(c.width/rect.width),y=(cy-rect.top)*(c.height/rect.height);
    for(let i=0;i<s.cells.length;i++){
      const cel=s.cells[i];
      if(x>=cel.x&&x<=cel.x+cel.w&&y>=cel.y&&y<=cel.y+cel.h){
        cel.lit=10; sfx.click(); haptic([15]); s.playerSeq.push(i);
        if(s.sequence[s.playerSeq.length-1]!==i){s.sig.streakCurrent=0;sfx.fail();haptic([40,30,40]);setTimeout(()=>{if(s.running)newRound();},450);return;}
        if(s.playerSeq.length===s.sequence.length){
          s.sig.hits++; s.sig.streakCurrent++;
          if(s.sig.streakCurrent>s.sig.maxStreak) s.sig.maxStreak=s.sig.streakCurrent;
          s.sig.score+=s.sig.streakCurrent>=3?2:1; setScoreDisplay(s.sig.score);
          sfx.success(); haptic([50,20,80]); setTimeout(()=>{if(s.running)newRound();},520);
        }
        break;
      }
    }
  },[newRound]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const resize=()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;buildGrid(c.width,c.height);};
    resize(); window.addEventListener('resize',resize);
    const onDown=(e:PointerEvent)=>{if(phase==='playing')handleTap(e.clientX,e.clientY);};
    c.addEventListener('pointerdown',onDown);
    return()=>{window.removeEventListener('resize',resize);c.removeEventListener('pointerdown',onDown);};
  },[phase,handleTap,buildGrid]);

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
        <canvas ref={canvasRef} aria-label="Face Memory game canvas" role="img" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none'}}/>
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