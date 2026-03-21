/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — HARVEST CATCH
 *  Holiday: Thanksgiving
 *  Mechanic: Canvas tilt-catch — tilt phone to move harvest basket
 *  Items fall from top; catch good food, dodge the bad.
 *  CORNUCOPIA BONUS: catch turkey→pie→corn in order for 5s all-good window.
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
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.holiday.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────
const GAME_ID        = 'harvest-catch';
const PB_KEY       = 'pb_harvest-catch';
const ACCENT         = '#d97706';
const DURATION       = 45;
const GAME_EMOJI     = '🍁';
const GAME_TITLE     = 'Harvest Catch';
const GAME_TAGLINE   = 'Tilt to catch the harvest. Skip the Brussels sprouts.';
const BASKET_WIDTH   = 90;
const CATCH_Y_FROM_BOTTOM = 80;

// ─── ITEM DEFINITIONS ────────────────────────────────────────────────────────
interface ItemDef {
  id: string;
  emoji: string;
  points: number;
  baseSpeed: number;
  label: string;
  rare?: boolean;
  good: boolean;
}

const ITEM_DEFS: ItemDef[] = [
  { id: 'turkey',        emoji: '🦃',   points:  3, baseSpeed: 2.8, label: 'Turkey!',         good: true  },
  { id: 'pie',           emoji: '🥧',   points:  2, baseSpeed: 1.8, label: 'Pie!',             good: true  },
  { id: 'corn',          emoji: '🌽',   points:  1, baseSpeed: 2.5, label: 'Corn',             good: true  },
  { id: 'cranberry',     emoji: '🫐',   points:  1, baseSpeed: 3.5, label: 'Cranberry',        good: true  },
  { id: 'leaf',          emoji: '🍁',   points:  1, baseSpeed: 1.5, label: 'Leaf',             good: true  },
  { id: 'brussels',      emoji: '🥦',   points: -1, baseSpeed: 2.5, label: 'Brussels 🤢',      good: false },
  { id: 'fruitcake',     emoji: '🎂',   points: -2, baseSpeed: 3.8, label: 'Fruitcake!',       good: false },
  { id: 'bone',          emoji: '🦴',   points: -2, baseSpeed: 3.8, label: 'Leftovers 🦴',     good: false },
  { id: 'golden_turkey', emoji: '✨🦃', points:  5, baseSpeed: 4.5, label: 'GOLDEN TURKEY!',   good: true,  rare: true },
];

const GOOD_ITEMS     = ITEM_DEFS.filter(i =>  i.good && !i.rare);
const ALL_GOOD_ITEMS = ITEM_DEFS.filter(i =>  i.good);
const BAD_ITEMS      = ITEM_DEFS.filter(i => !i.good);

function pickItemDef(cornucopiaActive: boolean): ItemDef {
  if (cornucopiaActive) {
    return ALL_GOOD_ITEMS[Math.floor(Math.random() * ALL_GOOD_ITEMS.length)];
  }
  const r = Math.random();
  if (r < 0.03) return ITEM_DEFS.find(i => i.id === 'golden_turkey')!;
  if (r < 0.63) return GOOD_ITEMS[Math.floor(Math.random() * GOOD_ITEMS.length)];
  return BAD_ITEMS[Math.floor(Math.random() * BAD_ITEMS.length)];
}

// ─── BEHAVIORAL SIGNALS ──────────────────────────────────────────────────────
interface Signals {
  score: number;
  turkeyCaught: number;
  negativeItemsCaught: number;
  goldenTurkeyCaught: number;
  maxStreak: number;
  streakCurrent: number;
  cornucopiaTriggers: number;
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  if (sig.score >= 40 && sig.negativeItemsCaught === 0) return 'Harvest Champion 🏆';
  if (sig.turkeyCaught >= 8)                            return 'Head of the Table 🦃';
  if (sig.goldenTurkeyCaught >= 2)                      return 'Golden Gatherer ✨';
  if (sig.negativeItemsCaught >= 5)                     return 'Picky Eater 🤢';
  if (sig.score >= 20)                                  return 'Grateful Guest 🙏';
  return 'Still Loading Plate 🍽️';
}

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface FallingItem {
  uid: number;
  defId: string;
  emoji: string;
  points: number;
  label: string;
  good: boolean;
  x: number;
  y: number;
  speed: number;
  rotation: number;
  rotSpeed: number;
  driftAmp: number;   // horizontal drift amplitude (leaf)
  driftPhase: number; // phase offset for sin-drift
  size: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  color: string;
  size: number;
}

