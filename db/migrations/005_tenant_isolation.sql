-- =============================================================================
-- OpsPulse Migration 005: Multi-Tenant Data Isolation and Schema Hardening
-- =============================================================================
-- Tables addressed:
--   - products: Add tenant_id NOT NULL, unique(tenant_id, id), indexes
--   - sales: Add tenant_id NOT NULL, composite FK -> products(tenant_id, id),
--            unique(tenant_id, product_id, sale_date), indexes
--   - predictions: Add tenant_id NOT NULL, composite FK -> products(tenant_id, id),
--                  unique(tenant_id, product_id), indexes
--   - alerts: Add tenant_id NOT NULL, composite FK -> products(tenant_id, id), indexes
--   - data_imports: Add tenant_id NOT NULL, indexes
--   - ai_document_chunks: Add tenant_id (nullable for shared platform documentation),
--                         partial unique indexes for shared vs tenant private documents
--   - agent_runs / agent_steps: Remove 'default' default value fallback, enforce non-empty check
--
-- EXECUTION MODES & OPERATOR GUIDELINES:
-- -----------------------------------------------------------------------------
-- 1. DRY-RUN INSPECTION (Recommended before production apply):
--    Validates preflight checks, executes DDL, simulates backfill, asserts
--    composite foreign-key integrity, prints verification report, and automatically
--    ROLLS BACK without committing any changes.
--
--    SET opspulse.dry_run = 'true';
--    -- Provide authoritative tenant or mapping table if existing unpartitioned data exists:
--    -- SET opspulse.authoritative_tenant_id = '<tenant_uuid>';
--    \i db/migrations/005_tenant_isolation.sql
--
-- 2. LIVE EXECUTION (Single-Tenant Historical Migration):
--    If an operator certifies all historical unpartitioned records belong to
--    a single tenant:
--
--    SET opspulse.dry_run = 'false';
--    SET opspulse.authoritative_tenant_id = '<valid-tenant-uuid>';
--    \i db/migrations/005_tenant_isolation.sql
--
-- 3. LIVE EXECUTION (Multi-Tenant Historical Migration):
--    If unpartitioned historical records belong to multiple tenants, OpsPulse
--    STRICTLY FORBIDS guessing. The operator must create and populate the mapping
--    table prior to running migration 005:
--
--    CREATE TABLE opspulse_tenant_mapping (
--      table_name VARCHAR(64) NOT NULL, -- 'products', 'sales', 'predictions', 'alerts', 'data_imports'
--      record_id UUID NOT NULL,
--      tenant_id VARCHAR(100) NOT NULL,
--      PRIMARY KEY (table_name, record_id)
--    );
--    -- Populate mapping table:
--    -- INSERT INTO opspulse_tenant_mapping (table_name, record_id, tenant_id) VALUES ...;
--    SET opspulse.dry_run = 'false';
--    \i db/migrations/005_tenant_isolation.sql
--
--    Note: Child tables (sales, predictions, alerts) automatically inherit tenant_id
--    from their parent product if not explicitly specified in opspulse_tenant_mapping.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 0: Helper Functions for Safe Idempotent Preflight
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.count_unassigned_rows(p_table text)
RETURNS bigint AS $$
DECLARE
    v_has_col boolean;
    v_cnt bigint;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = p_table
          AND column_name = 'tenant_id'
    ) INTO v_has_col;

    IF v_has_col THEN
        EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id IS NULL', p_table) INTO v_cnt;
    ELSE
        EXECUTE format('SELECT COUNT(*) FROM %I', p_table) INTO v_cnt;
    END IF;

    RETURN v_cnt;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- STEP 1: Preflight Verification & Data Ownership Validation
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_dry_run text := lower(coalesce(current_setting('opspulse.dry_run', true), 'false'));
    v_authoritative_tenant text := trim(coalesce(current_setting('opspulse.authoritative_tenant_id', true), ''));
    v_unassigned_products bigint;
    v_unassigned_sales bigint;
    v_unassigned_preds bigint;
    v_unassigned_alerts bigint;
    v_unassigned_imports bigint;
    v_total_unassigned bigint;
    v_has_mapping_table boolean;
    v_mapping_count bigint := 0;
