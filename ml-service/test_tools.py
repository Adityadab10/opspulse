"""Unit tests for OpsPulse deterministic analytics tools and tool registry (T03 & T04)."""

from datetime import datetime, timezone
import pytest

from contracts.tools import (
    BusinessKpisInput,
    DemandForecastInput,
    InventoryRiskInput,
    ProductPerformanceInput,
    ProductSnapshotInput,
    SalesComparisonInput,
    SalesSummaryInput,
)
from tools import (
    ToolNotFoundError,
    ToolPermissionError,
    ToolRegistry,
    default_registry,
)
from tools.db import DatabaseAdapter


# Mock Database Adapter for deterministic in-memory tests
class MockDatabaseAdapter(DatabaseAdapter):

    def __init__(self, query_handler):
        super().__init__()
        self._handler = query_handler

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        return self._handler(sql, params)

    def query_one(self, sql: str, params: tuple = ()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None


def test_sales_summary_calculation():
    def mock_db(sql, params):
        return [{"total_volume": 450, "record_count": 15, "unique_products": 3}]

    adapter = MockDatabaseAdapter(mock_db)
    result = default_registry.execute(
        tool_name="get_sales_summary",
        agent_name="business_analyst",
        tenant_id="test-tenant",
        raw_input=SalesSummaryInput(),
        db=adapter,
    )
    assert result.success is True
    assert result.total_sales_volume == 450
    assert result.record_count == 15
    assert result.unique_products_sold == 3
    assert result.average_daily_sales == 15.0  # 450 / 30
    assert len(result.evidence) == 1
    assert result.evidence[0].source_name == "sales"


def test_compare_sales_periods_trend_parity():
    # Test case 1: Positive growth
    def mock_growth(sql, params):
        return [{"recent_sales": 150, "prev_sales": 100, "total_rows": 20}]

    adapter_growth = MockDatabaseAdapter(mock_growth)
    res_growth = default_registry.execute(
        tool_name="compare_sales_periods",
        agent_name="business_analyst",
        tenant_id="test-tenant",
        raw_input=SalesComparisonInput(window_days=30),
        db=adapter_growth,
    )
    assert res_growth.success is True
    assert res_growth.recent_sales == 150
    assert res_growth.previous_sales == 100
    assert res_growth.percent_change == 50.0
    assert res_growth.trend_direction == "increasing"

    # Test case 2: Previous sales = 0, recent sales > 0 -> 100% increasing
    def mock_new_item(sql, params):
        return [{"recent_sales": 50, "prev_sales": 0, "total_rows": 5}]

    res_new = default_registry.execute(
        tool_name="compare_sales_periods",
        agent_name="business_analyst",
        tenant_id="test-tenant",
        raw_input=SalesComparisonInput(window_days=30),
        db=MockDatabaseAdapter(mock_new_item),
    )
    assert res_new.percent_change == 100.0
    assert res_new.trend_direction == "increasing"


def test_product_snapshot_found_and_not_found():
    # Not found case
    def mock_empty(sql, params):
        return []

    res_nf = default_registry.execute(
        tool_name="get_product_snapshot",
        agent_name="inventory_agent",
        tenant_id="test-tenant",
        raw_input=ProductSnapshotInput(product_id="nonexistent-sku"),
        db=MockDatabaseAdapter(mock_empty),
    )
    assert res_nf.success is True
    assert res_nf.product_found is False
    assert len(res_nf.limitations) > 0

    # Found case
    def mock_found(sql, params):
        if "FROM products" in sql:
            return [{"id": "p-1", "name": "Almonds 500g", "category": "Snacks", "created_at": "2024-01-01"}]
        if "FROM sales" in sql:
            return [{"total_sales": 300, "sales_rows": 12, "latest_sale_at": "2024-03-01", "average_sale_quantity": 25.0}]
        if "FROM predictions" in sql:
            return [{"predicted_demand": 320, "decision": "increase", "confidence": "High", "percent_change": 6.7}]
        if "FROM alerts" in sql:
            return [{"id": "a-1", "type": "HIGH_DEMAND", "severity": "HIGH", "message": "Spike in orders"}]
        return []

    res_found = default_registry.execute(
        tool_name="get_product_snapshot",
        agent_name="inventory_agent",
        tenant_id="test-tenant",
        raw_input=ProductSnapshotInput(product_id="p-1"),
        db=MockDatabaseAdapter(mock_found),
    )
    assert res_found.success is True
    assert res_found.product_found is True
    assert res_found.product["name"] == "Almonds 500g"
    assert res_found.sales_history_rows == 12
    assert res_found.latest_prediction["decision"] == "increase"
    assert len(res_found.active_alerts) == 1


def test_demand_forecast_adaptive_routing():
    # Case 1: N >= 21 -> Prophet selected
    def mock_25_sales(sql, params):
        if "FROM products" in sql:
            return [{"id": "p-prophet", "name": "Organic Milk", "category": "Dairy"}]
        if "FROM sales" in sql:
            return [{"date": f"2024-01-{i:02d}", "quantity": 10} for i in range(1, 26)]
        if "FROM predictions" in sql:
            return [{"ml_prediction": 300, "adjusted_prediction": 315}]
        return []

    res_prophet = default_registry.execute(
        tool_name="get_demand_forecast",
        agent_name="inventory_agent",
        tenant_id="test-tenant",
        raw_input=DemandForecastInput(product_id="p-prophet"),
        db=MockDatabaseAdapter(mock_25_sales),
    )
    assert res_prophet.success is True
    assert res_prophet.selected_model == "prophet"
    assert res_prophet.historical_points == 25
    assert res_prophet.forecast_30d == 300

    # Case 2: 5 <= N < 21 -> ARIMA selected
    def mock_10_sales(sql, params):
        if "FROM products" in sql:
            return [{"id": "p-arima", "name": "Artisan Cheese", "category": "Dairy"}]
        if "FROM sales" in sql:
            return [{"date": f"2024-01-{i:02d}", "quantity": 5} for i in range(1, 11)]
        if "FROM predictions" in sql:
            return [{"ml_prediction": 60, "adjusted_prediction": 60}]
        return []

    res_arima = default_registry.execute(
        tool_name="get_demand_forecast",
        agent_name="inventory_agent",
        tenant_id="test-tenant",
        raw_input=DemandForecastInput(product_id="p-arima"),
        db=MockDatabaseAdapter(mock_10_sales),
    )
    assert res_arima.success is True
    assert res_arima.selected_model == "arima"
    assert res_arima.historical_points == 10

    # Case 3: N < 5 -> insufficient_data
    def mock_3_sales(sql, params):
        if "FROM products" in sql:
            return [{"id": "p-sparse", "name": "New Truffle Oil", "category": "Gourmet"}]
        if "FROM sales" in sql:
            return [{"date": f"2024-01-{i:02d}", "quantity": 2} for i in range(1, 4)]
        return []

    res_sparse = default_registry.execute(
        tool_name="get_demand_forecast",
        agent_name="inventory_agent",
        tenant_id="test-tenant",
        raw_input=DemandForecastInput(product_id="p-sparse"),
        db=MockDatabaseAdapter(mock_3_sales),
    )
    assert res_sparse.success is True
    assert res_sparse.selected_model == "insufficient_data"
    assert res_sparse.forecast_30d is None
    assert "Fewer than 5 observations" in res_sparse.routing_reason


def test_inventory_risk_aggregation():
    def mock_alerts(sql, params):
        return [
            {"alert_id": "a1", "alert_type": "HIGH_DEMAND", "severity": "HIGH", "product_name": "Almonds", "risk_category": "potential_stockout_risk"},
            {"alert_id": "a2", "alert_type": "LOW_DEMAND", "severity": "MEDIUM", "product_name": "Walnuts", "risk_category": "potential_overstock_risk"},
        ]

    res = default_registry.execute(
        tool_name="get_inventory_risk",
        agent_name="inventory_agent",
        tenant_id="test-tenant",
        raw_input=InventoryRiskInput(),
        db=MockDatabaseAdapter(mock_alerts),
    )
    assert res.success is True
    assert res.high_demand_count == 1
    assert res.low_demand_count == 1
    assert res.total_active_alerts == 2


def test_business_kpis_parity():
    def mock_kpis(sql, params):
        if "COUNT(*) FROM products" in sql:
            return [{"total_products": 10, "total_sales_volume": 3000, "active_alerts": 4}]
        if "GROUP BY p.id" in sql:
            return [
                {"id": "p1", "name": "Item A", "total_qty": 1000, "recent_qty": 600, "prev_qty": 400},
                {"id": "p2", "name": "Item B", "total_qty": 800, "recent_qty": 200, "prev_qty": 400},
            ]
        return []

    res = default_registry.execute(
        tool_name="get_business_kpis",
        agent_name="supervisor",
        tenant_id="test-tenant",
        raw_input=BusinessKpisInput(),
        db=MockDatabaseAdapter(mock_kpis),
    )
    assert res.success is True
    assert res.total_products == 10
    assert res.total_sales_volume == 3000
    assert res.avg_daily_sales == 100.0  # 3000 / 30
    assert res.avg_monthly_sales == 300.0  # 3000 / 10
    assert res.active_alerts == 4
    assert len(res.top_increasing) > 0
    assert res.top_increasing[0]["name"] == "Item A"


def test_tool_registry_security_enforcement():
    # Test 1: Unauthorized agent call
    # inventory_agent is NOT authorized to call compare_sales_periods
    with pytest.raises(ToolPermissionError, match="not authorized"):
        default_registry.execute(
            tool_name="compare_sales_periods",
            agent_name="inventory_agent",
            tenant_id="test-tenant",
            raw_input={"window_days": 30},
        )

    # Test 2: Unregistered tool lookup
    with pytest.raises(ToolNotFoundError, match="not registered"):
        default_registry.execute(
            tool_name="execute_sql",
            agent_name="supervisor",
            tenant_id="test-tenant",
            raw_input={},
        )

    # Test 3: Missing tenant ID rejection
    with pytest.raises(PermissionError, match="tenant_id is required"):
        default_registry.execute(
            tool_name="get_sales_summary",
            agent_name="business_analyst",
            tenant_id="",  # Empty tenant ID
            raw_input={},
        )
