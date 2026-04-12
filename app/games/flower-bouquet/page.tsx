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

const GAME_ID = 'flower-bouquet';
const ACCENT = '#ec4899';
const DURATION = 45;
const GAME_EMOJI = '💐';
const GAME_TITLE = 'Flower Bouquet';
const GAME_TAGLINE = 'Tap falling flowers to add them to your bouquet!';

const FLOWER_COLORS = [0xec4899, 0xf97316, 0xfbbf24, 0xa855f7, 0x22d3ee, 0xef4444, 0x4ade80];
const BAD_COLORS = [0x6b7280, 0x374151]; // weeds

interface Signals { flowersCollected: number; weedsGrabbed: number; maxStreak: number; streakCurrent: number; score: number; bouquetSize: number; }
function getPersonality(sig: Signals): string {
  if (sig.flowersCollected >= 20 && sig.weedsGrabbed === 0) return 'Master Florist 🌸';
  if (sig.maxStreak >= 8) return 'Streak Bloomer 🌺';
  if (sig.flowersCollected >= 15) return 'Garden Expert 🌻';
  if (sig.weedsGrabbed >= 5) return 'Weed Whisperer 🌿';
  return 'Learning to Bloom 🌱';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Flower3D {
  mesh: THREE.Group; stem: THREE.Mesh; petals: THREE.Mesh[];
  x: number; y: number; vx: number; vy: number; rotation: number;
  isWeed: boolean; color: number; id: number;
  caught: boolean;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  bouquetFlowers: number; nextId: number; frame: number;
}

function createFlowerMesh(color: number, isWeed: boolean): THREE.Group {
  const group = new THREE.Group();
  // Stem
  const stemGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.6, 6);
  const stemMat = new THREE.MeshStandardMaterial({ color: isWeed ? 0x4a5568 : 0x16a34a, roughness: 0.7 });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = -0.25;
  group.add(stem);

  if (!isWeed) {
    // Center
    const centerGeo = new THREE.SphereGeometry(0.18, 10, 10);
    const center = new THREE.Mesh(centerGeo, new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.4 }));
    group.add(center);
    // Petals
    for (let i = 0; i < 6; i++) {
      const pGeo = new THREE.SphereGeometry(0.12, 8, 6);
      const pMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.5 });
      const petal = new THREE.Mesh(pGeo, pMat);
      const angle = (i / 6) * Math.PI * 2;
      petal.position.set(Math.cos(angle) * 0.25, Math.sin(angle) * 0.25, 0);
      petal.scale.set(1.3, 0.9, 0.6);
      group.add(petal);
    }
  } else {
    // Weed (spiky)
    for (let i = 0; i < 4; i++) {
      const leafGeo = new THREE.ConeGeometry(0.08, 0.3, 5);
      const leaf = new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.8 }));
      const angle = (i / 4) * Math.PI * 2;
      leaf.position.set(Math.cos(angle) * 0.18, Math.sin(angle) * 0.18, 0);
      leaf.rotation.z = angle + Math.PI / 2;
      group.add(leaf);
    }
  }
  return group;
}

function FlowerBouquetGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { flowersCollected: 0, weedsGrabbed: 0, maxStreak: 0, streakCurrent: 0, score: 0, bouquetSize: 0 },
    bouquetFlowers: 0, nextId: 0, frame: 0,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    flowers: Flower3D[]; vaseGroup: THREE.Group;
    bouquetFlowers: THREE.Group[];
    animId: number; spawnTimer: number;
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
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const spawnFlower = useCallback((scene: THREE.Scene): Flower3D => {
    const s = stateRef.current;
    const isWeed = Math.random() < 0.22;
    const color = isWeed ? BAD_COLORS[Math.floor(Math.random() * BAD_COLORS.length)] : FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)];
    const mesh = createFlowerMesh(color, isWeed);
    const x = (Math.random() - 0.5) * 7;
    mesh.position.set(x, 6, 0);
    scene.add(mesh);
    const speed = 0.025 + Math.random() * 0.02;
    return {
      mesh, stem: mesh.children[0] as THREE.Mesh, petals: [],
      x, y: 6, vx: (Math.random() - 0.5) * 0.015, vy: -speed,
      rotation: (Math.random() - 0.5) * 0.04, isWeed, color, id: s.nextId++, caught: false,
    };
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { flowersCollected: 0, weedsGrabbed: 0, maxStreak: 0, streakCurrent: 0, score: 0, bouquetSize: 0 };
    s.bouquetFlowers = 0; s.nextId = 0; s.frame = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d0a1e);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0a1e);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 12);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const pinkLight = new THREE.PointLight(0xec4899, 2, 20);
    pinkLight.position.set(0, 5, 5);
    scene.add(pinkLight);
    const purpleLight = new THREE.PointLight(0xa855f7, 1.5, 15);
    purpleLight.position.set(-4, -3, 3);
    scene.add(purpleLight);

    // Vase at bottom center
    const vaseGroup = new THREE.Group();
    const vaseGeo = new THREE.CylinderGeometry(0.6, 0.8, 1.4, 12);
    const vaseMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, emissive: 0x1e40af, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.3 });
    const vase = new THREE.Mesh(vaseGeo, vaseMat);
    vaseGroup.add(vase);
    const rimGeo = new THREE.TorusGeometry(0.62, 0.07, 8, 24);
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: 0x60a5fa, metalness: 0.7 }));
    rim.position.y = 0.72;
    vaseGroup.add(rim);
    vaseGroup.position.set(0, -4.8, 0);
    scene.add(vaseGroup);

    // Stars
    const starPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) { starPos[i*3] = (Math.random()-0.5)*30; starPos[i*3+1] = (Math.random()-0.5)*20; starPos[i*3+2] = -5 - Math.random()*15; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffc0d0, size: 0.06, transparent: true, opacity: 0.5 })));

    const flowers: Flower3D[] = [];
    const bouquetFlowers: THREE.Group[] = [];
    // Initial spawn
    for (let i = 0; i < 3; i++) flowers.push(spawnFlower(scene));

    const obj = { renderer, scene, camera, flowers, vaseGroup, bouquetFlowers, animId: 0, spawnTimer: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.success?.(); endGame(); }
    }, 1000);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      s.frame++;
      const t0 = s.frame;

      // Spawn
      obj.spawnTimer++;
      if (obj.spawnTimer > Math.max(40, 80 - s.sig.flowersCollected * 2)) {
        obj.spawnTimer = 0;
        flowers.push(spawnFlower(scene));
      }

      // Update flowers
      for (let i = flowers.length - 1; i >= 0; i--) {
        const f = flowers[i];
        if (f.caught) continue;
        f.y += f.vy;
        f.x += f.vx;
        f.mesh.position.set(f.x, f.y, 0);
        f.mesh.rotation.z += f.rotation;
        // Remove if below screen
        if (f.y < -7) { scene.remove(f.mesh); flowers.splice(i, 1); }
      }

      // Vase wobble
      vaseGroup.rotation.z = Math.sin(t0 * 0.05) * 0.025;

      // Pink light pulse
      pinkLight.intensity = 1.5 + Math.sin(t0 * 0.06) * 0.5;

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, spawnFlower]);

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
      const flowerMeshes = t.flowers.filter(f => !f.caught).map(f => f.mesh);
      const hits = raycaster.intersectObjects(flowerMeshes, true);
      if (hits.length > 0) {
        let hitGroup = hits[0].object;
        while (hitGroup.parent && !(hitGroup.parent instanceof THREE.Scene)) hitGroup = hitGroup.parent;
        const flowerIdx = t.flowers.findIndex(f => f.mesh === hitGroup);
        if (flowerIdx < 0) return;
        const flower = t.flowers[flowerIdx];
        flower.caught = true;

        if (!flower.isWeed) {
          s.sig.flowersCollected++;
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          const pts = 1 + Math.floor(s.sig.streakCurrent / 3);
          s.sig.score += pts;
          s.sig.bouquetSize++;
          setScoreDisplay(s.sig.score);
          sfx.collect?.(); hapticScore();
          // Animate flower to vase
          flower.mesh.position.set(0, -4, 0);
          flower.mesh.scale.setScalar(0.5);
          flower.mesh.rotation.set(0, 0, Math.random() * Math.PI * 2);
          t.bouquetFlowers.push(flower.mesh);
        } else {
          s.sig.weedsGrabbed++;
          s.sig.streakCurrent = 0;
          sfx.fail?.(); hapticFail();
          t.scene.remove(flower.mesh);
        }
        t.flowers.splice(flowerIdx, 1);
      }
    };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase]);

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
    { label: 'Flowers', value: String(sig.flowersCollected), color: ACCENT },
    { label: 'Weeds', value: String(sig.weedsGrabbed), color: sig.weedsGrabbed === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Best Streak', value: `×${sig.maxStreak}`, color: '#fbbf24' },
    { label: 'Bouquet Size', value: String(sig.bouquetSize), color: '#a855f7' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Blooming 💐" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'BOUQUET', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.flowersCollected >= 10} />
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score, flowersCollected: sig.flowersCollected, weedsGrabbed: sig.weedsGrabbed, maxStreak: sig.maxStreak }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const FlowerBouquetGame = dynamic(() => Promise.resolve({ default: FlowerBouquetGameInner }), { ssr: false });
export default FlowerBouquetGame;
