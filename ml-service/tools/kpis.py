"""Approved business KPI calculations for OpsPulse with dashboard parity."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from contracts.evidence import SqlEvidence
from contracts.tools import BusinessKpisInput, BusinessKpisOutput
from tools.db import DatabaseAdapter


def get_business_kpis(
    tenant_id: str,
    payload: BusinessKpisInput,
    db: DatabaseAdapter | None = None,
) -> BusinessKpisOutput:
    """Calculate executive business health KPIs matching dashboard parity."""
    adapter = db or DatabaseAdapter()
    window_days = payload.window_days

    try:
        # Step 1: Overall counts and volumes
        totals_sql = """
            SELECT
                (SELECT COUNT(*) FROM products) AS total_products,
                (SELECT COALESCE(SUM(quantity), 0) FROM sales) AS total_sales_volume,
                (SELECT COUNT(*) FROM alerts WHERE is_active = true) AS active_alerts
        """
        totals = adapter.query_one(totals_sql) or {}
        total_products = int(totals.get("total_products", 0))
        total_sales_volume = int(totals.get("total_sales_volume", 0))
        active_alerts = int(totals.get("active_alerts", 0))

        # Replicate dashboardController formulas
        avg_daily = round(float(total_sales_volume) / 30.0, 2)
        avg_monthly = round(float(total_sales_volume) / max(total_products, 1), 2) if total_products else 0.0

        # Step 2: Product trend calculation for top increasing/decreasing
        now = datetime.now(timezone.utc)
        recent_cutoff = now - timedelta(days=window_days)
        prev_cutoff = recent_cutoff - timedelta(days=window_days)

        trend_sql = """
            SELECT
                p.id,
                p.name,
                COALESCE(SUM(s.quantity), 0) AS total_qty,
                COALESCE(SUM(CASE WHEN s.sale_date > %s AND s.sale_date <= %s THEN s.quantity ELSE 0 END), 0) AS recent_qty,
                COALESCE(SUM(CASE WHEN s.sale_date > %s AND s.sale_date <= %s THEN s.quantity ELSE 0 END), 0) AS prev_qty
            FROM products p
            LEFT JOIN sales s ON s.product_id = p.id
            GROUP BY p.id, p.name
        """
        rows = adapter.query(trend_sql, (recent_cutoff, now, prev_cutoff, recent_cutoff))

        product_trends = []
        for r in rows:
            recent = int(r.get("recent_qty", 0))
            previous = int(r.get("prev_qty", 0))
            total_qty = int(r.get("total_qty", 0))

            if previous > 0:
                pct_change = round(((recent - previous) / previous) * 100.0, 2)
                trend_dir = "increasing" if pct_change > 0 else "decreasing" if pct_change < 0 else "stable"
            elif recent > 0 and previous == 0:
                pct_change = 100.0
                trend_dir = "increasing"
            else:
                pct_change = 0.0
                trend_dir = "stable"

            product_trends.append({
                "name": r["name"],
                "quantity": total_qty,
                "percent_change": pct_change,
                "trend_direction": trend_dir,
            })

        top_increasing = [
            p for p in product_trends if p["trend_direction"] == "increasing"
        ]
        top_increasing.sort(key=lambda x: x["percent_change"], reverse=True)
        top_increasing = top_increasing[:3]

        top_decreasing = [
            p for p in product_trends if p["trend_direction"] == "decreasing"
        ]
        top_decreasing.sort(key=lambda x: x["percent_change"])
        top_decreasing = top_decreasing[:3]

        # Fallback to volume if fewer than 3 increasing/decreasing
        if len(top_increasing) < 3:
            all_sorted = sorted(product_trends, key=lambda x: x["quantity"], reverse=True)
            needed = 3 - len(top_increasing)
            candidates = [p for p in all_sorted if p["trend_direction"] != "decreasing"][:needed]
            top_increasing.extend(candidates)

        if len(top_decreasing) < 3:
            all_sorted = sorted(product_trends, key=lambda x: x["quantity"], reverse=True)
            needed = 3 - len(top_decreasing)
            candidates = [p for p in all_sorted if p["trend_direction"] != "increasing"][:needed]
            top_decreasing.extend(candidates)

        evidence = SqlEvidence(
            source_name="kpis",
            query_name="get_business_kpis",
            row_count=len(rows) + 1,
            payload={
                "total_products": total_products,
                "total_sales_volume": total_sales_volume,
                "active_alerts": active_alerts,
            },
        )

        limitations = []
        if total_products == 0:
            limitations.append("Catalogue is empty; no products found.")
        if total_sales_volume == 0:
            limitations.append("No historical sales volume recorded.")

        return BusinessKpisOutput(
            success=True,
            total_products=total_products,
            total_sales_volume=total_sales_volume,
            avg_daily_sales=avg_daily,
            avg_monthly_sales=avg_monthly,
            active_alerts=active_alerts,
            top_increasing=top_increasing[:3],
            top_decreasing=top_decreasing[:3],
            evidence=[evidence],
            limitations=limitations,
            data={
                "total_products": total_products,
                "total_sales_volume": total_sales_volume,
                "avg_daily_sales": avg_daily,
                "avg_monthly_sales": avg_monthly,
                "active_alerts": active_alerts,
            },
        )
    except Exception as exc:
        return BusinessKpisOutput(
            success=False,
            error=f"Failed to calculate business KPIs: {str(exc)}",
            limitations=["Database query failed"],
        )
