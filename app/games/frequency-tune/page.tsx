/**
 * ══════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — FREQUENCY TUNE
 *  A tone plays. Tap the grid tile that matches the frequency.
 *  Each tile shows an animated sine wave — visual frequency clue.
 *
 *  Signals: correctTaps, wrongTaps, avgReactionMs, maxStreak
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
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

// ── Constants ────────────────────────────────────────────────────────────────
const GAME_ID   = 'frequency-tune';
const PB_KEY    = 'mg_pb_frequency-tune';
const ACCENT    = '#a78bfa';
const DURATION  = 45;
const GAME_EMOJI   = '🎵';
const GAME_TITLE   = 'Frequency Tune';
const GAME_TAGLINE = 'Hear the tone. Tap the matching frequency tile.';
const Q_TIMEOUT_MS = 4000;

// ── Frequency bank ────────────────────────────────────────────────────────────
const FREQS: { hz: number; label: string; color: string }[] = [
  { hz: 220,  label: '220 Hz',  color: '#3b82f6' },
  { hz: 330,  label: '330 Hz',  color: '#06b6d4' },
  { hz: 440,  label: '440 Hz',  color: '#4ade80' },
  { hz: 550,  label: '550 Hz',  color: '#facc15' },
  { hz: 660,  label: '660 Hz',  color: '#f97316' },
  { hz: 880,  label: '880 Hz',  color: '#ef4444' },
];
const NF = FREQS.length;

// ── Tone player (uses Tone.js directly) ───────────────────────────────────────
async function playToneHz(hz: number, durationS = 0.7) {
  try {
    const T = await import('tone');
    if (T.context.state !== 'running') await T.start();
    const synth = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.02, decay: 0.05, sustain: 0.9, release: 0.3 },
      volume: -8,
    }).toDestination();
    synth.triggerAttackRelease(hz, durationS);
    setTimeout(() => synth.dispose(), (durationS + 0.5) * 1000);
  } catch { /* audio not available */ }
}

