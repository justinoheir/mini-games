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

const GAME_ID = 'boxing-combo';
const ACCENT = '#ef4444';
const DURATION = 30;
const GAME_EMOJI = '🥊';
const GAME_TITLE = 'Boxing Combo';
const GAME_TAGLINE = 'Jab. Cross. Hook. Repeat.';

interface Signals { totalAttempts: number; bestResult: number; maxStreak: number; streakCurrent: number; score: number; goodAttempts: number; perfectAttempts: number; }
function getPersonality(sig: Signals): string {
  if (sig.perfectAttempts >= 4 && sig.maxStreak >= 3) return 'Elite Athlete 🏆';
  if (sig.maxStreak >= 5) return 'On a Roll 🔥';
  if (sig.goodAttempts >= 5) return 'Solid Performer 💪';
  return 'Rising Athlete 🌱';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  bag: THREE.Group | null; bagSwing: number; bagSwingVel: number;
  chargeLevel: number; charging: boolean; chargeStart: number;
  punchFlash: number; resultFlash: number; resultGood: boolean;
  gloveLeft: THREE.Mesh | null; gloveRight: THREE.Mesh | null;
  punchAnim: number; punchSide: 'left' | 'right';
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  frame: number;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function BoxingComboGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { totalAttempts: 0, bestResult: 0, maxStreak: 0, streakCurrent: 0, score: 0, goodAttempts: 0, perfectAttempts: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    bag: null, bagSwing: 0, bagSwingVel: 0,
    chargeLevel: 0, charging: false, chargeStart: 0,
    punchFlash: 0, resultFlash: 0, resultGood: false,
    gloveLeft: null, gloveRight: null,
    punchAnim: 0, punchSide: 'right',
    particles: [], frame: 0,
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

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { totalAttempts: 0, bestResult: 0, maxStreak: 0, streakCurrent: 0, score: 0, goodAttempts: 0, perfectAttempts: 0 };
    s.charging = false; s.chargeLevel = 0; s.bagSwing = 0; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d0508);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0d0508, 0.03);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 1, 7);
    camera.lookAt(0, 1, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x221111, 3));
    const spotLight = new THREE.SpotLight(0xffffff, 4, 25, Math.PI / 6);
    spotLight.position.set(0, 8, 4);
    spotLight.target.position.set(0, 1, 0);
    scene.add(spotLight); scene.add(spotLight.target);
    const redLight = new THREE.PointLight(0xef4444, 1.5, 15);
    redLight.position.set(-3, 3, 2);
    scene.add(redLight);
    const blueLight = new THREE.PointLight(0x4444ff, 1, 15);
    blueLight.position.set(3, 3, 2);
    scene.add(blueLight);

    // Boxing ring floor
    const ring = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.1, 5),
      new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.8 })
    );
    ring.position.set(0, -0.5, 0);
    scene.add(ring);

    // Ring ropes
    [0.8, 1.4, 2.0].forEach(y => {
      const rope = new THREE.Mesh(
        new THREE.TorusGeometry(3.2, 0.03, 4, 40),
        new THREE.MeshBasicMaterial({ color: y === 1.4 ? 0xff4444 : 0xffffff })
      );
      rope.rotation.x = Math.PI / 2;
      rope.position.y = y;
      rope.scale.y = 0.55;
      scene.add(rope);
    });

    // Punching bag
    const bagGroup = new THREE.Group();
    bagGroup.position.set(0, 1.5, -1);
    // Chain
    const chainMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 })
    );
    chainMesh.position.y = 1.5;
    bagGroup.add(chainMesh);
    // Bag body
    const bagBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.3, 1.4, 16),
      new THREE.MeshStandardMaterial({ color: 0xcc3300, roughness: 0.5, metalness: 0.1 })
    );
    bagBody.position.y = 0;
    bagGroup.add(bagBody);
    // Bag cap
    const bagCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xaa2200, roughness: 0.5 })
    );
    bagCap.position.y = 0.7;
    bagGroup.add(bagCap);
    scene.add(bagGroup);
    s.bag = bagGroup;

    // Gloves
    const gloveGeo = new THREE.SphereGeometry(0.22, 12, 12);
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.2, roughness: 0.4 });
    const gloveL = new THREE.Mesh(gloveGeo, gloveMat.clone());
    gloveL.position.set(-1.2, 1.2, 1.5);
    scene.add(gloveL);
    s.gloveLeft = gloveL;

    const gloveR = new THREE.Mesh(gloveGeo, gloveMat.clone());
    gloveR.position.set(1.2, 1.2, 1.5);
    scene.add(gloveR);
    s.gloveRight = gloveR;

    // Star particles
    const sPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 20;
      sPos[i * 3 + 1] = Math.random() * 8;
      sPos[i * 3 + 2] = -8 - Math.random() * 8;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xff8888, size: 0.05, transparent: true, opacity: 0.4 })));

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
      const t = s.frame * 0.016;

      // Charge update
      if (s.charging) {
        s.chargeLevel = Math.min(1, (Date.now() - s.chargeStart) / 800);
      }

      // Bag swing physics
      s.bagSwingVel *= 0.95;
      s.bagSwing += s.bagSwingVel;
      s.bagSwing *= 0.97;
      if (s.bag) {
        s.bag.rotation.z = s.bagSwing * 0.3;
        s.bag.position.x = Math.sin(s.bagSwing) * 0.5;
        // Charge glow
        const bagMat = s.bag.children[1] ? (s.bag.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial : null;
        if (bagMat) {
          bagMat.emissive = new THREE.Color(s.chargeLevel, 0, 0);
          bagMat.emissiveIntensity = s.chargeLevel * 0.5;
        }
      }

      // Glove positions
      if (s.gloveLeft) {
        s.gloveLeft.position.y = 1.2 + Math.sin(t * 2) * 0.1;
        const mat = s.gloveLeft.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = s.punchSide === 'left' && s.punchAnim > 0 ? 0.8 : 0.15;
      }
      if (s.gloveRight) {
        s.gloveRight.position.y = 1.2 + Math.cos(t * 2) * 0.1;
        const mat = s.gloveRight.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = s.punchSide === 'right' && s.punchAnim > 0 ? 0.8 : 0.15;
        if (s.punchAnim > 0) {
          const fwd = Math.sin(s.punchAnim / 20 * Math.PI) * 1.5;
          s.gloveRight.position.z = 1.5 - fwd;
          s.punchAnim = Math.max(0, s.punchAnim - 1);
        }
      }

      // Result flash
      if (s.resultFlash > 0) {
        s.resultFlash--;
        renderer.setClearColor(s.resultGood ? new THREE.Color(0.05, 0.12, 0.05) : new THREE.Color(0.12, 0.03, 0.03));
      } else {
        renderer.setClearColor(0x0d0508);
      }

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.01; p.life--;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / 20;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onDown = () => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      s.charging = true; s.chargeStart = Date.now(); s.chargeLevel = 0;
    };
    const onUp = () => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.charging) return;
      s.charging = false;
      const charge = s.chargeLevel;
      s.chargeLevel = 0;
      s.sig.totalAttempts++;
      // Difficulty: perfect window narrows over time (starts wide, gets tighter)
      const timeElapsed = DURATION - s.timeLeft;
      const windowShrink = Math.min(timeElapsed / DURATION, 0.18);
      const isPerfect = charge >= (0.70 + windowShrink) && charge <= (0.90 - windowShrink);
      const isGood = charge >= 0.4 && charge <= 0.95;
      const pts = isPerfect ? 10 : isGood ? 5 : Math.round(charge * 3);
      if (isPerfect) { s.sig.perfectAttempts++; s.sig.bestResult = Math.max(s.sig.bestResult, 100); }
      if (isGood) { s.sig.goodAttempts++; }
      // Fix: streak only increments on good/perfect; resets on whiff
      if (isGood) {
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      } else {
        s.sig.streakCurrent = 0;
        sfx.nearMiss?.(); hapticFail?.();
      }
      const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += pts * mult;
      setScoreDisplay(s.sig.score);
      if (isGood) { sfx.collect(); hapticImpact?.(); }
      s.bagSwingVel = (isPerfect ? 0.5 : isGood ? 0.3 : 0.15) * (Math.random() > 0.5 ? 1 : -1);
      s.punchAnim = 20;
      s.punchSide = Math.random() > 0.5 ? 'left' : 'right';
      s.resultFlash = 8; s.resultGood = isGood;
      // Spawn impact particles
      if (s.bag && s.scene) {
        for (let pi = 0; pi < 8; pi++) {
          const pm = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 4, 4),
            new THREE.MeshBasicMaterial({ color: isPerfect ? 0xfbbf24 : 0xef4444, transparent: true, opacity: 1 })
          );
          pm.position.copy(s.bag.position);
          s.scene.add(pm);
          s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.15, vy: 0.08 + Math.random() * 0.1, vz: 0.1 + Math.random() * 0.1, life: 20 });
        }
      }
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointerup', onUp);
    return () => {
      mount.removeEventListener('pointerdown', onDown);
      mount.removeEventListener('pointerup', onUp);
    };
  }, [phase]);

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
          description="Hold to charge your punch. Release at 70-90% for PERFECT power!"
          ctaLabel="Fight! 🥊" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Perfect Punches', value: String(finalSig.perfectAttempts), color: '#fbbf24' },
            { label: 'Good Punches', value: String(finalSig.goodAttempts), color: ACCENT },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' },
            { label: 'Total Punches', value: String(finalSig.totalAttempts), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.perfectAttempts >= 3} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const BoxingComboGame = dynamic(() => Promise.resolve({ default: BoxingComboGameInner }), { ssr: false });
export default BoxingComboGame;
