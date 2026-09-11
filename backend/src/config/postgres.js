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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createProduct = async (name, category) => {
  const result = await pool.query(
    `INSERT INTO products (name, category, created_at, updated_at)
     VALUES ($1, $2, now(), now())
     RETURNING id, name, category, legacy_mongo_id, created_at, updated_at`,
    [String(name).trim(), String(category).trim()],
  );
  return result.rows[0] || null;
};

const resolveProduct = async (productReference, queryable = pool) => {
  const reference = String(productReference || '').trim();
  if (!reference) return null;

  const legacyResult = await queryable.query(
    'SELECT id, name, category, legacy_mongo_id FROM products WHERE legacy_mongo_id = $1',
    [reference],
  );
  if (legacyResult.rows.length > 1) {
    throw new Error('Ambiguous product legacy_mongo_id mapping');
  }
  if (legacyResult.rows.length === 1) return legacyResult.rows[0];

  if (!UUID_PATTERN.test(reference)) return null;
  const uuidResult = await queryable.query(
    'SELECT id, name, category, legacy_mongo_id FROM products WHERE id = $1',
    [reference],
  );
  return uuidResult.rows[0] || null;
};

const validSaleDate = (value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const insertSale = async (productReference, saleDate, quantity) => {
  const product = await resolveProduct(productReference);
  if (!product) return null;

  const date = validSaleDate(saleDate);
  const numericQuantity = Number(quantity);
  if (!date || !Number.isInteger(numericQuantity) || numericQuantity <= 0) return null;

  const inserted = await pool.query(
    `INSERT INTO sales (product_id, sale_date, quantity, created_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (product_id, sale_date) DO NOTHING
     RETURNING id, product_id, sale_date, quantity, created_at`,
    [product.id, date, numericQuantity],
  );
  const sale = inserted.rows[0]
    || (await pool.query(
      'SELECT id, product_id, sale_date, quantity, created_at FROM sales WHERE product_id = $1 AND sale_date = $2',
      [product.id, date],
    )).rows[0];

  return { sale, product, inserted: inserted.rows.length === 1 };
};

const createOrFindCsvProducts = async (client, products) => {
  const productIdByKey = new Map();
  let created = 0;

  for (const product of products) {
    const existing = await client.query(
      'SELECT id FROM products WHERE name = $1 AND category = $2 ORDER BY id LIMIT 1',
      [product.name, product.category],
    );
    const row = existing.rows[0] || (await client.query(
      `INSERT INTO products (name, category, created_at, updated_at)
       VALUES ($1, $2, now(), now())
       RETURNING id`,
      [product.name, product.category],
    )).rows[0];
    if (existing.rows.length === 0) created += 1;
    productIdByKey.set(product.key, row.id);
  }

  return { productIdByKey, created };
};

const insertCsvSales = async (client, rows, productIdByKey) => {
  let inserted = 0;
  for (const row of rows) {
    const productId = productIdByKey.get(row.productKey);
    if (!productId) throw new Error(`Product resolution failed for CSV row ${row.rowIndex}`);
    const result = await client.query(
      `INSERT INTO sales (product_id, sale_date, quantity, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (product_id, sale_date) DO NOTHING
       RETURNING id`,
      [productId, row.date, row.quantity],
    );
    inserted += result.rows.length;
  }
  return inserted;
};

const importCsvSales = async (products, rows) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { productIdByKey, created } = await createOrFindCsvProducts(client, products);
    const salesInserted = await insertCsvSales(client, rows, productIdByKey);
    await client.query('COMMIT');
    return { productsCreated: created, salesRecordsInserted: salesInserted };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('CSV import rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
};

const getActiveAlertsByProductId = async (productId) => {
  const result = await pool.query(
    'SELECT id, product_id, type, message, severity, percent_change, is_active, created_at FROM alerts WHERE product_id = $1 AND is_active = true ORDER BY created_at DESC',
    [productId]
  );
  return result.rows;
};

const getRecentActiveAlerts = async () => {
  const result = await pool.query(`
    SELECT a.id, a.product_id, a.type, a.message, a.severity, a.percent_change, a.is_active, a.created_at,
           p.name AS productName, p.category AS productCategory
    FROM alerts a
    LEFT JOIN products p ON a.product_id = p.id
    WHERE a.is_active = true
    ORDER BY a.created_at DESC
    LIMIT 5
  `);
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
  createProduct,
  resolveProduct,
  insertSale,
  importCsvSales,
  getActiveAlertsByProductId,
  getRecentActiveAlerts,
  getProductsByLegacyIdPattern,
};
