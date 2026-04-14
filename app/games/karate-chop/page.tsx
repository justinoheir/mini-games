'use client';
/**
 * KARATE CHOP — 3D dojo with glowing pad targets in Simon Says pattern.
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

const GAME_ID = 'karate-chop';
const ACCENT = '#ff2d55';
const DURATION = 30;
const GAME_EMOJI = '🥋';
const GAME_TITLE = 'Karate Chop';
const GAME_TAGLINE = 'Chop the right zone. Kata master.';

interface Signals { score: number; hits: number; attempts: number; reactionTimes: number[]; maxStreak: number; streakCurrent: number; }

function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  if (acc >= 0.75) return 'Black Belt 🥋';
  if (acc >= 0.55) return 'Brown Belt ⚡';
  if (sig.maxStreak >= 4) return 'Disciplined 🎯';
  return 'White Belt 🤜';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface PadObj { mesh: THREE.Mesh; light: THREE.PointLight; idx: number; }

function KarateChopGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { score: 0, hits: 0, attempts: 0, reactionTimes: [] as number[], maxStreak: 0, streakCurrent: 0 } as Signals,
    pads: [] as PadObj[],
    sequence: [] as number[],
    progress: 0,
    showing: true, showIdx: 0, showTimer: 0,
    scene: null as THREE.Scene | null,
    renderer: null as THREE.WebGLRenderer | null,
    camera: null as THREE.PerspectiveCamera | null,
    raycaster: new THREE.Raycaster(),
    pendingClick: null as THREE.Vector2 | null,
    flashTimer: 0, flashPad: -1,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const [showingDisplay, setShowingDisplay] = useState(true);
  const [progressDisplay, setProgressDisplay] = useState('');

  const newSeq = useCallback(() => {
    const s = stateRef.current;
    const len = Math.min(2 + Math.floor(s.sig.hits / 3), 7);
    s.sequence = Array.from({ length: len }, () => Math.floor(Math.random() * s.pads.length));
    s.progress = 0; s.showing = true; s.showIdx = 0; s.showTimer = 0;
    s.sig.attempts++;
    setShowingDisplay(true);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
        const _pbKey = 'pb_karate-chop';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, hits: 0, attempts: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    s.pads = []; s.sequence = []; s.progress = 0; s.showing = true;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0000);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a0000, 15, 40);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
    camera.position.set(0, 3, 10);
    camera.lookAt(0, 0, 0);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x300000, 5));
    const topLight = new THREE.PointLight(0xef4444, 2, 20);
    topLight.position.set(0, 8, 0);
    scene.add(topLight);

    // Dojo floor
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.MeshPhongMaterial({ color: 0x3b0000 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2;
    scene.add(floor);

    // Grid lines
    scene.add(new THREE.GridHelper(20, 10, 0x660000, 0x330000));

    // Dojo walls (back)
    const wallGeo = new THREE.PlaneGeometry(20, 8);
    const wallMat = new THREE.MeshPhongMaterial({ color: 0x2a0000, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 2, -8);
    scene.add(wall);

    // Hanging lanterns (atmosphere)
    for (let i = -2; i <= 2; i++) {
      const lanGeo = new THREE.CylinderGeometry(0.15, 0.1, 0.4, 8);
      const lanMat = new THREE.MeshPhongMaterial({ color: 0xff4400, emissive: 0x660000 });
      const lan = new THREE.Mesh(lanGeo, lanMat);
      lan.position.set(i * 3, 4, -3);
      scene.add(lan);
      const lanLight = new THREE.PointLight(0xff4400, 0.5, 3);
      lanLight.position.set(i * 3, 3.5, -3);
      scene.add(lanLight);
    }

    // Create 4 pads in circular arrangement
    const N = 4;
    const R = 3;
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * R;
      const z = Math.sin(angle) * R * 0.5;
      const y = -1;

      const padGeo = new THREE.CylinderGeometry(0.8, 0.9, 0.25, 16);
      const padMat = new THREE.MeshPhongMaterial({ color: 0x330000, emissive: 0x110000, shininess: 60 });
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(x, y, z);
      scene.add(pad);

      // Pad number marker
      const markerGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.05, 12);
      const markerMat = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x888888 });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(x, y + 0.15, z);
      scene.add(marker);

      const padLight = new THREE.PointLight(0xef4444, 0, 3);
      padLight.position.set(x, y + 1, z);
      scene.add(padLight);

      s.pads.push({ mesh: pad, light: padLight, idx: i });
    }

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    setTimeout(() => { if (s.running) newSeq(); }, 700);

    let t = 0, showTick = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016; showTick++;

      // Show sequence
      if (s.showing) {
        if (showTick % 28 === 0) {
          if (s.showIdx < s.sequence.length) {
            const padIdx = s.sequence[s.showIdx];
            const pad = s.pads[padIdx];
            if (pad) {
              (pad.mesh.material as THREE.MeshPhongMaterial).color.setHex(0xef4444);
              (pad.mesh.material as THREE.MeshPhongMaterial).emissive.setHex(0xcc0000);
              pad.light.intensity = 5;
              sfx.countdown(); haptic([20]);
              setTimeout(() => {
                (pad.mesh.material as THREE.MeshPhongMaterial).color.setHex(0x330000);
                (pad.mesh.material as THREE.MeshPhongMaterial).emissive.setHex(0x110000);
                pad.light.intensity = 0;
              }, 350);
            }
            s.showIdx++;
          } else {
            s.showing = false; s.progress = 0;
            setShowingDisplay(false);
            setProgressDisplay(`0 / ${s.sequence.length}`);
          }
        }
      }

      // Process click
      if (s.pendingClick && !s.showing) {
        s.raycaster.setFromCamera(s.pendingClick, camera);
        const padMeshes = s.pads.map(p => p.mesh);
        const hits = s.raycaster.intersectObjects(padMeshes);
        if (hits.length > 0) {
          const hitMesh = hits[0].object as THREE.Mesh;
          const pad = s.pads.find(p => p.mesh === hitMesh);
          if (pad) {
            (pad.mesh.material as THREE.MeshPhongMaterial).color.setHex(0xffffff);
            pad.light.intensity = 6;
            sfx.click(); haptic([20]);
            setTimeout(() => {
              (pad.mesh.material as THREE.MeshPhongMaterial).color.setHex(0x330000);
              pad.light.intensity = 0;
            }, 180);

            if (s.sequence[s.progress] === pad.idx) {
              s.progress++;
              setProgressDisplay(`${s.progress} / ${s.sequence.length}`);
              if (s.progress >= s.sequence.length) {
                s.sig.hits++; s.sig.streakCurrent++;
                if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
                s.sig.score += s.sig.streakCurrent >= 3 ? 2 : 1;
                setScoreDisplay(s.sig.score);
                sfx.success(); haptic([50, 20, 80]);
                topLight.color.setHex(0xfbbf24);
                setTimeout(() => { topLight.color.setHex(0xef4444); if (s.running) newSeq(); }, 500);
              }
            } else {
              s.sig.streakCurrent = 0;
              sfx.fail(); haptic([40, 30, 40]);
              setTimeout(() => { if (s.running) newSeq(); }, 480);
            }
          }
        }
        s.pendingClick = null;
      }

      // Pulse the next pad to tap (during recall)
      if (!s.showing && s.progress < s.sequence.length) {
        const nextPad = s.pads[s.sequence[s.progress]];
        if (nextPad) {
          const pulse = 0.5 + Math.sin(t * 8) * 0.3;
          nextPad.light.intensity = Math.max(0, pulse);
        }
      }

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      s.running = false;
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [endGame, newSeq]);

  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s = stateRef.current;
      if (!s.renderer) return;
      const rect = s.renderer.domElement.getBoundingClientRect();
      s.pendingClick = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [phase]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits / sig.attempts) * 100) : 0;
    return [
      { label: 'Accuracy', value: acc + '%', color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444' },
      { label: 'Best Streak', value: '×' + sig.maxStreak, color: ACCENT },
      { label: 'Score', value: String(sig.score), color: 'var(--color-text)' },
      { label: 'Hits', value: String(sig.hits), color: '#fbbf24' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#1a0000 0%,#2a0000 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Enter the Dojo 🥋" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <>
          <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />
          <div style={{ position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', color: 'rgba(239,68,68,0.8)', fontSize: 14, fontWeight: 700, pointerEvents: 'none', zIndex: 50 }}>
            {showingDisplay ? '👁 WATCH…' : `YOUR TURN — ${progressDisplay}`}
          </div>
        </>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 5} />
          <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>🏆 New Personal Best!</div>
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
const KarateChopGame = dynamic(() => Promise.resolve({ default: KarateChopGameInner }), { ssr: false });
export default KarateChopGame;
