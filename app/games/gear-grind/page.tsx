'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'gear-grind';
const ACCENT = '#f59e0b';
const DURATION = 45;
const GAME_EMOJI = '⚙️';
const GAME_TITLE = 'Gear Grind';
const GAME_TAGLINE = 'Tap gears in the right order to complete the chain!';

interface Signals { gearsPlaced: number; chainsBroken: number; perfectChains: number; maxStreak: number; score: number; }
function getPersonality(sig: Signals): string {
  if (sig.perfectChains >= 5 && sig.chainsBroken === 0) return 'Master Engineer ⚙️';
  if (sig.perfectChains >= 3) return 'Gear Wizard 🔧';
  if (sig.gearsPlaced >= 15) return 'Grind Master 💪';
  if (sig.chainsBroken >= 5) return 'Chain Breaker 🔗';
  return 'Cog Apprentice 🪛';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Gear3D {
  mesh: THREE.Mesh; teeth: THREE.Mesh[]; light: THREE.PointLight;
  x: number; y: number; r: number; speed: number; color: number;
  id: number; slotId: number; placed: boolean; order: number;
}

interface Slot3D {
  mesh: THREE.Mesh; ring: THREE.Mesh;
  x: number; y: number; order: number; filled: boolean; id: number;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  activeGears: Gear3D[]; slots: Slot3D[];
  chainComplete: boolean; nextOrder: number; frame: number;
  roundNum: number; nextId: number;
}

function createGearMesh(r: number, color: number, teeth: number): THREE.Group {
  const group = new THREE.Group();
  // Main disk
  const diskGeo = new THREE.CylinderGeometry(r, r, 0.22, 32);
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, metalness: 0.5, roughness: 0.35 });
  const disk = new THREE.Mesh(diskGeo, mat);
  disk.rotation.x = Math.PI / 2;
  group.add(disk);
  // Center hole
  const holeGeo = new THREE.CylinderGeometry(r * 0.25, r * 0.25, 0.3, 12);
  const hole = new THREE.Mesh(holeGeo, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
  hole.rotation.x = Math.PI / 2;
  group.add(hole);
  // Teeth
  for (let i = 0; i < teeth; i++) {
    const angle = (i / teeth) * Math.PI * 2;
    const toothGeo = new THREE.BoxGeometry(r * 0.22, 0.22, r * 0.3);
    const tooth = new THREE.Mesh(toothGeo, mat.clone());
    tooth.position.set(Math.cos(angle) * (r + r * 0.15), Math.sin(angle) * (r + r * 0.15), 0);
    tooth.rotation.z = angle;
    group.add(tooth);
  }
  return group;
}

