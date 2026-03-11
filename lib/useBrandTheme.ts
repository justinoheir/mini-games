'use client';
import { useState, useEffect } from 'react';
import { getTheme, applyTheme } from './theme';
import { BrandTheme, DEFAULT_THEME } from './brands';

/** Reads ?brand from the URL (client-side only) and returns the resolved theme.
 *  Also calls applyTheme() so CSS vars are set. */
export function useBrandTheme(): BrandTheme {
  const [theme, setTheme] = useState<BrandTheme>(DEFAULT_THEME);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const brandId = params.get('brand');
    const resolved = getTheme(brandId);
    applyTheme(resolved);
    setTheme(resolved);
  }, []);

  return theme;
}
