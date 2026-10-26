import type { Db } from '../../db/pool.js';

export interface ProductRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  stock: number;
  active: boolean;
  imageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  stock: number;
  active: boolean;
  image_key: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, slug, name, description, category, price_cents, stock, active, image_key,
                 created_at, updated_at`;

function toRecord(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    stock: row.stock,
    active: row.active,
    imageKey: row.image_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listActiveProducts(db: Db): Promise<ProductRecord[]> {
  const { rows } = await db.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products WHERE active ORDER BY lower(name), id`,
  );
  return rows.map(toRecord);
}

// `id` precisa ser um UUID válido (a rota valida antes), senão o pg lança 22P02.
export async function findActiveProductById(db: Db, id: string): Promise<ProductRecord | null> {
  const { rows } = await db.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products WHERE id = $1 AND active`,
    [id],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

// --- Admin -----------------------------------------------------------------------------------

export interface AdminProductFilter {
  q?: string;
  active?: boolean;
}

// Escapa \ % _ para que a busca seja literal dentro do ILIKE (… ESCAPE '\').
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export async function listProducts(db: Db, filter: AdminProductFilter): Promise<ProductRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.q) {
    params.push(`%${escapeLike(filter.q)}%`);
    conditions.push(`name ILIKE $${params.length} ESCAPE '\\'`);
  }
  if (filter.active !== undefined) {
    params.push(filter.active);
    conditions.push(`active = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products ${where} ORDER BY lower(name), id`,
    params,
  );
  return rows.map(toRecord);
}

export async function findProductById(db: Db, id: string): Promise<ProductRecord | null> {
  const { rows } = await db.query<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [
    id,
  ]);
  return rows[0] ? toRecord(rows[0]) : null;
}

// Mesmo lock (FOR UPDATE) que o fluxo de pedido usa nos produtos.
export async function lockProductForUpdate(
  db: Db,
  id: string,
): Promise<{ id: string; stock: number } | null> {
  const { rows } = await db.query<{ id: string; stock: number }>(
    'SELECT id, stock FROM products WHERE id = $1 FOR UPDATE',
    [id],
  );
  return rows[0] ?? null;
}

export interface NewProduct {
  slug: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  imageKey: string | null;
}

// Estoque entra SEMPRE em 0: o inicial vem do movimento 'initial'. null = slug já existe
// (ON CONFLICT cobre também a corrida entre duas criações simultâneas).
export async function insertProduct(db: Db, product: NewProduct): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO products (slug, name, description, category, price_cents, stock, image_key)
     VALUES ($1, $2, $3, $4, $5, 0, $6)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [
      product.slug,
      product.name,
      product.description,
      product.category,
      product.priceCents,
      product.imageKey,
    ],
  );
  return rows[0]?.id ?? null;
}

export interface ProductPatch {
  name?: string;
  description?: string;
  category?: string;
  priceCents?: number;
  active?: boolean;
  // undefined = mantém; null = remove; string = troca.
  imageKey?: string | null;
}

// Whitelist fixa de colunas: slug, stock e demais colunas NUNCA são alteradas por aqui.
const PATCHABLE_COLUMNS = [
  ['name', 'name'],
  ['description', 'description'],
  ['category', 'category'],
  ['priceCents', 'price_cents'],
  ['active', 'active'],
  ['imageKey', 'image_key'],
] as const;

export async function updateProduct(
  db: Db,
  id: string,
  patch: ProductPatch,
): Promise<ProductRecord | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of PATCHABLE_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  params.push(id);
  const { rows } = await db.query<ProductRow>(
    `UPDATE products SET ${[...sets, 'updated_at = now()'].join(', ')}
     WHERE id = $${params.length}
     RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] ? toRecord(rows[0]) : null;
}
