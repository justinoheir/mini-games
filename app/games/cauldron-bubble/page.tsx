'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, startMusic } from '@/lib/audio';
import { hapticImpact, hapticVictory, hapticFail } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import SwipeInstructions from '@/components/SwipeInstructions';

// ─── SPRITE CACHE ─────────────────────────────────────────────────────────────
const _spriteCache = new Map<string, HTMLImageElement>();
function _loadSprite(src: string): HTMLImageElement {
  if (_spriteCache.has(src)) return _spriteCache.get(src)!;
  const img = new Image();
  img.src = src;
  _spriteCache.set(src, img);
  return img;
}
if (typeof window !== 'undefined') {
  _loadSprite('/sprites/cauldron-bubble/bubble.svg');
  _loadSprite('/sprites/cauldron-bubble/cauldron.svg');
}

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────

const GAME_ID      = 'cauldron-bubble';
const ACCENT       = '#22c55e';
const DURATION     = 45;
const GAME_EMOJI   = '🧪';
const GAME_TITLE   = 'Cauldron Bubble';
const GAME_TAGLINE = 'Blow to bubble. Too quiet = dead. Too loud = BOOM.';

// Zone thresholds (0–100)
const ZONE_BREW_LOW_DEFAULT  = 26;
const ZONE_BREW_HIGH_DEFAULT = 70;
const ZONE_DANGER_HIGH       = 90;
// Witch's Curse narrows brew zone
const ZONE_BREW_LOW_CURSE    = 35;
const ZONE_BREW_HIGH_CURSE   = 60;

// Chaos event timing (seconds elapsed)
const WITCH_CURSE_TIME     = 22;
const WITCH_CURSE_DURATION = 5;

// Explosion debounce
const EXPLOSION_COOLDOWN_MS = 700;

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Zone = 'dead' | 'brew' | 'danger' | 'explosion';
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Signals {
  score: number;
  explosions: number;
  deadSeconds: number;
  avgVolumePct: number;
  chaosEventsSurvived: number;
  longestBrewStreak: number;
  brewStreakCurrent: number;
  volumeSamples: number[];
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  alpha: number;
  color: string;
}

interface Bat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  wingPhase: number;
  wingDir: number;
}

interface GameState {
  running: boolean;
  timeLeft: number;
  elapsedSec: number;
  sig: Signals;
  volumePct: number;
  zone: Zone;
  prevZone: Zone;
  brewLow: number;
  brewHigh: number;
  witchCurseActive: boolean;
  witchCurseFired: boolean;
  witchCurseEndSec: number;
  shakeFrames: number;
  flashFrames: number;
  flashColor: string;
  bubbles: Bubble[];
  bats: Bat[];
  lastExplosionMs: number;
  accentColor: string;
  useTouchFallback: boolean;
  touchVolume: number;
}

// ─── MODULE-LEVEL DRAWING HELPERS ────────────────────────────────────────────

function zoneColor(zone: Zone): string {
  switch (zone) {
    case 'brew':      return '#22c55e';
    case 'danger':    return '#f97316';
    case 'explosion': return '#ef4444';
    default:          return '#444455';
  }
}

function liquidBodyColor(zone: Zone): string {
  switch (zone) {
    case 'brew':      return '#166534';
    case 'danger':    return '#7c2d12';
    case 'explosion': return '#7f1d1d';
    default:          return '#2a2a3a';
  }
}

/** Build the cauldron body Path2D (call once per frame — cheap path object). */
function makeCauldronPath(cx: number, cy: number, r: number): Path2D {
  const rimY      = cy - r * 0.5;
  const bottomY   = cy + r * 0.7;
  const rimRX     = r * 1.1;
  const wideRX    = r * 1.18;
  const bottomRX  = r * 0.55;
  const midY      = (rimY + bottomY) / 2 + r * 0.05;

  const p = new Path2D();
  p.moveTo(cx - rimRX, rimY);
  p.bezierCurveTo(cx - wideRX, midY, cx - bottomRX, bottomY - r * 0.05, cx - bottomRX, bottomY);
  p.quadraticCurveTo(cx, bottomY + r * 0.18, cx + bottomRX, bottomY);
  p.bezierCurveTo(cx + bottomRX, bottomY - r * 0.05, cx + wideRX, midY, cx + rimRX, rimY);
  p.closePath();
  return p;
}

