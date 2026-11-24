"""Security and identity middleware tests for FastAPI ML service (T05 & AI Analyst)."""

import os
import pytest
from fastapi.testclient import TestClient

import app
import rag_service
from tools.db import DatabaseAdapter


client = TestClient(app.app)
TEST_TOKEN = "test-internal-secret-token"


@pytest.fixture(autouse=True)
def setup_internal_token(monkeypatch):
    monkeypatch.setenv("ML_ANALYST_INTERNAL_TOKEN", TEST_TOKEN)


def test_rejects_missing_internal_token():
    response = client.get("/api/v1/tools")
    assert response.status_code == 401
    assert "Invalid internal authorization" in response.json()["detail"]


def test_rejects_invalid_internal_token():
    headers = {"x-ml-internal-token": "wrong-token"}
    response = client.get("/api/v1/tools", headers=headers)
    assert response.status_code == 401
    assert "Invalid internal authorization" in response.json()["detail"]


def test_rejects_missing_user_id():
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-tenant-id": "tenant-abc",
    }
    response = client.get("/api/v1/tools", headers=headers)
    assert response.status_code == 401
    assert "Missing required identity header: 'x-user-id'" in response.json()["detail"]


def test_rejects_missing_tenant_id():
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-123",
    }
    response = client.get("/api/v1/tools", headers=headers)
    assert response.status_code == 401
    assert "Missing required tenant header: 'x-tenant-id'" in response.json()["detail"]


def test_accepts_valid_trusted_context():
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-123",
        "x-tenant-id": "tenant-abc",
        "x-correlation-id": "corr-999",
    }
    response = client.get("/api/v1/tools", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["tenant_id"] == "tenant-abc"
    assert data["user_id"] == "user-123"
    assert data["correlation_id"] == "corr-999"
    assert len(data["tools"]) >= 7


def test_execute_tool_enforces_permissions():
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-123",
        "x-tenant-id": "tenant-abc",
    }

    payload = {
        "tool_name": "get_sales_summary",
        "agent_name": "inventory_agent",
        "parameters": {},
    }
    response = client.post("/api/v1/tools/execute", json=payload, headers=headers)
    assert response.status_code == 403
    assert "not authorized" in response.json()["error"]


def test_execute_tool_enforces_unknown_tool_404():
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-123",
        "x-tenant-id": "tenant-abc",
    }
    payload = {
        "tool_name": "drop_database_tables",
        "agent_name": "supervisor",
        "parameters": {},
    }
    response = client.post("/api/v1/tools/execute", json=payload, headers=headers)
    assert response.status_code == 404
    assert "not registered" in response.json()["error"]


def test_execute_tool_rejects_extra_parameters():
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-123",
        "x-tenant-id": "tenant-abc",
    }
    payload = {
        "tool_name": "get_sales_summary",
        "agent_name": "business_analyst",
        "parameters": {"forged_tenant": "evil-tenant"},
    }
    response = client.post("/api/v1/tools/execute", json=payload, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "extra_forbidden" in data["error"]


def test_execute_tool_injects_trusted_tenant_context(monkeypatch):
    captured_tenant = None

    from tools import default_registry
    orig_defn, orig_handler = default_registry._tools["get_sales_summary"]

    def spy_handler(tenant_id: str, payload, db=None):
        nonlocal captured_tenant
        captured_tenant = tenant_id
        return orig_handler(tenant_id=tenant_id, payload=payload, db=db)

    monkeypatch.setitem(default_registry._tools, "get_sales_summary", (orig_defn, spy_handler))

    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-trusted",
        "x-tenant-id": "trusted-tenant-456",
    }
    payload = {
        "tool_name": "get_sales_summary",
        "agent_name": "business_analyst",
        "parameters": {"product_id": "item-1"},
    }

    response = client.post("/api/v1/tools/execute", json=payload, headers=headers)
    assert response.status_code == 200
    assert captured_tenant == "trusted-tenant-456"


# ============================================================================
# AI Analyst Trusted Context & Security Gate Tests
# ============================================================================

def test_ai_analyst_rejects_missing_internal_token():
    response = client.post(
        "/ai-analyst",
        headers={"x-user-id": "u1", "x-tenant-id": "t1"},
        json={"question": "How many products exist?"},
    )
    assert response.status_code == 401
    assert "Invalid internal authorization" in response.json()["detail"]


def test_ai_analyst_rejects_invalid_internal_token():
    response = client.post(
        "/ai-analyst",
        headers={
            "x-ml-internal-token": "bad-token",
            "x-user-id": "u1",
            "x-tenant-id": "t1",
        },
        json={"question": "How many products exist?"},
    )
    assert response.status_code == 401
    assert "Invalid internal authorization" in response.json()["detail"]


