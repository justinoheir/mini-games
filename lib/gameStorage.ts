'use client';

export interface GameRecord {
  gameId: string;
  highScore: number;
  timesPlayed: number;
  lastPlayedAt: number; // unix ms
  lastScore: number;
}

export interface GlobalStats {
  totalGamesPlayed: number;
  totalTimePlayed: number; // ms
  longestStreak: number;
  lastActiveAt: number;
  favoritGame: string | null;
}

const RECORDS_KEY = 'glimmers_records';  // Record<gameId, GameRecord>
const STATS_KEY   = 'glimmers_stats';    // GlobalStats

// ── Read ──────────────────────────────────────────────────────────────────────

export function getGameRecord(gameId: string): GameRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const all = JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}') as Record<string, GameRecord>;
    return all[gameId] ?? null;
  } catch { return null; }
}

export function getAllRecords(): Record<string, GameRecord> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}'); }
  catch { return {}; }
}

export function getGlobalStats(): GlobalStats {
  if (typeof window === 'undefined') return { totalGamesPlayed: 0, totalTimePlayed: 0, longestStreak: 0, lastActiveAt: 0, favoritGame: null };
  try { return JSON.parse(localStorage.getItem(STATS_KEY) || 'null') ?? { totalGamesPlayed: 0, totalTimePlayed: 0, longestStreak: 0, lastActiveAt: 0, favoritGame: null }; }
  catch { return { totalGamesPlayed: 0, totalTimePlayed: 0, longestStreak: 0, lastActiveAt: 0, favoritGame: null }; }
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function recordGamePlayed(gameId: string, score: number, durationMs = 0): void {
  if (typeof window === 'undefined') return;
  try {
    // Update game record
    const all = getAllRecords();
    const existing = all[gameId] ?? { gameId, highScore: 0, timesPlayed: 0, lastPlayedAt: 0, lastScore: 0 };
    all[gameId] = {
      gameId,
      highScore: Math.max(existing.highScore, score),
      timesPlayed: existing.timesPlayed + 1,
      lastPlayedAt: Date.now(),
      lastScore: score,
    };
    localStorage.setItem(RECORDS_KEY, JSON.stringify(all));

    // Update global stats
    const stats = getGlobalStats();
    // Find favourite: most played game
    const mostPlayed = Object.values(all).sort((a, b) => b.timesPlayed - a.timesPlayed)[0];
    localStorage.setItem(STATS_KEY, JSON.stringify({
      totalGamesPlayed: stats.totalGamesPlayed + 1,
      totalTimePlayed: stats.totalTimePlayed + durationMs,
      longestStreak: stats.longestStreak, // updated separately
      lastActiveAt: Date.now(),
      favoritGame: mostPlayed?.gameId ?? null,
    }));

    // Also write to legacy mg_played for backward compat
    const played: string[] = JSON.parse(localStorage.getItem('mg_played') || '[]');
    if (!played.includes(gameId)) {
      played.push(gameId);
      localStorage.setItem('mg_played', JSON.stringify(played));
    }
  } catch { /* silently ignore storage errors */ }
}

export function clearAllData(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(RECORDS_KEY);
  localStorage.removeItem(STATS_KEY);
  localStorage.removeItem('mg_played');
}
