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

const GAME_ID = 'basket-weave';
const ACCENT = '#d97706';
const DURATION = 60;
const GAME_EMOJI = '🧺';
const GAME_TITLE = 'Basket Weave';
const GAME_TAGLINE = "Over. Under. Don't drop a strand.";

type Side = 'left' | 'right';
interface Strand {
  side: Side; z: number; tapped: boolean; wrong: boolean; mesh: THREE.Mesh | null; alpha: number;
}
interface Signals {
  correctWeaves: number; mistakes: number; maxStreak: number;
  streakCurrent: number; basketProgress: number; score: number;
}
function getPersonality(s: Signals): string {
  if (s.basketProgress >= 90 && s.mistakes === 0) return 'Master Weaver 🏆';
  if (s.correctWeaves >= 30) return 'Reed Whisperer 🌾';
  if (s.mistakes >= 10) return 'Tangled Fingers 🪢';
  if (s.maxStreak >= 12) return 'Rhythm Weaver 🎵';
  return 'Apprentice Weaver 🧵';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  strands: Strand[]; basketMesh: THREE.Group | null;
  nextSide: Side; frame: number;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

const STRAND_COLORS = [0xd97706, 0xa16207, 0xf59e0b, 0x92400e, 0xd97706, 0xb45309];

export default function BasketWeaveGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { correctWeaves: 0, mistakes: 0, maxStreak: 0, streakCurrent: 0, basketProgress: 0, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    strands: [], basketMesh: null, nextSide: 'left', frame: 0,
    intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

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
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory();
  }, []);

  const spawnStrand = useCallback((scene: THREE.Scene, s: GS) => {
    const side = s.nextSide;
    s.nextSide = side === 'left' ? 'right' : 'left';
    const colorHex = STRAND_COLORS[Math.floor(Math.random() * STRAND_COLORS.length)];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.18, 0.18),
      new THREE.MeshStandardMaterial({
        color: colorHex, emissive: colorHex, emissiveIntensity: 0.2,
        roughness: 0.5, metalness: 0.2
      })
    );
    mesh.position.set(side === 'left' ? -8 : 8, (s.strands.length % 5 - 2) * 0.6, 0);
    scene.add(mesh);
    s.strands.push({ side, z: mesh.position.y, tapped: false, wrong: false, mesh, alpha: 1 });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { correctWeaves: 0, mistakes: 0, maxStreak: 0, streakCurrent: 0, basketProgress: 0, score: 0 };
    s.strands = []; s.nextSide = 'left';
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0e05);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x553311, 3));
    const warmLight = new THREE.PointLight(0xff8800, 2, 25);
    warmLight.position.set(2, 3, 5);
    scene.add(warmLight);
    const fillLight = new THREE.PointLight(0xffaa44, 1, 20);
    fillLight.position.set(-3, -2, 4);
    scene.add(fillLight);

    // Weave frame posts
    [-3, 3].forEach(x => {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 6, 8),
        new THREE.MeshStandardMaterial({ color: 0x5a3500, roughness: 0.9 })
      );
      post.position.set(x, 0, -0.2);
      scene.add(post);
    });

    // Basket base (partial woven look)
    const basketGroup = new THREE.Group();
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(1.1, 0.12, 0.12),
          new THREE.MeshStandardMaterial({ color: row % 2 === 0 ? 0x92400e : 0xd97706 })
        );
        bar.position.set(col - 2.5, row * 0.25 - 2.5, 0);
        basketGroup.add(bar);
      }
    }
    basketGroup.position.z = -1;
    scene.add(basketGroup);
    s.basketMesh = basketGroup;

    // Particles
    const pPos = new Float32Array(100 * 3);
    for (let i = 0; i < 100; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 15;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pPos[i * 3 + 2] = -5 - Math.random() * 5;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xd97706, size: 0.05, transparent: true, opacity: 0.3 })));

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    // Spawn initial strands
    for (let i = 0; i < 4; i++) spawnStrand(scene, s);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Animate strands in from sides
      for (const strand of s.strands) {
        if (!strand.mesh) continue;
        const targetX = 0;
        if (strand.side === 'left' && strand.mesh.position.x < targetX) {
          strand.mesh.position.x += 0.12;
        } else if (strand.side === 'right' && strand.mesh.position.x > targetX) {
          strand.mesh.position.x -= 0.12;
        }
        if (strand.wrong) {
          const mat = strand.mesh.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0xff2200);
          mat.emissiveIntensity = 0.5;
          strand.alpha -= 0.03;
          strand.mesh.material = mat;
          if (strand.alpha <= 0) {
            scene.remove(strand.mesh);
            strand.mesh = null;
          }
        }
      }
      s.strands = s.strands.filter(st => st.mesh !== null);

      // Spawn new strand periodically
      if (s.frame % 45 === 0 && s.strands.length < 6) {
        spawnStrand(scene, s);
      }

      // Rotate basket slowly
      if (s.basketMesh) {
        s.basketMesh.rotation.y = Math.sin(s.frame * 0.01) * 0.1;
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnStrand]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      const rect = mount.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const side: Side = px < rect.width / 2 ? 'left' : 'right';
      // Find the frontmost untapped strand
      const frontStrand = s.strands.find(st => !st.tapped && !st.wrong);
      if (!frontStrand) return;
      if (frontStrand.side === side) {
        frontStrand.tapped = true;
        s.sig.correctWeaves++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const mult = s.sig.streakCurrent >= 5 ? 2 : 1;
        s.sig.score += 2 * mult;
        s.sig.basketProgress = Math.min(100, s.sig.basketProgress + 2);
        setScoreDisplay(s.sig.score);
        sfx.collect(); hapticScore();
        if (s.sig.streakCurrent >= 3) hapticCombo(s.sig.streakCurrent);
        if (frontStrand.mesh) {
          const mat = frontStrand.mesh.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0x4ade80);
          mat.emissiveIntensity = 0.6;
          setTimeout(() => {
            if (frontStrand.mesh) {
              (frontStrand.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1;
            }
          }, 200);
        }
        // Remove this strand and spawn new one
        setTimeout(() => {
          if (!stateRef.current.running || !stateRef.current.scene) return;
          if (frontStrand.mesh) {
            stateRef.current.scene.remove(frontStrand.mesh);
            frontStrand.mesh = null;
          }
          spawnStrand(stateRef.current.scene, stateRef.current);
        }, 300);
      } else {
        frontStrand.wrong = true;
        s.sig.mistakes++;
        s.sig.streakCurrent = 0;
        sfx.collision(); hapticFail();
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, spawnStrand]);

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
          description="Tap the side the strand comes from — Left or Right. Build the weave!"
          ctaLabel="Weave! 🧺" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Correct Weaves', value: String(finalSig.correctWeaves), color: ACCENT },
            { label: 'Mistakes', value: String(finalSig.mistakes), color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Progress', value: `${Math.round(finalSig.basketProgress)}%`, color: '#4ade80' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.basketProgress >= 50} />
      )}
    </GameShell>
  );
}
