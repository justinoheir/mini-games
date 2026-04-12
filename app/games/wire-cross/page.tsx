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

const GAME_ID = 'wire-cross';
const ACCENT = '#00e5ff';
const DURATION = 45;
const GAME_EMOJI = '⚡';
const GAME_TITLE = 'Wire Cross';
const GAME_TAGLINE = "Thread the ring. Don't touch the wire.";

interface Signals { totalAttempts: number; completions: number; touches: number; maxStreak: number; streakCurrent: number; avgSpeed: number; speedSum: number; score: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalAttempts > 0 ? sig.completions / sig.totalAttempts : 0;
  if (acc >= 0.8 && sig.maxStreak >= 3) return 'Surgeon 🔬';
  if (sig.touches === 0 && sig.completions >= 3) return 'Untouchable ✨';
  if (sig.avgSpeed < 3000 && acc >= 0.6) return 'Speed Demon ⚡';
  if (acc >= 0.5) return 'Steady Hand 🎯';
  return 'Learning Curve 📚';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

function WireCrossGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    sig: { totalAttempts: 0, completions: 0, touches: 0, maxStreak: 0, streakCurrent: 0, avgSpeed: 0, speedSum: 0, score: 0 } as Signals,
    ringX: -3.5, ringY: 0, dragging: false, touchedWire: false,
    startTime: 0, frame: 0,
    ringMesh: null as THREE.Mesh | null,
    glowMesh: null as THREE.Mesh | null,
    wirePoints: [] as { x: number; y: number }[],
    flashTimer: 0, flashType: 'none' as 'none' | 'hit' | 'miss',
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
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { totalAttempts: 0, completions: 0, touches: 0, maxStreak: 0, streakCurrent: 0, avgSpeed: 0, speedSum: 0, score: 0 };
    s.ringX = -3.5; s.ringY = 0; s.dragging = false; s.touchedWire = false;
    s.flashTimer = 0; s.flashType = 'none';
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 12);
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

    scene.add(new THREE.AmbientLight(0x111133, 2));
    const neonLight = new THREE.PointLight(0x00e5ff, 4, 25);
    neonLight.position.set(0, 5, 5);
    scene.add(neonLight);
    const redLight = new THREE.PointLight(0xef4444, 0, 15); // activates on touch
    redLight.position.set(0, 0, 3);
    scene.add(redLight);

    // Background grid (circuit board feel)
    for (let i = -5; i <= 5; i++) {
      const hGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-6, i * 0.8, -1), new THREE.Vector3(6, i * 0.8, -1)]);
      scene.add(new THREE.Line(hGeo, new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.05 })));
      const vGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i * 1.2, -5, -1), new THREE.Vector3(i * 1.2, 5, -1)]);
      scene.add(new THREE.Line(vGeo, new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.05 })));
    }

    // Generate wire path (wavy)
    const wirePoints: { x: number; y: number }[] = [];
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = -4 + t * 8;
      const y = Math.sin(t * Math.PI * 3) * (1.2 + Math.random() * 0.3);
      wirePoints.push({ x, y });
    }
    s.wirePoints = wirePoints;

    // Wire mesh (tube-like line)
    const wireThreePoints = wirePoints.map(p => new THREE.Vector3(p.x, p.y, 0));
    const wireGeo = new THREE.BufferGeometry().setFromPoints(wireThreePoints);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 3 });
    const wire = new THREE.Line(wireGeo, wireMat);
    scene.add(wire);

    // Wire glow (tube)
    const wireGlowGeo = new THREE.BufferGeometry().setFromPoints(wireThreePoints);
    const wireGlowMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.2, linewidth: 8 });
    const wireGlow = new THREE.Line(wireGlowGeo, wireGlowMat);
    scene.add(wireGlow);

    // Start marker
    const startGeo = new THREE.SphereGeometry(0.25, 12, 12);
    const startMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.8 });
    const startMarker = new THREE.Mesh(startGeo, startMat);
    startMarker.position.set(-4, wirePoints[0].y, 0);
    scene.add(startMarker);

    // End marker
    const endGeo = new THREE.SphereGeometry(0.25, 12, 12);
    const endMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.8 });
    const endMarker = new THREE.Mesh(endGeo, endMat);
    endMarker.position.set(4, wirePoints[wirePoints.length - 1].y, 0.05);
    scene.add(endMarker);

    // Ring (the thing to thread)
    const ringGeo = new THREE.TorusGeometry(0.35, 0.06, 12, 32);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.9, emissive: 0x00e5ff, emissiveIntensity: 0.5 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(-4, wirePoints[0].y, 0.1);
    scene.add(ring);
    s.ringMesh = ring;

    // Ring glow
    const glowGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.15, emissive: 0x00e5ff, emissiveIntensity: 0.5 });
    const glowSphere = new THREE.Mesh(glowGeo, glowMat);
    ring.add(glowSphere);
    s.glowMesh = glowSphere;

    // Flash sphere
    const flashGeo = new THREE.SphereGeometry(8, 16, 16);
    const flashMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.BackSide });
    const flashSphere = new THREE.Mesh(flashGeo, flashMat);
    scene.add(flashSphere);

    const worldToNDC = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((clientX - rect.left) / rect.width - 0.5) * 11;
      const ny = -((clientY - rect.top) / rect.height - 0.5) * 8;
      return { nx, ny };
    };

    const checkWireCollision = (rx: number, ry: number): boolean => {
      const RING_OUTER = 0.35;
      const WIRE_RADIUS = 0.15;
      for (let i = 0; i < wirePoints.length - 1; i++) {
        const ax = wirePoints[i].x, ay = wirePoints[i].y;
        const bx = wirePoints[i + 1].x, by = wirePoints[i + 1].y;
        const dx = bx - ax, dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy);
        const t = Math.max(0, Math.min(1, ((rx - ax) * dx + (ry - ay) * dy) / (len * len)));
        const cx = ax + t * dx, cy = ay + t * dy;
        const dist = Math.sqrt((rx - cx) ** 2 + (ry - cy) ** 2);
        if (dist < RING_OUTER + WIRE_RADIUS) return true;
      }
      return false;
    };

    const onDown = (e: PointerEvent) => {
      if (!s.running) return;
      const { nx, ny } = worldToNDC(e.clientX, e.clientY);
      const dist = Math.hypot(nx - s.ringX, ny - s.ringY);
      if (dist < 0.6) {
        s.dragging = true; s.touchedWire = false;
        s.startTime = Date.now(); s.sig.totalAttempts++;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!s.running || !s.dragging) return;
      const { nx, ny } = worldToNDC(e.clientX, e.clientY);
      s.ringX = Math.max(-4.5, Math.min(4.5, nx));
      s.ringY = Math.max(-4, Math.min(4, ny));

      if (checkWireCollision(s.ringX, s.ringY) && !s.touchedWire) {
        s.touchedWire = true; s.sig.touches++; s.sig.streakCurrent = 0;
        sfx.collision(); hapticImpact();
        s.flashType = 'miss'; s.flashTimer = 20;
        flashMat.color.setHex(0xef4444);
      }

      // Check completion (right side)
      if (s.ringX >= 3.8) {
        const elapsed = Date.now() - s.startTime;
        s.sig.completions++; s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        s.sig.speedSum += elapsed;
        const pts = s.touchedWire ? 1 : (elapsed < 3000 ? 3 : 2);
        s.sig.score += pts; setScoreDisplay(s.sig.score);
        sfx.success(); hapticScore();
        s.flashType = 'hit'; s.flashTimer = 20;
        flashMat.color.setHex(0x4ade80);
        // Reset ring
        s.ringX = -4; s.ringY = wirePoints[0].y;
        s.dragging = false; s.touchedWire = false;
        s.sig.avgSpeed = s.sig.speedSum / s.sig.completions;
      }
    };
    const onUp = () => { s.dragging = false; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      if (ring) {
        ring.position.set(s.ringX, s.ringY, 0.1);
        ring.rotation.z = s.frame * 0.02;
      }

      // Flash
      if (s.flashTimer > 0) {
        s.flashTimer--;
        flashMat.opacity = (s.flashTimer / 20) * 0.2;
        redLight.intensity = s.flashType === 'miss' ? (s.flashTimer / 20) * 3 : 0;
      } else {
        flashMat.opacity = 0; redLight.intensity = 0;
      }

      // Wire color based on touch status
      if (s.dragging && s.touchedWire) {
        (wireMat as THREE.LineBasicMaterial).color.setHex(0xef4444);
        (wireGlowMat as THREE.LineBasicMaterial).color.setHex(0xef4444);
      } else {
        (wireMat as THREE.LineBasicMaterial).color.setHex(0x00e5ff);
        (wireGlowMat as THREE.LineBasicMaterial).color.setHex(0x00e5ff);
      }

      // Pulse ring glow based on proximity to wire
      const nearWire = checkWireCollision(s.ringX, s.ringY);
      (ringMat as THREE.MeshStandardMaterial).emissiveIntensity = nearWire ? 1.5 : 0.5;
      (ringMat as THREE.MeshStandardMaterial).emissive.setHex(nearWire ? 0xef4444 : 0x00e5ff);

      neonLight.intensity = 4 + Math.sin(s.frame * 0.08) * 0.5;

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
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Thread It ⚡" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Completions', value: String(finalSig.completions), color: accent }, { label: 'Wire Touches', value: String(finalSig.touches), color: finalSig.touches === 0 ? '#4ade80' : '#ef4444' }, { label: 'Best Streak', value: `${finalSig.maxStreak}x`, color: '#fbbf24' }, { label: 'Avg Speed', value: finalSig.avgSpeed > 0 ? `${(finalSig.avgSpeed / 1000).toFixed(1)}s` : '—', color: '#06b6d4' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.completions >= 3} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const WireCrossGame = dynamic(() => Promise.resolve({ default: WireCrossGameInner }), { ssr: false });
export default WireCrossGame;
