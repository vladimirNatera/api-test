import base64
import json
import re
from http import HTTPStatus
from pathlib import Path
from urllib.parse import urlsplit

import requests


class AllureReportingError(RuntimeError):
    pass


def _api_base_url(server_url: str) -> str:
    parsed_url = urlsplit(server_url)
    if (
        parsed_url.scheme not in {"http", "https"}
        or not parsed_url.hostname
        or parsed_url.username
        or parsed_url.password
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise AllureReportingError("Allure server must be an HTTP(S) URL without credentials or query parameters")
    server_url = server_url.rstrip("/")
    if server_url.endswith("/allure-docker-service"):
        return server_url
    return f"{server_url}/allure-docker-service"


def _collect_results(results_directory: Path) -> list[dict[str, str]]:
    if results_directory.is_symlink():
        raise AllureReportingError("The Allure results directory must not be a symbolic link")
    result_files = list(results_directory.glob("*-result.json"))
    if not result_files:
        raise AllureReportingError(f"No Allure test results found in {results_directory}")
    for result_file in result_files:
        if result_file.is_symlink():
            raise AllureReportingError("Allure results must not contain symbolic links")
        result = json.loads(result_file.read_text(encoding="utf-8"))
        if not isinstance(result, dict) or not result.get("uuid") or not result.get("name"):
            raise AllureReportingError(f"Invalid Allure test result: {result_file.name}")
    results = []
    for artifact in sorted(results_directory.iterdir()):
        if artifact.is_symlink():
            raise AllureReportingError("Allure results must not contain symbolic links")
        if artifact.is_file():
            results.append(
                {
                    "file_name": artifact.name,
                    "content_base64": base64.b64encode(artifact.read_bytes()).decode("ascii"),
                }
            )
    return results


def _request(
    session: requests.Session,
    method: str,
    url: str,
    *,
    params: dict[str, str] | None = None,
    payload: dict | None = None,
    allow_missing: bool = False,
) -> requests.Response:
    try:
        response = session.request(
            method,
            url,
            params=params,
            json=payload,
            timeout=(5, 120),
            allow_redirects=False,
        )
    except requests.RequestException as error:
        raise AllureReportingError(f"Allure request failed: {type(error).__name__}") from None
    if allow_missing and response.status_code == HTTPStatus.NOT_FOUND:
        return response
    if not HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES:
        raise AllureReportingError(f"Allure request failed with HTTP {response.status_code}")
    return response


def publish_results(results_directory: Path, server_url: str, project_id: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project_id):
        raise AllureReportingError("Allure project ID must contain lowercase letters, digits, underscores or hyphens")
    api_url = _api_base_url(server_url)
    results = _collect_results(results_directory)
    with requests.Session() as session:
        project = _request(session, "GET", f"{api_url}/projects/{project_id}", allow_missing=True)
        if project.status_code != HTTPStatus.NOT_FOUND:
            _request(session, "GET", f"{api_url}/clean-results", params={"project_id": project_id})
        _request(
            session,
            "POST",
            f"{api_url}/send-results",
            params={"project_id": project_id, "force_project_creation": "true"},
            payload={"results": results},
        )
        _request(session, "GET", f"{api_url}/generate-report", params={"project_id": project_id})
    return f"{api_url}/projects/{project_id}/reports/latest/index.html"
