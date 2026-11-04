const { randomUUID } = require('node:crypto');
const { AppError } = require('./errors');
const { calculateCheckout } = require('./pricing');

const USER_FIELDS = `
  id, email, password_hash AS "passwordHash", name,
  date_of_birth::text AS "dateOfBirth", role, username
`;

const CART_QUERY = `
  SELECT products.id AS "productId", products.name,
         products.price_cents AS "unitPriceCents", cart_items.quantity
  FROM cart_items
  JOIN products ON products.id = cart_items.product_id
  WHERE cart_items.user_id = $1
  ORDER BY products.id
`;

async function transaction(pool, operation) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function lockUser(client, userId) {
  const result = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

  if (result.rows.length === 0) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User does not exist');
  }
}

function createStore(pool) {
  return {
    async createUser({ email, passwordHash, name, dateOfBirth }) {
      try {
        const result = await pool.query(
          `INSERT INTO users (id, email, password_hash, name, date_of_birth)
           VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_FIELDS}`,
          [randomUUID(), email.trim().toLowerCase(), passwordHash, name, dateOfBirth],
        );
        return result.rows[0];
      } catch (error) {
        if (error.code === '23505' && error.constraint === 'users_email_unique') {
          throw new AppError(409, 'EMAIL_EXISTS', 'Email is already registered');
        }

        throw error;
      }
    },

    async findUserByLogin(login) {
      const result = await pool.query(
        `SELECT ${USER_FIELDS} FROM users
         WHERE LOWER(TRIM(email)) = $1 OR LOWER(username) = $1`,
        [login.trim().toLowerCase()],
      );
      return result.rows[0] || null;
    },

    async getProducts() {
      const result = await pool.query('SELECT id, name, price_cents AS "priceCents" FROM products ORDER BY id');
      return result.rows;
    },

    async getCart(userId) {
      const result = await pool.query(CART_QUERY, [userId]);
      return result.rows;
    },

    async replaceCart(userId, items) {
      return transaction(pool, async (client) => {
        await lockUser(client, userId);

        if (items.length > 0) {
          const productIds = items.map((item) => item.productId);
          const products = await client.query('SELECT id FROM products WHERE id = ANY($1::integer[])', [productIds]);
          const foundIds = new Set(products.rows.map((product) => product.id));

          if (productIds.some((productId) => !foundIds.has(productId))) {
            throw new AppError(404, 'PRODUCT_NOT_FOUND', 'One or more products do not exist');
          }
        }

        await client.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);

        for (const item of items) {
          await client.query(
            'INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)',
            [userId, item.productId, item.quantity],
          );
        }

        const result = await client.query(CART_QUERY, [userId]);
        return result.rows;
      });
    },

    async checkout(userId, paymentMethod) {
      return transaction(pool, async (client) => {
        await lockUser(client, userId);
        const cart = await client.query(CART_QUERY, [userId]);
        const totals = calculateCheckout(cart.rows, paymentMethod);
        const order = await client.query(
          `INSERT INTO orders (id, user_id, payment_method, currency, subtotal_cents, discount_cents, total_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at AS "createdAt"`,
          [randomUUID(), userId, paymentMethod, totals.currency, totals.subtotalCents, totals.discountCents, totals.totalCents],
        );

        for (const item of totals.items) {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, name, unit_price_cents, quantity, line_total_cents)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [order.rows[0].id, item.productId, item.name, item.unitPriceCents, item.quantity, item.lineTotalCents],
          );
        }

        await client.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
        const createdAt = order.rows[0].createdAt;
        return {
          id: order.rows[0].id,
          createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
          ...totals,
        };
      });
    },
  };
}

module.exports = { createStore };
