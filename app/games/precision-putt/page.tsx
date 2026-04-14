'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const ACCENT = '#86efac';
const GAME_ID = 'precision-putt';
const PB_KEY  = 'pb_precision-putt';
const MAX_HOLES = 8;
const GAME_EMOJI = '🏌️';

interface Signals { holes: number; score?: number; totalStrokes: number; holesInOne: number; pars: number; bogeys: number; sweetSpotHits: number; avgReadTime: number; readTimes: number[]; powerHistory: number[]; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const powerAcc = sig.sweetSpotHits / Math.max(1, sig.totalStrokes);
  const avgRead = sig.avgReadTime;
  if (powerAcc > 0.7 && avgRead > 2) return '🔬 Surgeon';
  if (powerAcc > 0.6 && avgRead < 1.5) return '🎯 Feel Player';
  if (avgRead > 3 && powerAcc < 0.5) return '🤔 Overthinks It';
  return '🏌️ Steady Putter';
}

interface HoleConfig { holeX: number; holeZ: number; par: number; windAngle: number; windSpeed: number; }

function generateHole(index: number): HoleConfig {
  return {
    holeX: (Math.random() - 0.5) * 7,
    holeZ: -3 - Math.random() * 3,
    par: index < 2 ? 1 : index < 5 ? 2 : 3,
    windAngle: Math.random() * Math.PI * 2,
    windSpeed: Math.random() * 0.8,
  };
}

interface Confetti3D { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; }

function PrecisionPuttInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const ballRef = useRef<THREE.Mesh | null>(null);
  const holeMeshRef = useRef<THREE.Mesh | null>(null);
  const flagRef = useRef<THREE.Group | null>(null);
  const aimArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const confettiRef = useRef<Confetti3D[]>([]);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const { pops, triggerPop } = useScorePop();

  const stateRef = useRef({
    running: false, timeLeft: 60,
    sig: { holes: 0, totalStrokes: 0, holesInOne: 0, pars: 0, bogeys: 0, sweetSpotHits: 0, avgReadTime: 0, readTimes: [], powerHistory: [] } as Signals,
    ballX: 0, ballY: 0, ballZ: 0, ballVX: 0, ballVZ: 0, ballMoving: false, ballRadius: 0.2,
    aimAngle: 0, charging: false, power: 0, powerStart: 0,
    hole: null as HoleConfig | null, holeIndex: 0, strokesThisHole: 0, holeComplete: false,
    friction: 0.97,
    phase: 'aiming' as 'aiming' | 'putting' | 'result',
    aimReadStart: 0, lastTickTime: 0,
    chargeStart: 0, isSwiping: false, swipeStartX: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(60);
  const [holeDisplay, setHoleDisplay] = useState(1);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [streak, setStreak] = useState(0);
  const [scoreDisplay, setScoreDisplay] = useState(0);

  useEffect(() => { /* accent sync */ }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (!s.holeComplete && s.strokesThisHole > 0) s.sig.totalStrokes += s.strokesThisHole;
    if (s.sig.readTimes.length > 0) s.sig.avgReadTime = s.sig.readTimes.reduce((a,b)=>a+b,0)/s.sig.readTimes.length;
    playVictoryFanfare(); hapticVictory();
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0'); if (s.sig.holes > pb) localStorage.setItem(PB_KEY, String(s.sig.holes)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
    postWebhook(theme, GAME_ID, { score: `${s.sig.totalStrokes} strokes`, personality: getPersonality(s.sig), signals: { holes: s.sig.holes, holesInOne: s.sig.holesInOne } }, playerSessionRef.current);
  }, [theme]);

  const setupHole = useCallback(() => {
    const s = stateRef.current;
    const scene = sceneRef.current; if (!scene) return;
    const hole = generateHole(s.holeIndex);
    s.hole = hole; s.ballX = 0; s.ballY = 0; s.ballZ = 3; s.ballVX = 0; s.ballVZ = 0;
    s.ballMoving = false; s.aimAngle = 0; s.charging = false; s.power = 0;
    s.phase = 'aiming'; s.strokesThisHole = 0; s.holeComplete = false; s.aimReadStart = Date.now();
    if (ballRef.current) ballRef.current.position.set(s.ballX, s.ballY, s.ballZ);
    // Move hole mesh and flag
    if (holeMeshRef.current) holeMeshRef.current.position.set(hole.holeX, -0.01, hole.holeZ);
    if (flagRef.current) flagRef.current.position.set(hole.holeX, 0, hole.holeZ);
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = 60; s.holeIndex = 0;
    s.sig = { holes: 0, totalStrokes: 0, holesInOne: 0, pars: 0, bogeys: 0, sweetSpotHits: 0, avgReadTime: 0, readTimes: [], powerHistory: [] };
    setScoreDisplay(0); setHoleDisplay(1); setStreak(0); setTimeLeft(60); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060f06);
    scene.fog = new THREE.Fog(0x060f06, 12, 25);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 60);
    camera.position.set(0, 6, 9);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x0a1a0a, 3));
    const sun = new THREE.DirectionalLight(0xccffcc, 0.8);
    sun.position.set(3, 8, 5); sun.castShadow = true;
    scene.add(sun);
    const greenLight = new THREE.PointLight(0x86efac, 50, 20);
    greenLight.position.set(0, 4, 5);
    scene.add(greenLight);

    // Fairway
    const green = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.8 }));
    green.rotation.x = -Math.PI / 2; green.receiveShadow = true;
    scene.add(green);
    // Penalty spot
    const spotMesh = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    spotMesh.rotation.x = -Math.PI / 2; spotMesh.position.set(0, 0.01, 3);
    scene.add(spotMesh);

    // Hole (dark circle)
    const holeMesh = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 }));
    holeMesh.rotation.x = -Math.PI / 2;
    scene.add(holeMesh);
    holeMeshRef.current = holeMesh;

    // Flag
    const flagGroup = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6);
    const poleMesh = new THREE.Mesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
    flagGroup.add(poleMesh);
    const flagGeo = new THREE.PlaneGeometry(0.4, 0.25);
    const flagMesh = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xef4444, side: THREE.DoubleSide }));
    flagMesh.position.set(0.2, 0.6, 0);
    flagGroup.add(flagMesh);
    scene.add(flagGroup);
    flagRef.current = flagGroup;

    // Ball (golf ball)
    const ballGeo = new THREE.SphereGeometry(s.ballRadius, 20, 20);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.set(0, s.ballRadius, 3);
    ball.castShadow = true;
    scene.add(ball);
    ballRef.current = ball;

    // Aim arrow
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.3, 3), 1.5, 0x86efac, 0.3, 0.2);
    scene.add(arrow);
    aimArrowRef.current = arrow;

    // Stars bg
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(200);
    for (let i = 0; i < 200; i += 3) { sp[i] = (Math.random()-0.5)*30; sp[i+1] = 3 + Math.random()*10; sp[i+2] = -10 - Math.random()*5; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x86efac, size: 0.06 })));

    setupHole();

    // Input: swipe for aim + tap+hold for power
    const onDown = (e: PointerEvent) => {
      if (!s.running || s.phase !== 'aiming' || s.ballMoving || s.holeComplete) return;
      s.isSwiping = true; s.swipeStartX = e.clientX;
      s.charging = true; s.chargeStart = Date.now(); s.power = 0; s.lastTickTime = 0;
      s.sig.readTimes.push((Date.now() - s.aimReadStart) / 1000);
    };
    const onMove = (e: PointerEvent) => {
      if (!s.running || !s.isSwiping) return;
      const dx = e.clientX - s.swipeStartX;
      s.aimAngle += dx * 0.005;
      s.swipeStartX = e.clientX;
    };
    const onUp = () => {
      if (!s.running || !s.charging) return;
      s.charging = false; s.isSwiping = false;
      const pwr = s.power;
      if (pwr >= 40 && pwr <= 70) s.sig.sweetSpotHits++;
      s.sig.powerHistory.push(pwr);
      const spd = pwr * 0.007;
      s.ballVX = Math.sin(s.aimAngle) * spd;
      s.ballVZ = -Math.cos(s.aimAngle) * spd;
      s.ballMoving = true; s.strokesThisHole++;
      s.aimReadStart = Date.now();
      sfx.click(); haptic([40]);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.012;

      // Aim arrow
      if (aimArrowRef.current && !s.ballMoving && s.phase === 'aiming') {
        aimArrowRef.current.position.set(s.ballX, 0.3, s.ballZ);
        aimArrowRef.current.setDirection(new THREE.Vector3(Math.sin(s.aimAngle), 0, -Math.cos(s.aimAngle)));
        aimArrowRef.current.visible = !s.holeComplete;
      } else if (aimArrowRef.current) aimArrowRef.current.visible = false;

      // Charge power
      if (s.charging) {
        const now = Date.now();
        if (now - s.lastTickTime >= 200) { s.lastTickTime = now; sfx.tick(); }
        s.power = Math.min(100, (Date.now() - s.chargeStart) / 30);
      }

      // Ball physics
      if (s.ballMoving && !s.holeComplete) {
        if (s.hole) {
          s.ballVX += Math.cos(s.hole.windAngle) * s.hole.windSpeed * 0.0003;
          s.ballVZ += Math.sin(s.hole.windAngle) * s.hole.windSpeed * 0.0003;
        }
        s.ballVX *= s.friction; s.ballVZ *= s.friction;
        s.ballX += s.ballVX; s.ballZ += s.ballVZ;
        // Boundary
        if (Math.abs(s.ballX) > 5.5) { s.ballX = Math.sign(s.ballX) * 5.5; s.ballVX *= -0.6; }
        if (s.ballZ < -5 || s.ballZ > 5.5) { s.ballZ = Math.max(-5, Math.min(5.5, s.ballZ)); s.ballVZ *= -0.6; }
        const spd = Math.sqrt(s.ballVX*s.ballVX + s.ballVZ*s.ballVZ);
        if (spd < 0.001) { s.ballMoving = false; s.ballVX = 0; s.ballVZ = 0; }
        if (ballRef.current) { ballRef.current.position.set(s.ballX, s.ballRadius, s.ballZ); ballRef.current.rotation.x += s.ballVZ * 5; ballRef.current.rotation.z -= s.ballVX * 5; }
        // Check hole
        if (s.hole) {
          const dx = s.ballX - s.hole.holeX, dz = s.ballZ - s.hole.holeZ;
          if (Math.sqrt(dx*dx+dz*dz) < 0.45) {
            s.holeComplete = true; s.ballMoving = false;
            s.sig.holes++;
            s.sig.totalStrokes += s.strokesThisHole;
            const strokes = s.strokesThisHole, par = s.hole.par;
            if (strokes === 1) {
              s.sig.holesInOne++; sfx.success(); haptic([60,30,60,30,60]);
              for (let ci = 0; ci < 20; ci++) {
                const cGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
                const cMesh = new THREE.Mesh(cGeo, new THREE.MeshStandardMaterial({ color: [0xfbbf24,0x4ade80,0x60a5fa,0xf472b6][ci%4] }));
                cMesh.position.set(s.hole.holeX, 0.5, s.hole.holeZ);
                scene.add(cMesh);
                confettiRef.current.push({ mesh: cMesh, vx:(Math.random()-0.5)*0.12, vy:0.06+Math.random()*0.1, vz:(Math.random()-0.5)*0.08, life:1 });
              }
              triggerPop('HOLE IN ONE! 🎊', window.innerWidth*0.5, window.innerHeight*0.4);
            } else if (strokes <= par) { s.sig.pars++; sfx.collect(); haptic([60,30,60]); playScoreHit('default', 10); }
            else { s.sig.bogeys++; sfx.nearMiss(); }
            // Score tracking
            const _holeScore = strokes === 1 ? 50 : strokes <= par ? 20 : 5;
            if (!s.sig.score) s.sig.score = 0;
            s.sig.score += _holeScore;
            setScoreDisplay(s.sig.score);
            s.holeIndex++;
            setHoleDisplay(Math.min(s.holeIndex + 1, MAX_HOLES));
            setStreak(s.sig.holes);
            if (s.holeIndex >= MAX_HOLES) { setTimeout(() => { sfx.success(); endGame(); }, 1000); }
            else { setTimeout(() => { if (s.running) setupHole(); }, 1200); }
          }
        }
      } else if (ballRef.current && !s.ballMoving) {
        ballRef.current.position.y = s.ballRadius + Math.sin(t * 2) * 0.01;
      }

      // Confetti
      for (let i = confettiRef.current.length - 1; i >= 0; i--) {
        const c = confettiRef.current[i];
        c.mesh.position.x += c.vx; c.mesh.position.y += c.vy; c.mesh.position.z += c.vz;
        c.vy -= 0.003; c.life -= 0.015;
        (c.mesh.material as THREE.MeshStandardMaterial).opacity = c.life;
        (c.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        if (c.life <= 0.05) { scene.remove(c.mesh); confettiRef.current.splice(i, 1); }
      }

      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
    };
  }, [endGame, setupHole, triggerPop]);

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
      if (stopMusicRef.current) stopMusicRef.current();
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    confettiRef.current = [];
    setHoleDisplay(1); setTimeLeft(60); setFinalSig(null); setStreak(0);
    setPhase('countdown');
  }, []);

  const sig = finalSig;
  const parTotal = sig ? sig.pars + sig.holesInOne : 0;
  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title="Precision Putt" emoji={GAME_EMOJI} accentColor={accent} theme={theme}
      background="radial-gradient(ellipse at 50% 70%, rgba(134,239,172,0.1) 0%, transparent 60%), linear-gradient(180deg, #060f06 0%, #030805 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title="Precision Putt" description="Swipe to aim. Tap & hold to charge power. Hit the sweet spot (40–70%). 8 holes."
          ctaLabel="Start Putting →" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} role="application" aria-label="Putting green - swipe to aim and shoot" style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD items={[
                { label: 'HOLE', value: `${Math.min(holeDisplay, MAX_HOLES)}/${MAX_HOLES}`, testId: 'score' }, { label: 'SCORE', value: scoreDisplay },
                { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10, testId: 'timer' },
              ]} accentColor={accent} />
              <ScorePopEffect pops={pops} accentColor={accent} />
              <StreakBadge streak={streak} accentColor={accent} />
              {stateRef.current.charging && (
                <div style={{ position: 'absolute', bottom: '12%', left: '50%', transform: 'translateX(-50%)', width: '55%' }}>
                  <div style={{ background: 'rgba(0,0,0,0.5)', borderRadius: 8, overflow: 'hidden', height: 14 }}>
                    <div style={{ width: `${stateRef.current.power}%`, height: '100%', background: stateRef.current.power < 40 ? '#4ade80' : stateRef.current.power < 70 ? '#fbbf24' : '#ef4444', transition: 'width 0.1s' }} />
                  </div>
                  <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 3 }}>Sweet spot: 40–70%</div>
                </div>
              )}
            </>
          )}
        </>
      )}
      {phase === 'done' && sig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(sig)} emoji={GAME_EMOJI}
          score={`${sig.totalStrokes} strokes`} personality={getPersonality(sig)}
          insights={[
            { label: 'Holes Completed', value: `${sig.holes}/${MAX_HOLES}`, color: ACCENT },
            { label: 'Hole-in-Ones', value: `${sig.holesInOne}`, color: '#fbbf24' },
            { label: 'Sweet Spot Hits', value: `${sig.sweetSpotHits}`, color: '#4ade80' },
            { label: 'Avg Read Time', value: sig.avgReadTime > 0 ? `${sig.avgReadTime.toFixed(1)}s` : 'N/A', color: '#c084fc' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={sig.holesInOne > 0} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const PrecisionPutt = dynamic(() => Promise.resolve({ default: PrecisionPuttInner }), { ssr: false });
export default PrecisionPutt;
