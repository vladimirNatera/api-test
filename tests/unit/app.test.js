const request = require('supertest');
const { createApp } = require('../../src/app');
const { AppError } = require('../../src/errors');

const userId = 'ae4b5688-09b6-4cd9-a5d3-927123bcba7d';
const profile = {
  id: userId,
  email: 'person@example.com',
  name: 'Test Person',
  dateOfBirth: '1990-04-12',
  role: 'customer',
};
const storedUser = { ...profile, passwordHash: 'hashed-password' };
const registration = {
  email: profile.email,
  password: 'Password123!',
  name: profile.name,
  dateOfBirth: profile.dateOfBirth,
};
const products = [{ id: 1, name: 'Milk', priceCents: 249 }];
const cartItems = [{ productId: 1, name: 'Milk', unitPriceCents: 249, quantity: 2 }];
const cartResponse = {
  items: [{ ...cartItems[0], lineTotalCents: 498 }],
  subtotalCents: 498,
  currency: 'USD',
  availableProducts: products,
};

let app;
let store;
let auth;

beforeEach(() => {
  store = {
    createUser: jest.fn().mockResolvedValue(storedUser),
    findUserByLogin: jest.fn().mockResolvedValue(storedUser),
    getCart: jest.fn().mockResolvedValue(cartItems),
    getProducts: jest.fn().mockResolvedValue(products),
    replaceCart: jest.fn().mockResolvedValue(cartItems),
    checkout: jest.fn().mockResolvedValue({ id: 'order-id', totalCents: 448, discountCents: 50 }),
  };
  auth = {
    hashPassword: jest.fn().mockResolvedValue('hashed-password'),
    verifyPassword: jest.fn().mockResolvedValue(true),
    issueToken: jest.fn().mockReturnValue('signed-token'),
    verifyToken: jest.fn().mockReturnValue(userId),
  };
  app = createApp({ store, auth });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/registration', () => {
  test('registers a normalized profile and exposes only public fields', async () => {
    const response = await request(app)
      .post('/api/registration')
      .send({ ...registration, email: ' PERSON@example.com ', name: ' Test Person ' })
      .expect(201);

    expect(auth.hashPassword).toHaveBeenCalledWith(registration.password);
    expect(store.createUser).toHaveBeenCalledWith({
      email: profile.email,
      name: profile.name,
      dateOfBirth: profile.dateOfBirth,
      passwordHash: 'hashed-password',
    });
    expect(response.body).toEqual(profile);
    expect(response.headers).not.toHaveProperty('x-powered-by');
    expect(response.body).not.toHaveProperty('password');
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  test.each([
    {},
    { ...registration, email: 'invalid' },
    { ...registration, password: 'short' },
    { ...registration, role: 'admin' },
  ])('rejects invalid input before hashing or storing it: %p', async (body) => {
    const response = await request(app).post('/api/registration').send(body).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(auth.hashPassword).not.toHaveBeenCalled();
    expect(store.createUser).not.toHaveBeenCalled();
  });

  test('returns a bad request when the email already exists', async () => {
    store.createUser.mockRejectedValue(new AppError(400, 'EMAIL_EXISTS', 'User exists'));
    const response = await request(app).post('/api/registration').send(registration).expect(400);
    expect(response.body).toEqual({ error: { code: 'EMAIL_EXISTS', message: 'User exists' } });
    expect(response.body).not.toHaveProperty('stack');
  });
});

describe('POST /api/login', () => {
  test.each(['person@example.com', 'admin'])('authenticates %s and returns a bearer token', async (login) => {
    const response = await request(app).post('/api/login').send({ login: ` ${login.toUpperCase()} `, password: 'Qwerty123!' }).expect(200);
    expect(store.findUserByLogin).toHaveBeenCalledWith(login);
    expect(auth.verifyPassword).toHaveBeenCalledWith('Qwerty123!', storedUser.passwordHash);
    expect(auth.issueToken).toHaveBeenCalledWith(storedUser);
    expect(response.body).toEqual({ token: 'signed-token', tokenType: 'Bearer', expiresIn: 3600, user: profile });
  });

  test('rejects unknown users without issuing a token', async () => {
    store.findUserByLogin.mockResolvedValue(null);
    const response = await request(app).post('/api/login').send({ login: 'unknown@example.com', password: 'Password123!' }).expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(auth.verifyPassword).not.toHaveBeenCalled();
    expect(auth.issueToken).not.toHaveBeenCalled();
  });

  test('rejects an incorrect password with the same error as an unknown user', async () => {
    auth.verifyPassword.mockResolvedValue(false);
    const wrongPassword = await request(app).post('/api/login').send({ login: 'admin', password: 'incorrect' }).expect(401);
    store.findUserByLogin.mockResolvedValue(null);
    const unknownUser = await request(app).post('/api/login').send({ login: 'missing', password: 'incorrect' }).expect(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
    expect(auth.issueToken).not.toHaveBeenCalled();
  });

  test('rejects invalid input before looking up a user', async () => {
    const response = await request(app).post('/api/login').send({ login: 'admin' }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.findUserByLogin).not.toHaveBeenCalled();
  });
});

describe('authentication on cart and checkout', () => {
  test.each([
    ['get', '/api/cart'],
    ['put', '/api/cart'],
    ['post', '/api/checkout'],
  ])('requires authentication for %s %s', async (method, route) => {
    const response = await request(app)[method](route).send({}).expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(auth.verifyToken).not.toHaveBeenCalled();
    expect(store.getCart).not.toHaveBeenCalled();
    expect(store.replaceCart).not.toHaveBeenCalled();
    expect(store.checkout).not.toHaveBeenCalled();
  });

  test.each(['Basic token', 'bearer token', 'Bearer', 'Bearer token extra', 'Bearer  token'])('rejects malformed authorization: %s', async (authorization) => {
    const response = await request(app).get('/api/cart').set('Authorization', authorization).expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(auth.verifyToken).not.toHaveBeenCalled();
    expect(store.getCart).not.toHaveBeenCalled();
  });

  test('rejects an expired or invalid bearer token', async () => {
    auth.verifyToken.mockImplementation(() => { throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired access token'); });
    const response = await request(app).get('/api/cart').set('Authorization', 'Bearer expired-token').expect(401);
    expect(auth.verifyToken).toHaveBeenCalledWith('expired-token');
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(store.getCart).not.toHaveBeenCalled();
  });
});

describe('GET and PUT /api/cart', () => {
  test('returns the authenticated user’s cart and the product catalog', async () => {
    const response = await request(app).get('/api/cart?userId=someone-else').set('Authorization', 'Bearer valid-token').expect(200);
    expect(store.getCart).toHaveBeenCalledWith(userId);
    expect(store.getProducts).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual(cartResponse);
  });

  test('returns an empty cart with the catalog', async () => {
    store.getCart.mockResolvedValue([]);
    const response = await request(app).get('/api/cart').set('Authorization', 'Bearer valid-token').expect(200);
    expect(response.body).toEqual({ items: [], currency: 'USD', subtotalCents: 0, availableProducts: products });
  });

  test('replaces the authenticated user’s cart and uses server prices', async () => {
    const items = [{ productId: 1, quantity: 2 }];
    const response = await request(app).put('/api/cart').set('Authorization', 'Bearer valid-token').send({ items }).expect(200);
    expect(store.replaceCart).toHaveBeenCalledWith(userId, items);
    expect(response.body).toEqual(cartResponse);
  });

  test('supports clearing a cart', async () => {
    store.replaceCart.mockResolvedValue([]);
    const response = await request(app).put('/api/cart').set('Authorization', 'Bearer valid-token').send({ items: [] }).expect(200);
    expect(store.replaceCart).toHaveBeenCalledWith(userId, []);
    expect(response.body.items).toEqual([]);
    expect(response.body.subtotalCents).toBe(0);
  });

  test.each([
    { items: [{ productId: 1, quantity: 0 }] },
    { items: [{ productId: 1, quantity: 100 }] },
    { items: [{ productId: 1, quantity: 1, unitPriceCents: 1 }] },
    { items: [], userId: 'someone-else' },
  ])('rejects invalid quantities and ownership or price overrides: %p', async (body) => {
    const response = await request(app).put('/api/cart').set('Authorization', 'Bearer valid-token').send(body).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.replaceCart).not.toHaveBeenCalled();
  });

  test('returns a not-found error for unavailable products', async () => {
    store.replaceCart.mockRejectedValue(new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found'));
    const response = await request(app).put('/api/cart').set('Authorization', 'Bearer valid-token').send({ items: [{ productId: 999, quantity: 1 }] }).expect(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('POST /api/checkout', () => {
  test.each(['cash', 'credit_card'])('creates an order using %s for the authenticated user', async (paymentMethod) => {
    const order = {
      id: 'order-id',
      paymentMethod,
      subtotalCents: 498,
      discountCents: paymentMethod === 'cash' ? 50 : 0,
      totalCents: paymentMethod === 'cash' ? 448 : 498,
    };
    store.checkout.mockResolvedValue(order);
    const response = await request(app).post('/api/checkout').set('Authorization', 'Bearer valid-token').send({ paymentMethod }).expect(201);
    expect(store.checkout).toHaveBeenCalledWith(userId, paymentMethod);
    expect(response.body).toEqual(order);
  });

  test.each([
    {},
    { paymentMethod: 'bank_transfer' },
    { paymentMethod: 'cash', discountCents: 9999 },
    { paymentMethod: 'cash', userId: 'someone-else' },
  ])('rejects invalid payment input: %p', async (body) => {
    const response = await request(app).post('/api/checkout').set('Authorization', 'Bearer valid-token').send(body).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.checkout).not.toHaveBeenCalled();
  });

  test('returns a validation error when checking out an empty cart', async () => {
    store.checkout.mockRejectedValue(new AppError(400, 'EMPTY_CART', 'Cart is empty'));
    const response = await request(app).post('/api/checkout').set('Authorization', 'Bearer valid-token').send({ paymentMethod: 'cash' }).expect(400);
    expect(response.body.error.code).toBe('EMPTY_CART');
  });
});

describe('documentation and HTTP errors', () => {
  test('serves the OpenAPI YAML specification', async () => {
    const response = await request(app).get('/openapi.yaml').expect(200).expect('Content-Type', /yaml/);
    expect(response.text).toMatch(/^openapi:\s+['"]?3\./);
    expect(response.text).toContain('/api/checkout:');
    expect(response.text).toContain('/api/registration:');
  });

  test('renders Swagger UI', async () => {
    const response = await request(app).get('/docs/').expect(200).expect('Content-Type', /html/);
    expect(response.text).toContain('swagger-ui');
  });

  test('returns a structured 404 for unknown routes', async () => {
    const response = await request(app).get('/does-not-exist').expect(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  test('returns a structured 400 for malformed JSON', async () => {
    const response = await request(app).post('/api/registration').set('Content-Type', 'application/json').send('{"email":').expect(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
    expect(store.createUser).not.toHaveBeenCalled();
  });

  test('rejects a request body exceeding 32 KB', async () => {
    const response = await request(app).post('/api/registration').send({ ...registration, name: 'a'.repeat(33 * 1024) }).expect(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(store.createUser).not.toHaveBeenCalled();
  });

  test('hides database and internal errors from clients', async () => {
    store.getCart.mockRejectedValue(new Error('postgres://user:secret@database/private'));
    const response = await request(app).get('/api/cart').set('Authorization', 'Bearer valid-token').expect(500);
    expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(response.text).not.toContain('secret');
    expect(response.body).not.toHaveProperty('stack');
  });
});
