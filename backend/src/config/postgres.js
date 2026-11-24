import pool from './database.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_MONGO_ID_PATTERN = /^[0-9a-f]{24}$/i;
const TENANT_TABLES = ['products', 'sales', 'predictions', 'alerts', 'data_imports'];
const TENANT_CONSTRAINTS = ['sales_tenant_product_date_key', 'predictions_tenant_product_key'];
let tenantSchemaReady = false;

export class TenantSchemaUnavailableError extends Error {
  constructor(missingDependencies = TENANT_TABLES) {
    super(`Tenant isolation schema is unavailable; migration 005 dependencies are missing: ${missingDependencies.join(', ')}`);
    this.name = 'TenantSchemaUnavailableError';
    this.code = 'TENANT_SCHEMA_UNAVAILABLE';
    this.statusCode = 503;
  }
}

const requireTenantId = (tenantId) => {
  const normalized = typeof tenantId === 'string' ? tenantId.trim() : '';
  if (!normalized) {
    const error = new Error('Trusted tenant context is required');
    error.code = 'MISSING_TENANT_CONTEXT';
    error.statusCode = 401;
    throw error;
  }
  return normalized;
};

const ensureTenantSchema = async (queryable = pool) => {
  if (tenantSchemaReady) return;

  const result = await queryable.query(
    `SELECT table_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND column_name = 'tenant_id'
       AND table_name = ANY($1::text[])
     GROUP BY table_name`,
    [TENANT_TABLES],
  );
  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = TENANT_TABLES.filter((tableName) => !present.has(tableName));
  if (missing.length) throw new TenantSchemaUnavailableError(missing);

  const constraints = await queryable.query(
    `SELECT conname
     FROM pg_constraint
     WHERE contype = 'u' AND conname = ANY($1::text[])`,
    [TENANT_CONSTRAINTS],
  );
  const presentConstraints = new Set(constraints.rows.map((row) => row.conname));
  const missingConstraints = TENANT_CONSTRAINTS.filter((name) => !presentConstraints.has(name));
  if (missingConstraints.length) throw new TenantSchemaUnavailableError(missingConstraints);
  tenantSchemaReady = true;
};

const withTenant = async (tenantId, queryable = pool) => {
  const normalizedTenantId = requireTenantId(tenantId);
  await ensureTenantSchema(queryable);
  return normalizedTenantId;
};

const isProductReference = (value) => {
  const reference = String(value || '').trim();
  return UUID_PATTERN.test(reference) || LEGACY_MONGO_ID_PATTERN.test(reference);
};

const getAllProducts = async (tenantId, sort = 'name', search = '') => {
  const tenant = await withTenant(tenantId);
  const orderBy = sort === 'created_at' ? 'created_at DESC' : 'name';
  const normalizedSearch = String(search || '').trim();
  const searchClause = normalizedSearch ? 'AND (name ILIKE $2 OR category ILIKE $2)' : '';
  const params = normalizedSearch ? [tenant, `%${normalizedSearch}%`] : [tenant];
  const result = await pool.query(`
    SELECT id, name, category, stock_quantity, reorder_threshold, created_at, updated_at, legacy_mongo_id
    FROM products
    WHERE tenant_id = $1 AND COALESCE(legacy_mongo_id, '') <> 'test123' ${searchClause}
    ORDER BY ${orderBy}`, params);
  return result.rows;
};

const getProductById = async (tenantId, productId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    'SELECT id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at FROM products WHERE tenant_id = $1 AND id = $2',
    [tenant, productId],
  );
  return result.rows[0] || null;
};

const getProductByLegacyId = async (tenantId, legacyMongoId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    'SELECT id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at FROM products WHERE tenant_id = $1 AND legacy_mongo_id = $2',
    [tenant, legacyMongoId],
  );
  return result.rows[0] || null;
};

const countProducts = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    "SELECT COUNT(*) AS cnt FROM products WHERE tenant_id = $1 AND COALESCE(legacy_mongo_id, '') <> 'test123'",
    [tenant],
  );
  return result.rows[0].cnt;
};

