const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createAuth } = require('../../src/auth');

const secret = 'unit-test-secret-that-is-at-least-32-characters';
const userId = randomUUID();

describe('password hashing', () => {
  const auth = createAuth({ secret, passwordRounds: 4 });

  test('hashes passwords with salt and verifies the original password only', async () => {
    const password = 'Qwerty123!';
    const hash = await auth.hashPassword(password);
    const secondHash = await auth.hashPassword(password);
    expect(hash).not.toBe(password);
    expect(secondHash).not.toBe(hash);
    expect(bcrypt.getRounds(hash)).toBe(4);
    await expect(auth.verifyPassword(password, hash)).resolves.toBe(true);
    await expect(auth.verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  test('uses ten rounds by default', async () => {
    const defaultAuth = createAuth({ secret });
    expect(bcrypt.getRounds(await defaultAuth.hashPassword('Password123!'))).toBe(10);
  });
});

describe('token authentication', () => {
  const auth = createAuth({ secret, passwordRounds: 4 });

  test('issues a token scoped to this API for one hour', () => {
    const token = auth.issueToken({ id: userId, email: 'person@example.com', passwordHash: 'sensitive' });
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'checkout-api',
      audience: 'checkout-clients',
    });
    expect(payload.sub).toBe(userId);
    expect(payload.exp - payload.iat).toBe(3600);
    expect(payload).not.toHaveProperty('passwordHash');
    expect(auth.verifyToken(token)).toBe(userId);
  });

  test.each([undefined, null, '', 'invalid', 'Bearer token', 'a.b.c'])('rejects malformed tokens: %p', (token) => {
    expect(() => auth.verifyToken(token)).toThrow(expect.objectContaining({ status: 401, code: 'UNAUTHORIZED' }));
  });

  test.each([
    ['expired', { expiresIn: -1 }],
    ['wrong issuer', { issuer: 'another-api' }],
    ['wrong audience', { audience: 'another-client' }],
    ['invalid subject', { subject: 'not-a-uuid' }],
    ['wrong algorithm', { algorithm: 'HS384' }],
  ])('rejects a token with %s', (_description, options) => {
    const token = jwt.sign({}, secret, {
      algorithm: 'HS256',
      issuer: 'checkout-api',
      audience: 'checkout-clients',
      subject: userId,
      expiresIn: '1h',
      ...options,
    });
    expect(() => auth.verifyToken(token)).toThrow(expect.objectContaining({ status: 401, code: 'UNAUTHORIZED' }));
  });

  test('rejects tokens signed with another secret', () => {
    const token = createAuth({ secret: 'a-different-secret-at-least-32-characters' }).issueToken({ id: userId });
    expect(() => auth.verifyToken(token)).toThrow(expect.objectContaining({ status: 401, code: 'UNAUTHORIZED' }));
  });

  test('rejects a token without a subject', () => {
    const token = jwt.sign({}, secret, { issuer: 'checkout-api', audience: 'checkout-clients', expiresIn: '1h' });
    expect(() => auth.verifyToken(token)).toThrow(expect.objectContaining({ status: 401, code: 'UNAUTHORIZED' }));
  });
});

describe('authentication configuration', () => {
  test.each([undefined, null, 123, '', 'a'.repeat(31)])('rejects an invalid signing secret: %p', (invalidSecret) => {
    expect(() => createAuth({ secret: invalidSecret })).toThrow();
  });

  test('accepts the 32-character secret boundary', () => {
    expect(() => createAuth({ secret: 'a'.repeat(32) })).not.toThrow();
  });
});
