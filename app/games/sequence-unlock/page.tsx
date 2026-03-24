'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo, hapticTick } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'sequence-unlock';
const ACCENT = '#a855f7';
const DURATION = 60;
const GAME_EMOJI = '💡';
const GAME_TITLE = 'Sequence Unlock';
const GAME_TAGLINE = 'Watch the lights. Repeat them.';

interface Signals {
  roundsCompleted: number;
  longestSequence: number;
  totalTaps: number;
  wrongTaps: number;
  avgPrecisionMs: number;
  totalPrecisionMs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  if (sig.longestSequence >= 8 && sig.wrongTaps === 0) return 'Memory Legend 🏆';
  if (sig.longestSequence >= 7) return 'Sequence Master 💡';
  if (sig.roundsCompleted >= 6) return 'Pattern Wizard 🔮';
  if (sig.wrongTaps <= 1 && sig.roundsCompleted >= 3) return 'Sharp Memory 🧠';
  return 'Building Memory 📚';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type GameSubPhase = 'showing' | 'input' | 'result';

const NODE_COLORS = ['#a855f7', '#3b82f6', '#22c55e', '#f43f5e', '#fbbf24', '#06b6d4'];
const NODE_COUNT = 5;

interface Node {
  x: number; y: number;
  color: string;
  lit: boolean;
  litTimer: number;
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  nodes: Node[];
  sequence: number[];       // node indices in sequence
  playerInput: number[];    // what player has tapped so far
  subPhase: GameSubPhase;
  showIdx: number;          // which step in sequence we're showing
  showTimer: number;        // frames to show each node
  sequenceLen: number;      // current sequence length (starts at 2)
  inputTimeout: number;     // frames left to input
  resultTimer: number;
  success: boolean;
}

export default function SequenceUnlockGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { roundsCompleted: 0, longestSequence: 0, totalTaps: 0, wrongTaps: 0, avgPrecisionMs: 0, totalPrecisionMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    nodes: [], sequence: [], playerInput: [],
    subPhase: 'showing', showIdx: 0, showTimer: 0,
    sequenceLen: 2, inputTimeout: 0, resultTimer: 0, success: false,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const initNodes = useCallback((W: number, H: number) => {
    const s = stateRef.current;
    const cx = W / 2, cy = H * 0.52;
    const r = Math.min(W, H) * 0.32;
    s.nodes = Array.from({ length: NODE_COUNT }, (_, i) => {
      const angle = (i / NODE_COUNT) * Math.PI * 2 - Math.PI / 2;
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        color: NODE_COLORS[i],
        lit: false, litTimer: 0,
      };
    });
  }, []);

