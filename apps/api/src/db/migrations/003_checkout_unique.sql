-- Bancada: um checkout (cobrança no provedor) pertence a UM pedido (D34, seção 8.9).
-- O webhook da AbacatePay acha o pedido por (payment_provider, checkout_id): a unicidade garante que
-- o lookup nunca trave o pedido errado. Pedidos sem checkout (NULL) não entram no índice.
CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_checkout_id_key
  ON orders (payment_provider, checkout_id)
  WHERE checkout_id IS NOT NULL;

-- Substitui o índice não único da 002 (o único atende o mesmo lookup).
DROP INDEX IF EXISTS orders_checkout_id_idx;
