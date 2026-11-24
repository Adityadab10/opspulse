-- OpsPulse fresh Supabase project only. Proposal for review, do not execute.
-- Existing migrations and archived records are intentionally outside this bootstrap.
BEGIN;
SET LOCAL search_path = public, extensions, pg_catalog;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE app_users (
  id VARCHAR(128) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clerk_user_id TEXT NOT NULL UNIQUE CHECK (clerk_user_id <> '' AND clerk_user_id = btrim(clerk_user_id)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id VARCHAR(100) PRIMARY KEY DEFAULT gen_random_uuid()::text
    CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id),
  user_id VARCHAR(128) NOT NULL REFERENCES app_users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_active_user_idx ON tenant_memberships(user_id, tenant_id)
  WHERE revoked_at IS NULL;

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  legacy_mongo_id VARCHAR(24),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  reorder_threshold INTEGER NOT NULL DEFAULT 10 CHECK (reorder_threshold >= 0),
  UNIQUE (tenant_id, id)
);

CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id),
  product_id UUID NOT NULL,
  sale_date TIMESTAMPTZ NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT sales_tenant_product_date_key UNIQUE (tenant_id, product_id, sale_date),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);

CREATE TABLE predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id),
  product_id UUID NOT NULL,
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
  CONSTRAINT predictions_tenant_product_key UNIQUE (tenant_id, product_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
  prediction_horizon_days INTEGER NOT NULL DEFAULT 30 CHECK (prediction_horizon_days > 0)
);

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id),
  product_id UUID NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('HIGH_DEMAND', 'LOW_DEMAND', 'TREND_UP', 'TREND_DOWN')),
  message TEXT NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  percent_change NUMERIC(8,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
  legacy_mongo_id VARCHAR(24)
);

CREATE TABLE data_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id),
  filename VARCHAR(255) NOT NULL,
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_valid INTEGER NOT NULL DEFAULT 0,
  records_invalid INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (records_processed >= 0 AND records_valid >= 0 AND records_invalid >= 0)
);

CREATE TABLE inventory_movements (
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
    ON DELETE RESTRICT
);

CREATE TABLE ai_document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) REFERENCES tenants(id),
  document_key VARCHAR(160) NOT NULL,
  title VARCHAR(255) NOT NULL,
  section VARCHAR(255),
  content TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  embedding vector(384),
  version VARCHAR(32) NOT NULL DEFAULT 'v1',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(id),
  user_id VARCHAR(128) NOT NULL,
  thread_id TEXT NOT NULL,
  trigger_type VARCHAR(32) NOT NULL DEFAULT 'on_demand'
    CHECK (trigger_type IN ('on_demand', 'scheduled', 'event')),
  trigger_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  question TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'partial', 'cancelled')),
  execution_plan JSONB,
  selected_agents JSONB DEFAULT '[]'::jsonb,
  final_answer TEXT,
  confidence NUMERIC(5, 4),
  limitations JSONB DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id)
);

CREATE TABLE agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  tenant_id VARCHAR(100) NOT NULL,
  step_number INTEGER NOT NULL CHECK (step_number >= 0),
  agent_name VARCHAR(64) NOT NULL,
  node_name VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  input_payload JSONB,
  output_payload JSONB,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  UNIQUE (run_id, step_number),
  FOREIGN KEY (tenant_id, run_id) REFERENCES agent_runs(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, run_id, step_number)
);

CREATE TABLE inventory_agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(100) NOT NULL,
  run_id UUID NOT NULL,
  product_id UUID NOT NULL,
  recommendation JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'executing', 'rejected', 'executed', 'stale', 'failed')),
  approved_by VARCHAR(128), approved_at TIMESTAMPTZ,
  rejected_by VARCHAR(128), rejected_at TIMESTAMPTZ,
  executed_by VARCHAR(128), executed_at TIMESTAMPTZ,
  execution_result JSONB, execution_key UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, product_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES agent_runs(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES tenant_memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, rejected_by) REFERENCES tenant_memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, executed_by) REFERENCES tenant_memberships(tenant_id, user_id),
  UNIQUE (tenant_id, execution_key),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK ((rejected_by IS NULL) = (rejected_at IS NULL)),
  CHECK ((executed_by IS NULL) = (executed_at IS NULL)),
  CHECK ((status IN ('approved','executing','executed','stale','failed')) = (approved_by IS NOT NULL)),
  CHECK ((status = 'rejected') = (rejected_by IS NOT NULL)),
  CHECK ((status = 'executed') = (executed_by IS NOT NULL))
);

