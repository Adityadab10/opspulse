-- 006_inventory_foundation.sql
-- Adds an explicit zero-based stock balance and tenant-safe movement ledger.
-- Existing products receive stock_quantity = 0. No historical stock is inferred
-- and no historical sales receive fabricated ledger entries.

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_stock_quantity_nonnegative;
ALTER TABLE products
  ADD CONSTRAINT products_stock_quantity_nonnegative CHECK (stock_quantity >= 0);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  product_id UUID NOT NULL,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('INITIAL', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SALE')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_tenant_product_fkey
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT inventory_movements_tenant_nonempty CHECK (length(trim(tenant_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_product_date
  ON inventory_movements(tenant_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_type
  ON inventory_movements(tenant_id, movement_type, created_at DESC);

COMMIT;

-- Rollback guidance (manual, never automatic): stop inventory-aware writes,
-- retain/export inventory_movements, then drop the table, check constraint, and
-- stock_quantity column. Historical sales remain untouched by this rollback.
