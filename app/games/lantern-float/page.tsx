'use client';
/**
 * LANTERN FLOAT — 3D glowing lanterns rising through dark night sky.
 * Hold to fill lantern with heat, release to launch.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'lantern-float';
const ACCENT = '#f97316';
const DURATION = 45;
const GAME_EMOJI = '🏮';
const GAME_TITLE = 'Lantern Float';
const GAME_TAGLINE = 'Hold to fill. Release to launch!';

const LANTERN_COLORS = [0xf97316, 0xef4444, 0xfbbf24, 0xf472b6, 0xfb923c];

interface FloatingLantern {
  group: THREE.Group; vy: number; fill: number;
  launched: boolean; reached: boolean; burned: boolean;
  colorHex: number; alpha: number; glowLight: THREE.PointLight;
}

interface Signals {
  lanternsLaunched: number; lanternsReached: number;
  overcharged: number; perfectLaunches: number; score: number;
}

function getPersonality(s: Signals): string {
  if (s.perfectLaunches >= 6 && s.overcharged === 0) return 'Sky Lantern Guru 🌟';
  if (s.lanternsReached >= 8) return 'Festival Master 🎆';
  if (s.overcharged >= 4) return 'Too Eager! 🔥';
  if (s.lanternsReached >= 4) return 'Night Sky Lover ✨';
  return 'First Launch 🕯️';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function createLanternMesh(colorHex: number): THREE.Group {
  const group = new THREE.Group();

  // Body (cylinder)
  const bodyGeo = new THREE.CylinderGeometry(0.4, 0.3, 0.9, 12);
  const bodyMat = new THREE.MeshPhongMaterial({
    color: colorHex, emissive: colorHex, emissiveIntensity: 0.3,
    transparent: true, opacity: 0.85,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Top cap
  const topGeo = new THREE.CylinderGeometry(0.1, 0.4, 0.15, 12);
  const topMesh = new THREE.Mesh(topGeo, bodyMat.clone());
  topMesh.position.y = 0.52;
  group.add(topMesh);

  // Bottom opening
  const bottomGeo = new THREE.RingGeometry(0.1, 0.3, 12);
  const bottomMat = new THREE.MeshBasicMaterial({ color: 0x1a0000, side: THREE.DoubleSide });
  const bottom = new THREE.Mesh(bottomGeo, bottomMat);
  bottom.position.y = -0.45;
  bottom.rotation.x = Math.PI / 2;
  group.add(bottom);

  // Inner glow sphere
  const glowGeo = new THREE.SphereGeometry(0.25, 12, 12);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.15 });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  group.add(glow);

  // String
  const stringGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4);
  const stringMat = new THREE.MeshBasicMaterial({ color: 0xd97706 });
  const string = new THREE.Mesh(stringGeo, stringMat);
  string.position.y = -0.65;
  group.add(string);

  return group;
}

export default function LanternFloatGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION, frame: 0,
    sig: { lanternsLaunched: 0, lanternsReached: 0, overcharged: 0, perfectLaunches: 0, score: 0 } as Signals,
    lanterns: [] as FloatingLantern[],
    currentLantern: null as FloatingLantern | null,
    holding: false, holdStart: 0, currentFill: 0,
    stars: [] as THREE.Points,
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [fillPct, setFillPct] = useState(0);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const pb = parseInt(localStorage.getItem('pb_' + GAME_ID) ?? '0');
    if (s.sig.score > pb) localStorage.setItem('pb_' + GAME_ID, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { lanternsLaunched: 0, lanternsReached: 0, overcharged: 0, perfectLaunches: 0, score: 0 };
    s.lanterns = []; s.particles = []; s.holding = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setFillPct(0); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050020);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050020, 0.015);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 0, 12);
    s.camera = camera;

    // Ambient + moon light
    scene.add(new THREE.AmbientLight(0x0a0035, 5));
    const moonLight = new THREE.DirectionalLight(0x8080ff, 1);
    moonLight.position.set(-5, 10, 5);
    scene.add(moonLight);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(1200 * 3);
    for (let i = 0; i < 1200; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 100;
      starPos[i * 3 + 1] = Math.random() * 60 - 10;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 60 - 5;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starField = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.8 }));
    scene.add(starField);

    // Target zone ring at top
    const targetRingGeo = new THREE.TorusGeometry(3, 0.08, 8, 32);
    const targetRingMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.4 });
    const targetRing = new THREE.Mesh(targetRingGeo, targetRingMat);
    targetRing.position.y = 8;
    targetRing.rotation.x = Math.PI / 2;
    scene.add(targetRing);

    // Spawn initial lantern
    const spawnLantern = () => {
      if (!s.running) return;
      const colorHex = LANTERN_COLORS[Math.floor(Math.random() * LANTERN_COLORS.length)];
      const group = createLanternMesh(colorHex);
      group.position.set((Math.random() - 0.5) * 6, -5, 0);
      scene.add(group);

      const glowLight = new THREE.PointLight(colorHex, 0, 4);
      glowLight.position.copy(group.position);
      scene.add(glowLight);

      const fl: FloatingLantern = { group, vy: 0, fill: 0, launched: false, reached: false, burned: false, colorHex, alpha: 1, glowLight };
      s.currentLantern = fl;
    };
    spawnLantern();

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const TARGET_Y = 8;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;
      s.frame++;

      // Update fill
      if (s.holding && s.currentLantern && !s.currentLantern.launched) {
        const elapsed = (Date.now() - s.holdStart) / 3000;
        s.currentLantern.fill = Math.min(100, elapsed * 100);
        s.currentFill = s.currentLantern.fill;
        setFillPct(Math.round(s.currentFill));

        // Update lantern glow based on fill
        const fl = s.currentLantern;
        const glowIntensity = (fl.fill / 100) * 3;
        fl.glowLight.intensity = glowIntensity;
        const innerMesh = fl.group.children[3] as THREE.Mesh;
        (innerMesh.material as THREE.MeshBasicMaterial).opacity = fl.fill / 200;

        // Scale slightly
        const scale = 1 + (fl.fill / 100) * 0.2;
        fl.group.scale.setScalar(scale);
      }

      // Move flying lanterns
      for (let i = s.lanterns.length - 1; i >= 0; i--) {
        const fl = s.lanterns[i];
        if (fl.burned) {
          fl.alpha *= 0.92;
          fl.group.scale.setScalar(fl.alpha);
          if (fl.alpha < 0.05) {
            scene.remove(fl.group);
            scene.remove(fl.glowLight);
            s.lanterns.splice(i, 1);
          }
          continue;
        }

        fl.group.position.y += fl.vy;
        fl.glowLight.position.copy(fl.group.position);

        // Reached target?
        if (!fl.reached && fl.group.position.y >= TARGET_Y) {
          fl.reached = true;
          fl.vy = 0.02;
          s.sig.lanternsReached++;
          s.sig.score += 2;
          sfx.success(); hapticScore();
          setScoreDisplay(s.sig.score);

          // Burst particles
          for (let p = 0; p < 12; p++) {
            const pGeo = new THREE.SphereGeometry(0.05, 6, 6);
            const pMat = new THREE.MeshBasicMaterial({ color: fl.colorHex, transparent: true, opacity: 1 });
            const pm = new THREE.Mesh(pGeo, pMat);
            pm.position.copy(fl.group.position);
            scene.add(pm);
            s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15, vz: (Math.random() - 0.5) * 0.1, life: 1 });
          }
        }

        if (fl.group.position.y > 20) {
          scene.remove(fl.group); scene.remove(fl.glowLight);
          s.lanterns.splice(i, 1);
        }

        // Gentle sway
        fl.group.rotation.z = Math.sin(t * 1.5 + fl.group.position.x) * 0.05;
      }

      // Update particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.life -= 0.025;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      // Pulse target ring
      targetRingMat.opacity = 0.3 + Math.sin(t * 2) * 0.2;
      targetRing.rotation.z += 0.005;

      // Star twinkle
      const sa = (starField.material as THREE.PointsMaterial);
      sa.opacity = 0.6 + Math.sin(t) * 0.2;

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

  const launchLantern = useCallback(() => {
    const s = stateRef.current;
    if (!s.holding || !s.currentLantern || s.currentLantern.launched) return;
    s.holding = false;
    setFillPct(0);
    const fl = s.currentLantern;
    const fill = fl.fill;
    fl.launched = true;

    if (fill >= 95) {
      fl.burned = true;
      s.sig.overcharged++;
      sfx.collision(); hapticFail();
    } else {
      const speed = (fill / 100) * 0.12 + 0.02;
      fl.vy = speed;
      const perfect = fill >= 60 && fill <= 80;
      if (perfect) { s.sig.perfectLaunches++; hapticCombo(3); sfx.success(); }
      else { sfx.collect(); hapticScore(); }
      s.sig.lanternsLaunched++;
      s.lanterns.push(fl);
    }
    fl.group.scale.setScalar(1);
    s.currentLantern = null;

    // Spawn next after delay
    setTimeout(() => {
      if (!s.running || !s.scene) return;
      const colorHex = LANTERN_COLORS[Math.floor(Math.random() * LANTERN_COLORS.length)];
      const group = createLanternMesh(colorHex);
      group.position.set((Math.random() - 0.5) * 6, -5, 0);
      s.scene.add(group);
      const glowLight = new THREE.PointLight(colorHex, 0, 4);
      glowLight.position.copy(group.position);
      s.scene.add(glowLight);
      s.currentLantern = { group, vy: 0, fill: 0, launched: false, reached: false, burned: false, colorHex, alpha: 1, glowLight };
    }, 600);
  }, []);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onPD = () => {
      const s = stateRef.current;
      if (phase !== 'playing' || !s.currentLantern || s.currentLantern.launched) return;
      s.holding = true; s.holdStart = Date.now();
    };
    const onPU = () => { if (phase === 'playing') launchLantern(); };
    el.addEventListener('pointerdown', onPD);
    el.addEventListener('pointerup', onPU);
    return () => { el.removeEventListener('pointerdown', onPD); el.removeEventListener('pointerup', onPU); };
  }, [phase, launchLantern]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const fillColor = fillPct < 60 ? '#4ade80' : fillPct < 80 ? '#fbbf24' : fillPct < 95 ? '#f97316' : '#ef4444';

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#050020 0%,#0a0035 50%,#1a0020 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Float to the Stars 🌟" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
            { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
            { label: 'SCORE', value: scoreDisplay },
          ]} />
          {/* Fill gauge */}
          {fillPct > 0 && (
            <div style={{
              position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
              width: '70vw', zIndex: 50,
            }}>
              <div style={{ fontSize: 12, color: fillColor, textAlign: 'center', marginBottom: 4, fontWeight: 700 }}>
                {fillPct < 60 ? 'Keep holding…' : fillPct < 80 ? '✨ Release now!' : fillPct < 95 ? '🔥 Getting hot!' : '💥 RELEASE NOW!'}
              </div>
              <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 8, height: 10, overflow: 'hidden' }}>
                <div style={{ background: fillColor, width: `${fillPct}%`, height: '100%', borderRadius: 8, transition: 'width 0.05s' }} />
              </div>
            </div>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Launched', value: `${finalSig.lanternsLaunched}`, color: ACCENT },
            { label: 'Reached Stars', value: `${finalSig.lanternsReached}`, color: '#4ade80' },
            { label: 'Perfect', value: `${finalSig.perfectLaunches}`, color: '#fbbf24' },
            { label: 'Overcharged', value: `${finalSig.overcharged}`, color: finalSig.overcharged === 0 ? '#4ade80' : '#ef4444' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.lanternsReached >= 6} />
      )}
    </GameShell>
  );
}
