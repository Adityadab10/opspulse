const { Pool } = require('pg');
const fs = require('fs');
const txt = fs.readFileSync('./.env', 'utf8');
const env = {};
txt.split('\n').forEach(line => { const idx = line.indexOf('='); if (idx > 0) { env[line.substring(0, idx)] = line.substring(idx + 1); } });
const pool = new Pool({ connectionString: env.DATABASE_URL });

const runQueries = async () => {
  // Test migrated product count (legacy_mongo_id is 24 hex chars)
  const migratedProducts = await pool.query("SELECT COUNT(*) AS cnt FROM products WHERE LENGTH(legacy_mongo_id) = 24 AND legacy_mongo_id ~ '^[0-9a-f]*'");
  console.log('Migrated products (legacy_mongo_id is 24 hex chars):', migratedProducts.rows[0].cnt);
  
  // Test test product count (legacy_mongo_id = test123)
  const testProducts = await pool.query('SELECT COUNT(*) AS cnt FROM products WHERE legacy_mongo_id = $1', ['test123']);
  console.log('Test products (legacy_mongo_id = test123):', testProducts.rows[0].cnt);
  
  // Test migrated sales count (product_id matches UUID pattern)
  const migratedSales = await pool.query("SELECT COUNT(*) AS cnt FROM sales WHERE product_id ~ '^[0-9a-f-]{36}$'");
  console.log('Migrated sales (product_id matches UUID pattern):', migratedSales.rows[0].cnt);
  
  // Test all counts
  const allProducts = await pool.query('SELECT COUNT(*) AS cnt FROM products');
  const allSales = await pool.query('SELECT COUNT(*) AS cnt FROM sales');
  const allPredictions = await pool.query('SELECT COUNT(*) AS cnt FROM predictions');
  const allAlerts = await pool.query('SELECT COUNT(*) AS cnt FROM alerts');
  console.log('All products:', allProducts.rows[0].cnt);
  console.log('All sales:', allSales.rows[0].cnt);
  console.log('All predictions:', allPredictions.rows[0].cnt);
  console.log('All alerts:', allAlerts.rows[0].cnt);
  
  pool.end();
  console.log('\\nAll queries completed successfully');
};

runQueries().then(() => process.exit(0)).catch(e => { console.error('Error:', e.message); pool.end(); process.exit(1); });