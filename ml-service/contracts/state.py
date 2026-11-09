"""State and agent execution contracts for OpsPulse multi-agent orchestration."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, TypedDict
from pydantic import BaseModel, ConfigDict, Field

from contracts.evidence import EvidenceReference


AgentExecutionStatus = Literal[
    "running",
    "completed",
    "insufficient_evidence",
    "partial",
    "failed",
    "skipped",
]

RunLifecycleStatus = Literal[
    "running",
    "completed",
    "failed",
    "partial",
    "cancelled",
]

TriggerType = Literal["on_demand", "scheduled", "event"]


class AgentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    tenant_id: str
    user_id: str
    question: str
    context: dict[str, Any] = Field(default_factory=dict)
    allowed_tools: list[str] = Field(default_factory=list)


class AgentFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_name: str = Field(..., min_length=1, max_length=64)
    status: AgentExecutionStatus
    summary: str = Field(..., min_length=1)
    findings: list[dict[str, Any]] = Field(default_factory=list)
    evidence: list[EvidenceReference] = Field(default_factory=list)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    limitations: list[str] = Field(default_factory=list)
    recommended_next_steps: list[str] = Field(default_factory=list)


class ExecutionMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    duration_ms: int | None = None
    tool_call_count: int = 0
    token_usage: dict[str, int] = Field(default_factory=dict)


class AgentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    finding: AgentFinding
    execution_metadata: ExecutionMetadata = Field(default_factory=ExecutionMetadata)


class ExecutionBudget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_tool_calls: int = 15
    timeout_seconds: float = 30.0
    max_retries: int = 2
    max_tokens: int = 4000


class OpsPulseState(TypedDict, total=False):
    # Identity (immutable, established by trusted middleware)
    run_id: str
    thread_id: str
    tenant_id: str
    user_id: str

    # Trigger
    trigger_type: TriggerType
    trigger_metadata: dict[str, Any]

    # Request
    question: str
    conversation_context: list[dict[str, Any]]

    # Planning
    intent: str
    execution_plan: dict[str, Any]
    selected_agents: list[str]

    # Execution
    agent_status: dict[str, AgentExecutionStatus]
    agent_findings: list[dict[str, Any]]
    tool_execution_log: list[dict[str, Any]]

    # Evidence
    retrieved_documents: list[dict[str, Any]]
    sql_evidence: list[dict[str, Any]]
    prediction_evidence: list[dict[str, Any]]

    # Validation
    evidence_valid: bool
    validation_errors: list[str]
    confidence: float | None

    # Response
    final_answer: str
    citations: list[dict[str, Any]]
    recommendations: list[dict[str, Any]]

    # Approval
    proposed_actions: list[dict[str, Any]]
    approval_required: bool
    approval_status: str | None

    # Controls
    execution_budget: dict[str, Any]
    errors: list[dict[str, Any]]
    status: RunLifecycleStatus
