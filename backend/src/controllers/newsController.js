import mongoose from "mongoose";
import Product from "../models/Product.js";

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

  try {
    if (typeof fetch !== "function") {
      throw new Error("Global fetch is not available in this Node runtime");
    }

    const response = await fetch(ML_NEWS_INSIGHTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ML service responded with status ${response.status}`);
    }

    const payload = await response.json();
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
  } finally {
    clearTimeout(timeoutId);
  }
};

export const getProductNewsInsights = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const product = await Product.findById(productId, "name category").lean();
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const cached = getCacheValue(productId);
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
      console.warn("[news] Failed to fetch ML news insights, using neutral fallback:", newsError?.message || newsError);
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

    setCacheValue(productId, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch news insights",
      error: error.message,
    });
  }
};
