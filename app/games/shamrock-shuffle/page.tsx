'use client';
/**
 * SHAMROCK SHUFFLE
 * Real mechanic: 3 cups on canvas. Shamrock is revealed under one cup, then the cups
 * swap positions in animated sequences that get faster each round.
 * Player taps the cup they think hides the shamrock.
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

const GAME_ID = 'shamrock-shuffle';
const ACCENT = '#22c55e';
const DURATION = 45;
const GAME_EMOJI = '🍀';
const GAME_TITLE = 'Shamrock Shuffle';
const GAME_TAGLINE = 'Track the shamrock. No peeking.';
const PB_KEY = 'mg_pb_shamrock-shuffle';

interface Signals { score: number; correct: number; wrong: number; maxStreak: number; streakCurrent: number; roundsPlayed: number; }

function getPersonality(sig: Signals): string {
  const acc = sig.roundsPlayed > 0 ? sig.correct / sig.roundsPlayed : 0;
  if (acc >= 0.85 && sig.score >= 6) return 'Mind Like a Steel Trap 🧠';
  if (acc >= 0.7) return 'Sharp Eyes 👀';
  if (sig.maxStreak >= 4) return 'Hot Streak 🔥';
  if (acc >= 0.5) return 'Lucky Guesser 🍀';
  return 'Needs More Practice 🎲';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'reveal' | 'shuffle' | 'choose' | 'result';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function ShamrockShuffleGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subPhaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  // Cup positions [0,1,2] — which slot each cup is in
  const stateRef = useRef({
    running: false,
    timeLeft: DURATION,
    sig: { score: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0, roundsPlayed: 0 } as Signals,
    // Cups: each has a slot index (0=left, 1=center, 2=right) and a visual x position
    cups: [
      { id: 0, slot: 0, x: 0, targetX: 0 },
      { id: 1, slot: 1, x: 0, targetX: 0 },
      { id: 2, slot: 2, x: 0, targetX: 0 },
    ],
    shamrockCupId: 0,       // which cup ID hides the shamrock
    subPhase: 'reveal' as SubPhase,
    swaps: [] as [number, number][],  // pending swaps (cup IDs)
    swapProgress: 0,        // 0..1 animation progress
    swapDuration: 600,      // ms per swap
    swapStartTime: 0,
    resultCorrect: false,
    showCupLift: -1,        // cup id to lift (reveal shamrock at end)
    cupY: 0,
    cupW: 0,
    cupH: 0,
    slotXs: [0, 0, 0],     // X centers for slots 0,1,2
    roundSpeed: 1,          // increases each round
    accentColor: ACCENT,
    liftOffset: 0,          // animated lift amount
    resultUntil: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [subPhaseDisplay, setSubPhaseDisplay] = useState<SubPhase>('reveal');
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (subPhaseTimerRef.current) { clearTimeout(subPhaseTimerRef.current); subPhaseTimerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver(); haptic([100]);
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score));
    } catch { /* noop */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  /** Start a new round: reveal, then shuffle, then player chooses */
  const startRound = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    s.subPhase = 'reveal';
    s.showCupLift = s.shamrockCupId;
    s.liftOffset = 0;
    setSubPhaseDisplay('reveal');

    // Animate lift up over 800ms then show shuffle
    subPhaseTimerRef.current = setTimeout(() => {
      if (!s.running) return;
      s.showCupLift = -1;
      s.subPhase = 'shuffle';
      setSubPhaseDisplay('shuffle');

      // Generate swaps (more swaps each round)
      const numSwaps = 3 + Math.floor(s.roundSpeed * 1.5);
      const swaps: [number, number][] = [];
      for (let i = 0; i < numSwaps; i++) {
        let a = Math.floor(Math.random() * 3);
        let b = Math.floor(Math.random() * 2);
        if (b >= a) b++;
        swaps.push([a, b]);
      }
      s.swaps = swaps;
      s.swapProgress = 0;
      s.swapDuration = Math.max(200, 600 - s.roundSpeed * 40);
      s.swapStartTime = Date.now();

      // After all swaps done, show "choose"
      const totalSwapTime = (swaps.length + 0.5) * s.swapDuration;
      subPhaseTimerRef.current = setTimeout(() => {
        if (!s.running) return;
        s.subPhase = 'choose';
        setSubPhaseDisplay('choose');
      }, totalSwapTime);
    }, 1000);
  }, []);

  /** Execute next swap in the queue */
  const processSwaps = useCallback(() => {
    const s = stateRef.current;
    if (s.subPhase !== 'shuffle') return;
    if (s.swaps.length === 0) return;
    const now = Date.now();
    const swapIdx = Math.floor((now - s.swapStartTime) / s.swapDuration);
    if (swapIdx >= s.swaps.length) return;
    const [slotA, slotB] = s.swaps[swapIdx];
    const progress = Math.min(1, ((now - s.swapStartTime) % s.swapDuration) / s.swapDuration);
    // Find which cups are in slotA and slotB
    const cupA = s.cups.find(c => c.slot === slotA);
    const cupB = s.cups.find(c => c.slot === slotB);
    if (!cupA || !cupB) return;
    if (progress >= 0.99) {
      // Commit swap
      cupA.slot = slotB; cupA.x = s.slotXs[slotB];
      cupB.slot = slotA; cupB.x = s.slotXs[slotA];
    } else {
      // Interpolate x positions
      cupA.x = s.slotXs[slotA] + (s.slotXs[slotB] - s.slotXs[slotA]) * progress;
      cupB.x = s.slotXs[slotB] + (s.slotXs[slotA] - s.slotXs[slotB]) * progress;
    }
  }, []);

  const handleCupTap = useCallback((clientX: number) => {
    const s = stateRef.current;
    if (!s.running || s.subPhase !== 'choose') return;
    // Determine which cup was tapped
    const tapped = s.cups.reduce((closest, cup) => {
      const dist = Math.abs(clientX - cup.x);
      return dist < Math.abs(clientX - closest.x) ? cup : closest;
    });
    const correct = tapped.id === s.shamrockCupId;
    s.sig.roundsPlayed++;
    s.subPhase = 'result';
    s.showCupLift = s.shamrockCupId;
    s.resultCorrect = correct;
    s.resultUntil = Date.now() + 1200;
    setSubPhaseDisplay('result');

    if (correct) {
      s.sig.correct++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const bonus = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += bonus;
      setScoreDisplay(s.sig.score);
      setStreakDisplay(s.sig.streakCurrent);
      sfx.collect(); haptic([30]);
      setResultMsg(s.sig.streakCurrent >= 3 ? `✅ +${bonus} 🔥` : '✅ +1');
    } else {
      s.sig.wrong++;
      s.sig.streakCurrent = 0;
      setStreakDisplay(0);
      sfx.nearMiss(); haptic([20, 30, 20]);
      setResultMsg('❌ Nope!');
    }
    setTimeout(() => setResultMsg(null), 1000);

    // Start next round after result display
    subPhaseTimerRef.current = setTimeout(() => {
      if (!s.running) return;
      s.showCupLift = -1;
      s.shamrockCupId = s.cups[Math.floor(Math.random() * 3)].id;
      s.roundSpeed = Math.min(6, 1 + s.sig.score * 0.15);
      startRound();
    }, 1400);
  }, [startRound]);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = window.innerWidth, H = window.innerHeight;
    const s = stateRef.current;
    s.running = true;
    s.timeLeft = DURATION;
    s.sig = { score: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0, roundsPlayed: 0 };
    s.roundSpeed = 1;

    // Layout cups
    const margin = W * 0.18;
    s.slotXs = [margin, W / 2, W - margin];
    s.cupY = H * 0.5;
    s.cupW = Math.min(W * 0.2, 80);
    s.cupH = s.cupW * 1.2;
    s.cups = [
      { id: 0, slot: 0, x: s.slotXs[0], targetX: s.slotXs[0] },
      { id: 1, slot: 1, x: s.slotXs[1], targetX: s.slotXs[1] },
      { id: 2, slot: 2, x: s.slotXs[2], targetX: s.slotXs[2] },
    ];
    s.shamrockCupId = Math.floor(Math.random() * 3);
    s.showCupLift = -1;

    setScoreDisplay(0); setStreakDisplay(0); setTimeLeft(DURATION);
    setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) { sfx.warning(); haptic([50, 30, 50]); }
      else if (s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    startRound();

    const SHAMROCK = '🍀';
    const CUP_COLOR = '#166534';
    const CUP_LIGHT = '#22c55e';
    const CUP_DARK = '#14532d';

    const loop = () => {
      if (!s.running) return;
      const now = Date.now();
      const accent = s.accentColor;
      ctx.clearRect(0, 0, W, H);

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a1f0a'); bg.addColorStop(1, '#061206');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // Felt table surface
      ctx.fillStyle = '#0f2e0f';
      ctx.fillRect(0, H * 0.55, W, H * 0.5);
      ctx.fillStyle = '#112e12';
      ctx.fillRect(0, H * 0.53, W, 4);

      // Process swaps in shuffle phase
      if (s.subPhase === 'shuffle') processSwaps();

      // Lift animation
      let liftY = 0;
      if (s.showCupLift >= 0) {
        const liftProgress = Math.min(1, (now - (s.resultUntil - 1200)) / 400);
        if (s.subPhase === 'reveal') {
          // Lift up during reveal
          const elapsed = now - (s.resultUntil || now);
          liftY = -s.cupH * 0.65 * Math.min(1, (now % 5000) / 400);
        } else if (s.subPhase === 'result') {
          liftY = -s.cupH * 0.65;
        }
      }

      // Draw each cup
      for (const cup of s.cups) {
        const cx = cup.x;
        const cy = s.cupY;
        const isLifted = cup.id === s.showCupLift;
        const actualY = isLifted ? cy + liftY - s.cupH * 0.5 : cy;
        const cw = s.cupW, ch = s.cupH;

        // Shamrock under cup (visible when cup lifted)
        if (cup.id === s.shamrockCupId) {
          const shAlpha = isLifted ? Math.min(1, Math.abs(liftY) / (s.cupH * 0.3)) : 0;
          if (shAlpha > 0) {
            ctx.save();
            ctx.globalAlpha = shAlpha;
            ctx.font = `${Math.round(s.cupW * 0.9)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(SHAMROCK, cx, cy + s.cupH * 0.15);
            ctx.restore();
          }
        }

        // Cup body (trapezoid)
        ctx.save();
        ctx.shadowBlur = 16; ctx.shadowColor = accent + '44';
        const bodyGrad = ctx.createLinearGradient(cx - cw / 2, 0, cx + cw / 2, 0);
        bodyGrad.addColorStop(0, CUP_DARK);
        bodyGrad.addColorStop(0.3, CUP_LIGHT);
        bodyGrad.addColorStop(0.7, CUP_COLOR);
        bodyGrad.addColorStop(1, CUP_DARK);
        ctx.fillStyle = bodyGrad;
        const topW = cw * 0.7, botW = cw;
        ctx.beginPath();
        ctx.moveTo(cx - botW / 2, actualY + ch * 0.5);
        ctx.lineTo(cx + botW / 2, actualY + ch * 0.5);
        ctx.lineTo(cx + topW / 2, actualY - ch * 0.5);
        ctx.lineTo(cx - topW / 2, actualY - ch * 0.5);
        ctx.closePath(); ctx.fill();
        // Cup rim
        ctx.strokeStyle = CUP_LIGHT; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - topW / 2 - 4, actualY - ch * 0.5);
        ctx.lineTo(cx + topW / 2 + 4, actualY - ch * 0.5);
        ctx.stroke();
        // Highlight stripe
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - topW * 0.25, actualY - ch * 0.4);
        ctx.lineTo(cx - botW * 0.25, actualY + ch * 0.4);
        ctx.stroke();
        ctx.restore();

        // Cup number label (during choose phase)
        if (s.subPhase === 'choose') {
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.font = `bold 13px "Space Grotesk", sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(`Tap`, cx, actualY + ch * 0.6);
          ctx.restore();
        }
      }

      // Phase instruction
      const instructY = H * 0.82;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `500 16px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      if (s.subPhase === 'reveal') ctx.fillText('Memorize which cup hides the shamrock!', W / 2, instructY);
      else if (s.subPhase === 'shuffle') ctx.fillText('Shuffling... keep your eyes open!', W / 2, instructY);
      else if (s.subPhase === 'choose') ctx.fillText('Tap the cup hiding the shamrock!', W / 2, instructY);
      ctx.restore();

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, startRound, processSwaps]);

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
    const onDown = (e: PointerEvent) => { if (stateRef.current.running) handleCupTap(e.clientX); };
    canvas.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onDown); };
  }, [handleCupTap]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (subPhaseTimerRef.current) clearTimeout(subPhaseTimerRef.current);
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
      background="linear-gradient(180deg, #0a1f0a 0%, #061206 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start Shuffling →" accentColor={accent} onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0a1f0a 0%, #040d04 100%)" />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <canvas ref={canvasRef} role="img" aria-label="Shamrock Shuffle game canvas"
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
          <motion.div key="result" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1.2 }} exit={{ opacity: 0, y: -30 }} transition={{ duration: 0.4 }}
            style={{ position: 'fixed', top: '28%', left: '50%', transform: 'translateX(-50%)', zIndex: 80, pointerEvents: 'none', fontSize: 44, fontWeight: 900, color: resultMsg.startsWith('✅') ? '#4ade80' : '#ef4444', textShadow: '0 0 20px currentColor', whiteSpace: 'nowrap' }}>
            {resultMsg}
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Correct', value: `${finalSig.correct} / ${finalSig.roundsPlayed}`, color: accent },
              { label: 'Accuracy', value: finalSig.roundsPlayed > 0 ? `${Math.round(finalSig.correct / finalSig.roundsPlayed * 100)}%` : '—', color: '#4ade80' },
              { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fbbf24' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 4} finalScore={finalSig.score} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}
