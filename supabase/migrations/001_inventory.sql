-- ===========================================
-- Migration 001 — Inventory Intelligence
-- Adds item_master, inventory_snapshots, reorder_rules.
-- Finishes the sales_line_items wiring (composite index).
-- ===========================================

-- Master catalog of every SKU we've seen from Counterpoint.
-- Populated + updated by the item sales import and the inventory snapshot import.
CREATE TABLE IF NOT EXISTS item_master (
  item_no TEXT PRIMARY KEY,
  descr TEXT,
  categ_cod TEXT,
  subcat_cod TEXT,
  unit_cost DECIMAL(10,2),      -- from inventory valuation report
  unit_price DECIMAL(10,2),     -- most recently observed selling price
  first_seen_at DATE,
  last_seen_at DATE,
  is_active BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_item_master_category ON item_master(categ_cod);

-- Point-in-time snapshot of stock on hand. Most recent row per item = current stock.
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  item_no TEXT NOT NULL REFERENCES item_master(item_no),
  qty_on_hand INT NOT NULL,
  unit_cost DECIMAL(10,2),
  total_value DECIMAL(12,2),
  source_batch_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(snapshot_date, item_no)
);
CREATE INDEX IF NOT EXISTS idx_inv_snapshot_date ON inventory_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_snapshot_item ON inventory_snapshots(item_no);

-- Reorder rules per SKU (editable in the UI).
CREATE TABLE IF NOT EXISTS reorder_rules (
  item_no TEXT PRIMARY KEY REFERENCES item_master(item_no),
  min_stock INT,                -- at or below this = critical
  reorder_point INT,            -- at or below this = at-risk, order now
  max_stock INT,                -- target level after restock
  lead_time_days INT DEFAULT 14,
  notes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- sales_line_items already exists; add composite index for velocity queries
-- (item × ticket window aggregations).
CREATE INDEX IF NOT EXISTS idx_line_items_item_ticket
  ON sales_line_items(item_no, tkt_no);
