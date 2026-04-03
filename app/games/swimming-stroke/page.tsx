'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticTick } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'swimming-stroke';
const ACCENT = '#0ea5e9';
const DURATION = 60;
const GAME_EMOJI = '🏊';
const GAME_TITLE = 'Swimming Stroke';
const GAME_TAGLINE = 'Alternate arms. Keep the pace.';

interface Signals { totalStrokes: number; perfectRhythm: number; rhythmBreaks: number; laps: number; maxSpeed: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals) {
  if (sig.laps >= 4 && sig.rhythmBreaks === 0) return 'Olympic Swimmer 🥇';
  if (sig.maxSpeed >= 12) return 'Speed Fish 🐠';
  if (sig.maxStreak >= 8) return 'Rhythm Master 🌊';
  return 'Pool Explorer 🏊';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function SwimmingStroke() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0, intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    sig: { totalStrokes: 0, perfectRhythm: 0, rhythmBreaks: 0, laps: 0, maxSpeed: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    speed: 0, distance: 0, lapLength: 500, lastStrokeSide: null as 'left' | 'right' | null,
    lastStrokeTime: 0, idealRhythm: 600, rhythmWindow: 150, frame: 0,
    swimmerX: -6, swimmerZ: 0,
    armAngle: 0, leftArmMesh: null as THREE.Mesh | null, rightArmMesh: null as THREE.Mesh | null,
    progressPct: 0,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { totalStrokes: 0, perfectRhythm: 0, rhythmBreaks: 0, laps: 0, maxSpeed: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.speed = 0; s.distance = 0; s.swimmerX = -6; s.lastStrokeSide = null;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.04);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 12, 16);
    // === POLISH: Responsive resize handler ===
    const _onResizeHandler = () => {
      const _W = (mountRef.current?.clientWidth || window.innerWidth);
      const _H = (mountRef.current?.clientHeight || window.innerHeight);
      renderer.setSize(_W, _H);
      if (camera instanceof THREE.PerspectiveCamera) { (camera as THREE.PerspectiveCamera).aspect = _W / _H; camera.updateProjectionMatrix(); }
    };
    window.addEventListener('resize', _onResizeHandler);
    // === END POLISH ===
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x113355, 2));
    const pLight = new THREE.PointLight(0x0ea5e9, 4, 30);
    pLight.position.set(0, 8, 0);
    scene.add(pLight);
    const pLight2 = new THREE.PointLight(0x38bdf8, 2, 20);
    pLight2.position.set(-5, 5, 5);
    scene.add(pLight2);

    // Pool floor (top-down perspective)
    const poolGeo = new THREE.PlaneGeometry(16, 14);
    const poolMat = new THREE.MeshStandardMaterial({ color: 0x0c4a6e, roughness: 0.8 });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -0.5;
    scene.add(pool);

    // Lane lines
    for (let i = -3; i <= 3; i += 1.5) {
      const laneGeo = new THREE.PlaneGeometry(0.06, 14);
      const laneMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.2, transparent: true, opacity: 0.5 });
      const lane = new THREE.Mesh(laneGeo, laneMat);
      lane.rotation.x = -Math.PI / 2;
      lane.position.set(i, -0.49, 0);
      scene.add(lane);
    }

    // Wall tiles at end
    const wallGeo = new THREE.BoxGeometry(16, 1, 0.2);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e40af, emissive: 0x1e40af, emissiveIntensity: 0.3 });
    const wallEnd = new THREE.Mesh(wallGeo, wallMat);
    wallEnd.position.set(0, 0, -7);
    scene.add(wallEnd);

    // Swimmer (top-down body)
    const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.8, 8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xfed7aa });
    const swimmer = new THREE.Mesh(bodyGeo, bodyMat);
    swimmer.rotation.x = Math.PI / 2;
    scene.add(swimmer);

    // Cap
    const capGeo = new THREE.SphereGeometry(0.27, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x0369a1 });
    const cap = new THREE.Mesh(capGeo, capMat);
    scene.add(cap);

    // Arms
    const armGeo = new THREE.CapsuleGeometry(0.1, 0.7, 6, 8);
    const lArm = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({ color: 0xfed7aa }));
    const rArm = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({ color: 0xfed7aa }));
    lArm.rotation.x = Math.PI / 2; rArm.rotation.x = Math.PI / 2;
    scene.add(lArm); scene.add(rArm);
    s.leftArmMesh = lArm; s.rightArmMesh = rArm;

    // Progress track
    const trackGeo = new THREE.PlaneGeometry(0.3, 14);
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0ea5e9, emissiveIntensity: 0.5, transparent: true, opacity: 0.4 });
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.set(2.2, -0.48, 0);
    scene.add(track);

    // Progress bar fill
    const progFillGeo = new THREE.PlaneGeometry(0.25, 1);
    const progFillMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 0.8 });
    const progFill = new THREE.Mesh(progFillGeo, progFillMat);
    progFill.rotation.x = -Math.PI / 2;
    progFill.position.set(2.2, -0.47, 6);
    scene.add(progFill);

    // Water caustic particles
    const causticCount = 80;
    const causticPos = new Float32Array(causticCount * 3);
    for (let i = 0; i < causticCount; i++) {
      causticPos[i * 3] = (Math.random() - 0.5) * 14;
      causticPos[i * 3 + 1] = -0.45;
      causticPos[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    const causticGeo = new THREE.BufferGeometry();
    causticGeo.setAttribute('position', new THREE.BufferAttribute(causticPos, 3));
    scene.add(new THREE.Points(causticGeo, new THREE.PointsMaterial({ color: 0x7dd3fc, size: 0.12, transparent: true, opacity: 0.5 })));

    const handleStroke = (side: 'left' | 'right') => {
      const now = Date.now();
      if (side === s.lastStrokeSide) {
        s.speed *= 0.8; s.sig.rhythmBreaks++; s.sig.streakCurrent = 0;
        hapticFail(); sfx.nearMiss(); return;
      }
      const timeSince = now - s.lastStrokeTime;
      const isRhythmic = s.lastStrokeTime > 0 && Math.abs(timeSince - s.idealRhythm) < s.rhythmWindow;
      if (isRhythmic) {
        s.sig.perfectRhythm++; s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        s.speed = Math.min(15, s.speed + 1.2);
      } else {
        s.speed = Math.min(15, s.speed + 0.6);
      }
      s.lastStrokeSide = side; s.lastStrokeTime = now; s.sig.totalStrokes++;
      if (s.speed > s.sig.maxSpeed) s.sig.maxSpeed = s.speed;
      hapticTick(); sfx.click();
      s.armAngle = side === 'left' ? -1.5 : 1.5;
    };
    (renderer.domElement as any)._handleStroke = handleStroke;

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      s.speed *= 0.99;
      s.distance += s.speed * 0.8;
      if (s.speed > s.sig.maxSpeed) s.sig.maxSpeed = s.speed;

      // Lap complete
      if (s.distance >= s.lapLength) {
        s.sig.laps++;
        const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
        const pts = 5 * mult;
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        sfx.success(); hapticScore();
        s.distance = 0; s.swimmerX = -6;
      }

      const progress = s.distance / s.lapLength;
      s.swimmerX = -6 + progress * 12;

      swimmer.position.set(0, 0, s.swimmerX - 6);
      cap.position.set(0, 0.28, s.swimmerX - 5.5);

      // Animate arms
      s.armAngle *= 0.85;
      const armSwing = Math.sin(s.frame * 0.25) * 0.8;
      if (lArm && rArm) {
        lArm.position.set(-0.5, 0, s.swimmerX - 6);
        lArm.rotation.z = armSwing;
        rArm.position.set(0.5, 0, s.swimmerX - 6);
        rArm.rotation.z = -armSwing;
      }

      // Progress fill
      const progLen = Math.max(0.01, progress * 14);
      progFill.scale.y = progLen;
      progFill.position.z = -7 + progLen / 2;

      // Camera follows
      camera.position.z = 16 + (s.swimmerX - 6) * 0.5;
      camera.lookAt(0, 0, s.swimmerX - 6);

      // Rhythm indicator: pLight color
      const rhythm = s.sig.totalStrokes > 0 ? s.sig.perfectRhythm / s.sig.totalStrokes : 0;
      pLight.color.setHSL(0.55 + rhythm * 0.2, 0.9, 0.6);

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    const onDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const px = e.clientX;
      const side: 'left' | 'right' = px < W / 2 ? 'left' : 'right';
      const h = (renderer.domElement as any)._handleStroke;
      if (h) h(side);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE}
        description="Tap LEFT and RIGHT alternately to swim! Keep a steady rhythm for speed!" ctaLabel="Swim! 🏊" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Laps', value: String(finalSig.laps), color: ACCENT }, { label: 'Perfect Rhythm', value: String(finalSig.perfectRhythm), color: '#4ade80' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' }, { label: 'Total Strokes', value: String(finalSig.totalStrokes), color: '#06b6d4' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.laps >= 3} />
      )}
    </GameShell>
  );
}
