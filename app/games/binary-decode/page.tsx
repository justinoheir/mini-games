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

const GAME_ID = 'binary-decode';
const ACCENT = '#22c55e';
const DURATION = 45;
const GAME_EMOJI = '💻';
const GAME_TITLE = 'Binary Decode';
const GAME_TAGLINE = 'Flip the bits. Find the number.';

interface Signals {
  total: number; correct: number; wrong: number; maxBits: number;
  avgReactionMs: number; totalMs: number; score: number;
  maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.correct / sig.total : 0;
  if (acc >= 0.9 && sig.maxBits >= 7) return 'Binary Wizard 🧙';
  if (sig.maxBits >= 8) return 'Bit Flipper 💻';
  if (acc >= 0.8) return 'Code Decoder ⚡';
  if (sig.avgReactionMs < 1500) return 'Quick Reader 📟';
  return 'Learning Bits 🔢';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface BitObj { mesh: THREE.Mesh; value: 0 | 1; index: number; }
interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  bits: BitObj[]; targetNumber: number; numBits: number;
  choiceButtons: THREE.Mesh[]; choices: number[];
  shownAt: number; phase2: 'input' | 'answer'; feedback: 'correct' | 'wrong' | null;
  feedbackTimer: number; level: number;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function makeTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = color;
  ctx.font = 'bold 72px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2, 1, 1);
  return sp;
}

