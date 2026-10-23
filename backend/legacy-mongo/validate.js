/**
 * ARCHIVAL ONLY — not part of the OpsPulse runtime.
 * MongoDB -> PostgreSQL Migration Validation
 * Validates that migration completed correctly by comparing source and target counts
 * and checking field-level consistency.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || 'inventory-intelligence';
const DATABASE_URL = process.env.DATABASE_URL;

const DRY_RUN = true;

async function main() {
  console.log('='.repeat(60));
  console.log('OpsPulse: Migration Validation');
  console.log('='.repeat(60));
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log('');

  // Connect PostgreSQL
  const pgPool = new Pool({ connectionString: DATABASE_URL });
  const pgClient = await pgPool.connect();

  try {
    // Connect MongoDB
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    
    const Product = mongoose.model('Product');
    const Sales = mongoose.model('Sales');
    const Prediction = mongoose.model('Prediction');
    const Alert = mongoose.model('Alert');

    // === PRODUCTS VALIDATION ===
    console.log('1. PRODUCTS VALIDATION');
    console.log('   ' + '-'.repeat(55));
    
    const srcProductCount = await Product.countDocuments({});
    const tgtProductCount = await pgClient.query(`
      SELECT COUNT(*) AS cnt FROM products
    `);
    
    console.log(`   Source product count:  ${srcProductCount}`);
    console.log(`   Target product count:  ${tgtProductCount.rows[0].cnt}`);
    console.log(`   Match: ${srcProductCount === Number(tgtProductCount.rows[0].cnt) ? 'YES' : 'NO'}`);
    
    // Check for orphaned legacy_mongo_id entries
    const productsWithLegacy = await Product.find({ legacy_mongo_id: { $exists: true } }).lean().exec();
    console.log(`   Products with legacy_mongo_id: ${productsWithLegacy.length}`);
    
    // === SALES VALIDATION ===
    console.log('\\n2. SALES VALIDATION');
    console.log('   ' + '-'.repeat(55));
    
    const srcSalesCount = await Sales.countDocuments({});
    const tgtSalesCount = await pgClient.query(`SELECT COUNT(*) AS cnt FROM sales`);
    
    console.log(`   Source sales count:    ${srcSalesCount}`);
    console.log(`   Target sales count:    ${tgtSalesCount.rows[0].cnt}`);
    console.log(`   Match: ${srcSalesCount === Number(tgtSalesCount.rows[0].cnt) ? 'YES' : 'NO'}`);
    
    // Validate product/date uniqueness in PostgreSQL
    const salesUniqueness = await pgClient.query(`
      SELECT product_id, sale_date, COUNT(*) AS cnt
      FROM sales
      GROUP BY product_id, sale_date
      HAVING COUNT(*) > 1
    `);
    console.log(`   Duplicate product/date in target: ${salesUniqueness.rows.length}`);
    if (salesUniqueness.rows.length > 0) {
      salesUniqueness.rows.forEach(r => console.log(`     product_id=${r.product_id}, sale_date=${r.sale_date}, count=${r.cnt}`));
    }
    
    // === PREDICTIONS VALIDATION ===
    console.log('\\n3. PREDICTIONS VALIDATION');
    console.log('   ' + '-'.repeat(55));
    
    const srcPredictionCount = await Prediction.countDocuments({});
    const tgtPredictionCount = await pgClient.query(`SELECT COUNT(*) AS cnt FROM predictions`);
    
    console.log(`   Source prediction count: ${srcPredictionCount}`);
    console.log(`   Target prediction count: ${tgtPredictionCount.rows[0].cnt}`);
    console.log(`   Match: ${srcPredictionCount === Number(tgtPredictionCount.rows[0].cnt) ? 'YES' : 'NO'}`);
    
    // Check for orphaned product references
    const orphanedPreds = await pgClient.query(`
      SELECT COUNT(*) AS cnt FROM predictions p
      LEFT JOIN products prod ON p.product_id = prod.id
      WHERE prod.id IS NULL
    `);
    console.log(`   Orphaned prediction references: ${orphanedPreds.rows[0].cnt}`);
    
    // Validate enum values
    const invalidConfidence = await pgClient.query(`
      SELECT COUNT(*) AS cnt FROM predictions 
      WHERE confidence NOT IN ('Low', 'Medium', 'High')
    `);
    const invalidDecision = await pgClient.query(`
      SELECT COUNT(*) AS cnt FROM predictions 
      WHERE decision NOT IN ('increase', 'maintain', 'reduce')
    `);
    const invalidImpact = await pgClient.query(`
      SELECT COUNT(*) AS cnt FROM predictions 
      WHERE impact NOT IN ('increase', 'decrease', 'neutral')
    `);
    console.log(`   Invalid confidence values: ${invalidConfidence.rows[0].cnt}`);
    console.log(`   Invalid decision values: ${invalidDecision.rows[0].cnt}`);
    console.log(`   Invalid impact values: ${invalidImpact.rows[0].cnt}`);
    
    // === ALERTS VALIDATION ===
    console.log('\\n4. ALERTS VALIDATION');
    console.log('   ' + '-'.repeat(55));
    
    const srcAlertCount = await Alert.countDocuments({});
    const tgtAlertCount = await pgClient.query(`SELECT COUNT(*) AS cnt FROM alerts`);
    
    console.log(`   Source alert count:    ${srcAlertCount}`);
    console.log(`   Target alert count:    ${tgtAlertCount.rows[0].cnt}`);
    console.log(`   Match: ${srcAlertCount === Number(tgtAlertCount.rows[0].cnt) ? 'YES' : 'NO'}`);
    
    // Check for orphaned product references
    const orphanedAlerts = await pgClient.query(`
      SELECT COUNT(*) AS cnt FROM alerts a
      LEFT JOIN products prod ON a.product_id = prod.id
      WHERE prod.id IS NULL
    `);
    console.log(`   Orphaned alert product references: ${orphanedAlerts.rows[0].cnt}`);
    
    // Validate enum values
    const invalidSeverity = await pgClient.query(`
      SELECT COUNT(*) AS cnt FROM alerts 
      WHERE severity NOT IN ('LOW', 'MEDIUM', 'HIGH')
    `);
    const invalidType = await pgClient.query(`
      SELECT COUNT(*) AS cnt FROM alerts 
      WHERE type NOT IN ('HIGH_DEMAND', 'LOW_DEMAND', 'TREND_UP', 'TREND_DOWN')
    `);
    console.log(`   Invalid severity values: ${invalidSeverity.rows[0].cnt}`);
    console.log(`   Invalid type values: ${invalidType.rows[0].cnt}`);
    
    // === SUMMARY ===
    console.log('\\n5. VALIDATION SUMMARY');
    console.log('   ' + '-'.repeat(55));
    const allChecks = [
      { name: 'Product count match', pass: srcProductCount === Number(tgtProductCount.rows[0].cnt) },
      { name: 'Sales count match', pass: srcSalesCount === Number(tgtSalesCount.rows[0].cnt) },
      { name: 'Prediction count match', pass: srcPredictionCount === Number(tgtPredictionCount.rows[0].cnt) },
      { name: 'Alert count match', pass: srcAlertCount === Number(tgtAlertCount.rows[0].cnt) },
      { name: 'No duplicate product/date in sales', pass: salesUniqueness.rows.length === 0 },
      { name: 'No orphaned prediction refs', pass: orphanedPreds.rows[0].cnt === 0 },
      { name: 'No orphaned alert refs', pass: orphanedAlerts.rows[0].cnt === 0 },
      { name: 'All confidence values valid', pass: invalidConfidence.rows[0].cnt === 0 },
      { name: 'All decision values valid', pass: invalidDecision.rows[0].cnt === 0 },
      { name: 'All impact values valid', pass: invalidImpact.rows[0].cnt === 0 },
      { name: 'All severity values valid', pass: invalidSeverity.rows[0].cnt === 0 },
      { name: 'All type values valid', pass: invalidType.rows[0].cnt === 0 },
    ];
    
    let passed = 0;
    allChecks.forEach(c => { if (c.pass) passed++; });
    
    console.log(`   Checks passed: ${passed}/${allChecks.length}`);
    allChecks.forEach(c => {
      console.log(`   ${c.pass ? '✅' : '❌'} ${c.name}`);
    });
    
    const totalPasses = allChecks.filter(c => c.pass).length;
    const totalChecks = allChecks.length;
    console.log(`\\n   Overall: ${totalPasses}/${totalChecks} valid`);
    
  } catch (err) {
    console.error('❌ Validation error:', err.message);
    console.error(err.stack);
  } finally {
    await pgPool.end();
    await mongoose.disconnect();
    console.log('\\n✅ Connections closed');
  }
}

main().catch(err => {
  console.error('Fatal validation error:', err);
  process.exit(1);
});