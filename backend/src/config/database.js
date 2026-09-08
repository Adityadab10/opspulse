import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('connect', () => {
  console.log('🐘 PostgreSQL pool connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error', err);
  process.exit(1);
});

export default pool;