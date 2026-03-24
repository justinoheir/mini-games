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
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'spring-leap';
const ACCENT = '#4ade80';
const DURATION = 45;
const GAME_EMOJI = '🌱';
const GAME_TITLE = 'Spring Leap';
const GAME_TAGLINE = 'Hold to charge. Release to fly.';

interface Platform { x: number; y: number; w: number; h: number; color: string; bonus: boolean; scored: boolean; }

interface Signals {
  totalLeaps: number; landings: number; perfectLandings: number;
  missedLandings: number; maxHeight: number; maxStreak: number; streakCurrent: number; score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.totalLeaps > 0 ? sig.landings / sig.totalLeaps : 0;
  if (acc >= 0.85 && sig.perfectLandings >= 4) return 'Spring Master 🌱';
  if (sig.maxHeight >= 400) return 'High Flyer 🦅';
  if (sig.maxStreak >= 5) return 'Bouncing Beast 🐸';
  if (acc >= 0.6) return 'Good Jumper 🦘';
  return 'Still Bouncing 🌀';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  playerX: number; playerY: number; playerVX: number; playerVY: number;
  onGround: boolean; platforms: Platform[]; scrollY: number;
  charging: boolean; chargeStart: number; chargeLevel: number;
  cameraY: number; maxCameraY: number;
  accentColor: string; floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  scorePop: number; frame: number;
}

