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

const GAME_ID = 'pendulum-swing';
const ACCENT = '#a855f7';
const DURATION = 60;
const GAME_EMOJI = '🕰️';
const GAME_TITLE = 'Pendulum Swing';
const GAME_TAGLINE = "Keep the rhythm. Don't let it stop.";

interface Signals {
  totalSwings: number; rhythmicSwings: number; misTimedSwings: number;
  maxAmplitude: number; maxStreak: number; streakCurrent: number; score: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const rhythm = sig.totalSwings > 0 ? sig.rhythmicSwings / sig.totalSwings : 0;
  if (rhythm >= 0.8 && sig.maxAmplitude >= 2.5) return 'Maestro 🎵';
  if (sig.maxStreak >= 8) return 'In the Zone 🌀';
  if (rhythm >= 0.6) return 'Steady Beat 🥁';
  if (sig.totalSwings >= 20) return 'Persistent 💪';
  return 'Finding the Rhythm 🎶';
}

export default function PendulumSwing() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const bobRef = useRef<THREE.Mesh | null>(null);
  const rodRef = useRef<THREE.Mesh | null>(null);
  const glowRingRef = useRef<THREE.Mesh | null>(null);
  const trailRef = useRef<THREE.Line | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { totalSwings: 0, rhythmicSwings: 0, misTimedSwings: 0, maxAmplitude: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    angle: 0.4, angularVelocity: 0.01, amplitude: 0.4,
    prevAngularVelocity: 0, pushWindow: false, pushWindowTimer: 0, lastPeakSide: 0,
    scoreTimer: 0, trailPoints: [] as THREE.Vector3[],
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [showTap, setShowTap] = useState(false);
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
    s.sig = { totalSwings: 0, rhythmicSwings: 0, misTimedSwings: 0, maxAmplitude: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.angle = 0.4; s.angularVelocity = 0.01; s.amplitude = 0.4;
    s.pushWindow = false; s.pushWindowTimer = 0; s.prevAngularVelocity = 0;
    s.scoreTimer = 0; s.trailPoints = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080612);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 100);
    camera.position.set(0, 1, 12);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    scene.add(new THREE.AmbientLight(0x1a0a2e, 3));
    const accentLight = new THREE.PointLight(0xa855f7, 80, 20);
    accentLight.position.set(0, 3, 6);
    scene.add(accentLight);
    const rimLight = new THREE.PointLight(0x6366f1, 30, 15);
    rimLight.position.set(4, -2, 4);
    scene.add(rimLight);

    // Stars
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(600);
    for (let i = 0; i < 600; i += 3) { sp[i] = (Math.random()-0.5)*50; sp[i+1] = (Math.random()-0.5)*50; sp[i+2] = (Math.random()-0.5)*10-12; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 })));

    // Clock tower structure
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a1f4a, roughness: 0.8 });
    const archGeo = new THREE.TorusGeometry(1.2, 0.15, 8, 24, Math.PI);
    const arch = new THREE.Mesh(archGeo, wallMat);
    arch.position.set(0, 3.5, 0);
    arch.rotation.z = Math.PI;
    scene.add(arch);

    // Pivot
    const pivotGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const pivotMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x4a1a7f, roughness: 0.2, metalness: 0.8 });
    const pivot = new THREE.Mesh(pivotGeo, pivotMat);
    pivot.position.set(0, 3.5, 0);
    scene.add(pivot);

    // Rod (will be repositioned dynamically)
    const rodGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 8);
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, emissive: 0x2a0a5e, metalness: 0.9, roughness: 0.1 });
    const rod = new THREE.Mesh(rodGeo, rodMat);
    scene.add(rod);
    rodRef.current = rod;

    // Bob sphere
    const bobGeo = new THREE.SphereGeometry(0.5, 32, 32);
    const bobMat = new THREE.MeshStandardMaterial({ color: 0xe879f9, emissive: 0x7c3aed, roughness: 0.1, metalness: 0.7 });
    const bob = new THREE.Mesh(bobGeo, bobMat);
    scene.add(bob);
    bobRef.current = bob;

    // Glow ring (target zone indicator)
    const ringGeo = new THREE.TorusGeometry(2.2, 0.05, 8, 48);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 0.5, transparent: true, opacity: 0.3 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 3.5;
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);
    glowRingRef.current = ring;

    // Trail line
    const trailLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.4 }),
    );
    scene.add(trailLine);
    trailRef.current = trailLine;

    // Input
    const onPointerDown = () => {
      if (!s.running) return;
      if (!s.pushWindow) {
        s.sig.misTimedSwings++;
        sfx.collision(); hapticFail();
        return;
      }
      const pushForce = 0.025;
      s.angularVelocity += s.lastPeakSide > 0 ? pushForce : -pushForce;
      s.sig.rhythmicSwings++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += 2 * mult; setScoreDisplay(s.sig.score);
      sfx.collect(); hapticScore();
      s.pushWindow = false;
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const DAMPING = 0.998, GRAVITY = 0.0028;
    const ROD_LEN = 4.5;
    const PIVOT_Y = 3.5;

    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      s.scoreTimer++;

      // Physics
      s.angularVelocity -= Math.sin(s.angle) * GRAVITY;
      s.angularVelocity *= DAMPING;
      s.angle += s.angularVelocity;

      // Peak detection
      if (Math.sign(s.angularVelocity) !== Math.sign(s.prevAngularVelocity) && s.prevAngularVelocity !== 0) {
        s.pushWindow = true; s.pushWindowTimer = 40;
        s.lastPeakSide = s.angularVelocity < 0 ? -1 : 1;
        s.sig.totalSwings++;
        hapticTick();
        setShowTap(true);
      }
      if (s.pushWindowTimer > 0) { s.pushWindowTimer--; }
      else { s.pushWindow = false; setShowTap(false); }
      s.prevAngularVelocity = s.angularVelocity;

      const currentAmp = Math.abs(s.angle);
      if (currentAmp > s.sig.maxAmplitude) s.sig.maxAmplitude = currentAmp;

      // Bob position
      const bobX = Math.sin(s.angle) * ROD_LEN;
      const bobY = PIVOT_Y - Math.cos(s.angle) * ROD_LEN;
      if (bobRef.current) {
        bobRef.current.position.set(bobX, bobY, 0);
        (bobRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + currentAmp * 2;
      }

      // Rod: position between pivot and bob
      if (rodRef.current) {
        const midX = bobX / 2, midY = PIVOT_Y - Math.cos(s.angle) * ROD_LEN / 2;
        rodRef.current.position.set(midX, midY, 0);
        rodRef.current.scale.y = ROD_LEN;
        rodRef.current.rotation.z = -s.angle;
      }

      // Trail
      s.trailPoints.push(new THREE.Vector3(bobX, bobY, 0));
      if (s.trailPoints.length > 80) s.trailPoints.shift();
      if (trailRef.current && s.trailPoints.length > 1) trailRef.current.geometry.setFromPoints(s.trailPoints);

      // Ring pulse
      if (glowRingRef.current) {
        (glowRingRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = s.pushWindow ? 2 : 0.3;
        glowRingRef.current.scale.setScalar(1 + currentAmp * 0.4);
      }

      // Passive score for amplitude
      if (s.scoreTimer % 120 === 0 && s.running) {
        const ampScore = Math.round(currentAmp * 5);
        if (ampScore > 0) { s.sig.score += ampScore; setScoreDisplay(s.sig.score); }
        if (currentAmp < 0.06) { hapticFail(); sfx.fail(); endGame(); }
      }

      accentLight.position.x = bobX * 0.5;
      accentLight.intensity = 40 + currentAmp * 60;
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => { renderer.domElement.removeEventListener('pointerdown', onPointerDown); };
  }, [endGame]);

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
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setShowTap(false);
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  const sig = stateRef.current.sig;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 0%, rgba(168,85,247,0.15) 0%, transparent 60%), linear-gradient(180deg, #080612 0%, #040308 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Swing! 🕰️" accentColor={accent} onStart={handleStart} />
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
              {showTap && (
                <div style={{ position: 'absolute', bottom: '15%', left: '50%', transform: 'translateX(-50%)',
                  color: accent, fontSize: 24, fontWeight: 900, pointerEvents: 'none',
                  textShadow: `0 0 20px ${accent}`, animation: 'pulse 0.3s ease-out' }}>
                  TAP! 🔵
                </div>
              )}
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Rhythmic Swings', value: String(finalSig.rhythmicSwings), color: accent },
            { label: 'Mis-timed', value: String(finalSig.misTimedSwings), color: '#ef4444' },
            { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
            { label: 'Max Amplitude', value: `${finalSig.maxAmplitude.toFixed(2)} rad`, color: '#4ade80' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.rhythmicSwings >= 10} />
      )}
    </GameShell>
  );
}
