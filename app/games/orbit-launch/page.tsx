'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'orbit-launch';
const ACCENT = '#6366f1';
const DURATION = 45;
const GAME_EMOJI = '🚀';
const GAME_TITLE = 'Orbit Launch';
const GAME_TAGLINE = 'Nail the angle. Own the orbit.';

interface Signals {
  totalLaunches: number; orbitsAchieved: number; perfectOrbits: number;
  maxStreak: number; streakCurrent: number; score: number; closestApproach: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  if (sig.perfectOrbits >= 3 && sig.maxStreak >= 3) return 'Orbital Maestro 🌌';
  if (sig.orbitsAchieved >= 6) return 'Space Commander 🚀';
  if (sig.maxStreak >= 4) return 'Consistent Launcher 🛸';
  if (sig.orbitsAchieved >= 3) return 'Getting into Orbit 🌙';
  return 'Gravity Student 📚';
}

export default function OrbitLaunch() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const satelliteRef = useRef<THREE.Mesh | null>(null);
  const trailRef = useRef<THREE.Line | null>(null);
  const orbitRingsRef = useRef<THREE.Line[]>([]);
  const launchLineRef = useRef<THREE.Line | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { totalLaunches: 0, orbitsAchieved: 0, perfectOrbits: 0, maxStreak: 0, streakCurrent: 0, score: 0, closestApproach: 9999 } as Signals,
    satX: 0, satY: 0, satVX: 0, satVY: 0, satActive: false,
    trailPoints: [] as THREE.Vector3[],
    orbitFrames: 0, orbitComplete: false,
    pulling: false, pullStartX: 0, pullStartY: 0, curPullX: 0, curPullY: 0,
    planetR: 1.2,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    hapticVictory();
    try { const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0'); if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalLaunches: 0, orbitsAchieved: 0, perfectOrbits: 0, maxStreak: 0, streakCurrent: 0, score: 0, closestApproach: 9999 };
    s.satActive = false; s.pulling = false; s.trailPoints = []; s.orbitFrames = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020212);
    scene.fog = new THREE.Fog(0x020212, 25, 50);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 14);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    scene.add(new THREE.AmbientLight(0x111133, 2));
    const sunLight = new THREE.PointLight(0x8888ff, 120, 40);
    sunLight.position.set(0, 0, 10);
    scene.add(sunLight);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(900);
    for (let i = 0; i < 900; i += 3) {
      sp[i] = (Math.random() - 0.5) * 80;
      sp[i + 1] = (Math.random() - 0.5) * 80;
      sp[i + 2] = (Math.random() - 0.5) * 20 - 15;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07 })));

    // Planet
    const planetGeo = new THREE.SphereGeometry(s.planetR, 32, 32);
    const planetMat = new THREE.MeshStandardMaterial({ color: 0x1a1aff, emissive: 0x0000aa, roughness: 0.6, metalness: 0.3 });
    const planet = new THREE.Mesh(planetGeo, planetMat);
    scene.add(planet);
    // Atmosphere glow
    const atmGeo = new THREE.SphereGeometry(s.planetR + 0.3, 32, 32);
    const atmMat = new THREE.MeshStandardMaterial({ color: 0x3333ff, transparent: true, opacity: 0.15, side: THREE.BackSide });
    scene.add(new THREE.Mesh(atmGeo, atmMat));

    // Orbital zone rings
    const zones = [
      { minR: 2.5, maxR: 3.5, color: 0x4ade80, pts: 3, label: 'Perfect' },
      { minR: 3.5, maxR: 5.0, color: 0xfbbf24, pts: 2, label: 'Good' },
      { minR: 5.0, maxR: 7.0, color: 0xf97316, pts: 1, label: 'Far' },
    ];
    orbitRingsRef.current = [];
    zones.forEach(z => {
      [z.minR, z.maxR].forEach(r => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
        }
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: z.color, transparent: true, opacity: 0.25 }),
        );
        scene.add(line);
        orbitRingsRef.current.push(line);
      });
    });

    // Launch pad marker
    const padGeo = new THREE.ConeGeometry(0.15, 0.4, 6);
    const padMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x7a5c00 });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(-6, -3, 0);
    pad.rotation.z = Math.PI / 4;
    scene.add(pad);

    // Satellite mesh
    const satGeo = new THREE.OctahedronGeometry(0.22);
    const satMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x7a5c00, roughness: 0.2, metalness: 0.8 });
    const sat = new THREE.Mesh(satGeo, satMat);
    sat.visible = false;
    scene.add(sat);
    satelliteRef.current = sat;

    // Trail line
    const trailGeo = new THREE.BufferGeometry();
    const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.6 }));
    scene.add(trailLine);
    trailRef.current = trailLine;

    // Launch direction line
    const lGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,0)]);
    const launchLine = new THREE.Line(lGeo, new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5 }));
    scene.add(launchLine);
    launchLineRef.current = launchLine;

    // Input
    const LAUNCH_X = -6, LAUNCH_Y = -3;
    const onDown = (e: PointerEvent) => {
      if (!s.running || s.satActive) return;
      s.pulling = true;
      s.pullStartX = e.clientX; s.pullStartY = e.clientY;
      s.curPullX = e.clientX; s.curPullY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!s.pulling) return;
      s.curPullX = e.clientX; s.curPullY = e.clientY;
    };
    const onUp = () => {
      if (!s.running || !s.pulling || s.satActive) return;
      s.pulling = false;
      // Convert pull to launch velocity
      const dx = s.pullStartX - s.curPullX;
      const dy = s.pullStartY - s.curPullY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 10) return;
      const speed = Math.min(dist / 60, 0.18);
      const angle = Math.atan2(-dy, dx);
      s.satX = LAUNCH_X; s.satY = LAUNCH_Y;
      s.satVX = Math.cos(angle) * speed;
      s.satVY = Math.sin(angle) * speed;
      s.satActive = true; s.orbitFrames = 0; s.orbitComplete = false;
      s.trailPoints = [];
      s.sig.totalLaunches++;
      if (sat) sat.visible = true;
      sfx.click(); hapticScore();
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const GRAVITY = 0.002;
    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.01;
      planet.rotation.y += 0.003;

      if (s.satActive) {
        // Gravity toward planet
        const dx = -s.satX, dy = -s.satY;
        const dist2 = dx * dx + dy * dy;
        const dist = Math.sqrt(dist2);
        const force = GRAVITY * s.planetR * s.planetR / dist2;
        s.satVX += (dx / dist) * force;
        s.satVY += (dy / dist) * force;
        s.satX += s.satVX;
        s.satY += s.satVY;

        if (dist < s.sig.closestApproach) s.sig.closestApproach = dist;

        // Check collision with planet
        if (dist < s.planetR + 0.1) {
          s.satActive = false; s.sig.streakCurrent = 0;
          sat.visible = false; sfx.collision(); hapticFail();
          s.trailPoints = [];
        } else if (dist > 12) {
          s.satActive = false; s.sig.streakCurrent = 0;
          sat.visible = false;
          s.trailPoints = [];
        } else {
          s.orbitFrames++;
          s.trailPoints.push(new THREE.Vector3(s.satX, s.satY, 0));
          if (s.trailPoints.length > 200) s.trailPoints.shift();
          sat.position.set(s.satX, s.satY, 0);
          sat.rotation.y += 0.05;

          // Check orbit completion (360 degrees covered with consistent radius)
          if (s.orbitFrames > 120 && !s.orbitComplete) {
            // simplified: check if dist is in a zone
            const perfect = dist >= 2.5 && dist <= 3.5;
            const good = dist >= 3.5 && dist <= 5.0;
            const far = dist >= 5.0 && dist <= 7.0;
            if (perfect || good || far) {
              const pts = perfect ? 3 : good ? 2 : 1;
              s.orbitComplete = true;
              s.sig.orbitsAchieved++;
              if (perfect) s.sig.perfectOrbits++;
              s.sig.streakCurrent++;
              if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
              s.sig.score += pts * 10 * Math.max(1, s.sig.streakCurrent);
              setScoreDisplay(s.sig.score);
              sfx.collect(); hapticVictory();
              setTimeout(() => {
                if (s.running) { s.satActive = false; sat.visible = false; s.trailPoints = []; s.orbitFrames = 0; s.orbitComplete = false; }
              }, 1200);
            }
          }
          // Update trail geometry
          if (trailRef.current && s.trailPoints.length > 1) {
            trailRef.current.geometry.setFromPoints(s.trailPoints);
          }
        }
      }

      // Pull line
      if (s.pulling && launchLineRef.current) {
        const ndcStartX = (LAUNCH_X / 7) * (W / 2);
        const ndcStartY = (LAUNCH_Y / 7) * (H / 2);
        const dx = (s.curPullX - s.pullStartX) * 0.02;
        const dy = (s.curPullY - s.pullStartY) * -0.02;
        launchLineRef.current.geometry.setFromPoints([
          new THREE.Vector3(LAUNCH_X, LAUNCH_Y, 0),
          new THREE.Vector3(LAUNCH_X - dx * 3, LAUNCH_Y + dy * 3, 0),
        ]);
        launchLineRef.current.visible = true;
      } else if (launchLineRef.current) {
        launchLineRef.current.visible = false;
      }

      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
    };
  }, [endGame]);

  useEffect(() => {
    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const W = window.innerWidth, H = window.innerHeight;
      cameraRef.current.aspect = W / H;
      cameraRef.current.updateProjectionMatrix();
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
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.1) 0%, transparent 70%), linear-gradient(180deg, #020212 0%, #010108 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Launch!" accentColor={accent} onStart={handleStart} />
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
              <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.5)', fontSize: 13, pointerEvents: 'none', textAlign: 'center' }}>
                Pull & release to launch · Orbit the planet to score
              </div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Orbits', value: String(finalSig.orbitsAchieved), color: '#4ade80' },
            { label: 'Perfect', value: String(finalSig.perfectOrbits), color: '#fbbf24' },
            { label: 'Launches', value: String(finalSig.totalLaunches), color: accent },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#c084fc' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.orbitsAchieved >= 3} />
      )}
    </GameShell>
  );
}
