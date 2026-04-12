'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory, hapticCombo } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'face-memory';
const ACCENT = '#fb7185';
const DURATION = 60;
const GAME_EMOJI = '👤';
const GAME_TITLE = 'Face Memory';
const GAME_TAGLINE = 'Remember who you met. Find them again.';

interface Signals { total: number; hits: number; misses: number; falseAlarms: number; avgReactionMs: number; totalMs: number; maxStudyLoad: number; score: number; maxStreak: number; streakCurrent: number; }
function getPersonality(sig: Signals): string {
  const acc = sig.total > 0 ? sig.hits / sig.total : 0;
  if (acc >= 0.88 && sig.falseAlarms === 0) return 'Face Expert 🎭';
  if (sig.maxStudyLoad >= 5) return 'Social Butterfly 🦋';
  if (acc >= 0.8) return 'Good Memory 🧠';
  if (sig.falseAlarms <= 1) return 'Careful Recognizer 👁️';
  return 'Building Memory 📸';
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';
type SubPhase = 'study' | 'test';

const SKIN_TONES = [0xfdbcb4, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x4a2c1a];
const HAIR_COLORS = [0x1a0a00, 0x4a3728, 0x8b5e3c, 0xd4a017, 0xc0392b, 0x6c3483];
const EYE_COLORS_NUM = [0x3b82f6, 0x22c55e, 0x8b5cf6, 0x6b4226, 0x64748b];

interface Face3D {
  id: number; skinTone: number; hairColor: number; hairStyle: number;
  eyeColor: number; hasGlasses: boolean; hasBeard: boolean; eyebrowThick: boolean;
}

function makeFace(id: number): Face3D {
  return {
    id,
    skinTone: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
    hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    hairStyle: Math.floor(Math.random() * 3),
    eyeColor: EYE_COLORS_NUM[Math.floor(Math.random() * EYE_COLORS_NUM.length)],
    hasGlasses: Math.random() < 0.35,
    hasBeard: Math.random() < 0.3,
    eyebrowThick: Math.random() < 0.4,
  };
}

function buildFaceGroup(face: Face3D): THREE.Group {
  const group = new THREE.Group();
  // Head
  const headGeo = new THREE.SphereGeometry(0.7, 18, 16);
  headGeo.scale(1, 1.1, 0.9);
  const headMesh = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: face.skinTone, roughness: 0.7, metalness: 0.1 }));
  group.add(headMesh);

  // Hair
  const hairMat = new THREE.MeshStandardMaterial({ color: face.hairColor, roughness: 0.8 });
  if (face.hairStyle === 0) {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), hairMat);
    hair.position.y = 0.1;
    group.add(hair);
  } else if (face.hairStyle === 1) {
    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.3, 16, 1, true, 0, Math.PI * 2), hairMat);
    hair.position.y = 0.52;
    group.add(hair);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.5), hairMat);
    top.position.y = 0.52;
    group.add(top);
  } else {
    for (let s = 0; s < 5; s++) {
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.4 + Math.random() * 0.3, 6), hairMat);
      const angle = (s / 5) * Math.PI * 2;
      strand.position.set(Math.cos(angle) * 0.55, 0.6 + Math.random() * 0.1, Math.sin(angle) * 0.4);
      strand.rotation.z = Math.cos(angle) * 0.3;
      group.add(strand);
    }
  }

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: face.eyeColor, roughness: 0.5 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  [[-0.22, 0.12], [0.22, 0.12]].forEach(([ex, ey]) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), eyeMat);
    eye.position.set(ex, ey, 0.63);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), pupilMat);
    pupil.position.set(ex, ey, 0.73);
    group.add(pupil);
  });

  // Eyebrows
  const browThick = face.eyebrowThick ? 0.065 : 0.04;
  const browMat = new THREE.MeshStandardMaterial({ color: face.hairColor });
  [[-0.22, 0.28], [0.22, 0.28]].forEach(([bx, by]) => {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.28, browThick, 0.04), browMat);
    brow.position.set(bx, by, 0.65);
    group.add(brow);
  });

  // Nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshStandardMaterial({ color: face.skinTone, roughness: 0.8 }));
  nose.scale.set(0.7, 1, 0.6);
  nose.position.set(0, 0, 0.72);
  group.add(nose);

  // Mouth
  const mouthGeo = new THREE.TorusGeometry(0.14, 0.03, 6, 16, Math.PI);
  const mouth = new THREE.Mesh(mouthGeo, new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 }));
  mouth.rotation.x = Math.PI / 2;
  mouth.position.set(0, -0.22, 0.65);
  group.add(mouth);

  // Beard
  if (face.hasBeard) {
    const beardGeo = new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.4);
    const beard = new THREE.Mesh(beardGeo, new THREE.MeshStandardMaterial({ color: face.hairColor, roughness: 0.9 }));
    beard.position.set(0, -0.4, 0.3);
    group.add(beard);
  }

  // Glasses
  if (face.hasGlasses) {
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8 });
    [[-0.22, 0.12], [0.22, 0.12]].forEach(([gx, gy]) => {
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 24), glassMat);
      frame.position.set(gx, gy, 0.7);
      group.add(frame);
    });
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 6), glassMat);
    bridge.rotation.z = Math.PI / 2; bridge.position.set(0, 0.12, 0.7);
    group.add(bridge);
  }

  return group;
}

