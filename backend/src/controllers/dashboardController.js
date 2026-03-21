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

export const getSummary = async (req, res) => {
  try {
    const [totalProducts, activeAlerts, avgAgg] = await Promise.all([
      Product.countDocuments(),
      Alert.countDocuments(),
      Sales.aggregate([
        {
          $group: {
            _id: null,
            avgMonthlySales: { $avg: "$quantity" },
          },
        },
      ]),
    ]);

    return res.status(200).json({
      totalProducts,
      avgMonthlySales: avgAgg.length ? roundTo(avgAgg[0].avgMonthlySales) : 0,
      activeAlerts,
      recommendationsReady: 0,
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

    return res.status(200).json(response);
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