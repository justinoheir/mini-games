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

const GAME_ID = 'drop-zone';
const ACCENT = '#22d3ee';
const DURATION = 45;
const GAME_EMOJI = '🎯';
const GAME_TITLE = 'Drop Zone';
const GAME_TAGLINE = 'Release at the right moment.';

interface Signals { totalDrops: number; bullseyes: number; misses: number; goodDrops: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalDrops > 0 ? (sig.bullseyes + sig.goodDrops) / sig.totalDrops : 0;
  if (sig.bullseyes >= 5 && acc >= 0.8) return 'Dead Eye 🎯';
  if (sig.maxStreak >= 5) return 'Zone Finder 🌀';
  if (acc >= 0.6) return 'Good Aim 👀';
  if (sig.totalDrops >= 15) return 'Keep Dropping 📦';
  return 'Off Target 🎪';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean; timeLeft: number; sig: Signals;
  pendulumAngle: number; pendulumSpeed: number;
  ballReleased: boolean; ballX: number; ballY: number; ballVX: number; ballVY: number;
  ballActive: boolean;
}

const ZONE_DEFS = [
  { pts: 1, color: 0x3b82f6, label: 'OK' },
  { pts: 2, color: 0x10b981, label: 'GOOD' },
  { pts: 5, color: 0xfbbf24, label: 'BULL' },
  { pts: 2, color: 0x10b981, label: 'GOOD' },
  { pts: 1, color: 0x3b82f6, label: 'OK' },
];