const countMigratedProducts = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    "SELECT COUNT(*) AS cnt FROM products WHERE tenant_id = $1 AND legacy_mongo_id ~ '^[0-9a-f]{24}$'",
    [tenant],
  );
  return result.rows[0].cnt;
};

const countAllSales = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM sales s
    JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
    WHERE s.tenant_id = $1 AND COALESCE(p.legacy_mongo_id, '') <> 'test123'`, [tenant]);
  return result.rows[0].cnt;
};

const countMigratedSales = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM sales
    JOIN products ON sales.product_id = products.id AND sales.tenant_id = products.tenant_id
    WHERE sales.tenant_id = $1 AND products.legacy_mongo_id ~ '^[0-9a-f]{24}$'`, [tenant]);
  return result.rows[0].cnt;
};

const getMigratedSalesSummary = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(s.quantity), 0) AS totalQuantity,
      COUNT(s.id) AS recordCount
    FROM sales s
    JOIN products p ON s.product_id = p.id AND s.tenant_id = p.tenant_id
    WHERE s.tenant_id = $1 AND p.legacy_mongo_id ~ '^[0-9a-f]{24}$'`, [tenant]);
  return result.rows[0];
};

const getSalesByProductId = async (tenantId, productId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    `SELECT s.id, s.product_id, s.sale_date, s.quantity, s.created_at
     FROM sales s
     JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1 AND s.product_id = $2
     ORDER BY s.sale_date DESC`,
    [tenant, productId],
  );
  return result.rows;
};

const getSalesSeriesByProductId = async (tenantId, productId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    `SELECT s.id, s.product_id, s.sale_date, s.quantity, s.created_at
     FROM sales s
     JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1 AND s.product_id = $2
     ORDER BY s.sale_date ASC`,
    [tenant, productId],
  );
  return result.rows;
};

const getAllSales = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(`
    SELECT s.id, s.product_id, s.sale_date, s.quantity
    FROM sales s
    JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
    WHERE s.tenant_id = $1 AND COALESCE(p.legacy_mongo_id, '') <> 'test123'
    ORDER BY s.sale_date`, [tenant]);
  return result.rows;
};

const getSalesHistory = async (tenantId, { productId = null, startDate = null, endDateExclusive = null } = {}) => {
  const tenant = await withTenant(tenantId);
  const conditions = ["s.tenant_id = $1", "COALESCE(p.legacy_mongo_id, '') <> 'test123'"];
  const params = [tenant];
  if (productId) {
    params.push(productId);
    conditions.push(`s.product_id = $${params.length}`);
  }
  if (startDate) {
    params.push(startDate);
    conditions.push(`s.sale_date >= $${params.length}`);
  }
  if (endDateExclusive) {
    params.push(endDateExclusive);
    conditions.push(`s.sale_date < $${params.length}`);
  }
  const result = await pool.query(
    `SELECT s.id, s.product_id, p.name AS product_name, p.category AS product_category,
            s.sale_date, s.quantity, s.created_at
     FROM sales s
     JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.sale_date DESC, s.created_at DESC`,
    params,
  );
  return result.rows;
};

const getInventoryHealthData = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(`
    SELECT p.id, p.name, p.category, p.stock_quantity, p.reorder_threshold,
           pr.predicted_demand, pr.prediction_horizon_days, pr.predicted_at,
           pr.prediction_source
    FROM products p
    LEFT JOIN predictions pr ON pr.product_id = p.id AND pr.tenant_id = p.tenant_id
    WHERE p.tenant_id = $1 AND COALESCE(p.legacy_mongo_id, '') <> 'test123'
    ORDER BY p.name`, [tenant]);
  return result.rows;
};

const countActiveAlerts = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query('SELECT COUNT(*) AS cnt FROM alerts WHERE tenant_id = $1 AND is_active = true', [tenant]);
  return result.rows[0].cnt;
};

const countAllActiveAlerts = async (tenantId) => countActiveAlerts(tenantId);

const getPredictionByProductId = async (tenantId, productId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    `SELECT pr.id, pr.product_id, pr.predicted_demand, pr.rule_prediction, pr.ml_prediction, pr.adjusted_prediction,
            avg_sales, percent_change, confidence, season_tag, decision, impact, keyword, score,
            source_headline, source_headlines, matched_keywords, reason, contributing_factors,
            prediction_source, prediction_horizon_days, predicted_at
     FROM predictions pr
     JOIN products p ON p.id = pr.product_id AND p.tenant_id = pr.tenant_id
     WHERE pr.tenant_id = $1 AND pr.product_id = $2`,
    [tenant, productId],
  );
  return result.rows[0] || null;
};

const countPredictionsByProductId = async (tenantId, productId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM predictions pr
     JOIN products p ON p.id = pr.product_id AND p.tenant_id = pr.tenant_id
     WHERE pr.tenant_id = $1 AND pr.product_id = $2`,
    [tenant, productId],
  );
  return result.rows[0].cnt;
};

