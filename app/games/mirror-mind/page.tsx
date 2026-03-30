/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — MIRROR MIND
 *  Half a symmetrical pattern is shown on the left.
 *  Tap the right-half cells to complete the mirror image.
 *
 *  Signals: roundsCompleted, correctTaps, wrongTaps, maxStreak
 * ══════════════════════════════════════════════════════════════════
 */

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

// ── Constants ────────────────────────────────────────────────────────────────
const GAME_ID   = 'mirror-mind';
const PB_KEY    = 'mg_pb_mirror-mind';
const ACCENT    = '#8b5cf6';
const DURATION  = 45;
const GAME_EMOJI   = '🪞';
const GAME_TITLE   = 'Mirror Mind';
const GAME_TAGLINE = 'Half the pattern is shown — tap cells to complete the mirror image.';

const ROWS      = 4;
const HALF_COLS = 3;   // 3 cols per side, 6 total
const FLASH_MS  = 340;
const PAUSE_MS  = 550;

// ── Signals ──────────────────────────────────────────────────────────────────
interface Signals {
  score: number;
  roundsCompleted: number;
  correctTaps: number;
  wrongTaps: number;
  maxStreak: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.correctTaps + sig.wrongTaps;
  const acc = total > 0 ? sig.correctTaps / total : 0;
  if (sig.roundsCompleted >= 8 && acc >= 0.90) return 'Mirror Master 🪞';
  if (sig.roundsCompleted >= 5 && acc >= 0.75) return 'Spatial Thinker 🧠';
  if (sig.correctTaps >= 18)                    return 'Pattern Finder 🔍';
  return 'Learning Reflections 🌊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ── Layout ───────────────────────────────────────────────────────────────────
interface Layout {
  cellSize: number; gap: number; divGap: number;
  startX: number; startY: number; totalW: number; totalH: number;
}
function getLayout(W: number, H: number): Layout {
  const margin = 20, gap = 6, divGap = 16;
  const availW = W - margin * 2;
  const cellSize = Math.floor((availW - 4 * gap - divGap) / 6);
  const totalW = cellSize * 6 + 4 * gap + divGap;
  const totalH = cellSize * ROWS + gap * (ROWS - 1);
  const startX = Math.floor((W - totalW) / 2);
  const startY = Math.max(130, Math.floor((H - totalH) / 2));
  return { cellSize, gap, divGap, startX, startY, totalW, totalH };
}
function cellX(col: number, l: Layout): number {
  return col < HALF_COLS
    ? l.startX + col * (l.cellSize + l.gap)
    : l.startX + HALF_COLS * (l.cellSize + l.gap) + l.divGap + (col - HALF_COLS) * (l.cellSize + l.gap);
}

// ── Pattern helpers ───────────────────────────────────────────────────────────
function generateLeft(round: number): boolean[] {
  const count = Math.min(2 + Math.floor(round * 0.7), 7);
  const cells  = ROWS * HALF_COLS;
  const pat    = new Array<boolean>(cells).fill(false);
  let filled   = 0;
  while (filled < count) {
    const i = Math.floor(Math.random() * cells);
    if (!pat[i]) { pat[i] = true; filled++; }
  }
  return pat;
}
function mirrorRight(left: boolean[]): boolean[] {
  const right = new Array<boolean>(ROWS * HALF_COLS).fill(false);
  for (let row = 0; row < ROWS; row++)
    for (let c = 0; c < HALF_COLS; c++)
      right[row * HALF_COLS + c] = left[row * HALF_COLS + (HALF_COLS - 1 - c)];
  return right;
}

// ── Rounded rect ─────────────────────────────────────────────────────────────
function rRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y); ctx.lineTo(x + w - rad, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad); ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad); ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

