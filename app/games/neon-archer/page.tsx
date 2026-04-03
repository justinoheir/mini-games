'use client';
/**
 * NEON ARCHER — 3D archery range with glowing moving targets.
 * Swipe to aim and release to fire arrows.
 */
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

const GAME_ID = 'neon-archer';
const ACCENT = '#00ffcc';
const DURATION = 60;
const GAME_EMOJI = '🏹';
const GAME_TITLE = 'Neon Archer';
const GAME_TAGLINE = 'Swipe to aim, release at the perfect moment to hit moving targets.';

interface Signals { totalShots: number; hits: number; perfectShots: number; maxStreak: number; streakCurrent: number; score: number; }

function getPersonality(sig: Signals): string {
  const acc = sig.totalShots > 0 ? sig.hits / sig.totalShots : 0;
  if (sig.perfectShots >= 5 && acc >= 0.7) return 'Sniper 🎯';
  if (sig.maxStreak >= 5) return 'Hot Streak 🔥';
  if (acc >= 0.6 && sig.totalShots >= 10) return 'Steady Aim 🏹';
  if (sig.totalShots >= 15 && acc < 0.4) return 'Wild Shot 💨';
  return 'Beginner Archer 🌱';
}

interface TargetObj { group: THREE.Group; x: number; y: number; vx: number; vy: number; radius: number; }
interface ArrowObj { mesh: THREE.Group; vx: number; vy: number; vz: number; active: boolean; }

