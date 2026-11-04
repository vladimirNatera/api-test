from http import HTTPStatus

import allure

from src.http.response import ResponseWrapper
from src.http.steps import HttpSteps
from src.models.checkout.request import (
    CheckoutCartRequest,
    CheckoutLoginRequest,
    CheckoutOrderRequest,
    CheckoutRegistrationRequest,
)
from src.models.checkout.response import (
    CheckoutCartResponse,
    CheckoutLoginResponse,
    CheckoutOrderResponse,
    CheckoutUser,
)


class CheckoutRequestSteps(HttpSteps):
    REGISTRATION_PATH = "/api/registration"
    LOGIN_PATH = "/api/login"
    CART_PATH = "/api/cart"
    CHECKOUT_PATH = "/api/checkout"

    @allure.step("Call checkout registration")
    def post_registration(self, request: CheckoutRegistrationRequest) -> ResponseWrapper:
        body = request.model_dump(mode="json", by_alias=True)
        body["password"] = request.password.get_secret_value()
        return self.request("POST", self.REGISTRATION_PATH, body)

    @allure.step("Call checkout login")
    def post_login(self, request: CheckoutLoginRequest) -> ResponseWrapper:
        body = request.model_dump(mode="json", by_alias=True)
        body["password"] = request.password.get_secret_value()
        return self.request("POST", self.LOGIN_PATH, body)

    @allure.step("Read the customer cart and product catalogue")
    def get_cart(self) -> ResponseWrapper:
        return self.request("GET", self.CART_PATH)

    @allure.step("Replace the customer cart")
    def put_cart(self, request: CheckoutCartRequest) -> ResponseWrapper:
        return self.request("PUT", self.CART_PATH, request.model_dump(mode="json", by_alias=True))

    @allure.step("Call checkout")
    def post_checkout(self, request: CheckoutOrderRequest) -> ResponseWrapper:
        return self.request("POST", self.CHECKOUT_PATH, request.model_dump(mode="json", by_alias=True))


class CheckoutSteps(CheckoutRequestSteps):
    @allure.step("Register a customer")
    def register(self, request: CheckoutRegistrationRequest) -> CheckoutUser:
        return (
            self.post_registration(request).assert_status_code(HTTPStatus.CREATED).extract(CheckoutUser.model_validate)
        )

    @allure.step("Sign in to checkout")
    def login(self, request: CheckoutLoginRequest) -> CheckoutLoginResponse:
        return self.post_login(request).assert_status_code(HTTPStatus.OK).extract(CheckoutLoginResponse.model_validate)

    @allure.step("Retrieve the customer cart and available products")
    def cart(self) -> CheckoutCartResponse:
        return self.get_cart().assert_status_code(HTTPStatus.OK).extract(CheckoutCartResponse.model_validate)

    @allure.step("Save the customer shopping cart")
    def replace_cart(self, request: CheckoutCartRequest) -> CheckoutCartResponse:
        return self.put_cart(request).assert_status_code(HTTPStatus.OK).extract(CheckoutCartResponse.model_validate)

    @allure.step("Place the customer order")
    def checkout(self, request: CheckoutOrderRequest) -> CheckoutOrderResponse:
        return (
            self.post_checkout(request)
            .assert_status_code(HTTPStatus.CREATED)
            .extract(CheckoutOrderResponse.model_validate)
        )
