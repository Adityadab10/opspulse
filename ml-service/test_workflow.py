"""LangGraph minimal pipeline and tracking integration tests (T06)."""

import uuid
import pytest
from langgraph.checkpoint.memory import MemorySaver

from tools.db import DatabaseAdapter
from tracking.tracker import default_tracker
from workflow.minimal_graph import (
    build_minimal_graph,
    execute_tool_node,
    initialize_node,
    run_minimal_pipeline,
    synthesize_evidence_node,
)


class MockDatabaseAdapter(DatabaseAdapter):
    """Deterministic mock DB adapter for workflow tests."""

    def query(self, sql: str, params=None, tenant_id: str | None = None):
        if "sales_volume" in sql or "sales" in sql.lower():
            return [
                {
                    "total_quantity": 500,
                    "record_count": 25,
                    "avg_daily_quantity": 20.0,
                }
            ]
        if "inventory" in sql.lower() or "risk" in sql.lower():
            return [
                {
                    "product_id": "item-1",
                    "product_name": "Premium Almonds",
                    "current_stock": 5,
                    "reorder_point": 20,
                    "risk_level": "high",
                }
            ]
        return [{"metric": "val"}]


@pytest.fixture(autouse=True)
def mock_db_in_tools(monkeypatch):
    """Ensure tools use mock adapter during workflow test execution."""
    mock_adapter = MockDatabaseAdapter()
    monkeypatch.setattr("tools.sales.DatabaseAdapter", lambda: mock_adapter)
    monkeypatch.setattr("tools.inventory.DatabaseAdapter", lambda: mock_adapter)
    monkeypatch.setattr("tools.products.DatabaseAdapter", lambda: mock_adapter)
    monkeypatch.setattr("tools.kpis.DatabaseAdapter", lambda: mock_adapter)


def test_initialize_node_routes_sales_question():
    initial_state = {
        "run_id": "test-run-sales",
        "thread_id": "thread-sales",
        "tenant_id": "tenant-001",
        "user_id": "user-001",
        "question": "Show me the sales volume for last month",
        "trigger_type": "on_demand",
    }
    updated = initialize_node(initial_state)
    assert updated["run_id"] == "test-run-sales"
    assert updated["execution_plan"]["selected_agent"] == "business_analyst"
    assert updated["execution_plan"]["selected_tool"] == "get_sales_summary"
    assert updated["status"] == "running"


def test_initialize_node_routes_inventory_question():
    initial_state = {
        "run_id": "test-run-inv",
        "thread_id": "thread-inv",
        "tenant_id": "tenant-001",
        "user_id": "user-001",
        "question": "Are there any stock risk alerts?",
        "trigger_type": "on_demand",
    }
    updated = initialize_node(initial_state)
    assert updated["execution_plan"]["selected_agent"] == "inventory_agent"
    assert updated["execution_plan"]["selected_tool"] == "get_inventory_risk"


def test_minimal_graph_compilation_and_execution():
    saver = MemorySaver()
    app = build_minimal_graph(checkpointer=saver)
    run_id = f"run-{uuid.uuid4().hex[:8]}"
    thread_id = f"thread-{uuid.uuid4().hex[:8]}"

    initial_state = {
        "run_id": run_id,
        "thread_id": thread_id,
        "tenant_id": "tenant-test",
        "user_id": "user-test",
        "question": "What is our overall sales summary?",
        "trigger_type": "on_demand",
    }

    config = {"configurable": {"thread_id": thread_id}}
    final_state = app.invoke(initial_state, config=config)

    assert final_state["status"] == "completed"
    assert final_state["evidence_valid"] is True
    assert final_state["confidence"] >= 0.8
    assert "Analysis complete" in final_state["final_answer"]
    assert len(final_state["citations"]) > 0
    assert len(final_state["tool_execution_log"]) == 1

    # Verify checkpoint persistence in MemorySaver
    checkpoint_tuple = saver.get_tuple(config)
    assert checkpoint_tuple is not None
    assert checkpoint_tuple.checkpoint["channel_values"]["status"] == "completed"


def test_run_minimal_pipeline_wrapper():
    run_id = f"pipeline-run-{uuid.uuid4().hex[:6]}"
    final_state = run_minimal_pipeline(
        question="What are the latest sales numbers?",
        tenant_id="tenant-prod-1",
        user_id="user-prod-1",
        run_id=run_id,
    )

    assert final_state["run_id"] == run_id
    assert final_state["tenant_id"] == "tenant-prod-1"
    assert final_state["status"] == "completed"
    assert len(final_state["sql_evidence"]) > 0

    # Verify execution tracking in default_tracker
    stored_run = default_tracker.get_run(run_id=run_id, tenant_id="tenant-prod-1")
    assert stored_run is not None
    assert stored_run["tenant_id"] == "tenant-prod-1"
    assert stored_run["status"] == "completed"

    stored_steps = default_tracker.get_steps(run_id=run_id, tenant_id="tenant-prod-1")
    assert len(stored_steps) >= 1
    assert stored_steps[0]["node_name"] == "execute_tool"
    assert stored_steps[0]["status"] == "completed"


def test_pipeline_budget_and_insufficient_evidence():
    """Verify handling when tool returns empty/no evidence."""
    empty_state = {
        "run_id": "empty-run",
        "thread_id": "empty-thread",
        "tenant_id": "tenant-empty",
        "user_id": "user-empty",
        "question": "Check non-existent data",
        "sql_evidence": [],
        "tool_execution_log": [{"limitations": ["No database records found"]}],
    }
    result = synthesize_evidence_node(empty_state)
    assert result["evidence_valid"] is False
    assert result["confidence"] <= 0.3
    assert result["status"] == "insufficient_evidence"
    assert "Unable to answer" in result["final_answer"]
