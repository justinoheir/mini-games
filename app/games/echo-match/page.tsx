'use client';
/**
 * ECHO MATCH 3D — Simon Says with 3D glowing tiles and tones.
 * Watch the sequence light up, then repeat it.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID  = 'echo-match';
const ACCENT   = '#06b6d4';
const DURATION = 45;
const GAME_EMOJI  = '🎶';
const GAME_TITLE  = 'Echo Match';
const GAME_TAGLINE = 'Watch the sequence. Repeat it perfectly.';

const TILE_COLORS_HEX = [0xef4444, 0x06b6d4, 0xa855f7, 0x22c55e];
const TILE_FREQS   = [261.63, 329.63, 392.00, 523.25];
const LIT_DURATION = 480;
const LIT_GAP      = 220;

interface Signals { score: number; rounds: number; longestSeq: number; correctTaps: number; wrongTaps: number; }
function getPersonality(s: Signals): string {
  if (s.rounds >= 5 && s.wrongTaps === 0) return 'Perfect Memory 🧠';
  if (s.rounds >= 4) return 'Sharp Listener 👂';
  if (s.rounds >= 2) return 'Getting Warmer 🌡️';
  return 'Learning the Beat 🎵';
}
type SubPhase = 'watching' | 'repeating' | 'correct' | 'wrong';
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function EchoMatchGameInner() {
  const theme  = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cancelledRef = useRef(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const sigRef = useRef<Signals>({ score: 0, rounds: 0, longestSeq: 0, correctTaps: 0, wrongTaps: 0 });
  const seqRef = useRef<number[]>([]);
  const progRef = useRef(0);
  const timeRef = useRef(DURATION);

  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    tiles: THREE.Mesh[]; tileLights: THREE.PointLight[];
    particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
    animId: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisp, setScoreDisp] = useState(0);
  const [subPhase, setSubPhase] = useState<SubPhase>('watching');
  const [litTile, setLitTile] = useState(-1);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const subPhaseRef = useRef<SubPhase>('watching');

  const playTone = useCallback((tileIdx: number) => {
    try {
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = TILE_FREQS[tileIdx];
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.45);
    } catch { /**/ }
  }, []);

  const lightTile = useCallback((idx: number, duration = LIT_DURATION) => {
    setLitTile(idx);
    const t = threeRef.current;
    if (t) {
      const mat = t.tiles[idx].material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.2;
      t.tileLights[idx].intensity = 6;
      setTimeout(() => {
        mat.emissiveIntensity = 0.2;
        t.tileLights[idx].intensity = 0.5;
        setLitTile(-1);
      }, duration);
    }
    playTone(idx);
  }, [playTone]);

  const endGame = useCallback(() => {
    cancelledRef.current = true;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    try {
      const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
      if (sigRef.current.score > pb) { localStorage.setItem(`pb_${GAME_ID}`, String(sigRef.current.score)); setIsNewBest(true); }
    } catch { /**/ }
    setFinalSig({ ...sigRef.current }); setPhase('done'); hapticVictory();
  }, []);

  const startSequence = useCallback(() => {
    cancelledRef.current = false;
    subPhaseRef.current = 'watching'; setSubPhase('watching');
    seqRef.current.push(Math.floor(Math.random() * 4));
    const seq = seqRef.current;
    sigRef.current.longestSeq = Math.max(sigRef.current.longestSeq, seq.length);

    let delay = 600;
    for (let i = 0; i < seq.length; i++) {
      const idx = seq[i];
      const t = delay;
      setTimeout(() => {
        if (cancelledRef.current) return;
        lightTile(idx, LIT_DURATION);
      }, t);
      delay += LIT_DURATION + LIT_GAP;
    }
    setTimeout(() => {
      if (cancelledRef.current) return;
      subPhaseRef.current = 'repeating'; setSubPhase('repeating');
      progRef.current = 0;
    }, delay + 200);
  }, [lightTile]);

  const handleTileTap = useCallback((tileIdx: number) => {
    if (subPhaseRef.current !== 'repeating') return;
    lightTile(tileIdx, 300);
    const expected = seqRef.current[progRef.current];
    if (tileIdx === expected) {
      sigRef.current.correctTaps++;
      hapticScore();
      progRef.current++;
      if (progRef.current === seqRef.current.length) {
        sigRef.current.rounds++;
        sigRef.current.score += seqRef.current.length * 2;
        setScoreDisp(sigRef.current.score);
        subPhaseRef.current = 'correct'; setSubPhase('correct');
        sfx.success?.();
        setTimeout(startSequence, 1200);
      }
    } else {
      sigRef.current.wrongTaps++;
      hapticFail(); sfx.fail?.();
      subPhaseRef.current = 'wrong'; setSubPhase('wrong');
      seqRef.current = []; progRef.current = 0;
      setTimeout(startSequence, 1500);
    }
  }, [lightTile, startSequence]);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    cancelledRef.current = false;
    sigRef.current = { score: 0, rounds: 0, longestSeq: 0, correctTaps: 0, wrongTaps: 0 };
    seqRef.current = []; progRef.current = 0; timeRef.current = DURATION;
    setScoreDisp(0); setTimeLeft(DURATION); setSubPhase('watching'); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x040810);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040810);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 8);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    // Stars background
    const starPos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) { starPos[i*3] = (Math.random()-0.5)*40; starPos[i*3+1] = (Math.random()-0.5)*40; starPos[i*3+2] = -10 - Math.random()*20; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.6 })));

    // 4 tiles in 2x2 grid
    const tiles: THREE.Mesh[] = [];
    const tileLights: THREE.PointLight[] = [];
    const TILE_POS = [[-1.3, 1.1, 0], [1.3, 1.1, 0], [-1.3, -1.1, 0], [1.3, -1.1, 0]];
    TILE_COLORS_HEX.forEach((color, i) => {
      const geo = new THREE.BoxGeometry(2.0, 1.6, 0.25);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.4 });
      const tile = new THREE.Mesh(geo, mat);
      tile.position.set(TILE_POS[i][0], TILE_POS[i][1], TILE_POS[i][2]);
      scene.add(tile);
      tiles.push(tile);

      const tl = new THREE.PointLight(color, 0.5, 5);
      tl.position.set(TILE_POS[i][0], TILE_POS[i][1], 1);
      scene.add(tl);
      tileLights.push(tl);
    });

    const particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }> = [];
    const obj = { renderer, scene, camera, tiles, tileLights, particles, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      timeRef.current--;
      setTimeLeft(timeRef.current);
      if (timeRef.current <= 0) endGame();
    }, 1000);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      const t0 = Date.now() * 0.001;

      // Tile idle pulse
      tiles.forEach((tile, i) => {
        tile.rotation.x = Math.sin(t0 * 0.8 + i * 0.5) * 0.04;
        tile.rotation.y = Math.sin(t0 * 0.6 + i * 0.7) * 0.04;
        tile.position.z = Math.sin(t0 * 1.2 + i * 0.9) * 0.1;
      });

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.life -= 0.03;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life);
        if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
      }

      renderer.render(scene, camera);
    };
    animate();

    setTimeout(() => startSequence(), 500);

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, startSequence]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTap = (e: PointerEvent) => {
      e.preventDefault();
      const t = threeRef.current; if (!t) return;
      const rect = mount.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), t.camera);
      const hits = raycaster.intersectObjects(t.tiles);
      if (hits.length > 0) {
        const tileIdx = t.tiles.indexOf(hits[0].object as THREE.Mesh);
        if (tileIdx >= 0) handleTileTap(tileIdx);
      }
    };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase, handleTileTap]);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisp(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
  }, []);

  // Subphase status overlay
  const statusMsg = subPhase === 'watching' ? '👀 Watch...' : subPhase === 'repeating' ? '👆 Your turn!' : subPhase === 'correct' ? '✅ Perfect!' : '❌ Missed!';
  const statusColor = subPhase === 'correct' ? '#4ade80' : subPhase === 'wrong' ? '#ef4444' : 'rgba(255,255,255,0.7)';

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Listen Up 🎶" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisp }]} />
              <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)', color: statusColor, fontSize: 22, fontWeight: 800, textAlign: 'center', pointerEvents: 'none', textShadow: `0 0 16px ${statusColor}` }}>
                {statusMsg}
              </div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Rounds Done', value: String(finalSig.rounds), color: ACCENT }, { label: 'Longest Seq', value: String(finalSig.longestSeq), color: '#fbbf24' }, { label: 'Correct Taps', value: String(finalSig.correctTaps), color: '#4ade80' }, { label: 'Wrong Taps', value: String(finalSig.wrongTaps), color: '#ef4444' }]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.rounds >= 3} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, rounds: sig.rounds, longestSeq: sig.longestSeq, correctTaps: sig.correctTaps, wrongTaps: sig.wrongTaps }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const EchoMatchGame = dynamic(() => Promise.resolve({ default: EchoMatchGameInner }), { ssr: false });
export default EchoMatchGame;
