const { AppError } = require('./errors');

function buildCart(items) {
  const pricedItems = items.map((item) => ({
    ...item,
    lineTotalCents: item.unitPriceCents * item.quantity,
  }));
  return {
    items: pricedItems,
    currency: 'USD',
    subtotalCents: pricedItems.reduce((total, item) => total + item.lineTotalCents, 0),
  };
}

function calculateCheckout(items, paymentMethod) {
  if (!['cash', 'credit_card'].includes(paymentMethod)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'paymentMethod must be cash or credit_card');
  }
  if (items.length === 0) {
    throw new AppError(400, 'EMPTY_CART', 'Add items to your cart before checking out');
  }
  const cart = buildCart(items);
  const discountCents = paymentMethod === 'cash' ? Math.round(cart.subtotalCents / 10) : 0;
  return { ...cart, paymentMethod, discountCents, totalCents: cart.subtotalCents - discountCents };
}

module.exports = { buildCart, calculateCheckout };
