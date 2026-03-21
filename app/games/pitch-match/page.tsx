/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — PITCH MATCH
 *  Sensor: Microphone (required, no touch fallback)
 *  Players hum/sing to match target pitch lines on a waveform canvas.
 *  Signals: notesHit, avgPitchDeviation, longestHold, totalHoldTime, silenceGaps
 * ══════════════════════════════════════════════════════════════════
 */

'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { spawnBurst, updateAndDrawParticles, Particle } from '@/lib/particles';
import { Mic, MicOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.breath.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────

const GAME_ID      = 'pitch-match';
const PB_KEY       = 'pb_pitch-match';
const ACCENT       = '#34d399';
const DURATION     = 45;
const GAME_EMOJI   = '🎵';
const GAME_TITLE   = 'Pitch Match';
const GAME_TAGLINE = 'Hit the note. Hold it. Feel it.';

// ─── NOTE DEFINITIONS ────────────────────────────────────────────────────────
// 8 target notes across comfortable vocal range C3–C5

const TARGET_NOTES: number[] = [
  196.00, // G3
  261.63, // C4
  329.63, // E4
  440.00, // A4
  392.00, // G4
  220.00, // A3
  293.66, // D4
  523.25, // C5
];

// Note name lookup table
const NOTE_NAME_MAP: Array<[number, string]> = [
  [130.81, 'C3'], [138.59, 'C#3'], [146.83, 'D3'], [155.56, 'D#3'],
  [164.81, 'E3'], [174.61, 'F3'], [185.00, 'F#3'], [196.00, 'G3'],
  [207.65, 'G#3'], [220.00, 'A3'], [233.08, 'A#3'], [246.94, 'B3'],
  [261.63, 'C4'], [277.18, 'C#4'], [293.66, 'D4'], [311.13, 'D#4'],
  [329.63, 'E4'], [349.23, 'F4'], [369.99, 'F#4'], [392.00, 'G4'],
  [415.30, 'G#4'], [440.00, 'A4'], [466.16, 'A#4'], [493.88, 'B4'],
  [523.25, 'C5'],
];

function getNoteName(freq: number): string {
  if (freq <= 0) return '';
  let closest = NOTE_NAME_MAP[0];
  let minDiff = Math.abs(freq - closest[0]);
  for (const pair of NOTE_NAME_MAP) {
    const diff = Math.abs(freq - pair[0]);
    if (diff < minDiff) { minDiff = diff; closest = pair; }
  }
  return minDiff > 25 ? `${Math.round(freq)}Hz` : closest[1];
}

// Y-axis frequency range for the canvas
const FREQ_MIN = 90;    // below C3 (bottom of visible range)
const FREQ_MAX = 620;   // above C5 (top of visible range)

// Note timing
const NOTE_DURATION_MS = Math.floor((DURATION * 1000) / TARGET_NOTES.length); // 5625ms

// Guide frequencies drawn as subtle horizontal lines
const GUIDE_FREQS = [130.81, 196.00, 261.63, 329.63, 392.00, 440.00, 523.25];

// Scoring constants
const HIT_CENTS       = 50;
const PRECISION_CENTS = 20;
const SCORE_TICK_MS   = 100;
const NOTE_HIT_BONUS  = 10;
const HIT_SCORE       = 1;
const PRECISION_SCORE = 2;
const COMBO_MULT      = 1.5;

// Timing thresholds
const SILENCE_GAP_MS  = 500;
const PITCH_DETECT_MS = 50;  // run autocorrelation every 50ms (20fps)

// ─── PITCH DETECTION: AUTOCORRELATION ────────────────────────────────────────

function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;
  const HALF = SIZE >> 1;

  // RMS signal check
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.015) return -1; // below silence threshold

  // Search lag range corresponding to 80–700 Hz vocal range
  const minLag = Math.floor(sampleRate / 700);
  const maxLag = Math.min(Math.ceil(sampleRate / 80), SIZE - 2);

  let bestLag = -1;
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < HALF; i++) corr += buf[i] * buf[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }

  if (bestLag < 1) return -1;

  // Confidence: compare correlation against signal power
  let norm = 0;
  for (let i = 0; i < HALF; i++) norm += buf[i] * buf[i];
  if (norm < 1e-8 || bestCorr / norm < 0.3) return -1;

  // Parabolic interpolation for sub-sample accuracy
  if (bestLag > 1 && bestLag < maxLag - 1) {
    let c0 = 0, c1 = 0, c2 = 0;
    for (let i = 0; i < HALF; i++) {
      c0 += buf[i] * buf[i + bestLag - 1];
      c1 += buf[i] * buf[i + bestLag];
      c2 += buf[i] * buf[i + bestLag + 1];
    }
    const a = (c0 + c2 - 2 * c1) / 2;
    const b = (c2 - c0) / 2;
    if (a < 0) {
      const refined = bestLag - b / (2 * a);
      return sampleRate / refined;
    }
  }

  return sampleRate / bestLag;
}

