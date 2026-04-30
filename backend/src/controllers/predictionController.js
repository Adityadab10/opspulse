import mongoose from "mongoose";
import Product from "../models/Product.js";
import Prediction from "../models/Prediction.js";
import { generatePredictionForProduct } from "../services/predictionService.js";

const ML_PREDICT_URL = process.env.ML_PREDICT_URL || "http://localhost:5002/predict";
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS || 10000);
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

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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
      ? product._id || product.id || product.productId || fallbackProductId
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

  const productRef =
    predictionDoc.productId && typeof predictionDoc.productId === "object"
      ? buildProductRef(predictionDoc.productId)
      : buildProductRef(fallbackProduct, predictionDoc.productId);

  return {
    productId: productRef,
    predictedDemand: toNumber(predictionDoc.predictedDemand, 0),
    avgSales: toNumber(predictionDoc.avgSales, 0),
    percentChange: toNumber(predictionDoc.percentChange, 0),
    seasonTag: String(predictionDoc.seasonTag || "Normal"),
    rulePrediction: toNumber(predictionDoc.rulePrediction, toNumber(predictionDoc.predictedDemand, 0)),
    mlPrediction: toNumber(predictionDoc.mlPrediction, toNumber(predictionDoc.predictedDemand, 0)),
    adjustedPrediction: toNumber(
      predictionDoc.adjustedPrediction,
      toNumber(predictionDoc.predictedDemand, 0)
    ),
    decision: normalizeDecision(predictionDoc.decision),
    impact: normalizeImpact(predictionDoc.impact),
    keyword: predictionDoc.keyword || null,
    score: toNumber(predictionDoc.score, 0),
    sourceHeadline: predictionDoc.sourceHeadline || null,
    sourceHeadlines: Array.isArray(predictionDoc.sourceHeadlines) ? predictionDoc.sourceHeadlines : [],
    matchedKeywords: Array.isArray(predictionDoc.matchedKeywords) ? predictionDoc.matchedKeywords : [],
    confidence: normalizeConfidence(predictionDoc.confidence, "Low"),
    reason: String(predictionDoc.reason || "No explanation available"),
    contributingFactors: Array.isArray(predictionDoc.contributingFactors)
      ? predictionDoc.contributingFactors
      : [],
    predictionSource:
      predictionDoc.predictionSource === "ml" ? "ml" : "rule-based",
    predictedAt: predictionDoc.predictedAt || predictionDoc.updatedAt || new Date(),
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

const persistPrediction = async (productId, unifiedPrediction) => {
  const updatePayload = {
    productId,
    predictedDemand: unifiedPrediction.predictedDemand,
    avgSales: unifiedPrediction.avgSales,
    percentChange: unifiedPrediction.percentChange,
    confidence: unifiedPrediction.confidence,
    seasonTag: unifiedPrediction.seasonTag,
    rulePrediction: unifiedPrediction.rulePrediction,
    mlPrediction: unifiedPrediction.mlPrediction,
    adjustedPrediction: unifiedPrediction.adjustedPrediction,
    decision: unifiedPrediction.decision,
    impact: unifiedPrediction.impact,
    keyword: unifiedPrediction.keyword,
    score: unifiedPrediction.score,
    sourceHeadline: unifiedPrediction.sourceHeadline,
    sourceHeadlines: unifiedPrediction.sourceHeadlines,
    matchedKeywords: unifiedPrediction.matchedKeywords,
    reason: unifiedPrediction.reason,
    contributingFactors: unifiedPrediction.contributingFactors,
    predictionSource: unifiedPrediction.predictionSource,
    predictedAt: new Date(),
  };

  const saved = await Prediction.findOneAndUpdate(
    { productId },
    { $set: updatePayload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).populate("productId", "name category");

  return mapPredictionDocToResponse(saved);
};

const getPredictionForProduct = async ({
  product,
  forceRefresh = false,
  preloadedPrediction = null,
}) => {
  const productId = String(product._id);
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

  const savedPrediction = await persistPrediction(productId, unified);
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

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return sendError(res, 400, "Invalid productId");
    }

    const product = await Product.findById(productId).lean();
    if (!product) {
      return sendError(res, 404, "Product not found");
    }

    const existingPrediction = await Prediction.findOne({ productId }).populate(
      "productId",
      "name category"
    );

    const prediction = await getPredictionForProduct({
      product,
      forceRefresh,
      preloadedPrediction: existingPrediction,
    });

    return sendSuccess(res, 200, prediction, {
      cached: !forceRefresh,
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
    const products = await Product.find({}, "_id name category").lean();

    if (!products.length) {
      return sendSuccess(
        res,
        200,
        {
          processed: 0,
          saved: 0,
          failed: 0,
          predictions: [],
          errors: [],
        },
        { cacheTtlMs: PREDICTION_CACHE_TTL_MS }
      );
    }

    const productIds = products.map((product) => product._id);
    const existingPredictions = await Prediction.find({ productId: { $in: productIds } }).populate(
      "productId",
      "name category"
    );
    const existingByProductId = new Map(
      existingPredictions.map((doc) => [String(doc.productId?._id || doc.productId), doc])
    );

    const settled = await Promise.allSettled(
      products.map(async (product) => {
        return getPredictionForProduct({
          product,
          forceRefresh,
          preloadedPrediction: existingByProductId.get(String(product._id)),
        });
      })
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

    const products = await Product.find({}, "_id name category").lean();

    if (!Array.isArray(products) || products.length === 0) {
      return sendSuccess(res, 200, [], {
        cached: false,
        count: 0,
        cacheTtlMs: PREDICTION_CACHE_TTL_MS,
      });
    }

    const productIds = products.map((product) => product._id);
    const existingPredictions = await Prediction.find({ productId: { $in: productIds } }).populate(
      "productId",
      "name category"
    );
    const existingByProductId = new Map(
      existingPredictions.map((doc) => [String(doc.productId?._id || doc.productId), doc])
    );

    const settled = await Promise.allSettled(
      products.map(async (product) => {
        return getPredictionForProduct({
          product,
          forceRefresh,
          preloadedPrediction: existingByProductId.get(String(product._id)),
        });
      })
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
