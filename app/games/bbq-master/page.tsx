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

const GAME_ID = 'bbq-master';
const ACCENT = '#f97316';
const DURATION = 45;
const GAME_EMOJI = '🍖';
const GAME_TITLE = 'BBQ Master';
const GAME_TAGLINE = "Tap food at the PERFECT moment to flip it!";
const PB_KEY = 'mg_pb_bbq-master';

const COOK_TOTAL = 5.5;
const PERFECT_LO = 0.42;
const PERFECT_HI = 0.58;
const GOOD_LO = 0.32;
const GOOD_HI = 0.68;
const BURN_START = 0.75;

type FoodType = 'burger' | 'sausage' | 'corn' | 'skewer';
const FOOD_TYPES: FoodType[] = ['burger', 'sausage', 'corn', 'skewer'];

interface FoodItem3D {
  id: number; type: FoodType;
  mesh: THREE.Group; progress: number; side: number;
  burnt: boolean; flipFlash: number;
  col: number; row: number;
}
interface Signals { score: number; perfectFlips: number; goodFlips: number; lateFlips: number; burntItems: number; }
function getPersonality(sig: Signals): string {
  if (sig.perfectFlips >= 8 && sig.burntItems === 0) return 'Pit Master 🏆';
  if (sig.perfectFlips >= 5) return 'Grill Ace 🔥';
  if (sig.burntItems >= 4) return 'Char Specialist 🖤';
  if (sig.goodFlips >= 8) return 'BBQ Pro 🍖';
  return 'Backyard Cook 🥩';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  foods: FoodItem3D[]; nextId: number;
  grillGlow: THREE.PointLight | null;
  smokeParticles: Array<{ mesh: THREE.Mesh; vy: number; life: number }>;
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function makeFoodMesh(type: FoodType): THREE.Group {
  const g = new THREE.Group();
  if (type === 'burger') {
    const patty = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.15, 16),
      new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 })
    );
    g.add(patty);
  } else if (type === 'sausage') {
    const saus = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.9, 12),
      new THREE.MeshStandardMaterial({ color: 0xcc4400, roughness: 0.6 })
    );
    saus.rotation.z = Math.PI / 2;
    g.add(saus);
  } else if (type === 'corn') {
    const cob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.85, 8),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.5 })
    );
    cob.rotation.z = Math.PI / 2;
    g.add(cob);
  } else {
    // skewer
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x8b6914 })
    );
    stick.rotation.z = Math.PI / 2;
    g.add(stick);
    [0.4, 0.1, -0.2, -0.45].forEach(ox => {
      const chunk = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xcc4400, roughness: 0.7 })
      );
      chunk.position.x = ox;
      g.add(chunk);
    });
  }
  return g;
}

function BBQMasterGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, perfectFlips: 0, goodFlips: 0, lateFlips: 0, burntItems: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    foods: [], nextId: 0, grillGlow: null, smokeParticles: [],
    stopMusic: null, intervalId: null, resizeCleanup: null,
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

  const spawnFood = useCallback((scene: THREE.Scene, s: GS, col: number, row: number) => {
    const type = FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)];
    const mesh = makeFoodMesh(type);
    const px = (col - 0.5) * 2.5;
    const pz = (row - 0.5) * 2.0;
    mesh.position.set(px, 0.3, pz);
    scene.add(mesh);
    s.foods.push({ id: s.nextId++, type, mesh, progress: 0, side: 0, burnt: false, flipFlash: 0, col, row });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, perfectFlips: 0, goodFlips: 0, lateFlips: 0, burntItems: 0 };
    s.foods = []; s.nextId = 0; s.smokeParticles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d0503);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    // === POLISH: Scene fog for atmospheric depth ===
    scene.fog = new THREE.Fog(scene.background instanceof THREE.Color ? (scene.background as THREE.Color).getHex() : 0x0a0a1a, 15, 35);
    // === END POLISH ===
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 5, 7);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x221100, 3));
    const sunLight = new THREE.DirectionalLight(0xffaa44, 2);
    sunLight.position.set(3, 8, 5);
    scene.add(sunLight);
    const grillGlow = new THREE.PointLight(0xff6600, 2, 20);
    grillGlow.position.set(0, 0.2, 0);
    scene.add(grillGlow);
    s.grillGlow = grillGlow;

    // Grill surface
    const grillBase = new THREE.Mesh(
      new THREE.BoxGeometry(5.5, 0.2, 4.5),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.3 })
    );
    grillBase.position.y = -0.1;
    scene.add(grillBase);

    // Grill bars
    for (let i = -2; i <= 2; i++) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.12, 4.5),
        new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9 })
      );
      bar.position.set(i * 0.9, 0.16, 0);
      scene.add(bar);
    }

    // Coals/fire effect below
    const coals = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.1, 4),
      new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 0.8 })
    );
    coals.position.y = -0.5;
    scene.add(coals);

    s.stopMusic = startMusic('ambient');
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    // Spawn initial food on 2x2 grid
    for (let c = 0; c < 2; c++) for (let r = 0; r < 2; r++) spawnFood(scene, s, c, r);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const dt = 1 / 60;

      // Update food items
      for (const food of s.foods) {
        if (food.burnt) {
          const firstChild = food.mesh.children[0];
          const mat = (firstChild instanceof THREE.Mesh ? firstChild.material : null) as THREE.MeshStandardMaterial | null;
          if (!mat) continue;
          mat.color.setHex(0x111111);
          mat.emissive.setHex(0x220000);
          mat.emissiveIntensity = 0.2;
          continue;
        }
        food.progress += dt / COOK_TOTAL;
        if (food.flipFlash > 0) food.flipFlash--;

        // Color feedback based on cook progress
        const frac = food.progress % 1;
        const heatColor = frac > BURN_START ? 0xff2200 : frac > GOOD_HI ? 0xff6600 : 0xd4611a;
        food.mesh.children.forEach((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(food.flipFlash > 0 ? 0x00ff88 : heatColor);
            mat.emissiveIntensity = food.flipFlash > 0 ? 0.5 : 0.15;
          }
        });

        // Burning detection
        if (food.side < 2 && food.progress > food.side + BURN_START) {
          if (food.side === 1) {
            // Both sides burnt = lost
            food.burnt = true;
            s.sig.burntItems++;
            sfx.collision?.(); haptic?.([50]);
          }
        }

        // Gentle bounce on grill
        food.mesh.position.y = 0.3 + Math.sin(Date.now() * 0.003 + food.id) * 0.02;
      }

      // Grill glow pulse
      if (s.grillGlow) {
        s.grillGlow.intensity = 1.5 + Math.sin(Date.now() * 0.004) * 0.5;
      }

      // Smoke particles
      if (Math.random() < 0.1) {
        const sm = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.4 })
        );
        sm.position.set((Math.random() - 0.5) * 4, 0.5, (Math.random() - 0.5) * 3);
        scene.add(sm);
        s.smokeParticles.push({ mesh: sm, vy: 0.02 + Math.random() * 0.02, life: 40 });
      }
      for (let i = s.smokeParticles.length - 1; i >= 0; i--) {
        const sp = s.smokeParticles[i];
        sp.mesh.position.y += sp.vy;
        sp.mesh.position.x += (Math.random() - 0.5) * 0.01;
        sp.life--;
        const mat = sp.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = (sp.life / 40) * 0.4;
        if (sp.life <= 0) { scene.remove(sp.mesh); s.smokeParticles.splice(i, 1); }
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnFood]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.camera || !s.renderer) return;
      const rect = mount.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), s.camera);
      for (const food of s.foods) {
        if (food.burnt) continue;
        const hits = raycaster.intersectObject(food.mesh, true);
        if (hits.length > 0) {
          const frac = food.progress % 1;
          const isPerfect = frac >= PERFECT_LO && frac <= PERFECT_HI;
          const isGood = frac >= GOOD_LO && frac <= GOOD_HI;
          const isLate = frac > GOOD_HI && frac < BURN_START;
          let pts = 0;
          if (isPerfect) { pts = 10; s.sig.perfectFlips++; sfx.success(); }
          else if (isGood) { pts = 5; s.sig.goodFlips++; sfx.collect(); }
          else if (isLate) { pts = 2; s.sig.lateFlips++; sfx.click(); }
          else { pts = 0; sfx.collision(); haptic([30]); }
          if (pts > 0) {
            s.sig.score += pts; setScoreDisplay(s.sig.score);
            food.side++; food.progress = food.side;
            food.flipFlash = 12;
            food.mesh.rotation.z = food.side * Math.PI;
            if (food.side >= 2) {
              setTimeout(() => {
                if (!stateRef.current.running || !stateRef.current.scene) return;
                stateRef.current.scene.remove(food.mesh);
                stateRef.current.foods = stateRef.current.foods.filter(f => f.id !== food.id);
                spawnFood(stateRef.current.scene, stateRef.current, food.col, food.row);
              }, 500);
            }
          }
          break;
        }
      }
    };
    mount.addEventListener('pointerdown', onPointerDown);
    return () => mount.removeEventListener('pointerdown', onPointerDown);
  }, [phase, spawnFood]);

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
          ctaLabel="Fire up the grill! 🔥" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Perfect Flips', value: String(finalSig.perfectFlips), color: '#fbbf24' },
            { label: 'Good Flips', value: String(finalSig.goodFlips), color: ACCENT },
            { label: 'Burnt Items', value: String(finalSig.burntItems), color: '#ef4444' },
            { label: 'Total Score', value: String(finalSig.score), color: '#4ade80' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.perfectFlips >= 4} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const BBQMasterGame = dynamic(() => Promise.resolve({ default: BBQMasterGameInner }), { ssr: false });
export default BBQMasterGame;
