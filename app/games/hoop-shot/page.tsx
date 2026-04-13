'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const ACCENT = '#f97316';
const GAME_ID = 'hoop-shot';
const DURATION = 45;
const GAME_EMOJI = '🏀';
const GAME_TITLE = 'Hoop Shot';
const GAME_TAGLINE = 'Swipe up to shoot. Time your power!';

interface Signals {
  totalShots: number; makes: number; misses: number;
  threePointMakes: number; streakMax: number; streakCurrent: number; score: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.totalShots > 0 ? sig.makes / sig.totalShots : 0;
  if (acc >= 0.7 && sig.streakMax >= 4) return '🔥 Clutch Shooter';
  if (sig.threePointMakes >= 5)         return '⭐ Downtown Gunner';
  if (sig.streakMax >= 5)               return '💥 Streak Machine';
  if (acc >= 0.55)                      return '🎯 Steady';
  return '🏀 Learning the Arc';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface BallInFlight {
  mesh: THREE.Mesh;
  trail: THREE.Mesh[];
  vx: number; vy: number; vz: number;
  active: boolean;
  is3pt: boolean;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  animId: number; frame: number;
  ball: BallInFlight | null;
  power: number; charging: boolean; chargeStart: number;
  pointerStart: { x: number; y: number; t: number } | null;
  intervalId: ReturnType<typeof setInterval> | null;
  stopMusic: (() => void) | null;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  courtLight: THREE.PointLight | null;
  hoopMesh: THREE.Mesh | null;
  powerBarLight: THREE.PointLight | null;
}

function HoopShotInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { totalShots: 0, makes: 0, misses: 0, threePointMakes: 0, streakMax: 0, streakCurrent: 0, score: 0 },
    renderer: null, scene: null, camera: null, animId: 0, frame: 0,
    ball: null, power: 0, charging: false, chargeStart: 0,
    pointerStart: null, intervalId: null, stopMusic: null, particles: [],
    courtLight: null, hoopMesh: null, powerBarLight: null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const [powerDisplay, setPowerDisplay] = useState(0);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
        const _pbKey = 'pb_hoop-shot';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done');
    hapticVictory();
  }, []);

  const resetBall = useCallback((scene: THREE.Scene, s: GS) => {
    if (s.ball) {
      s.ball.trail.forEach(t => { scene.remove(t); t.geometry.dispose(); (t.material as THREE.Material).dispose(); });
      scene.remove(s.ball.mesh);
      s.ball.mesh.geometry.dispose();
      (s.ball.mesh.material as THREE.Material).dispose();
    }
    const ballGeo = new THREE.SphereGeometry(0.22, 20, 20);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6, metalness: 0.1 });
    const ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.position.set(0, 0.5, 6);
    scene.add(ballMesh);
    const trail: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) {
      const tGeo = new THREE.SphereGeometry(0.08, 6, 6);
      const tMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0 });
      const tMesh = new THREE.Mesh(tGeo, tMat);
      scene.add(tMesh);
      trail.push(tMesh);
    }
    s.ball = { mesh: ballMesh, trail, vx: 0, vy: 0, vz: 0, active: false, is3pt: false };
  }, []);

  const shootBall = useCallback((power: number, dx: number) => {
    const s = stateRef.current;
    if (!s.ball || s.ball.active || !s.running) return;
    s.ball.active = true;
    const normalPower = Math.max(0.2, Math.min(1.0, power));
    const is3pt = normalPower > 0.8 || Math.abs(dx) > 50;
    s.ball.is3pt = is3pt;
    s.ball.vx = dx * 0.003;
    s.ball.vy = 0.12 + normalPower * 0.15;
    s.ball.vz = -(0.08 + normalPower * 0.12);
    s.sig.totalShots++;
    setPowerDisplay(0);
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { totalShots: 0, makes: 0, misses: 0, threePointMakes: 0, streakMax: 0, streakCurrent: 0, score: 0 };
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
    scene.fog = new THREE.Fog(0x0a0a1a, 15, 30);
    s.scene = scene;

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 50);
    camera.position.set(0, 3, 10);
    camera.lookAt(0, 3, 0);
    s.camera = camera;

    // Lighting
    scene.add(new THREE.AmbientLight(0x223344, 2));
    const courtLight = new THREE.PointLight(0xffeedd, 3, 25);
    courtLight.position.set(0, 10, 0);
    scene.add(courtLight);
    s.courtLight = courtLight;
    const rimLight1 = new THREE.PointLight(0xff6600, 1.5, 15);
    rimLight1.position.set(-5, 6, -5);
    scene.add(rimLight1);
    const rimLight2 = new THREE.PointLight(0x0044ff, 1, 15);
    rimLight2.position.set(5, 6, 5);
    scene.add(rimLight2);

    // Court floor
    const floorGeo = new THREE.PlaneGeometry(14, 16);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x7b4f1e, roughness: 0.8 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Court lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
    // 3-point arc
    const arc3pts: THREE.Vector3[] = [];
    for (let a = -Math.PI * 0.6; a <= Math.PI * 0.6; a += 0.1) {
      arc3pts.push(new THREE.Vector3(Math.sin(a) * 4.5, 0.01, Math.cos(a) * 4.5 - 4));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arc3pts);
    scene.add(new THREE.Line(arcGeo, lineMat));

    // Paint lane
    const paintGeo = new THREE.PlaneGeometry(2.4, 3.2);
    const paintMat = new THREE.MeshStandardMaterial({ color: 0x993300, roughness: 0.9 });
    const paint = new THREE.Mesh(paintGeo, paintMat);
    paint.rotation.x = -Math.PI / 2;
    paint.position.set(0, 0.01, -3);
    scene.add(paint);

    // Backboard
    const bbGeo = new THREE.BoxGeometry(1.8, 1.1, 0.06);
    const bbMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, transparent: true, opacity: 0.5 });
    const bb = new THREE.Mesh(bbGeo, bbMat);
    bb.position.set(0, 4.8, -7);
    scene.add(bb);

    // Hoop
    const hoopGeo = new THREE.TorusGeometry(0.48, 0.035, 8, 30);
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xf97316, emissiveIntensity: 0.4, metalness: 0.8, roughness: 0.2 });
    const hoop = new THREE.Mesh(hoopGeo, hoopMat);
    hoop.position.set(0, 3.85, -7.1);
    hoop.rotation.x = -0.1;
    scene.add(hoop);
    s.hoopMesh = hoop;

    // Pole + support
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 5, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(0.9, 2.5, -7.5);
    scene.add(pole);

    // Net (simplified as cone)
    const netGeo = new THREE.ConeGeometry(0.45, 0.55, 12, 1, true);
    const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.4 });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, 3.6, -7.1);
    scene.add(net);

    // Stands (background)
    const standGeo = new THREE.BoxGeometry(20, 6, 1);
    const standMat = new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 1 });
    const standBack = new THREE.Mesh(standGeo, standMat);
    standBack.position.set(0, 3, -10);
    scene.add(standBack);
    const standLeft = new THREE.Mesh(standGeo, standMat.clone());
    standLeft.rotation.y = Math.PI / 2;
    standLeft.position.set(-7, 3, -2);
    scene.add(standLeft);
    const standRight = new THREE.Mesh(standGeo, standMat.clone());
    standRight.rotation.y = -Math.PI / 2;
    standRight.position.set(7, 3, -2);
    scene.add(standRight);

    // Resize
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
    s.stopMusic = startMusic('sports' as import('@/lib/audio').MusicPattern);
    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Court light pulse - stadium feel
      if (s.courtLight) s.courtLight.intensity = 2.8 + Math.sin(s.frame * 0.04) * 0.3;
      // Hoop glow
      if (s.hoopMesh) (s.hoopMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + Math.sin(s.frame * 0.08) * 0.15;

      // Ball physics
      if (s.ball && s.ball.active) {
        const ball = s.ball;
        ball.mesh.position.x += ball.vx;
        ball.mesh.position.y += ball.vy;
        ball.mesh.position.z += ball.vz;
        ball.vy -= 0.007; // gravity
        ball.mesh.rotation.x += ball.vx * 0.5 + ball.vz * 0.3;
        ball.mesh.rotation.z -= ball.vy * 0.2;

        // Trail
        for (let i = ball.trail.length - 1; i > 0; i--) {
          ball.trail[i].position.copy(ball.trail[i - 1].position);
          (ball.trail[i].material as THREE.MeshBasicMaterial).opacity = (1 - i / ball.trail.length) * 0.35;
        }
        ball.trail[0].position.copy(ball.mesh.position);

        // Check if near hoop
        const hoopPos = new THREE.Vector3(0, 3.85, -7.1);
        const dist = ball.mesh.position.distanceTo(hoopPos);
        if (dist < 0.6 && ball.mesh.position.z < -6.5) {
          ball.active = false;
          // MAKE!
          s.sig.makes++;
          s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.streakMax) s.sig.streakMax = s.sig.streakCurrent;
          const pts = ball.is3pt ? 3 : s.sig.streakCurrent >= 3 ? 2 : 1;
          if (ball.is3pt) s.sig.threePointMakes++;
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          sfx.success(); hapticScore();
          // Burst
          for (let i = 0; i < 12; i++) {
            const pGeo = new THREE.SphereGeometry(0.06, 6, 6);
            const pMat = new THREE.MeshStandardMaterial({ color: ball.is3pt ? 0xfbbf24 : 0xf97316, emissive: ball.is3pt ? 0xfbbf24 : 0xf97316, emissiveIntensity: 1.5, transparent: true, opacity: 1 });
            const pMesh = new THREE.Mesh(pGeo, pMat);
            pMesh.position.copy(hoopPos);
            scene.add(pMesh);
            const angle = (i / 12) * Math.PI * 2;
            s.particles.push({ mesh: pMesh, vx: Math.cos(angle) * 0.12, vy: 0.12 + Math.random() * 0.1, vz: Math.sin(angle) * 0.08, life: 30 });
          }
          setTimeout(() => { if (s.running) resetBall(scene, s); }, 400);
        } else if (ball.mesh.position.y < -1 || ball.mesh.position.z < -12) {
          // MISS
          ball.active = false;
          s.sig.misses++; s.sig.streakCurrent = 0;
          sfx.collision(); hapticFail();
          setTimeout(() => { if (s.running) resetBall(scene, s); }, 500);
        }
      }

      // Power charge visual
      if (s.charging) {
        const elapsed = (Date.now() - s.chargeStart) / 1000;
        s.power = Math.min(1.0, elapsed / 1.5);
        setPowerDisplay(Math.round(s.power * 100));
      }

      // Particles
      s.particles = s.particles.filter(p => {
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy -= 0.006;
        p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, p.life / 30);
        if (p.life <= 0) { scene.remove(p.mesh); return false; }
        return true;
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, resetBall]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const onDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      s.pointerStart = { x: e.clientX, y: e.clientY, t: Date.now() };
      s.charging = true; s.chargeStart = Date.now(); s.power = 0;
    };
    const onUp = (e: PointerEvent) => {
      if (!s.pointerStart || phase !== 'playing') return;
      const dx = e.clientX - s.pointerStart.x;
      const dy = e.clientY - s.pointerStart.y;
      const dt = Date.now() - s.pointerStart.t;
      s.charging = false;
      const swipePower = Math.abs(dy) / 200;
      const finalPower = Math.max(s.power, swipePower);
      s.pointerStart = null;
      if (dy < -20 || dt < 400) shootBall(finalPower, dx);
      setPowerDisplay(0);
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointerup', onUp);
    return () => { mount.removeEventListener('pointerdown', onDown); mount.removeEventListener('pointerup', onUp); };
  }, [phase, shootBall]);

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
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setPowerDisplay(0); }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.totalShots > 0 ? Math.round(sig.makes / sig.totalShots * 100) : 0;
    return [
      { label: 'Field Goal %', value: `${acc}%`, color: acc >= 50 ? '#4ade80' : '#facc15' },
      { label: 'Makes', value: String(sig.makes), color: ACCENT },
      { label: '3-Pointers', value: String(sig.threePointMakes), color: '#fbbf24' },
      { label: 'Best Streak', value: `×${sig.streakMax}`, color: ACCENT },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Take the Shot!" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
                { label: 'SCORE', value: scoreDisplay },
              ]} />
              {powerDisplay > 0 && (
                <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)', width: 140, height: 10, background: 'rgba(255,255,255,0.15)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ width: `${powerDisplay}%`, height: '100%', background: powerDisplay > 75 ? '#ef4444' : powerDisplay > 50 ? '#f97316' : '#4ade80', borderRadius: 5, transition: 'width 0.05s' }} />
                </div>
              )}
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
            onPlayAgain={handlePlayAgain} didWin={finalSig.makes >= 5} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>🏆 New Personal Best!</div>
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score, makes: sig.makes, totalShots: sig.totalShots, streakMax: sig.streakMax }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const HoopShot = dynamic(() => Promise.resolve({ default: HoopShotInner }), { ssr: false });
export default HoopShot;