def test_ai_analyst_rejects_missing_user_id():
    response = client.post(
        "/ai-analyst",
        headers={
            "x-ml-internal-token": TEST_TOKEN,
            "x-tenant-id": "tenant-abc",
        },
        json={"question": "How many products exist?"},
    )
    assert response.status_code == 401
    assert "Missing required identity header: 'x-user-id'" in response.json()["detail"]


def test_ai_analyst_rejects_missing_tenant_id():
    response = client.post(
        "/ai-analyst",
        headers={
            "x-ml-internal-token": TEST_TOKEN,
            "x-user-id": "user-123",
        },
        json={"question": "How many products exist?"},
    )
    assert response.status_code == 401
    assert "Missing required tenant header: 'x-tenant-id'" in response.json()["detail"]


def test_ai_analyst_rejects_tenant_spoofing_through_request_body():
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "legit-user",
        "x-tenant-id": "legit-tenant",
    }
    # Body attempts to spoof tenant_id or user_id
    payload = {
        "question": "How many products exist?",
        "tenant_id": "attacker-tenant",
    }
    response = client.post("/ai-analyst", headers=headers, json=payload)
    assert response.status_code == 400
    assert "extra_forbidden" in response.json()["error"]


def test_ai_analyst_propagates_trusted_context(monkeypatch):
    captured_tenant = None
    captured_user = None

    def spy_answer(question: str, tenant_id: str | None = None, user_id: str | None = None, conversation=None):
        nonlocal captured_tenant, captured_user
        assert conversation == []
        captured_tenant = tenant_id
        captured_user = user_id
        return {
            "answer": "There are 5 products in this tenant.",
            "category": "live_business_analytics",
            "sources": [],
            "provenance": {"liveData": True, "documentation": False, "documentRetrievalAvailable": True},
        }

    monkeypatch.setattr(app, "answer_question", spy_answer)

    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "trusted-user-123",
        "x-tenant-id": "trusted-tenant-789",
    }
    response = client.post(
        "/ai-analyst",
        headers=headers,
        json={"question": "How many products exist?"},
    )
    assert response.status_code == 200
    assert captured_tenant == "trusted-tenant-789"
    assert captured_user == "trusted-user-123"


def test_ai_analyst_tenant_scoped_sql_retrieval(monkeypatch):
    """Verify that when the database supports tenant_id, queries filter by tenant_id."""
    monkeypatch.setattr(rag_service, "_check_table_has_tenant_id", lambda table: True)

    executed_queries = []

    class MockCursor:
        def execute(self, sql, params=None):
            executed_queries.append({"sql": sql, "params": params})

        def fetchone(self):
            return {"products_count": 5, "sales_count": 20, "predictions_count": 5, "active_alerts": 1}

        def fetchall(self):
            return []

    class MockConnection:
        def cursor(self, *args, **kwargs):
            return MockCursor()

    from contextlib import contextmanager

    @contextmanager
    def mock_cursor_ctx():
        yield MockCursor()

    monkeypatch.setattr(rag_service, "_cursor", mock_cursor_ctx)

    evidence = rag_service._live_evidence(
        question="How many products exist?",
        tenant_id="tenant-isolated-1",
    )
    assert evidence["source"] == "LIVE_DATABASE"
    assert len(executed_queries) > 0
    first_query = executed_queries[0]
    # Verify that tenant_id was parameterized in SQL query
    assert "tenant_id" in first_query["sql"]
    assert "tenant-isolated-1" in first_query["params"]


def test_ai_analyst_tenant_scoped_vector_retrieval(monkeypatch):
    """Verify that when ai_document_chunks supports tenant_id, vector query filters by tenant_id."""
    monkeypatch.setattr(rag_service, "_check_table_has_tenant_id", lambda table: True)
    monkeypatch.setattr(rag_service, "_vector_available", lambda: True)

    import sys
    import types
    mock_st = types.ModuleType("sentence_transformers")
    mock_st.SentenceTransformer = lambda model: None
    monkeypatch.setitem(sys.modules, "sentence_transformers", mock_st)

    class MockEncoder:
        def encode(self, text):
            class Arr:
                def tolist(self):
                    return [0.1, 0.2, 0.3]
            return Arr()

    monkeypatch.setattr(rag_service, "_embedding_model", lambda _: MockEncoder())

    executed_vector_queries = []

    class MockVectorCursor:
        def execute(self, sql, params=None):
            executed_vector_queries.append({"sql": sql, "params": params})

        def fetchall(self):
            return [
                {
                    "id": "doc-1",
                    "document_key": "metric-definitions",
                    "title": "Metrics",
                    "section": "s1",
                    "content": "Sales totals",
                    "version": "v1",
                    "similarity": 0.95,
                }
            ]

    from contextlib import contextmanager

    @contextmanager
    def mock_vector_cursor_ctx():
        yield MockVectorCursor()

    monkeypatch.setattr(rag_service, "_cursor", mock_vector_cursor_ctx)

    result = rag_service._document_evidence(
        question="Explain metric definitions",
        tenant_id="tenant-vector-1",
    )
    assert result["available"] is True
    assert len(executed_vector_queries) == 1
    query = executed_vector_queries[0]
    assert "tenant_id = %s OR tenant_id IS NULL" in query["sql"]
    assert "tenant-vector-1" in query["params"]


