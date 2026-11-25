# Bancada

A full-stack e-commerce store for developer desk gear (keyboards, mice, headsets, stands, hubs, mugs). It is a portfolio project: the focus is not the catalog but getting the **payment flow** and **inventory control** right.

What it proves, with tests against a real PostgreSQL:

- **Idempotent orders**: the same `Idempotency-Key` returns the same order; the same key with a different body is rejected.
- **No double selling under concurrency**: 6 simultaneous orders for 3 units sell exactly 3.
- **Auditable stock**: every movement goes into a ledger (`stock_movements`), and current stock always equals the sum of the deltas.
- **Validated, deduplicated webhook**: the signature is checked, the payment is fetched again from the provider (the body is never trusted), and each event is processed exactly once.
- **Order state machine** with explicit transitions, plus an **admin area** (`httpOnly` cookie login, header-based CSRF protection, direct-to-S3 uploads).

**Stack:** Node 22 and strict TypeScript · Express 5, Zod 4, `pg` with plain SQL (no ORM), Pino · PostgreSQL 16 with `.sql` migrations and a custom runner · official Mercado Pago SDK · S3 (MinIO locally) · React 19, Vite, React Router 7, TanStack Query 5, Zustand 5, React Hook Form · Jest and Vitest · Docker Compose and GitHub Actions. The API, the web app and the shared schemas package live in an npm workspaces monorepo.

**Deploy:** coming soon (T23).

