from uuid import uuid4

import factory
from pydantic import SecretStr

from src.constants.checkout import (
    BREAD_PRODUCT_ID,
    BREAD_QUANTITY,
    MILK_PRODUCT_ID,
    MILK_QUANTITY,
)
from src.models.checkout.request import (
    CheckoutCartItemRequest,
    CheckoutCartRequest,
    CheckoutRegistrationRequest,
)
from src.models.checkout.response import CheckoutProduct


def build_checkout_cart_items(
    catalogue: list[CheckoutProduct] | None,
    milk_quantity: int,
    bread_quantity: int,
) -> list[CheckoutCartItemRequest]:
    product_ids = (
        {product.name: product.id for product in catalogue}
        if catalogue is not None
        else {"Milk": MILK_PRODUCT_ID, "Bread": BREAD_PRODUCT_ID}
    )
    return [
        CheckoutCartItemRequest(product_id=product_ids["Milk"], quantity=milk_quantity),
        CheckoutCartItemRequest(product_id=product_ids["Bread"], quantity=bread_quantity),
    ]


class CheckoutRegistrationFactory(factory.Factory):
    class Meta:
        model = CheckoutRegistrationRequest

    email = factory.LazyFunction(lambda: f"e2e-{uuid4().hex}@example.com")
    password = factory.LazyFunction(lambda: SecretStr(f"E2e!{uuid4().hex}"))
    name = factory.Faker("name", locale="en_US")
    date_of_birth = factory.Faker("date_of_birth", minimum_age=18, maximum_age=70)


class CheckoutCartFactory(factory.Factory):
    class Meta:
        model = CheckoutCartRequest

    class Params:
        catalogue = None
        milk_quantity = MILK_QUANTITY
        bread_quantity = BREAD_QUANTITY

    items = factory.LazyAttribute(
        lambda attributes: build_checkout_cart_items(
            attributes.catalogue, attributes.milk_quantity, attributes.bread_quantity
        )
    )
