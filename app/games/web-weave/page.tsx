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

const GAME_ID = 'web-weave';
const ACCENT = '#a78bfa';
const DURATION = 60;
const GAME_EMOJI = '🕸️';
const GAME_TITLE = 'Web Weave';
const GAME_TAGLINE = 'Drag between anchors to weave your web. Catch flies!';

interface Signals { strandsWoven: number; fliesCaught: number; fliesEscaped: number; longestChain: number; score: number; combo: number; maxCombo: number; }
function getPersonality(sig: Signals): string {
  if (sig.fliesCaught >= 15 && sig.fliesEscaped === 0) return 'Master Weaver 🕷️';
  if (sig.strandsWoven >= 20) return 'Web Architect 🕸️';
  if (sig.maxCombo >= 5) return 'Fly Catcher 🪰';
  if (sig.fliesCaught >= 8) return 'Spider Apprentice 🕷️';
  return 'Learning to Weave 🧵';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

interface Anchor3D { mesh: THREE.Mesh; x: number; y: number; id: number; }
interface Strand3D { line: THREE.Line; a: number; b: number; }
interface Fly3D { mesh: THREE.Mesh; x: number; y: number; vx: number; vy: number; id: number; caught: boolean; }

function WebWeaveGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    sig: { strandsWoven: 0, fliesCaught: 0, fliesEscaped: 0, longestChain: 0, score: 0, combo: 0, maxCombo: 0 } as Signals,
    anchors: [] as Anchor3D[],
    strands: [] as Strand3D[],
    flies: [] as Fly3D[],
    dragging: false, dragFromId: -1, dragX: 0, dragY: 0,
    flySpawnTimer: 0, nextFlyId: 0, chainLength: 0, frame: 0,
    dragLineMesh: null as THREE.Line | null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
        const _pbKey = 'pb_web-weave';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { strandsWoven: 0, fliesCaught: 0, fliesEscaped: 0, longestChain: 0, score: 0, combo: 0, maxCombo: 0 };
    s.anchors = []; s.strands = []; s.flies = [];
    s.dragging = false; s.dragFromId = -1; s.flySpawnTimer = 0; s.nextFlyId = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a12);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
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

    scene.add(new THREE.AmbientLight(0x111122, 2));
    const pLight = new THREE.PointLight(0xa78bfa, 4, 25);
    pLight.position.set(0, 5, 5);
    scene.add(pLight);
    const sLight = new THREE.PointLight(0x94a3b8, 2, 20);
    sLight.position.set(-5, -3, 3);
    scene.add(sLight);

    // Background spider web (static faint)
    for (let r = 1; r <= 4; r++) {
      const bg = new THREE.RingGeometry(r * 0.9, r * 0.9 + 0.02, 32);
      const bm = new THREE.MeshBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
      scene.add(new THREE.Mesh(bg, bm));
    }

    // Anchor points (in a circle)
    const anchorCount = 8;
    const anchorRadius = 4.5;
    for (let i = 0; i < anchorCount; i++) {
      const angle = (i / anchorCount) * Math.PI * 2;
      const ax = Math.cos(angle) * anchorRadius;
      const ay = Math.sin(angle) * anchorRadius;
      const geo = new THREE.SphereGeometry(0.2, 12, 12);
      const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, emissive: 0xa78bfa, emissiveIntensity: 0.5, roughness: 0.4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(ax, ay, 0);
      scene.add(mesh);
      s.anchors.push({ mesh, x: ax, y: ay, id: i });
    }

    // Drag line
    const dragGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)]);
    const dragLine = new THREE.Line(dragGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    scene.add(dragLine);
    s.dragLineMesh = dragLine;

    const raycaster = new THREE.Raycaster();
    const worldPos = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((clientX - rect.left) / rect.width - 0.5) * 12;
      const ny = -((clientY - rect.top) / rect.height - 0.5) * 9;
      return { nx, ny };
    };

    const onDown = (e: PointerEvent) => {
      if (!s.running) return;
      const { nx, ny } = worldPos(e.clientX, e.clientY);
      let closest = -1, minDist = 1.0;
      s.anchors.forEach(a => {
        const d = Math.hypot(a.x - nx, a.y - ny);
        if (d < minDist) { minDist = d; closest = a.id; }
      });
      if (closest >= 0) {
        s.dragging = true; s.dragFromId = closest;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!s.running || !s.dragging) return;
      const { nx, ny } = worldPos(e.clientX, e.clientY);
      s.dragX = nx; s.dragY = ny;
    };
    const onUp = (e: PointerEvent) => {
      if (!s.running || !s.dragging) return;
      s.dragging = false;
      const { nx, ny } = worldPos(e.clientX, e.clientY);
      let closestId = -1, minDist = 1.0;
      s.anchors.forEach(a => {
        if (a.id === s.dragFromId) return;
        const d = Math.hypot(a.x - nx, a.y - ny);
        if (d < minDist) { minDist = d; closestId = a.id; }
      });
      if (closestId >= 0) {
        // Check not already woven
        const exists = s.strands.some(st => (st.a === s.dragFromId && st.b === closestId) || (st.a === closestId && st.b === s.dragFromId));
        if (!exists) {
          const fromA = s.anchors.find(a => a.id === s.dragFromId)!;
          const toA = s.anchors.find(a => a.id === closestId)!;
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(fromA.x, fromA.y, 0),
            new THREE.Vector3(toA.x, toA.y, 0)
          ]);
          const alpha = 0.4 + s.sig.strandsWoven * 0.02;
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: Math.min(0.9, alpha) }));
          scene.add(line);
          s.strands.push({ line, a: s.dragFromId, b: closestId });
          s.sig.strandsWoven++; s.chainLength++;
          if (s.chainLength > s.sig.longestChain) s.sig.longestChain = s.chainLength;
          s.sig.score++; setScoreDisplay(s.sig.score);
          sfx.click(); haptic([20]);

          // Highlight strand
          (fromA.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1;
          setTimeout(() => { (fromA.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5; }, 200);
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);

    const spawnFly = () => {
      const side = Math.random() > 0.5 ? 1 : -1;
      const geo = new THREE.SphereGeometry(0.15, 8, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0x374151, emissive: 0x6b7280, emissiveIntensity: 0.4 });
      const mesh = new THREE.Mesh(geo, mat);
      const fx = side * 7;
      const fy = (Math.random() - 0.5) * 5;
      mesh.position.set(fx, fy, 0);
      scene.add(mesh);
      s.flies.push({ mesh, x: fx, y: fy, vx: -side * (0.03 + Math.random() * 0.02), vy: (Math.random() - 0.5) * 0.02, id: s.nextFlyId++, caught: false });
    };

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); endGame(); }
    }, 1000);

    const checkFlyInWeb = (fx: number, fy: number): boolean => {
      // Check if fly is inside any web strand polygon area (simplified: near strands)
      for (const strand of s.strands) {
        const a = s.anchors.find(an => an.id === strand.a)!;
        const b = s.anchors.find(an => an.id === strand.b)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const t = Math.max(0, Math.min(1, ((fx - a.x) * dx + (fy - a.y) * dy) / (len * len)));
        const cx = a.x + t * dx, cy = a.y + t * dy;
        if (Math.hypot(fx - cx, fy - cy) < 0.5) return true;
      }
      return false;
    };

    const loop = () => {
      if (!s.running) return;
      s.frame++;

      // Drag line
      if (s.dragging && s.dragLineMesh) {
        const fromA = s.anchors.find(a => a.id === s.dragFromId);
        if (fromA) {
          s.dragLineMesh.geometry.setFromPoints([
            new THREE.Vector3(fromA.x, fromA.y, 0.1),
            new THREE.Vector3(s.dragX, s.dragY, 0.1)
          ]);
          (s.dragLineMesh.material as THREE.LineBasicMaterial).opacity = 0.7;
        }
      } else if (s.dragLineMesh) {
        (s.dragLineMesh.material as THREE.LineBasicMaterial).opacity = 0;
      }

      // Spawn fly
      s.flySpawnTimer++;
      if (s.flySpawnTimer % 80 === 0) spawnFly();

      // Move flies & check
      for (let i = s.flies.length - 1; i >= 0; i--) {
        const fly = s.flies[i];
        if (fly.caught) { scene.remove(fly.mesh); s.flies.splice(i, 1); continue; }
        fly.x += fly.vx; fly.y += fly.vy;
        fly.mesh.position.set(fly.x, fly.y, 0.1);
        fly.mesh.rotation.y += 0.1;

        if (Math.abs(fly.x) > 7 || Math.abs(fly.y) > 6) {
          scene.remove(fly.mesh); s.flies.splice(i, 1);
          s.sig.fliesEscaped++; s.sig.combo = 0;
          continue;
        }

        if (checkFlyInWeb(fly.x, fly.y)) {
          fly.caught = true;
          s.sig.fliesCaught++; s.sig.combo++;
          if (s.sig.combo > s.sig.maxCombo) s.sig.maxCombo = s.sig.combo;
          const pts = 2 * (s.sig.combo >= 3 ? 2 : 1);
          s.sig.score += pts; setScoreDisplay(s.sig.score);
          sfx.collect(); haptic([30]);
          // Flash fly green
          (fly.mesh.material as THREE.MeshStandardMaterial).color.setHex(0x4ade80);
          (fly.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x4ade80);
          (fly.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1;
        }
      }

      // Pulse anchors
      s.anchors.forEach((a, i) => {
        (a.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + Math.sin(s.frame * 0.06 + i * 0.8) * 0.2;
      });

      // Strand shimmer
      s.strands.forEach((st, i) => {
        (st.line.material as THREE.LineBasicMaterial).opacity = 0.4 + Math.sin(s.frame * 0.03 + i * 0.5) * 0.1;
      });

      pLight.intensity = 4 + Math.sin(s.frame * 0.06) * 0.5;

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (stopMusicRef.current) stopMusicRef.current();
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
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Weaving 🕸️" accentColor={accent} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>}
      {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Strands Woven', value: String(finalSig.strandsWoven), color: accent }, { label: 'Flies Caught', value: String(finalSig.fliesCaught), color: '#4ade80' }, { label: 'Flies Escaped', value: String(finalSig.fliesEscaped), color: finalSig.fliesEscaped === 0 ? '#4ade80' : '#ef4444' }, { label: 'Best Combo', value: `×${finalSig.maxCombo}`, color: '#fbbf24' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.fliesCaught >= 8} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>🏆 New Personal Best!</div>
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const WebWeaveGame = dynamic(() => Promise.resolve({ default: WebWeaveGameInner }), { ssr: false });
export default WebWeaveGame;
