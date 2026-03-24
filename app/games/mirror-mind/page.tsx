'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'mirror-mind';
const ACCENT = '#8b5cf6';
const DURATION = 45;
const GAME_EMOJI = '🔮';
const GAME_TITLE = 'Mirror Mind';
const GAME_TAGLINE = 'Both hands. Mirrored. Synchronized.';

interface Signals {
  attempts: number;         // total target pairs shown
  synced: number;           // successfully tapped both sides
  avgDeltaMs: number;       // avg time between L and R taps
  totalDeltaMs: number;
  missedPairs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const syncRate = sig.attempts > 0 ? sig.synced / sig.attempts : 0;
  const avgDelta = sig.synced > 0 ? sig.totalDeltaMs / sig.synced : 9999;
  if (syncRate >= 0.85 && avgDelta < 80) return 'Neural Sync 🧠';
  if (sig.synced >= 12 && avgDelta < 120) return 'Mirror Master 🔮';
  if (syncRate >= 0.7) return 'Both-Handed 🤝';
  if (avgDelta < 150) return 'Quick Reflex ⚡';
  return 'Finding Rhythm 🎵';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Target {
  y: number;     // Y position (same for both sides)
  leftX: number; // X on left half
  rightX: number;// X on right half (mirrored)
  radius: number;
  alpha: number; // fades from 1 to 0
  spawnTime: number;
  leftTapped: boolean;
  rightTapped: boolean;
  leftTapTime: number;
  rightTapTime: number;
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  targets: Target[];
  spawnInterval: number; // frames between spawns
  nextSpawn: number;
  speed: number;
}

export default function MirrorMindGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { attempts: 0, synced: 0, avgDeltaMs: 0, totalDeltaMs: 0, missedPairs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    targets: [], spawnInterval: 90, nextSpawn: 60, speed: 1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { attempts: 0, synced: 0, avgDeltaMs: 0, totalDeltaMs: 0, missedPairs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.targets = [];
    s.spawnInterval = 90; s.nextSpawn = 40; s.speed = 1;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Background - deep purple split
      ctx.fillStyle = '#0d0618'; ctx.fillRect(0, 0, W, H);
      // Left half tint
      ctx.fillStyle = 'rgba(139,92,246,0.06)'; ctx.fillRect(0, 0, W / 2, H);
      // Right half tint
      ctx.fillStyle = 'rgba(168,85,247,0.06)'; ctx.fillRect(W / 2, 0, W / 2, H);
      // Center divider
      ctx.strokeStyle = 'rgba(139,92,246,0.4)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.setLineDash([]);

      // Mirror guides (faint vertical lines)
      ctx.strokeStyle = 'rgba(139,92,246,0.1)'; ctx.lineWidth = 1;
      for (let x = 40; x < W / 2; x += 50) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W - x, 0); ctx.lineTo(W - x, H); ctx.stroke();
      }

      // Side labels
      ctx.fillStyle = 'rgba(139,92,246,0.5)'; ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('L', W * 0.15, H - 15);
      ctx.fillText('R', W * 0.85, H - 15);

      // Spawn targets
      s.nextSpawn--;
      if (s.nextSpawn <= 0) {
        const margin = 50;
        const halfW = W / 2;
        const lx = margin + Math.random() * (halfW - margin * 2);
        const ry = margin * 2 + Math.random() * (H - margin * 3);
        s.targets.push({
          y: ry,
          leftX: lx, rightX: W - lx, // perfect mirror
          radius: 32,
          alpha: 1, spawnTime: Date.now(),
          leftTapped: false, rightTapped: false,
          leftTapTime: 0, rightTapTime: 0,
        });
        s.sig.attempts++;
        s.nextSpawn = s.spawnInterval;
        s.spawnInterval = Math.max(45, 90 - s.sig.attempts * 2);
      }

