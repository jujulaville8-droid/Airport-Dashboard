-- Add actual passenger counts from ABAA Carrier Passenger Summary emails.
--
-- The airport operations team emails passenger counts per flight the day
-- before, in a plain-text format (see src/lib/carrier-capacity-parser.ts).
-- We store these alongside the scheduled rows so the flights dashboard can
-- show estimate-vs-actual accuracy and so analytics can use real loads
-- instead of PDF-derived estimates.
--
-- Keyed on the existing UNIQUE(flight_num, flight_date, flight_type), so
-- the importer can UPDATE a row without needing a separate table.

ALTER TABLE flight_data
  ADD COLUMN IF NOT EXISTS actual_passengers INTEGER,
  ADD COLUMN IF NOT EXISTS actual_passengers_source TEXT,  -- 'email' / 'manual'
  ADD COLUMN IF NOT EXISTS actual_passengers_updated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_flight_actual_passengers
  ON flight_data(actual_passengers)
  WHERE actual_passengers IS NOT NULL;
