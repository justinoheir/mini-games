'use client';
/**
 * LUNG CAPACITY — 3D expanding lung visualization. Hold breath in zone.
 */
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
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { motion, AnimatePresence } from 'framer-motion';

const GAME_ID = 'lung-capacity';
const ACCENT = '#4ade80';
const DURATION = 45;
const GAME_EMOJI = '🫁';
const GAME_TITLE = 'Lung Capacity';
const GAME_TAGLINE = 'Hold steady. Fill the lungs. Don\'t burst.';
const PB_KEY = 'mg_pb_lung-capacity';

const ZONE_LOW = 0.22;
const ZONE_HIGH = 0.58;

interface Signals { score: number; maxFill: number; steadySeconds: number; overBreaths: number; underBreaths: number; }

function getPersonality(sig: Signals): string {
  if (sig.maxFill >= 90 && sig.steadySeconds >= 25) return 'Iron Lungs 🫁';
  if (sig.maxFill >= 75 && sig.overBreaths <= 3) return 'Breath Master 🧘';
  if (sig.steadySeconds >= 28) return 'Zen Breather 🌬️';
  if (sig.overBreaths > 8) return 'Overdrive 🔥';
  return 'Learning Lungs 🌱';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function LungCapacityGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, maxFill: 0, steadySeconds: 0, overBreaths: 0, underBreaths: 0 } as Signals,
    volume: 0, inZone: false, steadyCounter: 0,
    fill: 0, fillTarget: 0,
    lungMesh: null as THREE.Mesh | null,
    lungInnerMesh: null as THREE.Mesh | null,
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
    analyserBuf: null as Uint8Array | null,
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
    glowLight: null as THREE.PointLight | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [fillDisplay, setFillDisplay] = useState(0);
  const [inZoneDisplay, setInZoneDisplay] = useState(false);
  const [permError, setPermError] = useState('');

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, maxFill: 0, steadySeconds: 0, overBreaths: 0, underBreaths: 0 };
    s.volume = 0; s.fill = 0; s.fillTarget = 0; s.inZone = false; s.steadyCounter = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setFillDisplay(0); setPhase('playing');
    stopMusicRef.current = startMusic('calm');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020f08);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020f08, 0.03);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
    camera.position.set(0, 0, 10);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x0a3a1a, 5));
    const glowLight = new THREE.PointLight(0x4ade80, 2, 15);
    glowLight.position.set(0, 0, 5);
    scene.add(glowLight);
    s.glowLight = glowLight;

    // Background particles (air molecules)
    const bgGeo = new THREE.BufferGeometry();
    const bgPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      bgPos[i * 3] = (Math.random() - 0.5) * 30;
      bgPos[i * 3 + 1] = (Math.random() - 0.5) * 20;
      bgPos[i * 3 + 2] = (Math.random() - 0.5) * 15 - 5;
    }
    bgGeo.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
    scene.add(new THREE.Points(bgGeo, new THREE.PointsMaterial({ color: 0x4ade80, size: 0.05, transparent: true, opacity: 0.3 })));

    // Lung pair (two rounded shapes)
    const lungGroup = new THREE.Group();
    for (let side = -1; side <= 1; side += 2) {
      const geo = new THREE.SphereGeometry(1.2, 20, 20);
      // Squish into lung shape
      geo.scale(1, 1.5, 0.7);
      const mat = new THREE.MeshPhongMaterial({ color: 0x4ade80, emissive: 0x14532d, transparent: true, opacity: 0.6, shininess: 60 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = side * 1.5;
      mesh.position.y = 0;
      lungGroup.add(mesh);

      // Inner glow
      const innerGeo = new THREE.SphereGeometry(0.8, 12, 12);
      innerGeo.scale(1, 1.5, 0.7);
      const innerMat = new THREE.MeshBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.2 });
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.position.x = side * 1.5;
      lungGroup.add(inner);
    }

    // Trachea
    const tracheaGeo = new THREE.CylinderGeometry(0.2, 0.2, 2.5, 12);
    const tracheaMat = new THREE.MeshPhongMaterial({ color: 0x22c55e, emissive: 0x14532d });
    const trachea = new THREE.Mesh(tracheaGeo, tracheaMat);
    trachea.position.y = 1.8;
    lungGroup.add(trachea);

    scene.add(lungGroup);

    // Zone rings (visual reference)
    const lowRingGeo = new THREE.TorusGeometry(2.5, 0.04, 8, 32);
    const lowRing = new THREE.Mesh(lowRingGeo, new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.4 }));
    lowRing.rotation.x = Math.PI / 2;
    scene.add(lowRing);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      const inZ = s.inZone;
      if (inZ) { s.sig.steadySeconds++; s.sig.score += 3; setScoreDisplay(s.sig.score); hapticScore(); }
      else if (s.fill > ZONE_HIGH * 100) { s.sig.overBreaths++; sfx.collision(); hapticFail(); }
      else { s.sig.underBreaths++; }
      if (s.sig.score > s.sig.maxFill) s.sig.maxFill = Math.round(s.fill);
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

      // Get microphone volume
      if (analyserRef.current && s.analyserBuf) {
        analyserRef.current.getByteFrequencyData(s.analyserBuf as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < s.analyserBuf.length; i++) sum += s.analyserBuf[i];
        const vol = sum / s.analyserBuf.length / 255;
        s.volume = s.volume * 0.7 + vol * 0.3;
        s.fillTarget = s.volume;
        s.fill = s.fill * 0.9 + s.fillTarget * 0.1;
        setFillDisplay(Math.round(s.fill * 100));
        const inZ = s.fill >= ZONE_LOW && s.fill <= ZONE_HIGH;
        s.inZone = inZ;
        setInZoneDisplay(inZ);
      } else {
        // No mic - hold touch to fill
        setFillDisplay(Math.round(s.fill * 100));
      }

      if (s.fill > s.sig.maxFill / 100) s.sig.maxFill = Math.round(s.fill * 100);

      // Scale lungs based on fill
      const scale = 1 + s.fill * 0.5;
      const inZ = s.fill >= ZONE_LOW && s.fill <= ZONE_HIGH;
      const color = inZ ? 0x4ade80 : s.fill > ZONE_HIGH ? 0xef4444 : 0xfbbf24;

      lungGroup.scale.setScalar(scale);
      lungGroup.children.forEach((child, i) => {
        const mesh = child as THREE.Mesh;
        if (mesh.material && (mesh.material as THREE.MeshPhongMaterial).color) {
          (mesh.material as THREE.MeshPhongMaterial).color.setHex(color);
        }
      });

      if (s.glowLight) {
        s.glowLight.color.setHex(color);
        s.glowLight.intensity = 1.5 + s.fill * 3 + Math.sin(t * 4) * 0.5;
      }

      // Breath particles when in zone
      if (inZ && Math.random() < 0.2) {
        const pGeo = new THREE.SphereGeometry(0.05, 6, 6);
        const pMat = new THREE.MeshBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.8 });
        const pm = new THREE.Mesh(pGeo, pMat);
        pm.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, 0.5);
        scene.add(pm);
        s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.05, vy: 0.04, vz: 0.02, life: 1 });
      }

      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.life -= 0.025;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life * 0.8;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame]);

  // Touch fill fallback
  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    let holding = false;
    const onPD = () => { holding = true; };
    const onPU = () => { holding = false; stateRef.current.fillTarget = 0; };
    const interval = setInterval(() => {
      if (!stateRef.current.running) return;
      if (!analyserRef.current) {
        // Touch-only mode
        if (holding) {
          stateRef.current.fill = Math.min(1, stateRef.current.fill + 0.02);
        } else {
          stateRef.current.fill = Math.max(0, stateRef.current.fill - 0.03);
        }
        const inZ = stateRef.current.fill >= ZONE_LOW && stateRef.current.fill <= ZONE_HIGH;
        stateRef.current.inZone = inZ;
        setFillDisplay(Math.round(stateRef.current.fill * 100));
        setInZoneDisplay(inZ);
      }
    }, 50);
    el.addEventListener('pointerdown', onPD);
    el.addEventListener('pointerup', onPU);
    return () => { clearInterval(interval); el.removeEventListener('pointerdown', onPD); el.removeEventListener('pointerup', onPU); };
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio();
    // Try microphone
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const actx = new AudioContext(); audioCtxRef.current = actx;
      const analyser = actx.createAnalyser(); analyser.fftSize = 512;
      analyserRef.current = analyser;
      stateRef.current.analyserBuf = new Uint8Array(analyser.frequencyBinCount);
      actx.createMediaStreamSource(stream).connect(analyser);
    } catch { /* fall back to touch */ }
    setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const fillColor = fillDisplay / 100 >= ZONE_LOW && fillDisplay / 100 <= ZONE_HIGH ? '#4ade80' : fillDisplay / 100 > ZONE_HIGH ? '#ef4444' : '#fbbf24';
  const fillLabel = fillDisplay / 100 >= ZONE_LOW && fillDisplay / 100 <= ZONE_HIGH ? '✅ Zone! Keep steady!' : fillDisplay / 100 > ZONE_HIGH ? '🔥 Too much! Let go!' : '⬇️ Hum or hold to fill!';

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#020f08 0%,#041508 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Take a Breath 🫁" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} sensorNote="Hum (mic) or press & hold to fill" />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', width: '70vw', zIndex: 50, pointerEvents: 'none' }}>
            <div style={{ color: fillColor, fontSize: 13, fontWeight: 700, textAlign: 'center', marginBottom: 6 }}>{fillLabel}</div>
            <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 8, height: 14, position: 'relative' }}>
              <div style={{ position: 'absolute', left: `${ZONE_LOW * 100}%`, width: `${(ZONE_HIGH - ZONE_LOW) * 100}%`, height: '100%', background: 'rgba(74,222,128,0.3)', borderRadius: 4 }} />
              <div style={{ width: `${fillDisplay}%`, height: '100%', background: fillColor, borderRadius: 8, transition: 'width 0.05s' }} />
            </div>
          </div>
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'In Zone', value: `${finalSig.steadySeconds}s`, color: '#4ade80' },
            { label: 'Max Fill', value: `${finalSig.maxFill}%`, color: '#06b6d4' },
            { label: 'Overbreaths', value: `${finalSig.overBreaths}`, color: '#ef4444' },
            { label: 'Score', value: `${finalSig.score}`, color: ACCENT },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.steadySeconds >= 20} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, steadySeconds: sig.steadySeconds }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const LungCapacityGame = dynamic(() => Promise.resolve({ default: LungCapacityGameInner }), { ssr: false });
export default LungCapacityGame;
