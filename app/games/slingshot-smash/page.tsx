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
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'slingshot-smash';
const ACCENT = '#f97316';
const DURATION = 45;
const GAME_EMOJI = '🪃';
const GAME_TITLE = 'Slingshot Smash';
const GAME_TAGLINE = 'Stretch it. Aim it. Smash it.';

interface Signals { totalShots: number; hits: number; misses: number; bullseyes: number; maxStreak: number; streakCurrent: number; maxPower: number; score: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalShots > 0 ? sig.hits / sig.totalShots : 0;
  if (acc >= 0.8 && sig.bullseyes >= 3) return 'Sharpshooter 🎯';
  if (sig.maxPower >= 20 && acc >= 0.6) return 'Power Sniper 💥';
  if (sig.maxStreak >= 4) return 'Combo Crusher 🔥';
  if (acc >= 0.5) return 'Reliable Slinger 🪃';
  return 'Wild Shooter 🎪';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function SlingshotSmash() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    ball: null as THREE.Mesh | null,
    ballLight: null as THREE.PointLight | null,
    targets: [] as { mesh: THREE.Mesh; light: THREE.PointLight; x: number; y: number; z: number; r: number; hp: number; maxHp: number; color: number; vx: number; vy: number; id: number }[],
    rubberLeft: null as THREE.Line | null,
    rubberRight: null as THREE.Line | null,
    running: false, timeLeft: DURATION,
    sig: { totalShots: 0, hits: 0, misses: 0, bullseyes: 0, maxStreak: 0, streakCurrent: 0, maxPower: 0, score: 0 } as Signals,
    anchorX: 0, anchorY: -1.5, anchorZ: 0,
    pullX: 0, pullY: 0, pullZ: 0,
    pulling: false, pointerId: null as number | null,
    ballX: 0, ballY: -1.2, ballZ: 0,
    ballVX: 0, ballVY: 0, ballVZ: 0,
    ballActive: false,
    gravity: -0.008,
    nextTargetId: 0, spawnTimer: 0,
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
    forky: null as THREE.Group | null,
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
    setFinalSig({ ...s.sig });
    setPhase('done');
    hapticVictory();
  }, []);

  const spawnTarget = useCallback((scene: THREE.Scene) => {
    const s = stateRef.current;
    const colors = [0xef4444, 0xfbbf24, 0xa855f7, 0x22c55e, 0x06b6d4];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const r = 0.2 + Math.random() * 0.3;
    const geo = new THREE.IcosahedronGeometry(r, 1);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    const x = (Math.random() * 2 - 1) * 4;
    const y = 0.5 + Math.random() * 2;
    const z = -4 - Math.random() * 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
    const light = new THREE.PointLight(color, 1.5, 4);
    light.position.set(x, y, z);
    scene.add(light);
    s.targets.push({ mesh, light, x, y, z, r, hp: 1, maxHp: 1, color, vx: (Math.random() - 0.5) * 0.02, vy: 0, id: s.nextTargetId++ });
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalShots: 0, hits: 0, misses: 0, bullseyes: 0, maxStreak: 0, streakCurrent: 0, maxPower: 0, score: 0 };
    s.targets = []; s.nextTargetId = 0; s.spawnTimer = 0; s.particles = [];
    s.ballActive = false; s.pulling = false; s.pointerId = null;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a1a, 20, 50);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0.5, 5);
    camera.lookAt(0, 0, -2);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a0a1a, 3));
    const mainLight = new THREE.PointLight(0xf97316, 2, 20);
    mainLight.position.set(0, 5, 0);
    scene.add(mainLight);
    const ballLight = new THREE.PointLight(0xfbbf24, 0, 8);
    scene.add(ballLight);
    s.ballLight = ballLight;

    // Stars
    const sp = new Float32Array(400*3);
    for (let i=0;i<400;i++){sp[i*3]=(Math.random()-.5)*50;sp[i*3+1]=(Math.random()-.5)*50;sp[i*3+2]=(Math.random()-.5)*50;}
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.05})));

    // Slingshot Y-fork
    const forky = new THREE.Group();
    const forkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
    // Handle
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.2, 6), forkMat);
    handle.position.y = -0.9;
    forky.add(handle);
    // Left prong
    const lProng = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), forkMat);
    lProng.position.set(-0.35, -0.15, 0);
    lProng.rotation.z = -0.35;
    forky.add(lProng);
    // Right prong
    const rProng = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), forkMat);
    rProng.position.set(0.35, -0.15, 0);
    rProng.rotation.z = 0.35;
    forky.add(rProng);
    forky.position.set(0, -1.5, 0);
    scene.add(forky);
    s.forky = forky;

    // Rubber bands (lines from fork tips to ball)
    const lBandGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.25, -0.9, 0), new THREE.Vector3(0, -1.2, 0)]);
    const rubberMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 });
    const rubberLeft = new THREE.Line(lBandGeo, rubberMat.clone());
    scene.add(rubberLeft);
    s.rubberLeft = rubberLeft;
    const rBandGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.25, -0.9, 0), new THREE.Vector3(0, -1.2, 0)]);
    const rubberRight = new THREE.Line(rBandGeo, rubberMat.clone());
    scene.add(rubberRight);
    s.rubberRight = rubberRight;

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.15, 12, 12);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4, emissive: 0xf97316, emissiveIntensity: 0.2 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.set(0, -1.2, 0);
    scene.add(ball);
    s.ball = ball;

    // Spawn initial targets
    for (let i = 0; i < 3; i++) spawnTarget(scene);

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;
      s.spawnTimer++;
      if (s.spawnTimer % 80 === 0 && s.targets.length < 6) spawnTarget(scene);

      // Ball physics
      if (s.ballActive) {
        s.ballX += s.ballVX; s.ballY += s.ballVY; s.ballZ += s.ballVZ;
        s.ballVY += s.gravity;
        ball.position.set(s.ballX, s.ballY, s.ballZ);
        ballLight.position.set(s.ballX, s.ballY, s.ballZ);
        ballLight.intensity = 2;
        // Check hits
        for (let ti = s.targets.length - 1; ti >= 0; ti--) {
          const tgt = s.targets[ti];
          const dx = s.ballX - tgt.x; const dy = s.ballY - tgt.y; const dz = s.ballZ - tgt.z;
          const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
          if (dist < tgt.r + 0.18) {
            // Hit!
            s.sig.hits++; s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const isBullseye = dist < tgt.r * 0.4;
            if (isBullseye) s.sig.bullseyes++;
            const pts = isBullseye ? 3 : 1 + Math.floor(s.sig.streakCurrent / 3);
            s.sig.score += pts; setScoreDisplay(s.sig.score);
            sfx.success(); hapticScore();
            // Burst particles
            for (let pi = 0; pi < 10; pi++) {
              const pGeo = new THREE.SphereGeometry(0.06, 4, 4);
              const pMat = new THREE.MeshStandardMaterial({ color: tgt.color, transparent: true, opacity: 1 });
              const pMesh = new THREE.Mesh(pGeo, pMat);
              pMesh.position.copy(tgt.mesh.position);
              scene.add(pMesh);
              const angle = Math.random() * Math.PI * 2;
              const elev = (Math.random() - 0.5) * Math.PI;
              s.particles.push({ mesh: pMesh, vx: Math.cos(angle)*Math.cos(elev)*0.12, vy: Math.sin(elev)*0.12, vz: Math.sin(angle)*0.1, life: 25 });
            }
            // Remove target
            scene.remove(tgt.mesh); scene.remove(tgt.light);
            s.targets.splice(ti, 1);
            // Reset ball
            s.ballActive = false;
            s.ballX = s.anchorX; s.ballY = s.anchorY - 0.3; s.ballZ = s.anchorZ;
            ball.position.set(s.ballX, s.ballY, s.ballZ);
            break;
          }
        }
        // Miss (out of range)
        if (s.ballZ < -10 || Math.abs(s.ballX) > 8 || s.ballY < -4) {
          s.ballActive = false; s.sig.misses++; s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          s.ballX = 0; s.ballY = -1.2; s.ballZ = 0;
          ball.position.set(0, -1.2, 0);
        }
        // Update rubber bands (retract during flight)
        updateBands(lBandGeo, rBandGeo, ball.position, { x: -0.25, y: -0.9+s.forky!.position.y, z: 0 }, { x: 0.25, y: -0.9+s.forky!.position.y, z: 0 });
      } else if (s.pulling) {
        // Update ball to follow finger pull
        ball.position.set(s.pullX * 0.5, s.anchorY - 0.3 - s.pullY * 0.2, s.pullZ * 0.1);
        ballLight.position.copy(ball.position);
        ballLight.intensity = 1;
        updateBands(lBandGeo, rBandGeo, ball.position, { x: -0.25, y: -0.9+s.forky!.position.y, z: 0 }, { x: 0.25, y: -0.9+s.forky!.position.y, z: 0 });
      } else {
        // Idle: ball in cradle
        ball.position.set(0, -1.2 + Math.sin(t * 2) * 0.03, 0);
        ballLight.intensity = 0.3;
        updateBands(lBandGeo, rBandGeo, ball.position, { x: -0.25, y: -0.9+s.forky!.position.y, z: 0 }, { x: 0.25, y: -0.9+s.forky!.position.y, z: 0 });
      }

      // Targets float
      s.targets.forEach(tgt => {
        tgt.x += tgt.vx;
        if (Math.abs(tgt.x) > 4.5) tgt.vx *= -1;
        tgt.mesh.position.x = tgt.x;
        tgt.light.position.x = tgt.x;
        tgt.mesh.rotation.x = t * 0.5; tgt.mesh.rotation.y = t * 0.7;
      });

      // Particles
      for (let pi = s.particles.length - 1; pi >= 0; pi--) {
        const p = s.particles[pi];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy += s.gravity * 0.5; p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life / 25;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(pi, 1); }
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    function updateBands(lGeo: THREE.BufferGeometry, rGeo: THREE.BufferGeometry, ballPos: THREE.Vector3, lTip: {x:number;y:number;z:number}, rTip: {x:number;y:number;z:number}) {
      const lPts = [new THREE.Vector3(lTip.x, lTip.y, lTip.z), ballPos.clone()];
      const rPts = [new THREE.Vector3(rTip.x, rTip.y, rTip.z), ballPos.clone()];
      lGeo.setFromPoints(lPts); rGeo.setFromPoints(rPts);
    }

    // Pointer drag
    const onDown = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.running || s2.ballActive) return;
      s2.pulling = true; s2.pointerId = e.pointerId;
      s2.pullX = (e.clientX / window.innerWidth - 0.5) * 2;
      s2.pullY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    const onMove = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.pulling || e.pointerId !== s2.pointerId) return;
      s2.pullX = (e.clientX / window.innerWidth - 0.5) * 2;
      s2.pullY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    const onUp = (e: PointerEvent) => {
      const s2 = stateRef.current;
      if (!s2.pulling || e.pointerId !== s2.pointerId) return;
      s2.pulling = false; s2.pointerId = null;
      // Launch
      s2.sig.totalShots++;
      const dx = s2.pullX * -2.5, dy = (s2.pullY * -1.5) + 1.5, dz = -4;
      const power = Math.min(1, Math.sqrt(s2.pullX*s2.pullX + s2.pullY*s2.pullY));
      if (s2.sig.maxPower < power * 30) s2.sig.maxPower = power * 30;
      s2.ballVX = dx * 0.04; s2.ballVY = dy * 0.04; s2.ballVZ = dz * 0.04;
      s2.ballX = 0; s2.ballY = -1.2; s2.ballZ = 0;
      s2.ballActive = true;
      sfx.collect(); hapticImpact?.();
    };
    if (mountRef.current) {
      mountRef.current.addEventListener('pointerdown', onDown);
      mountRef.current.addEventListener('pointermove', onMove);
      mountRef.current.addEventListener('pointerup', onUp);
    }
    (s as any)._inputCleanup = () => {
      mountRef.current?.removeEventListener('pointerdown', onDown);
      mountRef.current?.removeEventListener('pointermove', onMove);
      mountRef.current?.removeEventListener('pointerup', onUp);
    };
  }, [endGame, spawnTarget]);

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
      background="linear-gradient(180deg, #0a0a1a 0%, #0a0500 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Drag back the 3D slingshot and release to smash glowing targets!"
          ctaLabel="Stretch & Smash! 🪃" accentColor={accent} onStart={handleStart} />
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
            { label: 'Hits', value: String(finalSig.hits), color: accent },
            { label: 'Bullseyes', value: String(finalSig.bullseyes), color: '#fbbf24' },
            { label: 'Accuracy', value: finalSig.totalShots > 0 ? `${Math.round(finalSig.hits / finalSig.totalShots * 100)}%` : '—', color: '#4ade80' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#06b6d4' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 10} />
      )}
    </GameShell>
  );
}