BEGIN
    RAISE NOTICE '=====================================================================';
    RAISE NOTICE 'OpsPulse Migration 005 Preflight Inspection';
    RAISE NOTICE 'Dry Run Mode: %', CASE WHEN v_dry_run IN ('true', 't', '1', 'yes') THEN 'ENABLED (Changes will rollback)' ELSE 'DISABLED (LIVE COMMIT)' END;
    RAISE NOTICE '=====================================================================';

    v_unassigned_products := pg_temp.count_unassigned_rows('products');
    v_unassigned_sales := pg_temp.count_unassigned_rows('sales');
    v_unassigned_preds := pg_temp.count_unassigned_rows('predictions');
    v_unassigned_alerts := pg_temp.count_unassigned_rows('alerts');
    v_unassigned_imports := pg_temp.count_unassigned_rows('data_imports');

    v_total_unassigned := v_unassigned_products + v_unassigned_sales + v_unassigned_preds + v_unassigned_alerts + v_unassigned_imports;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'opspulse_tenant_mapping'
    ) INTO v_has_mapping_table;

    IF v_has_mapping_table THEN
        SELECT COUNT(*) INTO v_mapping_count FROM opspulse_tenant_mapping;
    END IF;

    RAISE NOTICE 'Unassigned business records detected:';
    RAISE NOTICE '  - products: %', v_unassigned_products;
    RAISE NOTICE '  - sales: %', v_unassigned_sales;
    RAISE NOTICE '  - predictions: %', v_unassigned_preds;
    RAISE NOTICE '  - alerts: %', v_unassigned_alerts;
    RAISE NOTICE '  - data_imports: %', v_unassigned_imports;
    RAISE NOTICE 'Mapping resources available:';
    RAISE NOTICE '  - opspulse.authoritative_tenant_id: %', CASE WHEN length(v_authoritative_tenant) > 0 THEN v_authoritative_tenant ELSE '(not set)' END;
    RAISE NOTICE '  - opspulse_tenant_mapping rows: %', v_mapping_count;

    -- Preflight assertion: If unassigned records exist, require valid mapping source
    IF v_total_unassigned > 0 THEN
        IF length(v_authoritative_tenant) = 0 AND v_mapping_count = 0 THEN
            RAISE EXCEPTION 'PREFLIGHT HALT: Database contains % unassigned historical business records, but no tenant mapping source was supplied.

OpsPulse refuses to guess tenant ownership or merge disparate tenant data.
To proceed, operator must choose one of two options:

Option 1 (Certified Single-Tenant Backfill):
  SET opspulse.authoritative_tenant_id = ''<valid-tenant-uuid>'';

Option 2 (Multi-Tenant Mapping Table):
  CREATE TABLE opspulse_tenant_mapping (
    table_name VARCHAR(64) NOT NULL,
    record_id UUID NOT NULL,
    tenant_id VARCHAR(100) NOT NULL,
    PRIMARY KEY (table_name, record_id)
  );
  -- Populate mapping table with record-to-tenant assignments, then re-run.',
                v_total_unassigned;
        END IF;
    ELSE
        RAISE NOTICE 'Preflight verified: Zero unassigned records detected. Proceeding with clean schema hardening.';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- STEP 2: Add tenant_id Columns (Nullable initially for safe backfill)
-- -----------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);
ALTER TABLE data_imports ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);

-- ai_document_chunks: NULL tenant_id is explicitly reserved for shared platform documentation
ALTER TABLE ai_document_chunks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);

