import os
from dataclasses import dataclass

from pydantic import SecretStr


@dataclass(frozen=True)
class CheckoutSettings:
    api_url: str
    admin_login: str
    admin_password: SecretStr

    @classmethod
    def from_environment(cls) -> CheckoutSettings:
        return cls(
            api_url=os.getenv("API_URL", "http://127.0.0.1:3000").rstrip("/"),
            admin_login=os.getenv("E2E_ADMIN_LOGIN", "admin"),
            admin_password=SecretStr(os.getenv("E2E_ADMIN_PASSWORD", "Qwerty123!")),
        )
