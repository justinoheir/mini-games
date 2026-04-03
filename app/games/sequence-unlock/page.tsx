'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
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

interface Signals {
  roundsCompleted: number; longestSequence: number; totalTaps: number;
  wrongTaps: number; score: number; maxStreak: number; streakCurrent: number;
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

const NODE_COLORS_HEX = [0xa855f7, 0x3b82f6, 0x22c55e, 0xf43f5e, 0xfbbf24, 0x06b6d4];
const NODE_COUNT = 5;

export default function SequenceUnlockGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    nodeMeshes: [] as THREE.Mesh[],
    nodeGlows: [] as THREE.PointLight[],
    connectionLines: [] as THREE.Line[],
    running: false, timeLeft: DURATION,
    sig: { roundsCompleted: 0, longestSequence: 0, totalTaps: 0, wrongTaps: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    sequence: [] as number[],
    playerInput: [] as number[],
    subPhase: 'showing' as GameSubPhase,
    showIdx: 0, showTimer: 0,
    sequenceLen: 2, inputTimeout: 0,
    resultTimer: 0, success: false,
    nodeWorldPos: [] as THREE.Vector3[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const startRound = useCallback(() => {
    const s = stateRef.current;
    s.sequence = Array.from({ length: s.sequenceLen }, () => Math.floor(Math.random() * NODE_COUNT));
    s.playerInput = [];
    s.subPhase = 'showing';
    s.showIdx = 0;
    s.showTimer = 45;
    // Reset node glows
    s.nodeGlows.forEach(g => { g.intensity = 0; });
    s.nodeMeshes.forEach(m => {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.05;
    });
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { roundsCompleted: 0, longestSequence: 0, totalTaps: 0, wrongTaps: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.sequenceLen = 2;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x08040f);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 7);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x130a1a, 3));
    const mainLight = new THREE.PointLight(0xa855f7, 2, 20);
    mainLight.position.set(0, 5, 5);
    scene.add(mainLight);

    // Stars
    const starPos = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) { starPos[i*3] = (Math.random()-0.5)*50; starPos[i*3+1] = (Math.random()-0.5)*50; starPos[i*3+2] = (Math.random()-0.5)*50; }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.05 })));

    // Create nodes in a pentagon
    const nodeMeshes: THREE.Mesh[] = [];
    const nodeGlows: THREE.PointLight[] = [];
    const nodeWorldPos: THREE.Vector3[] = [];
    const radius = 2.5;
    for (let i = 0; i < NODE_COUNT; i++) {
      const angle = (i / NODE_COUNT) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const color = NODE_COLORS_HEX[i];
      const geo = new THREE.SphereGeometry(0.38, 16, 16);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.05, roughness: 0.3, metalness: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, 0);
      scene.add(mesh);
      nodeMeshes.push(mesh);
      nodeWorldPos.push(new THREE.Vector3(x, y, 0));
      const glow = new THREE.PointLight(color, 0, 5);
      glow.position.set(x, y, 0.5);
      scene.add(glow);
      nodeGlows.push(glow);
    }
    s.nodeMeshes = nodeMeshes;
    s.nodeGlows = nodeGlows;
    s.nodeWorldPos = nodeWorldPos;

    // Connection lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0xa855f720, transparent: true, opacity: 0.15 });
    for (let i = 0; i < NODE_COUNT; i++) {
      for (let j = i + 1; j < NODE_COUNT; j++) {
        const geo = new THREE.BufferGeometry().setFromPoints([nodeWorldPos[i], nodeWorldPos[j]]);
        scene.add(new THREE.Line(geo, lineMat));
      }
    }

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    startRound();

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;

      // Show sequence phase
      if (s.subPhase === 'showing') {
        s.showTimer--;
        if (s.showTimer === 35) {
          const nodeIdx = s.sequence[s.showIdx];
          const mat = nodeMeshes[nodeIdx].material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 1.2;
          nodeGlows[nodeIdx].intensity = 3;
          hapticTick(); sfx.collect();
        }
        if (s.showTimer === 15) {
          const nodeIdx = s.sequence[s.showIdx];
          const mat = nodeMeshes[nodeIdx].material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 0.05;
          nodeGlows[nodeIdx].intensity = 0;
        }
        if (s.showTimer <= 0) {
          s.showIdx++;
          if (s.showIdx >= s.sequence.length) {
            s.subPhase = 'input';
            s.inputTimeout = 120 + s.sequenceLen * 30;
          } else {
            s.showTimer = 45;
          }
        }
      } else if (s.subPhase === 'input') {
        s.inputTimeout--;
        if (s.inputTimeout <= 0 && s.playerInput.length < s.sequence.length) {
          s.sig.wrongTaps++; s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.subPhase = 'result'; s.success = false; s.resultTimer = 50;
        }
      } else if (s.subPhase === 'result') {
        s.resultTimer--;
        if (s.resultTimer <= 0) {
          if (s.success) s.sequenceLen = Math.min(s.sequenceLen + 1, 9);
          else s.sequenceLen = Math.max(2, s.sequenceLen - 1);
          startRound();
        }
      }

      // Node idle pulse
      nodeMeshes.forEach((mesh, i) => {
        mesh.rotation.y = t * 0.3 + i * 0.5;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.emissiveIntensity < 0.1) {
          const pulse = 0.03 + Math.sin(t * 1.5 + i * 1.2) * 0.02;
          mat.emissiveIntensity = pulse;
        }
      });

      // Result flash background
      if (s.subPhase === 'result') {
        mainLight.color.setHex(s.success ? 0x22c55e : 0xef4444);
        mainLight.intensity = 3 + Math.sin(t * 8) * 1;
      } else {
        mainLight.color.setHex(0xa855f7);
        mainLight.intensity = 2;
      }

      // Input phase: nodes glow slightly cyan-ish
      if (s.subPhase === 'input') {
        nodeMeshes.forEach((mesh, i) => {
          if (!s.playerInput.includes(i)) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = 0.1 + Math.sin(t * 3 + i) * 0.05;
          }
        });
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Tap handler — project screen tap to node
    const onTap = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running || s2.subPhase !== 'input') return;
      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hits = raycaster.intersectObjects(nodeMeshes);
      if (hits.length > 0) {
        const hitIdx = nodeMeshes.indexOf(hits[0].object as THREE.Mesh);
        if (hitIdx < 0) return;
        const expected = s2.sequence[s2.playerInput.length];
        s2.sig.totalTaps++;
        const mat = nodeMeshes[hitIdx].material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.0;
        nodeGlows[hitIdx].intensity = 2;
        setTimeout(() => { mat.emissiveIntensity = 0.05; nodeGlows[hitIdx].intensity = 0; }, 300);

        if (hitIdx === expected) {
          s2.playerInput.push(hitIdx);
          hapticTick(); sfx.collect();
          if (s2.playerInput.length === s2.sequence.length) {
            s2.sig.roundsCompleted++; s2.sig.streakCurrent++;
            if (s2.sig.streakCurrent > s2.sig.maxStreak) s2.sig.maxStreak = s2.sig.streakCurrent;
            if (s2.sequenceLen > s2.sig.longestSequence) s2.sig.longestSequence = s2.sequenceLen;
            const pts = s2.sequenceLen * 2 + (s2.sig.streakCurrent >= 3 ? 3 : 0);
            s2.sig.score += pts; setScoreDisplay(s2.sig.score);
            s2.subPhase = 'result'; s2.success = true; s2.resultTimer = 40;
            hapticCombo(s2.sig.streakCurrent); sfx.collect();
          }
        } else {
          s2.sig.wrongTaps++; s2.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s2.subPhase = 'result'; s2.success = false; s2.resultTimer = 45;
        }
      }
    };
    if (mountRef.current) mountRef.current.addEventListener('pointerdown', onTap);
    (s as any)._tapCleanup = () => mountRef.current?.removeEventListener('pointerdown', onTap);
  }, [endGame, startRound]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._tapCleanup?.();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Watch the glowing orbs light up in sequence — then tap the same order!"
          ctaLabel="Remember! 💡" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Rounds', value: String(finalSig.roundsCompleted), color: accent },
            { label: 'Longest', value: `${finalSig.longestSequence} nodes`, color: '#fbbf24' },
            { label: 'Wrong Taps', value: String(finalSig.wrongTaps), color: finalSig.wrongTaps === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.longestSequence >= 6} />
      )}
    </GameShell>
  );
}
