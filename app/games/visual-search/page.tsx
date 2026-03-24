'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'visual-search';
const ACCENT = '#10b981';
const DURATION = 45;
const GAME_EMOJI = '🔎';
const GAME_TITLE = 'Visual Search';
const GAME_TAGLINE = 'Find it. Tap it. Before the horde.';

interface Signals {
  total: number;
  found: number;
  missed: number;
  falseAlarms: number;
  avgReactionMs: number;
  totalMs: number;
  maxDistroctors: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = (sig.found + sig.falseAlarms) > 0 ? sig.found / (sig.found + sig.falseAlarms) : 0;
  const avg = sig.found > 0 ? sig.totalMs / sig.found : 9999;
  if (acc >= 0.9 && avg < 700) return 'Eagle Eye 🦅';
  if (sig.maxDistroctors >= 20) return 'Crowd Spotter 🔎';
  if (acc >= 0.8) return 'Sharp Vision 👁️';
  if (avg < 900) return 'Fast Finder ⚡';
  return 'Scanning... 🔍';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

const ICONS = ['●', '■', '▲', '◆', '★', '✦', '⬟', '⬡', '⊕', '⊗', '⊞', '⊟'];

interface SearchItem {
  x: number; y: number;
  symbol: string;
  isTarget: boolean;
  alpha: number;
  scale: number;
  color: string;
  visible: boolean;
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  items: SearchItem[];
  targetSymbol: string;
  targetColor: string;
  shownAt: number;
  feedback: boolean | null;
  feedbackTimer: number;
  distractorCount: number;
  roundTimer: number;
}

export default function VisualSearchGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, found: 0, missed: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, maxDistroctors: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    items: [], targetSymbol: '', targetColor: '#ffffff',
    shownAt: 0, feedback: null, feedbackTimer: 0,
    distractorCount: 6, roundTimer: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const COLORS = ['#10b981', '#3b82f6', '#f43f5e', '#fbbf24', '#a855f7', '#fb923c'];

  const spawnRound = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;

    // Pick unique target (symbol + color combination)
    const targetSym = ICONS[Math.floor(Math.random() * ICONS.length)];
    const targetCol = COLORS[Math.floor(Math.random() * COLORS.length)];
    s.targetSymbol = targetSym; s.targetColor = targetCol;

    const count = s.distractorCount + 1; // 1 target + distractors
    const items: SearchItem[] = [];
    const positions: Array<{x:number,y:number}> = [];
    let targetPlaced = false;
    const targetIdx = Math.floor(Math.random() * count);

    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, ok = false, tries = 0;
      while (!ok && tries < 60) {
        tries++;
        x = 35 + Math.random() * (W - 70);
        y = 80 + Math.random() * (H - 160);
        ok = positions.every(p => Math.hypot(p.x - x, p.y - y) > 38);
      }
      positions.push({ x, y });

      const isTarget = i === targetIdx;
      if (isTarget) targetPlaced = true;

      // Distractor: same symbol different color, or different symbol same color
      let sym = targetSym, col = targetCol;
      if (!isTarget) {
        const diffType = Math.random() < 0.5 ? 'color' : 'symbol';
        if (diffType === 'color') {
          col = COLORS.filter(c => c !== targetCol)[Math.floor(Math.random() * 5)];
        } else {
          sym = ICONS.filter(ic => ic !== targetSym)[Math.floor(Math.random() * (ICONS.length - 1))];
        }
      }

