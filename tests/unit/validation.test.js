const { AppError } = require('../../src/errors');
const {
  parseRegistration,
  parseLogin,
  parseCart,
  parseCheckout,
} = require('../../src/validation');

const today = new Date('2026-03-01T12:00:00.000Z');
const registration = {
  email: 'person@example.com',
  password: 'Password123!',
  name: 'Test Person',
  dateOfBirth: '1990-04-12',
};

function expectValidationError(callback) {
  expect(callback).toThrow(AppError);
  expect(callback).toThrow(expect.objectContaining({
    status: 400,
    code: 'VALIDATION_ERROR',
  }));
}

describe('registration validation', () => {
  test('normalizes the email and name without changing the password', () => {
    expect(parseRegistration({
      ...registration,
      email: '  Person@EXAMPLE.com  ',
      name: '  Test Person  ',
      password: ' Password123! ',
    }, today)).toEqual({
      ...registration,
      password: ' Password123! ',
    });
  });

  test.each([undefined, null, [], 'person', 123, true])('rejects a non-object body: %p', (body) => {
    expectValidationError(() => parseRegistration(body, today));
  });

  test.each(Object.keys(registration))('requires %s', (field) => {
    const body = { ...registration };
    delete body[field];
    expectValidationError(() => parseRegistration(body, today));
  });

  test.each(['role', 'id', 'passwordHash', 'login'])('rejects unexpected %s', (field) => {
    expectValidationError(() => parseRegistration({ ...registration, [field]: 'admin' }, today));
  });

  test.each([null, 123, '', '   ', 'invalid', 'person@', '@example.com', 'person example@example.com'])('rejects invalid email: %p', (email) => {
    expectValidationError(() => parseRegistration({ ...registration, email }, today));
  });

  test('accepts 254 email characters and rejects 255', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    expect(email).toHaveLength(254);
    expect(parseRegistration({ ...registration, email }, today).email).toBe(email);
    expectValidationError(() => parseRegistration({ ...registration, email: `a${email}` }, today));
  });

  test.each([null, 123, '', 'a'.repeat(7), 'a'.repeat(73), 'é'.repeat(37), '😀'.repeat(7)])('rejects an invalid password: %p', (password) => {
    expectValidationError(() => parseRegistration({ ...registration, password }, today));
  });

  test.each(['a'.repeat(8), 'a'.repeat(72), 'é'.repeat(36), '😀'.repeat(8)])('accepts password boundaries: %p', (password) => {
    expect(parseRegistration({ ...registration, password }, today).password).toBe(password);
  });

  test.each([null, 123, '', '   ', 'a'.repeat(101)])('rejects invalid name: %p', (name) => {
    expectValidationError(() => parseRegistration({ ...registration, name }, today));
  });

  test.each(['A', 'a'.repeat(100), 'Мария'])('accepts valid name: %p', (name) => {
    expect(parseRegistration({ ...registration, name }, today).name).toBe(name);
  });

  test.each([
    null,
    20000101,
    '',
    '2000-1-01',
    '01-01-2000',
    '2000-01-01T00:00:00Z',
    '2000-00-01',
    '2000-13-01',
    '2000-01-00',
    '2000-01-32',
    '2000-04-31',
    '1900-02-29',
    '2023-02-29',
    '1899-12-31',
    '2026-03-02',
  ])('rejects invalid or out-of-range birth date: %p', (dateOfBirth) => {
    expectValidationError(() => parseRegistration({ ...registration, dateOfBirth }, today));
  });

  test.each(['1900-01-01', '2000-02-29', '2024-02-29', '2026-03-01'])('accepts date boundaries and leap days: %s', (dateOfBirth) => {
    expect(parseRegistration({ ...registration, dateOfBirth }, today).dateOfBirth).toBe(dateOfBirth);
  });

  test('uses today when no clock is supplied', () => {
    expect(parseRegistration(registration)).toEqual(registration);
  });
});

