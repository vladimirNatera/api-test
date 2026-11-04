# Grocery checkout API

An Express 5 REST API written in JavaScript, backed by PostgreSQL 17. It provides registration, login, a grocery cart, and checkout. Cash payments receive a **10% discount**; credit card payments receive no discount. Payment methods are recorded for demonstration; this application does not process real card payments.

## Run with Docker

Install Docker with Compose, then run:

```sh
docker compose up --build -d
docker compose ps
```

The database starts first. The API automatically applies migrations and seeds the demo accounts and 15 groceries. Open:

- API: <http://localhost:3000>
- Swagger UI: <http://localhost:3000/docs>
- OpenAPI YAML: <http://localhost:3000/openapi.yaml>

The API runs as a non-root container user. PostgreSQL data persists in the `postgres_data` named volume. Database access on the host is limited to `127.0.0.1:5432`.

If those ports are already in use, run `API_PORT=33000 POSTGRES_PORT=35432 docker compose up --build -d`. Use port `33000` for API requests and `35432` for host database connections in that case.

```sh
docker compose logs -f api
docker compose down
```

`docker compose down --volumes` also deletes the demo database and its orders. The next startup creates a new database.

## Run locally

Requirements: Node.js 24, npm, and PostgreSQL 17. Docker can supply PostgreSQL while the application runs on your host:

```sh
npm ci
cp .env.example .env
docker compose up -d db
npm run db:migrate
npm run db:seed
npm start
```

For automatic restarts during development, use `npm run dev` instead of `npm start`. With an existing PostgreSQL server, create an empty database and set `DATABASE_URL` in `.env`; the Docker database step is then unnecessary.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL; required |
| `JWT_SECRET` | Token signing secret, at least 32 characters; required |
| `PORT` | HTTP port, default `3000` |

The checked-in configuration and credentials are for a local demo. Use a new random `JWT_SECRET`, separate database credentials, and your own account provisioning before deploying publicly. For example, generate a signing secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. The seed command intentionally creates known demo passwords; omit it for a production database.

## Demo accounts and groceries

| Login | Password | Role |
| --- | --- | --- |
| `admin` or `admin@example.com` | `Qwerty123!` | Admin |
| `user01@example.com` through `user10@example.com` | `DemoUser123!` | Customer |

The ten customers receive randomly selected fictional names and dates of birth when first seeded. Emails are stable so the accounts are easy to use. Re-running migrations and seeds is safe: existing users, passwords, carts, and orders are preserved. Admin can use the same cart and checkout routes as customers; no extra admin routes are exposed.

| Product ID | Product | Price (USD cents) |
| --- | --- | ---: |
| 1 | Milk | 250 |
| 2 | Bread | 180 |
| 3 | Apple | 75 |
| 4 | Banana | 60 |
| 5 | Orange | 90 |
| 6 | Pear | 85 |
| 7 | Grapes | 350 |
| 8 | Strawberries | 400 |
| 9 | Eggs | 320 |
| 10 | Cheese | 450 |
| 11 | Butter | 275 |
| 12 | Yogurt | 120 |
| 13 | Rice | 220 |
| 14 | Pasta | 160 |
| 15 | Tomato | 65 |

## API

There are four business paths. `/api/cart` supports both reading and replacing the cart. `/docs` and `/openapi.yaml` provide the requested documentation.

| Method | Path | Purpose | Authentication |
| --- | --- | --- | --- |
| `POST` | `/api/registration` | Create a customer | Public |
| `POST` | `/api/login` | Issue a token valid for one hour | Public |
| `GET` | `/api/cart` | Read your cart and the product catalogue | Bearer token |
| `PUT` | `/api/cart` | Replace your entire cart | Bearer token |
| `POST` | `/api/checkout` | Save an order and clear your cart | Bearer token |

Request bodies use JSON and are limited to 32 KB. Unknown request fields are rejected. Passwords are hashed before storage and never returned. Email uniqueness is case insensitive and enforced by PostgreSQL, including simultaneous registration requests.

### Register and log in

```sh
curl --fail-with-body -X POST http://localhost:3000/api/registration \
  -H 'Content-Type: application/json' \
  -d '{"email":"alex@example.com","password":"ExamplePass123!","name":"Alex Morgan","dateOfBirth":"1995-06-15"}'
```

Registration requires an email of at most 254 characters, a password of at least 8 Unicode characters and at most 72 UTF-8 bytes, a name of 1–100 characters after trimming, and a real `YYYY-MM-DD` date between `1900-01-01` and today in UTC. Email addresses are trimmed and lowercased. A duplicate returns `400 Bad Request` with `{"error":{"code":"EMAIL_EXISTS","message":"User exists"}}`.

Use the seeded admin account immediately, or substitute your registered email and password:

