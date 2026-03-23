/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — MEMORY GRID
 *  Watch the pattern. Repeat it. Beat the clock.
 *
 *  Sensor: touch (no permissions required)
 *  Duration: 60s
 *  Signals: roundsCompleted, maxSequenceLength, totalErrors,
 *           recallTimes, mistakesOnLongSequences
 * ══════════════════════════════════════════════════════════════════
 */

'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Brain, Eye, Hand } from 'lucide-react';
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
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.cognitive.primaryAccent;

// ─── SPEC CONSTANTS ───────────────────────────────────────────────────────────

const GAME_ID      = 'memory-grid';
const PB_KEY       = 'pb_memory-grid';
const ACCENT       = '#8b5cf6';
const DURATION     = 60;
const GAME_EMOJI   = '🧠';
const GAME_TITLE   = 'Memory Grid';
const GAME_TAGLINE = 'Remember the pattern. Repeat it.';

const CELL_COUNT    = 9;
const GRID_COLS     = 3;
const WATCH_SHOW_MS = 600;  // how long each cell glows during WATCH phase
const WATCH_GAP_MS  = 200;  // pause between cells during WATCH phase
const FLASH_MS      = 380;  // how long green/red feedback lasts
const ROUND_PAUSE_MS = 650; // pause between rounds (shown in rAF time)

// ─── BEHAVIORAL SIGNALS ───────────────────────────────────────────────────────

interface Signals {
  roundsCompleted: number;          // Number of patterns successfully recalled
  maxSequenceLength: number;        // Longest sequence successfully recalled
  totalErrors: number;              // Total wrong cell taps
  recallTimes: number[];            // ms to complete each recall sequence
  mistakesOnLongSequences: number;  // Errors when sequenceLength >= 5
  score: number;                    // Accumulated point total
}

// ─── PERSONALITY CLASSIFICATION ───────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  const avgRecallTime =
    sig.recallTimes.length > 0
      ? sig.recallTimes.reduce((a, b) => a + b, 0) / sig.recallTimes.length
      : 9999;

  if (sig.maxSequenceLength >= 7 && sig.totalErrors <= 2) return 'Memory Master 🧩';
  if (sig.roundsCompleted >= 5 && sig.maxSequenceLength >= 5) return 'Pattern Hunter 🔍';
  if (avgRecallTime < 2000 && sig.totalErrors > 5) return 'Fast Guesser ⚡';
  return 'Steady Mind 🌊';
}

// ─── GRID LAYOUT ──────────────────────────────────────────────────────────────

interface GridLayout {
  cellSize: number;
  gap: number;
  startX: number;
  startY: number;
  totalW: number;
  totalH: number;
}

function getGridLayout(W: number, H: number): GridLayout {
  const maxGridW = Math.min(W * 0.80, H * 0.55, 340);
  const gap      = Math.max(8, Math.floor(maxGridW * 0.04));
  const cellSize = Math.floor((maxGridW - gap * (GRID_COLS - 1)) / GRID_COLS);
  const totalW   = cellSize * GRID_COLS + gap * (GRID_COLS - 1);
  const totalH   = totalW; // square grid
  const startX   = Math.floor((W - totalW) / 2);
  const startY   = Math.floor((H - totalH) / 2) + 30; // slightly below center for label
  return { cellSize, gap, startX, startY, totalW, totalH };
}

function getCellFromCoords(x: number, y: number, W: number, H: number): number {
  const { cellSize, gap, startX, startY } = getGridLayout(W, H);
  for (let i = 0; i < CELL_COUNT; i++) {
    const row = Math.floor(i / GRID_COLS);
    const col = i % GRID_COLS;
    const cx = startX + col * (cellSize + gap);
    const cy = startY + row * (cellSize + gap);
    if (x >= cx && x <= cx + cellSize && y >= cy && y <= cy + cellSize) {
      return i;
    }
  }
  return -1;
}