function getCauldronLiquidY(cy: number, r: number, volumePct: number): number {
  const rimY        = cy - r * 0.5;
  const bottomY     = cy + r * 0.7;
  const liquidMaxY  = rimY + r * 0.08;
  const liquidMinY  = bottomY - r * 0.06;
  return liquidMinY - (volumePct / 100) * (liquidMinY - liquidMaxY);
}

function drawMoon(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const mx = W * 0.78;
  const my = H * 0.14;
  const mr = Math.min(W, H) * 0.1;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.shadowBlur   = 40;
  ctx.shadowColor  = '#fffde7';
  ctx.fillStyle    = '#fffde7';
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.07;
  ctx.beginPath();
  ctx.arc(mx, my, mr * 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBat(ctx: CanvasRenderingContext2D, bat: Bat): void {
  ctx.save();
  ctx.translate(bat.x, bat.y);
  const flap = Math.sin(bat.wingPhase) * 8;
  const wSpan = 20;

  // Left wing
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-7, -flap, -wSpan, flap * 0.4, -wSpan, 5);
  ctx.bezierCurveTo(-wSpan + 6, 3, -9, flap * 0.3, 0, 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(50,0,70,0.75)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(100,0,140,0.5)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Right wing (mirror)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(7, -flap, wSpan, flap * 0.4, wSpan, 5);
  ctx.bezierCurveTo(wSpan - 6, 3, 9, flap * 0.3, 0, 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Body
  ctx.fillStyle = '#1a0022';
  ctx.beginPath();
  ctx.ellipse(0, 1, 5, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = '#1a0022';
  ctx.beginPath();
  ctx.moveTo(-3, -3); ctx.lineTo(-5, -8); ctx.lineTo(-1, -3); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(3, -3); ctx.lineTo(5, -8); ctx.lineTo(1, -3); ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawCauldron(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  volumePct: number,
  zone: Zone,
): void {
  const rimY      = cy - r * 0.5;
  const bottomY   = cy + r * 0.7;
  const rimRX     = r * 1.1;
  const bottomRX  = r * 0.55;
  const wideRX    = r * 1.18;
  const rimColor  = zoneColor(zone);

  // ── Legs ────────────────────────────────────────────────────────────
  ctx.fillStyle = '#2a2a2a';
  ctx.save();
  ctx.translate(cx - bottomRX * 0.55, bottomY);
  ctx.rotate(-0.28);
  ctx.beginPath();
  ctx.roundRect(-5, 0, 10, 26, 3);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx + bottomRX * 0.55, bottomY);
  ctx.rotate(0.28);
  ctx.beginPath();
  ctx.roundRect(-5, 0, 10, 26, 3);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, bottomY);
  ctx.beginPath();
  ctx.roundRect(-5, 0, 10, 24, 3);
  ctx.fill();
  ctx.restore();

  // ── Cauldron body ────────────────────────────────────────────────────
  const bodyPath = makeCauldronPath(cx, cy, r);

  ctx.save();
  ctx.fillStyle = '#0d0d0d';
  ctx.shadowBlur  = 18;
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.fill(bodyPath);
  ctx.restore();

  // ── Liquid fill (clipped) ────────────────────────────────────────────
  const liquidTopY = getCauldronLiquidY(cy, r, volumePct);

  ctx.save();
  ctx.clip(bodyPath);

  const lColor = liquidBodyColor(zone);
  const grad = ctx.createLinearGradient(cx, liquidTopY, cx, bottomY);
  grad.addColorStop(0, lColor + 'cc');
  grad.addColorStop(1, lColor + 'ff');
  ctx.fillStyle = grad;
  ctx.fillRect(cx - wideRX, liquidTopY, wideRX * 2, bottomY - liquidTopY + r * 0.25);

  // Surface shimmer
  ctx.strokeStyle = zoneColor(zone === 'dead' ? 'dead' : zone);
  ctx.lineWidth   = 1.5;
  ctx.globalAlpha = zone === 'dead' ? 0.2 : 0.55;
  ctx.beginPath();
  ctx.moveTo(cx - wideRX, liquidTopY);
  ctx.lineTo(cx + wideRX, liquidTopY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();

  // ── Cauldron body outline (subtle) ────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth   = 2;
  ctx.stroke(bodyPath);
  ctx.restore();

  // ── Handles ───────────────────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = '#333';
  ctx.lineWidth   = 8;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.arc(cx - rimRX + r * 0.12, rimY, r * 0.2, Math.PI * 0.6, Math.PI * 1.75);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + rimRX - r * 0.12, rimY, r * 0.2, -Math.PI * 0.75, Math.PI * 0.4);
  ctx.stroke();
  ctx.restore();

  // ── Rim glow ──────────────────────────────────────────────────────────
  ctx.save();
  ctx.shadowBlur   = 22;
  ctx.shadowColor  = rimColor;
  ctx.strokeStyle  = rimColor;
  ctx.lineWidth    = 7;
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rimRX, r * 0.13, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Rim fill
  ctx.shadowBlur = 0;
  ctx.fillStyle  = '#1c1c1c';
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rimRX, r * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  if (sig.score >= 35 && sig.explosions === 0) return 'Master Witch 🧙';
  if (sig.score >= 30 && sig.deadSeconds <= 3) return 'Potion Master 🧪';
  if (sig.longestBrewStreak >= 20)             return 'Cauldron Keeper 🌙';
  if (sig.explosions >= 3)                     return 'Chaos Brewer 🦇';
  if (sig.score >= 15)                         return 'Apprentice Witch 🌱';
  return 'The Muggle 😅';
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function CauldronBubble() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  // Mic refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const dataArrRef  = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const stateRef = useRef<GameState>({
    running:           false,
    timeLeft:          DURATION,
    elapsedSec:        0,
    sig: {
      score: 0, explosions: 0, deadSeconds: 0,
      avgVolumePct: 0, chaosEventsSurvived: 0,
      longestBrewStreak: 0, brewStreakCurrent: 0,
      volumeSamples: [],
    },
    volumePct:          0,
    zone:               'dead',
    prevZone:           'dead',
    brewLow:            ZONE_BREW_LOW_DEFAULT,
    brewHigh:           ZONE_BREW_HIGH_DEFAULT,
    witchCurseActive:   false,
    witchCurseFired:    false,
    witchCurseEndSec:   0,
    shakeFrames:        0,
    flashFrames:        0,
    flashColor:         '#ff2200',
    bubbles:            [],
    bats:               [],
    lastExplosionMs:    0,
    accentColor:        ACCENT,
    useTouchFallback:   false,
    touchVolume:        0,
  });

  const [phase, setPhase]                 = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]           = useState(DURATION);
  const [scoreDisplay, setScoreDisplay]   = useState(0);
  const [volumeDisplay, setVolumeDisplay] = useState(0);
  const [finalSig, setFinalSig]           = useState<Signals | null>(null);
  const [chaosLabel, setChaosLabel]       = useState('');
  const [micDenied, setMicDenied]         = useState(false);

  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ── Read mic volume ─────────────────────────────────────────────────────────

  const getVolumePct = useCallback((): number => {
    const s = stateRef.current;
    if (s.useTouchFallback) return s.touchVolume;
    const analyser = analyserRef.current;
    const data     = dataArrRef.current;
    if (!analyser || !data) return 0;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    return Math.min(100, (rms / 128) * 100);
  }, []);

  // ── Determine zone ──────────────────────────────────────────────────────────

  const calcZone = useCallback((vol: number, s: GameState): Zone => {
    if (vol <= 25) return 'dead';
    if (vol >= s.brewLow && vol <= s.brewHigh) return 'brew';
    if (vol <= ZONE_DANGER_HIGH) return 'danger';
    return 'explosion';
  }, []);

  // ── End game ────────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }

    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current  = null;
    audioCtxRef.current = null;
    analyserRef.current = null;

    const samples = s.sig.volumeSamples;
    if (samples.length > 0) {
      s.sig.avgVolumePct = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
    }
    if (s.witchCurseFired) s.sig.chaosEventsSurvived = 1;

    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  // ── Spawn bats ──────────────────────────────────────────────────────────────

  const spawnBats = useCallback((W: number, H: number) => {
    stateRef.current.bats = Array.from({ length: 3 }, (_, i) => ({
      x:         W * 0.15 + (W * 0.7 * i) / 2,
      y:         H * 0.08 + Math.random() * H * 0.15,
      vx:        (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5),
      vy:        (Math.random() - 0.5) * 0.3,
      wingPhase: Math.random() * Math.PI * 2,
      wingDir:   1,
    }));
  }, []);

  // ── Game loop ───────────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Reset state
    s.running           = true;
    s.timeLeft          = DURATION;
    s.elapsedSec        = 0;
    s.sig               = {
      score: 0, explosions: 0, deadSeconds: 0,
      avgVolumePct: 0, chaosEventsSurvived: 0,
      longestBrewStreak: 0, brewStreakCurrent: 0,
      volumeSamples: [],
    };
    s.volumePct         = 0;
    s.zone              = 'dead';
    s.prevZone          = 'dead';
    s.brewLow           = ZONE_BREW_LOW_DEFAULT;
    s.brewHigh          = ZONE_BREW_HIGH_DEFAULT;
    s.witchCurseActive  = false;
    s.witchCurseFired   = false;
    s.witchCurseEndSec  = 0;
    s.shakeFrames       = 0;
    s.flashFrames       = 0;
    s.bubbles           = [];
    s.lastExplosionMs   = 0;

    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');
    setChaosLabel('');

    stopMusicRef.current = startMusic('ambient');
    spawnBats(window.innerWidth, window.innerHeight);

    // 1-second interval for score + zone accounting
    timerRef.current = setInterval(() => {
      if (!s.running) return;
      s.elapsedSec++;
      s.timeLeft--;
      setTimeLeft(s.timeLeft);

      // Witch's Curse at t=22s
      if (s.elapsedSec === WITCH_CURSE_TIME && !s.witchCurseFired) {
        s.witchCurseFired   = true;
        s.witchCurseActive  = true;
        s.witchCurseEndSec  = s.elapsedSec + WITCH_CURSE_DURATION;
        s.brewLow           = ZONE_BREW_LOW_CURSE;
        s.brewHigh          = ZONE_BREW_HIGH_CURSE;
        setChaosLabel("Witch's Curse 🧙");
        sfx.boom();         // dramatic ominous sound for the curse arriving
        hapticImpact();
        setTimeout(() => setChaosLabel(''), 3000);
      }

      // End curse
      if (s.witchCurseActive && s.elapsedSec >= s.witchCurseEndSec) {
        s.witchCurseActive = false;
        s.brewLow          = ZONE_BREW_LOW_DEFAULT;
        s.brewHigh         = ZONE_BREW_HIGH_DEFAULT;
      }

      // Zone-based score accounting (sample current zone)
      if (s.zone === 'brew') {
        s.sig.score++;
        s.sig.brewStreakCurrent++;
        if (s.sig.brewStreakCurrent > s.sig.longestBrewStreak) {
          s.sig.longestBrewStreak = s.sig.brewStreakCurrent;
        }
        sfx.collect(); // brew zone audio feedback — soft ascending tone each second
      } else {
        s.sig.brewStreakCurrent = 0;
        if (s.zone === 'dead') {
          s.sig.deadSeconds++;
          s.sig.score--;        // spec: dead zone = -1/sec
          sfx.tick();           // dead zone warning — quiet tick each second
        }
      }
      s.sig.score = Math.max(0, s.sig.score);
      // Update score + volume display once per second (not in rAF)
      setScoreDisplay(s.sig.score);
      setVolumeDisplay(Math.round(s.volumePct));

      if (s.timeLeft <= 0) {
        sfx.success();  // game survived 45s = success, not failure
        hapticVictory();
        endGame();
      }
    }, 1000);

    // rAF render + input loop
    const loop = () => {
      if (!s.running) return;
      const W = window.innerWidth;
      const H = window.innerHeight;

      // Read volume — write to ref only; display updated in 1s timer
      const vol = getVolumePct();
      s.volumePct = vol;
      s.sig.volumeSamples.push(vol);

      // Zone
      const newZone = calcZone(vol, s);
      s.zone        = newZone;

      // Explosion: trigger once per zone-entry (debounced)
      if (newZone === 'explosion' && s.prevZone !== 'explosion') {
        const now = Date.now();
        if (now - s.lastExplosionMs > EXPLOSION_COOLDOWN_MS) {
          s.lastExplosionMs  = now;
          s.sig.explosions++;
          s.sig.score        = Math.max(0, s.sig.score - 2);
          // score display deferred to 1s timer — no setState in rAF
          s.shakeFrames      = 22;
          s.flashFrames      = 14;
          s.flashColor       = '#ff2200';
          sfx.collision();
          hapticFail();
        }
      }
      s.prevZone = newZone;

      // Update bats
      for (const bat of s.bats) {
        bat.x         += bat.vx;
        bat.y         += bat.vy;
        bat.wingPhase += 0.09 * bat.wingDir;
        if (Math.abs(bat.wingPhase) > 0.65) bat.wingDir *= -1;
        if (bat.x < -40)    bat.x = W + 40;
        if (bat.x > W + 40) bat.x = -40;
        if (bat.y < 8)              bat.vy =  Math.abs(bat.vy);
        if (bat.y > H * 0.32)       bat.vy = -Math.abs(bat.vy);
      }

      // Spawn bubbles in brew / danger zone
      if (newZone === 'brew' || newZone === 'danger') {
        const spawnChance = newZone === 'brew' ? 0.35 : 0.15;
        if (Math.random() < spawnChance) {
          const cauldronCX = W / 2;
          const cauldronR  = Math.min(W * 0.3, 120);
          const cauldronCY = H * 0.55;
          const liqY       = getCauldronLiquidY(cauldronCY, cauldronR, vol);
          const bColor     = newZone === 'brew' ? '#22c55e' : '#f97316';
          s.bubbles.push({
            x:     cauldronCX + (Math.random() - 0.5) * cauldronR * 1.1,
            y:     liqY,
            r:     3 + Math.random() * 6,
            vy:    -(0.5 + Math.random() * 1.6),
            alpha: 0.75 + Math.random() * 0.2,
            color: bColor,
          });
        }
      }

      // Update bubbles
      for (let i = s.bubbles.length - 1; i >= 0; i--) {
        const b = s.bubbles[i];
        b.y    += b.vy;
        b.alpha -= 0.009;
        if (b.alpha <= 0) s.bubbles.splice(i, 1);
      }
      if (s.bubbles.length > 200) s.bubbles.splice(0, s.bubbles.length - 200);

      // ── RENDER ────────────────────────────────────────────────────────

      ctx.save();

      // Screen shake
      if (s.shakeFrames > 0) {
        const intensity = s.shakeFrames * 0.45;
        ctx.translate(
          (Math.random() - 0.5) * intensity,
          (Math.random() - 0.5) * intensity,
        );
        s.shakeFrames--;
      }

      // Background — dark emerald/witch gradient
      const cbBg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.65, Math.max(W, H) * 0.9);
      cbBg.addColorStop(0,   '#0a1a08');
      cbBg.addColorStop(0.55, '#060e05');
      cbBg.addColorStop(1,   '#020602');
      ctx.fillStyle = cbBg;
      ctx.fillRect(0, 0, W, H);

      // Vignette
      const cbVig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, H * 0.85);
      cbVig.addColorStop(0, 'rgba(0,0,0,0)');
      cbVig.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = cbVig;
      ctx.fillRect(0, 0, W, H);

      // Subtle star dots
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      // static cheap stars — seeded by index so they don't flicker
      for (let i = 0; i < 40; i++) {
        const sx = ((i * 137.508) % W);
        const sy = ((i * 97.3)    % (H * 0.45));
        ctx.beginPath();
        ctx.arc(sx, sy, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Full moon
      drawMoon(ctx, W, H);

      // Bats
      for (const bat of s.bats) drawBat(ctx, bat);

      // Zone label (brew zone indicator strip)
      const labelText =
        newZone === 'dead'      ? '💀 Too quiet…'  :
        newZone === 'brew'      ? '✨ Brewing!'     :
        newZone === 'danger'    ? '⚠️ Too loud!'    :
                                  '💥 EXPLOSION!';
      const labelColor = newZone === 'dead' ? '#888' : newZone === 'brew' ? '#22c55e' : newZone === 'danger' ? '#f97316' : '#ef4444';
      ctx.save();
      ctx.globalAlpha  = 0.85;
      ctx.fillStyle    = labelColor;
      ctx.shadowBlur   = 12;
      ctx.shadowColor  = labelColor;
      ctx.font         = 'bold 15px system-ui';
      ctx.textAlign    = 'center';
      ctx.fillText(labelText, W / 2, H * 0.82);
      ctx.restore();

      // Cauldron
      const cauldronR  = Math.min(W * 0.3, 120);
      const cauldronCX = W / 2;
      const cauldronCY = H * 0.55;
      drawCauldron(ctx, cauldronCX, cauldronCY, cauldronR, vol, newZone);

      // Bubbles
      for (const b of s.bubbles) {
        ctx.save();
        ctx.globalAlpha = b.alpha;
        ctx.fillStyle   = b.color;
        ctx.shadowBlur  = 8;
        ctx.shadowColor = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Flash overlay
      if (s.flashFrames > 0) {
        ctx.save();
        ctx.globalAlpha = (s.flashFrames / 14) * 0.45;
        ctx.fillStyle   = s.flashColor;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        s.flashFrames--;
      }

      ctx.restore();

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, getVolumePct, calcZone, spawnBats]);

  // ── Canvas setup & resize ───────────────────────────────────────────────────

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
      // Re-spawn bats to fit new dimensions (use CSS pixels)
      if (stateRef.current.running) {
        spawnBats(window.innerWidth, window.innerHeight);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    // Touch fallback: vertical drag to control "volume"
    let lastTouchY = 0;
    const onTouchStart = (e: TouchEvent) => { lastTouchY = e.touches[0].clientY; };
    const onTouchMove  = (e: TouchEvent) => {
      const s = stateRef.current;
      if (!s.useTouchFallback || !s.running) return;
      const dy = lastTouchY - e.touches[0].clientY;
      s.touchVolume = Math.max(0, Math.min(100, s.touchVolume + dy * 0.6));
      lastTouchY    = e.touches[0].clientY;
    };
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: true });

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
    };
  }, [spawnBats]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // ── Phase transitions ───────────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const actx    = new AudioContext();
      audioCtxRef.current = actx;
      const source  = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize              = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataArrRef.current  = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      setMicDenied(false);
    } catch {
      // Mic denied — activate touch fallback
      stateRef.current.useTouchFallback = true;
      setMicDenied(true);
    }

    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current   = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    stateRef.current.useTouchFallback = false;
    stateRef.current.touchVolume      = 0;
    setMicDenied(false);
    setPhase('start');
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
    setChaosLabel('');
  }, []);

  // ── End screen insights ─────────────────────────────────────────────────────

  const buildInsights = (sig: Signals) => [
    {
      label: 'Brew Time',
      value: `${sig.score}s`,
      color: sig.score >= 25 ? '#4ade80' : sig.score >= 10 ? '#facc15' : '#ef4444',
    },
    {
      label: 'Explosions',
      value: `${sig.explosions}`,
      color: sig.explosions === 0 ? '#4ade80' : sig.explosions >= 3 ? '#ef4444' : '#facc15',
    },
    {
      label: 'Dead Seconds',
      value: `${sig.deadSeconds}s`,
      color: sig.deadSeconds <= 3 ? '#4ade80' : '#facc15',
    },
    {
      label: 'Longest Brew',
      value: `${sig.longestBrewStreak}s`,
      color: ACCENT,
    },
  ];

  const accent = theme.colors.accent ?? ACCENT;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="cauldron-bubble"
          steps={[{ icon: "🎤", title: "Blow or hum into the mic", body: "Your breath controls the cauldron — blow to fill it, stop to let it settle." }, { icon: "✨", title: "Stay in the brew zone", body: "Too quiet = dead. Too loud = explosion. Find the sweet spot." }, { icon: "🧙", title: "Survive 45 seconds", body: "A witch's curse narrows your zone at 22 seconds. Stay focused!" }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>

      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          sensorNote="🎤 Microphone used to detect your breath/hum"
          ctaLabel="Allow Mic & Start"
          accentColor={accent}
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0a1a0a 0%, #060e06 55%, #030803 100%)"
        />
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accent} />
      )}

      {/* ── Playing ───────────────────────────────────────────────────────── */}
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
                accentColor={accent}
                items={[
                  { label: 'TIME',   value: timeLeft,      danger: timeLeft <= 10 },
                  { label: 'BREW ✨', value: scoreDisplay                          },
                  { label: 'BREW %',  value: volumeDisplay                         },
                ]}
              />

              {/* Witch's Curse label */}
              <AnimatePresence>
                {chaosLabel !== '' && (
                  <motion.div
                    key="chaos"
                    initial={{ opacity: 0, scale: 0.7, y: -20 }}
                    animate={{ opacity: 1, scale: 1,   y: 0    }}
                    exit={   { opacity: 0, scale: 0.8, y: -10  }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                    style={{
                      position:   'absolute',
                      top:        '42%',
                      left:       '50%',
                      transform:  'translate(-50%, -50%)',
                      color:      '#c084fc',
                      fontSize:   28,
                      fontWeight: 900,
                      textShadow: '0 0 24px #a855f7, 0 0 48px #7e22ce',
                      pointerEvents: 'none',
                      zIndex:     50,
                      textAlign:  'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {chaosLabel}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Mic-denied fallback note */}
              {micDenied && (
                <div style={{
                  position:   'absolute',
                  bottom:     88,
                  left:       '50%',
                  transform:  'translateX(-50%)',
                  color:      '#facc15',
                  fontSize:   12,
                  textAlign:  'center',
                  pointerEvents: 'none',
                  background: 'rgba(0,0,0,0.55)',
                  padding:    '4px 12px',
                  borderRadius: 8,
                  whiteSpace: 'nowrap',
                }}>
                  🎤 No mic — drag up/down on screen to brew
                </div>
              )}
            </>
          )}
        </>
      )}

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
          didWin={finalSig.score >= 25}
        />
      )}

      {/* ── Webhook (fires once on done mount) ────────────────────────────── */}
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
    postWebhook(theme, gameId, {
      personality,
      score:               sig.score,
      explosions:          sig.explosions,
      deadSeconds:         sig.deadSeconds,
      avgVolumePct:        sig.avgVolumePct,
      chaosEventsSurvived: sig.chaosEventsSurvived,
      longestBrewStreak:   sig.longestBrewStreak,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
