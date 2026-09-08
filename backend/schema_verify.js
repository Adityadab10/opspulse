import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgresql://postgres.pcefxrhnzqlgpscnkypg:081JvmhIo9ETGwld@aws-0-ap-south-1.pooler.supabase.com:5432/postgres'
});

async function verify() {
  const tables = ['products', 'sales', 'predictions', 'alerts', 'data_imports'];
  
  for (const table of tables) {
    console.log(`\\n=== ${table} ===`);
    try {
      const cols = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = '${table}' 
        ORDER BY ordinal_position
      `);
      console.log('Columns:', JSON.stringify(cols.rows, null, 2));
      
      const fks = await pool.query(`
        SELECT 
          kcu.column_name,
          ccu.table_name AS referenced_table,
          ccu.column_name AS referenced_column
        FROM information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = '${table}'
        AND tc.constraint_type = 'FOREIGN KEY'
      `);
      console.log('FKs:', fks.rows.length > 0 ? fks.rows : 'None');
      
      constuks = await pool.query(`
        SELECT u.constraint_name, u.table_name, kcu.column_name
        FROM information_schema.table_constraints u
        JOIN information_schema.key_column_usage kcu
          ON u.constraint_name = kcu.constraint_name
        WHERE u.table_name = '${table}'
        AND u.constraint_type = 'UNIQUE';
      `);
      console.log('Unique:', ukuks.rows);
      
      constcks = await pool.query(`
        SELECT check_clause, constraint_name
        FROM information_schema.check_constraints
        WHERE constraint_schema = 'public' AND table_name = '${table}';
      `);
      console.log('CHECKs:', ccks.rows.length > 0 ? ccks.rows.map(x => x.check_clause) : 'None');
      
      const idxs = await pool.query(`
        SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '${table}' ORDER BY indexname
      `);
      console.log('Indexes:', idxs.rows.length > 0 ? idxs.rows.map(x => x.indexdef) : 'None');
    } catch (err) {
      console.error('Error verifying', table, ':', err.message);
    }
  }
  
  // Special: check UNIQUE on predictions_product_id_key
  try {
    const uk = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'predictions' AND indexname = 'predictions_product_id_key'
    `);
    console.log('\\nPredictions unique index:', uk.rows);
  } catch(e) { console.error('Error:', e.message); }
  
  // Check sales unique
  try {
    const uk = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'sales' AND indexname = 'sales_product_id_sale_date_key'
    `);
    console.log('Sales unique index:', uk.rows);
  } catch(e) { console.error('Error:', e.message); }
  
  pool.end();
}

verify();