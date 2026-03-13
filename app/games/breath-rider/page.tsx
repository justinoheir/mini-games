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
import PlayerNameInput from '@/components/PlayerNameInput';

const GAME_ID = 'breath-rider';

type GameState = 'start' | 'requesting' | 'countdown' | 'playing' | 'done';
interface BehaviorData { breathVariance: number; avgAltitude: number; coinsCollected: number; spikeCollisions: number; }
interface Coin { x: number; y: number; collected: boolean; floatY: number; floatT: number; }
interface Spike { x: number; top: boolean; }
interface FloatText { x: number; y: number; t: number; }

function getProfile(b: BehaviorData) {
  if (b.breathVariance < 15) return 'Steady 🧘';
  if (b.breathVariance > 35) return 'Anxious 😤';
  return 'Focused 🎯';
}

export default function BreathRider() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    charY: 0, charX: 0,
    trail: [] as { x: number; y: number }[],
    coins: [] as Coin[], spikes: [] as Spike[],
    floatTexts: [] as FloatText[],
    altitudeSamples: [] as number[], volumeSamples: [] as number[],
    coinsCollected: 0, spikeCollisions: 0,
    spikeLastHit: [] as number[],
    stream: null as MediaStream | null,
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    animId: 0, timerIntervalId: null as ReturnType<typeof setInterval> | null,
    timeLeft: 45, running: false, canvasW: 0, canvasH: 0,
    accentColor: '#3b82f6',
  });
  const [gameState, setGameState] = useState<GameState>('start');
  const [timeLeft, setTimeLeft] = useState(45);
  const [behavior, setBehavior] = useState<BehaviorData | null>(null);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (!s.analyser) return 0;
    const data = new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    const sumSq = data.reduce((acc, v) => acc + v * v, 0);
    return Math.min(100, (Math.sqrt(sumSq / data.length) / 128) * 100);
  }, []);

  const endGame = useCallback((capturedTheme: typeof theme) => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.timerIntervalId) clearInterval(s.timerIntervalId);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {/* ignore */});
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const volAvg = s.volumeSamples.length > 0 ? s.volumeSamples.reduce((a,b)=>a+b,0)/s.volumeSamples.length : 0;
    const variance = s.volumeSamples.length > 0
      ? Math.sqrt(s.volumeSamples.reduce((a,v)=>a+(v-volAvg)**2,0)/s.volumeSamples.length) : 0;
    const altAvg = s.altitudeSamples.length > 0 ? s.altitudeSamples.reduce((a,b)=>a+b,0)/s.altitudeSamples.length : 0;
    const bData: BehaviorData = {
      breathVariance: Math.round(variance),
      avgAltitude: Math.round((1 - altAvg / (s.canvasH || 1)) * 100),
      coinsCollected: s.coinsCollected,
      spikeCollisions: s.spikeCollisions,
    };
    setBehavior(bData);
    setGameState('done');
    postWebhook(capturedTheme, 'breath-rider', { score: `${bData.coinsCollected}/10`, personality: getProfile(bData), signals: bData }, playerSessionRef.current);
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.altitudeSamples = []; s.volumeSamples = []; s.coinsCollected = 0; s.spikeCollisions = 0;
    s.timeLeft = 45; s.running = true; s.trail = []; s.floatTexts = [];
    setTimeLeft(45); setGameState('playing');
    stopMusicRef.current = startMusic('calm');
    const capturedTheme = theme;

    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    s.canvasW = W; s.canvasH = H;
    s.charX = W * 0.2; s.charY = H * 0.5;

    s.coins = Array.from({ length: 10 }, (_, i) => ({
      x: W * 0.3 + i * W * 0.07,
      y: H * 0.15 + Math.random() * H * 0.7,
      collected: false, floatY: 0, floatT: Math.random() * Math.PI * 2,
    }));
    s.spikes = Array.from({ length: 8 }, (_, i) => ({
      x: W * 0.25 + i * W * 0.1,
      top: Math.random() > 0.5,
    }));
    s.spikeLastHit = new Array(8).fill(0);

    s.timerIntervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame(capturedTheme);
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const vol = getVolume();
      s.volumeSamples.push(vol);

      // Physics: blow up, fall down
      const targetY = s.charY - (vol / 100) * H * 0.07 + H * 0.018;
      s.charY += (targetY - s.charY) * 0.14;
      s.charY = Math.max(H * 0.07, Math.min(H * 0.93, s.charY));
      s.altitudeSamples.push(s.charY);

      // Sky/altitude atmosphere — deepening blue gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#071528');
      bgGrad.addColorStop(0.5, '#0d1a22');
      bgGrad.addColorStop(1, '#060c14');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Danger zone bands
      ctx.fillStyle = 'rgba(255,68,68,0.12)';
      ctx.fillRect(0, 0, W, H * 0.07);
      ctx.fillRect(0, H * 0.93, W, H * 0.07);

      // Spikes
      s.spikes.forEach((spike, si) => {
        ctx.save();
        ctx.shadowBlur = 8; ctx.shadowColor = '#ef4444';
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        if (spike.top) { ctx.moveTo(spike.x-14,0); ctx.lineTo(spike.x+14,0); ctx.lineTo(spike.x,44); }
        else           { ctx.moveTo(spike.x-14,H); ctx.lineTo(spike.x+14,H); ctx.lineTo(spike.x,H-44); }
        ctx.fill(); ctx.restore();
        const tipY = spike.top ? 22 : H - 22;
        const dist = Math.sqrt((s.charX-spike.x)**2 + (s.charY-tipY)**2);
        const now = Date.now();
        if (dist < 32 && now - s.spikeLastHit[si] > 1000) {
          s.spikeCollisions++; s.spikeLastHit[si] = now;
          s.charY = H * 0.5; sfx.collision(); haptic([50, 30, 50]);
        }
      });

      // Coins
      s.coins.forEach((coin, ci) => {
        if (coin.collected) return;
        coin.floatT += 0.05;
        coin.floatY = Math.sin(coin.floatT) * 5;
        const cy2 = coin.y + coin.floatY;
        // Sparkle ring
        ctx.save();
        ctx.beginPath();
        ctx.arc(coin.x, cy2, 16 + Math.sin(coin.floatT * 2) * 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,204,0,${0.3 + Math.sin(coin.floatT*3)*0.2})`;
        ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        // Coin body
        ctx.beginPath(); ctx.arc(coin.x, cy2, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24'; ctx.fill();
        ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.stroke();
        const dist = Math.sqrt((s.charX-coin.x)**2 + (s.charY-cy2)**2);
        if (dist < 28) {
          s.coins[ci].collected = true; s.coinsCollected++;
          sfx.collect(); haptic([15]);
          s.floatTexts.push({ x: coin.x, y: cy2, t: Date.now() });
        }
      });

      // Float texts "+1"
      s.floatTexts = s.floatTexts.filter(ft => Date.now() - ft.t < 700);
      s.floatTexts.forEach(ft => {
        const age = (Date.now() - ft.t) / 700;
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('+1', ft.x - 8, ft.y - age * 40);
        ctx.globalAlpha = 1;
      });

      // Trail
      s.trail.push({ x: s.charX, y: s.charY });
      if (s.trail.length > 6) s.trail.shift();
      s.trail.forEach((pos, i) => {
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 10 * (i / 6), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(59,130,246,${(i/6)*0.4})`; ctx.fill();
      });

      // Character glow
      ctx.save();
      ctx.shadowBlur = 20; ctx.shadowColor = '#3b82f6';
      ctx.beginPath(); ctx.arc(s.charX, s.charY, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6'; ctx.fill();
      ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 2; ctx.stroke();
      // Breath aura
      ctx.beginPath(); ctx.arc(s.charX, s.charY, 18 + vol * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(59,130,246,${vol/400})`; ctx.fill();
      ctx.restore();

      // Score drawn on canvas bottom (DOM HUD handles timer above)

      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [getVolume, endGame, theme]);

  const handleStart = useCallback(async () => {
    playerSessionRef.current = savePlayerSession(GAME_ID, playerName, playerAvatar);
    initAudio(); sfx.click();
    setGameState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      const s = stateRef.current;
      s.stream = stream; s.analyser = analyser; s.audioCtx = audioCtx;
      setGameState('countdown');
    } catch { alert('Microphone access needed.'); setGameState('start'); }
  }, [playerName, playerAvatar]);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setGameState('start');
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      const s = stateRef.current; s.running = false;
      cancelAnimationFrame(s.animId);
      if (s.timerIntervalId) clearInterval(s.timerIntervalId);
      if (s.stream) s.stream.getTracks().forEach(t => t.stop());
      if (s.audioCtx) s.audioCtx.close().catch(()=>{/* ignore */});
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent; }, [theme]);
  const accent = theme.colors.accent;

  return (
    <GameShell title="Breath Rider" emoji="🌬️" accentColor={accent} theme={theme}>
      <canvas ref={canvasRef} style={{ display: gameState==='playing' ? 'block' : 'none', position:'absolute', top:0, left:0 }} />
      {gameState==='playing' && (
        <GameHUD
          items={[{ label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10 }]}
          accentColor={accent}
        />
      )}
      {gameState==='countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {gameState==='start' && (
        <GameStartScreen
          emoji="🌬️"
          title="Breath Rider"
          description="Blow into the mic to make the rider climb. Collect coins and avoid spikes."
          sensorNote="Uses microphone"
          ctaLabel="Allow Mic & Fly →"
          accentColor={accent}
          onStart={handleStart}
        >
          <PlayerNameInput
            accentColor={accent}
            onReady={(name, avatar) => { setPlayerName(name); setPlayerAvatar(avatar); }}
          />
        </GameStartScreen>
      )}
      {gameState==='requesting' && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--color-text-secondary)' }}>Requesting microphone…</div>
      )}
      {gameState==='done' && behavior && (
        <EndScreen
          gameId="breath-rider"
          title={getProfile(behavior)}
          emoji="🌬️"
          score={`${behavior.coinsCollected}/10`}
          personality={getProfile(behavior)}
          insights={[
            { label:'Breath variance', value:String(behavior.breathVariance), color:accent },
            { label:'Avg altitude', value:`${behavior.avgAltitude}%`, color:'#93c5fd' },
            { label:'Spike hits', value:String(behavior.spikeCollisions), color:'#ef4444' },
          ]}
          accentColor={accent}
          onPlayAgain={handlePlayAgain}
          didWin={behavior.coinsCollected >= 7}
        />
      )}
    </GameShell>
  );
}
