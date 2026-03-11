import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], weight: ['400', '600', '700', '800', '900'] });

export const metadata: Metadata = {
  title: 'Mini Games',
  description: '5 mobile-first mini games using device sensors',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body style={{ margin: 0, padding: 0, backgroundColor: '#1a2028', WebkitTapHighlightColor: 'transparent' }}>
        {children}
      </body>
    </html>
  );
}
