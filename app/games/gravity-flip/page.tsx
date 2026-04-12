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

const GAME_ID      = 'gravity-flip';
const ACCENT       = '#8b5cf6';
const DURATION     = 60;
const GAME_EMOJI   = '⬆️';
const GAME_TITLE   = 'Gravity Flip';
const GAME_TAGLINE = 'Tap to flip gravity. Dodge the obstacles.';

interface Signals { flips: number; wallHits: number; obstaclesDodged: number; maxRunDistance: number; score: number; }
function getPersonality(sig: Signals): string {
  if (sig.obstaclesDodged >= 20 && sig.wallHits <= 2)  return 'Gravity Lord ⬆️';
  if (sig.wallHits <= 3 && sig.flips >= 15)             return 'Smooth Flipper 🌀';
  if (sig.obstaclesDodged >= 15)                        return 'Obstacle Crusher 💪';
  if (sig.flips >= 25)                                  return 'Flip Maniac 🔄';
  return 'Learning to Float 🫧';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  ballY: number; ballVY: number; gravityDir: 1 | -1;
  scrollZ: number; scrollSpeed: number;
  obstacleZs: Array<{ z: number; topY: number; botY: number; passed: boolean }>;
}

function GravityFlipGameInner() {
  const theme        = useBrandTheme();
  const mountRef     = useRef<HTMLDivElement>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { flips: 0, wallHits: 0, obstaclesDodged: 0, maxRunDistance: 0, score: 0 },
    ballY: 0, ballVY: 0, gravityDir: 1,
    scrollZ: 0, scrollSpeed: 0.05,
    obstacleZs: [],
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    ball: THREE.Mesh; ballLight: THREE.PointLight;
    wallTop: THREE.Mesh; wallBot: THREE.Mesh;
    obstacles: Array<{ top: THREE.Mesh; bot: THREE.Mesh; z: number; topY: number; botY: number; passed: boolean }>;
    trail: Array<{ mesh: THREE.Mesh; alpha: number }>;
    animId: number;
  } | null>(null);

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { flips: 0, wallHits: 0, obstaclesDodged: 0, maxRunDistance: 0, score: 0 };
    s.ballY = 0; s.ballVY = 0; s.gravityDir = 1;
    s.scrollZ = 0; s.scrollSpeed = 0.05; s.obstacleZs = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0014);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0014, 10, 35);
    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 100);
    camera.position.set(0, 0, 8);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===

    scene.add(new THREE.AmbientLight(0x221133, 1.5));
    const ballLight = new THREE.PointLight(ACCENT, 3, 8);
    scene.add(ballLight);

    // Wall top + bottom (long corridor)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2d1b69, emissive: 0x8b5cf6, emissiveIntensity: 0.15, metalness: 0.3, roughness: 0.5 });
    const wallTop = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 60), wallMat);
    wallTop.position.set(0, 3.5, -20);
    scene.add(wallTop);
    const wallBot = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 60), wallMat);
    wallBot.position.set(0, -3.5, -20);
    scene.add(wallBot);

    // Edge glow lines
    const edgeMat = new THREE.LineBasicMaterial({ color: ACCENT, linewidth: 2 });
    const topEdge = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 2.5, -40), new THREE.Vector3(-1, 2.5, 20)]), edgeMat);
    scene.add(topEdge);
    const botEdge = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, -2.5, -40), new THREE.Vector3(-1, -2.5, 20)]), edgeMat);
    scene.add(botEdge);

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.25, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8b5cf6, emissiveIntensity: 0.8, metalness: 0.2, roughness: 0.3 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.set(-0.6, 0, 0);
    scene.add(ball);

    const obstacles: Array<{ top: THREE.Mesh; bot: THREE.Mesh; z: number; topY: number; botY: number; passed: boolean }> = [];
    const trail: Array<{ mesh: THREE.Mesh; alpha: number }> = [];

    const obj = { renderer, scene, camera, ball, ballLight, wallTop, wallBot, obstacles, trail, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.scrollSpeed = Math.min(0.12, 0.05 + (DURATION - s.timeLeft) * 0.001);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    let nextObstacleZ = -15;
    const GRAV = 0.006;
    const TOP_WALL = 2.2, BOT_WALL = -2.2;

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      s.scrollZ += s.scrollSpeed;

      // Ball physics
      s.ballVY += GRAV * s.gravityDir;
      s.ballY += s.ballVY;

      // Wall collision
      if (s.ballY > TOP_WALL) {
        s.ballVY *= -0.3; s.ballY = TOP_WALL;
        s.sig.wallHits++; sfx.collision?.(); haptic([20]);
      }
      if (s.ballY < BOT_WALL) {
        s.ballVY *= -0.3; s.ballY = BOT_WALL;
        s.sig.wallHits++; sfx.collision?.(); haptic([20]);
      }

      ball.position.set(-0.6, s.ballY, 0);
      ballLight.position.set(-0.6, s.ballY, 1);

      // Trail
      const trailMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.6 })
      );
      trailMesh.position.set(-0.6, s.ballY, 0);
      scene.add(trailMesh);
      trail.push({ mesh: trailMesh, alpha: 0.6 });
      if (trail.length > 15) {
        const old = trail.shift()!;
        scene.remove(old.mesh);
        (old.mesh.material as THREE.Material).dispose();
        old.mesh.geometry.dispose();
      }
      for (const tr of trail) {
        tr.alpha -= 0.04;
        (tr.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, tr.alpha);
      }

      // Spawn obstacles
      if (s.scrollZ - nextObstacleZ > 12) {
        nextObstacleZ = s.scrollZ + 20;
        const gap = 1.8;
        const topY = 0.2 + Math.random() * 1.2;
        const topH = TOP_WALL - topY - gap / 2;
        const botH = topY - gap / 2 - BOT_WALL;
        const obsZ = -(s.scrollZ + 20);

        const obsMat = new THREE.MeshStandardMaterial({ color: 0x5b21b6, emissive: ACCENT, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.5 });
        const topObs = new THREE.Mesh(new THREE.BoxGeometry(0.4, Math.max(0.3, topH), 0.4), obsMat.clone());
        topObs.position.set(-0.6, TOP_WALL - Math.max(0.3, topH) / 2, obsZ);
        scene.add(topObs);
        const botObs = new THREE.Mesh(new THREE.BoxGeometry(0.4, Math.max(0.3, botH), 0.4), obsMat.clone());
        botObs.position.set(-0.6, BOT_WALL + Math.max(0.3, botH) / 2, obsZ);
        scene.add(botObs);
        obstacles.push({ top: topObs, bot: botObs, z: s.scrollZ + 20, topY, botY: topY - gap, passed: false });
      }

      // Move obstacles toward camera & check collision/scoring
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        const screenZ = obs.z - s.scrollZ;
        obs.top.position.z = -screenZ;
        obs.bot.position.z = -screenZ;

        if (screenZ < -2) {
          scene.remove(obs.top); scene.remove(obs.bot);
          obstacles.splice(i, 1); continue;
        }

        if (!obs.passed && screenZ > 2) {
          obs.passed = true;
          s.sig.obstaclesDodged++; s.sig.score++;
          setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]);
        }

        // Collision check (rough)
        if (Math.abs(screenZ) < 1.5) {
          if (s.ballY > obs.topY || s.ballY < obs.botY) {
            // hit
            (obs.top.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5;
            (obs.bot.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5;
            s.sig.wallHits++; sfx.collision?.(); haptic([30]);
          }
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame]);

  const handleFlip = useCallback(() => {
    const s = stateRef.current; if (!s.running) return;
    s.gravityDir = s.gravityDir === 1 ? -1 : 1;
    s.ballVY *= 0.3;
    s.sig.flips++;
    sfx.click?.(); haptic([20]);
  }, []);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTap = (e: PointerEvent) => { e.preventDefault(); handleFlip(); };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase, handleFlip]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Flip It" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Dodged', value: `${finalSig.obstaclesDodged}`, color: '#4ade80' }, { label: 'Flips', value: `${finalSig.flips}`, color: ACCENT }, { label: 'Wall Hits', value: `${finalSig.wallHits}`, color: finalSig.wallHits <= 3 ? '#4ade80' : '#ef4444' }, { label: 'Score', value: `${finalSig.score}`, color: 'var(--color-text)' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.obstaclesDodged >= 15} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, gameId, { personality, score: sig.score, flips: sig.flips, wallHits: sig.wallHits, obstaclesDodged: sig.obstaclesDodged }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const GravityFlipGame = dynamic(() => Promise.resolve({ default: GravityFlipGameInner }), { ssr: false });
export default GravityFlipGame;
