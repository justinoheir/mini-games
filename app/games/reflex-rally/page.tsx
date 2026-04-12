'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo } from '@/lib/audio';
import { playScoreHit, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const ACCENT = '#0891b2';
const GAME_ID = 'reflex-rally';
const PB_KEY = 'pb_reflex-rally';
const DURATION = 45;
const MAX_LIVES = 5;

interface Signals { returns: number; misses: number; forehands: number; backhands: number; reactionTimes: number[]; score: number; streakMax: number; streakCurrent: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const avgRT = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length : 999;
  if (avgRT < 350 && sig.returns >= 5) return '⚡ Trailblazer';
  if (sig.streakMax >= 5) return '🔥 Energizer';
  if (sig.forehands > 0 && sig.backhands > 0 && Math.abs(sig.forehands-sig.backhands) <= Math.max(sig.forehands,sig.backhands)*0.4) return '🌍 Explorer';
  return '🎯 Visionary';
}

interface TrailPoint3D { mesh: THREE.Mesh; life: number; }

function ReflexRallyInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const ballRef = useRef<THREE.Mesh | null>(null);
  const trailsRef = useRef<TrailPoint3D[]>([]);
  const netRef = useRef<THREE.Mesh | null>(null);
  const accentLightRef = useRef<THREE.PointLight | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const { pops, triggerPop } = useScorePop();

  const stateRef = useRef({
    running: false, timeLeft: DURATION, lives: MAX_LIVES,
    sig: { returns: 0, misses: 0, forehands: 0, backhands: 0, reactionTimes: [], score: 0, streakMax: 0, streakCurrent: 0 } as Signals,
    ballX: 0, ballY: 0, ballVX: -0.08, ballVY: 0, ballActive: false,
    ballInZone: false, ballZoneEnterTime: 0, playerZoneX: -3,
    speed: 0.08, speedTier: 0,
    swipeStartX: 0, swipeStartY: 0, swipeStartTime: 0, isSwiping: false,
    courtTop: 3, courtBottom: -3,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [livesDisplay, setLivesDisplay] = useState(MAX_LIVES);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0'); if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); } } catch { /**/ }
    const finalSigSnap = { ...s.sig };
    setFinalSig(finalSigSnap); setPhase('done');
    postWebhook(theme, GAME_ID, { score: `${finalSigSnap.score} pts`, personality: getPersonality(finalSigSnap), signals: { returns: finalSigSnap.returns, misses: finalSigSnap.misses } }, playerSessionRef.current);
  }, [theme]);

  const spawnBall = useCallback(() => {
    const s = stateRef.current;
    s.ballX = 4.5;
    s.ballY = (Math.random() - 0.5) * (s.courtTop - s.courtBottom) * 0.8;
    s.ballVX = -(s.speed + Math.random() * 0.02);
    s.ballVY = (Math.random() - 0.5) * 0.04;
    s.ballActive = true; s.ballInZone = false;
    if (ballRef.current) { ballRef.current.position.set(s.ballX, s.ballY, 0); ballRef.current.visible = true; }
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.lives = MAX_LIVES;
    s.sig = { returns: 0, misses: 0, forehands: 0, backhands: 0, reactionTimes: [], score: 0, streakMax: 0, streakCurrent: 0 };
    s.speed = 0.08; s.speedTier = 0; s.playerZoneX = -3;
    setScoreDisplay(0); setStreakDisplay(0); setLivesDisplay(MAX_LIVES); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0404);
    scene.fog = new THREE.Fog(0x0a0404, 15, 30);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 60);
    camera.position.set(0, 2, 10);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x100808, 3));
    const pLight = new THREE.PointLight(0x0891b2, 60, 20);
    pLight.position.set(0, 4, 7);
    scene.add(pLight);
    accentLightRef.current = pLight;
    scene.add(Object.assign(new THREE.PointLight(0xfde047, 40, 15), { position: new THREE.Vector3(2, 2, 5) }));

    // Court surface (clay)
    const court = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshStandardMaterial({ color: 0x3d1a08, roughness: 0.9 }));
    court.rotation.x = -Math.PI / 2; court.position.y = -0.01;
    court.receiveShadow = true;
    scene.add(court);
    // Court lines
    const lineMatW = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    [[-4, -5.8, -4, 5.8], [4, -5.8, 4, 5.8], [-4, -3, 4, -3], [-4, 3, 4, 3]].forEach(([x1, z1, x2, z2]) => {
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x2, 0, z2)]), lineMatW));
    });

    // Net
    const netGeo = new THREE.BoxGeometry(0.06, 1.2, 8);
    const netMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, 0.6, 0);
    scene.add(net);
    netRef.current = net;

    // Ball
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0x7a6a00, roughness: 0.4 }));
    ball.castShadow = true; ball.visible = false;
    scene.add(ball);
    ballRef.current = ball;

    // Stars in bg
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(200);
    for (let i = 0; i < 200; i += 3) { sp[i] = (Math.random()-0.5)*40; sp[i+1] = 1 + Math.random()*10; sp[i+2] = -10 - Math.random()*5; }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x0891b2, size: 0.06 })));

    // Input (swipe)
    const onDown = (e: PointerEvent) => {
      if (!s.running) return;
      s.isSwiping = true; s.swipeStartX = e.clientX; s.swipeStartY = e.clientY; s.swipeStartTime = Date.now();
    };
    const onUp = (e: PointerEvent) => {
      if (!s.running || !s.isSwiping) return; s.isSwiping = false;
      if (!s.ballActive || !s.ballInZone) return;
      const dx = e.clientX - s.swipeStartX;
      const isTap = Math.abs(dx) < 20;
      const pointValue = isTap ? 5 : 10;
      const reactionTime = Date.now() - s.ballZoneEnterTime;
      s.sig.reactionTimes.push(reactionTime);
      if (!isTap) { if (dx < 0) s.sig.forehands++; else s.sig.backhands++; }
      // Return ball
      s.ballVX = Math.abs(s.ballVX) * 1.1; s.ballVY += (Math.random()-0.5)*0.02;
      s.ballX = s.playerZoneX + 0.5; s.ballInZone = false;
      s.sig.returns++; s.sig.score += pointValue; s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.streakMax) s.sig.streakMax = s.sig.streakCurrent;
      setScoreDisplay(s.sig.score); setStreakDisplay(s.sig.streakCurrent);
      triggerPop(`+${pointValue}`, window.innerWidth * 0.25, window.innerHeight * 0.5);
      playScoreHit('default', pointValue); hapticScore();
      sfx.collect();
      setTimeout(() => { if (s.running) { s.ballVX = -Math.abs(s.ballVX) * (1 + Math.random() * 0.2); } }, 450);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      const elapsed = DURATION - s.timeLeft;
      const newTier = Math.floor(elapsed / 10);
      if (newTier > s.speedTier) { s.speedTier = newTier; s.speed = 0.08 + newTier * 0.02; increaseMusicTempo(128 + newTier * 8); }
      if (s.timeLeft <= 5 && s.timeLeft > 0) sfx.tick();
      if (s.timeLeft <= 0) { sfx.success(); haptic([30, 50, 100]); endGame(); }
    }, 1000);

    spawnBall();

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.012;

      if (s.ballActive && ball.visible) {
        s.ballX += s.ballVX; s.ballY += s.ballVY;
        // Bounce off top/bottom
        if (s.ballY > s.courtTop) { s.ballY = s.courtTop; s.ballVY = -Math.abs(s.ballVY); sfx.click(); }
        if (s.ballY < s.courtBottom) { s.ballY = s.courtBottom; s.ballVY = Math.abs(s.ballVY); sfx.click(); }
        // Enter player zone
        if (s.ballX < s.playerZoneX * 0.7 && !s.ballInZone && s.ballVX < 0) {
          s.ballInZone = true; s.ballZoneEnterTime = Date.now();
          s.ballVX *= 0.6;
        }
        ball.position.set(s.ballX, s.ballY, 0);
        ball.rotation.x += 0.08; ball.rotation.z += 0.06;
        // Trail
        const trailGeo = new THREE.SphereGeometry(0.08, 6, 6);
        const trailMesh = new THREE.Mesh(trailGeo, new THREE.MeshStandardMaterial({ color: 0xfde047, transparent: true, opacity: 0.5 }));
        trailMesh.position.copy(ball.position);
        scene.add(trailMesh);
        trailsRef.current.push({ mesh: trailMesh, life: 1 });
        // Miss
        if (s.ballX < -6) {
          s.lives--; s.sig.misses++; s.sig.streakCurrent = 0;
          setLivesDisplay(s.lives); setStreakDisplay(0);
          ball.visible = false; s.ballActive = false;
          sfx.collision(); hapticFail();
          playNearMiss();
          if (s.lives <= 0) { sfx.fail(); haptic([500]); endGame(); return; }
          setTimeout(() => spawnBall(), 450);
        }
        // Right wall reflect
        if (s.ballX > 5) { s.ballX = 5; s.ballVX = -Math.abs(s.ballVX); }
      }

      // Trails
      for (let i = trailsRef.current.length - 1; i >= 0; i--) {
        const tr = trailsRef.current[i];
        tr.life -= 0.08;
        (tr.mesh.material as THREE.MeshStandardMaterial).opacity = tr.life * 0.5;
        if (tr.life <= 0.05) { scene.remove(tr.mesh); trailsRef.current.splice(i, 1); }
      }

      if (accentLightRef.current) { accentLightRef.current.position.x = s.ballX * 0.3; accentLightRef.current.intensity = 30 + Math.sin(t * 4) * 15; }
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
    };
  }, [endGame, spawnBall, triggerPop]);

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
      if (stopMusicRef.current) stopMusicRef.current();
      if (rendererRef.current && mountRef.current) {
        try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
        rendererRef.current.dispose();
      }
    };
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (rendererRef.current && mountRef.current) {
      try { mountRef.current.removeChild(rendererRef.current.domElement); } catch { /**/ }
      rendererRef.current.dispose(); rendererRef.current = null;
    }
    trailsRef.current = [];
    setScoreDisplay(0); setStreakDisplay(0); setLivesDisplay(MAX_LIVES); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    setPhase('countdown');
  }, []);

  const sig = finalSig;
  const avgRT = sig?.reactionTimes && sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length) : 0;
  const accent = ACCENT;
  return (
    <GameShell title="Reflex Rally" emoji="🎾" accentColor={accent} theme={theme}
      background="radial-gradient(ellipse at 50% 70%, rgba(8,145,178,0.1) 0%, transparent 60%), linear-gradient(180deg, #0a0404 0%, #050202 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji="🎾" title="Reflex Rally" description="Swipe when the ball enters your zone. Return every shot. 5 lives."
          ctaLabel="Start Game →" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD items={[
                { label: 'SCORE', value: scoreDisplay, testId: 'score' },
                { label: 'TIME', value: `${timeLeft}s`, danger: timeLeft <= 10, testId: 'timer' },
                { label: 'LIVES', value: '♥'.repeat(livesDisplay) + '♡'.repeat(Math.max(0, MAX_LIVES-livesDisplay)) },
              ]} accentColor={accent} />
              <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.35)', fontSize: 13, pointerEvents: 'none', textAlign: 'center' }}>
                Swipe when ball enters your zone (left side)
              </div>
              <ScorePopEffect pops={pops} accentColor={accent} />
              <StreakBadge streak={streakDisplay} accentColor={accent} />
            </>
          )}
        </>
      )}
      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90,
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', borderRadius: 20, padding: '8px 20px',
              fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'done' && sig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(sig)} emoji="🎾"
          score={`${sig.score} pts`} personality={getPersonality(sig)}
          insights={[
            { label: 'Returns', value: `${sig.returns}`, color: accent },
            { label: 'Avg Reaction', value: avgRT > 0 ? `${avgRT}ms` : 'N/A', color: '#fbbf24' },
            { label: 'Forehand/Back', value: `${sig.forehands}/${sig.backhands}`, color: '#c084fc' },
            { label: 'Best Streak', value: `${sig.streakMax}`, color: '#60a5fa' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={sig.returns > 15} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const ReflexRally = dynamic(() => Promise.resolve({ default: ReflexRallyInner }), { ssr: false });
export default ReflexRally;
