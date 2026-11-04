import allure
from assertpy import assert_that, soft_assertions

from src.constants.checkout import (
    ADMIN_EMAIL,
    ADMIN_ROLE,
    BASKET_SUBTOTAL_CENTS,
    CARD_DISCOUNT_CENTS,
    CARD_TOTAL_CENTS,
    CASH_DISCOUNT_CENTS,
    CASH_TOTAL_CENTS,
    CURRENCY,
    CUSTOMER_ROLE,
    EXPECTED_BASKET_LINES,
    EXPECTED_PRODUCT_NAMES,
    MAX_CATALOGUE_PRODUCTS,
)
from src.models.checkout.request import CheckoutRegistrationRequest
from src.models.checkout.response import (
    CheckoutCartResponse,
    CheckoutErrorResponse,
    CheckoutOrderResponse,
    CheckoutUser,
)
from src.models.enums.error_code import ErrorCode
from src.models.enums.payment_method import PaymentMethod


@allure.step("Check the registered customer profile")
def check_customer_profile(user: CheckoutUser, registration: CheckoutRegistrationRequest) -> None:
    with soft_assertions():
        assert_that(user.email).described_as("Customer email").is_equal_to(registration.email.strip().lower())
        assert_that(user.name).described_as("Customer name").is_equal_to(registration.name)
        assert_that(user.date_of_birth).described_as("Customer date of birth").is_equal_to(registration.date_of_birth)
        assert_that(user.role).described_as("Registered customer role").is_equal_to(CUSTOMER_ROLE)


@allure.step("Check that sign-in resolves to the original customer")
def check_same_customer(actual: CheckoutUser, expected: CheckoutUser) -> None:
    assert_that(actual).described_as("Customer identity and profile").is_equal_to(expected)


@allure.step("Check the seeded administrator account")
def check_admin_user(user: CheckoutUser) -> None:
    with soft_assertions():
        assert_that(user.role).described_as("Administrator role").is_equal_to(ADMIN_ROLE)
        assert_that(user.email).described_as("Administrator email").is_equal_to(ADMIN_EMAIL)


@allure.step("Check that the cart is empty")
def check_empty_cart(cart: CheckoutCartResponse) -> None:
    with soft_assertions():
        assert_that(cart.items).described_as("Remaining cart items").is_empty()
        assert_that(cart.subtotal_cents).described_as("Empty cart subtotal").is_zero()
        assert_that(cart.currency).described_as("Cart currency").is_equal_to(CURRENCY)


@allure.step("Check that the grocery catalogue is available")
def check_product_catalogue(cart: CheckoutCartResponse) -> None:
    with soft_assertions():
        assert_that(len(cart.available_products)).described_as("Catalogue size").is_between(1, MAX_CATALOGUE_PRODUCTS)
        assert_that([product.name for product in cart.available_products]).described_as("Grocery selection").contains(
            *EXPECTED_PRODUCT_NAMES
        )
        assert_that([product.id for product in cart.available_products]).described_as(
            "Product identifiers"
        ).does_not_contain_duplicates()
        for product in cart.available_products:
            assert_that(product.price_cents).described_as(f"Price of {product.name}").is_greater_than(0)


@allure.step("Check the selected milk and bread basket")
def check_known_basket(cart: CheckoutCartResponse | CheckoutOrderResponse) -> None:
    actual_lines = tuple(
        sorted(
            (item.product_id, item.name, item.unit_price_cents, item.quantity, item.line_total_cents)
            for item in cart.items
        )
    )
    with soft_assertions():
        assert_that(actual_lines).described_as("Selected products, quantities, and prices").is_equal_to(
            EXPECTED_BASKET_LINES
        )
        assert_that(cart.subtotal_cents).described_as("Two milk and one bread subtotal").is_equal_to(
            BASKET_SUBTOTAL_CENTS
        )
        assert_that(cart.currency).described_as("Basket currency").is_equal_to(CURRENCY)


@allure.step("Check that the customer's saved basket is preserved")
def check_same_cart(actual: CheckoutCartResponse, expected: CheckoutCartResponse) -> None:
    with soft_assertions():
        assert_that(actual.items).described_as("Saved basket items").is_equal_to(expected.items)
        assert_that(actual.subtotal_cents).described_as("Saved basket subtotal").is_equal_to(expected.subtotal_cents)
        assert_that(actual.currency).described_as("Saved basket currency").is_equal_to(expected.currency)


@allure.step("Check the order payment and discount")
def check_checkout_order(order: CheckoutOrderResponse, payment_method: PaymentMethod) -> None:
    expected_discount, expected_total = {
        PaymentMethod.CASH: (CASH_DISCOUNT_CENTS, CASH_TOTAL_CENTS),
        PaymentMethod.CREDIT_CARD: (CARD_DISCOUNT_CENTS, CARD_TOTAL_CENTS),
    }[payment_method]
    check_known_basket(order)
    with soft_assertions():
        assert_that(order.payment_method).described_as("Order payment method").is_equal_to(payment_method)
        assert_that(order.discount_cents).described_as("Payment discount").is_equal_to(expected_discount)
        assert_that(order.total_cents).described_as("Amount payable").is_equal_to(expected_total)


@allure.step("Check that the order contains the customer's selected basket")
def check_order_contains_cart(order: CheckoutOrderResponse, cart: CheckoutCartResponse) -> None:
    with soft_assertions():
        assert_that(order.items).described_as("Purchased basket items").is_equal_to(cart.items)
        assert_that(order.subtotal_cents).described_as("Purchased basket subtotal").is_equal_to(cart.subtotal_cents)
        assert_that(order.currency).described_as("Purchased basket currency").is_equal_to(cart.currency)


@allure.step("Check the business rejection reason")
def check_error(response: CheckoutErrorResponse, expected_code: ErrorCode) -> None:
    with soft_assertions():
        assert_that(response.error.code).described_as("Business error code").is_equal_to(expected_code)
        assert_that(response.error.message).described_as("Business error explanation").is_not_empty()
