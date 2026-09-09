const { Pool } = require('pg');
const fs = require('fs');
const txt = fs.readFileSync('./.env', 'utf8');
const env = {};
txt.split('\n').forEach(line => { const idx = line.indexOf('='); if (idx > 0) { env[line.substring(0, idx)] = line.substring(idx + 1); } });
const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.query('SELECT id, name, category, legacy_mongo_id FROM products ORDER BY name').then(r => {
  console.log('All products:');
  r.rows.forEach(p => {
    const hasLegacy = p.legacy_mongo_id ? 'yes' : 'NO';
    console.log(`  ${p.name} (${p.category}): legacy_mongo_id = ${hasLegacy} ${p.legacy_mongo_id || ''}`);
  });
  
  // Check which have no legacy_mongo_id
  const noLegacy = r.rows.filter(p => !p.legacy_mongo_id);
  console.log(`\nProducts without legacy_mongo_id: ${noLegacy.length}`);
  noLegacy.forEach(p => console.log(`  - ${p.name} (${p.category})`));
  
  pool.end();
}).catch(e => { console.error('Error:', e.message); pool.end(); process.exit(1); });