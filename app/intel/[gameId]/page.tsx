import Link from 'next/link';
import { ALL_GAMES } from '@/lib/games';

export const revalidate = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://ccioqoakdexiblnjrbhs.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

interface DimensionScore {
  score?: number;
  weight?: number;
  notes?: string;
}

interface PerformanceResult {
  fpsMedian?: number;
  fpsMin?: number;
  fps?: number;
  heapMB?: number;
  verdict?: string;
  playwrightPassed?: boolean;
  notes?: string;
}

interface Bug {
  severity: string;
  description: string;
  fixed: boolean;
  fixNote?: string;
}

interface QARecord {
  game_id: string;
  game_name: string;
  game_emoji: string;
  accent_color: string;
  verdict: string;
  weighted_score: number;
  dimensions: Record<string, DimensionScore | number>;
  performance: PerformanceResult;
  bugs: Bug[];
  qa_date: string;
  qa_agent?: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  stateMachine:   'State Machine',
  timerCorrect:   'Timer Accuracy',
  scoreTracking:  'Score Tracking',
  audioSync:      'Audio Sync',
  haptics:        'Haptics',
  accessibility:  'Accessibility',
  gameFeel:       'Game Feel',
  cleanup:        'Cleanup',
  personalBest:   'Personal Best',
  // legacy keys
  visualQuality:  'Visual Quality',
  understandability: 'Understandability',
  replayability:  'Replayability',
  bugCount:       'Bug Count',
  personaScore:   'Persona Score',
};