// ── Game state ────────────────────────────────────────────────────────────────
interface CellFlash { color: string; end: number; }
interface GameState {
  running: boolean; timeLeft: number; sig: Signals; accentColor: string;
  leftPattern: boolean[]; expectedRight: boolean[];
  foundRight: boolean[]; rightFlashes: (CellFlash | null)[];
  streak: number; remainingCorrect: number;
  pauseUntil: number; pauseSuccess: boolean; round: number;
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, s: GameState) {
  const now    = performance.now();
  const accent = s.accentColor;
  const l      = getLayout(W, H);
  const r      = Math.max(6, l.cellSize * 0.12);

  // Background
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.7, Math.max(W, H) * 0.9);
  bg.addColorStop(0, '#0d0720'); bg.addColorStop(0.6, '#080414'); bg.addColorStop(1, '#040208');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const fs = Math.max(13, Math.floor(W * 0.032));
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.font = `700 ${fs}px -apple-system, sans-serif`;

  // Column labels
  const leftMid  = l.startX + (HALF_COLS * l.cellSize + (HALF_COLS - 1) * l.gap) / 2;
  const rightStartX = l.startX + HALF_COLS * (l.cellSize + l.gap) + l.divGap;
  const rightMid = rightStartX + (HALF_COLS * l.cellSize + (HALF_COLS - 1) * l.gap) / 2;

  ctx.fillStyle = `${accent}cc`;
  ctx.fillText('PATTERN', leftMid, l.startY - 10);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText('MIRROR IT', rightMid, l.startY - 10);
  ctx.restore();

  // Divider
  const divX = l.startX + HALF_COLS * (l.cellSize + l.gap) + l.divGap / 2;
  ctx.save(); ctx.strokeStyle = `${accent}44`; ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(divX, l.startY - 6); ctx.lineTo(divX, l.startY + l.totalH + 6); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();

  // All cells
  for (let row = 0; row < ROWS; row++) {
    for (let side = 0; side < 2; side++) {
      for (let c = 0; c < HALF_COLS; c++) {
        const col = side * HALF_COLS + c;
        const cx  = cellX(col, l);
        const cy  = l.startY + row * (l.cellSize + l.gap);
        const idx = row * HALF_COLS + c;

        ctx.save();
        if (side === 0) {
          // Left: source pattern
          if (s.leftPattern[idx]) {
            ctx.shadowBlur = 18; ctx.shadowColor = accent;
            ctx.fillStyle = `${accent}bb`; ctx.strokeStyle = accent; ctx.lineWidth = 2;
          } else {
            ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.03)';
            ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
          }
          rRect(ctx, cx, cy, l.cellSize, l.cellSize, r); ctx.fill(); ctx.stroke();
        } else {
          // Right: player fills
          const flash = s.rightFlashes[idx];
          const flashAlive = flash !== null && now < flash.end;
          if (s.foundRight[idx]) {
            ctx.shadowBlur = 16; ctx.shadowColor = '#4ade80';
            ctx.fillStyle = '#4ade8044'; ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
          } else if (flashAlive && flash) {
            const t = (flash.end - now) / FLASH_MS;
            ctx.shadowBlur = t * 16; ctx.shadowColor = flash.color;
            ctx.fillStyle = `${flash.color}33`; ctx.strokeStyle = flash.color; ctx.lineWidth = 2;
          } else {
            ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1.5;
          }
          rRect(ctx, cx, cy, l.cellSize, l.cellSize, r); ctx.fill(); ctx.stroke();

          // Checkmark on found
          if (s.foundRight[idx]) {
            ctx.shadowBlur = 0; ctx.strokeStyle = '#4ade80';
            ctx.lineWidth = l.cellSize * 0.065; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            const s2 = l.cellSize * 0.15, mx = cx + l.cellSize / 2, my = cy + l.cellSize / 2;
            ctx.beginPath(); ctx.moveTo(mx - s2, my);
            ctx.lineTo(mx - s2 * 0.3, my + s2 * 0.9); ctx.lineTo(mx + s2, my - s2 * 0.8); ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
  }

  // Round feedback
  if (s.pauseUntil > now) {
    const msg = s.pauseSuccess ? `✓  +${15 + s.streak * 2}` : 'Reset!';
    const col = s.pauseSuccess ? '#4ade80' : '#ef4444';
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.max(18, Math.floor(W * 0.048))}px -apple-system, sans-serif`;
    ctx.shadowBlur = 20; ctx.shadowColor = col; ctx.fillStyle = col;
    ctx.fillText(msg, W / 2, l.startY + l.totalH + 38);
    ctx.restore();
  }

  // Streak
  if (s.streak >= 3) {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(12, Math.floor(W * 0.030))}px -apple-system, sans-serif`;
    ctx.fillStyle = '#facc15'; ctx.shadowBlur = 8; ctx.shadowColor = '#facc15';
    ctx.fillText(`×${s.streak} STREAK`, W / 2,
      l.startY + l.totalH + (s.pauseUntil > now ? 64 : 38));
    ctx.restore();
  }
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function MirrorMindGame() {
  const theme       = useBrandTheme();
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const phaseRef    = useRef<Phase>('start');

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION, accentColor: ACCENT,
    sig: { score: 0, roundsCompleted: 0, correctTaps: 0, wrongTaps: 0, maxStreak: 0 },
    leftPattern: [], expectedRight: [], foundRight: [], rightFlashes: [],
    streak: 0, remainingCorrect: 0, pauseUntil: 0, pauseSuccess: false, round: 1,
  });

  const [phase, setPhase]           = useState<Phase>('start');
  const [timeLeft, setTimeLeft]     = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]     = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest]   = useState(false);
  const playerSessionRef            = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const newRound = useCallback((s: GameState) => {
    const left     = generateLeft(s.round);
    const expected = mirrorRight(left);
    s.leftPattern     = left;
    s.expectedRight   = expected;
    s.foundRight      = new Array(ROWS * HALF_COLS).fill(false);
    s.rightFlashes    = new Array(ROWS * HALF_COLS).fill(null);
    s.remainingCorrect = expected.filter(Boolean).length;
    s.pauseUntil      = 0;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.success(); haptic([100]);
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    phaseRef.current = 'done'; setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION; s.round = 1; s.streak = 0;
    s.sig = { score: 0, roundsCompleted: 0, correctTaps: 0, wrongTaps: 0, maxStreak: 0 };
    newRound(s); setScoreDisplay(0); setTimeLeft(DURATION);
    phaseRef.current = 'playing'; setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft > 0 && s.timeLeft < 10) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      drawFrame(ctx, window.innerWidth, window.innerHeight, s);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, newRound]);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    if (!s.running || performance.now() < s.pauseUntil) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.offsetWidth / rect.width);
    const y = (clientY - rect.top)  * (canvas.offsetHeight / rect.height);
    const l = getLayout(window.innerWidth, window.innerHeight);

    for (let row = 0; row < ROWS; row++) {
      for (let c = 0; c < HALF_COLS; c++) {
        const cx = cellX(c + HALF_COLS, l);
        const cy = l.startY + row * (l.cellSize + l.gap);
        if (x >= cx && x <= cx + l.cellSize && y >= cy && y <= cy + l.cellSize) {
          const rightIdx = row * HALF_COLS + c;
          if (s.foundRight[rightIdx]) return;

          if (s.expectedRight[rightIdx]) {
            s.foundRight[rightIdx] = true;
            s.sig.correctTaps++;
            s.streak++;
            if (s.streak > s.sig.maxStreak) s.sig.maxStreak = s.streak;
            const pts = 5 + (s.streak >= 3 ? 3 : 0);
            s.sig.score += pts; setScoreDisplay(s.sig.score);
            sfx.collect(); haptic([30]);
            s.remainingCorrect--;
            if (s.remainingCorrect <= 0) {
              const bonus = 15 + s.streak * 2;
              s.sig.score += bonus; setScoreDisplay(s.sig.score);
              s.sig.roundsCompleted++; s.round++;
              sfx.success(); haptic([30, 50, 30]);
              s.pauseUntil = performance.now() + PAUSE_MS; s.pauseSuccess = true;
              setTimeout(() => { if (s.running) newRound(s); }, PAUSE_MS);
            }
          } else {
            s.rightFlashes[rightIdx] = { color: '#ef4444', end: performance.now() + FLASH_MS };
            s.sig.wrongTaps++; s.streak = 0;
            s.sig.score = Math.max(0, s.sig.score - 3); setScoreDisplay(s.sig.score);
            sfx.collision(); haptic([20, 30, 20]);
          }
          return;
        }
      }
    }
  }, [newRound]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      canvas.width  = window.innerWidth  * dpr;
      canvas.height = window.innerHeight * dpr;
      const c = canvas.getContext('2d');
      if (c) c.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); window.addEventListener('resize', resize);
    const onDown = (e: PointerEvent) => { if (phaseRef.current === 'playing') handleTap(e.clientX, e.clientY); };
    canvas.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onDown); };
  }, [handleTap]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); phaseRef.current = 'countdown'; setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    phaseRef.current = 'countdown'; setPhase('countdown');
  }, []);

  const buildInsights = useCallback((sig: Signals) => {
    const total = sig.correctTaps + sig.wrongTaps;
    const acc   = total > 0 ? Math.round(sig.correctTaps / total * 100) : 0;
    const ac    = theme.colors.accent ?? ACCENT;
    return [
      { label: 'Rounds Done', value: String(sig.roundsCompleted), color: ac },
      { label: 'Accuracy',    value: `${acc}%`, color: acc >= 80 ? '#4ade80' : acc >= 55 ? '#facc15' : '#ef4444' },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: sig.maxStreak >= 5 ? '#4ade80' : ac },
      { label: 'Score',       value: String(sig.score), color: ac },
    ];
  }, [theme]);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.14) 0%, transparent 55%), linear-gradient(180deg, #0d0720 0%, #08031a 50%, #04010a 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Mirror Mind game canvas"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={accent} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
              { label: 'SCORE', value: scoreDisplay, testId: 'score' },
            ]} />
          )}
        </>
      )}
      {isNewBest && phase === 'done' && (
        <div style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 90, background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', borderRadius: 20,
          padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000',
          whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(251,191,36,0.5)' }}>🏆 New Best!</div>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={accent}
            onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 3} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

// ── Webhook ───────────────────────────────────────────────────────────────────
function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}