  const startRound = useCallback(() => {
    const s = stateRef.current;
    // Generate new sequence (extend previous or create new)
    s.sequence = Array.from({ length: s.sequenceLen }, () => Math.floor(Math.random() * NODE_COUNT));
    s.playerInput = [];
    s.subPhase = 'showing';
    s.showIdx = 0;
    s.showTimer = 45; // frames per node
    s.nodes.forEach(n => { n.lit = false; n.litTimer = 0; });
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
    s.sig = { roundsCompleted: 0, longestSequence: 0, totalTaps: 0, wrongTaps: 0, avgPrecisionMs: 0, totalPrecisionMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.sequenceLen = 2;
    initNodes(W, H);
    startRound();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    let inputStartMs = 0;

    const loop = () => {
      if (!s.running) return;
      ctx.clearRect(0, 0, W, H);
      s.frame++;

      // Background - deep purple night
      const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
      bg.addColorStop(0, '#130a1a'); bg.addColorStop(1, '#08040f');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      // Stars
      for (let i = 0; i < 30; i++) {
        const sx = (i * 137) % W, sy = (i * 83) % (H * 0.4);
        const t = Math.sin(s.frame * 0.05 + i) * 0.4 + 0.6;
        ctx.fillStyle = `rgba(168,85,247,${t * 0.3})`;
        ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI * 2); ctx.fill();
      }

      // Connection lines between nodes
      s.nodes.forEach((n1, i) => {
        s.nodes.forEach((n2, j) => {
          if (j <= i) return;
          ctx.strokeStyle = 'rgba(168,85,247,0.08)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(n1.x, n1.y); ctx.lineTo(n2.x, n2.y); ctx.stroke();
        });
      });

      // Show sequence phase
      if (s.subPhase === 'showing') {
        s.showTimer--;
        if (s.showTimer === 35) {
          // Light up current node
          const nodeIdx = s.sequence[s.showIdx];
          s.nodes[nodeIdx].lit = true;
          s.nodes[nodeIdx].litTimer = 25;
          hapticTick(); sfx.collect();
        }
        if (s.showTimer <= 0) {
          s.showIdx++;
          if (s.showIdx >= s.sequence.length) {
            // Switch to input
            s.subPhase = 'input';
            s.nodes.forEach(n => { n.lit = false; n.litTimer = 0; });
            s.inputTimeout = 120 + s.sequenceLen * 30;
            inputStartMs = Date.now();
          } else {
            s.showTimer = 45;
          }
        }
      } else if (s.subPhase === 'input') {
        s.inputTimeout--;
        if (s.inputTimeout <= 0 && s.playerInput.length < s.sequence.length) {
          // Timeout - fail
          s.sig.wrongTaps++;
          s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.subPhase = 'result'; s.success = false; s.resultTimer = 50;
          s.floats.push({ x: W / 2, y: H * 0.2, text: '⏱️ TOO SLOW!', alpha: 1, vy: -2, color: '#ef4444' });
        }
      } else if (s.subPhase === 'result') {
        s.resultTimer--;
        ctx.fillStyle = s.success ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)';
        ctx.fillRect(0, 0, W, H);
        if (s.resultTimer <= 0) {
          if (s.success) s.sequenceLen = Math.min(s.sequenceLen + 1, 9);
          else s.sequenceLen = Math.max(2, s.sequenceLen - 1);
          startRound();
        }
      }

      // Draw nodes
      s.nodes.forEach((node, i) => {
        if (node.litTimer > 0) node.litTimer--;
        const isLit = node.litTimer > 0;
        const isPending = s.subPhase === 'input' && s.playerInput[s.playerInput.length - 1] === i;
        const r = 30;

        ctx.save();
        ctx.shadowBlur = isLit ? 24 : 8;
        ctx.shadowColor = node.color;
        ctx.fillStyle = isLit ? node.color : node.color + '22';
        ctx.strokeStyle = node.color;
        ctx.lineWidth = isLit ? 3 : 2;
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // Node number
        ctx.fillStyle = isLit ? '#000' : 'rgba(255,255,255,0.6)';
        ctx.font = `bold 16px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), node.x, node.y + 6);
        ctx.restore();
      });

      // Progress indicator
      if (s.subPhase === 'showing') {
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`Showing: ${s.showIdx + 1}/${s.sequence.length}`, W / 2, H * 0.15);
      } else if (s.subPhase === 'input') {
        const pct = s.inputTimeout / (120 + s.sequenceLen * 30);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`Your turn: ${s.playerInput.length}/${s.sequence.length}`, W / 2, H * 0.15);
        // Input timer bar
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, H * 0.19, W - 40, 4);
        ctx.fillStyle = pct > 0.5 ? ACCENT : pct > 0.25 ? '#fbbf24' : '#ef4444';
        ctx.fillRect(20, H * 0.19, (W - 40) * pct, 4);
      }

      // Show player input trail
      s.playerInput.forEach((idx, i) => {
        const n = s.nodes[idx];
        ctx.save();
        ctx.fillStyle = n.color + '66'; ctx.strokeStyle = n.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(n.x, n.y, 35, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = n.color; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), n.x, n.y + 45);
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
  }, [endGame, initNodes, startRound]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.subPhase !== 'input') return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);

      let hitIdx = -1;
      s.nodes.forEach((node, i) => {
        if (Math.hypot(px - node.x, py - node.y) < 38) hitIdx = i;
      });

      if (hitIdx < 0) return;
      const expected = s.sequence[s.playerInput.length];
      s.sig.totalTaps++;
      node_lit: {
        s.nodes[hitIdx].lit = true;
        s.nodes[hitIdx].litTimer = 15;
      }

      if (hitIdx === expected) {
        s.playerInput.push(hitIdx);
        hapticTick(); sfx.collect();

        if (s.playerInput.length === s.sequence.length) {
          // Round complete!
          s.sig.roundsCompleted++;
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          if (s.sequenceLen > s.sig.longestSequence) s.sig.longestSequence = s.sequenceLen;
          const pts = s.sequenceLen * 2 + (s.sig.streakCurrent >= 3 ? 3 : 0);
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          s.subPhase = 'result'; s.success = true; s.resultTimer = 40;
          hapticCombo(s.sig.streakCurrent); sfx.collect();
          s.floats.push({ x: canvas.width / 2, y: canvas.height * 0.18, text: `+${pts} UNLOCKED! 🔓`, alpha: 1, vy: -3, color: '#fbbf24' });
        }
      } else {
        // Wrong!
        s.sig.wrongTaps++;
        s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.floats.push({ x: canvas.width / 2, y: canvas.height * 0.18, text: 'WRONG!', alpha: 1, vy: -2, color: '#ef4444' });
        s.subPhase = 'result'; s.success = false; s.resultTimer = 45;
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase]);

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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Watch the nodes light up in order, then tap the same pattern!" ctaLabel="Remember! 💡" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Sequence Unlock game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Rounds', value: String(finalSig.roundsCompleted), color: ACCENT },
            { label: 'Longest', value: `${finalSig.longestSequence} nodes`, color: '#fbbf24' },
            { label: 'Wrong Taps', value: String(finalSig.wrongTaps), color: finalSig.wrongTaps === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.longestSequence >= 6} />
      )}
    </GameShell>
  );
}
