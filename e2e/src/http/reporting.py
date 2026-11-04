import json
from collections.abc import Mapping
from typing import Any

import allure
from pydantic import SecretStr

SENSITIVE_KEYS = frozenset({"password", "passwordhash", "token", "authorization"})
REDACTED = "[REDACTED]"


def redact(value: Any) -> Any:
    if isinstance(value, SecretStr):
        return REDACTED
    if isinstance(value, Mapping):
        return {
            key: REDACTED if str(key).lower().replace("_", "").replace("-", "") in SENSITIVE_KEYS else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    return value


def attach_json(name: str, content: Any) -> None:
    allure.attach(
        json.dumps(redact(content), indent=2, default=str),
        name=name,
        attachment_type=allure.attachment_type.JSON,
    )
