'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Step {
  icon: string;   // emoji
  title: string;
  body: string;
}

interface Props {
  gameId: string;   // used for localStorage key
  steps: Step[];    // max 3 steps
  onDone: () => void;
}

export default function SwipeInstructions({ gameId, steps, onDone }: Props) {
  const [current, setCurrent] = useState(0);
  const [dragStart, setDragStart] = useState<number | null>(null);

  // Skip if already seen
  useEffect(() => {
    if (localStorage.getItem(`seen_${gameId}`)) onDone();
  }, []);

  const advance = () => {
    if (current < steps.length - 1) {
      setCurrent(c => c + 1);
    } else {
      localStorage.setItem(`seen_${gameId}`, '1');
      onDone();
    }
  };

  const handleDragEnd = (_: any, info: any) => {
    if (info.offset.x < -40) advance();  // swipe left = next
  };

  const step = steps[current];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4">
        {/* Step dots */}
        <div className="flex justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === current ? 'w-6 bg-white' : 'w-1.5 bg-white/30'}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.2 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={handleDragEnd}
            className="bg-gray-900 border border-white/10 rounded-2xl p-8 text-center select-none"
          >
            <div className="text-6xl mb-4">{step.icon}</div>
            <h2 className="text-white text-xl font-bold mb-2">{step.title}</h2>
            <p className="text-gray-400 text-sm leading-relaxed">{step.body}</p>
          </motion.div>
        </AnimatePresence>

        <div className="mt-6 flex items-center justify-between px-2">
          <span className="text-gray-500 text-xs">← swipe to advance</span>
          <button
            onClick={advance}
            className="bg-white text-black font-bold text-sm px-6 py-2 rounded-full active:scale-95 transition-transform"
          >
            {current === steps.length - 1 ? 'Play' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