      // Update and draw targets
      const lifetime = 2200;
      s.targets = s.targets.filter(t => {
        const age = Date.now() - t.spawnTime;
        t.alpha = Math.max(0, 1 - age / lifetime);

        // Check if both tapped
        if (t.leftTapped && t.rightTapped) {
          const delta = Math.abs(t.leftTapTime - t.rightTapTime);
          const pts = delta < 80 ? 3 : delta < 150 ? 2 : 1;
          s.sig.synced++;
          s.sig.totalDeltaMs += delta;
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          s.sig.score += pts + (s.sig.streakCurrent >= 3 ? 1 : 0);
          setScoreDisplay(s.sig.score);
          const label = delta < 80 ? '🔥 PERFECT SYNC!' : delta < 150 ? '⚡ SYNCED' : '👍 OK';
          s.floats.push({ x: W / 2, y: t.y - 30, text: label, alpha: 1, vy: -2.5, color: delta < 80 ? '#fbbf24' : ACCENT });
          sfx.collect(); hapticScore();
          if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
          return false; // remove
        }

        // Missed (faded out without both taps)
        if (t.alpha <= 0 && !(t.leftTapped && t.rightTapped)) {
          s.sig.missedPairs++;
          s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          return false;
        }

        if (t.alpha <= 0) return false;

        // Draw left target
        const pulseR = t.radius + Math.sin(s.frame * 0.15) * 3;
        ctx.save(); ctx.globalAlpha = t.alpha;

        // Left
        ctx.shadowBlur = t.leftTapped ? 0 : 16; ctx.shadowColor = ACCENT;
        ctx.strokeStyle = t.leftTapped ? '#4ade80' : ACCENT;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.leftX, t.y, pulseR, 0, Math.PI * 2);
        if (t.leftTapped) { ctx.fillStyle = '#4ade8044'; ctx.fill(); }
        ctx.stroke();

        // Right (mirror)
        ctx.shadowColor = ACCENT;
        ctx.strokeStyle = t.rightTapped ? '#4ade80' : ACCENT;
        ctx.beginPath(); ctx.arc(t.rightX, t.y, pulseR, 0, Math.PI * 2);
        if (t.rightTapped) { ctx.fillStyle = '#4ade8044'; ctx.fill(); }
        ctx.stroke();

        // Inner dots
        ctx.shadowBlur = 0;
        ctx.fillStyle = t.leftTapped ? '#4ade80' : ACCENT;
        ctx.beginPath(); ctx.arc(t.leftX, t.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = t.rightTapped ? '#4ade80' : ACCENT;
        ctx.beginPath(); ctx.arc(t.rightX, t.y, 6, 0, Math.PI * 2); ctx.fill();

        // Connecting line (dashed)
        ctx.strokeStyle = `rgba(139,92,246,${t.alpha * 0.3})`; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(t.leftX + pulseR, t.y); ctx.lineTo(t.rightX - pulseR, t.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        return true;
      });

      // Floats
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const W = canvas.width;
      const isLeft = px < W / 2;

      // Find closest target on appropriate side
      let bestDist = 60, bestIdx = -1;
      s.targets.forEach((t, i) => {
        const tx = isLeft ? t.leftX : t.rightX;
        const already = isLeft ? t.leftTapped : t.rightTapped;
        if (already) return;
        const d = Math.hypot(px - tx, py - t.y);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });

      if (bestIdx >= 0) {
        const t = s.targets[bestIdx];
        if (isLeft) { t.leftTapped = true; t.leftTapTime = Date.now(); }
        else { t.rightTapped = true; t.rightTapTime = Date.now(); }
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tap both sides simultaneously — the circles are mirrored!" ctaLabel="Sync! 🔮" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Mirror Mind game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Synced', value: `${finalSig.synced}/${finalSig.attempts}`, color: ACCENT },
            { label: 'Avg Delta', value: `${finalSig.synced > 0 ? Math.round(finalSig.totalDeltaMs / finalSig.synced) : 0}ms`, color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Missed', value: String(finalSig.missedPairs), color: finalSig.missedPairs === 0 ? '#4ade80' : '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.synced >= 10} />
      )}
    </GameShell>
  );
}
