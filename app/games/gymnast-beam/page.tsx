'use client';
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
import { createTiltController } from '@/lib/tilt';

const GAME_ID      = 'gymnast-beam';
const ACCENT       = '#f472b6';
const DURATION     = 30;
const GAME_EMOJI   = '🤸';
const GAME_TITLE   = 'Gymnast Beam';
const GAME_TAGLINE = 'Stay balanced. Tap at the perfect moment.';
const BALANCE_THRESHOLD = 14;
const PERFECT_THRESHOLD = 6;

interface Signals { score: number; perfectMoves: number; goodMoves: number; wobblyMoves: number; falls: number; maxStreak: number; streak: number; }
function getPersonality(sig: Signals): string {
  const total = sig.perfectMoves + sig.goodMoves + sig.wobblyMoves;
  const perfRate = total > 0 ? sig.perfectMoves / total : 0;
  if (sig.falls === 0 && perfRate >= 0.7)  return 'Olympic Gold 🥇';
  if (sig.falls <= 1 && perfRate >= 0.5)   return 'Elite Gymnast 🌟';
  if (sig.falls === 0)                     return 'Steady Performer 💪';
  if (sig.perfectMoves >= 6)               return 'Risk Taker ⚡';
  return 'Beam Walker 🤸';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  beamAngle: number; beamVelocity: number;
  tiltInput: number; wobbleIntensity: number;
  gameStartTime: number; tapCooldown: boolean;
  jumpOffset: number; jumping: boolean; jumpVy: number;
}

