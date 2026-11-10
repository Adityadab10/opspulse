"""Comprehensive PostgreSQL Integration Test Suite for FastAPI Tenant Isolation & LangGraph Persistence.

Validates:
1. Safety Guardrails: Rejection of non-local hosts and forbidden remote/production keywords.
2. Deterministic Tools Tenant Isolation: Scoped analytics across products, sales, inventory, KPIs, and forecasts.
3. RAG Vector Isolation with real pgvector: Scoped retrieval (tenant_id = %s OR tenant_id IS NULL) using 384-d vectors.
4. LangGraph Checkpoint Persistence Across Process/Application Restart: Real PostgresSaver checkpoint survival.
5. LangGraph Thread Namespacing: Prevention of cross-tenant thread resumption.
6. LangGraph Production Fail-Closed Semantics: Immediate RuntimeError when production DB config is invalid/unreachable.
7. RunTracker Lifecycle Persistence: PostgreSQL persistence of agent_runs and agent_steps across tracker instances.
8. FastAPI Endpoint Security & Tenant Header Propagation: Strict validation of X-ML-Internal-Token and X-Tenant-ID.

Execution:
  - Pytest: pytest ml-service/tests/test_fastapi_tenant_isolation_postgres.py -v
  - Standalone: python ml-service/tests/test_fastapi_tenant_isolation_postgres.py
"""

from __future__ import annotations

import datetime
from decimal import Decimal
import json
import os
import sys
from typing import Any, Generator
import unittest.mock as mock
import urllib.parse
import uuid

import numpy as np
import psycopg
import pytest

# Ensure ml-service root is on sys.path
_ML_SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, _ML_SERVICE_DIR)

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
# Database Provisioning and Migration Helpers
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


def apply_migrations(cur: psycopg.Cursor) -> None:
    """Apply migrations 001-005 unchanged in order."""
    repo_root = os.path.abspath(os.path.join(_ML_SERVICE_DIR, ".."))
    migrations = [
        "001_initial_schema.sql",
        "002_alert_legacy_mongo_id.sql",
        "003_ai_analyst_rag.sql",
        "004_agent_runs_and_steps.sql",
        "005_tenant_isolation.sql",
    ]
    for mig in migrations:
        path = os.path.join(repo_root, "db", "migrations", mig)
        with open(path, "r", encoding="utf-8") as f:
            cur.execute(f.read())


def make_unit_vector(active_index: int = 0, dim: int = 384) -> str:
    """Create a normalized 384-dimensional vector string for pgvector testing."""
    vec = [0.0] * dim
    vec[active_index % dim] = 1.0
    return "[" + ",".join(str(x) for x in vec) + "]"


