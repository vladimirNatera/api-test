const { randomInt, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

const PRODUCTS = [
  { id: 1, name: 'Milk', priceCents: 250 },
  { id: 2, name: 'Bread', priceCents: 180 },
  { id: 3, name: 'Apple', priceCents: 75 },
  { id: 4, name: 'Banana', priceCents: 60 },
  { id: 5, name: 'Orange', priceCents: 90 },
  { id: 6, name: 'Pear', priceCents: 85 },
  { id: 7, name: 'Grapes', priceCents: 350 },
  { id: 8, name: 'Strawberries', priceCents: 400 },
  { id: 9, name: 'Eggs', priceCents: 320 },
  { id: 10, name: 'Cheese', priceCents: 450 },
  { id: 11, name: 'Butter', priceCents: 275 },
  { id: 12, name: 'Yogurt', priceCents: 120 },
  { id: 13, name: 'Rice', priceCents: 220 },
  { id: 14, name: 'Pasta', priceCents: 160 },
  { id: 15, name: 'Tomato', priceCents: 65 },
];

const FIRST_NAMES = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Jamie', 'Riley'];
const LAST_NAMES = ['River', 'Meadow', 'Brook', 'Lake', 'Reed', 'Stone', 'Vale', 'Forest'];

function randomProfile() {
  const name = `${FIRST_NAMES[randomInt(FIRST_NAMES.length)]} ${LAST_NAMES[randomInt(LAST_NAMES.length)]}`;
  const year = randomInt(1960, 2007);
  const month = String(randomInt(1, 13)).padStart(2, '0');
  const day = String(randomInt(1, 29)).padStart(2, '0');

  return { name, dateOfBirth: `${year}-${month}-${day}` };
}

async function seed(pool) {
  const adminPasswordHash = await bcrypt.hash('Qwerty123!', 12);
  const demoPasswordHash = await bcrypt.hash('DemoUser123!', 12);
  const client = await pool.connect();
  const insertUser = `
    INSERT INTO users (id, email, password_hash, name, date_of_birth, role, username)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT DO NOTHING
  `;

  try {
    await client.query('BEGIN');

    for (const product of PRODUCTS) {
      await client.query(
        'INSERT INTO products (id, name, price_cents) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [product.id, product.name, product.priceCents],
      );
    }

    await client.query(insertUser, [
      randomUUID(), 'admin@example.com', adminPasswordHash, 'Demo Admin', '1990-01-01', 'admin', 'admin',
    ]);

    for (let index = 1; index <= 10; index += 1) {
      const profile = randomProfile();

      await client.query(insertUser, [
        randomUUID(),
        `user${String(index).padStart(2, '0')}@example.com`,
        demoPasswordHash,
        profile.name,
        profile.dateOfBirth,
        'customer',
        null,
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { seed, PRODUCTS };
