export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  name: string;        // "Justin O."
  avatar: string;      // emoji
  score: number;
  personality: string; // e.g. "Clutch 🏆"
  isCurrentPlayer?: boolean;
}

// Fake player pool — varied names, realistic scores
const FAKE_PLAYERS = [
  { name: 'Alex M.', avatar: '🦁' },
  { name: 'Jordan T.', avatar: '⚡' },
  { name: 'Sam K.', avatar: '🎯' },
  { name: 'Riley P.', avatar: '🔥' },
  { name: 'Morgan L.', avatar: '🦈' },
  { name: 'Casey W.', avatar: '👑' },
  { name: 'Drew F.', avatar: '🚀' },
  { name: 'Quinn R.', avatar: '🌊' },
  { name: 'Blake S.', avatar: '🦊' },
  { name: 'Avery C.', avatar: '💎' },
  { name: 'Dakota H.', avatar: '🦅' },
  { name: 'Reese N.', avatar: '🐯' },
  { name: 'Sage B.', avatar: '🦋' },
  { name: 'Phoenix J.', avatar: '⚔️' },
  { name: 'Skyler V.', avatar: '🦝' },
];

const PERSONALITIES_BY_GAME: Record<string, string[]> = {
  'hoop-shot': ['🏆 Clutch', '🎯 Gunner', '🔥 Streaky', '⛹️ Steady'],  // matches getPersonality output
  'tilt-maze': ['Precise 🎯', 'Reactive ⚡', 'Calm 🧘'],
  'whisper-bomb': ['Calm 🧘', 'Explosive 💥', 'Reactive ⚡'],
  'breath-rider': ['Steady 🧘', 'Focused 🎯', 'Anxious 😤'],
  'steady-hand': ['Steady as a rock 🪨', 'Slightly shaky 🤏', 'Anxious energy ⚡'],
  'tunnel': ['Precise 🎯', 'Conservative 🧊', 'Aggressive 🔥'],
  'pulse-sphere': ['Verbal 🎙️', 'Kinetic 🏃', 'Tactile 👆', 'Balanced ⚖️'],
  'penalty-kick': ['🎯 Composed Finisher', '💥 Power Shooter', '🌀 Trickster', '⚽ Striker'],
  'spiral-throw': ['🧠 Field General', '🔫 Gunslinger', '📋 Checkdown Artist', '🏈 QB'],
  'reflex-rally': ['🤖 Machine', '⚡ Clutch Player', '🎾 Consistent'],
  'precision-putt': ['🔬 Surgeon', '🎯 Feel Player', '🤔 Overthinks It', '🏌️ Steady Putter'],
  'color-cascade': ['Chromatic Hawk 🦅', 'Speed Demon 🔥', 'Deliberate Eye 🔭', 'Casual Tapper 🌊'],
  'memory-grid': ['Memory Master 🧩', 'Pattern Hunter 🔍', 'Fast Guesser ⚡', 'Steady Mind 🌊'],
  'reaction-chain': ['Lightning Reflex ⚡', 'Chain Keeper 🔗', 'Sprinter 🏃', 'Steady Reactor 🌊'],
  'shadow-tap': ['Gut Reader 👁️', 'Sharp Processor 🔬', 'Overthinker 🌀', 'The Hunter 🌊'],
  'stack-drop': ['The Architect 🏛️', 'Speed Stacker ⚡', 'Perfectionist 🎯', 'Bold Builder 🌊'],
  'dodge-blitz': ['Ghost 👻', 'Reactive 🔥', 'Controlled 🧘', 'Survivor 🌊'],
  'orbit-control': ['Orbital Master 🌌', 'Overcorrector 🔄', 'The Drifter 🌊', 'Navigator 🧭'],
  'symbol-scan': ['Eagle Eye 🦅', 'Rapid Scanner ⚡', 'Methodical 🔬', 'Pattern Seeker 🌊'],
  'path-trace': ['Laser Line 🎯', 'Speed Tracer 🏎️', 'Steady Hand 🧘', 'Free Spirit 🌊'],
  'crowd-roar': ['Crowd King 👑', 'Burst Machine 💥', 'Steady Roar 🔥', 'Building Up 🌊'],
  'balance-beam': ['Zen Master 🧘', 'Micromanager 🔄', 'Bold Corrector 💪', 'Learning Curve 🌊'],
  'pitch-match': ['Natural Pitch 🎼', 'Sustained Voice 🌬️', 'Close Enough 🎸', 'Finding Voice 🌊'],
  // Holiday games
  'gift-rush':        ['Santa\'s MVP 🎅', 'The Elf 🧝', 'Quick Sorter ⚡', 'Still Learning 🌱'],
  'snow-catch':       ['Blizzard Survivor 🌨️', 'Snow Magnet ❄️', 'Golden Hunter ✨', 'First Snowfall 🌱'],
  'boo-blast':        ['Ghost Hunter 🔪', 'The Exorcist 📿', 'Precision Buster 🎯', 'First Time Ghost 🌱'],
  'cauldron-bubble':  ['Master Witch 🧙', 'Potion Master 🧪', 'Cauldron Keeper 🌙', 'The Muggle 😅'],
  'firework-launch':  ['Pyrotechnist 🎆', 'Sky Painter ✨', 'Precision Igniter 🎇', 'Happy New Year! 🎉'],
  'countdown-crush':  ['Midnight Champion 🏆', 'Champagne Crusher 🥂', 'Party Animal 🎉', 'New Year, New Me 🎆'],
  'cupid-shot':       ['Cupid Himself 💘', 'True Love ❤️‍🔥', 'Sharpshooter 🏹', 'Still Searching 💔'],
  'love-note':        ['Love Poet 📝', 'Devoted ❤️‍🔥', 'Sweet Talker 💬', 'Short Love Note 💌'],
  'turkey-trot':      ['Turkey Whisperer 🦃', 'The Hunter 🍂', 'Quick Hands ⚡', 'Thankful Anyway 🙏'],
  'harvest-catch':    ['Harvest Champion 🏆', 'Head of the Table 🦃', 'Golden Gatherer ✨', 'Still Loading Plate 🍽️'],
};

