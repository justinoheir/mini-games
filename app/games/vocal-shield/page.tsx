﻿﻿'use client';
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
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';

const GAME_ID = 'vocal-shield';
const ACCENT = '#818cf8';
const DURATION = 45;
const GAME_EMOJI = '🛡️';
const GAME_TITLE = 'Vocal Shield';
const GAME_TAGLINE = 'Sustain your voice. The shield holds as long as you do.';
const PB_KEY = 'mg_pb_vocal-shield';
const SHIELD_THRESHOLD = 0.2;
const SHIELD_BASE_R = 2.0;
const SHIELD_MAX_BONUS = 1.5;

interface Signals { score: number; blocked: number; passed: number; sustainSeconds: number; peakVolume: number; }
function getPersonality(sig: Signals): string {
  const total = sig.blocked + sig.passed;
  const blockRate = total > 0 ? sig.blocked / total : 0;
  if (blockRate >= 0.85 && sig.sustainSeconds >= 28) return 'Iron Wall 🧱';
  if (sig.blocked >= 18) return 'Shield Master 🛡️';
  if (sig.sustainSeconds >= 32) return 'Voice of Steel 🔊';
  if (blockRate >= 0.65) return 'Defender 🗡️';
  return 'Apprentice ⚔️';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score }, player); }, [theme, sig, personality, player]);
  return null;
}

interface Enemy3D { mesh: THREE.Mesh; x: number; y: number; vx: number; vy: number; speed: number; r: number; color: number; }

function VocalShieldInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    running: false, streak: 0, timeLeft: DURATION, animId: 0,
    intervalId: null as ReturnType<typeof setInterval> | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    sig: { score: 0, blocked: 0, passed: 0, sustainSeconds: 0, sustainFrames: 0, peakVol: 0 },
    shieldPower: 0, shieldR: SHIELD_BASE_R,
    enemies: [] as Enemy3D[],
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    stream: null as MediaStream | null,
    nextEnemyIn: 60, enemyId: 0, lives: 5,
    frame: 0,
    shieldMesh: null as THREE.Mesh | null,
    shieldGlowMesh: null as THREE.Mesh | null,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [micError, setMicError] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const getVolume = useCallback((): number => {
    const s = stateRef.current;
    if (!s.analyser) return 0;
    const data = new Uint8Array(s.analyser.frequencyBinCount);
    s.analyser.getByteFrequencyData(data);
    return data.reduce((a, b) => a + b, 0) / data.length / 255;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(s.animId);
    if (s.intervalId) { clearInterval(s.intervalId); s.intervalId = null; }
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
    sfx.success(); hapticVictory();
    const sig: Signals = {
      score: s.sig.score, blocked: s.sig.blocked, passed: s.sig.passed,
      sustainSeconds: Math.round(s.sig.sustainFrames / 60), peakVolume: s.sig.peakVol,
    };
    try {
      const pb = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (sig.score > pb) { localStorage.setItem(PB_KEY, String(sig.score)); setIsNewBest(true); }
    } catch { }
    setFinalSig(sig); setPhase('done');
  }, []);

  const startLoop = useCallback(async () => {
    const s = stateRef.current;
    // Request mic
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      s.stream = stream; s.analyser = analyser; s.audioCtx = ctx;
    } catch {
      setMicError(true);
    }

    s.running = true; s.timeLeft = DURATION; s.frame = 0;
    s.sig = { score: 0, blocked: 0, passed: 0, sustainSeconds: 0, sustainFrames: 0, peakVol: 0 };
    s.shieldPower = 0; s.shieldR = SHIELD_BASE_R; s.enemies = []; s.nextEnemyIn = 60; s.enemyId = 0; s.lives = 5;
    setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('tense');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    if (mountRef.current) { mountRef.current.innerHTML = ''; mountRef.current.appendChild(renderer.domElement); }
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.03);
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

    scene.add(new THREE.AmbientLight(0x111133, 2));
    const pLight = new THREE.PointLight(0x818cf8, 4, 25);
    pLight.position.set(0, 0, 5);
    scene.add(pLight);
    const enemyLight = new THREE.PointLight(0xef4444, 0, 15);
    scene.add(enemyLight);

    // Stars
    const starCount = 500;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60; starPos[i * 3 + 1] = (Math.random() - 0.5) * 60; starPos[i * 3 + 2] = -20 + (Math.random() - 0.5) * 10;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 })));

    // Shield core (player avatar)
    const coreGeo = new THREE.IcosahedronGeometry(0.4, 1);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x818cf8, emissive: 0x818cf8, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.8 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);

    // Shield sphere
    const shieldGeo = new THREE.SphereGeometry(SHIELD_BASE_R, 24, 24);
    const shieldMat = new THREE.MeshStandardMaterial({ color: 0x818cf8, transparent: true, opacity: 0.15, emissive: 0x818cf8, emissiveIntensity: 0.3, side: THREE.DoubleSide });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    scene.add(shield);
    s.shieldMesh = shield;

    // Shield rings
    const shieldRings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const rGeo = new THREE.TorusGeometry(SHIELD_BASE_R + i * 0.3, 0.05, 8, 32);
      const rMat = new THREE.MeshStandardMaterial({ color: 0x818cf8, emissive: 0x818cf8, emissiveIntensity: 0.4, transparent: true, opacity: 0.25 });
      const r = new THREE.Mesh(rGeo, rMat);
      r.rotation.x = (i / 3) * Math.PI; r.rotation.z = (i / 3) * Math.PI / 2;
      scene.add(r); shieldRings.push(r);
    }

    // Lives display (heart spheres)
    const liveMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const lGeo = new THREE.SphereGeometry(0.18, 8, 8);
      const lMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.5 });
      const lm = new THREE.Mesh(lGeo, lMat);
      lm.position.set(-2.5 + i * 1.2, 5, 0);
      scene.add(lm); liveMeshes.push(lm);
    }

    // Enemy colors
    const ENEMY_COLORS = [0xef4444, 0xf97316, 0xec4899, 0xfbbf24, 0x7c3aed];

    const spawnEnemy = () => {
      const angle = Math.random() * Math.PI * 2;
      const startR = 9;
      const ex = Math.cos(angle) * startR;
      const ey = Math.sin(angle) * startR;
      const speed = 0.04 + Math.random() * 0.03;
      const color = ENEMY_COLORS[Math.floor(Math.random() * ENEMY_COLORS.length)];
      const r = 0.2 + Math.random() * 0.2;
      const geo = new THREE.SphereGeometry(r, 10, 10);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(ex, ey, 0);
      scene.add(mesh);
      const toCenter = Math.sqrt(ex * ex + ey * ey);
      s.enemies.push({ mesh, x: ex, y: ey, vx: -ex / toCenter, vy: -ey / toCenter, speed, r, color });
    };

    s.intervalId = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      s.frame++;
      const diff = (DURATION - s.timeLeft) / DURATION;

      const vol = getVolume();
      if (vol > SHIELD_THRESHOLD) {
        s.shieldPower = Math.min(1, s.shieldPower + 0.05);
        if (vol > s.sig.peakVol) s.sig.peakVol = vol;
        s.sig.sustainFrames++;
      } else {
        s.shieldPower = Math.max(0, s.shieldPower - 0.03);
      }
      const currentShieldR = SHIELD_BASE_R + s.shieldPower * SHIELD_MAX_BONUS;

      // Update shield visuals
      shield.scale.setScalar(currentShieldR / SHIELD_BASE_R);
      (shieldMat as THREE.MeshStandardMaterial).opacity = 0.05 + s.shieldPower * 0.3;
      (shieldMat as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + s.shieldPower * 0.6;
      (shieldMat as THREE.MeshStandardMaterial).color.setHSL(0.65 + s.shieldPower * 0.1, 0.9, 0.6);
      shieldRings.forEach((r, i) => {
        r.rotation.y += 0.01 + i * 0.01;
        r.rotation.z += 0.005 + i * 0.005;
        (r.material as THREE.MeshStandardMaterial).opacity = 0.15 + s.shieldPower * 0.4;
        (r.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + s.shieldPower * 0.5;
      });

      pLight.intensity = 4 + s.shieldPower * 3;
      pLight.color.setHSL(0.65 + s.shieldPower * 0.1, 0.9, 0.6);

      // Pulse core
      core.rotation.x += 0.02; core.rotation.y += 0.03;
      (coreMat as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + s.shieldPower * 0.8;

      // Spawn enemies
      s.nextEnemyIn--;
      if (s.nextEnemyIn <= 0) {
        s.nextEnemyIn = Math.max(20, 60 - diff * 40);
        spawnEnemy();
      }

      // Move enemies
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const en = s.enemies[i];
        en.x += en.vx * en.speed;
        en.y += en.vy * en.speed;
        en.mesh.position.set(en.x, en.y, 0);
        en.mesh.rotation.x += 0.05; en.mesh.rotation.y += 0.05;

        const dist = Math.sqrt(en.x * en.x + en.y * en.y);

        if (dist <= currentShieldR + en.r) {
          // Blocked!
          s.streak=(s.streak||0)+1; setStreak(s.streak);
          const _vs=Math.max(1,Math.floor(s.streak/3)+1);
          s.sig.blocked++; s.sig.score+=_vs;
          setScoreDisplay(s.sig.score);
          sfx.tick(); hapticScore();
          // Bounce back
          en.vx *= -1.5; en.vy *= -1.5;
          (en.mesh.material as THREE.MeshStandardMaterial).color.setHex(0x4ade80);
          setTimeout(() => { scene.remove(en.mesh); }, 300);
          s.enemies.splice(i, 1);
        } else if (dist <= 0.5 + en.r) {
          // Hit the player!
          s.sig.passed++; s.lives--; s.streak=0; setStreak(0);
          liveMeshes[Math.max(0, s.lives)].visible = false;
          sfx.fail(); hapticFail();
          scene.remove(en.mesh);
          s.enemies.splice(i, 1);
          if (s.lives <= 0) endGame();
        } else if (Math.abs(en.x) > 12 || Math.abs(en.y) > 12) {
          scene.remove(en.mesh); s.enemies.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
      s.animId = requestAnimationFrame(loop);
    };
    s.animId = requestAnimationFrame(loop);
  }, [endGame, getVolume]);

  useEffect(() => () => {
    const s = stateRef.current; s.running = false; cancelAnimationFrame(s.animId);
    if (s.intervalId) clearInterval(s.intervalId);
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.audioCtx) s.audioCtx.close().catch(() => {});
    if (stopMusicRef.current) stopMusicRef.current();
    if (s.renderer) { s.renderer.dispose(); s.renderer = null; }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); await initAudio(); setPhase('countdown');
  }, []);
  const handlePlayAgain = useCallback(() => {
    if (stateRef.current.renderer) { stateRef.current.renderer.dispose(); stateRef.current.renderer = null; }
    if (mountRef.current) mountRef.current.innerHTML = '';
    setPhase('start'); setScoreDisplay(0); setStreak(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setMicError(false);
  }, []);

  const accent = theme.colors.accent ?? ACCENT;
  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Activate Shield 🛡️" accentColor={accent} onStart={handleStart} sensorNote="Uses microphone" />}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <div ref={mountRef} role="application" aria-label="Game area - tap to play" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      )}
      {phase === 'playing' && <>
        <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'BLOCKED', value: scoreDisplay }]} />
        {micError && <div style={{ position: 'fixed', bottom: '15%', left: '50%', transform: 'translateX(-50%)', color: '#fbbf24', background: 'rgba(0,0,0,0.7)', padding: '8px 16px', borderRadius: 12, fontSize: 14, zIndex: 50 }}>🎤 No mic — tap to block!</div>}
        <div style={{ position: 'fixed', bottom: '8%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Speak to power the shield 🗣️</div>
      </>}
            {phase === 'playing' && streak >= 3 && (
        <div style={{ position: 'fixed', top: 128, left: '50%', transform: 'translateX(-50%)', zIndex: 25, pointerEvents: 'none', fontSize: 20, fontWeight: 900, color: '#fbbf24', textShadow: '0 0 16px #fbbf2488', letterSpacing: 1, whiteSpace: 'nowrap' }} aria-live="polite" aria-atomic="true">
          ⚡ x{Math.max(1,Math.floor(streak/3)+1)} Streak!
        </div>
      )}
      {phase === 'done' && finalSig && <>
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Blocked', value: String(finalSig.blocked), color: accent }, { label: 'Passed', value: String(finalSig.passed), color: finalSig.passed === 0 ? '#4ade80' : '#ef4444' }, { label: 'Sustained', value: `${finalSig.sustainSeconds}s`, color: '#fbbf24' }, { label: 'Peak Volume', value: `${Math.round(finalSig.peakVolume * 100)}%`, color: '#34d399' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.blocked >= 10} />
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      </>}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const VocalShield = dynamic(() => Promise.resolve({ default: VocalShieldInner }), { ssr: false });
export default VocalShield;
