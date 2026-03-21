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
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.cognitive.primaryAccent;

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const GAME_ID        = 'countdown-crush';
const PB_KEY       = 'pb_countdown-crush';
const ACCENT         = '#fbbf24';
const GAME_EMOJI     = '🥂';
const GAME_TITLE     = 'Countdown Crush';
const GAME_TAGLINE   = 'Score before midnight. Every second counts.';
const BG             = '#070510';
const SLAM_MS        = 800;
const MIDNIGHT_MS    = 3500;
const PTS_PER_BUBBLE = 10;

interface CWindow {
  count: number;
  window_ms: number;
  multiplier: number;
  target_count: number;
}

const WINDOWS: CWindow[] = [
  { count: 10, window_ms: 2500, multiplier: 1,   target_count: 6  },
  { count: 9,  window_ms: 2400, multiplier: 1,   target_count: 7  },
  { count: 8,  window_ms: 2300, multiplier: 1,   target_count: 7  },
  { count: 7,  window_ms: 2100, multiplier: 1.5, target_count: 8  },
  { count: 6,  window_ms: 2000, multiplier: 1.5, target_count: 8  },
  { count: 5,  window_ms: 1800, multiplier: 2,   target_count: 9  },
  { count: 4,  window_ms: 1600, multiplier: 2,   target_count: 9  },
  { count: 3,  window_ms: 1400, multiplier: 3,   target_count: 10 },
  { count: 2,  window_ms: 1200, multiplier: 3,   target_count: 10 },
  { count: 1,  window_ms: 1000, multiplier: 3,   target_count: 12 },
];

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Bubble {
  id: number;
  x: number;
  y: number;
  vy: number;
  radius: number;
  alpha: number;
  shimmer: number;
  popped: boolean;
  popTime: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
  decay: number;
}

interface ScoreFloat {
  id: number;
  x: number;
  y: number;
  vy: number;
  alpha: number;
  text: string;
}

interface Ripple {
  radius: number;
  maxRadius: number;
  alpha: number;
  cx: number;
  cy: number;
}

interface Signals {
  score: number;
  bubblesPopped: number;
  bestWindow: number;
  lateWindowScore: number;
  maxConsecutive: number;
  consecutiveCurrent: number;
  windowScores: number[];
  windowMaxScores: number[];
  avgWindowPct: number;
}

type SubPhase = 'slamming' | 'scoring' | 'midnight';

interface GameState {
  running: boolean;
  sig: Signals;
  subPhase: SubPhase;
  countIndex: number;
  phaseStart: number;
  slamScale: number;
  ripples: Ripple[];
  ballY: number;
  bubbles: Bubble[];
  nextBubbleId: number;
  lastBubbleSpawn: number;
  bubblesSpawnedThisWindow: number;
  particles: Particle[];
  nextParticleId: number;
  scoreFloats: ScoreFloat[];
  nextFloatId: number;
  midnightFlash: number;
  midnightStarted: boolean;
  currentWindowScore: number;
  accentColor: string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function slamEase(t: number): number {
  // Slam: 1.5 → 0.9 → 1.05 → 1.0 (bounce)
  if (t < 0.55) return 1.5 - 0.6 * (t / 0.55);
  if (t < 0.75) return 0.9 + 0.15 * ((t - 0.55) / 0.2);
  return 1.05 - 0.05 * ((t - 0.75) / 0.25);
}

function getPersonality(sig: Signals): string {
  if (sig.score >= 80 && sig.lateWindowScore >= 30) return 'Midnight Champion 🏆';
  if (sig.bubblesPopped >= 60)                      return 'Champagne Crusher 🥂';
  if (sig.lateWindowScore >= 25)                    return 'Late Night Hero 🌙';
  if (sig.score >= 50)                              return 'Party Animal 🎉';
  return 'New Year, New Me 🎆';
}

function makeSignals(): Signals {
  return {
    score: 0, bubblesPopped: 0, bestWindow: 0, lateWindowScore: 0,
    maxConsecutive: 0, consecutiveCurrent: 0,
    windowScores: [], windowMaxScores: [], avgWindowPct: 0,
  };
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function CountdownCrushGame() {
  const theme         = useBrandTheme();
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const countNumRef   = useRef<HTMLDivElement>(null);
  const animRef       = useRef(0);
  const stopMusicRef  = useRef<(() => void) | null>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    sig: makeSignals(),
    subPhase: 'slamming',
    countIndex: 0,
    phaseStart: 0,
    slamScale: 1.5,
    ripples: [],
    ballY: 0,
    bubbles: [],
    nextBubbleId: 0,
    lastBubbleSpawn: 0,
    bubblesSpawnedThisWindow: 0,
    particles: [],
    nextParticleId: 0,
    scoreFloats: [],
    nextFloatId: 0,
    midnightFlash: 0,
    midnightStarted: false,
    currentWindowScore: 0,
    accentColor: ACCENT,
  });