export default function BinaryDecodeGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, correct: 0, wrong: 0, maxBits: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    bits: [], targetNumber: 0, numBits: 4, choiceButtons: [], choices: [],
    shownAt: 0, phase2: 'input', feedback: null, feedbackTimer: 0, level: 1,
    intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const nextPuzzle = useCallback((scene: THREE.Scene, s: GS) => {
    // Clear old bits and buttons
    s.bits.forEach(b => { scene.remove(b.mesh); b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose(); });
    s.choiceButtons.forEach(b => { scene.remove(b); b.geometry.dispose(); (b.material as THREE.Material).dispose(); });
    s.bits = []; s.choiceButtons = [];
    // Also remove any sprites
    scene.children.filter(c => c instanceof THREE.Sprite).forEach(c => scene.remove(c));

    const numBits = Math.min(8, 4 + Math.floor(s.level / 3));
    s.numBits = numBits;
    s.targetNumber = Math.floor(Math.random() * (Math.pow(2, numBits) - 1)) + 1;
    s.sig.maxBits = Math.max(s.sig.maxBits, numBits);
    s.phase2 = 'input';
    s.shownAt = Date.now();
    s.feedback = null; s.feedbackTimer = 0;

    // Get binary of target
    const binary = s.targetNumber.toString(2).padStart(numBits, '0');

    // Create bit meshes
    const totalW = numBits * 1.4;
    for (let i = 0; i < numBits; i++) {
      const val = parseInt(binary[i]) as 0 | 1;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 1.1, 0.3),
        new THREE.MeshStandardMaterial({
          color: val === 1 ? 0x22c55e : 0x1a1a2e,
          emissive: val === 1 ? 0x22c55e : 0x111122,
          emissiveIntensity: val === 1 ? 0.6 : 0.1,
          roughness: 0.4, metalness: 0.3
        })
      );
      mesh.position.set(-totalW / 2 + i * 1.4 + 0.7, 0.5, 0);
      scene.add(mesh);

      // Bit label
      const label = makeTextSprite(String(val), val === 1 ? '#ffffff' : '#666688');
      label.position.copy(mesh.position);
      label.position.z = 0.2;
      scene.add(label);

      s.bits.push({ mesh, value: val, index: i });
    }

    // Answer choices (multiple choice)
    const correct = s.targetNumber;
    const wrongOpts = new Set<number>();
    while (wrongOpts.size < 3) {
      const w = Math.max(0, correct + Math.floor((Math.random() - 0.5) * 10));
      if (w !== correct) wrongOpts.add(w);
    }
    const allChoices = [correct, ...Array.from(wrongOpts)].sort(() => Math.random() - 0.5);
    s.choices = allChoices;

    allChoices.forEach((num, i) => {
      const btn = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.7, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x1e3a2e, emissive: 0x22c55e, emissiveIntensity: 0.15, roughness: 0.5 })
      );
      btn.position.set(-2.4 + i * 1.7, -1.5, 0);
      scene.add(btn);
      s.choiceButtons.push(btn);

      const sp = makeTextSprite(String(num), '#22c55e');
      sp.position.copy(btn.position);
      sp.position.z = 0.15;
      scene.add(sp);
    });
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    if (s.sig.total > 0) s.sig.avgReactionMs = s.sig.totalMs / s.sig.total;
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, correct: 0, wrong: 0, maxBits: 0, avgReactionMs: 0, totalMs: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.level = 1;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x060a14);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 8);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x113322, 3));
    const glow = new THREE.PointLight(0x22c55e, 1.5, 20);
    glow.position.set(0, 2, 5);
    scene.add(glow);

    // Matrix rain particles
    const pPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 20;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      pPos[i * 3 + 2] = -5 - Math.random() * 10;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x22c55e, size: 0.04, transparent: true, opacity: 0.3 })));

    // Circuit board grid lines
    for (let i = -5; i <= 5; i++) {
      const hLine = new THREE.Mesh(
        new THREE.BoxGeometry(12, 0.02, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x112233, transparent: true, opacity: 0.4 })
      );
      hLine.position.set(0, i * 0.8, -1);
      scene.add(hLine);
    }

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    nextPuzzle(scene, s);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;

      if (s.feedbackTimer > 0) s.feedbackTimer--;

      // Animate bits
      s.bits.forEach((b, i) => {
        b.mesh.position.y = 0.5 + Math.sin(Date.now() * 0.002 + i * 0.5) * 0.05;
        if (b.value === 1) {
          const mat = b.mesh.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 0.4 + Math.sin(Date.now() * 0.005 + i) * 0.2;
        }
      });

      // Choice button pulse
      s.choiceButtons.forEach(btn => {
        const mat = btn.material as THREE.MeshStandardMaterial;
        if (s.feedback === 'correct') { mat.color.setHex(0x0a3a1a); mat.emissive.setHex(0x00ff44); mat.emissiveIntensity = 0.5; }
        else if (s.feedback === 'wrong') { mat.color.setHex(0x3a0a0a); mat.emissive.setHex(0xff2200); mat.emissiveIntensity = 0.5; }
        else { mat.emissiveIntensity = 0.1 + Math.sin(Date.now() * 0.003) * 0.05; }
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, nextPuzzle]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.feedback !== null || !s.camera) return;
      const rect = mount.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), s.camera);
      const hits = raycaster.intersectObjects(s.choiceButtons);
      if (hits.length > 0) {
        const btnIdx = s.choiceButtons.indexOf(hits[0].object as THREE.Mesh);
        if (btnIdx < 0) return;
        const chosen = s.choices[btnIdx];
        const ms = Date.now() - s.shownAt;
        s.sig.total++; s.sig.totalMs += ms;
        if (chosen === s.targetNumber) {
          s.sig.correct++; s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          const speedPts = ms < 1500 ? 3 : ms < 3000 ? 2 : 1;
          s.sig.score += speedPts; setScoreDisplay(s.sig.score);
          s.level = Math.min(10, 1 + Math.floor(s.sig.correct / 3));
          sfx.success(); hapticScore();
          if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
          s.feedback = 'correct'; s.feedbackTimer = 15;
        } else {
          s.sig.wrong++; s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.feedback = 'wrong'; s.feedbackTimer = 15;
        }
        setTimeout(() => {
          if (s.running && s.scene) nextPuzzle(s.scene, s);
        }, 500);
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, nextPuzzle]);

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
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Read the binary bits — tap the matching decimal number!"
          ctaLabel="Decode! 💻" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Max Bits', value: String(finalSig.maxBits), color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Avg Reaction', value: `${Math.round(finalSig.avgReactionMs)}ms`, color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.correct >= 10} />
      )}
    </GameShell>
  );
}
