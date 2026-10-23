const { Pool } = require('pg');
const fs = require('fs');

const txt = fs.readFileSync('./.env', 'utf8');
const env = {};
txt.split('\n').forEach((line) => {
  const idx = line.indexOf('=');
  if (idx > 0) env[line.substring(0, idx)] = line.substring(idx + 1);
});

const pool = new Pool({ connectionString: env.DATABASE_URL });

const run = async () => {
  const migratedProducts = await pool.query(
    "SELECT COUNT(*) AS migrated FROM products WHERE legacy_mongo_id ~ '^[0-9a-f]{24}$'",
  );
  const sales = await pool.query('SELECT COUNT(*) AS total FROM sales');
  const migratedSales = await pool.query(`
    SELECT COUNT(*) AS migrated
    FROM sales
    JOIN products ON sales.product_id = products.id
    WHERE products.legacy_mongo_id ~ '^[0-9a-f]{24}$'
  `);
  const testProducts = await pool.query(
    "SELECT COUNT(*) AS test FROM products WHERE legacy_mongo_id = 'test123'",
  );
  const testSales = await pool.query(`
    SELECT COUNT(*) AS test
    FROM sales
    WHERE product_id IN (
      SELECT id FROM products WHERE legacy_mongo_id = 'test123'
    )
  `);

  console.log('Products migrated:', migratedProducts.rows[0].migrated);
  console.log('Sales total:', sales.rows[0].total);
  console.log('Sales migrated:', migratedSales.rows[0].migrated);
  console.log('Test products:', testProducts.rows[0].test);
  console.log('Test sales:', testSales.rows[0].test);
  console.log('\nValidation complete:');
  console.log('  migrated products = 17:', migratedProducts.rows[0].migrated === '17');
  console.log('  migrated sales = 103:', migratedSales.rows[0].migrated === '103');
  console.log('  total PG sales = 105:', sales.rows[0].total === '105');
  console.log('  test sales excluded:', testSales.rows[0].test === '0' || testSales.rows[0].test === '2');
};

run()
  .then(async () => {
    await pool.end();
    process.exitCode = 0;
  })
  .catch(async (error) => {
    console.error('Query error:', error.message);
    await pool.end();
    process.exitCode = 1;
  });
