"""
Flask ML Service for demand prediction using Prophet.
Run with: python app.py
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os
from bson import ObjectId
from datetime import datetime

# Load environment variables
load_dotenv()

# Create Flask app
app = Flask(__name__)
CORS(app)


# Import prediction function
try:
    from predictionService import predict_demand
    print("✅ predictionService imported successfully")
except Exception as e:
    print("❌ Error importing predictionService:", str(e))
    predict_demand = None

try:
    from mongoService import get_db_diagnostics, get_raw_sales_data
    print("✅ mongoService imported successfully")
except Exception as e:
    print("❌ Error importing mongoService:", str(e))
    get_db_diagnostics = None
    get_raw_sales_data = None


def _serialize_for_json(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _serialize_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialize_for_json(item) for item in value]
    return value


# ------------------ ROUTES ------------------

@app.route("/test", methods=["GET"])
def test():
    diagnostics = get_db_diagnostics() if get_db_diagnostics else {"error": "mongoService unavailable"}
    return jsonify({
        "message": "ML service running",
        "mongo": diagnostics,
    }), 200


@app.route("/debug-sales/<product_id>", methods=["GET"])
def debug_sales(product_id):
    print(f"\n--- /debug-sales/{product_id} endpoint was called ---")

    if get_raw_sales_data is None:
        return jsonify({"error": "mongoService not available"}), 503

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

    try:
        prediction, min_value, max_value = predict_demand(product_id)

        print("Prediction:", prediction)

        return jsonify({
            "prediction": prediction,
            "min": min_value,
            "max": max_value
        }), 200

    except ValueError as e:
        print("ValueError:", str(e))
        return jsonify({"error": str(e)}), 400

    except Exception as e:
        print("Exception:", str(e))
        return jsonify({"error": "Prediction failed"}), 500


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
        print("[startup] Mongo diagnostics:", get_db_diagnostics())
    print("🚀 ML Service running on http://localhost:5002")
    app.run(host="0.0.0.0", port=5002, debug=True)