// ─── ROUNDED RECT HELPER ──────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────

interface CellFlash {
  color: string;  // CSS color
  start: number;  // performance.now() timestamp
}

type SubPhase = 'watch' | 'recall' | 'paused';

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  accentColor: string;

  subPhase: SubPhase;
  cellFlashes: Array<CellFlash | null>;

  // Current sequence
  sequence: number[];
  sequenceLength: number;

  // Watch phase tracking (all times are performance.now())
  watchCellIdx: number;
  watchStepStart: number;
  watchInGap: boolean;

  // Recall phase tracking
  recallIdx: number;
  recallStartTime: number;
  mistakesThisRound: number;

  // Pause / transition
  pauseUntil: number;     // performance.now() after which watch phase begins
  pauseSuccess: boolean;  // was the last round result a success?
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── SUB-PHASE TRANSITIONS ────────────────────────────────────────────────────

function startWatchPhase(s: GameState): void {
  const seq: number[] = [];
  for (let i = 0; i < s.sequenceLength; i++) {
    seq.push(Math.floor(Math.random() * CELL_COUNT));
  }
  s.sequence = seq;
  s.watchCellIdx = 0;
  s.watchStepStart = performance.now();
  s.watchInGap = false;
  s.subPhase = 'watch';
  s.cellFlashes = Array<CellFlash | null>(CELL_COUNT).fill(null);
  // Sound for the first cell activating — safe to call sfx here since initAudio()
  // is always called before startWatchPhase (handled in handleStart pre-countdown)
  sfx.click();
}

function startRecallPhase(s: GameState): void {
  s.subPhase = 'recall';
  s.recallIdx = 0;
  s.recallStartTime = performance.now();
  s.mistakesThisRound = 0;
  s.cellFlashes = Array<CellFlash | null>(CELL_COUNT).fill(null);
}

// ─── CANVAS RENDERING ─────────────────────────────────────────────────────────

