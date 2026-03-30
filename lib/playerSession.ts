'use client';

const MG_USER_KEY     = 'mg_user';
const LAST_PLAYER_KEY = 'mg_last_player'; // legacy key — written for backwards compat

export interface PlayerSession {
  /** First name (Typeform capture) */
  firstName: string;
  /** Last name (Typeform capture) */
  lastName: string;
  /** Email (Typeform capture) */
  email: string;
  /** firstName + ' ' + lastName — backwards compat for existing game code */
  name: string;
  /** Emoji avatar, e.g. '🦁' */
  avatar: string;
  /** Random UUID for this session */
  id: string;
  timestamp: number;
}

export const AVATAR_OPTIONS = ['🦁', '⚡', '🎯', '🔥', '🦈', '👑', '🚀', '🌊', '🦊', '💎', '🦅', '🐯'];

/** Read the current mg_user from localStorage. Handles old format gracefully. */
export function getLastPlayer(): Pick<PlayerSession, 'firstName' | 'lastName' | 'email' | 'name' | 'avatar'> | null {
  if (typeof window === 'undefined') return null;
  try {
    // Try mg_user first (new key), fall back to legacy mg_last_player
    const raw = localStorage.getItem(MG_USER_KEY) ?? localStorage.getItem(LAST_PLAYER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PlayerSession> & { name?: string };
    if (!p.name && !p.firstName) return null;

    // Handle old format: { name, avatar } without firstName/lastName/email
    const nameParts = (p.name ?? '').split(' ');
    return {
      firstName: p.firstName ?? nameParts[0] ?? '',
      lastName:  p.lastName  ?? nameParts.slice(1).join(' ') ?? '',
      email:     p.email     ?? '',
      name:      p.name      ?? [p.firstName, p.lastName].filter(Boolean).join(' '),
      avatar:    p.avatar    ?? AVATAR_OPTIONS[0],
    };
  } catch {
    return null;
  }
}

/**
 * Save a player session after game start.
 * Preserves firstName / lastName / email that were captured by the Typeform overlay.
 */
export function savePlayerSession(gameId: string, name: string, avatar: string): PlayerSession {
  // Read existing user data so we preserve firstName/lastName/email from the Typeform capture
  let existingUser: Partial<PlayerSession> = {};
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(MG_USER_KEY);
      if (raw) existingUser = JSON.parse(raw) as Partial<PlayerSession>;
    } catch { /* ignore */ }
  }

  const nameParts  = (name ?? '').split(' ');
  const firstName  = (existingUser.firstName ?? nameParts[0] ?? name).trim();
  const lastName   = (existingUser.lastName  ?? nameParts.slice(1).join(' ') ?? '').trim();
  const email      = (existingUser.email     ?? '').trim();

  const session: PlayerSession = {
    // Spread existing fields first so extra props (like `consented`) are preserved,
    // then override with the canonical fields for this session.
    ...(existingUser as Partial<PlayerSession>),
    firstName,
    lastName,
    email,
    name: name.trim() || 'Anonymous',
    avatar: avatar || '🎮',
    id: existingUser.id ?? crypto.randomUUID(),
    timestamp: Date.now(),
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(MG_USER_KEY,     JSON.stringify(session));
    localStorage.setItem(LAST_PLAYER_KEY, JSON.stringify(session)); // legacy compat
  }

  return session;
}
