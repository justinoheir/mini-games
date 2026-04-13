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

const GAME_ID = 'archery-draw';
const ACCENT = '#16a34a';
const DURATION = 60;
const GAME_EMOJI = '🏹';
const GAME_TITLE = 'Archery Draw';
const GAME_TAGLINE = 'Pull back. Wait. Release.';

interface Signals {
  shots: number; bullseyes: number; inners: number; outers: number;
  maxStreak: number; streakCurrent: number; score: number;
}
function getPersonality(sig: Signals): string {
  const bull = sig.shots > 0 ? sig.bullseyes / sig.shots : 0;
  if (bull >= 0.7) return 'Robin Hood 🏹';
  if (sig.maxStreak >= 5) return 'Arrow Master ⚡';
  if (bull >= 0.4) return 'Steady Archer 🎯';
  return 'Learning the Draw 🌱';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  // Game objects
  targetGroup: THREE.Group | null;
  arrowMesh: THREE.Group | null;
  aimRing: THREE.Mesh | null;
  aimLight: THREE.PointLight | null;
  particles: THREE.Points | null;
  // Game state
  drawing: boolean; drawLevel: number; drawStart: number;
  aimLocked: boolean; aimOscillation: number;
  aimOffset: { x: number; y: number };
  arrowFlight: boolean;
  arrowStartPos: THREE.Vector3;
  arrowTargetPos: THREE.Vector3;
  arrowT: number;
  floats: Array<{ mesh: THREE.Sprite; life: number; vy: number }>;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
  frame: number;
}

function ArcheryDrawInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { shots: 0, bullseyes: 0, inners: 0, outers: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    targetGroup: null, arrowMesh: null, aimRing: null, aimLight: null, particles: null,
    drawing: false, drawLevel: 0, drawStart: 0, aimLocked: false, aimOscillation: 0,
    aimOffset: { x: 0, y: 0 },
    arrowFlight: false,
    arrowStartPos: new THREE.Vector3(), arrowTargetPos: new THREE.Vector3(),
    arrowT: 0,
    floats: [], intervalId: null, resizeCleanup: null, frame: 0,
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
    setPhase('done');
    hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { shots: 0, bullseyes: 0, inners: 0, outers: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.drawing = false; s.drawLevel = 0; s.aimLocked = false; s.arrowFlight = false;
    s.aimOffset = { x: 0, y: 0 };
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    // ── Three.js setup ─────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a1a0a);
    renderer.shadowMap.enabled = false;
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a1a0a, 0.04);
    s.scene = scene;

    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 200);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x224422, 2));
    const sunLight = new THREE.DirectionalLight(0x88ffaa, 1.5);
    sunLight.position.set(5, 10, 5);
    scene.add(sunLight);
    const aimLight = new THREE.PointLight(0x00ff44, 0, 12);
    aimLight.position.set(0, 0.5, -2);
    scene.add(aimLight);
    s.aimLight = aimLight;

    // Forest background — tree trunks + cones
    for (let i = 0; i < 14; i++) {
      const tx = (i / 14) * 30 - 15 + (Math.random() - 0.5) * 2;
      const tz = -8 - Math.random() * 10;
      const treeH = 4 + Math.random() * 4;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.18, treeH, 6),
        new THREE.MeshStandardMaterial({ color: 0x3d2000, roughness: 0.9 })
      );
      trunk.position.set(tx, -2 + treeH * 0.5, tz);
      scene.add(trunk);
      const foliage = new THREE.Mesh(
        new THREE.ConeGeometry(1.2 + Math.random() * 0.8, treeH * 0.8, 7),
        new THREE.MeshStandardMaterial({ color: 0x0d4a0d, roughness: 0.8 })
      );
      foliage.position.set(tx, -2 + treeH + treeH * 0.3, tz);
      scene.add(foliage);
    }

    // Ground plane
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x1a3a1a, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.5;
    scene.add(ground);

    // Target at z=-3
    const targetGroup = new THREE.Group();
    targetGroup.position.set(0, 0.5, -3);
    const ringConfigs = [
      { r: 1.8, c: 0xffffff }, { r: 1.4, c: 0x111111 },
      { r: 1.0, c: 0x3b82f6 }, { r: 0.65, c: 0xef4444 }, { r: 0.3, c: 0xef4444 }
    ];
    ringConfigs.forEach(({ r, c }, i) => {
      const ring = new THREE.Mesh(
        new THREE.CircleGeometry(r, 32),
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 })
      );
      ring.position.z = i * 0.02;
      targetGroup.add(ring);
    });
    // Target post
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a3500 })
    );
    post.position.set(0, -2, 0);
    targetGroup.add(post);
    scene.add(targetGroup);
    s.targetGroup = targetGroup;

    // Aim ring — glowing ring at target
    const aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.22, 32),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    aimRing.position.set(0, 0.5, -2.8);
    scene.add(aimRing);
    s.aimRing = aimRing;

    // Arrow group (hidden until flight)
    const arrowGroup = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.3 })
    );
    shaft.rotation.z = Math.PI / 2;
    arrowGroup.add(shaft);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.25, 6),
      new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 })
    );
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 1.6;
    arrowGroup.add(tip);
    arrowGroup.visible = false;
    scene.add(arrowGroup);
    s.arrowMesh = arrowGroup;

    // Star particles
    const starCount = 300;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 30 + 5;
      starPos[i * 3 + 2] = -15 - Math.random() * 20;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x88ffaa, size: 0.05 })));

    // Resize
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    // Timer
    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    // Render loop
    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const t = s.frame * 0.016;

      // Aim oscillation
      if (s.drawing && !s.aimLocked) {
        // Difficulty: wobble speed and amplitude increase with shots taken
        const diffMult = 1 + Math.min(s.sig.shots * 0.12, 1.5);
        s.aimOscillation += 0.06 * diffMult;
        const wobble = (1 - s.drawLevel) * (0.8 + Math.min(s.sig.shots * 0.04, 0.6));
        s.aimOffset.x = Math.sin(s.aimOscillation * 1.7) * wobble;
        s.aimOffset.y = Math.cos(s.aimOscillation) * wobble;
      } else if (s.aimLocked) {
        s.aimOscillation = 0;
        s.aimOffset.x *= 0.9;
        s.aimOffset.y *= 0.9;
      }

      // Update aim ring
      if (s.aimRing && s.drawing && !s.arrowFlight) {
        s.aimRing.position.set(
          s.aimOffset.x,
          0.5 + s.aimOffset.y,
          -2.8
        );
        const mat = s.aimRing.material as THREE.MeshBasicMaterial;
        mat.opacity = s.drawLevel;
        mat.color.setHex(s.aimLocked ? 0x4ade80 : 0xffffff);
        if (s.aimLight) {
          s.aimLight.intensity = s.aimLocked ? 2 : s.drawLevel * 1;
          s.aimLight.color.setHex(s.aimLocked ? 0x00ff44 : 0xffffff);
          s.aimLight.position.copy(s.aimRing.position);
        }
      } else if (s.aimRing && !s.drawing) {
        (s.aimRing.material as THREE.MeshBasicMaterial).opacity = 0;
        if (s.aimLight) s.aimLight.intensity = 0;
      }

      // Draw level increases while held
      if (s.drawing) {
        s.drawLevel = Math.min(1, (Date.now() - s.drawStart) / 1500);
        if (s.drawLevel >= 0.8) s.aimLocked = true;
      }

      // Arrow flight
      if (s.arrowFlight && s.arrowMesh) {
        s.arrowT += 0.04;
        if (s.arrowT >= 1) {
          // Check hit
          const dist = Math.sqrt(s.aimOffset.x ** 2 + s.aimOffset.y ** 2);
          s.sig.shots++;
          let pts = 0;
          if (dist < 0.1) { pts = 5; s.sig.bullseyes++; }
          else if (dist < 0.35) { pts = 3; s.sig.inners++; }
          else if (dist < 0.8) { pts = 1; s.sig.outers++; }
          if (pts > 0) {
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts * mult;
            setScoreDisplay(s.sig.score);
            sfx.success(); hapticScore();
          } else {
            s.sig.streakCurrent = 0;
          }
          s.arrowFlight = false;
          s.arrowMesh.visible = false;
        } else {
          const pos = s.arrowStartPos.clone().lerp(s.arrowTargetPos, s.arrowT);
          s.arrowMesh.position.copy(pos);
          const dir = s.arrowTargetPos.clone().sub(s.arrowStartPos).normalize();
          s.arrowMesh.lookAt(pos.clone().add(dir));
          s.arrowMesh.rotateY(Math.PI / 2);
        }
      }

      // Target gentle rotation
      if (s.targetGroup) {
        s.targetGroup.rotation.y = Math.sin(t * 0.3) * 0.05;
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame]);

  // Input handlers
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const onDown = () => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (s.arrowFlight) return;
      s.drawing = true;
      s.drawStart = Date.now();
      s.drawLevel = 0;
      s.aimLocked = false;
      s.aimOscillation = 0;
    };
    const onUp = () => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.drawing) return;
      s.drawing = false;
      if (s.drawLevel > 0.2 && s.arrowMesh && !s.arrowFlight) {
        s.arrowFlight = true;
        s.arrowT = 0;
        s.arrowStartPos.set(0, -1.5, 6);
        s.arrowTargetPos.set(s.aimOffset.x, 0.5 + s.aimOffset.y, -2.8);
        s.arrowMesh.position.copy(s.arrowStartPos);
        s.arrowMesh.visible = true;
        sfx.click(); hapticImpact();
      }
      s.drawLevel = 0;
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
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio();
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
          description="Hold to draw the bow. Aim settles when fully drawn. Release for glory!"
          ctaLabel="Draw! 🏹" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
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
            { label: 'Bullseyes', value: String(finalSig.bullseyes), color: '#ef4444' },
            { label: 'Inner Ring', value: String(finalSig.inners), color: ACCENT },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Total Shots', value: String(finalSig.shots), color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.bullseyes >= 3} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const ArcheryDraw = dynamic(() => Promise.resolve({ default: ArcheryDrawInner }), { ssr: false });
export default ArcheryDraw;
