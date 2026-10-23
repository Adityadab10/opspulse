from pathlib import Path
from datetime import datetime
import logging

import pandas as pd
from joblib import load
from prophet import Prophet

from postgresService import get_product_name, get_sales_data
from newsFetcher import fetch_product_news
from newsService import analyze_news


MODEL_PATH = Path(__file__).with_name("demand_decision_rf.joblib")
DEFAULT_NEWS_TEXT = "Heatwave expected across India next month"
FORECAST_HORIZON_DAYS = 30

IMPACT_MULTIPLIERS = {
    "increase": 1.15,
    "decrease": 0.85,
    "neutral": 1.0,
}

DEFAULT_CATEGORY_ENCODINGS = {
    "trend": {"decreasing": 0, "stable": 1, "increasing": 2},
    "season": {"winter": 0, "normal": 1, "summer": 2},
    "keywordImpact": {"decrease": 0, "neutral": 1, "increase": 2},
}

logger = logging.getLogger(__name__)


def _sanitize_impact(value):
    normalized = _normalize_category(value)
    return normalized if normalized in IMPACT_MULTIPLIERS else "neutral"


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


def _prepare_prophet_dataframe(raw_docs):
    df = pd.DataFrame(raw_docs)

    if "date" not in df.columns or "quantity" not in df.columns:
        raise ValueError("Sales documents must include date and quantity fields")

    df["ds"] = pd.to_datetime(df["date"], errors="coerce")
    df["y"] = pd.to_numeric(df["quantity"], errors="coerce")

    df = df.dropna(subset=["ds", "y"])
    df = df.groupby("ds", as_index=False)["y"].sum().sort_values("ds")

    if len(df) < 2:
        raise ValueError(
            "Not enough valid data points to train Prophet model (need at least 2 rows)"
        )

    return df


def _generate_forecast_with_prophet(df):
    model = Prophet()
    model.fit(df[["ds", "y"]])

    future = model.make_future_dataframe(periods=FORECAST_HORIZON_DAYS, freq="D")
    forecast = model.predict(future)
    next_window = forecast.tail(FORECAST_HORIZON_DAYS)

    return max(0, int(round(next_window["yhat"].sum())))


def _resolve_news_signal(product_id, news_text):
    """Resolve keyword + impact from product-specific headlines with safe neutral fallback."""
    fallback = {
        "impact": "neutral",
        "keywords": ["stable demand"],
        "keyword": "stable demand",
        "sourceHeadline": None,
        "sourceHeadlines": [],
        "matchedKeywords": ["stable demand"],
        "score": 5.0,
        "source": "fallback",
        "combinedText": "",
    }

    try:
        product_name = get_product_name(product_id) or ""

        print("Product:", product_name)

        if news_text and news_text.strip():
            headlines = [line.strip() for line in news_text.splitlines() if line.strip()]
            if not headlines:
                headlines = [news_text.strip()]
            source = "manual"
        else:
            if not product_name:
                logger.warning(
                    "Product name unavailable for productId=%s; using neutral impact",
                    product_id,
                )
                return fallback

            fetched = fetch_product_news(product_name)
            if isinstance(fetched, dict):
                headlines = fetched.get("headlines") or []
                source = str(fetched.get("source") or "fallback")
            elif isinstance(fetched, list):
                headlines = fetched
                source = "unknown"
            else:
                headlines = []
                source = "fallback"

            if not headlines:
                logger.warning(
                    "No news headlines fetched for product=%s; using neutral impact",
                    product_name,
                )
                return fallback

        headlines = headlines[:5]
        combined_text = " ".join(headlines).strip()

        if not combined_text:
            return fallback

        signal = analyze_news(headlines=headlines, product_name=product_name)
        if not isinstance(signal, dict):
            return fallback

        source_headlines = signal.get("sourceHeadlines")
        if not isinstance(source_headlines, list):
            source_headlines = headlines

        matched_keywords = signal.get("keywords")
        if not isinstance(matched_keywords, list):
            matched_keywords = signal.get("matchedKeywords")
        if not isinstance(matched_keywords, list):
            matched_keywords = []

        resolved_keyword = signal.get("keyword")
        if not resolved_keyword and matched_keywords:
            resolved_keyword = matched_keywords[0]

        score = float(signal.get("score", 5.0))
        impact = _sanitize_impact(signal.get("impact", "neutral"))

        print("Headlines:", source_headlines)
        print("Score:", score)
        print("Impact:", impact)

        return {
            "impact": impact,
            "keywords": matched_keywords,
            "keyword": resolved_keyword,
            "sourceHeadline": source_headlines[0] if source_headlines else headlines[0],
            "sourceHeadlines": source_headlines,
            "matchedKeywords": matched_keywords,
            "score": score,
            "source": source,
            "combinedText": combined_text,
        }
    except Exception:
        logger.exception("News signal resolution failed; defaulting impact to neutral")
        return fallback


