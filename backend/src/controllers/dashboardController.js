import Product from "../models/Product.js";
import Sales from "../models/Sales.js";
import Alert from "../models/Alert.js";
import {
  calculatePercentChange,
  getSixMonthStartDate,
  roundTo,
} from "../helpers/analytics.js";

export const getSummary = async (req, res) => {
  try {
    const [totalProducts, activeAlerts, monthlyAvgAgg] = await Promise.all([
      Product.countDocuments(),
      Alert.countDocuments(),
      Sales.aggregate([
        {
          $group: {
            _id: {
              year: { $year: "$date" },
              month: { $month: "$date" },
            },
            monthlyTotal: { $sum: "$quantity" },
          },
        },
        {
          $group: {
            _id: null,
            avgMonthlySales: { $avg: "$monthlyTotal" },
          },
        },
      ]),
    ]);

    const avgMonthlySales = monthlyAvgAgg.length
      ? roundTo(monthlyAvgAgg[0].avgMonthlySales)
      : 0;

    return res.status(200).json({
      totalProducts,
      avgMonthlySales,
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
    const startDate = getSixMonthStartDate();

    const trends = await Sales.aggregate([
      { $match: { date: { $gte: startDate } } },
      {
        $group: {
          _id: {
            productId: "$productId",
            year: { $year: "$date" },
            month: { $month: "$date" },
          },
          totalSales: { $sum: "$quantity" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
      {
        $group: {
          _id: "$_id.productId",
          totalSales: { $sum: "$totalSales" },
          monthlySales: {
            $push: {
              year: "$_id.year",
              month: "$_id.month",
              quantity: "$totalSales",
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
          productId: "$_id",
          productName: "$product.name",
          category: "$product.category",
          totalSales: 1,
          monthlySales: 1,
        },
      },
    ]);

    return res.status(200).json(trends);
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