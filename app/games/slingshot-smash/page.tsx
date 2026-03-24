'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'slingshot-smash';
const ACCENT = '#f97316';
const DURATION = 45;
const GAME_EMOJI = '🪃';
const GAME_TITLE = 'Slingshot Smash';
const GAME_TAGLINE = 'Stretch it. Aim it. Smash it.';

interface Target { x: number; y: number; r: number; hp: number; maxHp: number; color: string; vx: number; vy: number; id: number; }
interface Projectile { x: number; y: number; vx: number; vy: number; r: number; active: boolean; }

interface Signals {
  totalShots: number; hits: number; misses: number;
  bullseyes: number; maxStreak: number; streakCurrent: number;
  maxPower: number; score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.totalShots > 0 ? sig.hits / sig.totalShots : 0;
  if (acc >= 0.8 && sig.bullseyes >= 3) return 'Sharpshooter 🎯';
  if (sig.maxPower >= 20 && acc >= 0.6) return 'Power Sniper 💥';
  if (sig.maxStreak >= 4) return 'Combo Crusher 🔥';
  if (acc >= 0.5) return 'Reliable Slinger 🪃';
  return 'Wild Shooter 🎪';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  targets: Target[]; projectile: Projectile;
  anchorX: number; anchorY: number;
  pullX: number; pullY: number;
  pulling: boolean; pointerId: number | null;
  gravity: number; nextTargetId: number;
  spawnTimer: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number;
}

