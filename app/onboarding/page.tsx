'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { initAudio, sfx } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { motion, AnimatePresence } from 'framer-motion';

const AVATARS = ['🦁', '🐯', '🦊', '🦝', '🐺', '🦈', '🦅', '🦋', '🔥', '⚡', '🌊', '🎯', '💎', '👑', '🚀', '⚔️'];

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export default function Onboarding() {
  const router = useRouter();
  const theme = useBrandTheme();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('mg_user')) {
        router.replace('/');
        return;
      }
    } catch { /* ignore */ }
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, [router]);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !lastName.trim()) return;
    initAudio();
    sfx.click();
    setStep(2);
  };

  const handleAvatarSubmit = async () => {
    if (!avatar) return;
    sfx.click();
    setLoading(true);

    // Also fire lead API with name + email placeholder (backwards compat)
    try {
      await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          lastName: lastName.trim(),
          avatar,
          timestamp: Date.now(),
        }),
      });
    } catch { /* network error is fine */ }

    try {
      const existing = JSON.parse(localStorage.getItem('mg_user') || 'null');
      const id = existing?.id || generateId();
      localStorage.setItem(
        'mg_user',
        JSON.stringify({
          name: name.trim(),
          lastName: lastName.trim(),
          avatar,
          id,
          timestamp: Date.now(),
        })
      );
    } catch { /* ignore */ }

    setLoading(false);
    sfx.go();
    router.push('/');
  };

  const accentColor = theme.colors.accent;

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        transition: 'opacity 0.35s',
        opacity: visible ? 1 : 0,
        background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${accentColor}10 0%, var(--color-bg) 60%)`,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Wordmark */}
        <div
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.04em',
            marginBottom: 36,
            textAlign: 'center',
          }}
        >
          ⚡ Ether
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25 }}
              style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
              {/* Brain emoji */}
              <motion.div
                initial={{ scale: 0, rotate: -15 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.05 }}
                style={{ fontSize: 64, lineHeight: 1, marginBottom: 20, textAlign: 'center' }}
              >
                🧠
              </motion.div>

              <h1
                style={{
                  color: 'var(--color-text)',
                  fontSize: 28,
                  fontWeight: 800,
                  margin: '0 0 10px',
                  textAlign: 'center',
                  letterSpacing: '-0.5px',
                  lineHeight: 1.15,
                }}
              >
                {theme.copy?.headline ?? 'What kind of player are you?'}
              </h1>

              <p
                style={{
                  color: 'var(--color-text-secondary)',
                  fontSize: 15,
                  margin: '0 0 32px',
                  textAlign: 'center',
                  lineHeight: 1.5,
                  maxWidth: 300,
                }}
              >
                {theme.copy?.subhead ?? '11 games. 60 seconds each. Real insights about how you think.'}
              </p>

              <form
                onSubmit={handleNameSubmit}
                style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <input
                  type="text"
                  placeholder="First name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '0 16px',
                    height: 52,
                    borderRadius: 12,
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-raised)',
                    color: '#fff',
                    fontSize: 16,
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.2s',
                  }}
                />
                <input
                  type="text"
                  placeholder="Last name"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '0 16px',
                    height: 52,
                    borderRadius: 12,
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-raised)',
                    color: '#fff',
                    fontSize: 16,
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.2s',
                  }}
                />
                <button
                  type="submit"
                  disabled={!name.trim() || !lastName.trim()}
                  style={{
                    width: '100%',
                    height: 52,
                    borderRadius: 12,
                    border: 'none',
                    backgroundColor: (!name.trim() || !lastName.trim()) ? 'rgba(128,128,128,0.12)' : accentColor,
                    color: (!name.trim() || !lastName.trim()) ? 'var(--color-text-secondary)' : '#000',
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: 'pointer',
                    transition: 'background-color 0.2s, color 0.2s',
                    fontFamily: 'inherit',
                  }}
                >
                  Next →
                </button>
              </form>

              {/* Step indicator */}
              <div style={{ display: 'flex', gap: 6, marginTop: 20 }}>
                <div style={{ width: 20, height: 4, borderRadius: 2, backgroundColor: accentColor }} />
                <div style={{ width: 20, height: 4, borderRadius: 2, backgroundColor: 'var(--color-border-strong)' }} />
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ duration: 0.25 }}
              style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
              {/* Selected avatar preview */}
              <motion.div
                key={avatar || 'empty'}
                initial={{ scale: 0.6, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                style={{
                  fontSize: 72,
                  lineHeight: 1,
                  marginBottom: 16,
                  textAlign: 'center',
                  filter: avatar ? 'none' : 'grayscale(1) opacity(0.25)',
                }}
              >
                {avatar || '❓'}
              </motion.div>

              <h2
                style={{
                  color: 'var(--color-text)',
                  fontSize: 24,
                  fontWeight: 800,
                  margin: '0 0 6px',
                  textAlign: 'center',
                  letterSpacing: '-0.4px',
                }}
              >
                Pick your avatar, {name}
              </h2>

              <p
                style={{
                  color: 'var(--color-text-secondary)',
                  fontSize: 14,
                  margin: '0 0 24px',
                  textAlign: 'center',
                }}
              >
                This is how you&apos;ll show on the leaderboard
              </p>

              {/* Avatar grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 10,
                  width: '100%',
                  marginBottom: 24,
                }}
              >
                {AVATARS.map(emoji => {
                  const selected = avatar === emoji;
                  return (
                    <button
                      key={emoji}
                      onClick={() => {
                        setAvatar(emoji);
                        sfx.click();
                      }}
                      style={{
                        background: selected ? `${accentColor}22` : 'var(--color-surface-raised)',
                        border: selected ? `2px solid ${accentColor}` : '2px solid var(--color-border)',
                        borderRadius: 14,
                        height: 64,
                        fontSize: 30,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'border-color 0.15s, background 0.15s, transform 0.1s, box-shadow 0.15s',
                        transform: selected ? 'scale(1.08)' : 'scale(1)',
                        boxShadow: selected ? `0 0 16px ${accentColor}55` : 'none',
                      }}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={handleAvatarSubmit}
                disabled={loading || !avatar}
                style={{
                  width: '100%',
                  height: 52,
                  borderRadius: 12,
                  border: 'none',
                  backgroundColor: (!avatar || loading) ? 'rgba(128,128,128,0.12)' : accentColor,
                  color: (!avatar || loading) ? 'var(--color-text-secondary)' : '#000',
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: loading ? 'wait' : 'pointer',
                  transition: 'background-color 0.2s, color 0.2s',
                  fontFamily: 'inherit',
                }}
              >
                {loading ? 'Loading...' : (theme.copy?.ctaLabel ?? "Let's Play →")}
              </button>

              {/* Back link */}
              <button
                onClick={() => setStep(1)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-secondary)',
                  fontSize: 13,
                  cursor: 'pointer',
                  marginTop: 14,
                  padding: '4px 8px',
                  fontFamily: 'inherit',
                }}
              >
                ← Back
              </button>

              {/* Step indicator */}
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <div style={{ width: 20, height: 4, borderRadius: 2, backgroundColor: 'var(--color-border-strong)' }} />
                <div style={{ width: 20, height: 4, borderRadius: 2, backgroundColor: accentColor }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style>{`
        input::placeholder { color: #4a5a70; }
        input:focus { border-color: var(--color-accent) !important; }
      `}</style>
    </main>
  );
}