      items.push({
        x, y, symbol: sym, isTarget, alpha: 1, scale: 1, color: col, visible: true,
      });
    }

    s.items = items;
    s.shownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0;
    s.roundTimer = 180 + s.distractorCount * 6; // time limit per round
    if (s.distractorCount > s.sig.maxDistroctors) s.sig.maxDistroctors = s.distractorCount;
  }, [COLORS]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, found: 0, missed: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, maxDistroctors: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.distractorCount = 6;
    spawnRound();
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

      if (s.feedbackTimer > 0) s.feedbackTimer--;

      // Background - search grid dark
      ctx.fillStyle = '#030e09'; ctx.fillRect(0, 0, W, H);
      // Scan lines
      ctx.strokeStyle = 'rgba(16,185,129,0.04)'; ctx.lineWidth = 1;
      for (let y = 0; y < H; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      if (s.feedback !== null && s.feedbackTimer > 0) {
        ctx.fillStyle = s.feedback ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)';
        ctx.fillRect(0, 0, W, H);
      }

      // Target indicator at top
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Find:', W / 2, 28);
      ctx.save();
      ctx.shadowBlur = 16; ctx.shadowColor = s.targetColor;
      ctx.fillStyle = s.targetColor; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(s.targetSymbol, W / 2, 56);
      ctx.restore();

      // Round timer bar
      s.roundTimer--;
      const timerPct = Math.max(0, s.roundTimer / (180 + s.distractorCount * 6));
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, 65, W - 40, 4);
      ctx.fillStyle = timerPct > 0.5 ? ACCENT : timerPct > 0.25 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(20, 65, (W - 40) * timerPct, 4);

      // Timeout
      if (s.roundTimer <= 0 && s.feedback === null) {
        s.sig.total++; s.sig.missed++;
        s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = false; s.feedbackTimer = 15;
        setTimeout(() => { if (s.running) spawnRound(); }, 500);
      }

      // Draw items (jitter slightly)
      s.items.forEach(item => {
        if (!item.visible) return;
        const jitter = s.feedback === null ? (Math.random() - 0.5) * 0.5 : 0;
        ctx.save();
        ctx.globalAlpha = item.alpha;
        ctx.shadowBlur = item.isTarget && s.feedback !== null ? 20 : 4;
        ctx.shadowColor = item.color;
        ctx.fillStyle = item.color;
        ctx.font = `bold ${20 * item.scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(item.symbol, item.x + jitter, item.y + jitter + 7);
        ctx.restore();
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
  }, [endGame, spawnRound]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.feedback !== null) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);

      let hitItem: SearchItem | null = null;
      s.items.forEach(item => {
        if (Math.hypot(px - item.x, py - item.y) < 28) hitItem = item;
      });

      if (!hitItem) return;
      const item = hitItem as SearchItem;
      const ms = Date.now() - s.shownAt;
      s.sig.total++;

      if (item.isTarget) {
        s.sig.found++;
        s.sig.totalMs += ms;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const speedPts = ms < 700 ? 3 : ms < 1500 ? 2 : 1;
        s.sig.score += speedPts + Math.floor(s.distractorCount / 6);
        setScoreDisplay(s.sig.score);
        s.distractorCount = Math.min(22, s.distractorCount + 2);
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.feedback = true; s.feedbackTimer = 15;
        s.floats.push({ x: item.x, y: item.y - 25, text: `+${speedPts} FOUND!`, alpha: 1, vy: -2.5, color: '#fbbf24' });
      } else {
        s.sig.falseAlarms++;
        s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = false; s.feedbackTimer = 15;
        s.floats.push({ x: px, y: py - 20, text: 'WRONG!', alpha: 1, vy: -2, color: '#ef4444' });
      }
      setTimeout(() => { if (s.running) spawnRound(); }, 550);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, spawnRound]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Find and tap the matching symbol among distractors!" ctaLabel="Search! 🔎" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Visual Search game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Found', value: String(finalSig.found), color: ACCENT },
            { label: 'Avg Speed', value: `${finalSig.found > 0 ? Math.round(finalSig.totalMs / finalSig.found) : 0}ms`, color: '#fbbf24' },
            { label: 'False Alarms', value: String(finalSig.falseAlarms), color: finalSig.falseAlarms === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Max Grid', value: String(finalSig.maxDistroctors), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.found >= 10} />
      )}
    </GameShell>
  );
}
