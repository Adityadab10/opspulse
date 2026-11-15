-- Approval-gated actions proposed by the Inventory Agent.  Recommendations are
-- immutable snapshots so an execution can always be audited and revalidated.
BEGIN;

CREATE TABLE IF NOT EXISTS inventory_agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  recommendation JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'executing', 'rejected', 'executed', 'stale', 'failed')),
  approved_by VARCHAR(128), approved_at TIMESTAMPTZ,
  rejected_by VARCHAR(128), rejected_at TIMESTAMPTZ,
  executed_by VARCHAR(128), executed_at TIMESTAMPTZ,
  execution_result JSONB, execution_key UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_agent_actions_tenant_run ON inventory_agent_actions(tenant_id, run_id, created_at DESC);
COMMIT;
