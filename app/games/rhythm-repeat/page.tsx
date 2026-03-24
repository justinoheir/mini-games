'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo, hapticTick } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'rhythm-repeat';
const ACCENT = '#f59e0b';
const DURATION = 60;
const GAME_EMOJI = '🎵';
const GAME_TITLE = 'Rhythm Repeat';
const GAME_TAGLINE = 'Hear the beat. Feel it. Copy it.';

interface Signals {
  roundsCompleted: number;
  longestPattern: number;
  avgTimingError: number;  // avg ms error per beat
  totalTimingError: number;
  totalBeats: number;
  wrongBeats: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const avgError = sig.totalBeats > 0 ? sig.totalTimingError / sig.totalBeats : 9999;
  if (avgError < 80 && sig.longestPattern >= 6) return 'Rhythm Master 🎶';
  if (sig.longestPattern >= 7) return 'Beat Keeper 🥁';
  if (avgError < 120) return 'On the Beat 🎵';
  if (sig.wrongBeats === 0 && sig.roundsCompleted >= 4) return 'Clean Rhythm ✨';
  return 'Finding the Groove 🎸';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'show' | 'input' | 'result';

interface Beat {
  delay: number;   // ms from pattern start
  isShort: boolean;
}

function makePattern(level: number): Beat[] {
  const count = 3 + Math.min(level, 5);
  const beats: Beat[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const isShort = Math.random() < 0.4;
    beats.push({ delay: t, isShort });
    t += isShort ? 250 : 500;
  }
  return beats;
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  subPhase: SubPhase;
  pattern: Beat[];
  playerTaps: number[];   // ms timestamps of player taps (relative to inputStart)
  patternStartMs: number;
  inputStartMs: number;
  showBeatIdx: number;    // which beat we're currently highlighting
  activeBeat: boolean;    // is a beat currently visible/playing
  activeBeatTimer: number;
  level: number;
  resultTimer: number;
  success: boolean;
  drumFlash: number;      // frames of drum flash
  particles: Array<{ x: number; y: number; vx: number; vy: number; color: string; alpha: number }>;
}

export default function RhythmRepeatGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { roundsCompleted: 0, longestPattern: 0, avgTimingError: 0, totalTimingError: 0, totalBeats: 0, wrongBeats: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    subPhase: 'show', pattern: [], playerTaps: [],
    patternStartMs: 0, inputStartMs: 0,
    showBeatIdx: -1, activeBeat: false, activeBeatTimer: 0,
    level: 1, resultTimer: 0, success: false, drumFlash: 0, particles: [],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const clearSchedule = useCallback(() => {
    scheduleRef.current.forEach(t => clearTimeout(t));
    scheduleRef.current = [];
  }, []);

  const endGame = useCallback(() => {
    clearSchedule();
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, [clearSchedule]);

  const startRound = useCallback(() => {
    const s = stateRef.current;
    clearSchedule();
    s.pattern = makePattern(s.level);
    s.playerTaps = [];
    s.subPhase = 'show';
    s.patternStartMs = Date.now() + 500;
    s.activeBeat = false;

    // Schedule show beats
    s.pattern.forEach((beat, i) => {
      const t = setTimeout(() => {
        if (!s.running) return;
        s.showBeatIdx = i;
        s.activeBeat = true;
        s.activeBeatTimer = beat.isShort ? 8 : 16;
        hapticTick();
        sfx.collect();
      }, 500 + beat.delay);
      scheduleRef.current.push(t);
    });

    // After all beats shown, start input phase
    const lastBeat = s.pattern[s.pattern.length - 1];
    const endT = setTimeout(() => {
      if (!s.running) return;
      s.subPhase = 'input';
      s.inputStartMs = Date.now();
      s.activeBeat = false;

      // Input timeout
      const inputTimeout = setTimeout(() => {
        if (!s.running || s.subPhase !== 'input') return;
        // Evaluate what was tapped
        evaluateRound();
      }, lastBeat.delay + lastBeat.delay * 0.3 + 2000);
      scheduleRef.current.push(inputTimeout);
    }, 500 + lastBeat.delay + 600);
    scheduleRef.current.push(endT);
  }, [clearSchedule]);

  const evaluateRound = useCallback(() => {
    const s = stateRef.current;
    s.subPhase = 'result';

    // Compare player taps to pattern beats
    const patternTimes = s.pattern.map(b => b.delay);
    const playerTimes = s.playerTaps.slice(0, s.pattern.length);

    let totalError = 0, correct = 0;
    const margin = 300; // ms tolerance

    patternTimes.forEach((expected, i) => {
      if (i < playerTimes.length) {
        const err = Math.abs(playerTimes[i] - expected);
        totalError += err;
        if (err <= margin) correct++;
      }
    });

    const accuracy = s.pattern.length > 0 ? correct / s.pattern.length : 0;
    s.success = accuracy >= 0.6;

    if (s.success) {
      s.sig.roundsCompleted++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      if (s.pattern.length > s.sig.longestPattern) s.sig.longestPattern = s.pattern.length;
      s.sig.totalBeats += s.pattern.length;
      s.sig.totalTimingError += totalError;
      const pts = s.pattern.length + (s.sig.streakCurrent >= 3 ? 2 : 0);
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      s.level = Math.min(7, 1 + Math.floor(s.sig.roundsCompleted / 3));
      hapticCombo(s.sig.streakCurrent); sfx.collect();
      const canvas = canvasRef.current;
      if (canvas) {
        s.floats.push({ x: canvas.width / 2, y: canvas.height * 0.35, text: `+${pts} 🎶 NAILED IT!`, alpha: 1, vy: -3, color: '#fbbf24' });
      }
    } else {
      s.sig.wrongBeats += s.pattern.length - correct;
      s.sig.streakCurrent = 0;
      sfx.collision(); hapticFail();
      const canvas = canvasRef.current;
      if (canvas) {
        s.floats.push({ x: canvas.width / 2, y: canvas.height * 0.35, text: 'OFF BEAT!', alpha: 1, vy: -2, color: '#ef4444' });
      }
    }

    s.resultTimer = 50;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { roundsCompleted: 0, longestPattern: 0, avgTimingError: 0, totalTimingError: 0, totalBeats: 0, wrongBeats: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.level = 1; s.particles = [];
    startRound();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      if (s.activeBeatTimer > 0) { s.activeBeatTimer--; if (s.activeBeatTimer <= 0) s.activeBeat = false; }
      if (s.drumFlash > 0) s.drumFlash--;

      // Background - stage dark amber
      ctx.fillStyle = '#0f0800'; ctx.fillRect(0, 0, W, H);
      // Stage lights
      for (let i = 0; i < 4; i++) {
        const lx = (i + 1) * W / 5;
        const cone = ctx.createLinearGradient(lx, 0, lx, H * 0.6);
        cone.addColorStop(0, `rgba(245,158,11,0.15)`); cone.addColorStop(1, 'transparent');
        ctx.fillStyle = cone;
        ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx - 40, H * 0.6); ctx.lineTo(lx + 40, H * 0.6); ctx.closePath(); ctx.fill();
      }

      // Phase indicator
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(
        s.subPhase === 'show' ? 'LISTEN...' :
          s.subPhase === 'input' ? 'YOUR TURN! TAP!' : '',
        W / 2, H * 0.12
      );

      if (s.subPhase === 'result') {
        s.resultTimer--;
        ctx.fillStyle = s.success ? 'rgba(74,222,128,0.12)' : 'rgba(239,68,68,0.12)';
        ctx.fillRect(0, 0, W, H);
        if (s.resultTimer <= 0) startRound();
      }

      // Drum pad (center circle)
      const drumX = W / 2, drumY = H * 0.55, drumR = Math.min(W, H) * 0.2;
      const drumFlashPct = s.drumFlash / 8;
      const beatPulse = s.activeBeat ? 1.15 : 1;

      ctx.save();
      ctx.shadowBlur = s.activeBeat ? 30 : s.drumFlash > 0 ? 20 : 8;
      ctx.shadowColor = ACCENT;
      const drumGrad = ctx.createRadialGradient(drumX, drumY, 0, drumX, drumY, drumR * beatPulse);
      drumGrad.addColorStop(0, s.activeBeat ? ACCENT + 'aa' : s.drumFlash > 0 ? '#fbbf2488' : '#0f0800');
      drumGrad.addColorStop(1, s.activeBeat ? ACCENT + '44' : '#0f0800');
      ctx.fillStyle = drumGrad;
      ctx.strokeStyle = s.activeBeat ? ACCENT : (s.subPhase === 'input' ? '#fbbf24' : ACCENT + '88');
      ctx.lineWidth = s.subPhase === 'input' ? 3 : 2;
      ctx.beginPath(); ctx.arc(drumX, drumY, drumR * beatPulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      ctx.fillStyle = s.activeBeat ? '#000' : s.subPhase === 'input' ? '#fbbf24' : 'rgba(255,255,255,0.6)';
      ctx.font = `bold ${drumR * 0.4}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(s.subPhase === 'input' ? '🥁' : GAME_EMOJI, drumX, drumY + drumR * 0.15);
      ctx.restore();

      // Pattern visual (dots)
      const dotsY = H * 0.82;
      s.pattern.forEach((beat, i) => {
        const dotX = W / 2 + (i - (s.pattern.length - 1) / 2) * 30;
        const isPlayed = s.showBeatIdx >= i && s.subPhase === 'show';
        const isTapped = i < s.playerTaps.length;
        ctx.fillStyle = isPlayed || isTapped ? ACCENT : 'rgba(255,255,255,0.2)';
        ctx.beginPath(); ctx.arc(dotX, dotsY, beat.isShort ? 5 : 8, 0, Math.PI * 2); ctx.fill();
      });

      // Player tap count
      if (s.subPhase === 'input') {
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`${s.playerTaps.length} / ${s.pattern.length}`, W / 2, H * 0.78);
      }

      // Particles
      s.particles = s.particles.filter(p => p.alpha > 0.01);
      s.particles.forEach(p => {
        ctx.save(); ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore(); p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.alpha *= 0.93;
      });

      // Floats
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.95;
      });

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, startRound]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.subPhase !== 'input') return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const W = canvas.width, H = canvas.height;
      const drumX = W / 2, drumY = H * 0.55, drumR = Math.min(W, H) * 0.2;

      if (Math.hypot(px - drumX, py - drumY) > drumR * 1.3) return;

      const ms = Date.now() - s.inputStartMs;
      s.playerTaps.push(ms);
      s.drumFlash = 8;
      hapticTick(); sfx.collect();

      // Spawn particles
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 3;
        s.particles.push({
          x: drumX, y: drumY,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
          color: ACCENT, alpha: 1,
        });
      }

      // Auto-evaluate if all beats tapped
      if (s.playerTaps.length >= s.pattern.length) {
        clearSchedule();
        setTimeout(() => { if (s.running) evaluateRound(); }, 200);
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, clearSchedule, evaluateRound]);

  useEffect(() => () => {
    clearSchedule();
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, [clearSchedule]);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Listen to the rhythm, then tap the drum to repeat it!" ctaLabel="Beat it! 🎵" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Rhythm Repeat game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Rounds', value: String(finalSig.roundsCompleted), color: ACCENT },
            { label: 'Longest', value: `${finalSig.longestPattern} beats`, color: '#fbbf24' },
            { label: 'Avg Error', value: `${finalSig.totalBeats > 0 ? Math.round(finalSig.totalTimingError / finalSig.totalBeats) : 0}ms`, color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 5} />
      )}
    </GameShell>
  );
}
