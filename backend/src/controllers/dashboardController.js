import Product from "../models/Product.js";
import Sales from "../models/Sales.js";
import Alert from "../models/Alert.js";
import { roundTo } from "../helpers/analytics.js";

const getLastSixMonthWindow = () => {
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const monthKeys = [];
  for (let i = 0; i < 6; i += 1) {
    const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthKeys.push(key);
  }

  return { startDate, monthKeys };
};

const computeTrend = (salesDocs, recentDays = 30) => {
  if (!salesDocs || salesDocs.length === 0) {
    return { recentSales: 0, previousSales: 0, percentChange: 0, trendDirection: "stable" };
  }

  // Get recent period sales (last recentDays days)
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - recentDays);

  const recentSales = salesDocs
    .filter((s) => new Date(s.date) <= now && new Date(s.date) > cutoffDate)
    .reduce((sum, s) => sum + (s.quantity || 0), 0);

  // Previous period: same length before recent period
  const prevEndDate = new Date(cutoffDate);
  const prevStartDate = new Date(cutoffDate);
  prevStartDate.setDate(prevStartDate.getDate() - recentDays);

  const previousSales = salesDocs
    .filter((s) => new Date(s.date) <= prevEndDate && new Date(s.date) > prevStartDate)
    .reduce((sum, s) => sum + (s.quantity || 0), 0);

  let percentChange = 0;
  let trendDirection = "stable";

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

  return { recentSales, previousSales, percentChange, trendDirection };
};

export const getSummary = async (req, res) => {
  try {
    const [totalProducts, activeAlerts, salesDocs] = await Promise.all([
      Product.countDocuments(),
      Alert.countDocuments(),
      Sales.find({}).sort({ date: 1 }).lean(),
    ]);

    const totalSalesVolume = salesDocs.reduce((sum, s) => sum + (s.quantity || 0), 0);
    const avgDailySales = totalSalesVolume / 30 || 0;
    const avgMonthlySales = totalSalesVolume / 30 || 0;

    const trend = computeTrend(salesDocs);

    // Group sales by product for top products calculation
    const productSalesMap = new Map();
    for (const sale of salesDocs) {
      const key = sale.productId;
      if (!productSalesMap.has(key)) {
        productSalesMap.set(key, { productId: key, totalQty: 0, sales: [] });
      }
      productSalesMap.get(key).totalQty += sale.quantity || 0;
      productSalesMap.get(key).sales.push(sale);
    }

    // Compute trend for each product and sort
    const productTrends = [];
    for (const [, data] of productSalesMap) {
      const t = computeTrend(data.sales);
      productTrends.push({
        productId: data.productId,
        totalQty: data.totalQty,
        recentSales: t.recentSales,
        previousSales: t.previousSales,
        percentChange: t.percentChange,
        trendDirection: t.trendDirection,
      });
    }

    // Sort by percentChange descending for "increasing" and ascending for "decreasing"
    const topIncreasing = productTrends
      .filter((p) => p.trendDirection === "increasing")
      .sort((a, b) => b.percentChange - a.percentChange)
      .slice(0, 3);

    const topDecreasing = productTrends
      .filter((p) => p.trendDirection === "decreasing")
      .sort((a, b) => a.percentChange - b.percentChange)
      .slice(0, 3);

    // Fallback: if not enough products with increasing/decreasing trend,
    // use top 3 by total sales volume
    if (topIncreasing.length < 3) {
      const allSorted = productTrends
        .sort((a, b) => b.totalQty - a.totalQty)
        .slice(0, 3 - topIncreasing.length);
      topIncreasing.push(...allSorted.filter((p) => p.trendDirection !== "decreasing"));
    }
    if (topDecreasing.length < 3) {
      const allSorted = productTrends
        .sort((a, b) => b.totalQty - a.totalQty)
        .slice(0, 3 - topDecreasing.length);
      topDecreasing.push(...allSorted.filter((p) => p.trendDirection !== "increasing"));
    }

    const topIncreasingProducts = topIncreasing.map((r) => {
      const product = await Product.findById(r.productId).lean();
      return {
        name: product ? product.name : "Unknown Product",
        quantity: r.totalQty,
        percentChange: r.percentChange,
        trendDirection: r.trendDirection,
      };
    });

    const topDecreasingProducts = topDecreasing.map((r) => {
      const product = await Product.findById(r.productId).lean();
      return {
        name: product ? product.name : "Unknown Product",
        quantity: r.totalQty,
        percentChange: r.percentChange,
        trendDirection: r.trendDirection,
      };
    });

    return res.status(200).json({
      totalProducts,
      avgMonthlySales: totalProducts ? roundTo(totalSalesVolume / Math.max(totalProducts, 1)) : 0,
      avgDailySales: roundTo(avgDailySales),
      totalSalesVolume,
      activeAlerts,
      topIncreasingProducts,
      topDecreasingProducts,
      recommendationsReady: totalProducts,
      trendSummary: {
        recentSales: trend.recentSales,
        previousSales: trend.previousSales,
        percentChange: trend.percentChange,
        trendDirection: trend.trendDirection,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch dashboard summary",
      error: error.message,
    });
  }
};

export const getTrends = async (req, res) => {
  try {
    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

    const sixMonthKeys = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    });

    const buildPipeline = (withDateFilter) => {
      const pipeline = [];

      if (withDateFilter) {
        pipeline.push({
          $match: { date: { $gte: startDate } },
        });
      }

      pipeline.push(
        {
          $group: {
            _id: {
              productId: "$productId",
              year: { $year: "$date" },
              month: { $month: "$date" },
            },
            monthlyQty: { $sum: "$quantity" },
          },
        },
        {
          $addFields: {
            sortDate: {
              $dateFromParts: {
                year: "$_id.year",
                month: "$_id.month",
                day: 1,
              },
            },
            monthKey: {
              $concat: [
                { $toString: "$_id.year" },
                "-",
                {
                  $cond: [
                    { $lt: ["$_id.month", 10] },
                    { $concat: ["0", { $toString: "$_id.month" }] },
                    { $toString: "$_id.month" },
                  ],
                },
              ],
            },
          },
        },
        { $sort: { sortDate: 1 } },
        {
          $group: {
            _id: "$_id.productId",
            totalSales: { $sum: "$monthlyQty" },
            points: {
              $push: {
                month: "$monthKey",
                quantity: "$monthlyQty",
                sortDate: "$sortDate",
              },
            },
          },
        },
        { $sort: { totalSales: -1 } },
        { $limit: 3 },
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: "$product" },
        {
          $project: {
            _id: 0,
            product: "$product.name",
            totalSales: 1,
            points: 1,
          },
        }
      );

      return pipeline;
    };

    // First try strict last-6-months data.
    let rows = await Sales.aggregate(buildPipeline(true));

    // If no rows found, fallback to all-time data (still top 3, sorted by date).
    let usedFallback = false;
    if (!rows.length) {
      rows = await Sales.aggregate(buildPipeline(false));
      usedFallback = true;
    }

    const response = rows.map((row) => {
      if (!usedFallback) {
        const pointMap = new Map(row.points.map((p) => [p.month, p.quantity]));
        return {
          product: row.product,
          data: sixMonthKeys.map((k) => pointMap.get(k) || 0),
        };
      }

      // Fallback mode: no date filter, return latest 6 month points per product.
      const lastSix = row.points.slice(-6).map((p) => p.quantity);
      return {
        product: row.product,
        data: lastSix,
      };
    });

    // Demand trend summary
    const demandTrendSummary = await Sales.aggregate([
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: "$quantity" },
          recordCount: { $sum: 1 },
        },
      },
    ]);

    const trendData = demandTrendSummary.length > 0 ? {
      totalSales: demandTrendSummary[0].totalQuantity,
      totalRecords: demandTrendSummary[0].recordCount,
      averageMonthly: demandTrendSummary[0].totalQuantity / Math.max(demandTrendSummary[0].recordCount / 12, 1),
    } : { totalSales: 0, totalRecords: 0, averageMonthly: 0 };

    return res.status(200).json({
      trends: response,
      demandTrendSummary: trendData,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch trends",
      error: error.message,
    });
  }
};

