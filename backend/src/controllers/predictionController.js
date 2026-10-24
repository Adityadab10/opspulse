import { generatePredictionForProduct } from "../services/predictionService.js";
import pool from "../config/database.js";
import {
  deleteActiveAlertsForProduct,
  getPredictionByProductId,
  getAllProducts,
  isProductReference,
  resolveProduct,
  upsertAlertByProductAndType,
} from "../config/postgres.js";

const ML_PREDICT_URL = process.env.ML_PREDICT_URL || "http://localhost:5002/predict";
const ML_COMPARE_URL = process.env.ML_COMPARE_URL || "http://localhost:5002/compare-models";
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS || 10000);
const ML_COMPARE_TIMEOUT_MS = Number(process.env.ML_COMPARE_TIMEOUT_MS || 30000);
const ML_COMPARE_CONCURRENCY = Math.max(1, Number(process.env.ML_COMPARE_CONCURRENCY || 4));
const ML_PREDICTION_CONCURRENCY = Math.max(1, Number(process.env.ML_PREDICTION_CONCURRENCY || 4));
const PREDICTION_CACHE_TTL_MS = Number(process.env.PREDICTION_CACHE_TTL_MS || 5 * 60 * 1000);

const predictionCache = new Map();
const ALL_PREDICTIONS_CACHE_KEY = "all-predictions";

const nowIso = () => new Date().toISOString();

const logEvent = (level, message, meta = {}) => {
  const payload = {
    ts: nowIso(),
    level,
    message,
    ...meta,
  };

  if (level === "error") {
    console.error("[prediction-controller]", JSON.stringify(payload));
    return;
  }

  if (level === "warn") {
    console.warn("[prediction-controller]", JSON.stringify(payload));
    return;
  }

  console.log("[prediction-controller]", JSON.stringify(payload));
};

const sendSuccess = (res, statusCode, data, meta = {}) => {
  return res.status(statusCode).json({
    success: true,
    timestamp: nowIso(),
    data,
    meta,
  });
};

const sendError = (res, statusCode, message, details = null) => {
  return res.status(statusCode).json({
    success: false,
    timestamp: nowIso(),
    error: {
      message,
      details,
    },
  });
};

const settleWithConcurrency = async (items, worker, concurrency) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );

  return results;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
};

const mapPostgresPredictionToDocumentShape = (prediction) => ({
  ...prediction,
  productId: prediction.productId ?? prediction.product_id,
  predictedDemand: prediction.predictedDemand ?? prediction.predicted_demand,
  rulePrediction: prediction.rulePrediction ?? prediction.rule_prediction,
  mlPrediction: prediction.mlPrediction ?? prediction.ml_prediction,
  adjustedPrediction: prediction.adjustedPrediction ?? prediction.adjusted_prediction,
  avgSales: prediction.avgSales ?? prediction.avg_sales,
  percentChange: prediction.percentChange ?? prediction.percent_change,
  seasonTag: prediction.seasonTag ?? prediction.season_tag,
  sourceHeadline: prediction.sourceHeadline ?? prediction.source_headline,
  sourceHeadlines: prediction.sourceHeadlines ?? prediction.source_headlines,
  matchedKeywords: prediction.matchedKeywords ?? prediction.matched_keywords,
  contributingFactors: prediction.contributingFactors ?? prediction.contributing_factors,
  predictionSource: prediction.predictionSource ?? prediction.prediction_source,
  predictedAt: prediction.predictedAt ?? prediction.predicted_at,
});

const isTruthy = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const getCacheValue = (key) => {
  const cached = predictionCache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() >= cached.expiresAt) {
    predictionCache.delete(key);
    return null;
  }

  return cached.value;
};

const setCacheValue = (key, value) => {
  predictionCache.set(key, {
    value,
    expiresAt: Date.now() + PREDICTION_CACHE_TTL_MS,
  });
};

const invalidateAllPredictionsCache = () => {
  predictionCache.delete(ALL_PREDICTIONS_CACHE_KEY);
};

