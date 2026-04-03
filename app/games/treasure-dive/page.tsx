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

const GAME_ID = 'treasure-dive';
const ACCENT = '#0ea5e9';
const DURATION = 60;
const GAME_EMOJI = '🤿';
const GAME_TITLE = 'Treasure Dive';
const GAME_TAGLINE = 'Steer your diver. Grab treasure, dodge sharks!';

interface Signals { treasureCollected: number; sharksAvoided: number; sharkHits: number; maxCombo: number; score: number; combo: number; distanceTraveled: number; }
function getPersonality(sig: Signals): string {
  const evasion = (sig.sharksAvoided + sig.sharkHits) > 0 ? sig.sharksAvoided / (sig.sharksAvoided + sig.sharkHits) : 1;
  if (sig.treasureCollected >= 20 && evasion >= 0.8) return 'Deep Sea Legend 🏆';
  if (sig.treasureCollected >= 15) return 'Treasure Hunter 💎';
  if (evasion >= 0.9 && sig.sharkHits === 0) return 'Ghost Diver 👻';
  if (sig.maxCombo >= 5) return 'Chain Collector 🔗';
  return 'Casual Explorer 🌊';
}

const TREASURE_COLORS = { coin: 0xfbbf24, gem: 0x7c3aed, chest: 0x92400e };
const TREASURE_PTS = { coin: 1, gem: 3, chest: 5 };
type TreasureType = 'coin' | 'gem' | 'chest';

interface TreasureObj { mesh: THREE.Mesh; type: TreasureType; vx: number; vy: number; }
interface SharkObj { mesh: THREE.Mesh; vx: number; vy: number; }

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function WebhookEmitter({ theme, gameId, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; gameId: string; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, gameId, { personality, score: sig.score, treasureCollected: sig.treasureCollected, sharkHits: sig.sharkHits }, player); }, [theme, gameId, sig, personality, player]);
  return null;
}

