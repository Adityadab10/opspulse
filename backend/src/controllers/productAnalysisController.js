import { calculatePercentChange, roundTo } from "../helpers/analytics.js";
import { getAllProducts, getAllSales } from "../config/postgres.js";

const toMonthKey = (dateValue) => {
  const d = new Date(dateValue);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const getProductAnalysis = async (req, res) => {
  try {
    const [products, sales] = await Promise.all([getAllProducts(), getAllSales()]);
    const salesByProduct = new Map();
    for (const sale of sales) {
      const rows = salesByProduct.get(sale.product_id) || [];
      rows.push(sale);
      salesByProduct.set(sale.product_id, rows);
    }

    const analysis = products.map((product) => {
      const salesRows = salesByProduct.get(product.id) || [];

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
        const key = toMonthKey(row.sale_date);
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
    });

    return res.status(200).json(analysis);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch product analysis",
      error: error.message,
    });
  }
};
