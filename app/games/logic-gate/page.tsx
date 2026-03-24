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

const GAME_ID = 'logic-gate';
const ACCENT = '#64748b';
const DURATION = 60;
const GAME_EMOJI = '⚙️';
const GAME_TITLE = 'Logic Gate';
const GAME_TAGLINE = 'Wire the circuit. Get the output.';

interface Signals {
  total: number;
  correct: number;
  wrong: number;
  andGates: number;
  orGates: number;
  notGates: number;
  avgSolveMs: number;
  totalMs: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  if (acc >= 0.9 && sig.total >= 15) return 'Logic Engineer ⚡';
  if (sig.total >= 12) return 'Circuit Master 🔌';
  if (acc >= 0.8) return 'Boolean Brain ⚙️';
  if (sig.avgSolveMs < 1500) return 'Quick Solver 💡';
  return 'Learning Logic 🔧';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';
type GateType = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR' | 'XOR';

interface Gate {
  type: GateType;
  inputs: boolean[];
  output: boolean;
}

function evaluateGate(type: GateType, inputs: boolean[]): boolean {
  switch (type) {
    case 'AND': return inputs[0] && inputs[1];
    case 'OR': return inputs[0] || inputs[1];
    case 'NOT': return !inputs[0];
    case 'NAND': return !(inputs[0] && inputs[1]);
    case 'NOR': return !(inputs[0] || inputs[1]);
    case 'XOR': return inputs[0] !== inputs[1];
  }
}

interface Circuit {
  gate: Gate;
  answer: boolean;
  // Optional second gate (chained)
  gate2?: Gate;
  gate2Answer?: boolean;
}

function makeCircuit(level: number): Circuit {
  const basicGates: GateType[] = ['AND', 'OR', 'NOT'];
  const advancedGates: GateType[] = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR'];
  const gates = level >= 4 ? advancedGates : basicGates;
  const gateType = gates[Math.floor(Math.random() * gates.length)];
  const isNot = gateType === 'NOT';
  const inputs = isNot ? [Math.random() < 0.5] : [Math.random() < 0.5, Math.random() < 0.5];
  const output = evaluateGate(gateType, inputs);

  if (level >= 5) {
    // Chained: output of gate1 feeds into gate2
    const gateType2 = gates[Math.floor(Math.random() * gates.length)];
    const isNot2 = gateType2 === 'NOT';
    const input2 = isNot2 ? [output] : [output, Math.random() < 0.5];
    const output2 = evaluateGate(gateType2, input2);
    return {
      gate: { type: gateType, inputs, output },
      gate2: { type: gateType2, inputs: input2, output: output2 },
      gate2Answer: output2,
      answer: output2,
    };
  }

  return { gate: { type: gateType, inputs, output }, answer: output };
}

function gateSymbol(type: GateType): string {
  const map: Record<GateType, string> = {
    AND: '⋅', OR: '+', NOT: '¬', NAND: '⊼', NOR: '⊽', XOR: '⊕',
  };
  return map[type];
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  circuit: Circuit | null;
  shownAt: number;
  feedback: boolean | null;
  feedbackTimer: number;
  level: number;
}

export default function LogicGateGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, andGates: 0, orGates: 0, notGates: 0, avgSolveMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    circuit: null, shownAt: 0, feedback: null, feedbackTimer: 0, level: 1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextCircuit = useCallback(() => {
    const s = stateRef.current;
    s.circuit = makeCircuit(s.level);
    s.shownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0;
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

    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, correct: 0, wrong: 0, andGates: 0, orGates: 0, notGates: 0, avgSolveMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.level = 1;
    nextCircuit();
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

      // Background - circuit board dark
      ctx.fillStyle = '#060c0e'; ctx.fillRect(0, 0, W, H);
      // PCB trace grid
      ctx.strokeStyle = 'rgba(100,116,139,0.06)'; ctx.lineWidth = 1;
      for (let x = 20; x < W; x += 30) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 20; y < H; y += 30) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      if (s.feedback !== null && s.feedbackTimer > 0) {
        ctx.fillStyle = s.feedback ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)';
        ctx.fillRect(0, 0, W, H);
      }