interface ScoreFloat {
  x: number; y: number;
  text: string;
  life: number;
  color: string;
}

interface BgLeaf {
  x: number; y: number;
  rotation: number;
  rotSpeed: number;
  speed: number;
  driftAmp: number;
  driftPhase: number;
  size: number;
  alpha: number;
  emoji: string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── SPRITE CACHE ─────────────────────────────────────────────────────────────
const _hcSpriteCache = new Map<string, HTMLImageElement>();
function hcLoadSprite(src: string): HTMLImageElement {
  if (_hcSpriteCache.has(src)) return _hcSpriteCache.get(src)!;
  const img = new Image();
  img.src = src;
  _hcSpriteCache.set(src, img);
  return img;
}

// Map item defId → sprite path
const HC_SPRITES: Record<string, string> = {
  turkey:        '/sprites/harvest-catch/turkey.png',
  golden_turkey: '/sprites/harvest-catch/turkey.png',
  corn:          '/sprites/harvest-catch/corn.png',
  cranberry:     '/sprites/harvest-catch/cranberry.png',
  leaf:          '/sprites/harvest-catch/leaf.svg',
  brussels:      '/sprites/harvest-catch/brussels.png',
  fruitcake:     '/sprites/harvest-catch/fruitcake.png',
  bone:          '/sprites/harvest-catch/bone.svg',
  pumpkin:       '/sprites/harvest-catch/pumpkin.png',
};

// Pre-warm sprites
if (typeof window !== 'undefined') {
  Object.values(HC_SPRITES).forEach(hcLoadSprite);
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  basketX: number;
  tiltX: number;
  items: FallingItem[];
  particles: Particle[];
  scoreFloats: ScoreFloat[];
  bgLeaves: BgLeaf[];
  spawnTimer: number;
  spawnInterval: number;
  redFlashUntil: number;
  scoreShakeUntil: number;
  cornSeq: number;          // 0=none, 1=turkey caught, 2=+pie, triggers on corn
  cornucopiaUntil: number;  // ms timestamp when bonus ends
  cornucopiaOverlayUntil: number;
  accentColor: string;
  nextUid: number;
  // Change-guards for rAF → React setState syncing
  lastScoreDisplayed: number;
  lastStreakDisplayed: number;
}

// ─── PURE HELPERS (outside component to avoid stale closures) ────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawBasket(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
  accent: string,
) {
  const hw = w / 2;

  // ── Main basket body (trapezoid shape) ────────────────────────────────────
  ctx.shadowBlur = 12;
  ctx.shadowColor = accent + '66';

  ctx.fillStyle = '#7c3a1a';
  ctx.beginPath();
  ctx.moveTo(cx - hw, y);
  ctx.lineTo(cx + hw, y);
  ctx.lineTo(cx + hw * 0.75, y + 28);
  ctx.lineTo(cx - hw * 0.75, y + 28);
  ctx.closePath();
  ctx.fill();

  // ── Weave stripes ─────────────────────────────────────────────────────────
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#5a2910';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const ly = y + 7 + i * 8;
    const lhw = hw - i * 3;
    ctx.beginPath();
    ctx.moveTo(cx - lhw, ly);
    ctx.lineTo(cx + lhw, ly);
    ctx.stroke();
  }

  // ── Cornucopia horn on right ──────────────────────────────────────────────
  ctx.fillStyle = '#9a4520';
  ctx.beginPath();
  ctx.moveTo(cx + hw, y + 6);
  ctx.quadraticCurveTo(cx + hw + 22, y + 16, cx + hw + 16, y + 26);
  ctx.quadraticCurveTo(cx + hw + 8, y + 30, cx + hw, y + 28);
  ctx.closePath();
  ctx.fill();

  // ── Top rim (accent color) ────────────────────────────────────────────────
  ctx.shadowBlur = 10;
  ctx.shadowColor = accent;
  ctx.fillStyle = accent;
  roundRect(ctx, cx - hw - 2, y - 5, w + 4, 9, 4);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function spawnParticles(
  particles: Particle[],
  x: number,
  y: number,
  positive: boolean,
) {
  const harvestPalette = ['#d97706', '#b45309', '#f59e0b', '#92400e', '#fbbf24'];
  const count = positive ? 14 : 8;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = positive ? 2 + Math.random() * 3.5 : 1 + Math.random() * 2;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (positive ? 2.5 : 0.5),
      life: 1,
      color: positive
        ? harvestPalette[Math.floor(Math.random() * harvestPalette.length)]
        : '#ef4444',
      size: positive ? 4 + Math.random() * 4 : 3 + Math.random() * 3,
    });
  }
}

