import type { OrderStatus } from '@bancada/contracts';
import type { Db } from '../../db/pool.js';

export interface LockedProduct {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
}

export interface OrderRecord {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  totalCents: number;
  paymentProvider: string;
  checkoutId: string | null;
  checkoutUrl: string | null;
  // Cobrança Pix (D34), gravada junto com o checkout. Nulos no gateway fake e em pedidos antigos.
  pixCode: string | null;
  pixQrImage: string | null;
  pixExpiresAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface OrderItemRecord {
  productId: string;
  productName: string;
  unitPriceCents: number;
  quantity: number;
}

export interface OrderWithItems extends OrderRecord {
  items: OrderItemRecord[];
}

export interface NewOrder {
  idempotencyKey: string;
  requestHash: string;
  customerName: string;
  customerEmail: string;
  totalCents: number;
  paymentProvider: string;
}

interface OrderRow {
  id: string;
  idempotency_key: string;
  request_hash: string;
  customer_name: string;
  customer_email: string;
  status: OrderStatus;
  total_cents: number;
  payment_provider: string;
  checkout_id: string | null;
  checkout_url: string | null;
  pix_code: string | null;
  pix_qr_image: string | null;
  pix_expires_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
}

interface ItemRow {
  product_id: string;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
}

const ORDER_COLUMNS = `id, idempotency_key, request_hash, customer_name, customer_email, status,
                       total_cents, payment_provider, checkout_id, checkout_url,
                       pix_code, pix_qr_image, pix_expires_at, paid_at, created_at`;

function toOrder(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    status: row.status,
    totalCents: row.total_cents,
    paymentProvider: row.payment_provider,
    checkoutId: row.checkout_id,
    checkoutUrl: row.checkout_url,
    pixCode: row.pix_code,
    pixQrImage: row.pix_qr_image,
    pixExpiresAt: row.pix_expires_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

async function loadItems(db: Db, orderId: string): Promise<OrderItemRecord[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT product_id, product_name, unit_price_cents, quantity
     FROM order_items WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    unitPriceCents: r.unit_price_cents,
    quantity: r.quantity,
  }));
}

async function withItems(db: Db, row: OrderRow | undefined): Promise<OrderWithItems | null> {
  if (!row) return null;
  const order = toOrder(row);
  return { ...order, items: await loadItems(db, order.id) };
}

// Trava os produtos ativos pedidos, SEMPRE em ordem de id (evita deadlock entre pedidos
// com os mesmos produtos em ordem diferente). Produto inativo ou inexistente não volta.
export async function lockActiveProducts(db: Db, ids: string[]): Promise<LockedProduct[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    price_cents: number;
    stock: number;
  }>(
    `SELECT id, name, price_cents, stock FROM products
     WHERE id = ANY($1::uuid[]) AND active
     ORDER BY id
     FOR UPDATE`,
    [ids],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priceCents: r.price_cents,
    stock: r.stock,
  }));
}

export async function findOrderByIdempotencyKey(
  db: Db,
  key: string,
): Promise<OrderWithItems | null> {
  const { rows } = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE idempotency_key = $1`,
    [key],
  );
  return withItems(db, rows[0]);
}

export async function findOrderById(db: Db, id: string): Promise<OrderWithItems | null> {
  const { rows } = await db.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [
    id,
  ]);
  return withItems(db, rows[0]);
}

// Devolve o id do pedido criado, ou null se outra requisição já gravou a mesma chave.
export async function insertOrder(db: Db, order: NewOrder): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO orders (idempotency_key, request_hash, customer_name, customer_email,
                         total_cents, payment_provider)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      order.idempotencyKey,
      order.requestHash,
      order.customerName,
      order.customerEmail,
      order.totalCents,
      order.paymentProvider,
    ],
  );
  return rows[0]?.id ?? null;
}

export async function insertOrderItem(
  db: Db,
  orderId: string,
  item: OrderItemRecord,
): Promise<void> {
  await db.query(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderId, item.productId, item.productName, item.unitPriceCents, item.quantity],
  );
}

export interface CheckoutRecord {
  checkoutId: string;
  // Fake: página de checkout simulada. AbacatePay: null (o cliente paga pelo Pix).
  checkoutUrl: string | null;
  pix: { brCode: string; qrCodeImage: string; expiresAt: Date } | null;
}

// Só grava se ainda não houver checkout (checkout_id nulo): se outra requisição chegou antes, a
// dela vale. O id do checkout, a URL e o Pix entram juntos, num único UPDATE.
export async function setCheckoutIfMissing(
  db: Db,
  orderId: string,
  checkout: CheckoutRecord,
): Promise<void> {
  await db.query(
    `UPDATE orders
     SET checkout_id = $2, checkout_url = $3, pix_code = $4, pix_qr_image = $5, pix_expires_at = $6,
         updated_at = now()
     WHERE id = $1 AND checkout_id IS NULL`,
    [
      orderId,
      checkout.checkoutId,
      checkout.checkoutUrl,
      checkout.pix?.brCode ?? null,
      checkout.pix?.qrCodeImage ?? null,
      checkout.pix?.expiresAt ?? null,
    ],
  );
}

// --- Admin -----------------------------------------------------------------------------------

export async function lockOrderForUpdate(db: Db, id: string): Promise<OrderRecord | null> {
  const { rows } = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function markOrderCancelled(db: Db, id: string): Promise<void> {
  await db.query(`UPDATE orders SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [id]);
}

// Itens em ordem de product_id: a mesma ordem dos locks da criação de pedido (D18).
export async function listItemsByProduct(
  db: Db,
  orderId: string,
): Promise<{ productId: string; quantity: number }[]> {
  const { rows } = await db.query<{ product_id: string; quantity: number }>(
    'SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id',
    [orderId],
  );
  return rows.map((r) => ({ productId: r.product_id, quantity: r.quantity }));
}

export async function listOrdersPage(
  db: Db,
  options: { status?: OrderStatus; limit: number; offset: number },
): Promise<{ orders: OrderWithItems[]; total: number }> {
  const filter = options.status ? 'WHERE status = $1::order_status' : '';
  const filterParams = options.status ? [options.status] : [];

  const totalResult = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM orders ${filter}`,
    filterParams,
  );
  const { rows } = await db.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders ${filter}
     ORDER BY created_at DESC, id DESC
     LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
    [...filterParams, options.limit, options.offset],
  );

  // Uma consulta só para os itens da página (sem N+1).
  const itemsByOrder = new Map<string, OrderItemRecord[]>();
  if (rows.length > 0) {
    const items = await db.query<ItemRow & { order_id: string }>(
      `SELECT order_id, product_id, product_name, unit_price_cents, quantity
       FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY id`,
      [rows.map((r) => r.id)],
    );
    for (const item of items.rows) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push({
        productId: item.product_id,
        productName: item.product_name,
        unitPriceCents: item.unit_price_cents,
        quantity: item.quantity,
      });
      itemsByOrder.set(item.order_id, list);
    }
  }
  return {
    orders: rows.map((row) => ({ ...toOrder(row), items: itemsByOrder.get(row.id) ?? [] })),
    total: totalResult.rows[0]!.n,
  };
}