const countAllPredictions = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query('SELECT COUNT(*) AS cnt FROM predictions WHERE tenant_id = $1', [tenant]);
  return result.rows[0].cnt;
};

const upsertPrediction = async (tenantId, productId, prediction) => {
  const tenant = await withTenant(tenantId);
  const { rows } = await pool.query(
    `INSERT INTO predictions (
       tenant_id, product_id, predicted_demand, avg_sales, percent_change, confidence,
       season_tag, rule_prediction, ml_prediction, adjusted_prediction, decision, impact,
       keyword, score, source_headline, source_headlines, matched_keywords, reason,
       contributing_factors, prediction_source, prediction_horizon_days, predicted_at
     )
     SELECT $1::varchar, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, now()
     FROM products p
     WHERE p.tenant_id = $1::varchar AND p.id = $2::uuid
     ON CONFLICT (tenant_id, product_id) DO UPDATE SET
       predicted_demand = EXCLUDED.predicted_demand,
       avg_sales = EXCLUDED.avg_sales,
       percent_change = EXCLUDED.percent_change,
       confidence = EXCLUDED.confidence,
       season_tag = EXCLUDED.season_tag,
       rule_prediction = EXCLUDED.rule_prediction,
       ml_prediction = EXCLUDED.ml_prediction,
       adjusted_prediction = EXCLUDED.adjusted_prediction,
       decision = EXCLUDED.decision,
       impact = EXCLUDED.impact,
       keyword = EXCLUDED.keyword,
       score = EXCLUDED.score,
       source_headline = EXCLUDED.source_headline,
       source_headlines = EXCLUDED.source_headlines,
       matched_keywords = EXCLUDED.matched_keywords,
       reason = EXCLUDED.reason,
       contributing_factors = EXCLUDED.contributing_factors,
       prediction_source = EXCLUDED.prediction_source,
       prediction_horizon_days = EXCLUDED.prediction_horizon_days,
       predicted_at = now()
     RETURNING id, product_id, predicted_demand, rule_prediction, ml_prediction, adjusted_prediction,
               avg_sales, percent_change, confidence, season_tag, decision, impact, keyword, score,
               source_headline, source_headlines, matched_keywords, reason, contributing_factors,
               prediction_source, prediction_horizon_days, predicted_at`,
    [
      tenant,
      productId,
      prediction.predictedDemand,
      prediction.avgSales,
      prediction.percentChange,
      prediction.confidence,
      prediction.seasonTag,
      prediction.rulePrediction,
      prediction.mlPrediction,
      prediction.adjustedPrediction,
      prediction.decision,
      prediction.impact,
      prediction.keyword,
      prediction.score,
      prediction.sourceHeadline,
      prediction.sourceHeadlines,
      prediction.matchedKeywords,
      prediction.reason,
      prediction.contributingFactors,
      prediction.predictionSource,
      prediction.predictionHorizonDays || 30,
    ],
  );
  return rows[0] || null;
};

const createProduct = async (tenantId, name, category, reorderThreshold = null) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    `INSERT INTO products (tenant_id, name, category, reorder_threshold, created_at, updated_at)
     VALUES ($1, $2, $3, COALESCE($4, 10), now(), now())
     RETURNING id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at`,
    [tenant, String(name).trim(), String(category).trim(), reorderThreshold],
  );
  return result.rows[0] || null;
};

