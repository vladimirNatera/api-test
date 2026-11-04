"""Customer account journeys through the public API and PostgreSQL."""

from http import HTTPStatus

import allure
import pytest

from src.assertions.checkout_assertions import (
    check_admin_user,
    check_customer_profile,
    check_empty_cart,
    check_error,
    check_known_basket,
    check_product_catalogue,
    check_same_cart,
    check_same_customer,
)
from src.config.settings import CheckoutSettings
from src.factories.checkout_factories import CheckoutCartFactory, CheckoutRegistrationFactory
from src.models.checkout.request import CheckoutLoginRequest, CheckoutRegistrationRequest
from src.models.checkout.response import CheckoutErrorResponse, CheckoutUser
from src.models.enums.error_code import ErrorCode
from src.services.checkout_service import checkout_steps
from src.steps.checkout_steps.checkout_steps import CheckoutSteps

pytestmark = [
    allure.epic("E-commerce"),
    allure.story("Customer accounts"),
    pytest.mark.e2e,
    pytest.mark.accounts,
]


@allure.feature("Customer registration and login")
class TestCustomerAccounts:
    @allure.id("ECOM-001")
    @allure.title("[ECOM] A new customer registers, signs in, and receives an empty cart")
    @allure.description(
        """
        User story:
        As a new customer, I want to register my profile and sign in with my email,
        so that I can start shopping with my own empty cart.

        Service routes - API calls:
        - POST /api/registration creates a unique customer
        - POST /api/login authenticates that customer's credentials
        - GET /api/cart reads the new customer's basket using the issued token
        """
    )
    def test_new_customer_can_register_and_start_shopping(
        self,
        checkout_settings: CheckoutSettings,
        anonymous_steps: CheckoutSteps,
        registration_request: CheckoutRegistrationRequest,
    ):
        with allure.step("Register a customer with a unique email and personal profile"):
            customer = anonymous_steps.register(registration_request)
            check_customer_profile(customer, registration_request)

        with allure.step("Sign in with the registered email and password"):
            login = anonymous_steps.login(
                CheckoutLoginRequest(login=registration_request.email, password=registration_request.password)
            )
            check_same_customer(login.user, customer)

        with allure.step("Start shopping with the new customer's token"):
            with checkout_steps(checkout_settings.api_url, token=login.token) as service:
                cart = service.cart()
            check_empty_cart(cart)

    @allure.id("ECOM-002")
    @allure.title("[ECOM] The seeded administrator can sign in and browse groceries")
    @allure.description(
        """
        User story:
        As the demo administrator, I want to sign in using the supplied admin credentials,
        so that I can verify the seeded application and browse its grocery catalogue.

        Service routes - API calls:
        - POST /api/login authenticates the seeded administrator
        - GET /api/cart returns the grocery catalogue
        """
    )
    def test_seeded_administrator_can_sign_in(
        self,
        checkout_settings: CheckoutSettings,
        anonymous_steps: CheckoutSteps,
    ):
        with allure.step("Sign in using the configured demo administrator credentials"):
            login = anonymous_steps.login(
                CheckoutLoginRequest(
                    login=checkout_settings.admin_login,
                    password=checkout_settings.admin_password,
                )
            )
            check_admin_user(login.user)

        with allure.step("Browse the seeded catalogue as the administrator"):
            with checkout_steps(checkout_settings.api_url, token=login.token) as service:
                cart = service.cart()
            check_product_catalogue(cart)

    @allure.id("ECOM-003")
    @allure.title("[ECOM] A returning customer recovers their saved grocery basket")
    @allure.description(
        """
        User story:
        As a returning customer, I want my saved grocery basket to survive signing in
        through a new client session, so that I can continue shopping later.

        Service routes - API calls:
        - POST /api/registration and POST /api/login prepare a unique customer
        - GET /api/cart discovers products and PUT /api/cart saves a grocery basket
        - POST /api/login obtains a token for a new client session
        - GET /api/cart recovers the same saved basket
        """
    )
    def test_returning_customer_recovers_saved_cart(
        self,
        checkout_settings: CheckoutSettings,
        anonymous_steps: CheckoutSteps,
        customer_steps: CheckoutSteps,
        customer_login_request: CheckoutLoginRequest,
    ):
        with allure.step("Choose groceries and save the customer's basket"):
            catalogue = customer_steps.cart()
            saved_cart = customer_steps.replace_cart(CheckoutCartFactory.create(catalogue=catalogue.available_products))
            check_known_basket(saved_cart)

        with allure.step("Sign in again and open the basket from a new client session"):
            login = anonymous_steps.login(customer_login_request)
            with checkout_steps(checkout_settings.api_url, token=login.token) as returning_customer:
                recovered_cart = returning_customer.cart()
            check_same_cart(recovered_cart, saved_cart)


@allure.feature("Customer account protection")
class TestCustomerAccountErrors:
    @allure.id("ECOM-004")
    @allure.title("[ECOM][N] A duplicate email cannot replace an existing customer's account")
    @allure.description(
        """
        User story:
        As a registered customer, I want my email address to identify exactly one account
        regardless of letter case, so that another registration cannot replace my profile
        or prevent me from signing in with my original password.

        Service routes - API calls:
        - POST /api/registration creates the original customer
        - POST /api/registration rejects another profile with the same email in uppercase
        - POST /api/login still authenticates the original credentials and returns the original profile
        """
    )
    def test_duplicate_email_preserves_original_account(
        self,
        anonymous_steps: CheckoutSteps,
        registered_customer: CheckoutUser,
        registration_request: CheckoutRegistrationRequest,
        customer_login_request: CheckoutLoginRequest,
    ):
        with allure.step("Reject another profile with a case-insensitive duplicate email"):
            duplicate_registration = CheckoutRegistrationFactory.create(email=registration_request.email.upper())
            response = anonymous_steps.post_registration(duplicate_registration)
            error = response.assert_status_code(HTTPStatus.CONFLICT).extract(CheckoutErrorResponse.model_validate)
            check_error(error, ErrorCode.EMAIL_EXISTS)

        with allure.step("Sign in with the original credentials and recover the original profile"):
            login = anonymous_steps.login(customer_login_request)
            check_same_customer(login.user, registered_customer)
            check_customer_profile(login.user, registration_request)