CREATE INDEX products_tenant_name_idx ON products(tenant_id, lower(name));
CREATE INDEX products_tenant_category_idx ON products(tenant_id, category);
CREATE INDEX products_tenant_import_lookup_idx ON products(tenant_id, name, category);
CREATE INDEX products_tenant_legacy_idx ON products(tenant_id, legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE INDEX products_tenant_reorder_idx ON products(tenant_id, reorder_threshold);
CREATE INDEX sales_tenant_date_idx ON sales(tenant_id, sale_date);
CREATE INDEX predictions_tenant_time_idx ON predictions(tenant_id, predicted_at DESC);
CREATE INDEX alerts_tenant_product_idx ON alerts(tenant_id, product_id);
CREATE INDEX alerts_active_idx ON alerts(tenant_id, product_id, type, created_at DESC) WHERE is_active;
CREATE INDEX alerts_tenant_severity_idx ON alerts(tenant_id, severity);
CREATE UNIQUE INDEX alerts_tenant_legacy_idx ON alerts(tenant_id, legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE INDEX imports_tenant_time_idx ON data_imports(tenant_id, created_at DESC);
CREATE INDEX movements_tenant_product_idx ON inventory_movements(tenant_id, product_id, created_at DESC);
CREATE INDEX movements_tenant_type_idx ON inventory_movements(tenant_id, movement_type, created_at DESC);
CREATE UNIQUE INDEX rag_shared_unique_idx ON ai_document_chunks(document_key, content_hash, version) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX rag_private_unique_idx ON ai_document_chunks(tenant_id, document_key, content_hash, version) WHERE tenant_id IS NOT NULL;
CREATE INDEX rag_embedding_idx ON ai_document_chunks USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;
CREATE INDEX runs_tenant_time_idx ON agent_runs(tenant_id, started_at DESC);
CREATE INDEX runs_tenant_status_idx ON agent_runs(tenant_id, status);
CREATE INDEX runs_tenant_user_idx ON agent_runs(tenant_id, user_id);
CREATE INDEX runs_tenant_thread_idx ON agent_runs(tenant_id, thread_id);
CREATE INDEX inventory_actions_tenant_product_idx ON inventory_agent_actions(tenant_id, product_id);

-- Runtime roles and grants are provisioned in a separately reviewed deployment step.
-- Policies are inert for callers without grants and fail closed without transaction context.
-- Set app.current_tenant_id only after trusted membership resolution on the same connection.
CREATE SCHEMA opspulse_checkpoints;
REVOKE ALL ON SCHEMA opspulse_checkpoints FROM PUBLIC, anon, authenticated, service_role;
-- PostgresSaver.setup() owns checkpoint DDL and migration ledger in this schema.
-- Do not hand-create its tables or point runtime searches at public checkpoint tables.

REVOKE ALL ON TABLE app_users FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE tenants FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE tenant_memberships FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE products FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sales FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE predictions FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE alerts FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE data_imports FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE data_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_imports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ai_document_chunks FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE ai_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_document_chunks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agent_runs FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agent_steps FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE agent_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_steps FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inventory_movements FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inventory_agent_actions FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE inventory_agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_agent_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON products
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_scope ON sales
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_scope ON predictions
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_scope ON alerts
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_scope ON data_imports
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_scope ON agent_runs
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_scope ON agent_steps
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_scope ON inventory_movements
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_scope ON inventory_agent_actions
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- Identity bootstrap lookups use the verified subject and then the resolved internal user ID.
CREATE POLICY verified_subject ON app_users FOR SELECT
  USING (clerk_user_id = current_setting('app.current_clerk_user_id', true));
CREATE POLICY user_memberships ON tenant_memberships FOR SELECT
  USING (user_id = current_setting('app.current_user_id', true) AND revoked_at IS NULL);
CREATE POLICY active_tenant ON tenants FOR SELECT
  USING (EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = tenants.id));

CREATE POLICY rag_read ON ai_document_chunks FOR SELECT
  USING (NULLIF(current_setting('app.current_tenant_id', true), '') IS NOT NULL
    AND (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)));
CREATE POLICY rag_private_write ON ai_document_chunks FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

COMMIT;
