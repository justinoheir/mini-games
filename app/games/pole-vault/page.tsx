'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';

const GAME_ID      = 'pole-vault';
const PB_KEY       = 'pb_pole-vault';
const ACCENT       = '#f59e0b';
const DURATION     = 45;
const GAME_EMOJI   = '🏃';
const GAME_TITLE   = 'Pole Vault';
const GAME_TAGLINE = 'Hold to charge. Release to vault!';
const MAX_CHARGE   = 3000;
const VAULT_BAR_START = 2.0;

type AttemptPhase = 'idle' | 'running' | 'vaulting' | 'landing';
interface Signals { score: number; attempts: number; bestHeight: number; clears: number; maxStreak: number; streak: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  if (sig.bestHeight >= 4.5 && sig.clears >= 3) return '🏆 World Record';
  if (sig.clears >= 4) return '🌟 Elite Vaulter';
  if (sig.bestHeight >= 3.5) return '🏃 High Flyer';
  if (sig.clears >= 2) return '💪 Bar Clearer';
  return '🎯 Learning to Fly';
}

function PoleVaultGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const runnerRef = useRef<THREE.Group | null>(null);
  const poleRef = useRef<THREE.Mesh | null>(null);
  const barRef = useRef<THREE.Mesh | null>(null);
  const standardsRef = useRef<THREE.Mesh[]>([]);
  const accentLightRef = useRef<THREE.PointLight | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const { pops, triggerPop } = useScorePop();

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, attempts: 0, bestHeight: 0, clears: 0, maxStreak: 0, streak: 0 } as Signals,
    attemptPhase: 'idle' as AttemptPhase,
    chargeStart: 0, chargeMs: 0, isHolding: false,
    runnerX: -5, runnerY: 0, runnerVX: 0, runnerVY: 0,
    poleAngle: 0, poleAngleVel: 0,
    barHeight: VAULT_BAR_START, barCleared: false, 
    vaultT: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [chargeDisplay, setChargeDisplay] = useState(0);
  const [attemptMsg, setAttemptMsg] = useState('');
  const [barHeightDisplay, setBarHeightDisplay] = useState(VAULT_BAR_START);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    hapticVictory();
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0'); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const updateBar = useCallback((height: number) => {
    setBarHeightDisplay(parseFloat(height.toFixed(1)));
    if (barRef.current) barRef.current.position.y = height * 0.7;
    if (standardsRef.current[0]) standardsRef.current[0].scale.y = height * 0.7;
    if (standardsRef.current[1]) standardsRef.current[1].scale.y = height * 0.7;
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, attempts: 0, bestHeight: 0, clears: 0, maxStreak: 0, streak: 0 };
    s.attemptPhase = 'idle'; s.isHolding = false; s.barHeight = VAULT_BAR_START; s.runnerX = -5; s.runnerY = 0;
    setScoreDisplay(0); setChargeDisplay(0); setAttemptMsg(''); setTimeLeft(DURATION);
    setBarHeightDisplay(VAULT_BAR_START); setPhase('playing');
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a14);
    scene.fog = new THREE.Fog(0x0a0a14, 20, 40);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 80);
    camera.position.set(0, 3, 14);
    camera.lookAt(0, 2, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x101020, 3));
    const sunLight = new THREE.DirectionalLight(0xfff5cc, 1);
    sunLight.position.set(5, 10, 5); sunLight.castShadow = true;
    scene.add(sunLight);
    const aLight = new THREE.PointLight(0xf59e0b, 60, 20);
    aLight.position.set(0, 5, 8);
    scene.add(aLight);
    accentLightRef.current = aLight;

    // Stadium atmosphere
    const starsGeo = new THREE.BufferGeometry();
    const starsPos = new Float32Array(600);
    for (let i = 0; i < 600; i += 3) { starsPos[i] = (Math.random()-0.5)*60; starsPos[i+1] = 5 + Math.random()*20; starsPos[i+2] = -15 - Math.random()*10; }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
    scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xf59e0b, size: 0.08 })));

    // Track surface
    const track = new THREE.Mesh(new THREE.PlaneGeometry(20, 6), new THREE.MeshStandardMaterial({ color: 0x8b2515, roughness: 0.8 }));
    track.rotation.x = -Math.PI / 2; track.receiveShadow = true;
    scene.add(track);
    // White line
    const lineGeo = new THREE.PlaneGeometry(20, 0.08);
    const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.01, 0);
    scene.add(line);

    // Landing mat
    const mat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 2), new THREE.MeshStandardMaterial({ color: 0x1b6ca8, roughness: 0.9 }));
    mat.position.set(1.5, 0.075, 0);
    scene.add(mat);

    // Standards (uprights)
    const stdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.8 });
    const std1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), stdMat);
    std1.position.set(-0.4, 1, 0); scene.add(std1);
    const std2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), stdMat);
    std2.position.set(-0.4, 1, 1.5); scene.add(std2);
    standardsRef.current = [std1, std2];
    // Bar
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8), new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x5f1a1a, roughness: 0.4 }));
    bar.rotation.x = Math.PI / 2;
    bar.position.set(-0.4, VAULT_BAR_START * 0.7, 0.75);
    scene.add(bar);
    barRef.current = bar;

    // Runner group
    const runner = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.2), new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.5 }));
    runner.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), new THREE.MeshStandardMaterial({ color: 0xfbbf24 }));
    head.position.y = 0.38;
    runner.add(head);
    runner.position.set(s.runnerX, 0.4, 0.75);
    runner.castShadow = true;
    scene.add(runner);
    runnerRef.current = runner;

    // Pole (cylinder)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.5, 8), new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.9, roughness: 0.1 }));
    pole.position.set(s.runnerX - 0.5, 0.8, 0.75);
    pole.rotation.z = -Math.PI / 2;
    scene.add(pole);
    poleRef.current = pole;

    // Input
    const onDown = () => {
      if (!s.running || s.attemptPhase !== 'idle') return;
      s.isHolding = true; s.chargeStart = Date.now();
      s.attemptPhase = 'running';
      setAttemptMsg('CHARGING...');
    };
    const onUp = () => {
      if (!s.running || !s.isHolding) return;
      s.isHolding = false;
      if (s.attemptPhase === 'running') {
        s.chargeMs = Date.now() - s.chargeStart;
        s.attemptPhase = 'vaulting';
        s.vaultT = 0; s.sig.attempts++;
        setAttemptMsg('');
        sfx.collect(); hapticScore();
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.012;

      if (s.attemptPhase === 'running') {
        const charge = Math.min(1, (Date.now() - s.chargeStart) / MAX_CHARGE);
        setChargeDisplay(Math.round(charge * 100));
        if (runner) { runner.position.x = -5 + charge * 4; runner.rotation.z = Math.sin(t * 8) * 0.06; }
        if (pole) pole.position.x = runner.position.x - 0.5;
      } else if (s.attemptPhase === 'vaulting') {
        s.vaultT += 0.025;
        const charge = Math.min(1, s.chargeMs / MAX_CHARGE);
        const peakH = charge * 4.5 + 0.5 + (Math.random() * 0.3 - 0.15);
        // Parabolic arc
        const arcY = Math.sin(Math.min(s.vaultT, Math.PI) * 0.8) * peakH;
        const arcX = -0.4 + s.vaultT * 2;
        if (runner) {
          runner.position.x = arcX;
          runner.position.y = 0.4 + arcY;
          runner.rotation.z = Math.sin(s.vaultT * 2) * 0.5;
        }
        if (pole) {
          pole.rotation.z = -Math.PI / 2 + s.vaultT * 1.2;
          pole.position.set(arcX - 0.5, 0.8 + arcY * 0.3, 0.75);
        }
        // Track peak height
        if (arcY > s.sig.bestHeight && arcY > 0) s.sig.bestHeight = parseFloat(arcY.toFixed(2));
        // Land
        if (s.vaultT > 2.2) {
          s.attemptPhase = 'landing';
          const cleared = arcY >= s.barHeight - 0.3;
          if (cleared) {
            s.sig.clears++; s.sig.streak++;
            if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
            const pts = Math.round(s.barHeight * 10);
            s.sig.score += pts; setScoreDisplay(s.sig.score);
            s.barHeight = parseFloat((s.barHeight + 0.2).toFixed(1));
            updateBar(s.barHeight);
            sfx.success(); hapticVictory();
            setAttemptMsg(`✅ CLEARED! ${s.sig.bestHeight.toFixed(1)}m`);
            triggerPop(`+${pts}`, window.innerWidth * 0.5, window.innerHeight * 0.35);
          } else {
            s.sig.streak = 0;
            sfx.collision(); hapticFail();
            setAttemptMsg('❌ MISS');
          }
          setTimeout(() => {
            if (s.running) {
              s.attemptPhase = 'idle';
              s.chargeMs = 0; setChargeDisplay(0);
              setAttemptMsg(s.timeLeft <= 0 ? '' : `Bar: ${s.barHeight.toFixed(1)}m`);
              if (runner) { runner.position.set(-5, 0.4, 0.75); runner.rotation.z = 0; }
              if (pole) { pole.position.set(-5.5, 0.8, 0.75); pole.rotation.z = -Math.PI / 2; }
            }
          }, 900);
        }
      }

      if (accentLightRef.current) { accentLightRef.current.intensity = 40 + Math.sin(t * 2) * 15; }
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
    };
  }, [endGame, updateBar, triggerPop]);

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

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
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
    setScoreDisplay(0); setChargeDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setAttemptMsg('');
    setPhase('countdown');
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="radial-gradient(ellipse at 50% 30%, rgba(245,158,11,0.1) 0%, transparent 60%), linear-gradient(180deg, #0a0a14 0%, #050508 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Take the Runway →" accentColor={accent} onStart={handleStart} />
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
                { label: 'BAR', value: `${barHeightDisplay}m` },
              ]} />
              {chargeDisplay > 0 && (
                <div style={{ position: 'absolute', bottom: '15%', left: '50%', transform: 'translateX(-50%)', width: '60%' }}>
                  <div style={{ background: 'rgba(0,0,0,0.5)', borderRadius: 8, overflow: 'hidden', height: 12 }}>
                    <div style={{ width: `${chargeDisplay}%`, height: '100%', background: chargeDisplay > 80 ? '#ef4444' : chargeDisplay > 50 ? '#fbbf24' : '#4ade80', transition: 'width 0.1s' }} />
                  </div>
                  <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4 }}>RELEASE TO VAULT</div>
                </div>
              )}
              {attemptMsg && (
                <div style={{ position: 'absolute', top: '35%', left: '50%', transform: 'translateX(-50%)',
                  color: '#fff', fontSize: 'clamp(18px,5vw,28px)', fontWeight: 900, pointerEvents: 'none',
                  textShadow: `0 0 20px ${accent}` }}>{attemptMsg}</div>
              )}
              {!chargeDisplay && stateRef.current.attemptPhase === 'idle' && (
                <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)',
                  color: 'rgba(255,255,255,0.4)', fontSize: 13, pointerEvents: 'none' }}>
                  Hold to charge · Release to vault
                </div>
              )}
              <ScorePopEffect pops={pops} accentColor={accent} />
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={`${finalSig.bestHeight.toFixed(1)}m`} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Best Height', value: `${finalSig.bestHeight.toFixed(1)}m`, color: '#4ade80' },
              { label: 'Clears', value: `${finalSig.clears}/${finalSig.attempts}`, color: finalSig.clears >= finalSig.attempts * 0.6 ? '#4ade80' : '#facc15' },
              { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#fbbf24' },
              { label: 'Score', value: String(finalSig.score), color: accent },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.clears >= 2} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, bestHeight: sig.bestHeight, clears: sig.clears }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const PoleVaultGame = dynamic(() => Promise.resolve({ default: PoleVaultGameInner }), { ssr: false });
export default PoleVaultGame;
