export interface BrandTheme {
  id: string;
  name: string;
  colors: {
    primary: string;
    accent: string;
    background: string;
    card: string;
    text: string;
    textSecondary: string;
  };
  font?: string;
  logo?: string;
  logoPosition?: 'left' | 'center' | 'right';
  logoSize?: number;
  poweredBy?: boolean;
  copy?: {
    headline?: string;
    subhead?: string;
    ctaLabel?: string;
    completionMessage?: string;
    completionCTA?: string;
    completionCTAUrl?: string;
  };
  webhookURL?: string;
}

export const DEFAULT_THEME: BrandTheme = {
  id: 'ether',
  name: 'Ether',
  colors: {
    primary:       '#00ff88',
    accent:        '#00ff88',
    background:    '#08090f',
    card:          '#0e1018',
    text:          '#f0f4ff',
    textSecondary: '#6b7a99',
  },
};

export const BRANDS: Record<string, BrandTheme> = {
  'demo-brand': {
    id: 'demo-brand',
    name: 'Demo Brand',
    colors: {
      primary:       '#E4003A',
      accent:        '#FFD700',
      background:    '#0d0008',
      card:          '#180010',
      text:          '#ffffff',
      textSecondary: '#aa7788',
    },
    poweredBy: true,
    copy: {
      headline:          'How do you react under pressure?',
      subhead:           'Five micro-challenges. Real behavioral signals. 60 seconds each.',
      ctaLabel:          'Begin Assessment →',
      completionMessage: 'Assessment complete.',
      completionCTA:     'See Your Report',
      completionCTAUrl:  'https://demo.etheranalytics.com/report',
    },
  },
};

export function buildDynamicTheme(name: string, primaryColor: string): BrandTheme {
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const r = parseInt(primaryColor.slice(1, 3), 16) || 132;
  const g = parseInt(primaryColor.slice(3, 5), 16) || 208;
  const b = parseInt(primaryColor.slice(5, 7), 16) || 249;
  return {
    id: 'dynamic',
    name,
    colors: {
      primary:       primaryColor,
      accent:        primaryColor,
      background:    `#${hex(r * 0.07)}${hex(g * 0.07)}${hex(b * 0.07)}`,
      card:          `#${hex(r * 0.13)}${hex(g * 0.13)}${hex(b * 0.13)}`,
      text:          '#ffffff',
      textSecondary: 'rgba(255,255,255,0.6)',
    },
    poweredBy: true,
  };
}
