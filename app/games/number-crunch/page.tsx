'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID      = 'number-crunch';
const ACCENT       = '#3b82f6';
const DURATION     = 60;
const GAME_EMOJI   = '🔢';
const GAME_TITLE   = 'Number Crunch';
const GAME_TAGLINE = 'Solve the math problem. Tap the right answer — fast!';

type Op = '+' | '-' | '×' | '÷';

interface Problem { question: string; answer: number; choices: number[]; timeLimit: number; }
interface Signals {
  totalProblems: number; correct: number; wrong: number;
  maxStreak: number; streakCurrent: number; avgResponseMs: number;
  responseTimes: number[]; score: number; difficultyReached: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.totalProblems > 0 ? sig.correct / sig.totalProblems : 0;
  if (acc >= 0.90 && sig.avgResponseMs < 2000) return 'Math Genius 🧮';
  if (acc >= 0.80) return 'Sharp Calculator 💡';
  if (sig.maxStreak >= 8) return 'Streak Machine ⚡';
  if (sig.difficultyReached >= 4) return 'Challenge Seeker 🎯';
  return 'Learning the Ropes 📚';
}

function genProblem(difficulty: number): Problem {
  const ops: Op[] = difficulty < 2 ? ['+', '-'] : difficulty < 4 ? ['+', '-', '×'] : ['+', '-', '×', '÷'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a = 0, b = 0, answer = 0;
  if (op === '+') { a = Math.floor(Math.random() * (difficulty * 8 + 5)) + 1; b = Math.floor(Math.random() * (difficulty * 8 + 5)) + 1; answer = a + b; }
  else if (op === '-') { a = Math.floor(Math.random() * (difficulty * 8 + 10)) + 5; b = Math.floor(Math.random() * a) + 1; answer = a - b; }
  else if (op === '×') { a = Math.floor(Math.random() * (difficulty * 3 + 3)) + 2; b = Math.floor(Math.random() * (difficulty * 2 + 3)) + 2; answer = a * b; }
  else { b = Math.floor(Math.random() * (difficulty + 2)) + 2; a = b * (Math.floor(Math.random() * (difficulty + 2)) + 2); answer = a / b; }
  const choices: number[] = [answer];
  while (choices.length < 4) {
    const wrong = answer + (Math.random() < 0.5 ? 1 : -1) * (Math.floor(Math.random() * (difficulty * 3 + 3)) + 1);
    if (!choices.includes(wrong) && wrong >= 0) choices.push(wrong);
  }
  for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
  return { question: `${a} ${op} ${b} = ?`, answer, choices, timeLimit: Math.max(3000, 6000 - difficulty * 400) };
}

export default function NumberCrunchGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const cubesRef = useRef<THREE.Mesh[]>([]);
  const particlesRef = useRef<THREE.Points | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { totalProblems: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0,
           avgResponseMs: 0, responseTimes: [], score: 0, difficultyReached: 1 } as Signals,
    problem: null as Problem | null, problemStart: 0, difficulty: 1,
    answerFlash: null as { correct: boolean; idx: number } | null,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [question, setQuestion] = useState('');
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [flashState, setFlashState] = useState<{ idx: number; correct: boolean } | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.sig.responseTimes.length > 0) s.sig.avgResponseMs = s.sig.responseTimes.reduce((a, b) => a + b, 0) / s.sig.responseTimes.length;
    sfx.success(); haptic([100]);
    try { const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0'); if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const newProblem = useCallback(() => {
    const s = stateRef.current; if (!s.running) return;
    s.difficulty = Math.min(6, 1 + Math.floor(s.sig.correct / 3));
    if (s.difficulty > s.sig.difficultyReached) s.sig.difficultyReached = s.difficulty;
    const p = genProblem(s.difficulty);
    s.problem = p; s.problemStart = Date.now();
    setQuestion(p.question);
    // Update cube labels
    cubesRef.current.forEach((mesh, i) => {
      (mesh.userData as { choice: number }).choice = p.choices[i];
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0x3b82f6);
      mat.emissive.set(0x1e3a6a);
    });
  }, []);

  const handleAnswer = useCallback((idx: number) => {
    const s = stateRef.current;
    if (!s.running || !s.problem || s.answerFlash) return;
    const choice = s.problem.choices[idx];
    const correct = choice === s.problem.answer;
    const rt = Date.now() - s.problemStart;
    s.sig.totalProblems++;
    s.sig.responseTimes.push(rt);
    if (correct) {
      s.sig.correct++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const mult = s.sig.streakCurrent >= 5 ? 3 : s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += mult * 10;
      setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([30]);
    } else {
      s.sig.wrong++; s.sig.streakCurrent = 0;
      sfx.collision(); haptic([30, 20, 30]);
    }
    s.answerFlash = { correct, idx };
    setFlashState({ idx, correct });
    // Flash cube color
    const cube = cubesRef.current[idx];
    if (cube) {
      const mat = cube.material as THREE.MeshStandardMaterial;
      mat.color.set(correct ? 0x4ade80 : 0xef4444);
      mat.emissive.set(correct ? 0x1a5f2a : 0x5f1a1a);
    }
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      s.answerFlash = null; setFlashState(null);
      newProblem();
    }, 500);
  }, [newProblem]);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalProblems: 0, correct: 0, wrong: 0, maxStreak: 0, streakCurrent: 0,
              avgResponseMs: 0, responseTimes: [], score: 0, difficultyReached: 1 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    scene.fog = new THREE.Fog(0x0a0a1a, 18, 35);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 12);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    scene.add(new THREE.AmbientLight(0x222244, 1.5));
    const pLight = new THREE.PointLight(0x3b82f6, 80, 30);
    pLight.position.set(0, 5, 8);
    scene.add(pLight);
    const pLight2 = new THREE.PointLight(0x6366f1, 40, 20);
    pLight2.position.set(-5, -3, 5);
    scene.add(pLight2);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(600);
    for (let i = 0; i < 600; i += 3) {
      starPos[i] = (Math.random() - 0.5) * 60;
      starPos[i + 1] = (Math.random() - 0.5) * 60;
      starPos[i + 2] = (Math.random() - 0.5) * 30 - 10;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 }));
    scene.add(stars);

    // Answer cubes — 2x2 grid
    const cubeGeo = new THREE.BoxGeometry(2.8, 1.6, 0.4);
    const positions = [[-2, 1.2, 0], [2, 1.2, 0], [-2, -1.2, 0], [2, -1.2, 0]];
    cubesRef.current = [];
    positions.forEach((pos, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x1e3a6a, emissive: 0x0a1a3a, roughness: 0.3, metalness: 0.6 });
      const mesh = new THREE.Mesh(cubeGeo, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.castShadow = true;
      mesh.userData = { choice: 0, idx: i };
      scene.add(mesh);
      cubesRef.current.push(mesh);
    });

    // Raycaster for tap
    const raycaster = new THREE.Raycaster();
    const onTap = (e: PointerEvent) => {
      if (phase === 'playing' || stateRef.current.running) {
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(cubesRef.current);
        if (hits.length > 0) handleAnswer((hits[0].object.userData as { idx: number }).idx);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onTap);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft > 0 && s.timeLeft < 10) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    newProblem();

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.01;
      // Subtle float animation on cubes
      cubesRef.current.forEach((cube, i) => {
        cube.position.y = [1.2, 1.2, -1.2, -1.2][i] + Math.sin(t + i * 1.5) * 0.06;
        cube.rotation.y = Math.sin(t * 0.5 + i) * 0.04;
      });
      pLight.position.x = Math.sin(t * 0.4) * 3;
      stars.rotation.y += 0.0003;
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => { renderer.domElement.removeEventListener('pointerdown', onTap); };
  }, [endGame, newProblem, handleAnswer, phase]);

  useEffect(() => {
    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const W = window.innerWidth, H = window.innerHeight;
      cameraRef.current.aspect = W / H;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(W, H);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setQuestion('');
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  const problem = stateRef.current.problem;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(59,130,246,0.15) 0%, transparent 60%), linear-gradient(180deg, #0a0a1a 0%, #050510 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Crunch!" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={accent} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
                { label: 'SCORE', value: scoreDisplay, testId: 'score' },
              ]} />
              {/* Question overlay */}
              <div style={{
                position: 'absolute', top: '12%', left: '50%', transform: 'translateX(-50%)',
                zIndex: 10, textAlign: 'center', pointerEvents: 'none',
              }}>
                <div style={{ fontSize: 'clamp(28px,7vw,52px)', fontWeight: 900, color: '#fff',
                  textShadow: `0 0 30px ${accent}`, letterSpacing: 2 }}>{question}</div>
              </div>
              {/* Choice labels overlay */}
              {problem && (() => {
                const labels = [
                  { x: '28%', y: '38%' }, { x: '72%', y: '38%' },
                  { x: '28%', y: '62%' }, { x: '72%', y: '62%' },
                ];
                return problem.choices.map((c, i) => (
                  <div key={i} style={{
                    position: 'absolute', left: labels[i].x, top: labels[i].y,
                    transform: 'translate(-50%,-50%)', zIndex: 10, pointerEvents: 'none',
                    fontSize: 'clamp(22px,5vw,38px)', fontWeight: 900,
                    color: flashState?.idx === i ? (flashState.correct ? '#4ade80' : '#ef4444') : '#fff',
                    textShadow: `0 0 20px ${accent}`,
                  }}>{c}</div>
                ));
              })()}
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Correct', value: `${finalSig.correct}/${finalSig.totalProblems}`, color: '#4ade80' },
            { label: 'Avg Speed', value: finalSig.avgResponseMs > 0 ? `${Math.round(finalSig.avgResponseMs)}ms` : '—', color: accent },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Difficulty', value: `Lv ${finalSig.difficultyReached}`, color: accent },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.correct >= 8} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}
