'use client';
import { motion, AnimatePresence } from 'framer-motion';

interface HUDItem {
  label: string;
  value: string | number;
  danger?: boolean;
  isTime?: boolean;
  /** Optional data-testid placed on a stable wrapper around the value (for Playwright tests) */
  testId?: string;
}

interface GameHUDProps {
  items: HUDItem[];
  accentColor: string;
  style?: React.CSSProperties;
}

export default function GameHUD({ items, accentColor, style }: GameHUDProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 64,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        background: 'rgba(8, 9, 15, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.10)',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 10,
        ...style,
      }}
    >
      {items.map((item, i) => {
        const isDanger = item.danger;
        const isTimeItem = item.isTime ?? item.label === 'TIME';
        const shouldPulse = isDanger && isTimeItem;

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && (
              <div
                style={{
                  width: 1,
                  height: 60,
                  background: accentColor,
                  opacity: 0.45,
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ padding: '8px 14px', textAlign: 'center', minWidth: 100 }}>
              {/*
               * Stable wrapper with data-testid — always present in DOM, always visible.
               * Its text content is always the current value (e.g. "60" or "3").
               * This avoids the AnimatePresence key-swap briefly creating two elements
               * with the same testId at different opacities, which confuses Playwright.
               */}
              <div
                data-testid={item.testId}
                style={{ overflow: 'hidden', lineHeight: 1, minHeight: 40 }}
                aria-label={item.testId ? `${item.label}: ${item.value}` : undefined}
              >
                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={String(item.value)}
                    initial={{ y: -6, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                    style={{
                      fontSize: 40,
                      fontWeight: 900,
                      color: isDanger ? '#ef4444' : '#fff',
                      lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                      letterSpacing: '-0.5px',
                      animation: shouldPulse ? 'pulse-danger 0.5s ease-in-out infinite' : 'none',
                    }}
                  >
                    {item.value}
                  </motion.div>
                </AnimatePresence>
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.55)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginTop: 3,
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
