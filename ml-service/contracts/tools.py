"""Input and output schemas for deterministic analytics tools."""

from __future__ import annotations

from datetime import date
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from contracts.evidence import EvidenceReference


# Base Tool Payload
class ToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool
    data: dict[str, Any] = Field(default_factory=dict)
    evidence: list[EvidenceReference] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    error: str | None = None


# Sales Summary
class SalesSummaryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_date: date | None = None
    end_date: date | None = None
    product_id: str | None = None


class SalesSummaryOutput(ToolResult):
    total_sales_volume: int = 0
    record_count: int = 0
    unique_products_sold: int = 0
    average_daily_sales: float = 0.0


# Sales Comparison
class SalesComparisonInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_start: date | None = None
    current_end: date | None = None
    previous_start: date | None = None
    previous_end: date | None = None
    window_days: int = Field(default=30, ge=1, le=365)
    product_id: str | None = None


class SalesComparisonOutput(ToolResult):
    recent_sales: int = 0
    previous_sales: int = 0
    percent_change: float = 0.0
    trend_direction: str = "stable"  # "increasing" | "decreasing" | "stable"


# Product Performance
class ProductPerformanceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=10, ge=1, le=50)
    category: str | None = None
    sort_by: str = Field(default="sales_volume")  # "sales_volume" | "percent_change"


class ProductPerformanceOutput(ToolResult):
    products: list[dict[str, Any]] = Field(default_factory=list)
    total_evaluated: int = 0


# Product Snapshot
class ProductSnapshotInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str = Field(..., min_length=1)


class ProductSnapshotOutput(ToolResult):
    product_found: bool = False
    product: dict[str, Any] | None = None
    sales_history_rows: int = 0
    latest_prediction: dict[str, Any] | None = None
    active_alerts: list[dict[str, Any]] = Field(default_factory=list)


# Inventory Risk (supported by actual schema: alerts + demand vs historical sales)
class InventoryRiskInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str | None = None
    severity_filter: str | None = None


class InventoryRiskOutput(ToolResult):
    risks: list[dict[str, Any]] = Field(default_factory=list)
    high_demand_count: int = 0
    low_demand_count: int = 0
    total_active_alerts: int = 0


# Demand Forecast Retrieval & Adaptive Routing
class DemandForecastInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str = Field(..., min_length=1)
    force_model: str | None = None  # None | "prophet" | "arima"


class DemandForecastOutput(ToolResult):
    product_id: str
    product_name: str | None = None
    selected_model: str = "insufficient_data"  # "prophet" | "arima" | "insufficient_data"
    forecast_30d: int | None = None
    historical_points: int = 0
    routing_reason: str = ""
    prophet_metrics: dict[str, Any] | None = None
    arima_metrics: dict[str, Any] | None = None
    raw_prediction: dict[str, Any] | None = None


# Business KPIs
class BusinessKpisInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    window_days: int = Field(default=30, ge=1, le=365)


class BusinessKpisOutput(ToolResult):
    total_products: int = 0
    total_sales_volume: int = 0
    avg_daily_sales: float = 0.0
    avg_monthly_sales: float = 0.0
    active_alerts: int = 0
    top_increasing: list[dict[str, Any]] = Field(default_factory=list)
    top_decreasing: list[dict[str, Any]] = Field(default_factory=list)
