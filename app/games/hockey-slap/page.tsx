'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticImpact } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'hockey-slap'; const ACCENT = '#3b82f6'; const DURATION = 45; const GAME_EMOJI = '🏒'; const GAME_TITLE = 'Hockey Slap'; const GAME_TAGLINE = 'Swipe to shoot the puck into the net!';
interface Signals { shots: number; goals: number; saved: number; topCorner: number; maxStreak: number; streakCurrent: number; score: number; }
function getPersonality(sig: Signals): string {
  const g = sig.shots > 0 ? sig.goals / sig.shots : 0;
  if (g >= 0.75 && sig.topCorner >= 3) return 'Sniper 🎯';
  if (sig.maxStreak >= 5) return 'Hat Trick Hero 🏆';
  if (g >= 0.5) return 'Sharp Shooter 🏒';
  return 'Slap Happy 🎪';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  puckX: number; puckY: number; puckVX: number; puckVY: number; puckActive: boolean;
  goalieX: number; goalieDir: number; goalieSpeed: number;
  swipeStartX: number; swipeStartY: number; swiping: boolean;
  frame: number;
}

function HockeySlapInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { shots: 0, goals: 0, saved: 0, topCorner: 0, maxStreak: 0, streakCurrent: 0, score: 0 },
    puckX: 0, puckY: -3.5, puckVX: 0, puckVY: 0, puckActive: false,
    goalieX: 0, goalieDir: 1, goalieSpeed: 0.06, swiping: false,
    swipeStartX: 0, swipeStartY: 0, frame: 0,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    puck: THREE.Mesh; goalie: THREE.Mesh; goalieLight: THREE.PointLight;
    goalMesh: THREE.Mesh; net: THREE.Mesh;
    floatMeshes: Array<{ mesh: THREE.Mesh; vy: number; alpha: number; born: number }>;
    animId: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { shots: 0, goals: 0, saved: 0, topCorner: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.puckX = 0; s.puckY = -3.5; s.puckActive = false; s.frame = 0;
    s.goalieX = 0; s.goalieDir = 1; s.goalieSpeed = 0.06;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x04101a);
    renderer.shadowMap.enabled = true;
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // === POLISH: Scene fog for atmospheric depth ===
    scene.fog = new THREE.Fog(scene.background instanceof THREE.Color ? (scene.background as THREE.Color).getHex() : 0x0a0a1a, 15, 35);
    // === END POLISH ===
    scene.background = new THREE.Color(0x0a1a2e);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 10, 8);
    camera.lookAt(0, 0, -1);

    scene.add(new THREE.AmbientLight(0xaaccff, 0.6));
    const iceLight = new THREE.DirectionalLight(0xffffff, 1.2);
    iceLight.position.set(0, 15, 5);
    scene.add(iceLight);
    const goalieLight = new THREE.PointLight(0x3b82f6, 2, 8);
    scene.add(goalieLight);

    // Ice rink
    const iceGeo = new THREE.BoxGeometry(12, 0.15, 14);
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.1, metalness: 0.4 });
    const ice = new THREE.Mesh(iceGeo, iceMat);
    ice.position.y = -0.075;
    scene.add(ice);

    // Rink lines (painted on ice)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
    const centerLine = new THREE.Mesh(new THREE.BoxGeometry(12, 0.01, 0.1), lineMat);
    scene.add(centerLine);
    const redLine = new THREE.Mesh(new THREE.BoxGeometry(12, 0.01, 0.15), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    redLine.position.z = 2;
    scene.add(redLine);

    // Center circle
    const circleGeo = new THREE.TorusGeometry(1.5, 0.06, 8, 48);
    const circleMesh = new THREE.Mesh(circleGeo, lineMat.clone());
    circleMesh.rotation.x = -Math.PI / 2;
    circleMesh.position.y = 0.01;
    scene.add(circleMesh);

    // Net/goal structure
    const netGeo = new THREE.BoxGeometry(4, 1.5, 0.5);
    const netMat = new THREE.MeshStandardMaterial({ color: 0xaaccff, transparent: true, opacity: 0.3, metalness: 0.5, roughness: 0.3 });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, 0.75, -5.5);
    scene.add(net);

    // Goal posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0xff3333, metalness: 0.7, roughness: 0.2 });
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.5, 8);
    [-2, 2].forEach(px => {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(px, 0.75, -5);
      scene.add(post);
    });
    const crossBarGeo = new THREE.CylinderGeometry(0.06, 0.06, 4.08, 8);
    const crossBar = new THREE.Mesh(crossBarGeo, postMat);
    crossBar.rotation.z = Math.PI / 2;
    crossBar.position.set(0, 1.5, -5);
    scene.add(crossBar);
    const goalMesh = new THREE.Mesh(netGeo, netMat);
    goalMesh.position.set(0, 0.75, -5.5);

    // Goalie
    const goalieGeo = new THREE.BoxGeometry(1.2, 1.6, 0.6);
    const goalieMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, emissive: 0x1e40af, emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.5 });
    const goalie = new THREE.Mesh(goalieGeo, goalieMat);
    goalie.position.set(0, 0.8, -5);
    scene.add(goalie);
    // Goalie helmet
    const helmetGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const helmet = new THREE.Mesh(helmetGeo, new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.5 }));
    helmet.position.set(0, 0.85, 0);
    goalie.add(helmet);

    // Puck
    const puckGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 16);
    const puckMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    const puck = new THREE.Mesh(puckGeo, puckMat);
    puck.position.set(0, 0.06, -3.5);
    scene.add(puck);

    // Rink boards
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });
    [[12, 0.5, 0.2, 0, 0, -7], [12, 0.5, 0.2, 0, 0, 7], [0.2, 0.5, 14, -6, 0, 0], [0.2, 0.5, 14, 6, 0, 0]].forEach(([bw, bh, bd, bx, by, bz]) => {
      const board = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), boardMat);
      board.position.set(bx, by + 0.25, bz);
      scene.add(board);
    });

    const floatMeshes: Array<{ mesh: THREE.Mesh; vy: number; alpha: number; born: number }> = [];
    const obj = { renderer, scene, camera, puck, goalie, goalieLight, goalMesh: net, net, floatMeshes, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail?.(); endGame(); }
    }, 1000);

    const NET_X_HALF = 2, NET_Z = -5, NET_TOP = 1.5;
    const GOALIE_HALF = 0.6;

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      s.frame++;

      // Goalie move
      s.goalieX += s.goalieDir * s.goalieSpeed;
      if (s.goalieX > 1.6) s.goalieDir = -1;
      if (s.goalieX < -1.6) s.goalieDir = 1;
      goalie.position.x = s.goalieX;
      goalieLight.position.set(s.goalieX, 2, -4.5);

      // Puck physics
      if (s.puckActive) {
        s.puckX += s.puckVX; s.puckY += s.puckVY;
        puck.position.set(s.puckX, 0.06, s.puckY);
        puck.rotation.y += s.puckVX * 0.5;

        // Goal check
        if (s.puckY < NET_Z && s.puckY > NET_Z - 0.8 && Math.abs(s.puckX) < NET_X_HALF) {
          const isTopCorner = Math.abs(s.puckX) > NET_X_HALF * 0.6;
          const goalieSaved = Math.abs(s.puckX - s.goalieX) < GOALIE_HALF;
          if (!goalieSaved) {
            s.sig.goals++;
            if (isTopCorner) s.sig.topCorner++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            const mult = s.sig.streakCurrent >= 3 ? 2 : 1;
            const pts = (isTopCorner ? 3 : 2) * mult;
            s.sig.score += pts;
            setScoreDisplay(s.sig.score);
            sfx.success?.(); hapticScore();
            // Flash net
            (net.material as THREE.MeshStandardMaterial).emissive.set(0xfbbf24);
            (net.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8;
            setTimeout(() => { (net.material as THREE.MeshStandardMaterial).emissiveIntensity = 0; }, 400);
          } else {
            s.sig.saved++; sfx.collision?.(); hapticFail(); s.sig.streakCurrent = 0;
          }
          s.puckActive = false;
          setTimeout(() => {
            if (!s.running) return;
            s.puckX = 0; s.puckY = -3.5; puck.position.set(0, 0.06, -3.5);
          }, 600);
        }

        // Out of bounds
        if (s.puckY < -8 || Math.abs(s.puckX) > 6.5) {
          s.puckActive = false; s.sig.streakCurrent = 0;
          setTimeout(() => {
            if (!s.running) return;
            s.puckX = 0; s.puckY = -3.5; puck.position.set(0, 0.06, -3.5);
          }, 400);
        }
      } else {
        puck.position.set(s.puckX, 0.06, s.puckY);
      }

      // Float text cleanup
      const now = Date.now();
      for (let i = floatMeshes.length - 1; i >= 0; i--) {
        const ft = floatMeshes[i];
        ft.mesh.position.y += ft.vy;
        ft.alpha -= 0.025;
        (ft.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, ft.alpha);
        if (now - ft.born > 1500) { scene.remove(ft.mesh); floatMeshes.splice(i, 1); }
      }

      // Ice shimmer
      (ice.material as THREE.MeshStandardMaterial).emissive.setHSL(0.6, 0.5, 0.02 + Math.sin(s.frame * 0.05) * 0.01);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    let swipeStartX = 0, swipeStartY = 0, swiping = false;
    const onDown = (e: PointerEvent) => {
      swipeStartX = e.clientX; swipeStartY = e.clientY; swiping = true;
    };
    const onUp = (e: PointerEvent) => {
      if (!swiping) return; swiping = false;
      const s = stateRef.current; if (!s.running || s.puckActive) return;
      const dx = e.clientX - swipeStartX; const dy = e.clientY - swipeStartY;
      const speed = Math.min(Math.sqrt(dx*dx+dy*dy)/40, 0.25);
      if (speed > 0.04) {
        const len = Math.sqrt(dx*dx+dy*dy);
        // Map screen swipe to 3D puck direction (y screen = -z world)
        s.puckVX = (dx/len)*speed*1.2;
        s.puckVY = -(dy/len)*speed*1.2;
        s.puckActive = true; s.sig.shots++;
        sfx.click?.(); hapticImpact();
      }
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointerup', onUp);
    return () => { mount.removeEventListener('pointerdown', onDown); mount.removeEventListener('pointerup', onUp); };
  }, [phase]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description="Swipe to shoot the puck past the goalie!" ctaLabel="Shoot! 🏒" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Goals', value: String(finalSig.goals), color: ACCENT }, { label: 'Top Corner', value: String(finalSig.topCorner), color: '#fbbf24' }, { label: 'Best Streak', value: `×${finalSig.maxStreak}`, color: '#4ade80' }, { label: 'Shots', value: String(finalSig.shots), color: '#06b6d4' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.goals >= 5} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const HockeySlap = dynamic(() => Promise.resolve({ default: HockeySlapInner }), { ssr: false });
export default HockeySlap;
