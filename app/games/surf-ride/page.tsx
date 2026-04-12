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
import { createTiltController } from '@/lib/tilt';

const GAME_ID = 'surf-ride';
const ACCENT = '#34d399';
const DURATION = 45;
const GAME_EMOJI = '🏄';
const GAME_TITLE = 'Surf Ride';
const GAME_TAGLINE = 'Tilt to balance. Survive the wipeout!';
const PB_KEY = 'mg_pb_surf-ride';

interface Signals {
  score: number; hits: number; attempts: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}
function getPersonality(sig: Signals): string {
  if (sig.score >= 30) return '🏄 Pipeline Legend';
  if (sig.score >= 18) return '🌊 Tube Rider';
  if (sig.maxStreak >= 5) return '🔥 Hot Surfer';
  if (sig.hits < 3) return '💦 Wipeout King';
  return '🤙 Hang Loose';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

function SurfRideGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const tiltCtrlRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [] as number[], maxStreak: 0, streakCurrent: 0 },
    balance: 0, balanceVel: 0,
    surferX: 0,
    waveTime: 0,
    isWipingOut: false, wipeoutTimer: 0,
    scoreTimer: 0,
    tiltX: 0,
    animId: 0,
    renderer: null as THREE.WebGLRenderer | null,
    intervalId: null as ReturnType<typeof setInterval> | null,
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
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    tiltCtrlRef.current?.stop();
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.isWipingOut = false;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    s.balance = 0; s.balanceVel = 0; s.surferX = 0; s.waveTime = 0; s.scoreTimer = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    renderer.shadowMap.enabled = true;
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a1a, 20, 60);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 6, 14);
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

    scene.add(new THREE.AmbientLight(0x112233, 1.5));
    const sun = new THREE.PointLight(0xfde68a, 3, 40);
    sun.position.set(8, 10, -5);
    scene.add(sun);
    const oceanLight = new THREE.PointLight(0x34d399, 2, 30);
    oceanLight.position.set(0, 2, 5);
    scene.add(oceanLight);

    // Ocean plane
    const oceanGeo = new THREE.PlaneGeometry(40, 30, 60, 40);
    const oceanMat = new THREE.MeshStandardMaterial({ color: 0x0369a1, roughness: 0.4, metalness: 0.3, wireframe: false });
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    ocean.rotation.x = -Math.PI / 2;
    scene.add(ocean);

    // Foam line (wave crest)
    const foamGeo = new THREE.PlaneGeometry(40, 0.5, 60, 1);
    const foamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.7 });
    const foam = new THREE.Mesh(foamGeo, foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = 0.05;
    scene.add(foam);

    // Surfer board
    const boardGeo = new THREE.BoxGeometry(1.8, 0.12, 0.5);
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.6 });
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.castShadow = true;
    scene.add(board);

    // Surfer body
    const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.5, 8, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1f2937 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    scene.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.22, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfed7aa });
    const head = new THREE.Mesh(headGeo, headMat);
    scene.add(head);

    // Balance bar (ring indicator)
    const balanceRingGeo = new THREE.TorusGeometry(0.8, 0.04, 8, 32);
    const balanceRingMat = new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 0.5 });
    const balanceRing = new THREE.Mesh(balanceRingGeo, balanceRingMat);
    balanceRing.rotation.x = Math.PI / 2;
    scene.add(balanceRing);

    // Stars
    const starCount = 800;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 100;
      starPos[i * 3 + 1] = 10 + Math.random() * 30;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

    const tiltCtrl = createTiltController((x) => { s.tiltX = x; }, { sensitivity: 1.1, clamp: 22 });
    tiltCtrl.start(); tiltCtrlRef.current = tiltCtrl;

    const onMove = (e: PointerEvent) => {
      const norm = (e.clientX / window.innerWidth - 0.5) * 2;
      s.tiltX = norm * 15;
    };
    window.addEventListener('pointermove', onMove);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5) sfx.tick();
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);

    const oceanPositions = oceanGeo.attributes.position as THREE.BufferAttribute;
    const origY = new Float32Array(oceanPositions.count);
    for (let i = 0; i < oceanPositions.count; i++) origY[i] = oceanPositions.getY(i);

    const loop = () => {
      if (!s.running) return;
      s.waveTime += 0.02;
      const diff = (DURATION - s.timeLeft) / DURATION;

      // Animate ocean vertices
      for (let i = 0; i < oceanPositions.count; i++) {
        const ox = oceanPositions.getX(i);
        const oz = oceanPositions.getZ(i);
        const wave = Math.sin(ox * 0.5 + s.waveTime * 2) * (0.4 + diff * 0.4)
          + Math.sin(oz * 0.3 + s.waveTime * 1.5) * 0.2;
        oceanPositions.setY(i, origY[i] + wave);
      }
      oceanPositions.needsUpdate = true;
      oceanGeo.computeVertexNormals();

      if (!s.isWipingOut) {
        const slopePush = Math.sin(s.surferX * 0.5 + s.waveTime) * (3 + diff * 4);
        const tiltCorrection = s.tiltX * 2;
        s.balanceVel += (slopePush - tiltCorrection) * 0.03;
        s.balanceVel *= 0.88;
        s.balance += s.balanceVel;
        s.balance = Math.max(-1.5, Math.min(1.5, s.balance));

        s.surferX += s.tiltX * 0.005;
        s.surferX = Math.max(-4, Math.min(4, s.surferX));

        // Score points when balanced
        s.scoreTimer++;
        if (Math.abs(s.balance) < 0.5) {
          s.sig.streakCurrent = Math.min(s.sig.streakCurrent + 0.02, 10);
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = Math.ceil(s.sig.streakCurrent);
          if (s.scoreTimer >= 50) {
            s.scoreTimer = 0;
            s.sig.score++; s.sig.hits++;
            setScoreDisplay(s.sig.score);
            sfx.tick();
          }
        } else {
          s.sig.streakCurrent = Math.max(0, s.sig.streakCurrent - 0.05);
          s.scoreTimer = 0;
        }

        if (Math.abs(s.balance) > 1.2) {
          s.isWipingOut = true; s.wipeoutTimer = 60;
          sfx.collision(); haptic([80, 40, 80]);
          s.sig.streakCurrent = 0; s.sig.attempts++;
          setTimeout(() => {
            if (!s.running) return;
            s.isWipingOut = false; s.balance = 0; s.balanceVel = 0;
            s.sig.hits++;
          }, 1200);
        }
      } else {
        s.wipeoutTimer--;
      }

      const waveY = Math.sin(s.surferX * 0.5 + s.waveTime) * (0.4 + diff * 0.4);
      const leanAngle = s.isWipingOut ? s.wipeoutTimer * 0.05 : s.balance * 0.3;

      board.position.set(s.surferX, waveY + 0.1, 0);
      board.rotation.z = -leanAngle;
      body.position.set(s.surferX, waveY + 0.7, 0);
      body.rotation.z = -leanAngle;
      head.position.set(s.surferX + Math.sin(leanAngle) * 0.3, waveY + 1.25, 0);

      // Balance ring around board
      const balancePct = Math.abs(s.balance) / 1.5;
      balanceRing.position.set(s.surferX, waveY + 0.3, 0);
      (balanceRingMat as THREE.MeshStandardMaterial).color.setHSL(
        0.35 - balancePct * 0.35, 0.9, 0.6
      );
      balanceRingMat.emissive.copy(balanceRingMat.color).multiplyScalar(0.4);
      balanceRing.rotation.z += 0.02;

      // Camera follows surfer
      camera.position.x += (s.surferX - camera.position.x) * 0.05;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    return () => window.removeEventListener('pointermove', onMove);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (stopMusicRef.current) stopMusicRef.current();
    tiltCtrlRef.current?.stop();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    tiltCtrlRef.current?.stop();
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => {
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Rides', value: String(sig.hits), color: '#4ade80' },
      { label: 'Max Balance', value: '🏄' + Math.floor(sig.maxStreak), color: ACCENT },
      { label: 'Wipeouts', value: String(sig.attempts), color: sig.attempts < 3 ? '#4ade80' : '#ef4444' },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg,#020b18 0%,#0c2a45 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Drop In!" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 15} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const SurfRideGame = dynamic(() => Promise.resolve({ default: SurfRideGameInner }), { ssr: false });
export default SurfRideGame;
