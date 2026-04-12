'use client';
/**
 * MARATHON PACE — 3D running track. Tilt/drag to control pace in the green zone.
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

const GAME_ID = 'marathon-pace';
const ACCENT = '#22c55e';
const DURATION = 60;
const GAME_EMOJI = '🏃';
const GAME_TITLE = 'Marathon Pace';
const GAME_TAGLINE = 'Tilt to control your pace — stay in the green zone.';

const ZONE_LOW = 0.35;
const ZONE_HIGH = 0.65;

interface Signals { timeInZone: number; crampEvents: number; lastPlaceEvents: number; maxConsecutiveInZone: number; score: number; }

function getPersonality(sig: Signals): string {
  const ratio = sig.timeInZone / DURATION;
  if (ratio >= 0.8 && sig.crampEvents === 0) return 'Kenyan Pace 🇰🇪';
  if (ratio >= 0.65 && sig.crampEvents <= 1) return 'Steady Runner 🏃';
  if (sig.crampEvents >= 5) return 'Cramp Machine 😬';
  if (sig.lastPlaceEvents >= 5) return 'Couch to 5K 🛋️';
  return 'Finding the Rhythm 🎵';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function MarathonPaceGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { timeInZone: 0, crampEvents: 0, lastPlaceEvents: 0, maxConsecutiveInZone: 0, score: 0 } as Signals,
    pace: 0.5, tiltX: 0,
    inZone: false, consecutiveInZone: 0,
    runnerGroup: null as THREE.Group | null,
    trackOffset: 0,
    legAngle: 0,
    otherRunners: [] as THREE.Group[],
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
    orientation: { gamma: 0 },
    paceLight: null as THREE.PointLight | null,
    particles: [] as { mesh: THREE.Mesh; life: number }[],
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [paceDisplay, setPaceDisplay] = useState(0.5);
  const [inZoneDisplay, setInZoneDisplay] = useState(false);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  function createRunner(color: number): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    // Head
    group.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), mat), { position: { x: 0, y: 1.2, z: 0 } } as any));
    // Body
    group.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), mat), { position: { x: 0, y: 0.75, z: 0 } } as any));
    // Legs (2)
    for (let side = -1; side <= 1; side += 2) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), mat);
      leg.position.set(side * 0.1, 0.35, 0);
      group.add(leg);
    }
    return group;
  }

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { timeInZone: 0, crampEvents: 0, lastPlaceEvents: 0, maxConsecutiveInZone: 0, score: 0 };
    s.pace = 0.5; s.tiltX = 0; s.inZone = false; s.consecutiveInZone = 0;
    s.trackOffset = 0; s.legAngle = 0; s.particles = [];
    setScoreDisplay(0); setTimeLeft(DURATION); setPaceDisplay(0.5); setInZoneDisplay(false); setPhase('playing');
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a1628);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a1628, 20, 60);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 3, 8);
    camera.lookAt(0, 0, -5);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x112233, 5));
    const sunLight = new THREE.DirectionalLight(0x88bbff, 2);
    sunLight.position.set(5, 10, 5);
    scene.add(sunLight);
    const paceLight = new THREE.PointLight(0x22c55e, 2, 10);
    paceLight.position.set(0, 3, 0);
    scene.add(paceLight);
    s.paceLight = paceLight;

    // Track (tiled plane segments)
    const trackGroup = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const segGeo = new THREE.PlaneGeometry(6, 10);
      const segMat = new THREE.MeshPhongMaterial({ color: i % 2 === 0 ? 0x8b4513 : 0x7a3c0a });
      const seg = new THREE.Mesh(segGeo, segMat);
      seg.rotation.x = -Math.PI / 2;
      seg.position.z = -i * 10;
      trackGroup.add(seg);
      // Lane lines
      for (let l = -2; l <= 2; l++) {
        const lineGeo = new THREE.PlaneGeometry(0.05, 10);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(l * 1.2, 0.01, -i * 10);
        trackGroup.add(line);
      }
    }
    scene.add(trackGroup);

    // Sky / stadium atmosphere
    const skyGeo = new THREE.BoxGeometry(60, 30, 60);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x0a1628, side: THREE.BackSide });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Player runner
    const runner = createRunner(0x22c55e);
    runner.position.set(0, 0, 0);
    scene.add(runner);
    s.runnerGroup = runner;

    // AI runners (crowd)
    const aiColors = [0xef4444, 0xfbbf24, 0xa78bfa, 0x38bdf8];
    for (let i = 0; i < 4; i++) {
      const ai = createRunner(aiColors[i]);
      ai.position.set((i - 1.5) * 1.4, 0, -2 - i * 0.5);
      scene.add(ai);
      s.otherRunners.push(ai);
    }

    // Pace zone indicators (floating rings)
    const zoneGeo = new THREE.TorusGeometry(2.5, 0.05, 8, 32);
    const greenZoneMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.3 });
    const zoneRing = new THREE.Mesh(zoneGeo, greenZoneMat);
    zoneRing.rotation.x = Math.PI / 2;
    zoneRing.position.y = 0.1;
    scene.add(zoneRing);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      const inZone2 = s.pace >= ZONE_LOW && s.pace <= ZONE_HIGH;
      if (inZone2) {
        s.sig.timeInZone++;
        s.consecutiveInZone++;
        if (s.consecutiveInZone > s.sig.maxConsecutiveInZone) s.sig.maxConsecutiveInZone = s.consecutiveInZone;
        s.sig.score += 2;
        setScoreDisplay(s.sig.score);
      } else {
        s.consecutiveInZone = 0;
        if (s.pace > ZONE_HIGH) { s.sig.crampEvents++; sfx.collision(); haptic([50]); }
        else if (s.pace < ZONE_LOW) { s.sig.lastPlaceEvents++; sfx.nearMiss(); }
      }
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const onOrient = (e: DeviceOrientationEvent) => { s.orientation.gamma = e.gamma ?? 0; };
    window.addEventListener('deviceorientation', onOrient);

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

      // Update pace from tilt + drag
      const tiltInfluence = (s.orientation.gamma ?? 0) * 0.01 + s.tiltX * 0.5;
      s.pace = Math.max(0, Math.min(1, s.pace + tiltInfluence * 0.016));
      setPaceDisplay(s.pace);

      const inZone = s.pace >= ZONE_LOW && s.pace <= ZONE_HIGH;
      setInZoneDisplay(inZone);
      s.inZone = inZone;

      // Scroll track
      s.trackOffset += s.pace * 0.15;
      if (s.trackOffset > 10) s.trackOffset -= 10;
      trackGroup.position.z = s.trackOffset;

      // Animate player
      if (s.runnerGroup) {
        s.legAngle = Math.sin(t * 8 * s.pace * 3) * 0.5;
        if (s.runnerGroup.children.length >= 3) {
          s.runnerGroup.children[2].rotation.x = s.legAngle;
          if (s.runnerGroup.children[3]) s.runnerGroup.children[3].rotation.x = -s.legAngle;
        }
        s.runnerGroup.position.y = Math.abs(Math.sin(t * 8 * s.pace * 3)) * 0.05;
      }

      // Animate AI runners
      s.otherRunners.forEach((ai, i) => {
        ai.position.z -= (0.4 + i * 0.05) * s.pace * 0.5;
        if (ai.position.z < -40) ai.position.z = 5;
        if (ai.children.length >= 3) {
          ai.children[2].rotation.x = Math.sin(t * 6 + i) * 0.4;
          if (ai.children[3]) ai.children[3].rotation.x = -Math.sin(t * 6 + i) * 0.4;
        }
      });

      // Pace light color
      if (s.paceLight) {
        const paceColor = inZone ? 0x22c55e : s.pace > ZONE_HIGH ? 0xef4444 : 0xfbbf24;
        s.paceLight.color.setHex(paceColor);
        s.paceLight.intensity = 2 + Math.sin(t * 4) * 0.5;
      }

      // Zone ring opacity
      (zoneRing.material as THREE.MeshBasicMaterial).opacity = inZone ? 0.5 : 0.15;

      // Foot dust particles when running fast
      if (s.pace > 0.6 && Math.random() < 0.3) {
        const pGeo = new THREE.SphereGeometry(0.05, 4, 4);
        const pMat = new THREE.MeshBasicMaterial({ color: 0xd97706, transparent: true, opacity: 0.6 });
        const pm = new THREE.Mesh(pGeo, pMat);
        pm.position.set((Math.random() - 0.5) * 0.4, 0.1, 0.5);
        scene.add(pm);
        s.particles.push({ mesh: pm, life: 1 });
      }

      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.z += 0.05; p.life -= 0.05;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life * 0.6;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('deviceorientation', onOrient);
      renderer.dispose();
    };
  }, [endGame]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    let lastY = 0;
    const onPD = (e: PointerEvent) => { lastY = e.clientY; };
    const onPM = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running) return;
      const dy = lastY - e.clientY;
      s.tiltX = dy * 0.005;
      lastY = e.clientY;
    };
    const onPU = () => { stateRef.current.tiltX = 0; };
    el.addEventListener('pointerdown', onPD);
    el.addEventListener('pointermove', onPM);
    el.addEventListener('pointerup', onPU);
    return () => { el.removeEventListener('pointerdown', onPD); el.removeEventListener('pointermove', onPM); el.removeEventListener('pointerup', onPU); };
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (n: string, a: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, n, a);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const paceColor = paceDisplay >= ZONE_LOW && paceDisplay <= ZONE_HIGH ? '#22c55e' : paceDisplay > ZONE_HIGH ? '#ef4444' : '#fbbf24';
  const paceLabel = paceDisplay >= ZONE_LOW && paceDisplay <= ZONE_HIGH ? '✅ Perfect Pace!' : paceDisplay > ZONE_HIGH ? '🔥 Too Fast! (Cramp)' : '⬇️ Too Slow!';

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#0a1628 0%,#0d1f35 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Running 🏃" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} sensorNote="Drag up/down or tilt to change pace" />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
          {/* Pace gauge */}
          <div style={{ position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', width: '70vw', zIndex: 50 }}>
            <div style={{ color: paceColor, fontSize: 13, fontWeight: 700, textAlign: 'center', marginBottom: 6 }}>{paceLabel}</div>
            <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 8, height: 12, position: 'relative', overflow: 'visible' }}>
              {/* Green zone */}
              <div style={{ position: 'absolute', left: `${ZONE_LOW * 100}%`, width: `${(ZONE_HIGH - ZONE_LOW) * 100}%`, height: '100%', background: 'rgba(34,197,94,0.3)', borderRadius: 4 }} />
              {/* Marker */}
              <div style={{ position: 'absolute', left: `${paceDisplay * 100}%`, transform: 'translateX(-50%) translateY(-20%)', width: 10, height: 15, background: paceColor, borderRadius: 3, transition: 'left 0.05s' }} />
            </div>
          </div>
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'In Zone', value: `${finalSig.timeInZone}s`, color: '#22c55e' },
            { label: 'Cramps', value: `${finalSig.crampEvents}`, color: '#ef4444' },
            { label: 'Max Streak', value: `${finalSig.maxConsecutiveInZone}s`, color: '#fbbf24' },
            { label: 'Score', value: `${finalSig.score}`, color: ACCENT },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.timeInZone >= 30} />
      )}
      {phase === 'done' && finalSig && <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, timeInZone: sig.timeInZone }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const MarathonPaceGame = dynamic(() => Promise.resolve({ default: MarathonPaceGameInner }), { ssr: false });
export default MarathonPaceGame;
