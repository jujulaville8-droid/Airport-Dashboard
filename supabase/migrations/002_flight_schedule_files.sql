-- Flight schedule PDF storage metadata.
--
-- The actual PDF bytes live in the `flight-schedules` Supabase Storage bucket
-- (private, service-role-only). This table records the metadata so the site
-- can look up the stored file for a given schedule month and ask Storage for
-- a signed download URL.
--
-- Keyed on schedule_month so re-uploading the same month replaces the file
-- (no versioning per user decision).

CREATE TABLE flight_schedule_files (
  schedule_month TEXT PRIMARY KEY,        -- YYYY-MM
  storage_path TEXT NOT NULL,             -- path within the flight-schedules bucket
  file_name TEXT NOT NULL,                -- original filename at upload time
  file_size INTEGER NOT NULL,             -- bytes
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Bucket creation (run once — Supabase SQL editor):
-- 1) Go to Storage → Create a new bucket
-- 2) Name: flight-schedules
-- 3) Public: OFF (private)
-- 4) File size limit: 10 MB
-- 5) Allowed MIME types: application/pdf
--
-- Or run via SQL:
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('flight-schedules', 'flight-schedules', false, 10485760, ARRAY['application/pdf'])
-- ON CONFLICT (id) DO NOTHING;
