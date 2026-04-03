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

const GAME_ID      = 'frog-leap';
const ACCENT       = '#22c55e';
const DURATION     = 45;
const GAME_EMOJI   = '🐸';
const GAME_TITLE   = 'Frog Leap';
const GAME_TAGLINE = 'Tap left or right to leap to lily pads. Miss = splash!';

interface LilyPad3D { x: number; z: number; mesh: THREE.Mesh; id: number; sinking: boolean; sinkTimer: number; }
interface Signals { totalLeaps: number; successfulLeaps: number; splashes: number; maxStreak: number; score: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalLeaps > 0 ? sig.successfulLeaps / sig.totalLeaps : 0;
  if (acc >= 0.85 && sig.maxStreak >= 10) return 'Lily King 👑';
  if (acc >= 0.75) return 'Sure-Footed Leaper 🎯';
  if (sig.maxStreak >= 8) return 'Streak Hopper 🏃';
  if (sig.successfulLeaps >= 15) return 'Distance Jumper 🦘';
  return 'Splash Artist 💦';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  frogX: number; frogZ: number; frogY: number;
  frogVX: number; frogVY: number; frogVZ: number;
  leaping: boolean; onPad: boolean; currentPadId: number;
  gameSpeed: number; nextPadId: number;
  scrollX: number;
}