const isFreshPrediction = (predictedAt) => {
  if (!predictedAt) {
    return false;
  }

  const timestamp = new Date(predictedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return Date.now() - timestamp < PREDICTION_CACHE_TTL_MS;
};

const normalizeDecision = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "increase" || normalized === "maintain" || normalized === "reduce") {
    return normalized;
  }
  return "maintain";
};

const normalizeImpact = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "increase" || normalized === "decrease" || normalized === "neutral") {
    return normalized;
  }
  return "neutral";
};

const deriveRuleDecision = (percentChange) => {
  const change = toNumber(percentChange, 0);
  if (change > 10) return "increase";
  if (change < -10) return "reduce";
  return "maintain";
};

const normalizeConfidence = (value, fallback = "Low") => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "high") return "High";
    if (normalized === "medium") return "Medium";
    if (normalized === "low") return "Low";

    const numericFromString = Number(normalized);
    if (Number.isFinite(numericFromString)) {
      if (numericFromString >= 0.75) return "High";
      if (numericFromString >= 0.5) return "Medium";
      return "Low";
    }
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.75) return "High";
    if (numeric >= 0.5) return "Medium";
    return "Low";
  }

  return fallback;
};

const classifyMlFailure = (error) => {
  const rawMessage = String(error?.message || "").trim();
  const normalized = rawMessage.toLowerCase();
  const statusMatch = normalized.match(/status\s+(\d{3})/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : null;

  if (normalized.includes("abort")) {
    return {
      type: "timeout",
      message: `the ML service timed out after ${ML_TIMEOUT_MS}ms`,
    };
  }

  if (statusCode === 503) {
    return {
      type: "service-unavailable",
      message: "the ML service is temporarily unavailable (503)",
    };
  }

  if (statusCode === 400) {
    return {
      type: "invalid-input",
      message: "the ML service rejected this prediction request (400)",
    };
  }

  if (statusCode && statusCode >= 500) {
    return {
      type: "service-error",
      message: `the ML service returned an internal error (${statusCode})`,
    };
  }

  if (
    normalized.includes("fetch failed") ||
    normalized.includes("econnrefused") ||
    normalized.includes("network")
  ) {
    return {
      type: "unreachable",
      message: "the ML service could not be reached on the network",
    };
  }

  return {
    type: "unknown",
    message: rawMessage || "the ML prediction path was unavailable",
  };
};

const buildProductRef = (product, fallbackProductId = null) => {
  const resolvedProductId =
    product && typeof product === "object"
      ? product.id || product._id || product.productId || fallbackProductId
      : fallbackProductId;

  return {
    _id: resolvedProductId ? String(resolvedProductId) : null,
    name: product?.name || "Unknown Product",
    category: product?.category || "Uncategorized",
  };
};

const buildExplainability = ({
  predictionSource,
  rulePrediction,
  decision,
  impact,
  confidence,
  newsSignal,
  mlFailure,
}) => {
  const percentChange = toNumber(rulePrediction?.percentChange, 0);
  const trendDirection = percentChange > 0 ? "upward" : percentChange < 0 ? "downward" : "flat";
  const reason = predictionSource === "ml"
    ? `ML decision '${decision}' using forecast signal with ${impact} impact and ${trendDirection} sales trend.`
    : `Rule-based decision '${decision}' from sales trend (${percentChange.toFixed(1)}%) because ${
        mlFailure?.message || "the ML prediction path was unavailable"
      }.`;

  const factors = [
    {
      key: "salesPercentChange",
      value: percentChange,
      source: "rule-engine",
    },
    {
      key: "seasonTag",
      value: String(rulePrediction?.seasonTag || "Normal"),
      source: "rule-engine",
    },
    {
      key: "impact",
      value: impact,
      source: predictionSource === "ml" ? "ml-service" : "rule-engine",
    },
    {
      key: "confidence",
      value: confidence,
      source: predictionSource === "ml" ? "ml-service" : "rule-engine",
    },
    {
      key: "newsScore",
      value: toNumber(newsSignal?.score, 0),
      source: predictionSource === "ml" ? "ml-service" : "rule-engine",
    },
    {
      key: "newsKeyword",
      value: newsSignal?.keyword || "none",
      source: predictionSource === "ml" ? "ml-service" : "rule-engine",
    },
  ];

  if (predictionSource !== "ml" && mlFailure?.type) {
    factors.push({
      key: "mlFallbackCause",
      value: mlFailure.type,
      source: "ml-service",
    });
  }

  return {
    reason,
    contributingFactors: factors,
  };
};

const mapPredictionDocToResponse = (predictionDoc, fallbackProduct = null) => {
  if (!predictionDoc) {
    return null;
  }

  const doc = mapPostgresPredictionToDocumentShape(predictionDoc);

  const productRef =
    doc.productId && typeof doc.productId === "object"
      ? buildProductRef(doc.productId)
      : buildProductRef(fallbackProduct, doc.productId);

  return {
    productId: productRef,
    predictedDemand: toNumber(doc.predictedDemand, 0),
    avgSales: toNumber(doc.avgSales, 0),
    percentChange: toNumber(doc.percentChange, 0),
    seasonTag: String(doc.seasonTag || "Normal"),
    rulePrediction: toNumber(doc.rulePrediction, toNumber(doc.predictedDemand, 0)),
    mlPrediction: toNumber(doc.mlPrediction, toNumber(doc.predictedDemand, 0)),
    adjustedPrediction: toNumber(
      doc.adjustedPrediction,
      toNumber(doc.predictedDemand, 0)
    ),
    decision: normalizeDecision(doc.decision),
    impact: normalizeImpact(doc.impact),
    keyword: doc.keyword || null,
    score: toNumber(doc.score, 0),
    sourceHeadline: doc.sourceHeadline || null,
    sourceHeadlines: Array.isArray(doc.sourceHeadlines) ? doc.sourceHeadlines : [],
    matchedKeywords: Array.isArray(doc.matchedKeywords) ? doc.matchedKeywords : [],
    confidence: normalizeConfidence(doc.confidence, "Low"),
    reason: String(doc.reason || "No explanation available"),
    contributingFactors: Array.isArray(doc.contributingFactors)
      ? doc.contributingFactors
      : [],
    predictionSource:
      doc.predictionSource === "ml" ? "ml" : "rule-based",
    predictedAt: doc.predictedAt || doc.updatedAt || new Date(),
  };
};

const isRuleBasedPrediction = (predictionLike) => {
  const source = String(predictionLike?.predictionSource || "").trim().toLowerCase();
  return source === "rule-based";
};

const callMlPrediction = async (productId) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

  try {
    if (typeof fetch !== "function") {
      throw new Error("Global fetch is not available in this Node runtime");
    }

    const response = await fetch(ML_PREDICT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: String(productId) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let details = "";
      try {
        const maybeJson = await response.json();
        if (maybeJson && typeof maybeJson === "object") {
          details = String(maybeJson.error || maybeJson.message || "").trim();
        }
      } catch {
        try {
          details = String(await response.text()).trim();
        } catch {
          details = "";
        }
      }

      const suffix = details ? `: ${details}` : "";
      throw new Error(`ML service responded with status ${response.status}${suffix}`);
    }

    const payload = await response.json();
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
};

const callMlComparison = async (productId) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ML_COMPARE_TIMEOUT_MS);

  try {
    if (typeof fetch !== "function") {
      throw new Error("Global fetch is not available in this Node runtime");
    }

    const response = await fetch(ML_COMPARE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: String(productId) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let details = "";
      try {
        const maybeJson = await response.json();
        if (maybeJson && typeof maybeJson === "object") {
          details = String(maybeJson.error || maybeJson.message || "").trim();
        }
      } catch {
        try {
          details = String(await response.text()).trim();
        } catch {
          details = "";
        }
      }

      const suffix = details ? `: ${details}` : "";
      throw new Error(`ML service responded with status ${response.status}${suffix}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
};

const normalizeComparisonPayload = (payload, product) => {
  const prophetPrediction = payload?.prophetPrediction ?? payload?.prophet_prediction;
  const arimaPrediction = payload?.arimaPrediction ?? payload?.arima_prediction;
  const actualValues = payload?.actualValues ?? payload?.actual_values;

  return {
    productId: String(product?.id || product?._id || payload?.productId || ""),
    productName: product?.name || payload?.productName || "Unknown Product",
    category: product?.category || payload?.category || "Uncategorized",
    prophetPrediction: toArray(prophetPrediction),
    arimaPrediction: toArray(arimaPrediction),
    actualValues: toArray(actualValues),
    prophetRMSE: toNumber(payload?.prophetRMSE ?? payload?.prophet_rmse, 0),
    arimaRMSE: toNumber(payload?.arimaRMSE ?? payload?.arima_rmse, 0),
    prophetMAE: toNumber(payload?.prophetMAE ?? payload?.prophet_mae, 0),
    arimaMAE: toNumber(payload?.arimaMAE ?? payload?.arima_mae, 0),
    prophetMAPE: toNumber(payload?.prophetMAPE ?? payload?.prophet_mape, 0),
    arimaMAPE: toNumber(payload?.arimaMAPE ?? payload?.arima_mape, 0),
    betterModel: String(payload?.betterModel || payload?.better_model || "tie"),
  };
};

const buildUnifiedPrediction = ({ product, rulePrediction, mlPrediction, mlFailure = null }) => {
  const ruleValue = toNumber(rulePrediction?.predictedDemand, 0);
  const fallbackDecision = deriveRuleDecision(rulePrediction?.percentChange);
  const fallbackConfidence = normalizeConfidence(rulePrediction?.confidence, "Low");

  const mlValue = toNumber(mlPrediction?.forecast, ruleValue);
  const adjustedValue = toNumber(
    mlPrediction?.adjustedForecast ?? mlPrediction?.adjustedPrediction,
    ruleValue
  );

  const predictionSource = mlPrediction ? "ml" : "rule-based";
  const decision = normalizeDecision(mlPrediction?.decision || fallbackDecision);
  const impact = normalizeImpact(mlPrediction?.impact);
  const confidence = normalizeConfidence(mlPrediction?.confidence, fallbackConfidence);
  const newsSignal = {
    keyword: typeof mlPrediction?.keyword === "string" ? mlPrediction.keyword : null,
    score: toNumber(mlPrediction?.score, 0),
    sourceHeadline:
      typeof mlPrediction?.sourceHeadline === "string" ? mlPrediction.sourceHeadline : null,
    sourceHeadlines: Array.isArray(mlPrediction?.sourceHeadlines)
      ? mlPrediction.sourceHeadlines.filter((item) => typeof item === "string")
      : [],
    matchedKeywords: Array.isArray(mlPrediction?.matchedKeywords)
      ? mlPrediction.matchedKeywords.filter((item) => typeof item === "string")
      : [],
  };

  const explainability = buildExplainability({
    predictionSource,
    rulePrediction,
    decision,
    impact,
    confidence,
    newsSignal,
    mlFailure,
  });

  return {
    productId: buildProductRef(product),
    predictedDemand: ruleValue,
    avgSales: toNumber(rulePrediction?.avgSales, 0),
    percentChange: toNumber(rulePrediction?.percentChange, 0),
    seasonTag: String(rulePrediction?.seasonTag || "Normal"),
    rulePrediction: ruleValue,
    mlPrediction: mlValue,
    adjustedPrediction: adjustedValue,
    decision,
    impact,
    keyword: newsSignal.keyword,
    score: newsSignal.score,
    sourceHeadline: newsSignal.sourceHeadline,
    sourceHeadlines: newsSignal.sourceHeadlines,
    matchedKeywords: newsSignal.matchedKeywords,
    confidence,
    reason: explainability.reason,
    contributingFactors: explainability.contributingFactors,
    predictionSource,
    predictedAt: new Date(),
  };
};
const persistPrediction = async (productId, pgProductId, unifiedPrediction) => {
  const { rows } = await pool.query(`
    INSERT INTO predictions (product_id, predicted_demand, avg_sales, percent_change, confidence, season_tag, rule_prediction, ml_prediction, adjusted_prediction, decision, impact, keyword, score, source_headline, source_headlines, matched_keywords, reason, contributing_factors, prediction_source, predicted_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now())
    ON CONFLICT (product_id) DO UPDATE SET
      predicted_demand = EXCLUDED.predicted_demand,
      avg_sales = EXCLUDED.avg_sales,
      percent_change = EXCLUDED.percent_change,
      confidence = EXCLUDED.confidence,
      season_tag = EXCLUDED.season_tag,
      rule_prediction = EXCLUDED.rule_prediction,
      ml_prediction = EXCLUDED.ml_prediction,
      adjusted_prediction = EXCLUDED.adjusted_prediction,
      decision = EXCLUDED.decision,
      impact = EXCLUDED.impact,
      keyword = EXCLUDED.keyword,
      score = EXCLUDED.score,
      source_headline = EXCLUDED.source_headline,
      source_headlines = EXCLUDED.source_headlines,
      matched_keywords = EXCLUDED.matched_keywords,
      reason = EXCLUDED.reason,
      contributing_factors = EXCLUDED.contributing_factors,
      prediction_source = EXCLUDED.prediction_source,
      predicted_at = now()
    RETURNING id, product_id, predicted_demand, rule_prediction, ml_prediction, adjusted_prediction, avg_sales, percent_change, confidence, season_tag, decision, impact, keyword, score, source_headline, source_headlines, matched_keywords, reason, contributing_factors, prediction_source, predicted_at
  `, [
    pgProductId,
    unifiedPrediction.predictedDemand,
    unifiedPrediction.avgSales,
    unifiedPrediction.percentChange,
    unifiedPrediction.confidence,
    unifiedPrediction.seasonTag,
    unifiedPrediction.rulePrediction,
    unifiedPrediction.mlPrediction,
    unifiedPrediction.adjustedPrediction,
    unifiedPrediction.decision,
    unifiedPrediction.impact,
    unifiedPrediction.keyword,
    unifiedPrediction.score,
    unifiedPrediction.sourceHeadline,
    unifiedPrediction.sourceHeadlines,
    unifiedPrediction.matchedKeywords,
    unifiedPrediction.reason,
    unifiedPrediction.contributingFactors,
    unifiedPrediction.predictionSource,
  ]);

  const saved = mapPostgresPredictionToDocumentShape(rows[0]);

  // Auto-generate alerts based on prediction results
  await generateAlertForProduct(productId, saved);

  return mapPredictionDocToResponse(saved, unifiedPrediction.productId);
};

const generateAlertForProduct = async (productId, predictionDoc) => {
  const percentChange = toNumber(predictionDoc.percentChange, 0);
  const confidence = predictionDoc.confidence;
  const decision = predictionDoc.decision;
  const impact = predictionDoc.impact;

  // Only generate alerts for significant changes with reasonable confidence
  const significantChange = Math.abs(percentChange) >= 10;
  const meaningfulConfidence = confidence === "High" || confidence === "Medium";

  if (!significantChange && !meaningfulConfidence) {
    // Clear any existing alerts if the situation has normalized
    await deleteActiveAlertsForProduct(productId);
    return;
  }

  // Determine alert type and message
  let type, message, severity;

  if (percentChange > 15 && confidence === "High") {
    type = "HIGH_DEMAND";
    message = `High demand forecast: ${percentChange.toFixed(1)}% increase expected`;
    severity = "HIGH";
  } else if (percentChange < -15 && confidence === "High") {
    type = "LOW_DEMAND";
    message = `Low demand forecast: ${Math.abs(percentChange).toFixed(1)}% decrease expected`;
    severity = "HIGH";
  } else if (percentChange > 10 && meaningfulConfidence) {
    type = "HIGH_DEMAND";
    message = `Demand rising: ${percentChange.toFixed(1)}% increase expected (${decision})`;
    severity = "MEDIUM";
  } else if (percentChange < -10 && meaningfulConfidence) {
    type = "LOW_DEMAND";
    message = `Demand falling: ${Math.abs(percentChange).toFixed(1)}% decrease expected (${decision})`;
    severity = "MEDIUM";
  } else if (decision === "increase" && meaningfulConfidence) {
    type = "TREND_UP";
    message = `Demand trend increasing: ${decision} decision for ${percentChange.toFixed(1)}% change`;
    severity = "LOW";
  } else if (decision === "reduce" && meaningfulConfidence) {
    type = "TREND_DOWN";
    message = `Demand trend decreasing: ${decision} decision for ${Math.abs(percentChange).toFixed(1)}% change`;
    severity = "LOW";
  } else {
    // Clear alerts if no significant condition met
    await deleteActiveAlertsForProduct(productId);
    return;
  }

  // Upsert the alert (matching on productId + type)
  await upsertAlertByProductAndType(productId, {
    type,
      message,
      severity,
      percentChange,
      isActive: true,
  });
};

const getPredictionForProduct = async ({
  product,
  forceRefresh = false,
  preloadedPrediction = null,
  pgProductId,
}) => {
  const productId = String(product.id || product._id);
  const cacheKey = `product:${productId}`;

  if (!forceRefresh) {
    const cached = getCacheValue(cacheKey);
    if (cached) {
      if (!isRuleBasedPrediction(cached)) {
        logEvent("info", "Prediction cache hit", { productId });
        return cached;
      }

      logEvent("info", "Ignoring cached rule-based fallback; attempting ML refresh", {
        productId,
      });
      predictionCache.delete(cacheKey);
    }
  }

  if (!forceRefresh && preloadedPrediction && isFreshPrediction(preloadedPrediction.predictedAt)) {
    const mapped = mapPredictionDocToResponse(preloadedPrediction, product);
    if (!isRuleBasedPrediction(mapped)) {
      setCacheValue(cacheKey, mapped);
      logEvent("info", "Prediction cache hit", { productId });
      return mapped;
    }

    logEvent("info", "Ignoring DB rule-based fallback; attempting ML refresh", {
      productId,
    });
  }

  const rulePrediction = await generatePredictionForProduct(productId);

  let mlPrediction = null;
  let mlFailure = null;
  try {
    mlPrediction = await callMlPrediction(productId);
  } catch (mlError) {
    mlFailure = classifyMlFailure(mlError);
    logEvent("warn", "ML prediction failed, using rule-based fallback", {
      productId,
      error: mlError?.message || "unknown error",
      fallbackCause: mlFailure.type,
    });
  }

  const unified = buildUnifiedPrediction({
    product,
    rulePrediction,
    mlPrediction,
    mlFailure,
  });

  const savedPrediction = await persistPrediction(productId, pgProductId || productId, unified);
  setCacheValue(cacheKey, savedPrediction);
  invalidateAllPredictionsCache();

  logEvent("info", "Prediction generated and persisted", {
    productId,
    source: savedPrediction.predictionSource,
  });

  return savedPrediction;
};

export const predictByProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const forceRefresh = isTruthy(req.query.refresh);

    if (!isProductReference(productId)) {
      return sendError(res, 400, "Invalid productId");
    }

    const postgresProduct = await resolveProduct(productId);
    if (!postgresProduct) {
      return sendError(res, 404, "Product not found");
    }

    const predictionFromPg = await getPredictionByProductId(postgresProduct.id);

    if (predictionFromPg) {
      const prediction = mapPredictionDocToResponse(predictionFromPg, postgresProduct);
      return sendSuccess(res, 200, prediction, {
        cached: !forceRefresh,
        cacheTtlMs: PREDICTION_CACHE_TTL_MS,
      });
    }

    const prediction = await getPredictionForProduct({
      product: postgresProduct,
      forceRefresh,
      preloadedPrediction: null,
      pgProductId: postgresProduct.id,
    });

    return sendSuccess(res, 200, prediction, {
      cached: false,
      cacheTtlMs: PREDICTION_CACHE_TTL_MS,
    });
  } catch (error) {
    logEvent("error", "Failed to generate prediction for product", {
      productId: req.params?.productId,
      error: error.message,
    });

    return sendError(res, 500, "Failed to generate prediction for product", error.message);
  }
};

export const predictAllProducts = async (req, res) => {
  try {
    const forceRefresh = isTruthy(req.query.refresh);
    const products = await getAllProducts();

    if (!products.length) {
      return sendSuccess(
        res,
        200,
        {
          processed: 0,
          saved: 0,
          failed: 0,
          predictions: [],
        },
        { cacheTtlMs: PREDICTION_CACHE_TTL_MS }
      );
    }

    const settled = await settleWithConcurrency(
      products,
      async (product) => {
        const predictionFromPg = await getPredictionByProductId(product.id);

        if (predictionFromPg) {
          return mapPredictionDocToResponse(predictionFromPg, product);
        }

        return getPredictionForProduct({
          product,
          forceRefresh,
          preloadedPrediction: null,
          pgProductId: product.id,
        });
      },
      ML_PREDICTION_CONCURRENCY,
    );

    const predictions = settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    const failed = settled
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason?.message || "Unknown error");

    return sendSuccess(
      res,
      200,
      {
        processed: products.length,
        saved: predictions.length,
        failed: failed.length,
        predictions,
        errors: failed,
      },
      {
        forceRefresh,
        cacheTtlMs: PREDICTION_CACHE_TTL_MS,
      }
    );
  } catch (error) {
    logEvent("error", "Failed to run bulk predictions", {
      error: error.message,
    });

    return sendError(res, 500, "Failed to run bulk predictions", error.message);
  }
};

export const getUnifiedPredictions = async (req, res) => {
  try {
    const forceRefresh = isTruthy(req.query.refresh);

    if (!forceRefresh) {
      const allCached = getCacheValue(ALL_PREDICTIONS_CACHE_KEY);
      if (allCached) {
        logEvent("info", "Unified predictions cache hit", { count: allCached.length });
        return sendSuccess(
          res,
          200,
          allCached,
          {
            cached: true,
            count: allCached.length,
            cacheTtlMs: PREDICTION_CACHE_TTL_MS,
          }
        );
      }
    }

    const products = await getAllProducts();

    if (!Array.isArray(products) || products.length === 0) {
      return sendSuccess(res, 200, [], {
        cached: false,
        count: 0,
        cacheTtlMs: PREDICTION_CACHE_TTL_MS,
      });
    }

    const settled = await settleWithConcurrency(
      products,
      async (product) => {
        const predictionFromPg = await getPredictionByProductId(product.id);

        if (predictionFromPg) {
          return mapPredictionDocToResponse(predictionFromPg, product);
        }

        return getPredictionForProduct({
          product,
          forceRefresh,
          preloadedPrediction: null,
          pgProductId: product.id,
        });
      },
      ML_PREDICTION_CONCURRENCY,
    );

    const unifiedPredictions = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    const failed = settled
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || "Unknown error");

    setCacheValue(ALL_PREDICTIONS_CACHE_KEY, unifiedPredictions);

    return sendSuccess(res, 200, unifiedPredictions, {
      cached: false,
      count: unifiedPredictions.length,
      failed: failed.length,
      errors: failed,
      cacheTtlMs: PREDICTION_CACHE_TTL_MS,
    });
  } catch (error) {
    logEvent("error", "Failed to fetch unified predictions", {
      error: error?.message || "Unknown error",
    });

    return sendError(res, 500, "Failed to fetch unified predictions", error.message);
  }
};

export const comparePredictions = async (req, res) => {
  try {
    const products = await getAllProducts();

    if (!products.length) {
      return res.status(200).json([]);
    }

    const settled = await settleWithConcurrency(
      products,
      async (product) => {
        const comparison = await callMlComparison(product.id);
        return normalizeComparisonPayload(comparison, product);
      },
      ML_COMPARE_CONCURRENCY,
    );

    const comparisons = settled
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    const failed = settled
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || "Unknown error");

    if (failed.length) {
      logEvent("warn", "Some model comparisons failed", {
        failed: failed.length,
        errors: failed.slice(0, 5),
      });
    }

    if (comparisons.length === 0 && failed.length) {
      return res.status(502).json({
        message: "All model comparisons failed",
        error: failed[0],
        errors: failed.slice(0, 5),
      });
    }

    return res.status(200).json(comparisons);
  } catch (error) {
    logEvent("error", "Failed to compare predictions", {
      error: error?.message || "Unknown error",
    });

    return res.status(500).json({
      message: "Failed to compare predictions",
      error: error.message,
    });
  }
};

export { settleWithConcurrency };