function makeBgLeaves(count: number, canvasH: number): BgLeaf[] {
  const emojis = ['🍂', '🍁', '🌿'];
  return Array.from({ length: count }, (_, i) => ({
    x: Math.random() * 400,
    y: (Math.random() * canvasH * 1.5) - canvasH * 0.3,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.035,
    speed: 0.35 + Math.random() * 0.55,
    driftAmp: 0.4 + Math.random() * 0.5,
    driftPhase: Math.random() * Math.PI * 2,
    size: 14 + Math.random() * 10,
    alpha: 0.1 + Math.random() * 0.15,
    emoji: emojis[i % emojis.length],
  }));
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function HarvestCatch() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltRef      = useRef<ReturnType<typeof createTiltController> | null>(null);
  const touchActiveRef = useRef(false);
  const touchBasketXRef = useRef<number | null>(null);

  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: {
      score: 0, turkeyCaught: 0, negativeItemsCaught: 0,
      goldenTurkeyCaught: 0, maxStreak: 0, streakCurrent: 0, cornucopiaTriggers: 0,
    },
    basketX: 200,
    tiltX: 0,
    items: [],
    particles: [],
    scoreFloats: [],
    bgLeaves: [],
    spawnTimer: 0,
    spawnInterval: 70,
    redFlashUntil: 0,
    scoreShakeUntil: 0,
    cornSeq: 0,
    cornucopiaUntil: 0,
    cornucopiaOverlayUntil: 0,
    accentColor: ACCENT,
    nextUid: 0,
    lastScoreDisplayed: 0,
    lastStreakDisplayed: 0,
  });

  const phaseRef                        = useRef<Phase>('start');
  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
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
  const [touchFallback, setTouchFallback] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── SPAWN ITEM ──────────────────────────────────────────────────────────────

  const spawnItem = useCallback((canvas: HTMLCanvasElement) => {
    const s = stateRef.current;
    const cornActive = Date.now() < s.cornucopiaUntil;
    const def = pickItemDef(cornActive);
    const margin = 30;
    const item: FallingItem = {
      uid: s.nextUid++,
      defId: def.id,
      emoji: def.emoji,
      points: def.points,
      label: def.label,
      good: def.good,
      x: margin + Math.random() * (canvas.offsetWidth - margin * 2),
      y: -35,
      speed: def.baseSpeed * (0.8 + Math.random() * 0.4),
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * (def.id === 'leaf' ? 0.04 : 0.07),
      driftAmp: def.id === 'leaf' ? 0.7 + Math.random() * 0.5 : 0,
      driftPhase: Math.random() * Math.PI * 2,
      size: def.id === 'golden_turkey' ? 36 : 30,
    };
    s.items.push(item);
  }, []);

  // ─── END GAME ────────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (tiltRef.current) { tiltRef.current.stop(); tiltRef.current = null; }
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

  // ─── GAME LOOP ────────────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ⚠️ Critical: size canvas to actual DOM dimensions.
    // The canvas resize useEffect may have run before the canvas was in the DOM (phase='start'),
    // so we must size it here when the canvas is guaranteed to be present.
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    const ctx2 = canvas.getContext('2d');
    if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Reset state
    s.running = true;
    s.timeLeft = DURATION;
    s.sig = {
      score: 0, turkeyCaught: 0, negativeItemsCaught: 0,
      goldenTurkeyCaught: 0, maxStreak: 0, streakCurrent: 0, cornucopiaTriggers: 0,
    };
    s.basketX = canvas.offsetWidth / 2;
    s.tiltX = 0;
    s.items = [];
    s.particles = [];
    s.scoreFloats = [];
    s.bgLeaves = makeBgLeaves(18, canvas.offsetHeight);
    s.spawnTimer = 0;
    s.spawnInterval = 70;
    s.redFlashUntil = 0;
    s.scoreShakeUntil = 0;
    s.cornSeq = 0;
    s.cornucopiaUntil = 0;
    s.cornucopiaOverlayUntil = 0;
    s.nextUid = 0;
    s.lastScoreDisplayed = 0;
    s.lastStreakDisplayed = 0;
    touchBasketXRef.current = null;

    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    phaseRef.current = 'playing';
    setPhase('playing');

    stopMusicRef.current = startMusic('calm');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) {
        sfx.success(); // Thanksgiving harvest game ends in celebration, not failure
        haptic([300]);
        endGame();
      }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      const now = Date.now();

      // ── Move basket ─────────────────────────────────────────────────────────
      if (touchActiveRef.current && touchBasketXRef.current !== null) {
        // Touch override — direct position
        s.basketX = touchBasketXRef.current;
      } else {
        // Tilt control
        const tilt = tiltRef.current ? tiltRef.current.getValues() : { x: 0, y: 0 };
        s.tiltX = tilt.x;
        s.basketX += s.tiltX * 6 * (W / 400);
      }
      const hw = BASKET_WIDTH / 2;
      s.basketX = Math.max(hw + 12, Math.min(W - hw - 12, s.basketX));

      // ── Spawn items ─────────────────────────────────────────────────────────
      s.spawnTimer++;
      if (s.spawnTimer >= s.spawnInterval) {
        s.spawnTimer = 0;
        spawnItem(canvas);
        const elapsed = DURATION - s.timeLeft;
        s.spawnInterval = Math.max(32, 70 - elapsed * 0.6);
      }

      // ── Update background leaves ────────────────────────────────────────────
      for (const leaf of s.bgLeaves) {
        leaf.y += leaf.speed;
        leaf.rotation += leaf.rotSpeed;
        leaf.x += Math.sin(leaf.y * 0.015 + leaf.driftPhase) * leaf.driftAmp;
        if (leaf.y > H + 50) {
          leaf.y = -50;
          leaf.x = Math.random() * W;
        }
      }

      // ── Background — rich autumn harvest gradient ────────────────────────────
      const hcBg = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.65, Math.max(W, H) * 0.9);
      hcBg.addColorStop(0,   '#1a0d00');
      hcBg.addColorStop(0.55, '#0e0800');
      hcBg.addColorStop(1,   '#060400');
      ctx.fillStyle = hcBg;
      ctx.fillRect(0, 0, W, H);

      // Warm amber vignette edges
      const vg = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.08, W / 2, H * 0.45, H * 0.85);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(130, 50, 0, 0.38)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // ── Draw background leaves ───────────────────────────────────────────────
      ctx.save();
      for (const leaf of s.bgLeaves) {
        ctx.save();
        ctx.globalAlpha = leaf.alpha;
        ctx.translate(leaf.x, leaf.y);
        ctx.rotate(leaf.rotation);
        ctx.font = `${leaf.size}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(leaf.emoji, 0, 0);
        ctx.restore();
      }
      ctx.restore();

      // ── Catch zone & falling items ────────────────────────────────────────
      const catchY = H - CATCH_Y_FROM_BOTTOM;
      const removeUids = new Set<number>();

      for (const item of s.items) {
        item.y += item.speed;
        item.rotation += item.rotSpeed;

        // Leaf drift
        if (item.driftAmp > 0) {
          item.x += Math.sin(now * 0.002 + item.driftPhase) * item.driftAmp;
        }

        // ── Catch detection ─────────────────────────────────────────────────
        if (item.y >= catchY && !removeUids.has(item.uid)) {
          if (item.x >= s.basketX - hw && item.x <= s.basketX + hw) {
            // CAUGHT
            removeUids.add(item.uid);

            if (item.good) {
              s.sig.score += item.points;
              s.sig.streakCurrent++;
              if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;

              if (item.defId === 'turkey')        s.sig.turkeyCaught++;
              if (item.defId === 'golden_turkey') s.sig.goldenTurkeyCaught++;

              // ── Cornucopia sequence ─────────────────────────────────────
              if (item.defId === 'turkey'  && s.cornSeq === 0) s.cornSeq = 1;
              else if (item.defId === 'pie'   && s.cornSeq === 1) s.cornSeq = 2;
              else if (item.defId === 'corn'  && s.cornSeq === 2) {
                s.cornSeq = 0;
                s.sig.cornucopiaTriggers++;
                s.sig.score += 5;
                s.cornucopiaUntil = now + 5000;
                s.cornucopiaOverlayUntil = now + 2200;
                sfx.defuse();
                haptic([30, 50, 30, 50, 100]);
              }

              spawnParticles(s.particles, item.x, catchY, true);

              if (item.defId === 'turkey' || item.defId === 'golden_turkey') {
                sfx.success();
              } else {
                sfx.collect();
              }
              haptic([30]);
            } else {
              // Negative catch
              s.sig.score += item.points;
              s.sig.negativeItemsCaught++;
              s.sig.streakCurrent = 0;
              s.redFlashUntil = now + 450;
              s.scoreShakeUntil = now + 550;
              spawnParticles(s.particles, item.x, catchY, false);
              sfx.collision();
              haptic([200]);
            }

            // Change-guarded: only re-render when values actually change
            if (s.sig.score !== s.lastScoreDisplayed) {
              s.lastScoreDisplayed = s.sig.score;
              setScoreDisplay(s.sig.score);
            }
            if (s.sig.streakCurrent !== s.lastStreakDisplayed) {
              s.lastStreakDisplayed = s.sig.streakCurrent;
              setStreakDisplay(s.sig.streakCurrent);
            }

            // Score float
            s.scoreFloats.push({
              x: item.x,
              y: catchY - 10,
              text: `${item.good ? '+' : ''}${item.points} ${item.defId === 'golden_turkey' ? '✨🦃' : item.emoji}`,
              life: 1,
              color: item.good ? '#fbbf24' : '#ef4444',
            });
          }
        }

        // Remove off-screen
        if (item.y > H + 50) removeUids.add(item.uid);
      }

      if (removeUids.size > 0) {
        s.items = s.items.filter(i => !removeUids.has(i.uid));
      }

      // ── Draw falling items ───────────────────────────────────────────────
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const item of s.items) {
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate(item.rotation);
        if (item.defId === 'golden_turkey') {
          ctx.shadowBlur = 22;
          ctx.shadowColor = '#fbbf24';
        }
        const spriteSrc = HC_SPRITES[item.defId];
        const spriteImg = spriteSrc ? hcLoadSprite(spriteSrc) : null;
        if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
          const half = item.size / 2;
          ctx.drawImage(spriteImg, -half, -half, item.size, item.size);
        } else {
          ctx.font = `${item.size}px serif`;
          ctx.fillText(item.emoji, 0, 0);
        }
        ctx.shadowBlur = 0;
        ctx.restore();
      }
      ctx.restore();

      // ── Draw basket ──────────────────────────────────────────────────────
      drawBasket(ctx, s.basketX, catchY, BASKET_WIDTH, s.accentColor);

      // ── Particles ────────────────────────────────────────────────────────
      ctx.save();
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18;
        p.life -= 0.038;
        if (p.life <= 0) { s.particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // ── Score floats ─────────────────────────────────────────────────────
      ctx.save();
      for (let i = s.scoreFloats.length - 1; i >= 0; i--) {
        const f = s.scoreFloats[i];
        f.y -= 1.6;
        f.life -= 0.022;
        if (f.life <= 0) { s.scoreFloats.splice(i, 1); continue; }
        ctx.globalAlpha = f.life;
        ctx.font = 'bold 20px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 8;
        ctx.shadowColor = f.color;
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // ── Score shake: red tint at top of canvas (near HUD) on bad catch ──────
      if (now < s.scoreShakeUntil) {
        const t = (s.scoreShakeUntil - now) / 550;
        ctx.fillStyle = `rgba(239,68,68,${t * 0.18})`;
        ctx.fillRect(0, 0, W, 88); // top strip only — aligns with HUD
      }

      // ── Red flash overlay ─────────────────────────────────────────────────
      if (now < s.redFlashUntil) {
        const t = (s.redFlashUntil - now) / 450;
        ctx.fillStyle = `rgba(239,68,68,${t * 0.28})`;
        ctx.fillRect(0, 0, W, H);
      }

      // ── Cornucopia overlay (big reveal) ───────────────────────────────────
      if (now < s.cornucopiaOverlayUntil) {
        const t = (s.cornucopiaOverlayUntil - now) / 2200;
        const pulse = Math.sin(now * 0.012) * 0.5 + 0.5;

        // Golden shimmer
        ctx.fillStyle = `rgba(251,191,36,${t * 0.14 * (0.6 + pulse * 0.4)})`;
        ctx.fillRect(0, 0, W, H);

        // Text banner
        const alpha = Math.min(1, t * 2.5);
        const scale = 1 + (1 - t) * 0.25;
        ctx.save();
        ctx.translate(W / 2, H / 2 - 50);
        ctx.scale(scale, scale);
        ctx.font = 'bold 34px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#fbbf24';
        ctx.fillStyle = `rgba(255,220,50,${alpha})`;
        ctx.fillText('CORNUCOPIA! 🌽', 0, 0);
        ctx.font = 'bold 20px serif';
        ctx.fillStyle = `rgba(255,240,180,${alpha * 0.85})`;
        ctx.fillText('+5 bonus • Good vibes only!', 0, 44);
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // ── Cornucopia active banner (subtle, after main overlay) ─────────────
      if (now >= s.cornucopiaOverlayUntil && now < s.cornucopiaUntil) {
        const remaining = (s.cornucopiaUntil - now) / 5000;
        ctx.fillStyle = `rgba(251,191,36,${remaining * 0.07})`;
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        ctx.font = '13px serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255,200,50,0.75)`;
        ctx.fillText('🌽 CORNUCOPIA BONUS ACTIVE!', W / 2, 72);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnItem]);

  // ─── CANVAS RESIZE LISTENER ───────────────────────────────────────────────
  // ⚠️ Do NOT capture canvasRef.current here — canvas may not be in DOM when
  // this effect runs (phase='start'). Canvas is sized explicitly in startLoop.
  // This effect only registers the resize listener for mid-game window resizes.

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (stateRef.current.running) {
        stateRef.current.bgLeaves = makeBgLeaves(18, canvas.offsetHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ─── TOUCH FALLBACK ───────────────────────────────────────────────────────
  // ⚠️ Keep [phase] dependency: canvas enters DOM on phase='countdown', so the
  // effect must re-run then to find the canvas. Use phaseRef inside handlers
  // (not the closure-captured `phase`) to avoid stale closure issues.

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      if (phaseRef.current !== 'playing') return;
      touchActiveRef.current = true;
      const rect = canvas.getBoundingClientRect();
      touchBasketXRef.current = e.touches[0].clientX - rect.left;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchActiveRef.current || phaseRef.current !== 'playing') return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      touchBasketXRef.current = e.touches[0].clientX - rect.left;
    };
    const onTouchEnd = () => {
      touchActiveRef.current = false;
      touchBasketXRef.current = null;
    };

    canvas.addEventListener('touchstart',  onTouchStart, { passive: true });
    canvas.addEventListener('touchmove',   onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',    onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart',  onTouchStart);
      canvas.removeEventListener('touchmove',   onTouchMove);
      canvas.removeEventListener('touchend',    onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [phase]); // ← intentional: re-run when canvas enters DOM on phase change

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (tiltRef.current) tiltRef.current.stop();
    };
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    await initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);

    const controller = createTiltController(
      (x: number) => { stateRef.current.tiltX = x; },
      { sensitivity: 0.9, smoothing: 0.45 },
    );
    const granted = await controller.start();
    if (!granted) setTouchFallback(true);
    tiltRef.current = controller;

    phaseRef.current = 'countdown';
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    phaseRef.current = 'start';
    setPhase('start');
    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────

  function buildInsights(sig: Signals) {
    return [
      {
        label: 'Harvest Score',
        value: String(sig.score),
        color: ACCENT,
      },
      {
        label: 'Turkeys Caught',
        value: String(sig.turkeyCaught),
        color: sig.turkeyCaught >= 5 ? '#4ade80' : 'var(--color-text)',
      },
      {
        label: 'Bad Food Caught',
        value: String(sig.negativeItemsCaught),
        color: sig.negativeItemsCaught === 0
          ? '#4ade80'
          : sig.negativeItemsCaught >= 5
            ? '#ef4444'
            : '#facc15',
      },
      {
        label: 'Best Streak',
        value: `×${sig.maxStreak}`,
        color: ACCENT,
      },
    ];
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="harvest-catch"
          steps={[{ icon: "🍎", title: "Catch the harvest", body: "Tilt your device to move the basket." }, { icon: "⭐", title: "Rare items = more", body: "Golden items are worth extra — don't miss them." }, { icon: "🚫", title: "Avoid rocks", body: "Catching rocks costs you a life." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>

      {/* ── Start Screen ─────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Allow Motion & Play"
          ctaTextColor="#000"
          sensorNote="Tilt your phone left/right to steer the basket"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #1a0d00 0%, #0e0700 55%, #060400 100%)"
        />
      )}

      {/* ── Countdown ───────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown
          onComplete={handleCountdownDone}
          accentColor={theme.colors.accent ?? ACCENT}
        />
      )}

      {/* ── Playing ─────────────────────────────────────────────────────── */}
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
              accentColor={theme.colors.accent ?? ACCENT}
              items={[
                { label: 'TIME',       value: timeLeft,      danger: timeLeft <= 10 },
                { label: 'HARVEST 🍁', value: scoreDisplay },
                { label: 'STREAK 🦃',  value: streakDisplay },
              ]}
            />
          )}
          {touchFallback && phase === 'playing' && (
            <div
              style={{
                position: 'absolute',
                bottom: 130,
                left: 0,
                right: 0,
                textAlign: 'center',
                color: 'rgba(255,200,100,0.55)',
                fontSize: 12,
                pointerEvents: 'none',
              }}
            >
              Touch &amp; drag to move the basket
            </div>
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



      {/* ── End Screen ──────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen
            gameId={GAME_ID}
            title={getPersonality(finalSig)}
            emoji={GAME_EMOJI}
            score={String(finalSig.score)}
            personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)}
            accentColor={theme.colors.accent ?? ACCENT}
            onPlayAgain={handlePlayAgain}
            didWin={finalSig.score >= 20}
          />
          <WebhookEmitter
            theme={theme}
            sig={finalSig}
            personality={getPersonality(finalSig)}
            player={playerSessionRef.current}
          />
        </>
      )}
      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streakDisplay} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────

function WebhookEmitter({
  theme,
  sig,
  personality,
  player,
}: {
  theme: ReturnType<typeof useBrandTheme>;
  sig: Signals;
  personality: string;
  player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    postWebhook(theme, GAME_ID, {
      personality,
      score:               sig.score,
      turkeyCaught:        sig.turkeyCaught,
      negativeItemsCaught: sig.negativeItemsCaught,
      goldenTurkeyCaught:  sig.goldenTurkeyCaught,
      maxStreak:           sig.maxStreak,
      cornucopiaTriggers:  sig.cornucopiaTriggers,
    }, player);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
