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

const GAME_ID = 'bubble-burst';
const ACCENT = '#67e8f9';
const DURATION = 30;
const GAME_EMOJI = '🫧';
const GAME_TITLE = 'Bubble Burst';
const GAME_TAGLINE = 'Pinch at the perfect size!';
const PB_KEY = 'mg_pb_bubble-burst';

const BUBBLE_HEX = [0x67e8f9, 0xa5f3fc, 0x38bdf8, 0x7dd3fc, 0x93c5fd, 0x818cf8];

interface BubbleObj {
  mesh: THREE.Mesh; r: number; maxR: number; growing: boolean;
  spawnTime: number; popping: boolean; popTimer: number;
}
interface Signals { score: number; hits: number; attempts: number; reactionTimes: number[]; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avg = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length : 9999;
  if (acc >= 0.75 && avg < 700) return 'Bubble Master 🫧';
  if (acc >= 0.55) return 'Precise 🎯';
  if (sig.maxStreak >= 4) return 'Tenacious 💪';
  return 'Pop Learner 💭';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  bubbles: BubbleObj[]; nextId: number; frame: number;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function BubbleBurstInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    bubbles: [], nextId: 0, frame: 0, particles: [],
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

  const spawnBubble = useCallback((scene: THREE.Scene, s: GS) => {
    const maxR = 0.4 + Math.random() * 0.6;
    const colorHex = BUBBLE_HEX[Math.floor(Math.random() * BUBBLE_HEX.length)];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 20, 20),
      new THREE.MeshStandardMaterial({
        color: colorHex, emissive: colorHex, emissiveIntensity: 0.3,
        roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.75,
        wireframe: false,
      })
    );
    const x = (Math.random() - 0.5) * 8;
    const y = (Math.random() - 0.5) * 5;
    const z = (Math.random() - 0.5) * 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
    s.bubbles.push({ mesh, r: 0.1, maxR, growing: true, spawnTime: Date.now(), popping: false, popTimer: 0 });
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    s.bubbles = []; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x001a2e);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x112233, 3));
    const cyanLight = new THREE.PointLight(0x67e8f9, 2, 25);
    cyanLight.position.set(0, 3, 5);
    scene.add(cyanLight);
    const blueLight = new THREE.PointLight(0x3b82f6, 1.5, 20);
    blueLight.position.set(-4, -2, 4);
    scene.add(blueLight);

    // Underwater bg particles
    const uPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) {
      uPos[i * 3] = (Math.random() - 0.5) * 20;
      uPos[i * 3 + 1] = (Math.random() - 0.5) * 12;
      uPos[i * 3 + 2] = -5 - Math.random() * 8;
    }
    const uGeo = new THREE.BufferGeometry();
    uGeo.setAttribute('position', new THREE.BufferAttribute(uPos, 3));
    scene.add(new THREE.Points(uGeo, new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.04, transparent: true, opacity: 0.3 })));

    // Seabed
    const seabed = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 6),
      new THREE.MeshStandardMaterial({ color: 0x0a2a4a, roughness: 0.9 })
    );
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.y = -4;
    scene.add(seabed);

    s.stopMusic = startMusic('chill');
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    // Initial bubbles
    for (let i = 0; i < 4; i++) spawnBubble(scene, s);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Spawn
      if (s.frame % 40 === 0 && s.bubbles.length < 8) spawnBubble(scene, s);

      // Update bubbles
      for (let i = s.bubbles.length - 1; i >= 0; i--) {
        const b = s.bubbles[i];
        if (b.popping) {
          b.popTimer++;
          b.mesh.scale.setScalar(1 + b.popTimer * 0.12);
          const mat = b.mesh.material as THREE.MeshStandardMaterial;
          mat.opacity = Math.max(0, 0.75 - b.popTimer / 10 * 0.75);
          if (b.popTimer > 10) { scene.remove(b.mesh); s.bubbles.splice(i, 1); }
          continue;
        }
        // Gentle drift up
        b.mesh.position.y += 0.005;
        b.mesh.rotation.y += 0.01;
        // Grow
        if (b.growing) {
          b.r = Math.min(b.r + 0.004, b.maxR);
          b.mesh.scale.setScalar(b.r / 0.1);
          if (b.r >= b.maxR) b.growing = false;
        }
        // Shine pulse
        const mat = b.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.2 + Math.sin(Date.now() * 0.003 + i) * 0.1;
        // Remove if off screen
        if (b.mesh.position.y > 6) { scene.remove(b.mesh); s.bubbles.splice(i, 1); }
      }

      // Pop particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.005; p.life--;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / 20;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      // Glow pulse
      cyanLight.intensity = 1.5 + Math.sin(Date.now() * 0.003) * 0.5;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, spawnBubble]);

  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const rect = mount.getBoundingClientRect();
      activePointers.current.set(e.pointerId, {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      });
      mount.setPointerCapture(e.pointerId);

      // Single tap or pinch check
      const s = stateRef.current;
      const pts = Array.from(activePointers.current.values());

      for (let bi = s.bubbles.length - 1; bi >= 0; bi--) {
        const b = s.bubbles[bi];
        if (b.popping) continue;
        // Project bubble to screen space (approx)
        const bsx = (b.mesh.position.x + 5) / 10;
        const bsy = 0.5 - b.mesh.position.y / 10;
        let hit = false;
        for (const pt of pts) {
          const d = Math.sqrt((pt.x - bsx) ** 2 + (pt.y - bsy) ** 2);
          if (d < (b.r / 0.1) * 0.1) { hit = true; break; }
        }
        if (hit) {
          const fullness = b.r / b.maxR;
          const isPerfect = fullness >= 0.8 && fullness <= 1.0;
          b.popping = true; b.popTimer = 0;
          s.sig.attempts++;
          const rt = Date.now() - b.spawnTime;
          if (isPerfect || fullness >= 0.5) {
            s.sig.hits++; s.sig.reactionTimes.push(rt);
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const pts2 = isPerfect ? 3 : 1;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts2 * mult; setScoreDisplay(s.sig.score);
            sfx.collect?.(); haptic([20]);
          } else {
            s.sig.streakCurrent = 0;
            sfx.click?.();
          }
          // Spawn pop particles
          const col = (b.mesh.material as THREE.MeshStandardMaterial).color;
          const scene = s.scene!;
          for (let pi = 0; pi < 8; pi++) {
            const pm = new THREE.Mesh(
              new THREE.SphereGeometry(0.05, 4, 4),
              new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true, opacity: 1 })
            );
            pm.position.copy(b.mesh.position);
            scene.add(pm);
            s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.1, vy: 0.06 + Math.random() * 0.06, vz: (Math.random() - 0.5) * 0.08, life: 20 });
          }
          break;
        }
      }
    };
    const onPointerUp = (e: PointerEvent) => { activePointers.current.delete(e.pointerId); };
    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('pointercancel', onPointerUp);
    return () => {
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('pointercancel', onPointerUp);
    };
  }, [phase]);

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
          ctaLabel="Pop! 🫧" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy', value: `${finalSig.attempts > 0 ? Math.round(finalSig.hits / finalSig.attempts * 100) : 0}%`, color: ACCENT },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Hits', value: String(finalSig.hits), color: '#4ade80' },
            { label: 'Avg Reaction', value: finalSig.reactionTimes.length > 0 ? `${Math.round(finalSig.reactionTimes.reduce((a, b) => a + b, 0) / finalSig.reactionTimes.length)}ms` : 'N/A', color: '#06b6d4' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 8} />
      )}
      {phase === 'done' && finalSig && (() => {
        const personality = getPersonality(finalSig);
        return <WebhookEmitter theme={theme} sig={finalSig} personality={personality} player={playerSessionRef.current} />;
      })()}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const BubbleBurst = dynamic(() => Promise.resolve({ default: BubbleBurstInner }), { ssr: false });
export default BubbleBurst;
