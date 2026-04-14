'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'trust-fall';
const ACCENT = '#8b5cf6';
const DURATION = 60;
const GAME_EMOJI = '🫀';
const GAME_TITLE = 'Trust Fall';
const GAME_TAGLINE = 'Let go at the right moment.';

interface Signals { drops: number; bullseyes: number; nearMisses: number; misses: number; maxStreak: number; score: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.drops > 0 ? sig.bullseyes / sig.drops : 0;
  if (acc >= 0.7 && sig.maxStreak >= 5) return 'Precision Faller 🎯';
  if (sig.bullseyes >= 5) return 'Zone Finder ✨';
  if (sig.maxStreak >= 4) return 'On a Roll 🎢';
  if (sig.nearMisses >= 5) return 'So Close! 🫢';
  return 'Trust Issues 😅';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean; timeLeft: number; sig: Signals;
  barY: number; barSpeed: number; isHolding: boolean;
  streak: number; flashColor: string | null; flashUntil: number;
  scorePopY: number | null; scorePopVal: string | null; scorePopAlpha: number;
  resetAt: number | null;
}

const ZONE_TOP = 0.62;
const ZONE_BOTTOM = 0.76;
const BULL_TOP = 0.67;
const BULL_BOTTOM = 0.71;

function TrustFallInner() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<GState>({
    running: false, timeLeft: DURATION,
    sig: { drops: 0, bullseyes: 0, nearMisses: 0, misses: 0, maxStreak: 0, score: 0 },
    barY: 0.05, barSpeed: 0.004, isHolding: false,
    streak: 0, flashColor: null, flashUntil: 0,
    scorePopY: null, scorePopVal: null, scorePopAlpha: 0,
    resetAt: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    cancelAnimationFrame(animRef.current);
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const resetBar = useCallback(() => {
    const s = stateRef.current;
    s.barY = 0.02;
    s.isHolding = false;
    s.resetAt = null;
  }, []);

  const drop = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.barY < 0.3 || s.resetAt !== null) return;
    const y = s.barY;
    s.sig.drops++;
    let pts = 0;
    let label = '';
    const now = Date.now();

    if (y >= BULL_TOP && y <= BULL_BOTTOM) {
      pts = 50; label = 'PERFECT!'; s.sig.bullseyes++;
      s.streak++; if (s.streak > s.sig.maxStreak) s.sig.maxStreak = s.streak;
      sfx.success?.(); hapticScore();
      s.flashColor = '#22c55e';
    } else if (y >= ZONE_TOP && y <= ZONE_BOTTOM) {
      pts = 20; label = 'GOOD'; s.sig.nearMisses++;
      s.streak++; if (s.streak > s.sig.maxStreak) s.sig.maxStreak = s.streak;
      sfx.collect?.(); hapticImpact();
      s.flashColor = '#f59e0b';
    } else {
      pts = 0; label = 'MISS'; s.sig.misses++;
      s.streak = 0; sfx.fail?.(); hapticFail();
      s.flashColor = '#ef4444';
    }
    const mult = s.streak >= 4 ? 3 : s.streak >= 2 ? 2 : 1;
    s.sig.score += pts * mult;
    setScoreDisplay(s.sig.score);
    s.flashUntil = now + 400;
    s.scorePopY = y; s.scorePopVal = pts > 0 ? `+${pts * mult}` : 'MISS';
    s.scorePopAlpha = 1;
    s.barSpeed = Math.min(0.012, s.barSpeed + 0.0002);
    s.resetAt = now + 600;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { drops: 0, bullseyes: 0, nearMisses: 0, misses: 0, maxStreak: 0, score: 0 };
    s.barY = 0.05; s.barSpeed = 0.004; s.streak = 0; s.isHolding = false;
    s.flashColor = null; s.flashUntil = 0; s.resetAt = null;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); endGame(); }
    }, 1000);

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      if (!s.running) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const dpr = window.devicePixelRatio || 1; const W = canvas.offsetWidth, H = canvas.offsetHeight; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = Date.now();

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a0015');
      bg.addColorStop(1, '#150028');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // Ambient grid lines
      ctx.save(); ctx.globalAlpha = 0.07;
      ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        ctx.beginPath(); ctx.moveTo(i * W / 10, 0); ctx.lineTo(i * W / 10, H); ctx.stroke();
      }
      ctx.restore();

      // Flash overlay
      if (s.flashColor && now < s.flashUntil) {
        ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = s.flashColor;
        ctx.fillRect(0, 0, W, H); ctx.restore();
      }

      // Zone indicators
      const zoneTopY = ZONE_TOP * H;
      const zoneBotY = ZONE_BOTTOM * H;
      const bullTopY = BULL_TOP * H;
      const bullBotY = BULL_BOTTOM * H;
      const zoneX = W * 0.15;
      const zoneW = W * 0.7;

      // Outer zone
      ctx.save();
      ctx.fillStyle = 'rgba(245,158,11,0.15)';
      ctx.strokeStyle = 'rgba(245,158,11,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(zoneX, zoneTopY, zoneW, zoneBotY - zoneTopY, 8);
      ctx.fill(); ctx.stroke();
      ctx.restore();

      // Bullseye zone
      ctx.save();
      ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 15;
      ctx.fillStyle = 'rgba(34,197,94,0.25)';
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(zoneX, bullTopY, zoneW, bullBotY - bullTopY, 6);
      ctx.fill(); ctx.stroke();
      ctx.restore();

      // Zone labels
      ctx.save();
      ctx.font = `bold ${Math.round(W * 0.04)}px 'Space Grotesk', Arial, sans-serif`;
      ctx.textAlign = 'right'; ctx.fillStyle = '#22c55e';
      ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 10;
      ctx.fillText('PERFECT', zoneX - 8, (bullTopY + bullBotY) / 2 + 6);
      ctx.fillStyle = '#f59e0b'; ctx.shadowColor = '#f59e0b';
      ctx.fillText('GOOD', zoneX - 8, zoneTopY + 14);
      ctx.restore();

      // Update bar
      if (s.resetAt !== null) {
        if (now > s.resetAt) resetBar();
      } else {
        s.barY += s.barSpeed;
        if (s.barY > 1.05) {
          // Missed — bar went past
          s.sig.drops++; s.sig.misses++; s.streak = 0;
          s.flashColor = '#ef4444'; s.flashUntil = now + 400;
          sfx.fail?.(); hapticFail();
          s.resetAt = now + 500;
        }
      }

      // Draw falling bar
      const barH = 18;
      const barY = s.barY * H;
      const pulse = 1 + Math.sin(now * 0.008) * 0.08;
      const isInZone = s.barY >= ZONE_TOP && s.barY <= ZONE_BOTTOM;
      const isInBull = s.barY >= BULL_TOP && s.barY <= BULL_BOTTOM;
      const barColor = isInBull ? '#22c55e' : isInZone ? '#f59e0b' : '#8b5cf6';

      ctx.save();
      if (s.resetAt === null) {
        ctx.shadowColor = barColor; ctx.shadowBlur = 25 * pulse;
        const barGrad = ctx.createLinearGradient(zoneX, 0, zoneX + zoneW, 0);
        barGrad.addColorStop(0, 'transparent');
        barGrad.addColorStop(0.2, barColor);
        barGrad.addColorStop(0.8, barColor);
        barGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = barGrad;
        ctx.beginPath(); ctx.roundRect(zoneX, barY - barH / 2, zoneW, barH, barH / 2);
        ctx.fill();
      }
      ctx.restore();

      // Score pop
      if (s.scorePopAlpha > 0 && s.scorePopY !== null) {
        s.scorePopAlpha -= 0.025;
        const popY = s.scorePopY * H - (1 - s.scorePopAlpha) * 80;
        ctx.save();
        ctx.globalAlpha = s.scorePopAlpha;
        ctx.font = `bold ${Math.round(H * 0.055)}px 'Space Grotesk', Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = s.sig.bullseyes > 0 ? '#22c55e' : '#f59e0b';
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 25;
        ctx.fillText(s.scorePopVal!, W / 2, popY);
        ctx.restore();
      }

      // Streak indicator
      if (s.streak >= 2) {
        ctx.save();
        ctx.fillStyle = '#f59e0b'; ctx.font = `bold ${Math.round(H * 0.028)}px 'Space Grotesk', Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 15;
        ctx.fillText(`🔥 ×${s.streak} STREAK`, W / 2, H * 0.12);
        ctx.restore();
      }

      // Instruction
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `${Math.round(H * 0.022)}px 'Space Grotesk', Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('TAP TO DROP', W / 2, H * 0.92);
      ctx.restore();
    };
    draw();
  }, [endGame, resetBar]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || phase !== 'playing') return;
    const resize = () => { const dpr = window.devicePixelRatio || 1; canvas.width = canvas.offsetWidth * dpr; canvas.height = canvas.offsetHeight * dpr; };
    resize();
    window.addEventListener('resize', resize);
    const onTap = (e: PointerEvent) => {
      e.preventDefault();
      drop();
    };
    canvas.addEventListener('pointerdown', onTap);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onTap);
    };
  }, [phase, drop]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    cancelAnimationFrame(animRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="A glowing bar falls from the top. Tap at the perfect moment to land it in the green zone. The better your timing, the more points!"
          ctaLabel="Let Go 🫀" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Perfects', value: String(finalSig.bullseyes), color: '#22c55e' },
            { label: 'Near Miss', value: String(finalSig.nearMisses), color: '#f59e0b' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: ACCENT },
            { label: 'Misses', value: String(finalSig.misses), color: '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.bullseyes >= 4} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const TrustFall = dynamic(() => Promise.resolve({ default: TrustFallInner }), { ssr: false });
export default TrustFall;
