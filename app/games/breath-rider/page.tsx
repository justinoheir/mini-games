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

const GAME_ID = 'breath-rider';
const SCROLL_SPEED = 2.2; // px per frame at 60fps ≈ 132px/s
// Haptics toggle: pass ?haptics=off in URL to disable
const hapticsEnabled = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('haptics') !== 'off'
  : true;

type GameState = 'start' | 'requesting' | 'countdown' | 'playing' | 'done';
interface BehaviorData { breathVariance: number; avgAltitude: number; coinsCollected: number; spikeCollisions: number; }
interface Coin { x: number; y: number; collected: boolean; floatY: number; floatT: number; spawnX: number; }
interface Spike { x: number; top: boolean; }
interface FloatText { x: number; y: number; t: number; }
interface PulseRing { t: number; maxR: number; }
interface CoinParticle { x: number; y: number; vx: number; vy: number; t: number; }

/** Convert a 6-digit hex color to an "R,G,B" string for rgba() usage on canvas */
function hexToRgbStr(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

function getProfile(b: BehaviorData) {
  if (b.breathVariance < 15) return 'Steady 🧘';
  if (b.breathVariance > 35) return 'Variable 🌊';
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
    accentRgb: '59,130,246',
    usingTouchFallback: false,
    touchVolume: 0,
    touchCleanup: null as (() => void) | null,
    spikeFlashUntil: 0, // timestamp until which to show red flash overlay
    pulseRings: [] as PulseRing[],
    coinParticles: [] as CoinParticle[],
    lastBreathVol: 0,
  });
  const [gameState, setGameState] = useState<GameState>('start');
  const [timeLeft, setTimeLeft] = useState(45);
  const [score, setScore] = useState(0);
  const [behavior, setBehavior] = useState<BehaviorData | null>(null);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (s.usingTouchFallback) return s.touchVolume;
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
    if (s.touchCleanup) { s.touchCleanup(); s.touchCleanup = null; }
    // End-of-game completion sound
    sfx.success();
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
    postWebhook(capturedTheme, 'breath-rider', { score: String(bData.coinsCollected), personality: getProfile(bData), signals: bData }, playerSessionRef.current);
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.altitudeSamples = []; s.volumeSamples = []; s.coinsCollected = 0; s.spikeCollisions = 0;
    s.timeLeft = 45; s.running = true; s.trail = []; s.floatTexts = [];
    s.pulseRings = []; s.coinParticles = []; s.lastBreathVol = 0;
    setTimeLeft(45); setScore(0); setGameState('playing');
    stopMusicRef.current = startMusic('calm');
    const capturedTheme = theme;

    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    s.canvasW = W; s.canvasH = H;
    // Character fixed on left side — elements scroll past
    s.charX = W * 0.18; s.charY = H * 0.5;

    // Touch fallback: hold to breathe
    if (s.usingTouchFallback) {
      const onDown = () => { s.touchVolume = 60; };
      const onUp   = () => { s.touchVolume = 0; };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup',   onUp);
      canvas.addEventListener('pointerleave', onUp);
      s.touchCleanup = () => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointerup',   onUp);
        canvas.removeEventListener('pointerleave', onUp);
      };
    }

    // Coins: start off-screen right, spaced out so they scroll past the character
    s.coins = Array.from({ length: 10 }, (_, i) => ({
      x: W + 80 + i * (W * 0.12 + 20),
      y: H * 0.15 + Math.random() * H * 0.7,
      collected: false, floatY: 0, floatT: Math.random() * Math.PI * 2,
      spawnX: W + 80 + i * (W * 0.12 + 20),
    }));
    // Spikes: interleaved with coins, also scrolling right→left
    s.spikes = Array.from({ length: 8 }, (_, i) => ({
      x: W + 120 + i * (W * 0.15 + 25),
      top: Math.random() > 0.5,
    }));
    s.spikeLastHit = new Array(8).fill(0);

    s.timerIntervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      sfx.tick();
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame(capturedTheme);
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const vol = getVolume();
      s.volumeSamples.push(vol);

      // Breath pulse rings — spawn when volume crosses onset threshold
      if (vol > 28 && s.lastBreathVol <= 28) {
        s.pulseRings.push({ t: Date.now(), maxR: 22 + vol * 0.9 });
      }
      s.lastBreathVol = vol;

      // Physics: blow up, fall down
      const targetY = s.charY - (vol / 100) * H * 0.07 + H * 0.018;
      s.charY += (targetY - s.charY) * 0.14;
      s.charY = Math.max(H * 0.07, Math.min(H * 0.93, s.charY));
      s.altitudeSamples.push(s.charY);

      // Sky/altitude atmosphere
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

      // ── Scroll spikes ──────────────────────────────────────────────────────
      s.spikes.forEach((spike, si) => {
        // Scroll left
        spike.x -= SCROLL_SPEED;
        // Recycle when off-screen left
        if (spike.x < -20) {
          spike.x = W + 20 + Math.random() * W * 0.5;
          spike.top = Math.random() > 0.5;
        }

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
          s.charY = H * 0.5; sfx.collision();
          if (hapticsEnabled) haptic([50, 30, 50]);
          s.spikeFlashUntil = now + 180; // red flash for 180ms
        }
      });

      // ── Scroll coins ────────────────────────────────────────────────────────
      s.coins.forEach((coin, ci) => {
        // Scroll left
        coin.x -= SCROLL_SPEED;

        // Recycle off-screen coins (whether collected or passed)
        if (coin.x < -30) {
          coin.x = W + 30 + Math.random() * W * 0.6;
          coin.y = H * 0.15 + Math.random() * H * 0.7;
          coin.collected = false;
          coin.floatT = Math.random() * Math.PI * 2;
        }

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
          sfx.collect();
          if (hapticsEnabled) haptic([15]);
          s.floatTexts.push({ x: coin.x, y: cy2, t: Date.now() });
          // Burst 8 particles outward from collect point
          for (let pi = 0; pi < 8; pi++) {
            const angle = (Math.PI * 2 * pi) / 8 + Math.random() * 0.4;
            const speed = 1.8 + Math.random() * 2.5;
            s.coinParticles.push({ x: coin.x, y: cy2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, t: Date.now() });
          }
          setScore(s.coinsCollected);
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

      // Red flash overlay on spike collision
      if (Date.now() < s.spikeFlashUntil) {
        const flashAlpha = 0.22 * (1 - (Date.now() - (s.spikeFlashUntil - 180)) / 180);
        ctx.save();
        ctx.fillStyle = `rgba(239,68,68,${Math.max(0, flashAlpha)})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      // ── Breath pulse rings ──────────────────────────────────────────────────
      s.pulseRings = s.pulseRings.filter(ring => Date.now() - ring.t < 600);
      s.pulseRings.forEach(ring => {
        const age = (Date.now() - ring.t) / 600;
        const r = 18 + (ring.maxR - 18) * age;
        const opacity = 0.5 * (1 - age);
        ctx.beginPath();
        ctx.arc(s.charX, s.charY, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${s.accentRgb},${opacity})`;
        ctx.lineWidth = 2 * (1 - age * 0.5);
        ctx.stroke();
      });

      // ── Coin collect particles ───────────────────────────────────────────────
      s.coinParticles = s.coinParticles.filter(p => Date.now() - p.t < 420);
      s.coinParticles.forEach(p => {
        const age = (Date.now() - p.t) / 420;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12; // gentle gravity
        const r = 4 * (1 - age);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(251,191,36,${1 - age})`;
        ctx.fill();
      });

      // Trail
      s.trail.push({ x: s.charX, y: s.charY });
      if (s.trail.length > 6) s.trail.shift();
      s.trail.forEach((pos, i) => {
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 10 * (i / 6), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.accentRgb},${(i/6)*0.4})`; ctx.fill();
      });

      // Character glow
      ctx.save();
      ctx.shadowBlur = 20; ctx.shadowColor = s.accentColor;
      ctx.beginPath(); ctx.arc(s.charX, s.charY, 18, 0, Math.PI * 2);
      ctx.fillStyle = s.accentColor; ctx.fill();
      ctx.strokeStyle = `rgba(${s.accentRgb},0.6)`; ctx.lineWidth = 2; ctx.stroke();
      // Breath aura
      ctx.beginPath(); ctx.arc(s.charX, s.charY, 18 + vol * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${s.accentRgb},${vol/400})`; ctx.fill();
      ctx.restore();

      // Touch fallback hint
      if (s.usingTouchFallback) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Hold screen to fly', W / 2, H - 20);
        ctx.textAlign = 'left';
        ctx.restore();
      }

      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [getVolume, endGame, theme]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
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
      s.usingTouchFallback = false;
      setGameState('countdown');
    } catch {
      // Mic denied — activate touch fallback (hold-to-breathe)
      const s = stateRef.current;
      s.stream = null; s.analyser = null; s.audioCtx = null;
      s.usingTouchFallback = true;
      s.touchVolume = 0;
      setGameState('countdown');
    }
  }, []);

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
      if (s.touchCleanup) s.touchCleanup();
    };
  }, []);

  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent;
    stateRef.current.accentRgb = hexToRgbStr(theme.colors.accent);
  }, [theme]);
  const accent = theme.colors.accent;

  return (
    <GameShell title="Breath Rider" emoji="🌬️" accentColor={accent} theme={theme}>
      <canvas
        ref={canvasRef}
        style={{
          display: gameState==='playing' ? 'block' : 'none',
          position: 'absolute', top: 0, left: 0,
          touchAction: 'none',
        }}
      />
      {gameState==='playing' && (
        <GameHUD
          items={[
            { label: 'COINS', value: String(score) },
            { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10 },
          ]}
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
        />
      )}
      {gameState==='requesting' && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--color-text-secondary)' }}>Requesting microphone…</div>
      )}
      {gameState==='done' && behavior && (
        <EndScreen
          gameId="breath-rider"
          title={getProfile(behavior)}
          emoji="🌬️"
          score={String(behavior.coinsCollected)}
          personality={getProfile(behavior)}
          insights={[
            { label:`Breath control`, value: behavior.breathVariance < 15 ? 'Smooth & steady' : behavior.breathVariance > 35 ? 'Wild & free' : 'Well-focused', color:accent },
            { label:`Avg altitude`, value:`${behavior.avgAltitude}% — You flew ${behavior.avgAltitude > 60 ? 'high' : behavior.avgAltitude < 40 ? 'low' : 'mid-range'}`, color:'#93c5fd' },
            { label:`Spike hits`, value:`${behavior.spikeCollisions} — ${behavior.spikeCollisions === 0 ? 'Flawless!' : behavior.spikeCollisions <= 2 ? 'Quick recovery' : 'Adventurous path'}`, color:'#ef4444' },
            { label:`Coins`, value:`${behavior.coinsCollected} collected`, color:'#fbbf24' },
          ]}
          accentColor={accent}
          onPlayAgain={handlePlayAgain}
          didWin={behavior.coinsCollected >= 7}
        />
      )}
    </GameShell>
  );
}
