import os
from joblib import load


def test_rf_model_bundle_loads_and_predicts():
    model_path = os.path.join(os.path.dirname(__file__), "demand_decision_rf.joblib")
    bundle = load(model_path)

    model = bundle["model"]
    label_encoder = bundle["label_encoder"]

    result = model.predict([[1, 2, 0, 100]])
    decoded = label_encoder.inverse_transform(result)

    assert len(decoded) == 1
    assert decoded[0] in ["increase", "maintain", "reduce"]


if __name__ == "__main__":
    test_rf_model_bundle_loads_and_predicts()
    print("RF model test completed successfully.")
