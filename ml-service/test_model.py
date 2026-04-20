from joblib import load

bundle = load("demand_decision_rf.joblib")

model = bundle["model"]
label_encoder = bundle["label_encoder"]

# dummy input (replace later properly)
result = model.predict([[1, 2, 0, 100]])

decoded = label_encoder.inverse_transform(result)

print("Encoded:", result)
print("Decoded:", decoded)