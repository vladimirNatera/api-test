from datetime import date, datetime
from uuid import UUID

from pydantic import SecretStr

from src.models.checkout.base import CheckoutModel
from src.models.enums.error_code import ErrorCode
from src.models.enums.payment_method import PaymentMethod


class CheckoutUser(CheckoutModel):
    id: UUID
    email: str
    name: str
    date_of_birth: date
    role: str


class CheckoutLoginResponse(CheckoutModel):
    token: SecretStr
    token_type: str
    expires_in: int
    user: CheckoutUser


class CheckoutProduct(CheckoutModel):
    id: int
    name: str
    price_cents: int


class CheckoutCartItem(CheckoutModel):
    product_id: int
    name: str
    unit_price_cents: int
    quantity: int
    line_total_cents: int


class CheckoutCartResponse(CheckoutModel):
    items: list[CheckoutCartItem]
    currency: str
    subtotal_cents: int
    available_products: list[CheckoutProduct]


class CheckoutOrderResponse(CheckoutModel):
    id: UUID
    created_at: datetime
    items: list[CheckoutCartItem]
    currency: str
    subtotal_cents: int
    discount_cents: int
    total_cents: int
    payment_method: PaymentMethod


class CheckoutError(CheckoutModel):
    code: ErrorCode
    message: str


class CheckoutErrorResponse(CheckoutModel):
    error: CheckoutError
