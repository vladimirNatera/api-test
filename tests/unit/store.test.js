jest.mock('pg', () => ({ Pool: jest.fn() }));

const { Pool } = require('pg');
const { createPool } = require('../../src/db');
const { migrate } = require('../../src/migrate');
const { createStore } = require('../../src/store');

const USER_ID = '61c811b1-0bc5-4901-b7d7-e97cb092c638';
const ORDER_ID = '4cc3473f-17db-4161-9523-e6391836ec15';
const ITEMS = [
  { productId: 1, name: 'Milk', unitPriceCents: 250, quantity: 2 },
  { productId: 2, name: 'Bread', unitPriceCents: 180, quantity: 1 },
];

function database() {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  const pool = { query: jest.fn(), connect: jest.fn().mockResolvedValue(client) };
  return { client, pool, store: createStore(pool) };
}

function successfulTransaction(client, items = ITEMS, createdAt = new Date('2026-01-01T12:00:00.000Z')) {
  client.query.mockImplementation(async (query) => {
    if (query.includes('FOR UPDATE')) {
      return { rows: [{ id: USER_ID }] };
    }
    if (query.includes('WHERE id = ANY')) {
      return { rows: items.map((item) => ({ id: item.productId })) };
    }
    if (query.includes('JOIN products')) {
      return { rows: items };
    }
    if (query.includes('INSERT INTO orders')) {
      return { rows: [{ id: ORDER_ID, createdAt }] };
    }
    return { rows: [] };
  });
}