export default function GearGrindGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { gearsPlaced: 0, chainsBroken: 0, perfectChains: 0, maxStreak: 0, score: 0 },
    activeGears: [], slots: [], chainComplete: false, nextOrder: 0, frame: 0, roundNum: 1, nextId: 0,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    gearGroups: THREE.Group[]; slotMeshes: Slot3D[];
    chainLight: THREE.PointLight; animId: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const GEAR_COLORS = [0xf59e0b, 0x06b6d4, 0xa855f7, 0x22c55e, 0xef4444, 0xfbbf24];
  const SLOT_POSITIONS = [[-3.5, 0], [-1.2, 0.8], [1.2, -0.2], [3.5, 0.6]] as const;

  const setupRound = useCallback((scene: THREE.Scene, s: GS) => {
    // Clear old
    s.slots = []; s.activeGears = []; s.chainComplete = false; s.nextOrder = 0;

    // Create slots (target positions)
    const slotMeshes: Slot3D[] = [];
    for (let i = 0; i < 4; i++) {
      const [sx, sy] = SLOT_POSITIONS[i];
      const slotGeo = new THREE.TorusGeometry(0.8, 0.08, 8, 24);
      const slotMat = new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0x334155, emissiveIntensity: 0.2, roughness: 0.7, transparent: true, opacity: 0.7 });
      const slotMesh = new THREE.Mesh(slotGeo, slotMat);
      slotMesh.position.set(sx, sy, -0.3);
      scene.add(slotMesh);

      const ringGeo = new THREE.TorusGeometry(0.85, 0.04, 6, 24);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.3 }));
      ring.position.set(sx, sy, -0.2);
      scene.add(ring);

      const sd: Slot3D = { mesh: slotMesh, ring, x: sx, y: sy, order: i, filled: false, id: s.nextId++ };
      s.slots.push(sd);
      slotMeshes.push(sd);
    }

    // Create floating gears (in random positions, to be tapped in order)
    const shuffledOrder = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    for (let i = 0; i < 4; i++) {
      const color = GEAR_COLORS[i % GEAR_COLORS.length];
      const r = 0.55 + Math.random() * 0.25;
      const gearGroup = createGearMesh(r, color, 8);
      const gx = (Math.random() - 0.5) * 6;
      const gy = 3 + Math.random() * 2;
      gearGroup.position.set(gx, gy, 0);
      scene.add(gearGroup);

      const gLight = new THREE.PointLight(color, 1.5, 4);
      gLight.position.set(gx, gy, 1);
      scene.add(gLight);

      const gear: Gear3D = {
        mesh: gearGroup.children[0] as THREE.Mesh, teeth: [],
        x: gx, y: gy, r, speed: 0.02, color,
        id: s.nextId++, slotId: shuffledOrder[i], placed: false,
        order: shuffledOrder[i],
      };
      s.activeGears.push(gear);
    }

    return slotMeshes;
  }, [GEAR_COLORS, SLOT_POSITIONS]);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { gearsPlaced: 0, chainsBroken: 0, perfectChains: 0, maxStreak: 0, score: 0 };
    s.frame = 0; s.roundNum = 1; s.nextId = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a0a);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 9);

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const amber = new THREE.AmbientLight(0xf59e0b, 0.2);
    scene.add(amber);
    const chainLight = new THREE.PointLight(0xf59e0b, 0, 12);
    scene.add(chainLight);

    // Background grid
    const gridHelper = new THREE.GridHelper(20, 20, 0x1a1a1a, 0x141414);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -1;
    scene.add(gridHelper);

    // Stars
    const starPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) { starPos[i*3] = (Math.random()-0.5)*20; starPos[i*3+1] = (Math.random()-0.5)*15; starPos[i*3+2] = -3 - Math.random()*10; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xf59e0b, size: 0.06, transparent: true, opacity: 0.3 })));

    const slotMeshes = setupRound(scene, s);
    const obj = { renderer, scene, camera, gearGroups: [], slotMeshes, chainLight, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      s.frame++;
      const t0 = s.frame;

      // Animate gears spinning
      for (const gear of s.activeGears) {
        if (!gear.placed) {
          // Float animation
          gear.y = gear.y - 0.005 + Math.sin(t0 * 0.03 + gear.id) * 0.01;
          const gMesh = scene.getObjectByProperty('uuid', gear.mesh.parent?.uuid ?? '') ?? scene.children.find(c => c instanceof THREE.Group && (c as THREE.Group).position.x === gear.x);
          if (gear.mesh.parent) {
            gear.mesh.parent.position.y = gear.y;
            gear.mesh.parent.rotation.z = t0 * 0.03 * (gear.order % 2 === 0 ? 1 : -1);
          }
        } else {
          // Placed: spin in slot
          if (gear.mesh.parent) gear.mesh.parent.rotation.z += gear.speed * (gear.order % 2 === 0 ? 1 : -1);
        }
      }

      // Slot ring pulse
      for (const slot of s.slots) {
        slot.ring.rotation.z += 0.01;
        (slot.ring.material as THREE.MeshBasicMaterial).opacity = slot.filled ? 0.8 : 0.2 + Math.sin(t0 * 0.07 + slot.id) * 0.1;
        if (slot.filled) {
          (slot.mesh.material as THREE.MeshStandardMaterial).emissive.set(ACCENT);
          (slot.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
        }
      }

      // Chain complete flash
      if (s.chainComplete) {
        chainLight.intensity = 3 + Math.sin(t0 * 0.2) * 2;
      } else {
        chainLight.intensity = 0;
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, setupRound]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTap = (e: PointerEvent) => {
      const t = threeRef.current; if (!t) return;
      const s = stateRef.current; if (!s.running) return;
      const rect = mount.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), t.camera);

      // Find unplaced gear meshes
      const unplacedParents = s.activeGears.filter(g => !g.placed).map(g => g.mesh.parent!).filter(Boolean);
      const hits = raycaster.intersectObjects(unplacedParents, true);
      if (hits.length === 0) return;
      let hitGroup = hits[0].object;
      while (hitGroup.parent && !(hitGroup.parent instanceof THREE.Scene)) hitGroup = hitGroup.parent;

      const gear = s.activeGears.find(g => g.mesh.parent === hitGroup);
      if (!gear || gear.placed) return;

      // Check if it's the next in order
      if (gear.order === s.nextOrder) {
        gear.placed = true;
        s.nextOrder++;
        s.sig.gearsPlaced++;
        const slot = s.slots[gear.slotId];
        slot.filled = true;
        // Snap to slot
        if (hitGroup) hitGroup.position.set(slot.x, slot.y, 0);
        sfx.collect?.(); hapticScore();
        s.sig.score++;
        setScoreDisplay(s.sig.score);

        // Check chain complete
        if (s.nextOrder === 4) {
          s.chainComplete = true;
          s.sig.perfectChains++;
          s.sig.score += 5;
          setScoreDisplay(s.sig.score);
          sfx.success?.(); hapticVictory();
          setTimeout(() => {
            if (!s.running) return;
            // Reset for next round
            const { scene } = t;
            s.activeGears.forEach(g => { if (g.mesh.parent) scene.remove(g.mesh.parent); });
            s.slots.forEach(sl => { scene.remove(sl.mesh); scene.remove(sl.ring); });
            s.roundNum++;
            s.chainComplete = false;
            s.nextOrder = 0;
            setupRound(scene, s);
          }, 1500);
        }
      } else {
        // Wrong order — break chain
        s.sig.chainsBroken++;
        sfx.fail?.(); hapticFail();
        // Flash red
        const mat = (hitGroup as THREE.Group)?.children[0] ? ((hitGroup as THREE.Group).children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial : null;
        if (mat) { mat.emissive.set(0xef4444); mat.emissiveIntensity = 1.5; setTimeout(() => { mat.emissive.set(gear.color); mat.emissiveIntensity = 0.25; }, 400); }
      }
    };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase, setupRound]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);
  const buildInsights = (sig: Signals) => [
    { label: 'Gears Placed', value: String(sig.gearsPlaced), color: ACCENT },
    { label: 'Perfect Chains', value: String(sig.perfectChains), color: '#4ade80' },
    { label: 'Chains Broken', value: String(sig.chainsBroken), color: sig.chainsBroken === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start the Machine ⚙️" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.perfectChains >= 3} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, gearsPlaced: sig.gearsPlaced, perfectChains: sig.perfectChains, chainsBroken: sig.chainsBroken }, player);
  }, [theme, sig, personality, player]);
  return null;
}
