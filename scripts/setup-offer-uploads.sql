-- ============================================================
-- Setup: Complete Offer Uploads (Пълни Оферти) — Self-Learning RAG
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ============================================================

-- 1. Enable pgvector extension (required for vector similarity search)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Table: offer_uploads — metadata for each uploaded complete offer
CREATE TABLE IF NOT EXISTS offer_uploads (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  filename     TEXT        NOT NULL,
  storage_path TEXT        NOT NULL,
  file_size    INTEGER,
  section_count INTEGER   DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Table: offer_sections — extracted sections from offers with embeddings
--    section_type: 'introduction' | 'smr_technology' | 'team_organization' | 'communication' | 'other'
CREATE TABLE IF NOT EXISTS offer_sections (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id     UUID        NOT NULL REFERENCES offer_uploads(id) ON DELETE CASCADE,
  section_type TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  html_content TEXT        NOT NULL,   -- Full HTML with base64-embedded images/tables (1:1 formatting)
  plain_text   TEXT        NOT NULL,   -- Stripped plain text used for embedding
  embedding    vector(1536),           -- OpenAI text-embedding-3-small vector
  order_index  INTEGER     DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. IVFFlat index for fast cosine similarity search on embeddings
--    NOTE: Requires at least 1 row before the index is effective.
--    If you get an error about empty table, run this AFTER inserting first data:
--      CREATE INDEX offer_sections_embedding_idx ON offer_sections
--        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'offer_sections_embedding_idx'
  ) THEN
    CREATE INDEX offer_sections_embedding_idx
      ON offer_sections
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  END IF;
END $$;

-- 5. Row Level Security
ALTER TABLE offer_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_sections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "anon_all_offer_uploads"  ON offer_uploads;
DROP POLICY IF EXISTS "anon_all_offer_sections" ON offer_sections;

-- Allow anon key full access (same pattern as tenders table)
CREATE POLICY "anon_all_offer_uploads"
  ON offer_uploads FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_all_offer_sections"
  ON offer_sections FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ============================================================
-- Storage Bucket: offer-uploads
-- ============================================================
-- Run these separately in Supabase Storage UI or via the SQL below.
-- The bucket stores the original DOCX files.

-- NOTE: Supabase storage buckets cannot be created via SQL directly in all versions.
-- Create the bucket manually in: Storage > New Bucket > Name: "offer-uploads" > Public: false
-- Then run the storage policies below:

INSERT INTO storage.buckets (id, name, public)
VALUES ('offer-uploads', 'offer-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for offer-uploads bucket
DROP POLICY IF EXISTS "offer_uploads_anon_select" ON storage.objects;
DROP POLICY IF EXISTS "offer_uploads_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "offer_uploads_anon_update" ON storage.objects;
DROP POLICY IF EXISTS "offer_uploads_anon_delete" ON storage.objects;

CREATE POLICY "offer_uploads_anon_select"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'offer-uploads');

CREATE POLICY "offer_uploads_anon_insert"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'offer-uploads');

CREATE POLICY "offer_uploads_anon_update"
  ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'offer-uploads');

CREATE POLICY "offer_uploads_anon_delete"
  ON storage.objects FOR DELETE TO anon
  USING (bucket_id = 'offer-uploads');

-- ============================================================
-- pgvector RPC function for cosine similarity search
-- Used by lib/offerEmbeddings.ts → searchSimilarSections()
-- ============================================================
CREATE OR REPLACE FUNCTION match_offer_sections(
  query_embedding   vector(1536),
  match_section_type TEXT DEFAULT NULL,
  match_count       INTEGER DEFAULT 3
)
RETURNS TABLE (
  id           UUID,
  offer_id     UUID,
  section_type TEXT,
  title        TEXT,
  html_content TEXT,
  plain_text   TEXT,
  order_index  INTEGER,
  similarity   FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.offer_id,
    s.section_type,
    s.title,
    s.html_content,
    s.plain_text,
    s.order_index,
    1 - (s.embedding <=> query_embedding) AS similarity
  FROM offer_sections s
  WHERE
    s.embedding IS NOT NULL
    AND (match_section_type IS NULL OR s.section_type = match_section_type)
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- Verification: check tables were created
-- ============================================================
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns c
   WHERE c.table_name = t.table_name) AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('offer_uploads', 'offer_sections')
ORDER BY table_name;
