'use client';

interface ScoreEntry {
  score: string;
  personality?: string;
}

interface CrossGameProfileProps {
  scores: Record<string, ScoreEntry>;
}

// Maps personality keywords to behavioral axes
function classifyPersonality(personality: string): string | null {
  const p = personality.toLowerCase();
  if (p.includes('sharp') || p.includes('precise') || p.includes('steady') || p.includes('surgeon') || p.includes('focused') || p.includes('sniper') || p.includes('calm')) {
    return 'High control';
  }
  if (p.includes('reactive') || p.includes('explosive') || p.includes('streaky') || p.includes('reckless') || p.includes('erratic') || p.includes('anxious')) {
    return 'High impulse';
  }
  if (p.includes('clutch') || p.includes('calculated') || p.includes('pressure') || p.includes('gunner')) {
    return 'Pressure performs';
  }
  if (p.includes('casual') || p.includes('balanced') || p.includes('flow') || p.includes('variable') || p.includes('consistent')) {
    return 'Flow state';
  }
  return null;
}

export default function CrossGameProfile({ scores }: CrossGameProfileProps) {
  const entries = Object.values(scores).filter((e) => e.personality);

  if (entries.length < 3) return null;

  // Tally axes
  const axisCounts: Record<string, number> = {};
  for (const entry of entries) {
    if (!entry.personality) continue;
    // Strip emoji from personality label
    const cleaned = entry.personality.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();
    const axis = classifyPersonality(cleaned);
    if (axis) {
      axisCounts[axis] = (axisCounts[axis] ?? 0) + 1;
    }
  }

  const sorted = Object.entries(axisCounts).sort((a, b) => b[1] - a[1]);
  const top2 = sorted.slice(0, 2).map(([axis]) => axis);

  if (top2.length === 0) return null;

  const pattern = top2.join(' · ');

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-accent)',
        borderRadius: 'var(--radius-card)',
        padding: '16px 20px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle accent glow */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: 'linear-gradient(90deg, transparent, var(--color-accent), transparent)',
          opacity: 0.4,
        }}
      />

      <div
        style={{
          color: 'var(--color-accent)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        ⚡ Your Profile
      </div>

      <div
        style={{
          color: 'var(--color-text)',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '-0.2px',
          marginBottom: 4,
        }}
      >
        Your pattern: {pattern}
      </div>

      <div
        style={{
          color: 'var(--color-text-secondary)',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        Based on {entries.length} games played this session.
      </div>
    </div>
  );
}
