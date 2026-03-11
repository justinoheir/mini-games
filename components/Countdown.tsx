'use client';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { sfx, haptic } from '@/lib/audio';

interface CountdownProps {
  onComplete: () => void;
  accentColor: string;
  gameName?: string;
}

const STEPS = ['3', '2', '1', 'GO!'] as const;

export default function Countdown({ onComplete, accentColor, gameName }: CountdownProps) {
  const [step, setStep] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (step < 3) { sfx.countdown(); haptic([80]); }
    else if (step === 3) { sfx.go(); haptic([30, 20, 30]); }
  }, [step]);

  useEffect(() => {
    if (step >= STEPS.length) { onCompleteRef.current(); return; }
    const delay = step === STEPS.length - 1 ? 650 : 520;
    const t = setTimeout(() => setStep(s => s + 1), delay);
    return () => clearTimeout(t);
  }, [step]);

  if (step >= STEPS.length) return null;

  const isGo = step === 3;
  const label = STEPS[step];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        background: 'rgba(26, 32, 40, 0.95)',
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ scale: 1.55, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.55, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 480, damping: 26 }}
          style={{
            fontSize: isGo ? 96 : 128,
            fontWeight: 900,
            color: isGo ? accentColor : '#fff',
            lineHeight: 1,
            textAlign: 'center',
            userSelect: 'none',
          }}
        >
          {label}
        </motion.div>
      </AnimatePresence>

      {gameName && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 14,
            fontWeight: 500,
            marginTop: 20,
          }}
        >
          {gameName}
        </motion.div>
      )}
    </motion.div>
  );
}
