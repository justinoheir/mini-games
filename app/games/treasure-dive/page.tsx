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

const GAME_ID      = 'treasure-dive';
const ACCENT       = '#0ea5e9';
const DURATION     = 60;
const GAME_EMOJI   = '🤿';
const GAME_TITLE   = 'Treasure Dive';
const GAME_TAGLINE = 'Tilt to steer your diver. Grab treasure, dodge sharks!';

interface Treasure { x: number; y: number; vx: number; vy: number; id: number; type: 'coin' | 'gem' | 'chest'; }
interface Shark    { x: number; y: number; vx: number; vy: number; id: number; }

interface Signals {
  treasureCollected: number;
  sharksAvoided: number;
  sharkHits: number;
  maxCombo: number;
  score: number;
  combo: number;
  distanceTraveled: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  diverX: number;
  diverY: number;
  diverVX: number;
  diverVY: number;
  tiltX: number;
  tiltY: number;
  treasures: Treasure[];
  sharks: Shark[];
  gameSpeed: number;
  spawnTimer: number;
  accentColor: string;
  invulnTimer: number;
  nextId: number;
  bubbles: Array<{x:number;y:number;r:number;vy:number;alpha:number}>;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const evasion = (sig.sharksAvoided + sig.sharkHits) > 0
    ? sig.sharksAvoided / (sig.sharksAvoided + sig.sharkHits) : 1;
  if (sig.treasureCollected >= 20 && evasion >= 0.8) return 'Deep Sea Legend 🏆';
  if (sig.treasureCollected >= 15) return 'Treasure Hunter 💎';
  if (evasion >= 0.9 && sig.sharkHits === 0) return 'Ghost Diver 👻';
  if (sig.maxCombo >= 5) return 'Chain Collector 🔗';
  return 'Casual Explorer 🌊';
}

const TREASURE_EMOJIS = { coin: '🪙', gem: '💎', chest: '📦' };
const TREASURE_PTS = { coin: 1, gem: 3, chest: 5 };

