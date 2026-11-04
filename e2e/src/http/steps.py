from types import TracebackType
from typing import Any, Self

import requests
from pydantic import SecretStr

from src.http.reporting import attach_json
from src.http.response import ResponseWrapper


class HttpSteps:
    def __init__(self, base_url: str, token: SecretStr | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json"})
        if token is not None:
            self.session.headers["Authorization"] = f"Bearer {token.get_secret_value()}"

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self.session.close()

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> ResponseWrapper:
        url = f"{self.base_url}{path}"
        attach_json(
            "HTTP request",
            {"method": method, "url": url, "headers": dict(self.session.headers), "body": body},
        )
        response = self.session.request(method, url, json=body, timeout=10, allow_redirects=False)
        try:
            response_body = response.json()
        except requests.exceptions.JSONDecodeError:
            response_body = "[Non-JSON response body omitted]"
        attach_json(
            "HTTP response",
            {"status": response.status_code, "headers": dict(response.headers), "body": response_body},
        )
        return ResponseWrapper(response)
