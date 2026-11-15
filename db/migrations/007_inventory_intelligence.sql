-- 007_inventory_intelligence.sql
-- Adds explicit per-product reorder thresholds and forecast horizon metadata.
-- Default reorder threshold is 10 units; operators can change it per product.

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS reorder_threshold INTEGER NOT NULL DEFAULT 10;
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_reorder_threshold_nonnegative;
ALTER TABLE products
  ADD CONSTRAINT products_reorder_threshold_nonnegative CHECK (reorder_threshold >= 0);
CREATE INDEX IF NOT EXISTS idx_products_tenant_reorder_threshold
  ON products(tenant_id, reorder_threshold);

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS prediction_horizon_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE predictions
  DROP CONSTRAINT IF EXISTS predictions_horizon_positive;
ALTER TABLE predictions
  ADD CONSTRAINT predictions_horizon_positive CHECK (prediction_horizon_days > 0);

COMMIT;

-- Rollback guidance: stop inventory-intelligence writes, then remove the index,
-- constraints, and columns manually. Historical sales and ledger movements are
-- unaffected; prediction horizon metadata may be retained for auditability.
