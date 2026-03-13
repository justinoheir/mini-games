'use client';
import { useState, useEffect } from 'react';
import { getLastPlayer, AVATAR_OPTIONS } from '@/lib/playerSession';

interface PlayerNameInputProps {
  accentColor: string;
  onReady: (name: string, avatar: string) => void;
}

/**
 * Compact per-game name + avatar capture.
 * Drop inside GameStartScreen's children slot — renders above the CTA button.
 * Calls onReady(name, avatar) whenever values change, so parent can pass
 * them to onStart().
 */
export default function PlayerNameInput({ accentColor, onReady }: PlayerNameInputProps) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATAR_OPTIONS[0]);

  // Pre-fill from last session
  useEffect(() => {
    const last = getLastPlayer();
    if (last) {
      setName(last.name);
      setAvatar(last.avatar);
      onReady(last.name, last.avatar);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleName(v: string) {
    setName(v);
    onReady(v, avatar);
  }

  function handleAvatar(v: string) {
    setAvatar(v);
    onReady(name, v);
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Name input */}
      <input
        type="text"
        placeholder="Your name"
        value={name}
        maxLength={20}
        onChange={(e) => handleName(e.target.value)}
        style={{
          width: '100%',
          height: 48,
          borderRadius: 12,
          border: `1.5px solid ${name ? accentColor + '80' : 'var(--color-border)'}`,
          background: 'var(--color-surface)',
          color: '#fff',
          fontSize: 16,
          fontWeight: 600,
          padding: '0 16px',
          outline: 'none',
          boxSizing: 'border-box',
          marginBottom: 12,
          fontFamily: 'inherit',
          transition: 'border-color 0.2s',
        }}
      />

      {/* Avatar picker */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: 'center',
      }}>
        {AVATAR_OPTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleAvatar(emoji)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              border: avatar === emoji ? `2px solid ${accentColor}` : '1.5px solid var(--color-border)',
              background: avatar === emoji ? accentColor + '22' : 'var(--color-surface)',
              fontSize: 20,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
              padding: 0,
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
