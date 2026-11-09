"""Tests for OpsPulse typed contracts (T02)."""

import pytest
from pydantic import ValidationError

from contracts import (
    AgentFinding,
    AgentInput,
    AgentOutput,
    EvidenceReference,
    ForecastEvidence,
    OpsPulseState,
    SqlEvidence,
)
from contracts.tools import (
    BusinessKpisOutput,
    DemandForecastOutput,
    SalesSummaryOutput,
)


def test_evidence_reference_creation():
    ref = EvidenceReference(
        source_type="live_sql",
        source_name="sales_table",
        record_reference="prod-123",
        payload={"total_qty": 50},
        confidence=0.95,
        limitations=["Only reflects sales up to yesterday"],
    )
    assert ref.source_type == "live_sql"
    assert ref.source_name == "sales_table"
    assert ref.confidence == 0.95
    assert len(ref.limitations) == 1
    assert len(ref.evidence_id) > 0


def test_sql_evidence_specialization():
    sql_ev = SqlEvidence(
        source_name="sales_aggregation",
        query_name="get_sales_summary",
        row_count=12,
        parameters={"product_id": "p1"},
    )
    assert sql_ev.source_type == "live_sql"
    assert sql_ev.query_name == "get_sales_summary"
    assert sql_ev.row_count == 12


def test_forecast_evidence_specialization():
    fcst_ev = ForecastEvidence(
        source_name="prophet_forecaster",
        model_name="prophet",
        horizon_days=30,
        historical_points=45,
        routing_reason="Historical series length >= 21",
    )
    assert fcst_ev.source_type == "forecast"
    assert fcst_ev.model_name == "prophet"
    assert fcst_ev.horizon_days == 30


def test_agent_finding_requires_mandatory_fields():
    with pytest.raises(ValidationError):
        AgentFinding(agent_name="business_analyst")  # Missing status, summary

    finding = AgentFinding(
        agent_name="business_analyst",
        status="completed",
        summary="Sales grew by 15%",
        findings=[{"metric": "growth", "value": 0.15}],
        evidence=[
            SqlEvidence(
                source_name="sales_db",
                query_name="compare_periods",
                row_count=2,
            )
        ],
        confidence=0.9,
        limitations=[],
        recommended_next_steps=["Reorder almonds"],
    )
    assert finding.status == "completed"
    assert len(finding.evidence) == 1


def test_agent_output_packaging():
    finding = AgentFinding(
        agent_name="inventory_agent",
        status="insufficient_evidence",
        summary="Not enough data to calculate risk",
        limitations=["Only 2 sales rows available"],
    )
    output = AgentOutput(run_id="run-001", finding=finding)
    assert output.run_id == "run-001"
    assert output.finding.status == "insufficient_evidence"
    assert output.execution_metadata.tool_call_count == 0


def test_opspulse_state_typeddict():
    state: OpsPulseState = {
        "run_id": "r1",
        "thread_id": "t1",
        "tenant_id": "tenant-abc",
        "user_id": "u1",
        "trigger_type": "on_demand",
        "trigger_metadata": {},
        "question": "What are our top selling items?",
        "conversation_context": [],
        "intent": "top_products",
        "execution_plan": {"steps": ["business_analyst"]},
        "selected_agents": ["business_analyst"],
        "agent_status": {"business_analyst": "running"},
        "agent_findings": [],
        "tool_execution_log": [],
        "retrieved_documents": [],
        "sql_evidence": [],
        "prediction_evidence": [],
        "evidence_valid": True,
        "validation_errors": [],
        "confidence": 0.85,
        "final_answer": "",
        "citations": [],
        "recommendations": [],
        "proposed_actions": [],
        "approval_required": False,
        "approval_status": None,
        "execution_budget": {"max_tool_calls": 10},
        "errors": [],
        "status": "running",
    }
    assert state["tenant_id"] == "tenant-abc"
    assert state["trigger_type"] == "on_demand"


def test_tool_output_schemas():
    summary_out = SalesSummaryOutput(
        success=True,
        total_sales_volume=1200,
        record_count=45,
        unique_products_sold=8,
        average_daily_sales=40.0,
    )
    assert summary_out.success is True
    assert summary_out.total_sales_volume == 1200

    forecast_out = DemandForecastOutput(
        success=True,
        product_id="prod-1",
        product_name="Almonds",
        selected_model="prophet",
        forecast_30d=150,
        historical_points=35,
        routing_reason="Historical series length 35 >= 21",
    )
    assert forecast_out.selected_model == "prophet"
    assert forecast_out.forecast_30d == 150