const findProductByNameAndCategory = async (tenantId, name, category, excludeProductId = null) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    `SELECT id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at
     FROM products
     WHERE tenant_id = $1
       AND lower(name) = lower($2)
       AND lower(category) = lower($3)
       AND ($4::uuid IS NULL OR id <> $4::uuid)
     LIMIT 1`,
    [tenant, String(name).trim(), String(category).trim(), excludeProductId],
  );
  return result.rows[0] || null;
};

const updateProduct = async (tenantId, productReference, name, category, reorderThreshold = null) => {
  const tenant = await withTenant(tenantId);
  const product = await resolveProduct(tenant, productReference);
  if (!product) return null;
  const result = await pool.query(
    `UPDATE products
     SET name = $1, category = $2, reorder_threshold = COALESCE($3, reorder_threshold), updated_at = now()
     WHERE tenant_id = $4 AND id = $5
     RETURNING id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at`,
    [String(name).trim(), String(category).trim(), reorderThreshold, tenant, product.id],
  );
  return result.rows[0] || null;
};

const getProductDependencies = async (tenantId, productReference) => {
  const tenant = await withTenant(tenantId);
  const product = await resolveProduct(tenant, productReference);
  if (!product) return null;
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM sales WHERE tenant_id = $1 AND product_id = $2) AS sales_count,
       (SELECT COUNT(*) FROM predictions WHERE tenant_id = $1 AND product_id = $2) AS predictions_count,
       (SELECT COUNT(*) FROM alerts WHERE tenant_id = $1 AND product_id = $2) AS alerts_count,
       (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id = $1 AND product_id = $2) AS inventory_movements_count`,
    [tenant, product.id],
  );
  return { product, ...result.rows[0] };
};

const deleteProduct = async (tenantId, productReference) => {
  const tenant = await withTenant(tenantId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureTenantSchema(client);
    const productResult = await client.query(
      `SELECT id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at
       FROM products WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenant, productReference],
    );
    const product = productResult.rows[0] || null;
    if (!product) {
      await client.query('COMMIT');
      return null;
    }
    const dependencies = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM sales WHERE tenant_id = $1 AND product_id = $2) AS sales_count,
         (SELECT COUNT(*) FROM predictions WHERE tenant_id = $1 AND product_id = $2) AS predictions_count,
         (SELECT COUNT(*) FROM alerts WHERE tenant_id = $1 AND product_id = $2) AS alerts_count,
         (SELECT COUNT(*) FROM inventory_movements WHERE tenant_id = $1 AND product_id = $2) AS inventory_movements_count`,
      [tenant, product.id],
    );
    const dependencyCounts = dependencies.rows[0];
    const hasDependencies = ["sales_count", "predictions_count", "alerts_count", "inventory_movements_count"]
      .some((field) => Number(dependencyCounts[field]) > 0);
    if (hasDependencies) {
      await client.query('COMMIT');
      return { product, deleted: false, ...dependencyCounts };
    }
    await client.query('DELETE FROM products WHERE tenant_id = $1 AND id = $2', [tenant, product.id]);
    await client.query('COMMIT');
    return { product, deleted: true, sales_count: 0, predictions_count: 0, alerts_count: 0 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const resolveProduct = async (tenantId, productReference, queryable = pool) => {
  const tenant = await withTenant(tenantId, queryable);
  const reference = String(productReference || '').trim();
  if (!reference) return null;

  const legacyResult = await queryable.query(
    'SELECT id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at FROM products WHERE tenant_id = $1 AND legacy_mongo_id = $2',
    [tenant, reference],
  );
  if (legacyResult.rows.length > 1) {
    throw new Error('Ambiguous product legacy_mongo_id mapping');
  }
  if (legacyResult.rows.length === 1) return legacyResult.rows[0];

  if (!UUID_PATTERN.test(reference)) return null;
  const uuidResult = await queryable.query(
    'SELECT id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at FROM products WHERE tenant_id = $1 AND id = $2',
    [tenant, reference],
  );
  return uuidResult.rows[0] || null;
};

const validSaleDate = (value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const insertSale = async (tenantId, productReference, saleDate, quantity) => {
  const tenant = await withTenant(tenantId);
  const date = validSaleDate(saleDate);
  const numericQuantity = Number(quantity);
  if (!date || !Number.isInteger(numericQuantity) || numericQuantity <= 0) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resolved = await resolveProduct(tenant, productReference, client);
    if (!resolved) {
      await client.query('ROLLBACK');
      return null;
    }
    const locked = await client.query(
      `SELECT id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at
       FROM products WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenant, resolved.id],
    );
    const product = locked.rows[0];
    if (!product || product.stock_quantity === undefined || product.stock_quantity === null) {
      const error = new Error('Inventory schema is unavailable; apply migration 006_inventory_foundation.sql');
      error.code = 'INVENTORY_SCHEMA_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }

    const inserted = await client.query(
      `INSERT INTO sales (tenant_id, product_id, sale_date, quantity, created_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, product_id, sale_date) DO NOTHING
       RETURNING id, product_id, sale_date, quantity, created_at`,
      [tenant, product.id, date, numericQuantity],
    );
    if (inserted.rows.length === 0) {
      const existing = await client.query(
        'SELECT id, product_id, sale_date, quantity, created_at FROM sales WHERE tenant_id = $1 AND product_id = $2 AND sale_date = $3',
        [tenant, product.id, date],
      );
      await client.query('COMMIT');
      return { sale: existing.rows[0], product, inserted: false };
    }

    const updated = await client.query(
      `UPDATE products
       SET stock_quantity = stock_quantity - $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND stock_quantity >= $3
       RETURNING stock_quantity`,
      [tenant, product.id, numericQuantity],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { insufficientStock: true, availableStock: Number(product.stock_quantity), product };
    }
    await client.query(
      `INSERT INTO inventory_movements (tenant_id, product_id, movement_type, quantity, reason)
       VALUES ($1, $2, 'SALE', $3, 'Recorded sale')`,
      [tenant, product.id, numericQuantity],
    );
    await client.query('COMMIT');
    return {
      sale: inserted.rows[0],
      product: { ...product, stock_quantity: updated.rows[0].stock_quantity },
      inserted: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const adjustProductStockInTransaction = async (
  client, tenantId, productReference, { mode = 'adjust', quantity, reason, expectedStock },
) => {
  const tenant = await withTenant(tenantId, client);
  const resolved = await resolveProduct(tenant, productReference, client);
  if (!resolved) {
    return null;
  }
  const locked = await client.query(
    `SELECT id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at
     FROM products WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenant, resolved.id],
  );
  const product = locked.rows[0];
  if (!product || product.stock_quantity === undefined || product.stock_quantity === null) {
    const error = new Error('Inventory schema is unavailable; apply migration 006_inventory_foundation.sql');
    error.code = 'INVENTORY_SCHEMA_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  }
  const current = Number(product.stock_quantity);
  if (expectedStock !== undefined && current !== Number(expectedStock)) {
    return { staleStock: true, availableStock: current, product };
  }
  const requested = Number(quantity);
  const movementCount = await client.query(
    'SELECT COUNT(*)::int AS count FROM inventory_movements WHERE tenant_id = $1 AND product_id = $2',
    [tenant, product.id],
  );
  const isInitial = mode === 'set' && Number(movementCount.rows[0]?.count || 0) === 0;
  const delta = mode === 'set' ? requested - current : requested;
  const next = current + delta;
  if (next < 0) {
    return { insufficientStock: true, availableStock: current, product };
  }
  if (delta === 0) {
    return { product, movement: null };
  }
  const updated = await client.query(
    `UPDATE products SET stock_quantity = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND stock_quantity = $4
     RETURNING id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id, created_at, updated_at`,
    [tenant, product.id, next, current],
  );
  if (updated.rows.length === 0) {
    return { insufficientStock: true, availableStock: current, product };
  }
  const movementType = isInitial ? 'INITIAL' : delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
  const movement = await client.query(
    `INSERT INTO inventory_movements (tenant_id, product_id, movement_type, quantity, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, movement_type, quantity, reason, created_at`,
    [tenant, product.id, movementType, Math.abs(delta), String(reason).trim()],
  );
  return { product: updated.rows[0], movement: movement.rows[0] };
};

const adjustProductStock = async (tenantId, productReference, adjustment) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await adjustProductStockInTransaction(client, tenantId, productReference, adjustment);
    await client.query(result && !result.staleStock && !result.insufficientStock ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const getInventoryMovements = async (tenantId, productReference) => {
  const tenant = await withTenant(tenantId);
  const product = await resolveProduct(tenant, productReference);
  if (!product) return null;
  const result = await pool.query(
    `SELECT id, product_id, movement_type, quantity, reason, created_at
     FROM inventory_movements
     WHERE tenant_id = $1 AND product_id = $2
     ORDER BY created_at DESC`,
    [tenant, product.id],
  );
  return { product, movements: result.rows };
};

const createOrFindCsvProducts = async (client, tenantId, products) => {
  const tenant = await withTenant(tenantId, client);
  const productIdByKey = new Map();
  let created = 0;

  for (const product of products) {
    const existing = await client.query(
      'SELECT id FROM products WHERE tenant_id = $1 AND name = $2 AND category = $3 ORDER BY id LIMIT 1',
      [tenant, product.name, product.category],
    );
    const row = existing.rows[0] || (await client.query(
      `INSERT INTO products (tenant_id, name, category, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       RETURNING id`,
      [tenant, product.name, product.category],
    )).rows[0];
    if (existing.rows.length === 0) created += 1;
    productIdByKey.set(product.key, row.id);
  }

  return { productIdByKey, created };
};

const insertCsvSales = async (client, tenantId, rows, productIdByKey) => {
  const tenant = await withTenant(tenantId, client);
  let inserted = 0;
  for (const row of rows) {
    const productId = productIdByKey.get(row.productKey);
    if (!productId) throw new Error(`Product resolution failed for CSV row ${row.rowIndex}`);
    const result = await client.query(
      `INSERT INTO sales (tenant_id, product_id, sale_date, quantity, created_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, product_id, sale_date) DO NOTHING
       RETURNING id`,
      [tenant, productId, row.date, row.quantity],
    );
    inserted += result.rows.length;
  }
  return inserted;
};

const importCsvSales = async (tenantId, products, rows, metadata = {}) => {
  const tenant = requireTenantId(tenantId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureTenantSchema(client);
    const { productIdByKey, created } = await createOrFindCsvProducts(client, tenant, products);
    const salesInserted = await insertCsvSales(client, tenant, rows, productIdByKey);
    await client.query(
      `INSERT INTO data_imports (
         tenant_id, filename, records_processed, records_valid, records_invalid, status
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenant,
        String(metadata.filename || 'uploaded.csv').slice(0, 255),
        Number(metadata.recordsProcessed || rows.length),
        Number(metadata.recordsValid ?? rows.length),
        Number(metadata.recordsInvalid || 0),
        'completed',
      ],
    );
    await client.query('COMMIT');
    return { productsCreated: created, salesRecordsInserted: salesInserted };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('CSV import rollback failed:', rollbackError?.code || rollbackError?.name || 'unknown');
    }
    throw error;
  } finally {
    client.release();
  }
};

const getActiveAlertsByProductId = async (tenantId, productId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    `SELECT a.id, a.product_id, a.type, a.message, a.severity, a.percent_change, a.is_active, a.created_at
     FROM alerts a
     JOIN products p ON p.id = a.product_id AND p.tenant_id = a.tenant_id
     WHERE a.tenant_id = $1 AND a.product_id = $2 AND a.is_active = true
     ORDER BY a.created_at DESC`,
    [tenant, productId],
  );
  return result.rows;
};

const getRecentActiveAlerts = async (tenantId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(`
    SELECT a.id, a.product_id, a.type, a.message, a.severity, a.percent_change, a.is_active, a.created_at,
           p.name AS productName, p.category AS productCategory
    FROM alerts a
    LEFT JOIN products p ON a.product_id = p.id
      AND p.tenant_id = a.tenant_id
    WHERE a.tenant_id = $1 AND a.is_active = true
    ORDER BY a.created_at DESC
    LIMIT 5`, [tenant]);
  return result.rows;
};

const createAlert = async (tenantId, productReference, { type, message, severity, percentChange, isActive = true }) => {
  const tenant = await withTenant(tenantId);
  const product = await resolveProduct(tenant, productReference);
  if (!product) return null;

  const result = await pool.query(
    `INSERT INTO alerts (tenant_id, product_id, type, message, severity, percent_change, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, product_id, type, message, severity, percent_change, is_active, created_at`,
    [tenant, product.id, type, message, severity, percentChange, isActive],
  );

  return { alert: result.rows[0], product };
};

const deactivateAlertById = async (tenantId, alertId) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    `UPDATE alerts AS a
     SET is_active = false
     FROM products AS p
     WHERE a.tenant_id = $1 AND a.id = $2
       AND p.id = a.product_id AND p.tenant_id = a.tenant_id
     RETURNING a.id, a.product_id, a.type, a.message, a.severity, a.percent_change,
               a.is_active, a.created_at, p.legacy_mongo_id`,
    [tenant, alertId],
  );
  return result.rows[0] || null;
};

