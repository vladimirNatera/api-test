const { readFile } = require('node:fs/promises');
const path = require('node:path');

async function migrate(pool) {
  const schema = await readFile(path.join(__dirname, '../db/schema.sql'), 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(schema);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { migrate };
