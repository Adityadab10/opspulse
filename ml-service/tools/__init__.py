"""Centralized tool registry and permission gate for OpsPulse agents."""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Type
from pydantic import BaseModel, ConfigDict, ValidationError

from contracts.tools import (
    BusinessKpisInput,
    BusinessKpisOutput,
    DemandForecastInput,
    DemandForecastOutput,
    InventoryRiskInput,
    InventoryRiskOutput,
    ProductPerformanceInput,
    ProductPerformanceOutput,
    ProductSnapshotInput,
    ProductSnapshotOutput,
    SalesComparisonInput,
    SalesComparisonOutput,
    SalesSummaryInput,
    SalesSummaryOutput,
    ToolResult,
)
from tools.db import DatabaseAdapter
from tools.forecasting import get_demand_forecast
from tools.inventory import get_inventory_risk
from tools.kpis import get_business_kpis
from tools.products import get_product_performance, get_product_snapshot
from tools.sales import compare_sales_periods, get_sales_summary

logger = logging.getLogger(__name__)


class ToolDefinition(BaseModel):
    name: str
    description: str
    input_schema: Type[BaseModel]
    output_schema: Type[ToolResult]
    authorized_agents: list[str]

    model_config = ConfigDict(arbitrary_types_allowed=True)


class ToolPermissionError(PermissionError):
    """Raised when an unauthorized agent attempts to call a restricted tool."""


class ToolNotFoundError(LookupError):
    """Raised when a requested tool does not exist in the registry."""


class ToolExecutionError(RuntimeError):
    """Raised when tool execution fails unexpectedly."""


