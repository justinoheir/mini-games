'use client';
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

const GAME_ID = 'visual-search';
const ACCENT = '#10b981';
const DURATION = 45;
const GAME_EMOJI = '🔎';
const GAME_TITLE = 'Visual Search';
const GAME_TAGLINE = 'Find it. Tap it. Before the horde.';

interface Signals { total: number; found: number; missed: number; falseAlarms: number; avgReactionMs: number; totalMs: number; maxDistractors: number; score: number; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const acc = (sig.found + sig.falseAlarms) > 0 ? sig.found / (sig.found + sig.falseAlarms) : 0;
  const avg = sig.found > 0 ? sig.totalMs / sig.found : 9999;
  if (acc >= 0.9 && avg < 700) return 'Eagle Eye 🦅';
  if (sig.maxDistractors >= 20) return 'Crowd Spotter 🔎';
  if (acc >= 0.8) return 'Sharp Vision 👁️';
  if (avg < 900) return 'Fast Finder ⚡';
  return 'Scanning... 🔍';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface SearchItem3D { mesh: THREE.Mesh; isTarget: boolean; }

function VisualSearchGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    sig: { total: 0, found: 0, missed: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, maxDistractors: 0, score: 0, maxStreak: 0, streakCurrent: 0 } as Signals,
    items: [] as SearchItem3D[],
    targetSymbol: 0, // index into shape types
    roundStart: 0, frame: 0,
    targetMesh: null as THREE.Mesh | null,
    roundTimer: 0,
    flashTimer: 0, flashSuccess: true,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const [targetLabel, setTargetLabel] = useState('');
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
        const _pbKey = 'pb_visual-search';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { total: 0, found: 0, missed: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, maxDistractors: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.items = []; s.roundTimer = 0; s.flashTimer = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x051a0f);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 100);
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
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x102210, 2));
    const pLight = new THREE.PointLight(0x10b981, 4, 30);
    pLight.position.set(0, 5, 5);
    scene.add(pLight);
    const sLight = new THREE.PointLight(0x059669, 2, 20);
    sLight.position.set(-5, 3, 3);
    scene.add(sLight);

    // Background grid
    for (let i = -6; i <= 6; i++) {
      const g1 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-8, i, -2), new THREE.Vector3(8, i, -2)]);
      scene.add(new THREE.Line(g1, new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.06 })));
      const g2 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i * 1.3, -6, -2), new THREE.Vector3(i * 1.3, 6, -2)]);
      scene.add(new THREE.Line(g2, new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.06 })));
    }

    // Flash sphere
    const flashGeo = new THREE.SphereGeometry(10, 16, 16);
    const flashMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.BackSide });
    scene.add(new THREE.Mesh(flashGeo, flashMat));

    // Shape factory
    const SHAPE_TYPES = ['sphere', 'box', 'cone', 'torus', 'octahedron', 'tetrahedron'];
    const makeGeo = (type: string, r: number): THREE.BufferGeometry => {
      switch (type) {
        case 'sphere': return new THREE.SphereGeometry(r, 12, 12);
        case 'box': return new THREE.BoxGeometry(r * 1.8, r * 1.8, r * 0.6);
        case 'cone': return new THREE.ConeGeometry(r, r * 2, 8);
        case 'torus': return new THREE.TorusGeometry(r, r * 0.3, 8, 16);
        case 'octahedron': return new THREE.OctahedronGeometry(r * 1.2);
        case 'tetrahedron': return new THREE.TetrahedronGeometry(r * 1.3);
        default: return new THREE.SphereGeometry(r, 12, 12);
      }
    };

    const SHAPE_NAMES = ['○', '□', '△', '◎', '⬡', '▽'];
    const COLORS_DIM = [0x1a5c3a, 0x155e2e, 0x1a5c45, 0x134d2e, 0x1e6640, 0x163d26];
    const TARGET_COLORS = [0x10b981, 0x34d399, 0x6ee7b7, 0x059669, 0x22c55e, 0x4ade80];

    const spawnRound = () => {
      // Clear old items
      s.items.forEach(it => scene.remove(it.mesh));
      s.items = [];

      // Pick target
      const targetType = Math.floor(Math.random() * SHAPE_TYPES.length);
      s.targetSymbol = targetType;
      setTargetLabel(`Find: ${SHAPE_NAMES[targetType]}`);

      // Difficulty: increase distractor count with score
      const distractorCount = Math.min(5 + Math.floor(s.sig.score * 0.3), 20);
      if (distractorCount > s.sig.maxDistractors) s.sig.maxDistractors = distractorCount;

      const positions: { x: number; y: number }[] = [];
      const minDist = 1.4;
      const placeItem = (isTarget: boolean) => {
        let attempts = 0;
        while (attempts < 50) {
          const x = (Math.random() - 0.5) * 10;
          const y = (Math.random() - 0.5) * 7;
          const ok = positions.every(p => Math.hypot(p.x - x, p.y - y) >= minDist);
          if (ok) {
            positions.push({ x, y });
            const type = isTarget ? SHAPE_TYPES[targetType] : SHAPE_TYPES.filter((_, i) => i !== targetType)[Math.floor(Math.random() * (SHAPE_TYPES.length - 1))];
            const r = 0.35 + Math.random() * 0.1;
            const geo = makeGeo(type, r);
            const color = isTarget ? TARGET_COLORS[targetType] : COLORS_DIM[Math.floor(Math.random() * COLORS_DIM.length)];
            const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3, emissive: isTarget ? color : 0x000000, emissiveIntensity: isTarget ? 0.2 : 0 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, y, 0);
            mesh.rotation.set(Math.random(), Math.random(), Math.random());
            scene.add(mesh);
            s.items.push({ mesh, isTarget });
            return;
          }
          attempts++;
        }
      };

      // Place one target, rest distractors
      placeItem(true);
      for (let i = 0; i < distractorCount; i++) placeItem(false);

      s.roundStart = Date.now();
      s.sig.total++;
    };

    spawnRound();

    // Raycaster for tap
    const raycaster = new THREE.Raycaster();
    const onTap = (e: PointerEvent) => {
      if (!s.running) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const meshes = s.items.map(it => it.mesh);
      const intersects = raycaster.intersectObjects(meshes);

      if (intersects.length > 0) {
        const tappedMesh = intersects[0].object as THREE.Mesh;
        const item = s.items.find(it => it.mesh === tappedMesh);
        if (!item) return;

        if (item.isTarget) {
          const elapsed = Date.now() - s.roundStart;
          s.sig.found++; s.sig.streakCurrent++;
          if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
          s.sig.totalMs += elapsed;
          s.sig.avgReactionMs = s.sig.totalMs / s.sig.found;
          const bonus = elapsed < 700 ? 2 : 1;
          const pts = bonus + (s.sig.streakCurrent >= 3 ? 1 : 0);
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          sfx.collect(); hapticScore();
          s.flashTimer = 20; s.flashSuccess = true;
          flashMat.color.setHex(0x10b981);
          spawnRound();
        } else {
          s.sig.falseAlarms++; s.sig.streakCurrent = 0;
          sfx.nearMiss(); hapticFail();
          s.flashTimer = 15; s.flashSuccess = false;
          flashMat.color.setHex(0xef4444);
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onTap);

    // Auto-advance if too slow
    const ROUND_TIMEOUT = 4000;

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Rotate items
      s.items.forEach((it, i) => {
        it.mesh.rotation.y += 0.01 + i * 0.002;
        // Pulse target
        if (it.isTarget) {
          const pulse = 1 + Math.sin(s.frame * 0.08) * 0.06;
          it.mesh.scale.setScalar(pulse);
          (it.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + Math.sin(s.frame * 0.1) * 0.15;
        }
      });

      // Flash decay
      if (s.flashTimer > 0) {
        s.flashTimer--;
        flashMat.opacity = (s.flashTimer / 20) * 0.18;
      } else {
        flashMat.opacity = 0;
      }

      // Auto-advance round if timeout
      if (Date.now() - s.roundStart > ROUND_TIMEOUT) {
        s.sig.missed++; s.sig.streakCurrent = 0;
        sfx.fail(); hapticFail();
        spawnRound();
      }

      // Light pulse
      pLight.intensity = 4 + Math.sin(s.frame * 0.05) * 0.8;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Searching!" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <>
        <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
        <div style={{ position: 'fixed', bottom: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: '8px 20px', border: `1px solid ${accent}44`, color: accent, fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>
          {targetLabel}
        </div>
      </>}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Found', value: `${finalSig.found}/${finalSig.total}`, color: '#4ade80' }, { label: 'False Alarms', value: String(finalSig.falseAlarms), color: finalSig.falseAlarms === 0 ? '#4ade80' : '#ef4444' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: accent }, { label: 'Avg React', value: finalSig.avgReactionMs > 0 ? `${Math.round(finalSig.avgReactionMs)}ms` : '—', color: '#fbbf24' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 10} />
      )}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>🏆 New Personal Best!</div>
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const VisualSearchGame = dynamic(() => Promise.resolve({ default: VisualSearchGameInner }), { ssr: false });
export default VisualSearchGame;
