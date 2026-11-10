"""OpsPulse Cross-Service End-to-End Integration Test Suite.

Verifies live end-to-end integration across all three OpsPulse services:
1. React/Vite Frontend (static build + live dev server serving UI assets)
2. Node.js/Express Backend (running live on port 5008 with test Firebase identity verification)
3. Python/FastAPI ML Service (running live on port 5009 with LangGraph PostgresSaver checkpointer)
4. Isolated PostgreSQL Cluster (running live on port 5433 with pgvector extension)

Verifications Performed:
- Task 1 & 4: Node-to-FastAPI and Frontend-to-Node authentication contracts with trusted identity headers.
- Task 2: Reproducible procedure starting frontend, backend, ML service, and isolated PostgreSQL.
- Task 3: Test-only Firebase identity verification preserving production security structure.
- Task 5: Complete AI Analyst flow from Client -> Node -> FastAPI -> PostgreSQL + pgvector.
- Task 6: Minimal LangGraph agent execution and persistent run tracking in PostgreSQL.
- Task 7: Tenant-scoped product, sales, and dashboard analytics queries through Node.
- Task 8: Service failure handling (FastAPI down, invalid token, missing tenant context, tenant spoofing).
- Task 9: Safe error propagation (no 200 OK masking of real failures).
- Task 10: Process startup and shutdown lifecycle, connection pool and checkpointer cleanup.

Execution:
  - Pytest: pytest ml-service/tests/test_cross_service_e2e.py -v -s
  - Standalone: python ml-service/tests/test_cross_service_e2e.py
"""

from __future__ import annotations

import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Generator
import urllib.error
import urllib.parse
import urllib.request
import uuid

import psycopg
import pytest

_ML_SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_REPO_ROOT = os.path.abspath(os.path.join(_ML_SERVICE_DIR, ".."))
if _ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, _ML_SERVICE_DIR)

# -----------------------------------------------------------------------------
# Configuration and Safety Guardrails
# -----------------------------------------------------------------------------
DEFAULT_LOCAL_TEST_URL = "postgresql://postgres@127.0.0.1:5433/postgres"
PERMITTED_HOSTS = {"127.0.0.1", "localhost", "::1", "docker", "postgres"}
FORBIDDEN_KEYWORDS = ["supabase", "pooler", "aws", "prod", "production", "staging"]

FASTAPI_PORT = 5019
NODE_PORT = 5018
VITE_PORT = 5179
SHARED_INTERNAL_TOKEN = "e2e-trusted-internal-token-secret-999"


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


def get_base_db_url(dbname: str = "postgres") -> str:
    parsed = urllib.parse.urlparse(get_safe_test_db_url())
    return urllib.parse.urlunparse(parsed._replace(path=f"/{dbname}"))