-- -----------------------------------------------------------------------------
-- STEP 3: Safe Historical Data Backfill Execution
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_authoritative_tenant text := trim(coalesce(current_setting('opspulse.authoritative_tenant_id', true), ''));
    v_has_mapping_table boolean;
    v_updated_count bigint;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'opspulse_tenant_mapping'
    ) INTO v_has_mapping_table;

    -- 3a. Apply explicit mappings from opspulse_tenant_mapping if present
    IF v_has_mapping_table THEN
        -- Products
        UPDATE products p
        SET tenant_id = trim(m.tenant_id)
        FROM opspulse_tenant_mapping m
        WHERE m.table_name = 'products'
          AND m.record_id = p.id
          AND p.tenant_id IS NULL;
        GET DIAGNOSTICS v_updated_count = ROW_COUNT;
        IF v_updated_count > 0 THEN
            RAISE NOTICE 'Backfilled % products from opspulse_tenant_mapping.', v_updated_count;
        END IF;

        -- Sales (explicit overrides)
        UPDATE sales s
        SET tenant_id = trim(m.tenant_id)
        FROM opspulse_tenant_mapping m
        WHERE m.table_name = 'sales'
          AND m.record_id = s.id
          AND s.tenant_id IS NULL;

        -- Predictions (explicit overrides)
        UPDATE predictions pr
        SET tenant_id = trim(m.tenant_id)
        FROM opspulse_tenant_mapping m
        WHERE m.table_name = 'predictions'
          AND m.record_id = pr.id
          AND pr.tenant_id IS NULL;

        -- Alerts (explicit overrides)
        UPDATE alerts a
        SET tenant_id = trim(m.tenant_id)
        FROM opspulse_tenant_mapping m
        WHERE m.table_name = 'alerts'
          AND m.record_id = a.id
          AND a.tenant_id IS NULL;

        -- Data Imports
        UPDATE data_imports d
        SET tenant_id = trim(m.tenant_id)
        FROM opspulse_tenant_mapping m
        WHERE m.table_name = 'data_imports'
          AND m.record_id = d.id
          AND d.tenant_id IS NULL;

        -- Document Chunks (private customer documents if mapped)
        UPDATE ai_document_chunks c
        SET tenant_id = trim(m.tenant_id)
        FROM opspulse_tenant_mapping m
        WHERE m.table_name = 'ai_document_chunks'
          AND m.record_id = c.id
          AND c.tenant_id IS NULL;
    END IF;

    -- 3b. Backfill child tables from parent products for unmapped child records
    UPDATE sales s
    SET tenant_id = p.tenant_id
    FROM products p
    WHERE s.product_id = p.id
      AND s.tenant_id IS NULL
      AND p.tenant_id IS NOT NULL;

    UPDATE predictions pr
    SET tenant_id = p.tenant_id
    FROM products p
    WHERE pr.product_id = p.id
      AND pr.tenant_id IS NULL
      AND p.tenant_id IS NOT NULL;

    UPDATE alerts a
    SET tenant_id = p.tenant_id
    FROM products p
    WHERE a.product_id = p.id
      AND a.tenant_id IS NULL
      AND p.tenant_id IS NOT NULL;

    -- 3c. Apply authoritative tenant setting for any remaining unassigned business records
    IF length(v_authoritative_tenant) > 0 THEN
        UPDATE products SET tenant_id = v_authoritative_tenant WHERE tenant_id IS NULL;
        UPDATE sales SET tenant_id = v_authoritative_tenant WHERE tenant_id IS NULL;
        UPDATE predictions SET tenant_id = v_authoritative_tenant WHERE tenant_id IS NULL;
        UPDATE alerts SET tenant_id = v_authoritative_tenant WHERE tenant_id IS NULL;
        UPDATE data_imports SET tenant_id = v_authoritative_tenant WHERE tenant_id IS NULL;
        RAISE NOTICE 'Applied authoritative tenant "%" to remaining unassigned records.', v_authoritative_tenant;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- STEP 4: Post-Backfill Integrity Assertions
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_unmapped_products bigint;
    v_unmapped_sales bigint;
    v_unmapped_preds bigint;
    v_unmapped_alerts bigint;
    v_unmapped_imports bigint;
    v_mismatched_sales bigint;
    v_mismatched_preds bigint;
    v_mismatched_alerts bigint;
    v_dup_sales bigint;
    v_dup_preds bigint;
