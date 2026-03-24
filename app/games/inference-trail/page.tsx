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

const GAME_ID = 'inference-trail';
const ACCENT = '#7c3aed';
const DURATION = 60;
const GAME_EMOJI = '🕵️';
const GAME_TITLE = 'Inference Trail';
const GAME_TAGLINE = 'Follow the clues. Crack the logic.';

interface Signals {
  total: number;
  correct: number;
  wrong: number;
  avgSolveMs: number;
  totalMs: number;
  hardestLevel: number;
  score: number;
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  const avg = sig.total > 0 ? sig.totalMs / sig.total : 9999;
  if (acc >= 0.9 && avg < 3000) return 'Master Detective 🔍';
  if (sig.hardestLevel >= 4) return 'Logic Legend 🧠';
  if (acc >= 0.8) return 'Sharp Inference ⚡';
  if (avg < 4000) return 'Quick Reasoner 💡';
  return 'Following Clues 🕵️';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// Inference puzzle types
type InferenceType = 'ordering' | 'membership' | 'comparison' | 'conditional';

interface InferencePuzzle {
  type: InferenceType;
  clues: string[];
  question: string;
  options: string[];
  answer: string;
  level: number;
}

const NAMES_3 = ['Alex', 'Blake', 'Casey'];
const NAMES_4 = ['Alex', 'Blake', 'Casey', 'Dana'];
const NAMES_5 = ['Alex', 'Blake', 'Casey', 'Dana', 'Eli'];

function makeOrderingPuzzle(level: number): InferencePuzzle {
  const names = level >= 4 ? NAMES_5 : level >= 3 ? NAMES_4 : NAMES_3;
  const n = names.length;
  // Create random ordering
  const order = [...names].sort(() => Math.random() - 0.5);
  const attrs = ['tall', 'fast', 'smart', 'old', 'heavy', 'skilled'];
  const attr = attrs[Math.floor(Math.random() * attrs.length)];

  // Generate clues (pair-wise comparisons)
  const clues: string[] = [];
  for (let i = 0; i < n - 1 && i < 3; i++) {
    clues.push(`${order[i]} is more ${attr} than ${order[i + 1]}.`);
  }

  const questions = [
    { q: `Who is the LEAST ${attr}?`, a: order[n - 1] },
    { q: `Who is the MOST ${attr}?`, a: order[0] },
  ];
  const chosen = questions[Math.floor(Math.random() * questions.length)];

  const wrongNames = names.filter(nm => nm !== chosen.a);
  const options = [chosen.a, ...wrongNames.slice(0, 2)].sort(() => Math.random() - 0.5);

  return {
    type: 'ordering', clues, question: chosen.q,
    options, answer: chosen.a, level,
  };
}

function makeMembershipPuzzle(level: number): InferencePuzzle {
  const categories: Array<{ cat: string; members: string[]; nonMembers: string[] }> = [
    { cat: 'birds', members: ['Eagle', 'Parrot', 'Penguin', 'Sparrow'], nonMembers: ['Shark', 'Lizard', 'Whale', 'Frog'] },
    { cat: 'fruits', members: ['Apple', 'Mango', 'Berry', 'Grape'], nonMembers: ['Carrot', 'Onion', 'Potato', 'Pea'] },
    { cat: 'planets', members: ['Mars', 'Venus', 'Saturn', 'Jupiter'], nonMembers: ['Moon', 'Pluto', 'Sun', 'Comet'] },
  ];
  const cat = categories[Math.floor(Math.random() * categories.length)];
  const trueItem = cat.members[Math.floor(Math.random() * cat.members.length)];
  const falseItems = cat.nonMembers.slice(0, 2);

  const ruleSubject = cat.members.filter(m => m !== trueItem)[0];
  const clues = [
    `All ${cat.cat} have wings.`,
    `${ruleSubject} is a ${cat.cat.slice(0, -1)}.`,
    `${trueItem} is a ${cat.cat.slice(0, -1)}.`,
  ];
  if (level >= 3) {
    clues.splice(1, 0, `${falseItems[0]} is NOT a ${cat.cat.slice(0, -1)}.`);
  }

  const question = `Does ${trueItem} have wings?`;
  const options = ['Yes', 'No', 'Cannot tell'];

  return {
    type: 'membership', clues, question,
    options, answer: 'Yes', level,
  };
}

function makeComparisonPuzzle(level: number): InferencePuzzle {
  const names = level >= 3 ? NAMES_4 : NAMES_3;
  const attrs = ['coins', 'points', 'apples', 'books', 'steps'];
  const attr = attrs[Math.floor(Math.random() * attrs.length)];

  // A > B > C > ...
  const order = [...names].sort(() => Math.random() - 0.5);
  const amounts = order.map((_, i) => 100 - i * 15 + Math.floor(Math.random() * 5));

  const clues = [];
  for (let i = 0; i < order.length - 1; i++) {
    clues.push(`${order[i]} has more ${attr} than ${order[i + 1]}.`);
  }

  // Ask to compare non-adjacent
  const i1 = 0, i2 = order.length - 1;
  const question = `Who has more ${attr}: ${order[i1]} or ${order[i2]}?`;
  const answer = order[i1]; // always more

  const options = [answer, order[i2], 'Same amount'].sort(() => Math.random() - 0.5);
  return { type: 'comparison', clues, question, options, answer, level };
}

function makeConditionalPuzzle(level: number): InferencePuzzle {
  const scenarios = [
    {
      clues: ['If it rains, Alex brings an umbrella.', 'It is raining today.'],
      question: 'Does Alex have an umbrella?',
      answer: 'Yes',
      options: ['Yes', 'No', 'Maybe'],
    },
    {
      clues: ['Only students with a pass can enter.', 'Blake has a pass.'],
      question: 'Can Blake enter?',
      answer: 'Yes',
      options: ['Yes', 'No', 'Cannot tell'],
    },
    {
      clues: ['All wizards can cast spells.', 'Merlin is a wizard.'],
      question: 'Can Merlin cast spells?',
      answer: 'Yes',
      options: ['Yes', 'No', 'We don\'t know'],
    },
  ];

  const harder = [
    {
      clues: ['If A then B.', 'If B then C.', 'A is true.'],
      question: 'Is C true?',
      answer: 'Yes',
      options: ['Yes', 'No', 'Cannot tell'],
    },
    {
      clues: ['All that glitters is not gold.', 'This ring glitters.'],
      question: 'Is this ring gold?',
      answer: 'Cannot tell',
      options: ['Yes', 'No', 'Cannot tell'],
    },
  ];

  const pool = level >= 3 ? [...scenarios, ...harder] : scenarios;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return { type: 'conditional', clues: chosen.clues, question: chosen.question, options: chosen.options, answer: chosen.answer, level };
}

function makePuzzle(level: number): InferencePuzzle {
  const types: InferenceType[] = level >= 4
    ? ['ordering', 'comparison', 'conditional', 'membership']
    : level >= 2
      ? ['ordering', 'comparison', 'conditional']
      : ['ordering', 'comparison'];
  const type = types[Math.floor(Math.random() * types.length)];

  switch (type) {
    case 'ordering': return makeOrderingPuzzle(level);
    case 'comparison': return makeComparisonPuzzle(level);
    case 'membership': return makeMembershipPuzzle(level);
    case 'conditional': return makeConditionalPuzzle(level);
    default: return makeOrderingPuzzle(level);
  }
}

interface GameState {
  running: boolean; timeLeft: number;
  sig: Signals; frame: number; accentColor: string;
  floats: Array<{ x: number; y: number; text: string; alpha: number; vy: number; color: string }>;
  puzzle: InferencePuzzle | null;
  shownAt: number;
  feedback: number | null;
  feedbackTimer: number;
  level: number;
}

export default function InferenceTrailGame() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, avgSolveMs: 0, totalMs: 0, hardestLevel: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    frame: 0, accentColor: ACCENT, floats: [],
    puzzle: null, shownAt: 0, feedback: null, feedbackTimer: 0, level: 1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const nextPuzzle = useCallback(() => {
    const s = stateRef.current;
    s.puzzle = makePuzzle(s.level);
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
    s.sig = { total: 0, correct: 0, wrong: 0, avgSolveMs: 0, totalMs: 0, hardestLevel: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.floats = []; s.level = 1;
    nextPuzzle();
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

      // Background - detective noir
      ctx.fillStyle = '#08070f'; ctx.fillRect(0, 0, W, H);
      // Magnifying glass grid
      ctx.strokeStyle = 'rgba(124,58,237,0.04)'; ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 35) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 35) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      if (s.feedback !== null && s.feedbackTimer > 0 && s.puzzle) {
        const correct = s.puzzle.options[s.feedback] === s.puzzle.answer;
        ctx.fillStyle = correct ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)';
        ctx.fillRect(0, 0, W, H);
      }

