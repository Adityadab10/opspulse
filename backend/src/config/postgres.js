import pool from './database.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_MONGO_ID_PATTERN = /^[0-9a-f]{24}$/i;

const isProductReference = (value) => {
  const reference = String(value || '').trim();
  return UUID_PATTERN.test(reference) || LEGACY_MONGO_ID_PATTERN.test(reference);
};

const getAllProducts = async (sort = 'name') => {
  const orderBy = sort === 'created_at' ? 'created_at DESC' : 'name';
  const result = await pool.query(`
    SELECT id, name, category, created_at, updated_at, legacy_mongo_id
    FROM products
    WHERE COALESCE(legacy_mongo_id, '') <> 'test123'
    ORDER BY ${orderBy}`);
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
  const result = await pool.query(
    "SELECT COUNT(*) AS cnt FROM products WHERE COALESCE(legacy_mongo_id, '') <> 'test123'",
  );
  return result.rows[0].cnt;
};

const countMigratedProducts = async () => {
  const result = await pool.query("SELECT COUNT(*) AS cnt FROM products WHERE legacy_mongo_id ~ '^[0-9a-f]{24}$'");
  return result.rows[0].cnt;
};

const countAllSales = async () => {
  const result = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM sales s
    JOIN products p ON p.id = s.product_id
    WHERE COALESCE(p.legacy_mongo_id, '') <> 'test123'`);
  return result.rows[0].cnt;
};

const countMigratedSales = async () => {
  const result = await pool.query(`
    SELECT COUNT(*) AS cnt FROM sales
    JOIN products ON sales.product_id = products.id
    WHERE products.legacy_mongo_id ~ '^[0-9a-f]{24}$'`
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
    WHERE p.legacy_mongo_id ~ '^[0-9a-f]{24}$'`)
  return result.rows[0];
};

const getSalesByProductId = async (productId) => {
  const result = await pool.query(
    'SELECT id, product_id, sale_date, quantity, created_at FROM sales WHERE product_id = $1 ORDER BY sale_date DESC',
    [productId]
  );
  return result.rows;
};

const getSalesSeriesByProductId = async (productId) => {
  const result = await pool.query(
    'SELECT id, product_id, sale_date, quantity, created_at FROM sales WHERE product_id = $1 ORDER BY sale_date ASC',
    [productId]
  );
  return result.rows;
};

const getAllSales = async () => {
  const result = await pool.query(`
    SELECT s.id, s.product_id, s.sale_date, s.quantity
    FROM sales s
    JOIN products p ON p.id = s.product_id
    WHERE COALESCE(p.legacy_mongo_id, '') <> 'test123'
    ORDER BY s.sale_date`);
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

const createAlert = async (productReference, { type, message, severity, percentChange, isActive = true }) => {
  const product = await resolveProduct(productReference);
  if (!product) return null;

  const result = await pool.query(
    `INSERT INTO alerts (product_id, type, message, severity, percent_change, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, product_id, type, message, severity, percent_change, is_active, created_at`,
    [product.id, type, message, severity, percentChange, isActive],
  );

  return { alert: result.rows[0], product };
};

const deactivateAlertById = async (alertId) => {
  const result = await pool.query(
    `UPDATE alerts AS a
     SET is_active = false
     FROM products AS p
     WHERE a.id = $1 AND p.id = a.product_id
     RETURNING a.id, a.product_id, a.type, a.message, a.severity, a.percent_change,
               a.is_active, a.created_at, p.legacy_mongo_id`,
    [alertId],
  );
  return result.rows[0] || null;
};

const deleteActiveAlertsForProduct = async (productReference) => {
  const product = await resolveProduct(productReference);
  if (!product) return { product: null, deleted: 0 };

  const result = await pool.query(
    'DELETE FROM alerts WHERE product_id = $1 AND is_active = true',
    [product.id],
  );
  return { product, deleted: result.rowCount };
};

const upsertAlertByProductAndType = async (
  productReference,
  { type, message, severity, percentChange, isActive = true },
) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const product = await resolveProduct(productReference, client);
    if (!product) {
      await client.query('ROLLBACK');
      return null;
    }

    const existing = await client.query(
      `SELECT id FROM alerts
       WHERE product_id = $1 AND type = $2
       LIMIT 1
       FOR UPDATE`,
      [product.id, type],
    );

    const result = existing.rows[0]
      ? await client.query(
        `UPDATE alerts
         SET message = $1, severity = $2, percent_change = $3, is_active = $4
         WHERE id = $5
         RETURNING id, product_id, type, message, severity, percent_change, is_active, created_at`,
        [message, severity, percentChange, isActive, existing.rows[0].id],
      )
      : await client.query(
        `INSERT INTO alerts (product_id, type, message, severity, percent_change, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, product_id, type, message, severity, percent_change, is_active, created_at`,
        [product.id, type, message, severity, percentChange, isActive],
      );

    await client.query('COMMIT');
    return { alert: result.rows[0], product };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Alert upsert rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
};

const getProductsByLegacyIdPattern = async (pattern) => {
  const result = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products WHERE legacy_mongo_id LIKE $1 ORDER BY name', [pattern]);
  return result.rows;
};

export {
  UUID_PATTERN,
  LEGACY_MONGO_ID_PATTERN,
  isProductReference,
  getAllProducts,
  getProductById,
  getProductByLegacyId,
  countProducts,
  countMigratedProducts,
  countAllSales,
  countMigratedSales,
  getMigratedSalesSummary,
  getSalesByProductId,
  getSalesSeriesByProductId,
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
  createAlert,
  deactivateAlertById,
  deleteActiveAlertsForProduct,
  upsertAlertByProductAndType,
  getProductsByLegacyIdPattern,
};