interface GS {
  running: boolean; timeLeft: number; sig: Signals;
  subPhase: SubPhase; studiedFaces: Face3D[]; testFaces: Face3D[];
  studyTime: number; correctFaceId: number;
  roundStart: number; qTimeout: ReturnType<typeof setTimeout> | null;
  nextId: number;
}

function FaceMemoryInner() {
  const theme = useBrandTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<GS>({
    running: false, timeLeft: DURATION,
    sig: { total: 0, hits: 0, misses: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, maxStudyLoad: 0, score: 0, maxStreak: 0, streakCurrent: 0 },
    subPhase: 'study', studiedFaces: [], testFaces: [],
    studyTime: 4000, correctFaceId: -1, roundStart: 0,
    qTimeout: null, nextId: 0,
  });
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
    faceGroups: THREE.Group[]; faceMeta: Array<{ faceId: number; isTarget: boolean }>;
    animId: number; frame: number;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>('start');
  const [subPhase, setSubPhase] = useState<SubPhase>('study');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    if (s.qTimeout) clearTimeout(s.qTimeout);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const showFacesOnScene = useCallback((faces: Face3D[], scene: THREE.Scene, faceGroups: THREE.Group[], faceMeta: Array<{ faceId: number; isTarget: boolean }>, correctId: number) => {
    // Clear existing
    for (const g of faceGroups) scene.remove(g);
    faceGroups.length = 0; faceMeta.length = 0;
    const N = faces.length;
    const spacing = Math.min(2.5, 10 / N);
    const startX = -(N - 1) * spacing / 2;
    faces.forEach((face, i) => {
      const group = buildFaceGroup(face);
      group.position.set(startX + i * spacing, 0, 0);
      group.scale.setScalar(0.85);
      scene.add(group);
      faceGroups.push(group);
      faceMeta.push({ faceId: face.id, isTarget: face.id === correctId });
    });
  }, []);

  const startRound = useCallback(() => {
    const s = stateRef.current;
    const t = threeRef.current; if (!t) return;
    if (!s.running) return;

    // How many study faces
    const studyCount = Math.min(3 + Math.floor(s.sig.hits / 5), 6);
    s.sig.maxStudyLoad = Math.max(s.sig.maxStudyLoad, studyCount);
    const studyFaces = Array.from({ length: studyCount }, (_, i) => makeFace(s.nextId++));
    s.studiedFaces = studyFaces;
    s.correctFaceId = studyFaces[Math.floor(Math.random() * studyFaces.length)].id;
    s.subPhase = 'study';
    setSubPhase('study');
    sfx.collect?.();

    showFacesOnScene(studyFaces, t.scene, t.faceGroups, t.faceMeta, -1);

    // After study time, show test faces
    const studyDur = Math.max(2500, 5000 - s.sig.hits * 100);
    s.qTimeout = setTimeout(() => {
      if (!s.running) return;
      // Create test faces: target + distractors
      const distractorCount = Math.min(2 + Math.floor(s.sig.hits / 3), 4);
      const targetFace = studyFaces.find(f => f.id === s.correctFaceId)!;
      const distractors = Array.from({ length: distractorCount }, (_, i) => makeFace(s.nextId++));
      const testFaces = [...distractors, targetFace].sort(() => Math.random() - 0.5);
      s.testFaces = testFaces;
      s.subPhase = 'test';
      setSubPhase('test');
      s.roundStart = Date.now();
      s.sig.total++;
      showFacesOnScene(testFaces, t.scene, t.faceGroups, t.faceMeta, s.correctFaceId);
      sfx.tick?.();

      // Auto-miss after 5s
      s.qTimeout = setTimeout(() => {
        if (!s.running || s.subPhase !== 'test') return;
        s.sig.misses++; s.sig.streakCurrent = 0;
        sfx.fail?.(); hapticFail();
        setTimeout(() => { if (s.running) startRound(); }, 600);
      }, 5000);
    }, studyDur);
  }, [showFacesOnScene]);

  const startLoop = useCallback(() => {
    const mount = mountRef.current; if (!mount) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { total: 0, hits: 0, misses: 0, falseAlarms: 0, avgReactionMs: 0, totalMs: 0, maxStudyLoad: 0, score: 0, maxStreak: 0, streakCurrent: 0 };
    s.nextId = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setSubPhase('study'); setPhase('playing');

    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0008);
    mount.innerHTML = ''; mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0008);
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 6);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const pinkLight = new THREE.PointLight(0xfb7185, 2, 15);
    pinkLight.position.set(2, 3, 4);
    scene.add(pinkLight);
    const blueLight = new THREE.PointLight(0x818cf8, 1.5, 12);
    blueLight.position.set(-3, -2, 3);
    scene.add(blueLight);

    // Stars
    const starPos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) { starPos[i*3] = (Math.random()-0.5)*20; starPos[i*3+1] = (Math.random()-0.5)*15; starPos[i*3+2] = -5 - Math.random()*10; }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfb7185, size: 0.06, transparent: true, opacity: 0.4 })));

    const faceGroups: THREE.Group[] = [];
    const faceMeta: Array<{ faceId: number; isTarget: boolean }> = [];
    const obj = { renderer, scene, camera, faceGroups, faceMeta, animId: 0, frame: 0 };
    threeRef.current = obj;

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    setTimeout(() => { if (s.running) startRound(); }, 400);

    const animate = () => {
      obj.animId = requestAnimationFrame(animate);
      obj.frame++;
      const t0 = obj.frame * 0.02;
      // Gentle face rotation
      faceGroups.forEach((g, i) => {
        g.rotation.y = Math.sin(t0 * 0.4 + i * 0.8) * 0.08;
        g.position.y = Math.sin(t0 * 0.6 + i * 1.2) * 0.05;
      });
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
  }, [endGame, startRound]);

  useEffect(() => {
    const mount = mountRef.current; if (!mount || phase !== 'playing') return;
    const onTap = (e: PointerEvent) => {
      e.preventDefault();
      const t = threeRef.current; if (!t) return;
      const s = stateRef.current;
      if (!s.running || s.subPhase !== 'test') return;
      const rect = mount.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), t.camera);
      const hits = raycaster.intersectObjects(t.faceGroups, true);
      if (hits.length === 0) return;
      let hitObj = hits[0].object;
      while (hitObj.parent && !t.faceGroups.includes(hitObj as THREE.Group)) hitObj = hitObj.parent;
      const groupIdx = t.faceGroups.indexOf(hitObj as THREE.Group);
      if (groupIdx < 0 || !t.faceMeta[groupIdx]) return;
      const { isTarget } = t.faceMeta[groupIdx];

      if (s.qTimeout) clearTimeout(s.qTimeout);
      s.subPhase = 'study'; // prevent double-tap

      const rt = Date.now() - s.roundStart;
      s.sig.totalMs += rt;

      if (isTarget) {
        s.sig.hits++;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = 3 + Math.floor(s.sig.streakCurrent / 3);
        s.sig.score += pts;
        setScoreDisplay(s.sig.score);
        sfx.success?.(); hapticScore();
        // Glow the correct face
        (hitObj as THREE.Group).scale.setScalar(1.05);
        setTimeout(() => { (hitObj as THREE.Group).scale.setScalar(0.85); }, 300);
      } else {
        s.sig.falseAlarms++;
        s.sig.streakCurrent = 0;
        sfx.fail?.(); hapticFail();
      }

      s.sig.avgReactionMs = s.sig.totalMs / (s.sig.hits + s.sig.falseAlarms + s.sig.misses || 1);
      setTimeout(() => { if (s.running) startRound(); }, 700);
    };
    mount.addEventListener('pointerdown', onTap);
    return () => mount.removeEventListener('pointerdown', onTap);
  }, [phase, startRound]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const s = stateRef.current;
    if (s.qTimeout) clearTimeout(s.qTimeout);
    const t = threeRef.current;
    if (t) { cancelAnimationFrame(t.animId); t.renderer.dispose(); }
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setSubPhase('study'); }, []);
  const buildInsights = (sig: Signals) => [
    { label: 'Recognized', value: String(sig.hits), color: ACCENT },
    { label: 'False IDs', value: String(sig.falseAlarms), color: sig.falseAlarms === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Best Streak', value: `×${sig.maxStreak}`, color: '#fbbf24' },
    { label: 'Max Load', value: String(sig.maxStudyLoad) + ' faces', color: '#818cf8' },
  ];

  const statusMsg = subPhase === 'study' ? '👀 Study these faces...' : '🎯 Find the face you saw!';
  const statusColor = subPhase === 'study' ? 'rgba(255,255,255,0.7)' : ACCENT;

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE} ctaLabel="Start Memorizing 👤" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />}
      {phase === 'countdown' && <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          {phase === 'playing' && (
            <>
              <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
              <div style={{ position: 'absolute', bottom: '12%', left: '50%', transform: 'translateX(-50%)', color: statusColor, fontSize: 18, fontWeight: 800, textAlign: 'center', pointerEvents: 'none', whiteSpace: 'nowrap', textShadow: `0 0 12px ${statusColor}` }}>{statusMsg}</div>
            </>
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI} score={String(finalSig.score)} personality={getPersonality(finalSig)} insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 5} />
      )}
    </GameShell>
  );
}

import dynamic from 'next/dynamic';
const FaceMemory = dynamic(() => Promise.resolve({ default: FaceMemoryInner }), { ssr: false });
export default FaceMemory;