const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SHIP:         { label: '✅ SHIP',         color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  FIX_REQUIRED: { label: '⚠️ FIX REQUIRED', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  BLOCKED:      { label: '🚫 BLOCKED',      color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
  NOT_RUN:      { label: '⬜ NOT RUN',      color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
};

const SEV_CONFIG: Record<string, { color: string; bg: string }> = {
  P0:   { color: '#ef4444', bg: 'rgba(239,68,68,0.15)'   },
  'P0-A': { color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  P1:   { color: '#f97316', bg: 'rgba(249,115,22,0.15)'  },
  'P1-A': { color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  P2:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)'  },
  'P2-A': { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  P3:   { color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
};

function getDimScore(val: DimensionScore | number | undefined): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  return val.score ?? 0;
}

function ScoreRing({ score, accent }: { score: number; accent: string }) {
  const pct = Math.min(Math.max(score, 0), 100);
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <svg width="140" height="140" viewBox="0 0 140 140" style={{ overflow: 'visible' }}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
      <circle
        cx="70" cy="70" r={r}
        fill="none"
        stroke={accent}
        strokeWidth="10"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ * 0.25}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 8px ${accent}80)` }}
      />
      <text x="70" y="65" textAnchor="middle" fill="#fff" fontSize="26" fontWeight="700" fontFamily="'Space Grotesk',sans-serif">{Math.round(pct)}</text>
      <text x="70" y="82" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="11" fontFamily="'Space Grotesk',sans-serif">/ 100</text>
    </svg>
  );
}

export default async function IntelGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/glimmer_qa_results?game_id=eq.${gameId}&limit=1`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      next: { revalidate: 60 },
    }
  );

  const data = await res.json();
  const record: QARecord | undefined = Array.isArray(data) ? data[0] : undefined;

  // Fall back to games lib for game info
  const gameLib = ALL_GAMES.find(g => g.id === gameId);
  const accent = record?.accent_color ?? gameLib?.accentColor ?? '#84d0f9';
  const gameName = record?.game_name ?? gameLib?.title ?? gameId;
  const gameEmoji = record?.game_emoji ?? '🎮';

  const verdict = record?.verdict ?? 'NOT_RUN';
  const vCfg = VERDICT_CONFIG[verdict] ?? VERDICT_CONFIG.NOT_RUN;
  const score = record?.weighted_score ?? 0;

  const dims = record?.dimensions ?? {};
  const dimKeys = Object.keys(DIMENSION_LABELS).filter(k => k in dims);
  const perf: PerformanceResult = record?.performance ?? {};
  const bugs: Bug[] = record?.bugs ?? [];

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a14',
      fontFamily: "'Space Grotesk', sans-serif",
      color: '#e5e2e1',
      padding: '24px 16px 64px',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      {/* Back link */}
      <div style={{ marginBottom: 24 }}>
        <Link href={`/games/${gameId}`} style={{
          color: 'rgba(255,255,255,0.4)',
          fontSize: 13,
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}>
          ← Back to game
        </Link>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 36 }}>{gameEmoji}</span>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>{gameName}</h1>
          <span style={{
            padding: '4px 12px',
            borderRadius: 20,
            background: vCfg.bg,
            color: vCfg.color,
            fontSize: 12,
            fontWeight: 700,
            border: `1px solid ${vCfg.color}40`,
          }}>
            {vCfg.label}
          </span>
        </div>
        <p style={{ margin: 0, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
          📊 QA Intel Dashboard · Live data from Supabase
        </p>
      </div>

      {!record ? (
        /* Not yet tested */
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          padding: 48,
          textAlign: 'center',
          maxWidth: 480,
          margin: '0 auto',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔬</div>
          <h2 style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 20 }}>Not yet tested</h2>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
            No QA record found for <strong>{gameName}</strong>.<br />Run the QA agent to populate data.
          </p>
          <div style={{ marginTop: 24 }}>
            <Link href="/intel" style={{
              display: 'inline-block',
              padding: '10px 24px',
              background: `${accent}22`,
              color: accent,
              border: `1px solid ${accent}44`,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
            }}>
              ← All Intel
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
          {/* Score ring + summary */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: '28px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            flexWrap: 'wrap',
          }}>
            <ScoreRing score={score} accent={accent} />
            <div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
                Weighted Score
              </div>
              <div style={{ fontSize: 48, fontWeight: 700, color: accent, lineHeight: 1 }}>
                {Math.round(score)}
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                  📅 {record.qa_date ?? 'Unknown date'}
                </span>
                {record.qa_agent && (
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                    · 🤖 {record.qa_agent}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Dimensions */}
          {dimKeys.length > 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16,
              padding: '24px',
            }}>
              <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Dimensions
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {dimKeys.map(key => {
                  const raw = dims[key];
                  const s = getDimScore(raw);
                  const pct = (s / 10) * 100;
                  const notes = typeof raw === 'object' && raw !== null ? (raw as DimensionScore).notes : undefined;
                  return (
                    <div key={key}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{DIMENSION_LABELS[key] ?? key}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: s >= 8 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444' }}>
                          {s}/10
                        </span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: s >= 8 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444',
                          borderRadius: 3,
                          transition: 'width 0.4s ease',
                          boxShadow: `0 0 6px ${s >= 8 ? '#22c55e' : s >= 5 ? '#f59e0b' : '#ef4444'}80`,
                        }} />
                      </div>
                      {notes && (
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{notes}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Performance */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: '24px',
          }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Performance
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              {perf.verdict !== undefined && (
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Playwright</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: perf.verdict === 'PASS' || perf.playwrightPassed ? '#22c55e' : '#ef4444' }}>
                    {perf.verdict === 'PASS' || perf.playwrightPassed ? '✅ PASS' : '❌ FAIL'}
                  </div>
                </div>
              )}
              {perf.playwrightPassed !== undefined && perf.verdict === undefined && (
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Playwright</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: perf.playwrightPassed ? '#22c55e' : '#ef4444' }}>
                    {perf.playwrightPassed ? '✅ PASS' : '❌ FAIL'}
                  </div>
                </div>
              )}
              {(perf.fpsMedian ?? perf.fps) !== undefined && (
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>FPS</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>
                    {perf.fpsMedian ?? perf.fps}
                  </div>
                  {perf.fpsMin !== undefined && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>min {perf.fpsMin}</div>
                  )}
                </div>
              )}
              {perf.heapMB !== undefined && (
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Heap</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>
                    {perf.heapMB} MB
                  </div>
                </div>
              )}
            </div>
            {perf.notes && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{perf.notes}</div>
            )}
          </div>

          {/* Bugs */}
          {bugs.length > 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16,
              padding: '24px',
            }}>
              <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Bugs ({bugs.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {bugs.map((bug, i) => {
                  const sev = SEV_CONFIG[bug.severity] ?? SEV_CONFIG.P3;
                  return (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '12px 14px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.06)',
                      opacity: bug.fixed ? 0.55 : 1,
                    }}>
                      <span style={{
                        flexShrink: 0,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: sev.bg,
                        color: sev.color,
                        fontSize: 10,
                        fontWeight: 700,
                        border: `1px solid ${sev.color}40`,
                      }}>
                        {bug.severity}
                      </span>
                      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5, textDecoration: bug.fixed ? 'line-through' : 'none', color: bug.fixed ? 'rgba(255,255,255,0.4)' : '#e5e2e1' }}>
                        {bug.description}
                      </div>
                      {bug.fixed && (
                        <span style={{ flexShrink: 0, color: '#22c55e', fontSize: 12, fontWeight: 700 }}>✓ Fixed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* QA Meta */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12,
            padding: '14px 18px',
            display: 'flex',
            gap: 24,
            flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>QA Date</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{record.qa_date ?? '—'}</div>
            </div>
            {record.qa_agent && (
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Agent</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{record.qa_agent}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Game ID</div>
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', opacity: 0.6 }}>{gameId}</div>
            </div>
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <Link href={`/games/${gameId}`} style={{
              padding: '10px 20px',
              background: `${accent}22`,
              color: accent,
              border: `1px solid ${accent}44`,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
            }}>
              ← Play Game
            </Link>
            <Link href="/intel" style={{
              padding: '10px 20px',
              background: 'rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
            }}>
              All Intel →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
