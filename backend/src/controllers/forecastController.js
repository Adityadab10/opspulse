import { getSalesSeriesByProductId, isProductReference, resolveProduct, upsertPrediction } from "../config/postgres.js";
import { sendBackendError } from "../helpers/errorResponse.js";
import { requestMlForecast } from "../services/predictionMlClient.js";

const MAX_HORIZON_DAYS = 90;

const validateHorizon = (value) => {
  const horizon = Number(value ?? 30);
  return Number.isInteger(horizon) && horizon >= 1 && horizon <= MAX_HORIZON_DAYS ? horizon : null;
};

const summarizeHistory = (rows) => {
  const byDate = new Map();
  for (const row of rows) {
    const date = new Date(row.sale_date);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) || 0) + Number(row.quantity || 0));
  }
  return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, quantity]) => ({ date, quantity }));
};

export const forecastProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const horizon = validateHorizon(req.query?.horizon);
    const model = String(req.query?.model || "auto").trim().toLowerCase();
    if (!isProductReference(productId)) return res.status(400).json({ message: "Invalid productId" });
    if (!horizon) return res.status(400).json({ message: `horizon must be an integer between 1 and ${MAX_HORIZON_DAYS}` });
    if (!["auto", "prophet", "arima"].includes(model)) return res.status(400).json({ message: "model must be auto, prophet, or arima" });

    const tenantId = req.authContext.tenantId;
    const product = await resolveProduct(tenantId, productId);
    if (!product || product.legacy_mongo_id === "test123") return res.status(404).json({ message: "Product not found" });

    const historyRows = await getSalesSeriesByProductId(tenantId, product.id);
    const historical = summarizeHistory(historyRows);
    if (historical.length < 5) {
      return res.status(422).json({
        message: "Insufficient historical demand data",
        code: "INSUFFICIENT_DATA",
        requiredPoints: 5,
        historicalPoints: historical.length,
        product: { id: product.id, name: product.name, category: product.category },
        historical,
      });
    }

    const mlResponse = await requestMlForecast({ productId: product.id, horizon, model });
    if (!mlResponse.ok) {
      if (mlResponse.status === 422) return res.status(422).json(mlResponse.payload);
      const error = new Error(`ML service responded with status ${mlResponse.status}`);
      error.code = "ML_SERVICE_REJECTED";
      error.status = mlResponse.status;
      throw error;
    }
    const forecast = mlResponse.payload;
    if (!forecast?.success || !Array.isArray(forecast.forecast)) {
      return res.status(422).json({ message: forecast?.message || "Forecast unavailable", code: forecast?.error || "FORECAST_UNAVAILABLE" });
    }

    const predictedDemand = forecast.forecast.reduce((sum, point) => sum + Number(point.value || 0), 0);
    const avgSales = historical.reduce((sum, point) => sum + Number(point.quantity || 0), 0) / historical.length;
    const percentChange = avgSales ? ((predictedDemand - avgSales * horizon) / (avgSales * horizon)) * 100 : 0;
    const saved = await upsertPrediction(tenantId, product.id, {
      predictedDemand,
      avgSales,
      percentChange,
      confidence: historical.length >= 21 ? "High" : "Medium",
      seasonTag: "Normal",
      rulePrediction: predictedDemand,
      mlPrediction: predictedDemand,
      adjustedPrediction: predictedDemand,
      decision: "maintain",
      impact: "neutral",
      keyword: null,
      score: 0,
      sourceHeadline: null,
      sourceHeadlines: [],
      matchedKeywords: [],
      reason: `${forecast.selectedModel} forecast over ${horizon} days using recorded sales quantities`,
      contributingFactors: [{ key: "historicalPoints", value: historical.length, source: "postgres" }],
      predictionSource: "ml",
      predictionHorizonDays: horizon,
    });

    return res.status(200).json({
      product: { id: product.id, name: product.name, category: product.category },
      selectedModel: forecast.selectedModel,
      horizon,
      historical,
      forecast: forecast.forecast,
      generatedAt: forecast.generatedAt,
      persistedPredictionId: saved?.id || null,
    });
  } catch (error) {
    return sendBackendError(res, "Failed to generate demand forecast", error);
  }
};

export { summarizeHistory, validateHorizon };
