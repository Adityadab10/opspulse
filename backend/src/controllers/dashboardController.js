import { roundTo, calculatePercentChange } from "../helpers/analytics.js";
import pool, { getMigratedSalesSummary } from "../config/postgres.js";

const computeTrend = (salesDocs, recentDays = 30) => {
  if (!salesDocs || salesDocs.length === 0) {
    return { recentSales: 0, previousSales: 0, percentChange: 0, trendDirection: "stable" };
  }

  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - recentDays);

  const recentSales = salesDocs
    .filter((s) => new Date(s.sale_date) <= now && new Date(s.sale_date) > cutoffDate)
    .reduce((sum, s) => sum + (s.quantity || 0), 0);

  const prevEndDate = new Date(cutoffDate);
  const prevStartDate = new Date(cutoffDate);
  prevStartDate.setDate(prevStartDate.getDate() - recentDays);

  const previousSales = salesDocs
    .filter((s) => new Date(s.sale_date) <= prevEndDate && new Date(s.sale_date) > prevStartDate)
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

const getSummary = async (req, res) => {
  try {
    const [totalProductsResult, activeAlertsResult, allSales] = await Promise.all([
      countMigratedProducts(),
      countAllActiveAlerts(),
      getAllSales(),
    ]);

    const totalProducts = totalProductsResult;
    const activeAlerts = activeAlertsResult;
    const totalSalesVolume = allSales.reduce((sum, s) => sum + (s.quantity || 0), 0);
    const avgDailySales = totalSalesVolume / 30 || 0;
    const avgMonthlySales = totalProducts ? roundTo(totalSalesVolume / Math.max(totalProducts, 1)) : 0;

    const trend = computeTrend(allSales);

    // Group sales by product for top products calculation
    const productSalesMap = new Map();
    for (const sale of allSales) {
      const key = sale.product_id;
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
      const product = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products WHERE id = $1', [r.productId]);
      const prod = product.rows[0];
      if (!prod || prod.legacy_mongo_id === 'test123') {
        return {
          name: "Unknown Product",
          quantity: r.totalQty,
          percentChange: r.percentChange,
          trendDirection: r.trendDirection,
        };
      }
      return {
        name: prod.name,
        quantity: r.totalQty,
        percentChange: r.percentChange,
        trendDirection: r.trendDirection,
      };
    });

    const topDecreasingProducts = topDecreasing.map((r) => {
      const product = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products WHERE id = $1', [r.productId]);
      const productRows = product.rows;
      const prod = productRows.length > 0 ? productRows[0] : null;
      if (!prod || prod.legacy_mongo_id === 'test123') {
        return {
          name: "Unknown Product",
          quantity: r.totalQty,
          percentChange: r.percentChange,
          trendDirection: r.trendDirection,
        };
      }
      return {
        name: prod.name,
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
    console.error("Dashboard summary error:", error.message);
    return res.status(500).json({
      message: "Failed to fetch dashboard summary",
      error: error.message,
    });
  }
};

const getTrends = async (req, res) => {
  try {
    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

    const sixMonthKeys = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });

    // Get all sales data ordered by date
    const allSales = await getAllSales();

    // Filter sales within the 6-month window (UTC)
    const filteredSales = allSales.filter((s) => {
      const saleDate = new Date(s.sale_date);
      return saleDate >= startDate && saleDate <= new Date();
    });

    // Group sales by product and month
    const productMonthMap = new Map();
    for (const sale of filteredSales) {
      const productId = sale.product_id;
      if (!productId) continue;
      const date = new Date(sale.sale_date);
      const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

      if (!productMonthMap.has(productId)) {
        productMonthMap.set(productId, new Map());
      }
      const monthData = productMonthMap.get(productId);
      const existing = monthData.get(monthKey) || 0;
      monthData.set(monthKey, existing + (sale.quantity || 0));
    }

    // Get product names for all product IDs
    const productIds = [...productMonthMap.keys()];
    const productNameMap = new Map();
    if (productIds.length > 0) {
      const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(
        `SELECT id, name, category, legacy_mongo_id FROM products WHERE id IN (${placeholders})`,
        productIds
      );
      result.rows.forEach(p => {
        if (p.legacy_mongo_id !== 'test123') {
          productNameMap.set(p.id, p.name);
        }
      });
    }

    // Build response rows
    const response = productIds.map((productId) => {
      const monthData = productMonthMap.get(productId) || new Map();
      const data = sixMonthKeys.map((k) => monthData.get(k) || 0);
      const name = productNameMap.get(productId) || "Unknown Product";
      return { product: name, data };
    });

    // Demand trend summary - total and average from migrated sales only
    const migratedSalesSummary = await getMigratedSalesSummary();
    const totalQuantity = migratedSalesSummary.totalQuantity;
    const recordCount = migratedSalesSummary.recordCount;

    const demandTrendSummary = {
      totalSales: totalQuantity,
      totalRecords: recordCount,
      averageMonthly: recordCount > 0 ? totalQuantity / Math.max(Math.floor(recordCount / 12), 1) : 0,
    };

    return res.status(200).json({
      trends: response,
      demandTrendSummary,
    });
  } catch (error) {
    console.error("Dashboard trends error:", error.message);
    return res.status(500).json({
      message: "Failed to fetch trends",
      error: error.message,
    });
  }
};

const getDistribution = async (req, res) => {
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

const getProductAnalysis = async (req, res) => {
  try {
    const [products, allSales] = await Promise.all([
      getAllProducts(),
      getAllSales(),
    ]);

    // Build sales map: productId -> aggregated sales periods
    const salesMap = new Map();
    for (const sale of allSales) {
      const key = sale.product_id;
      if (!key) continue;
      if (!salesMap.has(key)) {
        salesMap.set(key, { productId: key, periods: [], totalQty: 0 });
      }
      salesMap.get(key).periods.push(sale);
      salesMap.get(key).totalQty += sale.quantity || 0;
    }

    const analysis = products.map((product) => {
      const salesData = salesMap.get(product.id) || { periods: [], totalQty: 0 };
      const periods = salesData.periods || [];

      // Sort periods by date (most recent first) and take two most recent
      const sortedPeriods = [...periods].sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date));
      const current = sortedPeriods[0]?.quantity || 0;
      const previous = sortedPeriods[1]?.quantity || 0;

      return {
        productId: product.id,
        name: product.name,
        category: product.category,
        avgSales: salesData.totalQty > 0 ? roundTo(salesData.totalQty / Math.max(sortedPeriods.length, 1)) : 0,
        percentChange: current > 0 || previous > 0 ? roundTo(calculatePercentChange(current, previous)) : 0,
      };
    });

    return res.status(200).json(analysis);
  } catch (error) {
    console.error("Product analysis error:", error.message);
    return res.status(500).json({
      message: "Failed to fetch product analysis",
      error: error.message,
    });
  }
};

export { getSummary, getTrends, getDistribution, getProductAnalysis };