'use client'

// ─── SSR guard ────────────────────────────────────────────────────────────────
const isBrowser = typeof window !== 'undefined'

let Tone: typeof import('tone') | null = null

async function getTone() {
  if (!isBrowser) return null
  if (!Tone) Tone = await import('tone')
  return Tone
}

// ─── State ────────────────────────────────────────────────────────────────────
let initialized = false
let muted = false
let activeParts: import('tone').Sequence<any>[] = []
let activeLoops: import('tone').Loop[] = []

// ─── Master chain ─────────────────────────────────────────────────────────────
let masterCompressor: import('tone').Compressor
let dryGain: import('tone').Gain
let masterReverb: import('tone').Reverb

// ─── Init (must be called inside a user gesture) ──────────────────────────────
export async function initAudio(): Promise<void> {
  if (initialized || !isBrowser) return
  // Test environment: skip Tone.js entirely so setPhase('countdown') fires immediately
  if ((window as unknown as Record<string, unknown>).__DISABLE_AUDIO) { initialized = true; return; }
  const T = await getTone()
  if (!T) return
  try {
    await T.start()
  } catch {
    // Audio context failed to start (test environment, permission denied, missing Web Audio API)
    // Keep initialized = false so all sfx/music calls are no-ops
    return
  }

  try {
    masterCompressor = new T.Compressor({ threshold: -14, ratio: 3, attack: 0.003, release: 0.25 })
    const masterLimiter = new T.Limiter(-3)
    masterCompressor.connect(masterLimiter)
    masterLimiter.toDestination()
  } catch {
    // Fallback: no compression (e.g. headless / test environments without full Web Audio API)
    // NOTE: do NOT call T.getDestination() here — it also accesses the native destination and will throw
    masterCompressor = { connect: (n: any) => n } as any
  }

  try {
    masterReverb = new T.Reverb({ decay: 2.0, wet: 0.3 })
    // Race against a 2s timeout — reverb.ready can hang in headless/test environments
    await Promise.race([
      masterReverb.ready,
      new Promise<void>(resolve => setTimeout(resolve, 2000)),
    ])
    masterReverb.toDestination()
  } catch {
    masterReverb = { toDestination: () => {}, connect: () => ({}) } as any
  }

  try {
    dryGain = new T.Gain(0.9).connect(masterCompressor)
  } catch {
    // NOTE: do NOT call .toDestination() here — it also crashes in mock AudioContext environments
    dryGain = { connect: () => ({}), toDestination: () => ({}) } as any
  }

  try {
    muted = localStorage.getItem('mg_muted') === '1'
    if (muted) T.getDestination().mute = true
  } catch { /* localStorage unavailable */ }

  initialized = true
}

export function setMuted(val: boolean): void {
  if (!isBrowser || !Tone) return
  muted = val
  try { localStorage.setItem('mg_muted', val ? '1' : '0') } catch { /* ignore */ }
  Tone.getDestination().mute = val
}

export function isMuted(): boolean { return muted }

// ─── Haptics ──────────────────────────────────────────────────────────────────
export function haptic(pattern: number | number[]): void {
  if (isBrowser && typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern)
  }
}

// ─── SFX ──────────────────────────────────────────────────────────────────────
export const sfx = {
  click: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const synth = new T.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
    }).connect(dryGain)
    synth.triggerAttackRelease('G5', '32n')
    setTimeout(() => synth.dispose(), 500)
  },

  collect: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 0.8, wet: 0.4 }).connect(dryGain)
    const synth = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.3 },
    }).connect(reverb)
    synth.triggerAttackRelease('C6', '16n', T.now())
    synth.triggerAttackRelease('E6', '16n', T.now() + 0.1)
    setTimeout(() => { synth.dispose(); reverb.dispose() }, 800)
  },

  collision: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const membrane = new T.MembraneSynth({
      pitchDecay: 0.04, octaves: 6,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 },
    }).connect(dryGain)
    const noise = new T.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
    }).connect(dryGain)
    membrane.triggerAttackRelease('C1', '8n')
    noise.triggerAttackRelease('16n')
    setTimeout(() => { membrane.dispose(); noise.dispose() }, 600)
  },

  success: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 1.5, wet: 0.35 }).connect(dryGain)
    const synth = new T.PolySynth(T.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.5 },
    }).connect(reverb)
    const notes = ['C5', 'E5', 'G5', 'C6']
    notes.forEach((n, i) => synth.triggerAttackRelease(n, '8n', T.now() + i * 0.1))
    setTimeout(() => { synth.dispose(); reverb.dispose() }, 1500)
  },

  fail: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const synth = new T.FMSynth({
      harmonicity: 0.5, modulationIndex: 8,
      envelope: { attack: 0.01, decay: 0.6, sustain: 0, release: 0.2 },
    }).connect(dryGain)
    synth.triggerAttackRelease('D2', '4n')
    setTimeout(() => { synth.triggerAttackRelease('A1', '4n') }, 200)
    setTimeout(() => synth.dispose(), 1200)
  },

  countdown: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const synth = new T.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
    }).connect(dryGain)
    synth.triggerAttackRelease('A4', '32n')
    setTimeout(() => synth.dispose(), 400)
  },

  go: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 0.6, wet: 0.3 }).connect(dryGain)
    const synth = new T.PolySynth(T.Synth, {
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.4 },
    }).connect(reverb)
    synth.triggerAttackRelease(['C5', 'E5', 'G5'], '8n')
    setTimeout(() => { synth.dispose(); reverb.dispose() }, 1000)
  },

  nearMiss: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const synth = new T.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
    }).connect(dryGain)
    synth.triggerAttackRelease('G3', '16n')
    setTimeout(() => synth.dispose(), 400)
  },

  whoosh: () => sfx.nearMiss(),

  tick: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const synth = new T.Synth({
      oscillator: { type: 'sine' }, volume: -12,
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.04 },
    }).connect(dryGain)
    synth.triggerAttackRelease('E5', '32n')
    setTimeout(() => synth.dispose(), 300)
  },

  boom: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 2.5, wet: 0.5 }).connect(dryGain)
    const membrane = new T.MembraneSynth({
      pitchDecay: 0.08, octaves: 10,
      envelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.3 },
    }).connect(reverb)
    const noise = new T.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 },
    }).connect(reverb)
    const sub = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.2 },
    }).connect(dryGain)
    membrane.triggerAttackRelease('C0', '2n')
    noise.triggerAttackRelease('2n')
    sub.triggerAttackRelease('G0', '4n')
    setTimeout(() => { membrane.dispose(); noise.dispose(); sub.dispose(); reverb.dispose() }, 2000)
  },

  defuse: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 2.0, wet: 0.45 }).connect(dryGain)
    const synth = new T.PolySynth(T.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.4, sustain: 0.2, release: 0.8 },
    }).connect(reverb)
    const chords: string[][] = [['C4','E4','G4'], ['F4','A4','C5'], ['G4','B4','D5'], ['C5','E5','G5']]
    chords.forEach((chord, i) => synth.triggerAttackRelease(chord, '8n', T.now() + i * 0.15))
    setTimeout(() => { synth.dispose(); reverb.dispose() }, 2000)
  },

  // ── Intro / cinematic SFX ───────────────────────────────────────────────────

  /** Cinematic whoosh — fires when the countdown screen enters */
  swoosh: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 1.0, wet: 0.4 }).connect(dryGain)
    const noise = new T.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.01, decay: 0.35, sustain: 0, release: 0.2 },
      volume: -16,
    }).connect(reverb)
    // Pitch sweep up: two sine tones gliding
    const sweep = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0, release: 0.2 },
      volume: -20,
    }).connect(reverb)
    noise.triggerAttackRelease('16n')
    sweep.triggerAttackRelease('A3', '8n', T.now())
    sweep.triggerAttackRelease('E5', '8n', T.now() + 0.08)
    sweep.triggerAttackRelease('A5', '8n', T.now() + 0.16)
    setTimeout(() => { noise.dispose(); sweep.dispose(); reverb.dispose() }, 900)
  },

  /** Heavy slam — fires on each countdown number (3, 2, 1) */
  slam: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 0.8, wet: 0.35 }).connect(dryGain)
    // Deep kick thud
    const kick = new T.MembraneSynth({
      pitchDecay: 0.06, octaves: 12, volume: -4,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.15 },
    }).connect(reverb)
    // Transient click on top
    const click = new T.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
      volume: -10,
    }).connect(dryGain)
    // Metallic ring
    const metal = new T.MetalSynth({
      envelope: { attack: 0.001, decay: 0.12, release: 0.06 },
      harmonicity: 12, modulationIndex: 20,
      resonance: 800, octaves: 0.5, volume: -22,
    }).connect(reverb)
    kick.triggerAttackRelease('C1', '4n')
    click.triggerAttackRelease('32n')
    metal.triggerAttackRelease('64n', T.now() + 0.01)
    setTimeout(() => { kick.dispose(); click.dispose(); metal.dispose(); reverb.dispose() }, 800)
  },

  /** Energetic power-on burst — fires on GO */
  powerOn: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 1.5, wet: 0.45 }).connect(dryGain)
    // Ascending pitch sweep
    const synth = new T.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0.3, release: 0.5 },
      volume: -14,
    }).connect(reverb)
    // Rising arpeggio: C, E, G, C5
    const notes = [['C4', 0], ['E4', 0.06], ['G4', 0.12], ['C5', 0.18], ['E5', 0.24]]
    notes.forEach(([note, time]) => synth.triggerAttackRelease(note as string, '16n', T.now() + (time as number)))
    // White noise burst underneath
    const noise = new T.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.15 },
      volume: -18,
    }).connect(reverb)
    noise.triggerAttackRelease('8n')
    // Sub thud
    const sub = new T.MembraneSynth({ pitchDecay: 0.08, octaves: 10, volume: -8 }).connect(dryGain)
    sub.triggerAttackRelease('C1', '4n')
    setTimeout(() => { synth.dispose(); noise.dispose(); sub.dispose(); reverb.dispose() }, 1200)
  },

  /** Rising tension — fires when start screen button is tapped */
  introTap: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 0.6, wet: 0.3 }).connect(dryGain)
    const synth = new T.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0.1, release: 0.3 },
      volume: -14,
    }).connect(reverb)
    // Quick ascending minor third
    synth.triggerAttackRelease('G4', '32n', T.now())
    synth.triggerAttackRelease('C5', '16n', T.now() + 0.06)
    // Soft noise for texture
    const noise = new T.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 },
      volume: -22,
    }).connect(dryGain)
    noise.triggerAttackRelease('32n')
    setTimeout(() => { synth.dispose(); noise.dispose(); reverb.dispose() }, 600)
  },

  shimmer: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const reverb = new T.Reverb({ decay: 1.2, wet: 0.6 }).connect(dryGain)
    const synth = new T.Synth({
      oscillator: { type: 'sine' }, volume: -8,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0.05, release: 0.5 },
    }).connect(reverb)
    synth.triggerAttackRelease('B6', '16n')
    setTimeout(() => { synth.dispose(); reverb.dispose() }, 1000)
  },

  warning: () => {
    if (!initialized || muted) return
    const T = Tone; if (!T) return
    const synth = new T.Synth({
      oscillator: { type: 'sawtooth' }, volume: -6,
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.1, release: 0.2 },
    }).connect(dryGain)
    synth.triggerAttackRelease('F3', '8n')
    setTimeout(() => synth.dispose(), 700)
  },
}