def _adjust_forecast_by_score(forecast, score):
    adjusted = float(forecast) + (float(forecast) * float(score) / 100.0)
    adjusted = int(round(adjusted))
    return max(0, adjusted)


def _load_decision_artifact():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            "Random Forest artifact not found at "
            f"{MODEL_PATH}. Run decisionModel.py once to generate it."
        )
    return load(str(MODEL_PATH))


def _encode_categorical_feature(feature_encoders, column, raw_value):
    normalized = _normalize_category(raw_value)

    if feature_encoders and column in feature_encoders:
        encoder = feature_encoders[column]
        if normalized not in encoder.classes_:
            supported = ", ".join(str(item) for item in encoder.classes_)
            raise ValueError(
                f"Unsupported value for {column}: '{normalized}'. Supported: {supported}"
            )
        return int(encoder.transform([normalized])[0])

    fallback_map = DEFAULT_CATEGORY_ENCODINGS.get(column, {})
    if normalized not in fallback_map:
        supported = ", ".join(fallback_map.keys())
        raise ValueError(
            f"Unsupported value for {column}: '{normalized}'. Supported: {supported}"
        )
    return int(fallback_map[normalized])


def _prepare_feature_vector(trend, season, keyword_impact, forecast_value, feature_encoders):
    encoded_trend = _encode_categorical_feature(feature_encoders, "trend", trend)
    encoded_season = _encode_categorical_feature(feature_encoders, "season", season)
    encoded_impact = _encode_categorical_feature(
        feature_encoders,
        "keywordImpact",
        keyword_impact,
    )

    return [
        encoded_trend,
        encoded_season,
        encoded_impact,
        float(forecast_value),
    ]


def _predict_decision_and_confidence(bundle, features):
    model = bundle["model"]
    label_encoder = bundle["label_encoder"]

    prediction = model.predict([features])
    decision = label_encoder.inverse_transform(prediction)[0]

    confidence = 1.0
    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba([features])[0]
        confidence = round(float(max(probabilities)), 4)

    return decision, confidence


def predict_demand(product_id: str, news_text: str = ""):
    """
    Unified decision pipeline:
    1) fetch sales data from PostgreSQL
    2) generate Prophet forecast
    3) analyze external news signal
    4) adjust forecast based on signal
    5) run Random Forest decision model

    Args:
        product_id: Product ID to forecast

    Returns:
        dict: {
            "forecast": int,
            "adjustedForecast": int,
            "impact": "increase|decrease|neutral",
            "decision": "increase|maintain|reduce",
            "confidence": float,
        }

    Raises:
        ValueError: If insufficient data or product not found
    """
    try:
        docs = get_sales_data(product_id)
        logger.info("Fetched %s sales rows for productId=%s", len(docs), product_id)

        df = _prepare_prophet_dataframe(docs)
        logger.info("Prepared %s clean rows for Prophet", len(df))

        forecast_value = _generate_forecast_with_prophet(df)

        news_signal = _resolve_news_signal(product_id=product_id, news_text=news_text)
        impact = news_signal["impact"]
        adjusted_forecast = _adjust_forecast_by_score(forecast_value, news_signal.get("score", 5.0))

        percent_change = _calculate_percent_change(df["y"].iloc[-1], df["y"].iloc[-2])
        trend = _trend_from_percent_change(percent_change)
        season = _season_from_month(datetime.now().month)

        bundle = _load_decision_artifact()
        feature_encoders = bundle.get("feature_encoders")

        # Use adjusted forecast to represent final demand context after signal impact.
        feature_vector = _prepare_feature_vector(
            trend=trend,
            season=season,
            keyword_impact=impact,
            forecast_value=adjusted_forecast,
            feature_encoders=feature_encoders,
        )

        decision, confidence = _predict_decision_and_confidence(bundle, feature_vector)

        result = {
            "prediction": forecast_value,
            "forecast": forecast_value,
            "adjustedPrediction": adjusted_forecast,
            "adjustedForecast": adjusted_forecast,
            "impact": impact,
            "keywords": news_signal.get("keywords", []),
            "headlines": news_signal.get("sourceHeadlines", []),
            "keyword": news_signal.get("keyword"),
            "sourceHeadline": news_signal.get("sourceHeadline"),
            "sourceHeadlines": news_signal.get("sourceHeadlines", []),
            "matchedKeywords": news_signal.get("matchedKeywords", []),
            "score": news_signal.get("score", 0.0),
            "decision": decision,
            "confidence": confidence,
        }

        logger.info(
            "Pipeline complete for productId=%s; impact=%s, decision=%s, confidence=%s",
            product_id,
            impact,
            decision,
            confidence,
        )
        return result

    except ValueError:
        logger.warning(
            "Validation error while predicting demand for productId=%s",
            product_id,
            exc_info=True,
        )
        raise
    except Exception as exc:
        logger.exception("Prediction pipeline failed for productId=%s", product_id)
        raise RuntimeError("Failed to generate demand prediction") from exc