type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function NeonArcherGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { totalShots: 0, hits: 0, perfectShots: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    targets: [] as TargetObj[],
    arrows: [] as ArrowObj[],
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
    pointerStart: null as { x: number; y: number; time: number } | null,
    aimLine: null as THREE.Line | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    renderer: null as THREE.WebGLRenderer | null,
    hitFlash: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.(); stopMusicRef.current = null;
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const spawnTarget = useCallback((scene: THREE.Scene): TargetObj => {
    const group = new THREE.Group();
    // Outer ring
    const outerTorus = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.12, 8, 32),
      new THREE.MeshPhongMaterial({ color: 0x00ffcc, emissive: 0x00aa88, shininess: 100 }),
    );
    group.add(outerTorus);
    // Middle ring
    const midTorus = new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.1, 8, 24),
      new THREE.MeshPhongMaterial({ color: 0x00ff88, emissive: 0x00bb44 }),
    );
    group.add(midTorus);
    // Bull's-eye
    const bullGeo = new THREE.CircleGeometry(0.3, 12);
    const bull = new THREE.Mesh(bullGeo, new THREE.MeshPhongMaterial({ color: 0xfbbf24, emissive: 0x92400e, side: THREE.DoubleSide }));
    group.add(bull);
    // Stand pole
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 4);
    const pole = new THREE.Mesh(poleGeo, new THREE.MeshPhongMaterial({ color: 0x334155 }));
    pole.position.y = -2.5;
    group.add(pole);

    const x = (Math.random() - 0.5) * 14;
    const y = 0.5 + Math.random() * 3;
    group.position.set(x, y, -10 + Math.random() * -8);

    scene.add(group);
    return { group, x, y, vx: (Math.random() - 0.5) * 0.03, vy: (Math.random() - 0.5) * 0.015, radius: 1.2 };
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalShots: 0, hits: 0, perfectShots: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.targets = []; s.arrows = []; s.particles = []; s.hitFlash = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020b14);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020b14, 0.03);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 200);
    camera.position.set(0, 1.5, 8);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x001a2e, 5));
    const neonLight = new THREE.PointLight(0x00ffcc, 3, 20);
    neonLight.position.set(0, 5, 0);
    scene.add(neonLight);
    const groundLight = new THREE.PointLight(0x0066ff, 2, 30);
    groundLight.position.set(0, -2, 0);
    scene.add(groundLight);

    // Ground
    const groundMat = new THREE.MeshPhongMaterial({ color: 0x0a1628 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    scene.add(ground);

    // Grid lines on ground
    scene.add(new THREE.GridHelper(60, 20, 0x003344, 0x001122));

    // Background neon tubes (atmosphere)
    for (let i = 0; i < 8; i++) {
      const tubeGeo = new THREE.CylinderGeometry(0.03, 0.03, 6 + Math.random() * 4);
      const tubeMat = new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0x00ffcc : 0x0066ff, transparent: true, opacity: 0.4 });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.position.set((Math.random() - 0.5) * 20, Math.random() * 3 - 1, -15 - Math.random() * 10);
      tube.rotation.z = (Math.random() - 0.5) * 0.3;
      scene.add(tube);
    }

    // Spawn initial targets
    for (let i = 0; i < 3; i++) {
      s.targets.push(spawnTarget(scene));
    }

    // Aim line
    const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -8)]);
    const aimMat = new THREE.LineDashedMaterial({ color: 0x00ffcc, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0 });
    const aimLine = new THREE.Line(aimGeo, aimMat);
    scene.add(aimLine);
    s.aimLine = aimLine;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;

      // Move targets
      for (const tgt of s.targets) {
        tgt.x += tgt.vx;
        tgt.y += tgt.vy;
        if (Math.abs(tgt.x) > 9) tgt.vx *= -1;
        if (tgt.y > 5 || tgt.y < 0.5) tgt.vy *= -1;
        tgt.group.position.x = tgt.x;
        tgt.group.position.y = tgt.y;
        tgt.group.rotation.y = Math.sin(t * 0.5) * 0.1;
      }

      // Move arrows
      for (let i = s.arrows.length - 1; i >= 0; i--) {
        const ar = s.arrows[i];
        if (!ar.active) continue;
        ar.mesh.position.x += ar.vx;
        ar.mesh.position.y += ar.vy;
        ar.mesh.position.z += ar.vz;
        ar.vy -= 0.01;

        // Check target hits
        for (const tgt of s.targets) {
          const dx = ar.mesh.position.x - tgt.group.position.x;
          const dy = ar.mesh.position.y - tgt.group.position.y;
          const dz = ar.mesh.position.z - tgt.group.position.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < tgt.radius + 0.3) {
            // Hit!
            ar.active = false;
            s.sig.hits++;
            const perfect = dist < 0.4;
            if (perfect) s.sig.perfectShots++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const pts = perfect ? 5 : 2;
            s.sig.score += pts;
            setScoreDisplay(s.sig.score);
            sfx.collect(); hapticScore();
            s.hitFlash = 20;
            neonLight.color.setHex(0xfbbf24);

            // Burst particles
            for (let p = 0; p < 12; p++) {
              const pGeo = new THREE.SphereGeometry(0.06, 6, 6);
              const pMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 1 });
              const pm = new THREE.Mesh(pGeo, pMat);
              pm.position.copy(ar.mesh.position);
              scene.add(pm);
              s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.1, life: 1 });
            }
            break;
          }
        }

        // Arrow out of bounds
        if (ar.mesh.position.z < -30 || ar.mesh.position.y < -5) {
          ar.active = false;
        }

        if (!ar.active) {
          scene.remove(ar.mesh);
          s.arrows.splice(i, 1);
        }
      }

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.life -= 0.03;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      // Hit flash
      if (s.hitFlash > 0) {
        neonLight.intensity = 3 + (s.hitFlash / 20) * 4;
        s.hitFlash--;
        if (s.hitFlash === 0) neonLight.color.setHex(0x00ffcc);
      } else {
        neonLight.intensity = 3 + Math.sin(t * 2) * 0.5;
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame, spawnTarget]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      s.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
      if (s.aimLine) (s.aimLine.material as THREE.LineDashedMaterial).opacity = 0.6;
    };
    const onMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.pointerStart || !s.aimLine || !s.camera || !s.renderer) return;
      // Update aim line based on pointer position
      const rect = s.renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const dir = new THREE.Vector3(nx * 8, ny * 6, -15).normalize();
      s.aimLine.geometry.setFromPoints([new THREE.Vector3(0, 1.5, 8), dir.multiplyScalar(20).add(new THREE.Vector3(0, 1.5, 8))]);
      s.aimLine.computeLineDistances();
    };
    const onUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.pointerStart || !s.scene || !s.renderer) { s.pointerStart = null; return; }
      const dx = e.clientX - s.pointerStart.x;
      const dy = e.clientY - s.pointerStart.y;
      const dt = Math.max(1, Date.now() - s.pointerStart.time);
      s.pointerStart = null;
      if (s.aimLine) (s.aimLine.material as THREE.LineDashedMaterial).opacity = 0;

      const dist2d = Math.sqrt(dx * dx + dy * dy);
      if (dist2d < 15) return;

      // Create arrow
      const arrowGroup = new THREE.Group();
      const shaftGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2);
      const shaftMat = new THREE.MeshPhongMaterial({ color: 0xd4a017, emissive: 0x78350f });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.rotation.x = Math.PI / 2;
      arrowGroup.add(shaft);
      const tipGeo = new THREE.ConeGeometry(0.06, 0.3, 6);
      const tipMesh = new THREE.Mesh(tipGeo, new THREE.MeshPhongMaterial({ color: 0x00ffcc, emissive: 0x00aa88 }));
      tipMesh.position.z = -0.7;
      tipMesh.rotation.x = Math.PI / 2;
      arrowGroup.add(tipMesh);
      arrowGroup.position.set(0, 1.5, 8);
      s.scene.add(arrowGroup);

      // Velocity from swipe
      const rect = s.renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const power = Math.min((dist2d / rect.width) * 3 + 0.3, 1.0);
      s.arrows.push({
        mesh: arrowGroup,
        vx: nx * 0.3 * power,
        vy: ny * 0.15 * power,
        vz: -0.5 * power,
        active: true,
      });
      s.sig.totalShots++;
      if (s.sig.streakCurrent > 0 && s.arrows.every(a => !a.active)) {
        // miss check will happen on next frame
      }
      sfx.click(); haptic([15]);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); };
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#020b14 0%,#051020 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Nock an Arrow 🏹" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.totalShots > 0 ? Math.round(finalSig.hits / finalSig.totalShots * 100) : 0}%`, color: '#4ade80' },
            { label: 'Perfect Shots', value: `${finalSig.perfectShots}`, color: '#fbbf24' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: ACCENT },
            { label: 'Total Shots', value: `${finalSig.totalShots}`, color: '#94a3b8' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 8} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, hits: sig.hits, totalShots: sig.totalShots }, player);
  }, [theme, sig, personality, player]);
  return null;
}