// ─── Defensive wrapper: catch any uncaught Web Audio API errors ───────────────
// In some environments (headless Chromium, restricted Web Audio, certain iOS versions),
// Tone.js node creation (especially T.Reverb) can throw "param must be an AudioParam".
// Rather than wrapping every individual node in try/catch, we guard the entire sfx
// object so no individual SFX function can ever throw an uncaught exception.
;(Object.keys(sfx) as (keyof typeof sfx)[]).forEach(key => {
  const orig = sfx[key]
  ;(sfx as any)[key] = (...args: unknown[]) => {
    try { (orig as any)(...args) } catch { /* ignore – audio failure is non-critical */ }
  }
})

// ─── Music Patterns ───────────────────────────────────────────────────────────
export type MusicPattern = 'tense' | 'calm' | 'pulse' | 'drive' | 'ambient' | 'minimal' | 'sports' | 'holiday'

export function startMusic(pattern: MusicPattern): () => void {
  if (!initialized || muted || !Tone) return () => {}
  try {
    const T = Tone
    stopAllMusic()
    T.getTransport().stop()
    T.getTransport().cancel()

    switch (pattern) {
      case 'tense':   return startTenseMusic()
      case 'calm':    return startCalmMusic()
      case 'pulse':   return startPulseMusic()
      case 'drive':   return startDriveMusic()
      case 'ambient': return startAmbientMusic()
      case 'minimal': return startMinimalMusic()
      case 'sports':  return startDriveMusic()   // alias until sports track is implemented
      case 'holiday': return startAmbientMusic()  // alias until holiday track is implemented
      default:        return () => {}
    }
  } catch {
    // Gracefully handle Tone.js errors in headless/test environments
    // (e.g. "param must be an AudioParam" in Chromium without full Web Audio support)
    return () => {}
  }
}

export function stopAllMusic(): void {
  const T = Tone; if (!T) return
  activeParts.forEach(p => { try { p.stop(); p.dispose() } catch { /* ignore */ } })
  activeLoops.forEach(l => { try { l.stop(); l.dispose() } catch { /* ignore */ } })
  activeParts = []
  activeLoops = []
  T.getTransport().stop()
  T.getTransport().cancel()
}

export function increaseMusicTempo(bpm: number): void {
  const T = Tone; if (!T) return
  T.getTransport().bpm.rampTo(bpm, 0.5)
}

