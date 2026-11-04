const { AppError } = require('./errors');

function invalid(message) {
  throw new AppError(400, 'VALIDATION_ERROR', message);
}

function objectWithKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('Request must be a JSON object');
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    invalid('Request contains unsupported fields');
  }
}

function requiredString(value, field, maximum, trim = true) {
  if (typeof value !== 'string') {
    invalid(`${field} must be a string`);
  }
  const normalized = trim ? value.trim() : value;
  if (normalized.length < 1 || normalized.length > maximum) {
    invalid(`${field} must contain between 1 and ${maximum} characters`);
  }
  return normalized;
}

function passwordValue(value, minimum) {
  const password = requiredString(value, 'password', 72, false);
  if (Array.from(password).length < minimum || Buffer.byteLength(password, 'utf8') > 72) {
    invalid(`password must contain at least ${minimum} characters and at most 72 UTF-8 bytes`);
  }
  return password;
}

function parseRegistration(body, now = new Date()) {
  objectWithKeys(body, ['email', 'password', 'name', 'dateOfBirth']);
  const email = requiredString(body.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) {
    invalid('email must be a valid email address');
  }
  const password = passwordValue(body.password, 8);
  const name = requiredString(body.name, 'name', 100);
  const dateOfBirth = requiredString(body.dateOfBirth, 'dateOfBirth', 10, false);
  const birthDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
      || Number.isNaN(birthDate.getTime())
      || birthDate.toISOString().slice(0, 10) !== dateOfBirth
      || dateOfBirth < '1900-01-01'
      || dateOfBirth > now.toISOString().slice(0, 10)) {
    invalid('dateOfBirth must be a real date between 1900-01-01 and today (UTC)');
  }
  return { email, password, name, dateOfBirth };
}

function parseLogin(body) {
  objectWithKeys(body, ['login', 'password']);
  return {
    login: requiredString(body.login, 'login', 254).toLowerCase(),
    password: passwordValue(body.password, 1),
  };
}

function parseCart(body) {
  objectWithKeys(body, ['items']);
  if (!Array.isArray(body.items) || body.items.length > 20) {
    invalid('items must be an array containing at most 20 products');
  }
  const productIds = new Set();
  return body.items.map((item) => {
    objectWithKeys(item, ['productId', 'quantity']);
    if (!Number.isInteger(item.productId) || item.productId < 1 || item.productId > 2147483647) {
      invalid('productId must be an integer between 1 and 2147483647');
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      invalid('quantity must be an integer between 1 and 99');
    }
    if (productIds.has(item.productId)) {
      invalid('Each product may appear only once in the cart');
    }
    productIds.add(item.productId);
    return { productId: item.productId, quantity: item.quantity };
  });
}

function parseCheckout(body) {
  objectWithKeys(body, ['paymentMethod']);
  if (!['cash', 'credit_card'].includes(body.paymentMethod)) {
    invalid('paymentMethod must be cash or credit_card');
  }
  return body.paymentMethod;
}

module.exports = { parseRegistration, parseLogin, parseCart, parseCheckout };
