"""
FastAPI ML service for demand prediction using Prophet.

Run with: uvicorn app:app --host 0.0.0.0 --port 5002
"""

from datetime import date, datetime
from decimal import Decimal
import hmac
import os
from typing import Any, Optional

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError
from starlette.concurrency import run_in_threadpool

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from rag_provider import ProviderUnavailable
from rag_service import answer_question

try:
    from predictionService import predict_demand
except Exception as exc:  # Keep the endpoint's existing 503 behavior.
    print("[error] Error importing predictionService:", str(exc))
    predict_demand = None

try:
    from arimaService import compare_arima_prophet
except Exception as exc:  # Keep the endpoint's existing 503 behavior.
    print("[error] Error importing arimaService:", str(exc))
    compare_arima_prophet = None

try:
    from postgresService import get_db_diagnostics, get_raw_sales_data
except Exception as exc:  # Keep the endpoint's existing 503 behavior.
    print("[error] Error importing postgresService:", str(exc))
    get_db_diagnostics = None
    get_raw_sales_data = None

try:
    from newsFetcher import fetch_product_news
except Exception as exc:  # Keep the endpoint's existing fallback behavior.
    print("[error] Error importing newsFetcher:", str(exc))
    fetch_product_news = None

try:
    from newsScraper import scrape_google_news_headlines
except Exception as exc:  # Keep the endpoint's existing fallback behavior.
    print("[error] Error importing newsScraper:", str(exc))
    scrape_google_news_headlines = None

try:
    from newsService import analyze_news
except Exception as exc:  # Keep the endpoint's existing fallback behavior.
    print("[error] Error importing newsService:", str(exc))
    analyze_news = None


class ProductRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    productId: Any = None
    newsText: str = ""


class NewsInsightsRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    productName: Optional[str] = None


class AnalystRequest(BaseModel):
    question: str