// ─── TENSE: driving minor key — Tilt Maze ─────────────────────────────────────
function startTenseMusic(): () => void {
  const T = Tone!
  const reverb = new T.Reverb({ decay: 1.5, wet: 0.2 }).connect(dryGain)
  // Bigger, deeper kick
  const kick = new T.MembraneSynth({
    pitchDecay: 0.08, octaves: 12, volume: -4,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 },
  }).connect(dryGain)
  // Snare/clap on beat 3
  const snare = new T.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 }, volume: -14,
  }).connect(dryGain)
  // Fat bass with slight chorus
  const chorus = new T.Chorus({ frequency: 2, delayTime: 3, depth: 0.4, wet: 0.3 }).connect(dryGain)
  const bass = new T.Synth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.1 }, volume: -12,
  }).connect(chorus)
  // Lead with harmonics
  const lead = new T.Synth({
    oscillator: { type: 'sawtooth4' as any },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.2 }, volume: -16,
  }).connect(reverb)

  const kickSeq = new T.Sequence((time) => kick.triggerAttackRelease('C1', '8n', time),
    [0, null, null, null, 0, null, null, null], '8n')
  const snareSeq = new T.Sequence((time) => snare.triggerAttackRelease('16n', time),
    [null, null, null, null, 0, null, null, null], '8n')
  const bassSeq = new T.Sequence((time, note) => bass.triggerAttackRelease(note as string, '16n', time),
    ['A2', null, 'G2', null, 'F2', null, 'G2', null], '8n')
  const leadNotes = ['A4', null, 'C5', null, 'E5', null, 'D5', null, 'A4', null, 'G4', null, 'F4', null, null, null]
  const leadSeq = new T.Sequence((time, note) => {
    if (note) lead.triggerAttackRelease(note as string, '32n', time)
  }, leadNotes, '16n')

  kickSeq.start(0); snareSeq.start(0); bassSeq.start(0); leadSeq.start(0)
  activeParts.push(kickSeq, snareSeq, bassSeq, leadSeq)
  T.getTransport().bpm.value = 132
  T.getTransport().start()
  return () => {
    stopAllMusic()
    reverb.dispose(); chorus.dispose()
    kick.dispose(); snare.dispose(); bass.dispose(); lead.dispose()
  }
}

// ─── CALM: slow ambient pads — Breath Rider ────────────────────────────────────
function startCalmMusic(): () => void {
  const T = Tone!
  const reverb = new T.Reverb({ decay: 4.5, wet: 0.65 }).connect(dryGain)
  // Richer harmonics with sine4
  const pad = new T.PolySynth(T.Synth, {
    oscillator: { type: 'sine4' as any },
    envelope: { attack: 1.0, decay: 1.2, sustain: 0.7, release: 2.5 }, volume: -18,
  }).connect(reverb)
  const bass = new T.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.5, decay: 0.8, sustain: 0.8, release: 2.0 }, volume: -22,
  }).connect(reverb)
  // Occasional high bell
  const bell = new T.Synth({
    oscillator: { type: 'sine' }, volume: -26,
    envelope: { attack: 0.001, decay: 0.8, sustain: 0.1, release: 2.5 },
  }).connect(reverb)

  const chordProg: string[][] = [['C4','E4','G4'], ['F3','A3','C4'], ['G3','B3','D4'], ['A3','C4','E4']]
  const bassNotes = ['C2','F2','G2','A2']
  const bellNotes = ['C7','E7','G7','B6']
  let idx = 0
  const loop = new T.Loop((time) => {
    pad.triggerAttackRelease(chordProg[idx % chordProg.length], '2n', time)
    bass.triggerAttackRelease(bassNotes[idx % 4], '2n', time)
    // Bell every 4 bars
    if (idx % 4 === 0) bell.triggerAttackRelease(bellNotes[Math.floor(idx/4) % 4], '8n', time + 0.5)
    idx++
  }, '2n')
  loop.start(0)
  activeLoops.push(loop)
  T.getTransport().bpm.value = 60
  T.getTransport().start()
  return () => { stopAllMusic(); reverb.dispose(); pad.dispose(); bass.dispose(); bell.dispose() }
}

// ─── PULSE: heartbeat — Whisper Bomb ──────────────────────────────────────────
function startPulseMusic(): () => void {
  const T = Tone!
  const compressor = new T.Compressor({ threshold: -12, ratio: 6 }).connect(dryGain)
  // Double heartbeat pattern
  const kick = new T.MembraneSynth({ pitchDecay: 0.06, octaves: 10, volume: -6 }).connect(compressor)
  const kickSoft = new T.MembraneSynth({ pitchDecay: 0.04, octaves: 8, volume: -10 }).connect(compressor)
  // Sub-bass sine for physical thump
  const sub = new T.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.1 }, volume: -18,
  }).connect(compressor)
  // String stabs on off-beats
  const strings = new T.PolySynth(T.Synth, {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.02, decay: 0.15, sustain: 0.05, release: 0.1 }, volume: -22,
  }).connect(dryGain)

  // Double heartbeat: kick-kick-silence pattern
  const seq = new T.Sequence((time) => {
    kick.triggerAttackRelease('C1', '32n', time)
    sub.triggerAttackRelease('C2', '32n', time + 0.06)
  }, [0, null, null, null, 0, null, null, null], '16n')

  const seq2 = new T.Sequence((time) => {
    kickSoft.triggerAttackRelease('C1', '32n', time)
  }, [null, null, 0, null, null, null, null, null], '16n')

  // String stabs in A minor
  const stabs = new T.Sequence((time) => {
    strings.triggerAttackRelease(['A3', 'C4', 'E4'], '32n', time)
  }, [null, null, null, null, null, null, 0, null], '16n')

  seq.start(0); seq2.start(0); stabs.start(0)
  activeParts.push(seq, seq2, stabs)
  T.getTransport().bpm.value = 80
  T.getTransport().start()
  return () => {
    stopAllMusic()
    kick.dispose(); kickSoft.dispose(); sub.dispose(); strings.dispose(); compressor.dispose()
  }
}

// ─── DRIVE: fast electronic — Infinite Tunnel ─────────────────────────────────
function startDriveMusic(): () => void {
  const T = Tone!
  const reverb = new T.Reverb({ decay: 0.8, wet: 0.12 }).connect(dryGain)
  // Punchy kick
  const kick = new T.MembraneSynth({ pitchDecay: 0.05, octaves: 9, volume: -6 }).connect(dryGain)
  // Closed hi-hat
  const hihat = new T.MetalSynth({
    envelope: { attack: 0.001, decay: 0.06, release: 0.04 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, volume: -20,
  }).connect(dryGain)
  // Open hi-hat (longer decay)
  const openHihat = new T.MetalSynth({
    envelope: { attack: 0.001, decay: 0.25, release: 0.1 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, volume: -22,
  }).connect(dryGain)
  // Portamento bass
  const bass = new T.Synth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.01, decay: 0.12, sustain: 0.5, release: 0.1 }, volume: -12,
    portamento: 0.04,
  }).connect(dryGain)
  // Fattened sawtooth lead (two oscillators detuned via AMSynth approach)
  const lead = new T.Synth({
    oscillator: { type: 'fatsawtooth' as any, count: 3, spread: 25 } as any,
    envelope: { attack: 0.01, decay: 0.06, sustain: 0.4, release: 0.08 }, volume: -16,
  }).connect(reverb)

  // 4-on-the-floor kick
  const kickSeq = new T.Sequence((time) => kick.triggerAttackRelease('C1', '8n', time),
    [0, null, 0, null, 0, null, 0, null], '8n')
  // Closed hi-hat on every 8th
  const hihatSeq = new T.Sequence((time) => hihat.triggerAttackRelease('32n', time),
    [0, 0, 0, 0, 0, 0, 0, 0], '8n')
  // Open hi-hat on beats 2 and 4
  const openHihatSeq = new T.Sequence((time) => openHihat.triggerAttackRelease('16n', time),
    [null, null, 0, null, null, null, 0, null], '8n')
  // Portamento bass
  const bassPitches = ['C2', null, 'C2', 'D2', 'F2', null, 'A1', null]
  const bassSeq = new T.Sequence((time, n) => { if (n) bass.triggerAttackRelease(n as string, '16n', time) },
    bassPitches, '8n')
  // Lead melody
  const leadNotes = ['C4', null, 'E4', null, 'G4', null, 'A4', null, 'C5', null, 'G4', null, 'F4', null, null, null]
  const leadSeq = new T.Sequence((time, n) => { if (n) lead.triggerAttackRelease(n as string, '32n', time) },
    leadNotes, '16n')

  kickSeq.start(0); hihatSeq.start(0); openHihatSeq.start(0); bassSeq.start(0); leadSeq.start(0)
  activeParts.push(kickSeq, hihatSeq, openHihatSeq, bassSeq, leadSeq)
  T.getTransport().bpm.value = 145
  T.getTransport().start()
  return () => {
    stopAllMusic()
    kick.dispose(); hihat.dispose(); openHihat.dispose(); bass.dispose(); lead.dispose(); reverb.dispose()
  }
}

