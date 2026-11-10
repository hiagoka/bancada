-- Bancada: provedor AbacatePay, Pix transparente (ARCHITECTURE.md, D34 e seção 8.9).

-- Cobrança Pix guardada no pedido: o cliente precisa do copia e cola e do QR Code para pagar, e a
-- validade para a contagem regressiva. Nulas para pedidos antigos e para o gateway fake.
ALTER TABLE orders
  ADD COLUMN pix_code       text,
  ADD COLUMN pix_qr_image   text,
  ADD COLUMN pix_expires_at timestamptz;

-- O webhook da AbacatePay não traz o id do nosso pedido de forma confiável: o pedido é achado por
-- checkout_id (o id da cobrança, pix_char_...).
CREATE INDEX orders_checkout_id_idx ON orders (checkout_id) WHERE checkout_id IS NOT NULL;

-- A AbacatePay não informa o valor pago (o Pix é fixado por nós ao criar a cobrança e a consulta de
-- status não devolve valor): o evento guarda NULL em vez de inventar um número.
ALTER TABLE payment_events ALTER COLUMN amount_cents DROP NOT NULL;
