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

const GAME_ID = 'tower-stack';
const ACCENT = '#818cf8';
const DURATION = 45;
const GAME_EMOJI = '🧱';
const GAME_TITLE = 'Tower Stack';
const GAME_TAGLINE = 'Tap to stack. Build it sky-high!';
const BG_COLOR = '#0b0c1a';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'drive';
const PB_KEY = 'mg_pb_tower-stack';
const BLOCK_H = 28;
const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#818cf8', '#38bdf8', '#34d399', '#fb923c'];

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  if (sig.score >= 15) return '🏆 Sky Architect';
  if (sig.score >= 10) return '🧱 Master Stacker';
  if (sig.maxStreak >= 5) return '🎯 Precision Builder';
  if (sig.hits < 3) return '💥 Demo Expert';
  return '🏗️ Steady Builder';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

interface Block { x: number; width: number; color: string; }

export default function TowerStackGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [] as number[], maxStreak: 0, streakCurrent: 0 },
    blocks: [] as Block[],
    movingX: 0, movingDir: 1, movingSpeed: 3, movingWidth: 120,
    cameraY: 0, targetCameraY: 0,
    dropAnim: 0, dropX: 0,
    popText: '', popAlpha: 0, popY: 0,
    blockTime: 0, lastTs: 0, gameOver: false,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const dropBlock = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.blocks.length === 0 || s.gameOver) return;
    const top = s.blocks[s.blocks.length - 1];
    const overlap = Math.min(top.x + top.width, s.movingX + s.movingWidth) - Math.max(top.x, s.movingX);
    s.sig.attempts++;
    s.sig.reactionTimes.push(Date.now() - s.blockTime);

    if (overlap <= 4) {
      // Miss - game over
      sfx.fail(); haptic([80, 40, 80]);
      s.gameOver = true;
      s.sig.streakCurrent = 0;
      s.popText = 'TOPPLED! 💥'; s.popAlpha = 1; s.popY = 80;
      setTimeout(() => { if (s.running) endGame(); }, 1000);
      return;
    }

    // Calculate new block
    const newX = Math.max(top.x, s.movingX);
    const newW = overlap;
    const colorIdx = s.blocks.length % COLORS.length;
    s.blocks.push({ x: newX, width: newW, color: COLORS[colorIdx] });

    // Precision bonus
    const center = top.x + top.width / 2;
    const movingCenter = s.movingX + s.movingWidth / 2;
    const offset = Math.abs(center - movingCenter);
    const perfect = offset < top.width * 0.07;
    const pts = perfect ? 2 : 1;
    s.sig.hits++; s.sig.streakCurrent++;
    if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
    s.sig.score += s.sig.streakCurrent >= 3 ? pts + 1 : pts;
    setScoreDisplay(s.sig.score);

    sfx.collect(); haptic([30]);
    s.popText = perfect ? '⭐ PERFECT! +2' : s.sig.streakCurrent >= 3 ? `🔥 COMBO! +${pts + 1}` : '+1';
    s.popAlpha = 1; s.popY = 60;
    s.dropAnim = 1; s.dropX = newX + newW / 2;

    // Update moving block
    s.movingWidth = Math.max(40, newW);
    s.movingX = newX + newW / 2 - s.movingWidth / 2;
    s.movingSpeed = Math.min(2 + s.blocks.length * 0.15, 6);
    s.targetCameraY = Math.max(0, (s.blocks.length - 6) * BLOCK_H);
    s.blockTime = Date.now();
  }, [endGame]);

  const startLoop = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.gameOver = false;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic(MUSIC_PAT);
    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);

    // Init first block centered
    const initW = 140;
    s.blocks = [{ x: -initW / 2, width: initW, color: COLORS[0] }];
    s.movingWidth = initW; s.movingX = -initW / 2;
    s.movingDir = 1; s.movingSpeed = 3; s.cameraY = 0; s.targetCameraY = 0;
    s.blockTime = Date.now();

    const loop = (ts: number) => {
      if (!s.running) return;
      const dt = s.lastTs ? Math.min((ts - s.lastTs) / 16.67, 3) : 1;
      s.lastTs = ts;
      const W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H);

      // Smooth camera
      s.cameraY += (s.targetCameraY - s.cameraY) * 0.08 * dt;

      // Background - starfield
      ctx.fillStyle = BG_COLOR; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) {
        const sx = (i * 137 + 17) % W;
        const sy = (i * 97 + 23) % (H * 0.9);
        const alpha = 0.2 + 0.5 * ((Math.sin(ts / 1000 + i) + 1) / 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }

      const groundY = H * 0.85;
      const baseY = groundY; // bottom of stack

      // Draw ground
      ctx.fillStyle = '#1e293b'; ctx.fillRect(0, groundY, W, H - groundY);
      ctx.fillStyle = '#334155'; ctx.fillRect(W * 0.1, groundY, W * 0.8, 6);

      // Center X
      const centerX = W / 2;

      // Draw stack blocks (from bottom up)
      s.blocks.forEach((b, i) => {
        const by = baseY - (i + 1) * BLOCK_H - s.cameraY * 0;
        const bx = centerX + b.x;
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(bx + 3, by + 3, b.width, BLOCK_H);
        // Block
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.roundRect(bx, by, b.width, BLOCK_H - 2, 4); ctx.fill();
        // Highlight
        const grad = ctx.createLinearGradient(bx, by, bx, by + BLOCK_H);
        grad.addColorStop(0, 'rgba(255,255,255,0.2)'); grad.addColorStop(1, 'rgba(0,0,0,0.1)');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.roundRect(bx, by, b.width, BLOCK_H - 2, 4); ctx.fill();
      });

      // Height indicator on the left
      if (s.blocks.length > 1) {
        ctx.fillStyle = ACCENT + 'aa'; ctx.font = '13px monospace'; ctx.textAlign = 'left';
        ctx.fillText(`H: ${s.blocks.length - 1}`, 12, 80);
      }

      // Moving block (sweeps at top of stack)
      if (!s.gameOver) {
        const topBlock = s.blocks[s.blocks.length - 1];
        const topY = baseY - s.blocks.length * BLOCK_H;
        const movY = topY - BLOCK_H;

        // Bounce moving block
        s.movingX += s.movingDir * s.movingSpeed * dt;
        const leftBound = centerX - W * 0.42;
        const rightBound = centerX + W * 0.42 - s.movingWidth;
        if (s.movingX >= rightBound) { s.movingX = rightBound; s.movingDir = -1; }
        if (s.movingX <= leftBound) { s.movingX = leftBound; s.movingDir = 1; }

        // Alignment guide (shows if moving block is over top block)
        const alignStart = Math.max(centerX + topBlock.x, centerX + s.movingX);
        const alignEnd = Math.min(centerX + topBlock.x + topBlock.width, centerX + s.movingX + s.movingWidth);
        if (alignEnd > alignStart) {
          ctx.strokeStyle = 'rgba(74,222,128,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(alignStart, movY); ctx.lineTo(alignStart, topY + 2);
          ctx.moveTo(alignEnd, movY); ctx.lineTo(alignEnd, topY + 2);
          ctx.stroke(); ctx.setLineDash([]);
        }

        // Moving block
        const colorIdx = s.blocks.length % COLORS.length;
        ctx.fillStyle = COLORS[colorIdx];
        ctx.beginPath(); ctx.roundRect(centerX + s.movingX, movY, s.movingWidth, BLOCK_H - 2, 4); ctx.fill();
        // Shine
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.roundRect(centerX + s.movingX + 2, movY + 2, s.movingWidth - 4, 6, 2); ctx.fill();

        // Arrow hint at top
        ctx.fillStyle = ACCENT; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('TAP TO DROP', W / 2, 36);
      }

      // Drop flash
      if (s.dropAnim > 0) {
        s.dropAnim -= 0.06 * dt;
        ctx.fillStyle = `rgba(255,255,255,${s.dropAnim * 0.3})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Pop text
      if (s.popAlpha > 0) {
        s.popAlpha -= 0.022 * dt; s.popY -= 0.5 * dt;
        ctx.globalAlpha = Math.max(0, s.popAlpha);
        ctx.fillStyle = s.popText.includes('PERFECT') ? '#f59e0b' : s.popText.includes('TOPPLED') ? '#ef4444' : ACCENT;
        ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.popText, W / 2, s.popY); ctx.globalAlpha = 1;
      }

      // Streak
      if (s.sig.streakCurrent >= 3) {
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(`🔥 x${s.sig.streakCurrent}`, W - 12, 80);
      }

      // Timer pulse
      if (s.timeLeft <= 5) {
        const pulse = 0.5 + 0.5 * Math.sin(ts / 120);
        ctx.fillStyle = `rgba(239,68,68,${pulse * 0.18})`; ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onTap = () => { if (phase === 'playing') dropBlock(); };
    c.addEventListener('pointerdown', onTap);
    return () => { window.removeEventListener('resize', resize); c.removeEventListener('pointerdown', onTap); };
  }, [phase, dropBlock]);

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
      { label: 'Precision', value: acc + '%', color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Height', value: `${sig.hits} blk`, color: ACCENT },
      { label: 'Best Run', value: '🔥' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && <>
        <canvas ref={canvasRef} aria-label="Tower Stack game canvas" role="img"
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
