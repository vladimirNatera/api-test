const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { AppError } = require('./errors');

function createAuth({ secret, passwordRounds = 10 }) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters');
  }
  return {
    hashPassword: (password) => bcrypt.hash(password, passwordRounds),
    verifyPassword: (password, passwordHash) => bcrypt.compare(password, passwordHash),
    issueToken(user) {
      return jwt.sign({}, secret, {
        algorithm: 'HS256', subject: user.id, expiresIn: '1h',
        issuer: 'checkout-api', audience: 'checkout-clients',
      });
    },
    verifyToken(token) {
      try {
        const claims = jwt.verify(token, secret, {
          algorithms: ['HS256'], issuer: 'checkout-api', audience: 'checkout-clients',
        });
        if (typeof claims.sub !== 'string'
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)) {
          throw new Error('Invalid subject');
        }
        return claims.sub;
      } catch {
        throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired access token');
      }
    },
  };
}

module.exports = { createAuth };
