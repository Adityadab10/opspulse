"""Permanent PostgreSQL Integration Test Suite for OpsPulse Migration 005.

Validates migrations 001, 002, 003, 004, and 005 against a real PostgreSQL
instance with the actual pgvector extension and HNSW cosine distance index.
Never substitutes migration SQL with mocks or dummy types.

Execution Modes:
  1. Pytest: pytest ml-service/tests/test_migration_005_pgvector.py -v
  2. Standalone: python ml-service/tests/test_migration_005_pgvector.py
"""

from __future__ import annotations

import os
import sys
from typing import Generator
import urllib.parse
import psycopg
import pytest

# -----------------------------------------------------------------------------
# Configuration and Safety Guardrails
# -----------------------------------------------------------------------------
DEFAULT_LOCAL_TEST_URL = "postgresql://postgres@127.0.0.1:5433/postgres"
PERMITTED_HOSTS = {"127.0.0.1", "localhost", "::1", "docker", "postgres"}
FORBIDDEN_KEYWORDS = ["supabase", "pooler", "aws", "prod", "production", "staging"]


def get_safe_test_db_url() -> str:
    """Resolve and validate the test database connection URL against safety rules."""
    url = os.getenv("OPSPULSE_TEST_DATABASE_URL") or os.getenv("TEST_DATABASE_URL")
    if not url:
        url = DEFAULT_LOCAL_TEST_URL

    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()

    if host not in PERMITTED_HOSTS:
        raise RuntimeError(
            f"SAFETY GUARDRAIL TRIGGERED: Test database connection rejected. "
            f"Host '{host}' is outside permitted local test hosts: {PERMITTED_HOSTS}."
        )

    url_lower = url.lower()
    for kw in FORBIDDEN_KEYWORDS:
        if kw in url_lower:
            raise RuntimeError(
                f"SAFETY GUARDRAIL TRIGGERED: Test database connection rejected. "
                f"URL contains forbidden remote/production keyword: '{kw}'."
            )

    return url


