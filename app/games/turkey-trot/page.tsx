'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { CATEGORY_THEMES } from '@/lib/theme';

const CATEGORY_ACCENT = CATEGORY_THEMES.holiday.primaryAccent;
const GAME_ID = 'turkey-trot';
const PB_KEY = 'pb_turkey-trot';
const ACCENT = '#f97316';
const DURATION = 30;
const GAME_EMOJI = '🦃';
const GAME_TITLE = 'Turkey Trot';
const GAME_TAGLINE = "The turkey's running. Prove it wrong.";
const SPEED_BASE = 3.5, SPEED_MAX = 7, SPEED_INC = 0.3;
const HIT_RADIUS = 1.2;
const DAZE_MS = 300, GOLDEN_EVERY = 5, GOLDEN_DURATION = 1500, GOLDEN_POINTS = 5;

interface Signals { score: number; goldenTurkeyHits: number; maxStreak: number; streakCurrent: number; totalAttempts: number; hits: number; reactionTimes: number[]; hitCount: number; longestChase: number; chaseStart: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalAttempts > 0 ? (sig.hits / sig.totalAttempts) * 100 : 0;
  if (sig.score >= 18 && acc >= 75) return 'Turkey Whisperer 🦃';
  if (sig.goldenTurkeyHits >= 2) return 'The Hunter 🍂';
  if (acc < 350 && sig.score >= 12) return 'Quick Hands ⚡';
  return 'Thankful Anyway 🙏';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

export default function TurkeyTrotGame() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const dirChangeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goldenTimRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    sig: { score: 0, goldenTurkeyHits: 0, maxStreak: 0, streakCurrent: 0, totalAttempts: 0, hits: 0, reactionTimes: [], hitCount: 0, longestChase: 0, chaseStart: 0 } as Signals,
    tx: 0, ty: 0, tvx: 0, tvy: 0, tSpeed: SPEED_BASE,
    dazed: false, dazedUntil: 0, lastDirChangeTime: 0,
    golden: { active: false, x: 0, y: 0, vx: 0, vy: 0, expiresAt: 0 },
    turkeyCooldown: false,
    frame: 0,
    turkeyMesh: null as THREE.Mesh | null,
    goldenMesh: null as THREE.Mesh | null,
    featherParticles: [] as { mesh: THREE.Mesh; vx: number; vy: number; life: number }[],
    floatingScores: [] as { mesh: THREE.Mesh; vy: number; life: number }[],
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [speedDisplay, setSpeedDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (dirChangeRef.current) { clearTimeout(dirChangeRef.current); dirChangeRef.current = null; }
    if (goldenTimRef.current) { clearTimeout(goldenTimRef.current); goldenTimRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > pb) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  const spawnGolden = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    const angle = Math.random() * Math.PI * 2;
    s.golden = { active: true, x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 7, vx: Math.cos(angle), vy: Math.sin(angle), expiresAt: Date.now() + GOLDEN_DURATION };
    if (s.goldenMesh) s.goldenMesh.visible = true;
    sfx.shimmer();
    goldenTimRef.current = setTimeout(() => { if (stateRef.current.running) stateRef.current.golden.active = false; if (stateRef.current.goldenMesh) stateRef.current.goldenMesh.visible = false; }, GOLDEN_DURATION);
  }, []);

  const scheduleDir = useCallback(() => {
    dirChangeRef.current = setTimeout(() => {
      const s = stateRef.current; if (!s.running) return;
      const angle = Math.random() * Math.PI * 2;
      s.tvx = Math.cos(angle); s.tvy = Math.sin(angle);
      s.lastDirChangeTime = Date.now();
      scheduleDir();
    }, 500 + Math.random() * 300);
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    const now0 = Date.now();
    const a0 = Math.random() * Math.PI * 2;
    s.sig = { score: 0, goldenTurkeyHits: 0, maxStreak: 0, streakCurrent: 0, totalAttempts: 0, hits: 0, reactionTimes: [], hitCount: 0, longestChase: 0, chaseStart: now0 };
    s.tx = 0; s.ty = 0; s.tvx = Math.cos(a0); s.tvy = Math.sin(a0); s.tSpeed = SPEED_BASE;
    s.dazed = false; s.golden = { active: false, x: 0, y: 0, vx: 0, vy: 0, expiresAt: 0 };
    s.featherParticles = []; s.floatingScores = [];
    s.lastDirChangeTime = now0;
    setScoreDisplay(0); setSpeedDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('drive');
    scheduleDir();

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0e00);
    renderer.shadowMap.enabled = true;
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a0e00, 20, 50);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 8, 14);
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

    scene.add(new THREE.AmbientLight(0x221100, 2));
    const sunLight = new THREE.PointLight(0xf97316, 4, 30);
    sunLight.position.set(0, 10, 5);
    sunLight.castShadow = true;
    scene.add(sunLight);
    const ambGlow = new THREE.PointLight(0xfbbf24, 2, 20);
    ambGlow.position.set(-5, 3, 3);
    scene.add(ambGlow);

    // Autumn ground
    const groundGeo = new THREE.PlaneGeometry(24, 18);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a2e0a, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);

    // Fallen leaves (static decorations)
    const leafColors = [0xf97316, 0xea580c, 0xfbbf24, 0x92400e];
    for (let i = 0; i < 20; i++) {
      const lGeo = new THREE.PlaneGeometry(0.4, 0.5);
      const lMat = new THREE.MeshStandardMaterial({ color: leafColors[i % 4], roughness: 0.9 });
      const leaf = new THREE.Mesh(lGeo, lMat);
      leaf.rotation.x = -Math.PI / 2;
      leaf.rotation.z = Math.random() * Math.PI;
      leaf.position.set((Math.random() - 0.5) * 20, -0.49, (Math.random() - 0.5) * 15);
      scene.add(leaf);
    }

    // Turkey mesh
    const turkeyGroup = new THREE.Group();
    // Body
    const bodyGeo = new THREE.SphereGeometry(0.55, 12, 10);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.7 });
    const turkeyBody = new THREE.Mesh(bodyGeo, bodyMat);
    turkeyGroup.add(turkeyBody);
    // Head
    const hGeo = new THREE.SphereGeometry(0.25, 10, 10);
    const hMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 });
    const hMesh = new THREE.Mesh(hGeo, hMat);
    hMesh.position.set(0.4, 0.4, 0);
    turkeyGroup.add(hMesh);
    // Tail fan (crest)
    for (let i = 0; i < 5; i++) {
      const tGeo = new THREE.ConeGeometry(0.12, 0.7, 6);
      const tMat = new THREE.MeshStandardMaterial({ color: leafColors[i % 4], roughness: 0.5 });
      const tail = new THREE.Mesh(tGeo, tMat);
      const angle = -0.8 + i * 0.4;
      tail.position.set(-0.4 + Math.sin(angle) * 0.2, Math.cos(angle) * 0.4, -0.1);
      tail.rotation.z = angle;
      turkeyGroup.add(tail);
    }
    // Wattle
    const wGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const wMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.8 });
    const wattle = new THREE.Mesh(wGeo, wMat);
    wattle.position.set(0.6, 0.2, 0);
    turkeyGroup.add(wattle);
    turkeyGroup.castShadow = true;
    scene.add(turkeyGroup);
    s.turkeyMesh = turkeyBody; // ref to animate

    // Hit radius indicator (ring on ground)
    const hitRingGeo = new THREE.TorusGeometry(HIT_RADIUS, 0.05, 8, 32);
    const hitRingMat = new THREE.MeshStandardMaterial({ color: 0xf97316, transparent: true, opacity: 0.3, emissive: 0xf97316, emissiveIntensity: 0.3 });
    const hitRing = new THREE.Mesh(hitRingGeo, hitRingMat);
    hitRing.rotation.x = -Math.PI / 2;
    hitRing.position.y = -0.45;
    scene.add(hitRing);

    // Golden turkey
    const goldenGroup = new THREE.Group();
    const gBodyGeo = new THREE.SphereGeometry(0.55, 12, 10);
    const gBodyMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.3, metalness: 0.5, emissive: 0xfbbf24, emissiveIntensity: 0.6 });
    const gBody = new THREE.Mesh(gBodyGeo, gBodyMat);
    goldenGroup.add(gBody);
    goldenGroup.visible = false;
    scene.add(goldenGroup);
    s.goldenMesh = gBody;

    // Tap indicator (ground cursor)
    const tapGeo = new THREE.CircleGeometry(0.25, 16);
    const tapMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5 });
    const tapCircle = new THREE.Mesh(tapGeo, tapMat);
    tapCircle.rotation.x = -Math.PI / 2;
    tapCircle.position.y = -0.44;
    tapCircle.visible = false;
    scene.add(tapCircle);

    // Feather burst geo cache
    const featherGeo = new THREE.SphereGeometry(0.1, 6, 6);

    // Floating score sprites
    let tapPos3D = new THREE.Vector3();

    const HALF_W = 7, HALF_H = 5;

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5);
    const tapPoint = new THREE.Vector3();

    const handleTap = (clientX: number, clientY: number) => {
      const s = stateRef.current; if (!s.running) return;
      s.sig.totalAttempts++;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      raycaster.ray.intersectPlane(groundPlane, tapPoint);
      const tx = tapPoint.x, ty = tapPoint.z;

      // Show tap circle
      tapCircle.position.set(tx, -0.44, ty);
      tapCircle.visible = true;
      setTimeout(() => { tapCircle.visible = false; }, 200);

      // Check golden
      const g = s.golden;
      if (g.active) {
        const d = Math.hypot(tx - g.x, ty - g.y);
        if (d <= HIT_RADIUS * 1.2) {
          s.golden.active = false; goldenGroup.visible = false;
          if (goldenTimRef.current) clearTimeout(goldenTimRef.current);
          s.sig.goldenTurkeyHits++; s.sig.score += GOLDEN_POINTS; s.sig.hits++; s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          setScoreDisplay(s.sig.score); sfx.success(); haptic([30, 20, 50]);
          spawnFeathers(g.x, g.y, true);
          return;
        }
      }

      // Check turkey
      const dist = Math.hypot(tx - s.tx, ty - s.ty);
      if (dist <= HIT_RADIUS && !s.dazed) {
        const rx = Date.now() - s.lastDirChangeTime;
        s.sig.hits++; s.sig.hitCount++; s.sig.reactionTimes.push(rx);
        s.sig.streakCurrent++; if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        s.sig.score++; s.tSpeed = Math.min(SPEED_MAX, s.tSpeed + SPEED_INC);
        s.dazed = true; s.dazedUntil = Date.now() + DAZE_MS;
        setScoreDisplay(s.sig.score);
        setSpeedDisplay(Math.round(Math.max(0, (s.tSpeed - SPEED_BASE) / (SPEED_MAX - SPEED_BASE)) * 100));
        sfx.collect(); haptic([20]);
        spawnFeathers(s.tx, s.ty, false);
        if (s.sig.hitCount % GOLDEN_EVERY === 0) setTimeout(() => { if (stateRef.current.running) spawnGolden(); }, 450);
      } else {
        s.sig.streakCurrent = 0;
        s.sig.chaseStart = Date.now();
      }
    };
    renderer.domElement.addEventListener('pointerdown', (e: PointerEvent) => handleTap(e.clientX, e.clientY));

    const spawnFeathers = (fx: number, fy: number, isGolden: boolean) => {
      for (let i = 0; i < 6; i++) {
        const fMat = new THREE.MeshStandardMaterial({ color: isGolden ? 0xfbbf24 : leafColors[Math.floor(Math.random() * leafColors.length)], emissive: isGolden ? 0xfbbf24 : 0x000000, emissiveIntensity: isGolden ? 0.5 : 0 });
        const fMesh = new THREE.Mesh(featherGeo, fMat);
        fMesh.position.set(fx, 0.5, fy);
        scene.add(fMesh);
        const angle = (i / 6) * Math.PI * 2;
        s.featherParticles.push({ mesh: fMesh, vx: Math.cos(angle) * 0.1, vy: 0.05 + Math.random() * 0.05, life: 1 });
      }
    };

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 5) sfx.tick();
      if (s.timeLeft <= 0) { sfx.success(); haptic([30, 50, 30, 50, 100]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const dt = 1 / 60;

      // Move turkey
      if (s.dazed && Date.now() >= s.dazedUntil) s.dazed = false;
      if (!s.dazed) {
        s.tx += s.tvx * s.tSpeed * dt;
        s.ty += s.tvy * s.tSpeed * dt;
        if (Math.abs(s.tx) > HALF_W) { s.tvx *= -1; s.tx = Math.sign(s.tx) * HALF_W; }
        if (Math.abs(s.ty) > HALF_H) { s.tvy *= -1; s.ty = Math.sign(s.ty) * HALF_H; }
      }
      turkeyGroup.position.set(s.tx, 0.1 + Math.sin(s.frame * 0.25) * 0.1, s.ty);
      turkeyGroup.rotation.y = Math.atan2(s.tvx, s.tvy);
      turkeyGroup.rotation.x = s.dazed ? 0.5 : 0;
      hitRing.position.set(s.tx, -0.45, s.ty);

      // Golden turkey
      if (s.golden.active) {
        s.golden.x += s.golden.vx * s.tSpeed * 1.4 * dt;
        s.golden.y += s.golden.vy * s.tSpeed * 1.4 * dt;
        if (Math.abs(s.golden.x) > HALF_W) { s.golden.vx *= -1; s.golden.x = Math.sign(s.golden.x) * HALF_W; }
        if (Math.abs(s.golden.y) > HALF_H) { s.golden.vy *= -1; s.golden.y = Math.sign(s.golden.y) * HALF_H; }
        goldenGroup.position.set(s.golden.x, 0.15 + Math.sin(s.frame * 0.3) * 0.12, s.golden.y);
        goldenGroup.visible = true;
        goldenGroup.rotation.y = s.frame * 0.05;
      } else {
        goldenGroup.visible = false;
      }

      // Feather particles
      for (let i = s.featherParticles.length - 1; i >= 0; i--) {
        const p = s.featherParticles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy;
        p.mesh.position.z += 0; p.vy -= 0.003;
        p.life -= 0.04;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = p.life;
        (p.mesh.material as THREE.MeshStandardMaterial).transparent = true;
        if (p.life <= 0) { scene.remove(p.mesh); s.featherParticles.splice(i, 1); }
      }

      sunLight.intensity = 4 + Math.sin(s.frame * 0.05) * 0.5;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, scheduleDir, spawnGolden]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (dirChangeRef.current) clearTimeout(dirChangeRef.current);
    if (goldenTimRef.current) clearTimeout(goldenTimRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    await initAudio(); sfx.click();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setSpeedDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
  }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.totalAttempts > 0 ? Math.round((sig.hits / sig.totalAttempts) * 100) : 0;
    const avgRx = sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a, b) => a + b, 0) / sig.reactionTimes.length) : 0;
    return [
      { label: 'Turkeys Caught', value: String(sig.score), color: ACCENT },
      { label: 'Accuracy', value: `${acc}%`, color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Avg Reaction', value: `${avgRx}ms`, color: ACCENT },
      { label: 'Golden Turkeys', value: String(sig.goldenTurkeyHits), color: '#fbbf24' },
    ];
  };

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent} background="radial-gradient(ellipse at 50% 100%, rgba(80,160,40,0.15) 0%, transparent 40%), linear-gradient(180deg,#1a0e04 0%,#3e2408 50%,#1a0e04 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Hunt the Turkey 🦃" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10, testId: 'timer' }, { label: 'CAUGHT 🦃', value: scoreDisplay, testId: 'score' }, { label: 'SPEED', value: `${speedDisplay}%` }]} />}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 10} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}