// ─── COORDINATE HELPERS ──────────────────────────────────────────────────────

function freqToY(freq: number, H: number): number {
  const logMin = Math.log2(FREQ_MIN);
  const logMax = Math.log2(FREQ_MAX);
  const logF   = Math.log2(Math.max(FREQ_MIN, Math.min(FREQ_MAX, freq)));
  return H * (1 - (logF - logMin) / (logMax - logMin));
}

// ─── BEHAVIORAL SIGNALS ──────────────────────────────────────────────────────

interface Signals {
  notesHit: number;
  avgPitchDeviation: number;   // average cents off while in hit zone
  longestHold: number;         // ms
  totalHoldTime: number;       // ms
  silenceGaps: number;
  score: number;
  // Internal tracking — not sent to webhook
  deviationTotal: number;
  deviationSamples: number;
  notesFirstHit: boolean[];    // [8] — first-hit tracking per note
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  if (sig.notesHit >= 8 && sig.avgPitchDeviation < 30)       return 'Natural Pitch 🎼';
  if (sig.longestHold > 4000 && sig.totalHoldTime > 20000)   return 'Sustained Voice 🌬️';
  if (sig.notesHit >= 5 && sig.avgPitchDeviation > 60)       return 'Close Enough 🎸';
  return 'Finding Voice 🌊';
}

