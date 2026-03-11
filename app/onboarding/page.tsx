'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { initAudio, sfx } from '@/lib/audio';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { motion } from 'framer-motion';

export default function Onboarding() {
  const router = useRouter();
  const theme = useBrandTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    initAudio();
    sfx.click();
    setLoading(true);
    try {
      await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), timestamp: Date.now() }),
      });
    } catch { /* network error is fine */ }
    try {
      localStorage.setItem('mg_user', JSON.stringify({ name: name.trim(), email: email.trim(), timestamp: Date.now() }));
    } catch { /* ignore */ }
    setLoading(false);
    sfx.go();
    router.push('/');
  };

  const isValid = name.trim().length > 0 && email.trim().length > 0;

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

        {/* Brain emoji */}
        <motion.div
          initial={{ scale: 0, rotate: -15 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.05 }}
          style={{ fontSize: 64, lineHeight: 1, marginBottom: 20, textAlign: 'center' }}
        >
          🧠
        </motion.div>

        {/* Headline */}
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

        {/* Subhead */}
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

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <input
            type="text"
            placeholder="What should we call you?"
            value={name}
            onChange={e => setName(e.target.value)}
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
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
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
            disabled={loading || !isValid}
            style={{
              width: '100%',
              height: 52,
              borderRadius: 12,
              border: 'none',
              backgroundColor: !isValid ? 'rgba(128,128,128,0.12)' : theme.colors.accent,
              color: !isValid ? 'var(--color-text-secondary)' : '#000',
              fontSize: 16,
              fontWeight: 800,
              cursor: loading ? 'wait' : 'pointer',
              transition: 'background-color 0.2s, color 0.2s',
              fontFamily: 'inherit',
            }}
          >
            {loading ? 'Loading...' : (theme.copy?.ctaLabel ?? "Let's Play →")}
          </button>
        </form>

        <p
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            textAlign: 'center',
            marginTop: 16,
            opacity: 0.45,
          }}
        >
          No spam, ever.
        </p>
      </div>

      <style>{`
        input::placeholder { color: #4a5a70; }
        input:focus { border-color: var(--color-accent) !important; }
      `}</style>
    </main>
  );
}