function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: GameState,
): void {
  const now = performance.now();
  const accent = s.accentColor;
  const { cellSize, gap, startX, startY, totalH } = getGridLayout(W, H);
  const cornerR = Math.max(8, cellSize * 0.12);

  // ── Background — deep indigo/purple cognitive gradient ───────────────────
  const mgBg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.6, Math.max(W, H) * 0.9);
  mgBg.addColorStop(0,   '#0f0820');
  mgBg.addColorStop(0.55, '#080514');
  mgBg.addColorStop(1,   '#040208');
  ctx.fillStyle = mgBg;
  ctx.fillRect(0, 0, W, H);

  // Subtle vignette
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.8);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  // ── Grid Cells ────────────────────────────────────────────────────────────
  const watchActiveCell =
    s.subPhase === 'watch' && !s.watchInGap
      ? s.sequence[s.watchCellIdx] ?? -1
      : -1;

  for (let i = 0; i < CELL_COUNT; i++) {
    const row = Math.floor(i / GRID_COLS);
    const col = i % GRID_COLS;
    const cx  = startX + col * (cellSize + gap);
    const cy  = startY + row * (cellSize + gap);

    const flash     = s.cellFlashes[i];
    const flashAge  = flash ? now - flash.start : Infinity;
    const flashAlive = flashAge < FLASH_MS;
    const flashT     = flashAlive ? 1 - flashAge / FLASH_MS : 0; // 1→0 as it fades

    const isWatchActive = i === watchActiveCell;

    ctx.save();

    if (isWatchActive) {
      // WATCH phase — glowing cell
      ctx.shadowBlur  = 32;
      ctx.shadowColor = accent;
      ctx.fillStyle   = `${accent}55`;
      ctx.strokeStyle = accent;
      ctx.lineWidth   = 2.5;
    } else if (flashAlive && flash) {
      // Tap feedback — green or red
      const alpha = Math.round(flashT * 0x55).toString(16).padStart(2, '0');
      ctx.shadowBlur  = Math.round(flashT * 28);
      ctx.shadowColor = flash.color;
      ctx.fillStyle   = `${flash.color}${alpha}`;
      ctx.strokeStyle = flash.color;
      ctx.lineWidth   = 2;
    } else {
      // Default idle cell
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = s.subPhase === 'recall' ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.14)';
      ctx.lineWidth   = 1.5;
    }

    roundRect(ctx, cx, cy, cellSize, cellSize, cornerR);
    ctx.fill();
    ctx.stroke();

    // Cell index hint during recall (very subtle)
    if (s.subPhase === 'recall' && !flashAlive) {
      ctx.shadowBlur = 0;
      ctx.fillStyle  = 'rgba(255,255,255,0.07)';
      ctx.font       = `bold ${Math.floor(cellSize * 0.22)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), cx + cellSize / 2, cy + cellSize / 2);
    }

    ctx.restore();
  }

  // ── Phase Label (above grid) ──────────────────────────────────────────────
  const labelY = startY - 36;
  ctx.save();
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  // Minimum 18px on any screen size for legibility (WCAG readable label threshold)
  ctx.font        = `bold ${Math.max(18, Math.floor(W * 0.045))}px -apple-system, system-ui, sans-serif`;

  if (s.subPhase === 'watch') {
    ctx.shadowBlur  = 16;
    ctx.shadowColor = accent;
    ctx.fillStyle   = accent;
    ctx.fillText('WATCH', W / 2, labelY);
  } else if (s.subPhase === 'recall') {
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#ffffff';
    ctx.fillText('RECALL', W / 2, labelY);
  } else {
    // Paused
    const col  = s.pauseSuccess ? '#4ade80' : '#ef4444';
    ctx.shadowBlur  = 14;
    ctx.shadowColor = col;
    ctx.fillStyle   = col;
    ctx.fillText(s.pauseSuccess ? 'NICE! +' + (s.sequenceLength - 1) * 10 : 'RESET', W / 2, labelY);
  }
  ctx.restore();

  // ── Recall progress dots (below grid) ─────────────────────────────────────
  if (s.subPhase === 'recall') {
    const gridBottom = startY + totalH + 22;
    const dotR       = Math.max(5, Math.floor(cellSize * 0.09));
    const dotSpacing = dotR * 3.2;
    const totalDotW  = s.sequenceLength * dotSpacing - (dotSpacing - dotR * 2);
    const dotsOriginX = W / 2 - totalDotW / 2 + dotR;

    ctx.save();
    for (let i = 0; i < s.sequenceLength; i++) {
      const dx = dotsOriginX + i * dotSpacing;
      ctx.beginPath();
      ctx.arc(dx, gridBottom, dotR, 0, Math.PI * 2);
      if (i < s.recallIdx) {
        ctx.fillStyle = '#4ade80';
      } else if (i === s.recallIdx) {
        ctx.shadowBlur  = 10;
        ctx.shadowColor = accent;
        ctx.fillStyle   = accent;
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle  = 'rgba(255,255,255,0.18)';
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // ── Sequence length label (below dots / below grid bottom) ───────────────
  if (s.subPhase === 'watch' || s.subPhase === 'paused') {
    const infoY = startY + totalH + 32;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `${Math.floor(W * 0.032)}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle    = 'rgba(255,255,255,0.35)';
    ctx.fillText(`Sequence length: ${s.sequenceLength}`, W / 2, infoY);
    ctx.restore();
  }
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function MemoryGridGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running:      false,
    timeLeft:     DURATION,
    accentColor:  ACCENT,
    sig: {
      roundsCompleted: 0,
      maxSequenceLength: 0,
      totalErrors: 0,
      recallTimes: [],
      mistakesOnLongSequences: 0,
      score: 0,
    },
    subPhase:          'watch',
    cellFlashes:       Array<null>(CELL_COUNT).fill(null),
    sequence:          [],
    sequenceLength:    3,
    watchCellIdx:      0,
    watchStepStart:    0,
    watchInGap:        false,
    recallIdx:         0,
    recallStartTime:   0,
    mistakesThisRound: 0,
    pauseUntil:        0,
    pauseSuccess:      false,
  });

  const [phase, setPhase]             = useState<Phase>('start');
  const phaseRef                      = useRef<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  // Suppress instructions if already seen (checked after mount to avoid SSR hydration mismatch)
  useEffect(() => {
    try {
      if (localStorage.getItem(`seen_${GAME_ID}`)) setShowInstructions(false);
    } catch { /* ignore */ }
  }, []);
  const [timeLeft, setTimeLeft]       = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(3); // shows current sequence length (LEVEL)
  const [finalSig, setFinalSig]       = useState<Signals | null>(null);
  const [playerName, setPlayerName]   = useState('');
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
  const playerSessionRef              = useRef<PlayerSession | null>(null);



  // Sync brand theme accent into state ref
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── END GAME ──────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.success();
    hapticVictory();
    playVictoryFanfare();
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
    phaseRef.current = 'done';
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
    s.accentColor   = theme.colors.accent ?? ACCENT;
    s.sig = {
      roundsCompleted: 0,
      maxSequenceLength: 0,
      totalErrors: 0,
      recallTimes: [],
      mistakesOnLongSequences: 0,
      score: 0,
    };
    s.sequenceLength = 3;
    setScoreDisplay(3);
    setTimeLeft(DURATION);
    phaseRef.current = 'playing';
    setPhase('playing');

    stopMusicRef.current = startMusic('calm');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Fire warning sfx once at exactly 10s (matches HUD danger threshold)
      if (s.timeLeft === 10) sfx.warning();
      // Tick each second for the final 9s
      if (s.timeLeft > 0 && s.timeLeft < 10) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    // Size canvas
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    const ctx2 = canvas.getContext('2d');
    if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Start first watch phase
    startWatchPhase(s);

    const loop = (now: number) => {
      if (!s.running) return;

      const W = window.innerWidth;
      const H = window.innerHeight;

      // ── Watch phase advancement ─────────────────────────────────────────
      if (s.subPhase === 'watch') {
        const elapsed = now - s.watchStepStart;
        if (!s.watchInGap) {
          if (elapsed >= WATCH_SHOW_MS) {
            s.watchInGap  = true;
            s.watchStepStart = now;
          }
        } else {
          if (elapsed >= WATCH_GAP_MS) {
            s.watchCellIdx++;
            if (s.watchCellIdx >= s.sequenceLength) {
              // All cells shown — switch to recall
              startRecallPhase(s);
            } else {
              s.watchInGap   = false;
              s.watchStepStart = now;
              sfx.click(); // per-cell audio cue — aids multi-sensory memory encoding
            }
          }
        }
      }

      // ── Pause → next watch phase ────────────────────────────────────────
      if (s.subPhase === 'paused' && now >= s.pauseUntil) {
        startWatchPhase(s);
      }

      // ── Render ───────────────────────────────────────────────────────────
      drawFrame(ctx, W, H, s);

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [theme, endGame]);

  // ─── TAP / POINTER INPUT ──────────────────────────────────────────────────

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running || s.subPhase !== 'recall') return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.offsetWidth  / rect.width);
    const y = (clientY - rect.top)  * (canvas.offsetHeight / rect.height);

    const cellIdx = getCellFromCoords(x, y, window.innerWidth, window.innerHeight);
    if (cellIdx < 0) return;

    const expected = s.sequence[s.recallIdx];

    if (cellIdx === expected) {
      // ── Correct tap ────────────────────────────────────────────────────
      s.cellFlashes[cellIdx] = { color: '#4ade80', start: performance.now() };
      sfx.collect();
      haptic([30]);
      s.recallIdx++;

      if (s.recallIdx >= s.sequenceLength) {
        // ── Round complete! ───────────────────────────────────────────────
        const recallTime = performance.now() - s.recallStartTime;
        s.sig.recallTimes.push(recallTime);
        s.sig.roundsCompleted++;
        s.sig.maxSequenceLength = Math.max(s.sig.maxSequenceLength, s.sequenceLength);

        const pts = s.sequenceLength * 10
          + (s.sequenceLength >= 7 ? 20 : 0)
          - s.mistakesThisRound * 5;
        s.sig.score = Math.max(0, s.sig.score + pts);

        s.sequenceLength++;
        setScoreDisplay(s.sequenceLength);

        // Flash all cells green briefly
        const now = performance.now();
        for (let i = 0; i < CELL_COUNT; i++) {
          s.cellFlashes[i] = { color: '#4ade80', start: now };
        }

        sfx.success();
        haptic([30, 50, 30]);

        s.subPhase    = 'paused';
        s.pauseUntil  = performance.now() + ROUND_PAUSE_MS;
        s.pauseSuccess = true;
      }
    } else {
      // ── Wrong tap ──────────────────────────────────────────────────────
      s.cellFlashes[cellIdx] = { color: '#ef4444', start: performance.now() };
      sfx.collision();
      haptic([80]);
      s.sig.totalErrors++;
      if (s.sequenceLength >= 5) s.sig.mistakesOnLongSequences++;
      s.sig.score = Math.max(0, s.sig.score - 5);
      s.mistakesThisRound++;

      if (s.mistakesThisRound >= 2) {
        // ── Round failed ────────────────────────────────────────────────
        s.sequenceLength = Math.max(3, s.sequenceLength - 1);
        setScoreDisplay(s.sequenceLength);

        // Flash all cells red briefly
        const now = performance.now();
        for (let i = 0; i < CELL_COUNT; i++) {
          s.cellFlashes[i] = { color: '#ef4444', start: now };
        }

        s.subPhase    = 'paused';
        s.pauseUntil  = performance.now() + ROUND_PAUSE_MS;
        s.pauseSuccess = false;
      }
    }
  }, []);

  // ─── CANVAS SETUP & RESIZE ────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.style.width  = w + 'px';
      canvas.style.height = h + 'px';
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      handleTap(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [handleTap]);

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
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio();
    phaseRef.current = 'countdown';
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    // Skip the start screen — go straight to countdown so the game restarts immediately.
    // The startLoop() call (triggered by handleCountdownDone) resets all game state.
    setScoreDisplay(3);
    setTimeLeft(DURATION);
    setFinalSig(null);
    phaseRef.current = 'countdown';
    setPhase('countdown');
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────

  const buildInsights = useCallback(
    (sig: Signals, accentColor: string) => {
      const avgRecallSec =
        sig.recallTimes.length > 0
          ? (
              sig.recallTimes.reduce((a, b) => a + b, 0) /
              sig.recallTimes.length /
              1000
            ).toFixed(1)
          : '—';

      return [
        {
          label: 'Max Sequence',
          value: String(sig.maxSequenceLength),
          color:
            sig.maxSequenceLength >= 7
              ? '#4ade80'
              : sig.maxSequenceLength >= 5
              ? '#facc15'
              : '#ef4444',
        },
        {
          label: 'Rounds Won',
          value: String(sig.roundsCompleted),
          color: accentColor,
        },
        {
          label: 'Total Errors',
          value: String(sig.totalErrors),
          color:
            sig.totalErrors <= 2
              ? '#4ade80'
              : sig.totalErrors <= 6
              ? '#facc15'
              : '#ef4444',
        },
        {
          label: 'Avg Recall Speed',
          value: avgRecallSec === '—' ? '—' : `${avgRecallSec}s`,
          color: accentColor,
        },
      ];
    },
    [],
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const accentColor = theme.colors.accent ?? ACCENT;

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="memory-grid"
          steps={[{ icon: "👁️", title: "Watch the pattern", body: "A sequence of tiles will light up." }, { icon: "👆", title: "Repeat it", body: "Tap the tiles in the same order." }, { icon: "🧠", title: "Go longer", body: "Each round adds one more tile to remember." }]}
          onDone={() => {
            try { localStorage.setItem(`seen_${GAME_ID}`, '1'); } catch { /* ignore */ }
            setShowInstructions(false);
          }}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accentColor}
      background="radial-gradient(ellipse at 50% 0%, rgba(255,180,80,0.12) 0%, transparent 55%), linear-gradient(180deg, #120d06 0%, #1e1508 30%, #2a1c0a 55%, #1e1508 80%, #120d06 100%)">
      {/* ── Start Screen ───────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Start"
          accentColor={accentColor}
          onStart={handleStart}
          iconNode={<Brain size={80} color={accentColor} strokeWidth={1.5} />}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0f0820 0%, #080514 55%, #040208 100%)"
        />
      )}

      {/* ── Countdown ──────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accentColor} />
      )}

      {/* ── Playing ────────────────────────────────────────────────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              touchAction: 'none',
            }}
          />
          {phase === 'playing' && (
            <GameHUD
              accentColor={accentColor}
              items={[
                { label: 'TIME',  value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
                { label: 'LEVEL', value: scoreDisplay, testId: 'score' },
              ]}
            />
          )}
          {/* ── Phase banner — unmissable watch/recall indicator ──────────── */}
          {phase === 'playing' && (
            <AnimatePresence mode="wait">
              <motion.div
                key={stateRef.current.subPhase}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.18 }}
                style={{
                  position: 'absolute',
                  bottom: 32,
                  left: 0,
                  right: 0,
                  display: 'flex',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  zIndex: 20,
                }}
              >
                <SubphaseBanner subPhase={stateRef.current.subPhase} accentColor={accentColor} />
              </motion.div>
            </AnimatePresence>
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



      {/* ── End Screen ─────────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(finalSig.score)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig, accentColor)}
          accentColor={accentColor}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.roundsCompleted >= 3}
        />
      )}

      {/* ── Webhook ────────────────────────────────────────────────────────── */}
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
    </>
  );
}