export default function TreasureDiveGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { treasureCollected: 0, sharksAvoided: 0, sharkHits: 0, maxCombo: 0, score: 0, combo: 0, distanceTraveled: 0 },
    diverX: 0, diverY: 0, diverVX: 0, diverVY: 0,
    tiltX: 0, tiltY: 0,
    treasures: [], sharks: [], gameSpeed: 1.5, spawnTimer: 0,
    accentColor: ACCENT, invulnTimer: 0, nextId: 0, bubbles: [],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🤿');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { treasureCollected: 0, sharksAvoided: 0, sharkHits: 0, maxCombo: 0, score: 0, combo: 0, distanceTraveled: 0 };
    s.diverX = canvas.width / 2; s.diverY = canvas.height / 2;
    s.diverVX = 0; s.diverVY = 0; s.tiltX = 0; s.tiltY = 0;
    s.treasures = []; s.sharks = []; s.spawnTimer = 0;
    s.gameSpeed = 1.5; s.invulnTimer = 0; s.nextId = 0; s.bubbles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      s.gameSpeed = Math.min(4, 1.5 + (DURATION - s.timeLeft) * 0.04);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width; const H = canvas.height;

      ctx.fillStyle = '#0c1a2e';
      ctx.fillRect(0, 0, W, H);

      // Ocean gradient
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#0ea5e922');
      grad.addColorStop(1, '#0c1a2e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Spawn objects
      s.spawnTimer++;
      if (s.spawnTimer % 60 === 0) {
        const types: ('coin'|'gem'|'chest')[] = ['coin','coin','coin','gem','chest'];
        const type = types[Math.floor(Math.random() * types.length)];
        const edge = Math.floor(Math.random() * 4);
        let tx = 0, ty = 0, tvx = 0, tvy = 0;
        const spd = s.gameSpeed * (0.8 + Math.random() * 0.4);
        if (edge === 0) { tx = Math.random() * W; ty = -20; tvx = (Math.random()-0.5); tvy = spd; }
        else if (edge === 1) { tx = W+20; ty = Math.random() * H; tvx = -spd; tvy = (Math.random()-0.5); }
        else if (edge === 2) { tx = Math.random() * W; ty = H+20; tvx = (Math.random()-0.5); tvy = -spd; }
        else { tx = -20; ty = Math.random() * H; tvx = spd; tvy = (Math.random()-0.5); }
        s.treasures.push({ x: tx, y: ty, vx: tvx, vy: tvy, id: s.nextId++, type });
      }
      if (s.spawnTimer % 120 === 0 && s.spawnTimer > 60) {
        const side = Math.random() > 0.5 ? 1 : -1;
        s.sharks.push({ x: side > 0 ? W + 30 : -30, y: 50 + Math.random() * (H - 100),
          vx: -side * (s.gameSpeed + 1), vy: (Math.random()-0.5) * 1.5, id: s.nextId++ });
      }

      // Bubbles
      if (Math.random() < 0.1) s.bubbles.push({ x: s.diverX + (Math.random()-0.5)*10, y: s.diverY - 15,
        r: 2 + Math.random() * 4, vy: -0.5 - Math.random(), alpha: 0.7 });
      s.bubbles = s.bubbles.filter(b => b.alpha > 0.05);
      for (const b of s.bubbles) {
        b.y += b.vy; b.alpha -= 0.01;
        ctx.save(); ctx.globalAlpha = b.alpha;
        ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      // Diver movement (tilt or touch drag)
      const ACCEL = 0.3; const FRICTION = 0.88;
      s.diverVX += s.tiltX * ACCEL;
      s.diverVY += s.tiltY * ACCEL;
      s.diverVX *= FRICTION; s.diverVY *= FRICTION;
      s.diverX = Math.max(20, Math.min(W - 20, s.diverX + s.diverVX));
      s.diverY = Math.max(20, Math.min(H - 20, s.diverY + s.diverVY));
      s.sig.distanceTraveled += Math.hypot(s.diverVX, s.diverVY);

      // Treasures
      s.treasures = s.treasures.filter(t => t.x > -30 && t.x < W+30 && t.y > -30 && t.y < H+30);
      for (const t of s.treasures) {
        t.x += t.vx; t.y += t.vy;
        const dist = Math.hypot(t.x - s.diverX, t.y - s.diverY);
        if (dist < 30) {
          t.x = -999; // mark for removal
          s.sig.treasureCollected++;
          s.sig.combo++;
          if (s.sig.combo > s.sig.maxCombo) s.sig.maxCombo = s.sig.combo;
          const pts = TREASURE_PTS[t.type] * (s.sig.combo >= 3 ? 2 : 1);
          s.sig.score += pts;
          setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]);
        } else {
          ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(TREASURE_EMOJIS[t.type], t.x, t.y + 7);
        }
      }
      s.treasures = s.treasures.filter(t => t.x > -30);

      // Sharks
      if (s.invulnTimer > 0) s.invulnTimer--;
      s.sharks = s.sharks.filter(sh => sh.x > -50 && sh.x < W + 50);
      for (const sh of s.sharks) {
        sh.x += sh.vx; sh.y += sh.vy;
        sh.y = Math.max(20, Math.min(H - 20, sh.y));
        const dist = Math.hypot(sh.x - s.diverX, sh.y - s.diverY);
        if (dist < 35 && s.invulnTimer === 0) {
          s.sig.sharkHits++;
          s.sig.combo = 0;
          s.invulnTimer = 120;
          sfx.fail(); haptic([20, 30, 20]);
        }
        if (sh.x < -30 || sh.x > W + 30) s.sig.sharksAvoided++;
        ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
        ctx.save();
        if (sh.vx < 0) { ctx.scale(-1, 1); ctx.fillText('🦈', -sh.x, sh.y + 7); }
        else { ctx.fillText('🦈', sh.x, sh.y + 7); }
        ctx.restore();
      }

      // Diver
      const invuln = s.invulnTimer > 0;
      ctx.save();
      if (invuln) ctx.globalAlpha = Math.sin(Date.now() / 80) * 0.5 + 0.5;
      ctx.shadowBlur = 20; ctx.shadowColor = ACCENT;
      ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🤿', s.diverX, s.diverY + 8);
      ctx.restore();

      // Combo display
      if (s.sig.combo >= 3) {
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`×${s.sig.combo} COMBO!`, W / 2, H - 20);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // Tilt controls
  useEffect(() => {
    if (phase !== 'playing') return;
    const onMotion = (e: DeviceMotionEvent) => {
      const s = stateRef.current;
      if (!s.running) return;
      const ag = e.accelerationIncludingGravity;
      if (!ag) return;
      s.tiltX = (ag.x ?? 0) * 0.3;
      s.tiltY = -(ag.y ?? 0) * 0.3;
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [phase]);

  // Touch drag fallback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);

    let lastTX = 0, lastTY = 0;
    const onDown = (e: PointerEvent) => { lastTX = e.clientX; lastTY = e.clientY; };
    const onMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running) return;
      const dx = e.clientX - lastTX; const dy = e.clientY - lastTY;
      lastTX = e.clientX; lastTY = e.clientY;
      const rect = canvas.getBoundingClientRect();
      s.tiltX = dx * (canvas.width / rect.width) * 0.3;
      s.tiltY = dy * (canvas.height / rect.height) * 0.3;
    };
    const onUp = () => { stateRef.current.tiltX = 0; stateRef.current.tiltY = 0; };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name); setPlayerAvatar(avatar);
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => {
    const evasion = (sig.sharksAvoided + sig.sharkHits) > 0
      ? Math.round((sig.sharksAvoided / (sig.sharksAvoided + sig.sharkHits)) * 100) : 100;
    return [
      { label: 'Treasure Found', value: `${sig.treasureCollected}`, color: sig.treasureCollected >= 10 ? '#4ade80' : '#facc15' },
      { label: 'Shark Evasion',  value: `${evasion}%`,              color: evasion >= 80 ? '#4ade80' : '#ef4444' },
      { label: 'Best Combo',     value: `×${sig.maxCombo}`,          color: ACCENT },
      { label: 'Shark Hits',     value: `${sig.sharkHits}`,          color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Dive In" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Treasure dive underwater game"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.treasureCollected >= 10} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig}
          personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, gameId, { personality, score: sig.score, treasureCollected: sig.treasureCollected,
      sharkHits: sig.sharkHits, sharksAvoided: sig.sharksAvoided, maxCombo: sig.maxCombo,
      distanceTraveled: Math.round(sig.distanceTraveled) }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
