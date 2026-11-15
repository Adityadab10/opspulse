"""Product-level daily demand forecasting using the existing Prophet/ARIMA stack."""

from datetime import datetime
from typing import Any

import pandas as pd
from prophet import Prophet
from statsmodels.tsa.arima.model import ARIMA

from postgresService import get_sales_data

MIN_HISTORY_POINTS = 5
PROPHET_THRESHOLD = 21
MAX_HORIZON_DAYS = 90


def prepare_daily_sales(raw_rows: list[dict[str, Any]]) -> pd.DataFrame:
    frame = pd.DataFrame(raw_rows)
    if "date" not in frame.columns or "quantity" not in frame.columns:
        raise ValueError("Sales rows must include date and quantity")
    frame["ds"] = pd.to_datetime(frame["date"], errors="coerce", utc=True)
    frame["y"] = pd.to_numeric(frame["quantity"], errors="coerce")
    frame = frame.dropna(subset=["ds", "y"])
    if frame.empty:
        return pd.DataFrame(columns=["ds", "y"])
    return frame.groupby("ds", as_index=False)["y"].sum().sort_values("ds")


def _choose_model(history_points: int, requested: str) -> str:
    model = (requested or "auto").strip().lower()
    if model not in {"auto", "prophet", "arima"}:
        raise ValueError("model must be auto, prophet, or arima")
    if model == "auto":
        return "prophet" if history_points >= PROPHET_THRESHOLD else "arima"
    return model


def forecast_product(product_id: str, horizon: int = 30, model: str = "auto", tenant_id: str | None = None) -> dict[str, Any]:
    if not isinstance(horizon, int) or horizon < 1 or horizon > MAX_HORIZON_DAYS:
        raise ValueError(f"horizon must be between 1 and {MAX_HORIZON_DAYS} days")

    rows = get_sales_data(product_id, tenant_id=tenant_id)
    history = prepare_daily_sales(rows)
    historical = [{"date": row.ds.isoformat(), "quantity": float(row.y)} for row in history.itertuples()]
    if len(history) < MIN_HISTORY_POINTS:
        return {
            "success": False,
            "error": "INSUFFICIENT_DATA",
            "message": f"At least {MIN_HISTORY_POINTS} daily sales observations are required",
            "historical": historical,
            "historicalPoints": len(history),
        }

    selected = _choose_model(len(history), model)
    if selected == "prophet":
        if len(history) < 2:
            raise ValueError("Prophet requires at least 2 daily observations")
        fitted = Prophet().fit(history[["ds", "y"]])
        future = fitted.make_future_dataframe(periods=horizon, freq="D", include_history=False)
        values = fitted.predict(future)["yhat"].tolist()
    else:
        fitted = ARIMA(history["y"], order=(1, 1, 1)).fit()
        values = fitted.forecast(steps=horizon).tolist()

    last_date = history["ds"].iloc[-1]
    forecast = [
        {"date": date.isoformat(), "value": max(0.0, round(float(value), 2))}
        for date, value in zip(pd.date_range(last_date + pd.Timedelta(days=1), periods=horizon, freq="D"), values)
    ]
    return {
        "success": True,
        "selectedModel": selected,
        "horizon": horizon,
        "historical": historical,
        "forecast": forecast,
        "historicalPoints": len(history),
        "generatedAt": datetime.utcnow().isoformat() + "Z",
    }