const deleteActiveAlertsForProduct = async (tenantId, productReference) => {
  const tenant = await withTenant(tenantId);
  const product = await resolveProduct(tenant, productReference);
  if (!product) return { product: null, deleted: 0 };

  const result = await pool.query(
    'DELETE FROM alerts WHERE tenant_id = $1 AND product_id = $2 AND is_active = true',
    [tenant, product.id],
  );
  return { product, deleted: result.rowCount };
};

const upsertAlertByProductAndType = async (
  tenantId,
  productReference,
  { type, message, severity, percentChange, isActive = true },
) => {
  const tenant = requireTenantId(tenantId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureTenantSchema(client);

    const product = await resolveProduct(tenant, productReference, client);
    if (!product) {
      await client.query('ROLLBACK');
      return null;
    }

    const existing = await client.query(
      `SELECT id FROM alerts
       WHERE tenant_id = $1 AND product_id = $2 AND type = $3
       LIMIT 1
       FOR UPDATE`,
      [tenant, product.id, type],
    );

    const result = existing.rows[0]
      ? await client.query(
        `UPDATE alerts
         SET message = $1, severity = $2, percent_change = $3, is_active = $4
         WHERE tenant_id = $5 AND id = $6
         RETURNING id, product_id, type, message, severity, percent_change, is_active, created_at`,
        [message, severity, percentChange, isActive, tenant, existing.rows[0].id],
      )
      : await client.query(
        `INSERT INTO alerts (tenant_id, product_id, type, message, severity, percent_change, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, product_id, type, message, severity, percent_change, is_active, created_at`,
        [tenant, product.id, type, message, severity, percentChange, isActive],
      );

    await client.query('COMMIT');
    return { alert: result.rows[0], product };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Alert upsert rollback failed:', rollbackError?.code || rollbackError?.name || 'unknown');
    }
    throw error;
  } finally {
    client.release();
  }
};

const getProductsByLegacyIdPattern = async (tenantId, pattern) => {
  const tenant = await withTenant(tenantId);
  const result = await pool.query(
    'SELECT id, name, category, stock_quantity, reorder_threshold, legacy_mongo_id FROM products WHERE tenant_id = $1 AND legacy_mongo_id LIKE $2 ORDER BY name',
    [tenant, pattern],
  );
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
  getSalesHistory,
  getInventoryHealthData,
  countActiveAlerts,
  countAllActiveAlerts,
  getPredictionByProductId,
  countPredictionsByProductId,
  countAllPredictions,
  upsertPrediction,
  createProduct,
  findProductByNameAndCategory,
  updateProduct,
  getProductDependencies,
  deleteProduct,
  resolveProduct,
  insertSale,
  adjustProductStock,
  adjustProductStockInTransaction,
  getInventoryMovements,
  importCsvSales,
  getActiveAlertsByProductId,
  getRecentActiveAlerts,
  createAlert,
  deactivateAlertById,
  deleteActiveAlertsForProduct,
  upsertAlertByProductAndType,
  getProductsByLegacyIdPattern,
};