export default function DropZone() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GState>({
    running: false, timeLeft: DURATION,
    sig: { totalDrops: 0, bullseyes: 0, misses: 0, goodDrops: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    pendulumAngle: 0, pendulumSpeed: 0.025,
    ballReleased: false, ballX: 0, ballY: 0, ballVX: 0, ballVY: 0, ballActive: true,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    ball: THREE.Mesh; arm: THREE.Mesh; hook: THREE.Mesh; zones: THREE.Mesh[];
    floatTexts: Array<{ mesh: THREE.Mesh; vy: number; alpha: number }>;
    animId: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const resetBall = useCallback(() => {
    const s = stateRef.current;
    s.ballReleased = false; s.ballActive = true;
    s.ballX = Math.sin(s.pendulumAngle) * 4;
    s.ballY = 2.5;
    s.ballVX = 0; s.ballVY = 0;
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalDrops: 0, bullseyes: 0, misses: 0, goodDrops: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.pendulumAngle = 0; s.pendulumSpeed = 0.025;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x080c12);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const pl = new THREE.PointLight(0x22d3ee, 3, 30);
    pl.position.set(0, 4, 6);
    scene.add(pl);

    // Conveyor rail
    const railGeo = new THREE.BoxGeometry(10, 0.1, 0.3);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5, roughness: 0.4 });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(0, 3.2, 0);
    scene.add(rail);

    // Pendulum arm
    const armGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, metalness: 0.4, roughness: 0.3, emissive: 0x0a4050 });
    const arm = new THREE.Mesh(armGeo, armMat);
    scene.add(arm);

    // Hook
    const hookGeo = new THREE.SphereGeometry(0.15, 12, 12);
    const hookMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.4 });
    const hook = new THREE.Mesh(hookGeo, hookMat);
    scene.add(hook);

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.35, 20, 20);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x0e7490, emissiveIntensity: 0.4, metalness: 0.2, roughness: 0.4 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    scene.add(ball);

    // Scoring zones
    const zoneWidth = 1.8;
    const zones: THREE.Mesh[] = [];
    for (let i = 0; i < ZONE_DEFS.length; i++) {
      const z = ZONE_DEFS[i];
      const zGeo = new THREE.BoxGeometry(zoneWidth - 0.05, 0.35, 0.5);
      const zMat = new THREE.MeshStandardMaterial({
        color: z.color, emissive: z.color, emissiveIntensity: 0.2,
        metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.85,
      });
      const zMesh = new THREE.Mesh(zGeo, zMat);
      zMesh.position.set(-4.5 + (i + 0.5) * zoneWidth, -3.5, 0);
      scene.add(zMesh);
      zones.push(zMesh);
    }

    resetBall();

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const obj = { renderer, scene, camera, ball, arm, hook, zones, floatTexts: [], animId: 0 };
    threeRef.current = obj;

    const GRAVITY = -0.012;
    const ZONE_TOTAL_W = zoneWidth * ZONE_DEFS.length;
    const ZONE_LEFT = -ZONE_TOTAL_W / 2;
    const ZONE_Y = -3.5 + 0.175;

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;

      s.pendulumAngle += s.pendulumSpeed;
      const pendX = Math.sin(s.pendulumAngle) * 4;

      arm.position.set(pendX, 2.7, 0);
      hook.position.set(pendX, 3.2, 0);

      if (!s.ballReleased && s.ballActive) {
        s.ballX = pendX;
        s.ballY = 2.5;
        ball.position.set(s.ballX, s.ballY, 0);
      } else if (s.ballReleased && s.ballActive) {
        s.ballVY += GRAVITY;
        s.ballX += s.ballVX;
        s.ballY += s.ballVY;
        ball.position.set(s.ballX, s.ballY, 0);

        // Landing
        if (s.ballY <= ZONE_Y + 0.35) {
          s.ballActive = false;
          hapticImpact();
          // Find which zone
          const relX = s.ballX - ZONE_LEFT;
          const zoneIdx = Math.floor(relX / zoneWidth);
          if (zoneIdx >= 0 && zoneIdx < ZONE_DEFS.length) {
            const z = ZONE_DEFS[zoneIdx];
            s.sig.totalDrops++;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            const pts = z.pts * mult;
            s.sig.score += pts;
            setScoreDisplay(s.sig.score);
            if (z.pts >= 5) { s.sig.bullseyes++; sfx.success(); hapticScore(); }
            else if (z.pts >= 2) { s.sig.goodDrops++; sfx.collect(); hapticScore(); }
            else sfx.click?.();
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            // Flash the zone
            const zMat = zones[zoneIdx].material as THREE.MeshStandardMaterial;
            zMat.emissiveIntensity = 1.0;
            setTimeout(() => { zMat.emissiveIntensity = 0.2; }, 400);
          } else {
            s.sig.misses++; s.sig.streakCurrent = 0; hapticFail(); sfx.collision?.();
          }
          ball.position.set(-999, -999, 0); // hide
          setTimeout(() => { if (s.running) resetBall(); }, 500);
        }
      }

      // Pulse zones gently
      const t = Date.now() * 0.002;
      zones.forEach((z, i) => {
        const mat = z.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.1 + Math.sin(t + i * 0.8) * 0.06;
      });

      // Ball glow
      const ballMat = ball.material as THREE.MeshStandardMaterial;
      ballMat.emissiveIntensity = 0.3 + Math.sin(t * 3) * 0.1;

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    (obj as typeof obj & { _cleanup?: () => void })._cleanup = () => window.removeEventListener('resize', handleResize);
  }, [endGame, resetBall]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTap = (e: PointerEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      if (!s.running || s.ballReleased || !s.ballActive) return;
      s.ballReleased = true;
      // Give slight horizontal momentum from pendulum direction
      s.ballVX = Math.cos(s.pendulumAngle) * s.pendulumSpeed * 8;
      s.ballVY = 0.05;
      sfx.click?.();
    };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
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
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="A glowing ball swings on the conveyor. Tap to drop it into the scoring zones!" ctaLabel="Drop It! 🎯" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Bullseyes', value: String(finalSig.bullseyes), color: '#fbbf24' }, { label: 'Good Drops', value: String(finalSig.goodDrops), color: ACCENT }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' }, { label: 'Misses', value: String(finalSig.misses), color: '#ef4444' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.bullseyes >= 3} />
      )}
    </GameShell>
  );
}
