import { roundTo, calculatePercentChange } from "../helpers/analytics.js";
import {
  getActiveAlertsByProductId,
  getPredictionByProductId,
  getSalesByProductId,
  isProductReference,
  resolveProduct,
} from "../config/postgres.js";

const RECENT_DAYS = 30;

const getProductIntelligence = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!isProductReference(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const product = await resolveProduct(productId);

    if (!product || product.legacy_mongo_id === 'test123') {
      return res.status(404).json({ message: "Product not found" });
    }

    const salesDocs = await getSalesByProductId(product.id);

    // Calculate historical demand data
    let historicalSales = [];
    let avgSales = 0;
    let recentSales = 0;
    let previousSales = 0;
    let percentChange = 0;
    let trendDirection = "stable";

    if (salesDocs.length > 0) {
      // Sort sales by date (ascending)
      const sortedSales = [...salesDocs].sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date));

      // Group sales by month (UTC)
      const monthMap = new Map();
      for (const row of sortedSales) {
        const date = new Date(row.sale_date);
        const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
        monthMap.set(key, (monthMap.get(key) || 0) + (row.quantity || 0));
      }

      const monthlyTotals = Array.from(monthMap.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([, total]) => total);

      if (monthlyTotals.length > 0) {
        avgSales = monthlyTotals.reduce((sum, total) => sum + total, 0) / monthlyTotals.length;
      }

      // Calculate trend: recent period (last 30 days) vs previous comparable period
      const now = new Date();
      const recentPeriodDays = RECENT_DAYS; // last 30 days

      const recentQty = sortedSales
        .filter((s) => {
          const saleDate = new Date(s.sale_date);
          const diffDays = (now - saleDate) / (1000 * 60 * 60 * 24);
          return diffDays >= 0 && diffDays < RECENT_DAYS;
        })
        .reduce((sum, s) => sum + (s.quantity || 0), 0);

      // Previous period: same length before recent period
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - RECENT_DAYS);
      const prevEndDate = new Date(cutoffDate);
      prevEndDate.setDate(prevEndDate.getDate() - RECENT_DAYS);
      const prevStartDate = new Date(cutoffDate);
      prevStartDate.setDate(prevStartDate.getDate() - RECENT_DAYS);

      const prevQty = sortedSales
        .filter((s) => {
          const saleDate = new Date(s.sale_date);
          return saleDate >= prevStartDate && saleDate < prevEndDate;
        })
        .reduce((sum, s) => sum + (s.quantity || 0), 0);

      recentSales = recentQty;
      previousSales = prevQty;

      if (previousSales > 0) {
        percentChange = calculatePercentChange(recentSales, previousSales);
        trendDirection = percentChange > 0 ? "increasing" : percentChange < 0 ? "decreasing" : "stable";
      } else if (recentSales > 0 && previousSales === 0) {
        percentChange = 100;
        trendDirection = "increasing";
      } else {
        percentChange = 0;
        trendDirection = "stable";
      }

      // Build historicalSales array from sales docs
      historicalSales = sortedSales.map((s) => ({
        date: s.sale_date,
        quantity: s.quantity,
      }));
    }

    // Get the latest prediction from PostgreSQL
    const predictionDoc = await getPredictionByProductId(product.id);

    let forecast = {
      predictedDemand: 0,
      rulePrediction: 0,
      mlPrediction: 0,
      adjustedPrediction: 0,
      confidence: "Low",
      predictionSource: "rule-based",
      seasonTag: "Normal",
      decision: "maintain",
      impact: "neutral",
      percentChange: 0,
      reason: "No prediction available",
      contributingFactors: [],
    };

    if (predictionDoc) {
      forecast = {
        predictedDemand: predictionDoc.predicted_demand,
        rulePrediction: predictionDoc.rule_prediction,
        mlPrediction: predictionDoc.ml_prediction,
        adjustedPrediction: predictionDoc.adjusted_prediction,
        confidence: predictionDoc.confidence,
        predictionSource: predictionDoc.prediction_source,
        seasonTag: predictionDoc.season_tag,
        decision: predictionDoc.decision,
        impact: predictionDoc.impact,
        percentChange: predictionDoc.percent_change,
        reason: predictionDoc.reason,
        contributingFactors: predictionDoc.contributing_factors,
      };
    }

    // Get active alerts for this product from PostgreSQL
    const activeAlerts = await getActiveAlertsByProductId(product.id);

    // Build response
    const intelligence = {
      product: {
        id: product.id,
        name: product.name,
        category: product.category,
      },
      historicalSales: historicalSales,
      summary: {
        avgSales: avgSales ? roundTo(avgSales) : 0,
        recentSales,
        previousSales,
        percentChange: roundTo(percentChange),
        trendDirection,
      },
      forecast,
      alerts: activeAlerts.map((a) => ({
        type: a.type,
        message: a.message,
        severity: a.severity,
        percentChange: a.percent_change,
      })),
    };

    return res.status(200).json(intelligence);
  } catch (error) {
    console.error("Product intelligence fetch error:", error.message);
    return res.status(500).json({
      message: "Failed to fetch product intelligence",
      error: error.message,
    });
  }
};

export { getProductIntelligence };
