'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'voice-sculpt';
const PB_KEY = 'mg_pb_voice-sculpt';
const ACCENT = '#ec4899';
const DURATION = 45;
const GAME_EMOJI = '🎨';
const GAME_TITLE = 'Voice Sculpt';
const GAME_TAGLINE = 'Louder floats up. Quieter sinks down. Guide your spark.';
const WALL_SPEED = 3.5; // 3D units/s
const WALL_GAP = 4.0;
const WALL_SPACING = 8.0;

interface Signals { score: number; wallsPassed: number; collisions: number; avgVolume: number; }
function getPersonality(s: Signals): string {
  const acc = (s.wallsPassed + s.collisions) > 0 ? s.wallsPassed / (s.wallsPassed + s.collisions) : 0;
  if (acc >= 0.85 && s.wallsPassed >= 8) return 'Sound Sculptor 🎨';
  if (acc >= 0.70) return 'Voice Pilot ✈️';
  if (s.wallsPassed >= 6) return 'Steady Speaker 🎤';
  return 'Finding My Voice 🎵';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

interface Wall3D { mesh: THREE.Group; z: number; gapCY: number; passed: boolean; }

function VoiceSculptGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, streak: 0, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    sig: { score: 0, wallsPassed: 0, collisions: 0, avgVolume: 0 } as Signals,
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    stream: null as MediaStream | null,
    ballY: 0, ballVY: 0,
    walls: [] as Wall3D[],
    volume: 0, volSum: 0, volSamples: 0,
    invuln: 0, frame: 0, lastWallZ: 0,
    ballMesh: null as THREE.Mesh | null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [micError, setMicError] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (!s.analyser) return 0;
    const data = new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    return data.reduce((a, b) => a + b, 0) / data.length / 255;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (s.volSamples > 0) s.sig.avgVolume = s.volSum / s.volSamples;
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0', 10); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(async () => {
    const s = stateRef.current;
    // Request mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      s.stream = stream; s.analyser = analyser; s.audioCtx = ctx;
    } catch {
      setMicError(true);
    }

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, wallsPassed: 0, collisions: 0, avgVolume: 0 };
    s.ballY = 0; s.ballVY = 0; s.walls = []; s.invuln = 0;
    s.volSum = 0; s.volSamples = 0; s.lastWallZ = -WALL_SPACING;
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('minimal');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d0a1e);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0d0a1e, 15, 35);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);
    // === POLISH: Responsive resize handler ===
    const _onResizeHandler = () => {
      const _W = (mountRef.current?.clientWidth || window.innerWidth);
      const _H = (mountRef.current?.clientHeight || window.innerHeight);
      renderer.setSize(_W, _H);
      if (camera instanceof THREE.PerspectiveCamera) { (camera as THREE.PerspectiveCamera).aspect = _W / _H; camera.updateProjectionMatrix(); }
    };
    window.addEventListener('resize', _onResizeHandler);
    // === END POLISH ===
    camera.lookAt(0, 0, -5);

    scene.add(new THREE.AmbientLight(0x110a22, 2));
    const pLight = new THREE.PointLight(0xec4899, 4, 25);
    pLight.position.set(-2, 2, 5);
    scene.add(pLight);
    const trailLight = new THREE.PointLight(0xa855f7, 2, 10);
    scene.add(trailLight);

    // Tunnel floor and ceiling
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a0a2e, roughness: 0.9 });
    const floorGeo = new THREE.PlaneGeometry(6, 60);
    const floorMesh = new THREE.Mesh(floorGeo, wallMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, -5, -20);
    scene.add(floorMesh);
    const ceilMesh = new THREE.Mesh(floorGeo.clone(), wallMat);
    ceilMesh.rotation.x = Math.PI / 2;
    ceilMesh.position.set(0, 5, -20);
    scene.add(ceilMesh);

    // Tube walls
    for (let side of [-3, 3]) {
      const sGeo = new THREE.PlaneGeometry(60, 10);
      const sMesh = new THREE.Mesh(sGeo, wallMat);
      sMesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      sMesh.position.set(side, 0, -20);
      scene.add(sMesh);
    }

    // Ball / spark
    const ballGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xec4899, roughness: 0.2, emissive: 0xec4899, emissiveIntensity: 0.8 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.set(-2, 0, 0);
    scene.add(ball);
    s.ballMesh = ball;

    // Ball glow
    const glowGeo = new THREE.SphereGeometry(0.55, 12, 12);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xec4899, transparent: true, opacity: 0.2, emissive: 0xec4899, emissiveIntensity: 0.5 });
    ball.add(new THREE.Mesh(glowGeo, glowMat));

    // Trail
    const trailCount = 12;
    const trailMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < trailCount; i++) {
      const tr = new THREE.Mesh(new THREE.SphereGeometry(0.12 * (1 - i / trailCount), 6, 6),
        new THREE.MeshStandardMaterial({ color: 0xec4899, transparent: true, opacity: 0.3 - i * 0.022, emissive: 0xec4899, emissiveIntensity: 0.3 }));
      scene.add(tr); trailMeshes.push(tr);
    }
    let trailPositions: THREE.Vector3[] = [];

    const WALL_COLOR = 0x4c1d95;
    const GAP_COLOR = 0x1a0a2e;

    const spawnWall = (z: number) => {
      const gapCY = (Math.random() - 0.5) * 4;
      const group = new THREE.Group();
      // Top wall
      const topH = 5 - gapCY - WALL_GAP / 2;
      if (topH > 0) {
        const topGeo = new THREE.BoxGeometry(6, topH, 0.4);
        const topMat = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.6, emissive: WALL_COLOR, emissiveIntensity: 0.2 });
        const topMesh = new THREE.Mesh(topGeo, topMat);
        topMesh.position.y = 5 - topH / 2;
        group.add(topMesh);
      }
      // Bottom wall
      const botH = 5 + gapCY - WALL_GAP / 2;
      if (botH > 0) {
        const botGeo = new THREE.BoxGeometry(6, botH, 0.4);
        const botMat = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.6, emissive: WALL_COLOR, emissiveIntensity: 0.2 });
        const botMesh = new THREE.Mesh(botGeo, botMat);
        botMesh.position.y = -5 + botH / 2;
        group.add(botMesh);
      }
      // Gap highlight
      const gapGeo = new THREE.BoxGeometry(6.2, WALL_GAP, 0.1);
      const gapMat = new THREE.MeshStandardMaterial({ color: 0xec4899, transparent: true, opacity: 0.15, emissive: 0xec4899, emissiveIntensity: 0.3 });
      const gapMesh = new THREE.Mesh(gapGeo, gapMat);
      gapMesh.position.y = gapCY;
      group.add(gapMesh);

      group.position.z = z;
      scene.add(group);
      s.walls.push({ mesh: group, z, gapCY, passed: false });
    };

    // Pre-spawn first walls
    for (let i = 0; i < 5; i++) spawnWall(-5 - i * WALL_SPACING);

    // Touch fallback: press to go up
    renderer.domElement.addEventListener('pointerdown', () => { s.ballVY = 0.15; });
    renderer.domElement.addEventListener('pointerup', () => { });

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const dt = 1 / 60;

      const vol = getVolume();
      s.volSum += vol; s.volSamples++;

      // Y physics: loud = up
      const lift = vol > 0.1 ? (vol - 0.1) * 4 : 0;
      s.ballVY += (lift - 0.08); // gravity
      s.ballVY = Math.max(-0.2, Math.min(0.2, s.ballVY));
      s.ballY += s.ballVY;
      s.ballY = Math.max(-4.5, Math.min(4.5, s.ballY));

      if (ball) {
        ball.position.y = s.ballY;
        ball.rotation.x += 0.04; ball.rotation.z += 0.02;
      }

      // Trail
      trailPositions.unshift(new THREE.Vector3(-2, s.ballY, 0));
      if (trailPositions.length > trailCount) trailPositions.pop();
      trailMeshes.forEach((tm, i) => {
        if (trailPositions[i]) tm.position.copy(trailPositions[i]);
      });

      // Update trail light
      trailLight.position.set(-2, s.ballY, 0.5);
      trailLight.intensity = 1 + vol * 3;

      // Scroll walls
      const wallSpeedDt = WALL_SPEED * dt;
      for (let i = s.walls.length - 1; i >= 0; i--) {
        const w = s.walls[i];
        w.z += wallSpeedDt * 5;
        w.mesh.position.z = w.z;

        // Check collision
        if (!w.passed && w.z > -2.5 && w.z < 0.5) {
          const ballZ = w.z;
          const distToGap = Math.abs(s.ballY - w.gapCY);
          if (distToGap > WALL_GAP / 2 - 0.3 && s.invuln === 0) {
            s.sig.collisions++; s.invuln = 80; s.streak=0; setStreak(0);
            sfx.collision(); hapticFail();
            (ballMat as THREE.MeshStandardMaterial).color.setHex(0xef4444);
            setTimeout(() => { if (ball) (ball.material as THREE.MeshStandardMaterial).color.setHex(0xec4899); }, 300);
          }
        }

        if (!w.passed && w.z > 1) {
          w.passed = true;
          s.streak=(s.streak||0)+1; setStreak(s.streak);
          const _vc=Math.max(1,Math.floor(s.streak/3)+1);
          s.sig.wallsPassed++; s.sig.score+=_vc;
          setScoreDisplay(s.sig.score);
          sfx.collect(); hapticScore();
        }

        if (w.z > 8) { scene.remove(w.mesh); s.walls.splice(i, 1); }
      }

      if (s.invuln > 0) s.invuln--;

      // Spawn new walls
      const neededWalls = Math.ceil((30) / WALL_SPACING);
      const furthestZ = s.walls.length > 0 ? Math.min(...s.walls.map(w => w.z)) : 0;
      if (furthestZ > -30) spawnWall(furthestZ - WALL_SPACING);

      pLight.intensity = 3 + vol * 5;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, getVolume]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null); setMicError(false);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Sculpting 🎨" accentColor={accent} onStart={handleStart} sensorNote="Uses microphone" />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} role="application" aria-label="Game area - tap to play" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <>
        <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'WALLS', value: scoreDisplay }]} />
        <div style={{ position: 'fixed', bottom: '8%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.5)', fontSize: 13, zIndex: 50 }}>
          {micError ? '📱 Tap to go up!' : '🎤 Speak louder to rise!'}
        </div>
      </>}
            {phase === 'playing' && streak >= 3 && (
        <div style={{ position: 'fixed', top: 128, left: '50%', transform: 'translateX(-50%)', zIndex: 25, pointerEvents: 'none', fontSize: 20, fontWeight: 900, color: '#fbbf24', textShadow: '0 0 16px #fbbf2488', letterSpacing: 1, whiteSpace: 'nowrap' }} aria-live="polite" aria-atomic="true">
          ⚡ x{Math.max(1,Math.floor(streak/3)+1)} Streak!
        </div>
      )}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Walls Passed', value: String(finalSig.wallsPassed), color: '#4ade80' }, { label: 'Collisions', value: String(finalSig.collisions), color: finalSig.collisions === 0 ? '#4ade80' : '#ef4444' }, { label: 'Avg Volume', value: `${Math.round(finalSig.avgVolume * 100)}%`, color: accent }, { label: 'Score', value: String(finalSig.score), color: 'var(--color-text)' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.wallsPassed >= 8} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const VoiceSculptGame = dynamic(() => Promise.resolve({ default: VoiceSculptGameInner }), { ssr: false });
export default VoiceSculptGame;