export const getDistribution = async (req, res) => {
  try {
    return res.status(200).json({
      increase: 0,
      maintain: 0,
      reduce: 0,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch distribution",
      error: error.message,
    });
  }
};

export const getProductAnalysis = async (req, res) => {
  try {
    const [products, salesAgg] = await Promise.all([
      Product.find().lean(),
      Sales.aggregate([
        {
          $group: {
            _id: {
              productId: "$productId",
              year: { $year: "$date" },
              month: { $month: "$date" },
            },
            totalQuantity: { $sum: "$quantity" },
          },
        },
        { $sort: { "_id.productId": 1, "_id.year": -1, "_id.month": -1 } },
        {
          $group: {
            _id: "$_id.productId",
            periods: {
              $push: {
                year: "$_id.year",
                month: "$_id.month",
                totalQuantity: "$totalQuantity",
              },
            },
            avgSales: { $avg: "$totalQuantity" },
          },
        },
      ]),
    ]);

    const salesMap = new Map(salesAgg.map((item) => [String(item._id), item]));

    const analysis = products.map((product) => {
      const salesData = salesMap.get(String(product._id));
      const periods = salesData?.periods || [];
      const current = periods[0]?.totalQuantity || 0;
      const previous = periods[1]?.totalQuantity || 0;

      return {
        productId: product._id,
        name: product.name,
        category: product.category,
        avgSales: salesData ? roundTo(salesData.avgSales) : 0,
        percentChange: roundTo(calculatePercentChange(current, previous)),
      };
    });

    return res.status(200).json(analysis);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch product analysis",
      error: error.message,
    });
  }
};