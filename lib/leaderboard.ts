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
  'hoop-shot': ['🏆 Clutch', '🎯 Gunner', '🔥 Streaky', '⛹️ Steady'],
  'tilt-maze': ['🎯 Precise', '⚡ Reactive', '🧘 Calm'],
  'whisper-bomb': ['🤫 Ghost', '💥 Explosive', '😤 Tense'],
  'breath-rider': ['🌬️ Zen', '🎢 Rhythmic', '⚡ Erratic'],
  'steady-hand': ['🎯 Surgeon', '🧘 Zen', '⚡ Shaky'],
  'tunnel': ['🚀 Pilot', '💨 Drifter', '💥 Crasher'],
  'pulse-sphere': ['🔮 Attuned', '🌊 Flowing', '⚡ Charged'],
  'penalty-kick': ['🥅 Sniper', '💪 Powershot', '🤞 Lucky'],
  'spiral-throw': ['🏈 QB1', '🎯 Accurate', '💨 Gunslinger'],
  'reflex-rally': ['⚡ Machine', '🎾 Consistent', '💪 Fighter'],
  'precision-putt': ['🏌️ Pro', '🎯 Analyst', '🤞 Gambler'],
};

// Score ranges per game (realistic)
const SCORE_RANGES: Record<string, [number, number]> = {
  'hoop-shot': [8, 42],
  'tilt-maze': [0, 1],        // completion-based
  'whisper-bomb': [15, 30],
  'breath-rider': [200, 800],
  'steady-hand': [60, 98],    // percentage
  'tunnel': [800, 9999],
  'pulse-sphere': [30, 95],
  'penalty-kick': [3, 12],
  'spiral-throw': [40, 95],
  'reflex-rally': [12, 48],
  'precision-putt': [2, 9],
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

  return fakes.slice(0, 15); // top 15
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
