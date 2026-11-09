"""Minimal LangGraph pipeline for OpsPulse multi-agent foundation (T06).

Flow: initialize -> execute_tool -> synthesize_evidence
Uses typed OpsPulseState with pluggable checkpoint persistence.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from contracts.state import OpsPulseState
from tools import default_registry
from tracking.tracker import default_tracker

logger = logging.getLogger(__name__)


def initialize_node(state: OpsPulseState) -> dict[str, Any]:
    """Initialize workflow state, budget, and tracking record."""
    run_id = state.get("run_id") or str(uuid.uuid4())
    thread_id = state.get("thread_id") or run_id
    tenant_id = state.get("tenant_id") or "default"
    user_id = state.get("user_id") or "system"
    question = state.get("question") or ""

    # Plan initial routing based on question terms
    lowered = question.lower()
    selected_tool = "get_business_kpis"
    selected_agent = "supervisor"
    tool_input: dict[str, Any] = {"window_days": 30}

    if "product" in lowered or "sku" in lowered or "almond" in lowered:
        selected_tool = "get_product_snapshot"
        selected_agent = "business_analyst"
        # Extract term or default
        tool_input = {"product_id": question}
    elif "alert" in lowered or "risk" in lowered or "stock" in lowered:
        selected_tool = "get_inventory_risk"
        selected_agent = "inventory_agent"
        tool_input = {}
    elif "sales" in lowered or "revenue" in lowered or "volume" in lowered:
        selected_tool = "get_sales_summary"
        selected_agent = "business_analyst"
        tool_input = {}

    plan = {
        "intent": "analytics_investigation",
        "selected_tool": selected_tool,
        "selected_agent": selected_agent,
        "tool_input": tool_input,
    }

    # Record in tracker
    default_tracker.create_run(
        run_id=run_id,
        tenant_id=tenant_id,
        user_id=user_id,
        thread_id=thread_id,
        question=question,
        trigger_type=state.get("trigger_type", "on_demand"),
    )

    return {
        "run_id": run_id,
        "thread_id": thread_id,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "status": "running",
        "intent": "analytics_investigation",
        "execution_plan": plan,
        "selected_agents": [selected_agent],
        "agent_status": {selected_agent: "running"},
        "execution_budget": {"max_tool_calls": 5, "calls_made": 0},
        "tool_execution_log": [],
        "sql_evidence": [],
        "prediction_evidence": [],
        "errors": [],
    }


def execute_tool_node(state: OpsPulseState) -> dict[str, Any]:
    """Execute planned analytics tool with permission check and tenant scoping."""
    plan = state.get("execution_plan") or {}
    tool_name = plan.get("selected_tool", "get_business_kpis")
    agent_name = plan.get("selected_agent", "supervisor")
    tool_input = plan.get("tool_input", {})
    tenant_id = state.get("tenant_id", "default")
    run_id = state.get("run_id", "unknown")

    started = time.perf_counter()
    tool_result = default_registry.execute(
        tool_name=tool_name,
        agent_name=agent_name,
        tenant_id=tenant_id,
        raw_input=tool_input,
        correlation_id=run_id,
    )
    duration_ms = int((time.perf_counter() - started) * 1000)

    # Collect evidence references
    evidence_dicts = [e.model_dump(mode="json") for e in tool_result.evidence]
    tool_log_entry = {
        "tool_name": tool_name,
        "agent_name": agent_name,
        "success": tool_result.success,
        "duration_ms": duration_ms,
        "limitations": tool_result.limitations,
    }

    # Record step in tracker
    default_tracker.record_step(
        run_id=run_id,
        tenant_id=tenant_id,
        step_number=1,
        agent_name=agent_name,
        node_name="execute_tool",
        status="completed" if tool_result.success else "failed",
        input_payload=tool_input,
        output_payload=tool_result.data,
        tool_calls=[tool_log_entry],
        duration_ms=duration_ms,
    )

    existing_sql = list(state.get("sql_evidence") or [])
    existing_sql.extend(evidence_dicts)

    existing_logs = list(state.get("tool_execution_log") or [])
    existing_logs.append(tool_log_entry)

    agent_status = dict(state.get("agent_status") or {})
    agent_status[agent_name] = "completed" if tool_result.success else "failed"

    return {
        "sql_evidence": existing_sql,
        "tool_execution_log": existing_logs,
        "agent_status": agent_status,
        "validation_errors": tool_result.limitations if not tool_result.success else [],
    }


def synthesize_evidence_node(state: OpsPulseState) -> dict[str, Any]:
    """Synthesize evidence into structured answer, citations, and confidence."""
    run_id = state.get("run_id", "unknown")
    tenant_id = state.get("tenant_id", "default")
    sql_evidence = state.get("sql_evidence") or []
    tool_logs = state.get("tool_execution_log") or []
    question = state.get("question", "")

    evidence_valid = len(sql_evidence) > 0
    limitations = []
    for log in tool_logs:
        limitations.extend(log.get("limitations") or [])

    confidence = 0.9 if evidence_valid else 0.2
    final_status = "completed" if evidence_valid else "insufficient_evidence"

    # Deterministic synthesis
    if evidence_valid:
        primary = sql_evidence[0]
        final_answer = (
            f"Analysis complete for question: '{question}'. "
            f"Grounded evidence retrieved from {primary.get('source_name')} "
            f"via query {primary.get('query_name', 'analytics')}. "
            f"Observed data: {primary.get('payload', {})}."
        )
    else:
        final_answer = (
            f"Unable to answer '{question}' with definitive business evidence. "
            f"Limitations encountered: {'; '.join(limitations) or 'No evidence records found'}."
        )

    citations = [
        {"source_type": e.get("source_type"), "source_name": e.get("source_name"), "evidence_id": e.get("evidence_id")}
        for e in sql_evidence
    ]

    # Update run status in tracker
    default_tracker.update_run_status(
        run_id=run_id,
        status=final_status,
        final_answer=final_answer,
        confidence=confidence,
        limitations=limitations,
        selected_agents=state.get("selected_agents", []),
        execution_plan=state.get("execution_plan"),
    )

    return {
        "evidence_valid": evidence_valid,
        "confidence": confidence,
        "final_answer": final_answer,
        "citations": citations,
        "limitations": limitations,
        "status": final_status,
    }


def build_minimal_graph(checkpointer: BaseCheckpointSaver | None = None) -> Any:
    """Compile the minimal 3-node LangGraph pipeline."""
    graph = StateGraph(OpsPulseState)

    graph.add_node("initialize", initialize_node)
    graph.add_node("execute_tool", execute_tool_node)
    graph.add_node("synthesize_evidence", synthesize_evidence_node)

    graph.add_edge(START, "initialize")
    graph.add_edge("initialize", "execute_tool")
    graph.add_edge("execute_tool", "synthesize_evidence")
    graph.add_edge("synthesize_evidence", END)

    saver = checkpointer if checkpointer is not None else MemorySaver()
    return graph.compile(checkpointer=saver)


def run_minimal_pipeline(
    question: str,
    tenant_id: str,
    user_id: str,
    run_id: str | None = None,
    thread_id: str | None = None,
    checkpointer: BaseCheckpointSaver | None = None,
) -> OpsPulseState:
    """Execute the pipeline and return the final state."""
    app = build_minimal_graph(checkpointer=checkpointer)
    actual_run_id = run_id or str(uuid.uuid4())
    actual_thread_id = thread_id or actual_run_id

    initial_state: OpsPulseState = {
        "run_id": actual_run_id,
        "thread_id": actual_thread_id,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "question": question,
        "trigger_type": "on_demand",
        "trigger_metadata": {},
        "conversation_context": [],
    }

    config = {"configurable": {"thread_id": actual_thread_id}}
    final_state = app.invoke(initial_state, config=config)
    return final_state