// ─── SUBPHASE BANNER ──────────────────────────────────────────────────────────

function SubphaseBanner({ subPhase, accentColor }: { subPhase: SubPhase; accentColor: string }) {
  if (subPhase === 'watch') {
    return (
      <div style={{
        background: 'rgba(0,0,0,0.75)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 40,
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <Eye size={18} color="rgba(255,255,255,0.9)" />
        <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontSize: 15, letterSpacing: '0.05em' }}>
          MEMORIZE THE PATTERN
        </span>
      </div>
    );
  }
  if (subPhase === 'recall') {
    return (
      <div style={{
        background: accentColor,
        borderRadius: 40,
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: `0 0 24px ${accentColor}88`,
      }}>
        <Hand size={18} color="#fff" />
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '0.05em' }}>
          TAP THE SEQUENCE
        </span>
      </div>
    );
  }
  return null;
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────

function WebhookEmitter({
  theme,
  gameId,
  sig,
  personality,
  player,
}: {
  theme: ReturnType<typeof useBrandTheme>;
  gameId: string;
  sig: Signals;
  personality: string;
  player: PlayerSession | null;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const avgRecallMs =
      sig.recallTimes.length > 0
        ? Math.round(
            sig.recallTimes.reduce((a, b) => a + b, 0) / sig.recallTimes.length,
          )
        : null;

    postWebhook(theme, gameId, {
      personality,
      score:                    sig.score,
      roundsCompleted:          sig.roundsCompleted,
      maxSequenceLength:        sig.maxSequenceLength,
      totalErrors:              sig.totalErrors,
      recallTimes:              sig.recallTimes,
      mistakesOnLongSequences:  sig.mistakesOnLongSequences,
      avgRecallMs,
    }, player);
  }, [theme, gameId, sig, personality, player]);

  return null;
}
