'use client';
import { useEffect, useState } from 'react';
import { setMuted, initAudio } from '@/lib/audio';

export default function MuteButton() {
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('mg_muted');
      if (saved === 'true') setMutedState(true);
    } catch { /* ignore */ }
  }, []);

  const toggle = () => {
    initAudio();
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label={muted ? 'Unmute' : 'Mute'}
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: '#fff',
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
