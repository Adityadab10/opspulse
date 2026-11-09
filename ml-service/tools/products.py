"""Deterministic product analytics tools for OpsPulse."""

from __future__ import annotations

from typing import Any

from contracts.evidence import SqlEvidence
from contracts.tools import (
    ProductPerformanceInput,
    ProductPerformanceOutput,
    ProductSnapshotInput,
    ProductSnapshotOutput,
)
from tools.db import DatabaseAdapter


def get_product_snapshot(
    tenant_id: str,
    payload: ProductSnapshotInput,
    db: DatabaseAdapter | None = None,
) -> ProductSnapshotOutput:
    """Retrieve full product profile: catalog info, sales aggregate, latest prediction, and active alerts."""
    adapter = db or DatabaseAdapter()
    product_ref = payload.product_id.strip()

    # Step 1: Resolve product
    product_sql = """
        SELECT id, name, category, created_at, updated_at, legacy_mongo_id
        FROM products
        WHERE id::text = %s OR legacy_mongo_id = %s OR lower(name) = lower(%s)
        LIMIT 1
    """
    try:
        product = adapter.query_one(product_sql, (product_ref, product_ref, product_ref))
        if not product:
            return ProductSnapshotOutput(
                success=True,
                product_found=False,
                limitations=[f"No product found matching reference '{product_ref}'"],
            )

        product_id = str(product["id"])

        # Step 2: Sales history metrics
        sales_sql = """
            SELECT
                COALESCE(SUM(quantity), 0) AS total_sales,
                COUNT(*) AS sales_rows,
                MAX(sale_date) AS latest_sale_at,
                COALESCE(AVG(quantity), 0) AS average_sale_quantity
            FROM sales
            WHERE product_id = %s
        """
        sales_data = adapter.query_one(sales_sql, (product_id,)) or {}

        # Step 3: Latest prediction
        pred_sql = """
            SELECT
                predicted_demand, rule_prediction, ml_prediction, adjusted_prediction,
                avg_sales, percent_change, confidence, season_tag, decision, impact,
                keyword, score, reason, contributing_factors, prediction_source, predicted_at
            FROM predictions
            WHERE product_id = %s
            ORDER BY predicted_at DESC
            LIMIT 1
        """
        prediction_data = adapter.query_one(pred_sql, (product_id,))

        # Step 4: Active alerts
        alert_sql = """
            SELECT id, type, message, severity, percent_change, created_at
            FROM alerts
            WHERE product_id = %s AND is_active = true
            ORDER BY created_at DESC
            LIMIT 5
        """
        alerts = adapter.query(alert_sql, (product_id,))

        evidence = SqlEvidence(
            source_name="products",
            query_name="get_product_snapshot",
            row_count=1 + int(sales_data.get("sales_rows", 0)) + (1 if prediction_data else 0) + len(alerts),
            record_reference=product_id,
            parameters={"product_id": product_ref},
            payload={"product_name": product["name"], "category": product["category"]},
        )

        limitations = []
        if int(sales_data.get("sales_rows", 0)) == 0:
            limitations.append("Product has no recorded sales transactions.")
        if not prediction_data:
            limitations.append("No demand prediction has been calculated for this product.")

        return ProductSnapshotOutput(
            success=True,
            product_found=True,
            product={
                "id": product_id,
                "name": product["name"],
                "category": product["category"],
                "created_at": product["created_at"],
                "sales": sales_data,
            },
            sales_history_rows=int(sales_data.get("sales_rows", 0)),
            latest_prediction=prediction_data,
            active_alerts=alerts,
            evidence=[evidence],
            limitations=limitations,
            data={"product": product, "sales": sales_data, "prediction": prediction_data, "alerts": alerts},
        )
    except Exception as exc:
        return ProductSnapshotOutput(
            success=False,
            error=f"Failed to query product snapshot: {str(exc)}",
            limitations=["Database query failed"],
        )


def get_product_performance(
    tenant_id: str,
    payload: ProductPerformanceInput,
    db: DatabaseAdapter | None = None,
) -> ProductPerformanceOutput:
    """Retrieve rankable product performance metrics."""
    adapter = db or DatabaseAdapter()
    conditions = []
    params: list[Any] = []

    if payload.category:
        conditions.append("p.category = %s")
        params.append(payload.category)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    order_by = "total_sales_volume DESC"
    if payload.sort_by == "percent_change":
        order_by = "pr.percent_change DESC NULLS LAST"

    sql = f"""
        SELECT
            p.id,
            p.name,
            p.category,
            COALESCE(SUM(s.quantity), 0) AS total_sales_volume,
            COUNT(s.id) AS sales_rows,
            pr.predicted_demand,
            pr.decision,
            pr.percent_change,
            pr.confidence,
            COUNT(a.id) FILTER (WHERE a.is_active = true) AS active_alerts_count
        FROM products p
        LEFT JOIN sales s ON s.product_id = p.id
        LEFT JOIN predictions pr ON pr.product_id = p.id
        LEFT JOIN alerts a ON a.product_id = p.id
        {where_clause}
        GROUP BY p.id, p.name, p.category, pr.predicted_demand, pr.decision, pr.percent_change, pr.confidence
        ORDER BY {order_by}
        LIMIT %s
    """
    params.append(payload.limit)

    try:
        rows = adapter.query(sql, tuple(params))
        evidence = SqlEvidence(
            source_name="products",
            query_name="get_product_performance",
            row_count=len(rows),
            parameters={"limit": payload.limit, "category": payload.category, "sort_by": payload.sort_by},
            payload={"product_count": len(rows)},
        )

        limitations = []
        if not rows:
            limitations.append("No products matched the given criteria.")

        return ProductPerformanceOutput(
            success=True,
            products=rows,
            total_evaluated=len(rows),
            evidence=[evidence],
            limitations=limitations,
            data={"products": rows},
        )
    except Exception as exc:
        return ProductPerformanceOutput(
            success=False,
            error=f"Failed to query product performance: {str(exc)}",
            limitations=["Database query failed"],
        )