function GymnastBeamGameInner() {
  const theme      = useBrandTheme();
  const mountRef   = useRef<HTMLDivElement>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltRef    = useRef<ReturnType<typeof createTiltController> | null>(null);
  const endCalledRef = useRef(false);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, perfectMoves: 0, goodMoves: 0, wobblyMoves: 0, falls: 0, maxStreak: 0, streak: 0 },
    beamAngle: 0, beamVelocity: 2, tiltInput: 0, wobbleIntensity: 1.0,
    gameStartTime: 0, tapCooldown: false, jumpOffset: 0, jumping: false, jumpVy: 0,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    beam: THREE.Mesh; beamGroup: THREE.Group;
    gymnast: THREE.Group; gymnasHead: THREE.Mesh; armL: THREE.Mesh; armR: THREE.Mesh;
    needle: THREE.Mesh; meterBase: THREE.Mesh;
    particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
    animId: number;
  } | null>(null);

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const [moveMsg, setMoveMsg]           = useState<{ text: string; color: string } | null>(null);
  const playerSessionRef                = useRef<PlayerSession | null>(null);
  const moveMsgTimer                    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endGame = useCallback(() => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.(); stopMusicRef.current = null;
    tiltRef.current?.stop();
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
        const _pbKey = 'pb_gymnast-beam';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const performMove = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.tapCooldown) return;
    s.tapCooldown = true;
    setTimeout(() => { s.tapCooldown = false; }, 500);

    const absAngle = Math.abs(s.beamAngle);
    if (absAngle <= PERFECT_THRESHOLD) {
      s.sig.perfectMoves++;
      s.sig.streak++;
      if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
      const pts = 3 + Math.floor(s.sig.streak / 3);
      s.sig.score += pts;
      s.jumping = true; s.jumpVy = -0.12;
      sfx.collect?.(); hapticScore();
      setScoreDisplay(s.sig.score);
      setMoveMsg({ text: '⭐ Perfect!', color: '#fde68a' });
      // Spawn particles
      const t = threeRef.current;
      if (t) {
        for (let i = 0; i < 10; i++) {
          const pMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 1 }));
          pMesh.position.set(0, 2, 0);
          t.scene.add(pMesh);
          const angle = (i / 10) * Math.PI * 2;
          t.particles.push({ mesh: pMesh, vx: Math.cos(angle)*0.06, vy: Math.abs(Math.sin(angle))*0.08+0.04, vz: 0, life: 1 });
        }
      }
    } else if (absAngle <= BALANCE_THRESHOLD) {
      s.sig.goodMoves++;
      s.sig.streak++;
      if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
      s.sig.score += 1;
      s.jumping = true; s.jumpVy = -0.07;
      sfx.collect?.(); haptic([30]);
      setScoreDisplay(s.sig.score);
      setMoveMsg({ text: '✓ Good!', color: '#86efac' });
    } else {
      s.sig.wobblyMoves++; s.sig.falls++;
      s.sig.streak = 0;
      sfx.fail?.(); hapticFail();
      setMoveMsg({ text: '💥 Too wobbly!', color: '#fca5a5' });
      setTimeout(() => { s.beamAngle = 0; s.beamVelocity = 2; }, 800);
    }

    if (moveMsgTimer.current) clearTimeout(moveMsgTimer.current);
    moveMsgTimer.current = setTimeout(() => setMoveMsg(null), 1200);
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    endCalledRef.current = false;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, perfectMoves: 0, goodMoves: 0, wobblyMoves: 0, falls: 0, maxStreak: 0, streak: 0 };
    s.beamAngle = 0; s.beamVelocity = 2; s.tiltInput = 0; s.wobbleIntensity = 1.0;
    s.gameStartTime = Date.now(); s.tapCooldown = false; s.jumping = false; s.jumpOffset = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('tense');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a0030);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // === POLISH: Scene fog for atmospheric depth ===
    scene.fog = new THREE.Fog(scene.background instanceof THREE.Color ? (scene.background as THREE.Color).getHex() : 0x0a0a1a, 15, 35);
    // === END POLISH ===
    scene.background = new THREE.Color(0x1a0030);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 1, 10);
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const spotlight = new THREE.SpotLight(0xf472b6, 3, 20, Math.PI / 4, 0.5);
    spotlight.position.set(0, 10, 5); spotlight.target.position.set(0, 0, 0);
    scene.add(spotlight); scene.add(spotlight.target);
    const purpleLight = new THREE.PointLight(0x7c3aed, 2, 15);
    purpleLight.position.set(-5, 5, 3);
    scene.add(purpleLight);

    // Arena background sparkles
    const starPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) { starPos[i*3] = (Math.random()-0.5)*20; starPos[i*3+1] = (Math.random()-0.5)*15; starPos[i*3+2] = -3 - Math.random()*10; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xf472b6, size: 0.05, transparent: true, opacity: 0.4 })));

    // Beam
    const beamGroup = new THREE.Group();
    const beamGeo = new THREE.BoxGeometry(5, 0.2, 0.3);
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, emissive: 0xa855f7, emissiveIntensity: 0.4, metalness: 0.4, roughness: 0.4 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beamGroup.add(beam);
    // Support legs
    const legMat = new THREE.MeshStandardMaterial({ color: 0x5b21b6, metalness: 0.5 });
    [-2.4, 2.4].forEach(lx => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.5, 8), legMat);
      leg.position.set(lx, -0.85, 0);
      beamGroup.add(leg);
    });
    beamGroup.position.set(0, -0.5, 0);
    scene.add(beamGroup);

    // Gymnast
    const gymnasGroup = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.7, 10);
    const bodyMat = new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.3, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), bodyMat.clone());
    head.position.y = 0.82;
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), bodyMat.clone());
    armL.rotation.z = Math.PI / 4; armL.position.set(-0.25, 0.45, 0);
    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), bodyMat.clone());
    armR.rotation.z = -Math.PI / 4; armR.position.set(0.25, 0.45, 0);
    gymnasGroup.add(body, head, armL, armR);
    scene.add(gymnasGroup);

    // Balance meter arc (at bottom)
    const meterGeo = new THREE.TorusGeometry(1.2, 0.06, 8, 32, Math.PI);
    const meterMat = new THREE.MeshStandardMaterial({ color: 0xef4444 });
    const meterBase = new THREE.Mesh(meterGeo, meterMat);
    meterBase.position.set(0, -3, 0);
    scene.add(meterBase);
    // Perfect zone
    const perfGeo = new THREE.TorusGeometry(1.2, 0.08, 8, 12, Math.PI * (PERFECT_THRESHOLD / 55));
    const perfMesh = new THREE.Mesh(perfGeo, new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.4 }));
    perfMesh.position.set(0, -3, 0);
    perfMesh.rotation.z = -Math.PI / 2 - Math.PI * (PERFECT_THRESHOLD / 55) / 2;
    scene.add(perfMesh);
    // Needle
    const needleGeo = new THREE.BoxGeometry(0.04, 1.2, 0.04);
    const needle = new THREE.Mesh(needleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    needle.position.set(0, -3, 0.1);
    scene.add(needle);

    const particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }> = [];
    const obj = { renderer, scene, camera, beam, beamGroup, gymnast: gymnasGroup, gymnasHead: head, armL, armR, needle, meterBase, particles, animId: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      sfx.tick?.();
      if (s.timeLeft === 10) sfx.warning?.();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      const elapsed = (Date.now() - s.gameStartTime) / 1000;
      s.wobbleIntensity = 1.0 + elapsed * 0.08;

      // Beam physics
      const tilt = s.tiltInput * 0.8;
      const gravity = 0.18 * s.wobbleIntensity;
      s.beamVelocity += gravity * Math.sin((s.beamAngle * Math.PI) / 180) + tilt * 1.2;
      s.beamVelocity *= 0.92;
      s.beamAngle += s.beamVelocity;
      s.beamAngle = Math.max(-55, Math.min(55, s.beamAngle));

      beamGroup.rotation.z = (s.beamAngle * Math.PI) / 180;

      // Gymnast jump
      if (s.jumping) {
        s.jumpOffset += s.jumpVy;
        s.jumpVy += 0.012;
        if (s.jumpOffset >= 0) { s.jumpOffset = 0; s.jumping = false; s.jumpVy = 0; }
      }
      gymnasGroup.position.set(0, -0.1 + s.jumpOffset, 0);
      gymnasGroup.rotation.z = (s.beamAngle * Math.PI) / 180;

      // Arms spread on jump
      const armSpread = s.jumping ? Math.PI / 2 : Math.PI / 6;
      armL.rotation.z = armSpread * 0.8;
      armR.rotation.z = -armSpread * 0.8;

      // Needle
      const needleAngle = Math.PI + ((s.beamAngle + 55) / 110) * Math.PI;
      needle.rotation.z = needleAngle - Math.PI / 2;

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy;
        p.vy -= 0.004; p.life -= 0.03;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life);
        if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); }
      }

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
    const onTap = (e: PointerEvent) => { e.preventDefault(); performMove(); };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase, performMove]);

  useEffect(() => () => {
    cancelAnimationFrame(threeRef.current?.animId ?? 0);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    tiltRef.current?.stop();
    if (moveMsgTimer.current) clearTimeout(moveMsgTimer.current);
    threeRef.current?.renderer.dispose();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio();
    const ctrl = createTiltController((x, y) => { stateRef.current.tiltInput = x * 0.7 + y * 0.3; }, { sensitivity: 1.0, smoothing: 0.4, deadzone: 1.5, clamp: 25 });
    await ctrl.start(); tiltRef.current = ctrl;
    setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); setPhase('playing'); }, [startLoop]);
  const handlePlayAgain = useCallback(async () => {
    endCalledRef.current = false;
    tiltRef.current?.stop(); tiltRef.current = null;
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
    const ctrl = createTiltController((x, y) => { stateRef.current.tiltInput = x * 0.7 + y * 0.3; }, { sensitivity: 1.0, smoothing: 0.4, deadzone: 1.5, clamp: 25 });
    await ctrl.start(); tiltRef.current = ctrl;
    setPhase('countdown');
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Perfect Moves', value: `${sig.perfectMoves}`, color: '#fde68a' },
    { label: 'Good Moves',    value: `${sig.goodMoves}`,    color: '#86efac' },
    { label: 'Falls',         value: `${sig.falls}`,        color: sig.falls === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Best Streak',   value: `${sig.maxStreak}x`,   color: theme.colors.accent ?? ACCENT },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT} background="linear-gradient(180deg,#1a0030 0%,#0d0018 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Take the Beam →" sensorNote="Tilt gently to steady the beam. Tap when the needle is in the green zone." accentColor={theme.colors.accent ?? ACCENT} ctaTextColor="#000" onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />
              {moveMsg && <div style={{ position: 'absolute', top: '22%', left: '50%', transform: 'translateX(-50%)', fontSize: 26, fontWeight: 900, color: moveMsg.color, textShadow: `0 0 14px ${moveMsg.color}88`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>{moveMsg.text}</div>}
              <div style={{ position: 'absolute', bottom: '14%', left: '50%', transform: 'translateX(-50%)', fontSize: 14, color: 'rgba(255,255,255,0.45)', letterSpacing: 2, textTransform: 'uppercase', pointerEvents: 'none' }}>Tap when green ↑</div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 10} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score, perfectMoves: sig.perfectMoves, falls: sig.falls, maxStreak: sig.maxStreak }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const GymnastBeamGame = dynamic(() => Promise.resolve({ default: GymnastBeamGameInner }), { ssr: false });
export default GymnastBeamGame;
