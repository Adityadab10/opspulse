"""Evidence and provenance contracts for OpsPulse."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field


SourceType = Literal["live_sql", "vector_docs", "forecast", "kpi_calculation"]


class EvidenceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    source_type: SourceType
    source_name: str = Field(..., min_length=1, max_length=120)
    record_reference: str | None = None
    observed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = Field(default_factory=dict)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    limitations: list[str] = Field(default_factory=list)


class SqlEvidence(EvidenceReference):
    source_type: Literal["live_sql"] = "live_sql"
    query_name: str = Field(..., min_length=1)
    row_count: int = Field(default=0, ge=0)
    parameters: dict[str, Any] = Field(default_factory=dict)


class ForecastEvidence(EvidenceReference):
    source_type: Literal["forecast"] = "forecast"
    model_name: str = Field(..., min_length=1)
    horizon_days: int = Field(default=30, gt=0)
    historical_points: int = Field(default=0, ge=0)
    routing_reason: str = Field(..., min_length=1)


class DocumentEvidence(EvidenceReference):
    source_type: Literal["vector_docs"] = "vector_docs"
    document_key: str = Field(..., min_length=1)
    similarity: float | None = Field(default=None, ge=-1.0, le=1.0)
