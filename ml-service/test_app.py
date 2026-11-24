import threading

import pytest
from fastapi.testclient import TestClient

import app


client = TestClient(app.app)


@pytest.fixture(autouse=True)
def override_trusted_context():
    from security import TrustedContext, require_trusted_context
    app.app.dependency_overrides[require_trusted_context] = lambda: TrustedContext(
        tenant_id="test-tenant-001",
        user_id="test-user-001",
        correlation_id="test-corr-001",
    )
    yield
    app.app.dependency_overrides.clear()



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


def test_forecast_requires_product_id(monkeypatch):
    monkeypatch.setattr(app, "forecast_product", lambda *_args, **_kwargs: {})
    response = client.post("/forecast", json={})
    assert response.status_code == 400
    assert response.json() == {"error": "productId is required"}


def test_forecast_returns_model_horizon_and_series(monkeypatch):
    monkeypatch.setattr(app, "forecast_product", lambda *args, **kwargs: {
        "success": True,
        "selectedModel": "arima",
        "horizon": 7,
        "historical": [{"date": "2026-01-01", "quantity": 4}],
        "forecast": [{"date": "2026-01-02", "value": 5.0}],
        "historicalPoints": 5,
        "generatedAt": "2026-01-01T00:00:00Z",
    })
    response = client.post("/forecast", json={"productId": "product-1", "horizon": 7, "model": "auto"})
    assert response.status_code == 200
    assert response.json()["selectedModel"] == "arima"
    assert response.json()["horizon"] == 7


def test_forecast_maps_insufficient_data_to_422(monkeypatch):
    monkeypatch.setattr(app, "forecast_product", lambda *_args, **_kwargs: {
        "success": False,
        "error": "INSUFFICIENT_DATA",
        "message": "At least 5 daily sales observations are required",
    })
    response = client.post("/forecast", json={"productId": "product-1", "horizon": 30})
    assert response.status_code == 422
    assert response.json()["error"] == "INSUFFICIENT_DATA"


def test_predict_maps_model_errors_to_500(monkeypatch):
    monkeypatch.setattr(app, "predict_demand", lambda *_args, **_kwargs: 1 / 0)

    response = client.post("/predict", json={"productId": "product-1"})

    assert response.status_code == 500
    assert response.json() == {"error": "Prediction failed"}


def test_blocking_comparison_does_not_block_lightweight_route(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    started = threading.Event()
    release = threading.Event()

    def blocking_comparison(_):
        started.set()
        assert release.wait(timeout=10)
        return {}

    monkeypatch.setattr(app, "compare_arima_prophet", blocking_comparison)
    monkeypatch.delenv("OPSPULSE_RUNTIME_DATABASE_URL", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setattr(app.default_checkpointer_manager, "initialize", lambda: None)
    monkeypatch.setattr(app.default_checkpointer_manager, "close", lambda: None)

    with TestClient(app.app) as shared_client, ThreadPoolExecutor(max_workers=2) as executor:
        comparison = executor.submit(shared_client.post, "/compare-models", json={"productId": "product-1"})
        try:
            assert started.wait(timeout=5)
            health = executor.submit(shared_client.get, "/health")
            assert health.result(timeout=5).status_code == 200
            assert not comparison.done()
        finally:
            release.set()
        assert comparison.result(timeout=5).status_code == 200


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



def test_prophet_forecast_accepts_utc_sales_dates(monkeypatch):
    from datetime import date, timedelta
    import forecastService

    sales = [
        {"date": date(2025, 1, 1) + timedelta(days=day), "quantity": 10 + day % 7}
        for day in range(30)
    ]
    monkeypatch.setattr(forecastService, "get_sales_data", lambda *args, **kwargs: sales)

    result = forecastService.forecast_product("fixture-product", 3, "prophet", "fixture-tenant")

    assert result["selectedModel"] == "prophet"
    assert result["historicalPoints"] == 30
    assert len(result["forecast"]) == 3
    assert result["forecast"][0]["date"].endswith("+00:00")
