-- Supabase Storage bucket for SMR templates
-- Create via Dashboard: Storage → New bucket
--   Name: smr-templates
--   Public: No
--   File size limit: 50 MB
--   Allowed MIME types: application/vnd.openxmlformats-officedocument.wordprocessingml.document

-- Storage policies for smr-templates bucket (anon key access)
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- 1. Allow INSERT (upload)
CREATE POLICY "anon_upload_smr_templates"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'smr-templates');

-- 2. Allow SELECT (list + download)
CREATE POLICY "anon_select_smr_templates"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'smr-templates');

-- 3. Allow UPDATE (overwrite with upsert)
CREATE POLICY "anon_update_smr_templates"
ON storage.objects FOR UPDATE
TO anon
USING (bucket_id = 'smr-templates')
WITH CHECK (bucket_id = 'smr-templates');

-- 4. Allow DELETE
CREATE POLICY "anon_delete_smr_templates"
ON storage.objects FOR DELETE
TO anon
USING (bucket_id = 'smr-templates');
