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
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.holiday.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────
const GAME_ID       = 'turkey-trot';
const PB_KEY       = 'pb_turkey-trot';
const ACCENT        = '#f97316';
const DURATION      = 30;
const GAME_EMOJI    = '🦃';
const GAME_TITLE    = 'Turkey Trot';
const GAME_TAGLINE  = "The turkey's running. You're not fast enough. Prove it wrong.";

const SPEED_BASE        = 180;   // px/s
const SPEED_MAX         = 340;   // px/s
const SPEED_INC         = 12;    // px/s per hit
const DIR_CHANGE_BASE   = 600;   // ms
const DIR_CHANGE_JITTER = 200;   // ± ms
const DODGE_MEMORY_MS   = 2000;  // ms
const HIT_RADIUS        = 70;    // px
const TURKEY_SIZE       = 64;    // px
const DAZE_MS           = 300;   // ms
const GOLDEN_EVERY      = 5;     // every Nth hit
const GOLDEN_DURATION   = 1500;  // ms
const GOLDEN_POINTS     = 5;
const GOLDEN_SPEED_MULT = 1.4;

const FEATHER_COLORS = ['#f97316', '#ea580c', '#c2410c', '#92400e', '#fbbf24', '#d97706'];
const LEAF_EMOJIS    = ['🍂', '🍁', '🍃'] as const;

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface TurkeyState {
  x: number; y: number;
  vx: number; vy: number;
  speed: number;
  dazed: boolean;
  dazedUntil: number;
  lastTapQuadrant: number;       // 0-3 or -1
  lastTapQuadrantExpiry: number;
  lastDirChangeTime: number;
}

interface GoldenTurkey {
  active: boolean;
  x: number; y: number;
  vx: number; vy: number;
  expiresAt: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;      // 1 → 0
  color: string;
  size: number;
  isDust: boolean;
}

interface Leaf {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  alpha: number;
  rotation: number;
  rotationSpeed: number;
  emoji: string;
}

interface FloatingScore {
  x: number; y: number;
  text: string;
  life: number;  // 1 → 0
}

