import { BrandTheme } from './brands';

export async function postWebhook(
  theme: BrandTheme,
  gameId: string,
  result: Record<string, unknown>,
): Promise<void> {
  if (!theme.webhookURL) return;
  try {
    let player: unknown = null;
    try { player = JSON.parse(localStorage.getItem('mg_user') || 'null'); } catch { /* ignore */ }
    await fetch(theme.webhookURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: theme.id,
        game: gameId,
        player,
        result: { ...result, timestamp: Date.now() },
      }),
    });
  } catch { /* best-effort — never block the game */ }
}
