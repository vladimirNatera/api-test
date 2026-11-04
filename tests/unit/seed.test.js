jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

const bcrypt = require('bcryptjs');
const { seed, PRODUCTS } = require('../../src/seed');

function database() {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  const pool = { connect: jest.fn().mockResolvedValue(client) };
  return { client, pool };
}

beforeEach(() => {
  bcrypt.hash.mockReset();
  bcrypt.hash.mockImplementation(async (password) => `hashed:${password}`);
});

test('seeds 15 groceries and 11 fictional accounts in a single transaction', async () => {
  const { pool, client } = database();
  await seed(pool);
  expect(PRODUCTS).toHaveLength(15);
  expect(PRODUCTS.map((product) => product.id)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
  expect(PRODUCTS.every((product) => Number.isInteger(product.priceCents) && product.priceCents > 0)).toBe(true);
  expect(PRODUCTS.map((product) => product.name)).toEqual(expect.arrayContaining(['Milk', 'Bread', 'Apple', 'Banana']));
  expect(bcrypt.hash).toHaveBeenCalledWith('Qwerty123!', 12);
  expect(bcrypt.hash).toHaveBeenCalledWith('DemoUser123!', 12);
  expect(client.query.mock.calls[0]).toEqual(['BEGIN']);
  expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);

  const productWrites = client.query.mock.calls.filter(([query]) => query.includes('INSERT INTO products'));
  expect(productWrites).toHaveLength(15);
  productWrites.forEach(([query, parameters], index) => {
    expect(query).toContain('ON CONFLICT DO NOTHING');
    expect(parameters).toEqual([PRODUCTS[index].id, PRODUCTS[index].name, PRODUCTS[index].priceCents]);
  });

  const userWrites = client.query.mock.calls.filter(([query]) => query.includes('INSERT INTO users'));
  expect(userWrites).toHaveLength(11);
  expect(userWrites[0][1]).toEqual([
    expect.stringMatching(/^[0-9a-f-]{36}$/),
    'admin@example.com', 'hashed:Qwerty123!', 'Demo Admin', '1990-01-01', 'admin', 'admin',
  ]);

  for (let index = 1; index <= 10; index += 1) {
    const [query, parameters] = userWrites[index];
    expect(query).toContain('ON CONFLICT DO NOTHING');
    expect(parameters).toEqual([
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      `user${String(index).padStart(2, '0')}@example.com`,
      'hashed:DemoUser123!',
      expect.stringMatching(/^[A-Za-z]+ [A-Za-z]+$/),
      expect.stringMatching(/^(19[6-9][0-9]|200[0-6])-(0[1-9]|1[0-2])-(0[1-9]|1[0-9]|2[0-8])$/),
      'customer',
      null,
    ]);
  }
});

test('repeated seeds target the same product IDs and emails without updating existing accounts', async () => {
  const { pool, client } = database();
  await seed(pool);
  const originalWrites = client.query.mock.calls.filter(([, parameters]) => parameters);
  client.query.mockClear();
  await seed(pool);
  const repeatedWrites = client.query.mock.calls.filter(([, parameters]) => parameters);

  expect(repeatedWrites).toHaveLength(originalWrites.length);
  repeatedWrites.forEach(([query, parameters], index) => {
    expect(query).toContain('ON CONFLICT DO NOTHING');
    if (query.includes('INSERT INTO products')) {
      expect(parameters).toEqual(originalWrites[index][1]);
    } else {
      expect(parameters[1]).toBe(originalWrites[index][1][1]);
    }
  });
});

test('seed failure rolls back all demo data and releases its connection', async () => {
  const { pool, client } = database();
  const error = new Error('Seed insert failed');
  client.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(error);
  await expect(seed(pool)).rejects.toBe(error);
  expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('password hashing failure aborts before acquiring a database connection', async () => {
  const { pool } = database();
  const error = new Error('Hash failed');
  bcrypt.hash.mockRejectedValueOnce(error);
  await expect(seed(pool)).rejects.toBe(error);
  expect(pool.connect).not.toHaveBeenCalled();
});
