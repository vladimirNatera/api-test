import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from src.reporting.allure_server import AllureReportingError, publish_results

E2E_DIRECTORY = Path(__file__).resolve().parent
RESULTS_DIRECTORY = E2E_DIRECTORY / "allure-results"
JUNIT_DIRECTORY = E2E_DIRECTORY / "test-results"


def _write_environment() -> None:
    try:
        parsed_url = urlsplit(os.environ.get("API_URL", "http://127.0.0.1:3000"))
        hostname = parsed_url.hostname or ""
        if ":" in hostname:
            hostname = f"[{hostname}]"
        if parsed_url.port:
            hostname = f"{hostname}:{parsed_url.port}"
        api_url = urlunsplit((parsed_url.scheme, hostname, parsed_url.path, "", ""))
    except ValueError:
        api_url = "invalid API_URL"
    (RESULTS_DIRECTORY / "environment.properties").write_text(f"API_URL={api_url}\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run checkout API E2E tests and optionally publish an Allure report", allow_abbrev=False
    )
    publish_options = parser.add_mutually_exclusive_group()
    publish_options.add_argument("--publish", action="store_true", help="Publish results after pytest finishes")
    publish_options.add_argument(
        "--publish-only", action="store_true", help="Publish existing results without running pytest"
    )
    parser.add_argument("--allure-server", default=os.environ.get("ALLURE_SERVER_URL", "http://localhost:5050"))
    parser.add_argument("--project-id", default="checkout-api")
    options, pytest_arguments = parser.parse_known_args()
    if options.publish_only and pytest_arguments:
        parser.error("--publish-only cannot be combined with pytest arguments")
    if pytest_arguments[:1] == ["--"]:
        pytest_arguments = pytest_arguments[1:]

    pytest_status = 0
    if not options.publish_only:
        if RESULTS_DIRECTORY.is_symlink():
            parser.error("The Allure results directory must not be a symbolic link")
        if JUNIT_DIRECTORY.is_symlink():
            parser.error("The JUnit results directory must not be a symbolic link")
        if RESULTS_DIRECTORY.exists():
            shutil.rmtree(RESULTS_DIRECTORY)
        RESULTS_DIRECTORY.mkdir()
        JUNIT_DIRECTORY.mkdir(exist_ok=True)
        (JUNIT_DIRECTORY / "junit.xml").unlink(missing_ok=True)
        pytest_status = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                *pytest_arguments,
                f"--alluredir={RESULTS_DIRECTORY}",
                f"--junitxml={JUNIT_DIRECTORY / 'junit.xml'}",
            ],
            cwd=E2E_DIRECTORY,
            check=False,
        ).returncode
        try:
            _write_environment()
        except OSError as error:
            print(f"Allure environment metadata could not be written: {error}", file=sys.stderr)
            return pytest_status or 1

    if options.publish or options.publish_only:
        try:
            report_url = publish_results(RESULTS_DIRECTORY, options.allure_server, options.project_id)
        except (AllureReportingError, OSError, ValueError) as error:
            print(f"Allure publication failed: {error}", file=sys.stderr)
            return pytest_status or 1
        print(f"Allure report: {report_url}")
    return pytest_status


if __name__ == "__main__":
    sys.exit(main())
