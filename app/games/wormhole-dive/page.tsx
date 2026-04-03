'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'wormhole-dive';
const ACCENT = '#7c3aed';
const DURATION = 60;
const GAME_EMOJI = '🌀';
const GAME_TITLE = 'Wormhole Dive';
const GAME_TAGLINE = 'Survive the warp. Keep diving.';

interface Signals { ringsHit: number; ringsMissed: number; closePasses: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(s: Signals): string {
  if (s.ringsHit >= 30 && s.closePasses >= 10) return 'Wormhole Ace 🌟';
  if (s.ringsHit >= 25) return 'Space Diver 🚀';
  if (s.ringsMissed >= 10) return 'Wall Kisser 💥';
  if (s.maxStreak >= 12) return 'Tunnel Vision 🎯';
  return 'Deep Space Cadet 🪐';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

const RING_COLORS = [0x7c3aed, 0xa855f7, 0x00ffff, 0x818cf8, 0xc084fc];

interface Ring3D { mesh: THREE.Mesh; z: number; cx: number; cy: number; outerR: number; innerR: number; color: number; passed: boolean; }

export default function WormholeDive() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    sig: { ringsHit: 0, ringsMissed: 0, closePasses: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    shipX: 0, shipY: 0, targetX: 0, targetY: 0,
    rings: [] as Ring3D[],
    ringTimer: 0, speed: 0.08, frame: 0,
    shakeX: 0, shakeY: 0,
    shipMesh: null as THREE.Mesh | null,
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
    s.sig = { ringsHit: 0, ringsMissed: 0, closePasses: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.shipX = 0; s.shipY = 0; s.targetX = 0; s.targetY = 0;
    s.rings = []; s.ringTimer = 0; s.speed = 0.08; s.shakeX = 0; s.shakeY = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.015);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 200);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, -10);

    scene.add(new THREE.AmbientLight(0x111122, 2));
    const warpLight = new THREE.PointLight(0x7c3aed, 5, 30);
    warpLight.position.set(0, 0, -5);
    scene.add(warpLight);
    const sLight = new THREE.PointLight(0x00ffff, 2, 20);
    sLight.position.set(3, 3, -10);
    scene.add(sLight);

