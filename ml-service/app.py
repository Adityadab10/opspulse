"""
Flask ML Service for demand prediction using Prophet.
Run with: python app.py
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os
from datetime import date, datetime
from decimal import Decimal

# Load environment variables
load_dotenv()

# Create Flask app
app = Flask(__name__)
CORS(app)


# Import prediction function
try:
    from predictionService import predict_demand
    print("[ok] predictionService imported successfully")
except Exception as e:
    print("[error] Error importing predictionService:", str(e))
    predict_demand = None

try:
    from arimaService import compare_arima_prophet
    print("[ok] arimaService imported successfully")
except Exception as e:
    print("[error] Error importing arimaService:", str(e))
    compare_arima_prophet = None

try:
    from postgresService import get_db_diagnostics, get_raw_sales_data
    print("[ok] postgresService imported successfully")
except Exception as e:
    print("[error] Error importing postgresService:", str(e))
    get_db_diagnostics = None
    get_raw_sales_data = None

try:
    from newsFetcher import fetch_product_news
    print("[ok] newsFetcher imported successfully")
except Exception as e:
    print("[error] Error importing newsFetcher:", str(e))
    fetch_product_news = None

try:
    from newsScraper import scrape_google_news_headlines
    print("[ok] newsScraper imported successfully")
except Exception as e:
    print("[error] Error importing newsScraper:", str(e))
    scrape_google_news_headlines = None

try:
    from newsService import analyze_news
    print("[ok] newsService imported successfully")
except Exception as e:
    print("[error] Error importing newsService:", str(e))
    analyze_news = None


def _serialize_for_json(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _serialize_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialize_for_json(item) for item in value]
    return value


# ------------------ ROUTES ------------------

@app.route("/test", methods=["GET"])
def test():
    diagnostics = get_db_diagnostics() if get_db_diagnostics else {"error": "postgresService unavailable"}
    return jsonify({
        "message": "ML service running",
        "database": diagnostics,
    }), 200


@app.route("/debug-sales/<product_id>", methods=["GET"])
def debug_sales(product_id):
    print(f"\n--- /debug-sales/{product_id} endpoint was called ---")

    if get_raw_sales_data is None:
        return jsonify({"error": "postgresService not available"}), 503

    try:
        docs, query, normalized = get_raw_sales_data(product_id)

        return jsonify({
            "productIdInput": product_id,
            "productIdNormalized": normalized,
            "query": _serialize_for_json(query),
            "matchedCount": len(docs),
            "documents": _serialize_for_json(docs),
        }), 200
    except Exception as e:
        print("debug-sales error:", str(e))
        return jsonify({"error": str(e)}), 500


@app.route("/predict", methods=["POST"])
def predict():
    print("\n--- /predict endpoint was called ---")

    if predict_demand is None:
        return jsonify({"error": "Prediction service not available"}), 503

    data = request.get_json()
    print("Request data:", data)

    if not data or "productId" not in data:
        return jsonify({"error": "productId is required"}), 400

    product_id = data["productId"]
    news_text = data.get("newsText", "")

    try:
        prediction_result = predict_demand(product_id, news_text=news_text)

        print("Prediction result:", prediction_result)

        return jsonify(prediction_result), 200

    except ValueError as e:
        print("ValueError:", str(e))
        return jsonify({"error": str(e)}), 400

    except Exception as e:
        print("Exception:", str(e))
        return jsonify({"error": "Prediction failed"}), 500


@app.route("/compare-models", methods=["POST"])
def compare_models():
    print("\n--- /compare-models endpoint was called ---")

    if compare_arima_prophet is None:
        return jsonify({"error": "Comparison service not available"}), 503

    data = request.get_json()
    print("Request data:", data)

    if not data or "productId" not in data:
        return jsonify({"error": "productId is required"}), 400

    product_id = data["productId"]

    try:
        comparison = compare_arima_prophet(product_id)

        prophet_prediction = comparison.get("prophet_prediction", [])
        arima_prediction = comparison.get("arima_prediction", [])
        actual_values = comparison.get("actual_values", [])
        prophet_metrics = comparison.get("prophet_metrics", {})
        arima_metrics = comparison.get("arima_metrics", {})

        response_payload = {
            "productId": product_id,
            "prophetPrediction": prophet_prediction,
            "arimaPrediction": arima_prediction,
            "actualValues": actual_values,
            "prophetRMSE": prophet_metrics.get("rmse", 0.0),
            "arimaRMSE": arima_metrics.get("rmse", 0.0),
            "prophetMAE": prophet_metrics.get("mae", 0.0),
            "arimaMAE": arima_metrics.get("mae", 0.0),
            "prophetMAPE": prophet_metrics.get("mape", 0.0),
            "arimaMAPE": arima_metrics.get("mape", 0.0),
            "betterModel": comparison.get("better_model", "tie"),
        }

        print("Comparison result:", response_payload)

        return jsonify(response_payload), 200

    except ValueError as e:
        print("ValueError:", str(e))
        return jsonify({"error": str(e)}), 400

    except Exception as e:
        print("Exception:", str(e))
        return jsonify({"error": "Comparison failed"}), 500


@app.route("/api/predict/<product_id>", methods=["POST", "GET"])
def predict_legacy(product_id):
    print(f"\n--- /api/predict/{product_id} legacy endpoint was called ---")

    if predict_demand is None:
        return jsonify({"error": "Prediction service not available"}), 503

    payload = request.get_json(silent=True) or {}
    news_text = payload.get("newsText", "")

    try:
        prediction_result = predict_demand(product_id, news_text=news_text)
        print("Prediction result:", prediction_result)
        return jsonify(prediction_result), 200
    except ValueError as e:
        print("ValueError:", str(e))
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print("Exception:", str(e))
        return jsonify({"error": "Prediction failed"}), 500


@app.route("/news-insights", methods=["POST", "GET"])
def news_insights():
    print("\n--- /news-insights endpoint was called ---")

    payload = request.get_json(silent=True) or {}
    product_name = payload.get("productName") if isinstance(payload, dict) else None
    if not product_name:
        product_name = request.args.get("productName")

    product_name = (product_name or "").strip()
    if not product_name:
        return jsonify({"error": "productName is required"}), 400

    headlines = []
    source = "fallback"

    try:
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

        headlines = [item.strip() for item in headlines if isinstance(item, str) and item.strip()][:5]

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

        score = signal.get("score", 0.0)
        try:
            score = float(score)
        except Exception:
            score = 0.0

        print("Product:", product_name)
        print("Headlines:", source_headlines)
        print("Score:", score)
        print("Impact:", impact)

        return jsonify({
            "productName": product_name,
            "headlines": headlines,
            "impact": impact,
            "keyword": keyword,
            "score": score,
            "keywords": matched_keywords,
            "matchedKeywords": matched_keywords,
            "sourceHeadlines": source_headlines,
            "source": source,
        }), 200
    except Exception as e:
        print("news-insights error:", str(e))
        fallback_headlines = [f"{product_name.lower()} market demand stable"] * 5
        return jsonify({
            "productName": product_name,
            "headlines": fallback_headlines,
            "impact": "neutral",
            "keyword": "stable demand",
            "score": 5.0,
            "keywords": ["stable demand"],
            "matchedKeywords": ["stable demand"],
            "sourceHeadlines": fallback_headlines,
            "source": "fallback",
        }), 200


# ------------------ DEBUG ROUTES PRINT ------------------

def print_routes():
    print("\n================ REGISTERED ROUTES ================")
    for rule in app.url_map.iter_rules():
        methods = ', '.join(rule.methods - {'HEAD', 'OPTIONS'})
        print(f"{rule.rule:30s} -> {methods}")
    print("===================================================\n")


# ------------------ RUN SERVER ------------------

if __name__ == "__main__":
    print_routes()
    if get_db_diagnostics:
        print("[startup] PostgreSQL diagnostics:", get_db_diagnostics())
    print("ML Service running on http://localhost:5002")
    app.run(host="0.0.0.0", port=5002, debug=True)