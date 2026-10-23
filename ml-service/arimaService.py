from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from prophet import Prophet
from sklearn.metrics import mean_absolute_error, mean_squared_error
from statsmodels.tsa.arima.model import ARIMA

from postgresService import get_sales_data


DEFAULT_ARIMA_ORDER = (1, 1, 1)


def _prepare_sales_dataframe(raw_docs: List[dict]) -> pd.DataFrame:
    df = pd.DataFrame(raw_docs)

    if "date" not in df.columns or "quantity" not in df.columns:
        raise ValueError("Sales documents must include date and quantity fields")

    df["ds"] = pd.to_datetime(df["date"], errors="coerce")
    df["y"] = pd.to_numeric(df["quantity"], errors="coerce")

    df = df.dropna(subset=["ds", "y"])
    df = df.groupby("ds", as_index=False)["y"].sum().sort_values("ds")

    if len(df) < 5:
        raise ValueError("Not enough data to compare ARIMA and Prophet (need at least 5 rows)")

    return df


def _train_test_split_series(series: pd.Series) -> Tuple[pd.Series, pd.Series]:
    split_index = int(len(series) * 0.8)
    if split_index <= 0 or split_index >= len(series):
        raise ValueError("Train/test split failed; check data size")
    return series.iloc[:split_index], series.iloc[split_index:]


def _prophet_forecast(train_df: pd.DataFrame, test_size: int) -> List[float]:
    model = Prophet()
    model.fit(train_df[["ds", "y"]])

    future = model.make_future_dataframe(periods=test_size, freq="D")
    forecast = model.predict(future)

    return forecast.tail(test_size)["yhat"].tolist()


def _arima_forecast(train_series: pd.Series, test_size: int) -> List[float]:
    model = ARIMA(train_series, order=DEFAULT_ARIMA_ORDER)
    fitted = model.fit()
    forecast = fitted.forecast(steps=test_size)

    return forecast.tolist()


def _mean_absolute_percentage_error(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    nonzero_mask = y_true != 0
    if not np.any(nonzero_mask):
        return 0.0
    mape = np.mean(np.abs((y_true[nonzero_mask] - y_pred[nonzero_mask]) / y_true[nonzero_mask]))
    return float(mape * 100.0)


def _compute_metrics(actual_values: List[float], predictions: List[float]) -> Dict[str, float]:
    y_true = np.array(actual_values, dtype=float)
    y_pred = np.array(predictions, dtype=float)

    mse = mean_squared_error(y_true, y_pred)
    rmse = float(np.sqrt(mse))
    mae = mean_absolute_error(y_true, y_pred)
    mape = _mean_absolute_percentage_error(y_true, y_pred)

    return {
        "rmse": float(rmse),
        "mae": float(mae),
        "mape": float(mape),
    }


def _pick_better_model(prophet_metrics: Dict[str, float], arima_metrics: Dict[str, float]) -> str:
    if arima_metrics["rmse"] < prophet_metrics["rmse"]:
        return "arima"
    if arima_metrics["rmse"] > prophet_metrics["rmse"]:
        return "prophet"

    if arima_metrics["mae"] < prophet_metrics["mae"]:
        return "arima"
    if arima_metrics["mae"] > prophet_metrics["mae"]:
        return "prophet"

    return "tie"


def compare_arima_prophet(product_id: str) -> Dict[str, object]:
    """
    Compare ARIMA vs Prophet predictions on the same train/test split.

    Returns:
        dict: {
            "prophet_prediction": [...],
            "arima_prediction": [...],
            "actual_values": [...],
            "prophet_metrics": {"rmse": ..., "mae": ..., "mape": ...},
            "arima_metrics": {"rmse": ..., "mae": ..., "mape": ...},
            "better_model": "prophet" | "arima" | "tie",
        }
    """
    print("\n[arima] compare_arima_prophet called")
    print("[arima] product_id:", product_id)

    docs = get_sales_data(product_id)
    print("[arima] fetched sales docs:", len(docs))

    df = _prepare_sales_dataframe(docs)
    print("[arima] prepared dataframe rows:", len(df))

    quantity_series = pd.Series(df["y"].to_numpy())
    print("[arima] quantity series length:", len(quantity_series))

    train_series, test_series = _train_test_split_series(quantity_series)
    test_size = len(test_series)

    print("[arima] train size:", len(train_series))
    print("[arima] test size:", test_size)
    print("[arima] train range:", df["ds"].iloc[0], "->", df["ds"].iloc[len(train_series) - 1])
    print("[arima] test range:", df["ds"].iloc[len(train_series)], "->", df["ds"].iloc[-1])

    train_df = df.iloc[: len(train_series)][["ds", "y"]]

    print("[arima] fitting Prophet...")
    prophet_prediction = _prophet_forecast(train_df, test_size)
    print("[arima] Prophet forecast generated:", len(prophet_prediction))

    print("[arima] fitting ARIMA with order:", DEFAULT_ARIMA_ORDER)
    arima_prediction = _arima_forecast(train_series, test_size)
    print("[arima] ARIMA forecast generated:", len(arima_prediction))

    actual_values = test_series.tolist()

    prophet_metrics = _compute_metrics(actual_values, prophet_prediction)
    arima_metrics = _compute_metrics(actual_values, arima_prediction)

    print("[arima] Prophet metrics:", prophet_metrics)
    print("[arima] ARIMA metrics:", arima_metrics)

    better_model = _pick_better_model(prophet_metrics, arima_metrics)
    print("[arima] better_model:", better_model)

    return {
        "prophet_prediction": prophet_prediction,
        "arima_prediction": arima_prediction,
        "actual_values": actual_values,
        "prophet_metrics": prophet_metrics,
        "arima_metrics": arima_metrics,
        "better_model": better_model,
    }
