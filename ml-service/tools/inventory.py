"""Deterministic inventory risk tools for OpsPulse.

Operates strictly on indicators supported by the actual schema (active alerts,
demand predictions, and sales velocity) without fabricating missing inventory,
cost, or margin records.
"""

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
    """Evaluate inventory risk indicators from active alerts and prediction decisions."""
    adapter = db or DatabaseAdapter()
    conditions = ["a.is_active = true"]
    params: list[Any] = []

    if payload.product_id:
        conditions.append("a.product_id::text = %s")
        params.append(str(payload.product_id))

    if payload.severity_filter:
        conditions.append("a.severity = %s")
        params.append(payload.severity_filter.upper())

    where_clause = "WHERE " + " AND ".join(conditions)

    sql = f"""
        SELECT
            a.id AS alert_id,
            a.product_id,
            p.name AS product_name,
            p.category,
            a.type AS alert_type,
            a.severity,
            a.message,
            a.percent_change,
            a.created_at AS alert_created_at,
            pr.decision AS prediction_decision,
            pr.confidence AS prediction_confidence,
            pr.predicted_demand,
            CASE
                WHEN a.type IN ('HIGH_DEMAND', 'TREND_UP') THEN 'potential_stockout_risk'
                WHEN a.type IN ('LOW_DEMAND', 'TREND_DOWN') THEN 'potential_overstock_risk'
                ELSE 'general_risk'
            END AS risk_category
        FROM alerts a
        JOIN products p ON p.id = a.product_id
        LEFT JOIN predictions pr ON pr.product_id = a.product_id
        {where_clause}
        ORDER BY
            CASE a.severity
                WHEN 'HIGH' THEN 1
                WHEN 'MEDIUM' THEN 2
                WHEN 'LOW' THEN 3
                ELSE 4
            END,
            a.created_at DESC
        LIMIT 50
    """

    try:
        rows = adapter.query(sql, tuple(params))

        high_demand_count = sum(1 for r in rows if r.get("alert_type") in ("HIGH_DEMAND", "TREND_UP"))
        low_demand_count = sum(1 for r in rows if r.get("alert_type") in ("LOW_DEMAND", "TREND_DOWN"))

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
            "Inventory risk is derived from active sales alerts and demand forecasts; physical stock levels and warehouse counts are not stored in the schema.",
        ]
        if not rows:
            limitations.append("No active inventory risk alerts found for the specified criteria.")

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
