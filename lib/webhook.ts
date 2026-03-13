import { BrandTheme } from './brands';
import { PlayerSession } from './playerSession';

export async function postWebhook(
  theme: BrandTheme,
  gameId: string,
  result: Record<string, unknown>,
  player?: PlayerSession | null,
): Promise<void> {
  if (!theme.webhookURL) return;
  try {
    // Use passed-in player first; fall back to legacy mg_user for compat
    let resolvedPlayer: unknown = player ?? null;
    let sessionGames: string[] = [];
    let sessionCount = 0;

    try {
      if (!resolvedPlayer) {
        resolvedPlayer = JSON.parse(localStorage.getItem('mg_user') || 'null');
      }
      const played: string[] = JSON.parse(localStorage.getItem('mg_played') || '[]');
      sessionGames = played;
      sessionCount = played.length;
    } catch { /* ignore */ }

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
