import pool from './database.js';

const testConnection = async () => {
  const client = await pool.connect();

  try {
    const result = await client.query('SELECT 1 AS health');
    console.log('✅ Database health check:', result.rows[0]);
    return {
      status: 'ok',
      database: 'connected',
      health: result.rows[0].health,
    };
  } catch (err) {
    console.error('❌ Database health check failed:', err.message);
    return {
      status: 'error',
      database: 'disconnected',
      error: err.message,
    };
  } finally {
    client.release();
  }
};

export default testConnection;