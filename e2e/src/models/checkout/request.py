from datetime import date

from pydantic import SecretStr

from src.models.checkout.base import CheckoutModel
from src.models.enums.payment_method import PaymentMethod


class CheckoutRegistrationRequest(CheckoutModel):
    email: str
    password: SecretStr
    name: str
    date_of_birth: date


class CheckoutLoginRequest(CheckoutModel):
    login: str
    password: SecretStr


class CheckoutCartItemRequest(CheckoutModel):
    product_id: int
    quantity: int


class CheckoutCartRequest(CheckoutModel):
    items: list[CheckoutCartItemRequest]


class CheckoutOrderRequest(CheckoutModel):
    payment_method: PaymentMethod
