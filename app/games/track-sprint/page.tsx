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

const GAME_ID = 'track-sprint';
const ACCENT = '#f59e0b';
const DURATION = 30;
const GAME_EMOJI = '🏃';
const GAME_TITLE = 'Track Sprint';
const GAME_TAGLINE = 'Alternate taps. Stay in your lane!';

interface Signals { totalSteps: number; laneViolations: number; maxSpeed: number; finishes: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals) {
  if (sig.finishes >= 3 && sig.laneViolations === 0) return 'Sprint Maestro 🥇';
  if (sig.maxSpeed >= 15) return 'Speed Demon ⚡';
  if (sig.maxStreak >= 8) return 'Rhythm Runner 🎵';
  return 'Training Hard 💪';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function TrackSprintInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    sig: { totalSteps: 0, laneViolations: 0, maxSpeed: 0, finishes: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    runnerX: 0, runnerZ: 0, speed: 0, distance: 0,
    lastTapSide: null as 'left' | 'right' | null,
    frame: 0, legAngle: 0,
    trackOffset: 0, // scroll
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
    s.sig = { totalSteps: 0, laneViolations: 0, maxSpeed: 0, finishes: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.speed = 0; s.distance = 0; s.lastTapSide = null; s.trackOffset = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0f0800);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0f0800, 20, 50);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 5, 10);
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

    scene.add(new THREE.AmbientLight(0x221100, 2));
    const stadiumLight = new THREE.PointLight(0xf59e0b, 3, 30);
    stadiumLight.position.set(0, 10, 0);
    scene.add(stadiumLight);
    const sideLight = new THREE.PointLight(0xfbbf24, 2, 20);
    sideLight.position.set(5, 5, -5);
    scene.add(sideLight);

    // Track surface
    const trackGeo = new THREE.PlaneGeometry(12, 60);
    const trackMat = new THREE.MeshStandardMaterial({ color: 0xc2832a, roughness: 0.9 });
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.rotation.x = -Math.PI / 2;
    track.receiveShadow = true;
    scene.add(track);

    // Lane dividers
    for (let i = -3; i <= 3; i += 1.5) {
      const divGeo = new THREE.PlaneGeometry(0.08, 60);
      const divMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
      const div = new THREE.Mesh(divGeo, divMat);
      div.rotation.x = -Math.PI / 2;
      div.position.set(i, 0.01, 0);
      scene.add(div);
    }

    // Runner body parts
    const runnerGroup = new THREE.Group();
    scene.add(runnerGroup);

    const torsoGeo = new THREE.CapsuleGeometry(0.22, 0.7, 8, 16);
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0x1f2937 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.castShadow = true;
    runnerGroup.add(torso);

    const headGeo = new THREE.SphereGeometry(0.22, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfde68a });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.75;
    runnerGroup.add(head);

    const legGeo = new THREE.CapsuleGeometry(0.1, 0.6, 6, 8);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.18, -0.6, 0);
    rightLeg.position.set(0.18, -0.6, 0);
    runnerGroup.add(leftLeg); runnerGroup.add(rightLeg);

    const armGeo = new THREE.CapsuleGeometry(0.08, 0.5, 6, 8);
    const armMat = new THREE.MeshStandardMaterial({ color: 0xfde68a });
    const leftArm = new THREE.Mesh(armGeo, armMat);
    const rightArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.35, 0.1, 0);
    rightArm.position.set(0.35, 0.1, 0);
    runnerGroup.add(leftArm); runnerGroup.add(rightArm);

    runnerGroup.position.set(0, 0.8, 2);

    // Finish line markers (scroll with track)
    const finishLines: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const finGeo = new THREE.PlaneGeometry(12, 0.3);
      const finMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.5 });
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.rotation.x = -Math.PI / 2;
      fin.position.set(0, 0.02, -20 + i * (-20));
      scene.add(fin);
      finishLines.push(fin);
    }

    // Speed glow ring
    const speedRingGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 32);
    const speedRingMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.8, transparent: true, opacity: 0 });
    const speedRing = new THREE.Mesh(speedRingGeo, speedRingMat);
    runnerGroup.add(speedRing);
    speedRing.rotation.x = Math.PI / 2;
    speedRing.position.y = 0.1;

    const handleTap = (side: 'left' | 'right') => {
      const s = stateRef.current;
      if (side !== s.lastTapSide) {
        s.speed = Math.min(15, s.speed + 0.8);
        s.sig.totalSteps++; s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        hapticTick(); sfx.click();
      } else {
        s.speed *= 0.9; s.sig.laneViolations++; hapticFail();
      }
      s.lastTapSide = side;
    };
    (renderer.domElement as any)._handleTap = handleTap;

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const TRACK_LENGTH = 1000;
    const loop = () => {
      if (!s.running) return;
      s.frame++;
      s.speed *= 0.97;
      s.distance += s.speed * 0.8;
      if (s.speed > s.sig.maxSpeed) s.sig.maxSpeed = s.speed;

      // Scroll track
      s.trackOffset = (s.trackOffset + s.speed * 0.05) % 60;

      if (s.distance >= TRACK_LENGTH) {
        s.sig.finishes++;
        const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
        const pts = 5 * mult;
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        sfx.success(); hapticScore();
        s.distance = 0; s.speed *= 0.5;
      }

      // Animate legs
      const legSwing = Math.sin(s.frame * 0.3) * Math.min(s.speed * 0.15, 0.8);
      leftLeg.rotation.x = legSwing;
      rightLeg.rotation.x = -legSwing;
      leftArm.rotation.x = -legSwing * 0.7;
      rightArm.rotation.x = legSwing * 0.7;

      // Speed ring visibility
      const speedPct = s.speed / 15;
      speedRingMat.opacity = speedPct * 0.7;
      speedRing.scale.setScalar(1 + speedPct * 0.5);

      // Finish lines scroll
      const pct = s.distance / TRACK_LENGTH;
      finishLines.forEach((fl, i) => {
        fl.position.z = 2 - (1 - pct) * 40 + i * 20;
      });

      // Track scrolling effect
      (trackMat as THREE.MeshStandardMaterial).roughness = 0.9;

      // Camera bob with running speed
      camera.position.y = 5 + Math.sin(s.frame * 0.3) * (s.speed * 0.01);

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    const onDown = (e: PointerEvent) => {
      const side: 'left' | 'right' = e.clientX < W / 2 ? 'left' : 'right';
      const h = (renderer.domElement as any)._handleTap;
      if (h) h(side);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
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
        description="Alternate LEFT and RIGHT taps to sprint! Don't tap the same side twice!" ctaLabel="Sprint! 🏃" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Finishes', value: String(finalSig.finishes), color: ACCENT }, { label: 'Total Steps', value: String(finalSig.totalSteps), color: '#4ade80' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' }, { label: 'Lane Fouls', value: String(finalSig.laneViolations), color: '#ef4444' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.finishes >= 2} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const TrackSprint = dynamic(() => Promise.resolve({ default: TrackSprintInner }), { ssr: false });
export default TrackSprint;
