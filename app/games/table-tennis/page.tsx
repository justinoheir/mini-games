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

const GAME_ID = 'table-tennis';
const ACCENT = '#f0abfc';
const DURATION = 45;
const GAME_EMOJI = '🏓';
const GAME_TITLE = 'Table Tennis';
const GAME_TAGLINE = 'Swipe to return. Keep the rally alive!';
const PB_KEY = 'mg_pb_table-tennis';

interface Signals { score: number; hits: number; attempts: number; reactionTimes: number[]; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  if (acc >= 0.8 && sig.maxStreak >= 6) return '🏓 Table Tennis Pro';
  if (acc >= 0.65) return '🎯 Rally Master';
  if (sig.maxStreak >= 5) return '🔥 Hot Streak';
  return '🌊 Paddle Novice';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function TableTennisGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const paddleXRef = useRef(0);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [] as number[], maxStreak: 0, streakCurrent: 0 },
    bx: 0, by: 0, bz: 0, vx: 0, vy: 0, vz: 0,
    aiPaddleX: 0,
    state: 'serve' as 'serve' | 'rally',
    serveTimer: 90, hitTime: 0, lastHitter: 'ai' as 'player' | 'ai',
    missAnim: 0,
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
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    s.state = 'serve'; s.serveTimer = 90; s.aiPaddleX = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0718);
    renderer.shadowMap.enabled = true;
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x110822, 2));
    const topLight = new THREE.PointLight(0xf0abfc, 3, 25);
    topLight.position.set(0, 8, 0);
    scene.add(topLight);
    const sideLight = new THREE.PointLight(0x818cf8, 2, 20);
    sideLight.position.set(5, 3, 5);
    scene.add(sideLight);

    // Table
    const tableGeo = new THREE.BoxGeometry(8, 0.15, 12);
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x1e4d2e, roughness: 0.7, metalness: 0.1 });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.y = -0.5;
    table.receiveShadow = true;
    scene.add(table);

    // Net
    const netGeo = new THREE.BoxGeometry(8, 0.3, 0.05);
    const netMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, -0.22, 0);
    scene.add(net);

    // Table lines
    const lineGeo = new THREE.BoxGeometry(8, 0.01, 0.05);
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    scene.add(Object.assign(new THREE.Mesh(lineGeo, lineMat), { position: new THREE.Vector3(0, -0.42, 0) }));
    const centerLineGeo = new THREE.BoxGeometry(0.05, 0.01, 12);
    scene.add(Object.assign(new THREE.Mesh(centerLineGeo, lineMat), { position: new THREE.Vector3(0, -0.42, 0) }));

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.castShadow = true;
    scene.add(ball);

    // Player paddle (red)
    const paddleGeo = new THREE.BoxGeometry(2.2, 0.12, 0.5);
    const paddleMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5, emissive: 0xef4444, emissiveIntensity: 0.2 });
    const playerPaddle = new THREE.Mesh(paddleGeo, paddleMat);
    playerPaddle.castShadow = true;
    scene.add(playerPaddle);

    // AI paddle (blue)
    const aiPaddleMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5, emissive: 0x3b82f6, emissiveIntensity: 0.2 });
    const aiPaddle = new THREE.Mesh(paddleGeo.clone(), aiPaddleMat);
    scene.add(aiPaddle);

    // Ball trail
    const trailMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const tm = new THREE.Mesh(new THREE.SphereGeometry(0.08 * (1 - i / 10), 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xf0abfc, transparent: true, opacity: 0.4 - i * 0.04 }));
      scene.add(tm); trailMeshes.push(tm);
    }

    // Glow ring for serve
    const ringGeo = new THREE.TorusGeometry(0.3, 0.04, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0xf0abfc, emissiveIntensity: 1 });
    const serveRing = new THREE.Mesh(ringGeo, ringMat);
    scene.add(serveRing);

    const serve = () => {
      s.bx = (Math.random() - 0.5) * 3;
      s.by = 1; s.bz = -3;
      s.vx = (Math.random() - 0.5) * 0.06;
      s.vy = -0.01; s.vz = 0.05;
      s.state = 'rally'; s.lastHitter = 'ai';
      s.hitTime = Date.now(); s.sig.attempts++;
    };

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5) sfx.tick();
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);

    let trailPositions: THREE.Vector3[] = [];

    const loop = () => {
      if (!s.running) return;

      const paddleX = paddleXRef.current;
      const playerPaddleZ = 4.5;
      const aiPaddleZ = -4.5;

      if (s.state === 'serve') {
        s.serveTimer--;
        if (s.serveTimer <= 0) { serve(); s.serveTimer = 90; }
        serveRing.position.set(0, 0.5, playerPaddleZ - 0.5);
        serveRing.rotation.x += 0.05;
        serveRing.visible = true;
      } else {
        serveRing.visible = false;
      }

      if (s.state === 'rally') {
        s.bx += s.vx * 60;
        s.by += s.vy * 60;
        s.bz += s.vz * 60;

        // Wall bounces
        if (Math.abs(s.bx) > 4) { s.vx = -s.vx; s.bx = Math.sign(s.bx) * 4; }
        // Bounce on table (y floor)
        if (s.by < -0.3 && s.vz > 0 && s.bz > -5 && s.bz < 5) {
          s.vy = Math.abs(s.vy) * 0.7; s.by = -0.3;
        }
        // Gravity
        s.vy -= 0.003;

        // AI tracking
        if (s.vz < 0) {
          s.aiPaddleX += (s.bx - s.aiPaddleX) * 0.06;
          s.aiPaddleX = Math.max(-3, Math.min(3, s.aiPaddleX));
        }

        // Player paddle hit
        if (s.vz > 0 && s.bz >= playerPaddleZ - 0.3 && s.bz <= playerPaddleZ + 0.3) {
          if (Math.abs(s.bx - paddleX) < 1.2 && s.lastHitter !== 'player') {
            s.vz = -(0.06 + Math.abs(s.vz) * 0.3);
            s.vx += (s.bx - paddleX) * 0.01;
            s.lastHitter = 'player';
            s.sig.hits++; s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
            s.sig.score += pts; setScoreDisplay(s.sig.score);
            s.sig.reactionTimes.push(Date.now() - s.hitTime); s.hitTime = Date.now();
            sfx.collect(); haptic([30]);
          }
        }

        // AI paddle hit
        if (s.vz < 0 && s.bz <= aiPaddleZ + 0.3 && s.bz >= aiPaddleZ - 0.3) {
          if (Math.abs(s.bx - s.aiPaddleX) < 1.2 && s.lastHitter !== 'ai') {
            s.vz = Math.abs(s.vz) * 0.85 + 0.03;
            s.lastHitter = 'ai'; s.hitTime = Date.now();
            sfx.tick();
          }
        }

        // Ball out
        if (s.bz > 6) {
          sfx.nearMiss(); haptic([20, 30, 20]);
          s.sig.streakCurrent = 0; s.sig.attempts++;
          s.state = 'serve'; s.serveTimer = 60;
          s.missAnim = 30;
        }
        if (s.bz < -6) {
          sfx.success(); haptic([30]);
          s.sig.score += 2; setScoreDisplay(s.sig.score);
          s.state = 'serve'; s.serveTimer = 60;
        }

        // Trail
        trailPositions.unshift(new THREE.Vector3(s.bx, s.by, s.bz));
        if (trailPositions.length > 8) trailPositions.pop();
        trailMeshes.forEach((tm, i) => {
          if (trailPositions[i]) { tm.position.copy(trailPositions[i]); tm.visible = true; }
          else tm.visible = false;
        });
      }

      ball.position.set(s.bx, s.by, s.bz);
      playerPaddle.position.set(paddleX, -0.3, playerPaddleZ);
      aiPaddle.position.set(s.aiPaddleX, -0.3, aiPaddleZ);

      // Miss flash
      if (s.missAnim > 0) {
        s.missAnim--;
        tableMat.emissive.setHex(0x550000);
        tableMat.emissiveIntensity = s.missAnim / 30 * 0.3;
      } else {
        tableMat.emissiveIntensity = 0;
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    const onMove = (e: PointerEvent) => {
      const norm = (e.clientX / W - 0.5) * 8;
      paddleXRef.current = Math.max(-3, Math.min(3, norm));
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onMove);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits / sig.attempts) * 100) : 0;
    const avg = sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length) : 0;
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    return [
      { label: 'Return %', value: acc + '%', color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'React', value: avg + 'ms', color: ACCENT },
      { label: 'Max Rally', value: '🏓' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
    ];
  };

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Serve!" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 8} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
