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
  const T = await getTone()
  if (!T) return
  await T.start()

  masterCompressor = new T.Compressor({ threshold: -14, ratio: 3, attack: 0.003, release: 0.25 })
  const masterLimiter = new T.Limiter(-3)
  masterCompressor.connect(masterLimiter)
  masterLimiter.toDestination()

  masterReverb = new T.Reverb({ decay: 2.0, wet: 0.3 })
  await masterReverb.ready  // CRITICAL — must await or reverb sounds broken
  masterReverb.toDestination()

  dryGain = new T.Gain(0.9).connect(masterCompressor)

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

// ─── Music Patterns ───────────────────────────────────────────────────────────
export type MusicPattern = 'tense' | 'calm' | 'pulse' | 'drive' | 'ambient' | 'minimal'

export function startMusic(pattern: MusicPattern): () => void {
  if (!initialized || muted || !Tone) return () => {}
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
    default:        return () => {}
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