BEGIN
    -- Check for remaining NULL tenant IDs in business tables
    SELECT COUNT(*) INTO v_unmapped_products FROM products WHERE tenant_id IS NULL;
    SELECT COUNT(*) INTO v_unmapped_sales FROM sales WHERE tenant_id IS NULL;
    SELECT COUNT(*) INTO v_unmapped_preds FROM predictions WHERE tenant_id IS NULL;
    SELECT COUNT(*) INTO v_unmapped_alerts FROM alerts WHERE tenant_id IS NULL;
    SELECT COUNT(*) INTO v_unmapped_imports FROM data_imports WHERE tenant_id IS NULL;

    IF (v_unmapped_products > 0 OR v_unmapped_sales > 0 OR v_unmapped_preds > 0 OR v_unmapped_alerts > 0 OR v_unmapped_imports > 0) THEN
        RAISE EXCEPTION 'POST-BACKFILL INTEGRITY FAILURE: Unmapped business records remain (products=%, sales=%, predictions=%, alerts=%, imports=%). Cannot enforce NOT NULL or create composite foreign keys. Review opspulse_tenant_mapping or opspulse.authoritative_tenant_id.',
            v_unmapped_products, v_unmapped_sales, v_unmapped_preds, v_unmapped_alerts, v_unmapped_imports;
    END IF;

    -- Assert cross-tenant consistency between children and parent products
    SELECT COUNT(*) INTO v_mismatched_sales
    FROM sales s
    JOIN products p ON s.product_id = p.id
    WHERE s.tenant_id <> p.tenant_id;

    SELECT COUNT(*) INTO v_mismatched_preds
    FROM predictions pr
    JOIN products p ON pr.product_id = p.id
    WHERE pr.tenant_id <> p.tenant_id;

    SELECT COUNT(*) INTO v_mismatched_alerts
    FROM alerts a
    JOIN products p ON a.product_id = p.id
    WHERE a.tenant_id <> p.tenant_id;

    IF (v_mismatched_sales > 0 OR v_mismatched_preds > 0 OR v_mismatched_alerts > 0) THEN
        RAISE EXCEPTION 'CROSS-TENANT INTEGRITY VIOLATION: Discovered child records referencing products of a DIFFERENT tenant (mismatched sales=%, predictions=%, alerts=%). Composite foreign keys cannot be applied. Reconcile tenant ownership in opspulse_tenant_mapping before continuing.',
            v_mismatched_sales, v_mismatched_preds, v_mismatched_alerts;
    END IF;

    -- Assert no duplicate unique keys exist before constraint creation
    SELECT COUNT(*) INTO v_dup_sales
    FROM (
        SELECT tenant_id, product_id, sale_date, COUNT(*)
        FROM sales
        GROUP BY tenant_id, product_id, sale_date
        HAVING COUNT(*) > 1
    ) sub;

    SELECT COUNT(*) INTO v_dup_preds
    FROM (
        SELECT tenant_id, product_id, COUNT(*)
        FROM predictions
        GROUP BY tenant_id, product_id
        HAVING COUNT(*) > 1
    ) sub;

    IF (v_dup_sales > 0 OR v_dup_preds > 0) THEN
        RAISE EXCEPTION 'UNIQUE CONSTRAINT INTEGRITY VIOLATION: Duplicate keys detected prior to constraint creation (duplicate sales rows=%, duplicate prediction rows=%).',
            v_dup_sales, v_dup_preds;
    END IF;

    RAISE NOTICE 'Integrity assertions passed: 0 unmapped business records, 0 cross-tenant product references, 0 unique key collisions.';
END $$;

-- -----------------------------------------------------------------------------
-- STEP 5: Enforce NOT NULL and Non-Empty CHECK Constraints on Business Tables
-- -----------------------------------------------------------------------------
ALTER TABLE products ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_tenant_nonempty;
ALTER TABLE products ADD CONSTRAINT chk_products_tenant_nonempty CHECK (length(trim(tenant_id)) > 0);

ALTER TABLE sales ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sales DROP CONSTRAINT IF EXISTS chk_sales_tenant_nonempty;
ALTER TABLE sales ADD CONSTRAINT chk_sales_tenant_nonempty CHECK (length(trim(tenant_id)) > 0);

ALTER TABLE predictions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS chk_predictions_tenant_nonempty;
ALTER TABLE predictions ADD CONSTRAINT chk_predictions_tenant_nonempty CHECK (length(trim(tenant_id)) > 0);

ALTER TABLE alerts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS chk_alerts_tenant_nonempty;
ALTER TABLE alerts ADD CONSTRAINT chk_alerts_tenant_nonempty CHECK (length(trim(tenant_id)) > 0);

ALTER TABLE data_imports ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE data_imports DROP CONSTRAINT IF EXISTS chk_data_imports_tenant_nonempty;
ALTER TABLE data_imports ADD CONSTRAINT chk_data_imports_tenant_nonempty CHECK (length(trim(tenant_id)) > 0);