// ─── AMBIENT: evolving drone — Pulse Sphere ───────────────────────────────────
function startAmbientMusic(): () => void {
  const T = Tone!
  const reverb = new T.Reverb({ decay: 6.0, wet: 0.7 }).connect(dryGain)
  const chorus = new T.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.7, wet: 0.5 }).connect(reverb)
  // Primary pad
  const pad = new T.PolySynth(T.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 2.0, decay: 1.0, sustain: 0.9, release: 4.0 }, volume: -20,
  }).connect(chorus)
  // Second higher-pitched pad with longer attack
  const pad2 = new T.PolySynth(T.Synth, {
    oscillator: { type: 'sine4' as any },
    envelope: { attack: 3.5, decay: 1.5, sustain: 0.7, release: 5.0 }, volume: -24,
  }).connect(reverb)

  const chords: string[][] = [['C3','G3','E4'], ['A2','E3','C4'], ['F2','C3','A3'], ['G2','D3','B3']]
  const highChords: string[][] = [['C5','E5'], ['A4','C5'], ['F4','A4'], ['G4','B4']]
  let idx = 0
  const loop = new T.Loop((time) => {
    pad.triggerAttackRelease(chords[idx % chords.length], '1n', time)
    pad2.triggerAttackRelease(highChords[idx % highChords.length], '1n', time + 0.5)
    idx++
  }, '1n')
  loop.start(0)
  activeLoops.push(loop)
  T.getTransport().bpm.value = 50
  T.getTransport().start()
  return () => { stopAllMusic(); reverb.dispose(); chorus.dispose(); pad.dispose(); pad2.dispose() }
}

// ─── MINIMAL: sparse marimba — Steady Hand ────────────────────────────────────
function startMinimalMusic(): () => void {
  const T = Tone!
  // Longer reverb tail
  const reverb = new T.Reverb({ decay: 3.5, wet: 0.45 }).connect(dryGain)
  // Ping pong delay for space
  const pingPong = new T.PingPongDelay({ delayTime: '8n', feedback: 0.3, wet: 0.25 }).connect(dryGain)
  const marimba = new T.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.5, sustain: 0.08, release: 0.4 }, volume: -18,
  }).connect(reverb)
  ;(marimba as any).connect(pingPong)
  const bass = new T.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.05, decay: 1.0, sustain: 0, release: 0.5 }, volume: -22,
  }).connect(reverb)

  // Slightly varied velocity — not perfectly metronomic
  const mNotes = ['E4', null, null, null, 'G4', null, null, null, 'D4', null, null, null, 'E4', null, null, null]
  let noteIdx = 0
  const mSeq = new T.Sequence((time, n) => {
    if (n) {
      const vel = 0.5 + Math.random() * 0.4  // varied velocity
      marimba.triggerAttackRelease(n as string, '16n', time, vel)
    }
    noteIdx++
  }, mNotes, '16n')

  // Chord fill every 4 bars (32 16th notes)
  const chords = new T.PolySynth(T.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.05, decay: 0.4, sustain: 0.2, release: 0.8 }, volume: -26,
  }).connect(reverb)
  let fillCounter = 0
  const fillSeq = new T.Sequence((time) => {
    fillCounter++
    if (fillCounter % 32 === 0) {
      chords.triggerAttackRelease(['E4','G4','B4'], '4n', time)
    }
  }, [0], '16n')

  const bNotes = ['C3', null, null, null, 'G2', null, null, null]
  const bSeq = new T.Sequence((time, n) => { if (n) bass.triggerAttackRelease(n as string, '4n', time) }, bNotes, '8n')

  mSeq.start(0); bSeq.start(0); fillSeq.start(0)
  activeParts.push(mSeq, bSeq, fillSeq)
  T.getTransport().bpm.value = 90
  T.getTransport().start()
  return () => {
    stopAllMusic()
    reverb.dispose(); pingPong.dispose(); marimba.dispose(); bass.dispose(); chords.dispose()
  }
}

// ─── SPORTS: high-energy stadium beats ────────────────────────────────────────
function startSportsMusic(): () => void {
  const T = Tone!
  const compressor = new T.Compressor({ threshold: -12, ratio: 4 }).connect(dryGain)
  const kick = new T.MembraneSynth({
    pitchDecay: 0.07, octaves: 12, volume: -4,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
  }).connect(compressor)
  const snare = new T.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.06 }, volume: -10,
  }).connect(compressor)
  const hihat = new T.MetalSynth({
    envelope: { attack: 0.001, decay: 0.06, release: 0.04 },
    harmonicity: 5.1, modulationIndex: 16, resonance: 4000, octaves: 0.3, volume: -22,
  }).connect(compressor)
  const bass = new T.Synth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.1 }, volume: -14,
  }).connect(compressor)
  const stab = new T.PolySynth(T.Synth, {
    oscillator: { type: 'sawtooth4' as any },
    envelope: { attack: 0.002, decay: 0.1, sustain: 0.2, release: 0.15 }, volume: -18,
  }).connect(compressor)

  const kickSeq = new T.Sequence((time) => kick.triggerAttackRelease('C1', '8n', time),
    [0, null, null, null, 0, null, null, null], '8n')
  const snareSeq = new T.Sequence((time) => snare.triggerAttackRelease('16n', time),
    [null, null, null, null, 0, null, null, null], '8n')
  const hihatSeq = new T.Sequence((time) => hihat.triggerAttackRelease('32n', time),
    [0, 0, 0, 0, 0, 0, 0, 0], '8n')
  const bassNotes = ['A1','A1','A1','G1','A1','A1','F1','G1']
  const bassSeq = new T.Sequence((time, n) => bass.triggerAttackRelease(n as string, '8n', time), bassNotes, '8n')
  let stabIdx = 0
  const stabProg: string[][] = [['A3','C4','E4'],['G3','B3','D4'],['F3','A3','C4'],['E3','G3','B3']]
  const stabSeq = new T.Sequence((time) => {
    if (stabIdx % 4 === 0) stab.triggerAttackRelease(stabProg[Math.floor(stabIdx/4) % 4], '16n', time)
    stabIdx++
  }, [0,0,0,0,0,0,0,0], '8n')

  kickSeq.start(0); snareSeq.start(0); hihatSeq.start(0); bassSeq.start(0); stabSeq.start(0)
  activeParts.push(kickSeq, snareSeq, hihatSeq, bassSeq, stabSeq)
  T.getTransport().bpm.value = 145
  T.getTransport().start()
  return () => {
    stopAllMusic()
    compressor.dispose(); kick.dispose(); snare.dispose(); hihat.dispose(); bass.dispose(); stab.dispose()
  }
}

