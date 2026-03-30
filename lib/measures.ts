/**
 * Ether behavioral signal map — what each Glimmer measures.
 *
 * Core signals lean into Ether's four pillars:
 *   Trust · Confidence · Excitement · Belonging
 * Two supporting signals for games that genuinely need them:
 *   Focus · Calm
 */

export type EtherSignal =
  | 'Trust'
  | 'Confidence'
  | 'Excitement'
  | 'Belonging'
  | 'Readiness'
  | 'Focus'
  | 'Calm';

export const GAME_MEASURES: Record<string, EtherSignal[]> = {
  // ── Skill ──────────────────────────────────────────────────────────────────
  'paint-splash':    ['Excitement',  'Belonging'],    // chaotic fun, everyone splashes
  'web-weave':       ['Focus',       'Trust'],        // patient, committed threading
  'treasure-dive':   ['Excitement',  'Confidence'],   // bold navigation under pressure
  'frog-leap':       ['Excitement',  'Confidence'],   // split-second decisive jumps
  'wire-cross':      ['Trust',       'Focus'],        // deliberate, no shortcuts
  'balloon-pop':     ['Excitement',  'Belonging'],    // frantic shared energy
  'slingshot-smash': ['Confidence',  'Excitement'],   // power + commit to the release
  'ripple-tap':      ['Trust',       'Confidence'],   // read the moment, trust the timing
  'pendulum-swing':  ['Trust',       'Focus'],        // sustained rhythmic commitment
  'node-connect':    ['Focus',       'Trust'],        // methodical puzzle solving
  'orbit-launch':    ['Confidence',  'Trust'],        // commit to the angle, hold the line
  'speed-sort':      ['Readiness',   'Confidence'],   // snap categorization = brand familiarity at speed
  'spring-leap':     ['Confidence',  'Excitement'],   // charge and commit fully
  'crystal-catch':   ['Focus',       'Calm'],         // gentle steady collection
  'wobble-stack':    ['Trust',       'Focus'],        // patience against chaos
  'chain-reaction':  ['Excitement',  'Confidence'],   // one bold tap, max impact
  'pixel-paint':     ['Confidence',  'Excitement'],   // fast decisive brushstrokes
  'drop-zone':       ['Trust',       'Confidence'],   // wait for it, then commit
  'laser-guide':     ['Focus',       'Trust'],        // precise patient reflection
  'friction-slide':  ['Confidence',  'Trust'],        // controlled force with intent
  'gravity-well':    ['Trust',       'Focus'],        // patient orbit, resist the pull
  'tilt-maze':       ['Trust',       'Focus'],        // whole-body commitment to the path
  'whisper-bomb':    ['Calm',        'Trust'],        // silence requires discipline
  'breath-rider':    ['Calm',        'Focus'],        // breath as control mechanism
  'steady-hand':     ['Trust',       'Calm'],         // composure under pressure
  'tunnel':          ['Excitement',  'Confidence'],   // fast instinctive navigation
  'pulse-sphere':    ['Calm',        'Belonging'],    // tactile shared calm experience
  'shadow-tap':      ['Excitement',  'Focus'],        // urgency + sharp attention
  'color-cascade':   ['Readiness',   'Excitement'],   // fast brand colour recognition
  'equation-tap':    ['Readiness',   'Confidence'],   // brand knowledge under pressure
  'color-word':      ['Readiness',   'Focus'],        // override instinct with learned info
  'visual-search':   ['Readiness',   'Focus'],        // scan and recognise = brand recall
  'odd-one-out':     ['Readiness',   'Confidence'],   // spot the misfit = brand literacy
  'pattern-predict': ['Readiness',   'Trust'],        // predict = primed consumer
  'reflex-grid':     ['Excitement',  'Readiness'],    // reactive brand recognition
  'sequence-unlock': ['Readiness',   'Trust'],        // remember the sequence = learned
  'word-flash':      ['Readiness',   'Focus'],        // rapid recall = brand top-of-mind
  'rhythm-repeat':   ['Belonging',   'Readiness'],    // pattern memory = brand retention
  'category-clash':  ['Readiness',   'Excitement'],   // fast sort = category ownership
  'memory-grid':     ['Readiness',   'Focus'],        // brand recall depth
  'reaction-chain':  ['Excitement',  'Confidence'],   // sustain the rush
  'stack-drop':      ['Trust',       'Confidence'],   // precision drop, commit
  'dodge-blitz':     ['Excitement',  'Confidence'],   // survival instinct at speed
  'crowd-roar':      ['Belonging',   'Excitement'],   // collective vocal energy peak
  'balance-beam':    ['Trust',       'Calm'],         // stillness is the game
  'path-trace':      ['Trust',       'Focus'],        // patient deliberate following
  'pitch-match':     ['Belonging',   'Confidence'],   // find your voice, hold it
  'symbol-scan':     ['Focus',       'Excitement'],   // race to find the target
  'neon-archer':     ['Confidence',  'Trust'],        // draw, hold, release
  'ice-sculptor':    ['Excitement',  'Focus'],        // urgency + precision chipping
  'gravity-flip':    ['Excitement',  'Confidence'],   // instinct + decisive taps
  'volcano-tap':     ['Excitement',  'Belonging'],    // fast chaos, shared stakes
  'marathon-pace':   ['Trust',       'Confidence'],   // paced commitment over time
  'hot-potato':      ['Excitement',  'Belonging'],    // shared panic energy

  // ── Sports ─────────────────────────────────────────────────────────────────
  'slam-dunk':       ['Confidence',  'Excitement'],   // power + peak commitment
  'archery-draw':    ['Trust',       'Confidence'],   // patient draw, bold release
  'hockey-slap':     ['Confidence',  'Excitement'],   // aggression + timing
  'javelin-throw':   ['Confidence',  'Excitement'],   // peak power, full commit
  'bowling-curve':   ['Confidence',  'Trust'],        // read the lane, trust the curve
  'swimming-stroke': ['Trust',       'Belonging'],    // rhythmic sync, team sport feel
  'dart-board':      ['Confidence',  'Focus'],        // aim, commit, release
  'track-sprint':    ['Excitement',  'Confidence'],   // raw speed + burst energy
  'discus-spin':     ['Confidence',  'Trust'],        // build momentum, release fully
  'boxing-combo':    ['Excitement',  'Confidence'],   // aggression + pattern
  'hoop-shot':       ['Confidence',  'Excitement'],   // score at pace
  'penalty-kick':    ['Confidence',  'Trust'],        // high-stakes single moment
  'spiral-throw':    ['Confidence',  'Trust'],        // timing + committed release
  'reflex-rally':    ['Excitement',  'Confidence'],   // return everything, never stop
  'precision-putt':  ['Trust',       'Focus'],        // read, commit, execute quietly

  // ── Holiday ─────────────────────────────────────────────────────────────────
  'gift-rush':       ['Excitement',  'Belonging'],    // festive shared urgency
  'snow-catch':      ['Belonging',   'Calm'],         // gentle seasonal wonder
  'boo-blast':       ['Excitement',  'Belonging'],    // spooky shared frenzy
  'cauldron-bubble': ['Excitement',  'Belonging'],    // group vocal magic
  'firework-launch': ['Excitement',  'Belonging'],    // peak celebration moment
  'countdown-crush': ['Excitement',  'Belonging'],    // New Year collective rush
  'cupid-shot':      ['Trust',       'Excitement'],   // wait for the perfect moment
  'love-note':       ['Trust',       'Belonging'],    // memory as affection
  'turkey-trot':     ['Excitement',  'Belonging'],    // Thanksgiving communal fun
  'harvest-catch':   ['Belonging',   'Excitement'],   // seasonal shared bounty
  'shamrock-shuffle':['Excitement',  'Belonging'],    // St Patrick's shared luck
  'egg-toss':        ['Trust',       'Belonging'],    // delicate cooperation
  'pinata-smash':    ['Excitement',  'Belonging'],    // peak hit together
  'flower-bouquet':  ['Belonging',   'Calm'],         // gentle collective beauty
  'bbq-master':      ['Confidence',  'Belonging'],    // dad energy, crowd approval
  'sparkler-draw':   ['Excitement',  'Belonging'],    // light + shared creation
  'pencil-pack':     ['Excitement',  'Focus'],        // back-to-school urgency
  'diya-light':      ['Belonging',   'Trust'],        // Diwali sequential ritual
  'dreidel-spin':    ['Excitement',  'Belonging'],    // Hanukkah communal play
  'dragon-parade':   ['Belonging',   'Excitement'],   // CNY multi-touch collective
  'bead-catch':      ['Belonging',   'Excitement'],   // Mardi Gras shared chaos
  'lantern-float':   ['Belonging',   'Calm'],         // collective release + peace
  'taco-toss':       ['Excitement',  'Belonging'],    // Cinco de Mayo shared fun
  'basket-weave':    ['Trust',       'Belonging'],    // patient communal craft
  'clover-path':     ['Trust',       'Belonging'],    // lucky shared journey
  'signal-boost':    ['Belonging',   'Trust'],        // hum to sustain together
  'crystal-grow':    ['Calm',        'Trust'],        // breath as collective ritual

  // ── Breath / Voice ──────────────────────────────────────────────────────────
  'echo-clap':       ['Belonging',   'Excitement'],   // call-and-response energy
  'solar-charge':    ['Calm',        'Trust'],        // silence = collective power
  'aurora-wave':     ['Calm',        'Belonging'],    // breathing together creates beauty
  'dragon-breath':   ['Excitement',  'Confidence'],   // unleash, project, feel powerful
  'voice-sculpt':    ['Confidence',  'Calm'],         // voice as creative instrument
  'echo-match':      ['Belonging',   'Trust'],        // match the echo, connect
  'howl-wolf':       ['Belonging',   'Excitement'],   // call the pack, release together
  'beat-box':        ['Confidence',  'Belonging'],    // own the beat, set the rhythm
  'hum-maze':        ['Focus',       'Calm'],         // navigate through sound
  'chant-power':     ['Belonging',   'Excitement'],   // collective vocal charge
  'whistle-launch':  ['Confidence',  'Excitement'],   // voice as launch mechanism
  'vocal-shield':    ['Confidence',  'Trust'],        // hold the note, protect the space
  'breath-sculpt':   ['Calm',        'Confidence'],   // breath is the creative tool
  'frequency-tune':  ['Focus',       'Trust'],        // precise sustained tone
  'lung-capacity':   ['Confidence',  'Calm'],         // own your breath
  'sound-waves':     ['Excitement',  'Confidence'],   // volume = power
  'sing-along':      ['Belonging',   'Confidence'],   // find your voice in the group
  'morse-tap':       ['Focus',       'Trust'],        // deliberate rhythmic code
  'morse-decode':    ['Focus',       'Confidence'],   // crack it, trust the read
  'code-breaker':    ['Focus',       'Trust'],        // systematic, patient unlock

  // ── Cognitive (extra) ────────────────────────────────────────────────────────
  'pulse-jump':      ['Excitement',  'Trust'],        // stay in rhythm, trust the beat
  'domino-chain':    ['Trust',       'Excitement'],   // set it up, let it fall
  'number-crunch':   ['Confidence',  'Focus'],        // math under pressure = competence
  'mirror-mind':     ['Focus',       'Trust'],        // bilateral sync discipline
  'number-path':     ['Confidence',  'Focus'],        // fastest finger wins
  'logic-gate':      ['Trust',       'Focus'],        // systematic reasoning
  'binary-decode':   ['Confidence',  'Focus'],        // crack the code
  'attention-switch':['Focus',       'Confidence'],   // handle multiple things = capable
  'face-memory':     ['Trust',       'Belonging'],    // remember faces = social warmth
  'inference-trail': ['Trust',       'Focus'],        // follow the logic, commit
  'spatial-map':     ['Confidence',  'Focus'],        // mental navigation = mastery
  'neon-chess':      ['Confidence',  'Focus'],        // one best move, own it
  'shape-rotate':    ['Confidence',  'Focus'],        // spatial confidence
  'type-speed':      ['Confidence',  'Excitement'],   // race the clock, fingers fly

  // ── Skill (extra) ────────────────────────────────────────────────────────────
  'bubble-burst':    ['Excitement',  'Focus'],        // urgency + precise timing
  'tower-stack':     ['Trust',       'Confidence'],   // drop exactly right
  'bounce-pass':     ['Confidence',  'Trust'],        // angle + commit
  'gear-grind':      ['Focus',       'Trust'],        // mechanical patience
  'thread-needle':   ['Trust',       'Focus'],        // extreme precision, no rush
  'jigsaw-rush':     ['Excitement',  'Confidence'],   // fast spatial snap
  'cable-wrap':      ['Focus',       'Trust'],        // clean methodical wrap
  'magnet-maze':     ['Focus',       'Trust'],        // push/pull logic navigation
  'cosmic-catch':    ['Excitement',  'Focus'],        // reach + swipe urgency
  'wormhole-dive':   ['Excitement',  'Confidence'],   // speed + survival instinct
  'dream-catch':     ['Calm',        'Belonging'],    // float and gather gently
  'sound-garden':    ['Belonging',   'Calm'],         // grow beauty through touch

  // ── Sports (extra) ──────────────────────────────────────────────────────────
  'curling-sweep':   ['Belonging',   'Confidence'],   // team sport precision
  'rowing-rhythm':   ['Belonging',   'Trust'],        // sync strokes, commit together
  'baseball-swing':  ['Confidence',  'Excitement'],   // see it, swing, commit
  'karate-chop':     ['Confidence',  'Excitement'],   // explosive decisive strike
  'pole-vault':      ['Confidence',  'Trust'],        // run, plant, fly — total commit
  'table-tennis':    ['Excitement',  'Confidence'],   // return everything fast
  'gymnast-beam':    ['Trust',       'Confidence'],   // composure = performance
  'pixel-skate':     ['Confidence',  'Excitement'],   // trick combos = bold play
  'surf-ride':       ['Trust',       'Excitement'],   // ride the wave, don't fight it
  'ski-slalom':      ['Confidence',  'Excitement'],   // carved speed through gates
};

/** Ether signal brand colours */
export const SIGNAL_COLOR: Record<EtherSignal, string> = {
  'Trust':       '#5b9fc0',   // Ether steel blue
  'Confidence':  '#f97316',   // bold orange
  'Excitement':  '#f43f5e',   // electric rose
  'Belonging':   '#a855f7',   // warm violet
  'Readiness':   '#eab308',   // warm gold
  'Focus':       '#10b981',   // teal green
  'Calm':        '#34d399',   // soft mint
};

/** Brand-consumer signal descriptions — what each signal means in an experiential context */
export const SIGNAL_DESC: Record<EtherSignal, string> = {
  'Trust':      'Does the consumer commit to the brand experience — or bail?',
  'Confidence': 'Does the brand make the consumer feel capable and in control?',
  'Excitement': 'Does the activation generate real energy and brand arousal?',
  'Belonging':  'Does the consumer feel like they\'re part of something with this brand?',
  'Readiness':  'How educated and primed is the consumer to act on the brand?',
  'Focus':      'How deeply does the consumer engage with the brand experience?',
  'Calm':       'Does the brand create a sense of ease, safety, and presence?',
};

