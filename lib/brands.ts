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
    background:    '#0a0a0a',
    card:          '#111111',
    text:          '#ffffff',
    textSecondary: '#666666',
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