export default function TreasureDiveGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    sig: { treasureCollected: 0, sharksAvoided: 0, sharkHits: 0, maxCombo: 0, score: 0, combo: 0, distanceTraveled: 0 } as Signals,
    diverX: 0, diverY: 0, diverVX: 0, diverVY: 0,
    tiltX: 0, tiltY: 0,
    treasures: [] as TreasureObj[],
    sharks: [] as SharkObj[],
    gameSpeed: 1.5, spawnTimer: 0, nextId: 0,
    invulnTimer: 0, frame: 0,
    diverMesh: null as THREE.Mesh | null,
    bubbles: [] as THREE.Mesh[],
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { treasureCollected: 0, sharksAvoided: 0, sharkHits: 0, maxCombo: 0, score: 0, combo: 0, distanceTraveled: 0 };
    s.diverX = 0; s.diverY = 0; s.diverVX = 0; s.diverVY = 0;
    s.tiltX = 0; s.tiltY = 0;
    s.treasures = []; s.sharks = []; s.spawnTimer = 0; s.gameSpeed = 1.5; s.invulnTimer = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('chill');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0c1a2e);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0c1a2e, 0.03);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 14);
    // === POLISH: Responsive resize handler ===
    const _onResizeHandler = () => {
      const _W = (mountRef.current?.clientWidth || window.innerWidth);
      const _H = (mountRef.current?.clientHeight || window.innerHeight);
      renderer.setSize(_W, _H);
      if (camera instanceof THREE.PerspectiveCamera) { (camera as THREE.PerspectiveCamera).aspect = _W / _H; camera.updateProjectionMatrix(); }
    };
    window.addEventListener('resize', _onResizeHandler);
    // === END POLISH ===
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x051830, 2));
    const oceanLight = new THREE.PointLight(0x0ea5e9, 4, 30);
    oceanLight.position.set(0, 5, 5);
    scene.add(oceanLight);
    const deepLight = new THREE.PointLight(0x1e3a5f, 2, 20);
    deepLight.position.set(0, -8, 0);
    scene.add(deepLight);

    // Ocean floor
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -8;
    scene.add(floor);

    // Coral decorations
    const coralColors = [0xef4444, 0xf97316, 0xfbbf24];
    for (let i = 0; i < 12; i++) {
      const cGeo = new THREE.ConeGeometry(0.2 + Math.random() * 0.3, 0.8 + Math.random() * 1.2, 6);
      const cMat = new THREE.MeshStandardMaterial({ color: coralColors[i % 3], roughness: 0.8 });
      const c = new THREE.Mesh(cGeo, cMat);
      c.position.set((Math.random() - 0.5) * 20, -7.5, -5 + Math.random() * 2);
      scene.add(c);
    }

    // Diver (sphere with fins shape)
    const diverGeo = new THREE.CapsuleGeometry(0.35, 0.6, 8, 16);
    const diverMat = new THREE.MeshStandardMaterial({ color: 0x0369a1, roughness: 0.5, emissive: 0x0ea5e9, emissiveIntensity: 0.3 });
    const diver = new THREE.Mesh(diverGeo, diverMat);
    diver.castShadow = true;
    scene.add(diver);
    s.diverMesh = diver;

    // Diver glow
    const glowGeo = new THREE.SphereGeometry(0.6, 16, 16);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.15, emissive: 0x0ea5e9, emissiveIntensity: 0.4 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    diver.add(glow);

    // Bubble particles
    const bubblePool: THREE.Mesh[] = [];
    for (let i = 0; i < 20; i++) {
      const bg = new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 8, 8);
      const bm = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.5, emissive: 0x7dd3fc, emissiveIntensity: 0.3 });
      const bub = new THREE.Mesh(bg, bm);
      bub.visible = false;
      scene.add(bub);
      bubblePool.push(bub);
    }
    s.bubbles = bubblePool;

    // Background particles (underwater ambience)
    const partCount = 200;
    const partPos = new Float32Array(partCount * 3);
    for (let i = 0; i < partCount; i++) {
      partPos[i * 3] = (Math.random() - 0.5) * 20;
      partPos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      partPos[i * 3 + 2] = (Math.random() - 0.5) * 10 - 2;
    }
    const partGeo = new THREE.BufferGeometry();
    partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
    scene.add(new THREE.Points(partGeo, new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.05, transparent: true, opacity: 0.3 })));

    const spawnTreasure = () => {
      const types: TreasureType[] = ['coin', 'coin', 'coin', 'gem', 'chest'];
      const type = types[Math.floor(Math.random() * types.length)];
      const spd = s.gameSpeed * (0.8 + Math.random() * 0.4);
      const angle = Math.random() * Math.PI * 2;
      const geo = type === 'coin' ? new THREE.CylinderGeometry(0.3, 0.3, 0.08, 16) :
        type === 'gem' ? new THREE.OctahedronGeometry(0.35) :
          new THREE.BoxGeometry(0.5, 0.4, 0.5);
      const mat = new THREE.MeshStandardMaterial({ color: TREASURE_COLORS[type], roughness: 0.3, metalness: 0.6, emissive: TREASURE_COLORS[type], emissiveIntensity: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      const startX = (Math.random() - 0.5) * 14;
      const startY = (Math.random() - 0.5) * 8;
      mesh.position.set(startX, startY, (Math.random() - 0.5) * 4);
      scene.add(mesh);
      s.treasures.push({ mesh, type, vx: Math.cos(angle) * spd * 0.02, vy: Math.sin(angle) * spd * 0.02 });
    };

    const spawnShark = () => {
      const fromRight = Math.random() > 0.5;
      const sGeo = new THREE.ConeGeometry(0.3, 1.2, 8);
      const sMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.7 });
      const smesh = new THREE.Mesh(sGeo, sMat);
      const sy = -2 + Math.random() * 4;
      smesh.position.set(fromRight ? 10 : -10, sy, 0);
      smesh.rotation.z = fromRight ? -Math.PI / 2 : Math.PI / 2;
      scene.add(smesh);
      s.sharks.push({ mesh: smesh, vx: fromRight ? -(s.gameSpeed + 1) * 0.05 : (s.gameSpeed + 1) * 0.05, vy: (Math.random() - 0.5) * 0.02 });
    };

    // Touch/pointer drag
    let lastTX = 0, lastTY = 0;
    const onDown = (e: PointerEvent) => { lastTX = e.clientX; lastTY = e.clientY; };
    const onMove = (e: PointerEvent) => {
      if (!s.running) return;
      s.tiltX = (e.clientX - lastTX) * 0.4;
      s.tiltY = -(e.clientY - lastTY) * 0.4;
      lastTX = e.clientX; lastTY = e.clientY;
    };
    const onUp = () => { s.tiltX = 0; s.tiltY = 0; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    // Device motion
    const onMotion = (e: DeviceMotionEvent) => {
      const ag = e.accelerationIncludingGravity;
      if (!ag) return;
      s.tiltX = (ag.x ?? 0) * 0.3;
      s.tiltY = -(ag.y ?? 0) * 0.3;
    };
    window.addEventListener('devicemotion', onMotion);

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      s.gameSpeed = Math.min(4, 1.5 + (DURATION - s.timeLeft) * 0.04);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    let bubbleIdx = 0;
    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Spawn
      s.spawnTimer++;
      if (s.spawnTimer % 60 === 0) spawnTreasure();
      if (s.spawnTimer % 120 === 0 && s.spawnTimer > 60) spawnShark();

      // Diver physics
      s.diverVX += s.tiltX * 0.3;
      s.diverVY += s.tiltY * 0.3;
      s.diverVX *= 0.88; s.diverVY *= 0.88;
      s.diverX = Math.max(-6, Math.min(6, s.diverX + s.diverVX * 0.05));
      s.diverY = Math.max(-5, Math.min(5, s.diverY + s.diverVY * 0.05));
      s.sig.distanceTraveled += Math.hypot(s.diverVX, s.diverVY) * 0.01;

      if (diver) {
        diver.position.set(s.diverX, s.diverY, 0);
        diver.rotation.z = -s.diverVX * 0.1;
        // Invuln flash
        if (s.invulnTimer > 0) {
          s.invulnTimer--;
          diver.visible = Math.sin(s.frame * 0.5) > 0;
        } else {
          diver.visible = true;
        }
      }

      // Bubbles from diver
      if (s.frame % 8 === 0) {
        const bub = bubblePool[bubbleIdx % bubblePool.length];
        bub.position.set(s.diverX + (Math.random() - 0.5) * 0.3, s.diverY + 0.4, 0);
        bub.visible = true;
        (bub as any)._vy = 0.02 + Math.random() * 0.02;
        (bub as any)._life = 1;
        bubbleIdx++;
      }
      bubblePool.forEach(bub => {
        if (!bub.visible) return;
        bub.position.y += (bub as any)._vy ?? 0.02;
        (bub as any)._life = ((bub as any)._life ?? 1) - 0.02;
        (bub.material as THREE.MeshStandardMaterial).opacity = Math.max(0, (bub as any)._life * 0.5);
        if ((bub as any)._life <= 0) bub.visible = false;
      });

      // Treasures
      for (let i = s.treasures.length - 1; i >= 0; i--) {
        const t = s.treasures[i];
        t.mesh.position.x += t.vx;
        t.mesh.position.y += t.vy;
        t.mesh.rotation.y += 0.03;

        if (Math.abs(t.mesh.position.x) > 10 || Math.abs(t.mesh.position.y) > 8) {
          scene.remove(t.mesh); s.treasures.splice(i, 1); continue;
        }
        const dist = t.mesh.position.distanceTo(diver.position);
        if (dist < 0.9) {
          scene.remove(t.mesh); s.treasures.splice(i, 1);
          s.sig.treasureCollected++; s.sig.combo++;
          if (s.sig.combo > s.sig.maxCombo) s.sig.maxCombo = s.sig.combo;
          const pts = TREASURE_PTS[t.type] * (s.sig.combo >= 3 ? 2 : 1);
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]);
        }
      }

      // Sharks
      if (s.invulnTimer > 0) s.invulnTimer = Math.max(0, s.invulnTimer - 1);
      for (let i = s.sharks.length - 1; i >= 0; i--) {
        const sh = s.sharks[i];
        sh.mesh.position.x += sh.vx;
        sh.mesh.position.y += sh.vy;
        if (Math.abs(sh.mesh.position.x) > 12) {
          scene.remove(sh.mesh); s.sharks.splice(i, 1);
          s.sig.sharksAvoided++;
          continue;
        }
        const dist = sh.mesh.position.distanceTo(diver.position);
        if (dist < 0.9 && s.invulnTimer === 0) {
          s.sig.sharkHits++; s.sig.combo = 0; s.invulnTimer = 120;
          sfx.fail(); haptic([20, 30, 20]);
        }
      }

      // Ocean light pulse
      oceanLight.intensity = 4 + Math.sin(s.frame * 0.02) * 0.5;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const buildInsights = (sig: Signals) => {
    const evasion = (sig.sharksAvoided + sig.sharkHits) > 0 ? Math.round((sig.sharksAvoided / (sig.sharksAvoided + sig.sharkHits)) * 100) : 100;
    return [
      { label: 'Treasure Found', value: `${sig.treasureCollected}`, color: sig.treasureCollected >= 10 ? '#4ade80' : '#facc15' },
      { label: 'Shark Evasion', value: `${evasion}%`, color: evasion >= 80 ? '#4ade80' : '#ef4444' },
      { label: 'Best Combo', value: `×${sig.maxCombo}`, color: ACCENT },
      { label: 'Shark Hits', value: `${sig.sharkHits}`, color: 'var(--color-text)' },
    ];
  };

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Dive In" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.treasureCollected >= 10} />
        <WebhookEmitter theme={theme} gameId={GAME_ID} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
