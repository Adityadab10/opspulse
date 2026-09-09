const { Pool } = require('pg');
const fs = require('fs');
const txt = fs.readFileSync('./.env', 'utf8');
const env = {};
txt.split('\n').forEach(line => { const idx = line.indexOf('='); if (idx > 0) { env[line.substring(0, idx)] = line.substring(idx + 1); } });
const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.query('SELECT id, product_id, sale_date, quantity FROM sales ORDER BY product_id, sale_date').then(r => {
  console.log('All sales:');
  r.rows.forEach(s => {
    const productRes = s.product_id ? 'has product' : 'no product';
    console.log(`  product_id=${s.product_id}, date=${s.sale_date}, qty=${s.quantity} | ${productRes}`);
  });
  
  // Check sales by product
  const products = [...new Set(r.rows.map(s => s.product_id))];
  console.log(`\nUnique product_ids in sales: ${products.length}`);
  
  products.forEach(pid => {
    const productSales = r.rows.filter(s => s.product_id === pid);
    console.log(`  Product ${pid}: ${productSales.length} sales`);
    productSales.forEach(s => {
      const hasLegacy = /^69/.test(s.product_id) ? 'migrated' : 'test/other';
      console.log(`    date=${s.sale_date}, qty=${s.quantity} [${hasLegacy}]`);
    });
  });
  
  pool.end();
}).catch(e => { console.error('Error:', e.message); pool.end(); process.exit(1); });