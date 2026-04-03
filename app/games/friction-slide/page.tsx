'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'friction-slide';
const ACCENT = '#0ea5e9';
const DURATION = 45;
const GAME_EMOJI = '🛷';
const GAME_TITLE = 'Friction Slide';
const GAME_TAGLINE = 'Flick the puck. Land on target.';

interface Signals { totalFlicks: number; bullseyes: number; goodLandings: number; misses: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalFlicks > 0 ? (sig.bullseyes + sig.goodLandings) / sig.totalFlicks : 0;
  if (sig.bullseyes >= 5 && acc >= 0.8) return 'Curling Champion 🥌';
  if (sig.maxStreak >= 5) return 'Smooth Operator 🌊';
  if (acc >= 0.7) return 'Precision Slider 🎯';
  return 'Finding Friction 🤔';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

const ZONE_DEFS = [
  { x: 0, pts: 5, color: 0xfbbf24, r: 0.5, label: 'BULL' },
  { x: 0, pts: 3, color: 0x22c55e, r: 1.0, label: 'GOOD' },
  { x: 0, pts: 1, color: 0x3b82f6, r: 1.7, label: 'OK' },
];

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  puckX: number; puckZ: number; puckVX: number; puckVZ: number; puckMoving: boolean;
  swipeStartX: number; swipeStartZ: number; swiping: boolean;
  targetZ: number;
}