export default function FrogLeapGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { totalLeaps: 0, successfulLeaps: 0, splashes: 0, maxStreak: 0, score: 0, streakCurrent: 0 },
    frogX: 0, frogZ: 0, frogY: 0,
    frogVX: 0, frogVY: 0, frogVZ: 0,
    leaping: false, onPad: true, currentPadId: 0,
    gameSpeed: 0.02, nextPadId: 1, scrollX: 0,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    frog: THREE.Mesh; frogLight: THREE.PointLight;
    pads: LilyPad3D[]; water: THREE.Mesh;
    splashParticles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
    animId: number;
  } | null>(null);

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const makePad = useCallback((id: number, x: number, z: number, scene: THREE.Scene): LilyPad3D => {
    const padGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.08, 16);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, emissive: 0x166534, emissiveIntensity: 0.3, roughness: 0.6, metalness: 0.1 });
    const mesh = new THREE.Mesh(padGeo, padMat);
    mesh.position.set(x, 0.04, z);
    scene.add(mesh);
    return { x, z, mesh, id, sinking: false, sinkTimer: 0 };
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalLeaps: 0, successfulLeaps: 0, splashes: 0, maxStreak: 0, score: 0, streakCurrent: 0 };
    s.frogX = 0; s.frogZ = 0; s.frogY = 0;
    s.leaping = false; s.onPad = true; s.currentPadId = 0;
    s.gameSpeed = 0.02; s.nextPadId = 1; s.scrollX = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0c3547);
    renderer.shadowMap.enabled = true;
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0c3547, 12, 30);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 4, 6);
    camera.lookAt(0, 0, -2);

    scene.add(new THREE.AmbientLight(0x4ade80, 0.4));
    scene.add(new THREE.AmbientLight(0x0d4f2e, 0.6));
    const sun = new THREE.DirectionalLight(0x4ade80, 1.2);
    sun.position.set(5, 10, 5);
    scene.add(sun);
    const frogLight = new THREE.PointLight(0x22c55e, 2, 5);
    frogLight.position.set(0, 1, 0);
    scene.add(frogLight);

    // Water plane
    const waterGeo = new THREE.PlaneGeometry(30, 30);
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x0c3547, emissive: 0x06b6d4, emissiveIntensity: 0.08, roughness: 0.2, metalness: 0.4 });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.05;
    scene.add(water);

    // Sky gradient background via fog color
    scene.background = new THREE.Color(0x0d4f2e);

    // Frog (simple capsule-like shape)
    const frogGeo = new THREE.SphereGeometry(0.28, 12, 10);
    const frogMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x16a34a, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0.2 });
    const frog = new THREE.Mesh(frogGeo, frogMat);
    frog.scale.set(1, 0.75, 1);
    scene.add(frog);

    // Initial pads
    const pads: LilyPad3D[] = [];
    pads.push(makePad(0, 0, 0, scene));
    for (let i = 1; i <= 5; i++) {
      const x = i * 2.2 + (Math.random() - 0.5) * 0.6;
      const z = (Math.random() - 0.5) * 3;
      pads.push(makePad(s.nextPadId++, x, z, scene));
    }
    frog.position.set(0, 0.32, 0);

    const splashParticles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }> = [];
    const obj = { renderer, scene, camera, frog, frogLight, pads, water, splashParticles, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.gameSpeed = Math.min(0.05, 0.02 + s.sig.successfulLeaps * 0.001);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const GRAVITY = -0.018;
    const t0 = Date.now();

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      const t = (Date.now() - t0) * 0.001;

      // Scroll pads left
      for (const pad of pads) {
        pad.x -= s.gameSpeed;
        pad.mesh.position.x = pad.x;
        if (pad.sinking) {
          pad.sinkTimer++;
          pad.mesh.position.y = 0.04 - pad.sinkTimer * 0.008;
          (pad.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - pad.sinkTimer / 40);
          (pad.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        }
      }
      if (s.onPad) s.frogX -= s.gameSpeed;

      // Spawn new pads
      const lastPad = pads[pads.length - 1];
      if (lastPad && lastPad.x < 5) {
        const newX = lastPad.x + 1.8 + Math.random() * 1;
        const newZ = (Math.random() - 0.5) * 3;
        pads.push(makePad(s.nextPadId++, newX, newZ, scene));
      }

      // Remove old pads
      for (let i = pads.length - 1; i >= 0; i--) {
        if (pads[i].x < -6 || (pads[i].sinking && pads[i].sinkTimer > 45)) {
          scene.remove(pads[i].mesh);
          pads.splice(i, 1);
        }
      }

      // Frog physics (leaping)
      if (s.leaping) {
        s.frogVY += GRAVITY;
        s.frogX += s.frogVX;
        s.frogY += s.frogVY;
        s.frogZ += s.frogVZ;
        frog.position.set(s.frogX, s.frogY + 0.32, s.frogZ);

        // Check landing
        if (s.frogVY < 0 && s.frogY <= 0) {
          let landed = false;
          for (const pad of pads) {
            if (!pad.sinking && Math.hypot(s.frogX - pad.x, s.frogZ - pad.z) < 0.65) {
              s.frogX = pad.x; s.frogZ = pad.z; s.frogY = 0;
              s.frogVX = 0; s.frogVY = 0; s.frogVZ = 0;
              s.leaping = false; s.onPad = true; s.currentPadId = pad.id;
              s.sig.successfulLeaps++;
              s.sig.streakCurrent++;
              if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
              const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
              s.sig.score += pts;
              setScoreDisplay(s.sig.score);
              sfx.collect(); haptic([30]);
              setTimeout(() => { pad.sinking = true; }, 800);
              landed = true; break;
            }
          }
          if (!landed) {
            s.leaping = false; s.onPad = false;
            s.sig.splashes++; s.sig.streakCurrent = 0;
            sfx.fail(); haptic([20, 30, 20]);
            // Splash particles
            for (let i = 0; i < 8; i++) {
              const spGeo = new THREE.SphereGeometry(0.06, 6, 6);
              const spMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.9 });
              const sp = new THREE.Mesh(spGeo, spMat);
              sp.position.set(s.frogX, 0, s.frogZ);
              scene.add(sp);
              const angle = (i / 8) * Math.PI * 2;
              splashParticles.push({ mesh: sp, vx: Math.cos(angle) * 0.06, vy: 0.12, vz: Math.sin(angle) * 0.06, life: 1 });
            }
            // Respawn on nearest visible pad
            const validPads = pads.filter(p => !p.sinking && p.x > -3 && p.x < 5);
            if (validPads.length > 0) {
              const nearest = validPads.reduce((best, c) => Math.abs(c.x) < Math.abs(best.x) ? c : best);
              setTimeout(() => {
                if (!s.running) return;
                s.frogX = nearest.x; s.frogZ = nearest.z; s.frogY = 0;
                s.onPad = true; s.currentPadId = nearest.id;
              }, 600);
            }
          }
        }
      }

      // Splash particles update
      for (let i = splashParticles.length - 1; i >= 0; i--) {
        const sp = splashParticles[i];
        sp.mesh.position.x += sp.vx; sp.mesh.position.y += sp.vy; sp.mesh.position.z += sp.vz;
        sp.vy -= 0.008; sp.life -= 0.04;
        (sp.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, sp.life);
        if (sp.life <= 0) { scene.remove(sp.mesh); splashParticles.splice(i, 1); }
      }

      // Update frog position when on pad
      if (s.onPad && !s.leaping) {
        frog.position.set(s.frogX, s.frogY + 0.32, s.frogZ);
        frog.rotation.y = t * 0.5;
      }
      frogLight.position.set(s.frogX, s.frogY + 0.5, s.frogZ);

      // Water animation
      water.position.y = -0.05 + Math.sin(t * 1.5) * 0.015;
      (water.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05 + Math.sin(t * 2) * 0.03;

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, makePad]);

  const doLeap = useCallback((direction: 'left' | 'right') => {
    const s = stateRef.current;
    if (!s.running || s.leaping) return;
    const t = threeRef.current; if (!t) return;

    const { pads } = t;
    const candidates = pads.filter(p => {
      if (p.id === s.currentPadId || p.sinking) return false;
      return direction === 'right' ? p.x > s.frogX : p.x < s.frogX;
    });
    if (candidates.length === 0) return;
    const target = candidates.reduce((best, c) =>
      Math.abs(c.x - s.frogX) < Math.abs(best.x - s.frogX) ? c : best
    );

    s.sig.totalLeaps++;
    s.leaping = true; s.onPad = false;
    const dx = target.x - s.frogX;
    const dz = target.z - s.frogZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    s.frogVX = dx * 0.08;
    s.frogVZ = dz * 0.08;
    s.frogVY = 0.18 + Math.min(dist * 0.03, 0.1);
    sfx.click?.(); haptic([20]);
  }, []);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTap = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const dir = x < rect.width / 2 ? 'left' : 'right';
      doLeap(dir);
    };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase, doLeap]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);
  const buildInsights = (sig: Signals) => {
    const acc = sig.totalLeaps > 0 ? Math.round((sig.successfulLeaps / sig.totalLeaps) * 100) : 0;
    return [
      { label: 'Landing Rate', value: `${acc}%`, color: acc >= 75 ? '#4ade80' : '#facc15' },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
      { label: 'Leaps Made', value: `${sig.successfulLeaps}`, color: ACCENT },
      { label: 'Splashes', value: `${sig.splashes}`, color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Hop In" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.successfulLeaps >= 10} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    const acc = sig.totalLeaps > 0 ? sig.successfulLeaps / sig.totalLeaps : 0;
    postWebhook(theme, gameId, { personality, score: sig.score, landingRate: parseFloat(acc.toFixed(3)), successfulLeaps: sig.successfulLeaps, splashes: sig.splashes, maxStreak: sig.maxStreak }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
