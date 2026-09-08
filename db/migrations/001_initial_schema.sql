-- 001_initial_schema.sql
-- PostgreSQL schema for OpsPulse migration
-- Tables: products, sales, predictions, alerts, data_imports

-- ============================================================
-- Table: products
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  legacy_mongo_id VARCHAR(24) -- temporary mapping for MongoDB ObjectId
);

-- Create index on name for lookups
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- Create index on legacy_mongo_id for migration sync
CREATE INDEX IF NOT EXISTS idx_products_legacy_mongo_id ON products(legacy_mongo_id);

-- ============================================================
-- Table: sales
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sale_date TIMESTAMPTZ NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_id, sale_date)
);

-- Create index on product_id for sales queries
CREATE INDEX IF NOT EXISTS idx_sales_product_id ON sales(product_id);

-- Create index on sale_date for time-based queries
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);

-- ============================================================
-- Table: predictions
-- ============================================================
CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  predicted_demand NUMERIC(12,2) NOT NULL,
  rule_prediction NUMERIC(12,2) NOT NULL,
  ml_prediction NUMERIC(12,2) NOT NULL,
  adjusted_prediction NUMERIC(12,2) NOT NULL,
  avg_sales NUMERIC(12,2) NOT NULL,
  percent_change NUMERIC(8,2) NOT NULL,
  confidence VARCHAR(10) NOT NULL CHECK (confidence IN ('Low', 'Medium', 'High')),
  season_tag VARCHAR(50) NOT NULL,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('increase', 'maintain', 'reduce')),
  impact VARCHAR(20) NOT NULL CHECK (impact IN ('increase', 'decrease', 'neutral')),
  keyword VARCHAR(100),
  score NUMERIC(5,2) DEFAULT 0,
  source_headline VARCHAR(255),
  source_headlines JSONB DEFAULT '[]',
  matched_keywords JSONB DEFAULT '[]',
  reason TEXT DEFAULT 'No explanation available',
  contributing_factors JSONB DEFAULT '[]',
  prediction_source VARCHAR(20) NOT NULL CHECK (prediction_source IN ('ml', 'rule-based')),
  predicted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_id)
);

-- Create index on product_id for lookups (unique constraint already creates index)
CREATE INDEX IF NOT EXISTS idx_predictions_product_id ON predictions(product_id);

-- Create index on predicted_at for cache freshness queries
CREATE INDEX IF NOT EXISTS idx_predictions_predicted_at ON predictions(predicted_at);

-- ============================================================
-- Table: alerts
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('HIGH_DEMAND', 'LOW_DEMAND', 'TREND_UP', 'TREND_DOWN')),
  message TEXT NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  percent_change NUMERIC(8,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index on product_id + is_active for active alerts queries
CREATE INDEX IF NOT EXISTS idx_alerts_product_active ON alerts(product_id, is_active);

-- Create index on severity for filtering
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

-- ============================================================
-- Table: data_imports
-- ============================================================
CREATE TABLE IF NOT EXISTS data_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255) NOT NULL,
  records_processed INTEGER DEFAULT 0,
  records_valid INTEGER DEFAULT 0,
  records_invalid INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index on created_at for import history queries
CREATE INDEX IF NOT EXISTS idx_data_imports_created_at ON data_imports(created_at);

-- ============================================================
-- Migration completion note
-- ============================================================
-- This migration creates the initial PostgreSQL schema for OpsPulse.
-- Tables: products, sales, predictions, alerts, data_imports
-- Legacy mongo_id fields are included for migration debugging/sync
-- All constraints, CHECK values, and defaults match the approved schema
-- MongoDB collections remain intact and are not modified by this migration