require('dotenv').config({ quiet: true });
const { createPool } = require('../src/db');
const { migrate } = require('../src/migrate');
const { seed } = require('../src/seed');

async function main() {
  const operation = { migrate, seed }[process.argv[2]];
  if (!operation) {
    throw new Error('Usage: node scripts/database.js migrate|seed');
  }
  const pool = createPool(process.env.DATABASE_URL);
  try {
    await operation(pool);
    console.log(`Database ${process.argv[2]} completed`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
