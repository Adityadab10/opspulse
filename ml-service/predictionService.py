from pathlib import Path
from datetime import datetime

import pandas as pd
from joblib import load
from prophet import Prophet

from mongoService import get_sales_data
from newsService import analyze_news


MODEL_PATH = Path(__file__).with_name("demand_decision_rf.joblib")
DEFAULT_NEWS_TEXT = "Heatwave expected across India next month"


def _calculate_percent_change(current_value, previous_value):
    current = float(current_value)
    previous = float(previous_value)

    if previous == 0:
        return 0.0 if current == 0 else 100.0

    return ((current - previous) / previous) * 100.0


def _trend_from_percent_change(percent_change):
    if percent_change > 5:
        return "increasing"
    if percent_change < -5:
        return "decreasing"
    return "stable"


def _season_from_month(month):
    if month in (3, 4, 5, 6):
        return "summer"
    if month in (11, 12, 1, 2):
        return "winter"
    return "normal"


def _normalize_category(value):
    return str(value).strip().lower()


def _load_decision_artifact():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            "Random Forest artifact not found at "
            f"{MODEL_PATH}. Run decisionModel.py once to generate it."
        )
    return load(str(MODEL_PATH))


def _predict_decision(trend, season, keyword_impact, forecast_value):
    try:
        # Required model load contract.
        bundle = _load_decision_artifact()
        model = bundle["model"]
        label_encoder = bundle["label_encoder"]
        feature_encoders = bundle.get("feature_encoders")

        encoded_trend = _normalize_category(trend)
        encoded_season = _normalize_category(season)
        encoded_impact = _normalize_category(keyword_impact)

        # Encode categorical features using stored encoders when available.
        if feature_encoders:
            encoded_trend = int(feature_encoders["trend"].transform([encoded_trend])[0])
            encoded_season = int(feature_encoders["season"].transform([encoded_season])[0])
            encoded_impact = int(feature_encoders["keywordImpact"].transform([encoded_impact])[0])

        features = [
            encoded_trend,
            encoded_season,
            encoded_impact,
            float(forecast_value),
        ]

        prediction = model.predict([features])
        decision = label_encoder.inverse_transform(prediction)[0]
        return decision
    except Exception as error:
        print(f"[predict] Decision model inference failed: {error}")
        return "maintain"

def predict_demand(product_id: str, news_text: str = ""):
    """
    Forecast product demand for the next 30 days using Facebook Prophet.
    
    Args:
        product_id: Product ID to forecast
        
    Returns:
        dict: {
            "prediction": int,
            "adjustedPrediction": int,
            "decision": "increase|maintain|reduce",
            "impact": "increase|decrease|neutral",
        }
        
    Raises:
        ValueError: If insufficient data or product not found
    """
    docs = get_sales_data(product_id)
    print(f"[predict] Raw sales docs fetched for {product_id}: {len(docs)}")

    df = pd.DataFrame(docs)

    if "date" not in df.columns or "quantity" not in df.columns:
        raise ValueError("Sales documents must include date and quantity fields")

    # Convert to Prophet format: ds (date), y (quantity)
    df["ds"] = pd.to_datetime(df["date"], errors="coerce")
    df["y"] = pd.to_numeric(df["quantity"], errors="coerce")

    # Remove invalid rows and aggregate same-day sales
    df = df.dropna(subset=["ds", "y"])
    df = df.groupby("ds", as_index=False)["y"].sum().sort_values("ds")

    print(f"[predict] Rows passed to Prophet after cleanup/grouping: {len(df)}")

    if len(df) < 2:
        raise ValueError("Not enough valid data points to train Prophet model (need at least 2 rows)")

    # Train Prophet model
    model = Prophet()
    model.fit(df[["ds", "y"]])

    # Generate forecast for next 30 days
    future = model.make_future_dataframe(periods=30, freq="D")
    forecast = model.predict(future)

    next_30 = forecast.tail(30)

    # Calculate predictions (sum of daily forecasts for 30 days)
    base_prediction = max(0, int(round(next_30["yhat"].sum())))

    # External signal (kept deterministic with fallback sample text).
    if not news_text:
        news_text = DEFAULT_NEWS_TEXT

    signal = analyze_news(news_text)

    impact = "neutral"
    adjusted_prediction = base_prediction

    if isinstance(signal, dict):
        impact = signal.get("impact", "neutral")

    if impact == "increase":
        adjusted_prediction = int(round(base_prediction * 1.15))
    elif impact == "decrease":
        adjusted_prediction = int(round(base_prediction * 0.85))

    adjusted_prediction = max(0, adjusted_prediction)

    if len(df) >= 2:
        percent_change = _calculate_percent_change(df["y"].iloc[-1], df["y"].iloc[-2])
    else:
        percent_change = 0.0

    trend = _trend_from_percent_change(percent_change)

    current_month = datetime.now().month
    season = _season_from_month(current_month)

    decision = _predict_decision(
        trend=trend,
        season=season,
        keyword_impact=impact,
        forecast_value=base_prediction,
    )

    return {
        "prediction": base_prediction,
        "adjustedPrediction": adjusted_prediction,
        "decision": decision,
        "impact": impact,
    }