export default function SlingshotSmash() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalShots: 0, hits: 0, misses: 0, bullseyes: 0, maxStreak: 0, streakCurrent: 0, maxPower: 0, score: 0 },
    targets: [], projectile: { x: 0, y: 0, vx: 0, vy: 0, r: 14, active: false },
    anchorX: 0, anchorY: 0, pullX: 0, pullY: 0, pulling: false, pointerId: null,
    gravity: 0.4, nextTargetId: 0, spawnTimer: 0, accentColor: ACCENT, floats: [], scorePop: 0,
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
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const spawnTarget = useCallback((W: number, H: number) => {
    const s = stateRef.current;
    const colors = ['#ef4444', '#f97316', '#fbbf24', '#22c55e', '#06b6d4'];
    const r = 25 + Math.random() * 25;
    s.targets.push({
      id: s.nextTargetId++,
      x: r + Math.random() * (W - r * 2),
      y: H * 0.1 + Math.random() * H * 0.5,
      r, hp: 2, maxHp: 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 1,
    });
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { totalShots: 0, hits: 0, misses: 0, bullseyes: 0, maxStreak: 0, streakCurrent: 0, maxPower: 0, score: 0 };
    s.targets = [];
    s.projectile = { x: 0, y: 0, vx: 0, vy: 0, r: 14, active: false };
    s.anchorX = W / 2;
    s.anchorY = H * 0.82;
    s.pullX = s.anchorX;
    s.pullY = s.anchorY;
    s.pulling = false;
    s.floats = [];
    s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    for (let i = 0; i < 3; i++) spawnTarget(W, H);

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const MAX_PULL = 100;

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);

      // Background: golden savanna sky
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1a0800');
      bg.addColorStop(0.5, '#2d1200');
      bg.addColorStop(1, '#0f0500');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Horizon glow
      const horizon = ctx.createRadialGradient(W / 2, H * 0.8, 0, W / 2, H * 0.8, W * 0.8);
      horizon.addColorStop(0, 'rgba(249,115,22,0.15)');
      horizon.addColorStop(1, 'transparent');
      ctx.fillStyle = horizon;
      ctx.fillRect(0, 0, W, H);

      // Stars
      for (let i = 0; i < 40; i++) {
        const sx = (i * 137) % W, sy = (i * 79) % (H * 0.6);
        ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.1})`;
        ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI * 2); ctx.fill();
      }

      // Move targets
      s.targets.forEach(t => {
        t.x += t.vx; t.y += t.vy;
        if (t.x - t.r < 0 || t.x + t.r > W) t.vx *= -1;
        if (t.y - t.r < H * 0.05 || t.y + t.r > H * 0.65) t.vy *= -1;
      });

      // Spawn new targets if needed
      if (s.targets.length < 4) {
        s.spawnTimer++;
        if (s.spawnTimer > 60) { spawnTarget(W, H); s.spawnTimer = 0; }
      }

      // Draw targets
      s.targets.forEach(t => {
        ctx.save();
        ctx.shadowBlur = 14;
        ctx.shadowColor = t.color;
        // Concentric rings (bullseye)
        for (let ring = 3; ring >= 1; ring--) {
          const rf = (ring / 3) * t.r;
          ctx.fillStyle = ring % 2 === 0 ? t.color + 'cc' : t.color + '44';
          ctx.beginPath(); ctx.arc(t.x, t.y, rf, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.stroke();
        // HP dots
        for (let h = 0; h < t.maxHp; h++) {
          ctx.fillStyle = h < t.hp ? '#ffffff' : '#333';
          ctx.beginPath(); ctx.arc(t.x - 6 + h * 12, t.y + t.r + 10, 5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      });

      // Y-shaped slingshot
      ctx.save();
      ctx.strokeStyle = '#8b4513';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      const bx = s.anchorX;
      const by = s.anchorY;
      ctx.beginPath(); ctx.moveTo(bx - 30, by + 40); ctx.lineTo(bx, by); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx + 30, by + 40); ctx.lineTo(bx, by); ctx.stroke();
      // Bands
      if (!s.projectile.active) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(bx - 30, by);
        ctx.lineTo(s.pullX, s.pullY);
        ctx.lineTo(bx + 30, by);
        ctx.stroke();
      }
      ctx.restore();

      // Pull indicator
      if (s.pulling && !s.projectile.active) {
        const dx = s.pullX - s.anchorX, dy = s.pullY - s.anchorY;
        const pull = Math.min(Math.sqrt(dx * dx + dy * dy), MAX_PULL);
        const pct = pull / MAX_PULL;
        ctx.save();
        ctx.strokeStyle = `rgba(255,${Math.round(255 * (1 - pct))},0,0.5)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        const launchVX = -(dx / MAX_PULL) * 22;
        const launchVY = -(dy / MAX_PULL) * 22;
        ctx.beginPath();
        ctx.moveTo(s.anchorX, s.anchorY);
        let tx = s.anchorX, ty = s.anchorY;
        let tvx = launchVX, tvy = launchVY;
        for (let i = 0; i < 15; i++) {
          tx += tvx; ty += tvy; tvy += s.gravity;
          ctx.lineTo(tx, ty);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Projectile at pull pos
        ctx.save();
        ctx.shadowBlur = 10; ctx.shadowColor = ACCENT;
        ctx.fillStyle = ACCENT;
        ctx.beginPath(); ctx.arc(s.pullX, s.pullY, 14, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Projectile in flight
      if (s.projectile.active) {
        s.projectile.vx *= 0.995;
        s.projectile.vy += s.gravity;
        s.projectile.x += s.projectile.vx;
        s.projectile.y += s.projectile.vy;

        // Hit targets
        let hit = false;
        for (let i = s.targets.length - 1; i >= 0; i--) {
          const t = s.targets[i];
          const dist = Math.sqrt((s.projectile.x - t.x) ** 2 + (s.projectile.y - t.y) ** 2);
          if (dist < t.r + s.projectile.r) {
            hit = true;
            t.hp--;
            const isBullseye = dist < t.r * 0.4;
            if (isBullseye) s.sig.bullseyes++;
            s.sig.hits++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const pts = isBullseye ? 3 : 1;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts * mult;
            s.scorePop = Date.now() + 300;
            setScoreDisplay(s.sig.score);
            sfx.collect();
            hapticScore();
            if (isBullseye) { sfx.success(); }
            s.floats.push({ x: t.x, y: t.y - 20, text: isBullseye ? `+${pts * mult} 🎯 BULL!` : `+${pts * mult}`, alpha: 1, vy: -2, color: isBullseye ? '#fbbf24' : '#4ade80' });
            if (t.hp <= 0) s.targets.splice(i, 1);
            s.projectile.active = false;
            break;
          }
        }
        if (!hit && (s.projectile.y > H + 50 || s.projectile.x < -50 || s.projectile.x > W + 50)) {
          s.sig.misses++;
          s.sig.streakCurrent = 0;
          s.projectile.active = false;
          hapticFail();
          s.floats.push({ x: W / 2, y: H * 0.7, text: 'Miss!', alpha: 1, vy: -1.5, color: '#ef4444' });
        }

        if (s.projectile.active) {
          ctx.save();
          ctx.shadowBlur = 14; ctx.shadowColor = ACCENT;
          ctx.fillStyle = ACCENT;
          ctx.beginPath(); ctx.arc(s.projectile.x, s.projectile.y, s.projectile.r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      // Score pop
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save(); ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(40 * (1 + (1 - t) * 0.3))}px sans-serif`;
        ctx.fillStyle = '#fbbf24'; ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W / 2, 90); ctx.restore();
      }

      // Float texts
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnTarget]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const MAX_PULL = 100;

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.projectile.active || s.pulling) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const dx = px - s.anchorX, dy = py - s.anchorY;
      if (Math.sqrt(dx * dx + dy * dy) < 60) {
        s.pulling = true;
        s.pointerId = e.pointerId;
        s.pullX = px; s.pullY = py;
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.pulling || s.pointerId !== e.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      let px = (e.clientX - rect.left) * (canvas.width / rect.width);
      let py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const dx = px - s.anchorX, dy = py - s.anchorY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MAX_PULL) { px = s.anchorX + dx / dist * MAX_PULL; py = s.anchorY + dy / dist * MAX_PULL; }
      s.pullX = px; s.pullY = py;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.pulling || s.pointerId !== e.pointerId) return;
      s.pulling = false;
      s.pointerId = null;
      const dx = s.pullX - s.anchorX, dy = s.pullY - s.anchorY;
      const power = Math.min(Math.sqrt(dx * dx + dy * dy), MAX_PULL);
      if (power > 10) {
        s.projectile.x = s.anchorX; s.projectile.y = s.anchorY;
        s.projectile.vx = -(dx / MAX_PULL) * 22;
        s.projectile.vy = -(dy / MAX_PULL) * 22;
        s.projectile.active = true;
        s.sig.totalShots++;
        if (power > s.sig.maxPower) s.sig.maxPower = power;
        sfx.click();
        hapticImpact();
      }
      s.pullX = s.anchorX; s.pullY = s.anchorY;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Fire Away! 🪃" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Slingshot target game canvas" />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.totalShots > 0 ? Math.round(finalSig.hits / finalSig.totalShots * 100) : 0}%`, color: ACCENT },
            { label: 'Bullseyes', value: String(finalSig.bullseyes), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Max Power', value: `${Math.round(finalSig.maxPower)}`, color: '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 5} />
      )}
    </GameShell>
  );
}
