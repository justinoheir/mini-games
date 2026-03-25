import Link from 'next/link';
import IntelIndexClient from './IntelIndexClient';

export const revalidate = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://ccioqoakdexiblnjrbhs.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

interface IntelRecord {
  game_id: string;
  game_name: string;
  game_emoji: string;
  accent_color: string;
  verdict: 'SHIP' | 'FIX_REQUIRED' | 'BLOCKED' | 'NOT_RUN';
  weighted_score: number;
  qa_date?: string;
  qa_agent?: string;
}

export default async function IntelIndexPage() {
  let records: IntelRecord[] = [];

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/glimmer_qa_results?select=game_id,game_name,game_emoji,accent_color,verdict,weighted_score,qa_date,qa_agent&order=weighted_score.desc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        next: { revalidate: 60 },
      }
    );
    const data = await res.json();
    if (Array.isArray(data)) records = data;
  } catch {
    // silently degrade — show empty state
  }

  const counts: Record<string, number> = {
    SHIP: 0,
    FIX_REQUIRED: 0,
    BLOCKED: 0,
    NOT_RUN: 0,
  };
  for (const r of records) {
    if (r.verdict in counts) counts[r.verdict]++;
  }

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

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 12 }}>
          <Link href="/" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textDecoration: 'none' }}>
            ← Home
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em' }}>
            📊 Glimmers Intel
          </h1>
        </div>
        <p style={{ margin: '8px 0 0', color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
          Live QA dashboards for every game · {records.length} records loaded
        </p>
      </div>

      {records.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: 64,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16,
          maxWidth: 440,
          margin: '0 auto',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔬</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>No QA data yet</h2>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
            Run the QA agent on any game to start seeing results here.
          </p>
        </div>
      ) : (
        <IntelIndexClient records={records} counts={counts} />
      )}
    </div>
  );
}
