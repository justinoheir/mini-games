'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ALL_GAMES } from '@/lib/games';
import { GAME_MEASURES, SIGNAL_COLOR, SIGNAL_DESC, type EtherSignal } from '@/lib/measures';

const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string; border?: string; opacity?: number }> = {
  SHIP:         { label: '✅ SHIP',         color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  FIX_REQUIRED: { label: '⚠️ FIX REQUIRED', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  BLOCKED:      { label: '🚫 BLOCKED',      color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
  NOT_RUN:      { label: 'NOT RUN',         color: '#6b7280', bg: 'transparent', border: 'none', opacity: 0.45 },
};

const TAGLINE_MAP: Record<string, string> = Object.fromEntries(
  ALL_GAMES.map(g => [g.id, g.tagline])
);

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

// Core five first, then supporting
const ALL_SIGNALS: EtherSignal[] = ['Trust', 'Confidence', 'Excitement', 'Belonging', 'Readiness', 'Focus', 'Calm'];

export default function IntelIndexClient({ records, counts }: Props) {
  const [verdictFilter, setVerdictFilter] = useState<string>('ALL');
  const [signalFilter, setSignalFilter] = useState<EtherSignal | null>(null);

  const visible = useMemo(() => {
    let list = verdictFilter === 'ALL' ? records : records.filter(r => r.verdict === verdictFilter);
    if (signalFilter) {
      const matchingIds = new Set(
        Object.entries(GAME_MEASURES)
          .filter(([, signals]) => signals.includes(signalFilter))
          .map(([id]) => id)
      );
      list = list.filter(r => matchingIds.has(r.game_id));
    }
    return list;
  }, [records, verdictFilter, signalFilter]);

  const verdictFilters = [
    { key: 'ALL',          label: 'All',          count: records.length },
    { key: 'SHIP',         label: '✅ Ship',       count: counts.SHIP ?? 0 },
    { key: 'FIX_REQUIRED', label: '⚠️ Fix',       count: counts.FIX_REQUIRED ?? 0 },
    { key: 'BLOCKED',      label: '🚫 Blocked',   count: counts.BLOCKED ?? 0 },
    { key: 'NOT_RUN',      label: '⬜ Not Run',   count: counts.NOT_RUN ?? 0 },
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

      {/* Verdict filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {verdictFilters.map(f => (
          <button
            key={f.key}
            onClick={() => setVerdictFilter(f.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              border: verdictFilter === f.key ? '1px solid rgba(132,208,249,0.5)' : '1px solid rgba(255,255,255,0.1)',
              background: verdictFilter === f.key ? 'rgba(132,208,249,0.12)' : 'rgba(255,255,255,0.04)',
              color: verdictFilter === f.key ? '#84d0f9' : 'rgba(255,255,255,0.5)',
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

      {/* Behavior capture filter */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.3)',
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ color: '#84d0f9' }}>⚡</span> Consumer–Brand Signal Capture
          {signalFilter && (
            <button
              onClick={() => setSignalFilter(null)}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 4,
                color: 'rgba(255,255,255,0.5)',
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                cursor: 'pointer',
                fontFamily: "'Space Grotesk', sans-serif",
                marginLeft: 4,
              }}
            >
              Clear ×
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ALL_SIGNALS.map((signal, i) => {
            const color = (SIGNAL_COLOR as Record<string, string>)[signal] ?? '#84d0f9';
            const desc = (SIGNAL_DESC as Record<string, string>)[signal] ?? '';
            const active = signalFilter === signal;
            const matchCount = Object.entries(GAME_MEASURES)
              .filter(([, signals]) => signals.includes(signal)).length;
            const isCore = i < 5; // Trust, Confidence, Excitement, Belonging, Readiness
            return (
              <button
                key={signal}
                onClick={() => setSignalFilter(active ? null : signal)}
                title={desc}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                  padding: isCore ? '10px 16px' : '7px 13px',
                  borderRadius: 10,
                  border: active ? `1px solid ${color}90` : `1px solid ${color}28`,
                  background: active ? `${color}20` : `${color}0a`,
                  color: active ? color : `${color}88`,
                  cursor: 'pointer',
                  fontFamily: "'Space Grotesk', sans-serif",
                  transition: 'all 0.15s',
                  textAlign: 'left',
                  minWidth: isCore ? 130 : 'auto',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: isCore ? 7 : 5,
                    height: isCore ? 7 : 5,
                    borderRadius: '50%',
                    background: color,
                    opacity: active ? 1 : 0.6,
                    boxShadow: active ? `0 0 6px ${color}` : 'none',
                    flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: isCore ? 13 : 11,
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    color: active ? color : `${color}bb`,
                  }}>
                    {signal}
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.45, fontWeight: 600 }}>
                    {matchCount}
                  </span>
                </div>
                {isCore && (
                  <div style={{
                    fontSize: 9,
                    color: active ? `${color}bb` : 'rgba(255,255,255,0.25)',
                    fontFamily: "'Manrope', sans-serif",
                    fontWeight: 600,
                    letterSpacing: '0.01em',
                    lineHeight: 1.4,
                    paddingLeft: 13,
                    maxWidth: 160,
                  }}>
                    {desc}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results count when filtered */}
      {signalFilter && (
        <div style={{ marginBottom: 16, fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
          {visible.length} game{visible.length !== 1 ? 's' : ''} capture{visible.length === 1 ? 's' : ''}{' '}
          <span style={{ color: (SIGNAL_COLOR as Record<string, string>)[signalFilter] ?? '#84d0f9', fontWeight: 700 }}>
            {signalFilter}
          </span>
        </div>
      )}

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
            const signals = GAME_MEASURES[r.game_id] ?? [];
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
                  gap: 10,
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
                  {/* Icon + name + tagline */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 24, lineHeight: 1.2, flexShrink: 0, color: accent, opacity: 0.9 }}
                    >
                      {ALL_GAMES.find(g => g.id === r.game_id)?.icon ?? 'sports_esports'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e2e1', lineHeight: 1.3 }}>
                        {r.game_name ?? r.game_id}
                      </div>
                      {TAGLINE_MAP[r.game_id] && (
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3, lineHeight: 1.4 }}>
                          {TAGLINE_MAP[r.game_id]}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Signal chips */}
                  {signals.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {signals.map(signal => {
                        const sc = (SIGNAL_COLOR as Record<string, string>)[signal] ?? '#84d0f9';
                        const isActive = signalFilter === signal;
                        return (
                          <span key={signal} style={{
                            fontSize: 9,
                            fontWeight: 700,
                            fontFamily: "'Manrope', sans-serif",
                            letterSpacing: '0.04em',
                            color: sc,
                            background: isActive ? `${sc}30` : `${sc}15`,
                            border: `1px solid ${isActive ? sc + '60' : sc + '30'}`,
                            borderRadius: 4,
                            padding: '2px 6px',
                            boxShadow: isActive ? `0 0 6px ${sc}40` : 'none',
                          }}>
                            {signal}
                          </span>
                        );
                      })}
                    </div>
                  )}

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
                    border: vCfg.border !== undefined ? vCfg.border : `1px solid ${vCfg.color}40`,
                    opacity: vCfg.opacity !== undefined ? vCfg.opacity : 1,
                  }}>
                    {vCfg.label}
                  </div>

                  {/* Score bar */}
                  {r.verdict !== 'NOT_RUN' && (r.weighted_score ?? 0) > 0 && (
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
                  )}

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