// Score ranges per game (realistic — must match parseScoreNum output of actual game scores)
const SCORE_RANGES: Record<string, [number, number]> = {
  'hoop-shot': [8, 42],
  'tilt-maze': [8, 55],       // completion time in seconds (parseScoreNum("12.5s") = 12.5); lower is better but displayed as pts
  'whisper-bomb': [0, 1],     // score is 'Defused'(0) or 'Exploded'(0) — parseScoreNum returns 0; use binary range
  'breath-rider': [200, 800],
  'steady-hand': [60, 98],    // percentage
  'tunnel': [800, 9999],
  'pulse-sphere': [30, 95],
  'penalty-kick': [3, 12],
  'spiral-throw': [40, 95],
  'reflex-rally': [12, 48],
  'precision-putt': [2, 9],
  'color-cascade': [15, 120],
  'memory-grid': [30, 280],
  'reaction-chain': [5, 38],
  'shadow-tap': [20, 150],
  'stack-drop': [40, 220],
  'dodge-blitz': [10, 65],
  'orbit-control': [35, 92],
  'symbol-scan': [25, 180],
  'path-trace': [60, 280],
  'crowd-roar': [100, 850],
  'balance-beam': [150, 950],
  'pitch-match': [50, 380],
  // Holiday games
  'gift-rush':        [15, 45],
  'snow-catch':       [20, 60],
  'boo-blast':        [10, 35],
  'cauldron-bubble':  [15, 42],
  'firework-launch':  [20, 80],
  'countdown-crush':  [30, 100],
  'cupid-shot':       [10, 50],
  'love-note':        [4, 14],
  'turkey-trot':      [8, 25],
  'harvest-catch':    [15, 55],
  'all': [500, 4500],
};

export function getMockLeaderboard(
  gameId: string,
  currentPlayer: { name: string; lastName: string; avatar: string } | null,
  currentScore: number,
  currentPersonality: string,
  brandId: string = 'ether',
): LeaderboardEntry[] {
  // Generate deterministic fake scores based on gameId + brandId seed
  const seed = gameId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + brandId.length;
  const [minScore, maxScore] = SCORE_RANGES[gameId] ?? [0, 100];
  const personalities = PERSONALITIES_BY_GAME[gameId] ?? ['⚡ Fast', '🎯 Precise', '🌊 Calm'];

  // Generate 15 fake entries
  const fakes: LeaderboardEntry[] = FAKE_PLAYERS.map((p, i) => {
    // Pseudo-random but deterministic score
    const pseudoRand = ((seed * (i + 1) * 7919) % 1000) / 1000;
    const score = Math.round(minScore + pseudoRand * (maxScore - minScore));
    const personalityIdx = Math.floor(pseudoRand * personalities.length);
    return {
      rank: 0,
      playerId: `fake-${i}`,
      name: p.name,
      avatar: p.avatar,
      score,
      personality: personalities[personalityIdx],
    };
  });

  // Add current player
  if (currentPlayer) {
    const shortName = `${currentPlayer.name} ${currentPlayer.lastName.charAt(0)}.`;
    fakes.push({
      rank: 0,
      playerId: 'current',
      name: shortName,
      avatar: currentPlayer.avatar,
      score: currentScore,
      personality: currentPersonality,
      isCurrentPlayer: true,
    });
  }

  // Sort by score descending, assign ranks
  fakes.sort((a, b) => b.score - a.score);
  fakes.forEach((e, i) => { e.rank = i + 1; });

  // Always include current player even if outside top 15
  const top15 = fakes.slice(0, 15);
  if (currentPlayer) {
    const currentInTop = top15.some(e => e.playerId === 'current');
    if (!currentInTop) {
      const currentEntry = fakes.find(e => e.playerId === 'current');
      if (currentEntry) top15.push(currentEntry);
    }
  }
  return top15;
}

// For the home screen teaser — overall top 3
export function getOverallTopPlayers(): LeaderboardEntry[] {
  const overallScores: Record<string, number> = {};
  const playerMap: Record<string, { name: string; avatar: string }> = {};

  FAKE_PLAYERS.forEach((p, i) => {
    overallScores[`fake-${i}`] = 0;
    playerMap[`fake-${i}`] = p;
  });

  // Sum scores across all games for each player
  Object.keys(SCORE_RANGES).forEach(gameId => {
    if (gameId === 'all') return;
    const seed = gameId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + 5; // 'ether'.length = 5
    const [minScore, maxScore] = SCORE_RANGES[gameId];
    FAKE_PLAYERS.forEach((_, i) => {
      const pseudoRand = ((seed * (i + 1) * 7919) % 1000) / 1000;
      const score = Math.round(minScore + pseudoRand * (maxScore - minScore));
      overallScores[`fake-${i}`] += score;
    });
  });

  const entries: LeaderboardEntry[] = Object.entries(overallScores).map(([id, score]) => ({
    rank: 0,
    playerId: id,
    name: playerMap[id].name,
    avatar: playerMap[id].avatar,
    score,
    personality: '🏆 Champion',
  }));

  entries.sort((a, b) => b.score - a.score);
  entries.forEach((e, i) => { e.rank = i + 1; });

  return entries.slice(0, 3);
}
