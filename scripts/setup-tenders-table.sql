-- Supabase table for storing tender data
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

CREATE TABLE IF NOT EXISTS tenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  introduction_text TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  smr_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenders_updated_at
  BEFORE UPDATE ON tenders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS policies (anon key access)
ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_tenders"
  ON tenders FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_tenders"
  ON tenders FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_tenders"
  ON tenders FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_tenders"
  ON tenders FOR DELETE TO anon USING (true);
