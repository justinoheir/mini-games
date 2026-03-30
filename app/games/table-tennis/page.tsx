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

const GAME_ID = 'table-tennis';
const ACCENT = '#f0abfc';
const DURATION = 45;
const GAME_EMOJI = '🏓';
const GAME_TITLE = 'Table Tennis';
const GAME_TAGLINE = 'Swipe to return. Keep the rally alive!';
const BG_COLOR = '#0a0718';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'pulse';
const PB_KEY = 'mg_pb_table-tennis';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  if (acc >= 0.8 && sig.maxStreak >= 6) return '🏓 Table Tennis Pro';
  if (acc >= 0.65) return '🎯 Rally Master';
  if (sig.maxStreak >= 5) return '🔥 Hot Streak';
  return '🌊 Paddle Novice';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function TableTennisGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const paddleXRef = useRef(0.5);
  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [] as number[], maxStreak: 0, streakCurrent: 0 },
    // Ball
    bx: 0.5, by: 0.5, vx: 0, vy: 0,
    ballRadius: 10,
    // Paddle
    paddleW: 0.22, paddleH: 0.025,
    aiPaddleX: 0.5,
    // State
    state: 'serve' as 'serve' | 'rally' | 'scoring',
    lastHitter: 'ai' as 'player' | 'ai',
    serveTimer: 0,
    hitTime: 0,
    popText: '', popAlpha: 0, popX: 0, popY: 0,
    trailPoints: [] as { x: number; y: number; a: number }[],
    lastTs: 0, missAnim: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const serve = useCallback(() => {
    const s = stateRef.current;
    s.bx = 0.3 + Math.random() * 0.4;
    s.by = 0.35;
    s.vx = (Math.random() - 0.5) * 0.008;
    s.vy = 0.006 + Math.random() * 0.003;
    s.state = 'rally';
    s.lastHitter = 'ai';
    s.hitTime = Date.now();
    s.sig.attempts++;
  }, []);

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
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    s.trailPoints = []; s.aiPaddleX = 0.5; s.state = 'serve'; s.serveTimer = 90;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic(MUSIC_PAT);
    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);

    const loop = (ts: number) => {
      if (!s.running) return;
      const dt = s.lastTs ? Math.min((ts - s.lastTs) / 16.67, 3) : 1;
      s.lastTs = ts;
      const W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);

      // Background: ping pong table
      ctx.fillStyle = BG_COLOR; ctx.fillRect(0, 0, W, H);
      // Table
      const tX = W * 0.05, tY = H * 0.05, tW = W * 0.9, tH = H * 0.9;
      ctx.fillStyle = '#1e4d2e'; ctx.beginPath(); ctx.roundRect(tX, tY, tW, tH, 8); ctx.fill();
      // Table lines
      ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tX, H / 2); ctx.lineTo(tX + tW, H / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2, tY); ctx.lineTo(W / 2, tY + tH); ctx.stroke();
      // Net
      ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tX, H / 2); ctx.lineTo(tX + tW, H / 2); ctx.stroke();
      ctx.strokeStyle = '#ffffff44'; ctx.lineWidth = 1;
      for (let i = 0; i < 20; i++) {
        const nx = tX + (i * tW / 20);
        ctx.beginPath(); ctx.moveTo(nx, H / 2 - 6); ctx.lineTo(nx + tW / 40, H / 2 + 6); ctx.stroke();
      }
      // Table border
      ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(tX, tY, tW, tH, 8); ctx.stroke();

      const paddle = Math.max(0.05, Math.min(1 - s.paddleW - 0.05, paddleXRef.current - s.paddleW / 2));
      const playerPaddleY = 0.88;
      const aiPaddleY = 0.08;

      // AI tracks ball
      if (s.state === 'rally' && s.vy < 0) {
        const aiTarget = s.bx - s.paddleW / 2;
        s.aiPaddleX += (aiTarget - s.aiPaddleX) * 0.06 * dt * (0.7 + Math.random() * 0.3);
        s.aiPaddleX = Math.max(0.05, Math.min(0.95 - s.paddleW, s.aiPaddleX));
      }

      // Serve countdown
      if (s.state === 'serve') {
        s.serveTimer -= dt;
        if (s.serveTimer <= 0) serve();
      }

      // Ball physics
      if (s.state === 'rally') {
        s.bx += s.vx * dt;
        s.by += s.vy * dt;

        // Wall bounces
        if (s.bx < 0.03) { s.bx = 0.03; s.vx = Math.abs(s.vx); }
        if (s.bx > 0.97) { s.bx = 0.97; s.vx = -Math.abs(s.vx); }

        // Trail
        s.trailPoints.unshift({ x: s.bx * W, y: s.by * H, a: 0.6 });
        if (s.trailPoints.length > 12) s.trailPoints.pop();
        s.trailPoints.forEach(p => { p.a -= 0.05; });

        // Player paddle hit
        const ppx = paddle * W, ppy = playerPaddleY * H;
        const ppw = s.paddleW * W;
        if (s.vy > 0 && s.by >= playerPaddleY - 0.02 && s.by <= playerPaddleY + 0.02 && s.bx * W >= ppx && s.bx * W <= ppx + ppw && s.lastHitter !== 'player') {
          s.vy = -(0.007 + Math.abs(s.vy) * 0.3 + s.sig.streakCurrent * 0.0005);
          s.vx += (s.bx - (paddle + s.paddleW / 2)) * 0.012;
          s.lastHitter = 'player';
          s.sig.hits++; s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          s.sig.reactionTimes.push(Date.now() - s.hitTime); s.hitTime = Date.now();
          sfx.collect(); haptic([30]);
          s.popText = s.sig.streakCurrent >= 3 ? `RALLY x${s.sig.streakCurrent}! +${pts}` : '+1';
          s.popAlpha = 1; s.popX = s.bx * W; s.popY = ppy - 30;
        }

        // AI paddle hit
        const apx = s.aiPaddleX * W, apy = aiPaddleY * H, apw = s.paddleW * W;
        if (s.vy < 0 && s.by <= aiPaddleY + 0.02 && s.by >= aiPaddleY - 0.02 && s.bx * W >= apx && s.bx * W <= apx + apw && s.lastHitter !== 'ai') {
          s.vy = Math.abs(s.vy) * 0.9 + 0.004;
          s.vx += (s.bx - (s.aiPaddleX + s.paddleW / 2)) * 0.008;
          s.lastHitter = 'ai'; s.hitTime = Date.now();
          sfx.tick();
        }

        // Ball out of bounds
        if (s.by > 1.05) {
          // Player missed
          sfx.nearMiss(); haptic([20, 30, 20]);
          s.sig.streakCurrent = 0; s.sig.attempts++;
          s.missAnim = 1; s.state = 'serve'; s.serveTimer = 60;
        }
        if (s.by < -0.05) {
          // AI missed - bonus
          sfx.success(); haptic([30]);
          s.sig.score += 2; setScoreDisplay(s.sig.score);
          s.popText = 'ACE! +2'; s.popAlpha = 1; s.popX = W / 2; s.popY = H / 2;
          s.state = 'serve'; s.serveTimer = 60;
        }
      }

      // Draw ball trail
      s.trailPoints.forEach((p, i) => {
        const r = s.ballRadius * (1 - i / 14) * 0.7;
        ctx.globalAlpha = Math.max(0, p.a * 0.5);
        ctx.fillStyle = '#f0abfc';
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Draw ball
      if (s.state === 'rally') {
        const bpx = s.bx * W, bpy = s.by * H;
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(bpx, bpy + 4, s.ballRadius * 0.8, 3, 0, 0, Math.PI * 2); ctx.fill();
        // Ball
        const ballGrad = ctx.createRadialGradient(bpx - 3, bpy - 3, 1, bpx, bpy, s.ballRadius);
        ballGrad.addColorStop(0, '#ffffff'); ballGrad.addColorStop(1, '#e0e0e0');
        ctx.fillStyle = ballGrad;
        ctx.beginPath(); ctx.arc(bpx, bpy, s.ballRadius, 0, Math.PI * 2); ctx.fill();
      }

      // Draw player paddle
      const ppxPx = paddle * W, ppyPx = playerPaddleY * H;
      const ppwPx = s.paddleW * W, pphPx = s.paddleH * H;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.roundRect(ppxPx, ppyPx, ppwPx, pphPx, 5); ctx.fill();
      ctx.fillStyle = '#fca5a5';
      ctx.beginPath(); ctx.roundRect(ppxPx + 4, ppyPx + 2, ppwPx - 8, 4, 2); ctx.fill();
      // Handle
      ctx.fillStyle = '#b91c1c';
      ctx.beginPath(); ctx.roundRect(ppxPx + ppwPx * 0.4, ppyPx + pphPx, ppwPx * 0.2, 14, 3); ctx.fill();

      // Draw AI paddle
      const apxPx = s.aiPaddleX * W, apyPx = aiPaddleY * H;
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath(); ctx.roundRect(apxPx, apyPx, s.paddleW * W, s.paddleH * H, 5); ctx.fill();
      ctx.fillStyle = '#93c5fd';
      ctx.beginPath(); ctx.roundRect(apxPx + 4, apyPx + 2, s.paddleW * W - 8, 4, 2); ctx.fill();

      // Miss animation
      if (s.missAnim > 0) {
        s.missAnim -= 0.04 * dt;
        ctx.fillStyle = `rgba(239,68,68,${s.missAnim * 0.25})`;
        ctx.fillRect(0, H * 0.7, W, H * 0.3);
      }

      // Serve indicator
      if (s.state === 'serve') {
        const pct = Math.max(0, s.serveTimer / 60);
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W * 0.3, H / 2 - 18, W * 0.4, 16);
        ctx.fillStyle = ACCENT; ctx.fillRect(W * 0.3, H / 2 - 18, W * 0.4 * pct, 16);
        ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('SERVING...', W / 2, H / 2 - 26);
      }

      // Pop text
      if (s.popAlpha > 0) {
        s.popAlpha -= 0.022 * dt; s.popY -= 0.5 * dt;
        ctx.globalAlpha = Math.max(0, s.popAlpha);
        ctx.fillStyle = s.popText.includes('ACE') ? '#f59e0b' : ACCENT;
        ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.popText, s.popX, s.popY); ctx.globalAlpha = 1;
      }

      // Streak
      if (s.sig.streakCurrent >= 3) {
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`🏓 RALLY x${s.sig.streakCurrent}`, W / 2, H * 0.11);
      }

      // Timer pulse
      if (s.timeLeft <= 5) {
        const pulse = 0.5 + 0.5 * Math.sin(ts / 120);
        ctx.fillStyle = `rgba(239,68,68,${pulse * 0.18})`; ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, serve]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onMove = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      paddleXRef.current = (e.clientX - rect.left) / rect.width;
    };
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerdown', onMove);
    return () => { window.removeEventListener('resize', resize); c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerdown', onMove); };
  }, []);

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
    const avg = sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length) : 0;
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Return %', value: acc + '%', color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'React', value: avg + 'ms', color: ACCENT },
      { label: 'Max Rally', value: '🏓' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Serve!" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && <>
        <canvas ref={canvasRef} aria-label="Table Tennis game canvas" role="img"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
        {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      </>}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 8} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
