'use client';

export interface PlayerSession {
  name: string;       // first name only, e.g. "Alex"
  avatar: string;     // emoji, e.g. "🦁"
  id: string;         // random uuid for this session
  timestamp: number;
}

const LAST_PLAYER_KEY = 'mg_last_player'; // pre-fill from last session

export function getLastPlayer(): Pick<PlayerSession, 'name' | 'avatar'> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_PLAYER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PlayerSession;
    if (!p.name) return null;
    return { name: p.name, avatar: p.avatar };
  } catch { return null; }
}

export function savePlayerSession(gameId: string, name: string, avatar: string): PlayerSession {
  const session: PlayerSession = {
    name: name.trim() || 'Anonymous',
    avatar: avatar || '🎮',
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  if (typeof window !== 'undefined') {
    // Save as last player for pre-fill on next game
    localStorage.setItem(LAST_PLAYER_KEY, JSON.stringify(session));
    // Also keep mg_user for backward compat (webhook reads it as fallback)
    localStorage.setItem('mg_user', JSON.stringify({
      name: session.name,
      lastName: '',
      avatar: session.avatar,
      id: session.id,
      timestamp: session.timestamp,
    }));
  }
  return session;
}

export const AVATAR_OPTIONS = ['🦁', '⚡', '🎯', '🔥', '🦈', '👑', '🚀', '🌊', '🦊', '💎', '🦅', '🐯'];
