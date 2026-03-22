import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { PostHogProvider } from '@/lib/posthog';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import './globals.css';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'Ether Glimmers',
  description: 'Interactive experiences by Ether — feel the moment, measure the magic.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Glimmers',
  },
  formatDetection: { telephone: false },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#08090f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.className} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.jpg" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-192.jpg" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-192.jpg" />
        <link rel="apple-touch-startup-image" href="/icons/icon-512.jpg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: '#08090f', WebkitTapHighlightColor: 'transparent' }}>
        <PostHogProvider>
          {children}
          <ServiceWorkerRegistrar />
        </PostHogProvider>
      </body>
    </html>
  );
}
