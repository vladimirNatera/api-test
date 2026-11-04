const { AppError } = require('../../src/errors');
const { buildCart, calculateCheckout } = require('../../src/pricing');

const items = [
  { productId: 1, name: 'Milk', unitPriceCents: 249, quantity: 2 },
  { productId: 2, name: 'Bread', unitPriceCents: 199, quantity: 1 },
];

describe('cart pricing', () => {
  test('calculates line totals and subtotal in integer cents', () => {
    expect(buildCart(items)).toEqual({
      items: [
        { ...items[0], lineTotalCents: 498 },
        { ...items[1], lineTotalCents: 199 },
      ],
      currency: 'USD',
      subtotalCents: 697,
    });
    expect(items[0]).not.toHaveProperty('lineTotalCents');
  });

  test('returns a zero subtotal for an empty cart', () => {
    expect(buildCart([])).toEqual({ items: [], currency: 'USD', subtotalCents: 0 });
  });

  test('supports the maximum permitted quantity', () => {
    expect(buildCart([{ ...items[0], quantity: 99 }]).subtotalCents).toBe(24651);
  });
});

describe('checkout pricing', () => {
  test('gives cash payments a 10% discount rounded to the nearest cent', () => {
    expect(calculateCheckout(items, 'cash')).toEqual({
      ...buildCart(items),
      paymentMethod: 'cash',
      discountCents: 70,
      totalCents: 627,
    });
  });

  test('gives credit card payments no discount', () => {
    expect(calculateCheckout(items, 'credit_card')).toEqual({
      ...buildCart(items),
      paymentMethod: 'credit_card',
      discountCents: 0,
      totalCents: 697,
    });
  });

  test.each([
    [1, 0, 1],
    [4, 0, 4],
    [5, 1, 4],
    [6, 1, 5],
    [14, 1, 13],
    [15, 2, 13],
    [100, 10, 90],
  ])('rounds the cash discount for subtotal %i to %i', (unitPriceCents, discountCents, totalCents) => {
    expect(calculateCheckout([{ ...items[0], unitPriceCents, quantity: 1 }], 'cash')).toMatchObject({
      subtotalCents: unitPriceCents,
      discountCents,
      totalCents,
    });
  });

  test.each(['cash', 'credit_card'])('rejects empty carts paid with %s', (paymentMethod) => {
    expect(() => calculateCheckout([], paymentMethod)).toThrow(AppError);
    expect(() => calculateCheckout([], paymentMethod)).toThrow(expect.objectContaining({ status: 400, code: 'EMPTY_CART' }));
  });

  test.each([undefined, null, '', 'Cash', 'card', 'bank_transfer'])('rejects unsupported payment methods: %p', (paymentMethod) => {
    expect(() => calculateCheckout(items, paymentMethod)).toThrow(expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' }));
  });
});