-- ai_document_chunks: tenant_id remains nullable (NULL = shared platform docs), but non-empty when set
ALTER TABLE ai_document_chunks DROP CONSTRAINT IF EXISTS chk_ai_document_chunks_tenant_nonempty;
ALTER TABLE ai_document_chunks ADD CONSTRAINT chk_ai_document_chunks_tenant_nonempty
  CHECK (tenant_id IS NULL OR length(trim(tenant_id)) > 0);

-- -----------------------------------------------------------------------------
-- STEP 6: Composite Unique Constraints & Foreign Keys
-- -----------------------------------------------------------------------------
-- 6a. products: Ensure unique constraint on (tenant_id, id) required for composite FK target.
-- Safe on re-run: Do not drop products_tenant_id_id_key if child composite foreign keys depend on it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = current_schema()
          AND table_name = 'products'
          AND constraint_name = 'products_tenant_id_id_key'
    ) THEN
        ALTER TABLE products ADD CONSTRAINT products_tenant_id_id_key UNIQUE (tenant_id, id);
    END IF;
END $$;

-- 6b. sales:
-- Replace single-column foreign key with composite foreign key
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_product_id_fkey;
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_tenant_product_fkey;
ALTER TABLE sales ADD CONSTRAINT sales_tenant_product_fkey
  FOREIGN KEY (tenant_id, product_id)
  REFERENCES products(tenant_id, id)
  ON DELETE CASCADE;

-- Update unique constraint from (product_id, sale_date) to (tenant_id, product_id, sale_date)
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_product_id_sale_date_key;
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_tenant_product_date_key;
ALTER TABLE sales ADD CONSTRAINT sales_tenant_product_date_key UNIQUE (tenant_id, product_id, sale_date);

-- 6c. predictions:
-- Replace single-column foreign key with composite foreign key
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_product_id_fkey;
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_tenant_product_fkey;
ALTER TABLE predictions ADD CONSTRAINT predictions_tenant_product_fkey
  FOREIGN KEY (tenant_id, product_id)
  REFERENCES products(tenant_id, id)
  ON DELETE CASCADE;

-- Update unique constraint from (product_id) to (tenant_id, product_id)
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_product_id_key;
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_tenant_product_key;
ALTER TABLE predictions ADD CONSTRAINT predictions_tenant_product_key UNIQUE (tenant_id, product_id);

-- 6d. alerts:
-- Replace single-column foreign key with composite foreign key
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_product_id_fkey;
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_tenant_product_fkey;
ALTER TABLE alerts ADD CONSTRAINT alerts_tenant_product_fkey
  FOREIGN KEY (tenant_id, product_id)
  REFERENCES products(tenant_id, id)
  ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- STEP 7: RAG Document Chunks Partial Unique Indexes
-- -----------------------------------------------------------------------------
-- Drop global unique constraint that prevented multi-tenant co-existence
ALTER TABLE ai_document_chunks DROP CONSTRAINT IF EXISTS ai_document_chunks_document_key_content_hash_version_key;

