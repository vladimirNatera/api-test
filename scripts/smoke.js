const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const baseUrl = process.env.API_URL || 'http://127.0.0.1:3000';

async function request(route, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  return { status: response.status, data };
}

async function main() {
  const specification = await fetch(`${baseUrl}/openapi.yaml`, { signal: AbortSignal.timeout(10000) });
  assert.equal(specification.status, 200);
  assert.match(await specification.text(), /openapi: 3\.0\.3/);
  assert.equal((await request('/api/cart')).status, 401);

  const admin = await request('/api/login', {
    method: 'POST', body: { login: 'admin', password: 'Qwerty123!' },
  });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.user.role, 'admin');
  const catalogue = await request('/api/cart', { token: admin.data.token });
  assert.equal(catalogue.status, 200);
  assert.equal(catalogue.data.availableProducts.length, 15);

  for (let index = 1; index <= 10; index += 1) {
    const result = await request('/api/login', {
      method: 'POST',
      body: { login: `user${String(index).padStart(2, '0')}@example.com`, password: 'DemoUser123!' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.user.role, 'customer');
  }

  const profile = {
    email: `smoke-${randomUUID()}@example.com`, password: 'SmokeTest123!',
    name: 'Smoke Test', dateOfBirth: '1990-01-01',
  };
  const registrations = await Promise.all([
    request('/api/registration', { method: 'POST', body: profile }),
    request('/api/registration', { method: 'POST', body: { ...profile, email: profile.email.toUpperCase() } }),
  ]);
  assert.deepEqual(registrations.map((result) => result.status).sort(), [201, 409]);
  const registered = registrations.find((result) => result.status === 201).data;
  assert.equal(registered.email, profile.email);
  assert.equal('passwordHash' in registered, false);
  const login = await request('/api/login', {
    method: 'POST', body: { login: profile.email, password: profile.password },
  });
  assert.equal(login.status, 200);
  const token = login.data.token;
  assert.equal((await request('/api/checkout', { method: 'POST', token, body: { paymentMethod: 'cash' } })).status, 400);

  const cartItems = [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }];
  const cart = await request('/api/cart', { method: 'PUT', token, body: { items: cartItems } });
  assert.equal(cart.status, 200);
  assert.equal(cart.data.items.length, 2);
  const subtotal = cart.data.subtotalCents;
  const adminCart = await request('/api/cart', { token: admin.data.token });
  assert.deepEqual(adminCart.data.items, catalogue.data.items);
  const unknownProduct = await request('/api/cart', {
    method: 'PUT', token, body: { items: [{ productId: 2147483647, quantity: 1 }] },
  });
  assert.equal(unknownProduct.status, 404);
  assert.equal((await request('/api/cart', { token })).data.subtotalCents, subtotal);

  const cash = await request('/api/checkout', { method: 'POST', token, body: { paymentMethod: 'cash' } });
  assert.equal(cash.status, 201);
  assert.equal(cash.data.discountCents, Math.round(subtotal / 10));
  assert.equal(cash.data.totalCents, subtotal - Math.round(subtotal / 10));
  assert.equal((await request('/api/cart', { token })).data.items.length, 0);

  await request('/api/cart', { method: 'PUT', token, body: { items: cartItems } });
  const card = await request('/api/checkout', { method: 'POST', token, body: { paymentMethod: 'credit_card' } });
  assert.equal(card.status, 201);
  assert.equal(card.data.discountCents, 0);
  assert.equal(card.data.totalCents, subtotal);

  await request('/api/cart', { method: 'PUT', token, body: { items: cartItems } });
  const concurrent = await Promise.all([
    request('/api/checkout', { method: 'POST', token, body: { paymentMethod: 'cash' } }),
    request('/api/checkout', { method: 'POST', token, body: { paymentMethod: 'cash' } }),
  ]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 400]);
  assert.equal((await request('/api/cart', { token })).data.items.length, 0);
  console.log('PostgreSQL API smoke tests passed: seed users, unique emails, cart isolation, rollback, both payments, concurrent checkout');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
