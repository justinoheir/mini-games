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

const GAME_ID      = 'pulse-jump';
const ACCENT       = '#a855f7';
const DURATION     = 60;
const GAME_EMOJI   = '💫';
const GAME_TITLE   = 'Pulse Jump';
const GAME_TAGLINE = 'Tap in rhythm with the beat. Miss the pulse — fall!';

const BPM = 90;
const BEAT_MS = (60 / BPM) * 1000;

interface Signals { totalBeats: number; beatsHit: number; beatsMissed: number; maxStreak: number; streakCurrent: number; score: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const acc = sig.totalBeats > 0 ? sig.beatsHit / sig.totalBeats : 0;
  if (acc >= 0.85 && sig.maxStreak >= 10) return 'Rhythm God 🎵';
  if (acc >= 0.70) return 'Beat Keeper 🥁';
  if (sig.maxStreak >= 8) return 'Streak Surfer 🌊';
  if (sig.beatsHit >= 20) return 'Persistent Hopper 🐇';
  return 'Off-Beat Explorer 🎲';
}

interface Obstacle3D { mesh: THREE.Mesh; passed: boolean; }
interface Particle3D { mesh: THREE.Mesh; vy: number; vx: number; life: number; }

function PulseJumpGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const charRef = useRef<THREE.Mesh | null>(null);
  const beatRingRef = useRef<THREE.Mesh | null>(null);
  const obstaclesRef = useRef<Obstacle3D[]>([]);
  const particlesRef = useRef<Particle3D[]>([]);
  const groundLineRef = useRef<THREE.Mesh | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { totalBeats: 0, beatsHit: 0, beatsMissed: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    charY: 0, charVY: 0, isGrounded: true,
    gameSpeed: 0.06, nextBeatTime: 0, groundY: -1.5,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [beatPulse, setBeatPulse] = useState(false);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef2 = useRef<PlayerSession | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const doJump = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || !s.isGrounded) return;
    const now = Date.now();
    const timeToBeat = Math.abs(now - s.nextBeatTime);
    const onBeat = timeToBeat < 200;
    s.charVY = 0.12; s.isGrounded = false;
    if (onBeat) {
      s.sig.beatsHit++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      sfx.collect(); haptic([30]);
      for (let i = 0; i < 8; i++) {
        const geo = new THREE.SphereGeometry(0.06, 6, 6);
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x4a1a7f }));
        mesh.position.set(-2, s.groundY, 0);
        sceneRef.current?.add(mesh);
        particlesRef.current.push({ mesh, vx: (Math.random()-0.5)*0.06, vy: 0.04+Math.random()*0.06, life: 1 });
      }
    } else {
      s.sig.beatsMissed++; s.sig.streakCurrent = 0;
      sfx.collision(); haptic([20, 30, 20]);
    }
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (beatRef.current) { clearInterval(beatRef.current); beatRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalBeats: 0, beatsHit: 0, beatsMissed: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.charY = 0; s.charVY = 0; s.isGrounded = true; s.gameSpeed = 0.06;
    s.nextBeatTime = Date.now() + BEAT_MS;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d1a);
    scene.fog = new THREE.Fog(0x0d0d1a, 15, 30);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 60);
    camera.position.set(0, 1, 9);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x1a0a2e, 3));
    const pLight = new THREE.PointLight(0xa855f7, 80, 20);
    pLight.position.set(-2, 3, 6);
    scene.add(pLight);
    scene.add(Object.assign(new THREE.PointLight(0x6366f1, 40, 15), { position: new THREE.Vector3(3, 1, 5) }));

    // Stars
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(500);
    for (let i = 0; i < 500; i += 3) { sp[i] = (Math.random()-0.5)*40; sp[i+1] = (Math.random()-0.5)*20; sp[i+2] = -8 - Math.random()*10; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.05 })));

    // Ground
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.9 });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(30, 0.15, 3), groundMat);
    ground.position.y = s.groundY - 0.075;
    scene.add(ground);
    // Neon ground line
    const glowGeo = new THREE.BoxGeometry(30, 0.04, 0.3);
    const glowMesh = new THREE.Mesh(glowGeo, new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 1 }));
    glowMesh.position.y = s.groundY;
    scene.add(glowMesh);
    groundLineRef.current = glowMesh;

    // Character (glowing sphere)
    const charGeo = new THREE.SphereGeometry(0.28, 24, 24);
    const charMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x6b21a8, roughness: 0.2, metalness: 0.5 });
    const char = new THREE.Mesh(charGeo, charMat);
    char.position.set(-2, s.groundY + 0.28, 0);
    char.castShadow = true;
    scene.add(char);
    charRef.current = char;

    // Beat ring (expanding at beat moments)
    const ringGeo = new THREE.TorusGeometry(0.5, 0.04, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 0, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(-2, s.groundY + 0.28, 0);
    scene.add(ring);
    beatRingRef.current = ring;

    // Background elements
    for (let i = 0; i < 8; i++) {
      const bh = 1 + Math.random() * 3;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, bh, 0.5), new THREE.MeshStandardMaterial({ color: 0x0d0d22 }));
      b.position.set(-8 + i * 2.5, s.groundY + bh / 2 - 0.1, -3);
      scene.add(b);
    }

    const onPointerDown = () => { if (stateRef.current.running) doJump(); };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    beatRef.current = setInterval(() => {
      if (!s.running) return;
      s.sig.totalBeats++;
      s.nextBeatTime = Date.now() + BEAT_MS;
      setBeatPulse(p => !p);
      if (Math.random() < 0.4) {
        const obsGeo = new THREE.BoxGeometry(0.35, 0.5 + Math.random() * 0.5, 0.35);
        const obsMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x5f1a1a, roughness: 0.5 });
        const obsMesh = new THREE.Mesh(obsGeo, obsMat);
        obsMesh.position.set(8, s.groundY + obsMesh.geometry.parameters.height / 2, 0);
        scene.add(obsMesh);
        obstaclesRef.current.push({ mesh: obsMesh, passed: false });
      }
      s.gameSpeed = Math.min(0.15, 0.06 + s.sig.totalBeats * 0.0008);
      if (beatRingRef.current) {
        beatRingRef.current.scale.setScalar(1.5);
        (beatRingRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
      }
    }, BEAT_MS);

    const GRAVITY = 0.008;
    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.01;

      if (!s.isGrounded) {
        s.charVY -= GRAVITY; s.charY += s.charVY;
        if (s.charY <= 0) { s.charY = 0; s.charVY = 0; s.isGrounded = true; }
      }
      if (char) { char.position.y = s.groundY + 0.28 + s.charY; char.rotation.y += 0.05; }

      // Beat ring fade
      if (beatRingRef.current) {
        const mat = beatRingRef.current.material as THREE.MeshStandardMaterial;
        beatRingRef.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
        mat.emissiveIntensity = Math.max(0, mat.emissiveIntensity - 0.1);
      }

      // Obstacles
      for (let i = obstaclesRef.current.length - 1; i >= 0; i--) {
        const obs = obstaclesRef.current[i];
        obs.mesh.position.x -= s.gameSpeed;
        if (obs.mesh.position.x < -8) { scene.remove(obs.mesh); obstaclesRef.current.splice(i, 1); continue; }
        // Collision
        const dx = Math.abs(obs.mesh.position.x - (-2));
        const charTop = s.groundY + 0.28 + s.charY + 0.28;
        const obsTop = s.groundY + (obs.mesh.geometry as THREE.BoxGeometry).parameters.height;
        if (!obs.passed && dx < 0.4 && charTop > s.groundY + 0.56 && charTop < obsTop + 0.1) {
          obs.passed = true; s.sig.streakCurrent = 0;
          sfx.fail(); haptic([20, 30, 20]);
        }
        if (!obs.passed && obs.mesh.position.x < -2.5) obs.passed = true;
      }

      // Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.vy -= 0.003;
        p.life -= 0.025;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life;
        (p.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        if (p.life <= 0.05) { scene.remove(p.mesh); particlesRef.current.splice(i, 1); }
      }

      pLight.position.x = Math.sin(t * 0.5) * 3;
      pLight.intensity = 50 + Math.sin(t * (BPM / 60) * Math.PI) * 30;
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => { renderer.domElement.removeEventListener('pointerdown', onPointerDown); };
  }, [endGame, doJump]);

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
      if (beatRef.current) clearInterval(beatRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
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
    if (beatRef.current) { clearInterval(beatRef.current); beatRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    obstaclesRef.current = []; particlesRef.current = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  const buildInsights = (sig: Signals) => {
    const acc = sig.totalBeats > 0 ? Math.round((sig.beatsHit / sig.totalBeats) * 100) : 0;
    return [
      { label: 'Beat Accuracy', value: `${acc}%`, color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Best Streak', value: `×${sig.maxStreak}`, color: ACCENT },
      { label: 'Beats Hit', value: `${sig.beatsHit}`, color: ACCENT },
      { label: 'Missed', value: `${sig.beatsMissed}`, color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%, rgba(168,85,247,0.12) 0%, transparent 60%), linear-gradient(180deg, #0d0d1a 0%, #080810 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Feel the Beat" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={accent} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
                { label: 'SCORE', value: scoreDisplay },
              ]} />
              <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)',
                color: beatPulse ? accent : 'rgba(255,255,255,0.3)', fontSize: 14, fontWeight: 900,
                pointerEvents: 'none', transition: 'color 0.1s', textShadow: beatPulse ? `0 0 20px ${accent}` : 'none' }}>
                TAP THE BEAT ♪
              </div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={accent}
            onPlayAgain={handlePlayAgain} didWin={finalSig.beatsHit >= 15} />
          <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, gameId, { personality, score: sig.score, beatsHit: sig.beatsHit, maxStreak: sig.maxStreak }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const PulseJumpGame = dynamic(() => Promise.resolve({ default: PulseJumpGameInner }), { ssr: false });
export default PulseJumpGame;
