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

  // Entrance whoosh — fires once when countdown screen appears
  useEffect(() => {
    sfx.swoosh();
    haptic([20, 10, 20]);
  }, []);

  // SFX per step
  useEffect(() => {
    if (step === 0) return; // skip — handled by entrance effect
    if (step < 3) {
      // 2 and 1 — slam + escalating haptic
      sfx.slam();
      haptic(step === 2 ? [60, 20, 60] : [100, 30, 100]);
    } else if (step === 3) {
      // GO — power burst
      sfx.powerOn();
      haptic([30, 10, 30, 10, 80]);
    }
  }, [step]);

  // Trigger slam on step 0 (first number: 3)
  useEffect(() => {
    sfx.slam();
    haptic([40]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount after the swoosh

  useEffect(() => {
    if (step >= STEPS.length) { onCompleteRef.current(); return; }
    // Numbers: 520ms each. GO: 650ms (slightly longer for impact)
    const delay = step === STEPS.length - 1 ? 680 : 520;
    const t = setTimeout(() => setStep(s => s + 1), delay);
    return () => clearTimeout(t);
  }, [step]);

  if (step >= STEPS.length) return null;

  const isGo  = step === 3;
  const label = STEPS[step];

  return (
    <motion.div
      data-testid="countdown-display"
      data-step={label}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        background: `radial-gradient(ellipse 60% 60% at 50% 50%, ${accentColor}14 0%, rgba(8,9,15,0.98) 70%)`,
        backdropFilter: 'blur(6px)',
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={isGo
            ? { scale: 0.5, opacity: 0, y: 20 }
            : { scale: 2.2, opacity: 0 }        // slam in from large
          }
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={isGo
            ? { scale: 1.3, opacity: 0 }
            : { scale: 0.7, opacity: 0 }
          }
          transition={isGo
            ? { type: 'spring', stiffness: 400, damping: 20 }
            : { type: 'spring', stiffness: 600, damping: 22, mass: 0.8 }  // snappy slam
          }
          style={{
            fontSize: isGo ? 100 : 144,
            fontWeight: 900,
            color: isGo ? accentColor : '#ffffff',
            lineHeight: 1,
            textAlign: 'center',
            userSelect: 'none',
            letterSpacing: '-4px',
            // Subtle shadow pulse on numbers
            textShadow: isGo
              ? `0 0 60px ${accentColor}80`
              : `0 0 40px rgba(255,255,255,0.15)`,
          }}
        >
          {label}
        </motion.div>
      </AnimatePresence>

      {/* Progress dots */}
      {!isGo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 32,
          }}
        >
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: i < (3 - step)
                  ? accentColor
                  : 'rgba(255,255,255,0.2)',
                transition: 'background 0.2s',
              }}
            />
          ))}
        </motion.div>
      )}

      {gameName && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 0.4, y: 0 }}
          transition={{ delay: 0.12 }}
          style={{
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 600,
            marginTop: 24,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
          }}
        >
          {gameName}
        </motion.div>
      )}
    </motion.div>
  );
}
