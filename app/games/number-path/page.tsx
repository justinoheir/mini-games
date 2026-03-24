'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'number-path';
const ACCENT = '#22c55e';
const DURATION = 45;
const GAME_EMOJI = '🔢';
const GAME_TITLE = 'Number Path';
const GAME_TAGLINE = '1 to N. Fastest finger wins.';

interface Signals {
  sequencesCompleted: number;
  highestN: number;          // highest N reached in a sequence
  totalNumbers: number;      // total numbers tapped correctly
  wrongTaps: number;
  avgSequenceMs: number;
  totalSequenceMs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  if (sig.highestN >= 10 && sig.sequencesCompleted >= 4) return 'Number Ninja 🥷';
  if (sig.sequencesCompleted >= 5) return 'Sequential Pro 📊';
  if (sig.highestN >= 8) return 'Pattern Spotter 🔢';
  if (sig.wrongTaps === 0 && sig.sequencesCompleted >= 2) return 'Perfect Order ✨';
  return 'Counting Up 💡';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface NumberNode {
  x: number; y: number;
  value: number;
  tapped: boolean;
  isCurrent: boolean; // the next one to tap
}

interface PathSegment {
  x1: number; y1: number; x2: number; y2: number;
  alpha: number;
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  nodes: NumberNode[];
  currentIndex: number; // which number to tap next (0-based)
  pathSegments: PathSegment[];
  sequenceStartMs: number;
  n: number; // current max number
  pulseFrame: number;
}

function generateNodes(W: number, H: number, n: number): NumberNode[] {
  const margin = 50;
  const nodes: NumberNode[] = [];
  const positions: Array<{ x: number; y: number }> = [];
  let attempts = 0;
  for (let i = 1; i <= n; i++) {
    let x = 0, y = 0, ok = false;
    while (!ok && attempts < 100) {
      attempts++;
      x = margin + Math.random() * (W - margin * 2);
      y = margin * 2 + Math.random() * (H - margin * 3);
      ok = positions.every(p => Math.hypot(p.x - x, p.y - y) > 55);
    }
    positions.push({ x, y });
    nodes.push({ x, y, value: i, tapped: false, isCurrent: i === 1 });
  }
  return nodes;
}

export default function NumberPathGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { sequencesCompleted: 0, highestN: 0, totalNumbers: 0, wrongTaps: 0, avgSequenceMs: 0, totalSequenceMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    nodes: [], currentIndex: 0, pathSegments: [],
    sequenceStartMs: 0, n: 6, pulseFrame: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const spawnSequence = useCallback((W: number, H: number) => {
    const s = stateRef.current;
    s.nodes = generateNodes(W, H, s.n);
    s.currentIndex = 0;
    s.pathSegments = [];
    s.sequenceStartMs = Date.now();
  }, []);

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
    const W = canvas.width, H = canvas.height;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { sequencesCompleted: 0, highestN: 0, totalNumbers: 0, wrongTaps: 0, avgSequenceMs: 0, totalSequenceMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.n = 6;
    spawnSequence(W, H);
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++; s.pulseFrame++;

      // Background - dark tech grid
      ctx.fillStyle = '#030d06'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(34,197,94,0.06)'; ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 40) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (let gy = 0; gy < H; gy += 40) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // Draw path segments (already tapped connections)
      s.pathSegments.forEach(seg => {
        ctx.save(); ctx.globalAlpha = seg.alpha;
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 3;
        ctx.shadowBlur = 8; ctx.shadowColor = ACCENT;
        ctx.beginPath(); ctx.moveTo(seg.x1, seg.y1); ctx.lineTo(seg.x2, seg.y2); ctx.stroke();
        ctx.restore();
        seg.alpha = Math.max(0.2, seg.alpha - 0.005);
      });

      // Draw nodes
      s.nodes.forEach(node => {
        const pulse = Math.sin(s.pulseFrame * 0.12) * 3;
        const r = 24 + (node.isCurrent ? pulse : 0);

        ctx.save();
        ctx.shadowBlur = node.isCurrent ? 20 : node.tapped ? 4 : 8;
        ctx.shadowColor = node.tapped ? '#4ade8044' : node.isCurrent ? '#fbbf24' : ACCENT;

        // Circle
        ctx.fillStyle = node.tapped ? '#0a3a1a' : node.isCurrent ? '#fbbf2422' : '#0a2a16';
        ctx.strokeStyle = node.tapped ? '#22c55e55' : node.isCurrent ? '#fbbf24' : ACCENT;
        ctx.lineWidth = node.isCurrent ? 3 : 2;
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        // Number text
        ctx.fillStyle = node.tapped ? '#22c55e66' : node.isCurrent ? '#fbbf24' : '#ffffff';
        ctx.font = `bold ${r * 0.9}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(String(node.value), node.x, node.y + r * 0.3);

        // Checkmark for tapped
        if (node.tapped) {
          ctx.fillStyle = '#4ade80'; ctx.font = `${r * 0.7}px sans-serif`;
          ctx.fillText('✓', node.x, node.y + r * 0.3);
        }

        // Pulsing ring for current
        if (node.isCurrent) {
          ctx.globalAlpha = 0.3 + 0.2 * Math.sin(s.pulseFrame * 0.2);
          ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(node.x, node.y, r + 12, 0, Math.PI * 2); ctx.stroke();
        }

        ctx.restore();
      });

      // Progress label
      const tapped = s.nodes.filter(n => n.tapped).length;
      ctx.fillStyle = 'rgba(34,197,94,0.7)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${tapped} / ${s.n}`, W / 2, 30);

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
  }, [endGame, spawnSequence]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);

      // Find tapped node
      let hit = -1;
      s.nodes.forEach((node, i) => {
        if (!node.tapped && Math.hypot(px - node.x, py - node.y) < 35) hit = i;
      });

      if (hit < 0) return;
      const node = s.nodes[hit];

      if (node.isCurrent) {
        // Correct!
        const prevNode = s.currentIndex > 0 ? s.nodes[s.currentIndex - 1] : null;
        if (prevNode) {
          s.pathSegments.push({ x1: prevNode.x, y1: prevNode.y, x2: node.x, y2: node.y, alpha: 1 });
        }
        node.tapped = true; node.isCurrent = false;
        s.currentIndex++;
        s.sig.totalNumbers++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        sfx.collect(); hapticImpact();

        // Next node becomes current
        if (s.currentIndex < s.nodes.length) {
          s.nodes[s.currentIndex].isCurrent = true;
        } else {
          // Sequence complete!
          const seqMs = Date.now() - s.sequenceStartMs;
          s.sig.sequencesCompleted++;
          s.sig.totalSequenceMs += seqMs;
          if (s.n > s.sig.highestN) s.sig.highestN = s.n;
          const timePts = seqMs < 3000 ? 5 : seqMs < 5000 ? 3 : 2;
          s.sig.score += s.n + timePts;
          setScoreDisplay(s.sig.score);
          sfx.collect(); hapticCombo(s.sig.sequencesCompleted);
          s.floats.push({ x: canvas.width / 2, y: canvas.height / 2, text: `+${s.n + timePts} ✨ DONE!`, alpha: 1, vy: -3, color: '#fbbf24' });
          s.n = Math.min(s.n + 1, 12); // increase sequence length
          setTimeout(() => { if (s.running) spawnSequence(canvas.width, canvas.height); }, 800);
        }
      } else if (!node.tapped) {
        // Wrong number
        s.sig.wrongTaps++;
        s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.floats.push({ x: node.x, y: node.y - 25, text: `Need ${s.currentIndex + 1}!`, alpha: 1, vy: -2, color: '#ef4444' });
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, spawnSequence]);

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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Tap numbers 1, 2, 3... in order as fast as you can!" ctaLabel="Count! 🔢" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Number Path game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Sequences', value: String(finalSig.sequencesCompleted), color: ACCENT },
            { label: 'Highest N', value: String(finalSig.highestN), color: '#fbbf24' },
            { label: 'Wrong Taps', value: String(finalSig.wrongTaps), color: finalSig.wrongTaps === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.sequencesCompleted >= 4} />
      )}
    </GameShell>
  );
}
