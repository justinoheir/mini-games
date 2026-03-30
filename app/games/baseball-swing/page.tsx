'use client';
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

const GAME_ID = 'baseball-swing';
const ACCENT = '#fbbf24';
const DURATION = 45;
const GAME_EMOJI = '⚾';
const GAME_TITLE = 'Baseball Swing';
const GAME_TAGLINE = 'Time your swing. Hit it out of the park!';
const BG_COLOR = '#0d0a04';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'sports';
const PB_KEY = 'mg_pb_baseball-swing';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  if (acc >= 0.7 && sig.maxStreak >= 4) return '⚾ Home Run Hero';
  if (acc >= 0.55) return '🪄 Clutch Hitter';
  if (sig.maxStreak >= 4) return '🔥 Hot Bat';
  if (sig.hits < 3) return '⚡ Three Strikes';
  return '🏟️ Solid Contact';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

type PitchType = 'fastball' | 'curveball' | 'slider';
interface Pitch {
  t: number; // 0→1 progress
  speed: number;
  type: PitchType;
  startX: number; endX: number;
  startY: number; endY: number;
  curve: number; // extra curve offset
}

export default function BaseballSwingGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [] as number[], maxStreak: 0, streakCurrent: 0 },
    pitch: null as Pitch | null,
    pitchState: 'idle' as 'idle' | 'incoming' | 'hit' | 'miss' | 'swingEarly',
    strikes: 0,
    batAngle: 0, batSwinging: false, batT: 0,
    hitType: '' as '' | 'homer' | 'hit' | 'foul',
    popText: '', popAlpha: 0, popX: 0, popY: 0,
    ballTrail: [] as { x: number; y: number; r: number }[],
    lastTs: 0, hitAnim: 0,
    pitchLabel: '',
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const newPitch = useCallback(() => {
    const s = stateRef.current;
    const types: PitchType[] = ['fastball', 'curveball', 'slider'];
    const type = types[Math.floor(Math.random() * (s.sig.hits < 3 ? 1 : 3))];
    const speedBase = 0.006 + Math.min(s.sig.hits * 0.0003, 0.005);
    s.pitch = {
      t: 0, type,
      speed: speedBase + (type === 'fastball' ? 0.002 : 0),
      startX: 0.5, startY: 0.18,
      endX: 0.5 + (type === 'slider' ? 0.12 : type === 'curveball' ? -0.1 : 0) + (Math.random() - 0.5) * 0.06,
      endY: 0.68,
      curve: type === 'curveball' ? 0.12 : type === 'slider' ? 0.08 : 0,
    };
    s.pitchLabel = type.charAt(0).toUpperCase() + type.slice(1);
    s.pitchState = 'incoming';
    s.sig.attempts++;
  }, []);

  const doSwing = useCallback((swipeVelX: number) => {
    const s = stateRef.current;
    if (!s.running || s.pitchState !== 'incoming' || !s.pitch) return;
    if (s.batSwinging) return;
    const c = canvasRef.current; if (!c) return;
    const H = c.height;

    // Check if ball is in strike zone (by Y progress)
    const ballT = s.pitch.t;
    const perfect = ballT >= 0.72 && ballT <= 0.88;
    const ok = ballT >= 0.62 && ballT <= 0.92;

    s.batSwinging = true; s.batT = 0;
    s.batAngle = swipeVelX * 0.5;
    s.sig.reactionTimes.push(Date.now());

    if (perfect) {
      s.hitType = 'homer'; s.pitchState = 'hit';
      sfx.success(); haptic([40, 20, 80]);
      s.sig.hits++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.sig.streakCurrent >= 3 ? 4 : 3;
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      s.popText = `HOME RUN! +${pts} 🏆`; s.popAlpha = 1; s.popX = c.width / 2; s.popY = H * 0.4;
      s.hitAnim = 1;
    } else if (ok) {
      s.hitType = 'hit'; s.pitchState = 'hit';
      sfx.collect(); haptic([30]);
      s.sig.hits++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      s.popText = s.sig.streakCurrent >= 3 ? `COMBO HIT! +${pts}` : `HIT! +${pts}`;
      s.popAlpha = 1; s.popX = c.width / 2; s.popY = H * 0.5;
    } else {
      // Too early or too late
      s.hitType = ''; s.pitchState = ballT < 0.55 ? 'swingEarly' : 'miss';
      sfx.nearMiss(); haptic([20, 30, 20]);
      s.sig.streakCurrent = 0; s.strikes++;
      s.popText = ballT < 0.55 ? 'TOO EARLY! ⚡' : 'STRIKE! 💨';
      s.popAlpha = 1; s.popX = c.width / 2; s.popY = H * 0.55;
    }

    setTimeout(() => {
      s.batSwinging = false; s.batAngle = 0; s.batT = 0;
      s.pitchState = 'idle'; s.pitch = null; s.hitType = '';
      if (s.running) setTimeout(() => newPitch(), 500);
    }, 700);
  }, [newPitch]);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.strikes = 0; s.pitch = null;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic(MUSIC_PAT);
    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);
    setTimeout(() => newPitch(), 800);

    const loop = (ts: number) => {
      if (!s.running) return;
      const dt = s.lastTs ? Math.min((ts - s.lastTs) / 16.67, 3) : 1;
      s.lastTs = ts;
      const W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);

      // Stadium background
      ctx.fillStyle = BG_COLOR; ctx.fillRect(0, 0, W, H);
      // Outfield gradient
      const fieldGrad = ctx.createRadialGradient(W / 2, H * 0.5, 10, W / 2, H * 0.5, W * 0.8);
      fieldGrad.addColorStop(0, '#1a3a0d'); fieldGrad.addColorStop(1, '#0d1e08');
      ctx.fillStyle = fieldGrad; ctx.fillRect(0, H * 0.1, W, H * 0.9);
      // Infield dirt circle
      ctx.fillStyle = '#8b6340aa';
      ctx.beginPath(); ctx.ellipse(W / 2, H * 0.72, W * 0.3, H * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      // Pitcher's mound
      ctx.fillStyle = '#a07040'; ctx.beginPath(); ctx.ellipse(W / 2, H * 0.2, 18, 8, 0, 0, Math.PI * 2); ctx.fill();

      // Strike zone indicator
      const szX = W * 0.38, szY = H * 0.6, szW = W * 0.24, szH = H * 0.12;
      ctx.strokeStyle = 'rgba(251,191,36,0.4)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.strokeRect(szX, szY, szW, szH); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(251,191,36,0.06)'; ctx.fillRect(szX, szY, szW, szH);

      // Pitch type label
      if (s.pitchState === 'incoming' && s.pitch && s.pitch.t < 0.3) {
        ctx.fillStyle = '#fbbf2488'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
        ctx.fillText(s.pitchLabel.toUpperCase(), W / 2, H * 0.14);
      }

      // Update & draw ball
      if (s.pitch && (s.pitchState === 'incoming')) {
        s.pitch.t += s.pitch.speed * dt;
        if (s.pitch.t > 1) {
          // Ball passed - auto miss
          sfx.nearMiss(); haptic([20, 30, 20]);
          s.pitchState = 'miss'; s.strikes++;
          s.sig.streakCurrent = 0;
          s.popText = 'CALLED STRIKE!'; s.popAlpha = 1; s.popX = W / 2; s.popY = H * 0.55;
          setTimeout(() => { s.pitchState = 'idle'; s.pitch = null; if (s.running) setTimeout(() => newPitch(), 600); }, 700);
        }

        const t = s.pitch.t;
        // Quadratic bezier with curve
        const cpX = (s.pitch.startX + s.pitch.endX) / 2 + s.pitch.curve;
        const cpY = (s.pitch.startY + s.pitch.endY) / 2;
        const bx = ((1 - t) * (1 - t) * s.pitch.startX + 2 * (1 - t) * t * cpX + t * t * s.pitch.endX) * W;
        const by = ((1 - t) * (1 - t) * s.pitch.startY + 2 * (1 - t) * t * cpY + t * t * s.pitch.endY) * H;
        const ballR = 5 + t * 16; // grows as it approaches

        // Trail
        s.ballTrail.unshift({ x: bx, y: by, r: ballR });
        if (s.ballTrail.length > 8) s.ballTrail.pop();
        s.ballTrail.forEach((p, i) => {
          ctx.globalAlpha = 0.3 * (1 - i / 9);
          ctx.fillStyle = '#f5f5f5';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.6, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalAlpha = 1;

        // Baseball
        ctx.fillStyle = '#f5f5f0';
        ctx.beginPath(); ctx.arc(bx, by, ballR, 0, Math.PI * 2); ctx.fill();
        // Stitches
        if (ballR > 10) {
          ctx.strokeStyle = '#cc0000'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(bx, by, ballR * 0.55, 0.2, 1.1); ctx.stroke();
          ctx.beginPath(); ctx.arc(bx, by, ballR * 0.55, Math.PI + 0.2, Math.PI + 1.1); ctx.stroke();
        }

        // "SWING!" prompt when in zone
        if (t >= 0.62 && t <= 0.88) {
          const pulse = 0.5 + 0.5 * Math.sin(ts / 80);
          ctx.fillStyle = `rgba(251,191,36,${pulse})`;
          ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('SWING!', W / 2, H * 0.53);
        }
      }

      // Draw bat
      const batX = W * 0.5, batY = H * 0.73;
      ctx.save();
      ctx.translate(batX, batY);
      if (s.batSwinging) {
        s.batT += 0.08 * dt;
        const swingAngle = Math.sin(s.batT * Math.PI) * (Math.PI * 0.8);
        ctx.rotate(-Math.PI * 0.5 + swingAngle);
      } else {
        ctx.rotate(Math.PI * 0.35);
      }
      // Bat shape
      ctx.fillStyle = '#92400e'; // handle
      ctx.fillRect(-5, -70, 10, 70);
      ctx.fillStyle = '#d97706'; // barrel
      ctx.beginPath(); ctx.ellipse(0, -70, 16, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Batter silhouette
      ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.arc(batX - 28, batY - 52, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111827'; ctx.fillRect(batX - 38, batY - 32, 22, 36);

      // Hit animation
      if (s.hitAnim > 0) {
        s.hitAnim -= 0.04 * dt;
        const starCount = 8;
        for (let i = 0; i < starCount; i++) {
          const a = (i / starCount) * Math.PI * 2;
          const r = (1 - s.hitAnim) * W * 0.35;
          const sx = W / 2 + Math.cos(a) * r;
          const sy = H * 0.5 + Math.sin(a) * r;
          ctx.fillStyle = `rgba(251,191,36,${s.hitAnim})`;
          ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('⭐', sx, sy);
        }
      }

      // Strike count
      ctx.fillStyle = '#64748b'; ctx.font = '13px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`STRIKES: ${s.strikes}`, 12, 80);

      // Streak
      if (s.sig.streakCurrent >= 3) {
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(`🔥 x${s.sig.streakCurrent}`, W - 12, 80);
      }

      // Pop text
      if (s.popAlpha > 0) {
        s.popAlpha -= 0.02 * dt; s.popY -= 0.4 * dt;
        ctx.globalAlpha = Math.max(0, s.popAlpha);
        ctx.fillStyle = s.popText.includes('HOME RUN') ? '#f59e0b' : s.popText.includes('STRIKE') || s.popText.includes('EARLY') ? '#ef4444' : ACCENT;
        ctx.font = `bold ${s.popText.includes('HOME RUN') ? 26 : 20}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.popText, s.popX, s.popY); ctx.globalAlpha = 1;
      }

      // Timer pulse
      if (s.timeLeft <= 5) {
        const pulse = 0.5 + 0.5 * Math.sin(ts / 120);
        ctx.fillStyle = `rgba(239,68,68,${pulse * 0.18})`; ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, newPitch]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onDown = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      swipeStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, t: Date.now() };
    };
    const onUp = (e: PointerEvent) => {
      if (!swipeStartRef.current) return;
      const rect = c.getBoundingClientRect();
      const dx = (e.clientX - rect.left) - swipeStartRef.current.x;
      const dt = Date.now() - swipeStartRef.current.t;
      swipeStartRef.current = null;
      if (Math.abs(dx) > 20 || dt < 200) doSwing(dx / Math.max(dt, 50));
    };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('resize', resize); c.removeEventListener('pointerdown', onDown); c.removeEventListener('pointerup', onUp); };
  }, [doSwing]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits / sig.attempts) * 100) : 0;
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Batting Avg', value: acc + '%', color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Hits', value: String(sig.hits), color: ACCENT },
      { label: 'Hot Streak', value: '🔥' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Batter Up!" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && <>
        <canvas ref={canvasRef} aria-label="Baseball Swing game canvas" role="img"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      </>}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 6} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
