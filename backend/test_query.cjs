const { Pool } = require('pg');
const fs = require('fs');
const txt = fs.readFileSync('./.env', 'utf8');
const env = {};
txt.split('\n').forEach(line => { const idx = line.indexOf('='); if (idx > 0) { env[line.substring(0, idx)] = line.substring(idx + 1); } });
const pool = new Pool({ connectionString: env.DATABASE_URL });

// Test 1: $1 in string with require (CJS)
pool.connect().then(c => {
  console.log('Test 1: $1 in string with CJS');
  c.query('SELECT id, name FROM products WHERE id = $1', ['test'], (err, r) => {
    if (err) console.error('Test 1 error:', err.message);
    else console.log('Test 1 OK, rows:', r.rows.length);
    
    // Test 2: $\$1 in string with CJS
    console.log('Test 2: $1 in string with CJS (escaped)');
    c.query('SELECT id, name FROM products WHERE id = \\$1', ['test'], (err, r) => {
      if (err) console.error('Test 2 error:', err.message);
      else console.log('Test 2 OK, rows:', r.rows.length);
      
      // Test 3: template literal with $1
      console.log('Test 3: template literal with $1');
      const q = `SELECT id, name FROM products WHERE id = $1`;
      c.query(q, ['test'], (err, r) => {
        if (err) console.error('Test 3 error:', err.message);
        else console.log('Test 3 OK, rows:', r.rows.length);
        
        // Test 4: $\${1} in template literal
        console.log('Test 4: $1 in template literal');
        const q2 = 'SELECT id, name FROM products WHERE id = $1';
        c.query(q2, ['test'], (err, r) => {
          if (err) console.error('Test 4 error:', err.message);
          else console.log('Test 4 OK, rows:', r.rows.length);
          
          pool.end();
          console.log('All tests complete');
        });
      });
    });
  });
}).catch(e => console.error('Pool error:', e.message));