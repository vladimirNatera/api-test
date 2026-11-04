# Python E2E business scenarios

These tests drive the running Express API over HTTP with real PostgreSQL storage. They cover customer journeys and persistent state. Request validation boundaries, mocked failures, and pricing function branches remain in the JavaScript unit suite.

## Start the application and Allure server

Run these commands from the repository root. Install Docker Compose and `uv`; the test project requires Python 3.14.

```sh
docker compose up --build -d
docker compose -f compose.allure.yaml up -d --wait
uv sync --frozen --project e2e
uv run --frozen --project e2e python e2e/run.py --publish
```

The application starts on port `3000`. Allure runs in its own Compose project on port `5050`, bound to localhost. The runner prints the report URL after publishing:

<http://localhost:5050/allure-docker-service/projects/checkout-api/reports/latest/index.html>

Each run uploads the Allure result files and HTTP attachments to the server and generates a report. Reports retain history in the `allure-projects` Docker volume. Publishing also runs when tests fail, and the command keeps the failing test exit status. A reporting failure also makes the command fail.

```sh
docker compose -f compose.allure.yaml logs -f allure
docker compose -f compose.allure.yaml down
```

Stopping the server preserves reports. Adding `--volumes` removes its stored report history.

## Scenarios

- Register a new customer, sign in, and access their own empty cart.
- Sign in with the seeded admin account and access the catalogue.
- Sign in again and recover a previously saved shopping cart.
- Reject duplicate email registration while preserving the original account.
- Browse groceries and add selected products to the cart.
- Complete a cash or credit-card purchase and check the persisted response and emptied cart.
- Prevent the same consumed cart from being checked out again.
- Keep another customer's cart intact when a purchase is completed.

The cash and card scenarios use an independent business example: two milks plus one bread cost **680 cents**. Cash receives a **68-cent discount** and costs **612 cents**; a credit card costs **680 cents**. The tests do not import application code or reproduce its pricing implementation.

The existing API exposes products as `availableProducts` in the cart response, so catalogue tests use that public route. Every customer journey creates a unique email address. The tests use the seeded admin only for reads and can be rerun against the same database. They create customer accounts and orders; use a development or CI database.

## Configuration and focused runs

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_URL` | `http://127.0.0.1:3000` | Running checkout API |
| `E2E_ADMIN_LOGIN` | `admin` | Seeded account for the admin sign-in scenario |
| `E2E_ADMIN_PASSWORD` | `Qwerty123!` | Seeded demo password |
| `ALLURE_SERVER_URL` | `http://localhost:5050` | Server used with `--publish` |

```sh
API_URL=http://localhost:33000 uv run --frozen --project e2e python e2e/run.py --publish
uv run --frozen --project e2e python e2e/run.py --publish -m checkout
uv run --frozen --project e2e python e2e/run.py -m accounts
uv run --frozen --project e2e python e2e/run.py --publish-only
```

Without `--publish`, tests generate local artifacts without requiring an Allure server. `--publish-only` uploads existing results, including results downloaded from CI. Use `--project-id` to select another Allure project, or `--allure-server` to override the reporting URL.

The runner cleans `e2e/allure-results/` before each test run to prevent old results from appearing in a new report. Artifacts are stored in:

- `e2e/allure-results/`: Allure results, environment information, and HTTP attachments.
- `e2e/test-results/junit.xml`: JUnit test results.

## Structure and style

```text
e2e/
  src/
    config/       Environment settings
    constants/    Business expectations
    factories/    Unique customer and cart data
    models/       Separate typed request/response models and enums
    http/         HTTP client, response wrapper, redacted attachments
    steps/        Raw request methods and validated business methods
    services/     Service-step factories
    assertions/   Reusable business assertions
    reporting/    Allure server publishing
    utils/        Allure parameterized titles
  tests/
    fixtures/     Test clients and customer setup
    features/     Account and checkout journeys
  run.py          Test execution and optional report publishing
  pyproject.toml
  uv.lock
```

Tests use BP-style user stories, named Allure steps, feature classes, typed models, factory-generated data, and reusable `assertpy` assertions. Paths live in request-step classes. Successful calls validate their status and response model; business rejection cases use raw request methods and check both status and domain error code.

`ECOM-*` identifiers are stable local test-case identifiers for this standalone Allure report, not IDs assigned by a corporate Allure TestOps instance. Passwords and access tokens are masked in models and redacted from HTTP attachments.

```sh
uv run --frozen --project e2e ruff check e2e
uv run --frozen --project e2e ruff format --check e2e
uv run --frozen --project e2e pytest e2e/tests --collect-only
```

## CI

The GitHub Actions `e2e-tests` job installs the locked Python dependencies, checks Ruff formatting and lint rules, starts PostgreSQL and the API, and runs these business scenarios. Any failed test fails the job. The `e2e-test-results` artifact is uploaded even when tests fail and includes Allure files and the JUnit report.

To view CI results locally, download and extract the artifact so its `allure-results/` and `test-results/` directories are under `e2e/`, start the Allure server, and run the `--publish-only` command.
