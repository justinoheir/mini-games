'use client';
/**
 * DREIDEL SPIN
 * Real mechanic: Swipe up to spin the dreidel. The dreidel rotates and decelerates.
 * Hold/press tap to brake. Land on the highlighted target symbol to score.
 * Each round, a new target symbol is shown.
 */
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
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'dreidel-spin';
const ACCENT = '#60a5fa';
const DURATION = 45;
const GAME_EMOJI = '🌀';
const GAME_TITLE = 'Dreidel Spin';
const GAME_TAGLINE = 'Spin it. Brake it. Land on the symbol.';
const PB_KEY = 'mg_pb_dreidel-spin';

// Dreidel symbols: Nun (נ), Gimel (ג), Hey (ה), Shin (ש)
const SYMBOLS = ['נ', 'ג', 'ה', 'ש'];
const SYMBOL_NAMES = ['Nun', 'Gimel', 'Hey', 'Shin'];
const NUM_SYMBOLS = 4;
// Each symbol occupies a quarter turn (90° = π/2)
const SECTOR_ANGLE = (Math.PI * 2) / NUM_SYMBOLS;

interface Signals { score: number; hits: number; attempts: number; maxStreak: number; streakCurrent: number; avgAccuracy: number; }

function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  if (acc >= 0.8 && sig.score >= 5) return 'Dreidel Master 🌟';
  if (acc >= 0.65) return 'Precision Spinner 🎯';
  if (sig.maxStreak >= 3) return 'Lucky Streak 🍀';
  if (sig.attempts >= 5) return 'Determined Player 💪';
  return 'Learning to Spin 🌀';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SpinState = 'idle' | 'spinning' | 'braking' | 'stopped';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function DreidelSpinGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, maxStreak: 0, streakCurrent: 0, avgAccuracy: 0 } as Signals,
    // Dreidel rotation
    angle: 0,           // current rotation angle (radians)
    angularVel: 0,      // radians per frame
    spinState: 'idle' as SpinState,
    // Swipe detection
    swipeStartY: 0,
    swipeStartTime: 0,
    isSwiping: false,
    // Braking
    isBraking: false,
    // Target
    targetSymbolIdx: 0,
    // Round result
    resultCorrect: false,
    resultFlash: 0,
    // Visual
    accentColor: ACCENT,
    wobble: 0,            // wobble amplitude when spinning
    tilt: 0,              // tilt angle when spinning (visual flair)
    accuracyDiffs: [] as number[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [spinStateDisplay, setSpinStateDisplay] = useState<SpinState>('idle');
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [targetDisplay, setTargetDisplay] = useState(0);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  /** Return the symbol index that the top of the dreidel is pointing at */
  const getTopSymbol = useCallback((angle: number): number => {
    // Normalize angle to 0..2π
    const norm = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    // Top is at angle 0; each symbol occupies SECTOR_ANGLE
    return Math.floor(norm / SECTOR_ANGLE) % NUM_SYMBOLS;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver(); haptic([100]);
    const sig = s.sig;
    sig.avgAccuracy = s.accuracyDiffs.length > 0
      ? Math.round(s.accuracyDiffs.reduce((a, b) => a + b, 0) / s.accuracyDiffs.length)
      : 0;
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    } catch { /* noop */ }
    setFinalSig({ ...sig });
    setPhase('done');
  }, []);

  /** Called when dreidel stops — check if landed on target */
  const checkLanding = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    const landed = getTopSymbol(s.angle);
    s.sig.attempts++;
    // Accuracy: how close to center of target sector?
    const targetAngle = s.targetSymbolIdx * SECTOR_ANGLE;
    const norm = ((s.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const diff = Math.abs(norm - (targetAngle + SECTOR_ANGLE / 2));
    const accuracyDiff = Math.round(Math.min(diff, Math.PI * 2 - diff) / SECTOR_ANGLE * 100);
    s.accuracyDiffs.push(accuracyDiff);

    const correct = landed === s.targetSymbolIdx;
    s.resultCorrect = correct;
    s.resultFlash = Date.now() + 800;

    if (correct) {
      s.sig.hits++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const bonus = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += bonus;
      setScoreDisplay(s.sig.score);
      setStreakDisplay(s.sig.streakCurrent);
      sfx.collect(); haptic([30]);
      setResultMsg(`✅ ${SYMBOL_NAMES[landed]}! +${bonus}`);
    } else {
      s.sig.streakCurrent = 0;
      setStreakDisplay(0);
      sfx.nearMiss(); haptic([20, 30, 20]);
      setResultMsg(`❌ Got ${SYMBOL_NAMES[landed]}, needed ${SYMBOL_NAMES[s.targetSymbolIdx]}`);
    }
    setTimeout(() => {
      setResultMsg(null);
      if (s.running) {
        // New target
        s.targetSymbolIdx = (s.targetSymbolIdx + 1 + Math.floor(Math.random() * 3)) % NUM_SYMBOLS;
        setTargetDisplay(s.targetSymbolIdx);
        s.spinState = 'idle';
        setSpinStateDisplay('idle');
      }
    }, 1500);
  }, [getTopSymbol]);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = window.innerWidth, H = window.innerHeight;
    const s = stateRef.current;
    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { score: 0, hits: 0, attempts: 0, maxStreak: 0, streakCurrent: 0, avgAccuracy: 0 };
    s.angle = 0; s.angularVel = 0; s.spinState = 'idle';
    s.isBraking = false; s.wobble = 0; s.tilt = 0;
    s.targetSymbolIdx = Math.floor(Math.random() * NUM_SYMBOLS);
    s.accuracyDiffs = [];
    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION);
    setSpinStateDisplay('idle');
    setTargetDisplay(s.targetSymbolIdx);
    setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) { sfx.warning(); haptic([50, 30, 50]); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const cx = W / 2, cy = H * 0.43;
    const size = Math.min(W, H) * 0.22;

    const drawDreidel = (angle: number, wobble: number) => {
      ctx.save();
      ctx.translate(cx + wobble * Math.sin(Date.now() * 0.018), cy);
      ctx.rotate(angle);
      const accent = s.accentColor;

      // Body (diamond/rhombus shape)
      const topY = -size * 1.2;
      const midY = size * 0.3;
      const botY = size * 1.2;
      const halfW = size * 0.6;

      // Draw 4 faces as sectors
      for (let i = 0; i < NUM_SYMBOLS; i++) {
        const faceAngle = i * SECTOR_ANGLE;
        const isTarget = i === s.targetSymbolIdx;
        ctx.save();
        ctx.rotate(faceAngle);
        // Face gradient
        const faceGrad = ctx.createLinearGradient(0, topY, 0, botY);
        const baseCol = isTarget ? '#1e3a8a' : '#1e293b';
        const lightCol = isTarget ? '#3b82f6' : '#334155';
        faceGrad.addColorStop(0, lightCol); faceGrad.addColorStop(1, baseCol);
        ctx.fillStyle = faceGrad;
        ctx.beginPath();
        ctx.moveTo(0, topY);
        ctx.lineTo(halfW * Math.cos(SECTOR_ANGLE * 0.5) * 0.9, midY * 0.6);
        ctx.lineTo(halfW * Math.cos(SECTOR_ANGLE * 0.5) * 0.6, midY);
        ctx.lineTo(0, botY * 0.2);
        ctx.closePath(); ctx.fill();
        // Face border
        ctx.strokeStyle = isTarget ? accent : 'rgba(148,163,184,0.3)'; ctx.lineWidth = 1.5;
        ctx.stroke();
        // Symbol text
        ctx.fillStyle = isTarget ? '#ffffff' : 'rgba(255,255,255,0.7)';
        ctx.font = `bold ${Math.round(size * 0.38)}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(SYMBOLS[i], size * 0.15, midY * 0.3 - size * 0.1);
        ctx.restore();
      }

      // Center shine
      const shine = ctx.createRadialGradient(0, topY * 0.6, 0, 0, topY * 0.3, size * 0.5);
      shine.addColorStop(0, 'rgba(255,255,255,0.3)'); shine.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = shine;
      ctx.beginPath(); ctx.arc(0, topY * 0.4, size * 0.5, 0, Math.PI * 2); ctx.fill();

      // Spindle top
      ctx.fillStyle = '#94a3b8'; ctx.shadowBlur = 6; ctx.shadowColor = '#94a3b8';
      ctx.beginPath(); ctx.arc(0, topY, size * 0.1, 0, Math.PI * 2); ctx.fill();
      // Spindle bottom tip
      ctx.beginPath(); ctx.moveTo(-size * 0.08, botY * 0.2); ctx.lineTo(size * 0.08, botY * 0.2);
      ctx.lineTo(0, botY); ctx.closePath(); ctx.fill();
      ctx.restore();
    };

    const drawPointer = () => {
      // Arrow pointer at top showing target sector
      ctx.save();
      ctx.fillStyle = ACCENT; ctx.shadowBlur = 12; ctx.shadowColor = ACCENT;
      const py = cy - size * 1.45;
      ctx.beginPath(); ctx.moveTo(cx, py + 14); ctx.lineTo(cx - 8, py); ctx.lineTo(cx + 8, py);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    };

    const loop = () => {
      if (!s.running) return;
      const now = Date.now();
      const accent = s.accentColor;
      ctx.clearRect(0, 0, W, H);

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0c1428'); bg.addColorStop(1, '#060c1a');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // Star of David subtly in background
      ctx.save(); ctx.globalAlpha = 0.04; ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2;
      ctx.translate(W / 2, H / 2);
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        for (let j = 0; j < 3; j++) {
          const a = (j * 2 * Math.PI / 3) + (i * Math.PI / 3);
          const r = Math.min(W, H) * 0.4;
          if (j === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();

      // Result flash
      if (now < s.resultFlash) {
        const p = Math.max(0, 1 - (now - (s.resultFlash - 800)) / 800);
        const col = s.resultCorrect ? '74,222,128' : '239,68,68';
        ctx.fillStyle = `rgba(${col},${p * 0.18})`; ctx.fillRect(0, 0, W, H);
      }

      // Spinning physics
      if (s.spinState === 'spinning') {
        const drag = s.isBraking ? 0.88 : 0.992;
        s.angularVel *= drag;
        s.angle += s.angularVel;
        s.wobble = Math.abs(s.angularVel) * 3;
        if (Math.abs(s.angularVel) < 0.01) {
          s.spinState = 'stopped';
          s.angularVel = 0;
          s.isBraking = false;
          s.wobble = 0;
          setSpinStateDisplay('stopped');
          sfx.nearMiss();
          checkLanding();
        } else if (s.isBraking) {
          setSpinStateDisplay('braking');
        }
      }

      // Draw shadow
      ctx.save();
      const shadow = ctx.createRadialGradient(cx, cy + size * 1.4, 0, cx, cy + size * 1.4, size * 0.8);
      shadow.addColorStop(0, 'rgba(0,0,0,0.5)'); shadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shadow;
      ctx.beginPath(); ctx.ellipse(cx, cy + size * 1.35, size * 0.55 + s.wobble * 0.5, size * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      drawDreidel(s.angle, s.wobble);
      drawPointer();

      // Target indicator UI (below dreidel)
      const targetY = cy + size * 1.65;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `500 15px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('Land on:', cx, targetY);
      ctx.fillStyle = accent; ctx.font = `bold 32px serif`;
      ctx.shadowBlur = 12; ctx.shadowColor = accent;
      ctx.fillText(SYMBOLS[s.targetSymbolIdx], cx, targetY + 22);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `400 13px "Space Grotesk", sans-serif`;
      ctx.shadowBlur = 0;
      ctx.fillText(SYMBOL_NAMES[s.targetSymbolIdx], cx, targetY + 60);
      ctx.restore();

      // Instruction
      const instrY = H - 90;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `400 14px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      if (s.spinState === 'idle') ctx.fillText('Swipe UP to spin', W / 2, instrY);
      else if (s.spinState === 'spinning') ctx.fillText('Hold tap to brake', W / 2, instrY);
      else if (s.spinState === 'stopped') ctx.fillText('Checking...', W / 2, instrY);

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, checkLanding]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px';
      const ctx = canvas.getContext('2d'); if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let touchStartY = 0, touchStartTime = 0;

    const onDown = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running) return;
      touchStartY = e.clientY; touchStartTime = Date.now();
      if (s.spinState === 'spinning') {
        s.isBraking = true;
        setSpinStateDisplay('braking');
      }
    };
    const onUp = (e: PointerEvent) => {
      const s = stateRef.current; if (!s.running) return;
      s.isBraking = false;
      const dy = touchStartY - e.clientY;
      const dt = Date.now() - touchStartTime;
      if (s.spinState === 'idle' && dy > 30) {
        // Swipe up = spin
        const speed = Math.min(0.4, Math.max(0.08, dy / (dt * 0.8)));
        s.angularVel = speed;
        s.spinState = 'spinning';
        setSpinStateDisplay('spinning');
        sfx.collect();
        haptic([20]);
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio();
    setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0c1428 0%, #060c1a 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start Spinning →" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0c1428 0%, #04080f 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <canvas ref={canvasRef} role="img" aria-label="Dreidel Spin game canvas"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10, testId: 'timer' },
          { label: 'SCORE', value: scoreDisplay, testId: 'score' },
          { label: 'STREAK', value: streakDisplay, testId: 'streak' },
        ]} />
      )}
      <AnimatePresence>
        {resultMsg && (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1.1 }} exit={{ opacity: 0, y: -30 }} transition={{ duration: 0.4 }}
            style={{ position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: resultMsg.startsWith('✅') ? 36 : 24, fontWeight: 900, color: resultMsg.startsWith('✅') ? '#4ade80' : '#ef4444', textShadow: '0 0 16px currentColor', whiteSpace: 'nowrap', textAlign: 'center' }}>
            {resultMsg}
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Landed Correctly', value: `${finalSig.hits} / ${finalSig.attempts}`, color: accent },
              { label: 'Accuracy', value: finalSig.attempts > 0 ? `${Math.round(finalSig.hits / finalSig.attempts * 100)}%` : '—', color: '#4ade80' },
              { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fbbf24' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 3} finalScore={finalSig.score} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}
