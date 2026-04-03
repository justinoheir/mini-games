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
import { createTiltController } from '@/lib/tilt';

const GAME_ID = 'egg-toss';
const ACCENT = '#fde68a';
const DURATION = 45;
const GAME_EMOJI = '🥚';
const GAME_TITLE = 'Egg Toss';
const GAME_TAGLINE = "Toss it. Catch it. Don't crack it!";

interface Signals { score: number; hits: number; attempts: number; reactionTimes: number[]; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  if (acc >= 0.8 && sig.maxStreak >= 5) return '🥚 Egg Champion';
  if (acc >= 0.65) return '🤲 Gentle Catcher';
  if (sig.maxStreak >= 4) return '🔥 Streak Keeper';
  return '💥 Egg-sploder';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
type EggState = 'idle' | 'flying' | 'catching' | 'cracking';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  eggState: EggState; eggT: number; eggSpeed: number;
  sx: number; sy: number; ex: number; ey: number; arcH: number;
  catcherX: number; tiltX: number; throwTime: number;
}

export default function EggTossGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltCtrlRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const catcherXRef = useRef(0.0);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 },
    eggState: 'idle', eggT: 0, eggSpeed: 0.009,
    sx: -2.5, sy: -0.5, ex: 2.5, ey: -0.5, arcH: 3.5,
    catcherX: 2.5, tiltX: 0, throwTime: 0,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    egg: THREE.Mesh; eggLight: THREE.PointLight;
    thrower: THREE.Group; catcher: THREE.Group;
    particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; life: number }>;
    animId: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const nextThrow = useCallback(() => {
    const s = stateRef.current;
    s.eggState = 'flying'; s.eggT = 0;
    s.eggSpeed = 0.007 + Math.min(s.sig.hits * 0.0003, 0.008) + Math.random() * 0.003;
    s.sx = -2.8 + Math.random() * 0.4;
    s.ex = 2.0 + Math.random() * 1.2;
    s.arcH = 2.8 + Math.random() * 1.5;
    s.throwTime = Date.now(); s.sig.attempts++;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (tiltCtrlRef.current) { tiltCtrlRef.current.stop(); tiltCtrlRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.eggState = 'idle';
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    catcherXRef.current = 0.0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('holiday');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a1207);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1207);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const yLight = new THREE.PointLight(0xfde68a, 2, 15);
    yLight.position.set(0, 5, 5);
    scene.add(yLight);
    const eggLight = new THREE.PointLight(0xfde68a, 1.5, 4);
    scene.add(eggLight);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(20, 4);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a3010, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -2;
    scene.add(ground);

    // Stars
    const starPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) { starPos[i*3] = (Math.random()-0.5)*30; starPos[i*3+1] = (Math.random()-0.5)*20; starPos[i*3+2] = -5 - Math.random()*15; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfde68a, size: 0.05, transparent: true, opacity: 0.4 })));

    // Thrower (left figure)
    const throwerGroup = new THREE.Group();
    const throwerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1, 10), new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6 }));
    const throwerHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfdbcb4, roughness: 0.7 }));
    throwerHead.position.y = 0.65;
    throwerGroup.add(throwerBody, throwerHead);
    throwerGroup.position.set(-3, -0.8, 0);
    scene.add(throwerGroup);

    // Catcher (right figure)
    const catcherGroup = new THREE.Group();
    const catcherBody = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1, 10), new THREE.MeshStandardMaterial({ color: 0xec4899, roughness: 0.6 }));
    const catcherHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfdbcb4, roughness: 0.7 }));
    catcherHead.position.y = 0.65;
    // Arms
    const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6);
    const armMat = new THREE.MeshStandardMaterial({ color: 0xfdbcb4 });
    const armL = new THREE.Mesh(armGeo, armMat); armL.rotation.z = Math.PI/3; armL.position.set(-0.35, 0.2, 0); catcherGroup.add(armL);
    const armR = new THREE.Mesh(armGeo, armMat); armR.rotation.z = -Math.PI/3; armR.position.set(0.35, 0.2, 0); catcherGroup.add(armR);
    catcherGroup.add(catcherBody, catcherHead);
    catcherGroup.position.set(2.5, -0.8, 0);
    scene.add(catcherGroup);

    // Egg
    const eggGeo = new THREE.SphereGeometry(0.28, 14, 12);
    eggGeo.scale(1, 1.3, 1);
    const eggMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, emissive: 0xfde68a, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.1 });
    const egg = new THREE.Mesh(eggGeo, eggMat);
    egg.position.set(s.sx, s.sy, 0);
    scene.add(egg);

    const particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; life: number }> = [];
    const obj = { renderer, scene, camera, egg, eggLight, thrower: throwerGroup, catcher: catcherGroup, particles, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); haptic([100]); endGame(); }
    }, 1000);

    const tiltCtrl = createTiltController((x) => { catcherXRef.current = x * 0.3; }, { sensitivity: 0.9, clamp: 28, smoothing: 0.45 });
    tiltCtrl.start(); tiltCtrlRef.current = tiltCtrl;
    setTimeout(() => nextThrow(), 600);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      const t0 = Date.now() * 0.001;

      // Move catcher
      catcherGroup.position.x += (catcherXRef.current - catcherGroup.position.x) * 0.12;
      catcherGroup.position.x = Math.max(-0.5, Math.min(4.5, catcherGroup.position.x));
      catcherGroup.rotation.z = Math.sin(t0 * 1.5) * 0.05;

      // Egg arc
      if (s.eggState === 'flying') {
        s.eggT += s.eggSpeed;
        const t = s.eggT;
        const eggX = s.sx + (s.ex - s.sx) * t;
        const eggY = s.sy + (s.ey - s.sy) * t + s.arcH * (4 * t * (1 - t) - 1) * (-1);
        // Parabola: y = sy*(1-t) + ey*t + arcH * sin(pi*t)
        const arcY = s.sy * (1-t) + s.ey * t + s.arcH * Math.sin(Math.PI * t);
        egg.position.set(eggX, arcY, 0);
        egg.rotation.z += 0.04;
        eggLight.position.set(eggX, arcY, 1);

        if (s.eggT >= 1.0) {
          // Check catch
          const catchDist = Math.abs(eggX - catcherGroup.position.x);
          if (catchDist < 0.9) {
            s.sig.hits++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts;
            setScoreDisplay(s.sig.score);
            s.sig.reactionTimes.push(Date.now() - s.throwTime);
            sfx.collect?.(); haptic([30]);
            // Catch sparkle
            for (let p = 0; p < 5; p++) {
              const pMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.9 }));
              pMesh.position.set(eggX, arcY, 0);
              scene.add(pMesh);
              const angle = (p / 5) * Math.PI * 2;
              particles.push({ mesh: pMesh, vx: Math.cos(angle)*0.06, vy: Math.abs(Math.sin(angle))*0.07+0.02, life: 1 });
            }
          } else {
            s.sig.streakCurrent = 0;
            sfx.fail?.(); haptic([20, 30]);
            // Crack effect
            for (let p = 0; p < 8; p++) {
              const pMesh = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 5), new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.8 }));
              pMesh.position.set(eggX, arcY, 0);
              scene.add(pMesh);
              const angle = (p / 8) * Math.PI * 2;
              particles.push({ mesh: pMesh, vx: Math.cos(angle)*0.1, vy: Math.sin(angle)*0.1, life: 1 });
            }
          }
          egg.position.set(-99, -99, 0);
          s.eggState = 'idle';
          setTimeout(() => { if (s.running) nextThrow(); }, 700);
        }
      }

      // Thrower animation
      throwerGroup.rotation.z = s.eggState === 'flying' ? Math.sin(t0 * 3) * 0.06 : 0;

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy;
        p.vy -= 0.005; p.life -= 0.04;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life);
        if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, nextThrow]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (tiltCtrlRef.current) tiltCtrlRef.current.stop();
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);
  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits/sig.attempts)*100) : 0;
    return [
      { label: 'Catch Rate', value: `${acc}%`, color: acc >= 70 ? '#4ade80' : '#facc15' },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
      { label: 'Catches', value: String(sig.hits), color: ACCENT },
      { label: 'Misses', value: String(sig.attempts - sig.hits), color: '#ef4444' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Motion & Toss" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} sensorNote="Tilt to move the catcher" />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 10} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
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
