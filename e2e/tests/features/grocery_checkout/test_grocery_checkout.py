"""Grocery shopping, order creation, discounts, and customer isolation journeys."""

from http import HTTPStatus

import allure
import pytest

from src.assertions.checkout_assertions import (
    check_checkout_order,
    check_empty_cart,
    check_error,
    check_known_basket,
    check_order_contains_cart,
    check_product_catalogue,
    check_same_cart,
)
from src.factories.checkout_factories import CheckoutCartFactory
from src.models.checkout.request import CheckoutOrderRequest
from src.models.checkout.response import CheckoutErrorResponse
from src.models.enums.error_code import ErrorCode
from src.models.enums.payment_method import PaymentMethod
from src.steps.checkout_steps.checkout_steps import CheckoutSteps
from src.utils.allure import with_allure_dynamic_title

pytestmark = [
    allure.epic("E-commerce"),
    allure.story("Grocery checkout"),
    pytest.mark.e2e,
    pytest.mark.checkout,
]


@allure.feature("Grocery shopping and payment")
class TestGroceryCheckout:
    @allure.id("ECOM-005")
    @allure.title("[ECOM] A customer discovers groceries and builds a basket from the catalogue")
    @allure.description(
        """
        User story:
        As a signed-in customer, I want to browse the available milk, bread, and fruit
        and add selected groceries to my basket, so that I can see what I will purchase.

        Service routes - API calls:
        - POST /api/registration and POST /api/login prepare a unique customer
        - GET /api/cart returns the grocery catalogue with at most 20 products
        - PUT /api/cart saves a basket using product identifiers discovered from that catalogue
        - GET /api/cart displays the saved groceries and their server-calculated subtotal
        """
    )
    def test_customer_selects_groceries_from_catalogue(self, customer_steps: CheckoutSteps):
        with allure.step("Browse milk, bread, and fruit available to the customer"):
            catalogue = customer_steps.cart()
            check_product_catalogue(catalogue)

        with allure.step("Select two bottles of milk and one loaf of bread from the catalogue"):
            customer_steps.replace_cart(CheckoutCartFactory.create(catalogue=catalogue.available_products))

        with allure.step("Read the saved groceries and their subtotal"):
            cart = customer_steps.cart()
            check_known_basket(cart)

    @allure.id("ECOM-006")
    @allure.description(
        """
        User story:
        As a customer paying for two bottles of milk and one loaf of bread, I want a
        10% cash discount or the full price for a credit card, so that my order reflects
        the payment rules and the purchased groceries leave my cart.

        Service routes - API calls:
        - POST /api/registration and POST /api/login prepare a unique customer
        - GET /api/cart discovers products and PUT /api/cart saves the grocery basket
        - POST /api/checkout creates the order with the selected payment method
        - GET /api/cart confirms the purchased basket has been cleared
        """
    )
    @pytest.mark.parametrize(
        "payment_method",
        [
            pytest.param(PaymentMethod.CASH, id="cash-ten-percent-discount"),
            pytest.param(PaymentMethod.CREDIT_CARD, id="credit-card-full-price"),
        ],
    )
    @with_allure_dynamic_title("[ECOM] Checkout applies the payment rule and consumes the basket [{id}]")
    def test_checkout_applies_payment_rule_and_clears_cart(
        self,
        customer_steps: CheckoutSteps,
        payment_method: PaymentMethod,
        request: pytest.FixtureRequest,
    ):
        with allure.step("Save a basket containing two bottles of milk and one loaf of bread"):
            catalogue = customer_steps.cart()
            cart = customer_steps.replace_cart(CheckoutCartFactory.create(catalogue=catalogue.available_products))
            check_known_basket(cart)

        with allure.step("Pay for the groceries and check the order against the expected prices"):
            order = customer_steps.checkout(CheckoutOrderRequest(payment_method=payment_method))
            check_checkout_order(order, payment_method)

        with allure.step("Open the cart after completing the purchase"):
            check_empty_cart(customer_steps.cart())

    @allure.id("ECOM-007")
    @allure.title("[ECOM] Checking out one customer's basket leaves another customer's groceries intact")
    @allure.description(
        """
        User story:
        As a customer, I want my basket to remain private and unchanged when another
        customer buys groceries, so that their purchase cannot consume or replace my items.

        Service routes - API calls:
        - POST /api/registration and POST /api/login prepare two independent customers
        - GET /api/cart and PUT /api/cart save a different basket for each customer
        - POST /api/checkout purchases only the second customer's groceries
        - GET /api/cart keeps the first customer's saved basket and empties only the second
        """
    )
    def test_checkout_preserves_another_customers_cart(
        self,
        customer_steps: CheckoutSteps,
        another_customer_steps: CheckoutSteps,
    ):
        with allure.step("Save a basket for the first customer"):
            catalogue = customer_steps.cart()
            saved_cart = customer_steps.replace_cart(CheckoutCartFactory.create(catalogue=catalogue.available_products))
            check_known_basket(saved_cart)

        with allure.step("Save a different basket for the second customer"):
            another_catalogue = another_customer_steps.cart()
            another_cart = another_customer_steps.replace_cart(
                CheckoutCartFactory.create(
                    catalogue=another_catalogue.available_products,
                    milk_quantity=1,
                    bread_quantity=2,
                )
            )
            check_same_cart(customer_steps.cart(), saved_cart)

        with allure.step("Purchase the second customer's own groceries"):
            order = another_customer_steps.checkout(CheckoutOrderRequest(payment_method=PaymentMethod.CREDIT_CARD))
            check_order_contains_cart(order, another_cart)

        with allure.step("Check that only the purchasing customer's basket has been cleared"):
            check_same_cart(customer_steps.cart(), saved_cart)
            check_empty_cart(another_customer_steps.cart())


@allure.feature("Completed purchase protection")
class TestGroceryCheckoutErrors:
    @allure.id("ECOM-008")
    @allure.title("[ECOM][N] A completed grocery basket cannot be purchased again")
    @allure.description(
        """
        User story:
        As a customer who has already purchased my groceries, I want another checkout
        attempt to be rejected until I add new items, so that my completed basket cannot
        create another purchase.

        Service routes - API calls:
        - POST /api/registration and POST /api/login prepare a unique customer
        - GET /api/cart discovers products and PUT /api/cart saves a grocery basket
        - POST /api/checkout purchases the basket
        - POST /api/checkout rejects another purchase with EMPTY_CART
        - GET /api/cart confirms the basket remains empty
        """
    )
    def test_completed_basket_cannot_be_checked_out_again(self, customer_steps: CheckoutSteps):
        with allure.step("Complete a grocery purchase"):
            catalogue = customer_steps.cart()
            customer_steps.replace_cart(CheckoutCartFactory.create(catalogue=catalogue.available_products))
            checkout_request = CheckoutOrderRequest(payment_method=PaymentMethod.CASH)
            order = customer_steps.checkout(checkout_request)
            check_checkout_order(order, PaymentMethod.CASH)

        with allure.step("Reject another purchase of the consumed basket"):
            response = customer_steps.post_checkout(checkout_request)
            error = response.assert_status_code(HTTPStatus.BAD_REQUEST).extract(CheckoutErrorResponse.model_validate)
            check_error(error, ErrorCode.EMPTY_CART)
            check_empty_cart(customer_steps.cart())
