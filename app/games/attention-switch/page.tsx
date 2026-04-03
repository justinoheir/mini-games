'use client';
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

const GAME_ID = 'attention-switch';
const ACCENT = '#f59e0b';
const DURATION = 45;
const GAME_EMOJI = '⚡';
const GAME_TITLE = 'Attention Switch';

interface Signals {
  total: number; correct: number; wrong: number; switchCount: number;
  switchAccuracy: number; switchCorrect: number; repeatAccuracy: number;
  repeatCorrect: number; repeatTotal: number; avgReactionMs: number;
  totalMs: number; score: number; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const overall = sig.total > 0 ? sig.correct / sig.total : 0;
  const switchAcc = sig.switchCount > 0 ? sig.switchCorrect / sig.switchCount : 0;
  if (overall >= 0.88 && switchAcc >= 0.8) return 'Dual-Stream Pro ⚡';
  if (sig.switchCount >= 8 && switchAcc >= 0.75) return 'Switch Master 🔀';
  if (overall >= 0.8) return 'Focused Mind 🎯';
  if (sig.avgReactionMs < 600) return 'Fast Reactor ⚡';
  return 'Dual Tasking 🧠';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

const LEFT_SHAPES = ['●', '■', '▲', '◆'];
const RIGHT_NUMBERS = ['2', '4', '6', '8'];
const ODD_NUMBERS = ['1', '3', '5', '7'];

interface Trial {
  cue: 'LEFT' | 'RIGHT'; leftSymbol: string; rightNumber: string;
  correctAnswer: 'left' | 'right'; isSwitch: boolean;
}
function makeTrial(prevCue: 'LEFT' | 'RIGHT' | null): Trial {
  const cue: 'LEFT' | 'RIGHT' = Math.random() < 0.5 ? 'LEFT' : 'RIGHT';
  const isSwitch = prevCue !== null && cue !== prevCue;
  const leftSymbol = LEFT_SHAPES[Math.floor(Math.random() * LEFT_SHAPES.length)];
  const rightNumber = Math.random() < 0.5
    ? RIGHT_NUMBERS[Math.floor(Math.random() * RIGHT_NUMBERS.length)]
    : ODD_NUMBERS[Math.floor(Math.random() * ODD_NUMBERS.length)];
  let correctAnswer: 'left' | 'right';
  if (cue === 'LEFT') { correctAnswer = 'left'; }
  else { correctAnswer = parseInt(rightNumber) % 2 === 0 ? 'right' : 'left'; }
  return { cue, leftSymbol, rightNumber, correctAnswer, isSwitch };
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  leftPanel: THREE.Mesh | null; rightPanel: THREE.Mesh | null;
  leftLight: THREE.PointLight | null; rightLight: THREE.PointLight | null;
  symbolSprite: THREE.Sprite | null; numberSprite: THREE.Sprite | null;
  cueArrow: THREE.Mesh | null;
  trial: Trial | null; prevCue: 'LEFT' | 'RIGHT' | null;
  shownAt: number; feedback: 'correct' | 'wrong' | null; feedbackTimer: number;
  level: number; flashTimer: number;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function makeTextSprite(text: string, color: string, size = 120): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.5, 2.5, 1);
  return sprite;
}