describe('PostgreSQL pool', () => {
  test('requires an explicit database URL', () => {
    expect(() => createPool()).toThrow('DATABASE_URL is required');
    expect(() => createPool('')).toThrow('DATABASE_URL is required');
  });

  test('uses bounded connections and connection timeouts', () => {
    const pool = {};
    Pool.mockReturnValueOnce(pool);
    expect(createPool('postgres://localhost/checkout')).toBe(pool);
    expect(Pool).toHaveBeenCalledWith({
      connectionString: 'postgres://localhost/checkout',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  });
});

describe('schema migration', () => {
  test('creates the schema within a transaction and releases the connection', async () => {
    const { pool, client } = database();
    await migrate(pool);
    expect(client.query.mock.calls[0]).toEqual(['BEGIN']);
    expect(client.query.mock.calls[1][0]).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(client.query.mock.calls[1][0]).toContain('users_email_unique');
    expect(client.query.mock.calls[2]).toEqual(['COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back a failed migration and releases the connection', async () => {
    const { pool, client } = database();
    const error = new Error('DDL rejected');
    client.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(error);
    await expect(migrate(pool)).rejects.toBe(error);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('users', () => {
  test('creates a user with canonical email using bound parameters', async () => {
    const { pool, store } = database();
    const user = {
      email: '  Person@Example.com  ', passwordHash: 'hash', name: 'Person', dateOfBirth: '1990-01-02',
    };
    const saved = { ...user, id: USER_ID, email: 'person@example.com', role: 'customer', username: null };
    pool.query.mockResolvedValueOnce({ rows: [saved] });
    await expect(store.createUser(user)).resolves.toEqual(saved);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), [
      expect.stringMatching(/^[0-9a-f-]{36}$/), 'person@example.com', 'hash', 'Person', '1990-01-02',
    ]);
  });

  test('maps the email unique constraint to a bad request', async () => {
    const { pool, store } = database();
    pool.query.mockRejectedValueOnce({ code: '23505', constraint: 'users_email_unique' });
    await expect(store.createUser({ email: 'person@example.com' })).rejects.toMatchObject({
      status: 400, code: 'EMAIL_EXISTS', message: 'User exists',
    });
  });

  test.each([
    { code: '23505', constraint: 'users_pkey' },
    { code: '08006', message: 'Connection failed' },
  ])('preserves unrelated database errors: $code/$constraint', async (error) => {
    const { pool, store } = database();
    pool.query.mockRejectedValueOnce(error);
    await expect(store.createUser({ email: 'person@example.com' })).rejects.toBe(error);
  });

  test.each([' Admin ', ' ADMIN@example.com '])('normalizes login %s', async (login) => {
    const { pool, store } = database();
    const user = { id: USER_ID };
    pool.query.mockResolvedValueOnce({ rows: [user] });
    await expect(store.findUserByLogin(login)).resolves.toBe(user);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('LOWER(username)'), [login.trim().toLowerCase()]);
  });

  test('returns null for an unknown login', async () => {
    const { pool, store } = database();
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(store.findUserByLogin('missing@example.com')).resolves.toBeNull();
  });
});

describe('catalogue and cart', () => {
  test('reads products in stable ID order', async () => {
    const { pool, store } = database();
    const products = [{ id: 1, name: 'Milk', priceCents: 250 }];
    pool.query.mockResolvedValueOnce({ rows: products });
    await expect(store.getProducts()).resolves.toEqual(products);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY id'));
  });

  test('reads only the current user cart', async () => {
    const { pool, store } = database();
    pool.query.mockResolvedValueOnce({ rows: ITEMS });
    await expect(store.getCart(USER_ID)).resolves.toEqual(ITEMS);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE cart_items.user_id = $1'), [USER_ID]);
  });

  test('locks the user before validating and replacing their cart', async () => {
    const { client, store } = database();
    successfulTransaction(client);
    await expect(store.replaceCart(USER_ID, ITEMS)).resolves.toEqual(ITEMS);
    expect(client.query.mock.calls[0]).toEqual(['BEGIN']);
    expect(client.query.mock.calls[1]).toEqual(['SELECT id FROM users WHERE id = $1 FOR UPDATE', [USER_ID]]);
    expect(client.query.mock.calls[2]).toEqual(['SELECT id FROM products WHERE id = ANY($1::integer[])', [[1, 2]]]);
    expect(client.query.mock.calls[3]).toEqual(['DELETE FROM cart_items WHERE user_id = $1', [USER_ID]]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO cart_items'), [USER_ID, 1, 2]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO cart_items'), [USER_ID, 2, 1]);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('an empty replacement clears the cart without querying product IDs', async () => {
    const { client, store } = database();
    successfulTransaction(client, []);
    await expect(store.replaceCart(USER_ID, [])).resolves.toEqual([]);
    expect(client.query).toHaveBeenCalledWith('DELETE FROM cart_items WHERE user_id = $1', [USER_ID]);
    expect(client.query.mock.calls.some(([query]) => query.includes('WHERE id = ANY'))).toBe(false);
    expect(client.query.mock.calls.some(([query]) => query.includes('INSERT INTO cart_items'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('unknown products roll back before modifying the cart', async () => {
    const { client, store } = database();
    successfulTransaction(client, [ITEMS[0]]);
    await expect(store.replaceCart(USER_ID, ITEMS)).rejects.toMatchObject({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    expect(client.query.mock.calls.some(([query]) => query.includes('DELETE FROM'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('unknown users cannot create carts', async () => {
    const { client, store } = database();
    await expect(store.replaceCart(USER_ID, ITEMS)).rejects.toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('a failed insert rolls back a cart replacement', async () => {
    const { client, store } = database();
    successfulTransaction(client);
    const successfulQuery = client.query.getMockImplementation();
    const error = new Error('Insert failed');
    client.query.mockImplementation((query, parameters) => {
      if (query.includes('INSERT INTO cart_items')) {
        return Promise.reject(error);
      }
      return successfulQuery(query, parameters);
    });
    await expect(store.replaceCart(USER_ID, ITEMS)).rejects.toBe(error);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('connection failures propagate without an acquired connection', async () => {
    const { pool, client, store } = database();
    const error = new Error('Cannot connect');
    pool.connect.mockRejectedValueOnce(error);
    await expect(store.replaceCart(USER_ID, [])).rejects.toBe(error);
    expect(client.release).not.toHaveBeenCalled();
  });
});

describe('checkout transactions', () => {
  test.each([
    ['cash', 68, 612, new Date('2026-01-01T12:00:00.000Z')],
    ['credit_card', 0, 680, '2026-01-01T12:00:00.000Z'],
  ])('%s persists an order and clears the locked cart atomically', async (method, discount, total, date) => {
    const { client, store } = database();
    successfulTransaction(client, ITEMS, date);
    await expect(store.checkout(USER_ID, method)).resolves.toMatchObject({
      id: ORDER_ID,
      createdAt: '2026-01-01T12:00:00.000Z',
      paymentMethod: method,
      currency: 'USD',
      subtotalCents: 680,
      discountCents: discount,
      totalCents: total,
      items: [
        { ...ITEMS[0], lineTotalCents: 500 },
        { ...ITEMS[1], lineTotalCents: 180 },
      ],
    });
    expect(client.query.mock.calls[0]).toEqual(['BEGIN']);
    expect(client.query.mock.calls[1]).toEqual(['SELECT id FROM users WHERE id = $1 FOR UPDATE', [USER_ID]]);
    expect(client.query.mock.calls[2][0]).toContain('JOIN products');
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO orders'), [
      expect.stringMatching(/^[0-9a-f-]{36}$/), USER_ID, method, 'USD', 680, discount, total,
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO order_items'), [
      ORDER_ID, 1, 'Milk', 250, 2, 500,
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO order_items'), [
      ORDER_ID, 2, 'Bread', 180, 1, 180,
    ]);
    expect(client.query.mock.calls.at(-2)).toEqual(['DELETE FROM cart_items WHERE user_id = $1', [USER_ID]]);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('empty checkout creates no order and releases the lock with a rollback', async () => {
    const { client, store } = database();
    successfulTransaction(client, []);
    await expect(store.checkout(USER_ID, 'cash')).rejects.toMatchObject({ status: 400, code: 'EMPTY_CART' });
    expect(client.query.mock.calls.some(([query]) => query.includes('INSERT INTO orders'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('an order item write failure rolls back and preserves the cart', async () => {
    const { client, store } = database();
    successfulTransaction(client);
    const successfulQuery = client.query.getMockImplementation();
    const error = new Error('Order item failed');
    client.query.mockImplementation((query, parameters) => {
      if (query.includes('INSERT INTO order_items')) {
        return Promise.reject(error);
      }
      return successfulQuery(query, parameters);
    });
    await expect(store.checkout(USER_ID, 'cash')).rejects.toBe(error);
    expect(client.query.mock.calls.some(([query]) => query.includes('DELETE FROM cart_items'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('failed commit is reported and the connection is released', async () => {
    const { client, store } = database();
    successfulTransaction(client);
    const successfulQuery = client.query.getMockImplementation();
    const error = new Error('Commit failed');
    client.query.mockImplementation((query, parameters) => {
      if (query === 'COMMIT') {
        return Promise.reject(error);
      }
      return successfulQuery(query, parameters);
    });
    await expect(store.checkout(USER_ID, 'cash')).rejects.toBe(error);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
