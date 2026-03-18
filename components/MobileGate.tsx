'use client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface MobileGateProps {
  children: React.ReactNode;
  accentColor?: string;
  gameEmoji?: string;
  gameTitle?: string;
}

function isMobile(): boolean {
  if (typeof window === 'undefined') return true; // SSR: assume mobile (safe default)
  // Primary: touch capability
  if (navigator.maxTouchPoints > 0) return true;
  // Fallback: screen width
  return window.innerWidth < 768;
}

export default function MobileGate({ children, accentColor = '#00ff88', gameEmoji = '🎮', gameTitle = 'Game' }: MobileGateProps) {
  const [mobile, setMobile]   = useState(true); // default true to avoid flash
  const [url, setUrl]         = useState('');
  const [copied, setCopied]   = useState(false);
  const [pulse, setPulse]     = useState(false);

  useEffect(() => {
    setMobile(isMobile());
    setUrl(window.location.href);

    // QR code pulse animation
    const interval = setInterval(() => {
      setPulse(p => !p);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // On desktop: resize listener (if someone drags window narrower)
  useEffect(() => {
    const onResize = () => setMobile(isMobile());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (mobile) return <>{children}</>;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#08090f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-display, "Space Grotesk", sans-serif)',
      overflow: 'hidden',
    }}>
      {/* Background glow */}
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 600,
        height: 600,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${accentColor}12 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 32,
        padding: '48px 56px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 24,
        maxWidth: 480,
        width: '90%',
      }}>
        {/* Game identity */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 12 }}>{gameEmoji}</div>
          <div style={{
            color: '#fff',
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: '-0.5px',
            marginBottom: 8,
          }}>
            {gameTitle}
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 15,
            fontWeight: 500,
            lineHeight: 1.5,
          }}>
            This game needs a phone.
            <br />Scan to play on yours.
          </div>
        </div>

        {/* QR code */}
        <div style={{
          padding: 20,
          background: '#ffffff',
          borderRadius: 16,
          boxShadow: `0 0 ${pulse ? 40 : 24}px ${accentColor}${pulse ? '60' : '30'}`,
          transition: 'box-shadow 1.5s ease',
        }}>
          <QRCodeSVG
            value={url}
            size={200}
            bgColor="#ffffff"
            fgColor="#08090f"
            level="M"
            imageSettings={{
              src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='20' font-size='20'%3E⚡%3C/text%3E%3C/svg%3E",
              height: 28,
              width: 28,
              excavate: true,
            }}
          />
        </div>

        {/* URL + copy */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          padding: '10px 16px',
          width: '100%',
        }}>
          <span style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 12,
            fontWeight: 600,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '0.3px',
          }}>
            {url.replace('https://', '')}
          </span>
          <button
            onClick={handleCopy}
            style={{
              background: copied ? `${accentColor}22` : 'transparent',
              border: `1px solid ${copied ? accentColor : 'rgba(255,255,255,0.15)'}`,
              borderRadius: 6,
              color: copied ? accentColor : 'rgba(255,255,255,0.6)',
              fontSize: 12,
              fontWeight: 700,
              padding: '4px 12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
              letterSpacing: '0.3px',
            }}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>

        {/* Powered by */}
        <div style={{
          color: 'rgba(255,255,255,0.2)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
        }}>
          ⚡ Powered by Ether
        </div>
      </div>

      {/* Back to all games */}
      <a
        href="/"
        style={{
          marginTop: 24,
          color: 'rgba(255,255,255,0.35)',
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
          letterSpacing: '0.3px',
        }}
      >
        ← All games
      </a>
    </div>
  );
}
