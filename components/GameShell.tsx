'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeContext } from '@/lib/ThemeContext';
import { BrandTheme, DEFAULT_THEME } from '@/lib/brands';
import { applyTheme } from '@/lib/theme';
import MuteButton from './MuteButton';

interface GameShellProps {
  title: string;
  emoji: string;
  accentColor: string;
  children: React.ReactNode;
  theme?: BrandTheme;
}

export default function GameShell({ title, emoji, accentColor, children, theme }: GameShellProps) {
  const router = useRouter();
  const resolvedTheme = theme ?? DEFAULT_THEME;
  const [backHovered, setBackHovered] = useState(false);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  void accentColor; // accentColor kept for API compatibility

  return (
    <ThemeContext.Provider value={resolvedTheme}>
      <div
        style={{
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          backgroundColor: 'var(--color-bg)',
          position: 'relative',
          fontFamily: 'var(--font-display)',
        }}
      >
        {/* Top bar — glass morphism */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 56,
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
            background: 'rgba(8, 9, 15, 0.8)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          {/* Back arrow — 44px tap target */}
          <button
            onClick={() => router.push('/')}
            onMouseEnter={() => setBackHovered(true)}
            onMouseLeave={() => setBackHovered(false)}
            aria-label="Back"
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              border: 'none',
              background: backHovered ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
              color: '#fff',
              fontSize: 20,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
          >
            ←
          </button>

          {/* Center: emoji + title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center' }}>
            {resolvedTheme.logo ? (
              <img
                src={resolvedTheme.logo}
                alt={resolvedTheme.name}
                style={{
                  height: resolvedTheme.logoSize ?? 24,
                  objectFit: 'contain',
                  maxWidth: 120,
                }}
              />
            ) : (
              <>
                <span style={{ fontSize: 20 }}>{emoji}</span>
                <span style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>
                  {title}
                </span>
              </>
            )}
          </div>

          {/* Right: mute */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <MuteButton />
          </div>
        </div>

        {children}

        {/* Powered-by badge */}
        {resolvedTheme.poweredBy && (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              right: 14,
              zIndex: 400,
              color: 'var(--color-text-secondary)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.5px',
              pointerEvents: 'none',
              opacity: 0.5,
            }}
          >
            ⚡ Ether
          </div>
        )}
      </div>
    </ThemeContext.Provider>
  );
}
