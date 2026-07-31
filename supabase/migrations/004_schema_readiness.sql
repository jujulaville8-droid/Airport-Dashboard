ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS ticket_count INTEGER,
  ADD COLUMN IF NOT EXISTS upload_type TEXT;

ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS hourly_breakdown JSONB;

UPDATE sales_transactions
SET ticket_count = CASE
  WHEN cust_no ~ '^[0-9]+$'
    AND (
      length(ltrim(cust_no, '0')) < 10
      OR (
        length(ltrim(cust_no, '0')) = 10
        AND ltrim(cust_no, '0') <= '2147483647'
      )
    )
  THEN cust_no::INTEGER
  ELSE 0
END
WHERE ticket_count IS NULL;

ALTER TABLE sales_transactions
  ALTER COLUMN ticket_count SET DEFAULT 0;

ALTER TABLE flight_data
  ADD COLUMN IF NOT EXISTS schedule_month TEXT;

UPDATE flight_data
SET schedule_month = to_char(flight_date, 'YYYY-MM')
WHERE schedule_month IS NULL;

CREATE TABLE IF NOT EXISTS staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('full-time', 'part-time', 'backup')),
  max_hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 8,
  min_hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 3,
  weekly_hour_target NUMERIC(5,2),
  days_off_per_week INTEGER,
  available_start TIME NOT NULL DEFAULT '09:00',
  available_end TIME NOT NULL DEFAULT '20:00',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_upload_type ON sales_transactions(upload_type);
CREATE INDEX IF NOT EXISTS idx_flight_schedule_month ON flight_data(schedule_month);