// ─── HOLIDAY: festive bells and warmth ────────────────────────────────────────
function startHolidayMusic(): () => void {
  const T = Tone!
  const reverb = new T.Reverb({ decay: 2.0, wet: 0.4 }).connect(dryGain)
  const bell = new T.MetalSynth({
    envelope: { attack: 0.001, decay: 0.3, release: 0.2 },
    harmonicity: 5.1, modulationIndex: 16, resonance: 2000, octaves: 0.5, volume: -14,
  }).connect(reverb)
  const pad = new T.PolySynth(T.Synth, {
    oscillator: { type: 'sine4' as any },
    envelope: { attack: 0.1, decay: 0.5, sustain: 0.6, release: 1.5 }, volume: -20,
  }).connect(reverb)
  const bass = new T.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.05, decay: 0.4, sustain: 0.3, release: 0.5 }, volume: -18,
  }).connect(dryGain)

  const bellMelody = ['C6','E6','G6','B5','C6',null,'G5','B5']
  let bIdx = 0
  const bellSeq = new T.Sequence((time) => {
    const n = bellMelody[bIdx % bellMelody.length]
    if (n) bell.triggerAttackRelease('8n', time)
    bIdx++
  }, [0,0,0,0,0,0,0,0], '8n')
  const padChords: string[][] = [['C4','E4','G4'],['F3','A3','C4'],['G3','B3','D4'],['A3','C4','E4']]
  const bassNotes = ['C2','F2','G2','A2']
  let idx = 0
  const padSeq = new T.Sequence((time) => {
    pad.triggerAttackRelease(padChords[idx % 4], '2n', time)
    bass.triggerAttackRelease(bassNotes[idx % 4], '2n', time)
    idx++
  }, [0,0,0,0], '2n')

  bellSeq.start(0); padSeq.start(0)
  activeParts.push(bellSeq, padSeq)
  T.getTransport().bpm.value = 100
  T.getTransport().start()
  return () => { stopAllMusic(); reverb.dispose(); bell.dispose(); pad.dispose(); bass.dispose() }
}

// ══════════════════════════════════════════════════════════════════════════════
// ─── AAA SOUND DESIGN — HIGH-LEVEL EXPORTED FUNCTIONS ─────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/** Semitone randomisation helper. */
function randSemitones(max: number): number {
  return Math.pow(2, ((Math.random() - 0.5) * 2 * max) / 12)
}

/**
 * playScoreHit — category-aware score sound with ±1 semitone pitch variation.
 * category: 'sports' | 'cognitive' | 'social' | 'seasonal' | 'default'
 * points: shimmer layer added at ≥50pts.
 */
export function playScoreHit(category: string = 'default', points: number = 10): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 0.8, wet: 0.3 }).connect(dryGain)
    const baseFreqs: Record<string,number> = {
      sports: 659.25, cognitive: 523.25, social: 698.46, seasonal: 783.99, default: 587.33,
    }
    const base = (baseFreqs[category] ?? baseFreqs.default) * randSemitones(1)
    const synth = new T.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0.05, release: 0.4 }, volume: -10,
    }).connect(reverb)
    synth.triggerAttackRelease(base, '16n', now)
    synth.triggerAttackRelease(base * 1.25, '32n', now + 0.06)
    if (points >= 50) {
      const sp = new T.MetalSynth({
        envelope: { attack: 0.001, decay: 0.1, release: 0.08 },
        harmonicity: 5.1, modulationIndex: 12, resonance: 1800, octaves: 0.5, volume: -22,
      }).connect(reverb)
      sp.triggerAttackRelease('32n', now + 0.05)
      setTimeout(() => sp.dispose(), 600)
    }
    setTimeout(() => { synth.dispose(); reverb.dispose() }, 800)
  } catch { /* non-critical */ }
}

/**
 * playComboSfx — escalating combo sound.
 * streak 1-4: rising note; 3+: harmony; 5+: chord burst.
 */
export function playComboSfx(streak: number): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 1.0, wet: 0.4 }).connect(dryGain)
    const step = Math.min(streak - 1, 8)
    const baseFreq = 440 * Math.pow(2, step / 12) * randSemitones(0.5)
    const vol = Math.max(-18, -18 + streak)
    const synth = new T.Synth({
      oscillator: { type: streak >= 5 ? ('sawtooth4' as any) : 'triangle' },
      envelope: { attack: 0.001, decay: streak >= 5 ? 0.3 : 0.15, sustain: 0.1, release: 0.5 },
      volume: vol,
    }).connect(reverb)
    synth.triggerAttackRelease(baseFreq, '16n', now)
    if (streak >= 3) {
      const h = new T.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.3 }, volume: vol - 6,
      }).connect(reverb)
      h.triggerAttackRelease(baseFreq * 1.5, '32n', now + 0.04)
      setTimeout(() => h.dispose(), 500)
    }
    if (streak >= 5) {
      const ch = new T.PolySynth(T.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.1, release: 0.8 }, volume: vol - 8,
      }).connect(reverb)
      ch.triggerAttackRelease([baseFreq, baseFreq * 1.25, baseFreq * 1.5], '8n', now + 0.05)
      setTimeout(() => ch.dispose(), 1000)
    }
    setTimeout(() => { synth.dispose(); reverb.dispose() }, 900)
  } catch { /* non-critical */ }
}

/**
 * playNearMiss — tense descending whiff for close calls.
 */
export function playNearMiss(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 0.6, wet: 0.25 }).connect(dryGain)
    const synth = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.15 }, volume: -10,
    }).connect(reverb)
    ;[659.25, 523.25, 440].forEach((f, i) => synth.triggerAttackRelease(f, '32n', now + i * 0.07))
    const noise = new T.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 }, volume: -20,
    }).connect(dryGain)
    noise.triggerAttackRelease('16n', now)
    setTimeout(() => { synth.dispose(); noise.dispose(); reverb.dispose() }, 700)
  } catch { /* non-critical */ }
}

/**
 * playCountdown — per-number countdown beep (n=3,2,1) or GO (n=0).
 * Pitch rises as n decreases; n=0 = triumphant major chord.
 */
export function playCountdown(n: number): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    if (n === 0) {
      const reverb = new T.Reverb({ decay: 0.8, wet: 0.3 }).connect(dryGain)
      const ch = new T.PolySynth(T.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0.2, release: 0.8 }, volume: -10,
      }).connect(reverb)
      ch.triggerAttackRelease(['C4','E4','G4','C5'], '4n', now)
      setTimeout(() => { ch.dispose(); reverb.dispose() }, 1200)
    } else {
      const freqs: Record<number,number> = { 3: 330, 2: 440, 1: 660 }
      const freq = (freqs[n] ?? 440) * randSemitones(0.3)
      const synth = new T.Synth({
        oscillator: { type: n === 1 ? 'sawtooth' : 'sine' },
        envelope: { attack: 0.001, decay: n === 1 ? 0.25 : 0.18, sustain: 0, release: 0.1 },
        volume: n === 1 ? -6 : -10,
      }).connect(dryGain)
      synth.triggerAttackRelease(freq, '16n', now)
      setTimeout(() => synth.dispose(), 500)
    }
  } catch { /* non-critical */ }
}

/**
 * playVictoryFanfare — rising major arpeggio with sparkle tail.
 */
