/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — PENCIL PACK
 *  Drag pencils of various sizes into a box without overflow.
 *  Spatial reasoning: figure out which pencils fit in which rows.
 *
 *  Signals: roundsCompleted, pencilsPlaced, overflowAttempts, score
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
const GAME_ID   = 'pencil-pack';
const PB_KEY    = 'mg_pb_pencil-pack';
const ACCENT    = '#f59e0b';
const DURATION  = 60;
const GAME_EMOJI   = '✏️';
const GAME_TITLE   = 'Pencil Pack';
const GAME_TAGLINE = 'Pack the pencils into the box. No overflow allowed.';

const UNIT    = 40;     // pixels per unit
const ROW_CAP = 5;      // units per row
const NUM_ROWS = 4;
const FLASH_MS = 400;
const PAUSE_MS = 700;

const PENCIL_COLORS = ['#fcd34d', '#ef4444', '#3b82f6', '#4ade80', '#a855f7', '#f97316'];
// Puzzle configs: arrays of pencil lengths that can be packed into NUM_ROWS rows of ROW_CAP
const PUZZLES: number[][] = [
  [3, 2, 4, 1, 3, 2],   // 15 units → [3,2],[4,1],[3,2],[] 
  [5, 2, 3, 2, 3],       // 15 units → [5],[2,3],[2,3],[]
  [4, 1, 3, 2, 4, 1],   // 15 units → [4,1],[3,2],[4,1],[]
  [2, 3, 5, 1, 4],       // 15 units → [2,3],[5],[1,4],[]
  [3, 3, 2, 2, 5],       // 15 units → [3,2],[3,2],[5],[]
  [1, 2, 3, 4, 5],       // 15 units → [1,4],[2,3],[5],[]
  [2, 2, 2, 4, 5],       // 15 units → [2,3? no],[2,2],[4,1? ],[5],[] → [5],[4],[2,2],[2,2? no 2+2=4<5]
];

