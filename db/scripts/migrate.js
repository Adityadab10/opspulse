/**
 * MongoDB → PostgreSQL Migration Tool
 * Phase 3 — OpsPulse Migration Engineering
 * 
 * THIS SCRIPT SUPPORTS DRY-RUN MODE ONLY.
 * It does NOT write to either database during dry-run.
 * 
 * To actual migrate, the migration execution logic would need
 * to be enabled (not part of this task).
 */

import { Pool } from 'pg';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

// Configuration
const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://sinonrodrigues1310_db_user:Qsy3l2DeGr3D5NSK@inventory-intelligence.obpf9ma.mongodb.net/?appName=Inventory-Intelligence';
const DB_NAME = process.env.MONGO_DB_NAME || 'inventory-intelligence';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.pcefxrhnzqlgpscnkypg:081JvmhIo9ETGwld@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';

const DRY_RUN = true; // Set to false ONLY with explicit authorization

// MongoDB model imports (dynamic import for ESM compatibility)
const collections = {
  products: null,
  sales: null,
  predictions: null,
  alerts: null,
};

async function main() {
  console.log('='.repeat(60));
  console.log('OpsPulse: MongoDB → PostgreSQL Migration Tool');
  console.log('='.repeat(60));
  console.log(`DRY_RUN mode: ${DRY_RUN}`);
  console.log('');

  // Connect to PostgreSQL
  console.log('1. Connecting to PostgreSQL...');
  const pgPool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    const pgClient = await pgPool.connect();
    console.log('   ✅ PostgreSQL connected');
    
    // Verify PostgreSQL schema
    console.log('   Verifying PostgreSQL schema...');
    await verifyPgSchema(pgClient);
    
    // Attempt MongoDB connection
    console.log('\\n2. Attempting MongoDB connection...');
    let mongoConnected = false;
    let mongoError = null;
    
    try {
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
      });
      mongoConnected = true;
      console.log('   ✅ MongoDB connected');
      
      // Load models
      const Product = mongoose.model('Product');
      const Sales = mongoose.model('Sales');
      const Prediction = mongoose.model('Prediction');
      const Alert = mongoose.model('Alert');
      
      // Run dry-run analysis
      console.log('\\n3. Running DRY-RUN migration analysis...');
      await runDryRun(pgClient, Product, Sales, Prediction, Alert);
      
      // Close MongoDB
      await mongoose.disconnect();
      console.log('   ✅ MongoDB disconnected');
      
    } catch (mongoErr) {
      mongoError = mongoErr;
      console.log('   ⚠️ MongoDB connection failed (expected in some environments):');
      console.log(`      ${mongoError.message}`);
      console.log('   ' + '-'.repeat(55));
      console.log('   Continuing with structural analysis only...');
      console.log('');
      
      // Still run PostgreSQL-side validation
      await verifyPgSchema(pgClient);
      await runDryRunSchemaOnly(pgClient);
    }
    
  } catch (pgErr) {
    console.error('❌ PostgreSQL connection failed:', pgErr.message);
    process.exit(1);
  } finally {
    await pgPool.end();
    console.log('\\n✅ PostgreSQL pool closed');
  }
  
  console.log('\\n' + '='.repeat(60));
  console.log('Migration analysis complete');
  console.log('='.repeat(60));
}

async function verifyPgSchema(pgClient) {
  console.log('   Checking PostgreSQL tables exist...');
  
  const tables = ['products', 'sales', 'predictions', 'alerts', 'data_imports'];
  for (const table of tables) {
    try {
      const result = await pgClient.query(
        `SELECT COUNT(*) AS cnt FROM ${table} LIMIT 1`
      );
      console.log(`   ✅ Table "${table}" exists and is accessible`);
    } catch (err) {
      console.log(`   ❌ Table "${table}" not found: ${err.message}`);
    }
  }
}