export function playVictoryFanfare(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 2.0, wet: 0.45 }).connect(dryGain)
    const lead = new T.Synth({
      oscillator: { type: 'sawtooth4' as any },
      envelope: { attack: 0.001, decay: 0.25, sustain: 0.3, release: 0.8 }, volume: -8,
    }).connect(reverb)
    const notes = ['C4','E4','G4','C5','E5','G5','C6']
    notes.forEach((note, i) => lead.triggerAttackRelease(note, '16n', now + i * 0.075))
    const t = now + notes.length * 0.075
    const chord = new T.PolySynth(T.Synth, {
      oscillator: { type: 'sine4' as any },
      envelope: { attack: 0.001, decay: 0.5, sustain: 0.4, release: 1.5 }, volume: -12,
    }).connect(reverb)
    chord.triggerAttackRelease(['C5','E5','G5','C6'], '2n', t)
    const sp = new T.MetalSynth({
      envelope: { attack: 0.001, decay: 0.3, release: 0.2 },
      harmonicity: 5.1, modulationIndex: 16, resonance: 2400, octaves: 0.5, volume: -20,
    }).connect(reverb)
    sp.triggerAttackRelease('8n', t + 0.1)
    setTimeout(() => { lead.dispose(); chord.dispose(); sp.dispose(); reverb.dispose() }, 2500)
  } catch { /* non-critical */ }
}

/**
 * playPersonalBest — genuinely exciting PB fanfare.
 * Bass hit → 2-octave arpeggio → massive chord → bell cascade → sparkle shower.
 */
export function playPersonalBest(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 3.0, wet: 0.5 }).connect(dryGain)
    const pingPong = new T.PingPongDelay({ delayTime: '8n', feedback: 0.25, wet: 0.3 }).connect(dryGain)
    // Big bass hit
    const kick = new T.MembraneSynth({
      pitchDecay: 0.08, octaves: 12, volume: -4,
      envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.2 },
    }).connect(dryGain)
    kick.triggerAttackRelease('C1', '8n', now)
    const sub = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.4 }, volume: -10,
    }).connect(dryGain)
    sub.triggerAttackRelease('C2', '4n', now + 0.02)
    // 2-octave arpeggio
    const lead = new T.Synth({
      oscillator: { type: 'sawtooth4' as any },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0.2, release: 0.6 }, volume: -8,
    }).connect(reverb)
    const arp = ['C3','E3','G3','C4','E4','G4','C5','E5','G5','C6']
    arp.forEach((n, i) => lead.triggerAttackRelease(n, '32n', now + 0.05 + i * 0.06))
    const arpEnd = now + 0.05 + arp.length * 0.06
    // Massive chord
    const chord = new T.PolySynth(T.Synth, {
      oscillator: { type: 'sine4' as any },
      envelope: { attack: 0.002, decay: 0.8, sustain: 0.5, release: 2.5 }, volume: -10,
    }).connect(reverb)
    chord.triggerAttackRelease(['C4','E4','G4','B4','D5','G5','C6'], '1n', arpEnd)
    // Bell cascade
    const bell = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.6, sustain: 0.1, release: 1.5 }, volume: -12,
    }).connect(reverb)
    ;(bell as any).connect(pingPong)
    ;['C6','E6','G6','C7','E7'].forEach((n, i) => bell.triggerAttackRelease(n, '8n', arpEnd + 0.1 + i * 0.08))
    // Sparkle shower
    const sparkles = [0, 0.05, 0.1, 0.15].map((offset) => {
      const m = new T.MetalSynth({
        envelope: { attack: 0.001, decay: 0.25 + Math.random() * 0.25, release: 0.15 },
        harmonicity: 3 + Math.random() * 4, modulationIndex: 12 + Math.random() * 8,
        resonance: 1200 + Math.random() * 2000, octaves: 0.5, volume: -22 + Math.random() * 4,
      }).connect(reverb)
      m.triggerAttackRelease('16n', arpEnd + 0.2 + offset)
      return m
    })
    setTimeout(() => {
      kick.dispose(); sub.dispose(); lead.dispose(); chord.dispose()
      bell.dispose(); sparkles.forEach(s => s.dispose())
      reverb.dispose(); pingPong.dispose()
    }, 5000)
  } catch { /* non-critical */ }
}

/**
 * playUrgentTick — last-5-seconds countdown escalation.
 * secondsLeft 5→1: higher pitch, louder, adds trill at 1.
 */
export function playUrgentTick(secondsLeft: number): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const step = Math.max(1, Math.min(5, secondsLeft))
    const freqs: Record<number,number> = { 5: 329.63, 4: 440, 3: 659.25, 2: 880, 1: 1318.51 }
    const freq = freqs[step] * randSemitones(0.2)
    const vol = -16 + (5 - step) * 2.5
    const synth = new T.Synth({
      oscillator: { type: step <= 2 ? 'square' : 'sine' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.06 }, volume: vol,
    }).connect(dryGain)
    synth.triggerAttackRelease(freq, '32n', now)
    const metal = new T.MetalSynth({
      envelope: { attack: 0.001, decay: 0.05, release: 0.03 },
      harmonicity: 5.1, modulationIndex: step <= 2 ? 24 : 16,
      resonance: freq * 4, octaves: 0.5, volume: vol - 10,
    }).connect(dryGain)
    metal.triggerAttackRelease('32n', now)
    if (step <= 2) synth.triggerAttackRelease(freq * 1.5, '32n', now + 0.06)
    if (step === 1) {
      synth.triggerAttackRelease(freq * 2, '32n', now + 0.12)
      synth.triggerAttackRelease(freq * 2, '32n', now + 0.18)
    }
    setTimeout(() => { synth.dispose(); metal.dispose() }, 700)
  } catch { /* non-critical */ }
}

// ─── Ambient loops by game category ──────────────────────────────────────────
let ambientLoop: { stop: () => void } | null = null

export function startAmbient(category: string = 'default'): void {
  if (!initialized || muted || !Tone) return
  stopAmbient()
  try {
    const T = Tone; const now = T.now()
    let dispose: (() => void) | null = null

    if (category === 'sports') {
      const reverb = new T.Reverb({ decay: 4.0, wet: 0.6 }).connect(dryGain)
      const crowd = new T.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 2.0, decay: 0, sustain: 1, release: 2.0 }, volume: -28,
      }).connect(reverb)
      crowd.triggerAttack(now)
      const filter = new T.Filter({ frequency: 500, type: 'lowpass', Q: 0.5 }).connect(dryGain)
      const pad = new T.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 3.0, decay: 0, sustain: 1, release: 3.0 }, volume: -30,
      }).connect(filter)
      pad.triggerAttack('C2', now)
      dispose = () => { crowd.dispose(); pad.dispose(); reverb.dispose(); filter.dispose() }

    } else if (category === 'cognitive') {
      const reverb = new T.Reverb({ decay: 5.0, wet: 0.7 }).connect(dryGain)
      const hum = new T.PolySynth(T.Synth, {
        oscillator: { type: 'sine4' as any },
        envelope: { attack: 4.0, decay: 0, sustain: 1, release: 4.0 }, volume: -30,
      }).connect(reverb)
      hum.triggerAttack(['C3','G3','E4'], now)
      dispose = () => { hum.dispose(); reverb.dispose() }

    } else if (category === 'seasonal') {
      const reverb = new T.Reverb({ decay: 6.0, wet: 0.7 }).connect(dryGain)
      const wind = new T.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 3.0, decay: 0, sustain: 1, release: 3.0 }, volume: -30,
      }).connect(reverb)
      wind.triggerAttack(now)
      dispose = () => { wind.dispose(); reverb.dispose() }

    } else if (category === 'social') {
      const reverb = new T.Reverb({ decay: 4.0, wet: 0.5 }).connect(dryGain)
      const pad = new T.PolySynth(T.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 3.0, decay: 0, sustain: 1, release: 3.0 }, volume: -26,
      }).connect(reverb)
      pad.triggerAttack(['C3','E3','G3'], now)
      dispose = () => { pad.dispose(); reverb.dispose() }

    } else if (category === 'path') {
      const reverb = new T.Reverb({ decay: 3.0, wet: 0.5 }).connect(dryGain)
      const noise = new T.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 2.0, decay: 0, sustain: 1, release: 2.0 }, volume: -34,
      }).connect(reverb)
      noise.triggerAttack(now)
      dispose = () => { noise.dispose(); reverb.dispose() }

    } else if (category === 'orbit') {
      const reverb = new T.Reverb({ decay: 6.0, wet: 0.7 }).connect(dryGain)
      const hum = new T.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 4.0, decay: 0, sustain: 1, release: 4.0 }, volume: -28,
      }).connect(reverb)
      hum.triggerAttack('A0', now)
      const harm = new T.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 6.0, decay: 0, sustain: 1, release: 4.0 }, volume: -34,
      }).connect(reverb)
      harm.triggerAttack('E1', now + 1)
      dispose = () => { hum.dispose(); harm.dispose(); reverb.dispose() }

    } else {
      const reverb = new T.Reverb({ decay: 4.0, wet: 0.5 }).connect(dryGain)
      const pad = new T.PolySynth(T.Synth, {
        oscillator: { type: 'sine4' as any },
        envelope: { attack: 4.0, decay: 0, sustain: 1, release: 4.0 }, volume: -28,
      }).connect(reverb)
      pad.triggerAttack(['C3','G3'], now)
      dispose = () => { pad.dispose(); reverb.dispose() }
    }

    ambientLoop = { stop: () => { if (dispose) dispose() } }
  } catch { /* non-critical */ }
}

