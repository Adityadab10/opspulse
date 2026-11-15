"""Read-only, tenant-scoped inventory health tool backed by stock and forecasts."""

from __future__ import annotations

from typing import Any

from contracts.evidence import SqlEvidence
from contracts.tools import InventoryRiskInput, InventoryRiskOutput
from tools.db import DatabaseAdapter


def get_inventory_risk(
    tenant_id: str,
    payload: InventoryRiskInput,
    db: DatabaseAdapter | None = None,
) -> InventoryRiskOutput:
    """Evaluate low stock, stockout, and overstock from supported stored data."""
    adapter = db or DatabaseAdapter()
    if not (adapter.has_tenant_column("products") and adapter.has_tenant_column("predictions")):
        return InventoryRiskOutput(
            success=False,
            error="Tenant isolation schema not established: core tables lack 'tenant_id'. Apply migration 005_tenant_isolation.sql.",
            limitations=["Database schema not ready for tenant-isolated execution"],
        )

    conditions = ["p.tenant_id = %s"]
    params: list[Any] = [tenant_id]

    if payload.product_id:
        conditions.append("p.id::text = %s")
        params.append(str(payload.product_id))

    where_clause = "WHERE " + " AND ".join(conditions)

    sql = f"""
        SELECT
            p.id AS product_id,
            p.name AS product_name,
            p.category,
            p.stock_quantity,
            p.reorder_threshold,
            pr.predicted_demand,
            pr.prediction_horizon_days,
            CASE
                WHEN pr.predicted_demand IS NULL THEN 'forecast_unavailable'
                WHEN p.stock_quantity < pr.predicted_demand THEN 'stockout_risk'
                WHEN pr.predicted_demand > 0 AND p.stock_quantity >= pr.predicted_demand * 2 THEN 'overstock'
                WHEN p.stock_quantity <= p.reorder_threshold THEN 'low_stock'
                ELSE 'healthy'
            END AS risk_category
        FROM products p
        LEFT JOIN predictions pr ON pr.product_id = p.id AND pr.tenant_id = p.tenant_id
        {where_clause}
        ORDER BY p.name
        LIMIT 50
    """

    try:
        rows = adapter.query(sql, tuple(params))

        high_demand_count = sum(1 for r in rows if r.get("risk_category") == "stockout_risk")
        low_demand_count = sum(1 for r in rows if r.get("risk_category") == "overstock")

        evidence = SqlEvidence(
            source_name="alerts",
            query_name="get_inventory_risk",
            row_count=len(rows),
            parameters={"product_id": payload.product_id, "severity": payload.severity_filter},
            payload={
                "risk_items_count": len(rows),
                "high_demand_count": high_demand_count,
                "low_demand_count": low_demand_count,
            },
        )

        limitations = [
            "Reorder advice is advisory: it compares current stock to persisted forecast demand. Supplier lead time is not available.",
        ]
        if not rows:
            limitations.append("No products matched the specified criteria.")

        return InventoryRiskOutput(
            success=True,
            risks=rows,
            high_demand_count=high_demand_count,
            low_demand_count=low_demand_count,
            total_active_alerts=len(rows),
            evidence=[evidence],
            limitations=limitations,
            data={"risks": rows, "high_demand_count": high_demand_count, "low_demand_count": low_demand_count},
        )
    except Exception as exc:
        return InventoryRiskOutput(
            success=False,
            error=f"Failed to query inventory risk: {str(exc)}",
            limitations=["Database query failed"],
        )
