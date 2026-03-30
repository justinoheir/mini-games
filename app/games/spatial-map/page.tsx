/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — SPATIAL MAP
 *  A path is shown briefly on a grid. Memorize it, then recreate
 *  it by tapping cells in order.
 *
 *  Signals: roundsCompleted, maxPathLength, wrongTaps, avgRecallMs
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
const GAME_ID   = 'spatial-map';
const PB_KEY    = 'mg_pb_spatial-map';
const ACCENT    = '#06b6d4';
const DURATION  = 60;
const GAME_EMOJI   = '🗺️';
const GAME_TITLE   = 'Spatial Map';
const GAME_TAGLINE = 'Memorize the path, then trace it from memory.';

const GRID   = 4;
const CELLS  = GRID * GRID;  // 16
const WATCH_MS   = 2200;   // how long full path is shown
const FLASH_MS   = 300;
const PAUSE_MS   = 600;

// ── Signals ───────────────────────────────────────────────────────────────────
interface Signals {
  score: number;
  roundsCompleted: number;
  maxPathLength: number;
  wrongTaps: number;
  recallTimes: number[];
}

function getPersonality(sig: Signals): string {
  const avg = sig.recallTimes.length > 0
    ? sig.recallTimes.reduce((a, b) => a + b, 0) / sig.recallTimes.length : 9999;
  if (sig.roundsCompleted >= 6 && sig.maxPathLength >= 7) return 'Pathfinder Elite 🗺️';
  if (sig.roundsCompleted >= 4 && sig.wrongTaps <= 5)     return 'Spatial Navigator 🧭';
  if (avg < 4000 && sig.roundsCompleted >= 3)             return 'Quick Mapper ⚡';
  return 'Exploring the Grid 🌊';
}

type Phase  = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'memorize' | 'recall' | 'paused';

// ── Path generation ──────────────────────────────────────────────────────────
function randomWalk(length: number): number[] {
  const dirs = [-GRID, GRID, -1, 1]; // up, down, left, right
  const path: number[] = [];
  const visited = new Set<number>();
  let cur = Math.floor(Math.random() * CELLS);
  path.push(cur); visited.add(cur);

  for (let step = 1; step < length; step++) {
    const row = Math.floor(cur / GRID), col = cur % GRID;
    const valid = dirs.filter(d => {
      const next = cur + d;
      if (next < 0 || next >= CELLS || visited.has(next)) return false;
      if (d === -1 && col === 0) return false;   // would wrap left
      if (d ===  1 && col === GRID - 1) return false; // would wrap right
      return true;
    });
    if (valid.length === 0) break;
    const d = valid[Math.floor(Math.random() * valid.length)];
    cur += d; path.push(cur); visited.add(cur);
  }
  return path;
}

// ── Layout ───────────────────────────────────────────────────────────────────
interface Layout { cellSize: number; gap: number; startX: number; startY: number; }
function getLayout(W: number, H: number): Layout {
  const maxGrid = Math.min(W * 0.82, H * 0.52, 340);
  const gap     = Math.max(6, Math.floor(maxGrid * 0.035));
  const cellSize = Math.floor((maxGrid - gap * (GRID - 1)) / GRID);
  const totalW  = cellSize * GRID + gap * (GRID - 1);
  const totalH  = totalW;
  return {
    cellSize, gap,
    startX: Math.floor((W - totalW) / 2),
    startY: Math.max(130, Math.floor((H - totalH) / 2)),
  };
}
function cellCoords(idx: number, l: Layout) {
  const row = Math.floor(idx / GRID), col = idx % GRID;
  return { cx: l.startX + col * (l.cellSize + l.gap), cy: l.startY + row * (l.cellSize + l.gap) };
}
function cellCenter(idx: number, l: Layout) {
  const { cx, cy } = cellCoords(idx, l);
  return { x: cx + l.cellSize / 2, y: cy + l.cellSize / 2 };
}
function hitTest(x: number, y: number, l: Layout): number {
  for (let i = 0; i < CELLS; i++) {
    const { cx, cy } = cellCoords(i, l);
    if (x >= cx && x <= cx + l.cellSize && y >= cy && y <= cy + l.cellSize) return i;
  }
  return -1;
}

// ── Rounded rect ─────────────────────────────────────────────────────────────
function rRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y); ctx.lineTo(x + w - rad, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad); ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad); ctx.quadraticCurveTo(x, y, x + rad, y); ctx.closePath();
}

