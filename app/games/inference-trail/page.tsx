'use client';
/**
 * INFERENCE TRAIL — Logic deduction puzzles with 3D detective atmosphere.
 * 3D scene provides atmospheric background; gameplay via HTML overlay.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
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

interface Signals { total: number; correct: number; wrong: number; avgSolveMs: number; totalMs: number; hardestLevel: number; score: number; maxStreak: number; streakCurrent: number; }

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
type InferenceType = 'ordering' | 'comparison' | 'conditional';

interface InferencePuzzle { type: InferenceType; clues: string[]; question: string; options: string[]; answer: string; level: number; }

const NAMES_3 = ['Alex', 'Blake', 'Casey'];
const NAMES_4 = ['Alex', 'Blake', 'Casey', 'Dana'];

function makeOrderingPuzzle(level: number): InferencePuzzle {
  const names = level >= 3 ? NAMES_4 : NAMES_3;
  const order = [...names].sort(() => Math.random() - 0.5);
  const attrs = ['tall', 'fast', 'smart', 'old'];
  const attr = attrs[Math.floor(Math.random() * attrs.length)];
  const clues = order.slice(0, order.length - 1).map((n, i) => `${n} is more ${attr} than ${order[i + 1]}.`);
  const qa = [{ q: `Who is LEAST ${attr}?`, a: order[order.length - 1] }, { q: `Who is MOST ${attr}?`, a: order[0] }];
  const chosen = qa[Math.floor(Math.random() * qa.length)];
  const options = [chosen.a, ...names.filter(n => n !== chosen.a).slice(0, 2)].sort(() => Math.random() - 0.5);
  return { type: 'ordering', clues, question: chosen.q, options, answer: chosen.a, level };
}

function makeComparisonPuzzle(level: number): InferencePuzzle {
  const names = level >= 3 ? NAMES_4 : NAMES_3;
  const attrs = ['coins', 'points', 'apples'];
  const attr = attrs[Math.floor(Math.random() * attrs.length)];
  const order = [...names].sort(() => Math.random() - 0.5);
  const clues = order.slice(0, order.length - 1).map((n, i) => `${n} has more ${attr} than ${order[i + 1]}.`);
  const question = `Who has more ${attr}: ${order[0]} or ${order[order.length - 1]}?`;
  const options = [order[0], order[order.length - 1], 'Same amount'].sort(() => Math.random() - 0.5);
  return { type: 'comparison', clues, question, options, answer: order[0], level };
}

function makeConditionalPuzzle(level: number): InferencePuzzle {
  const scenarios = [
    { clues: ['If it rains, Alex brings an umbrella.', 'It is raining today.'], question: 'Does Alex have an umbrella?', answer: 'Yes', options: ['Yes', 'No', 'Maybe'] },
    { clues: ['All wizards can cast spells.', 'Merlin is a wizard.'], question: 'Can Merlin cast spells?', answer: 'Yes', options: ['Yes', 'No', 'We don\'t know'] },
    { clues: ['If A then B.', 'If B then C.', 'A is true.'], question: 'Is C true?', answer: 'Yes', options: ['Yes', 'No', 'Cannot tell'] },
  ];
  const chosen = scenarios[Math.floor(Math.random() * scenarios.length)];
  return { type: 'conditional', ...chosen, level };
}

function makePuzzle(level: number): InferencePuzzle {
  const types: InferenceType[] = level >= 3 ? ['ordering', 'comparison', 'conditional'] : ['ordering', 'comparison'];
  const type = types[Math.floor(Math.random() * types.length)];
  if (type === 'ordering') return makeOrderingPuzzle(level);
  if (type === 'comparison') return makeComparisonPuzzle(level);
  return makeConditionalPuzzle(level);
}

export default function InferenceTrailGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const bgAnimRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bgRendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, avgSolveMs: 0, totalMs: 0, hardestLevel: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    puzzle: null as InferencePuzzle | null,
    shownAt: 0, feedback: null as number | null, feedbackTimer: 0, level: 1,
    floats: [] as Array<{ x: number; y: number; text: string; alpha: number }>,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [puzzleState, setPuzzleState] = useState<{ puzzle: InferencePuzzle | null; feedback: number | null; timeBarPct: number }>({ puzzle: null, feedback: null, timeBarPct: 1 });
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const nextPuzzle = useCallback(() => {
    const s = stateRef.current;
    const p = makePuzzle(s.level);
    s.puzzle = p; s.shownAt = Date.now(); s.feedback = null; s.feedbackTimer = 0;
    setPuzzleState({ puzzle: p, feedback: null, timeBarPct: 1 });
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(bgAnimRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  // 3D background: floating detective clues / particles
  useEffect(() => {
    if (phase !== 'playing') return;
    if (!mountRef.current) return;
    const mount = mountRef.current;

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setClearColor(0x08070f, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    bgRendererRef.current = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 10);

    scene.add(new THREE.AmbientLight(0x1a0a3a, 5));
    const purpleLight = new THREE.PointLight(0x7c3aed, 2, 20);
    purpleLight.position.set(0, 5, 5);
    scene.add(purpleLight);

    // Floating geometric shapes (clue nodes)
    const nodes: { mesh: THREE.Mesh; vx: number; vy: number; vz: number }[] = [];
    for (let i = 0; i < 20; i++) {
      const geo = Math.random() > 0.5 ? new THREE.OctahedronGeometry(0.15 + Math.random() * 0.2) : new THREE.TetrahedronGeometry(0.2 + Math.random() * 0.15);
      const mat = new THREE.MeshPhongMaterial({ color: 0x7c3aed, emissive: 0x3b1a6e, transparent: true, opacity: 0.3 + Math.random() * 0.4, wireframe: Math.random() > 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8 - 2);
      scene.add(mesh);
      nodes.push({ mesh, vx: (Math.random() - 0.5) * 0.005, vy: (Math.random() - 0.5) * 0.005, vz: (Math.random() - 0.5) * 0.003 });
    }

    // Connecting lines between some nodes
    for (let i = 0; i < 8; i++) {
      const a = nodes[Math.floor(Math.random() * nodes.length)];
      const b = nodes[Math.floor(Math.random() * nodes.length)];
      const lineGeo = new THREE.BufferGeometry().setFromPoints([a.mesh.position.clone(), b.mesh.position.clone()]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x4c1d95, transparent: true, opacity: 0.2 });
      scene.add(new THREE.Line(lineGeo, lineMat));
    }

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      bgAnimRef.current = requestAnimationFrame(loop);
      t += 0.008;
      nodes.forEach(n => {
        n.mesh.position.x += n.vx;
        n.mesh.position.y += n.vy;
        n.mesh.position.z += n.vz;
        if (Math.abs(n.mesh.position.x) > 9) n.vx *= -1;
        if (Math.abs(n.mesh.position.y) > 7) n.vy *= -1;
        if (Math.abs(n.mesh.position.z) > 5) n.vz *= -1;
        n.mesh.rotation.x += 0.01;
        n.mesh.rotation.y += 0.008;
      });
      purpleLight.intensity = 1.5 + Math.sin(t * 2) * 0.5;
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(bgAnimRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      bgRendererRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, correct: 0, wrong: 0, avgSolveMs: 0, totalMs: 0, hardestLevel: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.level = 1; setScoreDisplay(0); setTimeLeft(DURATION);
    nextPuzzle();

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
      // Update time bar
      if (s.puzzle) {
        const elapsed = (Date.now() - s.shownAt) / 1000;
        const limit = Math.max(5, 12 - s.level * 0.8);
        const pct = Math.max(0, 1 - elapsed / limit);
        setPuzzleState(prev => ({ ...prev, timeBarPct: pct }));
        if (elapsed > limit && s.feedback === null) {
          s.sig.total++; s.sig.wrong++; s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.feedback = -1;
          setPuzzleState(prev => ({ ...prev, feedback: -1 }));
          setTimeout(() => { if (s.running) nextPuzzle(); }, 700);
        }
      }
    }, 1000);

    return () => { s.running = false; if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [phase, endGame, nextPuzzle]);

  const handleOptionTap = useCallback((optIdx: number) => {
    const s = stateRef.current;
    if (s.feedback !== null || !s.puzzle) return;
    const ms = Date.now() - s.shownAt;
    s.sig.total++; s.sig.totalMs += ms;
    s.feedback = optIdx;

    const isCorrect = s.puzzle.options[optIdx] === s.puzzle.answer;
    if (isCorrect) {
      s.sig.correct++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const speedPts = ms < 3000 ? 4 : ms < 6000 ? 3 : 2;
      s.sig.score += speedPts; setScoreDisplay(s.sig.score);
      if (s.level > s.sig.hardestLevel) s.sig.hardestLevel = s.level;
      s.level = Math.min(5, 1 + Math.floor(s.sig.correct / 3));
      sfx.collect(); hapticScore();
      if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
    } else {
      s.sig.wrong++; s.sig.streakCurrent = 0;
      sfx.collision(); hapticFail();
    }
    setPuzzleState(prev => ({ ...prev, feedback: optIdx }));
    setTimeout(() => { if (s.running) nextPuzzle(); }, 700);
  }, [nextPuzzle]);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const { puzzle, feedback, timeBarPct } = puzzleState;
  const barColor = timeBarPct > 0.5 ? ACCENT : timeBarPct > 0.25 ? '#fbbf24' : '#ef4444';

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#08070f 0%,#0d0a1a 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Read the clues and deduce the correct answer!" ctaLabel="Deduce! 🕵️" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={() => setPhase('playing')} accentColor={theme.colors.accent ?? ACCENT} />}

      {/* 3D BG */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none' }} />

      {/* Game UI overlay */}
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 20, pointerEvents: 'none', zIndex: 10 }}>
            {puzzle && (
              <div style={{ width: '100%', maxWidth: 400, pointerEvents: 'auto' }}>
                {/* Clues */}
                <div style={{ marginBottom: 16 }}>
                  {puzzle.clues.map((clue, i) => (
                    <div key={i} style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 10, padding: '8px 12px', marginBottom: 6, color: 'rgba(255,255,255,0.85)', fontSize: 13, fontFamily: 'monospace' }}>
                      {clue}
                    </div>
                  ))}
                </div>
                {/* Time bar */}
                <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 4, height: 4, marginBottom: 14 }}>
                  <div style={{ background: barColor, width: `${timeBarPct * 100}%`, height: '100%', borderRadius: 4, transition: 'width 0.5s' }} />
                </div>
                {/* Question */}
                <div style={{ color: ACCENT, fontSize: 15, fontWeight: 800, textAlign: 'center', marginBottom: 16, textShadow: `0 0 8px ${ACCENT}` }}>
                  {puzzle.question}
                </div>
                {/* Options */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {puzzle.options.map((opt, i) => {
                    const isSelected = feedback === i;
                    const isCorrect = opt === puzzle.answer;
                    let bg = 'rgba(124,58,237,0.15)';
                    let border = ACCENT;
                    if (feedback !== null) {
                      if (isSelected) { bg = isCorrect ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)'; border = isCorrect ? '#4ade80' : '#ef4444'; }
                      else if (isCorrect) { bg = 'rgba(74,222,128,0.15)'; border = '#4ade80'; }
                    }
                    return (
                      <button key={i} onClick={() => handleOptionTap(i)} disabled={feedback !== null}
                        style={{ background: bg, border: `2px solid ${border}`, borderRadius: 12, padding: '14px 20px', color: '#fff', fontWeight: 700, fontSize: 14, cursor: feedback !== null ? 'default' : 'pointer', minWidth: 90, boxShadow: `0 0 8px ${border}44`, transition: 'all 0.2s' }}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
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
