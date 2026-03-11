'use client';
import { motion, AnimatePresence } from 'framer-motion';

interface HUDItem {
  label: string;
  value: string | number;
  danger?: boolean;
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
        background: 'rgba(17, 24, 32, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.12)',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 10,
        ...style,
      }}
    >
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && (
            <div
              style={{
                width: 1,
                height: 44,
                background: accentColor,
                opacity: 0.55,
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
                  fontSize: 28,
                  fontWeight: 900,
                  color: item.danger ? '#ef4444' : '#fff',
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.5px',
                }}
              >
                {item.value}
              </motion.div>
            </AnimatePresence>
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.45)',
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                marginTop: 4,
              }}
            >
              {item.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
