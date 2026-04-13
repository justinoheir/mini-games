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

const GAME_ID      = 'pinata-smash';
const ACCENT       = '#f97316';
const DURATION     = 30;
const GAME_EMOJI   = '🎊';
const GAME_TITLE   = 'Piñata Smash';
const GAME_TAGLINE = 'Swipe fast and hard — burst the piñata for candy!';
const PB_KEY       = 'mg_pb_pinata-smash';
const CANDY_COLORS = [0xf43f5e, 0xf97316, 0xfacc15, 0x4ade80, 0x22d3ee, 0xa855f7, 0xec4899, 0x3b82f6];
const PINATA_COLS  = [0xec4899, 0xf97316, 0xfacc15, 0x22d3ee, 0xa855f7, 0x4ade80];

interface Signals { score: number; totalHits: number; bursts: number; maxSwipeSpeed: number; totalSwipes: number; }
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  if (sig.bursts >= 4 && sig.maxSwipeSpeed >= 700) return 'Fiesta Destroyer 🎉';
  if (sig.bursts >= 3) return 'Candy Chaser 🍬';
  if (sig.maxSwipeSpeed >= 700) return 'Speed Smasher ⚡';
  if (sig.totalHits >= 20) return 'Steady Striker 🔨';
  return 'Gentle Swinger 🌸';
}

interface CandyParticle { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; }

function PinataSmashGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const piñataRef = useRef<THREE.Group | null>(null);
  const candiesRef = useRef<CandyParticle[]>([]);
  const accentLightRef = useRef<THREE.PointLight | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, streak: 0, timeLeft: DURATION,
    sig: { score: 0, totalHits: 0, bursts: 0, maxSwipeSpeed: 0, totalSwipes: 0 } as Signals,
    damage: 0, colorIdx: 0, swayPhase: 0,
    pDown: false, lastPX: 0, lastPY: 0, lastPTime: 0, lastHitTime: 0,
    shakeAmt: 0,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    sfx.gameOver(); haptic([100]);
    try { const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0'); if (s.sig.score > pb) localStorage.setItem(PB_KEY, String(s.sig.score)); } catch { /**/ }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const buildPiñata = useCallback((scene: THREE.Scene, colorIdx: number) => {
    if (piñataRef.current) scene.remove(piñataRef.current);
    const group = new THREE.Group();
    const col = PINATA_COLS[colorIdx % PINATA_COLS.length];
    // Body: star-like icosahedron
    const bodyGeo = new THREE.IcosahedronGeometry(1.4, 1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col).multiplyScalar(0.2), roughness: 0.4, metalness: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);
    // Rope
    const ropeGeo = new THREE.CylinderGeometry(0.04, 0.04, 2, 6);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xa16207 });
    const rope = new THREE.Mesh(ropeGeo, ropeMat);
    rope.position.y = 2.4;
    group.add(rope);
    // Fringes
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const fGeo = new THREE.CylinderGeometry(0.03, 0.01, 0.8, 4);
      const fMat = new THREE.MeshStandardMaterial({ color: CANDY_COLORS[i % CANDY_COLORS.length] });
      const fringe = new THREE.Mesh(fGeo, fMat);
      fringe.position.set(Math.cos(a) * 1.3, -1.1, Math.sin(a) * 1.3);
      group.add(fringe);
    }
    group.position.set(0, 0.5, 0);
    scene.add(group);
    piñataRef.current = group;
  }, []);

  const doBurst = useCallback((scene: THREE.Scene) => {
    const s = stateRef.current;
    const count = 30 + s.sig.bursts * 8;
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
      const col = CANDY_COLORS[Math.floor(Math.random() * CANDY_COLORS.length)];
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col).multiplyScalar(0.3) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2);
      scene.add(mesh);
      candiesRef.current.push({ mesh, vx: (Math.random()-0.5)*0.15, vy: 0.1+Math.random()*0.12, vz: (Math.random()-0.5)*0.12, life: 1 });
    }
    s.sig.bursts++; s.sig.score += 5 + s.sig.bursts * 2;
    setScoreDisplay(s.sig.score);
    s.colorIdx = (s.colorIdx + 1) % PINATA_COLS.length;
    s.damage = 0;
    sfx.collect(); haptic([30,20,30,20,60]);
    buildPiñata(scene, s.colorIdx);
  }, [buildPiñata]);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, totalHits: 0, bursts: 0, maxSwipeSpeed: 0, totalSwipes: 0 };
    s.damage = 0; s.colorIdx = 0; s.swayPhase = 0; s.shakeAmt = 0;
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('holiday');

    const W = window.innerWidth, H = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a0030);
    scene.fog = new THREE.Fog(0x1a0030, 15, 30);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 60);
    camera.position.set(0, 0, 8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x220022, 3));
    const pl = new THREE.PointLight(0xf97316, 60, 20);
    pl.position.set(3, 3, 6);
    scene.add(pl);
    const aLight = new THREE.PointLight(0xfacc15, 80, 15);
    aLight.position.set(0, 2, 5);
    scene.add(aLight);
    accentLightRef.current = aLight;

    // Confetti streamers
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(300);
    for (let i = 0; i < 300; i += 3) { sp[i] = (Math.random()-0.5)*20; sp[i+1] = (Math.random()-0.5)*20; sp[i+2] = (Math.random()-0.5)*10-5; }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfacc15, size: 0.08 })));

    buildPiñata(scene, 0);

    const onDown = (e: PointerEvent) => {
      s.pDown = true; s.lastPX = e.clientX; s.lastPY = e.clientY; s.lastPTime = Date.now();
    };
    const onMove = (e: PointerEvent) => {
      if (!s.running || !s.pDown) return;
      const now = Date.now(), dt = Math.max(8, now - s.lastPTime);
      const dx = e.clientX - s.lastPX, dy = e.clientY - s.lastPY;
      const speed = Math.sqrt(dx*dx+dy*dy) / dt * 1000;
      if (speed > s.sig.maxSwipeSpeed) s.sig.maxSwipeSpeed = Math.round(speed);
      if (speed > 240 && (now - s.lastHitTime) > 110) {
        s.lastHitTime = now; s.sig.totalHits++;
        const dmg = Math.min(28, 7 + speed / 85);
        s.damage = Math.min(100, s.damage + dmg);
        s.shakeAmt = 0.3;
        sfx.collect(); haptic([30]);
        // Update piñata scale to show damage
        if (piñataRef.current) piñataRef.current.scale.setScalar(1 - s.damage * 0.003);
        if (s.damage >= 100) doBurst(scene);
      }
      s.lastPX = e.clientX; s.lastPY = e.clientY; s.lastPTime = now;
    };
    const onUp = () => { if (s.pDown) { s.pDown = false; s.sig.totalSwipes++; } };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    let t = 0;
    const loop = () => {
      if (!s.running) return;
      animRef.current = requestAnimationFrame(loop);
      t += 0.018;
      s.swayPhase = t;

      if (piñataRef.current) {
        s.shakeAmt *= 0.85;
        piñataRef.current.rotation.z = Math.sin(t * 1.2) * 0.18 + (s.shakeAmt * (Math.random()-0.5));
        piñataRef.current.position.x = Math.sin(t * 0.8) * 0.3;
        piñataRef.current.rotation.y += 0.01;
        // Damage color shift
        const pinBody = piñataRef.current.children[0] as THREE.Mesh;
        if (pinBody?.material) {
          (pinBody.material as THREE.MeshStandardMaterial).emissiveIntensity = s.damage * 0.02;
        }
      }

      // Candy physics
      candiesRef.current = candiesRef.current.filter(c => c.life > 0.05);
      for (const c of candiesRef.current) {
        c.mesh.position.x += c.vx; c.mesh.position.y += c.vy; c.mesh.position.z += c.vz;
        c.vy -= 0.006; c.life -= 0.008;
        c.mesh.rotation.x += 0.08; c.mesh.rotation.z += 0.06;
        (c.mesh.material as THREE.MeshStandardMaterial).opacity = c.life;
        (c.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        if (c.life <= 0.05) sceneRef.current?.remove(c.mesh);
      }

      if (accentLightRef.current) accentLightRef.current.intensity = 40 + Math.sin(t * 3) * 20;
      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onUp);
    };
  }, [endGame, buildPiñata, doBurst]);

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
    candiesRef.current = [];
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null);
    setPhase('countdown');
  }, []);

  const accent = theme.id !== 'ether' ? theme.colors.accent : ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent ?? ACCENT} gameId={GAME_ID}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Smash It!" accentColor={accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} role="application" aria-label="Game area - tap to play" style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={accent ?? ACCENT} items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 5, testId: 'timer' },
                { label: 'SCORE', value: scoreDisplay, testId: 'score' },
              ]} />
              <div style={{ position: 'absolute', bottom: '10%', left: '50%', transform: 'translateX(-50%)',
                color: 'rgba(255,255,255,0.5)', fontSize: 13, pointerEvents: 'none', textAlign: 'center' }}>
                ← SWIPE TO SMASH →
              </div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'Piñatas Burst', value: String(finalSig.bursts), color: finalSig.bursts >= 3 ? '#4ade80' : finalSig.bursts >= 1 ? '#facc15' : '#ef4444' },
              { label: 'Total Hits', value: String(finalSig.totalHits), color: accent ?? ACCENT },
              { label: 'Max Swipe Speed', value: `${Math.round(finalSig.maxSwipeSpeed)}px/s`, color: accent ?? ACCENT },
              { label: 'Personal Best', value: String(parseInt(localStorage.getItem(PB_KEY) ?? '0')), color: 'var(--color-text)' },
            ]}
            accentColor={accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.bursts >= 2} />
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const PinataSmashGame = dynamic(() => Promise.resolve({ default: PinataSmashGameInner }), { ssr: false });
export default PinataSmashGame;
