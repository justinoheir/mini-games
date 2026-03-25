'use client';

import { useState } from 'react';
import Link from 'next/link';

const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SHIP:         { label: '✅ SHIP',         color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  FIX_REQUIRED: { label: '⚠️ FIX REQUIRED', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  BLOCKED:      { label: '🚫 BLOCKED',      color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
  NOT_RUN:      { label: '⬜ NOT RUN',      color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
};

type Verdict = 'SHIP' | 'FIX_REQUIRED' | 'BLOCKED' | 'NOT_RUN';

interface IntelRecord {
  game_id: string;
  game_name: string;
  game_emoji: string;
  accent_color: string;
  verdict: Verdict;
  weighted_score: number;
  qa_date?: string;
  qa_agent?: string;
}

interface Props {
  records: IntelRecord[];
  counts: Record<string, number>;
}

export default function IntelIndexClient({ records, counts }: Props) {
  const [filter, setFilter] = useState<string>('ALL');

  const visible = filter === 'ALL' ? records : records.filter(r => r.verdict === filter);

  const filters = [
    { key: 'ALL',         label: 'All',          count: records.length },
    { key: 'SHIP',        label: '✅ Ship',       count: counts.SHIP ?? 0 },
    { key: 'FIX_REQUIRED',label: '⚠️ Fix',       count: counts.FIX_REQUIRED ?? 0 },
    { key: 'BLOCKED',     label: '🚫 Blocked',   count: counts.BLOCKED ?? 0 },
    { key: 'NOT_RUN',     label: '⬜ Not Run',   count: counts.NOT_RUN ?? 0 },
  ];

  return (
    <>
      {/* Summary counts */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        {(['SHIP', 'FIX_REQUIRED', 'BLOCKED', 'NOT_RUN'] as Verdict[]).map(v => {
          const cfg = VERDICT_CONFIG[v];
          return (
            <div key={v} style={{
              padding: '10px 18px',
              background: cfg.bg,
              border: `1px solid ${cfg.color}30`,
              borderRadius: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              minWidth: 80,
            }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: cfg.color }}>{counts[v] ?? 0}</span>
              <span style={{ fontSize: 10, color: cfg.color, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
                {v.replace('_', ' ')}
              </span>
            </div>
          );
        })}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              border: filter === f.key ? '1px solid rgba(132,208,249,0.5)' : '1px solid rgba(255,255,255,0.1)',
              background: filter === f.key ? 'rgba(132,208,249,0.12)' : 'rgba(255,255,255,0.04)',
              color: filter === f.key ? '#84d0f9' : 'rgba(255,255,255,0.5)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: "'Space Grotesk', sans-serif",
              transition: 'all 0.15s',
            }}
          >
            {f.label} <span style={{ opacity: 0.6 }}>({f.count})</span>
          </button>
        ))}
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
          No records for this filter.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 16,
        }}>
          {visible.map(r => {
            const vCfg = VERDICT_CONFIG[r.verdict] ?? VERDICT_CONFIG.NOT_RUN;
            const accent = r.accent_color ?? '#84d0f9';
            return (
              <Link key={r.game_id} href={`/intel/${r.game_id}`} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 14,
                  padding: '20px 18px',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, background 0.2s',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = `${accent}60`;
                    (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)';
                    (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)';
                  }}
                >
                  {/* Emoji + name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{r.game_emoji ?? '🎮'}</span>
                    <div style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: '#e5e2e1',
                      lineHeight: 1.3,
                      flex: 1,
                    }}>
                      {r.game_name ?? r.game_id}
                    </div>
                  </div>

                  {/* Verdict badge */}
                  <div style={{
                    display: 'inline-flex',
                    alignSelf: 'flex-start',
                    padding: '3px 10px',
                    borderRadius: 12,
                    background: vCfg.bg,
                    color: vCfg.color,
                    fontSize: 10,
                    fontWeight: 700,
                    border: `1px solid ${vCfg.color}40`,
                  }}>
                    {vCfg.label}
                  </div>

                  {/* Score bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Score</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{Math.round(r.weighted_score ?? 0)}</span>
                    </div>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(r.weighted_score ?? 0, 100)}%`,
                        background: accent,
                        borderRadius: 2,
                        boxShadow: `0 0 6px ${accent}60`,
                      }} />
                    </div>
                  </div>

                  {/* Date */}
                  {r.qa_date && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 'auto' }}>
                      {r.qa_date}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
