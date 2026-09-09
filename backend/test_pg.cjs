const { Pool } = require('pg');
const fs = require('fs');
const txt = fs.readFileSync('./.env', 'utf8');
const env = {};
txt.split('\n').forEach(line => {
  const idx = line.indexOf('=');
  if (idx > 0) { env[line.substring(0, idx)] = line.substring(idx + 1); }
});
const pool = new Pool({ connectionString: env.DATABASE_URL });

const runQueries = async () => {
  // Test getAllProducts
  const products = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products ORDER BY name');
  console.log('Products count:', products.rows.length);
  console.log('First 3 products:', products.rows.slice(0, 3).map(p => ({ id: p.id, name: p.name, category: p.category, legacy_mongo_id: p.legacy_mongo_id })));

  // Test getProductById
  if (products.rows.length > 0) {
    const pid = products.rows[0].id;
    const product = await pool.query('SELECT id, name, category, legacy_mongo_id FROM products WHERE id = \$1', [pid]);
    console.log('Get by ID:', product.rows[0] ? 'found' : 'not found');

    // Test getSalesByProductId
    const sales = await pool.query('SELECT id, product_id, sale_date, quantity FROM sales WHERE product_id = \$1 ORDER BY sale_date', [pid]);
    console.log('Sales for product:', sales.rows.length);

    // Test getPredictionByProductId
    const pred = await pool.query('SELECT id, product_id, predicted_demand, rule_prediction, ml_prediction, adjusted_prediction, avg_sales, percent_change, confidence, season_tag, decision, impact, keyword, score, source_headline, source_headlines, matched_keywords, reason, contributing_factors, prediction_source, predicted_at FROM predictions WHERE product_id = \$1', [pid]);
    console.log('Prediction for product:', pred.rows.length ? 'found' : 'not found');
    if (pred.rows.length > 0) {
      const p = pred.rows[0];
      console.log('  predicted_demand:', p.predicted_demand);
      console.log('  rule_prediction:', p.rule_prediction);
      console.log('  ml_prediction:', p.ml_prediction);
      console.log('  adjusted_prediction:', p.adjusted_prediction);
      console.log('  avg_sales:', p.avg_sales);
      console.log('  percent_change:', p.percent_change);
      console.log('  confidence:', p.confidence);
      console.log('  season_tag:', p.season_tag);
      console.log('  decision:', p.decision);
      console.log('  impact:', p.impact);
      console.log('  keyword:', p.keyword);
      console.log('  score:', p.score);
      console.log('  source_headline:', p.source_headline);
      console.log('  source_headlines:', p.source_headlines);
      console.log('  matched_keywords:', p.matched_keywords);
      console.log('  reason:', p.reason);
      console.log('  contributing_factors:', p.contributing_factors);
      console.log('  prediction_source:', p.prediction_source);
      console.log('  predicted_at:', p.predicted_at);
    }

    // Test getActiveAlertsByProductId
    const alerts = await pool.query('SELECT id, product_id, type, message, severity, percent_change, is_active, created_at FROM alerts WHERE product_id = \$1 AND is_active = true ORDER BY created_at DESC', [pid]);
    console.log('Active alerts for product:', alerts.rows.length);
  }

  pool.end();
  console.log('All queries completed successfully');
};

runQueries().then(() => process.exit(0)).catch(e => { console.error('Error:', e.message); pool.end(); process.exit(1); });