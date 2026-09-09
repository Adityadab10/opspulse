import pool from './database.js';

const getAllProducts = async () => {
  const result = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products ORDER BY name');
  return result.rows;
};

const getProductById = async (productId) => {
  const result = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products WHERE id = $1', [productId]);
  return result.rows[0] || null;
};

const getProductByLegacyId = async (legacyMongoId) => {
  const result = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products WHERE legacy_mongo_id = $1', [legacyMongoId]);
  return result.rows[0] || null;
};

const countProducts = async () => {
  const result = await pool.query('SELECT COUNT(*) AS cnt FROM products');
  return result.rows[0].cnt;
};

const countMigratedProducts = async () => {
  const result = await pool.query("SELECT COUNT(*) AS cnt FROM products WHERE LENGTH(legacy_mongo_id) = 24 AND legacy_mongo_id ~ '^[0-9a-f]*'");
  return result.rows[0].cnt;
};

const countAllSales = async () => {
  const result = await pool.query('SELECT COUNT(*) AS cnt FROM sales');
  return result.rows[0].cnt;
};

const countMigratedSales = async () => {
  const result = await pool.query(`
    SELECT COUNT(*) AS cnt FROM sales
    JOIN products ON sales.product_id = products.id
    WHERE LENGTH(products.legacy_mongo_id) = 24 AND products.legacy_mongo_id ~ '^[0-9a-f]*'`
  );
  return result.rows[0].cnt;
};

const getMigratedSalesSummary = async () => {
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(s.quantity), 0) AS totalQuantity,
      COUNT(s.id) AS recordCount
    FROM sales s
    JOIN products p ON s.product_id = p.id
    WHERE LENGTH(p.legacy_mongo_id) = 24 AND p.legacy_mongo_id ~ '^[0-9a-f]*'`)
  return result.rows[0];
};

const getSalesByProductId = async (productId) => {
  const result = await pool.query(
    'SELECT id, product_id, sale_date, quantity FROM sales WHERE product_id = $1 ORDER BY sale_date',
    [productId]
  );
  return result.rows;
};

const getAllSales = async () => {
  const result = await pool.query('SELECT id, product_id, sale_date, quantity FROM sales ORDER BY sale_date');
  return result.rows;
};

const countActiveAlerts = async () => {
  const result = await pool.query('SELECT COUNT(*) AS cnt FROM alerts WHERE is_active = true');
  return result.rows[0].cnt;
};

const countAllActiveAlerts = async () => {
  const result = await pool.query('SELECT COUNT(*) AS cnt FROM alerts WHERE is_active = true');
  return result.rows[0].cnt;
};

const getPredictionByProductId = async (productId) => {
  const result = await pool.query(
    'SELECT id, product_id, predicted_demand, rule_prediction, ml_prediction, adjusted_prediction, avg_sales, percent_change, confidence, season_tag, decision, impact, keyword, score, source_headline, source_headlines, matched_keywords, reason, contributing_factors, prediction_source, predicted_at FROM predictions WHERE product_id = $1',
    [productId]
  );
  return result.rows[0] || null;
};

const countPredictionsByProductId = async (productId) => {
  const result = await pool.query('SELECT COUNT(*) AS cnt FROM predictions WHERE product_id = $1', [productId]);
  return result.rows[0].cnt;
};

const countAllPredictions = async () => {
  const result = await pool.query('SELECT COUNT(*) AS cnt FROM predictions');
  return result.rows[0].cnt;
};

const getActiveAlertsByProductId = async (productId) => {
  const result = await pool.query(
    'SELECT id, product_id, type, message, severity, percent_change, is_active, created_at FROM alerts WHERE product_id = $1 AND is_active = true ORDER BY created_at DESC',
    [productId]
  );
  return result.rows;
};

const getProductsByLegacyIdPattern = async (pattern) => {
  const result = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products WHERE legacy_mongo_id LIKE $1 ORDER BY name', [pattern]);
  return result.rows;
};

export {
  getAllProducts,
  getProductById,
  getProductByLegacyId,
  countProducts,
  countMigratedProducts,
  countAllSales,
  countMigratedSales,
  getMigratedSalesSummary,
  getSalesByProductId,
  getAllSales,
  countActiveAlerts,
  countAllActiveAlerts,
  getPredictionByProductId,
  countPredictionsByProductId,
  countAllPredictions,
  getActiveAlertsByProductId,
  getProductsByLegacyIdPattern,
};