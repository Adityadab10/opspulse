"""Minimal LangGraph pipeline for OpsPulse multi-agent foundation (T06).

Flow: initialize -> execute_tool -> synthesize_evidence
Uses typed OpsPulseState with pluggable checkpoint persistence and tenant namespacing.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Any
import uuid

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from new_database import new_database_connection
from contracts.state import AgentFinding, OpsPulseState
from tools import default_registry
from tracking.tracker import default_tracker

logger = logging.getLogger(__name__)


class CheckpointerManager:
    """Manages LangGraph checkpointer initialization, connection pooling, and tenant namespacing."""

    def __init__(self, database_url: str | None = None, checkpointer_type: str | None = None):
        self._database_url = database_url if database_url is not None else os.getenv("DATABASE_URL")
        self._checkpointer_type = (checkpointer_type or os.getenv("LANGGRAPH_CHECKPOINTER", "memory")).lower()
        self._pool = None
        self._saver = None
        self._initialized = False

    def initialize(self) -> None:
        """Initialize connection pool and PostgresSaver if checkpointer_type is postgres."""
        production = os.getenv("ENVIRONMENT", "").lower() == "production"
        if production and self._checkpointer_type != "postgres":
            raise RuntimeError("Production requires the PostgreSQL checkpointer")
        if self._checkpointer_type != "postgres":
            logger.info("LangGraph checkpointer set to '%s'; skipping Postgres pool initialization.", self._checkpointer_type)
            return

        options = {}
        database_url = self._database_url
        provisioned = bool(os.getenv("OPSPULSE_CHECKPOINT_DATABASE_URL")) or production
        if provisioned:
            database_url, options = new_database_connection("OPSPULSE_CHECKPOINT_DATABASE_URL")
            options["options"] = "-c search_path=opspulse_checkpoints"
        if "pcefxrhnzqlgpscnkypg" in (database_url or ""):
            raise RuntimeError("The archived database cannot store checkpoints")
        if not database_url:
            if os.getenv("ENVIRONMENT", "").lower() == "production":
                raise RuntimeError("LANGGRAPH_CHECKPOINTER=postgres requires DATABASE_URL to be set in production.")
            logger.warning("DATABASE_URL not set for postgres checkpointer; falling back to memory in dev.")
            self._checkpointer_type = "memory"
            return

        try:
            from psycopg_pool import ConnectionPool
            from langgraph.checkpoint.postgres import PostgresSaver

            if self._pool is None:
                self._pool = ConnectionPool(
                    conninfo=database_url,
                    min_size=1,
                    max_size=10,
                    open=True,
                    timeout=5.0,
                    kwargs={"autocommit": True, **options},
                )
            saver = PostgresSaver(self._pool)
            if not self._initialized:
                if provisioned:
                    with self._pool.connection() as connection:
                        connection.execute("SELECT v FROM checkpoint_migrations LIMIT 1").fetchone()
                else:
                    saver.setup()
                self._initialized = True
            self._saver = saver
            logger.info("PostgresSaver initialized successfully with pooled connection.")
        except Exception as exc:
            if self._pool is not None:
                try:
                    self._pool.close()
                except Exception:
                    pass
                self._pool = None
            if provisioned:
                raise RuntimeError("Failed to initialize the private PostgreSQL checkpointer") from exc
            logger.warning("PostgresSaver initialization failed (%s); falling back to MemorySaver in dev.", exc)
            self._saver = None
            self._checkpointer_type = "memory"

    def get_saver(self) -> BaseCheckpointSaver:
        """Returns active checkpointer instance."""
        if self._saver is not None:
            return self._saver
        if self._checkpointer_type == "postgres" and not self._initialized:
            self.initialize()
            if self._saver is not None:
                return self._saver
        return MemorySaver()

    def close(self) -> None:
        if self._pool is not None:
            try:
                self._pool.close()
            except Exception:
                pass
            self._pool = None
            self._saver = None
            self._initialized = False

    @staticmethod
    def namespace_thread_id(tenant_id: str, thread_id: str, user_id: str = "") -> str:
        """Derive an opaque key from trusted identity and an untrusted thread reference."""
        digest = hashlib.sha256(json.dumps([tenant_id, user_id, thread_id]).encode()).hexdigest()
        return f"{tenant_id}:{digest}"


default_checkpointer_manager = CheckpointerManager()


def initialize_node(state: OpsPulseState) -> dict[str, Any]:
    """Initialize workflow state, budget, and tracking record."""
    run_id = state.get("run_id") or str(uuid.uuid4())
    thread_id = state.get("thread_id") or run_id
    tenant_id = state.get("tenant_id")
    user_id = state.get("user_id")
    if not tenant_id or not user_id:
        raise ValueError("Trusted tenant and user are required")
    question = state.get("question") or ""

    # Plan initial routing based on question terms
    lowered = question.lower()
    selected_tool = "get_business_kpis"
    selected_agent = "supervisor"
    tool_input: dict[str, Any] = {"window_days": 30}

    if "product" in lowered or "sku" in lowered or "almond" in lowered:
        selected_tool = "get_product_snapshot"
        selected_agent = "business_analyst"
        tool_input = {"product_id": question}
    elif "alert" in lowered or "risk" in lowered or "stock" in lowered:
        selected_tool = "get_inventory_risk"
        selected_agent = "inventory_agent"
        tool_input = {}
    elif "sales" in lowered or "revenue" in lowered or "volume" in lowered:
        selected_tool = "get_sales_summary"
        selected_agent = "business_analyst"
        tool_input = {}

    tasks = [{"agent": selected_agent, "tool": selected_tool, "input": tool_input}]
    mentions_demand = any(term in lowered for term in ("sale", "revenue", "demand", "volume"))
    mentions_inventory = any(term in lowered for term in ("inventory", "stock", "risk", "reorder"))
    if mentions_demand and mentions_inventory:
        if selected_agent != "business_analyst":
            tasks.append({"agent": "business_analyst", "tool": "get_sales_summary", "input": {}})
        if selected_agent != "inventory_agent":
            tasks.append({"agent": "inventory_agent", "tool": "get_inventory_risk", "input": {}})
    plan = {
        "tasks": tasks,
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
        "selected_agents": [task["agent"] for task in tasks],
        "agent_status": {task["agent"]: "running" for task in tasks},
        "execution_budget": {"max_tool_calls": 5, "calls_made": 0},
        "tool_execution_log": [],
        "sql_evidence": [],
        "prediction_evidence": [],
        "errors": [],
    }


def execute_tool_node(state: OpsPulseState) -> dict[str, Any]:
    """Execute the supervisor plan through the tenant-aware typed registry."""
    plan = state.get("execution_plan") or {}
    tasks = plan.get("tasks") or [{
        "tool": plan.get("selected_tool", "get_business_kpis"),
        "agent": plan.get("selected_agent", "supervisor"),
        "input": plan.get("tool_input", {}),
    }]
    tenant_id = state["tenant_id"]
    run_id = state["run_id"]
    budget = dict(state.get("execution_budget") or {"max_tool_calls": 5, "calls_made": 0})
    evidence, logs, findings, errors = [], [], [], []
    agent_status = dict(state.get("agent_status") or {})
    for step, task in enumerate(tasks[:budget["max_tool_calls"]], 1):
        tool, agent, payload = task["tool"], task["agent"], task["input"]
        started = time.perf_counter()
        result = default_registry.execute(
            tool_name=tool, agent_name=agent, tenant_id=tenant_id,
            raw_input=payload, correlation_id=run_id,
        )
        duration = int((time.perf_counter() - started) * 1000)
        status = "completed" if result.success else "failed"
        refs = result.evidence if result.success else []
        entry = {
            "tool_name": tool, "agent_name": agent, "success": result.success,
            "duration_ms": duration, "limitations": result.limitations,
        }
        findings.append(AgentFinding(
            agent_name=agent, status=status,
            summary=f"{tool} returned {len(refs)} evidence references",
            findings=[result.data] if result.success and isinstance(result.data, dict) else [],
            evidence=refs, limitations=result.limitations,
        ).model_dump(mode="json"))
        default_tracker.record_step(
            run_id=run_id, tenant_id=tenant_id, step_number=step, agent_name=agent,
            node_name="execute_tool", status=status, input_payload=payload,
            output_payload=result.data, tool_calls=[entry], duration_ms=duration,
        )
        evidence.extend(ref.model_dump(mode="json") for ref in refs)
        logs.append(entry)
        agent_status[agent] = status
        if not result.success:
            errors.extend(result.limitations)
    budget["calls_made"] += len(logs)
    return {
        "sql_evidence": evidence, "tool_execution_log": logs, "agent_status": agent_status,
        "agent_findings": findings, "validation_errors": errors, "execution_budget": budget,
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
        evidence_text = " ".join(
            f"{item.get('source_name')} ({item.get('source_type')}): {item.get('payload', {})}."
            for item in sql_evidence
        )
        final_answer = (
            f"Analysis complete for question: '{question}'. "
            f"Evidence: {evidence_text}"
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
        tenant_id=tenant_id,
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

    saver = checkpointer if checkpointer is not None else default_checkpointer_manager.get_saver()
    return graph.compile(checkpointer=saver)


def run_minimal_pipeline(
    question: str,
    tenant_id: str,
    user_id: str,
    run_id: str | None = None,
    thread_id: str | None = None,
    checkpointer: BaseCheckpointSaver | None = None,
) -> OpsPulseState:
    """Execute the pipeline and return the final state with tenant-namespaced checkpointing."""
    app = build_minimal_graph(checkpointer=checkpointer)
    actual_run_id = run_id or str(uuid.uuid4())
    actual_thread_id = thread_id or actual_run_id
    namespaced_thread = CheckpointerManager.namespace_thread_id(tenant_id, actual_thread_id, user_id)

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

    config = {"configurable": {"thread_id": namespaced_thread}}
    final_state = app.invoke(initial_state, config=config)
    return final_state
