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

const GAME_ID    = 'pixel-skate';
const ACCENT     = '#10b981';
const DURATION   = 45;
const GAME_EMOJI = '🛹';
const GAME_TITLE = 'Pixel Skate';
const GAME_TAGLINE = 'Flick tricks. Stack the combo.';

type TrickInput = 'up' | 'down' | 'left' | 'right';
const TRICKS: Record<TrickInput, { name: string; pts: number }> = {
  up: { name: 'Kickflip', pts: 2 }, down: { name: 'Grind', pts: 3 },
  left: { name: 'Heelflip', pts: 2 }, right: { name: '360 Flip', pts: 4 },
};

interface Signals { tricksLanded: number; crashes: number; maxCombo: number; comboCurrent: number; totalPoints: number; score: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(s: Signals): string {
  if (s.tricksLanded >= 20 && s.crashes === 0) return 'Pro Skater 🏆';
  if (s.maxCombo >= 8) return 'Combo God 🔥';
  if (s.crashes >= 6) return 'Wipeout King 💥';
  if (s.tricksLanded >= 12) return 'Street Shredder 🛹';
  return 'Park Learner 🎿';
}

interface Obstacle3D { mesh: THREE.Mesh; type: string; passed: boolean; }
interface Particle3D { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; }

export default function PixelSkateGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const skaterRef = useRef<THREE.Group | null>(null);
  const obstaclesRef = useRef<Obstacle3D[]>([]);
  const particlesRef = useRef<Particle3D[]>([]);
  const trickTextRef = useRef<{ text: string; alpha: number } | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { tricksLanded: 0, crashes: 0, maxCombo: 0, comboCurrent: 0, totalPoints: 0, score: 0 } as Signals,
    skaterY: 0, baseY: -0.5, jumping: false, jumpVY: 0,
    speed: 0.05, obsTimer: 0, crashed: false, crashTimer: 0, frame: 0,
    swipeStartX: 0, swipeStartY: 0, swipeStartTime: 0, isSwiping: false,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [trickDisplay, setTrickDisplay] = useState('');
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    hapticVictory();
    try { const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0'); if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const performTrick = useCallback((dir: TrickInput) => {
    const s = stateRef.current;
    if (!s.running || s.crashed) return;
    const trick = TRICKS[dir];
    if (!s.jumping) { s.jumping = true; s.jumpVY = dir === 'down' ? 0.12 : 0.15; }
    s.sig.tricksLanded++; s.sig.comboCurrent++;
    if (s.sig.comboCurrent > s.sig.maxCombo) s.sig.maxCombo = s.sig.comboCurrent;
    const mult = Math.ceil(s.sig.comboCurrent / 3);
    const pts = trick.pts * mult; s.sig.score += pts; s.sig.totalPoints += pts;
    setScoreDisplay(s.sig.score);
    setTrickDisplay(`${trick.name} +${pts}`);
    setTimeout(() => setTrickDisplay(''), 900);
    sfx.collect();
    if (s.sig.comboCurrent >= 4) hapticCombo(s.sig.comboCurrent); else hapticScore();
    // Spawn particles
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.SphereGeometry(0.06, 6, 6);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x0a5a3a }));
      mesh.position.set(-2, s.baseY + s.skaterY, 0);
      sceneRef.current?.add(mesh);
      particlesRef.current.push({ mesh, vx: (Math.random()-0.5)*0.1, vy: 0.05+Math.random()*0.08, vz: (Math.random()-0.5)*0.08, life: 1 });
    }
  }, []);

  const makeObstacle = useCallback((type: string, scene: THREE.Scene, x: number): Obstacle3D => {
    const s = stateRef.current;
    let mesh: THREE.Mesh;
    const mat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x5f1a1a, roughness: 0.6 });
    switch (type) {
      case 'cone':
        mesh = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 6), mat);
        mesh.position.set(x, s.baseY + 0.3, 0); break;
      case 'rail':
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x94a3b8, emissive: 0x2a3a4a, metalness: 0.8 }));
        mesh.position.set(x, s.baseY + 0.35, 0); break;
      case 'ramp':
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.4, 0.6, 4), mat);
        mesh.position.set(x, s.baseY + 0.3, 0); break;
      default:
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), mat);
        mesh.position.set(x, s.baseY + 0.25, 0);
    }
    scene.add(mesh);
    return { mesh, type, passed: false };
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { tricksLanded: 0, crashes: 0, maxCombo: 0, comboCurrent: 0, totalPoints: 0, score: 0 };
    s.speed = 0.05; s.obsTimer = 0; s.skaterY = 0; s.jumping = false; s.crashed = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1218);
    scene.fog = new THREE.Fog(0x0a1218, 15, 30);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 60);
    camera.position.set(0, 2, 7);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x0a1a10, 2));
    scene.add(Object.assign(new THREE.PointLight(0x10b981, 60, 20), { position: new THREE.Vector3(-2, 4, 6) }));
    scene.add(Object.assign(new THREE.PointLight(0x6366f1, 40, 15), { position: new THREE.Vector3(3, 2, 5) }));

    // Infinite ground strip
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a2830, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, 20), groundMat);
      g.position.set(0, s.baseY - 0.05, -i * 20 + 10);
      g.receiveShadow = true;
      scene.add(g);
    }
    // Neon ground line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-10, s.baseY, 0), new THREE.Vector3(10, s.baseY, 0)]);
    scene.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x10b981 })));

    // Skater group
    const skater = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.25), new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x0a5a3a }));
    skater.add(board);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.22), new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0x4a2000 }));
    body.position.y = 0.32;
    skater.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), new THREE.MeshStandardMaterial({ color: 0xfbbf24 }));
    head.position.y = 0.65;
    skater.add(head);
    skater.position.set(-2, s.baseY, 0);
    skater.castShadow = true;
    scene.add(skater);
    skaterRef.current = skater;

    // Background buildings
    for (let i = 0; i < 6; i++) {
      const bh = 1.5 + Math.random() * 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, bh, 0.5), new THREE.MeshStandardMaterial({ color: 0x0a1820 }));
      b.position.set(-5 + i * 2.2, s.baseY + bh/2 - 0.05, -3);
      scene.add(b);
    }

    const onDown = (e: PointerEvent) => {
      if (!s.running) return;
      s.isSwiping = true; s.swipeStartX = e.clientX; s.swipeStartY = e.clientY; s.swipeStartTime = Date.now();
    };
    const onUp = (e: PointerEvent) => {
      if (!s.running || !s.isSwiping) return; s.isSwiping = false;
      const dx = e.clientX - s.swipeStartX; const dy = e.clientY - s.swipeStartY;
      const dist = Math.hypot(dx, dy);
      if (dist < 20) return;
      let dir: TrickInput;
      if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
      else dir = dy < 0 ? 'up' : 'down';
      performTrick(dir);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 30 || s.timeLeft === 15) s.speed += 0.015;
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      s.frame++;
      const GRAVITY = 0.008;

      if (!s.crashed) {
        if (s.jumping) {
          s.jumpVY -= GRAVITY; s.skaterY += s.jumpVY;
          if (s.skaterY <= 0) { s.skaterY = 0; s.jumping = false; s.jumpVY = 0; }
        }
      } else {
        s.crashTimer--; if (s.crashTimer <= 0) { s.crashed = false; s.skaterY = 0; }
      }

      if (skater) {
        skater.position.y = s.baseY + s.skaterY;
        skater.rotation.z = s.jumping ? -0.3 : Math.sin(s.frame * 0.2) * 0.03;
        if (s.crashed) skater.rotation.z = Math.PI / 2;
      }

      // Obstacle spawning
      s.obsTimer++;
      if (s.obsTimer >= 80) {
        s.obsTimer = 0;
        const types = ['cone', 'rail', 'ramp', 'cone'];
        const obs = makeObstacle(types[Math.floor(Math.random() * types.length)], scene, 6);
        obstaclesRef.current.push(obs);
      }

      // Move obstacles
      for (let i = obstaclesRef.current.length - 1; i >= 0; i--) {
        const obs = obstaclesRef.current[i];
        obs.mesh.position.x -= s.speed * 60 * (1/60); // consistent
        obs.mesh.position.x -= s.speed;
        if (obs.mesh.position.x < -8) { scene.remove(obs.mesh); obstaclesRef.current.splice(i, 1); continue; }
        // Collision
        const dx = Math.abs(obs.mesh.position.x - (-2));
        if (!obs.passed && !s.crashed && dx < 0.5) {
          const onGround = Math.abs(s.skaterY) < 0.1;
          if (obs.type !== 'rail' && onGround) {
            s.sig.crashes++; s.sig.comboCurrent = 0;
            s.crashed = true; s.crashTimer = 40;
            sfx.collision(); hapticFail();
          } else {
            obs.passed = true;
          }
        }
      }

      // Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.003; p.life -= 0.025;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life;
        (p.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        if (p.life <= 0.05) { scene.remove(p.mesh); particlesRef.current.splice(i, 1); }
      }

      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
    };
  }, [endGame, performTrick, makeObstacle]);

  useEffect(() => {
    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const W = window.innerWidth, H = window.innerHeight;
      cameraRef.current.aspect = W / H; cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(W, H);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    obstaclesRef.current = []; particlesRef.current = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setTrickDisplay('');
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.1) 0%, transparent 60%), linear-gradient(180deg, #0a1218 0%, #060c10 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Drop In 🛹" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={accent} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
                { label: 'SCORE', value: scoreDisplay, testId: 'score' },
              ]} />
              {trickDisplay && (
                <div style={{ position: 'absolute', top: '35%', left: '50%', transform: 'translateX(-50%)',
                  color: accent, fontSize: 'clamp(20px,5vw,32px)', fontWeight: 900, pointerEvents: 'none',
                  textShadow: `0 0 20px ${accent}` }}>
                  {trickDisplay}
                </div>
              )}
              <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)',
                color: 'rgba(255,255,255,0.35)', fontSize: 12, pointerEvents: 'none' }}>
                ↑ Kickflip · ↓ Grind · ← Heelflip · → 360 Flip
              </div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Tricks', value: `${finalSig.tricksLanded}`, color: '#4ade80' },
            { label: 'Crashes', value: `${finalSig.crashes}`, color: finalSig.crashes === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Max Combo', value: `×${finalSig.maxCombo}`, color: accent },
            { label: 'Trick Points', value: `${finalSig.totalPoints}`, color: '#fbbf24' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.tricksLanded >= 15} />
      )}
    </GameShell>
  );
}