// ── Signals ───────────────────────────────────────────────────────────────────
interface Signals {
  score: number;
  correctTaps: number;
  wrongTaps: number;
  avgReactionMs: number;
  maxStreak: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.correctTaps + sig.wrongTaps;
  const acc   = total > 0 ? sig.correctTaps / total : 0;
  if (acc >= 0.90 && sig.correctTaps >= 12) return 'Perfect Pitch 🎶';
  if (acc >= 0.80 && sig.correctTaps >= 8)  return 'Tone Listener 🎵';
  if (sig.correctTaps >= 10)                return 'Frequency Finder ⚡';
  return 'Training Ears 🌊';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ── Canvas drawing (sine wave tiles) ─────────────────────────────────────────
function drawSineWave(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  hz: number, color: string,
  glowing: boolean,
  phase: number,
) {
  const freq = hz / 220;        // visual cycles per tile width
  const amp  = h * 0.28;
  const cy   = y + h / 2;
  const pts  = Math.max(40, w * 2);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = glowing ? 2.5 : 1.8;
  if (glowing) { ctx.shadowBlur = 14; ctx.shadowColor = color; }
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const px = x + (i / pts) * w;
    const py = cy + amp * Math.sin(2 * Math.PI * freq * (i / pts) + phase);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

interface TileFlash { type: 'hit' | 'miss'; end: number; }

interface GameState {
  running: boolean; timeLeft: number; sig: Signals; accentColor: string;
  currentFreqIdx: number;   // the playing tone
  tileFlashes: Map<number, TileFlash>;
  streak: number;
  phase: number;            // animation phase (radians, increments per frame)
  waitingForTap: boolean;
  spawnMs: number;
  rxTimes: number[];
  qTimerId: ReturnType<typeof setTimeout> | null;
}

// ── Layout ───────────────────────────────────────────────────────────────────
interface Layout { tileW: number; tileH: number; gridX: number; gridY: number; }
function getLayout(W: number, H: number): Layout {
  const margin = 16, gap = 10, cols = 3, rows = 2;
  const tileW  = Math.floor((W - margin * 2 - gap * (cols - 1)) / cols);
  const tileH  = Math.floor(tileW * 0.6);
  const totalW = tileW * cols + gap * (cols - 1);
  const totalH = tileH * rows + gap * (rows - 1);
  return { tileW, tileH, gridX: Math.floor((W - totalW) / 2), gridY: Math.max(150, Math.floor((H - totalH) / 2)) };
}
function tilePos(i: number, l: Layout) {
  const gap = 10, col = i % 3, row = Math.floor(i / 3);
  return { x: l.gridX + col * (l.tileW + gap), y: l.gridY + row * (l.tileH + gap) };
}
function hitTest(x: number, y: number, l: Layout): number {
  for (let i = 0; i < NF; i++) {
    const { x: tx, y: ty } = tilePos(i, l);
    if (x >= tx && x <= tx + l.tileW && y >= ty && y <= ty + l.tileH) return i;
  }
  return -1;
}

// ── Rounded rect ─────────────────────────────────────────────────────────────
function rRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y); ctx.lineTo(x + w - rad, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad); ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad); ctx.quadraticCurveTo(x, y, x + rad, y); ctx.closePath();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, s: GameState) {
  const now = performance.now();
  const l   = getLayout(W, H);

  // Background
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.65, Math.max(W, H));
  bg.addColorStop(0, '#090511'); bg.addColorStop(0.7, '#050309'); bg.addColorStop(1, '#020105');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // "Tap the tone" label (above tiles)
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.font = `700 ${Math.max(14, Math.floor(W * 0.038))}px -apple-system, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('TAP THE MATCHING FREQUENCY', W / 2, l.gridY - 12);
  ctx.restore();

  // Replay button (below tiles)
  const totalTileH = l.tileH * 2 + 10;
  const replayY = l.gridY + totalTileH + 20;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.max(13, Math.floor(W * 0.033))}px -apple-system, sans-serif`;
  ctx.fillStyle = `${s.accentColor}aa`;
  ctx.fillText('▶ REPLAY TONE', W / 2, replayY + 14);
  ctx.restore();

  // Tiles
  for (let i = 0; i < NF; i++) {
    const { x, y } = tilePos(i, l);
    const f      = FREQS[i];
    const flash  = s.tileFlashes.get(i);
    const flashAlive = flash !== undefined && now < flash.end;

    ctx.save();
    // Tile background
    if (flashAlive && flash) {
      ctx.fillStyle = flash.type === 'hit' ? `${f.color}33` : 'rgba(239,68,68,0.25)';
      ctx.strokeStyle = flash.type === 'hit' ? f.color : '#ef4444';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 18; ctx.shadowColor = flash.type === 'hit' ? f.color : '#ef4444';
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = `${f.color}55`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;
    }
    rRect(ctx, x, y, l.tileW, l.tileH, 10); ctx.fill(); ctx.stroke();
    ctx.restore();

    // Sine wave
    const isActive = s.waitingForTap && s.currentFreqIdx === i;
    drawSineWave(ctx, x + 8, y, l.tileW - 16, l.tileH - 24, f.hz, f.color, isActive, s.phase * (f.hz / 220));

    // Frequency label
    ctx.save();
    ctx.fillStyle = flashAlive ? (flash?.type === 'hit' ? f.color : '#ef4444') : `${f.color}bb`;
    ctx.font = `700 ${Math.max(11, Math.floor(l.tileW * 0.13))}px -apple-system, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(f.label, x + l.tileW / 2, y + l.tileH - 4);
    ctx.restore();
  }

  // Streak
  if (s.streak >= 3) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(14, Math.floor(W * 0.036))}px -apple-system, sans-serif`;
    ctx.fillStyle = '#fbbf24'; ctx.shadowBlur = 8; ctx.shadowColor = '#fbbf24';
    ctx.fillText(`×${s.streak} STREAK!`, W / 2, replayY + 40);
    ctx.restore();
  }
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function FrequencyTuneGame() {
  const theme       = useBrandTheme();
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const phaseRef    = useRef<Phase>('start');

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION, accentColor: ACCENT,
    sig: { score: 0, correctTaps: 0, wrongTaps: 0, avgReactionMs: 0, maxStreak: 0 },
    currentFreqIdx: 0, tileFlashes: new Map(), streak: 0,
    phase: 0, waitingForTap: false, spawnMs: 0, rxTimes: [],
    qTimerId: null,
  });

  const [phase, setPhase]           = useState<Phase>('start');
  const [timeLeft, setTimeLeft]     = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]     = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest]   = useState(false);
  const playerSessionRef            = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextQuestion = useCallback((s: GameState) => {
    if (s.qTimerId) { clearTimeout(s.qTimerId); s.qTimerId = null; }
    const prev = s.currentFreqIdx;
    let next: number;
    do { next = Math.floor(Math.random() * NF); } while (next === prev && NF > 1);
    s.currentFreqIdx = next;
    s.waitingForTap  = true;
    s.spawnMs        = Date.now();
    playToneHz(FREQS[next].hz);

    s.qTimerId = setTimeout(() => {
      if (!s.running || !s.waitingForTap) return;
      s.waitingForTap = false;
      s.sig.wrongTaps++;
      s.streak = 0;
      s.sig.score = Math.max(0, s.sig.score - 3);
      sfx.collision(); haptic([20, 30, 20]);
      setTimeout(() => { if (s.running) nextQuestion(s); }, 500);
    }, Q_TIMEOUT_MS);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false; s.waitingForTap = false;
    if (s.qTimerId) { clearTimeout(s.qTimerId); s.qTimerId = null; }
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.success(); haptic([100]);
    const avg = s.rxTimes.length > 0
      ? Math.round(s.rxTimes.reduce((a, b) => a + b, 0) / s.rxTimes.length) : 0;
    s.sig.avgReactionMs = avg;
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10);
      if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    phaseRef.current = 'done'; setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, correctTaps: 0, wrongTaps: 0, avgReactionMs: 0, maxStreak: 0 };
    s.streak = 0; s.phase = 0; s.rxTimes = [];
    setScoreDisplay(0); setTimeLeft(DURATION);
    phaseRef.current = 'playing'; setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft > 0 && s.timeLeft < 10) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    setTimeout(() => { if (s.running) nextQuestion(s); }, 400);

    const loop = (now: number) => {
      if (!s.running) return;
      s.phase += 0.04;
      // Clean expired flashes
      for (const [k, fl] of s.tileFlashes) {
        if (now >= fl.end) s.tileFlashes.delete(k);
      }
      drawFrame(ctx, window.innerWidth, window.innerHeight, s);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, nextQuestion]);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.offsetWidth / rect.width);
    const y = (clientY - rect.top)  * (canvas.offsetHeight / rect.height);
    const l = getLayout(window.innerWidth, window.innerHeight);

    // Check replay button
    const totalTileH = l.tileH * 2 + 10;
    const replayY = l.gridY + totalTileH + 12;
    if (x >= l.gridX && x <= l.gridX + l.tileW * 3 + 20 && y >= replayY && y <= replayY + 36) {
      playToneHz(FREQS[s.currentFreqIdx].hz);
      sfx.click(); return;
    }

    if (!s.waitingForTap) return;

    const idx = hitTest(x, y, l);
    if (idx < 0) return;

    if (s.qTimerId) { clearTimeout(s.qTimerId); s.qTimerId = null; }
    s.waitingForTap = false;
    const rxMs = Date.now() - s.spawnMs;

    if (idx === s.currentFreqIdx) {
      s.tileFlashes.set(idx, { type: 'hit', end: performance.now() + 350 });
      s.rxTimes.push(rxMs);
      s.streak++;
      if (s.streak > s.sig.maxStreak) s.sig.maxStreak = s.streak;
      const pts = 10 + (s.streak >= 3 ? 5 : 0) + (rxMs < 1500 ? 5 : 0);
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      s.sig.correctTaps++;
      sfx.collect(); haptic([30]);
    } else {
      s.tileFlashes.set(idx, { type: 'miss', end: performance.now() + 350 });
      s.streak = 0;
      s.sig.score = Math.max(0, s.sig.score - 5); setScoreDisplay(s.sig.score);
      s.sig.wrongTaps++;
      sfx.collision(); haptic([20, 30, 20]);
    }
    setTimeout(() => { if (s.running) nextQuestion(s); }, 350);
  }, [nextQuestion]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      canvas.width  = window.innerWidth  * dpr;
      canvas.height = window.innerHeight * dpr;
      const c = canvas.getContext('2d');
      if (c) c.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); window.addEventListener('resize', resize);
    const onDown = (e: PointerEvent) => { if (phaseRef.current === 'playing') handleTap(e.clientX, e.clientY); };
    canvas.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onDown); };
  }, [handleTap]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const s = stateRef.current;
    if (s.qTimerId) clearTimeout(s.qTimerId);
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); phaseRef.current = 'countdown'; setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    phaseRef.current = 'countdown'; setPhase('countdown');
  }, []);

  const buildInsights = useCallback((sig: Signals) => {
    const total = sig.correctTaps + sig.wrongTaps;
    const acc   = total > 0 ? Math.round(sig.correctTaps / total * 100) : 0;
    const ac    = theme.colors.accent ?? ACCENT;
    return [
      { label: 'Correct',     value: String(sig.correctTaps), color: sig.correctTaps >= 12 ? '#4ade80' : ac },
      { label: 'Accuracy',    value: `${acc}%`, color: acc >= 85 ? '#4ade80' : acc >= 65 ? '#facc15' : '#ef4444' },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: sig.maxStreak >= 5 ? '#4ade80' : ac },
      { label: 'Avg Speed',   value: sig.avgReactionMs > 0 ? `${(sig.avgReactionMs / 1000).toFixed(1)}s` : '—', color: ac },
    ];
  }, [theme]);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(167,139,250,0.12) 0%, transparent 55%), linear-gradient(180deg, #090511 0%, #050309 50%, #020105 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} role="img" aria-label="Frequency Tune game canvas"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={accent} items={[
              { label: 'TIME',  value: timeLeft,     danger: timeLeft <= 10, testId: 'timer' },
              { label: 'SCORE', value: scoreDisplay, testId: 'score' },
            ]} />
          )}
        </>
      )}
      {isNewBest && phase === 'done' && (
        <div style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 90, background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', borderRadius: 20,
          padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000',
          whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(251,191,36,0.5)' }}>🏆 New Best!</div>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={accent}
            onPlayAgain={handlePlayAgain} didWin={finalSig.correctTaps >= 8} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}
