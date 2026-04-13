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

const GAME_ID      = 'echo-clap';
const ACCENT       = '#ef4444';
const DURATION     = 45;
const GAME_EMOJI   = '👏';
const GAME_TITLE   = 'Echo Clap';
const GAME_TAGLINE = 'Clap in time with the echo pattern!';
const MIC_THRESHOLD = 0.15;
const CLAP_COOLDOWN = 200;

interface Signals { totalCues: number; clapsOnTime: number; clapsLate: number; roundsCompleted: number; score: number; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.totalCues > 0 ? sig.clapsOnTime / sig.totalCues : 0;
  if (acc >= 0.80 && sig.roundsCompleted >= 4) return 'Echo Master 👏';
  if (acc >= 0.70) return 'Rhythm Clapper 🎵';
  if (sig.roundsCompleted >= 5) return 'Speed Demon ⚡';
  if (sig.maxStreak >= 6) return 'Streak Keeper 🔥';
  return 'Off-Tempo Tapper 🎲';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface ClapTarget { time: number; hit: boolean; }

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  clapTargets: ClapTarget[]; currentRound: number; roundBPM: number;
  roundActive: boolean; lastClapTime: number; micLevel: number;
  patternLength: number;
}

function EchoClapGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const micRef = useRef<{ stream: MediaStream; analyser: AnalyserNode; data: Uint8Array } | null>(null);
  const patternTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { totalCues: 0, clapsOnTime: 0, clapsLate: 0, roundsCompleted: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    clapTargets: [], currentRound: 1, roundBPM: 60, roundActive: false,
    lastClapTime: 0, micLevel: 0, patternLength: 4,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    beatRings: Array<{ mesh: THREE.Mesh; light: THREE.PointLight; scale: number; alpha: number; active: boolean }>;
    clapRipples: Array<{ mesh: THREE.Mesh; scale: number; alpha: number; color: number }>;
    clapSphere: THREE.Mesh; clapLight: THREE.PointLight;
    particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }>;
    animId: number; frame: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [roundDisplay, setRoundDisplay] = useState(1);
  const [isListening, setIsListening] = useState(false);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const schedulePattern = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || cancelledRef.current) return;
    const intervalMs = (60 / s.roundBPM) * 1000;
    s.clapTargets = [];
    const now = Date.now();
    // Echo cues
    for (let i = 0; i < s.patternLength; i++) {
      setTimeout(() => {
        if (cancelledRef.current) return;
        sfx.collect?.(); haptic([20]);
        // Visual beat pulse
        const t = threeRef.current;
        if (t && t.beatRings[i % t.beatRings.length]) {
          t.beatRings[i % t.beatRings.length].active = true;
        }
      }, i * intervalMs * 0.5);
    }
    // User targets
    const startDelay = s.patternLength * intervalMs * 0.5 + 800;
    for (let i = 0; i < s.patternLength; i++) {
      const targetTime = now + startDelay + i * intervalMs;
      s.clapTargets.push({ time: targetTime, hit: false });
      s.sig.totalCues++;
      // Show upcoming beat ring
      setTimeout(() => {
        if (cancelledRef.current) return;
        setIsListening(true);
        const t = threeRef.current;
        if (t && i < t.beatRings.length) {
          const ring = t.beatRings[i];
          ring.active = true;
          ring.scale = 0.5;
          ring.alpha = 1.0;
        }
      }, startDelay + i * intervalMs - 300);
    }
    s.roundActive = true;
    patternTimerRef.current = setTimeout(() => {
      if (cancelledRef.current || !s.running) return;
      const missed = s.clapTargets.filter(t => !t.hit).length;
      if (missed === 0) {
        s.sig.roundsCompleted++;
        s.currentRound++;
        s.roundBPM = Math.min(160, 60 + s.currentRound * 10);
        s.patternLength = Math.min(8, 4 + Math.floor(s.currentRound / 2));
        setRoundDisplay(s.currentRound);
        sfx.collect?.(); haptic([30, 20, 30]);
      }
      s.roundActive = false;
      setIsListening(false);
      setTimeout(() => { if (s.running && !cancelledRef.current) schedulePattern(); }, 1000);
    }, startDelay + s.patternLength * intervalMs + 500);
  }, []);

  const processClap = useCallback(() => {
    const s = stateRef.current;
    const now = Date.now();
    if (now - s.lastClapTime < CLAP_COOLDOWN) return;
    s.lastClapTime = now;

    // Clap visual ripple
    const t = threeRef.current;
    if (t) {
      t.clapRipples.push({ mesh: new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(ACCENT).getHex(), transparent: true, opacity: 0.9, side: THREE.DoubleSide })), scale: 0.5, alpha: 0.9, color: 0x00e5ff });
      const lastRipple = t.clapRipples[t.clapRipples.length - 1];
      t.scene.add(lastRipple.mesh);
      t.clapLight.intensity = 3;
      setTimeout(() => { t.clapLight.intensity = 0; }, 150);
    }

    const windowMs = 300;
    let bestTarget: ClapTarget | null = null;
    let bestDiff = Infinity;
    for (const ct of s.clapTargets) {
      if (ct.hit) continue;
      const diff = Math.abs(now - ct.time);
      if (diff < windowMs && diff < bestDiff) { bestDiff = diff; bestTarget = ct; }
    }
    if (bestTarget) {
      bestTarget.hit = true;
      s.sig.clapsOnTime++;
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
      const pts = s.sig.streakCurrent >= 3 ? 3 : 2;
      s.sig.score += pts;
      setScoreDisplay(s.sig.score);
      sfx.collect?.(); haptic([30]);
    } else {
      s.sig.clapsLate++;
      s.sig.streakCurrent = 0;
      sfx.collision?.(); haptic([20, 30, 20]);
    }
  }, []);

  const endGame = useCallback(() => {
    cancelledRef.current = true;
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (patternTimerRef.current) { clearTimeout(patternTimerRef.current); patternTimerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (micRef.current) { micRef.current.stream.getTracks().forEach(t => t.stop()); micRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
        const _pbKey = 'pb_echo-clap';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(async () => {
    const mount = mountRef.current; if (!mount) return;
    cancelledRef.current = false;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalCues: 0, clapsOnTime: 0, clapsLate: 0, roundsCompleted: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.clapTargets = []; s.currentRound = 1; s.roundBPM = 60; s.patternLength = 4;
    setScoreDisplay(0); setTimeLeft(DURATION); setRoundDisplay(1); setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

    // Try mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const analyser = ac.createAnalyser(); analyser.fftSize = 256;
      ac.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      micRef.current = { stream, analyser, data };
    } catch { /* fallback to tap */ }

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0010);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0010);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);

    scene.add(new THREE.AmbientLight(0x220022, 1.5));
    const clapLight = new THREE.PointLight(ACCENT, 0, 10);
    clapLight.position.set(0, 0, 2);
    scene.add(clapLight);

    // Stars
    const starPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) { starPos[i*3] = (Math.random()-0.5)*25; starPos[i*3+1] = (Math.random()-0.5)*20; starPos[i*3+2] = -5 - Math.random()*15; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xef4444, size: 0.06, transparent: true, opacity: 0.5 })));

    // Central clap sphere
    const clapSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 20, 20),
      new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.4 })
    );
    scene.add(clapSphere);

    // Beat indicator rings (4 rings for pattern)
    const beatRings: Array<{ mesh: THREE.Mesh; light: THREE.PointLight; scale: number; alpha: number; active: boolean }> = [];
    const ringColors = [0xef4444, 0xf97316, 0xfbbf24, 0xa855f7, 0x06b6d4, 0x22c55e, 0x3b82f6, 0xec4899];
    for (let i = 0; i < 8; i++) {
      const r = 1.2 + i * 0.5;
      const rMesh = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 8, 48), new THREE.MeshStandardMaterial({ color: ringColors[i], emissive: ringColors[i], emissiveIntensity: 0.4, transparent: true, opacity: 0.0 }));
      scene.add(rMesh);
      const rLight = new THREE.PointLight(ringColors[i], 0, 8);
      scene.add(rLight);
      beatRings.push({ mesh: rMesh, light: rLight, scale: 1.0, alpha: 0, active: false });
    }

    const clapRipples: Array<{ mesh: THREE.Mesh; scale: number; alpha: number; color: number }> = [];
    const particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }> = [];
    const obj = { renderer, scene, camera, beatRings, clapRipples, clapSphere, clapLight, particles, animId: 0, frame: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    setTimeout(() => { if (s.running && !cancelledRef.current) schedulePattern(); }, 500);

    // Mic volume monitoring
    let lastMicSample = 0;
    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      obj.frame++;
      const t0 = obj.frame * 0.02;

      // Check mic volume
      if (micRef.current) {
        const { analyser, data } = micRef.current;
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        let rms = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; rms += v * v; }
        rms = Math.sqrt(rms / data.length);
        if (rms > MIC_THRESHOLD && Date.now() - lastMicSample > CLAP_COOLDOWN) {
          lastMicSample = Date.now();
          processClap();
        }
        (clapSphere.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + rms * 2;
      }

      // Sphere pulse
      const sphereScale = 1 + Math.sin(t0 * 3) * 0.04;
      clapSphere.scale.setScalar(sphereScale);
      clapSphere.rotation.y = t0 * 0.5;

      // Beat rings
      beatRings.forEach((ring, i) => {
        if (ring.active) {
          ring.scale += 0.08;
          ring.alpha = Math.max(0, ring.alpha - 0.025);
          ring.mesh.scale.setScalar(ring.scale);
          (ring.mesh.material as THREE.MeshStandardMaterial).opacity = ring.alpha;
          ring.light.intensity = ring.alpha * 3;
          if (ring.alpha <= 0) { ring.active = false; ring.scale = 1.0; }
        }
      });

      // Clap ripples
      for (let i = clapRipples.length - 1; i >= 0; i--) {
        const r = clapRipples[i];
        r.scale += 0.12; r.alpha -= 0.04;
        r.mesh.scale.setScalar(r.scale);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.alpha);
        if (r.alpha <= 0) { scene.remove(r.mesh); clapRipples.splice(i, 1); }
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, schedulePattern, processClap]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTap = (e: PointerEvent) => { e.preventDefault(); processClap(); };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase, processClap]);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (patternTimerRef.current) clearTimeout(patternTimerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (micRef.current) micRef.current.stream.getTracks().forEach(t => t.stop());
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { void startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setRoundDisplay(1); }, []);
  const buildInsights = (sig: Signals) => [
    { label: 'On Time', value: String(sig.clapsOnTime), color: '#4ade80' },
    { label: 'Rounds Done', value: String(sig.roundsCompleted), color: ACCENT },
    { label: 'Best Streak', value: `×${sig.maxStreak}`, color: '#fbbf24' },
    { label: 'Off Beat', value: String(sig.clapsLate), color: '#ef4444' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Clapping 👏" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} sensorNote="Clap to match the beat — or tap the screen" />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }, { label: 'ROUND', value: roundDisplay }]} />
              {isListening && <div style={{ position: 'absolute', bottom: '15%', left: '50%', transform: 'translateX(-50%)', fontSize: 20, fontWeight: 800, color: '#ef4444', textShadow: '0 0 20px #ef4444', pointerEvents: 'none', whiteSpace: 'nowrap' }}>👏 Now clap!</div>}
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.roundsCompleted >= 3} />
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score, clapsOnTime: sig.clapsOnTime, roundsCompleted: sig.roundsCompleted, maxStreak: sig.maxStreak }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const EchoClapGame = dynamic(() => Promise.resolve({ default: EchoClapGameInner }), { ssr: false });
export default EchoClapGame;
