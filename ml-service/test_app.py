import threading
import time

import pytest
from fastapi.testclient import TestClient

import app


client = TestClient(app.app)


def test_compare_models_requires_product_id(monkeypatch):
    monkeypatch.setattr(app, "compare_arima_prophet", lambda _: {})

    response = client.post("/compare-models", json={})

    assert response.status_code == 400
    assert response.json() == {"error": "productId is required"}


def test_compare_models_preserves_response_contract(monkeypatch):
    monkeypatch.setattr(
        app,
        "compare_arima_prophet",
        lambda product_id: {
            "prophet_prediction": [1.0],
            "arima_prediction": [2.0],
            "actual_values": [1.5],
            "prophet_metrics": {"rmse": 1.0, "mae": 0.5, "mape": 10.0},
            "arima_metrics": {"rmse": 2.0, "mae": 1.5, "mape": 20.0},
            "better_model": "prophet",
        },
    )

    response = client.post("/compare-models", json={"productId": "product-1"})

    assert response.status_code == 200
    assert response.json() == {
        "productId": "product-1",
        "prophetPrediction": [1.0],
        "arimaPrediction": [2.0],
        "actualValues": [1.5],
        "prophetRMSE": 1.0,
        "arimaRMSE": 2.0,
        "prophetMAE": 0.5,
        "arimaMAE": 1.5,
        "prophetMAPE": 10.0,
        "arimaMAPE": 20.0,
        "betterModel": "prophet",
    }


def test_compare_models_maps_insufficient_data_to_400(monkeypatch):
    def raise_insufficient_data(_):
        raise ValueError("Not enough data to compare ARIMA and Prophet (need at least 5 rows)")

    monkeypatch.setattr(app, "compare_arima_prophet", raise_insufficient_data)

    response = client.post("/compare-models", json={"productId": "curd"})

    assert response.status_code == 400
    assert "Not enough data" in response.json()["error"]


def test_predict_maps_model_errors_to_500(monkeypatch):
    monkeypatch.setattr(app, "predict_demand", lambda *_args, **_kwargs: 1 / 0)

    response = client.post("/predict", json={"productId": "product-1"})

    assert response.status_code == 500
    assert response.json() == {"error": "Prediction failed"}


def test_blocking_comparison_does_not_block_lightweight_route(monkeypatch):
    started = threading.Event()

    def blocking_comparison(_):
        started.set()
        time.sleep(0.15)
        return {}

    monkeypatch.setattr(app, "compare_arima_prophet", blocking_comparison)

    comparison_result = {}

    def run_comparison():
        comparison_result["response"] = client.post(
            "/compare-models",
            json={"productId": "product-1"},
        )

    worker = threading.Thread(target=run_comparison)
    worker.start()
    assert started.wait(timeout=1)

    started_at = time.perf_counter()
    response = client.get("/openapi.json")
    elapsed = time.perf_counter() - started_at

    worker.join(timeout=1)
    assert response.status_code == 200
    assert elapsed < 0.1
    assert comparison_result["response"].status_code == 200


def test_predict_preserves_success_response_contract(monkeypatch):
    monkeypatch.setattr(
        app,
        "predict_demand",
        lambda product_id, news_text="": {
            "forecast": 12,
            "decision": "increase",
            "productId": product_id,
        },
    )

    response = client.post("/predict", json={"productId": "product-1"})

    assert response.status_code == 200
    assert response.json() == {
        "forecast": 12,
        "decision": "increase",
        "productId": "product-1",
    }


def test_news_insights_preserves_response_contract(monkeypatch):
    monkeypatch.setattr(
        app,
        "fetch_product_news",
        lambda _: {"headlines": ["Demand is rising"], "source": "test"},
    )
    monkeypatch.setattr(
        app,
        "analyze_news",
        lambda **_: {
            "impact": "increase",
            "score": 8,
            "keywords": ["demand"],
            "keyword": "demand",
        },
    )

    response = client.post("/news-insights", json={"productName": "Widget"})

    assert response.status_code == 200
    assert response.json() == {
        "productName": "Widget",
        "headlines": ["Demand is rising"],
        "impact": "increase",
        "keyword": "demand",
        "score": 8.0,
        "keywords": ["demand"],
        "matchedKeywords": ["demand"],
        "sourceHeadlines": ["Demand is rising"],
        "source": "test",
    }


@pytest.mark.parametrize("path", ["/predict", "/compare-models"])
def test_prediction_endpoints_reject_missing_product_id(path, monkeypatch):
    monkeypatch.setattr(app, "predict_demand", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(app, "compare_arima_prophet", lambda *_args, **_kwargs: {})

    response = client.post(path, json={})

    assert response.status_code == 400
    assert response.json() == {"error": "productId is required"}
