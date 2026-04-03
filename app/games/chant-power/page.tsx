'use client';
/**
 * CHANT POWER — 3D: mic volume drives a rising crystal energy core.
 * Hold 90%+ for 3 seconds to fully charge. Vibrant purple/violet energy.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Mic } from 'lucide-react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, playVictoryFanfare } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

const GAME_ID   = 'chant-power';
const PB_KEY    = 'mg_pb_chant-power';
const ACCENT    = '#a855f7';
const DURATION  = 45;
const GAME_EMOJI  = '📣';
const GAME_TITLE  = 'Chant Power';
const GAME_TAGLINE = 'Chant loud. Fill the power. Charge the crystal.';
const CHARGE_THRESH = 0.88;
const CHARGE_HOLD   = 3.0;
const IDLE_THRESH   = 0.25;

interface Signals {
  score: number; charges: number; avgVolume: number;
  peakVolume: number; sustainSecs: number;
}
function getPersonality(s: Signals): string {
  if (s.charges >= 3) return 'Crowd Conductor 🎙️';
  if (s.charges >= 2) return 'Power Chanter 💪';
  if (s.charges >= 1) return 'Energy Rising ⚡';
  return 'Finding the Frequency 🌀';
}

interface GS {
  running: boolean; timeLeft: number;
  smoothVol: number; chargeProgress: number;
  charges: number;
  volSum: number; volCount: number; peakVol: number;
  sustainSecs: number;
  flashAlpha: number; accentColor: string;
}
type Phase = 'start'|'permission'|'countdown'|'playing'|'done';

export default function ChantPowerGame() {
  const theme   = useBrandTheme();
  const accent  = theme.colors.accent ?? ACCENT;

  const mountRef     = useRef<HTMLDivElement>(null);
  const rendererRef  = useRef<THREE.WebGLRenderer|null>(null);
  const sceneRef     = useRef<THREE.Scene|null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera|null>(null);
  const crystalRef   = useRef<THREE.Mesh|null>(null);
  const ringRef      = useRef<THREE.Mesh|null>(null);
  const coreRef      = useRef<THREE.Mesh|null>(null);
  const orbsRef      = useRef<THREE.Mesh[]>([]);
  const beamRef      = useRef<THREE.Mesh|null>(null);
  const pointLightRef = useRef<THREE.PointLight|null>(null);
  const rafRef       = useRef(0);

  const timerRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  const stopMusicRef = useRef<(()=>void)|null>(null);
  const audioCtxRef  = useRef<AudioContext|null>(null);
  const analyserRef  = useRef<AnalyserNode|null>(null);
  const micStreamRef = useRef<MediaStream|null>(null);
  const dataArrRef   = useRef<Uint8Array<ArrayBuffer>|null>(null);
  const playerSessionRef = useRef<PlayerSession|null>(null);

  const stateRef = useRef<GS>({
    running:false, timeLeft:DURATION,
    smoothVol:0, chargeProgress:0,
    charges:0,
    volSum:0, volCount:0, peakVol:0, sustainSecs:0,
    flashAlpha:0, accentColor:ACCENT,
  });

  const [phase,      setPhase]      = useState<Phase>('start');
  const [timeLeft,   setTimeLeft]   = useState(DURATION);
  const [scoreDisp,  setScoreDisp]  = useState(0);
  const [chargesDisp,setChargesDisp]= useState(0);
  const [finalSig,   setFinalSig]   = useState<Signals|null>(null);
  const [permError,  setPermError]  = useState('');
  const { pops, triggerPop } = useScorePop();

  useEffect(() => { stateRef.current.accentColor = accent; }, [accent]);

  // ── Three.js setup ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x06000f);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100);
    camera.position.set(0, 0, 7);
    cameraRef.current = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const pLight = new THREE.PointLight(0xa855f7, 3, 15);
    pLight.position.set(0, 1, 3);
    scene.add(pLight);
    pointLightRef.current = pLight;
    const dLight = new THREE.DirectionalLight(0xc084fc, 1);
    dLight.position.set(2, 4, 3);
    scene.add(dLight);

    // Crystal — octahedron
    const crystalGeo = new THREE.OctahedronGeometry(1.0, 0);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7, metalness: 0.4, roughness: 0.2,
      emissive: 0x6d28d9, emissiveIntensity: 0.3,
    });
    const crystal = new THREE.Mesh(crystalGeo, crystalMat);
    scene.add(crystal);
    crystalRef.current = crystal;

    // Inner core glow
    const coreGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xe879f9, emissiveIntensity: 2, roughness: 0.1, metalness: 0,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);
    coreRef.current = core;

    // Ring
    const ringGeo = new THREE.TorusGeometry(1.6, 0.05, 8, 48);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xc084fc, emissive: 0xa855f7, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.3 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);
    ringRef.current = ring;

    // Energy orbs (orbit crystal when charging)
    const orbGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const orbMat = new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0xe879f9, emissiveIntensity: 2 });
    for (let i = 0; i < 8; i++) {
      const orb = new THREE.Mesh(orbGeo, orbMat.clone());
      orb.visible = false;
      scene.add(orb);
      orbsRef.current.push(orb);
    }

    // Charge beam
    const beamGeo = new THREE.CylinderGeometry(0.08, 0.08, 6, 8);
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, emissive: 0xfbbf24, emissiveIntensity: 3, transparent: true, opacity: 0 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 3;
    scene.add(beam);
    beamRef.current = beam;

    // Floating particles background
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      starPos[i*3]   = (Math.random() - 0.5) * 20;
      starPos[i*3+1] = (Math.random() - 0.5) * 20;
      starPos[i*3+2] = (Math.random() - 0.5) * 10 - 5;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xd8b4fe, size: 0.06, sizeAttenuation: true });
    scene.add(new THREE.Points(starGeo, starMat));

    const onResize = () => {
      const W2 = mount.clientWidth || window.innerWidth;
      const H2 = mount.clientHeight || window.innerHeight;
      renderer.setSize(W2, H2);
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const getMicVolume = useCallback(() => {
    if (!analyserRef.current || !dataArrRef.current) return 0;
    analyserRef.current.getByteFrequencyData(dataArrRef.current);
    let sum = 0;
    for (let i = 0; i < dataArrRef.current.length; i++) sum += dataArrRef.current[i] ** 2;
    return Math.min(1, Math.sqrt(sum / dataArrRef.current.length) / 128);
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(()=>{}); audioCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t=>t.stop()); micStreamRef.current = null; }
    sfx.success(); hapticVictory();
    const avg = s.volCount > 0 ? s.volSum / s.volCount : 0;
    const sig: Signals = { score: s.charges * 100 + Math.round(avg * 50), charges: s.charges, avgVolume: avg, peakVolume: s.peakVol, sustainSecs: s.sustainSecs };
    const pb = parseInt(localStorage.getItem(PB_KEY) ?? '0');
    if (sig.score > pb) localStorage.setItem(PB_KEY, String(sig.score));
    setFinalSig(sig); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.smoothVol = 0; s.chargeProgress = 0; s.charges = 0;
    s.volSum = 0; s.volCount = 0; s.peakVol = 0; s.sustainSecs = 0; s.flashAlpha = 0;
    setScoreDisp(0); setChargesDisp(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('pulse');

    timerRef.current = setInterval(() => {
      const s2 = stateRef.current;
      s2.timeLeft--; setTimeLeft(s2.timeLeft);
      if (s2.smoothVol >= CHARGE_THRESH) s2.sustainSecs++;
      if (s2.timeLeft <= 10 && s2.timeLeft > 0) sfx.tick();
      if (s2.timeLeft <= 0) endGame();
    }, 1000);

    let frame = 0;
    const loop = () => {
      if (!s.running) return;
      const renderer = rendererRef.current; const scene = sceneRef.current; const camera = cameraRef.current;
      if (!renderer || !scene || !camera) { rafRef.current = requestAnimationFrame(loop); return; }
      frame++;
      const t = frame * 0.016;

      const rawVol = getMicVolume();
      s.smoothVol = s.smoothVol * 0.85 + rawVol * 0.15;
      const vol = s.smoothVol;
      if (vol > s.peakVol) s.peakVol = vol;
      s.volSum += vol; s.volCount++;

      // Charge progress
      if (vol >= CHARGE_THRESH) {
        s.chargeProgress = Math.min(1, s.chargeProgress + 1 / (CHARGE_HOLD * 60));
      } else if (vol < IDLE_THRESH) {
        s.chargeProgress = Math.max(0, s.chargeProgress - 0.005);
      }

      if (s.chargeProgress >= 1) {
        s.charges++;
        s.chargeProgress = 0;
        sfx.success(); hapticVictory();
        setChargesDisp(s.charges);
        setScoreDisp(s.charges * 100);
        triggerPop('+100', window.innerWidth/2, 100);
        s.flashAlpha = 1;
      }
      s.flashAlpha = Math.max(0, s.flashAlpha - 0.02);

      // Update crystal
      const crystal = crystalRef.current;
      if (crystal) {
        const targetScale = 0.8 + vol * 1.4 + s.chargeProgress * 0.6;
        crystal.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12);
        crystal.rotation.y += 0.01 + vol * 0.03;
        crystal.rotation.x += 0.005;
        const mat = crystal.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.3 + s.chargeProgress * 2 + vol * 0.5;
      }

      // Core
      const core = coreRef.current;
      if (core) {
        const cs = 0.2 + vol * 0.6 + s.chargeProgress * 0.4;
        core.scale.setScalar(cs + Math.sin(t * 8) * 0.05);
        const cmat = core.material as THREE.MeshStandardMaterial;
        cmat.emissiveIntensity = 1 + vol * 3 + s.chargeProgress * 4;
      }

      // Ring
      const ring = ringRef.current;
      if (ring) {
        ring.rotation.z += 0.015 + vol * 0.04;
        ring.rotation.x = Math.PI/2 + Math.sin(t * 0.5) * 0.3;
        const rs = 1 + s.chargeProgress * 0.5;
        ring.scale.setScalar(rs);
        const rmat = ring.material as THREE.MeshStandardMaterial;
        rmat.emissiveIntensity = 0.5 + vol * 2;
      }

      // Orbs
      orbsRef.current.forEach((orb, i) => {
        orb.visible = vol >= CHARGE_THRESH || s.chargeProgress > 0.1;
        if (orb.visible) {
          const angle = t * (2 + i * 0.3) + i * (Math.PI * 2 / 8);
          const r = 1.8 + Math.sin(t * 2 + i) * 0.3;
          orb.position.set(Math.cos(angle) * r, Math.sin(angle * 0.7) * 0.8, Math.sin(angle) * r * 0.6);
          orb.scale.setScalar(0.5 + vol * 0.8);
        }
      });

      // Beam
      const beam = beamRef.current;
      if (beam) {
        const bmat = beam.material as THREE.MeshStandardMaterial;
        const targetOp = s.chargeProgress >= 0.9 ? 0.8 : 0;
        bmat.opacity = bmat.opacity * 0.9 + targetOp * 0.1;
        beam.rotation.y += 0.05;
        beam.scale.set(1 + vol, 1, 1 + vol);
      }

      // Point light
      const pl = pointLightRef.current;
      if (pl) {
        pl.intensity = 2 + vol * 6 + s.chargeProgress * 4;
        pl.color.setHSL(0.77 - s.chargeProgress * 0.1, 1, 0.6);
      }

      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [endGame, getMicVolume, triggerPop]);

  const handlePermission = useCallback(async () => {
    setPermError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;
      dataArrRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      setPhase('countdown');
    } catch { setPermError('Microphone access denied. Please allow mic access.'); }
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    initAudio(); playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar); setPhase('permission');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => {
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(()=>{}); audioCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t=>t.stop()); micStreamRef.current = null; }
    setPhase('start'); setScoreDisp(0); setChargesDisp(0); setTimeLeft(DURATION); setFinalSig(null); setPermError('');
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
    if (audioCtxRef.current) audioCtxRef.current.close().catch(()=>{});
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t=>t.stop());
  }, []);

  const buildInsights = (sig: Signals) => [
    { label:'Charges',      value:String(sig.charges),                      color:sig.charges>=3?'#4ade80':'#facc15' },
    { label:'Peak Volume',  value:`${Math.round(sig.peakVolume*100)}%`,     color:sig.peakVolume>=0.9?'#4ade80':'#f97316' },
    { label:'Sustain Time', value:`${sig.sustainSecs}s`,                    color:accent },
    { label:'Avg Volume',   value:`${Math.round(sig.avgVolume*100)}%`,      color:'var(--color-text)' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Allow Mic & Chant" accentColor={accent} onStart={handleStart} />
      )}
      {phase === 'permission' && (
        <div style={{ position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#06000f',gap:24,padding:'32px 24px' }}>
          <div style={{ width:96,height:96,borderRadius:'50%',background:`rgba(168,85,247,0.12)`,border:`2px solid ${accent}44`,display:'flex',alignItems:'center',justifyContent:'center' }}>
            <Mic size={48} color={accent} />
          </div>
          <div style={{ textAlign:'center',maxWidth:300 }}>
            <div style={{ fontSize:28,fontWeight:800,color:'#fff',marginBottom:12 }}>Mic Access Needed</div>
            <div style={{ fontSize:16,color:'rgba(255,255,255,0.6)',lineHeight:1.6 }}>Chant Power uses your mic to measure your voice power. Stay on device.</div>
          </div>
          {permError && <div style={{ color:'#ef4444',fontSize:14,textAlign:'center',maxWidth:280 }}>{permError}</div>}
          <button onClick={() => { void handlePermission(); }} style={{ background:accent,color:'#000',border:'none',borderRadius:14,padding:'0 48px',height:56,fontSize:18,fontWeight:800,cursor:'pointer',minWidth:240 }}>Allow &amp; Start</button>
          <button onClick={() => setPhase('start')} style={{ background:'transparent',color:'rgba(255,255,255,0.45)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,padding:'10px 24px',fontSize:15,cursor:'pointer' }}>Back</button>
        </div>
      )}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={accent} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position:'absolute',inset:0,width:'100%',height:'100%' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={accent} items={[
                { label:'TIME',    value:timeLeft,     danger:timeLeft<=10 },
                { label:'CHARGES', value:chargesDisp },
              ]} />
              <div style={{ position:'absolute',bottom:80,left:'50%',transform:'translateX(-50%)',
                width:'min(320px,80%)',height:12,borderRadius:6,background:'rgba(255,255,255,0.08)',overflow:'hidden' }}>
                <div style={{ height:'100%',borderRadius:6,background:accent,
                  width:`${stateRef.current.chargeProgress*100}%`,transition:'width 0.1s linear',
                  boxShadow:`0 0 12px ${accent}` }} />
              </div>
              <div style={{ position:'absolute',bottom:60,left:'50%',transform:'translateX(-50%)',
                fontSize:13,color:'rgba(255,255,255,0.5)',fontWeight:600,letterSpacing:'0.1em' }}>
                CHARGE POWER
              </div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={accent}
          onPlayAgain={handlePlayAgain} didWin={finalSig.charges >= 2} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
      {phase === 'playing' && <ScorePopEffect pops={pops} accentColor={accent} />}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: { theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null; }) {
  const fired = useRef(false);
  useEffect(() => { if (fired.current) return; fired.current = true; postWebhook(theme, GAME_ID, { personality, score: sig.score, charges: sig.charges, peakVolume: sig.peakVolume }, player); }, [theme, sig, personality, player]);
  return null;
}
