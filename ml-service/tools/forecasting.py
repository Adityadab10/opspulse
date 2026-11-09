"""Deterministic demand forecast retrieval and routing tool for OpsPulse."""

from __future__ import annotations

import logging
from typing import Any

from contracts.evidence import ForecastEvidence, SqlEvidence
from contracts.tools import DemandForecastInput, DemandForecastOutput
from tools.db import DatabaseAdapter

logger = logging.getLogger(__name__)

MIN_ARIMA_POINTS = 5
PROPHET_ROUTING_THRESHOLD = 21


def get_demand_forecast(
    tenant_id: str,
    payload: DemandForecastInput,
    db: DatabaseAdapter | None = None,
) -> DemandForecastOutput:
    """Retrieve demand forecast using evaluated model routing policy.

    Routing policy:
    - N >= 21 observations: Prophet (captures seasonality and complex trend)
    - 5 <= N < 21 observations: ARIMA(1,1,1) (stable univariate baseline for short histories)
    - N < 5 observations: insufficient_data (no forecast emitted, explicit limitation)
    """
    adapter = db or DatabaseAdapter()
    product_ref = payload.product_id.strip()

    # Step 1: Resolve product
    prod_sql = """
        SELECT id, name, category, legacy_mongo_id
        FROM products
        WHERE id::text = %s OR legacy_mongo_id = %s OR lower(name) = lower(%s)
        LIMIT 1
    """
    try:
        product = adapter.query_one(prod_sql, (product_ref, product_ref, product_ref))
        if not product:
            return DemandForecastOutput(
                success=False,
                product_id=product_ref,
                error=f"Product not found matching '{product_ref}'",
                limitations=["Product does not exist in catalog"],
            )

        product_id = str(product["id"])
        product_name = str(product.get("name") or "Unknown")

        # Step 2: Query historical daily sales
        sales_sql = """
            SELECT sale_date AS date, quantity
            FROM sales
            WHERE product_id = %s
            ORDER BY sale_date ASC
        """
        sales_rows = adapter.query(sales_sql, (product_id,))
        historical_points = len(sales_rows)

        # Step 3: Query latest persisted prediction if available
        pred_sql = """
            SELECT predicted_demand, rule_prediction, ml_prediction, adjusted_prediction,
                   confidence, decision, impact, keyword, score, reason,
                   prediction_source, predicted_at
            FROM predictions
            WHERE product_id = %s
            ORDER BY predicted_at DESC
            LIMIT 1
        """
        persisted_pred = adapter.query_one(pred_sql, (product_id,))

        limitations: list[str] = []
        evidence_list = []

        # Add SQL evidence for sales and predictions retrieved
        evidence_list.append(
            SqlEvidence(
                source_name="sales",
                query_name="get_demand_forecast:sales_history",
                row_count=historical_points,
                record_reference=product_id,
                payload={"historical_points": historical_points},
            )
        )

        # Determine routing
        selected_model: str
        routing_reason: str
        forecast_val: int | None = None

        force = (payload.force_model or "").lower().strip()

        if force == "prophet":
            if historical_points >= 2:
                selected_model = "prophet"
                routing_reason = "Forced prophet selection with sufficient data (>= 2 points)"
            else:
                selected_model = "insufficient_data"
                routing_reason = "Forced prophet selection failed: requires at least 2 points"
                limitations.append("Prophet requires at least 2 historical sales observations.")
        elif force == "arima":
            if historical_points >= MIN_ARIMA_POINTS:
                selected_model = "arima"
                routing_reason = f"Forced ARIMA selection with sufficient data (>={MIN_ARIMA_POINTS} points)"
            else:
                selected_model = "insufficient_data"
                routing_reason = f"Forced ARIMA selection failed: requires at least {MIN_ARIMA_POINTS} points"
                limitations.append(f"ARIMA requires at least {MIN_ARIMA_POINTS} historical sales observations.")
        else:
            # Preliminary adaptive routing based on walk-forward benchmark findings
            if historical_points >= PROPHET_ROUTING_THRESHOLD:
                selected_model = "prophet"
                routing_reason = f"Historical series length ({historical_points}) >= {PROPHET_ROUTING_THRESHOLD}: Prophet selected for seasonality support"
            elif historical_points >= MIN_ARIMA_POINTS:
                selected_model = "arima"
                routing_reason = f"Short history ({historical_points} points between {MIN_ARIMA_POINTS} and {PROPHET_ROUTING_THRESHOLD - 1}): ARIMA selected as parsimonious univariate baseline"
            else:
                selected_model = "insufficient_data"
                routing_reason = f"History length ({historical_points}) < {MIN_ARIMA_POINTS}: Fewer than {MIN_ARIMA_POINTS} observations - insufficient data for statistical forecasting"
                limitations.append(f"Product has only {historical_points} sales rows; at least {MIN_ARIMA_POINTS} are required for forecasting.")

        # If a persisted prediction exists and matches the ML forecast, extract it
        if persisted_pred:
            if selected_model == "prophet" and persisted_pred.get("ml_prediction") is not None:
                forecast_val = int(round(float(persisted_pred["ml_prediction"])))
            elif persisted_pred.get("adjusted_prediction") is not None:
                forecast_val = int(round(float(persisted_pred["adjusted_prediction"])))

        # Emit forecast evidence if eligible
        if selected_model != "insufficient_data":
            evidence_list.append(
                ForecastEvidence(
                    source_name="forecast_router",
                    model_name=selected_model,
                    horizon_days=30,
                    historical_points=historical_points,
                    routing_reason=routing_reason,
                    payload={"forecast_30d": forecast_val},
                )
            )

        return DemandForecastOutput(
            success=True,
            product_id=product_id,
            product_name=product_name,
            selected_model=selected_model,
            forecast_30d=forecast_val,
            historical_points=historical_points,
            routing_reason=routing_reason,
            raw_prediction=persisted_pred,
            evidence=evidence_list,
            limitations=limitations,
            data={
                "product_id": product_id,
                "selected_model": selected_model,
                "forecast_30d": forecast_val,
                "historical_points": historical_points,
            },
        )
    except Exception as exc:
        return DemandForecastOutput(
            success=False,
            product_id=product_ref,
            error=f"Failed to retrieve demand forecast: {str(exc)}",
            limitations=["Database query or forecast routing failed"],
        )
