from pymongo import MongoClient
from bson import ObjectId
from prophet import Prophet
import pandas as pd
from mongoService import get_sales_data

def predict_demand(product_id: str):
    """
    Forecast product demand for the next 30 days using Facebook Prophet.
    
    Args:
        product_id: Product ID to forecast
        
    Returns:
        tuple: (prediction, min_value, max_value)
        
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
    prediction = max(0, int(round(next_30["yhat"].sum())))
    min_value = max(0, int(round(next_30["yhat_lower"].sum())))
    max_value = max(0, int(round(next_30["yhat_upper"].sum())))

    return prediction, min_value, max_value