import { isProductReference, resolveProduct } from "../config/postgres.js";
import {
  createMlServiceError,
  getMlAnalystConfig,
  requestMlService,
} from "../services/mlAnalystClient.js";
import { getRequestContext } from "../services/requestContext.js";
import { sendBackendError } from "../helpers/errorResponse.js";

const ML_NEWS_INSIGHTS_URL =
  process.env.ML_NEWS_INSIGHTS_URL || "http://localhost:5002/news-insights";
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS || 10000);
const NEWS_CACHE_TTL_MS = Number(process.env.NEWS_CACHE_TTL_MS || 5 * 60 * 1000);

const newsCache = new Map();

const normalizeImpact = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "increase" || normalized === "decrease" || normalized === "neutral") {
    return normalized;
  }
  return "neutral";
};

const buildSuggestion = (impact, keyword) => {
  const detectedKeyword = String(keyword || "").trim();

  if (impact === "increase") {
    return detectedKeyword
      ? `Increase stock due to ${detectedKeyword} trends`
      : "Increase stock";
  }

  if (impact === "decrease") {
    return detectedKeyword
      ? `Reduce stock due to ${detectedKeyword} trends`
      : "Reduce stock";
  }

  return "Maintain stock";
};

const getCacheValue = (key) => {
  const cached = newsCache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() >= cached.expiresAt) {
    newsCache.delete(key);
    return null;
  }

  return cached.value;
};

const setCacheValue = (key, value) => {
  newsCache.set(key, {
    value,
    expiresAt: Date.now() + NEWS_CACHE_TTL_MS,
  });
};

const callMlNewsInsights = async (productName) => {
  const context = getRequestContext();
  const config = getMlAnalystConfig();
  const response = await requestMlService({
    url: ML_NEWS_INSIGHTS_URL,
    timeoutMs: ML_TIMEOUT_MS,
    internalToken: config.internalToken,
    body: { productName },
    userId: context.userId,
    tenantId: context.tenantId,
    correlationId: context.correlationId,
  });
  if (!response.ok) {
    throw createMlServiceError(response.status);
  }

    const payload = response.payload;
    const headlines = Array.isArray(payload?.headlines)
      ? payload.headlines.filter((item) => typeof item === "string").slice(0, 5)
      : [];
    const matchedKeywords = Array.isArray(payload?.keywords)
      ? payload.keywords.filter((item) => typeof item === "string")
      : Array.isArray(payload?.matchedKeywords)
        ? payload.matchedKeywords.filter((item) => typeof item === "string")
        : [];
    const sourceHeadlines = Array.isArray(payload?.sourceHeadlines)
      ? payload.sourceHeadlines.filter((item) => typeof item === "string").slice(0, 5)
      : headlines;

    const impact = normalizeImpact(payload?.impact);
    const keyword = typeof payload?.keyword === "string" ? payload.keyword : null;
    const score = Number.isFinite(Number(payload?.score)) ? Number(payload.score) : 0;

    return {
      headlines,
      impact,
      keyword,
      score,
      matchedKeywords,
      sourceHeadlines,
    };
};

export const getProductNewsInsights = async (req, res) => {
  try {
    const { internalToken } = getMlAnalystConfig();
    if (!internalToken) {
      return res.status(503).json({ message: "ML service authorization is not configured" });
    }

    const { productId } = req.params;

    if (!isProductReference(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const tenantId = req.authContext.tenantId;
    const product = await resolveProduct(tenantId, productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const cacheKey = `${tenantId}:${productId}`;
    const cached = getCacheValue(cacheKey);
    if (cached) {
      return res.status(200).json({
        ...cached,
        cached: true,
      });
    }

    let newsInsights = {
      headlines: [],
      impact: "neutral",
      keyword: null,
      score: 0,
      matchedKeywords: [],
      sourceHeadlines: [],
    };

    try {
      newsInsights = await callMlNewsInsights(product.name);
    } catch (newsError) {
      if (
        newsError?.code === "MISSING_INTERNAL_TOKEN"
        || (newsError?.code === "ML_SERVICE_REJECTED" && [401, 403].includes(newsError.status))
      ) {
        throw newsError;
      }
      console.warn("[news]", JSON.stringify({
        level: "warn",
        event: "ml_news_insights_failed",
        correlationId: req.correlationId,
        errorType: newsError?.status ? "upstream_rejected" : "unavailable",
      }));
    }

    const responsePayload = {
      product: {
        name: product.name,
        category: product.category,
      },
      headlines: newsInsights.headlines,
      impact: newsInsights.impact,
      keyword: newsInsights.keyword,
      suggestion: buildSuggestion(newsInsights.impact, newsInsights.keyword),
      score: newsInsights.score,
      matchedKeywords: newsInsights.matchedKeywords,
      sourceHeadlines: newsInsights.sourceHeadlines,
      cached: false,
    };

    setCacheValue(cacheKey, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("[news]", JSON.stringify({
      level: "error",
      event: "request_failed",
      correlationId: req.correlationId,
      errorType: error?.name || "unknown",
    }));
    return sendBackendError(res, "Failed to fetch news insights", error);
  }
};
