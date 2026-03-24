/**
 * Supabase QA Migration Script
 * 1. Creates glimmer_qa_results table
 * 2. Migrates JSON files to Supabase
 */

import { createRequire } from 'module';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://ccioqoakdexiblnjrbhs.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

// ─── Step 1: Create table via postgres ───────────────────────────────────────

async function createTable() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL env var not set');
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('✅ Connected to Supabase postgres');

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
  console.log('✅ Table glimmer_qa_results created (or already exists)');

  await client.query(`ALTER TABLE glimmer_qa_results ENABLE ROW LEVEL SECURITY;`);

  // Create policy only if it doesn't exist
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
  console.log('✅ RLS enabled + public read policy created');

  await client.end();
}

// ─── Step 2: Migrate JSON files to Supabase ──────────────────────────────────

function toRow(r) {
  return {
    game_id: r.gameId,
    game_name: r.gameName,
    game_emoji: r.gameEmoji,
    accent_color: r.accentColor,
    sensor: r.sensor,
    duration_seconds: r.durationSeconds,
    qa_date: r.qaDate,
    qa_agent: r.qaAgent ?? null,
    verdict: r.verdict,
    weighted_score: r.weightedScore,
    dimensions: r.dimensions,
    performance: r.performance,
    accessibility: r.accessibility,
    personas: r.personas,
    bugs: r.bugs,
    iterations_required: r.iterationsRequired ?? 0,
    deploy_url: r.deployUrl ?? null,
  };
}

async function migrateJsonFiles() {
  const resultsDir = join(__dirname, '..', 'tests', 'results');
  const files = readdirSync(resultsDir).filter(f => f.endsWith('.json'));

  console.log(`\n📦 Found ${files.length} JSON result files`);

  const rows = files.map(f => {
    const data = JSON.parse(readFileSync(join(resultsDir, f), 'utf8'));
    return toRow(data);
  });

  // Upsert all rows in one batch
  const res = await fetch(`${SUPABASE_URL}/rest/v1/glimmer_qa_results`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upsert failed: ${res.status} ${text}`);
  }

  console.log(`✅ Upserted ${rows.length} rows to glimmer_qa_results`);
  
  // Verify count
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/glimmer_qa_results?select=game_id`,
    {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'count=exact',
      },
    }
  );
  const count = countRes.headers.get('content-range');
  console.log(`📊 Row count in Supabase: ${count}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
  await createTable();
  await migrateJsonFiles();
  console.log('\n🎉 Migration complete!');
} catch (err) {
  console.error('❌ Migration failed:', err);
  process.exit(1);
}
