"""Security and identity middleware tests for FastAPI ML service (T05)."""

import os
import pytest
from fastapi.testclient import TestClient

import app
from tools.db import DatabaseAdapter


client = TestClient(app.app)
TEST_TOKEN = "test-internal-secret-token"


@pytest.fixture(autouse=True)
def setup_internal_token(monkeypatch):
    monkeypatch.setenv("ML_ANALYST_INTERNAL_TOKEN", TEST_TOKEN)


def test_rejects_missing_internal_token():
    response = client.get("/api/v1/tools")
    assert response.status_code == 401
    assert "Invalid internal authorization token" in response.json()["detail"]


def test_rejects_invalid_internal_token():
    headers = {"x-ml-internal-token": "wrong-token"}
    response = client.get("/api/v1/tools", headers=headers)
    assert response.status_code == 401
    assert "Invalid internal authorization token" in response.json()["detail"]


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

    # Inventory agent is not authorized for get_sales_summary
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
    # Extra unexpected parameter should fail validation
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