interface Signals {
  score: number;
  goldenTurkeyHits: number;
  maxStreak: number;
  streakCurrent: number;
  totalAttempts: number;
  hits: number;
  reactionTimes: number[];
  hitCount: number;
  longestChase: number;
  chaseStart: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  turkey: TurkeyState;
  golden: GoldenTurkey;
  particles: Particle[];
  leaves: Leaf[];
  floatingScores: FloatingScore[];
  sig: Signals;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getQuadrant(x: number, y: number, W: number, H: number): number {
  return (y >= H / 2 ? 2 : 0) + (x >= W / 2 ? 1 : 0);
}

function quadrantCenter(q: number, W: number, H: number): { cx: number; cy: number } {
  return {
    cx: (q % 2 === 0 ? 0.25 : 0.75) * W,
    cy: (q < 2 ? 0.25 : 0.75) * H,
  };
}

// Pick a direction vector that moves the turkey AWAY from the dodged quadrant
function pickEscapeDir(
  tx: number, ty: number,
  dodgeQ: number, W: number, H: number,
): { vx: number; vy: number } {
  const { cx, cy } = quadrantCenter(dodgeQ, W, H);
  let bestAngle = Math.random() * Math.PI * 2;
  let bestScore = -Infinity;
  for (let i = 0; i < 10; i++) {
    const a   = Math.random() * Math.PI * 2;
    const dx  = cx - tx;
    const dy  = cy - ty;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // score: how much this angle moves AWAY from dodgeCenter
    const score = -(Math.cos(a) * (dx / len) + Math.sin(a) * (dy / len));
    if (score > bestScore) { bestScore = score; bestAngle = a; }
  }
  return { vx: Math.cos(bestAngle), vy: Math.sin(bestAngle) };
}

// ─── PERSONALITY ─────────────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const acc   = sig.totalAttempts > 0 ? (sig.hits / sig.totalAttempts) * 100 : 0;
  const avgRx = sig.reactionTimes.length > 0
    ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length
    : 9999;
  if (sig.score >= 18 && acc >= 75)              return 'Turkey Whisperer 🦃';
  if (sig.goldenTurkeyHits >= 2)                 return 'The Hunter 🍂';
  if (avgRx < 350 && sig.score >= 12)            return 'Quick Hands ⚡';
  if (sig.totalAttempts >= 30 && sig.score >= 10) return 'Persistent Pilgrim 🎉';
  return 'Thankful Anyway 🙏';
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export default function TurkeyTrotGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const dirChangeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goldenTimRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  // ⚠️ All mutable game state lives here — never in useState
  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    turkey: {
      x: 0, y: 0, vx: 1, vy: 0,
      speed: SPEED_BASE,
      dazed: false, dazedUntil: 0,
      lastTapQuadrant: -1, lastTapQuadrantExpiry: 0,
      lastDirChangeTime: 0,
    },
    golden: { active: false, x: 0, y: 0, vx: 0, vy: 0, expiresAt: 0 },
    particles: [],
    leaves: [],
    floatingScores: [],
    sig: {
      score: 0, goldenTurkeyHits: 0, maxStreak: 0, streakCurrent: 0,
      totalAttempts: 0, hits: 0, reactionTimes: [], hitCount: 0,
      longestChase: 0, chaseStart: 0,
    },
  });

  // Only minimal state drives re-renders
  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  // ⚡ SPEED % — spec HUD item 3: (currentSpeed - BASE) / (MAX - BASE) * 100
  const [speedDisplay, setSpeedDisplay] = useState(0);
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

  // ─── MAKE LEAVES ──────────────────────────────────────────────────────────
  const makeLeaves = useCallback((W: number, H: number): Leaf[] =>
    Array.from({ length: 16 }, (_, i) => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: 0.25 + Math.random() * 0.5,
      size: 11 + Math.random() * 10,
      alpha: 0.12 + Math.random() * 0.28,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.025,
      emoji: LEAF_EMOJIS[i % LEAF_EMOJIS.length],
    })), []);

  // ─── DIRECTION CHANGE (recursive setTimeout) ──────────────────────────────
  const scheduleDir = useCallback(() => {
    const jitter = (Math.random() * 2 - 1) * DIR_CHANGE_JITTER;
    dirChangeRef.current = setTimeout(() => {
      const s = stateRef.current;
      if (!s.running) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { width: W, height: H } = canvas;
      const now = Date.now();
      const t   = s.turkey;
      let dir: { vx: number; vy: number };
      if (t.lastTapQuadrant >= 0 && now < t.lastTapQuadrantExpiry) {
        dir = pickEscapeDir(t.x, t.y, t.lastTapQuadrant, W, H);
      } else {
        const a = Math.random() * Math.PI * 2;
        dir = { vx: Math.cos(a), vy: Math.sin(a) };
      }
      t.vx = dir.vx;
      t.vy = dir.vy;
      t.lastDirChangeTime = now;
      scheduleDir();
    }, DIR_CHANGE_BASE + jitter);
  }, []);

  // ─── SPAWN GOLDEN TURKEY ──────────────────────────────────────────────────
  const spawnGolden = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width: W, height: H } = canvas;
    const margin = 80;
    const a = Math.random() * Math.PI * 2;
    const now = Date.now();
    s.golden = {
      active: true,
      x: margin + Math.random() * (W - margin * 2),
      y: margin + Math.random() * (H - margin * 2),
      vx: Math.cos(a),
      vy: Math.sin(a),
      expiresAt: now + GOLDEN_DURATION,
    };
    sfx.shimmer();
    goldenTimRef.current = setTimeout(() => {
      if (stateRef.current.running) stateRef.current.golden.active = false;
    }, GOLDEN_DURATION);
  }, []);

  // ─── END GAME ─────────────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current)     { clearInterval(timerRef.current);    timerRef.current = null; }
    if (dirChangeRef.current) { clearTimeout(dirChangeRef.current); dirChangeRef.current = null; }
    if (goldenTimRef.current) { clearTimeout(goldenTimRef.current); goldenTimRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current();             stopMusicRef.current = null; }
    // Finalize longest chase
    if (s.sig.chaseStart > 0) {
      const chase = (Date.now() - s.sig.chaseStart) / 1000;
      if (chase > s.sig.longestChase) s.sig.longestChase = chase;
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


    setFinalSig({ ...s.sig, reactionTimes: [...s.sig.reactionTimes] });
    setPhase('done');
  }, []);

  // ─── GAME LOOP ────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s    = stateRef.current;
    const now0 = Date.now();
    const W0   = canvas.width;
    const H0   = canvas.height;
    const a0   = Math.random() * Math.PI * 2;

    // Reset all state
    s.running = true;
    s.timeLeft = DURATION;
    s.turkey = {
      x: W0 / 2, y: H0 / 2,
      vx: Math.cos(a0), vy: Math.sin(a0),
      speed: SPEED_BASE,
      dazed: false, dazedUntil: 0,
      lastTapQuadrant: -1, lastTapQuadrantExpiry: 0,
      lastDirChangeTime: now0,
    };
    s.golden       = { active: false, x: 0, y: 0, vx: 0, vy: 0, expiresAt: 0 };
    s.particles    = [];
    s.floatingScores = [];
    s.leaves       = makeLeaves(W0, H0);
    s.sig = {
      score: 0, goldenTurkeyHits: 0, maxStreak: 0, streakCurrent: 0,
      totalAttempts: 0, hits: 0, reactionTimes: [], hitCount: 0,
      longestChase: 0, chaseStart: now0,
    };

    setScoreDisplay(0);
    setSpeedDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');

    stopMusicRef.current = startMusic('drive');

    // Kick off direction-change loop
    if (dirChangeRef.current) clearTimeout(dirChangeRef.current);
    scheduleDir();

    // 1-second countdown timer
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // ⚡ sfx.fail() was wrong — timer expiry is not a failure; was tonally incorrect
      if (s.timeLeft <= 0) { sfx.success(); haptic([30, 50, 30, 50, 100]); endGame(); }
    }, 1000);

    // ── rAF loop ────────────────────────────────────────────────────────────
    let lastFrameMs = performance.now();

    const loop = (nowMs: number) => {
      if (!s.running) return;
      const dt  = Math.min((nowMs - lastFrameMs) / 1000, 0.05);
      lastFrameMs = nowMs;
      const W   = canvas.width;
      const H   = canvas.height;
      const now = Date.now();

      ctx.imageSmoothingEnabled = true;

      // ── Background ──────────────────────────────────────────────────────
      ctx.fillStyle = '#0f0800';
      ctx.fillRect(0, 0, W, H);

      // Warm bottom-edge vignette
      const vig = ctx.createRadialGradient(W * 0.5, H * 0.85, H * 0.05, W * 0.5, H * 0.85, H * 0.75);
      vig.addColorStop(0, 'rgba(249,115,22,0)');
      vig.addColorStop(1, 'rgba(120,45,0,0.20)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      // ── Autumn Leaves ────────────────────────────────────────────────────
      for (const leaf of s.leaves) {
        leaf.x += leaf.vx;
        leaf.y += leaf.vy;
        leaf.rotation += leaf.rotationSpeed;
        if (leaf.y > H + 30)  { leaf.y = -20; leaf.x = Math.random() * W; }
        if (leaf.x < -30)     { leaf.x = W + 20; }
        if (leaf.x > W + 30)  { leaf.x = -20; }
        ctx.save();
        ctx.globalAlpha  = leaf.alpha;
        ctx.translate(leaf.x, leaf.y);
        ctx.rotate(leaf.rotation);
        ctx.font         = `${leaf.size}px serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(leaf.emoji, 0, 0);
        ctx.restore();
      }

      // ── Turkey shadow on floor ───────────────────────────────────────────
      const t = s.turkey;
      ctx.save();
      ctx.globalAlpha = 0.20;
      ctx.fillStyle   = '#000';
      ctx.beginPath();
      ctx.ellipse(t.x + 3, H - 14, 18, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ── Move turkey ──────────────────────────────────────────────────────
      if (t.dazed && now >= t.dazedUntil) t.dazed = false;
      if (!t.dazed) {
        t.x += t.vx * t.speed * dt;
        t.y += t.vy * t.speed * dt;
        const hs = TURKEY_SIZE / 2;
        if (t.x - hs < 0)  { t.x = hs;     t.vx =  Math.abs(t.vx); }
        if (t.x + hs > W)  { t.x = W - hs; t.vx = -Math.abs(t.vx); }
        if (t.y - hs < 0)  { t.y = hs;     t.vy =  Math.abs(t.vy); }
        if (t.y + hs > H)  { t.y = H - hs; t.vy = -Math.abs(t.vy); }
      }

      // ── Spawn dust trail based on speed ──────────────────────────────────
      const speedPct = Math.max(0, (t.speed - SPEED_BASE) / (SPEED_MAX - SPEED_BASE));
      if (!t.dazed && speedPct > 0.15 && Math.random() < speedPct * 0.4) {
        s.particles.push({
          x: t.x + (Math.random() - 0.5) * 14,
          y: t.y + TURKEY_SIZE * 0.35,
          vx: -t.vx * (0.15 + Math.random() * 0.25),
          vy: -t.vy * 0.1 + 0.35 + Math.random() * 0.35,
          life: 1,
          color: `rgba(160,75,15,${0.12 + speedPct * 0.3})`,
          size: 2 + speedPct * 5,
          isDust: true,
        });
      }

      // ── Update + draw particles ───────────────────────────────────────────
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x    += p.vx;
        p.y    += p.vy;
        p.life -= p.isDust ? 0.028 : 0.034;
        if (p.life <= 0) { s.particles.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle   = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * (p.isDust ? p.life : 1)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Draw turkey ──────────────────────────────────────────────────────
      ctx.save();
      if (t.dazed) {
        ctx.globalAlpha = 0.55 + Math.sin(now / 35) * 0.45;
      }
      ctx.translate(t.x, t.y);
      if (t.vx < 0) ctx.scale(-1, 1);
      ctx.font         = `${TURKEY_SIZE}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🦃', 0, 0);
      ctx.restore();

      // ── Golden turkey ─────────────────────────────────────────────────────
      const g = s.golden;
      if (g.active) {
        if (now >= g.expiresAt) {
          g.active = false;
        } else {
          const gs = t.speed * GOLDEN_SPEED_MULT;
          g.x += g.vx * gs * dt;
          g.y += g.vy * gs * dt;
          const hs = TURKEY_SIZE / 2;
          if (g.x - hs < 0)  { g.x = hs;     g.vx =  Math.abs(g.vx); }
          if (g.x + hs > W)  { g.x = W - hs; g.vx = -Math.abs(g.vx); }
          if (g.y - hs < 0)  { g.y = hs;     g.vy =  Math.abs(g.vy); }
          if (g.y + hs > H)  { g.y = H - hs; g.vy = -Math.abs(g.vy); }

          const lifeRatio = (g.expiresAt - now) / GOLDEN_DURATION;

          // Pulsing gold ring indicator
          ctx.save();
          ctx.strokeStyle = `rgba(251,191,36,${lifeRatio * 0.55})`;
          ctx.lineWidth   = 2.5;
          ctx.shadowBlur  = 14;
          ctx.shadowColor = '#fbbf24';
          ctx.beginPath();
          ctx.arc(g.x, g.y, HIT_RADIUS * 0.65 + Math.sin(now / 120) * 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

          // Gold glow turkey
          ctx.save();
          ctx.shadowBlur   = 26 + Math.sin(now / 55) * 8;
          ctx.shadowColor  = '#fbbf24';
          ctx.globalAlpha  = Math.min(1, lifeRatio * 1.6);
          ctx.translate(g.x, g.y);
          if (g.vx < 0) ctx.scale(-1, 1);
          ctx.font         = `${TURKEY_SIZE}px serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🦃', 0, 0);
          ctx.restore();
        }
      }

      // ── Floating score labels ─────────────────────────────────────────────
      for (let i = s.floatingScores.length - 1; i >= 0; i--) {
        const fs = s.floatingScores[i];
        fs.y    -= 1.8;
        fs.life -= 0.022;
        if (fs.life <= 0) { s.floatingScores.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha  = fs.life;
        ctx.font         = 'bold 18px system-ui, sans-serif';
        ctx.fillStyle    = '#fde68a';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur   = 10;
        ctx.shadowColor  = '#f97316';
        ctx.fillText(fs.text, fs.x, fs.y);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, makeLeaves, scheduleDir]);

  // ─── INPUT HANDLER ────────────────────────────────────────────────────────
  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;

    const rect = canvas.getBoundingClientRect();
    const px   = (clientX - rect.left) * (canvas.width  / rect.width);
    const py   = (clientY - rect.top)  * (canvas.height / rect.height);
    const W    = canvas.width;
    const H    = canvas.height;
    const now  = Date.now();

    s.sig.totalAttempts++;

    // ── Check golden turkey ────────────────────────────────────────────────
    const g = s.golden;
    if (g.active) {
      const dx = px - g.x;
      const dy = py - g.y;
      if (Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS) {
        g.active = false;
        if (goldenTimRef.current) { clearTimeout(goldenTimRef.current); goldenTimRef.current = null; }
        s.sig.goldenTurkeyHits++;
        s.sig.score += GOLDEN_POINTS;
        s.sig.hits++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;

        // Feather burst
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          s.particles.push({
            x: g.x, y: g.y,
            vx: Math.cos(angle) * (3 + Math.random() * 3),
            vy: Math.sin(angle) * (3 + Math.random() * 3),
            life: 1,
            color: FEATHER_COLORS[i % FEATHER_COLORS.length],
            size: 5 + Math.random() * 4,
            isDust: false,
          });
        }
        s.floatingScores.push({ x: g.x, y: g.y - 34, text: '⭐ +5', life: 1 });
        setScoreDisplay(s.sig.score);
        sfx.success();
        haptic([30, 20, 50]);
        return;
      }
    }

    // ── Check regular turkey ──────────────────────────────────────────────
    const t   = s.turkey;
    const dx  = px - t.x;
    const dy  = py - t.y;
    const tapQ = getQuadrant(px, py, W, H);

    if (Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS) {
      // HIT ✓
      const reactionMs = now - t.lastDirChangeTime;
      s.sig.hits++;
      s.sig.hitCount++;
      s.sig.reactionTimes.push(reactionMs);
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      s.sig.score++;

      t.speed = Math.min(SPEED_MAX, t.speed + SPEED_INC);
      t.dazed                  = true;
      t.dazedUntil             = now + DAZE_MS;
      t.lastTapQuadrant        = tapQ;
      t.lastTapQuadrantExpiry  = now + DODGE_MEMORY_MS;

      // Feather burst: 6-8 radial particles
      const count = 6 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        s.particles.push({
          x: t.x, y: t.y,
          vx: Math.cos(angle) * (2 + Math.random() * 4),
          vy: Math.sin(angle) * (2 + Math.random() * 4),
          life: 1,
          color: FEATHER_COLORS[Math.floor(Math.random() * FEATHER_COLORS.length)],
          size: 4 + Math.random() * 4,
          isDust: false,
        });
      }
      s.floatingScores.push({ x: t.x, y: t.y - 38, text: '🦃 +1', life: 1 });
      setScoreDisplay(s.sig.score);
      // ⚡ SPEED % HUD — update on every hit that may increase speed
      const speedPct = Math.round(Math.max(0, (t.speed - SPEED_BASE) / (SPEED_MAX - SPEED_BASE)) * 100);
      setSpeedDisplay(speedPct);
      sfx.collect();
      // ⚡ speedUpSound: "tick" per spec — plays on every hit (every hit speeds the turkey up)
      sfx.tick();
      haptic([20]);

      // Spawn golden turkey after every 5th hit
      if (s.sig.hitCount % GOLDEN_EVERY === 0) {
        setTimeout(() => { if (stateRef.current.running) spawnGolden(); }, 450);
      }
    } else {
      // MISS
      s.sig.streakCurrent = 0;
      // Turkey also learns from misses (avoids where the user tapped)
      t.lastTapQuadrant        = tapQ;
      t.lastTapQuadrantExpiry  = now + DODGE_MEMORY_MS;
      // Update longest unbroken chase
      const chase = (now - s.sig.chaseStart) / 1000;
      if (chase > s.sig.longestChase) s.sig.longestChase = chase;
      s.sig.chaseStart = now;
      // ⚡ Miss visual — spec: "missed taps show fork outline briefly (where it almost was)"
      s.floatingScores.push({ x: px, y: py, text: '🍴', life: 1 });
    }
  }, [spawnGolden]);

  // ─── CANVAS SETUP + RESIZE ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
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
  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current)     clearInterval(timerRef.current);
    if (dirChangeRef.current) clearTimeout(dirChangeRef.current);
    if (goldenTimRef.current) clearTimeout(goldenTimRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────
  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    await initAudio(); sfx.click();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setPhase('start');
    setScoreDisplay(0);
    setSpeedDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────
  const buildInsights = (sig: Signals) => {
    const acc   = sig.totalAttempts > 0 ? Math.round((sig.hits / sig.totalAttempts) * 100) : 0;
    const avgRx = sig.reactionTimes.length > 0
      ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length)
      : 0;
    return [
      { label: 'Turkeys Caught', value: String(sig.score),            color: ACCENT },
      { label: 'Accuracy',       value: `${acc}%`,                    color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Avg Reaction',   value: `${avgRx}ms`,                 color: ACCENT },
      { label: 'Golden Turkeys', value: String(sig.goldenTurkeyHits), color: '#fbbf24' },
    ];
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {showInstructions && (
        <SwipeInstructions
          gameId="turkey-trot"
          steps={[{ icon: "🦃", title: "Help the turkey run", body: "Tap left or right to dodge obstacles." }, { icon: "🌽", title: "Collect corn", body: "Grab corn for bonus points as you run." }, { icon: "🏃", title: "Don't get caught", body: "Avoid the farmer — how far can you run?" }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Hunt the Turkey 🦃"
          accentColor={accent}
          ctaTextColor="#000"
          onStart={handleStart}
        />
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accent} />
      )}

      {/* ── Canvas (stays mounted through countdown + playing) ────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
          />
          {phase === 'playing' && (
            <GameHUD
              accentColor={accent}
              items={[
                { label: 'TIME',      value: timeLeft,          danger: timeLeft <= 10 },
                { label: 'CAUGHT 🦃', value: scoreDisplay },
                { label: 'SPEED',     value: `${speedDisplay}%` },
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
          didWin={finalSig.score >= 10}
        />
      )}

      {/* ── Webhook (fires once on done) ──────────────────────────────────── */}
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
// Isolated component — fires postWebhook exactly once on mount.

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
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
    const acc   = sig.totalAttempts > 0 ? sig.hits / sig.totalAttempts : 0;
    const avgRx = sig.reactionTimes.length > 0
      ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length)
      : null;
    postWebhook(theme, gameId, {
      personality,
      score:            sig.score,
      accuracy:         parseFloat(acc.toFixed(3)),
      totalAttempts:    sig.totalAttempts,
      hits:             sig.hits,
      avgReactionMs:    avgRx,
      maxStreak:        sig.maxStreak,
      goldenTurkeyHits: sig.goldenTurkeyHits,
      longestChase:     parseFloat(sig.longestChase.toFixed(1)),
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
