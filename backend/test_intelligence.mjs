import { Pool } from 'pg';
import fs from 'fs';

const RECENT_DAYS = 30;

const txt = fs.readFileSync('./.env', 'utf8');
const env = {};
txt.split('\n').forEach(line => { const idx = line.indexOf('='); if (idx > 0) { env[line.substring(0, idx)] = line.substring(idx + 1); } });

const pool = new Pool({ connectionString: env.DATABASE_URL });

const getProductById = async (productId) => {
  const result = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products WHERE id = $1', [productId]);
  return result.rows[0] || null;
};

const getSalesByProductId = async (productId) => {
  const result = await pool.query(
    'SELECT id, product_id, sale_date, quantity FROM sales WHERE product_id = $1 ORDER BY sale_date',
    [productId]
  );
  return result.rows;
};

const getPredictionByProductId = async (productId) => {
  const result = await pool.query(
    'SELECT id, product_id, predicted_demand, rule_prediction, ml_prediction, adjusted_prediction, avg_sales, percent_change, confidence, season_tag, decision, impact, keyword, score, source_headline, source_headlines, matched_keywords, reason, contributing_factors, prediction_source, predicted_at FROM predictions WHERE product_id = $1',
    [productId]
  );
  return result.rows[0] || null;
};

const getActiveAlertsByProductId = async (productId) => {
  const result = await pool.query(
    'SELECT id, product_id, type, message, severity, percent_change, is_active, created_at FROM alerts WHERE product_id = $1 AND is_active = true ORDER BY created_at DESC',
    [productId]
  );
  return result.rows;
};

const roundTo = (value) => {
  if (value === null || value === undefined) return 0;
  return Math.round(value * 100) / 100;
};

const calculatePercentChange = (recent, previous) => {
  if (previous === 0) return recent / previous * 100;
  return (recent - previous) / previous * 100;
};

const formatDate = (isoDate) => {
  const d = new Date(isoDate);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const getProductIntelligence = async (productId) => {
  try {
    // Check if productId is a valid UUID format
    const uuidPattern = /^[0-9a-f-]{36}$/i;
    if (!uuidPattern.test(productId)) {
      return { error: 'Invalid productId', status: 400 };
    }

    // Look up product from PostgreSQL
    const product = await getProductById(productId);

    // If product not found or is a test record, return 404
    if (!product) {
      return { error: 'Product not found', status: 404 };
    }

    // Filter out test products (legacy_mongo_id = 'test123')
    if (product.legacy_mongo_id === 'test123') {
      return { error: 'Product not found', status: 404 };
    }

    // Get sales records for this product from PostgreSQL, sorted by date
    const salesDocs = await getSalesByProductId(productId);

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
        const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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
        date: formatDate(s.sale_date),
        quantity: s.quantity,
      }));
    }

    // Get the latest prediction from PostgreSQL
    const predictionDoc = await getPredictionByProductId(productId);

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
    const activeAlerts = await getActiveAlertsByProductId(productId);

    // Build response
    const intelligence = {
      product: {
        id: product.id,
        name: product.name,
        category: product.category,
      },
      historicalSales: historicalSales,
      summary: {
        avgSales: roundTo(avgSales),
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

    return { data: intelligence, status: 200 };
  } catch (error) {
    console.error("Product intelligence fetch error:", error.message);
    return { error: 'Failed to fetch product intelligence', status: 500 };
  }
};

// Test with a migrated product ID (Almonds)
const testProductId = 'f4b5c41b-96fb-4ba0-a4d3-680ec44f47a5';

getProductIntelligence(testProductId).then(async result => {
  if (result.status === 200) {
    console.log('SUCCESS: Product intelligence retrieved');
    console.log('Product:', result.data.product.name);
    console.log('Historical sales count:', result.data.historicalSales.length);
    console.log('Summary avgSales:', result.data.summary.avgSales);
    console.log('Summary trendDirection:', result.data.summary.trendDirection);
    console.log('Percent change:', result.data.summary.percentChange);
    console.log('Forecast predictedDemand:', result.data.forecast.predictedDemand);
    console.log('Forecast confidence:', result.data.forecast.confidence);
    console.log('Forecast decision:', result.data.forecast.decision);
    console.log('Alerts count:', result.data.alerts.length);
    console.log('Forecast seasonTag:', result.data.forecast.seasonTag);
    console.log('Forecast keyword:', result.data.forecast.keyword);
  } else {
    console.log('Error:', result.error);
  }
  await pool.end();
}).then(() => process.exitCode = 0).catch(async e => {
  console.error('Fatal error:', e.message);
  await pool.end();
  process.exitCode = 1;
});