export function stopAmbient(): void {
  if (ambientLoop) { try { ambientLoop.stop() } catch { /* ok */ }; ambientLoop = null }
}

// ─── Game-specific AAA Sound Effects ─────────────────────────────────────────

/** Ascending pitch sweep for firework launch (~0.4s). */
export function playFireworkWhistle(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const synth = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.35, sustain: 0, release: 0.1 }, volume: -12,
    }).connect(dryGain)
    const hiss = new T.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.02, decay: 0.35, sustain: 0, release: 0.1 }, volume: -24,
    }).connect(dryGain)
    ;['G3','C4','G4','C5','G5','C6','G6'].forEach((p, i) => synth.triggerAttackRelease(p, '32n', now + i * 0.055))
    hiss.triggerAttackRelease('4n', now)
    setTimeout(() => { synth.dispose(); hiss.dispose() }, 700)
  } catch { /* non-critical */ }
}

/** Multi-layered firework explosion: sub boom + noise + sparkle cluster. */
export function playFireworkBurst(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 2.5, wet: 0.55 }).connect(dryGain)
    const sub = new T.MembraneSynth({
      pitchDecay: 0.06, octaves: 8, volume: -8,
      envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 },
    }).connect(dryGain)
    const noise = new T.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 }, volume: -14,
    }).connect(reverb)
    const sparkles = [1800, 2400, 3200, 4000].map((res, i) => {
      const m = new T.MetalSynth({
        envelope: { attack: 0.001, decay: 0.2 + Math.random() * 0.2, release: 0.15 },
        harmonicity: 3 + Math.random() * 4, modulationIndex: 12 + Math.random() * 8,
        resonance: res, octaves: 0.5 + Math.random() * 0.5, volume: -20,
      }).connect(reverb)
      m.triggerAttackRelease('16n', now + i * 0.015)
      return m
    })
    sub.triggerAttackRelease('C1', '4n', now)
    noise.triggerAttackRelease('4n', now)
    setTimeout(() => { sub.dispose(); noise.dispose(); sparkles.forEach(s => s.dispose()); reverb.dispose() }, 2000)
  } catch { /* non-critical */ }
}

/** Wet cauldron bubble pop. Pitch ±4 semitones. */
export function playBubblePop(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 0.8, wet: 0.35 }).connect(dryGain)
    const freq = 220 * randSemitones(4)
    const synth = new T.FMSynth({
      harmonicity: 0.5, modulationIndex: 10,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 }, volume: -10,
    }).connect(reverb)
    synth.triggerAttackRelease(freq, '32n', now)
    const noise = new T.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 }, volume: -20,
    }).connect(reverb)
    noise.triggerAttackRelease('32n', now)
    setTimeout(() => { synth.dispose(); noise.dispose(); reverb.dispose() }, 600)
  } catch { /* non-critical */ }
}

/** Eerie descending squeal for boo-blast ghost hits. */
export function playGhostScream(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 1.8, wet: 0.55 }).connect(dryGain)
    const synth = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.45, sustain: 0.1, release: 0.35 }, volume: -10,
    }).connect(reverb)
    ;[880, 659, 494, 330, 220].forEach((f, i) =>
      synth.triggerAttackRelease(f * randSemitones(1), '32n', now + i * 0.07))
    const noise = new T.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.05, decay: 0.35, sustain: 0, release: 0.15 }, volume: -22,
    }).connect(reverb)
    noise.triggerAttackRelease('4n', now)
    setTimeout(() => { synth.dispose(); noise.dispose(); reverb.dispose() }, 1000)
  } catch { /* non-critical */ }
}

/** High bell cluster for snow-catch. Pitch ±3 semitones from random C6-C7. */
export function playSnowTinkle(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 2.0, wet: 0.65 }).connect(dryGain)
    const pool = [1046.5, 1174.66, 1318.51, 1396.91, 1568, 1760, 2093]
    const base = pool[Math.floor(Math.random() * pool.length)] * randSemitones(3)
    const bell = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.35, sustain: 0.02, release: 1.0 }, volume: -10,
    }).connect(reverb)
    bell.triggerAttackRelease(base, '16n', now)
    bell.triggerAttackRelease(base * 2, '32n', now + 0.04)
    setTimeout(() => { bell.dispose(); reverb.dispose() }, 1400)
  } catch { /* non-critical */ }
}

/** Rapid jingle trio for gift-rush. */
export function playGiftJingle(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 1.2, wet: 0.45 }).connect(dryGain)
    const bell = new T.MetalSynth({
      envelope: { attack: 0.001, decay: 0.14, release: 0.1 },
      harmonicity: 5.1, modulationIndex: 16,
      resonance: 2000 + Math.random() * 800, octaves: 0.5, volume: -14,
    }).connect(reverb)
    bell.triggerAttackRelease('16n', now)
    bell.triggerAttackRelease('16n', now + 0.07)
    bell.triggerAttackRelease('16n', now + 0.14)
    const chord = new T.PolySynth(T.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0.05, release: 0.5 }, volume: -18,
    }).connect(reverb)
    chord.triggerAttackRelease(['C5','E5','G5'], '8n', now)
    setTimeout(() => { bell.dispose(); chord.dispose(); reverb.dispose() }, 900)
  } catch { /* non-critical */ }
}

/** String pluck for cupid-shot arrow fire. Pitch ±2 semitones. */
export function playBowTwang(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 0.8, wet: 0.25 }).connect(dryGain)
    const freq = 246.94 * randSemitones(2)
    const synth = new T.FMSynth({
      harmonicity: 2, modulationIndex: 5,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.1, release: 0.5 },
      modulation: { type: 'triangle' },
      modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0.1, release: 0.5 },
      volume: -10,
    }).connect(reverb)
    synth.triggerAttackRelease(freq, '8n', now)
    const noise = new T.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 }, volume: -18,
    }).connect(dryGain)
    noise.triggerAttackRelease('64n', now)
    setTimeout(() => { synth.dispose(); noise.dispose(); reverb.dispose() }, 1200)
  } catch { /* non-critical */ }
}

