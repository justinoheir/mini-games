import { BRANDS, DEFAULT_THEME, BrandTheme } from './brands';

export function getTheme(brandId?: string | null): BrandTheme {
  if (!brandId) return DEFAULT_THEME;
  return BRANDS[brandId] ?? DEFAULT_THEME;
}

export function applyTheme(theme: BrandTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--color-primary',        theme.colors.primary);
  root.style.setProperty('--color-accent',         theme.colors.accent);
  root.style.setProperty('--color-bg',             theme.colors.background);
  root.style.setProperty('--color-card',           theme.colors.card);
  root.style.setProperty('--color-text',           theme.colors.text);
  root.style.setProperty('--color-text-secondary', theme.colors.textSecondary);
  if (theme.font) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font)}&display=swap`;
    document.head.appendChild(link);
    root.style.setProperty('--font-family', `'${theme.font}', sans-serif`);
  }
}
