ALTER TABLE import_logs
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_import_logs_source_attempt
  ON import_logs(source, attempted_at DESC);
