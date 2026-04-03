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

const GAME_ID = 'spring-leap';
const ACCENT = '#4ade80';
const DURATION = 45;
const GAME_EMOJI = '🌱';
const GAME_TITLE = 'Spring Leap';
const GAME_TAGLINE = 'Hold to charge. Release to fly.';
const GRAVITY = -0.015;
const GROUND_Y = -2.5;

interface Platform { x: number; y: number; w: number; color: number; bonus: boolean; scored: boolean; mesh: THREE.Mesh; light: THREE.PointLight; }
interface Signals { totalLeaps: number; landings: number; perfectLandings: number; missedLandings: number; maxHeight: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalLeaps > 0 ? sig.landings / sig.totalLeaps : 0;
  if (acc >= 0.85 && sig.perfectLandings >= 4) return 'Spring Master 🌱';
  if (sig.maxHeight >= 8) return 'High Flyer 🦅';
  if (sig.maxStreak >= 5) return 'Bouncing Beast 🐸';
  if (acc >= 0.6) return 'Good Jumper 🦘';
  return 'Still Bouncing 🌀';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function SpringLeapGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    playerMesh: null as THREE.Mesh | null,
    playerLight: null as THREE.PointLight | null,
    chargeRing: null as THREE.Mesh | null,
    platforms: [] as Platform[],
    running: false, timeLeft: DURATION,
    sig: { totalLeaps: 0, landings: 0, perfectLandings: 0, missedLandings: 0, maxHeight: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    playerX: 0, playerY: GROUND_Y, playerVX: 0, playerVY: 0,
    onGround: true, onPlatform: false, charging: false, chargeLevel: 0, chargeStart: 0,
    cameraOffset: 0, cameraTarget: 0,
    particlePool: [] as { mesh: THREE.Mesh; vx: number; vy: number; life: number }[],
    spawnZ: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalLeaps: 0, landings: 0, perfectLandings: 0, missedLandings: 0, maxHeight: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.playerX = 0; s.playerY = GROUND_Y; s.playerVX = 0; s.playerVY = 0;
    s.onGround = true; s.onPlatform = false; s.charging = false; s.chargeLevel = 0;
    s.cameraOffset = 0; s.cameraTarget = 0; s.platforms = []; s.particlePool = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a1a, 15, 30);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a0a1a, 3));
    const mainLight = new THREE.PointLight(0x4ade80, 2, 20);
    mainLight.position.set(0, 5, 3);
    scene.add(mainLight);
    const playerLight = new THREE.PointLight(0x4ade80, 3, 6);
    scene.add(playerLight);
    s.playerLight = playerLight;

    // Stars
    const sp = new Float32Array(300*3);
    for (let i=0;i<300;i++){sp[i*3]=(Math.random()-.5)*50;sp[i*3+1]=(Math.random()-.5)*50;sp[i*3+2]=(Math.random()-.5)*50;}
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.05})));

    // Ground
    const groundGeo = new THREE.PlaneGeometry(20, 0.2);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a2e1a, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    scene.add(ground);

    // Player cube
    const playerGeo = new THREE.BoxGeometry(0.4, 0.5, 0.4);
    const playerMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.3, roughness: 0.3 });
    const playerMesh = new THREE.Mesh(playerGeo, playerMat);
    playerMesh.position.set(0, GROUND_Y + 0.25, 0);
    scene.add(playerMesh);
    s.playerMesh = playerMesh;

    // Charge ring
    const chargeRingGeo = new THREE.TorusGeometry(0.35, 0.04, 6, 24);
    const chargeRingMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0, transparent: true, opacity: 0 });
    const chargeRing = new THREE.Mesh(chargeRingGeo, chargeRingMat);
    chargeRing.rotation.x = Math.PI / 2;
    scene.add(chargeRing);
    s.chargeRing = chargeRing;

    // Spawn initial platforms
    const platColors = [0x4ade80, 0x22c55e, 0x34d399, 0xa855f7, 0x06b6d4];
    for (let i = 0; i < 6; i++) {
      const x = (Math.random() - 0.5) * 6;
      const y = GROUND_Y + 1.5 + i * 1.8 + Math.random() * 0.8;
      const w = 0.8 + Math.random() * 0.8;
      const color = platColors[Math.floor(Math.random() * platColors.length)];
      const bonus = Math.random() < 0.2;
      const platGeo = new THREE.BoxGeometry(w, 0.18, 0.5);
      const platMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: bonus ? 0.5 : 0.1, roughness: 0.4 });
      const mesh = new THREE.Mesh(platGeo, platMat);
      mesh.position.set(x, y, 0);
      scene.add(mesh);
      const pLight = new THREE.PointLight(color, 1, 3);
      pLight.position.set(x, y + 0.5, 0.3);
      scene.add(pLight);
      s.platforms.push({ x, y, w, color, bonus, scored: false, mesh, light: pLight });
    }

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 10 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const spawnParticles = (x: number, y: number, color: number) => {
      for (let i = 0; i < 8; i++) {
        const geo = new THREE.SphereGeometry(0.06, 4, 4);
        const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, 0);
        scene.add(mesh);
        const angle = Math.random() * Math.PI * 2;
        s.particlePool.push({ mesh, vx: Math.cos(angle) * 0.08, vy: 0.05 + Math.random() * 0.08, life: 20 });
      }
    };

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;

      // Charge ring
      if (s.charging) {
        s.chargeLevel = Math.min(1, (Date.now() - s.chargeStart) / 800);
        const mat = chargeRing.material as THREE.MeshStandardMaterial;
        mat.opacity = s.chargeLevel * 0.8;
        mat.emissiveIntensity = s.chargeLevel * 1.5;
        chargeRing.scale.setScalar(1 + s.chargeLevel * 0.5);
        chargeRing.position.set(s.playerX, s.playerY - 0.25, 0);
      } else {
        (chargeRing.material as THREE.MeshStandardMaterial).opacity = 0;
      }

      // Physics
      if (!s.onGround && !s.onPlatform) {
        s.playerVY += GRAVITY;
        s.playerX += s.playerVX;
        s.playerY += s.playerVY;
        // Max height
        if (s.playerY > s.sig.maxHeight) s.sig.maxHeight = s.playerY;
        // Ground landing
        if (s.playerY <= GROUND_Y) {
          s.playerY = GROUND_Y; s.playerVX = 0; s.playerVY = 0;
          s.onGround = true;
          s.sig.missedLandings++; s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
        }
        // Platform landing
        for (const plat of s.platforms) {
          if (!plat.scored && s.playerVY < 0 && Math.abs(s.playerX - plat.x) < plat.w / 2 + 0.2) {
            if (s.playerY >= plat.y - 0.05 && s.playerY <= plat.y + 0.4) {
              s.playerY = plat.y + 0.28; s.playerVX = 0; s.playerVY = 0;
              s.onPlatform = true; s.onGround = false;
              const isPerfect = Math.abs(s.playerX - plat.x) < plat.w * 0.2;
              s.sig.landings++;
              if (isPerfect) s.sig.perfectLandings++;
              s.sig.streakCurrent++;
              if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
              const pts = (plat.bonus ? 4 : 2) + (isPerfect ? 1 : 0) + Math.floor(s.sig.streakCurrent / 3);
              s.sig.score += pts; setScoreDisplay(s.sig.score);
              plat.scored = true;
              sfx.collect(); hapticScore();
              spawnParticles(s.playerX, s.playerY, plat.color);
              // Camera follow
              s.cameraTarget = Math.max(0, s.playerY - 1);
              break;
            }
          }
        }
      }

      // Camera follow
      s.cameraOffset += (s.cameraTarget - s.cameraOffset) * 0.05;
      camera.position.y = s.cameraOffset;
      camera.lookAt(0, s.cameraOffset, 0);
      ground.position.y = GROUND_Y;

      // Player mesh
      playerMesh.position.set(s.playerX, s.playerY + 0.25, 0);
      playerMesh.rotation.z = s.playerVX * 5;
      playerLight.position.set(s.playerX, s.playerY + 0.5, 0.5);
      const playerMat2 = playerMesh.material as THREE.MeshStandardMaterial;
      playerMat2.emissiveIntensity = s.charging ? 0.5 + s.chargeLevel : 0.2;

      // Particles
      for (let pi = s.particlePool.length - 1; pi >= 0; pi--) {
        const p = s.particlePool[pi];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.vy += GRAVITY * 0.5;
        p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life / 20;
        if (p.life <= 0) { scene.remove(p.mesh); s.particlePool.splice(pi, 1); }
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    // Input
    const onDown = () => {
      const s2 = stateRef.current;
      if (!s2.running || (!s2.onGround && !s2.onPlatform)) return;
      s2.charging = true; s2.chargeStart = Date.now();
    };
    const onUp = () => {
      const s2 = stateRef.current;
      if (!s2.running || !s2.charging) return;
      s2.charging = false;
      s2.chargeLevel = Math.min(1, (Date.now() - s2.chargeStart) / 800);
      const jumpPower = 0.12 + s2.chargeLevel * 0.2;
      const nextPlat = s2.platforms.find(p => !p.scored && p.y > s2.playerY);
      const targetX = nextPlat ? nextPlat.x + (Math.random() - 0.5) * 0.5 : (Math.random() - 0.5) * 4;
      const dx = targetX - s2.playerX;
      s2.playerVX = dx * 0.04;
      s2.playerVY = jumpPower;
      s2.onGround = false; s2.onPlatform = false;
      s2.sig.totalLeaps++;
      sfx.collect(); hapticImpact?.();
    };
    if (mountRef.current) {
      mountRef.current.addEventListener('pointerdown', onDown);
      mountRef.current.addEventListener('pointerup', onUp);
    }
    (s as any)._inputCleanup = () => {
      mountRef.current?.removeEventListener('pointerdown', onDown);
      mountRef.current?.removeEventListener('pointerup', onUp);
    };
  }, [endGame]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    (s as any)._cleanup?.(); (s as any)._inputCleanup?.();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #0a0a1a 0%, #050510 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Leap! 🌱" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Landings', value: String(finalSig.landings), color: accent },
            { label: 'Perfects', value: String(finalSig.perfectLandings), color: '#fbbf24' },
            { label: 'Max Height', value: `${finalSig.maxHeight.toFixed(1)}`, color: '#06b6d4' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#a855f7' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.landings >= 8} />
      )}
    </GameShell>
  );
}