export default function SpringLeap() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { totalLeaps: 0, landings: 0, perfectLandings: 0, missedLandings: 0, maxHeight: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    playerX: 0, playerY: 0, playerVX: 0, playerVY: 0, onGround: true,
    platforms: [], scrollY: 0, charging: false, chargeStart: 0, chargeLevel: 0,
    cameraY: 0, maxCameraY: 0,
    accentColor: ACCENT, floats: [], scorePop: 0, frame: 0,
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

  const generatePlatforms = useCallback((W: number, H: number) => {
    const platforms: Platform[] = [];
    const PLATFORM_COLORS = ['#22c55e', '#16a34a', '#15803d', '#4ade80'];
    // Ground platform
    platforms.push({ x: 0, y: H - 40, w: W, h: 40, color: '#166534', bonus: false, scored: false });
    // Ascending platforms
    for (let i = 0; i < 30; i++) {
      const py = H - 140 - i * 80;
      const pw = 60 + Math.random() * 80;
      const px = Math.random() * (W - pw);
      const isBonus = Math.random() < 0.2;
      platforms.push({ x: px, y: py, w: pw, h: 16, color: isBonus ? '#fbbf24' : PLATFORM_COLORS[i % PLATFORM_COLORS.length], bonus: isBonus, scored: false });
    }
    return platforms;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalLeaps: 0, landings: 0, perfectLandings: 0, missedLandings: 0, maxHeight: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.platforms = generatePlatforms(W, H);
    s.playerX = W / 2; s.playerY = H - 60;
    s.playerVX = 0; s.playerVY = 0;
    s.onGround = true; s.cameraY = 0; s.maxCameraY = 0;
    s.charging = false; s.frame = 0; s.floats = []; s.scorePop = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const GRAVITY = 0.5;
    const PLAYER_R = 18;

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Background: lush forest
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#022c1a');
      bg.addColorStop(0.5, '#014010');
      bg.addColorStop(1, '#012208');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Bamboo stalks in background
      ctx.strokeStyle = 'rgba(34,197,94,0.1)';
      ctx.lineWidth = 6;
      for (let bx = 20; bx < W; bx += 50) {
        ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, H); ctx.stroke();
      }

      const camOffset = s.cameraY;

      // Draw platforms
      s.platforms.forEach(p => {
        const py = p.y + camOffset;
        if (py < -40 || py > H + 40) return;
        ctx.save();
        ctx.shadowBlur = p.bonus ? 12 : 4;
        ctx.shadowColor = p.bonus ? '#fbbf24' : '#4ade80';
        ctx.fillStyle = p.color;
        ctx.beginPath();
        (ctx as any).roundRect?.(p.x, py, p.w, p.h, 6) ?? ctx.rect(p.x, py, p.w, p.h);
        ctx.fill();
        if (p.bonus) {
          ctx.fillStyle = '#fbbf24';
          ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('⭐', p.x + p.w / 2, py + 12);
        }
        ctx.restore();
      });

      // Physics
      if (!s.onGround) {
        s.playerVY += GRAVITY;
        s.playerY += s.playerVY;
        s.playerX += s.playerVX;
        s.playerVX *= 0.99;
        s.playerX = Math.max(PLAYER_R, Math.min(W - PLAYER_R, s.playerX));

        // Check platform collisions
        for (const p of s.platforms) {
          const py = p.y + camOffset;
          if (s.playerVY > 0 && s.playerY + PLAYER_R > py && s.playerY + PLAYER_R < py + p.h + 8 && s.playerX > p.x - 5 && s.playerX < p.x + p.w + 5) {
            s.playerY = py - PLAYER_R;
            s.playerVY = 0;
            s.onGround = true;
            s.sig.landings++;
            const chargeTime = s.chargeLevel;
            const isPerfect = chargeTime >= 0.7 && chargeTime <= 0.95;
            if (isPerfect) s.sig.perfectLandings++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            if (!p.scored) {
              p.scored = true;
              const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
              const pts = (p.bonus ? 3 : 1) * mult;
              s.sig.score += pts;
              s.scorePop = Date.now() + 300;
              setScoreDisplay(s.sig.score);
              sfx.collect(); hapticScore();
              s.floats.push({ x: s.playerX, y: s.playerY - 30 + camOffset, text: `+${pts}${p.bonus ? ' ⭐' : ''}`, alpha: 1, vy: -2, color: p.bonus ? '#fbbf24' : '#4ade80' });
            }
            hapticImpact();
            break;
          }
        }

        // Camera follows
        if (s.playerY < H * 0.4) {
          const shift = H * 0.4 - s.playerY;
          s.cameraY += shift;
          s.playerY += shift;
          if (s.cameraY > s.maxCameraY) {
            s.maxCameraY = s.cameraY;
            const heightPts = Math.round(s.cameraY / 100);
            if (heightPts > s.sig.maxHeight) s.sig.maxHeight = heightPts;
          }
        }

        // Fell off bottom
        if (s.playerY > H + 50) {
          s.sig.missedLandings++;
          s.sig.streakCurrent = 0;
          hapticFail(); sfx.fail();
          // Respawn
          s.playerX = W / 2;
          s.playerY = H - 60;
          s.cameraY = 0;
          s.onGround = true;
          s.playerVY = 0; s.playerVX = 0;
        }
      }

      // Charge animation
      if (s.charging) {
        s.chargeLevel = Math.min(1, (Date.now() - s.chargeStart) / 1500);
        const chargeR = PLAYER_R + s.chargeLevel * 20;
        ctx.save();
        ctx.strokeStyle = `rgba(74,222,128,${s.chargeLevel * 0.8})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(s.playerX, s.playerY, chargeR, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      // Draw player (spring frog)
      ctx.save();
      ctx.shadowBlur = 16; ctx.shadowColor = ACCENT;
      const squish = s.charging ? 1 - s.chargeLevel * 0.3 : (s.onGround ? 1.1 : 0.85);
      const stretch = s.charging ? 1 + s.chargeLevel * 0.3 : (s.onGround ? 0.9 : 1.15);
      ctx.scale(squish, stretch);
      const grad = ctx.createRadialGradient(s.playerX / squish - 4, s.playerY / stretch - 4, 2, s.playerX / squish, s.playerY / stretch, PLAYER_R);
      grad.addColorStop(0, '#86efac');
      grad.addColorStop(1, '#16a34a');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(s.playerX / squish, s.playerY / stretch, PLAYER_R, 0, Math.PI * 2); ctx.fill();
      // Eyes
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(s.playerX / squish - 6, s.playerY / stretch - 4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s.playerX / squish + 6, s.playerY / stretch - 4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a2e1a';
      ctx.beginPath(); ctx.arc(s.playerX / squish - 5, s.playerY / stretch - 4, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s.playerX / squish + 7, s.playerY / stretch - 4, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Height progress bar
      const maxH = s.platforms[s.platforms.length - 1]?.y ? Math.abs(s.platforms[s.platforms.length - 1].y - (H - 40)) : 2000;
      const heightPct = Math.min(1, s.maxCameraY / maxH);
      const barH = H * 0.5;
      ctx.fillStyle = '#1a2e1a';
      ctx.fillRect(W - 20, H * 0.25, 10, barH);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(W - 20, H * 0.25 + barH * (1 - heightPct), 10, barH * heightPct);

      // Score pop
      if (s.scorePop > Date.now()) {
        const t = (s.scorePop - Date.now()) / 300;
        ctx.save(); ctx.globalAlpha = t;
        ctx.font = `bold ${Math.round(38 * (1 + (1 - t) * 0.3))}px sans-serif`;
        ctx.fillStyle = ACCENT; ctx.textAlign = 'center';
        ctx.fillText(`${s.sig.score}`, W / 2, 80); ctx.restore();
      }

      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, generatePlatforms]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.onGround) return;
      s.charging = true; s.chargeStart = Date.now(); s.chargeLevel = 0;
    };

    const onPointerUp = () => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.charging || !s.onGround) return;
      s.charging = false;
      const jumpForce = -(8 + s.chargeLevel * 14);
      s.playerVY = jumpForce;
      s.playerVX = (Math.random() - 0.5) * 3;
      s.onGround = false;
      s.sig.totalLeaps++;
      sfx.click(); hapticScore();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
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
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Hold to charge your spring, release to leap to platforms!"
          ctaLabel="Jump! 🌱" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
            role="img" aria-label="Spring leap platform game canvas" />
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
            { label: 'Landings', value: String(finalSig.landings), color: ACCENT },
            { label: 'Perfect Landings', value: String(finalSig.perfectLandings), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
            { label: 'Max Height', value: `${finalSig.maxHeight}`, color: '#a855f7' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.landings >= 8} />
      )}
    </GameShell>
  );
}