```sh
TOKEN=$(curl --fail-with-body -sS -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"Qwerty123!"}' \
  | node -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).token')
```

### Read and fill the cart

```sh
curl --fail-with-body http://localhost:3000/api/cart \
  -H "Authorization: Bearer $TOKEN"

curl --fail-with-body -X PUT http://localhost:3000/api/cart \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":1,"quantity":2},{"productId":2,"quantity":1}]}'
```

The cart response contains `availableProducts`, so a separate product endpoint is unnecessary. A cart accepts at most 20 distinct product IDs with integer quantities from 1 through 99. Repeated IDs, fractional quantities, and unknown products are rejected. `PUT` replaces all items; sending `{"items":[]}` clears the cart. Prices always come from the database.

### Check out

```sh
curl --fail-with-body -X POST http://localhost:3000/api/checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"paymentMethod":"cash"}'
```

Two milks and one bread cost `680` cents. Cash gives a `68` cent discount and a `612` cent total. The same cart with `"paymentMethod":"credit_card"` costs `680` cents. A successful checkout clears the cart, so refill it before trying the other payment method.

All money is stored and returned as integer USD cents. The cash discount is `Math.round(subtotalCents * 0.1)`, including half-cent rounding upward. An empty cart cannot be checked out. Saving the order and clearing the cart use one database transaction, with concurrent changes to a user's cart serialized.

Errors use `{"error":{"code":"...","message":"..."}}`. Typical statuses are `400` for invalid input, duplicate emails, or an empty checkout, `401` for invalid credentials or tokens, `404` for unknown routes or products, and `413` for oversized JSON bodies. Registration and checkout return `201`; login and cart operations return `200`.

## Tests and coverage

```sh
npm run build
npm run lint
npm test
npm run test:coverage
```

`build` checks JavaScript syntax. `lint` checks JavaScript rules and validates `openapi.yaml`. Unit tests are in `tests/unit` and use Jest with HTTP tests through Supertest. They do not need a running database. Test cases use equivalence classes and boundary values for registration, authentication, cart inputs, and payment methods, including cash rounding and invalid requests.

Coverage reports are generated in `coverage/`, including an HTML report at `coverage/lcov-report/index.html` and machine-readable JSON. The quality gate checks **statements, branches, functions, and lines** against `coverage-baseline.json`; none may decrease.

The initial baseline is **100% for all four metrics**. Coverage measures every reusable module under `src/`, including routes, authentication, validation, pricing, storage, migrations, and seeds. The process entry point `src/server.js` and command-line scripts are outside the unit coverage percentage; application startup and database wiring are exercised by the integration job.

The checked-in baseline must also match the current coverage percentages. When new tests increase coverage, record the improvement after generating the report:

```sh
npm run coverage:update
npm run test:coverage
```

Commit `coverage-baseline.json` with the related changes. The update command refuses decreases. In CI, the gate additionally compares the baseline from the PR target commit or the preceding push commit, so lowering the baseline in the same change cannot bypass the gate. On the first introduction of coverage, only the new checked-in baseline is available.

Run the PostgreSQL integration checks against a running, migrated, seeded application:

```sh
API_URL=http://localhost:3000 npm run test:integration
```

These checks make real HTTP requests and write test data, so use a development or CI database.

## GitHub Actions

`.github/workflows/ci.yml` runs on every push and pull request, including subsequent commits to an open PR:

1. `build`: install dependencies, check syntax, and build the Docker image.
2. `linters`: run ESLint and OpenAPI validation.
3. `unit-tests`: run tests, enforce the coverage gate, and upload coverage artifacts.
4. `integration`: start PostgreSQL, migrate and seed it, start the API, and run the integration checks after the first three jobs pass.

The workflow uses read-only repository permissions. To prevent merging failed checks, configure a GitHub branch ruleset requiring these job checks on `main`.

## Python E2E business tests

The `e2e/` project covers registration, login, catalogue browsing, cart persistence, cash/card checkout, duplicate accounts, and cart ownership through the real API and PostgreSQL. Its structure separates typed models, factories, service steps, business assertions, and tests. Allure reports include business stories, named steps, and redacted HTTP attachments.

```sh
docker compose up --build -d
docker compose -f compose.allure.yaml up -d --wait
uv sync --frozen --project e2e
uv run --frozen --project e2e python e2e/run.py --publish
```

Requires Python 3.14 and `uv`. The Allure server runs at <http://localhost:5050>; the runner prints a link to the generated report. The additional GitHub Actions `e2e-tests` job runs Python lint checks and business scenarios, then uploads Allure and JUnit artifacts even when tests fail.

See [the E2E README](e2e/README.md) for scenario details, configuration, focused runs, report publishing, and project structure.
