-- Storage policies for tender-documents bucket (anon key access)
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- 1. Allow INSERT (upload) - anon can upload to tender-documents
CREATE POLICY "anon_upload_tender_documents"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'tender-documents');

-- 2. Allow SELECT (list + download) - anon can read from tender-documents
CREATE POLICY "anon_select_tender_documents"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'tender-documents');

-- 3. Allow UPDATE (optional - for overwriting files with upsert)
CREATE POLICY "anon_update_tender_documents"
ON storage.objects FOR UPDATE
TO anon
USING (bucket_id = 'tender-documents')
WITH CHECK (bucket_id = 'tender-documents');
