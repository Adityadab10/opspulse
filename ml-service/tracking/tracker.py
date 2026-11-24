"""Execution tracking for OpsPulse agent runs and graph steps (T01 & T06)."""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timezone
import json
import logging
from typing import Any
import uuid

from contracts.state import AgentExecutionStatus, RunLifecycleStatus
from tools.db import DatabaseAdapter

logger = logging.getLogger(__name__)

MAX_MEMORY_RUNS_DEFAULT = 500


class RunTracker:
    """Manages lifecycle persistence of agent_runs and agent_steps in PostgreSQL with bounded fallback."""

    def __init__(self, db: DatabaseAdapter | None = None, max_memory_runs: int = MAX_MEMORY_RUNS_DEFAULT):
        self._db = db or DatabaseAdapter()
        self._max_memory_runs = max_memory_runs
        # Bounded FIFO/LRU storage for test/offline fallback
        self._memory_runs: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._memory_steps: dict[str, list[dict[str, Any]]] = {}
        self._persistence_degraded: bool = False
        self._last_persistence_error: str | None = None

    def get_persistence_status(self) -> dict[str, Any]:
        """Return current status of database tracking persistence."""
        return {
            "persistence_degraded": self._persistence_degraded,
            "last_persistence_error": self._last_persistence_error,
            "in_memory_runs_count": len(self._memory_runs),
            "max_memory_runs": self._max_memory_runs,
        }

    def _evict_oldest_if_needed(self) -> None:
        while len(self._memory_runs) >= self._max_memory_runs:
            oldest_id, _ = self._memory_runs.popitem(last=False)
            self._memory_steps.pop(oldest_id, None)

    def create_run(
        self,
        tenant_id: str,
        user_id: str,
        question: str,
        thread_id: str | None = None,
        trigger_type: str = "on_demand",
        trigger_metadata: dict[str, Any] | None = None,
        run_id: str | None = None,
    ) -> str:
        actual_run_id = run_id or str(uuid.uuid4())
        actual_thread_id = thread_id or actual_run_id
        meta = trigger_metadata or {}

        sql = """
            INSERT INTO agent_runs (
                id, tenant_id, user_id, thread_id, trigger_type,
                trigger_metadata, question, status, started_at
            ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, 'running', now())
            RETURNING id
        """
        try:
            self._db.query_one(
                sql,
                (actual_run_id, tenant_id, user_id, actual_thread_id, trigger_type, json.dumps(meta), question),
            )
            self._persistence_degraded = False
        except Exception as exc:
            self._persistence_degraded = True
            self._last_persistence_error = str(exc)
            logger.warning("DB insert into agent_runs failed (using in-memory fallback): %s", exc)

        # Record in bounded memory
        self._evict_oldest_if_needed()
        self._memory_runs[actual_run_id] = {
            "id": actual_run_id,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "thread_id": actual_thread_id,
            "trigger_type": trigger_type,
            "trigger_metadata": meta,
            "question": question,
            "status": "running",
            "started_at": datetime.now(timezone.utc),
            "selected_agents": [],
            "final_answer": None,
            "confidence": None,
            "limitations": [],
        }
        self._memory_steps[actual_run_id] = []
        return actual_run_id

    def update_run_status(
        self,
        run_id: str,
        status: RunLifecycleStatus,
        final_answer: str | None = None,
        confidence: float | None = None,
        limitations: list[str] | None = None,
        selected_agents: list[str] | None = None,
        execution_plan: dict[str, Any] | None = None,
        error_message: str | None = None,
        duration_ms: int | None = None,
        tenant_id: str | None = None,
    ) -> None:
        tenant_id = tenant_id or (self._memory_runs.get(run_id) or {}).get("tenant_id")
        if not tenant_id:
            raise ValueError("Tenant context is required to update a run")
        db_status = str(status)
        if db_status == "insufficient_evidence":
            db_status = "partial"
        elif db_status == "error":
            db_status = "failed"
        elif db_status == "planning":
            db_status = "running"

        sql = """
            UPDATE agent_runs
            SET status = %s,
                final_answer = %s,
                confidence = %s,
                limitations = %s::jsonb,
                selected_agents = %s::jsonb,
                execution_plan = %s::jsonb,
                error_message = %s,
                completed_at = now(),
                duration_ms = %s
            WHERE id::text = %s AND tenant_id = %s
        """
        try:
            self._db.query_one(
                sql,
                (
                    db_status,
                    final_answer,
                    confidence,
                    json.dumps(limitations or []),
                    json.dumps(selected_agents or []),
                    json.dumps(execution_plan or {}),
                    error_message,
                    duration_ms,
                    run_id,
                    tenant_id,
                ),
            )
            self._persistence_degraded = False
        except Exception as exc:
            self._persistence_degraded = True
            self._last_persistence_error = str(exc)
            logger.warning("DB update agent_runs failed: %s", exc)

        if (self._memory_runs.get(run_id) or {}).get("tenant_id") == tenant_id:
            run = self._memory_runs[run_id]
            run["status"] = status
            run["final_answer"] = final_answer
            run["confidence"] = confidence
            run["limitations"] = limitations or []
            run["selected_agents"] = selected_agents or []
            run["error_message"] = error_message
            run["duration_ms"] = duration_ms
            run["completed_at"] = datetime.now(timezone.utc)

    def record_step(
        self,
        run_id: str,
        tenant_id: str,
        step_number: int,
        agent_name: str,
        node_name: str,
        status: AgentExecutionStatus,
        input_payload: dict[str, Any] | None = None,
        output_payload: dict[str, Any] | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
        error_message: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        step_record = {
            "run_id": run_id,
            "tenant_id": tenant_id,
            "step_number": step_number,
            "agent_name": agent_name,
            "node_name": node_name,
            "status": status,
            "input_payload": input_payload or {},
            "output_payload": output_payload or {},
            "tool_calls": tool_calls or [],
            "error_message": error_message,
            "duration_ms": duration_ms,
            "started_at": datetime.now(timezone.utc),
        }

        db_status = str(status)
        if db_status == "pending":
            db_status = "running"

        sql = """
            INSERT INTO agent_steps (
                run_id, tenant_id, step_number, agent_name, node_name,
                status, input_payload, output_payload, tool_calls,
                error_message, duration_ms, started_at, completed_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, now(), now())
            ON CONFLICT (tenant_id, run_id, step_number) DO UPDATE SET
                status = EXCLUDED.status,
                output_payload = EXCLUDED.output_payload,
                tool_calls = EXCLUDED.tool_calls,
                error_message = EXCLUDED.error_message,
                duration_ms = EXCLUDED.duration_ms,
                completed_at = now()
        """
        try:
            self._db.query_one(
                sql,
                (
                    run_id,
                    tenant_id,
                    step_number,
                    agent_name,
                    node_name,
                    db_status,
                    json.dumps(input_payload or {}),
                    json.dumps(output_payload or {}),
                    json.dumps(tool_calls or []),
                    error_message,
                    duration_ms,
                ),
            )
            self._persistence_degraded = False
        except Exception as exc:
            self._persistence_degraded = True
            self._last_persistence_error = str(exc)
            logger.warning("DB insert agent_steps failed: %s", exc)

        if run_id not in self._memory_steps:
            self._memory_steps[run_id] = []
        self._memory_steps[run_id].append(step_record)

    def get_run(self, run_id: str, tenant_id: str) -> dict[str, Any] | None:
        sql = """
            SELECT id, tenant_id, user_id, thread_id, trigger_type,
                   trigger_metadata, question, status, execution_plan,
                   selected_agents, final_answer, confidence, limitations,
                   error_message, started_at, completed_at, duration_ms
            FROM agent_runs
            WHERE id::text = %s AND tenant_id = %s
        """
        try:
            row = self._db.query_one(sql, (run_id, tenant_id))
            if row:
                return row
        except Exception as exc:
            logger.warning("DB query agent_runs failed: %s", exc)

        run = self._memory_runs.get(run_id)
        if run and run.get("tenant_id") == tenant_id:
            return run
        return None

    def get_steps(self, run_id: str, tenant_id: str) -> list[dict[str, Any]]:
        sql = """
            SELECT id, run_id, tenant_id, step_number, agent_name, node_name,
                   status, input_payload, output_payload, tool_calls,
                   error_message, started_at, completed_at, duration_ms
            FROM agent_steps
            WHERE run_id::text = %s AND tenant_id = %s
            ORDER BY step_number ASC
        """
        try:
            rows = self._db.query(sql, (run_id, tenant_id))
            if rows:
                return rows
        except Exception as exc:
            logger.warning("DB query agent_steps failed: %s", exc)

        return [
            s for s in self._memory_steps.get(run_id, [])
            if s.get("tenant_id") == tenant_id
        ]


default_tracker = RunTracker()