-- Shared platform documents (tenant_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_document_chunks_shared_unique
  ON ai_document_chunks (document_key, content_hash, version)
  WHERE tenant_id IS NULL;

-- Private customer tenant documents (tenant_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_document_chunks_tenant_unique
  ON ai_document_chunks (tenant_id, document_key, content_hash, version)
  WHERE tenant_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- STEP 8: Agent Execution Tracking Hardening (agent_runs / agent_steps)
-- -----------------------------------------------------------------------------
-- Remove silent 'default' fallbacks on tenant_id columns to mandate explicit identity
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'agent_runs' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE agent_runs ALTER COLUMN tenant_id DROP DEFAULT;
        ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS chk_agent_runs_tenant_nonempty;
        ALTER TABLE agent_runs ADD CONSTRAINT chk_agent_runs_tenant_nonempty CHECK (length(trim(tenant_id)) > 0);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'agent_steps' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE agent_steps ALTER COLUMN tenant_id DROP DEFAULT;
        ALTER TABLE agent_steps DROP CONSTRAINT IF EXISTS chk_agent_steps_tenant_nonempty;
        ALTER TABLE agent_steps ADD CONSTRAINT chk_agent_steps_tenant_nonempty CHECK (length(trim(tenant_id)) > 0);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- STEP 9: High-Performance Composite & Partition Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_name ON products(tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_products_tenant_category ON products(tenant_id, category);

CREATE INDEX IF NOT EXISTS idx_sales_tenant_product ON sales(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales(tenant_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_product_date ON sales(tenant_id, product_id, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_predictions_tenant_product ON predictions(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_predictions_tenant_predicted_at ON predictions(tenant_id, predicted_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_tenant_active ON alerts(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_product ON alerts(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_severity ON alerts(tenant_id, severity);

CREATE INDEX IF NOT EXISTS idx_data_imports_tenant ON data_imports(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_document_chunks_tenant ON ai_document_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_document_chunks_shared ON ai_document_chunks(document_key) WHERE tenant_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 10: PostgreSQL Row-Level Security (RLS) Directives (Optional / Staged)
-- -----------------------------------------------------------------------------
-- NOTE FOR OPERATORS:
-- OpsPulse Phase 1 enforces tenant isolation at the application layer across all
-- Node.js Express controllers and FastAPI LangGraph/tool executions.
-- To enable database-enforced Row-Level Security (RLS) in Supabase or PostgreSQL:
--
-- 1. Configure backend and ML connection pools to execute session parameter checkout:
--      SET LOCAL app.current_tenant_id = '<validated_tenant_id>';
--
-- 2. Once connection pool checkout hooks are deployed, enable RLS:
--      ALTER TABLE products ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE data_imports ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE ai_document_chunks ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
--      ALTER TABLE agent_steps ENABLE ROW LEVEL SECURITY;
--
-- 3. Define policies:
--      CREATE POLICY tenant_isolation_products ON products
--        USING (tenant_id = current_setting('app.current_tenant_id', true));
--      CREATE POLICY tenant_isolation_sales ON sales
--        USING (tenant_id = current_setting('app.current_tenant_id', true));
--      CREATE POLICY tenant_isolation_predictions ON predictions
--        USING (tenant_id = current_setting('app.current_tenant_id', true));
--      CREATE POLICY tenant_isolation_alerts ON alerts
--        USING (tenant_id = current_setting('app.current_tenant_id', true));
--      CREATE POLICY tenant_isolation_imports ON data_imports
--        USING (tenant_id = current_setting('app.current_tenant_id', true));
--      CREATE POLICY tenant_isolation_rag ON ai_document_chunks
--        USING (tenant_id = current_setting('app.current_tenant_id', true) OR tenant_id IS NULL);
--      CREATE POLICY tenant_isolation_agent_runs ON agent_runs
--        USING (tenant_id = current_setting('app.current_tenant_id', true));
--      CREATE POLICY tenant_isolation_agent_steps ON agent_steps
--        USING (tenant_id = current_setting('app.current_tenant_id', true));
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- STEP 11: Final Dry Run Evaluation and Commit
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_dry_run text := lower(coalesce(current_setting('opspulse.dry_run', true), 'false'));
BEGIN
    RAISE NOTICE '=====================================================================';
    RAISE NOTICE 'OpsPulse Migration 005 Complete:';
    RAISE NOTICE '  [PASS] products: tenant_id NOT NULL, unique(tenant_id, id), indexed';
    RAISE NOTICE '  [PASS] sales: composite FK -> products(tenant_id, id), unique(tenant_id, product_id, sale_date)';
    RAISE NOTICE '  [PASS] predictions: composite FK -> products(tenant_id, id), unique(tenant_id, product_id)';
    RAISE NOTICE '  [PASS] alerts: composite FK -> products(tenant_id, id), indexed';
    RAISE NOTICE '  [PASS] data_imports: tenant_id NOT NULL, indexed';
    RAISE NOTICE '  [PASS] ai_document_chunks: shared (NULL) and tenant (NOT NULL) partial indexes active';
    RAISE NOTICE '  [PASS] agent_runs / agent_steps: default fallback removed, non-empty check active';
    RAISE NOTICE '=====================================================================';

    IF v_dry_run IN ('true', 't', '1', 'yes') THEN
        RAISE EXCEPTION 'DRY RUN COMPLETE: All schema modifications, backfill mappings, and composite key assertions verified successfully. Rolling back transaction cleanly (no changes were committed).'
            USING ERRCODE = 'check_violation';
    ELSE
        RAISE NOTICE 'MIGRATION COMPLETE: Committing all multi-tenant schema isolation changes.';
    END IF;
END $$;

COMMIT;