def probe_test_database() -> tuple[bool, str]:
    """Check whether the isolated PostgreSQL + pgvector instance is reachable."""
    try:
        url = get_safe_test_db_url()
    except Exception as exc:
        return False, str(exc)

    try:
        with psycopg.connect(url, connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM pg_available_extensions WHERE name = 'vector';")
                if not cur.fetchone():
                    return False, "Target PostgreSQL instance is running, but 'vector' extension is not available."
        return True, "Reachable with pgvector"
    except Exception as exc:
        return False, f"Could not connect to test PostgreSQL on {url}: {exc}"


DB_AVAILABLE, DB_SKIP_REASON = probe_test_database()
pytestmark = pytest.mark.skipif(not DB_AVAILABLE, reason=DB_SKIP_REASON)

# -----------------------------------------------------------------------------
# Test Database Provisioning and Teardown Helpers
# -----------------------------------------------------------------------------
def get_base_db_url(dbname: str = "postgres") -> str:
    parsed = urllib.parse.urlparse(get_safe_test_db_url())
    return urllib.parse.urlunparse(parsed._replace(path=f"/{dbname}"))


def setup_fresh_database(dbname: str) -> None:
    """Drop and recreate an isolated database on the test cluster."""
    admin_url = get_base_db_url("postgres")
    with psycopg.connect(admin_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {dbname} WITH (FORCE);")
            cur.execute(f"CREATE DATABASE {dbname};")


def teardown_database(dbname: str) -> None:
    """Drop the test database cleanly with FORCE to prevent lingering databases."""
    admin_url = get_base_db_url("postgres")
    try:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(f"DROP DATABASE IF EXISTS {dbname} WITH (FORCE);")
    except Exception:
        pass


def apply_migration_file(cur: psycopg.Cursor, filename: str) -> None:
    """Read and execute an actual migration file completely unchanged."""
    path = os.path.join("db", "migrations", filename)
    with open(path, "r", encoding="utf-8") as f:
        sql = f.read()
    cur.execute(sql)


# -----------------------------------------------------------------------------
# Fixture Scenarios (1 Through 8)
# -----------------------------------------------------------------------------

def test_1_clean_empty_database_migrations_001_to_005():
    """Verify that migrations 001-005 execute unchanged on a clean database."""
    dbname = "test_fixture_1_clean"
    setup_fresh_database(dbname)
    try:
        db_url = get_base_db_url(dbname)
        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                # 1. Execute migrations 001–005 unchanged in order
                for migration in [
                    "001_initial_schema.sql",
                    "002_alert_legacy_mongo_id.sql",
                    "003_ai_analyst_rag.sql",
                    "004_agent_runs_and_steps.sql",
                    "005_tenant_isolation.sql",
                ]:
                    apply_migration_file(cur, migration)

                # 2. Verify pgvector type and dimensions
                cur.execute("""
                    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
                    FROM pg_attribute a
                    JOIN pg_class c ON c.oid = a.attrelid
                    WHERE c.relname = 'ai_document_chunks' AND a.attname = 'embedding';
                """)
                row = cur.fetchone()
                assert row is not None, "embedding column not found in ai_document_chunks"
                assert row[1] == "vector(384)", f"Expected vector(384), got {row[1]}"

                # 3. Verify HNSW index
                cur.execute("""
                    SELECT indexname, indexdef
                    FROM pg_indexes
                    WHERE tablename = 'ai_document_chunks' AND indexname = 'idx_ai_document_chunks_embedding_hnsw';
                """)
                hnsw_row = cur.fetchone()
                assert hnsw_row is not None, "Missing HNSW index idx_ai_document_chunks_embedding_hnsw"
                assert "USING hnsw" in hnsw_row[1]
                assert "vector_cosine_ops" in hnsw_row[1]

                # 4. Verify composite foreign keys on sales, predictions, alerts
                for child_table in ["sales", "predictions", "alerts"]:
                    cur.execute(f"""
                        SELECT constraint_name
                        FROM information_schema.table_constraints
                        WHERE table_name = '{child_table}' AND constraint_name = '{child_table}_tenant_product_fkey';
                    """)
                    assert cur.fetchone() is not None, f"Missing composite foreign key {child_table}_tenant_product_fkey"

                # 5. Verify tenant_id NOT NULL on business tables
                for table in ["products", "sales", "predictions", "alerts", "data_imports"]:
                    cur.execute(f"""
                        SELECT is_nullable
                        FROM information_schema.columns
                        WHERE table_name = '{table}' AND column_name = 'tenant_id';
                    """)
                    assert cur.fetchone()[0] == "NO", f"Expected tenant_id NOT NULL on {table}"

                # 6. Verify agent_runs and agent_steps dropped default fallback
                for table in ["agent_runs", "agent_steps"]:
                    cur.execute(f"""
                        SELECT column_default
                        FROM information_schema.columns
                        WHERE table_name = '{table}' AND column_name = 'tenant_id';
                    """)
                    assert cur.fetchone()[0] is None, f"{table}.tenant_id default was not dropped"
    finally:
        teardown_database(dbname)


def test_2_single_tenant_historical_backfill():
    """Verify authoritative tenant parameter assigns unpartitioned historical records."""
    dbname = "test_fixture_2_single_tenant"
    setup_fresh_database(dbname)
    try:
        db_url = get_base_db_url(dbname)
        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                # Apply 001–004 unchanged
                for m in ["001_initial_schema.sql", "002_alert_legacy_mongo_id.sql", "003_ai_analyst_rag.sql", "004_agent_runs_and_steps.sql"]:
                    apply_migration_file(cur, m)

                # Seed historical records without tenant_id (including vector embedding)
                cur.execute("INSERT INTO products (name, category) VALUES ('Organic Coffee', 'Beverages') RETURNING id;")
                p_id = cur.fetchone()[0]
                cur.execute("INSERT INTO sales (product_id, sale_date, quantity) VALUES (%s, now(), 12);", (p_id,))
                cur.execute("""
                    INSERT INTO predictions (
                        product_id, predicted_demand, rule_prediction, ml_prediction,
                        adjusted_prediction, avg_sales, percent_change, confidence,
                        season_tag, decision, impact, prediction_source
                    ) VALUES (%s, 15.0, 14.0, 15.0, 15.0, 12.0, 25.0, 'High', 'Winter', 'increase', 'increase', 'ml');
                """, (p_id,))
                cur.execute("INSERT INTO alerts (product_id, type, message, severity) VALUES (%s, 'HIGH_DEMAND', 'Spike', 'HIGH');", (p_id,))
                cur.execute("INSERT INTO data_imports (filename) VALUES ('2025_sales.csv');")

                # Insert shared RAG document chunk with actual vector embedding
                embedding_str = "[" + ",".join(["0.05"] * 384) + "]"
                cur.execute("""
                    INSERT INTO ai_document_chunks (document_key, title, content, content_hash, embedding)
                    VALUES ('store_ops_v1', 'Store Guide', 'Standard Ops', 'hash_abc_123', %s::vector);
                """, (embedding_str,))

                # Set authoritative tenant parameter and apply migration 005
                cur.execute("SET opspulse.authoritative_tenant_id = 'tenant-corp-acme';")
                apply_migration_file(cur, "005_tenant_isolation.sql")

                # Verify all business rows backfilled to tenant-corp-acme
                cur.execute("SELECT tenant_id FROM products WHERE id = %s;", (p_id,))
                assert cur.fetchone()[0] == "tenant-corp-acme"
                cur.execute("SELECT tenant_id FROM sales WHERE product_id = %s;", (p_id,))
                assert cur.fetchone()[0] == "tenant-corp-acme"
                cur.execute("SELECT tenant_id FROM predictions WHERE product_id = %s;", (p_id,))
                assert cur.fetchone()[0] == "tenant-corp-acme"
                cur.execute("SELECT tenant_id FROM alerts WHERE product_id = %s;", (p_id,))
                assert cur.fetchone()[0] == "tenant-corp-acme"
                cur.execute("SELECT tenant_id FROM data_imports;")
                assert cur.fetchone()[0] == "tenant-corp-acme"

                # Shared document chunk remains NULL
                cur.execute("SELECT tenant_id FROM ai_document_chunks WHERE document_key = 'store_ops_v1';")
                assert cur.fetchone()[0] is None
    finally:
        teardown_database(dbname)


def test_3_multi_tenant_mapping_table_inheritance():
    """Verify multi-tenant mapping table partitions products and cascades to children."""
    dbname = "test_fixture_3_multi_tenant"
    setup_fresh_database(dbname)
    try:
        db_url = get_base_db_url(dbname)
        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                for m in ["001_initial_schema.sql", "002_alert_legacy_mongo_id.sql", "003_ai_analyst_rag.sql", "004_agent_runs_and_steps.sql"]:
                    apply_migration_file(cur, m)

                # Seed 2 products with child records
                cur.execute("INSERT INTO products (name, category) VALUES ('Almonds', 'Snacks') RETURNING id;")
                p1_id = cur.fetchone()[0]
                cur.execute("INSERT INTO products (name, category) VALUES ('Cashews', 'Snacks') RETURNING id;")
                p2_id = cur.fetchone()[0]

                cur.execute("INSERT INTO sales (product_id, sale_date, quantity) VALUES (%s, now(), 10);", (p1_id,))
                cur.execute("INSERT INTO sales (product_id, sale_date, quantity) VALUES (%s, now(), 20);", (p2_id,))

                # Create mapping table and map products to different tenants
                cur.execute("""
                    CREATE TABLE opspulse_tenant_mapping (
                        table_name VARCHAR(64) NOT NULL,
                        record_id UUID NOT NULL,
                        tenant_id VARCHAR(100) NOT NULL,
                        PRIMARY KEY (table_name, record_id)
                    );
                """)
                cur.execute("INSERT INTO opspulse_tenant_mapping VALUES ('products', %s, 'tenant-alpha');", (p1_id,))
                cur.execute("INSERT INTO opspulse_tenant_mapping VALUES ('products', %s, 'tenant-beta');", (p2_id,))

                # Apply migration 005 unchanged (no authoritative tenant set)
                apply_migration_file(cur, "005_tenant_isolation.sql")

                # Verify P1 and child sale inherited tenant-alpha
                cur.execute("SELECT tenant_id FROM products WHERE id = %s;", (p1_id,))
                assert cur.fetchone()[0] == "tenant-alpha"
                cur.execute("SELECT tenant_id FROM sales WHERE product_id = %s;", (p1_id,))
                assert cur.fetchone()[0] == "tenant-alpha"

                # Verify P2 and child sale inherited tenant-beta
                cur.execute("SELECT tenant_id FROM products WHERE id = %s;", (p2_id,))
                assert cur.fetchone()[0] == "tenant-beta"
                cur.execute("SELECT tenant_id FROM sales WHERE product_id = %s;", (p2_id,))
                assert cur.fetchone()[0] == "tenant-beta"
    finally:
        teardown_database(dbname)


def test_4_missing_mapping_fails_preflight_and_rolls_back():
    """Verify unmapped business records trigger preflight halt and clean transaction rollback."""
    dbname = "test_fixture_4_missing_map"
    setup_fresh_database(dbname)
    try:
        db_url = get_base_db_url(dbname)
        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                for m in ["001_initial_schema.sql", "002_alert_legacy_mongo_id.sql", "003_ai_analyst_rag.sql", "004_agent_runs_and_steps.sql"]:
                    apply_migration_file(cur, m)

                # Seed product without tenant mapping
                cur.execute("INSERT INTO products (name, category) VALUES ('Orphan SKU', 'Snacks');")

                # Applying migration 005 must raise PREFLIGHT HALT
                with pytest.raises(psycopg.Error) as exc_info:
                    apply_migration_file(cur, "005_tenant_isolation.sql")
                assert "PREFLIGHT HALT" in str(exc_info.value)

        # Fresh connection to verify rollback: products must NOT have tenant_id column
        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'tenant_id';")
                assert cur.fetchone() is None, "Rollback failed: products.tenant_id exists!"
    finally:
        teardown_database(dbname)


def test_5_cross_tenant_child_reference_fails_and_rolls_back():
    """Verify cross-tenant child/product references are blocked by integrity assertion and rolled back."""
    dbname = "test_fixture_5_cross_tenant"
    setup_fresh_database(dbname)
    try:
        db_url = get_base_db_url(dbname)
        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                for m in ["001_initial_schema.sql", "002_alert_legacy_mongo_id.sql", "003_ai_analyst_rag.sql", "004_agent_runs_and_steps.sql"]:
                    apply_migration_file(cur, m)

                cur.execute("INSERT INTO products (name, category) VALUES ('Product X', 'Hardware') RETURNING id;")
                p_id = cur.fetchone()[0]
                cur.execute("INSERT INTO sales (product_id, sale_date, quantity) VALUES (%s, now(), 5) RETURNING id;", (p_id,))
                s_id = cur.fetchone()[0]

                # Map product to tenant-A, but child sale to tenant-B
                cur.execute("""
                    CREATE TABLE opspulse_tenant_mapping (
                        table_name VARCHAR(64) NOT NULL,
                        record_id UUID NOT NULL,
                        tenant_id VARCHAR(100) NOT NULL,
                        PRIMARY KEY (table_name, record_id)
                    );
                """)
                cur.execute("INSERT INTO opspulse_tenant_mapping VALUES ('products', %s, 'tenant-A');", (p_id,))
                cur.execute("INSERT INTO opspulse_tenant_mapping VALUES ('sales', %s, 'tenant-B');", (s_id,))

                with pytest.raises(psycopg.Error) as exc_info:
                    apply_migration_file(cur, "005_tenant_isolation.sql")
                assert "CROSS-TENANT INTEGRITY VIOLATION" in str(exc_info.value)

        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'tenant_id';")
                assert cur.fetchone() is None, "Rollback failed: sales.tenant_id exists!"
    finally:
        teardown_database(dbname)


def test_6_duplicate_keys_prior_to_constraint_fails_and_rolls_back():
    """Verify duplicate daily sales are caught prior to unique constraint creation and rolled back."""
    dbname = "test_fixture_6_duplicates"
    setup_fresh_database(dbname)
    try:
        db_url = get_base_db_url(dbname)
        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                for m in ["001_initial_schema.sql", "002_alert_legacy_mongo_id.sql", "003_ai_analyst_rag.sql", "004_agent_runs_and_steps.sql"]:
                    apply_migration_file(cur, m)

                cur.execute("INSERT INTO products (name, category) VALUES ('Item Dup', 'Produce') RETURNING id;")
                p_id = cur.fetchone()[0]

                # Simulate dirty database: drop legacy constraint and insert duplicate date
                cur.execute("ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_product_id_sale_date_key;")
                cur.execute("INSERT INTO sales (product_id, sale_date, quantity) VALUES (%s, '2026-02-01', 5);", (p_id,))
                cur.execute("INSERT INTO sales (product_id, sale_date, quantity) VALUES (%s, '2026-02-01', 10);", (p_id,))

                cur.execute("SET opspulse.authoritative_tenant_id = 'tenant-dup';")
                with pytest.raises(psycopg.Error) as exc_info:
                    apply_migration_file(cur, "005_tenant_isolation.sql")
                assert "UNIQUE CONSTRAINT INTEGRITY VIOLATION" in str(exc_info.value)

        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'tenant_id';")
                assert cur.fetchone() is None, "Rollback failed: sales.tenant_id exists!"
    finally:
        teardown_database(dbname)


def test_7_dry_run_mode_rolls_back_without_changes():
    """Verify dry-run mode executes full DDL and backfill assertions but rolls back 100%."""
    dbname = "test_fixture_7_dry_run"
    setup_fresh_database(dbname)
    try:
        db_url = get_base_db_url(dbname)
        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                for m in ["001_initial_schema.sql", "002_alert_legacy_mongo_id.sql", "003_ai_analyst_rag.sql", "004_agent_runs_and_steps.sql"]:
                    apply_migration_file(cur, m)

                cur.execute("INSERT INTO products (name, category) VALUES ('Dry Run SKU', 'Dry Goods');")
                cur.execute("SET opspulse.authoritative_tenant_id = 'tenant-dryrun';")
                cur.execute("SET opspulse.dry_run = 'true';")

                with pytest.raises(psycopg.Error) as exc_info:
                    apply_migration_file(cur, "005_tenant_isolation.sql")
                assert "DRY RUN COMPLETE" in str(exc_info.value)

        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'tenant_id';")
                assert cur.fetchone() is None, "Dry run committed changes unexpectedly!"
    finally:
        teardown_database(dbname)


def test_8_reexecution_idempotency_is_safe():
    """Verify migration 005 can be safely executed repeatedly without errors or data loss."""
    dbname = "test_fixture_8_idempotency"
    setup_fresh_database(dbname)
    try:
        db_url = get_base_db_url(dbname)
        with psycopg.connect(db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                for m in ["001_initial_schema.sql", "002_alert_legacy_mongo_id.sql", "003_ai_analyst_rag.sql", "004_agent_runs_and_steps.sql"]:
                    apply_migration_file(cur, m)

                cur.execute("INSERT INTO products (name, category) VALUES ('Idempotent Product', 'Dairy');")
                cur.execute("SET opspulse.authoritative_tenant_id = 'tenant-idem';")

                # Run 1 (Live Commit)
                apply_migration_file(cur, "005_tenant_isolation.sql")

                # Run 2 (Re-execution on already-partitioned database)
                apply_migration_file(cur, "005_tenant_isolation.sql")

                # Verify data and constraints intact
                cur.execute("SELECT COUNT(*) FROM products WHERE tenant_id = 'tenant-idem';")
                assert cur.fetchone()[0] == 1

                cur.execute("SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'products' AND constraint_name = 'products_tenant_id_id_key';")
                assert cur.fetchone() is not None
    finally:
        teardown_database(dbname)


# -----------------------------------------------------------------------------
# Standalone CLI Runner
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    print("=====================================================================")
    print("OpsPulse Migration 005 Permanent PostgreSQL 16 + pgvector Test Suite")
    print("=====================================================================")
    url = get_safe_test_db_url()
    print(f"Target Database URL: {url}")
    available, msg = probe_test_database()
    if not available:
        print(f"ERROR: {msg}")
        print("\nTo start a local test database with pgvector, run:")
        print("  docker run -d --name opspulse-pgvector -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:pg16")
        sys.exit(1)

    print(f"PostgreSQL Status: {msg}\n")
    tests = [
        ("Test 1: Clean Empty Database (001-005 unchanged)", test_1_clean_empty_database_migrations_001_to_005),
        ("Test 2: Single-Tenant Historical Backfill", test_2_single_tenant_historical_backfill),
        ("Test 3: Multi-Tenant Mapping Table with Inheritance", test_3_multi_tenant_mapping_table_inheritance),
        ("Test 4: Missing Mapping Preflight Halt & Rollback", test_4_missing_mapping_fails_preflight_and_rolls_back),
        ("Test 5: Cross-Tenant Child Reference Fails & Rolls Back", test_5_cross_tenant_child_reference_fails_and_rolls_back),
        ("Test 6: Duplicate Key Collision Fails & Rolls Back", test_6_duplicate_keys_prior_to_constraint_fails_and_rolls_back),
        ("Test 7: Dry-Run Mode Inspection & Rollback", test_7_dry_run_mode_rolls_back_without_changes),
        ("Test 8: Re-Execution Idempotency", test_8_reexecution_idempotency_is_safe),
    ]

    passed = 0
    for name, test_fn in tests:
        print(f"Running {name}...")
        try:
            test_fn()
            print("  -> PASS\n")
            passed += 1
        except Exception as e:
            print(f"  -> FAIL: {e}\n")
            raise

    print("=====================================================================")
    print(f"ALL {passed}/{len(tests)} MIGRATION 005 PGVECTOR TESTS PASSED SUCCESSFULLY!")
    print("=====================================================================")
