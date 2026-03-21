import Product from "../models/Product.js";
import Sales from "../models/Sales.js";
import { calculatePercentChange, roundTo } from "../helpers/analytics.js";

const toMonthKey = (dateValue) => {
  const d = new Date(dateValue);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const getProductAnalysis = async (req, res) => {
  try {
    const products = await Product.find().lean();

    const analysis = await Promise.all(
      products.map(async (product) => {
        const salesRows = await Sales.find({ productId: product._id })
          .sort({ date: 1 })
          .populate("productId", "name category")
          .lean();

        if (!salesRows.length) {
          return {
            name: product.name,
            category: product.category,
            avgSales: 0,
            percentChange: 0,
          };
        }

        const avgSalesRaw =
          salesRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0) / salesRows.length;

        const monthMap = new Map();
        for (const row of salesRows) {
          const key = toMonthKey(row.date);
          monthMap.set(key, (monthMap.get(key) || 0) + Number(row.quantity || 0));
        }

        const monthlyTotals = Array.from(monthMap.entries())
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([, total]) => total);

        const lastMonth = monthlyTotals[monthlyTotals.length - 1] || 0;
        const previousMonth = monthlyTotals[monthlyTotals.length - 2] || 0;

        return {
          name: product.name,
          category: product.category,
          avgSales: roundTo(avgSalesRaw),
          percentChange: roundTo(calculatePercentChange(lastMonth, previousMonth)),
        };
      })
    );

    return res.status(200).json(analysis);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch product analysis",
      error: error.message,
    });
  }
};