@pytest.mark.parametrize("endpoint,method,payload", [
    ("/predict", "post", {"productId": "p1"}),
    ("/compare-models", "post", {"productId": "p1"}),
    ("/api/predict/p1", "post", {}),
    ("/news-insights", "post", {"productName": "Widget"}),
])
def test_all_production_endpoints_reject_missing_internal_token(endpoint, method, payload):
    """Verify all newly secured endpoints reject calls without valid internal token."""
    fn = getattr(client, method)
    response = fn(endpoint, json=payload)
    assert response.status_code == 401
    assert "Invalid internal authorization" in response.json()["detail"]


@pytest.mark.parametrize("endpoint,method,payload", [
    ("/predict", "post", {"productId": "p1"}),
    ("/compare-models", "post", {"productId": "p1"}),
    ("/api/predict/p1", "post", {}),
    ("/news-insights", "post", {"productName": "Widget"}),
])
def test_all_production_endpoints_reject_missing_tenant_id(endpoint, method, payload):
    """Verify all newly secured endpoints reject calls missing x-tenant-id header."""
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-123",
    }
    fn = getattr(client, method)
    response = fn(endpoint, json=payload, headers=headers)
    assert response.status_code == 401
    assert "Missing required tenant header: 'x-tenant-id'" in response.json()["detail"]


def test_predict_forbids_extra_body_fields_preventing_tenant_spoofing():
    """Verify ProductRequest forbids extra fields like tenant_id in request body."""
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-123",
        "x-tenant-id": "trusted-tenant",
    }
    payload = {
        "productId": "p1",
        "tenant_id": "spoofed-tenant",
    }
    response = client.post("/predict", json=payload, headers=headers)
    assert response.status_code == 400
    assert "Invalid request payload" in response.json()["error"]


def test_compare_models_forbids_extra_body_fields():
    """Verify compare-models rejects body tenant spoofing."""
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-123",
        "x-tenant-id": "trusted-tenant",
    }
    payload = {
        "productId": "p1",
        "tenant_id": "spoofed-tenant",
    }
    response = client.post("/compare-models", json=payload, headers=headers)
    assert response.status_code == 400
    assert "Invalid request payload" in response.json()["error"]


def test_debug_sales_disabled_in_production(monkeypatch):
    """Verify /debug-sales/{product_id} returns 404 when ENABLE_DEBUG_ENDPOINTS is not set."""
    monkeypatch.setenv("ENABLE_DEBUG_ENDPOINTS", "false")
    headers = {
        "x-ml-internal-token": TEST_TOKEN,
        "x-user-id": "user-123",
        "x-tenant-id": "trusted-tenant",
    }
    response = client.get("/debug-sales/p1", headers=headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Endpoint not found"


def test_test_endpoint_sanitized_in_production(monkeypatch):
    """Verify /test returns sanitized ok status without database internals when not in debug mode."""
    monkeypatch.setenv("ENABLE_DEBUG_ENDPOINTS", "false")
    response = client.get("/test")
    assert response.status_code == 200
    data = response.json()
    assert data == {"status": "ok", "service": "ml-service"}
    assert "database" not in data


def test_document_evidence_schema_not_ready_fails_closed(monkeypatch):
    """Verify _document_evidence fails closed if tenant_id is supplied but table lacks tenant_id."""
    monkeypatch.setattr(rag_service, "_check_table_has_tenant_id", lambda table: False)
    monkeypatch.setattr(rag_service, "_vector_available", lambda: True)

    import sys
    import types
    mock_st = types.ModuleType("sentence_transformers")
    mock_st.SentenceTransformer = lambda model: None
    monkeypatch.setitem(sys.modules, "sentence_transformers", mock_st)

    result = rag_service._document_evidence(
        question="Explain metrics",
        tenant_id="tenant-not-ready",
    )
    assert result["available"] is False
    assert "Tenant isolation schema not established" in result["error"]
