-- Bancada: schema inicial (ARCHITECTURE.md, seção 6).
-- Dinheiro sempre em centavos (INTEGER). Produtos nunca são apagados (order_items aponta para eles).

CREATE TYPE order_status AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED');

CREATE TABLE products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL,
  name        text NOT NULL,
  description text NOT NULL,
  category    text NOT NULL,
  price_cents integer NOT NULL,
  stock       integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  image_key   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_slug_key UNIQUE (slug),
  CONSTRAINT products_price_positive CHECK (price_cents > 0),
  -- Última barreira: applyStockMovement traduz a violação desta constraint.
  CONSTRAINT products_stock_nonnegative CHECK (stock >= 0)
);

CREATE TABLE admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admins_email_key UNIQUE (email),
  CONSTRAINT admins_email_lowercase CHECK (email = lower(email))
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  text NOT NULL,
  request_hash     text NOT NULL,
  customer_name    text NOT NULL,
  customer_email   text NOT NULL,
  status           order_status NOT NULL DEFAULT 'PENDING',
  total_cents      integer NOT NULL,
  payment_provider text NOT NULL,
  checkout_id      text,
  checkout_url     text,
  -- O ÚLTIMO pagamento que mudou o status; o histórico completo está em payment_events.
  payment_id       text,
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT orders_total_positive CHECK (total_cents > 0)
);

CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_created_at_idx ON orders (created_at DESC);

-- Snapshot do momento da compra. Único ON DELETE CASCADE do schema.
CREATE TABLE order_items (
  id               bigserial PRIMARY KEY,
  order_id         uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES products (id),
  product_name     text NOT NULL,
  unit_price_cents integer NOT NULL,
  quantity         integer NOT NULL,
  CONSTRAINT order_items_unit_price_positive CHECK (unit_price_cents > 0),
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);

-- Livro-razão: products.stock == SUM(delta) dos movimentos do produto.
CREATE TABLE stock_movements (
  id          bigserial PRIMARY KEY,
  product_id  uuid NOT NULL REFERENCES products (id),
  delta       integer NOT NULL,
  reason      text NOT NULL,
  order_id    uuid REFERENCES orders (id),
  admin_id    uuid REFERENCES admins (id),
  note        text,
  stock_after integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_delta_nonzero CHECK (delta <> 0),
  CONSTRAINT stock_movements_reason_valid CHECK (
    reason IN ('initial', 'restock', 'adjustment', 'order', 'order_cancelled')
  )
);

CREATE INDEX stock_movements_product_created_idx ON stock_movements (product_id, created_at DESC);

-- Deduplica webhooks: cada (provider, payment_id, status) é processado uma única vez.
CREATE TABLE payment_events (
  id           bigserial PRIMARY KEY,
  provider     text NOT NULL,
  payment_id   text NOT NULL,
  status       text NOT NULL,
  order_id     uuid REFERENCES orders (id),
  amount_cents integer NOT NULL,
  -- Preenchido depois de processar o evento (no mesmo COMMIT).
  outcome      text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_dedupe_key UNIQUE (provider, payment_id, status)
);
