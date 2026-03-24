import { NextRequest, NextResponse } from 'next/server';

// One-time migration endpoint: creates glimmer_qa_results table if not exists
// Protected with a secret to prevent unauthorized access
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  const expectedSecret = (process.env.QA_SETUP_SECRET ?? '').trim();
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized', debug: `expected_len=${expectedSecret.length}` }, { status: 401 });
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: 'SUPABASE_DB_URL not set' }, { status: 500 });
  }

  try {
    // Dynamic import to avoid bundling pg unless needed
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS glimmer_qa_results (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        game_id text NOT NULL UNIQUE,
        game_name text,
        game_emoji text,
        accent_color text,
        sensor text,
        duration_seconds integer,
        qa_date text,
        qa_agent text,
        verdict text NOT NULL DEFAULT 'NOT_RUN',
        weighted_score numeric,
        dimensions jsonb,
        performance jsonb,
        accessibility jsonb,
        personas jsonb,
        bugs jsonb,
        iterations_required integer DEFAULT 0,
        deploy_url text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`ALTER TABLE glimmer_qa_results ENABLE ROW LEVEL SECURITY;`);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE tablename = 'glimmer_qa_results' AND policyname = 'Public read'
        ) THEN
          CREATE POLICY "Public read" ON glimmer_qa_results FOR SELECT USING (true);
        END IF;
      END $$;
    `);

    await client.end();

    return NextResponse.json({
      success: true,
      message: 'Table glimmer_qa_results created and RLS configured',
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
