const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const { AppError } = require('./errors');
const { parseRegistration, parseLogin, parseCart, parseCheckout } = require('./validation');
const { buildCart } = require('./pricing');

function publicUser(user) {
  return {
    id: user.id, email: user.email, name: user.name,
    dateOfBirth: user.dateOfBirth, role: user.role,
  };
}

function createApp({ store, auth }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));

  function authenticate(request, _response, next) {
    const authorization = request.get('authorization');
    if (!authorization || !/^Bearer \S+$/.test(authorization)) {
      throw new AppError(401, 'UNAUTHORIZED', 'A Bearer access token is required');
    }
    request.userId = auth.verifyToken(authorization.slice(7));
    next();
  }

  app.post('/api/registration', async (request, response) => {
    const { password, ...profile } = parseRegistration(request.body);
    const passwordHash = await auth.hashPassword(password);
    const user = await store.createUser({ ...profile, passwordHash });
    response.status(201).json(publicUser(user));
  });

  app.post('/api/login', async (request, response) => {
    const { login, password } = parseLogin(request.body);
    const user = await store.findUserByLogin(login);
    if (!user || !await auth.verifyPassword(password, user.passwordHash)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid login or password');
    }
    response.json({ token: auth.issueToken(user), tokenType: 'Bearer', expiresIn: 3600, user: publicUser(user) });
  });

  app.get('/api/cart', authenticate, async (request, response) => {
    const items = await store.getCart(request.userId);
    response.json({ ...buildCart(items), availableProducts: await store.getProducts() });
  });

  app.put('/api/cart', authenticate, async (request, response) => {
    const items = await store.replaceCart(request.userId, parseCart(request.body));
    response.json({ ...buildCart(items), availableProducts: await store.getProducts() });
  });

  app.post('/api/checkout', authenticate, async (request, response) => {
    const order = await store.checkout(request.userId, parseCheckout(request.body));
    response.status(201).json(order);
  });

  app.get('/openapi.yaml', (_request, response) => {
    response.type('application/yaml').sendFile(path.join(__dirname, '..', 'openapi.yaml'));
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(null, { swaggerOptions: { url: '/openapi.yaml' } }));
  app.use((_request, _response, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } });
    }
    if (error.type === 'entity.too.large') {
      return response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 32 KB' } });
    }
    if (error instanceof AppError) {
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    console.error('Request failed:', error);
    return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  return app;
}

module.exports = { createApp };