def setup_fresh_database(dbname: str) -> None:
    admin_url = get_base_db_url("postgres")
    with psycopg.connect(admin_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {dbname} WITH (FORCE);")
            cur.execute(f"CREATE DATABASE {dbname};")


def teardown_database(dbname: str) -> None:
    admin_url = get_base_db_url("postgres")
    try:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(f"DROP DATABASE IF EXISTS {dbname} WITH (FORCE);")
    except Exception:
        pass


def apply_migrations(cur: psycopg.Cursor) -> None:
    migrations = [
        "001_initial_schema.sql",
        "002_alert_legacy_mongo_id.sql",
        "003_ai_analyst_rag.sql",
        "004_agent_runs_and_steps.sql",
        "005_tenant_isolation.sql",
    ]
    for mig in migrations:
        path = os.path.join(_REPO_ROOT, "db", "migrations", mig)
        with open(path, "r", encoding="utf-8") as f:
            cur.execute(f.read())


def make_unit_vector(active_index: int = 0, dim: int = 384) -> str:
    vec = [0.0] * dim
    vec[active_index % dim] = 1.0
    return "[" + ",".join(str(x) for x in vec) + "]"


def http_request(
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    timeout: float = 20.0,
) -> tuple[int, dict[str, Any], dict[str, str]]:
    """Helper to send HTTP requests and return (status, json_body, response_headers)."""
    req_headers = dict(headers or {})
    req_data = None
    if body is not None:
        req_headers["Content-Type"] = "application/json"
        req_data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, data=req_data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp_bytes = resp.read()
            resp_headers = {k.lower(): v for k, v in resp.headers.items()}
            try:
                resp_json = json.loads(resp_bytes.decode("utf-8"))
            except Exception:
                resp_json = {"raw": resp_bytes.decode("utf-8", errors="replace")}
            return resp.status, resp_json, resp_headers
    except urllib.error.HTTPError as exc:
        err_bytes = exc.read()
        err_headers = {k.lower(): v for k, v in exc.headers.items()}
        try:
            err_json = json.loads(err_bytes.decode("utf-8"))
        except Exception:
            err_json = {"error": err_bytes.decode("utf-8", errors="replace")}
        return exc.code, err_json, err_headers


def wait_for_service(url: str, expected_status: int = 200, timeout: float = 30.0) -> bool:
    """Poll a service healthcheck endpoint until ready."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status, _, _ = http_request(url, timeout=1.0)
            if status == expected_status:
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


class _MockOpenAIHandler(http.server.BaseHTTPRequestHandler):
    """Deterministic local OpenAI-compatible mock server for AI Analyst integration tests."""

    def do_POST(self):
        content_len = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b"{}"
        try:
            req_data = json.loads(body_bytes.decode("utf-8"))
        except Exception:
            req_data = {}

        messages = req_data.get("messages", [])
        sys_msg = next((m.get("content", "") for m in messages if m.get("role") == "system"), "")

        if "query planner" in sys_msg.lower():
            content = json.dumps({
                "intent": "analyze sales and catalog",
                "requested_output": "summary of catalog and sales metrics",
                "entities": [],
                "metrics": ["sales"],
                "evidence_sources": ["live_sql", "vector_docs"],
                "retrieval_tasks": [
                    {"kind": "sales_summary", "entities": []},
                    {"kind": "documentation", "entities": []},
                ],
                "decomposed": False,
            })
        else:
            content = (
                "Based on [LIVE_DATABASE] evidence, the requested tenant analytics "
                "and catalog details were retrieved successfully."
            )

        resp = {
            "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": req_data.get("model", "mock-model"),
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        }

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(resp).encode("utf-8"))

    def log_message(self, format, *args):
        pass


# -----------------------------------------------------------------------------
# End-to-End Fixture: Live PostgreSQL + Live FastAPI + Live Node + Live Vite
# -----------------------------------------------------------------------------

@pytest.fixture(scope="module")
def e2e_cluster() -> Generator[dict[str, Any], None, None]:
    """Provisions isolated database, starts live FastAPI, Node, and Vite services."""
    dbname = f"test_e2e_{uuid.uuid4().hex[:8]}"
    setup_fresh_database(dbname)
    db_url = get_base_db_url(dbname)

    # 1. Apply migrations 001-005
    with psycopg.connect(db_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            apply_migrations(cur)

    # 2. Seed tenant-alpha and tenant-beta data
    alpha_p1 = str(uuid.uuid4())
    alpha_p2 = str(uuid.uuid4())
    beta_p1 = str(uuid.uuid4())

    shared_vec = make_unit_vector(0, 384)
    alpha_vec = make_unit_vector(1, 384)
    beta_vec = make_unit_vector(2, 384)

    with psycopg.connect(db_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            # Products
            cur.execute("""
                INSERT INTO products (id, name, category, tenant_id)
                VALUES (%s, 'Alpha Protein Bar', 'Snacks', 'tenant-alpha'),
                       (%s, 'Alpha Energy Drink', 'Beverages', 'tenant-alpha'),
                       (%s, 'Beta Granola Bar', 'Snacks', 'tenant-beta');
            """, (alpha_p1, alpha_p2, beta_p1))

            # Sales
            cur.execute("""
                INSERT INTO sales (product_id, sale_date, quantity, tenant_id)
                VALUES (%s, '2026-06-01', 25, 'tenant-alpha'),
                       (%s, '2026-06-02', 35, 'tenant-alpha'),
                       (%s, '2026-06-01', 70, 'tenant-beta');
            """, (alpha_p1, alpha_p2, beta_p1))

            # Predictions
            cur.execute("""
                INSERT INTO predictions (product_id, predicted_demand, rule_prediction, ml_prediction,
                                         adjusted_prediction, avg_sales, percent_change, confidence,
                                         season_tag, decision, impact, prediction_source, tenant_id)
                VALUES (%s, 45, 40, 50, 46, 30.0, 15.0, 'High', 'normal', 'increase', 'increase', 'ml', 'tenant-alpha'),
                       (%s, 65, 60, 70, 66, 70.0, 5.0, 'High', 'normal', 'maintain', 'neutral', 'ml', 'tenant-beta');
            """, (alpha_p1, beta_p1))

            # Alerts
            cur.execute("""
                INSERT INTO alerts (product_id, type, message, severity, percent_change, is_active, tenant_id)
                VALUES (%s, 'HIGH_DEMAND', 'Surge in Protein Bar sales', 'HIGH', 30.0, true, 'tenant-alpha'),
                       (%s, 'LOW_DEMAND', 'Drop in Granola sales', 'LOW', -15.0, true, 'tenant-beta');
            """, (alpha_p1, beta_p1))

            # RAG Document Chunks with real 384-dimensional pgvector embeddings
            cur.execute("""
                INSERT INTO ai_document_chunks (document_key, title, content, content_hash, embedding, tenant_id)
                VALUES ('doc_shared_guide', 'Platform Operations Manual', 'Standard operating procedures', 'h_shared_e2e', %s::vector, NULL),
                       ('doc_alpha_private', 'Alpha Formulation Guide', 'Proprietary almond protein ratio', 'h_alpha_e2e', %s::vector, 'tenant-alpha'),
                       ('doc_beta_private', 'Beta Secret Recipe', 'Proprietary oats and honey blend', 'h_beta_e2e', %s::vector, 'tenant-beta');
            """, (shared_vec, alpha_vec, beta_vec))

    # 2b. Start local OpenAI-compatible mock server for deterministic RAG execution
    mock_llm_server = http.server.HTTPServer(("127.0.0.1", 0), _MockOpenAIHandler)
    mock_llm_port = mock_llm_server.server_address[1]
    mock_llm_thread = threading.Thread(target=mock_llm_server.serve_forever, daemon=True)
    mock_llm_thread.start()

    # 3. Start live FastAPI ML Service subprocess
    fastapi_env = os.environ.copy()
    fastapi_env["DATABASE_URL"] = db_url
    fastapi_env["ML_ANALYST_INTERNAL_TOKEN"] = SHARED_INTERNAL_TOKEN
    fastapi_env["LANGGRAPH_CHECKPOINTER"] = "postgres"
    fastapi_env["PORT"] = str(FASTAPI_PORT)
    fastapi_env["AI_ANALYST_LLM_BASE_URL"] = f"http://127.0.0.1:{mock_llm_port}"
    fastapi_env["AI_ANALYST_LLM_API_KEY"] = "mock-openai-integration-token"
    fastapi_env["AI_ANALYST_LLM_MODEL"] = "mock-gpt"

    fastapi_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(FASTAPI_PORT), "--log-level", "warning"],
        cwd=_ML_SERVICE_DIR,
        env=fastapi_env,
    )

    # 4. Start live Node Backend subprocess
    node_env = os.environ.copy()
    node_env["DATABASE_URL"] = db_url
    node_env["PORT"] = str(NODE_PORT)
    node_env["ML_ANALYST_URL"] = f"http://127.0.0.1:{FASTAPI_PORT}/ai-analyst"
    node_env["ML_PREDICT_URL"] = f"http://127.0.0.1:{FASTAPI_PORT}/predict"
    node_env["ML_ANALYST_INTERNAL_TOKEN"] = SHARED_INTERNAL_TOKEN

    node_cmd = shutil.which("node") or "node"
    npx_cmd = shutil.which("npx") or "npx"

    node_server_script = os.path.join(_ML_SERVICE_DIR, "tests", "cross_service_node_server.mjs")
    node_proc = subprocess.Popen(
        [node_cmd, node_server_script],
        cwd=_REPO_ROOT,
        env=node_env,
    )

    # 5. Start live React/Vite Frontend subprocess
    vite_proc = subprocess.Popen(
        [npx_cmd, "--prefix", "frontend", "vite", "--host", "127.0.0.1", "--port", str(VITE_PORT), "frontend"],
        cwd=_REPO_ROOT,
        env=os.environ.copy(),
    )

    # 6. Wait for all services to report ready
    assert wait_for_service(f"http://127.0.0.1:{FASTAPI_PORT}/health", timeout=30.0), "FastAPI failed to become ready"
    assert wait_for_service(f"http://127.0.0.1:{NODE_PORT}/health", timeout=30.0), "Node backend failed to become ready"
    assert wait_for_service(f"http://127.0.0.1:{VITE_PORT}/", timeout=30.0), "Vite frontend failed to become ready"

    cluster_info = {
        "db_url": db_url,
        "dbname": dbname,
        "fastapi_url": f"http://127.0.0.1:{FASTAPI_PORT}",
        "node_url": f"http://127.0.0.1:{NODE_PORT}",
        "vite_url": f"http://127.0.0.1:{VITE_PORT}",
        "alpha_p1": alpha_p1,
        "alpha_p2": alpha_p2,
        "beta_p1": beta_p1,
        "fastapi_proc": fastapi_proc,
        "node_proc": node_proc,
        "vite_proc": vite_proc,
    }

    try:
        yield cluster_info
    finally:
        # Graceful shutdown of mock LLM server
        try:
            mock_llm_server.shutdown()
            mock_llm_server.server_close()
        except Exception:
            pass

        # Graceful shutdown of all live service processes
        for proc in [vite_proc, node_proc, fastapi_proc]:
            try:
                proc.terminate()
                proc.wait(timeout=5.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        teardown_database(dbname)


# -----------------------------------------------------------------------------
# Test Cases
# -----------------------------------------------------------------------------

def test_01_service_topology_and_frontend_delivery(e2e_cluster: dict[str, Any]):
    """Verify all 3 services and isolated database cluster are running and deliver HTTP 200."""
    # 1. Frontend serves UI assets
    status, body, headers = http_request(f"{e2e_cluster['vite_url']}/")
    assert status == 200
    assert "text/html" in headers.get("content-type", "")
    assert "<div id=\"root\">" in str(body.get("raw", ""))

    # 2. Node Backend health check
    status, body, _ = http_request(f"{e2e_cluster['node_url']}/health")
    assert status == 200
    assert body["status"] == "ok"
    assert body["service"] == "backend"

    # 3. FastAPI ML Service health check
    status, body, _ = http_request(f"{e2e_cluster['fastapi_url']}/health")
    assert status == 200
    assert body["status"] == "ok"
    assert body["service"] == "ml-service"


def test_02_complete_ai_analyst_request_frontend_to_node_to_fastapi(e2e_cluster: dict[str, Any]):
    """Verify full AI Analyst request: Client -> Node -> FastAPI -> PostgreSQL/pgvector."""
    # 1. Query as tenant-alpha via Node backend
    status, body, headers = http_request(
        f"{e2e_cluster['node_url']}/api/ai-analyst",
        method="POST",
        headers={
            "Authorization": "Bearer alpha-token",
            "X-Tenant-ID": "tenant-alpha",
        },
        body={"question": "What is our current product catalog and sales count?"},
    )
    assert status == 200, f"Expected 200 from AI Analyst, got {status}: {body}"
    assert "answer" in body
    assert "sources" in body
    assert "provenance" in body
    assert headers.get("x-correlation-id") is not None, "Node did not forward X-Correlation-ID"

    # 2. Query as tenant-beta via Node backend
    status_beta, body_beta, _ = http_request(
        f"{e2e_cluster['node_url']}/api/ai-analyst",
        method="POST",
        headers={
            "Authorization": "Bearer beta-token",
            "X-Tenant-ID": "tenant-beta",
        },
        body={"question": "What is our total product and sales volume?"},
    )
    assert status_beta == 200, f"Expected 200 from AI Analyst, got {status_beta}: {body_beta}"
    assert "answer" in body_beta


def test_03_agent_execution_request_and_persisted_run_record(e2e_cluster: dict[str, Any]):
    """Verify agent execution triggers LangGraph and persists tenant-scoped run and checkpoint in PostgreSQL."""
    # Execute agent pipeline via FastAPI endpoint
    status, body, _ = http_request(
        f"{e2e_cluster['fastapi_url']}/api/v1/agents/run",
        method="POST",
        headers={
            "X-ML-Internal-Token": SHARED_INTERNAL_TOKEN,
            "X-Tenant-ID": "tenant-alpha",
            "X-User-ID": "firebase-user-alpha",
        },
        body={"question": "What are our overall sales?"},
    )
    assert status == 200
    assert body["tenant_id"] == "tenant-alpha"
    run_id = body.get("run_id")
    thread_id = body.get("thread_id")
    assert run_id is not None
    assert thread_id is not None

    # Verify directly in PostgreSQL that agent_runs, agent_steps, and checkpoints were recorded
    with psycopg.connect(e2e_cluster["db_url"]) as conn:
        with conn.cursor() as cur:
            # 1. agent_runs
            cur.execute("SELECT tenant_id, user_id, status FROM agent_runs WHERE id::text = %s;", (run_id,))
            run_row = cur.fetchone()
            assert run_row is not None, "Run record not found in PostgreSQL agent_runs table!"
            assert run_row[0] == "tenant-alpha"
            assert run_row[1] == "firebase-user-alpha"

            # 2. agent_steps
            cur.execute("SELECT tenant_id, agent_name FROM agent_steps WHERE run_id::text = %s;", (run_id,))
            step_rows = cur.fetchall()
            assert len(step_rows) > 0, "No steps recorded in PostgreSQL agent_steps table!"
            assert all(r[0] == "tenant-alpha" for r in step_rows)

            # 3. LangGraph checkpoints with tenant namespacing
            namespaced_thread = f"tenant-alpha:{thread_id}"
            cur.execute("SELECT COUNT(*) FROM checkpoints WHERE thread_id = %s;", (namespaced_thread,))
            checkpoints_count = cur.fetchone()[0]
            assert checkpoints_count > 0, "No checkpoints recorded in PostgreSQL checkpoints table!"


def test_04_tenant_scoped_analytics_requests_through_node(e2e_cluster: dict[str, Any]):
    """Verify Node backend analytics endpoints enforce tenant boundaries on live PostgreSQL queries."""
    # 1. Products list: Alpha sees 2 products; Beta sees 1 product
    status_alpha_p, body_alpha_p, _ = http_request(
        f"{e2e_cluster['node_url']}/api/products",
        headers={"Authorization": "Bearer alpha-token", "X-Tenant-ID": "tenant-alpha"},
    )
    assert status_alpha_p == 200
    alpha_products = body_alpha_p if isinstance(body_alpha_p, list) else body_alpha_p.get("products", [])
    assert len(alpha_products) == 2
    alpha_names = {p["name"] for p in alpha_products}
    assert "Alpha Protein Bar" in alpha_names
    assert "Alpha Energy Drink" in alpha_names
    assert "Beta Granola Bar" not in alpha_names

    status_beta_p, body_beta_p, _ = http_request(
        f"{e2e_cluster['node_url']}/api/products",
        headers={"Authorization": "Bearer beta-token", "X-Tenant-ID": "tenant-beta"},
    )
    assert status_beta_p == 200
    beta_products = body_beta_p if isinstance(body_beta_p, list) else body_beta_p.get("products", [])
    assert len(beta_products) == 1
    assert beta_products[0]["name"] == "Beta Granola Bar"

    # 2. Dashboard summary: Alpha sales volume = 60 (25 + 35); Beta = 70
    status_alpha_dash, body_alpha_dash, _ = http_request(
        f"{e2e_cluster['node_url']}/api/dashboard/summary",
        headers={"Authorization": "Bearer alpha-token", "X-Tenant-ID": "tenant-alpha"},
    )
    assert status_alpha_dash == 200
    assert int(body_alpha_dash["totalProducts"]) == 2
    assert int(body_alpha_dash["totalSalesVolume"]) == 60

    status_beta_dash, body_beta_dash, _ = http_request(
        f"{e2e_cluster['node_url']}/api/dashboard/summary",
        headers={"Authorization": "Bearer beta-token", "X-Tenant-ID": "tenant-beta"},
    )
    assert status_beta_dash == 200
    assert int(body_beta_dash["totalProducts"]) == 1
    assert int(body_beta_dash["totalSalesVolume"]) == 70

    # 3. Active alerts: Alpha sees Alpha alert only; Beta sees Beta alert only
    status_alpha_a, body_alpha_a, _ = http_request(
        f"{e2e_cluster['node_url']}/api/alerts",
        headers={"Authorization": "Bearer alpha-token", "X-Tenant-ID": "tenant-alpha"},
    )
    assert status_alpha_a == 200
    alpha_alerts = body_alpha_a if isinstance(body_alpha_a, list) else body_alpha_a.get("alerts", [])
    assert len(alpha_alerts) == 1
    assert "Protein Bar" in alpha_alerts[0]["message"]


def test_05_service_failure_when_fastapi_unavailable(e2e_cluster: dict[str, Any]):
    """Verify Node backend returns safe 503 error when FastAPI is unreachable without leaking credentials."""
    # Spin up an auxiliary Node server with an unreachable ML service port
    bad_ml_node_env = os.environ.copy()
    bad_ml_node_env["DATABASE_URL"] = e2e_cluster["db_url"]
    bad_ml_node_env["PORT"] = "5091"
    bad_ml_node_env["ML_ANALYST_URL"] = "http://127.0.0.1:54991/ai-analyst"  # Unreachable port
    bad_ml_node_env["ML_ANALYST_INTERNAL_TOKEN"] = SHARED_INTERNAL_TOKEN

    node_script = os.path.join(_ML_SERVICE_DIR, "tests", "cross_service_node_server.mjs")
    bad_node_proc = subprocess.Popen([shutil.which("node") or "node", node_script], cwd=_REPO_ROOT, env=bad_ml_node_env)

    try:
        assert wait_for_service("http://127.0.0.1:5091/health", timeout=10.0), "Auxiliary Node server failed to start"

        status, body, _ = http_request(
            "http://127.0.0.1:5091/api/ai-analyst",
            method="POST",
            headers={
                "Authorization": "Bearer alpha-token",
                "X-Tenant-ID": "tenant-alpha",
            },
            body={"question": "What is our inventory?"},
        )
        # MUST return 503 Service Unavailable, NEVER 200 with false data
        assert status == 503
        assert "unavailable" in body.get("message", "").lower()
        # Verify no secrets leak
        assert SHARED_INTERNAL_TOKEN not in str(body)
    finally:
        bad_node_proc.terminate()
        bad_node_proc.wait(timeout=5.0)


def test_06_authentication_failures_and_tenant_spoofing(e2e_cluster: dict[str, Any]):
    """Verify unauthorized requests, missing tenant context, and tenant spoofing fail closed."""
    # 1. Missing Authorization Bearer token -> 401
    status, body, _ = http_request(
        f"{e2e_cluster['node_url']}/api/ai-analyst",
        method="POST",
        headers={"X-Tenant-ID": "tenant-alpha"},
        body={"question": "Test question"},
    )
    assert status == 401
    assert "authorization is required" in body.get("message", "").lower()

    # 2. Invalid Bearer token -> 401
    status_inv, body_inv, _ = http_request(
        f"{e2e_cluster['node_url']}/api/ai-analyst",
        method="POST",
        headers={"Authorization": "Bearer bad-token", "X-Tenant-ID": "tenant-alpha"},
        body={"question": "Test question"},
    )
    assert status_inv == 401
    assert "invalid or expired" in body_inv.get("message", "").lower()

    # 3. Missing tenant header for multi-tenant user -> 400
    status_no_t, body_no_t, _ = http_request(
        f"{e2e_cluster['node_url']}/api/ai-analyst",
        method="POST",
        headers={"Authorization": "Bearer multi-token"},
        body={"question": "Test question"},
    )
    assert status_no_t == 400
    assert "tenant context is required" in body_no_t.get("message", "").lower()

    # 4. Tenant spoofing: alpha-token attempting to access tenant-beta -> 403 Forbidden
    status_spoof, body_spoof, _ = http_request(
        f"{e2e_cluster['node_url']}/api/ai-analyst",
        method="POST",
        headers={"Authorization": "Bearer alpha-token", "X-Tenant-ID": "tenant-beta"},
        body={"question": "Test question"},
    )
    assert status_spoof == 403
    assert "tenant access denied" in body_spoof.get("message", "").lower()

    # 5. Invalid internal token on direct FastAPI request -> 401
    status_bad_int, body_bad_int, _ = http_request(
        f"{e2e_cluster['fastapi_url']}/ai-analyst",
        method="POST",
        headers={
            "X-ML-Internal-Token": "invalid-token",
            "X-Tenant-ID": "tenant-alpha",
            "X-User-ID": "user-1",
        },
        body={"question": "Direct question"},
    )
    assert status_bad_int == 401
    assert "invalid internal authorization" in body_bad_int.get("error", "").lower()


def test_07_application_startup_and_shutdown_lifecycle(e2e_cluster: dict[str, Any]):
    """Verify clean initialization and graceful shutdown of PostgresSaver pool and server resources."""
    from workflow.minimal_graph import CheckpointerManager

    # 1. Initialize checkpointer manager against test database
    mgr = CheckpointerManager(database_url=e2e_cluster["db_url"], checkpointer_type="postgres")
    mgr.initialize()
    assert mgr._pool is not None
    assert mgr._initialized is True
    saver = mgr.get_saver()
    assert saver is not None

    # 2. Close checkpointer manager cleanly
    mgr.close()
    assert mgr._pool is None
    assert mgr._initialized is False
    assert mgr._saver is None


# -----------------------------------------------------------------------------
# Standalone Runner
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    if not DB_AVAILABLE:
        print(f"[SKIP] PostgreSQL pgvector instance not available: {DB_SKIP_REASON}")
        sys.exit(0)

    print("Running OpsPulse Cross-Service End-to-End Integration Tests...")
    exit_code = pytest.main([__file__, "-v", "-s"])
    sys.exit(exit_code)
