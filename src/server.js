require('dotenv').config({ quiet: true });
const { createApp } = require('./app');
const { createAuth } = require('./auth');
const { createPool } = require('./db');
const { createStore } = require('./store');

async function start() {
  const auth = createAuth({ secret: process.env.JWT_SECRET });
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const pool = createPool(process.env.DATABASE_URL);
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end();
    throw error;
  }
  const app = createApp({ store: createStore(pool), auth });
  const server = app.listen(port, '0.0.0.0', () => console.log(`Checkout API listening on port ${port}`));
  server.on('error', async (error) => {
    console.error('HTTP server failed:', error.message);
    await pool.end();
    process.exitCode = 1;
  });
  function shutdown() {
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(timeout);
    });
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

start().catch((error) => {
  console.error('Startup failed:', error.message);
  process.exitCode = 1;
});