export default function AttentionSwitchGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, switchCount: 0, switchAccuracy: 0, switchCorrect: 0, repeatAccuracy: 0, repeatCorrect: 0, repeatTotal: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    leftPanel: null, rightPanel: null, leftLight: null, rightLight: null,
    symbolSprite: null, numberSprite: null, cueArrow: null,
    trial: null, prevCue: null, shownAt: 0, feedback: null, feedbackTimer: 0,
    level: 1, flashTimer: 0,
    intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const nextTrial = useCallback(() => {
    const s = stateRef.current;
    const t = makeTrial(s.prevCue);
    if (s.trial) s.prevCue = s.trial.cue;
    s.trial = t;
    s.shownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0;
    if (t.isSwitch) s.flashTimer = 20;

    // Update sprites
    if (s.scene) {
      if (s.symbolSprite) { s.scene.remove(s.symbolSprite); (s.symbolSprite.material as THREE.SpriteMaterial).dispose(); }
      if (s.numberSprite) { s.scene.remove(s.numberSprite); (s.numberSprite.material as THREE.SpriteMaterial).dispose(); }
      const symColor = t.cue === 'LEFT' ? '#3b82f6' : 'rgba(59,130,246,0.4)';
      const numColor = t.cue === 'RIGHT' ? '#f59e0b' : 'rgba(245,158,11,0.4)';
      const sym = makeTextSprite(t.leftSymbol, symColor);
      sym.position.set(-2.5, 0, 0);
      s.scene.add(sym);
      s.symbolSprite = sym;
      const num = makeTextSprite(t.rightNumber, numColor);
      num.position.set(2.5, 0, 0);
      s.scene.add(num);
      s.numberSprite = num;
    }
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, correct: 0, wrong: 0, switchCount: 0, switchAccuracy: 0, switchCorrect: 0, repeatAccuracy: 0, repeatCorrect: 0, repeatTotal: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.prevCue = null; s.level = 1; s.trial = null;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x07060f);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 8);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x111133, 3));

    // Divider
    const divider = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 10, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x333355, transparent: true, opacity: 0.6 })
    );
    scene.add(divider);

    // Left panel (blue zone)
    const leftPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 10),
      new THREE.MeshBasicMaterial({ color: 0x0a1a3a, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    );
    leftPanel.position.set(-3, 0, -1);
    scene.add(leftPanel);
    s.leftPanel = leftPanel;

    // Right panel (amber zone)
    const rightPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 10),
      new THREE.MeshBasicMaterial({ color: 0x1a1000, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    );
    rightPanel.position.set(3, 0, -1);
    scene.add(rightPanel);
    s.rightPanel = rightPanel;

    // Cue light on active side
    const leftLight = new THREE.PointLight(0x3b82f6, 0, 15);
    leftLight.position.set(-4, 2, 2);
    scene.add(leftLight);
    s.leftLight = leftLight;

    const rightLight = new THREE.PointLight(0xf59e0b, 0, 15);
    rightLight.position.set(4, 2, 2);
    scene.add(rightLight);
    s.rightLight = rightLight;

    // Particle field
    const pCount = 200;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 20;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pPos[i * 3 + 2] = -5 - Math.random() * 10;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x334466, size: 0.05 })));

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    nextTrial();

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const t = s.trial;

      if (s.feedbackTimer > 0) s.feedbackTimer--;
      if (s.flashTimer > 0) s.flashTimer--;

      // Timeout check
      if (t && s.feedback === null) {
        const elapsed = (Date.now() - s.shownAt) / 1000;
        const limit = Math.max(1.5, 4 - s.level * 0.2);
        if (elapsed > limit) {
          s.sig.total++; s.sig.wrong++; s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.feedback = 'wrong'; s.feedbackTimer = 12;
          setTimeout(() => { if (s.running) nextTrial(); }, 450);
        }
      }

      // Update lights based on cue
      if (t) {
        const isLeft = t.cue === 'LEFT';
        if (s.leftLight) {
          s.leftLight.intensity = isLeft ? (s.flashTimer > 0 ? 4 : 2) : 0;
        }
        if (s.rightLight) {
          s.rightLight.intensity = !isLeft ? (s.flashTimer > 0 ? 4 : 2) : 0;
        }
      }

      // Feedback flash
      if (s.feedback && s.feedbackTimer > 0 && s.leftPanel && s.rightPanel) {
        const mat = s.feedback === 'correct' ? 0x0a3a1a : 0x3a0a0a;
        (s.leftPanel.material as THREE.MeshBasicMaterial).color.setHex(mat);
        (s.rightPanel.material as THREE.MeshBasicMaterial).color.setHex(mat);
      } else if (s.leftPanel && s.rightPanel) {
        (s.leftPanel.material as THREE.MeshBasicMaterial).color.setHex(0x0a1a3a);
        (s.rightPanel.material as THREE.MeshBasicMaterial).color.setHex(0x1a1000);
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, nextTrial]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.feedback !== null || !s.trial) return;
      const rect = mount.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const isLeft = px < rect.width / 2;
      const playerAnswer: 'left' | 'right' = isLeft ? 'left' : 'right';
      const ms = Date.now() - s.shownAt;
      s.sig.total++; s.sig.totalMs += ms;
      const t = s.trial;
      if (t.isSwitch) s.sig.switchCount++;
      else s.sig.repeatTotal++;
      if (playerAnswer === t.correctAnswer) {
        s.sig.correct++;
        if (t.isSwitch) s.sig.switchCorrect++; else s.sig.repeatCorrect++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const speedPts = ms < 600 ? 3 : ms < 1200 ? 2 : 1;
        s.sig.score += speedPts; setScoreDisplay(s.sig.score);
        s.level = Math.min(6, 1 + Math.floor(s.sig.correct / 5));
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.feedback = 'correct'; s.feedbackTimer = 10;
      } else {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
        s.feedback = 'wrong'; s.feedbackTimer = 12;
      }
      setTimeout(() => { if (s.running) nextTrial(); }, 400);
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, nextTrial]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Left=shapes, Right=even numbers. The cue tells you which to attend!"
          ctaLabel="Focus! ⚡" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Switches', value: String(finalSig.switchCount), color: '#fbbf24' },
            { label: 'Switch Acc', value: `${finalSig.switchCount > 0 ? Math.round(finalSig.switchCorrect / finalSig.switchCount * 100) : 0}%`, color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.correct >= 15} />
      )}
    </GameShell>
  );
}
