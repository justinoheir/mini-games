/**
 * ══════════════════════════════════════════════════════════════════
 *  SYMBOL SCAN — Ether Mini-Game
 *  Find target symbols in a 4×4 grid before the clock runs out.
 *  Measures visual search speed, accuracy, and sustained attention.
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
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { spawnBurst, updateAndDrawParticles, Particle } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';

const CATEGORY_ACCENT = CATEGORY_THEMES.cognitive.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────

const GAME_ID      = 'symbol-scan';
const PB_KEY       = 'pb_symbol-scan';
const ACCENT       = '#10b981';
const DURATION     = 60;
const GAME_EMOJI   = '🔍';
const GAME_TITLE   = 'Symbol Scan';
const GAME_TAGLINE = 'Find it. Tap it. Before the clock runs out.';

const GRID_SIZE     = 4;        // 4×4
const GRID_CELLS    = 16;
const GRID_DURATION = 8000;     // ms before grid auto-refreshes
const SYMBOLS_COUNT = 8;        // number of distinct symbols

// ─── BEHAVIORAL SIGNALS ──────────────────────────────────────────────────────

interface Signals {
  targetsFound:  number;        // count of target symbols correctly tapped
  falseTaps:     number;        // taps on non-target symbols
  searchTimes:   number[];      // ms from grid appearing to first correct tap
  gridsCleared:  number;        // grids where all targets were found
  missedTargets: number;        // targets that expired without being tapped
  score:         number;        // points (+10 hit, +20 grid clear, -5 false tap)
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  const avgSearchTime = sig.searchTimes.length > 0
    ? sig.searchTimes.reduce((a, b) => a + b, 0) / sig.searchTimes.length
    : 9999;

  if (sig.gridsCleared >= 5 && sig.falseTaps <= 3)          return 'Eagle Eye 🦅';
  if (sig.targetsFound >= 20 && sig.falseTaps > 8)           return 'Rapid Scanner ⚡';
  if (avgSearchTime < 3000 && sig.falseTaps <= 5)            return 'Methodical 🔬';
  return 'Pattern Seeker 🌊';                                 // fallback
}

// ─── SYMBOL DRAWING ──────────────────────────────────────────────────────────
// 8 symbols drawn as pure canvas vector shapes — no emoji, no text rendering.
// Indices: 0=hexagon, 1=diamond, 2=triangle, 3=circle, 4=star, 5=X, 6=square, 7=cross-circle

function drawSymbol(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  symbolIndex: number,
  color: string,
  glowing = false,
): void {
  ctx.save();
  ctx.fillStyle   = color;
  ctx.strokeStyle = color;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  if (glowing) {
    ctx.shadowBlur  = 20;
    ctx.shadowColor = color;
  }

  const r = size * 0.44; // extent radius

  switch (symbolIndex) {
    case 0: { // Hexagon (outline)
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.lineWidth = size * 0.07;
      ctx.stroke();
      break;
    }
    case 1: { // Diamond (filled)
      ctx.beginPath();
      ctx.moveTo(x,          y - r);
      ctx.lineTo(x + r * 0.7, y);
      ctx.lineTo(x,          y + r);
      ctx.lineTo(x - r * 0.7, y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 2: { // Triangle (filled, pointing up)
      ctx.beginPath();
      ctx.moveTo(x,               y - r);
      ctx.lineTo(x + r * 0.866,   y + r * 0.5);
      ctx.lineTo(x - r * 0.866,   y + r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 3: { // Circle (outline)
      ctx.beginPath();
      ctx.arc(x, y, r * 0.88, 0, Math.PI * 2);
      ctx.lineWidth = size * 0.07;
      ctx.stroke();
      break;
    }
    case 4: { // Star 5-pointed (filled)
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a  = (Math.PI / 5) * i - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.42;
        const px = x + rr * Math.cos(a);
        const py = y + rr * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 5: { // X (stroke)
      const xs = r * 0.65;
      ctx.lineWidth = size * 0.1;
      ctx.beginPath(); ctx.moveTo(x - xs, y - xs); ctx.lineTo(x + xs, y + xs); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + xs, y - xs); ctx.lineTo(x - xs, y + xs); ctx.stroke();
      break;
    }
    case 6: { // Filled square
      const sq = r * 0.78;
      ctx.fillRect(x - sq, y - sq, sq * 2, sq * 2);
      break;
    }
    case 7: { // Cross-circle ⊕ (outline circle + plus inside)
      const cr = r * 0.85;
      ctx.lineWidth = size * 0.07;
      ctx.beginPath(); ctx.arc(x, y, cr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - cr); ctx.lineTo(x, y + cr); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - cr, y); ctx.lineTo(x + cr, y); ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

// Confusable pairs for hard mode (round 6+)
const CONFUSABLE_PAIRS: [number, number][] = [
  [0, 3], // hexagon ↔ circle
  [1, 6], // diamond ↔ square
  [2, 4], // triangle ↔ star
  [5, 7], // X ↔ cross-circle
];

function getConfusable(sym: number): number {
  for (const [a, b] of CONFUSABLE_PAIRS) {
    if (sym === a) return b;
    if (sym === b) return a;
  }
  return (sym + 1) % SYMBOLS_COUNT;
}

// ─── GRID GENERATION ─────────────────────────────────────────────────────────

interface GridData {
  gridSymbols:       number[];
  targetSymbol:      number;
  targetCellIndices: number[];
}

function generateGrid(round: number): GridData {
  const hardMode = round > 5;

  // Random target symbol
  const targetSymbol = Math.floor(Math.random() * SYMBOLS_COUNT);

  // 2–4 target cells (Fisher-Yates shuffle to select positions)
  const targetCount = 2 + Math.floor(Math.random() * 3);
  const indices = Array.from({ length: GRID_CELLS }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const targetCellIndices = indices.slice(0, targetCount);

  const confusable = getConfusable(targetSymbol);
  const gridSymbols: number[] = new Array(GRID_CELLS).fill(-1);

  // Place targets
  for (const ci of targetCellIndices) {
    gridSymbols[ci] = targetSymbol;
  }

  // Fill non-target cells
  for (let i = 0; i < GRID_CELLS; i++) {
    if (gridSymbols[i] !== -1) continue;
    if (hardMode && Math.random() < 0.4) {
      gridSymbols[i] = confusable;
    } else {
      let sym: number;
      do { sym = Math.floor(Math.random() * SYMBOLS_COUNT); } while (sym === targetSymbol);
      gridSymbols[i] = sym;
    }
  }

  return { gridSymbols, targetSymbol, targetCellIndices };
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────

interface CellFlash {
  type:    'hit' | 'miss';
  endTime: number;
}

interface GameState {
  running:            boolean;
  timeLeft:           number;
  sig:                Signals;

  // Grid
  gridSymbols:        number[];
  targetSymbol:       number;
  targetCellIndices:  number[];
  cellFound:          boolean[];
  cellFlashes:        Map<number, CellFlash>;

  // Timing
  gridStartTime:      number;
  firstTapInGrid:     number;   // Date.now() of first correct tap; -1 if none yet

  // Progress
  round:              number;
  gridFlashAlpha:     number;   // brief white flash when grid changes

  // Visual
  particles:          Particle[];

  // Layout (computed on resize)
  cellSize:           number;
  gridX:              number;
  gridY:              number;
  targetAreaH:        number;

  // Theme
  accentColor:        string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function SymbolScanGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running:           false,
    timeLeft:          DURATION,
    sig: {
      targetsFound: 0, falseTaps: 0, searchTimes: [],
      gridsCleared: 0, missedTargets: 0, score: 0,
    },
    gridSymbols:       [],
    targetSymbol:      0,
    targetCellIndices: [],
    cellFound:         new Array(GRID_CELLS).fill(false),
    cellFlashes:       new Map(),
    gridStartTime:     0,
    firstTapInGrid:    -1,
    round:             1,
    gridFlashAlpha:    0,
    particles:         [],
    cellSize:          80,
    gridX:             0,
    gridY:             0,
    targetAreaH:       200,
    accentColor:       ACCENT,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);

  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = typeof scoreDisplay === 'number' ? scoreDisplay : 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
      hapticScore();
      playScoreHit('default', numScore - prevScoreRef.current);
      setStreak(Math.floor(numScore / 5));
    }
    prevScoreRef.current = numScore;
  }, [scoreDisplay]); // triggerPop is stable
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  // Sync brand theme accent into state (so rAF loop picks it up)
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── LAYOUT CALCULATION ────────────────────────────────────────────────────

  const computeLayout = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s   = stateRef.current;
    const W   = canvas.width;
    const H   = canvas.height;
    const TAH = Math.min(200, Math.max(160, H * 0.26)); // target area height
    const PAD = 14;
    const avail = H - TAH;
    const cell  = Math.min(
      (W   - PAD * 2) / GRID_SIZE,
      (avail - PAD * 2) / GRID_SIZE,
    );
    s.cellSize    = cell;
    s.targetAreaH = TAH;
    s.gridX       = (W - cell * GRID_SIZE) / 2;
    s.gridY       = TAH + (avail - cell * GRID_SIZE) / 2;
  }, []);

  // ─── SPAWN GRID ────────────────────────────────────────────────────────────

  const spawnGrid = useCallback(() => {
    const s = stateRef.current;
    const { gridSymbols, targetSymbol, targetCellIndices } = generateGrid(s.round);
    s.gridSymbols       = gridSymbols;
    s.targetSymbol      = targetSymbol;
    s.targetCellIndices = targetCellIndices;
    s.cellFound         = new Array(GRID_CELLS).fill(false);
    s.cellFlashes       = new Map();
    s.gridStartTime     = Date.now();
    s.firstTapInGrid    = -1;
    s.gridFlashAlpha    = 0.55;
  }, []);

  // ─── END GAME ──────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    // Personal best tracking
    try {
      const _pbPrev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      const _pbVal = parseFloat(String(s.sig?.score ?? 0));
      if (!isNaN(_pbVal) && _pbVal > _pbPrev) {
        localStorage.setItem(PB_KEY, String(Math.round(_pbVal)));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }


    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  // ─── GAME LOOP ─────────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    s.running       = true;
    s.timeLeft      = DURATION;
    s.round         = 1;
    s.gridFlashAlpha = 0;
    s.particles     = [];
    s.sig = {
      targetsFound: 0, falseTaps: 0, searchTimes: [],
      gridsCleared: 0, missedTargets: 0, score: 0,
    };

    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');

    computeLayout();
    spawnGrid();

    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) {
        sfx.success(); haptic([30, 50, 30, 50, 100]); endGame();
      } else if (s.timeLeft === 10) {
        sfx.warning(); haptic([50, 30, 50]);
      } else {
        sfx.tick();
      }
    }, 1000);

    const loop = () => {
      if (!s.running) return;

      const now = Date.now();
      const W   = canvas.width;
      const H   = canvas.height;
      const { cellSize, gridX, gridY, targetAreaH, accentColor } = s;

      // ── Background ─────────────────────────────────────────────────────────
      ctx.fillStyle = '#08090f';
      ctx.fillRect(0, 0, W, H);

      // Subtle dot-grid background texture
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let gx = 24; gx < W; gx += 40) {
        for (let gy = 24; gy < H; gy += 40) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── Grid timer check ───────────────────────────────────────────────────
      const gridElapsed = now - s.gridStartTime;
      if (gridElapsed >= GRID_DURATION) {
        // Count missed targets before refreshing
        const unfound = s.targetCellIndices.filter(ci => !s.cellFound[ci]).length;
        s.sig.missedTargets += unfound;
        s.round++;
        sfx.collision();
        haptic([60]);
        spawnGrid();
      }

      // ── Target area ────────────────────────────────────────────────────────
      // Accent-tinted band at top
      ctx.fillStyle = `${accentColor}0a`;
      ctx.fillRect(0, 0, W, targetAreaH);

      // Separator line
      ctx.strokeStyle = `${accentColor}30`;
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(0, targetAreaH - 1); ctx.lineTo(W, targetAreaH - 1); ctx.stroke();

      // "FIND" label
      ctx.save();
      ctx.fillStyle  = 'rgba(255,255,255,0.45)';
      ctx.font       = `700 18px 'Space Grotesk', sans-serif`;
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FIND', W / 2, targetAreaH * 0.22);
      ctx.restore();

      // Large target symbol with glow
      const targetDisplaySize = Math.min(targetAreaH * 0.52, 72);
      drawSymbol(ctx, W / 2, targetAreaH * 0.58, targetDisplaySize, s.targetSymbol, accentColor, true);

      // Grid timer progress bar (bottom of target area)
      const gridProgress = Math.min(1, Math.max(0, gridElapsed / GRID_DURATION));
      const remaining    = 1 - gridProgress;
      const barW = W * 0.72;
      const barH = 5;
      const barX = (W - barW) / 2;
      const barY = targetAreaH - 14;
      const barColor = remaining > 0.4 ? accentColor : remaining > 0.2 ? '#facc15' : '#ef4444';

      // Track
      ctx.fillStyle   = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(barX, barY, barW, barH, 3);
      } else {
        ctx.rect(barX, barY, barW, barH);
      }
      ctx.fill();

      // Fill
      if (remaining > 0) {
        ctx.fillStyle = barColor;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(barX, barY, barW * remaining, barH, 3);
        } else {
          ctx.rect(barX, barY, barW * remaining, barH);
        }
        ctx.fill();
      }

      // ── Grid cells ─────────────────────────────────────────────────────────
      ctx.imageSmoothingEnabled = true;

      // Grid flash overlay (grid change transition)
      s.gridFlashAlpha = Math.max(0, s.gridFlashAlpha - 0.04);

      for (let i = 0; i < GRID_CELLS; i++) {
        const col  = i % GRID_SIZE;
        const row  = Math.floor(i / GRID_SIZE);
        const pad  = cellSize * 0.055;
        const cw   = cellSize - pad * 2;
        const cx   = gridX + col * cellSize + cellSize / 2;
        const cy   = gridY + row * cellSize + cellSize / 2;
        const bx   = gridX + col * cellSize + pad;
        const by   = gridY + row * cellSize + pad;

        const flash      = s.cellFlashes.get(i);
        const isMissFlash = flash !== undefined && now < flash.endTime && flash.type === 'miss';
        const isFound    = s.cellFound[i];

        // Determine cell appearance
        let bgColor     = 'rgba(255,255,255,0.04)';
        let borderColor = 'rgba(255,255,255,0.08)';
        let borderWidth = 1;

        if (isFound) {
          bgColor     = 'rgba(34,197,94,0.22)';
          borderColor = '#22c55e';
          borderWidth = 1.5;
        } else if (isMissFlash) {
          const t = 1 - (flash.endTime - now) / 300;
          bgColor     = `rgba(239,68,68,${0.4 - t * 0.3})`;
          borderColor = '#ef4444';
          borderWidth = 1.5;
        }

        // Draw cell background
        ctx.save();
        ctx.fillStyle   = bgColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth   = borderWidth;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bx, by, cw, cw, 7);
        } else {
          ctx.rect(bx, by, cw, cw);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Draw symbol or found indicator
        if (isFound) {
          // Checkmark
          ctx.save();
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth   = cellSize * 0.065;
          ctx.lineCap     = 'round';
          ctx.lineJoin    = 'round';
          ctx.globalAlpha = 0.9;
          const cs = cellSize * 0.16;
          ctx.beginPath();
          ctx.moveTo(cx - cs, cy);
          ctx.lineTo(cx - cs * 0.25, cy + cs * 0.9);
          ctx.lineTo(cx + cs, cy - cs * 0.8);
          ctx.stroke();
          ctx.restore();
        } else {
          // Symbol
          const symColor = isMissFlash ? '#ef4444' : 'rgba(255,255,255,0.82)';
          drawSymbol(ctx, cx, cy, cellSize * 0.48, s.gridSymbols[i], symColor, false);
        }

        // Grid flash overlay on each cell
        if (s.gridFlashAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = s.gridFlashAlpha * 0.35;
          ctx.fillStyle   = accentColor;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(bx, by, cw, cw, 7);
          } else {
            ctx.rect(bx, by, cw, cw);
          }
          ctx.fill();
          ctx.restore();
        }
      }

      // ── Particles ──────────────────────────────────────────────────────────
      updateAndDrawParticles(ctx, s.particles);

      // ── Cleanup expired flashes ────────────────────────────────────────────
      for (const [k, fl] of s.cellFlashes) {
        if (now >= fl.endTime) s.cellFlashes.delete(k);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnGrid, computeLayout]);

  // ─── TAP HANDLER ───────────────────────────────────────────────────────────

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;

    const rect = canvas.getBoundingClientRect();
    const x    = (clientX - rect.left) * (canvas.width  / rect.width);
    const y    = (clientY - rect.top)  * (canvas.height / rect.height);

    const { cellSize, gridX, gridY } = s;

    const col = Math.floor((x - gridX) / cellSize);
    const row = Math.floor((y - gridY) / cellSize);
    if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) return;

    const ci        = row * GRID_SIZE + col;
    const isTarget  = s.targetCellIndices.includes(ci);
    const isFound   = s.cellFound[ci];
    if (isFound) return; // already tapped this target

    if (isTarget) {
      // ── CORRECT TAP ─────────────────────────────────────────────────────
      s.cellFound[ci] = true;
      s.cellFlashes.set(ci, { type: 'hit', endTime: Date.now() + 280 });

      // Record search time on first correct tap in this grid
      if (s.firstTapInGrid === -1) {
        s.firstTapInGrid = Date.now();
        s.sig.searchTimes.push(s.firstTapInGrid - s.gridStartTime);
      }

      s.sig.targetsFound++;
      s.sig.score += 10;
      setScoreDisplay(s.sig.score);
      sfx.collect();
      haptic([30]);

      // Particle burst at tap point
      const tapX = gridX + col * cellSize + cellSize / 2;
      const tapY = gridY + row * cellSize + cellSize / 2;
      spawnBurst(s.particles, tapX, tapY, s.accentColor, 10, 3.5);

      // Check grid clear (all targets found)
      const allFound = s.targetCellIndices.every(idx => s.cellFound[idx]);
      if (allFound) {
        s.sig.gridsCleared++;
        s.sig.score += 20;
        setScoreDisplay(s.sig.score);
        sfx.success();
        haptic([30, 50, 30]);

        // Big burst in grid center
        const cX = gridX + (GRID_SIZE / 2) * cellSize;
        const cY = gridY + (GRID_SIZE / 2) * cellSize;
        spawnBurst(s.particles, cX, cY, s.accentColor, 24, 5);

        s.round++;
        // Short pause before new grid
        s.gridStartTime = Date.now() + 400; // prevents timer from triggering
        setTimeout(() => {
          if (s.running) spawnGrid();
        }, 400);
      }
    } else {
      // ── WRONG TAP ───────────────────────────────────────────────────────
      s.cellFlashes.set(ci, { type: 'miss', endTime: Date.now() + 320 });
      s.sig.falseTaps++;
      s.sig.score = Math.max(0, s.sig.score - 5);
      setScoreDisplay(s.sig.score);
      sfx.collision();
      haptic([80]);
    }
  }, [spawnGrid]);

  // ─── CANVAS SETUP & RESIZE ────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      computeLayout();
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      handleTap(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [handleTap, computeLayout]);

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────

  const buildInsights = useCallback((sig: Signals) => {
    const total   = sig.targetsFound + sig.falseTaps;
    const acc     = total > 0 ? Math.round((sig.targetsFound / total) * 100) : 100;
    const avgMs   = sig.searchTimes.length > 0
      ? sig.searchTimes.reduce((a, b) => a + b, 0) / sig.searchTimes.length
      : 0;
    const avgSec  = (avgMs / 1000).toFixed(1);
    const accent  = theme.colors.accent ?? ACCENT;

    return [
      {
        label: 'Targets Found',
        value: `${sig.targetsFound}`,
        color: sig.targetsFound >= 20 ? '#22c55e' : sig.targetsFound >= 10 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Accuracy',
        value: `${acc}%`,
        color: acc >= 85 ? '#22c55e' : acc >= 70 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Grids Cleared',
        value: `${sig.gridsCleared}`,
        color: accent,
      },
      {
        label: 'Avg Search',
        value: `${avgSec}s`,
        color: avgMs > 0 && avgMs < 2500 ? '#22c55e' : avgMs < 5000 ? '#facc15' : '#ef4444',
      },
    ];
  }, [theme]);

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>

      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Start"
          accentColor={accent}
          onStart={handleStart}
        />
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accent} />
      )}

      {/* ── Game Canvas + HUD ─────────────────────────────────────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas
            ref={canvasRef}
            style={{
              position:    'absolute',
              inset:       0,
              width:       '100%',
              height:      '100%',
              touchAction: 'none',
            }}
          />
          {phase === 'playing' && (
            <GameHUD
              accentColor={accent}
              items={[
                { label: 'TIME',  value: timeLeft,     danger: timeLeft <= 10 },
                { label: 'FOUND', value: scoreDisplay },
              ]}
            />
          )}
        </>
      )}
      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && (
          <motion.div
            key="new-best"
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            style={{
              position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 90, pointerEvents: 'none',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              borderRadius: 20, padding: '8px 20px', fontSize: 20,
              fontWeight: 900, color: '#000', whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(251,191,36,0.5)',
            }}
          >
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>



      {/* ── End Screen ────────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(finalSig.score)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={accent}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.targetsFound >= 10}
        />
      )}

      {/* ── Webhook (fires once on mount) ─────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <WebhookEmitter
          theme={theme}
          gameId={GAME_ID}
          sig={finalSig}
          personality={getPersonality(finalSig)}
          player={playerSessionRef.current}
        />
      )}

      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streak} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────

function WebhookEmitter({
  theme, gameId, sig, personality, player,
}: {
  theme:       ReturnType<typeof useBrandTheme>;
  gameId:      string;
  sig:         Signals;
  personality: string;
  player:      PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const total  = sig.targetsFound + sig.falseTaps;
    const acc    = total > 0 ? sig.targetsFound / total : 1;
    const avgMs  = sig.searchTimes.length > 0
      ? Math.round(sig.searchTimes.reduce((a, b) => a + b, 0) / sig.searchTimes.length)
      : null;

    postWebhook(theme, gameId, {
      personality,
      score:           sig.score,
      targetsFound:    sig.targetsFound,
      falseTaps:       sig.falseTaps,
      gridsCleared:    sig.gridsCleared,
      missedTargets:   sig.missedTargets,
      accuracy:        parseFloat(acc.toFixed(3)),
      avgSearchTimeMs: avgMs,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
