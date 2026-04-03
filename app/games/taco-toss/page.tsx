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

const GAME_ID = 'taco-toss';
const ACCENT = '#84cc16';
const DURATION = 45;
const GAME_EMOJI = '🌮';
const GAME_TITLE = 'Taco Toss';
const GAME_TAGLINE = 'Catch the fillings. Build the taco!';

type Ingredient = 'tortilla' | 'meat' | 'cheese' | 'lettuce' | 'salsa';
const LAYER_ORDER: Ingredient[] = ['tortilla', 'meat', 'cheese', 'lettuce', 'salsa'];
const INGREDIENT_COLORS: Record<Ingredient, number> = {
  tortilla: 0xd97706, meat: 0x92400e, cheese: 0xfbbf24, lettuce: 0x22c55e, salsa: 0xef4444,
};

interface FallingItem { mesh: THREE.Mesh; type: Ingredient; vy: number; caught: boolean; missed: boolean; flashT: number; }
interface Signals { completedTacos: number; wrongOrder: number; ingredientsCaught: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(s: Signals): string {
  if (s.completedTacos >= 5 && s.wrongOrder === 0) return 'Taco Perfectionist 🌟';
  if (s.completedTacos >= 4) return 'Taco Master 🌮';
  if (s.wrongOrder >= 6) return 'Freestyle Chef 🤪';
  if (s.completedTacos >= 2) return 'Taco Apprentice 🍴';
  return 'First Fold 🫓';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function TacoTossGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    sig: { completedTacos: 0, wrongOrder: 0, ingredientsCaught: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    shellX: 0, targetShellX: 0,
    items: [] as FallingItem[],
    currentLayerIdx: 0,
    spawnTimer: 40,
    nextId: 0, frame: 0,
    shellMesh: null as THREE.Group | null,
    scene: null as THREE.Scene | null,
    layerMeshes: [] as THREE.Mesh[],
    tacoFlash: 0,
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; life: number }[],
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { completedTacos: 0, wrongOrder: 0, ingredientsCaught: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.shellX = 0; s.targetShellX = 0; s.items = []; s.currentLayerIdx = 0;
    s.spawnTimer = 40; s.layerMeshes = []; s.tacoFlash = 0; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0a00);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 3, 12);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x221100, 2));
    const pLight = new THREE.PointLight(0xfbbf24, 4, 20);
    pLight.position.set(0, 8, 3);
    scene.add(pLight);
    const sLight = new THREE.PointLight(0x84cc16, 2, 15);
    sLight.position.set(-4, 3, 3);
    scene.add(sLight);

    // Festive background strips (bunting colors)
    const buntingColors = [0xef4444, 0xfbbf24, 0x22c55e, 0x84cc16, 0xf97316];
    for (let i = 0; i < 8; i++) {
      const stripGeo = new THREE.BoxGeometry(0.3, 8, 0.05);
      const stripMat = new THREE.MeshStandardMaterial({ color: buntingColors[i % 5], transparent: true, opacity: 0.3 });
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(-7 + i * 2, 0, -3);
      scene.add(strip);
    }

    // Floor
    const floorGeo = new THREE.PlaneGeometry(16, 10);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a1100, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3;
    scene.add(floor);

    // Shell group
    const shellGroup = new THREE.Group();
    scene.add(shellGroup);
    s.shellMesh = shellGroup;

    // Shell base (taco shell shape - half-sphere)
    const shellGeo = new THREE.SphereGeometry(0.9, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7, emissive: 0xd97706, emissiveIntensity: 0.1 });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.rotation.x = Math.PI;
    shellGroup.add(shell);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const spawnItem = () => {
      let type: Ingredient;
      if (Math.random() < 0.7 && s.currentLayerIdx < LAYER_ORDER.length) {
        type = LAYER_ORDER[s.currentLayerIdx];
      } else {
        type = LAYER_ORDER[Math.floor(Math.random() * LAYER_ORDER.length)];
      }
      const color = INGREDIENT_COLORS[type];
      const geo = new THREE.SphereGeometry(0.35, 12, 12);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.3 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((Math.random() - 0.5) * 6, 7, (Math.random() - 0.5) * 1);
      scene.add(mesh);
      s.items.push({ mesh, type, vy: -(2 + Math.random() * 1.5), caught: false, missed: false, flashT: 0 });
    };

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Smooth shell movement
      s.shellX += (s.targetShellX - s.shellX) * 0.2;
      if (shellGroup) shellGroup.position.set(s.shellX, -2, 0);

      // Spawn
      s.spawnTimer--;
      if (s.spawnTimer <= 0) { s.spawnTimer = 50 + Math.random() * 30; spawnItem(); }

      const catchY = -1.2;
      // Update items
      for (let i = s.items.length - 1; i >= 0; i--) {
        const it = s.items[i];
        if (it.caught || it.missed) {
          it.flashT++;
          if (it.flashT > 20) {
            scene.remove(it.mesh);
            s.items.splice(i, 1);
          }
          continue;
        }
        it.vy -= 0.1;
        it.mesh.position.y += it.vy * 0.05;
        it.mesh.rotation.x += 0.05;

        if (it.mesh.position.y <= catchY && Math.abs(it.mesh.position.x - s.shellX) < 1.1) {
          const needed = LAYER_ORDER[s.currentLayerIdx];
          if (it.type === needed) {
            it.caught = true;
            s.sig.ingredientsCaught++; s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            sfx.collect(); hapticScore();
            // Add layer mesh
            const layerGeo = new THREE.CylinderGeometry(0.7 - s.currentLayerIdx * 0.05, 0.8 - s.currentLayerIdx * 0.05, 0.15, 12);
            const layerMat = new THREE.MeshStandardMaterial({ color: INGREDIENT_COLORS[it.type], emissive: INGREDIENT_COLORS[it.type], emissiveIntensity: 0.4 });
            const layerMesh = new THREE.Mesh(layerGeo, layerMat);
            layerMesh.position.set(0, 0.3 + s.currentLayerIdx * 0.18, 0);
            shellGroup.add(layerMesh);
            s.layerMeshes.push(layerMesh);
            s.currentLayerIdx++;

            if (s.currentLayerIdx >= LAYER_ORDER.length) {
              s.sig.completedTacos++; s.sig.score += 5;
              s.tacoFlash = 40; sfx.success(); hapticCombo(5);
              s.currentLayerIdx = 0;
              // Remove layer meshes
              s.layerMeshes.forEach(m => shellGroup.remove(m));
              s.layerMeshes = [];
              setScoreDisplay(s.sig.score);
              // Celebration particles
              for (let p = 0; p < 12; p++) {
                const pg = new THREE.SphereGeometry(0.1, 6, 6);
                const pm = new THREE.MeshStandardMaterial({ color: buntingColors[p % 5], emissive: buntingColors[p % 5], emissiveIntensity: 0.8 });
                const pm2 = new THREE.Mesh(pg, pm);
                pm2.position.set(s.shellX, -1.5, 0);
                scene.add(pm2);
                s.particles.push({ mesh: pm2, vx: (Math.random() - 0.5) * 0.15, vy: 0.08 + Math.random() * 0.1, life: 1 });
              }
            } else {
              s.sig.score++; setScoreDisplay(s.sig.score);
            }
          } else {
            it.caught = true; // wrong order, mark as caught to remove
            (it.mesh.material as THREE.MeshStandardMaterial).color.setHex(0xef4444);
            s.sig.wrongOrder++; s.sig.streakCurrent = 0;
            sfx.nearMiss(); hapticFail();
          }
        }

        if (it.mesh.position.y < -5) { it.missed = true; }
      }

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.vy -= 0.005;
        p.life -= 0.04;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life;
        (p.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      // Taco flash
      if (s.tacoFlash > 0) {
        s.tacoFlash--;
        pLight.intensity = 4 + Math.sin(s.frame * 0.5) * 3;
      } else {
        pLight.intensity = 4;
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    const onPM = (e: PointerEvent) => {
      const norm = (e.clientX / W - 0.5) * 10;
      s.targetShellX = Math.max(-4, Math.min(4, norm));
    };
    renderer.domElement.addEventListener('pointermove', onPM);
    renderer.domElement.addEventListener('pointerdown', onPM);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Build the Taco! 🌮" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
        score={String(finalSig.score)} personality={getPersonality(finalSig)}
        insights={[{ label: 'Tacos Built', value: `${finalSig.completedTacos}`, color: '#4ade80' }, { label: 'Wrong Order', value: `${finalSig.wrongOrder}`, color: finalSig.wrongOrder === 0 ? '#4ade80' : '#ef4444' }, { label: 'Ingredients', value: `${finalSig.ingredientsCaught}`, color: ACCENT }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' }]}
        accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.completedTacos >= 3} />}
    </GameShell>
  );
}