/** Warm thud + ascending E4→G4→C5 for cupid-shot hits. */
export function playHeartHit(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 1.5, wet: 0.45 }).connect(dryGain)
    const kick = new T.MembraneSynth({
      pitchDecay: 0.04, octaves: 6, volume: -12,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
    }).connect(dryGain)
    kick.triggerAttackRelease('F2', '8n', now)
    const melody = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0.05, release: 0.5 }, volume: -12,
    }).connect(reverb)
    ;['E4','G4','C5'].forEach((n, i) => melody.triggerAttackRelease(n, '16n', now + 0.02 + i * 0.07))
    const sp = new T.MetalSynth({
      envelope: { attack: 0.001, decay: 0.12, release: 0.08 },
      harmonicity: 5.1, modulationIndex: 12, resonance: 1200, octaves: 0.5, volume: -22,
    }).connect(reverb)
    sp.triggerAttackRelease('16n', now + 0.18)
    setTimeout(() => { kick.dispose(); melody.dispose(); sp.dispose(); reverb.dispose() }, 1100)
  } catch { /* non-critical */ }
}

/**
 * playPianoNote — piano-like tone for love-note game.
 * freq: Hz (e.g. 261.63=C4). Bright transient + warm triangle decay.
 */
export function playPianoNote(freq: number): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 2.8, wet: 0.4 }).connect(dryGain)
    const main = new T.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.002, decay: 0.8, sustain: 0.15, release: 1.2 }, volume: -10,
    }).connect(reverb)
    const bright = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 }, volume: -18,
    }).connect(reverb)
    main.triggerAttackRelease(freq, '4n', now)
    bright.triggerAttackRelease(freq * 2, '64n', now)
    setTimeout(() => { main.dispose(); bright.dispose(); reverb.dispose() }, 2800)
  } catch { /* non-critical */ }
}

/**
 * playScanBeep — match/miss beep for symbol-scan.
 * matched: ascending double ping | !matched: low FM buzz.
 */
export function playScanBeep(matched: boolean): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    if (matched) {
      const reverb = new T.Reverb({ decay: 0.5, wet: 0.2 }).connect(dryGain)
      const synth = new T.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.08 }, volume: -10,
      }).connect(reverb)
      const base = 880 * randSemitones(2)
      synth.triggerAttackRelease(base, '32n', now)
      synth.triggerAttackRelease(base * 1.25, '32n', now + 0.09)
      setTimeout(() => { synth.dispose(); reverb.dispose() }, 600)
    } else {
      const synth = new T.FMSynth({
        harmonicity: 0.5, modulationIndex: 8,
        envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.1 }, volume: -12,
      }).connect(dryGain)
      synth.triggerAttackRelease('A2', '8n', now)
      setTimeout(() => synth.dispose(), 500)
    }
  } catch { /* non-critical */ }
}

/**
 * playStackThud — pitched thud for stack-drop blocks.
 * height: blocks stacked. ±2 semitone variation.
 */
export function playStackThud(height: number): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 0.5, wet: 0.2 }).connect(dryGain)
    const freq = 32.7 * Math.pow(2, Math.min(12, Math.floor(height / 2)) / 12) * randSemitones(2)
    const kick = new T.MembraneSynth({
      pitchDecay: 0.05, octaves: 8, volume: -8,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.12 },
    }).connect(dryGain)
    kick.triggerAttackRelease(freq, '8n', now)
    const body = new T.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 }, volume: -16,
    }).connect(reverb)
    body.triggerAttackRelease(freq * 4, '32n', now)
    setTimeout(() => { kick.dispose(); body.dispose(); reverb.dispose() }, 700)
  } catch { /* non-critical */ }
}

/**
 * playBalanceCreak — creaking for balance-beam tilt.
 * tiltAmount 0..1 (0=center, 1=max). Pitch and volume scale with tilt.
 */
export function playBalanceCreak(tiltAmount: number): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const a = Math.max(0, Math.min(1, tiltAmount))
    const freq = (180 + a * 420) * randSemitones(0.5)
    const vol = -28 + a * 10
    const synth = new T.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.01, decay: 0.08, sustain: 0.2, release: 0.12 }, volume: vol,
    }).connect(dryGain)
    synth.triggerAttackRelease(freq, '64n', now)
    if (a > 0.5) {
      const noise = new T.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 0.01, decay: 0.07, sustain: 0, release: 0.04 }, volume: vol - 6,
      }).connect(dryGain)
      noise.triggerAttackRelease('32n', now)
      setTimeout(() => { synth.dispose(); noise.dispose() }, 350)
    } else {
      setTimeout(() => synth.dispose(), 280)
    }
  } catch { /* non-critical */ }
}

/** Synthesized turkey gobble for turkey-trot. ±2 semitone pitch variation. */
export function playGobble(): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 0.6, wet: 0.3 }).connect(dryGain)
    const base = 220 * randSemitones(2)
    const synth = new T.FMSynth({
      harmonicity: 1.5, modulationIndex: 6,
      envelope: { attack: 0.02, decay: 0.15, sustain: 0.3, release: 0.2 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.2 }, volume: -10,
    }).connect(reverb)
    synth.triggerAttackRelease(base, '32n', now)
    synth.triggerAttackRelease(base * 1.33, '16n', now + 0.06)
    synth.triggerAttackRelease(base, '32n', now + 0.15)
    setTimeout(() => { synth.dispose(); reverb.dispose() }, 700)
  } catch { /* non-critical */ }
}

/**
 * playHarvestThud — basket catch thud for harvest-catch.
 * pitchNote: semitone offset from C1 (vary per item type). ±1.5 semitone variation.
 */
export function playHarvestThud(pitchNote: number = 0): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const reverb = new T.Reverb({ decay: 0.4, wet: 0.2 }).connect(dryGain)
    const freq = 32.7 * Math.pow(2, pitchNote / 12) * randSemitones(1.5)
    const kick = new T.MembraneSynth({
      pitchDecay: 0.04, octaves: 6, volume: -10,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
    }).connect(dryGain)
    kick.triggerAttackRelease(freq, '16n', now)
    const body = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 }, volume: -18,
    }).connect(reverb)
    body.triggerAttackRelease(freq * 3, '32n', now)
    setTimeout(() => { kick.dispose(); body.dispose(); reverb.dispose() }, 600)
  } catch { /* non-critical */ }
}

/**
 * playOrbitHum — gravitational resonance for orbit-control.
 * proximity 0..1 (1=close to planet). Closer = louder + brighter tone.
 */
export function playOrbitHum(proximity: number = 0.5): void {
  if (!initialized || muted || !Tone) return
  try {
    const T = Tone; const now = T.now()
    const a = Math.max(0, Math.min(1, proximity))
    const reverb = new T.Reverb({ decay: 3.0, wet: 0.6 }).connect(dryGain)
    const freq = 55 + a * 110
    const synth = new T.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.06, decay: 0.2, sustain: 0.5, release: 0.5 }, volume: -28 + a * 10,
    }).connect(reverb)
    synth.triggerAttackRelease(freq, '8n', now)
    setTimeout(() => { synth.dispose(); reverb.dispose() }, 900)
  } catch { /* non-critical */ }
}
