'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Mic } from 'lucide-react';
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

const GAME_ID   = 'howl-wolf';
const ACCENT    = '#f59e0b';
const DURATION  = 45;
const GAME_EMOJI  = '🐺';
const GAME_TITLE  = 'Howl Wolf';
const GAME_TAGLINE = 'Hit the howl zone. Sustain. Call the pack.';
const BAND_WIDTH   = 0.18;
const BAND_CHANGE_MS = 7000;
const PACK_SIZE    = 4;

interface Signals { score: number; howlTime: number; packCalled: number; avgVolume: number; peakVolume: number; }
function getPersonality(s: Signals): string {
  if (s.packCalled >= 4) return 'Alpha Wolf 🐺';
  if (s.packCalled >= 2) return 'Pack Leader 🌕';
  if (s.howlTime > 8)    return 'Night Howler 🌙';
  return 'Lone Wolf 🏔️';
}
type Phase = 'start' | 'permission' | 'countdown' | 'playing' | 'done';

interface GS {
  running: boolean; timeLeft: number;
  smoothVol: number; bandCenter: number; bandNextChange: number;
  inZone: boolean; howlTime: number; packCalled: number;
  volSum: number; volCount: number; peakVol: number;
  wolfScale: number; mouthOpen: number;
}

function HowlWolfGameInner() {
  const theme   = useBrandTheme();
  const accent  = theme.colors.accent ?? ACCENT;
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const dataArrRef   = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    smoothVol: 0, bandCenter: 0.5, bandNextChange: 0,
    inZone: false, howlTime: 0, packCalled: 0,
    volSum: 0, volCount: 0, peakVol: 0,
    wolfScale: 1, mouthOpen: 0,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    wolves: THREE.Group[]; moon: THREE.Mesh; moonGlow: THREE.Mesh;
    meterBar: THREE.Mesh; bandMesh: THREE.Mesh;
    howlLight: THREE.PointLight; animId: number; frame: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisp, setScoreDisp] = useState(0);
  const [packDisp, setPackDisp] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [permError, setPermError] = useState('');

  const getMicVol = useCallback((): number => {
    const a = analyserRef.current, d = dataArrRef.current;
    if (!a || !d) return 0;
    a.getByteFrequencyData(d);
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    return Math.min(1, Math.sqrt(sum / d.length) / 128);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    const sig: Signals = {
      score: Math.round(s.howlTime * 10) + s.packCalled * 50,
      howlTime: Math.round(s.howlTime), packCalled: s.packCalled,
      avgVolume: s.volCount > 0 ? s.volSum / s.volCount : 0, peakVolume: s.peakVol,
    };
    sfx.success?.(); hapticVictory();
    setFinalSig(sig); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.smoothVol = 0;
    s.bandCenter = 0.5; s.bandNextChange = Date.now() + BAND_CHANGE_MS;
    s.inZone = false; s.howlTime = 0; s.packCalled = 0;
    s.volSum = 0; s.volCount = 0; s.peakVol = 0;
    s.wolfScale = 1; s.mouthOpen = 0;
    setScoreDisp(0); setTimeLeft(DURATION); setPackDisp(0); setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x040810);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040810);
    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 10);

    scene.add(new THREE.AmbientLight(0x111133, 1.5));
    const howlLight = new THREE.PointLight(ACCENT, 0, 15);
    howlLight.position.set(0, 3, 3);
    scene.add(howlLight);
    const moonLight = new THREE.PointLight(0xffe580, 1.2, 20);
    moonLight.position.set(4, 6, 5);
    scene.add(moonLight);

    // Stars
    const starPos = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) { starPos[i*3] = (Math.random()-0.5)*30; starPos[i*3+1] = (Math.random()-0.5)*20; starPos[i*3+2] = -5 - Math.random()*15; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.7 })));

    // Moon
    const moonGeo = new THREE.SphereGeometry(1.0, 20, 20);
    const moonMat = new THREE.MeshStandardMaterial({ color: 0xffe8a0, emissive: 0xffe580, emissiveIntensity: 0.5, roughness: 0.7 });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.position.set(4.5, 4, -2);
    scene.add(moon);
    const moonGlowGeo = new THREE.SphereGeometry(1.4, 20, 20);
    const moonGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe580, transparent: true, opacity: 0.12, side: THREE.BackSide });
    const moonGlow = new THREE.Mesh(moonGlowGeo, moonGlowMat);
    moonGlow.position.set(4.5, 4, -2);
    scene.add(moonGlow);

    // Ground/hills silhouette
    const hillGeo = new THREE.PlaneGeometry(20, 3);
    const hillMat = new THREE.MeshBasicMaterial({ color: 0x060a14 });
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(0, -4, -1); hill.rotation.x = -0.2;
    scene.add(hill);

    // Wolves (silhouettes)
    const wolves: THREE.Group[] = [];
    for (let i = 0; i < PACK_SIZE; i++) {
      const wolfGroup = new THREE.Group();
      const wxPos = -4.5 + i * 3;
      // Body
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshBasicMaterial({ color: 0x1a1a2e }));
      body.scale.set(1.4, 0.85, 0.6); wolfGroup.add(body);
      // Head
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 10), new THREE.MeshBasicMaterial({ color: 0x1a1a2e }));
      head.position.set(-0.6, 0.15, 0); wolfGroup.add(head);
      // Ears
      [{ x: -0.82, y: 0.52 }, { x: -0.55, y: 0.52 }].forEach(ear => {
        const eMesh = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 5), new THREE.MeshBasicMaterial({ color: 0x1a1a2e }));
        eMesh.position.set(ear.x, ear.y, 0); wolfGroup.add(eMesh);
      });
      // Tail
      const tailGeo = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([new THREE.Vector3(0.6, -0.1, 0), new THREE.Vector3(0.9, 0.3, 0), new THREE.Vector3(0.7, 0.7, 0)]), 8, 0.07, 6, false
      );
      const tail = new THREE.Mesh(tailGeo, new THREE.MeshBasicMaterial({ color: 0x1a1a2e }));
      wolfGroup.add(tail);

      wolfGroup.position.set(wxPos, -3.2, 0);
      wolfGroup.scale.setScalar(0.6);
      scene.add(wolfGroup);
      wolves.push(wolfGroup);
    }

    // Volume meter bar (right side)
    const meterBgGeo = new THREE.BoxGeometry(0.5, 5, 0.1);
    const meterBg = new THREE.Mesh(meterBgGeo, new THREE.MeshBasicMaterial({ color: 0x111122 }));
    meterBg.position.set(4.5, 0, 0);
    scene.add(meterBg);
    const meterBarGeo = new THREE.BoxGeometry(0.4, 0.1, 0.15);
    const meterBar = new THREE.Mesh(meterBarGeo, new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.5 }));
    scene.add(meterBar);
    // Band indicator
    const bandMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.12), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.25 }));
    scene.add(bandMesh);

    const obj = { renderer, scene, camera, wolves, moon, moonGlow, meterBar, bandMesh, howlLight, animId: 0, frame: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      sfx.tick?.();
      if (s.timeLeft === 10) sfx.warning?.();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const METER_TOP = 2.5, METER_BOT = -2.5, METER_H = 5;
    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      if (!s.running) return;
      obj.frame++;
      const now = Date.now();
      const vol = getMicVol();
      s.smoothVol = s.smoothVol * 0.82 + vol * 0.18;
      const sv = s.smoothVol;
      s.volSum += sv; s.volCount++;
      if (sv > s.peakVol) s.peakVol = sv;

      if (now >= s.bandNextChange) {
        s.bandCenter = 0.25 + Math.random() * 0.5;
        s.bandNextChange = now + BAND_CHANGE_MS;
        sfx.tick?.();
      }
      const lo = Math.max(0, s.bandCenter - BAND_WIDTH / 2);
      const hi = Math.min(1, s.bandCenter + BAND_WIDTH / 2);
      s.inZone = sv >= lo && sv <= hi;

      if (s.inZone) {
        s.howlTime += 1 / 60;
        s.mouthOpen = Math.min(1, s.mouthOpen + 0.05);
        s.wolfScale = 1 + sv * 0.2;
        const pack = Math.floor(s.howlTime / (DURATION / PACK_SIZE));
        if (pack > s.packCalled && pack <= PACK_SIZE) {
          s.packCalled = pack;
          setPackDisp(s.packCalled); hapticScore(); sfx.collect?.();
        }
        const score = Math.round(s.howlTime * 10) + s.packCalled * 50;
        setScoreDisp(score);
      } else {
        s.mouthOpen = Math.max(0, s.mouthOpen - 0.04);
        s.wolfScale = Math.max(1, s.wolfScale * 0.97);
      }

      // Update meter bar
      const meterY = METER_BOT + sv * METER_H;
      meterBar.position.set(4.5, METER_BOT + sv * METER_H / 2, 0.05);
      meterBar.scale.set(1, Math.max(0.01, sv * METER_H / 0.1), 1);
      (meterBar.material as THREE.MeshStandardMaterial).emissiveIntensity = s.inZone ? 1.2 : 0.5;

      // Band indicator
      const bandCenterY = METER_BOT + s.bandCenter * METER_H;
      const bandH = BAND_WIDTH * METER_H;
      bandMesh.position.set(4.5, bandCenterY, 0.05);
      bandMesh.scale.y = bandH / 0.5;
      (bandMesh.material as THREE.MeshBasicMaterial).opacity = s.inZone ? 0.6 : 0.25;

      // Wolves activation
      wolves.forEach((wolf, i) => {
        const active = i < s.packCalled || (i === s.packCalled && s.inZone);
        const targetScale = active ? s.wolfScale : 0.6;
        wolf.scale.setScalar(wolf.scale.x + (targetScale - wolf.scale.x) * 0.08);
        const wolfMat = wolf.children[0] as THREE.Mesh;
        (wolfMat.material as THREE.MeshBasicMaterial).color.setHex(active ? (s.inZone ? parseInt(ACCENT.replace('#',''), 16) : 0x222244) : 0x1a1a2e);
        // Howl pose - raise head
        wolf.children[1].rotation.z = active && s.inZone ? -0.8 : 0;
      });

      // Moon pulse
      (moon.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + (s.inZone ? 0.4 : 0) + Math.sin(obj.frame * 0.05) * 0.1;
      (moonGlow.material as THREE.MeshBasicMaterial).opacity = 0.08 + (s.inZone ? 0.15 * sv : 0);

      // Howl light
      howlLight.intensity = s.inZone ? 2 + sv * 3 : 0;

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, getMicVol]);

  const handleStart = useCallback((name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio(); sfx.click?.(); setPhase('permission');
  }, []);

  const handlePermission = useCallback(async () => {
    setPermError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;
      const actx = new AudioContext(); audioCtxRef.current = actx;
      const analyser = actx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;
      dataArrRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      actx.createMediaStreamSource(stream).connect(analyser);
      setPhase('countdown');
    } catch { setPermError('Microphone access denied. Please allow mic access and try again.'); }
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    analyserRef.current = null; dataArrRef.current = null;
    setPhase('start'); setScoreDisp(0); setTimeLeft(DURATION); setFinalSig(null); setPackDisp(0);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent} background="radial-gradient(ellipse at 50% 20%,rgba(245,158,11,0.1) 0%,transparent 55%),linear-gradient(180deg,#040810 0%,#06080f 100%)">
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Allow Mic & Howl →" accentColor={accent} onStart={handleStart} sensorNote="🎤 Microphone — howl into your phone" />}
      {phase === 'permission' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#040810', padding: '32px 24px', gap: 24 }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'rgba(245,158,11,0.1)', border: `2px solid ${accent}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Mic size={48} color={accent} /></div>
          <div style={{ textAlign: 'center', maxWidth: 300 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 12 }}>Mic Access Needed</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>Howl Wolf measures your voice volume to find the zone. Your mic data stays on your device.</div>
          </div>
          {permError && <div style={{ color: '#ef4444', fontSize: 14, textAlign: 'center', maxWidth: 280, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', padding: '12px 16px', borderRadius: 10 }}>{permError}</div>}
          <button onClick={() => void handlePermission()} style={{ background: accent, color: '#000', border: 'none', borderRadius: 14, padding: '0 48px', height: 56, fontSize: 18, fontWeight: 800, cursor: 'pointer', minWidth: 240 }}>Allow &amp; Start</button>
          <button onClick={() => setPhase('start')} style={{ background: 'transparent', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 24px', fontSize: 15, cursor: 'pointer' }}>Back</button>
        </div>
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && <GameHUD accentColor={accent} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'PACK', value: packDisp }]} />}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[{ label: 'Pack Called', value: `${finalSig.packCalled}/${PACK_SIZE}`, color: accent }, { label: 'Howl Time', value: `${finalSig.howlTime}s`, color: '#22c55e' }, { label: 'Peak Volume', value: `${Math.round(finalSig.peakVolume*100)}%`, color: '#fbbf24' }, { label: 'Avg Volume', value: `${Math.round(finalSig.avgVolume*100)}%`, color: '#06b6d4' }]}
          accentColor={accent} onPlayAgain={handlePlayAgain} didWin={finalSig.packCalled >= 1} />
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
    postWebhook(theme, GAME_ID, { personality, score: sig.score, howlTime: sig.howlTime, packCalled: sig.packCalled, peakVolume: sig.peakVolume, avgVolume: sig.avgVolume }, player);
  }, [theme, sig, personality, player]);
  return null;
}

import dynamic from 'next/dynamic';
const HowlWolfGame = dynamic(() => Promise.resolve({ default: HowlWolfGameInner }), { ssr: false });
export default HowlWolfGame;
