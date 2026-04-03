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

const GAME_ID = 'solar-charge';
const ACCENT = '#facc15';
const DURATION = 45;
const GAME_EMOJI = '☀️';
const GAME_TITLE = 'Solar Charge';
const GAME_TAGLINE = 'Stay silent to charge the solar panel. Noise drains it!';
const MIC_THRESHOLD = 0.05;
const CHARGE_RATE = 1.2;
const DISCHARGE_RATE = 3.0;
const TARGET_CHARGE = 100;

interface Signals { maxCharge: number; timesFullyCharged: number; totalSilentFrames: number; totalNoisyFrames: number; score: number; longestSilentStreak: number; }
function getPersonality(sig: Signals): string {
  if (sig.timesFullyCharged >= 3 && sig.totalNoisyFrames < 100) return 'Zen Master ☮️';
  if (sig.timesFullyCharged >= 2) return 'Power Harvester ⚡';
  if (sig.longestSilentStreak >= 180) return 'Silent Storm 🌟';
  if (sig.maxCharge >= 75) return 'Almost There 🔋';
  return 'Noisy Neighbour 📢';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function SolarChargeGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const micRef = useRef<{ stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    sunMesh: null as THREE.Mesh | null,
    panelMesh: null as THREE.Mesh | null,
    panelGroup: null as THREE.Group | null,
    chargeMesh: null as THREE.Mesh | null,
    sunLight: null as THREE.PointLight | null,
    chargeLight: null as THREE.PointLight | null,
    photons: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
    running: false, timeLeft: DURATION,
    sig: { maxCharge: 0, timesFullyCharged: 0, totalSilentFrames: 0, totalNoisyFrames: 0, score: 0, longestSilentStreak: 0 } as Signals,
    chargeLevel: 0, micLevel: 0, isCharging: false,
    rayAngle: 0, silentStreak: 0, scoreFlash: 0,
    spawnTimer: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [chargeDisplay, setChargeDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stopMic = useCallback(() => {
    if (micRef.current) { micRef.current.stream.getTracks().forEach(t => t.stop()); micRef.current = null; }
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    stopMic();
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, [stopMic]);

  const startLoop = useCallback(async () => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { maxCharge: 0, timesFullyCharged: 0, totalSilentFrames: 0, totalNoisyFrames: 0, score: 0, longestSilentStreak: 0 };
    s.chargeLevel = 0; s.micLevel = 0; s.isCharging = false; s.silentStreak = 0;
    setScoreDisplay(0); setChargeDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020818);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 1, 7);
    camera.lookAt(0, 0.5, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x020818, 2));

    // Sun
    const sunGeo = new THREE.SphereGeometry(1.0, 24, 24);
    const sunMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfacc15, emissiveIntensity: 1.5, roughness: 0 });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.set(-3.5, 3.5, -4);
    scene.add(sunMesh);
    s.sunMesh = sunMesh;
    const sunLight = new THREE.PointLight(0xfacc15, 4, 30);
    sunLight.position.copy(sunMesh.position);
    scene.add(sunLight);
    s.sunLight = sunLight;
    // Sun rays (line segments)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const rayPts = [
        new THREE.Vector3(Math.cos(angle) * 1.1, Math.sin(angle) * 1.1, 0),
        new THREE.Vector3(Math.cos(angle) * 1.7, Math.sin(angle) * 1.7, 0),
      ];
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rayPts), new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.5 }));
      ray.position.copy(sunMesh.position);
      scene.add(ray);
    }

    // Planet backdrop spheres
    const planetColors = [0x4ade80, 0x06b6d4, 0xa855f7];
    [[-6, 0.5, -8], [5, -1, -10], [0, -2.5, -12]].forEach(([x, y, z], i) => {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.4 + i * 0.2, 12, 12), new THREE.MeshStandardMaterial({ color: planetColors[i], roughness: 0.7 }));
      p.position.set(x, y, z);
      scene.add(p);
    });

    // Stars
    const sp = new Float32Array(600*3);
    for (let i=0;i<600;i++){sp[i*3]=(Math.random()-.5)*80;sp[i*3+1]=(Math.random()-.5)*80;sp[i*3+2]=(Math.random()-.5)*80;}
    const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.06})));

    // Solar panel group
    const panelGroup = new THREE.Group();
    // Panel surface
    const panelGeo = new THREE.BoxGeometry(2.5, 1.5, 0.08);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a4e, roughness: 0.3, metalness: 0.8 });
    const panelMesh = new THREE.Mesh(panelGeo, panelMat);
    panelGroup.add(panelMesh);
    // Grid lines on panel
    for (let gi = 0; gi < 4; gi++) {
      const gLine = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.02, 0.1), new THREE.MeshStandardMaterial({ color: 0x3b82f6 }));
      gLine.position.y = -0.6 + gi * 0.4;
      panelGroup.add(gLine);
    }
    for (let gi = 0; gi < 6; gi++) {
      const gLine = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.5, 0.1), new THREE.MeshStandardMaterial({ color: 0x3b82f6 }));
      gLine.position.x = -1.1 + gi * 0.44;
      panelGroup.add(gLine);
    }
    // Panel mount stand
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
    stand.position.y = -1.15;
    panelGroup.add(stand);
    panelGroup.position.set(1.5, 0, 0);
    panelGroup.rotation.y = -0.4;
    scene.add(panelGroup);
    s.panelMesh = panelMesh;
    s.panelGroup = panelGroup;

    // Charge glow on panel
    const chargeLight = new THREE.PointLight(0xfacc15, 0, 6);
    chargeLight.position.set(1.5, 0, 1);
    scene.add(chargeLight);
    s.chargeLight = chargeLight;

    // Charge bar (vertical bar to the right)
    const chargeBarBg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4, 0.1), new THREE.MeshStandardMaterial({ color: 0x1a1a2e }));
    chargeBarBg.position.set(4.5, 1, 0);
    scene.add(chargeBarBg);
    const chargeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.12), new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.8 }));
    chargeMesh.position.set(4.5, -0.9, 0);
    scene.add(chargeMesh);
    s.chargeMesh = chargeMesh;

    // Setup mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      micRef.current = { stream, analyser, data };
    } catch { /* no mic */ }

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.isCharging) {
        s.silentStreak++;
        if (s.silentStreak > s.sig.longestSilentStreak) s.sig.longestSilentStreak = s.silentStreak;
      } else {
        s.silentStreak = 0;
      }
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;
      s.spawnTimer++;

      // Read mic
      if (micRef.current) {
        micRef.current.analyser.getByteFrequencyData(micRef.current.data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < micRef.current.data.length; i++) sum += micRef.current.data[i];
        s.micLevel = sum / (micRef.current.data.length * 255);
      }

      s.isCharging = s.micLevel < MIC_THRESHOLD;
      if (s.isCharging) {
        s.sig.totalSilentFrames++;
        s.chargeLevel = Math.min(TARGET_CHARGE, s.chargeLevel + CHARGE_RATE * 0.016 * 60);
        if (s.chargeLevel > s.sig.maxCharge) s.sig.maxCharge = s.chargeLevel;
        if (s.chargeLevel >= TARGET_CHARGE - 0.5 && s.chargeLevel < TARGET_CHARGE + 0.5) {
          s.sig.timesFullyCharged++;
          s.sig.score += 10; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]);
        }
        s.sig.score += 0.02; setChargeDisplay(Math.round(s.chargeLevel));
        // Spawn photons
        if (s.spawnTimer % 12 === 0) {
          const phGeo = new THREE.SphereGeometry(0.06, 4, 4);
          const phMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 1, transparent: true, opacity: 1 });
          const phMesh = new THREE.Mesh(phGeo, phMat);
          phMesh.position.copy(sunMesh.position);
          scene.add(phMesh);
          const dir = new THREE.Vector3(1.5, 0, 0).sub(sunMesh.position).normalize();
          s.photons.push({ mesh: phMesh, vx: dir.x * 0.08, vy: dir.y * 0.08, vz: dir.z * 0.08, life: 40 });
        }
      } else {
        s.sig.totalNoisyFrames++;
        s.chargeLevel = Math.max(0, s.chargeLevel - DISCHARGE_RATE * 0.016 * 60);
        setChargeDisplay(Math.round(s.chargeLevel));
      }

      // Photons
      for (let pi = s.photons.length - 1; pi >= 0; pi--) {
        const p = s.photons[pi];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life / 40;
        if (p.life <= 0) { scene.remove(p.mesh); s.photons.splice(pi, 1); }
      }
      s.photons = stateRef.current.photons;

      // Solar panel tilt toward sun when charging
      const targetTilt = s.isCharging ? -0.5 : 0;
      panelGroup.rotation.x += (targetTilt - panelGroup.rotation.x) * 0.05;

      // Panel emissive when charged
      const chargePct = s.chargeLevel / TARGET_CHARGE;
      panelMat.emissive.setHex(s.isCharging ? 0x3b82f6 : 0x000000);
      panelMat.emissiveIntensity = s.isCharging ? chargePct * 0.5 : 0;
      chargeLight.intensity = chargePct * 3 * (s.isCharging ? 1 : 0.2);
      chargeLight.color.setHex(chargePct > 0.8 ? 0xfacc15 : 0x3b82f6);

      // Charge bar
      const barH = Math.max(0.1, chargePct * 4);
      chargeMesh.scale.y = barH * 10;
      chargeMesh.position.y = -0.9 + barH * 5;
      (chargeMesh.material as THREE.MeshStandardMaterial).color.setHex(chargePct > 0.8 ? 0xfacc15 : chargePct > 0.5 ? 0x22c55e : 0x06b6d4);

      // Sun pulse
      sunMesh.scale.setScalar(1 + Math.sin(t * 2) * 0.03);
      sunLight.intensity = 3 + Math.sin(t * 3) * 0.5;

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    s.photons = [];
  }, [endGame, stopMic]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    stopMic();
    (s as any)._cleanup?.();
  }, [stopMic]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setChargeDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Charge" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (
        <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'CHARGE', value: `${chargeDisplay}%` },
          { label: 'SCORE', value: Math.round(scoreDisplay) },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(Math.round(finalSig.score))} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Max Charge', value: `${Math.round(finalSig.maxCharge)}%`, color: accent },
              { label: 'Full Charges', value: String(finalSig.timesFullyCharged), color: '#4ade80' },
              { label: 'Silent Streak', value: `${finalSig.longestSilentStreak}s`, color: '#06b6d4' },
              { label: 'Noisy Frames', value: String(finalSig.totalNoisyFrames), color: '#ef4444' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.timesFullyCharged >= 2} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, maxCharge: sig.maxCharge, timesFullyCharged: sig.timesFullyCharged }, player); }, [theme, sig, personality, player]);
  return null;
}
