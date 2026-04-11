-- ===========================================
-- The Tailor's Daughter - Database Schema
-- V.C. Bird International Airport (TAPA)
-- ===========================================

-- Sales Transactions (ticket-level from NCR Counterpoint)
CREATE TABLE sales_transactions (
  id BIGSERIAL PRIMARY KEY,
  tkt_no TEXT UNIQUE NOT NULL,
  tkt_dt TIMESTAMP NOT NULL,
  str_id TEXT,
  sta_id TEXT,
  cust_no TEXT,
  usr_id TEXT,
  tot_amt DECIMAL(10,2),
  disc_amt DECIMAL(10,2) DEFAULT 0,
  tax_amt DECIMAL(10,2) DEFAULT 0,
  pmt_cod TEXT,
  imported_at TIMESTAMP DEFAULT NOW(),
  import_batch_id TEXT
);

-- Sales Line Items (per-item detail)
CREATE TABLE sales_line_items (
  id BIGSERIAL PRIMARY KEY,
  tkt_no TEXT NOT NULL REFERENCES sales_transactions(tkt_no),
  item_no TEXT,
  descr TEXT,
  categ_cod TEXT,
  subcat_cod TEXT,
  qty_sold INT,
  prc DECIMAL(10,2),
  ext_prc DECIMAL(10,2),
  disc_amt DECIMAL(10,2) DEFAULT 0
);

-- Flight Data (parsed from weekly airport schedule PDF)
CREATE TABLE flight_data (
  id BIGSERIAL PRIMARY KEY,
  flight_date DATE NOT NULL,
  flight_num TEXT NOT NULL,
  airline_code TEXT,
  aircraft_type TEXT,
  scheduled_time TIMESTAMP NOT NULL,
  flight_type TEXT NOT NULL CHECK (flight_type IN ('arrival', 'departure')),
  estimated_passengers INT,
  origin_destination TEXT,
  terminal TEXT,
  gate TEXT,
  status TEXT DEFAULT 'scheduled',
  schedule_week_start DATE,
  parsed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(flight_num, flight_date, flight_type)
);

-- Staff Schedules (AI-generated shift assignments)
CREATE TABLE staff_schedules (
  id BIGSERIAL PRIMARY KEY,
  schedule_date DATE NOT NULL,
  staff_name TEXT NOT NULL,
  shift_start TIME NOT NULL,
  shift_end TIME NOT NULL,
  shift_hours DECIMAL(5,2),
  generated_by TEXT DEFAULT 'ai' CHECK (generated_by IN ('ai', 'manual')),
  ai_confidence DECIMAL(3,2),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'executed')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- AI Analysis Results (Claude outputs)
CREATE TABLE ai_analysis_results (
  id BIGSERIAL PRIMARY KEY,
  analysis_date DATE NOT NULL,
  analysis_type TEXT NOT NULL,
  input_context JSONB,
  claude_response JSONB,
  confidence_level TEXT CHECK (confidence_level IN ('HIGH', 'MEDIUM', 'LOW')),
  action_items TEXT,
  model_used TEXT,
  token_usage JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Import Logs (audit trail for all data imports)
CREATE TABLE import_logs (
  id BIGSERIAL PRIMARY KEY,
  import_date TIMESTAMP DEFAULT NOW(),
  source_type TEXT NOT NULL CHECK (source_type IN ('counterpoint', 'flight_schedule', 'manual')),
  file_name TEXT,
  total_records INT DEFAULT 0,
  successful_records INT DEFAULT 0,
  failed_records INT DEFAULT 0,
  error_messages JSONB,
  reconciliation_status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for query performance
CREATE INDEX idx_sales_date ON sales_transactions(tkt_dt);
CREATE INDEX idx_sales_batch ON sales_transactions(import_batch_id);
CREATE INDEX idx_line_items_tkt ON sales_line_items(tkt_no);
CREATE INDEX idx_line_items_category ON sales_line_items(categ_cod);
CREATE INDEX idx_flight_date ON flight_data(flight_date);
CREATE INDEX idx_flight_type ON flight_data(flight_type);
CREATE INDEX idx_flight_week ON flight_data(schedule_week_start);
CREATE INDEX idx_schedule_date ON staff_schedules(schedule_date);
CREATE INDEX idx_analysis_date ON ai_analysis_results(analysis_date);
CREATE INDEX idx_analysis_type ON ai_analysis_results(analysis_type);
CREATE INDEX idx_import_date ON import_logs(import_date);
