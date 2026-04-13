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

const GAME_ID = 'aurora-wave';
const ACCENT = '#34d399';
const DURATION = 60;
const GAME_EMOJI = 'ðŸŒŒ';
const GAME_TITLE = 'Aurora Wave';
const GAME_TAGLINE = 'Breathe slowly to paint aurora waves. Erratic = broken!';
const SMOOTH_THRESHOLD = 0.08;
const ERRATIC_THRESHOLD = 0.18;

interface Signals {
  auroraSegments: number; brokenWaves: number; longestCalmBreath: number;
  avgBreathVariance: number; score: number; maxColor: number;
}
function getPersonality(sig: Signals): string {
  if (sig.auroraSegments >= 40 && sig.brokenWaves <= 2) return 'Aurora Sage ðŸŒŸ';
  if (sig.brokenWaves === 0 && sig.auroraSegments >= 20) return 'Serene Breather ðŸŒ¿';
  if (sig.auroraSegments >= 30) return 'Wave Painter ðŸŽ¨';
  if (sig.longestCalmBreath >= 5) return 'Deep Calm ðŸ§˜';
  return 'Turbulent Spirit ðŸŒªï¸';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  ribbonPoints: THREE.Vector3[]; ribbonLine: THREE.Line | null;
  ribbonMat: THREE.LineBasicMaterial | null;
  auroraParticles: THREE.Points | null; auroraGeo: THREE.BufferGeometry | null;
  particlePositions: Float32Array | null;
  colorHue: number; waveX: number; calmStreak: number;
  micLevel: number; prevMicLevel: number; breathVariances: number[];
  breakFlash: number; wavePhase: number;
  micRef: { stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null;
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

function AuroraWaveGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { auroraSegments: 0, brokenWaves: 0, longestCalmBreath: 0, avgBreathVariance: 0, score: 0, maxColor: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    ribbonPoints: [], ribbonLine: null, ribbonMat: null,
    auroraParticles: null, auroraGeo: null, particlePositions: null,
    colorHue: 160, waveX: 0, calmStreak: 0,
    micLevel: 0, prevMicLevel: 0, breathVariances: [],
    breakFlash: 0, wavePhase: 0,
    micRef: null, stopMusic: null,
    intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('ðŸŒŒ');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stopMusic) { s.stopMusic(); s.stopMusic = null; }
    if (s.micRef) { s.micRef.stream.getTracks().forEach(t => t.stop()); s.micRef = null; }
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    const avgVar = s.breathVariances.length > 0
      ? s.breathVariances.reduce((a, b) => a + b, 0) / s.breathVariances.length : 0;
    s.sig.avgBreathVariance = avgVar;
        const _pbKey = 'pb_aurora-wave';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(async () => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    // Mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      s.micRef = { stream, analyser, data };
    } catch { /* fallback */ }

    s.running = true; s.timeLeft = DURATION;
    s.sig = { auroraSegments: 0, brokenWaves: 0, longestCalmBreath: 0, avgBreathVariance: 0, score: 0, maxColor: 0 };
    s.micLevel = 0; s.prevMicLevel = 0; s.waveX = 0; s.calmStreak = 0;
    s.breathVariances = []; s.breakFlash = 0; s.colorHue = 160; s.wavePhase = 0;
    s.ribbonPoints = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    s.stopMusic = startMusic('chill');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x040820);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 0, 8);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x112244, 2));

    // Stars
    const starCount = 600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = Math.random() * 20 - 5;
      starPos[i * 3 + 2] = -10 - Math.random() * 20;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.7 })));

    // Mountain silhouette
    const mountainShape = new THREE.Shape();
    mountainShape.moveTo(-12, -5);
    for (let mx = -12; mx <= 12; mx += 0.5) {
      const my = -2 + Math.sin(mx * 0.3) * 1.5 + Math.sin(mx * 0.1) * 2.5;
      mountainShape.lineTo(mx, my);
    }
    mountainShape.lineTo(12, -6); mountainShape.lineTo(-12, -6);
    const mountainGeo = new THREE.ShapeGeometry(mountainShape);
    const mountain = new THREE.Mesh(mountainGeo, new THREE.MeshBasicMaterial({ color: 0x0a1628 }));
    mountain.position.z = -5;
    scene.add(mountain);

    // Aurora ribbon line
    const ribbonMat = new THREE.LineBasicMaterial({ color: 0x34d399, linewidth: 2, transparent: true, opacity: 0.9 });
    s.ribbonMat = ribbonMat;

    // Aurora particle cloud
    const pCount = 500;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 20;
      pPos[i * 3 + 1] = Math.random() * 4 - 1;
      pPos[i * 3 + 2] = -3 - Math.random() * 5;
    }
    const aGeo = new THREE.BufferGeometry();
    aGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const aParticles = new THREE.Points(aGeo, new THREE.PointsMaterial({
      color: 0x34d399, size: 0.08, transparent: true, opacity: 0,
    }));
    scene.add(aParticles);
    s.auroraParticles = aParticles;
    s.auroraGeo = aGeo;
    s.particlePositions = pPos;

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;

      // Breath reading
      let breathLevel = s.micLevel;
      if (s.micRef) {
        const { analyser, data } = s.micRef;
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (const v of data) sum += Math.abs(v - 128);
        breathLevel = sum / data.length / 128;
        breathLevel = s.micLevel * 0.7 + breathLevel * 0.3;
        s.micLevel = breathLevel;
      } else {
        s.micLevel = 0.06 + Math.sin(Date.now() / 2000) * 0.04;
        breathLevel = s.micLevel;
      }

      const variance = Math.abs(breathLevel - s.prevMicLevel);
      s.breathVariances.push(variance);
      s.prevMicLevel = breathLevel;
      s.wavePhase += 0.02;

      const isCalm = breathLevel > 0.02 && breathLevel < SMOOTH_THRESHOLD;
      const isErratic = variance > ERRATIC_THRESHOLD;

      if (isCalm) {
        s.calmStreak++;
        s.waveX += 1.5;
        s.colorHue = (s.colorHue + 0.3) % 360;
        if (s.calmStreak / 60 > s.sig.longestCalmBreath) s.sig.longestCalmBreath = s.calmStreak / 60;

        const worldX = (s.waveX / window.innerWidth) * 16 - 8;
        const waveY = Math.sin(s.wavePhase + s.waveX * 0.01) * 2 * breathLevel * 8;
        s.ribbonPoints.push(new THREE.Vector3(worldX, waveY, 0));
        if (s.ribbonPoints.length > 120) s.ribbonPoints.shift();

        s.sig.auroraSegments++;
        if (s.sig.auroraSegments % 30 === 0) {
          s.sig.score++;
          setScoreDisplay(s.sig.score);
          sfx.collect();
        }
      } else if (isErratic) {
        s.calmStreak = 0;
        s.breakFlash = 15;
        if (s.ribbonPoints.length > 10) {
          s.sig.brokenWaves++;
          sfx.collision(); haptic([20, 30, 20]);
        }
        s.ribbonPoints = [];
        s.waveX = 0;
      }

      if (s.waveX > window.innerWidth) {
        s.sig.score += 5;
        setScoreDisplay(s.sig.score);
        sfx.collect();
        s.ribbonPoints = [];
        s.waveX = 0;
      }

      // Update aurora ribbon
      if (s.ribbonLine && s.scene) {
        s.scene.remove(s.ribbonLine);
        s.ribbonLine.geometry.dispose();
      }
      if (s.ribbonPoints.length > 1 && s.ribbonMat) {
        const geo = new THREE.BufferGeometry().setFromPoints(s.ribbonPoints);
        const line = new THREE.Line(geo, s.ribbonMat);
        scene.add(line);
        s.ribbonLine = line;
        s.ribbonMat.color.setHSL(s.colorHue / 360, 0.8, 0.65);
      }

      // Aurora particles follow breath
      if (s.auroraParticles && s.particlePositions && isCalm) {
        const mat = s.auroraParticles.material as THREE.PointsMaterial;
        mat.opacity = Math.min(0.6, breathLevel * 5);
        mat.color.setHSL(s.colorHue / 360, 0.8, 0.65);
        const pArr = s.particlePositions;
        for (let i = 0; i < 500; i++) {
          pArr[i * 3 + 1] += Math.sin(Date.now() * 0.001 + i) * 0.01;
        }
        (s.auroraGeo!.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      } else if (s.auroraParticles) {
        const mat = s.auroraParticles.material as THREE.PointsMaterial;
        mat.opacity *= 0.98;
      }

      // Break flash
      if (s.breakFlash > 0) {
        s.breakFlash--;
        renderer.setClearColor(new THREE.Color(0.15, 0.02, 0.02));
      } else {
        renderer.setClearColor(0x040820);
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current;
    s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stopMusic) s.stopMusic();
    if (s.micRef) s.micRef.stream.getTracks().forEach(t => t.stop());
    s.resizeCleanup?.();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name); setPlayerAvatar(avatar);
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Begin" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (<>
        <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 5 },
          { label: 'SCORE', value: scoreDisplay },
        ]} /></>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Aurora Segments', value: `${finalSig.auroraSegments}`, color: finalSig.auroraSegments >= 30 ? '#4ade80' : '#facc15' },
            { label: 'Broken Waves', value: `${finalSig.brokenWaves}`, color: finalSig.brokenWaves === 0 ? '#4ade80' : '#ef4444' },
            { label: 'Calm Streak', value: `${Math.round(finalSig.longestCalmBreath)}s`, color: ACCENT },
            { label: 'Breath Control', value: finalSig.avgBreathVariance < 0.05 ? 'Excellent' : finalSig.avgBreathVariance < 0.1 ? 'Good' : 'Erratic', color: finalSig.avgBreathVariance < 0.05 ? '#4ade80' : finalSig.avgBreathVariance < 0.1 ? '#facc15' : '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.auroraSegments >= 20} />
      )}
      {phase === 'done' && finalSig && (() => {
        const personality = getPersonality(finalSig);
        return <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={personality} player={playerSessionRef.current} />;
      })()}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>ðŸ† New Personal Best!</div>
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
    postWebhook(theme, gameId, { personality, score: sig.score, auroraSegments: sig.auroraSegments, brokenWaves: sig.brokenWaves, longestCalmBreath: Math.round(sig.longestCalmBreath) }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const AuroraWaveGame = dynamic(() => Promise.resolve({ default: AuroraWaveGameInner }), { ssr: false });
export default AuroraWaveGame;