// ─── GAME STATE ──────────────────────────────────────────────────────────────

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  gameStartTime: number;

  // Pitch analysis
  detectedPitch: number;       // Hz from autocorrelate, or -1
  displayPitch: number;        // exponentially smoothed pitch for visual
  lastPitchDetect: number;     // timestamp of last autocorrelation call

  // Note tracking
  currentNoteIndex: number;

  // Hold & score tracking
  holdingNote: boolean;
  holdStartTime: number;
  lastScoreTick: number;

  // Silence tracking
  inSilence: boolean;
  silenceStartTime: number;
  firstPitchDetected: boolean;
  silenceGapCounted: boolean;

  // Combo
  comboActive: boolean;

  // Visual state
  accentColor: string;
  particles: Particle[];
  hitFlashAlpha: number;       // 0–1, brightness when in zone
  noteChangeFlash: number;     // 0–1, brief flash on note change
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function PitchMatchGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  // Mic & audio analysis
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const pitchBufRef  = useRef<Float32Array | null>(null);

  // ⚠️ All mutable game state in stateRef — never useState inside rAF
  const stateRef = useRef<GameState>({
    running: false,
    timeLeft: DURATION,
    sig: {
      notesHit: 0, avgPitchDeviation: 0, longestHold: 0, totalHoldTime: 0,
      silenceGaps: 0, score: 0, deviationTotal: 0, deviationSamples: 0,
      notesFirstHit: Array<boolean>(8).fill(false),
    },
    gameStartTime: 0,
    detectedPitch: -1,
    displayPitch: -1,
    lastPitchDetect: 0,
    currentNoteIndex: 0,
    holdingNote: false,
    holdStartTime: 0,
    lastScoreTick: 0,
    inSilence: false,
    silenceStartTime: 0,
    firstPitchDetected: false,
    silenceGapCounted: false,
    comboActive: false,
    accentColor: ACCENT,
    particles: [],
    hitFlashAlpha: 0,
    noteChangeFlash: 0,
  });

  // ⚠️ Only these drive re-renders
  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);

  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎤');
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
  const [micError, setMicError]         = useState(false);
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  // Sync brand theme accent
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── END GAME ────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }

    // Finalize any active hold
    if (s.holdingNote) {
      const holdDuration = Date.now() - s.holdStartTime;
      s.sig.totalHoldTime += holdDuration;
      if (holdDuration > s.sig.longestHold) s.sig.longestHold = holdDuration;
      s.holdingNote = false;
    }

    // Compute average pitch deviation
    s.sig.avgPitchDeviation = s.sig.deviationSamples > 0
      ? s.sig.deviationTotal / s.sig.deviationSamples
      : 0;

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
    setPhase('done');
  }, []);

  // ─── GAME LOOP ───────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Reset all game state
    s.running = true;
    s.timeLeft = DURATION;
    s.gameStartTime = Date.now();
    s.sig = {
      notesHit: 0, avgPitchDeviation: 0, longestHold: 0, totalHoldTime: 0,
      silenceGaps: 0, score: 0, deviationTotal: 0, deviationSamples: 0,
      notesFirstHit: Array<boolean>(8).fill(false),
    };
    s.currentNoteIndex = 0;
    s.detectedPitch = -1;
    s.displayPitch = -1;
    s.lastPitchDetect = 0;
    s.holdingNote = false;
    s.holdStartTime = 0;
    s.lastScoreTick = Date.now();
    s.inSilence = false;
    s.firstPitchDetected = false;
    s.silenceGapCounted = false;
    s.comboActive = false;
    s.particles = [];
    s.hitFlashAlpha = 0;
    s.noteChangeFlash = 1.0; // flash on first note
    ctx.imageSmoothingEnabled = true;

    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');

    // ⚠️ setInterval ONLY for the 1-second countdown
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    // ─── rAF LOOP ────────────────────────────────────────────────────────
    const loop = () => {
      if (!s.running) return;
      const now = Date.now();
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;

      // ── 1. Pitch Detection (throttled to every PITCH_DETECT_MS) ─────────
      if (
        now - s.lastPitchDetect >= PITCH_DETECT_MS &&
        analyserRef.current !== null &&
        pitchBufRef.current !== null &&
        audioCtxRef.current !== null
      ) {
        s.lastPitchDetect = now;
        analyserRef.current.getFloatTimeDomainData(pitchBufRef.current as Float32Array<ArrayBuffer>);
        s.detectedPitch = autoCorrelate(pitchBufRef.current, audioCtxRef.current.sampleRate);
      }

      // ── 2. Pitch Smoothing & Silence Tracking ────────────────────────────
      const rawPitch = s.detectedPitch;
      if (rawPitch > 0) {
        // Exponential smoothing toward detected pitch
        s.displayPitch = s.displayPitch > 0
          ? s.displayPitch * 0.80 + rawPitch * 0.20
          : rawPitch;
        s.firstPitchDetected = true;
        if (s.inSilence) {
          s.inSilence = false;
          s.silenceGapCounted = false;
        }
      } else {
        // No pitch — track silence gap
        if (s.firstPitchDetected && !s.inSilence) {
          s.inSilence = true;
          s.silenceStartTime = now;
        }
        if (s.inSilence && !s.silenceGapCounted && (now - s.silenceStartTime) > SILENCE_GAP_MS) {
          s.sig.silenceGaps++;
          s.silenceGapCounted = true;
        }
        // Fade display pitch to zero (visual fade-out)
        if (s.displayPitch > 0) {
          s.displayPitch *= 0.93;
          if (s.displayPitch < FREQ_MIN + 10) s.displayPitch = -1;
        }
      }

      // ── 3. Note Progression ──────────────────────────────────────────────
      const elapsed = now - s.gameStartTime;
      const noteIndex = Math.min(
        Math.floor(elapsed / NOTE_DURATION_MS),
        TARGET_NOTES.length - 1,
      );

      if (noteIndex !== s.currentNoteIndex) {
        const prevIdx = s.currentNoteIndex;

        // Finalize hold from the note that just ended
        if (s.holdingNote) {
          const holdDuration = now - s.holdStartTime;
          s.sig.totalHoldTime += holdDuration;
          if (holdDuration > s.sig.longestHold) s.sig.longestHold = holdDuration;
          s.holdingNote = false;
        }

        // Combo: prev note was hit AND no silence gap means combo stays active
        s.comboActive = s.sig.notesFirstHit[prevIdx] && !s.inSilence;

        // Play miss sound if the note expired without being hit
        if (!s.sig.notesFirstHit[prevIdx]) {
          sfx.collision();
          haptic([40]);
        }

        s.currentNoteIndex = noteIndex;
        s.noteChangeFlash = 1.0;

        // Spawn particles at new target line to signal the change
        const newTargetY = freqToY(TARGET_NOTES[noteIndex], H);
        spawnBurst(s.particles, W * 0.42, newTargetY, s.accentColor, 10, 3);
      }

      // Decay note-change flash
      s.noteChangeFlash = Math.max(0, s.noteChangeFlash - 0.035);

      // ── 4. Hit Zone Logic ────────────────────────────────────────────────
      const targetFreq = TARGET_NOTES[s.currentNoteIndex];
      const dp         = s.displayPitch;
      let inHitZone       = false;
      let inPrecisionZone = false;
      let centsOff        = 999;

      if (dp > 0) {
        centsOff        = Math.abs(1200 * Math.log2(dp / targetFreq));
        inHitZone       = centsOff <= HIT_CENTS;
        inPrecisionZone = centsOff <= PRECISION_CENTS;
      }

      if (inHitZone) {
        if (!s.holdingNote) {
          // Just entered the hit zone
          s.holdingNote = true;
          s.holdStartTime = now;
          s.hitFlashAlpha = 1.0;
          sfx.collect();
          haptic([15]);

          // Particle burst at the intersection of player and target lines
          const targetY = freqToY(targetFreq, H);
          const playerY = freqToY(dp, H);
          spawnBurst(s.particles, W * 0.5, (targetY + playerY) * 0.5, s.accentColor, 20, 5);

          // Award first-hit bonus (only once per note)
          if (!s.sig.notesFirstHit[s.currentNoteIndex]) {
            s.sig.notesFirstHit[s.currentNoteIndex] = true;
            s.sig.notesHit++;
            const bonus = s.comboActive
              ? Math.round(NOTE_HIT_BONUS * COMBO_MULT)
              : NOTE_HIT_BONUS;
            s.sig.score += bonus;
            setScoreDisplay(s.sig.score);
          }
        }

        // Accumulate score every SCORE_TICK_MS while in zone
        if (now - s.lastScoreTick >= SCORE_TICK_MS) {
          s.lastScoreTick = now;
          const base = inPrecisionZone ? PRECISION_SCORE : HIT_SCORE;
          const pts  = s.comboActive ? Math.ceil(base * COMBO_MULT) : base;
          s.sig.score += pts;
          setScoreDisplay(s.sig.score);
          // Track precision deviation
          s.sig.deviationTotal += centsOff;
          s.sig.deviationSamples++;
        }

        s.hitFlashAlpha = Math.min(1, s.hitFlashAlpha + 0.08);
      } else {
        // Left hit zone — finalize hold
        if (s.holdingNote) {
          const holdDuration = now - s.holdStartTime;
          s.sig.totalHoldTime += holdDuration;
          if (holdDuration > s.sig.longestHold) s.sig.longestHold = holdDuration;
          s.holdingNote = false;
        }
        s.hitFlashAlpha = Math.max(0, s.hitFlashAlpha - 0.04);
      }

      // ─────────────────────────────────────────────────────────────────────
      // ── 5. RENDER ──────────────────────────────────────────────────────
      // ─────────────────────────────────────────────────────────────────────

      // Layer 1: Background
      ctx.fillStyle = '#08090f';
      ctx.fillRect(0, 0, W, H);

      // Layer 2: Subtle oscilloscope waveform (studio monitor aesthetic)
      if (pitchBufRef.current !== null) {
        const wbuf = pitchBufRef.current;
        const step = Math.ceil(wbuf.length / W);
        ctx.save();
        ctx.strokeStyle = 'rgba(52,211,153,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const centerY = H * 0.5;
        for (let x = 0; x < W; x++) {
          const idx = Math.min(x * step, wbuf.length - 1);
          const y = centerY + wbuf[idx] * H * 0.12;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Layer 3: Frequency guide lines
      for (const gf of GUIDE_FREQS) {
        const gy = freqToY(gf, H);
        ctx.strokeStyle = 'rgba(255,255,255,0.035)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
        ctx.stroke();
        // Note name label (far left)
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.09)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textBaseline = 'bottom';
        ctx.fillText(getNoteName(gf), 8, gy - 2);
        ctx.restore();
      }

      // Layer 4: Hit zone band (±50 cents around target)
      const targetY  = freqToY(targetFreq, H);
      const hitTopY  = freqToY(targetFreq * Math.pow(2,  HIT_CENTS / 1200), H);
      const hitBotY  = freqToY(targetFreq * Math.pow(2, -HIT_CENTS / 1200), H);
      const precTopY = freqToY(targetFreq * Math.pow(2,  PRECISION_CENTS / 1200), H);
      const precBotY = freqToY(targetFreq * Math.pow(2, -PRECISION_CENTS / 1200), H);

      const hitZoneAlpha = 0.06 + s.noteChangeFlash * 0.08 + s.hitFlashAlpha * 0.07;
      ctx.fillStyle = `rgba(52,211,153,${hitZoneAlpha})`;
      ctx.fillRect(0, hitTopY, W * 0.86, hitBotY - hitTopY);

      // Precision zone (±20 cents, slightly brighter)
      const precAlpha = 0.05 + s.noteChangeFlash * 0.06 + s.hitFlashAlpha * 0.06;
      ctx.fillStyle = `rgba(52,211,153,${precAlpha})`;
      ctx.fillRect(0, precTopY, W * 0.86, precBotY - precTopY);

      // Dashed zone boundary lines
      ctx.save();
      ctx.setLineDash([4, 7]);
      ctx.strokeStyle = `rgba(52,211,153,${0.13 + s.hitFlashAlpha * 0.12})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, hitTopY); ctx.lineTo(W * 0.86, hitTopY);
      ctx.moveTo(0, hitBotY); ctx.lineTo(W * 0.86, hitBotY);
      ctx.stroke();
      ctx.restore();

      // Layer 5: Target note line (glowing horizontal)
      ctx.save();
      ctx.shadowBlur = inHitZone
        ? 28 + s.hitFlashAlpha * 14
        : 14 + s.noteChangeFlash * 10;
      ctx.shadowColor = s.accentColor;
      ctx.strokeStyle = inHitZone
        ? s.accentColor
        : `rgba(52,211,153,${0.55 + s.noteChangeFlash * 0.25})`;
      ctx.lineWidth = inHitZone ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(0, targetY);
      ctx.lineTo(W * 0.84, targetY);
      ctx.stroke();
      ctx.restore();

      // Note label next to target line
      ctx.save();
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = inHitZone ? s.accentColor : 'rgba(52,211,153,0.6)';
      if (inHitZone) { ctx.shadowBlur = 12; ctx.shadowColor = s.accentColor; }
      ctx.fillText(getNoteName(targetFreq), W * 0.86, targetY);
      ctx.restore();

      // Layer 6: Note progression tracker (vertical dots, far right)
      const dotR       = 5;
      const dotsX      = W - 14;
      const dotsTop    = 60;
      const dotsGap    = Math.min(28, (H - 120) / TARGET_NOTES.length);

      for (let di = 0; di < TARGET_NOTES.length; di++) {
        const dy        = dotsTop + di * dotsGap;
        const isHit     = s.sig.notesFirstHit[di];
        const isCurrent = di === s.currentNoteIndex;
        const isPast    = di < s.currentNoteIndex;

        ctx.save();
        ctx.beginPath();
        ctx.arc(dotsX, dy, isCurrent ? dotR * 1.4 : dotR * 0.9, 0, Math.PI * 2);

        if (isHit) {
          ctx.fillStyle = s.accentColor;
          ctx.shadowBlur = isCurrent ? 12 : 6;
          ctx.shadowColor = s.accentColor;
        } else if (isCurrent) {
          ctx.fillStyle = `rgba(52,211,153,0.45)`;
          ctx.shadowBlur = 10;
          ctx.shadowColor = s.accentColor;
        } else if (isPast) {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.07)';
        }
        ctx.fill();
        ctx.restore();
      }

      // Layer 7: Player pitch line
      if (dp > 0) {
        const playerY = freqToY(dp, H);

        ctx.save();
        if (inHitZone) {
          ctx.shadowBlur = 22 + s.hitFlashAlpha * 14;
          ctx.shadowColor = s.accentColor;
          ctx.strokeStyle = s.accentColor;
          ctx.lineWidth = 3;
        } else {
          ctx.shadowBlur = 6;
          ctx.shadowColor = 'rgba(255,255,255,0.35)';
          ctx.strokeStyle = 'rgba(255,255,255,0.82)';
          ctx.lineWidth = 2;
        }
        ctx.beginPath();
        ctx.moveTo(W * 0.05, playerY);
        ctx.lineTo(W * 0.78, playerY);
        ctx.stroke();

        // Leading dot (left edge)
        ctx.beginPath();
        ctx.arc(W * 0.03, playerY, 5, 0, Math.PI * 2);
        ctx.fillStyle = inHitZone ? s.accentColor : 'rgba(255,255,255,0.88)';
        ctx.shadowBlur = inHitZone ? 16 : 4;
        ctx.shadowColor = inHitZone ? s.accentColor : 'rgba(255,255,255,0.4)';
        ctx.fill();
        ctx.restore();

        // Layer 8: Proximity meter (right-side vertical bar)
        const meterX   = W - 30;
        const meterW   = 6;
        const meterH   = H * 0.5;
        const meterTop = (H - meterH) * 0.5;
        const proximity = Math.max(0, 1 - Math.min(centsOff, HIT_CENTS) / HIT_CENTS);

        // Background track
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(meterX, meterTop, meterW, meterH);

        // Fill
        const fillH = meterH * proximity;
        const fillY = meterTop + meterH - fillH;
        if (fillH > 0) {
          ctx.save();
          const meterColor = inPrecisionZone
            ? s.accentColor
            : inHitZone
              ? '#86efac'
              : 'rgba(255,255,255,0.22)';
          ctx.fillStyle = meterColor;
          if (inHitZone) { ctx.shadowBlur = 10; ctx.shadowColor = meterColor; }
          ctx.fillRect(meterX, fillY, meterW, fillH);
          ctx.restore();
        }
      }

      // Layer 9: Combo indicator (canvas overlay)
      if (s.comboActive) {
        ctx.save();
        ctx.font = 'bold 13px "Space Grotesk", sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = s.accentColor;
        ctx.shadowBlur = 10;
        ctx.shadowColor = s.accentColor;
        ctx.fillText('×1.5 COMBO', 14, H - 18);
        ctx.restore();
      }

      // Layer 10: Particles
      updateAndDrawParticles(ctx, s.particles);

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // ─── CANVAS RESIZE ───────────────────────────────────────────────────────

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

    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);

  // ─── UNMOUNT CLEANUP ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => { /* ignore */ });
      }
    };
  }, []);

  // ─── PHASE HANDLERS ──────────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setMicError(false);

    // Test shortcut: skip mic acquisition when audio is disabled (e.g. Playwright)
    if ((window as unknown as Record<string,unknown>).__DISABLE_AUDIO) { setPhase('countdown'); return; }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;

      const audioCtx = new AudioContext();
      await audioCtx.resume();
      audioCtxRef.current = audioCtx;

      const source  = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize              = 2048;
      analyser.smoothingTimeConstant = 0.0; // no smoothing — we handle it ourselves
      source.connect(analyser);
      analyserRef.current = analyser;
      pitchBufRef.current = new Float32Array(analyser.fftSize);

      setPhase('countdown');
    } catch {
      setMicError(true);
    }
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    // Clean up mic & audio context for fresh re-request
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => { /* ignore */ });
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    pitchBufRef.current = null;

    setPhase('start');
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
    setMicError(false);
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────

  const buildInsights = (sig: Signals) => {
    const pct   = Math.round((sig.notesHit / 8) * 100);
    const hold  = (sig.longestHold / 1000).toFixed(1);
    const dev   = Math.round(sig.avgPitchDeviation);
    const total = (sig.totalHoldTime / 1000).toFixed(1);

    return [
      {
        label: 'Notes Hit',
        value: `${sig.notesHit}/8 (${pct}%)`,
        color: sig.notesHit >= 6 ? '#4ade80' : sig.notesHit >= 3 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Best Hold',
        value: `${hold}s`,
        color: sig.longestHold > 3000 ? '#4ade80' : sig.longestHold > 1500 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Avg Precision',
        value: `±${dev} cents`,
        color: dev < 25 ? '#4ade80' : dev < 60 ? '#facc15' : '#ef4444',
      },
      {
        label: 'On-Target',
        value: `${total}s`,
        color: theme.colors.accent ?? ACCENT,
      },
    ];
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="pitch-match"
          steps={[{ icon: "🎤", title: "Sing or hum", body: "Match the target pitch shown on screen." }, { icon: "🎵", title: "Hold steady", body: "Stay on pitch as long as you can." }, { icon: "🏆", title: "Score points", body: "The closer your pitch, the more you score." }]}
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
          ctaLabel={micError ? 'Retry Microphone' : 'Enable Microphone'}
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        >
          {/* ⚠️ Per-game player name capture — required in every game */}

          {micError ? (
            <div
              style={{
                marginTop: 16,
                padding: '12px 16px',
                background: 'rgba(239,68,68,0.12)',
                borderRadius: 10,
                border: '1px solid rgba(239,68,68,0.28)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <MicOff size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ color: '#ef4444', fontSize: 14, lineHeight: 1.5 }}>
                Microphone access required. Please allow mic access in your browser settings and try again.
              </span>
            </div>
          ) : (
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'rgba(255,255,255,0.38)',
                fontSize: 13,
              }}
            >
              <Mic size={14} />
              <span>Requires microphone access</span>
            </div>
          )}
        </GameStartScreen>
      )}

      {/* ── Countdown ────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Playing (canvas + HUD) ───────────────────────────────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          {/* ⚠️ Canvas: full-bleed, touchAction none */}
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
          {/* ⚠️ HUD above canvas — TIME and SCORE always visible */}
          {phase === 'playing' && (
            <GameHUD
              accentColor={theme.colors.accent ?? ACCENT}
              items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
                { label: 'SCORE', value: scoreDisplay },
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



      {/* ── End Screen ───────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig !== null && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(finalSig.score)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.notesHit >= 5}
        />
      )}

      {/* ⚠️ Webhook — fires once when done phase mounts */}
      {phase === 'done' && finalSig !== null && (
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
// Isolated component so postWebhook fires exactly once on mount.

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
    postWebhook(theme, gameId, {
      personality,
      score:             sig.score,
      notesHit:          sig.notesHit,
      avgPitchDeviation: parseFloat(sig.avgPitchDeviation.toFixed(2)),
      longestHold:       sig.longestHold,
      totalHoldTime:     sig.totalHoldTime,
      silenceGaps:       sig.silenceGaps,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
