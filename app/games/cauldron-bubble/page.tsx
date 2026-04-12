'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, startMusic } from '@/lib/audio';
import { hapticImpact, hapticVictory, hapticFail } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'cauldron-bubble';
const ACCENT = '#22c55e';
const DURATION = 45;
const GAME_EMOJI = '🧪';
const GAME_TITLE = 'Cauldron Bubble';
const GAME_TAGLINE = 'Blow to bubble. Too quiet = dead. Too loud = BOOM.';

const ZONE_SAFE_LO = 20;
const ZONE_SAFE_HI = 70;
const ZONE_BOOM = 85;

interface BubbleObj { mesh: THREE.Mesh; r: number; vy: number; color: number; }
interface Signals { score: number; bubbles: number; pops: number; booms: number; calmSeconds: number; }
function getPersonality(sig: Signals): string {
  if (sig.bubbles >= 20 && sig.booms === 0) return 'Potion Master 🧙';
  if (sig.booms === 0) return 'Gentle Brewer 🌿';
  if (sig.booms >= 5) return 'Explosive Chef 💥';
  if (sig.bubbles >= 15) return 'Bubble Witch 🫧';
  return 'Apprentice Brewer 🧪';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  renderer: THREE.WebGLRenderer | null; scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null; animId: number;
  cauldron: THREE.Group | null; liquidMesh: THREE.Mesh | null;
  bubbles: BubbleObj[]; micLevel: number; smoothLevel: number;
  calmStreak: number;
  micRef: { stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null;
  steamParticles: Array<{ mesh: THREE.Mesh; vy: number; vx: number; life: number }>;
  boomFlash: number; cauldronColor: number;
  stopMusic: (() => void) | null;
  intervalId: ReturnType<typeof setInterval> | null;
  resizeCleanup: (() => void) | null;
}

const BREW_COLORS = [0x22c55e, 0x4ade80, 0x86efac, 0xa3e635, 0xfbbf24, 0x34d399, 0x67e8f9];

function CauldronBubbleGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, bubbles: 0, pops: 0, booms: 0, calmSeconds: 0 },
    renderer: null, scene: null, camera: null, animId: 0,
    cauldron: null, liquidMesh: null, bubbles: [], micLevel: 0, smoothLevel: 0,
    calmStreak: 0,
    micRef: null, steamParticles: [], boomFlash: 0, cauldronColor: 0x22c55e,
    stopMusic: null, intervalId: null, resizeCleanup: null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
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
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig });
    setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(async () => {
    const mount = mountRef.current;
    if (!mount) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      ac.createMediaStreamSource(stream).connect(analyser);
      s.micRef = { stream, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
    } catch { /* fallback */ }

    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, bubbles: 0, pops: 0, booms: 0, calmSeconds: 0 };
    s.micLevel = 0; s.smoothLevel = 0; s.calmStreak = 0;
    s.bubbles = []; s.steamParticles = []; s.boomFlash = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0510);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0510, 0.03);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 2, 9);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x112211, 3));
    const greenGlow = new THREE.PointLight(0x22c55e, 2, 20);
    greenGlow.position.set(0, 1, 3);
    scene.add(greenGlow);
    const purpleLight = new THREE.PointLight(0x7c3aed, 1, 15);
    purpleLight.position.set(-3, 3, 2);
    scene.add(purpleLight);

    // Cauldron group
    const cauldron = new THREE.Group();
    // Base feet
    [-0.8, 0, 0.8].forEach(x => {
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, 0.4, 6),
        new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7 })
      );
      foot.position.set(x, -1.4, 0);
      cauldron.add(foot);
    });
    // Pot body
    const potBody = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 0.9, 1.6, 20),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.3 })
    );
    potBody.position.y = -0.5;
    cauldron.add(potBody);
    // Rim
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.08, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9 })
    );
    cauldron.add(rim);
    // Liquid surface
    const liquid = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 32),
      new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 })
    );
    liquid.rotation.x = -Math.PI / 2;
    liquid.position.y = -0.01;
    cauldron.add(liquid);
    s.liquidMesh = liquid;

    scene.add(cauldron);
    s.cauldron = cauldron;

    // Fire below cauldron
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 0.8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 0.8, transparent: true, opacity: 0.7 })
    );
    fire.position.y = -1.8;
    scene.add(fire);

    // Shelves with potions
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.1, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x4a3000, roughness: 0.8 })
    );
    shelf.position.set(0, -2.5, -2);
    scene.add(shelf);

    // Star/sparkle bg
    const sPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 20;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 12;
      sPos[i * 3 + 2] = -8 - Math.random() * 8;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0x44ff88, size: 0.05, transparent: true, opacity: 0.4 })));

    s.stopMusic = startMusic('chill');
    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    s.resizeCleanup = () => window.removeEventListener('resize', handleResize);

    s.intervalId = setInterval(() => {
      if (!s.running) return;
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.smoothLevel >= ZONE_SAFE_LO && s.smoothLevel <= ZONE_SAFE_HI) {
        s.sig.calmSeconds++;
        s.sig.score += 2;
        setScoreDisplay(s.sig.score);
      }
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;

      // Mic
      let level = 30 + Math.sin(Date.now() / 2000) * 20; // fallback 10-50
      if (s.micRef) {
        const { analyser, data } = s.micRef;
        analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (const v of data) sum += v;
        const avg = sum / data.length;
        level = avg / 255 * 100;
        s.micLevel = level;
      }
      s.smoothLevel = s.smoothLevel * 0.7 + level * 0.3;

      const inSafeZone = s.smoothLevel >= ZONE_SAFE_LO && s.smoothLevel <= ZONE_SAFE_HI;
      const isTooLoud = s.smoothLevel >= ZONE_BOOM;

      // Liquid color
      if (s.liquidMesh) {
        const mat = s.liquidMesh.material as THREE.MeshStandardMaterial;
        const liqColor = isTooLoud ? 0xff2200 : inSafeZone ? 0x22c55e : 0x666600;
        mat.color.setHex(liqColor);
        mat.emissive.setHex(liqColor);
        mat.emissiveIntensity = 0.4 + s.smoothLevel / 100 * 0.5;
        // Surface ripple
        s.liquidMesh.scale.x = 1 + Math.sin(Date.now() * 0.01) * 0.01 * (s.smoothLevel / 50);
        s.liquidMesh.scale.z = 1 + Math.cos(Date.now() * 0.01) * 0.01 * (s.smoothLevel / 50);
      }

      // Spawn bubbles when in safe zone
      if (inSafeZone && Math.random() < s.smoothLevel / 100 * 0.5) {
        const bColor = BREW_COLORS[Math.floor(Math.random() * BREW_COLORS.length)];
        const bMesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.07 + Math.random() * 0.1, 8, 8),
          new THREE.MeshStandardMaterial({ color: bColor, emissive: bColor, emissiveIntensity: 0.5, transparent: true, opacity: 0.8 })
        );
        bMesh.position.set((Math.random() - 0.5) * 1.8, 0.1, (Math.random() - 0.5) * 1.8);
        scene.add(bMesh);
        s.bubbles.push({ mesh: bMesh, r: bMesh.geometry.parameters.radius, vy: 0.02 + Math.random() * 0.03, color: bColor });
        s.sig.bubbles++;
        if (s.sig.bubbles % 5 === 0) { s.sig.score += 3; setScoreDisplay(s.sig.score); sfx.collect?.(); }
      }

      // BOOM if too loud
      if (isTooLoud && s.boomFlash <= 0) {
        s.boomFlash = 20;
        s.sig.booms++;
        sfx.collision?.(); hapticFail?.();
        // Clear bubbles
        s.bubbles.forEach(b => scene.remove(b.mesh));
        s.bubbles = [];
      }

      // Update bubbles
      for (let i = s.bubbles.length - 1; i >= 0; i--) {
        const b = s.bubbles[i];
        b.mesh.position.y += b.vy;
        b.mesh.rotation.y += 0.05;
        const mat = b.mesh.material as THREE.MeshStandardMaterial;
        mat.opacity -= 0.005;
        if (b.mesh.position.y > 3 || mat.opacity <= 0) {
          scene.remove(b.mesh); s.bubbles.splice(i, 1);
          s.sig.pops++;
        }
      }

      // Boom flash
      if (s.boomFlash > 0) {
        s.boomFlash--;
        renderer.setClearColor(new THREE.Color(0.15, 0.02, 0.02));
      } else {
        renderer.setClearColor(0x0a0510);
      }

      // Steam particles
      if (inSafeZone && Math.random() < 0.15) {
        const sm = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0xaaffaa, transparent: true, opacity: 0.3 })
        );
        sm.position.set((Math.random() - 0.5) * 1.5, 0.2, (Math.random() - 0.5) * 1.5);
        scene.add(sm);
        s.steamParticles.push({ mesh: sm, vy: 0.03 + Math.random() * 0.02, vx: (Math.random() - 0.5) * 0.01, life: 40 });
      }
      for (let i = s.steamParticles.length - 1; i >= 0; i--) {
        const sp = s.steamParticles[i];
        sp.mesh.position.y += sp.vy; sp.mesh.position.x += sp.vx;
        sp.life--;
        (sp.mesh.material as THREE.MeshBasicMaterial).opacity = sp.life / 40 * 0.3;
        if (sp.life <= 0) { scene.remove(sp.mesh); s.steamParticles.splice(i, 1); }
      }

      // Cauldron gentle sway
      if (s.cauldron) s.cauldron.rotation.y += 0.005;
      // Fire flicker
      fire.scale.y = 0.9 + Math.sin(Date.now() * 0.008) * 0.15;
      fire.scale.x = 0.9 + Math.cos(Date.now() * 0.006) * 0.1;

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

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Brew! 🧪" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        display: phase === 'playing' ? 'block' : 'none', touchAction: 'none',
      }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Bubbles', value: String(finalSig.bubbles), color: ACCENT },
            { label: 'Pops', value: String(finalSig.pops), color: '#67e8f9' },
            { label: 'Booms', value: String(finalSig.booms), color: '#ef4444' },
            { label: 'Calm Seconds', value: `${finalSig.calmSeconds}s`, color: '#4ade80' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.bubbles >= 15 && finalSig.booms === 0} />
      )}
      {phase === 'done' && finalSig && (() => {
        const personality = getPersonality(finalSig);
        return <WebhookEmitter theme={theme} sig={finalSig} personality={personality} player={playerSessionRef.current} />;
      })()}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, bubbles: sig.bubbles, booms: sig.booms }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const CauldronBubbleGame = dynamic(() => Promise.resolve({ default: CauldronBubbleGameInner }), { ssr: false });
export default CauldronBubbleGame;