class ToolRegistry:
    """Central registry and security gate for deterministic analytics tools."""

    def __init__(self):
        self._tools: dict[str, tuple[ToolDefinition, Callable[..., ToolResult]]] = {}
        self._register_default_tools()

    def register(
        self,
        name: str,
        description: str,
        input_schema: Type[BaseModel],
        output_schema: Type[ToolResult],
        authorized_agents: list[str],
        handler: Callable[..., ToolResult],
    ) -> None:
        defn = ToolDefinition(
            name=name,
            description=description,
            input_schema=input_schema,
            output_schema=output_schema,
            authorized_agents=authorized_agents,
        )
        self._tools[name] = (defn, handler)

    def _register_default_tools(self) -> None:
        self.register(
            name="get_sales_summary",
            description="Retrieve total sales volume, records, and daily average.",
            input_schema=SalesSummaryInput,
            output_schema=SalesSummaryOutput,
            authorized_agents=["supervisor", "business_analyst", "financial_analyst"],
            handler=get_sales_summary,
        )
        self.register(
            name="compare_sales_periods",
            description="Compare recent window vs previous window for growth trends.",
            input_schema=SalesComparisonInput,
            output_schema=SalesComparisonOutput,
            authorized_agents=["supervisor", "business_analyst", "financial_analyst"],
            handler=compare_sales_periods,
        )
        self.register(
            name="get_product_performance",
            description="Ranked product performance metrics.",
            input_schema=ProductPerformanceInput,
            output_schema=ProductPerformanceOutput,
            authorized_agents=["supervisor", "business_analyst", "inventory_agent"],
            handler=get_product_performance,
        )
        self.register(
            name="get_product_snapshot",
            description="Full profile of product catalog, sales, predictions, and alerts.",
            input_schema=ProductSnapshotInput,
            output_schema=ProductSnapshotOutput,
            authorized_agents=["supervisor", "business_analyst", "inventory_agent"],
            handler=get_product_snapshot,
        )
        self.register(
            name="get_inventory_risk",
            description="Evaluate active demand/stockout/overstock risks supported by schema.",
            input_schema=InventoryRiskInput,
            output_schema=InventoryRiskOutput,
            authorized_agents=["supervisor", "inventory_agent"],
            handler=get_inventory_risk,
        )
        self.register(
            name="get_demand_forecast",
            description="Adaptive demand forecast retrieval with Prophet and ARIMA routing.",
            input_schema=DemandForecastInput,
            output_schema=DemandForecastOutput,
            authorized_agents=["supervisor", "inventory_agent", "business_analyst"],
            handler=get_demand_forecast,
        )
        self.register(
            name="get_business_kpis",
            description="Executive business KPIs with dashboard parity.",
            input_schema=BusinessKpisInput,
            output_schema=BusinessKpisOutput,
            authorized_agents=["supervisor", "business_analyst", "financial_analyst", "reporting_agent"],
            handler=get_business_kpis,
        )

    def list_tools(self, agent_name: str | None = None) -> list[ToolDefinition]:
        """List all tools, optionally filtered by agent authorization."""
        if agent_name is None:
            return [defn for defn, _ in self._tools.values()]
        return [
            defn for defn, _ in self._tools.values()
            if agent_name in defn.authorized_agents or "*" in defn.authorized_agents
        ]

    def execute(
        self,
        tool_name: str,
        agent_name: str,
        tenant_id: str,
        raw_input: dict[str, Any] | BaseModel,
        db: DatabaseAdapter | None = None,
        correlation_id: str = "internal",
    ) -> ToolResult:
        """Execute a tool with strict permission, schema validation, and tenant scoping."""
        started = time.perf_counter()

        if tool_name not in self._tools:
            logger.warning(
                "Tool execution rejected: tool '%s' not found (agent=%s, correlation=%s)",
                tool_name,
                agent_name,
                correlation_id,
            )
            raise ToolNotFoundError(f"Tool '{tool_name}' is not registered.")

        defn, handler = self._tools[tool_name]

        # Enforce agent authorization
        if agent_name not in defn.authorized_agents and "*" not in defn.authorized_agents:
            logger.warning(
                "Tool execution forbidden: agent '%s' unauthorized for tool '%s' (correlation=%s)",
                agent_name,
                tool_name,
                correlation_id,
            )
            raise ToolPermissionError(
                f"Agent '{agent_name}' is not authorized to execute tool '{tool_name}'."
            )

        # Enforce tenant isolation
        if not tenant_id or not tenant_id.strip():
            logger.error("Tool execution rejected: missing trusted tenant_id (correlation=%s)", correlation_id)
            raise PermissionError("Trusted tenant_id is required for tool execution.")

        # Validate input schema
        try:
            if isinstance(raw_input, defn.input_schema):
                validated_input = raw_input
            elif isinstance(raw_input, dict):
                validated_input = defn.input_schema.model_validate(raw_input)
            else:
                validated_input = defn.input_schema.model_validate(raw_input.model_dump())
        except ValidationError as exc:
            logger.warning(
                "Tool input validation failed for '%s': %s (correlation=%s)",
                tool_name,
                exc.errors(),
                correlation_id,
            )
            return defn.output_schema(
                success=False,
                error=f"Invalid tool input: {exc.errors()}",
                limitations=["Input schema validation failed"],
            )

        # Execute handler with injected tenant_id and db adapter
        try:
            result = handler(tenant_id=tenant_id, payload=validated_input, db=db)
            duration_ms = (time.perf_counter() - started) * 1000
            logger.info(
                "Tool '%s' executed successfully by '%s' tenant=%s duration_ms=%.1f correlation=%s",
                tool_name,
                agent_name,
                tenant_id,
                duration_ms,
                correlation_id,
            )
            return result
        except Exception as exc:
            duration_ms = (time.perf_counter() - started) * 1000
            logger.exception(
                "Tool '%s' execution failed: %s (agent=%s, tenant=%s, correlation=%s)",
                tool_name,
                str(exc),
                agent_name,
                tenant_id,
                correlation_id,
            )
            return defn.output_schema(
                success=False,
                error=f"Tool execution failed: {str(exc)}",
                limitations=["Unexpected runtime error in tool handler"],
            )


# Global default registry instance
default_registry = ToolRegistry()
