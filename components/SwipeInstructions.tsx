'use client';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface Step {
  icon: React.ReactNode | string;
  title: string;
  body: string;
}

interface Props {
  gameId: string;
  steps: Step[];
  onDone: () => void;
}

export default function SwipeInstructions({ gameId, steps, onDone }: Props) {
  const [current, setCurrent] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Skip if already seen
    if (typeof window !== 'undefined' && localStorage.getItem(`seen_${gameId}`)) {
      onDone();
      return;
    }
    setMounted(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const advance = () => {
    if (current < steps.length - 1) {
      setCurrent(c => c + 1);
    } else {
      localStorage.setItem(`seen_${gameId}`, '1');
      onDone();
    }
  };

  const handleDragEnd = (_: unknown, info: { offset: { x: number } }) => {
    if (info.offset.x < -40) advance();
  };

  if (!mounted) return null;

  const step = steps[current];

  const content = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.92)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        padding: '24px 20px',
      }}
    >
      {/* Dots */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
        {steps.map((_, i) => (
          <div
            key={i}
            style={{
              height: 6,
              width: i === current ? 24 : 6,
              borderRadius: 9999,
              background: i === current ? '#fff' : 'rgba(255,255,255,0.25)',
              transition: 'all 0.3s ease',
            }}
          />
        ))}
      </div>

      {/* Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current}
          initial={{ opacity: 0, x: 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -48 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={handleDragEnd}
          style={{
            width: '100%',
            maxWidth: 340,
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 24,
            padding: '36px 28px',
            textAlign: 'center',
            userSelect: 'none',
            cursor: 'grab',
          }}
        >
          <div style={{ lineHeight: 1, marginBottom: 20, display: 'flex', justifyContent: 'center', alignItems: 'center', height: 64 }}>
            {typeof step.icon === 'string' ? <span style={{ fontSize: 64 }}>{step.icon}</span> : step.icon}
          </div>
          <h2 style={{
            color: '#fff',
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 12,
            lineHeight: 1.2,
          }}>
            {step.title}
          </h2>
          <p style={{
            color: 'rgba(255,255,255,0.6)',
            fontSize: 15,
            lineHeight: 1.6,
            margin: 0,
          }}>
            {step.body}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Controls */}
      <div style={{
        marginTop: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        maxWidth: 340,
      }}>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
          ← swipe to advance
        </span>
        <button
          onClick={advance}
          style={{
            background: '#fff',
            color: '#000',
            fontWeight: 800,
            fontSize: 14,
            padding: '10px 28px',
            borderRadius: 9999,
            border: 'none',
            cursor: 'pointer',
            transform: 'scale(1)',
            transition: 'transform 0.1s',
          }}
          onPointerDown={e => (e.currentTarget.style.transform = 'scale(0.95)')}
          onPointerUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {current === steps.length - 1 ? 'Play' : 'Next →'}
        </button>
      </div>
    </div>
  );

  // Portal to document.body — escapes any parent overflow/transform/z-index issues
  return createPortal(content, document.body);
}
