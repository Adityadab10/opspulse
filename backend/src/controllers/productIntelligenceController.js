import mongoose from "mongoose";
import Product from "../models/Product.js";
import Sales from "../models/Sales.js";
import Prediction from "../models/Prediction.js";
import Alert from "../models/Alert.js";
import { roundTo, calculatePercentChange } from "../helpers/analytics.js";

const RECENT_DAYS = 30;

const getMonthKey = (date) => {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const getProductIntelligence = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    const productExists = await Product.exists({ _id: productId });
    if (!productExists) {
      return res.status(404).json({ message: "Product not found" });
    }

    const product = await Product.findById(productId).lean();

    // Get all sales records for this product, sorted by date
    const salesDocs = await Sales.find({ productId })
      .sort({ date: 1 })
      .lean();

    // Calculate historical demand data
    let historicalSales = [];
    let avgSales = 0;
    let recentSales = 0;
    let previousSales = 0;
    let percentChange = 0;
    let trendDirection = "stable";

    if (salesDocs.length > 0) {
      // Group sales by month
      const monthMap = new Map();
      for (const row of salesDocs) {
        const key = getMonthKey(row.date);
        monthMap.set(key, (monthMap.get(key) || 0) + (row.quantity || 0));
      }

      const monthlyTotals = Array.from(monthMap.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([, total]) => total);

      avgSales = monthlyTotals.reduce((sum, total) => sum + total, 0) / monthlyTotals.length || 0;

      // Calculate trend: recent period vs previous comparable period
      const recentPeriod = RECENT_DAYS; // last 30 days
      const recentQty = salesDocs
        .filter((s) => {
          const saleDate = new Date(s.date);
          const diffDays = (new Date() - saleDate) / (1000 * 60 * 60 * 24);
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

      const prevQty = salesDocs
        .filter((s) => {
          const saleDate = new Date(s.date);
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
    }

    // Get the latest prediction
    const predictionDoc = await Prediction.findOne({ productId })
      .sort({ predictedAt: -1 })
      .lean();

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
        predictedDemand: predictionDoc.predictedDemand,
        rulePrediction: predictionDoc.rulePrediction,
        mlPrediction: predictionDoc.mlPrediction,
        adjustedPrediction: predictionDoc.adjustedPrediction,
        confidence: predictionDoc.confidence,
        predictionSource: predictionDoc.predictionSource,
        seasonTag: predictionDoc.seasonTag,
        decision: predictionDoc.decision,
        impact: predictionDoc.impact,
        percentChange: predictionDoc.percentChange,
        reason: predictionDoc.reason,
        contributingFactors: predictionDoc.contributingFactors,
      };
    }

    // Get active alerts for this product
    const activeAlerts = await Alert.find({ productId, isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    // Build response
    const intelligence = {
      product: {
        id: product._id,
        name: product.name,
        category: product.category,
      },
      historicalSales: salesDocs.map((s) => ({
        date: s.date,
        quantity: s.quantity,
      })),
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
        percentChange: a.percentChange,
      })),
    };

    return res.status(200).json(intelligence);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch product intelligence",
      error: error.message,
    });
  }
};

export { getProductIntelligence };