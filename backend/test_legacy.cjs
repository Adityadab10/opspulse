const { Pool } = require('pg');
const fs = require('fs');
const txt = fs.readFileSync('./.env', 'utf8');
const env = {};
txt.split('\n').forEach(line => { const idx = line.indexOf('='); if (idx > 0) { env[line.substring(0, idx)] = line.substring(idx + 1); } });
const pool = new Pool({ connectionString: env.DATABASE_URL });

const run = async () => {
  try {
    const result = await pool.query(
      'SELECT id, name, category, legacy_mongo_id FROM products ORDER BY name',
    );

    console.log('All products:');
    result.rows.forEach((p) => {
      const hasLegacy = p.legacy_mongo_id ? 'yes' : 'NO';
      console.log(`  ${p.name} (${p.category}): legacy_mongo_id = ${hasLegacy} ${p.legacy_mongo_id || ''}`);
    });

    const noLegacy = result.rows.filter((p) => !p.legacy_mongo_id);
    console.log(`\nProducts without legacy_mongo_id: ${noLegacy.length}`);
    noLegacy.forEach((p) => console.log(`  - ${p.name} (${p.category})`));
  } finally {
    await pool.end();
  }
};

run().catch((e) => {
  console.error('Error:', e.message);
  process.exitCode = 1;
});