describe('login validation', () => {
  test('supports the admin alias and normalizes email logins', () => {
    expect(parseLogin({ login: ' ADMIN ', password: 'Qwerty123!' })).toEqual({ login: 'admin', password: 'Qwerty123!' });
    expect(parseLogin({ login: ' Person@Example.COM ', password: 'password' }).login).toBe('person@example.com');
  });

  test.each([undefined, null, [], 'admin', 123, {}])('rejects missing or invalid bodies: %p', (body) => {
    expectValidationError(() => parseLogin(body));
  });

  test.each([undefined, null, 123, '', '   ', 'a'.repeat(255)])('rejects invalid login: %p', (login) => {
    expectValidationError(() => parseLogin({ login, password: 'password' }));
  });

  test.each(['a', 'a'.repeat(254)])('accepts login length boundaries: %p', (login) => {
    expect(parseLogin({ login, password: 'password' }).login).toBe(login);
  });

  test.each([undefined, null, 123, '', 'a'.repeat(73), 'é'.repeat(37)])('rejects invalid password: %p', (password) => {
    expectValidationError(() => parseLogin({ login: 'admin', password }));
  });

  test.each(['a', 'a'.repeat(72), 'é'.repeat(36)])('accepts a nonempty password up to 72 bytes: %p', (password) => {
    expect(parseLogin({ login: 'admin', password }).password).toBe(password);
  });

  test('rejects fields outside the login contract', () => {
    expectValidationError(() => parseLogin({ login: 'admin', password: 'password', role: 'admin' }));
  });
});

describe('cart validation', () => {
  test('allows an empty cart for clearing it', () => {
    expect(parseCart({ items: [] })).toEqual([]);
  });

  test.each([
    { productId: 1, quantity: 1 },
    { productId: 2147483647, quantity: 99 },
  ])('accepts product ID and quantity boundaries: %p', (item) => {
    expect(parseCart({ items: [item] })).toEqual([item]);
  });

  test('accepts exactly 20 distinct products and rejects 21', () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ productId: index + 1, quantity: 1 }));
    expect(parseCart({ items })).toEqual(items);
    expectValidationError(() => parseCart({ items: [...items, { productId: 21, quantity: 1 }] }));
  });

  test.each([undefined, null, [], 'cart', 123, {}, { items: null }, { items: {} }, { items: 'milk' }])('rejects invalid cart bodies: %p', (body) => {
    expectValidationError(() => parseCart(body));
  });

  test.each([null, [], 'milk', 1, {}, { productId: 1 }, { quantity: 1 }])('rejects invalid cart item: %p', (item) => {
    expectValidationError(() => parseCart({ items: [item] }));
  });

  test.each([null, '1', 0, -1, 1.5, 2147483648, NaN, Infinity])('rejects invalid product ID: %p', (productId) => {
    expectValidationError(() => parseCart({ items: [{ productId, quantity: 1 }] }));
  });

  test.each([null, '1', 0, -1, 1.5, 100, NaN, Infinity])('rejects invalid quantity: %p', (quantity) => {
    expectValidationError(() => parseCart({ items: [{ productId: 1, quantity }] }));
  });

  test('rejects duplicate product IDs', () => {
    expectValidationError(() => parseCart({ items: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }] }));
  });

  test.each([
    { items: [], userId: 'other-user' },
    { items: [{ productId: 1, quantity: 1, priceCents: 1 }] },
  ])('rejects ownership or price overrides: %p', (body) => {
    expectValidationError(() => parseCart(body));
  });
});

describe('checkout validation', () => {
  test.each(['cash', 'credit_card'])('accepts %s', (paymentMethod) => {
    expect(parseCheckout({ paymentMethod })).toBe(paymentMethod);
  });

  test.each([
    undefined,
    null,
    [],
    'cash',
    {},
    { paymentMethod: null },
    { paymentMethod: 1 },
    { paymentMethod: '' },
    { paymentMethod: 'Cash' },
    { paymentMethod: ' cash ' },
    { paymentMethod: 'credit' },
    { paymentMethod: 'bank_transfer' },
    { paymentMethod: 'cash', discountCents: 9999 },
  ])('rejects invalid payment or body: %p', (body) => {
    expectValidationError(() => parseCheckout(body));
  });
});
