'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo, hapticWarning } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'category-clash';
const ACCENT = '#a78bfa';
const DURATION = 30;
const GAME_EMOJI = '📦';
const GAME_TITLE = 'Category Clash';
const GAME_TAGLINE = 'Sort fast. But the rules keep changing!';

interface Signals {
  total: number; correct: number; wrong: number; correctAfterSwitch: number;
  switchCount: number; avgReactionMs: number; totalMs: number;
  score: number; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  if (acc >= 0.85 && sig.switchCount >= 4) return 'Adaptive Ace 🧠';
  if (sig.correctAfterSwitch >= 6) return 'Switch Expert 🔀';
  if (acc >= 0.8) return 'Fast Sorter 📦';
  if (sig.avgReactionMs < 500) return 'Lightning Sort ⚡';
  return 'Still Sorting 🤔';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

const CATEGORIES = [
  { name: 'Animals', items: ['🐶', '🐱', '🐭', '🐸', '🦊', '🐨', '🦁', '🐯'] },
  { name: 'Food', items: ['🍕', '🍔', '🍎', '🍓', '🥑', '🍦', '🥐', '🍣'] },
  { name: 'Sports', items: ['⚽', '🏀', '🎾', '🏈', '⚾', '🎿', '🏊', '🚴'] },
];

interface Trial { item: string; category: string; correctSide: 'left' | 'right'; isSwitch: boolean; }

function makeTrial(prevCat: string | null, currentCatName: string, categories: typeof CATEGORIES): Trial {
  const cat = categories.find(c => c.name === currentCatName)!;
  const item = cat.items[Math.floor(Math.random() * cat.items.length)];
  const correctSide: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
  return { item, category: currentCatName, correctSide, isSwitch: prevCat !== null && prevCat !== currentCatName };
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  itemSprite: THREE.Sprite | null; leftPanel: THREE.Mesh | null; rightPanel: THREE.Mesh | null;
  leftLight: THREE.PointLight | null; rightLight: THREE.PointLight | null;
  trial: Trial | null; prevCat: string | null; currentCatName: string;
  shownAt: number; feedback: 'correct' | 'wrong' | null; feedbackTimer: number;
  catSwitchTimer: number; level: number;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function makeEmojiSprite(emoji: string, size = 100): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 200; canvas.height = 200;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 200, 200);
  ctx.font = `${size}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 100, 100);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(3, 3, 1);
  return sp;
}

function CategoryClashGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, correctAfterSwitch: 0, switchCount: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    itemSprite: null, leftPanel: null, rightPanel: null,
    leftLight: null, rightLight: null,
    trial: null, prevCat: null, currentCatName: 'Animals',
    shownAt: 0, feedback: null, feedbackTimer: 0,
    catSwitchTimer: 0, level: 1,
    intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const nextTrial = useCallback((scene: THREE.Scene, s: GS) => {
    if (s.itemSprite) { scene.remove(s.itemSprite); (s.itemSprite.material as THREE.SpriteMaterial).dispose(); }
    const t = makeTrial(s.prevCat, s.currentCatName, CATEGORIES);
    if (s.trial) s.prevCat = s.trial.category;
    s.trial = t;
    s.shownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0;

    const sp = makeEmojiSprite(t.item);
    sp.position.set(0, 0.5, 0);
    scene.add(sp);
    s.itemSprite = sp;

    // Update panel labels
    if (t.correctSide === 'left') {
      if (s.leftLight) s.leftLight.intensity = 2;
      if (s.rightLight) s.rightLight.intensity = 0.5;
    } else {
      if (s.rightLight) s.rightLight.intensity = 2;
      if (s.leftLight) s.leftLight.intensity = 0.5;
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
    if (s.sig.total > 0) s.sig.avgReactionMs = s.sig.totalMs / s.sig.total;
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, correct: 0, wrong: 0, correctAfterSwitch: 0, switchCount: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.prevCat = null; s.currentCatName = 'Animals'; s.level = 1; s.catSwitchTimer = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0f0820);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 9);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x221133, 3));
    const leftLight = new THREE.PointLight(0xa78bfa, 2, 18);
    leftLight.position.set(-4, 2, 3);
    scene.add(leftLight);
    s.leftLight = leftLight;
    const rightLight = new THREE.PointLight(0xf59e0b, 0.5, 18);
    rightLight.position.set(4, 2, 3);
    scene.add(rightLight);
    s.rightLight = rightLight;

    // Left zone
    const leftPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 9),
      new THREE.MeshBasicMaterial({ color: 0x1a1035, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    leftPanel.position.set(-2.8, 0, -0.5);
    scene.add(leftPanel);
    s.leftPanel = leftPanel;

    // Right zone
    const rightPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 9),
      new THREE.MeshBasicMaterial({ color: 0x1a1005, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    rightPanel.position.set(2.8, 0, -0.5);
    scene.add(rightPanel);
    s.rightPanel = rightPanel;

    // Divider
    const div = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 10, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.5 })
    );
    scene.add(div);

    // Category labels as 3D text sprites
    const leftLabelSp = makeEmojiSprite('←', 60);
    leftLabelSp.position.set(-2.5, -2.5, 0);
    scene.add(leftLabelSp);
    const rightLabelSp = makeEmojiSprite('→', 60);
    rightLabelSp.position.set(2.5, -2.5, 0);
    scene.add(rightLabelSp);

    // Stars
    const sPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 20;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      sPos[i * 3 + 2] = -5 - Math.random() * 8;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0x886699, size: 0.05, transparent: true, opacity: 0.4 })));

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    nextTrial(scene, s);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.catSwitchTimer++;
      // Switch category every ~8 seconds
      if (s.catSwitchTimer >= 8) {
        s.catSwitchTimer = 0;
        const others = CATEGORIES.filter(c => c.name !== s.currentCatName);
        s.currentCatName = others[Math.floor(Math.random() * others.length)].name;
        s.sig.switchCount++;
        sfx.warning?.(); hapticWarning?.();
      }
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      if (s.feedbackTimer > 0) s.feedbackTimer--;

      // Timeout
      const t = s.trial;
      if (t && s.feedback === null) {
        const elapsed = (Date.now() - s.shownAt) / 1000;
        const limit = Math.max(1.2, 3 - s.level * 0.2);
        if (elapsed > limit) {
          s.sig.total++; s.sig.wrong++; s.sig.streakCurrent = 0;
          sfx.collision?.(); hapticFail?.();
          s.feedback = 'wrong'; s.feedbackTimer = 10;
          setTimeout(() => { if (s.running && s.scene) nextTrial(s.scene, s); }, 400);
        }
      }

      // Panel feedback
      if (s.leftPanel && s.rightPanel) {
        if (s.feedback === 'correct') {
          (s.leftPanel.material as THREE.MeshBasicMaterial).color.setHex(0x0a3a1a);
          (s.rightPanel.material as THREE.MeshBasicMaterial).color.setHex(0x0a3a1a);
        } else if (s.feedback === 'wrong') {
          (s.leftPanel.material as THREE.MeshBasicMaterial).color.setHex(0x3a0a0a);
          (s.rightPanel.material as THREE.MeshBasicMaterial).color.setHex(0x3a0a0a);
        } else {
          (s.leftPanel.material as THREE.MeshBasicMaterial).color.setHex(0x1a1035);
          (s.rightPanel.material as THREE.MeshBasicMaterial).color.setHex(0x1a1005);
        }
      }

      // Item sprite bounce
      if (s.itemSprite) {
        s.itemSprite.position.y = 0.5 + Math.sin(Date.now() * 0.003) * 0.1;
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
      const isLeft = (e.clientX - rect.left) < rect.width / 2;
      const answer: 'left' | 'right' = isLeft ? 'left' : 'right';
      const ms = Date.now() - s.shownAt;
      s.sig.total++; s.sig.totalMs += ms;
      const t = s.trial;
      if (answer === t.correctSide) {
        s.sig.correct++;
        if (t.isSwitch) s.sig.correctAfterSwitch++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = ms < 500 ? 3 : ms < 1200 ? 2 : 1;
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        s.level = Math.min(8, 1 + Math.floor(s.sig.correct / 5));
        sfx.collect?.(); hapticScore?.();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        s.feedback = 'correct'; s.feedbackTimer = 8;
      } else {
        s.sig.wrong++; s.sig.streakCurrent = 0;
        sfx.collision?.(); hapticFail?.();
        s.feedback = 'wrong'; s.feedbackTimer = 10;
      }
      setTimeout(() => { if (s.running && s.scene) nextTrial(s.scene, s); }, 350);
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

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Sort! 📦" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.total > 0 ? Math.round(finalSig.correct / finalSig.total * 100) : 0}%`, color: ACCENT },
            { label: 'Switches', value: String(finalSig.switchCount), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Post-Switch Correct', value: String(finalSig.correctAfterSwitch), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.correct >= 15} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const CategoryClashGame = dynamic(() => Promise.resolve({ default: CategoryClashGameInner }), { ssr: false });
export default CategoryClashGame;
