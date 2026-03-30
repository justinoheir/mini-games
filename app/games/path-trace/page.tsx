/**
 * ══════════════════════════════════════════════════════════════════
 *  PATH TRACE — Ether Mini-Game
 *  Spec: game-specs/path-trace.json
 *  Sensor: touch | Duration: 60s | Category: skill
 *
 *  Players trace glowing bezier paths from start to end dot.
 *  Deviation from path is measured every frame. Precision is the metric.
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
import { hapticScore, hapticFail, hapticVictory, hapticCelebration } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { spawnBurst, updateAndDrawParticles, type Particle } from '@/lib/particles';
import SwipeInstructions from '@/components/SwipeInstructions';
import { PenLine } from 'lucide-react';

// ─── SPEC CONSTANTS ────────────────────────────────────────────────────────────
const GAME_ID      = 'path-trace';
const ACCENT       = '#059669';
const DURATION     = 60;
const GAME_EMOJI   = '✏️';
const GAME_TITLE   = 'Path Trace';
const GAME_TAGLINE = "Follow the line. Don't stray.";

// ─── PURE HELPERS (module-level, no React deps) ────────────────────────────────

interface Pt { x: number; y: number; }

interface PathData {
  startX: number; startY: number;
  endX: number;   endY: number;
  cp1X: number;   cp1Y: number;
  cp2X: number;   cp2Y: number;
  points: Pt[];   // sampled bezier points for deviation calc
}

function sampleCubicBezier(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  numPoints = 150,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t  = i / numPoints;
    const mt = 1 - t;
    pts.push({
      x: mt*mt*mt*p0x + 3*mt*mt*t*p1x + 3*mt*t*t*p2x + t*t*t*p3x,
      y: mt*mt*mt*p0y + 3*mt*mt*t*p1y + 3*mt*t*t*p2y + t*t*t*p3y,
    });
  }
  return pts;
}

function closestDistToPath(px: number, py: number, pts: Pt[]): number {
  let min = Infinity;
  for (const p of pts) {
    const d = Math.hypot(px - p.x, py - p.y);
    if (d < min) min = d;
  }
  return min;
}

function generatePath(W: number, H: number, round: number): PathData {
  const margin    = 70;
  const topMargin = 96; // HUD clearance
  const playH     = H - topMargin;

  // Random start position
  const startX = margin + Math.random() * (W - margin * 2);
  const startY = topMargin + margin + Math.random() * (playH - margin * 2.5);

  // End position: at least 160px from start
  let endX = 0, endY = 0;
  for (let a = 0; a < 50; a++) {
    endX = margin + Math.random() * (W - margin * 2);
    endY = topMargin + margin + Math.random() * (playH - margin * 2.5);
    if (Math.hypot(endX - startX, endY - startY) >= 160) break;
  }

  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;

  let cp1X: number, cp1Y: number, cp2X: number, cp2Y: number;

  if (round <= 2) {
    // Gentle single arc — moderate offset
    const off = W * 0.22;
    cp1X = midX + (Math.random() - 0.5) * off * 2;
    cp1Y = midY - off * (0.3 + Math.random() * 0.4);
    cp2X = midX + (Math.random() - 0.5) * off * 0.8;
    cp2Y = midY + off * 0.15;
  } else if (round <= 4) {
    // S-curve — opposing control points
    const off = W * 0.30;
    const sign = Math.random() < 0.5 ? 1 : -1;
    cp1X = startX + (endX - startX) * 0.25 + off * sign;
    cp1Y = startY + (Math.random() - 0.5) * playH * 0.35;
    cp2X = endX   - (endX - startX) * 0.25 - off * sign;
    cp2Y = endY   + (Math.random() - 0.5) * playH * 0.35;
  } else {
    // Complex — more dramatic control points
    const off = W * 0.40;
    cp1X = startX + (Math.random() - 0.5) * off * 2;
    cp1Y = topMargin + Math.random() * playH * 0.85;
    cp2X = endX   + (Math.random() - 0.5) * off * 2;
    cp2Y = topMargin + Math.random() * playH * 0.85;
  }

  // Clamp to safe area
  const cx = (v: number) => Math.max(20,          Math.min(W - 20, v));
  const cy = (v: number) => Math.max(topMargin + 8, Math.min(H - 20, v));
  cp1X = cx(cp1X); cp1Y = cy(cp1Y);
  cp2X = cx(cp2X); cp2Y = cy(cp2Y);

  const points = sampleCubicBezier(startX, startY, cp1X, cp1Y, cp2X, cp2Y, endX, endY);
  return { startX, startY, endX, endY, cp1X, cp1Y, cp2X, cp2Y, points };
}

function getCanvasCoords(clientX: number, clientY: number, canvas: HTMLCanvasElement): Pt {
  const rect = canvas.getBoundingClientRect();
  // Path points generated in CSS-pixel space (canvas.offsetWidth); return CSS pixels for consistency
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

// ─── BEHAVIORAL SIGNALS ─────────────────────────────────────────────────────────
interface Signals {
  avgDeviation:     number;    // avg px deviation from ideal path while tracing
  completionSpeeds: number[];  // ms per completed path
  pathsCompleted:   number;    // count
  deviationEvents:  number;    // times finger strayed > 20px from path
  liftEvents:       number;    // times finger lifted mid-trace
  score:            number;
}

// ─── PERSONALITY CLASSIFICATION ─────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const avgSpeed =
    sig.completionSpeeds.length > 0
      ? sig.completionSpeeds.reduce((a, b) => a + b, 0) / sig.completionSpeeds.length
      : 9999;

  const isVeryPrecise   = sig.avgDeviation < 10;
  const isFairlyPrecise = sig.avgDeviation < 18;
  const isFast          = avgSpeed < 3000;
  const isProductive    = sig.pathsCompleted >= 5;
  const isCalm          = sig.liftEvents <= 1 && sig.deviationEvents <= 3;

  // Guardian: highest precision + calmest execution
  if (isVeryPrecise && isCalm && sig.pathsCompleted >= 3) return 'Guardian 🛡️';
  // Optimizer: fast throughput, results-driven
  if (isFast && isProductive) return 'Optimizer ⚡';
  // Sage: deliberate and precise, wisdom over speed
  if (isFairlyPrecise && !isFast && sig.pathsCompleted >= 2) return 'Sage 🧘';
  // Connector: high completion, fluid motion
  if (isProductive) return 'Connector 🔗';
  // Harmonizer: goes with the flow, adapts and persists
  return 'Harmonizer 🌊';
}

// ─── GAME STATE ──────────────────────────────────────────────────────────────────
interface GameState {
  running:       boolean;
  timeLeft:      number;
  sig:           Signals;

  // Path
  currentPath:   PathData | null;
  pathRound:     number;

  // Tracing
  isTracing:          boolean;
  tracePoints:        Pt[];
  activePointerId:    number | null;

  // Per-path tracking (reset on each new path)
  pathDeviationSum:    number;
  pathDeviationCount:  number;
  pathDeviationEvents: number;
  inDeviationEpisode:  boolean;
  pathStartTime:       number;

  // Global deviation (across all tracing time)
  totalDeviationSum:   number;
  totalDeviationCount: number;

  // Visual
  flashTimer:      number;  // frames remaining for flash effect
  flashType:       'reset' | 'complete' | 'none';
  pathAppearTimer: number;  // 1→0 fade-in on new path
  particles:       Particle[];
  frame:           number;
  accentColor:     string;
  showHint:        boolean; // first-game instruction overlay
  hintTimer:       number;  // frames to show hint
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── COMPONENT ───────────────────────────────────────────────────────────────────
export default function PathTraceGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const phaseRef     = useRef<Phase>('start');

  const stateRef = useRef<GameState>({
    running:            false,
    timeLeft:           DURATION,
    sig: {
      avgDeviation:     0,
      completionSpeeds: [],
      pathsCompleted:   0,
      deviationEvents:  0,
      liftEvents:       0,
      score:            0,
    },
    currentPath:         null,
    pathRound:           0,
    isTracing:           false,
    tracePoints:         [],
    activePointerId:     null,
    pathDeviationSum:    0,
    pathDeviationCount:  0,
    pathDeviationEvents: 0,
    inDeviationEpisode:  false,
    pathStartTime:       0,
    totalDeviationSum:   0,
    totalDeviationCount: 0,
    flashTimer:          0,
    flashType:           'none',
    pathAppearTimer:     1.0,
    particles:           [],
    frame:               0,
    accentColor:         ACCENT,
    showHint:            true,
    hintTimer:           240, // 4 seconds at 60fps
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [scorePopKey, setScorePopKey]   = useState(0);
  const [scorePopText, setScorePopText] = useState('');
  const [milestoneKey, setMilestoneKey] = useState(0);
  const [milestoneText, setMilestoneText] = useState('');
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('✏️');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  // Sync refs
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  // ─── SPAWN PATH ──────────────────────────────────────────────────────────────
  const spawnPath = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    s.pathRound++;
    s.currentPath        = generatePath(window.innerWidth, window.innerHeight, s.pathRound);
    s.isTracing          = false;
    s.tracePoints        = [];
    s.activePointerId    = null;
    s.pathDeviationSum   = 0;
    s.pathDeviationCount = 0;
    s.pathDeviationEvents= 0;
    s.inDeviationEpisode = false;
    s.pathStartTime      = 0;
    s.flashTimer         = 0;
    s.flashType          = 'none';
    s.pathAppearTimer    = 1.0;
  }, []);

  // ─── END GAME ────────────────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }

    // Final avgDeviation
    s.sig.avgDeviation =
      s.totalDeviationCount > 0 ? s.totalDeviationSum / s.totalDeviationCount : 0;

    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  // ─── GAME LOOP ───────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Full state reset
    s.running            = true;
    s.timeLeft           = DURATION;
    s.sig                = {
      avgDeviation: 0, completionSpeeds: [], pathsCompleted: 0,
      deviationEvents: 0, liftEvents: 0, score: 0,
    };
    s.currentPath        = null;
    s.pathRound          = 0;
    s.isTracing          = false;
    s.tracePoints        = [];
    s.activePointerId    = null;
    s.pathDeviationSum   = 0;
    s.pathDeviationCount = 0;
    s.pathDeviationEvents= 0;
    s.inDeviationEpisode = false;
    s.pathStartTime      = 0;
    s.totalDeviationSum  = 0;
    s.totalDeviationCount= 0;
    s.flashTimer         = 0;
    s.flashType          = 'none';
    s.particles          = [];
    s.frame              = 0;
    s.showHint           = true;
    s.hintTimer          = 240;

    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');

    // Music (calm = closest to spec's "chill" — zen, ambient, measured)
    stopMusicRef.current = startMusic('calm');

    // 1-second timer tick
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) {
        sfx.warning();
        haptic([50, 30, 50]);
        setMilestoneText('⏰ 10 seconds!');
        setMilestoneKey(k => k + 1);
      } else if (s.timeLeft > 0) {
        sfx.tick();
      }
      if (s.timeLeft <= 0) { sfx.success(); hapticVictory(); endGame(); }
    }, 1000);

    spawnPath();

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx.imageSmoothingEnabled = true;

      // ── Background — dark teal/cyan gradient for puzzle vibe ───────────────
      const ptBg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.65, Math.max(W, H) * 0.9);
      ptBg.addColorStop(0,   '#001818');
      ptBg.addColorStop(0.55, '#000e0e');
      ptBg.addColorStop(1,   '#000606');
      ctx.fillStyle = ptBg;
      ctx.fillRect(0, 0, W, H);

      // Vignette
      const ptVig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, H * 0.8);
      ptVig.addColorStop(0, 'rgba(0,0,0,0)');
      ptVig.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = ptVig;
      ctx.fillRect(0, 0, W, H);

      // Subtle dot-grid — batched into a single path for performance
      {
        const gs = 32;
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        ctx.beginPath();
        for (let gx = gs; gx < W; gx += gs) {
          for (let gy = gs; gy < H; gy += gs) {
            ctx.moveTo(gx + 1, gy);
            ctx.arc(gx, gy, 1, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      }

      // ── Path Appear Animation ───────────────────────────────────────────────
      if (s.pathAppearTimer > 0) {
        s.pathAppearTimer = Math.max(0, s.pathAppearTimer - 0.055);
      }

      // ── Flash Timer ─────────────────────────────────────────────────────────
      if (s.flashTimer > 0) s.flashTimer--;

      // ── Hint overlay (first 4 seconds) ─────────────────────────────────────
      if (s.showHint && s.hintTimer > 0) {
        s.hintTimer--;
        const hintAlpha = Math.min(1, s.hintTimer / 60) * 0.85;
        ctx.save();
        ctx.globalAlpha = hintAlpha;
        ctx.fillStyle   = s.accentColor + '1F';
        ctx.beginPath();
        ctx.roundRect(W / 2 - 140, H - 100, 280, 44, 12);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font      = '600 18px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Press green dot · drag to end', W / 2, H - 78);
        ctx.restore();
        if (s.hintTimer === 0) s.showHint = false;
      }

      // ── Draw Path ───────────────────────────────────────────────────────────
      if (s.currentPath) {
        const path       = s.currentPath;
        const appearAlpha = 1 - s.pathAppearTimer;

        // Determine path color from flash state
        let pathRGBA: string;
        let pathGlow: string;
        let pathCoreAlpha: number;

        if (s.flashType === 'reset' && s.flashTimer > 0) {
          const t = s.flashTimer / 18;
          pathRGBA      = `rgba(239,68,68,${t * 0.85})`;
          pathGlow      = 'rgba(239,68,68,0.6)';
          pathCoreAlpha = 0.3 + t * 0.6;
        } else if (s.flashType === 'complete' && s.flashTimer > 0) {
          const t = s.flashTimer / 24;
          pathRGBA      = `rgba(255,255,255,${t * 0.95})`;
          pathGlow      = 'rgba(255,255,255,0.8)';
          pathCoreAlpha = t;
        } else {
          pathRGBA      = s.accentColor + '99'; // ~60% opacity
          pathGlow      = s.accentColor;
          pathCoreAlpha = 0.6 + (s.isTracing ? 0.1 : 0);
        }

        // Outer glow pass
        ctx.save();
        ctx.globalAlpha  = 0.35 * appearAlpha;
        ctx.strokeStyle  = pathGlow;
        ctx.lineWidth    = 22;
        ctx.lineCap      = 'round';
        ctx.shadowBlur   = 28;
        ctx.shadowColor  = pathGlow;
        ctx.beginPath();
        ctx.moveTo(path.startX, path.startY);
        ctx.bezierCurveTo(path.cp1X, path.cp1Y, path.cp2X, path.cp2Y, path.endX, path.endY);
        ctx.stroke();
        ctx.restore();

        // Core path line
        ctx.save();
        ctx.globalAlpha  = pathCoreAlpha * appearAlpha;
        ctx.strokeStyle  = pathRGBA;
        ctx.lineWidth    = 6;
        ctx.lineCap      = 'round';
        ctx.shadowBlur   = 10;
        ctx.shadowColor  = pathGlow;
        ctx.beginPath();
        ctx.moveTo(path.startX, path.startY);
        ctx.bezierCurveTo(path.cp1X, path.cp1Y, path.cp2X, path.cp2Y, path.endX, path.endY);
        ctx.stroke();
        ctx.restore();

        // ── Start Dot (green, pulsing when idle) ───────────────────────────
        const pulseR = s.isTracing ? 0 : Math.sin(s.frame * 0.09) * 5;
        const sdR    = 20 + pulseR;
        ctx.save();
        ctx.globalAlpha = appearAlpha;
        // Outer pulse glow
        ctx.shadowBlur  = 20;
        ctx.shadowColor = '#4ade80';
        ctx.fillStyle   = 'rgba(74,222,128,0.18)';
        ctx.beginPath();
        ctx.arc(path.startX, path.startY, sdR + 12, 0, Math.PI * 2);
        ctx.fill();
        // Core fill
        ctx.fillStyle = '#4ade80';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(path.startX, path.startY, sdR, 0, Math.PI * 2);
        ctx.fill();
        // Inner ring to distinguish from trace
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 2;
        ctx.shadowBlur  = 0;
        ctx.beginPath();
        ctx.arc(path.startX, path.startY, sdR - 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // ── End Dot (white, steady) ────────────────────────────────────────
        ctx.save();
        ctx.globalAlpha = appearAlpha;
        ctx.shadowBlur  = 16;
        ctx.shadowColor = '#ffffff';
        // Outer ring
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.arc(path.endX, path.endY, 30, 0, Math.PI * 2);
        ctx.stroke();
        // Mid ring
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.arc(path.endX, path.endY, 22, 0, Math.PI * 2);
        ctx.stroke();
        // Core fill
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(path.endX, path.endY, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Draw Trace ──────────────────────────────────────────────────────────
      if (s.isTracing && s.tracePoints.length > 1) {
        ctx.save();
        ctx.strokeStyle = s.accentColor;
        ctx.lineWidth   = 5;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.shadowBlur  = 14;
        ctx.shadowColor = s.accentColor;
        ctx.beginPath();
        ctx.moveTo(s.tracePoints[0].x, s.tracePoints[0].y);
        for (let i = 1; i < s.tracePoints.length; i++) {
          ctx.lineTo(s.tracePoints[i].x, s.tracePoints[i].y);
        }
        ctx.stroke();

        // Glowing tip at finger position
        const last = s.tracePoints[s.tracePoints.length - 1];
        ctx.fillStyle  = '#ffffff';
        ctx.shadowBlur = 22;
        ctx.shadowColor= s.accentColor;
        ctx.beginPath();
        ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Particles ───────────────────────────────────────────────────────────
      updateAndDrawParticles(ctx, s.particles);

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnPath]);

  // ─── CANVAS SETUP (once on mount) ────────────────────────────────────────────
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

    // ── Pointer: start tracing ──────────────────────────────────────────────
    const onPointerDown = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      const s = stateRef.current;
      if (!s.running || s.isTracing || !s.currentPath) return;

      const { x, y } = getCanvasCoords(e.clientX, e.clientY, canvas);
      const distToStart = Math.hypot(x - s.currentPath.startX, y - s.currentPath.startY);

      if (distToStart <= 44) {
        try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        s.isTracing          = true;
        s.activePointerId    = e.pointerId;
        s.tracePoints        = [{ x, y }];
        s.pathDeviationSum   = 0;
        s.pathDeviationCount = 0;
        s.pathDeviationEvents= 0;
        s.inDeviationEpisode = false;
        s.pathStartTime      = Date.now();
        s.showHint           = false;
        s.hintTimer          = 0;
        hapticScore();
      }
    };

    // ── Pointer: update trace ───────────────────────────────────────────────
    const onPointerMove = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      const s = stateRef.current;
      if (!s.running || !s.isTracing || !s.currentPath) return;
      if (s.activePointerId !== null && e.pointerId !== s.activePointerId) return;

      const { x, y } = getCanvasCoords(e.clientX, e.clientY, canvas);
      s.tracePoints.push({ x, y });
      // Prune old points to prevent memory growth on long traces
      if (s.tracePoints.length > 600) s.tracePoints.splice(0, 100);

      // Deviation from ideal path
      const dev = closestDistToPath(x, y, s.currentPath.points);

      // Accumulate for path and global averages
      s.pathDeviationSum   += dev;
      s.pathDeviationCount++;
      s.totalDeviationSum  += dev;
      s.totalDeviationCount++;

      // Track deviation events (crossing 20px threshold)
      if (dev > 20 && !s.inDeviationEpisode) {
        s.inDeviationEpisode = true;
        s.pathDeviationEvents++;
        s.sig.deviationEvents++;
      } else if (dev <= 20 && s.inDeviationEpisode) {
        s.inDeviationEpisode = false;
      }

      // Deviation > 52px: reset (treated as lift per spec — raised from 40px for accessibility)
      if (dev > 52) {
        // Inline reset to avoid stale closure issues
        s.isTracing          = false;
        s.tracePoints        = [];
        s.activePointerId    = null;
        s.pathDeviationSum   = 0;
        s.pathDeviationCount = 0;
        s.pathDeviationEvents= 0;
        s.inDeviationEpisode = false;
        s.pathStartTime      = 0;
        s.sig.liftEvents++;
        s.sig.score = Math.max(0, s.sig.score - 5);
        setScoreDisplay(s.sig.score);
        s.flashTimer = 18;
        s.flashType  = 'reset';
        sfx.collision();
        hapticFail();
        return;
      }

      // Check if reached end dot
      const distToEnd = Math.hypot(x - s.currentPath.endX, y - s.currentPath.endY)
      if (distToEnd <= 32) {
        // Inline completePath to avoid stale closure issues
        const elapsedMs  = s.pathStartTime > 0 ? Date.now() - s.pathStartTime : 5000;
        const pathAvgDev = s.pathDeviationCount > 0 ? s.pathDeviationSum / s.pathDeviationCount : 0;

        let pathScore = 50;
        pathScore -= s.pathDeviationEvents * 2;
        if (pathAvgDev < 10)      pathScore += 30;
        else if (pathAvgDev < 20) pathScore += 15;
        if (elapsedMs < 3000)     pathScore += 10;
        pathScore = Math.max(0, pathScore);

        s.sig.score += pathScore;
        s.sig.pathsCompleted++;
        s.sig.completionSpeeds.push(elapsedMs);
        s.sig.avgDeviation =
          s.totalDeviationCount > 0 ? s.totalDeviationSum / s.totalDeviationCount : 0;

        setScoreDisplay(s.sig.score);
        setScorePopText(`+${pathScore}`);
        setScorePopKey(k => k + 1);

        // Milestone: every 3 paths completed
        if (s.sig.pathsCompleted % 3 === 0) {
          setMilestoneText(`🎯 ${s.sig.pathsCompleted} paths!`);
          setMilestoneKey(k => k + 1);
          hapticCelebration();
          sfx.success(); // escalating milestone audio
        }

        spawnBurst(s.particles, s.currentPath.endX, s.currentPath.endY, s.accentColor, 18, 6);

        s.flashTimer      = 24;
        s.flashType       = 'complete';
        s.isTracing       = false;
        s.tracePoints     = [];
        s.activePointerId = null;

        sfx.collect();
        hapticScore();

        // Spawn next path after celebration (spawnPath has [] deps — stable ref)
        setTimeout(() => {
          if (stateRef.current.running) spawnPath();
        }, 400);
      }
    };

    // ── Pointer: lift ───────────────────────────────────────────────────────
    const onPointerUp = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      const s = stateRef.current;
      if (!s.running) return;
      if (s.activePointerId !== null && e.pointerId !== s.activePointerId) return;

      if (s.isTracing) {
        // Lift event: reset trace
        s.isTracing          = false;
        s.tracePoints        = [];
        s.activePointerId    = null;
        s.pathDeviationSum   = 0;
        s.pathDeviationCount = 0;
        s.pathDeviationEvents= 0;
        s.inDeviationEpisode = false;
        s.pathStartTime      = 0;
        s.sig.liftEvents++;
        s.sig.score = Math.max(0, s.sig.score - 5);
        setScoreDisplay(s.sig.score);
        s.flashTimer = 18;
        s.flashType  = 'reset';
        sfx.collision();
        hapticFail();
      }
    };

    // ── Pointer: cancel (system gesture interrupting capture) ──────────────
    const onPointerCancel = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      const s = stateRef.current;
      if (!s.running) return;
      if (s.activePointerId !== null && e.pointerId !== s.activePointerId) return;
      if (s.isTracing) {
        s.isTracing          = false;
        s.tracePoints        = [];
        s.activePointerId    = null;
        s.pathDeviationSum   = 0;
        s.pathDeviationCount = 0;
        s.pathDeviationEvents= 0;
        s.inDeviationEpisode = false;
        s.pathStartTime      = 0;
        s.sig.liftEvents++;
        s.sig.score = Math.max(0, s.sig.score - 5);
        setScoreDisplay(s.sig.score);
        s.flashTimer = 18;
        s.flashType  = 'reset';
        sfx.collision();
        hapticFail();
      }
    };

    canvas.addEventListener('pointerdown',   onPointerDown);
    canvas.addEventListener('pointermove',   onPointerMove);
    canvas.addEventListener('pointerup',     onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown',   onPointerDown);
      canvas.removeEventListener('pointermove',   onPointerMove);
      canvas.removeEventListener('pointerup',     onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []); // intentionally empty — all reads from refs

  // ─── CLEANUP ON UNMOUNT ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // ─── PHASE HANDLERS ──────────────────────────────────────────────────────────
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

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────────
  const buildInsights = useCallback((sig: Signals) => {
    const avgDev = Math.round(sig.avgDeviation);
    const speeds = sig.completionSpeeds;
    const avgSpeedMs = speeds.length > 0
      ? speeds.reduce((a, b) => a + b, 0) / speeds.length
      : 0;
    const avgSpeedSec = avgSpeedMs > 0 ? (avgSpeedMs / 1000).toFixed(1) : '—';

    return [
      {
        label: 'Avg Precision',
        value: avgDev > 0 ? `${avgDev}px` : '—',
        color: avgDev < 12 ? '#4ade80' : avgDev <= 25 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Paths Done',
        value: String(sig.pathsCompleted),
        color: theme.colors.accent ?? ACCENT,
      },
      {
        label: 'Avg Speed',
        value: `${avgSpeedSec}s`,
        color: avgSpeedMs > 0 && avgSpeedMs < 3000 ? '#4ade80'
             : avgSpeedMs <= 5000                  ? '#facc15'
             : '#ef4444',
      },
      {
        label: 'Deviations',
        value: String(sig.deviationEvents),
        color: sig.deviationEvents <= 3 ? '#4ade80'
             : sig.deviationEvents <= 8 ? '#facc15'
             : '#ef4444',
      },
    ];
  }, [theme]);

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="path-trace"
          steps={[{ icon: "🟢", title: "Find the green dot", body: "Press and hold the green start dot to begin tracing." }, { icon: "✏️", title: "Drag along the path", body: "Keep your finger on the glowing line all the way to the end." }, { icon: "⚡", title: "Don't stray!", body: "Lift your finger or leave the path and you lose the round." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT} background="radial-gradient(ellipse 80% 70% at 50% 30%, #001818 0%, #000e0e 55%, #000606 100%)">

      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          iconNode={<PenLine size={80} color={theme.colors.accent ?? ACCENT} strokeWidth={1.5} />}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Start"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #001818 0%, #000e0e 55%, #000606 100%)"
        />
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Score pop + milestone CSS ─────────────────────────────────────── */}
      <style>{`
        @keyframes pt-scorepop {
          0%   { transform: translateX(-50%) scale(0.8); opacity: 1; }
          100% { transform: translateX(-50%) translateY(-60px) scale(1.4); opacity: 0; }
        }
        @keyframes pt-milestone {
          0%   { transform: translateX(-50%) scale(0.7); opacity: 0; }
          20%  { transform: translateX(-50%) scale(1.1); opacity: 1; }
          75%  { transform: translateX(-50%) scale(1.0); opacity: 1; }
          100% { transform: translateX(-50%) scale(0.9); opacity: 0; }
        }
      `}</style>

      {/* ── Playing (canvas + HUD) ────────────────────────────────────────── */}
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
            <>
              <GameHUD
                accentColor={theme.colors.accent ?? ACCENT}
                items={[
                  { label: 'TIME',  value: timeLeft,     danger: timeLeft <= 10, testId: 'timer' },
                  { label: 'SCORE', value: scoreDisplay, testId: 'score' },
                ]}
              />
              {/* Score pop overlay */}
              {scorePopKey > 0 && (
                <div key={scorePopKey} style={{
                  position: 'absolute', top: '45%', left: '50%',
                  color: theme.colors.accent ?? ACCENT, fontSize: 28, fontWeight: 900,
                  pointerEvents: 'none', zIndex: 50,
                  animation: 'pt-scorepop 0.55s ease-out forwards',
                  textShadow: `0 0 20px ${theme.colors.accent ?? ACCENT}`,
                }}>
                  {scorePopText}
                </div>
              )}
              {/* Milestone overlay */}
              {milestoneKey > 0 && (
                <div key={milestoneKey} style={{
                  position: 'absolute', top: '32%', left: '50%',
                  color: '#facc15', fontSize: 20, fontWeight: 900,
                  letterSpacing: '0.04em', pointerEvents: 'none', zIndex: 50,
                  animation: 'pt-milestone 1.2s ease-out forwards',
                  textShadow: '0 0 18px rgba(250,204,21,0.8)',
                  whiteSpace: 'nowrap',
                }}>
                  {milestoneText}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── End Screen ───────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(finalSig.score)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.pathsCompleted >= 3}
          finalScore={finalSig.score}
          gameDurationMs={DURATION * 1000}
        />
      )}

      {/* ── Webhook ──────────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <WebhookEmitter
          theme={theme}
          gameId={GAME_ID}
          sig={finalSig}
          personality={getPersonality(finalSig)}
          player={playerSessionRef.current}
        />
      )}
    </GameShell>
    </>
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

    const avgSpeed =
      sig.completionSpeeds.length > 0
        ? Math.round(sig.completionSpeeds.reduce((a, b) => a + b, 0) / sig.completionSpeeds.length)
        : null;

    postWebhook(theme, gameId, {
      personality,
      score:            sig.score,
      avgDeviation:     parseFloat(sig.avgDeviation.toFixed(2)),
      completionSpeeds: sig.completionSpeeds,
      avgCompletionSpeedMs: avgSpeed,
      pathsCompleted:   sig.pathsCompleted,
      deviationEvents:  sig.deviationEvents,
      liftEvents:       sig.liftEvents,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
