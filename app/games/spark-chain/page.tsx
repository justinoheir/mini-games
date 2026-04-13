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

const GAME_ID = 'spark-chain';
const ACCENT = '#f97316';
const DURATION = 60;
const GAME_EMOJI = '⚡';
const GAME_TITLE = 'Spark Chain';
const GAME_TAGLINE = 'One spark. Maximum spread.';

const NODE_COUNT = 28;
const SPREAD_RADIUS = 0.18; // normalized
const SPREAD_DELAY = 180; // ms per hop

interface Node { x: number; y: number; lit: boolean; litAt: number; spreading: boolean; }
interface Signals { rounds: number; bestCoverage: number; avgCoverage: number; totalCoverage: number; score: number; perfect: number; }
function getPersonality(sig: Signals): string {
  if (sig.bestCoverage >= 0.9 && sig.rounds >= 3) return 'Chain Reaction God ⚡';
  if (sig.bestCoverage >= 0.75) return 'Spark Master 🔥';
  if (sig.rounds >= 4 && sig.avgCoverage >= 0.5) return 'Strategic Thinker 🧠';
  if (sig.perfect >= 2) return 'Perfect Placer 🎯';
  return 'Learning the Web 🕸️';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
type RoundPhase = 'place' | 'spreading' | 'result';

interface GState {
  running: boolean; timeLeft: number; sig: Signals;
  nodes: Node[]; roundPhase: RoundPhase;
  litCount: number; totalCount: number;
  resultUntil: number; coverage: number;
  spreadQueue: Array<{ nodeIdx: number; spreadAt: number }>;
  roundFlash: string | null; flashUntil: number;
}

function generateNodes(W: number, H: number): Node[] {
  const nodes: Node[] = [];
  // Place nodes in a semi-random but somewhat spread layout
  for (let i = 0; i < NODE_COUNT; i++) {
    let x: number, y: number, attempts = 0;
    do {
      x = 0.08 + Math.random() * 0.84;
      y = 0.12 + Math.random() * 0.72;
      attempts++;
    } while (attempts < 20 && nodes.some(n => Math.hypot(n.x - x, n.y - y) < 0.1));
    nodes.push({ x, y, lit: false, litAt: 0, spreading: false });
  }
  return nodes;
}

function SparkChainInner() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<GState>({
    running: false, timeLeft: DURATION,
    sig: { rounds: 0, bestCoverage: 0, avgCoverage: 0, totalCoverage: 0, score: 0, perfect: 0 },
    nodes: [], roundPhase: 'place',
    litCount: 0, totalCount: NODE_COUNT,
    resultUntil: 0, coverage: 0,
    spreadQueue: [], roundFlash: null, flashUntil: 0,
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
    s.sig.avgCoverage = s.sig.rounds > 0 ? s.sig.totalCoverage / s.sig.rounds : 0;
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startNewRound = useCallback((W: number, H: number) => {
    const s = stateRef.current;
    s.nodes = generateNodes(W, H);
    s.roundPhase = 'place';
    s.litCount = 0;
    s.spreadQueue = [];
    s.roundFlash = null;
  }, []);

  const placeSpark = useCallback((tapX: number, tapY: number, W: number, H: number) => {
    const s = stateRef.current;
    if (s.roundPhase !== 'place') return;
    const nx = tapX / W, ny = tapY / H;
    // Find nearest node
    let best = -1, bestDist = 0.12;
    s.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - nx, n.y - ny);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    if (best === -1) best = s.nodes.reduce((bi, n, i) => Math.hypot(n.x - nx, n.y - ny) < Math.hypot(s.nodes[bi].x - nx, s.nodes[bi].y - ny) ? i : bi, 0);
    s.nodes[best].lit = true; s.nodes[best].litAt = Date.now(); s.litCount = 1;
    s.spreadQueue = [{ nodeIdx: best, spreadAt: Date.now() + SPREAD_DELAY }];
    s.roundPhase = 'spreading';
    sfx.click?.(); hapticImpact();
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { rounds: 0, bestCoverage: 0, avgCoverage: 0, totalCoverage: 0, score: 0, perfect: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    startNewRound(canvas.width, canvas.height);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); endGame(); }
    }, 1000);

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      if (!s.running) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const W = canvas.width, H = canvas.height;
      const now = Date.now();

      ctx.fillStyle = '#060010';
      ctx.fillRect(0, 0, W, H);

      // Flash
      if (s.roundFlash && now < s.flashUntil) {
        ctx.save(); ctx.globalAlpha = 0.15; ctx.fillStyle = s.roundFlash;
        ctx.fillRect(0, 0, W, H); ctx.restore();
      }

      // Spread logic
      if (s.roundPhase === 'spreading') {
        const toSpread = s.spreadQueue.filter(q => now >= q.spreadAt);
        const remaining = s.spreadQueue.filter(q => now < q.spreadAt);
        for (const item of toSpread) {
          const src = s.nodes[item.nodeIdx];
          s.nodes.forEach((n, i) => {
            if (!n.lit) {
              const dist = Math.hypot(n.x - src.x, n.y - src.y);
              if (dist <= SPREAD_RADIUS) {
                n.lit = true; n.litAt = now; s.litCount++;
                remaining.push({ nodeIdx: i, spreadAt: now + SPREAD_DELAY });
                sfx.collect?.();
              }
            }
          });
        }
        s.spreadQueue = remaining;
        if (s.spreadQueue.length === 0 && s.roundPhase === 'spreading') {
          // Chain done
          s.roundPhase = 'result';
          s.coverage = s.litCount / NODE_COUNT;
          const pts = Math.round(s.coverage * 200);
          s.sig.rounds++;
          s.sig.totalCoverage += s.coverage;
          if (s.coverage > s.sig.bestCoverage) s.sig.bestCoverage = s.coverage;
          s.sig.score += pts;
          if (s.coverage >= 0.9) s.sig.perfect++;
          setScoreDisplay(s.sig.score);
          s.roundFlash = s.coverage >= 0.7 ? '#22c55e' : s.coverage >= 0.4 ? '#f59e0b' : '#ef4444';
          s.flashUntil = now + 500;
          if (s.coverage >= 0.7) { sfx.success?.(); hapticScore(); }
          else hapticFail();
          s.resultUntil = now + 2000;
        }
      }

      if (s.roundPhase === 'result' && now > s.resultUntil) {
        startNewRound(W, H);
      }

      // Draw connections (edges within spread radius)
      ctx.save();
      for (let i = 0; i < s.nodes.length; i++) {
        for (let j = i + 1; j < s.nodes.length; j++) {
          const a = s.nodes[i], b = s.nodes[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist <= SPREAD_RADIUS * 1.1) {
            const bothLit = a.lit && b.lit;
            ctx.globalAlpha = bothLit ? 0.6 : 0.12;
            ctx.strokeStyle = bothLit ? '#f97316' : '#4a1040';
            ctx.lineWidth = bothLit ? 2 : 1;
            if (bothLit) { ctx.shadowColor = '#f97316'; ctx.shadowBlur = 8; }
            else { ctx.shadowBlur = 0; }
            ctx.beginPath();
            ctx.moveTo(a.x * W, a.y * H);
            ctx.lineTo(b.x * W, b.y * H);
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // Draw nodes
      for (const node of s.nodes) {
        const cx = node.x * W, cy = node.y * H;
        if (node.lit) {
          const age = now - node.litAt;
          const glow = Math.max(0.3, 1 - age / 2000);
          ctx.save();
          ctx.shadowColor = '#f97316'; ctx.shadowBlur = 20 * glow;
          ctx.fillStyle = age < 300 ? '#ffffff' : '#fb923c';
          ctx.beginPath(); ctx.arc(cx, cy, 10 + glow * 4, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        } else {
          ctx.save();
          ctx.fillStyle = '#2a1050';
          ctx.strokeStyle = '#6d28d9'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
      }

      // Status text
      ctx.save();
      ctx.textAlign = 'center';
      if (s.roundPhase === 'place') {
        ctx.fillStyle = '#f97316'; ctx.font = `bold ${Math.round(H * 0.03)}px Arial`;
        ctx.shadowColor = '#f97316'; ctx.shadowBlur = 15;
        ctx.fillText('TAP TO PLACE YOUR SPARK', W / 2, H * 0.92);
      } else if (s.roundPhase === 'spreading') {
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `${Math.round(H * 0.028)}px Arial`;
        ctx.fillText(`🔥 ${s.litCount} nodes lit...`, W / 2, H * 0.92);
      } else if (s.roundPhase === 'result') {
        const pct = Math.round(s.coverage * 100);
        ctx.fillStyle = s.coverage >= 0.7 ? '#22c55e' : '#f97316';
        ctx.font = `bold ${Math.round(H * 0.05)}px Arial`;
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 25;
        ctx.fillText(`${pct}% spread!`, W / 2, H * 0.9);
      }
      ctx.restore();

      // Lit counter top
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = `${Math.round(H * 0.022)}px Arial`;
      ctx.textAlign = 'right';
      ctx.fillText(`${s.litCount}/${NODE_COUNT} nodes`, W * 0.92, H * 0.06);
      ctx.restore();
    };
    draw();
  }, [endGame, startNewRound]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || phase !== 'playing') return;
    const resize = () => {
      canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
      startNewRound(canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);
    const onTap = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      placeSpark(e.clientX - rect.left, e.clientY - rect.top, canvas.width, canvas.height);
    };
    canvas.addEventListener('pointerdown', onTap);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onTap);
    };
  }, [phase, placeSpark, startNewRound]);

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

  const bestPct = finalSig ? Math.round(finalSig.bestCoverage * 100) : 0;
  const avgPct = finalSig ? Math.round(finalSig.avgCoverage * 100) : 0;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Tap to place one spark on the network. Watch it chain-react through connected nodes. Score based on how many you light up!"
          ctaLabel="Ignite ⚡" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Rounds', value: String(finalSig.rounds), color: ACCENT },
            { label: 'Best Spread', value: `${bestPct}%`, color: '#22c55e' },
            { label: 'Avg Spread', value: `${avgPct}%`, color: '#f59e0b' },
            { label: 'Perfect', value: String(finalSig.perfect), color: '#a855f7' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={bestPct >= 75} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const SparkChain = dynamic(() => Promise.resolve({ default: SparkChainInner }), { ssr: false });
export default SparkChain;
