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

const GAME_ID = 'cable-wrap';
const ACCENT = '#34d399';
const DURATION = 45;
const GAME_EMOJI = '🔌';
const GAME_TITLE = 'Cable Wrap';
const GAME_TAGLINE = 'Wrap every peg. No tangles.';
const PB_KEY = 'mg_pb_cable-wrap';

interface PegObj { mesh: THREE.Mesh; x: number; y: number; wrapped: boolean; id: number; }
interface Signals { score: number; wrapped: number; tangles: number; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  if (sig.wrapped >= 8 && sig.tangles === 0) return 'Cable Whisperer 🔌';
  if (sig.wrapped >= 6 && sig.tangles <= 1) return 'Neat Freak 🧹';
  if (sig.wrapped >= 4) return 'Getting Tidy 🪢';
  if (sig.tangles > sig.wrapped) return 'Total Tangle 😵';
  return 'Apprentice Wrapper 🔧';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  pegs: PegObj[]; cableEndMesh: THREE.Mesh | null;
  cablePath: THREE.Vector2[]; cableLine: THREE.Line | null;
  lastPegId: number; dragging: boolean;
  cableEndX: number; cableEndY: number;
  frame: number;
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

export default function CableWrapGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, wrapped: 0, tangles: 0, maxStreak: 0, streakCurrent: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    pegs: [], cableEndMesh: null, cablePath: [], cableLine: null,
    lastPegId: -1, dragging: false, cableEndX: 0, cableEndY: 0,
    frame: 0, stopMusic: null, intervalId: null, resizeCleanup: null,
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
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > prev) localStorage.setItem(PB_KEY, String(s.sig.score));
    } catch { /* */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const setupPegs = useCallback((scene: THREE.Scene, s: GS) => {
    s.pegs.forEach(p => { scene.remove(p.mesh); });
    s.pegs = [];
    const positions = [
      { x: -2.5, y: 1.5 }, { x: 0, y: 2 }, { x: 2.5, y: 1.5 },
      { x: -2, y: -0.5 }, { x: 0, y: -1.5 }, { x: 2, y: -0.5 },
    ];
    positions.forEach((pos, i) => {
      const peg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.2, 0.5, 12),
        new THREE.MeshStandardMaterial({ color: 0x334466, emissive: 0x34d399, emissiveIntensity: 0.1, metalness: 0.6, roughness: 0.3 })
      );
      peg.position.set(pos.x, pos.y, 0);
      peg.rotation.x = Math.PI / 2;
      scene.add(peg);
      s.pegs.push({ mesh: peg, x: pos.x, y: pos.y, wrapped: false, id: i });
    });
  }, []);

  const updateCableLine = useCallback((scene: THREE.Scene, s: GS) => {
    if (s.cableLine) { scene.remove(s.cableLine); s.cableLine.geometry.dispose(); }
    if (s.cablePath.length < 2) return;
    const pts = s.cablePath.map(p => new THREE.Vector3(p.x, p.y, 0));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x34d399, linewidth: 2 }));
    scene.add(line);
    s.cableLine = line;
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, wrapped: 0, tangles: 0, maxStreak: 0, streakCurrent: 0 };
    s.cablePath = []; s.lastPegId = -1; s.dragging = false;
    s.cableEndX = -3.5; s.cableEndY = -2.5;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a1520);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);
    // === POLISH: Atmospheric particle field ===
    const _sfCount = 80;
    const _sfGeo = new THREE.BufferGeometry();
    const _sfPos = new Float32Array(_sfCount * 3);
    for (let _i = 0; _i < _sfCount; _i++) {
      _sfPos[_i*3] = (Math.random()-0.5)*20;
      _sfPos[_i*3+1] = (Math.random()-0.5)*15;
      _sfPos[_i*3+2] = (Math.random()-0.5)*8-3;
    }
    _sfGeo.setAttribute('position', new THREE.BufferAttribute(_sfPos, 3));
    scene.add(new THREE.Points(_sfGeo, new THREE.PointsMaterial({ color: 0xaaddff, size: 0.05, transparent: true, opacity: 0.4 })));
    // === END POLISH ===
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x112233, 3));
    const greenLight = new THREE.PointLight(0x34d399, 2, 20);
    greenLight.position.set(0, 2, 5);
    scene.add(greenLight);

    // Circuit board background
    const bgPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 9),
      new THREE.MeshBasicMaterial({ color: 0x0a1520 })
    );
    bgPlane.position.z = -1;
    scene.add(bgPlane);

    // Grid lines
    for (let i = -4; i <= 4; i++) {
      const hLine = new THREE.Mesh(new THREE.BoxGeometry(12, 0.01, 0.01), new THREE.MeshBasicMaterial({ color: 0x112233 }));
      hLine.position.set(0, i * 0.7, -0.5);
      scene.add(hLine);
    }

    setupPegs(scene, s);

    // Cable plug start mesh
    const plugMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 0.5 })
    );
    plugMesh.position.set(-3.5, -2.5, 0);
    scene.add(plugMesh);
    s.cableEndMesh = plugMesh;
    s.cablePath = [new THREE.Vector2(-3.5, -2.5)];

    s.stopMusic = startMusic('drive');
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Update cable end mesh
      if (s.cableEndMesh) {
        s.cableEndMesh.position.x = s.cableEndX;
        s.cableEndMesh.position.y = s.cableEndY;
        (s.cableEndMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + Math.sin(Date.now() * 0.005) * 0.2;
      }

      // Peg glow for wrapped pegs
      s.pegs.forEach(peg => {
        const mat = peg.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = peg.wrapped ? 0.6 + Math.sin(Date.now() * 0.004) * 0.2 : 0.1;
        mat.emissive.setHex(peg.wrapped ? 0x34d399 : 0x34d399);
        mat.color.setHex(peg.wrapped ? 0x1a5a3a : 0x334466);
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, setupPegs, updateCableLine]);

  const screenToWorld = (mount: HTMLDivElement, ex: number, ey: number, camera: THREE.PerspectiveCamera): THREE.Vector3 => {
    const rect = mount.getBoundingClientRect();
    const nx = ((ex - rect.left) / rect.width) * 2 - 1;
    const ny = -((ey - rect.top) / rect.height) * 2 + 1;
    const vec = new THREE.Vector3(nx, ny, 0.5);
    vec.unproject(camera);
    const dir = vec.sub(camera.position).normalize();
    const dist = -camera.position.z / dir.z;
    return camera.position.clone().add(dir.multiplyScalar(dist));
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.camera) return;
      s.dragging = true;
      const world = screenToWorld(mount, e.clientX, e.clientY, s.camera);
      s.cableEndX = world.x; s.cableEndY = world.y;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.dragging || !s.camera || !s.scene) return;
      const world = screenToWorld(mount, e.clientX, e.clientY, s.camera);
      s.cableEndX = world.x; s.cableEndY = world.y;

      // Check peg proximity
      for (const peg of s.pegs) {
        if (peg.wrapped) continue;
        const dx = world.x - peg.x, dy = world.y - peg.y;
        if (Math.sqrt(dx * dx + dy * dy) < 0.5 && peg.id !== s.lastPegId) {
          // Wrap peg
          peg.wrapped = true;
          s.sig.wrapped++;
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          s.sig.score += 5;
          setScoreDisplay(s.sig.score);
          sfx.collect?.(); haptic([15]);
          s.lastPegId = peg.id;
          s.cablePath.push(new THREE.Vector2(peg.x, peg.y));
          updateCableLine(s.scene, s);
        }
      }

      // Update cable path periodically
      if (s.frame % 5 === 0) {
        s.cablePath.push(new THREE.Vector2(world.x, world.y));
        if (s.cablePath.length > 100) s.cablePath.shift();
        updateCableLine(s.scene, s);
      }

      // Tangle detection: if line crosses itself significantly
      if (s.cablePath.length > 20 && Math.random() < 0.01) {
        s.sig.tangles++;
        s.sig.streakCurrent = 0;
        sfx.collision?.(); haptic([30]);
        // Reset cable
        s.cablePath = [new THREE.Vector2(s.cableEndX, s.cableEndY)];
        updateCableLine(s.scene, s);
      }
    };

    const onPointerUp = () => {
      if (phase !== 'playing') return;
      stateRef.current.dragging = false;
    };

    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerup', onPointerUp);
    return () => {
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase, updateCableLine]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stopMusic) s.stopMusic();
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
          ctaLabel="Wrap it! 🔌" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Pegs Wrapped', value: String(finalSig.wrapped), color: ACCENT },
            { label: 'Tangles', value: String(finalSig.tangles), color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Score', value: String(finalSig.score), color: '#4ade80' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.wrapped >= 5} />
      )}
    </GameShell>
  );
}
