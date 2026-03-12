import { BrandTheme } from './brands';

export async function postWebhook(
  theme: BrandTheme,
  gameId: string,
  result: Record<string, unknown>,
): Promise<void> {
  if (!theme.webhookURL) return;
  try {
    let player: unknown = null;
    let sessionGames: string[] = [];
    let sessionCount = 0;
    try {
      player = JSON.parse(localStorage.getItem('mg_user') || 'null');
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
        player,
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
              return stored[gameId] ? 1 : 0; // 0 = first attempt, 1+ = retry
            } catch { return 0; }
          })(),
        },
      }),
    });
  } catch { /* best-effort — never block the game */ }
}
