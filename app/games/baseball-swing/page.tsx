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

const GAME_ID = 'baseball-swing';
const ACCENT = '#fbbf24';
const DURATION = 45;
const GAME_EMOJI = '⚾';
const GAME_TITLE = 'Baseball Swing';
const GAME_TAGLINE = 'Time your swing. Hit it out of the park!';
const MUSIC_PAT: import('@/lib/audio').MusicPattern = 'sports';
const PB_KEY = 'mg_pb_baseball-swing';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  if (acc >= 0.7 && sig.maxStreak >= 4) return '⚾ Home Run Hero';
  if (acc >= 0.55) return '🪄 Clutch Hitter';
  if (sig.maxStreak >= 4) return '🔥 Hot Bat';
  if (sig.hits < 3) return '⚡ Three Strikes';
  return '🏟️ Solid Contact';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

type PitchType = 'fastball' | 'curveball' | 'slider';
interface Pitch {
  t: number; speed: number; type: PitchType;
  startX: number; endX: number; curve: number;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  animId: number;
  ball: THREE.Mesh | null;
  ballTrail: THREE.Mesh[];
  bat: THREE.Group | null;
  pitchState: 'idle' | 'incoming' | 'hit' | 'miss';
  pitch: Pitch | null;
  strikes: number;
  batSwinging: boolean; batAngle: number; batT: number;
  hitType: '' | 'homer' | 'hit';
  popText: string; popAlpha: number;
  hitAnim: number;
  lastTs: number;
  frame: number;
  pitchLabel: string;
  intervalId: ReturnType<typeof setInterval> | null;
  stopMusic: (() => void) | null;
  strikeZoneMesh: THREE.Mesh | null;
  particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
  textSprites: Array<{ sprite: THREE.Sprite; life: number; vy: number }>;
}

function BaseballSwingGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const swipeStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    ball: null, ballTrail: [], bat: null,
    pitchState: 'idle', pitch: null, strikes: 0,
    batSwinging: false, batAngle: 0, batT: 0,
    hitType: '', popText: '', popAlpha: 0,
    hitAnim: 0, lastTs: 0, frame: 0, pitchLabel: '',
    intervalId: null, stopMusic: null, strikeZoneMesh: null,
    particles: [], textSprites: [],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const newPitch = useCallback(() => {
    const s = stateRef.current;
    if (!s.ball || !s.scene) return;
    const types: PitchType[] = ['fastball', 'curveball', 'slider'];
    const type = types[Math.floor(Math.random() * (s.sig.hits < 3 ? 1 : 3))];
    const speedBase = 0.006 + Math.min(s.sig.hits * 0.0003, 0.005);
    s.pitch = {
      t: 0, type,
      speed: speedBase + (type === 'fastball' ? 0.002 : 0),
      startX: 0,
      endX: (type === 'slider' ? 1.2 : type === 'curveball' ? -1.0 : 0) + (Math.random() - 0.5) * 0.4,
      curve: type === 'curveball' ? 1.5 : type === 'slider' ? 1.0 : 0,
    };
    s.pitchLabel = type.charAt(0).toUpperCase() + type.slice(1);
    s.pitchState = 'incoming';
    s.sig.attempts++;
    // Reset ball position to pitcher's mound
    s.ball.position.set(s.pitch.startX, 2.5, -25);
    s.ball.visible = true;
    s.ball.scale.setScalar(0.15);
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    s.frame = 0; s.strikes = 0; s.particles = []; s.textSprites = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(0x0d0a04);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0d1a08, 0.015);
    s.scene = scene;

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 1.5, 8);
    camera.lookAt(0, 1.5, 0);
    s.camera = camera;

    // Lighting
    scene.add(new THREE.AmbientLight(0x334422, 1.5));
    const sunLight = new THREE.DirectionalLight(0xffffff, 2);
    sunLight.position.set(5, 15, 5);
    sunLight.castShadow = true;
    scene.add(sunLight);
    const stadiumLight1 = new THREE.PointLight(0xffeebb, 2, 40);
    stadiumLight1.position.set(-8, 12, 0);
    scene.add(stadiumLight1);
    const stadiumLight2 = new THREE.PointLight(0xffeebb, 2, 40);
    stadiumLight2.position.set(8, 12, 0);
    scene.add(stadiumLight2);
    const rimLight = new THREE.PointLight(0x44aaff, 0.8, 30);
    rimLight.position.set(0, 8, -10);
    scene.add(rimLight);

    // Field ground
    const fieldGeo = new THREE.PlaneGeometry(40, 60);
    const fieldMat = new THREE.MeshStandardMaterial({ color: 0x1a4a0a, roughness: 0.9 });
    const field = new THREE.Mesh(fieldGeo, fieldMat);
    field.rotation.x = -Math.PI / 2;
    field.receiveShadow = true;
    scene.add(field);

    // Infield dirt
    const dirtGeo = new THREE.CylinderGeometry(6, 6, 0.02, 32);
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x8b6340, roughness: 0.9 });
    const dirt = new THREE.Mesh(dirtGeo, dirtMat);
    dirt.position.set(0, 0.01, 0);
    scene.add(dirt);

    // Pitcher's mound
    const moundGeo = new THREE.CylinderGeometry(1, 1.3, 0.25, 16);
    const moundMat = new THREE.MeshStandardMaterial({ color: 0xa07040, roughness: 0.9 });
    const mound = new THREE.Mesh(moundGeo, moundMat);
    mound.position.set(0, 0.1, -18);
    scene.add(mound);

    // Home plate
    const plateGeo = new THREE.BoxGeometry(0.5, 0.02, 0.4);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(0, 0.01, 6.5);
    scene.add(plate);

    // Strike zone (translucent)
    const szGeo = new THREE.BoxGeometry(0.8, 1.2, 0.05);
    const szMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    const strikeZone = new THREE.Mesh(szGeo, szMat);
    strikeZone.position.set(0, 1.4, 6.3);
    scene.add(strikeZone);
    s.strikeZoneMesh = strikeZone;
    // Strike zone wireframe
    const szEdge = new THREE.EdgesGeometry(szGeo);
    const szLine = new THREE.LineSegments(szEdge, new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5 }));
    szLine.position.copy(strikeZone.position);
    scene.add(szLine);

    // Baseball
    const ballGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.6, metalness: 0 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.set(0, 2.5, -25);
    ball.visible = false;
    ball.castShadow = true;
    scene.add(ball);
    s.ball = ball;

    // Bat group
    const bat = new THREE.Group();
    const handleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.7 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.5;
    bat.add(handle);
    const barrelGeo = new THREE.CylinderGeometry(0.12, 0.06, 0.6, 12);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5, metalness: 0.1 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.y = 1.1;
    bat.add(barrel);
    bat.position.set(0.6, 0.8, 6);
    bat.rotation.z = -0.3;
    scene.add(bat);
    s.bat = bat;

    // Ball trail meshes
    s.ballTrail = [];
    for (let i = 0; i < 8; i++) {
      const tGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const tMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
      const tMesh = new THREE.Mesh(tGeo, tMat);
      scene.add(tMesh);
      s.ballTrail.push(tMesh);
    }

    // Resize handler
    const onResize = () => {
      const W2 = mount.clientWidth || window.innerWidth;
      const H2 = mount.clientHeight || window.innerHeight;
      renderer.setSize(W2, H2);
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    (s as unknown as { _resizeCleanup: () => void })._resizeCleanup = () => window.removeEventListener('resize', onResize);

    s.stopMusic = startMusic(MUSIC_PAT);
    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);

    setTimeout(() => newPitch(), 800);

    const loop = (ts: number) => {
      if (!s.running) return;
      const dt = s.lastTs ? Math.min((ts - s.lastTs) / 16.67, 3) : 1;
      s.lastTs = ts; s.frame++;

      // Animate pitch
      if (s.pitch && s.pitchState === 'incoming' && s.ball) {
        s.pitch.t += s.pitch.speed * dt;
        if (s.pitch.t > 1) {
          // Ball passed — auto strike
          sfx.nearMiss(); haptic([20, 30, 20]);
          s.pitchState = 'miss'; s.strikes++;
          s.sig.streakCurrent = 0;
          s.ball.visible = false;
          setTimeout(() => { s.pitchState = 'idle'; s.pitch = null; if (s.running) setTimeout(() => newPitch(), 600); }, 500);
        } else {
          const t = s.pitch.t;
          const cpX = s.pitch.curve * Math.sin(t * Math.PI) * 0.5;
          const ballX = s.pitch.startX * (1 - t) + s.pitch.endX * t + cpX;
          const ballZ = -25 + t * 32;
          const ballY = 2.5 - t * 1.2 + Math.sin(t * Math.PI) * 0.3;
          s.ball.position.set(ballX, ballY, ballZ);
          s.ball.scale.setScalar(0.15 + t * 0.6);
          s.ball.rotation.x += 0.15 * dt;
          // Trail
          for (let i = s.ballTrail.length - 1; i > 0; i--) {
            s.ballTrail[i].position.copy(s.ballTrail[i - 1].position);
            (s.ballTrail[i].material as THREE.MeshBasicMaterial).opacity = (1 - i / s.ballTrail.length) * 0.35 * t;
          }
          s.ballTrail[0].position.copy(s.ball.position);
          // Pulse strike zone when ball approaching
          if (t > 0.7) {
            const pulse = 0.1 + 0.1 * Math.sin(ts / 80);
            (s.strikeZoneMesh!.material as THREE.MeshBasicMaterial).opacity = pulse + 0.1;
          }
        }
      }

      // Bat swing animation
      if (s.batSwinging && s.bat) {
        s.batT += 0.08 * dt;
        const swingAngle = Math.sin(s.batT * Math.PI) * 2.2;
        s.bat.rotation.z = -0.3 - swingAngle;
        if (s.batT >= 1) { s.batSwinging = false; s.bat.rotation.z = -0.3; }
      }

      // Particles
      s.particles = s.particles.filter(p => {
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy -= 0.02 * dt;
        p.life -= dt;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, p.life / 30);
        if (p.life <= 0) { scene.remove(p.mesh); return false; }
        return true;
      });

      // Text sprites
      s.textSprites = s.textSprites.filter(ts2 => {
        ts2.sprite.position.y += ts2.vy * dt;
        ts2.life -= dt;
        ts2.sprite.material.opacity = Math.max(0, ts2.life / 60);
        if (ts2.life <= 0) { scene.remove(ts2.sprite); return false; }
        return true;
      });

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, newPitch]);

  const doSwing = useCallback((swipeVelX: number) => {
    const s = stateRef.current;
    if (!s.running || s.pitchState !== 'incoming' || !s.pitch) return;
    if (s.batSwinging) return;
    const t = s.pitch.t;
    const perfect = t >= 0.72 && t <= 0.88;
    const ok = t >= 0.62 && t <= 0.92;
    s.batSwinging = true; s.batT = 0;
    s.sig.reactionTimes.push(Date.now());

    if (perfect) {
      s.hitType = 'homer'; s.pitchState = 'hit';
      sfx.success(); haptic([40, 20, 80]);
      s.sig.hits++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.sig.streakCurrent >= 3 ? 4 : 3;
      s.sig.score += pts; setScoreDisplay(s.sig.score);
      // Spawn burst particles
      if (s.ball && s.scene) {
        for (let i = 0; i < 12; i++) {
          const pGeo = new THREE.SphereGeometry(0.07, 6, 6);
          const pMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1, transparent: true, opacity: 1 });
          const pMesh = new THREE.Mesh(pGeo, pMat);
          pMesh.position.copy(s.ball.position);
          s.scene.add(pMesh);
          const angle = (i / 12) * Math.PI * 2;
          s.particles.push({ mesh: pMesh, vx: Math.cos(angle) * 0.25 + swipeVelX * 0.1, vy: 0.2 + Math.random() * 0.2, vz: -0.1 - Math.random() * 0.2, life: 30 });
        }
      }
    } else if (ok) {
      s.hitType = 'hit'; s.pitchState = 'hit';
      sfx.collect(); haptic([30]);
      s.sig.hits++; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
      s.sig.score += pts; setScoreDisplay(s.sig.score);
    } else {
      s.hitType = ''; s.pitchState = t < 0.55 ? 'miss' : 'miss';
      sfx.nearMiss(); haptic([20, 30, 20]);
      s.sig.streakCurrent = 0; s.strikes++;
    }

    if (s.ball) s.ball.visible = false;
    setTimeout(() => {
      s.batSwinging = false;
      s.pitchState = 'idle'; s.pitch = null; s.hitType = '';
      if (s.running) setTimeout(() => newPitch(), 500);
    }, 700);
  }, [newPitch]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const onDown = (e: PointerEvent) => {
      swipeStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    };
    const onUp = (e: PointerEvent) => {
      if (!swipeStartRef.current || phase !== 'playing') return;
      const dx = e.clientX - swipeStartRef.current.x;
      const dt = Date.now() - swipeStartRef.current.t;
      swipeStartRef.current = null;
      if (Math.abs(dx) > 20 || dt < 200) doSwing(dx / Math.max(dt, 50));
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointerup', onUp);
    return () => { mount.removeEventListener('pointerdown', onDown); mount.removeEventListener('pointerup', onUp); };
  }, [phase, doSwing]);

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
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits / sig.attempts) * 100) : 0;
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Batting Avg', value: acc + '%', color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Hits', value: String(sig.hits), color: ACCENT },
      { label: 'Hot Streak', value: '🔥' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Batter Up!" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
              { label: 'SCORE', value: scoreDisplay },
            ]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
            onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 6} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const BaseballSwingGame = dynamic(() => Promise.resolve({ default: BaseballSwingGameInner }), { ssr: false });
export default BaseballSwingGame;