async function runDryRunSchemaOnly(pgClient) {
  // Report the schema structure without reading MongoDB data
  console.log('   Generating schema report from PostgreSQL...');
  
  const reports = {};
  
  for (const table of ['products', 'sales', 'predictions', 'alerts']) {
    try {
      const cols = await pgClient.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${table}'
        ORDER BY ordinal_position
      `);
      const fks = await pgClient.query(`
        SELECT kcu.column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = '${table}' AND tc.constraint_type = 'FOREIGN KEY'
      `);
      const uks = await pgClient.query(`
        SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '${table}' AND indexname LIKE '_%key%' ORDER BY indexname
      `);
      const ccks = await pgClient.query(`
        SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'c' AND schemaname = 'public' AND table_name = '${table}' ORDER BY conname
      `);
      
      reports[table] = {
        columns: cols.rows,
        foreignKeys: fks.rows,
        uniqueIndexes: uks.rows,
        checkConstraints: ccks.rows,
      };
    } catch (err) {
      reports[table] = { error: err.message };
    }
  }
  
  console.log('\\nPostgreSQL Schema Report:');
  console.log(JSON.stringify(reports, null, 2));
}

async function runDryRun(pgClient, Product, Sales, Prediction, Alert) {
  // This is the main dry-run analysis
  // It reads MongoDB data, transforms in memory, and reports what would be inserted
  // but does NOT write to either database
  
  console.log('   Reading MongoDB source data...');
  
  // --- PRODUCTS ---
  console.log('\\n1. ANALYZING PRODUCTS');
  console.log('   ' + '-'.repeat(55));
  
  let productSourceCount = 0;
  const productNormalizedMap = new Map(); // lowercase name+category → product info
  const productDuplicates = [];
  const productInvalid = [];
  const productLegacyIds = [];
  
  try {
    const productDocs = await Product.find({}, '_id name category legacy_mongoId').lean().exec();
    productSourceCount = productDocs.length;
    console.log(`   Source product records: ${productSourceCount}`);
    
    for (const doc of productDocs) {
      const name = doc.name || '';
      const category = doc.category || '';
      const legacyId = doc.legacy_mongoId || doc._id?.toString() || null;
      const normalizedKey = `${name.toLowerCase()}__${category.toLowerCase()}`;
      
      if (!name || !category) {
        productInvalid.push({
          reason: 'missing name or category',
          source: doc._id,
          data: doc,
        });
        continue;
      }
      
      if (productNormalizedMap.has(normalizedKey)) {
        const existing = productNormalizedMap.get(normalizedKey);
        productDuplicates.push({
          existing,
          new: { ...doc, _id: doc._id.toString() },
          normalizedKey,
        });
      } else {
        productNormalizedMap.set(normalizedKey, {
          ...doc,
          _id: doc._id.toString(),
          normalizedKey,
        });
        if (legacyId) productLegacyIds.push({ legacyId, normalizedKey, source: doc._id });
      }
    }
  } catch (err) {
    console.error('   ❌ Error reading products:', err.message);
  }
  
  console.log(`   Unique normalized products: ${productNormalizedMap.size}`);
  console.log(`   Duplicate normalized products: ${productDuplicates.length}`);
  console.log(`   Invalid products: ${productInvalid.length}`);
  console.log(`   Legacy ID mappings: ${productLegacyIds.length}`);
  
  // --- SALES ---
  console.log('\\n2. ANALYZING SALES');
  console.log('   ' + '-'.repeat(55));
  
  let salesSourceCount = 0;
  const salesValid = [];
  const salesDuplicateProductDate = [];
  const salesInvalidQuantity = [];
  const salesInvalidDate = [];
  const salesOrphanedProduct = [];
  
  try {
    const salesDocs = await Sales.find({}, 'productId date quantity').sort({ date: 1 }).lean().exec();
    salesSourceCount = salesDocs.length;
    console.log(`   Source sales records: ${salesSourceCount}`);
    
    // Build productId → product existence map
    const productIds = [...new Set(salesDocs.map(s => s.productId.toString()))];
    const products = await Product.find({ _id: { $in: productIds } }).lean().exec();
    const productMap = new Map();
    for (const p of products) {
      productMap.set(p._id.toString(), { name: p.name, category: p.category });
    }
    
    for (const doc of salesDocs) {
      const productId = doc.productId.toString();
      const productExists = productMap.has(productId);
      
      // Validate quantity
      const quantity = doc.quantity;
      if (quantity === undefined || quantity === null || quantity <= 0 || !Number.isFinite(quantity)) {
        salesInvalidQuantity.push({ ...doc, quantity, reason: 'invalid quantity' });
        continue;
      }
      
      // Validate date
      const date = doc.date;
      let dateOk = true;
      if (!date) {
        dateOk = false;
      } else if (typeof date === 'string') {
        // Check if it's a valid date string
        const parsed = new Date(date);
        if (isNaN(parsed.getTime())) dateOk = false;
      } else if (!(date instanceof Date) || isNaN(date.getTime())) {
        dateOk = false;
      }
      
      if (!dateOk) {
        salesInvalidDate.push({ ...doc, date, reason: 'invalid date' });
        continue;
      }
      
      // Check for duplicate product+date
      const saleDate = typeof doc.date === 'string' ? new Date(doc.date) : doc.date;
      const dateKey = saleDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      const dupKey = `${productId}__${dateKey}`;
      
      if (salesValid.some(s => s.dateKey === dateKey && s.productId === productId)) {
        salesDuplicateProductDate.push({
          ...doc,
          dateKey,
          duplicateKey: dupKey,
          reason: 'duplicate product/date',
        });
        continue;
      }
      
      salesValid.push({
        ...doc,
        productId,
        dateKey,
        productExists,
        dateISO: dateKey,
      });
    }
  } catch (err) {
    console.error('   ❌ Error reading sales:', err.message);
  }
  
  console.log(`   Source sales records: ${salesSourceCount}`);
  console.log(`   Valid sales: ${salesValid.length}`);
  console.log(`   Duplicate product/date: ${salesDuplicateProductDate.length}`);
  console.log(`   Invalid quantity: ${salesInvalidQuantity.length}`);
  console.log(`   Invalid date: ${salesInvalidDate.length}`);
  
  // --- PREDICTIONS ---
  console.log('\\n3. ANALYZING PREDICTIONS');
  console.log('   ' + '-'.repeat(55));
  
  let predictionSourceCount = 0;
  const predictionValid = [];
  const predictionOrphanedProduct = [];
  const predictionInvalidEnum = [];
  
  try {
    const predictionDocs = await Prediction.find({}).lean().exec();
    predictionSourceCount = predictionDocs.length;
    console.log(`   Source prediction records: ${predictionSourceCount}`);
    
    // Build productId → product existence map
    const productIds = [...new Set(predictionDocs.map(p => p.productId.toString()))];
    const products = await Product.find({ _id: { $in: productIds } }).lean().exec();
    const productExistsMap = new Map();
    for (const p of products) {
      productExistsMap.set(p._id.toString(), true);
    }
    
    for (const doc of predictionDocs) {
      const productId = doc.productId.toString();
      const productExists = productExistsMap.has(productId);
      
      if (!productExists) {
        predictionOrphanedProduct.push({
          ...doc,
          productId,
          reason: 'orphaned product reference',
        });
        continue;
      }
      
      // Validate enum fields
      const validConfidence = ['Low', 'Medium', 'High'].includes(doc.confidence || '');
      const validDecision = ['increase', 'maintain', 'reduce'].includes(doc.decision || '');
      const validImpact = ['increase', 'decrease', 'neutral'].includes(doc.impact || '');
      
      if (!validConfidence) predictionInvalidEnum.push({ ...doc, reason: 'invalid confidence' });
      if (!validDecision) predictionInvalidEnum.push({ ...doc, reason: 'invalid decision' });
      if (!validImpact) predictionInvalidEnum.push({ ...doc, reason: 'invalid impact' });
      
      predictionValid.push({
        ...doc,
        productId,
        productExists,
      });
    }
  } catch (err) {
    console.error('   ❌ Error reading predictions:', err.message);
  }
  
  console.log(`   Source prediction records: ${predictionSourceCount}`);
  console.log(`   Valid predictions: ${predictionValid.length}`);
  console.log(`   Orphaned product references: ${predictionOrphanedProduct.length}`);
  console.log(`   Invalid enum values: ${predictionInvalidEnum.length}`);
  
  // --- ALERTS ---
  console.log('\\n4. ANALYZING ALERTS');
  console.log('   ' + '-'.repeat(55));
  
  let alertSourceCount = 0;
  const alertValid = [];
  const alertOrphanedProduct = [];
  const alertInvalidEnum = [];
  
  try {
    const alertDocs = await Alert.find({}).lean().exec();
    alertSourceCount = alertDocs.length;
    console.log(`   Source alert records: ${alertSourceCount}`);
    
    // Build productId → product existence map
    const productIds = [...new Set(alertDocs.map(a => a.productId.toString()))];
    const products = await Product.find({ _id: { $in: productIds } }).lean().exec();
    const productExistsMap = new Map();
    for (const p of products) {
      productExistsMap.set(p._id.toString(), true);
    }
    
    for (const doc of alertDocs) {
      const productId = doc.productId.toString();
      const productExists = productExistsMap.has(productId);
      
      if (!productExists) {
        alertOrphanedProduct.push({
          ...doc,
          productId,
          reason: 'orphaned product reference',
        });
        continue;
      }
      
      // Validate enum fields
      const validSeverity = ['LOW', 'MEDIUM', 'HIGH'].includes(doc.severity || '');
      const validType = ['HIGH_DEMAND', 'LOW_DEMAND', 'TREND_UP', 'TREND_DOWN'].includes(doc.type || '');
      
      if (!validSeverity) alertInvalidEnum.push({ ...doc, reason: 'invalid severity' });
      if (!validType) alertInvalidEnum.push({ ...doc, reason: 'invalid type' });
      
      alertValid.push({
        ...doc,
        productId,
        productExists,
      });
    }
  } catch (err) {
    console.error('   ❌ Error reading alerts:', err.message);
  }
  
  console.log(`   Source alert records: ${alertSourceCount}`);
  console.log(`   Valid alerts: ${alertValid.length}`);
  console.log(`   Orphaned product references: ${alertOrphanedProduct.length}`);
  console.log(`   Invalid enum values: ${alertInvalidEnum.length}`);
  
  // --- SUMMARY ---
  console.log('\\n5. SUMMARY');
  console.log('   ' + '-'.repeat(55));
  console.log(`   Source products:      ${productSourceCount}`);
  console.log(`   Target products:      ${productNormalizedMap.size} unique (after dedup)`);
  console.log(`   Source sales:         ${salesSourceCount}`);
  console.log(`   Valid sales:          ${salesValid.length}`);
  console.log(`   Source predictions:   ${predictionSourceCount}`);
  console.log(`   Valid predictions:    ${predictionValid.length}`);
  console.log(`   Source alerts:        ${alertSourceCount}`);
  console.log(`   Valid alerts:         ${alertValid.length}`);
  console.log('');
  console.log('   DRY-RUN: No data was written to either database');
  console.log('   DRY-RUN: Results above show what WOULD be migrated');
}

// Run main
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});