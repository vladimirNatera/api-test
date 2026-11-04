from collections.abc import Iterator

import pytest

from src.config.settings import CheckoutSettings
from src.factories.checkout_factories import CheckoutRegistrationFactory
from src.models.checkout.request import CheckoutLoginRequest, CheckoutRegistrationRequest
from src.models.checkout.response import CheckoutLoginResponse, CheckoutUser
from src.services.checkout_service import checkout_steps
from src.steps.checkout_steps.checkout_steps import CheckoutSteps


@pytest.fixture(scope="session")
def checkout_settings() -> CheckoutSettings:
    return CheckoutSettings.from_environment()


@pytest.fixture
def anonymous_steps(checkout_settings: CheckoutSettings) -> Iterator[CheckoutSteps]:
    with checkout_steps(checkout_settings.api_url) as service:
        yield service


@pytest.fixture
def registration_request() -> CheckoutRegistrationRequest:
    return CheckoutRegistrationFactory.create()


@pytest.fixture
def registered_customer(
    anonymous_steps: CheckoutSteps,
    registration_request: CheckoutRegistrationRequest,
) -> CheckoutUser:
    return anonymous_steps.register(registration_request)


@pytest.fixture
def customer_login_request(
    registered_customer: CheckoutUser,
    registration_request: CheckoutRegistrationRequest,
) -> CheckoutLoginRequest:
    return CheckoutLoginRequest(login=registered_customer.email, password=registration_request.password)


@pytest.fixture
def customer_login(
    anonymous_steps: CheckoutSteps,
    customer_login_request: CheckoutLoginRequest,
) -> CheckoutLoginResponse:
    return anonymous_steps.login(customer_login_request)


@pytest.fixture
def customer_steps(
    checkout_settings: CheckoutSettings,
    customer_login: CheckoutLoginResponse,
) -> Iterator[CheckoutSteps]:
    with checkout_steps(checkout_settings.api_url, token=customer_login.token) as service:
        yield service


@pytest.fixture
def another_customer_steps(
    checkout_settings: CheckoutSettings,
    anonymous_steps: CheckoutSteps,
) -> Iterator[CheckoutSteps]:
    registration_request = CheckoutRegistrationFactory.create()
    customer = anonymous_steps.register(registration_request)
    login = anonymous_steps.login(CheckoutLoginRequest(login=customer.email, password=registration_request.password))
    with checkout_steps(checkout_settings.api_url, token=login.token) as service:
        yield service