@pytest.fixture
def isolated_db() -> Generator[str, None, None]:
    """Fixture providing a fresh isolated database with full schema and reset caches."""
    dbname = f"test_iso_{uuid.uuid4().hex[:10]}"
    setup_fresh_database(dbname)
    db_url = get_base_db_url(dbname)

    # Apply migrations 001-005
    with psycopg.connect(db_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            apply_migrations(cur)

    # Point application services to isolated test database
    os.environ["DATABASE_URL"] = db_url
    import postgresService
    postgresService.DATABASE_URL = db_url

    # Clear cached schema lookups
    postgresService.table_has_tenant_id.cache_clear()
    from tools import db as tools_db
    tools_db._check_table_has_tenant_id.cache_clear()
    import rag_service
    rag_service._check_table_has_tenant_id.cache_clear()

    yield db_url

    teardown_database(dbname)


# -----------------------------------------------------------------------------
# 1. Safety Guardrails Unit Tests
# -----------------------------------------------------------------------------

def test_guardrails_prevent_remote_and_production_connections(monkeypatch):
    """Verify that get_safe_test_db_url rejects remote hosts and production URLs."""
    # Forbidden host
    monkeypatch.setenv("TEST_DATABASE_URL", "postgresql://postgres@db.production.company.com:5432/postgres")
    with pytest.raises(RuntimeError, match="outside permitted local test hosts"):
        get_safe_test_db_url()

    # Forbidden keywords
    forbidden_examples = [
        "postgresql://postgres:pass@127.0.0.1:5432/supabase_db",
        "postgresql://postgres:pass@localhost:5432/aws_prod",
        "postgresql://postgres:pass@localhost:6543/pooler",
        "postgresql://postgres:pass@127.0.0.1:5432/staging_db",
    ]
    for bad_url in forbidden_examples:
        monkeypatch.setenv("TEST_DATABASE_URL", bad_url)
        with pytest.raises(RuntimeError, match="contains forbidden remote/production keyword"):
            get_safe_test_db_url()


# -----------------------------------------------------------------------------
# 2. Deterministic Tools Tenant Isolation Integration Tests
# -----------------------------------------------------------------------------

def test_deterministic_tools_tenant_isolation(isolated_db: str):
    """Verify all deterministic tools enforce strict tenant isolation on a live PostgreSQL database."""
    alpha_p1 = str(uuid.uuid4())
    alpha_p2 = str(uuid.uuid4())
    beta_p1 = str(uuid.uuid4())

    # Seed products, sales, predictions, alerts
    with psycopg.connect(isolated_db, autocommit=True) as conn:
        with conn.cursor() as cur:
            # Tenant-alpha products
            cur.execute("""
                INSERT INTO products (id, name, category, tenant_id)
                VALUES (%s, 'Alpha Almond Butter', 'Pantry', 'tenant-alpha'),
                       (%s, 'Alpha Cashew Butter', 'Pantry', 'tenant-alpha');
            """, (alpha_p1, alpha_p2))

            # Tenant-beta products
            cur.execute("""
                INSERT INTO products (id, name, category, tenant_id)
                VALUES (%s, 'Beta Hazelnut Spread', 'Pantry', 'tenant-beta');
            """, (beta_p1,))

            # Sales: 10 + 20 = 30 for Alpha p1, 15 for Alpha p2; 50 for Beta p1
            cur.execute("""
                INSERT INTO sales (product_id, sale_date, quantity, tenant_id)
                VALUES (%s, '2026-05-01', 10, 'tenant-alpha'),
                       (%s, '2026-05-02', 20, 'tenant-alpha'),
                       (%s, '2026-05-02', 15, 'tenant-alpha'),
                       (%s, '2026-05-02', 50, 'tenant-beta');
            """, (alpha_p1, alpha_p1, alpha_p2, beta_p1))

            # Predictions
            cur.execute("""
                INSERT INTO predictions (product_id, predicted_demand, rule_prediction, ml_prediction,
                                         adjusted_prediction, avg_sales, percent_change, confidence,
                                         season_tag, decision, impact, prediction_source, tenant_id)
                VALUES (%s, 35, 30, 40, 36, 15.0, 10.0, 'High', 'normal', 'increase', 'increase', 'ml', 'tenant-alpha'),
                       (%s, 55, 50, 60, 56, 50.0, 5.0, 'High', 'normal', 'maintain', 'neutral', 'ml', 'tenant-beta');
            """, (alpha_p1, beta_p1))

            # Alerts
            cur.execute("""
                INSERT INTO alerts (product_id, type, message, severity, percent_change, is_active, tenant_id)
                VALUES (%s, 'HIGH_DEMAND', 'Surge in demand for Almond Butter', 'HIGH', 25.0, true, 'tenant-alpha'),
                       (%s, 'LOW_DEMAND', 'Drop in Hazelnut demand', 'LOW', -10.0, true, 'tenant-beta');
            """, (alpha_p1, beta_p1))

    from tools import default_registry
    from tools.sales import get_sales_summary
    from tools.products import get_product_snapshot
    from tools.inventory import get_inventory_risk
    from tools.kpis import get_business_kpis
    from tools.forecasting import get_demand_forecast
    from contracts.tools import (
        SalesSummaryInput,
        ProductSnapshotInput,
        InventoryRiskInput,
        BusinessKpisInput,
        DemandForecastInput,
    )

    # 1. Sales Summary Isolation
    alpha_sales = get_sales_summary("tenant-alpha", SalesSummaryInput())
    assert alpha_sales.success is True
    assert alpha_sales.total_sales_volume == 45  # 10 + 20 + 15
    assert alpha_sales.record_count == 3
    assert alpha_sales.unique_products_sold == 2

    beta_sales = get_sales_summary("tenant-beta", SalesSummaryInput())
    assert beta_sales.success is True
    assert beta_sales.total_sales_volume == 50
    assert beta_sales.record_count == 1
    assert beta_sales.unique_products_sold == 1

    # Cross-tenant product ID query in sales summary
    cross_sales = get_sales_summary("tenant-beta", SalesSummaryInput(product_id=alpha_p1))
    assert cross_sales.success is True
    assert cross_sales.total_sales_volume == 0
    assert cross_sales.record_count == 0

    # 2. Product Snapshot Isolation
    alpha_snap = get_product_snapshot("tenant-alpha", ProductSnapshotInput(product_id=alpha_p1))
    assert alpha_snap.success is True
    assert alpha_snap.product_found is True
    assert alpha_snap.product["name"] == "Alpha Almond Butter"
    assert alpha_snap.sales_history_rows == 2
    assert alpha_snap.latest_prediction["decision"] == "increase"
    assert len(alpha_snap.active_alerts) == 1

    # Cross-tenant product snapshot: Alpha attempts to view Beta product
    cross_snap_alpha = get_product_snapshot("tenant-alpha", ProductSnapshotInput(product_id=beta_p1))
    assert cross_snap_alpha.success is True
    assert cross_snap_alpha.product_found is False

    # Beta attempts to view Alpha product
    cross_snap_beta = get_product_snapshot("tenant-beta", ProductSnapshotInput(product_id=alpha_p1))
    assert cross_snap_beta.success is True
    assert cross_snap_beta.product_found is False

    # 3. Inventory Risk Isolation
    alpha_risk = get_inventory_risk("tenant-alpha", InventoryRiskInput())
    assert alpha_risk.success is True
    assert alpha_risk.total_active_alerts == 1
    assert alpha_risk.risks[0]["product_name"] == "Alpha Almond Butter"
    assert alpha_risk.risks[0]["severity"] == "HIGH"

    beta_risk = get_inventory_risk("tenant-beta", InventoryRiskInput())
    assert beta_risk.success is True
    assert beta_risk.total_active_alerts == 1
    assert beta_risk.risks[0]["product_name"] == "Beta Hazelnut Spread"
    assert beta_risk.risks[0]["severity"] == "LOW"

    # 4. Business KPIs Isolation
    alpha_kpis = get_business_kpis("tenant-alpha", BusinessKpisInput())
    assert alpha_kpis.success is True
    assert alpha_kpis.total_products == 2
    assert alpha_kpis.total_sales_volume == 45
    assert alpha_kpis.active_alerts == 1

    beta_kpis = get_business_kpis("tenant-beta", BusinessKpisInput())
    assert beta_kpis.success is True
    assert beta_kpis.total_products == 1
    assert beta_kpis.total_sales_volume == 50
    assert beta_kpis.active_alerts == 1

    # 5. Demand Forecast Isolation
    alpha_fc = get_demand_forecast("tenant-alpha", DemandForecastInput(product_id=alpha_p1))
    assert alpha_fc.success is True
    assert alpha_fc.product_name == "Alpha Almond Butter"

    # Cross-tenant demand forecast fails closed
    cross_fc = get_demand_forecast("tenant-beta", DemandForecastInput(product_id=alpha_p1))
    assert cross_fc.success is False
    assert "Product not found" in cross_fc.error

    # 6. Tool Registry Security Gate: Missing Tenant ID Fails Closed
    with pytest.raises(PermissionError, match="Trusted tenant_id is required"):
        default_registry.execute(
            tool_name="get_sales_summary",
            agent_name="supervisor",
            tenant_id="",  # Missing tenant context
            raw_input={},
        )


# -----------------------------------------------------------------------------
# 3. RAG Vector Isolation with pgvector Integration Tests
# -----------------------------------------------------------------------------

def test_rag_vector_document_retrieval_isolation_pgvector(isolated_db: str, monkeypatch):
    """Verify that RAG document chunk retrieval with real pgvector enforces tenant scoping."""
    # Vector embeddings: unit vectors along orthogonal dimensions
    shared_vec = make_unit_vector(0, 384)
    alpha_vec = make_unit_vector(1, 384)
    beta_vec = make_unit_vector(2, 384)

    with psycopg.connect(isolated_db, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ai_document_chunks (document_key, title, content, content_hash, embedding, tenant_id)
                VALUES ('doc_shared_policies', 'Platform Policies', 'Shared handbook content', 'h_shared', %s::vector, NULL),
                       ('doc_alpha_confidential', 'Alpha Strategy', 'Alpha internal strategy', 'h_alpha', %s::vector, 'tenant-alpha'),
                       ('doc_beta_confidential', 'Beta Secret', 'Beta secret roadmap', 'h_beta', %s::vector, 'tenant-beta');
            """, (shared_vec, alpha_vec, beta_vec))

    import rag_service

    # Mock embedding encoder to return 384-dimensional unit vector along index 1 (matching alpha)
    class DeterministicMockEncoder:
        def encode(self, text: str):
            v = np.zeros(384, dtype=np.float32)
            v[1] = 1.0  # Closest to alpha_vec (distance 0), next to shared_vec
            return v

    monkeypatch.setitem(sys.modules, "sentence_transformers", mock.MagicMock())
    monkeypatch.setattr(rag_service, "_embedding_model", lambda _: DeterministicMockEncoder())

    # 1. Query as tenant-alpha: MUST return alpha private docs + shared docs; MUST NOT return beta docs
    alpha_res = rag_service._document_evidence("What is the strategy?", tenant_id="tenant-alpha")
    assert alpha_res["available"] is True
    retrieved_keys_alpha = [r["document_key"] for r in alpha_res["rows"]]

    assert "doc_alpha_confidential" in retrieved_keys_alpha
    assert "doc_shared_policies" in retrieved_keys_alpha
    assert "doc_beta_confidential" not in retrieved_keys_alpha, "CRITICAL: tenant-alpha leaked tenant-beta private document!"

    # 2. Query as tenant-beta: MUST return beta private docs + shared docs; MUST NOT return alpha docs
    beta_res = rag_service._document_evidence("What is the secret?", tenant_id="tenant-beta")
    assert beta_res["available"] is True
    retrieved_keys_beta = [r["document_key"] for r in beta_res["rows"]]

    assert "doc_beta_confidential" in retrieved_keys_beta
    assert "doc_shared_policies" in retrieved_keys_beta
    assert "doc_alpha_confidential" not in retrieved_keys_beta, "CRITICAL: tenant-beta leaked tenant-alpha private document!"

    # 3. Query without tenant_id: MUST return ONLY shared platform docs (tenant_id IS NULL)
    anon_res = rag_service._document_evidence("What are the policies?", tenant_id=None)
    assert anon_res["available"] is True
    retrieved_keys_anon = [r["document_key"] for r in anon_res["rows"]]

    assert "doc_shared_policies" in retrieved_keys_anon
    assert "doc_alpha_confidential" not in retrieved_keys_anon
    assert "doc_beta_confidential" not in retrieved_keys_anon

    # 4. Verify pgvector cosine similarity calculation
    # Vector matching alpha_vec exactly should yield similarity = 1.0
    alpha_row = next(r for r in alpha_res["rows"] if r["document_key"] == "doc_alpha_confidential")
    assert pytest.approx(float(alpha_row["similarity"]), rel=1e-3) == 1.0


# -----------------------------------------------------------------------------
# 4. LangGraph Checkpoint Persistence Across Process/Application Restart
# -----------------------------------------------------------------------------

def test_langgraph_postgres_checkpointer_persistence_across_restart(isolated_db: str):
    """Verify LangGraph PostgresSaver persists state to PostgreSQL and survives full application restart."""
    from workflow.minimal_graph import CheckpointerManager, build_minimal_graph

    # 1. Initialize checkpointer manager against isolated database
    mgr1 = CheckpointerManager(database_url=isolated_db, checkpointer_type="postgres")
    mgr1.initialize()
    saver1 = mgr1.get_saver()

    # Verify checkpointer tables exist in PostgreSQL
    with psycopg.connect(isolated_db) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_name IN ('checkpoints', 'checkpoint_blobs', 'checkpoint_writes')
            """)
            tables = {r[0] for r in cur.fetchall()}
            assert {"checkpoints", "checkpoint_blobs", "checkpoint_writes"}.issubset(tables)

    # 2. Build graph and execute minimal pipeline for tenant-alpha
    graph1 = build_minimal_graph(checkpointer=saver1)
    run_id = str(uuid.uuid4())
    thread_id = "thread-persist-test-100"
    namespaced_thread = CheckpointerManager.namespace_thread_id("tenant-alpha", thread_id)
    config = {"configurable": {"thread_id": namespaced_thread}}

    initial_state = {
        "run_id": run_id,
        "thread_id": thread_id,
        "tenant_id": "tenant-alpha",
        "user_id": "user-alice",
        "question": "What is our current sales summary?",
        "trigger_type": "on_demand",
        "trigger_metadata": {},
        "conversation_context": [],
    }

    final_state1 = graph1.invoke(initial_state, config=config)
    assert final_state1["status"] in ("completed", "insufficient_evidence")
    assert final_state1["tenant_id"] == "tenant-alpha"

    # 3. Inspect PostgreSQL checkpointer tables directly
    with psycopg.connect(isolated_db) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM checkpoints WHERE thread_id = %s;", (namespaced_thread,))
            checkpoints_count = cur.fetchone()[0]
            assert checkpoints_count > 0, "No checkpoints recorded in PostgreSQL table 'checkpoints'!"

    # 4. Cleanly simulate process shutdown / termination
    mgr1.close()
    assert mgr1._pool is None

    # 5. Simulate application restart: instantiate a brand new CheckpointerManager on the same database
    mgr2 = CheckpointerManager(database_url=isolated_db, checkpointer_type="postgres")
    mgr2.initialize()
    saver2 = mgr2.get_saver()

    # 6. Retrieve state from the new checkpointer instance
    resumed_tuple = saver2.get_tuple(config)
    assert resumed_tuple is not None, "Failed to retrieve checkpoint from PostgreSQL after restart!"
    saved_state = resumed_tuple.checkpoint["channel_values"]
    assert saved_state["run_id"] == run_id
    assert saved_state["tenant_id"] == "tenant-alpha"
    assert saved_state["question"] == "What is our current sales summary?"
    assert saved_state["status"] == final_state1["status"]

    mgr2.close()


# -----------------------------------------------------------------------------
# 5. LangGraph Thread Namespacing Prevents Cross-Tenant Resumption
# -----------------------------------------------------------------------------

def test_langgraph_thread_namespacing_prevents_cross_tenant_resumption(isolated_db: str):
    """Verify that tenant namespacing ({tenant_id}:{thread_id}) blocks cross-tenant thread resumption."""
    from workflow.minimal_graph import CheckpointerManager, build_minimal_graph

    mgr = CheckpointerManager(database_url=isolated_db, checkpointer_type="postgres")
    mgr.initialize()
    saver = mgr.get_saver()
    graph = build_minimal_graph(checkpointer=saver)

    shared_thread_name = "quarterly-review-thread"

    # 1. Tenant-alpha runs investigation
    alpha_thread = CheckpointerManager.namespace_thread_id("tenant-alpha", shared_thread_name)
    assert alpha_thread == f"tenant-alpha:{shared_thread_name}"

    graph.invoke(
        {
            "run_id": str(uuid.uuid4()),
            "thread_id": shared_thread_name,
            "tenant_id": "tenant-alpha",
            "user_id": "user-alpha",
            "question": "Alpha investigation",
            "trigger_type": "on_demand",
            "trigger_metadata": {},
            "conversation_context": [],
        },
        config={"configurable": {"thread_id": alpha_thread}},
    )

    # 2. Tenant-beta attempts to resume or inspect the same logical thread_id
    beta_thread = CheckpointerManager.namespace_thread_id("tenant-beta", shared_thread_name)
    assert beta_thread == f"tenant-beta:{shared_thread_name}"
    assert beta_thread != alpha_thread

    # Tenant-beta's checkpoint tuple must be None (isolated)
    beta_tuple = saver.get_tuple({"configurable": {"thread_id": beta_thread}})
    assert beta_tuple is None, "CRITICAL: tenant-beta resumed tenant-alpha's thread checkpoint!"

    mgr.close()


# -----------------------------------------------------------------------------
# 6. LangGraph Production Fail-Closed Semantics
# -----------------------------------------------------------------------------

def test_langgraph_checkpointer_fails_closed_in_production(monkeypatch):
    """Verify CheckpointerManager raises RuntimeError in production mode instead of silently falling back."""
    from workflow.minimal_graph import CheckpointerManager

    monkeypatch.setenv("ENVIRONMENT", "production")

    # Missing DATABASE_URL in production raises RuntimeError
    mgr_no_db = CheckpointerManager(database_url="", checkpointer_type="postgres")
    with pytest.raises(RuntimeError, match="requires DATABASE_URL to be set in production"):
        mgr_no_db.initialize()

    # Unreachable database in production raises RuntimeError (fast 2s timeout)
    mgr_bad_db = CheckpointerManager(
        database_url="postgresql://postgres@127.0.0.1:54999/unreachable?connect_timeout=2",
        checkpointer_type="postgres",
    )
    with pytest.raises(RuntimeError, match="Failed to initialize PostgresSaver in production"):
        mgr_bad_db.initialize()


# -----------------------------------------------------------------------------
# 7. RunTracker PostgreSQL Persistence & Tenant Scoping Across Restarts
# -----------------------------------------------------------------------------

def test_run_tracker_postgres_persistence_and_tenant_scoping(isolated_db: str):
    """Verify that agent_runs and agent_steps persist in PostgreSQL and filter strictly by tenant."""
    from tracking.tracker import RunTracker
    from tools.db import DatabaseAdapter

    tracker = RunTracker(db=DatabaseAdapter())

    alpha_run = str(uuid.uuid4())
    beta_run = str(uuid.uuid4())

    # Create run and step for tenant-alpha
    tracker.create_run(
        tenant_id="tenant-alpha",
        user_id="alice",
        question="Analyze sales",
        run_id=alpha_run,
    )
    tracker.record_step(
        run_id=alpha_run,
        tenant_id="tenant-alpha",
        step_number=1,
        agent_name="business_analyst",
        node_name="execute_tool",
        status="completed",
        input_payload={"window_days": 30},
        output_payload={"volume": 120},
    )
    tracker.update_run_status(
        run_id=alpha_run,
        status="completed",
        final_answer="Sales are strong.",
        confidence=0.95,
    )

    # Create run and step for tenant-beta
    tracker.create_run(
        tenant_id="tenant-beta",
        user_id="bob",
        question="Analyze inventory",
        run_id=beta_run,
    )
    tracker.record_step(
        run_id=beta_run,
        tenant_id="tenant-beta",
        step_number=1,
        agent_name="inventory_agent",
        node_name="execute_tool",
        status="completed",
    )

    # Verify rows in PostgreSQL table directly
    with psycopg.connect(isolated_db) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT tenant_id, status FROM agent_runs WHERE id = %s;", (alpha_run,))
            row = cur.fetchone()
            assert row is not None
            assert row[0] == "tenant-alpha"
            assert row[1] == "completed"

            cur.execute("SELECT tenant_id FROM agent_steps WHERE run_id = %s;", (alpha_run,))
            step_row = cur.fetchone()
            assert step_row is not None
            assert step_row[0] == "tenant-alpha"

    # Simulate restart by instantiating a brand new RunTracker with empty in-memory caches
    fresh_tracker = RunTracker(db=DatabaseAdapter())

    # 1. Tenant-alpha successfully retrieves its own run and steps from PostgreSQL
    alpha_retrieved = fresh_tracker.get_run(alpha_run, "tenant-alpha")
    assert alpha_retrieved is not None
    assert alpha_retrieved["tenant_id"] == "tenant-alpha"
    assert alpha_retrieved["question"] == "Analyze sales"

    alpha_steps = fresh_tracker.get_steps(alpha_run, "tenant-alpha")
    assert len(alpha_steps) == 1
    assert alpha_steps[0]["agent_name"] == "business_analyst"

    # 2. Cross-tenant queries fail closed: Tenant-beta cannot see tenant-alpha's run or steps
    cross_retrieved = fresh_tracker.get_run(alpha_run, "tenant-beta")
    assert cross_retrieved is None, "CRITICAL: tenant-beta accessed tenant-alpha run from database!"

    cross_steps = fresh_tracker.get_steps(alpha_run, "tenant-beta")
    assert len(cross_steps) == 0, "CRITICAL: tenant-beta accessed tenant-alpha steps from database!"


# -----------------------------------------------------------------------------
# 8. FastAPI Endpoints Tenant Isolation & Authentication Integration Tests
# -----------------------------------------------------------------------------

def test_fastapi_endpoints_tenant_isolation_and_auth(isolated_db: str, monkeypatch):
    """Verify FastAPI endpoints enforce trusted identity headers and tenant isolation."""
    from fastapi.testclient import TestClient
    import app

    test_token = "valid-test-ml-token-777"
    monkeypatch.setenv("ML_ANALYST_INTERNAL_TOKEN", test_token)

    # Seed product and sales for tenant-alpha
    p_alpha = str(uuid.uuid4())
    p_beta = str(uuid.uuid4())
    with psycopg.connect(isolated_db, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO products (id, name, category, tenant_id)
                VALUES (%s, 'Alpha Coffee', 'Beverages', 'tenant-alpha'),
                       (%s, 'Beta Tea', 'Beverages', 'tenant-beta');
            """, (p_alpha, p_beta))
            cur.execute("""
                INSERT INTO sales (product_id, sale_date, quantity, tenant_id)
                VALUES (%s, '2026-05-10', 88, 'tenant-alpha'),
                       (%s, '2026-05-10', 22, 'tenant-beta');
            """, (p_alpha, p_beta))

    client = TestClient(app.app)

    # 1. Unauthenticated request rejected (missing X-ML-Internal-Token)
    unauth_resp = client.post(
        "/api/v1/tools/execute",
        headers={"X-Tenant-ID": "tenant-alpha", "X-User-ID": "user-1"},
        json={"tool_name": "get_sales_summary", "agent_name": "supervisor", "parameters": {}},
    )
    assert unauth_resp.status_code == 401

    # 2. Request missing X-Tenant-ID rejected
    no_tenant_resp = client.post(
        "/api/v1/tools/execute",
        headers={"X-ML-Internal-Token": test_token, "X-User-ID": "user-1"},
        json={"tool_name": "get_sales_summary", "agent_name": "supervisor", "parameters": {}},
    )
    assert no_tenant_resp.status_code == 401

    # 3. Authorized request for tenant-alpha returns alpha-only data
    alpha_resp = client.post(
        "/api/v1/tools/execute",
        headers={
            "X-ML-Internal-Token": test_token,
            "X-Tenant-ID": "tenant-alpha",
            "X-User-ID": "user-alpha-1",
        },
        json={"tool_name": "get_sales_summary", "agent_name": "supervisor", "parameters": {}},
    )
    assert alpha_resp.status_code == 200
    alpha_data = alpha_resp.json()
    assert alpha_data["success"] is True
    assert alpha_data["total_sales_volume"] == 88

    # 4. Authorized request for tenant-beta returns beta-only data
    beta_resp = client.post(
        "/api/v1/tools/execute",
        headers={
            "X-ML-Internal-Token": test_token,
            "X-Tenant-ID": "tenant-beta",
            "X-User-ID": "user-beta-1",
        },
        json={"tool_name": "get_sales_summary", "agent_name": "supervisor", "parameters": {}},
    )
    assert beta_resp.status_code == 200
    beta_data = beta_resp.json()
    assert beta_data["success"] is True
    assert beta_data["total_sales_volume"] == 22

    # 5. Unauthorized agent rejected (inventory_agent calling business_analyst-only tool)
    forbidden_resp = client.post(
        "/api/v1/tools/execute",
        headers={
            "X-ML-Internal-Token": test_token,
            "X-Tenant-ID": "tenant-alpha",
            "X-User-ID": "user-alpha-1",
        },
        json={"tool_name": "compare_sales_periods", "agent_name": "inventory_agent", "parameters": {}},
    )
    assert forbidden_resp.status_code == 403

    # 6. Agent pipeline execution endpoint
    run_resp = client.post(
        "/api/v1/agents/run",
        headers={
            "X-ML-Internal-Token": test_token,
            "X-Tenant-ID": "tenant-alpha",
            "X-User-ID": "user-alpha-1",
        },
        json={"question": "What are our overall sales?"},
    )
    assert run_resp.status_code == 200
    run_data = run_resp.json()
    assert run_data["tenant_id"] == "tenant-alpha"
    assert "status" in run_data


# -----------------------------------------------------------------------------
# Standalone Execution Runner
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    if not DB_AVAILABLE:
        print(f"[SKIP] PostgreSQL pgvector instance not available: {DB_SKIP_REASON}")
        sys.exit(0)

    print("Executing FastAPI Tenant Isolation & LangGraph Persistence Integration Tests...")
    exit_code = pytest.main([__file__, "-v", "-s"])
    sys.exit(exit_code)