      const c = s.circuit;
      if (!c) return;

      // Draw circuit diagram
      const cx = W / 2, cy = H * 0.42;
      const gateW = 80, gateH = 50;
      const isNot = c.gate.type === 'NOT';

      // Input wires and labels
      const wireColor = '#94a3b8';
      ctx.strokeStyle = wireColor; ctx.lineWidth = 2.5;

      if (!isNot) {
        // Two inputs
        ctx.beginPath(); ctx.moveTo(cx - 120, cy - 14); ctx.lineTo(cx - 40, cy - 14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 120, cy + 14); ctx.lineTo(cx - 40, cy + 14); ctx.stroke();

        // Input labels
        ctx.fillStyle = c.gate.inputs[0] ? '#4ade80' : '#ef4444';
        ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
        ctx.fillText(c.gate.inputs[0] ? '1' : '0', cx - 130, cy - 10);
        ctx.fillStyle = c.gate.inputs[1] ? '#4ade80' : '#ef4444';
        ctx.fillText(c.gate.inputs[1] ? '1' : '0', cx - 130, cy + 18);
      } else {
        // Single input
        ctx.beginPath(); ctx.moveTo(cx - 120, cy); ctx.lineTo(cx - 40, cy); ctx.stroke();
        ctx.fillStyle = c.gate.inputs[0] ? '#4ade80' : '#ef4444';
        ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
        ctx.fillText(c.gate.inputs[0] ? '1' : '0', cx - 130, cy + 7);
      }

      // Gate box
      ctx.fillStyle = 'rgba(100,116,139,0.2)'; ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath(); (ctx as any).roundRect?.(cx - gateW / 2, cy - gateH / 2, gateW, gateH, 6) ?? ctx.rect(cx - gateW / 2, cy - gateH / 2, gateW, gateH);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e2e8f0'; ctx.font = `bold ${Math.min(16, gateW * 0.2)}px monospace`; ctx.textAlign = 'center';
      ctx.fillText(c.gate.type, cx, cy + 6);

