import { BrandTheme } from './brands';
import { PlayerSession } from './playerSession';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function insertGlimmerSession(
  brand: string,
  gameId: string,
  player: PlayerSession | null,
  result: Record<string, unknown>,
  sessionCount: number,
): Promise<void> {
  try {
    const device = typeof navigator !== 'undefined' ? {
      userAgent: navigator.userAgent,
      screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : null,
      platform: navigator.platform,
    } : null;

    await fetch(`${SUPABASE_URL}/rest/v1/glimmer_sessions`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        brand,
        game_id: gameId,
        player_id: player?.id ?? null,
        player_name: player?.name ?? null,
        player_email: player?.email ?? null,
        score: typeof result.score === 'number' ? result.score : null,
        result,
        device,
        session_count: sessionCount,
      }),
    });
  } catch { /* fire-and-forget — never throw, never block */ }
}

export async function postWebhook(
  theme: BrandTheme,
  gameId: string,
  result: Record<string, unknown>,
  player?: PlayerSession | null,
): Promise<void> {
  // Use passed-in player first; fall back to legacy mg_user for compat
  let resolvedPlayer: PlayerSession | null = player ?? null;
  let sessionGames: string[] = [];
  let sessionCount = 0;

  try {
    if (!resolvedPlayer) {
      resolvedPlayer = JSON.parse(localStorage.getItem('mg_user') || 'null') as PlayerSession | null;
    }
    const played: string[] = JSON.parse(localStorage.getItem('mg_played') || '[]');
    sessionGames = played;
    sessionCount = played.length;
  } catch { /* ignore */ }

  // Always store to Supabase regardless of webhookURL
  insertGlimmerSession(theme.id, gameId, resolvedPlayer, result, sessionCount);

  if (!theme.webhookURL) return;
  try {
    await fetch(theme.webhookURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: theme.id,
        game: gameId,
        player: resolvedPlayer,
        session: {
          gamesPlayedTotal: sessionCount,
          gamesPlayed: sessionGames,
          isFirstGame: sessionCount === 1,
          device: {
            userAgent: navigator.userAgent,
            screen: `${screen.width}x${screen.height}`,
            platform: navigator.platform,
          },
        },
        result: {
          ...result,
          timestamp: Date.now(),
          retryCount: (() => {
            try {
              const stored = JSON.parse(localStorage.getItem('mg_scores') || '{}');
              return stored[gameId] ? 1 : 0;
            } catch { return 0; }
          })(),
        },
      }),
    });
  } catch { /* best-effort — never block the game */ }
}
