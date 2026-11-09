"""Deterministic sales analytics tools for OpsPulse."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from contracts.evidence import SqlEvidence
from contracts.tools import (
    SalesComparisonInput,
    SalesComparisonOutput,
    SalesSummaryInput,
    SalesSummaryOutput,
)
from tools.db import DatabaseAdapter


def get_sales_summary(
    tenant_id: str,
    payload: SalesSummaryInput,
    db: DatabaseAdapter | None = None,
) -> SalesSummaryOutput:
    """Retrieve sales volume, record count, and daily averages."""
    adapter = db or DatabaseAdapter()
    conditions = []
    params: list[Any] = []

    if payload.product_id:
        conditions.append("s.product_id::text = %s")
        params.append(str(payload.product_id))
    if payload.start_date:
        conditions.append("s.sale_date >= %s")
        params.append(payload.start_date)
    if payload.end_date:
        conditions.append("s.sale_date <= %s")
        params.append(payload.end_date)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    sql = f"""
        SELECT
            COALESCE(SUM(s.quantity), 0) AS total_volume,
            COUNT(s.id) AS record_count,
            COUNT(DISTINCT s.product_id) AS unique_products
        FROM sales s
        {where_clause}
    """

    try:
        row = adapter.query_one(sql, tuple(params)) or {}
        total_volume = int(row.get("total_volume", 0))
        record_count = int(row.get("record_count", 0))
        unique_products = int(row.get("unique_products", 0))

        # Determine day span
        if payload.start_date and payload.end_date:
            days = max(1, (payload.end_date - payload.start_date).days + 1)
        else:
            days = 30
        avg_daily = round(float(total_volume) / days, 2)

        evidence = SqlEvidence(
            source_name="sales",
            query_name="get_sales_summary",
            row_count=record_count,
            parameters={"product_id": payload.product_id, "start": str(payload.start_date), "end": str(payload.end_date)},
            payload={"total_volume": total_volume, "record_count": record_count},
        )

        limitations = []
        if record_count == 0:
            limitations.append("No sales records found for the specified filters.")

        return SalesSummaryOutput(
            success=True,
            total_sales_volume=total_volume,
            record_count=record_count,
            unique_products_sold=unique_products,
            average_daily_sales=avg_daily,
            evidence=[evidence],
            limitations=limitations,
            data={"total_volume": total_volume, "record_count": record_count, "unique_products": unique_products},
        )
    except Exception as exc:
        return SalesSummaryOutput(
            success=False,
            error=f"Failed to query sales summary: {str(exc)}",
            limitations=["Database query failed"],
        )


def compare_sales_periods(
    tenant_id: str,
    payload: SalesComparisonInput,
    db: DatabaseAdapter | None = None,
) -> SalesComparisonOutput:
    """Compare sales between two consecutive windows with dashboard parity."""
    adapter = db or DatabaseAdapter()
    window_days = payload.window_days

    # Calculate cutoff dates
    now = datetime.now(timezone.utc)
    recent_start = now - timedelta(days=window_days)
    prev_start = recent_start - timedelta(days=window_days)

    conditions = []
    params: list[Any] = []
    if payload.product_id:
        conditions.append("product_id::text = %s")
        params.append(str(payload.product_id))

    extra_filter = f"AND {' AND '.join(conditions)}" if conditions else ""

    sql = f"""
        SELECT
            COALESCE(SUM(CASE WHEN sale_date > %s AND sale_date <= %s THEN quantity ELSE 0 END), 0) AS recent_sales,
            COALESCE(SUM(CASE WHEN sale_date > %s AND sale_date <= %s THEN quantity ELSE 0 END), 0) AS prev_sales,
            COUNT(*) AS total_rows
        FROM sales
        WHERE sale_date > %s AND sale_date <= %s {extra_filter}
    """
    query_params = (recent_start, now, prev_start, recent_start, prev_start, now, *params)

    try:
        row = adapter.query_one(sql, query_params) or {}
        recent = int(row.get("recent_sales", 0))
        previous = int(row.get("prev_sales", 0))
        total_rows = int(row.get("total_rows", 0))

        # Parity with dashboardController computeTrend
        if previous > 0:
            pct_change = round(((recent - previous) / previous) * 100.0, 2)
            trend = "increasing" if pct_change > 0 else "decreasing" if pct_change < 0 else "stable"
        elif recent > 0 and previous == 0:
            pct_change = 100.0
            trend = "increasing"
        else:
            pct_change = 0.0
            trend = "stable"

        evidence = SqlEvidence(
            source_name="sales",
            query_name="compare_sales_periods",
            row_count=total_rows,
            parameters={"window_days": window_days, "product_id": payload.product_id},
            payload={"recent_sales": recent, "previous_sales": previous, "percent_change": pct_change},
        )

        limitations = []
        if total_rows == 0:
            limitations.append(f"No sales recorded in the past {window_days * 2} days.")

        return SalesComparisonOutput(
            success=True,
            recent_sales=recent,
            previous_sales=previous,
            percent_change=pct_change,
            trend_direction=trend,
            evidence=[evidence],
            limitations=limitations,
            data={"recent_sales": recent, "previous_sales": previous, "percent_change": pct_change, "trend": trend},
        )
    except Exception as exc:
        return SalesComparisonOutput(
            success=False,
            error=f"Failed to compare sales periods: {str(exc)}",
            limitations=["Database query failed"],
        )
