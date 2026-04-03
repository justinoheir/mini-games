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

const GAME_ID  = 'bounce-pass';
const PB_KEY   = 'pb_bounce-pass';
const ACCENT   = '#f97316';
const DURATION = 30;
const GAME_EMOJI   = '🏀';
const GAME_TITLE   = 'Bounce Pass';
const GAME_TAGLINE = 'Swipe to bounce-pass through defenders.';

interface Signals {
  score: number; passes: number; misses: number;
  maxStreak: number; streak: number; fastPasses: number;
}

function getPersonality(sig: Signals): string {
  const total = sig.passes + sig.misses;
  if (total === 0) return 'Ball Carrier 🏀';
  const acc = sig.passes / total;
  if (acc >= 0.8 && sig.maxStreak >= 5) return 'Point Guard ⭐';
  if (sig.fastPasses >= 5)              return 'Quick Hands 🤌';
  if (acc >= 0.7)                       return 'Sharp Passer 🎯';
  if (sig.maxStreak >= 4)               return 'In the Groove 🎵';
  return 'Learning the Bounce 📚';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface Defender {
  mesh: THREE.Mesh; vx: number; id: number;
}

interface BallState {
  mesh: THREE.Mesh; active: boolean; vx: number; vy: number;
  bounced: boolean;
  trail: THREE.Mesh[];
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  animId: number; frame: number;
  ball: BallState | null;
  defenders: Defender[];
  nextDefId: number;
  intervalId: ReturnType<typeof setInterval> | null;
  stopMusic: (() => void) | null;
  pointerStart: { x: number; y: number; t: number } | null;
  aimArrow: THREE.ArrowHelper | null;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  courtLight: THREE.PointLight | null;
  targetMesh: THREE.Mesh | null;
}

export default function BouncePassGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, passes: 0, misses: 0, maxStreak: 0, streak: 0, fastPasses: 0 },
    renderer: null, scene: null, camera: null, animId: 0, frame: 0,
    ball: null, defenders: [], nextDefId: 0,
    intervalId: null, stopMusic: null,
    pointerStart: null, aimArrow: null, particles: [],
    courtLight: null, targetMesh: null,
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
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > prev) localStorage.setItem(PB_KEY, String(s.sig.score));
    } catch { /* ignore */ }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const resetBall = useCallback((scene: THREE.Scene, s: GS) => {
    if (s.ball) {
      s.ball.trail.forEach(t => { scene.remove(t); t.geometry.dispose(); (t.material as THREE.Material).dispose(); });
      scene.remove(s.ball.mesh);
      s.ball.mesh.geometry.dispose();
      (s.ball.mesh.material as THREE.Material).dispose();
    }
    const ballGeo = new THREE.SphereGeometry(0.35, 20, 20);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6, metalness: 0.1, emissive: 0xf97316, emissiveIntensity: 0.15 });
    const ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.position.set(0, 0.35, 3); // start at player end
    scene.add(ballMesh);
    const trail: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const tGeo = new THREE.SphereGeometry(0.15, 8, 8);
      const tMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0 });
      const tMesh = new THREE.Mesh(tGeo, tMat);
      scene.add(tMesh);
      trail.push(tMesh);
    }
    s.ball = { mesh: ballMesh, active: false, vx: 0, vy: 0, bounced: false, trail };
  }, []);

  const spawnDefenders = useCallback((scene: THREE.Scene, s: GS, count: number) => {
    s.defenders.forEach(d => { scene.remove(d.mesh); d.mesh.geometry.dispose(); (d.mesh.material as THREE.Material).dispose(); });
    s.defenders = [];
    const defGeo = new THREE.CapsuleGeometry(0.25, 1.0, 4, 8);
    const defMat = new THREE.MeshStandardMaterial({ color: 0xcc0000, emissive: 0x440000, emissiveIntensity: 0.3, roughness: 0.6 });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(defGeo, defMat.clone());
      const xPos = -3 + (6 / (count - 1 || 1)) * i + (Math.random() - 0.5) * 0.8;
      mesh.position.set(xPos, 1.0, 0);
      scene.add(mesh);
      s.defenders.push({ mesh, vx: (0.025 + Math.random() * 0.02) * (Math.random() < 0.5 ? 1 : -1), id: s.nextDefId++ });
    }
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, passes: 0, misses: 0, maxStreak: 0, streak: 0, fastPasses: 0 };
    s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(0x0a0a1a);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 50);
    camera.position.set(0, 5, 9);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    // Lighting
    scene.add(new THREE.AmbientLight(0x334466, 2));
    const courtLight = new THREE.PointLight(0xffeedd, 2.5, 20);
    courtLight.position.set(0, 8, 0);
    scene.add(courtLight);
    s.courtLight = courtLight;
    const rimLight1 = new THREE.PointLight(0xff6600, 1.2, 15);
    rimLight1.position.set(-6, 4, -3);
    scene.add(rimLight1);
    const rimLight2 = new THREE.PointLight(0x0066ff, 0.8, 15);
    rimLight2.position.set(6, 4, 3);
    scene.add(rimLight2);

    // Court floor
    const floorGeo = new THREE.PlaneGeometry(10, 12);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x7b4f1e, roughness: 0.8 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Court lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    const centerLine = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5, 0.01, 0), new THREE.Vector3(5, 0.01, 0)]);
    scene.add(new THREE.Line(centerLine, lineMat));
    const circle = new THREE.CircleGeometry(1.5, 32);
    const circleEdge = new THREE.EdgesGeometry(circle);
    const circleLines = new THREE.LineSegments(circleEdge, lineMat);
    circleLines.rotation.x = -Math.PI / 2; circleLines.position.y = 0.01;
    scene.add(circleLines);

    // Target hoop on far end
    const hoopGeo = new THREE.TorusGeometry(0.45, 0.04, 8, 24);
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xf97316, emissiveIntensity: 0.5, metalness: 0.8 });
    const hoop = new THREE.Mesh(hoopGeo, hoopMat);
    hoop.position.set(0, 0.8, -5);
    hoop.rotation.x = -0.3;
    scene.add(hoop);
    s.targetMesh = hoop;
    // Backboard
    const bbGeo = new THREE.BoxGeometry(1.5, 1, 0.06);
    const bbMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, transparent: true, opacity: 0.4 });
    const bb = new THREE.Mesh(bbGeo, bbMat);
    bb.position.set(0, 1.5, -5.2);
    scene.add(bb);

    // Resize handler
    const onResize = () => {
      const W2 = mount.clientWidth || window.innerWidth;
      const H2 = mount.clientHeight || window.innerHeight;
      renderer.setSize(W2, H2);
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    (s as unknown as { _resizeCleanup: () => void })._resizeCleanup = () => window.removeEventListener('resize', onResize);

    resetBall(scene, s);
    spawnDefenders(scene, s, 2);

    s.stopMusic = startMusic('sports' as import('@/lib/audio').MusicPattern);
    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Court light pulse
      if (s.courtLight) s.courtLight.intensity = 2.3 + Math.sin(s.frame * 0.05) * 0.3;

      // Hoop pulse
      if (s.targetMesh) s.targetMesh.rotation.y += 0.01;

      // Move defenders
      s.defenders.forEach(d => {
        d.mesh.position.x += d.vx;
        if (d.mesh.position.x > 4) { d.mesh.position.x = 4; d.vx = -Math.abs(d.vx); }
        if (d.mesh.position.x < -4) { d.mesh.position.x = -4; d.vx = Math.abs(d.vx); }
      });

      // Update ball physics
      if (s.ball && s.ball.active) {
        const ball = s.ball;
        ball.mesh.position.x += ball.vx;
        ball.mesh.position.z += ball.vy;
        ball.mesh.rotation.x += ball.vx * 0.3;

        // Bounce off floor
        if (!ball.bounced && ball.mesh.position.z <= 0 && ball.mesh.position.y <= 0.4) {
          ball.bounced = true;
          ball.mesh.position.y = 0.4;
          sfx.collision();
          haptic([20]);
          // Bounce particles
          for (let i = 0; i < 6; i++) {
            const pGeo = new THREE.SphereGeometry(0.07, 6, 6);
            const pMat = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xf97316, emissiveIntensity: 0.8, transparent: true, opacity: 1 });
            const pMesh = new THREE.Mesh(pGeo, pMat);
            pMesh.position.copy(ball.mesh.position);
            scene.add(pMesh);
            const angle = (i / 6) * Math.PI * 2;
            s.particles.push({ mesh: pMesh, vx: Math.cos(angle) * 0.08, vy: 0.12, vz: 0, life: 20 });
          }
        }

        // Arc - simulate bounce
        const normalizedZ = (ball.mesh.position.z - 3) / -8; // 0=start, 1=target
        if (!ball.bounced) {
          ball.mesh.position.y = 0.35 + Math.sin(normalizedZ * Math.PI * 0.5) * 1.2;
        } else {
          ball.mesh.position.y = 0.35 + Math.sin(Math.max(0, (normalizedZ - 0.5) * Math.PI)) * 0.8;
        }

        // Trail
        for (let i = ball.trail.length - 1; i > 0; i--) {
          ball.trail[i].position.copy(ball.trail[i - 1].position);
          (ball.trail[i].material as THREE.MeshBasicMaterial).opacity = (1 - i / ball.trail.length) * 0.4;
        }
        ball.trail[0].position.copy(ball.mesh.position);

        // Check collision with defenders
        let blocked = false;
        for (const d of s.defenders) {
          const dx = Math.abs(ball.mesh.position.x - d.mesh.position.x);
          const dz = Math.abs(ball.mesh.position.z - d.mesh.position.z);
          if (dx < 0.6 && dz < 0.8) { blocked = true; break; }
        }

        if (blocked) {
          ball.active = false;
          sfx.nearMiss(); hapticFail();
          s.sig.misses++; s.sig.streak = 0;
          setTimeout(() => { if (s.running) { resetBall(scene, s); spawnDefenders(scene, s, Math.min(4, 2 + Math.floor(s.sig.passes / 4))); } }, 600);
          return;
        }

        // Ball reached target area
        if (ball.mesh.position.z <= -4.5) {
          ball.active = false;
          const passTime = Date.now();
          const isFast = passTime > 0;
          s.sig.passes++;
          s.sig.streak++;
          if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
          const pts = s.sig.streak >= 3 ? 3 : s.sig.streak >= 2 ? 2 : 1;
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          sfx.success(); hapticScore();
          // Burst at hoop
          for (let i = 0; i < 10; i++) {
            const pGeo = new THREE.SphereGeometry(0.06, 6, 6);
            const pMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1, transparent: true, opacity: 1 });
            const pMesh = new THREE.Mesh(pGeo, pMat);
            pMesh.position.set(0, 1, -5);
            scene.add(pMesh);
            const angle = (i / 10) * Math.PI * 2;
            s.particles.push({ mesh: pMesh, vx: Math.cos(angle) * 0.12, vy: 0.15 + Math.random() * 0.1, vz: Math.sin(angle) * 0.1, life: 25 });
          }
          setTimeout(() => { if (s.running) { resetBall(scene, s); spawnDefenders(scene, s, Math.min(5, 2 + Math.floor(s.sig.passes / 3))); } }, 500);
        }
      }

      // Particles
      s.particles = s.particles.filter(p => {
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy -= 0.008;
        p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, p.life / 25);
        if (p.life <= 0) { scene.remove(p.mesh); return false; }
        return true;
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, resetBall, spawnDefenders]);

  const doSwipe = useCallback((dx: number, dy: number) => {
    const s = stateRef.current;
    if (!s.running || !s.ball || s.ball.active) return;
    const speed = Math.min(0.25, Math.sqrt(dx * dx + dy * dy) / 200);
    s.ball.active = true;
    s.ball.vx = (dx / 300) * 0.15;
    s.ball.vy = -0.12 - speed * 0.3;
    s.ball.bounced = false;
    sfx.collect();
    haptic([20]);
    if (s.aimArrow && s.scene) {
      s.scene.remove(s.aimArrow);
      s.aimArrow = null;
    }
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const onDown = (e: PointerEvent) => {
      s.pointerStart = { x: e.clientX, y: e.clientY, t: Date.now() };
    };
    const onMove = (e: PointerEvent) => {
      if (!s.pointerStart || phase !== 'playing') return;
      const dx = e.clientX - s.pointerStart.x;
      const dy = e.clientY - s.pointerStart.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        if (s.aimArrow && s.scene) s.scene.remove(s.aimArrow);
        if (s.scene && s.ball) {
          const dir = new THREE.Vector3(dx / 100, 0, -1).normalize();
          const arrow = new THREE.ArrowHelper(dir, s.ball.mesh.position.clone().setY(0.5), 2, 0xf97316, 0.3, 0.2);
          s.scene.add(arrow); s.aimArrow = arrow;
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!s.pointerStart || phase !== 'playing') return;
      const dx = e.clientX - s.pointerStart.x;
      const dy = e.clientY - s.pointerStart.y;
      const dt = Date.now() - s.pointerStart.t;
      s.pointerStart = null;
      if (Math.abs(dy) > 20 || dt < 300) doSwipe(dx, dy);
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointermove', onMove);
    mount.addEventListener('pointerup', onUp);
    return () => {
      mount.removeEventListener('pointerdown', onDown);
      mount.removeEventListener('pointermove', onMove);
      mount.removeEventListener('pointerup', onUp);
    };
  }, [phase, doSwipe]);

  useEffect(() => () => {
    const s = stateRef.current;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stopMusic) s.stopMusic();
    if (s.renderer) s.renderer.dispose();
    (s as unknown as { _resizeCleanup?: () => void })._resizeCleanup?.();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const buildInsights = (sig: Signals) => {
    const total = sig.passes + sig.misses;
    const acc = total > 0 ? Math.round(sig.passes / total * 100) : 0;
    return [
      { label: 'Accuracy', value: `${acc}%`, color: acc >= 70 ? '#4ade80' : '#facc15' },
      { label: 'Passes', value: String(sig.passes), color: ACCENT },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Take the Court" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME',  value: timeLeft,    danger: timeLeft <= 10 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
            onPlayAgain={handlePlayAgain} didWin={finalSig.passes >= 5} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, passes: sig.passes, misses: sig.misses, maxStreak: sig.maxStreak }, player);
  }, [theme, sig, personality, player]);
  return null;
}