      const p = s.puzzle;
      if (!p) return;

      // Clue label
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`CLUE${p.clues.length > 1 ? 'S' : ''}:`, W / 2, H * 0.1);

      // Draw clues (scrolling if needed)
      const clueY0 = H * 0.15;
      p.clues.forEach((clue, i) => {
        const bgY = clueY0 + i * 30 - 8;
        ctx.fillStyle = 'rgba(124,58,237,0.12)';
        ctx.fillRect(10, bgY, W - 20, 26);
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(clue, W / 2, bgY + 18);
      });

      // Question
      const qY = clueY0 + p.clues.length * 30 + 18;
      ctx.save();
      ctx.shadowBlur = 10; ctx.shadowColor = ACCENT;
      ctx.fillStyle = ACCENT; ctx.font = `bold ${Math.min(15, W * 0.038)}px sans-serif`; ctx.textAlign = 'center';
      // Wrap long question
      const maxW = W - 30;
      const words = p.question.split(' ');
      let line = '', lineY = qY;
      words.forEach(word => {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > maxW && line !== '') {
          ctx.fillText(line.trim(), W / 2, lineY);
          line = word + ' '; lineY += 22;
        } else { line = test; }
      });
      ctx.fillText(line.trim(), W / 2, lineY);
      ctx.restore();

      // Options (2 or 3 buttons)
      const numOpts = p.options.length;
      const optW = Math.min((W - 20 - (numOpts - 1) * 8) / numOpts, 120);
      const optH = 50;
      const optGridX = (W - (optW * numOpts + 8 * (numOpts - 1))) / 2;
      const optY = H * 0.7;

      p.options.forEach((opt, i) => {
        const bx = optGridX + i * (optW + 8);
        const isSelected = s.feedback === i;
        const isCorrect = opt === p.answer;

        let bg = 'rgba(124,58,237,0.12)', border = ACCENT;
        if (isSelected) {
          bg = isCorrect ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)';
          border = isCorrect ? '#4ade80' : '#ef4444';
        } else if (s.feedback !== null && isCorrect) {
          border = '#4ade80'; bg = 'rgba(74,222,128,0.15)';
        }

        ctx.save();
        ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 2;
        ctx.shadowBlur = 8; ctx.shadowColor = border;
        ctx.beginPath(); (ctx as any).roundRect?.(bx, optY, optW, optH, 8) ?? ctx.rect(bx, optY, optW, optH);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = `bold ${Math.min(16, optW * 0.14)}px sans-serif`; ctx.textAlign = 'center';
        // Word wrap option text
        if (ctx.measureText(opt).width > optW - 10) {
          const mid = Math.ceil(opt.length / 2);
          ctx.fillText(opt.slice(0, mid), bx + optW / 2, optY + optH / 2 - 5);
          ctx.fillText(opt.slice(mid), bx + optW / 2, optY + optH / 2 + 14);
        } else {
          ctx.fillText(opt, bx + optW / 2, optY + optH / 2 + 7);
        }
        ctx.restore();
      });

      // Timer
      const elapsed = (Date.now() - s.shownAt) / 1000;
      const limit = Math.max(5, 12 - s.level * 0.8);
      const pct = Math.max(0, 1 - elapsed / limit);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, H * 0.64, W - 40, 4);
      ctx.fillStyle = pct > 0.5 ? ACCENT : pct > 0.25 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(20, H * 0.64, (W - 40) * pct, 4);

      if (elapsed > limit && s.feedback === null) {
        s.sig.total++; s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = -1; s.feedbackTimer = 15;
        setTimeout(() => { if (s.running) nextPuzzle(); }, 700);
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
  }, [endGame, nextPuzzle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.feedback !== null || !s.puzzle) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const W = canvas.width, H = canvas.height;
      const p = s.puzzle;
      const numOpts = p.options.length;
      const optW = Math.min((W - 20 - (numOpts - 1) * 8) / numOpts, 120);
      const optH = 50;
      const optGridX = (W - (optW * numOpts + 8 * (numOpts - 1))) / 2;
      const optY = H * 0.7;

      for (let i = 0; i < numOpts; i++) {
        const bx = optGridX + i * (optW + 8);
        if (px >= bx && px <= bx + optW && py >= optY && py <= optY + optH) {
          const ms = Date.now() - s.shownAt;
          s.sig.total++; s.sig.totalMs += ms;
          s.feedback = i; s.feedbackTimer = 16;

          if (p.options[i] === p.answer) {
            s.sig.correct++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const speedPts = ms < 3000 ? 4 : ms < 6000 ? 3 : 2;
            s.sig.score += speedPts; setScoreDisplay(s.sig.score);
            if (s.level > s.sig.hardestLevel) s.sig.hardestLevel = s.level;
            s.level = Math.min(5, 1 + Math.floor(s.sig.correct / 3));
            sfx.collect(); hapticScore();
            if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
            s.floats.push({ x: W / 2, y: H * 0.65, text: `+${speedPts} DEDUCED!`, alpha: 1, vy: -2.5, color: '#fbbf24' });
          } else {
            s.sig.wrong++; s.sig.streakCurrent = 0;
            sfx.collision(); hapticFail();
            s.floats.push({ x: W / 2, y: H * 0.65, text: `Ans: ${p.answer}`, alpha: 1, vy: -2, color: '#ef4444' });
          }
          setTimeout(() => { if (s.running) nextPuzzle(); }, 700);
          break;
        }
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, nextPuzzle]);

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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Read the clues and deduce the correct answer!" ctaLabel="Deduce! 🕵️" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} role="img" aria-label="Inference Trail deduction game canvas" />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Avg Speed', value: `${finalSig.total > 0 ? Math.round(finalSig.totalMs / finalSig.total) : 0}ms`, color: '#fbbf24' },
            { label: 'Hardest Level', value: String(finalSig.hardestLevel), color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 8} />
      )}
    </GameShell>
  );
}
