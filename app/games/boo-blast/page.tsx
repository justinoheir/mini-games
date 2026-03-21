'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCelebration, hapticCombo } from '@/lib/haptics';
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
const GAME_ID      = 'boo-blast';
const PB_KEY       = 'pb_boo-blast';
const ACCENT       = '#a855f7';
const DURATION     = 30;
const GAME_EMOJI   = '👻';
const GAME_TITLE   = 'Boo Blast';
const GAME_TAGLINE = "Tap the ghosts. They won't wait.";

// ─── SPEED STAGE LABELS ──────────────────────────────────────────────────────
const SPEED_STAGE_LABELS: Record<number, string> = {
  0:  "They're waking up...",
  12: "They're multiplying!",
  22: 'FULL HAUNTING',
};

// ─── GHOST TYPES ─────────────────────────────────────────────────────────────
const GHOST_TYPES = [
  { id: 'big_ghost',    emoji: '👻', size: 80,  points: 1, visibleMs: 1800, weight: 40 },
  { id: 'medium_ghost', emoji: '👻', size: 56,  points: 2, visibleMs: 1400, weight: 35 },
  { id: 'small_ghost',  emoji: '👻', size: 36,  points: 3, visibleMs: 1000, weight: 20 },
  { id: 'boss_ghost',   emoji: '💀', size: 100, points: 5, visibleMs: 2500, weight: 5  },
] as const;

type GhostTypeId = typeof GHOST_TYPES[number]['id'];
const TOTAL_WEIGHT = GHOST_TYPES.reduce((s, t) => s + t.weight, 0);

function pickGhostType(): typeof GHOST_TYPES[number] {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const t of GHOST_TYPES) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return GHOST_TYPES[0];
}

// ─── SPEED STAGES ────────────────────────────────────────────────────────────
const SPEED_STAGES = [
  { atSecond: 0,  intervalMs: 800 },
  { atSecond: 12, intervalMs: 650 },
  { atSecond: 22, intervalMs: 500 },
] as const;

// ─── DATA TYPES ───────────────────────────────────────────────────────────────
interface Ghost {
  id: number;
  x: number;
  y: number;
  size: number;
  points: number;
  spawnTime: number;
  visibleMs: number;
  opacity: number;
  emoji: string;
  typeId: GhostTypeId;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
  color: string;
}

interface ScoreFloat {
  x: number;
  y: number;
  text: string;
  alpha: number;
  vy: number;
  isBoss: boolean;
}

// ─── SIGNALS ──────────────────────────────────────────────────────────────────
interface Signals {
  score: number;
  hauntingLevel: number;
  bigGhostsHit: number;
  smallGhostsHit: number;
  bossGhostsHit: number;
  maxStreak: number;
  streakCurrent: number;
  reactionTimes: number[];
  ghostsMissed: number;
}

function calcAvgReactionMs(sig: Signals): number {
  if (!sig.reactionTimes.length) return 0;
  return Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length);
}

// ─── PERSONALITY ──────────────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  if (sig.score >= 20 && sig.hauntingLevel <= 1) return 'Ghost Hunter 🔪';
  if (sig.bossGhostsHit >= 2)                   return 'The Exorcist 📿';
  if (sig.smallGhostsHit >= 8)                  return 'Precision Buster 🎯';
  if (sig.score >= 15)                           return 'Brave Soul 💜';
  if (sig.hauntingLevel >= 4)                    return 'Haunted 👻';
  return 'First Time Ghost 🌱';
}

// ─── BACKGROUND ELEMENTS (module-level, pre-computed once) ───────────────────
interface Star { x: number; y: number; r: number; phase: number; twinkle: boolean }
interface Bat  { x: number; y: number; phase: number; speed: number; size: number }

let BG_STARS: Star[] = [];
let BG_BATS:  Bat[]  = [];
let BG_INITIALIZED = false;