    // Starfield (warp speed)
    const starCount = 2000;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 2] = Math.random() * -100;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Tunnel walls (wormhole effect)
    for (let i = 0; i < 8; i++) {
      const tubeGeo = new THREE.TorusGeometry(3.5, 0.05, 8, 32);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: RING_COLORS[i % RING_COLORS.length], transparent: true, opacity: 0.15,
        emissive: RING_COLORS[i % RING_COLORS.length], emissiveIntensity: 0.5
      });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.position.z = -i * 8;
      scene.add(tube);
    }

    // Ship
    const shipGeo = new THREE.ConeGeometry(0.25, 0.8, 8);
    const shipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.7, emissive: 0x7c3aed, emissiveIntensity: 0.4 });
    const ship = new THREE.Mesh(shipGeo, shipMat);
    ship.rotation.x = Math.PI / 2;
    scene.add(ship);
    s.shipMesh = ship;

    // Engine glow
    const engineGeo = new THREE.SphereGeometry(0.18, 12, 12);
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1 });
    const engine = new THREE.Mesh(engineGeo, engineMat);
    engine.position.z = 0.4;
    ship.add(engine);

    // Engine light
    const engineLight = new THREE.PointLight(0x00ffff, 2, 5);
    engineLight.position.z = 0.5;
    ship.add(engineLight);

    const spawnRing = () => {
      const colorIdx = Math.floor(Math.random() * RING_COLORS.length);
      const color = RING_COLORS[colorIdx];
      const outerR = 1.8 + Math.random() * 0.8;
      const innerR = outerR * (0.45 + Math.random() * 0.15);
      const cx = (Math.random() - 0.5) * 2.5;
      const cy = (Math.random() - 0.5) * 2.5;

      const geo = new THREE.TorusGeometry(outerR, 0.12, 16, 64);
      const mat = new THREE.MeshStandardMaterial({
        color, roughness: 0.2, metalness: 0.5,
        emissive: color, emissiveIntensity: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, cy, -60);
      scene.add(mesh);

      // Add inner ring glow
      const innerGeo = new THREE.TorusGeometry(innerR, 0.05, 8, 32);
      const innerMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1, transparent: true, opacity: 0.5 });
      const innerRing = new THREE.Mesh(innerGeo, innerMat);
      mesh.add(innerRing);

      s.rings.push({ mesh, z: -60, cx, cy, outerR, innerR, color, passed: false });
    };

    // Touch controls
    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / W - 0.5) * 5;
      const ny = -(e.clientY / H - 0.5) * 4;
      s.targetX = Math.max(-3, Math.min(3, nx));
      s.targetY = Math.max(-2.5, Math.min(2.5, ny));
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onMove);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const diff = (DURATION - s.timeLeft) / DURATION;
      s.speed = 0.08 + diff * 0.08;

      // Ship follows target
      s.shipX += (s.targetX - s.shipX) * 0.12;
      s.shipY += (s.targetY - s.shipY) * 0.12;

      // Shake decay
      s.shakeX *= 0.85; s.shakeY *= 0.85;

      if (ship) {
        ship.position.set(s.shipX + s.shakeX, s.shipY + s.shakeY, 0);
        ship.rotation.z = (s.targetX - s.shipX) * 0.2;
        ship.rotation.x = Math.PI / 2 + (s.shipY) * 0.05;
      }

      // Scroll stars (warp effect)
      stars.position.z = (stars.position.z + s.speed * 3) % 100;

      // Spawn rings
      s.ringTimer++;
      if (s.ringTimer % 80 === 0) spawnRing();

      // Move & check rings
      for (let i = s.rings.length - 1; i >= 0; i--) {
        const r = s.rings[i];
        r.z += s.speed * 5;
        r.mesh.position.z = r.z;
        r.mesh.rotation.z += 0.01;

        // Check if ship passed through ring
        if (!r.passed && r.z > 1 && r.z < 4) {
          const dx = s.shipX - r.cx;
          const dy = s.shipY - r.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= r.innerR) {
            // HIT - through the ring!
            r.passed = true;
            s.sig.ringsHit++; s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            if (dist < r.innerR * 0.3) s.sig.closePasses++;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += mult; setScoreDisplay(s.sig.score);
            sfx.collect(); hapticScore();
            // Flash ring
            (r.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 2;
            setTimeout(() => {
              if (r.mesh.material) (r.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
            }, 150);
          } else if (dist > r.innerR && dist <= r.outerR + 0.3) {
            // MISS - hit the ring wall
            if (!r.passed) {
              r.passed = true;
              s.sig.ringsMissed++; s.sig.streakCurrent = 0;
              sfx.collision(); hapticFail();
              s.shakeX = (Math.random() - 0.5) * 0.5;
              s.shakeY = (Math.random() - 0.5) * 0.5;
              (r.mesh.material as THREE.MeshStandardMaterial).color.setHex(0xef4444);
            }
          }
        }

        // Remove far rings
        if (r.z > 8) {
          scene.remove(r.mesh);
          s.rings.splice(i, 1);
        }
      }

      // Warp light pulse
      warpLight.intensity = 5 + Math.sin(s.frame * 0.08) * 2;
      warpLight.color.setHSL(0.76 + Math.sin(s.frame * 0.01) * 0.1, 0.9, 0.6);

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
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
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 50%, #1a0a2e 0%, #0a0a1a 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Dive In! 🌀" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Rings Hit', value: String(finalSig.ringsHit), color: '#4ade80' }, { label: 'Rings Missed', value: String(finalSig.ringsMissed), color: '#ef4444' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: accent }, { label: 'Close Passes', value: String(finalSig.closePasses), color: '#fbbf24' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.ringsHit >= 20} />
      )}
    </GameShell>
  );
}