      // Output wire to question mark
      ctx.strokeStyle = wireColor; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx + 40, cy); ctx.lineTo(cx + 100, cy); ctx.stroke();

      // Output question mark (or revealed answer)
      const showOutput = s.feedback !== null;
      ctx.save();
      ctx.shadowBlur = 16; ctx.shadowColor = showOutput ? (c.answer ? '#4ade80' : '#ef4444') : ACCENT;
      ctx.fillStyle = 'rgba(100,116,139,0.2)'; ctx.strokeStyle = showOutput ? (c.answer ? '#4ade80' : '#ef4444') : ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx + 115, cy, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
      ctx.fillText(showOutput ? (c.answer ? '1' : '0') : '?', cx + 115, cy + 6);
      ctx.restore();

      // Gate reference table (small)
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      const gateRef: Record<GateType, string> = {
        AND: 'A·B = 1 only if both 1',
        OR: 'A+B = 1 if any 1',
        NOT: '¬A flips the bit',
        NAND: '!(A·B)',
        NOR: '!(A+B)',
        XOR: 'A⊕B: different→1',
      };
      ctx.fillText(gateRef[c.gate.type], W / 2, H * 0.22);

      // TRUE / FALSE buttons
      const btnW = Math.min((W - 60) / 2, 130);
      const btnH = 56;
      const btnY = H * 0.65;

      // TRUE
      const trueX = W / 2 - btnW - 10;
      ctx.save();
      ctx.shadowBlur = 12; ctx.shadowColor = '#4ade80';
      ctx.fillStyle = s.feedback === true ? (c.answer ? 'rgba(74,222,128,0.4)' : 'rgba(239,68,68,0.4)') : 'rgba(74,222,128,0.12)';
      ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2.5;
      ctx.beginPath(); (ctx as any).roundRect?.(trueX, btnY, btnW, btnH, 10) ?? ctx.rect(trueX, btnY, btnW, btnH);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('TRUE  1', trueX + btnW / 2, btnY + 37);
      ctx.restore();

      // FALSE
      const falseX = W / 2 + 10;
      ctx.save();
      ctx.shadowBlur = 12; ctx.shadowColor = '#ef4444';
      ctx.fillStyle = s.feedback === false ? (!c.answer ? 'rgba(74,222,128,0.4)' : 'rgba(239,68,68,0.4)') : 'rgba(239,68,68,0.12)';
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5;
      ctx.beginPath(); (ctx as any).roundRect?.(falseX, btnY, btnW, btnH, 10) ?? ctx.rect(falseX, btnY, btnW, btnH);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('FALSE  0', falseX + btnW / 2, btnY + 37);
      ctx.restore();

      // Timer
      const elapsed = (Date.now() - s.shownAt) / 1000;
      const limit = Math.max(2, 5 - s.level * 0.3);
      const pct = Math.max(0, 1 - elapsed / limit);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, H * 0.59, W - 40, 4);
      ctx.fillStyle = pct > 0.5 ? ACCENT : pct > 0.25 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(20, H * 0.59, (W - 40) * pct, 4);

      if (elapsed > limit && s.feedback === null) {
        s.sig.total++; s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = !c.answer; s.feedbackTimer = 15;
        setTimeout(() => { if (s.running) nextCircuit(); }, 600);
      }

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
  }, [endGame, nextCircuit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.feedback !== null || !s.circuit) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const W = canvas.width, H = canvas.height;
      const btnW = Math.min((W - 60) / 2, 130);
      const btnH = 56, btnY = H * 0.65;
      const trueX = W / 2 - btnW - 10, falseX = W / 2 + 10;

      let playerAnswer: boolean | null = null;
      if (px >= trueX && px <= trueX + btnW && py >= btnY && py <= btnY + btnH) playerAnswer = true;
      if (px >= falseX && px <= falseX + btnW && py >= btnY && py <= btnY + btnH) playerAnswer = false;
      if (playerAnswer === null) return;

      const ms = Date.now() - s.shownAt;
      s.sig.total++; s.sig.totalMs += ms;
      s.feedback = playerAnswer; s.feedbackTimer = 15;

      // Track gate type
      const gt = s.circuit.gate.type;
      if (gt === 'AND' || gt === 'NAND') s.sig.andGates++;
      if (gt === 'OR' || gt === 'NOR') s.sig.orGates++;
      if (gt === 'NOT') s.sig.notGates++;

      if (playerAnswer === s.circuit.answer) {
        s.sig.correct++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const speedPts = ms < 1000 ? 3 : ms < 2000 ? 2 : 1;
        s.sig.score += speedPts; setScoreDisplay(s.sig.score);
        s.level = Math.min(7, 1 + Math.floor(s.sig.correct / 4));
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.floats.push({ x: W / 2, y: H * 0.62, text: `+${speedPts} ✓`, alpha: 1, vy: -2.5, color: '#fbbf24' });
      } else {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.floats.push({ x: W / 2, y: H * 0.62, text: `Answer: ${s.circuit.answer ? '1' : '0'}`, alpha: 1, vy: -2, color: '#ef4444' });
      }
      setTimeout(() => { if (s.running) nextCircuit(); }, 600);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, nextCircuit]);

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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Read the logic gate circuit and tap TRUE or FALSE for its output!" ctaLabel="Wire it! ⚙️" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Logic Gate game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Avg Speed', value: `${finalSig.total > 0 ? Math.round(finalSig.totalMs / finalSig.total) : 0}ms`, color: '#fbbf24' },
            { label: 'Circuits', value: String(finalSig.total), color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 12} />
      )}
    </GameShell>
  );
}
