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
}

interface ScoreFloat {
  x: number;
  y: number;
  text: string;
  alpha: number;
  vy: number;
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
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── SPRITE CACHE ─────────────────────────────────────────────────────────────
const _spriteCache = new Map<string, HTMLImageElement>();
function loadSprite(src: string): HTMLImageElement {
  if (_spriteCache.has(src)) return _spriteCache.get(src)!;
  const img = new Image();
  img.src = src;
  _spriteCache.set(src, img);
  return img;
}
// Pre-warm sprites
if (typeof window !== 'undefined') {
  loadSprite('/sprites/boo-blast/ghost.svg');
  loadSprite('/sprites/boo-blast/boss.svg');
}

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
      x:         margin + Math.random() * (window.innerWidth  - margin * 2),
      // Keep ghosts below the HUD (top ~140px) and above bottom safe area (bottom ~30px)
      y:         140 + margin + Math.random() * (window.innerHeight - 140 - 30 - margin * 2),
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

      // ── Background: deep haunted purple radial gradient ────────────────────
      const bbBg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.6, Math.max(W, H) * 0.9);
      bbBg.addColorStop(0,   '#1a0a2e');
      bbBg.addColorStop(0.5, '#0e0518');
      bbBg.addColorStop(1,   '#060208');
      ctx.fillStyle = bbBg;
      ctx.fillRect(0, 0, W, H);

      const fog = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.4, Math.max(W, H) * 0.75);
      fog.addColorStop(0,   'rgba(168, 85, 247, 0.14)');
      fog.addColorStop(0.5, 'rgba(100, 40, 200, 0.07)');
      fog.addColorStop(1,   'rgba(0,   0,   0,  0)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, W, H);

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
        const ghostSprite = loadSprite(isBoss ? '/sprites/boo-blast/boss.svg' : '/sprites/boo-blast/ghost.svg');
        const half = ghost.size / 2;
        ctx.save();
        ctx.globalAlpha  = ghost.opacity;
        ctx.shadowBlur   = isBoss ? 50 : 22;
        ctx.shadowColor  = isBoss ? '#ff44ff' : s.accentColor;
        if (ghostSprite.complete && ghostSprite.naturalWidth > 0) {
          ctx.drawImage(ghostSprite, ghost.x - half, ghost.y - half, ghost.size, ghost.size);
        } else {
          ctx.font         = `${ghost.size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(ghost.emoji, ghost.x, ghost.y);
        }

        // Extra outer glow pass for boss
        if (isBoss) {
          ctx.shadowBlur  = 80;
          ctx.shadowColor = '#ff00ff';
          ctx.globalAlpha = ghost.opacity * 0.5;
          if (ghostSprite.complete && ghostSprite.naturalWidth > 0) {
            ctx.drawImage(ghostSprite, ghost.x - half, ghost.y - half, ghost.size, ghost.size);
          } else {
            ctx.fillText(ghost.emoji, ghost.x, ghost.y);
          }
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

      // ── Particles: purple burst ────────────────────────────────────────────
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x    += p.vx;
        p.y    += p.vy;
        p.vy   += 0.18; // gravity
        p.alpha -= 0.03;
        if (p.alpha <= 0) { s.particles.splice(i, 1); continue; }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = s.accentColor;
        ctx.shadowBlur  = 8;
        ctx.shadowColor = s.accentColor;
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
        ctx.fillStyle    = '#ffffff';
        ctx.shadowBlur   = 14;
        ctx.shadowColor  = s.accentColor;
        ctx.font         = 'bold 22px system-ui, -apple-system, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
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
        if (ghost.typeId === 'boss_ghost')   s.sig.bossGhostsHit++;

        // Purple particle burst from tap point
        const particleCount = ghost.typeId === 'boss_ghost' ? 20 : 12;
        for (let p = 0; p < particleCount; p++) {
          const angle = (Math.PI * 2 * p) / particleCount + Math.random() * 0.4;
          const speed = 2.5 + Math.random() * 4.5;
          s.particles.push({
            x:     ghost.x,
            y:     ghost.y,
            vx:    Math.cos(angle) * speed,
            vy:    Math.sin(angle) * speed - 2,
            alpha: 1,
            size:  2 + Math.random() * 4,
          });
        }

        // Score float
        const floatText = `+${ghost.points}${ghost.typeId === 'boss_ghost' ? ' 💀' : ''}`;
        s.scoreFloats.push({
          x:     ghost.x,
          y:     ghost.y - ghost.size * 0.5,
          text:  floatText,
          alpha: 1,
          vy:    -1.8,
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
      // Use innerWidth/Height — avoids 100vh overscroll bug on Chrome Android/iOS Safari
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
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 80%, rgba(80,0,120,0.2) 0%, rgba(40,0,80,0.1) 40%, transparent 70%), linear-gradient(180deg, #04020a 0%, #080412 30%, #0c0618 55%, #080412 80%, #04020a 100%)">

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
          finalScore={finalSig.score}
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
