'use client';
/**
 * HUM MAZE — 3D tunnel with pitch-steered ball flying through gate rings.
 * Low pitch drifts LEFT, High pitch drifts RIGHT.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Mic } from 'lucide-react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, startMusic, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';

const GAME_ID = 'hum-maze';
const PB_KEY = 'mg_pb_hum-maze';
const ACCENT = '#818cf8';
const DURATION = 60;
const GAME_EMOJI = '🌀';
const GAME_TITLE = 'Hum Maze';
const GAME_TAGLINE = 'Hum low to drift left, high to drift right. Navigate the gates.';

const PITCH_LOW = 220;
const PITCH_HIGH = 350;
const DRIFT_SPEED = 3.5;
const GATE_SPEED = 12;
const GATE_SPACING = 18;

function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length, HALF = SIZE >> 1;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;
  const minLag = Math.floor(sampleRate / 700), maxLag = Math.min(Math.ceil(sampleRate / 80), SIZE - 2);
  let bestLag = -1, bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i < HALF; i++) c += buf[i] * buf[i + lag];
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }
  if (bestLag < 1) return -1;
  let norm = 0;
  for (let i = 0; i < HALF; i++) norm += buf[i] * buf[i];
  if (norm < 1e-8 || bestCorr / norm < 0.26) return -1;
  return sampleRate / bestLag;
}

type GateDir = 'left' | 'center' | 'right';

interface Signals {
  score: number; gatesPassed: number; collisions: number;
  avgPitch: number; perfectRun: boolean;
}

function getPersonality(s: Signals): string {
  if (s.perfectRun && s.gatesPassed >= 8) return 'Pitch Navigator 🗺️';
  if (s.gatesPassed >= 8) return 'Hum Master 🎵';
  if (s.gatesPassed >= 4) return 'Drone Pilot 🚁';
  return 'Learning to Hum 🌀';
}

type Phase = 'start' | 'permission' | 'countdown' | 'playing' | 'done';

function HumMazeGameInner() {
  const theme = useBrandTheme();
  const accent = theme.colors.accent ?? ACCENT;
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    ballX: 0, pitch: -1, displayPitch: -1, lastDetectTs: 0,
    gateObjects: [] as Array<{ group: THREE.Group; dir: GateDir; passed: boolean; z: number }>,
    gatesPassed: 0, collisions: 0,
    pitchSum: 0, pitchCount: 0,
    hitFlash: 0, pitchBuf: null as Float32Array | null,
    ball: null as THREE.Mesh | null,
    ballParticles: [] as THREE.Mesh[],
    hitFlashMat: null as THREE.MeshBasicMaterial | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisp, setScoreDisp] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [permError, setPermError] = useState('');
  const [isNewBest, setIsNewBest] = useState(false);
  const { pops, triggerPop } = useScorePop();
  const prevScore = useRef(0);

  useEffect(() => {
    if (scoreDisp > prevScore.current) triggerPop(`+${scoreDisp - prevScore.current}`, window.innerWidth / 2, 200);
    prevScore.current = scoreDisp;
  }, [scoreDisp, triggerPop]);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    const sig: Signals = {
      score: s.gatesPassed * 30 + (s.collisions === 0 ? 50 : 0),
      gatesPassed: s.gatesPassed, collisions: s.collisions,
      avgPitch: s.pitchCount > 0 ? Math.round(s.pitchSum / s.pitchCount) : 0,
      perfectRun: s.collisions === 0,
    };
    sfx.success(); hapticVictory(); playVictoryFanfare();
    try {
      const p = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (sig.score > p) { localStorage.setItem(PB_KEY, String(sig.score)); setIsNewBest(true); }
    } catch { /**/ }
    setFinalSig(sig); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.ballX = 0;
    s.pitch = -1; s.displayPitch = -1; s.lastDetectTs = 0;
    s.gateObjects = []; s.gatesPassed = 0; s.collisions = 0;
    s.pitchSum = 0; s.pitchCount = 0; s.hitFlash = 0;
    setScoreDisp(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('calm');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x04030f);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x04030f, 0.04);
    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 200);
    camera.position.set(0, 0, 8);

    // Lights
    scene.add(new THREE.AmbientLight(0x221133, 3));
    const ballLight = new THREE.PointLight(0x818cf8, 4, 12);
    scene.add(ballLight);
    const dirLight = new THREE.DirectionalLight(0x4f46e5, 2);
    dirLight.position.set(0, 5, 5);
    scene.add(dirLight);

    // Tunnel walls — particles as dots along tunnel
    const tunnelParticles = new THREE.BufferGeometry();
    const tpPos = new Float32Array(800 * 3);
    for (let i = 0; i < 800; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 2;
      tpPos[i * 3] = Math.cos(theta) * r;
      tpPos[i * 3 + 1] = Math.sin(theta) * r;
      tpPos[i * 3 + 2] = -Math.random() * 120;
    }
    tunnelParticles.setAttribute('position', new THREE.BufferAttribute(tpPos, 3));
    scene.add(new THREE.Points(tunnelParticles, new THREE.PointsMaterial({ color: 0x3730a3, size: 0.06, transparent: true, opacity: 0.5 })));

    // Ball
    const ballGeo = new THREE.SphereGeometry(0.35, 24, 24);
    const ballMat = new THREE.MeshPhongMaterial({ color: 0x818cf8, emissive: 0x3730a3, shininess: 100 });
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.position.set(0, 0, 5);
    scene.add(ball);
    s.ball = ball;

    // Hit flash overlay mesh (fullscreen quad)
    const flashGeo = new THREE.PlaneGeometry(30, 30);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const flashPlane = new THREE.Mesh(flashGeo, flashMat);
    flashPlane.position.set(0, 0, 7.5);
    scene.add(flashPlane);
    s.hitFlashMat = flashMat;

    // Gate creation
    const accentHex = parseInt(accent.replace('#', ''), 16);
    const createGate = (dir: GateDir, zPos: number) => {
      const group = new THREE.Group();
      const gapHalf = 3.5;
      const wallW = 6, wallH = 6;

      // Determine gap center X
      const gapCenterX = dir === 'left' ? -7 : dir === 'right' ? 7 : 0;

      // Left wall
      const lwGeo = new THREE.BoxGeometry(wallW, wallH, 0.3);
      const lwMat = new THREE.MeshPhongMaterial({ color: accentHex, emissive: 0x1e1b4b, transparent: true, opacity: 0.6 });
      const lw = new THREE.Mesh(lwGeo, lwMat);
      lw.position.set(gapCenterX - gapHalf - wallW / 2, 0, 0);
      group.add(lw);

      // Right wall
      const rw = new THREE.Mesh(lwGeo.clone(), lwMat.clone());
      rw.position.set(gapCenterX + gapHalf + wallW / 2, 0, 0);
      group.add(rw);

      // Top wall
      const twGeo = new THREE.BoxGeometry(20, 1.5, 0.3);
      const twMat = new THREE.MeshPhongMaterial({ color: accentHex, emissive: 0x1e1b4b, transparent: true, opacity: 0.4 });
      const tw = new THREE.Mesh(twGeo, twMat);
      tw.position.set(0, wallH / 2 + 0.75, 0);
      group.add(tw);

      // Bottom wall
      const bw = new THREE.Mesh(twGeo.clone(), twMat.clone());
      bw.position.set(0, -wallH / 2 - 0.75, 0);
      group.add(bw);

      // Direction arrow
      const arrowGeo = new THREE.ConeGeometry(0.4, 1, 6);
      const arrowMat = new THREE.MeshPhongMaterial({ color: 0xfbbf24, emissive: 0x92400e });
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.set(gapCenterX, 0, 0.3);
      arrow.rotation.z = dir === 'left' ? -Math.PI / 2 : dir === 'right' ? Math.PI / 2 : Math.PI;
      group.add(arrow);

      group.position.z = zPos;
      scene.add(group);
      return { group, dir, passed: false, z: zPos };
    };

    // Seed gates
    const DIRS: GateDir[] = ['left', 'center', 'right'];
    for (let i = 1; i <= 6; i++) {
      s.gateObjects.push(createGate(DIRS[Math.floor(Math.random() * 3)], -i * GATE_SPACING));
    }

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      sfx.tick();
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;
      const now = Date.now();

      // Pitch detection
      if (now - s.lastDetectTs >= 50 && analyserRef.current && s.pitchBuf && audioCtxRef.current) {
        s.lastDetectTs = now;
        analyserRef.current.getFloatTimeDomainData(s.pitchBuf as Float32Array<ArrayBuffer>);
        s.pitch = autoCorrelate(s.pitchBuf, audioCtxRef.current.sampleRate);
        if (s.pitch > 0) { s.pitchSum += s.pitch; s.pitchCount++; }
      }

      // Drift ball
      let drift = 0;
      if (s.pitch > 0) {
        s.displayPitch = s.displayPitch > 0 ? s.displayPitch * 0.75 + s.pitch * 0.25 : s.pitch;
        const dp = s.displayPitch;
        if (dp < PITCH_LOW) drift = -1 * (1 - dp / PITCH_LOW);
        else if (dp > PITCH_HIGH) drift = Math.min(1, (dp - PITCH_HIGH) / 200);
      }
      s.ballX += drift * DRIFT_SPEED * 0.016;
      s.ballX = Math.max(-7, Math.min(7, s.ballX));

      if (s.ball) {
        s.ball.position.x += (s.ballX - s.ball.position.x) * 0.15;
        s.ball.rotation.x += 0.03;
        s.ball.rotation.y += 0.05;
        ballLight.position.copy(s.ball.position);
        // Color pulse
        (s.ball.material as THREE.MeshPhongMaterial).color.setHSL((230 + s.hitFlash * 30) / 360, 0.7, 0.6 + Math.sin(t * 3) * 0.1);
      }

      // Move gates toward camera
      for (let i = s.gateObjects.length - 1; i >= 0; i--) {
        const g = s.gateObjects[i];
        g.group.position.z += GATE_SPEED * 0.016;
        g.z = g.group.position.z;

        // Check pass
        if (!g.passed && g.group.position.z > camera.position.z + 1) {
          g.passed = true;
          const gapCenterX = g.dir === 'left' ? -7 : g.dir === 'right' ? 7 : 0;
          const ballXAtPass = s.ball ? s.ball.position.x : s.ballX;
          const inGap = Math.abs(ballXAtPass - gapCenterX) < 3.5;
          if (inGap) {
            s.gatesPassed++;
            hapticScore(); sfx.collect();
            setScoreDisp(s.gatesPassed * 30 + (s.collisions === 0 ? 50 : 0));
            // Spawn burst
            for (let p = 0; p < 8; p++) {
              const pGeo = new THREE.SphereGeometry(0.08, 8, 8);
              const pMat = new THREE.MeshBasicMaterial({ color: 0x818cf8 });
              const pm = new THREE.Mesh(pGeo, pMat);
              pm.position.set(ballXAtPass + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, camera.position.z);
              scene.add(pm);
              s.ballParticles.push(pm);
            }
          } else {
            s.collisions++; s.hitFlash = 12;
            hapticFail(); sfx.collision();
          }
        }

        // Remove gates that pass camera
        if (g.group.position.z > camera.position.z + 3) {
          scene.remove(g.group);
          s.gateObjects.splice(i, 1);
        }
      }

      // Spawn new gates
      while (s.gateObjects.length < 7) {
        const lastZ = s.gateObjects.length > 0 ? Math.min(...s.gateObjects.map(g => g.z)) : -GATE_SPACING;
        const DIRS2: GateDir[] = ['left', 'center', 'right'];
        s.gateObjects.push(createGate(DIRS2[Math.floor(Math.random() * 3)], lastZ - GATE_SPACING));
      }

      // Update burst particles
      for (let i = s.ballParticles.length - 1; i >= 0; i--) {
        const pm = s.ballParticles[i];
        pm.position.y += 0.05;
        (pm.material as THREE.MeshBasicMaterial).opacity -= 0.03;
        if ((pm.material as THREE.MeshBasicMaterial).opacity <= 0) {
          scene.remove(pm);
          s.ballParticles.splice(i, 1);
        }
      }

      // Hit flash
      s.hitFlash = Math.max(0, s.hitFlash - 0.5);
      if (s.hitFlashMat) s.hitFlashMat.opacity = s.hitFlash * 0.02;

      // Rotate tunnel particles slowly
      tunnelParticles.rotateY?.(0.001);

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame, accent]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); sfx.click(); setPermError('');
    if (!navigator.mediaDevices?.getUserMedia) { setPermError('Microphone not supported.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;
      const actx = new AudioContext(); await actx.resume(); audioCtxRef.current = actx;
      const analyser = actx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
      analyserRef.current = analyser;
      stateRef.current.pitchBuf = new Float32Array(analyser.fftSize);
      actx.createMediaStreamSource(stream).connect(analyser);
      setPhase('countdown');
    } catch { setPermError('Microphone access denied. Please allow mic access and try again.'); }
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    analyserRef.current = null; stateRef.current.pitchBuf = null;
    setPhase('start'); setScoreDisp(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    prevScore.current = 0;
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}
      background="linear-gradient(180deg, #04030f 0%, #060412 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Enable Mic & Hum →" accentColor={accent} onStart={handleStart}
          sensorNote="🎤 Microphone — hum low or high to steer"
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%,#0a0820 0%,#060412 55%,#040210 100%)">
          {permError && <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, color: '#ef4444', fontSize: 14 }}>{permError}</div>}
        </GameStartScreen>
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none' }} />
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' },
          { label: 'GATES', value: scoreDisp, testId: 'score' },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Gates Passed', value: `${finalSig.gatesPassed}`, color: '#22c55e' },
            { label: 'Collisions', value: `${finalSig.collisions}`, color: '#ef4444' },
            { label: 'Avg Pitch', value: finalSig.avgPitch > 0 ? `${finalSig.avgPitch}Hz` : '—', color: accent },
            { label: 'Perfect Run', value: finalSig.perfectRun ? 'YES 🌟' : 'Not yet', color: finalSig.perfectRun ? '#fbbf24' : '#555' },
          ]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.gatesPassed >= 4} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
      {phase === 'playing' && <ScorePopEffect pops={pops} accentColor={accent} />}
      <AnimatePresence>
        {isNewBest && (
          <motion.div key="pb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90, pointerEvents: 'none', background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', borderRadius: 20, padding: '8px 20px', fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, gatesPassed: sig.gatesPassed, collisions: sig.collisions, avgPitch: sig.avgPitch, perfectRun: sig.perfectRun }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const HumMazeGame = dynamic(() => Promise.resolve({ default: HumMazeGameInner }), { ssr: false });
export default HumMazeGame;
