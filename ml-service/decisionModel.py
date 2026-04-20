"""Random Forest model for demand decision prediction using synthetic data."""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

MODEL_PATH = Path(__file__).with_name("demand_decision_rf.joblib")

FEATURE_COLUMNS = ["trend", "season", "keywordImpact", "forecastValue"]
CATEGORICAL_COLUMNS = ["trend", "season", "keywordImpact"]
TARGET_COLUMN = "decision"

SYNTHETIC_DATA = [
    {"trend": "increasing", "season": "summer", "keywordImpact": "increase", "forecastValue": 240, "decision": "increase"},
    {"trend": "increasing", "season": "summer", "keywordImpact": "neutral", "forecastValue": 210, "decision": "increase"},
    {"trend": "increasing", "season": "winter", "keywordImpact": "increase", "forecastValue": 190, "decision": "increase"},
    {"trend": "increasing", "season": "normal", "keywordImpact": "increase", "forecastValue": 175, "decision": "increase"},
    {"trend": "stable", "season": "summer", "keywordImpact": "increase", "forecastValue": 165, "decision": "increase"},
    {"trend": "stable", "season": "normal", "keywordImpact": "neutral", "forecastValue": 130, "decision": "maintain"},
    {"trend": "stable", "season": "winter", "keywordImpact": "neutral", "forecastValue": 120, "decision": "maintain"},
    {"trend": "stable", "season": "normal", "keywordImpact": "increase", "forecastValue": 140, "decision": "maintain"},
    {"trend": "increasing", "season": "normal", "keywordImpact": "neutral", "forecastValue": 150, "decision": "maintain"},
    {"trend": "decreasing", "season": "normal", "keywordImpact": "neutral", "forecastValue": 95, "decision": "maintain"},
    {"trend": "decreasing", "season": "winter", "keywordImpact": "decrease", "forecastValue": 80, "decision": "reduce"},
    {"trend": "decreasing", "season": "summer", "keywordImpact": "decrease", "forecastValue": 90, "decision": "reduce"},
    {"trend": "decreasing", "season": "normal", "keywordImpact": "decrease", "forecastValue": 70, "decision": "reduce"},
    {"trend": "stable", "season": "winter", "keywordImpact": "decrease", "forecastValue": 85, "decision": "reduce"},
    {"trend": "decreasing", "season": "winter", "keywordImpact": "neutral", "forecastValue": 75, "decision": "reduce"},
    {"trend": "stable", "season": "summer", "keywordImpact": "neutral", "forecastValue": 145, "decision": "maintain"},
    {"trend": "increasing", "season": "winter", "keywordImpact": "neutral", "forecastValue": 155, "decision": "maintain"},
    {"trend": "decreasing", "season": "normal", "keywordImpact": "increase", "forecastValue": 110, "decision": "maintain"},
]


def _normalize_categorical(value):
    return str(value).strip().lower()


def train_and_save_model(model_path=MODEL_PATH):
    """Train a RandomForestClassifier on synthetic data and save with encoders."""
    df = pd.DataFrame(SYNTHETIC_DATA)

    feature_encoders = {}
    for column in CATEGORICAL_COLUMNS:
        df[column] = df[column].map(_normalize_categorical)
        encoder = LabelEncoder()
        df[column] = encoder.fit_transform(df[column])
        feature_encoders[column] = encoder

    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(df[TARGET_COLUMN])

    X = df[FEATURE_COLUMNS]

    model = RandomForestClassifier(
        n_estimators=200,
        random_state=42,
        max_depth=6,
    )
    model.fit(X, y)

    artifact = {
        "model": model,
        "feature_encoders": feature_encoders,
        "label_encoder": label_encoder,
        "feature_columns": FEATURE_COLUMNS,
    }

    joblib.dump(artifact, model_path)
    return artifact


def _load_or_train_artifact(model_path=MODEL_PATH):
    if model_path.exists():
        return joblib.load(model_path)
    return train_and_save_model(model_path=model_path)


def predict_decision(input_data):
    """Predict one demand decision: increase, maintain, or reduce."""
    artifact = _load_or_train_artifact()
    model = artifact["model"]
    feature_encoders = artifact["feature_encoders"]
    label_encoder = artifact["label_encoder"]

    encoded_values = {}

    for column in CATEGORICAL_COLUMNS:
        if column not in input_data:
            raise ValueError(f"Missing required field: {column}")

        value = _normalize_categorical(input_data[column])
        encoder = feature_encoders[column]

        if value not in encoder.classes_:
            supported = ", ".join(encoder.classes_)
            raise ValueError(f"Unsupported value for {column}: {value}. Supported: {supported}")

        encoded_values[column] = int(encoder.transform([value])[0])

    if "forecastValue" not in input_data:
        raise ValueError("Missing required field: forecastValue")

    forecast_value = float(input_data["forecastValue"])

    X_pred = pd.DataFrame([
        {
            "trend": encoded_values["trend"],
            "season": encoded_values["season"],
            "keywordImpact": encoded_values["keywordImpact"],
            "forecastValue": forecast_value,
        }
    ], columns=artifact["feature_columns"])

    prediction_index = model.predict(X_pred)[0]
    decision = label_encoder.inverse_transform([prediction_index])[0]
    return decision


if __name__ == "__main__":
    train_and_save_model()
    sample_input = {
        "trend": "increasing",
        "season": "summer",
        "keywordImpact": "increase",
        "forecastValue": 220,
    }
    print("Predicted decision:", predict_decision(sample_input))