app = FastAPI(title="OpsPulse ML Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _serialize_for_json(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, np.generic):
        return _serialize_for_json(value.item())
    if isinstance(value, np.ndarray):
        return [_serialize_for_json(item) for item in value.tolist()]
    if isinstance(value, dict):
        return {key: _serialize_for_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize_for_json(item) for item in value]
    return value


def _json_response(payload, status_code=200):
    return JSONResponse(
        content=_serialize_for_json(payload),
        status_code=status_code,
    )


async def _parse_json_body(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None

    try:
        return ProductRequest.model_validate(payload)
    except ValidationError:
        return None


async def _parse_news_body(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None

    try:
        return NewsInsightsRequest.model_validate(payload)
    except ValidationError:
        return None


@app.get("/test")
def test():
    diagnostics = (
        get_db_diagnostics()
        if get_db_diagnostics
        else {"error": "postgresService unavailable"}
    )
    return _json_response(
        {
            "message": "ML service running",
            "database": diagnostics,
        }
    )


@app.get("/debug-sales/{product_id}")
def debug_sales(product_id: str):
    print(f"\n--- /debug-sales/{product_id} endpoint was called ---")

    if get_raw_sales_data is None:
        return _json_response({"error": "postgresService not available"}, 503)

    try:
        docs, query, normalized = get_raw_sales_data(product_id)
        return _json_response(
            {
                "productIdInput": product_id,
                "productIdNormalized": normalized,
                "query": _serialize_for_json(query),
                "matchedCount": len(docs),
                "documents": _serialize_for_json(docs),
            }
        )
    except Exception as exc:
        print("debug-sales error:", str(exc))
        return _json_response({"error": str(exc)}, 500)


@app.post("/predict")
async def predict(request: Request):
    print("\n--- /predict endpoint was called ---")

    if predict_demand is None:
        return _json_response({"error": "Prediction service not available"}, 503)

    payload = await _parse_json_body(request)
    if payload is None or payload.productId is None:
        return _json_response({"error": "productId is required"}, 400)

    try:
        prediction_result = await run_in_threadpool(
            predict_demand,
            payload.productId,
            news_text=payload.newsText,
        )
        return _json_response(prediction_result)
    except ValueError as exc:
        print("ValueError:", str(exc))
        return _json_response({"error": str(exc)}, 400)
    except Exception as exc:
        print("Exception:", str(exc))
        return _json_response({"error": "Prediction failed"}, 500)


@app.post("/compare-models")
async def compare_models(request: Request):
    print("\n--- /compare-models endpoint was called ---")

    if compare_arima_prophet is None:
        return _json_response({"error": "Comparison service not available"}, 503)

    payload = await _parse_json_body(request)
    if payload is None or payload.productId is None:
        return _json_response({"error": "productId is required"}, 400)

    try:
        comparison = await run_in_threadpool(compare_arima_prophet, payload.productId)
        prophet_metrics = comparison.get("prophet_metrics", {})
        arima_metrics = comparison.get("arima_metrics", {})
        return _json_response(
            {
                "productId": payload.productId,
                "prophetPrediction": comparison.get("prophet_prediction", []),
                "arimaPrediction": comparison.get("arima_prediction", []),
                "actualValues": comparison.get("actual_values", []),
                "prophetRMSE": prophet_metrics.get("rmse", 0.0),
                "arimaRMSE": arima_metrics.get("rmse", 0.0),
                "prophetMAE": prophet_metrics.get("mae", 0.0),
                "arimaMAE": arima_metrics.get("mae", 0.0),
                "prophetMAPE": prophet_metrics.get("mape", 0.0),
                "arimaMAPE": arima_metrics.get("mape", 0.0),
                "betterModel": comparison.get("better_model", "tie"),
            }
        )
    except ValueError as exc:
        print("ValueError:", str(exc))
        return _json_response({"error": str(exc)}, 400)
    except Exception as exc:
        print("Exception:", str(exc))
        return _json_response({"error": "Comparison failed"}, 500)


@app.api_route("/api/predict/{product_id}", methods=["POST", "GET"])
async def predict_legacy(product_id: str, request: Request):
    print(f"\n--- /api/predict/{product_id} legacy endpoint was called ---")

    if predict_demand is None:
        return _json_response({"error": "Prediction service not available"}, 503)

    payload = await _parse_json_body(request)
    news_text = payload.newsText if payload else ""

    try:
        prediction_result = await run_in_threadpool(
            predict_demand,
            product_id,
            news_text=news_text,
        )
        return _json_response(prediction_result)
    except ValueError as exc:
        print("ValueError:", str(exc))
        return _json_response({"error": str(exc)}, 400)
    except Exception as exc:
        print("Exception:", str(exc))
        return _json_response({"error": "Prediction failed"}, 500)


@app.api_route("/news-insights", methods=["POST", "GET"])
async def news_insights(
    request: Request,
    productName: Optional[str] = Query(default=None),
):
    print("\n--- /news-insights endpoint was called ---")

    payload = await _parse_news_body(request) if request.method == "POST" else None
    product_name = payload.productName if payload else None
    product_name = (product_name or productName or "").strip()
    if not product_name:
        return _json_response({"error": "productName is required"}, 400)

    try:
        return _json_response(
            await run_in_threadpool(_build_news_insights, product_name)
        )
    except Exception as exc:
        print("news-insights error:", str(exc))
        fallback_headlines = [f"{product_name.lower()} market demand stable"] * 5
        return _json_response(
            {
                "productName": product_name,
                "headlines": fallback_headlines,
                "impact": "neutral",
                "keyword": "stable demand",
                "score": 5.0,
                "keywords": ["stable demand"],
                "matchedKeywords": ["stable demand"],
                "sourceHeadlines": fallback_headlines,
                "source": "fallback",
            }
        )


def _build_news_insights(product_name: str) -> dict[str, Any]:
    headlines = []
    source = "fallback"

    if fetch_product_news:
        fetched = fetch_product_news(product_name)
        if isinstance(fetched, dict):
            headlines = fetched.get("headlines") or []
            source = str(fetched.get("source") or "fallback")
        elif isinstance(fetched, list):
            headlines = fetched
            source = "unknown"

    if not headlines and scrape_google_news_headlines:
        headlines = scrape_google_news_headlines(product_name)
        source = "bing"

    headlines = [
        item.strip()
        for item in headlines
        if isinstance(item, str) and item.strip()
    ][:5]

    signal = {
        "impact": "neutral",
        "score": 5.0,
        "keywords": ["stable demand"],
        "matchedKeywords": ["stable demand"],
        "sourceHeadlines": headlines,
        "headlines": headlines,
        "keyword": "stable demand",
    }

    if analyze_news:
        signal = analyze_news(headlines=headlines, product_name=product_name)

    impact = str(signal.get("impact", "neutral")).lower()
    if impact not in {"increase", "decrease", "neutral"}:
        impact = "neutral"

    matched_keywords = signal.get("keywords")
    if not isinstance(matched_keywords, list):
        matched_keywords = signal.get("matchedKeywords")
    if not isinstance(matched_keywords, list):
        matched_keywords = []

    source_headlines = signal.get("sourceHeadlines")
    if not isinstance(source_headlines, list):
        source_headlines = headlines

    keyword = signal.get("keyword")
    if not keyword and matched_keywords:
        keyword = matched_keywords[0]

    try:
        score = float(signal.get("score", 0.0))
    except (TypeError, ValueError):
        score = 0.0

    return {
        "productName": product_name,
        "headlines": headlines,
        "impact": impact,
        "keyword": keyword,
        "score": score,
        "keywords": matched_keywords,
        "matchedKeywords": matched_keywords,
        "sourceHeadlines": source_headlines,
        "source": source,
    }


@app.post("/ai-analyst")
async def ai_analyst(request: Request):
    expected_token = os.getenv("ML_ANALYST_INTERNAL_TOKEN", "").strip()
    supplied_token = request.headers.get("x-ml-internal-token", "").strip()
    if not expected_token:
        return _json_response({"error": "AI Analyst authorization is not configured"}, 503)
    if not supplied_token or not hmac.compare_digest(supplied_token, expected_token):
        return _json_response({"error": "Invalid internal authorization"}, 401)
    try:
        raw_payload = await request.json()
        payload = AnalystRequest.model_validate(raw_payload)
    except (ValidationError, ValueError, TypeError):
        payload = None
    question = payload.question.strip() if payload else ""
    if not question:
        return _json_response({"error": "question is required"}, 400)
    if len(question) > 1000:
        return _json_response({"error": "question must be 1000 characters or fewer"}, 400)
    try:
        return _json_response(await run_in_threadpool(answer_question, question))
    except ProviderUnavailable as exc:
        return _json_response({"error": str(exc)}, 503)
    except ValueError as exc:
        return _json_response({"error": str(exc)}, 400)
    except Exception:
        return _json_response({"error": "AI Analyst failed"}, 500)


if __name__ == "__main__":
    import uvicorn

    print("ML Service running on http://localhost:5002")
    uvicorn.run(app, host="0.0.0.0", port=5002)