export default function FrictionSlide() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { totalFlicks: 0, bullseyes: 0, goodLandings: 0, misses: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    puckX: 0, puckZ: 4, puckVX: 0, puckVZ: 0, puckMoving: false,
    swipeStartX: 0, swipeStartZ: 0, swiping: false, targetZ: -4,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    puck: THREE.Mesh; puckLight: THREE.PointLight;
    zones: Array<{ mesh: THREE.Mesh; pts: number; r: number }>;
    trail: Array<{ mesh: THREE.Mesh; life: number }>;
    animId: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const resetPuck = useCallback(() => {
    const s = stateRef.current;
    s.puckX = (Math.random() - 0.5) * 2;
    s.puckZ = 4;
    s.puckVX = 0; s.puckVZ = 0; s.puckMoving = false;
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalFlicks: 0, bullseyes: 0, goodLandings: 0, misses: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    resetPuck();
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x040d1a);
    renderer.shadowMap.enabled = true;
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040d1a);
    scene.fog = new THREE.Fog(0x040d1a, 15, 25);
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 6, 9);
    camera.lookAt(0, 0, -1);

    scene.add(new THREE.AmbientLight(0x88ccff, 0.6));
    const iceLight = new THREE.DirectionalLight(0xffffff, 0.8);
    iceLight.position.set(5, 10, 5);
    scene.add(iceLight);
    const puckLight = new THREE.PointLight(ACCENT, 2, 6);
    scene.add(puckLight);

    // Ice surface
    const iceGeo = new THREE.PlaneGeometry(10, 16);
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xd0eeff, roughness: 0.08, metalness: 0.6, envMapIntensity: 0.8 });
    const ice = new THREE.Mesh(iceGeo, iceMat);
    ice.rotation.x = -Math.PI / 2;
    scene.add(ice);

    // Target zones (circles on ice)
    const zones: Array<{ mesh: THREE.Mesh; pts: number; r: number }> = [];
    for (let i = ZONE_DEFS.length - 1; i >= 0; i--) {
      const z = ZONE_DEFS[i];
      const zGeo = new THREE.CylinderGeometry(z.r, z.r, 0.02, 32);
      const zMat = new THREE.MeshStandardMaterial({ color: z.color, emissive: z.color, emissiveIntensity: 0.3, transparent: true, opacity: 0.7 });
      const zMesh = new THREE.Mesh(zGeo, zMat);
      zMesh.position.set(0, 0.01, -4);
      scene.add(zMesh);
      zones.push({ mesh: zMesh, pts: z.pts, r: z.r });
    }

    // Puck
    const puckGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.12, 16);
    const puckMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7, metalness: 0.3 });
    const puck = new THREE.Mesh(puckGeo, puckMat);
    puck.position.set(s.puckX, 0.06, s.puckZ);
    scene.add(puck);

    // Launch line
    const launchLineMat = new THREE.MeshBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.3 });
    const launchLine = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.05), launchLineMat);
    launchLine.rotation.x = -Math.PI / 2; launchLine.position.set(0, 0.02, 4);
    scene.add(launchLine);

    // Rink borders
    const borderMat = new THREE.MeshStandardMaterial({ color: 0x0e2040, roughness: 0.6 });
    [[-5, 0, 0, 0.5, 0.4, 16], [5, 0, 0, 0.5, 0.4, 16], [0, 0, -8, 10, 0.4, 0.5], [0, 0, 8, 10, 0.4, 0.5]].forEach(([bx, by, bz, bw, bh, bd]) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), borderMat);
      b.position.set(bx, by + 0.2, bz);
      scene.add(b);
    });

    // Stars background
    const starPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) { starPos[i*3] = (Math.random()-0.5)*25; starPos[i*3+1] = Math.random()*10+2; starPos[i*3+2] = -10 - Math.random()*10; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x88ccff, size: 0.08, transparent: true, opacity: 0.6 })));

    const trail: Array<{ mesh: THREE.Mesh; life: number }> = [];
    const obj = { renderer, scene, camera, puck, puckLight, zones, trail, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); endGame(); }
    }, 1000);

    const FRICTION = 0.985;
    const TARGET_Z = -4;

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;

      if (s.puckMoving) {
        s.puckX += s.puckVX;
        s.puckZ += s.puckVZ;
        s.puckVX *= FRICTION;
        s.puckVZ *= FRICTION;

        // Clamp to rink
        if (Math.abs(s.puckX) > 4.7) { s.puckVX *= -0.5; s.puckX = Math.sign(s.puckX) * 4.7; }

        puck.position.set(s.puckX, 0.06, s.puckZ);
        puckLight.position.set(s.puckX, 0.5, s.puckZ);
        puck.rotation.y += 0.05;

        // Trail
        const tMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.5 }));
        tMesh.position.set(s.puckX, 0.06, s.puckZ);
        scene.add(tMesh);
        trail.push({ mesh: tMesh, life: 1.0 });
        if (trail.length > 20) { const old = trail.shift()!; scene.remove(old.mesh); }
        trail.forEach((tr, i) => {
          tr.life = i / trail.length;
          (tr.mesh.material as THREE.MeshBasicMaterial).opacity = tr.life * 0.4;
        });

        const speed = Math.sqrt(s.puckVX**2 + s.puckVZ**2);
        // Stop condition or passed target zone
        if (speed < 0.002 || s.puckZ < TARGET_Z - 2) {
          // Score
          const dist = Math.sqrt(s.puckX**2 + (s.puckZ - TARGET_Z)**2);
          let scored = false;
          for (const zone of zones) {
            if (dist <= zone.r) {
              s.sig.totalFlicks++;
              if (zone.pts === 5) s.sig.bullseyes++;
              else if (zone.pts === 3) s.sig.goodLandings++;
              s.sig.streakCurrent++;
              if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
              const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
              s.sig.score += zone.pts * mult;
              setScoreDisplay(s.sig.score);
              sfx.success?.(); hapticScore();
              (zone.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5;
              setTimeout(() => { (zone.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3; }, 500);
              scored = true; break;
            }
          }
          if (!scored) { s.sig.totalFlicks++; s.sig.misses++; s.sig.streakCurrent = 0; sfx.collision?.(); hapticFail(); }
          s.puckMoving = false;
          setTimeout(() => { if (s.running) resetPuck(); puck.position.set(s.puckX, 0.06, s.puckZ); }, 600);
        }
      } else {
        puck.position.set(s.puckX, 0.06, s.puckZ);
        puckLight.position.set(s.puckX, 0.5, s.puckZ);
      }

      // Zones pulse
      const t0 = Date.now() * 0.001;
      zones.forEach((z, i) => {
        const mat = z.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.2 + Math.sin(t0 * 1.5 + i * 0.8) * 0.08;
      });

      // Ice shimmer
      (ice.material as THREE.MeshStandardMaterial).envMapIntensity = 0.7 + Math.sin(t0 * 0.5) * 0.15;

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, resetPuck]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    let swipeStartX = 0, swipeStartY = 0, swiping = false;
    const onDown = (e: PointerEvent) => { swipeStartX = e.clientX; swipeStartY = e.clientY; swiping = true; };
    const onUp = (e: PointerEvent) => {
      if (!swiping) return; swiping = false;
      const s = stateRef.current; if (!s.running || s.puckMoving) return;
      const dx = e.clientX - swipeStartX; const dy = e.clientY - swipeStartY;
      const dist = Math.sqrt(dx*dx+dy*dy);
      if (dist > 20) {
        const speed = Math.min(dist / 120, 0.18);
        s.puckVX = (dx / dist) * speed * 0.5;
        s.puckVZ = -(dy / dist) * speed;
        s.puckMoving = true;
        sfx.click?.(); hapticImpact();
      }
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointerup', onUp);
    return () => { mount.removeEventListener('pointerdown', onDown); mount.removeEventListener('pointerup', onUp); };
  }, [phase]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
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
    { label: 'Bullseyes', value: String(sig.bullseyes), color: '#fbbf24' },
    { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
    { label: 'Good Lands', value: String(sig.goodLandings), color: '#22c55e' },
    { label: 'Misses', value: String(sig.misses), color: '#ef4444' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Take the Ice 🛷" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.bullseyes >= 3} />
      )}
    </GameShell>
  );
}