**Real Mercado Pago:** the code uses the official SDK and is tested against a simulated gateway. The end-to-end test with the real Mercado Pago is task T22 and **has not been done yet** (see [Mercado Pago mode](#mercado-pago-mode-planned-not-yet-verified)).

> The UI and the API messages are in Brazilian Portuguese, since the store targets the Brazilian market.

## Screenshots

### Store

![Bancada catalog: asymmetric product grid with prices in a monospaced font and an add-to-cart button](docs/screenshots/01-catalogo.jpg)

_Catalog: products without an image show their category icon, and low-stock products get a badge._

![Cart with the item list, a quantity control capped at the available stock, and the total](docs/screenshots/02-carrinho.jpg)

_Persistent cart (survives a page reload); the quantity never exceeds the stock._

![Checkout form with name, email and a button showing the amount to pay](docs/screenshots/03-checkout.jpg)

_Checkout: the button states how much will be charged, and a double click creates only one order._

![Order page with the Paid badge, the completed steps, the items and the total](docs/screenshots/04-pedido-pago.jpg)

_Order tracking: it polls the API every 3 s while the order is pending and switches to "Paid" on its own._

### Admin

![Admin login screen with email and password fields](docs/screenshots/05-admin-login.jpg)

_Admin login (session in an `httpOnly` cookie)._

![Admin product list with image, price, stock and status](docs/screenshots/06-admin-produtos.jpg)

_Product list, with search by name and a status filter._

![Product edit page with the stock panel: signed adjustment and movement history](docs/screenshots/07-admin-estoque.jpg)

_Stock panel: signed adjustment and the history (the ledger) of the latest movements._

![Admin order list with customer, items, total and an order with the Paid badge](docs/screenshots/08-admin-pedidos.jpg)

_Orders, with a status filter. A paid order has no action; the "Cancel order" button only appears when the server says the order is cancellable (PENDING for more than 30 minutes)._

## How it works

### Payment: from order to webhook

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant W as Web
    participant A as API
    participant D as PostgreSQL
    participant M as Mercado Pago

    C->>W: Pay
    W->>A: POST /orders with Idempotency-Key
    A->>D: BEGIN and lock the products (ORDER BY id FOR UPDATE)
    A->>D: re-check the key, validate stock and sum the total using database prices
    A->>D: write order, items and stock movements, then COMMIT
    Note over A,M: checkout happens OUTSIDE the transaction
    A->>M: create the Preference (external_reference = order id, expires in 30 min)
    M-->>A: checkoutUrl
    A->>D: save checkout_id and checkout_url
    A-->>W: 201 with the order and the checkoutUrl
    W->>M: redirect the customer to pay
    Note over A,M: if the Preference fails, the API returns 502 and the order stays saved. Retrying with the same key completes the checkout without duplicating it.

    C->>M: pays
    M->>A: POST /webhooks/mercadopago
    A->>A: validate the signature (401 if invalid)
    A->>M: fetch the payment. The webhook body is never trusted.
    A->>D: BEGIN and lock the order (FOR UPDATE)
    A->>D: INSERT into payment_events ON CONFLICT DO NOTHING (dedupe)
    A->>D: apply the state machine and record the outcome, then COMMIT
    A-->>M: 200
    loop every 3 s while the order is PENDING
        W->>A: GET /orders/:id
        A-->>W: current status
    end
    W-->>C: show Paid
```

The same `Idempotency-Key` with the same body returns the same order (200) without reserving stock again. With a different body: `409 IDEMPOTENCY_KEY_REUSED`. The `outcome` recorded for each event is one of `applied`, `no_change`, `invalid_transition`, `amount_mismatch`, `duplicate`, `order_not_found` or `payment_not_found`.

### Stock: a ledger

```mermaid
flowchart TD
    N["Product created (admin)"] -->|"initial"| L
    P["Order created"] -->|"order, negative delta"| L
    W["Webhook cancelled"] -->|"order_cancelled, positive delta"| L
    X["Admin cancels a PENDING order older than 30 min"] -->|"order_cancelled, positive delta"| L
    J["Admin adjusts stock"] -->|"restock or adjustment, signed delta"| L
    R["Webhook refunded or charged_back"] -.->|"does not return stock (D13)"| Z["no movement"]

    L["applyStockMovement: UPDATE products SET stock = stock + delta and INSERT into stock_movements, in the same transaction"]
    L --> S[("products.stock, with constraint stock >= 0")]
    L --> K[("stock_movements, with stock_after")]
    S -.- I["Invariant: stock = sum of the product's movement deltas"]
    K -.- I
```

Every stock change goes through `applyStockMovement`; nothing runs a direct `UPDATE` on `products.stock`. Admin adjustments use the same `SELECT ... FOR UPDATE` as the order flow, so concurrent adjustments and sales don't step on each other. There is no automatic expiration yet: an abandoned order holds its stock until the admin cancels it (see [Next steps](#next-steps)).

### Order state machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: order created with stock reserved
    PENDING --> PAID: payment approved with amount equal to the total
    PENDING --> CANCELLED: cancelled at Mercado Pago or manually by the admin
    PAID --> REFUNDED: refunded or charged_back
    CANCELLED --> [*]
    REFUNDED --> [*]

    note right of CANCELLED
        returns the stock (order_cancelled)
    end note
    note right of REFUNDED
        a refund returns money, not goods, so it does NOT return stock (D13)
    end note
```

There are only three transitions: `PENDING → PAID`, `PENDING → CANCELLED` and `PAID → REFUNDED`. Anything else is recorded as `invalid_transition` and changes nothing. A payment whose amount differs from the order total is not accepted (`amount_mismatch`). `pending`, `in_process`, `authorized` and `rejected` don't change the order (a declined card can retry in the same checkout).

## Design decisions

The full set of decisions (D1 to D33) is in section 13 of [ARCHITECTURE.md](ARCHITECTURE.md), the project's source of truth (written in Portuguese). The main ones:

| Decision                                                                                                                     | Why                                                                                                                                                | Where                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Plain SQL with `pg`, no ORM                                                                                                  | The point is to show transactions, `FOR UPDATE` and constraints explicitly.                                                                        | [D1](ARCHITECTURE.md)                          |
| Money in cents (`INTEGER`)                                                                                                   | Avoids floating-point errors. It only becomes reais when building the Preference and when displayed.                                               | [D2](ARCHITECTURE.md)                          |
| Price always comes from the database                                                                                         | The price sent by the client is ignored: the total is computed on the server.                                                                      | Flow 8.1                                       |
| Idempotency with `Idempotency-Key` + `request_hash`                                                                          | The hash (sha256 of the customer and the normalized items) tells a legitimate replay (200) from key misuse (409).                                  | Flow 8.1                                       |
| Re-check the key after taking the locks                                                                                      | Without it, a simultaneous repeated request would see the stock already reserved by the first one and answer `OUT_OF_STOCK` instead of a replay.   | [D18](ARCHITECTURE.md)                         |
| Product locks in `ORDER BY id`                                                                                               | A single acquisition order prevents deadlocks between orders that share products. Stock returns follow the same order.                             | [D18](ARCHITECTURE.md)                         |
| Checkout (Preference) outside the transaction                                                                                | Never hold a database lock during a network call. If the provider fails, the order stays saved and a retry with the same key completes it.         | Flow 8.1                                       |
| Stock reserved when the order is created                                                                                     | Avoids paying for something that sold out.                                                                                                         | [D5](ARCHITECTURE.md)                          |
| Stock as a ledger (`stock_movements`)                                                                                        | Every change is auditable and stock can be checked against the sum of movements.                                                                   | [D11](ARCHITECTURE.md)                         |
| Webhook re-fetches the payment from the provider                                                                             | The notification body may be forged or stale.                                                                                                      | [D4](ARCHITECTURE.md)                          |
| Lock the order before inserting the `payment_event`                                                                          | In the reverse order the `INSERT` takes `FOR KEY SHARE` on the order (FK) and two simultaneous notifications deadlock. There is a regression test. | [D20](ARCHITECTURE.md)                         |
| Deduplication via `UNIQUE (provider, payment_id, status)`                                                                    | Each combination is processed exactly once, so replays are harmless and the signature check needs no time window.                                  | Section 6 and flow 8.2                         |
| Refunds don't return stock                                                                                                   | A refund returns money, not goods. If the item comes back, the admin adjusts with `restock` and a note.                                            | [D13](ARCHITECTURE.md)                         |
| Preference expires at `created_at` + 30 min; admin cancels abandoned orders                                                  | The expiration matches the manual cancellation window, so an order can never be paid after it becomes cancellable.                                 | [D14](ARCHITECTURE.md), [D19](ARCHITECTURE.md) |
| Payment gateway behind an interface, with a fake implementation                                                              | Runs and tests without credentials.                                                                                                                | [D3](ARCHITECTURE.md)                          |
| Admin session as a JWT in an `httpOnly` cookie                                                                               | Page JavaScript can't read the token (XSS protection).                                                                                             | [D9](ARCHITECTURE.md)                          |
| Header-based CSRF: `X-Requested-With: bancada-web` + `Content-Type: application/json` on every `/auth` and `/admin` mutation | A third-party site can't send a custom header without a CORS preflight, and CORS only allows the web origin.                                       | [D15](ARCHITECTURE.md)                         |
| Image upload via presigned POST straight to S3                                                                               | The API never handles files, and the size limit (2 MB) and declared type are enforced by the signed policy, i.e. by S3 itself.                     | [D10](ARCHITECTURE.md), [D23](ARCHITECTURE.md) |
| Products are never deleted, only deactivated                                                                                 | Keeps order history intact (`order_items` points to them).                                                                                         | [D12](ARCHITECTURE.md)                         |
| Zod schemas in a shared package (`packages/contracts`)                                                                       | One definition for both API validation and web forms.                                                                                              | [D7](ARCHITECTURE.md)                          |
| Seed never overwrites existing products                                                                                      | Running it again (or restarting the container) doesn't undo admin edits.                                                                           | [D17](ARCHITECTURE.md)                         |
| Web checkout with a stable key, also kept in `sessionStorage`                                                                | Reloading the page reuses the key and the server returns the same order; the key expires in 25 minutes, inside the 30-minute window.               | [D28](ARCHITECTURE.md)                         |
| Order status on the web always comes from the API                                                                            | The parameters Mercado Pago appends to the return URL are ignored.                                                                                 | [D29](ARCHITECTURE.md)                         |
| MinIO images from the `pgsty/minio` fork                                                                                     | The official images left Docker Hub and Quay; the code only speaks S3, so swapping the local provider only changes the compose file.               | [D24](ARCHITECTURE.md)                         |
| `docker compose up --build` proven by a CI workflow                                                                          | The author's environment has no Docker; the workflow brings up the whole stack and checks it with `curl`.                                          | [D33](ARCHITECTURE.md)                         |

## Running it

### Everything with Docker

All you need is Docker with Compose. From the repository root:

```bash
docker compose up --build
```

| Service               | Address                                                            |
| --------------------- | ------------------------------------------------------------------ |
| Store and admin (web) | http://localhost:8080                                              |
| API                   | http://localhost:3333 (for example, `GET /health`)                 |
| MinIO console (S3)    | http://localhost:9001 (default username and password `minioadmin`) |
| PostgreSQL            | `localhost:5432` (user, password and database `bancada`)           |

On startup the API runs the migrations and the seed (6 products; the seed never overwrites products that already exist). Then [create the admin](#creating-the-admin) to sign in at `/admin/login`.

> **The compose setup is for development and demos only (D33).** Passwords and `JWT_SECRET` are dev values, the database and MinIO are exposed on local ports, and payments are **simulated** (`PAYMENT_PROVIDER=fake`). This is not a production configuration.

To start only the database and MinIO (with the API and web running outside Docker, as below):

```bash
docker compose up -d db minio minio-init
```

`docker compose down` stops everything; `docker compose down -v` also wipes the data (database and images).

### Local development

Requirements: Node 22 (there's an `.nvmrc`), PostgreSQL 16 and an S3-compatible store (MinIO). The simplest way to get both is the `docker compose up -d db minio minio-init` command above.

```bash
npm install

# configuration (see "Environment variables" below)
cp apps/api/.env.example apps/api/.env      # replace JWT_SECRET with a value of at least 32 characters
cp apps/web/.env.example apps/web/.env

# the schemas package must be built before the API and web can run
npm run build -w @bancada/contracts

npm run migrate -w @bancada/api             # creates the schema
npm run seed -w @bancada/api                # 6 sample products (idempotent)

npm run dev -w @bancada/api                 # API at http://localhost:3333
npm run dev -w @bancada/web                 # store and admin at http://localhost:5173
```

The API doesn't migrate on its own in `dev`: run `migrate` after creating a fresh database. In the Docker image, migrations run on startup.

### Creating the admin

There is no admin sign-up screen or public route: the only way is the script (password of at least 10 characters).

```bash
# local development
npm run admin:create -w apps/api -- --email you@example.com --password '<password>' --name 'Your Name'

# Docker
docker compose exec api node dist/scripts/create-admin.js --email you@example.com --password '<password>' --name 'Your Name'
```

> The password passed in `--password` ends up in the shell history (D21). Reading it from an environment variable is one of the [next steps](#next-steps).

`apps/api/.env.example` includes `ADMIN_DEV_EMAIL` and `ADMIN_DEV_PASSWORD`: a **test credential for local use only** (D30). No code reads these variables; they only document which admin was created in the author's development database.

### Environment variables

Templates: [`apps/api/.env.example`](apps/api/.env.example) and [`apps/web/.env.example`](apps/web/.env.example). The API validates everything on startup (Zod) and fails early, listing the invalid variables. The main ones:

| Variable                                                                                                                    | Purpose                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` (required)                                                                                                   | PostgreSQL connection.                                                                                                                                                                  |
| `TEST_DATABASE_URL`                                                                                                         | Database for the API tests (default `postgres://bancada:bancada@localhost:5432/bancada_test`).                                                                                          |
| `PORT`                                                                                                                      | API port (default 3333).                                                                                                                                                                |
| `WEB_URL`, `API_PUBLIC_URL`                                                                                                 | Web origin (CORS with cookies and payment return links) and the API's public URL (webhook `notification_url`). Defaults `http://localhost:5173` and `:3333`.                            |
| `JWT_SECRET` (required)                                                                                                     | Signs the admin JWT; at least 32 characters.                                                                                                                                            |
| `COOKIE_SAMESITE`                                                                                                           | `lax` (default) or `none`. Ideally web and API share the same site so `lax` can stay.                                                                                                   |
| `PAYMENT_PROVIDER`                                                                                                          | `fake` (default) or `mercadopago`.                                                                                                                                                      |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`                                                                                      | Required with `mercadopago`.                                                                                                                                                            |
| `ALLOW_FAKE_PAYMENTS`                                                                                                       | Allows `PAYMENT_PROVIDER=fake` with `NODE_ENV=production` (by default the API refuses to start that way).                                                                               |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`, `S3_FORCE_PATH_STYLE` | Image storage. Outside production they default to the local MinIO; in production all of them (except `S3_ENDPOINT`, empty on AWS) are required.                                         |
| `S3_PUBLIC_ENDPOINT`                                                                                                        | Optional: the S3 endpoint as the **browser** sees it, used only in the presigned POST `uploadUrl` (in Docker the API uses `http://minio:9000` and the browser `http://localhost:9000`). |
| `BCRYPT_COST`, `TRUST_PROXY`                                                                                                | bcrypt cost (default 12) and proxy trust for the login rate-limit IP (default `false`; behind an ALB or App Runner use `1`).                                                            |
| `LOG_LEVEL`                                                                                                                 | Pino log level (default `info`).                                                                                                                                                        |
| `SEED_ON_START`                                                                                                             | Docker image only: `true` runs the seed before starting the API (the compose file enables it).                                                                                          |
| `VITE_API_URL` (web)                                                                                                        | API URL used by the browser. Required for the production build and **baked into the bundle**: a different URL requires rebuilding the image.                                            |

## Payment modes

The gateway sits behind an interface (`PaymentGateway`), and the `PAYMENT_PROVIDER` variable picks the implementation.

### Fake mode (default)

`PAYMENT_PROVIDER=fake` needs no credentials. It's the mode used by the tests, Docker Compose and development.

- Checkout leads to a simulated page inside the store, `/checkout-simulado/:id`, with a "SIMULATED MODE: no real money is charged" banner and four buttons: **Approve payment**, **Decline payment**, **Cancel order** and **Pay a different amount** (pays `total - R$ 10.00`, or `total + R$ 1.00` if the total is under R$ 10, to exercise `amount_mismatch`).
- The buttons call `POST /dev/payments/simulate`, which goes through the **same** notification handling as the real webhook (same state machine, same deduplication, same stock movements). You can also call it by hand:

  ```bash
  curl -X POST http://localhost:3333/dev/payments/simulate \
    -H 'Content-Type: application/json' \
    -d '{"orderId":"<order id>","status":"approved"}'
  ```

  `status` accepts `approved`, `pending`, `in_process`, `authorized`, `rejected`, `cancelled`, `refunded`, `charged_back` and `in_mediation`; `amountCents` and `paymentId` are optional.

- Simulated payments live in memory: restarting the API forgets them (orders stay in the database).
- This route **only exists with the fake gateway**; with `mercadopago` it returns 404.
- **Production refuses the fake gateway**: with `NODE_ENV=production` and `PAYMENT_PROVIDER=fake` the API won't start unless `ALLOW_FAKE_PAYMENTS=true` (in which case it only logs a warning).

### Mercado Pago mode (planned, not yet verified)

> **Warning:** the Mercado Pago gateway code (Preference, payment lookup and webhook signature validation with the official SDK) exists and is covered by tests with a mocked SDK, but the **end-to-end test with the real Mercado Pago is task T22 and has not been done yet**. What follows describes what is intended, not a verified result. Menu names in the Mercado Pago dashboard may differ.

Use **test credentials only**, never production ones, and never commit real values.

1. In the Mercado Pago developer dashboard, create a Checkout Pro application and get the **test Access Token**. To pay, use the test accounts and cards from Mercado Pago's own documentation.
2. Expose the local API through an HTTPS tunnel, for example `ngrok http 3333`. The API only sends `notification_url` (and `auto_return`) to Mercado Pago when the URLs are HTTPS.
3. Configure the API (`apps/api/.env`):

   ```bash
   PAYMENT_PROVIDER=mercadopago
   MP_ACCESS_TOKEN=<TEST access token>
   MP_WEBHOOK_SECRET=<webhook secret signature, from the dashboard>
   API_PUBLIC_URL=https://<your-tunnel>.ngrok-free.app
   WEB_URL=http://localhost:5173
   ```

4. In the dashboard, register the webhook URL as `<API_PUBLIC_URL>/webhooks/mercadopago`, subscribe to the **payments** event and copy the signing secret into `MP_WEBHOOK_SECRET`. Without this secret the webhook route isn't even registered.
5. Make a purchase: checkout creates the Preference (`external_reference` = order id, items in reais, expires in 30 minutes, `back_urls` pointing to `WEB_URL/pedido/:id`), the customer pays at Mercado Pago and the webhook updates the order. The order page ignores the parameters Mercado Pago appends to the return URL and shows only the status from the API.

The webhook validates the signature (`401 INVALID_SIGNATURE` on failure), **fetches the payment from the provider** instead of trusting the body, and answers `200` to notifications that aren't about payments. A provider error becomes a `5xx` so Mercado Pago retries.

## API endpoints

Envelope: success `{ "data": ... }`; error `{ "error": { "code", "message", "details?" } }`, with a `code` from a closed list (`ErrorCode`, in `packages/contracts`). Mutations (`POST`, `PATCH`, `PUT`, `DELETE`) on `/auth/*` and `/admin/*` require the `X-Requested-With: bancada-web` and `Content-Type: application/json` headers (otherwise `403 CSRF_REJECTED`, D15). Money is always transferred in cents.

| Method  | Route                          | Auth               | Description                                                                                                                                                                                                          |
| ------- | ------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/health`                      | public             | `200`; `500` if the database is down.                                                                                                                                                                                |
| `GET`   | `/products`                    | public             | Active products, with `imageUrl`.                                                                                                                                                                                    |
| `GET`   | `/products/:id`                | public             | `200`, or `404` (including inactive products or a non-UUID id).                                                                                                                                                      |
| `POST`  | `/orders`                      | public             | Creates the order. Requires the `Idempotency-Key` header. `201` created, `200` replay, `400`, `409 OUT_OF_STOCK`, `409 IDEMPOTENCY_KEY_REUSED`, `422 PRODUCT_UNAVAILABLE`, `502 CHECKOUT_UNAVAILABLE`.               |
| `GET`   | `/orders/:id`                  | public             | Order tracking. Public response: no customer name or email; `checkoutUrl` only while `PENDING`.                                                                                                                      |
| `POST`  | `/webhooks/mercadopago`        | provider signature | Payment notification (only exists with `PAYMENT_PROVIDER=mercadopago`). `200`, `401 INVALID_SIGNATURE`; a `5xx` error makes Mercado Pago retry.                                                                      |
| `POST`  | `/dev/payments/simulate`       | none               | Simulates a payment. Only exists with `PAYMENT_PROVIDER=fake`.                                                                                                                                                       |
| `POST`  | `/auth/login`                  | public             | `{ email, password }`. Sets the `bancada_admin` cookie (`httpOnly`) and returns the admin. `401 INVALID_CREDENTIALS` (same response for unknown email and wrong password), `429 RATE_LIMITED` (5 per minute per IP). |
| `POST`  | `/auth/logout`                 | public             | Clears the cookie.                                                                                                                                                                                                   |
| `GET`   | `/auth/me`                     | admin              | The signed-in admin, or `401`.                                                                                                                                                                                       |
| `GET`   | `/admin/products`              | admin              | All products, including inactive ones. Filters `?q=` (name) and `?active=`.                                                                                                                                          |
| `GET`   | `/admin/products/:id`          | admin              | Details and the latest 20 stock movements.                                                                                                                                                                           |
| `POST`  | `/admin/products`              | admin              | Creates a product (`name`, `description`, `category`, `priceCents`, `initialStock`, `imageKey?`). `201`, `409 SLUG_TAKEN`. Strict body: an unknown field returns `400`.                                              |
| `PATCH` | `/admin/products/:id`          | admin              | Edits data, price, `active` and image (`imageKey`: absent keeps it, `null` removes it, a string replaces it). Doesn't change stock or slug.                                                                          |
| `POST`  | `/admin/products/:id/stock`    | admin              | Stock adjustment: `{ delta (non-zero integer), reason: 'restock' \| 'adjustment', note? }`. `409 INVALID_STOCK_ADJUSTMENT` if it would go negative.                                                                  |
| `POST`  | `/admin/uploads/product-image` | admin              | `{ contentType }` (`image/jpeg`, `image/png` or `image/webp`) returns `{ uploadUrl, fields, key }` for the presigned POST. `400 INVALID_FILE_TYPE`.                                                                  |
| `GET`   | `/admin/orders`                | admin              | Paginated orders (`?status=&page=`, 20 per page, newest first). The only place with customer data, and it includes `cancellable` computed on the server.                                                             |
| `POST`  | `/admin/orders/:id/cancel`     | admin              | Cancels a `PENDING` order created more than 30 minutes ago and returns its stock. `404`, `409 ORDER_NOT_CANCELLABLE`.                                                                                                |

`/admin` routes require the admin cookie (`401 UNAUTHORIZED` without it).

## Tests and CI

```bash
npm test                      # contracts (Jest), API (Jest) and web (Vitest)
npm test -w @bancada/api      # API only
npm run lint                  # ESLint at the root
npm run format:check          # Prettier
npm run typecheck             # builds contracts and runs tsc on every workspace
npm run build                 # builds everything
```

**API.** Tests run against a **real** PostgreSQL, with no database mocks, in the `TEST_DATABASE_URL` database (default `postgres://bancada:bancada@localhost:5432/bancada_test`). The `globalSetup` creates the database if needed, recreates the schema and runs the migrations; each test runs `TRUNCATE` and seeds again. It refuses any database whose name doesn't end in `_test`, so it never wipes real data. The S3 integration tests use the real MinIO: without it they **skip with a warning**, and with `REQUIRE_MINIO=true` they **fail** (CI sets this variable):

```bash
docker compose up -d db minio minio-init
REQUIRE_MINIO=true npm test
```

What they cover (among other things): total computed from database prices, replay and concurrency with the same `Idempotency-Key` (a single order), 6 simultaneous orders for 3 units (exactly 3 succeed), gateway failure followed by a retry without duplication, webhook (approved, declined then approved, cancelled with stock returned, refund without stock returned, duplicate, tampered amount, invalid transition, valid and invalid signature, and a deadlock regression with simultaneous notifications), login with the same response for unknown email and wrong password, login rate limit, CSRF, admin adjustments concurrent with orders (final stock equals the sum of movements), manual cancellation and upload.

**Web.** Vitest with Testing Library: forms, cart, checkout, order page with polling, `RequireAdmin`, upload and admin screens. There are no end-to-end browser tests and no automated contrast tests.

**CI (GitHub Actions).**

- `CI` (`.github/workflows/ci.yml`): on every push to `main` and on pull requests, with PostgreSQL as a _service_: `npm ci`, contracts build, lint, `format:check`, typecheck, starts MinIO from `docker-compose.yml` (which also proves `minio` and `minio-init`), `npm test` with `REQUIRE_MINIO=true`, and build.
- `Docker` (`.github/workflows/docker.yml`, D33): brings up the whole stack with `docker compose up --build` and uses `curl` to check the API and the seed (including that an edited price survives a restart), the store (SPA fallback, caching and gzip), the admin (creating the admin via the script, login, `httpOnly` cookie and CORS) and image upload straight to MinIO. Runs on push to `main`, on pull requests touching `apps/api`, `apps/web`, `packages` or the Docker setup, and on demand (Actions tab, "Run workflow").

## Next steps

Current known limitations and what would come next.

**Orders and payments**

- **Automatic order expiration via a job.** Today an abandoned order stays `PENDING` and **holds its stock** until the admin cancels it (only possible after 30 minutes). The Mercado Pago Preference already expires on its own after 30 minutes. A job that cancels expired orders would return the stock without manual work (D14, D28g).
- **Double charges.** A second approved payment (with a different `payment_id`) on an already paid order becomes `no_change` with a log alert; there is no automatic refund (D20d).
- **Testing with the real Mercado Pago** (T22) and **deploy** (T23) haven't been done yet.

**Stock and admin**

- **Idempotency for admin stock adjustments.** The endpoint has no idempotency key: on a network failure, blindly retrying could adjust twice. The screen asks the admin to check the history before retrying (D32a).
- **Authorship only for stock.** Only stock has a ledger; price and `active` edits don't record who made them (D22g).
- **30-minute window.** `created_at` comes from the database clock and "now" from Node; a few seconds of drift between them shifts the cancellation window (D22e).

**Images**

- **Cleaning up orphaned images in S3.** Replacing or removing a product image, or uploading an image and not saving, leaves the old file in the bucket (D16, D31d).
- **Minimum upload size.** The presigned POST policy accepts 0 to 2 MB: the server accepts a 0-byte file (the web app already rejects it) and doesn't validate the actual content, only the declared type and size (D23b).
- **Object existence.** When saving a product, the API doesn't check that the object actually exists in the bucket (D23g).
- **Static S3 credentials** are required in production, which rules out using an IAM role (D23f).

**Authentication and infrastructure**

- **JWT revocation on logout.** The JWT is _stateless_: logout clears the cookie, but a copied token stays valid until it expires (8 h) (D21d).
- **`TRUST_PROXY=1` behind an ALB or App Runner.** The default is `false`; if left unset, all clients share the proxy's IP in the login rate limit (D21c).
- **`admin:create` password from an environment variable.** `--password` on the command line ends up in the shell history (D21e).
- **nginx CSP.** The web image's Content-Security-Policy is in `Report-Only` mode with no report endpoint; promoting it to an enforced `Content-Security-Policy` is left for later (D33f).
- **CORS without `maxAge`.** `X-Requested-With` on every request forces a preflight on each call; consider `maxAge` on the API (D26f).

**Pending now that the repository is public**

- **Fontshare fonts.** Clash Grotesk and General Sans are committed in `apps/web/src/assets/fonts` (self-hosted). Their license (FFL) allows use on your own site but **forbids redistributing the files**, and a public repository distributes them. Remove the `.woff2` files from the repository (and its history) and download them at build time, or switch to freely licensed fonts (D27f, `apps/web/src/assets/fonts/README.md`).
- **Dev credential in `.env.example`.** `apps/api/.env.example` holds the development admin password (`ADMIN_DEV_PASSWORD`); in a public repository it should be replaced with a dummy value (D30g).

## Monorepo structure

```text
bancada/
├── apps/
│   ├── api/                  Express + TypeScript + PostgreSQL
│   │   ├── src/config/       environment variables validated with Zod
│   │   ├── src/db/           pool, migration runner, .sql migrations and seed
│   │   ├── src/modules/      products, orders, payments, stock, auth, admin and storage
│   │   ├── src/shared/       errors, HTTP helpers, slug and CSRF protection
│   │   ├── src/scripts/      create-admin
│   │   ├── test/             tests (Jest + Supertest, against the real Postgres)
│   │   ├── Dockerfile and docker-entrypoint.sh
│   │   └── .env.example
│   └── web/                  React + Vite (store and admin)
│       ├── src/features/     catalog, cart, checkout, orders and admin
│       ├── src/components/   layout, buttons, product image, confirmation dialog
│       ├── Dockerfile and nginx.conf
│       └── .env.example
├── packages/
│   └── contracts/            Zod schemas and types shared between API and web
├── docs/screenshots/         images for this README
├── docker-compose.yml        db, minio, minio-init, api and web
├── .github/workflows/        ci.yml and docker.yml
└── ARCHITECTURE.md, ROADMAP.md, CLAUDE.md
```

The API and the web app import `contracts`; `contracts` imports nothing from the apps, and the API and web never import each other. [ARCHITECTURE.md](ARCHITECTURE.md) is the source of truth (flows, data model, decisions) and [ROADMAP.md](ROADMAP.md) tracks task progress; both are in Portuguese.

## License and fonts

The code is released under the [MIT License](LICENSE). The fonts have their own licenses:

- **Clash Grotesk** and **General Sans** (Fontshare / Indian Type Foundry) are under the ITF Free Font License (FFL): use on your own site is allowed, redistributing the files is not. The official `.woff2` files are in `apps/web/src/assets/fonts`, together with the license (`LICENSE-Fontshare-FFL.txt`). See the note in [Next steps](#next-steps).
- **JetBrains Mono** comes from the `@fontsource-variable/jetbrains-mono` package (SIL Open Font License 1.1).
