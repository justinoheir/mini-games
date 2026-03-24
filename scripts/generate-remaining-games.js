/**
 * generate-remaining-games.js
 * Generates all remaining Glimmers game files (TypeScript + test specs)
 * Run: node scripts/generate-remaining-games.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'app/games');
const TESTS_DIR = path.join(ROOT, 'tests');

// ─── Game Configurations ───────────────────────────────────────────────────────

const GAMES = [
  // ── SKILL / TOUCH ──────────────────────────────────────────────────────────
  {
    id: 'thread-needle', title: 'Thread Needle', tagline: 'Steady hands only. Pros need not apply.',
    accent: '#e879f9', duration: 30, category: 'skill', industries: ['healthcare','retail','cpg'],
    archetype: 'drag-trace', icon: 'pivot_table_chart',
    params: {
      bg: '#0d001a', objColor: '#e879f9', objSecond: '#ffffff',
      desc: 'Drag thread through moving needle eye without touching sides',
      signals: [
        { name: 'attempts', label: 'Attempts' },
        { name: 'successes', label: 'Threads' },
        { name: 'avgPrecision', label: 'Precision' },
        { name: 'maxStreak', label: 'Best Streak' },
      ],
      personalities: [
        { cond: 'sig.successes >= 8 && avgPrecision >= 85', label: 'Surgeon 🔬', emoji: '🔬' },
        { cond: 'sig.successes >= 5', label: 'Craftsperson 🧵', emoji: '🧵' },
        { cond: 'sig.maxStreak >= 3', label: 'Focused 🎯', emoji: '🎯' },
        { cond: 'true', label: 'Shaky ✋', emoji: '✋' },
      ],
    }
  },
  {
    id: 'jigsaw-rush', title: 'Jigsaw Rush', tagline: 'Snap it. Fast. Clock\'s ticking.',
    accent: '#fbbf24', duration: 60, category: 'skill', industries: ['retail','technology','cpg'],
    archetype: 'tap-sequence', icon: 'extension',
    params: {
      bg: '#1a1400', objColor: '#fbbf24', objSecond: '#ff8c00',
      desc: 'Tap pieces in the highlighted order to complete the jigsaw',
      signals: [
        { name: 'piecesPlaced', label: 'Placed' },
        { name: 'wrongTaps', label: 'Wrong' },
        { name: 'maxStreak', label: 'Streak' },
        { name: 'puzzlesCompleted', label: 'Puzzles' },
      ],
      personalities: [
        { cond: 'sig.puzzlesCompleted >= 3 && sig.wrongTaps <= 5', label: 'Speed Puzzler ⚡', emoji: '⚡' },
        { cond: 'sig.puzzlesCompleted >= 2', label: 'Sharp Eye 👁️', emoji: '👁️' },
        { cond: 'sig.piecesPlaced >= 12', label: 'Persistent 💪', emoji: '💪' },
        { cond: 'true', label: 'Learning 🧩', emoji: '🧩' },
      ],
    }
  },
  {
    id: 'magnet-maze', title: 'Magnet Maze', tagline: 'Attract, repel, navigate.',
    accent: '#ef4444', duration: 60, category: 'skill', industries: ['technology','automotive','healthcare'],
    archetype: 'drag-trace', icon: 'explore',
    params: {
      bg: '#0a0000', objColor: '#ef4444', objSecond: '#fbbf24',
      desc: 'Hold to attract, release to repel magnetic ball through maze to goal',
      signals: [
        { name: 'attempts', label: 'Attempts' },
        { name: 'successes', label: 'Exits' },
        { name: 'wallHits', label: 'Wall Hits' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.successes >= 4 && sig.wallHits <= 10', label: 'Navigator 🧭', emoji: '🧭' },
        { cond: 'sig.successes >= 2', label: 'Pathfinder 🗺️', emoji: '🗺️' },
        { cond: 'sig.wallHits <= 20', label: 'Careful 🐢', emoji: '🐢' },
        { cond: 'true', label: 'Lost 😵', emoji: '😵' },
      ],
    }
  },
  {
    id: 'cable-wrap', title: 'Cable Wrap', tagline: 'No tangles. No mercy.',
    accent: '#34d399', duration: 45, category: 'skill', industries: ['technology','automotive','retail'],
    archetype: 'drag-trace', icon: 'cable',
    params: {
      bg: '#001a0d', objColor: '#34d399', objSecond: '#86efac',
      desc: 'Drag cable around pegs in correct order without crossing',
      signals: [
        { name: 'attempts', label: 'Attempts' },
        { name: 'completions', label: 'Wrapped' },
        { name: 'tangles', label: 'Tangles' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.completions >= 4 && sig.tangles <= 3', label: 'Cable Boss 🔌', emoji: '🔌' },
        { cond: 'sig.completions >= 2', label: 'Tidy 🧹', emoji: '🧹' },
        { cond: 'sig.tangles > 8', label: 'Tangled 🤕', emoji: '🤕' },
        { cond: 'true', label: 'Getting There 📎', emoji: '📎' },
      ],
    }
  },
  {
    id: 'bubble-burst', title: 'Bubble Burst', tagline: 'Pinch at the perfect size!',
    accent: '#67e8f9', duration: 30, category: 'skill', industries: ['cpg','retail','food_bev'],
    archetype: 'timing-tap', icon: 'bubble_chart',
    params: {
      bg: '#001a1a', objColor: '#67e8f9', objSecond: '#a5f3fc',
      desc: 'Tap bubble precisely at maximum size before it pops or shrinks',
      signals: [
        { name: 'attempts', label: 'Bubbles' },
        { name: 'perfectTaps', label: 'Perfect' },
        { name: 'avgAccuracy', label: 'Accuracy' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.perfectTaps >= 10', label: 'Bubble Master 🫧', emoji: '🫧' },
        { cond: 'accuracy >= 0.7', label: 'Precise 🎯', emoji: '🎯' },
        { cond: 'sig.attempts >= 20', label: 'Tenacious 💪', emoji: '💪' },
        { cond: 'true', label: 'Pop Learner 💭', emoji: '💭' },
      ],
    }
  },
  {
    id: 'tower-stack', title: 'Tower Stack', tagline: 'Drop it. Stack it. Don\'t tip it.',
    accent: '#f59e0b', duration: 60, category: 'skill', industries: ['cpg','retail','food_bev'],
    archetype: 'timing-tap', icon: 'view_in_ar',
    params: {
      bg: '#1a0d00', objColor: '#f59e0b', objSecond: '#fcd34d',
      desc: 'Tap to drop swinging platform onto growing tower with precision',
      signals: [
        { name: 'attempts', label: 'Drops' },
        { name: 'perfectDrops', label: 'Perfect' },
        { name: 'towerHeight', label: 'Height' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.towerHeight >= 10 && sig.perfectDrops >= 6', label: 'Architect 🏗️', emoji: '🏗️' },
        { cond: 'sig.towerHeight >= 7', label: 'Builder 🧱', emoji: '🧱' },
        { cond: 'sig.perfectDrops >= 4', label: 'Precise 📐', emoji: '📐' },
        { cond: 'true', label: 'Tumbling 🎲', emoji: '🎲' },
      ],
    }
  },
  {
    id: 'bounce-pass', title: 'Bounce Pass', tagline: 'Angle the bounce. Make the pass.',
    accent: '#84cc16', duration: 45, category: 'skill', industries: ['sports','technology','cpg'],
    archetype: 'swipe-launch', icon: 'sports',
    params: {
      bg: '#071a00', objColor: '#84cc16', objSecond: '#bef264',
      desc: 'Swipe to angle ball so it bounces off walls to reach target receiver',
      signals: [
        { name: 'attempts', label: 'Throws' },
        { name: 'successes', label: 'Passes' },
        { name: 'avgAccuracy', label: 'Accuracy' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.successes >= 8 && accuracy >= 0.7', label: 'Point Guard 🏀', emoji: '🏀' },
        { cond: 'sig.successes >= 5', label: 'Playmaker ⚡', emoji: '⚡' },
        { cond: 'sig.maxStreak >= 4', label: 'On Fire 🔥', emoji: '🔥' },
        { cond: 'true', label: 'Learning 📐', emoji: '📐' },
      ],
    }
  },
  {
    id: 'gear-grind', title: 'Gear Grind', tagline: 'Mesh the gears. Keep it spinning.',
    accent: '#94a3b8', duration: 60, category: 'skill', industries: ['automotive','technology','finance'],
    archetype: 'drag-trace', icon: 'settings',
    params: {
      bg: '#0a0a0a', objColor: '#94a3b8', objSecond: '#cbd5e1',
      desc: 'Drag gears into mesh positions so the whole system turns without jamming',
      signals: [
        { name: 'gearsPlaced', label: 'Gears' },
        { name: 'systemsRunning', label: 'Systems' },
        { name: 'jams', label: 'Jams' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.systemsRunning >= 3 && sig.jams <= 5', label: 'Engineer ⚙️', emoji: '⚙️' },
        { cond: 'sig.systemsRunning >= 2', label: 'Mechanic 🔧', emoji: '🔧' },
        { cond: 'sig.gearsPlaced >= 10', label: 'Grinder 💪', emoji: '💪' },
        { cond: 'true', label: 'Tinkerer 🔩', emoji: '🔩' },
      ],
    }
  },
  {
    id: 'wormhole-dive', title: 'Wormhole Dive', tagline: 'Survive the warp. Keep diving.',
    accent: '#7c3aed', duration: 60, category: 'skill', industries: ['technology','automotive','finance'],
    archetype: 'swipe-steer', icon: 'blur_circular',
    params: {
      bg: '#0a0014', objColor: '#7c3aed', objSecond: '#a78bfa',
      desc: 'Swipe to navigate curved wormhole, avoid walls, survive the warp',
      signals: [
        { name: 'distance', label: 'Distance' },
        { name: 'wallHits', label: 'Hits' },
        { name: 'maxSpeed', label: 'Max Speed' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.distance >= 500 && sig.wallHits <= 5', label: 'Warp Pilot 🚀', emoji: '🚀' },
        { cond: 'sig.distance >= 300', label: 'Deep Diver 🌀', emoji: '🌀' },
        { cond: 'sig.wallHits <= 10', label: 'Smooth Traveler ✨', emoji: '✨' },
        { cond: 'true', label: 'Lost in Space 🛸', emoji: '🛸' },
      ],
    }
  },
  {
    id: 'dream-catch', title: 'Dream Catch', tagline: 'Float through. Catch the fragments.',
    accent: '#818cf8', duration: 60, category: 'skill', industries: ['healthcare','retail','technology'],
    archetype: 'tap-spawn', icon: 'nights_stay',
    params: {
      bg: '#070014', objColor: '#818cf8', objSecond: '#c7d2fe',
      desc: 'Touch glowing dream fragments as they float through the dreamscape',
      signals: [
        { name: 'totalFragments', label: 'Fragments' },
        { name: 'caught', label: 'Caught' },
        { name: 'avgReaction', label: 'Reaction' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.caught >= 15 && avgReaction < 500', label: 'Dream Weaver 🌙', emoji: '🌙' },
        { cond: 'sig.caught >= 10', label: 'Dream Catcher 🌟', emoji: '🌟' },
        { cond: 'sig.maxStreak >= 5', label: 'Focused ✨', emoji: '✨' },
        { cond: 'true', label: 'Daydreamer 💭', emoji: '💭' },
      ],
    }
  },
  // ── SPORTS ─────────────────────────────────────────────────────────────────
  {
    id: 'curling-sweep', title: 'Curling Sweep', tagline: 'Sweep it in. Sweep it hard.',
    accent: '#67e8f9', duration: 60, category: 'sports', industries: ['sports','cpg','retail'],
    archetype: 'timing-tap', icon: 'cleaning_services',
    params: {
      bg: '#001a1f', objColor: '#67e8f9', objSecond: '#a5f3fc',
      desc: 'Swipe ahead of stone to guide it toward target ring',
      signals: [
        { name: 'stones', label: 'Stones' },
        { name: 'bulls', label: 'Bulls' },
        { name: 'sweepPower', label: 'Power' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.bulls >= 5 && sig.sweepPower >= 400', label: 'Skip Champion 🥌', emoji: '🥌' },
        { cond: 'sig.bulls >= 3', label: 'Ice Master ❄️', emoji: '❄️' },
        { cond: 'sig.stones >= 8', label: 'Sweeper 🧹', emoji: '🧹' },
        { cond: 'true', label: 'Ice Rookie 🧊', emoji: '🧊' },
      ],
    }
  },
  {
    id: 'rowing-rhythm', title: 'Rowing Rhythm', tagline: 'Sync your strokes. Row!',
    accent: '#38bdf8', duration: 60, category: 'sports', industries: ['sports','healthcare','food_bev'],
    archetype: 'rhythm-tap', icon: 'rowing',
    params: {
      bg: '#001014', objColor: '#38bdf8', objSecond: '#7dd3fc',
      desc: 'Double-tap in rhythm to row the boat; maintain pace for max speed',
      signals: [
        { name: 'strokes', label: 'Strokes' },
        { name: 'perfectStrokes', label: 'Perfect' },
        { name: 'maxCadence', label: 'Max BPM' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.perfectStrokes >= 20 && sig.maxCadence >= 60', label: 'Olympic Rower 🚣', emoji: '🚣' },
        { cond: 'sig.perfectStrokes >= 12', label: 'Steady Oar ⚡', emoji: '⚡' },
        { cond: 'sig.strokes >= 30', label: 'Endurance 💪', emoji: '💪' },
        { cond: 'true', label: 'Learning Rhythm 🎵', emoji: '🎵' },
      ],
    }
  },
  {
    id: 'baseball-swing', title: 'Baseball Swing', tagline: 'Watch the pitch. Swing!',
    accent: '#fbbf24', duration: 45, category: 'sports', industries: ['sports','cpg','food_bev'],
    archetype: 'timing-tap', icon: 'sports_baseball',
    params: {
      bg: '#140d00', objColor: '#fbbf24', objSecond: '#fde68a',
      desc: 'Swipe at the perfect moment to connect with incoming baseball',
      signals: [
        { name: 'pitches', label: 'Pitches' },
        { name: 'hits', label: 'Hits' },
        { name: 'perfectTiming', label: 'Perfect' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.perfectTiming >= 6 && sig.hits >= 8', label: 'Power Hitter 🏆', emoji: '🏆' },
        { cond: 'sig.hits >= 6', label: 'Solid Contact ⚾', emoji: '⚾' },
        { cond: 'sig.maxStreak >= 4', label: 'Hot Streak 🔥', emoji: '🔥' },
        { cond: 'true', label: 'Three Strikes 😬', emoji: '😬' },
      ],
    }
  },
  {
    id: 'surf-ride', title: 'Surf Ride', tagline: 'Tilt to balance. Swipe for tricks.',
    accent: '#06b6d4', duration: 60, category: 'sports', industries: ['sports','cpg','retail'],
    archetype: 'tilt-balance', icon: 'surfing',
    params: {
      bg: '#001419', objColor: '#06b6d4', objSecond: '#22d3ee',
      desc: 'Tilt to balance on wave; stay in zone to score points',
      signals: [
        { name: 'timeBalanced', label: 'Balance Time' },
        { name: 'trickScore', label: 'Trick Score' },
        { name: 'wipeouts', label: 'Wipeouts' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.timeBalanced >= 30 && sig.wipeouts <= 3', label: 'Surf Pro 🏄', emoji: '🏄' },
        { cond: 'sig.timeBalanced >= 20', label: 'Wave Rider 🌊', emoji: '🌊' },
        { cond: 'sig.trickScore >= 100', label: 'Trick Artist ✨', emoji: '✨' },
        { cond: 'true', label: 'Wipeout Queen 💦', emoji: '💦' },
      ],
    }
  },
  {
    id: 'ski-slalom', title: 'Ski Slalom', tagline: 'Weave through the gates. Go fast.',
    accent: '#818cf8', duration: 45, category: 'sports', industries: ['sports','cpg','automotive'],
    archetype: 'tilt-steer', icon: 'downhill_skiing',
    params: {
      bg: '#0a0014', objColor: '#818cf8', objSecond: '#c7d2fe',
      desc: 'Tilt device to steer skier through slalom gates; gain time for clean gates',
      signals: [
        { name: 'gatesPassed', label: 'Gates' },
        { name: 'gatesMissed', label: 'Missed' },
        { name: 'maxSpeed', label: 'Max Speed' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.gatesPassed >= 20 && sig.gatesMissed <= 3', label: 'Slalom King 🎿', emoji: '🎿' },
        { cond: 'sig.gatesPassed >= 12', label: 'Clean Run ⛷️', emoji: '⛷️' },
        { cond: 'sig.maxSpeed >= 80', label: 'Speed Demon 🏎️', emoji: '🏎️' },
        { cond: 'true', label: 'Powder Bro 🌨️', emoji: '🌨️' },
      ],
    }
  },
  {
    id: 'karate-chop', title: 'Karate Chop', tagline: 'Chop the right zone. Kata master.',
    accent: '#ef4444', duration: 30, category: 'sports', industries: ['sports','healthcare','technology'],
    archetype: 'combo-tap', icon: 'sports_martial_arts',
    params: {
      bg: '#1a0000', objColor: '#ef4444', objSecond: '#fca5a5',
      desc: 'Tap highlighted zones in rapid sequence to complete karate kata combos',
      signals: [
        { name: 'combosCompleted', label: 'Combos' },
        { name: 'wrongTaps', label: 'Misses' },
        { name: 'maxComboLength', label: 'Max Combo' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.combosCompleted >= 8 && sig.wrongTaps <= 5', label: 'Black Belt 🥋', emoji: '🥋' },
        { cond: 'sig.combosCompleted >= 5', label: 'Brown Belt ⚡', emoji: '⚡' },
        { cond: 'sig.maxComboLength >= 5', label: 'Disciplined 🎯', emoji: '🎯' },
        { cond: 'true', label: 'White Belt 🤜', emoji: '🤜' },
      ],
    }
  },
  {
    id: 'pole-vault', title: 'Pole Vault', tagline: 'Run. Plant. Fly. Clear it!',
    accent: '#a3e635', duration: 45, category: 'sports', industries: ['sports','healthcare','cpg'],
    archetype: 'swipe-launch', icon: 'sports_gymnastics',
    params: {
      bg: '#071a00', objColor: '#a3e635', objSecond: '#d9f99d',
      desc: 'Swipe up for run speed, tap to plant pole, swipe to vault over bar',
      signals: [
        { name: 'attempts', label: 'Attempts' },
        { name: 'clears', label: 'Clears' },
        { name: 'maxHeight', label: 'Max Height' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.clears >= 5 && sig.maxHeight >= 400', label: 'World Record 🏆', emoji: '🏆' },
        { cond: 'sig.clears >= 3', label: 'High Flyer 🦅', emoji: '🦅' },
        { cond: 'sig.maxHeight >= 300', label: 'Ambitious 📈', emoji: '📈' },
        { cond: 'true', label: 'Face-Plant 😬', emoji: '😬' },
      ],
    }
  },
  {
    id: 'table-tennis', title: 'Table Tennis', tagline: 'Return everything. Don\'t blink.',
    accent: '#fb923c', duration: 45, category: 'sports', industries: ['sports','technology','cpg'],
    archetype: 'timing-tap', icon: 'sports_tennis',
    params: {
      bg: '#14080a', objColor: '#fb923c', objSecond: '#fdba74',
      desc: 'Swipe to return rapidly oscillating ball with correct timing',
      signals: [
        { name: 'rallies', label: 'Rallies' },
        { name: 'returns', label: 'Returns' },
        { name: 'missedReturns', label: 'Missed' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.returns >= 20 && sig.missedReturns <= 5', label: 'Ping Pong Pro 🏓', emoji: '🏓' },
        { cond: 'sig.returns >= 12', label: 'Quick Reflexes ⚡', emoji: '⚡' },
        { cond: 'sig.maxStreak >= 8', label: 'Unbreakable 🎯', emoji: '🎯' },
        { cond: 'true', label: 'Miss Queen 🤷', emoji: '🤷' },
      ],
    }
  },
  {
    id: 'gymnast-beam', title: 'Gymnast Beam', tagline: 'Balance. Execute. Stick the landing.',
    accent: '#f472b6', duration: 60, category: 'sports', industries: ['sports','healthcare','retail'],
    archetype: 'tilt-balance', icon: 'accessibility',
    params: {
      bg: '#1a0014', objColor: '#f472b6', objSecond: '#f9a8d4',
      desc: 'Tilt precisely to maintain beam balance and score routine moves',
      signals: [
        { name: 'routineScore', label: 'Score' },
        { name: 'falls', label: 'Falls' },
        { name: 'movesCompleted', label: 'Moves' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.movesCompleted >= 8 && sig.falls <= 2', label: 'Gold Medalist 🥇', emoji: '🥇' },
        { cond: 'sig.movesCompleted >= 5', label: 'Gymnast 🤸', emoji: '🤸' },
        { cond: 'sig.falls <= 5', label: 'Balanced ⚖️', emoji: '⚖️' },
        { cond: 'true', label: 'Falling Star 💫', emoji: '💫' },
      ],
    }
  },
  {
    id: 'pixel-skate', title: 'Pixel Skate', tagline: 'Flick tricks. Stack the combo.',
    accent: '#10b981', duration: 45, category: 'sports', industries: ['sports','retail','technology'],
    archetype: 'combo-tap', icon: 'skateboarding',
    params: {
      bg: '#001a0d', objColor: '#10b981', objSecond: '#6ee7b7',
      desc: 'Flick/swipe combos to perform skateboard tricks on pixel art course',
      signals: [
        { name: 'tricksLanded', label: 'Tricks' },
        { name: 'comboScore', label: 'Combo' },
        { name: 'bails', label: 'Bails' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.tricksLanded >= 10 && sig.bails <= 3', label: 'Tony Hawk 🛹', emoji: '🛹' },
        { cond: 'sig.tricksLanded >= 6', label: 'Street Skater 💨', emoji: '💨' },
        { cond: 'sig.comboScore >= 300', label: 'Combo King 👑', emoji: '👑' },
        { cond: 'true', label: 'Beginner Bail 😅', emoji: '😅' },
      ],
    }
  },
  // ── COGNITIVE ──────────────────────────────────────────────────────────────
  {
    id: 'mirror-mind', title: 'Mirror Mind', tagline: 'Both hands. Mirrored. Synchronized.',
    accent: '#8b5cf6', duration: 45, category: 'cognitive', industries: ['technology','healthcare','finance'],
    archetype: 'tap-sequence', icon: 'flip',
    params: {
      bg: '#07000f', objColor: '#8b5cf6', objSecond: '#c4b5fd',
      desc: 'Tap mirrored targets simultaneously on both sides of screen',
      signals: [
        { name: 'attempts', label: 'Pairs' },
        { name: 'successes', label: 'Perfect' },
        { name: 'avgSync', label: 'Sync' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.successes >= 15 && avgSync >= 90', label: 'Synchronized 🪞', emoji: '🪞' },
        { cond: 'sig.successes >= 10', label: 'Bilateral Brain 🧠', emoji: '🧠' },
        { cond: 'sig.maxStreak >= 6', label: 'Focused 🎯', emoji: '🎯' },
        { cond: 'true', label: 'Off-Sync 🔀', emoji: '🔀' },
      ],
    }
  },
  {
    id: 'color-word', title: 'Color Word', tagline: 'Ignore the meaning. Trust your eyes.',
    accent: '#f43f5e', duration: 30, category: 'cognitive', industries: ['cpg','retail','technology'],
    archetype: 'sort-swipe', icon: 'text_fields',
    params: {
      bg: '#14000a', objColor: '#f43f5e', objSecond: '#fda4af',
      desc: 'Tap the word whose INK COLOR matches the displayed color name',
      signals: [
        { name: 'shown', label: 'Shown' },
        { name: 'correct', label: 'Correct' },
        { name: 'avgResponse', label: 'Avg Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'accuracy >= 0.85 && avgResponse < 700', label: 'Stroop Master 🧠', emoji: '🧠' },
        { cond: 'accuracy >= 0.7', label: 'Focused Mind 🔍', emoji: '🔍' },
        { cond: 'sig.maxStreak >= 6', label: 'Consistent ✅', emoji: '✅' },
        { cond: 'true', label: 'Color Confused 🌈', emoji: '🌈' },
      ],
    }
  },
  {
    id: 'number-path', title: 'Number Path', tagline: '1 to N. Fastest finger wins.',
    accent: '#22c55e', duration: 45, category: 'cognitive', industries: ['finance','technology','healthcare'],
    archetype: 'tap-sequence', icon: '123',
    params: {
      bg: '#001407', objColor: '#22c55e', objSecond: '#86efac',
      desc: 'Tap scattered numbers 1 through N in ascending order as fast as possible',
      signals: [
        { name: 'numbersHit', label: 'Numbers' },
        { name: 'wrongTaps', label: 'Wrong' },
        { name: 'avgSpeed', label: 'Avg Speed' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.numbersHit >= 30 && sig.wrongTaps <= 5', label: 'Number Ninja 🥷', emoji: '🥷' },
        { cond: 'sig.numbersHit >= 20', label: 'Sequential 📊', emoji: '📊' },
        { cond: 'sig.wrongTaps <= 3', label: 'Precise 🎯', emoji: '🎯' },
        { cond: 'true', label: 'Scattered 🔢', emoji: '🔢' },
      ],
    }
  },
  {
    id: 'shape-rotate', title: 'Shape Rotate', tagline: 'Spin it in your mind. Match it.',
    accent: '#06b6d4', duration: 60, category: 'cognitive', industries: ['technology','automotive','finance'],
    archetype: 'multiple-choice', icon: '3d_rotation',
    params: {
      bg: '#001419', objColor: '#06b6d4', objSecond: '#67e8f9',
      desc: 'Match the rotated 3D shape to one of four displayed orientations',
      signals: [
        { name: 'shown', label: 'Shown' },
        { name: 'correct', label: 'Correct' },
        { name: 'avgResponse', label: 'Avg Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'accuracy >= 0.85', label: 'Spatial Genius 🌐', emoji: '🌐' },
        { cond: 'accuracy >= 0.7', label: 'Mind Turner 🔄', emoji: '🔄' },
        { cond: 'sig.maxStreak >= 6', label: 'Consistent 🎯', emoji: '🎯' },
        { cond: 'true', label: 'Spatially Challenged 🧊', emoji: '🧊' },
      ],
    }
  },
  {
    id: 'odd-one-out', title: 'Odd One Out', tagline: 'Spot what doesn\'t belong. Quick!',
    accent: '#f97316', duration: 45, category: 'cognitive', industries: ['retail','cpg','technology'],
    archetype: 'tap-spawn', icon: 'find_in_page',
    params: {
      bg: '#14060a', objColor: '#f97316', objSecond: '#fdba74',
      desc: 'Spot and tap the one item that doesn\'t belong in the grid',
      signals: [
        { name: 'puzzles', label: 'Puzzles' },
        { name: 'correct', label: 'Correct' },
        { name: 'avgTime', label: 'Avg Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.correct >= 12 && sig.avgTime < 2000', label: 'Pattern Master 🔎', emoji: '🔎' },
        { cond: 'sig.correct >= 8', label: 'Sharp Eye 👁️', emoji: '👁️' },
        { cond: 'sig.maxStreak >= 6', label: 'Consistent 🎯', emoji: '🎯' },
        { cond: 'true', label: 'Distracted 🌀', emoji: '🌀' },
      ],
    }
  },
  {
    id: 'sequence-unlock', title: 'Sequence Unlock', tagline: 'Watch the lights. Repeat them.',
    accent: '#a855f7', duration: 60, category: 'cognitive', industries: ['technology','finance','healthcare'],
    archetype: 'sequence-memory', icon: 'pattern',
    params: {
      bg: '#0d0014', objColor: '#a855f7', objSecond: '#d8b4fe',
      desc: 'Observe moving light sequence across nodes, then reproduce it exactly',
      signals: [
        { name: 'sequencesCompleted', label: 'Unlocked' },
        { name: 'maxLength', label: 'Max Length' },
        { name: 'errors', label: 'Errors' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.maxLength >= 8 && sig.errors <= 5', label: 'Memory Palace 🏛️', emoji: '🏛️' },
        { cond: 'sig.maxLength >= 6', label: 'Pattern Keeper 🔑', emoji: '🔑' },
        { cond: 'sig.sequencesCompleted >= 4', label: 'Persistent 💪', emoji: '💪' },
        { cond: 'true', label: 'Forgetful 🤔', emoji: '🤔' },
      ],
    }
  },
  {
    id: 'pattern-predict', title: 'Pattern Predict', tagline: 'What comes next? You tell me.',
    accent: '#14b8a6', duration: 45, category: 'cognitive', industries: ['finance','technology','cpg'],
    archetype: 'multiple-choice', icon: 'trending_up',
    params: {
      bg: '#001a17', objColor: '#14b8a6', objSecond: '#5eead4',
      desc: 'Identify next element in increasingly complex visual and numerical patterns',
      signals: [
        { name: 'shown', label: 'Shown' },
        { name: 'correct', label: 'Correct' },
        { name: 'avgResponse', label: 'Avg Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'accuracy >= 0.8 && sig.correct >= 10', label: 'Pattern Oracle 🔮', emoji: '🔮' },
        { cond: 'accuracy >= 0.65', label: 'Analyst 📈', emoji: '📈' },
        { cond: 'sig.maxStreak >= 5', label: 'Systematic 📐', emoji: '📐' },
        { cond: 'true', label: 'Random Guesser 🎲', emoji: '🎲' },
      ],
    }
  },
  {
    id: 'word-flash', title: 'Word Flash', tagline: 'Read it. Remember it. Recall it.',
    accent: '#ec4899', duration: 60, category: 'cognitive', industries: ['retail','cpg','healthcare'],
    archetype: 'sequence-memory', icon: 'flash_on',
    params: {
      bg: '#14000a', objColor: '#ec4899', objSecond: '#f9a8d4',
      desc: 'Memorize flashed words then recall them in order',
      signals: [
        { name: 'roundsCompleted', label: 'Rounds' },
        { name: 'maxWordCount', label: 'Max Words' },
        { name: 'errors', label: 'Errors' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.maxWordCount >= 7 && sig.errors <= 5', label: 'Photographic 📸', emoji: '📸' },
        { cond: 'sig.maxWordCount >= 5', label: 'Word Hoarder 📚', emoji: '📚' },
        { cond: 'sig.roundsCompleted >= 4', label: 'Persistent 💪', emoji: '💪' },
        { cond: 'true', label: 'Fleeting Memory 💭', emoji: '💭' },
      ],
    }
  },
  {
    id: 'logic-gate', title: 'Logic Gate', tagline: 'Wire the circuit. Get the output.',
    accent: '#64748b', duration: 60, category: 'cognitive', industries: ['technology','finance','automotive'],
    archetype: 'multiple-choice', icon: 'device_hub',
    params: {
      bg: '#0a0c0f', objColor: '#64748b', objSecond: '#94a3b8',
      desc: 'Configure AND/OR/NOT gates by tapping to produce target binary output',
      signals: [
        { name: 'circuitsCompleted', label: 'Circuits' },
        { name: 'correctGates', label: 'Correct' },
        { name: 'wrongGates', label: 'Wrong' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.circuitsCompleted >= 5 && sig.wrongGates <= 5', label: 'Hardware Engineer 💻', emoji: '💻' },
        { cond: 'sig.circuitsCompleted >= 3', label: 'Logic Master 🔌', emoji: '🔌' },
        { cond: 'sig.maxStreak >= 6', label: 'Systematic ⚙️', emoji: '⚙️' },
        { cond: 'true', label: 'Short Circuit ⚡', emoji: '⚡' },
      ],
    }
  },
  {
    id: 'visual-search', title: 'Visual Search', tagline: 'Find it. Tap it. Before the horde.',
    accent: '#10b981', duration: 30, category: 'cognitive', industries: ['retail','cpg','technology'],
    archetype: 'tap-spawn', icon: 'search',
    params: {
      bg: '#001207', objColor: '#10b981', objSecond: '#6ee7b7',
      desc: 'Spot and tap the unique target among growing crowd of distractors',
      signals: [
        { name: 'searches', label: 'Searches' },
        { name: 'found', label: 'Found' },
        { name: 'avgTime', label: 'Avg Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.found >= 8 && avgSearchTime < 2000', label: 'Eagle Eye 🦅', emoji: '🦅' },
        { cond: 'sig.found >= 5', label: 'Hunter 🎯', emoji: '🎯' },
        { cond: 'sig.maxStreak >= 5', label: 'Consistent 📍', emoji: '📍' },
        { cond: 'true', label: 'Searching 🔍', emoji: '🔍' },
      ],
    }
  },
  {
    id: 'binary-decode', title: 'Binary Decode', tagline: 'Flip the bits. Find the number.',
    accent: '#22c55e', duration: 45, category: 'cognitive', industries: ['technology','finance','automotive'],
    archetype: 'multiple-choice', icon: 'data_object',
    params: {
      bg: '#001407', objColor: '#22c55e', objSecond: '#86efac',
      desc: 'Decode binary patterns to decimal values before time runs out',
      signals: [
        { name: 'shown', label: 'Problems' },
        { name: 'correct', label: 'Correct' },
        { name: 'avgResponse', label: 'Avg Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'accuracy >= 0.9 && sig.correct >= 10', label: 'Bit Wizard 🧙', emoji: '🧙' },
        { cond: 'accuracy >= 0.7', label: 'Code Breaker 💻', emoji: '💻' },
        { cond: 'sig.maxStreak >= 5', label: 'Binary Mind 🔢', emoji: '🔢' },
        { cond: 'true', label: 'Bit Confused 😵', emoji: '😵' },
      ],
    }
  },
  {
    id: 'rhythm-repeat', title: 'Rhythm Repeat', tagline: 'Hear the beat. Play it back.',
    accent: '#f59e0b', duration: 60, category: 'cognitive', industries: ['cpg','retail','food_bev'],
    archetype: 'sequence-memory', icon: 'music_note',
    params: {
      bg: '#14100a', objColor: '#f59e0b', objSecond: '#fcd34d',
      desc: 'Listen to rhythm pattern then reproduce it exactly by tapping the pad',
      signals: [
        { name: 'patternsCompleted', label: 'Patterns' },
        { name: 'maxLength', label: 'Max Length' },
        { name: 'errors', label: 'Errors' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.maxLength >= 8 && sig.errors <= 5', label: 'Rhythm Master 🥁', emoji: '🥁' },
        { cond: 'sig.maxLength >= 5', label: 'Beat Keeper 🎵', emoji: '🎵' },
        { cond: 'sig.patternsCompleted >= 4', label: 'Musical 🎶', emoji: '🎶' },
        { cond: 'true', label: 'Off Beat 🎸', emoji: '🎸' },
      ],
    }
  },
  {
    id: 'category-clash', title: 'Category Clash', tagline: 'Sort it fast. Categories clash!',
    accent: '#fb923c', duration: 30, category: 'cognitive', industries: ['retail','cpg','food_bev'],
    archetype: 'sort-swipe', icon: 'category',
    params: {
      bg: '#14060a', objColor: '#fb923c', objSecond: '#fdba74',
      desc: 'Swipe items into rapidly switching category buckets',
      signals: [
        { name: 'itemsSorted', label: 'Sorted' },
        { name: 'correct', label: 'Correct' },
        { name: 'switchReacts', label: 'Switch React' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'accuracy >= 0.85 && sig.itemsSorted >= 20', label: 'Sort Savant 🧠', emoji: '🧠' },
        { cond: 'accuracy >= 0.7', label: 'Quick Sorter ⚡', emoji: '⚡' },
        { cond: 'sig.maxStreak >= 8', label: 'Clash Champion 🏆', emoji: '🏆' },
        { cond: 'true', label: 'Category Confused 🤷', emoji: '🤷' },
      ],
    }
  },
  {
    id: 'attention-switch', title: 'Attention Switch', tagline: 'Dual task. Both streams. Now!',
    accent: '#6366f1', duration: 45, category: 'cognitive', industries: ['technology','finance','healthcare'],
    archetype: 'combo-tap', icon: 'switch_access_shortcut',
    params: {
      bg: '#07070f', objColor: '#6366f1', objSecond: '#a5b4fc',
      desc: 'Switch between two simultaneous tasks based on audio and visual cues',
      signals: [
        { name: 'taskA', label: 'Task A' },
        { name: 'taskB', label: 'Task B' },
        { name: 'switchErrors', label: 'Switch Errors' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.taskA >= 10 && sig.taskB >= 10 && sig.switchErrors <= 5', label: 'Multitasker 🎭', emoji: '🎭' },
        { cond: 'sig.taskA + sig.taskB >= 15', label: 'Dual Focus 🔀', emoji: '🔀' },
        { cond: 'sig.switchErrors <= 8', label: 'Adaptive 🔄', emoji: '🔄' },
        { cond: 'true', label: 'Single-Track 🛤️', emoji: '🛤️' },
      ],
    }
  },
  {
    id: 'face-memory', title: 'Face Memory', tagline: 'Remember the faces. Spot them.',
    accent: '#f43f5e', duration: 60, category: 'cognitive', industries: ['retail','healthcare','finance'],
    archetype: 'sequence-memory', icon: 'face',
    params: {
      bg: '#14000a', objColor: '#f43f5e', objSecond: '#fda4af',
      desc: 'Memorize illustrated faces then identify them in a larger crowd',
      signals: [
        { name: 'roundsCompleted', label: 'Rounds' },
        { name: 'facesFound', label: 'Found' },
        { name: 'errors', label: 'Errors' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.facesFound >= 12 && sig.errors <= 5', label: 'Face Reader 👁️', emoji: '👁️' },
        { cond: 'sig.facesFound >= 8', label: 'People Person 😊', emoji: '😊' },
        { cond: 'sig.roundsCompleted >= 4', label: 'Persistent 💪', emoji: '💪' },
        { cond: 'true', label: 'Face Blind 😵', emoji: '😵' },
      ],
    }
  },
  {
    id: 'inference-trail', title: 'Inference Trail', tagline: 'Follow the clues. Find the answer.',
    accent: '#7c3aed', duration: 60, category: 'cognitive', industries: ['finance','technology','healthcare'],
    archetype: 'tap-spawn', icon: 'lightbulb',
    params: {
      bg: '#0a0014', objColor: '#7c3aed', objSecond: '#a78bfa',
      desc: 'Follow picture clue chain to identify the logical odd one out each round',
      signals: [
        { name: 'puzzles', label: 'Puzzles' },
        { name: 'solved', label: 'Solved' },
        { name: 'avgTime', label: 'Avg Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.solved >= 8 && avgSolveTime < 5000', label: 'Sherlock 🔍', emoji: '🔍' },
        { cond: 'sig.solved >= 5', label: 'Detective 🕵️', emoji: '🕵️' },
        { cond: 'sig.maxStreak >= 4', label: 'Deductive 🧩', emoji: '🧩' },
        { cond: 'true', label: 'Still Thinking 🤔', emoji: '🤔' },
      ],
    }
  },
  {
    id: 'reflex-grid', title: 'Reflex Grid', tagline: 'Tap the flash. Never miss twice.',
    accent: '#ef4444', duration: 30, category: 'cognitive', industries: ['sports','technology','cpg'],
    archetype: 'tap-spawn', icon: 'grid_on',
    params: {
      bg: '#140000', objColor: '#ef4444', objSecond: '#fca5a5',
      desc: 'Tap briefly flashing grid cells; missing two in a row ends the round',
      signals: [
        { name: 'flashes', label: 'Flashes' },
        { name: 'tapped', label: 'Tapped' },
        { name: 'missed', label: 'Missed' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.tapped >= 20 && sig.missed <= 3', label: 'Reflex Machine ⚡', emoji: '⚡' },
        { cond: 'sig.tapped >= 14', label: 'Quick Trigger 🎯', emoji: '🎯' },
        { cond: 'sig.maxStreak >= 10', label: 'Unbreakable 🔥', emoji: '🔥' },
        { cond: 'true', label: 'Slow Poke 🐌', emoji: '🐌' },
      ],
    }
  },
  {
    id: 'spatial-map', title: 'Spatial Map', tagline: 'Study the map. Answer fast.',
    accent: '#0ea5e9', duration: 60, category: 'cognitive', industries: ['automotive','technology','retail'],
    archetype: 'multiple-choice', icon: 'map',
    params: {
      bg: '#000f14', objColor: '#0ea5e9', objSecond: '#38bdf8',
      desc: 'Memorize city map layout then answer directional navigation questions rapidly',
      signals: [
        { name: 'questions', label: 'Questions' },
        { name: 'correct', label: 'Correct' },
        { name: 'avgResponse', label: 'Avg Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'accuracy >= 0.85 && sig.correct >= 8', label: 'Human GPS 🗺️', emoji: '🗺️' },
        { cond: 'accuracy >= 0.7', label: 'Good Navigator 🧭', emoji: '🧭' },
        { cond: 'sig.maxStreak >= 5', label: 'Directional 📍', emoji: '📍' },
        { cond: 'true', label: 'Lost Again 😅', emoji: '😅' },
      ],
    }
  },
  {
    id: 'neon-chess', title: 'Neon Chess', tagline: 'One move. Best move. Neon style.',
    accent: '#00ffff', duration: 60, category: 'cognitive', industries: ['technology','finance','healthcare'],
    archetype: 'multiple-choice', icon: 'grid_view',
    params: {
      bg: '#000f0f', objColor: '#00ffff', objSecond: '#67e8f9',
      desc: 'Solve chess puzzles: find the best move in each position fast',
      signals: [
        { name: 'puzzles', label: 'Puzzles' },
        { name: 'solved', label: 'Solved' },
        { name: 'avgTime', label: 'Avg Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.solved >= 8 && avgSolveTime < 5000', label: 'Grandmaster ♟️', emoji: '♟️' },
        { cond: 'sig.solved >= 5', label: 'Tactician 🎯', emoji: '🎯' },
        { cond: 'sig.maxStreak >= 4', label: 'Calculated 🧠', emoji: '🧠' },
        { cond: 'true', label: 'Blunder King 😬', emoji: '😬' },
      ],
    }
  },
  // ── BREATH / MIC ───────────────────────────────────────────────────────────
  {
    id: 'dragon-breath', title: 'Dragon Breath', tagline: 'Blow hard. Breathe fire!',
    accent: '#ef4444', duration: 30, category: 'breath', industries: ['cpg','food_bev','sports'],
    archetype: 'vol-mic', icon: 'local_fire_department',
    params: {
      bg: '#1a0000', objColor: '#ef4444', objSecond: '#fbbf24',
      desc: 'Blow to power dragon fire; sustain volume to reach targets further away',
      signals: [
        { name: 'targetsBurned', label: 'Burned' },
        { name: 'totalBreaths', label: 'Breaths' },
        { name: 'maxRange', label: 'Max Range' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.targetsBurned >= 10 && sig.maxRange >= 300', label: 'Fire Dragon 🐉', emoji: '🐉' },
        { cond: 'sig.targetsBurned >= 6', label: 'Flame Thrower 🔥', emoji: '🔥' },
        { cond: 'sig.maxRange >= 200', label: 'Long Breath 💪', emoji: '💪' },
        { cond: 'true', label: 'Spark 🌟', emoji: '🌟' },
      ],
    }
  },
  {
    id: 'voice-sculpt', title: 'Voice Sculpt', tagline: 'Hum to shape the clay.',
    accent: '#d946ef', duration: 45, category: 'breath', industries: ['healthcare','retail','technology'],
    archetype: 'pitch-mic', icon: 'record_voice_over',
    params: {
      bg: '#14000f', objColor: '#d946ef', objSecond: '#f0abfc',
      desc: 'Hum different pitches to sculpt clay blobs in different zones',
      signals: [
        { name: 'zonesHit', label: 'Zones' },
        { name: 'sculpts', label: 'Sculpts' },
        { name: 'avgPitch', label: 'Avg Pitch' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.sculpts >= 15 && sig.zonesHit >= 8', label: 'Voice Artist 🎨', emoji: '🎨' },
        { cond: 'sig.sculpts >= 10', label: 'Clay Hummer 🎵', emoji: '🎵' },
        { cond: 'sig.zonesHit >= 6', label: 'Tonal 🎶', emoji: '🎶' },
        { cond: 'true', label: 'Flat Note 🎤', emoji: '🎤' },
      ],
    }
  },
  {
    id: 'echo-match', title: 'Echo Match', tagline: 'Match the echo. Hold the note.',
    accent: '#06b6d4', duration: 45, category: 'breath', industries: ['healthcare','cpg','retail'],
    archetype: 'vol-mic', icon: 'graphic_eq',
    params: {
      bg: '#001419', objColor: '#06b6d4', objSecond: '#67e8f9',
      desc: 'Match the duration of a reference echo pattern by holding sound',
      signals: [
        { name: 'echoesMatched', label: 'Matched' },
        { name: 'totalEchoes', label: 'Total' },
        { name: 'avgAccuracy', label: 'Accuracy' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'echoAccuracy >= 0.85 && sig.echoesMatched >= 8', label: 'Echo Master 🎵', emoji: '🎵' },
        { cond: 'echoAccuracy >= 0.7', label: 'Sound Mimic 🔊', emoji: '🔊' },
        { cond: 'sig.maxStreak >= 5', label: 'Consistent 🎯', emoji: '🎯' },
        { cond: 'true', label: 'Echo Off 📢', emoji: '📢' },
      ],
    }
  },
  {
    id: 'howl-wolf', title: 'Howl Wolf', tagline: 'Find your pitch. Call the pack.',
    accent: '#6366f1', duration: 45, category: 'breath', industries: ['cpg','retail','food_bev'],
    archetype: 'pitch-mic', icon: 'pets',
    params: {
      bg: '#07070f', objColor: '#6366f1', objSecond: '#a5b4fc',
      desc: 'Adjust voice pitch while howling to match targets and call wolf silhouettes',
      signals: [
        { name: 'wolvesHowled', label: 'Wolves Called' },
        { name: 'targetsHit', label: 'Targets Hit' },
        { name: 'avgPitchAccuracy', label: 'Pitch Acc' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.wolvesHowled >= 8 && pitchAccuracy >= 0.7', label: 'Alpha Wolf 🐺', emoji: '🐺' },
        { cond: 'sig.wolvesHowled >= 5', label: 'Pack Leader 🌕', emoji: '🌕' },
        { cond: 'sig.targetsHit >= 10', label: 'Howler 🎶', emoji: '🎶' },
        { cond: 'true', label: 'Lone Wolf 🐾', emoji: '🐾' },
      ],
    }
  },
  {
    id: 'beat-box', title: 'Beat Box', tagline: 'Drop the beat. Keep it going.',
    accent: '#f97316', duration: 60, category: 'breath', industries: ['cpg','food_bev','retail'],
    archetype: 'vol-mic', icon: 'music_note',
    params: {
      bg: '#14050a', objColor: '#f97316', objSecond: '#fdba74',
      desc: 'Make percussion sounds to hit beat markers and build a drum pattern',
      signals: [
        { name: 'beatsHit', label: 'Beats Hit' },
        { name: 'beatsMissed', label: 'Missed' },
        { name: 'maxBPM', label: 'Max BPM' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.beatsHit >= 30 && sig.beatsMissed <= 5', label: 'Human Drum Machine 🥁', emoji: '🥁' },
        { cond: 'sig.beatsHit >= 20', label: 'Beatboxer 🎤', emoji: '🎤' },
        { cond: 'sig.maxStreak >= 10', label: 'In the Groove 🎵', emoji: '🎵' },
        { cond: 'true', label: 'Off Beat 🎶', emoji: '🎶' },
      ],
    }
  },
  {
    id: 'hum-maze', title: 'Hum Maze', tagline: 'Change your pitch. Navigate.',
    accent: '#14b8a6', duration: 60, category: 'breath', industries: ['healthcare','technology','retail'],
    archetype: 'pitch-mic', icon: 'route',
    params: {
      bg: '#001a17', objColor: '#14b8a6', objSecond: '#5eead4',
      desc: 'Navigate maze by adjusting hum pitch: high=up, low=down, loud=forward',
      signals: [
        { name: 'mazesCompleted', label: 'Mazes' },
        { name: 'stepsForward', label: 'Steps' },
        { name: 'wallHits', label: 'Wall Hits' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.mazesCompleted >= 3 && sig.wallHits <= 10', label: 'Voice Navigator 🗺️', emoji: '🗺️' },
        { cond: 'sig.mazesCompleted >= 2', label: 'Hum Pilot 🎵', emoji: '🎵' },
        { cond: 'sig.stepsForward >= 50', label: 'Perseverant 💪', emoji: '💪' },
        { cond: 'true', label: 'Maze Humbler 🤔', emoji: '🤔' },
      ],
    }
  },
  {
    id: 'chant-power', title: 'Chant Power', tagline: 'Hold the chant. Charge the power.',
    accent: '#dc2626', duration: 45, category: 'breath', industries: ['sports','cpg','food_bev'],
    archetype: 'vol-mic', icon: 'record_voice_over',
    params: {
      bg: '#1a0000', objColor: '#dc2626', objSecond: '#fca5a5',
      desc: 'Maintain steady chant volume to fill power meter for energy bursts',
      signals: [
        { name: 'powersReleased', label: 'Bursts' },
        { name: 'totalChargeTime', label: 'Charge Time' },
        { name: 'maxPowerLevel', label: 'Max Power' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.powersReleased >= 8 && sig.maxPowerLevel >= 90', label: 'Power Chanter 💥', emoji: '💥' },
        { cond: 'sig.powersReleased >= 5', label: 'Vocal Force ⚡', emoji: '⚡' },
        { cond: 'sig.totalChargeTime >= 20', label: 'Sustained 🔋', emoji: '🔋' },
        { cond: 'true', label: 'Whisper 🤫', emoji: '🤫' },
      ],
    }
  },
  {
    id: 'whistle-launch', title: 'Whistle Launch', tagline: 'Whistle to launch. Pitch to steer.',
    accent: '#fbbf24', duration: 45, category: 'breath', industries: ['technology','cpg','sports'],
    archetype: 'pitch-mic', icon: 'rocket',
    params: {
      bg: '#14100a', objColor: '#fbbf24', objSecond: '#fde68a',
      desc: 'Whistle to launch rocket; adjust pitch up/down to steer through obstacles',
      signals: [
        { name: 'obstaclesCleared', label: 'Cleared' },
        { name: 'crashes', label: 'Crashes' },
        { name: 'maxAltitude', label: 'Max Alt' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.obstaclesCleared >= 15 && sig.crashes <= 5', label: 'Rocket Pilot 🚀', emoji: '🚀' },
        { cond: 'sig.obstaclesCleared >= 8', label: 'Astronaut 🌟', emoji: '🌟' },
        { cond: 'sig.maxAltitude >= 500', label: 'High Flyer ✈️', emoji: '✈️' },
        { cond: 'true', label: 'Ground Control 📡', emoji: '📡' },
      ],
    }
  },
  {
    id: 'vocal-shield', title: 'Vocal Shield', tagline: 'Sing it. Block it. Hold it.',
    accent: '#818cf8', duration: 30, category: 'breath', industries: ['healthcare','technology','sports'],
    archetype: 'pitch-mic', icon: 'shield',
    params: {
      bg: '#0a0a14', objColor: '#818cf8', objSecond: '#c7d2fe',
      desc: 'Sustain vocal tone to generate protective shield; pitch changes shield angle',
      signals: [
        { name: 'shotsBlocked', label: 'Blocked' },
        { name: 'shotsHit', label: 'Took Damage' },
        { name: 'maxShieldTime', label: 'Shield Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.shotsBlocked >= 10 && sig.shotsHit <= 3', label: 'Vocal Guardian 🛡️', emoji: '🛡️' },
        { cond: 'sig.shotsBlocked >= 6', label: 'Shield Singer 🎵', emoji: '🎵' },
        { cond: 'sig.maxShieldTime >= 20', label: 'Sustained Voice 🔊', emoji: '🔊' },
        { cond: 'true', label: 'Needs Training 🎤', emoji: '🎤' },
      ],
    }
  },
  {
    id: 'breath-sculpt', title: 'Breath Sculpt', tagline: 'Breathe to shape. Slow or fast.',
    accent: '#34d399', duration: 60, category: 'breath', industries: ['healthcare','cpg','retail'],
    archetype: 'vol-mic', icon: 'air',
    params: {
      bg: '#001a0d', objColor: '#34d399', objSecond: '#6ee7b7',
      desc: 'Control breath rate to inflate/deflate shapes to match target size',
      signals: [
        { name: 'shapesMatched', label: 'Matched' },
        { name: 'totalShapes', label: 'Total' },
        { name: 'avgAccuracy', label: 'Accuracy' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'breathAccuracy >= 0.85 && sig.shapesMatched >= 10', label: 'Breath Artist 🌬️', emoji: '🌬️' },
        { cond: 'breathAccuracy >= 0.7', label: 'Breath Control 🧘', emoji: '🧘' },
        { cond: 'sig.shapesMatched >= 7', label: 'Sculptor ✨', emoji: '✨' },
        { cond: 'true', label: 'Still Learning 🌱', emoji: '🌱' },
      ],
    }
  },
  {
    id: 'frequency-tune', title: 'Frequency Tune', tagline: 'Find the frequency. Hold it.',
    accent: '#f472b6', duration: 45, category: 'breath', industries: ['technology','healthcare','automotive'],
    archetype: 'pitch-mic', icon: 'tune',
    params: {
      bg: '#14000f', objColor: '#f472b6', objSecond: '#f9a8d4',
      desc: 'Adjust humming pitch to tune frequency dial to target positions',
      signals: [
        { name: 'tunings', label: 'Tuned' },
        { name: 'avgAccuracy', label: 'Accuracy' },
        { name: 'heldTime', label: 'Hold Time' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'tuneAccuracy >= 0.8 && sig.tunings >= 8', label: 'Perfect Pitch 🎼', emoji: '🎼' },
        { cond: 'tuneAccuracy >= 0.65', label: 'Frequency Finder 📻', emoji: '📻' },
        { cond: 'sig.heldTime >= 30', label: 'Patient Tuner ⏱️', emoji: '⏱️' },
        { cond: 'true', label: 'Off Frequency 📡', emoji: '📡' },
      ],
    }
  },
  {
    id: 'lung-capacity', title: 'Lung Capacity', tagline: 'Take one breath. Hold the note.',
    accent: '#4ade80', duration: 30, category: 'breath', industries: ['healthcare','sports','cpg'],
    archetype: 'vol-mic', icon: 'pulmonology',
    params: {
      bg: '#001407', objColor: '#4ade80', objSecond: '#86efac',
      desc: 'Take deep breath and sustain a note as long as possible in target zone',
      signals: [
        { name: 'holdDuration', label: 'Hold Time' },
        { name: 'totalBreaths', label: 'Breaths' },
        { name: 'avgVolume', label: 'Avg Volume' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.holdDuration >= 20 && sig.avgVolume >= 60', label: 'Iron Lungs 🫁', emoji: '🫁' },
        { cond: 'sig.holdDuration >= 12', label: 'Strong Breath 💪', emoji: '💪' },
        { cond: 'sig.totalBreaths >= 8', label: 'Consistent 🎯', emoji: '🎯' },
        { cond: 'true', label: 'Quick Breather 😮', emoji: '😮' },
      ],
    }
  },
  {
    id: 'sound-waves', title: 'Sound Waves', tagline: 'Shout the frequency. Shatter walls.',
    accent: '#22d3ee', duration: 45, category: 'breath', industries: ['technology','cpg','sports'],
    archetype: 'vol-mic', icon: 'graphic_eq',
    params: {
      bg: '#001419', objColor: '#22d3ee', objSecond: '#67e8f9',
      desc: 'Match voice frequency to break obstacles; louder = bigger waves',
      signals: [
        { name: 'wallsShattered', label: 'Shattered' },
        { name: 'totalWaves', label: 'Waves' },
        { name: 'maxAmplitude', label: 'Max Amp' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.wallsShattered >= 12 && sig.maxAmplitude >= 80', label: 'Sonic Boom 💥', emoji: '💥' },
        { cond: 'sig.wallsShattered >= 7', label: 'Wave Rider 🌊', emoji: '🌊' },
        { cond: 'sig.maxAmplitude >= 60', label: 'Loud and Proud 📢', emoji: '📢' },
        { cond: 'true', label: 'Barely Audible 🔇', emoji: '🔇' },
      ],
    }
  },
  {
    id: 'sing-along', title: 'Sing Along', tagline: 'Match the note. Hold it perfect.',
    accent: '#fb7185', duration: 45, category: 'breath', industries: ['cpg','retail','food_bev'],
    archetype: 'pitch-mic', icon: 'mic',
    params: {
      bg: '#14000a', objColor: '#fb7185', objSecond: '#fda4af',
      desc: 'Hum or sing to match notes on scrolling staff; hold pitch in target range',
      signals: [
        { name: 'notesMatched', label: 'Matched' },
        { name: 'totalNotes', label: 'Notes' },
        { name: 'avgAccuracy', label: 'Accuracy' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'noteAccuracy >= 0.8 && sig.notesMatched >= 15', label: 'Soprano Star 🌟', emoji: '🌟' },
        { cond: 'noteAccuracy >= 0.65', label: 'On Key 🎵', emoji: '🎵' },
        { cond: 'sig.maxStreak >= 8', label: 'In Tune 🎶', emoji: '🎶' },
        { cond: 'true', label: 'Shower Singer 🚿', emoji: '🚿' },
      ],
    }
  },
  {
    id: 'sound-garden', title: 'Sound Garden', tagline: 'Touch to grow. Grow to play.',
    accent: '#4ade80', duration: 60, category: 'breath', industries: ['healthcare','retail','technology'],
    archetype: 'tap-spawn', icon: 'nature',
    params: {
      bg: '#001407', objColor: '#4ade80', objSecond: '#86efac',
      desc: 'Touch zones to grow musical plants that bloom into scoring flowers',
      signals: [
        { name: 'plantsGrown', label: 'Plants' },
        { name: 'flowersBlooomed', label: 'Bloomed' },
        { name: 'symphonyScore', label: 'Symphony' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.flowersBlooomed >= 10 && sig.symphonyScore >= 50', label: 'Garden Maestro 🌸', emoji: '🌸' },
        { cond: 'sig.flowersBlooomed >= 6', label: 'Green Thumb 🌱', emoji: '🌱' },
        { cond: 'sig.plantsGrown >= 15', label: 'Planter 🌿', emoji: '🌿' },
        { cond: 'true', label: 'Seedling 🌾', emoji: '🌾' },
      ],
    }
  },
  // ── HOLIDAY ─────────────────────────────────────────────────────────────────
  {
    id: 'shamrock-shuffle', title: 'Shamrock Shuffle', tagline: 'Catch the luck. Dodge the coal.',
    accent: '#16a34a', duration: 30, category: 'holiday', industries: ['retail','food_bev','cpg'],
    archetype: 'tilt-catch', icon: 'eco',
    params: {
      bg: '#001407', objColor: '#16a34a', objSecond: '#4ade80',
      desc: 'Tilt device to catch shamrocks and avoid lumps of coal',
      signals: [
        { name: 'shamrocksCaught', label: 'Shamrocks' },
        { name: 'coalHit', label: 'Coal Hit' },
        { name: 'maxStreak', label: 'Streak' },
        { name: 'luckyFours', label: '4-Leaf Lucky' },
      ],
      personalities: [
        { cond: 'sig.shamrocksCaught >= 15 && sig.coalHit <= 2', label: 'Lucky Legend 🍀', emoji: '🍀' },
        { cond: 'sig.shamrocksCaught >= 10', label: 'Shamrock Chaser ☘️', emoji: '☘️' },
        { cond: 'sig.coalHit <= 5', label: 'Nimble 🐇', emoji: '🐇' },
        { cond: 'true', label: 'Coal Catcher 🖤', emoji: '🖤' },
      ],
    }
  },
  {
    id: 'egg-toss', title: 'Egg Toss', tagline: 'Toss it. Catch it. Don\'t crack it!',
    accent: '#fde68a', duration: 45, category: 'holiday', industries: ['food_bev','cpg','retail'],
    archetype: 'timing-tap', icon: 'egg',
    params: {
      bg: '#141207', objColor: '#fde68a', objSecond: '#fef3c7',
      desc: 'Tap to toss/catch egg at just the right moment without cracking it',
      signals: [
        { name: 'tosses', label: 'Tosses' },
        { name: 'caught', label: 'Caught' },
        { name: 'cracked', label: 'Cracked' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.caught >= 12 && sig.cracked <= 2', label: 'Egg Champion 🥚', emoji: '🥚' },
        { cond: 'sig.caught >= 8', label: 'Gentle Catcher 🤲', emoji: '🤲' },
        { cond: 'sig.maxStreak >= 6', label: 'Consistent 🎯', emoji: '🎯' },
        { cond: 'true', label: 'Egg-sploder 💥', emoji: '💥' },
      ],
    }
  },
  {
    id: 'pinata-smash', title: 'Piñata Smash', tagline: 'Find the weak spot. Smash!',
    accent: '#ec4899', duration: 30, category: 'holiday', industries: ['food_bev','cpg','retail'],
    archetype: 'tap-spawn', icon: 'celebration',
    params: {
      bg: '#14000a', objColor: '#ec4899', objSecond: '#f9a8d4',
      desc: 'Tap flashing weak spots on spinning piñata before they disappear',
      signals: [
        { name: 'spots', label: 'Spots Hit' },
        { name: 'misses', label: 'Misses' },
        { name: 'pinatasCracked', label: 'Cracked' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.pinatasCracked >= 3 && sig.misses <= 5', label: 'Piñata Pro 🎊', emoji: '🎊' },
        { cond: 'sig.pinatasCracked >= 2', label: 'Party Animal 🎉', emoji: '🎉' },
        { cond: 'sig.spots >= 15', label: 'Strong Arm 💪', emoji: '💪' },
        { cond: 'true', label: 'Blind Bat 🦇', emoji: '🦇' },
      ],
    }
  },
  {
    id: 'flower-bouquet', title: 'Flower Bouquet', tagline: 'Catch the petals. Build love.',
    accent: '#f472b6', duration: 45, category: 'holiday', industries: ['retail','cpg','healthcare'],
    archetype: 'tap-spawn', icon: 'local_florist',
    params: {
      bg: '#14000f', objColor: '#f472b6', objSecond: '#f9a8d4',
      desc: 'Tap falling flower petals to arrange them into bouquet patterns',
      signals: [
        { name: 'petalsCaught', label: 'Petals' },
        { name: 'bouquetsBuilt', label: 'Bouquets' },
        { name: 'missed', label: 'Missed' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.bouquetsBuilt >= 4 && sig.missed <= 5', label: 'Florist 💐', emoji: '💐' },
        { cond: 'sig.bouquetsBuilt >= 2', label: 'Gardener 🌸', emoji: '🌸' },
        { cond: 'sig.petalsCaught >= 20', label: 'Petal Collector 🌺', emoji: '🌺' },
        { cond: 'true', label: 'Wilting 🥀', emoji: '🥀' },
      ],
    }
  },
  {
    id: 'bbq-master', title: 'BBQ Master', tagline: 'Flip it right. Don\'t burn dad\'s burger.',
    accent: '#f97316', duration: 60, category: 'holiday', industries: ['food_bev','cpg','retail'],
    archetype: 'timing-tap', icon: 'outdoor_grill',
    params: {
      bg: '#14080a', objColor: '#f97316', objSecond: '#fdba74',
      desc: 'Swipe to flip burgers at the exact right moment using heat indicators',
      signals: [
        { name: 'burgers', label: 'Burgers' },
        { name: 'perfectFlips', label: 'Perfect' },
        { name: 'burned', label: 'Burned' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.perfectFlips >= 8 && sig.burned <= 2', label: 'Grill Master 🏆', emoji: '🏆' },
        { cond: 'sig.perfectFlips >= 5', label: 'Dad\'s Helper 👨‍🍳', emoji: '👨‍🍳' },
        { cond: 'sig.maxStreak >= 5', label: 'Flipper 🍔', emoji: '🍔' },
        { cond: 'true', label: 'Char Artist 🔥', emoji: '🔥' },
      ],
    }
  },
  {
    id: 'sparkler-draw', title: 'Sparkler Draw', tagline: 'Draw with fire. Make it sparkle.',
    accent: '#fbbf24', duration: 45, category: 'holiday', industries: ['retail','cpg','sports'],
    archetype: 'drag-trace', icon: 'auto_awesome',
    params: {
      bg: '#0a0800', objColor: '#fbbf24', objSecond: '#fde68a',
      desc: 'Drag finger to draw shapes with sparkler trail; match the target silhouette',
      signals: [
        { name: 'shapesDrawn', label: 'Shapes' },
        { name: 'accuracy', label: 'Accuracy' },
        { name: 'totalTrail', label: 'Trail Length' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.accuracy >= 80 && sig.shapesDrawn >= 5', label: 'Sparkle Artist 🌟', emoji: '🌟' },
        { cond: 'sig.shapesDrawn >= 3', label: 'Fire Writer ✍️', emoji: '✍️' },
        { cond: 'sig.totalTrail >= 2000', label: 'Persistent Glow 🔦', emoji: '🔦' },
        { cond: 'true', label: 'Squiggly ✨', emoji: '✨' },
      ],
    }
  },
  {
    id: 'pencil-pack', title: 'Pencil Pack', tagline: 'Sort and pack. School starts now.',
    accent: '#3b82f6', duration: 30, category: 'holiday', industries: ['retail','cpg','technology'],
    archetype: 'sort-swipe', icon: 'school',
    params: {
      bg: '#00071a', objColor: '#3b82f6', objSecond: '#93c5fd',
      desc: 'Swipe school supplies into correct compartments of a backpack as they fall',
      signals: [
        { name: 'itemsSorted', label: 'Sorted' },
        { name: 'correct', label: 'Correct' },
        { name: 'wrong', label: 'Wrong' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'accuracy >= 0.9 && sig.itemsSorted >= 15', label: 'A+ Student 📚', emoji: '📚' },
        { cond: 'accuracy >= 0.75', label: 'Organized 📐', emoji: '📐' },
        { cond: 'sig.maxStreak >= 8', label: 'Quick Packer ⚡', emoji: '⚡' },
        { cond: 'true', label: 'Scattered 🎒', emoji: '🎒' },
      ],
    }
  },
  {
    id: 'diya-light', title: 'Diya Light', tagline: 'Light the diyas. In order!',
    accent: '#f59e0b', duration: 45, category: 'holiday', industries: ['retail','cpg','food_bev'],
    archetype: 'sequence-memory', icon: 'emoji_objects',
    params: {
      bg: '#14100a', objColor: '#f59e0b', objSecond: '#fcd34d',
      desc: 'Tap diyas in the correct sequence shown briefly to light them in order',
      signals: [
        { name: 'sequencesCompleted', label: 'Sequences' },
        { name: 'maxLength', label: 'Max Length' },
        { name: 'errors', label: 'Errors' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.maxLength >= 7 && sig.errors <= 5', label: 'Diwali Master 🪔', emoji: '🪔' },
        { cond: 'sig.maxLength >= 5', label: 'Light Keeper 🕯️', emoji: '🕯️' },
        { cond: 'sig.sequencesCompleted >= 5', label: 'Devoted 🙏', emoji: '🙏' },
        { cond: 'true', label: 'Still Learning ✨', emoji: '✨' },
      ],
    }
  },
  {
    id: 'dreidel-spin', title: 'Dreidel Spin', tagline: 'Flick it hard. Watch it spin!',
    accent: '#3b82f6', duration: 30, category: 'holiday', industries: ['retail','food_bev','cpg'],
    archetype: 'swipe-launch', icon: 'rotate_right',
    params: {
      bg: '#00071a', objColor: '#3b82f6', objSecond: '#93c5fd',
      desc: 'Flick to spin dreidel; score based on spin duration and landing face',
      signals: [
        { name: 'spins', label: 'Spins' },
        { name: 'gimels', label: 'Gimels 🏆' },
        { name: 'avgDuration', label: 'Avg Spin' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.gimels >= 4 && sig.avgDuration >= 3000', label: 'Dreidel King 🌟', emoji: '🌟' },
        { cond: 'sig.spins >= 8', label: 'Spinner ✡️', emoji: '✡️' },
        { cond: 'sig.avgDuration >= 2500', label: 'Strong Flick 💪', emoji: '💪' },
        { cond: 'true', label: 'Shaky Spin 😬', emoji: '😬' },
      ],
    }
  },
  {
    id: 'dragon-parade', title: 'Dragon Parade', tagline: 'Multi-touch the dragon. Make it dance!',
    accent: '#ef4444', duration: 60, category: 'holiday', industries: ['retail','food_bev','cpg'],
    archetype: 'drag-trace', icon: 'cruelty_free',
    params: {
      bg: '#1a0000', objColor: '#ef4444', objSecond: '#fbbf24',
      desc: 'Drag to guide parade dragon weaving through gates; body follows head',
      signals: [
        { name: 'gatesPassed', label: 'Gates' },
        { name: 'bodySync', label: 'Sync' },
        { name: 'bodyLength', label: 'Length' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.gatesPassed >= 15 && sig.bodySync >= 80', label: 'Parade Dragon 🐉', emoji: '🐉' },
        { cond: 'sig.gatesPassed >= 8', label: 'Dragon Dancer 🎊', emoji: '🎊' },
        { cond: 'sig.bodyLength >= 8', label: 'Long Dragon 🌟', emoji: '🌟' },
        { cond: 'true', label: 'Tangled Dragon 🪢', emoji: '🪢' },
      ],
    }
  },
  {
    id: 'bead-catch', title: 'Bead Catch', tagline: 'Tilt to catch the beads!',
    accent: '#a855f7', duration: 30, category: 'holiday', industries: ['retail','food_bev','cpg'],
    archetype: 'tilt-catch', icon: 'bubble_chart',
    params: {
      bg: '#0d0014', objColor: '#a855f7', objSecond: '#d8b4fe',
      desc: 'Tilt device to move net catching thrown Mardi Gras beads; avoid bottles',
      signals: [
        { name: 'beadsCaught', label: 'Beads' },
        { name: 'bottleHits', label: 'Bottles Hit' },
        { name: 'maxStreak', label: 'Streak' },
        { name: 'comboStrings', label: 'Combo Strings' },
      ],
      personalities: [
        { cond: 'sig.beadsCaught >= 15 && sig.bottleHits <= 2', label: 'Mardi Gras MVP 🎊', emoji: '🎊' },
        { cond: 'sig.beadsCaught >= 10', label: 'Bead Collector 📿', emoji: '📿' },
        { cond: 'sig.bottleHits <= 5', label: 'Nimble Catcher 🏃', emoji: '🏃' },
        { cond: 'true', label: 'Bead Spiller 😅', emoji: '😅' },
      ],
    }
  },
  {
    id: 'lantern-float', title: 'Lantern Float', tagline: 'Blow them up. Watch them rise.',
    accent: '#f97316', duration: 45, category: 'holiday', industries: ['retail','cpg','food_bev'],
    archetype: 'vol-mic', icon: 'light',
    params: {
      bg: '#14060a', objColor: '#f97316', objSecond: '#fdba74',
      desc: 'Blow into mic to float paper lanterns upward through wind currents',
      signals: [
        { name: 'lanternsLaunched', label: 'Launched' },
        { name: 'maxHeight', label: 'Max Height' },
        { name: 'avgVolume', label: 'Avg Breath' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.lanternsLaunched >= 10 && sig.maxHeight >= 400', label: 'Sky Lantern 🏮', emoji: '🏮' },
        { cond: 'sig.lanternsLaunched >= 6', label: 'Float Master 🕯️', emoji: '🕯️' },
        { cond: 'sig.maxHeight >= 300', label: 'High Blower 🌬️', emoji: '🌬️' },
        { cond: 'true', label: 'Gentle Breeze 🍃', emoji: '🍃' },
      ],
    }
  },
  {
    id: 'taco-toss', title: 'Taco Toss', tagline: 'Catch the fillings. Build the taco.',
    accent: '#84cc16', duration: 45, category: 'holiday', industries: ['food_bev','cpg','retail'],
    archetype: 'tilt-catch', icon: 'lunch_dining',
    params: {
      bg: '#071400', objColor: '#84cc16', objSecond: '#bef264',
      desc: 'Tilt to catch falling taco ingredients in the right layer order',
      signals: [
        { name: 'ingredientsCaught', label: 'Ingredients' },
        { name: 'tacosBuilt', label: 'Tacos' },
        { name: 'wrongIngredients', label: 'Wrong Order' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.tacosBuilt >= 4 && sig.wrongIngredients <= 3', label: 'Taco Chef 🌮', emoji: '🌮' },
        { cond: 'sig.tacosBuilt >= 2', label: 'Taco Enthusiast 🫔', emoji: '🫔' },
        { cond: 'sig.ingredientsCaught >= 15', label: 'Ingredient Pro 👩‍🍳', emoji: '👩‍🍳' },
        { cond: 'true', label: 'Taco Disaster 😂', emoji: '😂' },
      ],
    }
  },
  {
    id: 'basket-weave', title: 'Basket Weave', tagline: 'Over. Under. Don\'t drop a strand.',
    accent: '#d97706', duration: 60, category: 'holiday', industries: ['retail','cpg','food_bev'],
    archetype: 'rhythm-tap', icon: 'texture',
    params: {
      bg: '#140d00', objColor: '#d97706', objSecond: '#fcd34d',
      desc: 'Alternate left-right taps in a weaving rhythm to build Easter basket pattern',
      signals: [
        { name: 'weavesCompleted', label: 'Rows Woven' },
        { name: 'breaks', label: 'Breaks' },
        { name: 'maxRhythm', label: 'Best Rhythm' },
        { name: 'maxStreak', label: 'Streak' },
      ],
      personalities: [
        { cond: 'sig.weavesCompleted >= 20 && sig.breaks <= 3', label: 'Master Weaver 🧺', emoji: '🧺' },
        { cond: 'sig.weavesCompleted >= 12', label: 'Basket Maker 🪢', emoji: '🪢' },
        { cond: 'sig.maxRhythm >= 80', label: 'Rhythmic 🎵', emoji: '🎵' },
        { cond: 'true', label: 'Tangled Strand 😅', emoji: '😅' },
      ],
    }
  },
];

// ─── Helper to write a file ───────────────────────────────────────────────────

function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✓ Written: ${path.relative(ROOT, filePath)}`);
}

// ─── Template Functions ────────────────────────────────────────────────────────

function generateGameFile(game) {
  const { id, title, tagline, accent, duration, category, archetype, params } = game;
  const funcName = id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('') + 'Game';
  const musicPattern = category === 'sports' ? 'sports' : category === 'holiday' ? 'holiday' : category === 'breath' ? 'calm' : 'drive';

  switch (archetype) {
    case 'tap-spawn':   return genTapSpawn(game, funcName, musicPattern);
    case 'sort-swipe':  return genSortSwipe(game, funcName, musicPattern);
    case 'timing-tap':  return genTimingTap(game, funcName, musicPattern);
    case 'sequence-memory': return genSequenceMemory(game, funcName, musicPattern);
    case 'combo-tap':   return genComboTap(game, funcName, musicPattern);
    case 'swipe-launch': return genSwipeLaunch(game, funcName, musicPattern);
    case 'swipe-steer': return genSwipeSteer(game, funcName, musicPattern);
    case 'tilt-catch':  return genTiltCatch(game, funcName, musicPattern);
    case 'tilt-steer':  return genTiltSteer(game, funcName, musicPattern);
    case 'tilt-balance': return genTiltBalance(game, funcName, musicPattern);
    case 'vol-mic':     return genVolMic(game, funcName, musicPattern);
    case 'pitch-mic':   return genPitchMic(game, funcName, musicPattern);
    case 'multiple-choice': return genMultipleChoice(game, funcName, musicPattern);
    case 'drag-trace':  return genDragTrace(game, funcName, musicPattern);
    case 'tap-sequence': return genTapSequence(game, funcName, musicPattern);
    case 'rhythm-tap':  return genRhythmTap(game, funcName, musicPattern);
    default: return genTapSpawn(game, funcName, musicPattern);
  }
}

function header(id, accent, duration, title, tagline) {
  return `'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';

const GAME_ID   = '${id}';
const ACCENT    = '${accent}';
const DURATION  = ${duration};
`;
}

function footer(id, funcName) {
  return `
function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>;
  sig: Signals;
  personality: string;
  player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    postWebhook(theme, GAME_ID, { personality, score: sig.score }, player);
  }, [theme, sig, personality, player]);
  return null;
}
`;
}

// ─── TAP SPAWN ARCHETYPE ────────────────────────────────────────────────────

function genTapSpawn(game, funcName, musicPattern) {
  const { id, title, tagline, accent, duration, params } = game;
  const bg = params.bg;
  const obj = params.objColor;
  const obj2 = params.objSecond;
  const emoji = getEmoji(game);

  return `${header(id, accent, duration, title, tagline)}
const GAME_EMOJI   = '${emoji}';
const GAME_TITLE   = '${title}';
const GAME_TAGLINE = '${tagline}';

interface Signals {
  score: number;
  attempts: number;
  hits: number;
  reactionTimes: number[];
  maxStreak: number;
  streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const acc = sig.attempts > 0 ? sig.hits / sig.attempts : 0;
  const avgRx = sig.reactionTimes.length > 0 ? sig.reactionTimes.reduce((a,b) => a+b,0) / sig.reactionTimes.length : 9999;
  if (acc >= 0.8 && avgRx < 500) return '${params.personalities[0].label}';
  if (acc >= 0.6) return '${params.personalities[1].label}';
  if (sig.maxStreak >= 5) return '${params.personalities[2].label}';
  return '${params.personalities[3].label}';
}

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  targets: Array<{ x: number; y: number; r: number; alpha: number; spawnTime: number; id: number }>;
  nextId: number; speedMult: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<GameState>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, attempts: 0, hits: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 },
    targets: [], nextId: 0, speedMult: 1,
  });
  const [phase, setPhase] = useState<Phase>('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const playerSessionRef = useRef<PlayerSession | null>(null);
  useEffect(() => { stateRef.current.sig.score; }, [theme]);

  const spawnTarget = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current;
    const r = 28 + Math.random() * 18;
    const margin = r + 10;
    s.targets.push({
      x: margin + Math.random() * (canvas.width - margin * 2),
      y: margin + Math.random() * (canvas.height - margin * 2),
      r, alpha: 1, spawnTime: Date.now(), id: s.nextId++,
    });
    s.sig.attempts++;
  }, []);

  const endGame = useCallback(() => {
    const s = stateRef.current; s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    setFinalSig({ ...s.sig }); setPhase('done');
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;
    s.running = true; s.timeLeft = DURATION; s.targets = []; s.nextId = 0;
    s.sig = { score: 0, attempts: 0, hits: 0, reactionTimes: [], maxStreak: 0, streakCurrent: 0 };
    s.speedMult = 1;
    setScoreDisplay(0); setTimeLeft(DURATION); setPhase('playing');
    stopMusicRef.current = startMusic('${musicPattern}');
    timerRef.current = setInterval(() => {
      s.timeLeft--; setTimeLeft(s.timeLeft);
      if (s.timeLeft <= 0) { sfx.fail(); haptic([100]); endGame(); }
    }, 1000);
    for (let i = 0; i < 3; i++) spawnTarget();
    const loop = () => {
      if (!s.running) return;
      const W = canvas.width, H = canvas.height;
      ctx.fillStyle = '${bg}';
      ctx.fillRect(0, 0, W, H);
      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      for (let y = 0; y < H; y += 50) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

      const now = Date.now();
      s.targets = s.targets.filter(t => {
        const age = (now - t.spawnTime) / 3000;
        t.alpha = Math.max(0, 1 - age);
        if (t.alpha <= 0) {
          s.sig.streakCurrent = 0;
          sfx.nearMiss(); haptic([20,30,20]);
          return false;
        }
        ctx.save();
        ctx.globalAlpha = t.alpha;
        ctx.shadowBlur = 20; ctx.shadowColor = '${obj}';
        // Outer ring
        ctx.strokeStyle = '${obj}'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI*2); ctx.stroke();
        // Inner fill
        ctx.fillStyle = '${obj}22'; ctx.fill();
        // Core dot
        ctx.shadowBlur = 0; ctx.fillStyle = '${obj2}';
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r*0.25, 0, Math.PI*2); ctx.fill();
        // Pulse ring
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.003 + t.id);
        ctx.strokeStyle = '${obj2}';
        ctx.lineWidth = 1; ctx.globalAlpha = t.alpha * pulse * 0.5;
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 1.3, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
        return true;
      });
      if (s.targets.length < 4 && Math.random() < 0.015 * s.speedMult) spawnTarget();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnTarget]);

  const handleTap = useCallback((cx: number, cy: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const s = stateRef.current; if (!s.running) return;
    const rect = canvas.getBoundingClientRect();
    const x = (cx - rect.left) * (canvas.width / rect.width);
    const y = (cy - rect.top)  * (canvas.height / rect.height);
    let hit = false;
    s.targets = s.targets.filter(t => {
      if (hit) return true;
      const dx = x - t.x, dy = y - t.y;
      if (Math.sqrt(dx*dx+dy*dy) <= t.r + 12) {
        hit = true;
        s.sig.hits++;
        s.sig.reactionTimes.push(Date.now() - t.spawnTime);
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        const pts = s.sig.streakCurrent >= 3 ? 2 : 1;
        s.sig.score += pts;
        s.speedMult = Math.min(2.5, 1 + s.sig.hits * 0.05);
        setScoreDisplay(s.sig.score);
        sfx.collect(); haptic([30]);
        return false;
      }
      return true;
    });
    if (!hit) { s.sig.streakCurrent = 0; sfx.nearMiss(); }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    const onDown = (e: PointerEvent) => { if (phase === 'playing') handleTap(e.clientX, e.clientY); };
    canvas.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('resize', resize); canvas.removeEventListener('pointerdown', onDown); };
  }, [phase, handleTap]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopMusicRef.current) stopMusicRef.current();
  }, []);

  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name); setPlayerAvatar(avatar); initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setPhase('countdown');
  }, []);
  const handleCountdownDone = useCallback(() => { startLoop(); }, [startLoop]);
  const handlePlayAgain = useCallback(() => { setPhase('start'); setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); }, []);

  const buildInsights = (sig: Signals) => {
    const acc = sig.attempts > 0 ? Math.round((sig.hits/sig.attempts)*100) : 0;
    const avgRx = sig.reactionTimes.length > 0 ? Math.round(sig.reactionTimes.reduce((a,b)=>a+b,0)/sig.reactionTimes.length) : 0;
    return [
      { label: 'Accuracy', value: acc + '%', color: acc>=70?'#4ade80':acc>=40?'#facc15':'#ef4444' },
      { label: 'Avg React', value: avgRx + 'ms', color: ACCENT },
      { label: 'Best Streak', value: '×'+sig.maxStreak, color: ACCENT },
      { label: 'Targets Hit', value: String(sig.hits), color: 'var(--color-text)' },
    ];
  };

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>
      {phase === 'start' && (
        <GameStartScreen emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Start" accentColor={theme.colors.accent ?? ACCENT} onStart={handleStart} />
      )}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} aria-label="${title} game canvas" role="img"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT}
              items={[{ label: 'TIME', value: timeLeft, danger: timeLeft <= 5 }, { label: 'SCORE', value: scoreDisplay }]} />
          )}
        </>
      )}
      {phase === 'done' && finalSig && (
        <EndScreen gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.hits >= 8} />
      )}
      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}
    </GameShell>
  );
}
${footer(id, funcName)}`;
}

// ─── TIMING TAP ARCHETYPE ───────────────────────────────────────────────────

function genTimingTap(game, funcName, musicPattern) {
  const { id, title, tagline, accent, duration, params } = game;
  const bg = params.bg;
  const obj = params.objColor;
  const obj2 = params.objSecond;
  const emoji = getEmoji(game);

  return `${header(id, accent, duration, title, tagline)}
const GAME_EMOJI   = '${emoji}';
const GAME_TITLE   = '${title}';
const GAME_TAGLINE = '${tagline}';

interface Signals {
  score: number; attempts: number; perfectTaps: number;
  reactionTimes: number[]; maxStreak: number; streakCurrent: number;
}

function getPersonality(sig: Signals): string {
  const perfect = sig.attempts > 0 ? sig.perfectTaps / sig.attempts : 0;
  if (perfect >= 0.6 && sig.attempts >= 8) return '${params.personalities[0].label}';
  if (perfect >= 0.4) return '${params.personalities[1].label}';
  if (sig.maxStreak >= 4) return '${params.personalities[2].label}';
  return '${params.personalities[3].label}';
}

interface GameState {
  running: boolean; timeLeft: number; sig: Signals;
  indicator: number; indicatorDir: number; indicatorSpeed: number;
  targetMin: number; targetMax: number; active: boolean; spawnTime: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

export default function ${funcName}() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(