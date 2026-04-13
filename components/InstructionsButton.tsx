'use client';
import React, { useState } from 'react';
import { GAME_INSTRUCTIONS } from '@/lib/gameInstructions';
import { ALL_GAMES } from '@/lib/games';

interface InstructionsButtonProps {
  gameId: string;
}

export default function InstructionsButton({ gameId }: InstructionsButtonProps) {
  const [open, setOpen] = useState(false);

  const instructions = GAME_INSTRUCTIONS[gameId];
  const game = ALL_GAMES.find(g => g.id === gameId);

  if (!instructions) return null;

  return (
    <>
      {/* ℹ️ Button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="How to play"
        style={{
          position: 'absolute',
          top: 66,
          right: 12,
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(0,0,0,0.67)',
          color: '#fff',
          fontSize: 18,
          cursor: 'pointer',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        ℹ️
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          {/* Card */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 16,
              maxWidth: 320,
              width: '100%',
              padding: '24px 20px 20px',
              position: 'relative',
              fontFamily: "'Space Grotesk', sans-serif",
              boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                width: 30,
                height: 30,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(0,0,0,0.06)',
                color: '#333',
                fontSize: 16,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              ✕
            </button>

            {/* Header */}
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                color: '#4393BA',
                marginBottom: 6,
              }}
            >
              HOW TO PLAY
            </div>

            {/* Game title */}
            {game && (
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: '#0f172a',
                  marginBottom: 12,
                  paddingRight: 28,
                  lineHeight: 1.3,
                }}
              >
                {game.title}
              </div>
            )}

            {/* How to play */}
            <p
              style={{
                fontSize: 14,
                color: '#334155',
                lineHeight: 1.55,
                margin: '0 0 14px 0',
              }}
            >
              {instructions.howToPlay}
            </p>

            {/* Controls */}
            <div
              style={{
                fontSize: 13,
                color: '#475569',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
              }}
            >
              <span style={{ flexShrink: 0 }}>🎮</span>
              <span>{instructions.controls}</span>
            </div>

            {/* Goal */}
            <div
              style={{
                fontSize: 13,
                color: '#475569',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
              }}
            >
              <span style={{ flexShrink: 0 }}>🎯</span>
              <span>{instructions.goal}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
