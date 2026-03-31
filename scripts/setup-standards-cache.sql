-- Standards validation cache table
-- Used by lib/standardsCache.ts to persist validation results across sessions.

CREATE TABLE IF NOT EXISTS standards_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_key TEXT NOT NULL UNIQUE,
  ref_type      TEXT NOT NULL CHECK (ref_type IN ('standard', 'regulation')),
  status        TEXT NOT NULL CHECK (status IN ('valid', 'withdrawn', 'under_review', 'replaced', 'unknown')),
  status_code   TEXT,
  current_title TEXT,
  replacement   TEXT,
  note          TEXT,
  source        TEXT NOT NULL,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE standards_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON standards_cache
  FOR ALL USING (true) WITH CHECK (true);