// ── Game state ────────────────────────────────────────────────────────────────
interface CellFlash { color: string; end: number; }
interface GameState {
  running: boolean; timeLeft: number; sig: Signals; accentColor: string;
  subPhase: SubPhase;
  path: number[];           // cell indices in order
  pathLength: number;
  recallIdx: number;        // next expected cell to tap
  recallStart: number;      // performance.now() when recall began
  watchStart: number;       // performance.now() when watch began
  cellFlashes: Map<number, CellFlash>;
  pauseUntil: number; pauseSuccess: boolean;
  round: number;
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, s: GameState) {
  const now    = performance.now();
  const accent = s.accentColor;
  const l      = getLayout(W, H);
  const r      = Math.max(6, l.cellSize * 0.12);

  // Background
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.65, Math.max(W, H));
  bg.addColorStop(0, '#020e16'); bg.addColorStop(0.6, '#010a12'); bg.addColorStop(1, '#000608');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const pathSet = new Set(s.path);

  // Phase label
  const labelY = l.startY - 28;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.max(16, Math.floor(W * 0.042))}px -apple-system, sans-serif`;

  if (s.subPhase === 'memorize') {
    const elapsed = now - s.watchStart;
    const frac = Math.max(0, 1 - elapsed / WATCH_MS);
    ctx.shadowBlur = 14; ctx.shadowColor = accent; ctx.fillStyle = accent;
    ctx.fillText(`MEMORIZE  (${(frac * (WATCH_MS / 1000)).toFixed(1)}s)`, W / 2, labelY);
  } else if (s.subPhase === 'recall') {
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffffff';
    ctx.fillText(`TRACE  ${s.recallIdx} / ${s.path.length}`, W / 2, labelY);
  } else {
    const col = s.pauseSuccess ? '#4ade80' : '#ef4444';
    ctx.shadowBlur = 14; ctx.shadowColor = col; ctx.fillStyle = col;
    ctx.fillText(s.pauseSuccess ? '✓ MAPPED!' : '✗ Wrong path', W / 2, labelY);
  }
  ctx.restore();

  // Draw path connecting lines during memorize
  if (s.subPhase === 'memorize') {
    ctx.save();
    ctx.strokeStyle = `${accent}55`; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 1; i < s.path.length; i++) {
      const a = cellCenter(s.path[i - 1], l);
      const b = cellCenter(s.path[i], l);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  // Draw cells
  for (let i = 0; i < CELLS; i++) {
    const { cx, cy } = cellCoords(i, l);
    const flash = s.cellFlashes.get(i);
    const flashAlive = flash !== undefined && now < flash.end;
    const onPath = pathSet.has(i);
    const isStart = s.path[0] === i;
    const isNext  = s.subPhase === 'recall' && s.path[s.recallIdx] === i;
    const alreadyDone = s.subPhase === 'recall' && s.path.slice(0, s.recallIdx).includes(i);

    ctx.save();
    if (s.subPhase === 'memorize' && onPath) {
      ctx.shadowBlur = isStart ? 28 : 18; ctx.shadowColor = accent;
      ctx.fillStyle = isStart ? `${accent}ee` : `${accent}88`;
      ctx.strokeStyle = accent; ctx.lineWidth = isStart ? 2.5 : 1.5;
    } else if (alreadyDone) {
      ctx.shadowBlur = 8; ctx.shadowColor = '#4ade80';
      ctx.fillStyle = '#4ade8033'; ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.5;
    } else if (isNext) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 280);
      ctx.shadowBlur = 12 + pulse * 10; ctx.shadowColor = '#fff';
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    } else if (flashAlive && flash) {
      const t = (flash.end - now) / FLASH_MS;
      ctx.shadowBlur = t * 16; ctx.shadowColor = flash.color;
      ctx.fillStyle = `${flash.color}44`; ctx.strokeStyle = flash.color; ctx.lineWidth = 2;
    } else {
      ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    }
    rRect(ctx, cx, cy, l.cellSize, l.cellSize, r); ctx.fill(); ctx.stroke();

    // Step number during memorize
    if (s.subPhase === 'memorize' && onPath) {
      const step = s.path.indexOf(i) + 1;
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.max(12, Math.floor(l.cellSize * 0.32))}px -apple-system, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(step), cx + l.cellSize / 2, cy + l.cellSize / 2);
    }
    ctx.restore();
  }

  // Recall progress dots
  if (s.subPhase === 'recall') {
    const dotY = l.startY + l.cellSize * GRID + l.gap * (GRID - 1) + 22;
    const dotR = 5, spc = dotR * 2.8;
    const totalW = s.path.length * spc;
    const ox = W / 2 - totalW / 2 + dotR;
    ctx.save();
    for (let i = 0; i < s.path.length; i++) {
      ctx.beginPath(); ctx.arc(ox + i * spc, dotY, dotR, 0, Math.PI * 2);
      if (i < s.recallIdx) ctx.fillStyle = '#4ade80';
      else if (i === s.recallIdx) { ctx.shadowBlur = 8; ctx.shadowColor = accent; ctx.fillStyle = accent; }
      else { ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.2)'; }
      ctx.fill(); ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function SpatialMapGame() {
  const theme       = useBrandTheme();
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const phaseRef    = useRef<Phase>('start');

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION, accentColor: ACCENT,
    sig: { score: 0, roundsCompleted: 0, maxPathLength: 0, wrongTaps: 0, recallTimes: [] },
    subPhase: 'memorize', path: [], pathLength: 4,
    recallIdx: 0, recallStart: 0, watchStart: 0,
    cellFlashes: new Map(), pauseUntil: 0, pauseSuccess: false, round: 1,
  });

  const [phase, setPhase]           = useState<Phase>('start');
  const [timeLeft, setTimeLeft]     = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [subPhaseUI, setSubPhaseUI] = useState<SubPhase>('memorize');
  const [finalSig, setFinalSig]     = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest]   = useState(false);
  const playerSessionRef            = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const startMemorize = useCallback((s: GameState) => {
    const len  = Math.min(4 + Math.floor(s.round * 0.6), 10);
    s.path     = randomWalk(len);
    s.pathLength = s.path.length;
    s.subPhase = 'memorize';
    s.watchStart = performance.now();
    s.recallIdx  = 0;
    s.cellFlashes.clear();
    setSubPhaseUI('memorize');
    sfx.shimmer?.() ?? sfx.click();
  }, []);

  const startRecall = useCallback((s: GameState) => {
    s.subPhase   = 'recall';
    s.recallStart = performance.now();
    s.cellFlashes.clear();
    setSubPhaseUI('recall');
    sfx.click();
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

    s.running = true; s.timeLeft = DURATION; s.round = 1;
    s.sig = { score: 0, roundsCompleted: 0, maxPathLength: 0, wrongTaps: 0, recallTimes: [] };
    setScoreDisplay(0); setTimeLeft(DURATION);
    phaseRef.current = 'playing'; setPhase('playing');
    stopMusicRef.current = startMusic('calm');

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

    startMemorize(s);

    let prevSubPhase = s.subPhase;
    const loop = (now: number) => {
      if (!s.running) return;

      // Auto-transition from memorize to recall
      if (s.subPhase === 'memorize' && now - s.watchStart >= WATCH_MS) {
        startRecall(s);
      }

      // Transition from paused to next round
      if (s.subPhase === 'paused' && now >= s.pauseUntil) {
        s.round++;
        startMemorize(s);
      }

      if (s.subPhase !== prevSubPhase) {
        prevSubPhase = s.subPhase;
        setSubPhaseUI(s.subPhase);
      }

      // Clean up expired flashes
      for (const [k, fl] of s.cellFlashes) {
        if (now >= fl.end) s.cellFlashes.delete(k);
      }

      drawFrame(ctx, window.innerWidth, window.innerHeight, s);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, startMemorize, startRecall]);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    if (!s.running || s.subPhase !== 'recall') return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.offsetWidth / rect.width);
    const y = (clientY - rect.top)  * (canvas.offsetHeight / rect.height);
    const l = getLayout(window.innerWidth, window.innerHeight);
    const idx = hitTest(x, y, l);
    if (idx < 0) return;

    const expected = s.path[s.recallIdx];
    if (idx === expected) {
      s.cellFlashes.set(idx, { color: '#4ade80', end: performance.now() + FLASH_MS });
      sfx.collect(); haptic([30]);
      s.recallIdx++;
      if (s.recallIdx >= s.path.length) {
        // Round complete
        const recallMs = performance.now() - s.recallStart;
        s.sig.recallTimes.push(recallMs);
        s.sig.roundsCompleted++;
        s.sig.maxPathLength = Math.max(s.sig.maxPathLength, s.path.length);
        const pts = s.path.length * 8 + (s.path.length >= 7 ? 20 : 0);
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        sfx.success(); haptic([30, 50, 30]);
        s.subPhase = 'paused'; s.pauseUntil = performance.now() + PAUSE_MS; s.pauseSuccess = true;
        setSubPhaseUI('paused');
      }
    } else {
      // Wrong tap — flash all path cells red, reset recall
      const now = performance.now();
      for (const ci of s.path) s.cellFlashes.set(ci, { color: '#ef4444', end: now + FLASH_MS });
      sfx.collision(); haptic([20, 30, 20]);
      s.sig.wrongTaps++;
      s.sig.score = Math.max(0, s.sig.score - 5); setScoreDisplay(s.sig.score);
      s.recallIdx = 0;
    }
  }, []);

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
    const avg = sig.recallTimes.length > 0
      ? (sig.recallTimes.reduce((a, b) => a + b, 0) / sig.recallTimes.length / 1000).toFixed(1) : '—';
    const ac = theme.colors.accent ?? ACCENT;
    return [
      { label: 'Rounds Done',  value: String(sig.roundsCompleted), color: ac },
      { label: 'Longest Path', value: String(sig.maxPathLength),   color: sig.maxPathLength >= 7 ? '#4ade80' : ac },
      { label: 'Wrong Taps',   value: String(sig.wrongTaps),       color: sig.wrongTaps <= 5 ? '#4ade80' : '#ef4444' },
      { label: 'Avg Recall',   value: avg === '—' ? '—' : `${avg}s`, color: ac },
    ];
  }, [theme]);

  const accent = theme.colors.accent ?? ACCENT;

  // suppress unused warning for subPhaseUI — used only to force re-render when sub phase changes
  void subPhaseUI;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(6,182,212,0.12) 0%, transparent 55%), linear-gradient(180deg, #020e16 0%, #010a12 50%, #000608 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Spatial Map game canvas"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={accent} items={[
              { label: 'TIME',  value: timeLeft,     danger: timeLeft <= 10, testId: 'timer' },
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
