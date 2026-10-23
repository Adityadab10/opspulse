/**
 * ARCHIVAL ONLY — not part of the OpsPulse runtime.
 * One-time MongoDB -> PostgreSQL migration.
 *
 * OpsPulse now uses PostgreSQL/Supabase as its only runtime data store.
 * `mongoose` and `MONGO_URI` are not installed/configured at runtime.
 *
 * DRY_RUN defaults to true. In dry-run mode this script performs only MongoDB
 * reads and PostgreSQL SELECT queries; it never starts a write transaction.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Product from './models/Product.js';
import Sales from './models/Sales.js';
import Prediction from './models/Prediction.js';
import Alert from './models/Alert.js';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').trim().toLowerCase() !== 'false';
const UTC_MIDNIGHT_SUFFIX = 'T00:00:00.000Z';

const REQUIRED_SCHEMA = {
  products: ['id', 'name', 'category', 'legacy_mongo_id', 'created_at', 'updated_at'],
  sales: ['id', 'product_id', 'sale_date', 'quantity', 'created_at'],
  predictions: [
    'id', 'product_id', 'predicted_demand', 'rule_prediction', 'ml_prediction',
    'adjusted_prediction', 'avg_sales', 'percent_change', 'confidence', 'season_tag',
    'decision', 'impact', 'keyword', 'score', 'source_headline', 'source_headlines',
    'matched_keywords', 'reason', 'contributing_factors', 'prediction_source', 'predicted_at',
  ],
  alerts: ['id', 'product_id', 'type', 'severity', 'message', 'percent_change', 'is_active', 'created_at'],
  data_imports: ['id'],
};

const PREDICTION_COLUMNS = [
  'product_id', 'predicted_demand', 'rule_prediction', 'ml_prediction',
  'adjusted_prediction', 'avg_sales', 'percent_change', 'confidence', 'season_tag',
  'decision', 'impact', 'keyword', 'score', 'source_headline', 'source_headlines',
  'matched_keywords', 'reason', 'contributing_factors', 'prediction_source', 'predicted_at',
];

const PREDICTION_INSERT_SQL = `
  INSERT INTO predictions (${PREDICTION_COLUMNS.join(', ')})
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17,
    $18::jsonb, $19, $20
  )
`;

function requiredConfig() {
  const mongodbUri = process.env.MONGO_URI?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const mongoDbName = process.env.MONGO_DB_NAME?.trim();
  const missing = [];

  if (!mongodbUri) missing.push('MONGO_URI');
  if (!databaseUrl) missing.push('DATABASE_URL');
  if (missing.length > 0) {
    throw new Error(`Configuration error: missing required environment variable(s): ${missing.join(', ')}`);
  }
  return { mongodbUri, databaseUrl, mongoDbName };
}

function mongoId(value) {
  if (value === undefined || value === null) return null;
  const valueAsString = String(value).trim();
  return valueAsString.length > 0 ? valueAsString : null;
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcDate(value) {
  const date = validDate(value);
  if (!date) return null;
  const dateKey = date.toISOString().slice(0, 10);
  return { dateKey, timestamp: new Date(`${dateKey}${UTC_MIDNIGHT_SUFFIX}`) };
}

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function requiredString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function jsonValue(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return null;
  }
}

function rejection(collection, id, reason) {
  return { collection, id: mongoId(id), reason };
}

export function transformProducts(productDocs) {
  const records = [];
  const rejected = [];
  const seenMongoIds = new Set();

  for (const doc of productDocs) {
    const id = mongoId(doc._id);
    const name = requiredString(doc.name);
    const category = requiredString(doc.category);
    const createdAt = validDate(doc.createdAt);
    const updatedAt = validDate(doc.updatedAt);

    if (!id) rejected.push(rejection('products', doc._id, 'missing MongoDB _id'));
    else if (seenMongoIds.has(id)) rejected.push(rejection('products', id, 'duplicate MongoDB _id in source result'));
    else if (!name || !category) rejected.push(rejection('products', id, 'missing required name or category'));
    else if (!createdAt || !updatedAt) rejected.push(rejection('products', id, 'invalid or missing createdAt/updatedAt timestamp'));
    else {
      seenMongoIds.add(id);
      records.push({ mongoId: id, name, category, createdAt, updatedAt });
    }
  }
  return { records, rejected };
}

export function transformSales(salesDocs) {
  const grouped = new Map();
  const rejected = [];

  for (const doc of salesDocs) {
    const productMongoId = mongoId(doc.productId);
    const normalizedDate = utcDate(doc.date);
    const quantity = finiteNumber(doc.quantity);
    if (!productMongoId) {
      rejected.push(rejection('sales', doc._id, 'missing product reference'));
      continue;
    }
    if (!normalizedDate) {
      rejected.push(rejection('sales', doc._id, 'invalid sale date'));
      continue;
    }
    if (quantity === null || quantity <= 0 || !Number.isInteger(quantity)) {
      rejected.push(rejection('sales', doc._id, 'quantity must be a positive finite integer'));
      continue;
    }

    const key = `${productMongoId}__${normalizedDate.dateKey}`;
    const sourceCreatedAt = validDate(doc.createdAt) ?? normalizedDate.timestamp;
    const previous = grouped.get(key);
    if (previous) {
      previous.quantity += quantity;
      previous.sourceDocuments += 1;
      if (sourceCreatedAt < previous.createdAt) previous.createdAt = sourceCreatedAt;
    } else {
      grouped.set(key, {
        mongoProductId: productMongoId,
        dateKey: normalizedDate.dateKey,
        // UTC midnight is the canonical persisted timestamp for a UTC calendar date.
        saleDate: normalizedDate.timestamp,
        quantity,
        createdAt: sourceCreatedAt,
        sourceDocuments: 1,
      });
    }
  }

  const records = [];
  for (const record of grouped.values()) {
    if (record.quantity > 2147483647) {
      rejected.push(rejection('sales', record.mongoProductId, `aggregated quantity exceeds PostgreSQL INTEGER for ${record.dateKey}`));
    } else records.push(record);
  }
  return {
    records,
    rejected,
    duplicateDocuments: [...grouped.values()].reduce((total, record) => total + record.sourceDocuments - 1, 0),
  };
}

export function transformPredictions(predictionDocs) {
  const records = [];
  const rejected = [];
  const numericFields = [
    'predictedDemand', 'rulePrediction', 'mlPrediction', 'adjustedPrediction',
    'avgSales', 'percentChange', 'score',
  ];

  for (const doc of predictionDocs) {
    const productMongoId = mongoId(doc.productId);
    const values = Object.fromEntries(numericFields.map((field) => [field, finiteNumber(doc[field])]));
    const predictedAt = validDate(doc.predictedAt);
    const confidence = requiredString(doc.confidence);
    const seasonTag = requiredString(doc.seasonTag);
    const decision = requiredString(doc.decision);
    const impact = requiredString(doc.impact);
    const reason = requiredString(doc.reason);
    const predictionSource = requiredString(doc.predictionSource);
    const contributingFactors = jsonValue(doc.contributingFactors, []);

    if (!productMongoId) rejected.push(rejection('predictions', doc._id, 'missing product reference'));
    else if (numericFields.some((field) => values[field] === null)) {
      rejected.push(rejection('predictions', doc._id, 'one or more numeric fields are invalid'));
    } else if (!predictedAt || !confidence || !seasonTag || !decision || !impact || !reason || !predictionSource) {
      rejected.push(rejection('predictions', doc._id, 'missing or invalid required prediction field'));
    } else if (!['Low', 'Medium', 'High'].includes(confidence)
      || !['increase', 'maintain', 'reduce'].includes(decision)
      || !['increase', 'decrease', 'neutral'].includes(impact)
      || !['ml', 'rule-based'].includes(predictionSource)
      || contributingFactors === null) {
      rejected.push(rejection('predictions', doc._id, 'prediction value violates PostgreSQL constraints'));
    } else {
      records.push({
        mongoProductId: productMongoId,
        predictedDemand: values.predictedDemand,
        rulePrediction: values.rulePrediction,
        mlPrediction: values.mlPrediction,
        adjustedPrediction: values.adjustedPrediction,
        avgSales: values.avgSales,
        percentChange: values.percentChange,
        confidence,
        seasonTag,
        decision,
        impact,
        keyword: typeof doc.keyword === 'string' ? doc.keyword : null,
        score: values.score,
        sourceHeadline: typeof doc.sourceHeadline === 'string' ? doc.sourceHeadline : null,
        sourceHeadlines: JSON.stringify(jsonArray(doc.sourceHeadlines)),
        matchedKeywords: JSON.stringify(jsonArray(doc.matchedKeywords)),
        reason,
        contributingFactors,
        predictionSource,
        predictedAt,
      });
    }
  }
  return { records, rejected };
}

export function transformAlerts(alertDocs) {
  const records = [];
  const rejected = [];

  for (const doc of alertDocs) {
    const productMongoId = mongoId(doc.productId);
    const type = requiredString(doc.type);
    const severity = requiredString(doc.severity);
    const message = requiredString(doc.message);
    const percentChange = doc.percentChange === undefined || doc.percentChange === null
      ? null
      : finiteNumber(doc.percentChange);
    const createdAt = validDate(doc.createdAt);

    if (!productMongoId) rejected.push(rejection('alerts', doc._id, 'missing product reference'));
    else if (!type || !message) rejected.push(rejection('alerts', doc._id, 'missing required type or message'));
    else if (!createdAt) rejected.push(rejection('alerts', doc._id, 'invalid or missing createdAt timestamp'));
    else if (!['HIGH_DEMAND', 'LOW_DEMAND', 'TREND_UP', 'TREND_DOWN'].includes(type)) {
      rejected.push(rejection('alerts', doc._id, 'invalid alert type'));
    } else if (!severity || !['LOW', 'MEDIUM', 'HIGH'].includes(severity)) {
      rejected.push(rejection('alerts', doc._id, 'invalid or missing alert severity'));
    } else if (doc.percentChange !== undefined && doc.percentChange !== null && percentChange === null) {
      rejected.push(rejection('alerts', doc._id, 'invalid percentChange'));
    } else {
      records.push({
        mongoProductId: productMongoId,
        type,
        severity,
        message,
        percentChange,
        isActive: doc.isActive === undefined ? true : Boolean(doc.isActive),
        createdAt,
      });
    }
  }
  return { records, rejected };
}

async function readSourceDocuments() {
  const [products, sales, predictions, alerts] = await Promise.all([
    Product.find({}).lean().exec(),
    Sales.find({}).lean().exec(),
    Prediction.find({}).lean().exec(),
    Alert.find({}).lean().exec(),
  ]);
  return { products, sales, predictions, alerts };
}

function transformSource(source) {
  return {
    products: transformProducts(source.products),
    sales: transformSales(source.sales),
    predictions: transformPredictions(source.predictions),
    alerts: transformAlerts(source.alerts),
  };
}

export async function verifyPgSchema(pgClient) {
  const tableNames = Object.keys(REQUIRED_SCHEMA);
  const tables = await pgClient.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tableNames],
  );
  const foundTables = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = tableNames.filter((table) => !foundTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`PostgreSQL schema verification failed: missing table(s): ${missingTables.join(', ')}`);
  }

  const columns = await pgClient.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tableNames],
  );
  const foundColumns = new Map(tableNames.map((table) => [table, new Set()]));
  for (const row of columns.rows) foundColumns.get(row.table_name).add(row.column_name);

  const missingColumns = [];
  for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
    for (const column of requiredColumns) {
      if (!foundColumns.get(table).has(column)) missingColumns.push(`${table}.${column}`);
    }
  }
  if (missingColumns.length > 0) {
    throw new Error(`PostgreSQL schema verification failed: missing column(s): ${missingColumns.join(', ')}`);
  }
}

async function pgTableCounts(pgClient) {
  const rows = [];
  for (const table of ['products', 'sales', 'predictions', 'alerts']) {
    const result = await pgClient.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    rows.push([table, result.rows[0].count]);
  }
  return Object.fromEntries(rows);
}

async function existingProductMappings(pgClient, productRecords) {
  const mappings = new Map();
  const ambiguous = [];
  for (const product of productRecords) {
    const result = await pgClient.query(
      'SELECT id FROM products WHERE legacy_mongo_id = $1 ORDER BY id',
      [product.mongoId],
    );
    if (result.rows.length === 1) mappings.set(product.mongoId, { postgresId: result.rows[0].id, existing: true });
    else if (result.rows.length === 0) mappings.set(product.mongoId, { postgresId: null, existing: false });
    else ambiguous.push(product.mongoId);
  }
  return { mappings, ambiguous };
}

async function assessSales(pgClient, records, productMappings, ambiguousProductIds) {
  let existing = 0;
  let planned = 0;
  const orphans = [];
  for (const record of records) {
    const mapping = productMappings.get(record.mongoProductId);
    if (!mapping || ambiguousProductIds.has(record.mongoProductId)) {
      orphans.push(rejection('sales', record.mongoProductId, 'product is absent or ambiguous after product mapping'));
    } else if (!mapping.existing) planned += 1;
    else {
      const result = await pgClient.query(
        'SELECT id FROM sales WHERE product_id = $1 AND sale_date = $2',
        [mapping.postgresId, record.saleDate],
      );
      if (result.rows.length > 0) existing += 1;
      else planned += 1;
    }
  }
  return { existing, planned, orphans };
}

async function assessPredictions(pgClient, records, productMappings, ambiguousProductIds) {
  let existing = 0;
  let planned = 0;
  const orphans = [];
  for (const record of records) {
    const mapping = productMappings.get(record.mongoProductId);
    if (!mapping || ambiguousProductIds.has(record.mongoProductId)) {
      orphans.push(rejection('predictions', record.mongoProductId, 'product is absent or ambiguous after product mapping'));
    } else if (!mapping.existing) planned += 1;
    else {
      const result = await pgClient.query('SELECT id FROM predictions WHERE product_id = $1', [mapping.postgresId]);
      if (result.rows.length > 0) existing += 1;
      else planned += 1;
    }
  }
  return { existing, planned, orphans };
}

async function assessAlerts(pgClient, records, productMappings, ambiguousProductIds) {
  let existing = 0;
  let planned = 0;
  const orphans = [];
  for (const record of records) {
    const mapping = productMappings.get(record.mongoProductId);
    if (!mapping || ambiguousProductIds.has(record.mongoProductId)) {
      orphans.push(rejection('alerts', record.mongoProductId, 'product is absent or ambiguous after product mapping'));
    } else if (!mapping.existing) planned += 1;
    else {
      const result = await pgClient.query(
        `SELECT id FROM alerts
         WHERE product_id = $1 AND type = $2 AND severity = $3 AND message = $4
           AND percent_change IS NOT DISTINCT FROM $5 AND is_active = $6
         LIMIT 1`,
        [mapping.postgresId, record.type, record.severity, record.message, record.percentChange, record.isActive],
      );
      if (result.rows.length > 0) existing += 1;
      else planned += 1;
    }
  }
  return { existing, planned, orphans };
}

function printDryRunReport(source, transformed, tableCounts, productLookup, sales, predictions, alerts) {
  const allRejections = [
    ...transformed.products.rejected,
    ...transformed.sales.rejected,
    ...transformed.predictions.rejected,
    ...transformed.alerts.rejected,
    ...sales.orphans,
    ...predictions.orphans,
    ...alerts.orphans,
  ];
  console.log('\nDRY-RUN REPORT (read-only)');
  console.log('Mongo source counts:', {
    products: source.products.length, sales: source.sales.length,
    predictions: source.predictions.length, alerts: source.alerts.length,
  });
  console.log('Transformed records:', {
    products: transformed.products.records.length, sales: transformed.sales.records.length,
    predictions: transformed.predictions.records.length, alerts: transformed.alerts.records.length,
  });
  console.log('Sales duplicate source documents aggregated:', transformed.sales.duplicateDocuments);
  console.log('Existing PostgreSQL rows:', tableCounts);
  console.log('Existing matching PostgreSQL rows:', {
    products: [...productLookup.mappings.values()].filter((mapping) => mapping.existing).length,
    sales: sales.existing, predictions: predictions.existing, alerts: alerts.existing,
  });
  console.log('Expected PostgreSQL inserts:', {
    products: [...productLookup.mappings.values()].filter((mapping) => !mapping.existing).length,
    sales: sales.planned, predictions: predictions.planned, alerts: alerts.planned,
  });
  console.log('Rejected or orphaned records:', allRejections.length);
  for (const item of allRejections) console.log(`  - ${item.collection} ${item.id ?? '(unknown)'}: ${item.reason}`);
  if (productLookup.ambiguous.length > 0) {
    console.log(`Ambiguous legacy_mongo_id mappings: ${productLookup.ambiguous.join(', ')}`);
  }
}

export async function runDryRun(pgClient, source) {
  const transformed = transformSource(source);
  const tableCounts = await pgTableCounts(pgClient);
  const productLookup = await existingProductMappings(pgClient, transformed.products.records);
  const ambiguousProductIds = new Set(productLookup.ambiguous);
  const sales = await assessSales(pgClient, transformed.sales.records, productLookup.mappings, ambiguousProductIds);
  const predictions = await assessPredictions(pgClient, transformed.predictions.records, productLookup.mappings, ambiguousProductIds);
  const alerts = await assessAlerts(pgClient, transformed.alerts.records, productLookup.mappings, ambiguousProductIds);
  printDryRunReport(source, transformed, tableCounts, productLookup, sales, predictions, alerts);
  return { transformed, productLookup, sales, predictions, alerts };
}

async function resolveOrInsertProducts(pgClient, productRecords) {
  const productMap = new Map();
  for (const product of productRecords) {
    const existing = await pgClient.query(
      'SELECT id FROM products WHERE legacy_mongo_id = $1 ORDER BY id', [product.mongoId],
    );
    if (existing.rows.length > 1) {
      throw new Error(`ambiguous products.legacy_mongo_id for ${product.mongoId}`);
    }
    if (existing.rows.length === 1) {
      productMap.set(product.mongoId, existing.rows[0].id);
    } else {
      const inserted = await pgClient.query(
        `INSERT INTO products (name, category, legacy_mongo_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [product.name, product.category, product.mongoId, product.createdAt, product.updatedAt],
      );
      productMap.set(product.mongoId, inserted.rows[0].id);
    }
  }
  return productMap;
}

async function insertSales(pgClient, records, productMap) {
  for (const record of records) {
    const productId = productMap.get(record.mongoProductId);
    if (!productId) continue;
    const existing = await pgClient.query(
      'SELECT id FROM sales WHERE product_id = $1 AND sale_date = $2', [productId, record.saleDate],
    );
    if (existing.rows.length === 0) {
      await pgClient.query(
        `INSERT INTO sales (product_id, sale_date, quantity, created_at)
         VALUES ($1, $2, $3, $4)`,
        [productId, record.saleDate, record.quantity, record.createdAt],
      );
    }
  }
}

function predictionParameters(productId, record) {
  return [
    productId, record.predictedDemand, record.rulePrediction, record.mlPrediction,
    record.adjustedPrediction, record.avgSales, record.percentChange, record.confidence,
    record.seasonTag, record.decision, record.impact, record.keyword, record.score,
    record.sourceHeadline, record.sourceHeadlines, record.matchedKeywords, record.reason,
    record.contributingFactors, record.predictionSource, record.predictedAt,
  ];
}

async function insertPredictions(pgClient, records, productMap) {
  for (const record of records) {
    const productId = productMap.get(record.mongoProductId);
    if (!productId) continue;
    const existing = await pgClient.query('SELECT id FROM predictions WHERE product_id = $1', [productId]);
    if (existing.rows.length === 0) {
      await pgClient.query(PREDICTION_INSERT_SQL, predictionParameters(productId, record));
    }
  }
}

async function insertAlerts(pgClient, records, productMap) {
  for (const record of records) {
    const productId = productMap.get(record.mongoProductId);
    if (!productId) continue;
    const existing = await pgClient.query(
      `SELECT id FROM alerts
       WHERE product_id = $1 AND type = $2 AND severity = $3 AND message = $4
         AND percent_change IS NOT DISTINCT FROM $5 AND is_active = $6
       LIMIT 1`,
      [productId, record.type, record.severity, record.message, record.percentChange, record.isActive],
    );
    if (existing.rows.length === 0) {
      await pgClient.query(
        `INSERT INTO alerts (product_id, type, severity, message, percent_change, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [productId, record.type, record.severity, record.message, record.percentChange, record.isActive, record.createdAt],
      );
    }
  }
}

export async function runMigrationWrites(pgClient, transformed) {
  if (DRY_RUN) {
    console.log('DRY_RUN=true: PostgreSQL write transaction skipped.');
    return;
  }
  await pgClient.query('BEGIN');
  try {
    const productMap = await resolveOrInsertProducts(pgClient, transformed.products.records);
    await insertSales(pgClient, transformed.sales.records, productMap);
    await insertPredictions(pgClient, transformed.predictions.records, productMap);
    await insertAlerts(pgClient, transformed.alerts.records, productMap);
    await pgClient.query('COMMIT');
  } catch (error) {
    try {
      await pgClient.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(`Rollback failure: ${rollbackError.message}`);
    }
    throw new Error(`Migration write failure: ${error.message}`, { cause: error });
  }
}

export async function main() {
  const config = requiredConfig();
  let pgPool;
  let pgClient;
  let mongoConnected = false;
  try {
    pgPool = new Pool({ connectionString: config.databaseUrl });
    try {
      pgClient = await pgPool.connect();
    } catch (error) {
      throw new Error(`PostgreSQL connection failure: ${error.message}`, { cause: error });
    }
    try {
      await verifyPgSchema(pgClient);
    } catch (error) {
      throw new Error(`PostgreSQL schema verification failure: ${error.message}`, { cause: error });
    }
    try {
      const mongoOptions = config.mongoDbName ? { dbName: config.mongoDbName } : {};
      await mongoose.connect(config.mongodbUri, { ...mongoOptions, autoIndex: false, autoCreate: false });
      mongoConnected = true;
    } catch (error) {
      throw new Error(`MongoDB connection failure: ${error.message}`, { cause: error });
    }

    const source = await readSourceDocuments();
    if (DRY_RUN) await runDryRun(pgClient, source);
    else await runMigrationWrites(pgClient, transformSource(source));
  } finally {
    if (mongoConnected) {
      try {
        await mongoose.disconnect();
      } catch (error) {
        console.error(`MongoDB cleanup failure: ${error.message}`);
      }
    }
    if (pgClient) pgClient.release();
    if (pgPool) {
      try {
        await pgPool.end();
      } catch (error) {
        console.error(`PostgreSQL cleanup failure: ${error.message}`);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