  // React state — only for re-renders
  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [currentCount, setCurrentCount] = useState(10);
  const [subPhaseUI, setSubPhaseUI]     = useState<SubPhase>('slamming');
  const [multiplierUI, setMultiplierUI] = useState(1);
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

  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── MIDNIGHT CONFETTI ───────────────────────────────────────────────────

  const fireMidnightConfetti = useCallback(() => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    document.body.appendChild(canvas);
    confettiCanvasRef.current = canvas;

    const myConfetti = confetti.create(canvas, { resize: true, useWorker: false });
    const goldColors = ['#fbbf24', '#f59e0b', '#fde68a', '#ffffff', '#d97706', '#facc15'];

    myConfetti({
      particleCount: 160,
      spread: 100,
      startVelocity: 45,
      origin: { y: 0.5 },
      colors: goldColors,
      gravity: 0.7,
    });

    const t1 = window.setTimeout(() => {
      myConfetti({ particleCount: 80, angle: 60,  spread: 70, origin: { x: 0,   y: 0.5 }, colors: goldColors });
      myConfetti({ particleCount: 80, angle: 120, spread: 70, origin: { x: 1,   y: 0.5 }, colors: goldColors });
    }, 400);

    const t2 = window.setTimeout(() => {
      if (confettiCanvasRef.current) {
        confettiCanvasRef.current.remove();
        confettiCanvasRef.current = null;
      }
    }, 5000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // ─── END GAME ────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (confettiCanvasRef.current) { confettiCanvasRef.current.remove(); confettiCanvasRef.current = null; }

    // Compute avgWindowPct
    const total = s.sig.windowScores.length;
    if (total > 0) {
      const sum = s.sig.windowScores.reduce((acc, ws, i) => {
        const maxPts = s.sig.windowMaxScores[i] ?? 1;
        return acc + (maxPts > 0 ? ws / maxPts : 0);
      }, 0);
      s.sig.avgWindowPct = Math.round((sum / total) * 100);
    }
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

  // ─── TAP HANDLER ─────────────────────────────────────────────────────────

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;
    if (s.subPhase !== 'scoring' && s.subPhase !== 'midnight') return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.offsetWidth  / rect.width);
    const y = (clientY - rect.top)  * (canvas.offsetHeight / rect.height);

    const win = WINDOWS[Math.min(s.countIndex, WINDOWS.length - 1)];
    const mult = s.subPhase === 'midnight' ? 5 : win.multiplier;

    for (const b of s.bubbles) {
      if (b.popped) continue;
      const dx = x - b.x;
      const dy = y - b.y;
      if (Math.sqrt(dx * dx + dy * dy) <= b.radius + 10) {
        b.popped  = true;
        b.popTime = Date.now();

        const pts = Math.round(PTS_PER_BUBBLE * mult);
        s.sig.score          += pts;
        s.sig.bubblesPopped  += 1;
        s.currentWindowScore += pts;
        s.sig.consecutiveCurrent++;
        if (s.sig.consecutiveCurrent > s.sig.maxConsecutive) {
          s.sig.maxConsecutive = s.sig.consecutiveCurrent;
        }
        // Late window score (counts 3, 2, 1 → indices 7, 8, 9)
        if (s.countIndex >= 7) s.sig.lateWindowScore += pts;

        // Particle burst
        for (let i = 0; i < 10; i++) {
          const angle = (i / 10) * Math.PI * 2;
          const speed = 1.5 + Math.random() * 3;
          s.particles.push({
            id: s.nextParticleId++,
            x: b.x, y: b.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.5,
            radius: 2 + Math.random() * 3,
            alpha: 1,
            color: Math.random() > 0.5 ? (s.accentColor || ACCENT) : '#ffffff',
            decay: 0.03 + Math.random() * 0.02,
          });
        }

        // Score float
        s.scoreFloats.push({
          id: s.nextFloatId++,
          x: b.x,
          y: b.y - b.radius,
          vy: -1.6,
          alpha: 1,
          text: `+${pts}`,
        });

        setScoreDisplay(s.sig.score);
        sfx.collect();
        haptic([20]);
        break;
      }
    }
  }, []);

  // ─── GAME LOOP ────────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    const now = Date.now();

    // Full reset
    s.running                  = true;
    s.sig                      = makeSignals();
    s.subPhase                 = 'slamming';
    s.countIndex               = 0;
    s.phaseStart               = now;
    s.slamScale                = 1.5;
    s.ripples                  = [{ radius: 5, maxRadius: Math.max(canvas.offsetWidth, canvas.offsetHeight), alpha: 0.5, cx: canvas.offsetWidth / 2, cy: canvas.offsetHeight / 2 }];
    s.ballY                    = 0;
    s.bubbles                  = [];
    s.nextBubbleId             = 0;
    s.lastBubbleSpawn          = 0;
    s.bubblesSpawnedThisWindow = 0;
    s.particles                = [];
    s.nextParticleId           = 0;
    s.scoreFloats              = [];
    s.nextFloatId              = 0;
    s.midnightFlash            = 0;
    s.midnightStarted          = false;
    s.currentWindowScore       = 0;

    setScoreDisplay(0);
    setCurrentCount(WINDOWS[0].count);
    setSubPhaseUI('slamming');
    setMultiplierUI(WINDOWS[0].multiplier);
    setPhase('playing');

    stopMusicRef.current = startMusic('tense');
    sfx.slam();       // spec: countdownDrop = slam
    haptic([150]);

    ctx.imageSmoothingEnabled = true;

    const loop = () => {
      if (!s.running) return;

      const W       = canvas.offsetWidth;
      const H       = canvas.offsetHeight;
      const nowT    = Date.now();
      const elapsed = nowT - s.phaseStart;
      const win     = WINDOWS[s.countIndex] ?? WINDOWS[WINDOWS.length - 1];

      // ── Phase Machine ──────────────────────────────────────────────────────

      if (s.subPhase === 'slamming' && elapsed >= SLAM_MS) {
        // → scoring
        s.subPhase               = 'scoring';
        s.phaseStart             = nowT;
        s.currentWindowScore     = 0;
        s.bubblesSpawnedThisWindow = 0;
        s.lastBubbleSpawn        = nowT;
        s.sig.consecutiveCurrent = 0;
        setSubPhaseUI('scoring');

      } else if (s.subPhase === 'scoring' && elapsed >= win.window_ms) {
        // Record window stats
        s.sig.windowScores.push(s.currentWindowScore);
        s.sig.windowMaxScores.push(win.target_count * PTS_PER_BUBBLE * win.multiplier);
        if (s.currentWindowScore > s.sig.bestWindow) s.sig.bestWindow = s.currentWindowScore;

        const nextIdx = s.countIndex + 1;
        if (nextIdx >= WINDOWS.length) {
          // → midnight
          s.subPhase          = 'midnight';
          s.phaseStart        = nowT;
          s.midnightFlash     = 1;
          s.midnightStarted   = false;
          s.ballY             = 1.0;
          setSubPhaseUI('midnight');
          setCurrentCount(0);
          // spec: midnight = boom + defuse (fireworks explosion + celebration)
          sfx.boom();
          haptic([200, 100, 200, 100, 300]);
          setTimeout(() => sfx.defuse(), 300);
        } else {
          // → next slam
          // Check for multiplier increase before updating countIndex
          const prevMult = WINDOWS[s.countIndex].multiplier;
          const nextMult = WINDOWS[nextIdx].multiplier;

          s.subPhase                 = 'slamming';
          s.countIndex               = nextIdx;
          s.phaseStart               = nowT;
          s.slamScale                = 1.5;
          s.bubbles                  = [];
          s.ballY                    = nextIdx / WINDOWS.length;
          s.bubblesSpawnedThisWindow = 0;
          s.ripples.push({
            radius: 5,
            maxRadius: Math.max(W, H) * 0.9,
            alpha: 0.5,
            cx: W / 2,
            cy: H / 2,
          });
          setCurrentCount(WINDOWS[nextIdx].count);
          setSubPhaseUI('slamming');
          setMultiplierUI(WINDOWS[nextIdx].multiplier);
          // spec: countdownDrop = slam; multiplierUp = success (delayed to avoid stacking)
          sfx.slam();
          haptic([120]);
          if (nextMult > prevMult) {
            setTimeout(() => sfx.success(), 100);
          }
        }

      } else if (s.subPhase === 'midnight') {
        if (!s.midnightStarted) {
          s.midnightStarted = true;
          fireMidnightConfetti();
        }
        s.midnightFlash = Math.max(0, 1 - elapsed / 600);
        if (elapsed >= MIDNIGHT_MS) {
          endGame();
          return;
        }
      }

      // ── Slam scale animation ───────────────────────────────────────────────

      if (s.subPhase === 'slamming') {
        const t = Math.min(1, elapsed / SLAM_MS);
        s.slamScale = slamEase(t);
        if (countNumRef.current) {
          countNumRef.current.style.transform = `scale(${s.slamScale.toFixed(3)})`;
        }
      } else {
        if (countNumRef.current) {
          countNumRef.current.style.transform = 'scale(1)';
        }
      }

      // ── Spawn bubbles ──────────────────────────────────────────────────────

      if (s.subPhase === 'scoring') {
        const spawnInterval = win.window_ms / win.target_count;
        if (
          s.bubblesSpawnedThisWindow < win.target_count &&
          nowT - s.lastBubbleSpawn >= spawnInterval
        ) {
          const margin = 40;
          const radius = 18 + Math.random() * 18;
          s.bubbles.push({
            id: s.nextBubbleId++,
            x: margin + Math.random() * (W - margin * 2),
            y: H + radius + 10,
            vy: -(1.5 + Math.random() * 1.5),
            radius,
            alpha: 0.8 + Math.random() * 0.2,
            shimmer: Math.random() * Math.PI * 2,
            popped: false,
            popTime: 0,
          });
          s.bubblesSpawnedThisWindow++;
          s.lastBubbleSpawn = nowT;
        }
      }

      // ── Update game objects ────────────────────────────────────────────────

      s.bubbles = s.bubbles.filter(b => {
        if (b.popped) return (nowT - b.popTime) < 350;
        b.y      += b.vy;
        b.shimmer += 0.04;
        return b.y + b.radius > -10;
      });

      s.particles = s.particles.filter(p => {
        p.x     += p.vx;
        p.y     += p.vy;
        p.vy    += 0.12;
        p.alpha -= p.decay;
        return p.alpha > 0;
      });

      s.scoreFloats = s.scoreFloats.filter(f => {
        f.y     += f.vy;
        f.alpha -= 0.022;
        return f.alpha > 0;
      });

      s.ripples = s.ripples.filter(r => {
        r.radius += 10;
        r.alpha  -= 0.015;
        return r.alpha > 0;
      });

      // ── DRAW — deep champagne/celebration gradient ─────────────────────────
      const ccCrBg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.65, Math.max(W, H) * 0.9);
      ccCrBg.addColorStop(0,   '#120f04');
      ccCrBg.addColorStop(0.55, '#0a0902');
      ccCrBg.addColorStop(1,   '#050401');
      ctx.fillStyle = ccCrBg;
      ctx.fillRect(0, 0, W, H);

      // Starfield
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      for (let i = 0; i < 60; i++) {
        const sx = (i * 173 + 47) % W;
        const sy = (i * 97  + 31) % H;
        const sr = i % 3 === 0 ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ball drop track
      const trackX   = W * 0.88;
      const trackTop = H * 0.06;
      const trackBot = H * 0.94;

      ctx.strokeStyle = 'rgba(251,191,36,0.12)';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.moveTo(trackX, trackTop);
      ctx.lineTo(trackX, trackBot);
      ctx.stroke();

      const ballPxY = trackTop + s.ballY * (trackBot - trackTop);
      ctx.shadowBlur  = 18;
      ctx.shadowColor = s.accentColor || ACCENT;
      ctx.fillStyle   = s.accentColor || ACCENT;
      ctx.beginPath();
      ctx.arc(trackX, ballPxY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = '#fffaed';
      ctx.beginPath();
      ctx.arc(trackX - 2.5, ballPxY - 2.5, 3, 0, Math.PI * 2);
      ctx.fill();

      // Scoring window progress bar
      if (s.subPhase === 'scoring') {
        const barW    = W * 0.68;
        const barX    = (W - barW) / 2;
        const barY    = H - 14;
        const progress = Math.max(0, 1 - elapsed / win.window_ms);
        const barColor = progress > 0.5 ? (s.accentColor || ACCENT) : progress > 0.25 ? '#f59e0b' : '#ef4444';

        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(barX, barY, barW, 4);

        ctx.fillStyle   = barColor;
        ctx.shadowBlur  = 6;
        ctx.shadowColor = barColor;
        ctx.fillRect(barX, barY, barW * progress, 4);
        ctx.shadowBlur = 0;
      }

      // Ripples
      for (const r of s.ripples) {
        ctx.strokeStyle = `rgba(251,191,36,${r.alpha.toFixed(3)})`;
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.arc(r.cx, r.cy, r.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Bubbles
      for (const b of s.bubbles) {
        if (b.popped) {
          const pp     = Math.min(1, (nowT - b.popTime) / 350);
          const pAlpha = (1 - pp) * 0.65;
          ctx.strokeStyle = `rgba(251,191,36,${pAlpha.toFixed(3)})`;
          ctx.lineWidth   = 2;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius * (1 + pp * 1.8), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const shimVal = 0.12 + 0.08 * Math.sin(b.shimmer);

          ctx.shadowBlur  = 14;
          ctx.shadowColor = 'rgba(251,191,36,0.3)';

          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(160,210,255,${shimVal.toFixed(3)})`;
          ctx.fill();

          ctx.strokeStyle = `rgba(251,191,36,${(b.alpha * 0.6).toFixed(3)})`;
          ctx.lineWidth   = 1.5;
          ctx.stroke();
          ctx.shadowBlur  = 0;

          // Highlight
          ctx.beginPath();
          ctx.arc(
            b.x - b.radius * 0.32,
            b.y - b.radius * 0.35,
            b.radius * 0.22,
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = `rgba(255,255,255,${(b.alpha * 0.55).toFixed(3)})`;
          ctx.fill();
        }
      }

      // Particles
      for (const p of s.particles) {
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle   = p.color;
        ctx.shadowBlur  = 4;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;

      // Score floats
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      for (const f of s.scoreFloats) {
        ctx.globalAlpha = Math.max(0, f.alpha);
        ctx.fillStyle   = s.accentColor || ACCENT;
        ctx.font        = 'bold 20px system-ui, sans-serif';
        ctx.shadowBlur  = 8;
        ctx.shadowColor = s.accentColor || ACCENT;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha  = 1;
      ctx.shadowBlur   = 0;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'alphabetic';

      // Midnight gold flash overlay
      if (s.subPhase === 'midnight' && s.midnightFlash > 0) {
        ctx.fillStyle = `rgba(251,191,36,${(s.midnightFlash * 0.5).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, fireMidnightConfetti]);

  // ─── CANVAS SETUP & RESIZE ────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      handleTap(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, handleTap]);

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (confettiCanvasRef.current) {
        confettiCanvasRef.current.remove();
        confettiCanvasRef.current = null;
      }
    };
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    await initAudio();
    sfx.click();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    setScoreDisplay(0);
    setCurrentCount(10);
    setSubPhaseUI('slamming');
    setMultiplierUI(1);
    setFinalSig(null);
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────

  const buildInsights = (sig: Signals) => {
    const avgPct = sig.avgWindowPct;
    const late   = sig.lateWindowScore;
    const best   = sig.bestWindow;
    const total  = sig.bubblesPopped;

    return [
      {
        label: 'Bubbles Popped',
        value: String(total),
        color: total >= 50 ? '#4ade80' : total >= 25 ? '#facc15' : 'var(--color-text)',
      },
      {
        label: 'Final Rush Score',
        value: String(late),
        color: late >= 30 ? '#4ade80' : late >= 15 ? '#facc15' : 'var(--color-text)',
      },
      {
        label: 'Best Window',
        value: String(best),
        color: ACCENT,
      },
      {
        label: 'Avg Hit Rate',
        value: `${avgPct}%`,
        color: avgPct >= 60 ? '#4ade80' : avgPct >= 30 ? '#facc15' : '#ef4444',
      },
    ];
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="countdown-crush"
          steps={[{ icon: "🔢", title: "Find the number", body: "Tap numbers in order from lowest to highest." }, { icon: "⏱️", title: "Race the clock", body: "You have limited time — move fast." }, { icon: "🔥", title: "Clear the board", body: "Clear all numbers before time runs out to win." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>

      {/* ── Start Screen ─────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Start Countdown"
          accentColor={accent}
          ctaTextColor="#000"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #12100a 0%, #0a0905 55%, #040403 100%)"
        />
      )}

      {/* ── Countdown ────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accent} />
      )}

      {/* ── Playing ──────────────────────────────────────────────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          {/* Canvas — bubbles, particles, ball drop */}
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
            <>
              {/* HUD */}
              <GameHUD
                accentColor={accent}
                items={[
                  { label: 'SCORE 🥂', value: scoreDisplay },
                  { label: 'MULT',     value: multiplierUI },
                ]}
              />

              {/* Multiplier badge — only during scoring phase */}
              {subPhaseUI === 'scoring' && multiplierUI > 1 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 64,
                    right: 16,
                    background: `${accent}22`,
                    border: `1.5px solid ${accent}`,
                    borderRadius: 8,
                    padding: '4px 10px',
                    color: accent,
                    fontWeight: 800,
                    fontSize: 14,
                    letterSpacing: '0.05em',
                    pointerEvents: 'none',
                  }}
                >
                  {multiplierUI}× MULT
                </div>
              )}

              {/* Big countdown number (DOM overlay — scale animated via ref) */}
              {subPhaseUI !== 'midnight' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    ref={countNumRef}
                    style={{
                      fontSize: 'clamp(120px, 40vw, 320px)',
                      fontWeight: 900,
                      color: accent,
                      lineHeight: 1,
                      letterSpacing: '-0.04em',
                      userSelect: 'none',
                      textShadow: `0 0 40px ${accent}88, 0 0 80px ${accent}44`,
                      transformOrigin: 'center',
                      transform: 'scale(1.5)',
                      opacity: subPhaseUI === 'slamming' ? 1 : 0.85,
                    }}
                  >
                    {currentCount}
                  </div>
                </div>
              )}

              {/* HAPPY NEW YEAR overlay — midnight only */}
              {subPhaseUI === 'midnight' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                    animation: 'fadeIn 0.3s ease-out',
                  }}
                >
                  <div
                    style={{
                      fontSize: 'clamp(28px, 8vw, 56px)',
                      fontWeight: 900,
                      color: accent,
                      letterSpacing: '-0.02em',
                      textAlign: 'center',
                      textShadow: `0 0 30px ${accent}`,
                      lineHeight: 1.2,
                    }}
                  >
                    HAPPY NEW YEAR!
                  </div>
                  <div style={{ fontSize: 56, marginTop: 12 }}>🎆</div>
                  <div
                    style={{
                      fontSize: 18,
                      color: 'rgba(255,255,255,0.7)',
                      marginTop: 10,
                      fontWeight: 600,
                    }}
                  >
                    Remaining bubbles = 5× 🫧
                  </div>
                </div>
              )}
            </>
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



      {/* ── End Screen ───────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen
            gameId={GAME_ID}
            title={getPersonality(finalSig)}
            emoji={GAME_EMOJI}
            score={String(finalSig.score)}
            personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)}
            accentColor={accent}
            onPlayAgain={handlePlayAgain}
            didWin={finalSig.bubblesPopped >= 20}
          />
          <WebhookEmitter
            theme={theme}
            gameId={GAME_ID}
            sig={finalSig}
            personality={getPersonality(finalSig)}
            player={playerSessionRef.current}
          />
        </>
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
    postWebhook(theme, gameId, {
      personality,
      score:           sig.score,
      bubblesPopped:   sig.bubblesPopped,
      bestWindow:      sig.bestWindow,
      lateWindowScore: sig.lateWindowScore,
      maxConsecutive:  sig.maxConsecutive,
      avgWindowPct:    sig.avgWindowPct,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
