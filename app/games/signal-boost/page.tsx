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

const GAME_ID = 'signal-boost';
const ACCENT = '#f59e0b';
const DURATION = 45;
const GAME_EMOJI = 'ðŸ“¡';
const GAME_TITLE = 'Signal Boost';
const GAME_TAGLINE = 'Hum steadily to keep the signal alive â€” too quiet or too loud drops the tower.';
const MIN_VOL = 0.15, MAX_VOL = 0.70;

interface Signals { timeInZone: number; maxConsecutive: number; totalDrops: number; avgVolume: number; score: number; }

function getPersonality(sig: Signals): string {
  const ratio = sig.timeInZone / DURATION;
  if (ratio >= 0.85 && sig.totalDrops <= 1) return 'Signal Master ðŸ“¡';
  if (sig.maxConsecutive >= 20) return 'Steady Carrier ðŸ“¶';
  if (ratio >= 0.6) return 'Reliable Relay ðŸ”„';
  if (sig.totalDrops >= 8) return 'Noisy Channel ðŸ“»';
  return 'Weak Signal ðŸ“µ';
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

function SignalBoostGameInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef({
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    towerGroup: null as THREE.Group | null,
    signalRings: [] as { mesh: THREE.Mesh; phase: number; speed: number }[],
    towerLight: null as THREE.PointLight | null,
    volumeBar: null as THREE.Mesh | null,
    healthBar: null as THREE.Mesh | null,
    running: false, timeLeft: DURATION,
    sig: { timeInZone: 0, maxConsecutive: 0, totalDrops: 0, avgVolume: 0, score: 0 } as Signals,
    volume: 0, smoothVolume: 0, inZone: false, consecutiveTicks: 0,
    towerHealth: 1, wavePhase: 0,
    analyser: null as AnalyserNode | null,
    micStream: null as MediaStream | null,
    dataArray: null as Uint8Array | null,
  });

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [pbBeaten, setPbBeaten] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stopMic = useCallback(() => {
    const s = stateRef.current;
    if (s.micStream) { s.micStream.getTracks().forEach(t => t.stop()); s.micStream = null; }
    s.analyser = null; s.dataArray = null;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    stopMic();
    (stateRef.current as any)._micFallbackCleanup?.();
        const _pbKey = 'pb_signal-boost';
    const _finalScore = stateRef.current.sig.score;
    const _prevPb = parseInt(typeof window !== 'undefined' ? localStorage.getItem(_pbKey) ?? '0' : '0', 10);
    if (_finalScore > _prevPb) { if (typeof window !== 'undefined') localStorage.setItem(_pbKey, String(_finalScore)); setPbBeaten(true); }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, [stopMic]);

  const startLoop = useCallback(async () => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { timeInZone: 0, maxConsecutive: 0, totalDrops: 0, avgVolume: 0, score: 0 };
    s.towerHealth = 1; s.wavePhase = 0;
    s.consecutiveTicks = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('ambient');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d0800);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0d0800, 20, 50);
    s.scene = scene;
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 2, 8);
    // === POLISH: Atmospheric particle field ===
    const _sfCount = 80;
    const _sfGeo = new THREE.BufferGeometry();
    const _sfPos = new Float32Array(_sfCount * 3);
    for (let _i = 0; _i < _sfCount; _i++) {
      _sfPos[_i*3] = (Math.random()-0.5)*20;
      _sfPos[_i*3+1] = (Math.random()-0.5)*15;
      _sfPos[_i*3+2] = (Math.random()-0.5)*8-3;
    }
    _sfGeo.setAttribute('position', new THREE.BufferAttribute(_sfPos, 3));
    scene.add(new THREE.Points(_sfGeo, new THREE.PointsMaterial({ color: 0xaaddff, size: 0.05, transparent: true, opacity: 0.4 })));
    // === END POLISH ===
    // === POLISH: Enhanced rim + fill lighting ===
    const rimLightA = new THREE.PointLight(0x4466ff, 1.2, 20);
    rimLightA.position.set(-6, 5, 3);
    scene.add(rimLightA);
    const fillLightB = new THREE.PointLight(0xff6644, 0.8, 15);
    fillLightB.position.set(6, -3, 5);
    scene.add(fillLightB);
    // === END POLISH ===
    camera.lookAt(0, 1, 0);
    s.camera = camera;

    scene.add(new THREE.AmbientLight(0x1a1000, 3));
    const towerLight = new THREE.PointLight(0xf59e0b, 2, 20);
    towerLight.position.set(0, 5, 0);
    scene.add(towerLight);
    s.towerLight = towerLight;

    // Ground
    const groundGeo = new THREE.PlaneGeometry(20, 20, 10, 10);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1000, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    scene.add(ground);

    // Tower structure
    const towerGroup = new THREE.Group();
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.2, metalness: 0.8 });

    // Tower legs (4 diagonal struts)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const legGeo = new THREE.CylinderGeometry(0.04, 0.1, 4.5, 4);
      const leg = new THREE.Mesh(legGeo, towerMat.clone());
      leg.position.set(Math.cos(angle) * 0.5, 1.5, Math.sin(angle) * 0.5);
      leg.rotation.z = Math.cos(angle) * 0.2;
      leg.rotation.x = Math.sin(angle) * 0.2;
      towerGroup.add(leg);
    }
    // Cross braces
    for (let y = 0.5; y < 3.5; y += 0.8) {
      const braceGeo = new THREE.TorusGeometry(0.5, 0.03, 4, 8);
      const brace = new THREE.Mesh(braceGeo, towerMat.clone());
      brace.position.y = y;
      brace.rotation.x = Math.PI / 2;
      towerGroup.add(brace);
    }
    // Antenna spire
    const spireGeo = new THREE.CylinderGeometry(0.02, 0.04, 1.5, 6);
    const spire = new THREE.Mesh(spireGeo, towerMat.clone());
    spire.position.y = 4.25;
    towerGroup.add(spire);
    // Antenna top sphere
    const topGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1 }));
    top.position.y = 5.0;
    towerGroup.add(top);
    towerGroup.position.set(0, -0.5, -1);
    scene.add(towerGroup);
    s.towerGroup = towerGroup;

    // Signal rings (torus geometry)
    const signalRings: { mesh: THREE.Mesh; phase: number; speed: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const ringGeo = new THREE.TorusGeometry(0.3, 0.05, 6, 24);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.8, transparent: true, opacity: 0 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(0, 4.5, -1);
      ring.rotation.x = Math.PI / 2;
      scene.add(ring);
      signalRings.push({ mesh: ring, phase: i * 0.25, speed: 0.008 });
    }
    s.signalRings = signalRings;

    // Volume meter bar (UI element in 3D space)
    const volBarBg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.1), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    volBarBg.position.set(-3.5, 1, 0);
    scene.add(volBarBg);
    const volBar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.15), new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 0.5 }));
    volBar.position.set(-3.5, -0.9, 0.05);
    scene.add(volBar);
    s.volumeBar = volBar;

    // Health bar
    const healthBg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.1), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    healthBg.position.set(3.5, 1, 0);
    scene.add(healthBg);
    const healthBar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.15), new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5 }));
    healthBar.position.set(3.5, -0.9, 0.05);
    scene.add(healthBar);
    s.healthBar = healthBar;

    // Setup mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.micStream = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; source.connect(analyser);
      s.analyser = analyser;
      s.dataArray = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // Mic denied - add touch/hold fallback: hold screen to simulate voice signal
      (s as any)._touchActive = false;
      const onTouchDown = () => { (s as any)._touchActive = true; };
      const onTouchUp = () => { (s as any)._touchActive = false; };
      mount.addEventListener('pointerdown', onTouchDown);
      mount.addEventListener('pointerup', onTouchUp);
      mount.addEventListener('pointercancel', onTouchUp);
      (s as any)._micFallbackCleanup = () => {
        mount.removeEventListener('pointerdown', onTouchDown);
        mount.removeEventListener('pointerup', onTouchUp);
        mount.removeEventListener('pointercancel', onTouchUp);
      };
    }

    const handleResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    (s as any)._cleanup = () => window.removeEventListener('resize', handleResize);

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.inZone) {
        s.sig.timeInZone++; s.consecutiveTicks++;
        if (s.consecutiveTicks > s.sig.maxConsecutive) s.sig.maxConsecutive = s.consecutiveTicks;
        s.sig.score += 2; setScoreDisplay(s.sig.score);
        haptic([30]);
      } else {
        s.consecutiveTicks = 0;
        if (s.towerHealth < 0.3) { sfx.collision(); haptic([20, 30, 20]); }
      }
      if (s.timeLeft <= 0) { sfx.fail(); haptic([300]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const t = Date.now() * 0.001;

      // Read mic (or touch fallback)
      if (s.analyser && s.dataArray) {
        s.analyser.getByteFrequencyData(s.dataArray as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < s.dataArray.length; i++) sum += s.dataArray[i];
        s.volume = sum / (s.dataArray.length * 255);
      } else if ((s as any)._touchActive !== undefined) {
        // Touch fallback: holding screen = mid-range signal
        s.volume = (s as any)._touchActive ? 0.40 : 0;
      }
      s.smoothVolume += (s.volume - s.smoothVolume) * 0.15;
      const vol = s.smoothVolume;
      s.inZone = vol >= MIN_VOL && vol <= MAX_VOL;

      // Tower health
      if (s.inZone) {
        s.towerHealth = Math.min(1, s.towerHealth + 0.008);
      } else if (vol < MIN_VOL * 0.5 || vol > MAX_VOL * 1.3) {
        const prev = s.towerHealth;
        s.towerHealth = Math.max(0, s.towerHealth - 0.012);
        if (Math.floor(prev * 10) > Math.floor(s.towerHealth * 10)) s.sig.totalDrops++;
      } else {
        s.towerHealth = Math.max(0, s.towerHealth - 0.004);
      }

      // Tower color based on health
      const healthColor = s.towerHealth > 0.6 ? 0xf59e0b : s.towerHealth > 0.3 ? 0xfbbf24 : 0xef4444;
      towerGroup.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.color.setHex(healthColor);
          mat.emissive.setHex(s.inZone ? healthColor : 0x000000);
          mat.emissiveIntensity = s.inZone ? 0.3 + Math.sin(t * 8) * 0.1 : 0.05;
        }
      });

      // Signal rings
      signalRings.forEach(r => {
        if (s.inZone) {
          r.phase = (r.phase + r.speed * (1 + vol * 3)) % 1;
          const scale = 1 + r.phase * 6;
          r.mesh.scale.setScalar(scale);
          const mat = r.mesh.material as THREE.MeshStandardMaterial;
          mat.opacity = (1 - r.phase) * s.towerHealth * 0.7;
          mat.color.setHex(healthColor);
          mat.emissive.setHex(healthColor);
        } else {
          const mat = r.mesh.material as THREE.MeshStandardMaterial;
          mat.opacity = Math.max(0, (mat.opacity as number) - 0.02);
        }
      });

      // Volume bar
      if (s.volumeBar) {
        const barH = Math.max(0.1, vol * 4);
        s.volumeBar.scale.y = barH * 10;
        s.volumeBar.position.y = -0.9 + barH * 5;
        const barColor = s.inZone ? 0x4ade80 : vol < MIN_VOL ? 0xef4444 : 0xf97316;
        (s.volumeBar.material as THREE.MeshStandardMaterial).color.setHex(barColor);
        (s.volumeBar.material as THREE.MeshStandardMaterial).emissive.setHex(barColor);
      }
      if (s.healthBar) {
        const hh = Math.max(0.1, s.towerHealth * 4);
        s.healthBar.scale.y = hh * 10;
        s.healthBar.position.y = -0.9 + hh * 5;
        (s.healthBar.material as THREE.MeshStandardMaterial).color.setHex(healthColor);
      }

      // Tower light pulse
      towerLight.intensity = s.inZone ? 3 + Math.sin(t * 5) * 1 : 0.5;
      towerLight.color.setHex(healthColor);

      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, stopMic]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    const s = stateRef.current;
    if (s.renderer) s.renderer.dispose();
    stopMic();
    (s as any)._cleanup?.();
  }, [stopMic]);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Start" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={() => startLoop()} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} aria-label="Game area. Use touch or pointer to interact." role="application" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && (<>
        <div aria-live="polite" style={{position:'absolute',left:'-9999px',width:'1px',height:'1px',overflow:'hidden'}}>Score: {scoreDisplay}</div>
          <GameHUD accentColor={accent} items={[
          { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
          { label: 'SCORE', value: scoreDisplay },
        ]} /></>
      )}
      {phase === 'done' && finalSig && (
        <>
          <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
            score={String(finalSig.score)} personality={getPersonality(finalSig)}
            insights={[
              { label: 'In Zone', value: `${Math.round((finalSig.timeInZone / DURATION) * 100)}%`, color: '#4ade80' },
              { label: 'Best Run', value: `${finalSig.maxConsecutive}s`, color: accent },
              { label: 'Drops', value: `${finalSig.totalDrops}`, color: finalSig.totalDrops <= 2 ? '#4ade80' : '#ef4444' },
              { label: 'Signal Time', value: `${finalSig.timeInZone}s`, color: 'var(--color-text)' },
            ]}
            accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.timeInZone >= 30} />
          <WebhookHelper theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
        </>
      )}
      {phase === 'done' && pbBeaten && (
        <div style={{position:'fixed',top:'16px',left:'50%',transform:'translateX(-50%)',background:'#fbbf24',color:'#000',padding:'8px 20px',borderRadius:'999px',fontWeight:700,fontSize:'1rem',zIndex:9999,boxShadow:'0 4px 12px rgba(0,0,0,0.3)',animation:'none'}}>ðŸ† New Personal Best!</div>
      )}
    </GameShell>
  );
}

function WebhookHelper({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, timeInZone: sig.timeInZone, maxConsecutive: sig.maxConsecutive, totalDrops: sig.totalDrops }, player); }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const SignalBoostGame = dynamic(() => Promise.resolve({ default: SignalBoostGameInner }), { ssr: false });
export default SignalBoostGame;


