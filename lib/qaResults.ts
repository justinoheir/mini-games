// QA results are now stored in Supabase (glimmer_qa_results table).
// Static JSON imports removed — this file is kept as a compatibility stub.
// The /qa portal fetches live data from Supabase at runtime.
// Once the Supabase table is created, the portal will populate automatically.
//
// SQL to create the table (paste into Supabase SQL editor):
// See the comment in app/qa/page.tsx for the full CREATE TABLE statement.

import type { QAResult } from '../app/qa/types';

export const QA_RESULTS: Record<string, QAResult> = {};
