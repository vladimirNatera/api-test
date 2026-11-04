from collections.abc import Callable
from http import HTTPStatus
from typing import Any, Self

import allure
import requests
from assertpy import assert_that


class ResponseWrapper:
    def __init__(self, response: requests.Response) -> None:
        self.response = response

    @allure.step("Check the response status")
    def assert_status_code(self, expected_status: HTTPStatus) -> Self:
        assert_that(self.response.status_code).described_as("HTTP response status").is_equal_to(expected_status)
        return self

    @allure.step("Validate the response contract")
    def extract[ResponseModel](self, validator: Callable[[Any], ResponseModel]) -> ResponseModel:
        return validator(self.response.json())
