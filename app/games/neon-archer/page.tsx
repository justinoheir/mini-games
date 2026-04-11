'use client';
/**
 * NEON ARCHER — Crossbow range with glowing moving targets.
 * Pull back the bowstring and release to fire.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { hapticScore, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID = 'neon-archer';
const ACCENT = '#00ffcc';
const DURATION = 60;
const GAME_EMOJI = '🏹';
const GAME_TITLE = 'Neon Archer';
const GAME_TAGLINE = 'Pull back the bowstring, aim, and release to hit glowing targets.';

// Crossbow anchor — nock sits here at rest
const NOCK_REST   = new THREE.Vector3(0,  1.2, 6.8);
const PROD_LEFT   = new THREE.Vector3(-1.3, 1.2, 6.2);
const PROD_RIGHT  = new THREE.Vector3( 1.3, 1.2, 6.2);
const STOCK_TIP   = new THREE.Vector3(0,  1.2, 5.8); // muzzle end
const STOCK_BUTT  = new THREE.Vector3(0,  1.1, 8.2); // grip end (toward player)

interface Signals {
  totalShots: number; hits: number; perfectShots: number;
  maxStreak: number; streakCurrent: number; score: number;
}
function getPersonality(sig: Signals): string {
  const acc = sig.totalShots > 0 ? sig.hits / sig.totalShots : 0;
  if (sig.perfectShots >= 5 && acc >= 0.7) return 'Sniper 🎯';
  if (sig.maxStreak >= 5)                  return 'Hot Streak 🔥';
  if (acc >= 0.6 && sig.totalShots >= 10)  return 'Steady Aim 🏹';
  if (sig.totalShots >= 15 && acc < 0.4)   return 'Wild Shot 💨';
  return 'Beginner Archer 🌱';
}

interface TargetObj { group: THREE.Group; x: number; y: number; vx: number; vy: number; radius: number; }
interface ArrowObj  { mesh: THREE.Group; vx: number; vy: number; vz: number; active: boolean; }
interface DrawState {
  active: boolean;
  startX: number; startY: number;
  currentX: number; currentY: number;
  pullPower: number;         // 0–1
  boltMesh: THREE.Group | null;
  stringLine: THREE.Line | null;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ── Crossbow bolt (shorter, stubbier than a regular arrow) ─────────────────
function makeBolt(): THREE.Group {
  const g = new THREE.Group();

  // Shaft — wooden, short
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.9, 6),
    new THREE.MeshPhongMaterial({ color: 0xb5651d, emissive: 0x5c2f0a }),
  );
  shaft.rotation.x = Math.PI / 2; // point along -Z
  g.add(shaft);

  // Neon tip
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.065, 0.28, 6),
    new THREE.MeshPhongMaterial({ color: 0x00ffcc, emissive: 0x00bb99 }),
  );
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.59;
  g.add(tip);

  // Fletching (two flat fins, rotated 90°)
  const fletchMat = new THREE.MeshBasicMaterial({ color: 0xff3366, side: THREE.DoubleSide });
  for (let i = 0; i < 2; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.22), fletchMat);
    f.rotation.y = i * Math.PI / 2;
    f.position.z = 0.38;
    g.add(f);
  }

  return g;
}

// ── Full crossbow body (stock + prod + sight) ──────────────────────────────
function buildCrossbow(scene: THREE.Scene): THREE.Group {
  const xbow = new THREE.Group();

  // --- Stock (main wooden body, runs along Z) ---
  const stockMat = new THREE.MeshPhongMaterial({ color: 0x5c3317, emissive: 0x2a1505, shininess: 40 });

  // Tiller — main flat stock beam
  const tiller = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 2.4), stockMat);
  tiller.position.set(0, 1.2, 7.0);
  xbow.add(tiller);

  // Pistol grip — angled block at the butt
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.30, 0.18), stockMat);
  grip.position.set(0, 1.05, 8.0);
  grip.rotation.x = 0.25;
  xbow.add(grip);

  // Cheek piece (raised ridge on top of stock)
  const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.9), stockMat);
  cheek.position.set(0, 1.28, 7.4);
  xbow.add(cheek);

  // Barrel channel — thin groove on top for the bolt to sit in
  const grooveMat = new THREE.MeshPhongMaterial({ color: 0x3a1f08, emissive: 0x0a0500 });
  const groove = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, 1.6), grooveMat);
  groove.position.set(0, 1.255, 6.7);
  xbow.add(groove);

  // --- Prod / Limb (horizontal curved bow) ---
  // Build as a thick curved arc from left to right using a tube
  const prodPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = -1.3 + t * 2.6;
    const z = 6.2 - Math.sin(t * Math.PI) * 0.22; // gentle arc toward player
    const y = 1.2 + Math.sin(t * Math.PI) * 0.04;  // very slight vertical bow
    prodPts.push(new THREE.Vector3(x, y, z));
  }
  const prodCurve = new THREE.CatmullRomCurve3(prodPts);
  const prodTube = new THREE.Mesh(
    new THREE.TubeGeometry(prodCurve, 20, 0.04, 6, false),
    new THREE.MeshPhongMaterial({ color: 0x00ffcc, emissive: 0x009977, shininess: 120 }),
  );
  xbow.add(prodTube);

  // Limb tips — small bright spheres at each end
  const tipMat = new THREE.MeshPhongMaterial({ color: 0x00ffcc, emissive: 0x00ffcc });
  const tipGeo = new THREE.SphereGeometry(0.07, 8, 8);
  const leftTip = new THREE.Mesh(tipGeo, tipMat);
  leftTip.position.copy(PROD_LEFT);
  xbow.add(leftTip);
  const rightTip = new THREE.Mesh(tipGeo.clone(), tipMat.clone());
  rightTip.position.copy(PROD_RIGHT);
  xbow.add(rightTip);

  // Stirrup — loop at front for cocking foot
  const stirrupPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI;
    stirrupPts.push(new THREE.Vector3(Math.cos(a) * 0.22, Math.sin(a) * 0.14 + 1.2, 5.85));
  }
  const stirrupGeo = new THREE.BufferGeometry().setFromPoints(stirrupPts);
  xbow.add(new THREE.Line(stirrupGeo, new THREE.LineBasicMaterial({ color: 0x445566 })));

  // Trigger guard — small D-loop under the stock
  const guardPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (i / 10) * Math.PI;
    guardPts.push(new THREE.Vector3(Math.cos(a) * 0.10, Math.sin(a) * 0.12 + 1.1, 7.6));
  }
  const guardGeo = new THREE.BufferGeometry().setFromPoints(guardPts);
  xbow.add(new THREE.Line(guardGeo, new THREE.LineBasicMaterial({ color: 0x445566 })));

  // Scope rail — thin bar on top
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.025, 0.8),
    new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x112233 }),
  );
  rail.position.set(0, 1.32, 6.85);
  xbow.add(rail);

  // Scope — small cylinder sitting on the rail
  const scopeBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.40, 10),
    new THREE.MeshPhongMaterial({ color: 0x1a2533, emissive: 0x050a10, shininess: 200 }),
  );
  scopeBody.rotation.x = Math.PI / 2;
  scopeBody.position.set(0, 1.36, 6.85);
  xbow.add(scopeBody);

  // Scope lens — glowing neon circle at the front
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.045, 12),
    new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
  );
  lens.position.set(0, 1.36, 6.64);
  xbow.add(lens);

  scene.add(xbow);
  return xbow;
}

export default function NeonArcherGame() {
  const theme = useBrandTheme();
  const mountRef   = useRef<HTMLDivElement>(null);
  const animRef    = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef  = useRef<(() => void) | null>(null);
  const playerSessionRef = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false, timeLeft: DURATION,
    sig: { totalShots: 0, hits: 0, perfectShots: 0, maxStreak: 0, streakCurrent: 0, score: 0 } as Signals,
    targets:   [] as TargetObj[],
    arrows:    [] as ArrowObj[],
    particles: [] as { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }[],
    aimLine:   null as THREE.Line | null,
    scene:     null as THREE.Scene | null,
    camera:    null as THREE.PerspectiveCamera | null,
    renderer:  null as THREE.WebGLRenderer | null,
    neonLight: null as THREE.PointLight | null,
    hitFlash:  0,
  });

  const drawRef = useRef<DrawState>({
    active: false,
    startX: 0, startY: 0,
    currentX: 0, currentY: 0,
    pullPower: 0,
    boltMesh: null,
    stringLine: null,
  });

  const [phase, setPhase]             = useState<Phase>('start');
  const [timeLeft, setTimeLeft]       = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]       = useState<Signals | null>(null);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.(); stopMusicRef.current = null;
    const pb = parseInt(localStorage.getItem(`pb_${GAME_ID}`) ?? '0');
    if (s.sig.score > pb) localStorage.setItem(`pb_${GAME_ID}`, String(s.sig.score));
    setFinalSig({ ...s.sig }); setPhase('done'); hapticVictory();
  }, []);

  const spawnTarget = useCallback((scene: THREE.Scene): TargetObj => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.12, 8, 32),
      new THREE.MeshPhongMaterial({ color: 0x00ffcc, emissive: 0x00aa88, shininess: 100 }),
    ));
    group.add(new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.1, 8, 24),
      new THREE.MeshPhongMaterial({ color: 0x00ff88, emissive: 0x00bb44 }),
    ));
    const bull = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 12),
      new THREE.MeshPhongMaterial({ color: 0xfbbf24, emissive: 0x92400e, side: THREE.DoubleSide }),
    );
    group.add(bull);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 4),
      new THREE.MeshPhongMaterial({ color: 0x334155 }),
    );
    pole.position.y = -2.5;
    group.add(pole);

    const x = (Math.random() - 0.5) * 14;
    const y = 0.5 + Math.random() * 3;
    group.position.set(x, y, -10 + Math.random() * -8);
    scene.add(group);
    return { group, x, y, vx: (Math.random() - 0.5) * 0.03, vy: (Math.random() - 0.5) * 0.015, radius: 1.2 };
  }, []);

  /** Spawn a fresh bolt onto the crossbow groove */
  const spawnBolt = useCallback((scene: THREE.Scene): THREE.Group => {
    const bolt = makeBolt();
    bolt.position.copy(NOCK_REST);
    scene.add(bolt);
    return bolt;
  }, []);

  /** Build the resting string (left tip → nock → right tip) */
  const makeStringLine = useCallback((scene: THREE.Scene, nockPos: THREE.Vector3): THREE.Line => {
    const geo = new THREE.BufferGeometry().setFromPoints([PROD_LEFT, nockPos, PROD_RIGHT]);
    const mat = new THREE.LineBasicMaterial({ color: 0xaaffee, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    return line;
  }, []);

  const startLoop = useCallback(() => {
    if (!mountRef.current) return;
    const s   = stateRef.current;
    const draw = drawRef.current;

    s.running = true; s.timeLeft = DURATION;
    s.sig = { totalShots: 0, hits: 0, perfectShots: 0, maxStreak: 0, streakCurrent: 0, score: 0 };
    s.targets = []; s.arrows = []; s.particles = []; s.hitFlash = 0;
    draw.active = false; draw.boltMesh = null; draw.stringLine = null;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('sports');

    const W = window.innerWidth, H = window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x020b14);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    s.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020b14, 0.03);
    s.scene = scene;

    const camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 200);
    camera.position.set(0, 1.5, 8);
    s.camera = camera;

    // Lights
    scene.add(new THREE.AmbientLight(0x001a2e, 5));
    const neonLight = new THREE.PointLight(0x00ffcc, 3, 20);
    neonLight.position.set(0, 5, 0);
    scene.add(neonLight);
    s.neonLight = neonLight;
    scene.add(Object.assign(new THREE.PointLight(0x0066ff, 2, 30), { position: { x: 0, y: -2, z: 0 } }));

    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 40),
      new THREE.MeshPhongMaterial({ color: 0x0a1628 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    scene.add(ground);
    scene.add(new THREE.GridHelper(60, 20, 0x003344, 0x001122));

    // Background neon tubes
    for (let i = 0; i < 8; i++) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 6 + Math.random() * 4),
        new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0x00ffcc : 0x0066ff, transparent: true, opacity: 0.4 }),
      );
      tube.position.set((Math.random() - 0.5) * 20, Math.random() * 3 - 1, -15 - Math.random() * 10);
      tube.rotation.z = (Math.random() - 0.5) * 0.3;
      scene.add(tube);
    }

    // Build crossbow
    buildCrossbow(scene);

    // Resting bolt + string
    draw.boltMesh   = spawnBolt(scene);
    draw.stringLine = makeStringLine(scene, NOCK_REST.clone());

    // Dashed aim line (hidden until drawing)
    const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -20)]);
    const aimMat = new THREE.LineDashedMaterial({ color: 0x00ffcc, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0 });
    const aimLine = new THREE.Line(aimGeo, aimMat);
    scene.add(aimLine);
    s.aimLine = aimLine;

    // Initial targets
    for (let i = 0; i < 3; i++) s.targets.push(spawnTarget(scene));

    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    let t = 0;
    const loop = () => {
      if (!s.running) { renderer.dispose(); return; }
      t += 0.016;

      // Move targets
      for (const tgt of s.targets) {
        tgt.x += tgt.vx; tgt.y += tgt.vy;
        if (Math.abs(tgt.x) > 9) tgt.vx *= -1;
        if (tgt.y > 5 || tgt.y < 0.5) tgt.vy *= -1;
        tgt.group.position.set(tgt.x, tgt.y, tgt.group.position.z);
        tgt.group.rotation.y = Math.sin(t * 0.5) * 0.1;
      }

      // Move in-flight bolts
      for (let i = s.arrows.length - 1; i >= 0; i--) {
        const ar = s.arrows[i];
        if (!ar.active) continue;
        ar.mesh.position.x += ar.vx;
        ar.mesh.position.y += ar.vy;
        ar.mesh.position.z += ar.vz;
        ar.vy -= 0.008; // gravity

        // Rotate to follow trajectory
        const vel = new THREE.Vector3(ar.vx, ar.vy, ar.vz);
        if (vel.length() > 0.001) {
          ar.mesh.lookAt(ar.mesh.position.clone().add(vel));
          ar.mesh.rotateX(Math.PI / 2);
        }

        // Hit detection
        for (const tgt of s.targets) {
          const d = ar.mesh.position.distanceTo(tgt.group.position);
          if (d < tgt.radius + 0.3) {
            ar.active = false;
            s.sig.hits++;
            const perfect = d < 0.4;
            if (perfect) s.sig.perfectShots++;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            s.sig.score += perfect ? 5 : 2;
            setScoreDisplay(s.sig.score);
            sfx.collect(); hapticScore();
            s.hitFlash = 20;
            neonLight.color.setHex(0xfbbf24);
            // Burst particles
            for (let p = 0; p < 12; p++) {
              const pm = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 6, 6),
                new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 1 }),
              );
              pm.position.copy(ar.mesh.position);
              scene.add(pm);
              s.particles.push({ mesh: pm, vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.1, life: 1 });
            }
            break;
          }
        }

        if (ar.mesh.position.z < -35 || ar.mesh.position.y < -5) ar.active = false;
        if (!ar.active) { scene.remove(ar.mesh); s.arrows.splice(i, 1); }
      }

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.life -= 0.03;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life;
        if (p.life <= 0) { scene.remove(p.mesh); s.particles.splice(i, 1); }
      }

      // Hit flash
      if (s.hitFlash > 0) {
        neonLight.intensity = 3 + (s.hitFlash / 20) * 4;
        s.hitFlash--;
        if (s.hitFlash === 0) neonLight.color.setHex(0x00ffcc);
      } else {
        neonLight.intensity = 3 + Math.sin(t * 2) * 0.5;
      }

      // Pulse scope lens glow
      const draw = drawRef.current;
      if (!draw.active && draw.boltMesh) {
        const tip = draw.boltMesh.children[1] as THREE.Mesh;
        if (tip?.material) {
          (tip.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.5 + Math.sin(t * 3) * 0.5;
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
  }, [endGame, spawnTarget, spawnBolt, makeStringLine]);

  // ── Pull-back mechanic ───────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const draw = drawRef.current;
      draw.active = true;
      draw.startX = e.clientX; draw.startY = e.clientY;
      draw.currentX = e.clientX; draw.currentY = e.clientY;
      draw.pullPower = 0;
      haptic([5]);
    };

    const onMove = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s    = stateRef.current;
      const draw = drawRef.current;
      if (!draw.active || !s.renderer) return;

      draw.currentX = e.clientX;
      draw.currentY = e.clientY;

      const dx = draw.currentX - draw.startX;
      const dy = draw.currentY - draw.startY;
      const power = Math.min(Math.sqrt(dx * dx + dy * dy) / 160, 1.0);
      draw.pullPower = power;

      // Pull bolt back along stock (toward camera = +Z)
      const pullZ = power * 1.0;
      const nockPos = new THREE.Vector3(0, 1.2, NOCK_REST.z + pullZ);

      if (draw.boltMesh) {
        draw.boltMesh.position.copy(nockPos);
        // Aim: opposite of drag direction — tilt the bolt
        const rect = s.renderer.domElement.getBoundingClientRect();
        const aimX = -( dx / rect.width ) * 3.5;
        const aimY =  ( dy / rect.height) * 2.5;
        const aimDir = new THREE.Vector3(aimX, aimY, -1).normalize();
        draw.boltMesh.lookAt(nockPos.clone().add(aimDir));
        draw.boltMesh.rotateX(Math.PI / 2);
      }

      // String: left tip → pulled nock → right tip
      if (draw.stringLine) {
        draw.stringLine.geometry.setFromPoints([PROD_LEFT, nockPos, PROD_RIGHT]);
      }

      // Aim line (dashed, from muzzle into the scene)
      if (s.aimLine) {
        const rect = s.renderer.domElement.getBoundingClientRect();
        const aimX = -( dx / rect.width ) * 3.5;
        const aimY =  ( dy / rect.height) * 2.5;
        const aimDir = new THREE.Vector3(aimX, aimY, -1).normalize();
        (s.aimLine.material as THREE.LineDashedMaterial).opacity = 0.15 + power * 0.45;
        s.aimLine.geometry.setFromPoints([STOCK_TIP, STOCK_TIP.clone().add(aimDir.multiplyScalar(28))]);
        s.aimLine.computeLineDistances();
      }
    };

    const onUp = (e: PointerEvent) => {
      if (phase !== 'playing') return;
      const s    = stateRef.current;
      const draw = drawRef.current;
      if (!draw.active || !s.scene || !s.renderer) { draw.active = false; return; }

      draw.active = false;
      const power = draw.pullPower;

      // Reset string to rest
      if (draw.stringLine) {
        draw.stringLine.geometry.setFromPoints([PROD_LEFT, NOCK_REST, PROD_RIGHT]);
      }
      // Hide aim line
      if (s.aimLine) (s.aimLine.material as THREE.LineDashedMaterial).opacity = 0;

      // Minimum pull to fire
      if (power < 0.08) {
        if (draw.boltMesh) draw.boltMesh.position.copy(NOCK_REST);
        return;
      }

      // Compute aim direction
      const dx = draw.currentX - draw.startX;
      const dy = draw.currentY - draw.startY;
      const rect = s.renderer.domElement.getBoundingClientRect();
      const aimDir = new THREE.Vector3(
        -(dx / rect.width) * 3.5,
         (dy / rect.height) * 2.5,
        -1,
      ).normalize();

      const speed = 0.28 + power * 0.58;

      // Fire the current bolt
      const flyBolt = draw.boltMesh!;
      flyBolt.position.copy(NOCK_REST);
      s.arrows.push({
        mesh: flyBolt,
        vx: aimDir.x * speed,
        vy: aimDir.y * speed,
        vz: aimDir.z * speed,
        active: true,
      });
      s.sig.totalShots++;
      s.sig.streakCurrent = 0;
      haptic([10, 5, 25]);

      // Rack a fresh bolt
      draw.boltMesh = spawnBolt(s.scene);
    };

    el.addEventListener('pointerdown',  onDown);
    el.addEventListener('pointermove',  onMove);
    el.addEventListener('pointerup',    onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown',   onDown);
      el.removeEventListener('pointermove',   onMove);
      el.removeEventListener('pointerup',     onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [phase, spawnBolt]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    stateRef.current.renderer?.dispose();
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null);
  }, []);

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg,#020b14 0%,#051020 100%)">
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Load Crossbow 🏹" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={theme.colors.accent ?? ACCENT} />}
      <div ref={mountRef}
        style={{ position: 'absolute', inset: 0, display: phase === 'playing' ? 'block' : 'none', touchAction: 'none' }} />
      {phase === 'playing' && (
        <GameHUD accentColor={theme.colors.accent ?? ACCENT}
          items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 10 }, { label: 'SCORE', value: scoreDisplay }]} />
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={[
            { label: 'Accuracy',      value: `${finalSig.totalShots > 0 ? Math.round(finalSig.hits / finalSig.totalShots * 100) : 0}%`, color: '#4ade80' },
            { label: 'Perfect Shots', value: `${finalSig.perfectShots}`,  color: '#fbbf24' },
            { label: 'Best Streak',   value: `×${finalSig.maxStreak}`,    color: ACCENT },
            { label: 'Total Shots',   value: `${finalSig.totalShots}`,    color: '#94a3b8' },
          ]}
          accentColor={theme.colors.accent ?? ACCENT} onPlayAgain={handlePlayAgain}
          didWin={finalSig.hits >= 8} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}

function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>; sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score, hits: sig.hits, totalShots: sig.totalShots }, player);
  }, [theme, sig, personality, player]);
  return null;
}
