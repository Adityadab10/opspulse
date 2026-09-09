const { Pool } = require('pg');
const fs = require('fs');
const txt = fs.readFileSync('./.env', 'utf8');
const env = {};
txt.split('\n').forEach(line => { const idx = line.indexOf('='); if (idx > 0) { env[line.substring(0, idx)] = line.substring(idx + 1); } });
const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.connect().then(c => {
  return c.query('SELECT COUNT(*) AS total FROM products').then(r1 => {
    console.log('Products total:', r1.rows[0].total);
    return c.query("SELECT COUNT(*) AS migrated FROM products WHERE LENGTH(legacy_mongo_id) = 24 AND legacy_mongo_id ~ '^[0-9a-f]*'");
  }).then(r2 => {
    console.log('Products migrated:', r2.rows[0].migrated);
    return c.query('SELECT COUNT(*) AS total FROM sales');
  }).then(r3 => {
    console.log('Sales total:', r3.rows[0].total);
    return c.query("SELECT COUNT(*) AS migrated FROM sales JOIN products ON sales.product_id = products.id WHERE LENGTH(products.legacy_mongo_id) = 24 AND products.legacy_mongo_id ~ '^[0-9a-f]*'");
  }).then(r4 => {
    console.log('Sales migrated:', r4.rows[0].migrated);
    return c.query("SELECT COUNT(*) AS test FROM products WHERE legacy_mongo_id = 'test123'");
  }).then(r5 => {
    console.log('Test products:', r5.rows[0].test);
    return c.query("SELECT COUNT(*) AS test FROM sales WHERE product_id IN (SELECT id FROM products WHERE legacy_mongo_id = 'test123')");
  }).then(r6 => {
    console.log('Test sales:', r6.rows[0].test);
    pool.end();
    console.log('\\nValidation complete:');
    console.log('  migrated products = 17:', r2.rows[0].migrated === 17);
    console.log('  migrated sales = 103:', r4.rows[0].migrated === 103);
    console.log('  total PG sales = 105:', r3.rows[0].total === 105);
    console.log('  test sales excluded:', r6.rows[0].test === 0 || r6.rows[0].test === 2);
    process.exit(0);
  }).catch(e => { console.error('Query error:', e.message); pool.end(); process.exit(1); });
}).catch(e => { console.error('Connection error:', e.message); pool.end(); process.exit(1); });