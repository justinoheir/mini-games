'use client';
import { motion, AnimatePresence } from 'framer-motion';

interface HUDItem {
  label: string;
  value: string | number;
  danger?: boolean;
  isTime?: boolean;
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
                  height: 44,
                  background: accentColor,
                  opacity: 0.45,
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ padding: '8px 20px', textAlign: 'center', minWidth: 72 }}>
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={String(item.value)}
                  initial={{ y: -6, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 6, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  style={{
                    fontSize: 32,
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
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.4)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  marginTop: 4,
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
