from pydantic import SecretStr

from src.steps.checkout_steps.checkout_steps import CheckoutSteps


def checkout_steps(base_url: str, token: SecretStr | None = None) -> CheckoutSteps:
    return CheckoutSteps(base_url=base_url, token=token)