function initBgElements(W: number, H: number) {
  if (BG_INITIALIZED) return;
  BG_INITIALIZED = true;
  BG_STARS = Array.from({ length: 60 }, () => ({
    x:       Math.random() * W,
    y:       Math.random() * H * 0.65,
    r:       0.5 + Math.random() * 1.5,
    phase:   Math.random() * Math.PI * 2,
    twinkle: Math.random() > 0.5,
  }));
  BG_BATS = Array.from({ length: 4 }, (_, i) => ({
    x:     Math.random() * W,
    y:     H * (0.2 + Math.random() * 0.35),
    phase: i * Math.PI * 0.5,
    speed: 0.3 + Math.random() * 0.4,
    size:  W * 0.025 + Math.random() * W * 0.015,
  }));
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────
interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  ghosts: Ghost[];
  particles: Particle[];
  scoreFloats: ScoreFloat[];
  nextGhostId: number;
  spawnIntervalMs: number;
  lastSpawnTime: number;
  accentColor: string;
  // Speed stage label overlay
  stageLabel: string | null;
  stageLabelUntil: number;
  // Change-guard for setHauntingLevel (avoid redundant re-renders from rAF)
  lastHauntingDisplayed: number;
  // Screen shake
  shakeUntil: number;
  shakeIntensity: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function BooBlastGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const phaseRef     = useRef<Phase>('start');

  // ⚠️ All mutable game state lives in stateRef — never in useState (stale closures)
  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: {
      score: 0, hauntingLevel: 0,
      bigGhostsHit: 0, smallGhostsHit: 0, bossGhostsHit: 0,
      maxStreak: 0, streakCurrent: 0,
      reactionTimes: [], ghostsMissed: 0,
    },
    ghosts: [],
    particles: [],
    scoreFloats: [],
    nextGhostId: 0,
    spawnIntervalMs: 800,
    lastSpawnTime: 0,
    accentColor: ACCENT,
    stageLabel: null,
    stageLabelUntil: 0,
    lastHauntingDisplayed: 0,
    shakeUntil: 0,
    shakeIntensity: 0,
  });

  // Only these drive re-renders
  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [hauntingLevel, setHauntingLevel] = useState(0);
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

  // Sync brand theme accent into state for rAF loop
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // Keep phaseRef in sync — lets canvas event listener check phase without closure issues
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // ─── SPAWN GHOST ────────────────────────────────────────────────────────────
  const spawnGhost = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const t = pickGhostType();
    const margin = t.size;
    s.ghosts.push({
      id:        s.nextGhostId++,
      x:         margin + Math.random() * (canvas.offsetWidth  - margin * 2),
      y:         margin + Math.random() * (canvas.offsetHeight - margin * 2),
      size:      t.size,
      points:    t.points,
      spawnTime: Date.now(),
      visibleMs: t.visibleMs,
      opacity:   0,
      emoji:     t.emoji,
      typeId:    t.id,
    });
    s.lastSpawnTime = Date.now();

    // Spawn audio cues
    if (t.id === 'boss_ghost') {
      sfx.slam(); // spec: bossAppear = "slam" — dramatic heavy thud
    } else if (t.id === 'small_ghost') {
      sfx.shimmer(); // subtle high-frequency cue for the hard/high-value ghost
    }
  }, []);

  // ─── GAME LOOP ──────────────────────────────────────────────────────────────
  // ⚠️ rAF only — setInterval for 1-second countdown only
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Reset all game state
    s.running = true;
    s.timeLeft = DURATION;
    s.sig = {
      score: 0, hauntingLevel: 0,
      bigGhostsHit: 0, smallGhostsHit: 0, bossGhostsHit: 0,
      maxStreak: 0, streakCurrent: 0,
      reactionTimes: [], ghostsMissed: 0,
    };
    s.ghosts        = [];
    s.particles     = [];
    s.scoreFloats   = [];
    s.nextGhostId   = 0;
    s.spawnIntervalMs = 800;
    s.lastSpawnTime = 0;
    s.stageLabel    = null;
    s.stageLabelUntil = 0;
    s.lastHauntingDisplayed = 0;
    s.shakeUntil    = 0;
    s.shakeIntensity = 0;

    setScoreDisplay(0);
    setHauntingLevel(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

    // 1-second timer — only for countdown + speed stages
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);

      // Final countdown tick
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();

      // Speed stages (check in reverse for highest matching stage)
      const elapsed = DURATION - s.timeLeft;
      let newStageIdx = 0;
      for (let i = SPEED_STAGES.length - 1; i >= 0; i--) {
        if (elapsed >= SPEED_STAGES[i].atSecond) {
          newStageIdx = i;
          // Trigger stage-change label when crossing a new stage threshold
          if (elapsed === SPEED_STAGES[i].atSecond && SPEED_STAGE_LABELS[SPEED_STAGES[i].atSecond]) {
            s.stageLabel = SPEED_STAGE_LABELS[SPEED_STAGES[i].atSecond];
            s.stageLabelUntil = Date.now() + 1800;
          }
          break;
        }
      }
      s.spawnIntervalMs = SPEED_STAGES[newStageIdx].intervalMs;

      if (s.timeLeft <= 0) {
        s.running = false;
        // Clear the interval from within itself to prevent repeated sfx.fail() calls
        const id = timerRef.current;
        if (id) { clearInterval(id); timerRef.current = null; }
        if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
        sfx.fail();
        haptic([300]);
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
      }
    }, 1000);

    // Initial ghost
    spawnGhost();

    const loop = () => {
      if (!s.running) return;
      const W   = canvas.offsetWidth;
      const H   = canvas.offsetHeight;
      const now = Date.now();

      // ── Init background elements (no-op after first call) ─────────────────
      initBgElements(W, H);

      // ── Screen shake setup ────────────────────────────────────────────────
      let isShaking = false;
      if (now < s.shakeUntil) {
        isShaking = true;
        const intensity = s.shakeIntensity * ((s.shakeUntil - now) / 300);
        ctx.save();
        ctx.translate(
          (Math.random() - 0.5) * intensity * 2,
          (Math.random() - 0.5) * intensity * 2,
        );
      }

      // ── Background: haunted graveyard scene ───────────────────────────────
      // Sky — deep radial gradient
      const skyGrad = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.85);
      skyGrad.addColorStop(0, '#1a0a2e');
      skyGrad.addColorStop(1, '#04010a');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // Stars
      for (const star of BG_STARS) {
        const alpha = star.twinkle
          ? 0.4 + 0.6 * Math.abs(Math.sin(now * 0.003 + star.phase))
          : 0.8;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Moon — outer glow
      const moonX = W * 0.78;
      const moonY = H * 0.15;
      const moonR = W * 0.065;
      const moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, W * 0.16);
      moonGlow.addColorStop(0, 'rgba(255,255,220,0.25)');
      moonGlow.addColorStop(1, 'rgba(255,255,220,0)');
      ctx.fillStyle = moonGlow;
      ctx.beginPath();
      ctx.arc(moonX, moonY, W * 0.16, 0, Math.PI * 2);
      ctx.fill();
      // Moon body
      ctx.fillStyle = '#fffde0';
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
      ctx.fill();
      // Moon inner shadow
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = 'rgba(200,190,120,0.15)';
      ctx.beginPath();
      ctx.arc(moonX + moonR * 0.2, moonY - moonR * 0.1, moonR * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Distant hills — back layer
      ctx.fillStyle = '#0d0520';
      ctx.beginPath();
      ctx.moveTo(0, H);
      ctx.lineTo(0, H * 0.65);
      ctx.bezierCurveTo(W * 0.15, H * 0.45, W * 0.30, H * 0.55, W * 0.45, H * 0.55);
      ctx.bezierCurveTo(W * 0.60, H * 0.55, W * 0.70, H * 0.42, W * 0.82, H * 0.50);
      ctx.bezierCurveTo(W * 0.90, H * 0.55, W * 0.96, H * 0.60, W, H * 0.60);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();

      // Distant hills — front layer
      ctx.fillStyle = '#110825';
      ctx.beginPath();
      ctx.moveTo(0, H);
      ctx.lineTo(0, H * 0.72);
      ctx.bezierCurveTo(W * 0.12, H * 0.58, W * 0.25, H * 0.65, W * 0.38, H * 0.62);
      ctx.bezierCurveTo(W * 0.50, H * 0.60, W * 0.62, H * 0.55, W * 0.75, H * 0.62);
      ctx.bezierCurveTo(W * 0.85, H * 0.67, W * 0.93, H * 0.68, W, H * 0.65);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();

      // Ground — dark grass strip
      ctx.fillStyle = '#050e08';
      ctx.fillRect(0, H * 0.82, W, H * 0.18);

      // Fog — 3 overlapping radial gradients along ground line
      for (let fi = 0; fi < 3; fi++) {
        const fogX = W * (0.2 + fi * 0.3);
        const fogG = ctx.createRadialGradient(fogX, H * 0.82, 0, fogX, H * 0.82, W * 0.35);
        fogG.addColorStop(0, 'rgba(60,20,80,0.18)');
        fogG.addColorStop(1, 'rgba(60,20,80,0)');
        ctx.fillStyle = fogG;
        ctx.fillRect(0, H * 0.70, W, H * 0.30);
      }

      // Tombstones (5 pre-positioned relative to canvas size)
      const tombDefs = [
        { rx: 0.15, ry: 0.78, rw: 0.045, rh: 0.085, color: '#1a1a2e', angle: -2 },
        { rx: 0.30, ry: 0.77, rw: 0.040, rh: 0.070, color: '#15152a', angle: 1.5 },
        { rx: 0.47, ry: 0.79, rw: 0.050, rh: 0.095, color: '#201535', angle: 0 },
        { rx: 0.63, ry: 0.76, rw: 0.042, rh: 0.075, color: '#1a1a2e', angle: -1 },
        { rx: 0.80, ry: 0.78, rw: 0.048, rh: 0.088, color: '#15152a', angle: 2 },
      ];
      for (const td of tombDefs) {
        const tx = W * td.rx;
        const ty = H * td.ry;
        const tw = W * td.rw;
        const th = H * td.rh;
        ctx.save();
        ctx.translate(tx, ty + th);
        ctx.rotate((td.angle * Math.PI) / 180);
        ctx.fillStyle = td.color;
        // Draw tombstone body
        ctx.beginPath();
        // Rounded top using arc
        ctx.arc(tw * 0.5, -th + tw * 0.5, tw * 0.5, Math.PI, 0);
        ctx.lineTo(tw, 0);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Dead trees — left and right sides
      const drawTree = (tx: number, ty: number, trunkH: number) => {
        ctx.save();
        ctx.strokeStyle = '#0d0a15';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        // Trunk
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx, ty - trunkH);
        ctx.stroke();
        // Branches (3–4 forks)
        const branches = [
          { fromY: 0.3, dx: -0.55, dy: -0.35 },
          { fromY: 0.5, dx: 0.50,  dy: -0.30 },
          { fromY: 0.65, dx: -0.40, dy: -0.20 },
          { fromY: 0.75, dx: 0.35, dy: -0.18 },
        ];
        for (const b of branches) {
          const bx = tx;
          const by = ty - trunkH * (1 - b.fromY);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + trunkH * b.dx * 0.5, by - trunkH * Math.abs(b.dy));
          ctx.stroke();
        }
        ctx.restore();
      };
      drawTree(W * 0.08, H * 0.80, H * 0.35);
      drawTree(W * 0.92, H * 0.80, H * 0.35);

      // Animated bats
      for (const bat of BG_BATS) {
        bat.x += bat.speed * 16 * 0.03; // ~16ms deltaTime approximation
        if (bat.x > W + bat.size * 2) bat.x = -bat.size * 2;
        const bx = bat.x;
        const by = bat.y;
        const wingFlap = Math.sin(now * 0.008 + bat.phase) * bat.size * 0.4;
        ctx.save();
        ctx.fillStyle = '#1a0a2e';
        ctx.strokeStyle = '#1a0a2e';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.85;
        // M-shape bat: left wing arc + right wing arc
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.bezierCurveTo(
          bx - bat.size * 0.5, by + wingFlap,
          bx - bat.size * 1.0, by - bat.size * 0.3,
          bx - bat.size * 1.2, by,
        );
        ctx.bezierCurveTo(
          bx - bat.size * 1.0, by + bat.size * 0.2,
          bx - bat.size * 0.5, by - bat.size * 0.1,
          bx, by,
        );
        ctx.bezierCurveTo(
          bx + bat.size * 0.5, by + wingFlap,
          bx + bat.size * 1.0, by - bat.size * 0.3,
          bx + bat.size * 1.2, by,
        );
        ctx.bezierCurveTo(
          bx + bat.size * 1.0, by + bat.size * 0.2,
          bx + bat.size * 0.5, by - bat.size * 0.1,
          bx, by,
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Vignette
      const bbVig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, H * 0.85);
      bbVig.addColorStop(0, 'rgba(0,0,0,0)');
      bbVig.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = bbVig;
      ctx.fillRect(0, 0, W, H);

      // ── Spawn new ghosts ───────────────────────────────────────────────────
      if (now - s.lastSpawnTime >= s.spawnIntervalMs) {
        spawnGhost();
      }

      // ── Update ghosts: opacity animation + miss detection ─────────────────
      for (let i = s.ghosts.length - 1; i >= 0; i--) {
        if (!s.running) break; // game over triggered mid-loop — stop processing

        const ghost = s.ghosts[i];
        const age = now - ghost.spawnTime;
        const fadeIn      = 200;
        const fadeOutMs   = 200;
        const fadeOutStart = ghost.visibleMs - fadeOutMs;

        if (age < fadeIn) {
          ghost.opacity = age / fadeIn;
        } else if (age < fadeOutStart) {
          ghost.opacity = 1;
        } else if (age < ghost.visibleMs) {
          ghost.opacity = 1 - (age - fadeOutStart) / fadeOutMs;
        } else {
          // MISS — ghost timed out
          s.ghosts.splice(i, 1);
          s.sig.hauntingLevel = Math.min(5, s.sig.hauntingLevel + 1);
          s.sig.ghostsMissed++;
          s.sig.streakCurrent = 0;
          // Change-guard: only re-render React DOM when value actually changes
          if (s.sig.hauntingLevel !== s.lastHauntingDisplayed) {
            s.lastHauntingDisplayed = s.sig.hauntingLevel;
            setHauntingLevel(s.sig.hauntingLevel);
          }
          sfx.warning(); // spec: missSound = "warning" — ominous low sawtooth
          hapticFail();
          if (s.sig.hauntingLevel >= 5) {
            s.running = false; // early game over — handled below
          }
          continue;
        }

        // ── Draw ghost ─────────────────────────────────────────────────────
        const isBoss = ghost.typeId === 'boss_ghost';
        // Subtle vertical bob
        const bobOffset = Math.sin(now * 0.002 + ghost.id * 1.3) * 4;
        const drawY = ghost.y + bobOffset;

        // Ghost blob body (drawn behind emoji)
        ctx.save();
        ctx.globalAlpha = ghost.opacity * 0.7;
        const bodyGrad = ctx.createRadialGradient(
          ghost.x, drawY - ghost.size * 0.15, 0,
          ghost.x, drawY, ghost.size * 0.55,
        );
        bodyGrad.addColorStop(0, isBoss ? 'rgba(255,80,255,0.9)' : 'rgba(200,170,255,0.85)');
        bodyGrad.addColorStop(1, 'rgba(120,60,200,0)');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(ghost.x, drawY - ghost.size * 0.1, ghost.size * 0.48, Math.PI, 0);
        // Wavy bottom edge (ghost tail)
        const waveY    = drawY + ghost.size * 0.3;
        const tailCount = 3;
        const tailW    = (ghost.size * 0.96) / tailCount;
        const left  = ghost.x - ghost.size * 0.48;
        const right = ghost.x + ghost.size * 0.48;
        ctx.lineTo(right, waveY);
        for (let t = 0; t < tailCount; t++) {
          const tx2  = right - (t + 0.5) * tailW;
          const bump = t % 2 === 0 ? waveY + ghost.size * 0.18 : waveY - ghost.size * 0.08;
          ctx.quadraticCurveTo(
            tx2 + tailW * 0.25, bump,
            tx2 - tailW * 0.25, waveY + (t % 2 === 0 ? ghost.size * 0.04 : 0),
          );
        }
        ctx.lineTo(left, waveY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Emoji on top (existing glow effects preserved)
        ctx.save();
        ctx.globalAlpha  = ghost.opacity;
        ctx.shadowBlur   = isBoss ? 50 : 22;
        ctx.shadowColor  = isBoss ? '#ff44ff' : s.accentColor;
        ctx.font         = `${ghost.size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ghost.emoji, ghost.x, drawY);

        // Extra outer glow pass for boss
        if (isBoss) {
          ctx.shadowBlur  = 80;
          ctx.shadowColor = '#ff00ff';
          ctx.globalAlpha = ghost.opacity * 0.5;
          ctx.fillText(ghost.emoji, ghost.x, drawY);
        }
        ctx.restore();
      }

      // ── Check early game over after ghost processing ───────────────────────
      if (!s.running) {
        cancelAnimationFrame(animRef.current);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
        sfx.fail();
        hapticFail();
        setFinalSig({ ...s.sig });
        setPhase('done');
        return;
      }

      // ── Particles: multi-color burst ──────────────────────────────────────
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x    += p.vx;
        p.y    += p.vy;
        p.vy   += 0.18; // gravity
        p.alpha -= 0.03;
        if (p.alpha <= 0) { s.particles.splice(i, 1); continue; }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = p.color;
        ctx.shadowBlur  = 10;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Score floats ───────────────────────────────────────────────────────
      for (let i = s.scoreFloats.length - 1; i >= 0; i--) {
        const f = s.scoreFloats[i];
        f.y     += f.vy;
        f.alpha -= 0.025;
        if (f.alpha <= 0) { s.scoreFloats.splice(i, 1); continue; }

        ctx.save();
        ctx.globalAlpha  = f.alpha;
        ctx.shadowBlur   = 14;
        ctx.shadowColor  = f.isBoss ? '#ff44ff' : s.accentColor;
        ctx.font         = `bold ${f.isBoss ? 28 : 22}px 'Space Grotesk', system-ui, -apple-system, sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        // Stroke for legibility
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth   = 2;
        ctx.strokeText(f.text, f.x, f.y);
        ctx.fillStyle   = f.isBoss ? '#ff44ff' : '#ffffff';
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
      }

      // ── Speed stage label overlay ──────────────────────────────────────
      if (s.stageLabel && Date.now() < s.stageLabelUntil) {
        const progress = (s.stageLabelUntil - Date.now()) / 1800;
        const alpha = progress < 0.25 ? progress / 0.25 : progress > 0.75 ? (progress - 0.75) / 0.25 : 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.font         = `bold ${Math.floor(W * 0.058)}px -apple-system, system-ui, sans-serif`;
        ctx.shadowBlur   = 24;
        ctx.shadowColor  = s.stageLabel === 'FULL HAUNTING' ? '#ff0055' : s.accentColor;
        ctx.fillStyle    = s.stageLabel === 'FULL HAUNTING' ? '#ff4488' : '#ffffff';
        ctx.fillText(s.stageLabel, W / 2, H * 0.42);
        ctx.restore();
      }

      // ── End screen shake transform ─────────────────────────────────────────
      if (isShaking) ctx.restore();

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [spawnGhost]);

  // ─── TAP HANDLER ────────────────────────────────────────────────────────────
  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;

    const rect = canvas.getBoundingClientRect();
    // Ghost positions are in CSS pixels (canvas.offsetWidth); use CSS pixels for hit detection
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Check ghosts in reverse (topmost / last spawned first)
    for (let i = s.ghosts.length - 1; i >= 0; i--) {
      const ghost = s.ghosts[i];
      if (ghost.opacity < 0.1) continue;

      const dx   = x - ghost.x;
      const dy   = y - ghost.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitR = ghost.size * 0.58; // slightly forgiving hit radius

      if (dist <= hitR) {
        // ── HIT ──────────────────────────────────────────────────────────
        const reactionMs = Date.now() - ghost.spawnTime;
        s.sig.reactionTimes.push(reactionMs);
        s.sig.score        += ghost.points;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;

        if (ghost.typeId === 'big_ghost')    s.sig.bigGhostsHit++;
        if (ghost.typeId === 'small_ghost')  s.sig.smallGhostsHit++;
        if (ghost.typeId === 'boss_ghost') {
          s.sig.bossGhostsHit++;
          // Screen shake on boss kill
          s.shakeUntil     = Date.now() + 300;
          s.shakeIntensity = 8;
        }

        // Multi-color particle burst
        const isBossHit = ghost.typeId === 'boss_ghost';
        const particleCount = isBossHit ? 24 : 14;
        const bossColors    = ['#ff44ff', '#ff0088', '#ffaa00', '#ffffff', '#aa44ff'];
        const regColors     = ['#c084fc', '#e879f9', '#ffffff', '#a855f7'];
        const colors = isBossHit ? bossColors : regColors;

        for (let p = 0; p < particleCount; p++) {
          const angle = (Math.PI * 2 * p) / particleCount + Math.random() * 0.4;
          const speed = isBossHit
            ? 3 + Math.random() * 5   // 3–8 for boss
            : 2 + Math.random() * 3;  // 2–5 for regular
          s.particles.push({
            x:     ghost.x,
            y:     ghost.y,
            vx:    Math.cos(angle) * speed,
            vy:    Math.sin(angle) * speed - 2,
            alpha: 1,
            size:  3 + Math.random() * 4, // 3–7px
            color: colors[Math.floor(Math.random() * colors.length)],
          });
        }

        // Score float
        const floatText = isBossHit
          ? `💥+${ghost.points}`
          : `+${ghost.points}`;
        s.scoreFloats.push({
          x:      ghost.x,
          y:      ghost.y - ghost.size * 0.5,
          text:   floatText,
          alpha:  1,
          vy:     -1.8,
          isBoss: isBossHit,
        });

        s.ghosts.splice(i, 1);
        setScoreDisplay(s.sig.score);
        sfx.boom(); // spec: hitSound = "boom" — satisfying ghost-blast explosion
        // Duolingo-level haptics: boss = celebration, streak milestone, normal = score punch
        if (ghost.typeId === 'boss_ghost') {
          hapticCelebration();
        } else if (s.sig.streakCurrent > 0 && s.sig.streakCurrent % 5 === 0) {
          hapticCombo(s.sig.streakCurrent);
        } else {
          hapticScore();
        }
        break; // only one ghost per tap
      }
    }
  }, []);

  // ─── CANVAS SETUP & RESIZE ─────────────────────────────────────────────────
  // ⚠️ Canvas must fill the GameShell area. Must handle resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      // Use parent dimensions so the canvas buffer EXACTLY matches CSS display size
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth  : window.innerWidth;
      const h = parent ? parent.clientHeight : window.innerHeight;
      // Lock CSS display size first — prevents browser from stretching buffer to fill %
      canvas.style.width  = w + 'px';
      canvas.style.height = h + 'px';
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Reset bg so it re-initialises at correct dims on next frame
      BG_INITIALIZED = false;
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

  // ─── CLEANUP ON UNMOUNT ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // ─── PHASE TRANSITIONS ─────────────────────────────────────────────────────
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
    setHauntingLevel(0);
    setFinalSig(null);
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  // ─── END SCREEN INSIGHTS ───────────────────────────────────────────────────
  const buildInsights = (sig: Signals) => {
    const avg = calcAvgReactionMs(sig);
    return [
      {
        label: 'Ghosts Blasted',
        value: `${sig.score}`,
        color: sig.score >= 15 ? '#4ade80' : sig.score >= 8 ? '#facc15' : ACCENT,
      },
      {
        label: 'Haunting Level',
        value: `${sig.hauntingLevel}/5`,
        color: sig.hauntingLevel >= 4 ? '#ef4444' : sig.hauntingLevel >= 2 ? '#facc15' : '#4ade80',
      },
      {
        label: 'Boss Ghosts 💀',
        value: `${sig.bossGhostsHit}`,
        color: ACCENT,
      },
      {
        label: 'Best Streak',
        value: avg > 0 ? `×${sig.maxStreak} · ${avg}ms` : `×${sig.maxStreak}`,
        color: ACCENT,
      },
    ];
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────
  const accent = theme.colors.accent ?? ACCENT;

  return (
    <>
    {/* ── Instructions — portal to body, renders above everything ─────────── */}
    {phase === 'start' && showInstructions && (
      <SwipeInstructions
        gameId="boo-blast"
        steps={[
          { icon: "👆", title: "Tap the ghosts", body: "Tap them before they disappear — each ghost is worth points." },
          { icon: "👻", title: "Don't let them escape", body: "5 escaped ghosts ends the game early. Stay sharp." },
          { icon: "💀", title: "Boss ghosts = 5pts", body: "The skull ghost is rare and worth 5x. Prioritize it." },
        ]}
        onDone={() => setShowInstructions(false)}
      />
    )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>

      {/* ── Start Screen ────────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Blast Em'"
          accentColor={accent}
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #1a0a2e 0%, #0e0518 55%, #060208 100%)"
        >
          {/* ⚠️ Per-game name capture — required in every game */}
        </GameStartScreen>
      )}

      {/* ── Countdown ───────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accent} />
      )}

      {/* ── Canvas (rendered during countdown + playing for seamless start) ─── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          {/* ⚠️ Canvas must have full-bleed absolute positioning */}
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

          {/* ── HUD (only during playing) ──────────────────────────────────── */}
          {phase === 'playing' && (
            <>
              <GameHUD
                accentColor={accent}
                items={[
                  { label: 'TIME',       value: timeLeft,     danger: timeLeft <= 10 },
                  { label: 'BLASTED 👻', value: scoreDisplay },
                ]}
              />

              {/* ── Haunting Meter — 5 skulls top-center ──────────────────── */}
              <div
                style={{
                  position:       'absolute',
                  top:            60,
                  left:           0,
                  right:          0,
                  display:        'flex',
                  justifyContent: 'center',
                  alignItems:     'center',
                  gap:            10,
                  padding:        '6px 0',
                  zIndex:         20,
                  pointerEvents:  'none',
                }}
              >
                <span style={{
                  fontSize:      11,
                  fontWeight:    700,
                  letterSpacing: '0.12em',
                  color:         'rgba(255,255,255,0.45)',
                  textTransform: 'uppercase',
                  marginRight:   4,
                }}>
                  HAUNTED
                </span>
                {Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize:   22,
                      lineHeight: 1,
                      opacity:    i < hauntingLevel ? 1 : 0.22,
                      filter:     i < hauntingLevel
                        ? 'drop-shadow(0 0 8px #ef4444)'
                        : 'none',
                      transition: 'opacity 0.18s ease, filter 0.18s ease',
                      transform:  i < hauntingLevel ? 'scale(1.15)' : 'scale(1)',
                    }}
                  >
                    💀
                  </span>
                ))}
              </div>
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



      {/* ── End Screen ──────────────────────────────────────────────────────── */}
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
          didWin={finalSig.score >= 10 && finalSig.hauntingLevel < 5}
        />
      )}

      {/* ⚠️ Webhook fires exactly once on mount via isolated component */}
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

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────
// Isolated so postWebhook fires exactly once on mount.
function WebhookEmitter({ theme, gameId, sig, personality, player }: {
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
    postWebhook(theme, gameId, {
      personality,
      score:          sig.score,
      hauntingLevel:  sig.hauntingLevel,
      bigGhostsHit:   sig.bigGhostsHit,
      smallGhostsHit: sig.smallGhostsHit,
      bossGhostsHit:  sig.bossGhostsHit,
      maxStreak:      sig.maxStreak,
      avgReactionMs:  calcAvgReactionMs(sig),
      ghostsMissed:   sig.ghostsMissed,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