// ── Signals ───────────────────────────────────────────────────────────────────
interface Signals {
  score: number;
  roundsCompleted: number;
  pencilsPlaced: number;
  overflowAttempts: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.pencilsPlaced + sig.overflowAttempts;
  const eff = total > 0 ? sig.pencilsPlaced / total : 0;
  if (sig.roundsCompleted >= 5 && eff >= 0.9)  return 'Master Packer 📦';
  if (sig.roundsCompleted >= 3 && eff >= 0.75) return 'Spatial Thinker 🧠';
  if (sig.pencilsPlaced >= 12)                  return 'Determined Stacker ✏️';
  return 'Learning to Pack 🌊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ── Row / Pencil data ─────────────────────────────────────────────────────────
interface RowState {
  used: number;         // units used
  pencils: number[];    // pencil color indices placed
  flashEnd: number;     // for shake/glow feedback
  flashType: 'ok' | 'over' | 'none';
}
interface Pencil {
  len: number;          // units
  colorIdx: number;
  placed: boolean;
  trayX: number; trayY: number; // tray center
  dragX: number; dragY: number; // drag position (center)
  dragging: boolean;
}

// ── Game state ────────────────────────────────────────────────────────────────
interface GameState {
  running: boolean; timeLeft: number; sig: Signals; accentColor: string;
  rows: RowState[];
  pencils: Pencil[];
  dragIdx: number;   // which pencil is dragged (-1 if none)
  puzzleIdx: number;
  roundComplete: boolean;
  pauseUntil: number;
  round: number;
}

// ── Layout helpers ────────────────────────────────────────────────────────────
interface Layout {
  boxX: number; boxY: number; boxW: number; rowH: number;
  trayY: number; trayItemH: number;
}
function getLayout(W: number, H: number): Layout {
  const boxW  = Math.min(ROW_CAP * UNIT, W - 40);
  const scale = boxW / (ROW_CAP * UNIT);   // if screen is narrow
  const rH    = Math.floor(36 * scale);
  const boxH  = rH * NUM_ROWS + (NUM_ROWS - 1) * 4;
  const boxX  = Math.floor((W - boxW) / 2);
  const boxY  = 130;
  const trayY = boxY + boxH + 32;
  return { boxX, boxY, boxW, rowH: rH, trayY, trayItemH: Math.floor(rH * 1.1) };
}

function pencilW(len: number, boxW: number): number {
  return Math.floor(len / ROW_CAP * boxW);
}

// ── Round setup ───────────────────────────────────────────────────────────────
function buildRound(s: GameState, W: number, H: number) {
  s.puzzleIdx = (s.puzzleIdx + 1) % PUZZLES.length;
  const lengths = [...PUZZLES[s.puzzleIdx]];
  // Shuffle pencil order
  for (let i = lengths.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lengths[i], lengths[j]] = [lengths[j], lengths[i]];
  }
  s.rows = Array.from({ length: NUM_ROWS }, () => ({ used: 0, pencils: [], flashEnd: 0, flashType: 'none' as const }));
  const l = getLayout(W, H);
  const cols = Math.min(3, lengths.length);
  s.pencils = lengths.map((len, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const trayX = l.boxX + col * ((l.boxW + 8) / cols) + pencilW(len, l.boxW) / 2;
    const trayY = l.trayY + row * (l.trayItemH + 8) + l.trayItemH / 2;
    return { len, colorIdx: i % PENCIL_COLORS.length, placed: false, dragging: false, trayX, trayY, dragX: trayX, dragY: trayY };
  });
  s.dragIdx = -1;
  s.roundComplete = false;
  s.pauseUntil = 0;
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

// ── Draw ──────────────────────────────────────────────────────────────────────
function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, s: GameState) {
  const now    = performance.now();
  const accent = s.accentColor;
  const l      = getLayout(W, H);

  // Background
  ctx.fillStyle = '#0a0700'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.6, Math.max(W, H));
  bg.addColorStop(0, 'rgba(245,158,11,0.06)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const gap = 4;
  const rowH = l.rowH;

  // Box outline
  const boxH = rowH * NUM_ROWS + gap * (NUM_ROWS - 1);
  ctx.save();
  ctx.strokeStyle = `${accent}80`; ctx.lineWidth = 2;
  rRect(ctx, l.boxX - 2, l.boxY - 2, l.boxW + 4, boxH + 4, 8);
  ctx.stroke();
  ctx.restore();

  // Rows
  for (let r = 0; r < NUM_ROWS; r++) {
    const row  = s.rows[r];
    const rx   = l.boxX;
    const ry   = l.boxY + r * (rowH + gap);
    const flash = now < row.flashEnd;

    ctx.save();
    ctx.fillStyle = flash
      ? (row.flashType === 'ok' ? 'rgba(74,222,128,0.18)' : 'rgba(239,68,68,0.18)')
      : 'rgba(255,255,255,0.04)';
    rRect(ctx, rx, ry, l.boxW, rowH, 5); ctx.fill();

    if (flash) {
      ctx.strokeStyle = row.flashType === 'ok' ? '#4ade80' : '#ef4444';
      ctx.lineWidth = 2;
      rRect(ctx, rx, ry, l.boxW, rowH, 5); ctx.stroke();
    }

    // Unit grid lines (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let u = 1; u < ROW_CAP; u++) {
      const lx = rx + Math.floor(u / ROW_CAP * l.boxW);
      ctx.beginPath(); ctx.moveTo(lx, ry); ctx.lineTo(lx, ry + rowH); ctx.stroke();
    }

    // Placed pencils in this row
    let xOff = 0;
    for (let pi = 0; pi < row.pencils.length; pi++) {
      // We track pencil indices, not lengths directly — stored as lengths in row.pencils
      const pLen = row.pencils[pi];
      const pw   = Math.floor(pLen / ROW_CAP * l.boxW);
      const pColor = PENCIL_COLORS[pi % PENCIL_COLORS.length]; // fallback color
      // Find the actual pencil for color
      const pencilObj = s.pencils.find(p => p.placed && p.len === pLen && !row.pencils.slice(0, pi).includes(p.len as never));
      const col = pencilObj ? PENCIL_COLORS[pencilObj.colorIdx] : pColor;
      ctx.fillStyle = col;
      ctx.shadowBlur = 6; ctx.shadowColor = col;
      rRect(ctx, rx + xOff + 2, ry + 3, pw - 4, rowH - 6, 4); ctx.fill();
      ctx.shadowBlur = 0;
      xOff += pw;
    }

    // Row capacity bar (bottom of row)
    const used = row.used / ROW_CAP;
    const barW = Math.floor(used * l.boxW);
    if (row.used > 0) {
      ctx.fillStyle = used > 1 ? '#ef4444' : used >= 0.8 ? '#facc15' : '#4ade8077';
      ctx.fillRect(rx, ry + rowH - 3, barW, 3);
    }

    // Row label
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = `500 10px -apple-system, sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(`${row.used}/${ROW_CAP}`, l.boxX + l.boxW - 4, ry + rowH / 2);
    ctx.restore();
  }

  // Tray label
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.font = `700 ${Math.max(13, Math.floor(W * 0.033))}px -apple-system, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('DRAG PENCILS INTO ROWS', W / 2, l.trayY - 8);
  ctx.restore();

  // Tray pencils
  const trayPencils = s.pencils.filter(p => !p.placed && !p.dragging);
  const cols = Math.min(3, s.pencils.length);
  trayPencils.forEach((p, ti) => {
    const col = ti % cols;
    const row = Math.floor(ti / cols);
    const pw  = pencilW(p.len, l.boxW);
    const px  = l.boxX + col * ((l.boxW + 8) / cols);
    const py  = l.trayY + row * (l.trayItemH + 8);
    p.trayX = px + pw / 2; p.trayY = py + l.trayItemH / 2;
    ctx.save();
    ctx.fillStyle = PENCIL_COLORS[p.colorIdx];
    ctx.shadowBlur = 8; ctx.shadowColor = PENCIL_COLORS[p.colorIdx];
    rRect(ctx, px, py, pw, l.trayItemH, 5); ctx.fill();
    ctx.shadowBlur = 0;
    // Length label
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(11, Math.floor(l.trayItemH * 0.35))}px -apple-system, sans-serif`;
    ctx.fillText(String(p.len), px + pw / 2, py + l.trayItemH / 2);
    ctx.restore();
  });

  // Dragged pencil (render on top)
  if (s.dragIdx >= 0) {
    const dp = s.pencils[s.dragIdx];
    if (dp && !dp.placed) {
      const pw = pencilW(dp.len, l.boxW);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = PENCIL_COLORS[dp.colorIdx];
      ctx.shadowBlur = 16; ctx.shadowColor = PENCIL_COLORS[dp.colorIdx];
      rRect(ctx, dp.dragX - pw / 2, dp.dragY - l.trayItemH / 2, pw, l.trayItemH, 5);
      ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;

      // Snap preview: which row would this land in?
      const rowIdx = rowHitTest(dp.dragY, l);
      if (rowIdx >= 0) {
        const rr = s.rows[rowIdx];
        const willFit = rr.used + dp.len <= ROW_CAP;
        ctx.strokeStyle = willFit ? '#4ade80' : '#ef4444';
        ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        rRect(ctx, l.boxX, l.boxY + rowIdx * (l.rowH + gap), l.boxW, l.rowH, 5);
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  // Round complete message
  if (s.pauseUntil > now) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.max(20, Math.floor(W * 0.05))}px -apple-system, sans-serif`;
    ctx.shadowBlur = 20; ctx.shadowColor = '#4ade80'; ctx.fillStyle = '#4ade80';
    ctx.fillText('✓ PACKED!', W / 2, l.boxY + boxH + 20);
    ctx.restore();
  }
}

function rowHitTest(y: number, l: Layout): number {
  for (let r = 0; r < NUM_ROWS; r++) {
    const ry = l.boxY + r * (l.rowH + 4);
    if (y >= ry && y <= ry + l.rowH) return r;
  }
  return -1;
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function PencilPackGame() {
  const theme       = useBrandTheme();
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const phaseRef    = useRef<Phase>('start');

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION, accentColor: ACCENT,
    sig: { score: 0, roundsCompleted: 0, pencilsPlaced: 0, overflowAttempts: 0 },
    rows: [], pencils: [], dragIdx: -1,
    puzzleIdx: -1, roundComplete: false, pauseUntil: 0, round: 0,
  });

  const [phase, setPhase]           = useState<Phase>('start');
  const [timeLeft, setTimeLeft]     = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]     = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest]   = useState(false);
  const playerSessionRef            = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false; s.dragIdx = -1;
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

    s.running = true; s.timeLeft = DURATION; s.round = 0;
    s.sig = { score: 0, roundsCompleted: 0, pencilsPlaced: 0, overflowAttempts: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION);
    phaseRef.current = 'playing'; setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildRound(s, window.innerWidth, window.innerHeight);

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
  }, [endGame]);

  const placePencil = useCallback((pencilIdx: number, rowIdx: number) => {
    const s = stateRef.current;
    const p = s.pencils[pencilIdx];
    if (!p || p.placed) return;
    const row = s.rows[rowIdx];
    if (row.used + p.len <= ROW_CAP) {
      // Success
      p.placed = true; p.dragging = false;
      row.used += p.len;
      row.pencils.push(p.len);
      row.flashEnd = performance.now() + FLASH_MS; row.flashType = 'ok';
      s.sig.pencilsPlaced++;
      s.sig.score += p.len * 5; setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([30]);

      // Check round complete
      const allPlaced = s.pencils.every(pp => pp.placed);
      if (allPlaced) {
        const bonus = s.pencils.length * 10;
        s.sig.score += bonus; setScoreDisplay(s.sig.score);
        s.sig.roundsCompleted++;
        sfx.success(); haptic([30, 50, 30]);
        s.pauseUntil = performance.now() + PAUSE_MS;
        setTimeout(() => {
          if (s.running) buildRound(s, window.innerWidth, window.innerHeight);
        }, PAUSE_MS);
      }
    } else {
      // Overflow
      p.dragging = false; p.dragX = p.trayX; p.dragY = p.trayY;
      row.flashEnd = performance.now() + FLASH_MS; row.flashType = 'over';
      s.sig.overflowAttempts++;
      s.sig.score = Math.max(0, s.sig.score - 3); setScoreDisplay(s.sig.score);
      sfx.collision(); haptic([20, 30, 20]);
    }
    s.dragIdx = -1;
  }, []);

  const onPointerDown = useCallback((e: PointerEvent) => {
    if (phaseRef.current !== 'playing') return;
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current; if (!s.running) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.offsetWidth / rect.width);
    const y = (e.clientY - rect.top)  * (canvas.offsetHeight / rect.height);
    const W = window.innerWidth, H = window.innerHeight;
    const l = getLayout(W, H);

    // Find pencil hit
    for (let i = 0; i < s.pencils.length; i++) {
      const p = s.pencils[i]; if (p.placed) continue;
      const pw = pencilW(p.len, l.boxW);
      // Check tray position
      if (x >= p.trayX - pw / 2 && x <= p.trayX + pw / 2 &&
          y >= p.trayY - l.trayItemH / 2 && y <= p.trayY + l.trayItemH / 2) {
        p.dragging = true; p.dragX = x; p.dragY = y;
        s.dragIdx = i;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    if (s.dragIdx < 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.offsetWidth / rect.width);
    const y = (e.clientY - rect.top)  * (canvas.offsetHeight / rect.height);
    const p = s.pencils[s.dragIdx];
    if (p) { p.dragX = x; p.dragY = y; }
  }, []);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    if (s.dragIdx < 0) return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (canvas.offsetHeight / rect.height);
    const l = getLayout(window.innerWidth, window.innerHeight);
    const rowIdx = rowHitTest(y, l);
    if (rowIdx >= 0) {
      placePencil(s.dragIdx, rowIdx);
    } else {
      // Return to tray
      const p = s.pencils[s.dragIdx];
      if (p) { p.dragging = false; p.dragX = p.trayX; p.dragY = p.trayY; }
      s.dragIdx = -1;
    }
  }, [placePencil]);

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
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup',   onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup',   onPointerUp);
    };
  }, [onPointerDown, onPointerMove, onPointerUp]);

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
    const total = sig.pencilsPlaced + sig.overflowAttempts;
    const eff = total > 0 ? Math.round(sig.pencilsPlaced / total * 100) : 0;
    const ac = theme.colors.accent ?? ACCENT;
    return [
      { label: 'Rounds Done',   value: String(sig.roundsCompleted), color: ac },
      { label: 'Pencils Packed',value: String(sig.pencilsPlaced),   color: sig.pencilsPlaced >= 10 ? '#4ade80' : ac },
      { label: 'Efficiency',    value: `${eff}%`, color: eff >= 85 ? '#4ade80' : eff >= 65 ? '#facc15' : '#ef4444' },
      { label: 'Score',         value: String(sig.score), color: ac },
    ];
  }, [theme]);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.12) 0%, transparent 55%), linear-gradient(180deg, #0a0700 0%, #070500 50%, #030200 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Pencil Pack game canvas"
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
            onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 2} />
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
